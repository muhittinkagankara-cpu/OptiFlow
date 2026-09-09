/**
 * Devreye alma katmanının türleri: kurulum tokenı, makine etiketi, kontrol
 * listesi ve saha tanılama.
 *
 * Token metni yalnızca bir kez görülür
 * ------------------------------------
 * Sunucu tokenı yalnızca üretim yanıtında döndürür; listeleme ucunda yoktur.
 * Arayüz de onu saklamaz — kullanıcı kopyalamadan pencereyi kapatırsa token
 * kaybolur ve yenisi üretilir. Saklansaydı, tarayıcı belleğine düşen bir
 * kurulum anahtarı olurdu.
 *
 * Kontrol listesi üç değerlidir
 * -----------------------------
 * "Tamam", "Bekliyor" ve "Ölçülemedi" ayrı durumlardır. Üçüncüsü ikincisiyle
 * karıştırılmaz: birincisinde eksik olan iş, ikincisinde ölçümdür.
 */

/** Kurulum tokenının durumu. */
export type TokenStatus = "active" | "used" | "expired" | "revoked";

export const TOKEN_STATUS_LABEL: Record<TokenStatus, string> = {
  active: "Kullanılabilir",
  used: "Kullanıldı",
  expired: "Süresi doldu",
  revoked: "İptal edildi",
};

/** Kurulum günlüğündeki bir satır. */
export interface TokenLogEntry {
  atMs: number;
  action: string;
  actor: string | null;
  detail: string | null;
}

/** Kurulum tokenı; metni **taşımaz**. */
export interface InstallToken {
  id: string;
  /** Özetin ilk sekiz karakteri; iki tokenı ayırt etmeye yeter. */
  digestPrefix: string;
  createdAtMs: number;
  expiresAtMs: number;
  createdBy: string;
  site: string;
  /** Kullanılmadıysa `null`. */
  usedAtMs: number | null;
  usedBy: string | null;
  usedFrom: string | null;
  revokedAtMs: number | null;
  revokedReason: string | null;
  usageLog: TokenLogEntry[];
  status: TokenStatus;
  statusLabel: string;
  /** Kullanılabilir değilse `null`. */
  remainingMs: number | null;
  usable: boolean;
}

/** Üretim yanıtı; token metni yalnızca burada bulunur. */
export interface IssuedToken extends InstallToken {
  token: string;
  note: string;
}

/** Makinenin sahadaki kalıcı kimliği. */
export interface MachineLabel {
  machineId: string;
  label: string;
  line: string;
  /** QR içeriği; adres değil kimlik taşır. */
  qr: string;
  /** Hiç basılmadıysa `null`. */
  printedAtMs: number | null;
  createdAtMs: number;
  createdBy: string;
  note: string;
}

/** Etiket denetiminin sonucu. */
export interface LabelReview {
  labels: MachineLabel[];
  /** Aynı etiketi taşıyan kayıtlar. */
  duplicates: string[];
  /** Etiketi olmayan makineler. */
  unlabeled: string[];
  /** Etiketsiz makineler için öneri; türetilemezse `null`. */
  suggestions: Record<string, string | null>;
  machineCount: number;
}

/** Kontrol listesi adımının durumu. */
export type StepState = "done" | "pending" | "unknown";

export const STEP_STATE_LABEL: Record<StepState, string> = {
  done: "Tamam",
  pending: "Bekliyor",
  unknown: "Ölçülemedi",
};

/** Kontrol listesindeki tek bir adım. */
export interface ChecklistStep {
  id: string;
  label: string;
  state: StepState;
  /** Bu durumun nedeni; her zaman doludur. */
  reason: string;
  /** Kullanıcının yapması gereken iş; yoksa `null`. */
  action: string | null;
}

/** Kontrol listesinin tam görünümü. */
export interface DeploymentReport {
  steps: ChecklistStep[];
  done: number;
  pending: number;
  unknown: number;
  total: number;
  /** Kurulum tamamlandı mı? Ölçülemeyen adım varken `false`. */
  ready: boolean;
  ratio: number | null;
  summary: string;
}

export const EMPTY_DEPLOYMENT: DeploymentReport = {
  steps: [],
  done: 0,
  pending: 0,
  unknown: 0,
  total: 0,
  ready: false,
  ratio: null,
  summary: "Kontrol listesi henüz okunmadı.",
};

/** Saha tanılama satırının durumu. */
export type ProbeState = "ok" | "warning" | "failed" | "unknown";

export const PROBE_STATE_LABEL: Record<ProbeState, string> = {
  ok: "Normal",
  warning: "Dikkat",
  failed: "Başarısız",
  unknown: "Ölçülmedi",
};

/** Saha tanılamasındaki tek bir satır. */
export interface DiagnosticLine {
  id: string;
  label: string;
  state: ProbeState;
  /** Ölçülemediyse `null`. */
  value: number | null;
  unit: string | null;
  text: string | null;
  reason: string | null;
  measured: boolean;
}

/** Saha tanılamasının tam görünümü. */
export interface FieldDiagnostics {
  atMs: number;
  endpoint: string;
  state: ProbeState;
  stateLabel: string;
  lines: DiagnosticLine[];
  measuredCount: number;
  lineCount: number;
}

export const EMPTY_FIELD_DIAGNOSTICS: FieldDiagnostics = {
  atMs: 0,
  endpoint: "",
  state: "unknown",
  stateLabel: PROBE_STATE_LABEL.unknown,
  lines: [],
  measuredCount: 0,
  lineCount: 0,
};
