/**
 * Fabrika devreye alma listesi.
 *
 * Bu listenin tek kuralı şudur: **hiçbir adım kullanıcının işaretlemesiyle
 * tamamlanmaz.** Her adımın durumu ürünün gerçek hâlinden türer — bir
 * bağlantı doğrulandıysa, bir alarm gerçekten tetiklendiyse, bir yedek
 * gerçekten alındıysa.
 *
 * Elle işaretlenebilen bir liste, kurulumu yapan kişinin iyi niyetini ölçer;
 * ürünün hazır olup olmadığını değil. İlk fabrika kurulumunda yanlış
 * işaretlenmiş tek bir kutu, sahada saatlerce süren bir arıza aramasına yol
 * açabilir.
 *
 * Üç durum
 * --------
 * * **Tamam** — ölçüldü ve doğrulandı.
 * * **Bekliyor** — ölçüldü, henüz yapılmadı; kullanıcı bir iş yapmalı.
 * * **Ölçülemedi** — sistem bu adımın durumunu okuyamıyor. "Bekliyor" ile
 *   karıştırılmaz: birincisinde eksik olan iş, ikincisinde ölçümdür.
 */

import type { CommissionReport, CommissionState, CommissionStep } from "./types";

/** Devreye alma değerlendirmesinin girdisi. */
export interface CommissionInput {
  /** Kayıtlı bağlantılar ve protokolleri. */
  connections: { id: string; protocol: string; verified: boolean }[];
  /** Ölçüm eşlemesi tanımlı bağlantı sayısı. */
  mappedConnections: number;
  /** Hesaplanmış OEE; hesaplanamadıysa `null`. */
  oee: number | null;
  /** Şimdiye kadar açılmış toplam alarm sayısı. */
  alarmsRaised: number;
  /** PDF raporu üretildi mi? */
  reportGenerated: boolean;
  /** Doğrulanmış bir yedek var mı? */
  backupVerified: boolean;
  /** Ölçümler okunabildi mi? Okunamadıysa adımlar "ölçülemedi" olur. */
  loaded: boolean;
}

/** Protokol adımlarının kimlikleri ve etiketleri. */
const PROTOCOL_STEPS: { id: string; protocol: string; label: string }[] = [
  { id: "opcua", protocol: "opcua", label: "OPC UA doğrulandı" },
  { id: "mqtt", protocol: "mqtt", label: "MQTT doğrulandı" },
  { id: "rest", protocol: "rest", label: "REST doğrulandı" },
];

function step(
  id: string,
  label: string,
  state: CommissionState,
  reason: string,
  action: string | null,
): CommissionStep {
  return { id, label, state, reason, action };
}

function unknownStep(id: string, label: string): CommissionStep {
  return step(
    id,
    label,
    "unknown",
    "Sunucudan ölçüm okunamadı; bu adımın durumu bilinmiyor.",
    "Sunucuya erişimi doğrulayın.",
  );
}

/**
 * PLC bağlantısı adımı.
 *
 * "Bağlandı" demek için doğrulanmış **en az bir** bağlantı gerekir: tanımlı
 * ama hiç denenmemiş bir bağlantı, kâğıt üzerinde bir kayıttır.
 */
function plcStep(input: CommissionInput): CommissionStep {
  const verified = input.connections.filter((item) => item.verified);
  if (verified.length > 0) {
    return step(
      "plc",
      "PLC bağlandı",
      "done",
      `${verified.length} bağlantı cihazdan yanıt aldı.`,
      null,
    );
  }
  if (input.connections.length > 0) {
    return step(
      "plc",
      "PLC bağlandı",
      "pending",
      `${input.connections.length} bağlantı tanımlı ama hiçbiri doğrulanmadı.`,
      "Bağlantı ekranından 'Bağlan ve doğrula' ile cihazdan yanıt alın.",
    );
  }
  return step(
    "plc",
    "PLC bağlandı",
    "pending",
    "Hiç bağlantı tanımlanmadı.",
    "Runtime ekranından bir cihaz bağlantısı ekleyin.",
  );
}

function protocolStep(
  input: CommissionInput,
  id: string,
  protocol: string,
  label: string,
): CommissionStep {
  const matching = input.connections.filter((item) => item.protocol === protocol);
  const verified = matching.filter((item) => item.verified);

  if (verified.length > 0) {
    return step(id, label, "done", `${verified.length} ${protocol} bağlantısı doğrulandı.`, null);
  }
  if (matching.length > 0) {
    return step(
      id,
      label,
      "pending",
      `${matching.length} ${protocol} bağlantısı tanımlı ama doğrulanmadı.`,
      "Bağlantıyı test edip cihazdan yanıt alın.",
    );
  }
  return step(
    id,
    label,
    "pending",
    `Bu kurulumda ${protocol} bağlantısı yok.`,
    `Kullanılacaksa bir ${protocol} bağlantısı ekleyin.`,
  );
}

function mappingStep(input: CommissionInput): CommissionStep {
  if (input.connections.length === 0) {
    return step(
      "mapping",
      "Eşleme tamam",
      "pending",
      "Eşlenecek bağlantı yok.",
      "Önce bir bağlantı ekleyin.",
    );
  }
  if (input.mappedConnections >= input.connections.length) {
    return step(
      "mapping",
      "Eşleme tamam",
      "done",
      `${input.mappedConnections} bağlantının ölçüm eşlemesi tanımlı.`,
      null,
    );
  }
  const missing = input.connections.length - input.mappedConnections;
  return step(
    "mapping",
    "Eşleme tamam",
    "pending",
    `${missing} bağlantının eşleme tablosu eksik; ölçümleri hangi makineye ait olduğu bilinmiyor.`,
    "Eşleme tablosunu tanımlayın.",
  );
}

function oeeStep(input: CommissionInput): CommissionStep {
  if (input.oee !== null) {
    return step("oee", "OEE hesaplanıyor", "done", "OEE gerçek ölçümlerden hesaplandı.", null);
  }
  return step(
    "oee",
    "OEE hesaplanıyor",
    "pending",
    "OEE hesaplanamıyor; çarpanlardan biri ölçülmedi.",
    "Planlanan süre, ideal çevrim ve fire ölçümünün geldiğini doğrulayın.",
  );
}

function alarmStep(input: CommissionInput): CommissionStep {
  if (input.alarmsRaised > 0) {
    return step(
      "alarm",
      "Alarm tetiklendi",
      "done",
      `${input.alarmsRaised} alarm açıldı; kurallar gerçek veriyle çalışıyor.`,
      null,
    );
  }
  return step(
    "alarm",
    "Alarm tetiklendi",
    "pending",
    "Hiç alarm açılmadı; kuralların gerçek veriyle çalıştığı doğrulanmadı.",
    "Bir makineyi durdurup ya da kuyruğu eşiğin üstüne çıkarıp alarmı sınayın.",
  );
}

function reportStep(input: CommissionInput): CommissionStep {
  return input.reportGenerated
    ? step("report", "PDF üretildi", "done", "Rapor üretildi.", null)
    : step(
        "report",
        "PDF üretildi",
        "pending",
        "Henüz rapor üretilmedi.",
        "Raporlar ekranından bir PDF üretin.",
      );
}

function backupStep(input: CommissionInput): CommissionStep {
  return input.backupVerified
    ? step("backup", "Yedek doğrulandı", "done", "Yedek alındı ve sağlaması doğrulandı.", null)
    : step(
        "backup",
        "Yedek doğrulandı",
        "pending",
        "Doğrulanmış bir yedek yok.",
        "Yedekleme ekranından yedek alıp doğrulayın.",
      );
}

/** Devreye alma listesini üretir. */
export function buildCommissionReport(input: CommissionInput): CommissionReport {
  const steps: CommissionStep[] = input.loaded
    ? [
        plcStep(input),
        ...PROTOCOL_STEPS.map((item) =>
          protocolStep(input, item.id, item.protocol, item.label),
        ),
        mappingStep(input),
        oeeStep(input),
        alarmStep(input),
        reportStep(input),
        backupStep(input),
      ]
    : [
        unknownStep("plc", "PLC bağlandı"),
        ...PROTOCOL_STEPS.map((item) => unknownStep(item.id, item.label)),
        unknownStep("mapping", "Eşleme tamam"),
        unknownStep("oee", "OEE hesaplanıyor"),
        unknownStep("alarm", "Alarm tetiklendi"),
        unknownStep("report", "PDF üretildi"),
        unknownStep("backup", "Yedek doğrulandı"),
      ];

  const done = steps.filter((item) => item.state === "done").length;

  return {
    steps,
    done,
    total: steps.length,
    // Ölçüm yoksa oran hesaplanmaz: "%0 tamam" ile "ölçülemedi" farklı
    // şeylerdir ve ilki kurulumu yapan kişiyi yanlış yönlendirir.
    ratio: input.loaded && steps.length > 0 ? done / steps.length : null,
    ready: input.loaded && done === steps.length,
  };
}

/** Listenin tek cümlelik özeti. */
export function describeCommission(report: CommissionReport): string {
  if (report.ratio === null) {
    return "Devreye alma durumu ölçülemedi.";
  }
  if (report.ready) {
    return "Bütün adımlar tamamlandı; fabrika devreye alınmaya hazır.";
  }
  return `${report.done}/${report.total} adım tamam.`;
}

/** Yalnızca bekleyen adımlar; kurulum ekranı bunları öne çıkarır. */
export function pendingSteps(report: CommissionReport): CommissionStep[] {
  return report.steps.filter((item) => item.state !== "done");
}
