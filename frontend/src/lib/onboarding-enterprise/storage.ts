/**
 * Kurulum durumunun tarayıcıda saklanması.
 *
 * Kurulum bir oturumda bitmeyebilir: yönetici şirket bilgilerini girip
 * makineleri ertesi güne bırakabilir. Sekme kapandığında her şeyin silinmesi,
 * kurulumun hiç bitmemesinin en hızlı yoludur.
 *
 * Saklama bilinçli olarak tarayıcıdadır — bu sprintte backend'e dokunulmuyor.
 * Sunucuya taşındığında değişecek tek yer bu dosyadaki iki çağrıdır; ekranlar
 * aynı kalır ve arayüz kapsamın sınırını yazar.
 */

import { defaultSettings, emptyMilestones, emptyState } from "./fixtures";
import {
  MACHINE_KINDS,
  type ConnectorHealthCard,
  type EnterpriseState,
  type Machine,
  type MachineKind,
  type MachineStatus,
} from "./types";

const STORAGE_KEY = "optiflow.enterprise.setup";

function isKind(value: unknown): value is MachineKind {
  return MACHINE_KINDS.includes(value as MachineKind);
}

function isStatus(value: unknown): value is MachineStatus {
  return value === "active" || value === "maintenance" || value === "fault";
}

export function isValidMachine(value: unknown): value is Machine {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    isKind(item.kind) &&
    isStatus(item.status) &&
    (item.serialNumber === null || typeof item.serialNumber === "string") &&
    (item.installedYear === null || typeof item.installedYear === "number") &&
    (item.lastMaintenanceAt === null || typeof item.lastMaintenanceAt === "string") &&
    (item.operator === null || typeof item.operator === "string") &&
    (item.factoryId === null || typeof item.factoryId === "string")
  );
}

/**
 * Ham metni duruma çevirir.
 *
 * Tanınmayan makine kayıtları atılır ama kurulum silinmez: tek bozuk satır
 * yüzünden bütün kurulumu sıfırlamak, kullanıcıya işi baştan yaptırmak olurdu.
 */
export function parseState(raw: string | null): EnterpriseState {
  if (raw === null) {
    return emptyState();
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return emptyState();
    }
    const item = parsed as Record<string, unknown>;

    const machines = Array.isArray(item.machines)
      ? (item.machines.filter(isValidMachine) as Machine[])
      : [];

    const factories = Array.isArray(item.factories)
      ? (item.factories.filter(
          (factory): factory is EnterpriseState["factories"][number] =>
            typeof factory === "object" &&
            factory !== null &&
            typeof (factory as Record<string, unknown>).id === "string" &&
            typeof (factory as Record<string, unknown>).name === "string",
        ) as EnterpriseState["factories"])
      : [];

    const company =
      typeof item.company === "object" &&
      item.company !== null &&
      typeof (item.company as Record<string, unknown>).name === "string"
        ? (item.company as EnterpriseState["company"])
        : null;

    const settings =
      typeof item.settings === "object" && item.settings !== null
        ? { ...defaultSettings(), ...(item.settings as object) }
        : defaultSettings();

    const milestones =
      typeof item.milestones === "object" && item.milestones !== null
        ? { ...emptyMilestones(), ...(item.milestones as object) }
        : emptyMilestones();

    return { company, factories, machines, settings, milestones };
  } catch {
    return emptyState();
  }
}

export function recallState(): EnterpriseState {
  try {
    return parseState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Gizli sekmede depolama okuması hata verir; kurulum o oturumda sıfırdan
    // başlar ve bu, uygulamayı durdurmaktan iyidir.
    return emptyState();
  }
}

export function rememberState(state: EnterpriseState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Depolama yoksa kurulum yalnızca bu oturumda yaşar. */
  }
}

export function clearState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* yok sayılır */
  }
}

/* -------------------------------------------------------------------------- */
/* Bağlayıcı anlık görüntüsü                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Bağlayıcı merkezinin son bilinen durumu.
 *
 * Bağlantı durumu o ekranın kendi deposunda yaşar; kurulum kartı ve hazırlık
 * puanı ise başka ekranlarda görünür. İki ekranın aynı anda açık olması
 * gerekmediği için, bağlayıcı merkezi durumunu her değişiklikte buraya yazar ve
 * ötekiler **son bilinen** hâli okur.
 *
 * Bu bir canlı bağlantı değildir ve öyle sunulmaz: kartlarda benzetim rozeti
 * durur, kaydın kendisi de yalnızca en son görülen durumu taşır.
 */
export interface ConnectorSnapshot {
  connectorCount: number;
  connectedCount: number;
  cards: ConnectorHealthCard[];
  /** Kaydın alındığı an. */
  atMs: number;
}

const CONNECTOR_KEY = "optiflow.enterprise.connectorSnapshot";

export function emptyConnectorSnapshot(): ConnectorSnapshot {
  return { connectorCount: 0, connectedCount: 0, cards: [], atMs: 0 };
}

export function parseConnectorSnapshot(raw: string | null): ConnectorSnapshot {
  if (raw === null) {
    return emptyConnectorSnapshot();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return emptyConnectorSnapshot();
    }
    const item = parsed as Record<string, unknown>;
    return {
      connectorCount:
        typeof item.connectorCount === "number" ? item.connectorCount : 0,
      connectedCount:
        typeof item.connectedCount === "number" ? item.connectedCount : 0,
      cards: Array.isArray(item.cards)
        ? (item.cards.filter(
            (card): card is ConnectorHealthCard =>
              typeof card === "object" &&
              card !== null &&
              typeof (card as Record<string, unknown>).configId === "string",
          ) as ConnectorHealthCard[])
        : [],
      atMs: typeof item.atMs === "number" ? item.atMs : 0,
    };
  } catch {
    return emptyConnectorSnapshot();
  }
}

export function recallConnectorSnapshot(): ConnectorSnapshot {
  try {
    return parseConnectorSnapshot(window.localStorage.getItem(CONNECTOR_KEY));
  } catch {
    return emptyConnectorSnapshot();
  }
}

export function rememberConnectorSnapshot(snapshot: ConnectorSnapshot): void {
  try {
    window.localStorage.setItem(CONNECTOR_KEY, JSON.stringify(snapshot));
  } catch {
    /* Depolama yoksa özet yalnızca bu oturumda yaşar. */
  }
}
