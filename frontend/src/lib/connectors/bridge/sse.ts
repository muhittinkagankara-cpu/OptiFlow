/**
 * SSE çerçevelerinin çözümlenmesi.
 *
 * Akış `EventSource` ile değil `fetch` ile okunur. Nedeni tek ve kesindir:
 * `EventSource` özel başlık gönderemez, oysa bu uç mevcut `Authorization`
 * başlığını ister. Belirteci sorgu dizesine koymak da seçenek değildir —
 * kimlik bilgisi adres çubuğuna, tarayıcı geçmişine ve sunucu günlüklerine
 * yazılırdı.
 *
 * Bu dosyadaki ayrıştırma **saftır**: ağ yoktur, girdi metindir. Böylece
 * parçalanmış çerçeveler (bir olayın ikiye bölünerek gelmesi) gerçek bir
 * sunucu olmadan sınanabilir.
 */

/** Ayrıştırılmış tek bir SSE çerçevesi. */
export interface SseFrame {
  /** `id:` alanı; yoksa `null`. */
  id: number | null;
  /** `event:` alanı; yoksa "message". */
  event: string;
  /** `data:` satırlarının birleşimi. */
  data: string;
}

/**
 * Tamponlanmış metinden tam çerçeveleri ayırır.
 *
 * Dönen `rest`, henüz tamamlanmamış kısımdır ve bir sonraki çağrıya taşınır.
 * Taşınmasaydı, ikiye bölünen bir olay sessizce kaybolurdu — ağda bu, uzun
 * gövdelerde kural dışı değil kuraldır.
 */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { frames: parts.filter((part) => part.trim() !== ""), rest };
}

/**
 * Tek bir çerçeveyi ayrıştırır.
 *
 * Yorum satırları (`:` ile başlayan) yok sayılır; bunlar bağlantıyı canlı
 * tutan sinyallerdir ve veri taşımazlar. Çerçevede hiç `data:` yoksa `null`
 * döner.
 */
export function parseFrame(frame: string): SseFrame | null {
  const lines = frame.split("\n");
  const dataLines: string[] = [];
  let id: number | null = null;
  let event = "message";

  for (const line of lines) {
    if (line.startsWith(":") || line.trim() === "") {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    // Alan adından sonraki tek boşluk belirtim gereği atılır.
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "data") {
      dataLines.push(value);
    } else if (field === "event") {
      event = value || "message";
    } else if (field === "id") {
      const parsed = Number(value);
      id = Number.isFinite(parsed) ? parsed : null;
    }
  }

  if (dataLines.length === 0) {
    return null;
  }
  return { id, event, data: dataLines.join("\n") };
}

/** Çerçevenin gövdesini JSON olarak çözer; çözülemezse `null`. */
export function parseFrameData(frame: SseFrame): unknown {
  try {
    return JSON.parse(frame.data);
  } catch {
    return null;
  }
}

/**
 * Akış tamponu.
 *
 * Gelen metin parçalarını biriktirir ve tamamlanan çerçeveleri verir. Sınıf
 * olmasının nedeni durumun (yarım kalan çerçeve) bir yerde durması gerekliliği;
 * ayrıştırmanın kendisi yine saf işlevlerdedir.
 */
export class SseBuffer {
  private buffer = "";
  /** Son görülen olay numarası; yeniden bağlanmada kaldığı yer. */
  private lastId: number | null = null;

  get lastEventId(): number | null {
    return this.lastId;
  }

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const { frames, rest } = splitFrames(this.buffer);
    this.buffer = rest;

    const parsed: SseFrame[] = [];
    for (const raw of frames) {
      const frame = parseFrame(raw);
      if (frame !== null) {
        if (frame.id !== null) {
          this.lastId = frame.id;
        }
        parsed.push(frame);
      }
    }
    return parsed;
  }

  /** Tamponu boşaltır; yeniden bağlanmadan önce çağrılır. */
  reset(): void {
    this.buffer = "";
  }

  /** Henüz tamamlanmamış kısmın uzunluğu; sorun ararken kullanılır. */
  get pendingLength(): number {
    return this.buffer.length;
  }
}
