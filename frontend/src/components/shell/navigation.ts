/**
 * Gezinme modeli — kenar çubuğu ile uygulama görünümleri arasındaki eşleme.
 *
 * Ayrı bir dosyada durması bilinçlidir: hem kenar çubuğu hem üst çubuk hem de
 * `App.tsx` aynı listeyi okur. Üç yerde ayrı ayrı yazılsaydı, yeni bir bölüm
 * eklendiğinde biri güncellenmeyi unutur ve menüde görünen bir sayfa
 * açılmayan bir sayfa hâline gelirdi.
 *
 * Bir "bölüm" (section) kullanıcının menüde gördüğü şeydir; bir "görünüm"
 * (view) uygulamanın o an çizdiği ekrandır. İkisi bire bir değildir:
 * simülasyon bölümü sihirbaz, editör ve sonuç görünümlerini kapsar — kullanıcı
 * için hepsi "Simülasyon"dur.
 */

import {
  Boxes,
  FlaskConical,
  LayoutDashboard,
  ServerCog,
  Settings,
  Sparkles,
  Factory,
  FileBarChart,
  HardHat,
  Handshake,
  ClipboardCheck,
  Cable,
  PlugZap,
  ListChecks,
  Cog,
  Radio,
  Router,
  Users,
  Wallet,
  Activity,
  LineChart,
  Plug,
  type LucideIcon,
} from "lucide-react";

/** Uygulamanın çizebileceği ekranlar. */
export type View =
  | "dashboard"
  | "enterprise"
  | "machines"
  | "factories"
  | "wizard"
  | "editor"
  | "results"
  | "intelligence"
  | "comparison"
  | "import"
  | "live"
  | "finance"
  | "inventory"
  | "operator"
  | "validation"
  | "connectors"
  | "pilot"
  | "workspace"
  | "runtime"
  | "operations"
  | "provisioning"
  | "trends"
  | "diagnostics"
  | "sales"
  | "copilot"
  | "team"
  | "reports"
  | "settings";

/** Kenar çubuğunda görünen bölümler. */
export type Section =
  | "dashboard"
  | "enterprise"
  | "machines"
  | "factories"
  | "simulation"
  | "live"
  | "finance"
  | "inventory"
  | "operator"
  | "validation"
  | "connectors"
  | "pilot"
  | "workspace"
  | "runtime"
  | "operations"
  | "provisioning"
  | "trends"
  | "diagnostics"
  | "sales"
  | "copilot"
  | "team"
  | "reports"
  | "settings";

export interface NavItem {
  id: Section;
  label: string;
  icon: LucideIcon;
  /** Bölüme girildiğinde açılacak varsayılan görünüm. */
  view: View;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, view: "dashboard" },
  { id: "enterprise", label: "Kurulum", icon: ListChecks, view: "enterprise" },
  { id: "factories", label: "Fabrikalar", icon: Factory, view: "factories" },
  { id: "machines", label: "Makineler", icon: Cog, view: "machines" },
  { id: "simulation", label: "Simülasyon", icon: FlaskConical, view: "wizard" },
  { id: "live", label: "Canlı Üretim", icon: Radio, view: "live" },
  { id: "finance", label: "Finans", icon: Wallet, view: "finance" },
  { id: "inventory", label: "Envanter", icon: Boxes, view: "inventory" },
  { id: "operator", label: "Operatör", icon: HardHat, view: "operator" },
  { id: "validation", label: "Doğrulama", icon: ClipboardCheck, view: "validation" },
  { id: "connectors", label: "Bağlantılar", icon: Cable, view: "connectors" },
  { id: "pilot", label: "Pilot Bağlantı", icon: PlugZap, view: "pilot" },
  { id: "workspace", label: "Pilot Kurulum", icon: Factory, view: "workspace" },
  { id: "runtime", label: "Runtime Köprüsü", icon: Router, view: "runtime" },
  { id: "operations", label: "Operasyon", icon: ServerCog, view: "operations" },
  { id: "provisioning", label: "Cihaz Kurulumu", icon: Plug, view: "provisioning" },
  { id: "trends", label: "Geçmiş Trendler", icon: LineChart, view: "trends" },
  { id: "diagnostics", label: "Tanılama", icon: Activity, view: "diagnostics" },
  { id: "sales", label: "Satış", icon: Handshake, view: "sales" },
  { id: "copilot", label: "AI Copilot", icon: Sparkles, view: "copilot" },
  { id: "team", label: "Ekip", icon: Users, view: "team" },
  { id: "reports", label: "Raporlar", icon: FileBarChart, view: "reports" },
  { id: "settings", label: "Ayarlar", icon: Settings, view: "settings" },
];

/**
 * Demo modunda gezilebilen bölümler.
 *
 * Dışarıda bırakılanların ortak yanı, sunucuya **yazmaları**: fabrika listesi,
 * envanter ve ayarlar oturum gerektirir; demo oturumsuz çalışır. Bunlar
 * menüden çıkarılır ama ürün turundan silinmez — doğrudan gidilirse
 * `DemoLockedView` nedenini yazar.
 */
export const DEMO_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter((item) =>
  ["dashboard", "simulation", "live", "finance", "operator", "copilot", "reports"].includes(
    item.id,
  ),
);

/** Bir görünümün hangi menü bölümünü aydınlatacağı. */
const SECTION_OF_VIEW: Record<View, Section> = {
  dashboard: "dashboard",
  enterprise: "enterprise",
  machines: "machines",
  factories: "factories",
  // Sihirbaz, editör, sonuç ve karşılaştırma tek bir kullanıcı görevinin
  // adımlarıdır; menüde hepsi "Simülasyon" olarak işaretlenir.
  wizard: "simulation",
  editor: "simulation",
  // İçe aktarma bir fabrika oluşturur; menüde "Fabrikalar" aydınlanır.
  import: "factories",
  results: "simulation",
  // Factory Intelligence sonuç ekranının devamıdır: aynı koşumu yorumlar,
  // yeni bir veri kaynağı getirmez.
  intelligence: "simulation",
  comparison: "simulation",
  live: "live",
  finance: "finance",
  inventory: "inventory",
  // Operatör deneyimi kendi tam ekran kabuğunda çizilir; kenar çubuğu ona
  // görünmez ama bölüm eşlemesi yine de eksiksiz kalmalıdır.
  operator: "operator",
  validation: "validation",
  connectors: "connectors",
  pilot: "pilot",
  workspace: "workspace",
  runtime: "runtime",
  operations: "operations",
  provisioning: "provisioning",
  trends: "trends",
  diagnostics: "diagnostics",
  sales: "sales",
  copilot: "copilot",
  team: "team",
  reports: "reports",
  settings: "settings",
};

export function sectionOfView(view: View): Section {
  return SECTION_OF_VIEW[view];
}

/** Üst çubukta gösterilecek sayfa başlığı. */
export const VIEW_TITLE: Record<View, string> = {
  dashboard: "Command Center",
  enterprise: "Kurumsal Kurulum",
  machines: "Makine Envanteri",
  factories: "Fabrikalar",
  wizard: "Yeni Model",
  editor: "Süreç Editörü",
  results: "Simülasyon Sonucu",
  intelligence: "Factory Intelligence",
  comparison: "Senaryo Karşılaştırma",
  import: "Excel İçe Aktar",
  live: "Canlı Üretim",
  finance: "Finans",
  inventory: "Envanter",
  operator: "Operatör",
  validation: "Doğrulama",
  connectors: "Bağlayıcı Merkezi",
  pilot: "Pilot Fabrika Bağlantısı",
  workspace: "Pilot Fabrika Kurulumu",
  runtime: "Runtime Köprüsü",
  operations: "Operasyon ve Devreye Alma",
  provisioning: "Cihaz Devreye Alma",
  trends: "Geçmiş Trendler",
  diagnostics: "Runtime Tanılama",
  sales: "Satış",
  copilot: "AI Copilot",
  team: "Ekip ve Erişim",
  reports: "Raporlar",
  settings: "Ayarlar",
};
