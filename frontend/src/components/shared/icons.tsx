/**
 * Satır içi SVG ikonlar.
 *
 * Ayrı bir ikon kütüphanesi eklenmedi: gereken ikon sayısı az ve hepsi basit.
 * Bir paket bağımlılığı, kullanılmayan yüzlerce ikonu da projeye taşırdı.
 * Tümü `currentColor` kullanır, böylece Tailwind metin rengi sınıflarıyla
 * boyanabilirler.
 */

interface IconProps {
  className?: string;
}

const BASE = "h-5 w-5";

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className ?? BASE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Tekstil: makara ve iplik. */
export function TextileIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3h10v18H7z" />
      <path d="M7 7h10M7 17h10" />
      <path d="M12 7v10" />
    </Svg>
  );
}

/** Gıda: kavanoz / konserve. */
export function FoodIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 8h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
      <path d="M8 3h8v5H8z" />
      <path d="M9 13h6" />
    </Svg>
  );
}

/** Metal: dişli. */
export function MetalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </Svg>
  );
}

/** Boş şablon: kalem ve kâğıt. */
export function BlankIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L15 12l-4 1 1-4z" />
    </Svg>
  );
}

/** Artı: yeni öğe ekleme. */
export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** Oynat: simülasyonu başlat. */
export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4.5v15l12-7.5z" />
    </Svg>
  );
}

/** Çöp kutusu: silme. */
export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" />
    </Svg>
  );
}

/** Bilgi: ipucu düğmesi. */
export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
    </Svg>
  );
}

/** Uyarı üçgeni. */
export function WarningIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.3 3.9 2.6 17.4A1.9 1.9 0 0 0 4.3 20h15.4a1.9 1.9 0 0 0 1.7-2.6L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <circle cx="12" cy="16.4" r="0.6" fill="currentColor" />
    </Svg>
  );
}

/** Onay işareti. */
export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </Svg>
  );
}

/** Sağ ok: ileri. */
export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </Svg>
  );
}

/** Sol ok: geri. */
export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12H5M11 6l-6 6 6 6" />
    </Svg>
  );
}

/** Fabrika: istasyon node'u simgesi. */
export function StationIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 20h18M4 20V9l5 3.5V9l5 3.5V9l5 3.5V20" />
    </Svg>
  );
}

/** Giriş oku: varış node'u simgesi. */
export function EntryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h12M11 7l5 5-5 5" />
      <path d="M19 4v16" />
    </Svg>
  );
}

/** Kesim: makas. */
export function ScissorsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8.1 7.6 20 18M8.1 16.4 20 6" />
    </Svg>
  );
}

/** Dikiş: iğne ve iplik. */
export function SewingIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 4 9.5 14.5" />
      <path d="m7 17 2.5-2.5 1.5 1.5L8.5 18.5z" />
      <circle cx="18.2" cy="5.8" r="1.1" />
      <path d="M6 21c1.8-1.2 1.8-3.2 0-4.4" />
    </Svg>
  );
}

/** Kalite kontrol: büyüteç ve onay işareti. */
export function InspectIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
      <path d="m7.8 10.6 2 2 3.4-3.6" />
    </Svg>
  );
}

/** Paketleme: kapalı koli. */
export function BoxIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </Svg>
  );
}

/** Boyama: boya fırçası. */
export function PaintIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 3h11v5H5z" />
      <path d="M16 5.5h2.5a2 2 0 0 1 2 2V11H9" />
      <path d="M9 8h3v4.5a1.5 1.5 0 0 1-1.5 1.5h0A1.5 1.5 0 0 1 9 12.5z" />
      <path d="M10.5 14v7" />
    </Svg>
  );
}

/** Disket — "Kaydet" eylemi. */
export function SaveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </Svg>
  );
}

/** Klasör — kayıtlı fabrikalar listesi. */
export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  );
}
