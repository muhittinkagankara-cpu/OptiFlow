/**
 * Alarm üretimi.
 *
 * Bir olayın alarm doğurup doğurmayacağı bir **karardır**, biçimlendirme
 * değil: "kuyruk büyüdü" uyarısının hangi eşikte çıkacağı vardiyanın gürültü
 * seviyesini belirler. Bu yüzden kural burada durur ve sınanır; alarm paneli
 * yalnızca çizer.
 *
 * Dört davranış bilinçlidir:
 *
 * - **Tekrar bastırma.** Aynı istasyonda açık bir arıza alarmı varken ikinci
 *   bir arıza alarmı üretilmez. Üretilseydi tek bir arıza, her tik'te yeni bir
 *   satır açar ve panel okunamaz hâle gelirdi.
 * - **Kapatma, silme değil.** Arıza giderildiğinde alarm listeden silinmez,
 *   `resolvedAtMinutes` yazılır. Vardiya sonunda "arıza kaç dakika sürdü?"
 *   sorusunun yanıtı ancak böyle verilebilir.
 * - **Yerinde yükseltme.** Kuyruk uyarı eşiğinden kritik eşiğe çıktığında
 *   **yeni kayıt açılmaz**; açık olan kaydın seviyesi yükseltilir. Yeni kayıt
 *   açılsaydı panelde aynı sorun iki satır olur, operatör bunları iki ayrı
 *   olay sanardı. Kimlik bu yüzden seviyeden bağımsızdır: satır yerinde kalır,
 *   yalnızca rengi ve metni değişir.
 * - **Düşürme yok.** Kritiğe çıkmış bir alarm, kuyruk uyarı aralığına gerilese
 *   bile kritik kalır; ancak eşiğin tümüyle altına inince kapanır. Aksi hâlde
 *   sorun sürerken alarm sessizce sararır ve "hallolmuş" gibi okunurdu.
 */

import { ALARM_LEVEL_ORDER } from "./types";
import type { Alarm, AlarmLevel, StationLiveState } from "./types";

/** Bu uzunluğun üstündeki kuyruk bir uyarı doğurur. */
export const QUEUE_WARNING = 8;

/** Bu uzunluğun üstündeki kuyruk kritik sayılır. */
export const QUEUE_CRITICAL = 15;

/** Bu oranın üstündeki fire bir uyarı doğurur. */
export const SCRAP_WARNING = 0.05;

/** Panelde tutulan en fazla alarm sayısı. */
export const ALARM_LIMIT = 50;

/**
 * Bir istasyonda o anda açık olan, verilen türde alarm var mı?
 *
 * Tür, alarm kimliğinin ön ekinden okunur (`fault:s1:...`). Ayrı bir alan
 * yerine kimliğin kendisinin taşıması bilinçlidir: kimlik zaten benzersiz
 * olmak zorunda ve iki alan aynı bilgiyi taşısaydı biri güncellenmeyi
 * unutabilirdi.
 */
export function findOpenAlarm(
  alarms: Alarm[],
  stationId: string,
  kind: string,
): Alarm | null {
  return (
    alarms.find(
      (alarm) =>
        alarm.resolvedAtMinutes === null &&
        alarm.stationId === stationId &&
        alarm.id.startsWith(`${kind}:${stationId}:`),
    ) ?? null
  );
}

export function hasOpenAlarm(
  alarms: Alarm[],
  stationId: string,
  kind: string,
): boolean {
  return findOpenAlarm(alarms, stationId, kind) !== null;
}

/**
 * Yeni bir alarm kaydı kurar.
 *
 * Kimlik **seviyeden bağımsızdır**: bir alarm yükseltildiğinde aynı kayıt
 * yerinde kalmalı, listede yeni bir satır olarak belirmemelidir.
 */
export function makeAlarm(
  kind: string,
  level: AlarmLevel,
  atMinutes: number,
  station: Pick<StationLiveState, "stationId" | "stationName">,
  text: string,
): Alarm {
  return {
    id: `${kind}:${station.stationId}:${atMinutes}`,
    level,
    atMinutes,
    updatedAtMinutes: atMinutes,
    stationId: station.stationId,
    stationName: station.stationName,
    text,
    resolvedAtMinutes: null,
  };
}

/**
 * Bir istasyonda açık olan, verilen türdeki alarmları kapatır.
 *
 * Girdiyi değiştirmez; yeni bir dizi döner.
 */
export function resolveAlarms(
  alarms: Alarm[],
  stationId: string,
  kind: string,
  atMinutes: number,
): Alarm[] {
  return alarms.map((alarm) =>
    alarm.resolvedAtMinutes === null &&
    alarm.stationId === stationId &&
    alarm.id.startsWith(`${kind}:${stationId}:`)
      ? { ...alarm, resolvedAtMinutes: atMinutes, updatedAtMinutes: atMinutes }
      : alarm,
  );
}

/** Kuyruk uzunluğunun hangi seviyeye karşılık geldiği; eşik altında `null`. */
function queueLevel(queue: number): AlarmLevel | null {
  if (queue >= QUEUE_CRITICAL) {
    return "critical";
  }
  if (queue >= QUEUE_WARNING) {
    return "warning";
  }
  return null;
}

function queueText(queue: number, level: AlarmLevel): string {
  return level === "critical"
    ? `Kuyruk ${queue} parçaya çıktı; hat tıkanıyor.`
    : `Kuyruk ${queue} parçaya ulaştı.`;
}

/**
 * Kuyruk değişiminin alarm listesine etkisi.
 *
 * Dört durum ayrılır:
 *
 * 1. Kuyruk eşiklerin altında → açık kuyruk alarmı kapatılır.
 * 2. Açık alarm yok → yeni kayıt açılır.
 * 3. Açık alarm var ve seviye yükseliyor → **aynı kayıt** yükseltilir; kimlik
 *    korunur, metin ve `updatedAtMinutes` yenilenir.
 * 4. Açık alarm var, seviye aynı ya da daha düşük → hiçbir şey yapılmaz.
 *    Kopya kayıt açılmaz ve kritik bir alarm uyarıya düşürülmez.
 *
 * Girdiyi değiştirmez; gereken durumlarda yeni bir dizi döner.
 */
export function queueAlarmFor(
  alarms: Alarm[],
  station: StationLiveState,
  queue: number,
  atMinutes: number,
): Alarm[] {
  const level = queueLevel(queue);

  if (level === null) {
    return resolveAlarms(alarms, station.stationId, "queue", atMinutes);
  }

  const open = findOpenAlarm(alarms, station.stationId, "queue");

  if (open === null) {
    return [
      makeAlarm("queue", level, atMinutes, station, queueText(queue, level)),
      ...alarms,
    ];
  }

  // Küçük ağırlık = daha ağır seviye (kritik 0, uyarı 1).
  const isEscalation = ALARM_LEVEL_ORDER[level] < ALARM_LEVEL_ORDER[open.level];
  if (!isEscalation) {
    return alarms;
  }

  return alarms.map((alarm) =>
    alarm.id === open.id
      ? {
          ...alarm,
          level,
          text: queueText(queue, level),
          updatedAtMinutes: atMinutes,
        }
      : alarm,
  );
}

/** Açık (giderilmemiş) alarm sayısı. */
export function openAlarmCount(alarms: Alarm[]): number {
  return alarms.filter((alarm) => alarm.resolvedAtMinutes === null).length;
}
