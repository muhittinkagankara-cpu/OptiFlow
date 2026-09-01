"""Simülasyon saati ve zamana bağlı istatistik toplayıcıları.

Kesikli olay simülasyonunda zaman sürekli akmaz; saat, olaydan olaya sıçrar
(next-event time advance). Bu modül üç şey sağlar:

1. `SimulationClock` — yalnızca ileri akabilen, tek doğruluk kaynağı olan saat.
2. `TimeWeightedAccumulator` — **zaman ağırlıklı** ortalamalar için integral
   toplayıcı. Ortalama kuyruk boyu (Lq), ortalama sistemdeki parça sayısı (L)
   ve kullanım oranı (rho) gibi büyüklükler basit aritmetik ortalama ile
   hesaplanamaz; bir durumun ne kadar **süre** boyunca geçerli olduğu ağırlıktır:

       zaman ortalaması = (1 / T) * integral_0^T x(t) dt

3. `Tally` — gözlem tabanlı (observation-based) ortalamalar için sayaç.
   Bekleme süresi (Wq) ve akış süresi (W) gibi büyüklükler her parça için bir
   gözlemdir ve düz aritmetik ortalama ile hesaplanır.

Bu iki istatistik türünün karıştırılması, simülasyon literatüründeki en sık
hatalardan biridir (Law 2015, Bölüm 1.4.3: "discrete-time" ve "continuous-time"
istatistikler). Ayrı sınıflar olarak modellenmeleri bu hatayı yapısal olarak
imkânsız kılar.

Varyans hesabı Welford'un çevrim içi algoritmasıyla yapılır; ham kareler
toplamı yönteminin büyük örneklem boyutlarında yaşadığı kayan nokta kaybını
önler (Welford 1962; Knuth, *TAOCP* Vol. 2, Bölüm 4.2.2).
"""

from __future__ import annotations

import math

#: Kayan nokta karşılaştırmalarında kullanılan zaman toleransı. Olay zamanları
#: kayan nokta toplamlarıyla üretildiği için, teorik olarak eşit iki zaman
#: damgası arasında ~1e-16 mertebesinde fark oluşabilir; saatin geriye gittiği
#: sanılmamalıdır.
TIME_EPSILON: float = 1e-9


class SimulationClock:
    """Simülasyon zamanının tek doğruluk kaynağı.

    Saat yalnızca ileri alınabilir. Geriye alma girişimi sessizce yok sayılmaz,
    hata olarak yükseltilir: zamanın geri gitmesi olay kuyruğunun sıralama
    değişmezini bozar ve tüm zaman ağırlıklı istatistikleri geçersiz kılar.
    """

    def __init__(self, start_time: float = 0.0) -> None:
        """Saati başlangıç zamanına kurar.

        Args:
            start_time: Simülasyonun başlangıç zamanı (dakika).
        """
        self._start_time = float(start_time)
        self._now = float(start_time)

    @property
    def now(self) -> float:
        """Geçerli simülasyon zamanı (dakika)."""
        return self._now

    @property
    def start_time(self) -> float:
        """Saatin kurulduğu başlangıç zamanı."""
        return self._start_time

    @property
    def elapsed(self) -> float:
        """Başlangıçtan bu yana geçen simülasyon süresi."""
        return self._now - self._start_time

    def advance_to(self, time: float) -> None:
        """Saati verilen zamana ilerletir.

        Args:
            time: Yeni simülasyon zamanı; geçerli zamandan küçük olamaz.

        Raises:
            ValueError: Zaman `TIME_EPSILON` toleransından fazla geriye alınmak
                istenirse.
        """
        if time < self._now - TIME_EPSILON:
            raise ValueError(
                f"Simulasyon saati geriye alinamaz: su an {self._now}, istenen {time}."
            )
        # Tolerans içindeki küçük geri sapmalar düzleştirilir; saat monoton kalır.
        self._now = max(time, self._now)

    def reset(self, start_time: float | None = None) -> None:
        """Saati yeniden kurar (yeni bir replikasyona başlarken)."""
        if start_time is not None:
            self._start_time = float(start_time)
        self._now = self._start_time

    def __repr__(self) -> str:
        return f"SimulationClock(now={self._now:.6f})"


class TimeWeightedAccumulator:
    """Bir durum değişkeninin zaman integralini biriktirir.

    Kullanım kalıbı: değişkenin değeri her **değiştiğinde** `observe()` çağrılır.
    Toplayıcı, önceki değerin geçerli olduğu süre kadar alanı biriktirir ve yeni
    değere geçer. Ölçüm penceresi sonunda `time_average` doğrudan aranan zaman
    ağırlıklı ortalamayı verir.

    Örnek: bir tamponun uzunluğu. Parça girip çıktıkça `observe(len(buffer))`
    çağrılır; `time_average` istasyonun Lq değeridir.
    """

    def __init__(self, clock: SimulationClock, initial_value: float = 0.0) -> None:
        """Toplayıcıyı saate bağlar ve başlangıç değerini kaydeder.

        Args:
            clock: Zamanı okunacak simülasyon saati.
            initial_value: Değişkenin pencere başındaki değeri.
        """
        self._clock = clock
        self._value = float(initial_value)
        self._area = 0.0
        self._window_start = clock.now
        self._last_update = clock.now
        self._max_value = float(initial_value)
        self._min_value = float(initial_value)

    # ------------------------------------------------------------------ #
    # Güncelleme
    # ------------------------------------------------------------------ #
    def _accrue(self) -> None:
        """Son güncellemeden bu yana geçen sürenin alanını biriktirir."""
        now = self._clock.now
        elapsed = now - self._last_update
        if elapsed > 0.0:
            self._area += self._value * elapsed
        self._last_update = now

    def observe(self, value: float) -> None:
        """Değişkenin yeni değerini kaydeder (değer değiştiği anda çağrılır)."""
        self._accrue()
        self._value = float(value)
        if value > self._max_value:
            self._max_value = float(value)
        if value < self._min_value:
            self._min_value = float(value)

    def increment(self, delta: float = 1.0) -> None:
        """Değişkeni `delta` kadar artırır (kuyruk/sunucu sayaçları için kısayol)."""
        self.observe(self._value + delta)

    def decrement(self, delta: float = 1.0) -> None:
        """Değişkeni `delta` kadar azaltır."""
        self.observe(self._value - delta)

    def finalize(self) -> None:
        """Pencere sonunda kalan alanı biriktirir; değer değiştirilmez.

        Simülasyon bittiğinde son durum değişikliğinden çalışma sonuna kadar
        geçen süre henüz integrale eklenmemiştir; bu metot onu ekler.
        """
        self._accrue()

    def reset(self) -> None:
        """Ölçüm penceresini şu andan itibaren yeniden başlatır.

        Isınma periyodunun sonunda çağrılır: biriken alan silinir ama değişkenin
        **mevcut değeri korunur**. Bu kritik bir ayrımdır — ısınma sonunda
        sistemde bulunan parçalar kaybolmaz, yalnızca o ana kadarki gözlemler
        istatistiklerden düşülür (Welch'in yöntemi).
        """
        self._accrue()
        self._area = 0.0
        self._window_start = self._clock.now
        self._max_value = self._value
        self._min_value = self._value

    # ------------------------------------------------------------------ #
    # Sonuçlar
    # ------------------------------------------------------------------ #
    @property
    def current_value(self) -> float:
        """Değişkenin şu andaki değeri."""
        return self._value

    @property
    def area(self) -> float:
        """Pencere başından bu yana biriken integral."""
        return self._area

    @property
    def window_duration(self) -> float:
        """Ölçüm penceresinin uzunluğu."""
        return self._last_update - self._window_start

    @property
    def time_average(self) -> float:
        """Zaman ağırlıklı ortalama; pencere sıfır uzunluktaysa 0.0."""
        duration = self.window_duration
        if duration <= 0.0:
            return 0.0
        return self._area / duration

    @property
    def max_value(self) -> float:
        """Pencere içinde gözlenen en büyük değer."""
        return self._max_value

    @property
    def min_value(self) -> float:
        """Pencere içinde gözlenen en küçük değer."""
        return self._min_value

    def __repr__(self) -> str:
        return (
            f"TimeWeightedAccumulator(value={self._value:g}, "
            f"time_average={self.time_average:.6g}, max={self._max_value:g})"
        )


class Tally:
    """Gözlem tabanlı istatistik sayacı (bekleme süresi, akış süresi vb.).

    Ortalama ve varyans, Welford'un çevrim içi algoritmasıyla tek geçişte ve
    sayısal olarak kararlı biçimde hesaplanır. Milyonlarca gözlem toplayan uzun
    simülasyonlarda ham `sum(x^2)` yaklaşımı anlamlı basamak kaybına yol açar.
    """

    def __init__(self) -> None:
        """Boş bir sayaç oluşturur."""
        self._count: int = 0
        self._mean: float = 0.0
        self._m2: float = 0.0
        self._total: float = 0.0
        self._min: float = math.inf
        self._max: float = -math.inf

    def record(self, value: float) -> None:
        """Tek bir gözlemi kaydeder.

        Sıfır değerli gözlemler de kaydedilmelidir: örneğin kuyrukta hiç
        beklemeden hizmete giren bir parçanın bekleme süresi 0'dır ve Wq
        ortalamasının paydasına dahil olmalıdır. Bu gözlemin atlanması,
        M/M/1 doğrulamasında Wq'yu sistematik olarak yukarı saptırır.
        """
        value = float(value)
        self._count += 1
        self._total += value
        delta = value - self._mean
        self._mean += delta / self._count
        self._m2 += delta * (value - self._mean)
        if value < self._min:
            self._min = value
        if value > self._max:
            self._max = value

    def reset(self) -> None:
        """Tüm gözlemleri siler (ısınma periyodunun sonunda çağrılır)."""
        self._count = 0
        self._mean = 0.0
        self._m2 = 0.0
        self._total = 0.0
        self._min = math.inf
        self._max = -math.inf

    @property
    def count(self) -> int:
        """Kaydedilen gözlem sayısı."""
        return self._count

    @property
    def total(self) -> float:
        """Gözlemlerin toplamı."""
        return self._total

    @property
    def mean(self) -> float:
        """Örneklem ortalaması; gözlem yoksa 0.0."""
        return self._mean if self._count > 0 else 0.0

    @property
    def variance(self) -> float:
        """Yansız örneklem varyansı (n-1 bölenli); iki gözlemden azsa 0.0."""
        if self._count < 2:
            return 0.0
        return self._m2 / (self._count - 1)

    @property
    def std_dev(self) -> float:
        """Örneklem standart sapması."""
        return math.sqrt(self.variance)

    @property
    def minimum(self) -> float:
        """En küçük gözlem; gözlem yoksa 0.0."""
        return self._min if self._count > 0 else 0.0

    @property
    def maximum(self) -> float:
        """En büyük gözlem; gözlem yoksa 0.0."""
        return self._max if self._count > 0 else 0.0

    def __repr__(self) -> str:
        return f"Tally(count={self._count}, mean={self.mean:.6g}, std={self.std_dev:.6g})"
