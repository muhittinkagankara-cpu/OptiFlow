"""Runtime kaliciligi: baglantilar, goruntuler, olaylar ve saglik

Cihaz koprusunun durumunu diske tasir. Bu goce kadar baglantilar, abonelikler
ve cihaz olcumleri yalnizca surec bellegindeydi; sunucu her yeniden
baslatildiginda (dagitim, cokme, olceklendirme) kullanici butun baglantilari
elle yeniden kurmak zorunda kaliyordu.

Dort tablo eklenir:

* ``runtime_connections`` — baglanti tanimlari ve abonelik ayarlari.
* ``device_snapshots``    — her makinenin son bilinen durumu (Live Factory'nin
  tek veri kaynagi).
* ``runtime_events``      — kalici olay gunlugu; yeniden oynatma bunu okur.
* ``runtime_health``      — baglanti basina sayaclar (yeniden baslatmayi asar).

Sifre saklanmaz
---------------
``runtime_connections`` tablosunda parola alani **yoktur**; yalnizca
``has_password`` bayragi tutulur. Sifrelenmemis bir cihaz parolasini
veritabanina yazmak, veritabani yedegini ele geciren birine fabrika erisimi
vermek olurdu. Parola gerektiren bir baglanti, yeniden baslatmadan sonra
kullanicidan yeniden istenir.

Olculmeyen alan NULL
--------------------
Sayisal olcum sutunlarinin hicbirinde varsayilan deger yoktur ve hepsi
nullable'dir. Varsayilan sifir verilseydi, "olculmedi" ile "olculdu ve sifir"
veritabani duzeyinde ayirt edilemezdi.

Geri alma
---------
``downgrade`` dort tabloyu da dusurur. Tablolar bu goc ile olusturuldugu ve
baska hicbir tablo onlara referans vermedigi icin geri alma kayipsizdir:
yalnizca bu sprintte yazilan runtime durumu silinir, is verisi etkilenmez.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: PostgreSQL'de JSONB, digerlerinde JSON — uygulama katmaniyla ayni secim.
JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "runtime_connections",
        sa.Column("id", sa.String(length=320), nullable=False),
        sa.Column("org_id", sa.String(length=200), nullable=False),
        sa.Column("connection_id", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("endpoint", sa.String(length=500), nullable=False),
        sa.Column("port", sa.Integer(), nullable=True),
        sa.Column("username", sa.String(length=200), nullable=True),
        sa.Column("has_password", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("topics", JSON_TYPE, nullable=False),
        sa.Column(
            "security_policy", sa.String(length=40), nullable=False, server_default="None"
        ),
        sa.Column("qos", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("timeout_ms", sa.Integer(), nullable=False, server_default="5000"),
        sa.Column("max_retries", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="idle"),
        sa.Column(
            "ever_verified", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "stream_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("interval_ms", sa.Integer(), nullable=True),
        sa.Column("mapping", JSON_TYPE, nullable=False),
        sa.Column("created_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("updated_at_ms", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_runtime_connections_org_id", "runtime_connections", ["org_id"], unique=False
    )

    op.create_table(
        "device_snapshots",
        sa.Column("id", sa.String(length=320), nullable=False),
        sa.Column("org_id", sa.String(length=200), nullable=False),
        sa.Column("machine_id", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="unknown"),
        sa.Column("production_count", sa.Float(), nullable=True),
        sa.Column("scrap_count", sa.Float(), nullable=True),
        sa.Column("queue_length", sa.Float(), nullable=True),
        sa.Column("downtime_minutes", sa.Float(), nullable=True),
        sa.Column("throughput_per_hour", sa.Float(), nullable=True),
        sa.Column("cycle_time_seconds", sa.Float(), nullable=True),
        sa.Column("oee", sa.Float(), nullable=True),
        sa.Column("sources", JSON_TYPE, nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at_ms", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_device_snapshots_org_id", "device_snapshots", ["org_id"], unique=False
    )

    op.create_table(
        "runtime_events",
        sa.Column("id", sa.String(length=320), nullable=False),
        sa.Column("org_id", sa.String(length=200), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("connection_id", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("level", sa.String(length=20), nullable=False, server_default="info"),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("at_ms", sa.BigInteger(), nullable=False),
        sa.Column("data", JSON_TYPE, nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_runtime_events_org_sequence",
        "runtime_events",
        ["org_id", "sequence"],
        unique=False,
    )

    op.create_table(
        "runtime_health",
        sa.Column("id", sa.String(length=320), nullable=False),
        sa.Column("org_id", sa.String(length=200), nullable=False),
        sa.Column("connection_id", sa.String(length=120), nullable=False),
        sa.Column("avg_latency_ms", sa.Float(), nullable=True),
        sa.Column("max_latency_ms", sa.Float(), nullable=True),
        sa.Column("packets", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("errors", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reconnects", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("recoveries", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_packet_at_ms", sa.BigInteger(), nullable=True),
        sa.Column("updated_at_ms", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_runtime_health_org_id", "runtime_health", ["org_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_runtime_health_org_id", table_name="runtime_health")
    op.drop_table("runtime_health")
    op.drop_index("ix_runtime_events_org_sequence", table_name="runtime_events")
    op.drop_table("runtime_events")
    op.drop_index("ix_device_snapshots_org_id", table_name="device_snapshots")
    op.drop_table("device_snapshots")
    op.drop_index("ix_runtime_connections_org_id", table_name="runtime_connections")
    op.drop_table("runtime_connections")
