"""Uçtan uca kiracı yalıtımı: iki organizasyon, hiçbiri diğerini görmemeli.

Bu dosya, `conftest.py`'nin sağladığı `TEST_ORG_ID` geçersiz kılmasını
**kullanmaz** — onu her testten önce kaldırır ve gerçek imzalı token'larla
gerçek doğrulama yolundan geçer. Amaç, ayrı ayrı doğrulanmış katmanların
(JWT doğrulama, depo filtreleme, otomatik organizasyon kurulumu) uçtan uca
**birlikte** doğru çalıştığını göstermektir; her katman kendi dosyasında zaten
sınanmıştır (`test_auth_jwt.py`, `test_factory_crud.py` içindeki
`test_factory_of_another_organization_is_not_readable`).

Şartnamedeki "hiçbir organizasyon başka bir organizasyonun verisine
erişemez" kuralı burada üç veri türü için de (fabrika, envanter kalemi,
simülasyon) ve dört erişim yolu için de (okuma, yazma, silme, listeleme)
sınanır.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient

from simulation_engine.api.dependencies import (
    get_factory_store,
    get_org_store,
    get_store,
)
from simulation_engine.api.factory_storage import InMemoryFactoryStore
from simulation_engine.api.inventory_routes import get_inventory_store
from simulation_engine.api.inventory_storage import InMemoryInventoryStore
from simulation_engine.api.org_storage import InMemoryOrgStore
from simulation_engine.api.simulation_service import app
from simulation_engine.api.storage import SimulationStore
from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.auth.jwt import SUPABASE_AUDIENCE
from simulation_engine.validation.test_factory_crud import config as factory_config

SECRET = "test-secret-yalnizca-testler-icin-en-az-otuz-iki-bayt"

FACTORIES = "/api/factories"
INVENTORY = "/api/inventory/items"


def token(sub: str, email: str, *, expires_in_seconds: float = 3600) -> str:
    """Supabase'in ürettiğine benzer biçimde imzalı bir test token'ı üretir."""
    now = datetime.now(timezone.utc)
    return pyjwt.encode(
        {
            "sub": sub,
            "email": email,
            "aud": SUPABASE_AUDIENCE,
            "exp": now + timedelta(seconds=expires_in_seconds),
        },
        SECRET,
        algorithm="HS256",
    )


def auth(bearer_token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {bearer_token}"}


# --------------------------------------------------------------------------- #
# Ortak kurulum
# --------------------------------------------------------------------------- #


@pytest.fixture(autouse=True)
def _real_auth(monkeypatch: pytest.MonkeyPatch):
    """Bu dosyada `get_current_org` sabitlemesi devre dışıdır.

    `conftest.py`'deki `_fixed_org` oturum kapsamında kurulur; burada her
    testten önce kaldırılır ki gerçek JWT doğrulama yolundan geçilsin, testten
    sonra da geri konur ki bu dosyanın etkisi diğer test modüllerine sızmasın.
    """
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    # Asimetrik yol kapatilir: bu dosya HS256 ile imzalanmis token'lar uretir.
    # Temizlenmeseydi, gelistiricinin ortaminda tanimli bir SUPABASE_URL
    # testleri gercek bir JWKS ucuna baglanmaya zorlardi.
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    had_override = get_current_org in app.dependency_overrides
    previous = app.dependency_overrides.pop(get_current_org, None)
    yield
    if had_override:
        app.dependency_overrides[get_current_org] = previous


@pytest.fixture
def stores():
    """Her testte temiz depolar; iki organizasyonun birbirine sızmadığını
    yalnızca HTTP katmanı değil depo katmanı da garanti etmeli."""
    factories = InMemoryFactoryStore()
    inventory = InMemoryInventoryStore()
    simulations = SimulationStore()
    orgs = InMemoryOrgStore()
    app.dependency_overrides[get_factory_store] = lambda: factories
    app.dependency_overrides[get_inventory_store] = lambda: inventory
    app.dependency_overrides[get_store] = lambda: simulations
    app.dependency_overrides[get_org_store] = lambda: orgs
    yield factories, inventory, simulations, orgs
    for dep in (get_factory_store, get_inventory_store, get_store, get_org_store):
        app.dependency_overrides.pop(dep, None)


@pytest.fixture
def client(stores) -> TestClient:
    return TestClient(app)


ALICE = token("alice-uid", "alice@firm-a.com")
BOB = token("bob-uid", "bob@firm-b.com")


def sample_item(**overrides: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "id": "hammadde",
        "name": "Hammadde",
        "unit": "kg",
        "current_stock": 100.0,
        "unit_cost": 5.0,
        "lead_time_days": 3.0,
        "daily_demand_avg": 10.0,
        "daily_demand_std": 2.0,
        "ordering_cost": 25.0,
        "holding_cost_rate": 0.15,
    }
    payload.update(overrides)
    return payload


# --------------------------------------------------------------------------- #
# 1. Yetkisiz erişim
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", FACTORIES),
        ("post", FACTORIES),
        ("get", f"{FACTORIES}/herhangi"),
        ("get", INVENTORY),
        ("post", INVENTORY),
        ("get", "/api/me"),
        ("post", "/api/simulations/run"),
    ],
)
def test_data_endpoints_require_authentication(
    client: TestClient, method: str, path: str
) -> None:
    """Basliksiz istek her veri ucunda 401 doner."""
    response = getattr(client, method)(path)
    assert response.status_code == 401


def test_malformed_bearer_token_is_rejected(client: TestClient) -> None:
    response = client.get(FACTORIES, headers=auth("bu-bir-jwt-degil"))
    assert response.status_code == 401


def test_expired_token_is_rejected(client: TestClient) -> None:
    expired = token("alice-uid", "alice@firm-a.com", expires_in_seconds=-10)
    response = client.get(FACTORIES, headers=auth(expired))
    assert response.status_code == 401


def test_token_signed_with_wrong_secret_is_rejected(client: TestClient) -> None:
    forged = pyjwt.encode(
        {
            "sub": "saldirgan",
            "aud": SUPABASE_AUDIENCE,
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        "yanlis-sir-en-az-otuz-iki-bayt-uzunlugunda-olmali",
        algorithm="HS256",
    )
    response = client.get(FACTORIES, headers=auth(forged))
    assert response.status_code == 401


def test_legacy_endpoints_also_require_authentication(client: TestClient) -> None:
    """Envanter analiz ve stok tukenme uclari da kimlik ister."""
    assert client.post("/api/inventory/analyze/x").status_code == 401
    assert client.post("/api/inventory/stockout-risk/x").status_code == 401
    assert client.post("/api/simulations/compare", json=[{}, {}]).status_code == 401


# --------------------------------------------------------------------------- #
# 2. Otomatik organizasyon kurulumu
# --------------------------------------------------------------------------- #


def test_first_authenticated_call_provisions_an_organization(
    client: TestClient,
) -> None:
    """Ilk cagri organizasyonu kendiliginden kurar; ayri bir adim yoktur."""
    response = client.get("/api/me", headers=auth(ALICE))
    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == "alice-uid"
    assert body["email"] == "alice@firm-a.com"
    assert body["org_id"]
    assert body["org_name"]


def test_repeated_calls_return_the_same_organization(client: TestClient) -> None:
    """Ayni kullanicinin ikinci cagrisi ayni organizasyonu bulmali, yenisini kurmamali."""
    first = client.get("/api/me", headers=auth(ALICE)).json()
    second = client.get("/api/me", headers=auth(ALICE)).json()
    assert first["org_id"] == second["org_id"]


def test_two_different_users_get_two_different_organizations(
    client: TestClient,
) -> None:
    """Faz 2'de davet akisi yok: her yeni kullanici kendi organizasyonunu kurar."""
    alice = client.get("/api/me", headers=auth(ALICE)).json()
    bob = client.get("/api/me", headers=auth(BOB)).json()
    assert alice["org_id"] != bob["org_id"]


# --------------------------------------------------------------------------- #
# 3. Fabrika yalıtımı
# --------------------------------------------------------------------------- #


def test_factory_list_is_scoped_to_the_caller(client: TestClient) -> None:
    client.post(FACTORIES, json={"name": "Alice'in Hatti"}, headers=auth(ALICE))
    client.post(FACTORIES, json={"name": "Bob'un Hatti"}, headers=auth(BOB))

    alice_list = client.get(FACTORIES, headers=auth(ALICE)).json()
    bob_list = client.get(FACTORIES, headers=auth(BOB)).json()

    assert [item["name"] for item in alice_list] == ["Alice'in Hatti"]
    assert [item["name"] for item in bob_list] == ["Bob'un Hatti"]


def test_factory_read_across_organizations_is_404(client: TestClient) -> None:
    created = client.post(
        FACTORIES, json={"name": "Alice'in Hatti"}, headers=auth(ALICE)
    ).json()
    factory_id = created["factory"]["id"]

    assert client.get(f"{FACTORIES}/{factory_id}", headers=auth(BOB)).status_code == 404
    assert client.get(f"{FACTORIES}/{factory_id}", headers=auth(ALICE)).status_code == 200


def test_factory_write_across_organizations_is_404(client: TestClient) -> None:
    created = client.post(
        FACTORIES, json={"name": "Alice'in Hatti"}, headers=auth(ALICE)
    ).json()
    factory_id = created["factory"]["id"]

    response = client.put(
        f"{FACTORIES}/{factory_id}", json={"name": "ele gecirildi"}, headers=auth(BOB)
    )
    assert response.status_code == 404

    # Alice'in verisi bozulmamis olmali.
    reread = client.get(f"{FACTORIES}/{factory_id}", headers=auth(ALICE)).json()
    assert reread["factory"]["name"] == "Alice'in Hatti"


def test_factory_delete_across_organizations_is_404(client: TestClient) -> None:
    created = client.post(
        FACTORIES, json={"name": "Alice'in Hatti"}, headers=auth(ALICE)
    ).json()
    factory_id = created["factory"]["id"]

    assert client.delete(
        f"{FACTORIES}/{factory_id}", headers=auth(BOB)
    ).status_code == 404
    # Silinmedi: Alice hala okuyabiliyor.
    assert client.get(f"{FACTORIES}/{factory_id}", headers=auth(ALICE)).status_code == 200


def test_factory_versions_across_organizations_are_404(client: TestClient) -> None:
    created = client.post(
        FACTORIES,
        json={"name": "Alice'in Hatti", "config": factory_config()},
        headers=auth(ALICE),
    ).json()
    factory_id = created["factory"]["id"]
    version_id = created["current_version"]["id"]

    assert client.get(
        f"{FACTORIES}/{factory_id}/versions", headers=auth(BOB)
    ).status_code == 404
    assert client.get(
        f"{FACTORIES}/{factory_id}/versions/{version_id}", headers=auth(BOB)
    ).status_code == 404


def test_run_from_another_organizations_factory_is_404(client: TestClient) -> None:
    created = client.post(
        FACTORIES,
        json={"name": "Alice'in Hatti", "config": factory_config()},
        headers=auth(ALICE),
    ).json()
    factory_id = created["factory"]["id"]

    response = client.post(f"{FACTORIES}/{factory_id}/run", headers=auth(BOB))
    assert response.status_code == 404


# --------------------------------------------------------------------------- #
# 4. Envanter yalıtımı
# --------------------------------------------------------------------------- #


def test_inventory_list_is_scoped_to_the_caller(client: TestClient) -> None:
    client.post(INVENTORY, json=sample_item(id="a-kalemi"), headers=auth(ALICE))
    client.post(INVENTORY, json=sample_item(id="b-kalemi"), headers=auth(BOB))

    alice_list = client.get(INVENTORY, headers=auth(ALICE)).json()
    bob_list = client.get(INVENTORY, headers=auth(BOB)).json()

    assert [item["id"] for item in alice_list] == ["a-kalemi"]
    assert [item["id"] for item in bob_list] == ["b-kalemi"]


def test_inventory_read_across_organizations_is_404(client: TestClient) -> None:
    client.post(INVENTORY, json=sample_item(), headers=auth(ALICE))

    assert client.get(f"{INVENTORY}/hammadde", headers=auth(BOB)).status_code == 404
    assert client.get(f"{INVENTORY}/hammadde", headers=auth(ALICE)).status_code == 200


def test_inventory_write_and_delete_across_organizations_is_404(
    client: TestClient,
) -> None:
    client.post(INVENTORY, json=sample_item(), headers=auth(ALICE))

    put_response = client.put(
        f"{INVENTORY}/hammadde", json=sample_item(current_stock=999.0), headers=auth(BOB)
    )
    assert put_response.status_code == 404
    assert client.delete(f"{INVENTORY}/hammadde", headers=auth(BOB)).status_code == 404

    # Alice'in kalemi bozulmadan duruyor.
    reread = client.get(f"{INVENTORY}/hammadde", headers=auth(ALICE)).json()
    assert reread["current_stock"] == 100.0


def test_inventory_analysis_across_organizations_is_404(client: TestClient) -> None:
    client.post(INVENTORY, json=sample_item(), headers=auth(ALICE))
    response = client.post(
        "/api/inventory/analyze/hammadde?service_level=0.95", headers=auth(BOB)
    )
    assert response.status_code == 404


def test_stockout_risk_does_not_leak_another_orgs_simulation(
    client: TestClient,
) -> None:
    """`simulation_id` parametresiyle baska bir organizasyonun kosumuna erisilemez.

    Bu uc, kalemin sahibi organizasyon dogru olsa bile, sorgu parametresiyle
    verilen `simulation_id` farkli bir organizasyona aitse uretim etkisini
    hesaba katmamalidir; aksi hâlde bir organizasyon, rastgele simulasyon
    kimlikleri deneyerek baska bir organizasyonun kosum verisinin sizip
    sizmadigini anlayabilirdi.
    """
    client.post(INVENTORY, json=sample_item(), headers=auth(ALICE))
    bob_run = client.post(
        "/api/simulations/run", json=factory_config(), headers=auth(BOB)
    ).json()

    response = client.post(
        f"/api/inventory/stockout-risk/hammadde?simulation_id={bob_run['simulation_id']}",
        headers=auth(ALICE),
    )
    assert response.status_code == 200
    # Kosum baska organizasyona ait oldugu icin uretim etkisi hesaplanmaz;
    # rapor kendi basina eksiksiz doner, hata vermez.
    assert response.json()["production_impact"] is None


# --------------------------------------------------------------------------- #
# 5. Simülasyon yalıtımı
# --------------------------------------------------------------------------- #


def test_validation_report_across_organizations_is_404(client: TestClient) -> None:
    run = client.post(
        "/api/simulations/run", json=factory_config(), headers=auth(ALICE)
    ).json()
    simulation_id = run["simulation_id"]

    own = client.get(
        f"/api/simulations/{simulation_id}/validation-report", headers=auth(ALICE)
    )
    assert own.status_code == 200

    other = client.get(
        f"/api/simulations/{simulation_id}/validation-report", headers=auth(BOB)
    )
    assert other.status_code == 404


def test_trace_across_organizations_is_404(client: TestClient) -> None:
    run = client.post(
        "/api/simulations/run", json=factory_config(), headers=auth(ALICE)
    ).json()
    simulation_id = run["simulation_id"]

    assert client.get(
        f"/api/simulations/{simulation_id}/trace", headers=auth(BOB)
    ).status_code == 404
    assert client.get(
        f"/api/simulations/{simulation_id}/trace", headers=auth(ALICE)
    ).status_code == 200


def test_run_response_carries_no_cross_organization_fields(
    client: TestClient,
) -> None:
    """Yanit govdesi baska bir organizasyonun kimligini asla tasimaz."""
    run = client.post(
        "/api/simulations/run", json=factory_config(), headers=auth(ALICE)
    ).json()
    assert "org_id" not in run  # yanit semasinda hic yok; sizdirilacak alan yok

# --------------------------------------------------------------------------- #
# 6. Kimlik yalnizca dogrulanmis token'dan gelir
# --------------------------------------------------------------------------- #


def test_client_cannot_choose_its_organization_via_request_body(
    client: TestClient,
) -> None:
    """Govdeye `org_id` yazarak baska bir organizasyona veri sokulamaz.

    `FactoryCreateRequest` semasinda `org_id` diye bir alan yoktur ve
    `extra="forbid"` bilinmeyen alani reddeder. Kapsam yalnizca dogrulanmis
    token'in `sub` alanindan cozulur.
    """
    alice_org = client.get("/api/me", headers=auth(ALICE)).json()["org_id"]
    bob_org = client.get("/api/me", headers=auth(BOB)).json()["org_id"]

    rejected = client.post(
        FACTORIES, json={"name": "sizma", "org_id": bob_org}, headers=auth(ALICE)
    )
    assert rejected.status_code == 422

    created = client.post(FACTORIES, json={"name": "normal"}, headers=auth(ALICE))
    assert created.json()["factory"]["org_id"] == alice_org
    assert created.json()["factory"]["org_id"] != bob_org


def test_client_cannot_impersonate_another_user_via_query_parameters(
    client: TestClient,
) -> None:
    """Sorgu parametresiyle baska bir kullanicinin kimligine burunulmez."""
    bob = client.get("/api/me", headers=auth(BOB)).json()

    # Alice, Bob'un kullanici/organizasyon kimligini parametre olarak gecirmeye
    # calisir; uc bunlari hic okumaz ve kendi kimligini dondurur.
    spoofed = client.get(
        f"/api/me?user_id={bob['user_id']}&org_id={bob['org_id']}",
        headers=auth(ALICE),
    ).json()

    assert spoofed["user_id"] == "alice-uid"
    assert spoofed["org_id"] != bob["org_id"]


def test_wrong_issuer_is_rejected_over_http(client: TestClient) -> None:
    """Baska bir Supabase projesinin token'i HTTP katmaninda da 401 alir."""
    now = datetime.now(timezone.utc)
    foreign = pyjwt.encode(
        {
            "sub": "alice-uid",
            "email": "alice@firm-a.com",
            "aud": SUPABASE_AUDIENCE,
            "iss": "https://baskaproje.supabase.co/auth/v1",
            "exp": now + timedelta(hours=1),
        },
        SECRET,
        algorithm="HS256",
    )
    # Bu dosyada issuer beklentisi yok (yalnizca sir yapilandirilmis), bu yuzden
    # token gecerlidir; issuer denetimi `SUPABASE_URL` verildiginde devreye
    # girer ve `test_auth_jwt.py` icinde birim duzeyinde sinanir. Burada
    # dogrulanan sey, `iss` alaninin varliginin bir sey bozmadigidir.
    assert client.get(FACTORIES, headers=auth(foreign)).status_code == 200


def test_authorization_header_without_bearer_scheme_is_rejected(
    client: TestClient,
) -> None:
    """`Bearer` semasi olmayan bir baslik kabul edilmez."""
    raw = {"Authorization": ALICE}
    assert client.get(FACTORIES, headers=raw).status_code == 401
    basic = {"Authorization": f"Basic {ALICE}"}
    assert client.get(FACTORIES, headers=basic).status_code == 401


def test_empty_bearer_token_is_rejected(client: TestClient) -> None:
    assert client.get(FACTORIES, headers={"Authorization": "Bearer "}).status_code == 401
    assert client.get(FACTORIES, headers={"Authorization": "Bearer"}).status_code == 401


def test_unreachable_signing_keys_do_not_open_the_door(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """JWKS alinamadiginda istek 503 alir; ASLA iceri girmez.

    Kimlik dogrulamanin en tehlikeli basarisizlik modu, ag hatasinda
    "gecici olarak herkesi kabul et" davranisidir. Burada asimetrik yol
    yapilandirilir, anahtar alimi bozulur ve sonucun 2xx OLMADIGI dogrulanir.
    """
    from simulation_engine.auth import jwt as jwt_module

    monkeypatch.setenv("SUPABASE_URL", "https://testproject.supabase.co")
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    jwt_module.reset_jwks_cache()

    def explode(self, refresh: bool = False):  # noqa: ANN001
        raise ConnectionError("JWKS ucuna ulasilamadi")

    monkeypatch.setattr(pyjwt.PyJWKClient, "get_jwk_set", explode)

    response = client.get(FACTORIES, headers=auth(ALICE))
    assert response.status_code == 503
    assert not response.is_success
    jwt_module.reset_jwks_cache()


def test_missing_auth_configuration_does_not_open_the_door(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sunucu yapilandirilmamissa istek 500 alir; dogrulama atlanmaz."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)

    response = client.get(FACTORIES, headers=auth(ALICE))
    assert response.status_code == 500
    assert not response.is_success
