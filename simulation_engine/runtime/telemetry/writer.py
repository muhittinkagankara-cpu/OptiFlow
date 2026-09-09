"""Telemetri yazıcısı: ölçümleri toplayıp toplu hâlde diske verir.

Neden tampon
------------
Akış motoru saniyede yüzlerce ölçüm üretebilir. Her ölçüm için ayrı bir
veritabanı işlemi açmak, hattı veritabanının hızına bağlar: veritabanı
yavaşladığında cihaz okuması da yavaşlar. Tampon bu bağı koparır.

Neden yazma hatası akışı durdurmaz
----------------------------------
Telemetri **kayıt** amaçlıdır; canlı ekran görüntü tablosundan beslenir. Disk
dolduğunda ya da veritabanı düştüğünde canlı izlemenin de durması, ikincil bir
sorunun birincil işlevi öldürmesi olurdu. Hata sayılır, son hata saklanır ve
tanılama ekranında görünür — ama akış sürer.

Neden sayaçlar burada
---------------------
Tanılama ekranı "saniyede kaç ölçüm yazılıyor?" sorusunu sorar. Bu sayı
ölçülmediği sürece `None` döner; sıfır dönseydi, hiç yazma yapılmamış bir
sistem "saniyede sıfır yazıyor" diye okunur ve arıza gibi görünürdü.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional

from simulation_engine.runtime.telemetry.types import (
    BATCH_SIZE,
    TelemetryBatch,
    TelemetryPoint,
)

#: Tampon dolmasa da en geç bu kadar sonra yazılır (ms).
#:
#: Yavaş bir hatta tampon hiç dolmayabilir; süre sınırı olmasaydı, saatte on
#: ölçüm üreten bir cihazın verisi elli saat tamponda beklerdi.
FLUSH_INTERVAL_MS = 5_000

#: Verim ortalamasının penceresi (ms).
#:
#: On saniye, anlık bir dalgalanmayı yumuşatacak kadar uzun, bir duruşu
#: gizlemeyecek kadar kısadır.
THROUGHPUT_WINDOW_MS = 10_000


@dataclass
class WriterStats:
    """Yazıcının sayaçları; tanılama ekranı bunları okur."""

    #: Tampona alınan ölçüm sayısı.
    queued: int = 0
    #: Diske yazılan satır sayısı.
    written: int = 0
    #: Tekrarlandığı için yeni satır olmayan ölçümler.
    duplicates: int = 0
    #: Yazma denemesi sayısı (toplu yazma çağrısı).
    flushes: int = 0
    #: Başarısız yazma sayısı.
    errors: int = 0
    #: Son hata metni; hiç hata olmadıysa `None`.
    last_error: Optional[str] = None
    #: Son başarılı yazmanın anı; hiç yazılmadıysa `None`.
    last_flush_ms: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "queued": self.queued,
            "written": self.written,
            "duplicates": self.duplicates,
            "flushes": self.flushes,
            "errors": self.errors,
            "last_error": self.last_error,
            "last_flush_ms": self.last_flush_ms,
        }


def writes_per_second(samples: List[tuple], now_ms: int) -> Optional[float]:
    """Pencere içindeki yazma hızı; ölçülemiyorsa `None`.

    Örnek yoksa ya da hepsi pencerenin dışında kaldıysa hız **bilinmiyor**
    demektir. Sıfır döndürmek, "sistem hiç yazmıyor" ile "henüz ölçmedik"
    arasındaki farkı yok ederdi.
    """
    window = [
        (at_ms, count)
        for at_ms, count in samples
        if now_ms - at_ms <= THROUGHPUT_WINDOW_MS
    ]
    if not window:
        return None
    total = sum(count for _, count in window)
    oldest = min(at_ms for at_ms, _ in window)
    span_ms = max(1, now_ms - oldest)
    return round(total * 1000.0 / span_ms, 2)


class TelemetryWriter:
    """Ölçümleri tamponlar ve depoya toplu hâlde yazar.

    Depo arayüzü yalnızca `write_telemetry(org_id, points) -> int` bekler;
    bellek deposu da veritabanı deposu da bu arayüzü karşılar, yazıcı
    hangisiyle konuştuğunu bilmez.
    """

    def __init__(
        self,
        repository,
        org_id: str,
        capacity: int = BATCH_SIZE,
        flush_interval_ms: int = FLUSH_INTERVAL_MS,
    ) -> None:
        self._repository = repository
        self._org_id = org_id
        self._batch = TelemetryBatch(capacity=capacity)
        self._flush_interval_ms = flush_interval_ms
        self._stats = WriterStats()
        #: (an, satır) çiftleri; verim hesabı için.
        self._samples: List[tuple] = []

    @property
    def stats(self) -> WriterStats:
        return self._stats

    @property
    def pending(self) -> int:
        """Tamponda bekleyen ölçüm sayısı."""
        return len(self._batch)

    def submit(self, point: TelemetryPoint, now_ms: int) -> int:
        """Bir ölçümü tampona alır; tampon dolduysa yazar.

        Dönen değer bu çağrıda diske yazılan satır sayısıdır; yazma olmadıysa
        sıfırdır.
        """
        self._stats.queued += 1
        full = self._batch.add(point)
        if full:
            return self.flush(now_ms)
        return 0

    def submit_many(self, points: Iterable[TelemetryPoint], now_ms: int) -> int:
        written = 0
        for point in points:
            written += self.submit(point, now_ms)
        return written

    def due(self, now_ms: int) -> bool:
        """Süre sınırı doldu mu?

        Tampon boşsa hiçbir zaman gerekmez: boş bir yazma işlemi açmak
        veritabanına gereksiz gidip gelmektir.
        """
        if self._batch.is_empty:
            return False
        if self._stats.last_flush_ms is None:
            return True
        return now_ms - self._stats.last_flush_ms >= self._flush_interval_ms

    def flush(self, now_ms: int) -> int:
        """Tamponu diske yazar; yazılan satır sayısını döndürür.

        Yazma başarısız olursa ölçümler **düşer**. Tamponda tutulsalardı,
        sürekli başarısız olan bir veritabanı karşısında tampon sınırsız
        büyür ve süreç belleği tükenirdi. Hata sayacı ve son hata metni bu
        kaybı görünür kılar.
        """
        if self._batch.is_empty:
            return 0
        points = self._batch.drain()
        self._stats.flushes += 1
        try:
            written = int(self._repository.write_telemetry(self._org_id, points))
        except Exception as error:  # depo hatası akışı durdurmaz
            self._stats.errors += 1
            self._stats.last_error = str(error)
            return 0
        self._stats.written += written
        self._stats.duplicates += max(0, len(points) - written)
        self._stats.last_flush_ms = now_ms
        self._samples.append((now_ms, written))
        self._trim_samples(now_ms)
        return written

    def _trim_samples(self, now_ms: int) -> None:
        self._samples = [
            item for item in self._samples if now_ms - item[0] <= THROUGHPUT_WINDOW_MS
        ]

    def writes_per_second(self, now_ms: int) -> Optional[float]:
        """Yazma hızı; hiç örnek yoksa `None`."""
        return writes_per_second(self._samples, now_ms)

    def diagnostics(self, now_ms: int) -> Dict[str, Any]:
        """Tanılama ekranının okuduğu özet."""
        payload = self._stats.to_dict()
        payload["pending"] = self.pending
        payload["writes_per_second"] = self.writes_per_second(now_ms)
        return payload
