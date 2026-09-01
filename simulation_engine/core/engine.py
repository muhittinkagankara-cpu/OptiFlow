"""Kesikli olay simülasyonu (DES) ana motoru.

Mimari
------
Motor, klasik **next-event time-advance** mekanizmasını uygular (Law 2015,
Bölüm 1.3): simülasyon saati yoklama (polling) ile sabit adımlarla değil,
gelecek olay listesindeki en erken olaya sıçrayarak ilerler. Bu sayede maliyet
simüle edilen süreyle değil, gerçekleşen **olay sayısıyla** orantılıdır.

Ana döngü tek bir işi yapar: olay kuyruğundan en erken olayı al, saati o ana
ilerlet, olay türüne karşılık gelen işleyiciyi çağır. Tüm model mantığı bu
işleyicilerdedir; durum ise `core.entities` içindeki nesnelerde tutulur.

Sorumluluk sınırı
-----------------
Motor **ham gözlem** üretir: sunucu-dakika cinsinden meşgul/bloke/arızalı
süreler, zaman ağırlıklı kuyruk ve WIP integralleri, bekleme ve akış süresi
sayaçları. OEE, Little's Law doğrulaması, darboğaz tespiti ve güven aralığı
gibi **türetilmiş** büyüklükler bilinçli olarak `analytics/` katmanına
bırakılmıştır; böylece her analitik formül motordan bağımsız olarak, kapalı
form sonuçlarla test edilebilir.

Tek istisna, çalıştırma öncesi yapılan **kararlılık ön denetimidir**
(Şartname TEST 3). Bir istasyonun yükü rho >= 1 ise kuyruk sınırsız büyür ve
üretilen "ortalama" değerler hiçbir kararlı duruma yakınsamaz. Motorun bu
durumda sessizce sayı üretmesi kabul edilemez olduğu için denetim burada,
simülasyon başlamadan yapılır ve sonuç `ReplicationResult.stability` alanında
açıkça raporlanır.

Isınma (warm-up)
----------------
Simülasyon boş ve boşta (empty-and-idle) durumdan başlar; bu geçici rejimdeki
gözlemler kararlı durum ortalamalarını aşağı saptırır. `warmup_period_minutes`
anında bir `WARMUP_END` olayı tetiklenir ve **tüm istatistikler sıfırlanır,
sistemin fiziksel durumu korunur**. Bu, Welch'in gözlem silme yöntemidir
(Law 2015, Bölüm 9.5.1).

Kaynaklar
---------
- Law, A. M. (2015). *Simulation Modeling and Analysis*, 5th ed.
- Banks, J. et al. (2010). *Discrete-Event System Simulation*, 5th ed.
- Jackson, J. R. (1957). "Networks of Waiting Lines." *Operations Research*, 5(4).
- Little, J. D. C. (1961). "A Proof for the Queuing Formula: L = lambda W."
  *Operations Research*, 9(3), 383-387.
"""

from __future__ import annotations

import hashlib
import logging
import math
import random
import time
from typing import Callable, Dict, List, Optional

from simulation_engine.core.clock import SimulationClock, Tally, TimeWeightedAccumulator
from simulation_engine.core.entities import (
    Entity,
    EntityState,
    Server,
    ServerState,
    Station,
)
from simulation_engine.core.event_queue import Event, EventQueue, EventType
from simulation_engine.distributions import create_distribution
from simulation_engine.distributions.base import SEED_BITS, RandomStreamFactory
from simulation_engine.distributions.exponential import ExponentialDistribution
from simulation_engine.models.schemas import (
    ROUTING_PROBABILITY_TOLERANCE,
    ReplicationResult,
    SimulationConfig,
    SimulationEvent,
    SimulationTrace,
    StabilityCheck,
    StationRunMetrics,
    SystemRunMetrics,
)

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Adlandırılmış sabitler
# --------------------------------------------------------------------------- #

#: Kararlılık sınırı: rho bu değere eşit veya büyükse kuyruk sınırsız büyür.
STABILITY_UTILIZATION_LIMIT: float = 1.0

#: Trafik denklemlerinin (v = e + v*P) yinelemeli çözümünde üst sınır.
MAX_TRAFFIC_EQUATION_ITERATIONS: int = 10_000

#: Trafik denklemlerinde yakınsama toleransı.
TRAFFIC_EQUATION_TOLERANCE: float = 1e-12

#: Sistemdeki parça sayısı için güvenlik tavanı. Kararsız bir model (rho >= 1)
#: sonsuz kuyruk üretir; bu tavan olmadan süreç belleği tüketene kadar çalışır.
#: Aşıldığında motor açık bir hata mesajıyla durur.
MAX_ENTITIES_IN_SYSTEM: int = 1_000_000

#: `rho ** K` hesabında kayan nokta taşmasını önlemek için üst sınır (10 tabanında).
#: Aşıldığında engellenme olasılığı asimptotik limitinden alınır.
MAX_SAFE_POWER_EXPONENT: float = 300.0


def finite_buffer_blocking_probability(load: float, capacity: int) -> float:
    """M/M/1/K modelinde engellenme (kayıp) olasılığını hesaplar.

    Sistemde en fazla K parça bulunabilen bir kuyrukta, gelen bir parçanın
    sistemi dolu bulup reddedilme olasılığı (Gross & Harris 2008, Bölüm 2.5):

        P_K = (1 - rho) * rho^K / (1 - rho^(K+1)),    rho != 1
        P_K = 1 / (K + 1),                            rho = 1

    Formül rho >= 1 için de geçerlidir: sonlu kapasiteli bir sistem, sunulan
    yük hizmet kapasitesini aşsa bile kararlıdır çünkü fazla parça reddedilir.

    Args:
        load: Sunulan yük rho = lambda / (c * mu * A).
        capacity: Sistemdeki azami parça sayısı K (tampon + sunucular).

    Returns:
        0 ile 1 arasında engellenme olasılığı.

    Notes:
        Birden çok sunuculu (c > 1) istasyonlarda bu bir **yaklaşımdır**:
        istasyon, hızı c * mu olan tek bir sunucu gibi ele alınır. Gerçek
        M/M/c/K değeri buna yakındır ancak birebir aynı değildir; sonuç
        `StabilityCheck` içinde "tahmini" olarak raporlanır.
    """
    if capacity < 1:
        return 1.0
    if load <= 0.0:
        return 0.0
    if math.isclose(load, 1.0):
        return 1.0 / (capacity + 1)
    # rho > 1 ve K büyükse rho^K taşar. Bu bölgede P_K -> 1 - 1/rho limitine
    # gider; doğrudan limiti kullanmak hem taşmayı önler hem daha doğrudur.
    if load > 1.0 and capacity * math.log10(load) > MAX_SAFE_POWER_EXPONENT:
        return 1.0 - 1.0 / load
    power_k = load**capacity
    return (1.0 - load) * power_k / (1.0 - power_k * load)


#: Olay izinin varsayılan olarak kapsadığı süre. 10.000 dakikalık tam bir izin
#: hem boyutu çok büyük olur hem de animasyon olarak izlenemeyecek kadar uzun
#: sürer; ilk pencere sistemin dolmasını ve kuyrukların oluşmasını göstermeye
#: yeter.
DEFAULT_TRACE_WINDOW_MINUTES: float = 500.0

#: Kayıt edilebilecek azami olay sayısı. Yoğun bir modelde pencere dolmadan bu
#: sınıra ulaşılabilir; kayıt orada durur ve iz "kesildi" olarak işaretlenir.
#: Sınır olmadan, çok hızlı bir hattın izi belleği ve ağ trafiğini şişirirdi.
MAX_TRACE_EVENTS: int = 20_000


class EventTraceCollector:
    """Simülasyon olaylarını görselleştirme için kaydeden gözlemci.

    **Simülasyonun sonucuna hiçbir etkisi yoktur.** Yalnızca gerçekleşmiş
    olayları bir listeye ekler; rastgele sayı çekmez, akışı yönlendirmez, hiçbir
    karara katılmaz. Bu özellik bir testle kilitlenmiştir: iz açıkken ve
    kapalıyken üretilen istatistikler birebir aynı olmalıdır.

    Kayıt iki koşuldan biri sağlanınca durur: pencere süresi dolduğunda veya
    olay sayısı üst sınıra ulaştığında. Durduktan sonra `record` çağrıları
    sessizce yok sayılır, böylece motorun çağrı noktalarına koşul yazmak
    gerekmez.
    """

    def __init__(
        self,
        window_minutes: float = DEFAULT_TRACE_WINDOW_MINUTES,
        max_events: int = MAX_TRACE_EVENTS,
    ) -> None:
        self.window_minutes = window_minutes
        self.max_events = max_events
        self.events: List[SimulationEvent] = []
        self.truncated = False

    def record(
        self,
        timestamp: float,
        entity_id: int,
        event_type: str,
        station_id: Optional[str] = None,
    ) -> None:
        """Tek bir olayı kaydeder; pencere veya sınır aşıldıysa hiçbir şey yapmaz."""
        if timestamp > self.window_minutes:
            return
        if len(self.events) >= self.max_events:
            self.truncated = True
            return
        self.events.append(
            SimulationEvent(
                timestamp=timestamp,
                entity_id=str(entity_id),
                event_type=event_type,  # type: ignore[arg-type]
                station_id=station_id,
            )
        )

    def build(
        self, replication_index: int, total_replications: int, station_ids: List[str]
    ) -> SimulationTrace:
        """Toplanan olayları `SimulationTrace` şemasına dönüştürür."""
        covered = (
            min(self.window_minutes, self.events[-1].timestamp)
            if self.truncated and self.events
            else self.window_minutes
        )
        return SimulationTrace(
            events=self.events,
            duration_minutes=covered,
            replication_index=replication_index,
            total_replications=total_replications,
            truncated=self.truncated,
            station_ids=station_ids,
        )


def derive_replication_seed(master_seed: int, replication_index: int) -> int:
    """Ana tohumdan belirli bir replikasyonun tohumunu deterministik olarak türetir.

    Monte Carlo'da her replikasyon farklı rastgele sayılarla çalışmalıdır; ancak
    tüm koşum, tek bir ana tohumdan birebir tekrarlanabilir olmalıdır
    (Şartname TEST 5). SHA-256 tabanlı türetme her iki koşulu da sağlar ve
    ardışık tohumların (seed, seed+1, ...) Mersenne Twister'da yaratabildiği
    başlangıç durumu benzerliği sorununu ortadan kaldırır.

    Args:
        master_seed: Konfigürasyondaki ana tohum.
        replication_index: 0'dan başlayan replikasyon sırası.

    Returns:
        Bu replikasyona ait etkin tohum.
    """
    digest = hashlib.sha256(f"{master_seed}:replication:{replication_index}".encode()).digest()
    return int.from_bytes(digest[:8], "big") >> (64 - SEED_BITS)


class SimulationEngine:
    """Tek bir replikasyonu çalıştıran kesikli olay simülasyon motoru.

    Bir motor örneği **tek kullanımlıktır**: `run()` bir kez çağrılabilir.
    Monte Carlo tekrarları için her replikasyonda yeni bir motor kurulur; bu,
    replikasyonlar arasında durum sızıntısı olmasını yapısal olarak imkânsız
    kılar.
    """

    def __init__(
        self,
        config: SimulationConfig,
        replication_index: int = 0,
        master_seed: Optional[int] = None,
        trace_collector: Optional[EventTraceCollector] = None,
    ) -> None:
        """Motoru konfigürasyondan kurar (henüz çalıştırmaz).

        Args:
            config: Doğrulanmış simülasyon konfigürasyonu.
            replication_index: Monte Carlo replikasyon sırası (0'dan başlar).
            master_seed: Ana tohum; verilmezse `config.random_seed`, o da yoksa
                kriptografik olarak rastgele bir tohum kullanılır. Etkin tohum
                sonuçta raporlanır, böylece herhangi bir koşum sonradan birebir
                tekrarlanabilir.
            trace_collector: Verilirse olaylar görselleştirme için kaydedilir.
                Gözlemci simülasyonun sonucunu **etkilemez**; yalnızca
                gerçekleşmiş olayları dinler.
        """
        self.config = config
        self.replication_index = replication_index
        self._trace = trace_collector

        effective_master = master_seed if master_seed is not None else config.random_seed
        if effective_master is None:
            effective_master = random.SystemRandom().getrandbits(SEED_BITS)
        self._master_seed: int = int(effective_master)
        self._seed: int = derive_replication_seed(self._master_seed, replication_index)

        self._streams = RandomStreamFactory(self._seed)
        self.clock = SimulationClock()
        self.events = EventQueue()

        self._warnings: List[str] = []
        self._has_run = False

        # --- Sistem geneli sayaçlar ve toplayıcılar ---
        self._next_entity_id = 1
        self._wip = 0
        self._wip_accumulator = TimeWeightedAccumulator(self.clock, initial_value=0.0)
        self._flow_time_tally = Tally()
        self._entities_created = 0
        self._entities_admitted = 0
        self._entities_rejected = 0
        self._entities_departed = 0
        self._entities_scrapped = 0
        self._window_start = 0.0
        self._window_end = 0.0

        self._build_model()

        #: Olay türünden işleyiciye eşleme; ana döngünün tek dallanma noktası.
        self._handlers: Dict[EventType, Callable[[Event], None]] = {
            EventType.ARRIVAL: self._handle_arrival,
            EventType.SERVICE_COMPLETE: self._handle_service_complete,
            EventType.FAILURE: self._handle_failure,
            EventType.REPAIR_COMPLETE: self._handle_repair_complete,
            EventType.WARMUP_END: self._handle_warmup_end,
        }

    # ================================================================== #
    # Model kurulumu
    # ================================================================== #
    def _build_model(self) -> None:
        """İstasyonları, dağılımları, yönlendirme tablolarını ve akışları kurar."""
        self.stations: Dict[str, Station] = {}
        self._station_order: List[Station] = []

        for order, station_config in enumerate(self.config.stations):
            service_distribution = create_distribution(
                station_config.service_time_distribution,
                self._streams.stream(f"service:{station_config.id}"),
            )
            time_to_failure = None
            repair_time = None
            if station_config.failure_rate is not None:
                # Arızalar arası süre Exp(MTBF); MTBF = 1 / failure_rate.
                time_to_failure = ExponentialDistribution(
                    mean=1.0 / station_config.failure_rate,
                    rng=self._streams.stream(f"failure:{station_config.id}"),
                )
                repair_time = create_distribution(
                    station_config.repair_time_distribution,  # type: ignore[arg-type]
                    self._streams.stream(f"repair:{station_config.id}"),
                )

            station = Station(
                config=station_config,
                clock=self.clock,
                service_distribution=service_distribution,
                time_to_failure_distribution=time_to_failure,
                repair_time_distribution=repair_time,
                order=order,
            )
            self.stations[station.id] = station
            self._station_order.append(station)

        self._arrival_distribution = create_distribution(
            self.config.arrival_process.distribution, self._streams.stream("arrival")
        )
        self._validate_model_references()
        self._entry_station = self.stations[self.config.arrival_process.entry_station_id]

        self._build_routing()
        self._build_upstream_map()
        self._build_scrap_streams()

    def _build_scrap_streams(self) -> None:
        """Fire modeli etkin olan istasyonlara ayrı rastgele sayı akışı ayırır.

        Akış yalnızca `scrap_rate > 0` olan istasyonlar için oluşturulur ve
        yalnızca o istasyonlarda çekim yapılır. Fire içermeyen bir modelin
        rastgele sayı dizisi böylece hiç değişmez; fire alanı eklenmeden önce
        üretilmiş sonuçlar birebir tekrarlanabilir kalır.
        """
        self._scrap_rng: Dict[str, random.Random] = {}
        for station in self._station_order:
            if station.produces_scrap:
                self._scrap_rng[station.id] = self._streams.stream(f"scrap:{station.id}")

    def _validate_model_references(self) -> None:
        """Konfigürasyondaki istasyon atıflarının çözülebildiğini doğrular.

        Bu denetim `SimulationConfig` doğrulayıcısını tekrarlar gibi görünse de
        gereklidir: Pydantic'in `model_copy(update=...)` metodu doğrulayıcıları
        **çalıştırmaz**, dolayısıyla programla üretilen tutarsız bir
        konfigürasyon motora ulaşabilir. Böyle bir durumda anlaşılmaz bir
        `KeyError` yerine sorunu adıyla söyleyen bir hata verilir.

        Raises:
            ValueError: Giriş istasyonu veya bir bağlantı ucu tanımlı değilse.
        """
        known = set(self.stations)
        entry_id = self.config.arrival_process.entry_station_id
        if entry_id not in known:
            raise ValueError(
                f"Varis sureci '{entry_id}' istasyonuna giris yapiyor ancak boyle "
                f"bir istasyon tanimli degil. Tanimli istasyonlar: {sorted(known)}."
            )
        for connection in self.config.connections:
            if connection.from_station_id not in known:
                raise ValueError(
                    f"Baglanti kaynagi '{connection.from_station_id}' tanimli degil. "
                    f"Tanimli istasyonlar: {sorted(known)}."
                )
            if connection.to_station_id not in known:
                raise ValueError(
                    f"Baglanti hedefi '{connection.to_station_id}' tanimli degil. "
                    f"Tanimli istasyonlar: {sorted(known)}."
                )

    def _build_routing(self) -> None:
        """Her istasyon için kümülatif yönlendirme tablosunu hazırlar.

        Tablo, `(hedef_istasyon_id, kümülatif_olasılık)` çiftlerinden oluşur.
        Kümülatif toplam 1.0'dan küçükse kalan olasılık **sistemden çıkış**
        anlamına gelir (hattın sonu ya da hurdaya ayırma).
        """
        self._routing: Dict[str, List[tuple[str, float]]] = {}
        self._routing_is_deterministic: Dict[str, bool] = {}
        self._routing_rng: Dict[str, random.Random] = {}

        for station_config in self.config.stations:
            cumulative = 0.0
            table: List[tuple[str, float]] = []
            for connection in self.config.outgoing_connections(station_config.id):
                cumulative += connection.routing_probability
                table.append((connection.to_station_id, cumulative))
            self._routing[station_config.id] = table

            # Tek çıkış ve olasılık 1.0 ise yönlendirme deterministiktir; bu
            # durumda rastgele sayı harcanmaz. Gereksiz çekim yapmak, modelin
            # geri kalanının sayı dizisini kaydırmadan da olsa boşuna maliyettir.
            self._routing_is_deterministic[station_config.id] = not table or (
                len(table) == 1 and table[0][1] >= 1.0 - ROUTING_PROBABILITY_TOLERANCE
            )
            self._routing_rng[station_config.id] = self._streams.stream(
                f"routing:{station_config.id}"
            )

    def _build_upstream_map(self) -> None:
        """Her istasyon için, ona besleme yapan istasyonların listesini çıkarır.

        Bir istasyonda yer açıldığında hangi yukarı akış istasyonlarının
        blokajının çözülebileceğini bulmak için kullanılır.
        """
        self._upstream: Dict[str, List[Station]] = {s.id: [] for s in self._station_order}
        for connection in self.config.connections:
            upstream_station = self.stations[connection.from_station_id]
            targets = self._upstream[connection.to_station_id]
            if upstream_station not in targets:
                targets.append(upstream_station)

    # ================================================================== #
    # Kararlılık ön denetimi (Şartname TEST 3)
    # ================================================================== #
    def _solve_visit_ratios(self) -> tuple[Dict[str, float], bool]:
        """Trafik denklemlerini v = e + v*P yinelemeli olarak çözer.

        Açık kuyruk ağlarında bir istasyonun ziyaret oranı v_j, dışarıdan gelen
        akış (giriş istasyonu için 1, diğerleri için 0) ile diğer istasyonlardan
        yönlendirilen akışların toplamıdır (Jackson 1957). Jacobi yinelemesi,
        her istasyondan sisteme çıkış yolu bulunduğu sürece yakınsar.

        Fire, akışı azaltan bir çıkış kanalıdır: `scrap_rate` oranındaki parça
        hattan çıkarıldığı için bir istasyondan **çıkan** akış, gelen akışın
        (1 - scrap_rate) katıdır. Bu düzeltme yapılmazsa fireli hatlarda aşağı
        akış istasyonlarının yükü olduğundan yüksek hesaplanır ve kararlı bir
        model yanlışlıkla kararsız ilan edilir.

        Returns:
            (ziyaret oranları, yakınsadı mı) ikilisi. Yakınsama olmaması,
            yönlendirme grafında çıkışı olmayan bir döngü bulunduğunu gösterir;
            böyle bir modelde parçalar sistemi hiç terk edemez.
        """
        entry_id = self.config.arrival_process.entry_station_id
        visits: Dict[str, float] = {station.id: 0.0 for station in self._station_order}
        visits[entry_id] = 1.0
        survival = {
            station.id: 1.0 - station.scrap_rate for station in self._station_order
        }

        for _ in range(MAX_TRAFFIC_EQUATION_ITERATIONS):
            updated: Dict[str, float] = {station.id: 0.0 for station in self._station_order}
            updated[entry_id] += 1.0
            for connection in self.config.connections:
                updated[connection.to_station_id] += (
                    visits[connection.from_station_id]
                    * connection.routing_probability
                    * survival[connection.from_station_id]
                )
            delta = max(abs(updated[sid] - visits[sid]) for sid in updated)
            visits = updated
            if delta < TRAFFIC_EQUATION_TOLERANCE:
                return visits, True
        return visits, False

    def _upstream_closure(self, station_id: str) -> set[str]:
        """Verilen istasyona ulaşabilen tüm istasyonları döndürür (kendisi dahil).

        Yönlendirme grafında ters yönde arama yapar. Aşırı yüklü bir istasyonun
        önünde biriken işin nereye gideceğini belirlemek için kullanılır: iş,
        ancak bu kümedeki istasyonlardan geçerek oraya ulaşabilir.
        """
        reachable = {station_id}
        frontier = [station_id]
        while frontier:
            current = frontier.pop()
            for connection in self.config.connections:
                if (
                    connection.to_station_id == current
                    and connection.from_station_id not in reachable
                ):
                    reachable.add(connection.from_station_id)
                    frontier.append(connection.from_station_id)
        return reachable

    def _check_stability(self) -> StabilityCheck:
        """Simülasyon öncesi teorik istasyon yüklerini hesaplar ve uyarı üretir.

        Her istasyon için:

            rho_j = lambda * v_j / (c_j * mu_j * A_j)

        burada lambda dış varış hızı, v_j ziyaret oranı, c_j sunucu sayısı,
        mu_j = 1 / E[işlem süresi] hizmet hızı ve A_j = MTBF / (MTBF + MTTR)
        arızalardan kaynaklanan kullanılabilirliktir.

        rho_j >= 1 olan bir istasyon iki farklı duruma yol açar ve bunları
        ayırmak şarttır:

        **Kararsız.** İstasyona ulaşabilen istasyonlardan (kendisi dahil)
        herhangi birinin tamponu sınırsızsa, karşılanamayan iş orada birikir.
        Kuyruk sınırsız büyür, kararlı durum ortalamaları tanımsızdır.

        **Kapasite sınırlı.** İstasyonun ve ona ulaşabilen tüm istasyonların
        tamponu sonluysa, iş hiçbir yerde sınırsız birikemez: fazla parça
        girişte reddedilir. Sistem kararlıdır ve kararlı duruma yakınsar;
        M/M/1/K modelinin tam olarak tarif ettiği durumdur. Bu ayrım
        yapılmazsa, tamamen kararlı ve kapalı formuyla birebir uyuşan bir
        sisteme "kuyruk sinirsiz buyuyecek" denir.
        """
        arrival_rate = self._arrival_distribution.rate()
        visits, converged = self._solve_visit_ratios()

        messages: List[str] = []
        loads: Dict[str, float] = {}
        unstable: List[str] = []
        capacity_limited: List[str] = []
        rejection_rates: Dict[str, float] = {}

        if not converged:
            messages.append(
                "Yonlendirme grafi cozulemedi: sistemden cikis yolu olmayan bir dongu "
                "var gorunuyor. Parcalar sistemi terk edemeyecegi icin model kararsizdir."
            )

        for station in self._station_order:
            effective_capacity = (
                station.resource.capacity
                * station.service_rate
                * station.theoretical_availability
            )
            if effective_capacity <= 0.0:
                load = float("inf")
            else:
                load = arrival_rate * visits[station.id] / effective_capacity
            loads[station.id] = load

            if load < STABILITY_UTILIZATION_LIMIT:
                continue

            unbounded_sources = sorted(
                other_id
                for other_id in self._upstream_closure(station.id)
                if self.stations[other_id].config.has_infinite_buffer
            )

            if unbounded_sources:
                unstable.append(station.id)
                messages.append(
                    self._unbounded_growth_message(station, load, unbounded_sources)
                )
            else:
                capacity_limited.append(station.id)
                system_capacity = (
                    station.config.buffer_capacity_before + station.resource.capacity
                )
                blocking = finite_buffer_blocking_probability(load, system_capacity)
                rejection_rates[station.id] = blocking
                messages.append(
                    self._capacity_limited_message(
                        station, load, system_capacity, blocking
                    )
                )

        return StabilityCheck(
            is_stable=converged and not unstable,
            arrival_rate=arrival_rate,
            station_loads=loads,
            visit_ratios=visits,
            unstable_station_ids=unstable,
            capacity_limited_station_ids=capacity_limited,
            estimated_rejection_rates=rejection_rates,
            messages=messages,
        )

    @staticmethod
    def _unbounded_growth_message(
        station: Station, load: float, unbounded_sources: List[str]
    ) -> str:
        """Sınırsız birikim uyarısını, birikimin nerede olacağını da söyleyerek üretir."""
        message = (
            f"KARARSIZ SISTEM: '{station.id}' ({station.name}) istasyonunun "
            f"teorik yuku rho = {load:.4f} >= 1. Bu istasyona gelen is, "
            f"islenebilecegi hizdan fazla; kuyruk sinirsiz buyuyecek ve "
            f"ortalama bekleme suresi hicbir degere yakinsamayacaktir. "
            f"Sunucu sayisini artirin, islem suresini kisaltin veya varis "
            f"hizini dusurun."
        )
        others = [item for item in unbounded_sources if item != station.id]
        if others:
            message += (
                f" Bu istasyonun tamponu sonlu olsa da, kendisine besleme yapan "
                f"{others} istasyonlarinin tamponu sinirsiz oldugu icin birikim "
                f"orada olusacaktir."
            )
        return message

    @staticmethod
    def _capacity_limited_message(
        station: Station, load: float, system_capacity: int, blocking: float
    ) -> str:
        """Kapasite sınırlı ama kararlı sistem için açıklama üretir."""
        saturation_loss = 1.0 - 1.0 / load if load > 0.0 else 1.0
        return (
            f"KAPASITE SINIRLI: '{station.id}' ({station.name}) istasyonunun "
            f"teorik yuku rho = {load:.4f} >= 1, ancak sistemdeki azami parca "
            f"sayisi {system_capacity} ile sinirli (tampon "
            f"{station.config.buffer_capacity_before} + {station.resource.capacity} "
            f"sunucu). Kuyruk sinirsiz buyuyemez; sistem KARARLIDIR ve kararli "
            f"duruma yakinsar. Bedeli talebin bir kisminin karsilanamamasidir: "
            f"M/M/1/K yaklasimiyla gelen parcalarin yaklasik "
            f"%{blocking * 100:.1f}'i sisteme alinamayacak (doygunluk sinirinda "
            f"kayip orani en az %{saturation_loss * 100:.1f}'dir). Ciktiyi "
            f"artirmak icin bu istasyonun kapasitesi yukseltilmelidir; tamponu "
            f"buyutmek yalnizca bekleyen parca sayisini artirir, ciktiyi "
            f"degistirmez."
        )

    # ================================================================== #
    # Çalıştırma
    # ================================================================== #
    def run(self) -> ReplicationResult:
        """Simülasyonu baştan sona çalıştırır ve ham sonuçları döndürür.

        Returns:
            Bu replikasyonun tüm ham gözlemleri.

        Raises:
            RuntimeError: Motor daha önce çalıştırılmışsa veya kararsız model
                nedeniyle sistemdeki parça sayısı güvenlik tavanını aşarsa.
        """
        if self._has_run:
            raise RuntimeError(
                "Bir SimulationEngine ornegi yalnizca bir kez calistirilabilir. "
                "Yeni bir replikasyon icin yeni bir motor kurun."
            )
        self._has_run = True

        started_at = time.perf_counter()
        stability = self._check_stability()
        for message in stability.messages:
            logger.warning(message)
            self._warnings.append(message)

        self._schedule_initial_events()
        self._event_loop()
        self._finalize()

        return self._build_result(stability, time.perf_counter() - started_at)

    def _schedule_initial_events(self) -> None:
        """İlk varışı, ısınma sonunu ve simülasyon sonunu kuyruğa koyar.

        İlk varış t = 0 anında değil, bir varışlar arası süre sonra planlanır:
        Poisson sürecinde t = 0'da bir varış olması olasılığı sıfırdır ve
        sistemi t = 0'da doldurmak varış hızını yapay olarak yükseltir.
        """
        self._window_start = self.clock.now
        self.events.schedule(
            self.clock.now + self._arrival_distribution.sample_duration(), EventType.ARRIVAL
        )

        for station in self._station_order:
            if station.has_failure_model:
                for server in station.resource.servers:
                    self._schedule_failure(station, server)

        if self.config.warmup_period_minutes > 0.0:
            self.events.schedule(self.config.warmup_period_minutes, EventType.WARMUP_END)
        self.events.schedule(self.config.simulation_duration_minutes, EventType.SIMULATION_END)

    def _event_loop(self) -> None:
        """Ana döngü: en erken olayı al, saati ilerlet, işleyiciyi çağır."""
        while True:
            event = self.events.pop()
            if event is None:
                self._warnings.append(
                    "Olay kuyrugu simulasyon suresi dolmadan bosaldi; sonuclar kisa "
                    "bir pencereyi temsil ediyor olabilir."
                )
                break
            self.clock.advance_to(event.time)
            if event.event_type is EventType.SIMULATION_END:
                break
            self._handlers[event.event_type](event)

    def _finalize(self) -> None:
        """Saati simülasyon sonuna taşır ve tüm toplayıcıları kapatır."""
        self.clock.advance_to(self.config.simulation_duration_minutes)
        for station in self._station_order:
            station.finalize_statistics()
        self._wip_accumulator.finalize()
        self._window_end = self.clock.now

    # ================================================================== #
    # Olay işleyicileri
    # ================================================================== #
    def _handle_arrival(self, event: Event) -> None:
        """Sisteme yeni bir parça girişini işler ve bir sonraki varışı planlar."""
        now = self.clock.now
        entity = Entity(id=self._next_entity_id, created_at=now)
        self._next_entity_id += 1
        self._entities_created += 1

        # Bir sonraki varış, mevcut varış işlenmeden önce planlanır; böylece
        # varış süreci, sistemin doluluk durumundan bağımsız kalır.
        self.events.schedule(
            now + self._arrival_distribution.sample_duration(), EventType.ARRIVAL
        )

        self._observe(entity.id, "arrival")

        if self._try_enter_station(entity, self._entry_station):
            self._entities_admitted += 1
            self._change_wip(+1)
        else:
            # Giriş tamponu dolu: parça kaybedilir (loss system davranışı).
            entity.state = EntityState.REJECTED
            self._entry_station.rejected += 1
            self._entities_rejected += 1

    def _handle_service_complete(self, event: Event) -> None:
        """Bir sunucunun işini bitirmesini işler ve parçayı ilerletir."""
        station = self.stations[event.station_id]  # type: ignore[index]
        server = station.resource.servers[event.server_index]  # type: ignore[index]
        entity = server.current_entity
        if entity is None:  # pragma: no cover - iptal mantığı bunu engeller
            raise RuntimeError(
                f"'{station.id}#{server.index}' sunucusunda parca yokken islem "
                f"tamamlanma olayi islendi."
            )

        server.service_complete_event = None
        server.remaining_service_minutes = 0.0

        station.service_completions += 1
        station.service_time_tally.record(server.assigned_service_minutes)
        entity.total_service_minutes += server.assigned_service_minutes
        self._observe(entity.id, "service_end", station.id)

        # Hurda kontrolü işlemden **sonra** yapılır: kusurlu parça da sunucuyu
        # tam işlem süresi boyunca meşgul etmiştir ve üretilen birim olarak
        # sayılır. OEE'nin Quality bileşeni tam olarak bu kaybı ölçer.
        if self._is_scrapped(station):
            station.units_scrapped += 1
            self._release_server(station, server)
            self._scrap_entity(entity)
            return

        self._advance_entity(station, server, entity)

    def _is_scrapped(self, station: Station) -> bool:
        """Tamamlanan bir işin hurdaya ayrılıp ayrılmadığına karar verir."""
        if not station.produces_scrap:
            return False
        return self._scrap_rng[station.id].random() < station.scrap_rate

    def _handle_failure(self, event: Event) -> None:
        """Bir sunucunun arızalanmasını işler (preempt-resume)."""
        station = self.stations[event.station_id]  # type: ignore[index]
        server = station.resource.servers[event.server_index]  # type: ignore[index]
        now = self.clock.now

        server.failure_event = None
        station.failure_count += 1
        server.state_before_failure = server.state

        if server.state is ServerState.BUSY and server.service_complete_event is not None:
            # Kesintiye uğrayan iş kaybolmaz: kalan süre saklanır ve onarımdan
            # sonra kaldığı yerden devam eder.
            remaining = max(server.service_complete_event.time - now, 0.0)
            self.events.cancel(server.service_complete_event)
            server.service_complete_event = None
            server.remaining_service_minutes = remaining

        station.resource.set_state(server, ServerState.DOWN)

        repair_minutes = station.repair_time_distribution.sample_duration()  # type: ignore[union-attr]
        server.pending_repair_minutes = repair_minutes
        server.repair_event = self.events.schedule(
            now + repair_minutes,
            EventType.REPAIR_COMPLETE,
            station_id=station.id,
            server_index=server.index,
        )

    def _handle_repair_complete(self, event: Event) -> None:
        """Onarımın bitmesini işler ve sunucuyu arıza öncesi durumuna döndürür."""
        station = self.stations[event.station_id]  # type: ignore[index]
        server = station.resource.servers[event.server_index]  # type: ignore[index]
        now = self.clock.now

        server.repair_event = None
        station.repair_time_tally.record(server.pending_repair_minutes)
        server.pending_repair_minutes = 0.0

        previous_state = server.state_before_failure
        server.state_before_failure = None

        if previous_state is ServerState.BUSY and server.current_entity is not None:
            station.resource.set_state(server, ServerState.BUSY)
            server.service_complete_event = self.events.schedule(
                now + server.remaining_service_minutes,
                EventType.SERVICE_COMPLETE,
                station_id=station.id,
                server_index=server.index,
                entity=server.current_entity,
            )
        elif previous_state is ServerState.BLOCKED and server.current_entity is not None:
            station.resource.set_state(server, ServerState.BLOCKED)
            self._attempt_blocked_transfer(station, server)
        else:
            station.resource.set_state(server, ServerState.IDLE)
            self._pull_next_job(station)
            self._notify_space_available(station)

        # Arıza sayacı onarım bitiminden itibaren yeniden başlar; böylece
        # kullanılabilirlik A = MTBF / (MTBF + MTTR) ilişkisi korunur.
        self._schedule_failure(station, server)

    def _handle_warmup_end(self, event: Event) -> None:
        """Isınma periyodunun sonunda tüm istatistikleri sıfırlar."""
        logger.debug("Isinma periyodu bitti (t=%.4f); istatistikler sifirlaniyor.", event.time)
        for station in self._station_order:
            station.reset_statistics()
        self._wip_accumulator.reset()
        self._flow_time_tally.reset()
        self._entities_created = 0
        self._entities_admitted = 0
        self._entities_rejected = 0
        self._entities_departed = 0
        self._entities_scrapped = 0
        self._window_start = self.clock.now

    # ================================================================== #
    # Parça akışı
    # ================================================================== #
    def _try_enter_station(self, entity: Entity, station: Station) -> bool:
        """Parçayı istasyona sokmayı dener.

        Öncelik sırası FIFO adaletini korur: kuyruk boş **ve** boşta sunucu varsa
        parça doğrudan hizmete girer (sıfır bekleme kaydedilir); aksi hâlde
        tampona alınır. Kuyruk doluysa parça kabul edilmez.

        Returns:
            Parça istasyona alındıysa True.
        """
        if station.buffer.is_empty:
            server = station.resource.available_server()
            if server is not None:
                station.entries += 1
                entity.visited_station_ids.append(station.id)
                station.buffer.record_zero_wait()
                self._start_service(station, server, entity)
                return True

        if station.buffer.enqueue(entity):
            station.entries += 1
            entity.current_station_id = station.id
            entity.visited_station_ids.append(station.id)
            self._observe(entity.id, "queue_enter", station.id)
            return True

        return False

    def _start_service(
        self,
        station: Station,
        server: Server,
        entity: Entity,
        remaining_minutes: Optional[float] = None,
    ) -> None:
        """Parçayı sunucuya yerleştirir ve tamamlanma olayını planlar."""
        now = self.clock.now
        entity.state = EntityState.IN_SERVICE
        entity.current_station_id = station.id

        server.current_entity = entity
        station.resource.set_state(server, ServerState.BUSY)

        duration = (
            remaining_minutes
            if remaining_minutes is not None
            else station.service_distribution.sample_duration()
        )
        server.assigned_service_minutes = duration
        server.remaining_service_minutes = duration
        # Kesintiye ugramis bir isin onarim sonrasi devami yeni bir islem
        # baslangici degildir; iz yalnizca gercek baslangici kaydeder.
        if remaining_minutes is None:
            self._observe(entity.id, "service_start", station.id)
        server.service_complete_event = self.events.schedule(
            now + duration,
            EventType.SERVICE_COMPLETE,
            station_id=station.id,
            server_index=server.index,
            entity=entity,
        )

    def _advance_entity(self, station: Station, server: Server, entity: Entity) -> None:
        """İşlemi biten parçayı bir sonraki istasyona veya sistem dışına yollar."""
        target = self._select_next_station(station)

        if target is None:
            self._release_server(station, server)
            self._depart_system(entity)
            return

        if self._try_enter_station(entity, target):
            self._release_server(station, server)
            return

        # Hedef istasyon dolu: sunucu parçayı üzerinde tutmak zorunda kalır
        # (blocking after service). Sunucu ne çalışır ne boştadır.
        entity.state = EntityState.BLOCKED
        server.blocked_since = self.clock.now
        server.blocked_target_station_id = target.id
        station.resource.set_state(server, ServerState.BLOCKED)
        self._observe(entity.id, "blocked", station.id)

    def _release_server(self, station: Station, server: Server) -> None:
        """Sunucuyu boşaltır, kuyruktan yeni iş çeker ve yukarı akışı bilgilendirir."""
        if server.blocked_since is not None and server.current_entity is not None:
            server.current_entity.total_blocked_minutes += self.clock.now - server.blocked_since

        server.current_entity = None
        server.assigned_service_minutes = 0.0
        server.remaining_service_minutes = 0.0
        server.blocked_since = None
        server.blocked_target_station_id = None
        station.resource.set_state(server, ServerState.IDLE)

        self._pull_next_job(station)
        self._notify_space_available(station)

    def _pull_next_job(self, station: Station) -> None:
        """Boşta sunucu kaldığı sürece kuyruktan iş çeker.

        Değişmez (invariant): tampon boş değilken boşta ve arızasız bir sunucu
        bulunamaz. Bu değişmez korunmazsa kullanım oranı ve bekleme süresi
        istatistikleri birbirinden kopar ve M/M/1 doğrulaması başarısız olur.
        """
        while not station.buffer.is_empty:
            server = station.resource.available_server()
            if server is None:
                return
            entity = station.buffer.dequeue()
            if entity is None:  # pragma: no cover - döngü koşulu bunu engeller
                return
            self._observe(entity.id, "queue_exit", station.id)
            self._start_service(station, server, entity)

    def _notify_space_available(self, station: Station) -> None:
        """İstasyonda yer açıldığında, blokajda bekleyen yukarı akışı çözer.

        Adalet için adaylar blokaja girme zamanına göre sıralanır; eşitlik
        durumunda konfigürasyon sırası ve sunucu indisi kullanılır, böylece
        sonuç tamamen deterministik olur.

        Özyineleme derinliği hat uzunluğuyla sınırlıdır: her başarılı aktarım
        bir yukarı akış sunucusunu boşaltır ve bu, en fazla istasyon sayısı
        kadar zincirlenebilir.
        """
        if not station.can_accept():
            return

        candidates: List[tuple[float, int, int, Station, Server]] = []
        for upstream in self._upstream[station.id]:
            for server in upstream.resource.servers:
                if server.blocked_target_station_id != station.id:
                    continue
                if server.state is ServerState.DOWN:
                    # Arızalı sunucu, onarımı bitince yeniden deneyecek.
                    continue
                candidates.append(
                    (server.blocked_since or 0.0, upstream.order, server.index, upstream, server)
                )

        candidates.sort(key=lambda item: (item[0], item[1], item[2]))
        for _, _, _, upstream, server in candidates:
            if not station.can_accept():
                return
            # Özyinelemeli çözülme sırasında durum değişmiş olabilir.
            if server.blocked_target_station_id != station.id or server.current_entity is None:
                continue
            self._attempt_blocked_transfer(upstream, server)

    def _attempt_blocked_transfer(self, station: Station, server: Server) -> bool:
        """Bloke bir sunucudaki parçayı hedefe aktarmayı dener.

        Returns:
            Aktarım gerçekleştiyse True.
        """
        target_id = server.blocked_target_station_id
        entity = server.current_entity
        if target_id is None or entity is None:
            return False

        target = self.stations[target_id]
        if not self._try_enter_station(entity, target):
            return False

        self._release_server(station, server)
        return True

    def _select_next_station(self, station: Station) -> Optional[Station]:
        """Yönlendirme olasılıklarına göre bir sonraki istasyonu seçer.

        Returns:
            Hedef istasyon; parça sistemi terk edecekse `None`.
        """
        table = self._routing[station.id]
        if not table:
            return None
        if self._routing_is_deterministic[station.id]:
            return self.stations[table[0][0]]

        draw = self._routing_rng[station.id].random()
        for target_id, cumulative in table:
            if draw < cumulative:
                return self.stations[target_id]
        # Kümülatif toplam 1.0'dan küçük: kalan olasılık sistemden çıkıştır.
        return None

    def _depart_system(self, entity: Entity) -> None:
        """Parçanın iyi ürün olarak sistemden çıkışını kaydeder."""
        self._remove_from_system(entity, EntityState.DEPARTED)

    def _scrap_entity(self, entity: Entity) -> None:
        """Hurdaya ayrılan parçayı hattan çıkarır.

        Hurda parça bir sonraki istasyona **gitmez**; sistemi o anda terk eder.
        Akış süresi gözlemi yine kaydedilir: parça sistemde gerçek bir süre
        geçirmiştir ve Little's Law özdeşliğinin sağlanması için bu sürenin
        sayılması gerekir.
        """
        self._entities_scrapped += 1
        self._remove_from_system(entity, EntityState.SCRAPPED)

    def _observe(
        self, entity_id: int, event_type: str, station_id: Optional[str] = None
    ) -> None:
        """Gözlemciye bir olay bildirir; gözlemci yoksa hiçbir şey yapmaz.

        Bu metot simülasyonun akışına katılmaz: dönüş değeri yoktur, rastgele
        sayı çekmez ve hiçbir kararı etkilemez. Motorun mantığı gözlemcinin
        varlığından tümüyle bağımsızdır.
        """
        if self._trace is not None:
            self._trace.record(self.clock.now, entity_id, event_type, station_id)

    def _remove_from_system(self, entity: Entity, final_state: EntityState) -> None:
        """Parçayı sistemden çıkarır ve akış süresi gözlemini üretir."""
        self._observe(entity.id, "system_exit", entity.current_station_id)
        entity.state = final_state
        entity.departed_at = self.clock.now
        entity.current_station_id = None
        self._change_wip(-1)
        self._entities_departed += 1
        flow_time = entity.flow_time
        if flow_time is not None:
            self._flow_time_tally.record(flow_time)

    def _change_wip(self, delta: int) -> None:
        """Sistemdeki parça sayısını günceller ve zaman integraline işler."""
        self._wip += delta
        if self._wip > MAX_ENTITIES_IN_SYSTEM:
            raise RuntimeError(
                f"Sistemdeki parca sayisi guvenlik tavanini ({MAX_ENTITIES_IN_SYSTEM}) asti. "
                f"Bu neredeyse her zaman kararsiz bir modelin (rho >= 1) belirtisidir; "
                f"kararlilik denetimi uyarilarini kontrol edin."
            )
        self._wip_accumulator.observe(self._wip)

    def _schedule_failure(self, station: Station, server: Server) -> None:
        """Bir sunucu için sıradaki arızayı planlar (arıza modeli varsa)."""
        if not station.has_failure_model:
            return
        delay = station.time_to_failure_distribution.sample_duration()  # type: ignore[union-attr]
        server.failure_event = self.events.schedule(
            self.clock.now + delay,
            EventType.FAILURE,
            station_id=station.id,
            server_index=server.index,
        )

    # ================================================================== #
    # Sonuç derleme
    # ================================================================== #
    def _build_result(self, stability: StabilityCheck, wall_clock_seconds: float) -> ReplicationResult:
        """Ham gözlemleri `ReplicationResult` şemasına dönüştürür."""
        window = self._window_end - self._window_start
        return ReplicationResult(
            replication_index=self.replication_index,
            seed=self._seed,
            system=self._build_system_metrics(window),
            stations=[self._build_station_metrics(s, window) for s in self._station_order],
            stability=stability,
            events_processed=self.events.processed_total,
            simulated_minutes=self.clock.now,
            wall_clock_seconds=wall_clock_seconds,
            warnings=list(self._warnings),
        )

    def _build_system_metrics(self, window: float) -> SystemRunMetrics:
        """Sistem geneli ham gözlemleri derler."""
        safe_window = window if window > 0.0 else 1.0
        return SystemRunMetrics(
            window_start_minutes=self._window_start,
            window_end_minutes=self._window_end,
            window_duration_minutes=window,
            entities_created=self._entities_created,
            entities_admitted=self._entities_admitted,
            entities_rejected=self._entities_rejected,
            entities_departed=self._entities_departed,
            entities_scrapped=self._entities_scrapped,
            entities_completed=self._entities_departed - self._entities_scrapped,
            avg_wip=self._wip_accumulator.time_average,
            max_wip=int(self._wip_accumulator.max_value),
            wip_at_end=self._wip,
            avg_flow_time=self._flow_time_tally.mean,
            flow_time_std_dev=self._flow_time_tally.std_dev,
            min_flow_time=self._flow_time_tally.minimum,
            max_flow_time=self._flow_time_tally.maximum,
            arrival_rate=self._entities_admitted / safe_window,
            effective_arrival_rate=self._entities_departed / safe_window,
            throughput_per_minute=(
                self._entities_departed - self._entities_scrapped
            ) / safe_window,
        )

    def _build_station_metrics(self, station: Station, window: float) -> StationRunMetrics:
        """Tek bir istasyonun ham gözlemlerini derler.

        `planned_production_time_minutes`, OEE'nin paydası olan planlanan üretim
        süresidir: istatistik penceresi uzunluğu x sunucu sayısı. Meşgul, bloke
        ve arızalı süreler sunucu-dakika cinsinden olduğu için aynı ölçektedir
        ve idle = planlanan - (meşgul + bloke + arızalı) özdeşliği sağlanır.
        """
        planned = window * station.resource.capacity
        busy = station.resource.busy_accumulator.area
        blocked = station.resource.blocked_accumulator.area
        down = station.resource.down_accumulator.area
        idle = max(planned - busy - blocked - down, 0.0)
        safe_planned = planned if planned > 0.0 else 1.0

        return StationRunMetrics(
            station_id=station.id,
            station_name=station.name,
            num_servers=station.resource.capacity,
            entries=station.entries,
            service_completions=station.service_completions,
            units_produced=station.service_completions,
            units_scrapped=station.units_scrapped,
            rejected=station.rejected,
            busy_minutes=busy,
            blocked_minutes=blocked,
            down_minutes=down,
            idle_minutes=idle,
            planned_production_time_minutes=planned,
            utilization=busy / safe_planned,
            blocked_fraction=blocked / safe_planned,
            availability_fraction=(planned - down) / safe_planned,
            avg_queue_length=station.buffer.length_accumulator.time_average,
            max_queue_length=int(station.buffer.length_accumulator.max_value),
            avg_wait_time=station.buffer.wait_time_tally.mean,
            max_wait_time=station.buffer.wait_time_tally.maximum,
            wait_time_observations=station.buffer.wait_time_tally.count,
            avg_service_time=station.service_time_tally.mean,
            service_time_std_dev=station.service_time_tally.std_dev,
            ideal_cycle_time=station.ideal_cycle_time,
            failure_count=station.failure_count,
            total_repair_minutes=station.repair_time_tally.total,
        )

    # ================================================================== #
    # Dışa açık yardımcılar
    # ================================================================== #
    @property
    def seed(self) -> int:
        """Bu replikasyonda kullanılan etkin tohum."""
        return self._seed

    @property
    def master_seed(self) -> int:
        """Replikasyon tohumlarının türetildiği ana tohum."""
        return self._master_seed

    def __repr__(self) -> str:
        return (
            f"SimulationEngine(stations={len(self._station_order)}, "
            f"seed={self._seed}, t={self.clock.now:.2f})"
        )


def run_replication(
    config: SimulationConfig,
    replication_index: int = 0,
    master_seed: Optional[int] = None,
) -> ReplicationResult:
    """Tek bir replikasyonu çalıştırmak için kısayol.

    `analytics/monte_carlo.py` bu fonksiyonu `config.num_replications` kez,
    artan `replication_index` ile çağırarak güven aralığı üretecektir.

    Args:
        config: Doğrulanmış simülasyon konfigürasyonu.
        replication_index: Replikasyon sırası (0'dan başlar).
        master_seed: Ana tohum; verilmezse `config.random_seed` kullanılır.

    Returns:
        Replikasyonun ham sonuçları.
    """
    return SimulationEngine(
        config, replication_index=replication_index, master_seed=master_seed
    ).run()


def capture_trace(
    config: SimulationConfig,
    master_seed: Optional[int] = None,
    replication_index: int = 0,
    window_minutes: float = DEFAULT_TRACE_WINDOW_MINUTES,
) -> SimulationTrace:
    """Bir replikasyonun ilk penceresindeki olayları kaydeder.

    Simülasyon, izin kapsadığı süre kadar **kısaltılarak** yeniden çalıştırılır.
    Bu, olayları saklamak yerine yeniden üretmeyi mümkün kılar ve iki nedenle
    tercih edilmiştir:

    1. **Kayıt maliyeti sıfırdır.** İz yüz binlerce bayt tutar; her simülasyonla
       birlikte saklanması veritabanını hızla şişirirdi. Oysa aynı tohumla
       yeniden çalıştırmak birkaç saniye sürer ve yalnızca kullanıcı animasyonu
       istediğinde yapılır.
    2. **Sonuçla tutarlılığı garantidir.** Tohum türetmesi deterministik olduğu
       için yeniden üretilen olaylar, raporlanan istatistikleri üreten koşumun
       ta kendisidir.

    Süreyi kısaltmak olay dizisini değiştirmez: rastgele sayı akışları tohum ve
    etikete göre türetilir, süreye bağlı değildir; ısınma periyodu yalnızca
    istatistikleri sıfırlar ve hiç rastgele sayı harcamaz. Bu nedenle kısaltılmış
    koşumun ilk N dakikası, tam koşumun ilk N dakikasıyla birebir aynıdır — bu
    özellik testle doğrulanır.

    Args:
        config: Simülasyon konfigürasyonu.
        master_seed: Ana tohum; verilmezse `config.random_seed` kullanılır.
        replication_index: İzi alınacak replikasyon.
        window_minutes: Kaydın kapsayacağı süre.

    Returns:
        Olay izi.
    """
    window = min(window_minutes, config.simulation_duration_minutes)
    # Isınma sıfırlanır: bu koşumdan istatistik değil yalnızca olaylar alınır ve
    # şema ısınmanın süreden kısa olmasını şart koşar.
    truncated_config = config.model_copy(
        update={
            "simulation_duration_minutes": window,
            "warmup_period_minutes": 0.0,
        }
    )

    collector = EventTraceCollector(window_minutes=window)
    SimulationEngine(
        truncated_config,
        replication_index=replication_index,
        master_seed=master_seed,
        trace_collector=collector,
    ).run()

    return collector.build(
        replication_index=replication_index,
        total_replications=config.num_replications,
        station_ids=[station.id for station in config.stations],
    )
