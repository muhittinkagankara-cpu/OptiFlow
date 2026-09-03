"""Envanter kalemlerinin saklanması.

Simülasyon sonuçlarından farklı olarak envanter kalemleri **kullanıcının
kurduğu kalıcı veridir**: bir koşumun geçici çıktısı değil, tekrar tekrar
okunup güncellenen bir kayıt. Bu yüzden simülasyon deposundaki 30 günlük
saklama süresi ve FIFO tahliyesi buraya uygulanmaz — kullanıcı silmedikçe
kalem durur.

Yapı, `storage.py` ile bilinçli olarak aynıdır: aynı arayüzü sunan bir bellek
deposu ile bir veritabanı deposu, ve bağlantı kurulamazsa belleğe düşen bir
fabrika fonksiyonu. İki farklı desen kullanmak, aynı sorunun (sunucu yeniden
başlayınca veri kaybı) iki ayrı yerde iki ayrı biçimde çözülmesi demek olurdu.

Bellek moduna düşüş sessiz değildir; envanter kalemleri kullanıcının elle
girdiği veridir ve kaybolması, geçici bir simülasyon sonucunun kaybolmasından
çok daha maliyetlidir.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from sqlalchemy import String, create_engine, delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Mapped, mapped_column, sessionmaker

from simulation_engine.api.storage import (
    Base,
    DATABASE_URL_ENV,
    JSON_TYPE,
    normalize_database_url,
    require_org_id,
)
from simulation_engine.models.schemas import InventoryItem

logger = logging.getLogger(__name__)


class InventoryItemNotFound(KeyError):
    """İstenen envanter kalemi bulunamadı."""


class InventoryItemExists(ValueError):
    """Aynı kimlikte bir kalem zaten var."""


class InventoryRecord(Base):
    """`inventory_items` tablosunun satır eşlemesi.

    Kalemin tüm alanları tek bir JSON sütununda tutulur. Her alanı ayrı sütuna
    açmak, şema her genişlediğinde bir göç (migration) gerektirirdi; bu proje
    göç aracı kullanmıyor ve envanter kalemi üzerinde sorgu da yapılmıyor —
    tüm kalemler her zaman topluca okunuyor.
    """

    __tablename__ = "inventory_items"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    org_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON_TYPE)


class InMemoryInventoryStore:
    """Süreç belleğinde tutulan envanter deposu.

    Sunucu yeniden başladığında içerik kaybolur. Yerel geliştirme ve
    `DATABASE_URL` tanımlı olmayan kurulumlar için kullanılır.

    Her kalem, sahibi organizasyonun kimliğiyle birlikte tutulur
    (`_org_of: Dict[item_id, org_id]`). Ayrı bir sözlük kullanılması bilinçlidir:
    `InventoryItem` şeması `org_id` taşımaz — kiracılık bir depolama katmanı
    kaygısıdır, iş nesnesinin bir parçası değildir (Faz 1'deki `factory_id` /
    `factory_version_id` ayrımıyla aynı ilke).
    """

    def __init__(self) -> None:
        self._items: Dict[str, InventoryItem] = {}
        self._org_of: Dict[str, str] = {}

    def add(self, org_id: str, item: InventoryItem) -> InventoryItem:
        require_org_id(org_id)
        if item.id in self._items:
            raise InventoryItemExists(item.id)
        self._items[item.id] = item
        self._org_of[item.id] = org_id
        return item

    def list(self, org_id: str) -> List[InventoryItem]:
        require_org_id(org_id)
        # Ad sırası kullanıcının aradığını bulmasını kolaylaştırır; ekleme sırası
        # birkaç kalemden sonra anlamsızlaşır.
        items = [
            item
            for item_id, item in self._items.items()
            if self._org_of.get(item_id) == org_id
        ]
        return sorted(items, key=lambda item: item.name.casefold())

    def get(self, org_id: str, item_id: str) -> InventoryItem:
        require_org_id(org_id)
        if self._org_of.get(item_id) != org_id:
            # Baska bir organizasyonun kalemi de "bulunamadi" sayilir; 403
            # yerine 404, kimlik denemeleriyle varligin bile sizmasini engeller.
            raise InventoryItemNotFound(item_id)
        try:
            return self._items[item_id]
        except KeyError as error:
            raise InventoryItemNotFound(item_id) from error

    def update(self, org_id: str, item_id: str, item: InventoryItem) -> InventoryItem:
        require_org_id(org_id)
        if self._org_of.get(item_id) != org_id:
            raise InventoryItemNotFound(item_id)
        # Kimlik gövdeden değil yoldan alınır; aksi hâlde bir güncelleme isteği
        # sessizce yeni bir kalem oluşturabilirdi.
        stored = item.model_copy(update={"id": item_id})
        self._items[item_id] = stored
        return stored

    def delete(self, org_id: str, item_id: str) -> None:
        require_org_id(org_id)
        if self._org_of.get(item_id) != org_id:
            raise InventoryItemNotFound(item_id)
        self._items.pop(item_id, None)
        self._org_of.pop(item_id, None)

    def clear(self) -> None:
        self._items.clear()
        self._org_of.clear()

    def dispose(self) -> None:
        """Bellek deposunda kapatılacak bir kaynak yoktur."""

    def __len__(self) -> int:
        return len(self._items)


class DatabaseInventoryStore:
    """Envanter kalemlerini ilişkisel veritabanında saklar."""

    def __init__(self, database_url: str, *, create_tables: bool = True) -> None:
        self._engine = create_engine(
            normalize_database_url(database_url), pool_pre_ping=True, future=True
        )
        if create_tables:
            Base.metadata.create_all(self._engine, tables=[InventoryRecord.__table__])
        self._session_factory = sessionmaker(bind=self._engine, future=True)

    def add(self, org_id: str, item: InventoryItem) -> InventoryItem:
        require_org_id(org_id)
        with self._session_factory() as session:
            if session.get(InventoryRecord, item.id) is not None:
                raise InventoryItemExists(item.id)
            session.add(
                InventoryRecord(id=item.id, org_id=org_id, payload=item.model_dump())
            )
            session.commit()
        return item

    def list(self, org_id: str) -> List[InventoryItem]:
        require_org_id(org_id)
        with self._session_factory() as session:
            rows = (
                session.execute(
                    select(InventoryRecord).where(InventoryRecord.org_id == org_id)
                )
                .scalars()
                .all()
            )
        items = [InventoryItem.model_validate(row.payload) for row in rows]
        return sorted(items, key=lambda item: item.name.casefold())

    def get(self, org_id: str, item_id: str) -> InventoryItem:
        require_org_id(org_id)
        with self._session_factory() as session:
            row = session.get(InventoryRecord, item_id)
        if row is None or row.org_id != org_id:
            raise InventoryItemNotFound(item_id)
        return InventoryItem.model_validate(row.payload)

    def update(self, org_id: str, item_id: str, item: InventoryItem) -> InventoryItem:
        require_org_id(org_id)
        stored = item.model_copy(update={"id": item_id})
        with self._session_factory() as session:
            row = session.get(InventoryRecord, item_id)
            if row is None or row.org_id != org_id:
                raise InventoryItemNotFound(item_id)
            row.payload = stored.model_dump()
            session.commit()
        return stored

    def delete(self, org_id: str, item_id: str) -> None:
        require_org_id(org_id)
        with self._session_factory() as session:
            row = session.get(InventoryRecord, item_id)
            if row is None or row.org_id != org_id:
                raise InventoryItemNotFound(item_id)
            session.delete(row)
            session.commit()

    def clear(self) -> None:
        with self._session_factory() as session:
            session.execute(delete(InventoryRecord))
            session.commit()

    def dispose(self) -> None:
        """Bağlantı havuzunu kapatır.

        Windows'ta açık bir havuz, testlerin kullandığı geçici veritabanı
        dosyasını kilitli tutar ve temizlik başarısız olur.
        """
        self._engine.dispose()

    def __len__(self) -> int:
        with self._session_factory() as session:
            return len(session.execute(select(InventoryRecord.id)).scalars().all())


def create_inventory_store(
    database_url: Optional[str] = None,
) -> "InMemoryInventoryStore | DatabaseInventoryStore":
    """Ortama göre uygun envanter deposunu oluşturur.

    `DATABASE_URL` tanımlıysa veritabanı denenir; bağlantı kurulamazsa bellek
    deposuna düşülür. Düşüş açıkça günlüğe yazılır: envanter kalemleri
    kullanıcının elle girdiği veridir ve sessizce kaybolmaları, geçici bir
    simülasyon sonucunun kaybolmasından çok daha maliyetlidir.
    """
    url = database_url if database_url is not None else os.environ.get(DATABASE_URL_ENV)
    if not url:
        logger.info(
            "%s tanimli degil; envanter kalemleri bellekte tutulacak ve sunucu "
            "yeniden baslatildiginda kaybolacak.",
            DATABASE_URL_ENV,
        )
        return InMemoryInventoryStore()

    try:
        store = DatabaseInventoryStore(url)
    except (SQLAlchemyError, ValueError, OSError) as error:
        logger.warning(
            "Envanter icin veritabanina baglanilamadi (%s); bellek moduna gecildi. "
            "Girilen kalemler sunucu yeniden baslatildiginda kaybolacak.",
            error,
        )
        return InMemoryInventoryStore()

    logger.info("Envanter kalemleri veritabaninda saklanacak.")
    return store
