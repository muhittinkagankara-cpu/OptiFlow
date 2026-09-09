# Yedekleme ve geri yükleme

## Yedek neyi kapsar

| Bölüm | İçerik |
|---|---|
| `connections` | Bağlantı tanımları, abonelik ayarları, eşleme tabloları |
| `snapshots` | Her makinenin son bilinen durumu |
| `health` | Bağlantı başına sağlık sayaçları |
| `downtime` | Duruş aralıkları |
| `audit` | Denetim kayıtları (okunur, geri yüklenmez) |

Yedek **mantıksaldır**: veritabanı dosyasının kopyası değil, tabloların JSON
çıktısıdır. Bunun iki nedeni var. SQLite dosyasını yazma sırasında kopyalamak
bozuk bir yedek üretir; PostgreSQL için zaten mümkün değildir. İkincisi, aynı
JSON dosyası **her iki motorda da** geri yüklenebilir — ilk fabrikadan
üretime geçerken en olası senaryo budur.

Parolalar yedeğe girmez: veritabanında zaten saklanmazlar, yalnızca "parola
tanımlı mı" bilgisi tutulur.

## Komut satırı

Yedek almanın en çok gerektiği an, uygulamanın açılamadığı andır. Bu yüzden
araç yalnızca veritabanına bağlanır; uygulamanın ayakta olması gerekmez.

Yedek al:

```bash
python -m simulation_engine.runtime.ops.cli backup --org ORG_ID --out yedek.json
```

Doğrula (geri yüklemeden önce her zaman):

```bash
python -m simulation_engine.runtime.ops.cli verify --file yedek.json
```

Geri yükle:

```bash
python -m simulation_engine.runtime.ops.cli restore --file yedek.json --org ORG_ID
```

Veritabanı adresi `DATABASE_URL` ortam değişkeninden okunur; `--database-url`
ile de verilebilir. Tanımlı değilse araç **çalışmaz** ve bunu söyler: bellek
deposundan yedek almak, boş bir dosya üretip "yedek alındı" demek olurdu.

## Arayüzden

Operasyon ekranındaki Yedekleme paneli üç işlem sunar: yedek al, indir, geri
yükle. Geri yükleme onay ister ve neyin silineceğini önceden söyler.

## Doğrulama neden zorunlu

Her yedek içeriğinden türeyen bir **sağlama** taşır. Geri yükleme öncesi
sağlama yeniden hesaplanır; tutmazsa geri yükleme **yapılmaz** ve mevcut
veriye dokunulmaz. Bozuk bir yedeği yüklemek, veriyi kaybetmenin en sessiz
yoludur.

## Geri yükleme neyi siler

Geri yükleme, hedef kiracının bağlantılarını, görüntülerini ve duruş
kayıtlarını **siler** ve yedektekilerle değiştirir. Üstüne eklenseydi,
silinmiş bir kayıt geri gelmez ve iki durumun karışımı ortaya çıkardı;
"geri yükleme" o zaman yedeğin durumunu değil, iki durumun birleşimini
verirdi.

**Denetim kayıtlarına dokunulmaz.** Ne silinir ne geri yüklenir:
değiştirilemez bir günlüğün yedekten yeniden yazılabilmesi, geçmişin
değiştirilebilmesi demek olurdu.

## Doğrulanmış senaryo

Aşağıdaki akış hem SQLite hem gerçek PostgreSQL üzerinde otomatik testlerle
koşulur (`test_ops_backup.py`, `test_ops_postgres.py`):

1. Veri oluştur (bağlantı, görüntü, sağlık, duruş)
2. Yedek al
3. Sil
4. Geri yükle
5. Verinin geri geldiğini doğrula

Ayrıca bozuk bir yedeğin **veriyi silmediği** de sınanır.

## Ne sıklıkla

Yedek sıklığı için bir kural koymuyoruz; kurulumun veri kaybı toleransına
bağlıdır. Ama iki şey kesindir: ilk kurulumdan sonra bir yedek alın ve
**geri yüklemeyi bir kez deneyin**. Hiç denenmemiş bir yedek, yedek sayılmaz.
