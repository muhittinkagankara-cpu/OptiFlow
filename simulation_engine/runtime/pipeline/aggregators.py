"""Üretim metriklerinin gerçek cihaz verisinden hesaplanması.

Kural değişmez: **ölçülemeyen alan `None`'dır, sıfır değil.** Bir hattın
üretim sayacı hiç gelmediyse ekranda "0 parça" yazmak, duran bir hattı çalışan
bir hattan ayırt edilemez kılar. Bu modüldeki her işlev, veri yoksa `None`
döndürür ve nedeni `MachineSnapshot.notes` içinde yazar.

Sayaç mı, artış mı
------------------
Cihazların çoğu **kümülatif** bir sayaç yayınlar (vardiya başından beri 1240
parça). İki okuma arasındaki fark üretimi verir. Sayaç sıfırlandığında (vardiya
değişimi, PLC yeniden başlatma) fark negatif çıkar; bu durumda artış
**bilinmiyor** sayılır — negatif üretim yazmak ya da farkı mutlak değere
çevirmek, sıfırlama anında sahte bir üretim patlaması gösterirdi.
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

#: Çıktı hesabı için gereken en az örnek sayısı.
#:
#: Tek bir okumadan hız hesaplanamaz: iki nokta olmadan zaman farkı yoktur.
MIN_THROUGHPUT_SAMPLES = 2

#: Çıktı hesabında kabul edilen en kısa zaman aralığı (ms).
#:
#: Çok kısa aralıklarda küçük bir ölçüm gürültüsü saatlik çıktıyı yüzlerce kat
#: şişirir; bu yüzden bir dakikadan kısa aralıklarda hız hesaplanmaz.
MIN_THROUGHPUT_WINDOW_MS = 60_000


@dataclass
class MachineSnapshot:
    """Bir makinenin gerçek veriden çıkarılan durumu.

    Bütün sayısal alanlar `Optional`: ölçüm yoksa `None` kalır ve arayüz
    "Doğrulanmadı" yazar.
    """

    machine_id: str
    production_count: Optional[float] = None
    scrap_count: Optional[float] = None
    queue_length: Optional[float] = None
    state: MachineState = MachineState.UNKNOWN
    downtime_minutes: Optional[float] = None
    throughput_per_hour: Optional[float] = None
    cycle_time_seconds: Optional[float] = None
    oee: Optional[float] = None
    #: Son ölçüm anı; hiç ölçüm yoksa `None`.
    last_seen_ms: Optional[int] = None
    #: Kaç ölçüm işlendi?
    sample_count: int = 0
    #: Hesaplanamayan alanların nedenleri.
    notes: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, object]:
        return {
            "machine_id": self.machine_id,
            "production_count": self.production_count,
            "scrap_count": self.scrap_count,
            "queue_length": self.queue_length,
            "state": self.state.value,
            "downtime_minutes": self.downtime_minutes,
            "throughput_per_hour": self.throughput_per_hour,
            "cycle_time_seconds": self.cycle_time_seconds,
            "oee": self.oee,
            "last_seen_ms": self.last_seen_ms,
            "sample_count": self.sample_count,
            "notes": dict(self.notes),
        }


def _numeric_series(events: List[DeviceEvent], metric: Metric) -> List[DeviceEvent]:
    """Belirli bir ölçümün kullanılabilir okumaları, zamana göre sıralı."""
    series = [
        event
        for event in events
        if event.metric is metric and event.is_usable and event.numeric_value() is not None
    ]
    return sorted(series, key=lambda event: event.at_ms)


def latest_value(events: List[DeviceEvent], metric: Metric) -> Optional[float]:
    """Ölçümün son değeri; hiç okuma yoksa `None`."""
    series = _numeric_series(events, metric)
    return series[-1].numeric_value() if series else None


def production_delta(events: List[DeviceEvent]) -> Optional[float]:
    """İki okuma arasındaki üretim artışı.

    Tek okuma varsa artış bilinmez (`None`). Sayaç geri gitmişse de `None`:
    sıfırlanan bir sayaçtan üretim çıkarmak, olmayan bir üretimi raporlamak
    olurdu.
    """
    series = _numeric_series(events, Metric.PRODUCTION_COUNT)
    if len(series) < 2:
        return None
    first = series[0].numeric_value() or 0.0
    last = series[-1].numeric_value() or 0.0
    delta = last - first
    return delta if delta >= 0 else None


def throughput_per_hour(events: List[DeviceEvent]) -> Optional[float]:
    """Saatlik çıktı.

    Cihaz doğrudan bildiriyorsa o değer kullanılır; bildirmiyorsa üretim
    sayacındaki artıştan hesaplanır. İkisi de yoksa `None`.
    """
    reported = latest_value(events, Metric.THROUGHPUT_PER_HOUR)
    if reported is not None:
        return reported

    series = _numeric_series(events, Metric.PRODUCTION_COUNT)
    if len(series) < MIN_THROUGHPUT_SAMPLES:
        return None

    window_ms = series[-1].at_ms - series[0].at_ms
    if window_ms < MIN_THROUGHPUT_WINDOW_MS:
        return None

    delta = production_delta(events)
    if delta is None:
        return None

    return delta / (window_ms / 3_600_000)


def machine_state(events: List[DeviceEvent]) -> MachineState:
    """Makinenin son bildirilen durumu; bildirilmediyse `UNKNOWN`."""
    statuses = [
        event
        for event in events
        if event.metric is Metric.MACHINE_STATUS and event.quality.value != "bad"
    ]
    if not statuses:
        return MachineState.UNKNOWN
    latest = max(statuses, key=lambda event: event.at_ms)
    return parse_machine_state(latest.value)


def snapshot_for(machine_id: str, events: List[DeviceEvent]) -> MachineSnapshot:
    """Tek bir makinenin görüntüsü."""
    own = [event for event in events if event.machine_id == machine_id]
    usable = [event for event in own if event.is_usable]

    snapshot = MachineSnapshot(
        machine_id=machine_id,
        production_count=latest_value(own, Metric.PRODUCTION_COUNT),
        scrap_count=latest_value(own, Metric.SCRAP_COUNT),
        queue_length=latest_value(own, Metric.QUEUE_LENGTH),
        state=machine_state(own),
        downtime_minutes=latest_value(own, Metric.DOWNTIME_MINUTES),
        throughput_per_hour=throughput_per_hour(own),
        cycle_time_seconds=latest_value(own, Metric.CYCLE_TIME_SECONDS),
        oee=latest_value(own, Metric.OEE),
        last_seen_ms=max((event.at_ms for event in usable), default=None),
        sample_count=len(usable),
    )

    if snapshot.production_count is None:
        snapshot.notes["production_count"] = "Üretim sayacı bu makineden hiç gelmedi."
    if snapshot.queue_length is None:
        snapshot.notes["queue_length"] = "Kuyruk ölçümü bu makineden hiç gelmedi."
    if snapshot.state is MachineState.UNKNOWN:
        snapshot.notes["state"] = "Makine durumu bildirilmedi."
    if snapshot.throughput_per_hour is None:
        series = _numeric_series(own, Metric.PRODUCTION_COUNT)
        if len(series) < MIN_THROUGHPUT_SAMPLES:
            snapshot.notes["throughput_per_hour"] = (
                "Hız için en az iki üretim okuması gerekiyor."
            )
        else:
            snapshot.notes["throughput_per_hour"] = (
                "Okumalar arasındaki süre bir dakikadan kısa; hız hesaplanmadı."
            )
    if snapshot.downtime_minutes is None:
        snapshot.notes["downtime_minutes"] = "Duruş süresi bildirilmedi."

    return snapshot


def aggregate(events: List[DeviceEvent]) -> Dict[str, MachineSnapshot]:
    """Bütün makinelerin görüntüsü."""
    machines = sorted({event.machine_id for event in events})
    return {machine: snapshot_for(machine, events) for machine in machines}


@dataclass
class LineTotals:
    """Hat toplamları; ölçülemeyen toplam `None`."""

    production_count: Optional[float]
    scrap_count: Optional[float]
    machines_running: int
    machines_down: int
    machines_unknown: int
    measured_machines: int
    total_machines: int


def line_totals(snapshots: Dict[str, MachineSnapshot]) -> LineTotals:
    """Hattın toplamları.

    Toplam yalnızca **ölçümü olan** makinelerden alınır; ölçümü olmayanı sıfır
    saymak, hattın üretimini gerçekte olduğundan düşük gösterirdi. Hiçbir
    makinenin ölçümü yoksa toplam `None` olur.
    """
    produced = [
        snapshot.production_count
        for snapshot in snapshots.values()
        if snapshot.production_count is not None
    ]
    scrapped = [
        snapshot.scrap_count
        for snapshot in snapshots.values()
        if snapshot.scrap_count is not None
    ]

    return LineTotals(
        production_count=sum(produced) if produced else None,
        scrap_count=sum(scrapped) if scrapped else None,
        machines_running=len(
            [s for s in snapshots.values() if s.state is MachineState.RUNNING]
        ),
        machines_down=len([s for s in snapshots.values() if s.state is MachineState.DOWN]),
        machines_unknown=len(
            [s for s in snapshots.values() if s.state is MachineState.UNKNOWN]
        ),
        measured_machines=len(produced),
        total_machines=len(snapshots),
    )
