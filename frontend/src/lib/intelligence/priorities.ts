/**
 * Öncelik kartları ve iyileştirme kartları.
 *
 * İkisi de aynı bulgu kümesinden beslenir ama farklı soruları yanıtlar:
 * öncelik kartı "neyi kaybediyorum?", iyileştirme kartı "ne yapmalıyım?"
 * der. Ayrı tutulmaları bilinçlidir — tek bir liste, sorunla çözümü aynı
 * satıra sıkıştırıp ikisini de okunmaz hâle getirirdi.
 *
 * Parasal tutarlar **finans katmanından okunur**, burada hesaplanmaz:
 * `report.stations[].total_loss` ve `report.suggestions[].recoverable_amount`
 * backend'in kendi hesabıdır. Frontend'de yeniden hesaplansaydı aynı koşum
 * için iki farklı rakam çıkabilirdi.
 */

import type {
  FinancialReport,
  SimulationResults,
} from "../../types/simulationTypes";
import {
  BOTTLENECK_CRITICAL,
  BOTTLENECK_WARNING,
  REJECT_WARNING,
  SCRAP_WARNING,
  flowTotals,
} from "../actionItems";
import { bottleneckSummary, paybackDays } from "../dashboardMetrics";
import type {
  Difficulty,
  ImprovementCard,
  PriorityCard,
  Severity,
} from "./types";

/** Gösterilecek en fazla öncelik kartı. */
export const MAX_PRIORITY_CARDS = 5;

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

function pct(value: number): string {
  return `%${Math.round(value * 100)}`;
}

/**
 * En önemli beş bulguyu üretir.
 *
 * Sıralama önce aciliyete, sonra parasal etkiye göredir: aynı aciliyette iki
 * kart varsa daha çok para kaybettiren önce gelir. Parasal etki bilinmiyorsa
 * (finans raporu yok) kartlar üretilme sırasını korur.
 */
export function buildPriorityCards(
  results: SimulationResults | null,
  report: FinancialReport | null,
): PriorityCard[] {
  if (!results) {
    return [];
  }

  const cards: PriorityCard[] = [];
  const bottleneck = bottleneckSummary(results);
  const totals = flowTotals(results);

  /* -- Kararlılık -------------------------------------------------------- */
  if (!results.is_stable) {
    cards.push({
      id: "unstable",
      severity: "critical",
      title: "Hat kararsız",
      station: bottleneck?.name ?? null,
      detail:
        "Kuyruklar koşum boyunca büyümeye devam ediyor: gelen talep hattın kapasitesini aşıyor.",
      monetaryImpact: null,
      expectedGain:
        "Kapasite artırıldığında hat kararlı hâle gelir ve çıktı tahmini güvenilir olur.",
      icon: "unstable",
    });
  }

  /* -- Darboğaz ---------------------------------------------------------- */
  if (bottleneck && bottleneck.utilization >= BOTTLENECK_WARNING) {
    const impact =
      report?.stations.find((item) => item.is_bottleneck)?.total_loss ?? null;

    cards.push({
      id: "bottleneck",
      severity:
        bottleneck.utilization >= BOTTLENECK_CRITICAL ? "critical" : "high",
      title: `${bottleneck.name} hattı sınırlıyor`,
      station: bottleneck.name,
      detail: `İstasyon zamanının ${pct(bottleneck.utilization)}'ini işlem yaparak geçiriyor. Hattın çıktısını belirleyen kısıt burasıdır.`,
      monetaryImpact: impact,
      expectedGain:
        "Bu istasyona kapasite eklemek, hattın tamamının çıktısını artıran tek müdahaledir.",
      icon: "bottleneck",
    });
  }

  /* -- Parasal olarak en pahalı istasyonlar ------------------------------ */
  // Darboğaz zaten kendi kartını aldı; burada onun dışındaki pahalı
  // istasyonlar gösterilir. En sıcak istasyon her zaman en pahalı istasyon
  // değildir ve para bilgisi varken onu görmezden gelmek olmazdı.
  const costly = (report?.stations ?? [])
    .filter((item) => !item.is_bottleneck && item.total_loss > 0)
    .slice(0, 2);

  for (const station of costly) {
    cards.push({
      id: `loss-${station.station_id}`,
      severity: "medium",
      title: `${station.station_name} para kaybettiriyor`,
      station: station.station_name,
      detail:
        "Bu istasyon darboğaz olmadığı hâlde koşum penceresinde kayda değer bir kayıp üretiyor.",
      monetaryImpact: station.total_loss,
      expectedGain:
        "Baskın kalem giderildiğinde bu tutarın büyük bölümü geri kazanılır.",
      icon: "money",
    });
  }

  /* -- Fire -------------------------------------------------------------- */
  if (totals.entered > 0) {
    const scrapRate = totals.scrapped / totals.entered;
    if (scrapRate > SCRAP_WARNING) {
      cards.push({
        id: "scrap",
        severity: scrapRate > SCRAP_WARNING * 2 ? "high" : "medium",
        title: "Fire oranı yüksek",
        station: null,
        detail: `Hatta giren parçaların ${pct(scrapRate)}'i hurdaya ayrılıyor.`,
        monetaryImpact: report?.impact.scrap_loss ?? null,
        expectedGain:
          "Kalite kontrolü darboğazın önüne almak, kısıtta harcanan kapasiteyi geri kazandırır.",
        icon: "scrap",
      });
    }

    const rejectRate = totals.rejected / totals.entered;
    if (rejectRate > REJECT_WARNING) {
      cards.push({
        id: "rejected",
        severity: "medium",
        title: "Tamponlar taşıyor",
        station: null,
        detail: `Parçaların ${pct(rejectRate)}'i tampon dolu olduğu için istasyona hiç giremiyor.`,
        monetaryImpact: null,
        expectedGain:
          "Tampon büyütmek, bu parçaların hatta girmesini sağlar; bu bir kalite değil kapasite sorunudur.",
        icon: "queue",
      });
    }
  }

  /* -- Model doğrulaması ------------------------------------------------- */
  if (!results.littles_law_validation.passed) {
    cards.push({
      id: "validation",
      severity: "medium",
      title: "Model doğrulaması geçmedi",
      station: null,
      detail: `Little Yasası kontrolü ${results.littles_law_validation.deviation_pct.toFixed(1)}% sapma gösterdi.`,
      monetaryImpact: null,
      expectedGain:
        "Sayıları karar almadan önce doğrulama raporundan kontrol edin.",
      icon: "validation",
    });
  }

  return cards
    .sort((left, right) => {
      const bySeverity =
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
      if (bySeverity !== 0) {
        return bySeverity;
      }
      return (right.monetaryImpact ?? 0) - (left.monetaryImpact ?? 0);
    })
    .slice(0, MAX_PRIORITY_CARDS);
}

/* -------------------------------------------------------------------------- */
/* İyileştirme kartları                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Baskın kayıp kalemine karşılık gelen uygulama zorluğu.
 *
 * Bu bir ölçüm değil, ürün kararıdır ve tablo hâlinde tutulması bilinçlidir:
 * tampon büyütmek bir ayar değişikliğidir (kolay), önleyici bakım plan
 * gerektirir (orta), fireyi azaltmak süreç değişikliğidir (zor). Bileşen
 * içine gömülseydi bu yargı görünmez olurdu.
 */
const DIFFICULTY_BY_COMPONENT: Record<string, Difficulty> = {
  waiting_loss: "easy",
  downtime_loss: "medium",
  opportunity_loss: "medium",
  scrap_loss: "hard",
};

/** Geri ödeme hesabında kullanılan varsayılan yatırım tutarı (₺). */
export const ASSUMED_INVESTMENT = 50000;

/**
 * Ne yapılmalı sorusunu yanıtlayan kartlar.
 *
 * Öneri metinleri finans katmanının kendi sözlüğünden gelir
 * (`report.suggestions`), burada yeni tavsiye üretilmez. Finans raporu yoksa
 * yalnızca koşumdan çıkarılabilen niteliksel öneriler gösterilir ve parasal
 * alanlar `null` kalır — uydurulmuş bir kazanç rakamı, hiç rakam
 * göstermemekten kötüdür.
 */
export function buildImprovementCards(
  results: SimulationResults | null,
  report: FinancialReport | null,
): ImprovementCard[] {
  if (!results) {
    return [];
  }

  const cards: ImprovementCard[] = [];

  // 1) Finans katmanının kendi önerileri — varsa en değerli kaynak budur.
  for (const suggestion of report?.suggestions ?? []) {
    cards.push({
      id: `suggestion-${suggestion.station_id}`,
      title: suggestion.station_name,
      description: suggestion.action,
      expectedImpact: suggestion.rationale,
      recoverableAmount: suggestion.recoverable_amount,
      difficulty: DIFFICULTY_BY_COMPONENT[suggestion.dominant_loss] ?? "medium",
      paybackDays: paybackDays(report, ASSUMED_INVESTMENT),
      station: suggestion.station_name,
    });
  }

  // 2) Finans yoksa koşumdan çıkarılabilen öneriler.
  if (cards.length === 0) {
    const bottleneck = bottleneckSummary(results);
    const totals = flowTotals(results);

    if (bottleneck && bottleneck.utilization >= BOTTLENECK_WARNING) {
      cards.push({
        id: "add-capacity",
        title: `${bottleneck.name} kapasitesini artırın`,
        description:
          "Darboğaza paralel bir makine eklemek ya da çevrim süresini kısaltmak, hattın tamamının çıktısını artıran tek müdahaledir.",
        expectedImpact: `İstasyon şu anda ${pct(bottleneck.utilization)} dolu; kısıt burada.`,
        recoverableAmount: null,
        difficulty: "medium",
        paybackDays: null,
        station: bottleneck.name,
      });
    }

    if (totals.entered > 0 && totals.scrapped / totals.entered > SCRAP_WARNING) {
      cards.push({
        id: "reduce-scrap",
        title: "Kalite kontrolü öne alın",
        description:
          "Kalite kontrolünü darboğazın önüne almak, kısıtta işlenen kusurlu parçaların tükettiği kapasiteyi geri kazandırır.",
        expectedImpact: `Hatta giren parçaların ${pct(totals.scrapped / totals.entered)}'i hurdaya ayrılıyor.`,
        recoverableAmount: null,
        difficulty: "hard",
        paybackDays: null,
        station: null,
      });
    }

    if (totals.entered > 0 && totals.rejected / totals.entered > REJECT_WARNING) {
      cards.push({
        id: "grow-buffer",
        title: "Tampon kapasitesini büyütün",
        description:
          "Tampon dolduğu için geri çevrilen parçalar hatta hiç giremiyor; tampon büyütmek bir ayar değişikliğidir.",
        expectedImpact: `Parçaların ${pct(totals.rejected / totals.entered)}'i istasyona giremiyor.`,
        recoverableAmount: null,
        difficulty: "easy",
        paybackDays: null,
        station: null,
      });
    }
  }

  // En çok geri kazandıran önce; tutarı bilinmeyenler sona.
  return cards.sort(
    (left, right) => (right.recoverableAmount ?? -1) - (left.recoverableAmount ?? -1),
  );
}
