/**
 * Sihirbazın üç adımı arasında paylaşılan durum.
 *
 * Adımlar arasında gezinirken kurulan modelin kaybolmaması kritiktir: kullanıcı
 * 3. adımda özeti görüp 2. adıma dönerse, yaptığı düzenlemeleri yeniden
 * girmek zorunda kalmamalıdır. Bu yüzden config tek bir yerde, Context'te
 * tutulur; adım bileşenleri yalnızca onu okur ve günceller.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { SimulationConfig } from "../../types/simulationTypes";

export type WizardStepNumber = 1 | 2 | 3;

/** Şablon kimlikleri; "blank" sıfırdan kurulan model demektir. */
export type TemplateId = "tekstil" | "gida" | "metal" | "blank";

interface WizardContextValue {
  step: WizardStepNumber;
  templateId: TemplateId | null;
  config: SimulationConfig | null;
  description: string;

  selectTemplate: (id: TemplateId, config: SimulationConfig | null) => void;
  updateConfig: (config: SimulationConfig) => void;
  setDescription: (text: string) => void;

  goNext: () => void;
  goBack: () => void;
  goToStep: (step: WizardStepNumber) => void;
  canGoNext: boolean;
}

const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<WizardStepNumber>(1);
  const [templateId, setTemplateId] = useState<TemplateId | null>(null);
  const [config, setConfig] = useState<SimulationConfig | null>(null);
  const [description, setDescription] = useState("");

  const selectTemplate = useCallback(
    (id: TemplateId, nextConfig: SimulationConfig | null) => {
      setTemplateId(id);
      // Şablon JSON'ı doğrudan state'e konmaz; derin kopyalanır. Aksi hâlde
      // kullanıcı düzenleme yaptığında içe aktarılan modülün kendisi değişir
      // ve sihirbaz ikinci kez açıldığında "boş" şablon dolu gelirdi.
      setConfig(nextConfig ? structuredClone(nextConfig) : null);
    },
    [],
  );

  const goNext = useCallback(() => {
    setStep((current) => (current < 3 ? ((current + 1) as WizardStepNumber) : current));
  }, []);

  const goBack = useCallback(() => {
    setStep((current) => (current > 1 ? ((current - 1) as WizardStepNumber) : current));
  }, []);

  /**
   * "İleri" düğmesi ne zaman aktif olur?
   *
   * 1. adım: bir şablon seçilmiş olmalı (boş şablon da geçerli bir seçimdir).
   * 2. adım: en az bir istasyonu olan bir model kurulmuş olmalı — boş şablonla
   *          başlayan kullanıcı hiç istasyon eklemeden 3. adıma geçememeli.
   */
  const canGoNext = useMemo(() => {
    if (step === 1) {
      return templateId !== null;
    }
    if (step === 2) {
      return (config?.stations.length ?? 0) > 0;
    }
    return false;
  }, [step, templateId, config]);

  const value = useMemo<WizardContextValue>(
    () => ({
      step,
      templateId,
      config,
      description,
      selectTemplate,
      updateConfig: setConfig,
      setDescription,
      goNext,
      goBack,
      goToStep: setStep,
      canGoNext,
    }),
    [step, templateId, config, description, selectTemplate, goNext, goBack, canGoNext],
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error("useWizard yalnızca WizardProvider içinde kullanılabilir.");
  }
  return context;
}
