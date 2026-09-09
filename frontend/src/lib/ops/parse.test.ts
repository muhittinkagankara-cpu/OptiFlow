/**
 * Operasyon yanıtlarının çözümlenmesi ve biçimlendirilmesi.
 *
 * Korunan kural: ölçülemeyen değer `null` kalır ve ekranda "—" olur. Hiç
 * istek almamış bir sunucunun hata oranı "%0" değildir — henüz ölçülmemiştir
 * ve ikisi farklı bilgilerdir.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY,
  formatCpu,
  formatMemory,
  formatRatio,
  formatTimestamp,
  formatUptime,
  measurementNotice,
  parseAuditEntry,
  parseAuditPage,
  parseAuditSummary,
  parseBackupSummary,
  parseCheck,
  parseEnvironment,
  parseFinding,
  parseHealth,
  parseProcessMetrics,
  parseReadiness,
  parseRestoreSummary,
  shortChecksum,
} from "./index";

describe("sağlık yanıtı", () => {
  it("alanları çözer", () => {
    const health = parseHealth({ status: "ok", version: "1.2.3", uptime_ms: 5_000 });
    expect(health.status).toBe("ok");
    expect(health.version).toBe("1.2.3");
    expect(health.uptimeMs).toBe(5_000);
  });

  it("boş gövdede çökmez", () => {
    expect(parseHealth(null).status).toBe("bilinmiyor");
  });

  it("eksik sürüm bilinmiyor olur", () => {
    expect(parseHealth({ status: "ok" }).version).toBe("bilinmiyor");
  });
});

describe("bağımlılık yoklaması", () => {
  it("başarılı yoklamayı çözer", () => {
    const check = parseCheck({ name: "database", ok: true, detail: "yanıt verdi" });
    expect(check.ok).toBe(true);
    expect(check.name).toBe("database");
  });

  it("ok alanı yoksa başarısız sayılır", () => {
    /* Yoklanmamış bir bağımlılık "sağlıklı" sayılmaz. */
    expect(parseCheck({ name: "database" }).ok).toBe(false);
  });

  it("ölçülmemiş gecikme null kalır", () => {
    expect(parseCheck({ name: "database", ok: true }).latencyMs).toBeNull();
  });

  it("ölçülen gecikme korunur", () => {
    expect(parseCheck({ latency_ms: 12.5 }).latencyMs).toBe(12.5);
  });
});

describe("ortam raporu", () => {
  it("hataları ve uyarıları ayırır", () => {
    const report = parseEnvironment({
      environment: "production",
      production: true,
      ok: false,
      errors: [{ key: "SUPABASE_JWKS_URL", severity: "error" }],
      warnings: [{ key: "DATABASE_URL", severity: "warning" }],
    });
    expect(report.errors).toHaveLength(1);
    expect(report.warnings).toHaveLength(1);
  });

  it("üretim bayrağını çözer", () => {
    expect(parseEnvironment({ production: true }).production).toBe(true);
  });

  it("boş gövdede çökmez", () => {
    expect(parseEnvironment(null).errors).toEqual([]);
  });

  it("bulgu çözüm önerisi taşır", () => {
    const finding = parseFinding({ key: "X", remedy: "Tanımlayın." });
    expect(finding.remedy).toBe("Tanımlayın.");
  });

  it("tanınmayan düzey uyarı sayılır", () => {
    expect(parseFinding({ severity: "felaket" }).severity).toBe("warning");
  });
});

describe("hazırlık yanıtı", () => {
  it("hazır bayrağını çözer", () => {
    expect(parseReadiness({ ready: true }).ready).toBe(true);
  });

  it("bayrak yoksa hazır sayılmaz", () => {
    expect(parseReadiness({}).ready).toBe(false);
  });

  it("yoklamaları çözer", () => {
    const readiness = parseReadiness({
      checks: [{ name: "database", ok: true }, { name: "configuration", ok: true }],
    });
    expect(readiness.checks).toHaveLength(2);
  });

  it("uyarıları taşır", () => {
    const readiness = parseReadiness({ warnings: [{ key: "DATABASE_URL" }] });
    expect(readiness.warnings).toHaveLength(1);
  });
});

describe("süreç ölçümleri", () => {
  it("ölçümleri çözer", () => {
    const metrics = parseProcessMetrics({
      uptime_ms: 60_000,
      memory_mb: 128.5,
      cpu_percent: 3.2,
      requests: 100,
      errors: 2,
      error_rate: 0.02,
      measurement_available: true,
    });
    expect(metrics.memoryMb).toBe(128.5);
    expect(metrics.cpuPercent).toBe(3.2);
    expect(metrics.errorRate).toBe(0.02);
  });

  it("ölçülemeyen bellek null kalır", () => {
    expect(parseProcessMetrics({ memory_mb: null }).memoryMb).toBeNull();
  });

  it("ilk işlemci ölçümü null kalır", () => {
    expect(parseProcessMetrics({ cpu_percent: null }).cpuPercent).toBeNull();
  });

  it("hiç istek yokken hata oranı null", () => {
    expect(parseProcessMetrics({}).errorRate).toBeNull();
  });

  it("ölçülmüş sıfır hata oranı korunur", () => {
    expect(parseProcessMetrics({ error_rate: 0 }).errorRate).toBe(0);
  });

  it("ölçüm yapılabilirliği bildirilir", () => {
    expect(parseProcessMetrics({ measurement_available: false }).measurementAvailable).toBe(
      false,
    );
  });
});

describe("denetim kaydı", () => {
  const KAYIT = {
    sequence: 7,
    org_id: "o1",
    action: "alarm_acknowledge",
    action_label: "Alarm görüldü işaretlendi",
    resource: "machine_down::TORNA_01",
    actor: "Ayşe",
    outcome: "success",
    outcome_label: "Başarılı",
    at_ms: 1_000,
    details: { severity: "critical" },
  };

  it("alanları çözer", () => {
    const entry = parseAuditEntry(KAYIT);
    expect(entry.actor).toBe("Ayşe");
    expect(entry.sequence).toBe(7);
  });

  it("etiketi taşır", () => {
    expect(parseAuditEntry(KAYIT).actionLabel).toBe("Alarm görüldü işaretlendi");
  });

  it("başarısız sonucu çözer", () => {
    expect(parseAuditEntry({ ...KAYIT, outcome: "failure" }).outcome).toBe("failure");
  });

  it("tanınmayan sonuç başarılı sayılır", () => {
    expect(parseAuditEntry({ ...KAYIT, outcome: "belirsiz" }).outcome).toBe("success");
  });

  it("aktör yoksa sistem yazılır", () => {
    expect(parseAuditEntry({}).actor).toBe("sistem");
  });

  it("ayrıntıları taşır", () => {
    expect(parseAuditEntry(KAYIT).details.severity).toBe("critical");
  });

  it("sayfa çözümlenir", () => {
    const page = parseAuditPage({ entries: [KAYIT], count: 1, summary: { total: 1 } });
    expect(page.entries).toHaveLength(1);
    expect(page.summary.total).toBe(1);
  });

  it("boş sayfada çökmez", () => {
    expect(parseAuditPage(null).entries).toEqual([]);
  });

  it("özet kalıcılığı bildirir", () => {
    expect(parseAuditSummary({ persistent: true }).persistent).toBe(true);
  });

  it("yazma hatası sayılır", () => {
    expect(parseAuditSummary({ write_errors: 3 }).writeErrors).toBe(3);
  });

  it("eyleme göre sayaç çözülür", () => {
    const summary = parseAuditSummary({ by_action: { connector_connect: 2 } });
    expect(summary.byAction.connector_connect).toBe(2);
  });
});

describe("yedek özeti", () => {
  it("alanları çözer", () => {
    const summary = parseBackupSummary({
      org_id: "o1",
      at_ms: 1_000,
      checksum: "abc123",
      counts: { connections: 2 },
      total_rows: 2,
      format_version: 1,
    });
    expect(summary.totalRows).toBe(2);
    expect(summary.counts.connections).toBe(2);
  });

  it("boş gövdede çökmez", () => {
    expect(parseBackupSummary(null).totalRows).toBe(0);
  });

  it("geri yükleme sonucu çözülür", () => {
    const result = parseRestoreSummary({
      org_id: "o1",
      ok: true,
      restored: { connections: 1 },
      total_restored: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.totalRestored).toBe(1);
  });

  it("başarısız geri yükleme nedenini taşır", () => {
    const result = parseRestoreSummary({ ok: false, error: "Sağlama tutmuyor." });
    expect(result.error).toBe("Sağlama tutmuyor.");
  });
});

describe("biçimlendirme", () => {
  it("saniye yazar", () => {
    expect(formatUptime(30_000)).toBe("30 sn");
  });

  it("dakika yazar", () => {
    expect(formatUptime(600_000)).toBe("10 dk");
  });

  it("saat ve dakika yazar", () => {
    expect(formatUptime(5_400_000)).toBe("1 sa 30 dk");
  });

  it("tam saat sade yazar", () => {
    expect(formatUptime(7_200_000)).toBe("2 sa");
  });

  it("gün yazar", () => {
    expect(formatUptime(2 * 86_400_000)).toBe("2 gün");
  });

  it("gün ve saat yazar", () => {
    expect(formatUptime(86_400_000 + 3_600_000)).toBe("1 gün 1 sa");
  });

  it("ölçülmemiş süre tire olur", () => {
    expect(formatUptime(null)).toBe(EMPTY);
  });

  it("negatif süre tire olur", () => {
    expect(formatUptime(-5)).toBe(EMPTY);
  });

  it("belleği biçimler", () => {
    expect(formatMemory(128.5)).toBe("128.5 MB");
  });

  it("belleği tek ondalığa yuvarlar", () => {
    expect(formatMemory(128.04)).toBe("128.0 MB");
  });

  it("ölçülmemiş bellek tire olur", () => {
    expect(formatMemory(null)).toBe(EMPTY);
  });

  it("işlemciyi biçimler", () => {
    expect(formatCpu(3.25)).toBe("%3.3");
  });

  it("ölçülmemiş işlemci tire olur", () => {
    expect(formatCpu(null)).toBe(EMPTY);
  });

  it("oranı yüzdeye çevirir", () => {
    expect(formatRatio(0.025)).toBe("%2.5");
  });

  it("ölçülmüş sıfır oran yazılır", () => {
    expect(formatRatio(0)).toBe("%0.0");
  });

  it("ölçülmemiş oran tire olur", () => {
    expect(formatRatio(null)).toBe(EMPTY);
  });

  it("zaman damgasını biçimler", () => {
    const at = new Date(2026, 8, 9, 14, 5).getTime();
    expect(formatTimestamp(at)).toBe("09.09.2026 14:05");
  });

  it("ölçülmemiş zaman tire olur", () => {
    expect(formatTimestamp(null)).toBe(EMPTY);
  });

  it("sıfır zaman tire olur", () => {
    expect(formatTimestamp(0)).toBe(EMPTY);
  });

  it("sağlamayı kısaltır", () => {
    expect(shortChecksum("abcdef1234567890")).toBe("abcdef123456");
  });

  it("boş sağlama tire olur", () => {
    expect(shortChecksum("")).toBe(EMPTY);
  });
});

describe("ölçüm uyarısı", () => {
  it("veri yokken söyler", () => {
    expect(measurementNotice(null)).toContain("okunmadı");
  });

  it("psutil yoksa nedenini söyler", () => {
    const metrics = parseProcessMetrics({ measurement_available: false });
    expect(measurementNotice(metrics)).toContain("psutil");
  });

  it("ölçüm yapılabiliyorsa uyarı yok", () => {
    const metrics = parseProcessMetrics({ measurement_available: true });
    expect(measurementNotice(metrics)).toBeNull();
  });
});
