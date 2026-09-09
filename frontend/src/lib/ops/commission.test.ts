/**
 * Fabrika devreye alma listesi.
 *
 * Bu dosyanın koruduğu kural: **hiçbir adım elle işaretlenmez.** Her adımın
 * durumu ürünün gerçek hâlinden türer. Elle işaretlenebilen bir liste,
 * kurulumu yapan kişinin iyi niyetini ölçer; ürünün hazır olup olmadığını
 * değil.
 *
 * İkinci kural: "yapılmadı" ile "ölçülemedi" ayrı durumlardır. Birincisinde
 * kullanıcı bir iş yapmalı, ikincisinde sistem bir ölçüm alamıyor.
 */

import { describe, expect, it } from "vitest";
import {
  buildCommissionReport,
  describeCommission,
  pendingSteps,
  type CommissionInput,
} from "./commission";

function input(overrides: Partial<CommissionInput> = {}): CommissionInput {
  return {
    connections: [],
    mappedConnections: 0,
    oee: null,
    alarmsRaised: 0,
    reportGenerated: false,
    backupVerified: false,
    loaded: true,
    ...overrides,
  };
}

function stepOf(report: ReturnType<typeof buildCommissionReport>, id: string) {
  const found = report.steps.find((item) => item.id === id);
  if (found === undefined) throw new Error(`adım yok: ${id}`);
  return found;
}

const FULL: CommissionInput = {
  connections: [
    { id: "c1", protocol: "opcua", verified: true },
    { id: "c2", protocol: "mqtt", verified: true },
    { id: "c3", protocol: "rest", verified: true },
  ],
  mappedConnections: 3,
  oee: 0.84,
  alarmsRaised: 2,
  reportGenerated: true,
  backupVerified: true,
  loaded: true,
};

describe("liste yapısı", () => {
  it("dokuz adım üretir", () => {
    expect(buildCommissionReport(input()).steps).toHaveLength(9);
  });

  it("adım kimlikleri benzersiz", () => {
    const ids = buildCommissionReport(input()).steps.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("her adımın nedeni yazılır", () => {
    for (const step of buildCommissionReport(input()).steps) {
      expect(step.reason.length).toBeGreaterThan(0);
    }
  });

  it("tamamlanmamış adım ne yapılacağını söyler", () => {
    for (const step of pendingSteps(buildCommissionReport(input()))) {
      expect(step.action).not.toBeNull();
    }
  });

  it("tamamlanan adımda eylem yok", () => {
    const report = buildCommissionReport(FULL);
    for (const step of report.steps.filter((item) => item.state === "done")) {
      expect(step.action).toBeNull();
    }
  });
});

describe("ölçüm okunamadığında", () => {
  it("bütün adımlar ölçülemedi olur", () => {
    const report = buildCommissionReport(input({ loaded: false }));
    expect(report.steps.every((item) => item.state === "unknown")).toBe(true);
  });

  it("oran hesaplanmaz", () => {
    /* "%0 tamam" ile "ölçülemedi" farklı şeylerdir. */
    expect(buildCommissionReport(input({ loaded: false })).ratio).toBeNull();
  });

  it("hazır sayılmaz", () => {
    expect(buildCommissionReport(input({ loaded: false })).ready).toBe(false);
  });

  it("tamamlanan sayısı sıfır", () => {
    expect(buildCommissionReport(input({ loaded: false })).done).toBe(0);
  });

  it("özet ölçülemedi der", () => {
    const report = buildCommissionReport(input({ loaded: false }));
    expect(describeCommission(report)).toContain("ölçülemedi");
  });
});

describe("PLC adımı", () => {
  it("doğrulanmış bağlantı varsa tamam", () => {
    const report = buildCommissionReport(
      input({ connections: [{ id: "c1", protocol: "opcua", verified: true }] }),
    );
    expect(stepOf(report, "plc").state).toBe("done");
  });

  it("tanımlı ama doğrulanmamış bağlantı yetmez", () => {
    /* Kâğıt üzerinde bir kayıt, bağlanmış bir PLC değildir. */
    const report = buildCommissionReport(
      input({ connections: [{ id: "c1", protocol: "opcua", verified: false }] }),
    );
    expect(stepOf(report, "plc").state).toBe("pending");
  });

  it("doğrulanmamışsa ne yapılacağını söyler", () => {
    const report = buildCommissionReport(
      input({ connections: [{ id: "c1", protocol: "opcua", verified: false }] }),
    );
    expect(stepOf(report, "plc").action).toContain("doğrula");
  });

  it("hiç bağlantı yoksa bunu söyler", () => {
    const report = buildCommissionReport(input());
    expect(stepOf(report, "plc").reason).toContain("Hiç bağlantı");
  });

  it("doğrulanan sayısını yazar", () => {
    const report = buildCommissionReport(
      input({
        connections: [
          { id: "c1", protocol: "opcua", verified: true },
          { id: "c2", protocol: "mqtt", verified: true },
        ],
      }),
    );
    expect(stepOf(report, "plc").reason).toContain("2 bağlantı");
  });
});

describe("protokol adımları", () => {
  it("doğrulanmış OPC UA tamam olur", () => {
    const report = buildCommissionReport(
      input({ connections: [{ id: "c1", protocol: "opcua", verified: true }] }),
    );
    expect(stepOf(report, "opcua").state).toBe("done");
  });

  it("doğrulanmamış OPC UA bekler", () => {
    const report = buildCommissionReport(
      input({ connections: [{ id: "c1", protocol: "opcua", verified: false }] }),
    );
    expect(stepOf(report, "opcua").state).toBe("pending");
  });

  it("bir protokolün doğrulanması ötekini tamamlamaz", () => {
    const report = buildCommissionReport(
      input({ connections: [{ id: "c1", protocol: "opcua", verified: true }] }),
    );
    expect(stepOf(report, "mqtt").state).toBe("pending");
  });

  it("MQTT doğrulanır", () => {
    const report = buildCommissionReport(
      input({ connections: [{ id: "c1", protocol: "mqtt", verified: true }] }),
    );
    expect(stepOf(report, "mqtt").state).toBe("done");
  });

  it("REST doğrulanır", () => {
    const report = buildCommissionReport(
      input({ connections: [{ id: "c1", protocol: "rest", verified: true }] }),
    );
    expect(stepOf(report, "rest").state).toBe("done");
  });

  it("kullanılmayan protokol bunu söyler", () => {
    const report = buildCommissionReport(input());
    expect(stepOf(report, "mqtt").reason).toContain("bağlantısı yok");
  });
});

describe("eşleme adımı", () => {
  it("hepsi eşlenmişse tamam", () => {
    const report = buildCommissionReport(
      input({
        connections: [{ id: "c1", protocol: "rest", verified: true }],
        mappedConnections: 1,
      }),
    );
    expect(stepOf(report, "mapping").state).toBe("done");
  });

  it("eksik eşleme sayısını yazar", () => {
    const report = buildCommissionReport(
      input({
        connections: [
          { id: "c1", protocol: "rest", verified: true },
          { id: "c2", protocol: "mqtt", verified: true },
        ],
        mappedConnections: 1,
      }),
    );
    expect(stepOf(report, "mapping").reason).toContain("1 bağlantının");
  });

  it("bağlantı yoksa eşlenecek şey yok", () => {
    const report = buildCommissionReport(input());
    expect(stepOf(report, "mapping").reason).toContain("Eşlenecek bağlantı yok");
  });
});

describe("OEE adımı", () => {
  it("hesaplanmışsa tamam", () => {
    expect(stepOf(buildCommissionReport(input({ oee: 0.8 })), "oee").state).toBe("done");
  });

  it("hesaplanamıyorsa bekler", () => {
    expect(stepOf(buildCommissionReport(input()), "oee").state).toBe("pending");
  });

  it("sıfır OEE de hesaplanmış sayılır", () => {
    /* Ölçülmüş sıfır, ölçülmemiş değerden farklıdır. */
    expect(stepOf(buildCommissionReport(input({ oee: 0 })), "oee").state).toBe("done");
  });

  it("hesaplanamıyorsa nedeni söyler", () => {
    expect(stepOf(buildCommissionReport(input()), "oee").reason).toContain("ölçülmedi");
  });
});

describe("alarm adımı", () => {
  it("alarm açıldıysa tamam", () => {
    expect(stepOf(buildCommissionReport(input({ alarmsRaised: 1 })), "alarm").state).toBe(
      "done",
    );
  });

  it("hiç alarm yoksa bekler", () => {
    expect(stepOf(buildCommissionReport(input()), "alarm").state).toBe("pending");
  });

  it("nasıl sınanacağını söyler", () => {
    expect(stepOf(buildCommissionReport(input()), "alarm").action).toContain("durdurup");
  });
});

describe("rapor ve yedek adımları", () => {
  it("rapor üretilmişse tamam", () => {
    const report = buildCommissionReport(input({ reportGenerated: true }));
    expect(stepOf(report, "report").state).toBe("done");
  });

  it("rapor yoksa bekler", () => {
    expect(stepOf(buildCommissionReport(input()), "report").state).toBe("pending");
  });

  it("yedek doğrulanmışsa tamam", () => {
    const report = buildCommissionReport(input({ backupVerified: true }));
    expect(stepOf(report, "backup").state).toBe("done");
  });

  it("yedek yoksa bekler", () => {
    expect(stepOf(buildCommissionReport(input()), "backup").state).toBe("pending");
  });
});

describe("özet", () => {
  it("tam kurulumda hazır olur", () => {
    expect(buildCommissionReport(FULL).ready).toBe(true);
  });

  it("tam kurulumda oran bir", () => {
    expect(buildCommissionReport(FULL).ratio).toBe(1);
  });

  it("eksik kurulumda hazır olmaz", () => {
    expect(buildCommissionReport(input()).ready).toBe(false);
  });

  it("tamamlanan sayısı sayılır", () => {
    const report = buildCommissionReport({ ...FULL, backupVerified: false });
    expect(report.done).toBe(report.total - 1);
  });

  it("oran hesaplanır", () => {
    const report = buildCommissionReport({ ...FULL, backupVerified: false });
    expect(report.ratio).toBeCloseTo((report.total - 1) / report.total);
  });

  it("hazır olunca özet bunu söyler", () => {
    expect(describeCommission(buildCommissionReport(FULL))).toContain("hazır");
  });

  it("eksikken kaç adım kaldığını söyler", () => {
    const report = buildCommissionReport(input());
    expect(describeCommission(report)).toContain(`/${report.total}`);
  });

  it("bekleyen adımlar süzülür", () => {
    const report = buildCommissionReport({ ...FULL, backupVerified: false });
    expect(pendingSteps(report)).toHaveLength(1);
  });

  it("tam kurulumda bekleyen adım yok", () => {
    expect(pendingSteps(buildCommissionReport(FULL))).toHaveLength(0);
  });
});
