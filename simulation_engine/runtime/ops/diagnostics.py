"""Runtime tanılama: sistemin kendi hakkında bildiği sayılar.

Sorun
-----
Bir hat "izleniyor" görünürken aslında olay düşürüyor olabilir: kuyruk dolu,
yazıcı hata alıyor, bir akış kırk saniyedir susuyor. Bunların hiçbiri
kullanıcının baktığı ekranda görünmez — üretim panosu yalnızca son değeri
gösterir ve o değer eskidiğinde bile aynı görünür.

Bu modül, sistemin kendi sağlığını tek bir yerde toplar. Her sayı **gerçek bir
sayaçtan** gelir: dağıtıcının işlediği olay sayısı, kuyruğun derinliği,
telemetri yazıcısının hız örnekleri, kesintisizlik izleyicisinin kalp atışı
yaşları. Hiçbiri tahmin edilmez.

Ölçülmemiş değer neden `None`
-----------------------------
Hiç olay işlememiş bir dağıtıcının "saniyede sıfır olay" göstermesi, çalışan
ama boşta olan bir sistemi arızalı gibi gösterirdi. Ölçülemeyen her alan
`None` döner ve arayüz "—" ile birlikte nedenini yazar.

Sağlık notu neden bir kural dizisi
----------------------------------
Tek bir sayıya indirgenmiş sağlık ("%87") neyin bozuk olduğunu söylemez.
Bunun yerine ölçütler ayrı ayrı değerlendirilir ve **en kötüsü** özet olur:
olay düşüyorsa hiçbir başka sayı durumu iyi yapmaz.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

#: Kuyruk doluluk oranı bu eşiği aşarsa geri basınç uyarısı verilir.
#:
#: Yüzde seksen, kuyruğun dolmasına yakın ama henüz olay düşürmemiş durumdur;
#: uyarı, düşme başlamadan önce görünmelidir.
QUEUE_PRESSURE_RATIO = 0.8

#: Kayıp oranı bu eşiği aşarsa durum kritik sayılır.
#:
#: Binde bir: yüz bin olayda yüz olay kaybı, bir vardiyanın üretim sayısını
#: gözle görülür biçimde bozar.
CRITICAL_LOSS_RATIO = 0.001

#: Kalp atışı bu süreden eskiyse akış sessiz sayılır (ms).
STALE_HEARTBEAT_MS = 30_000

#: Akış gecikmesi bu eşiği aşarsa uyarı verilir (ms).
#:
#: İki saniye: bir operatörün ekrana bakıp karar verdiği süre içinde verinin
#: gelmiş olması gerekir.
SLOW_LAG_MS = 2_000


class DiagnosticLevel(str, Enum):
    """Bir ölçütün durumu."""

    OK = "ok"
    WARNING = "warning"
    CRITICAL = "critical"
    #: Ölçülmedi; iyi de kötü de değil.
    UNKNOWN = "unknown"


DIAGNOSTIC_LEVEL_LABEL: Dict[DiagnosticLevel, str] = {
    DiagnosticLevel.OK: "Normal",
    DiagnosticLevel.WARNING: "Dikkat",
    DiagnosticLevel.CRITICAL: "Kritik",
    DiagnosticLevel.UNKNOWN: "Ölçülmedi",
}

#: En kötüden iyiye sıralama; özet durum bu sıraya göre seçilir.
LEVEL_ORDER: List[DiagnosticLevel] = [
    DiagnosticLevel.CRITICAL,
    DiagnosticLevel.WARNING,
    DiagnosticLevel.OK,
    DiagnosticLevel.UNKNOWN,
]


@dataclass(frozen=True)
class DiagnosticMetric:
    """Tek bir tanılama ölçütü."""

    id: str
    label: str
    #: Ölçülen değer; ölçülemediyse `None`.
    value: Optional[float]
    unit: Optional[str]
    level: DiagnosticLevel
    #: Ölçülemediyse **neden** ölçülemediği; ölçüldüyse `None`.
    reason: Optional[str] = None

    @property
    def measured(self) -> bool:
        return self.value is not None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "value": self.value,
            "unit": self.unit,
            "level": self.level.value,
            "level_label": DIAGNOSTIC_LEVEL_LABEL[self.level],
            "reason": self.reason,
            "measured": self.measured,
        }


def unmeasured(metric_id: str, label: str, reason: str, unit: Optional[str] = None) -> DiagnosticMetric:
    """Ölçülemeyen bir ölçüt.

    Sıfır yerine `None` döner ve nedeni taşır: "saniyede sıfır olay" ile
    "henüz olay işlenmedi" aynı şey değildir.
    """
    return DiagnosticMetric(
        id=metric_id,
        label=label,
        value=None,
        unit=unit,
        level=DiagnosticLevel.UNKNOWN,
        reason=reason,
    )


def worst_level(metrics: List[DiagnosticMetric]) -> DiagnosticLevel:
    """Ölçütlerin en kötüsü.

    Hiç ölçüt yoksa `UNKNOWN` döner. `OK` dönseydi, hiçbir şey ölçmemiş bir
    sistem sağlıklı görünürdü.
    """
    if not metrics:
        return DiagnosticLevel.UNKNOWN
    levels = {metric.level for metric in metrics}
    for candidate in LEVEL_ORDER:
        if candidate in levels:
            return candidate
    return DiagnosticLevel.UNKNOWN


def _ratio_level(ratio: Optional[float], warn: float, critical: float) -> DiagnosticLevel:
    if ratio is None:
        return DiagnosticLevel.UNKNOWN
    if ratio >= critical:
        return DiagnosticLevel.CRITICAL
    if ratio >= warn:
        return DiagnosticLevel.WARNING
    return DiagnosticLevel.OK


def throughput_metric(stats: Dict[str, Any]) -> DiagnosticMetric:
    """Saniyede işlenen olay sayısı."""
    value = stats.get("events_per_second")
    if value is None:
        return unmeasured(
            "throughput",
            "Olay verimi",
            "Henüz olay işlenmedi; hız ölçülemez",
            "olay/sn",
        )
    return DiagnosticMetric(
        id="throughput",
        label="Olay verimi",
        value=float(value),
        unit="olay/sn",
        level=DiagnosticLevel.OK,
    )


def queue_metric(stats: Dict[str, Any]) -> DiagnosticMetric:
    """Kuyruk doluluğu.

    Kuyruk kapasitesi bilinmiyorsa oran hesaplanamaz; derinliği tek başına
    yorumlamak (yüz olay çok mu az mı?) anlamsız olurdu.
    """
    queue = stats.get("queue") or {}
    depth = queue.get("depth")
    capacity = queue.get("capacity")
    if depth is None or not capacity:
        return unmeasured(
            "queue_depth", "Kuyruk derinliği", "Kuyruk bilgisi yok", "olay"
        )
    ratio = depth / capacity
    return DiagnosticMetric(
        id="queue_depth",
        label="Kuyruk derinliği",
        value=float(depth),
        unit="olay",
        level=_ratio_level(ratio, QUEUE_PRESSURE_RATIO, 1.0),
        reason=None if ratio < QUEUE_PRESSURE_RATIO else f"Kapasitenin %{ratio * 100:.0f}'i dolu",
    )


def dropped_metric(stats: Dict[str, Any]) -> DiagnosticMetric:
    """Düşürülen olaylar.

    Kayıp oranı, düşen sayının tek başına söylemediğini söyler: milyon olayda
    on kayıpla yüz olayda on kayıp aynı sayıdır ama aynı sorun değildir.
    """
    dropped = stats.get("dropped")
    if dropped is None:
        return unmeasured("dropped", "Düşürülen olay", "Sayaç yok", "olay")
    # Bir tek olayın düşmesi bile uyarıdır: kaybın var olması, büyüklüğünden
    # önce gelen bir olgudur. Kritik eşiği aşan oran ise vardiyanın üretim
    # sayısını gözle görülür biçimde bozar.
    ratio = stats.get("loss_ratio")
    if dropped == 0:
        level = DiagnosticLevel.OK
    elif ratio is not None and ratio >= CRITICAL_LOSS_RATIO:
        level = DiagnosticLevel.CRITICAL
    else:
        level = DiagnosticLevel.WARNING
    return DiagnosticMetric(
        id="dropped",
        label="Düşürülen olay",
        value=float(dropped),
        unit="olay",
        level=level,
        reason=None if not dropped else "Kuyruk dolduğu için olay düşürüldü",
    )


def lag_metric(stats: Dict[str, Any]) -> DiagnosticMetric:
    """Ortalama akış gecikmesi (ölçümün üretilmesi ile işlenmesi arası)."""
    value = stats.get("avg_latency_ms")
    if value is None:
        return unmeasured(
            "lag", "Akış gecikmesi", "Gecikme örneği yok; ölçüm gelmedi", "ms"
        )
    level = DiagnosticLevel.OK
    if value >= SLOW_LAG_MS:
        level = DiagnosticLevel.WARNING
    return DiagnosticMetric(
        id="lag",
        label="Akış gecikmesi",
        value=float(value),
        unit="ms",
        level=level,
    )


def reconnect_metric(liveness: List[Dict[str, Any]]) -> DiagnosticMetric:
    """Toplam yeniden bağlanma sayısı.

    Hiç akış izlenmiyorsa `None` döner: sıfır yeniden bağlanma, hiç bağlantısı
    olmayan bir kurulumda "hiç kopmadı" diye okunurdu.
    """
    if not liveness:
        return unmeasured(
            "reconnects", "Yeniden bağlanma", "İzlenen akış yok", "kez"
        )
    total = sum(int(item.get("reconnects") or 0) for item in liveness)
    level = DiagnosticLevel.OK if total == 0 else DiagnosticLevel.WARNING
    return DiagnosticMetric(
        id="reconnects",
        label="Yeniden bağlanma",
        value=float(total),
        unit="kez",
        level=level,
        reason=None if total == 0 else f"{total} kez kopup geri geldi",
    )


def heartbeat_metric(liveness: List[Dict[str, Any]], now_ms: int) -> DiagnosticMetric:
    """En eski kalp atışının yaşı.

    Hiç veri almamış akışlar hesaba katılmaz: yaşı olmayan bir akış "çok eski"
    değildir, henüz başlamamıştır.
    """
    ages = [
        int(item["age_ms"])
        for item in liveness
        if item.get("age_ms") is not None
    ]
    if not ages:
        return unmeasured(
            "heartbeat_age",
            "Son veri yaşı",
            "Hiçbir akıştan henüz veri gelmedi",
            "ms",
        )
    oldest = max(ages)
    level = DiagnosticLevel.OK
    if oldest >= STALE_HEARTBEAT_MS:
        level = DiagnosticLevel.CRITICAL
    elif oldest >= STALE_HEARTBEAT_MS // 2:
        level = DiagnosticLevel.WARNING
    return DiagnosticMetric(
        id="heartbeat_age",
        label="Son veri yaşı",
        value=float(oldest),
        unit="ms",
        level=level,
        reason=None if level is DiagnosticLevel.OK else "Bir akıştan uzun süredir veri yok",
    )


def telemetry_metric(writer: Optional[Dict[str, Any]]) -> DiagnosticMetric:
    """Saniyede yazılan telemetri satırı."""
    if not writer:
        return unmeasured(
            "telemetry_writes",
            "Telemetri yazma",
            "Telemetri yazıcısı çalışmıyor",
            "satır/sn",
        )
    value = writer.get("writes_per_second")
    if value is None:
        return unmeasured(
            "telemetry_writes",
            "Telemetri yazma",
            "Henüz yazma yapılmadı; hız ölçülemez",
            "satır/sn",
        )
    errors = int(writer.get("errors") or 0)
    level = DiagnosticLevel.OK if errors == 0 else DiagnosticLevel.CRITICAL
    return DiagnosticMetric(
        id="telemetry_writes",
        label="Telemetri yazma",
        value=float(value),
        unit="satır/sn",
        level=level,
        reason=None if errors == 0 else f"{errors} yazma hatası",
    )


def pending_metric(writer: Optional[Dict[str, Any]]) -> DiagnosticMetric:
    """Diske yazılmayı bekleyen ölçümler."""
    if not writer or writer.get("pending") is None:
        return unmeasured(
            "telemetry_pending", "Bekleyen ölçüm", "Yazıcı çalışmıyor", "satır"
        )
    return DiagnosticMetric(
        id="telemetry_pending",
        label="Bekleyen ölçüm",
        value=float(writer["pending"]),
        unit="satır",
        level=DiagnosticLevel.OK,
    )


@dataclass
class DiagnosticsReport:
    """Tanılama ekranının okuduğu tam görünüm."""

    at_ms: int
    metrics: List[DiagnosticMetric] = field(default_factory=list)
    #: Akış başına canlılık durumu.
    streams: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def level(self) -> DiagnosticLevel:
        return worst_level(self.metrics)

    @property
    def measured_count(self) -> int:
        return len([metric for metric in self.metrics if metric.measured])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "at_ms": self.at_ms,
            "level": self.level.value,
            "level_label": DIAGNOSTIC_LEVEL_LABEL[self.level],
            "metrics": [metric.to_dict() for metric in self.metrics],
            "streams": list(self.streams),
            "measured_count": self.measured_count,
            "metric_count": len(self.metrics),
        }


def build_report(
    now_ms: int,
    dispatcher_stats: Optional[Dict[str, Any]] = None,
    liveness: Optional[List[Dict[str, Any]]] = None,
    writer_stats: Optional[Dict[str, Any]] = None,
) -> DiagnosticsReport:
    """Gerçek sayaçlardan tanılama raporu kurar.

    Eksik bir kaynak raporu düşürmez: sağlanmayan her bölüm "ölçülmedi" olarak
    görünür. Eksik bölüm için varsayılan üretilseydi, çalışmayan bir alt sistem
    sağlıklı görünürdü.
    """
    stats = dispatcher_stats or {}
    states = liveness or []
    metrics = [
        throughput_metric(stats),
        queue_metric(stats),
        dropped_metric(stats),
        lag_metric(stats),
        reconnect_metric(states),
        heartbeat_metric(states, now_ms),
        telemetry_metric(writer_stats),
        pending_metric(writer_stats),
    ]
    return DiagnosticsReport(at_ms=now_ms, metrics=metrics, streams=states)
