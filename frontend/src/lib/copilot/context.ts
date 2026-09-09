/**
 * Bağlam kurucu — sekiz katmanın tek bir özete indirgenmesi.
 *
 * Copilot'un gördüğü her sayı buradan geçer. Kural motoru ham veriye hiç
 * bakmaz; yalnızca `ContextFact` listesini okur. Bu ayrım Copilot'un
 * dürüstlüğünün temelidir: bir cümlede geçen her rakam, bağlamda bir olgu
 * olarak durmak zorundadır (bkz. `guards.ts`).
 *
 * Eksik katman **gizlenmez**. Finans raporu yoksa bölüm "yok" olarak eklenir ve
 * nedeni yazılır; Copilot da "bu konuda yeterli veri bulunamadı" derken bu
 * nedeni gösterir. Eksik veriyi sessizce atlamak, kullanıcıya cevabın neden
 * yüzeysel olduğunu anlatmazdı.
 *
 * İşlev saftır: saat dışarıdan verilir, hiçbir yerde `Date.now()` okunmaz.
 */

import { formatMoney } from "../financeFormatting";
import { bottleneckSummary, monthlyLoss } from "../dashboardMetrics";
import { liveTotals } from "../live";
import { healthSnapshot } from "../connectors";
import { conversionFunnel, pipelineCounts } from "../sales";
import type { ConnectorState } from "../connectors";
import type { Lead } from "../sales";
import type { LiveFactoryState } from "../live";
import type {
  ConfidenceScore,
  ValidationSnapshot,
  ValidationSummary,
} from "../validation";
import type {
  FinancialReport,
  InventoryAnalysis,
  SimulationResults,
} from "../../types/simulationTypes";
import {
  SOURCE_LABEL,
  type ContextFact,
  type ContextSection,
  type ContextSource,
  type FactProvenance,
  type FactoryContext,
} from "./types";

/** Bağlamın beslendiği ham girdiler; hepsi isteğe bağlıdır. */
export interface ContextInput {
  factoryName: string | null;
  nowMs: number;
  results: SimulationResults | null;
  report: FinancialReport | null;
  validation: ValidationSummary | null;
  confidence: ConfidenceScore | null;
  /**
   * Kaydedilmiş doğrulama ölçümleri.
   *
   * Doğrulama ekranı kendi durumunu taşır; Copilot açıkken o ekran kapalı
   * olabilir. Bu durumda **son kaydedilmiş ölçüm** kullanılır — uydurulmuş bir
   * doğruluk değil, kullanıcının kendi kaydettiği en güncel ölçüm.
   */
  validationHistory: ValidationSnapshot[] | null;
  live: LiveFactoryState | null;
  inventory: InventoryAnalysis[] | null;
  leads: Lead[] | null;
  connectors: ConnectorState | null;
}

/* -------------------------------------------------------------------------- */

function fact(
  key: string,
  label: string,
  display: string,
  numeric: number | null,
  source: ContextSource,
  provenance: FactProvenance = "measured",
): ContextFact {
  return { key, label, display, numeric, source, provenance };
}

function percent(value: number, digits = 0): string {
  return `%${(value * 100).toFixed(digits).replace(".", ",")}`;
}

function decimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}

function missing(source: ContextSource, reason: string): ContextSection {
  return { source, available: false, missingReason: reason, facts: [] };
}

/* -------------------------------------------------------------------------- */
/* Bölümler                                                                    */
/* -------------------------------------------------------------------------- */

function simulationSection(results: SimulationResults | null): ContextSection {
  if (results === null) {
    return missing(
      "simulation",
      "Henüz bir simülasyon koşumu yok; hat metrikleri hesaplanamıyor.",
    );
  }

  const bottleneck = bottleneckSummary(results);
  const facts: ContextFact[] = [
    fact(
      "throughput_per_minute",
      "Çıktı hızı",
      `${decimal(results.throughput_per_minute, 2)} parça/dk`,
      results.throughput_per_minute,
      "simulation",
    ),
    fact(
      "line_oee",
      "Hat OEE",
      percent(results.line_oee),
      results.line_oee,
      "simulation",
    ),
    fact(
      "avg_flow_time",
      "Ortalama akış süresi",
      `${decimal(results.avg_flow_time)} dk`,
      results.avg_flow_time,
      "simulation",
    ),
    fact(
      "station_count",
      "İstasyon sayısı",
      String(results.station_metrics.length),
      results.station_metrics.length,
      "simulation",
    ),
    fact(
      "is_stable",
      "Hat kararlı mı",
      results.is_stable ? "evet" : "hayır",
      null,
      "simulation",
    ),
  ];

  if (bottleneck !== null) {
    facts.push(
      fact(
        "bottleneck_name",
        "Darboğaz istasyonu",
        bottleneck.name,
        null,
        "simulation",
      ),
      fact(
        "bottleneck_utilization",
        "Darboğaz doluluğu",
        percent(bottleneck.utilization),
        bottleneck.utilization,
        "simulation",
      ),
    );
  }

  /* En yüksek fire oranlı istasyon; "fire neden arttı?" sorusunun dayanağı. */
  const worstScrap = [...results.station_metrics]
    .map((station) => ({
      station,
      ratio:
        station.flow.entered > 0
          ? station.flow.scrapped / station.flow.entered
          : 0,
    }))
    .sort((a, b) => b.ratio - a.ratio)[0];

  if (worstScrap !== undefined && worstScrap.ratio > 0) {
    facts.push(
      fact(
        "worst_scrap_station",
        "En yüksek fireli istasyon",
        worstScrap.station.station_name,
        null,
        "simulation",
      ),
      fact(
        "worst_scrap_ratio",
        "O istasyonun fire oranı",
        percent(worstScrap.ratio, 1),
        worstScrap.ratio,
        "simulation",
        "derived",
      ),
    );
  }

  return { source: "simulation", available: true, missingReason: null, facts };
}

function financeSection(report: FinancialReport | null): ContextSection {
  if (report === null) {
    return missing(
      "finance",
      "Maliyet oranları girilmediği için parasal kayıp hesaplanmadı.",
    );
  }

  const monthly = monthlyLoss(report);
  const facts: ContextFact[] = [
    fact(
      "total_loss",
      "Pencere içi toplam kayıp",
      formatMoney(report.impact.total_loss),
      report.impact.total_loss,
      "finance",
    ),
    fact(
      "recoverable_loss",
      "Kurtarılabilir kayıp",
      formatMoney(report.recoverable_loss),
      report.recoverable_loss,
      "finance",
    ),
    fact(
      "data_completeness",
      "Veri doluluğu",
      percent(report.impact.data_completeness),
      report.impact.data_completeness,
      "finance",
    ),
    fact(
      "finance_confidence",
      "Finans güveni",
      percent(report.impact.confidence),
      report.impact.confidence,
      "finance",
    ),
  ];

  if (monthly !== null) {
    facts.push(
      fact(
        "monthly_loss",
        "Aylık kayıp projeksiyonu",
        formatMoney(monthly),
        monthly,
        "finance",
        "derived",
      ),
    );
  }

  /* En büyük kayıp kalemi — yalnızca ölçülebilmiş bileşenler arasından. */
  const available = report.impact.components.filter(
    (component) => component.is_available,
  );
  const dominant = [...available].sort((a, b) => b.amount - a.amount)[0];
  if (dominant !== undefined) {
    facts.push(
      fact("dominant_loss_label", "En büyük kayıp kalemi", dominant.label, null, "finance"),
      fact(
        "dominant_loss_amount",
        "O kalemin tutarı",
        formatMoney(dominant.amount),
        dominant.amount,
        "finance",
      ),
    );
  }

  const topStation = report.top_loss_stations[0];
  if (topStation !== undefined) {
    facts.push(
      fact(
        "top_loss_station",
        "En çok kaybettiren istasyon",
        topStation.station_name,
        null,
        "finance",
      ),
      fact(
        "top_loss_amount",
        "O istasyonun kaybı",
        formatMoney(topStation.total_loss),
        topStation.total_loss,
        "finance",
      ),
    );
  }

  const suggestion = report.suggestions[0];
  if (suggestion !== undefined) {
    facts.push(
      fact(
        "top_suggestion_action",
        "Finans katmanının önerisi",
        suggestion.action,
        null,
        "finance",
      ),
      fact(
        "top_suggestion_amount",
        "Önerinin kurtaracağı tutar",
        formatMoney(suggestion.recoverable_amount),
        suggestion.recoverable_amount,
        "finance",
      ),
    );
  }

  if (report.impact.missing_inputs.length > 0) {
    facts.push(
      fact(
        "missing_inputs",
        "Girilmemiş maliyet oranları",
        report.impact.missing_inputs.join(", "),
        null,
        "finance",
      ),
    );
  }

  return { source: "finance", available: true, missingReason: null, facts };
}

function heatmapSection(report: FinancialReport | null): ContextSection {
  const heat = report?.heat ?? [];
  if (heat.length === 0) {
    return missing(
      "heatmap",
      "Isı haritası bir finans raporu gerektirir; henüz üretilmedi.",
    );
  }

  const hottest = heat[0];
  const facts: ContextFact[] = [
    fact("hottest_station", "En sıcak istasyon", hottest.station_name, null, "heatmap"),
    fact(
      "hottest_score",
      "Isı skoru",
      decimal(hottest.score, 0),
      hottest.score,
      "heatmap",
    ),
    fact("hottest_band", "Isı bandı", hottest.band, null, "heatmap"),
    fact(
      "hottest_loss",
      "O istasyonun kaybı",
      formatMoney(hottest.total_loss),
      hottest.total_loss,
      "heatmap",
    ),
    fact(
      "red_station_count",
      "Kırmızı bantta istasyon",
      String(heat.filter((item) => item.band === "red").length),
      heat.filter((item) => item.band === "red").length,
      "heatmap",
      "derived",
    ),
  ];

  const dominant = [...hottest.components].sort(
    (a, b) => b.contribution - a.contribution,
  )[0];
  if (dominant !== undefined) {
    facts.push(
      fact(
        "hottest_driver",
        "Isıyı en çok büyüten bileşen",
        dominant.label,
        null,
        "heatmap",
      ),
    );
  }

  return { source: "heatmap", available: true, missingReason: null, facts };
}

/**
 * Kaydedilmiş son ölçümden kurulan doğrulama bölümü.
 *
 * Ekran kapalıyken de doğrulama sonucunu kullanabilmek için vardır. Ölçümün
 * **tarihi** de olguya yazılır: aylar önce alınmış bir doğruluk oranını bugünün
 * ölçümü gibi sunmak, Copilot'un en kolay düşeceği tuzaktır.
 */
function snapshotSection(history: ValidationSnapshot[] | null): ContextSection {
  const measured = (history ?? []).filter(
    (item) => item.overallAccuracy !== null,
  );
  const last = measured[measured.length - 1];

  if (last === undefined || last.overallAccuracy === null) {
    return missing(
      "validation",
      "Gerçek üretim verisi girilmediği için modelin doğruluğu ölçülmedi.",
    );
  }

  const facts: ContextFact[] = [
    fact(
      "model_accuracy",
      "Model doğruluğu",
      percent(last.overallAccuracy),
      last.overallAccuracy,
      "validation",
    ),
    fact(
      "measured_stations",
      "Ölçülen istasyon",
      `${last.measuredStationCount}/${last.stationCount}`,
      last.measuredStationCount,
      "validation",
    ),
    fact(
      "validation_measured_at",
      "Ölçümün tarihi",
      new Date(last.measuredAt).toLocaleDateString("tr-TR"),
      null,
      "validation",
    ),
  ];

  if (last.confidenceScore !== null) {
    facts.push(
      fact(
        "validation_confidence",
        "Doğrulama güven skoru",
        percent(last.confidenceScore),
        last.confidenceScore,
        "validation",
      ),
    );
  }

  return { source: "validation", available: true, missingReason: null, facts };
}

function validationSection(
  summary: ValidationSummary | null,
  confidence: ConfidenceScore | null,
  history: ValidationSnapshot[] | null,
): ContextSection {
  if (summary === null || summary.overallAccuracy === null) {
    return snapshotSection(history);
  }

  const facts: ContextFact[] = [
    fact(
      "model_accuracy",
      "Model doğruluğu",
      percent(summary.overallAccuracy),
      summary.overallAccuracy,
      "validation",
    ),
    fact(
      "measured_stations",
      "Ölçülen istasyon",
      `${summary.measuredStationCount}/${summary.stationCount}`,
      summary.measuredStationCount,
      "validation",
    ),
  ];

  if (confidence?.score != null) {
    facts.push(
      fact(
        "validation_confidence",
        "Doğrulama güven skoru",
        percent(confidence.score),
        confidence.score,
        "validation",
      ),
    );
  }

  if (summary.worstStation !== null) {
    facts.push(
      fact(
        "worst_accuracy_station",
        "Modelden en çok sapan istasyon",
        summary.worstStation.stationName,
        null,
        "validation",
      ),
    );
  }

  if (summary.biggestGap !== null) {
    facts.push(
      fact(
        "biggest_gap",
        "En büyük sapma",
        percent(Math.abs(summary.biggestGap.errorRatio)),
        Math.abs(summary.biggestGap.errorRatio),
        "validation",
      ),
    );
  }

  return { source: "validation", available: true, missingReason: null, facts };
}

function liveSection(live: LiveFactoryState | null): ContextSection {
  if (live === null || live.stations.length === 0) {
    return missing("live", "Canlı üretim akışı açık değil.");
  }

  const totals = liveTotals(live);
  const facts: ContextFact[] = [
    fact(
      "live_running",
      "Çalışan istasyon",
      `${totals.runningStations}/${live.stations.length}`,
      totals.runningStations,
      "live",
    ),
    fact(
      "live_queue",
      "Bekleyen parça",
      String(totals.totalQueue),
      totals.totalQueue,
      "live",
    ),
    fact(
      "live_open_alarms",
      "Açık alarm",
      String(totals.openAlarms),
      totals.openAlarms,
      "live",
    ),
  ];

  if (totals.oee !== null) {
    facts.push(
      fact("live_oee", "Canlı OEE", percent(totals.oee), totals.oee, "live"),
    );
  }

  const critical = live.alarms.find(
    (alarm) => alarm.level === "critical" && alarm.resolvedAtMinutes === null,
  );
  if (critical !== undefined) {
    facts.push(
      fact(
        "live_critical_alarm",
        "Açık kritik alarm",
        `${critical.stationName}: ${critical.text}`,
        null,
        "live",
      ),
    );
  }

  return { source: "live", available: true, missingReason: null, facts };
}

function inventorySection(items: InventoryAnalysis[] | null): ContextSection {
  if (items === null || items.length === 0) {
    return missing("inventory", "Envanter analizi yapılmadı.");
  }

  const critical = items.filter((item) => item.status === "critical");
  const facts: ContextFact[] = [
    fact("inventory_items", "Analiz edilen kalem", String(items.length), items.length, "inventory"),
    fact(
      "inventory_critical",
      "Kritik seviyedeki kalem",
      String(critical.length),
      critical.length,
      "inventory",
      "derived",
    ),
  ];

  const worst = [...items]
    .filter((item) => item.days_of_stock >= 0)
    .sort((a, b) => a.days_of_stock - b.days_of_stock)[0];
  if (worst !== undefined) {
    facts.push(
      fact("inventory_worst_item", "Stoku ilk bitecek kalem", worst.item_name, null, "inventory"),
      fact(
        "inventory_worst_days",
        "Kalan gün",
        `${decimal(worst.days_of_stock, 0)} gün`,
        worst.days_of_stock,
        "inventory",
      ),
    );
  }

  return { source: "inventory", available: true, missingReason: null, facts };
}

function crmSection(leads: Lead[] | null, nowMs: number): ContextSection {
  if (leads === null || leads.length === 0) {
    return missing("crm", "Satış hattında kayıt yok.");
  }

  const counts = pipelineCounts(leads);
  const funnel = conversionFunnel(leads);
  const won = funnel.find((step) => step.label.includes("Kazanıldı"));

  const facts: ContextFact[] = [
    fact("crm_total", "Toplam firma", String(leads.length), leads.length, "crm"),
    fact("crm_won", "Kazanılan", String(counts.won), counts.won, "crm"),
    fact(
      "crm_awaiting_demo",
      "Demo bekleyen",
      String(counts.awaitingDemo),
      counts.awaitingDemo,
      "crm",
    ),
  ];

  if (won?.rate != null) {
    facts.push(
      fact(
        "crm_win_rate",
        "Teklif → kazanma oranı",
        percent(won.rate),
        won.rate,
        "crm",
        "derived",
      ),
    );
  }

  // Zaman yalnızca bölümün tazeliğini işaretlemek için taşınır.
  facts.push(
    fact("crm_as_of", "Satış verisinin anı", new Date(nowMs).toISOString(), null, "crm"),
  );

  return { source: "crm", available: true, missingReason: null, facts };
}

function connectorSection(state: ConnectorState | null): ContextSection {
  if (state === null || state.configs.length === 0) {
    return missing("connectors", "Tanımlı bir veri bağlantısı yok.");
  }

  const health = healthSnapshot(state);
  const facts: ContextFact[] = [
    fact(
      "connector_connected",
      "Bağlı kaynak",
      `${health.connected}/${health.total}`,
      health.connected,
      "connectors",
    ),
    fact(
      "connector_failed",
      "Kopuk kaynak",
      String(health.disconnected + health.failed),
      health.disconnected + health.failed,
      "connectors",
      "derived",
    ),
    fact(
      "connector_sync_errors",
      "Senkron hatası",
      String(health.syncErrors),
      health.syncErrors,
      "connectors",
    ),
  ];

  if (health.avgLatencyMs !== null) {
    facts.push(
      fact(
        "connector_latency",
        "Ortalama gecikme",
        `${Math.round(health.avgLatencyMs)} ms`,
        health.avgLatencyMs,
        "connectors",
      ),
    );
  }

  return { source: "connectors", available: true, missingReason: null, facts };
}

/* -------------------------------------------------------------------------- */

/** Sekiz katmanı tek bağlama indirger. */
export function buildContext(input: ContextInput): FactoryContext {
  return {
    factoryName: input.factoryName,
    generatedAtMs: input.nowMs,
    sections: [
      simulationSection(input.results),
      financeSection(input.report),
      heatmapSection(input.report),
      validationSection(
        input.validation,
        input.confidence,
        input.validationHistory,
      ),
      liveSection(input.live),
      inventorySection(input.inventory),
      crmSection(input.leads, input.nowMs),
      connectorSection(input.connectors),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Okuma yardımcıları                                                          */
/* -------------------------------------------------------------------------- */

/** Anahtara göre olgu; yoksa `null`. */
export function factOf(context: FactoryContext, key: string): ContextFact | null {
  for (const section of context.sections) {
    const found = section.facts.find((item) => item.key === key);
    if (found !== undefined) {
      return found;
    }
  }
  return null;
}

/** Olgunun gösterim değeri; yoksa `null`. */
export function displayOf(context: FactoryContext, key: string): string | null {
  return factOf(context, key)?.display ?? null;
}

/** Bir katmanın bölümü. */
export function sectionOf(
  context: FactoryContext,
  source: ContextSource,
): ContextSection {
  return (
    context.sections.find((section) => section.source === source) ??
    missing(source, `${SOURCE_LABEL[source]} verisi yok.`)
  );
}

/** Verisi olan katmanlar. */
export function availableSources(context: FactoryContext): ContextSource[] {
  return context.sections
    .filter((section) => section.available)
    .map((section) => section.source);
}

/** Bağlamdaki tüm olgular. */
export function allFacts(context: FactoryContext): ContextFact[] {
  return context.sections.flatMap((section) => section.facts);
}

/**
 * Bağlamın ne kadar dolu olduğu (0-1).
 *
 * Güven etiketi bu orana bakar: iki katmanla kurulmuş bir cümle ile yedi
 * katmanla kurulmuş bir cümle aynı ağırlıkta sunulmamalıdır.
 */
export function contextCompleteness(context: FactoryContext): number {
  if (context.sections.length === 0) {
    return 0;
  }
  return availableSources(context).length / context.sections.length;
}
