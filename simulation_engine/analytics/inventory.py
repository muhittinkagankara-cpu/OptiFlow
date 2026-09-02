"""Klasik envanter teorisi — EOQ, güvenlik stoku, yeniden sipariş noktası.

Bu modül üretim motorundan tümüyle bağımsızdır: kapalı form formüllerden
ibarettir, simülasyon çalıştırmaz ve motorun hiçbir parçasını okumaz.

Temel gerilim
-------------
EOQ, iki karşıt maliyeti dengeler. Sipariş maliyeti miktardan bağımsız sabit
bir bedeldir (nakliye, kurulum, işlem) ve **büyük parti** vermeye iter: ne kadar
seyrek sipariş verirsen o kadar az sabit maliyet ödersin. Tutma maliyeti ise
elde tutulan mala bağlıdır ve **küçük parti** vermeye iter. İkisinin toplamı
tek bir noktada en küçüktür ve o noktada iki maliyet birbirine eşitlenir — bu,
formülün doğruluğunu sınamanın en temiz yoludur ve testlerde çıpa olarak
kullanılır.

    EOQ = sqrt( 2 x D x S / H )

    D: yıllık talep, S: sipariş başına sabit maliyet,
    H: birim başına yıllık tutma maliyeti (birim maliyet x tutma oranı)

Güvenlik stoku ayrı bir soruya cevap verir: EOQ "ne kadar", yeniden sipariş
noktası "ne zaman" derken güvenlik stoku "belirsizliğe karşı ne kadar fazladan"
der. Yalnızca **talebin dalgalanmasından** doğar; talep hiç sapmıyorsa
(sigma = 0) güvenlik stoku da sıfırdır, çünkü korunulacak bir şey yoktur.

    Güvenlik Stoku = Z x sigma_gunluk x sqrt(tedarik suresi)
    Yeniden Sipariş Noktası = (gunluk ortalama talep x tedarik suresi) + Güvenlik Stoku

Karekök, tedarik süresi boyunca **bağımsız** günlük talelerin toplamının
standart sapmasından gelir: n bağımsız günün varyansı toplanır, standart sapma
ise karekökle büyür. Tedarik süresini doğrudan çarpmak (sqrt yerine) güvenlik
stokunu uzun tedarik sürelerinde ciddi biçimde şişirirdi.

Z değeri hizmet seviyesinden **hesaplanır**, tabloya gömülmez. Ders
kitaplarındaki 1,65 ve 2,33 gibi değerler yuvarlanmış hâllerdir; bunları sabit
yazmak, hizmet seviyesi listesi genişlediğinde sessizce yanlış sayı üretmeye
başlardı.
"""

from __future__ import annotations

import math
import statistics
from statistics import NormalDist
from typing import List, Optional, Sequence, Tuple

from simulation_engine.analytics.monte_carlo import summarize
from simulation_engine.distributions.base import (
    BaseDistribution,
    ConstantDistribution,
    RandomStreamFactory,
)
from simulation_engine.distributions.normal import NormalDistribution
from simulation_engine.models.schemas import (
    InventoryAnalysis,
    InventoryItem,
    InventoryStatus,
    MonteCarloStatistic,
    ProductionImpact,
    ReplicationResult,
    StockLevelProjection,
    StockoutRiskReport,
)

#: Kullanıcıya sunulan hizmet seviyeleri. Arayüzdeki liste bununla beslenir;
#: iki yerde ayrı liste tutmak, birinin diğerinden sessizce ayrışması demektir.
SERVICE_LEVELS: Tuple[float, ...] = (0.90, 0.95, 0.99)

DEFAULT_SERVICE_LEVEL: float = 0.95

DAYS_PER_YEAR: float = 365.0

#: Talep sıfırken "sonsuz gün yeter" yerine kullanılan işaret değeri. Sonsuz
#: sayı JSON'a yazılamaz ve arayüzde anlamsız görünürdü.
NOT_APPLICABLE: float = -1.0


def z_for_service_level(service_level: float) -> float:
    """Hizmet seviyesine karşılık gelen standart normal değerini döndürür.

    Args:
        service_level: 0 ile 1 arasında (dahil değil) hizmet seviyesi.

    Returns:
        Standart normal dağılımın `service_level` kuantili.

    Raises:
        ValueError: Seviye (0, 1) aralığının dışındaysa.
    """
    if not 0.0 < service_level < 1.0:
        raise ValueError(
            f"Hizmet seviyesi 0 ile 1 arasinda olmalidir, alinan: {service_level}. "
            f"Yuzde olarak (95) degil oran olarak (0.95) verilmelidir."
        )
    return NormalDist().inv_cdf(service_level)


def annual_demand(item: InventoryItem) -> float:
    """Yıllık talep = günlük ortalama x 365."""
    return item.daily_demand_avg * DAYS_PER_YEAR


def annual_holding_cost_per_unit(item: InventoryItem) -> float:
    """Birim başına yıllık tutma maliyeti = birim maliyet x tutma oranı."""
    return item.unit_cost * item.holding_cost_rate


def economic_order_quantity(item: InventoryItem) -> float:
    """En ekonomik sipariş miktarını hesaplar.

    Talep sıfırsa 0 döner: hiç tüketilmeyen bir kalem için "en ekonomik parti"
    diye bir şey yoktur. Bu, sıfıra bölmeyi önlemek için konmuş bir yama değil,
    sorunun tanımsız olduğunun kabulüdür.
    """
    demand = annual_demand(item)
    if demand <= 0.0:
        return 0.0
    holding = annual_holding_cost_per_unit(item)
    return math.sqrt((2.0 * demand * item.ordering_cost) / holding)


def safety_stock(item: InventoryItem, service_level: float) -> float:
    """Talep belirsizliğine karşı tutulan tampon stok.

    Yalnızca talebin dalgalanmasından doğar. Tedarik süresinin kendisi sabit
    kabul edilir; tedarikçi gecikmesi ayrı bir belirsizlik kaynağıdır ve bu
    formül onu kapsamaz.
    """
    if item.daily_demand_std <= 0.0 or item.lead_time_days <= 0.0:
        return 0.0
    return z_for_service_level(service_level) * item.daily_demand_std * math.sqrt(
        item.lead_time_days
    )


def reorder_point(item: InventoryItem, service_level: float) -> float:
    """Sipariş verilmesi gereken stok seviyesi.

    Tedarik süresi boyunca beklenen tüketim, artı belirsizlik tamponu.
    """
    expected_usage = item.daily_demand_avg * item.lead_time_days
    return expected_usage + safety_stock(item, service_level)


def total_annual_cost(item: InventoryItem, order_quantity: float) -> float:
    """Verilen parti büyüklüğü için yıllık sipariş + tutma maliyeti.

    Satın alma bedeli (D x birim maliyet) bilinçli olarak dışarıda bırakılır:
    parti büyüklüğünden bağımsızdır ve toplama eklendiğinde EOQ'nun sağladığı
    tasarrufu görsel olarak bastırır.
    """
    if order_quantity <= 0.0:
        return 0.0
    demand = annual_demand(item)
    ordering = (demand / order_quantity) * item.ordering_cost
    holding = (order_quantity / 2.0) * annual_holding_cost_per_unit(item)
    return ordering + holding


def analyze(
    item: InventoryItem, service_level: float = DEFAULT_SERVICE_LEVEL
) -> InventoryAnalysis:
    """Bir kalemin tüm envanter göstergelerini hesaplar.

    Args:
        item: Analiz edilecek kalem.
        service_level: İstenen hizmet seviyesi (0-1).

    Returns:
        EOQ, güvenlik stoku, yeniden sipariş noktası, maliyet kırılımı ve
        kullanıcıya dönük tek cümlelik öneri.
    """
    z_value = z_for_service_level(service_level)
    demand = annual_demand(item)
    applicable = demand > 0.0

    eoq = economic_order_quantity(item)
    buffer_stock = safety_stock(item, service_level)
    rop = reorder_point(item, service_level)

    orders_per_year = demand / eoq if eoq > 0.0 else 0.0
    days_between = DAYS_PER_YEAR / orders_per_year if orders_per_year > 0.0 else 0.0

    ordering_cost = orders_per_year * item.ordering_cost
    # Ortalama stok, döngü stokunun yarısı artı hiç tüketilmeyen güvenlik
    # stokudur. Güvenlik stokunu dışarıda bırakmak tutma maliyetini olduğundan
    # düşük gösterirdi — o mal da rafta bekliyor ve maliyet üretiyor.
    holding_cost = (eoq / 2.0 + buffer_stock) * annual_holding_cost_per_unit(item)

    if item.daily_demand_avg > 0.0:
        days_of_stock = item.current_stock / item.daily_demand_avg
        days_until_reorder = max((item.current_stock - rop) / item.daily_demand_avg, 0.0)
    else:
        days_of_stock = NOT_APPLICABLE
        days_until_reorder = NOT_APPLICABLE

    # Siparis bugun verilse bile mal gelene kadar stok yeter mi? Bu, "siparis
    # ver" ile "cok gec, durus kacinilmaz" arasindaki farktir ve yalnizca
    # yeniden siparis noktasina bakarak ayirt edilemez.
    covers_lead_time = (
        item.daily_demand_avg <= 0.0 or days_of_stock >= item.lead_time_days
    )
    status = _resolve_status(item, rop, days_until_reorder)

    return InventoryAnalysis(
        item_id=item.id,
        item_name=item.name,
        unit=item.unit,
        service_level=service_level,
        z_value=z_value,
        is_applicable=applicable,
        annual_demand=demand,
        economic_order_quantity=eoq,
        safety_stock=buffer_stock,
        reorder_point=rop,
        orders_per_year=orders_per_year,
        days_between_orders=days_between,
        annual_ordering_cost=ordering_cost,
        annual_holding_cost=holding_cost,
        total_annual_cost=ordering_cost + holding_cost,
        current_stock=item.current_stock,
        days_of_stock=days_of_stock,
        days_until_reorder=days_until_reorder,
        covers_lead_time=covers_lead_time,
        status=status,
        recommendation=_build_recommendation(
            item, eoq, rop, days_until_reorder, status, covers_lead_time, days_of_stock
        ),
    )


def _resolve_status(
    item: InventoryItem, rop: float, days_until_reorder: float
) -> InventoryStatus:
    """Sipariş aciliyetini belirler.

    Eşik, uydurulmuş bir yüzde değil kalemin kendi tedarik süresidir: stok
    yeniden sipariş noktasına tedarik süresinden daha kısa sürede inecekse
    kullanıcının hazırlanması gerekir. Sabit bir "%20 yakın" eşiği, üç günlük
    ve altmış günlük tedarik sürelerine aynı uyarıyı verirdi.
    """
    if item.daily_demand_avg <= 0.0:
        return InventoryStatus.OK
    if item.current_stock <= rop:
        return InventoryStatus.CRITICAL
    if days_until_reorder <= item.lead_time_days:
        return InventoryStatus.WARNING
    return InventoryStatus.OK


def _build_recommendation(
    item: InventoryItem,
    eoq: float,
    rop: float,
    days_until_reorder: float,
    status: InventoryStatus,
    covers_lead_time: bool,
    days_of_stock: float,
) -> str:
    """Sayıları kullanıcının doğrudan uygulayabileceği bir cümleye çevirir."""
    if item.daily_demand_avg <= 0.0:
        return (
            f"'{item.name}' için günlük tüketim girilmemiş. Talep bilinmeden "
            f"sipariş miktarı ve zamanı hesaplanamaz."
        )

    quantity = f"{eoq:,.0f} {item.unit}"
    if status is InventoryStatus.CRITICAL:
        if not covers_lead_time:
            # Sipariş vermek tek başına yetmiyor: mal gelmeden stok bitiyor.
            # Bunu sıradan bir "şimdi sipariş verin" uyarısıyla aynı kefeye
            # koymak, kullanıcının hızlandırılmış tedarik gibi bir önlem alma
            # fırsatını kaçırmasına yol açardı.
            shortfall = item.lead_time_days - days_of_stock
            return (
                f"Stok {days_of_stock:,.0f} gün yetiyor ama tedarik "
                f"{item.lead_time_days:,.0f} gün sürüyor. Şimdi {quantity} "
                f"sipariş verseniz bile yaklaşık {shortfall:,.0f} gün stoksuz "
                f"kalacaksınız; hızlandırılmış tedarik ya da geçici bir kaynak "
                f"gerekiyor."
            )
        return (
            f"Stok, yeniden sipariş noktasının ({rop:,.0f} {item.unit}) altında. "
            f"Şimdi {quantity} sipariş verin; tedarik {item.lead_time_days:,.0f} "
            f"gün sürüyor."
        )
    if status is InventoryStatus.WARNING:
        return (
            f"Stok {days_until_reorder:,.0f} gün içinde sipariş noktasına inecek "
            f"ve tedarik {item.lead_time_days:,.0f} gün sürüyor. {quantity} için "
            f"sipariş hazırlığına başlayın."
        )
    return (
        f"Stok yeterli: sipariş noktasına ({rop:,.0f} {item.unit}) inmesine "
        f"yaklaşık {days_until_reorder:,.0f} gün var, parti büyüklüğü {quantity}. "
        f"Aşağıdaki tükenme riski, hiç sipariş verilmediği varsayımıyla "
        f"hesaplanır; zamanında sipariş verildiğinde bu risk gerçekleşmez."
    )


# --------------------------------------------------------------------------- #
# Stok tükenme riski — Monte Carlo
# --------------------------------------------------------------------------- #
#
# EOQ ve yeniden sipariş noktası "ne yapmalıyım?" sorusuna cevap verir. Bu bölüm
# farklı bir soruya bakar: **hiçbir şey yapmazsam ne olur?** Bu yüzden model
# bilinçli olarak yeni sipariş gelmediğini varsayar; bir sipariş politikası
# varsayılsaydı sonuç o politikanın doğruluğuna bağlanır ve uyarı olarak
# işlevini yitirirdi.
#
# Rastgelelik ve güven aralıkları üretim simülasyonuyla aynı altyapıyı kullanır:
# tohum türetmesi `RandomStreamFactory`, güven aralığı `monte_carlo.summarize`.
# İki modülün aynı istatistiği iki ayrı biçimde hesaplaması, aralarındaki küçük
# farkların açıklanamaz hâle gelmesi demek olurdu.

DEFAULT_HORIZON_DAYS: int = 30
DEFAULT_STOCKOUT_REPLICATIONS: int = 500


def simulate_stockout_risk(
    item: InventoryItem,
    horizon_days: int = DEFAULT_HORIZON_DAYS,
    num_replications: int = DEFAULT_STOCKOUT_REPLICATIONS,
    master_seed: Optional[int] = None,
) -> StockoutRiskReport:
    """Stok seviyesini gün gün simüle edip tükenme riskini kestirir.

    Args:
        item: Analiz edilecek kalem.
        horizon_days: Kaç günlük projeksiyon yapılacağı.
        num_replications: Bağımsız koşum sayısı.
        master_seed: Tekrarlanabilirlik için ana tohum.

    Returns:
        Tükenme olasılığı, beklenen duruş günü ve gün gün stok projeksiyonu.

    Raises:
        ValueError: Ufuk ya da replikasyon sayısı pozitif değilse.
    """
    if horizon_days <= 0:
        raise ValueError(f"Ufuk pozitif olmalidir, alinan: {horizon_days}")
    if num_replications <= 0:
        raise ValueError(
            f"Replikasyon sayisi pozitif olmalidir, alinan: {num_replications}"
        )

    factory = RandomStreamFactory(master_seed)
    demand = _daily_demand_distribution(item, factory)

    # Her replikasyon için: günlük stok izi, ilk tükenme günü ve tükenik gün sayısı.
    stock_by_day: List[List[float]] = [[] for _ in range(horizon_days + 1)]
    stockout_days: List[float] = []
    first_stockout_days: List[float] = []

    for _ in range(num_replications):
        stock = item.current_stock
        stock_by_day[0].append(stock)
        days_out = 0
        first_out: Optional[int] = None

        for day in range(1, horizon_days + 1):
            stock -= demand.sample()
            if stock <= 0.0:
                # Stok eksiye düşemez: karşılanamayan talep kaybolur, borç
                # birikmez. Eksi stok göstermek, olmayan bir malı varmış gibi
                # saymanın aynası olurdu.
                stock = 0.0
                days_out += 1
                if first_out is None:
                    first_out = day
            stock_by_day[day].append(stock)

        stockout_days.append(float(days_out))
        if first_out is not None:
            first_stockout_days.append(float(first_out))

    stockout_probability = len(first_stockout_days) / num_replications
    days_statistic = summarize(
        stockout_days,
        metric="stockout_days",
        label="Stogun tukendigi gun sayisi",
        unit="gun",
    )

    projection = [_project_day(day, values) for day, values in enumerate(stock_by_day)]

    return StockoutRiskReport(
        item_id=item.id,
        item_name=item.name,
        unit=item.unit,
        horizon_days=horizon_days,
        num_replications=num_replications,
        master_seed=factory.master_seed,
        stockout_probability=stockout_probability,
        expected_stockout_days=days_statistic,
        mean_first_stockout_day=(
            statistics.fmean(first_stockout_days) if first_stockout_days else None
        ),
        projection=projection,
        headline=_stockout_headline(
            item, horizon_days, stockout_probability, days_statistic, first_stockout_days
        ),
    )


def _daily_demand_distribution(
    item: InventoryItem, factory: RandomStreamFactory
) -> BaseDistribution:
    """Günlük tüketim dağılımını kurar.

    Sapma sıfırsa sabit dağılım kullanılır; normal dağılım sigma > 0 ister ve
    "hiç dalgalanmayan talep" tamamen geçerli bir modeldir. Sapma varsa projenin
    sıfırdan soldan budanmış normal dağılımı kullanılır: bir günün tüketimi
    negatif olamaz ve budama bunu dağılımın kendisinde halleder — örnekleri
    sonradan kırpmak, ortalamayı sessizce yukarı kaydıran bir yama olurdu.
    """
    stream = factory.stream(f"inventory-demand:{item.id}")
    if item.daily_demand_std <= 0.0:
        return ConstantDistribution(item.daily_demand_avg, rng=stream)
    return NormalDistribution(item.daily_demand_avg, item.daily_demand_std, rng=stream)


def _project_day(day: int, values: List[float]) -> StockLevelProjection:
    """Bir günün stok seviyesini güven aralığıyla özetler."""
    statistic = summarize(values, metric=f"stock_day_{day}", label="Stok", unit="")
    return StockLevelProjection(
        day=day,
        mean_stock=statistic.mean,
        # Stok negatif olamaz; aralığın alt ucu sıfırın altına inerse grafik
        # gerçekte var olmayan bir bölgeyi gösterirdi.
        ci_lower=max(statistic.ci_lower, 0.0),
        ci_upper=statistic.ci_upper,
    )


def _stockout_headline(
    item: InventoryItem,
    horizon_days: int,
    probability: float,
    days_statistic: MonteCarloStatistic,
    first_stockout_days: List[float],
) -> str:
    """Sonucu kullanıcının doğrudan okuyabileceği bir cümleye çevirir."""
    if probability <= 0.0:
        return (
            f"Önümüzdeki {horizon_days} günde '{item.name}' stoğunun tükenmesi "
            f"beklenmiyor."
        )

    first_day = statistics.fmean(first_stockout_days)
    return (
        f"Önümüzdeki {horizon_days} günde %{probability * 100:.0f} ihtimalle "
        f"'{item.name}' stoğu tükenir. Tükenme ortalama {first_day:.0f}. günde "
        f"başlar ve stok ortalama {days_statistic.mean:.1f} gün boş kalır."
    )


# --------------------------------------------------------------------------- #
# Üretim motoruyla bağlantı
# --------------------------------------------------------------------------- #
#
# Bu bölüm iki modülü birbirine bağlayan tek yerdir ve bağ **tek yönlüdür**:
# envanter katmanı motorun kaydedilmiş çıktısını okur, motora hiçbir şey yazmaz
# ve onu yeniden çalıştırmaz. Motor kodunda envanterden haberdar tek bir satır
# yoktur; bağlantı koparsa (kalem bir istasyona bağlı değilse ya da o istasyon
# için koşum yoksa) envanter analizi eksiksiz çalışmaya devam eder.
#
# Takvim sorunu
# -------------
# Envanter **gün** cinsinden düşünür, simülasyon ise takvimi olmayan
# **dakika** cinsinden. İkisini bağlamak için günde kaç dakika üretim yapıldığı
# bilinmelidir ve bu, modelin türetemeyeceği bir bilgidir: kimi fabrika tek
# vardiya (480 dk), kimi iki vardiya (960 dk), kimi kesintisiz (1440 dk)
# çalışır.
#
# Bu yüzden **varsayılan bir değer yoktur**. Kullanıcı kalemi bir istasyona
# bağlarken süreyi de vermek zorundadır; şema ikisini birlikte şart koşar.
# Kesintisiz çalışmayı varsaymak, tek vardiyalı bir fabrikanın üretim kaybını
# üç kat büyük gösterir ve kullanıcı bunu fark etmezdi — uydurulmuş bir sayıyla
# hesaplanan uyarı, hiç uyarı vermemekten kötüdür.


def estimate_production_impact(
    item: InventoryItem,
    risk: StockoutRiskReport,
    replications: Sequence[ReplicationResult],
    simulation_id: str,
) -> Optional[ProductionImpact]:
    """Stok tükenmesinin bağlı istasyonda yol açacağı üretim kaybını kestirir.

    Kalem bir istasyona bağlı değilse, günlük üretim süresi bilinmiyorsa ya da
    verilen koşumda o istasyon yoksa `None` döner — bunlar hata değil,
    bağlantının kurulmamış olmasıdır.

    Args:
        item: Envanter kalemi; günlük üretim süresini de o taşır.
        risk: Aynı kalem için hesaplanmış tükenme riski.
        replications: Kaydedilmiş koşumun ham replikasyonları.
        simulation_id: Üretim hızının okunduğu koşum.

    Returns:
        Beklenen üretim kaybı ve güven aralığı, ya da bağlantı yoksa `None`.
    """
    if item.linked_station_id is None or not replications:
        return None

    production_minutes_per_day = item.production_minutes_per_day
    # Şema bağlantı ile süreyi birlikte şart koşar; buradaki denetim eski bir
    # kaydın ya da doğrudan çağrının bu kuralı atlaması ihtimaline karşıdır.
    # Uydurulmuş bir süreyle hesap yapmaktansa etkiyi hiç göstermemek yeğdir.
    if production_minutes_per_day is None or production_minutes_per_day <= 0.0:
        return None

    rate = _station_units_per_minute(replications, item.linked_station_id)
    if rate is None:
        return None

    station_name = _station_name(replications, item.linked_station_id)
    units_per_day = rate * production_minutes_per_day

    # Kayıp, duruş günü sayısıyla doğru orantılıdır; güven aralığı da aynı
    # katsayıyla ölçeklenir. Kaybın belirsizliği tümüyle duruş süresinin
    # belirsizliğinden gelir, üretim hızı ölçülmüş tek bir sayıdır.
    days = risk.expected_stockout_days
    expected_lost = days.mean * units_per_day
    lower = max(days.ci_lower, 0.0) * units_per_day
    upper = max(days.ci_upper, 0.0) * units_per_day

    return ProductionImpact(
        station_id=item.linked_station_id,
        station_name=station_name,
        simulation_id=simulation_id,
        units_per_day=units_per_day,
        expected_lost_units=expected_lost,
        lost_units_ci=(lower, upper),
        message=_impact_message(
            item, station_name, expected_lost, days.mean, production_minutes_per_day
        ),
    )


def _station_units_per_minute(
    replications: Sequence[ReplicationResult], station_id: str
) -> Optional[float]:
    """İstasyonun dakikada kaç birim ürettiğini replikasyonlardan okur.

    Ölçüm penceresinin uzunluğu istasyonun planlanan üretim süresinden
    türetilir: `planned = pencere x sunucu sayisi`. Bu, motorun kendi
    tanımıdır; pencereyi simülasyon süresinden hesaplamak ısınma süresini
    yok sayardı ve hızı olduğundan düşük gösterirdi.
    """
    total_units = 0.0
    total_minutes = 0.0

    for replication in replications:
        for station in replication.stations:
            if station.station_id != station_id:
                continue
            servers = max(station.num_servers, 1)
            window = station.planned_production_time_minutes / servers
            if window <= 0.0:
                continue
            total_units += station.units_produced - station.units_scrapped
            total_minutes += window

    if total_minutes <= 0.0:
        return None
    return total_units / total_minutes


def _station_name(
    replications: Sequence[ReplicationResult], station_id: str
) -> str:
    """İstasyonun okunabilir adını bulur; bulunamazsa kimliğine düşer."""
    for replication in replications:
        for station in replication.stations:
            if station.station_id == station_id:
                return station.station_name
    return station_id


def _impact_message(
    item: InventoryItem,
    station_name: str,
    expected_lost: float,
    stockout_days: float,
    minutes_per_day: float,
) -> str:
    """Etkiyi kullanıcının doğrudan okuyabileceği bir cümleye çevirir."""
    if expected_lost <= 0.0:
        return (
            f"'{item.name}' stoğunun tükenmesi beklenmiyor; '{station_name}' "
            f"istasyonunda bu kalemden kaynaklı bir duruş öngörülmüyor."
        )

    hours = minutes_per_day / 60.0
    return (
        f"'{item.name}' tükenirse '{station_name}' durur. Beklenen duruş "
        f"{stockout_days:.1f} gün ve tahmini üretim kaybı "
        f"{expected_lost:,.0f} birim (günde {hours:.0f} saat üretim varsayımıyla)."
    )
