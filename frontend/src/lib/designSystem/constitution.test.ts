/**
 * Tasarım Anayasası V4'ün bekçi testleri (Sprint 2M).
 *
 * Bu dosya ürün kodunu değil **kaynak ağacını** sınar. Amacı bir sonraki
 * sprintte kimsenin sessizce gradient, cam ya da dekoratif gölge eklememesidir.
 * Tarayıcı gerektirmez: node ortamında saniyeler içinde koşar, bu yüzden her
 * koşumda çalışır ve unutulamaz.
 *
 * Bir kural kasıtlı olarak gevşetilecekse, testi susturmak değil `exemptions`
 * listesine **gerekçesiyle** yazmak gerekir. Gerekçesiz muafiyet yoktur.
 */

/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_COLORS,
  CANONICAL_RADIUS,
  NO_DECORATIVE_SHADOW,
  NO_GLASS,
  NO_GRADIENT,
  NO_OVERSIZED_RADIUS,
  PROTECTED_AREAS,
  RULES,
  isProtected,
  isScannable,
  readCssToken,
  scanFile,
  scanProtected,
  stripComments,
  type SourceFile,
} from "./constitution";

/*
 * Kaynaklar `node:fs` ile değil Vite'ın `import.meta.glob`'uyla okunur.
 * `fs` kullanılsaydı uygulama tsconfig'ine `@types/node` eklemek gerekirdi ve
 * o an ürün kodu da dosya sistemine erişebilir hale gelirdi — tarayıcıda
 * çalışan bir katman için yanlış bir kapı. Glob derleme anında çözülür ve
 * yalnızca metni getirir.
 */
const RAW = import.meta.glob("../../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/*
 * CSS glob ile okunamıyor: vitest `environment: "node"` altında stil
 * dosyalarını tümüyle stub'lıyor, `?raw` da `?inline` da boş dizgi döndürüyor
 * (ölçüldü). Bu yüzden yalnızca bu dosya `node:fs` kullanır ve tipleri üçlü
 * eğik bölü referansıyla alır — uygulama tsconfig'ine `@types/node` eklemek,
 * ürün kodunun da dosya sistemine erişmesi demek olurdu.
 */
const CSS_PATH = fileURLToPath(new URL("../../index.css", import.meta.url));

/** `../../components/live/X.tsx` → `components/live/X.tsx` */
function normalize(key: string): string {
  return key.replace(/^\.\.\/\.\.\//, "");
}

const FILES: SourceFile[] = Object.entries(RAW)
  .map(([key, source]) => ({ path: normalize(key), source }))
  .filter((file) => isScannable(file.path));

const CSS = readFileSync(CSS_PATH, "utf8");

function ihlaller(ruleId: string) {
  return scanProtected(RULES, FILES).filter((f) => f.ruleId === ruleId);
}

function rapor(bulgular: { path: string; line: number; text: string }[]): string {
  return bulgular.map((f) => `${f.path}:${f.line} -> ${f.text}`).join("\n");
}

describe("tarama altyapısı", () => {
  it("korumalı alanlarda dosya bulur", () => {
    // Tarama bos donerse butun kurallar sahte bir sekilde gecerdi.
    expect(FILES.filter((f) => isProtected(f.path)).length).toBeGreaterThan(40);
  });

  it("yedi korumalı alanın her birinde dosya var", () => {
    for (const area of PROTECTED_AREAS) {
      expect(FILES.some((f) => f.path.includes(area))).toBe(true);
    }
  });

  it("test dosyalarını taramaz", () => {
    // Testlerin icindeki yasak desenler birer bekcidir, ihlal degil.
    expect(isScannable("components/live/a.test.tsx")).toBe(false);
    expect(isScannable("components/live/a.tsx")).toBe(true);
  });

  it("blok yorumdaki yasak sözcük ihlal sayılmaz", () => {
    const kaynak = "const a = 1;\n/* backdrop-blur neden yasak */\nconst b = 2;";
    expect(stripComments(kaynak)).not.toContain("backdrop-blur");
  });

  it("yorum silinirken satır numarası kaymaz", () => {
    const kaynak = "bir\n/* iki\nüç */\ndört";
    expect(stripComments(kaynak).split("\n")).toHaveLength(4);
  });

  it("dizgi içindeki çift eğik bölü korunur", () => {
    const kaynak = 'const u = "https://ornek";';
    expect(stripComments(kaynak)).toContain("https://ornek");
  });
});

describe("V4 §3.8.3 — gradient yok", () => {
  it("korumalı alanlarda hiç gradient yok", () => {
    expect(rapor(ihlaller("no-gradient"))).toBe("");
  });

  it("kural gerçekten yakalıyor", () => {
    // Kuralin kendisi bozulursa test yesil kalirdi; bu onu engeller.
    const sahte: SourceFile = {
      path: "components/live/X.tsx",
      source: '<div className="bg-gradient-to-br from-blue-500" />',
    };
    expect(scanFile(NO_GRADIENT, sahte)).toHaveLength(1);
  });

  it("karşılama çizimi muaftır ve gerekçesi yazılıdır", () => {
    const muaf = NO_GRADIENT.exemptions[0];
    expect(muaf.path).toContain("FactoryIllustration");
    expect(muaf.reason.length).toBeGreaterThan(30);
  });
});

describe("V4 §3.8.4 — glassmorphism yok", () => {
  it("korumalı alanlarda cam yüzey yok", () => {
    expect(rapor(ihlaller("no-glass"))).toBe("");
  });

  it("backdrop-blur yakalanır", () => {
    const sahte: SourceFile = {
      path: "components/results/X.tsx",
      source: '<div className="backdrop-blur-sm" />',
    };
    expect(scanFile(NO_GLASS, sahte)).toHaveLength(1);
  });

  it("optiflow-glass sınıfı da yakalanır", () => {
    // Cam yalnizca Tailwind sinifiyla degil, paylasilan sinifla da gelebilir.
    const sahte: SourceFile = {
      path: "components/finance/X.tsx",
      source: '<Card className="optiflow-glass p-4" />',
    };
    expect(scanFile(NO_GLASS, sahte)).toHaveLength(1);
  });

  it("operatör muaftır ve gerekçesi yazılıdır", () => {
    const muaf = NO_GLASS.exemptions[0];
    expect(muaf.path).toBe("components/operator");
    expect(muaf.reason).toContain("13228df");
  });
});

describe("V4 §3.8.3 — dekoratif gölge yok", () => {
  it("korumalı alanlarda dekoratif gölge yok", () => {
    expect(rapor(ihlaller("no-decorative-shadow"))).toBe("");
  });

  it("shadow-lg yakalanır", () => {
    const sahte: SourceFile = {
      path: "components/live/X.tsx",
      source: '<div className="shadow-lg" />',
    };
    expect(scanFile(NO_DECORATIVE_SHADOW, sahte)).toHaveLength(1);
  });

  it("optiflow-lift yakalanır ama optiflow-cc-lift yakalanmaz", () => {
    /*
     * `optiflow-lift:hover` `--shadow-lg` uyguluyor; `optiflow-cc-lift`
     * yalnizca transform ve kenarlik degistiriyor. Ikisi karistirilirsa golge
     * yalnizca hover'da geri gelir ve statik olcumde hic gorunmez.
     */
    const golgeli: SourceFile = {
      path: "components/finance/X.tsx",
      source: '<div className="optiflow-lift" />',
    };
    const golgesiz: SourceFile = {
      path: "components/finance/Y.tsx",
      source: '<div className="optiflow-cc-lift" />',
    };
    expect(scanFile(NO_DECORATIVE_SHADOW, golgeli)).toHaveLength(1);
    expect(scanFile(NO_DECORATIVE_SHADOW, golgesiz)).toHaveLength(0);
  });

  it("ölçülmüş nabız CSS'te durur, sınıf taramasına girmez", () => {
    // Darbogaz nabzi ve alarm nabzi keyframe'lerde; Tailwind sinifi degiller.
    expect(CSS).toContain("optiflow-bottleneck-pulse");
  });
});

describe("V4 §3.8.2 — yüzey baloncuğa dönmez", () => {
  it("korumalı alanlarda rounded-2xl/3xl yok", () => {
    expect(rapor(ihlaller("no-oversized-radius"))).toBe("");
  });

  it("rounded-2xl yakalanır", () => {
    const sahte: SourceFile = {
      path: "components/reports/X.tsx",
      source: '<div className="rounded-2xl" />',
    };
    expect(scanFile(NO_OVERSIZED_RADIUS, sahte)).toHaveLength(1);
  });

  it("rounded-full yakalanmaz", () => {
    // Nokta ve rozet hap biciminde; orada yuvarlaklik bir olcum tasiyicisi.
    const sahte: SourceFile = {
      path: "components/live/X.tsx",
      source: '<span className="h-2 w-2 rounded-full" />',
    };
    expect(scanFile(NO_OVERSIZED_RADIUS, sahte)).toHaveLength(0);
  });
});

describe("V4 §3.8.2 — kanonik yarıçap", () => {
  it.each(Object.entries(CANONICAL_RADIUS))("%s = %s", (token, deger) => {
    expect(readCssToken(CSS, token)).toBe(deger);
  });
});

describe("V4 §3.8.1 — kanonik renkler", () => {
  it.each(Object.entries(CANONICAL_COLORS))("%s = %s", (token, deger) => {
    expect(readCssToken(CSS, token)).toBe(deger);
  });

  it("anlamsal renkler 600 tonuna kaymadı", () => {
    // Urun sahibi 500 tonlarinin korunmasini acikca istedi.
    expect(readCssToken(CSS, "--of-semantic-ok")).toBe("#22c55e");
    expect(readCssToken(CSS, "--of-semantic-fault")).toBe("#ef4444");
  });
});

describe("her kuralın gerekçesi yazılıdır", () => {
  it("her kural neden var olduğunu söyler", () => {
    for (const rule of RULES) {
      expect(rule.why.length).toBeGreaterThan(40);
      expect(rule.title.length).toBeGreaterThan(3);
    }
  });

  it("her muafiyet gerekçelidir", () => {
    // Gerekcesiz muafiyet, kurali sessizce kaldirmanin kolay yolu olurdu.
    for (const rule of RULES) {
      for (const muaf of rule.exemptions) {
        expect(muaf.reason.length).toBeGreaterThan(30);
      }
    }
  });
});
