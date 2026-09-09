# Sorun giderme

Her başlık bir belirtiyle başlar, nedenini açıklar ve doğrulanabilir bir
komutla biter.

## `/api/ready` 503 dönüyor

Hazırlık ucu, yanıt gövdesinde nedenini söyler:

```bash
curl http://localhost:8000/api/ready
```

`checks` listesindeki `ok: false` olan satır sorunu gösterir:

| Yoklama | Anlamı | Çözüm |
|---|---|---|
| `configuration` | Eksik ya da hatalı ortam değişkeni | `detail` alanındaki anahtarı tanımlayın |
| `database` | Veritabanı okunamıyor | `DATABASE_URL` adresini ve sunucunun ayakta olduğunu doğrulayın |
| `shutdown` | Süreç kapanıyor | Normaldir; yeni kapsayıcı ayağa kalkana kadar sürer |

Sağlık ucunun (`/api/health`) hâlâ 200 dönmesi beklenen davranıştır: süreç
ayaktadır, yalnızca istek kabul etmeye hazır değildir.

## 429 "Çok fazla istek gönderildi"

Hız sınırı devrede. Yanıttaki `Retry-After` başlığı kaç saniye beklenmesi
gerektiğini söyler.

Sınırlar: okuma 120 istek/dakika (30 ani), yazma 30 istek/dakika (10 ani).
Sayaç kimlik başınadır; bir kullanıcının kotası ötekini etkilemez.

Ekran açılışında birkaç uç birden çağrılır ve bu normaldir. Sürekli 429
alıyorsanız arayüzde bir yoklama döngüsü çok sık çalışıyor olabilir; ağ
sekmesinde tekrarlanan isteği arayın.

## CORS hatası: "blocked by CORS policy"

Backend yalnızca `FRONTEND_ORIGINS` içinde yazan adreslere yanıt verir.
Adresi tam yazın (şema dahil, sondaki eğik çizgi olmadan):

```bash
docker compose -f docker-compose.prod.yml exec backend printenv FRONTEND_ORIGINS
```

Joker (`*`) kabul edilmez; üretimde `/api/ready` bunu hata sayar.

## 401 "Oturum acmadan bu uca erisilemez"

Token yok, süresi dolmuş ya da doğrulanamıyor.

Yapılandırmayı doğrulayın (bu uç kimlik ister; token'sız **401** döner —
bu da bir bilgidir: sunucu ayakta ve kimlik doğrulama çalışıyor demektir):

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/ops/environment
```

Token'sız da ortam durumunu görebilirsiniz; hazırlık ucu kimlik istemez:

```bash
curl http://localhost:8000/api/ready
```

`SUPABASE_JWKS_URL` eksikse hiçbir token doğrulanamaz. Ayrıca Supabase
projesinin JWKS adresine sunucudan erişilebildiğini doğrulayın: erişilemezse
uç **503** döner (geçici üst kaynak arızası), 401 değil.

## Bağlantı "Doğrulanmadı" görünüyor

Bir bağlantının "Bağlandı" sayılması için cihazdan **gerçek bir yanıt**
alınmış olması gerekir. Tanımlı olması yetmez.

* OPC UA ve MQTT sürücüleri isteğe bağlıdır. Kurulu değillerse arayüz
  "Doğrulanmadı" yazar ve nedenini söyler.
* Sürücülerin kurulu olduğunu doğrulayın:

```bash
python -c "import asyncua, aiomqtt; print('surucular kurulu')"
```

## Akış açık ama veri gelmiyor

"Bağlantı Bekleniyor" rozeti tam olarak bunu anlatır: soket açık, ölçüm yok.
Açık bir soket akan veri demek değildir.

En sık iki neden: eşleme tablosu eksik (gelen ölçümün hangi makineye ait
olduğu bilinmiyor) ya da konu/düğüm adı yanlış. Son ölçümleri okuyun:

```bash
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8000/api/runtime/device-data?limit=20"
```

Bu uç kimlik ister; `$TOKEN` yerine geçerli bir erişim token'ı yazın. Boş
dönüyorsa cihaz hiç veri göndermiyor; doluysa ama ekran boşsa eşleme
tablosuna bakın.

## Bellek ve işlemci "—" gösteriyor

`psutil` kurulu değil. Ölçüm uydurulmaz; sıfır göstermek, hiç bellek
kullanmayan bir sunucu göstermek olurdu.

```bash
pip install psutil
```

## Veriler yeniden başlatmada kayboluyor

`DATABASE_URL` tanımlı değil. Bu durumda runtime durumu süreç belleğinde
tutulur ve arayüz "Kalıcılık: Doğrulanmadı" yazar.

```bash
curl http://localhost:8000/api/ready
```

`warnings` listesinde `DATABASE_URL` görünüyorsa neden budur.

## Göç hatası: "Can't locate revision"

Veritabanındaki `alembic_version` tablosu, kodun bilmediği bir sürüme
işaret ediyor. Genellikle geri alınmış bir dağıtımdan sonra olur.

Mevcut sürümü okuyun:

```bash
docker compose -f docker-compose.prod.yml exec backend alembic current
```

Kodun bildiği sürümleri listeleyin:

```bash
docker compose -f docker-compose.prod.yml exec backend alembic history
```

## Yedek geri yüklenmiyor

Sağlama tutmuyorsa geri yükleme **bilinçli olarak** yapılmaz ve mevcut veriye
dokunulmaz. Önce doğrulayın:

```bash
python -m simulation_engine.runtime.ops.cli verify --file yedek.json
```

Çıktı hangi bölümün eksik ya da bozuk olduğunu söyler.

## Denetim günlüğü "Yalnızca bellekte" diyor

Kayıtlar diske yazılmıyor; `DATABASE_URL` tanımlı değil. Sunucu yeniden
başladığında günlük kaybolur. Bu, sessiz kalınmaması gereken bir durumdur ve
panel bunu açıkça yazar.

## Kapsayıcı sağlıksız görünüyor

Docker sağlık denetimi `/api/health` ucunu çağırır. Elle deneyin:

```bash
docker compose -f docker-compose.prod.yml exec backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status)"
```

200 dönüyorsa sorun denetim yapılandırmasındadır, uygulamada değil.
