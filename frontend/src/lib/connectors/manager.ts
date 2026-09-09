/**
 * Bağlayıcı yöneticisi — bütün durumun tek indirgeyicisi.
 *
 * Bağlantı kurmak yan etkilidir (soket açılır, istek atılır), ama bu yan
 * etkinin **sonucunun duruma nasıl işleneceği** saf bir karardır ve burada
 * durur. Ekran yalnızca eylem gönderir; hangi durumun hangi duruma geçtiğine,
 * olay günlüğüne ne yazılacağına ve yeniden denemenin ne zaman olacağına bu
 * dosya karar verir.
 *
 * Bugün bağlantılar benzetimle çalışıyor. Yarın gerçek bir OPC UA istemcisi
 * eklendiğinde değişecek olan tek şey, eylemleri **kimin** gönderdiğidir:
 * `connected`, `connect_failed`, `data` eylemleri o zaman gerçek istemciden
 * gelecek, indirgeyici satırı bile değişmeyecek.
 *
 * Zaman her eylemde dışarıdan gelir (`atMs`); katmanda hiçbir yerde saat
 * okunmaz.
 */

import { defaultSettings, redactSettings, suggestName } from "./fields";
import { removeMappingsOfSources } from "./mapping";
import { applyAttempt, isRetryDue, type RetryState } from "./retry";
import { idleRuntime, pushLatency } from "./status";
import { hasBlockingIssue, validateSettings } from "./validation";
import {
  CONNECTOR_LABEL,
  type ConnectorConfig,
  type ConnectorEvent,
  type ConnectorEventKind,
  type ConnectorKind,
  type ConnectorRuntime,
  type ConnectorSettings,
  type ConnectorState,
  type EventLevel,
  type FieldMapping,
  type SourceNode,
} from "./types";

/**
 * Günlükte tutulan en fazla olay.
 *
 * İki yüz satır, birkaç saatlik bir kopma-bağlanma serisini kapsar. Sınırsız
 * bırakılsaydı günlerce açık kalan bir sekmede günlük sürekli büyürdü.
 */
export const EVENT_LIMIT = 200;

/* -------------------------------------------------------------------------- */
/* Eylemler                                                                    */
/* -------------------------------------------------------------------------- */

export type ConnectorAction =
  | { type: "add"; atMs: number; config: ConnectorConfig; sources?: SourceNode[] }
  | { type: "remove"; atMs: number; configId: string }
  | {
      type: "update_settings";
      atMs: number;
      configId: string;
      settings: ConnectorSettings;
      name?: string;
      autoReconnect?: boolean;
    }
  | { type: "connect"; atMs: number; configId: string }
  | { type: "connected"; atMs: number; configId: string; latencyMs: number }
  | { type: "connect_failed"; atMs: number; configId: string; reason: string }
  | { type: "disconnect"; atMs: number; configId: string }
  | { type: "sync"; atMs: number; configId: string; latencyMs: number; records: number }
  | { type: "sync_failed"; atMs: number; configId: string; reason: string }
  | { type: "test"; atMs: number; configId: string; ok: boolean; detail: string; latencyMs: number | null }
  | { type: "data"; atMs: number; configId: string; records: number; latencyMs: number }
  | { type: "tick"; atMs: number }
  | { type: "set_sources"; atMs: number; configId: string; sources: SourceNode[] }
  | { type: "set_mappings"; atMs: number; mappings: FieldMapping[] };

/* -------------------------------------------------------------------------- */
/* Başlangıç durumu                                                            */
/* -------------------------------------------------------------------------- */

export function emptyState(): ConnectorState {
  return { configs: [], runtimes: {}, sources: [], mappings: [], events: [] };
}

export function initialState(
  configs: ConnectorConfig[],
  sources: SourceNode[] = [],
  mappings: FieldMapping[] = [],
  runtimes: Record<string, ConnectorRuntime> = {},
): ConnectorState {
  const filled: Record<string, ConnectorRuntime> = {};
  for (const config of configs) {
    filled[config.id] = runtimes[config.id] ?? idleRuntime(config.id);
  }
  return { configs, runtimes: filled, sources, mappings, events: [] };
}

/** Yeni bir bağlantı tanımı; ayarlar şemadan boş olarak kurulur. */
export function createConfig(
  kind: ConnectorKind,
  id: string,
  existingOfKind = 0,
): ConnectorConfig {
  return {
    id,
    kind,
    name: suggestName(kind, existingOfKind),
    settings: defaultSettings(kind),
    autoReconnect: true,
  };
}

/* -------------------------------------------------------------------------- */
/* İndirgeyici                                                                 */
/* -------------------------------------------------------------------------- */

export function connectorReducer(
  state: ConnectorState,
  action: ConnectorAction,
): ConnectorState {
  switch (action.type) {
    case "add": {
      if (state.configs.some((item) => item.id === action.config.id)) {
        // Aynı kimlikle ikinci kez eklemek sessizce yok sayılır; iki kayıt
        // aynı bağlantıyı iki kez sayar ve sağlık panosunu şişirirdi.
        return state;
      }
      return withEvent(
        {
          ...state,
          configs: [...state.configs, action.config],
          runtimes: {
            ...state.runtimes,
            [action.config.id]: idleRuntime(action.config.id),
          },
          sources: [...state.sources, ...(action.sources ?? [])],
        },
        event(action.atMs, action.config, "config", "info", `${action.config.name} eklendi.`),
      );
    }

    case "remove": {
      const config = configOf(state, action.configId);
      if (config === null) {
        return state;
      }
      const droppedSources = state.sources.filter(
        (source) => source.connectorId === action.configId,
      );
      const runtimes = { ...state.runtimes };
      delete runtimes[action.configId];

      return withEvent(
        {
          ...state,
          configs: state.configs.filter((item) => item.id !== action.configId),
          runtimes,
          sources: state.sources.filter(
            (source) => source.connectorId !== action.configId,
          ),
          // Eşlemeler de gider: var olmayan bir düğüme bağlı eşleme, doğrulama
          // ekranını kalıcı bir hatayla doldururdu.
          mappings: removeMappingsOfSources(
            state.mappings,
            droppedSources.map((source) => source.id),
          ),
        },
        event(action.atMs, config, "config", "info", `${config.name} kaldırıldı.`),
      );
    }

    case "update_settings": {
      const config = configOf(state, action.configId);
      if (config === null) {
        return state;
      }
      const next: ConnectorConfig = {
        ...config,
        name: action.name ?? config.name,
        autoReconnect: action.autoReconnect ?? config.autoReconnect,
        settings: action.settings,
      };
      return withEvent(
        {
          ...state,
          configs: state.configs.map((item) =>
            item.id === config.id ? next : item,
          ),
        },
        event(
          action.atMs,
          next,
          "config",
          "info",
          `${next.name} ayarları güncellendi (${describeSettings(next)}).`,
        ),
      );
    }

    case "connect": {
      const config = configOf(state, action.configId);
      if (config === null) {
        return state;
      }
      return withEvent(
        patchRuntime(state, action.configId, (runtime) => ({
          ...runtime,
          status: "connecting",
          detail: null,
          nextRetryAtMs: null,
        })),
        event(action.atMs, config, "config", "info", `${config.name} bağlanıyor…`),
      );
    }

    case "connected": {
      const config = configOf(state, action.configId);
      if (config === null) {
        return state;
      }
      return withEvent(
        patchRuntime(state, action.configId, (runtime) => ({
          ...runtime,
          status: "connected",
          attempt: 0,
          nextRetryAtMs: null,
          lastLatencyMs: action.latencyMs,
          latencySamplesMs: pushLatency(runtime.latencySamplesMs, action.latencyMs),
          detail: null,
        })),
        event(
          action.atMs,
          config,
          "connected",
          "info",
          `${config.name} bağlandı (${Math.round(action.latencyMs)} ms).`,
        ),
      );
    }

    case "connect_failed": {
      const config = configOf(state, action.configId);
      if (config === null) {
        return state;
      }
      const runtime = runtimeOf(state, action.configId);
      const retry = applyAttempt(
        toRetryState(runtime),
        "failure",
        action.atMs,
        config.autoReconnect,
      );

      return withEvent(
        patchRuntime(state, action.configId, (current) => ({
          ...current,
          status: retry.status,
          attempt: retry.attempt,
          nextRetryAtMs: retry.nextRetryAtMs,
          detail: action.reason,
        })),
        event(
          action.atMs,
          config,
          retry.status === "failed" ? "failed" : "retrying",
          retry.status === "failed" ? "critical" : "warning",
          retry.status === "failed"
            ? `${config.name} bağlanamadı: ${action.reason}. ${retry.attempt} deneme sonunda vazgeçildi.`
            : `${config.name} bağlanamadı: ${action.reason}. ${retry.attempt}. deneme.`,
        ),
      );
    }

    case "disconnect": {
      const config = configOf(state, action.configId);
      if (config === null) {
        return state;
      }
      return withEvent(
        patchRuntime(state, action.configId, (runtime) => ({
          ...runtime,
          status: "disconnected",
          attempt: 0,
          nextRetryAtMs: null,
          detail: null,
        })),
        event(action.atMs, config, "disconnected", "warning", `${config.name} bağlantısı kesildi.`),
      );
    }

    case "sync":
    case "data": {
      const config = configOf(state, action.configId);
      if (config === null) {
        return state;
      }
      const records = action.records;
      return withEvent(
        patchRuntime(state, action.configId, (runtime) => ({
          ...runtime,
          // Veri gelen bir bağlantı tanım gereği bağlıdır; kopmuş görünürken
          // veri işlemek, panoyu kendi verisiyle çelişkiye düşürürdü.
          status: "connected",
          lastSyncAtMs: action.atMs,
          lastLatencyMs: action.latencyMs,
          latencySamplesMs: pushLatency(runtime.latencySamplesMs, action.latencyMs),
          recordsReceived: runtime.recordsReceived + records,
        })),
        event(
          action.atMs,
          config,
          action.type === "sync" ? "sync" : "data",
          "info",
          `${config.name}: ${records} kayıt alındı (${Math.round(action.latencyMs)} ms).`,
        ),
      );
    }

    case "sync_failed": {
      const config = configOf(state, action.configId);
      if (config === null) {
        return state;
      }
      return withEvent(
        patchRuntime(state, action.configId, (runtime) => ({
          ...runtime,
          syncErrors: runtime.syncErrors + 1,
          detail: action.reason,
        })),
        event(action.atMs, config, "error", "warning", `${config.name} senkron hatası: ${action.reason}`),
      );
    }

    case "test": {
      const config = configOf(state, action.configId);
      if (config === null) {
        return state;
      }
      return withEvent(
        patchRuntime(state, action.configId, (runtime) => ({
          ...runtime,
          lastLatencyMs: action.latencyMs ?? runtime.lastLatencyMs,
          latencySamplesMs:
            action.latencyMs === null
              ? runtime.latencySamplesMs
              : pushLatency(runtime.latencySamplesMs, action.latencyMs),
          detail: action.detail,
        })),
        event(
          action.atMs,
          config,
          "test",
          action.ok ? "info" : "warning",
          `${config.name} bağlantı testi: ${action.detail}`,
        ),
      );
    }

    case "set_sources": {
      const config = configOf(state, action.configId);
      if (config === null) {
        return state;
      }
      const others = state.sources.filter(
        (source) => source.connectorId !== action.configId,
      );
      const removed = state.sources
        .filter((source) => source.connectorId === action.configId)
        .filter((source) => !action.sources.some((item) => item.id === source.id))
        .map((source) => source.id);

      return {
        ...state,
        sources: [...others, ...action.sources],
        mappings: removeMappingsOfSources(state.mappings, removed),
      };
    }

    case "set_mappings":
      return { ...state, mappings: action.mappings };

    case "tick":
      return applyDueRetries(state, action.atMs);

    default:
      return state;
  }
}

/**
 * Zamanı gelen yeniden denemeleri başlatır.
 *
 * Yalnızca durumu `connecting`'e taşır ve olayı yazar; asıl bağlanma çağrısını
 * ekran (ya da yarın gerçek istemci) yapar. İndirgeyicinin ağ çağrısı yapması,
 * saf kalmasını imkânsız kılardı.
 */
function applyDueRetries(state: ConnectorState, nowMs: number): ConnectorState {
  let next = state;

  for (const config of state.configs) {
    const runtime = runtimeOf(next, config.id);
    if (!isRetryDue(runtime, nowMs)) {
      continue;
    }
    next = withEvent(
      patchRuntime(next, config.id, (current) => ({
        ...current,
        status: "connecting",
        nextRetryAtMs: null,
      })),
      event(
        nowMs,
        config,
        "retrying",
        "warning",
        `${config.name} yeniden bağlanıyor (${runtime.attempt}. deneme).`,
      ),
    );
  }

  return next;
}

/* -------------------------------------------------------------------------- */
/* Bağlantı testi (benzetim)                                                   */
/* -------------------------------------------------------------------------- */

export interface TestResult {
  ok: boolean;
  latencyMs: number | null;
  detail: string;
}

/**
 * Bağlantı testini benzetir.
 *
 * Gerçek bir soket açılmaz; bunun yerine ayarların **gerçekten** sınanabilen
 * kısmı sınanır. Yanlış yapılandırılmış bir bağlantı burada da başarısız olur:
 * test hep "başarılı" dönseydi, mimarinin hazır olduğu izlenimi verir ama
 * kullanıcı ilk gerçek bağlantıda aynı hatalarla karşılaşırdı.
 *
 * Rastgelelik dışarıdan verilir (`random`), böylece testler kararlıdır.
 */
export function simulateTest(
  config: ConnectorConfig,
  random: () => number = Math.random,
): TestResult {
  const issues = validateSettings(config.kind, config.settings);

  if (hasBlockingIssue(issues)) {
    const blocking = issues.find((issue) => issue.severity === "error");
    return {
      ok: false,
      latencyMs: null,
      detail: blocking?.text ?? "Ayarlar eksik.",
    };
  }

  /*
   * Gecikme protokole göre değişir: OPC UA ve MQTT yerel ağda milisaniyelerle,
   * REST ve ERP uçları onlarca-yüzlerce milisaniyeyle ölçülür. Hepsine aynı
   * sayıyı vermek, sağlık panosunu gerçek bir kurulumda anlamsız kılardı.
   */
  const base = BASE_LATENCY_MS[config.kind];
  const latencyMs = Math.round(base * (0.6 + random() * 0.8));

  return {
    ok: true,
    latencyMs,
    detail: `${CONNECTOR_LABEL[config.kind]} yanıt verdi (${latencyMs} ms, benzetim).`,
  };
}

/** Protokol başına tipik gecikme (ms). */
export const BASE_LATENCY_MS: Record<ConnectorKind, number> = {
  opcua: 45,
  mqtt: 30,
  rest: 220,
  csv: 90,
  erp: 380,
};

/* -------------------------------------------------------------------------- */
/* Depo                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * React ile indirgeyici arasındaki ince kabuk.
 *
 * `LiveFactoryStore` ile aynı deseni izler: durum React dışında yaşar,
 * bileşenler `useSyncExternalStore` ile bağlanır. Karar mantığının tamamı
 * indirgeyicide olduğu için bu sınıfın sınanacak bir davranışı yoktur.
 */
export class ConnectorStore {
  private state: ConnectorState;
  private listeners = new Set<() => void>();

  constructor(initial: ConnectorState) {
    this.state = initial;
  }

  getState = (): ConnectorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispatch = (action: ConnectorAction): void => {
    const next = connectorReducer(this.state, action);
    if (next === this.state) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Yardımcılar                                                                 */
/* -------------------------------------------------------------------------- */

export function configOf(
  state: ConnectorState,
  configId: string,
): ConnectorConfig | null {
  return state.configs.find((item) => item.id === configId) ?? null;
}

export function runtimeOf(
  state: ConnectorState,
  configId: string,
): ConnectorRuntime {
  return state.runtimes[configId] ?? idleRuntime(configId);
}

function toRetryState(runtime: ConnectorRuntime): RetryState {
  return {
    status: runtime.status,
    attempt: runtime.attempt,
    nextRetryAtMs: runtime.nextRetryAtMs,
  };
}

function patchRuntime(
  state: ConnectorState,
  configId: string,
  patch: (runtime: ConnectorRuntime) => ConnectorRuntime,
): ConnectorState {
  const current = runtimeOf(state, configId);
  return {
    ...state,
    runtimes: { ...state.runtimes, [configId]: patch(current) },
  };
}

/**
 * Günlük satırı — kimliği olmadan.
 *
 * Kimlik `withEvent` içinde, o anki günlük uzunluğundan türetilir. Rastgele
 * üretilseydi indirgeyici saf olmaktan çıkar, aynı girdi aynı çıktıyı vermezdi.
 */
function event(
  atMs: number,
  config: ConnectorConfig,
  kind: ConnectorEventKind,
  level: EventLevel,
  text: string,
): Omit<ConnectorEvent, "id"> {
  return {
    configId: config.id,
    connectorName: config.name,
    atMs,
    kind,
    level,
    text,
  };
}

/** Olayı günlüğün başına ekler ve sınırı uygular. */
function withEvent(
  state: ConnectorState,
  entry: Omit<ConnectorEvent, "id">,
): ConnectorState {
  const id = `${entry.configId ?? "genel"}-${entry.kind}-${entry.atMs}-${state.events.length}`;
  return {
    ...state,
    events: [{ id, ...entry }, ...state.events].slice(0, EVENT_LIMIT),
  };
}

/**
 * Ayar özeti — günlüğe yazılabilir hâli.
 *
 * Parola ve anahtarlar maskelenir; günlük ekranda görünür ve paylaşılır.
 */
function describeSettings(config: ConnectorConfig): string {
  const safe = redactSettings(config.kind, config.settings);
  return Object.entries(safe)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}
