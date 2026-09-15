/**
 * Hub bölümlerinin sekme şeridi (Sprint 2B).
 *
 * Bağlantı ekranları kenar çubuğunda yedi ayrı satırdı; adları birbirine çok
 * yakın olduğu için hangisinin ne yaptığı menüden okunmuyordu. Artık menüde
 * tek bir "Bağlantılar" satırı var ve yedisi arasındaki geçiş burada yapılıyor.
 *
 * Bileşen yalnızca **çizer ve haber verir**. Kendi durumu, kendi yönlendirmesi
 * ya da kendi görünüm hafızası yoktur: hangi sekmenin seçili olduğunu dışarıdan
 * gelen `view` değerinden türetir, tıklamayı `onSelect` ile geri verir. İkinci
 * bir durum tutsaydı, kenar çubuğundan gelen bir geçişte şerit ile içerik
 * ayrışabilirdi.
 *
 * Görünürlük de buradan karar verilir: bulunulan bölümün bir hub'ı yoksa
 * bileşen hiçbir şey çizmez. Bu sayede `App` içinde koşul yazmaya gerek kalmaz
 * ve şerit yalnızca ait olduğu ekranlarda görünür.
 *
 * Biçim, uygulamada zaten kullanılan alt-çizgi sekmesinden alınmıştır
 * (`LiveSection`): tek bir hairline taban üstünde, seçili olanın altı çizili.
 * Hap (pill) ızgarası ya da kart kullanılmadı — şerit tek bir gezinme aleti
 * gibi durmalı, yan yana dizilmiş düğmeler gibi değil.
 */

import {
  SECTION_HUB,
  sectionOfView,
  sectionTabs,
  type View,
} from "./navigation";

interface SectionTabsProps {
  /** Uygulamanın o an çizdiği görünüm. */
  view: View;
  /** Sekmeye basıldığında çağrılır; uygulamanın görünüm ayarlayıcısıdır. */
  onSelect: (view: View) => void;
}

export function SectionTabs({ view, onSelect }: SectionTabsProps) {
  const section = sectionOfView(view);
  const hub = SECTION_HUB[section];
  if (hub === undefined) {
    return null;
  }

  const tabs = sectionTabs(hub);
  if (tabs.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Bağlantı bölümleri"
      // Dar ekranda yedi sekme sığmaz ve şerit yana kaydırılır. Yatay kaydırma
      // burada meşrudur: kaydırılan şey bir tablo değil, gezinme aletinin
      // kendisidir ve sayfanın kendisi kaymaz.
      //
      // Yatay dolgu kabuğun sayfa oluğuyla hizalanır. Ölçüldü: sekme metni
      // kabın 12 pikseli ile sekmenin kendi 12 pikselini toplayıp 24'ten
      // başlıyordu; üst çubuk ve sayfa içeriği ise dar ekranda 16'dan
      // başlıyor. Kap `px-1 sm:px-3` olunca metin 16/24'e oturur ve üçü de aynı
      // dikey çizgiden başlar.
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-1 pt-2 sm:px-3"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === section;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.view)}
            aria-current={isActive ? "page" : undefined}
            // Dikey dolgu `py-2` değil `py-3`: 8 + 20 + 8 + 2 = 38 piksellik
            // hedef, dokunma için gereken 44 pikselin altında kalıyordu
            // (MASTER §14). 12 piksel dolguyla toplam 46 piksele çıkar ve 12,
            // aralık ölçeğinde zaten var olan bir değerdir (MASTER §3.4).
            //
            // Ödün: `LiveSection`'daki sekmeler `py-2` ile 38 pikselde kalıyor,
            // yani iki şerit artık 8 piksel farklı. Desen aynı — aynı taban
            // çizgisi, aynı alt çizgi, aynı renkler, aynı yazı boyutu; yalnızca
            // dolgu farklı. Bu şerit mobilde birincil gezinme aleti olduğu için
            // dokunma hedefi görsel eşlikten önce gelir.
            className={`-mb-px shrink-0 rounded-t-lg border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors duration-200 focus:outline-none ${
              isActive
                ? "border-brand-500 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
