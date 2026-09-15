/**
 * Sol kenar çubuğu — uygulamanın ana gezinmesi.
 *
 * Masaüstünde her zaman görünür ve sabittir; dar ekranda (< lg) tümüyle
 * gizlenir ve üst çubuktaki düğmeyle açılan bir çekmeceye dönüşür. Dar ekranda
 * daraltılmış bir şerit olarak bırakılsaydı, zaten kısıtlı olan yatay alanın
 * önemli bir kısmını sürekli tüketirdi.
 *
 * Aktif bölüm iki sinyalle işaretlenir: mavi zemin ve sol kenardaki dikey
 * çizgi. Yalnızca renk kullanılsaydı, renk körlüğü olan bir kullanıcı için
 * hangi sayfada olduğu belirsizleşirdi.
 */

import { Factory, PanelLeftClose } from "lucide-react";
import {
  NAV_GROUPS,
  NAV_ITEMS,
  SECTION_HUB,
  isTabChild,
  type NavItem,
  type Section,
} from "./navigation";

interface SidebarProps {
  active: Section;
  onSelect: (section: Section) => void;
  /** Dar ekrandaki çekmece açık mı? Masaüstünde yok sayılır. */
  isOpen: boolean;
  onClose: () => void;
  /** Açık fabrikanın adı; alt bilgi olarak gösterilir. */
  factoryName: string | null;
  /**
   * Gösterilecek bölümler; verilmezse tamamı.
   *
   * Demo modu bunu daraltır. Listeyi dışarıdan almak, kenar çubuğunun
   * "demo mu?" diye sormasını gereksiz kılar — bileşen yalnızca verilen
   * listeyi çizer.
   */
  items?: NavItem[];
}

export function Sidebar({
  active,
  onSelect,
  isOpen,
  onClose,
  factoryName,
  items,
}: SidebarProps) {
  /*
   * Sekme hâline gelmiş bölümler menüden çıkar.
   *
   * Bağlantı ekranları artık "Bağlantılar" sayfasının sekmeleri; hem menüde
   * hem sekmede görünselerdi aynı yere iki ayrı yoldan gidilir ve hangisinin
   * asıl yol olduğu belirsizleşirdi. Hub'ın kendisi kendi sekmesi olduğu için
   * menüde kalır.
   *
   * Eleme burada yapılır, `NAV_ITEMS` ya da `NAV_GROUPS` içinde değil: o iki
   * liste hangi bölümün var olduğunu ve nereye ait olduğunu anlatır; hangisinin
   * o an menüde satır hak ettiği bir sunum kararıdır.
   */
  const visible = (items ?? NAV_ITEMS).filter((item) => !isTabChild(item.id));

  /*
   * Kenar çubuğunda hangi maddenin yanacağı.
   *
   * `active` görünümün **gerçek** bölümüdür ve öyle kalır. Bağlantı
   * ekranlarının hepsi ileride tek bir merkezin sekmeleri olacağı için, o
   * ekranlardayken vurgu merkezin kendisine taşınır. Eşlenmemiş bir bölüm
   * kendini aydınlatır.
   */
  const highlighted = SECTION_HUB[active] ?? active;

  /*
   * Görünür maddeler gruplara dağıtılır. Demo modu `items` listesini
   * daralttığı için bir grup tümüyle boşalabilir; boş grup başlığı hiç
   * çizilmez — başlığı olup içi olmayan bir bölüm, eksik bir şey olduğunu
   * düşündürürdü.
   */
  const groups = NAV_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.sections
      .map((section) => visible.find((item) => item.id === section))
      .filter((item): item is NavItem => item !== undefined),
  })).filter((group) => group.items.length > 0);

  const grouped = new Set(NAV_GROUPS.flatMap((group) => group.sections));
  const ungrouped = visible.filter((item) => !grouped.has(item.id));

  const renderItem = (item: NavItem) => {
    const isActive = item.id === highlighted;
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelect(item.id)}
        aria-current={isActive ? "page" : undefined}
        className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 focus:outline-none ${
          isActive
            ? "bg-brand-600/12 text-brand-700"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        {/* Renkten bağımsız ikinci sinyal. */}
        {isActive && (
          <span className="absolute top-1.5 bottom-1.5 -left-3 w-0.5 rounded-r-full bg-brand-500" />
        )}
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </button>
    );
  };

  return (
    <>
      {/* Dar ekranda çekmecenin arkasındaki karartma. Tıklanınca kapanır —
          bir menüden çıkmanın en beklenen yolu dışına tıklamaktır. */}
      {isOpen && (
        <button
          type="button"
          aria-label="Menüyü kapat"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Kapalıyken tek bir sınıf eklenir; açık durumun karşılığı yoktur
          (nedeni `index.css` içindeki `.optiflow-drawer-closed` kuralında
          yazılı). Geniş ekranda kural hiç uygulanmaz. */}
      <aside
        className={`optiflow-drawer fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50 lg:static ${
          isOpen ? "" : "optiflow-drawer-closed"
        }`}
      >
        {/* Marka */}
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
            <Factory className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">OptiFlow</p>
            <p className="truncate text-[11px] text-slate-500">Üretim Karar Merkezi</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Menüyü kapat"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        <nav aria-label="Ana gezinme" className="flex-1 overflow-y-auto px-3 py-2">
          {groups.map((group, index) => (
            <div
              key={group.id}
              // Gruplar arasındaki ayrım kutuyla değil çizgiyle kurulur; ilk
              // grubun üstünde çizgi olmaz, yoksa marka bloğundan sonra ikinci
              // bir kenarlık belirirdi.
              className={
                index === 0
                  ? "space-y-0.5"
                  : "mt-3 space-y-0.5 border-t border-slate-200 pt-3"
              }
            >
              <p className="px-3 pb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                {group.label}
              </p>
              {group.items.map(renderItem)}
            </div>
          ))}

          {/* Hiçbir gruba girmeyen maddeler (bugün yalnızca AI Copilot) sonda,
              başlıksız durur. Bir gruba zorlanmaları, ilerideki çekmece
              taşımasında o grubu boşaltıp yeniden düzenlemeyi gerektirirdi. */}
          {ungrouped.length > 0 && (
            <div
              className={
                groups.length === 0
                  ? "space-y-0.5"
                  : "mt-3 space-y-0.5 border-t border-slate-200 pt-3"
              }
            >
              {ungrouped.map(renderItem)}
            </div>
          )}
        </nav>

        {/* Hangi fabrikanın açık olduğu her ekranda okunabilir kalır. */}
        <div className="border-t border-slate-200 px-4 py-3">
          <p className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            Açık model
          </p>
          <p className="mt-1 truncate text-sm text-slate-700">
            {factoryName ?? "Henüz model açılmadı"}
          </p>
        </div>
      </aside>
    </>
  );
}
