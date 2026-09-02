"""Envanter kalemlerinin şeması, deposu ve CRUD uçları.

Envanter kalemleri, simülasyon sonuçlarından farklı olarak **kullanıcının elle
girdiği kalıcı veridir**. Bir koşumun geçici çıktısı kaybolursa kullanıcı
koşumu tekrarlar; girdiği yirmi kalem kaybolursa hepsini yeniden yazması
gerekir. Bu yüzden depo davranışı (çakışma, güncelleme, silme) burada ayrıca
sınanır.

Dosyanın ikinci görevi bağımsızlığı kanıtlamaktır: envanter modülü eklendikten
sonra da üretim simülasyonu hiç kalem olmadan çalışmaya devam etmelidir.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from simulation_engine.api.inventory_routes import get_inventory_store
from simulation_engine.api.inventory_storage import (
    DatabaseInventoryStore,
    InMemoryInventoryStore,
    InventoryItemExists,
    InventoryItemNotFound,
)
from simulation_engine.api.simulation_service import app
from simulation_engine.models.schemas import InventoryItem


def sample(**overrides) -> dict:
    """Tekstil hattinin ham kumas kalemi."""
    payload = {
        "id": "ham-kumas",
        "name": "Ham Kumaş",
        "unit": "metre",
        "current_stock": 500.0,
        "unit_cost": 25.0,
        "lead_time_days": 7.0,
        "daily_demand_avg": 40.0,
        "daily_demand_std": 8.0,
        "ordering_cost": 150.0,
        "holding_cost_rate": 0.2,
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def store() -> InMemoryInventoryStore:
    """Her test icin temiz bir bellek deposu."""
    fresh = InMemoryInventoryStore()
    app.dependency_overrides[get_inventory_store] = lambda: fresh
    yield fresh
    app.dependency_overrides.pop(get_inventory_store, None)


@pytest.fixture
def client(store: InMemoryInventoryStore) -> TestClient:
    return TestClient(app)


# --------------------------------------------------------------------------- #
# 1. Şema doğrulaması
# --------------------------------------------------------------------------- #


def test_valid_item_is_accepted() -> None:
    item = InventoryItem.model_validate(sample())
    assert item.name == "Ham Kumaş"
    assert item.linked_station_id is None


def test_station_link_is_optional() -> None:
    """Bagimsiz calisabilme: istasyona baglanmayan kalem de gecerlidir."""
    assert InventoryItem.model_validate(sample()).linked_station_id is None
    linked = InventoryItem.model_validate(
        sample(linked_station_id="kesim", production_minutes_per_day=480.0)
    )
    assert linked.linked_station_id == "kesim"
    assert linked.production_minutes_per_day == 480.0


def test_link_requires_daily_production_minutes() -> None:
    """Baglanti ile gunluk uretim suresi yalnizca birlikte anlamlidir.

    Motorun ariza modelinde uygulanan "ya ikisi de ya hicbiri" kuralinin
    aynisi: eksik biri, digerini sessizce ise yaramaz kilar.
    """
    with pytest.raises(ValidationError):
        InventoryItem.model_validate(sample(linked_station_id="kesim"))
    with pytest.raises(ValidationError):
        InventoryItem.model_validate(sample(production_minutes_per_day=480.0))


@pytest.mark.parametrize("minutes", [0.0, -60.0])
def test_non_positive_production_minutes_rejected(minutes: float) -> None:
    with pytest.raises(ValidationError):
        InventoryItem.model_validate(
            sample(linked_station_id="kesim", production_minutes_per_day=minutes)
        )


def test_demand_std_defaults_to_zero() -> None:
    """Dalgalanma bilinmiyorsa sifir kabul edilir; guvenlik stoku da sifir olur."""
    payload = sample()
    del payload["daily_demand_std"]
    assert InventoryItem.model_validate(payload).daily_demand_std == 0.0


@pytest.mark.parametrize(
    "field,value",
    [
        ("unit_cost", 0.0),
        ("unit_cost", -1.0),
        ("ordering_cost", 0.0),
        ("holding_cost_rate", 0.0),
        ("current_stock", -1.0),
        ("lead_time_days", -1.0),
        ("daily_demand_avg", -1.0),
        ("daily_demand_std", -1.0),
    ],
)
def test_invalid_numbers_are_rejected(field: str, value: float) -> None:
    """Sifir ya da negatif maliyet, EOQ'yu tanimsiz kilar."""
    with pytest.raises(ValidationError):
        InventoryItem.model_validate(sample(**{field: value}))


def test_percentage_entered_as_whole_number_is_caught() -> None:
    """`holding_cost_rate` bir orandir; %20 icin 20 yazmak yaygin bir hatadir.

    Yakalanmasaydi EOQ yuz kat kucuk cikar ve kullanici bunu fark etmezdi.
    """
    with pytest.raises(ValidationError, match="oran"):
        InventoryItem.model_validate(sample(holding_cost_rate=20.0))


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        InventoryItem.model_validate(sample(supplier="ACME"))


# --------------------------------------------------------------------------- #
# 2. Depo davranışı
# --------------------------------------------------------------------------- #


def test_memory_store_round_trip() -> None:
    memory = InMemoryInventoryStore()
    item = InventoryItem.model_validate(sample())
    memory.add(item)
    assert memory.get("ham-kumas").name == "Ham Kumaş"
    assert len(memory) == 1


def test_duplicate_id_is_rejected() -> None:
    """Sessizce uzerine yazmak, kullanicinin farkinda olmadan veri kaybetmesidir."""
    memory = InMemoryInventoryStore()
    memory.add(InventoryItem.model_validate(sample()))
    with pytest.raises(InventoryItemExists):
        memory.add(InventoryItem.model_validate(sample(name="Baska Kumas")))


def test_missing_item_raises() -> None:
    memory = InMemoryInventoryStore()
    with pytest.raises(InventoryItemNotFound):
        memory.get("yok")
    with pytest.raises(InventoryItemNotFound):
        memory.delete("yok")


def test_update_keeps_path_id() -> None:
    """Govdedeki kimlik yok sayilir; aksi halde guncelleme ikinci bir kayit yaratirdi."""
    memory = InMemoryInventoryStore()
    memory.add(InventoryItem.model_validate(sample()))
    memory.update("ham-kumas", InventoryItem.model_validate(sample(id="baska-kimlik")))

    assert len(memory) == 1
    assert memory.get("ham-kumas").id == "ham-kumas"


def test_listing_is_sorted_by_name() -> None:
    memory = InMemoryInventoryStore()
    for item_id, name in [("c", "Vida"), ("a", "Ham Kumaş"), ("b", "iplik")]:
        memory.add(InventoryItem.model_validate(sample(id=item_id, name=name)))

    assert [item.name for item in memory.list()] == ["Ham Kumaş", "iplik", "Vida"]


def test_database_store_persists_across_instances(tmp_path) -> None:
    """Sunucu yeniden baslasa da kalemler durmali.

    Envanter kalemleri kullanicinin elle girdigi veridir; kaybolmasi bir kosum
    sonucunun kaybolmasindan cok daha maliyetlidir.
    """
    url = f"sqlite:///{tmp_path / 'envanter.db'}"

    first = DatabaseInventoryStore(url)
    try:
        first.add(InventoryItem.model_validate(sample()))
        first.update("ham-kumas", InventoryItem.model_validate(sample(current_stock=42.0)))
    finally:
        first.dispose()

    second = DatabaseInventoryStore(url)
    try:
        restored = second.get("ham-kumas")
        assert restored.current_stock == 42.0
        assert restored.name == "Ham Kumaş"
    finally:
        second.dispose()


def test_database_store_rejects_duplicates(tmp_path) -> None:
    url = f"sqlite:///{tmp_path / 'envanter.db'}"
    store = DatabaseInventoryStore(url)
    try:
        store.add(InventoryItem.model_validate(sample()))
        with pytest.raises(InventoryItemExists):
            store.add(InventoryItem.model_validate(sample()))
    finally:
        store.dispose()


# --------------------------------------------------------------------------- #
# 3. CRUD uçları
# --------------------------------------------------------------------------- #


def test_create_and_list(client: TestClient) -> None:
    created = client.post("/api/inventory/items", json=sample())
    assert created.status_code == 201, created.text
    assert created.json()["name"] == "Ham Kumaş"

    listed = client.get("/api/inventory/items")
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == ["ham-kumas"]


def test_empty_listing_is_not_an_error(client: TestClient) -> None:
    """Hic kalem yokken liste bos donmeli; bu bir hata durumu degildir."""
    response = client.get("/api/inventory/items")
    assert response.status_code == 200
    assert response.json() == []


def test_duplicate_create_returns_conflict(client: TestClient) -> None:
    client.post("/api/inventory/items", json=sample())
    again = client.post("/api/inventory/items", json=sample())
    assert again.status_code == 409
    assert "zaten var" in again.json()["detail"]


def test_read_update_delete(client: TestClient) -> None:
    client.post("/api/inventory/items", json=sample())

    read = client.get("/api/inventory/items/ham-kumas")
    assert read.status_code == 200
    assert read.json()["current_stock"] == 500.0

    updated = client.put(
        "/api/inventory/items/ham-kumas", json=sample(current_stock=120.0)
    )
    assert updated.status_code == 200
    assert updated.json()["current_stock"] == 120.0

    removed = client.delete("/api/inventory/items/ham-kumas")
    assert removed.status_code == 204
    assert client.get("/api/inventory/items/ham-kumas").status_code == 404


def test_operations_on_missing_item_return_404(client: TestClient) -> None:
    assert client.get("/api/inventory/items/yok").status_code == 404
    assert client.put("/api/inventory/items/yok", json=sample()).status_code == 404
    assert client.delete("/api/inventory/items/yok").status_code == 404


def test_invalid_payload_returns_422(client: TestClient) -> None:
    response = client.post("/api/inventory/items", json=sample(unit_cost=0.0))
    assert response.status_code == 422


# --------------------------------------------------------------------------- #
# 4. Bağımsızlık (kabul kriteri 5)
# --------------------------------------------------------------------------- #


def test_simulation_still_runs_without_any_inventory(client: TestClient) -> None:
    """Hic envanter kalemi yokken uretim simulasyonu aynen calismali.

    Envanter istege bagli bir katmandir; onu eklemek mevcut akisin on kosulu
    haline gelmemelidir.
    """
    assert client.get("/api/inventory/items").json() == []

    config = {
        "stations": [
            {
                "id": "kesim",
                "name": "Kesim",
                "service_time_distribution": {"type": "constant", "params": {"value": 1.0}},
            }
        ],
        "connections": [],
        "arrival_process": {
            "distribution": {"type": "exponential", "params": {"mean": 2.0}},
            "entry_station_id": "kesim",
        },
        "simulation_duration_minutes": 2000,
        "warmup_period_minutes": 200,
        "num_replications": 3,
        "random_seed": 11,
    }
    response = client.post("/api/simulations/run", json=config)
    assert response.status_code == 200, response.text
    assert response.json()["results"]["total_throughput"] > 0
