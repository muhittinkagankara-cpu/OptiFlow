/**
 * Saha kabul raporu.
 *
 * Müşteriye teslim edilen ve **imzalanan** belge budur. SALES-15'in devreye
 * alma raporundan farkı, izleyicisidir: o rapor kurulumu yapan mühendis için
 * teknik bir dökümdü, bu rapor müşterinin imzalayacağı ticari bir kabuldür.
 * Bu yüzden burada kurulum tarihi, doğrulanan protokoller, ilk OEE ve imza
 * alanı vardır; kuyruk derinliği ve paket sayacı yoktur.
 *
 * İmzalanmadan kurulum bitmez
 * ---------------------------
 * Kontrol listesinin son adımı imzadır. Teknik olarak çalışan ama teslim
 * edilmemiş bir kurulum, ilerideki her tartışmada "bitmedi" sayılır.
 *
 * Doğrulanmayan protokol gizlenmez
 * --------------------------------
 * Denenmemiş bir protokol rapordan çıkarılmaz, "Doğrulanmadı" yazılır.
 * Gizlenseydi, müşteri eksiksiz bir rapor imzalar ve eksiklik aylar sonra
 * ortaya çıkardı.
 */

import { NOT_MEASURED, formatLatency, formatPercent } from "./fieldReport";
import type { ReportBlock, ReportDocument } from "../reports/types";

export { NOT_MEASURED, formatLatency, formatPercent };

/** Rapordaki tek bir cihaz satırı. */
export interface AcceptanceDevice {
  label: string;
  protocol: string;
  endpoint: string;
  /** Gerçek bir yanıt alındı mı? */
  verified: boolean;
  /** Ölçülen gecikme (ms); ölçülmediyse `null`. */
  latencyMs: number | null;
  /** Sahadaki etiket; verilmediyse `null`. */
  machineLabel: string | null;
}

/** Bir protokolün doğrulama durumu. */
export interface ProtocolCheck {
  protocol: string;
  /** `true` doğrulandı, `false` denendi ve olmadı, `null` hiç denenmedi. */
  verified: boolean | null;
  detail: string | null;
}

/** Alarm testinin sonucu. */
export interface AcceptanceAlarmCheck {
  raised: number;
  exercised: boolean;
}

/** Raporun bütün girdisi. */
export interface AcceptanceInput {
  customer: string;
  factoryName: string;
  /** Kurulum tarihi (epoch ms); bilinmiyorsa `null`. */
  installedAtMs: number | null;
  generatedAtLabel: string;
  devices: AcceptanceDevice[];
  protocols: ProtocolCheck[];
  alarms: AcceptanceAlarmCheck;
  /** İlk OEE; hesaplanamadıysa `null`. */
  oee: number | null;
  /** Lisans planı; yoksa `null`. */
  licenseTier: string | null;
  /** Kontrol listesinin tamamlanma durumu. */
  checklistReady: boolean;
  checklistSummary: string;
}

/** Kurulum tarihi; bilinmiyorsa "—". */
export function formatInstallDate(atMs: number | null): string {
  if (atMs === null || !Number.isFinite(atMs) || atMs <= 0) return NOT_MEASURED;
  return new Date(atMs).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Protokolün durum metni.
 *
 * Üç durum, üç ayrı metin. "Denendi ama olmadı" ile "hiç denenmedi" aynı
 * kelimeyle anlatılsaydı, müşteri bir arızanın peşine düşer ya da hiç
 * bakılmamış bir protokolü çalışıyor sanardı.
 */
export function protocolVerdict(check: ProtocolCheck): string {
  if (check.verified === true) return "Gerçek doğrulandı";
  if (check.verified === false) return "Denendi, doğrulanamadı";
  return "Doğrulanmadı";
}

/** Cihazın durum metni. */
export function acceptanceDeviceVerdict(device: AcceptanceDevice): string {
  return device.verified ? "Gerçek doğrulandı" : "Doğrulanmadı";
}

/** Doğrulanan cihaz sayısı. */
export function verifiedDevices(devices: AcceptanceDevice[]): number {
  return devices.filter((item) => item.verified).length;
}

/** Doğrulanan protokol sayısı. */
export function verifiedProtocols(protocols: ProtocolCheck[]): number {
  return protocols.filter((item) => item.verified === true).length;
}

/** Cihaz tablosunun satırları. */
export function acceptanceDeviceRows(devices: AcceptanceDevice[]): string[][] {
  return devices.map((device) => [
    device.label,
    device.machineLabel ?? NOT_MEASURED,
    device.protocol.toUpperCase(),
    device.endpoint,
    acceptanceDeviceVerdict(device),
    formatLatency(device.latencyMs),
  ]);
}

/** Protokol tablosunun satırları. */
export function protocolRows(protocols: ProtocolCheck[]): string[][] {
  return protocols.map((check) => [
    check.protocol.toUpperCase(),
    protocolVerdict(check),
    check.detail ?? NOT_MEASURED,
  ]);
}

/**
 * Alarm testinin cümlesi.
 *
 * Hiç alarm tetiklenmediyse bu bir eksikliktir ve öyle yazılır: zincirin
 * çalıştığı ancak bir kez tetiklenerek görülür.
 */
export function acceptanceAlarmVerdict(check: AcceptanceAlarmCheck): string {
  if (!check.exercised) {
    return "Alarm zinciri hiç tetiklenmedi; çalıştığı doğrulanmadı.";
  }
  return `${check.raised} alarm gerçekten tetiklendi ve ekranda görüldü.`;
}

/** Raporun özet KPI'ları. */
export function acceptanceSummaryItems(input: AcceptanceInput) {
  const verified = verifiedDevices(input.devices);
  return [
    {
      label: "Doğrulanan cihaz",
      value: `${verified}/${input.devices.length}`,
      hint:
        verified === input.devices.length && input.devices.length > 0
          ? "Tümü gerçek yanıt verdi"
          : "Doğrulanmayanlar tabloda işaretli",
      tone: (verified === input.devices.length && input.devices.length > 0
        ? "good"
        : "warning") as "good" | "warning",
    },
    {
      label: "Doğrulanan protokol",
      value: `${verifiedProtocols(input.protocols)}/${input.protocols.length}`,
      hint: "Yerel sunucularla doğrulanmış protokoller",
      tone: (verifiedProtocols(input.protocols) > 0 ? "good" : "warning") as
        | "good"
        | "warning",
    },
    {
      label: "Başlangıç OEE",
      value: formatPercent(input.oee),
      hint: input.oee === null ? "Hesaplanamadı" : "Gerçek ölçümden",
      tone: (input.oee === null ? "warning" : "good") as "good" | "warning",
    },
    {
      label: "Kurulum",
      value: input.checklistReady ? "Tamamlandı" : "Eksik",
      hint: input.checklistSummary,
      tone: (input.checklistReady ? "good" : "warning") as "good" | "warning",
    },
  ];
}

/**
 * Saha kabul raporunu kurar.
 *
 * Bu işlev saf: PDF çizimi `lib/reports/pdf` içindedir. Ayrım, raporun
 * içeriğinin PDF kütüphanesi olmadan sınanabilmesi içindir.
 */
export function buildAcceptanceReport(input: AcceptanceInput): ReportDocument {
  const blocks: ReportBlock[] = [
    { kind: "heading", level: 1, text: "Saha Kabul Raporu" },
    {
      kind: "paragraph",
      text:
        "Bu rapor kurulumun gerçek ölçümlerinden üretilmiştir. Doğrulanmayan " +
        "hiçbir satır gizlenmemiş, ölçülemeyen her alan “—” ile gösterilmiştir.",
      muted: true,
    },
    { kind: "kpiGrid", items: acceptanceSummaryItems(input) },

    { kind: "heading", level: 2, text: "Kurulum Bilgileri" },
    {
      kind: "table",
      columns: ["Alan", "Değer"],
      rows: [
        ["Müşteri", input.customer || NOT_MEASURED],
        ["Fabrika", input.factoryName || NOT_MEASURED],
        ["Kurulum tarihi", formatInstallDate(input.installedAtMs)],
        ["Lisans planı", input.licenseTier ?? NOT_MEASURED],
      ],
      widths: ["auto", "*"],
    },

    { kind: "heading", level: 2, text: "Bağlanan Cihazlar" },
    {
      kind: "table",
      caption: "Doğrulanmayan cihazlar da listededir",
      columns: ["Cihaz", "Saha etiketi", "Protokol", "Uç", "Durum", "Gecikme"],
      rows: acceptanceDeviceRows(input.devices),
      numericColumns: [5],
    },
  ];

  if (input.devices.length === 0) {
    blocks.push({
      kind: "note",
      text: "Kayıtlı bağlantı yok. Kurulum tamamlanmadan bu rapor imzalanamaz.",
      tone: "warning",
    });
  }

  blocks.push(
    { kind: "heading", level: 2, text: "Doğrulanan Protokoller" },
    {
      kind: "table",
      columns: ["Protokol", "Durum", "Kanıt"],
      rows: protocolRows(input.protocols),
      widths: ["auto", "auto", "*"],
    },

    { kind: "heading", level: 2, text: "Alarm Testi ve OEE" },
    {
      kind: "table",
      columns: ["Kontrol", "Sonuç"],
      rows: [
        ["Alarm testi", acceptanceAlarmVerdict(input.alarms)],
        [
          "Başlangıç OEE",
          input.oee === null
            ? "Hesaplanamadı; planlanan süre ya da ideal çevrim eksik."
            : `${formatPercent(input.oee)} olarak hesaplandı.`,
        ],
        ["Kurulum kontrol listesi", input.checklistSummary],
      ],
      widths: ["auto", "*"],
    },
  );

  if (!input.checklistReady) {
    blocks.push({
      kind: "note",
      text:
        "Kurulum kontrol listesi tamamlanmadı. Bu rapor imzalansa bile " +
        "kurulum eksik sayılır.",
      tone: "warning",
    });
  }

  blocks.push(
    {
      kind: "paragraph",
      text:
        "Aşağıdaki imzalar, yukarıdaki ölçümlerin sahada birlikte görüldüğünü " +
        "ve kurulumun teslim alındığını belgeler.",
    },
    {
      kind: "signature",
      parties: [
        { role: "Kurulumu yapan", name: "" },
        { role: "Müşteri yetkilisi", name: "" },
      ],
    },
  );

  return {
    fileName: `saha-kabul-${input.customer || input.factoryName || "pilot"}.pdf`,
    cover: {
      title: "Saha Kabul Raporu",
      subtitle: "Gerçek ölçümlerden üretilmiştir",
      factoryName: input.factoryName,
      generatedAtLabel: input.generatedAtLabel,
      orgName: input.customer || null,
      facts: [
        { label: "Kurulum", value: formatInstallDate(input.installedAtMs) },
        {
          label: "Cihaz",
          value: `${verifiedDevices(input.devices)}/${input.devices.length}`,
        },
        {
          label: "Protokol",
          value: `${verifiedProtocols(input.protocols)}/${input.protocols.length}`,
        },
        { label: "Başlangıç OEE", value: formatPercent(input.oee) },
      ],
    },
    blocks,
  };
}
