/**
 * Bağlayıcı Merkezi — bağlantılar, eşleme, sağlık ve günlük.
 *
 * Bu ekran bağlantı **kurmaz**; bağlantı kurmanın sonuçlarını yönetir. Test,
 * bağlanma ve veri akışı bugün benzetimle çalışıyor ve ekran bunu kalıcı bir
 * şeritte söylüyor. Yarın gerçek bir OPC UA istemcisi eklendiğinde değişecek
 * tek şey, `simulateTest` yerine gerçek istemcinin çağrılması olacak: eylemler,
 * indirgeyici ve bu ekranın tamamı olduğu gibi kalacak.
 *
 * Zamanlayıcı iki iş yapar: göreli zaman etiketlerini tazeler ve zamanı gelen
 * yeniden denemeleri tetikler. İkisi tek bir yerde durur — iki ayrı
 * zamanlayıcı, sekme arka plandayken birbirinden ayrı hızlarda ilerlerdi.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Activity,
  Columns3,
  Play,
  Plus,
  ScrollText,
  Square,
  Unplug,
} from "lucide-react";
import type { SimulationConfig } from "../../types/simulationTypes";
import { DemoLiveProvider } from "../../lib/live/providers";
import { seedsFromConfig } from "../../lib/live";
import {
  CONNECTOR_LABEL,
  CONNECTOR_ORDER,
  ConnectorLiveProvider,
  ConnectorStore,
  SAMPLE_STATIONS,
  assignMapping,
  countRecords,
  createConfig,
  healthSnapshot,
  initialState,
  removeMapping,
  runtimeOf,
  sampleConfigs,
  sampleMappings,
  sampleRuntimes,
  sampleSources,
  simulateTest,
  validateMappings,
  validateSettings,
  type ConnectorConfig,
  type ConnectorKind,
  type OptiFlowField,
} from "../../lib/connectors";
import {
  healthCards as buildHealthCards,
  rememberConnectorSnapshot,
} from "../../lib/onboarding-enterprise";
import { Button, Card } from "../ui/Primitives";
import { ConnectorCard } from "./ConnectorCard";
import { ConnectorSettingsDrawer } from "./ConnectorSettingsDrawer";
import { EventLogPanel } from "./EventLogPanel";
import { HealthDashboard } from "./HealthDashboard";
import { NodeMappingStudio } from "./NodeMappingStudio";
import { KIND_ICON } from "./connectorStyles";

type Tab = "connections" | "mapping" | "log";

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "connections", label: "Bağlantılar", icon: Activity },
  { id: "mapping", label: "Eşleme", icon: Columns3 },
  { id: "log", label: "Günlük", icon: ScrollText },
];

/** Saat ve yeniden deneme denetimi bu aralıkla döner. */
const TICK_MS = 1_000;

interface ConnectorCenterProps {
  /** Açık model; istasyon listesi buradan gelir. */
  config: SimulationConfig | null;
}

export function ConnectorCenter({ config }: ConnectorCenterProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  /* Örnek kurulum bir kez kurulur; her render'da yeniden üretilmez. */
  const storeRef = useRef<ConnectorStore | null>(null);
  if (storeRef.current === null) {
    const startedAt = Date.now();
    storeRef.current = new ConnectorStore(
      initialState(
        sampleConfigs(),
        sampleSources(),
        sampleMappings(),
        sampleRuntimes(startedAt),
      ),
    );
  }
  const store = storeRef.current;

  const state = useSyncExternalStore(store.subscribe, store.getState);

  const [tab, setTab] = useState<Tab>("connections");
  const [editing, setEditing] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  /**
   * Kopma benzetimi açık olan bağlantılar.
   *
   * Bu küme doluyken bağlanma denemeleri başarısız olur; yeniden deneme
   * motorunun gerçekten çalıştığı ancak böyle görülebilir.
   */
  const forcedFailures = useRef<Set<string>>(new Set());

  const stations = useMemo(
    () =>
      config === null
        ? SAMPLE_STATIONS
        : config.stations.map((station) => ({
            id: station.id,
            name: station.name,
          })),
    [config],
  );

  const health = useMemo(() => healthSnapshot(state), [state]);

  /*
   * Kurulum kartı ve hazırlık puanı başka ekranlarda görünür; bu ekran açık
   * olmayabilir. Son bilinen durum kaydedilir ve orada **son görülen** hâl
   * olarak okunur — canlı bağlantı olarak değil.
   */
  useEffect(() => {
    rememberConnectorSnapshot({
      connectorCount: health.total,
      connectedCount: health.connected,
      cards: buildHealthCards(state, Date.now()),
      atMs: Date.now(),
    });
  }, [health.connected, health.total, state]);

  const issues = useMemo(
    () =>
      validateMappings({
        sources: state.sources,
        mappings: state.mappings,
        stations,
      }),
    [state.sources, state.mappings, stations],
  );

  /** Bir bağlanma denemesi; sonucu indirgeyiciye eylem olarak gider. */
  const attempt = useCallback(
    (target: ConnectorConfig, atMs: number) => {
      if (forcedFailures.current.has(target.id)) {
        store.dispatch({
          type: "connect_failed",
          atMs,
          configId: target.id,
          reason: "Bağlantı koptu (benzetim)",
        });
        return;
      }
      const result = simulateTest(target);
      if (result.ok && result.latencyMs !== null) {
        store.dispatch({
          type: "connected",
          atMs,
          configId: target.id,
          latencyMs: result.latencyMs,
        });
      } else {
        store.dispatch({
          type: "connect_failed",
          atMs,
          configId: target.id,
          reason: result.detail,
        });
      }
    },
    [store],
  );

  /* --- Saat ve yeniden deneme --- */
  useEffect(() => {
    const timer = setInterval(() => {
      const atMs = Date.now();
      setNowMs(atMs);
      store.dispatch({ type: "tick", atMs });

      // `tick` yalnızca durumu "bağlanıyor"a taşır; asıl denemeyi ekran yapar.
      // İndirgeyicinin ağ çağrısı yapması, saf kalmasını imkânsız kılardı.
      for (const item of store.getState().configs) {
        if (runtimeOf(store.getState(), item.id).status === "connecting") {
          attempt(item, atMs);
        }
      }
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [attempt, store]);

  /* --- Bağlayıcı üzerinden demo veri akışı --- */
  useEffect(() => {
    if (!streaming) {
      return;
    }
    const target = state.configs.find(
      (item) => runtimeOf(state, item.id).status === "connected",
    );
    if (target === undefined) {
      return;
    }

    /*
     * Demo sağlayıcı bir bağlayıcının içine sarılır: canlı ekran sözleşmesi
     * (`LiveDataProvider`) değişmez, ama olaylar artık bağlayıcı katmanından
     * geçer ve sağlık panosunu besler.
     */
    const seeds = config === null ? [] : seedsFromConfig(config, null);
    const inner = new DemoLiveProvider(seeds, "normal", 8 * 60);
    const provider = new ConnectorLiveProvider(target, inner, (events) => {
      const records = countRecords(events);
      if (records === 0) {
        return;
      }
      store.dispatch({
        type: "data",
        atMs: Date.now(),
        configId: target.id,
        records,
        latencyMs: 30 + Math.round(Math.random() * 40),
      });
    });

    void provider.connect();
    const unsubscribe = provider.subscribe(() => undefined);

    return () => {
      unsubscribe();
      void provider.disconnect();
    };
    // `state` bilinçli olarak bağımlılık değil: her olayda akışı yeniden
    // kurmak, sağlayıcıyı saniyede bir kapatıp açardı.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, config, store]);

  const addConnector = useCallback(
    (kind: ConnectorKind) => {
      const existing = store
        .getState()
        .configs.filter((item) => item.kind === kind).length;
      const created = createConfig(kind, `conn-${Date.now().toString(36)}`, existing);
      store.dispatch({ type: "add", atMs: Date.now(), config: created });
      setEditing(created.id);
    },
    [store],
  );

  const runTest = useCallback(
    (target: ConnectorConfig) => {
      setTesting(target.id);
      const result = simulateTest(target);
      const atMs = Date.now();
      store.dispatch({
        type: "test",
        atMs,
        configId: target.id,
        ok: result.ok,
        detail: result.detail,
        latencyMs: result.latencyMs,
      });
      setTesting(null);
    },
    [store],
  );

  const toggleConnection = useCallback(
    (target: ConnectorConfig) => {
      const atMs = Date.now();
      const status = runtimeOf(store.getState(), target.id).status;
      if (status === "connected") {
        store.dispatch({ type: "disconnect", atMs, configId: target.id });
        return;
      }
      store.dispatch({ type: "connect", atMs, configId: target.id });
      attempt(target, atMs);
    },
    [attempt, store],
  );

  /** Kopma benzetimini açıp kapatır ve açıkken bağlantıyı düşürür. */
  const toggleFailure = useCallback(() => {
    const target = store
      .getState()
      .configs.find(
        (item) => runtimeOf(store.getState(), item.id).status === "connected",
      );
    if (target === undefined) {
      return;
    }
    forcedFailures.current.add(target.id);
    store.dispatch({
      type: "connect_failed",
      atMs: Date.now(),
      configId: target.id,
      reason: "Bağlantı koptu (benzetim)",
    });
  }, [store]);

  const clearFailures = useCallback(() => {
    forcedFailures.current.clear();
  }, []);

  const editingConfig = useMemo(
    () => state.configs.find((item) => item.id === editing) ?? null,
    [state.configs, editing],
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Bağlayıcı Merkezi
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            PLC, sensör ve MES kaynaklarını tek yerden yönetin.
          </p>
        </div>

        <nav className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 focus:outline-none ${
                tab === item.id
                  ? "bg-brand-600 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Kalıcı şerit: veri kaynağının ne olduğu hiçbir zaman gizlenmez. */}
      <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Bu sürümde bağlantılar <strong>benzetimle</strong> çalışır: gerçek bir
        PLC, broker ya da MES ucuna gidilmez. Mimari hazır — gerçek istemci
        eklendiğinde bu ekran değişmeyecek.
      </p>

      {tab === "connections" && (
        <div className="space-y-4">
          <HealthDashboard health={health} state={state} nowMs={nowMs} />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Yeni bağlantı
            </span>
            {CONNECTOR_ORDER.map((kind) => {
              const Icon = KIND_ICON[kind];
              return (
                <Button
                  key={kind}
                  size="sm"
                  icon={Icon}
                  onClick={() => addConnector(kind)}
                >
                  {CONNECTOR_LABEL[kind]}
                </Button>
              );
            })}
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              onClick={() => setTab("mapping")}
              className="ml-auto"
            >
              Eşlemeye git
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {state.configs.map((item, index) => (
              <ConnectorCard
                key={item.id}
                config={item}
                runtime={runtimeOf(state, item.id)}
                nowMs={nowMs}
                index={index}
                sourceCount={
                  state.sources.filter((source) => source.connectorId === item.id)
                    .length
                }
                errorCount={
                  validateSettings(item.kind, item.settings).filter(
                    (issue) => issue.severity === "error",
                  ).length
                }
                busy={testing === item.id}
                onTest={() => runTest(item)}
                onToggleConnection={() => toggleConnection(item)}
                onSettings={() => setEditing(item.id)}
              />
            ))}
          </div>

          <Card className="p-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Canlı akış benzetimi
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Demo verisi bağlayıcı katmanından geçer; canlı üretim ekranı aynı
              sözleşmeyi kullandığı için hiç değişmeden çalışır.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={streaming ? "secondary" : "primary"}
                icon={streaming ? Square : Play}
                onClick={() => setStreaming((current) => !current)}
              >
                {streaming ? "Akışı durdur" : "Akışı başlat"}
              </Button>
              <Button size="sm" icon={Unplug} onClick={toggleFailure}>
                Kopmayı simüle et
              </Button>
              <Button size="sm" variant="ghost" onClick={clearFailures}>
                Kopmayı geri al
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === "mapping" && (
        <NodeMappingStudio
          configs={state.configs}
          sources={state.sources}
          mappings={state.mappings}
          stations={stations}
          issues={issues}
          onAssign={(sourceId, stationId, field: OptiFlowField) =>
            store.dispatch({
              type: "set_mappings",
              atMs: Date.now(),
              mappings: assignMapping(state.mappings, sourceId, stationId, field),
            })
          }
          onRemove={(mappingId) =>
            store.dispatch({
              type: "set_mappings",
              atMs: Date.now(),
              mappings: removeMapping(state.mappings, mappingId),
            })
          }
        />
      )}

      {tab === "log" && <EventLogPanel events={state.events} nowMs={nowMs} />}

      {editingConfig !== null && (
        <ConnectorSettingsDrawer
          config={editingConfig}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            store.dispatch({
              type: "update_settings",
              atMs: Date.now(),
              configId: editingConfig.id,
              settings: values.settings,
              name: values.name,
              autoReconnect: values.autoReconnect,
            });
            setEditing(null);
          }}
          onRemove={() => {
            store.dispatch({
              type: "remove",
              atMs: Date.now(),
              configId: editingConfig.id,
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
