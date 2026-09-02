/**
 * Envanter kalemi ekleme/düzenleme formu.
 *
 * Alanlar, kullanıcının bildiği şeye göre gruplanmıştır: önce "bu nedir ve
 * elimde ne kadar var", sonra "ne kadar tüketiyorum", en sonda "maliyetleri".
 * Maliyet alanları sona konur çünkü çoğu kullanıcı onları elinin altında
 * tutmaz ve formun başında sorulması ilerlemeyi durdurur.
 *
 * Etiketler formül adlarıyla değil kullanıcının diliyle yazılır: "sipariş
 * başına sabit maliyet" yerine "her sipariş için ödediğiniz sabit tutar".
 * Formülü bilen için ipuçları teknik karşılığı da verir.
 */

import { useState } from "react";
import type { InventoryItem } from "../../types/simulationTypes";
import { SHIFT_PRESETS } from "../../types/simulationTypes";
import { Field, NumberField, TextField } from "../shared/FormControls";

interface InventoryItemFormProps {
  /** Düzenleme modunda mevcut kalem; yeni kayıtta `null`. */
  initial?: InventoryItem | null;
  /** Modeldeki istasyonlar; kalem bunlardan birine bağlanabilir. */
  stationOptions: Array<{ id: string; name: string }>;
  isSaving: boolean;
  errors: string[];
  onSubmit: (item: InventoryItem) => void;
  onCancel: () => void;
}

function blankItem(): InventoryItem {
  return {
    id: "",
    name: "",
    unit: "adet",
    current_stock: 0,
    unit_cost: 1,
    lead_time_days: 7,
    daily_demand_avg: 0,
    daily_demand_std: 0,
    ordering_cost: 100,
    holding_cost_rate: 0.2,
    linked_station_id: null,
    production_minutes_per_day: null,
  };
}

/** Ada göre makine okunabilir bir kimlik üretir. */
function slugify(name: string): string {
  return name
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function InventoryItemForm({
  initial = null,
  stationOptions,
  isSaving,
  errors,
  onSubmit,
  onCancel,
}: InventoryItemFormProps) {
  const isEditing = initial !== null;
  const [draft, setDraft] = useState<InventoryItem>(initial ?? blankItem());

  /**
   * İstasyona bağlı ama günlük üretim süresi girilmemiş.
   *
   * Bu durumda kaydetme düğmesi kapalıdır. Sunucu isteği zaten reddederdi ama
   * kullanıcıyı bir tur ağ gidiş dönüşü ve genel bir hata mesajıyla
   * karşılaştırmak yerine eksiği yanında göstermek daha hızlı yol gösterir.
   */
  const needsMinutes =
    draft.linked_station_id !== null &&
    draft.linked_station_id !== undefined &&
    !(
      typeof draft.production_minutes_per_day === "number" &&
      Number.isFinite(draft.production_minutes_per_day) &&
      draft.production_minutes_per_day > 0
    );

  const update = (changes: Partial<InventoryItem>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // Kimlik addan türetilir; kullanıcıya ayrıca sorulmaz. Düzenlemede kimlik
    // sabit kalır — değiştirilmesi ortada iki kayıt bırakırdı.
    const id = isEditing ? draft.id : slugify(draft.name) || "kalem";
    onSubmit({ ...draft, id });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">Kalem</h3>

        <Field label="Kalem adı">
          {(id) => (
            <TextField
              id={id}
              value={draft.name}
              onChange={(name) => update({ name })}
              placeholder="Örn. Ham Kumaş"
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ölçü birimi" hint="adet, kg, metre…">
            {(id) => (
              <TextField
                id={id}
                value={draft.unit}
                onChange={(unit) => update({ unit })}
                placeholder="metre"
              />
            )}
          </Field>

          <Field label="Şu an elinizde ne kadar var?">
            {(id) => (
              <NumberField
                id={id}
                value={draft.current_stock}
                onChange={(current_stock) => update({ current_stock })}
                min={0}
                step="any"
                suffix={draft.unit}
              />
            )}
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">Tüketim</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Günde ortalama ne kadar harcanıyor?"
            help="Sipariş miktarı ve zamanı bu sayıdan hesaplanır. Bilinmiyorsa sıfır bırakabilirsiniz; o zaman yalnızca stok kaydı tutulur."
          >
            {(id) => (
              <NumberField
                id={id}
                value={draft.daily_demand_avg}
                onChange={(daily_demand_avg) => update({ daily_demand_avg })}
                min={0}
                step="any"
                suffix={`${draft.unit}/gün`}
              />
            )}
          </Field>

          <Field
            label="Günden güne ne kadar değişiyor?"
            help="Günlük tüketimin standart sapması. Güvenlik stokunu belirleyen tek şey budur: tüketim hiç değişmiyorsa güvenlik stoku da gerekmez."
          >
            {(id) => (
              <NumberField
                id={id}
                value={draft.daily_demand_std}
                onChange={(daily_demand_std) => update({ daily_demand_std })}
                min={0}
                step="any"
                suffix={draft.unit}
              />
            )}
          </Field>
        </div>

        <Field
          label="Sipariş verdikten kaç gün sonra geliyor?"
          help="Tedarik süresi. Yeniden sipariş noktası bu süre boyunca tüketilecek miktardan hesaplanır."
        >
          {(id) => (
            <NumberField
              id={id}
              value={draft.lead_time_days}
              onChange={(lead_time_days) => update({ lead_time_days })}
              min={0}
              step="any"
              suffix="gün"
            />
          )}
        </Field>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">Maliyetler</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Birim maliyeti">
            {(id) => (
              <NumberField
                id={id}
                value={draft.unit_cost}
                onChange={(unit_cost) => update({ unit_cost })}
                min={0.01}
                step="any"
              />
            )}
          </Field>

          <Field
            label="Her sipariş için sabit tutar"
            help="Miktardan bağımsız olarak her siparişte ödenen bedel: nakliye, işlem, kurulum. Bu maliyet büyük parti vermeye iter."
          >
            {(id) => (
              <NumberField
                id={id}
                value={draft.ordering_cost}
                onChange={(ordering_cost) => update({ ordering_cost })}
                min={0.01}
                step="any"
              />
            )}
          </Field>
        </div>

        <Field
          label={`Yıllık stok tutma maliyeti: %${Math.round(draft.holding_cost_rate * 100)}`}
          help="Bir birimi bir yıl elde tutmanın, birim maliyetine oranı. Depo, sigorta ve bağlanan sermayeyi kapsar. Bu maliyet küçük parti vermeye iter."
        >
          {(id) => (
            <input
              id={id}
              type="range"
              min={1}
              max={100}
              step={1}
              value={Math.round(draft.holding_cost_rate * 100)}
              onChange={(event) =>
                update({ holding_cost_rate: Number(event.target.value) / 100 })
              }
              className="w-full accent-brand-600"
            />
          )}
        </Field>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">Üretim bağlantısı</h3>

        <Field
          label="Bu kalemi hangi istasyon kullanıyor?"
          help="İsteğe bağlı. Bağlarsanız, stok tükendiğinde o istasyonun ne kadar üretim kaybedeceğini hesaplayabiliriz."
          hint={
            stationOptions.length === 0
              ? "Henüz bir model kurulmadı; bağlantı sonradan eklenebilir."
              : undefined
          }
        >
          {(id) => (
            <select
              id={id}
              value={draft.linked_station_id ?? ""}
              disabled={stationOptions.length === 0}
              onChange={(event) => {
                const linked = event.target.value || null;
                // Bağlantı kaldırılınca günlük süre de temizlenir: bağlantısız
                // bir süre ölü veridir ve şema onu reddeder.
                update({
                  linked_station_id: linked,
                  production_minutes_per_day: linked
                    ? (draft.production_minutes_per_day ?? null)
                    : null,
                });
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none disabled:opacity-50"
            >
              <option value="">Bağlı değil</option>
              {stationOptions.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        {/*
          Günlük üretim süresi yalnızca bağlantı kurulduğunda sorulur ve o
          zaman zorunludur. Varsayılan bir değer konmaz: kesintisiz çalışmayı
          varsaymak, tek vardiyalı bir fabrikanın üretim kaybını üç kat büyük
          gösterir ve kullanıcı bunu fark etmezdi.
        */}
        {draft.linked_station_id && (
          <Field
            label="Günde kaç dakika üretim yapılıyor?"
            help="Envanter gün, simülasyon dakika cinsinden çalışır. Üretim kaybını hesaplayabilmek için bu köprü gereklidir ve modelden türetilemez."
            hint={
              needsMinutes
                ? "Bu alan zorunludur; üretim etkisi bu bilgi olmadan hesaplanmaz."
                : undefined
            }
          >
            {(id) => (
              <div className="space-y-2">
                <NumberField
                  id={id}
                  value={draft.production_minutes_per_day ?? Number.NaN}
                  onChange={(minutes) =>
                    update({ production_minutes_per_day: minutes })
                  }
                  min={1}
                  max={1440}
                  step="any"
                  suffix="dk/gün"
                />
                <div className="flex flex-wrap gap-1.5">
                  {SHIFT_PRESETS.map((preset) => (
                    <button
                      key={preset.minutes}
                      type="button"
                      aria-pressed={draft.production_minutes_per_day === preset.minutes}
                      onClick={() =>
                        update({ production_minutes_per_day: preset.minutes })
                      }
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                        draft.production_minutes_per_day === preset.minutes
                          ? "bg-brand-600 text-white"
                          : "border border-slate-300 bg-white text-slate-700 hover:border-brand-300"
                      }`}
                    >
                      {preset.label} · {preset.minutes} dk
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Field>
        )}
      </section>

      {errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <ul className="list-inside list-disc space-y-1 text-sm text-red-800">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={isSaving || draft.name.trim().length === 0 || needsMinutes}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          {isSaving ? "Kaydediliyor…" : isEditing ? "Değişiklikleri kaydet" : "Kalemi ekle"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
        >
          Vazgeç
        </button>
      </div>
    </form>
  );
}
