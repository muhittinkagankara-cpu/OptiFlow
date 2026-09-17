/**
 * Sürücü kararının çözümlenmesi (Sprint 2L).
 *
 * En kritik testler belirsizlikle ilgilidir: eksik, bozuk ya da hiç okunamayan
 * bir yanıt **her zaman** benzetim tarafına düşmeli. Ters yönde bir hata,
 * operatöre olmayan bir hattı gerçek gibi okutur.
 */

import { describe, expect, it } from "vitest";

import {
  DRIVER_UNREADABLE_REASON,
  driverProvenance,
  liveSourceFor,
  parseRuntimeDriver,
  unreadableDriver,
} from "./driver";

const gercek = {
  connection_id: "torna-1",
  kind: "opcua",
  label: "Torna",
  reason: "OPC UA bağlantısı 'Torna' doğrulandı ve şu anda bağlı.",
  candidates: 2,
  simulated: false,
};

const benzetim = {
  connection_id: null,
  kind: null,
  label: null,
  reason: "Doğrulanmış ve şu anda bağlı bir cihaz yok.",
  candidates: 0,
  simulated: true,
};

describe("gerçek sürücü yükü", () => {
  it("bağlantı kimliğini ve protokolü okur", () => {
    const d = parseRuntimeDriver(gercek);
    expect(d.connectionId).toBe("torna-1");
    expect(d.kind).toBe("opcua");
    expect(d.label).toBe("Torna");
    expect(d.simulated).toBe(false);
  });

  it("aday sayısını taşır", () => {
    expect(parseRuntimeDriver(gercek).candidates).toBe(2);
  });

  it("gerekçeyi sunucudan geldiği gibi taşır", () => {
    // Gerekçe burada yeniden yazılsaydı, iki taraf farklı sey soylerdi.
    expect(parseRuntimeDriver(gercek).reason).toBe(gercek.reason);
  });

  it("ekranı runtime kaynağıyla açar", () => {
    expect(liveSourceFor(parseRuntimeDriver(gercek))).toBe("runtime");
  });
});

describe("benzetim yükü", () => {
  it("hiçbir bağlantı kimliği taşımaz", () => {
    const d = parseRuntimeDriver(benzetim);
    expect(d.connectionId).toBeNull();
    expect(d.kind).toBeNull();
    expect(d.simulated).toBe(true);
  });

  it("ekranı demo kaynağıyla açar", () => {
    expect(liveSourceFor(parseRuntimeDriver(benzetim))).toBe("demo");
  });

  it("ölçülmeyen alan sıfıra düşmez", () => {
    // Yasa 4: olculmeyen deger null kalir, 0 bir olcum gibi okunur.
    expect(parseRuntimeDriver(benzetim).label).toBeNull();
  });
});

describe("bozuk ya da eksik yük her zaman benzetime düşer", () => {
  it("boş nesne benzetim sayılır", () => {
    const d = parseRuntimeDriver({});
    expect(d.simulated).toBe(true);
    expect(liveSourceFor(d)).toBe("demo");
  });

  it("null benzetim sayılır", () => {
    expect(parseRuntimeDriver(null).simulated).toBe(true);
  });

  it("tanınmayan protokol benzetim sayılır", () => {
    // Sunucu yeni bir tur eklerse, tarayici onu gercek gibi gostermemeli.
    const d = parseRuntimeDriver({ ...gercek, kind: "modbus" });
    expect(d.simulated).toBe(true);
    expect(d.kind).toBeNull();
  });

  it("simulated alanı yokken kimliğe bakılır", () => {
    const { simulated, ...eksik } = gercek;
    void simulated;
    expect(parseRuntimeDriver(eksik).simulated).toBe(false);
  });

  it("simulated alanı yokken kimlik de yoksa benzetime düşer", () => {
    expect(parseRuntimeDriver({ reason: "x" }).simulated).toBe(true);
  });

  it("simulated true iken bağlantı kimliği sızdırılmaz", () => {
    // Sunucu celiskili bir yuk gonderse bile guvenli taraf secilir.
    const d = parseRuntimeDriver({ ...gercek, simulated: true });
    expect(d.connectionId).toBeNull();
    expect(d.label).toBeNull();
  });

  it("negatif aday sayısı sıfıra çekilir", () => {
    expect(parseRuntimeDriver({ ...gercek, candidates: -5 }).candidates).toBe(0);
  });

  it("gerekçe yoksa okunamadı cümlesi yazılır", () => {
    const { reason, ...eksik } = gercek;
    void reason;
    expect(parseRuntimeDriver(eksik).reason).toBe(DRIVER_UNREADABLE_REASON);
  });
});

describe("karar hiç okunamadığında", () => {
  it("benzetim tarafına düşer", () => {
    expect(unreadableDriver().simulated).toBe(true);
    expect(liveSourceFor(null)).toBe("demo");
  });

  it("gerekçe cihaz yok demez, soru sorulamadı der", () => {
    // "Cihaz yok" fabrikayla ilgili bir olgu; burada olan bizim tarafimizdaki
    // bir ariza. Ikisini ayni cumleyle anlatmak yaniltir.
    const metin = driverProvenance(null);
    expect(metin).toBe(DRIVER_UNREADABLE_REASON);
    expect(metin).toContain("sunucuya ulaşılamadı");
    expect(metin).not.toContain("cihaz yok");
  });

  it("sonraki adımı söyler", () => {
    expect(driverProvenance(null)).toContain("yenileyin");
  });
});
