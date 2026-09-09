"""Gerçek PostgreSQL üzerinde runtime kalıcılığı.

SALES-11'de kalıcılık yalnızca SQLite ile doğrulanmıştı ve rapora
"PostgreSQL: doğrulanmadı" yazılmıştı. Bu dosya o boşluğu kapatır: gömülü ama
**gerçek** bir PostgreSQL sunucusu başlatılır, alembic göçleri gerçekten
uygulanır, veri yazılır, depo kapatılıp yenisi açılarak kurtarma denenir ve
göç geri alınır.

Neden SQLite yeterli değildi
----------------------------
İki motor sessizce ayrışır: `JSONB` yalnızca PostgreSQL'de vardır, `BigInteger`
SQLite'ta `INTEGER`'a iner, `server_default` metinleri farklı yorumlanır ve
`rowcount` farklı davranır. SQLite'ta geçen bir göç, sahadaki PostgreSQL'de
ilk `alembic upgrade` sırasında patlayabilir.

Sunucu kurulamazsa testler **atlanır**
--------------------------------------
Sessizce SQLite'a düşülmez. Düşülseydi "PostgreSQL doğrulandı" satırı yeşil
görünür ama hiçbir şey doğrulanmamış olurdu — bu sprintin kaçınmaya çalıştığı
tam olarak budur.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect, text

from simulation_engine.runtime.persistence.downtime import DowntimeEvent, DowntimeTracker
from simulation_engine.runtime.persistence.models import RUNTIME_TABLE_NAMES
from simulation_engine.runtime.persistence.repository import (
    DatabaseRuntimeRepository,
    StoredConnection,
    StoredEvent,
    StoredHealth,
)
from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord
from simulation_engine.validation import postgres_support


@pytest.fixture(scope="module")
def postgres_url() -> str:
    url = postgres_support.postgres_url()
    if url is None:
        pytest.skip(postgres_support.skip_reason())
    return url


@pytest.fixture()
def database(postgres_url: str) -> str:
    """Her test için boş bir şema."""
    engine = create_engine(postgres_url, future=True)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    engine.dispose()
    return postgres_url


# -- Sunucunun kendisi ------------------------------------------------------


def test_postgres_sunucusu_gercekten_calisiyor(database: str) -> None:
    """Bağlantı kurulur ve sürüm okunur — benzetim değil, gerçek sunucu."""
    engine = create_engine(database, future=True)
    with engine.connect() as connection:
        version = connection.execute(text("SELECT version()")).scalar_one()
    engine.dispose()

    assert "PostgreSQL" in version


def test_jsonb_postgresqlde_gercekten_jsonb(database: str) -> None:
    """`JSON_TYPE` PostgreSQL'de JSONB'ye çözülür.

    SQLite'ta bu ayrım görünmez; yanlış tür seçilseydi sahada JSONB
    operatörleri çalışmazdı.
    """
    DatabaseRuntimeRepository(database)

    engine = create_engine(database, future=True)
    with engine.connect() as connection:
        kind = connection.execute(
            text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name = 'runtime_events' AND column_name = 'data'"
            )
        ).scalar_one()
    engine.dispose()

    assert kind == "jsonb"


# -- Göçler -----------------------------------------------------------------


def _alembic_config(database_url: str):
    from alembic.config import Config

    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def test_alembic_gocleri_postgresqlde_uygulanir(database: str) -> None:
    """`alembic upgrade head` gerçek PostgreSQL'de baştan sona çalışır."""
    from alembic import command

    command.upgrade(_alembic_config(database), "head")

    inspector = inspect(create_engine(database, future=True))
    tables = set(inspector.get_table_names())

    for name in RUNTIME_TABLE_NAMES:
        assert name in tables, f"{name} tablosu goc sonrasi yok"


def test_durus_tablosu_gocle_olusur(database: str) -> None:
    """Bu sprintin yeni tablosu göçün parçası."""
    from alembic import command

    command.upgrade(_alembic_config(database), "head")

    inspector = inspect(create_engine(database, future=True))
    columns = {
        column["name"]: column
        for column in inspector.get_columns("runtime_downtime_events")
    }

    assert set(columns) == {
        "id",
        "org_id",
        "machine_id",
        "start_at_ms",
        "end_at_ms",
        "duration_ms",
        "reason",
        "source",
    }
    # Süren duruşun bitişi yoktur: bu iki alan NULL kabul etmelidir.
    assert columns["end_at_ms"]["nullable"] is True
    assert columns["duration_ms"]["nullable"] is True


def test_goc_geri_alinabilir(database: str) -> None:
    """`downgrade` runtime tablolarını düşürür; iş verisi kalır."""
    from alembic import command

    config = _alembic_config(database)
    command.upgrade(config, "head")
    command.downgrade(config, "c3d4e5f6a7b8")

    tables = set(inspect(create_engine(database, future=True)).get_table_names())

    for name in RUNTIME_TABLE_NAMES:
        assert name not in tables, f"{name} geri alma sonrasi hala duruyor"
    # Kiracı tabloları bu göçten önce oluşur ve geri almadan etkilenmez.
    assert "organizations" in tables


def test_goc_ileri_geri_ileri_calisir(database: str) -> None:
    """Geri alınan göç yeniden uygulanabilir.

    Tek yönlü çalışan bir göç, sahada bir sorunda geri dönülemez demektir.
    """
    from alembic import command

    config = _alembic_config(database)
    command.upgrade(config, "head")
    command.downgrade(config, "d4e5f6a7b8c9")
    command.upgrade(config, "head")

    tables = set(inspect(create_engine(database, future=True)).get_table_names())
    assert "runtime_downtime_events" in tables


# -- Kalıcılık ve kurtarma --------------------------------------------------


def _connection(connection_id: str = "plc-1") -> StoredConnection:
    return StoredConnection(
        connection_id=connection_id,
        kind="opcua",
        label="Torna PLC",
        endpoint="opc.tcp://127.0.0.1:4840",
        topics=["ns=2;i=2"],
        stream_enabled=True,
        ever_verified=True,
        status="connected",
        mapping=[
            {"origin": "ns=2;i=2", "machine": "TORNA_01", "metric": "production_count"}
        ],
    )


def test_baglanti_postgresqle_yazilir_ve_okunur(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    repository.save_connection("org-1", _connection())

    stored = repository.get_connection("org-1", "plc-1")

    assert stored is not None
    assert stored.endpoint == "opc.tcp://127.0.0.1:4840"
    assert stored.mapping[0]["machine"] == "TORNA_01"


def test_connected_durumu_diske_yazilmaz(database: str) -> None:
    """Açık soket bir sürece aittir; diskte "bağlı" diye bir durum olamaz."""
    repository = DatabaseRuntimeRepository(database)
    repository.save_connection("org-1", _connection())

    stored = repository.get_connection("org-1", "plc-1")

    assert stored is not None
    assert stored.status != "connected"


def test_yeni_depoyla_veri_hala_orada(database: str) -> None:
    """Depo kapanıp yenisi açıldığında veri korunur.

    Bellekteki bir önbelleği değil, gerçekten diski okuduğumuzu bu doğrular.
    """
    first = DatabaseRuntimeRepository(database)
    first.save_connection("org-1", _connection())
    first.save_snapshot(
        "org-1",
        MachineSnapshotRecord(
            machine_id="TORNA_01", status="running", production_count=162.0
        ),
    )

    second = DatabaseRuntimeRepository(database)
    snapshots = second.list_snapshots("org-1")

    assert second.get_connection("org-1", "plc-1") is not None
    assert snapshots["TORNA_01"].production_count == 162.0


def test_olculmemis_alan_postgresqlde_null_kalir(database: str) -> None:
    """Ölçülmemiş metrik sıfır değil `NULL` olarak saklanır."""
    repository = DatabaseRuntimeRepository(database)
    repository.save_snapshot(
        "org-1",
        MachineSnapshotRecord(
            machine_id="TORNA_01", status="running", production_count=10.0
        ),
    )

    engine = create_engine(database, future=True)
    with engine.connect() as connection:
        oee = connection.execute(
            text("SELECT oee FROM device_snapshots WHERE machine_id = 'TORNA_01'")
        ).scalar_one()
    engine.dispose()

    assert oee is None


def test_olay_sirasi_postgresqlde_korunur(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    for sequence in range(1, 6):
        repository.append_event(
            "org-1",
            StoredEvent(
                sequence=sequence,
                connection_id="plc-1",
                kind="data",
                level="info",
                message=f"olcum {sequence}",
                at_ms=1_000 * sequence,
            ),
        )

    assert repository.last_sequence("org-1") == 5
    assert [item.sequence for item in repository.events_since("org-1", 2)] == [3, 4, 5]


def test_saglik_sayaclari_yeniden_baslatmayi_asar(database: str) -> None:
    first = DatabaseRuntimeRepository(database)
    first.save_health(
        "org-1",
        StoredHealth(connection_id="plc-1", packets=120, errors=3, reconnects=2),
    )

    second = DatabaseRuntimeRepository(database)
    health = second.get_health("org-1", "plc-1")

    assert health is not None
    assert health.packets == 120
    assert health.reconnects == 2


def test_kiraci_yalitimi_postgresqlde_surer(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    repository.save_connection("org-1", _connection())
    repository.save_connection("org-2", _connection())

    assert len(repository.list_connections("org-1")) == 1
    assert repository.delete_connection("org-1", "plc-1") is True
    assert repository.get_connection("org-2", "plc-1") is not None


# -- Duruşlar ---------------------------------------------------------------


def test_durus_postgresqle_yazilir(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    repository.save_downtime("org-1", DowntimeEvent("TORNA_01", 1_000, end_ms=61_000))

    events = repository.list_downtime("org-1")

    assert len(events) == 1
    assert events[0].duration_ms() == 60_000


def test_suren_durus_null_bitisle_saklanir(database: str) -> None:
    """Devam eden arıza sıfır süreli görünmemelidir."""
    repository = DatabaseRuntimeRepository(database)
    repository.save_downtime("org-1", DowntimeEvent("TORNA_01", 1_000))

    engine = create_engine(database, future=True)
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT end_at_ms, duration_ms FROM runtime_downtime_events")
        ).one()
    engine.dispose()

    assert row[0] is None
    assert row[1] is None


def test_kapanan_durus_ayni_satiri_gunceller(database: str) -> None:
    """Aynı duruş iki satır üretmez; yoksa toplam duruş iki katına çıkardı."""
    repository = DatabaseRuntimeRepository(database)
    repository.save_downtime("org-1", DowntimeEvent("TORNA_01", 1_000))
    repository.save_downtime("org-1", DowntimeEvent("TORNA_01", 1_000, end_ms=61_000))

    events = repository.list_downtime("org-1")

    assert len(events) == 1
    assert events[0].end_ms == 61_000


def test_durus_kurtarmada_geri_yuklenir(database: str) -> None:
    """Yeniden başlatmadan sonra açık duruş açık kalır."""
    first = DatabaseRuntimeRepository(database)
    first.save_downtime("org-1", DowntimeEvent("TORNA_01", 1_000, source="plc-1"))

    tracker = DowntimeTracker()
    loaded = tracker.load(DatabaseRuntimeRepository(database).list_downtime("org-1"))

    assert loaded == 1
    assert tracker.open_count() == 1
    assert tracker.total_ms(now_ms=61_000) == 60_000


# -- Telemetri (SALES-15) ---------------------------------------------------
#
# Saklama, trend ve tanılama ekranlarının tamamı bu tabloya dayanır. SQLite'ta
# geçen bir sorgu PostgreSQL'de patlayabilir: `BigInteger` burada gerçekten 64
# bittir, `func.min` boş tabloda `NULL` döner ve `IN` listesiyle silme farklı
# planlanır. Bu yüzden yaz-sorgula-temizle üçlüsü gerçek sunucuda denenir.


def _point(offset_ms: int = 0, value: float = 10.0, device: str = "FREZE_01"):
    from simulation_engine.runtime.telemetry import TelemetryPoint

    return TelemetryPoint(
        timestamp_ms=1_700_000_000_000 + offset_ms,
        device=device,
        tag="production_count",
        value=value,
        source="plc-1",
    )


def test_telemetri_tablosu_gocle_olusur(database: str) -> None:
    """SALES-15'in yeni tablosu göçün parçası ve alanları beklendiği gibi."""
    from alembic import command

    command.upgrade(_alembic_config(database), "head")

    inspector = inspect(create_engine(database, future=True))
    columns = {
        column["name"]: column for column in inspector.get_columns("telemetry")
    }

    assert set(columns) == {
        "id",
        "org_id",
        "timestamp_ms",
        "device",
        "tag",
        "value",
        "quality",
        "source",
    }
    # Okunamayan bir ölçüm NULL yazılır; sıfır "ölçüldü ve sıfır" demektir.
    assert columns["value"]["nullable"] is True
    assert columns["source"]["nullable"] is True


def test_telemetri_indeksleri_olusur(database: str) -> None:
    """İki indeks de kurulur: trend sorgusu ve saklama temizliği için."""
    from alembic import command

    command.upgrade(_alembic_config(database), "head")

    inspector = inspect(create_engine(database, future=True))
    names = {index["name"] for index in inspector.get_indexes("telemetry")}

    assert "ix_telemetry_org_device_tag_time" in names
    assert "ix_telemetry_org_time" in names


def test_telemetri_postgresqle_yazilir(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    assert repository.write_telemetry("org-a", [_point(0), _point(1_000)]) == 2


def test_telemetri_tekrar_gonderimi_cift_satir_yazmaz(database: str) -> None:
    """Kurtarmadan sonra tekrarlanan ölçüm trend grafiğinde çift nokta olmaz."""
    repository = DatabaseRuntimeRepository(database)
    repository.write_telemetry("org-a", [_point(0)])
    repository.write_telemetry("org-a", [_point(0)])
    assert repository.telemetry_count("org-a") == 1


def test_telemetri_aralikla_sorgulanir(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    repository.write_telemetry("org-a", [_point(0), _point(10_000)])
    found = repository.query_telemetry(
        "org-a", start_ms=1_700_000_000_000 + 5_000
    )
    assert len(found) == 1


def test_telemetri_cihaza_gore_suzulur(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    repository.write_telemetry("org-a", [_point(0), _point(1, device="TORNA_02")])
    assert len(repository.query_telemetry("org-a", device="TORNA_02")) == 1


def test_bos_tabloda_en_eski_null(database: str) -> None:
    """Sıfır dönseydi, boş tablo "1970'ten beri veri var" gibi okunurdu."""
    repository = DatabaseRuntimeRepository(database)
    assert repository.oldest_telemetry_ms("org-a") is None


def test_telemetri_temizligi_kesimden_eskiyi_siler(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    repository.write_telemetry("org-a", [_point(0), _point(10_000)])
    silinen = repository.delete_telemetry_before(
        "org-a", 1_700_000_000_000 + 5_000
    )
    assert silinen == 1


def test_telemetri_temizligi_tur_siniri_uygular(database: str) -> None:
    """Sınırsız bir DELETE, canlı sistemde uzun süren bir kilit yaratırdı."""
    repository = DatabaseRuntimeRepository(database)
    repository.write_telemetry("org-a", [_point(index) for index in range(10)])
    silinen = repository.delete_telemetry_before(
        "org-a", 1_700_000_000_000 + 100, limit=4
    )
    assert silinen == 4


def test_telemetri_kiraci_yalitimi_surer(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    repository.write_telemetry("org-a", [_point(0)])
    repository.write_telemetry("org-b", [_point(0)])
    repository.delete_telemetry_before("org-a", 1_700_000_000_000 + 1)
    assert repository.telemetry_count("org-b") == 1


def test_olculmemis_deger_postgresqlde_null_kalir(database: str) -> None:
    from simulation_engine.runtime.telemetry import TelemetryPoint

    repository = DatabaseRuntimeRepository(database)
    repository.write_telemetry(
        "org-a",
        [
            TelemetryPoint(
                timestamp_ms=1_700_000_000_000,
                device="FREZE_01",
                tag="production_count",
                value=None,
                quality="bad",
            )
        ],
    )
    okunan = repository.query_telemetry("org-a")[0]
    assert okunan.value is None and okunan.source is None


def test_telemetri_yeni_depoda_hala_orada(database: str) -> None:
    """Süreç yeniden başladığında geçmiş kaybolmaz."""
    first = DatabaseRuntimeRepository(database)
    first.write_telemetry("org-a", [_point(0)])
    second = DatabaseRuntimeRepository(database)
    assert second.telemetry_count("org-a") == 1


# -- Lisans, kurulum tokeni, makine etiketi (SALES-16) ----------------------
#
# Uc tablo da sirlarin ozetini tasir ve NULL anlamlari SQLite'ta gizlenebilir:
# `max_machines` icin NULL sinirsiz, `used_at_ms` icin NULL hic kullanilmadi
# demektir. Gercek PostgreSQL'de bu ayrimlarin korundugu dogrulanir.


def test_lisans_tablosu_gocle_olusur(database: str) -> None:
    from alembic import command

    command.upgrade(_alembic_config(database), "head")

    inspector = inspect(create_engine(database, future=True))
    columns = {column["name"]: column for column in inspector.get_columns("licenses")}

    assert "key_digest" in columns
    # NULL sinirsiz demektir; sifir "hic kullanamaz" olurdu.
    assert columns["max_machines"]["nullable"] is True
    assert columns["revoked_at_ms"]["nullable"] is True


def test_kurulum_tokeni_tablosu_gocle_olusur(database: str) -> None:
    from alembic import command

    command.upgrade(_alembic_config(database), "head")

    inspector = inspect(create_engine(database, future=True))
    columns = {
        column["name"]: column for column in inspector.get_columns("install_tokens")
    }

    # Token metni icin bir sutun **yoktur**; yalnizca ozeti saklanir.
    assert "token" not in columns
    assert "digest" in columns
    assert columns["used_at_ms"]["nullable"] is True


def test_token_ozet_indeksi_olusur(database: str) -> None:
    """Kurulum sirasinda arama ozetle yapilir; tam tarama olmamali."""
    from alembic import command

    command.upgrade(_alembic_config(database), "head")

    inspector = inspect(create_engine(database, future=True))
    names = {index["name"] for index in inspector.get_indexes("install_tokens")}
    assert "ix_install_tokens_digest" in names


def test_makine_etiketi_tablosu_gocle_olusur(database: str) -> None:
    from alembic import command

    command.upgrade(_alembic_config(database), "head")

    inspector = inspect(create_engine(database, future=True))
    columns = {
        column["name"]: column for column in inspector.get_columns("machine_labels")
    }

    assert set(columns) >= {"machine_id", "label", "line", "printed_at_ms"}
    # Hic basilmamis etiketin ani NULL kalir.
    assert columns["printed_at_ms"]["nullable"] is True


def test_lisans_postgresqle_yazilir_ve_okunur(database: str) -> None:
    from simulation_engine.runtime.licensing import LicenseTier, issue_license

    repository = DatabaseRuntimeRepository(database)
    repository.save_license(
        "org-a",
        issue_license(
            "org-a",
            LicenseTier.GROWTH,
            1_700_000_000_000,
            days=365,
            customer="Pilot Fabrika",
        ),
    )
    okunan = repository.get_license("org-a")
    assert okunan is not None and okunan.customer == "Pilot Fabrika"


def test_sinirsiz_plan_null_kalir(database: str) -> None:
    """NULL sinirsiz demektir; sifira cevrilseydi kurumsal plan en dar plan olurdu."""
    from simulation_engine.runtime.licensing import LicenseTier, issue_license

    repository = DatabaseRuntimeRepository(database)
    repository.save_license(
        "org-a",
        issue_license("org-a", LicenseTier.ENTERPRISE, 1_700_000_000_000, days=365),
    )
    okunan = repository.get_license("org-a")
    assert okunan is not None and okunan.limits.machines is None


def test_lisans_yeni_depoda_hala_orada(database: str) -> None:
    from simulation_engine.runtime.licensing import LicenseTier, issue_license

    first = DatabaseRuntimeRepository(database)
    first.save_license(
        "org-a", issue_license("org-a", LicenseTier.STARTER, 1_700_000_000_000, days=30)
    )
    second = DatabaseRuntimeRepository(database)
    assert second.get_license("org-a") is not None


def test_lisans_kiraci_yalitimi(database: str) -> None:
    from simulation_engine.runtime.licensing import LicenseTier, issue_license

    repository = DatabaseRuntimeRepository(database)
    repository.save_license(
        "org-a", issue_license("org-a", LicenseTier.STARTER, 1_700_000_000_000, days=30)
    )
    assert repository.get_license("org-b") is None


def test_token_postgresqle_yazilir(database: str) -> None:
    from simulation_engine.runtime.commissioning import issue

    repository = DatabaseRuntimeRepository(database)
    uretilen = issue("org-a", 1_700_000_000_000, sequence=1, site="Hat 1")
    repository.save_install_token("org-a", uretilen.record)
    assert len(repository.list_install_tokens("org-a")) == 1


def test_token_metni_veritabaninda_yok(database: str) -> None:
    """Yedegi ele geciren biri, orada yazan degerle kurulum yapamamalidir."""
    from simulation_engine.runtime.commissioning import issue

    repository = DatabaseRuntimeRepository(database)
    uretilen = issue("org-a", 1_700_000_000_000, sequence=1)
    repository.save_install_token("org-a", uretilen.record)

    engine = create_engine(database, future=True)
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT * FROM install_tokens")).fetchall()
    assert uretilen.token not in str(rows)


def test_token_ozetle_bulunur(database: str) -> None:
    from simulation_engine.runtime.commissioning import issue

    repository = DatabaseRuntimeRepository(database)
    uretilen = issue("org-a", 1_700_000_000_000, sequence=1)
    repository.save_install_token("org-a", uretilen.record)
    assert repository.find_install_token("org-a", uretilen.record.digest) is not None


def test_kullanilmamis_tokenin_ani_null(database: str) -> None:
    from simulation_engine.runtime.commissioning import issue

    repository = DatabaseRuntimeRepository(database)
    uretilen = issue("org-a", 1_700_000_000_000, sequence=1)
    repository.save_install_token("org-a", uretilen.record)
    assert repository.list_install_tokens("org-a")[0].used_at_ms is None


def test_token_sirasi_kiraci_icinde_artar(database: str) -> None:
    from simulation_engine.runtime.commissioning import issue

    repository = DatabaseRuntimeRepository(database)
    repository.save_install_token(
        "org-a", issue("org-a", 1_700_000_000_000, sequence=1).record
    )
    assert repository.next_token_sequence("org-a") == 2


def _label(machine_id: str = "freze_1", label: str = "FREZE-01"):
    from simulation_engine.runtime.commissioning import MachineLabel

    return MachineLabel(
        org_id="org-a",
        machine_id=machine_id,
        label=label,
        created_at_ms=1_700_000_000_000,
    )


def test_etiket_postgresqle_yazilir(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    repository.save_machine_label("org-a", _label())
    assert repository.list_machine_labels("org-a")[0].label == "FREZE-01"


def test_basilmamis_etiketin_ani_null(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    repository.save_machine_label("org-a", _label())
    assert repository.list_machine_labels("org-a")[0].printed_at_ms is None


def test_etiket_silinir(database: str) -> None:
    repository = DatabaseRuntimeRepository(database)
    repository.save_machine_label("org-a", _label())
    assert repository.delete_machine_label("org-a", "freze_1") is True


def test_pilot_tablolari_geri_alinabilir(database: str) -> None:
    """Uc tablo da geri alinabilir; semayi bozmadan dusurulur."""
    from alembic import command

    config = _alembic_config(database)
    command.upgrade(config, "head")
    command.downgrade(config, "a7b8c9d0e1f2")

    tables = set(inspect(create_engine(database, future=True)).get_table_names())
    assert "licenses" not in tables
    assert "install_tokens" not in tables
    assert "machine_labels" not in tables
    # Telemetri bu gocten once olusur ve geri almadan etkilenmez.
    assert "telemetry" in tables
