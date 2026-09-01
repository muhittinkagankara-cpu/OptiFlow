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
pip install -r requirements.txt
```

```bash
uvicorn simulation_engine.api.simulation_service:app --reload
```

Servis `http://127.0.0.1:8000` adresinde çalışır. Etkileşimli API
dokümantasyonu: `http://127.0.0.1:8000/docs`

### Uçlar

| Yöntem | Yol | Açıklama |
|---|---|---|
| `POST` | `/api/simulations/run` | Senaryoyu çalıştırır, güven aralıklı sonuç döndürür |
| `GET` | `/api/simulations/{id}/validation-report` | Analitik doğrulama raporu |
| `POST` | `/api/simulations/compare` | Senaryoları istatistiksel anlamlılık testiyle karşılaştırır |

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
> adreslerine izin verir. Frontend'i başka bir portta çalıştırırsanız
> `simulation_engine/api/simulation_service.py` içindeki `ALLOWED_ORIGINS`
> listesini güncellemeniz gerekir.

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
├── api/             FastAPI servis katmanı
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

- Simülasyon sonuçları sunucu belleğinde tutulur (en fazla 200 kayıt, FIFO).
  Sunucu yeniden başlarsa kayıtlar kaybolur ve çok işçili bir dağıtımda
  (`uvicorn --workers 4`) bir işçinin ürettiği kimlik diğerinden okunamaz.
  Üretim dağıtımı için `SimulationStore` bir veritabanıyla değiştirilmelidir.
- Sihirbazdaki "Analiz Et" (doğal dilden model kurma) özelliği henüz hazır
  değildir; modeller form alanlarıyla veya görsel editörle düzenlenir.
- Frontend paket boyutu grafik kütüphanesi nedeniyle 500 kB'ı aşar; sonuç
  sayfasını `React.lazy` ile ayırmak bunu düşürür.
