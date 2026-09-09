"""Yoklama zamanlaması.

Bu modül saf: hiçbir yerde saat okunmaz, hiçbir yerde beklenmez. Ne zaman
yoklanacağına karar verir, yoklamayı `poller` yapar. Ayrım bilinçlidir —
zamanlama kararı ancak deterministik olduğunda sınanabilir.

Aralık sınırları
----------------
* **Varsayılan 1000 ms.** Saniyede bir okuma, bir üretim ekranında "canlı"
  hissi veren en uzun aralıktır.
* **En kısa 250 ms.** Daha sıkı yoklama çoğu MES'te kötüye kullanım sayılır ve
  istek kısıtlamasına takılır; ayrıca saniyede dörtten fazla okuma, insanın
  ekranda ayırt edebileceğinden daha hızlıdır.
* **En uzun 60 s.** Daha uzunu "canlı" sayılamaz: bir dakika önce durmuş bir
  makine ekranda hâlâ çalışıyor görünürdü.

Başarısızlıkta üstel geri çekilme
---------------------------------
Kapalı bir uç noktayı saniyede bir yoklamak, hem ağı hem günlüğü doldurur.
Aralık her başarısızlıkta ikiye katlanır ve tavanda durur; ilk başarılı
okumada varsayılana döner. Sabit kalsaydı, gece kapanan bir sunucu sabaha
kadar yüz binlerce başarısız istek üretirdi.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

#: REST yoklamasının varsayılan aralığı (ms).
DEFAULT_POLL_INTERVAL_MS = 1_000

#: Kabul edilen en kısa aralık (ms).
MIN_POLL_INTERVAL_MS = 250

#: Kabul edilen en uzun aralık (ms).
MAX_POLL_INTERVAL_MS = 60_000

#: Geri çekilmenin üst sınırı (ms); aralık bunun üstüne çıkmaz.
MAX_BACKOFF_MS = MAX_POLL_INTERVAL_MS


class StreamHealth(str, Enum):
    """Bir akışın o andaki durumu."""

    #: Veri akıyor.
    RUNNING = "running"
    #: Görev ayakta ama henüz veri gelmedi.
    IDLE = "idle"
    #: Kuyruk doldu; olay düşürülüyor.
    BACKPRESSURE = "backpressure"
    #: Son denemeler başarısız.
    FAILING = "failing"
    #: Akış durduruldu.
    STOPPED = "stopped"


STREAM_HEALTH_LABEL: Dict[StreamHealth, str] = {
    StreamHealth.RUNNING: "Çalışıyor",
    StreamHealth.IDLE: "Veri bekleniyor",
    StreamHealth.BACKPRESSURE: "Kuyruk dolu",
    StreamHealth.FAILING: "Hata alıyor",
    StreamHealth.STOPPED: "Durduruldu",
}


def clamp_interval_ms(requested: Optional[int]) -> int:
    """İstenen aralığı kabul edilen aralığa çeker.

    `None` ya da geçersiz bir değer varsayılana düşer; sıfır ya da negatif bir
    aralık sonsuz döngü demek olurdu.
    """
    if requested is None:
        return DEFAULT_POLL_INTERVAL_MS
    if not isinstance(requested, (int, float)) or requested != requested:
        return DEFAULT_POLL_INTERVAL_MS
    return int(max(MIN_POLL_INTERVAL_MS, min(MAX_POLL_INTERVAL_MS, requested)))


def backoff_interval_ms(base_interval_ms: int, consecutive_failures: int) -> int:
    """Art arda başarısızlıkta büyüyen aralık.

    İlk başarısızlıkta da büyür: bir kez başarısız olan bir uç, aynı hızda
    yeniden denenmemelidir.
    """
    if consecutive_failures <= 0:
        return clamp_interval_ms(base_interval_ms)
    grown = clamp_interval_ms(base_interval_ms) * (2**consecutive_failures)
    return int(min(MAX_BACKOFF_MS, grown))


def poll_rate_hz(interval_ms: Optional[int]) -> Optional[float]:
    """Yoklama sıklığı (Hz); aralık ölçülemiyorsa `None`.

    Sıfır dönmek, saniyede bir yoklanan bir akışı "hiç yoklanmıyor" diye
    göstermek olurdu.
    """
    if interval_ms is None or interval_ms <= 0:
        return None
    return 1_000 / interval_ms


@dataclass
class ScheduleEntry:
    """Tek bir bağlantının yoklama planı."""

    connector_id: str
    base_interval_ms: int
    #: Bir sonraki yoklamanın anı (epoch ms).
    next_due_ms: int
    consecutive_failures: int = 0
    #: Kaç kez yoklandı?
    polls: int = 0
    #: Şu an geçerli olan aralık (geri çekilme uygulanmış).
    current_interval_ms: int = 0

    def __post_init__(self) -> None:
        self.base_interval_ms = clamp_interval_ms(self.base_interval_ms)
        if self.current_interval_ms <= 0:
            self.current_interval_ms = self.base_interval_ms

    def to_dict(self) -> Dict[str, object]:
        return {
            "connector_id": self.connector_id,
            "base_interval_ms": self.base_interval_ms,
            "current_interval_ms": self.current_interval_ms,
            "next_due_ms": self.next_due_ms,
            "consecutive_failures": self.consecutive_failures,
            "polls": self.polls,
            "poll_rate_hz": poll_rate_hz(self.current_interval_ms),
        }


@dataclass
class PollScheduler:
    """Hangi bağlantının ne zaman yoklanacağına karar verir."""

    entries: Dict[str, ScheduleEntry] = field(default_factory=dict)

    def add(
        self, connector_id: str, interval_ms: Optional[int], now_ms: int
    ) -> ScheduleEntry:
        """Bağlantıyı plana alır ya da aralığını günceller.

        İlk yoklama **hemen** yapılır (`next_due_ms = now_ms`): bir aralık
        beklemek, ekranı ilk açan kullanıcıyı bir saniye boş ekranla bırakırdı.
        """
        interval = clamp_interval_ms(interval_ms)
        existing = self.entries.get(connector_id)
        if existing is not None:
            existing.base_interval_ms = interval
            existing.current_interval_ms = backoff_interval_ms(
                interval, existing.consecutive_failures
            )
            return existing

        entry = ScheduleEntry(
            connector_id=connector_id,
            base_interval_ms=interval,
            next_due_ms=now_ms,
        )
        self.entries[connector_id] = entry
        return entry

    def remove(self, connector_id: str) -> bool:
        return self.entries.pop(connector_id, None) is not None

    def due(self, now_ms: int) -> List[ScheduleEntry]:
        """Şu an yoklanması gereken bağlantılar, en gecikmişten başlayarak.

        Sıralama önemlidir: yük altında hepsi yoklanamayabilir ve en uzun
        süredir okunmayan bağlantı önce gelmelidir.
        """
        ready = [item for item in self.entries.values() if item.next_due_ms <= now_ms]
        return sorted(ready, key=lambda item: item.next_due_ms)

    def note_success(self, connector_id: str, now_ms: int) -> Optional[ScheduleEntry]:
        """Başarılı yoklamayı işler: geri çekilme sıfırlanır."""
        entry = self.entries.get(connector_id)
        if entry is None:
            return None
        entry.consecutive_failures = 0
        entry.current_interval_ms = entry.base_interval_ms
        entry.polls += 1
        entry.next_due_ms = now_ms + entry.current_interval_ms
        return entry

    def note_failure(self, connector_id: str, now_ms: int) -> Optional[ScheduleEntry]:
        """Başarısız yoklamayı işler: aralık büyür."""
        entry = self.entries.get(connector_id)
        if entry is None:
            return None
        entry.consecutive_failures += 1
        entry.current_interval_ms = backoff_interval_ms(
            entry.base_interval_ms, entry.consecutive_failures
        )
        entry.polls += 1
        entry.next_due_ms = now_ms + entry.current_interval_ms
        return entry

    def next_wake_ms(self, now_ms: int) -> Optional[int]:
        """Bir sonraki uyanma anına kalan süre (ms); plan boşsa `None`.

        Sıfırdan küçük olmaz: geçmişte kalmış bir plan "hemen" demektir,
        negatif bir bekleme değil.
        """
        if not self.entries:
            return None
        soonest = min(item.next_due_ms for item in self.entries.values())
        return max(0, soonest - now_ms)

    def states(self) -> List[Dict[str, object]]:
        return [entry.to_dict() for entry in self.entries.values()]

    def clear(self) -> None:
        self.entries.clear()
