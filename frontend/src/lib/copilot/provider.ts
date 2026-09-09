/**
 * Sağlayıcı kataloğu ve henüz bağlanmayan sağlayıcıların iskeleti.
 *
 * Üçü de `CopilotProvider`'ı eksiksiz uygular ama `isAvailable` alanları
 * `false`'tur ve `generate` çağrılırsa açıklayıcı bir hata atarlar. Arayüzde
 * "yakında" olarak listelenirler; seçilemezler.
 *
 * Bu iskeletlerin bugün yazılmasının nedeni, sözleşmenin **bugün** sınanmasıdır:
 * yarın bir dil modeli eklendiğinde arayüzün değişmesi gerekiyorsa, bunu bugün
 * öğrenmek gerekir. Bir de kullanıcıya ürünün nereye gittiğini gösterirler.
 *
 * Bir dil modeli eklendiğinde eklenecek olan tek şey `generate` gövdesidir:
 * bağlam zaten `FactoryContext` olarak hazırdır, korumalar (`guards.ts`) çıktıyı
 * aynı ölçüye vurur ve kota motoru sayacı zaten işletir.
 */

import { RuleBasedProvider } from "./ruleBased";
import type {
  CopilotAnswer,
  CopilotProvider,
  CopilotRequest,
  ProviderHealth,
} from "./types";

/** Henüz bağlanmayan sağlayıcıların ortak gövdesi. */
export abstract class UnavailableProvider implements CopilotProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  readonly isAvailable = false;
  /** Çoğu bulut sağlayıcısı anahtar ister; yerel model istemez ve bunu ezer. */
  readonly requiresApiKey: boolean = true;

  async generate(_request: CopilotRequest): Promise<CopilotAnswer> {
    /*
     * Sessizce boş yanıt dönmek yerine hata atılır: çalışıyormuş gibi görünüp
     * boş cevap veren bir sağlayıcı, kullanıcıya ürünün bozuk olduğunu
     * düşündürür.
     */
    throw new Error(
      `${this.name} bu sürümde bağlı değil. Yerel kural motoru kullanılıyor.`,
    );
  }

  health(): ProviderHealth {
    return {
      status: "unavailable",
      latencyMs: null,
      detail: `${this.name} için bağlantı ve API anahtarı gerekiyor; bu sürümde etkin değil.`,
    };
  }

  quota(): null {
    return null;
  }
}

/** OpenAI uçları (GPT ailesi). */
export class OpenAIProvider extends UnavailableProvider {
  readonly id = "openai";
  readonly name = "OpenAI";
  readonly description =
    "Bulut dil modeli; fabrika verisinin dışarı çıkmasını gerektirir.";
}

/** Anthropic Claude uçları. */
export class ClaudeProvider extends UnavailableProvider {
  readonly id = "claude";
  readonly name = "Claude";
  readonly description =
    "Bulut dil modeli; uzun bağlam pencereleri için uygun.";
}

/** Şirket ağında çalışan yerel model (Ollama, vLLM). */
export class LocalLLMProvider extends UnavailableProvider {
  readonly id = "local-llm";
  readonly name = "Yerel LLM";
  readonly description =
    "Şirket ağındaki model sunucusu; veri fabrikadan çıkmaz.";
  readonly requiresApiKey = false;
}

/** Arayüzde listelenen sağlayıcı satırı. */
export interface ProviderChoice {
  id: string;
  name: string;
  description: string;
  isAvailable: boolean;
  requiresApiKey: boolean;
}

/**
 * Seçilebilecek sağlayıcılar.
 *
 * Bağlanmayanlar da listelenir ve "yakında" olarak işaretlenir: hangi
 * kaynakların yolda olduğunu görmek, mimarinin hazır olduğunu gösteren tek
 * işarettir.
 */
export function providerCatalog(): ProviderChoice[] {
  return [
    new RuleBasedProvider(),
    new LocalLLMProvider(),
    new OpenAIProvider(),
    new ClaudeProvider(),
  ].map((provider) => ({
    id: provider.id,
    name: provider.name,
    description: provider.description,
    isAvailable: provider.isAvailable,
    requiresApiKey: provider.requiresApiKey,
  }));
}

/**
 * Varsayılan sağlayıcı.
 *
 * Her zaman yereldir: ürün, API anahtarı olmadan da eksiksiz çalışmalıdır.
 */
export function defaultProvider(): CopilotProvider {
  return new RuleBasedProvider();
}
