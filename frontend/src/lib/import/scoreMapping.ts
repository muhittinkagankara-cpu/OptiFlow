/**
 * Kolon → alan eşleştirmesinin skorlanması.
 *
 * Bu sürümde **yapay zekâ kullanılmaz**; eşleştirme tümüyle kural tabanlıdır.
 * Ancak arayüz bugünden bir sağlayıcı soyutlaması üzerine kurulur
 * (`MappingSuggestionProvider`): ileride Claude, OpenAI ya da yerel bir model
 * eklendiğinde yalnızca yeni bir sağlayıcı yazılır, eşleştirme ekranı ve
 * doğrulama katmanı hiç değişmez.
 *
 * Skorlama neden kademeli
 * -----------------------
 * Tek bir eşitlik kontrolü ("başlık == alias") gerçek dosyalarda işe yaramaz:
 * başlıklar "Çevrim Süresi (dk)", "CYCLE_TIME", "Cycle Time / Takt" gibi
 * gelir. Bu yüzden önce normalize edilir, sonra sırasıyla tam eşleşme,
 * kelime eşleşmesi, alt dize ve baş harf denemesi yapılır; her biri farklı
 * bir taban puan verir.
 */

import type {
  DetectedColumn,
  FieldId,
  MappingConfidence,
  MappingSuggestion,
  OptiFlowField,
} from "./types";
import { FIELDS } from "./types";

/* -------------------------------------------------------------------------- */
/* Normalizasyon                                                               */
/* -------------------------------------------------------------------------- */

/** Türkçe harflerin ASCII karşılığı; alias listeleri ASCII yazılmıştır. */
const TURKISH_MAP: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  İ: "i",
  ö: "o",
  ş: "s",
  ü: "u",
  Ç: "c",
  Ğ: "g",
  Ö: "o",
  Ş: "s",
  Ü: "u",
};

/**
 * Başlığı karşılaştırılabilir hâle getirir.
 *
 * Küçük harfe indirger, Türkçe harfleri ASCII'ye çevirir, parantez içindeki
 * birim eklerini ("(dk)", "(min)") atar ve noktalama yerine tek boşluk koyar.
 * Birim ekinin atılması önemlidir: "Çevrim Süresi (dk)" ile "Cevrim Suresi"
 * aynı kolondur ve farklı skorlanmamalıdır.
 */
export function normalizeHeader(raw: string): string {
  const withoutUnits = raw.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  const ascii = withoutUnits.replace(/[çğıİöşüÇĞÖŞÜ]/g, (ch) => TURKISH_MAP[ch] ?? ch);
  return ascii
    .toLowerCase()
    .replace(/[_\-./\\|]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize edilmiş metnin kelimeleri. */
function words(text: string): string[] {
  return text.split(" ").filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Skorlama                                                                    */
/* -------------------------------------------------------------------------- */

/** Bu eşiğin altındaki öneriler hiç gösterilmez. */
export const MIN_SCORE = 0.3;

const HIGH_THRESHOLD = 0.8;
const MEDIUM_THRESHOLD = 0.5;

export function confidenceOf(score: number): MappingConfidence {
  if (score >= HIGH_THRESHOLD) return "high";
  if (score >= MEDIUM_THRESHOLD) return "medium";
  return "low";
}

export const CONFIDENCE_LABEL: Record<MappingConfidence, string> = {
  high: "Yüksek",
  medium: "Orta",
  low: "Düşük",
};

interface ScoreResult {
  score: number;
  reason: string;
}

/**
 * Tek bir kolonun tek bir alana ne kadar uyduğu (0-1).
 *
 * Puanlama, en güçlü sinyalden en zayıfına doğru ilk eşleşmede durur; sonra
 * kolon türü uyumu bir çarpanla uygulanır. Tür uyumu **eleyici değil,
 * azaltıcıdır**: metin görünen bir "Makine" kolonu ("2 adet") yine de aday
 * kalmalıdır, yalnızca daha düşük güvenle.
 */
export function scoreColumnForField(
  column: DetectedColumn,
  field: OptiFlowField,
): ScoreResult {
  const header = normalizeHeader(column.header);
  if (header === "") {
    return { score: 0, reason: "Başlık boş" };
  }

  const headerWords = words(header);
  let base = 0;
  let reason = "";

  for (const alias of field.aliases) {
    if (header === alias) {
      base = 1;
      reason = `Başlık "${column.header}" tam olarak eşleşti`;
      break;
    }
  }

  if (base === 0) {
    for (const alias of field.aliases) {
      const aliasWords = words(alias);
      // Alias'ın tüm kelimeleri başlıkta geçiyorsa güçlü bir eşleşmedir:
      // "cycle time" ⊂ "std cycle time sec".
      if (aliasWords.length > 0 && aliasWords.every((w) => headerWords.includes(w))) {
        const coverage = aliasWords.length / headerWords.length;
        const candidate = 0.72 + 0.18 * coverage;
        if (candidate > base) {
          base = candidate;
          reason = `"${alias}" ifadesi başlıkta geçiyor`;
        }
      }
    }
  }

  if (base === 0) {
    for (const alias of field.aliases) {
      // Kısaltmalar tek kelimedir ve alt dize aramasında yanlış eşleşme
      // üretirler ("ct" ⊂ "action"); bu yüzden yalnızca kelime olarak aranır.
      if (alias.length <= 3) {
        if (headerWords.includes(alias)) {
          const candidate = 0.68;
          if (candidate > base) {
            base = candidate;
            reason = `"${alias.toUpperCase()}" kısaltması tanındı`;
          }
        }
        continue;
      }
      if (header.includes(alias) || alias.includes(header)) {
        const shorter = Math.min(header.length, alias.length);
        const longer = Math.max(header.length, alias.length);
        const candidate = 0.45 + 0.2 * (shorter / longer);
        if (candidate > base) {
          base = candidate;
          reason = `Başlık "${alias}" ile benziyor`;
        }
      }
    }
  }

  if (base === 0) {
    return { score: 0, reason: "Eşleşme bulunamadı" };
  }

  // Tür uyumu: beklenen türle kolon türü tutuyorsa küçük bir ödül, tutmuyorsa
  // ceza. Boş kolon her zaman cezalıdır — içinde veri yoktur.
  let multiplier = 1;
  if (column.kind === "empty") {
    multiplier = 0.5;
  } else if (column.kind === field.expects) {
    multiplier = 1;
  } else {
    multiplier = 0.72;
    reason += ` (tür beklenenden farklı: ${column.kind === "number" ? "sayı" : "metin"})`;
  }

  return { score: Math.min(1, base * multiplier), reason };
}

/* -------------------------------------------------------------------------- */
/* Sağlayıcı soyutlaması                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Eşleştirme önerisi üreten kaynak.
 *
 * Bugün yalnızca `RuleBasedProvider` var. İleride bir dil modeli eklendiğinde
 * aynı arayüzü uygulayan `ClaudeProvider` / `LocalModelProvider` yazılacak;
 * `suggest` eşzamansızdır ki ağ üzerinden çalışan sağlayıcılar da bu sözleşmeye
 * sığsın — kural tabanlı sağlayıcı için beklemenin maliyeti yoktur.
 */
export interface MappingSuggestionProvider {
  /** Arayüzde gösterilecek ad. */
  readonly name: string;
  /** Kullanıcıya "bu öneriler nereden geliyor?" sorusunun yanıtı. */
  readonly description: string;
  suggest(columns: DetectedColumn[]): Promise<MappingSuggestion[]>;
}

/**
 * Kural tabanlı sağlayıcı — bu sürümün tek sağlayıcısı.
 *
 * Açgözlü (greedy) atama yapar: tüm alan-kolon çiftleri skorlanır, en yüksek
 * skordan başlanarak atanır ve atanan kolon bir daha kullanılmaz. Her alan
 * bağımsız olarak en iyi kolonunu seçseydi, iki alan aynı kolonu isteyebilir
 * ve kullanıcıya baştan çakışmalı bir eşleştirme sunulurdu.
 */
export class RuleBasedProvider implements MappingSuggestionProvider {
  readonly name = "Kural tabanlı";
  readonly description =
    "Öneriler kolon başlıklarından üretildi; yapay zekâ kullanılmadı.";

  async suggest(columns: DetectedColumn[]): Promise<MappingSuggestion[]> {
    return scoreMapping(columns);
  }
}

/**
 * Tüm alanlar için en iyi kolon önerisini üretir.
 *
 * Saf ve eşzamanlıdır; sağlayıcı arayüzü bunun üzerine ince bir sarmalayıcıdır
 * ve testler doğrudan bu işlevi çağırabilir.
 */
export function scoreMapping(columns: DetectedColumn[]): MappingSuggestion[] {
  interface Candidate {
    fieldId: FieldId;
    columnIndex: number;
    score: number;
    reason: string;
  }

  const candidates: Candidate[] = [];
  for (const field of FIELDS) {
    for (const column of columns) {
      const { score, reason } = scoreColumnForField(column, field);
      if (score >= MIN_SCORE) {
        candidates.push({
          fieldId: field.id,
          columnIndex: column.index,
          score,
          reason,
        });
      }
    }
  }

  // En yüksek skordan başla. Eşitlikte katalog sırası belirleyicidir; böylece
  // aynı dosya her açılışta aynı öneriyi verir.
  const fieldOrder = new Map(FIELDS.map((field, index) => [field.id, index]));
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      (fieldOrder.get(left.fieldId) ?? 0) - (fieldOrder.get(right.fieldId) ?? 0) ||
      left.columnIndex - right.columnIndex,
  );

  const takenFields = new Set<FieldId>();
  const takenColumns = new Set<number>();
  const chosen = new Map<FieldId, Candidate>();

  for (const candidate of candidates) {
    if (takenFields.has(candidate.fieldId) || takenColumns.has(candidate.columnIndex)) {
      continue;
    }
    takenFields.add(candidate.fieldId);
    takenColumns.add(candidate.columnIndex);
    chosen.set(candidate.fieldId, candidate);
  }

  return FIELDS.map((field) => {
    const match = chosen.get(field.id);
    if (!match) {
      return {
        fieldId: field.id,
        columnIndex: null,
        score: 0,
        confidence: "low" as MappingConfidence,
        reason: "Uygun kolon bulunamadı",
      };
    }
    return {
      fieldId: field.id,
      columnIndex: match.columnIndex,
      score: match.score,
      confidence: confidenceOf(match.score),
      reason: match.reason,
    };
  });
}

/** Önerileri, kullanıcının düzenleyebileceği eşleştirmeye çevirir. */
export function mappingFromSuggestions(
  suggestions: MappingSuggestion[],
): Record<string, number | null> {
  const mapping: Record<string, number | null> = {};
  for (const suggestion of suggestions) {
    mapping[suggestion.fieldId] = suggestion.columnIndex;
  }
  return mapping;
}
