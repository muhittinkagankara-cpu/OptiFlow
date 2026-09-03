"""Finansal kayıp katmanı: mevcut simülasyon metriklerini paraya çevirir.

Bu paket simülasyon matematiğine **dokunmaz**. `core/` ve `analytics/`
katmanlarının ürettiği ölçümleri (arıza dakikası, bloke dakika, hurda adedi,
tahmini kayıp birim) okur ve bunları maliyet oranlarıyla çarparak parasal
karşılığını verir. Tüm işlevler saftır: girdi olarak metrik ve ayar alır,
çıktı olarak sayı döndürür; veritabanı, HTTP ya da global durum kullanmaz.
"""
