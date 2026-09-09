/**
 * Runtime tanılama katmanı.
 *
 *     sunucu sayaçları → /api/runtime/diagnostics → parse → format → ekran
 *
 * Ekranın amacı sistemin ne bildiğini **ve ne bilmediğini** göstermektir;
 * ölçülemeyen her ölçüt nedeniyle birlikte görünür.
 */

export {
  NOT_MEASURED,
  formatAge,
  historySpanMs,
  levelLabel,
  metricNote,
  metricValue,
  persistenceWarning,
  reportCaption,
  streamCaption,
} from "./format";
export {
  parseCleanup,
  parseContinuity,
  parseDiagnostics,
  parseLevel,
  parseLiveness,
  parseMetric,
  parseMetrics,
  parseStream,
  parseStreams,
} from "./parse";
export {
  DIAGNOSTIC_LEVEL_LABEL,
  DIAGNOSTIC_LEVEL_ORDER,
  EMPTY_DIAGNOSTICS,
  LIVENESS_LABEL,
  type CleanupStats,
  type DiagnosticLevel,
  type DiagnosticMetric,
  type DiagnosticsReport,
  type Liveness,
  type StreamLiveness,
} from "./types";
