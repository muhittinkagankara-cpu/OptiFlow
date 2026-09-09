import { describe, expect, it } from "vitest";
import {
  LIVE_FIELDS,
  LIVE_FIELD_TYPE,
  coerce,
  emptyLiveFields,
  flattenPayload,
  inspectPayload,
  mapPayload,
  mappedFieldCount,
  readPath,
  setMapping,
  suggestField,
  validateMapping,
  type LiveMapping,
} from "./payload";

const PAYLOAD = {
  queue: 12,
  cycle: 331,
  fault: false,
  state: "RUNNING",
  data: {
    stations: [
      { id: "torna", q: 4, rate: "0,45" },
      { id: "kaynak", q: 7, rate: "0,30" },
    ],
  },
  meta: null,
};

describe("flattenPayload", () => {
  const entries = flattenPayload(PAYLOAD);

  it("yaprak degerleri adresleriyle listeler", () => {
    const paths = entries.map((entry) => entry.path);
    expect(paths).toContain("queue");
    expect(paths).toContain("data.stations[0].q");
  });

  it("tipleri isaretler", () => {
    expect(entries.find((entry) => entry.path === "queue")?.type).toBe("number");
    expect(entries.find((entry) => entry.path === "fault")?.type).toBe("boolean");
    expect(entries.find((entry) => entry.path === "state")?.type).toBe("string");
    expect(entries.find((entry) => entry.path === "meta")?.type).toBe("null");
  });

  it("dizileri indeksle adresler", () => {
    // Sahadaki uclar istasyonlari dizi dondurur; kullanici indeksi gormeli.
    expect(entries.some((entry) => entry.path === "data.stations[1].id")).toBe(true);
  });

  it("baslangicta eslesen alan yoktur", () => {
    expect(entries.every((entry) => entry.matchedField === null)).toBe(true);
  });

  it("derinlik sinirini asan yapiyi nesne olarak birakir", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    const shallow = flattenPayload(deep, 3);
    expect(shallow.some((entry) => entry.type === "object")).toBe(true);
  });

  it("cok buyuk yukte satir sayisini sinirlar", () => {
    const big = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [`k${index}`, index]),
    );
    expect(flattenPayload(big, 6, 50)).toHaveLength(50);
  });

  it("ilkel deger de tek satir uretir", () => {
    expect(flattenPayload(42)).toHaveLength(1);
  });

  it("bos nesne satir uretmez", () => {
    expect(flattenPayload({})).toEqual([]);
  });
});

describe("readPath", () => {
  it("duz alani okur", () => {
    expect(readPath(PAYLOAD, "queue")).toBe(12);
  });

  it("ic ice alani okur", () => {
    expect(readPath(PAYLOAD, "data.stations[1].q")).toBe(7);
  });

  it("olmayan adres icin undefined doner", () => {
    // `null` ile karistirilmaz: ucun null dondurmesi baska, adresin
    // bulunamamasi baskadir.
    expect(readPath(PAYLOAD, "yok.bir.yer")).toBeUndefined();
  });

  it("gercekten null olan alani null dondurur", () => {
    expect(readPath(PAYLOAD, "meta")).toBeNull();
  });

  it("bos adres undefined doner", () => {
    expect(readPath(PAYLOAD, "  ")).toBeUndefined();
  });

  it("dizi disi indekste undefined doner", () => {
    expect(readPath(PAYLOAD, "data.stations[9].q")).toBeUndefined();
  });

  it("ilkel degerin altina inmez", () => {
    expect(readPath(PAYLOAD, "queue.alt")).toBeUndefined();
  });
});

describe("coerce", () => {
  it("sayiyi oldugu gibi birakir", () => {
    expect(coerce(12, "number")).toBe(12);
  });

  it("metin sayiyi cevirir, Turkce ondaligi anlar", () => {
    expect(coerce("12", "number")).toBe(12);
    expect(coerce("0,45", "number")).toBe(0.45);
  });

  it("cevrilemeyen metinde null doner", () => {
    // Sifir yazmak, dolu bir kuyrugu bos gostermek olurdu.
    expect(coerce("abc", "number")).toBeNull();
  });

  it("boolean degeri sayiya cevirir", () => {
    expect(coerce(true, "number")).toBe(1);
    expect(coerce(false, "number")).toBe(0);
  });

  it("0/1 ve metinleri boolean'a cevirir", () => {
    expect(coerce(1, "boolean")).toBe(true);
    expect(coerce(0, "boolean")).toBe(false);
    expect(coerce("true", "boolean")).toBe(true);
    // "arıza" listede olduğu için true döner; Türkçe metinler de tanınır.
    expect(coerce("Arıza", "boolean")).toBe(true);
    expect(coerce("fault", "boolean")).toBe(true);
    expect(coerce("normal", "boolean")).toBe(false);
  });

  it("taninmayan boolean metninde null doner", () => {
    expect(coerce("belki", "boolean")).toBeNull();
  });

  it("metin alanina sayi da yazilabilir", () => {
    expect(coerce(3, "string")).toBe("3");
  });

  it("null ve undefined null doner", () => {
    expect(coerce(null, "number")).toBeNull();
    expect(coerce(undefined, "string")).toBeNull();
  });

  it("nesne hicbir tipe cevrilmez", () => {
    expect(coerce({ a: 1 }, "number")).toBeNull();
    expect(coerce({ a: 1 }, "string")).toBeNull();
  });

  it("sonsuz sayi olcum sayilmaz", () => {
    expect(coerce(Number.POSITIVE_INFINITY, "number")).toBeNull();
  });
});

describe("mapPayload", () => {
  const mappings: LiveMapping[] = [
    { field: "queue", path: "queue" },
    { field: "cycleCount", path: "cycle" },
    { field: "fault", path: "fault" },
    { field: "machineState", path: "state" },
  ];

  it("eslenen alanlari doldurur", () => {
    const fields = mapPayload(PAYLOAD, mappings);
    expect(fields.queue).toBe(12);
    expect(fields.cycleCount).toBe(331);
    expect(fields.fault).toBe(false);
    expect(fields.machineState).toBe("RUNNING");
  });

  it("eslenmemis alan null kalir", () => {
    expect(mapPayload(PAYLOAD, mappings).throughput).toBeNull();
  });

  it("olmayan adres alani doldurmaz", () => {
    const fields = mapPayload(PAYLOAD, [{ field: "queue", path: "yok" }]);
    expect(fields.queue).toBeNull();
  });

  it("metin sayiyi cevirir", () => {
    const fields = mapPayload(PAYLOAD, [
      { field: "throughput", path: "data.stations[0].rate" },
    ]);
    expect(fields.throughput).toBe(0.45);
  });

  it("bos eslemede hicbir alan dolmaz", () => {
    expect(mapPayload(PAYLOAD, [])).toEqual(emptyLiveFields());
  });

  it("kac alanin okundugunu sayar", () => {
    expect(mappedFieldCount(mapPayload(PAYLOAD, mappings))).toBe(4);
    expect(mappedFieldCount(emptyLiveFields())).toBe(0);
  });
});

describe("setMapping", () => {
  it("yeni esleme ekler", () => {
    expect(setMapping([], "queue", "queue")).toHaveLength(1);
  });

  it("ayni alanin ikinci eslemesini olusturmaz", () => {
    const first = setMapping([], "queue", "a");
    const second = setMapping(first, "queue", "b");
    expect(second).toHaveLength(1);
    expect(second[0].path).toBe("b");
  });

  it("bos adres eslemeyi kaldirir", () => {
    const mapped = setMapping([], "queue", "a");
    expect(setMapping(mapped, "queue", "  ")).toEqual([]);
  });

  it("alan sirasini korur", () => {
    let mappings = setMapping([], "fault", "f");
    mappings = setMapping(mappings, "queue", "q");
    expect(mappings.map((item) => item.field)).toEqual(["queue", "fault"]);
  });

  it("girdiyi degistirmez", () => {
    const original: LiveMapping[] = [];
    setMapping(original, "queue", "q");
    expect(original).toHaveLength(0);
  });
});

describe("suggestField", () => {
  it("bilinen adlari tanir", () => {
    expect(suggestField("data.queue")).toBe("queue");
    expect(suggestField("machineState")).toBe("machineState");
    expect(suggestField("cycleCount")).toBe("cycleCount");
    expect(suggestField("faultFlag")).toBe("fault");
    expect(suggestField("throughputRate")).toBe("throughput");
  });

  it("Turkce adlari da tanir", () => {
    expect(suggestField("hat.kuyruk")).toBe("queue");
    expect(suggestField("makine.durum")).toBe("machineState");
  });

  it("taninmayan adreste oneri vermez", () => {
    // Otomatik kurulan bir esleme, yanlissa fark edilmesi en zor hatadir.
    expect(suggestField("meta.timestamp")).toBeNull();
  });
});

describe("inspectPayload", () => {
  it("eslesen alanlari isaretler", () => {
    const entries = inspectPayload(PAYLOAD, [{ field: "queue", path: "queue" }]);
    expect(entries.find((entry) => entry.path === "queue")?.matchedField).toBe(
      "queue",
    );
  });

  it("eslesmeyenleri bos birakir", () => {
    const entries = inspectPayload(PAYLOAD, [{ field: "queue", path: "queue" }]);
    expect(entries.find((entry) => entry.path === "cycle")?.matchedField).toBeNull();
  });

  it("esleme yokken hicbir satir isaretlenmez", () => {
    expect(
      inspectPayload(PAYLOAD, []).every((entry) => entry.matchedField === null),
    ).toBe(true);
  });
});

describe("validateMapping", () => {
  it("dogru eslemede sorun bulmaz", () => {
    expect(validateMapping(PAYLOAD, [{ field: "queue", path: "queue" }])).toEqual([]);
  });

  it("olmayan adresi bildirir", () => {
    const issues = validateMapping(PAYLOAD, [{ field: "queue", path: "yok" }]);
    expect(issues[0].text).toContain("bulunamadı");
  });

  it("cevrilemeyen tipi bildirir", () => {
    const issues = validateMapping(PAYLOAD, [{ field: "queue", path: "state" }]);
    expect(issues[0].text).toContain("çevrilemedi");
  });

  it("birden cok sorunu listeler", () => {
    const issues = validateMapping(PAYLOAD, [
      { field: "queue", path: "yok" },
      { field: "cycleCount", path: "state" },
    ]);
    expect(issues).toHaveLength(2);
  });

  it("bos eslemede sorun yoktur", () => {
    expect(validateMapping(PAYLOAD, [])).toEqual([]);
  });
});

describe("alan sözlüğü", () => {
  it("bes canli alan tanimlidir", () => {
    expect(LIVE_FIELDS).toHaveLength(5);
  });

  it("her alanin bir tipi vardir", () => {
    for (const field of LIVE_FIELDS) {
      expect(LIVE_FIELD_TYPE[field]).toBeDefined();
    }
  });
});
