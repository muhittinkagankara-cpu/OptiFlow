/**
 * "Bu sayı nereden geldi ve ne zaman ölçüldü?" (MASTER §17).
 *
 * Command Center'daki her sayı **son simülasyon koşumundan** gelir; hattın o
 * anki hâlinden değil. Bu ayrım ekranda yazılı olmazsa kullanıcı benzetimi
 * canlı veri sanır — ürünün kaçındığı hata sınıfının ta kendisi (KURAL 1).
 *
 * Güven aralığı ve tekrar sayısı **ölçülmüş** değerlerdir: simülasyon motoru
 * `confidence_interval_95` ve `num_replications` alanlarını zaten döndürür.
 * Yokken uydurulmaz.
 *
 * Zaman damgası (Sprint 2F-A)
 * ---------------------------
 * Simülasyon yanıtında zaman alanı **yoktur**. Var olan tek yetkili damga
 * `RunHistoryEntry.ranAt`: koşum tamamlandığında istemcide üretilir
 * (`entryFromResult`) ve `localStorage`'a yazılır. Bu yüzden anlamı "sunucunun
 * koşumu bitirdiği an" değil, **"bu tarayıcının yanıtı aldığı an"**dır. Yeni
 * bir kaynak uydurulmadı; olan kullanıldı ve sınırı burada yazıldı.
 *
 * Eşleştirme `simulation_id` üzerinden yapılır. Ada ya da sıraya göre
 * eşleştirmek, geçmişteki başka bir koşumun saatini bu koşuma yazabilirdi.
 */

import type { SimulationRunResponse } from "../../types/simulationTypes";
import type { SimulationResults } from "../../types/simulationTypes";
import { formatUnits } from "../resultsFormatting";
import { relativeTime, type RunHistoryEntry } from "../runHistory";
import type { RunProvenance } from "./types";

/**
 * Ekrandaki koşumun zaman damgasını geçmişten bulur.
 *
 * Eşleşme yoksa `null` döner: elde bir saat olmaması, yanlış bir saat
 * göstermekten iyidir.
 */
export function runRanAt(
  run: SimulationRunResponse | null,
  history: RunHistoryEntry[],
): string | null {
  if (run === null) {
    return null;
  }
  const entry = history.find((item) => item.simulationId === run.simulation_id);
  return entry?.ranAt ?? null;
}

export function runProvenance(
  results: SimulationResults | null,
  ranAt: string | null = null,
): RunProvenance {
  if (results === null) {
    return {
      origin: "unverified",
      source: "Henüz koşum yok",
      replications: null,
      interval: null,
      ranAt: null,
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
    ranAt,
  };
}

/** Göreli anlatımın bırakılıp mutlak tarihe geçildiği sınır (saat). */
const ABSOLUTE_AFTER_HOURS = 24;

/**
 * Koşumun tazeliği — rozetin yanında görünen tek satır.
 *
 * Kurallar `lib/runHistory.relativeTime` ile **aynı sınırları** kullanır ve o
 * işlev yeniden yazılmaz: bir gün içindeki koşumlar göreli ("12 dk önce"),
 * daha eskiler mutlak okunur. Yeni bir eşik tanımlanmadı — 24 saat sınırı zaten
 * orada vardı; burada yalnızca eski koşumun saati de yazılıyor, çünkü "14 Eyl"
 * tek başına hangi vardiya olduğunu söylemez.
 *
 * Saat ve tarih **tarayıcının yerel saat dilimiyle** biçimlenir; saklanan ISO
 * değeri değiştirilmez.
 *
 * Geçersiz ya da eksik damgada `null` döner ve çağıran hiçbir şey çizmez.
 */
export function runFreshness(
  ranAt: string | null,
  now: Date = new Date(),
): { text: string; isOlderThanADay: boolean } | null {
  if (ranAt === null) {
    return null;
  }
  const then = new Date(ranAt);
  if (Number.isNaN(then.getTime())) {
    return null;
  }

  const hours = (now.getTime() - then.getTime()) / 3_600_000;
  if (hours < ABSOLUTE_AFTER_HOURS) {
    /* İleri tarihli bir damga (saat kayması) burada "az önce" okunur;
       `relativeTime` negatif farkı bu şekilde ele alır. Eksi işaretli bir süre
       göstermek kullanıcıya bir hata gibi görünürdü. */
    return { text: relativeTime(ranAt, now), isOlderThanADay: false };
  }

  const date = then.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "short",
  });
  const clock = then.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return { text: `${date} ${clock}`, isOlderThanADay: true };
}

/**
 * Rozetin yanında görünen tazelik cümlesi.
 *
 * Cümle bileşende değil burada kurulur (mimari kuralı: metin kurma bileşenin
 * içinde yaşamaz). Bir gün ve daha eski koşumlarda mutlak tarihin yanına
 * **yazılı** bir eskilik notu eklenir: "14 Eyl 16:00" tek başına bakışta
 * eski olduğunu söylemez, okuyup bugünün tarihiyle karşılaştırmayı gerektirir.
 *
 * Bu, `runFreshness`'in zaten ölçtüğü `isOlderThanADay` bayrağının karşılığıdır;
 * yeni bir eşik ya da yeni bir zaman kaynağı tanımlanmaz.
 *
 * Tazelik yoksa `null` döner ve çağıran hiçbir şey çizmez (Yasa 4).
 */
export function freshnessLine(
  freshness: { text: string; isOlderThanADay: boolean } | null,
): string | null {
  if (freshness === null) {
    return null;
  }
  return freshness.isOlderThanADay
    ? `Son koşum ${freshness.text} · bir günden eski`
    : `Son koşum ${freshness.text}`;
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
