"""Cihaz verisinin ortak modeli.

Üç protokol (OPC UA, MQTT, REST) birbirinden çok farklı biçimlerde veri
gönderir: bir OPC UA düğümü tek bir değer, bir MQTT mesajı iç içe geçmiş bir
JSON, bir REST yanıtı bir dizi olabilir. Ekranın bunların üçünü de bilmesi
gerekmezse, protokol eklemek ekranı değiştirmeyi gerektirmez — bu yüzden
hepsi tek bir `DeviceEvent` modeline çevrilir.

Ölçüm kalitesi neden ayrı bir alan
----------------------------------
OPC UA bir değerin yanında **kalitesini** de bildirir: iyi, belirsiz ya da
bozuk. Bozuk kaliteli bir değer sayısal olarak okunabilir ama anlamlı değildir.
Kaliteyi atıp yalnızca sayıyı taşımak, arızalı bir sensörün son değerini
gerçek üretim gibi göstermek olurdu; bu yüzden kalite modele girer ve düşük
kaliteli ölçümler ekrana "ölçülemedi" olarak gider.

Zaman
-----
`at_ms` **cihazın** ya da sunucunun ölçüm anıdır ve dışarıdan verilir; bu
modülde hiçbir yerde saat okunmaz. Böylece aynı girdi her zaman aynı olayı
üretir ve testler kararlıdır.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional, Union

from simulation_engine.runtime.types import ConnectionKind


class Metric(str, Enum):
    """Bir cihazdan gelebilecek ölçüm türleri.

    Liste kapalıdır: tanınmayan bir ölçüm `UNKNOWN` olur ve tanılamaya düşer.
    Serbest metin kabul edilseydi, yazım hatası olan bir alan adı sessizce yeni
    bir ölçüm türü yaratır ve hiçbir ekranda görünmezdi.
    """

    PRODUCTION_COUNT = "production_count"
    SCRAP_COUNT = "scrap_count"
    QUEUE_LENGTH = "queue_length"
    MACHINE_STATUS = "machine_status"
    DOWNTIME_MINUTES = "downtime_minutes"
    THROUGHPUT_PER_HOUR = "throughput_per_hour"
    CYCLE_TIME_SECONDS = "cycle_time_seconds"
    OEE = "oee"
    UNKNOWN = "unknown"


METRIC_LABEL: Dict[Metric, str] = {
    Metric.PRODUCTION_COUNT: "Üretim adedi",
    Metric.SCRAP_COUNT: "Fire adedi",
    Metric.QUEUE_LENGTH: "Kuyruk uzunluğu",
    Metric.MACHINE_STATUS: "Makine durumu",
    Metric.DOWNTIME_MINUTES: "Duruş süresi (dk)",
    Metric.THROUGHPUT_PER_HOUR: "Saatlik çıktı",
    Metric.CYCLE_TIME_SECONDS: "Çevrim süresi (sn)",
    Metric.OEE: "OEE",
    Metric.UNKNOWN: "Tanınmayan ölçüm",
}

#: Sayısal olması beklenen ölçümler.
NUMERIC_METRICS = frozenset(
    {
        Metric.PRODUCTION_COUNT,
        Metric.SCRAP_COUNT,
        Metric.QUEUE_LENGTH,
        Metric.DOWNTIME_MINUTES,
        Metric.THROUGHPUT_PER_HOUR,
        Metric.CYCLE_TIME_SECONDS,
        Metric.OEE,
    }
)


class Quality(str, Enum):
    """Ölçümün güvenilirliği."""

    GOOD = "good"
    UNCERTAIN = "uncertain"
    BAD = "bad"


class MachineState(str, Enum):
    """Makinenin bildirdiği durum."""

    RUNNING = "running"
    IDLE = "idle"
    DOWN = "down"
    SETUP = "setup"
    UNKNOWN = "unknown"


MACHINE_STATE_LABEL: Dict[MachineState, str] = {
    MachineState.RUNNING: "Çalışıyor",
    MachineState.IDLE: "Boşta",
    MachineState.DOWN: "Duruş",
    MachineState.SETUP: "Ayar",
    MachineState.UNKNOWN: "Bilinmiyor",
}

#: Cihazların kullandığı yaygın durum sözcükleri.
#:
#: Eşleme sözlüğü olmadan her müşteri için ayrı kod yazmak gerekirdi; burada
#: hem Türkçe hem İngilizce yaygın karşılıklar toplanır ve tanınmayan bir
#: değer `UNKNOWN` olur (uydurulmaz).
_STATE_WORDS: Dict[str, MachineState] = {
    "run": MachineState.RUNNING,
    "running": MachineState.RUNNING,
    "calisiyor": MachineState.RUNNING,
    "çalışıyor": MachineState.RUNNING,
    "auto": MachineState.RUNNING,
    "idle": MachineState.IDLE,
    "bosta": MachineState.IDLE,
    "boşta": MachineState.IDLE,
    "wait": MachineState.IDLE,
    "down": MachineState.DOWN,
    "fault": MachineState.DOWN,
    "ariza": MachineState.DOWN,
    "arıza": MachineState.DOWN,
    "durus": MachineState.DOWN,
    "duruş": MachineState.DOWN,
    "alarm": MachineState.DOWN,
    "stop": MachineState.DOWN,
    "setup": MachineState.SETUP,
    "ayar": MachineState.SETUP,
}


def parse_machine_state(value: Any) -> MachineState:
    """Cihazın bildirdiği durumu modele çevirir.

    Sayısal kodlar da kabul edilir: 0 duruş, 1 çalışıyor, 2 boşta, 3 ayar —
    bu, PLC'lerde en yaygın kodlamadır. Tanınmayan her şey `UNKNOWN` olur;
    tahmin yürütmek, duran bir makineyi çalışıyor göstermek demek olurdu.
    """
    if isinstance(value, bool):
        return MachineState.RUNNING if value else MachineState.DOWN
    if isinstance(value, (int, float)):
        return {
            0: MachineState.DOWN,
            1: MachineState.RUNNING,
            2: MachineState.IDLE,
            3: MachineState.SETUP,
        }.get(int(value), MachineState.UNKNOWN)
    if isinstance(value, str):
        return _STATE_WORDS.get(value.strip().lower(), MachineState.UNKNOWN)
    return MachineState.UNKNOWN


DeviceValue = Union[float, int, str, bool, None]


@dataclass(frozen=True)
class DeviceEvent:
    """Bir cihazdan gelen tek bir ölçüm."""

    connection_id: str
    machine_id: str
    metric: Metric
    value: DeviceValue
    at_ms: int
    source: ConnectionKind
    quality: Quality = Quality.GOOD
    unit: Optional[str] = None
    #: Ölçümün geldiği ham adres (düğüm kimliği, konu adı, JSON alanı).
    origin: Optional[str] = None
    #: Ham yükün kısa bir özeti; sorun ararken kullanılır.
    raw: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_usable(self) -> bool:
        """Bu ölçüm ekrana yansıtılabilir mi?

        Bozuk kaliteli ya da değeri olmayan ölçümler kullanılmaz. Kullanılmayan
        bir ölçüm **atılmaz**: tanılama listesinde görünür, çünkü "veri
        gelmiyor" ile "gelen veri bozuk" farklı sorunlardır.
        """
        if self.quality is Quality.BAD or self.value is None:
            return False
        if self.metric in NUMERIC_METRICS:
            return isinstance(self.value, (int, float)) and not isinstance(
                self.value, bool
            )
        return True

    def numeric_value(self) -> Optional[float]:
        """Sayısal değer; sayısal değilse `None`."""
        if isinstance(self.value, bool) or not isinstance(self.value, (int, float)):
            return None
        return float(self.value)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "connection_id": self.connection_id,
            "machine_id": self.machine_id,
            "metric": self.metric.value,
            "value": self.value,
            "at_ms": self.at_ms,
            "source": self.source.value,
            "quality": self.quality.value,
            "unit": self.unit,
            "origin": self.origin,
            "usable": self.is_usable,
        }


@dataclass(frozen=True)
class PipelineProblem:
    """Çevrilemeyen bir yük ya da eşleşmeyen bir alan.

    Sorunlar **sessizce yutulmaz**: her biri tanılama listesine düşer ve
    arayüzde görünür. Yutulsalardı, yanlış yazılmış tek bir alan adı yüzünden
    hiç veri gelmediği fark edilmeden günler geçebilirdi.
    """

    connection_id: str
    reason: str
    at_ms: int
    #: Sorunun geldiği adres (konu, düğüm, alan).
    origin: Optional[str] = None
    #: Ham yükün kısaltılmış hâli.
    sample: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "connection_id": self.connection_id,
            "reason": self.reason,
            "at_ms": self.at_ms,
            "origin": self.origin,
            "sample": self.sample,
        }


@dataclass
class TransformResult:
    """Bir yükün çevrilmesinden çıkan olaylar ve sorunlar."""

    events: list
    problems: list

    @property
    def ok(self) -> bool:
        return len(self.problems) == 0

    @property
    def usable_events(self) -> list:
        return [event for event in self.events if event.is_usable]


def metric_from_name(name: str) -> Metric:
    """Alan adını ölçüme çevirir.

    Yaygın eş adlar kabul edilir (`count`, `adet`, `sayac`); tanınmayan ad
    `UNKNOWN` döner ve çağıran bunu tanılamaya yazar.
    """
    key = name.strip().lower().replace("-", "_").replace(" ", "_")

    aliases: Dict[str, Metric] = {
        "production_count": Metric.PRODUCTION_COUNT,
        "production": Metric.PRODUCTION_COUNT,
        "count": Metric.PRODUCTION_COUNT,
        "produced": Metric.PRODUCTION_COUNT,
        "adet": Metric.PRODUCTION_COUNT,
        "uretim": Metric.PRODUCTION_COUNT,
        "üretim": Metric.PRODUCTION_COUNT,
        "sayac": Metric.PRODUCTION_COUNT,
        "sayaç": Metric.PRODUCTION_COUNT,
        "scrap": Metric.SCRAP_COUNT,
        "scrap_count": Metric.SCRAP_COUNT,
        "fire": Metric.SCRAP_COUNT,
        "reject": Metric.SCRAP_COUNT,
        "queue": Metric.QUEUE_LENGTH,
        "queue_length": Metric.QUEUE_LENGTH,
        "kuyruk": Metric.QUEUE_LENGTH,
        "wip": Metric.QUEUE_LENGTH,
        "status": Metric.MACHINE_STATUS,
        "machine_status": Metric.MACHINE_STATUS,
        "state": Metric.MACHINE_STATUS,
        "durum": Metric.MACHINE_STATUS,
        "downtime": Metric.DOWNTIME_MINUTES,
        "downtime_minutes": Metric.DOWNTIME_MINUTES,
        "durus": Metric.DOWNTIME_MINUTES,
        "duruş": Metric.DOWNTIME_MINUTES,
        "throughput": Metric.THROUGHPUT_PER_HOUR,
        "throughput_per_hour": Metric.THROUGHPUT_PER_HOUR,
        "cycle_time": Metric.CYCLE_TIME_SECONDS,
        "cycle_time_seconds": Metric.CYCLE_TIME_SECONDS,
        "cevrim": Metric.CYCLE_TIME_SECONDS,
        "çevrim": Metric.CYCLE_TIME_SECONDS,
        "oee": Metric.OEE,
    }
    return aliases.get(key, Metric.UNKNOWN)
