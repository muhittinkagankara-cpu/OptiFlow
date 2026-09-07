/**
 * Hero ekranındaki fabrika illüstrasyonu.
 *
 * Saf SVG'dir: yeni bir kütüphane, resim dosyası ya da canvas gerektirmez ve
 * koyu temanın renk değişkenlerini doğrudan kullanır. Hareket CSS ile verilir
 * (`index.css` içindeki `.optiflow-part` / `.optiflow-machine`), bu sayede
 * `prefers-reduced-motion` tek yerde karşılanır.
 *
 * İllüstrasyon **dekoratiftir ve hiçbir veri göstermez**: kutular gerçek bir
 * istasyonu, akan noktalar gerçek bir parçayı temsil etmez. Bu yüzden ekran
 * okuyuculardan gizlenir (`aria-hidden`) — anlamı olmayan bir grafiği
 * seslendirmek, ekran okuyucu kullanıcısına yalnızca gürültü verirdi.
 */

const MACHINES = [
  { x: 40, label: "Kesim" },
  { x: 140, label: "İşleme" },
  { x: 240, label: "Kalite" },
];

export function FactoryIllustration({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 340 240"
      className={className}
      role="presentation"
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="optiflow-belt" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1F2937" />
          <stop offset="50%" stopColor="#2A3644" />
          <stop offset="100%" stopColor="#1F2937" />
        </linearGradient>
        <linearGradient id="optiflow-machine-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1c3a66" />
          <stop offset="100%" stopColor="#111827" />
        </linearGradient>
        <filter id="optiflow-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Zemin ızgarası — derinlik hissi verir. */}
      <g opacity="0.25" stroke="#253044" strokeWidth="1">
        {[0, 1, 2, 3, 4].map((row) => (
          <line key={row} x1="8" y1={44 + row * 40} x2="332" y2={44 + row * 40} />
        ))}
      </g>

      {/* Taşıma bandı */}
      <rect x="20" y="150" width="300" height="10" rx="5" fill="url(#optiflow-belt)" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((tick) => (
        <rect
          key={tick}
          x={30 + tick * 38}
          y="152"
          width="14"
          height="6"
          rx="3"
          fill="#0B0F14"
          opacity="0.6"
        />
      ))}

      {/* Makineler */}
      {MACHINES.map((machine, index) => (
        <g key={machine.label}>
          <rect
            x={machine.x}
            y="78"
            width="64"
            height="66"
            rx="10"
            fill="url(#optiflow-machine-face)"
            stroke="#2A3644"
          />
          {/* Çalışma göstergesi: sırayla yanıp söner. */}
          <circle
            className="optiflow-machine"
            cx={machine.x + 32}
            cy="98"
            r="5"
            fill={index === 1 ? "#F59E0B" : "#22C55E"}
            style={{ animationDelay: `${index * 0.5}s` }}
          />
          <rect
            x={machine.x + 14}
            y="112"
            width="36"
            height="4"
            rx="2"
            fill="#2A3644"
          />
          <rect
            x={machine.x + 14}
            y="122"
            width="24"
            height="4"
            rx="2"
            fill="#1F2937"
          />
          {/* Bacadan çıkan borular */}
          <rect
            x={machine.x + 18}
            y="64"
            width="8"
            height="16"
            rx="3"
            fill="#1F2937"
          />
          <rect
            x={machine.x + 40}
            y="56"
            width="8"
            height="24"
            rx="3"
            fill="#1F2937"
          />
        </g>
      ))}

      {/* Bant üzerinde akan parçalar */}
      {[0, 1, 2].map((part) => (
        <circle
          key={part}
          className="optiflow-part"
          cx="34"
          cy="155"
          r="5"
          fill="#3B82F6"
          filter="url(#optiflow-glow)"
          style={{ animationDelay: `${part * 1.05}s` }}
        />
      ))}

      {/* Sağ üstte "veri" katmanı — ürünün ölçtüğünü ima eder. */}
      <g opacity="0.9">
        <rect
          x="228"
          y="22"
          width="92"
          height="44"
          rx="10"
          fill="#111827"
          stroke="#1F2937"
        />
        <polyline
          points="238,54 252,44 264,50 278,32 292,38 308,28"
          stroke="#22C55E"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="308" cy="28" r="3" fill="#22C55E" />
      </g>
    </svg>
  );
}
