import { describe, expect, it } from "vitest";
import {
  cellToText,
  dataRows,
  detectColumns,
  findHeaderRow,
  parseNumeric,
} from "./detectColumns";
import type { CellValue } from "./types";

describe("parseNumeric", () => {
  it("sayilari oldugu gibi alir", () => {
    expect(parseNumeric(42)).toBe(42);
    expect(parseNumeric(3.5)).toBe(3.5);
  });

  it("Turkce ondalik virgulu okur", () => {
    // Turkce Excel "3,5" yazar; dogrudan Number() ile NaN olurdu.
    expect(parseNumeric("3,5")).toBe(3.5);
    expect(parseNumeric("0,25")).toBe(0.25);
  });

  it("binlik ayracini atar", () => {
    expect(parseNumeric("1.200")).toBe(1200);
    expect(parseNumeric("1,200")).toBe(1200);
  });

  it("karisik ayracta sondakini ondalik sayar", () => {
    expect(parseNumeric("1.234,56")).toBeCloseTo(1234.56, 6);
    expect(parseNumeric("1,234.56")).toBeCloseTo(1234.56, 6);
  });

  it("yuzde isaretini orana cevirir", () => {
    expect(parseNumeric("%5")).toBeCloseTo(0.05, 10);
  });

  it("birim eklerini temizler", () => {
    expect(parseNumeric("12 dk")).toBe(12);
    expect(parseNumeric("3 adet")).toBe(3);
  });

  it("sayi olmayanda null doner", () => {
    expect(parseNumeric("Kesim")).toBeNull();
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric(null)).toBeNull();
    expect(parseNumeric(true)).toBeNull();
    expect(parseNumeric(Number.NaN)).toBeNull();
  });
});

describe("cellToText", () => {
  it("bos degerleri bos metne cevirir", () => {
    expect(cellToText(null)).toBe("");
  });

  it("boolean'i okunabilir yazar", () => {
    expect(cellToText(true)).toBe("evet");
  });

  it("tarihi kisa bicimde yazar", () => {
    // String(new Date()) uzun ve okunamaz bir ifade uretir.
    const text = cellToText(new Date("2026-09-04T00:00:00Z"));
    expect(text).not.toContain("GMT");
  });
});

describe("findHeaderRow", () => {
  it("en cok dolu satiri baslik sayar", () => {
    // Dosyalarin basinda siklikla bos satirlar ya da bir rapor basligi bulunur.
    const rows: CellValue[][] = [
      ["Üretim Raporu", null, null],
      [null, null, null],
      ["İstasyon", "Cycle Time", "Makine"],
      ["Kesim", 3, 2],
    ];
    expect(findHeaderRow(rows)).toBe(2);
  });

  it("tumuyle bos sayfada -1 doner", () => {
    expect(findHeaderRow([[null, null], [null]])).toBe(-1);
  });
});

describe("detectColumns", () => {
  const rows: CellValue[][] = [
    ["İstasyon", "Cycle Time", "Makine", "Bos"],
    ["Kesim", "3,5", 2, null],
    ["Dikiş", "4", 1, null],
    ["Kalite", "2,5", 1, null],
  ];

  it("basliklari ve turleri cikarir", () => {
    const columns = detectColumns(rows);
    expect(columns.map((c) => c.header)).toEqual([
      "İstasyon",
      "Cycle Time",
      "Makine",
      "Bos",
    ]);
    expect(columns[0].kind).toBe("text");
    expect(columns[1].kind).toBe("number");
    expect(columns[2].kind).toBe("number");
    expect(columns[3].kind).toBe("empty");
  });

  it("ornek degerleri tasir", () => {
    const columns = detectColumns(rows);
    expect(columns[0].samples).toEqual(["Kesim", "Dikiş", "Kalite"]);
    expect(columns[0].filledCount).toBe(3);
  });

  it("cogunluk sayiysa kolonu sayisal sayar", () => {
    // Tek bir "yok" hucresi yuzunden butun kolonu metin saymak, sayisal
    // alanlarin hic eslesmemesine yol acardi.
    const mixed: CellValue[][] = [
      ["Süre"],
      [3],
      [4],
      ["yok"],
      [5],
    ];
    expect(detectColumns(mixed)[0].kind).toBe("number");
  });

  it("basligi bos ama verisi olan kolonu atmaz", () => {
    const noHeader: CellValue[][] = [
      ["İstasyon", null],
      ["Kesim", 3],
      ["Dikiş", 4],
    ];
    const columns = detectColumns(noHeader);
    expect(columns).toHaveLength(2);
    expect(columns[1].header).toBe("Kolon 2");
  });

  it("bos sayfada bos dizi doner", () => {
    expect(detectColumns([])).toEqual([]);
    expect(detectColumns([[null, null]])).toEqual([]);
  });
});

describe("dataRows", () => {
  it("baslik satirindan sonrasini verir ve bos satirlari atar", () => {
    const rows: CellValue[][] = [
      ["İstasyon", "CT"],
      ["Kesim", 3],
      [null, null],
      ["Dikiş", 4],
    ];
    const body = dataRows(rows);
    expect(body).toHaveLength(2);
    expect(body[0][0]).toBe("Kesim");
  });

  it("bos sayfada bos dizi doner", () => {
    expect(dataRows([])).toEqual([]);
  });
});
