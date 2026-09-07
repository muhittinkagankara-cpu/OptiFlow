/**
 * Sağlık radarı ve önce/sonra karşılaştırması.
 *
 * Altı eksenin tamamı backend alanlarının **yeniden düzenlenmesiyle** elde
 * edilir: oranlar, farklar ve kırpmalar. Yeni bir mühendislik hesabı yoktur.
 * Her eksen 0-100'e normalize edilir ve **yüksek = iyi** yönündedir; bazı
 * eksenlerin ham değeri tersine çalıştığı için (fire arttıkça kötüleşir)
 * çevrim burada tek yerde yapılır — bileşende yapılsaydı iki eksen yanlışlıkla
 * ters yönde çizilebilirdi.
 */

import type {
  FinancialReport,
  SimulationResults,
} from "../../types/simulationTypes";
import { flowTotals } from "../actionItems";
import { capacityShare } from "../dashboardMetrics";
import { utilizationSpread } from "../factoryHealth";
import type { ComparisonRow, RadarAxis } from "./types";

/** 0-100 aralığına kırpar ve tam sayıya yuvarlar. */
function score(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value * 100)));
}

/**
 * Parçanın ömrünün ne kadarını beklemekle geçirdiği (0-1).
 *
 * Seri bir hatta akış süresi ≈ toplam işlem + toplam bekleme olduğundan,
 * istasyon beklemelerinin toplamı akış süresine bölünerek bekleme payı
 * bulunur. İki backend alanının bölümüdür; yeni bir model değildir.
 *
 * Akış süresi sıfır ya da tanımsızsa `null` döner — sıfıra bölüp "beklemesiz
 * hat" demek yanıltıcı olurdu.
 */
export function waitShare(results: SimulationResults): number | null {
  if (results.avg_flow_time <= 0) {
    return null;
  }
  const totalWait = results.station_metrics.reduce(
    (sum, station) => sum + station.avg_wait_time,
    0,
  );
  return Math.min(1, totalWait / results.avg_flow_time);
}

/**
 * Altı eksenli sağlık radarı.
 *
 * Koşum yoksa boş dizi döner; sıfırlarla dolu bir radar, hattın her yönden
 * kötü olduğu izlenimini verirdi.
 */
export function buildRadarData(results: SimulationResults | null): RadarAxis[] {
  if (!results) {
    return [];
  }

  const axes: RadarAxis[] = [];

  axes.push({
    axis: "OEE",
    score: score(results.line_oee),
    basis: "Hat geneli ekipman etkinliği (kullanılabilirlik × performans × kalite).",
  });

  /*
   * Kararlılık sürekli bir ölçü değildir; motor "kararlı / kararsız" der ve
   * ayrıca bir doğrulama sonucu döner. Bu iki ikili sinyal sıralı bir skora
   * çevrilir — ara değerler uydurulmaz, üç basamak vardır ve gerekçesi
   * `basis` alanında yazar.
   */
  const stabilityScore = !results.is_stable
    ? 25
    : results.littles_law_validation.passed
      ? 100
      : 65;
  axes.push({
    axis: "Kararlılık",
    score: stabilityScore,
    basis: results.is_stable
      ? results.littles_law_validation.passed
        ? "Hat kararlı ve Little Yasası doğrulaması geçti."
        : "Hat kararlı ama doğrulama sapma gösterdi."
      : "Hat kararsız: kuyruklar büyümeye devam ediyor.",
  });

  const spread = utilizationSpread(results);
  axes.push({
    axis: "Denge",
    // Tek istasyonlu hatta fark tanımsızdır; o durumda hat tanım gereği
    // dengelidir.
    score: spread === null ? 100 : score(1 - spread),
    basis:
      spread === null
        ? "Tek istasyonlu hat; denge farkı tanımsız."
        : `En dolu ve en boş istasyon arasında %${Math.round(spread * 100)} fark var.`,
  });

  const totals = flowTotals(results);
  const scrapRate = totals.entered > 0 ? totals.scrapped / totals.entered : 0;
  axes.push({
    axis: "Hurda",
    // Ters yönlü: fire arttıkça skor düşer.
    score: score(1 - scrapRate),
    basis:
      totals.entered > 0
        ? `Hatta giren parçaların %${(scrapRate * 100).toFixed(1)}'i hurdaya ayrılıyor.`
        : "Akış verisi yok.",
  });

  const waiting = waitShare(results);
  axes.push({
    axis: "Kuyruk",
    score: waiting === null ? 100 : score(1 - waiting),
    basis:
      waiting === null
        ? "Akış süresi ölçülemedi."
        : `Parçanın hattaki ömrünün %${Math.round(waiting * 100)}'i beklemekle geçiyor.`,
  });

  const capacity = capacityShare(results);
  axes.push({
    axis: "Kapasite",
    score: capacity === null ? 0 : score(capacity),
    basis:
      capacity === null
        ? "Teorik kapasite bilinmiyor."
        : `Teorik kapasitenin %${Math.round(capacity * 100)}'i kullanılıyor.`,
  });

  return axes;
}

/* -------------------------------------------------------------------------- */
/* Önce / sonra                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Mevcut değerleri **gözlenmiş** referanslarla karşılaştırır.
 *
 * Buradaki "hedef" bir tahmin ya da vaat değildir; her biri backend'in
 * döndürdüğü bir sayıdır:
 *
 * * OEE hedefi — aynı koşumdaki **en iyi istasyonun** OEE'si. Hattın kendi
 *   içinde ulaşılmış bir değerdir, dolayısıyla ulaşılabilirliği tartışmasızdır.
 * * Kapasite hedefi — teorik üst sınır (1.0). Tanım gereği aşılamaz.
 * * Kayıp hedefi — toplam kayıp eksi finans katmanının **kurtarılabilir**
 *   dediği tutar. Backend'in kendi hesabıdır.
 *
 * Uydurulmuş bir "%20 iyileşme" hedefi gösterilseydi, kullanıcı onu bir söz
 * olarak okurdu.
 */
export function buildComparison(
  results: SimulationResults | null,
  report: FinancialReport | null,
): ComparisonRow[] {
  if (!results) {
    return [];
  }

  const rows: ComparisonRow[] = [];

  const bestStation = [...results.station_metrics].sort(
    (left, right) => right.oee.oee - left.oee.oee,
  )[0];

  if (bestStation && bestStation.oee.oee > results.line_oee) {
    rows.push({
      id: "oee",
      label: "Hat OEE",
      current: results.line_oee,
      target: bestStation.oee.oee,
      format: "percent",
      targetSource: `Hedef, aynı koşumda ölçülen en iyi istasyonun (${bestStation.station_name}) OEE değeridir.`,
    });
  }

  const capacity = capacityShare(results);
  if (capacity !== null && capacity < 1) {
    rows.push({
      id: "capacity",
      label: "Kapasite kullanımı",
      current: capacity,
      target: 1,
      format: "percent",
      targetSource:
        "Hedef, modelin teorik üst sınırıdır; kuyruk ve arıza olmadan ulaşılabilecek en yüksek değerdir.",
    });
  }

  if (report && report.impact.total_loss > 0) {
    rows.push({
      id: "loss",
      label: "Koşum penceresi kaybı",
      current: report.impact.total_loss,
      // Kurtarılabilir tutar giderildiğinde kalan kayıp.
      target: Math.max(0, report.impact.total_loss - report.recoverable_loss),
      format: "money",
      targetSource:
        "Hedef, finans katmanının “kurtarılabilir” dediği tutar giderildiğinde kalan kayıptır. Fire bu tutara dâhil değildir.",
    });
  }

  return rows;
}
