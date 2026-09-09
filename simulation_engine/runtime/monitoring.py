"""Üretim izleme merkezi — alarm, duruş, OEE ve KPI'ın tek buluşma noktası.

Neden tek merkez
----------------
SALES-11 sonunda alarmlar üç ayrı yerde üretiliyordu: Live Factory ekranı kendi
eşiğine göre, alarm listesi kendi listesine göre, runtime panosu ise bağlantı
durumuna göre. Aynı arıza üç farklı ekranda üç farklı biçimde görünüyordu:
birinde açık, birinde kapalı, birinde hiç yok. Operatör hangisine bakacağını
bilemez ve sonunda hiçbirine bakmaz.

Bu modül tek bir gerçeği üretir. Üç ekran da buradan okur; birinde onaylanan
alarm ötekinde de onaylı görünür.

Sıralama önemlidir
------------------
`observe` önce **duruşu** işler, sonra alarmı değerlendirir. Ters sırada
çalışsaydı, bir makinenin durduğu an üretilen alarm henüz açılmamış bir duruşa
işaret eder ve "makine durdu ama duruş süresi yok" gibi bir çelişki doğardı.

Saat dışarıdan gelir
--------------------
Hiçbir işlev sistem saatini okumaz. Okusaydı, aynı testin sabahleyin geçip
gece yarısı düşmesi mümkün olurdu; vardiya sınırına denk gelen hesaplar zaten
en kırılgan olanlardır.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, Iterable, List, Optional

from simulation_engine.runtime.alarms import (
    AlarmEvaluator,
    AlarmState,
    AlarmThresholds,
    ConnectionView,
)
from simulation_engine.runtime.kpi import KpiInput, KpiSnapshot, ProductionSample, compute_kpi
from simulation_engine.runtime.oee import OeeInput, OeeResult, compute_oee
from simulation_engine.runtime.persistence.downtime import (
    UNKNOWN_REASON,
    DowntimeEvent,
    DowntimeTracker,
)
from simulation_engine.runtime.persistence.snapshots import (
    BLOCKED,
    DOWN,
    RUNNING,
    MachineSnapshotRecord,
)

#: Hız hesabı için saklanan en fazla üretim okuması (makine başına).
#:
#: Sınırsız bırakılsaydı günlerce çalışan bir süreçte liste milyonlarca
#: kayda çıkardı; hız için yalnızca pencerenin iki ucu gerekir ama arada
#: sayaç sıfırlanmasını görebilmek için birkaç yüz nokta yeterlidir.
MAX_PRODUCTION_SAMPLES = 240

#: Duruş nedeni bildirilmediğinde yazılan neden.
DEFAULT_DOWNTIME_REASON = UNKNOWN_REASON


@dataclass
class MonitoringCenter:
    """Alarm, duruş ve KPI'ı birlikte yürüten merkez."""

    alarms: AlarmEvaluator = field(default_factory=AlarmEvaluator)
    downtime: DowntimeTracker = field(default_factory=DowntimeTracker)
    #: Makine başına üretim sayacı okumaları (hız hesabı için).
    samples: Dict[str, List[ProductionSample]] = field(default_factory=dict)
    #: Duruş kaydı değiştiğinde çağrılır; yönetici bunu diske yazar.
    on_downtime: Optional[Callable[[DowntimeEvent], None]] = None

    # -- Gözlem -------------------------------------------------------------

    def observe(
        self,
        snapshots: Iterable[MachineSnapshotRecord],
        connections: Iterable[ConnectionView],
        now_ms: int,
    ) -> Dict[str, object]:
        """Yeni durumu işler: duruş, sonra alarm.

        Dönen sözlük yalnızca **değişimi** anlatır; bütün alarm listesi için
        `state` kullanılır. Her çağrıda tüm listeyi döndürmek, saniyede bir
        çalışan bir döngüde arayüzü gereksizce yeniden çizerdi.
        """
        machines = list(snapshots)

        downtime_changes: List[DowntimeEvent] = []
        for machine in machines:
            self._record_sample(machine)
            changed = self.downtime.observe(
                machine.machine_id,
                machine.status,
                now_ms,
                reason=DEFAULT_DOWNTIME_REASON,
                source=self._source_of(machine),
            )
            if changed is not None:
                downtime_changes.append(changed)
                if self.on_downtime is not None:
                    self.on_downtime(changed)

        alarm_changes = self.alarms.evaluate(machines, connections, now_ms)

        return {
            "alarms": alarm_changes,
            "downtime_changes": len(downtime_changes),
            "open_downtime": self.downtime.open_count(),
        }

    def _record_sample(self, machine: MachineSnapshotRecord) -> None:
        """Üretim sayacının bu andaki değerini saklar.

        Ölçüm yoksa hiçbir şey saklanmaz: eksik okumayı sıfır diye kaydetmek,
        sonraki okumada sayaç sıçraması gibi görünür ve hızı olduğundan yüksek
        gösterirdi.
        """
        if machine.production_count is None or machine.updated_at_ms is None:
            return
        bucket = self.samples.setdefault(machine.machine_id, [])
        if bucket and bucket[-1].at_ms == machine.updated_at_ms:
            return
        bucket.append(
            ProductionSample(
                machine_id=machine.machine_id,
                at_ms=machine.updated_at_ms,
                value=machine.production_count,
            )
        )
        if len(bucket) > MAX_PRODUCTION_SAMPLES:
            del bucket[0 : len(bucket) - MAX_PRODUCTION_SAMPLES]

    @staticmethod
    def _source_of(machine: MachineSnapshotRecord) -> Optional[str]:
        """Duruşu bildiren bağlantı; bilinmiyorsa `None`."""
        sources = machine.sources or {}
        return sources.get("status") or next(iter(sources.values()), None)

    # -- Okuma --------------------------------------------------------------

    def all_samples(self) -> List[ProductionSample]:
        return [sample for bucket in self.samples.values() for sample in bucket]

    def kpi(
        self,
        snapshots: Iterable[MachineSnapshotRecord],
        now_ms: int,
        planned_time_ms: Optional[float] = None,
    ) -> KpiSnapshot:
        """KPI kartları; ölçülemeyen alan `None` döner."""
        return compute_kpi(
            KpiInput(
                snapshots=list(snapshots),
                production_samples=self.all_samples(),
                active_alarms=self.alarms.active_count,
                open_alarms=self.alarms.open_count,
                downtime_ms=self.downtime.total_ms(now_ms),
                now_ms=now_ms,
            ),
            planned_time_ms=planned_time_ms,
        )

    def oee(
        self,
        snapshots: Iterable[MachineSnapshotRecord],
        now_ms: int,
        planned_time_ms: Optional[float] = None,
        ideal_cycle_seconds: Optional[float] = None,
    ) -> OeeResult:
        """Hattın OEE'si.

        Planlanan süre ya da ideal çevrim bilinmiyorsa OEE **hesaplanmaz**;
        varsayılan bir vardiya süresi uydurmak, ölçülmemiş bir sayıyı ölçülmüş
        gibi göstermek olurdu.
        """
        machines = list(snapshots)
        good = _sum_optional(machine.production_count for machine in machines)
        scrap = _sum_optional(machine.scrap_count for machine in machines)

        return compute_oee(
            OeeInput(
                planned_time_ms=planned_time_ms,
                downtime_ms=self.downtime.total_ms(now_ms),
                good_parts=good,
                scrap_parts=scrap,
                ideal_cycle_seconds=ideal_cycle_seconds,
            )
        )

    def machine_oee(
        self,
        machine: MachineSnapshotRecord,
        now_ms: int,
        planned_time_ms: Optional[float] = None,
        ideal_cycle_seconds: Optional[float] = None,
    ) -> OeeResult:
        """Tek makinenin OEE'si; duruşu yalnızca o makineden alınır."""
        return compute_oee(
            OeeInput(
                planned_time_ms=planned_time_ms,
                downtime_ms=self.downtime.total_for(machine.machine_id, now_ms),
                good_parts=machine.production_count,
                scrap_parts=machine.scrap_count,
                ideal_cycle_seconds=ideal_cycle_seconds,
            )
        )

    def timeline(self, now_ms: int, limit: int = 100) -> List[Dict[str, object]]:
        """Duruşlar ve alarmlar, zamana göre tek bir akışta.

        İki ayrı liste yerine tek akış: bir operatör "makine neden durdu?"
        sorusunun yanıtını, duruşun hemen öncesindeki alarmda bulur. Listeler
        ayrı olsaydı bu eşleştirmeyi kafasında yapması gerekirdi.
        """
        rows: List[Dict[str, object]] = []

        for event in self.downtime.all_events():
            rows.append(
                {
                    "type": "downtime",
                    "at_ms": event.start_ms,
                    "end_ms": event.end_ms,
                    "machine_id": event.machine_id,
                    "duration_ms": event.duration_ms(now_ms),
                    "reason": event.reason,
                    "source": event.source,
                    "open": event.is_open,
                }
            )

        state = self.alarms.snapshot(now_ms)
        for alarm in [*state["active"], *state["history"]]:  # type: ignore[index]
            rows.append(
                {
                    "type": "alarm",
                    "at_ms": alarm["raised_at_ms"],
                    "end_ms": alarm.get("resolved_at_ms"),
                    "machine_id": alarm.get("subject"),
                    "duration_ms": alarm.get("duration_ms"),
                    "reason": alarm.get("message"),
                    "severity": alarm.get("severity"),
                    "state": alarm.get("state"),
                    "open": alarm.get("state") != AlarmState.RESOLVED.value,
                }
            )

        rows.sort(key=lambda item: item["at_ms"], reverse=True)
        return rows[:limit]

    def production_status(
        self,
        snapshots: Iterable[MachineSnapshotRecord],
        now_ms: int,
        planned_time_ms: Optional[float] = None,
        ideal_cycle_seconds: Optional[float] = None,
    ) -> Dict[str, object]:
        """Operatör panosunun "Üretim Durumu" kartı.

        Operatörün vardiya başında bakacağı beş sayı: OEE, etkin alarm,
        çalışan makine, bloke makine ve bugünkü duruş.
        """
        machines = list(snapshots)
        kpi = self.kpi(machines, now_ms, planned_time_ms)
        oee = self.oee(machines, now_ms, planned_time_ms, ideal_cycle_seconds)

        return {
            "oee": oee.oee,
            "oee_percent": oee.as_percent()["oee"],
            "oee_reasons": dict(oee.reasons),
            "active_alarms": self.alarms.active_count,
            "open_alarms": self.alarms.open_count,
            "running_machines": len(
                [item for item in machines if item.status == RUNNING]
            ),
            "blocked_machines": len(
                [item for item in machines if item.status == BLOCKED]
            ),
            "down_machines": len([item for item in machines if item.status == DOWN]),
            "total_machines": len(machines),
            "downtime_minutes": kpi.downtime_minutes,
            "open_downtime": self.downtime.open_count(),
            "reasons": dict(kpi.reasons),
        }

    def state(self, now_ms: int) -> Dict[str, object]:
        """Alarm merkezi ekranının okuduğu tam durum."""
        return self.alarms.snapshot(now_ms)

    def load_downtime(self, events: Iterable[DowntimeEvent]) -> int:
        """Diskten okunan duruşları belleğe alır (kurtarma)."""
        return self.downtime.load(events)

    def clear(self) -> None:
        self.downtime.clear()
        self.samples.clear()


def _sum_optional(values: Iterable[Optional[float]]) -> Optional[float]:
    """Ölçümü olanların toplamı; hiç ölçüm yoksa `None`."""
    measured = [value for value in values if value is not None]
    return sum(measured) if measured else None
