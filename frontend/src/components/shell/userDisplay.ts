/**
 * Kullanıcıyı ekranda adlandırmaya yarayan küçük saf işlevler.
 *
 * Bileşen dosyasından ayrı durmaları bilinçlidir: bir modül hem bileşen hem
 * de başka değerler dışa aktardığında Vite'ın hızlı yenilemesi (fast refresh)
 * o dosya için devre dışı kalır ve geliştirme sırasında her düzenlemede tüm
 * sayfa yeniden yüklenir.
 */

/**
 * Saate göre karşılama.
 *
 * Command Center'ın ilk satırıdır ve ürünün "bu benim için hazırlanmış bir
 * çalışma alanı" hissini kuran en ucuz ayrıntıdır.
 */
export function greeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 6) return "İyi geceler";
  if (hour < 12) return "Günaydın";
  if (hour < 18) return "İyi günler";
  return "İyi akşamlar";
}

/**
 * E-postadan gösterilecek kısa ad üretir.
 *
 * Yalnızca `@` öncesinin ilk parçası alınır: "kagan.kara@ornek.com" için
 * "Kagan". E-posta yoksa boş metin döner ve çağıran taraf selamlamayı adsız
 * gösterir — uydurma bir ad, kişiselleştirmeyi bozar.
 */
export function displayName(email: string | null): string {
  if (!email) {
    return "";
  }
  const local = email.split("@")[0];
  const first = local.split(/[.\s_-]+/).filter(Boolean)[0] ?? local;
  return first.charAt(0).toLocaleUpperCase("tr-TR") + first.slice(1);
}

/** Avatar için en çok iki harf. E-posta yoksa organizasyon adına düşülür. */
export function initialsOf(email: string | null, orgName: string): string {
  const source = email?.split("@")[0] || orgName;
  const parts = source.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
