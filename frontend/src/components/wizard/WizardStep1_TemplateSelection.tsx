/**
 * Adım 1/3 — Sektör şablonu seçimi.
 *
 * Kullanıcının ürünle ilk teması burasıdır. Amaç, "ne yapmam gerekiyor?"
 * sorusunu hiç doğurmadan tek tıkla ilerletmek: dört seçenek, her biri tek
 * cümlelik açıklama, hemen görünen sonuç. Form yok, ayar yok.
 */

import { useMemo } from "react";
import type { SimulationConfig } from "../../types/simulationTypes";
import {
  BlankIcon,
  CheckIcon,
  FoodIcon,
  MetalIcon,
  TextileIcon,
} from "../shared/icons";
import { useWizard, type TemplateId } from "./WizardContext";
import { gidaTemplate, metalTemplate, tekstilTemplate } from "../../templates";

interface TemplateOption {
  id: TemplateId;
  title: string;
  summary: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  config: SimulationConfig | null;
}

const TEMPLATES: TemplateOption[] = [
  {
    id: "tekstil",
    title: "Tekstil Üretimi",
    summary: "3 istasyonlu örnek dikiş hattı",
    detail: "Kesim → Dikiş → Kalite Kontrol",
    icon: TextileIcon,
    config: tekstilTemplate,
  },
  {
    id: "gida",
    title: "Gıda İşleme",
    summary: "3 istasyonlu paketleme hattı",
    detail: "Yıkama → Doğrama → Paketleme",
    icon: FoodIcon,
    config: gidaTemplate,
  },
  {
    id: "metal",
    title: "Metal İşleme",
    summary: "4 istasyonlu talaşlı imalat hattı",
    detail: "Kesme → Torna → Kaynak → Boyama",
    icon: MetalIcon,
    config: metalTemplate,
  },
  {
    id: "blank",
    title: "Boş Şablon",
    summary: "Kendi sürecimi sıfırdan kurayım",
    detail: "İstasyonları tek tek siz eklersiniz",
    icon: BlankIcon,
    config: null,
  },
];

export function WizardStep1_TemplateSelection() {
  const { templateId, selectTemplate } = useWizard();

  const selected = useMemo(
    () => TEMPLATES.find((template) => template.id === templateId) ?? null,
    [templateId],
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h2 className="text-xl font-semibold text-slate-900">
          Hangi tür üretim yapıyorsunuz?
        </h2>
        <p className="text-sm text-slate-600">
          Size en yakın örneği seçin; hazır bir model yükleyelim. Sonraki adımda
          istasyonları şema üzerinde görecek, kendi rakamlarınıza göre
          düzenleyeceksiniz.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {TEMPLATES.map((template) => {
          const Icon = template.icon;
          const isSelected = templateId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              aria-pressed={isSelected}
              // Açık bir ad verilmezse ekran okuyucu kartın içindeki üç metni
              // birleştirerek okur; kısa ve ayırt edici bir ad daha kullanışlı.
              aria-label={`${template.title} — ${template.summary}`}
              onClick={() => selectTemplate(template.id, template.config)}
              className={`group relative flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                isSelected
                  ? "border-brand-500 bg-brand-50 shadow-sm"
                  : "border-slate-200 bg-white hover:border-brand-300 hover:shadow-sm"
              }`}
            >
              {isSelected && (
                <span className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white">
                  <CheckIcon className="h-4 w-4" />
                </span>
              )}
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
                  isSelected
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-600 group-hover:bg-brand-100 group-hover:text-brand-700"
                }`}
              >
                <Icon className="h-6 w-6" />
              </span>
              <span className="space-y-1">
                <span className="block font-semibold text-slate-900">{template.title}</span>
                <span className="block text-sm text-slate-600">{template.summary}</span>
                <span className="block text-xs text-slate-400">{template.detail}</span>
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
          {selected.config
            ? `“${selected.title}” şablonu yüklendi — ${selected.config.stations.length} istasyon. Sonraki adımda şema üzerinde düzenleyebilirsiniz.`
            : "Boş şablonla devam ediyorsunuz. Sonraki adımda istasyonlarınızı şemaya ekleyeceksiniz."}
        </p>
      )}
    </div>
  );
}
