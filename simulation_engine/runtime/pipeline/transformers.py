"""Protokol yüklerinin ortak modele çevrilmesi.

Üç giriş vardır ve üçü de aynı çıktıyı üretir: `TransformResult` (olaylar +
sorunlar). Sorunlar hiçbir zaman sessizce yutulmaz — bozuk bir JSON, tanınmayan
bir alan ya da eşleşmeyen bir konu, tanılamaya düşer.

Eşleme (mapping)
----------------
Bir cihaz "hangi makine" olduğunu genellikle söylemez: OPC UA'da düğüm
kimliği, MQTT'de konu adı vardır. Bu yüzden bağlantıya bir **eşleme** verilir:
kaynak adresten makine kimliğine ve ölçüme. Eşleme yoksa adresin kendisinden
çıkarım denenir ve bu çıkarımın yapıldığı arayüzde görünür — sessiz bir tahmin,
yanlış makineye yazılan üretim demektir.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from simulation_engine.runtime.pipeline.device_events import (
    DeviceEvent,
    Metric,
    PipelineProblem,
    Quality,
    TransformResult,
    metric_from_name,
)
from simulation_engine.runtime.types import ConnectionKind

#: Ham yükten tanılamaya yazılacak en fazla karakter.
SAMPLE_LIMIT = 160

#: İç içe geçmiş JSON'da inilecek en fazla derinlik.
#:
#: Sınırsız bırakılsaydı, kendine dönen ya da çok derin bir yük sunucuyu
#: gereksiz yere meşgul ederdi; beş seviye, sahadaki yüklerin tamamını kapsar.
MAX_DEPTH = 5


@dataclass(frozen=True)
class MetricMapping:
    """Bir kaynak adresin hangi makineye ve ölçüme karşılık geldiği."""

    #: OPC UA düğüm kimliği, MQTT konusu ya da JSON alan yolu.
    origin: str
    machine_id: str
    metric: Metric
    unit: Optional[str] = None


@dataclass
class MappingTable:
    """Bir bağlantının eşleme tablosu."""

    entries: List[MetricMapping] = field(default_factory=list)

    def find(self, origin: str) -> Optional[MetricMapping]:
        """Adrese birebir uyan kayıt; yoksa `None`."""
        for entry in self.entries:
            if entry.origin == origin:
                return entry
        return None

    def find_suffix(self, origin: str) -> Optional[MetricMapping]:
        """Adresin sonuna uyan kayıt.

        MQTT konularında son seviye çoğu zaman ölçümün adıdır
        (`fabrika/torna/production_count`); eşleme yalnızca birebir olsaydı,
        her makine için ayrı satır yazmak gerekirdi.
        """
        for entry in self.entries:
            if origin.endswith(entry.origin):
                return entry
        return None

    @property
    def is_empty(self) -> bool:
        return len(self.entries) == 0


def sample_of(payload: Any) -> str:
    """Ham yükün tanılamada gösterilecek kısaltılmış hâli."""
    if isinstance(payload, bytes):
        try:
            text = payload.decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001 - kodlama ne olursa olsun örnek üretilir
            text = repr(payload)
    else:
        text = payload if isinstance(payload, str) else repr(payload)
    cleaned = " ".join(text.split())
    return cleaned[:SAMPLE_LIMIT]


def flatten(payload: Any, prefix: str = "", depth: int = 0) -> List[Tuple[str, Any]]:
    """İç içe geçmiş yükü `yol → değer` çiftlerine açar.

    Sözlükler nokta ile (`istasyon.torna.adet`), diziler köşeli parantezle
    (`olcumler[0].adet`) yollanır. Yaprak olmayan hiçbir düğüm sonuca girmez.
    """
    if depth > MAX_DEPTH:
        return []

    if isinstance(payload, dict):
        found: List[Tuple[str, Any]] = []
        for key, value in payload.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            found.extend(flatten(value, path, depth + 1))
        return found

    if isinstance(payload, list):
        found = []
        for index, value in enumerate(payload):
            path = f"{prefix}[{index}]" if prefix else f"[{index}]"
            found.extend(flatten(value, path, depth + 1))
        return found

    return [(prefix, payload)]


def leaf_name(path: str) -> str:
    """Yolun son parçası; ölçüm adı buradan okunur."""
    tail = path.split(".")[-1]
    return tail.split("[")[0] if "[" in tail else tail


def parse_json(payload: bytes | str) -> Tuple[Any, Optional[str]]:
    """JSON çözer; çözemezse nedenini döndürür."""
    try:
        text = payload.decode("utf-8") if isinstance(payload, bytes) else payload
    except UnicodeDecodeError:
        return None, "Yük UTF-8 değil; JSON olarak okunamadı."
    try:
        return json.loads(text), None
    except json.JSONDecodeError as error:
        return None, f"JSON çözülemedi: {error.msg} (satır {error.lineno})."


#: Yükte makine kimliğini taşıyan yaygın alan adları.
#:
#: Dizi yükleri neredeyse her zaman `[{"machine_id": "TORNA_01", ...}, ...]`
#: biçimindedir; bu alanı okumadan her satır aynı makineye yazılırdı.
IDENTITY_FIELDS = (
    "machine_id",
    "machine",
    "station_id",
    "station",
    "istasyon",
    "makine",
    "device_id",
    "device",
    "id",
    "name",
)


def identity_of(document: Any) -> Tuple[Optional[str], Any]:
    """Yükteki makine kimliğini ayırır.

    Kimlik alanı bulunursa hem makine adı olarak döner hem de yükten çıkarılır:
    çıkarılmasaydı `machine_id` bir ölçüm sanılır ve "tanınmayan alan" olarak
    tanılamaya düşerdi.
    """
    if not isinstance(document, dict):
        return None, document

    for field_name in IDENTITY_FIELDS:
        value = document.get(field_name)
        if isinstance(value, str) and value.strip() != "":
            rest = {key: item for key, item in document.items() if key != field_name}
            return value.strip(), rest

    return None, document


def _machine_from_path(path: str, fallback: str) -> str:
    """Yoldan makine kimliği çıkarır.

    `istasyonlar.torna.adet` gibi bir yolda sondan bir önceki parça makine
    adıdır. Çıkarılamıyorsa bağlantının kendi kimliği kullanılır ve bu, olayın
    `origin` alanından izlenebilir.
    """
    parts = [part.split("[")[0] for part in path.split(".") if part]
    if len(parts) >= 2 and parts[-2] != "":
        return parts[-2]
    # Dizi yollarinda (`[0].adet`) sondan bir onceki parca bostur; boyle bir
    # durumda cikarim yapilmis sayilmaz ve cagiranin verdigi ad kullanilir.
    return fallback


def _event_from_pair(
    connection_id: str,
    origin: str,
    path: str,
    name: str,
    value: Any,
    at_ms: int,
    source: ConnectionKind,
    mapping: Optional[MappingTable],
    default_machine: str,
    raw_sample: str,
) -> Tuple[Optional[DeviceEvent], Optional[PipelineProblem]]:
    """Tek bir `alan → değer` çiftini olaya çevirir.

    Makine kimliği **yalnızca JSON yolundan** çıkarılır (`istasyonlar.torna.adet`
    → `torna`); adresin başındaki konu ya da düğüm öneki bu çıkarıma katılmaz.
    Katılsaydı, `fabrika/torna/olcum` konusundan gelen bir yükte makine adı
    konunun tamamı olurdu ve hiçbir istasyonla eşleşmezdi.
    """
    entry = None
    if mapping is not None:
        entry = mapping.find(origin) or mapping.find_suffix(origin)

    if entry is not None:
        machine_id = entry.machine_id
        metric = entry.metric
        unit = entry.unit
    else:
        machine_id = _machine_from_path(path, default_machine)
        metric = metric_from_name(name)
        unit = None

    if metric is Metric.UNKNOWN:
        return None, PipelineProblem(
            connection_id=connection_id,
            reason=(
                f"'{name}' alanı tanınmadı ve eşleme tablosunda yok; "
                "bu değer hiçbir ekrana yazılmadı."
            ),
            at_ms=at_ms,
            origin=origin,
            sample=raw_sample,
        )

    if isinstance(value, (dict, list)):
        return None, PipelineProblem(
            connection_id=connection_id,
            reason=f"'{name}' alanı tek bir değer değil; ölçüm olarak okunamadı.",
            at_ms=at_ms,
            origin=origin,
            sample=raw_sample,
        )

    event = DeviceEvent(
        connection_id=connection_id,
        machine_id=machine_id,
        metric=metric,
        value=value,
        at_ms=at_ms,
        source=source,
        quality=Quality.GOOD,
        unit=unit,
        origin=origin,
        raw={"path": origin},
    )

    if not event.is_usable:
        return event, PipelineProblem(
            connection_id=connection_id,
            reason=(
                f"'{name}' alanı {Metric(metric).value} için sayısal olmalı; "
                f"gelen değer: {value!r}."
            ),
            at_ms=at_ms,
            origin=origin,
            sample=raw_sample,
        )

    return event, None


def from_json_payload(
    connection_id: str,
    payload: bytes | str,
    at_ms: int,
    source: ConnectionKind,
    mapping: Optional[MappingTable] = None,
    origin_prefix: str = "",
    default_machine: Optional[str] = None,
) -> TransformResult:
    """JSON yükünü olaylara çevirir.

    Düz, iç içe ve dizi yükler aynı yoldan geçer: yük önce `yol → değer`
    çiftlerine açılır, sonra her çift ayrı ayrı çevrilir. Böylece tek bir bozuk
    alan, yükün geri kalanını iptal etmez — ölçümlerin dokuzu doğruysa dokuzu
    ekrana gider ve biri tanılamaya düşer.
    """
    document, error = parse_json(payload)
    sample = sample_of(payload)

    if error is not None:
        return TransformResult(
            events=[],
            problems=[
                PipelineProblem(
                    connection_id=connection_id,
                    reason=error,
                    at_ms=at_ms,
                    origin=origin_prefix or None,
                    sample=sample,
                )
            ],
        )

    if document is None or isinstance(document, (str, int, float, bool)):
        # Tek bir çıplak değer: eşleme olmadan hangi ölçüm olduğu bilinemez.
        entry = mapping.find(origin_prefix) if mapping is not None else None
        if entry is None and mapping is not None:
            entry = mapping.find_suffix(origin_prefix)
        if entry is None:
            return TransformResult(
                events=[],
                problems=[
                    PipelineProblem(
                        connection_id=connection_id,
                        reason=(
                            "Yük tek bir çıplak değer ve bu adres için eşleme "
                            "tanımlı değil; hangi ölçüm olduğu bilinemiyor."
                        ),
                        at_ms=at_ms,
                        origin=origin_prefix or None,
                        sample=sample,
                    )
                ],
            )
        event = DeviceEvent(
            connection_id=connection_id,
            machine_id=entry.machine_id,
            metric=entry.metric,
            value=document,
            at_ms=at_ms,
            source=source,
            unit=entry.unit,
            origin=origin_prefix or None,
            raw={"path": origin_prefix},
        )
        problems = (
            []
            if event.is_usable
            else [
                PipelineProblem(
                    connection_id=connection_id,
                    reason=f"Değer {entry.metric.value} için okunamadı: {document!r}.",
                    at_ms=at_ms,
                    origin=origin_prefix or None,
                    sample=sample,
                )
            ]
        )
        return TransformResult(events=[event], problems=problems)

    events: List[DeviceEvent] = []
    problems: List[PipelineProblem] = []
    fallback = default_machine or connection_id

    """
    Dizi yükleri tek tek işlenir ve her satırın kendi kimliği okunur; tek bir
    düzleştirme yapılsaydı `[0]`, `[1]` yollarından makine adı çıkmaz ve bütün
    satırlar aynı makineye yazılırdı.
    """
    documents: List[Tuple[str, Any]] = []
    if isinstance(document, list):
        for item in document:
            machine, rest = identity_of(item)
            documents.append((machine or fallback, rest))
    else:
        machine, rest = identity_of(document)
        documents.append((machine or fallback, rest))

    pairs: List[Tuple[str, str, Any]] = []
    for machine, sub_document in documents:
        for path, value in flatten(sub_document):
            pairs.append((machine, path, value))

    for machine, path, value in pairs:
        origin = f"{origin_prefix}.{path}" if origin_prefix and path else (origin_prefix or path)
        event, problem = _event_from_pair(
            connection_id=connection_id,
            origin=origin,
            path=path,
            name=leaf_name(path) if path else leaf_name(origin_prefix),
            value=value,
            at_ms=at_ms,
            source=source,
            mapping=mapping,
            default_machine=machine,
            raw_sample=sample,
        )
        if event is not None and event.is_usable:
            events.append(event)
        if problem is not None:
            problems.append(problem)

    if not events and not problems:
        problems.append(
            PipelineProblem(
                connection_id=connection_id,
                reason="Yükte okunabilir hiçbir alan yok.",
                at_ms=at_ms,
                origin=origin_prefix or None,
                sample=sample,
            )
        )

    return TransformResult(events=events, problems=problems)


def from_mqtt_message(
    connection_id: str,
    topic: str,
    payload: bytes,
    at_ms: int,
    mapping: Optional[MappingTable] = None,
    default_machine: Optional[str] = None,
) -> TransformResult:
    """MQTT mesajını olaylara çevirir.

    Konu adı adresin başına konur (`fabrika/torna/adet`), böylece eşleme
    tablosu hem konuya hem alan adına göre yazılabilir.
    """
    return from_json_payload(
        connection_id=connection_id,
        payload=payload,
        at_ms=at_ms,
        source=ConnectionKind.MQTT,
        mapping=mapping,
        origin_prefix=topic,
        default_machine=default_machine or _machine_from_topic(topic),
    )


def _machine_from_topic(topic: str) -> str:
    """Konudan makine adı çıkarır.

    `fabrika/torna/adet` → `torna` (son seviye ölçümün adıdır),
    `fabrika/torna` → `torna` (iki seviyede son parça makinedir).

    Bu bir **çıkarımdır** ve konu düzeni her tesiste aynı değildir; kesin
    sonuç için eşleme tablosu kullanılır. Çıkarım yine de yapılır: eşleme
    tanımlanmamış bir kurulumda hiç veri göstermemek yerine, nereden geldiği
    izlenebilen bir tahmin göstermek daha kullanışlıdır.
    """
    parts = [part for part in topic.split("/") if part and part not in ("#", "+")]
    if len(parts) >= 3:
        return parts[-2]
    if len(parts) == 2:
        return parts[-1]
    return parts[0] if parts else "bilinmeyen"


def from_opcua_value(
    connection_id: str,
    node_id: str,
    value: Any,
    at_ms: int,
    mapping: Optional[MappingTable] = None,
    quality: Quality = Quality.GOOD,
    default_machine: Optional[str] = None,
) -> TransformResult:
    """OPC UA düğüm değerini olaya çevirir.

    Düğüm kimliği (`ns=2;i=5`) ölçümün adını taşımaz; bu yüzden eşleme
    **zorunludur**. Eşleme yoksa değer atılmaz ama ekrana da yazılmaz:
    tanılamada "bu düğüm eşlenmemiş" olarak görünür ve kullanıcı eşlemeyi
    tamamlar.
    """
    entry = None
    if mapping is not None:
        entry = mapping.find(node_id) or mapping.find_suffix(node_id)

    if entry is None:
        return TransformResult(
            events=[],
            problems=[
                PipelineProblem(
                    connection_id=connection_id,
                    reason=(
                        f"'{node_id}' düğümü eşlenmemiş; hangi makinenin hangi "
                        "ölçümü olduğu bilinmiyor."
                    ),
                    at_ms=at_ms,
                    origin=node_id,
                    sample=sample_of(value),
                )
            ],
        )

    event = DeviceEvent(
        connection_id=connection_id,
        machine_id=entry.machine_id or (default_machine or connection_id),
        metric=entry.metric,
        value=value,
        at_ms=at_ms,
        source=ConnectionKind.OPCUA,
        quality=quality,
        unit=entry.unit,
        origin=node_id,
        raw={"node": node_id},
    )

    if event.is_usable:
        return TransformResult(events=[event], problems=[])

    reason = (
        f"'{node_id}' düğümünün kalitesi {quality.value}; değer kullanılmadı."
        if quality is not Quality.GOOD
        else f"'{node_id}' düğümü {entry.metric.value} için okunamadı: {value!r}."
    )
    return TransformResult(
        events=[event],
        problems=[
            PipelineProblem(
                connection_id=connection_id,
                reason=reason,
                at_ms=at_ms,
                origin=node_id,
                sample=sample_of(value),
            )
        ],
    )


def from_rest_payload(
    connection_id: str,
    payload: bytes | str,
    at_ms: int,
    mapping: Optional[MappingTable] = None,
    default_machine: Optional[str] = None,
) -> TransformResult:
    """REST yanıtını olaylara çevirir."""
    return from_json_payload(
        connection_id=connection_id,
        payload=payload,
        at_ms=at_ms,
        source=ConnectionKind.REST,
        mapping=mapping,
        default_machine=default_machine,
    )
