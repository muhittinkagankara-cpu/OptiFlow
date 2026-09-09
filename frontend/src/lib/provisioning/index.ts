/**
 * Cihaz devreye alma katmanı.
 *
 *     Uç adresi → Keşif → Etiket seçimi → Eşleme → Test → Kaydet
 *
 * Keşif cihazın kendisine sorar; yanıt alınamazsa liste boş kalır ve nedeni
 * yazılır. Test kaydetmeden önce gelir.
 */

export {
  NOT_MEASURED,
  authLabel,
  credentialCaption,
  deviceChangeWarning,
  discoveryCaption,
  formatLatency,
  stepLabel,
  suggestionOutcome,
  tagValue,
  unmappedWarning,
} from "./format";
export {
  parseChanged,
  parseCredentialTest,
  parseDiscovery,
  parseFingerprint,
  parseStep,
  parseSuggestions,
  parseTag,
  parseTagKind,
  parseTagValue,
  parseTags,
} from "./parse";
export {
  INITIAL_WIZARD,
  NO_DISCOVERY,
  PROVISIONING_ORDER,
  PROVISIONING_STEP_LABEL,
  TAG_KIND_LABEL,
  type CredentialTest,
  type DeviceFingerprint,
  type DiscoveredTag,
  type DiscoveryResult,
  type ProvisioningStep,
  type TagKind,
  type TagMapping,
  type TagSuggestion,
  type WizardState,
} from "./types";
export {
  EVIDENCE_LABEL,
  MAX_EVIDENCE,
  MIN_APPLY_SCORE,
  blockedReason,
  scoreAll,
  scoreLabel,
  scoreSuggestion,
  scoreTone,
  typeMatches,
  type Evidence,
  type ScoredSuggestion,
} from "./scoring";
export {
  applicableSuggestions,
  applySuggestions,
  canEnter,
  canSave,
  clearMapping,
  completeStep,
  goToStep,
  mappingList,
  pruneSelection,
  recordTest,
  resetWizard,
  setMapping,
  stepIndex,
  suggestedCount,
  toggleTag,
  undoSuggestions,
  unmappedTags,
  unresolvedSuggestions,
} from "./wizard";
