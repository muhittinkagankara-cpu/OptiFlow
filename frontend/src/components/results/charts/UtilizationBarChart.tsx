/**
 * İstasyon kullanım oranları — yatay çubuk grafik.
 *
 * Yatay yerleşim bilinçlidir: istasyon adları uzundur ve dikey çubuklarda
 * eğik yazılmak zorunda kalır. Yatay çubukta ad soldan okunur, karşılaştırma
 * göz seviyesinde yapılır.
 *
 * Darboğaz istasyonu, backend'in `is_bottleneck` alanına göre kırmızı boyanır —
 * en yüksek çubuğa göre değil. Blokaj nedeniyle bekleyen bir istasyonun
 * kullanım oranı düşük görünebilir; kısıtı çubuk yüksekliğinden çıkarmaya
 * çalışmak yanlış istasyonu işaretlerdi.
 */

import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StationMetricsResponse } from "../../../types/simulationTypes";
import { BUSY_UTILIZATION_THRESHOLD, CHART_COLORS } from "../../../lib/resultsFormatting";

interface UtilizationBarChartProps {
  stations: StationMetricsResponse[];
}

interface ChartRow {
  name: string;
  utilization: number;
  isBottleneck: boolean;
}

export function UtilizationBarChart({ stations }: UtilizationBarChartProps) {
  if (stations.length === 0) {
    return null;
  }

  const data: ChartRow[] = stations.map((station) => ({
    name: station.station_name,
    utilization: Number((station.utilization * 100).toFixed(1)),
    isBottleneck: station.is_bottleneck,
  }));

  // Her çubuk için sabit yükseklik: istasyon sayısı arttıkça grafik uzar,
  // çubuklar incelmez. Sabit yükseklikte on istasyon okunamaz hâle gelirdi.
  const height = Math.max(140, data.length * 44 + 40);

  return (
    // `overflow-hidden` zorunludur: Recharts'ın ResponsiveContainer'ı içeride
    // `width: 0; overflow: visible` bir sarmalayıcı üretir ve grafik içeriği
    // bu sıfır genişlikli kutudan taşar. Dizginlenmezse taşma belge düzeyine
    // çıkar ve dar ekranlarda tüm sayfa yana kayar.
    <div className="overflow-hidden" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
        >
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={(value: number) => `%${value}`}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={{ stroke: "#e2e8f0" }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fontSize: 12, fill: "#475569" }}
            axisLine={false}
            tickLine={false}
          />
          <RechartsTooltip
            cursor={{ fill: "#f1f5f9" }}
            // Recharts formatter'ları değeri geniş bir birleşim tipiyle verir
            // (sayı, metin, dizi ya da undefined). Parametreyi `unknown` alıp
            // burada daraltmak, kütüphanenin iç tiplerine derin import yapmadan
            // tip güvenli kalmanın yoludur.
            formatter={(value: unknown) => [`%${Number(value)}`, "Doluluk"]}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 12,
            }}
          />
          {/* Yoğunluk eşiği: bu çizginin sağındaki istasyonlarda kuyruk,
              küçük dalgalanmalara bile hızla tepki verir. */}
          <ReferenceLine
            x={BUSY_UTILIZATION_THRESHOLD * 100}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            label={{
              value: "yoğunluk eşiği",
              position: "top",
              fontSize: 10,
              fill: "#b45309",
            }}
          />
          <Bar dataKey="utilization" radius={[0, 4, 4, 0]} barSize={22}>
            {data.map((row) => (
              <Cell
                key={row.name}
                fill={row.isBottleneck ? CHART_COLORS.bottleneck : CHART_COLORS.station}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
