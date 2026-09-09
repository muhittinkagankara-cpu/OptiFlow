"""Pilot kurulumun tablolari: licenses, install_tokens, machine_labels

Neden gerekli
-------------
Ilk ucretli musteriye kurulan bir sistemin uc sorusu vardir ve ucu de kodda
sabit olamaz:

* "Bu kurulum ne zamana kadar, kac kullaniciya, kac makineye lisansli?"
  → `licenses`
* "Bu kurulumu kim, ne zaman, hangi yetkiyle yapti?" → `install_tokens`
* "Ekrandaki `freze_hat1_2`, sahadaki hangi makine?" → `machine_labels`

Sirlar neden saklanmaz
----------------------
`licenses.key_digest` ve `install_tokens.digest` yalnizca SHA-256 ozetidir.
Veritabani yedegini ele geciren biri, orada yazan degerle baska bir kuruluma
lisans yazamamali ve kurulum yapamamalidir.

Sinirlar neden nullable
-----------------------
`max_users`, `max_machines` ve `max_factories` icin `NULL` **sinirsiz**
demektir. Sifir yazilsaydi kurumsal plan en kisitli plan olurdu.

Kullanilmamis alanlar neden nullable
------------------------------------
`used_at_ms` ve `printed_at_ms` icin `NULL` "hic olmadi" demektir. Sifir
yazilsaydi, hic kullanilmamis bir token "1970'te kullanildi" gibi okunurdu.

Geri alma
---------
`downgrade` uc tabloyu ve indekslerini dusurur. Uc tablo da bu goc ile
olusturuldugu ve baska hicbir tablo onlara referans vermedigi icin geri alma
semayi bozmaz — ancak lisans ve kurulum kaydi silinir; geri alma once yedek
almayi gerektirir.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-09-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: PostgreSQL'de JSONB, digerlerinde JSON — uygulama katmaniyla ayni secim.
JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "licenses",
        sa.Column("id", sa.String(length=200), nullable=False),
        sa.Column("org_id", sa.String(length=200), nullable=False),
        sa.Column("tier", sa.String(length=20), nullable=False),
        sa.Column("customer", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("starts_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("expires_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("max_users", sa.Integer(), nullable=True),
        sa.Column("max_machines", sa.Integer(), nullable=True),
        sa.Column("max_factories", sa.Integer(), nullable=True),
        sa.Column("revoked_at_ms", sa.BigInteger(), nullable=True),
        sa.Column("revoked_reason", sa.Text(), nullable=True),
        sa.Column("issued_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("issued_by", sa.String(length=200), nullable=False, server_default="sistem"),
        sa.Column("key_digest", sa.String(length=64), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_licenses_org_id", "licenses", ["org_id"], unique=False)

    op.create_table(
        "install_tokens",
        sa.Column("id", sa.String(length=320), nullable=False),
        sa.Column("org_id", sa.String(length=200), nullable=False),
        sa.Column("token_id", sa.String(length=120), nullable=False),
        sa.Column("digest", sa.String(length=64), nullable=False),
        sa.Column("created_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("expires_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("created_by", sa.String(length=200), nullable=False, server_default="sistem"),
        sa.Column("site", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("used_at_ms", sa.BigInteger(), nullable=True),
        sa.Column("used_by", sa.String(length=200), nullable=True),
        sa.Column("used_from", sa.String(length=120), nullable=True),
        sa.Column("revoked_at_ms", sa.BigInteger(), nullable=True),
        sa.Column("revoked_reason", sa.Text(), nullable=True),
        sa.Column("usage_log", JSON_TYPE, nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_install_tokens_org_id", "install_tokens", ["org_id"], unique=False)
    # Kurulum sirasinda arama ozetle yapilir: gelen token karsilastirilirken
    # butun tablo taranmamalidir.
    op.create_index("ix_install_tokens_digest", "install_tokens", ["digest"], unique=False)

    op.create_table(
        "machine_labels",
        sa.Column("id", sa.String(length=400), nullable=False),
        sa.Column("org_id", sa.String(length=200), nullable=False),
        sa.Column("machine_id", sa.String(length=200), nullable=False),
        sa.Column("label", sa.String(length=40), nullable=False),
        sa.Column("line", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("printed_at_ms", sa.BigInteger(), nullable=True),
        sa.Column("created_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("created_by", sa.String(length=200), nullable=False, server_default="sistem"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_machine_labels_org_id", "machine_labels", ["org_id"], unique=False)
    op.create_index(
        "ix_machine_labels_org_label", "machine_labels", ["org_id", "label"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_machine_labels_org_label", table_name="machine_labels")
    op.drop_index("ix_machine_labels_org_id", table_name="machine_labels")
    op.drop_table("machine_labels")

    op.drop_index("ix_install_tokens_digest", table_name="install_tokens")
    op.drop_index("ix_install_tokens_org_id", table_name="install_tokens")
    op.drop_table("install_tokens")

    op.drop_index("ix_licenses_org_id", table_name="licenses")
    op.drop_table("licenses")
