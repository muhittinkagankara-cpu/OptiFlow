"""Dağıtımda veritabanı şemasını hazır hâle getirir.

Neden gerekli
-------------
Şema Alembic ile yönetilir ve uygulama açılışında göç çalıştırmaz. Ancak
`Procfile` yalnızca uvicorn'u başlatıyordu; `alembic upgrade head` çalıştırmak
**operatörün her dağıtımda hatırlaması gereken elle bir adımdı**. Bu adım
atlandığında sonuç sessiz ve yanıltıcıydı:

* `simulations` ve `inventory_items` tabloları kendi depoları tarafından
  `create_all` ile oluşturulur — bu yüzden simülasyon sonuçları ve envanter
  kalemleri kalıcı görünüyordu.
* `factories`, `factory_versions`, `organizations` ve `memberships` tabloları
  **yalnızca** Alembic tarafından oluşturulur. Göç çalışmadığında bu tablolar
  hiç var olmaz ve fabrika modeli kaydedilemez.

Yani ürünün en pahalı verisi — kullanıcının saatlerce kurduğu fabrika modeli —
kalıcılığı elle bir komuta bağlı tek veriydi. Bu modül o komutu dağıtımın
kendisine taşır.

Ne yapar
--------
1. **Eski veritabanını damgalar.** Alembic devreye girmeden önce
   `create_all()` ile kurulmuş bir veritabanında `alembic_version` tablosu
   yoktur; baseline göçü `simulations` tablosunu yeniden yaratmaya çalışıp
   "tablo zaten var" hatasıyla düşerdi. README'de elle yapılması istenen
   `alembic stamp a1b2c3d4e5f6` adımı burada koşullu olarak yapılır.
2. **Göçleri çalıştırır** (`alembic upgrade head`).
3. **Eksik tablo kalmadığını doğrular.** Göçler bittikten sonra uygulamanın
   beklediği bir tablo hâlâ yoksa, bu `alembic_version` damgasının gerçekle
   uyuşmadığı anlamına gelir (ör. geçmişte `alembic stamp head` çalıştırılmış
   ve göçler hiç uygulanmamış). Bu durumda eksik tablolar ORM tanımından
   oluşturulur ve durum **uyarı olarak günlüğe yazılır**. Damgası bozuk bir
   veritabanında `upgrade head` hiçbir şey yapmaz ve sorun sessizce sürerdi.

Bu üç adım da yinelenebilirdir (idempotent): her dağıtımda çalıştırılması
güvenlidir ve yapacak iş yoksa hiçbir şey değiştirmez.

`DATABASE_URL` tanımlı değilse hiçbir şey yapılmaz ve süreç başarıyla biter:
yerel geliştirmede depolar zaten bellekte çalışır, göç edilecek bir veritabanı
yoktur.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import List, Optional

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

from simulation_engine.api.storage import (
    DATABASE_URL_ENV,
    Base,
    normalize_database_url,
)

# Tablo eşlemeleri `Base.metadata`ya bu içe aktarmalarla kaydolur. Eksik bir
# içe aktarma, o tablonun doğrulama adımında hiç aranmaması demek olurdu —
# `migrations/env.py` aynı listeyi aynı sebeple taşır.
import simulation_engine.api.factory_storage  # noqa: F401
import simulation_engine.api.inventory_storage  # noqa: F401
import simulation_engine.api.org_storage  # noqa: F401

logger = logging.getLogger(__name__)

#: Depo kökü: `alembic.ini` ve `migrations/` burada bulunur.
REPO_ROOT: Path = Path(__file__).resolve().parents[2]

#: Alembic devreye girmeden önce var olan şemayı tanımlayan göç.
BASELINE_REVISION: str = "a1b2c3d4e5f6"

#: Baseline göçünün oluşturduğu tablolar. Bunlardan biri varken
#: `alembic_version` yoksa, veritabanı "Alembic öncesi" dönemden kalmadır.
LEGACY_TABLES: tuple[str, ...] = ("simulations", "inventory_items")


def _alembic_config(url: str):
    """Alembic yapılandırmasını oluşturur.

    Bağlantı adresi açıkça geçirilir; `migrations/env.py` önce
    `sqlalchemy.url` seçeneğine bakar, böylece göç aracıyla uygulama aynı
    adresi kullanır.
    """
    from alembic.config import Config

    config = Config(str(REPO_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(REPO_ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", url)
    return config


def _is_pre_alembic_database(engine: Engine) -> bool:
    """Alembic öncesinden kalma, damgalanmamış bir veritabanı mı?"""
    inspector = inspect(engine)
    names = set(inspector.get_table_names())

    if "alembic_version" in names:
        # Damga tablosu var; içi boşsa yine damgalanmamış sayılır.
        with engine.connect() as connection:
            stamped = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).first()
        if stamped is not None:
            return False

    return any(table in names for table in LEGACY_TABLES)


def missing_tables(engine: Engine) -> List[str]:
    """ORM'in tanımladığı tablolardan veritabanında bulunmayanları döndürür."""
    present = set(inspect(engine).get_table_names())
    return sorted(name for name in Base.metadata.tables if name not in present)


def ensure_schema(database_url: Optional[str] = None) -> None:
    """Veritabanı şemasını göçlerle güncel hâle getirir.

    Args:
        database_url: Bağlantı adresi. Verilmezse `DATABASE_URL` okunur.

    Raises:
        Exception: Göç çalıştırılamazsa. Hata bilinçli olarak yutulmaz —
            yarım şemayla açılan bir uygulama, hiç açılmayan bir uygulamadan
            daha kötüdür: kullanıcı verisini kaydettiğini sanıp kaybeder.
    """
    from alembic import command

    url = database_url if database_url is not None else os.environ.get(DATABASE_URL_ENV)
    if not url:
        logger.info(
            "%s tanimli degil; goc calistirilmadi. Depolar bellek modunda "
            "calisacak (yerel gelistirme).",
            DATABASE_URL_ENV,
        )
        return

    normalized = normalize_database_url(url)
    config = _alembic_config(normalized)
    engine = create_engine(normalized, pool_pre_ping=True, future=True)

    try:
        if _is_pre_alembic_database(engine):
            # Alembic oncesi donemden kalma veritabani: baseline'in yeniden
            # yaratmaya calisacagi tablolar zaten var. README'de elle yapilmasi
            # istenen damgalama adimi burada yapilir.
            logger.warning(
                "Alembic oncesinden kalma veritabani bulundu; baseline (%s) "
                "damgalaniyor. Bu adim yalnizca bir kez calisir.",
                BASELINE_REVISION,
            )
            command.stamp(config, BASELINE_REVISION)

        command.upgrade(config, "head")

        # Damga ile gercek semanin uyusmadigi durum: gecmiste `alembic stamp
        # head` calistirilmis olabilir; o zaman `upgrade head` hicbir sey
        # yapmaz ve tablolar eksik kalir. Sessizce gecilirse fabrika modeli
        # yine kaydedilemez, bu yuzden eksikler burada tamamlanir.
        pending = missing_tables(engine)
        if pending:
            logger.warning(
                "Goclerden sonra su tablolar hala eksikti: %s. Alembic damgasi "
                "gercek semayi yansitmiyor; eksik tablolar ORM tanimindan "
                "olusturuluyor.",
                ", ".join(pending),
            )
            Base.metadata.create_all(engine)

        logger.info("Veritabani semasi guncel.")
    finally:
        engine.dispose()


def main() -> int:
    """`python -m simulation_engine.api.schema_bootstrap` girişi."""
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    try:
        ensure_schema()
    except Exception:
        # Cikis kodu sifir disi olur; `Procfile` icindeki `&&` sayesinde
        # uvicorn hic baslamaz ve dagitim gorunur bicimde basarisiz olur.
        logger.exception("Veritabani semasi hazirlanamadi; uygulama baslatilmiyor.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
