/**
 * Kurumsal kurulumun örnek verisi ve varsayılanları.
 *
 * Örnek durum bilinçli olarak **yarım**dır: şirket ve fabrika tanımlı, makine
 * envanteri eksik, simülasyon alınmamış. Kurulum ekranının asıl işi eksikleri
 * göstermek olduğuna göre, örnek veri de eksikleri göstermelidir.
 */

import {
  type CompanyProfile,
  type EnterpriseSettings,
  type EnterpriseState,
  type FactoryProfile,
  type Machine,
  type Milestones,
  type ReadinessSignals,
} from "./types";

/** Varsayılan kurumsal ayarlar. */
export function defaultSettings(): EnterpriseSettings {
  return {
    logoDataUrl: null,
    brandColor: "#3B82F6",
    currency: "TRY",
    timezone: "Europe/Istanbul",
    locale: "tr-TR",
    pdfTitle: "Üretim Analiz Raporu",
  };
}

export function emptyMilestones(): Milestones {
  return { firstReportAtMs: null, setupCompletedAtMs: null };
}

/** Hiç kurulum yapılmamış durum. */
export function emptyState(): EnterpriseState {
  return {
    company: null,
    factories: [],
    machines: [],
    settings: defaultSettings(),
    milestones: emptyMilestones(),
  };
}

/** Hiçbir kanıtın olmadığı sinyaller. */
export function emptySignals(): ReadinessSignals {
  return {
    hasSimulationRun: false,
    savedFactoryCount: 0,
    validationCount: 0,
    connectorCount: 0,
    connectedCount: 0,
  };
}

export function sampleCompany(): CompanyProfile {
  return {
    name: "Kuzey Metal A.Ş.",
    logoDataUrl: null,
    sector: "metal",
    factoryCount: 2,
    currency: "TRY",
  };
}

export function sampleFactory(): FactoryProfile {
  return {
    id: "fab-kuzey-1",
    name: "Kuzey Hat 1",
    location: "Kocaeli",
    lineCount: 2,
    shiftsPerDay: 2,
    shiftHours: 8,
  };
}

export function sampleMachines(): Machine[] {
  return [
    {
      id: "mch-1",
      factoryId: "fab-kuzey-1",
      name: "CNC-01",
      kind: "cnc",
      serialNumber: "SN-1001",
      status: "active",
      installedYear: 2019,
      lastMaintenanceAt: "2026-06-01T08:00:00.000Z",
      operator: "Ahmet Yılmaz",
    },
    {
      id: "mch-2",
      factoryId: "fab-kuzey-1",
      name: "Pres-01",
      kind: "press",
      serialNumber: "SN-1002",
      status: "maintenance",
      installedYear: 2015,
      lastMaintenanceAt: "2025-11-12T08:00:00.000Z",
      operator: "Selin Arslan",
    },
    {
      id: "mch-3",
      factoryId: "fab-kuzey-1",
      name: "Torna-01",
      kind: "lathe",
      // Seri numarası bilerek eksik: doğrulama uyarısı örnekte de görünmeli.
      serialNumber: null,
      status: "active",
      installedYear: 2021,
      lastMaintenanceAt: null,
      operator: null,
    },
    {
      id: "mch-4",
      factoryId: "fab-kuzey-1",
      name: "Kaynak-01",
      kind: "welding",
      serialNumber: "SN-1004",
      status: "fault",
      installedYear: 2013,
      lastMaintenanceAt: "2026-01-20T08:00:00.000Z",
      operator: "Murat Kaya",
    },
  ];
}

/** Yarım kalmış örnek kurulum. */
export function sampleState(): EnterpriseState {
  return {
    company: sampleCompany(),
    factories: [sampleFactory()],
    machines: sampleMachines(),
    settings: defaultSettings(),
    milestones: emptyMilestones(),
  };
}

/** Kurulumu bitmiş örnek durum; başarı ekranının sınanması için. */
export function completedState(nowMs = 1_700_000_000_000): EnterpriseState {
  return {
    company: { ...sampleCompany(), logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" },
    factories: [sampleFactory()],
    machines: [
      ...sampleMachines().map((machine, index) => ({
        ...machine,
        serialNumber: machine.serialNumber ?? `SN-200${index}`,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `mch-ek-${index}`,
        factoryId: "fab-kuzey-1",
        name: `Robot-0${index + 1}`,
        kind: "robot" as const,
        serialNumber: `SN-300${index}`,
        status: "active" as const,
        installedYear: 2022,
        lastMaintenanceAt: "2026-08-01T08:00:00.000Z",
        operator: "Vardiya ekibi",
      })),
    ],
    settings: defaultSettings(),
    milestones: { firstReportAtMs: nowMs, setupCompletedAtMs: nowMs },
  };
}

/** Kurulumu bitmiş bir müşterinin sinyalleri. */
export function completedSignals(): ReadinessSignals {
  return {
    hasSimulationRun: true,
    savedFactoryCount: 1,
    validationCount: 2,
    connectorCount: 3,
    connectedCount: 3,
  };
}
