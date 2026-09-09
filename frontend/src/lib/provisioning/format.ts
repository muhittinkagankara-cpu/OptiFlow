/**
 * Devreye alma ekranının metinleri.
 *
 * Keşif başarısızsa neden başarısız olduğu yazılır; "cihaz bulunamadı" gibi
 * kapalı bir cümle, kullanıcının sorunu (yanlış adres mi, kapalı port mu,
 * kimlik hatası mı) anlamasını engellerdi.
 */

import { NOT_MEASURED } from "../telemetry/format";
import {
  PROVISIONING_STEP_LABEL,
  type CredentialTest,
  type DiscoveredTag,
  type DiscoveryResult,
  type ProvisioningStep,
} from "./types";

export { NOT_MEASURED };

export function stepLabel(step: ProvisioningStep): string {
  return PROVISIONING_STEP_LABEL[step];
}

/** Gecikmeyi milisaniye olarak yazar; ölçülmemişse "—". */
export function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) return NOT_MEASURED;
  return `${Math.round(latencyMs)} ms`;
}

/**
 * Etiketin okunan değeri.
 *
 * Okunamamışsa "—" yazılır. Boş bırakılsaydı, değeri olmayan bir düğümle
 * değeri boş metin olan bir düğüm aynı görünürdü.
 */
export function tagValue(tag: DiscoveredTag): string {
  if (tag.value === null) return NOT_MEASURED;
  if (typeof tag.value === "boolean") return tag.value ? "Açık" : "Kapalı";
  if (typeof tag.value === "number") {
    return tag.value.toLocaleString("tr-TR", { maximumFractionDigits: 3 });
  }
  return tag.value;
}

/**
 * Keşfin özet cümlesi.
 *
 * Başarısızlıkta sunucunun yazdığı neden olduğu gibi gösterilir; başarıda kaç
 * etiket bulunduğu ve verinin önbellekten mi geldiği söylenir.
 */
export function discoveryCaption(result: DiscoveryResult): string {
  if (!result.ok) return result.detail;
  const parts = [`${result.tagCount} etiket bulundu`];
  if (result.cached) {
    parts.push("önbellekten okundu");
  } else if (result.latencyMs !== null) {
    parts.push(`keşif ${formatLatency(result.latencyMs)}`);
  }
  if (result.unreadable.length > 0) {
    parts.push(`${result.unreadable.length} düğüm okunamadı`);
  }
  return parts.join(" · ");
}

/**
 * Cihaz değişimi uyarısı; değişim yoksa ya da bilinmiyorsa `null`.
 *
 * İlk kurulumda uyarı verilmez: daha önce görülmemiş bir cihazı "değişti"
 * diye bildirmek her kurulumda yanlış alarm olurdu.
 */
export function deviceChangeWarning(result: DiscoveryResult): string | null {
  if (result.deviceChanged !== true) return null;
  return (
    "Bu uçtaki cihazın düğüm kümesi daha önce görülenden farklı. " +
    "Mevcut eşlemeler başka bir cihazın düğümlerine işaret ediyor olabilir."
  );
}

/**
 * Kimlik denemesinin cümlesi.
 *
 * Başarıda gecikme de yazılır: uçtan gerçekten yanıt alındığının kanıtı
 * budur.
 */
export function credentialCaption(test: CredentialTest): string {
  const parts = [test.detail];
  if (test.latencyMs !== null) parts.push(formatLatency(test.latencyMs));
  return parts.join(" · ");
}

/**
 * Kimlik doğrulamanın gerekip gerekmediği.
 *
 * Bilinmiyorsa "—"; `false` yazmak "gerekmiyor" iddiasında bulunmak olurdu.
 */
export function authLabel(requiresAuth: boolean | null): string {
  if (requiresAuth === null) return NOT_MEASURED;
  return requiresAuth ? "Kimlik bilgisi ile" : "Anonim";
}

/**
 * Eşlenmemiş etiketler için uyarı; hepsi eşlenmişse `null`.
 *
 * Eşlemesiz bir etiketin verisi hiçbir makineye yazılmaz; kullanıcı bunu
 * kaydetmeden önce bilmelidir.
 */
export function unmappedWarning(addresses: string[]): string | null {
  if (addresses.length === 0) return null;
  return `${addresses.length} etiketin eşlemesi yok; bu etiketlerin verisi hiçbir makineye yazılmaz.`;
}

/**
 * Öneri uygulamasının sonucu.
 *
 * Hiçbir öneri uygulanamadıysa **nedeni** yazılır. Sessiz kalmak, düğmenin
 * bozuk olduğu izlenimi verirdi; tarayıcıda tam olarak böyle göründü.
 */
export function suggestionOutcome(applied: number, unresolved: number): string {
  if (applied === 0 && unresolved === 0) {
    return "Uygulanacak öneri yok; seçili etiketlerin eşlemesi zaten kurulu.";
  }
  if (applied === 0) {
    return (
      `${unresolved} etiket için makine adı adresten çıkarılamadı; ` +
      "makineyi elle seçin."
    );
  }
  if (unresolved === 0) {
    return `${applied} eşleme önerilerden kuruldu.`;
  }
  return (
    `${applied} eşleme kuruldu; ${unresolved} etiket için makine adı ` +
    "adresten çıkarılamadı."
  );
}
