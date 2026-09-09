"""Gerçek PostgreSQL üzerinde yedekleme, geri yükleme ve göç doğrulaması.

SQLite'ta çalışan bir yedek, PostgreSQL'de çalışacağı anlamına gelmez: `JSONB`
yalnızca PostgreSQL'de vardır, `BigInteger` SQLite'ta `INTEGER`'a iner ve
`rowcount` farklı davranır. Bu yüzden aynı senaryo gerçek bir sunucuda da
koşulur.

Sunucu kurulamazsa testler **atlanır**; sessizce SQLite'a düşülmez.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect, text

from simulation_engine.runtime.audit import AuditAction, AuditRecorder
from simulation_engine.runtime.ops.backup import (
    create_backup,
    restore_backup,
    verify_backup,
)
from simulation_engine.runtime.persistence.models import RUNTIME_TABLE_NAMES
from simulation_engine.runtime.persistence.repository import (
    DatabaseRuntimeRepository,
    StoredConnection,
    StoredHealth,
)
from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord
from simulation_engine.validation import postgres_support

ORG = "pg-ops-org"
NOW = 4_000_000


@pytest.fixture(scope="module")
def postgres_url() -> str:
    url = postgres_support.postgres_url()
    if url is None:
        pytest.skip(postgres_support.skip_reason())
    return url


@pytest.fixture()
def database(postgres_url: str) -> str:
    engine = create_engine(postgres_url, future=True)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    engine.dispose()
    return postgres_url


def _alembic_config(database_url: str):
    from alembic.config import Config

    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def seed(repository) -> None:
    repository.save_connection(
        ORG,
        StoredConnection(
            connection_id="plc-1",
            kind="opcua",
            label="Torna PLC",
            endpoint="opc.tcp://127.0.0.1:4840",
            topics=["ns=2;i=2"],
            ever_verified=True,
        ),
    )
    repository.save_snapshot(
        ORG,
        MachineSnapshotRecord(
            machine_id="TORNA_01",
            status="running",
            production_count=162.0,
            updated_at_ms=NOW,
        ),
    )
    repository.save_health(
        ORG, StoredHealth(connection_id="plc-1", packets=120, errors=3)
    )


class TestGocler:
    def test_denetim_tablosu_gocle_olusur(self, database: str) -> None:
        from alembic import command

        command.upgrade(_alembic_config(database), "head")
        tables = set(inspect(create_engine(database, future=True)).get_table_names())
        assert "runtime_audit_log" in tables

    def test_butun_runtime_tablolari_olusur(self, database: str) -> None:
        from alembic import command

        command.upgrade(_alembic_config(database), "head")
        tables = set(inspect(create_engine(database, future=True)).get_table_names())
        for name in RUNTIME_TABLE_NAMES:
            assert name in tables

    def test_denetim_gocu_geri_alinabilir(self, database: str) -> None:
        from alembic import command

        config = _alembic_config(database)
        command.upgrade(config, "head")
        command.downgrade(config, "e5f6a7b8c9d0")

        tables = set(inspect(create_engine(database, future=True)).get_table_names())
        assert "runtime_audit_log" not in tables
        # Bir onceki gocun tablosu yerinde kalmali.
        assert "runtime_downtime_events" in tables

    def test_ileri_geri_ileri_calisir(self, database: str) -> None:
        from alembic import command

        config = _alembic_config(database)
        command.upgrade(config, "head")
        command.downgrade(config, "e5f6a7b8c9d0")
        command.upgrade(config, "head")

        tables = set(inspect(create_engine(database, future=True)).get_table_names())
        assert "runtime_audit_log" in tables

    def test_denetim_ayrintilari_jsonb(self, database: str) -> None:
        """`details` PostgreSQL'de JSONB olmalı; SQLite'ta bu ayrım görünmez."""
        DatabaseRuntimeRepository(database)
        engine = create_engine(database, future=True)
        with engine.connect() as connection:
            kind = connection.execute(
                text(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_name = 'runtime_audit_log' AND column_name = 'details'"
                )
            ).scalar_one()
        engine.dispose()
        assert kind == "jsonb"


class TestYedeklemeSenaryosu:
    def test_olustur_yedekle_sil_geri_yukle(self, database: str) -> None:
        """Sprintin zorunlu senaryosu, gerçek PostgreSQL üzerinde."""
        repository = DatabaseRuntimeRepository(database)
        seed(repository)

        payload = create_backup(repository, ORG, clock=lambda: NOW)
        assert verify_backup(payload) == []

        repository.delete_connection(ORG, "plc-1")
        repository.clear_snapshots(ORG)
        assert repository.list_connections(ORG) == []

        result = restore_backup(repository, payload)

        assert result.ok is True
        assert repository.get_connection(ORG, "plc-1") is not None
        assert repository.list_snapshots(ORG)["TORNA_01"].production_count == 162.0

    def test_yeni_baglantiyla_geri_yukleme_kalici(self, database: str) -> None:
        """Geri yükleme diske yazılmalı; bellekteki bir kopyaya değil."""
        first = DatabaseRuntimeRepository(database)
        seed(first)
        payload = create_backup(first, ORG, clock=lambda: NOW)
        first.delete_connection(ORG, "plc-1")
        restore_backup(first, payload)

        second = DatabaseRuntimeRepository(database)
        assert second.get_connection(ORG, "plc-1") is not None

    def test_saglik_sayaclari_geri_gelir(self, database: str) -> None:
        repository = DatabaseRuntimeRepository(database)
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        restore_backup(repository, payload)
        assert repository.get_health(ORG, "plc-1").packets == 120

    def test_bozuk_yedek_veriyi_silmez(self, database: str) -> None:
        repository = DatabaseRuntimeRepository(database)
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        payload["checksum"] = "bozuk"

        result = restore_backup(repository, payload)

        assert result.ok is False
        assert repository.get_connection(ORG, "plc-1") is not None


class TestDenetimKaliciligi:
    def test_kayit_postgresqle_yazilir(self, database: str) -> None:
        repository = DatabaseRuntimeRepository(database)
        recorder = AuditRecorder(repository=repository, clock=lambda: NOW)
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "plc-1", actor="Ayşe")

        assert repository.audit_count(ORG) == 1

    def test_yeniden_baslatmada_gecmis_korunur(self, database: str) -> None:
        first = DatabaseRuntimeRepository(database)
        AuditRecorder(repository=first, clock=lambda: NOW).record(
            ORG, AuditAction.ALARM_ACKNOWLEDGE, "a1", actor="Ayşe"
        )

        second = DatabaseRuntimeRepository(database)
        entries = second.list_audit(ORG)

        assert len(entries) == 1
        assert entries[0].actor == "Ayşe"

    def test_hassas_alan_diske_yazilmaz(self, database: str) -> None:
        repository = DatabaseRuntimeRepository(database)
        AuditRecorder(repository=repository, clock=lambda: NOW).record(
            ORG, AuditAction.CONNECTOR_CONNECT, "plc-1", details={"password": "gizli"}
        )

        engine = create_engine(database, future=True)
        with engine.connect() as connection:
            raw = connection.execute(
                text("SELECT details::text FROM runtime_audit_log")
            ).scalar_one()
        engine.dispose()

        assert "gizli" not in raw
        assert "***" in raw

    def test_kiraci_yalitimi_surer(self, database: str) -> None:
        repository = DatabaseRuntimeRepository(database)
        recorder = AuditRecorder(repository=repository, clock=lambda: NOW)
        recorder.record("a", AuditAction.CONNECTOR_CONNECT, "c1")
        recorder.record("b", AuditAction.CONNECTOR_CONNECT, "c1")

        assert repository.audit_count("a") == 1
