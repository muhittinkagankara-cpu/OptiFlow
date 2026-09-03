/**
 * Uygulama kabuğu ve sayfalar arası gezinme.
 *
 * Görünümler: fabrika listesi, sihirbaz (Sayfa 4), süreç editörü (Sayfa 5),
 * sonuç ekranı (Sayfa 6) ve senaryo karşılaştırması. Ayrı bir yönlendirme
 * kütüphanesi hâlâ eklenmedi: görünümler arasında taşınan durum bu bileşende
 * tutuluyor ve URL'e sığdırılabilecek türden değil. Fabrikaların paylaşılabilir
 * adresleri olması istendiğinde bu karar yeniden değerlendirilmelidir.
 *
 * Fabrika modeli artık backend'de yaşar
 * -------------------------------------
 * Model daha önce yalnızca bu bileşenin `useState`'inde duruyordu ve sayfa
 * yenilendiğinde kayboluyordu. Şimdi kaydedilen her model backend'de sürümlü
 * olarak saklanıyor; burada tutulan `config` yalnızca **çalışma kopyasıdır**.
 *
 * `localStorage`'a yalnızca son açılan fabrikanın **kimliği** yazılır, modelin
 * kendisi değil. Model bir iş verisidir: kullanıcının diğer cihazından da
 * görünmeli ve bir iş arkadaşıyla paylaşılabilmelidir. Tarayıcıya kopyalansaydı
 * iki kopya sessizce ayrışır ve hangisinin doğru olduğu belirsizleşirdi.
 *
 * Karşılaştırma referansı burada saklanır ve kalıcı değildir — karşılaştırma
 * tek oturumluk bir işlemdir.
 *
 * Kimlik doğrulama — Faz 2
 * -------------------------
 * Oturum yoksa yalnızca `LoginPage` gösterilir; hiçbir veri ucu çağrılmaz.
 * Oturum açıldıktan sonra `GET /api/me` bir kez çağrılır — bu çağrı
 * kullanıcının organizasyonunu (yoksa) kendiliğinden kurar ve "organizasyon
 * yükleniyor" durumu tam olarak bu çağrının süresidir. Fabrika listesi ancak
 * kimlik çözüldükten sonra yüklenir; aksi hâlde `listFactories()` oturum
 * hazır olmadan çağrılıp 401 alırdı.
 *
 * Çıkış yapıldığında ya da farklı bir hesap oturum açtığında tüm uygulama
 * durumu sıfırlanır (`resetAppState`). Bu, önceki organizasyonun verisinin
 * bir an için ekranda kalıp yeni kullanıcıya görünmesini engeller — aynı
 * tarayıcı sekmesinde hesap değiştirmek, önceki oturumun hiç kalıntı
 * bırakmamasını gerektirir.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { LoginPage } from "./components/auth/LoginPage";
import { FactoryPicker } from "./components/factory/FactoryPicker";
import { OnboardingWizard } from "./components/wizard/OnboardingWizard";
import { ProcessEditor } from "./components/editor/ProcessEditor";
import { InventoryPage } from "./components/inventory/InventoryPage";
import { ResultsPage } from "./components/results/ResultsPage";
import {
  ScenarioComparison,
  type ComparisonScenario,
} from "./components/results/ScenarioComparison";
import { FolderIcon, WarningIcon } from "./components/shared/icons";
import {
  ApiError,
  API_BASE_URL,
  createFactory,
  deleteFactory,
  getFactory,
  getMe,
  isBackendReachable,
  listFactories,
  runFactorySimulation,
  saveFactory,
} from "./lib/apiClient";
import {
  getCurrentSession,
  isAuthConfigured,
  onAuthStateChange,
  signOut,
} from "./lib/authClient";
import { GENERIC_ERROR_MESSAGE } from "./lib/errorMessages";
import {
  applyLayout,
  recallFactory,
  rememberFactory,
  type SavedSnapshot,
} from "./lib/factoryModel";
import { buildFlowFromConfig } from "./lib/configBuilder";
import type { FlowEdge, FlowNode } from "./lib/configBuilder";
import type {
  Factory,
  FactoryLayout,
  MeResponse,
  SimulationConfig,
  SimulationRunResponse,
} from "./types/simulationTypes";

type View =
  | "factories"
  | "wizard"
  | "editor"
  | "results"
  | "comparison"
  | "inventory";

/** Açık fabrikanın kimliği, adı ve en son kaydedilen hâli. */
interface OpenFactory {
  id: string;
  name: string;
  snapshot: SavedSnapshot | null;
}

export default function App() {
  const [view, setView] = useState<View>("wizard");
  const [config, setConfig] = useState<SimulationConfig | null>(null);
  const [result, setResult] = useState<SimulationRunResponse | null>(null);
  /**
   * Envanter sekmesinden dönüldüğünde hangi üretim görünümüne gidileceği.
   *
   * Sekme değiştirmek kurulan modeli kaybettirmemelidir; kullanıcı envantere
   * bakıp geri döndüğünde bıraktığı yeri bulmalıdır.
   */
  const [productionView, setProductionView] = useState<View>("wizard");
  const [baseline, setBaseline] = useState<ComparisonScenario | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  /** Kayıtlı fabrikalar ve açık olan. */
  const [factories, setFactories] = useState<Factory[]>([]);
  const [openFactory, setOpenFactory] = useState<OpenFactory | null>(null);
  /**
   * Açık fabrikanın canvas yerleşimi.
   *
   * Editöre `initialFlow` olarak verilir; böylece kaydedilmiş kutu konumları
   * geri gelir. Yalnızca `config` aktarılsaydı otomatik yerleşim çalışır ve
   * kullanıcının yerleştirdiği yirmi kutu her açılışta sıfırlanırdı.
   */
  const [initialFlow, setInitialFlow] = useState<{
    nodes: FlowNode[];
    edges: FlowEdge[];
  } | null>(null);
  const [isLoadingFactories, setIsLoadingFactories] = useState(true);
  const [factoryErrors, setFactoryErrors] = useState<string[]>([]);

  /**
   * Kimlik doğrulama durumu.
   *
   * `authLoading`, ilk `getCurrentSession()` çağrısı dönene kadar `true`dur —
   * bu süre boyunca ne giriş ekranı ne ana uygulama gösterilir, aksi hâlde
   * zaten oturumu olan bir kullanıcı bir an için giriş ekranını görürdü.
   * `identity`, `GET /api/me` yanıtıdır; `identityLoading` yalnızca o çağrı
   * sürerken `true`dur ("organizasyon yükleniyor" durumu tam olarak budur).
   */
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [identity, setIdentity] = useState<MeResponse | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  /**
   * Editörü baştan kurmak için kullanılan anahtar.
   *
   * Canvas durumu `useState` başlangıç değerinden gelir ve prop değişimiyle
   * kendiliğinden tazelenmez; başka bir fabrika açıldığında editör
   * remount edilmelidir. Anahtar olarak fabrika kimliği kullanılamaz: ilk
   * kaydetmede kimlik `null`'dan bir değere geçer ve editör tam da kullanıcının
   * yerleşimi kaydettiği anda remount olup kutuları otomatik yerleşime geri
   * atardı. Bu yüzden anahtar yalnızca gerçekten başka bir model yüklenirken
   * artırılır.
   */
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    isBackendReachable().then((online) => {
      if (!cancelled) {
        setBackendOnline(online);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reportError = useCallback((error: unknown) => {
    setFactoryErrors(
      error instanceof ApiError ? error.userMessages : [GENERIC_ERROR_MESSAGE],
    );
  }, []);

  /**
   * Bir fabrikayı açar: modeli ve yerleşimi backend'den yükler.
   *
   * Kaydedilmiş modeli olmayan bir fabrika doğrudan sihirbaza götürür; boş bir
   * editör açmak, kullanıcıya hiçbir başlangıç noktası vermezdi.
   */
  const openFactoryById = useCallback(
    async (factoryId: string) => {
      setFactoryErrors([]);
      try {
        const detail = await getFactory(factoryId);
        const version = detail.current_version ?? null;
        setOpenFactory({
          id: detail.factory.id,
          name: detail.factory.name,
          snapshot: version
            ? { config: version.config, layout: version.layout ?? null }
            : null,
        });
        rememberFactory(detail.factory.id);

        if (!version) {
          setConfig(null);
          setInitialFlow(null);
          setEditorKey((current) => current + 1);
          setResult(null);
          setView("wizard");
          setProductionView("wizard");
          return;
        }

        const flow = buildFlowFromConfig(version.config);
        setInitialFlow({
          nodes: applyLayout(flow.nodes, version.layout),
          edges: flow.edges,
        });
        setEditorKey((current) => current + 1);
        setConfig(version.config);
        setResult(null);
        setView("editor");
        setProductionView("editor");
      } catch (error) {
        // Kimliği hatırlanan fabrika silinmiş olabilir; hatırlama temizlenir ki
        // kullanıcı her açılışta aynı hatayı görmesin.
        rememberFactory(null);
        reportError(error);
        setView("factories");
      }
    },
    [reportError],
  );

  /** Fabrika listesini tazeler. */
  const refreshFactories = useCallback(async () => {
    try {
      return await listFactories();
    } catch (error) {
      reportError(error);
      return [];
    }
  }, [reportError]);

  /**
   * Tüm uygulama durumunu sıfırlar.
   *
   * Çıkış yapıldığında ya da farklı bir hesap oturum açtığında çağrılır.
   * Önceki organizasyonun modeli, sonucu ya da fabrika listesi bir an bile
   * ekranda kalıp yeni kullanıcıya görünmemelidir.
   */
  const resetAppState = useCallback(() => {
    setConfig(null);
    setResult(null);
    setBaseline(null);
    setFactories([]);
    setOpenFactory(null);
    setInitialFlow(null);
    setEditorKey((current) => current + 1);
    setIsLoadingFactories(true);
    setFactoryErrors([]);
    setIdentity(null);
    rememberFactory(null);
    setView("wizard");
    setProductionView("wizard");
  }, []);

  /**
   * Oturum bootstrap'ı: mevcut oturum bir kez okunur, sonraki her değişiklik
   * (giriş, çıkış, token yenileme) `onAuthStateChange` ile izlenir.
   *
   * `previousUserId`, hesabın değiştiğini (biri çıkıp başkası giriş yaptığını)
   * anlamak için tutulur — yalnızca token yenilenmesinde (aynı kullanıcı,
   * yeni token) uygulama durumunu sıfırlamak istemeyiz, yalnızca gerçekten
   * farklı bir kullanıcı geldiğinde.
   */
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const current = await getCurrentSession();
      if (cancelled) {
        return;
      }
      previousUserId.current = current?.user.id ?? null;
      setSession(current);
      setAuthLoading(false);
    })();

    const unsubscribe = onAuthStateChange((next) => {
      const nextUserId = next?.user.id ?? null;
      if (nextUserId !== previousUserId.current) {
        resetAppState();
      }
      previousUserId.current = nextUserId;
      setSession(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Oturum kurulduğunda kimlik çözülür; bu, kullanıcının organizasyonunu
  // kendiliğinden kurar (bkz. `GET /api/me`). "Organizasyon yükleniyor"
  // durumu tam olarak bu çağrının süresidir.
  useEffect(() => {
    if (!session) {
      return;
    }
    let cancelled = false;
    setIdentityLoading(true);
    setAuthError(null);

    (async () => {
      try {
        const me = await getMe();
        if (!cancelled) {
          setIdentity(me);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        // Token gecersiz hale gelmis olabilir (ör. sunucu tarafinda iptal
        // edilmis); kullanicinin takilip kalmamasi icin oturum kapatilir ve
        // giris ekranina donulur.
        setAuthError(
          error instanceof ApiError ? error.userMessages[0] : GENERIC_ERROR_MESSAGE,
        );
        await signOut();
      } finally {
        if (!cancelled) {
          setIdentityLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  // Kimlik çözüldükten sonra: kayıtlı fabrikalar yüklenir ve en son açılan
  // varsa geri açılır. "Sayfa yenilendiğinde kaldığı yerden devam etme"
  // gereksinimi buradadır. Kimlikten önce çalışamaz: `listFactories()`
  // oturum hazır olmadan çağrılırsa 401 alır.
  useEffect(() => {
    if (!identity) {
      return;
    }
    let cancelled = false;

    (async () => {
      let items: Factory[] = [];
      try {
        items = await listFactories();
      } catch {
        // Backend kapalıysa liste boş kalır; kullanıcı yine de modelini
        // kurabilir ve bağlantı geri geldiğinde kaydedebilir.
      }
      if (cancelled) {
        return;
      }
      setFactories(items);
      setIsLoadingFactories(false);

      const remembered = recallFactory();
      if (remembered && items.some((item) => item.id === remembered)) {
        await openFactoryById(remembered);
      } else {
        if (remembered) {
          rememberFactory(null);
        }
        setView(items.length > 0 ? "factories" : "wizard");
      }
    })();

    return () => {
      cancelled = true;
    };
    // `identity` degistiginde (farkli bir hesap) yeniden calismali;
    // `openFactoryById` referansi `reportError` uzerinden sabittir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  /**
   * Editörden gelen kaydetme isteği.
   *
   * Fabrika henüz yoksa oluşturulur; varsa güncellenir. Backend özet
   * karşılaştırması yaptığı için aynı modeli iki kez kaydetmek yeni bir sürüm
   * yaratmaz — istemci tarafında ayrıca bir kontrol gerekmez.
   */
  const handleSaveFactory = useCallback(
    async (nextConfig: SimulationConfig, layout: FactoryLayout) => {
      setFactoryErrors([]);
      const detail = openFactory
        ? await saveFactory(openFactory.id, { config: nextConfig, layout })
        : await createFactory({
            name: defaultFactoryName(),
            config: nextConfig,
            layout,
          });

      const version = detail.current_version ?? null;
      setOpenFactory({
        id: detail.factory.id,
        name: detail.factory.name,
        snapshot: version
          ? { config: version.config, layout: version.layout ?? null }
          : null,
      });
      rememberFactory(detail.factory.id);
      setConfig(nextConfig);
      setFactories(await refreshFactories());
    },
    [openFactory, refreshFactories],
  );

  const handleDeleteFactory = useCallback(
    async (factoryId: string) => {
      setFactoryErrors([]);
      try {
        await deleteFactory(factoryId);
        if (openFactory?.id === factoryId) {
          setOpenFactory(null);
          setConfig(null);
          setResult(null);
          setInitialFlow(null);
          setEditorKey((current) => current + 1);
          rememberFactory(null);
        }
        setFactories(await refreshFactories());
      } catch (error) {
        reportError(error);
      }
    },
    [openFactory, refreshFactories, reportError],
  );

  /** Yeni bir model kurmaya başlar; açık fabrika bırakılır. */
  const startNewFactory = useCallback(() => {
    setOpenFactory(null);
    setConfig(null);
    setResult(null);
    setInitialFlow(null);
    setEditorKey((current) => current + 1);
    setBaseline(null);
    rememberFactory(null);
    setFactoryErrors([]);
    setView("wizard");
    setProductionView("wizard");
  }, []);

  const handleSimulationComplete = (
    response: SimulationRunResponse,
    usedConfig: SimulationConfig,
  ) => {
    setResult(response);
    setConfig(usedConfig);
    setView("results");
  };

  const startComparison = () => {
    if (!config) {
      return;
    }
    // Referans, o anki modelin derin kopyasıdır: kullanıcı editörde değişiklik
    // yaptığında referans senaryo da değişseydi karşılaştırma anlamsız olurdu.
    setBaseline({ label: "Mevcut model", config: structuredClone(config) });
    setView("editor");
  };

  const handleLogout = useCallback(() => {
    void signOut();
    // `onAuthStateChange` bu cagriya tepki verip `resetAppState`'i zaten
    // calistiracaktir; burada ayrica cagirmak cift sifirlama olurdu.
  }, []);

  if (!isAuthConfigured) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <WarningIcon className="mx-auto mb-3 h-6 w-6 text-amber-600" />
          <p className="text-sm text-amber-900">
            Kimlik doğrulama yapılandırılmamış. <code>VITE_SUPABASE_URL</code> ve{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> ortam değişkenlerini tanımlayın.
          </p>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return <FullPageStatus message="Yükleniyor…" />;
  }

  if (!session) {
    return <LoginPage />;
  }

  if (identityLoading || !identity) {
    return <FullPageStatus message="Organizasyon yükleniyor…" error={authError} />;
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        onOpenFactories={() => {
          setFactoryErrors([]);
          setView("factories");
        }}
        factoryName={openFactory?.name ?? null}
        orgName={identity.org_name}
        onLogout={handleLogout}
        current={view}
        onSelect={(next) => {
          if (next === "inventory") {
            // Üretim tarafındaki yer işaretlenir ki geri dönüşte aynı ekran
            // açılsın; envanter sekmesi akışı sıfırlamamalıdır.
            setProductionView(view === "inventory" ? productionView : view);
            setView("inventory");
          } else {
            setView(
              productionView === "inventory" ? defaultProductionView() : productionView,
            );
          }
        }}
      />

      {backendOnline === false && (
        <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">
            Simülasyon servisine ulaşılamıyor ({API_BASE_URL}). Modeli
            kurabilirsiniz, ancak çalıştırmak için servisin açık olması gerekir.
          </p>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto">
        {view === "factories" && (
          <FactoryPicker
            factories={factories}
            isLoading={isLoadingFactories}
            errors={factoryErrors}
            onOpen={(factoryId) => void openFactoryById(factoryId)}
            onDelete={(factoryId) => void handleDeleteFactory(factoryId)}
            onCreateNew={startNewFactory}
          />
        )}

        {view === "wizard" && (
          <OnboardingWizard onSimulationComplete={handleSimulationComplete} />
        )}

        {view === "editor" && config && (
          <ProcessEditor
            key={editorKey}
            initialConfig={config}
            initialFlow={initialFlow}
            lastResult={result}
            factoryName={openFactory?.name ?? null}
            savedSnapshot={openFactory?.snapshot ?? null}
            onSave={handleSaveFactory}
            onRunSaved={
              openFactory?.snapshot
                ? () => runFactorySimulation(openFactory.id)
                : undefined
            }
            onBack={() => setView(result ? "results" : defaultProductionView())}
            onSimulationComplete={handleSimulationComplete}
          />
        )}

        {view === "results" && result && config && (
          <ResultsPage
            result={result}
            config={config}
            onBackToEditor={() => setView("editor")}
            onStartOver={startNewFactory}
            onCompareFromHere={startComparison}
            onOpenComparison={baseline ? () => setView("comparison") : undefined}
            baselineLabel={baseline?.label ?? null}
          />
        )}

        {view === "inventory" && (
          <InventoryPage
            config={config}
            simulationId={result?.simulation_id ?? null}
          />
        )}

        {view === "comparison" && baseline && config && (
          <ScenarioComparison
            baseline={baseline}
            candidate={{ label: "Değiştirilmiş model", config }}
            onBack={() => setView("results")}
          />
        )}
      </main>
    </div>
  );
}

/**
 * Üst çubuk ve ana sekmeler.
 *
 * İki alan vardır: üretim (sihirbaz → editör → sonuç) ve envanter. Envanter
 * ayrı bir sekmedir çünkü bağımsız bir modüldür — kalem eklemeden üretim
 * simülasyonu, simülasyon çalıştırmadan envanter analizi yapılabilir. Akış
 * içine gömülseydi, biri olmadan diğerinin çalışmadığı izlenimi doğardı.
 */
function TopBar({
  current,
  onSelect,
  onOpenFactories,
  factoryName,
  orgName,
  onLogout,
}: {
  current: View;
  onSelect: (area: "production" | "inventory") => void;
  onOpenFactories: () => void;
  factoryName: string | null;
  /** Açık organizasyonun adı; her ekranda görünür kalır. */
  orgName: string;
  onLogout: () => void;
}) {
  const isInventory = current === "inventory";

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          S
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">Üretim Simülasyonu</p>
          <p className="text-xs text-slate-500">
            {/* Hangi fabrikanın açık olduğu üst çubukta durur: kullanıcı birden
                çok fabrika kaydedebildiği için, ekrandaki modelin hangisi
                olduğu her görünümde okunabilmelidir. */}
            {factoryName ?? "Hattınızı kurun, çalıştırın, darboğazı görün"}
          </p>
        </div>
      </div>

      <nav aria-label="Ana bölümler" className="flex gap-1">
        <TabButton
          label="Üretim"
          isActive={!isInventory}
          onClick={() => onSelect("production")}
        />
        <TabButton
          label="Envanter"
          isActive={isInventory}
          onClick={() => onSelect("inventory")}
        />
      </nav>

      <button
        type="button"
        onClick={onOpenFactories}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <FolderIcon className="h-4 w-4" />
        Fabrikalarım
      </button>

      <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
        <span className="hidden text-sm text-slate-600 sm:inline" title="Organizasyon">
          {orgName}
        </span>
        <button
          type="button"
          onClick={onLogout}
          className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          Çıkış yap
        </button>
      </div>
    </header>
  );
}

/**
 * Kimlik doğrulama sırasında tam sayfa durum göstergesi.
 *
 * Ana uygulama kabuğu (üst çubuk, sekmeler) henüz gösterilmez: hangi
 * organizasyonun açık olduğu belli olmadan bir arayüz göstermek, yanlış
 * organizasyona ait bir ekranın bir an için görünmesi riskini taşırdı.
 */
function FullPageStatus({
  message,
  error,
}: {
  message: string;
  error?: string | null;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-50 px-4 text-center">
      <p className="text-sm text-slate-600">{message}</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

function TabButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
        isActive
          ? "bg-brand-50 text-brand-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * "Üretim" sekmesine dönüldüğünde açılacak varsayılan görünüm.
 *
 * Kayıtlı fabrikası olan kullanıcı listeyi görmelidir; hiç fabrikası olmayan
 * doğrudan sihirbaza gitmelidir. Sabit bir görünüm seçilseydi, biri her
 * seferinde gereksiz bir ekrandan geçmek zorunda kalırdı.
 */
function defaultProductionView(): View {
  return recallFactory() ? "factories" : "wizard";
}

/**
 * Kaydedilen ilk fabrikaya verilen ad.
 *
 * Kullanıcıdan kaydetme anında ad istemek, akışın ortasına bir soru koymak
 * olurdu; ad sonradan fabrika listesinden değiştirilebilir.
 */
function defaultFactoryName(): string {
  const today = new Date().toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
  });
  return `Fabrikam (${today})`;
}
