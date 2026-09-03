"""Fabrika modelinin şeması, deposu ve CRUD uçları.

Fabrika modeli, envanter kalemlerinden de simülasyon sonuçlarından da daha
maliyetli bir veridir: kullanıcı yirmi istasyonluk bir hattı kurup kutuları tek
tek yerleştirdiğinde saatlerce çalışmış olur. Bu veri bugüne kadar yalnızca
tarayıcının belleğinde yaşıyordu ve sayfa yenilendiğinde kayboluyordu.

Bu dosya kalıcılığın temel davranışlarını sınar. Sürümleme kuralları
`test_factory_versioning`, veritabanı kalıcılığı ve koşum bağlantısı
`test_factory_persistence` içindedir.

Doğrulamanın tekrarlanmadığının kanıtı da buradadır: geçersiz modeller
`SimulationConfig`'in **mevcut** doğrulayıcıları tarafından reddedilir ve uç
422 döndürür. Fabrika katmanında ikinci bir kural kümesi yazılsaydı, iki kural
kümesi zamanla sessizce ayrışır ve editörde geçerli görünen bir model kayıtta
reddedilirdi.
"""

from __future__ import annotations

from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from simulation_engine.api.dependencies import get_factory_store
from simulation_engine.api.factory_storage import (
    FactoryHasNoVersion,
    FactoryNotFound,
    FactoryVersionNotFound,
    InMemoryFactoryStore,
)
from simulation_engine.api.simulation_service import app
from simulation_engine.models.schemas import (
    Factory,
    FactoryCreateRequest,
    FactoryLayout,
    FactorySaveRequest,
)

FACTORIES = "/api/factories"


def config(**overrides: Any) -> Dict[str, Any]:
    """İki istasyonlu küçük bir hat: kesim → montaj."""
    payload: Dict[str, Any] = {
        "stations": [
            {
                "id": "kesim",
                "name": "Kesim",
                "num_servers": 1,
                "service_time_distribution": {
                    "type": "exponential",
                    "params": {"mean": 2.0},
                },
                "buffer_capacity_before": -1,
            },
            {
                "id": "montaj",
                "name": "Montaj",
                "line_name": "Ana Hat",
                "num_servers": 2,
                "service_time_distribution": {
                    "type": "normal",
                    "params": {"mean": 3.0, "std": 0.5},
                },
                "failure_rate": 0.002,
                "repair_time_distribution": {
                    "type": "exponential",
                    "params": {"mean": 15.0},
                },
                "buffer_capacity_before": 10,
                "scrap_rate": 0.02,
            },
        ],
        "connections": [
            {
                "from_station_id": "kesim",
                "to_station_id": "montaj",
                "routing_probability": 1.0,
            }
        ],
        "arrival_process": {
            "distribution": {"type": "exponential", "params": {"mean": 4.0}},
            "entry_station_id": "kesim",
        },
        "simulation_duration_minutes": 1000.0,
        "warmup_period_minutes": 100.0,
        "num_replications": 3,
        "random_seed": 42,
    }
    payload.update(overrides)
    return payload


def layout() -> Dict[str, Any]:
    return {
        "stations": {"kesim": {"x": 0.0, "y": 100.0}, "montaj": {"x": 320.0, "y": 100.0}},
        "arrival": {"x": -260.0, "y": 100.0},
    }


@pytest.fixture
def store() -> InMemoryFactoryStore:
    """Her test icin temiz bir bellek deposu."""
    fresh = InMemoryFactoryStore()
    app.dependency_overrides[get_factory_store] = lambda: fresh
    yield fresh
    app.dependency_overrides.pop(get_factory_store, None)


@pytest.fixture
def client(store: InMemoryFactoryStore) -> TestClient:
    return TestClient(app)


# --------------------------------------------------------------------------- #
# 1. Oluşturma
# --------------------------------------------------------------------------- #


def test_create_without_model_leaves_factory_versionless(client: TestClient) -> None:
    """Model verilmeden fabrika kurulabilir.

    Kullanıcı önce fabrikayı adlandırıp sonra modeli kurar; ilk kaydetmeye
    kadar sürüm oluşmaz.
    """
    response = client.post(FACTORIES, json={"name": "Boş Fabrika"})
    assert response.status_code == 201

    body = response.json()
    assert body["factory"]["name"] == "Boş Fabrika"
    assert body["factory"]["current_version_id"] is None
    assert body["factory"]["version_count"] == 0
    assert body["current_version"] is None


def test_create_with_model_writes_first_version(client: TestClient) -> None:
    response = client.post(
        FACTORIES,
        json={
            "name": "Gıda Hattı",
            "sector": "gida",
            "config": config(),
            "layout": layout(),
            "note": "sablondan kuruldu",
        },
    )
    assert response.status_code == 201

    body = response.json()
    version = body["current_version"]
    assert version["version_number"] == 1
    assert version["note"] == "sablondan kuruldu"
    assert len(version["snapshot_hash"]) == 64
    assert body["factory"]["current_version_id"] == version["id"]
    assert body["factory"]["version_count"] == 1
    assert body["factory"]["sector"] == "gida"


def test_identifier_is_generated_by_the_server(client: TestClient) -> None:
    """Istemci kimlik secemez.

    Kimlik gövdeden alınsaydı, iki sekmede aynı anda kurulan iki fabrika aynı
    kimliği seçip birbirinin üzerine yazabilirdi.
    """
    response = client.post(FACTORIES, json={"name": "A", "id": "elle-secilmis"})
    assert response.status_code == 422

    created = client.post(FACTORIES, json={"name": "A"}).json()
    assert created["factory"]["id"] != "elle-secilmis"
    assert len(created["factory"]["id"]) > 0


def test_org_id_is_reserved_but_unused(client: TestClient) -> None:
    """`org_id` Faz 1'de her zaman bostur.

    Sütun çok kiracılı desteğe hazırlık olarak açıldı; şimdi doldurulmaya
    çalışılması sessizce kabul edilmemelidir.
    """
    body = client.post(FACTORIES, json={"name": "A"}).json()
    assert body["factory"]["org_id"] is None

    rejected = client.post(FACTORIES, json={"name": "B", "org_id": "kiraci-1"})
    assert rejected.status_code == 422


# --------------------------------------------------------------------------- #
# 2. Okuma ve listeleme
# --------------------------------------------------------------------------- #


def test_read_returns_factory_with_current_model(client: TestClient) -> None:
    created = client.post(
        FACTORIES, json={"name": "Hat", "config": config(), "layout": layout()}
    ).json()
    factory_id = created["factory"]["id"]

    response = client.get(f"{FACTORIES}/{factory_id}")
    assert response.status_code == 200

    body = response.json()
    assert body["factory"]["id"] == factory_id
    assert len(body["current_version"]["config"]["stations"]) == 2
    assert body["current_version"]["layout"]["stations"]["kesim"]["x"] == 0.0


def test_list_orders_by_most_recently_updated(client: TestClient) -> None:
    """Kullanici neredeyse her zaman en son calistigi fabrikayi acmak ister."""
    first = client.post(FACTORIES, json={"name": "Eski"}).json()["factory"]["id"]
    client.post(FACTORIES, json={"name": "Yeni"})
    client.put(f"{FACTORIES}/{first}", json={"name": "Eski (guncellendi)"})

    names = [item["name"] for item in client.get(FACTORIES).json()]
    assert names[0] == "Eski (guncellendi)"


def test_list_omits_the_model(client: TestClient) -> None:
    """Liste yaniti `SimulationConfig` tasimaz.

    On fabrikalı bir hesapta her satır için tam modeli göndermek liste ekranını
    gereksiz yere ağırlaştırırdı.
    """
    client.post(FACTORIES, json={"name": "Hat", "config": config()})
    row = client.get(FACTORIES).json()[0]
    assert "config" not in row
    assert row["version_count"] == 1


def test_missing_factory_returns_404(client: TestClient) -> None:
    assert client.get(f"{FACTORIES}/yok").status_code == 404
    assert client.put(f"{FACTORIES}/yok", json={"name": "A"}).status_code == 404
    assert client.delete(f"{FACTORIES}/yok").status_code == 404
    assert client.get(f"{FACTORIES}/yok/versions").status_code == 404


# --------------------------------------------------------------------------- #
# 3. Güncelleme
# --------------------------------------------------------------------------- #


def test_rename_keeps_the_model(client: TestClient) -> None:
    created = client.post(
        FACTORIES, json={"name": "Ilk Ad", "config": config()}
    ).json()
    factory_id = created["factory"]["id"]
    version_id = created["current_version"]["id"]

    response = client.put(f"{FACTORIES}/{factory_id}", json={"name": "Yeni Ad"})
    assert response.status_code == 200

    body = response.json()
    assert body["factory"]["name"] == "Yeni Ad"
    assert body["current_version"]["id"] == version_id
    assert body["factory"]["version_count"] == 1


def test_empty_save_is_rejected(client: TestClient) -> None:
    """Bos bir kaydetme istegi hatadir, sessiz bir basari degil."""
    created = client.post(FACTORIES, json={"name": "Hat"}).json()
    response = client.put(f"{FACTORIES}/{created['factory']['id']}", json={})
    assert response.status_code == 422


def test_layout_without_config_is_rejected(client: TestClient) -> None:
    """Yerlesim modelin bir parcasidir; tek basina surumlenmez.

    Yalnızca yerleşim gönderilebilseydi, sürüm "config + layout" bütününün
    anlık görüntüsü olmaktan çıkar ve "sürüm 3'ü aç" belirsiz bir istek hâline
    gelirdi.
    """
    created = client.post(FACTORIES, json={"name": "Hat", "config": config()}).json()
    response = client.put(
        f"{FACTORIES}/{created['factory']['id']}", json={"layout": layout()}
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------- #
# 4. Silme
# --------------------------------------------------------------------------- #


def test_delete_removes_factory_and_its_versions(
    client: TestClient, store: InMemoryFactoryStore
) -> None:
    created = client.post(
        FACTORIES, json={"name": "Hat", "config": config()}
    ).json()
    factory_id = created["factory"]["id"]
    version_id = created["current_version"]["id"]

    assert client.delete(f"{FACTORIES}/{factory_id}").status_code == 204
    assert client.get(f"{FACTORIES}/{factory_id}").status_code == 404
    assert store._read_version(version_id) is None
    assert len(store) == 0


# --------------------------------------------------------------------------- #
# 5. Doğrulama — mevcut kurallar yeniden kullanılır
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("label", "broken"),
    [
        (
            "yinelenen istasyon kimligi",
            config(
                stations=[
                    {
                        "id": "ayni",
                        "name": "A",
                        "service_time_distribution": {
                            "type": "constant",
                            "params": {"value": 1.0},
                        },
                    },
                    {
                        "id": "ayni",
                        "name": "B",
                        "service_time_distribution": {
                            "type": "constant",
                            "params": {"value": 1.0},
                        },
                    },
                ],
                connections=[],
                arrival_process={
                    "distribution": {"type": "exponential", "params": {"mean": 4.0}},
                    "entry_station_id": "ayni",
                },
            ),
        ),
        (
            "yonlendirme olasiliklari toplami 1'i asiyor",
            config(
                connections=[
                    {
                        "from_station_id": "kesim",
                        "to_station_id": "montaj",
                        "routing_probability": 0.8,
                    },
                    {
                        "from_station_id": "kesim",
                        "to_station_id": "montaj",
                        "routing_probability": 0.9,
                    },
                ]
            ),
        ),
        (
            "bilinmeyen baglanti hedefi",
            config(
                connections=[
                    {
                        "from_station_id": "kesim",
                        "to_station_id": "olmayan",
                        "routing_probability": 1.0,
                    }
                ]
            ),
        ),
        (
            "bilinmeyen giris istasyonu",
            config(
                arrival_process={
                    "distribution": {"type": "exponential", "params": {"mean": 4.0}},
                    "entry_station_id": "olmayan",
                }
            ),
        ),
        (
            "isinma penceresi toplam sureden uzun",
            config(simulation_duration_minutes=100.0, warmup_period_minutes=500.0),
        ),
        ("hic istasyon yok", config(stations=[])),
    ],
)
def test_invalid_models_cannot_be_persisted(
    client: TestClient, store: InMemoryFactoryStore, label: str, broken: Dict[str, Any]
) -> None:
    """Gecersiz bir model depoya asla ulasmaz.

    Kurallar burada tekrar yazılmaz: hepsi `SimulationConfig`'in mevcut
    doğrulayıcılarından gelir ve FastAPI gövdeyi çözerken uygulanır.
    """
    response = client.post(FACTORIES, json={"name": label, "config": broken})
    assert response.status_code == 422, f"{label} kabul edildi"
    assert len(store) == 0


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("num_servers", 0),
        ("num_servers", -1),
        ("buffer_capacity_before", -2),
        ("scrap_rate", 1.5),
        ("scrap_rate", -0.1),
    ],
)
def test_invalid_station_fields_are_rejected(
    client: TestClient, field: str, value: Any
) -> None:
    """Makine sayisi, tampon ve fire orani sinirlarinin disina cikamaz."""
    broken = config()
    broken["stations"][1][field] = value
    response = client.post(FACTORIES, json={"name": "Bozuk", "config": broken})
    assert response.status_code == 422


def test_negative_processing_time_is_rejected(client: TestClient) -> None:
    broken = config()
    broken["stations"][0]["service_time_distribution"] = {
        "type": "constant",
        "params": {"value": -5.0},
    }
    response = client.post(FACTORIES, json={"name": "Bozuk", "config": broken})
    assert response.status_code == 422


def test_incomplete_failure_model_is_rejected(client: TestClient) -> None:
    """MTBF olmadan MTTR, MTTR olmadan MTBF anlamsizdir."""
    broken = config()
    del broken["stations"][1]["repair_time_distribution"]
    response = client.post(FACTORIES, json={"name": "Bozuk", "config": broken})
    assert response.status_code == 422


def test_unknown_field_is_rejected(client: TestClient) -> None:
    """`extra="forbid"` fabrika semalarinda da gecerlidir.

    Yazım hatası içeren bir alanın sessizce yok sayılması, kullanıcının
    kaydettiğini sandığı bir ayarın kaydedilmemesi demek olurdu.
    """
    response = client.post(
        FACTORIES, json={"name": "Hat", "config": config(), "bilinmeyen": 1}
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------- #
# 6. Depo katmanı — uç noktalardan bağımsız
# --------------------------------------------------------------------------- #


def test_store_raises_typed_errors() -> None:
    """Depo, HTTP katmanindan bagimsiz olarak tiplenmis hata yukseltir."""
    store = InMemoryFactoryStore()

    with pytest.raises(FactoryNotFound):
        store.get("yok")
    with pytest.raises(FactoryNotFound):
        store.delete("yok")
    with pytest.raises(FactoryNotFound):
        store.current_version("yok")

    detail = store.create(FactoryCreateRequest(name="Bos"))
    with pytest.raises(FactoryHasNoVersion):
        store.current_version(detail.factory.id)


def test_version_of_another_factory_is_not_readable() -> None:
    """Baska bir fabrikanin surumu 'bulunamadi' sayilir.

    Aksi hâlde kimlik denemeleriyle başka bir fabrikanın modeli okunabilirdi.
    Faz 1'de kimlik doğrulama yok; bu sınır yine de şimdiden korunur, çünkü
    çok kiracılı desteğe geçildiğinde burası hazır olmalıdır.
    """
    store = InMemoryFactoryStore()
    from simulation_engine.models.schemas import SimulationConfig

    model = SimulationConfig.model_validate(config())
    first = store.create(FactoryCreateRequest(name="A", config=model))
    second = store.create(FactoryCreateRequest(name="B", config=model))

    assert first.current_version is not None
    with pytest.raises(FactoryVersionNotFound):
        store.get_version(second.factory.id, first.current_version.id)


def test_layout_tolerates_unknown_and_missing_stations() -> None:
    """Yerlesim katı biçimde dogrulanmaz.

    Kullanıcı bir istasyonu sildiğinde yerleşimde eski kimlik kalabilir. Bunu
    hata saymak, sunuma ait bir ayrıntının modeli kaydedilemez hâle getirmesi
    demek olurdu.
    """
    stale = FactoryLayout.model_validate(
        {"stations": {"silinmis": {"x": 1.0, "y": 2.0}}}
    )
    assert "silinmis" in stale.stations
    assert stale.arrival is None

    empty = FactoryLayout()
    assert empty.stations == {}


def test_save_request_requires_a_payload() -> None:
    with pytest.raises(ValidationError):
        FactorySaveRequest()


def test_factory_model_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        Factory.model_validate(
            {
                "id": "a",
                "name": "b",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
                "bilinmeyen": 1,
            }
        )
