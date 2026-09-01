# OptiFlow — Üretim Süreç Simülasyonu

Üretim hatlarını modelleyip darboğazlarını bulmaya yarayan bir kesikli olay
simülasyonu (discrete-event simulation) platformu. Hedef kullanıcı, simülasyon
yazılımı deneyimi olmayan KOBİ sahipleri ve üretim müdürleridir: hattınızı
tarayıcıda görsel olarak kurar, çalıştırır ve nerede tıkandığınızı görürsünüz.

Sonuçlar tek bir kesin sayı olarak değil, **güven aralığıyla** sunulur:
simülasyon rastgelelik içerir, dolayısıyla "1.250 birim" demek yanıltıcı olur;
doğrusu "1.250 birim (%95 güven aralığı: 1.180 – 1.320)" demektir.

## Neler yapabilir

- **Süreç modelleme** — İstasyonlar, paralel makineler, bekleme alanları,
  yönlendirme olasılıkları, yeniden işleme döngüleri, arıza/onarım (MTBF/MTTR)
  ve fire oranları.
- **Kuyruk teorisi** — M/M/1 ve M/M/c (Erlang-C) kapalı form çözümleri.
- **Little's Law doğrulaması** — Motor her koşumda kendi iç tutarlılığını
  denetler (L = λ·W).
- **OEE kırılımı** — Kullanılabilirlik × Performans × Kalite; hangi bileşenin
  düşük olduğunu ve nedenini gösterir.
- **Kısıtlar Teorisi (TOC)** — Darboğaz tespiti ve Drum-Buffer-Rope tampon
  boyutlandırması. Kapasite kısıtı ile talep kısıtını ayırt eder.
- **Takt time ve hat dengeleme** — Ranked Positional Weight (RPW) algoritması.
- **Monte Carlo** — Bağımsız replikasyonlarla %95 güven aralığı.
- **Senaryo karşılaştırma** — İki senaryo arasındaki farkın istatistiksel
  olarak anlamlı mı yoksa rastgelelikle açıklanabilir mi olduğunu söyler.

## Gereksinimler

| Bileşen | Sürüm |
|---|---|
| Python | 3.12 ile test edildi (3.10+ beklenir) |
| Node.js | 24 ile test edildi (20+ beklenir) |

## Backend'i çalıştırma

Proje kök dizininde:

```bash
pip install -r requirements-dev.txt
```

```bash
uvicorn simulation_engine.api.simulation_service:app --reload
```

> `requirements.txt` yalnızca sunucunun çalışması için gerekenleri içerir;
> `requirements-dev.txt` bunlara ek olarak test araçlarını kurar ve geliştirme
> için doğru olan dosyadır. Yayına alma ortamları `requirements.txt`
> kullanır — sunucuda pytest kurmak gereksizdir.

Servis `http://127.0.0.1:8000` adresinde çalışır. Etkileşimli API
dokümantasyonu: `http://127.0.0.1:8000/docs`

### Uçlar

| Yöntem | Yol | Açıklama |
|---|---|---|
| `POST` | `/api/simulations/run` | Senaryoyu çalıştırır, güven aralıklı sonuç döndürür |
| `GET` | `/api/simulations/{id}/validation-report` | Analitik doğrulama raporu |
| `POST` | `/api/simulations/compare` | Senaryoları istatistiksel anlamlılık testiyle karşılaştırır |
| `GET` | `/api/simulations/{id}/trace` | Animasyon için ham olay izi (ilk 500 dakika) |

## Frontend'i çalıştırma

Ayrı bir terminalde, `frontend/` dizininde:

```bash
cd frontend
```

```bash
npm install
```

```bash
npm run dev
```

Arayüz `http://localhost:5173` adresinde açılır.

> Frontend gerçek backend'e bağlanır, sahte veri kullanmaz. Bu yüzden önce
> backend'in çalışıyor olması gerekir. Backend kapalıyken arayüz üstte bir
> uyarı gösterir; model kurabilir ama çalıştıramazsınız.
>
> Backend'deki CORS ayarı `http://localhost:5173` ve `http://127.0.0.1:5173`
> adreslerine izin verir. Frontend'i başka bir adreste çalıştırıyorsanız
> `FRONTEND_ORIGINS` ortam değişkenine o adresi ekleyin; kaynak kodu
> düzenlemeye gerek yoktur.
>
> Yerelde `DATABASE_URL` tanımlı olmadığı için sonuçlar bellekte tutulur ve
> sunucuyu yeniden başlattığınızda kaybolur. Bu beklenen davranıştır.

### Üretim derlemesi

```bash
npm run build
```

## Testleri çalıştırma

### Backend (220 test)

Proje kök dizininde:

```bash
python -m pytest simulation_engine/validation/ -q
```

Rapor tablolarını da görmek için:

```bash
python -m pytest simulation_engine/validation/ -v -s
```

> Bu paket, motoru kapalı form çözümlerle karşılaştıran uzun simülasyonlar
> içerir ve tamamlanması **6-15 dakika** sürer. Tek bir dosyayı çalıştırmak
> çok daha hızlıdır, örneğin:
> `python -m pytest simulation_engine/validation/test_queueing_theory.py -q`

### Frontend (121 test)

`frontend/` dizininde:

```bash
npx vitest run
```

Tip denetimi:

```bash
npx tsc --noEmit -p tsconfig.app.json
```

## Yayına alma

Backend Railway'e, frontend Vercel'e dağıtılır. **Sıra önemlidir:** frontend'in
backend adresini bilmesi, backend'in de frontend adresine izin vermesi gerekir.

### 1. Backend — Railway

Railway'de GitHub reposundan yeni bir proje oluşturun. Depodaki `Procfile`
başlatma komutunu, `.python-version` ise Python sürümünü belirler; ek
yapılandırma gerekmez.

```
web: uvicorn simulation_engine.api.simulation_service:app --host 0.0.0.0 --port $PORT
```

Uygulama, platformun atadığı `PORT` değişkenini okur ve `0.0.0.0` adresine
bağlanır. Dağıtım bitince size `https://...up.railway.app` biçiminde bir adres
verilir.

### 2. Frontend — Vercel

`frontend/.env.production` dosyasındaki değişkene Railway adresini yazın
(sonda eğik çizgi olmadan):

```
VITE_API_BASE_URL=https://optiflow-backend.up.railway.app
```

Vercel'de aynı depoyu içe aktarın ve **Root Directory** olarak `frontend`
seçin. Derleme komutu ve çıktı dizini `frontend/vercel.json` içinde tanımlıdır
(`npm run build`, `dist`).

### 3. Veritabanı — sonuçların kalıcı olması

Railway projesine bir **PostgreSQL** servisi ekleyin. Railway `DATABASE_URL`
değişkenini otomatik tanımlar; uygulama bunu görünce sonuçları veritabanına
yazar, tabloyu ilk çalıştırmada kendisi oluşturur.

Bu adım atlanırsa uygulama çalışmaya devam eder ama sonuçlar bellekte tutulur
ve **sunucu her yeniden başladığında kaybolur** — kullanıcı daha önce
çalıştırdığı bir simülasyonun doğrulama raporunu açmak istediğinde "bulunamadı"
hatası alır.

Kayıtlar 30 gün saklanır; süresi dolanlar her yeni kayıt eklendiğinde silinir.

### 4. CORS — backend'e frontend adresini tanıtın

Railway'de bir ortam değişkeni tanımlayın:

```
FRONTEND_ORIGINS=https://optiflow.vercel.app
```

Birden çok adres virgülle ayrılabilir (Vercel her dala ayrı bir önizleme
adresi verir). Adres kodda sabit değildir; bu yüzden yeni bir adres eklemek
için kaynak kodu düzenlemek ve yeniden dağıtmak gerekmez.

### Ortam değişkenleri

| Değişken | Nerede | Açıklama |
|---|---|---|
| `PORT` | Railway | Platform otomatik atar; elle tanımlamayın |
| `DATABASE_URL` | Railway | PostgreSQL servisi eklenince otomatik tanımlanır. Yoksa sonuçlar bellekte tutulur |
| `FRONTEND_ORIGINS` | Railway | CORS'a eklenecek frontend adresleri (virgülle ayrılmış) |
| `VITE_API_BASE_URL` | Vercel / `.env.production` | Arayüzün bağlanacağı backend adresi |

> `VITE_` önekli değişkenler derleme sırasında paketin içine gömülür ve
> tarayıcıya iner. Bu dosyalara **hiçbir zaman** gizli anahtar yazmayın.

## Proje yapısı

```
simulation_engine/
├── core/            Kesikli olay simülasyonu çekirdeği
│   ├── clock.py         Simülasyon saati, zaman ağırlıklı istatistikler
│   ├── event_queue.py   Heap tabanlı olay kuyruğu
│   ├── entities.py      Entity, Buffer, Server, Resource, Station
│   └── engine.py        Ana olay döngüsü, blokaj ve arıza mantığı
├── distributions/   Olasılık dağılımları (ters dönüşümle örnekleme)
├── analytics/       Kuyruk teorisi, Little's Law, OEE, TOC, Monte Carlo
├── validation/      Analitik doğrulama test paketi
├── api/
│   ├── simulation_service.py  FastAPI uç noktaları
│   └── storage.py             Bellek ve veritabanı depoları (aynı arayüz)
└── models/          Pydantic veri modelleri

frontend/src/
├── components/
│   ├── wizard/      Onboarding sihirbazı (3 adım)
│   ├── editor/      Süreç editörü (React Flow canvas)
│   ├── results/     Sonuç görselleştirme
│   └── shared/      Ortak form ve ipucu bileşenleri
├── lib/             Canvas↔şema dönüşümü, API istemcisi, hata çevirisi
├── templates/       Hazır sektör şablonları
└── types/           Backend şemalarının TypeScript karşılıkları
```

## Doğrulama yaklaşımı

Motor, sonuçları bilinen analitik çözümlerle karşılaştırılarak doğrulanır.
Test paketi şu literatür vakalarını içerir:

- **M/M/1 ve M/M/c** — Gross & Harris, *Fundamentals of Queueing Theory*
- **Erlang kayıp sistemi (M/M/c/c)** — Erlang (1917)
- **Sonlu kuyruk (M/M/1/K)** — kapasite sınırlı sistemler
- **Pollaczek–Khinchine** — üstel olmayan işlem süreleri için kesin çözüm
- **Burke teoremi / Jackson ağı** — seri bağlı kuyrukların bağımsızlığı
- **Factory Physics** — ham işlem süresi ve darboğaz hızı yasaları

Kabul kriteri, simülasyon ortalamasının analitik değerden %5'ten az sapmasıdır.
Tolerans tek bir koşuma değil, **30 bağımsız replikasyonun ortalamasına**
uygulanır: tek koşum, kararlı durum ortalamasının yansız ama yüksek varyanslı
bir kestirimidir ve doğru çalışan bir motoru bile sık sık başarısız gösterir.

## Bilinen sınırlar

- `DATABASE_URL` tanımlı **değilse** sonuçlar bellekte tutulur (en fazla 200
  kayıt, FIFO) ve sunucu yeniden başladığında kaybolur. Yerel geliştirmede bu
  beklenen davranıştır; yayına alınmış bir kurulumda PostgreSQL eklenmelidir.
- Veritabanı şeması `create_all` ile oluşturulur, göç (migration) aracı
  kullanılmaz. Tek tablo ve JSON sütunlar olduğu için içerik değiştiğinde şema
  değişmez; şema gerçekten değişirse Alembic eklemek gerekir.
- Sonsuz değerler JSON'a yazılamadığı için sonlu bir sınıra çevrilir. Yalnızca
  uç durumları etkiler (ör. hiçbir parçanın ulaşamadığı bir istasyonun kapasitesi
  sonsuz görünür) ve dönüşüm kayıplıdır.
- Olay izi (`/trace`) **tek bir replikasyondan** alınan temsili bir örnektir;
  raporlanan istatistikler ise tüm replikasyonların ortalamasına dayanır.
  Animasyonda görülen belirli bir kuyruk birikmesi o koşuma özgü olabilir.
  İz ilk 500 dakikayı kapsar (yaklaşık 200 KB); çok yoğun modellerde olay
  sayısı üst sınıra takılırsa iz kesilir ve bu durum yanıtta bildirilir.
- **Hız sınırlaması (rate limiting) yoktur.** Demo aşaması için kabul edilebilir
  ancak gerçek müşterilere açılmadan önce eklenmelidir: her istek bir
  simülasyon çalıştırdığı için CPU maliyeti yüksektir ve kötü niyetli olmayan
  birkaç eşzamanlı istek bile servisi yavaşlatabilir. `MAX_ESTIMATED_EVENTS`
  sınırı tek bir isteğin boyutunu sınırlar, istek **sayısını** değil.
- **`/docs` herkese açıktır.** Demo aşamasında bilinçli bir tercihtir; API'yi
  incelemek isteyenlere yardımcı olur ve gizli bilgi açığa çıkarmaz. Kapatmak
  için `FastAPI(...)` çağrısına `docs_url=None, redoc_url=None` eklemek yeterlidir.
- Sihirbazdaki "Analiz Et" (doğal dilden model kurma) özelliği henüz hazır
  değildir; modeller form alanlarıyla veya görsel editörle düzenlenir.
- Frontend paket boyutu grafik kütüphanesi nedeniyle 500 kB'ı aşar; sonuç
  sayfasını `React.lazy` ile ayırmak bunu düşürür.
