"""Runtime KPI motoru.

Ekrandaki her sayı burada hesaplanır ve **ölçüme dayanır**. Kural değişmez:
ölçülemeyen alan `None` döner, sıfır yazılmaz.

İki girdi
---------
* **Makine görüntüleri** — son bilinen değerler (üretim sayacı, kuyruk, durum).
* **Olay geçmişi** — zaman içindeki değişim. Hız (throughput) ancak buradan
  çıkar: tek bir görüntüden hız hesaplanamaz, iki nokta olmadan zaman farkı
  yoktur.

NaN ve sonsuz
-------------
Bir bölme sonucu `NaN` ya da `Infinity` çıkarsa değer **ölçülmemiş** sayılır.
Ekranda "NaN" görmek, kullanıcının bütün sayılara olan güvenini bir anda
bitirir; bu yüzden her çıktı `is_finite_number` ile süzülür.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

from simulation_engine.runtime.persistence.snapshots import (
    BLOCKED,
    DOWN,
    RUNNING,
    UNKNOWN,
    MachineSnapshotRecord,
)

#: Hız hesabı için gereken en kısa pencere (ms).
#:
#: Daha kısa aralıklarda tek bir ölçüm gürültüsü saatlik çıktıyı yüzlerce kat
#: şişirir; bir dakika, sahadaki en hızlı hatta bile anlamlı bir taban verir.
MIN_THROUGHPUT_WINDOW_MS = 60_000


def is_finite_number(value: Optional[float]) -> bool:
    """Değer gerçek bir ölçüm mü? (`None`, `NaN` ve sonsuz değil)"""
    if value is None:
        return False
    return isinstance(value, (int, float)) and math.isfinite(value)


def _clean(value: Optional[float]) -> Optional[float]:
    """`NaN`/sonsuz değerleri ölçülmemiş sayar."""
    return value if is_finite_number(value) else None


def _sum_or_none(values: Iterable[Optional[float]]) -> Optional[float]:
    """Ölçümü olanların toplamı; hiç ölçüm yoksa `None`."""
    measured = [value for value in values if is_finite_number(value)]
    return sum(measured) if measured else None  # type: ignore[arg-type]


@dataclass(frozen=True)
class ProductionSample:
    """Bir makinenin belirli bir andaki üretim sayacı."""

    machine_id: str
    at_ms: int
    value: float


@dataclass(frozen=True)
class KpiInput:
    """KPI hesabının girdisi."""

    snapshots: List[MachineSnapshotRecord] = field(default_factory=list)
    #: Üretim sayacının zaman içindeki okumaları (hız için).
    production_samples: List[ProductionSample] = field(default_factory=list)
    #: Etkin alarm sayısı; alarm motoru verir.
    active_alarms: int = 0
    open_alarms: int = 0
    #: Ölçülen toplam duruş (ms); duruş takibi verir.
    downtime_ms: Optional[float] = None
    now_ms: int = 0


@dataclass
class KpiSnapshot:
    """Ekrandaki KPI kartları. Ölçülemeyen alan `None`."""

    production: Optional[float]
    scrap: Optional[float]
    queue: Optional[float]
    throughput: Optional[float]
    availability: Optional[float]
    downtime_minutes: Optional[float]
    active_machines: int
    blocked_machines: int
    down_machines: int
    unknown_machines: int
    total_machines: int
    measured_machines: int
    alarm_count: int
    open_alarm_count: int
    #: Hesaplanamayan alanların nedenleri.
    reasons: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, object]:
        return {
            "production": self.production,
            "scrap": self.scrap,
            "queue": self.queue,
            "throughput": self.throughput,
            "availability": self.availability,
            "downtime_minutes": self.downtime_minutes,
            "active_machines": self.active_machines,
            "blocked_machines": self.blocked_machines,
            "down_machines": self.down_machines,
            "unknown_machines": self.unknown_machines,
            "total_machines": self.total_machines,
            "measured_machines": self.measured_machines,
            "alarm_count": self.alarm_count,
            "open_alarm_count": self.open_alarm_count,
            "reasons": dict(self.reasons),
        }


def production_total(snapshots: Iterable[MachineSnapshotRecord]) -> Optional[float]:
    """Ölçümü olan makinelerin üretim toplamı."""
    return _sum_or_none(snapshot.production_count for snapshot in snapshots)


def queue_total(snapshots: Iterable[MachineSnapshotRecord]) -> Optional[float]:
    return _sum_or_none(snapshot.queue_length for snapshot in snapshots)


def scrap_total(snapshots: Iterable[MachineSnapshotRecord]) -> Optional[float]:
    return _sum_or_none(snapshot.scrap_count for snapshot in snapshots)


def active_machines(snapshots: Iterable[MachineSnapshotRecord]) -> int:
    return len([item for item in snapshots if item.status == RUNNING])


def alarm_count(active: int, open_alarms: int) -> Dict[str, int]:
    """Alarm sayaçları; ölçülmüş sıfır anlamlıdır."""
    return {"active": max(0, active), "open": max(0, open_alarms)}


def throughput_per_hour(
    samples: List[ProductionSample], now_ms: int
) -> Optional[float]:
    """Saatlik çıktı — üretim sayacındaki artıştan.

    Makine başına ayrı hesaplanır ve toplanır: iki makinenin sayaçlarını tek
    bir seriye karıştırmak, biri sıfırlandığında hattı olduğundan yavaş
    gösterirdi.

    Sayaç geri gitmişse (vardiya değişimi, PLC yeniden başlatma) o makine
    hesaba **katılmaz**; artışı mutlak değere çevirmek sahte bir üretim
    patlaması üretirdi.
    """
    if not samples:
        return None

    by_machine: Dict[str, List[ProductionSample]] = {}
    for sample in samples:
        if not is_finite_number(sample.value):
            continue
        by_machine.setdefault(sample.machine_id, []).append(sample)

    rates: List[float] = []
    for machine_samples in by_machine.values():
        ordered = sorted(machine_samples, key=lambda item: item.at_ms)
        if len(ordered) < 2:
            continue

        window_ms = ordered[-1].at_ms - ordered[0].at_ms
        if window_ms < MIN_THROUGHPUT_WINDOW_MS:
            continue

        delta = ordered[-1].value - ordered[0].value
        if delta < 0:
            continue

        rates.append(delta / (window_ms / 3_600_000))

    return sum(rates) if rates else None


def downtime_minutes(downtime_ms: Optional[float]) -> Optional[float]:
    """Duruş süresi (dk); ölçülmediyse `None`."""
    cleaned = _clean(downtime_ms)
    return None if cleaned is None else cleaned / 60_000


def availability_ratio(
    planned_time_ms: Optional[float], downtime_ms: Optional[float]
) -> Optional[float]:
    """Kullanılabilirlik; OEE motorunun formülünü kullanır."""
    from simulation_engine.runtime.oee.availability import availability

    return availability(planned_time_ms, downtime_ms)


def compute_kpi(
    data: KpiInput, planned_time_ms: Optional[float] = None
) -> KpiSnapshot:
    """Bütün KPI'ları hesaplar."""
    snapshots = list(data.snapshots)
    reasons: Dict[str, str] = {}

    production = _clean(production_total(snapshots))
    if production is None:
        reasons["production"] = "Hiçbir makineden üretim sayacı gelmedi."

    queue = _clean(queue_total(snapshots))
    if queue is None:
        reasons["queue"] = "Hiçbir makineden kuyruk ölçümü gelmedi."

    throughput = _clean(throughput_per_hour(data.production_samples, data.now_ms))
    if throughput is None:
        reasons["throughput"] = (
            "Hız için en az iki üretim okuması ve bir dakikadan uzun bir pencere gerekiyor."
        )

    downtime = downtime_minutes(data.downtime_ms)
    if downtime is None:
        reasons["downtime"] = "Duruş süresi ölçülmedi."

    availability = _clean(availability_ratio(planned_time_ms, data.downtime_ms))
    if availability is None:
        reasons["availability"] = (
            "Kullanılabilirlik için planlanan süre ve ölçülmüş duruş gerekiyor."
        )

    counts = alarm_count(data.active_alarms, data.open_alarms)

    return KpiSnapshot(
        production=production,
        scrap=_clean(scrap_total(snapshots)),
        queue=queue,
        throughput=throughput,
        availability=availability,
        downtime_minutes=downtime,
        active_machines=active_machines(snapshots),
        blocked_machines=len([item for item in snapshots if item.status == BLOCKED]),
        down_machines=len([item for item in snapshots if item.status == DOWN]),
        unknown_machines=len([item for item in snapshots if item.status == UNKNOWN]),
        total_machines=len(snapshots),
        measured_machines=len(
            [item for item in snapshots if is_finite_number(item.production_count)]
        ),
        alarm_count=counts["active"],
        open_alarm_count=counts["open"],
        reasons=reasons,
    )
