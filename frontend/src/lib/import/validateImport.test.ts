import { describe, expect, it } from "vitest";
import { missingModelFields, validateImport } from "./validateImport";
import type { CellValue, ColumnMapping, DetectedColumn } from "./types";

function column(
  index: number,
  header: string,
  kind: DetectedColumn["kind"] = "number",
): DetectedColumn {
  return { index, header, kind, samples: [], filledCount: 3 };
}

const columns: DetectedColumn[] = [
  column(0, "İstasyon", "text"),
  column(1, "Çevrim Süresi"),
  column(2, "Makine"),
];

const rows: CellValue[][] = [
  ["Kesim", 3, 2],
  ["Dikiş", 4, 1],
  ["Kalite", 2, 1],
];

const goodMapping: ColumnMapping = { station: 0, cycleTime: 1, machines: 2 };

function messages(result: ReturnType<typeof validateImport>) {
  return result.issues.map((issue) => issue.message).join(" | ");
}

describe("validateImport — saglikli durum", () => {
  it("gecerli esleştirmede engel yoktur", () => {
    const result = validateImport(goodMapping, columns, rows);
    expect(result.hasBlockingError).toBe(false);
    expect(result.usableRowCount).toBe(3);
  });
});

describe("validateImport — eksik kolon", () => {
  it("zorunlu alan esleştirilmemisse hata verir", () => {
    const result = validateImport({ station: 0 }, columns, rows);
    expect(result.hasBlockingError).toBe(true);
    expect(messages(result)).toContain("Çevrim Süresi");
  });

  it("iki zorunlu alan da eksikse ikisini de bildirir", () => {
    const result = validateImport({}, columns, rows);
    expect(messages(result)).toContain("İstasyon");
    expect(messages(result)).toContain("Çevrim Süresi");
  });

  it("istege bagli alanin eksikligi engel degildir", () => {
    const result = validateImport({ station: 0, cycleTime: 1 }, columns, rows);
    expect(result.hasBlockingError).toBe(false);
  });
});

describe("validateImport — cakisan esleştirme", () => {
  it("ayni kolon iki alana verilmisse hata verir", () => {
    // Sessizce kabul edilseydi iki alan ayni sayiyi okur ve kullanici bunu
    // ancak modeldeki tuhaf degerlerden anlardi.
    const result = validateImport(
      { station: 0, cycleTime: 1, machines: 1 },
      columns,
      rows,
    );
    expect(result.hasBlockingError).toBe(true);
    expect(messages(result)).toContain("birden çok alana atandı");
  });

  it("hangi alanlarin cakistigini yazar", () => {
    const result = validateImport(
      { station: 0, cycleTime: 1, machines: 1 },
      columns,
      rows,
    );
    expect(messages(result)).toContain("Çevrim Süresi");
    expect(messages(result)).toContain("Makine");
  });
});

describe("validateImport — bos ve bozuk veri", () => {
  it("kolon yoksa bos sayfa hatasi verir", () => {
    const result = validateImport(goodMapping, [], rows);
    expect(result.hasBlockingError).toBe(true);
    expect(messages(result)).toContain("Sayfa boş olabilir");
  });

  it("veri satiri yoksa hata verir", () => {
    const result = validateImport(goodMapping, columns, []);
    expect(result.hasBlockingError).toBe(true);
    expect(messages(result)).toContain("veri satırı yok");
  });

  it("bulunmayan kolona atama hatadir", () => {
    const result = validateImport({ station: 0, cycleTime: 99 }, columns, rows);
    expect(result.hasBlockingError).toBe(true);
    expect(messages(result)).toContain("bulunmayan bir kolona");
  });

  it("hicbir satir kullanilamiyorsa hata verir", () => {
    const bad: CellValue[][] = [
      ["", null, null],
      ["", "abc", null],
    ];
    const result = validateImport(goodMapping, columns, bad);
    expect(result.hasBlockingError).toBe(true);
    expect(result.usableRowCount).toBe(0);
  });
});

describe("validateImport — uyarilar", () => {
  it("eksik istasyon adini uyari olarak bildirir", () => {
    const withGap: CellValue[][] = [...rows, [null, 5, 1]];
    const result = validateImport(goodMapping, columns, withGap);
    // Uyari ilerlemeyi durdurmaz: kalan satirlar modele girer.
    expect(result.hasBlockingError).toBe(false);
    expect(result.usableRowCount).toBe(3);
    expect(messages(result)).toContain("istasyon adı boş");
  });

  it("okunamayan cevrim suresini uyari olarak bildirir", () => {
    const withGap: CellValue[][] = [...rows, ["Paketleme", "yok", 1]];
    const result = validateImport(goodMapping, columns, withGap);
    expect(result.hasBlockingError).toBe(false);
    expect(messages(result)).toContain("çevrim süresi okunamadı");
  });

  it("sifir cevrim suresini gecersiz sayar", () => {
    const withZero: CellValue[][] = [["Kesim", 0, 1]];
    const result = validateImport(goodMapping, columns, withZero);
    expect(result.usableRowCount).toBe(0);
  });

  it("yinelenen istasyon adini uyarir", () => {
    const duplicated: CellValue[][] = [...rows, ["Kesim", 6, 1]];
    const result = validateImport(goodMapping, columns, duplicated);
    expect(messages(result)).toContain("birden çok satırda");
    expect(result.hasBlockingError).toBe(false);
  });

  it("envanter alani esleştirildiginde modele girmeyecegini soyler", () => {
    const withInventory: ColumnMapping = { ...goodMapping, leadTime: 2 };
    const conflictFree = validateImport(
      { station: 0, cycleTime: 1, leadTime: 2 },
      columns,
      rows,
    );
    expect(messages(conflictFree)).toContain("fabrika modeline girmez");
    expect(withInventory.leadTime).toBe(2);
  });
});

describe("missingModelFields", () => {
  it("yalnizca esleştirilmemis model alanlarini listeler", () => {
    const missing = missingModelFields({ station: 0, cycleTime: 1 });
    const ids = missing.map((field) => field.id);
    expect(ids).toContain("machines");
    expect(ids).toContain("scrap");
    expect(ids).not.toContain("station");
    // Envanter alanlari bu listede yer almaz: modele girmedikleri icin
    // "eksik" sayilmazlar.
    expect(ids).not.toContain("leadTime");
  });
});
