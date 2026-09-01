/**
 * Canvas'ta bir hattı/bölümü çevreleyen arka plan kutusu.
 *
 * Yalnızca çizimdir: seçilemez, taşınamaz ve fare olaylarını yakalamaz.
 * İstasyonlar bu kutuya React Flow'un `parentNode` mekanizmasıyla
 * bağlanmaz — bağlansaydı istasyon konumları gruba göre göreli hâle gelir ve
 * konumları mutlak varsayan yerleşim ile animasyon kodu sessizce bozulurdu.
 * Kutu, istasyonların sınır kutusundan her renderda yeniden hesaplanır.
 *
 * Görsel ağırlığı bilinçli olarak düşüktür: gruplama bir bilgi katmanıdır,
 * istasyonların kendisiyle dikkat için yarışmamalıdır.
 */

import type { NodeProps } from "reactflow";

export interface LineGroupNodeData {
  lineName: string;
  stationCount: number;
}

export function LineGroupNode({ data }: NodeProps<LineGroupNodeData>) {
  return (
    <div className="pointer-events-none h-full w-full rounded-2xl border-2 border-dashed border-slate-300 bg-slate-200/25">
      <div className="flex items-center gap-1.5 px-3 pt-1">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {data.lineName}
        </span>
        <span className="shrink-0 text-[11px] text-slate-400">
          · {data.stationCount} istasyon
        </span>
      </div>
    </div>
  );
}
