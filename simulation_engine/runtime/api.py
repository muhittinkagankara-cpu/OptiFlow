"""Runtime köprüsünün HTTP uçları.

Uçlar
-----
``POST /api/runtime/connect``    Bağlantıyı kaydeder ve **gerçekten** dener.
``POST /api/runtime/disconnect`` Bağlantıyı kapatır.
``GET  /api/runtime/status``     Bağlantıların tek tek durumu.
``GET  /api/runtime/health``     Toplu sağlık özeti.
``GET  /api/runtime/events``     Tampondaki olaylar (yeniden oynatma).
``GET  /api/runtime/stream``     SSE akışı; olaylar geldikçe iletilir.
``POST /api/runtime/subscribe``   Sürekli veri akışını başlatır (abonelik / dinleme / yoklama).
``POST /api/runtime/unsubscribe`` Akışı kapatır.
``GET  /api/runtime/devices``     Cihaz olayları, makine görüntüleri ve tanılama.
``GET  /api/runtime/live``        Live Factory'nin okuduğu görüntüler ve KPI.
``GET  /api/runtime/dashboard``   Runtime panosu: kurtarma, olay hızı, kalıcılık.
``POST /api/runtime/recover``     Diskteki bağlantıları ve görüntüleri geri yükler.
``GET  /api/runtime/replay``      Kalıcı olay günlüğünden yeniden oynatma.

Kimlik doğrulama mevcut sistemin aynısıdır: her uç `get_current_org`
bağımlılığını ister ve yalnızca kendi organizasyonunun bağlantılarını görür.
Ayrı bir kimlik yolu açılsaydı, köprü tüm ürünün en zayıf halkası olurdu.

`connect` uzun sürebilir (zaman aşımı + yeniden denemeler) ve bilinçli olarak
**eşzamanlı** yanıt döndürür: kullanıcı "bağlan" dediğinde sonucu görmek ister,
"istek alındı" değil. Uzun süren denemeler zaman aşımı değeriyle sınırlıdır.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import AsyncIterator, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.runtime.events import format_sse, sse_comment
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.persistence.repository import create_runtime_repository
from simulation_engine.runtime.provisioning import (
    DiscoveryCache,
    ProvisioningStep,
    PROVISIONING_STEP_LABEL,
    connection_label,
    discovery_for,
    machine_hint,
    suggest_metric,
    test_credentials,
)
from simulation_engine.runtime.commissioning import (
    is_valid_label,
    normalize_label,
)
from simulation_engine.runtime.licensing import LicenseTier
from simulation_engine.runtime.ops.export import EXPORT_KINDS
from simulation_engine.runtime.telemetry import TREND_WINDOWS
from simulation_engine.runtime.pipeline.transformers import MappingTable, MetricMapping
from simulation_engine.runtime.pipeline.device_events import Metric
from simulation_engine.runtime.registry import ConnectionNotFound
from simulation_engine.runtime.types import (
    ConnectionKind,
    ConnectionSpec,
    SecurityPolicy,
)

logger = logging.getLogger(__name__)

RUNTIME_PREFIX = "/api/runtime"

#: SSE bağlantısını canlı tutan yorum aralığı (sn).
#:
#: Proxy'ler ve mobil ağlar sessiz kalan bağlantıları kapatır; 15 saniye,
#: yaygın 30-60 saniyelik aylaklık sınırlarının rahatça altındadır.
HEARTBEAT_SECONDS = 15.0

#: Uygulama düzeyinde tek yönetici.
#:
#: Depo `DATABASE_URL` varsa veritabanı, yoksa bellek olur. Bellek modunda
#: durum sunucu yeniden başladığında kaybolur ve arayüz bunu "Kalıcılık:
#: Doğrulanmadı" olarak gösterir.
_manager = RuntimeManager(repository=create_runtime_repository())


def get_runtime_manager() -> RuntimeManager:
    """Runtime yöneticisi bağımlılığı; testler kendi örneğini geçirebilir."""
    return _manager


def recover_on_startup(manager: Optional[RuntimeManager] = None) -> dict:
    """Sunucu açılışında diskteki runtime durumunu geri yükler.

    Elle bir düğme yerine açılışta çalışır. Düğmeye bırakılsaydı, yeniden
    başlatmadan sonra ekranı ilk açan kişiye kadar alarmlar değerlendirilmez
    ve o aradaki duruşlar hiç kaydedilmezdi.

    Bellek modunda geri yüklenecek bir şey yoktur; bu durum **sessiz
    geçilmez**, günlüğe yazılır ve arayüz "Kalıcılık: Doğrulanmadı" gösterir.
    """
    target = manager if manager is not None else _manager
    result = target.recover_all()

    if not target.repository.is_persistent:
        logger.info(
            "Runtime deposu bellek modunda; geri yuklenecek kalici durum yok."
        )
    else:
        logger.info(
            "Runtime kurtarmasi tamamlandi: %s kiraci, %s hata.",
            len(result["orgs"]),
            len(result["failures"]),
        )
    return result


class ConnectRequest(BaseModel):
    """Bağlantı isteği gövdesi."""

    connection_id: str = Field(min_length=1, max_length=120)
    kind: ConnectionKind
    label: str = Field(min_length=1, max_length=200)
    endpoint: str = Field(min_length=1, max_length=500)
    port: Optional[int] = Field(default=None, ge=1, le=65_535)
    username: Optional[str] = Field(default=None, max_length=200)
    password: Optional[str] = Field(default=None, max_length=500)
    topics: List[str] = Field(default_factory=list, max_length=50)
    security_policy: SecurityPolicy = SecurityPolicy.NONE
    qos: int = Field(default=1, ge=0, le=2)
    timeout_ms: int = Field(default=5_000, ge=200, le=60_000)
    max_retries: int = Field(default=0, ge=0, le=5)

    def to_spec(self) -> ConnectionSpec:
        return ConnectionSpec(
            connection_id=self.connection_id,
            kind=self.kind,
            label=self.label,
            endpoint=self.endpoint,
            port=self.port,
            username=self.username,
            password=self.password,
            topics=list(self.topics),
            security_policy=self.security_policy,
            qos=self.qos,
            timeout_ms=self.timeout_ms,
            max_retries=self.max_retries,
        )


class MappingEntry(BaseModel):
    """Bir kaynak adresin makine ve ölçüm karşılığı."""

    origin: str = Field(min_length=1, max_length=300)
    machine_id: str = Field(min_length=1, max_length=120)
    metric: Metric
    unit: Optional[str] = Field(default=None, max_length=32)


class SubscribeRequest(BaseModel):
    """Akış başlatma isteği."""

    connection_id: str = Field(min_length=1, max_length=120)
    #: REST yoklama aralığı; öteki protokollerde yok sayılır.
    interval_ms: Optional[int] = Field(default=None, ge=200, le=300_000)
    #: Kaynak adreslerinin makine/ölçüm eşlemesi.
    mapping: List[MappingEntry] = Field(default_factory=list, max_length=200)
    #: Modeldeki istasyon kimlikleri; eşleme doğrulaması buna bakar.
    known_machine_ids: List[str] = Field(default_factory=list, max_length=200)


class UnsubscribeRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=120)


class RecoverRequest(BaseModel):
    """Kurtarma isteği.

    Gövde boştur: hangi organizasyonun kurtarılacağı **token'dan** gelir.
    İstemciden alınsaydı, kimliği tahmin eden biri başka bir organizasyonun
    bağlantılarını belleğe yükleyebilirdi.
    """

    #: Akışlar da yeniden başlatılsın mı? Varsayılan hayır: yeniden başlatma
    #: cihaza gerçek istek gönderir ve bunu kullanıcı istemelidir.
    resume_streams: bool = False


class AcknowledgeRequest(BaseModel):
    """Bir alarmı görüldü olarak işaretleme isteği."""

    alarm_id: str
    #: Kim gördü? Kimlik doğrulamadan gelen kullanıcı yoksa "operatör".
    by: str = "operatör"


class DisconnectRequest(BaseModel):
    connection_id: str = Field(min_length=1, max_length=120)
    #: Kayıt da silinsin mi? Varsayılan hayır: kapatmak unutmak değildir.
    forget: bool = False


class SilenceRequest(BaseModel):
    """Alarmı susturma isteği."""

    alarm_id: str = Field(min_length=1, max_length=200)
    by: str = Field(min_length=1, max_length=120)
    #: Susturma süresi (ms); verilmezse varsayılan pencere uygulanır.
    #: Süresiz susturma yoktur — unutulan bir alarm demektir.
    duration_ms: Optional[int] = Field(default=None, gt=0)
    reason: str = Field(default="Elle susturuldu", max_length=200)


class MaintenanceRequest(BaseModel):
    """Bakım penceresi açma isteği."""

    subject: str = Field(min_length=1, max_length=200)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    reason: str = Field(default="Planlı bakım", max_length=200)
    opened_by: str = Field(default="sistem", max_length=120)


class DiscoverRequest(BaseModel):
    """Cihaz keşfi isteği.

    Keşif gerçek uca gider; yanıt alınamazsa etiket listesi **boş** döner ve
    nedeni yazılır. Örnek etiket üretilmez.
    """

    kind: ConnectionKind
    endpoint: str = Field(min_length=1, max_length=500)
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    username: Optional[str] = Field(default=None, max_length=200)
    password: Optional[str] = Field(default=None, max_length=200)
    topics: List[str] = Field(default_factory=list)
    timeout_ms: int = Field(default=5_000, ge=200, le=60_000)
    #: Önbellekteki taze keşif kullanılsın mı?
    use_cache: bool = True

    def to_spec(self) -> ConnectionSpec:
        return ConnectionSpec(
            connection_id="kesif",
            kind=self.kind,
            label=connection_label(self.endpoint, self.kind.value),
            endpoint=self.endpoint,
            port=self.port,
            username=self.username,
            password=self.password,
            topics=list(self.topics),
            timeout_ms=self.timeout_ms,
            max_retries=0,
        )


class LicenseRequest(BaseModel):
    """Lisans üretme isteği."""

    tier: LicenseTier
    #: Geçerlilik süresi (gün); en az bir gün.
    days: int = Field(default=365, ge=1, le=3650)
    customer: str = Field(default="", max_length=300)
    #: Lisans anahtarı; verilirse yalnızca özeti saklanır.
    license_key: Optional[str] = Field(default=None, max_length=200)


class RevokeLicenseRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=300)


class InstallTokenRequest(BaseModel):
    """Kurulum tokenı üretme isteği."""

    site: str = Field(default="", max_length=300)
    #: Ömür (saat); verilmezse varsayılan pencere uygulanır.
    ttl_hours: Optional[int] = Field(default=None, gt=0, le=24 * 14)


class RedeemTokenRequest(BaseModel):
    token: str = Field(min_length=8, max_length=200)
    actor: str = Field(min_length=1, max_length=200)


class RevokeTokenRequest(BaseModel):
    token_id: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=1, max_length=300)


class MachineLabelRequest(BaseModel):
    """Makineye saha etiketi verme isteği."""

    machine_id: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=3, max_length=40)
    line: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=500)


class ChecklistQuery(BaseModel):
    """Kontrol listesinin dışarıdan gelen ölçümleri.

    Hepsi isteğe bağlıdır ve verilmeyeni `None` kalır: `False` varsayılsaydı,
    ölçülmemiş bir adım "yapılmadı" diye raporlanırdı.
    """

    discovered_tags: Optional[int] = Field(default=None, ge=0)
    mapped_tags: Optional[int] = Field(default=None, ge=0)
    unmapped_tags: Optional[int] = Field(default=None, ge=0)
    signature_recorded: Optional[bool] = None
    backup_verified: Optional[bool] = None


router = APIRouter(prefix=RUNTIME_PREFIX, tags=["runtime"])

#: Keşif sonuçlarının önbelleği.
#:
#: OPC UA adres uzayını gezmek saniyeler sürer ve sahadaki sunucuyu meşgul
#: eder; sihirbazda adımlar arasında gidip gelmek her seferinde yeniden
#: gezmeyi gerektirseydi kurulum kullanılamaz olurdu.
_discovery_cache = DiscoveryCache()


def get_discovery_cache() -> DiscoveryCache:
    """Keşif önbelleği bağımlılığı; testler kendi örneğini geçirebilir."""
    return _discovery_cache


@router.post("/connect", status_code=status.HTTP_200_OK)
async def connect(
    payload: ConnectRequest = Body(...),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Bağlantıyı kaydeder ve gerçekten dener.

    Yanıt her zaman 200'dür; bağlantının kurulup kurulmadığı gövdedeki
    `status` alanında yazar. Başarısız denemeye HTTP hatası döndürmek,
    "sunucu isteği işleyemedi" ile "cihaz yanıt vermedi" durumlarını
    birbirine karıştırırdı.
    """
    spec = payload.to_spec()
    manager.register(org_id, spec)
    state = await manager.connect(org_id, spec.connection_id)
    return state.to_dict()


@router.post("/disconnect", status_code=status.HTTP_200_OK)
async def disconnect(
    payload: DisconnectRequest = Body(...),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    try:
        state = await manager.disconnect(org_id, payload.connection_id)
        result = state.to_dict()
        if payload.forget:
            manager.forget(org_id, payload.connection_id)
        return result
    except ConnectionNotFound as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
        ) from error


@router.post("/subscribe", status_code=status.HTTP_200_OK)
async def subscribe(
    payload: SubscribeRequest = Body(...),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Sürekli veri akışını başlatır.

    Akış yalnızca doğrulanmış bir bağlantı için açılır; açılmazsa nedeni
    gövdede döner. Yanıt her zaman 200'dür — "sunucu isteği işleyemedi" ile
    "akış açılamadı" ayrı şeylerdir.
    """
    try:
        manager.state_of(org_id, payload.connection_id)
    except ConnectionNotFound as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
        ) from error

    if payload.mapping:
        manager.set_mapping(
            payload.connection_id,
            MappingTable(
                entries=[
                    MetricMapping(
                        origin=entry.origin,
                        machine_id=entry.machine_id,
                        metric=entry.metric,
                        unit=entry.unit,
                    )
                    for entry in payload.mapping
                ]
            ),
        )

    if payload.known_machine_ids:
        manager.devices.known_machine_ids = list(payload.known_machine_ids)

    result = await manager.start_stream(
        org_id, payload.connection_id, interval_ms=payload.interval_ms
    )
    return {**result, "streams": manager.stream_states(org_id)}


@router.post("/unsubscribe", status_code=status.HTTP_200_OK)
async def unsubscribe(
    payload: UnsubscribeRequest = Body(...),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    try:
        result = await manager.stop_stream(org_id, payload.connection_id)
    except ConnectionNotFound as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
        ) from error
    return {**result, "streams": manager.stream_states(org_id)}


@router.get("/devices")
async def runtime_devices(
    limit: int = Query(default=50, ge=1, le=500),
    connection_id: Optional[str] = Query(default=None),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Cihaz verisi: son olaylar, makine görüntüleri, tanılama ve akış durumu.

    Data Explorer ekranı bunu okur. Bir bağlantı kimliği verilirse, o
    bağlantının **bu organizasyona ait olduğu** doğrulanır.
    """
    if connection_id is not None and not manager.owns(org_id, connection_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"'{connection_id}' kimlikli bağlantı bulunamadı.",
        )

    owned = {state.connection_id for state in manager.states(org_id)}
    events = [
        event
        for event in manager.devices.recent(limit=limit, connection_id=connection_id)
        if event.connection_id in owned
    ]
    problems = [
        problem.to_dict()
        for problem in manager.devices.problems
        if problem.connection_id in owned
    ]

    return {
        "events": [event.to_dict() for event in events],
        "machines": [
            snapshot.to_dict() for snapshot in manager.devices.snapshots().values()
        ],
        "problems": problems[-limit:],
        "mapping_warnings": [
            warning.to_dict() for warning in manager.devices.mapping_warnings()
        ],
        "streams": manager.stream_states(org_id),
        "summary": manager.devices.summary(),
    }


@router.get("/live")
async def runtime_live(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Live Factory'nin okuduğu durum: makine görüntüleri ve KPI.

    Kaynak görüntülerdir; ekran açıldığında geçmiş olayları yeniden oynatmak
    gerekmez. Ölçülemeyen her KPI alanı `null` döner.
    """
    return manager.live_state(org_id)


@router.get("/dashboard")
async def runtime_dashboard(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Runtime panosu: bağlantı sayısı, kurtarma, olay hızı, kalıcılık."""
    return manager.runtime_dashboard(org_id)


@router.post("/recover", status_code=status.HTTP_200_OK)
async def runtime_recover(
    payload: RecoverRequest = Body(default=RecoverRequest()),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Diskteki bağlantıları ve görüntüleri belleğe geri yükler.

    Geri yüklenen bağlantılar **bağlı sayılmaz**: durumları "Test edilmedi"
    olur. Akışlar yalnızca `resume_streams` istendiğinde ve bağlantı daha önce
    doğrulanmışsa yeniden kurulur.
    """
    result = manager.recover(org_id)

    resumed: list = []
    if payload.resume_streams:
        for connection_id in result["streams_pending"]:
            outcome = await manager.start_stream(org_id, connection_id)
            resumed.append({"connection_id": connection_id, **outcome})

    return {**result, "resumed": resumed}


#: Canlı akışta yayılan olay türleri.
#:
#: Liste kapalıdır: bir ekran yalnızca anladığı olayları işlemeli, tanımadığı
#: bir tür geldiğinde sessizce yok saymalıdır. Açık bırakılsaydı, sunucuya
#: eklenen her yeni olay türü bütün istemcilere ulaşır ve hangi ekranın neyi
#: işlediği izlenemezdi.
LIVE_EVENT_KINDS = frozenset(
    {"device_data", "alarm", "oee_update", "production_update"}
)


async def live_event_stream(
    request: Request,
    manager: RuntimeManager,
    org_id: str,
) -> AsyncIterator[str]:
    """Canlı veri akışının gövdesi.

    `/stream` bütün runtime olaylarını yayar (bağlantı denemesi, kurtarma,
    tanılama). Bu uç ise yalnızca **üretim ekranının** ihtiyaç duyduğu dört
    türü yayar. Ayrı olmasının nedeni gürültü: Live Factory'nin her bağlantı
    denemesini işlemesi gereksiz, her tanılama satırını çizmesi ise zararlıdır.

    Sahiplik her olayda yeniden sorulur; akış açıldıktan sonra kaydedilen bir
    bağlantının olayları da iletilir.
    """
    subscriber = manager.dispatcher.subscribe()
    try:
        yield sse_comment("canli akis acildi")
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(
                    subscriber.queue.get(), timeout=HEARTBEAT_SECONDS
                )
            except (asyncio.TimeoutError, TimeoutError):
                yield sse_comment("bekleniyor")
                continue

            if event.kind not in LIVE_EVENT_KINDS:
                continue
            # "runtime" sahte bir bağlantı kimliğidir: alarm, OEE ve üretim
            # olayları tek bir cihazdan değil, hattın tamamından çıkar.
            if event.connection_id != "runtime" and not manager.owns(
                org_id, event.connection_id
            ):
                continue
            yield format_sse(event)
    finally:
        manager.dispatcher.unsubscribe(subscriber)


@router.get("/live/stream")
async def runtime_live_stream(
    request: Request,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> StreamingResponse:
    """Live Factory'nin dinlediği canlı olay akışı (SSE).

    Dört tür yayılır: `device_data`, `alarm`, `oee_update`,
    `production_update`.
    """
    return StreamingResponse(
        live_event_stream(request, manager, org_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/device-data")
async def runtime_device_data(
    limit: int = Query(default=50, ge=1, le=500),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Son cihaz ölçümleri — Payload Inspector bunu okur.

    Yalnızca bu kiracının bağlantılarından gelen ölçümler döner.
    """
    rows = manager.recent_device_data(org_id, limit)
    return {"events": rows, "count": len(rows)}


@router.get("/stream-stats")
async def runtime_stream_stats(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Akış ölçümleri: yoklama sıklığı, olay hızı, kuyruk derinliği, sağlık.

    Ölçülemeyen alan `null` döner; hiç olay akmamış bir kurulumda olay hızı
    sıfır değil **ölçülmemiştir**.
    """
    return manager.stream_stats(org_id)


@router.get("/alarms")
async def runtime_alarms(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Birleşik alarm merkezi: etkin alarmlar, geçmiş ve sayaçlar.

    Live Factory, Alarm Merkezi ve runtime panosu **aynı** uçtan okur; üç
    ekranın kendi eşiğini uygulaması hâlinde aynı arıza üç farklı biçimde
    görünürdü.
    """
    return manager.alarm_center(org_id)


@router.post("/alarms/acknowledge", status_code=status.HTTP_200_OK)
async def runtime_acknowledge_alarm(
    payload: AcknowledgeRequest,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Alarmı görüldü olarak işaretler.

    Yalnızca açık bir alarm onaylanabilir; kapanmış ya da zaten onaylanmış
    bir alarm için 404 döner. Onaylanan alarm, nedeni sürse bile yeniden
    açılmaz.
    """
    result = manager.acknowledge_alarm(org_id, payload.alarm_id, payload.by)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bu alarm açık değil ya da bulunamadı.",
        )
    return result


@router.get("/production-status")
async def runtime_production_status(
    planned_time_ms: Optional[float] = Query(default=None, gt=0),
    ideal_cycle_seconds: Optional[float] = Query(default=None, gt=0),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Operatör panosundaki Üretim Durumu kartı.

    `planned_time_ms` ve `ideal_cycle_seconds` verilmezse OEE **hesaplanmaz**
    ve `null` döner: varsayılan bir vardiya süresi uydurmak, ölçülmemiş bir
    sayıyı ölçülmüş gibi göstermek olurdu.
    """
    return manager.production_status(
        org_id,
        planned_time_ms=planned_time_ms,
        ideal_cycle_seconds=ideal_cycle_seconds,
    )


@router.get("/timeline")
async def runtime_timeline(
    limit: int = Query(default=100, ge=1, le=500),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Duruş ve alarmların birleşik zaman çizelgesi (yeniden eskiye)."""
    rows = manager.timeline(org_id, limit=limit)
    return {"entries": rows, "count": len(rows)}


@router.get("/health-score")
async def runtime_health_score(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Köprünün 0-100 arası sağlık skoru; ölçülemezse `null`."""
    return manager.health_score(org_id)


@router.get("/replay")
async def runtime_replay(
    since: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Kalıcı olay günlüğünden yeniden oynatma.

    RAM tamponundan farkı: sunucu yeniden başlasa bile bu kayıtlar durur.
    Bellek modunda çalışılıyorsa günlük de bellektedir ve yanıt bunu
    `persistent: false` ile söyler.
    """
    events = manager.repository.events_since(org_id, since, limit=limit)
    return {
        "events": [event.to_dict() for event in events],
        "last_sequence": manager.repository.last_sequence(org_id),
        "total": manager.repository.event_count(org_id),
        "persistent": manager.repository.is_persistent,
        "mode": manager.repository.mode,
    }


@router.get("/status")
async def runtime_status(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    return manager.status_report(org_id)


@router.get("/health")
async def runtime_health(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    return manager.health_report(org_id)


@router.get("/events")
async def runtime_events(
    since: int = Query(default=0, ge=0),
    connection_id: Optional[str] = Query(default=None),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Tampondaki olayları döndürür (yeniden oynatma).

    `connection_id` verilirse, o bağlantının **bu organizasyona ait olduğu**
    doğrulanır: doğrulanmasaydı, kimlik tahmin eden biri başka bir
    organizasyonun olay akışını okuyabilirdi.
    """
    if connection_id is not None and not manager.owns(org_id, connection_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"'{connection_id}' kimlikli bağlantı bulunamadı.",
        )

    owned = {state.connection_id for state in manager.states(org_id)}
    events = [
        event
        for event in manager.dispatcher.replay(since=since, connection_id=connection_id)
        if event.connection_id in owned
    ]

    return {
        "events": [event.to_dict() for event in events],
        "buffered": len(manager.dispatcher.buffer),
        "capacity": manager.dispatcher.buffer.capacity,
        # Tampon taştıysa hangi numaradan öncesinin kaybolduğu; kaybolmadıysa
        # `None` — istemci eksik bir aralığı sessizce atlamamalıdır.
        "dropped_before": manager.dispatcher.buffer.dropped_before(),
    }


async def event_stream(
    request: Request,
    manager: RuntimeManager,
    org_id: str,
) -> AsyncIterator[str]:
    """SSE gövdesi.

    Sahiplik **her olayda yeniden** sorulur. Akış açılırken bir kez
    hesaplanıyordu ve tarayıcıda görüldü ki bu, akış açıldıktan sonra
    kaydedilen bir bağlantının olaylarının hiç iletilmemesine yol açıyor:
    kullanıcı ekranı açık tutup yeni bir cihaz eklediğinde akış sessiz kalıyordu.

    İstemci bağlantıyı kapattığında döngü biter ve abone kaydı silinir; aksi
    hâlde her sekme kapanışı sunucuda bir kuyruk bırakırdı.
    """
    subscriber = manager.dispatcher.subscribe()
    try:
        yield sse_comment("akis acildi")
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(
                    subscriber.queue.get(), timeout=HEARTBEAT_SECONDS
                )
            except (asyncio.TimeoutError, TimeoutError):
                yield sse_comment("bekleniyor")
                continue
            if manager.owns(org_id, event.connection_id):
                yield format_sse(event)
    finally:
        manager.dispatcher.unsubscribe(subscriber)


@router.get("/stream")
async def runtime_stream(
    request: Request,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> StreamingResponse:
    """Olayları SSE ile yayar.

    `Cache-Control: no-cache` ve `X-Accel-Buffering: no` başlıkları
    zorunludur: araya giren bir vekil sunucu yanıtı tamponlarsa olaylar
    dakikalarca gecikir ve akış "çalışmıyor" görünür.
    """
    return StreamingResponse(
        event_stream(request, manager, org_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# -- Telemetri ve trendler --------------------------------------------------


@router.get("/telemetry/tags")
async def runtime_telemetry_tags(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Kayıtlı cihaz-etiket çiftleri.

    Liste boşsa henüz hiç ölçüm yazılmamıştır; örnek etiket üretilmez.
    """
    tags = manager.telemetry_tags(org_id)
    return {"tags": tags, "count": len(tags)}


@router.get("/telemetry/trend")
async def runtime_telemetry_trend(
    device: str = Query(min_length=1, max_length=200),
    tag: str = Query(min_length=1, max_length=200),
    window: str = Query(default="1h"),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Trend serisi; veri **gerçek telemetri tablosundan** gelir.

    Tanınmayan bir pencere için 400 döner: varsayılana düşmek, kullanıcının
    yedi günlük veri isterken bir saatlik grafiğe bakması demek olurdu.
    """
    payload = manager.telemetry_trend(org_id, device, tag, window)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tanınmayan pencere: {window}. Geçerli değerler: "
            + ", ".join(sorted(TREND_WINDOWS)),
        )
    return payload


@router.get("/telemetry/windows")
async def runtime_telemetry_windows() -> dict:
    """Kullanılabilir trend pencereleri."""
    return {
        "windows": [
            {
                "id": window.id,
                "label": window.label,
                "duration_ms": window.duration_ms,
                "buckets": window.buckets,
            }
            for window in TREND_WINDOWS.values()
        ]
    }


@router.post("/telemetry/cleanup", status_code=status.HTTP_200_OK)
async def runtime_telemetry_cleanup(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Saklama süresini aşan ölçümleri siler.

    Bir tur çalışır ve kaç satır sildiğini söyler; tur sınırına dayanıldıysa
    bunu da bildirir — silinecek satır kalmış olabilir.
    """
    result = manager.cleanup.run(org_id, int(time.time() * 1000))
    return result.to_dict()


# -- Tanılama ---------------------------------------------------------------


@router.get("/diagnostics")
async def runtime_diagnostics(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Runtime tanılama: verim, kuyruk, düşen olay, gecikme, telemetri hızı.

    Ölçülemeyen her alan `null` döner ve `reason` alanında nedeni yazar.
    """
    return manager.diagnostics(org_id)


@router.get("/continuity")
async def runtime_continuity(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Akışların canlılık durumu ve son veri yaşları."""
    now_ms = int(time.time() * 1000)
    return {
        "streams": manager.continuity.states(now_ms),
        "at_ms": now_ms,
    }


# -- Alarm susturma, bakım --------------------------------------------------


@router.post("/alarms/silence", status_code=status.HTTP_200_OK)
async def runtime_silence_alarm(
    payload: SilenceRequest,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Alarmın bildirimini geçici olarak keser.

    Alarm kapatılmaz: nedeni sürüyor, yalnızca bildirimi kesiliyor. Süre
    dolduğunda alarm kendiliğinden geri döner.
    """
    result = manager.silence_alarm(
        org_id,
        payload.alarm_id,
        payload.by,
        duration_ms=payload.duration_ms,
        reason=payload.reason,
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bu alarm etkin değil ya da bulunamadı.",
        )
    return result


@router.post("/alarms/unsilence", status_code=status.HTTP_200_OK)
async def runtime_unsilence_alarm(
    alarm_id: str = Body(..., embed=True, min_length=1, max_length=200),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Susturmayı kaldırır; alarm `OPEN` durumuna döner."""
    result = manager.unsilence_alarm(org_id, alarm_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bu alarm susturulmuş değil ya da bulunamadı.",
        )
    return result


@router.get("/maintenance")
async def runtime_maintenance(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Açık bakım pencereleri."""
    return {"windows": manager.maintenance_windows()}


@router.post("/maintenance", status_code=status.HTTP_200_OK)
async def runtime_open_maintenance(
    payload: MaintenanceRequest,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Bakım penceresi açar ve o makinenin alarmlarını susturur."""
    if payload.end_ms <= payload.start_ms:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bakım penceresinin bitişi başlangıcından sonra olmalı.",
        )
    return manager.open_maintenance(
        org_id,
        payload.subject,
        payload.start_ms,
        payload.end_ms,
        reason=payload.reason,
        opened_by=payload.opened_by,
    )


@router.delete("/maintenance/{subject}", status_code=status.HTTP_200_OK)
async def runtime_close_maintenance(
    subject: str,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Bakım penceresini kapatır.

    Susturulmuş alarmlar süreleri dolduğunda kendiliğinden geri döner;
    burada elle geri alınmaz çünkü bakımın bitmesi arızanın bittiği anlamına
    gelmez.
    """
    closed = manager.close_maintenance(org_id, subject)
    return {"subject": subject, "closed": closed}


# -- Devreye alma -----------------------------------------------------------


@router.get("/provisioning/steps")
async def runtime_provisioning_steps() -> dict:
    """Sihirbazın adımları, sırasıyla."""
    return {
        "steps": [
            {"id": step.value, "label": PROVISIONING_STEP_LABEL[step]}
            for step in ProvisioningStep
        ]
    }


@router.post("/provisioning/discover", status_code=status.HTTP_200_OK)
async def runtime_discover(
    payload: DiscoverRequest,
    org_id: str = Depends(get_current_org),
    cache: DiscoveryCache = Depends(get_discovery_cache),
) -> dict:
    """Uçtaki cihaza "nelerin var?" diye sorar.

    Yanıt alınamazsa `ok=false` döner ve `tags` **boş** kalır; örnek etiket
    üretilmez. Cihaz değiştiyse (parmak izi tutmuyorsa) bu da bildirilir.
    """
    spec = payload.to_spec()
    now_ms = int(time.time() * 1000)

    if payload.use_cache:
        entry = cache.get(spec.endpoint, now_ms)
        if entry is not None:
            body = entry.result.to_dict()
            body["cached"] = True
            body["cache_age_ms"] = entry.age_ms(now_ms)
            body["fingerprint"] = entry.fingerprint.to_dict()
            body["device_changed"] = False
            body["suggestions"] = _suggestions(entry.result)
            return body

    result = await discovery_for(payload.kind).discover(spec)
    changed = cache.changed(result) if result.ok else None
    if result.ok:
        entry = cache.store(result, now_ms)
        fingerprint = entry.fingerprint.to_dict()
    else:
        fingerprint = None

    body = result.to_dict()
    body["cached"] = False
    body["cache_age_ms"] = None
    body["fingerprint"] = fingerprint
    body["device_changed"] = changed
    body["suggestions"] = _suggestions(result)
    return body


def _suggestions(result) -> List[dict]:
    """Bulunan etiketler için makine ve metrik önerileri.

    Öneri **uygulanmaz**, kullanıcıya sunulur: sessizce uygulanan bir eşleme,
    yanlış makineye yazılmış bir üretim sayısı demektir. Anlaşılamayan bir
    etikette iki alan da `null` kalır.
    """
    return [
        {
            "address": tag.address,
            "machine_id": machine_hint(tag.address),
            "metric": suggest_metric(tag.address),
        }
        for tag in result.tags
    ]


@router.post("/provisioning/test", status_code=status.HTTP_200_OK)
async def runtime_test_credentials(
    payload: DiscoverRequest,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Kimlik bilgilerini gerçek uçta dener.

    Yanıt her zaman 200'dür; denemenin sonucu gövdedeki `ok` alanındadır.
    Başarısız denemeye HTTP hatası döndürmek, "sunucu isteği işleyemedi" ile
    "cihaz kabul etmedi" durumlarını karıştırırdı.
    """
    spec = payload.to_spec()
    adapter = manager.adapters.get(payload.kind)
    if adapter is None:
        return {
            "ok": False,
            "detail": f"{payload.kind.value} için sürücü yok.",
            "username": payload.username,
            "requires_auth": bool(payload.username),
            "latency_ms": None,
        }
    result = await test_credentials(adapter, spec)
    return result.to_dict()


# -- Lisans ------------------------------------------------------------------


@router.get("/license")
async def runtime_license(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Lisans durumu, sınırlar ve kullanım.

    Lisans yoksa `status` `missing` döner; uydurulmuş bir deneme lisansı
    üretilmez. Sayılamayan kullanım `null` kalır.
    """
    return manager.license_view(org_id)


@router.post("/license/trial", status_code=status.HTTP_200_OK)
async def runtime_start_trial(
    customer: str = Body(default="", embed=True, max_length=300),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """On dört günlük deneme lisansı açar.

    Var olan bir lisansın üstüne yazmaz: ücretli bir lisansı denemeye
    düşürmek, müşterinin satın aldığı sınırları geri almak olurdu.
    """
    return manager.start_trial(org_id, customer=customer)


@router.post("/license", status_code=status.HTTP_200_OK)
async def runtime_issue_license(
    payload: LicenseRequest,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Lisans üretir. Gerçek ödeme alınmaz; yalnızca hak tanımlanır."""
    return manager.issue_license(
        org_id,
        payload.tier,
        days=payload.days,
        customer=payload.customer,
        license_key=payload.license_key,
    )


@router.post("/license/revoke", status_code=status.HTTP_200_OK)
async def runtime_revoke_license(
    payload: RevokeLicenseRequest,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Lisansı iptal eder; izleme sürer, yeni kayıt açılamaz."""
    result = manager.revoke_license(org_id, payload.reason)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bu kuruluma lisans tanımlanmamış.",
        )
    return result


# -- Kurulum tokenı ----------------------------------------------------------


@router.get("/install-tokens")
async def runtime_install_tokens(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Kurulum tokenları; token metni **hiçbirinde** yer almaz."""
    tokens = manager.install_tokens(org_id)
    return {"tokens": tokens, "count": len(tokens)}


@router.post("/install-tokens", status_code=status.HTTP_200_OK)
async def runtime_issue_install_token(
    payload: InstallTokenRequest,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Tek kullanımlık kurulum tokenı üretir.

    Token metni **yalnızca bu yanıtta** döner; ikinci kez görüntülenemez.
    """
    return manager.issue_install_token(
        org_id, site=payload.site, ttl_hours=payload.ttl_hours
    )


@router.post("/install-tokens/redeem", status_code=status.HTTP_200_OK)
async def runtime_redeem_install_token(
    payload: RedeemTokenRequest,
    request: Request,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Tokenı kullanır ve kapatır.

    Yanıt her zaman 200'dür; sonuç gövdedeki `ok` alanındadır. Başarısızlığa
    HTTP hatası döndürmek, "sunucu isteği işleyemedi" ile "token geçersiz"
    durumlarını karıştırırdı.
    """
    client = request.client.host if request.client else None
    return manager.redeem_install_token(
        org_id, payload.token, payload.actor, used_from=client
    )


@router.post("/install-tokens/revoke", status_code=status.HTTP_200_OK)
async def runtime_revoke_install_token(
    payload: RevokeTokenRequest,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Tokenı iptal eder; kullanılmış bir token iptal edilmez."""
    result = manager.revoke_install_token(org_id, payload.token_id, payload.reason)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Token bulunamadı."
        )
    return result


# -- Makine etiketleri -------------------------------------------------------


@router.get("/machine-labels")
async def runtime_machine_labels(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Etiketler, çakışmalar, etiketsiz makineler ve öneriler."""
    return manager.label_review(org_id)


@router.post("/machine-labels", status_code=status.HTTP_200_OK)
async def runtime_save_machine_label(
    payload: MachineLabelRequest,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Makineye kalıcı saha kimliği verir.

    Biçime uymayan bir etiket **normalleştirilmeye çalışılır**; çevrilemezse
    400 döner. Uydurulmuş bir etiket, sahada yanlış makineye yapıştırılan bir
    kâğıt demektir.
    """
    label = payload.label if is_valid_label(payload.label) else normalize_label(payload.label)
    if label is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Etiket biçimi tanınmadı. Beklenen biçim: HARFLER-SAYI "
                "(örnek: FREZE-02)."
            ),
        )
    return manager.save_machine_label(
        org_id,
        payload.machine_id,
        label,
        line=payload.line,
        note=payload.note,
    )


@router.post("/machine-labels/printed", status_code=status.HTTP_200_OK)
async def runtime_mark_labels_printed(
    labels: List[str] = Body(..., embed=True),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Basılan etiketleri işaretler."""
    marked = manager.mark_labels_printed(org_id, labels)
    return {"marked": marked, "requested": len(labels)}


# -- Saha tanılama, kontrol listesi, dışa aktarma ----------------------------


@router.get("/field-diagnostics")
async def runtime_field_diagnostics(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Ping, protokol durumları, son veri, saat senkronu, paket kaybı.

    Ölçülemeyen her satır `null` döner ve nedeni yanında yazar.
    """
    return manager.field_diagnostics(org_id)


@router.post("/deployment-checklist", status_code=status.HTTP_200_OK)
async def runtime_deployment_checklist(
    payload: ChecklistQuery = Body(default_factory=ChecklistQuery),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Pilot kurulum kontrol listesi.

    Hiçbir adım elle işaretlenmez. Verilmeyen ölçüm `null` kalır ve adım
    "ölçülemedi" görünür.
    """
    return manager.deployment_checklist(
        org_id,
        discovered_tags=payload.discovered_tags,
        mapped_tags=payload.mapped_tags,
        unmapped_tags=payload.unmapped_tags,
        signature_recorded=payload.signature_recorded,
        backup_verified=payload.backup_verified,
    )


@router.get("/export/{kind}")
async def runtime_export(
    kind: str,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Gerçek veriyi CSV olarak dışa aktarır.

    Tanınmayan bir tür için 400 döner: varsayılana düşmek, kullanıcının alarm
    istediği yerde telemetri indirmesi demek olurdu.
    """
    result = manager.export_data(org_id, kind)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tanınmayan dışa aktarma türü: {kind}. Geçerli değerler: "
            + ", ".join(EXPORT_KINDS),
        )
    return result


@router.get("/pilot-workspace")
async def runtime_pilot_workspace(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Pilot fabrika çalışma alanının tek okuması.

    Ekranın gösterdiği her şey burada toplanır: bağlantılar, makineler,
    alarmlar, OEE, lisans ve kurulum durumu. Ayrı ayrı çağrılsaydı, ekranın
    farklı bölümleri farklı anlara ait sayılar gösterirdi.
    """
    now_ms = int(time.time() * 1000)
    return {
        "at_ms": now_ms,
        "connections": [state.to_dict() for state in manager.states(org_id)],
        "machines": manager.live_state(org_id).get("machines", []),
        "alarms": manager.alarm_center(org_id, now_ms),
        "production": manager.production_status(org_id, now_ms=now_ms),
        "license": manager.license_view(org_id, now_ms),
        "labels": manager.label_review(org_id),
        "continuity": manager.continuity.states(now_ms),
        "persistence_mode": manager.repository.mode,
        # Bu uç yalnızca gerçek kayıtları okur; benzetim verisi karışmaz.
        "origin": "runtime",
    }
