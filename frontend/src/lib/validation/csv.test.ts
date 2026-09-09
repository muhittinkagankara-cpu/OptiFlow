import { describe, expect, it } from "vitest";
import { csvTemplate, detectFields, normalizeName, parseRealDataCsv } from "./csv";
import { SAMPLE_CSV, sampleConfig } from "./fixtures";

const STATIONS = sampleConfig().stations.map((station) => ({
  id: station.id,
  name: station.name,
}));

describe("normalizeName", () => {
  it("turkce harfleri ve ayraclari sadelestirir", () => {
    expect(normalizeName("Torna-1")).toBe("torna1");
    expect(normalizeName("TORNA 1")).toBe("torna1");
    expect(normalizeName("Döküm Ünitesi")).toBe("dokumunitesi");
  });
});

describe("detectFields", () => {
  it("uzun baslikta gecen anahtar kelimeyi bulur", () => {
    const fields = detectFields([
      "İstasyon",
      "Gerçek Çevrim Süresi (dk)",
      "Üretilen adet",
    ]);
    expect(fields.stationName).toBe(0);
    expect(fields.cycleTimeMinutes).toBe(1);
    expect(fields.producedUnits).toBe(2);
  });

  it("fire adedini uretim adediyle karistirmaz", () => {
    // "Fire adedi" hem fire hem adet tasir; oncelik sirasi fireyi kazandirir.
    const fields = detectFields(["İstasyon", "Fire adedi", "Üretim adedi"]);
    expect(fields.scrapUnits).toBe(1);
    expect(fields.producedUnits).toBe(2);
  });

  it("taninmayan kolonu hicbir alana baglamaz", () => {
    const fields = detectFields(["İstasyon", "Sorumlu mühendis"]);
    expect(Object.values(fields)).toEqual([0]);
  });
});

describe("parseRealDataCsv", () => {
  it("ornek dosyayi olculere cevirir", () => {
    const parsed = parseRealDataCsv(SAMPLE_CSV, STATIONS);
    expect(parsed.measurements).toHaveLength(3);

    const torna = parsed.measurements.find((item) => item.stationId === "torna");
    // Turkce ondalik: "2,9" -> 2.9
    expect(torna?.cycleTimeMinutes).toBe(2.9);
    expect(torna?.producedUnits).toBe(142);
    expect(torna?.waitMinutes).toBe(3.4);
    expect(torna?.scrapUnits).toBe(4);
    expect(torna?.operatorCount).toBe(1);
  });

  it("modelde olmayan istasyonu sessizce atmaz", () => {
    // Kullanici dosyasindaki bir satirin yok sayildigini fark edemez.
    const csv = ["İstasyon;Çevrim", "Torna;2,9", "Boyahane;4,0"].join("\n");
    const parsed = parseRealDataCsv(csv, STATIONS);
    expect(parsed.unmatched).toEqual(["Boyahane"]);
    const boyahane = parsed.measurements.find(
      (item) => item.stationName === "Boyahane",
    );
    expect(boyahane?.stationId).toBeNull();
  });

  it("istasyon adi kolonu yoksa hicbir satir okunmaz", () => {
    // Hangi satirin hangi istasyona ait oldugu bilinmeden girilen sayilar
    // rastgele eslestirilmis bir dogruluk uretirdi.
    const csv = ["Çevrim;Üretim", "2,9;142"].join("\n");
    expect(parseRealDataCsv(csv, STATIONS).measurements).toEqual([]);
  });

  it("bos hucreler olculmemis kalir, sifir olmaz", () => {
    const csv = ["İstasyon;Çevrim;Üretim", "Torna;;142"].join("\n");
    const [row] = parseRealDataCsv(csv, STATIONS).measurements;
    expect(row.cycleTimeMinutes).toBeNull();
    expect(row.producedUnits).toBe(142);
  });

  it("virgul ayracli dosyayi da okur", () => {
    const csv = ["İstasyon,Çevrim", "Kaynak,3.1"].join("\n");
    const [row] = parseRealDataCsv(csv, STATIONS).measurements;
    expect(row.stationId).toBe("kaynak");
    expect(row.cycleTimeMinutes).toBe(3.1);
  });

  it("bos dosyada cokmeden bos doner", () => {
    expect(parseRealDataCsv("", STATIONS).measurements).toEqual([]);
  });

  it("okunan alanlari bildirir", () => {
    const parsed = parseRealDataCsv(SAMPLE_CSV, STATIONS);
    expect(parsed.fields).toContain("cycleTimeMinutes");
    expect(parsed.fields).toContain("scrapUnits");
  });
});

describe("csvTemplate", () => {
  it("model istasyonlarini onceden yazar", () => {
    const template = csvTemplate(STATIONS);
    const lines = template.split("\n");
    expect(lines[0]).toContain("İstasyon");
    expect(lines).toHaveLength(STATIONS.length + 1);
    expect(lines[1].startsWith("Kesim;")).toBe(true);
  });

  it("uretilen sablon geri okunabilir", () => {
    const parsed = parseRealDataCsv(csvTemplate(STATIONS), STATIONS);
    expect(parsed.measurements).toHaveLength(STATIONS.length);
    expect(parsed.measurements.every((item) => item.cycleTimeMinutes === null)).toBe(
      true,
    );
  });
});
