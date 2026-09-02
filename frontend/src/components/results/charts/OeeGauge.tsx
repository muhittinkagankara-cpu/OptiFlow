/**
 * Genel OEE göstergesi — yarım daire gauge.
 *
 * Sayının kendisi zaten özet kartında yazıyor; bu görselin işi sayıyı
 * **konumlandırmak**: %62'nin iyi mi kötü mü olduğunu bilmek için sektör
 * eşiklerini ezberlemiş olmak gerekir, ama iğnenin sarı bölgenin ortasında
 * durduğunu görmek için hiçbir şey bilmek gerekmez.
 *
 * Renk bölgeleri projenin geri kalanıyla aynı eşikleri kullanır (`oeeTone`):
 * %70 üzeri yeşil, %50-70 sarı, altı kırmızı. Gauge'a özel bir eşik
 * tanımlanmadı — aynı sayının tabloda sarı, burada yeşil görünmesi
 * kullanıcının hangi gösterime güveneceğini bilememesi demek olurdu.
 *
 * Grafik kütüphanesi yerine düz SVG kullanılır. Recharts 3'te `Customized`
 * kullanımdan kaldırıldı ve grafiğin hesapladığı merkez/yarıçapı artık dışarı
 * vermiyor; iğne ile yayın aynı koordinat sistemini paylaşması kütüphane
 * üzerinden mümkün değil. Gauge'un ayrıca ekseni, ipucu, göstergesi ya da
 * etkileşimi de yok. Tek bir `viewBox` ile hem yay hem iğne aynı sistemde
 * doğar ve her genişlikte oransal olarak ölçeklenir; dar ekranda taşma
 * ihtimali kalmaz.
 */

import {
  OEE_GOOD_THRESHOLD,
  OEE_WARNING_THRESHOLD,
  formatPercent,
  oeeTone,
  type Tone,
} from "../../../lib/resultsFormatting";

/** Bölge renkleri; tablo ve kartlardaki tonlarla aynı ailedendir. */
const ZONE_COLORS: Record<Exclude<Tone, "neutral">, string> = {
  bad: "#ef4444",
  warning: "#f59e0b",
  good: "#10b981",
};

const VALUE_COLORS: Record<Tone, string> = {
  good: "#047857",
  warning: "#b45309",
  bad: "#b91c1c",
  neutral: "#334155",
};

// --- Çizim ölçüleri (viewBox birimi) ---
const CX = 100;
const CY = 100;
const OUTER = 88;
const INNER = 62;
const NEEDLE_LENGTH = 76;

/**
 * Bölge sınırları eşiklerden türetilir.
 *
 * Sabit açılar yazılsaydı eşikler değiştiğinde gösterge sessizce yalan
 * söylemeye başlardı: iğne doğru yerde, renk sınırı yanlış yerde olurdu.
 */
const ZONES: Array<{ tone: Exclude<Tone, "neutral">; from: number; to: number }> = [
  { tone: "bad", from: 0, to: OEE_WARNING_THRESHOLD },
  { tone: "warning", from: OEE_WARNING_THRESHOLD, to: OEE_GOOD_THRESHOLD },
  { tone: "good", from: OEE_GOOD_THRESHOLD, to: 1 },
];

/** 0 → 180° (sol uç), 1 → 0° (sağ uç). */
function angleOf(fraction: number): number {
  return Math.PI * (1 - fraction);
}

function polar(radius: number, angle: number): [number, number] {
  return [CX + radius * Math.cos(angle), CY - radius * Math.sin(angle)];
}

/** İki oran arasındaki halka dilimini SVG yoluna çevirir. */
function arcPath(from: number, to: number): string {
  const a1 = angleOf(from);
  const a2 = angleOf(to);
  const [ox1, oy1] = polar(OUTER, a1);
  const [ox2, oy2] = polar(OUTER, a2);
  const [ix2, iy2] = polar(INNER, a2);
  const [ix1, iy1] = polar(INNER, a1);

  // Dilimler her zaman yarım daireden kısadır, bu yüzden large-arc bayrağı 0.
  // Dış yay saat yönünde (sweep 1), iç yay geri dönerken ters yönde (sweep 0).
  return [
    `M ${ox1} ${oy1}`,
    `A ${OUTER} ${OUTER} 0 0 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${INNER} ${INNER} 0 0 0 ${ix1} ${iy1}`,
    "Z",
  ].join(" ");
}

interface OeeGaugeProps {
  /** 0-1 arası OEE değeri. */
  value: number;
}

export function OeeGauge({ value }: OeeGaugeProps) {
  // Ölçek dışı değerler iğneyi yayın dışına taşırdı. OEE tanım gereği bu
  // aralıktadır; sınırlama yalnızca bozuk veriye karşı bir emniyettir.
  const safe = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  const tone = oeeTone(safe);

  const needleAngle = angleOf(safe);
  const [tipX, tipY] = polar(NEEDLE_LENGTH, needleAngle);
  // Taban, iğnenin dik açısında iki noktaya yayılır; ince bir üçgen verir.
  const baseX = Math.cos(needleAngle + Math.PI / 2) * 5;
  const baseY = -Math.sin(needleAngle + Math.PI / 2) * 5;

  return (
    <svg
      viewBox="0 0 200 150"
      className="w-full"
      role="img"
      aria-label={`Genel fabrika verimliliği ${formatPercent(safe, 1)}`}
    >
      {ZONES.map((zone) => (
        <path key={zone.tone} d={arcPath(zone.from, zone.to)} fill={ZONE_COLORS[zone.tone]} />
      ))}

      {/* İğne ve göbeği */}
      <polygon
        points={`${CX + baseX},${CY + baseY} ${CX - baseX},${CY - baseY} ${tipX},${tipY}`}
        fill="#334155"
      />
      <circle cx={CX} cy={CY} r={7} fill="#334155" />
      <circle cx={CX} cy={CY} r={3} fill="#ffffff" />

      {/* Uç etiketleri: iğnenin nereye göre konumlandığını okumak için ölçek
          gerekir; onsuz yay yalnızca bir renk bandıdır. */}
      <text x={CX - OUTER} y={CY + 13} textAnchor="middle" fontSize="9" fill="#94a3b8">
        %0
      </text>
      <text x={CX + OUTER} y={CY + 13} textAnchor="middle" fontSize="9" fill="#94a3b8">
        %100
      </text>

      {/* Sayı yayın ortasına değil altına konur: ortada iğnenin süpürdüğü
          alandadır ve yüksek değerlerde iğne rakamların üzerinden geçip
          okunmaz hâle getiriyordu. */}
      <text
        x={CX}
        y={CY + 33}
        textAnchor="middle"
        fontSize="27"
        fontWeight="600"
        fill={VALUE_COLORS[tone]}
      >
        {formatPercent(safe, 1)}
      </text>

      <text x={CX} y={CY + 47} textAnchor="middle" fontSize="10" fill="#64748b">
        Genel Fabrika Verimliliği
      </text>
    </svg>
  );
}
