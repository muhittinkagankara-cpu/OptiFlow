/**
 * Canlı ekranın kaynağı — sunucunun verdiği karar okunur, yeniden verilmez.
 *
 * Kararı sunucu verir (`/api/runtime/driver`): hangi bağlantının doğrulandığı
 * ve şu anda bağlı olduğu yalnızca orada bilinir. Tarayıcı aynı kararı ikinci
 * kez hesaplasaydı, iki taraf farklı sonuca vardığında hangisinin doğru olduğu
 * belirsizleşirdi.
 *
 * Buradaki her şey saftır: ağ çağrısı yoktur, yalnızca gelen yük çözümlenir ve
 * tek bir soruya yanıt verilir — ekran hangi sağlayıcıyla açılmalı?
 */

import { numberOr, stringOrNull } from "./parse";
import { RUNTIME_SOURCE_ID } from "./live";

/** Sürücünün protokolü; tanınmayan değer `null` olur. */
export type DriverKind = "opcua" | "rest" | "mqtt";

const KINDS: DriverKind[] = ["opcua", "rest", "mqtt"];

/**
 * Hiç yanıt okunamadığında yazılan gerekçe.
 *
 * "Cihaz yok" demek yanlış olurdu: soru sorulamadı. Fark önemli, çünkü biri
 * fabrikayla ilgili bir olgu, öteki bizim tarafımızdaki bir arıza.
 */
export const DRIVER_UNREADABLE_REASON =
  "Sürücü kararı okunamadı: sunucuya ulaşılamadı, bu yüzden canlı ekran " +
  "benzetim verisiyle açıldı. Ağ bağlantısını kontrol edip sayfayı yenileyin.";

/** Sunucunun verdiği karar. */
export interface RuntimeDriver {
  connectionId: string | null;
  kind: DriverKind | null;
  label: string | null;
  /** Kararın operatöre gösterilecek tek cümlelik gerekçesi. */
  reason: string;
  /** Seçilebilir durumdaki bağlantı sayısı. */
  candidates: number;
  /** Gerçek cihaz yoksa `true`; ekran bunu ayrıca etiketler. */
  simulated: boolean;
}

function parseKindOrNull(value: unknown): DriverKind | null {
  return KINDS.includes(value as DriverKind) ? (value as DriverKind) : null;
}

/**
 * Sunucu yükünü çözümler.
 *
 * Eksik ya da bozuk bir alan `simulated: true` tarafına düşer. Belirsizlikte
 * benzetime düşmek bilinçlidir: yanlışlıkla "gerçek veri" demek, operatöre
 * olmayan bir hattı gerçek gibi okutur.
 */
export function parseRuntimeDriver(value: unknown): RuntimeDriver {
  const record = (value ?? {}) as Record<string, unknown>;
  const connectionId = stringOrNull(record.connection_id);
  const kind = parseKindOrNull(record.kind);
  const reason = stringOrNull(record.reason);
  /*
   * Bir yük ancak **hem** sunucu "benzetim değil" dediğinde **hem de** gerçekten
   * bir bağlantıyı adlandırdığında gerçek sayılır. Yalnızca `simulated`
   * alanına bakılsaydı, tanınmayan bir protokol (sunucuya yeni bir tür
   * eklendiğinde) `kind: null` ile birlikte "gerçek veri" olarak okunurdu.
   * Çelişkili yükte güvenli taraf seçilir.
   */
  const adlandirildi = connectionId !== null && kind !== null;
  const sunucuBenzetimDiyor =
    typeof record.simulated === "boolean" ? record.simulated : false;
  const simulated = sunucuBenzetimDiyor || !adlandirildi;

  return {
    connectionId: simulated ? null : connectionId,
    kind: simulated ? null : kind,
    label: simulated ? null : stringOrNull(record.label),
    reason: reason ?? DRIVER_UNREADABLE_REASON,
    candidates: Math.max(0, numberOr(record.candidates, 0)),
    simulated,
  };
}

/** Yanıt hiç okunamadığında kullanılan karar. */
export function unreadableDriver(): RuntimeDriver {
  return {
    connectionId: null,
    kind: null,
    label: null,
    reason: DRIVER_UNREADABLE_REASON,
    candidates: 0,
    simulated: true,
  };
}

/**
 * Ekranın hangi kaynakla açılacağı.
 *
 * `runtime` yalnızca sunucu doğrulanmış bir cihaz bildirdiğinde seçilir.
 * Karar okunamadığında da `demo` döner — bilinmezlikte gerçek veri iddia
 * etmek, boş bir ekranı "fabrika duruyor" diye okutur.
 */
export function liveSourceFor(driver: RuntimeDriver | null): "runtime" | "demo" {
  if (driver === null || driver.simulated) {
    return "demo";
  }
  return RUNTIME_SOURCE_ID as "runtime";
}

/**
 * Kaynağın yanında gösterilecek köken cümlesi.
 *
 * Her karar "neden?" sorusunu yanıtlayabilmeli; gerekçe sunucudan geldiği gibi
 * taşınır, burada yeniden yazılmaz.
 */
export function driverProvenance(driver: RuntimeDriver | null): string {
  return driver === null ? DRIVER_UNREADABLE_REASON : driver.reason;
}
