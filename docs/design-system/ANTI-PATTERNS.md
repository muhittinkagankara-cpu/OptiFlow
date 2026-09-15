# OptiFlow Anti-Desenleri

> [MASTER.md](MASTER.md)'nin kardeş belgesi. MASTER "ne yapılacak" der; bu belge
> "ne yapılmayacak" der ve her maddeyi **uygulamada gerçekten görülmüş bir
> örnekle** kanıtlar.
>
> Buradaki "Nerede görüldü" satırları, uygulamanın yerelde çalıştırılıp
> 1440px ve 375px'te incelendiği tarihte doğrudur. Bir madde düzeltildiğinde o
> satır "düzeltildi — Sprint X" olarak güncellenir; madde silinmez, çünkü
> anti-desenin kendisi kalıcı bir kuraldır.

Her madde şu yapıdadır: **Nasıl görünür → Neden yanlış → Nerede görüldü →
Doğrusu.**

---

## 1. Kart enflasyonu (card inflation)

**Nasıl görünür.** Ekrandaki her bilgi parçası kendi kenarlıklı, yuvarlatılmış
yüzeyine konur. Sayfa, birbirinden bağımsız kutuların gridi hâline gelir.

**Neden yanlış.** Kutu bir gruplama aracıdır. Her şey kutudaysa hiçbir şey
gruplanmamıştır — kullanıcı neyin neyle ilişkili olduğunu okuyamaz. Ayrıca her
kenarlık göze bir çizgi daha ekler; on sekiz kutu, on sekiz çizgi demektir ve
sayfanın kendisi gürültüye dönüşür.

**Nerede görüldü.** Command Center'da tek ekranda yaklaşık **18** kenarlıklı
yuvarlak yüzey: demo şeridi, kurulum çip bloğu, kurulum listesi, 4 KPI kartı, AI
Morning Brief kartı, onun içindeki 3 kutu, yapılacaklar bloğu, 5 sağlık mini
kartı, son koşumlar bloğu.

**Doğrusu.** Yüzey sayısı ekran başına en fazla üç-dört. Gruplama `Panel` içinde
**hairline** ile yapılır. Bir bilgi kendi kutusunu ancak bağımsız bir bağlam ise
hak eder.

---

## 2. İç içe kart (nested cards)

**Nasıl görünür.** Bir kartın içinde ikinci bir kenarlıklı yüzey, onun içinde
üçüncüsü. Üç seviye yuvarlak dikdörtgen.

**Neden yanlış.** Her seviye bir kenarlık, bir dolgu ve bir yuvarlaklık ekler;
içerik için kalan alan daralırken görsel karmaşa artar. Derinlik hiyerarşi
kurmaz — kutu sayısı arttıkça hiyerarşi **kaybolur**.

**Nerede görüldü.** Command Center'daki "AI Morning Brief" kartının içinde "EN
KRİTİK İSTASYON", "BUGÜNKÜ ÖNERİ" ve "RİSK" için üç ayrı kenarlıklı kutu.

**Doğrusu.** **İç içe kart yasaktır.** Panel içi bölümleme tam-bleed hairline
ile yapılır.

---

## 3. Çıplak metrik (naked metric)

**Nasıl görünür.** Büyük bir sayı, küçük bir etiket, başka hiçbir şey. `%74`,
`778 birim`, `₺178.772`.

**Neden yanlış.** Kullanıcı veriye bakmak istemiyor; ne yapması gerektiğini
bilmek istiyor. Sonucunu taşımayan bir sayı, kullanıcıyı yorumlama işiyle baş
başa bırakır — oysa yorumlama ürünün işidir. Bu, **Yasa 2**'nin doğrudan ihlali.

**Nerede görüldü.** Command Center'daki dört KPI kartı; Simülasyon Sonucu'ndaki
"ORTALAMA AKIŞ SÜRESİ 5.3 dk" ve "ORTALAMA WIP 8.5 parça" kutuları.

**Doğrusu.** Her önemli sayı bir sonuç taşır: kapasite payı, para, eşik, çıktı
ya da eylem. Taşıyamıyorsa ekrandan çıkar.

---

## 4. Dekoratif grafik (decorative chart)

**Nasıl görünür.** Ölçeği okunamayan mini çizgiler; tek bir sayıyı göstermek
için kullanılan büyük ibreli göstergeler; eksensiz, etiketsiz, eşiksiz
sparkline'lar.

**Neden yanlış.** Grafik pahalı bir öğedir: yer kaplar, dikkat çeker, okuma
maliyeti yaratır. Karşılığında bir karşılaştırma ya da eğilim vermiyorsa, o
grafik süstür. Süs, bu üründe bilgiye ayrılmış alanı çalar.

**Nerede görüldü.**
- Simülasyon Sonucu: kırmızı-sarı-yeşil ibreli hız göstergesi, viewport
  genişliğinin ~%30'unu tek bir sayı (%74.4) için harcıyor.
- Canlı Üretim: altı mini KPI kartında altı etiketsiz, eksensiz sparkline.

**Doğrusu.** Gauge yasaktır. Sparkline ancak eşik çizgisi, ölçek ve etiket
taşıyorsa kalır; taşımıyorsa silinir. Karşılaştırma bar ile yapılır ve değer
barın ucunda yazılır.

---

## 5. Genel amaçlı AI sohbet düzeni (generic AI chatbot layout)

**Nasıl görünür.** Ortalanmış parıltı ikonu, "Bana bir soru sorun" başlığı, iki
sütunlu öneri çipleri, altta geniş bir metin alanı, etrafında bol boşluk.

**Neden yanlış.** Bu düzen ürüne ait değildir — herhangi bir AI ürününe
yapıştırılabilir. Daha kötüsü, kullanıcıya iş yükler: soru üretmek zorunda
kalır. OptiFlow'un zaten bir cevabı vardır; sohbet kutusu bu cevabı saklar.

**Nerede görüldü.** AI Copilot ekranı: ortada parıltı ikonu + "Fabrikanız
hakkında bir soru sorun" + sekiz öneri çipi; ekranın ~%40'ı boş. Üstteki dört
durum kartından üçü ilk açılışta "—" gösteriyor. Henüz var olmayan bir sohbet
için PDF/TXT/Temizle düğmeleri duruyor.

**Doğrusu.** AI bir **öneri katmanıdır**, bir sohbet kutusu değil. Açılışta
uygulanabilir aksiyon listesi gelir; her öneri parasını, güvenini, gerekçesini
ve tek bir düğmesini taşır. Serbest sohbet ikinci sekmedir. Öneri
üretilemiyorsa **nedeni yazılır**.

---

## 6. Renkli ikon kabı (colored icon container)

**Nasıl görünür.** İkon, kendi renkli, yuvarlatılmış kare kabının içinde durur;
kabın rengi kartın temasını tekrarlar.

**Neden yanlış.** Bu, şablon panosu görünümünün bir numaralı işaretidir. Kap
hiçbir bilgi taşımaz; yalnızca renk ekler ve **Yasa 3**'ü ihlal eder (renk
ölçüm değil, dekorasyon olur). Ayrıca her kartın kendi rengi olduğunda renk
ayırt edici olmaktan çıkar.

**Nerede görüldü.** Command Center'da 4, Finans'ta 4, AI Copilot'ta 1 kez.

**Doğrusu.** İkon çıplak durur, 16px, `ink-3` renginde. Durum taşıyorsa rengini
durumdan alır — kaptan değil.

---

## 7. Aşırı yuvarlaklık (excessive rounding)

**Nasıl görünür.** 16px, 20px, 28px köşeler. Küçük çipler bile yumuşak.

**Neden yanlış.** Yuvarlaklık bir ton kararıdır. Yüksek yarıçap "tüketici
uygulaması, arkadaş canlısı, yumuşak" der. OptiFlow'un söylemesi gereken
"hassas, ölçülmüş, endüstriyel"dir. Enstrümanlar keskindir.

**Nerede görüldü.** `--radius-xl: 16px` uygulamada en çok kullanılan yarıçap;
ölçüldü: `rounded-lg` 282, `rounded-xl` 174, `rounded-2xl` 43 kullanım.

**Doğrusu.** xs 3 / sm 5 / md 8 / lg 12 / full. Ölçeğin üstü yoktur.

---

## 8. Gradient KPI kartı (gradient KPI card)

**Nasıl görünür.** Her KPI kartının kendi renkli gradient yıkaması vardır: biri
mavi, biri yeşil, biri kırmızı, biri amber.

**Neden yanlış.** Zemin rengi bir **ölçüm** gibi okunur ama değildir — "aylık
kayıp" kartının kırmızı olması, kaybın eşiği aştığı anlamına gelmez, yalnızca
kaybın adının "kayıp" olmasından gelir. Bu, kullanıcıyı sistematik olarak
yanıltır ve **Yasa 3**'ü ihlal eder. Ayrıca dört farklı renkli kutu, ekranın en
gürültülü bandını yaratır.

**Nerede görüldü.** Command Center'ın dört KPI kartı; Finans'ın dört KPI kartı.
Ölçüldü: kodda 9 `bg-gradient-to-*` kullanımı.

**Doğrusu.** Nötr yüzey; değerler hairline ile ayrılır. Renk yalnızca ölçülmüş
bir eşik aşımını gösterir. Para değeri `value-ink` **mürekkebiyle** yazılır —
zeminle değil.

---

## 9. Bilgi tekrarı (duplicate information)

**Nasıl görünür.** Aynı olgu bir ekranda birden çok kez, farklı biçimlerde
tekrarlanır.

**Neden yanlış.** Tekrar, okuyucuya "bu farklı bir bilgi mi?" diye
sordurur; her tekrar bir tarama maliyeti yaratır ve hiçbiri yeni bir şey
söylemez. Yer kaplayan tekrar, gerçekten eksik olan bilginin (ne yapmalıyım?)
yerini alır.

**Nerede görüldü.**
- Simülasyon Sonucu'nda "darboğaz Torna" **dört kez**: gösterge altındaki özet
  şeridi, düz metin paragrafı, tablodaki kırmızı satır ve özet cümlesi. "%74.4"
  **üç kez**.
- Command Center'da aynı 7 maddelik kurulum listesi **iki ayrı blokta**: bir kez
  çip satırı, bir kez tam liste.

**Doğrusu.** Bir olgu bir ekranda **en fazla iki** yerde görünür: bir kez özet
düzeyinde, bir kez ayrıntı düzeyinde. Üçüncüsü silinir.

---

## 10. Anlamsız animasyon (meaningless animation)

**Nasıl görünür.** Nefes alan kutular, tarama çizgileri, dalgalanan kuyruklar,
nabız atan ikonlar — hiçbiri bir durum değişimini bildirmiyor.

**Neden yanlış.** Hareket dikkat çeker; dikkat sınırlı bir kaynaktır. Bir şey
hareket ediyorsa kullanıcı ona bakar. Bakması gereken bir şey yoksa, hareket
onun dikkatini çalmıştır. Operasyonel bir üründe bu doğrudan bir maliyet.

**Nerede görüldü.** `index.css` içinde **21 `@keyframes`**; bunların bir kısmı
(`optiflow-scanline`, `optiflow-queue-wave`, `optiflow-icon-pulse`,
`optiflow-machine-breathe`, `optiflow-drop-pulse`) bir durum değişimi
bildirmiyor.

**Doğrusu.** Ürünün tamamında **altı** izinli hareket vardır (MASTER §3.7). Bir
animasyon ancak şunlardan birini yapıyorsa kalır: bir durum değişimini bildirir,
bir mekânsal ilişkiyi korur, ya da bir sürecin devam ettiğini gösterir.

---

## 11. Pano şablonu yerleşimi (dashboard template layout)

**Nasıl görünür.** Üstte dört KPI kartı, altında iki sütun grafik, altında bir
tablo. Herhangi bir üründe görebileceğiniz yerleşim.

**Neden yanlış.** Şablon yerleşimi, içeriğin **ne olduğundan bağımsız** bir
karardır. OptiFlow'un ekranları birbirinden farklı sorular cevaplıyor; hepsini
aynı ızgaraya dökmek, her sorunun cevabını aynı biçimde vermek demektir. Sonuç:
hiçbir ekran kendi işine göre optimize edilmemiş olur.

**Nerede görüldü.** Command Center ve Finans aynı yerleşimi paylaşıyor (4 KPI →
içerik), oysa biri "bugün ne yapmalıyım", diğeri "ne kadar para kaybediyorum"
sorusunu cevaplıyor.

**Doğrusu.** Her ekran **Yasa 1** ile açılır: o ekranın kendi durum cümlesi.
Yerleşim cümlenin gerektirdiği şekilde kurulur; KPI şeridi cümleye hizmet eder,
tersi değil.

---

## 12. Tutarsız sayfa genişliği (inconsistent page width)

**Nasıl görünür.** Sayfa değiştikçe içerik bloğu genişler ya da daralır; kenar
boşlukları zıplar.

**Neden yanlış.** Kabuk sabit durmalıdır. Genişlik zıplaması, kullanıcıya her
gezinmede "yeni bir uygulamaya girdim" hissi verir ve gözün dayanak noktalarını
bozar. Premium algısının en sessiz düşmanıdır.

**Nerede görüldü.** Ölçüldü: sekiz farklı `max-w-*` değeri kullanımda —
`max-w-3xl` (13), `max-w-md` (10), `max-w-5xl` (10), `max-w-7xl` (8),
`max-w-6xl` (7), `max-w-2xl` (5), `max-w-xl` (4) ve adlandırılmamış bir tane.

**Doğrusu.** Tek bir maksimum içerik genişliği: **1440px**, `PageShell`
tarafından uygulanır. İstisna gerekiyorsa gerekçesi belgeye yazılır.

---

## 13. Spinner öncelikli yükleme (spinner-first loading)

**Nasıl görünür.** Boş bir alan, ortasında dönen bir daire. Veri gelince
içerik birden belirir ve düzen zıplar.

**Neden yanlış.** Spinner "bekle" der ama "ne bekliyorsun" demez. Kullanıcı ne
geleceğini bilmediği için bekleme süresi daha uzun hissedilir. Ayrıca içerik
gelince oluşan düzen kayması, bir sonraki tıklamanın hedefini kaydırır.

**Nerede görüldü.** Ölçüldü: kodda `Skeleton` / `animate-pulse` **sıfır**
kullanım. Tek yükleme göstergesi `Primitives.tsx` içindeki `Spinner`.

**Doğrusu.** Şekil eşlemeli iskelet: gelecek içeriğin ölçüsünü ve biçimini
önceden gösterir. Spinner yalnızca düğme içinde ve kullanıcı tetikli kısa
işlemde kalır. **Sayfa yüklemesi asla spinner görmez.**

---

## 14. Gizli gerekçe (hidden provenance)

**Nasıl görünür.** Bir öneri ya da skor gösterilir; nereden geldiği, hangi
girdilerle hesaplandığı, ne kadar veriye dayandığı görünmez.

**Neden yanlış.** Gerekçesiz öneri bir kehanettir. Üretim müdürü bir makineye
yatırım yapmadan önce sayının nereden geldiğini bilmek zorundadır; bilemezse
öneriyi uygulamaz ve ürün değersizleşir. Bu ürünün sattığı şey sayı değil,
**hesap**tır.

**Nerede görüldü.** AI Morning Brief "Torna kapasitesini artırın" diyor; hangi
koşumdan, hangi girdilerle, ne kadar belirsizlikle üretildiği ekranda yok.
Yanında yalnızca "Önizleme · modele bağlı değil" rozeti var — bu bir gerekçe
değil, bir sorumluluk reddi.

**Doğrusu.** Her öneri `provenance` taşır: kaynak, kullanılan girdiler, yöntem,
örneklem, hesaplanma zamanı ve **ölçülemeyenler**. "Nasıl hesaplandı?" ekrandan
ayrılmadan, tek tıkla açılır.

---

## 15. Uydurulmuş ölçüm (fake / invented measurement)

**Nasıl görünür.** Hesaplanamayan bir metrik sıfır olarak gösterilir; eksik veri
varsayılan bir değerle doldurulur; "veri yok" yerine inandırıcı bir sayı çıkar.

**Neden yanlış.** Bu, üründeki tek onarılamaz hata sınıfıdır. Yanlış bir sayı,
eksik bir sayıdan **kötüdür**: kullanıcı yanlış sayıya göre karar verir ve
hatanın kaynağını asla bulamaz. Maliyet oranları girilmeden "aylık kaybınız ₺0"
demek, hiçbir şey dememekten kötüdür.

**Nerede görüldü.** Bu anti-desen uygulamada **görülmedi** — ürün bu konuda
tutarlı biçimde doğru davranıyor. Madde, kazanılmış bir davranışı korumak için
buradadır.

**Doğrusu.** `null` → "—" artı nedeni artı, mümkünse ölçümü tamamlayacak eylem.
Sıfır asla yer tutucu değildir. **Yasa 4.**

---

## 16. Akordeon çorbası (accordion soup)

**Nasıl görünür.** Sayfanın altında art arda, eşit görünümlü, hepsi kapalı,
başlık + alt başlık + ok işareti taşıyan açılır bloklar.

**Neden yanlış.** Hepsi aynı ağırlıkta olduğu için hiçbiri öne çıkmaz; kapalı
oldukları için içeriklerini söylemezler. Kullanıcı ne bulacağını bilmeden
tıklamak zorunda kalır — bu bir keşif maliyetidir ve genellikle kimse tıklamaz.

**Nerede görüldü.** Simülasyon Sonucu'nun altında **beş** kapalı akordeon: "Akış
ve Kayıp Analizi", "Finansal Etki", "Canlı Akışı Gör", "Doğrulama ve
güvenilirlik", "Bir değişikliğin işe yarayıp yaramadığını ölçün".

**Doğrusu.** Üç ya da daha az adlandırılmış **sekme**. Sekme, içeriğin var
olduğunu ve nerede olduğunu söyler; kapalı akordeon söylemez.

---

## 17. Form öncelikli ekran (form-first screen)

**Nasıl görünür.** Sonuç ekranı, boş girdi alanlarıyla açılır. Kullanıcı bir şey
görmeden önce emek harcamak zorundadır.

**Neden yanlış.** Kullanıcı o ekrana **cevap** için gelir, veri girmek için
değil. Boş form, ürünün vaadini kullanıcının işine çevirir. Ayrıca kullanıcı
karşılığında ne alacağını görmediği için formu doldurma motivasyonu düşüktür.

**Nerede görüldü.** Finans ekranı altı boş maliyet alanı, üç vardiya düğmesi ve
devre dışı bir "Kaybı hesapla" düğmesiyle açılıyor; KPI'lar formun altında
kalıyor.

**Doğrusu.** Sayfa **daima sonuçla** açılır. Girdi bir çekmeceye taşınır. Girdi
eksikse sonuç alanı "—" gösterir ve eksik ölçümü tamamlayacak eylemi sunar —
ama yerleşim değişmez.

---

## 18. Çöken boş bölge (empty region collapse)

**Nasıl görünür.** Bir bölüm ekranın yarısını kaplar ama içi boştur; yalnızca
küçük bir "içerik yok" rozeti vardır.

**Neden yanlış.** Boş alan bir tasarım aracıdır ama **ayrılmış ve kullanılmayan**
alan bir hatadır. Ekranın yarısının boş olması, ürünün çalışmadığı izlenimi
verir.

**Nerede görüldü.** Command Center'da "Bugün Yapılacaklar" bölümü ekranın %50
genişliğini kaplıyor ve içi boş ("Acil konu yok"). Canlı Üretim'de akış
canvas'ının ~%70'i boş.

**Doğrusu.** Boş durumda bölüm ya **daralır** ya da kendi `EmptyState`'ini
sunar. Izgara, içeriği olmayan bir bölüme genişlik ayırmaz.

---

## 19. Eşit ağırlıklı birincil düğmeler (competing primaries)

**Nasıl görünür.** Aynı ekranda üç dolu mavi düğme yan yana.

**Neden yanlış.** Birincil düğme "önerilen yol budur" der. Üç tane varsa hiçbiri
bunu söylemiyordur; kullanıcı seçim maliyetini kendisi üstlenir.

**Nerede görüldü.** Raporlar ekranında üç kart, üçünde de birincil "İndir"
düğmesi.

**Doğrusu.** Bir ekran bölgesinde **en fazla bir** `primary`. Diğerleri
`secondary`.

---

## 20. Tam genişlik uyarı bandı (full-width warning band)

**Nasıl görünür.** Sayfanın üstünde, tam genişlikte, amber ya da kırmızı bir
şerit; kalıcı bir bilgiyi taşıyor ama hata gibi görünüyor.

**Neden yanlış.** Kalıcı bir durum bilgisi, geçici bir uyarı diliyle
söyleniyor. Kullanıcı ilk gün okur, ikinci gün görmez; üçüncü gün gerçek bir
uyarı çıktığında onu da görmez. Uyarı rengi enflasyona uğrar.

**Nerede görüldü.** Canlı Üretim'de "Benzetim — Ekrandaki veri üretilmiş bir
senaryodan geliyor; cihazdan değil." tam genişlik amber bant.

**Doğrusu.** Kalıcı köken bilgisi bir **rozettir** (`OriginBadge`), bant değil;
başlığın yanında durur ve gürültü üretmez. Dürüstlük korunur, alarm dili
harcanmaz.

---

## 21. Selamlama kahraman olarak (greeting as hero)

**Nasıl görünür.** Sayfanın en büyük yazısı "Günaydın, [ad]".

**Neden yanlış.** Ekranın en büyük tipografisi, en çok bilgi taşıyan öğeye
aittir. Selamlama sıfır bilgi taşır. Tipografik hiyerarşi, bilgi hiyerarşisiyle
çelişirse kullanıcı yanlış yere bakar.

**Nerede görüldü.** Command Center'da "Günaydın Demo kullanıcısı" sayfanın en
büyük yazısı; operasyonel içerik altında ve daha küçük.

**Doğrusu.** Selamlama üst çubuğa iner, `body` boyutunda. En büyük yazı **Yasa
1**'in durum cümlesidir.

---

## 22. Token dışı renk (off-token color)

**Nasıl görünür.** Bir grafik ya da bileşen, tasarım sisteminde bulunmayan bir
renk kullanır — genellikle kütüphanenin varsayılanı.

**Neden yanlış.** Token dışı renk, sistemin tek noktadan yönetilmesini
imkânsızlaştırır. Tema değiştiğinde ya da kontrast düzeltmesi yapıldığında o
renk geride kalır ve yamalı bir arayüz doğar.

**Nerede görüldü.** Simülasyon Sonucu'ndaki "Doluluk karşılaştırması" bar
grafiği mor/indigo bar kullanıyor; token'larda böyle bir renk yok — Recharts
varsayılanı.

**Doğrusu.** Grafik renkleri MASTER §6.1'deki **doğrulanmış** paletten gelir.
Yeni renk gerekiyorsa önce belgeye eklenir ve doğrulayıcıdan geçirilir.

---

## 23. Yalnızca renkle taşınan durum (color-only state)

**Nasıl görünür.** Bir satır ya da rozet durumunu yalnızca renkle bildirir;
etiket, ikon ya da geometri yok.

**Neden yanlış.** Renk körlüğü olan kullanıcı durumu okuyamaz; gri tonlamalı
çıktıda bilgi tümüyle kaybolur. Ayrıca koyu zeminde doygun renkler birbirine
yaklaşır.

**Nerede görüldü.** Bu konuda ürün büyük ölçüde **doğru davranıyor** — kenar
çubuğundaki aktif bölüm hem mavi zemin hem sol dikey çizgiyle işaretleniyor,
darboğaz satırı hem kırmızı hem "Darboğaz" etiketi taşıyor. Madde, bu kazanılmış
davranışı korumak için buradadır.

**Doğrusu.** Durum en az **iki** sinyalle taşınır: renk + (etiket veya ikon veya
geometri). `ConstraintRail` bu kuralın en saf uygulamasıdır — kısıt üç sinyalle
işaretlenir.

---

## Hızlı denetim listesi

Bir arayüz değişikliğini bitirmeden önce:

- [ ] Ekranda kaç kenarlıklı yüzey var? (hedef: ≤4)
- [ ] İç içe kart var mı? (olmamalı)
- [ ] Her önemli sayı bir sonuç taşıyor mu?
- [ ] Renkli bir zemin bir ölçümü mü gösteriyor, yoksa süs mü?
- [ ] Ekranın en büyük yazısı en çok bilgi taşıyan şey mi?
- [ ] Aynı olgu üç kez tekrarlanıyor mu?
- [ ] Yükleme durumu iskelet mi, spinner mı?
- [ ] Ölçülemeyen değer "—" ve nedeni ile mi gösteriliyor?
- [ ] Ekranda kaç birincil düğme var? (hedef: 1)
- [ ] Sayfa genişliği diğer sayfalarla aynı mı?
- [ ] Durum yalnızca renkle mi taşınıyor?
- [ ] 375px'te gerçek tarayıcıda bakıldı mı?
