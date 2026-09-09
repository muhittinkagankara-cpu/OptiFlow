import { describe, expect, it } from "vitest";
import {
  SAMPLE_STATIONS,
  sampleMappings,
  sampleSources,
} from "./fixtures";
import {
  assignMapping,
  compatibleSources,
  describeMapping,
  fieldsOfSource,
  isSourceUsed,
  isTypeCompatible,
  mappingCoverage,
  mappingFor,
  mappingId,
  removeMapping,
  removeMappingsOfSources,
  sampleLabel,
  sortMappings,
  sourcesByConnector,
  stationCoverage,
} from "./mapping";
import { FIELD_ORDER, type FieldMapping, type SourceNode } from "./types";

const SOURCES = sampleSources();
const STATION_IDS = SAMPLE_STATIONS.map((station) => station.id);

function source(overrides: Partial<SourceNode> = {}): SourceNode {
  return {
    id: "src-x",
    connectorId: "conn-x",
    kind: "opcua",
    address: "ns=2;s=X",
    label: "X",
    dataType: "number",
    unit: null,
    sample: null,
    ...overrides,
  };
}

describe("mappingId", () => {
  it("istasyon ve alandan kararli bir kimlik uretir", () => {
    expect(mappingId("torna", "queue")).toBe("torna:queue");
    expect(mappingId("torna", "queue")).toBe(mappingId("torna", "queue"));
  });
});

describe("assignMapping", () => {
  it("bos listeye ilk eslemeyi ekler", () => {
    const next = assignMapping([], "src-1", "torna", "queue");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      sourceId: "src-1",
      stationId: "torna",
      field: "queue",
    });
  });

  it("ayni alanin ikinci eslemesini olusturmaz, degistirir", () => {
    // Bir alanin iki kaynaktan beslenmesi, hangisinin kazandigi belirsiz bir
    // yaris demektir.
    const first = assignMapping([], "src-1", "torna", "queue");
    const second = assignMapping(first, "src-2", "torna", "queue");
    expect(second).toHaveLength(1);
    expect(second[0].sourceId).toBe("src-2");
  });

  it("ayni kaynagi farkli alanlara baglayabilir", () => {
    let mappings = assignMapping([], "src-1", "torna", "queue");
    mappings = assignMapping(mappings, "src-1", "torna", "scrap");
    expect(mappings).toHaveLength(2);
  });

  it("farkli istasyonlarda ayni alan ayri kayittir", () => {
    let mappings = assignMapping([], "src-1", "torna", "queue");
    mappings = assignMapping(mappings, "src-2", "kesim", "queue");
    expect(mappings).toHaveLength(2);
  });

  it("girdiyi degistirmez", () => {
    const original: FieldMapping[] = [];
    assignMapping(original, "src-1", "torna", "queue");
    expect(original).toHaveLength(0);
  });
});

describe("removeMapping", () => {
  it("kimlige gore siler", () => {
    const mappings = assignMapping([], "src-1", "torna", "queue");
    expect(removeMapping(mappings, "torna:queue")).toEqual([]);
  });

  it("taninmayan kimlik listeyi bozmaz", () => {
    const mappings = assignMapping([], "src-1", "torna", "queue");
    expect(removeMapping(mappings, "yok")).toHaveLength(1);
  });
});

describe("removeMappingsOfSources", () => {
  it("silinen baglantinin eslemelerini birlikte goturur", () => {
    const mappings = sampleMappings();
    const opcuaSources = SOURCES.filter(
      (item) => item.connectorId === "conn-opcua",
    ).map((item) => item.id);
    const next = removeMappingsOfSources(mappings, opcuaSources);
    expect(next.every((item) => !item.sourceId.startsWith("src-opcua"))).toBe(
      true,
    );
    expect(next.length).toBeLessThan(mappings.length);
  });

  it("bos liste hicbir seyi silmez", () => {
    const mappings = sampleMappings();
    expect(removeMappingsOfSources(mappings, [])).toHaveLength(mappings.length);
  });
});

describe("mappingFor", () => {
  it("istasyon-alan ciftinin eslemesini bulur", () => {
    const found = mappingFor(sampleMappings(), "torna", "queue");
    expect(found?.sourceId).toBe("src-mqtt-queue");
  });

  it("baglanmamis alanda bos doner", () => {
    expect(mappingFor(sampleMappings(), "torna", "cycleTime")).toBeNull();
  });
});

describe("isSourceUsed / fieldsOfSource", () => {
  it("kullanilan kaynagi bulur", () => {
    expect(isSourceUsed(sampleMappings(), "src-mqtt-queue")).toBe(true);
  });

  it("kullanilmayan kaynagi ayirir", () => {
    expect(isSourceUsed(sampleMappings(), "src-rest-note")).toBe(false);
  });

  it("bir kaynagin tum alanlarini listeler", () => {
    const mappings = assignMapping(
      assignMapping([], "src-1", "torna", "queue"),
      "src-1",
      "torna",
      "scrap",
    );
    expect(fieldsOfSource(mappings, "src-1")).toHaveLength(2);
  });
});

describe("mappingCoverage", () => {
  it("orani hesaplar", () => {
    // Ornek veride 8 esleme var; 3 istasyon x 5 alan = 15 gerekli.
    const coverage = mappingCoverage(sampleMappings(), STATION_IDS);
    expect(coverage).toBeCloseTo(8 / 15, 6);
  });

  it("istasyon yoksa sifir degil bos doner", () => {
    // Sifir "hicbir sey baglanmadi" demektir; baglanacak sey de yoksa farklidir.
    expect(mappingCoverage(sampleMappings(), [])).toBeNull();
  });

  it("listede olmayan istasyonun eslemesi sayilmaz", () => {
    const coverage = mappingCoverage(sampleMappings(), ["kesim"]);
    expect(coverage).toBeCloseTo(4 / FIELD_ORDER.length, 6);
  });

  it("orani birin uzerine cikarmaz", () => {
    const many = [
      ...sampleMappings(),
      ...sampleMappings().map((item) => ({ ...item, id: `${item.id}-kopya` })),
    ];
    expect(mappingCoverage(many, ["kesim"]) ?? 0).toBeLessThanOrEqual(1);
  });
});

describe("stationCoverage", () => {
  it("istasyondaki esleme sayisini verir", () => {
    expect(stationCoverage(sampleMappings(), "kesim")).toBe(4);
    expect(stationCoverage(sampleMappings(), "kaynak")).toBe(2);
  });
});

describe("isTypeCompatible", () => {
  it("sayisal dugum sayisal alana baglanir", () => {
    expect(isTypeCompatible("number", "queue")).toBe(true);
  });

  it("bit bilgisi sayisal alana baglanabilir", () => {
    // Sahada "calisiyor" bilgisi cogu zaman tek bitliktir.
    expect(isTypeCompatible("boolean", "productionCount")).toBe(true);
  });

  it("metin sayisal alana baglanamaz", () => {
    // Sessizce NaN uretirdi.
    expect(isTypeCompatible("string", "queue")).toBe(false);
  });

  it("metin ve enum makine durumuna baglanir", () => {
    expect(isTypeCompatible("string", "machineState")).toBe(true);
    expect(isTypeCompatible("enum", "machineState")).toBe(true);
  });

  it("enum sayisal alana baglanamaz", () => {
    expect(isTypeCompatible("enum", "cycleTime")).toBe(false);
  });
});

describe("compatibleSources", () => {
  it("alana uygun kaynaklari suzer", () => {
    const forQueue = compatibleSources(SOURCES, "queue");
    expect(forQueue.every((item) => item.dataType === "number")).toBe(true);
  });

  it("makine durumuna metin dugumleri de gelir", () => {
    const forState = compatibleSources(SOURCES, "machineState");
    expect(forState.some((item) => item.dataType === "string")).toBe(true);
    expect(forState.some((item) => item.dataType === "enum")).toBe(true);
  });
});

describe("sourcesByConnector", () => {
  it("kaynaklari baglantiya gore gruplar", () => {
    const groups = sourcesByConnector(SOURCES);
    expect(groups.map((group) => group.connectorId)).toEqual([
      "conn-opcua",
      "conn-mqtt",
      "conn-rest",
    ]);
    expect(groups[0].sources).toHaveLength(4);
  });

  it("bos listede grup uretmez", () => {
    expect(sourcesByConnector([])).toEqual([]);
  });
});

describe("sortMappings", () => {
  it("istasyon ve alan sirasina dizer", () => {
    const shuffled: FieldMapping[] = [
      { id: "b:scrap", sourceId: "s1", stationId: "b", field: "scrap" },
      { id: "a:queue", sourceId: "s2", stationId: "a", field: "queue" },
      { id: "b:queue", sourceId: "s3", stationId: "b", field: "queue" },
    ];
    expect(sortMappings(shuffled).map((item) => item.id)).toEqual([
      "a:queue",
      "b:queue",
      "b:scrap",
    ]);
  });
});

describe("describeMapping / sampleLabel", () => {
  it("okunur esleme basligi uretir", () => {
    const [mapping] = sampleMappings();
    expect(describeMapping(mapping, "Kesim")).toBe("Kesim · Kuyruk");
  });

  it("ornek degeri birimiyle gosterir", () => {
    expect(sampleLabel(source({ sample: "4", unit: "adet" }))).toBe("4 adet");
  });

  it("birimsiz ornegi oldugu gibi yazar", () => {
    expect(sampleLabel(source({ sample: "RUNNING", unit: null }))).toBe(
      "RUNNING",
    );
  });

  it("okunmamis ornek uydurulmaz", () => {
    // Sahte bir ornek deger, yanlis baglanan bir dugumu dogru gosterirdi.
    expect(sampleLabel(source({ sample: null }))).toBe("—");
  });
});
