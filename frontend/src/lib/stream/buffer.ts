/**
 * Ekrandaki canlı ölçüm tamponu.
 *
 * Payload Inspector'ın gösterdiği liste budur. Üç kararı taşır:
 *
 * 1. **Yineleme elenir.** Bağlantı koptuğunda akış yeniden açılır ve sunucu
 *    tamponundaki son olaylar yeniden gelir; sunucu açısından bu yineleme
 *    değildir ama ekran için öyledir. Elenmeseydi üretim olduğundan yüksek
 *    görünürdü.
 * 2. **Liste sınırlıdır.** Saniyede yüz olay üreten bir hatta sınırsız liste,
 *    bir saatte üç yüz binden fazla satır demektir.
 * 3. **Değişen satır işaretlenir.** Hangi ölçümün az önce değiştiği,
 *    ekranda vurgulanır; hangi satırın yeni olduğunu göz tek başına
 *    ayıramaz.
 */

import { rowKey, type DeviceDataRow } from "./types";

/** Tamponda tutulan en fazla satır. */
export const BUFFER_LIMIT = 200;

/** Yineleme denetiminde hatırlanan anahtar sayısı. */
export const DEDUP_WINDOW = 500;

/** Bir satırın "yeni değişti" sayıldığı süre (ms). */
export const FLASH_WINDOW_MS = 1_500;

export interface StreamBufferState {
  /** En yeni satır başta. */
  rows: DeviceDataRow[];
  /** Elenen yineleme sayısı. */
  duplicates: number;
  /** Kabul edilen toplam satır. */
  accepted: number;
}

export const EMPTY_BUFFER: StreamBufferState = {
  rows: [],
  duplicates: 0,
  accepted: 0,
};

/**
 * Satırları tampona ekler.
 *
 * Saf işlev: girdiyi değiştirmez, yeni bir durum döndürür. React durumunda
 * yerinde değişiklik yapılsaydı, bileşen yeniden çizilmezdi.
 */
export function pushRows(
  state: StreamBufferState,
  incoming: DeviceDataRow[],
  limit: number = BUFFER_LIMIT,
): StreamBufferState {
  const seen = new Set(state.rows.slice(0, DEDUP_WINDOW).map(rowKey));
  const fresh: DeviceDataRow[] = [];
  let duplicates = 0;

  for (const row of incoming) {
    const key = rowKey(row);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    fresh.push(row);
  }

  if (fresh.length === 0) {
    return duplicates === 0
      ? state
      : { ...state, duplicates: state.duplicates + duplicates };
  }

  // En yeni satır başta: bir operatörün baktığı ilk satır, en son olandır.
  const rows = [...[...fresh].reverse(), ...state.rows].slice(0, limit);

  return {
    rows,
    duplicates: state.duplicates + duplicates,
    accepted: state.accepted + fresh.length,
  };
}

/** Bir satır az önce mi değişti? */
export function isFresh(
  row: DeviceDataRow,
  nowMs: number,
  windowMs: number = FLASH_WINDOW_MS,
): boolean {
  return nowMs - row.timestampMs <= windowMs && nowMs >= row.timestampMs;
}

/** Yalnızca belirli bir makinenin satırları. */
export function forMachine(
  rows: DeviceDataRow[],
  machineId: string,
): DeviceDataRow[] {
  return rows.filter((row) => row.machineId === machineId);
}

/** Yalnızca belirli bir bağlantının satırları. */
export function forConnector(
  rows: DeviceDataRow[],
  connectorId: string,
): DeviceDataRow[] {
  return rows.filter((row) => row.connectorId === connectorId);
}

/** Yalnızca kullanılabilir (metriği güncelleyen) satırlar. */
export function usableRows(rows: DeviceDataRow[]): DeviceDataRow[] {
  return rows.filter((row) => row.usable);
}

/**
 * Makine ve alan başına **son** değer.
 *
 * Payload Inspector'ın üst bölümü bunu gösterir: yüzlerce satır arasında
 * "şu an ne okunuyor?" sorusunun yanıtı budur.
 */
export function latestByField(rows: DeviceDataRow[]): DeviceDataRow[] {
  const latest = new Map<string, DeviceDataRow>();
  for (const row of rows) {
    const key = `${row.machineId}::${row.field}`;
    const existing = latest.get(key);
    if (existing === undefined || row.timestampMs >= existing.timestampMs) {
      latest.set(key, row);
    }
  }
  return [...latest.values()].sort((left, right) =>
    left.machineId === right.machineId
      ? left.field.localeCompare(right.field)
      : left.machineId.localeCompare(right.machineId),
  );
}

/** Tampon özeti. */
export interface BufferSummary {
  total: number;
  machines: number;
  connectors: number;
  duplicates: number;
  /** Ölçümü olmayan (bozuk kaliteli) satır sayısı. */
  unusable: number;
}

export function summarize(state: StreamBufferState): BufferSummary {
  return {
    total: state.rows.length,
    machines: new Set(state.rows.map((row) => row.machineId)).size,
    connectors: new Set(state.rows.map((row) => row.connectorId)).size,
    duplicates: state.duplicates,
    unusable: state.rows.filter((row) => !row.usable).length,
  };
}
