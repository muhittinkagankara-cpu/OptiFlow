"""Simülasyon varlıkları: Entity, Buffer, Server, Resource ve Station.

Modelleme kararları
-------------------
**Sunucu ve tampon ayrımı.** Bir istasyon iki ayrı kaynaktan oluşur: önündeki
tampon (`Buffer`) ve paralel sunucu havuzu (`Resource`). Kuyruk teorisindeki
Lq (kuyruktaki ortalama birim) yalnızca tamponu, L (sistemdeki ortalama birim)
ise tampon **ve** hizmet gören parçaları sayar. Bu iki büyüklüğün ayrı
toplayıcılarla ölçülmesi, M/M/1 doğrulamasının (Şartname TEST 1) doğru
büyüklükleri karşılaştırmasını garanti eder.

**Blokaj (blocking after service).** Sonlu tamponlu üretim hatlarında bir
sunucu işini bitirdiğinde, hedef istasyonun tamponu doluysa parçayı bırakamaz
ve **sunucunun üzerinde tutmak zorunda kalır**. Sunucu bu süre boyunca ne
çalışır ne boştadır; "bloke" durumundadır. Bu davranış (blocking-after-service,
BAS) gerçek üretim hatlarının temel bir özelliğidir ve Kısıtlar Teorisi'ndeki
"starvation ve blocking" analizinin sayısal temelidir; blokaj modellenmezse
sonlu tamponlu bir hattın çıktısı sistematik olarak fazla tahmin edilir.

**Arıza modeli.** Arızalar sunucu bazında ve zaman tabanlı ilerler: bir sunucu
çalışır durumdayken Exp(MTBF) süre sonra arızalanır, Onarım süresi kadar durur
ve onarım bitince arıza sayacı yeniden başlar. İşlem ortasında arıza olursa
**kesintiye uğrayan iş kaybolmaz**: kalan işlem süresi saklanır ve onarımdan
sonra kaldığı yerden devam eder (preempt-resume). Kalan süreyi saklamak yerine
işi baştan başlatmak (preempt-repeat), üstel olmayan işlem sürelerinde etkin
çevrim süresini yapay olarak uzatır.

Kaynaklar
---------
- Askin, R. G. & Standridge, C. R. (1993). *Modeling and Analysis of
  Manufacturing Systems*, Bölüm 4 (blokaj ve açlık).
- Law, A. M. (2015). *Simulation Modeling and Analysis*, 5th ed., Bölüm 1.4.
- Nakajima, S. (1988). *Introduction to TPM* (kullanılabilirlik ve OEE).
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from simulation_engine.core.clock import SimulationClock, Tally, TimeWeightedAccumulator
from simulation_engine.core.event_queue import Event
from simulation_engine.distributions.base import BaseDistribution
from simulation_engine.models.schemas import INFINITE_CAPACITY
from simulation_engine.models.schemas import Station as StationConfig


class EntityState(str, Enum):
    """Bir parçanın yaşam döngüsündeki durumu."""

    CREATED = "created"
    QUEUED = "queued"
    IN_SERVICE = "in_service"
    BLOCKED = "blocked"
    DEPARTED = "departed"
    REJECTED = "rejected"
    SCRAPPED = "scrapped"


@dataclass
class Entity:
    """Sistemde akan tek bir parça (iş emri, ürün, müşteri).

    Zaman damgaları parça üzerinde taşınır; böylece akış süresi (flow time) ve
    bekleme süresi, parça sistemden çıktığı anda tek bir yerden okunabilir.
    """

    id: int
    created_at: float
    state: EntityState = EntityState.CREATED
    current_station_id: Optional[str] = None
    departed_at: Optional[float] = None

    #: Parçanın içinde bulunduğu tampona giriş zamanı (kuyrukta değilse None).
    queue_entry_time: Optional[float] = None

    #: Kümülatif süre bileşenleri — akış süresinin nereye gittiğini gösterir.
    total_queue_minutes: float = 0.0
    total_service_minutes: float = 0.0
    total_blocked_minutes: float = 0.0

    #: Ziyaret edilen istasyonlar (rota izi; yeniden işleme döngüleri görünür olur).
    visited_station_ids: list[str] = field(default_factory=list)

    @property
    def flow_time(self) -> Optional[float]:
        """Sistemde geçirilen toplam süre; parça henüz çıkmadıysa `None`.

        Little's Law'daki W büyüklüğünün parça başına gözlemidir.
        """
        if self.departed_at is None:
            return None
        return self.departed_at - self.created_at

    @property
    def is_in_system(self) -> bool:
        """Parça hâlâ sistemde mi?"""
        return self.state not in (
            EntityState.DEPARTED,
            EntityState.REJECTED,
            EntityState.SCRAPPED,
        )

    def __repr__(self) -> str:
        return f"Entity(id={self.id}, state={self.state.value}, at={self.current_station_id})"


class Buffer:
    """İstasyon önündeki FIFO kuyruk (tampon).

    Kapasite `INFINITE_CAPACITY` (-1) ise sınırsızdır (M/M/c), sonlu ise
    M/M/c/K modeline karşılık gelir ve dolduğunda yeni parça kabul edilmez.
    """

    def __init__(self, station_id: str, capacity: int, clock: SimulationClock) -> None:
        """Tamponu oluşturur.

        Args:
            station_id: Sahibi olan istasyonun kimliği.
            capacity: Kuyruk kapasitesi; sınırsız için -1.
            clock: Zaman ağırlıklı istatistikler için simülasyon saati.
        """
        if capacity < INFINITE_CAPACITY:
            raise ValueError(
                f"'{station_id}' tampon kapasitesi -1 (sinirsiz) veya >= 0 olmalidir, "
                f"alinan: {capacity}"
            )
        self.station_id = station_id
        self.capacity = capacity
        self._clock = clock
        self._queue: deque[Entity] = deque()

        #: Zaman ağırlıklı kuyruk boyu -> Lq
        self.length_accumulator = TimeWeightedAccumulator(clock, initial_value=0.0)
        #: Gözlem tabanlı bekleme süresi -> Wq (beklemeyenlerin 0 gözlemi dahil)
        self.wait_time_tally = Tally()

    # ------------------------------------------------------------------ #
    # Kapasite sorguları
    # ------------------------------------------------------------------ #
    @property
    def is_infinite(self) -> bool:
        """Kapasite sınırsız mı?"""
        return self.capacity == INFINITE_CAPACITY

    @property
    def has_space(self) -> bool:
        """Kuyruğa bir parça daha alınabilir mi?"""
        return self.is_infinite or len(self._queue) < self.capacity

    @property
    def is_full(self) -> bool:
        """Kuyruk dolu mu?"""
        return not self.has_space

    @property
    def is_empty(self) -> bool:
        """Kuyruk boş mu?"""
        return not self._queue

    def __len__(self) -> int:
        """Kuyruktaki parça sayısı."""
        return len(self._queue)

    # ------------------------------------------------------------------ #
    # Kuyruk işlemleri
    # ------------------------------------------------------------------ #
    def enqueue(self, entity: Entity) -> bool:
        """Parçayı kuyruğun sonuna ekler.

        Returns:
            Parça kuyruğa alındıysa True, kapasite dolduğu için reddedildiyse
            False.
        """
        if self.is_full:
            return False
        entity.queue_entry_time = self._clock.now
        entity.state = EntityState.QUEUED
        self._queue.append(entity)
        self.length_accumulator.observe(len(self._queue))
        return True

    def dequeue(self) -> Optional[Entity]:
        """Kuyruğun başındaki parçayı çıkarır ve bekleme süresini kaydeder.

        Returns:
            Sıradaki parça; kuyruk boşsa `None`.
        """
        if not self._queue:
            return None
        entity = self._queue.popleft()
        self.length_accumulator.observe(len(self._queue))
        if entity.queue_entry_time is not None:
            waited = self._clock.now - entity.queue_entry_time
            entity.total_queue_minutes += waited
            entity.queue_entry_time = None
            self.wait_time_tally.record(waited)
        return entity

    def record_zero_wait(self) -> None:
        """Kuyruğa hiç girmeden hizmete alınan bir parça için 0 bekleme kaydeder.

        Bu kaydın atlanması Wq ortalamasını sistematik olarak yukarı saptırır:
        M/M/1'de Wq = rho / (mu - lambda) formülü, **hiç beklemeyen** parçaların
        sıfır gözlemlerini de içeren bir ortalamadır. Şartname TEST 1'in %5
        toleransla geçebilmesi doğrudan buna bağlıdır.
        """
        self.wait_time_tally.record(0.0)

    def peek(self) -> Optional[Entity]:
        """Kuyruğun başındaki parçayı çıkarmadan döndürür."""
        return self._queue[0] if self._queue else None

    def reset_statistics(self) -> None:
        """İstatistik penceresini şu andan itibaren yeniden başlatır."""
        self.length_accumulator.reset()
        self.wait_time_tally.reset()

    def finalize_statistics(self) -> None:
        """Pencere sonunda kalan integral alanını biriktirir."""
        self.length_accumulator.finalize()

    def __repr__(self) -> str:
        cap = "inf" if self.is_infinite else str(self.capacity)
        return f"Buffer({self.station_id}, {len(self._queue)}/{cap})"


class ServerState(str, Enum):
    """Tek bir makinenin/operatörün durumu.

    Dört durum birbirini dışlar ve toplam süreleri planlanan üretim süresine
    eşittir: idle + busy + blocked + down = pencere uzunluğu. Bu özdeşlik,
    OEE bileşenlerinin tutarlı hesaplanabilmesi için gereklidir.

    Not: Bir sunucu bloke durumdayken arızalanırsa durumu DOWN olur; DOWN
    durumu diğerlerine önceliklidir ve o süre arıza süresi olarak sayılır.
    """

    IDLE = "idle"
    BUSY = "busy"
    BLOCKED = "blocked"
    DOWN = "down"


@dataclass
class Server:
    """İstasyon içindeki tek bir paralel sunucu (makine veya operatör)."""

    index: int
    station_id: str
    state: ServerState = ServerState.IDLE

    #: Üzerinde işlem gören ya da blokaj nedeniyle tutulan parça.
    current_entity: Optional[Entity] = None

    #: Bu iş için başlangıçta örneklenen toplam işlem süresi. İşlem tamamlanınca
    #: istatistiklere yazılır; arıza kesintileri bu süreyi değiştirmez.
    assigned_service_minutes: float = 0.0

    #: Arıza kesintisinde saklanan kalan işlem süresi (preempt-resume).
    remaining_service_minutes: float = 0.0

    #: Devam eden onarımın süresi; onarım bitince istatistiklere yazılır.
    pending_repair_minutes: float = 0.0

    #: Planlanmış olaylara referanslar — arıza anında iptal edilebilmeleri için.
    service_complete_event: Optional[Event] = None
    failure_event: Optional[Event] = None
    repair_event: Optional[Event] = None

    #: Arıza öncesindeki durum; onarım sonrası bu duruma dönülür.
    state_before_failure: Optional[ServerState] = None

    #: Blokaj bilgisi: ne zamandan beri ve hangi istasyona geçmeyi bekliyor.
    blocked_since: Optional[float] = None
    blocked_target_station_id: Optional[str] = None

    @property
    def is_operational(self) -> bool:
        """Sunucu arızalı değil mi?"""
        return self.state is not ServerState.DOWN

    @property
    def is_available(self) -> bool:
        """Sunucu yeni bir iş alabilir mi? (boşta ve arızasız)"""
        return self.state is ServerState.IDLE

    def __repr__(self) -> str:
        return f"Server({self.station_id}#{self.index}, {self.state.value})"


class Resource:
    """Bir istasyondaki paralel sunucu havuzu — M/M/c modelindeki **c**.

    Sunucu durumlarındaki her değişiklik `set_state` üzerinden yapılır; bu tek
    giriş noktası, durum sayaçlarının ve zaman ağırlıklı toplayıcıların her
    zaman tutarlı kalmasını garanti eder. Doğrudan `server.state = ...` ataması
    yapmak istatistikleri sessizce bozar.
    """

    def __init__(self, station_id: str, capacity: int, clock: SimulationClock) -> None:
        """Sunucu havuzunu oluşturur.

        Args:
            station_id: Sahibi olan istasyonun kimliği.
            capacity: Paralel sunucu sayısı c (>= 1).
            clock: Zaman ağırlıklı istatistikler için simülasyon saati.
        """
        if capacity < 1:
            raise ValueError(
                f"'{station_id}' istasyonunda sunucu sayisi en az 1 olmalidir, alinan: {capacity}"
            )
        self.station_id = station_id
        self.capacity = capacity
        self._clock = clock
        self.servers: list[Server] = [
            Server(index=i, station_id=station_id) for i in range(capacity)
        ]

        self._busy_count = 0
        self._blocked_count = 0
        self._down_count = 0

        #: Zaman ağırlıklı sunucu sayıları. `busy_accumulator.area` doğrudan
        #: sunucu-dakika cinsinden meşgul süreyi verir; kullanım oranı
        #: rho = alan / (c * pencere) olarak hesaplanır.
        self.busy_accumulator = TimeWeightedAccumulator(clock, initial_value=0.0)
        self.blocked_accumulator = TimeWeightedAccumulator(clock, initial_value=0.0)
        self.down_accumulator = TimeWeightedAccumulator(clock, initial_value=0.0)

    # ------------------------------------------------------------------ #
    # Durum yönetimi
    # ------------------------------------------------------------------ #
    def set_state(self, server: Server, new_state: ServerState) -> None:
        """Bir sunucunun durumunu değiştirir ve toplayıcıları günceller."""
        if server.state is new_state:
            return
        self._adjust_counters(server.state, -1)
        server.state = new_state
        self._adjust_counters(new_state, +1)
        self.busy_accumulator.observe(self._busy_count)
        self.blocked_accumulator.observe(self._blocked_count)
        self.down_accumulator.observe(self._down_count)

    def _adjust_counters(self, state: ServerState, delta: int) -> None:
        """Durum sayaçlarını `delta` kadar günceller (IDLE sayacı tutulmaz)."""
        if state is ServerState.BUSY:
            self._busy_count += delta
        elif state is ServerState.BLOCKED:
            self._blocked_count += delta
        elif state is ServerState.DOWN:
            self._down_count += delta

    # ------------------------------------------------------------------ #
    # Sorgular
    # ------------------------------------------------------------------ #
    def available_server(self) -> Optional[Server]:
        """Boşta ve arızasız ilk sunucuyu döndürür; yoksa `None`.

        Sunucular her zaman aynı (indis) sırayla taranır; bu, aynı tohumla
        yapılan iki çalıştırmanın birebir aynı sonucu vermesi için gereklidir.
        """
        for server in self.servers:
            if server.is_available:
                return server
        return None

    def blocked_servers(self) -> list[Server]:
        """Çıkışı tıkalı olan sunucuları indis sırasıyla döndürür."""
        return [s for s in self.servers if s.blocked_target_station_id is not None]

    @property
    def busy_count(self) -> int:
        """İşlem yapan sunucu sayısı."""
        return self._busy_count

    @property
    def blocked_count(self) -> int:
        """Bloke sunucu sayısı."""
        return self._blocked_count

    @property
    def down_count(self) -> int:
        """Arızalı sunucu sayısı."""
        return self._down_count

    @property
    def idle_count(self) -> int:
        """Boşta bekleyen sunucu sayısı."""
        return self.capacity - self._busy_count - self._blocked_count - self._down_count

    @property
    def occupancy(self) -> int:
        """Üzerinde parça bulunan sunucu sayısı (işlem yapan + bloke).

        Sistemdeki iş miktarı (WIP) hesabında kullanılır: bloke bir sunucunun
        üzerindeki parça hâlâ sistemdedir.
        """
        return sum(1 for s in self.servers if s.current_entity is not None)

    # ------------------------------------------------------------------ #
    # İstatistik penceresi
    # ------------------------------------------------------------------ #
    def reset_statistics(self) -> None:
        """İstatistik penceresini şu andan itibaren yeniden başlatır."""
        self.busy_accumulator.reset()
        self.blocked_accumulator.reset()
        self.down_accumulator.reset()

    def finalize_statistics(self) -> None:
        """Pencere sonunda kalan integral alanlarını biriktirir."""
        self.busy_accumulator.finalize()
        self.blocked_accumulator.finalize()
        self.down_accumulator.finalize()

    def __repr__(self) -> str:
        return (
            f"Resource({self.station_id}, c={self.capacity}, busy={self._busy_count}, "
            f"blocked={self._blocked_count}, down={self._down_count})"
        )


class Station:
    """Bir üretim istasyonu: tampon + paralel sunucular + süre dağılımları.

    Bu sınıf **durum ve istatistik** taşır; olay akışının kendisi
    (`core.engine.SimulationEngine`) tarafından yürütülür. Bu ayrım, olay
    sıralamasıyla ilgili tüm mantığın tek bir dosyada toplanmasını ve
    istasyonun bağımsız olarak test edilebilmesini sağlar.
    """

    def __init__(
        self,
        config: StationConfig,
        clock: SimulationClock,
        service_distribution: BaseDistribution,
        time_to_failure_distribution: Optional[BaseDistribution] = None,
        repair_time_distribution: Optional[BaseDistribution] = None,
        order: int = 0,
    ) -> None:
        """İstasyonu konfigürasyondan kurar.

        Args:
            config: Doğrulanmış istasyon şeması.
            clock: Simülasyon saati.
            service_distribution: İşlem süresi örnekleyicisi.
            time_to_failure_distribution: Arızalar arası süre örnekleyicisi
                (arıza modeli yoksa `None`).
            repair_time_distribution: Onarım süresi örnekleyicisi
                (arıza modeli yoksa `None`).
            order: İstasyonun konfigürasyondaki sırası; eşitlik durumlarında
                belirli (deterministik) bir sıralama için kullanılır.
        """
        if (time_to_failure_distribution is None) != (repair_time_distribution is None):
            raise ValueError(
                f"'{config.id}' istasyonunda ariza modeli eksik: arizalar arasi sure ve "
                f"onarim suresi dagilimlari ya birlikte verilmeli ya da ikisi de verilmemelidir."
            )

        self.config = config
        self.id = config.id
        self.name = config.name
        self.order = order
        self._clock = clock

        self.buffer = Buffer(config.id, config.buffer_capacity_before, clock)
        self.resource = Resource(config.id, config.num_servers, clock)

        self.service_distribution = service_distribution
        self.time_to_failure_distribution = time_to_failure_distribution
        self.repair_time_distribution = repair_time_distribution

        # --- Akış sayaçları (istatistik penceresi içinde) ---
        self.entries = 0
        self.service_completions = 0
        self.rejected = 0
        self.units_scrapped = 0
        self.failure_count = 0

        # --- Gözlem tabanlı istatistikler ---
        self.service_time_tally = Tally()
        self.repair_time_tally = Tally()

    # ------------------------------------------------------------------ #
    # Kapasite ve kabul
    # ------------------------------------------------------------------ #
    @property
    def has_failure_model(self) -> bool:
        """İstasyonda arıza/onarım modeli tanımlı mı?"""
        return self.time_to_failure_distribution is not None

    @property
    def scrap_rate(self) -> float:
        """Bu istasyonda bir parçanın hurdaya ayrılma olasılığı."""
        return self.config.scrap_rate

    @property
    def produces_scrap(self) -> bool:
        """İstasyonda fire modeli etkin mi?"""
        return self.config.scrap_rate > 0.0

    def can_accept(self) -> bool:
        """İstasyon şu anda bir parça daha alabilir mi?

        Kuyruk boşken boşta bir sunucu varsa parça doğrudan hizmete girer;
        aksi hâlde tamponda yer olması gerekir.
        """
        if self.buffer.is_empty and self.resource.available_server() is not None:
            return True
        return self.buffer.has_space

    @property
    def occupancy(self) -> int:
        """İstasyondaki toplam parça sayısı (tampon + sunucular üzerindekiler)."""
        return len(self.buffer) + self.resource.occupancy

    # ------------------------------------------------------------------ #
    # Teorik büyüklükler (analytics katmanı için)
    # ------------------------------------------------------------------ #
    @property
    def ideal_cycle_time(self) -> float:
        """E[işlem süresi] — OEE'nin Performance bileşenindeki ideal çevrim süresi.

        Nakajima'nın tanımında ideal çevrim süresi, makinenin tasarım hızındaki
        çevrim süresidir. Simülasyon modelinde bunun karşılığı, işlem süresi
        dağılımının beklenen değeridir.
        """
        return self.service_distribution.mean()

    @property
    def service_rate(self) -> float:
        """Sunucu başına hizmet hızı mu = 1 / E[işlem süresi]."""
        return self.service_distribution.rate()

    @property
    def theoretical_availability(self) -> float:
        """Arıza modelinden gelen teorik kullanılabilirlik A = MTBF / (MTBF + MTTR).

        Arıza modeli tanımlı değilse 1.0 döner. Kararlılık ön denetiminde etkin
        kapasitenin (c * mu * A) hesaplanmasında kullanılır.
        """
        if not self.has_failure_model:
            return 1.0
        mtbf = self.time_to_failure_distribution.mean()  # type: ignore[union-attr]
        mttr = self.repair_time_distribution.mean()  # type: ignore[union-attr]
        total = mtbf + mttr
        return 1.0 if total <= 0.0 else mtbf / total

    # ------------------------------------------------------------------ #
    # İstatistik penceresi
    # ------------------------------------------------------------------ #
    def reset_statistics(self) -> None:
        """Isınma periyodunun sonunda tüm istatistikleri sıfırlar.

        Sayaçlar sıfırlanır ama **sistemin fiziksel durumu korunur**: kuyruktaki
        parçalar, hizmet gören işler ve arızalı makineler olduğu gibi kalır.
        Isınmanın amacı zaten sistemi temsili bir duruma getirmektir; durumu da
        sıfırlamak ısınmayı anlamsız kılardı.
        """
        self.entries = 0
        self.service_completions = 0
        self.rejected = 0
        self.units_scrapped = 0
        self.failure_count = 0
        self.service_time_tally.reset()
        self.repair_time_tally.reset()
        self.buffer.reset_statistics()
        self.resource.reset_statistics()

    def finalize_statistics(self) -> None:
        """Pencere sonunda zaman ağırlıklı toplayıcıları kapatır."""
        self.buffer.finalize_statistics()
        self.resource.finalize_statistics()

    def __repr__(self) -> str:
        return (
            f"Station({self.id}, c={self.resource.capacity}, "
            f"queue={len(self.buffer)}, busy={self.resource.busy_count})"
        )
