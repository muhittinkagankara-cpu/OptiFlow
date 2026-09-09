/**
 * Kural tabanlı Copilot — varsayılan sağlayıcı.
 *
 * Hiçbir uca istek atmaz, API anahtarı istemez ve internet bağlantısı
 * gerektirmez. Yanıtları, bağlamdaki olgulardan cümle kurarak üretir.
 *
 * Bu bir "sahte AI" değildir; ürünün zaten yaptığı analizleri (finans, ısı
 * haritası, doğrulama, canlı üretim) tek bir soru-cevap yüzeyine taşır. Dil
 * modeli eklendiğinde bu sağlayıcı **kaybolmaz**: modelin çalışmadığı,
 * kotanın dolduğu ya da müşterinin veri paylaşmak istemediği durumlarda
 * yedek olarak kalır.
 *
 * Cümlelerin içindeki her sayı bağlamdan gelir; `guards.ts` bunu ayrıca
 * doğrular. Uydurma bir rakam üretmek teknik olarak mümkün değildir.
 */

import { displayOf, factOf, sectionOf } from "./context";
import { NO_DATA_MESSAGE, confidenceOf, guardAnswer, noDataAnswer } from "./guards";
import {
  SOURCE_LABEL,
  SOURCE_VIEW,
  type ActionCard,
  type ContextSource,
  type CopilotAnswer,
  type CopilotProvider,
  type CopilotRequest,
  type FactoryContext,
  type ProviderHealth,
} from "./types";

/** Soruların ayrıldığı niyetler. */
export type Intent =
  | "bottleneck"
  | "loss"
  | "investment"
  | "scrap"
  | "validation"
  | "live"
  | "inventory"
  | "connectors"
  | "summary";

/**
 * Niyet anahtar kelimeleri.
 *
 * Sıra önemlidir: bir soru birden çok listeye uyarsa ilk sıradaki kazanır.
 * "Fire neden arttı?" hem "neden" hem "fire" içerir; fire listesi önce gelir
 * çünkü asıl konu odur.
 */
const INTENT_KEYWORDS: { intent: Intent; words: string[] }[] = [
  { intent: "scrap", words: ["fire", "hurda", "iskarta", "kalite"] },
  {
    intent: "bottleneck",
    words: ["darboğaz", "darbogaz", "tıkanık", "yavaş", "kısıt", "bottleneck"],
  },
  {
    intent: "investment",
    words: ["yatırım", "yatirim", "hangi istasyona", "nereye harcama", "öncelik"],
  },
  {
    intent: "loss",
    words: ["kayıp", "kayip", "para", "maliyet", "zarar", "kâr", "kar kaybı"],
  },
  {
    intent: "validation",
    words: ["doğruluk", "dogruluk", "uyum", "model ne kadar", "gerçek veri", "sapma"],
  },
  { intent: "live", words: ["canlı", "canli", "şu an", "alarm", "kuyruk"] },
  { intent: "inventory", words: ["stok", "envanter", "malzeme", "tedarik"] },
  {
    intent: "connectors",
    words: ["bağlantı", "baglanti", "veri akışı", "opc", "mqtt", "sensör"],
  },
];

/** Sorunun hangi konuya baktığı; eşleşme yoksa genel özet. */
export function detectIntent(question: string): Intent {
  const text = question.toLocaleLowerCase("tr-TR");
  for (const entry of INTENT_KEYWORDS) {
    if (entry.words.some((word) => text.includes(word))) {
      return entry.intent;
    }
  }
  return "summary";
}

/** Bir katmana götüren eylem kartı. */
export function actionFor(source: ContextSource, reason: string): ActionCard {
  const labels: Partial<Record<ContextSource, string>> = {
    finance: "Finans'a git",
    heatmap: "Isı haritasını aç",
    validation: "Doğrulamayı aç",
    live: "Canlı üretime git",
    inventory: "Envanteri aç",
    crm: "Satış hattını aç",
    connectors: "Bağlantıları aç",
    simulation: "Sonuçları aç",
  };
  return {
    id: `action-${source}`,
    label: labels[source] ?? SOURCE_LABEL[source],
    view: SOURCE_VIEW[source],
    reason,
  };
}

/* -------------------------------------------------------------------------- */
/* Yanıt kurucular                                                             */
/* -------------------------------------------------------------------------- */

interface Draft {
  sentences: string[];
  reasons: string[];
  actions: ActionCard[];
  sources: ContextSource[];
}

function emptyDraft(): Draft {
  return { sentences: [], reasons: [], actions: [], sources: [] };
}

function finish(draft: Draft, context: FactoryContext): CopilotAnswer {
  if (draft.sentences.length === 0) {
    return noDataAnswer(context, missingFor(draft.sources, context), draft.actions);
  }
  return guardAnswer(
    {
      text: draft.sentences.join(" "),
      reasons: draft.reasons,
      actions: draft.actions,
      confidence: confidenceOf(draft.sources, context),
      sources: draft.sources,
    },
    context,
  );
}

/** Yanıtın kullanmak isteyip de bulamadığı katmanlar. */
function missingFor(
  wanted: ContextSource[],
  context: FactoryContext,
): ContextSource[] {
  const sources = wanted.length > 0 ? wanted : (["simulation", "finance"] as ContextSource[]);
  return sources.filter((source) => !sectionOf(context, source).available);
}

function markSource(draft: Draft, source: ContextSource): void {
  if (!draft.sources.includes(source)) {
    draft.sources.push(source);
  }
}

/* --- Darboğaz --- */

function answerBottleneck(context: FactoryContext): CopilotAnswer {
  const draft = emptyDraft();
  const name = displayOf(context, "bottleneck_name");
  const utilization = displayOf(context, "bottleneck_utilization");

  if (name === null) {
    return noDataAnswer(context, ["simulation"], [actionFor("simulation", "Bir koşum alındığında darboğaz burada görünür.")]);
  }

  markSource(draft, "simulation");
  draft.sentences.push(
    `Hattın darboğazı ${name} istasyonu; doluluğu ${utilization ?? "—"}.`,
  );
  draft.reasons.push(
    `Simülasyon sonucunda darboğaz olarak ${name} işaretlendi (doluluk ${utilization ?? "—"}).`,
  );

  const hottest = displayOf(context, "hottest_station");
  const driver = displayOf(context, "hottest_driver");
  if (hottest !== null) {
    markSource(draft, "heatmap");
    if (hottest === name) {
      draft.sentences.push(
        `Isı haritası da aynı istasyonu en sıcak gösteriyor${driver === null ? "" : `; ısıyı en çok büyüten bileşen ${driver.toLocaleLowerCase("tr-TR")}`}.`,
      );
      draft.reasons.push(
        "Isı haritasının en sıcak istasyonu ile darboğaz aynı; iki bağımsız ölçüt aynı yeri işaret ediyor.",
      );
    } else {
      draft.sentences.push(
        `Isı haritasında en sıcak istasyon ise ${hottest}; darboğaz ile ısı farklı yerlerde, bu yüzden ikisine ayrı bakmak gerekir.`,
      );
      draft.reasons.push(
        `Darboğaz ${name}, en sıcak istasyon ${hottest} — kısıt ile en çok kaybettiren istasyon her zaman aynı olmaz.`,
      );
    }
    draft.actions.push(
      actionFor("heatmap", "İstasyonların ısı bileşenlerini ayrıntılı görmek için."),
    );
  }

  const lossStation = displayOf(context, "top_loss_station");
  const lossAmount = displayOf(context, "top_loss_amount");
  if (lossStation !== null && lossAmount !== null) {
    markSource(draft, "finance");
    draft.sentences.push(
      `Parasal olarak en çok kaybettiren istasyon ${lossStation} ve bu istasyonun kaybı ${lossAmount}.`,
    );
    draft.reasons.push(
      `Finans katmanı ${lossStation} istasyonunun kaybını ${lossAmount} olarak hesapladı.`,
    );
    draft.actions.push(actionFor("finance", "Kayıp kalemlerinin dökümü için."));
  }

  draft.actions.push(
    actionFor("live", "Darboğazın şu anki kuyruğunu canlı görmek için."),
  );
  return finish(draft, context);
}

/* --- Kayıp --- */

function answerLoss(context: FactoryContext): CopilotAnswer {
  const draft = emptyDraft();
  const total = displayOf(context, "total_loss");

  if (total === null) {
    return noDataAnswer(
      context,
      ["finance"],
      [actionFor("finance", "Maliyet oranlarını girdiğinizde kayıp hesaplanır.")],
    );
  }

  markSource(draft, "finance");
  const monthly = displayOf(context, "monthly_loss");
  const dominantLabel = displayOf(context, "dominant_loss_label");
  const dominantAmount = displayOf(context, "dominant_loss_amount");
  const recoverable = displayOf(context, "recoverable_loss");
  const completeness = displayOf(context, "data_completeness");

  draft.sentences.push(`Ölçüm penceresindeki toplam kayıp ${total}.`);
  if (monthly !== null) {
    draft.sentences.push(`Aynı hızla devam ederse aylık projeksiyon ${monthly}.`);
  }
  if (dominantLabel !== null && dominantAmount !== null) {
    draft.sentences.push(
      `Kaybın en büyük kalemi ${dominantLabel.toLocaleLowerCase("tr-TR")} ve tutarı ${dominantAmount}.`,
    );
    draft.reasons.push(
      `Ölçülebilen kayıp bileşenleri arasında en büyüğü ${dominantLabel} (${dominantAmount}).`,
    );
  }
  if (recoverable !== null) {
    draft.sentences.push(`Bunun ${recoverable} kadarı iyileştirmeyle geri kazanılabilir.`);
    draft.reasons.push(
      `Finans katmanı kurtarılabilir payı ${recoverable} olarak hesapladı.`,
    );
  }
  if (completeness !== null) {
    draft.reasons.push(
      `Bu rakamlar ${completeness} veri doluluğuyla hesaplandı; girilmemiş maliyet oranları kayba dâhil edilmedi.`,
    );
  }

  const missingInputs = displayOf(context, "missing_inputs");
  if (missingInputs !== null) {
    draft.sentences.push(
      `Şu oranlar girilmediği için ilgili kalemler hesaba katılmadı: ${missingInputs}.`,
    );
  }

  draft.actions.push(actionFor("finance", "Kayıp dökümünü ve varsayımları görmek için."));

  const hottest = displayOf(context, "hottest_station");
  if (hottest !== null) {
    markSource(draft, "heatmap");
    draft.actions.push(
      actionFor("heatmap", `Kaybın yoğunlaştığı ${hottest} istasyonunu incelemek için.`),
    );
  }

  return finish(draft, context);
}

/* --- Yatırım önceliği --- */

function answerInvestment(context: FactoryContext): CopilotAnswer {
  const draft = emptyDraft();
  const station = displayOf(context, "top_loss_station");
  const amount = displayOf(context, "top_loss_amount");
  const suggestion = displayOf(context, "top_suggestion_action");
  const suggestionAmount = displayOf(context, "top_suggestion_amount");

  if (station === null && suggestion === null) {
    return noDataAnswer(
      context,
      ["finance", "heatmap"],
      [actionFor("finance", "Kayıp hesaplandığında yatırım önceliği çıkarılabilir.")],
    );
  }

  markSource(draft, "finance");

  if (station !== null && amount !== null) {
    draft.sentences.push(
      `Önce ${station} istasyonuna bakın: parasal kaybın en büyüğü orada ve tutarı ${amount}.`,
    );
    draft.reasons.push(
      `${station}, finans katmanında en yüksek kayıplı istasyon (${amount}).`,
    );
  }

  if (suggestion !== null) {
    draft.sentences.push(`Finans katmanının önerisi: ${suggestion}`);
    if (suggestionAmount !== null) {
      draft.sentences.push(`Bu adımın geri kazandıracağı tutar ${suggestionAmount}.`);
      draft.reasons.push(
        `Önerinin kurtarabileceği tutar ${suggestionAmount} olarak hesaplandı.`,
      );
    }
  }

  const bottleneck = displayOf(context, "bottleneck_name");
  if (bottleneck !== null) {
    markSource(draft, "simulation");
    if (bottleneck === station) {
      draft.sentences.push(
        `Aynı istasyon hattın darboğazı olduğu için buradaki kapasite artışı doğrudan çıktıya yansır.`,
      );
      draft.reasons.push(
        "Kısıt ile en yüksek kayıp aynı istasyonda; kapasite yatırımının etkisi burada en yüksektir.",
      );
    } else {
      draft.sentences.push(
        `Hattın darboğazı ${bottleneck}; kapasite eklemenin çıktıya yansıması için önce oradaki kısıt açılmalıdır.`,
      );
      draft.reasons.push(
        `Darboğaz ${bottleneck} olduğu için başka bir istasyona eklenen kapasite çıktıyı artırmayabilir.`,
      );
    }
  }

  const accuracy = displayOf(context, "model_accuracy");
  if (accuracy !== null) {
    markSource(draft, "validation");
    draft.sentences.push(
      `Bu öneri, sahayla ${accuracy} uyumlu ölçülen bir modele dayanıyor.`,
    );
    draft.reasons.push(
      `Model doğruluğu ${accuracy}; yatırım kararında bu oranın altındaki bir modele güvenilmemelidir.`,
    );
    draft.actions.push(actionFor("validation", "Modelin doğruluğunu görmek için."));
  }

  draft.actions.push(actionFor("finance", "Kayıp dökümünü görmek için."));
  return finish(draft, context);
}

/* --- Fire --- */

function answerScrap(context: FactoryContext): CopilotAnswer {
  const draft = emptyDraft();
  const station = displayOf(context, "worst_scrap_station");
  const ratio = displayOf(context, "worst_scrap_ratio");

  if (station === null) {
    return noDataAnswer(
      context,
      ["simulation"],
      [actionFor("simulation", "Koşum alındığında istasyon bazlı fire oranları çıkar.")],
    );
  }

  markSource(draft, "simulation");
  draft.sentences.push(
    `Fire oranı en yüksek istasyon ${station} ve oranı ${ratio ?? "—"}.`,
  );
  draft.reasons.push(
    `Koşumda ${station} istasyonunun hurda/giren oranı ${ratio ?? "—"} çıktı.`,
  );

  const dominantLabel = displayOf(context, "dominant_loss_label");
  const dominantAmount = displayOf(context, "dominant_loss_amount");
  if (dominantLabel !== null && dominantLabel.toLocaleLowerCase("tr-TR").includes("fire")) {
    markSource(draft, "finance");
    draft.sentences.push(
      `Fire aynı zamanda en büyük kayıp kalemi: ${dominantAmount ?? "—"}.`,
    );
    draft.reasons.push(`Finans katmanında en büyük kalem ${dominantLabel}.`);
  }

  const validationGap = displayOf(context, "biggest_gap");
  const worstAccuracy = displayOf(context, "worst_accuracy_station");
  if (validationGap !== null && worstAccuracy !== null) {
    markSource(draft, "validation");
    draft.sentences.push(
      `Doğrulamada modelden en çok sapan istasyon ${worstAccuracy} ve en büyük sapma ${validationGap}; artışın modelde mi sahada mı olduğunu buradan ayırabilirsiniz.`,
    );
    draft.reasons.push(
      `Doğrulama katmanı ${worstAccuracy} istasyonunda ${validationGap} sapma ölçtü.`,
    );
    draft.actions.push(
      actionFor("validation", "Ölçülen fire ile modeldeki fireyi karşılaştırmak için."),
    );
  }

  draft.actions.push(actionFor("heatmap", "Fire kaynaklı ısıyı görmek için."));
  return finish(draft, context);
}

/* --- Doğrulama --- */

function answerValidation(context: FactoryContext): CopilotAnswer {
  const draft = emptyDraft();
  const accuracy = displayOf(context, "model_accuracy");

  if (accuracy === null) {
    return noDataAnswer(
      context,
      ["validation"],
      [actionFor("validation", "Gerçek üretim verisini girdiğinizde doğruluk ölçülür.")],
    );
  }

  markSource(draft, "validation");
  const measured = displayOf(context, "measured_stations");
  const confidence = displayOf(context, "validation_confidence");
  const worst = displayOf(context, "worst_accuracy_station");

  draft.sentences.push(`Model sahayla ${accuracy} uyumlu ölçüldü.`);
  if (measured !== null) {
    draft.sentences.push(`Ölçüm ${measured} istasyonu kapsıyor.`);
    draft.reasons.push(`Doğruluk ${measured} istasyonun ölçümünden hesaplandı.`);
  }
  if (confidence !== null) {
    draft.sentences.push(`Güven skoru ${confidence}.`);
    draft.reasons.push(
      `Güven skoru ${confidence}; kapsam ve ölçüm süresi bu skoru belirler.`,
    );
  }
  if (worst !== null) {
    draft.sentences.push(`Modelden en çok sapan istasyon ${worst}.`);
  }

  draft.actions.push(actionFor("validation", "Sapma tablosunu görmek için."));
  return finish(draft, context);
}

/* --- Canlı üretim --- */

function answerLive(context: FactoryContext): CopilotAnswer {
  const draft = emptyDraft();
  const running = displayOf(context, "live_running");

  if (running === null) {
    return noDataAnswer(
      context,
      ["live"],
      [actionFor("live", "Canlı akışı başlattığınızda anlık durum burada özetlenir.")],
    );
  }

  markSource(draft, "live");
  const queue = displayOf(context, "live_queue");
  const alarms = displayOf(context, "live_open_alarms");
  const critical = displayOf(context, "live_critical_alarm");

  draft.sentences.push(`Şu an ${running} istasyon çalışıyor.`);
  if (queue !== null) {
    draft.sentences.push(`Hatta bekleyen parça sayısı ${queue}.`);
  }
  if (alarms !== null) {
    draft.sentences.push(`Açık alarm sayısı ${alarms}.`);
    draft.reasons.push(`Canlı akıştaki açık alarm sayısı ${alarms}.`);
  }
  if (critical !== null) {
    draft.sentences.push(`Kritik alarm: ${critical}`);
    draft.reasons.push("Açık bir kritik alarm var; önce onun giderilmesi gerekir.");
  }

  draft.actions.push(actionFor("live", "Canlı üretim merkezini açmak için."));
  return finish(draft, context);
}

/* --- Envanter --- */

function answerInventory(context: FactoryContext): CopilotAnswer {
  const draft = emptyDraft();
  const items = displayOf(context, "inventory_items");

  if (items === null) {
    return noDataAnswer(
      context,
      ["inventory"],
      [actionFor("inventory", "Envanter kalemlerini girdiğinizde analiz çıkar.")],
    );
  }

  markSource(draft, "inventory");
  const critical = displayOf(context, "inventory_critical");
  const worstItem = displayOf(context, "inventory_worst_item");
  const worstDays = displayOf(context, "inventory_worst_days");

  draft.sentences.push(`Envanterde ${items} kalem analiz edildi.`);
  if (critical !== null) {
    draft.sentences.push(`Bunlardan ${critical} tanesi kritik seviyede.`);
    draft.reasons.push(`Kritik seviyedeki kalem sayısı ${critical}.`);
  }
  if (worstItem !== null && worstDays !== null) {
    draft.sentences.push(`Stoku ilk bitecek kalem ${worstItem}; kalan süre ${worstDays}.`);
    draft.reasons.push(`${worstItem} için kalan stok süresi ${worstDays}.`);
  }

  draft.actions.push(actionFor("inventory", "Sipariş noktalarını görmek için."));
  return finish(draft, context);
}

/* --- Bağlantılar --- */

function answerConnectors(context: FactoryContext): CopilotAnswer {
  const draft = emptyDraft();
  const connected = displayOf(context, "connector_connected");

  if (connected === null) {
    return noDataAnswer(
      context,
      ["connectors"],
      [actionFor("connectors", "Bir bağlantı tanımladığınızda durumu burada özetlenir.")],
    );
  }

  markSource(draft, "connectors");
  const failed = displayOf(context, "connector_failed");
  const errors = displayOf(context, "connector_sync_errors");
  const latency = displayOf(context, "connector_latency");

  draft.sentences.push(`${connected} veri kaynağı bağlı.`);
  if (failed !== null && failed !== "0") {
    draft.sentences.push(`${failed} kaynak kopuk durumda.`);
    draft.reasons.push(`Kopuk kaynak sayısı ${failed}; bu kaynaklardan veri gelmiyor.`);
  }
  if (errors !== null && errors !== "0") {
    draft.sentences.push(`Oturum boyunca ${errors} senkron hatası oluştu.`);
  }
  if (latency !== null) {
    draft.sentences.push(`Ortalama gecikme ${latency}.`);
  }

  draft.actions.push(actionFor("connectors", "Bağlayıcı merkezini açmak için."));
  return finish(draft, context);
}

/* --- Genel özet --- */

function answerSummary(context: FactoryContext): CopilotAnswer {
  const draft = emptyDraft();

  const bottleneck = displayOf(context, "bottleneck_name");
  if (bottleneck !== null) {
    markSource(draft, "simulation");
    const oee = displayOf(context, "line_oee");
    draft.sentences.push(
      `Hattın darboğazı ${bottleneck}${oee === null ? "" : `, hat OEE'si ${oee}`}.`,
    );
    draft.reasons.push(`Son koşumda darboğaz ${bottleneck} olarak işaretlendi.`);
  }

  const monthly = displayOf(context, "monthly_loss");
  const total = displayOf(context, "total_loss");
  if (monthly !== null || total !== null) {
    markSource(draft, "finance");
    draft.sentences.push(
      monthly !== null
        ? `Aylık kayıp projeksiyonu ${monthly}.`
        : `Pencere içi toplam kayıp ${total}.`,
    );
    draft.reasons.push("Kayıp rakamı finans katmanının hesabından geliyor.");
    draft.actions.push(actionFor("finance", "Kayıp dökümü için."));
  }

  const accuracy = displayOf(context, "model_accuracy");
  if (accuracy !== null) {
    markSource(draft, "validation");
    draft.sentences.push(`Model sahayla ${accuracy} uyumlu.`);
    draft.actions.push(actionFor("validation", "Doğrulama ayrıntısı için."));
  }

  const alarms = displayOf(context, "live_open_alarms");
  if (alarms !== null && alarms !== "0") {
    markSource(draft, "live");
    draft.sentences.push(`Canlı hatta ${alarms} açık alarm var.`);
    draft.actions.push(actionFor("live", "Alarm merkezini açmak için."));
  }

  if (draft.sentences.length === 0) {
    return noDataAnswer(context, ["simulation", "finance"], [
      actionFor("simulation", "Bir simülasyon çalıştırdığınızda özet burada çıkar."),
    ]);
  }

  draft.reasons.push(
    "Bu özet yalnızca ölçülmüş katmanlardan kuruldu; eksik katmanlar cümleye girmedi.",
  );
  return finish(draft, context);
}

/* -------------------------------------------------------------------------- */

/** Soruyu yanıta çevirir. Saf işlev; sağlayıcı bunu sarar. */
export function answerQuestion(
  question: string,
  context: FactoryContext,
): CopilotAnswer {
  switch (detectIntent(question)) {
    case "bottleneck":
      return answerBottleneck(context);
    case "loss":
      return answerLoss(context);
    case "investment":
      return answerInvestment(context);
    case "scrap":
      return answerScrap(context);
    case "validation":
      return answerValidation(context);
    case "live":
      return answerLive(context);
    case "inventory":
      return answerInventory(context);
    case "connectors":
      return answerConnectors(context);
    case "summary":
      return answerSummary(context);
  }
}

/**
 * Varsayılan sağlayıcı.
 *
 * `generate` eşzamanlı çalışır ama sözleşme gereği söz (promise) döndürür:
 * yarın ağ üzerinden çalışan bir sağlayıcı eklendiğinde çağıran kod değişmez.
 */
export class RuleBasedProvider implements CopilotProvider {
  readonly id = "rule-based";
  readonly name = "Yerel kural motoru";
  readonly description =
    "Yanıtlar bu cihazda, ürünün kendi ölçümlerinden üretilir; hiçbir veri dışarı çıkmaz.";
  readonly isAvailable = true;
  readonly requiresApiKey = false;

  private lastLatencyMs: number | null = null;

  async generate(request: CopilotRequest): Promise<CopilotAnswer> {
    /*
     * Gecikme gerçekten ölçülür — sabit bir sayı yazmak sağlık panosunu süs
     * hâline getirirdi. Duvar saati değil `performance.now()` kullanılır:
     * ölçülen şey geçen süredir, günün saati değil.
     */
    const started = performance.now();
    const answer = answerQuestion(request.question, request.context);
    this.lastLatencyMs = Math.round((performance.now() - started) * 100) / 100;
    return answer;
  }

  health(): ProviderHealth {
    return {
      status: "ready",
      latencyMs: this.lastLatencyMs,
      detail: "Yerel motor çalışıyor; ağ bağlantısı gerekmiyor.",
    };
  }

  quota(): null {
    // Yerel motorun kendi kotası yoktur; ürün kotası ayrı işler (`quota.ts`).
    return null;
  }
}

/** Yanıtı olmayan bir soru için ortak metin. */
export const FALLBACK_TEXT = NO_DATA_MESSAGE;

/**
 * Boş bir olgu araması yapıp yapmadığını sınamak için dışa açılır.
 *
 * Testler bu yardımcıyla, kural motorunun bağlamda olmayan bir anahtarı
 * kullanmadığını doğrular.
 */
export function usesFact(context: FactoryContext, key: string): boolean {
  return factOf(context, key) !== null;
}
