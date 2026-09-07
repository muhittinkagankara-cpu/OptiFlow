"""Şema hazırlığının her veritabanı durumunda çalıştığını doğrular.

Bu testler bir hata düzeltmesini kilitler. Fabrika modelinin kalıcılığı
`factories`, `factory_versions`, `organizations` ve `memberships` tablolarına
bağlıdır ve bu tablolar **yalnızca** Alembic tarafından oluşturulur.
`simulations` ve `inventory_items` ise kendi depoları tarafından `create_all()`
ile kurulur. Dağıtım göç çalıştırmadığında sonuç bu asimetri yüzünden
yanıltıcıydı: simülasyon sonuçları ve envanter kalıcı görünürken fabrika
modeli kaydedilemiyordu.

Buradaki senaryolar, yayında karşılaşılabilecek veritabanı durumlarını
kapsar. Hepsinde `ensure_schema()` çalıştıktan sonra uygulamanın beklediği
**tüm** tabloların var olması gerekir.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect, text

from simulation_engine.api.inventory_storage import InventoryRecord
from simulation_engine.api.schema_bootstrap import ensure_schema, missing_tables
from simulation_engine.api.storage import Base, SimulationRecord

#: Uygulamanın çalışması için var olması gereken tablolar.
REQUIRED_TABLES = {
    "simulations",
    "inventory_items",
    "factories",
    "factory_versions",
    "organizations",
    "memberships",
}


@pytest.fixture()
def database_url(tmp_path):
    """Her test için ayrı bir SQLite dosyası."""
    return f"sqlite:///{(tmp_path / 'schema.db').as_posix()}"


def table_names(url: str) -> set[str]:
    engine = create_engine(url, future=True)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def create_legacy_tables(url: str) -> None:
    """Uygulamanın kendi `create_all()` çağrılarını taklit eder.

    Yayında olan tam olarak budur: depolar açılışta kendi tablolarını
    **bugünkü** ORM tanımıyla oluşturur, yani `simulations` tablosu
    `factory_id`, `factory_version_id` ve `org_id` sütunlarını zaten taşır.
    Göçlerin bu sütunları körü körüne eklemeye çalışması "duplicate column"
    hatası verirdi.
    """
    engine = create_engine(url, future=True)
    try:
        Base.metadata.create_all(
            engine, tables=[SimulationRecord.__table__, InventoryRecord.__table__]
        )
    finally:
        engine.dispose()


def stamp(url: str, revision: str) -> None:
    """`alembic_version` tablosunu elle damgalar."""
    engine = create_engine(url, future=True)
    try:
        with engine.begin() as connection:
            connection.execute(
                text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
            )
            connection.execute(
                text("INSERT INTO alembic_version VALUES (:revision)"),
                {"revision": revision},
            )
    finally:
        engine.dispose()


def test_bos_veritabaninda_tum_tablolar_kurulur(database_url):
    """Sıfırdan bir veritabanında şema baştan sona kurulur."""
    ensure_schema(database_url)
    assert REQUIRED_TABLES <= table_names(database_url)


def test_alembic_oncesi_veritabani_damgalanir_ve_yukseltilir(database_url):
    """`create_all()` ile kurulmuş eski bir veritabanı göçe uyum sağlar.

    Baseline göçü `simulations` tablosunu yeniden yaratmaya çalışsaydı
    "tablo zaten var" hatasıyla düşer ve dağıtım sonsuz yeniden başlatma
    döngüsüne girerdi.
    """
    create_legacy_tables(database_url)
    ensure_schema(database_url)
    assert REQUIRED_TABLES <= table_names(database_url)


def test_damgasi_gercege_uymayan_veritabani_onarilir(database_url):
    """`alembic stamp head` çalıştırılmış ama göçler uygulanmamış olabilir.

    Bu durumda `alembic upgrade head` hiçbir şey yapmaz; eksik tablolar
    sessizce eksik kalırsa fabrika modeli yine kaydedilemez.
    """
    create_legacy_tables(database_url)
    stamp(database_url, "c3d4e5f6a7b8")

    ensure_schema(database_url)

    assert REQUIRED_TABLES <= table_names(database_url)


def test_iki_kez_calistirmak_guvenlidir(database_url):
    """Her dağıtımda çalıştırılacağı için yinelenebilir olmalıdır."""
    ensure_schema(database_url)
    first = table_names(database_url)

    ensure_schema(database_url)

    assert table_names(database_url) == first


def test_database_url_yoksa_sessizce_gecilir(monkeypatch):
    """Yerel geliştirmede göç edilecek bir veritabanı yoktur.

    Hata fırlatsaydı `Procfile` içindeki `&&` zinciri kopar ve sunucu hiç
    başlamazdı; oysa depolar bellek modunda çalışmaya devam edebilir.
    """
    monkeypatch.delenv("DATABASE_URL", raising=False)
    ensure_schema()  # yükselmemeli


def test_missing_tables_eksikleri_bildirir(database_url):
    """Doğrulama yardımcısı gerçekten eksikleri saptar."""
    create_legacy_tables(database_url)
    engine = create_engine(database_url, future=True)
    try:
        eksik = set(missing_tables(engine))
    finally:
        engine.dispose()

    assert "factories" in eksik
    assert "organizations" in eksik
    assert "simulations" not in eksik
