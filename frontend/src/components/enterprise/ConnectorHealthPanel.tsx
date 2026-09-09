/**
 * Bağlayıcı sağlık paneli.
 *
 * Ping, son veri, yeniden deneme sayısı ve 0-100 sağlık skoru
 * `lib/onboarding-enterprise/connectorHealth.ts` içinde hesaplanır.
 *
 * Her kart **Benzetim** rozeti taşır. Bu sürümde hiçbir kaynak gerçek bir
 * cihaza bağlanmaz; rozet, bir yöneticinin sahte veriyi canlı üretim sanmasını
 * engelleyen tek işarettir. Gerçek bağlantı geldiğinde rozet
 * `isRealConnection` alanından kendiliğinden değişecek.
 */

import { Activity, Radio } from "lucide-react";
import { relativeTime } from "../../lib/connectors";
import {
  overallHealth,
  worstCard,
  type ConnectorHealthCard,
} from "../../lib/onboarding-enterprise";
import { Card } from "../ui/Primitives";
import { BAND_STYLE, showScore } from "./enterpriseStyles";

interface ConnectorHealthPanelProps {
  cards: ConnectorHealthCard[];
  nowMs: number;
  /** Bağlayıcı merkezine götürür. */
  onOpenConnectors?: () => void;
}

export function ConnectorHealthPanel({
  cards,
  nowMs,
  onOpenConnectors,
}: ConnectorHealthPanelProps) {
  const overall = overallHealth(cards);
  const worst = worstCard(cards);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Radio className="h-4 w-4 text-slate-400" />
            Veri kaynağı sağlığı
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {overall.measured} kaynakta ölçüm var, {overall.unmeasured} kaynağa hiç
            bağlanılmadı.
          </p>
        </div>
        <span
          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${BAND_STYLE[overall.band].chip}`}
        >
          Ortalama {showScore(overall.score)}
        </span>
      </div>

      {cards.length === 0 ? (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          Tanımlı veri kaynağı yok. Bağlayıcı merkezinden OPC UA, MQTT, REST ya da
          CSV kaynağı ekleyebilirsiniz.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card, index) => {
            const style = BAND_STYLE[card.band];
            return (
              <button
                key={card.configId}
                type="button"
                onClick={onOpenConnectors}
                className="optiflow-lift optiflow-enter rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors duration-200 hover:border-brand-400"
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-900">
                      {card.name}
                    </p>
                    <p className="truncate text-[10px] text-slate-500">{card.kind}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${style.chip}`}
                  >
                    {showScore(card.score)}
                  </span>
                </div>

                <dl className="mt-2 space-y-0.5 text-[10px]">
                  <Row label="Ping" value={card.pingMs === null ? "—" : `${Math.round(card.pingMs)} ms`} />
                  <Row label="Son veri" value={relativeTime(card.lastDataAtMs, nowMs)} />
                  <Row label="Yeniden deneme" value={String(card.retryCount)} />
                </dl>

                <div className="mt-2 flex items-center gap-1">
                  <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                    {card.isRealConnection ? "Gerçek bağlantı" : "Benzetim"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {worst !== null && (
        <p className="mt-3 flex items-start gap-2 text-[11px] text-slate-500">
          <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          Önce {worst.name} kaynağına bakın: {worst.detail}
        </p>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium tabular-nums text-slate-700">{value}</dd>
    </div>
  );
}
