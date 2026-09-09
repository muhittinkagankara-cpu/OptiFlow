"""Keşif önbelleği ve sihirbazın durumu.

Neden önbellek
--------------
OPC UA adres uzayını gezmek saniyeler sürer ve sunucuyu meşgul eder. Kullanıcı
sihirbazda etiket seçiminden eşlemeye geçip geri döndüğünde keşfin yeniden
çalışması, hem beklemeye hem de sahadaki sunucuya gereksiz yük bindirmeye yol
açardı.

Önbellek neden eskiyor
----------------------
Bir PLC'ye yeni bir değişken eklenebilir ya da cihaz tümüyle değişebilir.
Süresiz bir önbellek, kullanıcının kurulumda göremediği yeni bir etiketin
"cihazda yok" sanılmasına yol açardı. Süresi dolan önbellek atılır ve keşif
yeniden yapılır.

Parmak izi neden karşılaştırılır
--------------------------------
Aynı uca farklı bir cihaz takılabilir. Önbellekteki parmak izi ile yeni keşfin
parmak izi tutmuyorsa bu bir uyarıdır: mevcut eşlemeler artık başka bir
cihazın düğümlerine işaret ediyor olabilir. Sessizce güncellemek, eşlemeyi
yanlış makineye bağlamak olurdu.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from simulation_engine.runtime.provisioning.types import (
    PROVISIONING_ORDER,
    DeviceFingerprint,
    DiscoveryResult,
    ProvisioningStep,
    fingerprint_of,
)

#: Önbelleğin geçerlilik süresi (ms).
#:
#: On dakika, bir sihirbaz oturumunu rahatça kapsar; bir kurulumun bundan uzun
#: sürmesi hâlinde keşfin tazelenmesi zaten doğrudur.
CACHE_TTL_MS = 600_000

#: Önbellekte tutulan en fazla uç.
MAX_CACHED_ENDPOINTS = 50


@dataclass
class CacheEntry:
    """Bir uç için saklanan keşif."""

    result: DiscoveryResult
    fingerprint: DeviceFingerprint
    stored_at_ms: int

    def age_ms(self, now_ms: int) -> int:
        return max(0, now_ms - self.stored_at_ms)

    def is_fresh(self, now_ms: int, ttl_ms: int = CACHE_TTL_MS) -> bool:
        return self.age_ms(now_ms) < ttl_ms


class DiscoveryCache:
    """Uç adresine göre keşif sonuçlarını saklar."""

    def __init__(self, ttl_ms: int = CACHE_TTL_MS, capacity: int = MAX_CACHED_ENDPOINTS) -> None:
        self._ttl_ms = max(1, int(ttl_ms))
        self._capacity = max(1, int(capacity))
        self._entries: Dict[str, CacheEntry] = {}

    def store(self, result: DiscoveryResult, now_ms: int) -> CacheEntry:
        """Keşfi saklar ve parmak izini hesaplar.

        Başarısız bir keşif de saklanmaz: boş bir liste önbelleğe girseydi,
        geçici bir ağ hatası on dakika boyunca "cihazda etiket yok" olarak
        okunurdu.
        """
        if not result.ok:
            raise ValueError("Başarısız keşif önbelleğe alınmaz")
        fingerprint = fingerprint_of(
            result.endpoint, result.kind, [tag.address for tag in result.tags]
        )
        entry = CacheEntry(result=result, fingerprint=fingerprint, stored_at_ms=now_ms)
        self._entries[result.endpoint] = entry
        self._evict(now_ms)
        return entry

    def get(self, endpoint: str, now_ms: int) -> Optional[CacheEntry]:
        """Taze kayıt; yoksa ya da eskimişse `None`."""
        entry = self._entries.get(endpoint)
        if entry is None:
            return None
        if not entry.is_fresh(now_ms, self._ttl_ms):
            return None
        return entry

    def fingerprint(self, endpoint: str) -> Optional[DeviceFingerprint]:
        """Saklanan parmak izi; süre dolmuş olsa da döner.

        Cihaz değişimini anlamak için eski parmak izi gerekir; tazelik ölçütü
        etiket listesi içindir, kimlik karşılaştırması için değil.
        """
        entry = self._entries.get(endpoint)
        return None if entry is None else entry.fingerprint

    def changed(self, result: DiscoveryResult) -> Optional[bool]:
        """Cihaz değişti mi? Karşılaştırılacak kayıt yoksa `None`.

        `False` ile `None` farklıdır: birincisi "aynı cihaz", ikincisi "daha
        önce görülmemiş". İkisini birleştirmek, ilk kurulumu bir cihaz
        değişimi gibi göstermek olurdu.
        """
        previous = self.fingerprint(result.endpoint)
        if previous is None:
            return None
        current = fingerprint_of(
            result.endpoint, result.kind, [tag.address for tag in result.tags]
        )
        return not current.matches(previous)

    def invalidate(self, endpoint: str) -> bool:
        return self._entries.pop(endpoint, None) is not None

    def clear(self) -> None:
        self._entries.clear()

    def _evict(self, now_ms: int) -> None:
        """Eskimiş kayıtları, sonra gerekirse en eskisini atar."""
        stale = [
            endpoint
            for endpoint, entry in self._entries.items()
            if not entry.is_fresh(now_ms, self._ttl_ms)
        ]
        for endpoint in stale:
            del self._entries[endpoint]
        while len(self._entries) > self._capacity:
            oldest = min(self._entries.items(), key=lambda item: item[1].stored_at_ms)
            del self._entries[oldest[0]]

    def stats(self, now_ms: int) -> Dict[str, Any]:
        return {
            "entries": len(self._entries),
            "ttl_ms": self._ttl_ms,
            "endpoints": sorted(self._entries),
            "fresh": len(
                [
                    entry
                    for entry in self._entries.values()
                    if entry.is_fresh(now_ms, self._ttl_ms)
                ]
            ),
        }


@dataclass
class WizardState:
    """Devreye alma sihirbazının o anki durumu.

    Adımların ileri sırayla tamamlanması zorunludur: keşif yapılmadan etiket
    seçilemez, etiket seçilmeden eşleme kurulamaz, test edilmeden kaydedilemez.
    Kaydedilmiş ama hiç denenmemiş bir bağlantı, arayüzde çalışıyormuş gibi
    durur — bu sprintin engellediği tam olarak budur.
    """

    step: ProvisioningStep = ProvisioningStep.ENDPOINT
    completed: List[ProvisioningStep] = field(default_factory=list)
    #: Seçilen etiket adresleri.
    selected: List[str] = field(default_factory=list)
    #: Adres → (makine, metrik) eşlemesi.
    mapping: Dict[str, Dict[str, str]] = field(default_factory=dict)
    #: Test edildi mi ve sonucu ne? Test yapılmadıysa `None`.
    test_ok: Optional[bool] = None
    test_detail: Optional[str] = None

    def complete(self, step: ProvisioningStep) -> bool:
        """Adımı tamamlanmış işaretler; sırası gelmemişse `False`."""
        if not self.can_enter(step):
            return False
        if step not in self.completed:
            self.completed.append(step)
        index = PROVISIONING_ORDER.index(step)
        if index + 1 < len(PROVISIONING_ORDER):
            self.step = PROVISIONING_ORDER[index + 1]
        else:
            self.step = step
        return True

    def can_enter(self, step: ProvisioningStep) -> bool:
        """Bu adıma geçilebilir mi?

        Önceki adımların tamamı tamamlanmış olmalıdır. Atlamaya izin
        verilseydi, kullanıcı hiç keşif yapmadan eşleme ekranına düşer ve boş
        bir listeyle karşılaşırdı.
        """
        index = PROVISIONING_ORDER.index(step)
        earlier = PROVISIONING_ORDER[:index]
        return all(item in self.completed for item in earlier)

    @property
    def can_save(self) -> bool:
        """Kaydedilebilir mi?

        Test edilmemiş ya da testi başarısız bir bağlantı kaydedilmez.
        """
        return self.test_ok is True and ProvisioningStep.TEST in self.completed

    def to_dict(self) -> Dict[str, Any]:
        return {
            "step": self.step.value,
            "completed": [item.value for item in self.completed],
            "selected": list(self.selected),
            "mapping": {key: dict(value) for key, value in self.mapping.items()},
            "test_ok": self.test_ok,
            "test_detail": self.test_detail,
            "can_save": self.can_save,
        }
