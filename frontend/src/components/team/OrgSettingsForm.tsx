/**
 * Organizasyon ayarları.
 *
 * Her alanın yanında **gerçekten kaydedilip kaydedilmediği** yazar. Üç durum
 * vardır ve üçü de aynı formda görünür: bu tarayıcıya yazılan alanlar, oturumdan
 * gelip değiştirilemeyen ad ve altyapısı olmadığı için hiçbir yere yazılmayan
 * bildirimler.
 *
 * Hepsini "Kaydet" diyen tek bir düğmenin altına koyup hiçbirini ayırmamak,
 * kullanıcının aylar sonra yanlış para biriminde rapor göndermesine yol açardı.
 */

import { useState } from "react";
import { Save } from "lucide-react";
import {
  SETTING_FIELDS,
  dailyWorkingHours,
  ignoredChanges,
  validateSettings,
  type OrgSettings,
} from "../../lib/team";
import { Badge, Button, Card, SectionTitle } from "../ui/Primitives";
import { PERSISTENCE_LABEL, PERSISTENCE_TONE } from "./teamStyles";

interface OrgSettingsFormProps {
  settings: OrgSettings;
  canEdit: boolean;
  denialReason: string;
  onSave: (next: Partial<OrgSettings>) => void;
}

const TIMEZONES = ["Europe/Istanbul", "Europe/Berlin", "Europe/London", "UTC"];
const CURRENCIES = ["TRY", "EUR", "USD"];

export function OrgSettingsForm({
  settings,
  canEdit,
  denialReason,
  onSave,
}: OrgSettingsFormProps) {
  const [draft, setDraft] = useState<OrgSettings>(settings);
  const [saved, setSaved] = useState(false);

  const issues = validateSettings(draft);
  const ignored = ignoredChanges(settings, draft);

  function update(patch: Partial<OrgSettings>) {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  }

  function save() {
    onSave(draft);
    setSaved(true);
  }

  return (
    <div>
      <SectionTitle
        title="Organizasyon ayarları"
        description="Her alanın altında nereye kaydedildiği yazar."
      />

      <Card className="p-4">
        <div className="space-y-4">
          {SETTING_FIELDS.map((field) => (
            <div key={field.key} className="border-b border-slate-200 pb-3 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor={`setting-${field.key}`}
                  className="text-sm font-medium text-slate-800"
                >
                  {field.label}
                </label>
                <Badge tone={PERSISTENCE_TONE[field.persistence]}>
                  {PERSISTENCE_LABEL[field.persistence]}
                </Badge>
              </div>

              <div className="mt-1.5">
                {field.key === "name" && (
                  <input
                    id="setting-name"
                    value={draft.name}
                    readOnly
                    className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
                  />
                )}

                {field.key === "timezone" && (
                  <select
                    id="setting-timezone"
                    value={draft.timezone}
                    disabled={!canEdit}
                    onChange={(event) => update({ timezone: event.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none disabled:bg-slate-100"
                  >
                    {TIMEZONES.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                )}

                {field.key === "currency" && (
                  <select
                    id="setting-currency"
                    value={draft.currency}
                    disabled={!canEdit}
                    onChange={(event) => update({ currency: event.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none disabled:bg-slate-100"
                  >
                    {CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                )}

                {field.key === "logoDataUrl" && (
                  <input
                    id="setting-logoDataUrl"
                    value={draft.logoDataUrl ?? ""}
                    disabled={!canEdit}
                    placeholder="data:image/png;base64,…"
                    onChange={(event) =>
                      update({
                        logoDataUrl: event.target.value === "" ? null : event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none disabled:bg-slate-100"
                  />
                )}

                {field.key === "shiftHours" && (
                  <input
                    id="setting-shiftHours"
                    type="number"
                    min={1}
                    max={24}
                    value={draft.shiftHours}
                    disabled={!canEdit}
                    onChange={(event) =>
                      update({ shiftHours: Number(event.target.value) })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none disabled:bg-slate-100"
                  />
                )}

                {field.key === "shiftsPerDay" && (
                  <input
                    id="setting-shiftsPerDay"
                    type="number"
                    min={1}
                    max={3}
                    value={draft.shiftsPerDay}
                    disabled={!canEdit}
                    onChange={(event) =>
                      update({ shiftsPerDay: Number(event.target.value) })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none disabled:bg-slate-100"
                  />
                )}

                {field.persistence === "unavailable" && (
                  <label className="flex items-center gap-2 text-sm text-slate-500">
                    <input
                      id={`setting-${field.key}`}
                      type="checkbox"
                      checked={false}
                      disabled
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Kapalı
                  </label>
                )}
              </div>

              {field.note !== null && (
                <p className="mt-1 text-xs text-slate-500">{field.note}</p>
              )}
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Günlük toplam çalışma süresi: {dailyWorkingHours(draft)} saat
        </p>

        {issues.length > 0 && (
          <ul className="mt-2 space-y-1 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
            {issues.map((issue) => (
              <li key={`${issue.key}-${issue.text}`}>{issue.text}</li>
            ))}
          </ul>
        )}

        {ignored.length > 0 && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            Şu alanlar kaydedilmeyecek: {ignored.join(", ")}. Bu sürümde
            karşılıkları olan bir uç ya da depo yok.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            {saved
              ? "Kaydedilebilen alanlar bu tarayıcıya yazıldı."
              : "Kayıt bu cihazda tutulur; başka bir cihazda görünmez."}
          </p>
          <Button
            variant="primary"
            icon={Save}
            disabled={!canEdit || issues.length > 0}
            title={canEdit ? "Ayarları kaydet" : denialReason}
            onClick={save}
          >
            Kaydet
          </Button>
        </div>

        {!canEdit && (
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
            {denialReason}
          </p>
        )}
      </Card>
    </div>
  );
}
