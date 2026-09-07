import { describe, expect, it } from "vitest";
import { buildWorkbook, workbookFileName } from "./excel";
import { sheetToRows } from "./xlsx";
import { MAX_LOGO_BYTES, isEmbeddableLogo, validateLogo } from "./logo";
import { context, emptyContext, runResponse } from "./fixtures";
import type { SheetSpec } from "./types";

function sheet(sheets: SheetSpec[], name: string): SheetSpec {
  const found = sheets.find((item) => item.name === name);
  if (!found) {
    throw new Error(`Sekme bulunamadı: ${name}`);
  }
  return found;
}

describe("buildWorkbook", () => {
  it("bes sekmeyi istenen sirayla uretir", () => {
    expect(buildWorkbook(context()).map((item) => item.name)).toEqual([
      "Station Data",
      "KPI",
      "Alarm",
      "Scrap",
      "Finance",
    ]);
  });

  it("kosum yokken sekmeler bos ama nedeni yazili gelir", () => {
    const sheets = buildWorkbook(emptyContext());
    for (const item of sheets) {
      expect(item.rows).toEqual([]);
      // Bos bir sekme "veri yok mu, hata mi?" diye sordurur.
      expect(item.emptyNote).toBeDefined();
      expect(item.columns.length).toBeGreaterThan(0);
    }
  });

  it("dosya adi fabrika ve tarihi tasir", () => {
    expect(workbookFileName(context())).toBe(
      "optiflow-veri-yildiz-metal-hatti-2026-09-04",
    );
  });

  describe("Station Data", () => {
    it("her istasyon icin bir satir yazar", () => {
      const rows = sheet(buildWorkbook(context()), "Station Data").rows;
      expect(rows).toHaveLength(2);
      expect(rows[0][0]).toBe("Kesim");
    });

    it("hat adini ve makine sayisini modelden okur", () => {
      const rows = sheet(buildWorkbook(context()), "Station Data").rows;
      expect(rows[0][1]).toBe("Hat A");
      expect(rows[0][2]).toBe(2);
    });

    it("oranlari sayi olarak yazar, metin degil", () => {
      // "%74" metnini geri sayiya cevirmek kullanicinin isi olmamali.
      const rows = sheet(buildWorkbook(context()), "Station Data").rows;
      expect(typeof rows[0][3]).toBe("number");
      expect(rows[0][3]).toBeCloseTo(0.55, 6);
    });

    it("model yoksa hat ve makine sutunlarini bos birakir", () => {
      const rows = sheet(
        buildWorkbook(context({ config: null })),
        "Station Data",
      ).rows;
      expect(rows[0][1]).toBeNull();
      expect(rows[0][2]).toBeNull();
    });
  });

  describe("KPI", () => {
    it("olculemeyeni bos hucre birakir, sifir degil", () => {
      const rows = sheet(buildWorkbook(context({ report: null })), "KPI").rows;
      const monthly = rows.find((row) => row[0] === "Aylık kayıp");
      expect(monthly?.[1]).toBeNull();
      expect(monthly?.[3]).toBe("Maliyet oranları girilmedi");
    });

    it("darbogazi ve dolulugunu yazar", () => {
      const rows = sheet(buildWorkbook(context()), "KPI").rows;
      expect(rows.find((row) => row[0] === "Darboğaz")?.[1]).toBe("Torna");
      expect(rows.find((row) => row[0] === "Darboğaz doluluğu")?.[1]).toBeCloseTo(
        0.92,
        6,
      );
    });
  });

  describe("Alarm", () => {
    it("analiz bulgularini ve kosum uyarilarini birlestirir", () => {
      const noisy = context({
        result: runResponse({ warnings: ["Sistem kararsız: kuyruk büyüyor"] }),
      });
      const rows = sheet(buildWorkbook(noisy), "Alarm").rows;
      expect(rows.some((row) => row[0] === "Analiz")).toBe(true);
      expect(rows.some((row) => row[0] === "Koşum")).toBe(true);
    });

    it("parasal etkisi bilinmeyeni bos birakir", () => {
      const rows = sheet(buildWorkbook(context({ report: null })), "Alarm").rows;
      expect(rows.every((row) => row[5] === null)).toBe(true);
    });
  });

  describe("Scrap", () => {
    it("istasyon satirlarini ve toplam satirini yazar", () => {
      const rows = sheet(buildWorkbook(context()), "Scrap").rows;
      expect(rows).toHaveLength(3);
      expect(rows[2][0]).toBe("TOPLAM");
      // Iki istasyon x 100 giren = 200
      expect(rows[2][1]).toBe(200);
    });

    it("hic parca girmemisse orani bos birakir", () => {
      // Sifir yazmak "fire yok" demek olurdu; oysa olcum yapilmamistir.
      const idle = context({
        result: runResponse({
          results: {
            ...context().result!.results,
            station_metrics: [
              {
                ...context().result!.results.station_metrics[0],
                flow: { entered: 0, completed: 0, scrapped: 0, rejected: 0 },
              },
            ],
          },
        }),
      });
      const rows = sheet(buildWorkbook(idle), "Scrap").rows;
      expect(rows[0][5]).toBeNull();
      expect(rows[0][6]).toBeNull();
    });
  });

  describe("Finance", () => {
    it("finans yoksa nedeni yazip bos gelir", () => {
      const finance = sheet(buildWorkbook(context({ report: null })), "Finance");
      expect(finance.rows).toEqual([]);
      expect(finance.emptyNote).toContain("Maliyet oranları girilmediği için");
    });

    it("ozet, istasyon ve oneri satirlarini yazar", () => {
      const rows = sheet(buildWorkbook(context()), "Finance").rows;
      const sections = new Set(rows.map((row) => row[0]));
      expect(sections).toContain("Özet");
      expect(sections).toContain("İstasyon kaybı");
      expect(sections).toContain("Öneri");
    });

    it("gunluk kayip bilinmiyorsa nedenini yazar", () => {
      const noDaily = context({
        report: { ...context().report!, daily_loss: null },
      });
      const rows = sheet(buildWorkbook(noDaily), "Finance").rows;
      const daily = rows.find((row) => row[1] === "Günlük kayıp");
      expect(daily?.[2]).toBeNull();
      expect(daily?.[5]).toBe("Günlük üretim süresi girilmedi");
    });
  });
});

describe("sheetToRows", () => {
  it("basliklari kalin yazar", () => {
    const rows = sheetToRows({ name: "T", columns: ["A", "B"], rows: [] });
    expect(rows[0][0]).toMatchObject({ value: "A", fontWeight: "bold" });
  });

  it("aciklamayi basliklarin ustune koyar", () => {
    const rows = sheetToRows({
      name: "T",
      columns: ["A"],
      rows: [],
      emptyNote: "Veri yok çünkü koşum yok.",
    });
    expect(rows[0][0]).toMatchObject({ value: "Veri yok çünkü koşum yok." });
    expect(rows[2][0]).toMatchObject({ value: "A" });
  });

  it("null degeri bos hucre yapar", () => {
    // Sifir yazmak toplamlari bozar, tire yazmak sutunu metne cevirir.
    const rows = sheetToRows({ name: "T", columns: ["A"], rows: [[null]] });
    expect(rows[1][0]).toBeNull();
  });

  it("sayilari sayi tipinde ve saga yasli yazar", () => {
    const rows = sheetToRows({ name: "T", columns: ["A"], rows: [[42]] });
    expect(rows[1][0]).toMatchObject({ value: 42, align: "right" });
  });

  it("sonsuz ve NaN degerleri bos hucre yapar", () => {
    const rows = sheetToRows({
      name: "T",
      columns: ["A", "B"],
      rows: [[Number.NaN, Number.POSITIVE_INFINITY]],
    });
    expect(rows[1][0]).toBeNull();
    expect(rows[1][1]).toBeNull();
  });
});

describe("logo", () => {
  it("PNG ve JPEG kabul eder", () => {
    expect(validateLogo({ type: "image/png", size: 1024 })).toBeNull();
    expect(validateLogo({ type: "image/jpeg", size: 1024 })).toBeNull();
  });

  it("SVG'yi reddeder ve nedenini soyler", () => {
    // pdfmake SVG gomemiyor; "yuklendi" deyip PDF'te sessizce dusmek yerine
    // secim aninda reddetmek dogrusu.
    const error = validateLogo({ type: "image/svg+xml", size: 1024 });
    expect(error).toContain("PNG veya JPEG");
  });

  it("buyuk dosyayi reddeder", () => {
    const error = validateLogo({ type: "image/png", size: MAX_LOGO_BYTES + 1 });
    expect(error).toContain("KB");
  });

  it("bos dosyayi reddeder", () => {
    expect(validateLogo({ type: "image/png", size: 0 })).toContain("boş");
  });

  it("yalnizca gomulebilir veri URL'lerine guvenir", () => {
    expect(isEmbeddableLogo("data:image/png;base64,AAAA")).toBe(true);
    expect(isEmbeddableLogo("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(isEmbeddableLogo("https://example.com/logo.png")).toBe(false);
    expect(isEmbeddableLogo(null)).toBe(false);
  });
});
