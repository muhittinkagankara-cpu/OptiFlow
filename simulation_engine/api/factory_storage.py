"""Fabrika modellerinin kalıcı olarak saklanması ve sürümlenmesi.

Neden gerekli
-------------
Fabrika modeli bugüne kadar yalnızca tarayıcının belleğinde yaşıyordu: sayfa
yenilendiğinde kullanıcının kurduğu hat kayboluyordu. Simülasyon sonuçları ve
envanter kalemleri kalıcıyken modelin kendisinin geçici olması, tüm ürünün
üzerine kurulacağı nesnenin en kırılgan parça olması demekti.

Sürümleme neden var
-------------------
Bir simülasyon sonucunun hangi modelden üretildiği kesin olmalıdır. Fabrika
yerinde güncellenseydi, üç hafta önce alınmış bir sonucun hangi tampon
boyutlarıyla üretildiği sonradan bilinemezdi. Bu yüzden sürümler **değişmezdir**
(immutable): model değiştiğinde yenisi oluşur, eskisi olduğu gibi kalır.

Sürüm enflasyonu nasıl engellenir
---------------------------------
Her "Kaydet" yeni sürüm üretseydi, kullanıcının arka arkaya üç kez kaydetmesi
üç özdeş sürüm bırakırdı ve geçmiş okunamaz hâle gelirdi. Bunun yerine
`config` ve `layout` üzerinden bir SHA-256 özeti hesaplanır
(`compute_snapshot_hash`). Özet güncel sürümünkiyle aynıysa yeni sürüm
oluşturulmaz, var olan sürüm geri döndürülür. Yani sürüm sayısı, kaydetme
sayısına değil **gerçek değişiklik sayısına** eşittir.

Yapı
----
Alan mantığı (sürüm numaralandırma, özet karşılaştırma, güncel sürüm
işaretçisi) `FactoryStoreBase` içinde **bir kez** yazılır; bellek ve veritabanı
depoları yalnızca ilkel okuma/yazma işlemlerini sağlar. Envanter ve simülasyon
depolarında olduğu gibi iki tam uygulama yazılsaydı, iki deponun sürümleme
davranışı zamanla sessizce ayrışabilirdi — ve testlerin çoğu bellek deposunda
koştuğu için bu ayrışma yayına çıkana kadar fark edilmezdi.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    create_engine,
    delete,
    func,
    select,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Mapped, mapped_column, sessionmaker

from simulation_engine.api.storage import (
    DATABASE_URL_ENV,
    JSON_TYPE,
    Base,
    normalize_database_url,
)
from simulation_engine.models.schemas import (
    Factory,
    FactoryCreateRequest,
    FactoryDetail,
    FactoryLayout,
    FactorySaveRequest,
    FactoryVersion,
    FactoryVersionSummary,
    SimulationConfig,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Hatalar
# --------------------------------------------------------------------------- #


class FactoryNotFound(KeyError):
    """İstenen fabrika bulunamadı."""


class FactoryVersionNotFound(KeyError):
    """İstenen fabrika sürümü bulunamadı."""


class FactoryHasNoVersion(ValueError):
    """Fabrikanın henüz kaydedilmiş bir modeli yok."""


# --------------------------------------------------------------------------- #
# Anlık görüntü özeti
# --------------------------------------------------------------------------- #


def compute_snapshot_hash(
    config: SimulationConfig, layout: Optional[FactoryLayout]
) -> str:
    """`config` ve `layout` üzerinden yinelenebilir bir SHA-256 özeti üretir.

    Özet iki koşulu sağlamalıdır. Aynı model iki kez kaydedildiğinde **aynı**
    özeti vermelidir; aksi hâlde sürüm enflasyonunu engelleyemezdik. Modelde
    herhangi bir şey değiştiğinde **farklı** bir özet vermelidir; aksi hâlde
    gerçek bir değişiklik sessizce kaybolurdu.

    Bunun için sözlükler anahtar sırasına göre sıralanır: Python'un sözlük
    sırası ekleme sırasını korur ve aynı model farklı yollardan kurulduğunda
    alanlar farklı sırada gelebilir. `mode="json"` ile dökülmesi de bilinçlidir;
    aksi hâlde `datetime` gibi tipler `repr` biçimlerine göre özetlenirdi.

    Yerleşimin özete dâhil edilmesi kasıtlıdır: kullanıcı yalnızca kutuları
    taşıyıp kaydettiğinde bu da bir değişikliktir ve saklanmalıdır. Sürüm bir
    bütünün anlık görüntüsüdür; yarısı sürümlenip yarısı yerinde güncellenseydi
    "sürüm 3'ü aç" demek belirsiz bir istek olurdu.

    Args:
        config: Doğrulanmış simülasyon modeli.
        layout: Editör yerleşimi; yoksa `None`.

    Returns:
        64 karakterlik onaltılık SHA-256 özeti.
    """
    payload: Dict[str, Any] = {
        "config": config.model_dump(mode="json"),
        "layout": layout.model_dump(mode="json") if layout is not None else None,
    }
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def new_factory_id() -> str:
    """Yeni bir fabrika ya da sürüm kimliği üretir."""
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


def summarize_version(version: FactoryVersion) -> FactoryVersionSummary:
    """Sürümü, `config` taşımayan listeleme özetine indirger."""
    return FactoryVersionSummary(
        id=version.id,
        version_number=version.version_number,
        snapshot_hash=version.snapshot_hash,
        station_count=len(version.config.stations),
        note=version.note,
        created_at=version.created_at,
    )


# --------------------------------------------------------------------------- #
# Alan mantığı
# --------------------------------------------------------------------------- #


class FactoryStoreBase:
    """Fabrika deposunun alan mantığı; saklama biçiminden bağımsızdır.

    Alt sınıflar yalnızca alt çizgiyle başlayan ilkel işlemleri uygular. Sürüm
    numaralandırma, özet karşılaştırma ve güncel sürüm işaretçisinin
    güncellenmesi burada tek bir yerde yazılıdır.
    """

    # -- Alt sınıfların uygulaması gereken ilkel işlemler ------------------- #

    def _read_factory(self, factory_id: str) -> Optional[Factory]:
        raise NotImplementedError

    def _write_factory(self, factory: Factory) -> None:
        raise NotImplementedError

    def _remove_factory(self, factory_id: str) -> None:
        """Fabrikayı ve ona ait tüm sürümleri siler."""
        raise NotImplementedError

    def _read_all_factories(self) -> List[Factory]:
        raise NotImplementedError

    def _read_version(self, version_id: str) -> Optional[FactoryVersion]:
        raise NotImplementedError

    def _write_version(self, version: FactoryVersion) -> None:
        raise NotImplementedError

    def _read_versions_of(self, factory_id: str) -> List[FactoryVersion]:
        """Sürümleri numara sırasına göre döndürür."""
        raise NotImplementedError

    def _count_versions(self, factory_id: str) -> int:
        raise NotImplementedError

    # -- Genel arayüz ------------------------------------------------------ #

    def create(self, request: FactoryCreateRequest) -> FactoryDetail:
        """Yeni bir fabrika oluşturur; model verilmişse ilk sürümü de yazar."""
        now = _now()
        factory = Factory(
            id=new_factory_id(),
            org_id=None,
            name=request.name.strip(),
            sector=request.sector,
            current_version_id=None,
            version_count=0,
            created_at=now,
            updated_at=now,
        )
        self._write_factory(factory)

        if request.config is None:
            return FactoryDetail(factory=factory, current_version=None)

        version = self._append_version(
            factory, request.config, request.layout, request.note, now
        )
        factory = self._point_at(factory, version, now)
        return FactoryDetail(factory=factory, current_version=version)

    def list(self) -> List[Factory]:
        """Fabrikaları en son güncellenen başta olmak üzere döndürür.

        Sıralama ada göre değil güncellenme zamanına göredir: kullanıcı
        neredeyse her zaman en son üzerinde çalıştığı fabrikayı açmak ister.
        """
        factories = self._read_all_factories()
        return sorted(factories, key=lambda item: item.updated_at, reverse=True)

    def get(self, factory_id: str) -> FactoryDetail:
        """Fabrikayı ve güncel sürümünü döndürür.

        Raises:
            FactoryNotFound: Fabrika yoksa.
        """
        factory = self._require_factory(factory_id)
        current: Optional[FactoryVersion] = None
        if factory.current_version_id is not None:
            current = self._read_version(factory.current_version_id)
        return FactoryDetail(factory=factory, current_version=current)

    def save(self, factory_id: str, request: FactorySaveRequest) -> FactoryDetail:
        """Fabrikayı günceller; model değiştiyse yeni bir sürüm oluşturur.

        Özet güncel sürümünkiyle aynıysa **yeni sürüm oluşturulmaz**. Bu,
        kullanıcının aynı modeli iki kez kaydetmesinin geçmişte iz bırakmaması
        demektir; "Kaydet" düğmesine yanlışlıkla iki kez basmak bir sürüm
        yaratmamalıdır.

        Raises:
            FactoryNotFound: Fabrika yoksa.
        """
        factory = self._require_factory(factory_id)
        now = _now()
        changed = False

        if request.name is not None and request.name.strip() != factory.name:
            factory = factory.model_copy(update={"name": request.name.strip()})
            changed = True
        if request.sector is not None and request.sector != factory.sector:
            factory = factory.model_copy(update={"sector": request.sector})
            changed = True

        current = (
            self._read_version(factory.current_version_id)
            if factory.current_version_id is not None
            else None
        )

        if request.config is not None:
            incoming = compute_snapshot_hash(request.config, request.layout)
            if current is not None and current.snapshot_hash == incoming:
                # İçerik aynı: sürüm yaratılmaz. Fabrikanın `updated_at` alanı da
                # değiştirilmez, çünkü hiçbir şey değişmedi ve listedeki sırayı
                # oynatmak kullanıcıya yanlış biçimde "kaydedildi" izlenimi verirdi.
                if changed:
                    factory = factory.model_copy(update={"updated_at": now})
                    self._write_factory(factory)
                return FactoryDetail(factory=factory, current_version=current)

            version = self._append_version(
                factory, request.config, request.layout, request.note, now
            )
            factory = self._point_at(factory, version, now)
            return FactoryDetail(factory=factory, current_version=version)

        if changed:
            factory = factory.model_copy(update={"updated_at": now})
            self._write_factory(factory)
        return FactoryDetail(factory=factory, current_version=current)

    def delete(self, factory_id: str) -> None:
        """Fabrikayı ve tüm sürümlerini siler.

        Bu fabrikadan üretilmiş simülasyon kayıtları **silinmez**. Kayıtlardaki
        `factory_id` ve `factory_version_id` alanları artık var olmayan bir
        fabrikayı gösterir; bu bilinçlidir, çünkü koşumun kendisi hâlâ geçerli
        bir ölçümdür ve fabrikanın silinmesi geçmişi yeniden yazmamalıdır.

        Raises:
            FactoryNotFound: Fabrika yoksa.
        """
        self._require_factory(factory_id)
        self._remove_factory(factory_id)

    def list_versions(self, factory_id: str) -> List[FactoryVersionSummary]:
        """Sürüm geçmişini en yeniden en eskiye döndürür.

        Raises:
            FactoryNotFound: Fabrika yoksa.
        """
        self._require_factory(factory_id)
        versions = self._read_versions_of(factory_id)
        return [summarize_version(item) for item in reversed(versions)]

    def get_version(self, factory_id: str, version_id: str) -> FactoryVersion:
        """Belirli bir sürümü tam olarak döndürür.

        Raises:
            FactoryNotFound: Fabrika yoksa.
            FactoryVersionNotFound: Sürüm yoksa ya da başka bir fabrikaya aitse.
        """
        self._require_factory(factory_id)
        version = self._read_version(version_id)
        if version is None or version.factory_id != factory_id:
            # Başka bir fabrikanın sürümü de "bulunamadı" sayılır: aksi hâlde
            # kimlik denemeleriyle başka bir fabrikanın modeli okunabilirdi.
            raise FactoryVersionNotFound(version_id)
        return version

    def current_version(self, factory_id: str) -> FactoryVersion:
        """Fabrikanın güncel sürümünü döndürür.

        Raises:
            FactoryNotFound: Fabrika yoksa.
            FactoryHasNoVersion: Fabrikanın henüz kaydedilmiş modeli yoksa.
        """
        factory = self._require_factory(factory_id)
        if factory.current_version_id is None:
            raise FactoryHasNoVersion(factory_id)
        version = self._read_version(factory.current_version_id)
        if version is None:
            raise FactoryHasNoVersion(factory_id)
        return version

    # -- Yardımcılar ------------------------------------------------------- #

    def _require_factory(self, factory_id: str) -> Factory:
        factory = self._read_factory(factory_id)
        if factory is None:
            raise FactoryNotFound(factory_id)
        return factory

    def _append_version(
        self,
        factory: Factory,
        config: SimulationConfig,
        layout: Optional[FactoryLayout],
        note: Optional[str],
        now: datetime,
    ) -> FactoryVersion:
        """Yeni bir sürüm yazar ve döndürür."""
        version = FactoryVersion(
            id=new_factory_id(),
            factory_id=factory.id,
            version_number=self._count_versions(factory.id) + 1,
            snapshot_hash=compute_snapshot_hash(config, layout),
            config=config,
            layout=layout,
            note=note,
            created_at=now,
        )
        self._write_version(version)
        return version

    def _point_at(
        self, factory: Factory, version: FactoryVersion, now: datetime
    ) -> Factory:
        """Fabrikanın güncel sürüm işaretçisini günceller."""
        updated = factory.model_copy(
            update={
                "current_version_id": version.id,
                "version_count": version.version_number,
                "updated_at": now,
            }
        )
        self._write_factory(updated)
        return updated


# --------------------------------------------------------------------------- #
# Bellek deposu
# --------------------------------------------------------------------------- #


class InMemoryFactoryStore(FactoryStoreBase):
    """Süreç belleğinde tutulan fabrika deposu.

    Sunucu yeniden başladığında içerik kaybolur; `DATABASE_URL` tanımlı olmayan
    yerel geliştirme kurulumları için kullanılır.
    """

    def __init__(self) -> None:
        self._factories: Dict[str, Factory] = {}
        self._versions: Dict[str, FactoryVersion] = {}

    def _read_factory(self, factory_id: str) -> Optional[Factory]:
        return self._factories.get(factory_id)

    def _write_factory(self, factory: Factory) -> None:
        self._factories[factory.id] = factory

    def _remove_factory(self, factory_id: str) -> None:
        self._factories.pop(factory_id, None)
        for version_id in [
            key
            for key, value in self._versions.items()
            if value.factory_id == factory_id
        ]:
            del self._versions[version_id]

    def _read_all_factories(self) -> List[Factory]:
        return list(self._factories.values())

    def _read_version(self, version_id: str) -> Optional[FactoryVersion]:
        return self._versions.get(version_id)

    def _write_version(self, version: FactoryVersion) -> None:
        self._versions[version.id] = version

    def _read_versions_of(self, factory_id: str) -> List[FactoryVersion]:
        found = [
            item for item in self._versions.values() if item.factory_id == factory_id
        ]
        return sorted(found, key=lambda item: item.version_number)

    def _count_versions(self, factory_id: str) -> int:
        return sum(
            1 for item in self._versions.values() if item.factory_id == factory_id
        )

    def clear(self) -> None:
        """Depoyu boşaltır (testler için)."""
        self._factories.clear()
        self._versions.clear()

    def dispose(self) -> None:
        """Bellek deposunda kapatılacak bir kaynak yoktur."""

    def __len__(self) -> int:
        return len(self._factories)


# --------------------------------------------------------------------------- #
# Veritabanı tabloları
# --------------------------------------------------------------------------- #


class FactoryRecord(Base):
    """`factories` tablosunun satır eşlemesi.

    `org_id` Faz 1'de her zaman boştur. Şimdiden açılması bilinçlidir: çok
    kiracılı desteğe geçildiğinde sütunu canlı veri üzerinde eklemek, boş
    bırakılmış bir sütunu doldurmaktan çok daha riskli bir işlemdir.
    """

    __tablename__ = "factories"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    org_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    sector: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    current_version_id: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class FactoryVersionRecord(Base):
    """`factory_versions` tablosunun satır eşlemesi.

    `config` ve `layout` ayrı JSON sütunlarında tutulur. İstasyonları ilişkisel
    tablolara açmak, `SimulationConfig` şemasının ikinci bir yerde daha
    tanımlanması ve her alan eklendiğinde bir göç gerekmesi demekti; oysa şema
    zaten `models/schemas.py` içinde tek ve doğrulanmış hâlde duruyor.

    `snapshot_hash` sütunu indekslidir: kaydetme sırasında yapılan "bu içerik
    zaten var mı" karşılaştırması bu sütun üzerinden yapılır.
    """

    __tablename__ = "factory_versions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), index=True
    )
    version_number: Mapped[int] = mapped_column(Integer)
    snapshot_hash: Mapped[str] = mapped_column(String(64), index=True)
    config: Mapped[Dict[str, Any]] = mapped_column(JSON_TYPE)
    layout: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON_TYPE, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


def _factory_from_row(row: FactoryRecord, version_count: int) -> Factory:
    return Factory(
        id=row.id,
        org_id=row.org_id,
        name=row.name,
        sector=row.sector,
        current_version_id=row.current_version_id,
        version_count=version_count,
        created_at=_as_utc(row.created_at),
        updated_at=_as_utc(row.updated_at),
    )


def _version_from_row(row: FactoryVersionRecord) -> FactoryVersion:
    return FactoryVersion(
        id=row.id,
        factory_id=row.factory_id,
        version_number=row.version_number,
        snapshot_hash=row.snapshot_hash,
        config=SimulationConfig.model_validate(row.config),
        layout=FactoryLayout.model_validate(row.layout) if row.layout else None,
        note=row.note,
        created_at=_as_utc(row.created_at),
    )


def _as_utc(value: datetime) -> datetime:
    """Saat dilimi bilgisi olmayan zaman damgalarını UTC sayar.

    SQLite `DateTime(timezone=True)` sütunlarını saat dilimi bilgisi olmadan
    geri verir; PostgreSQL vermez. Karşılaştırmaların iki veritabanında da aynı
    davranması için dönüşüm tek yerde yapılır — aksi hâlde testler SQLite'ta
    geçip yayında "can't compare offset-naive and offset-aware datetimes"
    hatasıyla düşerdi.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


# --------------------------------------------------------------------------- #
# Veritabanı deposu
# --------------------------------------------------------------------------- #


class DatabaseFactoryStore(FactoryStoreBase):
    """Fabrikaları ilişkisel bir veritabanında saklar.

    Tablolar burada **oluşturulmaz**: şema Alembic ile yönetilir ve dağıtımda
    `alembic upgrade head` çalıştırılır. Uygulama açılışında `create_all`
    çağırmak, göç aracının varlığını anlamsız kılar ve iki farklı şema
    kaynağının sessizce ayrışmasına yol açardı. Testler tabloları kendileri
    oluşturur (`create_tables=True`).
    """

    def __init__(self, database_url: str, *, create_tables: bool = False) -> None:
        self._engine = create_engine(
            normalize_database_url(database_url), pool_pre_ping=True, future=True
        )
        if create_tables:
            Base.metadata.create_all(
                self._engine,
                tables=[FactoryRecord.__table__, FactoryVersionRecord.__table__],
            )
        self._session_factory = sessionmaker(bind=self._engine, future=True)

    def _read_factory(self, factory_id: str) -> Optional[Factory]:
        with self._session_factory() as session:
            row = session.get(FactoryRecord, factory_id)
            if row is None:
                return None
            return _factory_from_row(row, self._count_in(session, factory_id))

    def _write_factory(self, factory: Factory) -> None:
        with self._session_factory() as session:
            session.merge(
                FactoryRecord(
                    id=factory.id,
                    org_id=factory.org_id,
                    name=factory.name,
                    sector=factory.sector,
                    current_version_id=factory.current_version_id,
                    created_at=factory.created_at,
                    updated_at=factory.updated_at,
                )
            )
            session.commit()

    def _remove_factory(self, factory_id: str) -> None:
        # Sürümler açıkça silinir: SQLite yabancı anahtar kısıtlarını varsayılan
        # olarak zorlamaz, dolayısıyla ON DELETE CASCADE'e güvenmek testlerde
        # ve yayında farklı davranırdı.
        with self._session_factory() as session:
            session.execute(
                delete(FactoryVersionRecord).where(
                    FactoryVersionRecord.factory_id == factory_id
                )
            )
            session.execute(
                delete(FactoryRecord).where(FactoryRecord.id == factory_id)
            )
            session.commit()

    def _read_all_factories(self) -> List[Factory]:
        with self._session_factory() as session:
            rows = session.execute(select(FactoryRecord)).scalars().all()
            counts = dict(
                session.execute(
                    select(
                        FactoryVersionRecord.factory_id,
                        func.count(FactoryVersionRecord.id),
                    ).group_by(FactoryVersionRecord.factory_id)
                ).all()
            )
            return [_factory_from_row(row, counts.get(row.id, 0)) for row in rows]

    def _read_version(self, version_id: str) -> Optional[FactoryVersion]:
        with self._session_factory() as session:
            row = session.get(FactoryVersionRecord, version_id)
            return _version_from_row(row) if row is not None else None

    def _write_version(self, version: FactoryVersion) -> None:
        with self._session_factory() as session:
            session.add(
                FactoryVersionRecord(
                    id=version.id,
                    factory_id=version.factory_id,
                    version_number=version.version_number,
                    snapshot_hash=version.snapshot_hash,
                    config=version.config.model_dump(mode="json"),
                    layout=(
                        version.layout.model_dump(mode="json")
                        if version.layout is not None
                        else None
                    ),
                    note=version.note,
                    created_at=version.created_at,
                )
            )
            session.commit()

    def _read_versions_of(self, factory_id: str) -> List[FactoryVersion]:
        with self._session_factory() as session:
            rows = (
                session.execute(
                    select(FactoryVersionRecord)
                    .where(FactoryVersionRecord.factory_id == factory_id)
                    .order_by(FactoryVersionRecord.version_number)
                )
                .scalars()
                .all()
            )
            return [_version_from_row(row) for row in rows]

    def _count_versions(self, factory_id: str) -> int:
        with self._session_factory() as session:
            return self._count_in(session, factory_id)

    @staticmethod
    def _count_in(session: Any, factory_id: str) -> int:
        return int(
            session.execute(
                select(func.count(FactoryVersionRecord.id)).where(
                    FactoryVersionRecord.factory_id == factory_id
                )
            ).scalar_one()
        )

    def clear(self) -> None:
        """Tüm fabrikaları ve sürümleri siler (testler için)."""
        with self._session_factory() as session:
            session.execute(delete(FactoryVersionRecord))
            session.execute(delete(FactoryRecord))
            session.commit()

    def dispose(self) -> None:
        """Bağlantı havuzunu kapatır.

        Windows'ta açık bir havuz, testlerin kullandığı geçici veritabanı
        dosyasını kilitli tutar ve temizlik başarısız olur.
        """
        self._engine.dispose()

    def __len__(self) -> int:
        with self._session_factory() as session:
            return len(session.execute(select(FactoryRecord.id)).scalars().all())


# --------------------------------------------------------------------------- #
# Fabrika (factory function)
# --------------------------------------------------------------------------- #


def create_factory_store(
    database_url: Optional[str] = None,
) -> "InMemoryFactoryStore | DatabaseFactoryStore":
    """Ortama göre uygun fabrika deposunu oluşturur.

    `DATABASE_URL` tanımlıysa veritabanı denenir; bağlantı kurulamazsa bellek
    deposuna düşülür. Düşüş açıkça günlüğe yazılır: fabrika modeli kullanıcının
    saatlerce üzerinde çalıştığı veridir ve sessizce kaybolması, geçici bir
    simülasyon sonucunun kaybolmasından kıyaslanamayacak kadar maliyetlidir.
    """
    url = database_url if database_url is not None else os.environ.get(DATABASE_URL_ENV)
    if not url:
        logger.info(
            "%s tanimli degil; fabrika modelleri bellekte tutulacak ve sunucu "
            "yeniden baslatildiginda kaybolacak.",
            DATABASE_URL_ENV,
        )
        return InMemoryFactoryStore()

    try:
        store = DatabaseFactoryStore(url)
    except (SQLAlchemyError, ValueError, OSError) as error:
        logger.warning(
            "Fabrikalar icin veritabanina baglanilamadi (%s); bellek moduna "
            "gecildi. Kaydedilen modeller sunucu yeniden baslatildiginda "
            "kaybolacak.",
            error,
        )
        return InMemoryFactoryStore()

    logger.info("Fabrika modelleri veritabaninda saklanacak.")
    return store
