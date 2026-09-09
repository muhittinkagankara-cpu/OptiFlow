/**
 * Birleşik alarm deposu.
 *
 * Neden tek depo
 * --------------
 * SALES-11 sonunda alarmlar üç yerde yaşıyordu: Live Factory kendi eşiğine
 * göre üretiyor, Alarm Merkezi kendi listesini tutuyor, runtime panosu
 * bağlantı durumuna bakıyordu. Aynı arıza üç ekranda üç farklı biçimde
 * görünüyordu — birinde açık, birinde kapalı, birinde hiç yok. Operatör
 * hangisine bakacağını bilemez ve sonunda hiçbirine bakmaz.
 *
 * Bu depo tek bir liste üretir. Üç ekran da onu okur.
 *
 * Üç değişmez kural
 * -----------------
 * 1. **Aynı kimlik tek satır.** Kimlik `kural::konu` biçimindedir; aynı arıza
 *    ikinci kez geldiğinde yeni satır açılmaz, var olan tazelenir.
 * 2. **Onay geri alınmaz.** `ACKNOWLEDGED` bir alarm, nedeni sürdüğü için
 *    yeniden bildirilse bile `OPEN`'a dönmez. Dönseydi operatörün gördüğü
 *    alarm bir saniye sonra yeniden yanardı.
 * 3. **Benzetim ile gerçek karışmaz.** Her satır kaynağını taşır; benzetimden
 *    gelen bir alarm "Gerçek" görünemez.
 */

import {
  ALARM_ORIGIN_LABEL,
  ALARM_SEVERITY_ORDER,
  ALARM_STATE_LABEL,
  EMPTY_ALARM_COUNTS,
  type AlarmCounts,
  type AlarmOrigin,
  type UnifiedAlarm,
  type UnifiedAlarmSeverity,
} from "./types";

/** Geçmişte tutulan en fazla kayıt. */
export const HISTORY_LIMIT = 200;

/** Deponun dışarı verdiği görünüm. */
export interface AlarmStoreView {
  active: UnifiedAlarm[];
  history: UnifiedAlarm[];
  counts: AlarmCounts;
}

export const EMPTY_STORE_VIEW: AlarmStoreView = {
  active: [],
  history: [],
  counts: EMPTY_ALARM_COUNTS,
};

/**
 * İki alarm listesini tek listeye indirger.
 *
 * Aynı kimlik iki kez geldiğinde **sonuncusu** kazanır ama onay durumu
 * korunur: sunucu bir alarmı yeniden `OPEN` olarak bildirse bile, arayüzde
 * onaylanmışsa onaylı kalır.
 */
export function mergeAlarms(
  current: UnifiedAlarm[],
  incoming: UnifiedAlarm[],
): UnifiedAlarm[] {
  const byId = new Map<string, UnifiedAlarm>();

  for (const alarm of current) {
    byId.set(alarm.id, alarm);
  }

  for (const alarm of incoming) {
    const existing = byId.get(alarm.id);
    if (existing === undefined) {
      byId.set(alarm.id, alarm);
      continue;
    }

    const keepAcknowledged =
      existing.state === "ACKNOWLEDGED" && alarm.state === "OPEN";

    byId.set(alarm.id, {
      ...alarm,
      // İlk görülme anı korunur: alarmın yaşı, ilk açıldığı andan sayılır.
      raisedAtMs: existing.raisedAtMs || alarm.raisedAtMs,
      state: keepAcknowledged ? "ACKNOWLEDGED" : alarm.state,
      stateLabel: keepAcknowledged
        ? ALARM_STATE_LABEL.ACKNOWLEDGED
        : alarm.stateLabel,
      acknowledgedBy: alarm.acknowledgedBy ?? existing.acknowledgedBy,
      acknowledgedAtMs: alarm.acknowledgedAtMs ?? existing.acknowledgedAtMs,
    });
  }

  return [...byId.values()];
}

/** Kritikten bilgiye, eşitlikte yeniden eskiye sıralar. */
export function sortAlarms(alarms: UnifiedAlarm[]): UnifiedAlarm[] {
  return [...alarms].sort((left, right) => {
    const severity =
      ALARM_SEVERITY_ORDER.indexOf(left.severity) -
      ALARM_SEVERITY_ORDER.indexOf(right.severity);
    if (severity !== 0) return severity;
    return right.raisedAtMs - left.raisedAtMs;
  });
}

/** Sayaçları listeden hesaplar. */
export function countAlarms(
  active: UnifiedAlarm[],
  history: UnifiedAlarm[],
): AlarmCounts {
  return {
    active: active.length,
    open: active.filter((item) => item.state === "OPEN").length,
    acknowledged: active.filter((item) => item.state === "ACKNOWLEDGED").length,
    silenced: active.filter((item) => item.state === "SILENCED").length,
    escalated: active.filter((item) => item.state === "ESCALATED").length,
    critical: active.filter((item) => item.severity === "critical").length,
    history: history.length,
    raisedTotal: active.length + history.length,
    resolvedTotal: history.length,
  };
}

/**
 * Birleşik alarm deposu.
 *
 * Sınıf değil saf işlevler kullanılabilirdi ama depo iki liste arasında durum
 * taşır (onaylananlar) ve bunu bileşene bırakmak, kararı bileşenin içine
 * koymak olurdu.
 */
export class UnifiedAlarmStore {
  private activeById = new Map<string, UnifiedAlarm>();
  private historyList: UnifiedAlarm[] = [];
  private readonly historyLimit: number;

  constructor(historyLimit: number = HISTORY_LIMIT) {
    this.historyLimit = historyLimit;
  }

  /**
   * Bir kaynaktan gelen tam listeyi işler.
   *
   * Değerlendirme **tam** yapılır: o kaynaktan artık gelmeyen alarmlar
   * kapatılır. Artımlı çalışsaydı, kaçırılan tek bir "sorun bitti" sinyali
   * alarmı sonsuza kadar açık bırakırdı.
   */
  sync(incoming: UnifiedAlarm[], origin: AlarmOrigin): {
    opened: number;
    updated: number;
    resolved: number;
  } {
    const incomingById = new Map(incoming.map((item) => [item.id, item]));
    let opened = 0;
    let updated = 0;
    let resolved = 0;

    for (const [id, alarm] of incomingById) {
      const existing = this.activeById.get(id);
      if (existing === undefined) {
        this.activeById.set(id, alarm);
        opened += 1;
        continue;
      }
      this.activeById.set(id, mergeAlarms([existing], [alarm])[0]);
      updated += 1;
    }

    for (const [id, alarm] of [...this.activeById]) {
      if (alarm.origin !== origin) continue;
      if (incomingById.has(id)) continue;
      this.activeById.delete(id);
      this.historyList.push({
        ...alarm,
        state: "RESOLVED",
        stateLabel: ALARM_STATE_LABEL.RESOLVED,
        resolvedAtMs: alarm.resolvedAtMs ?? alarm.updatedAtMs,
      });
      resolved += 1;
    }

    if (this.historyList.length > this.historyLimit) {
      this.historyList = this.historyList.slice(-this.historyLimit);
    }

    return { opened, updated, resolved };
  }

  /**
   * Alarmı görüldü işaretler.
   *
   * Yalnızca açık bir alarm onaylanabilir; onaylanan alarm sonraki
   * eşitlemelerde açığa dönmez.
   */
  acknowledge(id: string, by: string, atMs: number): UnifiedAlarm | null {
    const alarm = this.activeById.get(id);
    if (alarm === undefined || alarm.state !== "OPEN") return null;

    const acknowledged: UnifiedAlarm = {
      ...alarm,
      state: "ACKNOWLEDGED",
      stateLabel: ALARM_STATE_LABEL.ACKNOWLEDGED,
      acknowledgedBy: by,
      acknowledgedAtMs: atMs,
      updatedAtMs: atMs,
    };
    this.activeById.set(id, acknowledged);
    return acknowledged;
  }

  view(): AlarmStoreView {
    const active = sortAlarms([...this.activeById.values()]);
    const history = [...this.historyList].reverse();
    return { active, history, counts: countAlarms(active, history) };
  }

  /** Yalnızca belirli bir kaynaktan gelen etkin alarmlar. */
  byOrigin(origin: AlarmOrigin): UnifiedAlarm[] {
    return this.view().active.filter((item) => item.origin === origin);
  }

  /** Belirli bir ağırlıktaki etkin alarmlar. */
  bySeverity(severity: UnifiedAlarmSeverity): UnifiedAlarm[] {
    return this.view().active.filter((item) => item.severity === severity);
  }

  /** Bir makineyi ilgilendiren etkin alarmlar. */
  forSubject(subject: string): UnifiedAlarm[] {
    return this.view().active.filter((item) => item.subject === subject);
  }

  clear(): void {
    this.activeById.clear();
    this.historyList = [];
  }
}

/**
 * Benzetim ekranının alarmını birleşik biçime çevirir.
 *
 * Kaynak her zaman `simulation`'dır ve arayüzde "Benzetim" rozetiyle çıkar:
 * benzetimden gelen bir satır hiçbir koşulda gerçek bir arıza gibi
 * gösterilemez.
 */
export function fromSimulationAlarm(alarm: {
  id: string;
  level: string;
  stationId: string;
  stationName: string;
  text: string;
  atMinutes: number;
  updatedAtMinutes: number;
  resolvedAtMinutes: number | null;
}): UnifiedAlarm {
  const severity: UnifiedAlarmSeverity =
    alarm.level === "critical" || alarm.level === "warning" || alarm.level === "info"
      ? (alarm.level as UnifiedAlarmSeverity)
      : "warning";
  const state = alarm.resolvedAtMinutes === null ? "OPEN" : "RESOLVED";

  return {
    id: `simulation::${alarm.id}`,
    rule: "simulation",
    ruleLabel: "Benzetim uyarısı",
    subject: alarm.stationId,
    severity,
    severityLabel:
      severity === "critical" ? "Kritik" : severity === "warning" ? "Uyarı" : "Bilgi",
    state,
    stateLabel: ALARM_STATE_LABEL[state],
    origin: "simulation",
    originLabel: ALARM_ORIGIN_LABEL.simulation,
    message: alarm.text,
    // Benzetim saati dakika cinsindendir; milisaniyeye çevrilir ki iki kaynak
    // aynı zaman ekseninde sıralanabilsin.
    raisedAtMs: alarm.atMinutes * 60_000,
    updatedAtMs: alarm.updatedAtMinutes * 60_000,
    // Benzetim alarmları susturulmaz ve yükseltilmez: yükseltme zinciri
    // gerçek bir vardiyaya haber vermek içindir ve benzetimde haber
    // verilecek kimse yoktur.
    unattendedMs: null,
    silencedBy: null,
    silencedUntilMs: null,
    silenceReason: null,
    escalatedAtMs: null,
    escalationLevel: 0,
    repeatCount: 0,
    acknowledgedBy: null,
    acknowledgedAtMs: null,
    resolvedAtMs:
      alarm.resolvedAtMinutes === null ? null : alarm.resolvedAtMinutes * 60_000,
    durationMs:
      alarm.resolvedAtMinutes === null
        ? null
        : (alarm.resolvedAtMinutes - alarm.atMinutes) * 60_000,
    context: { stationName: alarm.stationName },
  };
}
