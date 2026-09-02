/**
 * İstasyon adından ikon seçimi.
 *
 * İkonu kullanıcıya seçtirmek, model kurmanın önüne bir karar daha koyardı ve
 * kazancı yalnızca görseldir. Bunun yerine ad içindeki anahtar kelimeden
 * otomatik çıkarılır; eşleşme yoksa genel fabrika simgesi kullanılır. Yanlış
 * bir tahminin maliyeti düşüktür (yanlış küçük bir resim), doğru tahminin
 * kazancı ise yüksektir: kullanıcı kendi hattını şemada tanır.
 *
 * Eşleştirme bileşenden ayrı tutulur çünkü sessizce yanlış olabilir — Türkçe
 * büyük/küçük harf dönüşümü ("I" ve "İ") ya da ek almış bir kelime yüzünden
 * eşleşmenin kaçması ekranda hata gibi görünmez, yalnızca ikon genel kalır.
 * Saf fonksiyon olarak birim testiyle doğrulanabilir.
 */

import {
  BoxIcon,
  InspectIcon,
  PaintIcon,
  ScissorsIcon,
  SewingIcon,
  StationIcon,
} from "../components/shared/icons";

export type StationIconKind =
  | "kesim"
  | "dikis"
  | "kalite"
  | "paketleme"
  | "boyama"
  | "genel";

type IconComponent = (props: { className?: string }) => React.ReactElement;

/**
 * Anahtar kelimeler ve karşılık gelen ikonlar.
 *
 * Sıra önemlidir: ilk eşleşen kazanır. Bu yüzden daha özgül kelimeler önce
 * gelir — "kalite kontrol" adı hem "kalite" hem de başka bir kelimeyi
 * içerebilir.
 *
 * Her tür için birden çok kelime bulunur çünkü kullanıcılar aynı işi farklı
 * adlandırır: "Kesim", "Kesme", "Kesim Hattı" ya da "CNC Kesim" hepsi aynı
 * istasyondur.
 */
const KEYWORDS: Array<{ kind: StationIconKind; words: string[] }> = [
  { kind: "kalite", words: ["kalite", "kontrol", "muayene", "test"] },
  { kind: "paketleme", words: ["paketle", "ambalaj", "kutula", "koli"] },
  { kind: "boyama", words: ["boya", "kaplama", "vernik", "astar"] },
  { kind: "dikis", words: ["dikis", "diki", "overlok", "nakis"] },
  { kind: "kesim", words: ["kesim", "kesme", "kes"] },
];

const ICONS: Record<StationIconKind, IconComponent> = {
  kesim: ScissorsIcon,
  dikis: SewingIcon,
  kalite: InspectIcon,
  paketleme: BoxIcon,
  boyama: PaintIcon,
  genel: StationIcon,
};

/**
 * Türkçe metni karşılaştırmaya hazırlar.
 *
 * `toLowerCase()` tek başına yetmez: "İ" harfi çoğu ortamda "i̇" (birleşik
 * nokta) üretir ve "dikiş" araması "DİKİŞ" adını kaçırır. Aksanlar da
 * ayrıştırılıp atılır, böylece "dikiş" ile "dikis" aynı sayılır ve kullanıcının
 * Türkçe karakter kullanıp kullanmaması sonucu değiştirmez.
 */
function normalize(text: string): string {
  return text
    .replace(/I/g, "i")
    .replace(/İ/g, "i")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** İstasyon adına en uygun ikon türünü döndürür. */
export function stationIconKind(stationName: string): StationIconKind {
  const name = normalize(stationName);
  for (const entry of KEYWORDS) {
    if (entry.words.some((word) => name.includes(word))) {
      return entry.kind;
    }
  }
  return "genel";
}

/** İstasyon adına karşılık gelen ikon bileşenini döndürür. */
export function stationIconFor(stationName: string): IconComponent {
  return ICONS[stationIconKind(stationName)];
}
