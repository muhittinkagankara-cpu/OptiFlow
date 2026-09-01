/**
 * İşlem süresi dağılımını düzenleyen ortak bileşen.
 *
 * Hem sihirbazın 2. adımında hem süreç editörünün parametre panelinde
 * kullanılır. Her dağılım seçeneğinin yanında bir (?) ipucu bulunur; istatistik
 * bilmeyen bir kullanıcı "hangisini seçmeliyim?" sorusunu bu açıklamalarla
 * yanıtlayabilmelidir.
 *
 * Dağılım tipi değiştiğinde parametreler sıfırdan başlamaz: mevcut ortalama
 * süre korunarak yeni tipin parametrelerine çevrilir. Aksi hâlde kullanıcı
 * "Normal"den "Üçgen"e geçtiğinde girdiği 5 dakikalık süreyi kaybeder ve
 * baştan yazmak zorunda kalırdı.
 */

import type { Distribution, DistributionType } from "../../types/simulationTypes";
import { DISTRIBUTION_HELP, DISTRIBUTION_LABELS } from "../../types/simulationTypes";
import { Field, NumberField, SelectField } from "./FormControls";
import { Tooltip } from "./Tooltip";

/** Arayüzde sunulan dağılımlar. "Gerçek veriden" (empirical) veri yükleme
 *  akışı gerektirdiği için bu sürümde seçenek olarak gösterilmez. */
const SELECTABLE_TYPES: DistributionType[] = [
  "constant",
  "normal",
  "triangular",
  "exponential",
];

/** Her dağılımın alanları: kanonik parametre adı ve kullanıcıya görünen etiket. */
const FIELDS: Record<DistributionType, Array<{ key: string; label: string; hint?: string }>> = {
  constant: [{ key: "value", label: "İşlem süresi" }],
  normal: [
    { key: "mean", label: "Ortalama süre" },
    { key: "std", label: "Sapma", hint: "Sürelerin ortalamadan ne kadar saptığı" },
  ],
  triangular: [
    { key: "min", label: "En hızlı" },
    { key: "mode", label: "En olası" },
    { key: "max", label: "En yavaş" },
  ],
  exponential: [{ key: "mean", label: "Ortalama süre" }],
  empirical: [],
};

/** Bir dağılımın ortalama süresini kestirir (tip dönüşümünde korunması için). */
export function estimateMean(distribution: Distribution): number {
  const params = distribution.params;
  const numeric = (key: string, fallback: number): number => {
    const value = Number(params[key]);
    return Number.isFinite(value) ? value : fallback;
  };

  switch (distribution.type) {
    case "constant":
      return numeric("value", 5);
    case "normal":
    case "exponential":
      return numeric("mean", 5);
    case "triangular":
      return (numeric("min", 4) + numeric("mode", 5) + numeric("max", 7)) / 3;
    default:
      return 5;
  }
}

/**
 * Dağılım tipini değiştirirken ortalama süreyi koruyan dönüşüm.
 *
 * Üçgen dağılıma geçerken min/max, ortalamanın %25 altı ve üstü olarak
 * seçilir; bu, kullanıcıya makul bir başlangıç verir ve min <= mode <= max
 * kuralını kendiliğinden sağlar.
 */
export function convertDistribution(
  current: Distribution,
  nextType: DistributionType,
): Distribution {
  const mean = Math.max(estimateMean(current), 0.1);
  const round = (value: number) => Math.round(value * 100) / 100;

  switch (nextType) {
    case "constant":
      return { type: "constant", params: { value: round(mean) } };
    case "normal":
      return { type: "normal", params: { mean: round(mean), std: round(mean * 0.15) } };
    case "triangular":
      return {
        type: "triangular",
        params: {
          min: round(mean * 0.75),
          mode: round(mean),
          max: round(mean * 1.35),
        },
      };
    case "exponential":
      return { type: "exponential", params: { mean: round(mean) } };
    default:
      return current;
  }
}

interface DistributionEditorProps {
  value: Distribution;
  onChange: (next: Distribution) => void;
  /** Alanların birim etiketi. */
  unit?: string;
  /** Tip seçicinin etiketi. */
  label?: string;
}

export function DistributionEditor({
  value,
  onChange,
  unit = "dk",
  label = "İşlem süresi",
}: DistributionEditorProps) {
  const fields = FIELDS[value.type] ?? [];

  const updateParam = (key: string, next: number) => {
    onChange({ ...value, params: { ...value.params, [key]: next } });
  };

  return (
    <div className="space-y-3">
      <Field label={label} help={DISTRIBUTION_HELP[value.type]}>
        {(id) => (
          <SelectField
            id={id}
            value={value.type}
            options={SELECTABLE_TYPES.map((type) => ({
              value: type,
              label: DISTRIBUTION_LABELS[type],
            }))}
            onChange={(nextType) => onChange(convertDistribution(value, nextType))}
          />
        )}
      </Field>

      {/* Seçilen dağılımın kısa açıklaması her zaman görünür: ipucu balonunu
          açmak zorunda kalmadan da doğru seçim yapılabilmeli. */}
      <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs leading-relaxed text-brand-900">
        {DISTRIBUTION_HELP[value.type]}
      </p>

      <div
        className={`grid gap-3 ${fields.length >= 3 ? "grid-cols-3" : fields.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}
      >
        {fields.map((field) => (
          <Field key={field.key} label={field.label}>
            {(id) => (
              <NumberField
                id={id}
                value={Number(value.params[field.key] ?? 0)}
                onChange={(next) => updateParam(field.key, next)}
                min={0}
                step={0.1}
                suffix={unit}
              />
            )}
          </Field>
        ))}
      </div>

      {value.type === "empirical" && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Tooltip content={DISTRIBUTION_HELP.empirical} label="Gerçek veri hakkında" />
          Bu istasyon sahadan ölçülmüş sürelerle tanımlanmış. Ölçüm listesini bu
          ekrandan düzenleyemezsiniz; başka bir dağılım seçerseniz veriler kaybolur.
        </p>
      )}
    </div>
  );
}
