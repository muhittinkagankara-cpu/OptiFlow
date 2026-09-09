"""Bağlantı kaydı — hangi organizasyonun hangi bağlantısı var.

Kayıt **süreç belleğinde** yaşar. Bu bilinçli bir sınırdır: bir bağlantının
durumu (açık soket, son ping, yeniden deneme sayacı) o sunucu sürecine aittir
ve başka bir sürece taşınamaz. Veritabanına yazılsaydı, kaydedilen şey
bağlantının kendisi değil yalnızca bir kopyası olurdu ve iki işçili bir
dağıtımda "bağlı" yazan ama hiçbir soketi olmayan kayıtlar oluşurdu.

Kiracı yalıtımı
---------------
Her kayıt bir organizasyona bağlıdır ve **yalnızca** o organizasyon adına
okunabilir. Kayıt kimliği istemciden gelir; organizasyon kimliği ise
doğrulanmış token'dan. İkisi eşleşmiyorsa kayıt yokmuş gibi davranılır —
"başkasının bağlantısı" demek, o bağlantının var olduğunu söylemek olurdu.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from simulation_engine.runtime.health import HealthMonitor
from simulation_engine.runtime.types import (
    ConnectionSpec,
    ConnectionStatus,
    ProbeResult,
)


class ConnectionNotFound(LookupError):
    """İstenen kayıt bu organizasyonda yok."""


class ConnectionExists(ValueError):
    """Aynı kimlikte bir kayıt zaten var."""


@dataclass
class ConnectionState:
    """Bir bağlantının kaydı ve o anki durumu."""

    spec: ConnectionSpec
    org_id: str
    status: ConnectionStatus = ConnectionStatus.IDLE
    health: HealthMonitor = field(default_factory=HealthMonitor)
    #: Son denemenin sonucu; hiç denenmediyse `None`.
    last_probe: Optional[ProbeResult] = None
    #: Kaçıncı yeniden deneme sırasında olduğu.
    attempt: int = 0
    #: Cihazdan **gerçekten** yanıt alındı mı? Bir kez doğrulanınca kalır.
    ever_verified: bool = False

    @property
    def connection_id(self) -> str:
        return self.spec.connection_id

    def apply_probe(self, probe: ProbeResult) -> None:
        """Deneme sonucunu duruma yansıtır.

        `CONNECTED` yalnızca burada ve yalnızca `probe.ok` doğruyken yazılır:
        tek bir kapı olması, başka bir yerde "iyimser" bir durum atamasının
        yapılmasını engeller.
        """
        self.last_probe = probe
        if probe.ok:
            self.status = ConnectionStatus.CONNECTED
            self.ever_verified = True
            self.attempt = 0
            self.health.record_latency(probe.latency_ms)
            self.health.record_packet(probe.at_ms)
            if self.health.connected_at_ms is None:
                self.health.mark_connected(probe.at_ms)
        else:
            self.status = ConnectionStatus.FAILED
            self.health.record_error(probe.detail)
            self.health.mark_disconnected()

    def to_dict(self, now_ms: Optional[int] = None) -> Dict[str, object]:
        """API yanıtına giden hâli."""
        probe = self.last_probe
        return {
            **self.spec.redacted(),
            "status": self.status.value,
            "ever_verified": self.ever_verified,
            "attempt": self.attempt,
            "health": self.health.snapshot(now_ms),
            "last_probe": (
                None
                if probe is None
                else {
                    "ok": probe.ok,
                    "latency_ms": probe.latency_ms,
                    "detail": probe.detail,
                    "evidence": probe.evidence,
                    "bytes_received": probe.bytes_received,
                    "at_ms": probe.at_ms,
                }
            ),
        }


class ConnectionRegistry:
    """Organizasyon başına bağlantı kayıtları."""

    def __init__(self) -> None:
        self._states: Dict[str, ConnectionState] = {}

    @staticmethod
    def _key(org_id: str, connection_id: str) -> str:
        return f"{org_id}::{connection_id}"

    def add(self, org_id: str, spec: ConnectionSpec) -> ConnectionState:
        key = self._key(org_id, spec.connection_id)
        if key in self._states:
            raise ConnectionExists(
                f"'{spec.connection_id}' kimlikli bir bağlantı zaten kayıtlı."
            )
        state = ConnectionState(spec=spec, org_id=org_id)
        self._states[key] = state
        return state

    def upsert(self, org_id: str, spec: ConnectionSpec) -> ConnectionState:
        """Kayıt varsa yapılandırmasını günceller, yoksa ekler.

        Güncellemede **ölçümler korunur**: aynı cihazın zaman aşımı değeri
        değiştirildiğinde geçmiş gecikme ölçümlerinin silinmesi, bir sorunun
        izini kaybettirirdi.
        """
        key = self._key(org_id, spec.connection_id)
        existing = self._states.get(key)
        if existing is None:
            return self.add(org_id, spec)
        existing.spec = spec
        return existing

    def get(self, org_id: str, connection_id: str) -> ConnectionState:
        state = self._states.get(self._key(org_id, connection_id))
        if state is None:
            raise ConnectionNotFound(f"'{connection_id}' kimlikli bağlantı bulunamadı.")
        return state

    def find(self, org_id: str, connection_id: str) -> Optional[ConnectionState]:
        return self._states.get(self._key(org_id, connection_id))

    def remove(self, org_id: str, connection_id: str) -> ConnectionState:
        state = self.get(org_id, connection_id)
        del self._states[self._key(org_id, connection_id)]
        return state

    def list(self, org_id: str) -> List[ConnectionState]:
        """Organizasyonun bağlantıları; ad sırasına göre."""
        states = [state for state in self._states.values() if state.org_id == org_id]
        return sorted(states, key=lambda state: state.spec.label.lower())

    def count(self, org_id: Optional[str] = None) -> int:
        if org_id is None:
            return len(self._states)
        return len([state for state in self._states.values() if state.org_id == org_id])

    def clear(self) -> None:
        self._states.clear()
