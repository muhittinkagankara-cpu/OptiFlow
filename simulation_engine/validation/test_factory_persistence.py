"""Fabrika modelinin veritabanı kalıcılığı ve koşumlarla bağı.

Bu dosyanın sorduğu tek soru şudur: **sunucu yeniden başladığında kullanıcı
kaldığı yerden devam edebiliyor mu?**

Tarayıcının sayfayı yenilemesi ile sunucunun yeniden başlaması, kalıcılık
açısından aynı sınavdır: ikisinde de süreç belleği sıfırlanır ve geriye yalnızca
veritabanına yazılmış olan kalır. Bu yüzden testler depoyu kapatıp yenisini
açarak "yeniden başlatma"yı taklit eder; kayıt gerçekten diske düşmediyse ikinci
depo onu bulamaz.

İkinci konu geçmişin bütünlüğüdür. Bir koşum, kendisini üreten fabrika sürümünü
işaret eder ve fabrika sonradan ne kadar değişirse değişsin bu işaret
değişmemelidir — aksi hâlde "bu sonucu hangi modelden aldık" sorusunun cevabı
zamanla kaybolurdu. Saklama süresi (retention) mantığı da bu yüzden değişti:
bir fabrika sürümüne bağlı koşum artık geçici bir çıktı değil, o modelin
geçmişinin parçasıdır ve otuz gün sonra kendiliğinden silinemez.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from simulation_engine.analytics.bottleneck import analyze as analyze_bottleneck
from simulation_engine.analytics.monte_carlo import (
    run_replications,
    summarize_replications,
)
from simulation_engine.analytics.oee import compute_oee_report
from simulation_engine.api.dependencies import get_factory_store, get_store
from simulation_engine.api.factory_storage import (
    DatabaseFactoryStore,
    FactoryVersionRecord,
    InMemoryFactoryStore,
    create_factory_store,
)
from simulation_engine.api.simulation_service import app
from simulation_engine.api.storage import (
    DatabaseSimulationStore,
    SimulationRecord,
    SimulationStore,
    StoredSimulation,
    new_simulation_id,
)
from simulation_engine.models.schemas import (
    FactoryCreateRequest,
    FactorySaveRequest,
    SimulationConfig,
)
from simulation_engine.validation.test_factory_crud import config, layout

FACTORIES = "/api/factories"


def model(**overrides: Any) -> SimulationConfig:
    return SimulationConfig.model_validate(config(**overrides))


@pytest.fixture
def database_url(tmp_path: Path) -> str:
    """Her test icin ayri bir gecici SQLite dosyasi."""
    return f"sqlite:///{tmp_path / 'factories.db'}"


def open_store(database_url: str) -> DatabaseFactoryStore:
    """Tablolari olusturarak bir veritabani deposu acar.

    Yayında tablolar Alembic ile oluşturulur ve uygulama açılışta hiçbir şey
    yaratmaz; testler kendi geçici şemasını kurmak zorundadır.
    """
    return DatabaseFactoryStore(database_url, create_tables=True)


# --------------------------------------------------------------------------- #
# 1. Kalıcılık — "sayfa yenilendi / sunucu yeniden başladı"
# --------------------------------------------------------------------------- #


def test_factory_survives_store_restart(database_url: str) -> None:
    """Kaydedilen fabrika, depo kapanip yeniden acildiginda hala oradadir.

    Bu, tüm Faz 1'in varlık sebebidir: model daha önce yalnızca React
    durumunda yaşıyordu ve sayfa yenilendiğinde kayboluyordu.
    """
    first = open_store(database_url)
    created = first.create(
        FactoryCreateRequest(name="Gıda Hattı", sector="gida", config=model())
    )
    factory_id = created.factory.id
    first.dispose()

    second = open_store(database_url)
    try:
        reopened = second.get(factory_id)
        assert reopened.factory.name == "Gıda Hattı"
        assert reopened.factory.sector == "gida"
        assert reopened.current_version is not None
        assert len(reopened.current_version.config.stations) == 2
    finally:
        second.dispose()


def test_layout_survives_store_restart(database_url: str) -> None:
    """Kutu konumlari da kalicidir.

    Yirmi istasyonluk bir modelde yerleşim, kullanıcının harcadığı emeğin büyük
    bölümüdür. Yalnızca `SimulationConfig` saklansaydı, her açılışta otomatik
    yerleşime sıfırlanır ve yapılan tüm düzenleme kaybolurdu.
    """
    from simulation_engine.models.schemas import FactoryLayout

    positions = FactoryLayout.model_validate(layout())
    first = open_store(database_url)
    created = first.create(
        FactoryCreateRequest(name="Hat", config=model(), layout=positions)
    )
    first.dispose()

    second = open_store(database_url)
    try:
        version = second.current_version(created.factory.id)
        assert version.layout is not None
        assert version.layout.stations["kesim"].x == 0.0
        assert version.layout.stations["montaj"].x == 320.0
        assert version.layout.arrival is not None
        assert version.layout.arrival.x == -260.0
    finally:
        second.dispose()


def test_version_history_survives_store_restart(database_url: str) -> None:
    first = open_store(database_url)
    created = first.create(FactoryCreateRequest(name="Hat", config=model()))
    for servers in (3, 4, 5):
        changed = config()
        changed["stations"][1]["num_servers"] = servers
        first.save(
            created.factory.id,
            FactorySaveRequest(
                config=SimulationConfig.model_validate(changed), note=f"{servers} makine"
            ),
        )
    first.dispose()

    second = open_store(database_url)
    try:
        history = second.list_versions(created.factory.id)
        assert [item.version_number for item in history] == [4, 3, 2, 1]
        assert [item.note for item in history][0] == "5 makine"
        assert second.get(created.factory.id).factory.version_count == 4
    finally:
        second.dispose()


def test_duplicate_prevention_works_across_restart(database_url: str) -> None:
    """Yinelenme engeli veritabani deposunda da gecerlidir.

    Özet karşılaştırması yalnızca bellek deposunda çalışsaydı, yayında her
    kaydetme yeni bir sürüm yaratır ve sorun ancak canlıda fark edilirdi.
    """
    first = open_store(database_url)
    created = first.create(FactoryCreateRequest(name="Hat", config=model()))
    first.dispose()

    second = open_store(database_url)
    try:
        second.save(created.factory.id, FactorySaveRequest(config=model()))
        second.save(created.factory.id, FactorySaveRequest(config=model()))
        assert len(second.list_versions(created.factory.id)) == 1
    finally:
        second.dispose()


def test_delete_removes_versions_from_the_database(database_url: str) -> None:
    """Fabrika silindiginde surumleri de gider; oksuz satir kalmaz."""
    store = open_store(database_url)
    created = store.create(FactoryCreateRequest(name="Hat", config=model()))
    store.delete(created.factory.id)
    store.dispose()

    engine = create_engine(database_url)
    try:
        with sessionmaker(bind=engine)() as session:
            rows = session.execute(select(FactoryVersionRecord)).scalars().all()
            assert rows == []
    finally:
        engine.dispose()


def test_two_stores_see_the_same_data(database_url: str) -> None:
    """Ayni veritabanina bakan iki depo ayni veriyi gorur.

    Çok işçili bir dağıtımda (`uvicorn --workers 4`) bir işçinin kaydettiği
    fabrikayı diğerinin okuyabilmesi gerekir; süreç belleğinde tutulsaydı
    okuyamazdı.
    """
    writer = open_store(database_url)
    reader = open_store(database_url)
    try:
        created = writer.create(FactoryCreateRequest(name="Paylasilan", config=model()))
        assert reader.get(created.factory.id).factory.name == "Paylasilan"
        assert len(reader.list()) == 1
    finally:
        writer.dispose()
        reader.dispose()


def test_factory_store_falls_back_to_memory_without_a_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`DATABASE_URL` yoksa bellek deposuna dusulur.

    Yerel geliştirmede PostgreSQL çalıştırmak zorunda kalmak, projeye katkı
    vermenin önünde gereksiz bir engel olurdu.
    """
    monkeypatch.delenv("DATABASE_URL", raising=False)
    store = create_factory_store()
    assert isinstance(store, InMemoryFactoryStore)


# --------------------------------------------------------------------------- #
# 2. Fabrikadan koşum — uyarlayıcı (adapter)
# --------------------------------------------------------------------------- #


@pytest.fixture
def stores() -> tuple[InMemoryFactoryStore, SimulationStore]:
    factories = InMemoryFactoryStore()
    simulations = SimulationStore()
    app.dependency_overrides[get_factory_store] = lambda: factories
    app.dependency_overrides[get_store] = lambda: simulations
    yield factories, simulations
    app.dependency_overrides.pop(get_factory_store, None)
    app.dependency_overrides.pop(get_store, None)


@pytest.fixture
def client(stores) -> TestClient:
    return TestClient(app)


def create_factory(client: TestClient, **overrides: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"name": "Hat", "config": config(), "layout": layout()}
    payload.update(overrides)
    return client.post(FACTORIES, json=payload).json()


def test_run_from_factory_stamps_the_version(client: TestClient, stores) -> None:
    """Kosum, kendisini ureten surumu isaret eder."""
    _, simulations = stores
    created = create_factory(client)
    factory_id = created["factory"]["id"]
    version_id = created["current_version"]["id"]

    response = client.post(f"{FACTORIES}/{factory_id}/run")
    assert response.status_code == 200

    body = response.json()
    assert body["factory_id"] == factory_id
    assert body["factory_version_id"] == version_id

    stored = simulations.get(body["simulation_id"])
    assert stored.factory_id == factory_id
    assert stored.factory_version_id == version_id


def test_run_from_factory_matches_a_direct_run(client: TestClient) -> None:
    """Uyarlayici matematigi degistirmez.

    Aynı model, aynı tohumla iki yoldan çalıştırıldığında aynı sonucu
    vermelidir; vermeseydi kalıcılık katmanı sonuçları sessizce etkiliyor
    demektir.
    """
    created = create_factory(client)
    from_factory = client.post(f"{FACTORIES}/{created['factory']['id']}/run").json()
    direct = client.post("/api/simulations/run", json=config()).json()

    assert from_factory["results"] == direct["results"]
    assert from_factory["master_seed"] == direct["master_seed"]
    assert from_factory["headline"] == direct["headline"]


def test_direct_run_has_no_factory_reference(client: TestClient) -> None:
    """Mevcut uc degismedi: dogrudan kosum hicbir fabrikaya ait degildir."""
    body = client.post("/api/simulations/run", json=config()).json()
    assert body["factory_id"] is None
    assert body["factory_version_id"] is None


def test_run_requires_a_saved_model(client: TestClient) -> None:
    """Modeli olmayan fabrika 409 dondurur, 404 degil.

    Fabrika vardır, yalnızca henüz bir modeli yoktur. İkisini aynı hataya
    indirgemek, arayüzün "fabrika silinmiş" ile "önce modeli kaydedin"
    durumlarını ayırt edememesi demek olurdu.
    """
    created = client.post(FACTORIES, json={"name": "Bos"}).json()
    response = client.post(f"{FACTORIES}/{created['factory']['id']}/run")
    assert response.status_code == 409


def test_run_from_unknown_factory_returns_404(client: TestClient) -> None:
    assert client.post(f"{FACTORIES}/yok/run").status_code == 404


# --------------------------------------------------------------------------- #
# 3. Geçmişin bütünlüğü
# --------------------------------------------------------------------------- #


def test_editing_the_factory_does_not_reinterpret_an_old_run(
    client: TestClient, stores
) -> None:
    """Sonradan yapilan degisiklik eski kosumu yeniden yorumlayamaz.

    Şartnamedeki asıl gereklilik budur: Sürüm 3 ile üretilen X sonucunun
    anlamı, fabrika sonradan düzenlendiğinde değişmemelidir.
    """
    factories, simulations = stores
    created = create_factory(client)
    factory_id = created["factory"]["id"]
    version_id = created["current_version"]["id"]

    run = client.post(f"{FACTORIES}/{factory_id}/run").json()
    simulation_id = run["simulation_id"]

    # Fabrika kokten degistirilir.
    changed = config()
    changed["stations"][1]["num_servers"] = 9
    changed["stations"][1]["buffer_capacity_before"] = 99
    client.put(f"{FACTORIES}/{factory_id}", json={"config": changed})

    # Kosum hala ilk surumu isaret eder ve o surum degismemistir.
    stored = simulations.get(simulation_id)
    assert stored.factory_version_id == version_id
    assert stored.config.stations[1].num_servers == 2

    original = factories.get_version(factory_id, version_id)
    assert original.config.stations[1].num_servers == 2
    assert original.config.stations[1].buffer_capacity_before == 10

    # Guncel surum ise yeni degerleri tasir.
    assert factories.current_version(factory_id).config.stations[1].num_servers == 9


def test_deleting_the_factory_keeps_the_run(client: TestClient, stores) -> None:
    """Fabrika silinse de kosum kaydi durur.

    Koşumun kendisi hâlâ geçerli bir ölçümdür; fabrikanın silinmesi geçmişi
    yeniden yazmamalıdır.
    """
    _, simulations = stores
    created = create_factory(client)
    factory_id = created["factory"]["id"]
    run = client.post(f"{FACTORIES}/{factory_id}/run").json()

    client.delete(f"{FACTORIES}/{factory_id}")

    stored = simulations.get(run["simulation_id"])
    assert stored.factory_id == factory_id
    assert client.get(
        f"/api/simulations/{run['simulation_id']}/validation-report"
    ).status_code == 200


# --------------------------------------------------------------------------- #
# 4. Saklama süresi (retention)
# --------------------------------------------------------------------------- #


def build_record(**overrides: Any) -> StoredSimulation:
    """Gercek bir kosumdan uretilmis, kucuk bir kayit."""
    small = config(
        simulation_duration_minutes=200.0, warmup_period_minutes=20.0, num_replications=2
    )
    parsed = SimulationConfig.model_validate(small)
    replications, master_seed, elapsed = run_replications(parsed)
    record = StoredSimulation(
        simulation_id=new_simulation_id(),
        config=parsed,
        replications=replications,
        monte_carlo=summarize_replications(replications, master_seed, elapsed),
        bottleneck=analyze_bottleneck(replications[0], parsed),
        oee=compute_oee_report(replications[0]),
        duration_seconds=elapsed,
    )
    for key, value in overrides.items():
        setattr(record, key, value)
    return record


def age_record(database_url: str, simulation_id: str, days: int) -> None:
    """Bir kaydin olusturulma zamanini geriye alir."""
    engine = create_engine(database_url)
    try:
        with sessionmaker(bind=engine)() as session:
            row = session.get(SimulationRecord, simulation_id)
            assert row is not None
            row.created_at = datetime.now(timezone.utc) - timedelta(days=days)
            session.commit()
    finally:
        engine.dispose()


def test_expired_run_without_a_factory_is_deleted(tmp_path: Path) -> None:
    """Fabrikaya bagli olmayan eski kosum hala silinir.

    Kaydedilmemiş bir modelin tek seferlik denemesidir; saklanması için bir
    sebep yoktur ve mevcut davranış korunmalıdır.
    """
    url = f"sqlite:///{tmp_path / 'sims.db'}"
    store = DatabaseSimulationStore(url, retention_days=30)
    old = build_record()
    store.save(old)
    age_record(url, old.simulation_id, days=40)

    store.save(build_record())  # temizlik ekleme aninda calisir

    with pytest.raises(KeyError):
        store.get(old.simulation_id)
    store.dispose()


def test_expired_run_attached_to_a_version_is_kept(tmp_path: Path) -> None:
    """Bir fabrika surumune bagli kosum otuz gun sonra da durur.

    Bu ayrım kalıcı fabrika modeliyle birlikte zorunlu hâle geldi: "sürüm 2 ile
    sürüm 5 arasında ne değişti" sorusunun cevabı kendiliğinden silinemez.
    """
    url = f"sqlite:///{tmp_path / 'sims.db'}"
    store = DatabaseSimulationStore(url, retention_days=30)
    attached = build_record(factory_id="fab-1", factory_version_id="sur-1")
    store.save(attached)
    age_record(url, attached.simulation_id, days=400)

    store.save(build_record())

    kept = store.get(attached.simulation_id)
    assert kept.factory_id == "fab-1"
    assert kept.factory_version_id == "sur-1"
    store.dispose()


def test_factory_reference_survives_a_database_round_trip(tmp_path: Path) -> None:
    url = f"sqlite:///{tmp_path / 'sims.db'}"
    first = DatabaseSimulationStore(url)
    record = build_record(factory_id="fab-9", factory_version_id="sur-9")
    first.save(record)
    first.dispose()

    second = DatabaseSimulationStore(url)
    try:
        restored = second.get(record.simulation_id)
        assert restored.factory_id == "fab-9"
        assert restored.factory_version_id == "sur-9"
    finally:
        second.dispose()


def test_legacy_record_without_references_still_loads(tmp_path: Path) -> None:
    """Sutunlar eklenmeden once yazilmis kayitlar okunmaya devam eder."""
    url = f"sqlite:///{tmp_path / 'sims.db'}"
    store = DatabaseSimulationStore(url)
    record = build_record()
    store.save(record)

    restored = store.get(record.simulation_id)
    assert restored.factory_id is None
    assert restored.factory_version_id is None
    store.dispose()
