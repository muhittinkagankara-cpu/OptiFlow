/**
 * Devreye alma katmanı.
 *
 *     Lisans → Kurulum tokenı → Keşif → Eşleme → Etiket → Kontrol listesi
 *
 * Hiçbir adım kullanıcının işaretlemesiyle tamamlanmaz; her adımın durumu
 * sistemin gerçek hâlinden türer.
 */

export {
  NOT_MEASURED,
  deploymentCaption,
  diagnosticsCaption,
  formatDuration,
  labelWarnings,
  lineValue,
  printedRatio,
  probeStateLabel,
  probeTone,
  stepStateLabel,
  stepTone,
  tokenCaption,
  tokenStatusLabel,
  tokenTone,
} from "./format";
export { buildLabelDocument } from "./labelDocument";
export {
  LABELS_PER_PAGE,
  LABEL_COLUMNS,
  LABEL_ROWS,
  cellCaption,
  labelCount,
  labelFileName,
  pageCount,
  paginate,
  type LabelCell,
  type LabelPage,
} from "./labels";
export {
  parseChecklistStep,
  parseDeployment,
  parseDiagnosticLine,
  parseFieldDiagnostics,
  parseIssuedToken,
  parseLabelReview,
  parseLogEntry,
  parseMachineLabel,
  parseProbeState,
  parseStepState,
  parseToken,
  parseTokenStatus,
  parseTokens,
} from "./parse";
export {
  EMPTY_DEPLOYMENT,
  EMPTY_FIELD_DIAGNOSTICS,
  PROBE_STATE_LABEL,
  STEP_STATE_LABEL,
  TOKEN_STATUS_LABEL,
  type ChecklistStep,
  type DeploymentReport,
  type DiagnosticLine,
  type FieldDiagnostics,
  type InstallToken,
  type IssuedToken,
  type LabelReview,
  type MachineLabel,
  type ProbeState,
  type StepState,
  type TokenLogEntry,
  type TokenStatus,
} from "./types";
