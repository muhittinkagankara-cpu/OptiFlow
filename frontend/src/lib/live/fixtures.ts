/**
 * Canlı katman testlerinin paylaştığı kurucular.
 *
 * Beş test dosyası da aynı biçimde hat kuruyor; her birinde yeniden yazılsaydı
 * şemaya bir alan eklendiğinde beş yerde birden güncellenmesi gerekirdi.
 */

import { SHIFT_START_MINUTES } from "./clock";
import { initialLiveState, type StationSeed } from "./state";
import type { LiveFactoryState } from "./types";

export const START = SHIFT_START_MINUTES;

export function seed(
  id: string,
  name: string,
  overrides: Partial<StationSeed> = {},
): StationSeed {
  return {
    id,
    name,
    machineCount: 2,
    cycleSeconds: 30,
    oee: 0.8,
    ...overrides,
  };
}

/** İki istasyonlu bir hat: Kesim → Torna. */
export function seeds(): StationSeed[] {
  return [seed("s1", "Kesim"), seed("s2", "Torna")];
}

export function state(custom: StationSeed[] = seeds()): LiveFactoryState {
  return initialLiveState(custom, START);
}

/** Bir istasyonun durumunu adıyla bulur. */
export function stationOf(
  current: LiveFactoryState,
  id: string,
): LiveFactoryState["stations"][number] {
  const found = current.stations.find((item) => item.stationId === id);
  if (!found) {
    throw new Error(`İstasyon bulunamadı: ${id}`);
  }
  return found;
}
