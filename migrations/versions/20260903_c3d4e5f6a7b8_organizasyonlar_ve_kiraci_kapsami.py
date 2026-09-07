"""Organizasyonlar, uyelikler ve kiraci kapsami

`organizations` ve `memberships` tablolarını ekler; `inventory_items` ve
`simulations` tablolarına `org_id` sütunu koyar. `factories` tablosu bu sütunu
zaten taşıyordu (Faz 1'de çok kiracılı desteğe hazırlık olarak, kullanılmadan
açılmıştı) — bu göç onu ilk kez fiilen dolduran koddur.

Tüm `org_id` sütunları **nullable**'dır. Bu, geriye dönük uyumluluğun şartıdır:
kimlik doğrulama bu göçten önce hiç yoktu, dolayısıyla mevcut hiçbir satırın
sahibi bilinmiyor. Bu satırlar geri doldurulmaz (backfill edilmez) — kimin
oluşturduğu bilinmeyen bir kaydı rastgele bir organizasyona atamak, o
organizasyonun hiç görmediği veriye erişimini iddia etmek olurdu. Bunun yerine
uygulama katmanı `org_id` üzerinden **tam eşleşme** ile filtreler; `org_id`
NULL olan satırlar hiçbir organizasyona görünmez hâle gelir (var olmaya devam
ederler, yalnızca API üzerinden erişilemezler). Kimlik doğrulama öncesi
dönemden kalma veri zaten yalnızca geliştirme/deneme verisidir; gerçek bir
kiracıya ait olmadığı için bu kayıp kabul edilebilirdir.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-09-03
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# --------------------------------------------------------------------------- #
# Yinelenebilirlik koruyuculari
# --------------------------------------------------------------------------- #
#
# `simulations` ve `inventory_items` tablolari uygulamanin kendi `create_all()`
# cagrisiyla olusur ve ORM tanimlari bugun `org_id` sutununu zaten iceriyor.
# Dolayisiyla goc ilk kez calistiginda bu sutun coktan var olabilir; korumasiz
# bir `add_column` "duplicate column" hatasiyla duser ve dagitim sonsuz yeniden
# baslatma dongusune girer.
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
    if not _has_table("organizations"):
        op.create_table(
            "organizations",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    # `user_id` birincil anahtardir: "bir kullanici yalnizca bir organizasyona
    # aittir" kurali veritabani duzeyinde de zorlanir, ikinci bir satir eklemek
    # birincil anahtar ihlaline carpar.
    if not _has_table("memberships"):
        op.create_table(
            "memberships",
            sa.Column("user_id", sa.String(length=64), nullable=False),
            sa.Column("org_id", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("user_id"),
        )
    _create_index(op.f("ix_memberships_org_id"), "memberships", ["org_id"])

    _add_column(
        "inventory_items", sa.Column("org_id", sa.String(length=64), nullable=True)
    )
    _create_index(
        op.f("ix_inventory_items_org_id"), "inventory_items", ["org_id"]
    )

    _add_column("simulations", sa.Column("org_id", sa.String(length=64), nullable=True))
    _create_index(op.f("ix_simulations_org_id"), "simulations", ["org_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_simulations_org_id"), table_name="simulations")
    op.drop_column("simulations", "org_id")

    op.drop_index(op.f("ix_inventory_items_org_id"), table_name="inventory_items")
    op.drop_column("inventory_items", "org_id")

    op.drop_index(op.f("ix_memberships_org_id"), table_name="memberships")
    op.drop_table("memberships")

    op.drop_table("organizations")
