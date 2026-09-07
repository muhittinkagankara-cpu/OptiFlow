import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMPORT_DEFAULTS,
  buildFactoryFromRows,
  distributionFor,
  factoryNameFromFile,
  normalizeScrapRate,
  suggestInterarrival,
} from "./buildFactoryFromRows";
import { INFINITE_CAPACITY } from "../../types/simulationTypes";
import type { CellValue, ColumnMapping } from "./types";

const mapping: ColumnMapping = {
  station: 0,
  cycleTime: 1,
  machines: 2,
  scrap: 3,
  buffer: 4,
};

const rows: CellValue[][] = [
  ["Kesim", 3, 2, 0.02, 10],
  ["Dikiş", "4,5", 1, "%3", null],
  ["Kalite Kontrol", 2, 1, 0, 5],
];

describe("normalizeScrapRate", () => {
  it("orani oldugu gibi birakir", () => {
    expect(normalizeScrapRate(0.03)).toBeCloseTo(0.03, 10);
  });

  it("1'den buyugu yuzde sayar", () => {
    // %300 hurda ureten bir dosyadansa, 3 yazip %3 demek isteyen bir
    // kullanici cok daha olasidir.
    expect(normalizeScrapRate(3)).toBeCloseTo(0.03, 10);
  });

  it("ust siniri kirpar", () => {
    expect(normalizeScrapRate(250)).toBe(1);
  });

  it("gecersiz degerde null doner", () => {
    expect(normalizeScrapRate(null)).toBeNull();
    expect(normalizeScrapRate(-1)).toBeNull();
    expect(normalizeScrapRate(Number.NaN)).toBeNull();
  });
});

describe("distributionFor", () => {
  it("sabit dagilimda degeri tasir", () => {
    expect(distributionFor("constant", 5)).toEqual({
      type: "constant",
      params: { value: 5 },
    });
  });

  it("normal dagilimda standart sapmayi ortalamanin onda biri alir", () => {
    // Excel yalnizca bir ortalama tasir; degiskenlik dosyada yoktur ve
    // uydurulamaz — bu varsayim arayuzde de yaziyla belirtilir.
    expect(distributionFor("normal", 10)).toEqual({
      type: "normal",
      params: { mean: 10, std: 1 },
    });
  });

  it("ucgen dagilimda simetrik bir aralik kurar", () => {
    const dist = distributionFor("triangular", 4);
    expect(dist.params.min).toBeCloseTo(3, 10);
    expect(dist.params.mode).toBe(4);
    expect(dist.params.max).toBeCloseTo(5, 10);
  });
});

describe("buildFactoryFromRows", () => {
  it("her satiri bir istasyona cevirir", () => {
    const { config, importedCount } = buildFactoryFromRows(rows, mapping);
    expect(importedCount).toBe(3);
    expect(config.stations.map((station) => station.name)).toEqual([
      "Kesim",
      "Dikiş",
      "Kalite Kontrol",
    ]);
  });

  it("Turkce ondalik ve yuzde degerlerini okur", () => {
    const { config } = buildFactoryFromRows(rows, mapping);
    expect(config.stations[1].service_time_distribution.params.mean).toBeCloseTo(
      4.5,
      6,
    );
    expect(config.stations[1].scrap_rate).toBeCloseTo(0.03, 6);
  });

  it("okunabilir ve benzersiz kimlik uretir", () => {
    const { config } = buildFactoryFromRows(rows, mapping);
    expect(config.stations[0].id).toBe("kesim");
    expect(config.stations[2].id).toBe("kalite_kontrol");
  });

  it("ayni ad iki kez gecerse kimligi benzersizlestirir", () => {
    const duplicated: CellValue[][] = [
      ["Kesim", 3, 1, 0, null],
      ["Kesim", 4, 1, 0, null],
    ];
    const { config } = buildFactoryFromRows(duplicated, mapping);
    expect(config.stations[0].id).toBe("kesim");
    expect(config.stations[1].id).toBe("kesim_2");
  });

  it("istasyonlari dosya sirasiyla zincirler", () => {
    // Excel'deki satir sirasi neredeyse her zaman akis sirasidir.
    const { config } = buildFactoryFromRows(rows, mapping);
    expect(config.connections).toHaveLength(2);
    expect(config.connections[0]).toEqual({
      from_station_id: "kesim",
      to_station_id: "dikis",
      routing_probability: 1,
    });
    expect(config.arrival_process.entry_station_id).toBe("kesim");
  });

  it("bos tampon degerini varsayilana dusurur", () => {
    const { config } = buildFactoryFromRows(rows, mapping);
    expect(config.stations[0].buffer_capacity_before).toBe(10);
    expect(config.stations[1].buffer_capacity_before).toBe(INFINITE_CAPACITY);
  });

  it("gecersiz satirlari atlar ve sirasini bildirir", () => {
    const withBad: CellValue[][] = [
      ["Kesim", 3, 1, 0, null],
      ["", 4, 1, 0, null],
      ["Dikiş", "yok", 1, 0, null],
      ["Kalite", 2, 1, 0, null],
    ];
    const { config, importedCount, skippedRows } = buildFactoryFromRows(
      withBad,
      mapping,
    );
    expect(importedCount).toBe(2);
    expect(skippedRows).toEqual([1, 2]);
    expect(config.stations.map((s) => s.name)).toEqual(["Kesim", "Kalite"]);
  });

  it("makine kolonu yoksa operator kolonunu kullanir", () => {
    // Modelde ikisi de ayni alani (paralel sunucu sayisi) besler.
    const operatorMapping: ColumnMapping = {
      station: 0,
      cycleTime: 1,
      operators: 2,
    };
    const { config } = buildFactoryFromRows(rows, operatorMapping);
    expect(config.stations[0].num_servers).toBe(2);
  });

  it("makine sayisi en az 1 olur", () => {
    const zeroMachines: CellValue[][] = [["Kesim", 3, 0, 0, null]];
    const { config } = buildFactoryFromRows(zeroMachines, mapping);
    expect(config.stations[0].num_servers).toBe(1);
  });

  it("esleştirilmemis alanlarda varsayilanlari kullanir", () => {
    const minimal: ColumnMapping = { station: 0, cycleTime: 1 };
    const { config } = buildFactoryFromRows([["Kesim", 3]], minimal, {
      ...DEFAULT_IMPORT_DEFAULTS,
      machines: 4,
      scrapRate: 0.05,
      bufferCapacity: 20,
    });
    expect(config.stations[0].num_servers).toBe(4);
    expect(config.stations[0].scrap_rate).toBeCloseTo(0.05, 10);
    expect(config.stations[0].buffer_capacity_before).toBe(20);
  });

  it("zorunlu alanlar eksikse bos model doner, cokmez", () => {
    const { config, importedCount } = buildFactoryFromRows(rows, { station: 0 });
    expect(importedCount).toBe(0);
    expect(config.stations).toEqual([]);
    expect(config.connections).toEqual([]);
  });

  it("bos satir listesinde cokmez", () => {
    const { config, importedCount } = buildFactoryFromRows([], mapping);
    expect(importedCount).toBe(0);
    expect(config.arrival_process.entry_station_id).toBe("");
  });

  it("tek istasyonda baglanti uretmez", () => {
    const { config } = buildFactoryFromRows([["Kesim", 3, 1, 0, null]], mapping);
    expect(config.connections).toEqual([]);
  });
});

describe("suggestInterarrival", () => {
  it("en yavas istasyona gore aralik onerir", () => {
    // En yavas: Dikis 4,5 dk / 1 makine = 4.5 → 4.5 / 0.8 = 5.625 ≈ 5.63
    expect(suggestInterarrival(rows, mapping, 1)).toBeCloseTo(5.63, 2);
  });

  it("paralel makineleri hesaba katar", () => {
    // 10 dk / 2 makine = 5 → 5 / 0.8 = 6.25
    const parallel: CellValue[][] = [["Kesim", 10, 2, 0, null]];
    expect(suggestInterarrival(parallel, mapping, 1)).toBeCloseTo(6.25, 2);
  });

  it("cevrim suresi esleştirilmemisse varsayilani verir", () => {
    expect(suggestInterarrival(rows, { station: 0 }, 1)).toBe(
      DEFAULT_IMPORT_DEFAULTS.interarrivalMinutes,
    );
  });

  it("gecerli satir yoksa varsayilani verir", () => {
    expect(suggestInterarrival([["", "yok"]], mapping, 1)).toBe(
      DEFAULT_IMPORT_DEFAULTS.interarrivalMinutes,
    );
  });
});

describe("factoryNameFromFile", () => {
  it("uzantiyi atar ve ayraclari bosluga cevirir", () => {
    expect(factoryNameFromFile("uretim_hatti_2026.xlsx")).toBe(
      "Uretim hatti 2026",
    );
    expect(factoryNameFromFile("hat-b.csv")).toBe("Hat b");
  });

  it("Turkce ilk harfi dogru buyutur", () => {
    // Ingilizce toUpperCase() "i" harfini "I" yapar; Turkce'de "İ" olmali.
    expect(factoryNameFromFile("islem.csv").charAt(0)).toBe("İ");
  });

  it("uzantisiz dosya adini korur", () => {
    expect(factoryNameFromFile("hat")).toBe("Hat");
  });

  it("bos ada dusmez", () => {
    // Adsiz bir fabrika listede ayirt edilemez.
    expect(factoryNameFromFile(".csv")).toBe("İçe aktarılan fabrika");
    expect(factoryNameFromFile("__.xlsx")).toBe("İçe aktarılan fabrika");
  });
});
