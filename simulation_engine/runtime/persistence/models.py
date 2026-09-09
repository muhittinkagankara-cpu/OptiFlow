"""Runtime kalıcılığının veritabanı şeması.

Neden gerekli
-------------
SALES-9 ve SALES-10'da bağlantılar, akışlar ve cihaz ölçümleri **süreç
belleğinde** yaşıyordu. Sunucu yeniden başladığında (dağıtım, çökme, ölçekleme)
her şey sıfırlanıyor, kullanıcı bütün bağlantıları elle yeniden kurmak zorunda
kalıyordu. Bir üretim hattını izleyen ekranın, sunucunun yeniden başlatıldığını
fark etmemesi gerekir.

Neyin kalıcı olduğu — ve neyin olmadığı
---------------------------------------
Kalıcı olan: bağlantı tanımları, abonelikler, sağlık sayaçları, makine
görüntüleri (snapshot) ve olay günlüğü. Kalıcı **olmayan**: açık soketin
kendisi. Soket bir sürece aittir ve taşınamaz; yeniden başlatmadan sonra
bağlantı "geri yüklenmiş" sayılmaz, **yeniden kurulur** ve yeniden doğrulanır.
Bu ayrım şemaya da yansır: `status` alanı diske yazılırken hiçbir zaman
`connected` olarak saklanmaz (bkz. `repository.persisted_status`).

Şema kararları
--------------
* Her tablo `org_id` taşır ve her sorgu onunla kapsanır: kiracı yalıtımı
  veritabanı katmanında da sürer.
* Zaman alanları epoch milisaniye (`BigInteger`) olarak saklanır. `DateTime`
  kullanılsaydı, olay akışındaki milisaniyelik sıralama veritabanı zaman dilimi
  ayarına bağımlı hâle gelirdi.
* Ölçülmemiş her sayısal alan `NULL`'dır. Sıfır varsayılan verilseydi,
  "ölçülmedi" ile "ölçüldü ve sıfır" veritabanı düzeyinde ayırt edilemezdi.
"""

from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from simulation_engine.api.storage import JSON_TYPE, Base


class RuntimeConnectionRow(Base):
    """Kaydedilmiş bir cihaz bağlantısı."""

    __tablename__ = "runtime_connections"

    #: `org_id::connection_id` — kiracılar arası çakışmayı engeller.
    id: Mapped[str] = mapped_column(String(320), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    connection_id: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(500), nullable=False)
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    username: Mapped[str | None] = mapped_column(String(200), nullable=True)
    #: Parola **saklanmaz**; yalnızca tanımlı olup olmadığı tutulur.
    #:
    #: Şifrelenmemiş bir cihaz parolasını veritabanına yazmak, veritabanı
    #: yedeğini ele geçiren birine fabrika erişimi vermek olurdu. Yeniden
    #: başlatmadan sonra parola gerektiren bağlantı, kullanıcıdan yeniden
    #: istenir ve arayüz bunu söyler.
    has_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    topics: Mapped[list] = mapped_column(JSON_TYPE, nullable=False, default=list)
    security_policy: Mapped[str] = mapped_column(String(40), nullable=False, default="None")
    qos: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    timeout_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=5_000)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Diske yazılan durum; asla `connected` olmaz.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="idle")
    #: Bu bağlantı geçmişte bir kez bile gerçek yanıt aldı mı?
    ever_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: Abonelik açık mıydı? Kurtarmada bu bilgi kullanılır.
    stream_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: REST yoklama aralığı; ötekilerde `NULL`.
    interval_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Ölçüm eşleme tablosu (origin → makine + metrik).
    mapping: Mapped[list] = mapped_column(JSON_TYPE, nullable=False, default=list)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)


class DeviceSnapshotRow(Base):
    """Bir makinenin son bilinen durumu.

    Live Factory'nin tek veri kaynağı budur: ekran olay akışını değil, bu
    tabloyu okur. Böylece bir kullanıcı ekranı açtığında geçmiş olayları
    yeniden oynatmak gerekmez — son durum zaten hazırdır.
    """

    __tablename__ = "device_snapshots"

    #: `org_id::machine_id`.
    id: Mapped[str] = mapped_column(String(320), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    machine_id: Mapped[str] = mapped_column(String(200), nullable=False)
    #: Son bildirilen durum: running / idle / blocked / down / setup / unknown.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    #: Ölçülmemiş her alan `NULL` kalır; sıfır yazılmaz.
    production_count: Mapped[float | None] = mapped_column(Float, nullable=True)
    scrap_count: Mapped[float | None] = mapped_column(Float, nullable=True)
    queue_length: Mapped[float | None] = mapped_column(Float, nullable=True)
    downtime_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    throughput_per_hour: Mapped[float | None] = mapped_column(Float, nullable=True)
    cycle_time_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    oee: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: Ölçüm başına hangi bağlantının yazdığı: {"production_count": "plc-1"}.
    #:
    #: Sessiz üzerine yazmayı görünür kılar: iki kaynak aynı metriği bildirirse
    #: hangisinin kazandığı buradan okunur.
    sources: Mapped[dict] = mapped_column(JSON_TYPE, nullable=False, default=dict)
    #: Kaç ölçüm işlendi?
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)


class RuntimeEventRow(Base):
    """Kalıcı olay günlüğü — yeniden oynatma buradan beslenir."""

    __tablename__ = "runtime_events"

    #: `org_id::sequence`.
    id: Mapped[str] = mapped_column(String(320), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(200), nullable=False)
    #: Organizasyon içinde artan sıra numarası.
    sequence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    connection_id: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="info")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    data: Mapped[dict] = mapped_column(JSON_TYPE, nullable=False, default=dict)

    __table_args__ = (
        # Yeniden oynatma her zaman "şu numaradan sonrası" biçiminde sorulur.
        Index("ix_runtime_events_org_sequence", "org_id", "sequence"),
    )


class RuntimeHealthRow(Base):
    """Bağlantı başına sağlık sayaçları.

    Sayaçlar yeniden başlatmayı **aşar**: bir bağlantının gün boyunca kaç kez
    koptuğu, sunucunun kaç kez yeniden başladığından bağımsız olarak
    okunabilmelidir.
    """

    __tablename__ = "runtime_health"

    #: `org_id::connection_id`.
    id: Mapped[str] = mapped_column(String(320), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    connection_id: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Ölçülmemişse `NULL`.
    avg_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    packets: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reconnects: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Sunucunun kaç kez yeniden başladığı (kurtarma sayacı).
    recoveries: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_packet_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)


class DowntimeEventRow(Base):
    """Bir makinenin duruş aralığı.

    Görüntü (snapshot) yalnızca son durumu tutar; vardiya boyunca üç kez duran
    bir makine orada "şu an çalışıyor" görünür ve toplam duruş kaybolur.
    "Bugün ne kadar durduk?" sorusunun yanıtı bu tablodadır.

    `end_at_ms` **nullable**'dır: süren bir duruşun bitişi yoktur. Sıfır ya da
    başlangıç değeri yazılsaydı, devam eden bir arıza sıfır süreli görünürdü.
    """

    __tablename__ = "runtime_downtime_events"

    #: `org_id::machine_id::start_at_ms` — aynı makinenin aynı anda iki duruşu olamaz.
    id: Mapped[str] = mapped_column(String(400), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    machine_id: Mapped[str] = mapped_column(String(200), nullable=False)
    start_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    #: Duruş sürüyorsa `NULL`.
    end_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    #: Ölçülen süre; duruş sürüyorsa `NULL` (okuma anında hesaplanır).
    duration_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reason: Mapped[str] = mapped_column(String(200), nullable=False, default="Bildirilmedi")
    #: Duruşu bildiren bağlantı; bilinmiyorsa `NULL`.
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)

    __table_args__ = (
        Index("ix_runtime_downtime_org_machine", "org_id", "machine_id"),
    )


class AuditLogRow(Base):
    """Değiştirilemez denetim kaydı.

    "Bu alarmı kim kapattı?", "bu bağlantıyı kim durdurdu?" sorularının yanıtı
    buradadır. Uygulama günlüğü bu iş için yetmez: dönüşümlüdür, silinir ve
    yapılandırılmamıştır.

    Tabloya yalnızca **eklenir**: güncelleme ve silme işlevi yazılmamıştır.
    Sonradan düzeltilebilen bir denetim günlüğü kanıt değeri taşımaz.
    """

    __tablename__ = "runtime_audit_log"

    #: `org_id::sıra` — kiracı içinde artan numara.
    id: Mapped[str] = mapped_column(String(320), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    sequence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    resource: Mapped[str] = mapped_column(String(300), nullable=False)
    #: İşlemi yapan; bilinmiyorsa "sistem" yazılır, boş bırakılmaz.
    actor: Mapped[str] = mapped_column(String(200), nullable=False, default="sistem")
    outcome: Mapped[str] = mapped_column(String(20), nullable=False, default="success")
    at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    #: Ek bilgiler; parola ve token alanları yazılmadan önce gizlenir.
    details: Mapped[dict] = mapped_column(JSON_TYPE, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_runtime_audit_org_sequence", "org_id", "sequence"),
    )


class TelemetryRow(Base):
    """Zaman serisi: her ölçümün kendi satırı.

    Görüntü tablosu (`device_snapshots`) yalnızca **son** değeri tutar; "dün
    gece 03:00'te ne oluyordu?" sorusunun yanıtı orada yoktur. Trend ekranları,
    vardiya karşılaştırması ve devreye alma raporu bu tablodan beslenir.

    Neden ayrı bir tablo: olay günlüğü insan okuması içindir ve 5.000 kayıtla
    sınırlıdır. Telemetri yoğundur ve farklı sorgulanır — "şu etiketin son bir
    saati" sorgusu olay günlüğünde tam tarama gerektirirdi.

    Bozuk kaliteli ölçüm de yazılır ama trend hesabına girmez: hiç
    yazılmasaydı bir sensörün ne zaman bozulduğu geriye dönük görülemezdi.
    """

    __tablename__ = "telemetry"

    #: `org_id::device::tag::timestamp_ms` — aynı etiketin aynı andaki ölçümü tektir.
    id: Mapped[str] = mapped_column(String(600), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(200), nullable=False)
    #: Ölçümün cihazdaki anı (epoch ms), sunucunun yazdığı an değil.
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    device: Mapped[str] = mapped_column(String(200), nullable=False)
    tag: Mapped[str] = mapped_column(String(200), nullable=False)
    #: Değer okunamadıysa `NULL`; sıfır yazılmaz.
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality: Mapped[str] = mapped_column(String(20), nullable=False, default="good")
    #: Ölçümü getiren bağlantı; bilinmiyorsa `NULL`.
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)

    __table_args__ = (
        # Trend sorgusunun tam biçimi: "şu kiracının şu cihaz-etiketi, şu
        # zaman aralığında". Üç sütunlu bileşik indeks olmadan bu sorgu
        # milyonlarca satırda tam tarama olurdu.
        Index(
            "ix_telemetry_org_device_tag_time",
            "org_id",
            "device",
            "tag",
            "timestamp_ms",
        ),
        # Saklama temizliği yalnızca zamana bakar ve cihazı umursamaz;
        # yukarıdaki indeksin ön eki `org_id` olduğu için ona düşemez.
        Index("ix_telemetry_org_time", "org_id", "timestamp_ms"),
    )


class LicenseRow(Base):
    """Bir kiracının lisansı.

    Kiracı başına tek satır: aynı anda iki lisans, hangisinin geçerli olduğu
    sorusunu yanıtsız bırakırdı. Plan değişikliği yeni bir satır değil, aynı
    satırın güncellenmesidir; geçmiş denetim günlüğünde durur.

    Lisans anahtarının kendisi **saklanmaz**, yalnızca özeti. Veritabanı
    yedeğini ele geçiren biri, orada yazan değerle başka bir kuruluma lisans
    yazamamalıdır.
    """

    __tablename__ = "licenses"

    #: `org_id` — kiracı başına tek lisans.
    id: Mapped[str] = mapped_column(String(200), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    tier: Mapped[str] = mapped_column(String(20), nullable=False)
    customer: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    starts_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expires_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    #: `NULL` sınırsız demektir; sıfır "hiç kullanamaz" olurdu.
    max_users: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_machines: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_factories: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revoked_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    issued_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    issued_by: Mapped[str] = mapped_column(String(200), nullable=False, default="sistem")
    #: Anahtarın SHA-256 özetinin ilk 32 karakteri; anahtar saklanmaz.
    key_digest: Mapped[str] = mapped_column(String(64), nullable=False, default="")


class InstallTokenRow(Base):
    """Tek kullanımlık kurulum tokenı.

    Token metni **hiçbir zaman** yazılmaz; yalnızca SHA-256 özeti. Kullanım
    kaydı (`usage_log`) yalnızca büyür: sonradan düzeltilebilen bir kurulum
    günlüğü, arıza soruşturmasında kanıt değeri taşımaz.
    """

    __tablename__ = "install_tokens"

    #: `org_id::kurulum-<sıra>`.
    id: Mapped[str] = mapped_column(String(320), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    token_id: Mapped[str] = mapped_column(String(120), nullable=False)
    digest: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expires_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_by: Mapped[str] = mapped_column(String(200), nullable=False, default="sistem")
    site: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    #: Kullanılmadıysa `NULL`; sıfır "1970'te kullanıldı" olurdu.
    used_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    used_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    used_from: Mapped[str | None] = mapped_column(String(120), nullable=True)
    revoked_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage_log: Mapped[list] = mapped_column(JSON_TYPE, nullable=False, default=list)


class MachineLabelRow(Base):
    """Makinenin sahadaki kalıcı kimliği.

    Yazılımdaki kimlik (`freze_hat1_2`) ile makinenin üstünde yazan ad
    (`FREZE-02`) arasındaki köprü budur. İkisi ayrı saklanır çünkü ikisi de
    değişebilir: yazılım kimliği içe aktarmada, saha etiketi yeniden
    etiketlemede.
    """

    __tablename__ = "machine_labels"

    #: `org_id::machine_id` — bir makinenin tek etiketi olur.
    id: Mapped[str] = mapped_column(String(400), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    machine_id: Mapped[str] = mapped_column(String(200), nullable=False)
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    line: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    #: Etiket hiç basılmadıysa `NULL`.
    printed_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_by: Mapped[str] = mapped_column(String(200), nullable=False, default="sistem")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")

    __table_args__ = (
        # Aynı etiketi iki makineye vermek, sahadaki bir arıza kaydının hangi
        # makineye ait olduğunu bilinemez kılar.
        Index("ix_machine_labels_org_label", "org_id", "label"),
    )


#: Bu sprintte eklenen tablolar; migration ve bootstrap bunları kullanır.
RUNTIME_TABLES = (
    RuntimeConnectionRow.__table__,
    DeviceSnapshotRow.__table__,
    RuntimeEventRow.__table__,
    RuntimeHealthRow.__table__,
    DowntimeEventRow.__table__,
    AuditLogRow.__table__,
    TelemetryRow.__table__,
    LicenseRow.__table__,
    InstallTokenRow.__table__,
    MachineLabelRow.__table__,
)

RUNTIME_TABLE_NAMES = tuple(table.name for table in RUNTIME_TABLES)


def scoped_id(org_id: str, key: str) -> str:
    """Kiracıyla kapsanmış birincil anahtar.

    İki organizasyon aynı bağlantı kimliğini kullanabilir (`hat-1`); anahtar
    yalnızca kimlikten oluşsaydı biri ötekinin kaydını ezerdi.
    """
    return f"{org_id}::{key}"
