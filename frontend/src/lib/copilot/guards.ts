/**
 * Korumalar — Copilot'un uydurmasını engelleyen katman.
 *
 * Bir dil modelinin en tehlikeli yanı, bilmediği bir sayıyı **inandırıcı**
 * biçimde söylemesidir. Üretim planlaması yapan bir yöneticiye "aylık kaybınız
 * ₺240.000" diyen bir cümle, sayı uydurulmuşsa ürünü değil şirketi yanıltır.
 *
 * Bu yüzden buradaki kural katıdır: **yanıt metnindeki her sayı, bağlamda bir
 * olgu olarak bulunmak zorundadır.** Kural tabanlı sağlayıcı zaten cümlelerini
 * olgulardan kurar; koruma, yarın bir dil modeli eklendiğinde onun çıktısını da
 * aynı ölçüye vurmak içindir.
 *
 * Veri yoksa uydurulmaz, açıkça söylenir (`NO_DATA_MESSAGE`).
 */

import { allFacts, availableSources, contextCompleteness } from "./context";
import type {
  AnswerConfidence,
  ContextSource,
  CopilotAnswer,
  FactoryContext,
} from "./types";

/** Veri bulunamadığında verilecek tek cümle. */
export const NO_DATA_MESSAGE = "Bu konuda yeterli veri bulunamadı.";

/**
 * Metinden sayısal belirteçleri çıkarır.
 *
 * Ondalık ayracı virgül ya da nokta olabilir; binlik ayracı atılır. "₺178.772"
 * ve "%84,5" gibi biçimlenmiş değerler de bu süzgeçten geçer.
 */
export function numericTokens(text: string): string[] {
  const matches = text.match(/\d[\d.,]*/g) ?? [];
  return (
    matches
      /*
       * Cümle sonundaki nokta sayıya yapışır ("₺240.000.") ve ayrıştırmayı
       * bozar. Bozulan sayı sessizce atılsaydı — ki ilk yazımda öyle oluyordu —
       * cümle sonundaki her uydurma rakam korumadan kaçardı.
       */
      .map((raw) => normalizeNumber(raw.replace(/[.,]+$/, "")))
      .filter((token) => token !== "")
  );
}

/**
 * Sayıyı karşılaştırılabilir bir biçime indirger.
 *
 * "178.772" ile "178772", "%84,5" ile "84,5" aynı sayıdır. Binlik ayracının
 * nokta, ondalık ayracının virgül olduğu Türkçe biçim esas alınır; noktadan
 * sonra üç basamak varsa binlik sayılır.
 */
export function normalizeNumber(raw: string): string {
  let text = raw.trim().replace(/[^\d.,]/g, "");
  if (text === "") {
    return "";
  }

  // Virgül varsa ondalık ayracıdır; noktalar binliktir.
  if (text.includes(",")) {
    const [whole, fraction = ""] = text.split(",");
    text = `${whole.replace(/\./g, "")}.${fraction}`;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  }

  const value = Number(text);
  if (!Number.isFinite(value)) {
    return "";
  }
  // Sondaki sıfırlar atılır: "42,0" ile "42" aynı sayıdır.
  return String(Number(value.toFixed(4)));
}

/**
 * Bağlamda geçen tüm sayıların kümesi.
 *
 * Hem gösterim değerlerinden (biçimlenmiş) hem sayısal alanlardan toplanır:
 * yanıt "%84" da yazabilir, "0,84" da.
 */
export function groundedNumbers(context: FactoryContext): Set<string> {
  const grounded = new Set<string>();

  for (const item of allFacts(context)) {
    for (const token of numericTokens(item.display)) {
      grounded.add(token);
    }
    if (item.numeric !== null) {
      grounded.add(normalizeNumber(String(item.numeric)));
      // Oranlar cümlede yüzde olarak geçer.
      grounded.add(normalizeNumber(String(Math.round(item.numeric * 100))));
      grounded.add(normalizeNumber((item.numeric * 100).toFixed(1)));
      grounded.add(normalizeNumber(String(Math.round(item.numeric))));
    }
  }

  return grounded;
}

/**
 * Metindeki dayanaksız sayılar.
 *
 * Boş dizi, metnin tamamının bağlamdan geldiğini gösterir.
 */
export function ungroundedNumbers(
  text: string,
  context: FactoryContext,
): string[] {
  const grounded = groundedNumbers(context);
  return numericTokens(text).filter((token) => !grounded.has(token));
}

/** Metindeki her sayı bağlamdan mı geliyor? */
export function isGrounded(text: string, context: FactoryContext): boolean {
  return ungroundedNumbers(text, context).length === 0;
}

/**
 * Güven etiketi.
 *
 * Üç şeye bakar: yanıtın kaç katmandan beslendiği, bağlamın ne kadar dolu
 * olduğu ve hiç kaynak olup olmadığı. Tek bir katmandan kurulmuş bir cümle,
 * doğru olsa bile "yüksek güven" etiketini hak etmez.
 */
export function confidenceOf(
  usedSources: ContextSource[],
  context: FactoryContext,
): AnswerConfidence {
  if (usedSources.length === 0) {
    return "none";
  }
  const completeness = contextCompleteness(context);
  if (usedSources.length >= 3 && completeness >= 0.6) {
    return "high";
  }
  if (usedSources.length >= 2 || completeness >= 0.5) {
    return "medium";
  }
  return "low";
}

/**
 * Yanıtı korumadan geçirir.
 *
 * Dayanaksız bir sayı bulunursa yanıt **verilmez**: metin "veri bulunamadı"ya
 * indirilir ve gerekçesi yazılır. Sessizce düzeltmek ya da sayıyı silmek,
 * hatanın fark edilmemesine yol açardı.
 */
export function guardAnswer(
  answer: CopilotAnswer,
  context: FactoryContext,
): CopilotAnswer {
  const ungrounded = ungroundedNumbers(answer.text, context);
  if (ungrounded.length === 0) {
    return answer;
  }

  return {
    text: `${NO_DATA_MESSAGE} Üretilen yanıt, ölçülmemiş bir sayı içerdiği için gösterilmedi.`,
    reasons: [
      `Yanıtta bağlamda karşılığı olmayan değer(ler) vardı: ${ungrounded.join(", ")}.`,
      "Copilot yalnızca ürünün ölçtüğü sayıları kullanır; ölçülmemiş bir değeri tahmin etmez.",
    ],
    actions: answer.actions,
    confidence: "none",
    sources: [],
  };
}

/**
 * Veri yokluğunda verilecek hazır yanıt.
 *
 * Eksik katmanın nedeni cümleye yazılır: "veri yok" demek yetmez, kullanıcı ne
 * yaparsa verinin geleceğini bilmelidir.
 */
export function noDataAnswer(
  context: FactoryContext,
  missingSources: ContextSource[],
  actions: CopilotAnswer["actions"] = [],
): CopilotAnswer {
  const reasons = missingSources.map((source) => {
    const section = context.sections.find((item) => item.source === source);
    return (
      section?.missingReason ?? "Bu katmandan henüz veri alınmadı."
    );
  });

  return {
    text: NO_DATA_MESSAGE,
    reasons: reasons.length > 0 ? reasons : ["Bağlamda hiçbir ölçüm yok."],
    actions,
    confidence: "none",
    sources: [],
  };
}

/** Bağlamda hiç ölçüm var mı? */
export function hasAnyData(context: FactoryContext): boolean {
  return availableSources(context).length > 0;
}
