# Yayına alma

Bu belge OptiFlow'un üretim kurulumunu anlatır. Yerel kurulum için
[INSTALL.md](INSTALL.md) dosyasına bakın.

> **Doğrulama durumu:** Bu belgedeki `docker compose` komutları bu depoda
> **çalıştırılarak doğrulanmadı** — geliştirme makinesinde Docker kurulu
> değildi. Compose dosyasının sözdizimi ve servis tanımları doğrulandı;
> imajların derlenmesi ve ayağa kalkması ilk kurulumda sınanmalıdır.
> Uygulama uçları (`/api/health`, `/api/ready`) gerçek HTTP istekleriyle
> doğrulandı.

## 1. Ortamı hazırlayın

```bash
cp .env.example .env
```

`.env` dosyasını doldurun. Üretimde şu üçü **zorunludur**:

* `SUPABASE_JWKS_URL` — token doğrulama adresi. Eksikse hiçbir uç açılmaz.
* `FRONTEND_ORIGINS` — arayüzün tam adresi. Joker (`*`) kabul edilmez;
  gereğinden geniş bir CORS ayarı, tarayıcıdaki herhangi bir sitenin bu
  API'yi çağırmasına izin verirdi.
* `POSTGRES_PASSWORD` — veritabanı parolası.

`.env` dosyası sürüm kontrolüne **girmez**. Compose dosyasına gömülseydi,
parolalar depo geçmişinde kalıcı olarak dururdu.

## 2. Ayağa kaldırın

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Üç servis başlar: `db`, `backend`, `frontend`. Backend, veritabanı sağlık
denetimini geçene kadar başlatılmaz (`depends_on: condition:
service_healthy`); beklemeseydi ilk göç denemesi kapalı bir veritabanına
çarpardı.

## 3. Doğrulayın

Canlılık — süreç ayakta mı:

```bash
curl -f http://localhost:8000/api/health
```

Hazırlık — istek gönderilebilir mi:

```bash
curl -f http://localhost:8000/api/ready
```

Hazırlık **503** dönerse gövdedeki `checks` listesi nedenini söyler: eksik
ayar, okunamayan veritabanı ya da kapanmakta olan süreç.

Kapsayıcı durumları:

```bash
docker compose -f docker-compose.prod.yml ps
```

## Sağlık ve hazırlık neden ayrı

| Uç | Soru | Yanıt hayırsa |
|---|---|---|
| `/api/health` | Süreç ayakta mı? | Düzenleyici kapsayıcıyı yeniden başlatır |
| `/api/ready` | İstek gönderilebilir mi? | Yük dengeleyici trafiği keser, kapsayıcı yaşar |

Docker sağlık denetimi **canlılık** ucunu kullanır. Hazırlık ucunu
kullansaydı, veritabanı bir dakikalığına yavaşladığında bütün kapsayıcılar
sırayla yeniden başlar ve kesinti dakikalara çıkardı.

## Zarif kapanış

Kapanış sinyali geldiğinde uygulama açık cihaz akışlarını durdurur ve süren
istekleri bitirir. Compose'da `stop_grace_period: 30s` tanımlıdır; varsayılan
10 saniye, uzun bir yoklama döngüsünü yarıda kesebilirdi.

## Göçler

Kapsayıcı açılışta `schema_bootstrap` çalıştırır: eksik tablolar oluşturulur ve
alembic göçleri uygulanır. Elle uygulamak için:

```bash
docker compose -f docker-compose.prod.yml exec backend alembic upgrade head
```

Geri almak için (yalnızca bilinçli bir kararla):

```bash
docker compose -f docker-compose.prod.yml exec backend alembic downgrade -1
```

## Güvenlik varsayılanları

Aşağıdakiler kod içinde açıktır; yapılandırma gerektirmez:

| Önlem | Değer | Neyi kapatır |
|---|---|---|
| Hız sınırı (okuma) | 120 istek/dk, 30 ani | Çalınmış token ile aşırı sorgu |
| Hız sınırı (yazma) | 30 istek/dk, 10 ani | Pahalı işlemin ucuzla aynı sıklıkta yapılması |
| Gövde sınırı | 1 MB | Tek istekle belleği doldurma |
| `X-Content-Type-Options` | `nosniff` | JSON yanıtın HTML sanılıp çalıştırılması |
| `X-Frame-Options` | `DENY` | Tıklama hırsızlığı |
| `Content-Security-Policy` | `default-src 'none'` | Yanıttan kaynak yüklenmesi |
| HSTS | yalnızca üretimde | Şifresiz bağlantı |

`/api/health` ve `/api/ready` hız sınırından **muaftır**: saniyede bir soran
bir sağlık denetimi sınırlanırsa, sağlıklı bir kapsayıcı ölü sayılıp yeniden
başlatılır.

## Yedekleme

Yedekleme ve geri yükleme [BACKUP.md](BACKUP.md) dosyasındadır. İlk kurulumdan
sonra **ilk yedeği alın ve doğrulayın**; doğrulanmamış bir yedek, yedek
sayılmaz.
