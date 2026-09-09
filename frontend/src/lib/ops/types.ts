/**
 * Üretim operasyonlarının arayüz modeli.
 *
 * Bu katmanın tamamı tek bir soruya hizmet eder: "bu kurulum gerçekten hazır
 * mı?" Yanıt hiçbir yerde varsayılmaz — ölçülemeyen değer `null` döner ve
 * ekran "ölçülmedi" yazar.
 */

/** Sağlık ucunun yanıtı. */
export interface HealthStatus {
  status: string;
  version: string;
  uptimeMs: number;
}

/** Hazırlık yoklamalarından biri. */
export interface DependencyCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** Ölçülen süre (ms); ölçülemediyse `null`. */
  latencyMs: number | null;
}

export const CHECK_LABEL: Record<string, string> = {
  configuration: "Yapılandırma",
  database: "Veritabanı",
  shutdown: "Kapanış",
};

/** Ortam denetiminin bir bulgusu. */
export interface EnvironmentFinding {
  key: string;
  severity: "error" | "warning";
  severityLabel: string;
  message: string;
  remedy: string;
}

export interface EnvironmentReport {
  environment: string;
  production: boolean;
  ok: boolean;
  errors: EnvironmentFinding[];
  warnings: EnvironmentFinding[];
}

/** Hazırlık ucunun yanıtı. */
export interface ReadinessStatus {
  ready: boolean;
  version: string;
  uptimeMs: number;
  environment: string;
  checks: DependencyCheck[];
  warnings: EnvironmentFinding[];
}

/** Süreç ölçümleri; ölçülemeyen alan `null`. */
export interface ProcessMetrics {
  uptimeMs: number;
  uptimeSeconds: number;
  /** Kullanılan bellek (MB); `psutil` yoksa `null`. */
  memoryMb: number | null;
  /** İşlemci kullanımı (%); ilk ölçümde `null`. */
  cpuPercent: number | null;
  requests: number;
  errors: number;
  /** Hata oranı (0-1); hiç istek görülmediyse `null`. */
  errorRate: number | null;
  recentErrorRate: number | null;
  /** Bellek/işlemci ölçümü yapılabiliyor mu? */
  measurementAvailable: boolean;
}

/** Denetim kaydı. */
export interface AuditEntry {
  sequence: number;
  orgId: string;
  action: string;
  actionLabel: string;
  resource: string;
  actor: string;
  outcome: "success" | "failure";
  outcomeLabel: string;
  atMs: number;
  details: Record<string, unknown>;
}

export interface AuditSummary {
  total: number;
  failures: number;
  byAction: Record<string, number>;
  /** Kayıtlar diske yazılıyor mu? */
  persistent: boolean;
  writeErrors: number;
  lastError: string | null;
}

/** Yedek özeti. */
export interface BackupSummary {
  orgId: string;
  atMs: number;
  checksum: string;
  counts: Record<string, number>;
  totalRows: number;
  formatVersion: number;
}

/** Geri yükleme sonucu. */
export interface RestoreSummary {
  orgId: string;
  ok: boolean;
  error: string | null;
  restored: Record<string, number>;
  removed: Record<string, number>;
  totalRestored: number;
}

/**
 * Devreye alma listesindeki bir adımın durumu.
 *
 * Üç durum vardır ve ikisini birleştirmek yanlış olurdu: **yapılmadı** ile
 * **doğrulanamadı** farklı şeylerdir. Birincisinde kullanıcı bir iş yapmalı,
 * ikincisinde sistem bir ölçüm alamıyor.
 */
export type CommissionState = "done" | "pending" | "unknown";

export const COMMISSION_STATE_LABEL: Record<CommissionState, string> = {
  done: "Tamam",
  pending: "Bekliyor",
  unknown: "Ölçülemedi",
};

/** Devreye alma listesindeki tek bir adım. */
export interface CommissionStep {
  id: string;
  label: string;
  state: CommissionState;
  /** Adımın neden bu durumda olduğu — her zaman yazılır. */
  reason: string;
  /** Kullanıcının ne yapması gerektiği; tamamlanmışsa `null`. */
  action: string | null;
}

export interface CommissionReport {
  steps: CommissionStep[];
  /** Tamamlanan adım sayısı. */
  done: number;
  total: number;
  /** Tamamlanma oranı (0-1); adım yoksa `null`. */
  ratio: number | null;
  /** Fabrika devreye alınmaya hazır mı? */
  ready: boolean;
}
