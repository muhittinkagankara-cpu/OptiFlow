"""Envanter modülünün üretim motoruyla bağlantısı.

Bu, iki modülü birbirine bağlayan tek yerdir ve şartnamenin en riskli parçası.
Bağ **tek yönlüdür**: envanter katmanı motorun kaydedilmiş çıktısını okur,
motora hiçbir şey yazmaz ve onu yeniden çalıştırmaz.

Dosyanın en önemli testi bunu doğrudan kanıtlar: motor çekirdeğinde envanterden
söz eden tek bir satır bulunmamalıdır. Sonuç karşılaştırması bir sızıntıyı
ancak sonucu değiştirdiğinde yakalar; kaynak taraması ise henüz zararsız olan
bir bağımlılığı da yakalar ve o bağımlılık ileride zararlı olur.

İkinci görev, bağlantının **kopabilir** olduğunu göstermektir. Kalem bir
istasyona bağlı değilse, koşum bulunamazsa ya da o koşumda istasyon yoksa
envanter analizi eksiksiz çalışmaya devam etmelidir.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from simulation_engine.analytics.inventory import (
    estimate_production_impact,
    simulate_stockout_risk,
)
from simulation_engine.api.dependencies import get_store
from simulation_engine.api.inventory_routes import get_inventory_store
from simulation_engine.api.inventory_storage import InMemoryInventoryStore
from simulation_engine.api.simulation_service import app
from simulation_engine.api.storage import SimulationStore
from simulation_engine.models.schemas import InventoryItem


def item_payload(**overrides) -> dict:
    payload = {
        "id": "ham-kumas",
        "name": "Ham Kumaş",
        "unit": "metre",
        "current_stock": 200.0,
        "unit_cost": 25.0,
        "lead_time_days": 7.0,
        "daily_demand_avg": 40.0,
        "daily_demand_std": 0.0,
        "ordering_cost": 150.0,
        "holding_cost_rate": 0.2,
        "linked_station_id": "kesim",
        # Bagliysa gunluk uretim suresi zorunludur; tek vardiya varsayilir.
        "production_minutes_per_day": 480.0,
    }
    payload.update(overrides)
    return payload


def line_config() -> dict:
    """Tek istasyonlu, cikti hizi kolayca ongorulebilen bir hat."""
    return {
        "stations": [
            {
                "id": "kesim",
                "name": "Kesim",
                "service_time_distribution": {
                    "type": "constant",
                    "params": {"value": 1.0},
                },
            }
        ],
        "connections": [],
        "arrival_process": {
            "distribution": {"type": "exponential", "params": {"mean": 2.0}},
            "entry_station_id": "kesim",
        },
        "simulation_duration_minutes": 5000,
        "warmup_period_minutes": 500,
        "num_replications": 3,
        "random_seed": 21,
    }


@pytest.fixture
def stores():
    """Her test icin temiz envanter ve simulasyon depolari."""
    inventory = InMemoryInventoryStore()
    simulations = SimulationStore()
    app.dependency_overrides[get_inventory_store] = lambda: inventory
    app.dependency_overrides[get_store] = lambda: simulations
    yield inventory, simulations
    app.dependency_overrides.clear()


@pytest.fixture
def client(stores) -> TestClient:
    return TestClient(app)


# --------------------------------------------------------------------------- #
# 1. Motora dokunulmadığının kanıtı (kabul kriteri 3)
# --------------------------------------------------------------------------- #


def test_engine_core_never_mentions_inventory() -> None:
    """Motor cekirdeginde envanterden soz eden tek satir olmamali.

    Bagimlilik tek yonlu olmali: envanter motoru okur, motor envanterden
    haberdar degildir. Ters yonde bir baglanti, envanter katmani degistiginde
    uretim sonuclarinin sessizce kaymasi anlamina gelirdi.
    """
    core = Path(__file__).resolve().parent.parent / "core"
    offenders = [
        path.name
        for path in core.glob("*.py")
        if "inventory" in path.read_text(encoding="utf-8").lower()
    ]
    assert offenders == [], f"Motor cekirdegi envanteri taniyor: {offenders}"


def test_analytics_engine_modules_do_not_import_inventory() -> None:
    """Mevcut analitik moduller de envantere bagimli olmamali."""
    analytics = Path(__file__).resolve().parent.parent / "analytics"
    offenders = [
        path.name
        for path in analytics.glob("*.py")
        if path.name != "inventory.py"
        and "inventory" in path.read_text(encoding="utf-8").lower()
    ]
    assert offenders == [], f"Analitik moduller envantere bagimli: {offenders}"


def test_simulation_results_unchanged_by_inventory_module(client: TestClient) -> None:
    """Envanter kalemi eklemek uretim sonuclarini degistirmemeli."""
    before = client.post("/api/simulations/run", json=line_config()).json()["results"]

    client.post("/api/inventory/items", json=item_payload())
    client.post("/api/inventory/stockout-risk/ham-kumas?random_seed=1")

    after = client.post("/api/simulations/run", json=line_config()).json()["results"]

    assert before["total_throughput"] == after["total_throughput"]
    assert before["line_oee"] == after["line_oee"]
    assert before["avg_flow_time"] == after["avg_flow_time"]


# --------------------------------------------------------------------------- #
# 2. Bağlantı kurulduğunda üretim etkisi
# --------------------------------------------------------------------------- #


def test_production_impact_is_reported_when_linked(client: TestClient) -> None:
    """Kalem bir istasyona bagli ve kosum verilmisse kayip uretim hesaplanmali."""
    run = client.post("/api/simulations/run", json=line_config()).json()
    simulation_id = run["simulation_id"]
    client.post("/api/inventory/items", json=item_payload())

    response = client.post(
        f"/api/inventory/stockout-risk/ham-kumas"
        f"?random_seed=5&simulation_id={simulation_id}"
    )
    assert response.status_code == 200, response.text
    report = response.json()

    impact = report["production_impact"]
    assert impact is not None
    assert impact["station_id"] == "kesim"
    assert impact["station_name"] == "Kesim"
    assert impact["simulation_id"] == simulation_id
    assert impact["units_per_day"] > 0.0
    assert impact["expected_lost_units"] > 0.0
    assert "Kesim" in impact["message"]


def test_lost_units_equal_downtime_times_daily_rate(client: TestClient) -> None:
    """Kayip uretim = beklenen durus gunu x gunluk uretim hizi.

    Iliskinin dogrudan sinanmasi; carpanlardan biri yanlis olculse bile
    sonuc "makul" gorunebilir ve gozle fark edilmezdi.
    """
    run = client.post("/api/simulations/run", json=line_config()).json()
    client.post("/api/inventory/items", json=item_payload())

    report = client.post(
        f"/api/inventory/stockout-risk/ham-kumas"
        f"?random_seed=6&simulation_id={run['simulation_id']}"
    ).json()

    impact = report["production_impact"]
    expected = report["expected_stockout_days"]["mean"] * impact["units_per_day"]
    assert impact["expected_lost_units"] == pytest.approx(expected, rel=1e-9)


def test_shift_length_scales_the_loss(client: TestClient) -> None:
    """Gunde 8 saat calisan fabrika, 24 saatlikin ucte biri kadar uretim kaybeder.

    Gunluk uretim suresi kalemin kendi alanidir, cagrinin parametresi degil:
    bu bilgi bir kosuma degil, kalem ile istasyon arasindaki baglantiya aittir.
    """
    run = client.post("/api/simulations/run", json=line_config()).json()
    query = f"?random_seed=7&simulation_id={run['simulation_id']}"

    client.post("/api/inventory/items", json=item_payload(production_minutes_per_day=1440.0))
    full_day = client.post(f"/api/inventory/stockout-risk/ham-kumas{query}").json()

    client.put(
        "/api/inventory/items/ham-kumas",
        json=item_payload(production_minutes_per_day=480.0),
    )
    one_shift = client.post(f"/api/inventory/stockout-risk/ham-kumas{query}").json()

    assert one_shift["production_impact"]["expected_lost_units"] == pytest.approx(
        full_day["production_impact"]["expected_lost_units"] / 3.0, rel=1e-9
    )
    assert "8 saat" in one_shift["production_impact"]["message"]
    assert "24 saat" in full_day["production_impact"]["message"]


def test_link_without_daily_minutes_is_rejected(client: TestClient) -> None:
    """Istasyona baglanan kalem gunluk uretim suresini de vermek zorundadir.

    Varsayilan bir sure kabul edilseydi, tek vardiyali bir fabrikanin uretim
    kaybi uc kat buyuk gosterilir ve kullanici bunu fark etmezdi. Uydurulmus
    bir sayiyla hesaplanan uyari, hic uyari vermemekten kotudur.
    """
    response = client.post(
        "/api/inventory/items",
        json=item_payload(production_minutes_per_day=None),
    )
    assert response.status_code == 422


def test_daily_minutes_without_link_is_rejected(client: TestClient) -> None:
    """Baglanti olmadan gunluk sure olu veridir."""
    response = client.post(
        "/api/inventory/items",
        json=item_payload(linked_station_id=None, production_minutes_per_day=480.0),
    )
    assert response.status_code == 422


def test_impact_confidence_interval_brackets_the_estimate(client: TestClient) -> None:
    """Kaybin belirsizligi, durus suresinin belirsizliginden gelir."""
    run = client.post("/api/simulations/run", json=line_config()).json()
    client.post("/api/inventory/items", json=item_payload(daily_demand_std=10.0))

    report = client.post(
        f"/api/inventory/stockout-risk/ham-kumas"
        f"?random_seed=8&simulation_id={run['simulation_id']}"
    ).json()

    impact = report["production_impact"]
    lower, upper = impact["lost_units_ci"]
    assert lower <= impact["expected_lost_units"] <= upper
    assert lower >= 0.0


# --------------------------------------------------------------------------- #
# 3. Bağlantı kopuk olduğunda modül yine çalışır (kabul kriteri 5)
# --------------------------------------------------------------------------- #


def test_unlinked_item_has_no_production_impact(client: TestClient) -> None:
    """Istasyona bagli olmayan kalem icin etki hesaplanmaz; bu bir hata degildir."""
    run = client.post("/api/simulations/run", json=line_config()).json()
    client.post(
        "/api/inventory/items",
        json=item_payload(linked_station_id=None, production_minutes_per_day=None),
    )

    report = client.post(
        f"/api/inventory/stockout-risk/ham-kumas"
        f"?random_seed=9&simulation_id={run['simulation_id']}"
    ).json()

    assert report["production_impact"] is None
    assert report["stockout_probability"] > 0.0


def test_missing_simulation_does_not_break_the_report(client: TestClient) -> None:
    """Kosum silinmis ya da sunucu yeniden baslamis olabilir.

    Risk raporu kendi basina eksiksizdir; uretim etkisi olmadan donmeli.
    Envanter analizinin uretim tarafina bagimli hale gelmesi, modulun
    bagimsizligini bozardi.
    """
    client.post("/api/inventory/items", json=item_payload())

    response = client.post(
        "/api/inventory/stockout-risk/ham-kumas?random_seed=10&simulation_id=olmayan"
    )
    assert response.status_code == 200
    assert response.json()["production_impact"] is None


def test_station_absent_from_run_yields_no_impact(client: TestClient) -> None:
    """Kalem baska bir istasyona bagliysa etki hesaplanamaz."""
    run = client.post("/api/simulations/run", json=line_config()).json()
    client.post("/api/inventory/items", json=item_payload(linked_station_id="montaj"))

    report = client.post(
        f"/api/inventory/stockout-risk/ham-kumas"
        f"?random_seed=11&simulation_id={run['simulation_id']}"
    ).json()

    assert report["production_impact"] is None


def test_risk_without_simulation_id_is_complete(client: TestClient) -> None:
    """Hic kosum calistirilmadan da tukenme riski hesaplanabilmeli."""
    client.post("/api/inventory/items", json=item_payload())

    report = client.post("/api/inventory/stockout-risk/ham-kumas?random_seed=12").json()

    assert report["production_impact"] is None
    assert len(report["projection"]) == 31
    assert report["headline"]


def test_impact_helper_returns_none_without_link() -> None:
    """Yardimci fonksiyon dogrudan cagrildiginda da bagsizligi tolere etmeli."""
    unlinked = InventoryItem.model_validate(
        item_payload(linked_station_id=None, production_minutes_per_day=None)
    )
    risk = simulate_stockout_risk(unlinked, horizon_days=10, num_replications=5, master_seed=1)

    assert estimate_production_impact(unlinked, risk, [], "kosum-yok") is None


# --------------------------------------------------------------------------- #
# 4. Analiz ucu
# --------------------------------------------------------------------------- #


def test_analyze_endpoint_returns_eoq_and_reorder_point(client: TestClient) -> None:
    client.post("/api/inventory/items", json=item_payload())

    response = client.post("/api/inventory/analyze/ham-kumas")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["economic_order_quantity"] > 0.0
    assert body["reorder_point"] == pytest.approx(40.0 * 7.0)
    assert body["service_level"] == 0.95
    assert body["status"] == "critical"  # 200 metre stok, ROP 280


def test_analyze_respects_service_level(client: TestClient) -> None:
    """Hizmet seviyesi arttikca guvenlik stoku buyumeli."""
    client.post("/api/inventory/items", json=item_payload(daily_demand_std=10.0))

    low = client.post("/api/inventory/analyze/ham-kumas?service_level=0.90").json()
    high = client.post("/api/inventory/analyze/ham-kumas?service_level=0.99").json()

    assert high["safety_stock"] > low["safety_stock"]
    assert high["reorder_point"] > low["reorder_point"]


def test_analyze_rejects_percentage_service_level(client: TestClient) -> None:
    """95 ile 0.95 karistirilirsa istek reddedilmeli."""
    client.post("/api/inventory/items", json=item_payload())
    assert client.post("/api/inventory/analyze/ham-kumas?service_level=95").status_code == 422


def test_analysis_endpoints_404_for_unknown_item(client: TestClient) -> None:
    assert client.post("/api/inventory/analyze/yok").status_code == 404
    assert client.post("/api/inventory/stockout-risk/yok").status_code == 404
