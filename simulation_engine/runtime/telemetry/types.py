"""Kalıcı telemetri: zaman serisinin modeli.

Neden görüntü (snapshot) yetmiyor
---------------------------------
`device_snapshots` yalnızca **son** değeri tutar. "Bu makine dün gece 03:00'te
ne yapıyordu?" sorusunun yanıtı orada yoktur; vardiya sonunda üretimin nasıl
seyrettiği de görülemez. Trend ekranı, duruş analizi ve devreye alma raporu
bir zaman serisi ister.

Neden ayrı bir tablo
--------------------
Olay günlüğü (`runtime_events`) insan okuması içindir ve sınırlıdır (5.000
kayıt). Telemetri sayısaldır, çok daha yoğundur ve farklı sorgulanır: "şu
etiketin son bir saatteki değerleri" sorgusu, olay günlüğünde tam tarama
gerektirirdi.

Kalite neden taşınır
--------------------
Bozuk kaliteli bir ölçüm de kaydedilir ama trend hesabına **girmez**. Hiç
kaydedilmeseydi, bir sensörün ne zaman bozulduğu geriye dönük olarak
anlaşılamazdı.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional

#: Toplu yazmada bir seferde gönderilen en fazla satır.
#:
#: Beş yüz satır, saniyede yüz ölçüm üreten bir hatta beş saniyelik tampon
#: demektir. Daha büyük bir yığın, bir hata durumunda daha çok veri kaybeder;
#: daha küçüğü ise veritabanına gereğinden çok gidip gelir.
BATCH_SIZE = 500

#: Varsayılan saklama süresi (gün).
#:
#: Otuz gün, bir aylık vardiya karşılaştırması için yeterlidir ve saniyede on
#: ölçüm üreten bir hatta yaklaşık 26 milyon satır eder — indeksli bir
#: PostgreSQL için makul bir büyüklük.
DEFAULT_RETENTION_DAYS = 30

#: Bir temizleme turunda silinen en fazla satır.
#:
#: Sınırsız silme, milyonlarca satırlık bir tabloda uzun süren bir kilit
#: yaratır ve bu sırada yazmalar bekler. Turlara bölmek, temizliği canlı
#: sistemde çalıştırılabilir kılar.
CLEANUP_BATCH = 10_000


@dataclass(frozen=True)
class TelemetryPoint:
    """Zaman serisindeki tek bir ölçüm."""

    #: Ölçümün cihazdaki anı (epoch ms). Bu modülde saat okunmaz.
    timestamp_ms: int
    device: str
    #: Ölçümün adı (`production_count`, `queue_length`, ...).
    tag: str
    value: Optional[float]
    quality: str = "good"
    #: Ölçümü getiren bağlantı; bilinmiyorsa `None`.
    source: Optional[str] = None

    @property
    def is_usable(self) -> bool:
        """Bu ölçüm trend hesabına girebilir mi?

        Bozuk kaliteli ya da değeri olmayan bir ölçüm grafikte nokta olmaz;
        yine de kaydedilir, çünkü bir sensörün ne zaman bozulduğu ancak
        böyle görülür.
        """
        return self.quality != "bad" and self.value is not None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp_ms": self.timestamp_ms,
            "device": self.device,
            "tag": self.tag,
            "value": self.value,
            "quality": self.quality,
            "source": self.source,
            "usable": self.is_usable,
        }


def point_key(org_id: str, point: TelemetryPoint) -> str:
    """Bir ölçümün birincil anahtarı: `kiracı::cihaz::etiket::an`.

    Aynı cihazın aynı etiketi aynı anda iki farklı değer alamaz. Anahtar
    yalnızca zamandan oluşsaydı, iki makinenin aynı milisaniyedeki ölçümü
    çakışırdı; sıra numarasından oluşsaydı, kurtarmadan sonra aynı ölçüm
    ikinci kez yazılırdı.
    """
    return f"{org_id}::{point.device}::{point.tag}::{point.timestamp_ms}"


@dataclass
class TelemetryBatch:
    """Diske yazılmayı bekleyen ölçümler.

    Her ölçümü tek tek yazmak, saniyede yüz ölçüm üreten bir hatta saniyede
    yüz işlem açar. Toplu yazma bunu tek işleme indirir.
    """

    points: List[TelemetryPoint] = field(default_factory=list)
    capacity: int = BATCH_SIZE

    def add(self, point: TelemetryPoint) -> bool:
        """Ölçümü tampona alır; tampon dolduysa `True` döner."""
        self.points.append(point)
        return len(self.points) >= self.capacity

    def extend(self, points: Iterable[TelemetryPoint]) -> bool:
        for point in points:
            self.points.append(point)
        return len(self.points) >= self.capacity

    def drain(self) -> List[TelemetryPoint]:
        """Tamponu boşaltır ve içeriğini döndürür."""
        items = list(self.points)
        self.points.clear()
        return items

    @property
    def is_empty(self) -> bool:
        return not self.points

    def __len__(self) -> int:
        return len(self.points)


@dataclass(frozen=True)
class TrendWindow:
    """Trend sorgusunun zaman aralığı."""

    id: str
    label: str
    duration_ms: int
    #: Grafikte kaç kova (bucket) olacağı.
    buckets: int

    @property
    def bucket_ms(self) -> int:
        """Bir kovanın süresi; en az 1 ms."""
        return max(1, self.duration_ms // max(1, self.buckets))


#: Ekrandaki üç pencere.
#:
#: Kova sayıları bilinçli: bir saatlik pencerede dakikalık çözünürlük, günlük
#: pencerede saatlik, haftalıkta üç saatlik. Hepsinde aynı kova sayısını
#: kullanmak, haftalık grafiği okunamayacak kadar gürültülü yapardı.
TREND_WINDOWS: Dict[str, TrendWindow] = {
    "1h": TrendWindow(id="1h", label="Son 1 saat", duration_ms=3_600_000, buckets=60),
    "24h": TrendWindow(id="24h", label="Son 24 saat", duration_ms=86_400_000, buckets=24),
    "7d": TrendWindow(
        id="7d", label="Son 7 gün", duration_ms=7 * 86_400_000, buckets=56
    ),
}


def window_of(window_id: str) -> Optional[TrendWindow]:
    """Pencere kimliğini çözer; tanınmıyorsa `None`.

    Varsayılana düşmek yanlış olurdu: kullanıcı yedi günlük veri isterken bir
    saatlik grafik görse, ekranda yanlış bir dönem okuyordu.
    """
    return TREND_WINDOWS.get(window_id)


@dataclass
class TrendBucket:
    """Bir zaman kovasındaki özet."""

    start_ms: int
    end_ms: int
    #: Kovaya düşen ölçüm sayısı.
    count: int = 0
    #: Ölçüm yoksa `None`; sıfır yazılmaz.
    average: Optional[float] = None
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    #: Kovadaki son değer; sayaçlar için ortalamadan daha anlamlıdır.
    last: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "count": self.count,
            "average": self.average,
            "min": self.minimum,
            "max": self.maximum,
            "last": self.last,
        }


@dataclass
class TrendSeries:
    """Bir cihaz-etiket çiftinin zaman serisi."""

    device: str
    tag: str
    window: str
    buckets: List[TrendBucket] = field(default_factory=list)
    #: Seride kaç ölçüm var? Sıfırsa grafik boş çizilir, sıfır çizgi değil.
    total_points: int = 0

    @property
    def has_data(self) -> bool:
        return self.total_points > 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "device": self.device,
            "tag": self.tag,
            "window": self.window,
            "buckets": [item.to_dict() for item in self.buckets],
            "total_points": self.total_points,
            "has_data": self.has_data,
        }
