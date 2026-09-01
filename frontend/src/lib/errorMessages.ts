/**
 * Backend hata mesajlarının kullanıcı diline çevirisi.
 *
 * Hedef kullanıcı bir üretim müdürü; ekranda "routing_probability sum exceeds
 * 1.0" ya da ham bir JSON gövdesi görmemeli. Her mesaj üç şeyi yapmalı:
 * **ne olduğunu** söylemeli, **nerede** olduğunu göstermeli ve **ne yapması
 * gerektiğini** anlatmalı. Suçlayıcı değil, yol gösterici bir dil kullanılır.
 *
 * Eşleme, backend'in ürettiği metinlerdeki ayırt edici parçalara bakar. Backend
 * mesajları Türkçe ama aksansız (ASCII) yazılmıştır; buradaki desenler de öyle.
 */

/** Bir hata deseni ve karşılığı olan kullanıcı mesajı. */
interface ErrorTranslation {
  /** Ham mesajda aranacak parça (küçük harfe çevrilmiş olarak karşılaştırılır). */
  match: string | RegExp;
  /** Kullanıcıya gösterilecek metin. */
  message: string;
}

/**
 * Çeviri tablosu. Sıra önemlidir: ilk eşleşen desen kazanır, bu yüzden özel
 * durumlar genel olanlardan önce yazılır.
 */
const TRANSLATIONS: ErrorTranslation[] = [
  // --- Yapısal / bağlantı hataları ---
  {
    match: /istasyonuna giris yapiyor ancak boyle bir istasyon tanimli degil/i,
    message:
      "Parçaların gireceği istasyon bulunamadı. Başlangıç noktasının bir istasyona bağlı olduğundan emin olun.",
  },
  {
    match: /giris istasyonu bilinmiyor/i,
    message:
      "Parçaların gireceği istasyon bulunamadı. Başlangıç noktasının bir istasyona bağlı olduğundan emin olun.",
  },
  {
    // Backend bu hatayı iki ayrı biçimde üretir:
    //   "Baglanti kaynagi bilinmiyor: 'X'"        (şema doğrulaması)
    //   "Baglanti hedefi 'X' tanimli degil. ..."  (motor doğrulaması)
    // İkincisinde istasyon adı araya girdiği için desen bitişik eşleşme
    // aramaz; iki biçim de aynı kullanıcı mesajına çevrilir.
    match: /baglanti (kaynagi|hedefi).*(bilinmiyor|tanimli degil)/i,
    message:
      "Bir bağlantı, var olmayan bir istasyona gidiyor. Lütfen bağlantıları kontrol edin.",
  },
  {
    match: /unknown station reference/i,
    message:
      "Bir bağlantı, var olmayan bir istasyona gidiyor. Lütfen bağlantıları kontrol edin.",
  },
  {
    match: /yonlendirme olasiliklari toplami/i,
    message: "Bir istasyondan çıkan yolların toplam olasılığı %100'ü geçemez.",
  },
  {
    match: /routing probability sum/i,
    message: "Bir istasyondan çıkan yolların toplam olasılığı %100'ü geçemez.",
  },
  {
    match: /yinelenen istasyon kimlikleri/i,
    message:
      "Aynı kimliğe sahip birden fazla istasyon var. Her istasyonun adı benzersiz olmalı.",
  },

  // --- İş yükü sınırı ---
  {
    match: /istek cok buyuk/i,
    message:
      "Bu senaryo çok büyük. Simülasyon süresini kısaltın, tekrar sayısını azaltın veya istasyon sayısını düşürün.",
  },
  {
    match: /en fazla \d+ senaryo/i,
    message: "Aynı anda karşılaştırılabilecek senaryo sayısı sınırlı. Daha az senaryo seçin.",
  },

  // --- Zaman parametreleri ---
  {
    match: /isinma periyodu/i,
    message:
      "Isınma süresi, toplam simülasyon süresinden kısa olmalı. Simülasyon süresi ayarını kontrol edin.",
  },

  // --- Arıza modeli ---
  {
    match: /ariza modeli eksik/i,
    message:
      "Arıza ayarları yarım kalmış. Hem ortalama arıza aralığını hem de ortalama onarım süresini girin ya da ikisini de boş bırakın.",
  },
  {
    match: /failure_rate' pozitif olmalidir/i,
    message: "Ortalama arıza aralığı sıfırdan büyük olmalı.",
  },

  // --- Dağılım parametreleri ---
  {
    match: /ucgen dagilimda min <= mode <= max/i,
    message:
      "Süre tahminleri sıralı değil. En hızlı süre ≤ en olası süre ≤ en yavaş süre olmalı.",
  },
  {
    match: /ucgen dagilimda min == max/i,
    message:
      "En hızlı ve en yavaş süre aynı girilmiş. Süre hiç değişmiyorsa “Sabit” seçeneğini kullanın.",
  },
  {
    match: /ustel dagilimda 'mean' pozitif olmalidir/i,
    message: "Ortalama işlem süresi sıfırdan büyük olmalı.",
  },
  {
    match: /normal dagilimda 'std' pozitif olmalidir/i,
    message:
      "Sapma değeri sıfırdan büyük olmalı. Süre hiç değişmiyorsa “Sabit” seçeneğini kullanın.",
  },
  {
    match: /negatif olamaz \(sure modeli\)/i,
    message: "Süre değerleri negatif olamaz.",
  },
  {
    match: /dagilimi '(\w+)' parametresini gerektirir/i,
    message: "Bir işlem süresi ayarı eksik kalmış. İstasyon parametrelerini kontrol edin.",
  },

  // --- Kayıt bulunamadı ---
  {
    match: /kimlikli simulasyon bulunamadi/i,
    message:
      "Bu simülasyon sonucu artık bulunamıyor. Sunucu yeniden başlatılmış olabilir; simülasyonu tekrar çalıştırın.",
  },

  // --- Pydantic'in genel alan hataları ---
  {
    match: /input should be greater than or equal to/i,
    message: "Bir değer izin verilen alt sınırın altında. Parametreleri kontrol edin.",
  },
  {
    match: /input should be greater than/i,
    message: "Bir değer sıfırdan büyük olmalı. Parametreleri kontrol edin.",
  },
  {
    match: /input should be less than or equal to/i,
    message: "Bir değer izin verilen üst sınırın üzerinde. Parametreleri kontrol edin.",
  },
  {
    match: /field required|missing/i,
    message: "Zorunlu bir alan boş bırakılmış. Lütfen tüm alanları doldurun.",
  },
];

/** Ağ katmanı hataları için (backend'e hiç ulaşılamadığında). */
export const NETWORK_ERROR_MESSAGE =
  "Sunucuya ulaşılamıyor. Simülasyon servisinin çalıştığından emin olun, sonra tekrar deneyin.";

/** Hiçbir desene uymayan hatalar için. */
export const GENERIC_ERROR_MESSAGE =
  "Beklenmeyen bir sorun oluştu. Modelinizi gözden geçirip tekrar deneyin.";

/**
 * Tek bir ham hata metnini kullanıcı diline çevirir.
 *
 * Eşleşme bulunamazsa `null` döner; çağıran taraf o zaman genel mesajı
 * kullanır. Ham metni kullanıcıya asla göstermeyiz.
 */
export function translateErrorDetail(rawDetail: string): string | null {
  for (const translation of TRANSLATIONS) {
    const matched =
      typeof translation.match === "string"
        ? rawDetail.toLowerCase().includes(translation.match.toLowerCase())
        : translation.match.test(rawDetail);
    if (matched) {
      return translation.message;
    }
  }
  return null;
}

/**
 * Ham hata metinleri listesini kullanıcıya gösterilecek mesajlara çevirir.
 *
 * Aynı mesaja çevrilen birden çok ham hata tekrarlanmaz: kullanıcı, altı farklı
 * alandan gelen aynı uyarıyı altı kez görmemelidir.
 */
export function translateErrorDetails(rawDetails: string[]): string[] {
  const translated = rawDetails
    .map(translateErrorDetail)
    .filter((message): message is string => message !== null);

  const unique = [...new Set(translated)];
  return unique.length > 0 ? unique : [GENERIC_ERROR_MESSAGE];
}

/**
 * Kararsızlık uyarılarını kısaltarak kullanıcıya uygun hâle getirir.
 *
 * Backend uyarıları ayrıntılı ve teknik terimlidir (rho, M/M/1/K). Arayüzde
 * yalnızca eyleme dönük özet gösterilir; ayrıntı sonuç sayfasına bırakılır.
 */
export function summarizeWarning(rawWarning: string): string {
  if (/kararsiz sistem/i.test(rawWarning)) {
    return "Bir istasyon, kendisine gelen işi yetiştiremiyor. Kuyruk sürekli büyüyecek — o istasyona makine ekleyin, işlem süresini kısaltın ya da parça giriş sıklığını azaltın.";
  }
  if (/kapasite sinirli/i.test(rawWarning)) {
    const percentMatch = rawWarning.match(/yaklasik %([\d.,]+)'i sisteme alinamayacak/i);
    const percent = percentMatch ? percentMatch[1] : null;
    return percent
      ? `Bir istasyon dolduğu için gelen parçaların yaklaşık %${percent}'i sisteme alınamayacak. Kapasiteyi artırmak çıktıyı yükseltir.`
      : "Bir istasyon dolduğu için gelen parçaların bir kısmı sisteme alınamayacak. Kapasiteyi artırmak çıktıyı yükseltir.";
  }
  if (/yalnizca \d+ replikasyon/i.test(rawWarning)) {
    return "Sonucun güven aralığı geniş olabilir. Daha kesin sonuç için “Detaylı” simülasyon seçeneğini kullanın.";
  }
  if (/little's law/i.test(rawWarning)) {
    return "Sonuçların iç tutarlılık denetimi beklenenin dışında kaldı. Sonuç sayfasındaki doğrulama raporuna bakın.";
  }
  if (/bagil kesinligi/i.test(rawWarning)) {
    return "Tahmin aralığı geniş. Daha kesin sonuç için simülasyon süresini uzatın.";
  }
  return rawWarning;
}
