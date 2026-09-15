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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { LoginPage } from "./components/auth/LoginPage";
import { FactoryPicker } from "./components/factory/FactoryPicker";
import { ImportWizard } from "./components/import/ImportWizard";
import { OnboardingWizard } from "./components/wizard/OnboardingWizard";
import { ProcessEditor } from "./components/editor/ProcessEditor";
import { InventoryPage } from "./components/inventory/InventoryPage";
import { ResultsPage } from "./components/results/ResultsPage";
import {
  ScenarioComparison,
  type ComparisonScenario,
} from "./components/results/ScenarioComparison";
import { WarningIcon } from "./components/shared/icons";
import { CommandCenter } from "./components/dashboard/CommandCenter";
import { CopilotHome } from "./components/copilot/CopilotHome";
import { DemoBanner } from "./components/demo/DemoBanner";
import { DemoLockedView } from "./components/demo/DemoLockedView";
import { LandingPage } from "./components/demo/LandingPage";
import { FactoryIntelligence } from "./components/intelligence/FactoryIntelligence";
import { FinancePage } from "./components/finance/FinancePage";
import { LiveSection } from "./components/live/LiveSection";
import { OperatorApp } from "./components/operator/OperatorApp";
import { SalesSection } from "./components/sales/SalesSection";
import { ValidationWorkspace } from "./components/validation/ValidationWorkspace";
import { ConnectorCenter } from "./components/connectors/ConnectorCenter";
import { TeamSection } from "./components/team/TeamSection";
import { PilotFactoryWizard } from "./components/pilot/PilotFactoryWizard";
import { PilotWorkspacePage } from "./components/pilot/PilotWorkspacePage";
import { OperationsPage } from "./components/ops/OperationsPage";
import { ProvisioningWizard } from "./components/provisioning/ProvisioningWizard";
import { HistoricalTrendsPage } from "./components/telemetry/HistoricalTrendsPage";
import { RuntimeDiagnosticsPage } from "./components/diagnostics/RuntimeDiagnosticsPage";
import { RuntimeBridgePage } from "./components/runtime/RuntimeBridgePage";
import { EnterpriseSection } from "./components/enterprise/EnterpriseSection";
import { MachineInventoryManager } from "./components/enterprise/MachineInventoryManager";
import { useEnterpriseSetup } from "./components/enterprise/useEnterpriseSetup";
import { SectionTabs } from "./components/shell/SectionTabs";
import { Sidebar } from "./components/shell/Sidebar";
import { TopBar } from "./components/shell/TopBar";
import { displayName } from "./components/shell/userDisplay";
import { SettingsPage } from "./components/shell/SimplePages";
import { ReportsPage } from "./components/reports/ReportsPage";
import {
  DEMO_NAV_ITEMS,
  NAV_ITEMS,
  VIEW_TITLE,
  sectionOfView,
  type Section,
  type View,
} from "./components/shell/navigation";
import {
  analyzeInventoryItem,
  ApiError,
  API_BASE_URL,
  createFactory,
  deleteFactory,
  getFactory,
  getMe,
  isBackendReachable,
  listFactories,
  listInventoryItems,
  runFactorySimulation,
  saveFactory,
} from "./lib/apiClient";
import {
  getCurrentSession,
  isAuthConfigured,
  onAuthStateChange,
  signOut,
} from "./lib/authClient";
import {
  DEMO_FACTORY_NAME,
  DEMO_ORG_NAME,
  demoSnapshot,
  nextPhase,
  phaseAt,
  scenarioForPhase,
  startedAtForPhase,
} from "./lib/demo";
import type { ScenarioId } from "./lib/live";
import { monthlyLoss } from "./lib/dashboardMetrics";
import { GENERIC_ERROR_MESSAGE } from "./lib/errorMessages";
import {
  applyLayout,
  recallFactory,
  rememberFactory,
  type SavedSnapshot,
} from "./lib/factoryModel";
import {
  entryFromResult,
  recallRunHistory,
  rememberRun,
  type RunHistoryEntry,
} from "./lib/runHistory";
import type { ActionTarget } from "./lib/actionItems";
import { runRanAt } from "./lib/commandCenter";
import { buildFlowFromConfig } from "./lib/configBuilder";
import type { FlowEdge, FlowNode } from "./lib/configBuilder";
import { DEFAULT_SERVICE_LEVEL } from "./types/simulationTypes";
import type {
  Factory,
  FactoryDetail,
  FactoryLayout,
  FinancialReport,
  FinancialSettings,
  InventoryAnalysis,
  MeResponse,
  SimulationConfig,
  SimulationRunResponse,
} from "./types/simulationTypes";

/**
 * Demoda kapalı görünümler ve nedenleri.
 *
 * Ortak yanları sunucuya yazmalarıdır: model kaydetme, Excel içe aktarma,
 * envanter ve hesap ayarları oturum gerektirir. Demo oturumsuz çalıştığı için
 * bu uçlar çağrılamaz; çağrılsaydı ziyaretçi bir yetki hatasıyla karşılaşırdı.
 */
const DEMO_LOCKED_VIEWS: Partial<Record<View, { title: string; detail: string }>> =
  {
    editor: {
      title: "Model düzenleme demoda kapalı",
      detail:
        "Demo hazır bir metal hattını gösterir ve hiçbir şeyi kaydetmez. Kendi hattınızı kurup kaydetmek için bir hesap açın; süreç editörü, Excel içe aktarma ve sürümleme orada açılır.",
    },
    wizard: {
      title: "Yeni model kurma demoda kapalı",
      detail:
        "Demoda kurulu bir fabrika üzerinden geziliyor. Kendi fabrikanızı sihirbazla kurmak için bir hesap açın.",
    },
    import: {
      title: "Excel içe aktarma demoda kapalı",
      detail:
        "İçe aktarma, oluşturduğu fabrikayı sunucuya kaydeder. Kendi Excel dosyanızı aktarmak için bir hesap açın.",
    },
    factories: {
      title: "Fabrika listesi demoda kapalı",
      detail:
        "Demo tek bir hazır hat üzerinden ilerler. Birden çok fabrikayı kaydedip sürümlemek için bir hesap açın.",
    },
    inventory: {
      title: "Envanter demoda kapalı",
      detail:
        "Stok kalemleri hesabınıza bağlı olarak saklanır. Malzeme listenizi girmek için bir hesap açın.",
    },
    settings: {
      title: "Ayarlar demoda kapalı",
      detail: "Hesap ve organizasyon ayarları için önce bir hesap açın.",
    },
  };

/** Açık fabrikanın kimliği, adı ve en son kaydedilen hâli. */
interface OpenFactory {
  id: string;
  name: string;
  snapshot: SavedSnapshot | null;
}

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [config, setConfig] = useState<SimulationConfig | null>(null);
  const [result, setResult] = useState<SimulationRunResponse | null>(null);
  /** Dar ekrandaki gezinme çekmecesi. Masaüstünde her zaman kapalı sayılır. */
  const [isMenuOpen, setMenuOpen] = useState(false);
  /**
   * Finans raporu ve oranları uygulama düzeyinde tutulur.
   *
   * Command Center'daki "Aylık Kayıp" kartı ile Finans ekranı **aynı** raporu
   * okumak zorundadır; her ekran kendi hesabını yapsaydı aynı koşum için iki
   * farklı rakam gösterebilirlerdi. Oranlar da burada durur ki kullanıcı
   * ekranlar arasında gezinirken girdiği değerleri kaybetmesin.
   */
  const [financeReport, setFinanceReport] = useState<FinancialReport | null>(null);
  const [financeSettings, setFinanceSettings] = useState<FinancialSettings>({});
  /**
   * Command Center'ı besleyen iki yardımcı veri.
   *
   * `runHistory` bu tarayıcıda çalıştırılan koşumların özetidir (bkz.
   * `lib/runHistory`); `analyses` ise envanter kalemlerinin analizidir ve
   * "Bugün Yapılacaklar" kartlarındaki stok uyarılarını besler. İkisi de
   * yüklenmemişken `null`/boş kalır ve gösterge paneli o kuralları hiç
   * üretmez — eksik veri, sıfır değildir.
   */
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [inventoryAnalyses, setInventoryAnalyses] = useState<
    InventoryAnalysis[] | null
  >(null);
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
  /**
   * Fabrika listesi sunucudan **okunabildi mi**?
   *
   * Boş bir liste ile okunamamış bir liste ekranda aynı görünemez: birincisi
   * ölçülmüş bir sıfır, ikincisi ölçülmemiş bir bilinmezdir.
   */
  const [factoryListRead, setFactoryListRead] = useState(false);
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

  /*
   * Demo modu — SALES-1.
   *
   * Tek durum, demonun **başlangıç anıdır**. Aşama bundan türetilir
   * (`phaseAt`), ayrı bir "aşama" durumu tutulmaz: iki kaynak olsaydı biri
   * kaydırıldığında (sonraki adıma atlama) öteki geride kalırdı.
   *
   * Demo `session === null` iken çalışır. Uygulamadaki bütün ağ etkileri
   * `session` ya da `identity` bağımlılığına sahip olduğu için demoda hiçbiri
   * tetiklenmez — izolasyon ayrı bir bayrakla değil, mevcut yapıyla sağlanır.
   */
  const [demoStartedAt, setDemoStartedAt] = useState<number | null>(null);
  const [demoElapsedMs, setDemoElapsedMs] = useState(0);
  /** Karşılama ekranında kayıt formuna geçilsin mi? */
  const [wantsSignUp, setWantsSignUp] = useState(false);

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
    setFactoryListRead(false);
    setOpenFactory(null);
    setInitialFlow(null);
    setEditorKey((current) => current + 1);
    setIsLoadingFactories(true);
    setFactoryErrors([]);
    setIdentity(null);
    // Finans raporu ve girilen oranlar da temizlenir: bir önceki
    // organizasyonun maliyet verisi yeni kullanıcıya görünmemelidir.
    setFinanceReport(null);
    setFinanceSettings({});
    // Kosum gecmisi tarayicida kalir (cihaza ait bir kolayliktir) ama ekrandan
    // temizlenir: onceki organizasyonun kosumlari yeni kullaniciya gorunmemeli.
    setRunHistory([]);
    setInventoryAnalyses(null);
    rememberFactory(null);
    setView("dashboard");
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
      /*
       * Listenin **okunabildiği** ayrıca tutulur. Boş liste iki farklı şey
       * olabilir: hiç fabrika yok ya da sunucuya ulaşılamadı. Ekip ekranı
       * "fabrika sayısı" ölçüsünü okuyamadığında sıfır değil "Doğrulanmadı"
       * yazar; bu ayrım olmadan ölçülmemiş bir sayı ölçülmüş gibi görünürdü.
       */
      let listRead = true;
      try {
        items = await listFactories();
      } catch {
        // Backend kapalıysa liste boş kalır; kullanıcı yine de modelini
        // kurabilir ve bağlantı geri geldiğinde kaydedebilir.
        listRead = false;
      }
      if (cancelled) {
        return;
      }
      setFactories(items);
      setFactoryListRead(listRead);
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
    // Yeni bir koşum, eldeki finans raporunu geçersiz kılar: rapor eski
    // koşumun metriklerinden üretilmişti ve yeni sonuçla birlikte gösterilseydi
    // iki farklı koşumun sayıları aynı ekranda karışırdı. Oranlar korunur —
    // onlar kullanıcının kendi verisidir, koşuma bağlı değildir.
    setFinanceReport(null);
    // Kosum gecmisine yalnizca GERCEK sonuclar yazilir: her satir, o kosumun
    // donen yanitindan alinmis ozetidir.
    setRunHistory(
      rememberRun(
        entryFromResult(
          response,
          usedConfig,
          // Kimlik de taşınır: fabrika kartındaki "son koşum" rozeti kimliğe
          // göre eşleşir, ada göre eşleşme yalnızca eski kayıtlar için bir
          // yedek yoldur (bkz. `lib/onboarding.recentFactories`).
          openFactory ? { id: openFactory.id, name: openFactory.name } : null,
        ),
      ),
    );
    setView("results");
    setProductionView("results");
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

  /**
   * Command Center'ın yardımcı verileri: koşum geçmişi ve envanter analizi.
   *
   * Kimlik çözüldükten sonra bir kez yüklenir. Envanter analizi kalem başına
   * bir istek gerektiriyor (`/analyze/{id}` — envanter ekranındaki desenin
   * aynısı); bu yüzden gösterge panelini **bloklamaz**: liste geldiğinde stok
   * kartları kendiliğinden belirir, gelmezse panel diğer kartlarla çalışmaya
   * devam eder. Hata sessizce yutulur çünkü bu veri gösterge panelinin
   * zorunlu bir parçası değil, zenginleştirmesidir.
   */
  useEffect(() => {
    if (!identity) {
      return;
    }
    let cancelled = false;

    setRunHistory(recallRunHistory());

    (async () => {
      try {
        const items = await listInventoryItems();
        if (cancelled || items.length === 0) {
          if (!cancelled) {
            setInventoryAnalyses([]);
          }
          return;
        }
        const analyses = await Promise.all(
          // Envanter ekranıyla aynı varsayılan hizmet seviyesi kullanılır;
          // farklı bir değer, iki ekranda farklı sipariş noktası gösterirdi.
          items.map((item) => analyzeInventoryItem(item.id, DEFAULT_SERVICE_LEVEL)),
        );
        if (!cancelled) {
          setInventoryAnalyses(analyses);
        }
      } catch {
        // Envanter okunamadıysa stok kuralları hiç üretilmez; panelin geri
        // kalanı etkilenmez.
        if (!cancelled) {
          setInventoryAnalyses(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identity]);

  /**
   * Kenar çubuğundan bir bölüme geçiş.
   *
   * "Simülasyon" bölümü özeldir: kullanıcının o anda nerede kaldığına göre
   * sihirbaz, editör ya da sonuç ekranı açılır. Her seferinde sihirbaza
   * dönseydi, üzerinde çalışılan model kaybolmuş gibi görünürdü.
   */
  /*
   * Demo saati. Saniyede bir tik yeterlidir: aşama sınırı dakikalarla ölçülür
   * ve daha sık güncellemek yalnızca gereksiz render üretirdi.
   */
  useEffect(() => {
    if (demoStartedAt === null) {
      return;
    }
    setDemoElapsedMs(Date.now() - demoStartedAt);
    const timer = setInterval(
      () => setDemoElapsedMs(Date.now() - demoStartedAt),
      1_000,
    );
    return () => clearInterval(timer);
  }, [demoStartedAt]);

  const isDemo = demoStartedAt !== null;
  const demoPhase = phaseAt(demoElapsedMs);

  /*
   * Anlık görüntü yalnızca aşama değiştiğinde yeniden kurulur; saniyelik tik
   * onu yeniden üretmez. `demoStartedAt` tarihi geçmiş kayıtların zaman
   * damgalarını sabitler — her tikte `new Date()` verilseydi "3 dakika önce"
   * etiketleri sürekli oynardı.
   */
  const demoData = useMemo(
    () =>
      demoStartedAt === null
        ? null
        : demoSnapshot(demoPhase, new Date(demoStartedAt)),
    [demoStartedAt, demoPhase],
  );

  const startDemo = useCallback(() => {
    setDemoStartedAt(Date.now());
    setDemoElapsedMs(0);
    setView("dashboard");
  }, []);

  /** Demodan çıkış: tek tuş, hiçbir kalıntı bırakmaz. */
  const exitDemo = useCallback(() => {
    setDemoStartedAt(null);
    setDemoElapsedMs(0);
    setWantsSignUp(false);
    setView("dashboard");
    setFactoryErrors([]);
  }, []);

  const advanceDemo = useCallback(() => {
    setDemoStartedAt((current) =>
      current === null
        ? current
        : startedAtForPhase(Date.now(), nextPhase(phaseAt(Date.now() - current))),
    );
  }, []);

  /** Demodan kayıt ekranına: demo kapanır, karşılama formu açılır. */
  const leaveDemoForSignUp = useCallback(() => {
    setDemoStartedAt(null);
    setDemoElapsedMs(0);
    setWantsSignUp(true);
  }, []);

  const goToSection = useCallback(
    (section: Section) => {
      setMenuOpen(false);
      setFactoryErrors([]);

      if (section === "simulation") {
        // Demoda hazır bir koşum var ve editör kapalı; doğrudan sonuca gidilir.
        const target: View = isDemo
          ? "results"
          : config
            ? productionView === "results" && result
              ? "results"
              : "editor"
            : "wizard";
        setView(target);
        return;
      }

      const item = NAV_ITEMS.find((entry) => entry.id === section);
      if (item) {
        setView(item.view);
      }
    },
    [config, productionView, result, isDemo],
  );

  /**
   * Excel'den fabrika oluşturulduğunda çağrılır.
   *
   * Oluşturulan fabrika, mevcut "fabrika aç" akışının aynısıyla açılır:
   * `openFactoryById` modeli ve yerleşimi backend'den okuyup editörü kurar.
   * Burada ayrı bir yol yazılsaydı, içe aktarılan fabrika ile elle açılan
   * fabrika iki farklı biçimde yüklenir ve zamanla ayrışırlardı.
   */
  const handleImportCreated = useCallback(
    async (detail: FactoryDetail) => {
      setFactories(await refreshFactories());
      await openFactoryById(detail.factory.id);
    },
    [refreshFactories, openFactoryById],
  );

  /**
   * Öncelik kartlarının hedefini kenar çubuğu bölümüne çevirir.
   *
   * `ActionTarget` adları bilinçli olarak bölüm adlarıyla aynıdır; ayrı bir
   * eşleme tablosu tutmak, iki listenin zamanla ayrışması demek olurdu.
   */
  const goToTarget = useCallback(
    (target: ActionTarget) => goToSection(target),
    [goToSection],
  );

  const activeSection = sectionOfView(view);
  const userName = displayName(identity?.email ?? null);

  /**
   * Açık fabrikanın kart üzerinde gösterilecek özeti.
   *
   * Liste ucu modeli taşımadığı için bu bilgi yalnızca **açık olan** fabrika
   * için bilinir; diğer kartlarda uydurulmaz (bkz. `FactoryPicker`).
   */
  const openFactoryStats = useMemo(() => {
    if (!openFactory || !config) {
      return null;
    }
    const bottleneckId = result?.results.bottleneck_station_id;
    const bottleneck = bottleneckId
      ? (config.stations.find((station) => station.id === bottleneckId)?.name ??
        null)
      : null;
    return { stationCount: config.stations.length, bottleneck };
  }, [openFactory, config, result]);

  /*
   * Kurumsal kurulum durumu tek yerde tutulur: sihirbaz, makine envanteri ve
   * dashboard kartları aynı durumu okur. Her ekran kendi kopyasını tutsaydı,
   * envanterde eklenen bir makine dashboard'daki puanı değiştirmezdi.
   *
   * Hook, kimlik kapılarından **önce** çağrılır: koşullu bir hook çağrısı,
   * oturum açılıp kapandığında React'in hook sırasını bozardı.
   */
  const enterprise = useEnterpriseSetup({
    hasSimulationRun: result !== null,
    savedFactoryCount: factories.length,
  });

  /*
   * Demo, kimlik kapılarının **önünde** durur: oturum yokken de tam bir ürün
   * turu yaşanabilmelidir. Kapılar yalnızca demo dışında uygulanır.
   */
  if (!isDemo) {
    if (authLoading) {
      return <FullPageStatus message="Yükleniyor…" />;
    }

    if (!session) {
      /*
       * Karşılama ekranı, kimlik doğrulama yapılandırılmamış olsa bile
       * gösterilir. Demo hiçbir oturum gerektirmez; yapılandırma uyarısını
       * öne almak, Supabase anahtarı tanımlanmamış bir dağıtımda ziyaretçinin
       * ürünü hiç göremediği bir ekranla karşılaşması demek olurdu. Uyarı,
       * gerçekten gerektiği yere — kayıt yoluna — taşındı.
       */
      if (!wantsSignUp) {
        return <LandingPage onStartDemo={startDemo} />;
      }
      return isAuthConfigured ? (
        <LoginPage />
      ) : (
        <div className="flex h-full items-center justify-center bg-slate-50 px-4">
          <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
            <WarningIcon className="mx-auto mb-3 h-6 w-6 text-amber-600" />
            <p className="text-sm text-amber-900">
              Kayıt ve giriş için kimlik doğrulama yapılandırılmalı:{" "}
              <code>VITE_SUPABASE_URL</code> ve{" "}
              <code>VITE_SUPABASE_ANON_KEY</code> ortam değişkenlerini
              tanımlayın. Demo bu ayarlar olmadan da çalışır.
            </p>
            <button
              type="button"
              onClick={() => setWantsSignUp(false)}
              className="mt-4 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 focus:outline-none"
            >
              Tanıtıma dön
            </button>
          </div>
        </div>
      );
    }

    if (identityLoading || !identity) {
      return <FullPageStatus message="Organizasyon yükleniyor…" error={authError} />;
    }
  }

  /*
   * Buradan sonrası hem demo hem gerçek oturum için ortaktır. Ekranlara giden
   * değerler tek yerde seçilir; her bileşenin ayrı ayrı "demo mu?" diye
   * sorması, bir yerde unutulduğunda karışık veri gösterirdi.
   */
  const activeIdentity: MeResponse = demoData
    ? {
        user_id: "demo",
        email: null,
        org_id: "demo",
        org_name: DEMO_ORG_NAME,
      }
    : // Demo dışında yukarıdaki kapılar kimliğin dolu olmasını garanti eder.
      (identity as MeResponse);

  const activeConfig = demoData ? demoData.config : config;
  const activeResult = demoData ? demoData.run : result;
  const activeReport = demoData ? demoData.report : financeReport;
  const activeFactoryName = demoData ? DEMO_FACTORY_NAME : (openFactory?.name ?? null);
  const activeHistory = demoData ? demoData.runHistory : runHistory;
  const activeUserName = demoData ? "Demo kullanıcısı" : userName;

  /*
   * Operatör deneyimi kabuğun dışında çizilir.
   *
   * Kenar çubuğu ve üst çubuk telefonda 375 pikselin üçte birini gezinmeye
   * ayırırdı; operatör ekranının kendi alt çubuğu zaten var. Bu yüzden görünüm
   * kabuğa girmeden, tam ekran döner. Oturum kapatılmaz — aynı kullanıcı
   * "Yönetim paneline dön" ile geri gelir.
   */
  if (view === "operator") {
    return (
      <OperatorApp
        config={activeConfig}
        operatorName={activeUserName}
        orgName={activeIdentity.org_name}
        factoryName={activeFactoryName}
        onExit={() => setView("dashboard")}
      />
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar
        active={activeSection}
        onSelect={goToSection}
        isOpen={isMenuOpen}
        onClose={() => setMenuOpen(false)}
        factoryName={activeFactoryName}
        // Demoda yalnızca demonun besleyebildiği bölümler gezilebilir;
        // sunucuya yazan bölümler menüden çıkar (bkz. `DemoLockedView`).
        items={isDemo ? DEMO_NAV_ITEMS : undefined}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {demoData !== null && (
          <DemoBanner
            phase={demoPhase}
            elapsedMs={demoElapsedMs}
            comparison={demoData.comparison}
            onAdvance={advanceDemo}
            onSignUp={leaveDemoForSignUp}
            onExit={exitDemo}
          />
        )}

        <TopBar
          // Karşılama artık Command Center'ın kendi hero bölümünde duruyor
          // (Sprint UX-2); üst çubuk her ekranda sayfa adını taşır. İkisi de
          // selamlasaydı aynı cümle ekranda iki kez görünürdü.
          title={VIEW_TITLE[view]}
          subtitle={activeFactoryName ?? activeIdentity.org_name}
          orgName={activeIdentity.org_name}
          userEmail={activeIdentity.email ?? null}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenCopilot={() => goToSection("copilot")}
          onLogout={handleLogout}
        />

        {backendOnline === false && !isDemo && (
          <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
            <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-900">
              Simülasyon servisine ulaşılamıyor ({API_BASE_URL}). Modeli
              kurabilirsiniz, ancak çalıştırmak için servisin açık olması gerekir.
            </p>
          </div>
        )}

        {/* Hub bölümlerinin sekme şeridi. Kendi görünürlüğüne kendisi karar
            verir: bulunulan bölümün hub'ı yoksa hiçbir şey çizmez. Bu yüzden
            burada koşul yok. */}
        <SectionTabs view={view} onSelect={setView} />

        <main className="min-h-0 flex-1 overflow-y-auto">
          {/* Demoda kapalı ekranlar: hepsi oturum gerektiren bir uca yazar.
              Gizlemek yerine nedenini yazmak, özelliğin var olduğunu ve nasıl
              açılacağını anlatır. */}
          {isDemo && DEMO_LOCKED_VIEWS[view] !== undefined ? (
            <DemoLockedView
              title={DEMO_LOCKED_VIEWS[view]!.title}
              detail={DEMO_LOCKED_VIEWS[view]!.detail}
              onSignUp={leaveDemoForSignUp}
            />
          ) : (
          <>
          {view === "dashboard" && (
            <CommandCenter
              results={activeResult?.results ?? null}
              report={activeReport}
              analyses={inventoryAnalyses}
              factoryCount={isDemo ? 1 : factories.length}
              // Koşumun saati yanıtta gelmez; geçmiş kaydından `simulation_id`
              // ile eşleştirilir. Eşleşme yoksa `null` döner ve ekran tazelik
              // göstermez.
              ranAt={runRanAt(activeResult, activeHistory)}
              setupItems={enterprise.checklist}
              onNavigate={goToTarget}
              onNavigateView={(target) => setView(target as View)}
            />
          )}

          {view === "factories" && (
            <FactoryPicker
              factories={factories}
              isLoading={isLoadingFactories}
              errors={factoryErrors}
              onOpen={(factoryId) => void openFactoryById(factoryId)}
              onDelete={(factoryId) => void handleDeleteFactory(factoryId)}
              onCreateNew={startNewFactory}
              onImportExcel={() => setView("import")}
              openFactoryId={openFactory?.id ?? null}
              openFactoryStats={openFactoryStats}
            />
          )}

          {view === "import" && (
            <ImportWizard
              onCreated={(detail) => void handleImportCreated(detail)}
              onCancel={() => setView("factories")}
            />
          )}

          {view === "wizard" && (
            <OnboardingWizard
              onSimulationComplete={handleSimulationComplete}
              factories={factories}
              runHistory={runHistory}
              onOpenFactory={(factoryId) => void openFactoryById(factoryId)}
              onImportExcel={() => setView("import")}
            />
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
              onBack={() => setView(result ? "results" : "wizard")}
              onSimulationComplete={handleSimulationComplete}
              onImportExcel={() => setView("import")}
            />
          )}

          {view === "results" && activeResult && activeConfig && (
            <ResultsPage
              result={activeResult}
              config={activeConfig}
              onBackToEditor={() => setView("editor")}
              onStartOver={startNewFactory}
              onCompareFromHere={startComparison}
              onOpenComparison={baseline ? () => setView("comparison") : undefined}
              onOpenIntelligence={() => setView("intelligence")}
              baselineLabel={baseline?.label ?? null}
              // Command Center ile aynı yol: koşumun saati geçmiş kaydından
              // `simulation_id` ile eşleştirilir, ikinci bir kaynak yoktur.
              ranAt={runRanAt(activeResult, activeHistory)}
            />
          )}

          {view === "intelligence" && activeResult && (
            <FactoryIntelligence
              results={activeResult.results}
              report={activeReport}
              onBack={() => setView("results")}
              onOpenFinance={() => goToSection("finance")}
            />
          )}

          {view === "live" && (
            <LiveSection
              // Aşama değişince komuta merkezi yeni senaryoyla baştan kurulur:
              // her demo dakikası hattın başka bir hâlini anlatır.
              key={isDemo ? `demo-live-${demoPhase}` : "live"}
              simulationId={activeResult?.simulation_id ?? null}
              config={activeConfig}
              results={activeResult?.results ?? null}
              onStartSimulation={() => goToSection("simulation")}
              // Demoda gerçek `ReplayProvider` çalışır; ziyaretçi hiçbir şey
              // seçmez.
              initialSource={isDemo ? "replay" : undefined}
              initialScenario={
                isDemo ? (scenarioForPhase(demoPhase) as ScenarioId) : undefined
              }
            />
          )}

          {view === "finance" && (
            <FinancePage
              result={activeResult}
              config={activeConfig}
              report={activeReport}
              settings={financeSettings}
              onSettingsChange={(patch) =>
                setFinanceSettings((current) => ({ ...current, ...patch }))
              }
              onReportChange={setFinanceReport}
              onStartSimulation={() => goToSection("simulation")}
              readOnly={isDemo}
            />
          )}

          {view === "inventory" && (
            <InventoryPage
              config={config}
              simulationId={result?.simulation_id ?? null}
            />
          )}

          {view === "validation" && (
            <ValidationWorkspace
              config={activeConfig}
              result={activeResult}
              factoryId={openFactory?.id ?? null}
              factoryName={activeFactoryName}
              orgName={activeIdentity.org_name}
              onStartSimulation={() => goToSection("simulation")}
            />
          )}

          {view === "connectors" && <ConnectorCenter config={activeConfig} />}

          {view === "pilot" && <PilotFactoryWizard />}
          {view === "workspace" && <PilotWorkspacePage />}

          {view === "runtime" && <RuntimeBridgePage />}
          {view === "operations" && <OperationsPage />}
          {view === "provisioning" && <ProvisioningWizard />}
          {view === "trends" && <HistoricalTrendsPage />}
          {view === "diagnostics" && <RuntimeDiagnosticsPage />}

          {view === "enterprise" && (
            <EnterpriseSection
              state={enterprise.state}
              report={enterprise.report}
              healthCards={enterprise.connectorSnapshot.cards}
              onChange={enterprise.setState}
              onNavigate={(target) => setView(target as View)}
              onSetupCompleted={enterprise.markSetupCompleted}
            />
          )}

          {view === "machines" && (
            <MachineInventoryManager
              machines={enterprise.state.machines}
              factoryId={enterprise.state.factories[0]?.id ?? null}
              onChange={(machines) =>
                enterprise.setState({ ...enterprise.state, machines })
              }
            />
          )}

          {view === "sales" && (
            <SalesSection
              vendorName={activeIdentity.org_name}
              // Teklifteki tasarruf tahmini ancak ölçülmüş bir kayıp varsa
              // yazılır; yoksa teklif nedenini açıkça söyler.
              monthlyLoss={monthlyLoss(activeReport)}
            />
          )}

          {view === "copilot" && (
            <CopilotHome
              factoryName={activeFactoryName}
              orgName={activeIdentity.org_name}
              result={activeResult}
              report={activeReport}
              inventory={inventoryAnalyses}
              /*
               * Paket bilgisi bu sürümde sunucudan gelmiyor; kota motorunun
               * çalıştığı görülebilsin diye Growth varsayılıyor ve bu varsayım
               * burada açıkça yazılıyor.
               */
              tier="growth"
              onNavigate={(view) => setView(view as View)}
            />
          )}

          {view === "team" && (
            <TeamSection
              userId={activeIdentity.user_id}
              email={activeIdentity.email}
              orgName={activeIdentity.org_name}
              config={activeConfig}
              factoryName={activeFactoryName}
              /*
               * Liste okunamadıysa sayı yerine `null` gider; ekip ekranı bunu
               * "Doğrulanmadı" olarak yazar.
               */
              factoryCount={factoryListRead ? factories.length : null}
              machineCount={enterprise.state.machines.length}
              connectorCount={enterprise.connectorSnapshot.connectorCount}
            />
          )}

          {view === "reports" && (
            <ReportsPage
              result={activeResult}
              config={activeConfig}
              report={activeReport}
              factoryName={activeFactoryName}
              orgName={activeIdentity.org_name}
              onStartSimulation={() => goToSection("simulation")}
            />
          )}

          {view === "settings" && (
            <SettingsPage
              orgName={activeIdentity.org_name}
              userEmail={activeIdentity.email ?? null}
            />
          )}

          {view === "comparison" && baseline && config && (
            <ScenarioComparison
              baseline={baseline}
              candidate={{ label: "Değiştirilmiş model", config }}
              onBack={() => setView("results")}
            />
          )}
          </>
          )}
        </main>
      </div>
    </div>
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
