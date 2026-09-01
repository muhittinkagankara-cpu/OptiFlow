"""TEST 4 — Literatürdeki bilinen vaka çalışmaları (Şartname Bölüm 4).

Bu dosya, motoru **kendi analitik katmanımızın kapsamadığı** klasik kuyruk
modelleriyle karşılaştırır. Amaç bilinçlidir: `analytics/queueing_theory.py`
yalnızca M/M/1 ve M/M/c uygular, dolayısıyla motor bugüne kadar hep üstel
işlem süreli ve sonsuz kuyruklu senaryolarda sınandı. Aşağıdaki vakalar bu
kapsamın dışına çıkar ve motorun farklı rejimlerde de doğru davrandığını
gösterir.

Referans formüller bu modülün içinde, yalnızca doğrulama amacıyla yeniden
uygulanmıştır. Bu da bilinçlidir: bir motoru, üretim kodunda zaten bulunan bir
formülle karşılaştırmak iki tarafın ortak bir hatayı paylaşması riskini taşır.
Buradaki uygulamalar ders kitaplarındaki kapalı formların doğrudan yazımıdır.

Vakalar
-------
1. **Erlang kayıp sistemi (M/M/c/c) — Erlang (1917).**
   Kuyruk teorisinin kurucu vakası. Kuyruksuz, c sunuculu bir sistemde gelen
   bir çağrının tüm sunucuları dolu bulup kaybolma olasılığı Erlang-B ile
   verilir. Motorun sonlu kapasitede parça reddetme davranışını sınar.

2. **Sonlu kuyruklu tek sunucu (M/M/1/K) — Gross & Harris, Bölüm 2.5.**
   Kapasite K ile sınırlı bir sistemde L, engellenme olasılığı ve etkin çıktı.
   İkinci varyantta rho = 1,2 kullanılır: sonlu kapasiteli bir sistem, sunulan
   yük hizmet kapasitesini aşsa bile kararlıdır — kuyruk büyüyemez, fazla
   parça reddedilir. Motorun bu rejimde de doğru davranması gerekir.

3. **Pollaczek-Khinchine formülü (M/G/1) — Pollaczek (1930), Khinchine (1932).**
   İşlem süresi **üstel olmayan** tek sunuculu sistemler için KESİN sonuç:

       Wq = lambda * E[S^2] / (2 * (1 - rho))

   Bu, dosyanın en değerli testidir: motor bugüne kadar yalnızca üstel işlem
   süreleriyle analitik olarak doğrulandı. M/D/1 özel durumunda beklemenin
   M/M/1'in tam yarısı çıkması, sabit sürelerin kuyruğa etkisini doğrudan
   sınar.

4. **Seri kuyruk ağı (Burke teoremi / Jackson ağı) — Burke (1956),
   Jackson (1957).**
   Kararlı bir M/M/1 kuyruğunun çıkış süreci, aynı hızda bir Poisson
   sürecidir. Sonucu şudur: seri bağlı M/M/1 istasyonlarının her biri
   **bağımsız** birer M/M/1 gibi davranır ve sistemin L değeri istasyonların
   L değerlerinin toplamına eşittir. Sezgiye aykırı bu tahmin, çıkış sürecini
   yanlış modelleyen bir motorda tutmaz.

5. **Ham işlem süresi ve darboğaz hızı — Hopp & Spearman, *Factory Physics*,
   Bölüm 7.**
   Penny Fab One yapısı (dört istasyon, her biri tek makine ve 2 saat çevrim):
   T_0 = 8 saat ham işlem süresi, r_b = 0,5 iş/saat darboğaz hızı, kritik WIP
   W_0 = r_b * T_0 = 4 iş. Burada kitaptaki CONWIP eğrileri **yeniden
   üretilmez** — bu motor açık varışlı bir sistemdir, CONWIP salım mekanizması
   yoktur. Sınanan şey, açık sistemlerde de geçerli olan iki katı yasadır:
   akış süresi ham işlem süresinin altına inemez ve çıktı darboğaz hızını
   aşamaz.

Kaynaklar
---------
- Erlang, A. K. (1917). "Solution of some Problems in the Theory of
  Probabilities of Significance in Automatic Telephone Exchanges."
- Pollaczek, F. (1930) ve Khinchine, A. Y. (1932); bkz. Gross & Harris (2008),
  *Fundamentals of Queueing Theory*, 4th ed., Bölüm 5.1.
- Burke, P. J. (1956). "The Output of a Queuing System." *Operations Research*,
  4(6), 699-704.
- Jackson, J. R. (1957). "Networks of Waiting Lines." *Operations Research*,
  5(4), 518-521.
- Gross, D. & Harris, C. M. (2008). *Fundamentals of Queueing Theory*, 4th ed.,
  Bölüm 2.5 (M/M/1/K) ve 2.6 (M/M/c/c).
- Hopp, W. J. & Spearman, M. L. (2008). *Factory Physics*, 3rd ed., Bölüm 7.
"""

from __future__ import annotations

import math
import statistics
from typing import Dict, List, Sequence

import pytest

from simulation_engine.analytics.monte_carlo import run_replications
from simulation_engine.analytics.queueing_theory import erlang_b, mm1_metrics
from simulation_engine.distributions import create_distribution
from simulation_engine.distributions.base import RandomStreamFactory
from simulation_engine.models.schemas import (
    ArrivalProcess,
    Connection,
    Distribution,
    ReplicationResult,
    SimulationConfig,
    Station,
)

#: Simülasyon-analitik karşılaştırmalarında kabul edilen bağıl sapma.
TOLERANCE: float = 0.05

#: Olasılık gibi 0-1 arası büyüklüklerde mutlak sapma toleransı; küçük
#: olasılıklarda bağıl ölçü aşırı katı olurdu.
PROBABILITY_TOLERANCE: float = 0.01


# --------------------------------------------------------------------------- #
# Referans formüller — ders kitaplarındaki kapalı formların doğrudan yazımı
# --------------------------------------------------------------------------- #


def erlang_loss_blocking(num_servers: int, offered_load: float) -> float:
    """Erlang-B engellenme olasılığını **doğrudan toplam** formülüyle hesaplar.

        B(c, a) = (a^c / c!) / SUM_{n=0}^{c} (a^n / n!)

    `analytics.queueing_theory.erlang_b` aynı büyüklüğü özyinelemeyle hesaplar.
    Burada bilinçli olarak farklı bir yol kullanılır; iki bağımsız uygulamanın
    uyuşması ortak hata olasılığını düşürür.
    """
    terms = [offered_load**n / math.factorial(n) for n in range(num_servers + 1)]
    return terms[-1] / math.fsum(terms)


def mm1k_metrics(arrival_rate: float, service_rate: float, capacity: int) -> Dict[str, float]:
    """M/M/1/K modelinin kapalı form sonuçları (Gross & Harris, Bölüm 2.5).

    `capacity` sistemdeki azami parça sayısıdır (kuyruk + hizmet görenler).
    rho = 1 durumu dışlanır; o durumda formüller ayrı bir limit alır.

    Formüller:

        P_0     = (1 - rho) / (1 - rho^(K+1))
        P_K     = P_0 * rho^K                      (engellenme olasiligi)
        L       = rho / (1 - rho)
                  - (K+1) * rho^(K+1) / (1 - rho^(K+1))
        lambda_eff = lambda * (1 - P_K)
        W       = L / lambda_eff
        Lq      = L - (1 - P_0)
        Wq      = W - 1 / mu

    Sunulan yükün kapasiteyi aşması (rho >= 1) bu modelde sorun değildir:
    sistem sonlu olduğu için kuyruk büyüyemez, fazla parça reddedilir.
    """
    if capacity < 1:
        raise ValueError(f"Kapasite en az 1 olmalidir, alinan: {capacity}")
    rho = arrival_rate / service_rate
    if math.isclose(rho, 1.0):
        raise ValueError("rho = 1 durumu bu uygulamada ele alinmiyor.")

    rho_k = rho**capacity
    rho_k1 = rho ** (capacity + 1)
    p_zero = (1.0 - rho) / (1.0 - rho_k1)
    p_blocked = p_zero * rho_k
    l_system = rho / (1.0 - rho) - (capacity + 1) * rho_k1 / (1.0 - rho_k1)
    effective_arrival_rate = arrival_rate * (1.0 - p_blocked)
    w_system = l_system / effective_arrival_rate
    utilization = 1.0 - p_zero
    l_queue = l_system - utilization

    return {
        "p_zero": p_zero,
        "p_blocked": p_blocked,
        "utilization": utilization,
        "l_system": l_system,
        "l_queue": l_queue,
        "w_system": w_system,
        "w_queue": w_system - 1.0 / service_rate,
        "effective_arrival_rate": effective_arrival_rate,
    }


def pollaczek_khinchine(
    arrival_rate: float, service_mean: float, service_variance: float
) -> Dict[str, float]:
    """M/G/1 için Pollaczek-Khinchine kapalı form sonuçları.

        rho = lambda * E[S]
        E[S^2] = Var[S] + E[S]^2
        Wq = lambda * E[S^2] / (2 * (1 - rho))
        Lq = lambda * Wq
        W  = Wq + E[S]
        L  = lambda * W

    Formül **kesindir**, yaklaşım değildir; işlem süresi dağılımının yalnızca
    ilk iki momentine bağlıdır. Üstel süre için M/M/1 sonuçlarını, sabit süre
    için bunların tam yarısını verir.

    Raises:
        ValueError: rho >= 1 ise (kararsız sistem).
    """
    utilization = arrival_rate * service_mean
    if utilization >= 1.0:
        raise ValueError(f"M/G/1 icin rho < 1 gerekir, alinan rho={utilization}")

    second_moment = service_variance + service_mean**2
    w_queue = arrival_rate * second_moment / (2.0 * (1.0 - utilization))
    w_system = w_queue + service_mean
    return {
        "utilization": utilization,
        "w_queue": w_queue,
        "l_queue": arrival_rate * w_queue,
        "w_system": w_system,
        "l_system": arrival_rate * w_system,
    }


# --------------------------------------------------------------------------- #
# Yardımcılar
# --------------------------------------------------------------------------- #


def _mean_of(results: Sequence[ReplicationResult], extractor) -> float:
    """Replikasyonlar üzerinden bir büyüklüğün ortalamasını alır."""
    return statistics.fmean(extractor(result) for result in results)


def _assert_close(observed: float, expected: float, label: str, tolerance: float = TOLERANCE) -> None:
    """Bağıl sapmayı sınar ve başarısızlıkta okunabilir mesaj üretir."""
    deviation = abs(observed - expected) / abs(expected) if expected else abs(observed)
    assert deviation <= tolerance, (
        f"{label}: literatur={expected:.6f}, simulasyon={observed:.6f}, "
        f"sapma=%{deviation * 100:.2f} (tolerans %{tolerance * 100:.0f})"
    )


def _single_station_config(
    service: Distribution,
    interarrival_mean: float,
    num_servers: int,
    buffer_capacity: int,
    duration: float,
    replications: int,
    seed: int,
) -> SimulationConfig:
    """Tek istasyonlu senaryo kurar."""
    return SimulationConfig(
        stations=[
            Station(
                id="S",
                name="Istasyon",
                num_servers=num_servers,
                service_time_distribution=service,
                buffer_capacity_before=buffer_capacity,
            )
        ],
        connections=[],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(interarrival_mean),
            entry_station_id="S",
        ),
        simulation_duration_minutes=duration,
        warmup_period_minutes=duration * 0.05,
        num_replications=replications,
        random_seed=seed,
    )


# --------------------------------------------------------------------------- #
# VAKA 1 — Erlang kayıp sistemi (M/M/c/c), Erlang 1917
# --------------------------------------------------------------------------- #

ERLANG_SERVERS: int = 3
ERLANG_ARRIVAL_RATE: float = 2.0
ERLANG_SERVICE_RATE: float = 1.0
ERLANG_OFFERED_LOAD: float = ERLANG_ARRIVAL_RATE / ERLANG_SERVICE_RATE


@pytest.fixture(scope="module")
def erlang_results() -> List[ReplicationResult]:
    """Kuyruksuz uc sunuculu kayip sistemi."""
    config = _single_station_config(
        service=Distribution.exponential(1.0 / ERLANG_SERVICE_RATE),
        interarrival_mean=1.0 / ERLANG_ARRIVAL_RATE,
        num_servers=ERLANG_SERVERS,
        buffer_capacity=0,
        duration=60_000.0,
        replications=5,
        seed=1917,
    )
    results, _, _ = run_replications(config)
    return results


def test_erlang_b_reference_matches_module_implementation() -> None:
    """Iki bagimsiz Erlang-B uygulamasi uyusmali.

    Testteki dogrudan toplam formulu ile uretim kodundaki ozyineleme, ayni
    degeri vermelidir. B(3, 2) = 4/19 elle turetilebilir.
    """
    direct = erlang_loss_blocking(ERLANG_SERVERS, ERLANG_OFFERED_LOAD)
    recursive = erlang_b(ERLANG_SERVERS, ERLANG_OFFERED_LOAD)

    assert direct == pytest.approx(recursive, abs=1e-12)
    assert direct == pytest.approx(4.0 / 19.0, abs=1e-12)


def test_erlang_loss_blocking_probability(erlang_results: List[ReplicationResult]) -> None:
    """Reddedilen parca orani Erlang-B degerine yakinsamali.

    Kuyruksuz bir sistemde gelen parca tum sunuculari dolu bulursa kaybolur;
    bu oranin B(c, a) olmasi Erlang'in 1917 tarihli sonucudur.
    """
    expected = erlang_loss_blocking(ERLANG_SERVERS, ERLANG_OFFERED_LOAD)
    observed = _mean_of(
        erlang_results,
        lambda r: r.system.entities_rejected / r.system.entities_created,
    )

    assert observed == pytest.approx(expected, abs=PROBABILITY_TOLERANCE), (
        f"Engellenme olasiligi: Erlang-B={expected:.6f}, "
        f"simulasyon={observed:.6f}"
    )


def test_erlang_loss_carried_load(erlang_results: List[ReplicationResult]) -> None:
    """Tasinan yuk a * (1 - B) olmali; sunucu kullanimi bunun c'ye bolumudur."""
    blocking = erlang_loss_blocking(ERLANG_SERVERS, ERLANG_OFFERED_LOAD)
    expected_carried_load = ERLANG_OFFERED_LOAD * (1.0 - blocking)
    expected_utilization = expected_carried_load / ERLANG_SERVERS

    observed = _mean_of(erlang_results, lambda r: r.station("S").utilization)
    _assert_close(observed, expected_utilization, "M/M/c/c kullanim orani")


def test_erlang_loss_system_has_no_queue(erlang_results: List[ReplicationResult]) -> None:
    """Kuyruksuz sistemde bekleme ve kuyruk boyu tam olarak sifir olmali."""
    for result in erlang_results:
        station = result.station("S")
        assert station.avg_queue_length == 0.0
        assert station.avg_wait_time == 0.0
        assert station.max_queue_length == 0


# --------------------------------------------------------------------------- #
# VAKA 2 — Sonlu kuyruklu tek sunucu (M/M/1/K), Gross & Harris 2.5
# --------------------------------------------------------------------------- #

MM1K_CAPACITY: int = 5  # sistemdeki azami parca (kuyruk 4 + sunucu 1)
MM1K_SERVICE_RATE: float = 1.0


def _run_mm1k(arrival_rate: float, seed: int) -> List[ReplicationResult]:
    """Verilen varis hiziyla M/M/1/K senaryosunu calistirir."""
    config = _single_station_config(
        service=Distribution.exponential(1.0 / MM1K_SERVICE_RATE),
        interarrival_mean=1.0 / arrival_rate,
        num_servers=1,
        buffer_capacity=MM1K_CAPACITY - 1,
        duration=100_000.0,
        replications=5,
        seed=seed,
    )
    results, _, _ = run_replications(config)
    return results


@pytest.fixture(scope="module")
def mm1k_underloaded() -> List[ReplicationResult]:
    """rho = 0.8 — sunulan yuk kapasitenin altinda."""
    return _run_mm1k(arrival_rate=0.8, seed=2005)


@pytest.fixture(scope="module")
def mm1k_overloaded() -> List[ReplicationResult]:
    """rho = 1.2 — sunulan yuk kapasiteyi asiyor ama sistem yine de kararli."""
    return _run_mm1k(arrival_rate=1.2, seed=2006)


@pytest.mark.parametrize(
    ("fixture_name", "arrival_rate"),
    [("mm1k_underloaded", 0.8), ("mm1k_overloaded", 1.2)],
)
def test_mm1k_matches_closed_form(
    request: pytest.FixtureRequest, fixture_name: str, arrival_rate: float
) -> None:
    """M/M/1/K'nin L, engellenme, kullanim ve W degerleri kapali formla uyusmali."""
    results: List[ReplicationResult] = request.getfixturevalue(fixture_name)
    expected = mm1k_metrics(arrival_rate, MM1K_SERVICE_RATE, MM1K_CAPACITY)

    observed_blocking = _mean_of(
        results, lambda r: r.system.entities_rejected / r.system.entities_created
    )
    assert observed_blocking == pytest.approx(
        expected["p_blocked"], abs=PROBABILITY_TOLERANCE
    ), (
        f"Engellenme olasiligi: literatur={expected['p_blocked']:.6f}, "
        f"simulasyon={observed_blocking:.6f}"
    )

    _assert_close(
        _mean_of(results, lambda r: r.station("S").utilization),
        expected["utilization"],
        f"M/M/1/K kullanim (rho={arrival_rate})",
    )
    _assert_close(
        _mean_of(results, lambda r: r.system.avg_wip),
        expected["l_system"],
        f"M/M/1/K L (rho={arrival_rate})",
    )
    _assert_close(
        _mean_of(results, lambda r: r.system.avg_flow_time),
        expected["w_system"],
        f"M/M/1/K W (rho={arrival_rate})",
    )
    _assert_close(
        _mean_of(results, lambda r: r.station("S").avg_queue_length),
        expected["l_queue"],
        f"M/M/1/K Lq (rho={arrival_rate})",
    )


def test_mm1k_never_exceeds_capacity(mm1k_overloaded: List[ReplicationResult]) -> None:
    """Sistemdeki parca sayisi K'yi asamaz; asiri yukte bile kuyruk sinirlidir.

    Bu, sonlu kapasiteli sistemlerin tanimlayici ozelligidir: rho = 1.2 olmasina
    ragmen kuyruk sinirsiz buyumez, fazla parca kapida reddedilir.
    """
    for result in mm1k_overloaded:
        assert result.system.max_wip <= MM1K_CAPACITY
        assert result.station("S").max_queue_length <= MM1K_CAPACITY - 1


def test_mm1k_overload_is_classified_as_capacity_limited(
    mm1k_overloaded: List[ReplicationResult],
) -> None:
    """rho = 1.2 sonlu tamponlu sistem KARARLI olarak siniflandirilmali.

    Bu test, kararlilik on denetiminde bulunan bir kusuru kapatir: onceki
    surumde tampon kapasitesine bakilmadigi icin, kapali formuyla %0,26 sapmayla
    uyusan bu sistem 'kuyruk sinirsiz buyuyecek' uyarisi aliyordu. Sonlu
    kapasiteli bir sistemde kuyruk buyuyemez; talebin bir kismi reddedilir.
    """
    expected = mm1k_metrics(1.2, MM1K_SERVICE_RATE, MM1K_CAPACITY)

    for result in mm1k_overloaded:
        stability = result.stability
        assert stability.is_stable, stability.messages
        assert stability.unstable_station_ids == []
        assert stability.capacity_limited_station_ids == ["S"]

        # Kestirilen engellenme olasılığı kapalı form P_K ile uyuşmalı: tek
        # sunuculu bu istasyonda M/M/1/K yaklaşımı tam sonucu verir.
        estimated = stability.estimated_rejection_rates["S"]
        assert estimated == pytest.approx(expected["p_blocked"], abs=1e-9)

        assert any("KAPASITE SINIRLI" in message for message in stability.messages)
        assert not any("sinirsiz buyuyecek" in message for message in stability.messages)


def test_mm1k_underload_produces_no_stability_message(
    mm1k_underloaded: List[ReplicationResult],
) -> None:
    """rho < 1 iken hicbir kararlilik uyarisi uretilmemeli."""
    for result in mm1k_underloaded:
        assert result.stability.is_stable
        assert result.stability.messages == []
        assert result.stability.capacity_limited_station_ids == []


def test_estimated_rejection_rate_matches_simulation(
    mm1k_overloaded: List[ReplicationResult],
) -> None:
    """Kestirilen engellenme orani, olculen red oraniyla uyusmali.

    Kararlilik on denetimi simulasyon calismadan once yapilir; kestiriminin
    gercekte olculen degere yakin cikmasi, kullaniciya sunulan uyarinin
    guvenilir oldugunu gosterir.
    """
    estimated = statistics.fmean(
        result.stability.estimated_rejection_rates["S"] for result in mm1k_overloaded
    )
    observed = _mean_of(
        mm1k_overloaded,
        lambda r: r.system.entities_rejected / r.system.entities_created,
    )
    assert observed == pytest.approx(estimated, abs=PROBABILITY_TOLERANCE)


def test_mm1k_infinite_buffer_limit_approaches_mm1() -> None:
    """K buyudukce M/M/1/K sonuclari M/M/1'e yakinsamali.

    Kapali form tutarliliginin akil saglamasi: kapasite arttikca engellenme
    olasiligi sifira, L degeri ise rho / (1 - rho) degerine gitmelidir.
    """
    unlimited = mm1_metrics(arrival_rate=0.8, service_rate=1.0)
    previous_blocking = 1.0
    for capacity in (5, 10, 20, 40, 80):
        finite = mm1k_metrics(0.8, 1.0, capacity)
        assert finite["p_blocked"] < previous_blocking
        previous_blocking = finite["p_blocked"]
    assert finite["p_blocked"] == pytest.approx(0.0, abs=1e-6)
    assert finite["l_system"] == pytest.approx(unlimited.l_system, rel=1e-5)


# --------------------------------------------------------------------------- #
# VAKA 3 — Pollaczek-Khinchine (M/G/1)
# --------------------------------------------------------------------------- #

PK_ARRIVAL_RATE: float = 0.75

#: (etiket, islem suresi dagilimi) — hepsinin ortalamasi 1.0 dakika olacak
#: sekilde secildi; boylece rho = 0.75 sabit kalir ve tek degisen degiskenliktir.
PK_SERVICE_DISTRIBUTIONS = [
    ("M/D/1 (sabit)", Distribution.constant(1.0)),
    ("M/G/1 (ucgen)", Distribution.triangular(0.4, 0.8, 1.8)),
    ("M/G/1 (normal)", Distribution.normal(1.0, 0.25)),
    ("M/M/1 (ustel)", Distribution.exponential(1.0)),
]


def _service_moments(spec: Distribution) -> tuple[float, float]:
    """Dağılımın analitik ortalama ve varyansını döndürür.

    Nominal parametreler yerine dağılım nesnesinin kendi momentleri kullanılır:
    normal dağılım sıfırdan budandığı için gerçek ortalaması nominal değerinden
    farklı olabilir ve P-K formülüne **gerçekten örneklenen** dağılımın
    momentleri girmelidir.
    """
    distribution = create_distribution(spec, RandomStreamFactory(0).stream("moment"))
    return distribution.mean(), distribution.variance()


@pytest.fixture(scope="module")
def pk_results() -> Dict[str, List[ReplicationResult]]:
    """Dort farkli islem suresi dagilimiyla ayni yuk altinda kosumlar."""
    runs: Dict[str, List[ReplicationResult]] = {}
    for index, (label, service) in enumerate(PK_SERVICE_DISTRIBUTIONS):
        config = _single_station_config(
            service=service,
            interarrival_mean=1.0 / PK_ARRIVAL_RATE,
            num_servers=1,
            buffer_capacity=-1,
            duration=150_000.0,
            replications=8,
            seed=1930 + index,
        )
        results, _, _ = run_replications(config)
        runs[label] = results
    return runs


@pytest.mark.parametrize("label", [name for name, _ in PK_SERVICE_DISTRIBUTIONS])
def test_pollaczek_khinchine_matches_simulation(
    pk_results: Dict[str, List[ReplicationResult]], label: str
) -> None:
    """Ustel olmayan islem surelerinde de Wq kapali formla uyusmali.

    Bu, motorun bugune kadarki en genis kapsamli analitik dogrulamasidir:
    onceki testler yalnizca ustel sureleri kapsiyordu. P-K formulu yaklasim
    degil KESIN sonuctur ve islem suresi dagiliminin ilk iki momentine baglidir.
    """
    service = dict(PK_SERVICE_DISTRIBUTIONS)[label]
    mean, variance = _service_moments(service)
    expected = pollaczek_khinchine(PK_ARRIVAL_RATE, mean, variance)
    results = pk_results[label]

    _assert_close(
        _mean_of(results, lambda r: r.station("S").utilization),
        expected["utilization"],
        f"{label} rho",
    )
    _assert_close(
        _mean_of(results, lambda r: r.station("S").avg_wait_time),
        expected["w_queue"],
        f"{label} Wq",
    )
    _assert_close(
        _mean_of(results, lambda r: r.station("S").avg_queue_length),
        expected["l_queue"],
        f"{label} Lq",
    )
    _assert_close(
        _mean_of(results, lambda r: r.system.avg_flow_time),
        expected["w_system"],
        f"{label} W",
    )


def test_deterministic_service_halves_the_waiting_time(
    pk_results: Dict[str, List[ReplicationResult]]
) -> None:
    """M/D/1 beklemesi, ayni yukteki M/M/1 beklemesinin tam yarisi olmali.

    P-K formulunden dogrudan cikar: E[S^2] ustel surede 2/mu^2, sabit surede
    1/mu^2'dir. Degiskenligin kuyruga etkisini gosteren, endustri
    muhendisliginin en ogretici sonuclarindan biridir — ayni ortalama islem
    suresiyle, yalnizca degiskenligi kaldirarak bekleme yariya iner.
    """
    deterministic = _mean_of(
        pk_results["M/D/1 (sabit)"], lambda r: r.station("S").avg_wait_time
    )
    exponential = _mean_of(
        pk_results["M/M/1 (ustel)"], lambda r: r.station("S").avg_wait_time
    )

    assert deterministic == pytest.approx(exponential / 2.0, rel=TOLERANCE), (
        f"M/D/1 Wq={deterministic:.5f}, M/M/1 Wq={exponential:.5f}; "
        f"oran={deterministic / exponential:.4f} (beklenen 0.5)"
    )


def test_waiting_time_increases_with_service_variability(
    pk_results: Dict[str, List[ReplicationResult]]
) -> None:
    """Bekleme suresi, islem suresi degiskenligiyle birlikte artmali.

    Dort dagilimin ortalamasi ayni (1.0 dk), dolayisiyla rho hepsinde 0.75'tir.
    Aralarindaki tek fark varyanstir; bekleme siralamasinin varyans siralamasini
    izlemesi P-K formulunun dogrudan sonucudur.
    """
    ordered = sorted(
        (
            (_service_moments(service)[1], label)
            for label, service in PK_SERVICE_DISTRIBUTIONS
        )
    )
    previous_wait = -1.0
    for variance, label in ordered:
        wait = _mean_of(pk_results[label], lambda r: r.station("S").avg_wait_time)
        assert wait > previous_wait, (
            f"'{label}' (Var={variance:.4f}) beklemesi {wait:.5f}, "
            f"daha dusuk varyansli dagilimin beklemesinden ({previous_wait:.5f}) "
            f"kucuk cikti."
        )
        previous_wait = wait


# --------------------------------------------------------------------------- #
# VAKA 4 — Seri kuyruk ağı (Burke teoremi / Jackson ağı)
# --------------------------------------------------------------------------- #

TANDEM_ARRIVAL_RATE: float = 0.6
#: (istasyon kimligi, ortalama islem suresi) — farkli hizlarda uc istasyon.
TANDEM_STATIONS = [("A", 1.0), ("B", 1.2), ("C", 0.8)]


@pytest.fixture(scope="module")
def tandem_results() -> List[ReplicationResult]:
    """Seri bagli uc M/M/1 istasyonu."""
    config = SimulationConfig(
        stations=[
            Station(
                id=station_id,
                name=f"Istasyon {station_id}",
                service_time_distribution=Distribution.exponential(service_mean),
            )
            for station_id, service_mean in TANDEM_STATIONS
        ],
        connections=[
            Connection(from_station_id="A", to_station_id="B"),
            Connection(from_station_id="B", to_station_id="C"),
        ],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(1.0 / TANDEM_ARRIVAL_RATE),
            entry_station_id="A",
        ),
        simulation_duration_minutes=150_000.0,
        warmup_period_minutes=5_000.0,
        num_replications=8,
        random_seed=1956,
    )
    results, _, _ = run_replications(config)
    return results


@pytest.mark.parametrize(("station_id", "service_mean"), TANDEM_STATIONS)
def test_each_tandem_station_behaves_as_independent_mm1(
    tandem_results: List[ReplicationResult], station_id: str, service_mean: float
) -> None:
    """Seri hattaki her istasyon bagimsiz bir M/M/1 gibi davranmali.

    Burke teoremi: kararli bir M/M/1 kuyrugunun cikis sureci, ayni hizda bir
    Poisson surecidir. Bu nedenle asagi akistaki istasyon da M/M/1 varsayimini
    saglar. Sezgiye aykiridir — cikis sureci "duzlesmis" gorunse de degildir —
    ve cikis surecini yanlis modelleyen bir motorda tutmaz.
    """
    analytical = mm1_metrics(TANDEM_ARRIVAL_RATE, 1.0 / service_mean)
    _assert_close(
        _mean_of(tandem_results, lambda r: r.station(station_id).utilization),
        analytical.utilization,
        f"Seri hat {station_id} rho",
    )
    _assert_close(
        _mean_of(tandem_results, lambda r: r.station(station_id).avg_queue_length),
        analytical.l_queue,
        f"Seri hat {station_id} Lq",
    )
    _assert_close(
        _mean_of(tandem_results, lambda r: r.station(station_id).avg_wait_time),
        analytical.w_queue,
        f"Seri hat {station_id} Wq",
    )


def test_tandem_system_totals_are_sums_of_stations(
    tandem_results: List[ReplicationResult]
) -> None:
    """Sistemin L ve W degerleri istasyon degerlerinin toplami olmali.

    Jackson agi carpim formu cozumunun dogrudan sonucudur: istasyonlar
    bagimsiz oldugu icin beklenen degerler toplanabilir.
    """
    stations = [mm1_metrics(TANDEM_ARRIVAL_RATE, 1.0 / mean) for _, mean in TANDEM_STATIONS]
    expected_l = math.fsum(item.l_system for item in stations)
    expected_w = math.fsum(item.w_system for item in stations)

    _assert_close(
        _mean_of(tandem_results, lambda r: r.system.avg_wip), expected_l, "Seri hat L"
    )
    _assert_close(
        _mean_of(tandem_results, lambda r: r.system.avg_flow_time),
        expected_w,
        "Seri hat W",
    )
    # Little's Law da sistem duzeyinde saglanmali: L = lambda * W.
    assert expected_l == pytest.approx(TANDEM_ARRIVAL_RATE * expected_w, rel=1e-9)


def test_tandem_throughput_equals_arrival_rate(
    tandem_results: List[ReplicationResult]
) -> None:
    """Kararli bir acik agda cikis hizi varis hizina esitlenmeli."""
    observed = _mean_of(tandem_results, lambda r: r.system.throughput_per_minute)
    _assert_close(observed, TANDEM_ARRIVAL_RATE, "Seri hat cikti hizi")


# --------------------------------------------------------------------------- #
# VAKA 5 — Ham işlem süresi ve darboğaz hızı (Hopp & Spearman, Factory Physics)
# --------------------------------------------------------------------------- #

#: Penny Fab One yapisi: dort istasyon, her biri tek makine ve 2 saat cevrim.
PENNY_FAB_STATIONS: int = 4
PENNY_FAB_CYCLE_HOURS: float = 2.0

#: T_0 — ham islem suresi: bir isin hicbir kuyrukta beklemeden gecirecegi sure.
RAW_PROCESS_TIME: float = PENNY_FAB_STATIONS * PENNY_FAB_CYCLE_HOURS  # 8 saat

#: r_b — darbogaz hizi: en yavas istasyonun kapasitesi.
BOTTLENECK_RATE: float = 1.0 / PENNY_FAB_CYCLE_HOURS  # 0.5 is/saat

#: W_0 — kritik WIP: r_b * T_0.
CRITICAL_WIP: float = BOTTLENECK_RATE * RAW_PROCESS_TIME  # 4 is


def _penny_fab_config(arrival_rate: float, duration: float, seed: int) -> SimulationConfig:
    """Penny Fab One yapisinda acik varisli bir hat kurar."""
    station_ids = [f"P{index + 1}" for index in range(PENNY_FAB_STATIONS)]
    return SimulationConfig(
        stations=[
            Station(
                id=station_id,
                name=f"Istasyon {station_id}",
                service_time_distribution=Distribution.constant(PENNY_FAB_CYCLE_HOURS),
            )
            for station_id in station_ids
        ],
        connections=[
            Connection(from_station_id=first, to_station_id=second)
            for first, second in zip(station_ids, station_ids[1:])
        ],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(1.0 / arrival_rate),
            entry_station_id=station_ids[0],
        ),
        simulation_duration_minutes=duration,
        warmup_period_minutes=duration * 0.05,
        num_replications=5,
        random_seed=seed,
    )


def test_penny_fab_constants_match_the_textbook() -> None:
    """Penny Fab One'in T_0, r_b ve W_0 degerleri kitaptaki degerler olmali."""
    assert RAW_PROCESS_TIME == 8.0
    assert BOTTLENECK_RATE == 0.5
    assert CRITICAL_WIP == 4.0


def test_flow_time_approaches_raw_process_time_at_low_load() -> None:
    """Cok dusuk yukte akis suresi ham islem suresine yakinsamali.

    Kuyruk olusmadiginda bir is yalnizca islem surelerini toplar; T_0 bu
    nedenle akis suresinin **asagi sinirdir** ve altina inilemez.
    """
    results, _, _ = run_replications(
        _penny_fab_config(arrival_rate=0.02, duration=400_000.0, seed=2008)
    )
    observed = _mean_of(results, lambda r: r.system.avg_flow_time)

    assert observed >= RAW_PROCESS_TIME, (
        f"Akis suresi ({observed:.4f}) ham islem suresinin ({RAW_PROCESS_TIME}) "
        f"altina inemez."
    )
    assert observed == pytest.approx(RAW_PROCESS_TIME, rel=TOLERANCE)


def test_throughput_can_never_exceed_bottleneck_rate() -> None:
    """Cikti darbogaz hizini asamaz; asiri yuk yalnizca WIP biriktirir.

    Varis hizi r_b'nin uzerine cikarildiginda sistem daha fazla uretmez;
    Kisitlar Teorisi'nin ve Factory Physics'in ortak temel savidir.
    """
    overloaded = _penny_fab_config(arrival_rate=0.8, duration=20_000.0, seed=2009)
    results, _, _ = run_replications(overloaded)

    observed = _mean_of(results, lambda r: r.system.throughput_per_minute)
    assert observed <= BOTTLENECK_RATE + 1e-9, (
        f"Cikti ({observed:.6f}) darbogaz hizini ({BOTTLENECK_RATE}) asamaz."
    )
    assert observed == pytest.approx(BOTTLENECK_RATE, rel=0.02)
    # Asırı yükte sistem kararsız olarak işaretlenmeli.
    assert not results[0].stability.is_stable


def test_flow_time_grows_as_load_approaches_bottleneck_rate() -> None:
    """Yuk darbogaz hizina yaklastikca akis suresi T_0'in cok uzerine cikmali."""
    previous_flow_time = 0.0
    for arrival_rate in (0.05, 0.2, 0.35, 0.45):
        results, _, _ = run_replications(
            _penny_fab_config(arrival_rate, duration=120_000.0, seed=2010)
        )
        flow_time = _mean_of(results, lambda r: r.system.avg_flow_time)
        assert flow_time >= RAW_PROCESS_TIME
        assert flow_time > previous_flow_time
        previous_flow_time = flow_time

    # rho = 0.9'da akis suresi ham islem suresinin belirgin ustunde olmali.
    assert previous_flow_time > RAW_PROCESS_TIME * 1.5


# --------------------------------------------------------------------------- #
# Rapor
# --------------------------------------------------------------------------- #


def test_report_known_scenarios(
    erlang_results: List[ReplicationResult],
    mm1k_underloaded: List[ReplicationResult],
    mm1k_overloaded: List[ReplicationResult],
    pk_results: Dict[str, List[ReplicationResult]],
    tandem_results: List[ReplicationResult],
) -> None:
    """Literatur karsilastirma tablosunu yazdirir (`pytest -s`)."""
    rows: List[tuple[str, str, float, float]] = []

    blocking = erlang_loss_blocking(ERLANG_SERVERS, ERLANG_OFFERED_LOAD)
    rows.append(
        (
            "Erlang M/M/3/3 (1917)",
            "engellenme B(3,2)",
            blocking,
            _mean_of(
                erlang_results,
                lambda r: r.system.entities_rejected / r.system.entities_created,
            ),
        )
    )
    rows.append(
        (
            "",
            "kullanim a(1-B)/c",
            ERLANG_OFFERED_LOAD * (1.0 - blocking) / ERLANG_SERVERS,
            _mean_of(erlang_results, lambda r: r.station("S").utilization),
        )
    )

    for label, arrival_rate, results in (
        ("M/M/1/5, rho=0.8", 0.8, mm1k_underloaded),
        ("M/M/1/5, rho=1.2", 1.2, mm1k_overloaded),
    ):
        expected = mm1k_metrics(arrival_rate, MM1K_SERVICE_RATE, MM1K_CAPACITY)
        rows.append(
            (
                label,
                "engellenme P_K",
                expected["p_blocked"],
                _mean_of(
                    results,
                    lambda r: r.system.entities_rejected / r.system.entities_created,
                ),
            )
        )
        rows.append(
            ("", "L", expected["l_system"], _mean_of(results, lambda r: r.system.avg_wip))
        )
        rows.append(
            (
                "",
                "W",
                expected["w_system"],
                _mean_of(results, lambda r: r.system.avg_flow_time),
            )
        )

    for label, service in PK_SERVICE_DISTRIBUTIONS:
        mean, variance = _service_moments(service)
        expected = pollaczek_khinchine(PK_ARRIVAL_RATE, mean, variance)
        rows.append(
            (
                f"P-K {label}",
                f"Wq (Var={variance:.4f})",
                expected["w_queue"],
                _mean_of(pk_results[label], lambda r: r.station("S").avg_wait_time),
            )
        )

    for station_id, service_mean in TANDEM_STATIONS:
        analytical = mm1_metrics(TANDEM_ARRIVAL_RATE, 1.0 / service_mean)
        rows.append(
            (
                f"Burke/Jackson {station_id}",
                "Lq",
                analytical.l_queue,
                _mean_of(
                    tandem_results, lambda r: r.station(station_id).avg_queue_length
                ),
            )
        )

    lines = [
        "\nLITERATURDEN BILINEN VAKALAR — TEST 4",
        "-" * 88,
        f"{'Vaka':<26}{'Buyukluk':<22}{'Literatur':>13}{'Simulasyon':>13}{'Sapma':>10}",
        "-" * 88,
    ]
    for case, quantity, expected_value, observed_value in rows:
        deviation = (
            abs(observed_value - expected_value) / abs(expected_value) * 100.0
            if expected_value
            else 0.0
        )
        lines.append(
            f"{case:<26}{quantity:<22}{expected_value:>13.6f}"
            f"{observed_value:>13.6f}{f'%{deviation:.2f}':>10}"
        )
    lines.append("-" * 88)
    lines.append(
        f"Factory Physics (Penny Fab One): T_0 = {RAW_PROCESS_TIME} saat, "
        f"r_b = {BOTTLENECK_RATE} is/saat, W_0 = {CRITICAL_WIP} is"
    )
    print("\n".join(lines))
