"""Runtime yöneticisi — köprünün tek giriş noktası.

Kayıt (`ConnectionRegistry`), sürücüler (`adapters/`), ölçüm (`HealthMonitor`)
ve olay dağıtımı (`EventDispatcher`) burada birleşir. Uçlar yalnızca bu sınıfı
görür; hangi kütüphanenin hangi cihazla konuştuğunu bilmezler.

Neden tek yönlü akış
--------------------
Frontend → Backend → Connector → Device. Tarayıcı hiçbir zaman cihaza doğrudan
bağlanmaz. Bunun üç somut sonucu var: cihaz kimlik bilgileri istemciye inmez,
fabrika ağına yalnızca sunucudan erişilir ve bir bağlantının durumu tek bir
yerde tutulur — iki sekme açan kullanıcı aynı durumu görür.

Bellek sınırı
-------------
Durum süreç belleğinde yaşar; veritabanına yazılmaz. Sunucu yeniden
başladığında bağlantılar `IDLE` durumuna döner ve bu, arayüzde "Test edilmedi"
olarak görünür. Kalıcı görünüp aslında ölü olan bir kayıt, bundan çok daha
kötüdür.
"""

from __future__ import annotations

import asyncio
import time
from typing import Dict, List, Optional

from simulation_engine.runtime.adapters.mqtt import MqttAdapter
from simulation_engine.runtime.adapters.opcua import OpcUaAdapter
from simulation_engine.runtime.adapters.rest import RestAdapter
from simulation_engine.runtime.alarms import (
    ConnectionView,
    EscalationEngine,
    MaintenanceRegistry,
    MaintenanceWindow,
)
from simulation_engine.runtime.audit import AuditAction, AuditOutcome, AuditRecorder
from simulation_engine.runtime.events import EventDispatcher, RuntimeEvent
from simulation_engine.runtime.health import retry_delay_ms, should_retry
from simulation_engine.runtime.health_score import HealthInput, compute_health_score
from simulation_engine.runtime.commissioning import (
    DeploymentInput,
    MachineLabel,
    build_report as build_checklist_report,
    describe as describe_checklist,
    duplicate_labels,
    issue as issue_token,
    note_step,
    redeem as redeem_token,
    revoke as revoke_token,
    suggest_label,
    token_digest,
    unlabeled_machines,
)
from simulation_engine.runtime.licensing import (
    License,
    LicenseStatus,
    LicenseTier,
    UsageCounts,
    can_add,
    evaluate as evaluate_license,
    issue_license as build_license,
    trial_license,
)
from simulation_engine.runtime.monitoring import MonitoringCenter
from simulation_engine.runtime.ops import export as data_export
from simulation_engine.runtime.ops import fielddiag
from simulation_engine.runtime.ops.diagnostics import build_report
from simulation_engine.runtime.stream.continuity import ContinuityMonitor
from simulation_engine.runtime.telemetry import (
    CleanupJob,
    RetentionPolicy,
    TelemetryPoint,
    TelemetryWriter,
    load_series,
)
from simulation_engine.runtime.persistence.downtime import DowntimeEvent
from simulation_engine.runtime.stream import (
    DeviceDataEvent,
    StreamEngine,
    build_mqtt_subscriber,
    build_opcua_subscriber,
    build_poller,
)
from simulation_engine.runtime.persistence.repository import (
    InMemoryRuntimeRepository,
    StoredConnection,
    StoredEvent,
    StoredHealth,
)
from simulation_engine.runtime.persistence.snapshots import (
    MachineSnapshotRecord,
    aggregate_kpi,
)
from simulation_engine.runtime.pipeline.dispatcher import DeviceDispatcher
from simulation_engine.runtime.pipeline.device_events import DeviceEvent, Metric
from simulation_engine.runtime.pipeline.transformers import MappingTable, MetricMapping
from simulation_engine.runtime.sources import (
    mqtt_message_source,
    opcua_subscription_source,
    rest_fetch,
    source_availability,
)
from simulation_engine.runtime.streaming import (
    MqttStreamRunner,
    OpcUaSubscriptionRunner,
    RestPollingRunner,
    StreamRegistry,
    poll_interval_ms,
)
from simulation_engine.runtime.selection import selection_report
from simulation_engine.runtime.registry import (
    ConnectionNotFound,
    ConnectionRegistry,
    ConnectionState,
)
from simulation_engine.runtime.types import (
    ConnectionKind,
    ConnectionSpec,
    ConnectionStatus,
    EventLevel,
    ProbeResult,
    SecurityPolicy,
)


def score_label(score):
    """Skorun okunur karşılığı; ölçülmemiş skor "Ölçülmedi" olur."""
    if score is None:
        return "Ölçülmedi"
    if score >= 85:
        return "İyi"
    if score >= 60:
        return "Dikkat"
    return "Kötü"


def _event_level(level: str) -> EventLevel:
    """Metin seviyeyi `EventLevel`'e çevirir; tanınmayan seviye bilgi olur.

    Tanınmayan bir seviyede istisna atmak, tek bir yazım hatası yüzünden
    bütün olay akışını durdururdu. Bilgi düzeyine düşmek olayı görünür
    bırakır; kaybetmez.
    """
    try:
        return EventLevel(level)
    except ValueError:
        return EventLevel.INFO


def _as_number(value) -> Optional[float]:
    """Ölçümü sayıya çevirir; çevrilemezse `None`.

    Metin bir duruma (`"calisiyor"`) sıfır atanması, bir durum bilgisini
    sayısal bir ölçüm gibi gösterirdi. Mantıksal değerler sayıya çevrilir:
    açık/kapalı bir sinyalin zaman içindeki seyri anlamlıdır.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        number = float(value)
        # NaN ve sonsuz veritabanına yazılmaz: JSON'a çevrilemez ve grafiği
        # okunamaz hâle getirir.
        if number != number or number in (float("inf"), float("-inf")):
            return None
        return number
    return None


class RuntimeManager:
    """Bağlantıları kuran, ölçen ve olaylarını yayan katman."""

    def __init__(
        self,
        registry: Optional[ConnectionRegistry] = None,
        dispatcher: Optional[EventDispatcher] = None,
        adapters: Optional[Dict[ConnectionKind, object]] = None,
        sleep=asyncio.sleep,
        repository=None,
    ) -> None:
        self.registry = registry if registry is not None else ConnectionRegistry()
        self.dispatcher = dispatcher if dispatcher is not None else EventDispatcher()
        # `adapters or {...}` yazilmasi bir hataydi: bos bir sozluk yanlis
        # sayildigi icin **acikca surucusuz** kurulan bir yonetici sessizce
        # gercek suruculeri geri aliyor ve testte gercek bir ag cagrisi
        # yapiliyordu. Ayrim `None` ile yapilir.
        self.adapters = (
            {
                ConnectionKind.REST: RestAdapter(),
                ConnectionKind.OPCUA: OpcUaAdapter(),
                ConnectionKind.MQTT: MqttAdapter(),
            }
            if adapters is None
            else adapters
        )
        #: Testlerde bekleme atlanabilsin diye dışarıdan verilir.
        self._sleep = sleep
        #: Runtime durumunun kalıcı deposu. Verilmezse bellek deposu
        #: kullanılır ve `repository.mode` bunu "memory" olarak bildirir —
        #: arayüz de "Kalıcılık: Doğrulanmadı" yazar.
        self.repository = (
            repository if repository is not None else InMemoryRuntimeRepository()
        )
        #: Cihaz verisinin tek çıkış kapısı.
        self.devices = DeviceDispatcher(self.dispatcher)
        #: Görüntü her değiştiğinde diske yazılır.
        self.devices.on_snapshot = self._persist_snapshot
        #: Her olay kalıcı günlüğe yazılır: yeniden oynatma sunucu yeniden
        #: başlasa da sürsün.
        self.dispatcher.on_emit = self._on_event
        #: Kalıcılığın hangi organizasyon adına yapıldığı.
        #:
        #: Köprü tek bir süreçte birden çok organizasyona hizmet eder ama
        #: cihaz kapısı organizasyon bilmez; bu yüzden yazma sırasında aktif
        #: organizasyon burada tutulur. Bilinmiyorsa yazma yapılmaz — yanlış
        #: kiracıya veri yazmaktansa yazmamak yeğdir.
        self.active_org_id: Optional[str] = None
        #: Çalışan akışlar ve bağlantı başına eşleme tabloları.
        self.streams = StreamRegistry()
        self.mappings: Dict[str, MappingTable] = {}
        #: Alarm, duruş, OEE ve KPI'ın tek kaynağı.
        #:
        #: Üç ekran (Live Factory, Alarm Merkezi, Runtime panosu) da buradan
        #: okur; her biri kendi eşiğini uygulasaydı aynı arıza üç farklı
        #: biçimde görünürdü.
        self.monitoring = MonitoringCenter()
        self.monitoring.on_downtime = self._persist_downtime
        #: Gerçek cihaz akışlarının tek sahibi.
        #:
        #: Alıcılar burada bağlanır ve **sıra bir karardır**: önce görüntü
        #: güncellenir, sonra ölçüm yayılır, en son alarm ve OEE
        #: değerlendirilir.
        #:
        #: Görüntü ilk sırada olmasaydı, alarm henüz güncellenmemiş bir
        #: görüntüyle hesaplanır ve "makine durdu" alarmının yanında
        #: "çalışıyor" yazardı. Yayın, izlemeden **önce** gelir: aksi hâlde
        #: ekran, alarmı onu doğuran ölçümden önce alır ve nedenini
        #: gösteremezdi.
        self.stream = StreamEngine()
        self.stream.register_snapshot_sink(self._ingest_device_event)
        self.stream.register_broadcast_sink(self._broadcast_device_event)
        self.stream.register_monitoring_sink(self._evaluate_from_stream)
        #: Kritik işlemlerin değiştirilemez günlüğü.
        #:
        #: Depo verildiğinde kayıtlar diske de yazılır; verilmediğinde yalnızca
        #: süreç belleğinde tutulur ve arayüz bunu "kalıcı değil" olarak
        #: gösterir. Sessiz kalsaydı, yeniden başlatmada kaybolan bir denetim
        #: günlüğü kalıcı sanılırdı.
        self.audit = AuditRecorder(repository=self.repository)
        #: Akışların kesintisizliği: kalp atışı, boşta kalma, bayatlama.
        #:
        #: Akış motoru bir akışın "başlatıldığını" bilir ama sustuğunu bilmez;
        #: kablo çekildiğinde yoklayıcı bekler, abone dinler ve kimse bir şey
        #: söylemez. Bu izleyici sessizliği olaya çevirir.
        self.continuity = ContinuityMonitor()
        #: Zaman serisinin yazıcıları; kiracı başına bir tane.
        #:
        #: Tek bir yazıcı olsaydı, iki kiracının ölçümleri aynı tamponda
        #: karışır ve toplu yazma sırasında birinin verisi ötekinin adına
        #: yazılırdı.
        self._writers: Dict[str, TelemetryWriter] = {}
        #: Saklama süresini aşan ölçümleri silen iş.
        self.cleanup = CleanupJob(self.repository, RetentionPolicy())
        #: Sahipsiz alarmları üst kademeye taşıyan motor.
        self.escalation = EscalationEngine()
        #: Açık bakım pencereleri; bakımdaki makinenin alarmı susturulur.
        self.maintenance = MaintenanceRegistry()
        #: Son yayılan OEE ve üretim değerleri; değişmediyse yeniden yayılmaz.
        self._last_oee_signature: Optional[tuple] = None
        self._last_production_signature: Optional[tuple] = None
        self._tasks: Dict[str, "asyncio.Task[object]"] = {}

    # -- Kayıt --------------------------------------------------------------

    def register(self, org_id: str, spec: ConnectionSpec) -> ConnectionState:
        """Bağlantıyı kaydeder ya da yapılandırmasını günceller.

        Kayıt aynı anda **diske** de yazılır: sunucu yeniden başladığında
        kullanıcının bağlantıları elle kurması gerekmesin.
        """
        state = self.registry.upsert(org_id, spec)
        self.active_org_id = org_id
        self._persist_connection(org_id, state)
        self.dispatcher.emit(
            connection_id=spec.connection_id,
            kind="registered",
            message=f"{spec.label} kaydedildi ({spec.kind.value}). Henüz denenmedi.",
            data={"org_id": org_id, "endpoint": spec.endpoint},
        )
        return state

    def forget(self, org_id: str, connection_id: str) -> ConnectionState:
        state = self.registry.remove(org_id, connection_id)
        self.repository.delete_connection(org_id, connection_id)
        self.dispatcher.emit(
            connection_id=connection_id,
            kind="removed",
            message=f"{state.spec.label} kaydı silindi.",
        )
        return state

    def state_of(self, org_id: str, connection_id: str) -> ConnectionState:
        return self.registry.get(org_id, connection_id)

    def states(self, org_id: str) -> List[ConnectionState]:
        return self.registry.list(org_id)

    # -- Bağlantı -----------------------------------------------------------

    async def connect(self, org_id: str, connection_id: str) -> ConnectionState:
        """Bağlantıyı kurmayı dener; gerekirse yeniden dener.

        Her deneme bir olay üretir. Başarısızlıkta durum `FAILED` olur —
        `RETRYING` yalnızca **bir deneme daha yapılacaksa** yazılır, böylece
        arayüzdeki "yeniden deniyor" ifadesi gerçekten beklenen bir denemeyi
        anlatır.
        """
        state = self.registry.get(org_id, connection_id)
        adapter = self.adapters.get(state.spec.kind)
        if adapter is None:
            probe = ProbeResult(
                ok=False,
                latency_ms=None,
                detail=f"Doğrulanmadı: {state.spec.kind.value} için sürücü yok.",
            )
            state.apply_probe(probe)
            self._emit_probe(state, probe)
            return state

        max_retries = max(0, state.spec.max_retries)
        attempt = 0

        while True:
            state.attempt = attempt
            state.status = (
                ConnectionStatus.CONNECTING if attempt == 0 else ConnectionStatus.RETRYING
            )
            if attempt > 0:
                state.health.record_reconnect()

            probe = await adapter.probe(state.spec)  # type: ignore[attr-defined]
            state.apply_probe(probe)
            self._emit_probe(state, probe)
            self._persist_connection(org_id, state)
            self._persist_health(org_id, state)

            if probe.ok or not should_retry(attempt, max_retries):
                break

            attempt += 1
            delay = retry_delay_ms(attempt)
            state.status = ConnectionStatus.RETRYING
            self.dispatcher.emit(
                connection_id=connection_id,
                kind="retry",
                level=EventLevel.WARNING,
                message=(
                    f"{state.spec.label}: {attempt}. yeniden deneme "
                    f"{delay} ms sonra."
                ),
                data={"attempt": attempt, "delay_ms": delay},
            )
            await self._sleep(delay / 1000.0)

        # Başarısız denemeler de kaydedilir: "kim bu bağlantıyı kurmayı
        # denedi ve başaramadı?" sorusu, başarılı denemeler kadar önemlidir.
        self._record_audit(
            org_id,
            AuditAction.CONNECTOR_CONNECT,
            state.spec.connection_id,
            outcome=(
                AuditOutcome.SUCCESS
                if state.status is ConnectionStatus.CONNECTED
                else AuditOutcome.FAILURE
            ),
            details={"kind": state.spec.kind.value, "attempts": attempt + 1},
        )

        return state

    async def disconnect(self, org_id: str, connection_id: str) -> ConnectionState:
        """Bağlantıyı kapatır.

        Ölçümler **silinmez**: kapanmış bir bağlantının geçmiş gecikmesi ve
        hata sayısı, sorunun neden yaşandığını anlatan tek kayıttır.
        """
        state = self.registry.get(org_id, connection_id)
        state.status = ConnectionStatus.DISCONNECTED
        state.health.mark_disconnected()
        state.attempt = 0
        self.dispatcher.emit(
            connection_id=connection_id,
            kind="disconnected",
            message=f"{state.spec.label} kapatıldı.",
        )
        self._record_audit(
            org_id, AuditAction.CONNECTOR_DISCONNECT, connection_id
        )
        return state

    def _record_audit(
        self,
        org_id: str,
        action: AuditAction,
        resource: str,
        actor: Optional[str] = None,
        outcome: AuditOutcome = AuditOutcome.SUCCESS,
        details: Optional[Dict[str, object]] = None,
    ) -> None:
        """Denetim kaydı yazar; kayıt hatası işlemi **durdurmaz**.

        Kaydedici zaten hataları yutar; burada ek bir koruma yoktur çünkü
        kaydedicinin sözleşmesi budur: denetim günlüğüne yazamamak, bir
        alarmın onaylanmasını engellememelidir.
        """
        self.audit.record(
            org_id=org_id,
            action=action,
            resource=resource,
            actor=actor,
            outcome=outcome,
            details=details,
        )

    def _emit_probe(self, state: ConnectionState, probe: ProbeResult) -> RuntimeEvent:
        """Deneme sonucunu olaya çevirir."""
        data: Dict[str, object] = {"ok": probe.ok}
        # Ölçülmeyen alanlar olaya hiç konmaz; sıfır yazmak ölçüm yapılmış
        # izlenimi verirdi.
        if probe.latency_ms is not None:
            data["latency_ms"] = round(probe.latency_ms, 3)
        if probe.bytes_received is not None:
            data["bytes"] = probe.bytes_received
        if probe.evidence is not None:
            data["evidence"] = probe.evidence

        event = self.dispatcher.emit(
            connection_id=state.connection_id,
            kind="probe",
            level=EventLevel.INFO if probe.ok else EventLevel.CRITICAL,
            message=f"{state.spec.label}: {probe.detail}",
            data=data,
            at_ms=probe.at_ms,
        )
        return event

    # -- Kalıcılık ----------------------------------------------------------

    def _persist_connection(self, org_id: str, state: ConnectionState) -> None:
        """Bağlantı tanımını diske yazar.

        Parola **yazılmaz**; yalnızca tanımlı olup olmadığı saklanır.
        """
        spec = state.spec
        mapping = self.mappings.get(spec.connection_id)
        self.repository.save_connection(
            org_id,
            StoredConnection(
                connection_id=spec.connection_id,
                kind=spec.kind.value,
                label=spec.label,
                endpoint=spec.endpoint,
                port=spec.port,
                username=spec.username,
                has_password=bool(spec.password),
                topics=list(spec.topics),
                security_policy=spec.security_policy.value,
                qos=spec.qos,
                timeout_ms=spec.timeout_ms,
                max_retries=spec.max_retries,
                status=state.status.value,
                ever_verified=state.ever_verified,
                stream_enabled=self.streams.is_running(spec.connection_id),
                interval_ms=None,
                mapping=[
                    {
                        "origin": entry.origin,
                        "machine_id": entry.machine_id,
                        "metric": entry.metric.value,
                        "unit": entry.unit,
                    }
                    for entry in (mapping.entries if mapping is not None else [])
                ],
            ),
        )

    def _persist_health(self, org_id: str, state: ConnectionState) -> None:
        """Sağlık sayaçlarını diske yazar.

        Sayaçlar yeniden başlatmayı aşar; önceki koşumun `recoveries` değeri
        korunur, üzerine yazılmaz.
        """
        previous = self.repository.get_health(org_id, state.connection_id)
        self.repository.save_health(
            org_id,
            StoredHealth(
                connection_id=state.connection_id,
                avg_latency_ms=state.health.avg_latency_ms(),
                max_latency_ms=state.health.max_latency_ms(),
                packets=state.health.packets,
                errors=state.health.errors,
                reconnects=state.health.reconnects,
                recoveries=previous.recoveries if previous is not None else 0,
                last_error=state.health.last_error,
                last_packet_at_ms=state.health.last_packet_at_ms,
            ),
        )

    def _persist_snapshot(self, snapshot: MachineSnapshotRecord) -> None:
        """Görüntüyü diske yazar; aktif organizasyon bilinmiyorsa yazmaz."""
        if self.active_org_id is None:
            return
        self.repository.save_snapshot(self.active_org_id, snapshot)

    # -- Akış alıcıları -----------------------------------------------------

    def _ingest_device_event(self, event) -> None:
        """Akıştan gelen ölçümü görüntü boru hattına verir.

        Boru hattı SALES-10'dan beri `DeviceEvent` ile çalışır; akış katmanı
        için yeniden yazılmadı. Aynı ölçümü iki ayrı yol işleseydi, ikisi
        farklı sonuç üretebilir ve hangi görüntünün doğru olduğu bilinemezdi.
        """
        # Yayın yapılmaz: bu ölçümün olayını, sıra numarasını ve protokolünü
        # taşıyan akış katmanı yayar. İkisi birden yaysaydı tek ölçüm için iki
        # farklı olay ekrana düşerdi.
        self.devices.dispatch([event], emit=False)
        self._note_liveness(event)
        self._record_telemetry(event)

    def _note_liveness(self, event: DeviceEvent) -> None:
        """Veri geldiğini kesintisizlik izleyicisine bildirir.

        Akış kopmuş durumdayken veri gelirse izleyici "yeniden bağlandı"
        olayı üretir; bu olay olmasaydı, ekranda yalnızca değerin yeniden
        değişmeye başladığı görülür, kesintinin yaşandığı hiç bilinmezdi.

        Alan adları `DeviceEvent`'indir (`connection_id`, `at_ms`). İlk
        yazımda akış katmanının adları (`connector_id`, `timestamp`)
        kullanılmıştı ve sonuç sessizce boştu: gerçek sunucularla yapılan
        koşumda telemetrinin hiç yazılmadığı böyle görüldü.
        """
        connection_id = event.connection_id
        if not connection_id:
            return
        at_ms = event.at_ms if event.at_ms > 0 else int(time.time() * 1000)
        reconnected = self.continuity.note_data(connection_id, at_ms)
        if reconnected is not None:
            self._emit_continuity(reconnected)

    def _record_telemetry(self, event: DeviceEvent) -> None:
        """Ölçümü zaman serisine yazar.

        Aktif organizasyon bilinmiyorsa yazılmaz: yanlış kiracıya veri
        yazmaktansa yazmamak yeğdir. Bozuk kaliteli ölçüm de yazılır — hiç
        yazılmasaydı, bir sensörün ne zaman bozulduğu geriye dönük olarak
        görülemezdi.

        Etiket, ölçümün **metriğidir** (`production_count`), ham adresi değil:
        trend ekranı "bu makinenin üretim sayısı" diye sorar, "şu düğümün
        değeri" diye değil. Ham adres görüntü katmanında zaten saklanır.
        """
        if self.active_org_id is None:
            return
        point = TelemetryPoint(
            timestamp_ms=event.at_ms if event.at_ms > 0 else int(time.time() * 1000),
            device=event.machine_id or "bilinmiyor",
            tag=event.metric.value,
            value=_as_number(event.value),
            quality=event.quality.value,
            source=event.connection_id or None,
        )
        writer = self.telemetry_writer(self.active_org_id)
        writer.submit(point, point.timestamp_ms)
        if writer.due(point.timestamp_ms):
            writer.flush(point.timestamp_ms)

    def telemetry_writer(self, org_id: str) -> TelemetryWriter:
        """Kiracının telemetri yazıcısı; yoksa kurar."""
        writer = self._writers.get(org_id)
        if writer is None:
            writer = TelemetryWriter(self.repository, org_id)
            self._writers[org_id] = writer
        return writer

    def _emit_continuity(self, event) -> None:
        """Kesintisizlik olayını olay akışına yazar.

        Seviye metni `EventLevel`'e çevrilir. Düz metin geçirilseydi kalıcılık
        katmanı `level.value` okurken düşer, hata akış hattında yutulur ve olay
        tampona girdiği hâlde **diske hiç yazılmazdı** — otuz dakikalık gerçek
        koşumda tam olarak bu görüldü.
        """
        self.dispatcher.emit(
            connection_id=event.connector_id,
            kind=event.kind,
            message=event.message,
            level=_event_level(event.level),
            data=event.to_dict(),
        )

    def _evaluate_from_stream(self, now_ms: int) -> None:
        """Yeni veri geldiğinde alarm, duruş, OEE ve KPI'ı tazeler.

        Aktif organizasyon bilinmiyorsa değerlendirme yapılmaz: yanlış
        kiracının alarmını açmaktansa hiç açmamak yeğdir.
        """
        if self.active_org_id is None:
            return

        org_id = self.active_org_id
        changes = self.evaluate_monitoring(org_id, now_ms)
        self._emit_alarm_changes(changes, now_ms)
        self._emit_metric_updates(org_id, now_ms)
        self.evaluate_continuity(now_ms)
        self.evaluate_escalation(org_id, now_ms)
        self.run_cleanup(org_id, now_ms)

    def _emit_alarm_changes(self, changes: Dict[str, object], now_ms: int) -> None:
        """Alarm sayısı değiştiyse olay yayar.

        Her değerlendirmede yayın yapılsaydı, hiçbir şey değişmeyen bir hatta
        saniyede iki kez aynı alarm listesi gönderilir ve ekran boşuna yeniden
        çizilirdi.
        """
        counts = changes.get("alarms") or {}
        if not isinstance(counts, dict):
            return
        if not any(counts.get(key) for key in ("opened", "resolved")):
            return

        self.dispatcher.emit(
            connection_id="runtime",
            kind="alarm",
            message=(
                f"{counts.get('opened', 0)} alarm açıldı, "
                f"{counts.get('resolved', 0)} alarm kapandı."
            ),
            data={
                "changes": dict(counts),
                "counts": self.monitoring.alarms.snapshot(now_ms)["counts"],
            },
        )

    def _emit_metric_updates(self, org_id: str, now_ms: int) -> None:
        """OEE ve üretim özetini yayar — **yalnızca değiştiyse**.

        Değişmeyen bir sayıyı yeniden yayınlamak, ekranda "yeni veri" izlenimi
        verir ve gerçek bir değişimi fark etmeyi zorlaştırır.
        """
        snapshots = self._current_snapshots(org_id)
        kpi = self.monitoring.kpi(snapshots.values(), now_ms)
        oee = self.monitoring.oee(snapshots.values(), now_ms)

        oee_signature = (
            oee.availability,
            oee.performance,
            oee.quality,
            oee.oee,
        )
        if oee_signature != self._last_oee_signature:
            self._last_oee_signature = oee_signature
            self.dispatcher.emit(
                connection_id="runtime",
                kind="oee_update",
                message="OEE tazelendi.",
                data=oee.to_dict(),
            )

        production_signature = (
            kpi.production,
            kpi.scrap,
            kpi.queue,
            kpi.active_machines,
            kpi.down_machines,
            kpi.blocked_machines,
        )
        if production_signature != self._last_production_signature:
            self._last_production_signature = production_signature
            self.dispatcher.emit(
                connection_id="runtime",
                kind="production_update",
                message="Üretim ölçümleri tazelendi.",
                data=kpi.to_dict(),
            )

    def _broadcast_device_event(self, event: DeviceDataEvent) -> None:
        """Ölçümü olay akışına (SSE) yazar.

        Yalnızca **kullanılabilir** ölçümler yayılır; bozuk kaliteli bir değeri
        ekrana göndermek, arızalı bir sensörü canlı veri gibi göstermek olurdu.
        Bozuk ölçüm sayaçlarda görünür (`dispatcher.unusable`).
        """
        if not event.is_usable:
            return
        self.dispatcher.emit(
            connection_id=event.connector_id,
            kind="device_data",
            message=(
                f"{event.machine_id} · {event.field} = {event.value}"
            ),
            data=event.to_dict(),
        )

    def _persist_downtime(self, event: DowntimeEvent) -> None:
        """Duruşu diske yazar; aktif organizasyon bilinmiyorsa yazmaz."""
        if self.active_org_id is None:
            return
        self.repository.save_downtime(self.active_org_id, event)

    # -- Lisans -------------------------------------------------------------

    def usage_counts(self, org_id: str) -> UsageCounts:
        """Kiracının o andaki kullanımı.

        Sayılamayan kaynak `None` kalır. Kullanıcı sayısı bu katmandan
        okunamaz (kimlik deposu ayrı bir bileşendir) ve uydurulmaz;
        arayüz "ölçülmedi" gösterir.
        """
        snapshots = self._current_snapshots(org_id)
        return UsageCounts(
            users=None,
            machines=len(snapshots) if snapshots else 0,
            # Fabrika sayısı fabrika deposundan gelir; runtime katmanı onu
            # görmez ve tahmin etmez.
            factories=None,
        )

    def license_view(
        self, org_id: str, now_ms: Optional[int] = None
    ) -> Dict[str, object]:
        """Lisans ekranının okuduğu tam görünüm."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        record = self.repository.get_license(org_id)
        return evaluate_license(record, self.usage_counts(org_id), moment)

    def start_trial(
        self, org_id: str, customer: str = "", actor: str = "sistem",
        now_ms: Optional[int] = None,
    ) -> Dict[str, object]:
        """On dört günlük deneme lisansı açar.

        Var olan bir lisansın üstüne yazılmaz: ücretli bir lisansı denemeye
        düşürmek, müşterinin satın aldığı sınırları geri almak olurdu.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        existing = self.repository.get_license(org_id)
        if existing is not None:
            return {
                "created": False,
                "reason": "Bu kurulumda zaten bir lisans var.",
                "license": existing.to_dict(moment),
            }
        record = trial_license(org_id, moment, customer=customer, issued_by=actor)
        self.repository.save_license(org_id, record)
        self._record_audit(
            org_id,
            AuditAction.ROLE_CHANGE,
            resource="license",
            actor=actor,
            outcome=AuditOutcome.SUCCESS,
            details={"islem": "deneme", "plan": record.tier.value},
        )
        return {"created": True, "reason": None, "license": record.to_dict(moment)}

    def issue_license(
        self,
        org_id: str,
        tier: LicenseTier,
        days: int,
        customer: str = "",
        actor: str = "sistem",
        license_key: Optional[str] = None,
        now_ms: Optional[int] = None,
    ) -> Dict[str, object]:
        """Lisans üretir ve kaydeder; var olanın üstüne yazar."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        record = build_license(
            org_id,
            tier,
            moment,
            days=days,
            customer=customer,
            issued_by=actor,
            license_key=license_key,
        )
        self.repository.save_license(org_id, record)
        self._record_audit(
            org_id,
            AuditAction.ROLE_CHANGE,
            resource="license",
            actor=actor,
            outcome=AuditOutcome.SUCCESS,
            details={"islem": "lisans", "plan": tier.value, "gun": days},
        )
        return record.to_dict(moment)

    def revoke_license(
        self, org_id: str, reason: str, actor: str = "sistem",
        now_ms: Optional[int] = None,
    ) -> Optional[Dict[str, object]]:
        """Lisansı iptal eder; lisans yoksa `None`."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        record = self.repository.get_license(org_id)
        if record is None:
            return None
        record.revoked_at_ms = moment
        record.revoked_reason = reason
        self.repository.save_license(org_id, record)
        self._record_audit(
            org_id,
            AuditAction.ROLE_CHANGE,
            resource="license",
            actor=actor,
            outcome=AuditOutcome.SUCCESS,
            details={"islem": "iptal", "neden": reason},
        )
        return record.to_dict(moment)

    def can_add_resource(
        self, org_id: str, resource: str, now_ms: Optional[int] = None
    ) -> Dict[str, object]:
        """Yeni bir kayıt açılabilir mi? Ölçülemiyorsa `allowed` `None`."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        return can_add(
            self.repository.get_license(org_id),
            self.usage_counts(org_id),
            resource,
            moment,
        )

    # -- Kurulum tokenı -----------------------------------------------------

    def issue_install_token(
        self,
        org_id: str,
        actor: str = "sistem",
        site: str = "",
        ttl_hours: Optional[int] = None,
        now_ms: Optional[int] = None,
    ) -> Dict[str, object]:
        """Tek kullanımlık kurulum tokenı üretir.

        Token metni **yalnızca bu yanıtta** döner; depoya yazılmaz ve ikinci
        kez sorulduğunda yoktur.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        sequence = self.repository.next_token_sequence(org_id)
        issued = issue_token(
            org_id, moment, sequence, created_by=actor, site=site, ttl_hours=ttl_hours
        )
        self.repository.save_install_token(org_id, issued.record)
        self._record_audit(
            org_id,
            AuditAction.INVITATION,
            resource=f"install_token/{issued.record.id}",
            actor=actor,
            outcome=AuditOutcome.SUCCESS,
            details={"islem": "token", "tesis": site},
        )
        return issued.to_dict(moment)

    def install_tokens(
        self, org_id: str, now_ms: Optional[int] = None
    ) -> List[Dict[str, object]]:
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        return [item.to_dict(moment) for item in self.repository.list_install_tokens(org_id)]

    def redeem_install_token(
        self,
        org_id: str,
        token: str,
        actor: str,
        used_from: Optional[str] = None,
        now_ms: Optional[int] = None,
    ) -> Dict[str, object]:
        """Tokenı kullanır; sonucu ve nedenini döndürür."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        record = self.repository.find_install_token(org_id, token_digest(token))
        if record is None:
            # Bulunamayan token için "eşleşmedi" denir, "yok" değil: hangi
            # tokenların var olduğunu sızdırmak, deneme yanılmayı kolaylaştırırdı.
            return {"ok": False, "reason": "Token eşleşmedi.", "status": None}
        result = redeem_token(record, token, moment, actor, used_from=used_from)
        if result["ok"]:
            self.repository.save_install_token(org_id, record)
            self._record_audit(
                org_id,
                AuditAction.INVITATION,
                resource=f"install_token/{record.id}",
                actor=actor,
                outcome=AuditOutcome.SUCCESS,
                details={"islem": "kullanim", "adres": used_from},
            )
        result["token_id"] = record.id
        return result

    def revoke_install_token(
        self,
        org_id: str,
        token_id: str,
        reason: str,
        actor: str = "sistem",
        now_ms: Optional[int] = None,
    ) -> Optional[Dict[str, object]]:
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        record = self.repository.get_install_token(org_id, token_id)
        if record is None:
            return None
        changed = revoke_token(record, moment, reason, actor)
        if changed:
            self.repository.save_install_token(org_id, record)
        payload = record.to_dict(moment)
        payload["revoked"] = changed
        return payload

    def note_install_step(
        self,
        org_id: str,
        token_id: str,
        step: str,
        actor: str,
        now_ms: Optional[int] = None,
    ) -> Optional[Dict[str, object]]:
        """Kurulum adımını token günlüğüne yazar."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        record = self.repository.get_install_token(org_id, token_id)
        if record is None:
            return None
        note_step(record, moment, step, actor)
        self.repository.save_install_token(org_id, record)
        return record.to_dict(moment)

    # -- Makine etiketleri --------------------------------------------------

    def machine_labels(self, org_id: str) -> List[Dict[str, object]]:
        return [item.to_dict() for item in self.repository.list_machine_labels(org_id)]

    def save_machine_label(
        self,
        org_id: str,
        machine_id: str,
        label: str,
        line: str = "",
        note: str = "",
        actor: str = "sistem",
        now_ms: Optional[int] = None,
    ) -> Dict[str, object]:
        """Makineye kalıcı saha kimliği verir."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        existing = self.repository.get_machine_label(org_id, machine_id)
        record = MachineLabel(
            org_id=org_id,
            machine_id=machine_id,
            label=label,
            line=line,
            # Etiket değiştiyse basım anı silinir: eski etiket artık makinenin
            # üstündekiyle aynı değildir ve yeniden basılmalıdır.
            printed_at_ms=(
                existing.printed_at_ms
                if existing is not None and existing.label == label
                else None
            ),
            created_at_ms=existing.created_at_ms if existing is not None else moment,
            created_by=existing.created_by if existing is not None else actor,
            note=note,
        )
        self.repository.save_machine_label(org_id, record)
        return record.to_dict()

    def mark_labels_printed(
        self, org_id: str, labels: List[str], now_ms: Optional[int] = None
    ) -> int:
        """Basılan etiketleri işaretler; işaretlenen sayısını döndürür."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        marked = 0
        for record in self.repository.list_machine_labels(org_id):
            if record.label not in labels:
                continue
            record.printed_at_ms = moment
            self.repository.save_machine_label(org_id, record)
            marked += 1
        return marked

    def label_review(self, org_id: str) -> Dict[str, object]:
        """Etiket denetimi: çakışma ve etiketsiz makineler."""
        records = self.repository.list_machine_labels(org_id)
        machines = sorted(self._current_snapshots(org_id))
        return {
            "labels": [item.to_dict() for item in records],
            "duplicates": duplicate_labels(records),
            "unlabeled": unlabeled_machines(machines, records),
            "suggestions": {
                machine: suggest_label(machine)
                for machine in unlabeled_machines(machines, records)
            },
            "machine_count": len(machines),
        }

    # -- Saha tanılama, kontrol listesi ve dışa aktarma ----------------------

    def field_diagnostics(
        self, org_id: str, now_ms: Optional[int] = None
    ) -> Dict[str, object]:
        """Saha tanılama ekranı; ölçülemeyen satır `null` döner.

        Ping ayrı bir ölçüm değildir: bağlantıların en düşük gecikmesi ağın
        gecikmesine en yakın değerdir. Ayrı bir ICMP denemesi yapmak, sunucuya
        ham soket yetkisi gerektirir ve çoğu kurulumda engellidir; olmayan bir
        ölçümü uydurmaktansa var olanı kullanmak doğrudur.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        states = self.registry.list(org_id)
        # `avg_latency_ms` bir **yöntemdir**, alan değil: çağrılmadan
        # kullanıldığında karşılaştırma iki yöntem nesnesi arasında yapılır ve
        # uç 500 döner. Tarayıcıda gerçek bağlantılarla görüldü.
        latencies = [
            value
            for value in (state.health.avg_latency_ms() for state in states)
            if value is not None
        ]
        by_kind = {state.spec.kind.value: state for state in states}

        def connected(kind: str) -> Optional[bool]:
            state = by_kind.get(kind)
            return None if state is None else state.ever_verified

        def detail(kind: str) -> Optional[str]:
            state = by_kind.get(kind)
            if state is None:
                return None
            probe = state.last_probe
            return None if probe is None else probe.detail

        opcua = by_kind.get("opcua")
        packets = sum(state.health.packets for state in states) if states else None
        errors = sum(state.health.errors for state in states) if states else None

        ages = [
            item["age_ms"]
            for item in self.continuity.states(moment)
            if item["age_ms"] is not None
        ]

        data = fielddiag.FieldInput(
            ping_ms=min(latencies) if latencies else None,
            opcua_latency_ms=None if opcua is None else opcua.health.avg_latency_ms(),
            opcua_connected=connected("opcua"),
            mqtt_connected=connected("mqtt"),
            mqtt_detail=detail("mqtt"),
            rest_connected=connected("rest"),
            rest_detail=detail("rest"),
            last_data_age_ms=min(ages) if ages else None,
            # Saat sapması cihazdan okunamıyor: OPC UA sunucu saati ayrı bir
            # düğümdür ve her sunucuda yoktur. Uydurmak yerine `None`.
            clock_skew_ms=None,
            packets=packets,
            errors=errors,
            endpoint=states[0].spec.endpoint if states else "",
        )
        return fielddiag.build(data, moment).to_dict()

    def deployment_checklist(
        self,
        org_id: str,
        mapped_tags: Optional[int] = None,
        unmapped_tags: Optional[int] = None,
        discovered_tags: Optional[int] = None,
        signature_recorded: Optional[bool] = None,
        backup_verified: Optional[bool] = None,
        now_ms: Optional[int] = None,
    ) -> Dict[str, object]:
        """Pilot kurulum kontrol listesi.

        Keşif, eşleme, imza ve yedek durumu bu katmandan okunamaz; çağıran
        verir. Verilmediğinde `None` kalır ve adım "ölçülemedi" görünür —
        `False` varsayılsaydı, ölçülmemiş bir adım "yapılmadı" diye
        raporlanırdı.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        license_view = self.license_view(org_id, moment)
        counts = self.monitoring.alarms.store.counts()
        status = self.production_status(org_id, now_ms=moment)

        data = DeploymentInput(
            server_up=True,
            database_ready=self.repository.is_persistent,
            license_active=bool(license_view.get("healthy")),
            discovered_tags=discovered_tags,
            mapped_tags=mapped_tags,
            unmapped_tags=unmapped_tags,
            telemetry_rows=self.repository.telemetry_count(org_id),
            alarms_raised=counts.get("raised_total"),
            oee=status.get("oee"),
            backup_verified=backup_verified,
            signature_recorded=signature_recorded,
        )
        report = build_checklist_report(data)
        payload = report.to_dict()
        payload["summary"] = describe_checklist(report)
        return payload

    def export_data(
        self, org_id: str, kind: str, now_ms: Optional[int] = None
    ) -> Optional[Dict[str, object]]:
        """Gerçek veriyi CSV'ye çevirir; tanınmayan tür için `None`.

        Yalnızca kayıtlı veriler aktarılır. Benzetim çıktısı bu yoldan çıkmaz;
        çıksaydı, müşterinin elindeki dosyada hangi satırın cihazdan geldiği
        bilinemezdi.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        if not data_export.is_supported(kind):
            return None
        if kind == "telemetry":
            self.flush_telemetry(org_id, moment)
            points = self.repository.query_telemetry(org_id, limit=data_export.MAX_ROWS + 1)
            result = data_export.export_telemetry(points)
        elif kind == "alarms":
            center = self.alarm_center(org_id, moment)
            rows = list(center.get("active", [])) + list(center.get("history", []))
            result = data_export.export_alarms(rows)
        else:
            # OEE geçmişi ayrı bir tabloda tutulmuyor; şu anki hesap tek satır
            # olarak verilir ve bu açıkça söylenir.
            status = self.production_status(org_id, now_ms=moment)
            result = data_export.export_oee(
                [
                    {
                        "at_ms": moment,
                        "machine_id": "tesis",
                        "availability": None,
                        "performance": None,
                        "quality": None,
                        "oee": status.get("oee"),
                    }
                ]
            )
        payload = result.to_dict()
        payload["content"] = result.content
        return payload

    # -- Kesintisizlik, telemetri ve yükseltme ------------------------------

    def evaluate_continuity(self, now_ms: Optional[int] = None) -> List[Dict[str, object]]:
        """Akışların canlılığını gözden geçirir ve olayları yayar.

        Yalnızca **değişiklik** olay üretir: bir dakika susan bir cihaz her
        turda yeniden bildirilseydi, olay günlüğü okunamaz hâle gelirdi.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        produced: List[Dict[str, object]] = []
        for event in self.continuity.evaluate(moment):
            self._emit_continuity(event)
            produced.append(event.to_dict())
        for beat in self.continuity.heartbeats(moment):
            self._emit_continuity(beat)
            produced.append(beat.to_dict())
        return produced

    def evaluate_escalation(
        self, org_id: str, now_ms: Optional[int] = None
    ) -> List[Dict[str, object]]:
        """Bakım pencerelerini uygular ve sahipsiz alarmları yükseltir."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        store = self.monitoring.alarms
        store.apply_maintenance(self.maintenance, moment)
        actions = self.escalation.evaluate(store.active, moment)
        store.apply_actions(actions, moment)
        for action in actions:
            self.dispatcher.emit(
                connection_id="runtime",
                kind="alarm_escalation",
                message=action.message,
                level=EventLevel.WARNING,
                data=action.to_dict(),
            )
        return [action.to_dict() for action in actions]

    def silence_alarm(
        self,
        org_id: str,
        alarm_id: str,
        by: str,
        duration_ms: Optional[int] = None,
        reason: str = "Elle susturuldu",
        now_ms: Optional[int] = None,
    ) -> Optional[Dict[str, object]]:
        """Alarmın bildirimini geçici olarak keser.

        Alarm **kapatılmaz**: nedeni sürüyor, yalnızca bildirimi kesiliyor.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        alarm = self.monitoring.alarms.silence(
            alarm_id, by, moment, duration_ms=duration_ms, reason=reason
        )
        if alarm is None:
            return None
        self._record_audit(
            org_id,
            AuditAction.ALARM_ACKNOWLEDGE,
            resource=alarm_id,
            actor=by,
            outcome=AuditOutcome.SUCCESS,
            details={"islem": "susturma", "neden": reason},
        )
        return alarm.to_dict(moment)

    def unsilence_alarm(
        self, org_id: str, alarm_id: str, now_ms: Optional[int] = None
    ) -> Optional[Dict[str, object]]:
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        alarm = self.monitoring.alarms.unsilence(alarm_id, moment)
        return None if alarm is None else alarm.to_dict(moment)

    def open_maintenance(
        self,
        org_id: str,
        subject: str,
        start_ms: int,
        end_ms: int,
        reason: str = "Planlı bakım",
        opened_by: str = "sistem",
    ) -> Dict[str, object]:
        """Bakım penceresi açar ve o makinenin alarmlarını susturur."""
        window = self.maintenance.open(
            MaintenanceWindow(
                subject=subject,
                start_ms=start_ms,
                end_ms=end_ms,
                reason=reason,
                opened_by=opened_by,
            )
        )
        self.monitoring.alarms.apply_maintenance(self.maintenance, start_ms)
        return window.to_dict(start_ms)

    def close_maintenance(self, org_id: str, subject: str) -> bool:
        return self.maintenance.close(subject)

    def maintenance_windows(self, now_ms: Optional[int] = None) -> List[Dict[str, object]]:
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        return self.maintenance.windows(moment)

    def telemetry_trend(
        self,
        org_id: str,
        device: str,
        tag: str,
        window_id: str,
        now_ms: Optional[int] = None,
    ) -> Optional[Dict[str, object]]:
        """Trend serisi; pencere tanınmıyorsa `None`.

        Bekleyen ölçümler önce diske yazılır: tamponda duran son beş
        saniyelik veri grafikte eksik görünseydi, kullanıcı canlı ekranla
        trendin uyuşmadığını görürdü.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        self.flush_telemetry(org_id, moment)
        return load_series(self.repository, org_id, device, tag, window_id, moment)

    def telemetry_tags(self, org_id: str, now_ms: Optional[int] = None) -> List[Dict[str, str]]:
        """Kayıtlı cihaz-etiket çiftleri; trend ekranının seçim listesi."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        self.flush_telemetry(org_id, moment)
        return [
            {"device": device, "tag": tag}
            for device, tag in self.repository.telemetry_tags(org_id)
        ]

    def flush_telemetry(self, org_id: str, now_ms: Optional[int] = None) -> int:
        """Tampondaki ölçümleri diske yazar; yazılan satır sayısını döndürür."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        writer = self._writers.get(org_id)
        return 0 if writer is None else writer.flush(moment)

    def run_cleanup(self, org_id: str, now_ms: Optional[int] = None) -> Optional[Dict[str, object]]:
        """Zamanı geldiyse saklama temizliği yapar; gelmediyse `None`."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        if not self.cleanup.due(moment):
            return None
        return self.cleanup.run(org_id, moment).to_dict()

    def diagnostics(self, org_id: str, now_ms: Optional[int] = None) -> Dict[str, object]:
        """Tanılama ekranının okuduğu görünüm.

        Bütün sayılar gerçek sayaçlardan gelir; ölçülemeyen her alan `null`
        döner ve nedeni yazılır.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        writer = self._writers.get(org_id)
        report = build_report(
            moment,
            dispatcher_stats=self.stream.dispatcher.stats(),
            liveness=self.continuity.states(moment),
            writer_stats=None if writer is None else writer.diagnostics(moment),
        )
        payload = report.to_dict()
        payload["cleanup"] = self.cleanup.stats()
        payload["telemetry_rows"] = self.repository.telemetry_count(org_id)
        payload["oldest_telemetry_ms"] = self.repository.oldest_telemetry_ms(org_id)
        payload["persistence_mode"] = self.repository.mode
        return payload

    # -- İzleme -------------------------------------------------------------

    def connection_views(self, org_id: str) -> List[ConnectionView]:
        """Alarm kurallarının gördüğü bağlantı özeti."""
        return [
            ConnectionView(
                connection_id=state.spec.connection_id,
                label=state.spec.label,
                status=state.status.value,
                ever_verified=state.ever_verified,
            )
            for state in self.registry.list(org_id)
        ]

    def evaluate_monitoring(
        self, org_id: str, now_ms: Optional[int] = None
    ) -> Dict[str, object]:
        """Alarmları ve duruşları güncel duruma göre yeniden değerlendirir.

        Her okuma öncesi çağrılır. Değerlendirme yalnızca veri geldiğinde
        yapılsaydı, veri **gelmediği** için açılması gereken "veri yok" alarmı
        hiç açılmazdı: susan bir cihaz hiçbir olay üretmez.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        snapshots = self._current_snapshots(org_id)
        return self.monitoring.observe(
            snapshots.values(), self.connection_views(org_id), moment
        )

    def _current_snapshots(self, org_id: str) -> Dict[str, MachineSnapshotRecord]:
        return self.devices.snapshots_by_machine or self.repository.list_snapshots(org_id)

    def alarm_center(self, org_id: str, now_ms: Optional[int] = None) -> Dict[str, object]:
        """Alarm merkezi ekranının okuduğu tam durum."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        self.evaluate_monitoring(org_id, moment)
        return self.monitoring.state(moment)

    def acknowledge_alarm(
        self, org_id: str, alarm_id: str, by: str, now_ms: Optional[int] = None
    ) -> Optional[Dict[str, object]]:
        """Alarmı görüldü olarak işaretler.

        Onaylanan alarm **yeniden açılmaz**: neden sürdüğü için her
        değerlendirmede aday listesine yeniden girer ama durumu korunur (bkz.
        `AlarmStore.sync`). Aksi hâlde operatörün gördüğü alarm bir saniye
        sonra yeniden yanıp sönerdi.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        alarm = self.monitoring.alarms.acknowledge(alarm_id, by, moment)
        if alarm is None:
            return None

        self.dispatcher.emit(
            connection_id="runtime",
            kind="alarm_acknowledged",
            message=f"{alarm.message} ({by} tarafından görüldü)",
            data={"alarm_id": alarm_id, "by": by},
        )
        self._record_audit(
            org_id,
            AuditAction.ALARM_ACKNOWLEDGE,
            alarm_id,
            actor=by,
            details={"severity": alarm.severity.value, "subject": alarm.subject},
        )
        return alarm.to_dict(moment)

    def production_status(
        self,
        org_id: str,
        now_ms: Optional[int] = None,
        planned_time_ms: Optional[float] = None,
        ideal_cycle_seconds: Optional[float] = None,
    ) -> Dict[str, object]:
        """Operatör panosundaki Üretim Durumu kartı."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        self.evaluate_monitoring(org_id, moment)
        snapshots = self._current_snapshots(org_id)
        return self.monitoring.production_status(
            snapshots.values(), moment, planned_time_ms, ideal_cycle_seconds
        )

    def timeline(
        self, org_id: str, now_ms: Optional[int] = None, limit: int = 100
    ) -> List[Dict[str, object]]:
        """Duruş ve alarmların birleşik zaman çizelgesi."""
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        self.evaluate_monitoring(org_id, moment)
        return self.monitoring.timeline(moment, limit)

    def health_score(self, org_id: str, now_ms: Optional[int] = None) -> Dict[str, object]:
        """Köprünün 0-100 arası sağlık skoru.

        Bağlantı başına hesaplanır ve ortalaması alınır; hiçbir bağlantıda
        ölçüm yoksa skor `None` döner.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        per_connection: List[Dict[str, object]] = []

        for state in self.registry.list(org_id):
            uptime = state.health.uptime_ms(moment)
            result = compute_health_score(
                HealthInput(
                    uptime_ms=uptime,
                    # Pencere, bağlantının açıldığı andan bu yana geçen
                    # süredir; bağlı değilse ölçülemez ve `None` kalır.
                    window_ms=None if uptime is None else max(uptime, 1),
                    packets=state.health.packets,
                    errors=state.health.errors,
                    # Kopma sayısı ancak bağlantı bir kez kurulduysa
                    # anlamlıdır. Hiç bağlanmamış bir bağlantı için sıfır
                    # kopma geçilseydi, hiç denenmemiş bir hat "kusursuz
                    # kararlı" sayılır ve skoru 100 çıkardı.
                    reconnects=(
                        state.health.reconnects if state.ever_verified else None
                    ),
                    avg_latency_ms=state.health.avg_latency_ms(),
                )
            )
            per_connection.append(
                {"connection_id": state.spec.connection_id, **result.to_dict()}
            )

        scores = [item["score"] for item in per_connection if item["score"] is not None]
        overall = round(sum(scores) / len(scores), 1) if scores else None

        return {
            "score": overall,
            "label": score_label(overall),
            "connections": per_connection,
            "measured": len(scores),
            "total": len(per_connection),
        }

    def _on_event(self, event: RuntimeEvent) -> None:
        """Yayılan her olayı kalıcı günlüğe yazar.

        Aktif organizasyon bilinmiyorsa yazılmaz: yanlış kiracının günlüğüne
        olay eklemektense hiç eklememek yeğdir.
        """
        if self.active_org_id is None:
            return
        self._persist_event(self.active_org_id, event)

    def _persist_event(self, org_id: str, event: RuntimeEvent) -> None:
        """Olayı kalıcı günlüğe yazar (yeniden oynatma için)."""
        self.repository.append_event(
            org_id,
            StoredEvent(
                sequence=event.sequence,
                connection_id=event.connection_id,
                kind=event.kind,
                level=event.level.value,
                message=event.message,
                at_ms=event.at_ms,
                data=dict(event.data),
            ),
        )

    def recover(self, org_id: str) -> Dict[str, object]:
        """Diskteki durumu belleğe geri yükler.

        Geri yüklenen bir bağlantı **bağlı sayılmaz**: yalnızca tanımı geri
        gelir ve durumu "Test edilmedi" olur. Bağlantının gerçekten kurulup
        kurulmadığı, ancak yeni bir deneme ile anlaşılır.
        """
        self.active_org_id = org_id

        # Olay numaralandırması kalıcı günlüğün bıraktığı yerden sürer; aksi
        # hâlde yeni olaylar diskteki numaralarla çakışır ve yazılamaz.
        self.dispatcher.buffer.resume_from(self.repository.last_sequence(org_id))

        stored = self.repository.list_connections(org_id)
        restored: List[str] = []
        streams_to_start: List[str] = []

        for item in stored:
            spec = ConnectionSpec(
                connection_id=item.connection_id,
                kind=ConnectionKind(item.kind),
                label=item.label,
                endpoint=item.endpoint,
                port=item.port,
                username=item.username,
                # Parola diske yazılmadığı için geri yüklenemez; parola
                # gerektiren bağlantı yeniden denendiğinde kullanıcıdan istenir.
                password=None,
                topics=list(item.topics),
                security_policy=SecurityPolicy(item.security_policy),
                qos=item.qos,
                timeout_ms=item.timeout_ms,
                max_retries=item.max_retries,
            )
            state = self.registry.upsert(org_id, spec)
            state.ever_verified = item.ever_verified
            state.status = ConnectionStatus.IDLE
            restored.append(item.connection_id)

            if item.mapping:
                self.mappings[item.connection_id] = MappingTable(
                    entries=[
                        MetricMapping(
                            origin=entry.get("origin", ""),
                            machine_id=entry.get("machine_id", ""),
                            metric=Metric(entry.get("metric", "unknown")),
                            unit=entry.get("unit"),
                        )
                        for entry in item.mapping
                    ]
                )

            if item.stream_enabled:
                streams_to_start.append(item.connection_id)

            health = self.repository.get_health(org_id, item.connection_id)
            if health is not None:
                state.health.packets = health.packets
                state.health.errors = health.errors
                state.health.reconnects = health.reconnects
                state.health.last_error = health.last_error
                state.health.last_packet_at_ms = health.last_packet_at_ms
                health.recoveries += 1
                self.repository.save_health(org_id, health)

        snapshots = self.repository.list_snapshots(org_id)
        self.devices.load_snapshots(snapshots)

        # Duruşlar da geri yüklenir: yeniden başlatma sırasında süren bir
        # arıza, sunucu ayağa kalktığında sıfırdan başlamış görünmemelidir.
        downtime_restored = self.monitoring.load_downtime(
            self.repository.list_downtime(org_id)
        )

        self.dispatcher.emit(
            connection_id="runtime",
            kind="recovered",
            message=(
                f"{len(restored)} bağlantı ve {len(snapshots)} makine görüntüsü "
                "diskten geri yüklendi. Bağlantılar yeniden doğrulanmalı."
            ),
            data={
                "connections": len(restored),
                "snapshots": len(snapshots),
                "streams_pending": len(streams_to_start),
                "downtime": downtime_restored,
            },
        )

        self._record_audit(
            org_id,
            AuditAction.RUNTIME_RECOVERY,
            "runtime",
            details={
                "connections": len(restored),
                "snapshots": len(snapshots),
                "downtime": downtime_restored,
            },
        )

        return {
            "connections": restored,
            "snapshots": len(snapshots),
            "downtime": downtime_restored,
            "streams_pending": streams_to_start,
            "persistent": self.repository.is_persistent,
            "mode": self.repository.mode,
        }

    def recover_all(self) -> Dict[str, object]:
        """Diskteki bütün kiracıların durumunu geri yükler.

        Sunucu açılışında çağrılır. Kullanıcının bir düğmeye basması
        beklenseydi, yeniden başlatmadan sonra ekranı ilk açan kişiye kadar
        hiçbir alarm değerlendirilmez ve o aradaki duruşlar kaydedilmezdi.

        Bir kiracının kurtarması başarısız olursa öteki kiracılar yine
        kurtarılır: tek bir bozuk kayıt bütün fabrikayı karanlıkta bırakmamalı.
        """
        results: Dict[str, object] = {}
        failures: Dict[str, str] = {}

        for org_id in self.repository.known_orgs():
            try:
                results[org_id] = self.recover(org_id)
            except Exception as error:  # noqa: BLE001
                failures[org_id] = str(error)

        # Kurtarma **bağlantı kurmaz**: geri yüklenen bağlantıların durumu
        # "Test edilmedi" kalır ve arayüz bunu böyle gösterir.
        return {
            "orgs": list(results),
            "results": results,
            "failures": failures,
            "persistent": self.repository.is_persistent,
            "mode": self.repository.mode,
        }

    def live_state(
        self,
        org_id: str,
        now_ms: Optional[int] = None,
        planned_time_ms: Optional[float] = None,
        ideal_cycle_seconds: Optional[float] = None,
    ) -> Dict[str, object]:
        """Live Factory'nin okuduğu durum: görüntüler, KPI ve alarmlar.

        Kaynak **görüntülerdir**, olay akışı değil: ekran açıldığında geçmişi
        yeniden oynatmak gerekmez.

        Alarmlar da buradan gelir. Ekran kendi eşiğini uygulasaydı, aynı
        makine için Live Factory'de görünen alarm Alarm Merkezi'nde
        görünmeyebilir ve operatör hangisine güveneceğini bilemezdi.
        """
        moment = now_ms if now_ms is not None else int(time.time() * 1000)
        snapshots = self.devices.snapshots_by_machine or self.repository.list_snapshots(
            org_id
        )

        self.evaluate_monitoring(org_id, moment)
        runtime_kpi = self.monitoring.kpi(snapshots.values(), moment, planned_time_ms)
        oee = self.monitoring.oee(
            snapshots.values(), moment, planned_time_ms, ideal_cycle_seconds
        )
        alarms = self.monitoring.state(moment)

        return {
            "machines": [item.to_dict() for item in snapshots.values()],
            # Görüntülerden çıkan ham toplamlar; geriye dönük uyumluluk için
            # korunur.
            "kpi": aggregate_kpi(snapshots).to_dict(),
            # Duruş, hız ve kullanılabilirlik dahil tam KPI seti.
            "runtime_kpi": runtime_kpi.to_dict(),
            "oee": oee.to_dict(),
            "alarms": alarms["active"],
            "alarm_counts": alarms["counts"],
            "downtime": {
                "total_ms": self.monitoring.downtime.total_ms(moment),
                "open": self.monitoring.downtime.open_count(),
            },
            "overwrites": list(self.devices.overwrites[-20:]),
            "persistence": {
                "mode": self.repository.mode,
                "persistent": self.repository.is_persistent,
            },
            "at_ms": moment,
        }

    def runtime_dashboard(self, org_id: str, now_ms: Optional[int] = None) -> Dict[str, object]:
        """Runtime panosu: bağlantılar, kurtarma, olay hızı, kalıcılık.

        Olay hızı yalnızca **ölçülebiliyorsa** hesaplanır: tampondaki ilk ve
        son olay arasındaki süre bir saniyeden kısaysa `None` döner — bir
        saniyelik pencereden saniyedeki olay sayısı çıkarmak, ölçüm değil
        tahmin olurdu.
        """
        states = self.registry.list(org_id)
        events = self.dispatcher.buffer.all()

        throughput = None
        if len(events) >= 2:
            window_ms = events[-1].at_ms - events[0].at_ms
            if window_ms >= 1_000:
                throughput = len(events) / (window_ms / 1_000)

        health_rows = self.repository.list_health(org_id)

        return {
            "connections": len(states),
            "verified": len([item for item in states if item.ever_verified]),
            "streams_running": len(
                [item for item in self.stream_states(org_id) if item["running"]]
            ),
            "reconnects": sum(item.health.reconnects for item in states),
            "recoveries": sum(row.recoveries for row in health_rows),
            "events_buffered": len(events),
            "events_per_second": throughput,
            "persisted_events": self.repository.event_count(org_id),
            "snapshots": len(self.devices.snapshots_by_machine),
            "persistence_mode": self.repository.mode,
            "persistent": self.repository.is_persistent,
            # Pano da alarmları aynı merkezden okur.
            "alarms": self.monitoring.alarms.snapshot(
                now_ms if now_ms is not None else int(time.time() * 1000)
            )["counts"],
            "health_score": self.health_score(org_id, now_ms),
            "downtime_open": self.monitoring.downtime.open_count(),
            # Akış kartları: yoklama sıklığı, olay hızı, kuyruk derinliği ve
            # akış sağlığı. Hepsi ölçümdür; ölçülemeyen alan `null` döner.
            "stream": self.stream_stats(org_id),
            "at_ms": now_ms if now_ms is not None else int(time.time() * 1000),
        }

    # -- Akışlar ------------------------------------------------------------

    def set_mapping(self, connection_id: str, mapping: MappingTable) -> None:
        """Bağlantının eşleme tablosunu tanımlar."""
        self.mappings[connection_id] = mapping

    def mapping_for(self, connection_id: str) -> Optional[MappingTable]:
        return self.mappings.get(connection_id)

    def _ingest(self, connection_id: str):
        """Koşucudan gelen çeviri sonucunu cihaz kapısına aktarır."""

        def handle(result, at_ms: int) -> None:
            self.devices.ingest(result)

        return handle

    def build_runner(self, state: ConnectionState, interval_ms: Optional[int] = None):
        """Bağlantının türüne uygun akış kaynağını kurar.

        Gerçek protokol istemcisi burada bağlanır; kaynağın kendisi istemciyi
        bilmez ve bu yüzden ağsız sınanabilir.

        Üç kaynak da **aynı** dağıtıcıya yazar (`self.stream.dispatcher`):
        yineleme denetimi, sınırlı kuyruk ve alıcılar protokolden bağımsızdır.
        Her protokol kendi yolunu izleseydi, biri yinelemeyi eler öteki elemez
        ve iki ekran farklı üretim sayısı gösterirdi.
        """
        spec = state.spec
        mapping = self.mappings.get(spec.connection_id)
        kind = spec.kind.value

        if kind == "rest":
            return build_poller(
                spec=spec,
                fetch=rest_fetch(spec),
                engine=self.stream,
                mapping=mapping,
                interval_ms=interval_ms,
            )

        if kind == "mqtt":
            return build_mqtt_subscriber(
                spec=spec,
                source=lambda: mqtt_message_source(spec),
                engine=self.stream,
                mapping=mapping,
            )

        if kind == "opcua":
            return build_opcua_subscriber(
                spec=spec,
                source=lambda: opcua_subscription_source(spec),
                engine=self.stream,
                mapping=mapping,
            )

        return None

    async def start_stream(
        self,
        org_id: str,
        connection_id: str,
        interval_ms: Optional[int] = None,
    ) -> Dict[str, object]:
        """Bağlantı için sürekli veri akışını başlatır.

        Akış yalnızca **doğrulanmış** bir bağlantı için açılır: hiç yanıt
        vermemiş bir cihazı dinlemeye almak, ekranda "akış çalışıyor" yazıp
        hiçbir veri göstermemek olurdu.
        """
        state = self.registry.get(org_id, connection_id)

        if not state.ever_verified:
            reason = (
                "Akış başlatılmadı: bu bağlantı hiç doğrulanmadı. "
                "Önce 'Bağlan ve doğrula' ile cihazdan yanıt alın."
            )
            self.dispatcher.emit(
                connection_id=connection_id,
                kind="stream_refused",
                level=EventLevel.WARNING,
                message=reason,
            )
            return {"started": False, "reason": reason}

        blocked = source_availability(state.spec)
        if blocked is not None:
            self.dispatcher.emit(
                connection_id=connection_id,
                kind="stream_refused",
                level=EventLevel.WARNING,
                message=blocked,
            )
            return {"started": False, "reason": blocked}

        if self.streams.is_running(connection_id):
            return {"started": True, "reason": "Akış zaten açık."}

        runner = self.build_runner(state, interval_ms)
        if runner is None:
            reason = f"Doğrulanmadı: {state.spec.kind.value} için akış sürücüsü yok."
            return {"started": False, "reason": reason}

        self.streams.add(connection_id, runner)
        self._tasks[connection_id] = asyncio.ensure_future(runner.run())

        self.dispatcher.emit(
            connection_id=connection_id,
            kind="stream_started",
            message=f"{state.spec.label}: veri akışı açıldı.",
            data={"kind": state.spec.kind.value},
        )
        self._record_audit(
            org_id,
            AuditAction.STREAM_START,
            connection_id,
            details={"kind": state.spec.kind.value},
        )
        return {"started": True, "reason": None}

    async def stop_stream(self, org_id: str, connection_id: str) -> Dict[str, object]:
        """Akışı kapatır ve görevi iptal eder."""
        self.registry.get(org_id, connection_id)
        runner = self.streams.get(connection_id)
        if runner is None:
            return {"stopped": False, "reason": "Bu bağlantıda açık bir akış yok."}

        runner.stop()
        task = self._tasks.pop(connection_id, None)
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

        self.streams.remove(connection_id)
        self.dispatcher.emit(
            connection_id=connection_id,
            kind="stream_stopped",
            message="Veri akışı kapatıldı.",
        )
        return {"stopped": True, "reason": None}

    def stream_stats(self, org_id: str) -> Dict[str, object]:
        """Akış motorunun özeti: kuyruk, olay hızı, gecikme, yoklama sıklığı.

        Kiracıya göre süzülmez çünkü motor süreç genelindedir; kiracı ayrımı
        `stream_states` içinde bağlantı sahipliğiyle yapılır.
        """
        return self.stream.stats()

    def recent_device_data(self, org_id: str, limit: int = 50) -> List[Dict[str, object]]:
        """Son cihaz ölçümleri; yalnızca bu kiracının bağlantılarından."""
        return [
            row
            for row in self.stream.recent_events(limit * 2)
            if self.owns(org_id, str(row.get("connector_id", "")))
        ][:limit]

    def stream_states(self, org_id: str) -> List[Dict[str, object]]:
        """Bu organizasyonun akış durumları."""
        owned = {state.connection_id for state in self.registry.list(org_id)}
        return [
            state
            for state in self.streams.states()
            if state["connection_id"] in owned
        ]

    # -- Özet ---------------------------------------------------------------

    def health_report(self, org_id: str, now_ms: Optional[int] = None) -> Dict[str, object]:
        """Organizasyonun bağlantı sağlığı özeti.

        Ortalama gecikme yalnızca **ölçümü olan** bağlantılardan hesaplanır;
        ölçümü olmayanları sıfır sayıp ortalamaya katmak, tek bir çalışan
        bağlantının gecikmesini gerçekte olduğundan küçük gösterirdi.
        """
        states = self.registry.list(org_id)
        current = now_ms if now_ms is not None else int(time.time() * 1000)

        latencies = [
            state.health.avg_latency_ms()
            for state in states
            if state.health.avg_latency_ms() is not None
        ]

        return {
            "total": len(states),
            "connected": len(
                [s for s in states if s.status is ConnectionStatus.CONNECTED]
            ),
            "failed": len([s for s in states if s.status is ConnectionStatus.FAILED]),
            "retrying": len([s for s in states if s.status is ConnectionStatus.RETRYING]),
            "idle": len([s for s in states if s.status is ConnectionStatus.IDLE]),
            "verified_ever": len([s for s in states if s.ever_verified]),
            # Hiçbir bağlantıda ölçüm yoksa ortalama yoktur; sıfır değil `None`.
            "avg_latency_ms": (sum(latencies) / len(latencies)) if latencies else None,
            "total_packets": sum(state.health.packets for state in states),
            "total_errors": sum(state.health.errors for state in states),
            "reconnects": sum(state.health.reconnects for state in states),
            "buffered_events": len(self.dispatcher.buffer),
            "subscribers": self.dispatcher.subscriber_count,
            "at_ms": current,
        }

    def status_report(self, org_id: str, now_ms: Optional[int] = None) -> Dict[str, object]:
        """Bağlantıların tek tek durumu."""
        return {
            "connections": [state.to_dict(now_ms) for state in self.registry.list(org_id)],
            "at_ms": now_ms if now_ms is not None else int(time.time() * 1000),
        }

    def driver_report(self, org_id: str) -> Dict[str, object]:
        """Canlı ekranı hangi bağlantı beslemeli?

        Kararın kendisi `selection` modülündedir ve saftır; burası yalnızca o
        organizasyonun kayıtlarını verir. Karar mantığı yöneticinin içinde
        yazılsaydı, sınamak için bir yönetici örneği kurmak gerekirdi.
        """
        return selection_report(self.registry.list(org_id))

    def owns(self, org_id: str, connection_id: str) -> bool:
        """Bu organizasyonun böyle bir bağlantısı var mı?"""
        try:
            self.registry.get(org_id, connection_id)
            return True
        except ConnectionNotFound:
            return False
