"""FastAPI servis katmanının doğrulaması — Şartname Bölüm 5.

Test edilen dört şey:

1. **Sözleşme.** Yanıt gövdeleri şartnamede tanımlanan anahtarları ve tipleri
   birebir taşımalı. Bir alanın adının değişmesi istemcileri kırar; bu yüzden
   anahtarlar tek tek sınanır.
2. **Analitik tutarlılık.** API'den dönen değerler, aynı senaryonun bilinen
   kapalı form sonuçlarıyla uyuşmalı. Katmanların birinde yanlış alan eşlemesi
   yapılırsa (ör. Wq yerine W döndürmek) bu testler düşer.
3. **Hata davranışı.** Geçersiz konfigürasyon 422, bilinmeyen kimlik 404,
   çok büyük istek 422 vermeli. Kararsız model ise hata **değildir**: koşum
   tamamlanır ve uyarı üretilir (Şartname TEST 3).
4. **Karşılaştırmanın istatistiksel dürüstlüğü.** Aynı senaryo iki kez
   verildiğinde fark anlamsız, belirgin biçimde farklı senaryolarda anlamlı
   çıkmalı.

Testler küçük simülasyonlar kullanır; amaç motorun doğruluğunu yeniden
sınamak değil (bunu diğer dosyalar yapar), API katmanının bağlantılarını
doğrulamaktır.
"""

from __future__ import annotations

from typing import Any, Dict, List

import pytest
from fastapi.testclient import TestClient

from simulation_engine.api.simulation_service import (
    ANALYTICAL_TOLERANCE_PCT,
    API_PREFIX,
    MAX_COMPARISON_SCENARIOS,
    SimulationStore,
    app,
    estimate_event_count,
    get_store,
)
from simulation_engine.models.schemas import SimulationConfig
from simulation_engine.validation.conftest import TEST_ORG_ID

#: M/M/1: lambda = 0.8, mu = 1.0, rho = 0.8 -> L = 4, W = 5, Wq = 4, Lq = 3.2
MM1_ANALYTIC = {"rho": 0.8, "L": 4.0, "W": 5.0, "Wq": 4.0, "Lq": 3.2}


def _mm1_body(
    duration: float = 20_000.0,
    warmup: float = 2_000.0,
    replications: int = 8,
    seed: int = 1234,
    service_mean: float = 1.0,
) -> Dict[str, Any]:
    """API gövdesi olarak M/M/1 senaryosu."""
    return {
        "stations": [
            {
                "id": "S",
                "name": "Tek Istasyon",
                "num_servers": 1,
                "service_time_distribution": {
                    "type": "exponential",
                    "params": {"mean": service_mean},
                },
            }
        ],
        "connections": [],
        "arrival_process": {
            "distribution": {"type": "exponential", "params": {"mean": 1.25}},
            "entry_station_id": "S",
        },
        "simulation_duration_minutes": duration,
        "warmup_period_minutes": warmup,
        "num_replications": replications,
        "random_seed": seed,
    }


def _two_station_body(seed: int = 4321) -> Dict[str, Any]:
    """Ustel olmayan sureli, arizali ve sonlu tamponlu iki istasyonlu hat."""
    return {
        "stations": [
            {
                "id": "A",
                "name": "Kesim",
                "service_time_distribution": {
                    "type": "triangular",
                    "params": {"min": 0.4, "mode": 0.6, "max": 1.0},
                },
            },
            {
                "id": "B",
                "name": "Pres",
                "service_time_distribution": {
                    "type": "constant",
                    "params": {"value": 0.9},
                },
                "buffer_capacity_before": 3,
                "scrap_rate": 0.1,
                "failure_rate": 0.002,
                "repair_time_distribution": {
                    "type": "exponential",
                    "params": {"mean": 8.0},
                },
            },
        ],
        "connections": [{"from_station_id": "A", "to_station_id": "B"}],
        "arrival_process": {
            "distribution": {"type": "exponential", "params": {"mean": 1.4}},
            "entry_station_id": "A",
        },
        "simulation_duration_minutes": 20_000.0,
        "warmup_period_minutes": 2_000.0,
        "num_replications": 6,
        "random_seed": seed,
    }


@pytest.fixture
def client() -> TestClient:
    """Her test için izole bir depoya sahip istemci."""
    store = SimulationStore()
    app.dependency_overrides[get_store] = lambda: store
    with TestClient(app) as test_client:
        yield test_client
    # Yalnizca bu fixture'in ekledigi anahtar kaldirilir. Blanket `.clear()`,
    # `conftest.py`'nin oturum kapsaminda kurdugu `get_current_org`
    # gecersiz kilmasini da silerdi ve o override bir daha hic kurulmazdi
    # (oturum fixture'i yalnizca bir kez calisir) — sonraki her test 401 alirdi.
    app.dependency_overrides.pop(get_store, None)


@pytest.fixture(scope="module")
def shared_client() -> TestClient:
    """Pahalı koşumları paylaşan istemci (depo modül boyunca korunur)."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def mm1_run(shared_client: TestClient) -> Dict[str, Any]:
    """M/M/1 senaryosunu bir kez çalıştırır ve yanıtı paylaşır."""
    response = shared_client.post(f"{API_PREFIX}/run", json=_mm1_body())
    assert response.status_code == 200, response.text
    return response.json()


# --------------------------------------------------------------------------- #
# 1. POST /run — sözleşme
# --------------------------------------------------------------------------- #


def test_run_response_matches_specified_shape(mm1_run: Dict[str, Any]) -> None:
    """Yanit govdesi sartnamedeki anahtarlari tasimali."""
    assert set(["simulation_id", "status", "results"]).issubset(mm1_run)
    assert mm1_run["status"] == "completed"
    assert isinstance(mm1_run["simulation_id"], str) and mm1_run["simulation_id"]

    results = mm1_run["results"]
    for key in (
        "total_throughput",
        "confidence_interval_95",
        "station_metrics",
        "bottleneck_station_id",
        "littles_law_validation",
    ):
        assert key in results, f"'{key}' alani yanitta yok"

    assert isinstance(results["total_throughput"], int)
    interval = results["confidence_interval_95"]
    assert isinstance(interval, list) and len(interval) == 2
    assert interval[0] <= results["total_throughput"] <= interval[1]

    station = results["station_metrics"][0]
    for key in ("station_id", "utilization", "avg_queue_length", "avg_wait_time", "oee"):
        assert key in station, f"istasyon metriginde '{key}' yok"
    for key in ("availability", "performance", "quality"):
        assert key in station["oee"], f"OEE kiriliminda '{key}' yok"

    validation = results["littles_law_validation"]
    assert isinstance(validation["passed"], bool)
    assert isinstance(validation["deviation_pct"], float)


def test_run_results_match_analytical_mm1(mm1_run: Dict[str, Any]) -> None:
    """API'den donen degerler M/M/1 kapali form sonuclariyla uyusmali.

    Bu test katmanlar arasi alan eslemesini de dogrular: Wq yerine W dondurmek
    gibi bir hata burada yakalanir.
    """
    results = mm1_run["results"]
    station = results["station_metrics"][0]

    assert station["utilization"] == pytest.approx(MM1_ANALYTIC["rho"], rel=0.05)
    assert station["avg_queue_length"] == pytest.approx(MM1_ANALYTIC["Lq"], rel=0.10)
    assert station["avg_wait_time"] == pytest.approx(MM1_ANALYTIC["Wq"], rel=0.10)
    assert results["avg_wip"] == pytest.approx(MM1_ANALYTIC["L"], rel=0.10)
    assert results["avg_flow_time"] == pytest.approx(MM1_ANALYTIC["W"], rel=0.10)

    assert results["bottleneck_station_id"] == "S"
    assert station["is_bottleneck"] is True
    assert results["is_stable"] is True
    assert results["littles_law_validation"]["passed"] is True


def test_run_reports_confidence_interval_not_a_point_estimate(
    mm1_run: Dict[str, Any],
) -> None:
    """Cikti tek bir sayi degil, guven araligiyla birlikte sunulmali."""
    results = mm1_run["results"]
    lower, upper = results["confidence_interval_95"]

    assert lower < upper, "Coklu replikasyonda aralik sifir genislikte olamaz"
    assert "guven araligi" in mm1_run["headline"]
    assert "Beklenen uretim" in mm1_run["headline"]


def test_run_is_reproducible_via_reported_seed(shared_client: TestClient) -> None:
    """Ayni random_seed ile iki kosum ayni sonucu vermeli (TEST 5)."""
    first = shared_client.post(f"{API_PREFIX}/run", json=_mm1_body(seed=777)).json()
    second = shared_client.post(f"{API_PREFIX}/run", json=_mm1_body(seed=777)).json()

    assert first["simulation_id"] != second["simulation_id"]
    assert first["master_seed"] == second["master_seed"] == 777
    assert first["results"] == second["results"]


def test_quality_component_reflects_scrap_rate(shared_client: TestClient) -> None:
    """Fire orani OEE'nin Quality bilesenine yansimali."""
    response = shared_client.post(f"{API_PREFIX}/run", json=_two_station_body())
    assert response.status_code == 200, response.text
    stations = {s["station_id"]: s for s in response.json()["results"]["station_metrics"]}

    assert stations["A"]["oee"]["quality"] == pytest.approx(1.0)
    assert stations["B"]["oee"]["quality"] == pytest.approx(0.9, rel=0.05)
    # Arıza modeli olan istasyonun kullanılabilirliği 1.0'ın altında olmalı.
    assert stations["B"]["oee"]["availability"] < 1.0
    assert stations["A"]["oee"]["availability"] == pytest.approx(1.0)


# --------------------------------------------------------------------------- #
# 2. POST /run — hata davranışı
# --------------------------------------------------------------------------- #


def test_invalid_config_returns_422(client: TestClient) -> None:
    """Sema dogrulamasini gecemeyen govde 422 vermeli."""
    body = _mm1_body()
    body["arrival_process"]["entry_station_id"] = "YOK"
    response = client.post(f"{API_PREFIX}/run", json=body)
    assert response.status_code == 422


def test_negative_service_time_returns_422(client: TestClient) -> None:
    """Fiziksel olarak anlamsiz dagilim parametresi 422 vermeli."""
    body = _mm1_body()
    body["stations"][0]["service_time_distribution"]["params"]["mean"] = -1.0
    response = client.post(f"{API_PREFIX}/run", json=body)
    assert response.status_code == 422


def test_warmup_longer_than_run_returns_422(client: TestClient) -> None:
    """Isinma suresi toplam sureden uzun olamaz."""
    response = client.post(
        f"{API_PREFIX}/run", json=_mm1_body(duration=1_000.0, warmup=2_000.0)
    )
    assert response.status_code == 422


def test_unstable_model_completes_with_warning(client: TestClient) -> None:
    """Sinirsiz tamponda rho >= 1 kararsizdir: kosum tamamlanir, acik uyari verilir.

    Sessizce anlamsiz sayi uretmek kabul edilemez; sessizce hata dondurmek de
    kullaniciyi senaryosunu inceleyemez birakir. Dogru davranis, sonucu
    uyariyla birlikte sunmaktir (TEST 3).
    """
    body = _mm1_body(duration=3_000.0, warmup=200.0, replications=3, service_mean=2.0)
    body["stations"][0]["buffer_capacity_before"] = -1  # sinirsiz kuyruk
    response = client.post(f"{API_PREFIX}/run", json=body)

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["results"]["is_stable"] is False
    assert any("KARARSIZ" in warning for warning in payload["warnings"])
    assert any("sinirsiz buyuyecek" in warning for warning in payload["warnings"])
    # Kapasite sınırlı uyarısı burada çıkmamalı: tampon sınırsız.
    assert not any("KAPASITE SINIRLI" in warning for warning in payload["warnings"])


def test_overloaded_finite_buffer_is_reported_as_capacity_limited(
    client: TestClient,
) -> None:
    """Sonlu tamponlu rho >= 1 sistemi KARARLI olarak raporlanmali.

    Ayni yuk (rho = 1.6) sinirsiz tamponda kuyrugu sinirsiz buyutur, sonlu
    tamponda ise buyutemez: fazla parca girişte reddedilir ve sistem M/M/1/K
    olarak kararli duruma yakinsar. Iki durumu ayni uyariyla raporlamak,
    kapali formuyla birebir uyusan bir sistem icin "kuyruk sinirsiz buyuyecek"
    demek anlamina gelirdi.
    """
    body = _mm1_body(duration=6_000.0, warmup=500.0, replications=3, service_mean=2.0)
    body["stations"][0]["buffer_capacity_before"] = 4  # K = 4 + 1 = 5
    response = client.post(f"{API_PREFIX}/run", json=body)

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["results"]["is_stable"] is True

    capacity_warnings = [w for w in payload["warnings"] if "KAPASITE SINIRLI" in w]
    assert capacity_warnings, payload["warnings"]
    warning = capacity_warnings[0]
    assert "KARARLIDIR" in warning
    assert "sisteme alinamayacak" in warning
    # Yanıltıcı "sınırsız büyüyecek" ifadesi bu senaryoda görünmemeli.
    assert not any("sinirsiz buyuyecek" in w for w in payload["warnings"])
    assert not any("KARARSIZ" in w for w in payload["warnings"])


def test_unbounded_upstream_still_reported_as_unstable(client: TestClient) -> None:
    """Sonlu tamponlu darbogazi besleyen sinirsiz tampon varsa sistem kararsizdir.

    Asiri yuklu istasyonun kendi tamponu sonlu olsa bile, ona besleme yapan
    istasyonun tamponu sinirsizsa birikim orada olusur. Yalnizca darbogazin
    tamponuna bakan bir denetim bu durumu 'kararli' ilan ederdi.
    """
    body = {
        "stations": [
            {
                "id": "A",
                "name": "Besleyici",
                "service_time_distribution": {
                    "type": "constant",
                    "params": {"value": 0.3},
                },
            },
            {
                "id": "B",
                "name": "Asiri Yuklu",
                "service_time_distribution": {
                    "type": "constant",
                    "params": {"value": 2.5},
                },
                "buffer_capacity_before": 2,
            },
        ],
        "connections": [{"from_station_id": "A", "to_station_id": "B"}],
        "arrival_process": {
            "distribution": {"type": "exponential", "params": {"mean": 1.25}},
            "entry_station_id": "A",
        },
        "simulation_duration_minutes": 4_000.0,
        "warmup_period_minutes": 300.0,
        "num_replications": 2,
        "random_seed": 99,
    }
    response = client.post(f"{API_PREFIX}/run", json=body)

    assert response.status_code == 200
    payload = response.json()
    assert payload["results"]["is_stable"] is False

    unstable_warnings = [w for w in payload["warnings"] if "KARARSIZ" in w]
    assert unstable_warnings
    assert any("besleme yapan" in w for w in unstable_warnings)
    assert any("'A'" in w for w in unstable_warnings)


def test_oversized_request_is_rejected(client: TestClient) -> None:
    """Is yuku sinirini asan istek 422 ile reddedilmeli."""
    body = _mm1_body(duration=500_000_000.0, warmup=1_000.0, replications=50)
    response = client.post(f"{API_PREFIX}/run", json=body)

    assert response.status_code == 422
    assert "cok buyuk" in response.json()["detail"]


def test_event_estimate_scales_with_workload() -> None:
    """Is yuku kestirimi sure ve replikasyon sayisiyla dogru orantili olmali."""
    base = SimulationConfig.model_validate(_mm1_body(duration=10_000.0, replications=2))
    longer = SimulationConfig.model_validate(_mm1_body(duration=20_000.0, replications=2))
    more = SimulationConfig.model_validate(_mm1_body(duration=10_000.0, replications=4))

    assert estimate_event_count(longer) == pytest.approx(
        2 * estimate_event_count(base)
    )
    assert estimate_event_count(more) == pytest.approx(2 * estimate_event_count(base))


# --------------------------------------------------------------------------- #
# 3. GET /{id}/validation-report
# --------------------------------------------------------------------------- #


def test_validation_report_for_mm1(
    shared_client: TestClient, mm1_run: Dict[str, Any]
) -> None:
    """M/M/1 kosumunun dogrulama raporu analitik karsilastirma icermeli."""
    simulation_id = mm1_run["simulation_id"]
    response = shared_client.get(f"{API_PREFIX}/{simulation_id}/validation-report")
    assert response.status_code == 200, response.text
    report = response.json()

    assert report["simulation_id"] == simulation_id
    assert report["passed"] is True
    assert report["littles_law_summary"]["passed"] is True
    assert report["littles_law_summary"]["replications_checked"] == 8
    assert report["stability"]["is_stable"] is True

    comparison = report["queueing_comparisons"][0]
    assert comparison["applicable"] is True
    assert comparison["analytical"]["notation"] == "M/M/1"
    assert comparison["analytical"]["l_queue"] == pytest.approx(
        MM1_ANALYTIC["Lq"], rel=1e-9
    )
    assert comparison["analytical"]["w_queue"] == pytest.approx(
        MM1_ANALYTIC["Wq"], rel=1e-9
    )
    assert comparison["passed"] is True
    assert comparison["deviation_w_queue_pct"] <= ANALYTICAL_TOLERANCE_PCT

    assert str(mm1_run["master_seed"]) in report["reproducibility_note"]
    assert len(report["replication_seeds"]) == 8


def test_validation_report_marks_inapplicable_stations(
    shared_client: TestClient,
) -> None:
    """Kapali form modelin gecerli olmadigi istasyonlar karsilastirilmamali.

    Ucgen islem sureli bir istasyonu M/M/c formuluyle karsilastirip 'sapma var'
    demek, motoru degil yanlis modeli suclamak olurdu. Sistem bunun yerine
    gerekcesini acikca soylemelidir.
    """
    run = shared_client.post(f"{API_PREFIX}/run", json=_two_station_body()).json()
    report = shared_client.get(
        f"{API_PREFIX}/{run['simulation_id']}/validation-report"
    ).json()

    comparisons = {c["station_id"]: c for c in report["queueing_comparisons"]}
    assert comparisons["A"]["applicable"] is False
    assert "ustel degil" in comparisons["A"]["reason"]
    assert comparisons["A"]["analytical"] is None

    assert comparisons["B"]["applicable"] is False
    for expected in ("ariza modeli", "tampon sonlu", "ustel degil"):
        assert expected in comparisons["B"]["reason"]

    # Analitik karşılaştırma yapılamasa da Little's Law denetimi çalışmalı.
    assert report["littles_law_summary"]["replications_checked"] == 6
    assert "Little's Law" in report["summary"]


def test_validation_report_unknown_id_returns_404(client: TestClient) -> None:
    """Bilinmeyen kimlik 404 ve aciklayici mesaj vermeli."""
    response = client.get(f"{API_PREFIX}/olmayan-kimlik/validation-report")

    assert response.status_code == 404
    assert "bulunamadi" in response.json()["detail"]


def test_store_evicts_oldest_entries() -> None:
    """Depo kapasitesi asildiginda en eski kayit dusurulmeli."""
    from simulation_engine.api.simulation_service import StoredSimulation

    store = SimulationStore(max_entries=2)
    records = [
        StoredSimulation(
            simulation_id=f"id-{index}",
            config=SimulationConfig.model_validate(_mm1_body()),
            replications=[],
            monte_carlo=None,  # type: ignore[arg-type]
            bottleneck=None,  # type: ignore[arg-type]
            oee=None,  # type: ignore[arg-type]
            duration_seconds=0.0,
            org_id=TEST_ORG_ID,
        )
        for index in range(3)
    ]
    for record in records:
        store.save(record)

    assert len(store) == 2
    with pytest.raises(KeyError):
        store.get(TEST_ORG_ID, "id-0")
    assert store.get(TEST_ORG_ID, "id-2").simulation_id == "id-2"


# --------------------------------------------------------------------------- #
# 4. POST /compare
# --------------------------------------------------------------------------- #


def test_compare_identical_scenarios_finds_no_significant_difference(
    shared_client: TestClient,
) -> None:
    """Ayni senaryo iki kez verildiginde fark anlamsiz cikmali.

    Ayni ana tohumla calisan iki ozdes senaryonun farki tam olarak sifirdir;
    guven araligi sifiri icermelidir. Anlamlilik testini yapmayan bir
    uygulamada bu ayrim hic gorulmezdi.
    """
    body = [_mm1_body(seed=100), _mm1_body(seed=100)]
    response = shared_client.post(f"{API_PREFIX}/compare", json=body)
    assert response.status_code == 200, response.text
    payload = response.json()

    assert len(payload["scenarios"]) == 2
    assert payload["scenarios"][0]["total_throughput"] == pytest.approx(
        payload["scenarios"][1]["total_throughput"]
    )
    for difference in payload["differences"]:
        assert difference["difference"] == pytest.approx(0.0)
        assert difference["is_significant"] is False
        assert "ANLAMLI DEGIL" in difference["interpretation"]


def test_compare_detects_significant_improvement(shared_client: TestClient) -> None:
    """Belirgin bicimde farkli senaryolarda fark anlamli cikmali.

    Referans senaryonun hizmet suresi 1.0 dk; ikincisinde 0.7 dk. Ikinci
    senaryo daha kisa akis suresi ve daha dusuk WIP uretmeli ve bu fark
    istatistiksel olarak anlamli olmali.
    """
    body = [_mm1_body(seed=200), _mm1_body(seed=200, service_mean=0.7)]
    response = shared_client.post(f"{API_PREFIX}/compare", json=body)
    assert response.status_code == 200, response.text
    payload = response.json()

    differences = {d["metric"]: d for d in payload["differences"]}
    flow_time = differences["avg_flow_time"]
    work_in_process = differences["avg_wip"]

    assert flow_time["is_significant"] is True
    assert flow_time["difference"] < 0, "Daha hizli hat akis suresini dusurmeli"
    assert "ANLAMLI" in flow_time["interpretation"]
    assert work_in_process["is_significant"] is True
    assert work_in_process["difference"] < 0

    # Fark aralığı sıfırı dışarıda bırakmalı.
    assert not (flow_time["ci_lower"] <= 0 <= flow_time["ci_upper"])


def test_compare_reports_best_scenario_with_rationale(
    shared_client: TestClient,
) -> None:
    """En iyi senaryo, ustunlugunun anlamli olup olmadigiyla birlikte bildirilmeli."""
    body = [_mm1_body(seed=300), _mm1_body(seed=300, service_mean=0.7)]
    payload = shared_client.post(f"{API_PREFIX}/compare", json=body).json()

    best_index = payload["best_scenario_index"]
    throughputs = [row["total_throughput"] for row in payload["scenarios"]]
    assert throughputs[best_index] == max(throughputs)
    assert payload["best_scenario_rationale"]
    assert "Senaryo" in payload["best_scenario_rationale"]


def test_compare_scenarios_are_stored_and_retrievable(
    shared_client: TestClient,
) -> None:
    """Karsilastirmadaki her senaryo icin dogrulama raporu alinabilmeli."""
    body = [_mm1_body(seed=400), _mm1_body(seed=401)]
    payload = shared_client.post(f"{API_PREFIX}/compare", json=body).json()

    for row in payload["scenarios"]:
        report = shared_client.get(
            f"{API_PREFIX}/{row['simulation_id']}/validation-report"
        )
        assert report.status_code == 200
        assert report.json()["simulation_id"] == row["simulation_id"]


def test_compare_requires_at_least_two_scenarios(client: TestClient) -> None:
    """Tek senaryo karsilastirilamaz."""
    response = client.post(f"{API_PREFIX}/compare", json=[_mm1_body()])
    assert response.status_code == 422


def test_compare_rejects_too_many_scenarios(client: TestClient) -> None:
    """Senaryo sayisi sinirini asan istek reddedilmeli."""
    body: List[Dict[str, Any]] = [
        _mm1_body(duration=1_000.0, warmup=100.0, replications=1)
        for _ in range(MAX_COMPARISON_SCENARIOS + 1)
    ]
    response = client.post(f"{API_PREFIX}/compare", json=body)

    assert response.status_code == 422
    assert str(MAX_COMPARISON_SCENARIOS) in response.json()["detail"]


def test_compare_rejects_oversized_scenario_naming_it(client: TestClient) -> None:
    """Sinir asan senaryo, kacinci senaryo oldugu belirtilerek reddedilmeli."""
    body = [
        _mm1_body(duration=1_000.0, warmup=100.0, replications=1),
        _mm1_body(duration=500_000_000.0, warmup=1_000.0, replications=50),
    ]
    response = client.post(f"{API_PREFIX}/compare", json=body)

    assert response.status_code == 422
    assert "Senaryo 2" in response.json()["detail"]


# --------------------------------------------------------------------------- #
# 5. OpenAPI şeması
# --------------------------------------------------------------------------- #


def test_cors_allows_the_vite_dev_server(client: TestClient) -> None:
    """Frontend'in gelistirme sunucusu tarayicidan dogrudan istek atabilmeli.

    CORS baslikleri eksikse arayuz backend'e hic ulasamaz ve hata tarayici
    konsolunda kalir; sunucu tarafinda hicbir iz birakmaz. Bu yuzden ayarin
    testi burada tutulur.
    """
    response = client.options(
        f"{API_PREFIX}/run",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code in (200, 204), response.text
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "POST" in response.headers.get("access-control-allow-methods", "")


def test_cors_rejects_unknown_origin(client: TestClient) -> None:
    """Izin verilmeyen bir kaynak icin CORS basligi donmemeli.

    Joker (`*`) yerine acik liste kullanilmasinin nedeni budur: kullanicinin
    tarayicisindaki herhangi bir site bu API'yi cagiramamalidir.
    """
    response = client.get(
        "/openapi.json", headers={"Origin": "https://kotu-site.example"}
    )
    assert "access-control-allow-origin" not in response.headers


def test_resolve_allowed_origins_reads_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Yayina alinmis frontend adresi ortam degiskeninden okunmali.

    Adres kodda sabit olsaydi, frontend her yeni adrese tasindiginda kaynak
    kodu duzenleyip backend'i yeniden dagitmak gerekirdi.
    """
    from simulation_engine.api.simulation_service import (
        DEVELOPMENT_ORIGINS,
        FRONTEND_ORIGINS_ENV,
        resolve_allowed_origins,
    )

    monkeypatch.setenv(FRONTEND_ORIGINS_ENV, "https://optiflow.vercel.app")
    origins = resolve_allowed_origins()

    assert "https://optiflow.vercel.app" in origins
    # Gelistirme adresleri her zaman korunmali; aksi halde yayina alindiginda
    # yerel gelistirme calismaz hale gelirdi.
    for development_origin in DEVELOPMENT_ORIGINS:
        assert development_origin in origins


def test_resolve_allowed_origins_accepts_multiple_and_normalizes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Virgulle ayrilmis adresler bolunmeli, bosluk ve sondaki egik cizgi atilmali.

    Vercel her dala ayri bir onizleme adresi verir; birden fazla adres
    tanimlanabilmesi bu yuzden gereklidir. Sondaki egik cizgi temizlenmezse
    tarayici adresi farkli bir kaynak sayar ve CORS sessizce basarisiz olur.
    """
    from simulation_engine.api.simulation_service import (
        FRONTEND_ORIGINS_ENV,
        resolve_allowed_origins,
    )

    monkeypatch.setenv(
        FRONTEND_ORIGINS_ENV,
        " https://optiflow.vercel.app/ , https://optiflow-git-main.vercel.app ",
    )
    origins = resolve_allowed_origins()

    assert "https://optiflow.vercel.app" in origins
    assert "https://optiflow-git-main.vercel.app" in origins
    assert not any(origin.endswith("/") for origin in origins)


def test_resolve_allowed_origins_without_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Degisken tanimli degilse yalnizca gelistirme adresleri bulunmali."""
    from simulation_engine.api.simulation_service import (
        DEVELOPMENT_ORIGINS,
        FRONTEND_ORIGINS_ENV,
        resolve_allowed_origins,
    )

    monkeypatch.delenv(FRONTEND_ORIGINS_ENV, raising=False)
    assert resolve_allowed_origins() == DEVELOPMENT_ORIGINS
    # Joker hicbir kosulda kullanilmamali.
    assert "*" not in resolve_allowed_origins()


def test_trace_endpoint_returns_events(
    shared_client: TestClient, mm1_run: Dict[str, Any]
) -> None:
    """Olay izi ucu, animasyon icin gereken olaylari dondurmeli."""
    response = shared_client.get(f"{API_PREFIX}/{mm1_run['simulation_id']}/trace")
    assert response.status_code == 200, response.text
    trace = response.json()

    assert trace["events"], "iz bos olmamali"
    assert trace["duration_minutes"] > 0
    assert trace["station_ids"] == ["S"]
    # Iz tek replikasyondan alinir; arayuz bunu kullaniciya bildirebilmeli.
    assert trace["replication_index"] == 0
    assert trace["total_replications"] == mm1_run["results"]["num_replications"]

    timestamps = [event["timestamp"] for event in trace["events"]]
    assert timestamps == sorted(timestamps)
    assert trace["events"][0]["event_type"] == "arrival"


def test_trace_is_deterministic(
    shared_client: TestClient, mm1_run: Dict[str, Any]
) -> None:
    """Ayni simulasyon icin iz her cagrida ayni olmali.

    Iz saklanmaz, ayni tohumla yeniden uretilir; iki cagrinin farkli sonuc
    vermesi, animasyonun raporlanan sayilarla iliskisini koparirdi.
    """
    path = f"{API_PREFIX}/{mm1_run['simulation_id']}/trace"
    first = shared_client.get(path).json()
    second = shared_client.get(path).json()

    assert first == second


def test_trace_endpoint_unknown_id_returns_404(client: TestClient) -> None:
    """Bilinmeyen kimlik icin iz uretilemez."""
    response = client.get(f"{API_PREFIX}/olmayan-kimlik/trace")

    assert response.status_code == 404
    assert "bulunamadi" in response.json()["detail"]


def test_trace_does_not_alter_stored_results(
    shared_client: TestClient, mm1_run: Dict[str, Any]
) -> None:
    """Iz uretmek, saklanmis sonuclari degistirmemeli.

    Iz ayri bir kosumdan uretilir; bu kosumun saklanan kayda sizmasi,
    kullanicinin gordugu istatistikleri sessizce degistirirdi.
    """
    simulation_id = mm1_run["simulation_id"]
    before = shared_client.get(f"{API_PREFIX}/{simulation_id}/validation-report").json()

    shared_client.get(f"{API_PREFIX}/{simulation_id}/trace")

    after = shared_client.get(f"{API_PREFIX}/{simulation_id}/validation-report").json()
    assert after == before


def test_openapi_schema_exposes_all_three_endpoints(client: TestClient) -> None:
    """Sartnamedeki uc uc da OpenAPI semasinda bulunmali."""
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]

    assert f"{API_PREFIX}/run" in paths
    assert "post" in paths[f"{API_PREFIX}/run"]
    assert f"{API_PREFIX}/compare" in paths
    assert "post" in paths[f"{API_PREFIX}/compare"]

    report_path = f"{API_PREFIX}/{{simulation_id}}/validation-report"
    assert report_path in paths
    assert "get" in paths[report_path]


def test_report_api_summary(mm1_run: Dict[str, Any]) -> None:
    """API yanitini rapor olarak yazdirir (`pytest -s`)."""
    results = mm1_run["results"]
    lower, upper = results["confidence_interval_95"]
    lines = [
        "",
        "POST /api/simulations/run — M/M/1 (lambda=0.8, mu=1.0)",
        "-" * 68,
        f"  simulation_id            : {mm1_run['simulation_id']}",
        f"  status                   : {mm1_run['status']}",
        f"  total_throughput         : {results['total_throughput']:,}",
        f"  confidence_interval_95   : [{lower:,.1f}, {upper:,.1f}]",
        f"  bottleneck_station_id    : {results['bottleneck_station_id']}",
        f"  is_stable                : {results['is_stable']}",
        f"  avg_wip (L)              : {results['avg_wip']:.4f}   (analitik 4.0)",
        f"  avg_flow_time (W)        : {results['avg_flow_time']:.4f}   (analitik 5.0)",
        f"  line_oee                 : {results['line_oee']:.4f}",
        "-" * 68,
        "  station_metrics:",
    ]
    for station in results["station_metrics"]:
        oee = station["oee"]
        lines.append(
            f"    {station['station_id']:<6} rho={station['utilization']:.4f} "
            f"Lq={station['avg_queue_length']:.4f} Wq={station['avg_wait_time']:.4f} "
            f"| A={oee['availability']:.3f} P={oee['performance']:.3f} "
            f"Q={oee['quality']:.3f} OEE={oee['oee']:.3f}"
        )
    validation = results["littles_law_validation"]
    lines.append("-" * 68)
    lines.append(
        f"  littles_law_validation   : passed={validation['passed']}, "
        f"sapma=%{validation['deviation_pct']:.4f} "
        f"({validation['replications_passed']}/"
        f"{validation['replications_checked']} replikasyon)"
    )
    lines.append(f"  headline                 : {mm1_run['headline']}")
    print("\n".join(lines))
