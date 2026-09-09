/**
 * Saha devreye alma raporu.
 *
 * Bir fabrika kurulumu bittiğinde sahada kalan tek belge budur: hangi cihazın
 * hangi uca bağlandığı, gecikmesinin ne olduğu, hangi ölçümlerin eşlendiği,
 * testin geçip geçmediği. Kurulumu yapan kişi ayrıldıktan sonra bir arıza
 * çıktığında ilk bakılacak yer burasıdır.
 *
 * Ölçülmeyen alan uydurulmaz
 * --------------------------
 * Gecikme ölçülmediyse "—" yazar, sıfır değil. Bir raporda "gecikme 0 ms"
 * satırı, o bağlantının ölçülmüş ve mükemmel olduğu anlamına gelir; hiç
 * denenmemiş bir bağlantı için bu düpedüz yanlış bilgidir.
 *
 * Doğrulanmayan satır gizlenmez
 * -----------------------------
 * Testi geçmemiş bir cihaz rapordan çıkarılmaz; "Doğrulanmadı" olarak yazılır.
 * Gizlenseydi, rapor eksiksiz görünür ve sahadaki kişi bir cihazın hiç
 * denenmediğini fark etmezdi.
 */

import { formatRatio } from "./format";
import type { ReportBlock, ReportDocument } from "../reports/types";

/** Ölçülemeyen değerlerin rapordaki karşılığı. */
export const NOT_MEASURED = "—";

/** Rapordaki tek bir cihaz satırı. */
export interface FieldDevice {
  connectionId: string;
  label: string;
  protocol: string;
  endpoint: string;
  /** Gerçek bir yanıt alındı mı? */
  verified: boolean;
  /** Ölçülen gecikme (ms); ölçülmediyse `null`. */
  latencyMs: number | null;
  /** Bu bağlantıdan gelen paket sayısı; ölçülmediyse `null`. */
  packets: number | null;
  /** Hata sayısı; ölçülmediyse `null`. */
  errors: number | null;
  /** Kaç ölçüm eşlemesi tanımlı? */
  mappedMetrics: number;
  /** Son verinin üstünden geçen süre; hiç veri gelmediyse `null`. */
  dataAgeMs: number | null;
}

/** Alarm testinin sonucu. */
export interface FieldAlarmCheck {
  /** Şimdiye kadar kaç alarm açıldı? */
  raised: number;
  /** Şu an kaç alarm etkin? */
  active: number;
  /** En az bir alarm gerçekten tetiklendi mi? */
  exercised: boolean;
}

/** OEE doğrulaması; hesaplanamadıysa alanlar `null`. */
export interface FieldOeeCheck {
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  /** Hesaplanamadıysa nedeni; hesaplandıysa `null`. */
  reason: string | null;
}

/** Raporun bütün girdisi. */
export interface FieldReportInput {
  factoryName: string;
  orgName: string | null;
  generatedAtLabel: string;
  devices: FieldDevice[];
  alarms: FieldAlarmCheck;
  oee: FieldOeeCheck;
  /** Telemetri tablosundaki satır sayısı. */
  telemetryRows: number;
  /** Kayıtlı geçmişin süresi (ms); veri yoksa `null`. */
  historySpanMs: number | null;
  /** Kalıcılık modu: `database` ya da `memory`. */
  persistenceMode: string;
}

/** Sayıyı okunur biçime çevirir; ölçülmemişse "—". */
export function formatNumber(value: number | null, digits = 0): string {
  if (value === null) return NOT_MEASURED;
  return value.toLocaleString("tr-TR", { maximumFractionDigits: digits });
}

/** Gecikmeyi yazar; ölçülmemişse "—". */
export function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) return NOT_MEASURED;
  return `${Math.round(latencyMs)} ms`;
}

/**
 * Süreyi okunur biçime çevirir; ölçülmemişse "—".
 *
 * Bir saatin altı dakika, üstü saat olarak yazılır: sahada okunacak bir
 * belgede "5400000 ms" hiçbir işe yaramaz.
 */
export function formatSpan(spanMs: number | null): string {
  if (spanMs === null) return NOT_MEASURED;
  if (spanMs < 60_000) return `${Math.round(spanMs / 1000)} sn`;
  if (spanMs < 3_600_000) return `${Math.round(spanMs / 60_000)} dk`;
  if (spanMs < 86_400_000) return `${Math.round(spanMs / 3_600_000)} sa`;
  return `${Math.round(spanMs / 86_400_000)} gün`;
}

/**
 * Yüzdeye çevirir; hesaplanmamışsa "—".
 *
 * Operasyon katmanının biçimlendiricisini kullanır: aynı raporun iki yerinde
 * farklı yuvarlama görünmesi, sayıların birbirini tutmadığı izlenimi verirdi.
 * Sahada tam sayı yeter; ondalık basamak istenmez.
 */
export function formatPercent(ratio: number | null): string {
  return formatRatio(ratio, 0);
}

/**
 * Bir cihazın doğrulama durumu.
 *
 * Üç durum vardır ve üçü de farklıdır: gerçek yanıt alındı, denendi ama
 * alınamadı, hiç denenmedi. İkinciyle üçüncüyü aynı kelimeyle anlatmak,
 * sahadaki kişiye "bu cihaz bozuk" ile "bu cihaza hiç bakılmadı" arasındaki
 * farkı kaybettirirdi.
 */
export function deviceVerdict(device: FieldDevice): string {
  if (device.verified) return "Gerçek doğrulandı";
  if (device.latencyMs !== null || device.errors !== null) return "Denendi, yanıt yok";
  return "Doğrulanmadı";
}

/** Doğrulanmış cihaz sayısı. */
export function verifiedCount(devices: FieldDevice[]): number {
  return devices.filter((device) => device.verified).length;
}

/**
 * Eşlemesi olmayan cihazlar.
 *
 * Eşlemesiz bir bağlantı kurulabilir ama verisi hiçbir makineye yazılmaz;
 * saha raporunda bu açıkça görünmelidir.
 */
export function unmappedDevices(devices: FieldDevice[]): FieldDevice[] {
  return devices.filter((device) => device.mappedMetrics === 0);
}

/**
 * Köprü bağlantısını rapor satırına çevirir.
 *
 * `nowMs` **sunucunun** bildirdiği andır, tarayıcının değil: iki saat
 * arasındaki fark, raporda olmayan bir gecikme gösterirdi. Sunucu anı
 * bilinmiyorsa (`0`) veri yaşı `null` kalır; uydurulmuş bir yaş yazmaktansa
 * "ölçülmedi" demek doğrudur.
 */
export function toFieldDevice(
  connection: {
    connectionId: string;
    label: string;
    kind: string;
    endpoint: string;
    everVerified: boolean;
    health: {
      avgLatencyMs: number | null;
      packets: number;
      errors: number;
      lastPacketAtMs: number | null;
    };
  },
  mappedMetrics: number,
  nowMs: number,
): FieldDevice {
  const lastPacket = connection.health.lastPacketAtMs;
  return {
    connectionId: connection.connectionId,
    label: connection.label,
    protocol: connection.kind,
    endpoint: connection.endpoint,
    verified: connection.everVerified,
    latencyMs: connection.health.avgLatencyMs,
    // Hiç paket gelmemiş bir bağlantıda sayaç sıfırdır ve bu **ölçülmüş** bir
    // sıfırdır: bağlantı kurulmuş ama veri akmamıştır.
    packets: connection.health.packets,
    errors: connection.health.errors,
    mappedMetrics,
    dataAgeMs:
      lastPacket === null || nowMs <= 0 ? null : Math.max(0, nowMs - lastPacket),
  };
}


/** Cihaz tablosunun satırları. */
export function deviceRows(devices: FieldDevice[]): string[][] {
  return devices.map((device) => [
    device.label,
    device.protocol.toUpperCase(),
    device.endpoint,
    deviceVerdict(device),
    formatLatency(device.latencyMs),
    formatNumber(device.packets),
    formatNumber(device.errors),
    String(device.mappedMetrics),
    formatSpan(device.dataAgeMs),
  ]);
}

/**
 * Alarm testinin cümlesi.
 *
 * Hiç alarm tetiklenmediyse bu bir eksikliktir: alarm zincirinin çalıştığı
 * ancak bir kez tetiklenerek görülür. "Alarm yok" demek, sistemin sağlıklı
 * olduğu anlamına gelmez — hiç denenmemiş olabilir.
 */
export function alarmVerdict(check: FieldAlarmCheck): string {
  if (!check.exercised) {
    return "Alarm zinciri hiç tetiklenmedi; çalıştığı doğrulanmadı.";
  }
  return `${check.raised} alarm açıldı, şu an ${check.active} alarm etkin.`;
}

/** OEE doğrulamasının cümlesi. */
export function oeeVerdict(check: FieldOeeCheck): string {
  if (check.oee === null) {
    return check.reason ?? "OEE hesaplanamadı; girdi eksik.";
  }
  return `OEE ${formatPercent(check.oee)} olarak hesaplandı.`;
}

/**
 * Kalıcılık uyarısı; veritabanı modunda uyarı yoktur.
 *
 * Bellek modunda kurulan bir sistem sunucu yeniden başladığında bütün geçmişi
 * kaybeder. Bu, saha raporunda mutlaka yazmalıdır.
 */
export function persistenceNote(mode: string): string | null {
  if (mode === "database") return null;
  if (mode === "memory") {
    return "Kalıcılık bellek modunda: sunucu yeniden başladığında telemetri ve bağlantı kayıtları kaybolur.";
  }
  return "Kalıcılık modu bildirilmedi; verinin saklandığı doğrulanamadı.";
}

/** Raporun özet KPI'ları. */
export function summaryItems(input: FieldReportInput) {
  const verified = verifiedCount(input.devices);
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
      label: "Kayıtlı telemetri",
      value: formatNumber(input.telemetryRows),
      hint: `Geçmiş: ${formatSpan(input.historySpanMs)}`,
      tone: (input.telemetryRows > 0 ? "good" : "warning") as "good" | "warning",
    },
    {
      label: "Alarm zinciri",
      value: input.alarms.exercised ? "Tetiklendi" : NOT_MEASURED,
      hint: input.alarms.exercised ? `${input.alarms.raised} alarm` : "Hiç denenmedi",
      tone: (input.alarms.exercised ? "good" : "warning") as "good" | "warning",
    },
    {
      label: "OEE",
      value: formatPercent(input.oee.oee),
      hint: input.oee.oee === null ? "Hesaplanamadı" : "Gerçek ölçümden",
      tone: (input.oee.oee === null ? "warning" : "good") as "good" | "warning",
    },
  ];
}

/**
 * Saha devreye alma raporunu kurar.
 *
 * Bu işlev saf: PDF çizimi `lib/reports/pdf` içindedir. Ayrım, raporun
 * içeriğinin PDF kütüphanesi olmadan sınanabilmesi içindir.
 */
export function buildFieldReport(input: FieldReportInput): ReportDocument {
  const blocks: ReportBlock[] = [
    { kind: "heading", level: 1, text: "Saha Devreye Alma Raporu" },
    {
      kind: "paragraph",
      text:
        "Bu rapor kurulumun gerçek ölçümlerinden üretilmiştir. Ölçülemeyen her " +
        "alan “—” ile gösterilir; hiçbir değer varsayılmaz.",
      muted: true,
    },
    { kind: "kpiGrid", items: summaryItems(input) },

    { kind: "heading", level: 2, text: "Cihazlar" },
    {
      kind: "table",
      caption: "Kayıtlı bağlantılar ve doğrulama durumları",
      columns: [
        "Cihaz",
        "Protokol",
        "Uç",
        "Durum",
        "Gecikme",
        "Paket",
        "Hata",
        "Eşleme",
        "Son veri",
      ],
      rows: deviceRows(input.devices),
      numericColumns: [4, 5, 6, 7, 8],
    },
  ];

  if (input.devices.length === 0) {
    blocks.push({
      kind: "note",
      text: "Kayıtlı bağlantı yok. Kurulum tamamlanmadan bu rapor eksiktir.",
      tone: "warning",
    });
  }

  const unmapped = unmappedDevices(input.devices);
  if (unmapped.length > 0) {
    blocks.push({
      kind: "note",
      text:
        `${unmapped.length} bağlantının ölçüm eşlemesi yok; bu bağlantılardan ` +
        "gelen veri hiçbir makineye yazılmaz.",
      tone: "warning",
    });
  }

  blocks.push(
    { kind: "heading", level: 2, text: "Alarm ve OEE Doğrulaması" },
    {
      kind: "table",
      columns: ["Kontrol", "Sonuç"],
      rows: [
        ["Alarm zinciri", alarmVerdict(input.alarms)],
        ["OEE hesabı", oeeVerdict(input.oee)],
        ["Kullanılabilirlik", formatPercent(input.oee.availability)],
        ["Performans", formatPercent(input.oee.performance)],
        ["Kalite", formatPercent(input.oee.quality)],
      ],
      widths: ["auto", "*"],
    },

    { kind: "heading", level: 2, text: "Veri Saklama" },
    {
      kind: "table",
      columns: ["Ölçüt", "Değer"],
      rows: [
        ["Kayıtlı telemetri satırı", formatNumber(input.telemetryRows)],
        ["Kayıtlı geçmiş süresi", formatSpan(input.historySpanMs)],
        ["Kalıcılık modu", input.persistenceMode],
      ],
      widths: ["auto", "*"],
    },
  );

  const note = persistenceNote(input.persistenceMode);
  if (note !== null) {
    blocks.push({ kind: "note", text: note, tone: "warning" });
  }

  blocks.push({
    kind: "signature",
    parties: [
      { role: "Kurulumu yapan", name: "" },
      { role: "Teslim alan", name: "" },
    ],
  });

  return {
    fileName: `saha-devreye-alma-${input.factoryName || "fabrika"}.pdf`,
    cover: {
      title: "Saha Devreye Alma Raporu",
      subtitle: "Gerçek ölçümlerden üretilmiştir",
      factoryName: input.factoryName,
      generatedAtLabel: input.generatedAtLabel,
      orgName: input.orgName,
      facts: [
        { label: "Cihaz", value: String(input.devices.length) },
        {
          label: "Doğrulanan",
          value: `${verifiedCount(input.devices)}/${input.devices.length}`,
        },
        { label: "Telemetri satırı", value: formatNumber(input.telemetryRows) },
        { label: "Kalıcılık", value: input.persistenceMode },
      ],
    },
    blocks,
  };
}
