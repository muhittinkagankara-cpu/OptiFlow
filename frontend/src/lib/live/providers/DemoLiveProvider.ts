/**
 * Hazır bir senaryoyu zamanlayarak oynatan sağlayıcı.
 *
 * Senaryo bittiğinde baştan başlar ama saat ilerlemeye devam eder: sayaçlar
 * sıfırlanmaz, vardiya birikir. Saat de sıfırlansaydı ekran her turda aynı
 * dakikayı gösterir ve "canlı" olmadığı ilk bakışta anlaşılırdı.
 */

import { scenarioById, type ScenarioId } from "../scenarios";
import type { StationSeed } from "../state";
import { BaseLiveProvider } from "./base";

export class DemoLiveProvider extends BaseLiveProvider {
  readonly id = "demo";
  readonly name = "Demo senaryo";
  readonly description =
    "Olaylar bu cihazda üretildi; makineye ya da MES'e bağlanılmadı.";
  readonly isLive = false;
  readonly isAvailable = true;

  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;

  // Alanlar açıkça tanımlanır: derleme `erasableSyntaxOnly` ile yapılıyor ve
  // kurucu parametresi kısayolu (parameter property) çalışma zamanında kod
  // üretiyor, dolayısıyla silinebilir sözdizimi değil.
  private readonly seeds: StationSeed[];
  private readonly scenario: ScenarioId;
  private readonly startMinutes: number;

  constructor(seeds: StationSeed[], scenario: ScenarioId, startMinutes: number) {
    super();
    this.seeds = seeds;
    this.scenario = scenario;
    this.startMinutes = startMinutes;
  }

  protected open(): void {
    this.stopped = false;
    this.run(0);
  }

  protected close(): void {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private run(cycle: number): void {
    const scenario = scenarioById(this.scenario);
    const steps = scenario.build(
      this.seeds,
      this.startMinutes + cycle * scenario.durationMinutes,
    );

    if (steps.length === 0) {
      // İstasyon yoksa oynatacak bir şey de yok; boş bir zamanlayıcıyı
      // sonsuza kadar döndürmenin anlamı olmaz.
      return;
    }

    let index = 0;
    const next = () => {
      if (this.stopped) {
        return;
      }
      if (index >= steps.length) {
        this.run(cycle + 1);
        return;
      }
      const step = steps[index];
      index += 1;
      this.timer = setTimeout(() => {
        if (this.stopped) {
          return;
        }
        this.emit(step.events);
        next();
      }, step.delayMs);
    };

    next();
  }
}
