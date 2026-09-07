/**
 * Demo zaman çizelgesi — beş dakikalık anlatı.
 *
 * Demo bir "oyun kaydı" gibi ilerler: her dakika hattın hâli değişir ve
 * ürünün başka bir yeteneği kendiliğinden görünür hâle gelir. Sunum yapan
 * kişinin hiçbir şey tıklaması gerekmez.
 *
 * Zaman **dışarıdan** verilir (`elapsedMs`). `Date.now()` burada okunsaydı
 * işlevler saf olmaktan çıkar ve aşamalar sınanamazdı; React tarafı saati
 * tutar, karar burada verilir.
 */

/** Beş aşamanın numarası. */
export type DemoPhase = 1 | 2 | 3 | 4 | 5;

/** Bir aşamanın süresi (ms). */
export const PHASE_DURATION_MS = 60_000;

/** Toplam aşama sayısı. */
export const PHASE_COUNT = 5;

/** Demonun tamamı (ms). */
export const DEMO_DURATION_MS = PHASE_DURATION_MS * PHASE_COUNT;

export interface PhaseInfo {
  phase: DemoPhase;
  /** Banner'daki kısa ad. */
  label: string;
  /** Bu dakikada ne olduğunu anlatan tek cümle. */
  detail: string;
  /** Kullanıcının bakması gereken ekran. */
  focus: string;
}

export const PHASES: Record<DemoPhase, PhaseInfo> = {
  1: {
    phase: 1,
    label: "Normal üretim",
    detail: "Dört istasyon dengeli çalışıyor; kuyruklar kısa, alarm yok.",
    focus: "Canlı Üretim",
  },
  2: {
    phase: 2,
    label: "Kuyruk oluşuyor",
    detail: "Torna önünde iş birikmeye başladı; doluluk yükseliyor.",
    focus: "Canlı Üretim",
  },
  3: {
    phase: 3,
    label: "Alarm çıktı",
    detail: "Torna kritik doluluğa ulaştı ve hat kararsız hâle geldi.",
    focus: "Alarm merkezi",
  },
  4: {
    phase: 4,
    label: "Öneri üretildi",
    detail: "Kaybın parasal karşılığı hesaplandı ve öncelikli aksiyon çıkarıldı.",
    focus: "Factory Intelligence",
  },
  5: {
    phase: 5,
    label: "İyileştirme sonrası",
    detail: "Öneri uygulandığında hattın nereye geldiği karşılaştırmalı gösteriliyor.",
    focus: "Raporlar",
  },
};

/** Sırayla gezilebilmesi için aşama listesi. */
export const PHASE_LIST: PhaseInfo[] = [1, 2, 3, 4, 5].map(
  (phase) => PHASES[phase as DemoPhase],
);

/**
 * Geçen süreden aşamayı bulur.
 *
 * Beşinci dakikadan sonra demo **başa dönmez**, son aşamada kalır. Döngüye
 * girseydi, sunum yapan kişi konuşurken ekran sessizce ilk dakikaya döner ve
 * anlattığı şeyle ekrandaki görüntü çelişirdi.
 */
export function phaseAt(elapsedMs: number): DemoPhase {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 1;
  }
  const index = Math.floor(elapsedMs / PHASE_DURATION_MS) + 1;
  return Math.min(PHASE_COUNT, Math.max(1, index)) as DemoPhase;
}

/** Bir aşamanın başladığı an (ms). */
export function phaseStartMs(phase: DemoPhase): number {
  return (phase - 1) * PHASE_DURATION_MS;
}

/** Demonun tamamındaki ilerleme (0-1). */
export function demoProgress(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return 0;
  }
  return Math.min(1, elapsedMs / DEMO_DURATION_MS);
}

/** Aşama içindeki ilerleme (0-1); son aşamada süre dolunca 1'de kalır. */
export function phaseProgress(elapsedMs: number): number {
  const phase = phaseAt(elapsedMs);
  const within = elapsedMs - phaseStartMs(phase);
  return Math.min(1, Math.max(0, within / PHASE_DURATION_MS));
}

/**
 * Bir aşamaya atlamak için başlangıç anını yeniden hesaplar.
 *
 * Demoyu beş dakika beklemeden gezmek gerekir: sunumda soru gelir, konu
 * atlanır. Aşamayı doğrudan bir duruma yazmak yerine **başlangıç anını**
 * kaydırmak bilinçlidir — böylece tek bir doğruluk kaynağı kalır (geçen süre)
 * ve atladıktan sonra sayaç kendiliğinden doğru yerden akmaya devam eder.
 */
export function startedAtForPhase(nowMs: number, phase: DemoPhase): number {
  return nowMs - phaseStartMs(phase);
}

/**
 * Aşamanın Canlı Üretim ekranında oynatılacak senaryosu.
 *
 * Canlı ekran kendi olay akışını `lib/live` senaryolarından alır; demo yalnızca
 * hangisinin oynayacağını seçer. Ayrı bir demo senaryosu yazılsaydı, ziyaretçi
 * ürünün gerçek `ReplayProvider`'ını değil, ona benzeyen ikinci bir şeyi
 * görürdü.
 */
export function scenarioForPhase(phase: DemoPhase): string {
  switch (phase) {
    case 1:
      return "normal";
    case 2:
      return "bottleneck";
    case 3:
    case 4:
      return "fault";
    case 5:
      return "handoff";
  }
}

/** Sıradaki aşama; sondaysa başa döner (elle gezinme için). */
export function nextPhase(phase: DemoPhase): DemoPhase {
  return (phase >= PHASE_COUNT ? 1 : phase + 1) as DemoPhase;
}
