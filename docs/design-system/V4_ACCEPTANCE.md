# V4 Kabul Tablosu

> ⚠️ **Bu dosya elle düzenlenmez.** Kaynağı
> `frontend/src/lib/designSystem/constitution.ts` içindeki `ACCEPTANCE`
> listesidir ve `constitution.test.ts` belgenin güncel olduğunu doğrular.
> Elle yazılsaydı, kurallar değiştikçe sessizce yalan söylemeye başlardı.

Tasarım Anayasası V4 (MASTER §3.8) kurallarının hangi katmanda korunduğu.

| Kural | Nerede korunuyor | Durum |
| --- | --- | --- |
| Gradient yok | constitution.test.ts (kaynak) + tests/constitution.spec.ts (tarayıcı) | otomatik |
| Glassmorphism yok | constitution.test.ts (kaynak) + tests/constitution.spec.ts (tarayıcı) | otomatik |
| Dekoratif gölge yok | constitution.test.ts (kaynak) + tests/constitution.spec.ts (tarayıcı) | otomatik |
| 44px dokunma hedefi | tests/touch-targets.spec.ts (gerçek vuruş testi) | ölçümle |
| Kanonik renkler | constitution.test.ts — index.css tokenları okunur | otomatik |
| Kanonik yarıçap (14/16/20/24) | constitution.test.ts — index.css tokenları okunur | otomatik |
| Yatay taşma yok | tests/constitution.spec.ts — altı genişlikte ölçülür | ölçümle |
| Kısıt şeridi kısıtı belirleyen ölçümü kodlar | src/lib/live/rail.test.ts | otomatik |
| Ekran statement ile açılır | src/lib/live/statement.test.ts + ekran testleri | otomatik |
| Ölçülmeyen değer sıfıra düşmez | npm run acceptance — izleme katmanı taraması | otomatik |
| Köken (provenance) görünür | src/lib/connectors/bridge/devices.test.ts — besleme durumu | otomatik |
| Tipografi ölçeği (H1 32 / H2 24 / KPI 30) | Henüz otomatik değil; sprint sonunda tarayıcıda ölçülüyor | elle |
| Erişilebilirlik — critical sıfır | tests/a11y.spec.ts (axe-core) — tartışmaya kapalı kademe | ölçümle |
| Erişilebilirlik — yeni tür serious ihlal eklenemez | tests/a11y.spec.ts — üç kalem gerekçeli borç listesinde; listenin uzaması testi düşürür | ölçümle |
| Görsel taban çizgisi | tests/visual.spec.ts — 6 ekran × 6 genişlik | ölçümle |

## Durum ne demek

- **otomatik** — bir test düşerse kural ihlal edilmiş demektir; tarayıcı gerekmez.
- **ölçümle** — gerçek tarayıcıda ölçülür; ihlal testi düşürür.
- **elle** — henüz otomatik değil, sprint sonunda insan bakıyor. Bu satırların
  azalması bir sonraki sprintlerin işidir.

## Korumalı alanlar

Kaynak taraması yalnızca V4'ün zorunlu olduğu alanlarda çalışır:

- `components/live`
- `components/results`
- `components/reports`
- `components/finance`
- `components/heatmap`
- `components/dashboard`
- `components/ui`

## Muafiyetler

Muafiyet gerekçesiz olamaz; testler gerekçesiz muafiyeti de reddeder.

- **Gradient yok** → `components/onboarding/FactoryIllustration`
  Karşılama çizimi bir veri yüzeyi değil, bir illüstrasyondur; hiçbir ölçüm taşımaz, bu yüzden gradient yanıltıcı olamaz.
- **Glassmorphism yok** → `components/operator`
  Operatör ekranı kendi primitif ailesini kullanıyor ve camı bu daldan önce (13228df) almıştı; ayrı bir sprintin borcu.
