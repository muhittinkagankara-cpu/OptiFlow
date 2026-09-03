"""Simülasyon sonuçlarının depolanması — bellek ve veritabanı.

Bu modül iki depo sunar ve **ikisinin arayüzü birebir aynıdır**
(`save`, `get`, `clear`, `__len__`). API katmanı hangi deponun kullanıldığını
bilmez; `create_simulation_store` fabrikası ortama bakarak seçer. Bu ayrım
sayesinde depolama mekanizmasını değiştirmek uç noktalara hiç dokunmadan
mümkün olur.

Neden veritabanı gerekli
------------------------
Sonuçlar süreç belleğinde tutulduğunda, sunucu her yeniden başladığında
kaybolurlar. Yayına alınmış bir demoda bunun somut sonucu şudur: kullanıcı bir
simülasyon çalıştırır, servis uykuya geçip uyanır ve doğrulama raporunu açmak
istediğinde "bu simülasyon bulunamadı" hatası alır. Ayrıca çok işçili bir
dağıtımda (`uvicorn --workers 4`) bir işçinin ürettiği kimlik diğerinden
okunamaz, çünkü her işçinin kendi belleği vardır.

Yerel geliştirmeyi bozmama
--------------------------
`DATABASE_URL` tanımlı değilse ya da bağlantı kurulamıyorsa bellek moduna
**sessizce değil, günlüğe yazarak** geri düşülür. Geliştiricinin makinesinde
PostgreSQL çalıştırmak zorunda kalması, projeye katkı vermenin önündeki
gereksiz bir engel olurdu.

Şema
----
Tek tablo (`simulations`):

===============  ==========  =====================================
sütun            tip         içerik
===============  ==========  =====================================
id               UUID/metin  simülasyon kimliği (birincil anahtar)
created_at       timestamp   kaydın oluşturulma anı (UTC)
config           JSONB       `SimulationConfig`'in tamamı
results          JSONB       replikasyonlar, Monte Carlo özeti,
                             darboğaz analizi ve OEE raporu
status           metin       "completed" veya "failed"
===============  ==========  =====================================

`results` sütununun ham replikasyonları da taşıması bilinçlidir: doğrulama
raporu Little's Law denetimini **her replikasyon üzerinde** yeniden çalıştırır
ve kararlılık bilgisini replikasyonlardan okur. Yalnızca özet saklansaydı,
sunucu yeniden başladıktan sonra doğrulama raporu üretilemezdi.
"""

from __future__ import annotations

import logging
import math
import os
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import JSON, DateTime, String, create_engine, delete, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from simulation_engine.models.schemas import (
    BottleneckAnalysis,
    MonteCarloReport,
    OEEReport,
    ReplicationResult,
    SimulationConfig,
)

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Adlandırılmış sabitler
# --------------------------------------------------------------------------- #

#: Bellek modunda tutulan azami kayıt sayısı (FIFO).
MAX_STORED_SIMULATIONS: int = 200

#: Veritabanı modunda kayıtların saklanma süresi. Bu süreden eski kayıtlar,
#: her yeni kayıt eklendiğinde silinir. Ayrı bir zamanlanmış görev (cron)
#: kurmak yerine ekleme anında temizlemek, çalıştırılması unutulabilecek bir
#: bileşen eklemeden aynı sonucu verir.
RETENTION_DAYS: int = 30

#: Bağlantı bilgisinin okunduğu ortam değişkeni.
DATABASE_URL_ENV: str = "DATABASE_URL"

#: JSON sonsuz sayı taşımaz. Sonsuz değerler, sıralama anlamını koruyan sonlu
#: bir sınıra çevrilir: `theoretical_max_throughput_per_minute` gibi alanlarda
#: sonsuz "pratikte sınırsız" demektir ve bu değer de öyle davranır.
#: Sonsuz değerler yalnızca uç durumlarda oluşur (ör. hiçbir parçanın
#: ulaşamadığı bir istasyonun ziyaret oranı sıfırdır ve kapasitesi sonsuz
#: görünür); dönüşüm yapılmazsa PostgreSQL kaydı tümüyle reddederdi.
JSON_INFINITY_SENTINEL: float = 1e308


class TenantScopeError(ValueError):
    """Kiracı kapsamı olmadan kiracı verisine erişilmeye çalışıldı.

    Bu bir programlama hatasıdır, kullanıcı hatası değildir: depo katmanına
    boş bir `org_id` ulaşması, çağıran tarafın organizasyon çözümünü
    atladığı anlamına gelir.
    """


def require_org_id(org_id: Optional[str]) -> str:
    """Kiracı kapsamının gerçekten verildiğini garanti eder.

    Neden gerekli
    -------------
    Filtreleme her yerde `satir.org_id != org_id` biçiminde tam eşleşmedir.
    `org_id` boş (`None`) olsaydı, kimlik doğrulama öncesinden kalma ve
    `org_id` sütunu NULL olan **eski satırlar** bu karşılaştırmayı geçerdi
    (`None != None` yanlıştır) ve sahipsiz veri herkese görünür hâle gelirdi.

    Bugün bu yol HTTP üzerinden erişilebilir değildir — `get_current_org`
    her zaman dolu bir kimlik döndürür. Denetim yine de buraya konur: ileride
    bir arka plan işi ya da betik depoyu doğrudan çağırdığında, sessizce
    açılan bir kapı yerine gürültülü bir hata alınır.

    Raises:
        TenantScopeError: `org_id` boşsa.
    """
    if not org_id:
        raise TenantScopeError(
            "Kiraci kapsami olmadan kiraci verisine erisilemez: 'org_id' bos."
        )
    return org_id


class Base(DeclarativeBase):
    """SQLAlchemy taban sınıfı."""


#: PostgreSQL'de JSONB, diğer veritabanlarında (ör. testlerde SQLite) JSON.
#: JSONB ikili biçimde saklandığı için hem yerden kazandırır hem sorgulanabilir.
JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


class SimulationRecord(Base):
    """`simulations` tablosunun satır eşlemesi."""

    __tablename__ = "simulations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    config: Mapped[Dict[str, Any]] = mapped_column(JSON_TYPE)
    results: Mapped[Dict[str, Any]] = mapped_column(JSON_TYPE)
    status: Mapped[str] = mapped_column(String(16))

    # Koşumun hangi fabrika sürümünden üretildiği. Her ikisi de boş olabilir:
    # `POST /api/simulations/run` doğrudan bir `SimulationConfig` ile
    # çağrılabilir ve bu koşum hiçbir kayıtlı fabrikaya ait değildir. Mevcut
    # kayıtlar da bu sütunlar eklenmeden önce yazıldığı için boştur.
    factory_id: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )
    factory_version_id: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )

    # Kosumu baslatan kullanicinin organizasyonu. Kimlik dogrulama olmadan
    # yazilmis eski kayitlarda bostur ve bu kayitlar hicbir organizasyona
    # gorunmez hale gelir (var olmaya devam ederler, yalnizca `get()` artik
    # tam eslesme arar).
    org_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)


@dataclass
class StoredSimulation:
    """Bir koşumun, sonradan doğrulama raporu üretmeye yetecek tüm bağlamı."""

    simulation_id: str
    config: SimulationConfig
    replications: List[ReplicationResult]
    monte_carlo: MonteCarloReport
    bottleneck: BottleneckAnalysis
    oee: OEEReport
    duration_seconds: float
    created_at: float = field(default_factory=time.time)

    #: Koşumun üretildiği fabrika ve sürüm. Kayıtlı bir fabrikadan
    #: çalıştırılmayan koşumlarda boştur.
    factory_id: Optional[str] = None
    factory_version_id: Optional[str] = None

    #: Koşumu başlatan kullanıcının organizasyonu. Kimlik doğrulama
    #: gerektirmeyen (test, betik) çağrılarda boş bırakılabilir.
    org_id: Optional[str] = None


# --------------------------------------------------------------------------- #
# JSON dönüşümü
# --------------------------------------------------------------------------- #


def _make_json_safe(value: Any) -> Any:
    """Sonsuz ve tanımsız sayıları JSON'un taşıyabileceği değerlere çevirir.

    JSON standardı `Infinity` ve `NaN` tanımaz; PostgreSQL bu değerleri içeren
    bir belgeyi tümüyle reddeder. Sonsuz değerler sonlu bir sınıra, tanımsız
    değerler sıfıra çevrilir. Dönüşüm kayıplıdır ancak yalnızca zaten anlamı
    "ölçülemeyecek kadar büyük" olan alanları etkiler.
    """
    if isinstance(value, float):
        if math.isnan(value):
            return 0.0
        if math.isinf(value):
            return JSON_INFINITY_SENTINEL if value > 0 else -JSON_INFINITY_SENTINEL
        return value
    if isinstance(value, dict):
        return {key: _make_json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_make_json_safe(item) for item in value]
    return value


def serialize_record(record: StoredSimulation) -> Dict[str, Any]:
    """`StoredSimulation`'ı veritabanına yazılabilir sözlüklere ayırır."""
    results = {
        "replications": [item.model_dump() for item in record.replications],
        "monte_carlo": record.monte_carlo.model_dump(),
        "bottleneck": record.bottleneck.model_dump(),
        "oee": record.oee.model_dump(),
        "duration_seconds": record.duration_seconds,
        "created_at": record.created_at,
    }
    return {
        "config": _make_json_safe(record.config.model_dump()),
        "results": _make_json_safe(results),
    }


def deserialize_record(
    simulation_id: str,
    config: Dict[str, Any],
    results: Dict[str, Any],
    factory_id: Optional[str] = None,
    factory_version_id: Optional[str] = None,
    org_id: Optional[str] = None,
) -> StoredSimulation:
    """Veritabanı satırını `StoredSimulation` nesnesine geri çevirir."""
    return StoredSimulation(
        simulation_id=simulation_id,
        config=SimulationConfig.model_validate(config),
        replications=[
            ReplicationResult.model_validate(item) for item in results["replications"]
        ],
        monte_carlo=MonteCarloReport.model_validate(results["monte_carlo"]),
        bottleneck=BottleneckAnalysis.model_validate(results["bottleneck"]),
        oee=OEEReport.model_validate(results["oee"]),
        duration_seconds=results["duration_seconds"],
        created_at=results.get("created_at", time.time()),
        factory_id=factory_id,
        factory_version_id=factory_version_id,
        org_id=org_id,
    )


def normalize_database_url(raw_url: str) -> str:
    """Bağlantı adresini SQLAlchemy'nin beklediği biçime getirir.

    Railway ve Heroku gibi platformlar adresi `postgres://` önekiyle verir;
    SQLAlchemy 2 bu şemayı tanımaz ve `NoSuchModuleError` ile başarısız olur.
    Bu tek satırlık uyumsuzluk, dağıtımda en sık karşılaşılan bağlantı
    hatasıdır ve burada sessizce düzeltilir.
    """
    if raw_url.startswith("postgres://"):
        return "postgresql://" + raw_url[len("postgres://") :]
    return raw_url


# --------------------------------------------------------------------------- #
# Bellek deposu
# --------------------------------------------------------------------------- #


class SimulationStore:
    """Simülasyon sonuçlarının süreç içi deposu.

    `OrderedDict` ile FIFO düşürme uygulanır: sınır aşıldığında en eski kayıt
    silinir. Süreç belleğinde tutulduğu için sunucu yeniden başladığında
    kayıtlar kaybolur; kalıcılık için `DatabaseSimulationStore` kullanılır.
    """

    def __init__(self, max_entries: int = MAX_STORED_SIMULATIONS) -> None:
        if max_entries < 1:
            raise ValueError(f"Depo kapasitesi en az 1 olmalidir, alinan: {max_entries}")
        self._max_entries = max_entries
        self._entries: "OrderedDict[str, StoredSimulation]" = OrderedDict()

    def save(self, record: StoredSimulation) -> None:
        """Kaydı depoya ekler; kapasite aşılırsa en eskisini düşürür."""
        self._entries[record.simulation_id] = record
        while len(self._entries) > self._max_entries:
            evicted_id, _ = self._entries.popitem(last=False)
            logger.info(
                "Depo kapasitesi doldu; '%s' kimlikli simulasyon dusuruldu.", evicted_id
            )

    def get(self, org_id: str, simulation_id: str) -> StoredSimulation:
        """Kimliğe göre kaydı döndürür.

        Raises:
            KeyError: Kayıt bulunamazsa ya da başka bir organizasyona aitse.
                İkisi aynı hatayı üretir; API katmanı bunu 404'e çevirirken
                hangi durumun geçerli olduğunu bilmesine gerek kalmaz — ve
                istemciye de sızdırılmaz.
        """
        require_org_id(org_id)
        record = self._entries[simulation_id]
        if record.org_id != org_id:
            raise KeyError(simulation_id)
        return record

    def clear(self) -> None:
        """Depoyu boşaltır (testler için)."""
        self._entries.clear()

    def dispose(self) -> None:
        """Kaynakları serbest bırakır.

        Bellek deposunda yapacak bir şey yoktur; metot yalnızca iki deponun
        arayüzünün aynı kalması için bulunur. Çağıran taraf, elindeki deponun
        türüne göre farklı davranmak zorunda kalmamalıdır.
        """

    def __len__(self) -> int:
        return len(self._entries)


# --------------------------------------------------------------------------- #
# Veritabanı deposu
# --------------------------------------------------------------------------- #


class DatabaseSimulationStore:
    """Sonuçları ilişkisel bir veritabanında saklayan depo.

    Arayüzü `SimulationStore` ile birebir aynıdır; API katmanı ikisini ayırt
    etmez.

    Tablo, ilk kullanımda `create_all` ile oluşturulur. Ayrı bir göç (migration)
    aracı kullanılmaz: şema tek tablodan ibarettir ve sütunları JSON taşıdığı
    için içerik değiştiğinde şema değişmez. Şema gerçekten değişirse Alembic
    eklemek gerekir.
    """

    def __init__(
        self,
        database_url: str,
        retention_days: int = RETENTION_DAYS,
        echo: bool = False,
    ) -> None:
        self._retention_days = retention_days
        self._engine = create_engine(
            normalize_database_url(database_url),
            echo=echo,
            # Bağlantı havuzundaki bağlantılar sunucu tarafında zaman aşımına
            # uğrayabilir; her kullanımdan önce doğrulamak, uykudan uyanan bir
            # servisin ilk isteğinde "server closed the connection" hatası
            # vermesini engeller.
            pool_pre_ping=True,
        )
        # Yalnizca kendi tablosu olusturulur. Filtresiz `create_all`, ayni
        # `Base` uzerinde tanimli fabrika tablolarini da yaratir ve bunlar
        # Alembic tarafindan yonetiliyor; uygulama onlari acilista kendiliginden
        # yaratsaydi `alembic upgrade head` "tablo zaten var" hatasiyla duserdi.
        Base.metadata.create_all(self._engine, tables=[SimulationRecord.__table__])
        self._session_factory = sessionmaker(bind=self._engine)

    def save(self, record: StoredSimulation) -> None:
        """Kaydı veritabanına yazar ve süresi dolmuş kayıtları temizler."""
        payload = serialize_record(record)
        with self._session_factory.begin() as session:
            session.merge(
                SimulationRecord(
                    id=record.simulation_id,
                    created_at=datetime.now(timezone.utc),
                    config=payload["config"],
                    results=payload["results"],
                    status="completed",
                    factory_id=record.factory_id,
                    factory_version_id=record.factory_version_id,
                    org_id=record.org_id,
                )
            )
            self._delete_expired(session)

    def get(self, org_id: str, simulation_id: str) -> StoredSimulation:
        """Kimliğe göre kaydı döndürür.

        Raises:
            KeyError: Kayıt bulunamazsa ya da başka bir organizasyona aitse.
                Bellek deposuyla aynı hatayı yükseltmek zorunludur; API katmanı
                bu hatayı yakalayıp 404 döndürür ve deponun türünü bilmez.
        """
        require_org_id(org_id)
        with self._session_factory() as session:
            row = session.get(SimulationRecord, simulation_id)
            if row is None or row.org_id != org_id:
                raise KeyError(simulation_id)
            return deserialize_record(
                row.id,
                row.config,
                row.results,
                row.factory_id,
                row.factory_version_id,
                row.org_id,
            )

    def clear(self) -> None:
        """Tüm kayıtları siler (testler için)."""
        with self._session_factory.begin() as session:
            session.execute(delete(SimulationRecord))

    def dispose(self) -> None:
        """Bağlantı havuzunu kapatır.

        Uzun ömürlü bir sunucuda gerekmez, ancak testlerde çok sayıda depo
        oluşturulduğunda bağlantılar birikir; Windows'ta açık bir bağlantı,
        veritabanı dosyasının silinmesini de engeller.
        """
        self._engine.dispose()

    def __len__(self) -> int:
        with self._session_factory() as session:
            return len(session.execute(select(SimulationRecord.id)).all())

    def _delete_expired(self, session: Any) -> None:
        """Saklama süresi dolmuş, hiçbir fabrika sürümüne bağlı olmayan kayıtları siler.

        Her ekleme sırasında çalışır. Zamanlanmış bir görev yerine bu yolun
        seçilmesi bilinçlidir: ayrı bir zamanlayıcı, kurulması ve izlenmesi
        gereken yeni bir bileşen demektir; ekleme anındaki temizlik ise
        uygulamanın kendisiyle birlikte her zaman çalışır.

        Bir fabrika sürümüne bağlı koşumlar **hiçbir zaman silinmez**. Bu ayrım
        kalıcı fabrika modeliyle birlikte zorunlu hâle geldi: kayıtlı bir
        modelden alınmış sonuç, o modelin geçmişinin parçasıdır — "sürüm 2 ile
        sürüm 5 arasında ne değişti" sorusunun cevabı otuz gün sonra kendiliğinden
        silinemez. Fabrikaya bağlı olmayan koşumlar ise hâlâ geçicidir:
        kaydedilmemiş bir modelin tek seferlik denemesidir ve saklanmaları
        için bir sebep yoktur.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=self._retention_days)
        result = session.execute(
            delete(SimulationRecord).where(
                SimulationRecord.created_at < cutoff,
                SimulationRecord.factory_version_id.is_(None),
            )
        )
        if result.rowcount:
            logger.info(
                "%d adet suresi dolmus simulasyon kaydi silindi (%d gunden eski, "
                "hicbir fabrika surumune bagli olmayanlar).",
                result.rowcount,
                self._retention_days,
            )


# --------------------------------------------------------------------------- #
# Fabrika
# --------------------------------------------------------------------------- #


def create_simulation_store(
    database_url: Optional[str] = None,
) -> "SimulationStore | DatabaseSimulationStore":
    """Ortama göre uygun depoyu oluşturur.

    `DATABASE_URL` tanımlıysa veritabanı deposu denenir; bağlantı kurulamazsa
    bellek deposuna geri düşülür. Geri düşüş sessiz değildir: sorunun fark
    edilmeden kalması, kullanıcıların sonuçlarını sunucu her yeniden
    başladığında kaybetmesi demek olurdu.

    Args:
        database_url: Bağlantı adresi. Verilmezse `DATABASE_URL` ortam
            değişkeninden okunur.

    Returns:
        Kalıcı veya bellek içi depo.
    """
    url = database_url if database_url is not None else os.environ.get(DATABASE_URL_ENV)
    if not url:
        logger.info(
            "%s tanimli degil; simulasyon sonuclari bellekte tutulacak ve sunucu "
            "yeniden baslatildiginda kaybolacak.",
            DATABASE_URL_ENV,
        )
        return SimulationStore()

    try:
        store = DatabaseSimulationStore(url)
    except (SQLAlchemyError, ValueError, OSError) as error:
        logger.warning(
            "Veritabanina baglanilamadi (%s); bellek moduna gecildi. Sonuclar "
            "sunucu yeniden baslatildiginda kaybolacak.",
            error,
        )
        return SimulationStore()

    logger.info("Simulasyon sonuclari veritabaninda saklanacak.")
    return store


def new_simulation_id() -> str:
    """Yeni bir simülasyon kimliği üretir."""
    return uuid.uuid4().hex
