"""Otomatik isimlendirme ve etiket sınıflandırma.

Sorun
-----
Bir OPC UA sunucusundan dönen adres `ns=2;s=Hat1.Freze01.UretimSayaci`, bir
MQTT konusu `fabrika/hat1/freze01/uretim` biçimindedir. Kullanıcıya bunları
olduğu gibi göstermek, yüz etiketlik bir listede hangisinin ne olduğunu
okunamaz kılar.

Ne yapılır, ne yapılmaz
-----------------------
Ad **türetilir** (adresin son parçasından, okunur biçime çevrilerek); tür
**tahmin edilir** ama tahmin olduğu saklanmaz: anlaşılamayan bir etiket
`UNKNOWN` kalır ve arayüzde "Bilinmiyor" yazar. Rastgele bir türe atanması,
bir metin alanını sayaç sanıp grafiğe koymak olurdu.

Eşleme önerisi neden öneridir
-----------------------------
`uretim`, `production`, `count` gibi sözcükler `production_count` metriğine
işaret eder ama kesin değildir. Öneri, kullanıcının onayına sunulur; sessizce
uygulanan bir eşleme, yanlış makineye yazılmış bir üretim sayısı demektir.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from simulation_engine.runtime.provisioning.types import DiscoveredTag, TagKind

#: Adres ayırıcıları: OPC UA nokta, MQTT eğik çizgi, REST iki nokta kullanır.
SEPARATORS = re.compile(r"[./:\\|]+")

#: OPC UA adresinin ön eki (`ns=2;s=`) atılır; kullanıcı için bilgi taşımaz.
OPCUA_PREFIX = re.compile(r"^ns=\d+;[isgb]=", re.IGNORECASE)

#: Metrik önerisi için anahtar sözcükler.
#:
#: Türkçe ve İngilizce birlikte aranır: sahada iki dil de kullanılır ve
#: yalnızca birini desteklemek, kurulumun yarısında öneriyi işe yaramaz kılar.
METRIC_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "production_count": ("uretim", "üretim", "production", "produced", "adet", "count"),
    "scrap_count": ("hurda", "scrap", "reject", "fire", "defect"),
    "queue_length": ("kuyruk", "queue", "buffer", "wip", "bekleyen"),
    "cycle_time_seconds": ("cevrim", "çevrim", "cycle", "takt"),
    "downtime_minutes": ("durus", "duruş", "downtime", "stop", "arıza", "ariza"),
    "oee": ("oee", "verimlilik", "efficiency"),
    "status": ("durum", "status", "state", "mode"),
    "throughput_per_hour": ("hiz", "hız", "throughput", "rate", "debi"),
}

#: Makine kimliği gibi görünen parçalar: harf + rakam (FREZE_01, CNC3).
MACHINE_PATTERN = re.compile(r"^[A-Za-zÇĞİÖŞÜçğıöşü]+[_-]?\d+$")


def strip_prefix(address: str) -> str:
    """OPC UA ön ekini atar; başka adreslerde adresi olduğu gibi bırakır."""
    return OPCUA_PREFIX.sub("", address.strip())


def address_parts(address: str) -> List[str]:
    """Adresi anlamlı parçalara böler."""
    cleaned = strip_prefix(address)
    parts = [part.strip() for part in SEPARATORS.split(cleaned)]
    return [part for part in parts if part]


def humanize(token: str) -> str:
    """Bir parçayı okunur ada çevirir.

    `UretimSayaci` → `Uretim Sayaci`, `uretim_sayaci` → `Uretim Sayaci`.
    Boş bir parça boş dönmez; çağıran adresin kendisine düşer.
    """
    if not token:
        return ""
    spaced = re.sub(r"[_-]+", " ", token)
    spaced = re.sub(r"(?<=[a-zçğıöşü])(?=[A-ZÇĞİÖŞÜ])", " ", spaced)
    words = [word for word in spaced.split() if word]
    return " ".join(word[:1].upper() + word[1:] for word in words)


def tag_name(address: str) -> str:
    """Adresten okunur bir ad türetir.

    Türetilemezse **adresin kendisi** döner. Boş bir ad ya da "Etiket 1" gibi
    bir yer tutucu döndürmek, kullanıcının hangi düğümü seçtiğini görmesini
    engellerdi.
    """
    parts = address_parts(address)
    if not parts:
        return address
    return humanize(parts[-1]) or address


def machine_hint(address: str) -> Optional[str]:
    """Adreste makine kimliği gibi görünen parça; yoksa `None`.

    Tahmin edilemediğinde `None` döner ve kullanıcı makineyi kendisi seçer.
    Rastgele bir makineye atanması, başka bir hattın üretim sayısını bozardı.
    """
    parts = address_parts(address)
    for part in reversed(parts[:-1] if len(parts) > 1 else parts):
        if MACHINE_PATTERN.match(part):
            return part.upper()
    return None


def classify_value(value: object) -> TagKind:
    """Okunan değere bakarak etiket türü.

    Değer okunamadıysa `UNKNOWN` döner. Sayı varsayılırsa, bir metin alanı
    grafikte sayısal eksene konur ve ekran anlamsız çıkardı.
    """
    if isinstance(value, bool):
        return TagKind.BOOLEAN
    if isinstance(value, (int, float)):
        return TagKind.GAUGE
    if isinstance(value, str):
        return TagKind.TEXT
    return TagKind.UNKNOWN


def classify(address: str, value: object = None) -> TagKind:
    """Adres ve değeri birlikte değerlendirir.

    Adı sayaca işaret eden bir sayısal etiket `COUNTER` olur: sayaçlar
    grafikte fark alınarak çizilir, anlık ölçümler doğrudan. İkisini ayırt
    etmemek, artan bir sayacı sürekli yükselen bir üretim hızı gibi
    gösterirdi.
    """
    kind = classify_value(value)
    if kind is not TagKind.GAUGE:
        return kind
    lowered = strip_prefix(address).lower()
    counters = METRIC_KEYWORDS["production_count"] + METRIC_KEYWORDS["scrap_count"]
    if any(word in lowered for word in counters):
        return TagKind.COUNTER
    return TagKind.GAUGE


def suggest_metric(address: str) -> Optional[str]:
    """Adresten metrik önerir; anlaşılamıyorsa `None`.

    Öneri kullanıcıya sunulur, sessizce uygulanmaz: yanlış eşlenen bir metrik,
    yanlış makineye yazılmış bir üretim sayısıdır.
    """
    lowered = strip_prefix(address).lower()
    for metric, keywords in METRIC_KEYWORDS.items():
        if any(word in lowered for word in keywords):
            return metric
    return None


def describe(address: str, value: object = None, unit: Optional[str] = None) -> DiscoveredTag:
    """Bulunan bir adresi etikete çevirir."""
    return DiscoveredTag(
        address=address,
        name=tag_name(address),
        kind=classify(address, value),
        value=value,
        unit=unit,
        data_type=type(value).__name__ if value is not None else None,
    )


def connection_label(endpoint: str, kind_value: str) -> str:
    """Uçtan okunur bir bağlantı adı türetir.

    `opc.tcp://192.168.1.10:4840` → `OPCUA 192.168.1.10`. Ad boş bırakılsaydı,
    listede birbirinden ayrılamayan bağlantılar olurdu.
    """
    # Şema deseni noktayı da kabul eder: OPC UA ucu `opc.tcp://` ile başlar ve
    # yalnızca harf arayan bir desen adresi "opc.tcp" diye keserdi.
    body = re.sub(r"^[\w.+-]+://", "", endpoint.strip())
    host = body.split("/")[0].split(":")[0]
    return f"{kind_value.upper()} {host}" if host else kind_value.upper()
