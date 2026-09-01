/**
 * Hata çeviri tablosunun birim testleri.
 *
 * Buradaki ham metinler uydurulmamıştır: hepsi backend'in gerçekten ürettiği
 * mesajlardan alınmıştır (`simulation_engine/models/schemas.py`,
 * `core/engine.py` ve `api/simulation_service.py`). Uydurma metinlerle test
 * etmek, tablonun gerçek hatalarla eşleştiğini değil yalnızca kendi
 * varsayımlarımızla tutarlı olduğunu gösterirdi.
 *
 * Kabul kriteri şudur: kullanıcı hiçbir zaman ham backend metnini, teknik
 * terimi (rho, routing_probability) veya JSON parçasını görmemeli.
 */

import { describe, expect, it } from "vitest";
import {
  GENERIC_ERROR_MESSAGE,
  summarizeWarning,
  translateErrorDetail,
  translateErrorDetails,
} from "./errorMessages";

/** Backend'in gerçekte ürettiği hata metinleri ve beklenen çeviri parçası. */
const REAL_BACKEND_ERRORS: Array<[string, string]> = [
  [
    "Varis sureci 'S' istasyonuna giris yapiyor ancak boyle bir istasyon tanimli degil. Tanimli istasyonlar: ['A', 'B'].",
    "gireceği istasyon bulunamadı",
  ],
  ["Giris istasyonu bilinmiyor: 'YOK'", "gireceği istasyon bulunamadı"],
  [
    "Baglanti kaynagi bilinmiyor: 'silinmis'",
    "var olmayan bir istasyona gidiyor",
  ],
  [
    "Baglanti hedefi 'yok' tanimli degil. Tanimli istasyonlar: ['A'].",
    "var olmayan bir istasyona gidiyor",
  ],
  [
    "'A' istasyonundan cikan yonlendirme olasiliklari toplami 1.0'i asiyor: 1.300000",
    "%100'ü geçemez",
  ],
  ["Yinelenen istasyon kimlikleri: ['a']", "birden fazla istasyon var"],
  [
    "Istek cok buyuk. Tahmini olay sayisi 9,600,000,000, sinir 50,000,000.",
    "çok büyük",
  ],
  [
    "Isinma periyodu (2000.0) toplam simulasyon suresinden (1000.0) kisa olmalidir; aksi halde istatistik toplanacak pencere kalmaz.",
    "Isınma süresi",
  ],
  [
    "'X' istasyonunda ariza modeli eksik: 'failure_rate' ve 'repair_time_distribution' ya birlikte verilmeli ya da ikisi de verilmemelidir.",
    "Arıza ayarları yarım kalmış",
  ],
  [
    "Ucgen dagilimda min <= mode <= max kosulu saglanmali; alinan min=5.0, mode=2.0, max=8.0.",
    "sıralı değil",
  ],
  ["Ustel dagilimda 'mean' pozitif olmalidir.", "sıfırdan büyük olmalı"],
  ["Normal dagilimda 'std' pozitif olmalidir.", "Sapma değeri sıfırdan büyük"],
  [
    "'abc' kimlikli simulasyon bulunamadi. Sonuclar surec belleginde tutulur;",
    "artık bulunamıyor",
  ],
  ["En fazla 10 senaryo karsilastirilabilir, alinan: 11.", "senaryo sayısı sınırlı"],
];

describe("translateErrorDetail — gerçek backend metinleri", () => {
  it.each(REAL_BACKEND_ERRORS)("çevirir: %s", (raw, expectedFragment) => {
    const translated = translateErrorDetail(raw);
    expect(translated).not.toBeNull();
    expect(translated).toContain(expectedFragment);
  });

  it.each(REAL_BACKEND_ERRORS)(
    "çeviri ham metinden hiçbir parça sızdırmaz: %s",
    (raw) => {
      const translated = translateErrorDetail(raw)!;
      // Teknik alan adları ve iç değişkenler kullanıcıya gösterilmemeli.
      for (const leak of [
        "routing_probability",
        "simulation_duration_minutes",
        "warmup_period_minutes",
        "num_replications",
        "entry_station_id",
        "rho",
        "Traceback",
        "{",
        "[",
      ]) {
        expect(translated).not.toContain(leak);
      }
      expect(translated).not.toBe(raw);
    },
  );
});

describe("translateErrorDetail — Pydantic alan hataları", () => {
  const PYDANTIC_ERRORS = [
    "stations > 0 > num_servers: Input should be greater than or equal to 1",
    "simulation_duration_minutes: Input should be greater than 0",
    "stations > 0 > scrap_rate: Input should be less than or equal to 1",
    "arrival_process: Field required",
  ];

  it.each(PYDANTIC_ERRORS)("tanır: %s", (raw) => {
    expect(translateErrorDetail(raw)).not.toBeNull();
  });
});

describe("translateErrorDetails — liste davranışı", () => {
  it("aynı mesaja çevrilen hataları tekrarlamaz", () => {
    // Altı alandan gelen aynı uyarı, kullanıcıya altı kez gösterilmemeli.
    const messages = translateErrorDetails([
      "stations > 0 > num_servers: Input should be greater than 0",
      "stations > 1 > num_servers: Input should be greater than 0",
      "stations > 2 > num_servers: Input should be greater than 0",
    ]);
    expect(messages).toHaveLength(1);
  });

  it("hiçbir desen eşleşmezse genel mesaja düşer", () => {
    const messages = translateErrorDetails(["ZZZ bilinmeyen bir hata ZZZ"]);
    expect(messages).toEqual([GENERIC_ERROR_MESSAGE]);
  });

  it("tanınan ve tanınmayan hatalar karışıksa tanınanları gösterir", () => {
    const messages = translateErrorDetails([
      "ZZZ bilinmeyen ZZZ",
      "Giris istasyonu bilinmiyor: 'YOK'",
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("gireceği istasyon bulunamadı");
  });

  it("boş liste bile kullanıcıya gösterilebilir bir mesaj üretir", () => {
    expect(translateErrorDetails([])).toEqual([GENERIC_ERROR_MESSAGE]);
  });
});

describe("summarizeWarning — kararlılık uyarıları", () => {
  const UNSTABLE_WARNING =
    "KARARSIZ SISTEM: 'S' (Istasyon) istasyonunun teorik yuku rho = 1.2000 >= 1. " +
    "Bu istasyona gelen is, islenebilecegi hizdan fazla; kuyruk sinirsiz buyuyecek " +
    "ve ortalama bekleme suresi hicbir degere yakinsamayacaktir.";

  const CAPACITY_WARNING =
    "KAPASITE SINIRLI: 'S' (Istasyon) istasyonunun teorik yuku rho = 1.2000 >= 1, " +
    "ancak sistemdeki azami parca sayisi 5 ile sinirli. Kuyruk sinirsiz buyuyemez; " +
    "sistem KARARLIDIR. M/M/1/K yaklasimiyla gelen parcalarin yaklasik %25.1'i " +
    "sisteme alinamayacak (doygunluk sinirinda kayip orani en az %16.7'dir).";

  it("kararsızlık uyarısını eyleme dönük bir cümleye indirger", () => {
    const summary = summarizeWarning(UNSTABLE_WARNING);
    expect(summary).toContain("yetiştiremiyor");
    expect(summary).toContain("makine ekleyin");
    expect(summary).not.toContain("rho");
    expect(summary).not.toContain("KARARSIZ");
  });

  it("kapasite sınırı uyarısından red oranını çıkarır", () => {
    const summary = summarizeWarning(CAPACITY_WARNING);
    expect(summary).toContain("%25.1");
    expect(summary).toContain("sisteme alınamayacak");
    expect(summary).not.toContain("M/M/1/K");
    expect(summary).not.toContain("rho");
  });

  it("az replikasyon uyarısını kullanıcı diline çevirir", () => {
    const summary = summarizeWarning(
      "Yalnizca 5 replikasyon calistirildi; onerilen asgari 30.",
    );
    expect(summary).toContain("Detaylı");
    expect(summary).not.toContain("replikasyon");
  });

  it("tanımadığı uyarıyı olduğu gibi bırakır", () => {
    // Bilinmeyen bir uyarıyı yutmak, kullanıcıyı önemli bir bilgiden mahrum
    // bırakabilir; çevrilemeyen mesaj gizlenmez, aynen gösterilir.
    const unknown = "Beklenmedik bir durum olustu.";
    expect(summarizeWarning(unknown)).toBe(unknown);
  });
});
