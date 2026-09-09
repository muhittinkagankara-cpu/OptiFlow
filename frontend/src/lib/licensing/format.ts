/**
 * Lisans ekranının metinleri.
 *
 * Sınırsız bir kaynak "—" ile değil, **"Sınırsız"** ile gösterilir: "—"
 * ölçülemediği anlamına gelir ve kurumsal planı bozuk bir ölçüm gibi
 * gösterirdi. İkisi farklı bilgilerdir ve farklı yazılır.
 */

import { NOT_MEASURED } from "../telemetry/format";
import {
  LICENSE_STATUS_LABEL,
  LICENSE_TIER_LABEL,
  type LicenseStatus,
  type LicenseTier,
  type LicenseView,
  type LimitCheck,
} from "./types";

export { NOT_MEASURED };

/** Sınırsız kaynakların ekrandaki karşılığı. */
export const UNLIMITED = "Sınırsız";

export function tierLabel(tier: LicenseTier): string {
  return LICENSE_TIER_LABEL[tier];
}

export function statusLabel(status: LicenseStatus): string {
  return LICENSE_STATUS_LABEL[status];
}

/**
 * Bir sınırın ekrandaki değeri.
 *
 * Üç ayrı durum, üç ayrı metin: sınırsız, ölçülemedi, sayı. İkisini
 * birleştirmek, bozuk bir sayacı sınırsız bir plana çevirirdi.
 */
export function limitValue(check: LimitCheck): string {
  if (check.limit === null) return UNLIMITED;
  if (check.used === null) return `${NOT_MEASURED} / ${check.limit}`;
  return `${check.used} / ${check.limit}`;
}

/** Sınırın doluluk oranı; hesaplanamıyorsa `null`. */
export function limitRatio(check: LimitCheck): number | null {
  return check.ratio;
}

/**
 * Kalan gün metni.
 *
 * Süresi dolmuş bir lisansta "—" yazılır, "0 gün" değil: sıfır gün, bugün
 * bitiyor demektir ve bitmiş bir lisanstan farklıdır.
 */
export function remainingLabel(view: LicenseView): string {
  const days = view.license?.remainingDays ?? null;
  if (days === null) return NOT_MEASURED;
  if (days === 0) return "Bugün bitiyor";
  return `${days} gün kaldı`;
}

/**
 * Lisans ekranının özet cümlesi.
 *
 * Lisans yoksa bunu söyler; varsa plan, müşteri ve kalan süre yazılır.
 */
export function licenseCaption(view: LicenseView): string {
  if (view.license === null) {
    return view.reason ?? "Bu kuruluma lisans tanımlanmamış.";
  }
  const parts = [view.license.tierLabel];
  if (view.license.customer) parts.push(view.license.customer);
  parts.push(remainingLabel(view));
  return parts.join(" · ");
}

/**
 * Engellenen işlemlerin okunur adı.
 *
 * Boş liste "hiçbir şey engellenmiyor" demektir ve bu ayrıca söylenir;
 * boş bir alan, kullanıcıya bir şey söylemez.
 */
export function blockedLabel(blocked: string[]): string {
  if (blocked.length === 0) return "Hiçbir işlem engellenmiyor.";
  const names: Record<string, string> = {
    add_user: "yeni kullanıcı",
    add_machine: "yeni makine",
    add_factory: "yeni fabrika",
  };
  const readable = blocked.map((item) => names[item] ?? item);
  return `Engellenen: ${readable.join(", ")}. İzleme sürüyor.`;
}

/**
 * Süresi dolan lisansın uyarısı; sorun yoksa `null`.
 *
 * Uyarı metni ne olduğunu **ve ne olmadığını** söyler: izleme sürer. Yalnızca
 * "lisans doldu" demek, kullanıcının ekranı kapanacak sanmasına yol açardı.
 */
export function licenseWarning(view: LicenseView): string | null {
  if (view.healthy) return null;
  if (view.status === "missing") {
    return "Bu kuruluma lisans tanımlanmamış; yeni kayıt açılamaz.";
  }
  if (view.status === "expired") {
    return "Lisans süresi doldu. İzleme sürüyor, yeni kayıt açılamaz.";
  }
  if (view.status === "revoked") {
    return view.reason ?? "Lisans iptal edildi.";
  }
  if (view.status === "pending") {
    return "Lisans henüz başlamadı.";
  }
  return view.reason ?? "Lisans sınırlarından biri aşıldı.";
}

/**
 * Sınırın rengi için ton adı.
 *
 * Ölçülemeyen sınır **nötr**tür: bilinmeyen bir şey ne iyi ne kötüdür ve yeşil
 * gösterilseydi eksik ölçüm sağlıklı sanılırdı.
 */
export function limitTone(check: LimitCheck): "good" | "warning" | "bad" | "neutral" {
  if (check.exceeded === null) return "neutral";
  if (check.exceeded) return "bad";
  if (check.ratio !== null && check.ratio >= 0.9) return "warning";
  return "good";
}
