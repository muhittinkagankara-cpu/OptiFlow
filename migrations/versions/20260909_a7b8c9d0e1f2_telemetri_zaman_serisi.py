"""Telemetri zaman serisi: telemetry

Neden gerekli
-------------
`device_snapshots` yalnizca son degeri tutar. "Dun gece 03:00'te ne oluyordu?"
sorusunun yaniti orada yoktur; vardiya boyunca uretimin nasil seyrettigi de
gorulemez. Trend ekranlari, durus analizi ve devreye alma raporu bir zaman
serisi ister.

Neden ayri bir tablo
--------------------
Olay gunlugu (`runtime_events`) insan okumasi icindir ve 5.000 kayitla
sinirlidir. Telemetri sayisaldir, cok daha yogundur ve farkli sorgulanir.

Indeksler
---------
Iki indeks vardir cunku iki farkli sorgu vardir:

* `ix_telemetry_org_device_tag_time` — trend sorgusu ("su kiracinin su
  cihaz-etiketi, su zaman araliginda"). Bu indeks olmadan sorgu milyonlarca
  satirda tam tarama olurdu.
* `ix_telemetry_org_time` — saklama temizligi yalnizca zamana bakar ve cihazi
  umursamaz; birinci indeksin on eki cihaz oldugu icin ona dusemez.

Deger neden nullable
--------------------
Okunamayan bir olcum `NULL` yazilir. Sifir varsayilan verilseydi, "okunamadi"
ile "okundu ve sifir" veritabani duzeyinde ayirt edilemezdi ve trend grafigi
sensor arizasini sifir uretim gibi gosterirdi.

Geri alma
---------
`downgrade` tabloyu ve iki indeksini dusurur. Tablo bu goc ile olusturuldugu
ve baska hicbir tablo ona referans vermedigi icin geri alma kayipsizdir —
ancak tablodaki gecmis olcumler silinir; geri alma once yedek almayi gerektirir.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-09-09
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "telemetry",
        sa.Column("id", sa.String(length=600), nullable=False),
        sa.Column("org_id", sa.String(length=200), nullable=False),
        sa.Column("timestamp_ms", sa.BigInteger(), nullable=False),
        sa.Column("device", sa.String(length=200), nullable=False),
        sa.Column("tag", sa.String(length=200), nullable=False),
        sa.Column("value", sa.Float(), nullable=True),
        sa.Column("quality", sa.String(length=20), nullable=False, server_default="good"),
        sa.Column("source", sa.String(length=120), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_telemetry_org_device_tag_time",
        "telemetry",
        ["org_id", "device", "tag", "timestamp_ms"],
        unique=False,
    )
    op.create_index(
        "ix_telemetry_org_time",
        "telemetry",
        ["org_id", "timestamp_ms"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_telemetry_org_time", table_name="telemetry")
    op.drop_index("ix_telemetry_org_device_tag_time", table_name="telemetry")
    op.drop_table("telemetry")
