/**
 * Sunucu köprüsünün istemcisi.
 *
 * Tarayıcı cihazlara değil **kendi sunucusuna** bağlanır; cihazla konuşan
 * taraf sunucudur. Bu dosyadaki tek ağ çağrısı `fetch`'tir ve hedefi her zaman
 * OptiFlow API'sidir.
 *
 * `fetch` neden bağlanıyor
 * ------------------------
 * `globalThis`'e bağlanmadan bir sınıf alanında saklanan `fetch`, çağrıldığında
 * `this` olarak sınıf örneğini alır ve tarayıcı "Illegal invocation" hatası
 * verir. Bu, SALES-7'de gerçek bir cihaz denemesinin sessizce düşmesine yol
 * açtı; aynı hatanın burada tekrarlanmaması için bağlama tek yerde yapılır.
 */

import { parseRuntimeDriver, type RuntimeDriver } from "./driver";
import {
  parseConnection,
  parseConnections,
  parseEventPage,
  parseSummary,
  toRequestBody,
} from "./parse";
import {
  parseDevicePage,
  parseStream,
  type DevicePage,
  type StreamStatus,
} from "./devices";
import {
  parseRuntimeDashboard,
  parseRuntimeLiveState,
  type RuntimeDashboard,
  type RuntimeLiveState,
} from "./live";
import {
  parseAlarmCenter,
  parseHealthScore,
  parseProductionStatus,
  parseTimeline,
  parseAlarm,
  parseMonitoringKpi,
  type HealthScoreView,
  type ProductionStatus,
  type TimelineEntry,
  type MonitoringKpi,
  type UnifiedAlarm,
} from "../../monitoring";
import {
  parseDeviceRows,
  parseFrame,
  parseStreamStats,
  type DeviceDataRow,
  type LiveStreamFrame,
  type StreamStats,
} from "../../stream";
import { SseBuffer, parseFrameData } from "./sse";
import { parseEvent } from "./parse";
import type {
  BridgeConnectRequest,
  BridgeConnection,
  BridgeEvent,
  BridgeEventPage,
  BridgeResult,
  BridgeSummary,
} from "./types";
import {
  parseContinuity,
  parseDiagnostics,
  type DiagnosticsReport,
  type StreamLiveness,
} from "../../diagnostics";
import {
  parseCredentialTest,
  parseDiscovery,
  type CredentialTest,
  type DiscoveryResult,
} from "../../provisioning";
import {
  parseSeries,
  parseTags,
  type TelemetryTag,
  type TrendSeries,
  type TrendWindowId,
} from "../../telemetry";
import {
  parseDeployment,
  parseFieldDiagnostics,
  parseIssuedToken,
  parseLabelReview,
  parseMachineLabel,
  parseToken,
  parseTokens,
  type DeploymentReport,
  type FieldDiagnostics,
  type InstallToken,
  type IssuedToken,
  type LabelReview,
  type MachineLabel,
} from "../../commissioning";
import { parseExport, type ExportKind, type ExportResult } from "../../export";
import { parseLicenseView, type LicenseView } from "../../licensing";

export const RUNTIME_PATH = "/api/runtime";

/** Akis baslatma/durdurma yaniti. */
export interface StreamStartResult {
  started: boolean;
  stopped: boolean;
  /** Baslatilamadiysa nedeni; basarida `null`. */
  reason: string | null;
  streams: StreamStatus[];
}

/**
 * Akis yanitini cozer.
 *
 * `started` alani eksikse **baslamadi** sayilir: belirsiz bir yaniti basari
 * saymak, hic acilmamis bir akis icin "veri geliyor" gostermek olurdu.
 */
export function parseStreamStart(value: unknown): StreamStartResult {
  const item = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    started: item.started === true,
    stopped: item.stopped === true,
    reason: typeof item.reason === "string" && item.reason !== "" ? item.reason : null,
    streams: Array.isArray(item.streams) ? item.streams.map(parseStream) : [],
  };
}

/** Kurtarma sonucu. */
export interface RuntimeRecoverResult {
  connections: string[];
  snapshots: number;
  streamsPending: string[];
  persistent: boolean;
  mode: string;
}

export function parseRecoverResult(value: unknown): RuntimeRecoverResult {
  const item = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    connections: Array.isArray(item.connections)
      ? item.connections.filter((entry): entry is string => typeof entry === "string")
      : [],
    snapshots: typeof item.snapshots === "number" ? item.snapshots : 0,
    streamsPending: Array.isArray(item.streams_pending)
      ? item.streams_pending.filter((entry): entry is string => typeof entry === "string")
      : [],
    persistent: item.persistent === true,
    mode: typeof item.mode === "string" ? item.mode : "memory",
  };
}

/** Kalici gunlukten yeniden oynatma sayfasi. */
export interface RuntimeReplayPage {
  events: BridgeEvent[];
  lastSequence: number;
  total: number;
  persistent: boolean;
  mode: string;
}

export function parseReplayPage(value: unknown): RuntimeReplayPage {
  const item = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    events: Array.isArray(item.events) ? item.events.map(parseEvent) : [],
    lastSequence: typeof item.last_sequence === "number" ? item.last_sequence : 0,
    total: typeof item.total === "number" ? item.total : 0,
    persistent: item.persistent === true,
    mode: typeof item.mode === "string" ? item.mode : "memory",
  };
}

/** Ağ hatalarının kullanıcıya gösterilecek hâli. */
export const BRIDGE_NETWORK_ERROR =
  "Sunucuya ulaşılamadı; köprü durumu okunamadı. Bağlantınızı ve sunucunun açık olduğunu kontrol edin.";

export interface BridgeClientOptions {
  baseUrl: string;
  /** Erişim belirteci sağlayıcısı; oturum yoksa `null` döner. */
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

/**
 * Kesif ve kimlik denemesi govdesi.
 *
 * Bos bir kullanici adi **gonderilmez**: bazi uclarda bos `Authorization`
 * basligi 400 uretir ve hata, olmayan bir kimlik sorunu gibi gorunurdu.
 */
function discoveryBody(payload: {
  kind: string;
  endpoint: string;
  port?: number | null;
  username?: string | null;
  password?: string | null;
  topics?: string[];
  timeoutMs?: number;
  useCache?: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    kind: payload.kind,
    endpoint: payload.endpoint,
    topics: payload.topics ?? [],
  };
  if (payload.port !== undefined && payload.port !== null) body.port = payload.port;
  if (payload.username) body.username = payload.username;
  if (payload.password) body.password = payload.password;
  if (payload.timeoutMs !== undefined) body.timeout_ms = payload.timeoutMs;
  if (payload.useCache !== undefined) body.use_cache = payload.useCache;
  return body;
}

export class RuntimeBridgeClient {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string | null>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BridgeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.getToken = options.getToken;
    const impl = options.fetchImpl ?? globalThis.fetch;
    /* Bkz. dosya başlığı: bağlanmazsa tarayıcıda "Illegal invocation". */
    this.fetchImpl = impl.bind(globalThis);
  }

  private async headers(): Promise<Record<string, string>> {
    const token = await this.getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token !== null) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    parse: (value: unknown) => T,
  ): Promise<BridgeResult<T>> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${RUNTIME_PATH}${path}`, {
        ...init,
        headers: { ...(await this.headers()), ...(init.headers ?? {}) },
      });

      if (!response.ok) {
        /*
         * Sunucu yanıt verdi ama olumsuz. Gövdedeki `detail` kullanıcıya
         * gösterilir; yoksa durum kodu yazılır — sessiz bir hata, ekranın
         * boş kalmasından beterdir.
         */
        let detail = `Sunucu ${response.status} döndü.`;
        try {
          const body = (await response.json()) as { detail?: unknown };
          if (typeof body.detail === "string" && body.detail !== "") {
            detail = body.detail;
          }
        } catch {
          /* Gövde okunamadı; durum kodu yeterli. */
        }
        return { data: null, error: detail };
      }

      return { data: parse(await response.json()), error: null };
    } catch {
      return { data: null, error: BRIDGE_NETWORK_ERROR };
    }
  }

  /** Bağlantıyı kaydeder ve sunucuda **gerçekten** dener. */
  connect(request: BridgeConnectRequest): Promise<BridgeResult<BridgeConnection>> {
    return this.request(
      "/connect",
      { method: "POST", body: JSON.stringify(toRequestBody(request)) },
      parseConnection,
    );
  }

  disconnect(
    connectionId: string,
    forget = false,
  ): Promise<BridgeResult<BridgeConnection>> {
    return this.request(
      "/disconnect",
      {
        method: "POST",
        body: JSON.stringify({ connection_id: connectionId, forget }),
      },
      parseConnection,
    );
  }

  /**
   * Canlı ekranı hangi bağlantının beslemesi gerektiğini sorar.
   *
   * `status()` bütün bağlantıların durumunu getirir; bu uç aralarından
   * **hangisinin** seçildiğini söyler. Yalnızca kararı okumak isteyen ekranın
   * bütün bağlantı listesini çekmesi gerekmez.
   */
  driver(): Promise<BridgeResult<RuntimeDriver>> {
    return this.request("/driver", { method: "GET" }, parseRuntimeDriver);
  }

  status(): Promise<BridgeResult<BridgeConnection[]>> {
    return this.request("/status", { method: "GET" }, parseConnections);
  }

  health(): Promise<BridgeResult<BridgeSummary>> {
    return this.request("/health", { method: "GET" }, parseSummary);
  }

  events(since = 0, connectionId?: string): Promise<BridgeResult<BridgeEventPage>> {
    const query = new URLSearchParams({ since: String(since) });
    if (connectionId !== undefined) {
      query.set("connection_id", connectionId);
    }
    return this.request(`/events?${query.toString()}`, { method: "GET" }, parseEventPage);
  }

  /** Cihaz verisi: olcumler, makine goruntuleri, tanilama ve akis durumlari. */
  devices(limit = 50, connectionId?: string): Promise<BridgeResult<DevicePage>> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (connectionId !== undefined) {
      query.set("connection_id", connectionId);
    }
    return this.request(
      `/devices?${query.toString()}`,
      { method: "GET" },
      parseDevicePage,
    );
  }

  /** Live Factory'nin okudugu durum: makine goruntuleri ve KPI. */
  live(): Promise<BridgeResult<RuntimeLiveState>> {
    return this.request("/live", { method: "GET" }, parseRuntimeLiveState);
  }

  /**
   * Live Factory'nin KPI seti — durus, hiz ve kullanilabilirlik dahil.
   *
   * `/live` ucundaki `runtime_kpi` alani okunur; `kpi` alani goruntulerden
   * cikan ham toplamlardir ve geriye donuk uyumluluk icin durur.
   */
  runtimeKpi(): Promise<BridgeResult<MonitoringKpi>> {
    return this.request("/live", { method: "GET" }, (value) =>
      parseMonitoringKpi(
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>).runtime_kpi
          : null,
      ),
    );
  }

  /** Runtime panosu: baglanti, kurtarma, olay hizi ve kalicilik. */
  dashboard(): Promise<BridgeResult<RuntimeDashboard>> {
    return this.request("/dashboard", { method: "GET" }, parseRuntimeDashboard);
  }

  /**
   * Diskteki baglantilari ve goruntuleri geri yukler.
   *
   * Akislar varsayilan olarak **yeniden baslatilmaz**: akis baslatmak cihaza
   * gercek istek gonderir ve bunu kullanici istemelidir.
   */
  recover(resumeStreams = false): Promise<BridgeResult<RuntimeRecoverResult>> {
    return this.request(
      "/recover",
      { method: "POST", body: JSON.stringify({ resume_streams: resumeStreams }) },
      parseRecoverResult,
    );
  }

  /**
   * Birlesik alarm merkezi.
   *
   * Live Factory, Alarm Merkezi ve runtime panosu **ayni** uctan okur; her
   * ekranin kendi esigini uygulamasi halinde ayni ariza uc farkli bicimde
   * gorunurdu.
   */
  alarms(): Promise<
    BridgeResult<{
      active: UnifiedAlarm[];
      history: UnifiedAlarm[];
      counts: ReturnType<typeof parseAlarmCenter>["counts"];
    }>
  > {
    return this.request("/alarms", { method: "GET" }, parseAlarmCenter);
  }

  /**
   * Bir alarmi gorüldü isaretler.
   *
   * Yalnizca acik bir alarm onaylanabilir; onaylanan alarm, nedeni surse bile
   * yeniden acilmaz.
   */
  acknowledgeAlarm(alarmId: string, by?: string): Promise<BridgeResult<UnifiedAlarm>> {
    return this.request(
      "/alarms/acknowledge",
      {
        method: "POST",
        body: JSON.stringify(by === undefined ? { alarm_id: alarmId } : { alarm_id: alarmId, by }),
      },
      (value) => parseAlarm(value),
    );
  }

  /**
   * Alarmin bildirimini gecici olarak keser.
   *
   * Alarm **kapatilmaz**: nedeni suruyor, yalnizca bildirimi kesiliyor. Sure
   * dolduğunda alarm kendiliginden geri doner. Suresiz susturma yoktur.
   */
  silenceAlarm(
    alarmId: string,
    by: string,
    durationMs?: number,
    reason?: string,
  ): Promise<BridgeResult<UnifiedAlarm>> {
    const body: Record<string, unknown> = { alarm_id: alarmId, by };
    if (durationMs !== undefined) body.duration_ms = durationMs;
    if (reason !== undefined) body.reason = reason;
    return this.request(
      "/alarms/silence",
      { method: "POST", body: JSON.stringify(body) },
      (value) => parseAlarm(value),
    );
  }

  /** Susturmayi kaldirir; alarm `OPEN` durumuna doner. */
  unsilenceAlarm(alarmId: string): Promise<BridgeResult<UnifiedAlarm>> {
    return this.request(
      "/alarms/unsilence",
      { method: "POST", body: JSON.stringify({ alarm_id: alarmId }) },
      (value) => parseAlarm(value),
    );
  }

  /**
   * Gecmis trend serisi.
   *
   * Veri **gercek telemetri tablosundan** gelir; benzetim kullanilmaz. Olcumu
   * olmayan kova `average: null` tasir ve grafikte cizilmez.
   */
  telemetryTrend(
    device: string,
    tag: string,
    window: TrendWindowId,
  ): Promise<BridgeResult<TrendSeries>> {
    const query = new URLSearchParams({ device, tag, window });
    return this.request(`/telemetry/trend?${query.toString()}`, { method: "GET" }, parseSeries);
  }

  /** Kayitli cihaz-etiket ciftleri; hic olcum yazilmadiysa liste bostur. */
  telemetryTags(): Promise<BridgeResult<TelemetryTag[]>> {
    return this.request("/telemetry/tags", { method: "GET" }, parseTags);
  }

  /**
   * Runtime tanilama: verim, kuyruk, dusen olay, gecikme, telemetri hizi.
   *
   * Olculemeyen her olcut `null` doner ve nedeni yaninda yazar.
   */
  diagnostics(): Promise<BridgeResult<DiagnosticsReport>> {
    return this.request("/diagnostics", { method: "GET" }, parseDiagnostics);
  }

  /** Akislarin canlilik durumu ve son veri yaslari. */
  continuity(): Promise<BridgeResult<StreamLiveness[]>> {
    return this.request("/continuity", { method: "GET" }, parseContinuity);
  }

  /**
   * Uctaki cihaza "nelerin var?" diye sorar.
   *
   * Yanit alinamazsa `ok=false` doner ve etiket listesi **bos** kalir; ornek
   * etiket uretilmez.
   */
  discover(payload: {
    kind: string;
    endpoint: string;
    port?: number | null;
    username?: string | null;
    password?: string | null;
    topics?: string[];
    timeoutMs?: number;
    useCache?: boolean;
  }): Promise<BridgeResult<DiscoveryResult>> {
    return this.request(
      "/provisioning/discover",
      { method: "POST", body: JSON.stringify(discoveryBody(payload)) },
      parseDiscovery,
    );
  }

  /**
   * Kimlik bilgilerini gercek ucta dener.
   *
   * Yanit her zaman basarilidir; denemenin sonucu govdedeki `ok` alanindadir.
   */
  testCredentials(payload: {
    kind: string;
    endpoint: string;
    port?: number | null;
    username?: string | null;
    password?: string | null;
    topics?: string[];
    timeoutMs?: number;
  }): Promise<BridgeResult<CredentialTest>> {
    return this.request(
      "/provisioning/test",
      { method: "POST", body: JSON.stringify(discoveryBody(payload)) },
      parseCredentialTest,
    );
  }

  /**
   * Lisans durumu, sinirlar ve kullanim.
   *
   * Lisans yoksa `status` `missing` doner; uydurulmus bir deneme lisansi
   * uretilmez.
   */
  license(): Promise<BridgeResult<LicenseView>> {
    return this.request("/license", { method: "GET" }, parseLicenseView);
  }

  /** On dort gunluk deneme lisansi acar; var olanin ustune yazmaz. */
  startTrial(customer: string): Promise<BridgeResult<Record<string, unknown>>> {
    return this.request(
      "/license/trial",
      { method: "POST", body: JSON.stringify({ customer }) },
      (value) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}),
    );
  }

  /** Kurulum tokenlari; token metni **hicbirinde** yer almaz. */
  installTokens(): Promise<BridgeResult<InstallToken[]>> {
    return this.request("/install-tokens", { method: "GET" }, parseTokens);
  }

  /**
   * Tek kullanimlik kurulum tokeni uretir.
   *
   * Token metni yalnizca bu yanitta doner; ikinci kez goruntulenemez.
   */
  issueInstallToken(
    site: string,
    ttlHours?: number,
  ): Promise<BridgeResult<IssuedToken>> {
    const body: Record<string, unknown> = { site };
    if (ttlHours !== undefined) body.ttl_hours = ttlHours;
    return this.request(
      "/install-tokens",
      { method: "POST", body: JSON.stringify(body) },
      parseIssuedToken,
    );
  }

  /** Tokeni kullanir ve kapatir; sonuc govdedeki `ok` alanindadir. */
  redeemInstallToken(
    token: string,
    actor: string,
  ): Promise<BridgeResult<Record<string, unknown>>> {
    return this.request(
      "/install-tokens/redeem",
      { method: "POST", body: JSON.stringify({ token, actor }) },
      (value) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}),
    );
  }

  /** Tokeni iptal eder; kullanilmis bir token iptal edilmez. */
  revokeInstallToken(
    tokenId: string,
    reason: string,
  ): Promise<BridgeResult<InstallToken>> {
    return this.request(
      "/install-tokens/revoke",
      { method: "POST", body: JSON.stringify({ token_id: tokenId, reason }) },
      parseToken,
    );
  }

  /** Etiketler, cakismalar, etiketsiz makineler ve oneriler. */
  machineLabels(): Promise<BridgeResult<LabelReview>> {
    return this.request("/machine-labels", { method: "GET" }, parseLabelReview);
  }

  /** Makineye kalici saha kimligi verir. */
  saveMachineLabel(payload: {
    machineId: string;
    label: string;
    line?: string;
    note?: string;
  }): Promise<BridgeResult<MachineLabel>> {
    return this.request(
      "/machine-labels",
      {
        method: "POST",
        body: JSON.stringify({
          machine_id: payload.machineId,
          label: payload.label,
          line: payload.line ?? "",
          note: payload.note ?? "",
        }),
      },
      parseMachineLabel,
    );
  }

  /** Basilan etiketleri isaretler. */
  markLabelsPrinted(labels: string[]): Promise<BridgeResult<Record<string, unknown>>> {
    return this.request(
      "/machine-labels/printed",
      { method: "POST", body: JSON.stringify({ labels }) },
      (value) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}),
    );
  }

  /** Saha tanilama; olculemeyen her satir `null` doner. */
  fieldDiagnostics(): Promise<BridgeResult<FieldDiagnostics>> {
    return this.request("/field-diagnostics", { method: "GET" }, parseFieldDiagnostics);
  }

  /**
   * Pilot kurulum kontrol listesi.
   *
   * Verilmeyen olcum `null` kalir ve adim "olculemedi" gorunur; `false`
   * varsayilsaydi, olculmemis bir adim "yapilmadi" diye raporlanirdi.
   */
  deploymentChecklist(payload: {
    discoveredTags?: number | null;
    mappedTags?: number | null;
    unmappedTags?: number | null;
    signatureRecorded?: boolean | null;
    backupVerified?: boolean | null;
  } = {}): Promise<BridgeResult<DeploymentReport>> {
    const body: Record<string, unknown> = {};
    if (payload.discoveredTags != null) body.discovered_tags = payload.discoveredTags;
    if (payload.mappedTags != null) body.mapped_tags = payload.mappedTags;
    if (payload.unmappedTags != null) body.unmapped_tags = payload.unmappedTags;
    if (payload.signatureRecorded != null) {
      body.signature_recorded = payload.signatureRecorded;
    }
    if (payload.backupVerified != null) body.backup_verified = payload.backupVerified;
    return this.request(
      "/deployment-checklist",
      { method: "POST", body: JSON.stringify(body) },
      parseDeployment,
    );
  }

  /** Gercek veriyi CSV olarak disa aktarir. */
  exportData(kind: ExportKind): Promise<BridgeResult<ExportResult>> {
    return this.request(`/export/${kind}`, { method: "GET" }, parseExport);
  }

  /**
   * Operator panosundaki Uretim Durumu karti.
   *
   * Planlanan sure ve ideal cevrim verilmezse OEE **hesaplanmaz** ve `null`
   * doner: varsayilan bir vardiya suresi uydurmak, olculmemis bir sayiyi
   * olculmus gibi gostermek olurdu.
   */
  productionStatus(
    plannedTimeMs?: number,
    idealCycleSeconds?: number,
  ): Promise<BridgeResult<ProductionStatus>> {
    const query = new URLSearchParams();
    if (plannedTimeMs !== undefined) query.set("planned_time_ms", String(plannedTimeMs));
    if (idealCycleSeconds !== undefined) {
      query.set("ideal_cycle_seconds", String(idealCycleSeconds));
    }
    const suffix = query.toString();
    return this.request(
      suffix.length > 0 ? `/production-status?${suffix}` : "/production-status",
      { method: "GET" },
      parseProductionStatus,
    );
  }

  /** Durus ve alarmlarin birlesik zaman cizelgesi. */
  timeline(limit = 100): Promise<BridgeResult<TimelineEntry[]>> {
    const query = new URLSearchParams({ limit: String(limit) });
    return this.request(`/timeline?${query.toString()}`, { method: "GET" }, parseTimeline);
  }

  /** Koprunun 0-100 arasi saglik skoru; olculemezse `null`. */
  healthScore(): Promise<BridgeResult<HealthScoreView>> {
    return this.request("/health-score", { method: "GET" }, parseHealthScore);
  }

  /**
   * Son cihaz olcumleri — Payload Inspector bunu okur.
   *
   * Akis kopmus olsa bile son durum buradan gorulebilir; ekran acildiginda
   * bos kalmaz.
   */
  deviceData(limit = 50): Promise<BridgeResult<DeviceDataRow[]>> {
    const query = new URLSearchParams({ limit: String(limit) });
    return this.request(
      `/device-data?${query.toString()}`,
      { method: "GET" },
      parseDeviceRows,
    );
  }

  /** Akis olcumleri: yoklama sikligi, olay hizi, kuyruk derinligi, saglik. */
  streamStats(): Promise<BridgeResult<StreamStats>> {
    return this.request("/stream-stats", { method: "GET" }, parseStreamStats);
  }

  /**
   * Canli uretim akisi (SSE).
   *
   * `/stream` butun runtime olaylarini yayar; bu uc yalnizca uretim ekraninin
   * anladigi dort turu yayar. Tanimayan bir tur gelirse **sessizce yok
   * sayilir**: sunucuya eklenen yeni bir olay, guncellenmemis bir arayuzu
   * cokertmemelidir.
   *
   * Yeniden baglanma burada yapilmaz; cagiran (kanca) ustel geri cekilmeyle
   * yeniden acar. Akis kendini yeniden acsaydi, kullaniciya kac kez koptugu
   * hic gorunmezdi.
   */
  async liveStream(
    onFrame: (frame: LiveStreamFrame) => void,
    onError: (message: string) => void,
  ): Promise<() => void> {
    const controller = new AbortController();

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}${RUNTIME_PATH}/live/stream`,
        {
          method: "GET",
          headers: { ...(await this.headers()), Accept: "text/event-stream" },
          signal: controller.signal,
        },
      );

      if (!response.ok || response.body === null) {
        onError(`Canli akis acilamadi: sunucu ${response.status} dondu.`);
        return () => controller.abort();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const buffer = new SseBuffer();

      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              onError("Canli akis kapandi.");
              break;
            }
            for (const chunk of buffer.push(decoder.decode(value, { stream: true }))) {
              const payload = parseFrameData(chunk);
              if (payload === null) continue;
              const frame = parseFrame(payload);
              if (frame !== null) onFrame(frame);
            }
          }
        } catch {
          if (!controller.signal.aborted) {
            onError("Canli akis koptu.");
          }
        }
      })();

      return () => controller.abort();
    } catch {
      onError(BRIDGE_NETWORK_ERROR);
      return () => controller.abort();
    }
  }

  /** Kalici olay gunlugunden yeniden oynatma. */
  replay(since = 0, limit = 200): Promise<BridgeResult<RuntimeReplayPage>> {
    const query = new URLSearchParams({ since: String(since), limit: String(limit) });
    return this.request(`/replay?${query.toString()}`, { method: "GET" }, parseReplayPage);
  }

  /**
   * Surekli veri akisini baslatir.
   *
   * Esleme tablosu ve modeldeki istasyon kimlikleri birlikte gonderilir:
   * sunucu, gelen olcumlerin ekranda karsiligi olup olmadigini ancak bu liste
   * ile dogrulayabilir.
   */
  subscribe(
    connectionId: string,
    options: {
      intervalMs?: number;
      mapping?: { origin: string; machineId: string; metric: string; unit?: string }[];
      knownMachineIds?: string[];
    } = {},
  ): Promise<BridgeResult<StreamStartResult>> {
    return this.request(
      "/subscribe",
      {
        method: "POST",
        body: JSON.stringify({
          connection_id: connectionId,
          interval_ms: options.intervalMs ?? null,
          mapping: (options.mapping ?? []).map((entry) => ({
            origin: entry.origin,
            machine_id: entry.machineId,
            metric: entry.metric,
            unit: entry.unit ?? null,
          })),
          known_machine_ids: options.knownMachineIds ?? [],
        }),
      },
      parseStreamStart,
    );
  }

  /** Akisi kapatir. */
  unsubscribe(connectionId: string): Promise<BridgeResult<StreamStartResult>> {
    return this.request(
      "/unsubscribe",
      { method: "POST", body: JSON.stringify({ connection_id: connectionId }) },
      parseStreamStart,
    );
  }

  /**
   * Olay akisini acar (SSE).
   *
   * `EventSource` kullanılamaz: özel başlık gönderemez ve bu uç
   * `Authorization` ister. Belirteci sorguya koymak, kimlik bilgisini tarayıcı
   * geçmişine ve sunucu günlüklerine yazmak demek olurdu.
   *
   * Dönen işlev akışı kapatır; çağıran bunu temizlikte çağırmalıdır.
   */
  async stream(
    onEvent: (event: BridgeEvent) => void,
    onError: (message: string) => void,
  ): Promise<() => void> {
    const controller = new AbortController();

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${RUNTIME_PATH}/stream`, {
        method: "GET",
        headers: { ...(await this.headers()), Accept: "text/event-stream" },
        signal: controller.signal,
      });

      if (!response.ok || response.body === null) {
        onError(`Akış açılamadı: sunucu ${response.status} döndü.`);
        return () => controller.abort();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const buffer = new SseBuffer();

      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            for (const frame of buffer.push(decoder.decode(value, { stream: true }))) {
              const payload = parseFrameData(frame);
              if (payload !== null) {
                onEvent(parseEvent(payload));
              }
            }
          }
        } catch {
          /*
           * Okuma iptal edildiğinde de buraya düşülür; kullanıcı akışı
           * kapattığı için hata gösterilmez.
           */
          if (!controller.signal.aborted) {
            onError("Akış koptu.");
          }
        }
      })();

      return () => controller.abort();
    } catch {
      onError(BRIDGE_NETWORK_ERROR);
      return () => controller.abort();
    }
  }
}
