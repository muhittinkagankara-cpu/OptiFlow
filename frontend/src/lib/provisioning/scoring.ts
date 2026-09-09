/**
 * Eşleme önerisinin güven puanı (Sihirbaz 2.0).
 *
 * SALES-15'te öneri ikili bir şeydi: ya vardı ya yoktu. Sahada bu yetmiyor —
 * `Hat1.FREZE_01.UretimSayaci` adresinden çıkarılan öneri ile `ns=2;i=1005`
 * adresinden çıkarılan öneri aynı güvenle sunulamaz.
 *
 * Puan bir olasılık değildir
 * --------------------------
 * Puan, önerinin **kaç kanıta** dayandığını söyler: makine adı adreste
 * geçiyor mu, ölçüm sözcüğü var mı, okunan değerin türü ölçüme uyuyor mu.
 * "%80 ihtimalle doğru" demek, ölçülmemiş bir sayı uydurmak olurdu; arayüzde
 * "3 kanıttan 2'si" biçiminde okunur.
 */

import type { DiscoveredTag, TagKind, TagSuggestion } from "./types";

/** Bir önerinin dayanabileceği kanıtlar. */
export type Evidence = "machine" | "metric" | "type";

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  machine: "Adreste makine adı geçiyor",
  metric: "Adreste ölçüm adı geçiyor",
  type: "Okunan değerin türü ölçüme uyuyor",
};

/** Toplam kanıt sayısı. */
export const MAX_EVIDENCE = 3;

/**
 * Önerinin sessizce uygulanabilmesi için gereken en düşük puan.
 *
 * İki kanıt: tek kanıta dayanan bir öneri (yalnızca ölçüm sözcüğü geçiyor,
 * makine adı yok) uygulanacak kadar güvenilir değildir.
 */
export const MIN_APPLY_SCORE = 2;

/** Sayısal ölçümler. */
const NUMERIC_METRICS = new Set([
  "production_count",
  "scrap_count",
  "queue_length",
  "cycle_time_seconds",
  "downtime_minutes",
  "throughput_per_hour",
  "oee",
]);

/** Metin taşıyan ölçümler. */
const TEXT_METRICS = new Set(["status"]);

/** Bir eşleme önerisi ve kanıtları. */
export interface ScoredSuggestion {
  address: string;
  machineId: string | null;
  metric: string | null;
  evidence: Evidence[];
  score: number;
  /** İki alan da doluysa doğrudan uygulanabilir. */
  complete: boolean;
}

/**
 * Okunan değerin türü ölçüme uyuyor mu?
 *
 * Türü bilinmeyen bir etiket uymuş **sayılmaz**: değer okunamadığında uyum
 * bir varsayımdır, kanıt değil.
 */
export function typeMatches(kind: TagKind, metric: string | null): boolean {
  if (metric === null) return false;
  if (kind === "unknown") return false;
  if (NUMERIC_METRICS.has(metric)) return kind === "counter" || kind === "gauge";
  if (TEXT_METRICS.has(metric)) return kind === "text" || kind === "boolean";
  return false;
}

/**
 * Bir etiket için öneri ve kanıtları.
 *
 * Makine ve ölçüm **sunucudan** gelir; tarayıcıda yeniden türetilseydi iki
 * taraf zamanla ayrışır ve ekrandaki öneri kaydedilenden farklı olurdu.
 * Burada eklenen tek kanıt, okunan değerin türüyle ölçümün uyumudur.
 */
export function scoreSuggestion(
  tag: DiscoveredTag,
  suggestion: TagSuggestion | undefined,
): ScoredSuggestion {
  const machineId = suggestion?.machineId ?? null;
  const metric = suggestion?.metric ?? null;

  const evidence: Evidence[] = [];
  if (machineId !== null) evidence.push("machine");
  if (metric !== null) evidence.push("metric");
  if (typeMatches(tag.kind, metric)) evidence.push("type");

  return {
    address: tag.address,
    machineId,
    metric,
    evidence,
    score: evidence.length,
    complete: machineId !== null && metric !== null,
  };
}

/**
 * Bütün etiketleri puanlar.
 *
 * Önerisi olmayan etiket **atlanmaz**: sıfır puanlı bir öneri, kullanıcıya
 * "bu adresten hiçbir şey çıkarılamadı" der. Listeden düşseydi, kullanıcı o
 * etiketin unutulduğunu sanırdı.
 */
export function scoreAll(
  tags: DiscoveredTag[],
  suggestions: TagSuggestion[],
): ScoredSuggestion[] {
  const byAddress = new Map(suggestions.map((item) => [item.address, item]));
  return tags.map((tag) => scoreSuggestion(tag, byAddress.get(tag.address)));
}

/**
 * Puanın rozet tonu.
 *
 * Üç kanıtlı öneri yeşil, iki kanıtlı sarı, azı nötr. Tek kanıtlı bir öneriyi
 * yeşil göstermek, kullanıcının onu incelemeden kabul etmesine yol açardı.
 */
export function scoreTone(score: number): "good" | "warning" | "neutral" {
  if (score >= MAX_EVIDENCE) return "good";
  if (score >= MIN_APPLY_SCORE) return "warning";
  return "neutral";
}

/**
 * Puanın ekrandaki metni.
 *
 * Kesir olarak yazılır ("2/3 kanıt"); yüzde yazılsaydı, bir olasılık gibi
 * okunurdu.
 */
export function scoreLabel(score: number): string {
  return `${score}/${MAX_EVIDENCE} kanıt`;
}

/**
 * Önerinin neden uygulanamadığı; uygulanabiliyorsa `null`.
 *
 * Sessiz kalmak, düğmenin bozuk olduğu izlenimini verirdi.
 */
export function blockedReason(suggestion: ScoredSuggestion): string | null {
  if (suggestion.machineId === null && suggestion.metric === null) {
    return "Adresten ne makine ne de ölçüm çıkarılabildi";
  }
  if (suggestion.machineId === null) {
    return "Makine adı adresten çıkarılamadı";
  }
  if (suggestion.metric === null) {
    return "Ölçüm adı adresten çıkarılamadı";
  }
  if (suggestion.score < MIN_APPLY_SCORE) {
    return "Tek kanıta dayanıyor; elle onaylayın";
  }
  return null;
}
