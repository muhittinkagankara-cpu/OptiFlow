/**
 * Sihirbazın üç adımı arasında paylaşılan durum.
 *
 * Adımlar arasında gezinirken kurulan modelin kaybolmaması kritiktir: kullanıcı
 * 3. adımda özeti görüp editöre dönerse, yaptığı düzenlemeleri yeniden girmek
 * zorunda kalmamalıdır. Bu yüzden config tek bir yerde, Context'te tutulur;
 * adım bileşenleri yalnızca onu okur ve günceller.
 *
 * Canvas'ın kendisi de burada saklanır. Şemadan yalnızca config saklansaydı,
 * kullanıcı onay adımına geçip geri döndüğünde kutular otomatik yerleşime
 * sıfırlanırdı — 20 istasyonlu bir şemada bu, elle yapılan tüm düzenlemenin
 * kaybı demektir.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { SimulationConfig } from "../../types/simulationTypes";
import type { FlowEdge, FlowNode } from "../../lib/configBuilder";

export type WizardStepNumber = 1 | 2 | 3;

/** Şablon kimlikleri; "blank" sıfırdan kurulan model demektir. */
export type TemplateId = "tekstil" | "gida" | "metal" | "blank";

/** Süreç editöründen bırakılan canvas durumu. */
export interface FlowSnapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface WizardContextValue {
  step: WizardStepNumber;
  templateId: TemplateId | null;
  config: SimulationConfig | null;
  flow: FlowSnapshot | null;

  selectTemplate: (id: TemplateId, config: SimulationConfig | null) => void;
  updateConfig: (config: SimulationConfig) => void;
  setFlow: (flow: FlowSnapshot) => void;

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
  const [flow, setFlow] = useState<FlowSnapshot | null>(null);

  const selectTemplate = useCallback(
    (id: TemplateId, nextConfig: SimulationConfig | null) => {
      setTemplateId(id);
      // Şablon JSON'ı doğrudan state'e konmaz; derin kopyalanır. Aksi hâlde
      // kullanıcı düzenleme yaptığında içe aktarılan modülün kendisi değişir
      // ve sihirbaz ikinci kez açıldığında "boş" şablon dolu gelirdi.
      setConfig(nextConfig ? structuredClone(nextConfig) : null);
      // Şablon değişince eski canvas geçersizdir; yeni şablonun istasyonları
      // için yerleşim baştan kurulmalıdır.
      setFlow(null);
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
   * Kabuktaki "İleri" düğmesi ne zaman aktif olur?
   *
   * Yalnızca 1. adımda anlamlıdır ve bir şablon seçilmiş olmasını arar (boş
   * şablon da geçerli bir seçimdir). 2. adım süreç editörüdür; oradaki ilerleme
   * düğmesi editörün kendi araç çubuğundadır, çünkü ilerlemeden önce canvas'ın
   * geçerli bir şemaya çevrilebildiği doğrulanmalıdır. 3. adımda ileri gidilecek
   * bir yer yoktur.
   */
  const canGoNext = useMemo(() => step === 1 && templateId !== null, [step, templateId]);

  const value = useMemo<WizardContextValue>(
    () => ({
      step,
      templateId,
      config,
      flow,
      selectTemplate,
      updateConfig: setConfig,
      setFlow,
      goNext,
      goBack,
      goToStep: setStep,
      canGoNext,
    }),
    [step, templateId, config, flow, selectTemplate, goNext, goBack, canGoNext],
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
