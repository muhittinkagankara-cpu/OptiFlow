/**
 * Sunucu yanıtlarının çözümlenmesi.
 *
 * Ayrıştırıcıların tek işi, eksik veriyi **uydurmadan** taşımaktır. Bu
 * dosyanın koruduğu iki davranış:
 *
 * - Eksik ya da bozuk bir alan `null` olur; sıfıra düşmez. "Ölçüldü ve sıfır"
 *   ile "ölçülmedi" farklı bilgilerdir.
 * - Tanınmayan bir alarm durumu `OPEN` sayılır. "Kapandı" varsayılsaydı,
 *   sunucu yeni bir durum adı eklediği gün bütün açık alarmlar sessizce
 *   kaybolurdu.
 */

import { describe, expect, it } from "vitest";
import {
  numberOr,
  numberOrNull,
  parseAlarm,
  parseAlarmCenter,
  parseAlarms,
  parseAlarmState,
  parseCounts,
  parseHealthScore,
  parseMonitoringKpi,
  parseOee,
  parseProductionStatus,
  parseRule,
  parseSeverity,
  parseTimeline,
  parseTimelineEntry,
  reasonMap,
  stringOr,
  stringOrNull,
} from "./parse";

describe("sayı ayrıştırma", () => {
  it("sayıyı korur", () => {
    expect(numberOrNull(12.5)).toBe(12.5);
  });

  it("ölçülmüş sıfırı korur", () => {
    expect(numberOrNull(0)).toBe(0);
  });

  it("null'u null bırakır", () => {
    expect(numberOrNull(null)).toBeNull();
  });

  it("eksik alanı null yapar", () => {
    expect(numberOrNull(undefined)).toBeNull();
  });

  it("NaN'ı ölçülmemiş sayar", () => {
    expect(numberOrNull(Number.NaN)).toBeNull();
  });

  it("sonsuzu ölçülmemiş sayar", () => {
    expect(numberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("metni ölçüm saymaz", () => {
    expect(numberOrNull("12")).toBeNull();
  });

  it("yedek değer sayaçlar için kullanılır", () => {
    expect(numberOr(undefined, 0)).toBe(0);
  });

  it("yedek değer gerçek ölçümü ezmez", () => {
    expect(numberOr(7, 0)).toBe(7);
  });
});

describe("metin ayrıştırma", () => {
  it("metni korur", () => {
    expect(stringOrNull("PLC")).toBe("PLC");
  });

  it("boş metni null yapar", () => {
    expect(stringOrNull("")).toBeNull();
  });

  it("sayıyı metin saymaz", () => {
    expect(stringOrNull(12)).toBeNull();
  });

  it("yedek metin kullanılır", () => {
    expect(stringOr(null, "bilinmiyor")).toBe("bilinmiyor");
  });
});

describe("neden sözlüğü", () => {
  it("metin değerleri alır", () => {
    expect(reasonMap({ oee: "Planlanan süre yok." })).toEqual({
      oee: "Planlanan süre yok.",
    });
  });

  it("metin olmayan değerleri atar", () => {
    expect(reasonMap({ oee: 12 })).toEqual({});
  });

  it("boş metni atar", () => {
    expect(reasonMap({ oee: "" })).toEqual({});
  });

  it("sözlük olmayan girdide boş döner", () => {
    expect(reasonMap(null)).toEqual({});
  });
});

describe("alarm alanları", () => {
  it("bilinen durumu korur", () => {
    expect(parseAlarmState("ACKNOWLEDGED")).toBe("ACKNOWLEDGED");
  });

  it("tanınmayan durumu açık sayar", () => {
    expect(parseAlarmState("YENI_DURUM")).toBe("OPEN");
  });

  it("eksik durumu açık sayar", () => {
    expect(parseAlarmState(undefined)).toBe("OPEN");
  });

  it("bilinen ağırlığı korur", () => {
    expect(parseSeverity("critical")).toBe("critical");
  });

  it("tanınmayan ağırlığı uyarı sayar", () => {
    expect(parseSeverity("felaket")).toBe("warning");
  });

  it("bilinen kuralı korur", () => {
    expect(parseRule("queue_high")).toBe("queue_high");
  });

  it("tanınmayan kuralı benzetim sayar", () => {
    expect(parseRule("yeni_kural")).toBe("simulation");
  });
});

const SUNUCU_ALARMI = {
  id: "machine_down::TORNA_01",
  rule: "machine_down",
  rule_label: "Makine durdu",
  subject: "TORNA_01",
  severity: "critical",
  severity_label: "Kritik",
  message: "TORNA_01 duruşta.",
  state: "OPEN",
  state_label: "Açık",
  raised_at_ms: 1_000,
  updated_at_ms: 2_000,
  acknowledged_by: null,
  acknowledged_at_ms: null,
  resolved_at_ms: null,
  duration_ms: 60_000,
  context: { status: "down" },
};

describe("alarm çözümleme", () => {
  it("kimliği taşır", () => {
    expect(parseAlarm(SUNUCU_ALARMI).id).toBe("machine_down::TORNA_01");
  });

  it("kaynağı gerçek olarak işaretler", () => {
    expect(parseAlarm(SUNUCU_ALARMI).origin).toBe("runtime");
  });

  it("kaynağı benzetim olarak işaretleyebilir", () => {
    expect(parseAlarm(SUNUCU_ALARMI, "simulation").originLabel).toBe("Benzetim");
  });

  it("ağırlığı çözer", () => {
    expect(parseAlarm(SUNUCU_ALARMI).severity).toBe("critical");
  });

  it("süresi ölçülmemişse null", () => {
    const alarm = parseAlarm({ ...SUNUCU_ALARMI, duration_ms: null });
    expect(alarm.durationMs).toBeNull();
  });

  it("onaylayanı taşır", () => {
    const alarm = parseAlarm({ ...SUNUCU_ALARMI, acknowledged_by: "Ayşe" });
    expect(alarm.acknowledgedBy).toBe("Ayşe");
  });

  it("bağlamı taşır", () => {
    expect(parseAlarm(SUNUCU_ALARMI).context).toEqual({ status: "down" });
  });

  it("boş gövdede çökmez", () => {
    expect(parseAlarm(null).state).toBe("OPEN");
  });

  it("eksik kimliği kuraldan üretir", () => {
    const alarm = parseAlarm({ rule: "no_data", subject: "M1" });
    expect(alarm.id).toBe("no_data::M1");
  });

  it("liste çözümlenir", () => {
    expect(parseAlarms([SUNUCU_ALARMI, SUNUCU_ALARMI])).toHaveLength(2);
  });

  it("liste olmayan girdide boş döner", () => {
    expect(parseAlarms({})).toEqual([]);
  });
});

describe("alarm merkezi yanıtı", () => {
  it("etkin ve geçmişi ayırır", () => {
    const state = parseAlarmCenter({
      active: [SUNUCU_ALARMI],
      history: [{ ...SUNUCU_ALARMI, state: "RESOLVED" }],
      counts: { active: 1, open: 1, acknowledged: 0, critical: 1, history: 1 },
    });
    expect(state.active).toHaveLength(1);
    expect(state.history).toHaveLength(1);
  });

  it("sayaçları çözer", () => {
    const state = parseAlarmCenter({ counts: { active: 3, open: 2 } });
    expect(state.counts.active).toBe(3);
    expect(state.counts.open).toBe(2);
  });

  it("sayaç yoksa sıfırlarla döner", () => {
    expect(parseAlarmCenter({}).counts.active).toBe(0);
  });

  it("eksik sayaç alanı sıfır olur", () => {
    expect(parseCounts({ active: 2 }).critical).toBe(0);
  });
});

describe("OEE çözümleme", () => {
  const TAM = {
    availability: 0.9,
    performance: 0.95,
    quality: 0.98,
    oee: 0.8379,
    percent: { availability: 90, performance: 95, quality: 98, oee: 83.79 },
    reasons: {},
    complete: true,
  };

  it("çarpanları çözer", () => {
    expect(parseOee(TAM).availability).toBe(0.9);
  });

  it("yüzdeleri çözer", () => {
    expect(parseOee(TAM).percent.oee).toBe(83.79);
  });

  it("eksiksiz bayrağını taşır", () => {
    expect(parseOee(TAM).complete).toBe(true);
  });

  it("hesaplanamayan OEE null kalır", () => {
    const parsed = parseOee({ ...TAM, oee: null, percent: { oee: null } });
    expect(parsed.oee).toBeNull();
    expect(parsed.percent.oee).toBeNull();
  });

  it("nedenleri taşır", () => {
    const parsed = parseOee({ reasons: { quality: "Fire ölçülmedi." } });
    expect(parsed.reasons.quality).toBe("Fire ölçülmedi.");
  });

  it("boş gövdede her şey null", () => {
    const parsed = parseOee(null);
    expect(parsed.oee).toBeNull();
    expect(parsed.complete).toBe(false);
  });
});

describe("KPI çözümleme", () => {
  it("ölçümleri çözer", () => {
    const kpi = parseMonitoringKpi({ production: 162, queue: 3 });
    expect(kpi.production).toBe(162);
    expect(kpi.queue).toBe(3);
  });

  it("ölçülmemiş alan null kalır", () => {
    expect(parseMonitoringKpi({}).throughput).toBeNull();
  });

  it("makine sayaçları sıfırla başlar", () => {
    expect(parseMonitoringKpi({}).totalMachines).toBe(0);
  });

  it("nedenleri taşır", () => {
    const kpi = parseMonitoringKpi({
      reasons: { throughput: "İki okuma gerekiyor." },
    });
    expect(kpi.reasons.throughput).toBe("İki okuma gerekiyor.");
  });

  it("NaN gelirse null olur", () => {
    expect(parseMonitoringKpi({ production: Number.NaN }).production).toBeNull();
  });
});

describe("üretim durumu çözümleme", () => {
  it("makine sayılarını çözer", () => {
    const status = parseProductionStatus({
      running_machines: 4,
      blocked_machines: 1,
      down_machines: 2,
      total_machines: 7,
    });
    expect(status.runningMachines).toBe(4);
    expect(status.totalMachines).toBe(7);
  });

  it("ölçülmemiş OEE null kalır", () => {
    expect(parseProductionStatus({ oee: null }).oee).toBeNull();
  });

  it("OEE nedenlerini taşır", () => {
    const status = parseProductionStatus({
      oee_reasons: { oee: "Kalite ölçülmedi." },
    });
    expect(status.oeeReasons.oee).toBe("Kalite ölçülmedi.");
  });

  it("boş gövdede çökmez", () => {
    expect(parseProductionStatus(undefined).activeAlarms).toBe(0);
  });
});

describe("zaman çizelgesi çözümleme", () => {
  it("duruş satırını çözer", () => {
    const entry = parseTimelineEntry({
      type: "downtime",
      at_ms: 1_000,
      end_ms: 61_000,
      machine_id: "TORNA_01",
      duration_ms: 60_000,
      reason: "Bildirilmedi",
      open: false,
    });
    expect(entry.type).toBe("downtime");
    expect(entry.durationMs).toBe(60_000);
  });

  it("duruş satırında ağırlık yok", () => {
    const entry = parseTimelineEntry({ type: "downtime", severity: "critical" });
    expect(entry.severity).toBeNull();
  });

  it("alarm satırında ağırlık var", () => {
    const entry = parseTimelineEntry({ type: "alarm", severity: "critical" });
    expect(entry.severity).toBe("critical");
  });

  it("süren satır açık işaretlenir", () => {
    expect(parseTimelineEntry({ open: true }).open).toBe(true);
  });

  it("bitmemiş satırın bitişi null", () => {
    expect(parseTimelineEntry({ end_ms: null }).endMs).toBeNull();
  });

  it("liste çözümlenir", () => {
    const rows = parseTimeline({ entries: [{ type: "alarm" }, { type: "downtime" }] });
    expect(rows).toHaveLength(2);
  });

  it("boş yanıtta boş liste", () => {
    expect(parseTimeline({})).toEqual([]);
  });
});

describe("sağlık skoru çözümleme", () => {
  it("skoru çözer", () => {
    expect(parseHealthScore({ score: 92.8, label: "İyi" }).score).toBe(92.8);
  });

  it("ölçülmemiş skor null kalır", () => {
    const parsed = parseHealthScore({ score: null, label: "Ölçülmedi" });
    expect(parsed.score).toBeNull();
    expect(parsed.label).toBe("Ölçülmedi");
  });

  it("bağlantı listesini çözer", () => {
    const parsed = parseHealthScore({
      connections: [
        { connection_id: "c1", score: 80, components: { uptime: 1 }, missing: ["latency"] },
      ],
    });
    expect(parsed.connections[0].connectionId).toBe("c1");
    expect(parsed.connections[0].missing).toEqual(["latency"]);
  });

  it("eksik bileşen null kalır", () => {
    const parsed = parseHealthScore({
      connections: [{ connection_id: "c1", components: { latency: null } }],
    });
    expect(parsed.connections[0].components.latency).toBeNull();
  });

  it("boş gövdede çökmez", () => {
    expect(parseHealthScore(null).connections).toEqual([]);
  });
});
