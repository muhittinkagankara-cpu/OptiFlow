"""Ampirik dağılım — sahadan toplanan gerçek gözlemlerden dağılım oluşturma.

Teorik dayanak
--------------
Bir işlem süresi hiçbir teorik dağılıma iyi uymuyorsa (çok tepeli, kesikli
sıçramalı veya karma dağılımlar), veriyi zorla bir teorik dağılıma uydurmak
yerine doğrudan gözlemlerden örneklemek daha doğru bir modelleme kararıdır.
Bu modül iki yöntem sunar:

**1. Sürekli (piecewise-linear) ampirik dağılım — varsayılan**

Sıralı gözlemler x_(1) <= ... <= x_(n) için dağılım fonksiyonu, noktalar
arasında doğrusal enterpolasyon yapılarak tanımlanır:

    F(x_(i)) = (i - 1) / (n - 1)

Ters dönüşüm (Law 2015, denklem 8.7):

    i = floor((n - 1) * u) + 1
    X = x_(i) + ((n - 1) * u - (i - 1)) * (x_(i+1) - x_(i))

Bu yöntem gözlemler arasındaki değerleri de üretebildiği için sürekli süreler
için tercih edilir; ancak gözlenen en küçük değerin altına ve en büyük değerin
üstüne asla çıkamaz — bu, ampirik dağılımların bilinen ve kaçınılmaz kısıtıdır.

**2. Kesikli (bootstrap) yeniden örnekleme**

Gözlemlerden biri eşit olasılıkla seçilir. Süre değerleri gerçekten kesikli ise
(ör. yalnızca birkaç standart parti büyüklüğü) doğru seçenek budur.

Momentler
---------
Sürekli modda dağılım, n-1 adet eşit olasılıklı düzgün (uniform) parçanın
karışımıdır. Her parça için E ve E[X^2] kapalı formda bilindiğinden dağılımın
gerçek momentleri **analitik olarak** hesaplanır; ham verinin örneklem
ortalaması kullanılmaz (bu ikisi genelde birbirinden farklıdır ve kuyruk
hesaplarında gerçek olan kullanılmalıdır).

Kaynaklar
---------
- Law, A. M. (2015). *Simulation Modeling and Analysis*, 5th ed., Bölüm 6.2.4
  ve 8.3.16 (ampirik dağılımlar ve ters dönüşümleri).
- Banks, J. et al. (2010). *Discrete-Event System Simulation*, 5th ed., Bölüm 8.1.6.
"""

from __future__ import annotations

import bisect
import math
import random
from typing import ClassVar, Iterable, Literal, Sequence

from simulation_engine.distributions.base import BaseDistribution

#: Sürekli enterpolasyon için gereken asgari gözlem sayısı.
MIN_OBSERVATIONS: int = 2

EmpiricalMethod = Literal["continuous", "discrete"]


class EmpiricalDistribution(BaseDistribution):
    """Gözlem listesinden türetilmiş ampirik dağılım."""

    type_name: ClassVar[str] = "empirical"

    def __init__(
        self,
        values: Iterable[float],
        method: EmpiricalMethod = "continuous",
        rng: random.Random | None = None,
    ) -> None:
        """Dağılımı ham gözlemlerden kurar.

        Args:
            values: Sahadan toplanan süre gözlemleri (en az iki adet, negatif
                olmayan).
            method: "continuous" ise parçalı doğrusal enterpolasyon,
                "discrete" ise gözlemler arasından eşit olasılıklı seçim.
            rng: Bağlanacak rastgele sayı akışı.

        Raises:
            ValueError: Gözlem sayısı yetersizse, negatif değer varsa veya
                yöntem adı tanınmıyorsa.
        """
        super().__init__(rng)
        if method not in ("continuous", "discrete"):
            raise ValueError(
                f"Ampirik dagilim yontemi 'continuous' veya 'discrete' olmalidir, "
                f"alinan: {method!r}"
            )

        observations = [float(v) for v in values]
        if len(observations) < MIN_OBSERVATIONS:
            raise ValueError(
                f"Ampirik dagilim en az {MIN_OBSERVATIONS} gozlem gerektirir, "
                f"alinan: {len(observations)}."
            )
        for value in observations:
            if value < 0.0:
                raise ValueError(
                    f"Ampirik dagilim negatif gozlem iceremez (sure modeli), alinan: {value}"
                )
            if not math.isfinite(value):
                raise ValueError(f"Ampirik dagilim sonlu olmayan gozlem iceremez: {value}")

        self._method: EmpiricalMethod = method
        self._sorted: list[float] = sorted(observations)
        self._n: int = len(self._sorted)
        self._segments: int = self._n - 1

        if method == "continuous" and self._sorted[0] == self._sorted[-1]:
            raise ValueError(
                "Surekli ampirik dagilimda tum gozlemler ayni; bu dejenere durumda "
                "ConstantDistribution kullanin."
            )

        self._mean, self._variance = self._compute_moments()

    # ------------------------------------------------------------------ #
    # Tanımlayıcı bilgiler
    # ------------------------------------------------------------------ #
    @property
    def method(self) -> EmpiricalMethod:
        """Kullanılan örnekleme yöntemi."""
        return self._method

    @property
    def observations(self) -> Sequence[float]:
        """Sıralanmış ham gözlemler (salt okunur görünüm)."""
        return tuple(self._sorted)

    @property
    def observation_count(self) -> int:
        """Gözlem sayısı n."""
        return self._n

    @property
    def minimum(self) -> float:
        """Gözlenen en küçük değer; dağılımın alt sınırıdır."""
        return self._sorted[0]

    @property
    def maximum(self) -> float:
        """Gözlenen en büyük değer; dağılımın üst sınırıdır."""
        return self._sorted[-1]

    def sample_mean(self) -> float:
        """Ham verinin örneklem ortalaması (dağılımın momenti değil).

        Sürekli modda dağılımın gerçek ortalaması (`mean()`) uç noktalara
        yarım ağırlık verdiği için bu değerden farklıdır; ikisinin ayrı
        tutulması bilinçlidir.
        """
        return math.fsum(self._sorted) / self._n

    # ------------------------------------------------------------------ #
    # Momentler
    # ------------------------------------------------------------------ #
    def _compute_moments(self) -> tuple[float, float]:
        """Dağılımın analitik ortalama ve varyansını hesaplar.

        Sürekli modda dağılım, her biri 1 / (n - 1) olasılıklı ve
        [x_(i), x_(i+1)] üzerinde düzgün dağılmış parçaların karışımıdır:

            E[X]   = (1 / (n-1)) * sum (x_i + x_{i+1}) / 2
            E[X^2] = (1 / (n-1)) * sum (x_i^2 + x_i*x_{i+1} + x_{i+1}^2) / 3

        Kesikli modda her gözlem 1 / n olasılıkla seçildiğinden ortalama
        örneklem ortalaması, varyans ise (n bölenli) yığın varyansıdır.
        """
        if self._method == "discrete":
            mean = math.fsum(self._sorted) / self._n
            second_moment = math.fsum(v * v for v in self._sorted) / self._n
            return mean, max(second_moment - mean * mean, 0.0)

        first_terms = []
        second_terms = []
        for lower, upper in zip(self._sorted, self._sorted[1:]):
            first_terms.append((lower + upper) / 2.0)
            second_terms.append((lower * lower + lower * upper + upper * upper) / 3.0)
        mean = math.fsum(first_terms) / self._segments
        second_moment = math.fsum(second_terms) / self._segments
        return mean, max(second_moment - mean * mean, 0.0)

    def mean(self) -> float:
        """Dağılımın analitik beklenen değeri."""
        return self._mean

    def variance(self) -> float:
        """Dağılımın analitik varyansı."""
        return self._variance

    # ------------------------------------------------------------------ #
    # Örnekleme ve dağılım fonksiyonu
    # ------------------------------------------------------------------ #
    def _inverse_cdf(self, u: float) -> float:
        """Yönteme göre ters dağılım fonksiyonu."""
        if self._method == "discrete":
            index = int(u * self._n)
            if index >= self._n:
                index = self._n - 1
            return self._sorted[index]

        scaled = u * self._segments
        index = int(scaled)
        if index >= self._segments:
            index = self._segments - 1
        fraction = scaled - index
        lower = self._sorted[index]
        upper = self._sorted[index + 1]
        return lower + fraction * (upper - lower)

    def cdf(self, x: float) -> float:
        """Ampirik dağılım fonksiyonu F(x)."""
        if self._method == "discrete":
            return bisect.bisect_right(self._sorted, x) / self._n

        if x <= self._sorted[0]:
            return 0.0
        if x >= self._sorted[-1]:
            return 1.0
        index = bisect.bisect_right(self._sorted, x) - 1
        if index >= self._segments:
            return 1.0
        width = self._sorted[index + 1] - self._sorted[index]
        fraction = 0.0 if width == 0.0 else (x - self._sorted[index]) / width
        return (index + fraction) / self._segments
