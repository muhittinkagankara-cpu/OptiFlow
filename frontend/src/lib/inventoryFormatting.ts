/**
 * Envanter sayılarının kullanıcı diline çevrilmesi.
 *
 * Bileşenden ayrı tutulur çünkü buradaki kararlar sessizce yanlış olabilir:
 * bir durumun yanlış renge eşlenmesi ekranda hata göstermez, yalnızca
 * kullanıcıyı yanlış zamanda sipariş vermeye ya da vermemeye iter. Saf
 * fonksiyon olarak birim testiyle doğrulanabilir.
 *
 * Renk tonları ürünün geri kalanıyla aynı ailedendir (`resultsFormatting`
 * içindeki `Tone`); envantere özel bir renk şeması icat edilmedi.
 */

import type { InventoryStatus } from "../types/simulationTypes";
import type { Tone } from "./resultsFormatting";

/** Durumun renk tonu. Kırmızı "şimdi sipariş ver", sarı "hazırlan" demektir. */
export function statusTone(status: InventoryStatus): Tone {
  if (status === "critical") {
    return "bad";
  }
  if (status === "warning") {
    return "warning";
  }
  return "good";
}

/**
 * Durumun yazılı etiketi.
 *
 * Renk tek başına bilgi taşımaz; renk körü bir kullanıcı için tablo yalnızca
 * renkle konuşsaydı okunamaz olurdu.
 *
 * `coversLeadTime` false olduğunda etiket değişir: stok, sipariş bugün verilse
 * bile mal gelene kadar yetmiyordur. Bu, sıradan bir "sipariş ver" uyarısından
 * farklı bir durumdur — sipariş vermek tek başına sorunu çözmez ve kullanıcının
 * hızlandırılmış tedarik gibi bir önlem alması gerekir. İkisini aynı etiketle
 * göstermek, bu fırsatı kaçırmasına yol açardı.
 */
export function statusLabel(
  status: InventoryStatus,
  coversLeadTime: boolean = true,
): string {
  if (status === "critical") {
    return coversLeadTime ? "Sipariş ver" : "Tedarik yetişmiyor";
  }
  if (status === "warning") {
    return "Yaklaşıyor";
  }
  return "Yeterli";
}

/** Miktarı birimiyle birlikte biçimlendirir. */
export function formatQuantity(value: number, unit: string, digits = 0): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value.toLocaleString("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${unit}`;
}

/** Para tutarını biçimlendirir; para birimi modelin dışındadır. */
export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/**
 * Gün sayısını okunur hâle getirir.
 *
 * Backend, talep sıfır olduğunda sonsuz yerine -1 gönderir: sonsuz sayı JSON'a
 * yazılamaz. Bu işaret değeri burada tek yerde çözülür; her bileşende ayrı ayrı
 * kontrol edilseydi biri unutulup ekranda "-1 gün" görünürdü.
 */
export function formatDays(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "—";
  }
  if (value < 1) {
    return "1 günden az";
  }
  return `${Math.round(value)} gün`;
}

/** Olasılığı yüzde olarak yazar. */
export function formatProbability(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `%${(value * 100).toFixed(0)}`;
}

/**
 * Tükenme olasılığının aciliyet tonu.
 *
 * Eşikler bilinçli olarak düşüktür: stok tükenmesi üretimi tamamen durdurur,
 * yani %20'lik bir ihtimal bile ciddiye alınmalıdır. Doluluk oranı gibi
 * "yüksek olması normal" bir metrik değildir.
 */
export function riskTone(probability: number): Tone {
  if (!Number.isFinite(probability)) {
    return "neutral";
  }
  if (probability >= 0.2) {
    return "bad";
  }
  if (probability > 0.0) {
    return "warning";
  }
  return "good";
}

/** Hizmet seviyesini yüzde etiketine çevirir. */
export function serviceLevelLabel(level: number): string {
  return `%${Math.round(level * 100)}`;
}
