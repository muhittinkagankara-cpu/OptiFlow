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


# --------------------------------------------------------------------------- #
# Yinelenebilirlik koruyuculari
# --------------------------------------------------------------------------- #
#
# `simulations` tablosu uygulamanin kendi `create_all()` cagrisiyla olusur ve
# ORM tanimi bugun `factory_id` ile `factory_version_id` sutunlarini zaten
# iceriyor. Dolayisiyla goc ilk kez calistiginda bu sutunlar coktan var
# olabilir; korumasiz bir `add_column` "duplicate column" hatasiyla duser ve
# dagitim sonsuz yeniden baslatma dongusune girer.
#
# Yardimcilar bilincli olarak bu dosyaya gomuludur: bir goc, yazildigi andaki
# semayi tarif eder ve uygulama kodu degistikce anlaminin degismemesi gerekir.


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    return column in {item["name"] for item in _inspector().get_columns(table)}


def _has_index(table: str, name: str) -> bool:
    if not _has_table(table):
        return False
    return name in {item["name"] for item in _inspector().get_indexes(table)}


def _add_column(table: str, column: sa.Column) -> None:
    if not _has_column(table, column.name):
        op.add_column(table, column)


def _create_index(name: str, table: str, columns: list[str]) -> None:
    if not _has_index(table, name):
        op.create_index(name, table, columns, unique=False)


def upgrade() -> None:
    if not _has_table("factories"):
        _create_factories()
    if not _has_table("factory_versions"):
        _create_factory_versions()
    _extend_simulations()


def _create_factories() -> None:
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


def _create_factory_versions() -> None:
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

def _extend_simulations() -> None:
    # Kosumun hangi modelden uretildigi. Yabanci anahtar kisiti bilincli olarak
    # konmadi: fabrika silindiginde gecmis kosum kaydi silinmemeli ya da
    # bosaltilmamalidir. Kosumun kendisi hala gecerli bir olcumdur ve
    # fabrikanin silinmesi gecmisi yeniden yazmamalidir.
    _add_column(
        "simulations", sa.Column("factory_id", sa.String(length=64), nullable=True)
    )
    _add_column(
        "simulations",
        sa.Column("factory_version_id", sa.String(length=64), nullable=True),
    )
    _create_index(
        op.f("ix_simulations_factory_id"), "simulations", ["factory_id"]
    )
    _create_index(
        op.f("ix_simulations_factory_version_id"),
        "simulations",
        ["factory_version_id"],
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
