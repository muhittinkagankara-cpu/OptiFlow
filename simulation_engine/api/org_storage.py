"""Organizasyonların ve üyeliklerin saklanması.

Supabase Auth kullanıcıyı doğrular (parola, oturum, token yenileme); bu
uygulama kullanıcıyı **hiç saklamaz**. Sakladığı tek şey, bir Supabase
kullanıcı kimliğinin (`sub` alanı) hangi organizasyona ait olduğudur. Bu
ayrım bilinçlidir: kimlik doğrulama ve yetkilendirme farklı sorumluluklardır,
ve bu proje yalnızca ikincisinden sorumludur.

Kendiliğinden organizasyon oluşturma
-------------------------------------
Bir kullanıcı ilk kez doğrulanmış bir isteği attığında ve henüz bir üyeliği
yoksa, kendisi için yeni bir organizasyon **otomatik olarak** kurulur
(`get_or_create_org_for_user`). Ayrı bir "kaydı tamamla" adımı yoktur: giriş
akışını iki adıma bölmek, bir SaaS'ın en çok terk edilen anı olan "hesabınız
oluşturuldu, şimdi de organizasyon kurun" ekranını eklemek olurdu. Kullanıcı
"belongs to one organization" kuralı gereği yalnızca bir organizasyona ait
olabilir; bu, üyelik tablosunda kullanıcı kimliğinin birincil anahtar olarak
kullanılmasıyla veritabanı düzeyinde de zorlanır.

Yapı, diğer depolarla aynı desendedir: bir bellek deposu, bir veritabanı
deposu, ortama göre seçen bir fabrika fonksiyonu.
"""

from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, String, create_engine, delete, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Mapped, mapped_column, sessionmaker

from simulation_engine.api.storage import DATABASE_URL_ENV, Base, normalize_database_url

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Organization:
    """Kullanıcıya gösterilecek en küçük organizasyon bilgisi."""

    id: str
    name: str
    created_at: datetime


def new_org_id() -> str:
    return uuid.uuid4().hex


def default_org_name(email: Optional[str]) -> str:
    """Yeni bir organizasyona verilecek varsayılan ad.

    E-postanın `@` öncesi kısmından türetilir; kullanıcı sonradan
    değiştirebilir (fabrika adı gibi, Faz 2 kapsamında yeniden adlandırma
    ucu yoktur ama alan veritabanında serbestçe güncellenebilir bir metindir).
    E-posta yoksa (yalnızca telefonla kayıt) jenerik bir ad kullanılır.
    """
    if email and "@" in email:
        return f"{email.split('@', 1)[0]} Organizasyonu"
    return "Yeni Organizasyon"


# --------------------------------------------------------------------------- #
# Bellek deposu
# --------------------------------------------------------------------------- #


class InMemoryOrgStore:
    """Süreç belleğinde tutulan organizasyon/üyelik deposu."""

    def __init__(self) -> None:
        self._orgs: dict[str, Organization] = {}
        self._membership: dict[str, str] = {}  # user_id -> org_id

    def get_org_id_for_user(self, user_id: str) -> Optional[str]:
        return self._membership.get(user_id)

    def get_org(self, org_id: str) -> Optional[Organization]:
        return self._orgs.get(org_id)

    def get_or_create_org_for_user(
        self, user_id: str, email: Optional[str]
    ) -> Organization:
        """Kullanıcının organizasyonunu döndürür; yoksa kurar.

        Bellek deposunda yarış koşulu (aynı kullanıcı için iki eşzamanlı ilk
        istek) pratikte önemsizdir: tek süreçli geliştirme ortamı için
        kullanılır, GIL tek bir sözlük yazımını böler.
        """
        org_id = self._membership.get(user_id)
        if org_id is not None:
            org = self._orgs.get(org_id)
            if org is not None:
                return org

        org = Organization(
            id=new_org_id(),
            name=default_org_name(email),
            created_at=datetime.now(timezone.utc),
        )
        self._orgs[org.id] = org
        self._membership[user_id] = org.id
        return org

    def clear(self) -> None:
        """Depoyu boşaltır (testler için)."""
        self._orgs.clear()
        self._membership.clear()

    def dispose(self) -> None:
        """Bellek deposunda kapatılacak bir kaynak yoktur."""


# --------------------------------------------------------------------------- #
# Veritabanı tabloları
# --------------------------------------------------------------------------- #


class OrganizationRecord(Base):
    """`organizations` tablosunun satır eşlemesi."""

    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MembershipRecord(Base):
    """`memberships` tablosunun satır eşlemesi.

    Birincil anahtarın `user_id` olması "bir kullanıcı yalnızca bir
    organizasyona aittir" kuralını veritabanı düzeyinde zorlar: aynı
    kullanıcı için ikinci bir satır eklemek birincil anahtar ihlaline
    çarpar, uygulama kodunun bunu ayrıca denetlemesi gerekmez.
    """

    __tablename__ = "memberships"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


def _as_utc(value: datetime) -> datetime:
    """SQLite'ın saat dilimsiz döndürdüğü zaman damgalarını UTC sayar."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


# --------------------------------------------------------------------------- #
# Veritabanı deposu
# --------------------------------------------------------------------------- #


class DatabaseOrgStore:
    """Organizasyon ve üyelikleri ilişkisel bir veritabanında saklar.

    Tablolar burada oluşturulmaz — şema Alembic ile yönetilir (bkz.
    `factory_storage.DatabaseFactoryStore` üzerindeki aynı not). Testler
    `create_tables=True` ile kendi geçici şemasını kurar.
    """

    def __init__(self, database_url: str, *, create_tables: bool = False) -> None:
        self._engine = create_engine(
            normalize_database_url(database_url), pool_pre_ping=True, future=True
        )
        if create_tables:
            Base.metadata.create_all(
                self._engine,
                tables=[OrganizationRecord.__table__, MembershipRecord.__table__],
            )
        self._session_factory = sessionmaker(bind=self._engine, future=True)

    def get_org_id_for_user(self, user_id: str) -> Optional[str]:
        with self._session_factory() as session:
            row = session.get(MembershipRecord, user_id)
            return row.org_id if row is not None else None

    def get_org(self, org_id: str) -> Optional[Organization]:
        with self._session_factory() as session:
            row = session.get(OrganizationRecord, org_id)
            if row is None:
                return None
            return Organization(id=row.id, name=row.name, created_at=_as_utc(row.created_at))

    def get_or_create_org_for_user(
        self, user_id: str, email: Optional[str]
    ) -> Organization:
        """Kullanıcının organizasyonunu döndürür; yoksa kurar.

        Eşzamanlı iki ilk istek arasındaki yarışı ele almak için: önce okunur,
        yoksa yazılır; yazma birincil anahtar ihlaliyle başarısız olursa
        (başka bir istek araya girdiyse) hata yutulur ve satır yeniden okunur.
        Bu, ikinci organizasyonun sessizce oluşup üyeliğin ilkine mi ikincisine
        mi bağlı kalacağı belirsizliğini ortadan kaldırır: kazanan her zaman
        veritabanına önce yazılandır.
        """
        existing = self.get_org_id_for_user(user_id)
        if existing is not None:
            org = self.get_org(existing)
            if org is not None:
                return org

        org = Organization(
            id=new_org_id(),
            name=default_org_name(email),
            created_at=datetime.now(timezone.utc),
        )
        try:
            with self._session_factory.begin() as session:
                session.add(
                    OrganizationRecord(
                        id=org.id, name=org.name, created_at=org.created_at
                    )
                )
                session.add(
                    MembershipRecord(
                        user_id=user_id, org_id=org.id, created_at=org.created_at
                    )
                )
            return org
        except IntegrityError:
            # Baska bir istek araya girip ayni kullanici icin uyelik yazdi.
            existing = self.get_org_id_for_user(user_id)
            if existing is None:
                raise
            resolved = self.get_org(existing)
            assert resolved is not None
            return resolved

    def clear(self) -> None:
        """Tüm organizasyon ve üyelikleri siler (testler için)."""
        with self._session_factory.begin() as session:
            session.execute(delete(MembershipRecord))
            session.execute(delete(OrganizationRecord))

    def dispose(self) -> None:
        """Bağlantı havuzunu kapatır."""
        self._engine.dispose()


# --------------------------------------------------------------------------- #
# Fabrika
# --------------------------------------------------------------------------- #


def create_org_store(
    database_url: Optional[str] = None,
) -> "InMemoryOrgStore | DatabaseOrgStore":
    """Ortama göre uygun organizasyon deposunu oluşturur."""
    url = database_url if database_url is not None else os.environ.get(DATABASE_URL_ENV)
    if not url:
        logger.info(
            "%s tanimli degil; organizasyonlar bellekte tutulacak ve sunucu "
            "yeniden baslatildiginda kaybolacak.",
            DATABASE_URL_ENV,
        )
        return InMemoryOrgStore()

    try:
        store = DatabaseOrgStore(url)
    except (SQLAlchemyError, ValueError, OSError) as error:
        logger.warning(
            "Organizasyonlar icin veritabanina baglanilamadi (%s); bellek "
            "moduna gecildi.",
            error,
        )
        return InMemoryOrgStore()

    logger.info("Organizasyonlar veritabaninda saklanacak.")
    return store
