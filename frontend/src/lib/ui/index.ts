/**
 * Tasarım sistemi ilkellerinin saf mantığı.
 *
 * Bileşenler yalnızca render eder; hangi durumun hangi rengi aldığı, iskeletin
 * kaç çubuk çizdiği ve bir kökenin ne anlama geldiği burada, sınanabilir saf
 * işlevlerde durur (MASTER §18.3).
 */

export type { DataOrigin, MeasuredState, SkeletonShape } from "./types";

export {
  DEFAULT_ROWS,
  MAX_ROWS,
  MIN_ROWS,
  clampRows,
  skeletonBars,
  skeletonLabel,
  type SkeletonBar,
} from "./skeleton";

export {
  STATE_COLOR_VAR,
  STATE_DOT_CLASS,
  STATE_RULE_CLASS,
  needsAttention,
} from "./status";

export {
  isVerifiedLive,
  originPresentation,
  type OriginPresentation,
} from "./origin";

export { DEFAULT_RETRY_LABEL, normalizeDetail, retryLabel } from "./errorState";
