"""Alembic çalışma ortamı.

Bağlantı adresi `alembic.ini` yerine `DATABASE_URL` ortam değişkeninden okunur:
adresin dosyaya yazılması, veritabanı parolasının depoya girmesi demek olurdu.
Railway ve Heroku'nun verdiği `postgres://` öneki, uygulamanın kullandığı aynı
`normalize_database_url` işleviyle düzeltilir — göç aracı ile uygulamanın
adresi farklı biçimde yorumlaması, hata ayıklaması en zor sorunlardan biridir.

`target_metadata`, uygulamanın gerçek `Base.metadata`'sıdır. Tablo eşlemelerini
içeren modüller açıkça içe aktarılır; içe aktarılmayan bir tablo metadata'ya
kaydolmaz ve `--autogenerate` onu "silinmiş" sanıp düşürmeye çalışırdı.
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool

from alembic import context

# Depo kökü yola eklenir; `alembic` komutu başka bir dizinden çalıştırıldığında
# da `simulation_engine` paketinin bulunabilmesi için gereklidir.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from simulation_engine.api.storage import (  # noqa: E402
    DATABASE_URL_ENV,
    Base,
    normalize_database_url,
)

# Tablo eşlemeleri metadata'ya bu içe aktarmalarla kaydolur.
import simulation_engine.api.factory_storage  # noqa: F401,E402
import simulation_engine.api.inventory_storage  # noqa: F401,E402
import simulation_engine.api.org_storage  # noqa: F401,E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    """Bağlantı adresini çözer.

    Raises:
        RuntimeError: `DATABASE_URL` tanımlı değilse. Sessizce yerel bir
            SQLite dosyasına düşmek, üretim veritabanını göç ettirdiğini sanan
            birinin boş bir dosyayı göç ettirmesi demek olurdu.
    """
    url = config.get_main_option("sqlalchemy.url") or os.environ.get(DATABASE_URL_ENV)
    if not url:
        raise RuntimeError(
            f"{DATABASE_URL_ENV} tanimli degil. Goc calistirmadan once baglanti "
            f"adresini ortam degiskeni olarak verin, ornegin:\n"
            f"  DATABASE_URL=postgresql://... alembic upgrade head"
        )
    return normalize_database_url(url)


def run_migrations_offline() -> None:
    """Göçleri veritabanına bağlanmadan SQL olarak üretir (`--sql`)."""
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Göçleri canlı bir bağlantı üzerinde çalıştırır."""
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = get_url()

    connectable = engine_from_config(
        section, prefix="sqlalchemy.", poolclass=pool.NullPool
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
