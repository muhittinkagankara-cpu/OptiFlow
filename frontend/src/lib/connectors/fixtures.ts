/**
 * Örnek bağlantılar, düğümler ve eşlemeler.
 *
 * Boş bir bağlayıcı ekranı ürünün ne yaptığını anlatmaz: kullanıcı beş boş kart
 * görür ve nereden başlayacağını bilemez. Örnek kurulum, gerçek bir fabrikada
 * karşılaşılacak hâli gösterir — biri bağlı, biri yeniden deniyor, biri hiç
 * yapılandırılmamış.
 *
 * Buradaki adresler gerçek bir cihaza işaret etmez ve arayüz bunu açıkça
 * yazar; örnek veriyi canlı sanan bir kullanıcı, olmayan bir hattı izlediğini
 * fark etmezdi.
 */

import {
  type ConnectorConfig,
  type ConnectorRuntime,
  type FieldMapping,
  type SourceNode,
} from "./types";

/** Örnek istasyonlar; eşleme ekranının sağ sütunu bunları listeler. */
export const SAMPLE_STATIONS = [
  { id: "kesim", name: "Kesim" },
  { id: "torna", name: "Torna" },
  { id: "kaynak", name: "Kaynak" },
];

export function sampleConfigs(): ConnectorConfig[] {
  return [
    {
      id: "conn-opcua",
      kind: "opcua",
      name: "Hat 1 PLC",
      settings: {
        endpoint: "opc.tcp://192.168.1.10:4840",
        securityPolicy: "Basic256Sha256",
        username: "optiflow",
        password: "gizli",
        nodePrefix: "ns=2;s=Line1",
      },
      autoReconnect: true,
    },
    {
      id: "conn-mqtt",
      kind: "mqtt",
      name: "Sensör ağı",
      settings: {
        broker: "mqtt://192.168.1.20",
        port: 1883,
        topic: "fabrika/hat1/#",
        username: null,
        password: null,
        qos: "1",
        tls: false,
      },
      autoReconnect: true,
    },
    {
      id: "conn-rest",
      kind: "rest",
      name: "MES ucu",
      settings: {
        baseUrl: "https://mes.fabrika.local/api",
        apiKey: "demo-anahtar",
        bearer: null,
        refreshSeconds: 30,
        healthPath: "/health",
      },
      autoReconnect: true,
    },
    {
      id: "conn-csv",
      kind: "csv",
      name: "Vardiya raporları",
      settings: {
        folder: "\\\\sunucu\\uretim\\raporlar",
        pattern: "vardiya-*.csv",
        intervalMinutes: 15,
        deleteAfterImport: false,
      },
      autoReconnect: false,
    },
    {
      id: "conn-erp",
      kind: "erp",
      name: "ERP",
      settings: {
        baseUrl: null,
        company: null,
        apiKey: null,
        syncOrders: false,
      },
      autoReconnect: true,
    },
  ];
}

/**
 * Örnek çalışma zamanı durumları.
 *
 * Beş bağlantı beş farklı hâlde: bağlı, bağlı, yeniden deniyor, kopuk ve hiç
 * bağlanmamış. Sağlık panosunun ve renklerin hepsi tek ekranda görünür.
 */
export function sampleRuntimes(nowMs: number): Record<string, ConnectorRuntime> {
  return {
    "conn-opcua": {
      configId: "conn-opcua",
      status: "connected",
      attempt: 0,
      nextRetryAtMs: null,
      lastSyncAtMs: nowMs - 4_000,
      lastLatencyMs: 42,
      latencySamplesMs: [38, 41, 47, 44, 39, 42],
      syncErrors: 0,
      recordsReceived: 1_284,
      detail: null,
    },
    "conn-mqtt": {
      configId: "conn-mqtt",
      status: "connected",
      attempt: 0,
      nextRetryAtMs: null,
      lastSyncAtMs: nowMs - 1_500,
      lastLatencyMs: 28,
      latencySamplesMs: [31, 26, 29, 33, 28],
      syncErrors: 1,
      recordsReceived: 4_910,
      detail: null,
    },
    "conn-rest": {
      configId: "conn-rest",
      status: "retrying",
      attempt: 2,
      nextRetryAtMs: nowMs + 2_000,
      lastSyncAtMs: nowMs - 95_000,
      lastLatencyMs: 260,
      latencySamplesMs: [240, 268, 255],
      syncErrors: 3,
      recordsReceived: 612,
      detail: "504 Gateway Timeout",
    },
    "conn-csv": {
      configId: "conn-csv",
      status: "disconnected",
      attempt: 0,
      nextRetryAtMs: null,
      lastSyncAtMs: nowMs - 3_600_000,
      lastLatencyMs: null,
      latencySamplesMs: [],
      syncErrors: 0,
      recordsReceived: 96,
      detail: null,
    },
    "conn-erp": {
      configId: "conn-erp",
      status: "idle",
      attempt: 0,
      nextRetryAtMs: null,
      lastSyncAtMs: null,
      lastLatencyMs: null,
      latencySamplesMs: [],
      syncErrors: 0,
      recordsReceived: 0,
      detail: null,
    },
  };
}

/**
 * Örnek düğümler.
 *
 * Üç protokolün adresleme biçimi bilinçli olarak farklı yazılmıştır: OPC UA
 * düğümü, MQTT konusu ve REST alanı sahada da böyle görünür ve eşleme ekranının
 * üçünü de aynı listede gösterebildiği ancak böyle anlaşılır.
 */
export function sampleSources(): SourceNode[] {
  return [
    {
      id: "src-opcua-queue",
      connectorId: "conn-opcua",
      kind: "opcua",
      address: "ns=2;s=Line1.St1.Queue",
      label: "Kesim kuyruk",
      dataType: "number",
      unit: "adet",
      sample: "4",
    },
    {
      id: "src-opcua-cycle",
      connectorId: "conn-opcua",
      kind: "opcua",
      address: "ns=2;s=Line1.St1.CycleTime",
      label: "Kesim çevrim süresi",
      dataType: "number",
      unit: "sn",
      sample: "92",
    },
    {
      id: "src-opcua-state",
      connectorId: "conn-opcua",
      kind: "opcua",
      address: "ns=2;s=Line1.St1.State",
      label: "Kesim makine durumu",
      dataType: "enum",
      unit: null,
      sample: "RUNNING",
    },
    {
      id: "src-opcua-count",
      connectorId: "conn-opcua",
      kind: "opcua",
      address: "ns=2;s=Line1.St1.Counter",
      label: "Kesim sayaç",
      dataType: "number",
      unit: "adet",
      sample: "1284",
    },
    {
      id: "src-mqtt-queue",
      connectorId: "conn-mqtt",
      kind: "mqtt",
      address: "fabrika/hat1/torna/kuyruk",
      label: "Torna kuyruk",
      dataType: "number",
      unit: "adet",
      sample: "7",
    },
    {
      id: "src-mqtt-scrap",
      connectorId: "conn-mqtt",
      kind: "mqtt",
      address: "fabrika/hat1/torna/fire",
      label: "Torna fire sayacı",
      dataType: "number",
      unit: "adet",
      sample: "3",
    },
    {
      id: "src-mqtt-state",
      connectorId: "conn-mqtt",
      kind: "mqtt",
      address: "fabrika/hat1/torna/durum",
      label: "Torna durum",
      dataType: "string",
      unit: null,
      sample: "idle",
    },
    {
      id: "src-rest-count",
      connectorId: "conn-rest",
      kind: "rest",
      address: "stations[2].producedCount",
      label: "Kaynak üretim adedi",
      dataType: "number",
      unit: "adet",
      sample: "612",
    },
    {
      id: "src-rest-cycle",
      connectorId: "conn-rest",
      kind: "rest",
      address: "stations[2].cycleSeconds",
      label: "Kaynak çevrim süresi",
      dataType: "number",
      unit: "sn",
      sample: "180",
    },
    {
      id: "src-rest-note",
      connectorId: "conn-rest",
      kind: "rest",
      address: "stations[2].note",
      label: "Kaynak vardiya notu",
      dataType: "string",
      unit: null,
      sample: "Bakım planlandı",
    },
  ];
}

/** Örnek eşlemeler; bilinçli olarak eksiktir, doğrulama uyarıları görünür. */
export function sampleMappings(): FieldMapping[] {
  return [
    {
      id: "kesim:queue",
      sourceId: "src-opcua-queue",
      stationId: "kesim",
      field: "queue",
    },
    {
      id: "kesim:cycleTime",
      sourceId: "src-opcua-cycle",
      stationId: "kesim",
      field: "cycleTime",
    },
    {
      id: "kesim:machineState",
      sourceId: "src-opcua-state",
      stationId: "kesim",
      field: "machineState",
    },
    {
      id: "kesim:productionCount",
      sourceId: "src-opcua-count",
      stationId: "kesim",
      field: "productionCount",
    },
    {
      id: "torna:queue",
      sourceId: "src-mqtt-queue",
      stationId: "torna",
      field: "queue",
    },
    {
      id: "torna:scrap",
      sourceId: "src-mqtt-scrap",
      stationId: "torna",
      field: "scrap",
    },
    {
      id: "kaynak:productionCount",
      sourceId: "src-rest-count",
      stationId: "kaynak",
      field: "productionCount",
    },
    {
      id: "kaynak:cycleTime",
      sourceId: "src-rest-cycle",
      stationId: "kaynak",
      field: "cycleTime",
    },
  ];
}
