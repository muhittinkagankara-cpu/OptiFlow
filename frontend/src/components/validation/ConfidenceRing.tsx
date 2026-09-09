/**
 * Güven rozeti — büyük halka.
 *
 * Halkanın dolumu CSS geçişiyle yapılır (`stroke-dashoffset`), JavaScript'le
 * kare kare çizilmez: bir gösterge için animasyon döngüsü çevirmek, sekmeyi
 * arka planda bırakan kullanıcının pilini boşuna tüketir. Hareketi azaltılmış
 * kullanıcıda geçiş süresi 0'a iner (`motion-reduce`).
 *
 * Ölçüm yokken halka **boş** gösterilir ve ortasında "—" yazar; %0'lık dolu bir
 * halka, ölçüm yapılmadığını değil güvenin sıfır olduğunu anlatırdı.
 */

import { CONFIDENCE_LABEL, type ConfidenceLevel } from "../../lib/validation";
import { CONFIDENCE_STYLE, showPercent } from "./validationStyles";

const SIZE = 132;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface ConfidenceRingProps {
  /** 0-1 arası skor; ölçüm yoksa `null`. */
  score: number | null;
  level: ConfidenceLevel | null;
}

export function ConfidenceRing({ score, level }: ConfidenceRingProps) {
  const filled = score === null ? 0 : Math.min(1, Math.max(0, score));
  const color = level === null ? "text-slate-400" : CONFIDENCE_STYLE[level].ring;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={
            score === null
              ? "Güven skoru henüz hesaplanmadı"
              : `Güven skoru ${showPercent(score)}`
          }
        >
          {/* Zemin halkası */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-slate-200"
          />
          {/* Dolum; 12 yönünden başlaması için çeyrek tur döndürülür. */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - filled)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            className={`${color} transition-all duration-700 ease-out motion-reduce:transition-none`}
            style={{ stroke: "currentColor" }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tracking-tight text-slate-900">
            {showPercent(score)}
          </span>
          <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Güven
          </span>
        </div>
      </div>

      <span
        className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
          level === null
            ? "border-slate-200 bg-slate-100 text-slate-500"
            : CONFIDENCE_STYLE[level].chip
        }`}
      >
        {level === null ? "Ölçüm bekleniyor" : CONFIDENCE_LABEL[level]}
      </span>
    </div>
  );
}
