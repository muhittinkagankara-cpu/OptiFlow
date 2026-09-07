/**
 * Kurulum akışının kabuğu — hero → sektör → kuruluyor.
 *
 * Üç ekran arasındaki geçişi ve seçilen sektörün şablona bağlanmasını yönetir.
 * Akış bittiğinde `onReady` ile şablonu üst katmana verir; oradan sonrası
 * mevcut sihirbazın işidir (süreç editörü ve onay adımı **değişmedi**).
 *
 * Sektör → şablon eşlemesi burada yapılır, `lib/onboarding` içinde değil:
 * saf mantık modülünün JSON şablonlarına ve onların doğrulama koduna bağımlı
 * olmaması, katalogun tek başına sınanabilmesini sağlıyor.
 */

import { useCallback, useMemo, useState } from "react";
import type { SimulationConfig } from "../../types/simulationTypes";
import {
  recentFactories,
  sectorById,
  type SectorId,
} from "../../lib/onboarding";
import type { RunHistoryEntry } from "../../lib/runHistory";
import type { Factory } from "../../types/simulationTypes";
import {
  gidaTemplate,
  metalTemplate,
  plastikTemplate,
  tekstilTemplate,
} from "../../templates";
import { BuildingScreen } from "./BuildingScreen";
import { HeroScreen } from "./HeroScreen";
import { SectorScreen } from "./SectorScreen";

/** Sektör kimliğinden şablona. `null`, boş şema demektir. */
const TEMPLATE_BY_SECTOR: Record<SectorId, SimulationConfig | null> = {
  metal: metalTemplate,
  gida: gidaTemplate,
  tekstil: tekstilTemplate,
  plastik: plastikTemplate,
  genel: null,
};

type Phase = "hero" | "sector" | "building";

interface OnboardingFlowProps {
  factories: Factory[];
  runHistory: RunHistoryEntry[];
  onOpenFactory: (factoryId: string) => void;
  /** Excel içe aktarma akışını açar. */
  onImportExcel: () => void;
  /** Kurulum bittiğinde seçilen şablonu verir. */
  onReady: (sectorId: SectorId, config: SimulationConfig | null) => void;
}

export function OnboardingFlow({
  factories,
  runHistory,
  onOpenFactory,
  onImportExcel,
  onReady,
}: OnboardingFlowProps) {
  const [phase, setPhase] = useState<Phase>("hero");
  const [sectorId, setSectorId] = useState<SectorId | null>(null);

  const recent = useMemo(
    () => recentFactories(factories, runHistory),
    [factories, runHistory],
  );

  const selectedConfig = sectorId ? TEMPLATE_BY_SECTOR[sectorId] : null;

  const handleDone = useCallback(() => {
    if (sectorId) {
      onReady(sectorId, TEMPLATE_BY_SECTOR[sectorId]);
    }
  }, [sectorId, onReady]);

  if (phase === "hero") {
    return (
      <HeroScreen
        onStart={() => setPhase("sector")}
        recent={recent}
        onOpenFactory={onOpenFactory}
        onImportExcel={onImportExcel}
      />
    );
  }

  if (phase === "sector") {
    return (
      <SectorScreen
        selected={sectorId}
        onSelect={setSectorId}
        selectedConfig={selectedConfig}
        onContinue={() => setPhase("building")}
        onBack={() => setPhase("hero")}
      />
    );
  }

  return (
    <BuildingScreen
      sectorTitle={sectorById(sectorId)?.title ?? "Genel Üretim"}
      onDone={handleDone}
    />
  );
}
