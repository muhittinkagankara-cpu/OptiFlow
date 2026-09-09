/**
 * Bağlayıcı uyumluluk matrisi.
 *
 * Her satırın durumu `compatibilityMatrix` içinde hesaplanır; ekran yalnızca
 * çizer. Ölçüt tek: bu oturumda gerçek bir cihaz yanıtı görüldü mü? Bir
 * kütüphanenin kurulu olması ya da uç noktanın yazılmış olması satırı
 * "Gerçek doğrulandı" yapmaz.
 */

import { CircleCheck, CircleDashed, FlaskConical } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  VERDICT_LABEL,
  matrixSummary,
  type MatrixRow,
  type MatrixVerdict,
} from "../../lib/connectors";
import { Badge, Card, SectionTitle } from "../ui/Primitives";
import { VERDICT_TONE } from "./runtimeStyles";

const VERDICT_ICON: Record<MatrixVerdict, LucideIcon> = {
  verified: CircleCheck,
  simulated: FlaskConical,
  unverified: CircleDashed,
};

interface ConnectorMatrixTableProps {
  rows: MatrixRow[];
}

export function ConnectorMatrixTable({ rows }: ConnectorMatrixTableProps) {
  return (
    <div>
      <SectionTitle
        title="Bağlayıcı uyumluluk matrisi"
        description="Bir satırın 'Gerçek doğrulandı' olması için cihazdan yanıt alınmış olmalıdır."
      />

      <Card className="p-4">
        <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">
          {matrixSummary(rows)}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium">Bağlayıcı</th>
                <th className="py-2 pr-3 font-medium">Durum</th>
                <th className="py-2 pr-3 font-medium">Sunucu sürücüsü</th>
                <th className="py-2 font-medium">Gerekçe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const Icon = VERDICT_ICON[row.verdict];
                return (
                  <tr key={row.kind} className="border-b border-slate-200 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-slate-900">
                      {row.label}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={VERDICT_TONE[row.verdict]} icon={Icon}>
                        {VERDICT_LABEL[row.verdict]}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-slate-500">
                      {row.hasServerBridge ? "Var" : "Yok"}
                    </td>
                    <td className="py-2.5 text-xs text-slate-500">
                      <span className="block">{row.reason}</span>
                      {row.evidence !== null && (
                        <span className="mt-0.5 block break-words font-mono text-[11px] text-emerald-700">
                          Kanıt: {row.evidence}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
