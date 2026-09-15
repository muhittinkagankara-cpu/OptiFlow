/**
 * Sonuç sayfasını kapatan adım (Yasa 5, Sprint 2G-E).
 *
 * Sayfa "simülasyon ne gösterdi?" sorusunu yanıtlıyordu ama en altta yalnızca
 * 16 piksellik gri bir bağlantı vardı: "Yeni bir model kur". Bu, sonucun
 * karar zinciriyle ilgisi olmayan genel bir çıkıştı — okuduğu kısıtla hiçbir
 * bağı yoktu.
 *
 * ## Burada üretilmeyen şeyler
 *
 * Bu dosya **öneri üretmez**. Ne kadar kazanılacağını, üretimin ne kadar
 * artacağını, hangi senaryonun kazandığını söylemez; bunların hiçbirinin
 * arkasında hesap yoktur. Yaptığı tek şey, koşumun **zaten ölçtüğü** kısıt
 * bilgisini bir cümleye çevirip kullanıcıyı var olan bir ekrana yöneltmektir.
 *
 * Cümle, modelin ne yapılabileceğini anlatır ("kapasiteyi ya da işlem
 * süresini değiştirip yeniden çalıştırabilirsiniz") — bir sonuç **vaat
 * etmez**. Aradaki fark, ürünün dürüstlük sözleşmesinin tam merkezidir.
 */

/** Kapanış bölümünün metni ve eylem etiketi. */
export interface ResultsClosing {
  /** Tek cümlelik bağlam; ölçülmüş olandan fazlasını iddia etmez. */
  text: string;
  /** Var olan bir gezinme hedefinin etiketi. */
  actionLabel: string;
}

/**
 * Kapanış adımını kurar.
 *
 * Kısıt istasyonu biliniyorsa cümle onu adıyla anar; bilinmiyorsa bir istasyon
 * **uydurulmaz**, durum olduğu gibi söylenir. Her iki hâlde de eylem aynıdır,
 * çünkü modeli açmak koşum sonrası her zaman geçerli ve var olan adımdır —
 * yeni bir hedef üretilmedi.
 */
export function resultsClosing(
  bottleneckStationName: string | null | undefined,
): ResultsClosing {
  const name =
    typeof bottleneckStationName === "string" && bottleneckStationName.trim()
      ? bottleneckStationName.trim()
      : null;

  return {
    text:
      name === null
        ? "Bu koşumda kısıt istasyonu belirlenemedi. Modeli açıp istasyonları ve bağlantıları gözden geçirebilir, koşumu yineleyebilirsiniz."
        : `${name} bu koşumda hattın kısıtı olarak ölçüldü. Modeli açıp bu istasyonun kapasitesini ya da işlem süresini değiştirip koşumu yineleyebilirsiniz.`,
    actionLabel: "Modeli düzenle",
  };
}
