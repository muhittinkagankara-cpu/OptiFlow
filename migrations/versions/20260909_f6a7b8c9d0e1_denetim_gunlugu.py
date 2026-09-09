"""Denetim gunlugu: runtime_audit_log

Neden gerekli
-------------
"Bu alarmi kim kapatti?", "bu baglantiyi kim durdurdu?", "bu kisiye
yoneticiligi kim verdi?" sorulari bir fabrikada er ya da gec sorulur. Uygulama
gunlugu bu is icin yetmez: donusumludur, silinir ve yapilandirilmamistir.

Yalnizca eklenir
----------------
Uygulama katmaninda bu tabloya guncelleme ve silme islevi **yazilmamistir**.
Sonradan duzeltilebilen bir denetim gunlugu kanit degeri tasimaz; yanlis bir
kayit duzeltilmez, ustune duzeltme kaydi yazilir.

Hassas alanlar
--------------
`details` sozlugu diske yazilmadan once suzulur: parola, token ve api anahtari
gibi alanlar `***` ile degistirilir. Denetim kayitlari cogu zaman destek
ekibiyle paylasilir ve sizintinin en kolay yolu boyle bir alandir.

Geri alma
---------
`downgrade` tabloyu ve indekslerini dusurur. Tablo bu goc ile olusturuldugu ve
baska hicbir tablo ona referans vermedigi icin geri alma kayipsizdir.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-09-09
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: PostgreSQL'de JSONB, digerlerinde JSON — uygulama katmaniyla ayni secim.
JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "runtime_audit_log",
        sa.Column("id", sa.String(length=320), nullable=False),
        sa.Column("org_id", sa.String(length=200), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("action", sa.String(length=60), nullable=False),
        sa.Column("resource", sa.String(length=300), nullable=False),
        sa.Column("actor", sa.String(length=200), nullable=False, server_default="sistem"),
        sa.Column("outcome", sa.String(length=20), nullable=False, server_default="success"),
        sa.Column("at_ms", sa.BigInteger(), nullable=False),
        sa.Column("details", JSON_TYPE, nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_runtime_audit_log_org_id", "runtime_audit_log", ["org_id"], unique=False
    )
    op.create_index(
        "ix_runtime_audit_org_sequence",
        "runtime_audit_log",
        ["org_id", "sequence"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_runtime_audit_org_sequence", table_name="runtime_audit_log")
    op.drop_index("ix_runtime_audit_log_org_id", table_name="runtime_audit_log")
    op.drop_table("runtime_audit_log")
