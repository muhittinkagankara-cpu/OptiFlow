"""Durus olaylari: runtime_downtime_events

Neden ayri tablo
----------------
``device_snapshots`` yalnizca **son** durumu tutar. Vardiya boyunca uc kez
duran bir makine orada "su an calisiyor" gorunur ve toplam durus kaybolur.
Kullanilabilirlik (OEE'nin ilk carpani) dogrudan durus suresinden hesaplandigi
icin, bu bilgi kaybolursa OEE de hesaplanamaz.

Suren durus NULL biter
----------------------
``end_at_ms`` ve ``duration_ms`` **nullable**'dir. Devam eden bir durusun
bitisi yoktur; sifir ya da baslangic degeri yazilsaydi, su an suren bir ariza
raporda sifir sureli gorunur ve fark edilmezdi. Suresi okuma aninda hesaplanir.

Anahtar
-------
Birincil anahtar ``org_id::machine_id::start_at_ms``. Ayni makinenin ayni anda
iki durusu olamaz; ayni baslangicla ikinci bir kayit yazilmaya calisilirsa
anahtar catisir ve mukerrer durus olusmaz.

Geri alma
---------
``downgrade`` tabloyu ve indeksini dusurur. Tablo bu goc ile olusturuldugu ve
baska hicbir tablo ona referans vermedigi icin geri alma kayipsizdir.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-08
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "runtime_downtime_events",
        sa.Column("id", sa.String(length=400), nullable=False),
        sa.Column("org_id", sa.String(length=200), nullable=False),
        sa.Column("machine_id", sa.String(length=200), nullable=False),
        sa.Column("start_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("end_at_ms", sa.BigInteger(), nullable=True),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column(
            "reason",
            sa.String(length=200),
            nullable=False,
            server_default="Bildirilmedi",
        ),
        sa.Column("source", sa.String(length=120), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_runtime_downtime_events_org_id",
        "runtime_downtime_events",
        ["org_id"],
        unique=False,
    )
    op.create_index(
        "ix_runtime_downtime_org_machine",
        "runtime_downtime_events",
        ["org_id", "machine_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_runtime_downtime_org_machine", table_name="runtime_downtime_events"
    )
    op.drop_index(
        "ix_runtime_downtime_events_org_id", table_name="runtime_downtime_events"
    )
    op.drop_table("runtime_downtime_events")
