/**
 * Runtime tanılama ekranının türleri.
 *
 * Her sayı sunucudaki gerçek bir sayaçtan gelir: dağıtıcının işlediği olay,
 * kuyruğun derinliği, telemetri yazıcısının hız örnekleri. Hiçbiri tarayıcıda
 * hesaplanmaz ve hiçbiri tahmin edilmez.
 *
 * Ölçülemeyen bir ölçüt `value: null` taşır ve `reason` alanında **neden**
 * ölçülemediğini söyler. Sıfır gösterilseydi, hiç olay işlememiş bir sistem
 * "saniyede sıfır olay" diye okunur ve arızalı sanılırdı.
 */

/** Bir ölçütün durumu; sunucudaki değerlerle birebir aynı. */
export type DiagnosticLevel = "ok" | "warning" | "critical" | "unknown";

export const DIAGNOSTIC_LEVEL_LABEL: Record<DiagnosticLevel, string> = {
  ok: "Normal",
  warning: "Dikkat",
  critical: "Kritik",
  unknown: "Ölçülmedi",
};

/** En kötüden iyiye sıralama; özet durum bu sıraya göre seçilir. */
export const DIAGNOSTIC_LEVEL_ORDER: DiagnosticLevel[] = [
  "critical",
  "warning",
  "ok",
  "unknown",
];

/** Tek bir tanılama ölçütü. */
export interface DiagnosticMetric {
  id: string;
  label: string;
  /** Ölçülen değer; ölçülemediyse `null`. */
  value: number | null;
  unit: string | null;
  level: DiagnosticLevel;
  /** Ölçülemediyse nedeni; ölçüldüyse `null`. */
  reason: string | null;
  measured: boolean;
}

/** Bir akışın canlılık durumu. */
export type Liveness = "live" | "idle" | "stale" | "unknown";

export const LIVENESS_LABEL: Record<Liveness, string> = {
  live: "Veri akıyor",
  idle: "Veri bekleniyor",
  stale: "Veri bayat",
  unknown: "Henüz veri gelmedi",
};

/** Akış başına kesintisizlik durumu. */
export interface StreamLiveness {
  connectorId: string;
  /** Son verinin anı; hiç veri gelmediyse `null`. */
  lastDataMs: number | null;
  /** Son verinin üstünden geçen süre; hiç veri gelmediyse `null`. */
  ageMs: number | null;
  liveness: Liveness;
  livenessLabel: string;
  /** Kaç kez kopup geri geldi? */
  reconnects: number;
  /** Art arda kaçıncı yeniden bağlanma denemesi? */
  attempt: number;
  /** Kesintinin başladığı an; kesinti yoksa `null`. */
  outageStartedMs: number | null;
}

/** Saklama temizliğinin sayaçları. */
export interface CleanupStats {
  runs: number;
  totalDeleted: number;
  errors: number;
  lastError: string | null;
  /** Son turun anı; hiç çalışmadıysa `null`. */
  lastRunMs: number | null;
  retentionDays: number;
}

/** Tanılama ekranının tam görünümü. */
export interface DiagnosticsReport {
  atMs: number;
  level: DiagnosticLevel;
  levelLabel: string;
  metrics: DiagnosticMetric[];
  streams: StreamLiveness[];
  /** Kaç ölçüt gerçekten ölçüldü? */
  measuredCount: number;
  metricCount: number;
  cleanup: CleanupStats;
  /** Telemetri tablosundaki satır sayısı. */
  telemetryRows: number;
  /** En eski ölçümün anı; tablo boşsa `null`. */
  oldestTelemetryMs: number | null;
  /**
   * Kalıcılık modu. `memory` ise sunucu yeniden başladığında telemetri
   * kaybolur ve arayüz bunu açıkça yazar.
   */
  persistenceMode: string;
}

/** Henüz yüklenmemiş rapor; ekran açılırken gösterilir. */
export const EMPTY_DIAGNOSTICS: DiagnosticsReport = {
  atMs: 0,
  level: "unknown",
  levelLabel: DIAGNOSTIC_LEVEL_LABEL.unknown,
  metrics: [],
  streams: [],
  measuredCount: 0,
  metricCount: 0,
  cleanup: {
    runs: 0,
    totalDeleted: 0,
    errors: 0,
    lastError: null,
    lastRunMs: null,
    retentionDays: 0,
  },
  telemetryRows: 0,
  oldestTelemetryMs: null,
  persistenceMode: "bilinmiyor",
};
