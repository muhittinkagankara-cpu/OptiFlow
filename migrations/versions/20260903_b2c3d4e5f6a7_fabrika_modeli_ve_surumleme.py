"""Fabrika modeli ve surumleme

`factories` ve `factory_versions` tablolarını ekler, `simulations` tablosuna
koşumun hangi fabrika sürümünden üretildiğini söyleyen iki referans sütunu
koyar.

İki referans sütunu da **nullable**'dır ve bu geriye dönük uyumluluğun şartıdır:
mevcut kayıtların hiçbiri bir fabrikaya ait değildir ve
`POST /api/simulations/run` doğrudan bir `SimulationConfig` ile çağrılmaya devam
eder. Sütunları zorunlu yapmak, bu göçü mevcut veri üzerinde çalıştırılamaz
hâle getirirdi.

`factory_versions.snapshot_hash` indekslidir: kaydetme sırasında yapılan "bu
içerik zaten var mı" karşılaştırması bu sütun üzerinden yapılır ve aynı modelin
ikinci kez kaydedilmesi yeni bir sürüm yaratmaz.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-09-03
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "factories",
        sa.Column("id", sa.String(length=64), nullable=False),
        # Faz 1'de her zaman bostur. Simdiden acilmasi bilincli: cok kiracili
        # destege gecildiginde sutunu canli veri uzerinde eklemek, bos
        # birakilmis bir sutunu doldurmaktan cok daha riskli bir islemdir.
        sa.Column("org_id", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("sector", sa.String(length=64), nullable=True),
        sa.Column("current_version_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_factories_org_id"), "factories", ["org_id"], unique=False)
    op.create_index(
        op.f("ix_factories_updated_at"), "factories", ["updated_at"], unique=False
    )

    op.create_table(
        "factory_versions",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("factory_id", sa.String(length=64), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("snapshot_hash", sa.String(length=64), nullable=False),
        # `config` ve `layout` ayri JSON sutunlarinda tutulur. Istasyonlari
        # iliskisel tablolara acmak, `SimulationConfig` semasinin ikinci bir
        # yerde daha tanimlanmasi ve her alan eklendiginde bir goc gerekmesi
        # demekti; oysa sema zaten `models/schemas.py` icinde tek ve
        # dogrulanmis halde duruyor.
        sa.Column("config", JSON_TYPE, nullable=False),
        sa.Column("layout", JSON_TYPE, nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["factory_id"], ["factories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_factory_versions_factory_id"),
        "factory_versions",
        ["factory_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_factory_versions_snapshot_hash"),
        "factory_versions",
        ["snapshot_hash"],
        unique=False,
    )
    op.create_index(
        op.f("ix_factory_versions_created_at"),
        "factory_versions",
        ["created_at"],
        unique=False,
    )

    # Kosumun hangi modelden uretildigi. Yabanci anahtar kisiti bilincli olarak
    # konmadi: fabrika silindiginde gecmis kosum kaydi silinmemeli ya da
    # bosaltilmamalidir. Kosumun kendisi hala gecerli bir olcumdur ve
    # fabrikanin silinmesi gecmisi yeniden yazmamalidir.
    op.add_column(
        "simulations", sa.Column("factory_id", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "simulations",
        sa.Column("factory_version_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        op.f("ix_simulations_factory_id"), "simulations", ["factory_id"], unique=False
    )
    op.create_index(
        op.f("ix_simulations_factory_version_id"),
        "simulations",
        ["factory_version_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_simulations_factory_version_id"), table_name="simulations")
    op.drop_index(op.f("ix_simulations_factory_id"), table_name="simulations")
    op.drop_column("simulations", "factory_version_id")
    op.drop_column("simulations", "factory_id")

    op.drop_index(op.f("ix_factory_versions_created_at"), table_name="factory_versions")
    op.drop_index(
        op.f("ix_factory_versions_snapshot_hash"), table_name="factory_versions"
    )
    op.drop_index(op.f("ix_factory_versions_factory_id"), table_name="factory_versions")
    op.drop_table("factory_versions")

    op.drop_index(op.f("ix_factories_updated_at"), table_name="factories")
    op.drop_index(op.f("ix_factories_org_id"), table_name="factories")
    op.drop_table("factories")
