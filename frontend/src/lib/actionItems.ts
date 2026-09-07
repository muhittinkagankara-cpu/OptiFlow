/**
 * "Bugün Yapılacaklar" — öncelik kartlarının türetilmesi.
 *
 * Bu modül **hiçbir yeni ölçüm üretmez**. Simülasyonun döndürdüğü alanları
 * (kararlılık, darboğaz doluluğu, akış sayıları), finans raporunu ve envanter
 * analizini okur; her birinin zaten taşıdığı eşikleri kullanarak bunları
 * sıralanmış bir eylem listesine çevirir.
 *
 * Neden ayrı bir modül
 * --------------------
 * Öncelik kuralları bir ürün kararıdır: "hangi durum kırmızı, hangisi turuncu"
 * sorusu zamanla değişir ve tek tek denenmesi gerekir. Bileşenin içine
 * gömülseydi, on beş kuralın kesişimini gözle doğrulamak gerekirdi; burada her
 * kural tek başına sınanabilir.
 *
 * Uydurma yok
 * -----------
 * Bir veri kaynağı yoksa ona ait kural hiç üretilmez. Örneğin maliyet oranları
 * girilmemişse "şu kadar para kaybediyorsunuz" diyen bir kart çıkmaz; bunun
 * yerine oranları girmeye çağıran bilgilendirici bir kart çıkar. Eksik veri,
 * sıfır değildir.
 */

import type {
  FinancialReport,
  InventoryAnalysis,
  SimulationResults,
} from "../types/simulationTypes";

/** Kartın rengini ve sırasını belirleyen aciliyet. */
export type ActionPriority = "critical" | "warning" | "info";

/** Kartın kullanıcıyı götüreceği bölüm. */
export type ActionTarget =
  | "simulation"
  | "finance"
  | "inventory"
  | "factories"
  | "live";

export interface ActionItem {
  id: string;
  priority: ActionPriority;
  title: string;
  detail: string;
  target: ActionTarget;
  actionLabel: string;
}

/**
 * Darboğazın "kritik" sayıldığı doluluk.
 *
 * Backend'in `CRITICAL_UTILIZATION` eşiğiyle (0.85) aynı yerden okunamıyor —
 * o değer Python tarafında yaşıyor. Burada aynı sayı bilinçli olarak
 * yinelenmiştir ve neden yinelendiği yazılmıştır: arayüzün uyarı eşiği ile
 * motorun kısıt sınıflandırması aynı noktada olmalıdır, aksi hâlde "kısıt
 * dışarıda" diyen bir koşum için arayüz "darboğaz kritik" diye bağırırdı.
 */
export const BOTTLENECK_WARNING = 0.85;

/** Bu değerin üzerinde darboğaz artık uyarı değil, acil bir sorundur. */
export const BOTTLENECK_CRITICAL = 0.95;

/** Fire oranının kabul edilebilir üst sınırı. */
export const SCRAP_WARNING = 0.05;

/** Tampon dolduğu için geri çevrilen parça oranının üst sınırı. */
export const REJECT_WARNING = 0.05;

const PRIORITY_ORDER: Record<ActionPriority, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export interface ActionInputs {
  results: SimulationResults | null;
  report: FinancialReport | null;
  /** Envanter analizleri; henüz yüklenmediyse `null`. */
  analyses: InventoryAnalysis[] | null;
  factoryCount: number;
}

/**
 * Toplam akış sayıları.
 *
 * Fire ve ret oranları hat genelinde ölçülür: tek bir istasyonun yüksek fire
 * oranı, o istasyondan çok az parça geçiyorsa hattın sorunu değildir.
 */
export function flowTotals(results: SimulationResults): {
  entered: number;
  scrapped: number;
  rejected: number;
} {
  return results.station_metrics.reduce(
    (sum, station) => ({
      entered: sum.entered + station.flow.entered,
      scrapped: sum.scrapped + station.flow.scrapped,
      rejected: sum.rejected + station.flow.rejected,
    }),
    { entered: 0, scrapped: 0, rejected: 0 },
  );
}

/**
 * Öncelik kartlarını üretir.
 *
 * Sıralama önce aciliyete, sonra üretilme sırasına göredir; aynı aciliyetteki
 * kartların birbirine göre yeri, kuralların bu dosyadaki sırasıyla belirlenir
 * ve rastgele değildir.
 */
export function buildActionItems({
  results,
  report,
  analyses,
  factoryCount,
}: ActionInputs): ActionItem[] {
  const items: ActionItem[] = [];

  /* -- Simülasyondan gelenler ------------------------------------------- */
  if (results) {
    if (!results.is_stable) {
      items.push({
        id: "unstable",
        priority: "critical",
        title: "Hat kararsız",
        detail:
          "Kuyruklar koşum boyunca büyümeye devam ediyor: talep, hattın kapasitesini aşıyor. Bu modelin uzun vadeli çıktısı güvenilir değildir.",
        target: "simulation",
        actionLabel: "Modeli aç",
      });
    }

    const bottleneck = results.station_metrics.find(
      (station) => station.station_id === results.bottleneck_station_id,
    );
    if (bottleneck) {
      const percent = Math.round(bottleneck.utilization * 100);
      if (bottleneck.utilization >= BOTTLENECK_CRITICAL) {
        items.push({
          id: "bottleneck-critical",
          priority: "critical",
          title: `${bottleneck.station_name} tıkanma noktasında`,
          detail: `İstasyon zamanının %${percent}'ini işlem yaparak geçiriyor. Bu seviyede küçük bir aksama bile hattın tamamını durdurur.`,
          target: "live",
          actionLabel: "Akışı izle",
        });
      } else if (bottleneck.utilization >= BOTTLENECK_WARNING) {
        items.push({
          id: "bottleneck-warning",
          priority: "warning",
          title: `${bottleneck.station_name} hattı sınırlıyor`,
          detail: `Hattın çıktısını bu istasyon belirliyor (%${percent} doluluk). Kapasite eklenecekse ilk buraya bakılmalı.`,
          target: "live",
          actionLabel: "Akışı izle",
        });
      }
    }

    const totals = flowTotals(results);
    if (totals.entered > 0) {
      const scrapRate = totals.scrapped / totals.entered;
      if (scrapRate > SCRAP_WARNING) {
        items.push({
          id: "scrap",
          priority: "warning",
          title: "Fire oranı yüksek",
          detail: `Hatta giren parçaların %${Math.round(scrapRate * 100)}'i hurdaya ayrılıyor. Kalite kontrolü darboğazın önüne almak, kısıtta harcanan kapasiteyi geri kazandırır.`,
          target: "simulation",
          actionLabel: "İstasyonları incele",
        });
      }

      const rejectRate = totals.rejected / totals.entered;
      if (rejectRate > REJECT_WARNING) {
        items.push({
          id: "rejected",
          priority: "warning",
          title: "Tamponlar taşıyor",
          detail: `Parçaların %${Math.round(rejectRate * 100)}'i tampon dolu olduğu için istasyona hiç giremiyor. Bu bir kalite sorunu değil, kapasite/tampon sorunudur.`,
          target: "simulation",
          actionLabel: "Tamponları gözden geçir",
        });
      }
    }

    if (!results.littles_law_validation.passed) {
      items.push({
        id: "littles-law",
        priority: "warning",
        title: "Model doğrulaması geçmedi",
        detail:
          "Little Yasası kontrolü sapma gösterdi; koşum sonuçları beklenen iç tutarlılığı sağlamıyor. Sayıları karar almadan önce doğrulama raporundan kontrol edin.",
        target: "simulation",
        actionLabel: "Raporu aç",
      });
    }
  }

  /* -- Envanterden gelenler --------------------------------------------- */
  if (analyses) {
    const applicable = analyses.filter((item) => item.is_applicable);

    const uncovered = applicable.filter((item) => !item.covers_lead_time);
    if (uncovered.length > 0) {
      items.push({
        id: "stock-uncovered",
        priority: "critical",
        title:
          uncovered.length === 1
            ? `${uncovered[0].item_name} tedarik süresini karşılamıyor`
            : `${uncovered.length} kalem tedarik süresini karşılamıyor`,
        detail:
          "Sipariş bugün verilse bile mal gelene kadar stok bitiyor; duruş kaçınılmaz. Hızlandırılmış tedarik ya da geçici ikame gerekir.",
        target: "inventory",
        actionLabel: "Envanteri aç",
      });
    }

    const critical = applicable.filter(
      (item) => item.status === "critical" && item.covers_lead_time,
    );
    if (critical.length > 0) {
      items.push({
        id: "stock-critical",
        priority: "critical",
        title:
          critical.length === 1
            ? `${critical[0].item_name} sipariş noktasının altında`
            : `${critical.length} kalem sipariş noktasının altında`,
        detail:
          "Stok yeniden sipariş noktasının altına indi. Bugün sipariş verilirse duruş yaşanmadan karşılanabilir.",
        target: "inventory",
        actionLabel: "Sipariş planla",
      });
    }

    const warning = applicable.filter((item) => item.status === "warning");
    if (warning.length > 0) {
      items.push({
        id: "stock-warning",
        priority: "warning",
        title:
          warning.length === 1
            ? `${warning[0].item_name} sipariş noktasına yaklaşıyor`
            : `${warning.length} kalem sipariş noktasına yaklaşıyor`,
        detail:
          "Bu kalemler için sipariş penceresi açılmak üzere. Şimdi planlamak, acele tedarikin ek maliyetinden kurtarır.",
        target: "inventory",
        actionLabel: "Envanteri aç",
      });
    }
  }

  /* -- Eksik girdiler (bilgilendirici) ----------------------------------- */
  if (results && !report) {
    items.push({
      id: "no-rates",
      priority: "info",
      title: "Maliyet oranlarınızı girin",
      detail:
        "Kayıplarınızın parasal karşılığı ancak makine, işçilik ve fire oranlarıyla hesaplanabilir. Oranlar sunucuda saklanmaz.",
      target: "finance",
      actionLabel: "Finans'a git",
    });
  }

  if (!results) {
    items.push({
      id: "no-run",
      priority: "info",
      title: "İlk koşumunuzu çalıştırın",
      detail:
        "Bir model kurup çalıştırdığınızda darboğaz, kayıp ve kapasite analizleri bu ekranda toplanır.",
      target: "simulation",
      actionLabel: "Simülasyona git",
    });
  }

  if (factoryCount === 0) {
    items.push({
      id: "no-factory",
      priority: "info",
      title: "Modelinizi kaydedin",
      detail:
        "Kaydedilen model sürümlenir ve her cihazınızdan açılır; koşum sonuçları hangi sürümden geldiğini taşır.",
      target: "factories",
      actionLabel: "Fabrikalar",
    });
  }

  return items.sort(
    (left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority],
  );
}

/** Aciliyete göre sayım; başlıktaki özet rozetini besler. */
export function countByPriority(
  items: ActionItem[],
): Record<ActionPriority, number> {
  return items.reduce(
    (counts, item) => ({ ...counts, [item.priority]: counts[item.priority] + 1 }),
    { critical: 0, warning: 0, info: 0 },
  );
}
