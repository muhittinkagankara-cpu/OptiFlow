"""Sınırlı kuyruk ve olay düşürme.

Neden sınır gerekli
-------------------
Saniyede yüz mesaj yayınlayan bir MQTT broker'ı, ekranı okuyan tek bir
kullanıcıdan çok daha hızlıdır. Kuyruk sınırsız olsaydı, tüketici bir saniye
yavaşladığında bellek büyümeye başlar ve sunucu saatler içinde çökerdi.

Neden **en eski** düşürülür
---------------------------
Bir üretim ekranında en değerli olay **en yenisidir**: makinenin şu anki
durumu, on saniye önceki durumundan önemlidir. Kuyruk dolduğunda yeni olayı
reddetmek, ekranı geçmişte dondurmak olurdu.

Neden kayıp sayılır
-------------------
Düşürülen olay sessizce kaybolursa, ekrandaki üretim sayısı gerçeğin altında
kalır ve kimse nedenini bilemez. Sayaç arayüzde gösterilir; "kaç ölçüm
kaybettik" sorusunun yanıtı olmadan hiçbir sayıya güvenilemez.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Generic, Iterable, List, Optional, TypeVar

#: Kuyruğun varsayılan üst sınırı (olay sayısı).
#:
#: Saniyede yüz olay üreten bir hatta on saniyelik tampon demektir; bundan
#: uzun bir gecikme zaten "canlı" sayılamaz.
DEFAULT_CAPACITY = 1_000

#: Kuyruk bu doluluk oranını aşınca "baskı altında" sayılır.
#:
#: Yüzde yüzü beklemek geç olurdu: doluluk yüzde seksene geldiğinde arayüz
#: uyarmalı ki kullanıcı yoklama aralığını büyütecek zaman bulsun.
PRESSURE_RATIO = 0.8

T = TypeVar("T")


@dataclass
class BoundedEventQueue(Generic[T]):
    """Dolduğunda en eskiyi düşüren sınırlı kuyruk."""

    capacity: int = DEFAULT_CAPACITY
    _items: Deque[T] = field(default_factory=deque)
    #: Yer açmak için düşürülen olay sayısı.
    dropped: int = 0
    #: Kuyruğun gördüğü en yüksek doluluk.
    peak_depth: int = 0

    def __post_init__(self) -> None:
        # Sıfır ya da negatif sınır, her olayı düşüren bir kuyruk demek olurdu.
        self.capacity = max(1, int(self.capacity))

    def __len__(self) -> int:
        return len(self._items)

    @property
    def depth(self) -> int:
        return len(self._items)

    @property
    def is_full(self) -> bool:
        return len(self._items) >= self.capacity

    @property
    def under_pressure(self) -> bool:
        """Doluluk uyarı eşiğini aştı mı?"""
        return len(self._items) >= self.capacity * PRESSURE_RATIO

    @property
    def fill_ratio(self) -> float:
        return len(self._items) / self.capacity

    def push(self, item: T) -> Optional[T]:
        """Olayı kuyruğa alır; yer açmak için düşürülen olayı döndürür."""
        dropped_item: Optional[T] = None
        if len(self._items) >= self.capacity:
            dropped_item = self._items.popleft()
            self.dropped += 1
        self._items.append(item)
        self.peak_depth = max(self.peak_depth, len(self._items))
        return dropped_item

    def extend(self, items: Iterable[T]) -> int:
        """Birden çok olayı sırayla alır; düşürülen sayısını döndürür."""
        dropped = 0
        for item in items:
            if self.push(item) is not None:
                dropped += 1
        return dropped

    def pop(self) -> Optional[T]:
        """En eski olayı verir; kuyruk boşsa `None`."""
        return self._items.popleft() if self._items else None

    def drain(self, limit: Optional[int] = None) -> List[T]:
        """Kuyruğu boşaltır (ya da en fazla `limit` olay alır)."""
        count = len(self._items) if limit is None else min(limit, len(self._items))
        return [self._items.popleft() for _ in range(count)]

    def peek(self) -> Optional[T]:
        return self._items[0] if self._items else None

    def clear(self) -> None:
        self._items.clear()

    def reset_counters(self) -> None:
        """Yalnızca sayaçları sıfırlar; kuyruktaki olaylar durur."""
        self.dropped = 0
        self.peak_depth = len(self._items)

    def to_dict(self) -> Dict[str, object]:
        return {
            "depth": self.depth,
            "capacity": self.capacity,
            "dropped": self.dropped,
            "peak_depth": self.peak_depth,
            "fill_ratio": round(self.fill_ratio, 4),
            "full": self.is_full,
            "under_pressure": self.under_pressure,
        }


def loss_ratio(processed: int, dropped: int) -> Optional[float]:
    """Kayıp oranı (0-1); hiç olay görülmediyse `None`.

    Sıfır dönmek, hiç veri akmamış bir akışı "hiç kayıp yok" diye raporlamak
    olurdu — oysa kayıp henüz **ölçülmemiştir**.
    """
    total = max(0, processed) + max(0, dropped)
    if total == 0:
        return None
    return max(0, dropped) / total
