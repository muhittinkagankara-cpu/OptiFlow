# OptiFlow Tasarım Sistemi — Ana Belge

> Bu belge OptiFlow arayüzünün **kalıcı tasarım otoritesidir**. Arayüzle ilgili
> bir karar bu belgeyle çelişiyorsa, belge kazanır. Belgeyi değiştirmek bir
> tasarım kararıdır ve §24'teki yordamı izler.
>
> Kardeş belge: [ANTI-PATTERNS.md](ANTI-PATTERNS.md) — burada "yapılacak" yazan
> her şeyin karşısındaki "yapılmayacak" listesi.

---

## 0. UYARI — bu belge hedefi anlatır, mevcut durumu değil

Bu belgedeki token değerlerinin **çoğu henüz koda uygulanmadı.** Belge, yazıldığı
anda çalışan uygulamanın incelenmesiyle üretilmiş bir **hedef tanımıdır**.

Her bölümde durum işareti bulunur:

| İşaret | Anlamı |
| --- | --- |
| 🟢 | Kodda uygulandı, `frontend/src/index.css` veya `Primitives.tsx` içinde var |
| 🟡 | Kısmen var; adı ya da değeri farklı, uyumlandırma gerekiyor |
| 🔴 | Hedef; **henüz kodda yok**, varmış gibi kullanılamaz |

Kırmızı işaretli bir token'ı koda yazmadan önce ilgili sprint'te tanımlanması
gerekir. Bir bileşen `var(--of-surface-1)` yazıyorsa ve token tanımlı değilse,
tarayıcı sessizce hiçbir şey çizmez — bu, en pahalı hata sınıfıdır.

### Sprint 1A sonrası: "tanımlı" ile "tüketiliyor" ayrı şeylerdir

Sprint 1A, §3'teki **bütün `--of-*` token'larını** `frontend/src/index.css`
içinde tanımladı. Artık hepsi tarayıcıda çözülüyor ve yeni kod güvenle
kullanabilir.

Ama **hiçbir mevcut ekran onları tüketmiyor.** Bölüm içindeki 🟡/🔴 işaretleri
bundan sonra şunu anlatır:

- 🟢 **Tanımlı ve kullanımda** — token var, en az bir bileşen okuyor
- 🟡 **Tanımlı ama eski karşılığı hâlâ yürürlükte** — ekranlar hâlâ ters
  çevrilmiş Tailwind ölçeğini kullanıyor; göç ekran ekran yapılacak
- 🔴 **Henüz hiçbir yerde tüketilmiyor** — token var, tüketen yok

Bu ayrım önemlidir: "token tanımlı" demek "ürün o değere geçti" demek değildir.
Geçiş, Sprint 1B'den itibaren ekran ekran yapılır.

Mevcut durumun ölçülmüş özeti §23'tedir.

---

## 1. Ürün görsel felsefesi

OptiFlow bir genel amaçlı SaaS panosu değildir. **Yapay zekâ destekli bir
fabrika işletim sistemi / üretim komuta merkezidir.**

Görsel karakter şu sıfatlarla tanımlanır: **premium · teknik · endüstriyel ·
sakin · hassas · güvenilir · operasyonel olarak yoğun · finansal olarak
anlamlı.**

Referans nitelikler — hiçbirinin kopyası değil, niteliklerin birleşimi:

- Apple düzeyinde kısıtlılık (ekranda gereksiz hiçbir şey yok)
- Linear düzeyinde boşluk ve etkileşim kalitesi
- Palantir düzeyinde operasyonel yoğunluk
- Endüstriyel mühendislik hassasiyeti

### Yön cümlesi: "Enstrüman paneli, gösterge paneli değil"

Endüstriyel bir enstrümanın dili şudur: kazınmış küçük etiket, devasa okuma
değeri, tick işaretleri, sıfır dekorasyon. Bir anons paneli size kırk sayı
göstermez — **toleransın dışına çıkan tek şeyi yakar.**

Bunun arayüzdeki karşılıkları:

- Etiketler küçük, seyrek, büyük harf, tek renk. Değerler büyük, monospace,
  tabular.
- Kutu yerine **çizgi**: gruplar ince yatay hairline'larla ayrılır, iç içe
  yuvarlak dikdörtgenlerle değil.
- Yüzey farkı **ışıkla** kurulur (bir ton açık), kenarlıkla değil.
- Hiçbir ikon renkli yuvarlak kutu içinde durmaz.
- Bilgi **geometriyle** taşınır; renk tek başına hiçbir zaman tek taşıyıcı
  değildir.

---

## 2. Beş OptiFlow Yasası

Her ekran bu beş maddeyle denetlenir. Bir ekran maddelerden birini geçemiyorsa
tasarım bitmemiştir.

### Yasa 1 — Her ekran bir cümleyle açılır, sayı duvarıyla değil

Ekranın en üstündeki en büyük şey, o ekranın **durum tespitidir**. KPI şeridi
cümlenin altına iner ve cümleyi destekler.

> "Bugün hattınızı Torna sınırlıyor."
> değil: "%74 OEE · 778 birim · ₺178.772"

### Yasa 2 — Çıplak metrik yasaktır

Önemli her sayı bir **sonuç** taşır: kapasite, para, risk, eşik, çıktı ya da
eylem. Sayı sonucuna bağlanamıyorsa o ekrana ait değildir.

> "Torna OEE %74" → yetersiz
> "Torna hattın kapasitesinin %18'ini sınırlıyor · bugünkü kayıp ₺8.400" → geçerli

### Yasa 3 — Renk bir ölçümdür

Yüzey renkleri asla dekoratif değildir. Yeşil/sarı/kırmızı yalnızca **ölçülmüş
bir durumu** temsil eder. Mavi yalnızca **etkileşimi** temsil eder. Ölçülmemiş
değer görsel olarak nötr kalır.

### Yasa 4 — Uydurulmuş ölçüm gösterilmez

`null` → "—" artı, uygun olduğunda bir açıklama ve bir eylem. Hesaplanamayan bir
metrik asla sıfır olarak gösterilmez. Bu, ürünün en değerli farkıdır ve görsel
dilin bir parçasıdır, bir istisna değildir.

### Yasa 5 — Her ekran bir eylemle kapanır

Sayfanın sonunda kullanıcı ya bir şey çalıştırır, ya bir şey kaydeder, ya da bir
sonraki ekrana gider. Sonu olmayan ekran bir raporlama ekranıdır; OptiFlow
raporlama galerisi değildir.

---

## 3. Tasarım token'ları

> **Sprint 1A'da tanımlandı.** Aşağıdaki token'ların tamamı
> `frontend/src/index.css` içinde, `@theme` bloğunun **dışında**, düz bir
> `:root` bloğunda durur. `@theme` bilinçli olarak kullanılmadı: oraya yazılan
> bir değişken Tailwind'e yardımcı sınıf ürettirir ve mevcut ölçeklerle
> çakışırdı.
>
> CSS'te kullanımı: `bg-[var(--of-surface-1)]`, `text-[var(--of-ink-2)]`,
> `rounded-[var(--of-radius-md)]`. Dinamik olarak kurulan sınıf adları
> (`` `bg-[var(--of-${x})]` ``) **çalışmaz** — Tailwind kaynağı statik tarar,
> çalışma zamanında kurulan ad hiç üretilmez. Durum→sınıf eşlemeleri bu yüzden
> `src/lib/ui/status.ts` içinde tam metin olarak durur.

### 3.1 Yüzeyler 🔴 (tanımlı · tüketen yok)

| Token | Hedef | Mevcut karşılık | Durum | Kullanım |
| --- | --- | --- | --- | --- |
| `canvas` | `#0A0D12` | `--color-canvas: #0b0f14` | 🟡 | Uygulama zemini |
| `sunken` | `#0D1117` | — | 🔴 | Kaydırma alanı, tablo gövdesi |
| `surface-1` | `#12161D` | `--color-surface: #111827` | 🟡 | Panel |
| `surface-2` | `#171C25` | `--color-surface-raised: #161f2b` | 🟡 | Yükseltilmiş satır, hover, aktif sekme |
| `overlay` | `#1C222C` | — | 🔴 | Drawer, modal, popover |
| `hairline` | `#232A35` | `--color-hairline: #1f2937` | 🟡 | Ayraç çizgisi |

**Kural:** Bir ekranda aynı anda en fazla **üç** yüzey seviyesi bulunur.

### 3.2 Metin (ink) 🔴

| Token | Hedef | Kullanım |
| --- | --- | --- |
| `ink-1` | `#F2F5F8` | Başlık, değer, birincil metin |
| `ink-2` | `#A9B4C2` | Gövde metni |
| `ink-3` | `#6B7685` | Etiket, ikon, ikincil |
| `ink-4` | `#454E5C` | Devre dışı |

Mevcut kod bu rolleri ters çevrilmiş Tailwind slate ölçeğiyle karşılıyor
(`text-slate-900` = en parlak). Geçiş sprint'inde ink token'ları bu ölçeğin
**üstüne** tanımlanır; slate sınıfları bir süre birlikte yaşar.

### 3.3 Anlamsal renkler

| Token | Değer | Durum | Kesin anlamı |
| --- | --- | --- | --- |
| `interactive` | `#3D7DFF` | 🟡 (`--color-brand-600: #2563EB`) | **Yalnızca** tıklanabilirlik: düğme, bağlantı, odak, seçim |
| `ok` | `#22C55E` | 🟢 | Ölçüldü ve eşik içinde |
| `warn` | `#F59E0B` | 🟢 | Ölçüldü ve eşiğe yakın |
| `fault` | `#EF4444` | 🟢 | Ölçüldü ve eşik dışı |
| `unknown` | `#6B7685` | 🔴 | **Ölçülmedi.** Kırmızı değildir; nötrdür |
| `value-ink` | `#F2D9A0` | 🔴 | Geri kazanılabilir / risk altındaki para |

**`interactive` kuralı:** Mavi hiçbir zaman panel zemini olamaz. Mavi bir yüzey
gördüğünüzde o yüzey tıklanabilir olmalıdır.

**`unknown` kuralı:** Ölçülmemiş bir değer kırmızı olamaz. Kırmızı "ölçtük,
kötü" demektir; gri "ölçmedik" demektir. Bu ayrım ürünün dürüstlük
mimarisinin görsel karşılığıdır.

**`value-ink` kuralı — rezerve mürekkep:**

- Yalnızca **büyük mono rakam** olarak kullanılır.
- Asla zemin, asla çip, asla kenarlık, asla ikon rengi olmaz.
- Böylece doygun `warn` amber çipiyle hiçbir zaman yarışmaz.
- Ekran başına en fazla **2-3** kez görünür.
- Ürünün vaadi ("kaybınızın ne kadarını geri alabilirsiniz") bu mürekkeple
  yazılır; başka hiçbir şey bu mürekkebi kullanamaz.

### 3.4 Aralık (spacing) 🔴

```
4 · 8 · 12 · 16 · 24 · 32 · 48 · 64
```

| Bağlam | Değer |
| --- | --- |
| Panel iç dolgu | 16 |
| Satır dikey dolgu | 12 |
| Bölüm arası | 24 |
| Sayfa kenarı (masaüstü) | 24 |
| Sayfa kenarı (mobil) | 16 |
| İlişkili öğeler arası | 8 |
| Etiket–değer arası | 4 |

Bu ölçeğin dışında bir değer **teknik zorunluluk** olmadan kullanılmaz (örnek
meşru zorunluluk: 1px hairline hizası için 1px kaydırma).

### 3.5 Yuvarlaklık (radius) 🔴

```
xs   = 3px    çip, rozet, tag
sm   = 5px    düğme, input, select
md   = 8px    panel, kart, tablo kabı
lg   = 12px   modal, drawer
full          avatar, durum noktası
```

16px, 20px ve 28px **ölçekten çıkarılır**.

> ✅ **Karar (Sprint 1A): Seçenek B — ayrı ad alanı.**
>
> Bu ölçek Tailwind'in `--radius-*` adlarıyla çakışıyordu. Mevcut kodda
> `--radius-lg: 12px`, `--radius-xl: 16px`, `--radius-2xl: 20px`,
> `--radius-3xl: 28px` tanımlı ve uygulamada **282 `rounded-lg`,
> 174 `rounded-xl`, 43 `rounded-2xl`** kullanımı var (ölçüldü).
>
> Tailwind ölçeğini yeniden eşlemek (Seçenek A) 499 kullanımı tek seferde
> dönüştürürdü — hızlı ama geri dönüş penceresi dar. Bunun yerine
> `--of-radius-*` ayrı ad alanı tanımlandı: **mevcut Tailwind ölçeğine ve
> hiçbir `rounded-*` kullanımına dokunulmadı.** Yeni bileşenler yeni ölçeği
> kullanır, eski sınıflar ekran ekran göç eder.
>
> Bedeli açıkça kabul edilmiştir: geçiş döneminde iki yarıçap ölçeği bir arada
> yaşar ve yan yana duran iki yüzeyin köşeleri bir süre farklı olabilir. Bu,
> tek seferde 499 kullanımı değiştirmenin riskine tercih edilmiştir.

### 3.6 Breakpoint'ler 🟡

| Genişlik | Rol | Tailwind karşılığı |
| --- | --- | --- |
| 375 | Taban (mobile-first) | — (varsayılan) |
| 640 | Küçük tablet / geniş telefon | `sm` |
| 768 | Tablet — **Operatör için birincil** | `md` |
| 1024 | Küçük masaüstü | `lg` |
| 1280 | Masaüstü | `xl` |
| 1440 | **İçerik maksimum genişliği** | breakpoint değil, kap genişliği |
| 1600 | Geniş ekran davranışı | özel breakpoint gerekir |

**İçerik genişliği kuralı:** Uygulamanın tamamında tek bir maksimum içerik
genişliği vardır: **1440px**. Ölçüldü: şu an 8 farklı `max-w-*` değeri
kullanılıyor (`max-w-3xl` 13, `max-w-md` 10, `max-w-5xl` 10, `max-w-7xl` 8,
`max-w-6xl` 7, `max-w-2xl` 5, `max-w-xl` 4) — bu yüzden sayfa değiştikçe içerik
genişliği zıplıyor. `PageShell` bunu tek değere sabitler.

### 3.7 Hareket (motion) 🔴

| Süre | Kullanım |
| --- | --- |
| 120ms | Mikro: hover, basma, çip durumu |
| 180ms | Panel, drawer, sekme geçişi |
| 240ms | **Mutlak tavan.** Hiçbir arayüz hareketi bunu aşamaz |

Easing: `cubic-bezier(.2, 0, 0, 1)`.

> Tailwind varsayılan süreleri 150/200/300ms'dir; 120/180/240 özel token
> gerektirdiği için `--of-motion-micro/panel/max` Sprint 1A'da tanımlandı.

**İzin verilen hareket sayısı: 7.** Ürünün tamamında yalnızca şunlar
animasyonludur:

1. İçerik girişi (4px yükselerek fade)
2. Drawer / panel kayması
3. Canlı sayı değişimi
4. İlerleme dolumu
5. Alarm nabzı
6. ConstraintRail'de parça akışı (yalnızca `live` varyantı)
7. İskelet parıltısı (`.optiflow-skeleton`)

> **Düzeltme (Sprint 1A).** Liste ilk yazıldığında altı maddeydi ve iskelet
> parıltısını dışarıda bırakıyordu; oysa §12 parıltıyı açıkça şart koşuyordu.
> Belge kendi içinde çelişiyordu. Parıltı listeye alındı çünkü
> ANTI-PATTERNS #10'un ölçütünü karşılıyor: "bir sürecin devam ettiğini
> gösterir".

**240ms tavanının kapsamı.** Tavan **geçişler** içindir — bir durumdan
ötekine gidiş. Süregiden durum göstergeleri (iskelet parıltısı 1.2s, alarm
nabzı) tavana tabi değildir; bunlar bir yere varmaz, bir şeyin sürdüğünü
söyler.

**Belgelenmiş istisna: `--of-motion-progress: 500ms`.** `ProgressBar` bugün
500ms'de doluyor ve bu bir geçiştir, dolayısıyla tavanı aşıyor (C3). Sprint
1A'nın sözleşmesi "mevcut ekranlarda sıfır görsel fark" olduğu için değer
değiştirilmedi; yalnızca token'a bağlandı, böylece ileride tek bir yerden
düşürülebilir. Karar §25'te açık maddedir.

Ölçüldü: `index.css` şu an **21 `@keyframes`** içeriyor. Fazlası elenecektir.
`prefers-reduced-motion` desteği **zaten mevcut** (5 yerde) ve korunur.

---

## 4. Tipografi 🟡

**Tek ve en önemli kural:** *Ölçülen her sayı mono + tabular; her kelime sans.*

| Rol | Boyut / Satır | Ağırlık | Kullanım |
| --- | --- | --- | --- |
| `display` | 44 / 44, -0.02em | 500 | Ekranın tek kahraman sayısı |
| `metric-l` | 30 / 32 | 500 | KPI değeri |
| `metric-m` | 20 / 24 | 500 | Panel içi değer |
| `metric-s` | 15 / 20 | 500 | Tablo hücresi |
| `title-page` | 20 / 26, -0.01em | 600 | Sayfa başlığı |
| `title-panel` | 15 / 20 | 600 | Panel başlığı |
| `body` | 13 / 20 | 400 | Gövde |
| `body-s` | 12 / 18 | 400 | Yardım metni |
| `label` | 11 / 12, 0.08em, BÜYÜK HARF | 500 | Etiket |
| `data` | 12.5 / 18 | 400 | Tablo metni (condensed) |
| `code` | 11.5 / 16 | 400 | Tag, endpoint, ID |

**Kural:** Ürünün tamamında 15px üstü yalnızca **üç** boyut vardır (`display`,
`metric-l`, `title-page`). Dördüncüsü eklenmez.

**Font ailesi:** Mevcut durum Inter (`index.html` içinden Google Fonts ile
yükleniyor, `--font-sans` token'ı tanımlı, `cv02/cv03/cv04/cv11` özellikleri
açık). Font değişimi **bu belgeyle kararlaştırılmamıştır** ve ayrı bir karar
konusudur (§25). Değiştirilene kadar yukarıdaki ölçek Inter üzerinde uygulanır;
`data` satırı için condensed bir kesim yoksa `body-s` kullanılır.

---

## 5. Kenarlık ve hairline kuralları 🔴

Ölçüldü: kodda şu an **1334** `border` kullanımı var. Yeni kural kutudan çizgiye
geçiştir.

| Durum | Karar |
| --- | --- |
| Panel | **Kenarlık yok.** Yüzey bir ton açık + gerekiyorsa 1px üst hairline |
| Grup ayrımı | Panel genişliğinde tam-bleed 1px hairline |
| Dolgusuz etkileşimli öğe | 1px hairline (ikincil düğme, input) |
| Durum taşıyan satır | **2px sol kelepçe çizgisi** — renk yalnızca burada |
| Boş durum | 1px kesikli (mevcut desen korunur) |

**İç içe kart yasaktır.** Bir panelin içinde ikinci bir kenarlıklı yüzey olamaz;
iç bölümleme hairline ile yapılır.

---

## 6. Grafik kuralları

### 6.1 Palet — doğrulandı, göz kararı değil

Aşağıdaki değerler koyu zeminde CVD (renk körlüğü) ayrımı, açıklık bandı, kroma
tabanı ve kontrast kontrollerinden **geçirilerek** seçilmiştir.

| Küme | Renkler | Doğrulama sonucu |
| --- | --- | --- |
| 4 seri (bar / çizgi / yığın) | `#3987e5` `#d95926` `#199e70` `#c98500` | Tüm kontroller geçti — en kötü komşu CVD ΔE 8.4, normal görüş ΔE 19.8 |
| 3 seri (scatter, tüm çiftler) | `#3987e5` `#d95926` `#199e70` | Tüm kontroller geçti — CVD ΔE 9.4, normal görüş ΔE 20.9 |
| Bağlam / nötr işaret | `#6B7685` | OptiFlow zemininde kontrast 3.93:1 (hesaplandı) |

Seri renkleri **sabit sırayla** atanır, asla döngüye sokulmaz. 5. seri
gerekiyorsa "Diğer"e katlanır ya da grafik bölünür.

### 6.2 Kurallar

- **Çoğu OptiFlow grafiği kategorik değildir** — "biri vurgulu, gerisi bağlam"
  şeklindedir. Varsayılan: vurgulanan `#d95926`, diğerleri `#6B7685`.
- Durum renkleri (`ok`/`warn`/`fault`) **asla seri rengi olarak kullanılmaz**.
- **Çift y-ekseni yasaktır.** İki farklı ölçekli metrik → iki grafik.
- Bar grafiklerde değer etiketi **barın ucunda** yazılır; kullanıcı eksen
  okumak zorunda bırakılmaz.
- Her grafiğin kendi kartı yoktur; panelin üstünde durur.
- Grid ve eksenler geri çekiktir (`hairline`).
- ≥2 seride lejant her zaman vardır; kimlik asla yalnızca renkle taşınmaz.
- Metin daima metin token'ı giyer, asla seri rengini almaz.

### 6.3 Yasak grafik biçimleri

- **Hız göstergesi (gauge / speedometer).** Tek bir sayı için büyük alan
  harcar, skeuomorfiktir ve ürün karakterine aykırıdır.
- **Etiketsiz, eksensiz, eşiksiz sparkline.** Ölçeği okunamayan bir çizgi
  dekorasyondur.
- **3B, gölgeli, gradient dolgulu grafik.**
- **Pasta grafiği** — dört dilimden fazlası için asla; karşılaştırma bar ile
  yapılır.

---

## 7. İkon kuralları 🟡

- Kütüphane: `lucide-react` (mevcut, korunur).
- Boyut: **16px** varsayılan · **14px** yoğun satır · **20px** yalnızca boş
  durum.
- Stroke: 1.5.
- Renk: `ink-3`; durum taşımıyorsa renklendirilmez.
- **İkon renkli yuvarlak kutuya konmaz.** Bu desen ürünün tamamından
  kaldırılacaktır (bkz. ANTI-PATTERNS #6).
- Yalnızca ikon içeren düğmelerde `aria-label` zorunludur.
- Emoji ikon olarak kullanılmaz.

---

## 8. Düğme hiyerarşisi 🟡

Tam **dört** seviye vardır, fazlası yoktur.

| Seviye | Görünüm | Kural |
| --- | --- | --- |
| `primary` | Dolu `interactive` | Bir ekran bölgesinde **en fazla bir tane** |
| `secondary` | 1px hairline, dolgusuz | Varsayılan seçim |
| `ghost` | Yalnızca metin | Satır içi, tablo içi |
| `destructive` | Kırmızı metin; dolu yalnızca onay diyaloğunda | — |

Yükseklik: 28 (sm) / 32 (md) / 36 (lg).

> 🟡 **Mevcut uyumsuzluk:** `Primitives.tsx` bugün `primary | secondary | ghost
> | danger` varyantlarını taşıyor. `danger` ile `destructive` aynı kavramdır;
> **mevcut ad korunur**, belge `danger` adını kabul eder. Yeni bir ad
> uydurulmaz.

---

## 9. Input kuralları 🔴

- Yükseklik: 32 (yoğun) / 36 (varsayılan).
- **Etiket daima görünür**, alanın üstünde, `label` stilinde. Placeholder etiket
  yerine geçmez.
- Dolgusuz + 1px hairline kenarlık.
- Odak: 1px `interactive` kenarlık + 2px dış halka. (Genel `:focus-visible`
  kuralı `index.css`'te tek noktadan tanımlı ve korunur.)
- Hata: alanın **altında**, kırmızı metin + ikon. Asla yalnızca sayfa başında
  toplu hata listesi.
- Sayısal alanlar mono + tabular + sağa dayalı.
- Yardım metni `body-s`, alanın altında, hata varsa hatanın altında.

---

## 10. Tablo kuralları 🔴

Tablo bu ürünün omurgasıdır. Tek bir `DataTable` bileşeni, **iki render modu**:

**≥768px — tablo modu**

- Yapışkan başlık satırı
- 36px satır yüksekliği
- `data` tipografisi
- Sayılar mono + tabular + sağa dayalı
- Durum için 2px sol kelepçe (`StatusClamp`)
- Hover'da `surface-2`
- Satır genişletilebilir (detay için drawer tercih edilir)

**<768px — kayıt listesi modu**

- Aynı bileşen, her satır bir kayda dönüşür
- Etiket/değer dikey çiftleri
- **Yatay kaydırma yoktur**

Ölçüldü: bugün 15 dosyada `overflow-x-auto` ile "tabloyu kendi içinde kaydır"
yaması var. Bu, dar ekranda tablonun okunabilir olduğu anlamına gelmez; yalnızca
sayfanın yana kaymadığı anlamına gelir. `DataTable` bu yamayı kökten çözer.

---

## 11. Drawer ve modal kuralları 🔴

| Bileşen | Genişlik | Ne zaman |
| --- | --- | --- |
| `Drawer` (sağ) | 420px / 560px | Bağlam kaybetmeden inceleme: istasyon detayı, cihaz yükü, öneri gerekçesi, AI Copilot |
| `Modal` | maks 520px | Yalnızca yıkıcı onay ve 3 alandan kısa formlar |

- **İç içe modal yoktur.**
- Drawer açıkken arka plan kaydırılmaz.
- İkisi de `Escape` ile kapanır ve odağı açan öğeye geri verir.
- Tam sayfa detay ekranları yerine drawer tercih edilir.

---

## 12. Yükleme kuralları 🔴

Ölçüldü: kodda şu an `animate-pulse` / `Skeleton` deseni **sıfır** kullanımda;
tek gösterge dönen spinner.

- `Skeleton` bileşeni **şekil eşlemelidir**: `text` / `metric` / `table(rows)` /
  `chart`. İçeriğin biçimini önceden gösterir.
- Shimmer 1.2s; `prefers-reduced-motion` altında statiktir.
- **Spinner yalnızca iki yerde kalır:** düğme içi ve kullanıcı tetikli kısa
  işlem.
- **Sayfa yüklemesi asla spinner görmez.**

---

## 13. Boş ve hata durumu kuralları 🟢 / 🔴

### Boş durum 🟢 — mevcut sözleşme korunur

`EmptyState` bugün doğru sözleşmeye sahip: her boş durum kullanıcıya **ne
yapacağını** söyler. "Veri yok" yazıp bırakmak yasaktır. Bu bileşen ve davranışı
değişmez.

### Hata durumu 🔴 — eksik, eklenecek

`ErrorState` dört şeyi taşır:

1. **Ne başarısız oldu** — sistemin dilinde değil, kullanıcının dilinde
2. **Bu ne demek** — kullanıcı için sonucu
3. **Tek bir tekrar-dene eylemi**
4. **Teknik ayrıntı** — bir açılır bölümün arkasında

Hata metni özür dilemez, belirsiz olmaz, suçlamaz.

---

## 14. Responsive kuralları

**Mobil, küçültülmüş masaüstü değildir.**

| Genişlik | Tasarım sorumluluğu |
| --- | --- |
| 375 | Taban. Tek sütun. Tablolar kayıt listesi. Kenar çubuğu çekmece |
| 768 | **Operatör deneyiminin birincil hedefi** — sahadaki panel duvara asılı tablettir, telefon değil |
| 1024 | Kenar çubuğu sabitlenir; iki sütunlu içerik mümkün |
| 1440 | İçerik maksimum genişliği; daha geniş ekranda içerik ortalanır |
| 1600 | Kenar boşluğu artar, satır uzunluğu artmaz |

Kurallar:

- Hiçbir genişlikte yatay sayfa kaydırması olmaz. (`body { overflow: hidden }`
  kuralı bunu zorlar ve korunur.)
- Dokunma hedefi minimum 44×44px.
- 375px doğrulaması **gerçek tarayıcıda** yapılmadan hiçbir ekran tamam sayılmaz.

---

## 15. `ConstraintRail` spesifikasyonu 🔴

> **Bu görevde uygulanmayacaktır.** Aşağıdaki yalnızca tasarım sözleşmesidir.

### 15.1 Ne olduğu

ConstraintRail, OptiFlow'un **birincil görsel imzasıdır**. Üretim kısıtını
(darboğazı) gösterir ve dekoratif değildir — ürünün motorundaki Kısıtlar
Teorisi'nin doğrudan görselleştirmesidir.

### 15.2 Bilgi geometriyle taşınır

En önemli kural: **segment genişliği = istasyonun kapasite payı.** Şerit yalnızca
renkle değil, **geometriyle** bilgi taşır. Renk körlüğü olan bir kullanıcı da,
gri tonlamalı bir çıktı da kısıtın nerede olduğunu okuyabilmelidir.

Kısıt üç sinyalle işaretlenir ve hiçbiri tek başına yeterli değildir:

1. Tam dolgu (diğerleri nötr)
2. 2px üst kelepçe çizgisi
3. Yazılı "KISIT" etiketi

### 15.3 Veri sözleşmesi (kavramsal)

Şerit sıralı istasyon listesi alır. Her istasyon:

| Alan | Anlamı |
| --- | --- |
| `id` | Kimlik |
| `label` | Ekranda görünen ad |
| `share` | Kapasite payı (0–1). **`null` olabilir** |
| `utilization` | Doluluk oranı |
| `state` | `ok` / `warn` / `fault` / `unknown` |
| `value` + `unit` | Şeridin varyantına göre okuma değeri |
| `isConstraint` | Kısıt mı |

### 15.4 Varyantlar

| Varyant | Ekran | Değer alanı gösterir |
| --- | --- | --- |
| `plan` | Simülasyon Sonucu | Doluluk % |
| `live` | Canlı Üretim | Anlık kuyruk / durum; parça akışı animasyonlu |
| `money` | Finans | İstasyon başına günlük kayıp |
| `compact` | Command Center | Tek satır özet |

Aynı bileşen dört ekranda görünür ve **anlamı hiç değişmez.**

> ✅ **Karar (Sprint 1A): geometri her varyantta aynı şeyi kodlar.**
>
> Segment genişliği **her varyantta** kapasite/akış payıdır — `money`
> varyantında da. Genişlik para miktarını **temsil etmez**; finansal kayıp,
> segmentin üzerinde ayrı bir değer katmanı olarak yazılır.
>
> Gerekçe: bir görsel dilin tek bir kuralı olur. Genişlik Simülasyon'da
> kapasite, Finans'ta para anlamına gelseydi, dört ekranda aynı görünen bir
> şerit dört ekranda farklı bir şey söylerdi — ve kullanıcı hangi ekranda
> olduğunu hatırlamak zorunda kalırdı. Şeridin değeri tam olarak "her yerde
> aynı şeyi söylemesi"nden gelir.
>
> Bedeli kabul edilmiştir: Finans'ta en geniş segment her zaman en pahalı
> segment olmayabilir. Bu yüzden `money` varyantında para değeri **yazıyla**
> taşınır ve en pahalı istasyon ayrıca işaretlenir — geometriyle değil,
> etiketle.

### 15.5 Ölçüm dürüstlüğü (Yasa 4)

- `share` ölçülmemişse segmentler eşit genişlikte ve nötr çizilir; şerit
  "kapasite payı ölçülmedi" der.
- `state` `unknown` ise segment nötr kalır, kırmızı olmaz.
- Kısıt belirlenemiyorsa şerit kısıt işaretlemez ve nedenini yazar.

### 15.6 Responsive

- ≥768px: yatay şerit.
- <768px: dikey liste; her istasyon bir satır, geometri yatay bar olarak korunur.
  **Yatay kaydırma yoktur.**

### 15.7 Yasaklar

Gradient, parlama (glow), 3B, gölge, dekoratif hareket. Tek izinli hareket
`live` varyantındaki parça akışıdır.

### 15.8 Neyin yerine geçer

Hız göstergesi, "doluluk karşılaştırması" bar grafiği, boş akış canvas'ı ve
tekrarlanan darboğaz cümleleri. Tek öğe, dört tekrarın işini yapar.

---

## 16. `DecisionBlock` spesifikasyonu 🔴

> **Bu görevde uygulanmayacaktır.** Yalnızca sözleşme.

Bir `Decision` nesnesini render eder. Yapısı:

```
[ Durum cümlesi ]                          ← Yasa 1
Neden      <niçin bu sonuç çıktı>
Etki       <kapasite / çıktı>
Para       <₺ değer — value-ink>           ← Yasa 2
Güven      <yöntem · örneklem · aralık>
─────────────────────────────────────
[ Birincil eylem ]  [ Nasıl hesaplandı? ]  ← Yasa 5
```

Kurallar:

- `money` `null` ise blok yine de çizilir; para satırı "—" olur ve **nedenini
  yazar** ("maliyet oranları girilmedi"). Blok gizlenmez, uydurulmaz.
- Birincil eylem, bulunduğu bölgenin **tek** birincil düğmesidir.
- "Nasıl hesaplandı?" her zaman tek tıkla ulaşılabilir (§17).
- Güven satırı yöntemi ve belirsizliği birlikte söyler — ürünün güven aralığı
  ilkesiyle tutarlı olarak.

---

## 17. Decision ve Provenance UX ilkeleri 🔴

> **Bu görevde uygulanmayacaktır.** Yalnızca mimari sözleşme.

### 17.1 Karar birinci sınıf bir ürün kavramıdır

Bir `Decision` kavramsal olarak şunları taşır:

| Alan | Anlamı |
| --- | --- |
| `situation` | Durum tespiti — ekranı açan cümle |
| `why` | Bu sonucun nedeni |
| `impact` | Operasyonel etki (kapasite, çıktı, süre) |
| `money` | Parasal karşılık — **ölçülemiyorsa `null`** |
| `expectedGain` | Eylem uygulanırsa beklenen kazanım |
| `confidence` | Güven / belirsizlik |
| `action` | Önerilen eylem |
| `targetView` | Eylemin götürdüğü ekran |
| `provenance` | **Bu öneri nereden geldi** |

### 17.2 Provenance zorunludur

Her öneri şu soruyu cevaplayabilmelidir: **"OptiFlow bunu neden önerdi?"**

`provenance` en az şunları taşır:

- **Kaynak** — simülasyon koşumu / canlı veri / finans modeli / kural motoru /
  elle girilen
- **Kullanılan girdiler** — hangi sayılar bu sonuca girdi
- **Yöntem** — hangi hesap
- **Örneklem** — kaç tekrar, hangi zaman aralığı
- **Hesaplanma zamanı**
- **Ölçülemeyenler** — bu hesaba girmesi gerekip de girmemiş olanlar

### 17.3 UX kuralı

Gerekçe **ekrandan ayrılmadan** ulaşılabilir olmalıdır: açılır bölüm ya da
drawer. Ayrı bir sayfaya gitmek gerekmez.

Gerekçe gizlenirse öneri bir kehanete dönüşür. OptiFlow kehanet satmaz; hesap
satar.

### 17.4 AI sunum kuralı

Yapay zekâ **sohbet kutusu olarak sunulmaz.** Öneri katmanı olarak sunulur:
uygulanabilir aksiyonlar listesi birincil, serbest sohbet ikincildir. Öneri
üretilemiyorsa **nedeni yazılır** — boş bir sohbet kutusu boş bir vaattir.

---

## 18. Bileşen envanteri

### 18.1 Korunan mevcut bileşenler 🟢

Bunların **imzaları değişmez.** İçlerindeki token'lar güncellenir; çağıran
dosyalar dokunulmadan yeni görünüme geçer.

| Bileşen | Konum | Not |
| --- | --- | --- |
| `Card` | `components/ui/Primitives.tsx` | `Panel` gelse de kalır |
| `Button` | aynı | `primary/secondary/ghost/danger`, `sm/md` |
| `Badge` | aynı | `neutral/good/warning/bad/info` |
| `EmptyState` | aynı | Sözleşmesi doğru, korunur |
| `ProgressBar` | aynı | — |
| `SectionTitle` | aynı | — |
| `Spinner` | aynı | Kullanım alanı daralır (§12) |
| `MetricRow` | aynı | Mevcut imza korunur; genişletilebilir |

### 18.2 Yeni bileşenler

Sprint 1A dördünü yazdı. Dördü de **hiçbir ekrana bağlı değildir** — sözleşme
"mevcut ekranlarda sıfır görsel fark"tı; bağlama işi ekran ekran yapılır.

| Bileşen | Durum | İşi |
| --- | --- | --- |
| `Skeleton` | 🟢 `components/ui/Skeleton.tsx` | Şekil eşlemeli yükleme (§12) |
| `ErrorState` | 🟢 `components/ui/ErrorState.tsx` | Hata durumu (§13) |
| `OriginBadge` | 🟢 `components/ui/OriginBadge.tsx` | Canlı / Benzetim / Doğrulanmadı kökeni |
| `StatusClamp` | 🟢 `components/ui/StatusClamp.tsx` | 2px sol durum çizgisi |
| `PageShell` | 🔴 | Başlık + tek içerik genişliği (1440) + eylem yuvası |
| `Panel` | 🔴 | Kenarlıksız yüzey + hairline bölümleme |
| `Statement` | 🔴 | Ekranı açan cümle (Yasa 1) |
| `MetricGroup` | 🔴 | KPI şeridi — gradient yok, ikon kutusu yok |
| `ConstraintRail` | 🔴 | İmza öğe (§15) |
| `DecisionBlock` | 🔴 | Karar bloğu (§16) |
| `DataTable` | 🔴 | Tablo / kayıt listesi çift modu (§10) |
| `Drawer` | 🔴 | Sağ çekmece (§11) |
| `Tabs` | 🔴 | Bölüm içi görünüm geçişi |

Dördünün saf mantığı `src/lib/ui/` altındadır (`types`, `skeleton`, `status`,
`origin`, `errorState`): hangi durumun hangi rengi aldığı, iskeletin kaç çubuk
çizdiği ve bir kökenin ne anlama geldiği sınanabilir işlevlerdir.

**Test yaklaşımı.** Projede DOM ortamı yoktur (`vitest` `environment: "node"`,
jsdom ya da test kütüphanesi kurulu değil). Bileşen testleri bu yüzden
`react-dom/server`'ın `renderToStaticMarkup`'ı ile yazılır: gerçek bir DOM ağacı
kurulmaz — tıklama gibi etkileşimler sınanamaz — ama çıkan işaretlemenin rol,
`aria`, sınıf ve metin doğruluğu **yeni bağımlılık eklemeden** sınanır.

### 18.3 Mimari kural — mantık bileşende durmaz

Projenin kendi kuralı geçerlidir: **saf mantık `frontend/src/lib/<alan>/`
altında durur; bileşenler yalnızca render eder.** Eşik, katsayı, fiyat, karar ve
cümle üretimi bileşenin içinde yazılmaz.

Karar katmanı bu yüzden bir bileşen değil bir kütüphanedir. Uygulandığında
`lib/decisions/` altında, testleriyle birlikte durur.

---

## 19. Doğru / yanlış örnekler

### 19.1 Metrik sunumu

| ❌ Yanlış | ✅ Doğru |
| --- | --- |
| `OEE %74` | `Torna hattın kapasitesinin %18'ini sınırlıyor · bugünkü kayıp ₺8.400` |
| `Aylık kayıp ₺0` (oran girilmemiş) | `Aylık kayıp — · maliyet oranları girilmedi → [Oranları gir]` |
| Dört renkli gradient KPI kartı | Hairline ile ayrılmış dört değer; yalnızca biri `value-ink` |

### 19.2 Ekran açılışı

| ❌ Yanlış | ✅ Doğru |
| --- | --- |
| "Günaydın Demo kullanıcısı" en büyük yazı | "Bugün hattınızı Torna sınırlıyor." en büyük yazı |
| Ekran KPI şeridiyle açılır | Ekran durum cümlesiyle açılır, KPI altında |

### 19.3 Renk

| ❌ Yanlış | ✅ Doğru |
| --- | --- |
| Mavi zeminli "AI Morning Brief" paneli | Nötr panel; mavi yalnızca düğmede |
| Ölçülmemiş değer kırmızı | Ölçülmemiş değer nötr gri + "—" |
| Grafikte mor/indigo varsayılan bar | `#d95926` vurgulu, `#6B7685` bağlam |

### 19.4 Yapı

| ❌ Yanlış | ✅ Doğru |
| --- | --- |
| Kartın içinde kart, onun içinde üç kutu | Tek panel, hairline ile üç bölüm |
| Beş eşit görünümlü kapalı akordeon | Üç adlandırılmış sekme |
| Aynı kontrol listesi iki ayrı blokta | Tek blok; bitince tümüyle kaybolur |

### 19.5 Yükleme

| ❌ Yanlış | ✅ Doğru |
| --- | --- |
| Boş sayfa + ortada dönen spinner | İçeriğin biçimini gösteren iskelet |
| Yükleme sırasında düzen zıplaması | İskelet gerçek yerleşimle aynı ölçüde |

---

## 20. Gezinme ilkeleri 🔴

> **Bu görevde uygulanmayacaktır.** Yalnızca hedef yapı.

```
GENEL BAKIŞ    Command Center · Raporlar
FABRİKA        Fabrikalar · Süreç · Makineler · Simülasyon · Envanter
OPERASYON      Canlı Üretim · Finans · Operatör · Doğrulama
BAĞLANTI       Bağlantı Merkezi (bağlayıcı / runtime / cihaz / pilot /
               trendler / tanılama / operasyon — sekmeli tek hub)
KURULUM        Kurulum · Pilot Kurulum
YÖNETİM        Ekip · Satış · Ayarlar
```

- AI Copilot menüden çıkar, **global bağlamsal çekmeceye** dönüşür.
- Bu değişiklik **tamamen toplamadır**: `View` union'ı, `SECTION_OF_VIEW`,
  `VIEW_TITLE` ve `App.tsx`'teki görünüm anahtarı değişmez. Yalnızca sunum
  katmanına bir gruplama ve sekme eşlemesi eklenir.
- Hiçbir ekran kaybolmaz; yalnızca üst düzey madde sayısı düşer.

---

## 21. Korunan mimari — dokunulmaz alanlar

Bu belge **yalnızca sunum katmanını** yönetir. Aşağıdakiler tasarım kararlarıyla
değiştirilemez:

- Backend (`simulation_engine/`)
- Kimlik doğrulama ve çok kiracılılık
- Kalıcılık ve veri modelleri
- API sözleşmeleri
- Simülasyon motoru ve matematiği
- Canlı runtime mantığı
- İş mantığı
- Mevcut testler
- Yönlendirme / görünüm durumu davranışı

Bir tasarım isteği bunlardan birini değiştirmeyi gerektiriyorsa, iş durur ve
karar kullanıcıya sorulur.

---

## 22. Erişilebilirlik tabanı

- Metin kontrastı ≥ 4.5:1; grafik işareti ve ikon ≥ 3:1.
- Odak halkası tek noktadan tanımlıdır ve kaldırılamaz (`:focus-visible`,
  `index.css`).
- Durum asla yalnızca renkle taşınmaz — ikon, etiket ya da geometri eşlik eder.
  (Kenar çubuğundaki aktif bölüm işareti bugün bu kurala uyuyor: mavi zemin +
  sol dikey çizgi.)
- `prefers-reduced-motion` desteklenir (mevcut, korunur).
- Yalnızca ikon taşıyan her düğmede `aria-label` bulunur.
- Klavyeyle tüm akış gezilebilir; drawer ve modal odağı hapseder ve geri verir.

---

## 23. Mevcut durumun ölçülmüş özeti

Bu sayılar belgenin yazıldığı anda `grep`/`wc` ile ölçülmüştür; tahmin
değildir. Sprint'ler ilerledikçe güncellenir.

| Ölçüm | Değer |
| --- | --- |
| Bileşen dosyası | 157 |
| `Primitives` kullanan bileşen | 80 (%51) |
| `index.css` satır | 905 |
| `App.tsx` satır | 1316 |
| `@keyframes` | 22 (Sprint 1A iskelet parıltısını ekledi) |
| `border` kullanımı | 1334 |
| `rounded-lg` / `rounded-xl` / `rounded-2xl` | 282 / 174 / 43 (Sprint 1A dokunmadı) |
| `bg-gradient-to-*` | 9 |
| `overflow-x-auto` taşıyan dosya | 15 |
| `Skeleton` bileşenini kullanan ekran | 0 (bileşen var, henüz bağlanmadı) |
| `EmptyState` kullanan dosya | 26 |
| `Badge` `tone="info"` kullanımı | 7 (göç hedefi §25) |
| Farklı `max-w-*` değeri | 8 |
| `prefers-reduced-motion` kuralı | 6 (Sprint 1A iskeleti ekledi) |
| Frontend testi | 3408 (Sprint 1A öncesi 3365) |

---

## 24. Bu belgeyi değiştirme yordamı

1. Değişiklik bir **tasarım kararıdır**, bir uygulama ayrıntısı değil.
2. Öneri, hangi Yasa'ya dayandığını ya da hangi Yasa'yla çeliştiğini söyler.
3. Bir token değeri değişiyorsa, etkilenen kullanım sayısı **ölçülerek**
   yazılır.
4. Değişiklik ANTI-PATTERNS.md ile çelişiyorsa, iki belge birlikte güncellenir.
5. Belge güncellenmeden kodda yeni bir token, yeni bir kart deseni ya da yeni
   bir renk rolü oluşturulmaz.

---

## 25. Açık kalan kararlar

### Planlanmış — kapsamı belirlendi, sırası bekleniyor

Bunlar **açık soru değildir**; kararı verilmiş, uygulaması sonraki bir sprint'e
bırakılmıştır. Blocker olarak raporlanmazlar.

- **`ProgressBar` 500ms → 240ms · sonraki motion-polish kararı.** Dolum süresi
  240ms tavanını aşıyor (C3). Sprint 1A incelemesinde değerin **şimdilik 500ms
  kalmasına** karar verildi: düşürmek gözle görülür bir davranış değişikliğidir
  ve Sprint 1A'nın "sıfır görsel fark" sözleşmesine girmez. Token
  (`--of-motion-progress`) yerinde olduğu için işin tamamı artık tek bir değer
  değişikliğidir; hareket cilası sprintinde diğer süre ayarlarıyla birlikte
  ele alınacak.
- **`Badge` `info` tonu · sonraki görsel göç sprint'i.** Mavi bir rozet
  üretiyor ama rozet tıklanabilir değil; 3. Yasa ile çelişiyor (C2). Sprint 1A
  incelemesinde tonun **kalmasına** karar verildi. Bugün 7 ekranda kullanılıyor;
  bu kullanımların görsel göçü ayrı bir sprint'te yapılacak. O zamana kadar
  `Badge` API'si değişmez ve yeni kullanım eklenmez.
- **Etkileşim testleri · test altyapısı kurulduğunda.** Projede DOM ortamı yok;
  Sprint 1A'nın `react-dom/server` yaklaşımı (işaretleme sınanır, tıklama
  sınanmaz) incelemede **kabul edildi**. Yeni test bağımlılığı kurulmayacak;
  etkileşim testleri uygun altyapı geldiğinde ele alınacak.

### Açık — henüz karara bağlanmadı

Bunlar **bilinçli olarak** karara bağlanmamıştır ve ilgili sprint'te
sorulmalıdır:

1. **Font ailesi** — Inter korunacak mı, teknik karakterli bir aileye geçilecek
   mi? Geçiş metrikleri değiştirir ve 375px'te yeniden doğrulama gerektirir.
   §4'teki `data` satırı (12.5px condensed) bu karara bağlıdır: Inter'in
   condensed kesimi yoktur, o yüzden tablo yoğunluğu hedefi bugün tam
   karşılanamıyor.
2. **Açık tema** — Şu an `color-scheme: dark` sabit. Saha ekranları (Operatör,
   Tanılama) parlak atölye ışığında kullanılıyor. Açık/koyu/sistem tercihi
   eklenecek mi?
3. **1600px davranışı** — Özel breakpoint mi, yalnızca kenar boşluğu artışı mı?

### Sprint 1A'da karara bağlananlar

- **Radius ad alanı → Seçenek B** (ayrı `--of-radius-*`; §3.5)
- **ConstraintRail geometrisi → her varyantta kapasite payı** (§15.4)
- **İskelet parıltısı izin verilen hareketlere eklendi** (§3.7)

---

*Bu belge çalışan uygulamanın yerel incelemesine dayanır. İçindeki tüm sayısal
iddialar ölçülmüştür. Hiçbir performans iddiası içermez — performans ölçümü
yapılmamıştır.*
