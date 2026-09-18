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
  /*
   * `shadow-\[...\]` deseni sonradan eklendi: ilk sürüm yalnızca adlandırılmış
   * ölçekleri (`md`, `lg`, …) arıyordu ve ısı haritası ipucu balonundaki
   * `shadow-[var(--of-cc-shadow)]` gölgesini kaçırdı. Onu hover testi yakaladı;
   * kaynak taraması da yakalayabilmeli, çünkü orada yakalamak saniyeler sürer.
   */
  patterns: [
    /shadow-(md|lg|xl|2xl)(?![a-z-])/,
    /shadow-\[/,
    /optiflow-lift(?!-)/,
  ],
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

/* -------------------------------------------------------------------------- */
/* Kabul belgesi                                                               */
/* -------------------------------------------------------------------------- */

/** Bir kuralın nerede ve nasıl korunduğu. */
export interface AcceptanceRow {
  rule: string;
  /** Kuralı zorlayan katman. */
  guardedBy: string;
  /**
   * `otomatik`  — bir test düşerse kural ihlal edilmiş demektir.
   * `ölçümle`   — tarayıcıda ölçülüyor, ihlal testi düşürüyor.
   * `elle`      — henüz otomatik değil; sprint sonunda insan bakıyor.
   */
  status: "otomatik" | "ölçümle" | "elle";
}

/**
 * V4 kabul tablosunun tek kaynağı.
 *
 * Belge elle yazılsaydı, kurallar değiştikçe sessizce yalan söylemeye
 * başlardı. Buradan üretilir ve bir test belgenin güncel olduğunu doğrular.
 */
export const ACCEPTANCE: AcceptanceRow[] = [
  {
    rule: "Gradient yok",
    guardedBy: "constitution.test.ts (kaynak) + tests/constitution.spec.ts (tarayıcı)",
    status: "otomatik",
  },
  {
    rule: "Glassmorphism yok",
    guardedBy: "constitution.test.ts (kaynak) + tests/constitution.spec.ts (tarayıcı)",
    status: "otomatik",
  },
  {
    rule: "Dekoratif gölge yok",
    guardedBy: "constitution.test.ts (kaynak) + tests/constitution.spec.ts (tarayıcı)",
    status: "otomatik",
  },
  {
    rule: "44px dokunma hedefi",
    guardedBy: "tests/touch-targets.spec.ts (gerçek vuruş testi)",
    status: "ölçümle",
  },
  {
    rule: "Kanonik renkler",
    guardedBy: "constitution.test.ts — index.css tokenları okunur",
    status: "otomatik",
  },
  {
    rule: "Kanonik yarıçap (14/16/20/24)",
    guardedBy: "constitution.test.ts — index.css tokenları okunur",
    status: "otomatik",
  },
  {
    rule: "Yatay taşma yok",
    guardedBy: "tests/constitution.spec.ts — altı genişlikte ölçülür",
    status: "ölçümle",
  },
  {
    rule: "Kısıt şeridi kısıtı belirleyen ölçümü kodlar",
    guardedBy: "src/lib/live/rail.test.ts",
    status: "otomatik",
  },
  {
    rule: "Ekran statement ile açılır",
    guardedBy: "src/lib/live/statement.test.ts + ekran testleri",
    status: "otomatik",
  },
  {
    rule: "Ölçülmeyen değer sıfıra düşmez",
    guardedBy: "npm run acceptance — izleme katmanı taraması",
    status: "otomatik",
  },
  {
    rule: "Köken (provenance) görünür",
    guardedBy: "src/lib/connectors/bridge/devices.test.ts — besleme durumu",
    status: "otomatik",
  },
  {
    rule: "Tipografi ölçeği (H1 32 / H2 24 / KPI 30)",
    guardedBy: "Henüz otomatik değil; sprint sonunda tarayıcıda ölçülüyor",
    status: "elle",
  },
  {
    rule: "Erişilebilirlik — critical sıfır",
    guardedBy: "tests/a11y.spec.ts (axe-core) — tartışmaya kapalı kademe",
    status: "ölçümle",
  },
  {
    rule: "Erişilebilirlik — yeni tür serious ihlal eklenemez",
    guardedBy:
      "tests/a11y.spec.ts — üç kalem gerekçeli borç listesinde; listenin " +
      "uzaması testi düşürür",
    status: "ölçümle",
  },
  {
    rule: "Görsel taban çizgisi",
    guardedBy: "tests/visual.spec.ts — 6 ekran × 6 genişlik",
    status: "ölçümle",
  },
];

/** Kabul belgesinin metnini üretir. */
export function renderAcceptance(rows: AcceptanceRow[] = ACCEPTANCE): string {
  const satirlar = rows
    .map((r) => `| ${r.rule} | ${r.guardedBy} | ${r.status} |`)
    .join("\n");

  return `# V4 Kabul Tablosu

> ⚠️ **Bu dosya elle düzenlenmez.** Kaynağı
> \`frontend/src/lib/designSystem/constitution.ts\` içindeki \`ACCEPTANCE\`
> listesidir ve \`constitution.test.ts\` belgenin güncel olduğunu doğrular.
> Elle yazılsaydı, kurallar değiştikçe sessizce yalan söylemeye başlardı.

Tasarım Anayasası V4 (MASTER §3.8) kurallarının hangi katmanda korunduğu.

| Kural | Nerede korunuyor | Durum |
| --- | --- | --- |
${satirlar}

## Durum ne demek

- **otomatik** — bir test düşerse kural ihlal edilmiş demektir; tarayıcı gerekmez.
- **ölçümle** — gerçek tarayıcıda ölçülür; ihlal testi düşürür.
- **elle** — henüz otomatik değil, sprint sonunda insan bakıyor. Bu satırların
  azalması bir sonraki sprintlerin işidir.

## Korumalı alanlar

Kaynak taraması yalnızca V4'ün zorunlu olduğu alanlarda çalışır:

${PROTECTED_AREAS.map((a) => `- \`${a}\``).join("\n")}

## Muafiyetler

Muafiyet gerekçesiz olamaz; testler gerekçesiz muafiyeti de reddeder.

${RULES.flatMap((rule) =>
  rule.exemptions.map(
    (item) => `- **${rule.title}** → \`${item.path}\`\n  ${item.reason}`,
  ),
).join("\n")}
`;
}
