/**
 * Command Center özet göstergelerinin türetilmesi.
 *
 * Buradaki işlevlerin tamamı saftır ve **hiçbir yeni ölçüm üretmez**: hepsi
 * simülasyonun zaten döndürdüğü alanları (`throughput_per_minute`, `line_oee`,
 * istasyon metrikleri) ve finans katmanının zaten hesapladığı tutarları
 * biçimlendirir. Yeni bir matematik eklenmemesi bilinçlidir — özet ekranı,
 * ayrıntı ekranlarıyla aynı sayıyı göstermek zorundadır; kendi hesabını
 * yapsaydı iki ekran sessizce ayrışırdı.
 *
 * Eksik veri sıfır değildir
 * -------------------------
 * Bir gösterge hesaplanamıyorsa (koşum yok, maliyet oranı girilmedi) değeri
 * `null` döner ve arayüz bunu "—" olarak gösterip kullanıcıyı eksik adıma
 * yönlendirir. Uydurulmuş bir rakam göstermek, kullanıcının onu kendi verisi
 * sanması demek olurdu; bu kural ürünün geri kalanında da geçerlidir
 * (bkz. `finance/loss_engine.py`).
 */

import type {
  FinancialReport,
  SimulationResults,
} from "../types/simulationTypes";

/** Tek vardiyanın dakikası. Günlük projeksiyonun açıkça belirtilen varsayımı. */
export const SHIFT_MINUTES = 480;

/** Aylık projeksiyon için çalışma günü sayısı. */
export const WORKING_DAYS_PER_MONTH = 22;

/**
 * Bir vardiyada üretilmesi beklenen birim sayısı.
 *
 * Varsayım (tek vardiya) çağıranın gösterdiği ipucu metninde açıkça yazılır;
 * gizli bir varsayımla üretilen "günlük üretim" rakamı yanıltıcı olurdu.
 */
export function dailyThroughput(
  results: SimulationResults | null,
  shiftMinutes: number = SHIFT_MINUTES,
): number | null {
  if (!results || shiftMinutes <= 0) {
    return null;
  }
  return results.throughput_per_minute * shiftMinutes;
}

/**
 * Hattın teorik kapasitesinin ne kadarının kullanıldığı (0-1).
 *
 * Gerçek bir "geçen haftaya göre" karşılaştırması yapılamaz — geçmiş koşumlar
 * arasında bir zaman serisi tutulmuyor. Onun yerine anlamı kesin olan bir oran
 * gösterilir: bugünkü çıktı, aynı modelin teorik üst sınırının yüzde kaçı?
 */
export function capacityShare(results: SimulationResults | null): number | null {
  if (!results || results.theoretical_max_throughput_per_minute <= 0) {
    return null;
  }
  return (
    results.throughput_per_minute / results.theoretical_max_throughput_per_minute
  );
}

/** Darboğaz istasyonunun adı ve doluluğu. */
export function bottleneckSummary(
  results: SimulationResults | null,
): { name: string; utilization: number } | null {
  if (!results) {
    return null;
  }
  const station = results.station_metrics.find(
    (item) => item.station_id === results.bottleneck_station_id,
  );
  if (!station) {
    return null;
  }
  return { name: station.station_name, utilization: station.utilization };
}

/**
 * Aylık kayıp projeksiyonu.
 *
 * Finans raporundaki **günlük** kaybı çalışma günü sayısıyla çarpar. Günlük
 * kayıp yalnızca kullanıcı günlük üretim süresini girdiğinde hesaplanır; o
 * alan boşken burada da `null` döner ve zincir hiçbir yerde uydurma bir
 * varsayımla tamamlanmaz.
 */
export function monthlyLoss(
  report: FinancialReport | null,
  workingDays: number = WORKING_DAYS_PER_MONTH,
): number | null {
  if (!report || report.daily_loss === null || report.daily_loss === undefined) {
    return null;
  }
  return report.daily_loss * workingDays;
}

/**
 * Aylık geri kazanılabilir tutar ("potansiyel kazanç").
 *
 * Kurtarılabilir kayıp, pencere toplamının bir parçasıdır; aylığa çevirmek
 * için günlük kayıpla aynı oran kullanılır. Oran, iki tutarın aynı pencereden
 * gelmesi sayesinde tutarlıdır — kurtarılabilir kısım ayrıca ölçeklenmez.
 */
export function monthlyRecoverable(
  report: FinancialReport | null,
  workingDays: number = WORKING_DAYS_PER_MONTH,
): number | null {
  const monthly = monthlyLoss(report, workingDays);
  if (monthly === null || report === null || report.impact.total_loss <= 0) {
    return null;
  }
  const share = report.recoverable_loss / report.impact.total_loss;
  return monthly * share;
}

/** Yatırımın kendini amorti etme süresi (gün). */
export function paybackDays(
  report: FinancialReport | null,
  investment: number,
): number | null {
  if (
    !report ||
    investment <= 0 ||
    report.daily_loss === null ||
    report.daily_loss === undefined
  ) {
    return null;
  }
  const dailyRecoverable =
    report.impact.total_loss > 0
      ? report.daily_loss * (report.recoverable_loss / report.impact.total_loss)
      : 0;
  if (dailyRecoverable <= 0) {
    return null;
  }
  return investment / dailyRecoverable;
}

/**
 * Kayıp kalemlerinin büyükten küçüğe sıralanmış hâli (Pareto).
 *
 * Yalnızca hesaplanabilmiş kalemler girer: maliyet oranı verilmediği için
 * hesaplanamayan bir kalem, sıfır tutarlı bir çubuk olarak çizilseydi
 * "burada kayıp yok" diye okunurdu.
 */
export function paretoOfComponents(
  report: FinancialReport | null,
): { name: string; label: string; amount: number; cumulativeShare: number }[] {
  if (!report) {
    return [];
  }
  const available = report.impact.components
    .filter((item) => item.is_available && item.amount > 0)
    .sort((left, right) => right.amount - left.amount);

  const total = available.reduce((sum, item) => sum + item.amount, 0);
  if (total <= 0) {
    return [];
  }

  let running = 0;
  return available.map((item) => {
    running += item.amount;
    return {
      name: item.name,
      label: item.label,
      amount: item.amount,
      cumulativeShare: running / total,
    };
  });
}

/**
 * Command Center'ın "AI Morning Brief" kartındaki üç cümle.
 *
 * Bu sprintte **gerçek bir model çağrılmaz**; metinler tümüyle eldeki
 * simülasyon ve finans verisinden türetilir. Kartın yer tutucu olduğu
 * arayüzde açıkça belirtilir — üretilmiş bir cümleyi model çıktısı gibi
 * sunmak, kullanıcının ona olduğundan fazla güvenmesine yol açardı.
 */
export interface BriefLine {
  label: string;
  value: string;
}

export function morningBrief(
  results: SimulationResults | null,
  report: FinancialReport | null,
): { headline: string; lines: BriefLine[] } {
  const bottleneck = bottleneckSummary(results);

  if (!results) {
    return {
      headline:
        "Henüz bir koşum yok. Bir model kurup çalıştırdığınızda günlük özetiniz burada oluşur.",
      lines: [
        { label: "En kritik istasyon", value: "Koşum bekleniyor" },
        { label: "Bugünkü öneri", value: "Yeni bir model kurun" },
        { label: "Risk", value: "Değerlendirilmedi" },
      ],
    };
  }

  const headline = bottleneck
    ? `Bugünkü en büyük darboğaz ${bottleneck.name} istasyonunda; hattın çıktısını bu istasyon belirliyor.`
    : "Hattınızda belirgin bir darboğaz görünmüyor; kısıt büyük olasılıkla talep tarafında.";

  const topLoss = report?.stations.find((item) => item.total_loss > 0);
  const suggestion = report?.suggestions[0];

  /*
   * "En kritik istasyon" iki farklı şeyden gelebilir ve hangisinin
   * kullanıldığı önemlidir: maliyet oranları girilmişse **en çok para
   * kaybettiren** istasyon, girilmemişse **darboğaz**. En sıcak istasyon her
   * zaman en pahalı istasyon değildir; para bilgisi varken onu kullanmamak,
   * elde olan daha iyi cevabı görmezden gelmek olurdu.
   */
  const criticalStation = topLoss?.station_name ?? bottleneck?.name ?? null;

  return {
    headline,
    lines: [
      {
        label: "En kritik istasyon",
        value: criticalStation ?? "Belirlenemedi",
      },
      {
        label: "Bugünkü öneri",
        value: suggestion
          ? suggestion.action.split(":")[0]
          : bottleneck
            ? `${bottleneck.name} kapasitesini artırın`
            : "Talep tarafını inceleyin",
      },
      {
        label: "Risk",
        value: results.is_stable
          ? "Hat kararlı"
          : "Hat kararsız — kuyruklar büyüyor",
      },
    ],
  };
}
