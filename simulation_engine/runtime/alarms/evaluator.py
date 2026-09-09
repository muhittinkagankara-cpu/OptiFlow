"""Alarm değerlendiricisi — kurallar ile depo arasındaki tek köprü.

Girdi: makine görüntüleri ve bağlantı durumları. Çıktı: depoya işlenmiş
alarmlar. Değerlendirme **tam** yapılır: her çağrıda bütün adaylar yeniden
üretilir ve depo, listede olmayan alarmları kapatır. Artımlı çalışsaydı,
kaçırılan tek bir "sorun bitti" sinyali alarmı sonsuza kadar açık bırakırdı.

Saat dışarıdan gelir; bu modülde hiçbir yerde okunmaz.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional

from simulation_engine.runtime.alarms.repository import AlarmStore
from simulation_engine.runtime.alarms.rules import (
    AlarmThresholds,
    evaluate_snapshot,
    runtime_disconnected,
)
from simulation_engine.runtime.alarms.types import AlarmCandidate
from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord


@dataclass(frozen=True)
class ConnectionView:
    """Değerlendirici için bir bağlantının özeti.

    Yöneticinin tamamını almak yerine yalnızca gereken alanlar alınır: kural
    katmanı bağlantı nesnesini tanımaz ve bu yüzden testte sahte bir nesne
    kurmak gerekmez.
    """

    connection_id: str
    label: str
    status: str
    ever_verified: bool


def collect_candidates(
    snapshots: Iterable[MachineSnapshotRecord],
    connections: Iterable[ConnectionView],
    now_ms: int,
    thresholds: Optional[AlarmThresholds] = None,
) -> List[AlarmCandidate]:
    """Bütün kuralların ürettiği adaylar."""
    limits = thresholds or AlarmThresholds()
    candidates: List[AlarmCandidate] = []

    for snapshot in snapshots:
        candidates.extend(evaluate_snapshot(snapshot, now_ms, limits))

    for connection in connections:
        candidate = runtime_disconnected(
            connection.connection_id,
            connection.label,
            connection.status,
            connection.ever_verified,
        )
        if candidate is not None:
            candidates.append(candidate)

    return candidates


class AlarmEvaluator:
    """Kuralları çalıştırıp depoyu güncel tutar."""

    def __init__(
        self,
        store: Optional[AlarmStore] = None,
        thresholds: Optional[AlarmThresholds] = None,
    ) -> None:
        self.store = store if store is not None else AlarmStore()
        self.thresholds = thresholds if thresholds is not None else AlarmThresholds()

    def evaluate(
        self,
        snapshots: Iterable[MachineSnapshotRecord],
        connections: Iterable[ConnectionView],
        now_ms: int,
    ) -> Dict[str, int]:
        """Değerlendirir ve depoya işler; ne olduğunu döndürür."""
        candidates = collect_candidates(snapshots, connections, now_ms, self.thresholds)
        return self.store.sync(candidates, now_ms)

    def acknowledge(self, alarm_id: str, by: str, now_ms: int):
        return self.store.acknowledge(alarm_id, by, now_ms)

    # Susturma ve yükseltme depoda uygulanır; değerlendirici yalnızca
    # aktarır. Çağıranların depoya doğrudan uzanması, alarm durumunu
    # değiştiren yolları ikiye çıkarır ve hangisinin denetim kaydı yazdığı
    # belirsizleşirdi.

    def silence(
        self,
        alarm_id: str,
        by: str,
        now_ms: int,
        duration_ms: Optional[int] = None,
        reason: str = "Elle susturuldu",
    ):
        return self.store.silence(
            alarm_id, by, now_ms, duration_ms=duration_ms, reason=reason
        )

    def unsilence(self, alarm_id: str, now_ms: int):
        return self.store.unsilence(alarm_id, now_ms)

    def escalate(self, alarm_id: str, level: int, now_ms: int):
        return self.store.escalate(alarm_id, level, now_ms)

    def apply_maintenance(self, registry, now_ms: int):
        return self.store.apply_maintenance(registry, now_ms)

    def apply_actions(self, actions, now_ms: int) -> Dict[str, int]:
        return self.store.apply_actions(actions, now_ms)

    @property
    def active(self):
        """Etkin alarmlar; yükseltme motoru bunları okur."""
        return self.store.active

    def snapshot(self, now_ms: int) -> Dict[str, object]:
        return self.store.to_dict(now_ms)

    @property
    def active_count(self) -> int:
        return len(self.store.active)

    @property
    def open_count(self) -> int:
        return len(self.store.open_alarms())
