/**
 * "Bu sayı nereden geldi?" (MASTER §17).
 *
 * Command Center'daki her sayı **son simülasyon koşumundan** gelir; hattın o
 * anki hâlinden değil. Bu ayrım ekranda yazılı olmazsa kullanıcı benzetimi
 * canlı veri sanır — ürünün kaçındığı hata sınıfının ta kendisi (KURAL 1).
 *
 * Güven aralığı ve tekrar sayısı **ölçülmüş** değerlerdir: simülasyon motoru
 * `confidence_interval_95` ve `num_replications` alanlarını zaten döndürür.
 * Yokken uydurulmaz.
 */

import type { SimulationResults } from "../../types/simulationTypes";
import { formatUnits } from "../resultsFormatting";
import type { RunProvenance } from "./types";

export function runProvenance(
  results: SimulationResults | null,
): RunProvenance {
  if (results === null) {
    return {
      origin: "unverified",
      source: "Henüz koşum yok",
      replications: null,
      interval: null,
    };
  }

  const [low, high] = results.confidence_interval_95;
  const measurable = Number.isFinite(low) && Number.isFinite(high);

  return {
    origin: "simulated",
    source: "Son simülasyon koşumu",
    replications: Number.isFinite(results.num_replications)
      ? results.num_replications
      : null,
    interval: measurable
      ? `%95 aralık ${formatUnits(low)} – ${formatUnits(high)}`
      : null,
  };
}

/**
 * Güven satırının okunur hâli.
 *
 * Ne tekrar sayısı ne aralık ölçülebiliyorsa `null` döner ve satır hiç
 * çizilmez. Boş bir "Güven:" etiketi, ölçüm varmış izlenimi bırakırdı.
 */
export function confidenceLine(provenance: RunProvenance): string | null {
  const parts: string[] = [];
  if (provenance.replications !== null) {
    parts.push(`${provenance.replications} tekrar`);
  }
  if (provenance.interval !== null) {
    parts.push(provenance.interval);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}
