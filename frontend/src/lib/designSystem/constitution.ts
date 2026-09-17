/**
 * Tasarım Anayasası V4'ün otomatik bekçisi (Sprint 2M).
 *
 * MASTER §3.8 kuralları bugüne kadar insan gözüyle korunuyordu: her sprintin
 * sonunda tarayıcıda ölçülüyor, ihlal bulunursa düzeltiliyordu. Bu yöntem iki
 * yerde kırılır — ölçüm yapılmayan bir sprint kuralı sessizce gevşetir ve
 * yalnızca `:hover` gibi bir durumda görünen ihlal hiç ölçülmez.
 *
 * Buradaki her şey **saftır**: dosya sistemi okumaz, ağ kullanmaz. Girdi olarak
 * dosya içeriklerini alır, çıktı olarak bulguları verir. Böylece hem vitest'te
 * (node ortamı, tarayıcısız) hem de kabul belgesini üreten betikte aynı mantık
 * çalışır; kural iki yerde ayrı yazılsaydı biri güncellenir öteki unutulurdu.
 */

/** V4'ün zorunlu olduğu alanlar. */
export const PROTECTED_AREAS = [
  "components/live",
  "components/results",
  "components/reports",
  "components/finance",
  "components/heatmap",
  "components/dashboard",
  "components/ui",
] as const;

/** Bir kuraldan muaf tutulan yol ve gerekçesi. */
export interface Exemption {
  /** Yolun içerdiği parça. */
  path: string;
  reason: string;
}

export interface Rule {
  id: string;
  title: string;
  /** Kuralın neden var olduğu; rapora bu cümle gider. */
  why: string;
  /** Eşleşirse kural düşer. */
  patterns: RegExp[];
  exemptions: Exemption[];
}

export interface SourceFile {
  /** `src/` köküne göre, eğik bölü ile. */
  path: string;
  source: string;
}

export interface Finding {
  ruleId: string;
  path: string;
  line: number;
  text: string;
}

/**
 * Yorumları siler.
 *
 * Yorum içindeki bir yasak sözcük ihlal değildir; tam tersine çoğu zaman o
 * yasağın **neden** konduğunu anlatır. Silinmeseydi, kuralı açıklayan yorum
 * kuralın kendisini düşürürdü — nitekim `shell/TopBar.tsx` içinde geçmiş bir
 * ölçümü anlatan yorum tam olarak bunu yapıyordu.
 *
 * Satır numaraları korunur: blok yorumlar boş satıra çevrilir, silinmez.
 */
export function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
  return withoutBlocks
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      // Satır yorumu yalnızca satır başındaysa silinir; `https://` gibi
      // dizgilerin içindeki çift eğik bölü korunur.
      return trimmed.startsWith("//") || trimmed.startsWith("*") ? "" : line;
    })
    .join("\n");
}

/** Test dosyaları taranmaz: içlerindeki yasak desenler birer bekçidir. */
export function isScannable(path: string): boolean {
  return (
    (path.endsWith(".tsx") || path.endsWith(".ts")) &&
    !path.includes(".test.") &&
    !path.includes("/designSystem/")
  );
}

export function isProtected(path: string): boolean {
  return PROTECTED_AREAS.some((area) => path.includes(area));
}

function isExempt(rule: Rule, path: string): boolean {
  return rule.exemptions.some((item) => path.includes(item.path));
}

/** Tek bir dosyayı tek bir kurala göre tarar. */
export function scanFile(rule: Rule, file: SourceFile): Finding[] {
  if (!isScannable(file.path) || isExempt(rule, file.path)) {
    return [];
  }
  const findings: Finding[] = [];
  const lines = stripComments(file.source).split("\n");
  lines.forEach((line, index) => {
    for (const pattern of rule.patterns) {
      if (pattern.test(line)) {
        findings.push({
          ruleId: rule.id,
          path: file.path,
          line: index + 1,
          text: line.trim().slice(0, 120),
        });
        return;
      }
    }
  });
  return findings;
}

/** Korumalı alanlardaki bütün dosyaları bütün kurallara göre tarar. */
export function scanProtected(rules: Rule[], files: SourceFile[]): Finding[] {
  const protectedFiles = files.filter((file) => isProtected(file.path));
  return rules.flatMap((rule) =>
    protectedFiles.flatMap((file) => scanFile(rule, file)),
  );
}

/* -------------------------------------------------------------------------- */
/* Kurallar                                                                    */
/* -------------------------------------------------------------------------- */

export const NO_GRADIENT: Rule = {
  id: "no-gradient",
  title: "Gradient yok",
  why:
    "V4 §3.8.3: gradient ne yüzeyde ne grafikte ne de zemin yıkamasında " +
    "kullanılır. Bir gradient hiçbir ölçümü kodlamaz; yalnızca dikkat çeker.",
  patterns: [/bg-gradient/, /<linearGradient/, /<radialGradient/],
  exemptions: [
    {
      path: "components/onboarding/FactoryIllustration",
      reason:
        "Karşılama çizimi bir veri yüzeyi değil, bir illüstrasyondur; " +
        "hiçbir ölçüm taşımaz, bu yüzden gradient yanıltıcı olamaz.",
    },
  ],
};

export const NO_GLASS: Rule = {
  id: "no-glass",
  title: "Glassmorphism yok",
  why:
    "V4 §3.8.4: buzlu cam yüzey, arkasındaki içeriği okunmaz yapar ve " +
    "kontrastı ölçülemez hale getirir. Ürün sahibi bunu açıkça yasakladı.",
  patterns: [/backdrop-blur/, /backdrop-filter/, /optiflow-glass/],
  exemptions: [
    {
      path: "components/operator",
      reason:
        "Operatör ekranı kendi primitif ailesini kullanıyor ve camı bu daldan " +
        "önce (13228df) almıştı; ayrı bir sprintin borcu.",
    },
  ],
};

export const NO_DECORATIVE_SHADOW: Rule = {
  id: "no-decorative-shadow",
  title: "Dekoratif gölge yok",
  why:
    "V4 §3.8.3: izin verilen tek gölgeler ölçülmüş parıltı (darboğaz) ve " +
    "alarm nabzıdır. Ötekiler derinlik taklidi yapar, bilgi taşımaz.",
  patterns: [/shadow-(md|lg|xl|2xl)(?![a-z-])/, /optiflow-lift(?!-)/],
  exemptions: [],
};

export const NO_OVERSIZED_RADIUS: Rule = {
  id: "no-oversized-radius",
  title: "Aşırı yuvarlak yüzey yok",
  why:
    "V4 §3.8.2: panel 20, kart 16, çekmece 24, düğme 14. Daha büyük yarıçap " +
    "kartı bir baloncuğa benzetir; ürün sahibinin yasak listesinde.",
  /*
   * `rounded-full` bilerek dışarıda: nokta, rozet ve ilerleme çubuğu hap
   * biçimlidir ve orada yuvarlaklık süs değil, geometriyle durum ayırt etme
   * aracıdır. Yasak, **yüzeyin** baloncuğa dönmesine karşıdır.
   */
  patterns: [/rounded-(2xl|3xl)(?![a-z-])/],
  exemptions: [],
};

export const RULES: Rule[] = [
  NO_GRADIENT,
  NO_GLASS,
  NO_DECORATIVE_SHADOW,
  NO_OVERSIZED_RADIUS,
];

/* -------------------------------------------------------------------------- */
/* Token sözleşmesi                                                            */
/* -------------------------------------------------------------------------- */

/** V4 §3.8.2'nin sayıları. Kod bunlardan saparsa anayasa değişmiş demektir. */
export const CANONICAL_RADIUS: Record<string, string> = {
  "--of-cc-radius-button": "14px",
  "--of-cc-radius-card": "16px",
  "--of-cc-radius-panel": "20px",
  "--of-cc-radius-drawer": "24px",
};

/** V4 §3.8.1'in kanonik renkleri. */
export const CANONICAL_COLORS: Record<string, string> = {
  "--of-surface-canvas": "#0a0d12",
  "--of-surface-1": "#12161d",
  "--of-surface-2": "#171c25",
  "--of-surface-3": "#202733",
  "--of-text": "#f2f5f8",
  "--of-text-muted": "#9ca6b3",
  "--of-interactive": "#3d7dff",
  "--of-semantic-ok": "#22c55e",
  "--of-semantic-warn": "#f59e0b",
  "--of-semantic-fault": "#ef4444",
};

/**
 * `--token: değer;` bildirimini CSS metninden okur.
 *
 * Regex kurmak yerine düz dizgi araması yapılır: token adları tire içerdiği
 * için kaçış kuralları gereksiz karmaşa ve lint gürültüsü üretiyordu.
 * Aranan şey zaten sabit bir ad, desen değil.
 */
export function readCssToken(css: string, token: string): string | null {
  const at = css.indexOf(`${token}:`);
  if (at === -1) {
    return null;
  }
  const end = css.indexOf(";", at);
  if (end === -1) {
    return null;
  }
  return css.slice(at + token.length + 1, end).trim();
}
