"""Denetim kaydedicisi.

Kayıt **hiçbir zaman** çağıranı düşürmez: denetim günlüğüne yazamamak, bir
alarmın onaylanmasını engellememelidir. Hata sayılır ve görünür kılınır ama
işlemi iptal etmez. Tersi seçilseydi, dolu bir disk yüzünden operatör alarmı
onaylayamaz hâle gelirdi.

Bellek ve disk
--------------
Kaydedici iki yere yazar: süreç belleğindeki halka tampon (ekran bunu okur) ve
verilmişse kalıcı depo. Bellek tamponu, disk yokken bile son işlemlerin
görünmesini sağlar; kalıcı depo ise sunucu yeniden başladığında geçmişi
korur.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from simulation_engine.runtime.audit.types import (
    AuditAction,
    AuditEntry,
    AuditOutcome,
    make_entry,
)

#: Bellekte tutulan en fazla kayıt (organizasyon başına).
#:
#: Beş yüz kayıt, yoğun bir vardiyanın tamamını kapsar. Sınırsız bırakılsaydı
#: günlerce çalışan bir süreçte bellek sürekli büyürdü; kalıcı geçmiş zaten
#: depodadır.
MAX_MEMORY_ENTRIES = 500


@dataclass
class AuditRecorder:
    """Kritik işlemleri kaydeder."""

    #: Kalıcı depo; verilmezse yalnızca bellekte tutulur.
    repository: Optional[Any] = None
    clock: Callable[[], int] = lambda: int(time.time() * 1000)

    _entries: Dict[str, List[AuditEntry]] = field(default_factory=dict)
    _sequences: Dict[str, int] = field(default_factory=dict)
    #: Depoya yazılamayan kayıt sayısı; sıfır değilse günlük eksiktir.
    write_errors: int = 0
    last_error: Optional[str] = None

    def record(
        self,
        org_id: str,
        action: AuditAction,
        resource: str,
        actor: Optional[str] = None,
        outcome: AuditOutcome = AuditOutcome.SUCCESS,
        details: Optional[Dict[str, Any]] = None,
        at_ms: Optional[int] = None,
    ) -> AuditEntry:
        """Bir işlemi kaydeder ve kaydı döndürür."""
        moment = at_ms if at_ms is not None else self.clock()
        sequence = self._sequences.get(org_id, 0) + 1
        self._sequences[org_id] = sequence

        entry = make_entry(
            org_id=org_id,
            action=action,
            resource=resource,
            at_ms=moment,
            actor=actor,
            outcome=outcome,
            details=details,
            sequence=sequence,
        )

        bucket = self._entries.setdefault(org_id, [])
        bucket.append(entry)
        if len(bucket) > MAX_MEMORY_ENTRIES:
            del bucket[0 : len(bucket) - MAX_MEMORY_ENTRIES]

        if self.repository is not None:
            try:
                self.repository.append_audit(org_id, entry)
            except Exception as error:  # noqa: BLE001 — kayıt işi durdurmaz
                self.write_errors += 1
                self.last_error = str(error) or error.__class__.__name__

        return entry

    # -- Okuma --------------------------------------------------------------

    def entries(
        self,
        org_id: str,
        limit: int = 100,
        action: Optional[AuditAction] = None,
    ) -> List[AuditEntry]:
        """Kayıtlar, yeniden eskiye.

        Depo varsa oradan okunur: bellekteki tampon yalnızca bu sürecin
        gördüklerini içerir ve yeniden başlatmadan önceki kayıtları bilmez.
        """
        if self.repository is not None:
            try:
                stored = self.repository.list_audit(org_id, limit=limit)
                if action is not None:
                    stored = [item for item in stored if item.action is action]
                return stored[:limit]
            except Exception as error:  # noqa: BLE001
                self.last_error = str(error) or error.__class__.__name__

        bucket = list(reversed(self._entries.get(org_id, [])))
        if action is not None:
            bucket = [item for item in bucket if item.action is action]
        return bucket[:limit]

    def count(self, org_id: str) -> int:
        """Bu süreçte kaydedilen işlem sayısı."""
        return len(self._entries.get(org_id, []))

    def last(self, org_id: str) -> Optional[AuditEntry]:
        bucket = self._entries.get(org_id, [])
        return bucket[-1] if bucket else None

    def summary(self, org_id: str) -> Dict[str, object]:
        """Ekranın gösterdiği özet."""
        bucket = self._entries.get(org_id, [])
        by_action: Dict[str, int] = {}
        failures = 0
        for entry in bucket:
            by_action[entry.action.value] = by_action.get(entry.action.value, 0) + 1
            if entry.outcome is AuditOutcome.FAILURE:
                failures += 1

        return {
            "total": len(bucket),
            "failures": failures,
            "by_action": by_action,
            "persistent": self.repository is not None,
            "write_errors": self.write_errors,
            "last_error": self.last_error,
        }

    def clear(self, org_id: Optional[str] = None) -> None:
        """Yalnızca **bellek** tamponunu boşaltır.

        Kalıcı kayıtlara dokunulmaz: değiştirilemezlik sözü, bir temizleme
        çağrısıyla bozulamaz.
        """
        if org_id is None:
            self._entries.clear()
            self._sequences.clear()
        else:
            self._entries.pop(org_id, None)
            self._sequences.pop(org_id, None)
