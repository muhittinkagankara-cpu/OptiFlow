/**
 * Devreye alma ekranlarının metinleri.
 *
 * Ölçülemeyen her değer "—" ile gösterilir ve nedeni yanında yazar. Bu
 * ekranların bütün amacı, kurulumun **gerçekten** bitip bitmediğini
 * söylemektir; eksik bir ölçümü sıfırla doldurmak o amacı bozardı.
 */

import { NOT_MEASURED } from "../telemetry/format";
import {
  PROBE_STATE_LABEL,
  STEP_STATE_LABEL,
  TOKEN_STATUS_LABEL,
  type DeploymentReport,
  type DiagnosticLine,
  type FieldDiagnostics,
  type InstallToken,
  type LabelReview,
  type ProbeState,
  type StepState,
  type TokenStatus,
} from "./types";

export { NOT_MEASURED };

export function tokenStatusLabel(status: TokenStatus): string {
  return TOKEN_STATUS_LABEL[status];
}

export function stepStateLabel(state: StepState): string {
  return STEP_STATE_LABEL[state];
}

export function probeStateLabel(state: ProbeState): string {
  return PROBE_STATE_LABEL[state];
}

/**
 * Süreyi okunur biçime çevirir; ölçülemiyorsa "—".
 *
 * Bir saatin altı dakika, üstü saat olarak yazılır: sahada okunacak bir
 * ekranda "172800000 ms" hiçbir işe yaramaz.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return NOT_MEASURED;
  if (ms < 60_000) return `${Math.round(ms / 1000)} sn`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} dk`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} sa`;
  return `${Math.round(ms / 86_400_000)} gün`;
}

/**
 * Tokenın açıklama satırı.
 *
 * Kullanılmış bir tokenda kalan süre yazılmaz: sayı göstermek onu hâlâ
 * kullanılabilir sanmaya yol açardı. Bunun yerine kimin kullandığı yazılır.
 */
export function tokenCaption(token: InstallToken): string {
  if (token.status === "used") {
    const who = token.usedBy ?? "bilinmeyen kişi";
    return `${who} tarafından kullanıldı`;
  }
  if (token.status === "revoked") {
    return token.revokedReason ?? "İptal edildi";
  }
  if (token.status === "expired") {
    return "Süresi doldu; yeni token üretin";
  }
  return `${formatDuration(token.remainingMs)} geçerli`;
}

/** Tokenın rozet tonu. */
export function tokenTone(status: TokenStatus): "good" | "warning" | "bad" | "neutral" {
  if (status === "active") return "good";
  if (status === "used") return "neutral";
  if (status === "expired") return "warning";
  return "bad";
}

/** Adım durumunun rozet tonu; ölçülemeyen adım nötrdür. */
export function stepTone(state: StepState): "good" | "warning" | "neutral" {
  if (state === "done") return "good";
  if (state === "pending") return "warning";
  return "neutral";
}

/** Tanılama satırının rozet tonu. */
export function probeTone(state: ProbeState): "good" | "warning" | "bad" | "neutral" {
  if (state === "ok") return "good";
  if (state === "warning") return "warning";
  if (state === "failed") return "bad";
  return "neutral";
}

/**
 * Tanılama satırının ekrandaki değeri.
 *
 * Sayısal olmayan bir sonuç (protokol durumu gibi) metin olarak yazılır;
 * ikisi de yoksa "—".
 */
export function lineValue(line: DiagnosticLine): string {
  if (line.value !== null) {
    const number = line.value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
    return line.unit ? `${number} ${line.unit}` : number;
  }
  if (line.text !== null) return line.text;
  return NOT_MEASURED;
}

/**
 * Saha tanılamasının özet cümlesi.
 *
 * Kaç satırın ölçüldüğü açıkça yazılır: yedi satırdan ikisinin ölçüldüğü bir
 * ekranda "her şey normal" demek yanıltıcı olurdu.
 */
export function diagnosticsCaption(report: FieldDiagnostics): string {
  if (report.lineCount === 0) return "Saha tanılaması henüz okunmadı";
  return `${report.lineCount} ölçütten ${report.measuredCount} tanesi ölçüldü`;
}

/**
 * Kurulumun tamamlanma cümlesi.
 *
 * Ölçülemeyen adım varken "tamamlandı" denmez; bilinmeyen bir adımı geçmiş
 * saymak listenin tamamını güvenilmez kılardı.
 */
export function deploymentCaption(report: DeploymentReport): string {
  return report.summary;
}

/**
 * Etiket denetiminin uyarıları; sorun yoksa boş liste.
 *
 * Çakışma ve etiketsiz makine ayrı uyarılardır: birincisi yanlış bir kâğıt,
 * ikincisi hiç olmayan bir kâğıttır.
 */
export function labelWarnings(review: LabelReview): string[] {
  const warnings: string[] = [];
  if (review.duplicates.length > 0) {
    warnings.push(
      `${review.duplicates.length} etiket birden çok makinede kullanılıyor: ` +
        `${review.duplicates.join(", ")}. Sahadaki bir arıza kaydı hangi makineye ` +
        "ait olduğu bilinemeden kapanır.",
    );
  }
  if (review.unlabeled.length > 0) {
    warnings.push(
      `${review.unlabeled.length} makinenin etiketi yok; sahadaki teknisyen için ` +
        "ekrandaki bir satırdan ibarettir.",
    );
  }
  return warnings;
}

/**
 * Etiketlerin ne kadarının basıldığı; etiket yoksa `null`.
 *
 * Sıfır dönseydi, hiç etiketi olmayan bir kurulum "%0 basıldı" diye okunur ve
 * eksik görünürdü — oysa basılacak bir şey yoktur.
 */
export function printedRatio(review: LabelReview): number | null {
  if (review.labels.length === 0) return null;
  const printed = review.labels.filter((item) => item.printedAtMs !== null).length;
  return printed / review.labels.length;
}
