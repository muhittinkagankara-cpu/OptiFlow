/**
 * İstasyon ikonu eşleştirmesinin birim testleri.
 *
 * Buradaki hatalar sessizdir: eşleşme kaçarsa ekranda hata görünmez, yalnızca
 * ikon genel kalır ve kimse fark etmez. Asıl risk Türkçe metin işlemedir —
 * "DİKİŞ" adının küçük harfe çevrilmesi ortamlara göre farklı sonuç verir ve
 * kullanıcının Türkçe karakter kullanıp kullanmaması eşleşmeyi bozmamalıdır.
 */

import { describe, expect, it } from "vitest";
import { stationIconFor, stationIconKind } from "./stationIcons";
import { StationIcon } from "../components/shared/icons";

describe("stationIconKind — anahtar kelime eşleşmesi", () => {
  it.each([
    ["Kesim", "kesim"],
    ["Dikiş", "dikis"],
    ["Kalite Kontrol", "kalite"],
    ["Paketleme", "paketleme"],
    ["Boyama", "boyama"],
  ])("%s adını %s türüne eşler", (name, expected) => {
    expect(stationIconKind(name)).toBe(expected);
  });

  it("eşleşme yoksa genel simgeye düşer", () => {
    expect(stationIconKind("Torna")).toBe("genel");
    expect(stationIconKind("Pres")).toBe("genel");
    expect(stationIconKind("")).toBe("genel");
  });

  it("adın herhangi bir yerindeki kelimeyi bulur", () => {
    expect(stationIconKind("CNC Kesim Tezgâhı")).toBe("kesim");
    expect(stationIconKind("2. Paketleme İstasyonu")).toBe("paketleme");
  });
});

describe("stationIconKind — Türkçe metin işleme", () => {
  it("büyük harfli adları da eşler", () => {
    // "İ" harfinin küçültülmesi ortamlara göre farklı sonuç verir; bu, eşleşmeyi
    // sessizce kaçıran klasik Türkçe tuzağıdır.
    expect(stationIconKind("DİKİŞ")).toBe("dikis");
    expect(stationIconKind("KALİTE KONTROL")).toBe("kalite");
    expect(stationIconKind("KESİM")).toBe("kesim");
  });

  it("Türkçe karakter kullanılmasa da eşler", () => {
    expect(stationIconKind("dikis")).toBe("dikis");
    expect(stationIconKind("kalite kontrol")).toBe("kalite");
    expect(stationIconKind("Kesim Hatti")).toBe("kesim");
  });

  it("ek almış kelimeleri de yakalar", () => {
    expect(stationIconKind("Kesimhane")).toBe("kesim");
    expect(stationIconKind("Boyahane")).toBe("boyama");
    expect(stationIconKind("Paketleme Bölümü")).toBe("paketleme");
  });

  it("baştaki ve sondaki boşluklardan etkilenmez", () => {
    expect(stationIconKind("   Boyama   ")).toBe("boyama");
  });
});

describe("stationIconKind — öncelik sırası", () => {
  it("daha özgül kelime kazanır", () => {
    // "Kalite Kesim Kontrol" gibi bir adda ilk tanımlı kural uygulanır; sıra
    // rastgele olsaydı aynı ad her derlemede farklı ikon gösterebilirdi.
    expect(stationIconKind("Kalite Kesim Kontrol")).toBe("kalite");
  });

  it("aynı ad her zaman aynı sonucu verir", () => {
    const ilk = stationIconKind("Dikiş ve Kesim");
    for (let index = 0; index < 5; index += 1) {
      expect(stationIconKind("Dikiş ve Kesim")).toBe(ilk);
    }
  });
});

describe("stationIconFor", () => {
  it("her tür için bir bileşen döndürür", () => {
    for (const name of ["Kesim", "Dikiş", "Kalite", "Paketleme", "Boyama", "Torna"]) {
      expect(typeof stationIconFor(name)).toBe("function");
    }
  });

  it("eşleşmeyen ad mevcut varsayılan simgeyi kullanır", () => {
    // Varsayılanın değişmemesi önemlidir: bu simge sihirbazdan editöre kadar
    // her yerde "istasyon" anlamına gelir.
    expect(stationIconFor("Torna")).toBe(StationIcon);
  });
});
