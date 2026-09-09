"""Makine görüntüsü (snapshot) motoru.

Live Factory'nin **tek veri kaynağı** budur. Ekran olay akışını değil, her
makinenin son bilinen durumunu okur; böylece bir kullanıcı ekranı açtığında
geçmişi yeniden oynatmak gerekmez.

Bu modül saftır: veritabanı, saat ve ağ yoktur. Görüntü güncelleme bir
**fonksiyondur** — eski görüntü + yeni ölçüm → yeni görüntü. Böylece kalıcılık
katmanı hangi depoyu kullanırsa kullansın davranış aynıdır ve sınanabilir.

Sessiz üzerine yazma yasağı
---------------------------
Her ölçümün yanında onu **hangi bağlantının** yazdığı saklanır (`sources`).
İki kaynak aynı metriği bildirdiğinde değer yine güncellenir (en yeni ölçüm
kazanır) ama kaynağın değiştiği görülebilir ve arayüz bunu uyarı olarak
gösterir. Kaynağı saklamasaydık, OPC UA'dan gelen 1240 ile MQTT'den gelen 78
arasındaki fark sessizce kaybolurdu.

Eski ölçüm yeniyi ezmez
-----------------------
Ağ gecikmesi yüzünden bir ölçüm sırasız gelebilir. Görüntüde her metrik için
son güncelleme anı tutulur ve **daha eski** bir ölçüm yok sayılır; yok
sayılmasaydı, geciken bir paket sayacı geriye çekerdi.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from simulation_engine.runtime.pipeline.device_events import (
    DeviceEvent,
    MachineState,
    Metric,
    parse_machine_state,
)

#: Görüntüde tutulan sayısal metrikler.
SNAPSHOT_METRICS = (
    Metric.PRODUCTION_COUNT,
    Metric.SCRAP_COUNT,
    Metric.QUEUE_LENGTH,
    Metric.DOWNTIME_MINUTES,
    Metric.THROUGHPUT_PER_HOUR,
    Metric.CYCLE_TIME_SECONDS,
    Metric.OEE,
)


class StationStatus(str):
    """İstasyon durumu — arayüzün gösterdiği dört hâl artı bilinmeyen."""


#: Sprint sözleşmesindeki dört durum ve bilinmeyen.
RUNNING = "running"
IDLE = "idle"
BLOCKED = "blocked"
DOWN = "down"
UNKNOWN = "unknown"

STATION_STATUS_LABEL: Dict[str, str] = {
    RUNNING: "Çalışıyor",
    IDLE: "Boşta",
    BLOCKED: "Bloke",
    DOWN: "Duruş",
    UNKNOWN: "Bilinmiyor",
}

#: Cihazın bildirdiği durumdan istasyon durumuna eşleme.
_STATE_TO_STATUS: Dict[MachineState, str] = {
    MachineState.RUNNING: RUNNING,
    MachineState.IDLE: IDLE,
    MachineState.DOWN: DOWN,
    # Ayar (setup) üretim yapmayan ama arızalı da olmayan bir durumdur;
    # hattı besleyemediği için ekranda "Bloke" ile aynı ağırlıkta gösterilir.
    MachineState.SETUP: BLOCKED,
    MachineState.UNKNOWN: UNKNOWN,
}

#: Cihazın "bloke" bildirdiği sözcükler.
_BLOCKED_WORDS = frozenset({"blocked", "bloke", "block", "starved", "aç kaldı"})


@dataclass
class MachineSnapshotRecord:
    """Bir makinenin son bilinen durumu.

    Ölçülmemiş her alan `None`'dır. `sources` her metriği hangi bağlantının
    yazdığını, `updated` ise ne zaman yazdığını tutar.
    """

    machine_id: str
    status: str = UNKNOWN
    production_count: Optional[float] = None
    scrap_count: Optional[float] = None
    queue_length: Optional[float] = None
    downtime_minutes: Optional[float] = None
    throughput_per_hour: Optional[float] = None
    cycle_time_seconds: Optional[float] = None
    oee: Optional[float] = None
    #: Metrik → yazan bağlantı kimliği.
    sources: Dict[str, str] = field(default_factory=dict)
    #: Metrik → son güncelleme anı (ms).
    updated: Dict[str, int] = field(default_factory=dict)
    sample_count: int = 0
    updated_at_ms: int = 0

    def value_of(self, metric: Metric) -> Optional[float]:
        return getattr(self, metric.value, None)

    def to_dict(self) -> Dict[str, object]:
        return {
            "machine_id": self.machine_id,
            "status": self.status,
            "status_label": STATION_STATUS_LABEL.get(self.status, STATION_STATUS_LABEL[UNKNOWN]),
            "production_count": self.production_count,
            "scrap_count": self.scrap_count,
            "queue_length": self.queue_length,
            "downtime_minutes": self.downtime_minutes,
            "throughput_per_hour": self.throughput_per_hour,
            "cycle_time_seconds": self.cycle_time_seconds,
            "oee": self.oee,
            "sources": dict(self.sources),
            "sample_count": self.sample_count,
            "updated_at_ms": self.updated_at_ms,
        }


def status_from_event(event: DeviceEvent) -> str:
    """Durum ölçümünü istasyon durumuna çevirir.

    Cihazın "bloke" dediği sözcükler ayrıca aranır: `MachineState` modelinde
    bloke ayrı bir hâl değildir ama üretimde en sık görülen duruşlardan biridir
    ve ekranda arızadan ayrılmalıdır (bloke bir makine sağlamdır, önü doludur).
    """
    if isinstance(event.value, str) and event.value.strip().lower() in _BLOCKED_WORDS:
        return BLOCKED
    return _STATE_TO_STATUS[parse_machine_state(event.value)]


def apply_event(
    snapshot: Optional[MachineSnapshotRecord], event: DeviceEvent
) -> MachineSnapshotRecord:
    """Ölçümü görüntüye işler ve **yeni** görüntüyü döndürür.

    Kullanılamayan (bozuk kaliteli, sayısal olmayan) ölçümler görüntüyü
    değiştirmez: ekrandaki son geçerli değer, bozuk bir okumayla silinmemelidir.
    """
    current = snapshot or MachineSnapshotRecord(machine_id=event.machine_id)

    if not event.is_usable:
        return current

    key = event.metric.value
    previous_at = current.updated.get(key)
    if previous_at is not None and event.at_ms < previous_at:
        # Sırasız gelen eski ölçüm: sayacı geriye çekmemek için yok sayılır.
        return current

    updated = MachineSnapshotRecord(
        machine_id=current.machine_id,
        status=current.status,
        production_count=current.production_count,
        scrap_count=current.scrap_count,
        queue_length=current.queue_length,
        downtime_minutes=current.downtime_minutes,
        throughput_per_hour=current.throughput_per_hour,
        cycle_time_seconds=current.cycle_time_seconds,
        oee=current.oee,
        sources=dict(current.sources),
        updated=dict(current.updated),
        sample_count=current.sample_count + 1,
        updated_at_ms=max(current.updated_at_ms, event.at_ms),
    )

    if event.metric is Metric.MACHINE_STATUS:
        updated.status = status_from_event(event)
    elif event.metric in SNAPSHOT_METRICS:
        setattr(updated, key, event.numeric_value())

    updated.sources[key] = event.connection_id
    updated.updated[key] = event.at_ms
    return updated


def apply_events(
    snapshots: Dict[str, MachineSnapshotRecord], events: List[DeviceEvent]
) -> Dict[str, MachineSnapshotRecord]:
    """Bir olay listesini görüntülere işler."""
    result = dict(snapshots)
    for event in events:
        result[event.machine_id] = apply_event(result.get(event.machine_id), event)
    return result


def conflicting_metrics(
    snapshot: MachineSnapshotRecord, event: DeviceEvent
) -> Optional[str]:
    """Bu ölçüm başka bir bağlantının yazdığı metriği mi eziyor?

    Ezme **engellenmez** — hangi kaynağın doğru olduğunu ürün bilemez — ama
    sessiz kalmaz: çağıran bu bilgiyi uyarıya çevirir.
    """
    previous = snapshot.sources.get(event.metric.value)
    if previous is None or previous == event.connection_id:
        return None
    return previous


@dataclass
class LiveKpi:
    """Canlı üretim ekranının KPI kartları.

    Ölçülemeyen her alan `None`'dır ve ekranda "—" görünür. Toplamlar yalnızca
    **ölçümü olan** makinelerden alınır; ölçümü olmayanı sıfır saymak, hattın
    üretimini olduğundan düşük gösterirdi.
    """

    production: Optional[float]
    scrap: Optional[float]
    queue: Optional[float]
    throughput: Optional[float]
    #: Çalışan makine oranı (0-1); hiç durum bildirilmemişse `None`.
    availability: Optional[float]
    downtime_minutes: Optional[float]
    active_machines: int
    total_machines: int
    #: Durumu bilinmeyen makine sayısı.
    unknown_machines: int
    #: Ölçümü olan makine sayısı (üretim sayacı gelenler).
    measured_machines: int

    def to_dict(self) -> Dict[str, object]:
        return {
            "production": self.production,
            "scrap": self.scrap,
            "queue": self.queue,
            "throughput": self.throughput,
            "availability": self.availability,
            "downtime_minutes": self.downtime_minutes,
            "active_machines": self.active_machines,
            "total_machines": self.total_machines,
            "unknown_machines": self.unknown_machines,
            "measured_machines": self.measured_machines,
        }


def _sum_or_none(values: List[Optional[float]]) -> Optional[float]:
    """Ölçümü olanların toplamı; hiç ölçüm yoksa `None`."""
    measured = [value for value in values if value is not None]
    return sum(measured) if measured else None


def aggregate_kpi(snapshots: Dict[str, MachineSnapshotRecord]) -> LiveKpi:
    """Görüntülerden KPI hesaplar."""
    items = list(snapshots.values())

    known_status = [item for item in items if item.status != UNKNOWN]
    running = [item for item in items if item.status == RUNNING]

    return LiveKpi(
        production=_sum_or_none([item.production_count for item in items]),
        scrap=_sum_or_none([item.scrap_count for item in items]),
        queue=_sum_or_none([item.queue_length for item in items]),
        throughput=_sum_or_none([item.throughput_per_hour for item in items]),
        # Kullanılabilirlik yalnızca durumu **bildirilen** makineler üzerinden
        # hesaplanır; bilinmeyenleri duruş saymak, izlenmeyen bir hattı arızalı
        # göstermek olurdu.
        availability=(len(running) / len(known_status)) if known_status else None,
        downtime_minutes=_sum_or_none([item.downtime_minutes for item in items]),
        active_machines=len(running),
        total_machines=len(items),
        unknown_machines=len([item for item in items if item.status == UNKNOWN]),
        measured_machines=len(
            [item for item in items if item.production_count is not None]
        ),
    )


def stale_snapshots(
    snapshots: Dict[str, MachineSnapshotRecord], now_ms: int, max_age_ms: int
) -> List[str]:
    """Belirtilen süredir güncellenmeyen makineler.

    "Veri akıyor" ile "veri akıyordu" farklıdır: bir makineden yarım saattir
    ölçüm gelmiyorsa ekrandaki değer eskidir ve bu söylenmelidir.
    """
    return sorted(
        machine_id
        for machine_id, snapshot in snapshots.items()
        if snapshot.updated_at_ms > 0 and (now_ms - snapshot.updated_at_ms) > max_age_ms
    )
