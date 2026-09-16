/**
 * Canlı Üretim Merkezi (Sprint UX-7).
 *
 * Ekranın tek kurulum noktası burasıdır: sağlayıcı burada örneklenir, store
 * burada kurulur, ikisi burada birbirine bağlanır. Alt bileşenlerin hiçbiri
 * sağlayıcı tipini bilmez — hepsi ya `LiveFactoryState` ya da `ReplayControls`
 * görür. Yarın OPC-UA eklendiğinde değişecek tek dosya bu olacak, ekranlar
 * değil.
 *
 * Veri akışı tek yönlüdür:
 *
 *   sağlayıcı → olay paketi → store (saf indirgeyici) → React
 *
 * Bileşenlerin hiçbiri durumu doğrudan değiştirmez; hiçbirinde olay mantığı
 * yoktur. Bu, gerçek bir sahada en çok işe yarayan özelliktir: ekranda görünen
 * her sayının nereden geldiği tek bir indirgeyiciye kadar izlenebilir.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Radio, Wifi, WifiOff } from "lucide-react";
import type {
  SimulationConfig,
  SimulationResults,
} from "../../types/simulationTypes";
import {
  CONNECTION_LABEL,
  DemoLiveProvider,
  LiveFactoryStore,
  ReplayProvider,
  SCENARIOS,
  SHIFT_START_MINUTES,
  asReplayControls,
  initialLiveState,
  liveTotals,
  providerCatalog,
  recordScenario,
  seedsFromConfig,
  useLiveFactory,
  liveStatement,
  liveRailStations,
  liveMetrics,
  type ScenarioId,
} from "../../lib/live";
import {
  BridgeLiveProvider,
  RUNTIME_SOURCE_ID,
  RuntimeBridgeClient,
  feedStatus,
  isSimulatedSourceId,
  type FeedStatus,
  type StreamStatus,
} from "../../lib/connectors";
import { API_BASE_URL } from "../../lib/apiClient";
import { getAccessToken } from "../../lib/authClient";
import { EmptyState } from "../ui/Primitives";
/* Karar yüzeyi Command Center ve Sonuç ekranıyla **aynı** bileşenlerle
   kurulur; canlı için ikinci bir kopya yazılmadı (MASTER §15, §19.1). */
import { Statement } from "../ui/Statement";
import { ConstraintRail } from "../ui/ConstraintRail";
import { MetricGroup } from "../ui/MetricGroup";
import { AlarmCenter } from "./AlarmCenter";
import { EventTimeline } from "./EventTimeline";
import { LiveFlowCanvas } from "./LiveFlowCanvas";
import type { MonitoringKpi } from "../../lib/monitoring";
import { LiveKpiPanel } from "./LiveKpiPanel";
import { LiveStationList } from "./LiveStationList";
import { ReplayControls } from "./ReplayControls";
import { StationDrawer } from "./StationDrawer";
import { useLiveTrends } from "./useLiveTrends";

/** Bugün seçilebilen iki kaynak. */
type SourceId = "demo" | "replay" | "runtime";

/**
 * Kaynak seçenekleri.
 *
 * "Runtime (Gerçek)" bu sprintte açıldı: seçildiğinde ekran, sunucudaki
 * makine görüntülerinden ve cihaz olaylarından beslenir. Ötekiler üretilmiş
 * veridir ve şerit bunu her zaman yazar.
 */
const SOURCE_OPTIONS: { id: SourceId; label: string }[] = [
  { id: "demo", label: "Demo senaryo" },
  { id: "replay", label: "Kayıttan oynatma" },
  { id: "runtime", label: "Runtime (Gerçek)" },
];

interface LiveProductionCenterProps {
  config: SimulationConfig | null;
  results: SimulationResults | null;
  onStartSimulation: () => void;
  /**
   * Açılışta seçili kaynak ve senaryo.
   *
   * Demo modu bunları kullanır: ziyaretçi hiçbir şey seçmeden gerçek
   * `ReplayProvider` çalışır ve o dakikanın anlatısına uyan senaryo oynar.
   * Yalnızca **başlangıç** değeridir; kullanıcı istediği an değiştirebilir.
   */
  initialSource?: SourceId;
  initialScenario?: ScenarioId;
  /**
   * Sunucu köprüsündeki cihaz akışları.
   *
   * Hazır bir "besleme durumu" yerine **ham akış bilgisi** alınır ve karar
   * burada verilir. Hazır verdict geçirildiğinde tarayıcıda şu görüldü: demo
   * senaryosuyla çizilen ekranın tepesinde "Gerçek Veri" yazıyordu, çünkü
   * köprüde veri akıyordu. Ekranda ne gösterildiğini yalnızca bu bileşen
   * bilir; karar da burada verilmelidir.
   */
  bridge?: { streams: StreamStatus[]; anyVerifiedConnection: boolean };
  /**
   * Gerçek cihazlardan okunan KPI'lar; yoksa `null`.
   *
   * Yalnızca besleme **gerçek** olduğunda kartlara verilir. Benzetim
   * koşarken verilseydi, ekranda benzetim akışı ile cihaz sayıları yan yana
   * ve ayırt edilemez biçimde dururdu.
   */
  runtimeKpi?: MonitoringKpi | null;
}

/**
 * Besleme durumunun şerit rengi.
 *
 * Renk tek başına bilgi taşımaz: şeritte durumun adı da yazılıdır.
 */
const FEED_BANNER_CLASS: Record<FeedStatus, string> = {
  real: "border-emerald-200 bg-emerald-50 text-emerald-900",
  waiting: "border-sky-200 bg-sky-50 text-sky-900",
  simulated: "border-amber-200 bg-amber-50 text-amber-900",
  unverified: "border-slate-200 bg-slate-100 text-slate-700",
};

export function LiveProductionCenter({
  config,
  results,
  onStartSimulation,
  initialSource = "demo",
  initialScenario = "normal",
  bridge,
  runtimeKpi = null,
}: LiveProductionCenterProps) {
  const [sourceId, setSourceId] = useState<SourceId>(initialSource);
  /*
   * Runtime kaynağının başlangıç anı bir kez okunur. `useMemo` içinde
   * okunsaydı her yeniden hesaplamada değişir ve gelen olayların dakika
   * hesabı kayardı.
   */
  const [runtimeStartedAtMs] = useState(() => Date.now());
  const [scenario, setScenario] = useState<ScenarioId>(initialScenario);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);

  const seeds = useMemo(
    () => seedsFromConfig(config, results),
    [config, results],
  );

  /*
   * Store ve sağlayıcı **birlikte** kurulur; ikisi tek bir oturum oluşturur.
   * Ayrı ayrı üretilselerdi, yalnızca biri yenilendiğinde eski sağlayıcı yeni
   * store'a olay yayımlamaya devam eder ve iki senaryo birbirine karışırdı.
   * Yeni bir sağlayıcı her zaman temiz bir hatla başlar.
   */
  const { store, provider } = useMemo(() => {
    const nextStore = new LiveFactoryStore(initialLiveState(seeds));

    if (sourceId === RUNTIME_SOURCE_ID) {
      /*
       * Gerçek kaynak: sunucudaki köprü. Sağlayıcı önce her makinenin son
       * durumunu çeker, sonra olay akışını açar — ekran açıldığında geçmişi
       * yeniden oynatmak gerekmez.
       */
      return {
        store: nextStore,
        provider: new BridgeLiveProvider({
          client: new RuntimeBridgeClient({
            baseUrl: API_BASE_URL,
            getToken: getAccessToken,
          }),
          stationIds: seeds.map((seed) => seed.id),
          startedAtMs: runtimeStartedAtMs,
        }),
      };
    }

    const nextProvider =
      sourceId === "replay"
        ? new ReplayProvider(
            recordScenario(scenario, seeds, SHIFT_START_MINUTES, 3),
          )
        : new DemoLiveProvider(seeds, scenario, SHIFT_START_MINUTES);
    return { store: nextStore, provider: nextProvider };
  }, [seeds, sourceId, scenario, runtimeStartedAtMs]);

  const state = useLiveFactory(store);

  /* Bağlantı durumu doğrudan sağlayıcıdan okunur; ayrı bir kopyası tutulmaz. */
  const status = useSyncExternalStore(
    useCallback((notify: () => void) => provider.onStatus(notify), [provider]),
    useCallback(() => provider.status, [provider]),
  );

  useEffect(() => {
    const unsubscribe = provider.subscribe(store.dispatch);

    // Kayıttan oynatmada geri sarma, durumun sıfırlanmasını gerektirir.
    const controls = asReplayControls(provider);
    const unsubscribeReset = controls?.onReset(() =>
      store.reset(initialLiveState(seeds)),
    );

    void provider.connect();

    return () => {
      unsubscribe();
      unsubscribeReset?.();
      void provider.disconnect();
    };
  }, [provider, store, seeds]);

  const totals = useMemo(() => liveTotals(state), [state]);
  const trends = useLiveTrends(state);

  /* Karar yüzeyi: cümle, kısıt şeridi ve ölçümler. Üçü de mevcut canlı
     durumdan **okunur**, hesaplanmaz (bkz. lib/live/statement, rail, metrics). */
  const statement = useMemo(() => liveStatement(state.stations), [state.stations]);
  const railStations = useMemo(
    () => liveRailStations(state.stations),
    [state.stations],
  );
  const metrics = useMemo(
    () => liveMetrics(state.stations, totals),
    [state.stations, totals],
  );
  const replayControls = useMemo(() => asReplayControls(provider), [provider]);

  const selectedStation = useMemo(
    () =>
      state.stations.find((item) => item.stationId === selectedStationId) ?? null,
    [state.stations, selectedStationId],
  );

  const lastAlarm = useMemo(
    () =>
      selectedStationId === null
        ? null
        : (state.alarms.find((alarm) => alarm.stationId === selectedStationId) ??
          null),
    [state.alarms, selectedStationId],
  );

  const handleSelectStation = useCallback(
    (stationId: string) => setSelectedStationId(stationId),
    [],
  );
  const handleCloseDrawer = useCallback(() => setSelectedStationId(null), []);

  if (!config || seeds.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={Radio}
          title="İzlenecek bir hat yok"
          description="Canlı üretim merkezi, açık bir fabrika modelinin istasyonlarını izler. Bir model kurduğunuzda hattın anlık durumu burada görünür."
          action={
            <button
              type="button"
              onClick={onStartSimulation}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus:outline-none"
            >
              Model kur
            </button>
          }
        />
      </div>
    );
  }

  const isConnected = status === "connected";

  /*
   * Şeritteki durum, **bu ekranda çizilen** veriyi anlatır: seçili kaynak
   * benzetimse köprüde veri aksa bile şerit "Benzetim" der ve gerçek verinin
   * nerede olduğunu ayrıca söyler.
   */
  const activeFeed = feedStatus({
    streams: bridge?.streams ?? [],
    simulatedProvider: isSimulatedSourceId(sourceId),
    anyVerifiedConnection: bridge?.anyVerifiedConnection ?? false,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Verinin nereden geldiği kalıcı olarak yazılır: sahte sensör verisini
          gerçek sanan bir yönetici, olmayan bir arızaya ekip gönderebilir.
          Dört durum ayrı ayrı gösterilir — "Gerçek Veri", "Veri Bekleniyor",
          "Benzetim" ve "Doğrulanmadı" kullanıcı için farklı eylemler demektir. */}
      <p
        className={`shrink-0 border-b px-4 py-1.5 text-center text-[11px] font-medium ${
          FEED_BANNER_CLASS[activeFeed.status]
        }`}
      >
        <span className="font-semibold">{activeFeed.label}</span> — {activeFeed.reason}
      </p>

      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold ${
              isConnected
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-slate-100 text-slate-600"
            }`}
          >
            {isConnected ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            {CONNECTION_LABEL[status]}
          </span>
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
          Kaynak
          <select
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value as SourceId)}
            /* Dokunma hedefi 44px (MASTER §14); punto ve dolgu değişmedi. */
            className="min-h-[44px] rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-800 focus:outline-none"
          >
            {SOURCE_OPTIONS.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
            {/* Henüz bağlanamayan kaynaklar listede kalır ve "yakında"
                işaretlenir: ürünün nereye gittiğini göstermek, gizlemekten
                dürüsttür. */}
            {providerCatalog()
              .filter((choice) => !choice.isAvailable)
              .map((choice) => (
                <option key={choice.id} value={choice.id} disabled>
                  {choice.name} (yakında)
                </option>
              ))}
          </select>
        </label>

        <label
          className={`flex items-center gap-1.5 text-[11px] text-slate-500 ${
            sourceId === RUNTIME_SOURCE_ID ? "opacity-40" : ""
          }`}
          title={
            sourceId === RUNTIME_SOURCE_ID
              ? "Gerçek veride senaryo seçilmez; hat ne yapıyorsa o görünür."
              : undefined
          }
        >
          Senaryo
          <select
            value={scenario}
            onChange={(event) => setScenario(event.target.value as ScenarioId)}
            className="min-h-[44px] rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-800 focus:outline-none"
          >
            {SCENARIOS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        {replayControls && (
          <div className="min-w-[16rem] flex-1">
            <ReplayControls controls={replayControls} />
          </div>
        )}
      </header>

      {/*
        Karar yüzeyi (Sprint 2I-B): cümle → kısıt → ölçüm.

        Kontrol şeridinin altında, canlı görselleştirmenin üstünde durur;
        kullanıcı önce hattın ne yaptığını okur, sonra diyagrama bakar.

        Kutu yok, ızgara yok: bölümler ince çizgiyle ayrılır — Sonuç ekranının
        2G'de kurduğu dilin aynısı. Cümle yoksa (hiç istasyon yoksa) bölüm hiç
        çizilmez; boş bir karar yüzeyi ölçülmemişi ölçülmüş gibi gösterirdi.
      */}
      {/*
        Yerleşim zinciri (Sprint 2I-B.2 — regresyon düzeltmesi).

        2I-B'de bu satır `lg` altında da `flex-col` kalıyor, sol sütun `flex-1`,
        kardeş `<aside>` ise `shrink-0` idi. Kenar panelin doğal yüksekliği
        (375'te ~530px, 768'de 668px) satırın tamamını yiyor, `flex-1` olan sol
        sütuna **0 piksel** kalıyordu: `clientHeight: 0`, `scrollHeight: 1137`.
        Sonuç, tarayıcıda ölçüldü — Statement, ConstraintRail ve MetricGroup
        hiç görünmüyor, olay akışı KPI kartlarının üstüne biniyor ve istasyon
        düğmesi `elementFromPoint` ile yakalanamıyordu.

        Ders: **`flex-1` vermek bir çocuğun görüneceğini garanti etmez.** Kardeş
        `shrink-0` ve doğal yüksekliği kabın tamamından büyükse, `min-h-0` olan
        esnek çocuk sıfıra iner.

        Düzeltme, iki genişlik için iki ayrı kaydırma modeli kurar:

        - `< lg`: satırın **kendisi** tek kaydırma kabıdır. Çocuklar doğal
          yüksekliklerini alır; hiçbiri sıfıra çökmez, hiçbiri ötekinin üstüne
          binmez. Olay akışı altta sabit kalır.
        - `lg+`: satır yatay ve taşma gizli; sol sütun ile kenar panel kendi
          içlerinde kayar — 2I-B'deki masaüstü davranışının aynısı.
      */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {statement && (
            <div className="shrink-0 space-y-3 border-b border-slate-200 px-4 py-3">
              <Statement
                headline={statement.headline}
                detail={statement.detail ?? undefined}
              />
              <ConstraintRail stations={railStations} />
              {/* Ölçüm şeridi 375'te tek sütunda 353 piksel tutuyordu. Sarmalayıcı
                  yalnızca `sm` altında iki sütuna indirir; paylaşılan
                  `MetricGroup` bileşeninin kendi sınıfları değişmez, dolayısıyla
                  Command Center ve Sonuç ekranı etkilenmez. */}
              <div className="max-sm:[&>section]:grid-cols-2">
                <MetricGroup items={metrics} />
              </div>
            </div>
          )}

          {/* Diyagram yalnızca geniş ekranda; dar ekranda okunabilir bir liste.
              Mobilde `flex-1` yok: sayfa akışında doğal yüksekliğini alır. */}
          <div className="min-h-[22rem] lg:flex-1">
          <div className="hidden h-full lg:block">
            <LiveFlowCanvas
              config={config}
              stations={state.stations}
              onSelectStation={handleSelectStation}
              selectedStationId={selectedStationId}
            />
          </div>
          <div className="h-full lg:hidden">
            <LiveStationList
              stations={state.stations}
              onSelectStation={handleSelectStation}
            />
          </div>
          </div>
        </div>

        <aside className="w-full shrink-0 space-y-3 border-t border-slate-200 px-3 py-3 lg:w-[23rem] lg:overflow-y-auto lg:border-t-0 lg:border-l">
          <LiveKpiPanel
            totals={totals}
            trends={trends}
            clockMinutes={state.clockMinutes}
            eventCount={state.eventCount}
            runtimeKpi={activeFeed.status === "real" ? runtimeKpi : null}
          />

          <section>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Alarm merkezi
            </h3>
            <AlarmCenter
              alarms={state.alarms}
              clockMinutes={state.clockMinutes}
              onSelectStation={handleSelectStation}
            />
          </section>
        </aside>

        <StationDrawer
          station={selectedStation}
          lastAlarm={lastAlarm}
          clockMinutes={state.clockMinutes}
          onClose={handleCloseDrawer}
          /* Zaten var olan gezinme: `onStartSimulation` App'te
             `goToSection("simulation")`e bağlı. Yeni bir gezinme API'si
             eklenmedi. */
          onOpenSimulation={onStartSimulation}
        />
      </div>

      <footer className="h-32 shrink-0 border-t border-slate-200 lg:h-40">
        <EventTimeline feed={state.feed} onSelectStation={handleSelectStation} />
      </footer>
    </div>
  );
}
