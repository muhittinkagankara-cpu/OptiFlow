"""Baseline: mevcut semayi kaydeder

Bu göç, Alembic devreye alınmadan **önce** var olan şemayı tanımlar:
`simulations` ve `inventory_items` tabloları. İkisi de o güne kadar
`Base.metadata.create_all()` ile oluşturuluyordu.

Canlı veritabanında bu tablolar zaten mevcuttur; orada bu göç
**çalıştırılmamalı**, yalnızca damgalanmalıdır:

    alembic stamp a1b2c3d4e5f6
    alembic upgrade head

Boş bir veritabanında ise normal biçimde çalışır ve şemayı sıfırdan kurar.
Baseline'ın var olması, bundan sonraki her göçün üzerine dayanacağı bilinen bir
başlangıç noktası verir; onsuz `alembic upgrade head` boş bir veritabanında
"olmayan tabloya sütun ekle" diyerek düşerdi.

Revision ID: a1b2c3d4e5f6
Revises:
Create Date: 2026-09-03
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: Uygulamanın kullandığı JSON tipiyle aynı: PostgreSQL'de JSONB, diğerlerinde
#: JSON. Göçlerde farklı bir tip kullanmak, şemanın modelle sessizce
#: ayrışmasına yol açardı.
JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "simulations",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("config", JSON_TYPE, nullable=False),
        sa.Column("results", JSON_TYPE, nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_simulations_created_at"), "simulations", ["created_at"], unique=False
    )

    op.create_table(
        "inventory_items",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("payload", JSON_TYPE, nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("inventory_items")
    op.drop_index(op.f("ix_simulations_created_at"), table_name="simulations")
    op.drop_table("simulations")
