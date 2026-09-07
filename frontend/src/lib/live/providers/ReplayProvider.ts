/**
 * Kayıttan oynatan sağlayıcı.
 *
 * Elinde bir **bant** (`ReplayTape`) vardır: her karede hangi olayların
 * kaydın kaçıncı milisaniyesinde geçtiği yazılıdır. Bant, bugün bir demo
 * senaryosundan üretiliyor; yarın gerçek bir vardiyanın kaydından okunacak ve
 * bu sınıfın tek satırı değişmeyecek.
 *
 * Geri sarma
 * ----------
 * İleri sarmak kolaydır: aradaki kareler sırayla uygulanır. Geri sarmak ise
 * bir sorundur, çünkü olaylar birikimlidir — 10. dakikadan 3. dakikaya
 * dönmek, sayaçları geri almayı gerektirir. Olayları "geri alan" ters bir
 * indirgeyici yazmak yerine, durum sıfırlanır ve baştan o ana kadarki bant
 * yeniden uygulanır. Bu, kayıttan oynatmada standart yaklaşımdır ve tek bir
 * doğruluk kaynağı (ileri yönlü indirgeyici) bırakır.
 *
 * Sıfırlama isteği ayrı bir kanaldan (`onReset`) duyurulur: olay akışına
 * "sıfırla" diye bir olay koymak, aynı akışı dinleyen alarm ve sayaç
 * mantığını kayıt oynatmaya özel bir duruma bulaştırırdı.
 */

import type { LiveEvent } from "../events";
import { scenarioById, type ScenarioId } from "../scenarios";
import type { StationSeed } from "../state";
import { BaseLiveProvider } from "./base";
import type { ReplayControls, ReplaySpeed } from "./types";

/** Bandın tek bir karesi. */
export interface ReplayFrame {
  /** Kaydın başından itibaren geçen süre (ms). */
  atMs: number;
  events: LiveEvent[];
}

export type ReplayTape = ReplayFrame[];

/** Oynatma çubuğunun ilerleme adımı (ms). */
const TICK_MS = 100;

/**
 * Bir senaryodan bant üretir.
 *
 * `cycles` kaç tur kaydedileceğini söyler; tek tur çok kısa bir kayıt verirdi
 * ve zaman kaydırıcısının işe yaradığı görülmezdi.
 */
export function recordScenario(
  scenario: ScenarioId,
  seeds: StationSeed[],
  startMinutes: number,
  cycles = 3,
): ReplayTape {
  const definition = scenarioById(scenario);
  const tape: ReplayTape = [];
  let elapsed = 0;

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const steps = definition.build(
      seeds,
      startMinutes + cycle * definition.durationMinutes,
    );
    for (const step of steps) {
      elapsed += step.delayMs;
      tape.push({ atMs: elapsed, events: step.events });
    }
  }

  return tape;
}

export class ReplayProvider extends BaseLiveProvider implements ReplayControls {
  readonly id = "replay";
  readonly name = "Kayıttan oynatma";
  readonly description =
    "Kaydedilmiş bir vardiya bandı oynatılıyor; canlı bir kaynağa bağlanılmadı.";
  readonly isLive = false;
  readonly isAvailable = true;

  private timer: ReturnType<typeof setInterval> | undefined;
  private cursor = 0;
  private position = 0;
  private currentSpeed: ReplaySpeed = 1;
  private playing = false;
  private progressListeners = new Set<() => void>();
  private resetListeners = new Set<() => void>();

  // Kurucu parametresi kısayolu kullanılmaz: derleme `erasableSyntaxOnly` ile
  // yapılıyor ve o kısayol çalışma zamanında kod üretiyor.
  private readonly tape: ReplayTape;

  constructor(tape: ReplayTape) {
    super();
    this.tape = tape;
  }

  /* --- Sözleşme --------------------------------------------------------- */

  protected open(): void {
    this.play();
  }

  protected close(): void {
    this.stopTimer();
    this.playing = false;
  }

  /* --- Oynatma denetimleri ---------------------------------------------- */

  get durationMs(): number {
    return this.tape.length === 0 ? 0 : this.tape[this.tape.length - 1].atMs;
  }

  get positionMs(): number {
    return this.position;
  }

  get speed(): ReplaySpeed {
    return this.currentSpeed;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setSpeed(speed: ReplaySpeed): void {
    this.currentSpeed = speed;
    this.notifyProgress();
  }

  play(): void {
    if (this.tape.length === 0) {
      return;
    }
    // Kaydın sonundayken "oynat" başa sarar; aksi hâlde düğme tıklanır ve
    // hiçbir şey olmazdı.
    if (this.position >= this.durationMs) {
      this.seek(0);
    }
    this.playing = true;
    this.startTimer();
    this.notifyProgress();
  }

  pause(): void {
    this.playing = false;
    this.stopTimer();
    this.notifyProgress();
  }

  seek(positionMs: number): void {
    const target = Math.min(Math.max(0, positionMs), this.durationMs);

    /*
     * Her atlayışta baştan yeniden uygulanır — ileri atlayışlarda da. Yalnızca
     * geri atlayışta sıfırlamak, ileri atlarken aradaki kareleri atlayıp
     * sayaçları eksik bırakırdı; kayıt oynatmanın anlamı da o aradaki
     * olaylardır.
     */
    this.notifyReset();

    const prefix: LiveEvent[] = [];
    let cursor = 0;
    while (cursor < this.tape.length && this.tape[cursor].atMs <= target) {
      prefix.push(...this.tape[cursor].events);
      cursor += 1;
    }

    this.cursor = cursor;
    this.position = target;
    this.emit(prefix);
    this.notifyProgress();
  }

  onProgress(cb: () => void): () => void {
    this.progressListeners.add(cb);
    return () => {
      this.progressListeners.delete(cb);
    };
  }

  /** Durumun sıfırlanması gerektiğini duyurur (geri sarma öncesi). */
  onReset(cb: () => void): () => void {
    this.resetListeners.add(cb);
    return () => {
      this.resetListeners.delete(cb);
    };
  }

  /* --- İç işleyiş -------------------------------------------------------- */

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.advance(), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private advance(): void {
    this.position = Math.min(
      this.durationMs,
      this.position + TICK_MS * this.currentSpeed,
    );

    const batch: LiveEvent[] = [];
    while (
      this.cursor < this.tape.length &&
      this.tape[this.cursor].atMs <= this.position
    ) {
      batch.push(...this.tape[this.cursor].events);
      this.cursor += 1;
    }

    // Tek tik'te biriken kareler **tek** yayında gönderilir: 8x hızda bir
    // tik'e onlarca kare düşebilir ve her birini ayrı yayımlamak o kadar
    // render turu demek olurdu.
    this.emit(batch);

    if (this.position >= this.durationMs) {
      this.playing = false;
      this.stopTimer();
    }

    this.notifyProgress();
  }

  private notifyProgress(): void {
    for (const listener of this.progressListeners) {
      listener();
    }
  }

  private notifyReset(): void {
    for (const listener of this.resetListeners) {
      listener();
    }
  }
}
