/**
 * Excel dışa aktarımı — beş sekme.
 *
 * PDF okunmak, Excel **işlenmek** içindir. Bu yüzden burada tire (—) değil,
 * boş hücre (`null`) kullanılır: bir tire, sütunu metne çevirip toplama ve
 * ortalama almayı bozar. Excel'de eksik veri boş hücredir; sıfır değildir ve
 * yazı da değildir.
 *
 * Yüzdeler 0-1 aralığında sayı olarak yazılır, yüzde biçimlendirmesi Excel'e
 * bırakılır — "%74" metnini geri sayıya çevirmek kullanıcının işi olmamalıdır.
 */

import { flowTotals } from "../actionItems";
import { classifyWarning } from "../resultsFormatting";
import { bottleneckSummary, monthlyLoss } from "../dashboardMetrics";
import { SEVERITY_LABEL, buildPriorityCards } from "../intelligence";
import { fileDateStamp, slugify } from "./shared";
import type { ReportContext, SheetSpec, SheetValue } from "./types";

/** Beş sekmenin tamamı; veri yoksa sekme başlıklarıyla ve nedeniyle döner. */
export function buildWorkbook(context: ReportContext): SheetSpec[] {
  return [
    stationSheet(context),
    kpiSheet(context),
    alarmSheet(context),
    scrapSheet(context),
    financeSheet(context),
  ];
}

/** Çalışma kitabının dosya adı (uzantısız). */
export function workbookFileName(context: ReportContext): string {
  const factory = slugify(context.factoryName ?? "fabrika");
  return `optiflow-veri-${factory}-${fileDateStamp(context.generatedAt)}`;
}

/* -------------------------------------------------------------------------- */

function stationSheet(context: ReportContext): SheetSpec {
  const results = context.result?.results ?? null;
  const config = context.config;

  const columns = [
    "İstasyon",
    "Hat",
    "Makine sayısı",
    "Doluluk",
    "OEE",
    "Kullanılabilirlik",
    "Performans",
    "Kalite",
    "Ortalama kuyruk",
    "Ortalama bekleme (dk)",
    "Darboğaz",
  ];

  if (results === null) {
    return {
      name: "Station Data",
      columns,
      rows: [],
      emptyNote: "Bir simülasyon koşumu yok; istasyon metrikleri üretilemedi.",
    };
  }

  const byId = new Map(config?.stations.map((item) => [item.id, item]) ?? []);

  return {
    name: "Station Data",
    columns,
    rows: results.station_metrics.map((station): SheetValue[] => {
      const definition = byId.get(station.station_id);
      return [
        station.station_name,
        definition?.line_name ?? null,
        definition?.num_servers ?? null,
        station.utilization,
        station.oee.oee,
        station.oee.availability,
        station.oee.performance,
        station.oee.quality,
        station.avg_queue_length,
        station.avg_wait_time,
        station.is_bottleneck ? "Evet" : "Hayır",
      ];
    }),
  };
}

function kpiSheet(context: ReportContext): SheetSpec {
  const results = context.result?.results ?? null;
  const columns = ["Gösterge", "Değer", "Birim", "Not"];

  if (results === null) {
    return {
      name: "KPI",
      columns,
      rows: [],
      emptyNote: "Bir simülasyon koşumu yok; göstergeler ölçülemedi.",
    };
  }

  const totals = flowTotals(results);
  const bottleneck = bottleneckSummary(results);
  const monthly = monthlyLoss(context.report);

  const rows: SheetValue[][] = [
    ["Hat OEE", results.line_oee, "oran", "Kullanılabilirlik × performans × kalite"],
    ["Throughput", results.throughput_per_minute, "parça/dk", null],
    [
      "Teorik kapasite",
      results.theoretical_max_throughput_per_minute,
      "parça/dk",
      "Kuyruk ve arıza olmadan ulaşılabilecek üst sınır",
    ],
    ["Toplam üretim", results.total_throughput, "birim", null],
    ["Ortalama WIP", results.avg_wip, "parça", null],
    ["Ortalama akış süresi", results.avg_flow_time, "dk", null],
    ["Tekrar sayısı", results.num_replications, "koşum", null],
    ["Kararlılık", results.is_stable ? "Kararlı" : "Kararsız", null, null],
    [
      "Darboğaz",
      bottleneck?.name ?? null,
      null,
      bottleneck === null ? "Belirgin bir kısıt yok" : "En yüksek doluluk",
    ],
    ["Darboğaz doluluğu", bottleneck?.utilization ?? null, "oran", null],
    [
      "Fire oranı",
      totals.entered > 0 ? totals.scrapped / totals.entered : null,
      "oran",
      totals.entered > 0 ? null : "Akış verisi yok",
    ],
    [
      "Aylık kayıp",
      monthly,
      "₺",
      monthly === null ? "Maliyet oranları girilmedi" : "Koşum penceresinden ölçeklendi",
    ],
  ];

  return { name: "KPI", columns, rows };
}

/**
 * Alarm sekmesi.
 *
 * Alarmlar canlı ekranın olay akışından değil, **koşumdan** üretilir: bu rapor
 * bir simülasyon sonucunu anlatır ve canlı ekran açık olmayabilir. Kaynak,
 * Intelligence katmanının öncelik kartları ile koşumun kendi uyarılarıdır;
 * böylece PDF'te görünen bulgularla Excel'deki satırlar aynı yerden gelir.
 */
function alarmSheet(context: ReportContext): SheetSpec {
  const results = context.result?.results ?? null;
  const columns = ["Kaynak", "Önem", "İstasyon", "Başlık", "Açıklama", "Parasal etki"];

  if (results === null) {
    return {
      name: "Alarm",
      columns,
      rows: [],
      emptyNote: "Bir simülasyon koşumu yok; uyarı üretilemedi.",
    };
  }

  const rows: SheetValue[][] = buildPriorityCards(results, context.report).map(
    (card): SheetValue[] => [
      "Analiz",
      SEVERITY_LABEL[card.severity],
      card.station ?? null,
      card.title,
      card.detail,
      card.monetaryImpact,
    ],
  );

  for (const warning of context.result?.warnings ?? []) {
    const classified = classifyWarning(warning);
    rows.push([
      "Koşum",
      classified.tone === "bad" ? "Kritik" : "Uyarı",
      null,
      classified.title,
      classified.message,
      null,
    ]);
  }

  return {
    name: "Alarm",
    columns,
    rows,
    emptyNote:
      rows.length === 0 ? "Bu koşumda dikkat isteyen bir bulgu çıkmadı." : undefined,
  };
}

function scrapSheet(context: ReportContext): SheetSpec {
  const results = context.result?.results ?? null;
  const columns = [
    "İstasyon",
    "Giren",
    "Tamamlanan",
    "Hurda",
    "Reddedilen",
    "Hurda oranı",
    "Ret oranı",
    "Hurda kaybı",
  ];

  if (results === null) {
    return {
      name: "Scrap",
      columns,
      rows: [],
      emptyNote: "Bir simülasyon koşumu yok; fire verisi üretilemedi.",
    };
  }

  const lossByStation = new Map(
    context.report?.stations.map((item) => [item.station_id, item.scrap_loss]) ?? [],
  );

  const rows: SheetValue[][] = results.station_metrics.map((station) => {
    const flow = station.flow;
    return [
      station.station_name,
      flow.entered,
      flow.completed,
      flow.scrapped,
      flow.rejected,
      // Hiç parça girmemişse oran ölçülemez; sıfır yazmak yanıltıcı olurdu.
      flow.entered > 0 ? flow.scrapped / flow.entered : null,
      flow.entered > 0 ? flow.rejected / flow.entered : null,
      lossByStation.get(station.station_id) ?? null,
    ];
  });

  const totals = flowTotals(results);
  // `flowTotals` tamamlanan adedi taşımıyor (hat genelinde fire/ret oranları
  // için yazılmıştı); toplam burada ayrıca toplanır.
  const completed = results.station_metrics.reduce(
    (sum, station) => sum + station.flow.completed,
    0,
  );
  rows.push([
    "TOPLAM",
    totals.entered,
    completed,
    totals.scrapped,
    totals.rejected,
    totals.entered > 0 ? totals.scrapped / totals.entered : null,
    totals.entered > 0 ? totals.rejected / totals.entered : null,
    context.report?.impact.scrap_loss ?? null,
  ]);

  return { name: "Scrap", columns, rows };
}

function financeSheet(context: ReportContext): SheetSpec {
  const report = context.report;
  const columns = ["Bölüm", "Kalem", "Tutar", "Miktar", "Birim", "Dayanak"];

  if (report === null) {
    return {
      name: "Finance",
      columns,
      rows: [],
      emptyNote:
        "Maliyet oranları girilmediği için finansal etki hesaplanmadı. Finans ekranındaki oranları doldurup raporu yeniden alın.",
    };
  }

  const rows: SheetValue[][] = [];

  for (const component of report.impact.components) {
    rows.push([
      "Kayıp kalemi",
      component.label,
      // Oranı verilmemiş kalem sıfır değil, hesaplanamamıştır.
      component.is_available ? component.amount : null,
      component.quantity,
      component.quantity_unit,
      component.basis,
    ]);
  }

  rows.push(["Özet", "Toplam kayıp", report.impact.total_loss, null, null, null]);
  rows.push([
    "Özet",
    "Kurtarılabilir",
    report.recoverable_loss,
    null,
    null,
    "Önerilerin toplam etkisi",
  ]);
  rows.push([
    "Özet",
    "Günlük kayıp",
    report.daily_loss ?? null,
    null,
    null,
    report.daily_loss == null ? "Günlük üretim süresi girilmedi" : null,
  ]);

  for (const station of report.stations) {
    rows.push([
      "İstasyon kaybı",
      station.station_name,
      station.total_loss,
      null,
      null,
      station.is_bottleneck ? "Darboğaz" : null,
    ]);
  }

  for (const suggestion of report.suggestions) {
    rows.push([
      "Öneri",
      suggestion.station_name,
      suggestion.recoverable_amount,
      null,
      null,
      suggestion.action,
    ]);
  }

  return { name: "Finance", columns, rows };
}
