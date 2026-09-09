"""Runtime tablolarının oluşturulması ve şema kontrolü.

İki yol vardır ve ikisi de gereklidir:

* **Alembic** — yayına alınmış ortamın tek doğru yolu; sürümlenmiş ve geri
  alınabilir (`migrations/versions/...runtime_kaliciligi...`).
* **`ensure_runtime_tables`** — alembic çalıştırılmamış bir ortamda (yerel
  geliştirme, testlerdeki SQLite) tabloları oluşturur.

İkincisi neden var: köprü, alembic koşumu unutulduğu için sessizce bellek
moduna düşerse kullanıcı durumun kalıcı olduğunu sanır. Tabloların varlığını
garanti etmek, bu sessiz düşüşü ortadan kaldırır.

`create_all` yalnızca **eksik** tabloları oluşturur ve var olanlara dokunmaz;
şema değişikliği alembic'in işidir.
"""

from __future__ import annotations

import logging
from typing import List

from sqlalchemy import inspect

from simulation_engine.runtime.persistence.models import (
    RUNTIME_TABLE_NAMES,
    RUNTIME_TABLES,
)

logger = logging.getLogger(__name__)


def ensure_runtime_tables(engine) -> List[str]:
    """Eksik runtime tablolarını oluşturur; oluşturulanların adını döndürür."""
    missing = missing_tables(engine)
    if missing:
        for table in RUNTIME_TABLES:
            if table.name in missing:
                table.create(bind=engine, checkfirst=True)
        logger.info("Runtime tablolari olusturuldu: %s", ", ".join(missing))
    return missing


def missing_tables(engine) -> List[str]:
    """Veritabanında bulunmayan runtime tabloları."""
    existing = set(inspect(engine).get_table_names())
    return [name for name in RUNTIME_TABLE_NAMES if name not in existing]


def runtime_schema_ready(engine) -> bool:
    """Bütün runtime tabloları yerinde mi?"""
    return not missing_tables(engine)


def drop_runtime_tables(engine) -> None:
    """Tabloları siler.

    Yalnızca testler ve geri alma (rollback) senaryoları için; üretimde
    çağrılmaz. Sıra tersten gider ki yabancı anahtar kısıtları takılmasın.
    """
    for table in reversed(RUNTIME_TABLES):
        table.drop(bind=engine, checkfirst=True)
