# Kurulum

OptiFlow'u yerel bir makinede çalıştırmak için gerekenler. Yayına alma
adımları için [DEPLOY.md](DEPLOY.md) dosyasına bakın.

## Gereksinimler

| Bileşen | Sürüm | Neden |
|---|---|---|
| Python | 3.12 | Backend bu sürümle sınandı |
| Node.js | 20+ | Vite 6 daha eski sürümlerde çalışmaz |
| PostgreSQL | 16 (isteğe bağlı) | Tanımlı değilse veriler bellekte tutulur |

Veritabanı **isteğe bağlıdır**: `DATABASE_URL` tanımlı değilken uygulama
açılır ve çalışır, ama sunucu yeniden başladığında runtime durumu kaybolur.
Arayüz bunu "Kalıcılık: Doğrulanmadı" olarak gösterir.

## Backend

```bash
python -m venv .venv
```

```bash
.venv/Scripts/activate
```

Linux ve macOS'ta `source .venv/bin/activate` kullanın.

```bash
pip install -r requirements.txt
```

Test araçları ayrı bir dosyadadır; yalnızca geliştirme için gereklidir:

```bash
pip install -r requirements-dev.txt
```

Şemayı hazırlayın (veritabanı tanımlıysa göçleri uygular):

```bash
python -m simulation_engine.api.schema_bootstrap
```

Sunucuyu başlatın:

```bash
uvicorn simulation_engine.api.simulation_service:app --reload --port 8000
```

Doğrulama — bu komut `{"status":"ok",...}` döndürmelidir:

```bash
curl http://127.0.0.1:8000/api/health
```

Hazırlık ucu, eksik ayarları ve yoklamaları listeler:

```bash
curl http://127.0.0.1:8000/api/ready
```

## Arayüz

```bash
cd frontend && npm install
```

```bash
cd frontend && npm run dev
```

Arayüz varsayılan olarak `http://127.0.0.1:8000` adresindeki API'yi arar.
Farklı bir adres için `frontend/.env.local` dosyasına yazın:

```bash
echo "VITE_API_BASE_URL=http://127.0.0.1:8000" > frontend/.env.local
```

## Ortam değişkenleri

`.env.example` dosyası bütün değişkenleri açıklamalarıyla listeler. Yerel
geliştirmede hiçbiri zorunlu değildir; üretimde `SUPABASE_JWKS_URL` ve
`FRONTEND_ORIGINS` zorunludur ve eksiklerse `/api/ready` **503** döner.

| Değişken | Zorunlu | Etkisi |
|---|---|---|
| `OPTIFLOW_ENV` | hayır | `production` yazıldığında eksik ayarlar hata sayılır |
| `DATABASE_URL` | hayır | Tanımsızsa veriler bellekte tutulur |
| `SUPABASE_JWKS_URL` | üretimde | Token doğrulama; olmadan hiçbir uç açılmaz |
| `FRONTEND_ORIGINS` | üretimde | CORS beyaz listesi; joker (`*`) kabul edilmez |

## Testler

```bash
python -m pytest simulation_engine -q
```

```bash
cd frontend && npm test
```

Sprint kabul listesi (tip denetimi, iki test süiti ve güvenlik denetimleri):

```bash
cd frontend && npm run acceptance
```

## Sık karşılaşılan sorunlar

Sorun giderme adımları [TROUBLESHOOTING.md](TROUBLESHOOTING.md) dosyasındadır.
