/**
 * Yönetici özeti ve sebep zinciri — koşumun anlatıya çevrilmesi.
 *
 * İki işlev de saftır ve yalnızca backend alanlarını okur. Cümleler şablondur;
 * içlerine yerleştirilen her sayı ölçülmüş bir değerdir ve hiçbiri
 * yuvarlanarak abartılmaz.
 *
 * Kısıt nerede?
 * -------------
 * Anlatının yönü, kısıtın **içeride** (kapasite) mi **dışarıda** (talep) mi
 * olduğuna göre değişir. Motorun kendi eşiği (`BOTTLENECK_WARNING`, 0.85)
 * yeniden kullanılır: darboğaz bu eşiğin altındaysa hattı sınırlayan şey iç
 * kapasite değildir ve "kapasite ekleyin" demek yanlış bir tavsiye olurdu.
 */

import type {
  FinancialReport,
  SimulationResults,
} from "../../types/simulationTypes";
import { BOTTLENECK_WARNING, flowTotals } from "../actionItems";
import { capacityShare, bottleneckSummary } from "../dashboardMetrics";
import type { CauseLink, ExecutiveSummary } from "./types";

/** Yüzdeyi tam sayı olarak yazar. */
function pct(value: number): string {
  return `%${Math.round(value * 100)}`;
}

/**
 * Fabrikanın bugünkü durumunu tek cümlede anlatır.
 *
 * Öncelik sırası bilinçlidir: kararsız bir hat, darboğazdan da fireden de
 * önemlidir çünkü o modelin uzun vadeli çıktısı zaten güvenilir değildir.
 * Sonra iç kapasite kısıtı, sonra dış kısıt gelir.
 */
export function buildExecutiveSummary(
  results: SimulationResults | null,
  report: FinancialReport | null,
): ExecutiveSummary {
  if (!results) {
    return {
      headline: "Henüz bir koşum yok.",
      detail:
        "Bir model kurup çalıştırdığınızda fabrikanızın durumu burada tek cümlede özetlenir.",
      tone: "good",
      focusStation: null,
    };
  }

  const bottleneck = bottleneckSummary(results);
  const capacity = capacityShare(results);
  // Teorik sınırın ne kadarının kullanılamadığı. İki backend alanının farkıdır;
  // yeni bir hesap değildir.
  const lostShare = capacity === null ? null : Math.max(0, 1 - capacity);

  if (!results.is_stable) {
    return {
      headline: bottleneck
        ? `${bottleneck.name} istasyonu talebi karşılayamıyor ve kuyruklar sürekli büyüyor.`
        : "Hattınız gelen talebi karşılayamıyor ve kuyruklar sürekli büyüyor.",
      detail:
        "Bu koşumda hat kararsız: bekleyen iş miktarı zamanla artıyor. Kapasite artırılmadan uzun vadeli çıktı tahmini güvenilir değildir.",
      tone: "critical",
      focusStation: bottleneck?.name ?? null,
    };
  }

  if (bottleneck && bottleneck.utilization >= BOTTLENECK_WARNING) {
    const lossText =
      lostShare === null
        ? "teorik kapasitenin bir bölümü kullanılamıyor"
        : `günlük kapasitenin ${pct(lostShare)}'i kullanılamıyor`;

    return {
      headline: `${bottleneck.name} üretimi sınırlandırıyor ve ${lossText}.`,
      detail: `İstasyon zamanının ${pct(bottleneck.utilization)}'ini işlem yaparak geçiriyor. Hattın çıktısını belirleyen kısıt burasıdır; başka bir istasyonu hızlandırmak toplam çıktıyı değiştirmez.`,
      tone: bottleneck.utilization >= 0.95 ? "critical" : "high",
      focusStation: bottleneck.name,
    };
  }

  // Buraya gelindiyse kısıt içeride değil: hiçbir istasyon dolu değil ve hat
  // kararlı. Bu durumda "kapasite ekleyin" demek, olmayan bir sorunu çözmeye
  // çağırmak olurdu.
  const topLoss = report?.stations.find((item) => item.total_loss > 0);
  if (topLoss) {
    return {
      headline: `Hattınız talebi rahat karşılıyor; en büyük kayıp ${topLoss.station_name} istasyonunda.`,
      detail:
        "Hiçbir istasyon kapasite sınırında değil — sistemi sınırlayan şey iç kapasite değil, gelen talep. Bu durumda kazanç kapasiteden değil, kayıpları azaltmaktan gelir.",
      tone: "medium",
      focusStation: topLoss.station_name,
    };
  }

  return {
    headline: "Hattınız talebi rahat karşılıyor; belirgin bir darboğaz yok.",
    detail:
      lostShare === null
        ? "Hiçbir istasyon kapasite sınırında değil. Sistemi sınırlayan şey iç kapasite değil, gelen talep."
        : `Hiçbir istasyon kapasite sınırında değil ve teorik kapasitenin ${pct(1 - lostShare)}'i kullanılıyor. Sistemi sınırlayan şey iç kapasite değil, gelen talep.`,
    tone: "good",
    focusStation: bottleneck?.name ?? null,
  };
}

/**
 * Sorunun nasıl oluştuğunu adım adım gösterir.
 *
 * Zincir tek bir şablon değildir: kısıt içerideyse "yüksek kullanım → kuyruk →
 * bekleme → düşük çıktı → kayıp" yolu izlenir; kısıt dışarıdaysa aynı zincir
 * yanlış olurdu ve bunun yerine boş kapasite anlatılır.
 *
 * Her adım, o adımı **kanıtlayan** ölçülmüş bir değer taşır. Değer olmadan
 * bir neden-sonuç zinciri göstermek, kullanıcıdan gerekçesiz inanç istemek
 * olurdu.
 */
export function buildCauseChain(
  results: SimulationResults | null,
  report: FinancialReport | null,
): CauseLink[] {
  if (!results) {
    return [];
  }

  const bottleneck = bottleneckSummary(results);
  const capacity = capacityShare(results);
  const totals = flowTotals(results);

  const worstQueue = [...results.station_metrics].sort(
    (left, right) => right.avg_queue_length - left.avg_queue_length,
  )[0];

  const isCapacityConstrained =
    bottleneck !== null && bottleneck.utilization >= BOTTLENECK_WARNING;

  if (!isCapacityConstrained) {
    // Dış kısıt: istasyonlar boş bekliyor, sorun kapasitede değil.
    const scrapRate = totals.entered > 0 ? totals.scrapped / totals.entered : 0;
    return [
      {
        id: "demand",
        label: "Talep kapasitenin altında",
        measure: bottleneck ? `${pct(bottleneck.utilization)} doluluk` : null,
        detail:
          "En dolu istasyon bile kapasite sınırının altında çalışıyor; hattı sınırlayan şey gelen iş miktarı.",
      },
      {
        id: "idle",
        label: "İstasyonlar boş bekliyor",
        measure:
          capacity === null ? null : `teorik kapasitenin ${pct(capacity)}'i kullanılıyor`,
        detail:
          "Kullanılmayan kapasite bir kayıp değildir; yalnızca hattın daha fazlasını üretebileceği anlamına gelir.",
      },
      {
        id: "quality",
        label: "Kalan kayıp kalite ve duruştan geliyor",
        measure: totals.entered > 0 ? `${pct(scrapRate)} fire` : null,
        detail:
          "Kapasite kısıtı olmadığında iyileştirme kapasiteden değil, hurdayı ve arızayı azaltmaktan gelir.",
      },
    ];
  }

  const chain: CauseLink[] = [
    {
      id: "utilization",
      label: "Yüksek kullanım",
      measure: bottleneck ? `${pct(bottleneck.utilization)} doluluk` : null,
      detail: `${bottleneck?.name ?? "Darboğaz istasyonu"} zamanının neredeyse tamamını işlem yaparak geçiriyor; toparlanma payı kalmıyor.`,
    },
    {
      id: "queue",
      label: "Kuyruk artıyor",
      measure: worstQueue
        ? `${worstQueue.avg_queue_length.toFixed(1)} parça (${worstQueue.station_name})`
        : null,
      detail:
        "İstasyon gelen işi yetiştiremediğinde önünde bekleyen parça sayısı büyür.",
    },
    {
      id: "waiting",
      label: "Bekleme oluşuyor",
      measure: worstQueue ? `${worstQueue.avg_wait_time.toFixed(1)} dk bekleme` : null,
      detail:
        "Kuyrukta geçen her dakika, parçanın hattı terk etmesini geciktirir ve akış süresini uzatır.",
    },
    {
      id: "throughput",
      label: "Üretim düşüyor",
      measure:
        capacity === null
          ? null
          : `teorik kapasitenin ${pct(capacity)}'i kullanılıyor`,
      detail:
        "Hat, en dar halkasından daha hızlı akamaz; kayıp kapasite doğrudan üretilmeyen birime dönüşür.",
    },
  ];

  // Son halka yalnızca parasal karşılığı biliniyorsa eklenir: "kayıp oluşuyor"
  // deyip tutar gösterememek, zincirin en önemli adımını boş bırakmak olurdu.
  if (report && report.impact.total_loss > 0) {
    chain.push({
      id: "loss",
      label: "Kayıp oluşuyor",
      measure: `${Math.round(report.impact.total_loss).toLocaleString("tr-TR")} ₺ (koşum penceresi)`,
      detail:
        "Üretilemeyen birim, katkı payı üzerinden parasal bir kayba dönüşür; arıza ve bekleme de bu tutara eklenir.",
    });
  } else {
    chain.push({
      id: "loss-unknown",
      label: "Kayıp oluşuyor",
      measure: null,
      detail:
        "Bu kaybın parasal karşılığını görmek için Finans ekranında maliyet oranlarınızı girin.",
    });
  }

  return chain;
}
