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
  Settings,
  Sparkles,
  Factory,
  FileBarChart,
  HardHat,
  Radio,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Uygulamanın çizebileceği ekranlar. */
export type View =
  | "dashboard"
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
  | "copilot"
  | "reports"
  | "settings";

/** Kenar çubuğunda görünen bölümler. */
export type Section =
  | "dashboard"
  | "factories"
  | "simulation"
  | "live"
  | "finance"
  | "inventory"
  | "operator"
  | "copilot"
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
  { id: "factories", label: "Fabrikalar", icon: Factory, view: "factories" },
  { id: "simulation", label: "Simülasyon", icon: FlaskConical, view: "wizard" },
  { id: "live", label: "Canlı Üretim", icon: Radio, view: "live" },
  { id: "finance", label: "Finans", icon: Wallet, view: "finance" },
  { id: "inventory", label: "Envanter", icon: Boxes, view: "inventory" },
  { id: "operator", label: "Operatör", icon: HardHat, view: "operator" },
  { id: "copilot", label: "AI Copilot", icon: Sparkles, view: "copilot" },
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
  copilot: "copilot",
  reports: "reports",
  settings: "settings",
};

export function sectionOfView(view: View): Section {
  return SECTION_OF_VIEW[view];
}

/** Üst çubukta gösterilecek sayfa başlığı. */
export const VIEW_TITLE: Record<View, string> = {
  dashboard: "Command Center",
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
  copilot: "AI Copilot",
  reports: "Raporlar",
  settings: "Ayarlar",
};
