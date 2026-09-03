"""FastAPI servis katmanı — Şartname Bölüm 5.

Uçlar
-----
``POST /api/simulations/run``
    Bir senaryoyu `num_replications` kez çalıştırır; toplam çıktıyı %95 güven
    aralığıyla, istasyon metriklerini OEE kırılımıyla, darboğazı ve Little's
    Law denetimini döndürür.

``GET /api/simulations/{id}/validation-report``
    Daha önce çalıştırılmış bir simülasyonun analitik doğrulama sonuçlarını
    döndürür: Little's Law tutarlılığı, kapalı form kuyruk modeliyle
    karşılaştırma, kararlılık denetimi ve tekrarlanabilirlik bilgisi.

``POST /api/simulations/compare``
    Birden çok senaryoyu aynı koşulda çalıştırıp karşılaştırmalı tablo üretir;
    senaryolar arasındaki farkın **istatistiksel olarak anlamlı** olup
    olmadığını da bildirir.

``GET /api/simulations/{id}/trace``
    Animasyon için ilk penceredeki ham olayları döndürür. İz saklanmaz;
    istendiğinde aynı tohumla yeniden üretilir.

Tasarım kararları
-----------------
**Katman sınırı.** Bu modül hiçbir formül içermez. Motor ham gözlemleri,
`analytics/` katmanı türetilmiş büyüklükleri üretir; API yalnızca bunları
Bölüm 5'te tanımlanan yanıt gövdesine dönüştürür. Böylece her analitik formül
tek bir yerde durur ve HTTP'den bağımsız olarak test edilebilir.

**Senaryo bir kez çalıştırılır.** Darboğaz analizi, OEE ve Little's Law
denetimi ham replikasyonlara, güven aralıkları ise özetlere ihtiyaç duyar.
`monte_carlo.run_replications` ile replikasyonlar bir kez üretilir ve tüm
analizler aynı sonuç kümesi üzerinden yapılır; aksi hâlde aynı senaryo birden
çok kez koşturulur ve raporun bölümleri birbiriyle tutarsız olurdu.

**Olay döngüsü bloke edilmez.** Simülasyon CPU yoğun ve saniyeler-dakikalar
sürebilen bir iştir. Uç noktalar `asyncio.to_thread` ile işi ayrı bir iş
parçacığına verir; aksi hâlde tek bir istek tüm sunucuyu durdururdu.

**İş yükü sınırı.** Kabul edilen her istek için beklenen olay sayısı önceden
kestirilir ve `MAX_ESTIMATED_EVENTS` sınırını aşan istekler reddedilir. Bu
olmadan tek bir istek (ör. 10 milyon dakikalık, 100 replikasyonlu bir senaryo)
sunucuyu saatlerce meşgul edebilirdi.

**Depolama.** Sonuçlar `api.storage` katmanında saklanır. `DATABASE_URL`
tanımlıysa kalıcı bir veritabanı, değilse süreç belleği kullanılır; iki deponun
arayüzü aynı olduğu için bu modülde hiçbir dallanma yoktur. Kalıcı depo, sunucu
yeniden başladığında sonuçların kaybolmasını ve çok işçili bir dağıtımda
(`uvicorn --workers 4`) bir işçinin ürettiği kimliğin diğerinden okunamamasını
önler.

Çalıştırma
----------
    uvicorn simulation_engine.api.simulation_service:app --reload

Etkileşimli dokümantasyon ``/docs`` adresinde sunulur.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import time
from typing import Dict, List, Optional, Sequence, Union

from fastapi import Body, Depends, FastAPI, HTTPException, Path, status
from fastapi.middleware.cors import CORSMiddleware

from simulation_engine import __version__
from simulation_engine.analytics import bottleneck as bottleneck_analytics
from simulation_engine.analytics import littles_law as littles_law_analytics
from simulation_engine.analytics.littles_law import DEFAULT_TOLERANCE_PCT
from simulation_engine.analytics.monte_carlo import (
    Z_SCORE_95,
    run_replications,
    summarize_replications,
)
from simulation_engine.analytics.oee import compute_oee_report
from simulation_engine.core.engine import capture_trace
from simulation_engine.analytics.queueing_theory import mmc_metrics
from simulation_engine.api import dependencies
from simulation_engine.api.dependencies import (
    FactoryStoreProtocol,
    get_factory_store,
    get_store,
)
from simulation_engine.api.inventory_routes import router as inventory_router
from simulation_engine.api.storage import (
    MAX_STORED_SIMULATIONS,
    DatabaseSimulationStore,
    SimulationStore,
    StoredSimulation,
    create_simulation_store,
    new_simulation_id,
)
from simulation_engine.api.factory_routes import (
    FACTORY_PREFIX,
    factory_not_found,
    router as factory_router,
)
from simulation_engine.api.factory_storage import (
    FactoryHasNoVersion,
    FactoryNotFound,
)
from simulation_engine.models.schemas import (
    AnalyticalStationComparison,
    BottleneckAnalysis,
    ComparisonResponse,
    LittlesLawReport,
    LittlesLawValidationResponse,
    MonteCarloReport,
    OEEComponentsResponse,
    OEEReport,
    PairwiseDifference,
    ReplicationResult,
    ScenarioComparisonRow,
    SimulationConfig,
    SimulationResults,
    SimulationRunResponse,
    SimulationTrace,
    StationFlowResponse,
    StationMetricsResponse,
    ValidationReportResponse,
)

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Adlandırılmış sabitler
# --------------------------------------------------------------------------- #

#: Tek bir istekte işlenmesine izin verilen tahmini azami olay sayısı.
#: Kaba bir üst sınırdır; amacı kesin maliyet kestirimi değil, sunucuyu
#: saatlerce meşgul edecek isteklerin kapıda durdurulmasıdır.
MAX_ESTIMATED_EVENTS: int = 50_000_000

#: Bir parçanın yaşam döngüsünde ürettiği yaklaşık olay sayısı (varış, hizmet
#: tamamlanma, aktarım). İstasyon sayısıyla çarpılarak kullanılır.
EVENTS_PER_ENTITY_PER_STATION: int = 2

#: `POST /api/simulations/compare` ucunda kabul edilen azami senaryo sayısı.
MAX_COMPARISON_SCENARIOS: int = 10

#: Depo türlerinin ortak arayüzü. `SimulationStore` (bellek) ve
#: `DatabaseSimulationStore` (kalıcı) aynı metotları sunar; uç noktalar
#: aralarındaki farkı görmez.
SimulationStoreProtocol = Union[SimulationStore, DatabaseSimulationStore]

#: Analitik kuyruk modeliyle karşılaştırmada kabul edilen azami bağıl sapma.
ANALYTICAL_TOLERANCE_PCT: float = 5.0

API_PREFIX: str = "/api/simulations"

#: Geliştirme ortamında tarayıcıdan istek atmasına izin verilen kaynaklar.
#: Vite geliştirme sunucusu 5173 portunda çalışır; hem `localhost` hem
#: `127.0.0.1` yazımı listelenir, çünkü tarayıcılar bu ikisini farklı kaynak
#: sayar.
DEVELOPMENT_ORIGINS: List[str] = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

#: Yayına alınmış frontend adreslerinin okunduğu ortam değişkeni. Virgülle
#: ayrılmış birden çok adres verilebilir, örneğin:
#:   FRONTEND_ORIGINS=https://optiflow.vercel.app,https://optiflow-git-main.vercel.app
FRONTEND_ORIGINS_ENV: str = "FRONTEND_ORIGINS"


def resolve_allowed_origins() -> List[str]:
    """Tarayıcıdan doğrudan istek atmasına izin verilen kaynakları belirler.

    Geliştirme adresleri her zaman listededir; yayına alınmış frontend adresi
    `FRONTEND_ORIGINS` ortam değişkeninden okunur.

    Adresin koda gömülmek yerine ortam değişkeninden gelmesi bilinçlidir:
    frontend yayına alındığında adresi öğrenilir ve backend'in bunu tanıması
    gerekir. Adres kodda sabit olsaydı, her adres değişikliğinde kaynak kodu
    düzenleyip yeniden dağıtmak gerekirdi; ortam değişkeniyle yalnızca
    değişkeni güncellemek yeterlidir.

    Joker (`*`) hiçbir durumda kullanılmaz: gereğinden geniş bir CORS ayarı,
    kullanıcının tarayıcısındaki herhangi bir sitenin bu API'yi çağırmasına
    izin verirdi.
    """
    origins = list(DEVELOPMENT_ORIGINS)
    configured = os.environ.get(FRONTEND_ORIGINS_ENV, "")
    for origin in configured.split(","):
        cleaned = origin.strip().rstrip("/")
        if cleaned and cleaned not in origins:
            origins.append(cleaned)
    return origins


#: Uygulama başlarken çözülen kaynak listesi.
ALLOWED_ORIGINS: List[str] = resolve_allowed_origins()

#: 422 durum kodu. Starlette bu sabiti `HTTP_422_UNPROCESSABLE_ENTITY`'den
#: `HTTP_422_UNPROCESSABLE_CONTENT`'e taşıdı; eski ada erişmek yeni sürümlerde
#: uyarı üretiyor. Yeni ad varsa o, yoksa eski ad kullanılır.
HTTP_422: int = getattr(
    status, "HTTP_422_UNPROCESSABLE_CONTENT", None
) or status.HTTP_422_UNPROCESSABLE_ENTITY


# --------------------------------------------------------------------------- #
# Depolama
# --------------------------------------------------------------------------- #

#: Depo ve `get_store` bağımlılığı `api.dependencies` içinde tanımlıdır; envanter
#: router'ı da aynı nesneye ihtiyaç duyduğu ve bu modül onu içe aktardığı için
#: ortak bir yere alınmıştır. Buradan yeniden dışa verilir, çünkü mevcut testler
#: ve dağıtımlar bağımlılığı bu modülden içe aktarıyor.
_store = dependencies._store


# --------------------------------------------------------------------------- #
# Yardımcılar
# --------------------------------------------------------------------------- #


def estimate_event_count(config: SimulationConfig) -> float:
    """Bir konfigürasyonun üreteceği olay sayısını kabaca kestirir.

    Varış hızı ile simülasyon süresinin çarpımı toplam parça sayısını verir;
    her parça istasyon başına birkaç olay üretir. Kestirim kesin değildir
    (yeniden işleme döngüleri ve arızalar sayıyı artırır) ama iş yükü sınırının
    büyüklük mertebesini yakalamasına yeter.
    """
    interarrival_mean = config.arrival_process.distribution.params.get("mean")
    if not interarrival_mean or interarrival_mean <= 0.0:
        # Sabit veya ampirik varış süreçleri için ortalama farklı anahtarlarda
        # olabilir; kestirim yapılamıyorsa sınır uygulanmaz.
        return 0.0
    entities = config.simulation_duration_minutes / interarrival_mean
    per_replication = entities * len(config.stations) * EVENTS_PER_ENTITY_PER_STATION
    return per_replication * config.num_replications


def _reject_if_too_large(config: SimulationConfig, scenario_label: str = "") -> None:
    """İş yükü sınırını aşan istekleri 422 ile reddeder."""
    estimated = estimate_event_count(config)
    if estimated > MAX_ESTIMATED_EVENTS:
        prefix = f"{scenario_label}: " if scenario_label else ""
        raise HTTPException(
            status_code=HTTP_422,
            detail=(
                f"{prefix}Istek cok buyuk. Tahmini olay sayisi "
                f"{estimated:,.0f}, sinir {MAX_ESTIMATED_EVENTS:,}. "
                f"Simulasyon suresini ({config.simulation_duration_minutes:,.0f} dk) "
                f"veya replikasyon sayisini ({config.num_replications}) dusurun."
            ),
        )


def _relative_deviation_pct(observed: float, expected: float) -> float:
    """İki değer arasındaki bağıl sapmayı yüzde olarak döndürür."""
    scale = max(abs(observed), abs(expected))
    if scale < 1e-12:
        return 0.0
    return abs(observed - expected) / scale * 100.0


def _summarize_littles_law(
    replications: Sequence[ReplicationResult], tolerance_pct: float
) -> tuple[LittlesLawValidationResponse, LittlesLawReport]:
    """Tüm replikasyonlarda Little's Law denetimini çalıştırıp özetler.

    Tek bir replikasyona bakmak yeterli değildir: motorda ara sıra ortaya çıkan
    bir hata yalnızca bazı koşumlarda görünebilir. Bu nedenle denetim her
    replikasyonda çalıştırılır, en kötü sapma raporlanır ve ayrıntılı rapor
    olarak **en kötü** replikasyonunki döndürülür.
    """
    reports = [
        littles_law_analytics.validate(result, tolerance_pct) for result in replications
    ]
    worst = max(reports, key=lambda report: report.max_deviation_pct)
    summary = LittlesLawValidationResponse(
        passed=all(report.passed for report in reports),
        deviation_pct=worst.max_deviation_pct,
        tolerance_pct=tolerance_pct,
        replications_checked=len(reports),
        replications_passed=sum(1 for report in reports if report.passed),
    )
    return summary, worst


def _average_station_flow(
    replications: Sequence[ReplicationResult], station_id: str
) -> StationFlowResponse:
    """Bir istasyonun akış sayaçlarını replikasyonlar arasında ortalar.

    Monte Carlo özetine yeni metrik eklenmedi; bu sayılar ham replikasyonlardan
    doğrudan okunur. Özet sözleşmesini genişletmek, yalnızca bir görselleştirme
    için raporun her tüketicisini etkileyen bir değişiklik olurdu.
    """
    count = len(replications)
    if count == 0:  # pragma: no cover - API her zaman en az bir replikasyon uretir
        return StationFlowResponse(entered=0.0, completed=0.0, scrapped=0.0, rejected=0.0)

    totals = {"entered": 0.0, "completed": 0.0, "scrapped": 0.0, "rejected": 0.0}
    for replication in replications:
        for station in replication.stations:
            if station.station_id != station_id:
                continue
            totals["entered"] += station.entries
            totals["completed"] += station.units_produced
            totals["scrapped"] += station.units_scrapped
            totals["rejected"] += station.rejected

    return StationFlowResponse(
        entered=totals["entered"] / count,
        completed=totals["completed"] / count,
        scrapped=totals["scrapped"] / count,
        rejected=totals["rejected"] / count,
    )


def _build_station_metrics(
    monte_carlo: MonteCarloReport,
    oee: OEEReport,
    bottleneck_station_id: str,
    replications: Sequence[ReplicationResult],
) -> List[StationMetricsResponse]:
    """İstasyon metriklerini API yanıt biçimine dönüştürür.

    Kullanım, kuyruk ve bekleme değerleri replikasyonlar arası **ortalamalardır**;
    tek bir koşumun değeri değil. OEE ise ilk replikasyondan alınır, çünkü OEE
    kırılımı zaman merdiveni özdeşliğine dayanır ve bileşenlerin ayrı ayrı
    ortalanması bu özdeşliği bozardı.
    """
    rows: List[StationMetricsResponse] = []
    for summary in monte_carlo.stations:
        station_oee = oee.station(summary.station_id)
        rows.append(
            StationMetricsResponse(
                station_id=summary.station_id,
                station_name=summary.station_name,
                utilization=summary.metric("utilization").mean,
                avg_queue_length=summary.metric("avg_queue_length").mean,
                avg_wait_time=summary.metric("avg_wait_time").mean,
                oee=OEEComponentsResponse(
                    availability=station_oee.availability,
                    performance=station_oee.performance,
                    quality=station_oee.quality,
                    oee=station_oee.oee,
                ),
                is_bottleneck=summary.station_id == bottleneck_station_id,
                flow=_average_station_flow(replications, summary.station_id),
            )
        )
    return rows


def _execute_scenario(
    config: SimulationConfig,
    factory_id: Optional[str] = None,
    factory_version_id: Optional[str] = None,
) -> StoredSimulation:
    """Bir senaryoyu çalıştırır ve tüm analizleri tek sonuç kümesi üzerinden yapar.

    Bu fonksiyon CPU yoğundur ve `asyncio.to_thread` içinden çağrılmalıdır.

    `factory_id` ve `factory_version_id` yalnızca koşum kayıtlı bir fabrikadan
    başlatıldığında doldurulur. Kaydın hangi modelden üretildiğini burada,
    sonucun oluşturulduğu tek yerde işaretlemek bilinçlidir: çağıran tarafın
    sonradan alana atama yapması gerekseydi, yeni bir çağrı yolunda bunu
    unutmak sessizce sahipsiz bir koşum bırakırdı.
    """
    replications, master_seed, elapsed = run_replications(config)
    monte_carlo = summarize_replications(replications, master_seed, elapsed)

    # Darboğaz ve OEE, ilk replikasyondan hesaplanır. Bu bilinçlidir: her ikisi
    # de aynı koşum içindeki büyüklüklerin birbiriyle tutarlı olmasına dayanır
    # (ör. OEE'nin zaman merdiveni özdeşliği). Replikasyonlar arası belirsizlik
    # zaten güven aralıklarıyla ayrıca raporlanır.
    representative = replications[0]
    return StoredSimulation(
        simulation_id=new_simulation_id(),
        config=config,
        replications=replications,
        monte_carlo=monte_carlo,
        bottleneck=bottleneck_analytics.analyze(representative, config),
        oee=compute_oee_report(representative),
        duration_seconds=elapsed,
        factory_id=factory_id,
        factory_version_id=factory_version_id,
    )


def _build_run_response(record: StoredSimulation) -> SimulationRunResponse:
    """Depolanmış bir koşumu `POST /run` yanıtına dönüştürür."""
    monte_carlo = record.monte_carlo
    production = monte_carlo.metric("units_produced")
    littles_law_summary, _ = _summarize_littles_law(
        record.replications, DEFAULT_TOLERANCE_PCT
    )

    warnings: List[str] = list(monte_carlo.warnings)
    for replication in record.replications[:1]:
        warnings.extend(replication.warnings)
    warnings.extend(record.bottleneck.warnings)
    if not littles_law_summary.passed:
        warnings.append(
            f"Little's Law denetimi {littles_law_summary.replications_checked} "
            f"replikasyonun "
            f"{littles_law_summary.replications_checked - littles_law_summary.replications_passed}"
            f" tanesinde basarisiz oldu (azami sapma "
            f"%{littles_law_summary.deviation_pct:.3f}). Bu, motorun sayaclarinda "
            f"mantik hatasi olabilecegini gosterir."
        )

    results = SimulationResults(
        total_throughput=int(round(production.mean)),
        confidence_interval_95=(production.ci_lower, production.ci_upper),
        station_metrics=_build_station_metrics(
            monte_carlo,
            record.oee,
            record.bottleneck.bottleneck_station_id,
            record.replications,
        ),
        bottleneck_station_id=record.bottleneck.bottleneck_station_id,
        littles_law_validation=littles_law_summary,
        num_replications=monte_carlo.num_replications,
        is_stable=all(r.stability.is_stable for r in record.replications),
        avg_wip=monte_carlo.metric("avg_wip").mean,
        avg_flow_time=monte_carlo.metric("avg_flow_time").mean,
        throughput_per_minute=monte_carlo.metric("throughput_per_minute").mean,
        line_oee=record.oee.line_oee,
        theoretical_max_throughput_per_minute=(
            record.bottleneck.theoretical_max_throughput_per_minute
        ),
    )

    return SimulationRunResponse(
        simulation_id=record.simulation_id,
        status="completed",
        results=results,
        master_seed=monte_carlo.master_seed,
        duration_seconds=record.duration_seconds,
        warnings=_deduplicate(warnings),
        headline=monte_carlo.headline,
        factory_id=record.factory_id,
        factory_version_id=record.factory_version_id,
    )


def _deduplicate(messages: Sequence[str]) -> List[str]:
    """Uyarı listesindeki yinelenenleri sırayı bozmadan temizler."""
    seen: Dict[str, None] = {}
    for message in messages:
        seen.setdefault(message, None)
    return list(seen)


def _build_queueing_comparison(
    record: StoredSimulation, station_id: str
) -> AnalyticalStationComparison:
    """Bir istasyonu kapalı form kuyruk modeliyle karşılaştırır.

    Kapalı form M/M/c çözümü yalnızca belirli koşullarda geçerlidir. Bu koşullar
    sağlanmadığında karşılaştırma **yapılmaz**: üçgen işlem süreli bir istasyonu
    M/M/c formülüyle karşılaştırıp "sapma var" demek, motoru değil yanlış modeli
    suçlamak olurdu. Uygulanabilirlik dört koşula bağlıdır:

    1. Varışlar arası süre üstel (Poisson süreci) olmalı.
    2. İşlem süresi üstel olmalı.
    3. İstasyonda arıza modeli bulunmamalı (kapalı form kesintisiz sunucu varsayar).
    4. Tampon sınırsız olmalı (M/M/c; sonlu tampon M/M/c/K'dır).
    """
    station_config = record.config.station_by_id()[station_id]
    summary = record.monte_carlo.station(station_id)
    simulated_utilization = summary.metric("utilization").mean
    simulated_l_queue = summary.metric("avg_queue_length").mean
    simulated_w_queue = summary.metric("avg_wait_time").mean

    blockers: List[str] = []
    if record.config.arrival_process.distribution.type != "exponential":
        blockers.append("varislar arasi sure ustel degil")
    if station_config.service_time_distribution.type != "exponential":
        blockers.append("islem suresi ustel degil")
    if station_config.failure_rate is not None:
        blockers.append("istasyonda ariza modeli var")
    if not station_config.has_infinite_buffer:
        blockers.append("tampon sonlu (M/M/c/K)")

    if blockers:
        return AnalyticalStationComparison(
            station_id=station_id,
            station_name=station_config.name,
            applicable=False,
            reason=(
                "Kapali form M/M/c modeli uygulanamaz: "
                + ", ".join(blockers)
                + ". Bu istasyon icin simulasyon sonuclari analitik bir referansla "
                "karsilastirilamaz; dogrulama Little's Law uzerinden yapilir."
            ),
            simulated_utilization=simulated_utilization,
            simulated_l_queue=simulated_l_queue,
            simulated_w_queue=simulated_w_queue,
        )

    # İstasyona gelen etkin varış hızı: dış varış hızı x ziyaret oranı.
    visit_ratio = record.replications[0].stability.visit_ratios.get(station_id, 1.0)
    arrival_rate = (
        1.0 / record.config.arrival_process.distribution.params["mean"] * visit_ratio
    )
    service_rate = 1.0 / station_config.service_time_distribution.params["mean"]
    analytical = mmc_metrics(arrival_rate, service_rate, station_config.num_servers)

    if not analytical.is_stable:
        return AnalyticalStationComparison(
            station_id=station_id,
            station_name=station_config.name,
            applicable=False,
            reason=(
                f"Istasyon kararsiz (rho = {analytical.utilization:.4f} >= 1); "
                f"kapali form cozum tanimsizdir."
            ),
            analytical=analytical,
            simulated_utilization=simulated_utilization,
            simulated_l_queue=simulated_l_queue,
            simulated_w_queue=simulated_w_queue,
        )

    deviation_utilization = _relative_deviation_pct(
        simulated_utilization, analytical.utilization
    )
    deviation_l_queue = _relative_deviation_pct(simulated_l_queue, analytical.l_queue)
    deviation_w_queue = _relative_deviation_pct(simulated_w_queue, analytical.w_queue)

    return AnalyticalStationComparison(
        station_id=station_id,
        station_name=station_config.name,
        applicable=True,
        reason=(
            f"{analytical.notation} modeli uygulanabilir "
            f"(lambda = {arrival_rate:.4f}, mu = {service_rate:.4f}, "
            f"c = {station_config.num_servers})."
        ),
        analytical=analytical,
        simulated_utilization=simulated_utilization,
        simulated_l_queue=simulated_l_queue,
        simulated_w_queue=simulated_w_queue,
        deviation_utilization_pct=deviation_utilization,
        deviation_l_queue_pct=deviation_l_queue,
        deviation_w_queue_pct=deviation_w_queue,
        passed=max(deviation_utilization, deviation_l_queue, deviation_w_queue)
        <= ANALYTICAL_TOLERANCE_PCT,
    )


def _build_validation_report(record: StoredSimulation) -> ValidationReportResponse:
    """Depolanmış bir koşum için analitik doğrulama raporu üretir."""
    littles_law_summary, worst_report = _summarize_littles_law(
        record.replications, DEFAULT_TOLERANCE_PCT
    )
    comparisons = [
        _build_queueing_comparison(record, station.id) for station in record.config.stations
    ]
    applicable = [item for item in comparisons if item.applicable]
    queueing_passed = all(item.passed for item in applicable)
    stability = record.replications[0].stability
    passed = littles_law_summary.passed and queueing_passed and stability.is_stable

    summary_parts = [
        f"{littles_law_summary.replications_passed}/"
        f"{littles_law_summary.replications_checked} replikasyonda Little's Law "
        f"toleransi saglandi (azami sapma "
        f"%{littles_law_summary.deviation_pct:.3f}, tolerans "
        f"%{littles_law_summary.tolerance_pct:.1f})."
    ]
    if applicable:
        summary_parts.append(
            f"{len(applicable)}/{len(comparisons)} istasyon kapali form kuyruk "
            f"modeliyle karsilastirilabildi; "
            f"{sum(1 for item in applicable if item.passed)} tanesi "
            f"%{ANALYTICAL_TOLERANCE_PCT:.0f} tolerans icinde."
        )
    else:
        summary_parts.append(
            "Hicbir istasyon kapali form kuyruk modeliyle karsilastirilamadi "
            "(ustel olmayan sureler, arizalar veya sonlu tamponlar); dogrulama "
            "Little's Law ve kararlilik denetimine dayaniyor."
        )
    if not stability.is_stable:
        summary_parts.append(
            "UYARI: Model kararsiz; kararli durum ortalamalari tanimsiz oldugu icin "
            "analitik karsilastirma yorumlanamaz."
        )

    return ValidationReportResponse(
        simulation_id=record.simulation_id,
        tolerance_pct=DEFAULT_TOLERANCE_PCT,
        passed=passed,
        littles_law=worst_report,
        littles_law_summary=littles_law_summary,
        queueing_comparisons=comparisons,
        stability=stability,
        master_seed=record.monte_carlo.master_seed,
        replication_seeds=record.monte_carlo.replication_seeds,
        reproducibility_note=(
            f"Bu kosum, konfigurasyona random_seed = "
            f"{record.monte_carlo.master_seed} verilerek birebir tekrarlanabilir. "
            f"Her replikasyonun tohumu bu ana tohumdan deterministik olarak "
            f"turetilmistir."
        ),
        summary=" ".join(summary_parts),
    )


def _welch_difference(
    baseline: StoredSimulation,
    candidate: StoredSimulation,
    baseline_index: int,
    candidate_index: int,
    metric: str,
) -> PairwiseDifference:
    """İki senaryonun bir metriğindeki farkı Welch yaklaşımıyla değerlendirir."""
    first = baseline.monte_carlo.metric(metric)
    second = candidate.monte_carlo.metric(metric)

    difference = second.mean - first.mean
    standard_error = math.sqrt(
        first.std_dev**2 / first.count + second.std_dev**2 / second.count
    )
    half_width = Z_SCORE_95 * standard_error
    ci_lower = difference - half_width
    ci_upper = difference + half_width
    is_significant = not (ci_lower <= 0.0 <= ci_upper)

    if is_significant:
        direction = "yuksek" if difference > 0 else "dusuk"
        interpretation = (
            f"Fark istatistiksel olarak ANLAMLI: senaryo {candidate_index + 1}, "
            f"senaryo {baseline_index + 1}'e gore {abs(difference):,.4f} birim daha "
            f"{direction} ({first.label}). Farkin %95 guven araligi "
            f"[{ci_lower:,.4f}, {ci_upper:,.4f}] sifiri icermiyor."
        )
    else:
        interpretation = (
            f"Fark istatistiksel olarak ANLAMLI DEGIL: farkin %95 guven araligi "
            f"[{ci_lower:,.4f}, {ci_upper:,.4f}] sifiri iceriyor. Gozlenen "
            f"{abs(difference):,.4f} birimlik ayrim rastgelelikle aciklanabilir; "
            f"bu iki senaryonun {first.label} bakimindan farkli oldugu one "
            f"surulemez. Ayrimi netlestirmek icin replikasyon sayisi artirilmalidir."
        )

    return PairwiseDifference(
        baseline_index=baseline_index,
        candidate_index=candidate_index,
        metric=metric,
        label=first.label,
        baseline_mean=first.mean,
        candidate_mean=second.mean,
        difference=difference,
        difference_pct=(difference / first.mean * 100.0) if first.mean else 0.0,
        ci_lower=ci_lower,
        ci_upper=ci_upper,
        is_significant=is_significant,
        interpretation=interpretation,
    )


#: Karşılaştırma tablosunda referans senaryoya karşı sınanan metrikler.
COMPARISON_METRICS: List[str] = ["units_produced", "avg_flow_time", "avg_wip"]


def _build_comparison_response(
    records: Sequence[StoredSimulation], total_seconds: float
) -> ComparisonResponse:
    """Senaryo koşumlarından karşılaştırma tablosunu üretir."""
    rows: List[ScenarioComparisonRow] = []
    for index, record in enumerate(records):
        production = record.monte_carlo.metric("units_produced")
        bottleneck_load = record.bottleneck.station_loads[0]
        rows.append(
            ScenarioComparisonRow(
                scenario_index=index,
                label=f"Senaryo {index + 1}",
                simulation_id=record.simulation_id,
                is_stable=all(r.stability.is_stable for r in record.replications),
                total_throughput=production.mean,
                throughput_ci_95=(production.ci_lower, production.ci_upper),
                avg_wip=record.monte_carlo.metric("avg_wip").mean,
                avg_flow_time=record.monte_carlo.metric("avg_flow_time").mean,
                bottleneck_station_id=record.bottleneck.bottleneck_station_id,
                bottleneck_utilization=bottleneck_load.utilization,
                line_oee=record.oee.line_oee,
                warnings=_deduplicate(record.monte_carlo.warnings),
            )
        )

    differences: List[PairwiseDifference] = []
    for index in range(1, len(records)):
        for metric in COMPARISON_METRICS:
            differences.append(
                _welch_difference(records[0], records[index], 0, index, metric)
            )

    best_index = max(
        range(len(rows)), key=lambda index: rows[index].total_throughput
    )
    best_row = rows[best_index]

    if best_index == 0:
        rationale = (
            f"En yuksek ortalama cikti referans senaryoda ({best_row.label}, "
            f"{best_row.total_throughput:,.0f} birim). Diger senaryolarin hicbiri "
            f"onu gecmedi."
        )
    else:
        production_difference = next(
            item
            for item in differences
            if item.candidate_index == best_index and item.metric == "units_produced"
        )
        if production_difference.is_significant:
            rationale = (
                f"{best_row.label} en yuksek ortalama ciktiya sahip "
                f"({best_row.total_throughput:,.0f} birim) ve referans senaryoya "
                f"ustunlugu istatistiksel olarak anlamli."
            )
        else:
            rationale = (
                f"{best_row.label} en yuksek ortalama ciktiya sahip "
                f"({best_row.total_throughput:,.0f} birim), ancak referans "
                f"senaryoya ustunlugu istatistiksel olarak ANLAMLI DEGIL. Bu "
                f"senaryoyu 'daha iyi' ilan etmek icin daha fazla replikasyon "
                f"gerekir."
            )

    return ComparisonResponse(
        scenarios=rows,
        differences=differences,
        best_scenario_index=best_index,
        best_scenario_rationale=rationale,
        total_duration_seconds=total_seconds,
    )


# --------------------------------------------------------------------------- #
# Uygulama
# --------------------------------------------------------------------------- #

app = FastAPI(
    title="Uretim Sureç Simulasyon Motoru",
    description=(
        "Endustri muhendisligi temelli kesikli olay simulasyonu (DES) servisi. "
        "Kuyruk teorisi (M/M/1, M/M/c), Little's Law dogrulamasi, OEE kirilimi, "
        "Kisitlar Teorisi darbogaz analizi ve Monte Carlo guven araliklari."
    ),
    version=__version__,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    # PUT ve DELETE envanter kalemlerinin guncellenmesi/silinmesi icin gerekli;
    # simulasyon uclari yalnizca GET ve POST kullanir.
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# Envanter modulu ayri bir router olarak takilir. Uretim simulasyonundan
# bagimsizdir: hic kalem eklenmeden simulasyon aynen calisir.
app.include_router(inventory_router)

# Fabrika modulu de ayri bir router'dir. Kaydedilmis hicbir fabrika olmadan
# `POST /api/simulations/run` aynen calisir; kalicilik mevcut akisin uzerine
# eklenmistir, onun yerine gecmemistir.
app.include_router(factory_router)


@app.post(
    f"{API_PREFIX}/run",
    response_model=SimulationRunResponse,
    status_code=status.HTTP_200_OK,
    summary="Bir senaryoyu calistirir",
    tags=["simulations"],
)
async def run_simulation(
    config: SimulationConfig = Body(...),
    store: SimulationStoreProtocol = Depends(get_store),
) -> SimulationRunResponse:
    """Senaryoyu `num_replications` kez çalıştırıp güven aralıklı sonuç döndürür.

    Kararsız bir model (rho >= 1) hata değildir: koşum tamamlanır ve durum
    `completed` olur, ancak `warnings` alanında açık bir kararsızlık uyarısı
    bulunur. Sessizce anlamsız sayı üretmemek şartnamenin TEST 3 gereğidir.

    Raises:
        HTTPException: İş yükü sınırı aşılırsa (422) veya konfigürasyon motor
            tarafından reddedilirse (400).
    """
    _reject_if_too_large(config)
    try:
        record = await asyncio.to_thread(_execute_scenario, config)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error

    store.save(record)
    logger.info(
        "Simulasyon '%s' tamamlandi: %d replikasyon, %.2f sn.",
        record.simulation_id,
        record.monte_carlo.num_replications,
        record.duration_seconds,
    )
    return _build_run_response(record)


@app.get(
    f"{API_PREFIX}/{{simulation_id}}/validation-report",
    response_model=ValidationReportResponse,
    status_code=status.HTTP_200_OK,
    summary="Analitik dogrulama raporunu dondurur",
    tags=["simulations"],
)
async def get_validation_report(
    simulation_id: str = Path(..., description="`/run` ucundan donen kimlik"),
    store: SimulationStoreProtocol = Depends(get_store),
) -> ValidationReportResponse:
    """Bir koşumun analitik doğrulama sonuçlarını döndürür.

    Rapor üç bağımsız denetim içerir: Little's Law tutarlılığı (her
    replikasyonda), uygulanabilir istasyonlar için kapalı form kuyruk modeliyle
    karşılaştırma ve kararlılık denetimi. Ayrıca koşumu birebir tekrarlamak
    için gereken tohum bilgisi verilir.

    Raises:
        HTTPException: Kimlik bulunamazsa (404).
    """
    try:
        record = store.get(simulation_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"'{simulation_id}' kimlikli simulasyon bulunamadi. Sonuclar surec "
                f"belleginde tutulur; sunucu yeniden baslatildiysa veya depo "
                f"kapasitesi ({MAX_STORED_SIMULATIONS}) asildiysa kayit dusurulmus "
                f"olabilir."
            ),
        ) from error
    return _build_validation_report(record)


@app.get(
    f"{API_PREFIX}/{{simulation_id}}/trace",
    response_model=SimulationTrace,
    status_code=status.HTTP_200_OK,
    summary="Animasyon icin olay izini dondurur",
    tags=["simulations"],
)
async def get_simulation_trace(
    simulation_id: str = Path(..., description="`/run` ucundan donen kimlik"),
    store: SimulationStoreProtocol = Depends(get_store),
) -> SimulationTrace:
    """Bir koşumun ilk penceresindeki olayları görselleştirme için döndürür.

    İz **saklanmaz, yeniden üretilir**: senaryo aynı tohumla ve pencere kadar
    kısaltılmış süreyle tekrar çalıştırılır. Tohum türetmesi deterministik
    olduğu için üretilen olaylar, raporlanan istatistikleri üreten koşumun ta
    kendisidir. Böylece her simülasyonla birlikte yüz binlerce baytlık bir iz
    saklamak gerekmez ve maliyet yalnızca kullanıcı animasyonu istediğinde
    ödenir.

    Dönen iz **temsili bir örnektir**: tek bir replikasyondan alınır, oysa
    raporlanan istatistikler tüm replikasyonların ortalamasına dayanır.

    Raises:
        HTTPException: Kimlik bulunamazsa (404).
    """
    try:
        record = store.get(simulation_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"'{simulation_id}' kimlikli simulasyon bulunamadi; olay izi "
                f"uretilemez."
            ),
        ) from error

    return await asyncio.to_thread(
        capture_trace, record.config, record.monte_carlo.master_seed
    )


@app.post(
    f"{API_PREFIX}/compare",
    response_model=ComparisonResponse,
    status_code=status.HTTP_200_OK,
    summary="Birden cok senaryoyu karsilastirir",
    tags=["simulations"],
)
async def compare_simulations(
    configs: List[SimulationConfig] = Body(..., min_length=2),
    store: SimulationStoreProtocol = Depends(get_store),
) -> ComparisonResponse:
    """Senaryoları çalıştırıp karşılaştırmalı tablo ve anlamlılık testi üretir.

    Her senaryo ilk senaryoyla (referans) karşılaştırılır ve farkın %95 güven
    aralığı hesaplanır. Aralık sıfırı içeriyorsa fark **istatistiksel olarak
    anlamlı değildir**; iki senaryo arasında gözlenen ayrım rastgelelikle
    açıklanabilir. Bu ayrımın raporlanması, karşılaştırmayı "hangi sayı daha
    büyük" oyunundan çıkarıp karar verilebilir bir analiz hâline getirir.

    Raises:
        HTTPException: Senaryo sayısı sınırı aşarsa veya iş yükü çok büyükse
            (422), konfigürasyon motor tarafından reddedilirse (400).
    """
    if len(configs) > MAX_COMPARISON_SCENARIOS:
        raise HTTPException(
            status_code=HTTP_422,
            detail=(
                f"En fazla {MAX_COMPARISON_SCENARIOS} senaryo karsilastirilabilir, "
                f"alinan: {len(configs)}."
            ),
        )
    for index, config in enumerate(configs):
        _reject_if_too_large(config, scenario_label=f"Senaryo {index + 1}")

    started_at = time.perf_counter()
    try:
        records = await asyncio.to_thread(
            lambda: [_execute_scenario(config) for config in configs]
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error
    elapsed = time.perf_counter() - started_at

    for record in records:
        store.save(record)
    return _build_comparison_response(records, elapsed)


# --------------------------------------------------------------------------- #
# Doğrudan çalıştırma (yayına alma ortamları için)
# --------------------------------------------------------------------------- #

#: Yerelde kullanılan varsayılan port. Railway ve Render gibi platformlar
#: uygulamanın hangi portu dinleyeceğini `PORT` ortam değişkeniyle bildirir;
#: bu değişken yok sayılırsa platform uygulamaya ulaşamaz ve dağıtım
#: "sağlıksız" olarak işaretlenir.
DEFAULT_PORT: int = 8000


@app.post(
    f"{FACTORY_PREFIX}/{{factory_id}}/run",
    response_model=SimulationRunResponse,
    status_code=status.HTTP_200_OK,
    summary="Kayitli bir fabrikanin guncel surumunu calistirir",
    tags=["factories"],
)
async def run_factory(
    factory_id: str = Path(..., description="`/api/factories` ucundan donen kimlik"),
    factories: FactoryStoreProtocol = Depends(get_factory_store),
    store: SimulationStoreProtocol = Depends(get_store),
) -> SimulationRunResponse:
    """Kaydedilmiş bir fabrikanın güncel sürümünü çalıştırır.

    Bu uç bir **uyarlayıcıdır** (adapter): kalıcı sürümden `SimulationConfig`
    okunur ve mevcut çalıştırma hattına olduğu gibi verilir. Simülasyon
    matematiğinde hiçbir değişiklik yoktur — `POST /api/simulations/run` ile
    aynı `_execute_scenario` çağrılır, aynı sonuçlar üretilir. Tek fark, kaydın
    hangi fabrika sürümünden geldiğinin işaretlenmesidir.

    Bu işaret geçmişin bütünlüğünü sağlar: sürümler değişmez olduğu için, üç ay
    sonra bu koşuma bakıldığında hangi tampon boyutlarıyla, hangi arıza
    oranlarıyla üretildiği kesin olarak okunabilir. Fabrika o tarihten sonra ne
    kadar değişirse değişsin sonuç yeniden yorumlanamaz.

    Bu uç `simulation_service` içinde tanımlıdır çünkü çalıştırma hattı
    buradadır; `factory_routes` içine konsaydı bu modülü içe aktarması gerekir
    ve dairesel bir bağımlılık oluşurdu. Mantığı kopyalamak yerine ucun tanımı
    kodun bulunduğu yere kondu.

    Raises:
        HTTPException: Fabrika bulunamazsa (404), fabrikanin henuz kaydedilmis
            bir modeli yoksa (409), is yuku sinirini asarsa (422) veya
            konfigurasyon motor tarafindan reddedilirse (400).
    """
    try:
        version = factories.current_version(factory_id)
    except FactoryNotFound as error:
        raise factory_not_found(factory_id) from error
    except FactoryHasNoVersion as error:
        # 409, 404 degil: fabrika var, yalnizca henuz bir modeli yok. Ikisini
        # ayni hataya indirgemek, arayuzun "fabrika silinmis" ile "once modeli
        # kaydedin" durumlarini ayirt edememesi demek olurdu.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"'{factory_id}' fabrikasinin henuz kaydedilmis bir modeli yok. "
                f"Once editorde modeli kurup kaydedin."
            ),
        ) from error

    _reject_if_too_large(version.config)
    try:
        record = await asyncio.to_thread(
            _execute_scenario, version.config, version.factory_id, version.id
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
        ) from error

    store.save(record)
    logger.info(
        "Fabrika '%s' surum %d calistirildi: simulasyon '%s', %d replikasyon, "
        "%.2f sn.",
        factory_id,
        version.version_number,
        record.simulation_id,
        record.monte_carlo.num_replications,
        record.duration_seconds,
    )
    return _build_run_response(record)


def main() -> None:
    """Uygulamayı platformun atadığı portta başlatır.

    `0.0.0.0` adresine bağlanmak zorunludur: kapsayıcı içinde `127.0.0.1`
    yalnızca kapsayıcının kendisinden erişilebilir olur ve dışarıdan gelen
    istekler kapsayıcıya hiç ulaşmaz.
    """
    import uvicorn

    port = int(os.environ.get("PORT", DEFAULT_PORT))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
