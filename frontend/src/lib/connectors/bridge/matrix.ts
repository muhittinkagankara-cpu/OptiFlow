/**
 * Bağlayıcı uyumluluk matrisi.
 *
 * "Hangi protokol gerçekten çalışıyor?" sorusunun tek yanıtı burasıdır. Üç
 * durum vardır ve aralarındaki fark ürünün en önemli dürüstlük çizgisidir:
 *
 * - **Gerçek doğrulandı** — sunucu gerçek bir cihaza/servise bağlandı ve
 *   ondan somut bir yanıt aldı (kanıt kaydedildi).
 * - **Benzetim** — veri üretiliyor ama bir cihazdan gelmiyor; ekranların nasıl
 *   göründüğünü göstermek için var.
 * - **Doğrulanmadı** — mimari hazır, ama hiçbir gerçek cihazla sınanmadı.
 *
 * Ölçüt tek: **bu oturumda gerçek bir cihaz yanıtı görüldü mü?** Kütüphanenin
 * kurulu olması, uç noktanın yazılmış olması ya da testlerin geçmesi bir
 * bağlantıyı "doğrulandı" yapmaz.
 */

import type { ConnectorKind } from "../types";
import type { BridgeConnection, BridgeKind } from "./types";

/** Matristeki bir satırın durumu. */
export type MatrixVerdict = "verified" | "simulated" | "unverified";

export const VERDICT_LABEL: Record<MatrixVerdict, string> = {
  verified: "Gerçek doğrulandı",
  simulated: "Benzetim",
  unverified: "Doğrulanmadı",
};

export interface MatrixRow {
  kind: ConnectorKind;
  label: string;
  verdict: MatrixVerdict;
  /** Sunucu köprüsünde bu protokolün sürücüsü var mı? */
  hasServerBridge: boolean;
  /** Tarayıcı tarafında gerçek bir istemci var mı? */
  hasBrowserClient: boolean;
  /** Bu oturumda kaç bağlantı doğrulandı? */
  verifiedCount: number;
  /** Durumun tek cümlelik gerekçesi. */
  reason: string;
  /** Cihazdan alınan son kanıt; yoksa `null`. */
  evidence: string | null;
}

/** Köprüde sürücüsü olan protokoller. */
export const SERVER_BRIDGE_KINDS: BridgeKind[] = ["rest", "opcua", "mqtt"];

const KIND_LABEL: Record<ConnectorKind, string> = {
  rest: "REST",
  opcua: "OPC UA",
  mqtt: "MQTT",
  csv: "CSV",
  erp: "ERP",
};

/** Bir protokolün sunucu köprüsünde sürücüsü var mı? */
export function hasServerBridge(kind: ConnectorKind): boolean {
  return (SERVER_BRIDGE_KINDS as string[]).includes(kind);
}

/**
 * Tek bir protokolün durumu.
 *
 * Doğrulama **bağlantı bazındadır**: bir OPC UA bağlantısı doğrulandıysa OPC UA
 * satırı "Gerçek doğrulandı" olur. Hiç bağlantı yoksa ya da hiçbiri gerçek
 * yanıt almadıysa satır "Doğrulanmadı" kalır — sürücünün var olması yetmez.
 */
export function verdictFor(
  kind: ConnectorKind,
  connections: BridgeConnection[],
  options: { browserClient?: boolean; simulated?: boolean } = {},
): MatrixRow {
  const own = connections.filter((connection) => connection.kind === (kind as BridgeKind));
  const verified = own.filter((connection) => connection.everVerified);
  const bridge = hasServerBridge(kind);
  const browserClient = options.browserClient === true;

  const evidence =
    verified
      .map((connection) => connection.lastProbe?.evidence ?? null)
      .find((item): item is string => item !== null) ?? null;

  if (verified.length > 0) {
    return {
      kind,
      label: KIND_LABEL[kind],
      verdict: "verified",
      hasServerBridge: bridge,
      hasBrowserClient: browserClient,
      verifiedCount: verified.length,
      reason: `${verified.length} bağlantı gerçek bir yanıt aldı.`,
      evidence,
    };
  }

  if (options.simulated === true) {
    return {
      kind,
      label: KIND_LABEL[kind],
      verdict: "simulated",
      hasServerBridge: bridge,
      hasBrowserClient: browserClient,
      verifiedCount: 0,
      reason: "Veri üretiliyor ama bir cihazdan gelmiyor.",
      evidence: null,
    };
  }

  const attempted = own.filter((connection) => connection.status !== "idle");
  return {
    kind,
    label: KIND_LABEL[kind],
    verdict: "unverified",
    hasServerBridge: bridge,
    hasBrowserClient: browserClient,
    verifiedCount: 0,
    reason: bridge
      ? attempted.length > 0
        ? "Denendi ama hiçbir bağlantı doğrulanmadı."
        : "Sunucu sürücüsü hazır; henüz gerçek bir cihazla sınanmadı."
      : "Sunucu köprüsünde bu protokolün sürücüsü yok.",
    evidence: null,
  };
}

/** Matrisin tamamı. */
export function compatibilityMatrix(
  connections: BridgeConnection[],
  options: {
    /** Tarayıcı tarafında gerçek istemcisi olan protokoller. */
    browserClients?: ConnectorKind[];
    /** Yalnızca benzetim verisi üreten protokoller. */
    simulated?: ConnectorKind[];
  } = {},
): MatrixRow[] {
  const browser = new Set(options.browserClients ?? []);
  const simulated = new Set(options.simulated ?? []);
  const kinds: ConnectorKind[] = ["rest", "opcua", "mqtt", "csv", "erp"];

  return kinds.map((kind) =>
    verdictFor(kind, connections, {
      browserClient: browser.has(kind),
      simulated: simulated.has(kind),
    }),
  );
}

/** Kaç protokol gerçekten doğrulandı? */
export function verifiedCount(rows: MatrixRow[]): number {
  return rows.filter((row) => row.verdict === "verified").length;
}

/**
 * Matrisin tek cümlelik özeti.
 *
 * Hiçbir şey doğrulanmadıysa bunu açıkça söyler; "5 protokol destekleniyor"
 * demek, hiçbiri sınanmamışken bile doğru görünen ama yanlış anlaşılan bir
 * cümledir.
 */
export function matrixSummary(rows: MatrixRow[]): string {
  const verified = verifiedCount(rows);
  if (verified === 0) {
    return "Bu oturumda hiçbir protokol gerçek bir cihazla doğrulanmadı.";
  }
  const names = rows
    .filter((row) => row.verdict === "verified")
    .map((row) => row.label)
    .join(", ");
  return `${verified} protokol gerçek yanıt aldı: ${names}.`;
}
