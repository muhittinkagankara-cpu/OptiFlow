"""Üstel (exponential) dağılım — Poisson varış süreçleri ve Markovyen hizmet.

Teorik dayanak
--------------
X ~ Exp(lambda) ise:

    f(x)   = lambda * exp(-lambda * x),  x >= 0
    F(x)   = 1 - exp(-lambda * x)
    E[X]   = 1 / lambda
    Var[X] = 1 / lambda^2
    cv     = 1  (standart sapma ortalamaya eşittir)

Varışlar arası süreler üstel dağılıyorsa, sabit bir zaman aralığındaki varış
sayısı Poisson dağılır; bu iki ifade denktir ve kuyruk teorisindeki M/M/c
notasyonunun ilk 'M' harfinin (Markovian / memoryless) kaynağıdır.

Hafızasızlık (memoryless) özelliği — P(X > s + t | X > s) = P(X > t) —
M/M/1 ve M/M/c formüllerinin kapalı formda çözülebilmesinin nedenidir; bu
nedenle Şartname TEST 1'deki analitik doğrulama yalnızca üstel süreler
kullanıldığında geçerlidir.

Ters dönüşüm
------------
    F(x) = 1 - exp(-lambda * x) = u  =>  x = -ln(1 - u) / lambda

Kaynaklar
---------
- Gross, D. & Harris, C. M. (2008). *Fundamentals of Queueing Theory*, 4th ed.,
  Bölüm 1.4 (üstel dağılım ve hafızasızlık).
- Law, A. M. (2015). *Simulation Modeling and Analysis*, 5th ed., Bölüm 8.3.1.
"""

from __future__ import annotations

import math
import random
from typing import ClassVar

from simulation_engine.distributions.base import BaseDistribution


class ExponentialDistribution(BaseDistribution):
    """Ortalaması `mean` (hızı lambda = 1 / mean) olan üstel dağılım."""

    type_name: ClassVar[str] = "exponential"

    def __init__(self, mean: float, rng: random.Random | None = None) -> None:
        """Dağılımı ortalama süre ile tanımlar.

        Args:
            mean: Beklenen süre E[X] = 1 / lambda; kesinlikle pozitif olmalıdır.
            rng: Bağlanacak rastgele sayı akışı.

        Raises:
            ValueError: `mean` pozitif değilse.
        """
        super().__init__(rng)
        if mean <= 0.0:
            raise ValueError(f"Ustel dagilimda ortalama pozitif olmalidir, alinan: {mean}")
        self._mean = float(mean)

    @classmethod
    def from_rate(cls, rate: float, rng: random.Random | None = None) -> "ExponentialDistribution":
        """Hız parametresinden (lambda veya mu) dağılım kurar.

        Args:
            rate: Birim zamandaki olay sayısı; ortalama 1 / rate olur.
        """
        if rate <= 0.0:
            raise ValueError(f"Ustel dagilimda hiz pozitif olmalidir, alinan: {rate}")
        return cls(mean=1.0 / rate, rng=rng)

    @property
    def lambda_(self) -> float:
        """Hız parametresi lambda = 1 / E[X]."""
        return 1.0 / self._mean

    def _inverse_cdf(self, u: float) -> float:
        """F^-1(u) = -ln(1 - u) / lambda (ters dönüşüm yöntemi)."""
        return -self._mean * math.log(1.0 - u)

    def mean(self) -> float:
        """E[X] = 1 / lambda."""
        return self._mean

    def variance(self) -> float:
        """Var[X] = 1 / lambda^2."""
        return self._mean * self._mean

    def coefficient_of_variation(self) -> float:
        """Üstel dağılım için cv daima tam olarak 1.0'dır.

        Taban sınıftaki genel hesap da 1.0 verir; burada kayan nokta yuvarlama
        hatası olmadan tam değeri döndürmek için özelleştirilmiştir (Kingman
        yaklaşımı gibi formüllerde cv doğrudan çarpan olarak kullanılır).
        """
        return 1.0

    def cdf(self, x: float) -> float:
        """F(x) = 1 - exp(-lambda * x), x < 0 için 0."""
        if x <= 0.0:
            return 0.0
        return 1.0 - math.exp(-x / self._mean)
