"""Zaman sıralı olay kuyruğu (future event list) — heap tabanlı.

Neden heap?
-----------
Kesikli olay simülasyonunun sıcak döngüsü tek bir soruyu tekrar tekrar sorar:
"sıradaki en erken olay hangisi?". Bu, öncelik kuyruğu (priority queue) veri
yapısının tam tanımıdır. İkili yığın (binary heap) ile ekleme ve çıkarma
O(log n), en küçüğü okuma O(1) maliyetlidir. Sıralı liste kullanmak eklemeyi
O(n)'e, "her zaman adımında tüm istasyonları tara" biçimindeki yoklama
(polling) yaklaşımı ise tüm simülasyonu O(T * istasyon) maliyetine çıkarır ve
sürekli zamanlı olayları da kaçırır. Şartname Bölüm 6 bu nedenle heap tabanlı
olay kuyruğunu zorunlu tutar.

Eşit zamanlı olayların sıralaması
---------------------------------
Aynı zaman damgasına sahip iki olayın hangi sırayla işleneceği modelin
davranışını değiştirir; bu yüzden sıra rastgeleye bırakılmaz, açıkça
tanımlanır. Sıralama anahtarı üçlüdür: **(zaman, öncelik, ekleme sırası)**.

`EventPriority` değerleri şu ilkeye göre seçilmiştir: *aynı anda hem kapasite
serbest bırakan hem kapasite tüketen olaylar varsa, önce serbest bırakan
işlenir.* Aksi hâlde bir parça, tam o anda boşalacak bir sunucu varken
gereksiz yere kuyruğa girer veya bloke olur; bu, kullanım oranı ve bekleme
süresi istatistiklerini sistematik olarak saptırır.

Üçüncü anahtar olan ekleme sırası (`sequence`), zaman ve öncelik de eşit
olduğunda sonucu tamamen belirli kılar — Şartname TEST 5'in (reprodüktibilite)
ön koşuludur. Bu anahtar olmadan `heapq` eşitlik durumunda `Event` nesnelerini
karşılaştırmaya çalışır ve hem hata verir hem de belirsizlik doğar.

İptal (cancellation)
--------------------
Bir makine işlem ortasında arızalandığında, o iş için planlanmış
`SERVICE_COMPLETE` olayı artık geçersizdir. Heap'ten rastgele bir elemanı
silmek O(n) maliyetlidir; bunun yerine **tembel iptal** (lazy deletion)
kullanılır: olay iptal işaretlenir ve kuyruktan çıkarıldığında atlanır.

Kaynaklar
---------
- Law, A. M. (2015). *Simulation Modeling and Analysis*, 5th ed., Bölüm 1.3
  (next-event time-advance mekanizması).
- Banks, J. et al. (2010). *Discrete-Event System Simulation*, 5th ed., Bölüm 3.1.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass
from enum import Enum, IntEnum
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:  # pragma: no cover - yalnızca tip denetimi için
    from simulation_engine.core.entities import Entity


class EventType(str, Enum):
    """Motorun tanıdığı olay türleri."""

    #: Sisteme dışarıdan yeni bir parça girişi (Poisson süreci).
    ARRIVAL = "arrival"
    #: Bir sunucunun üzerindeki işi bitirmesi.
    SERVICE_COMPLETE = "service_complete"
    #: Bir sunucunun arızalanması (MTBF süreci).
    FAILURE = "failure"
    #: Arızalı sunucunun onarımının bitmesi (MTTR süreci).
    REPAIR_COMPLETE = "repair_complete"
    #: Isınma periyodunun sonu — tüm istatistikler sıfırlanır.
    WARMUP_END = "warmup_end"
    #: Simülasyonun sonu — ana döngü burada durur.
    SIMULATION_END = "simulation_end"


class EventPriority(IntEnum):
    """Eşit zamanlı olayların işlenme önceliği (küçük değer önce işlenir).

    Sıralama gerekçesi:

    1. `REPAIR_COMPLETE` — onarılan makine kapasiteyi geri verir; aynı anda
       gelen bir parçanın bu kapasiteyi görebilmesi gerekir.
    2. `SERVICE_COMPLETE` — sunucu boşalır ve kuyruktaki parça hizmete alınır;
       kapasite serbest bırakan ikinci olaydır.
    3. `ARRIVAL` — kapasite **tüketen** olay; serbest bırakanlardan sonra gelir.
    4. `FAILURE` — kapasite azaltan olay; aynı anda biten bir işin
       tamamlanmamış sayılmaması için `SERVICE_COMPLETE` sonrasına konur.
    5. `WARMUP_END` — istatistik sıfırlaması, o andaki tüm durum değişiklikleri
       yerleştikten **sonra** yapılmalıdır; aksi hâlde aynı anda gerçekleşen
       bir olay yanlış pencereye yazılır.
    6. `SIMULATION_END` — her şeyin sonuncusu.
    """

    REPAIR_COMPLETE = 0
    SERVICE_COMPLETE = 10
    ARRIVAL = 20
    FAILURE = 30
    WARMUP_END = 40
    SIMULATION_END = 50


#: Olay türünden varsayılan önceliğe eşleme.
DEFAULT_PRIORITIES: dict[EventType, EventPriority] = {
    EventType.REPAIR_COMPLETE: EventPriority.REPAIR_COMPLETE,
    EventType.SERVICE_COMPLETE: EventPriority.SERVICE_COMPLETE,
    EventType.ARRIVAL: EventPriority.ARRIVAL,
    EventType.FAILURE: EventPriority.FAILURE,
    EventType.WARMUP_END: EventPriority.WARMUP_END,
    EventType.SIMULATION_END: EventPriority.SIMULATION_END,
}


@dataclass(eq=False)
class Event:
    """Belirli bir simülasyon zamanında gerçekleşecek tek bir olay.

    `eq=False` bilinçlidir: olaylar kimlikleriyle (nesne referansı) ayırt edilir;
    iki farklı olayın alan değerleri aynı olsa bile aynı olay değildirler.
    """

    time: float
    event_type: EventType
    priority: EventPriority
    sequence: int
    station_id: Optional[str] = None
    server_index: Optional[int] = None
    entity: Optional["Entity"] = None
    cancelled: bool = False

    def cancel(self) -> None:
        """Olayı iptal işaretler; kuyruktan çıkarılırken atlanır."""
        self.cancelled = True

    def __repr__(self) -> str:
        target = f" @{self.station_id}" if self.station_id else ""
        server = f"#{self.server_index}" if self.server_index is not None else ""
        entity = f" entity={self.entity.id}" if self.entity is not None else ""
        state = " [IPTAL]" if self.cancelled else ""
        return (
            f"Event(t={self.time:.4f}, {self.event_type.value}{target}{server}"
            f"{entity}, seq={self.sequence}){state}"
        )


class EventQueue:
    """Zaman sıralı, heap tabanlı gelecek olay listesi (future event list)."""

    def __init__(self) -> None:
        """Boş bir olay kuyruğu oluşturur."""
        # Heap elemanları (time, priority, sequence, event) demetleridir; ilk üç
        # anahtar toplam sıralama tanımladığı için Event nesneleri hiçbir zaman
        # birbiriyle karşılaştırılmaz.
        self._heap: list[tuple[float, int, int, Event]] = []
        self._sequence_counter: int = 0
        self._active_count: int = 0
        self._scheduled_total: int = 0
        self._processed_total: int = 0
        self._cancelled_total: int = 0

    # ------------------------------------------------------------------ #
    # Ekleme
    # ------------------------------------------------------------------ #
    def schedule(
        self,
        time: float,
        event_type: EventType,
        station_id: Optional[str] = None,
        server_index: Optional[int] = None,
        entity: Optional["Entity"] = None,
        priority: Optional[EventPriority] = None,
    ) -> Event:
        """Yeni bir olay oluşturup kuyruğa ekler ve olayı döndürür.

        Döndürülen referans, olayın sonradan iptal edilebilmesi için saklanır
        (ör. arıza anında iptal edilecek `SERVICE_COMPLETE` olayı).

        Args:
            time: Olayın gerçekleşeceği mutlak simülasyon zamanı.
            event_type: Olay türü.
            station_id: İlgili istasyonun kimliği (varsa).
            server_index: İlgili sunucunun istasyon içindeki sırası (varsa).
            entity: Olaya konu parça (varsa).
            priority: Öncelik; verilmezse tür için tanımlı varsayılan kullanılır.

        Returns:
            Kuyruğa eklenen `Event` nesnesi.
        """
        event = Event(
            time=float(time),
            event_type=event_type,
            priority=priority if priority is not None else DEFAULT_PRIORITIES[event_type],
            sequence=self._sequence_counter,
            station_id=station_id,
            server_index=server_index,
            entity=entity,
        )
        self._sequence_counter += 1
        heapq.heappush(self._heap, (event.time, int(event.priority), event.sequence, event))
        self._active_count += 1
        self._scheduled_total += 1
        return event

    # ------------------------------------------------------------------ #
    # Çıkarma
    # ------------------------------------------------------------------ #
    def pop(self) -> Optional[Event]:
        """En erken zamanlı, iptal edilmemiş olayı çıkarır.

        Returns:
            Sıradaki olay; kuyrukta işlenecek olay kalmamışsa `None`.
        """
        while self._heap:
            _, _, _, event = heapq.heappop(self._heap)
            if event.cancelled:
                # Tembel iptal: iptal edilmiş olay sessizce atlanır.
                continue
            self._active_count -= 1
            self._processed_total += 1
            return event
        return None

    def peek(self) -> Optional[Event]:
        """Sıradaki olayı kuyruktan çıkarmadan döndürür.

        İptal edilmiş olaylar bu sırada heap'in tepesinden temizlenir; bu,
        tembel iptalin heap'i şişirmesini sınırlar.
        """
        while self._heap:
            event = self._heap[0][3]
            if event.cancelled:
                heapq.heappop(self._heap)
                continue
            return event
        return None

    def cancel(self, event: Optional[Event]) -> bool:
        """Bir olayı iptal eder.

        Args:
            event: İptal edilecek olay; `None` verilmesi güvenlidir.

        Returns:
            Olay bu çağrı ile iptal edildiyse True, zaten iptalliyse veya
            `None` ise False.
        """
        if event is None or event.cancelled:
            return False
        event.cancel()
        self._active_count -= 1
        self._cancelled_total += 1
        return True

    def clear(self) -> None:
        """Kuyruğu tamamen boşaltır (yeni replikasyona hazırlık)."""
        self._heap.clear()
        self._active_count = 0

    # ------------------------------------------------------------------ #
    # Durum bilgisi
    # ------------------------------------------------------------------ #
    @property
    def next_event_time(self) -> Optional[float]:
        """Sıradaki olayın zamanı; kuyruk boşsa `None`."""
        event = self.peek()
        return None if event is None else event.time

    @property
    def scheduled_total(self) -> int:
        """Kuyruğa şimdiye kadar eklenen toplam olay sayısı."""
        return self._scheduled_total

    @property
    def processed_total(self) -> int:
        """Şimdiye kadar işlenen (çıkarılan) olay sayısı."""
        return self._processed_total

    @property
    def cancelled_total(self) -> int:
        """İptal edilmiş olay sayısı."""
        return self._cancelled_total

    def __len__(self) -> int:
        """Kuyrukta bekleyen, iptal edilmemiş olay sayısı."""
        return self._active_count

    def __bool__(self) -> bool:
        """İşlenecek olay kalıp kalmadığını bildirir."""
        return self._active_count > 0

    def __repr__(self) -> str:
        return (
            f"EventQueue(bekleyen={self._active_count}, islenen={self._processed_total}, "
            f"iptal={self._cancelled_total})"
        )
