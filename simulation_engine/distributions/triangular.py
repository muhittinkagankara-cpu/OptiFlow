"""Üçgen (triangular) dağılım — min / mode / max tahminine dayalı süreler.

Teorik dayanak
--------------
Geçmiş veri bulunmadığında, süre tahminini yalnızca üç noktayla veren uzman
görüşünü modellemek için kullanılır ("en iyimser", "en olası", "en kötümser").
Endüstri mühendisliğinde yeni bir hattın ön tasarımında ve PERT tipi süre
tahminlerinde standart araçtır.

    f(x) = 2(x - a) / ((b - a)(m - a))        a <= x < m
    f(x) = 2(b - x) / ((b - a)(b - m))        m <= x <= b

    E[X]   = (a + m + b) / 3
    Var[X] = (a^2 + m^2 + b^2 - a*m - a*b - m*b) / 18

burada a = min, m = mode, b = max.

Ters dönüşüm
------------
c = (m - a) / (b - a) kritik olasılık olmak üzere:

    u <  c :  x = a + sqrt(u * (b - a) * (m - a))
    u >= c :  x = b - sqrt((1 - u) * (b - a) * (b - m))

Kaynaklar
---------
- Law, A. M. (2015). *Simulation Modeling and Analysis*, 5th ed., Bölüm 6.2.3
  ve Tablo 6.4 (üçgen dağılımın ters dönüşümü).
- Banks, J. et al. (2010). *Discrete-Event System Simulation*, 5th ed., Bölüm 5.4.
"""

from __future__ import annotations

import math
import random
from typing import ClassVar

from simulation_engine.distributions.base import BaseDistribution


class TriangularDistribution(BaseDistribution):
    """min <= mode <= max parametreleriyle tanımlı üçgen dağılım."""

    type_name: ClassVar[str] = "triangular"

    def __init__(
        self,
        low: float,
        mode: float,
        high: float,
        rng: random.Random | None = None,
    ) -> None:
        """Üçgen dağılımı üç nokta tahminiyle tanımlar.

        Args:
            low: En iyimser (en kısa) süre a.
            mode: En olası süre m.
            high: En kötümser (en uzun) süre b.
            rng: Bağlanacak rastgele sayı akışı.

        Raises:
            ValueError: 0 <= a <= m <= b koşulu sağlanmazsa veya a == b ise.
        """
        super().__init__(rng)
        if low < 0.0:
            raise ValueError(f"Ucgen dagilimda min negatif olamaz (sure modeli), alinan: {low}")
        if not low <= mode <= high:
            raise ValueError(
                f"Ucgen dagilimda min <= mode <= max kosulu saglanmali; "
                f"alinan min={low}, mode={mode}, max={high}."
            )
        if low == high:
            raise ValueError(
                "Ucgen dagilimda min == max dejenere durumdur; "
                "sabit sure icin ConstantDistribution kullanin."
            )

        self._low = float(low)
        self._mode = float(mode)
        self._high = float(high)
        self._range = self._high - self._low
        #: Modun dağılım fonksiyonundaki karşılığı: F(mode).
        self._mode_probability = (self._mode - self._low) / self._range

    @property
    def low(self) -> float:
        """En iyimser süre a."""
        return self._low

    @property
    def mode(self) -> float:
        """En olası süre m."""
        return self._mode

    @property
    def high(self) -> float:
        """En kötümser süre b."""
        return self._high

    def _inverse_cdf(self, u: float) -> float:
        """Parçalı ters dağılım fonksiyonu (Law 2015, Tablo 6.4)."""
        if u < self._mode_probability:
            return self._low + math.sqrt(u * self._range * (self._mode - self._low))
        return self._high - math.sqrt((1.0 - u) * self._range * (self._high - self._mode))

    def mean(self) -> float:
        """E[X] = (a + m + b) / 3."""
        return (self._low + self._mode + self._high) / 3.0

    def variance(self) -> float:
        """Var[X] = (a^2 + m^2 + b^2 - am - ab - mb) / 18."""
        a, m, b = self._low, self._mode, self._high
        return (a * a + m * m + b * b - a * m - a * b - m * b) / 18.0

    def cdf(self, x: float) -> float:
        """Parçalı dağılım fonksiyonu F(x)."""
        if x <= self._low:
            return 0.0
        if x >= self._high:
            return 1.0
        if x < self._mode:
            # mode == low ise bu dala hiç girilmez (x < low zaten elenmiştir).
            return ((x - self._low) ** 2) / (self._range * (self._mode - self._low))
        if self._high == self._mode:
            # Sağ kenar dejenere: dağılım tamamen sol parçadan oluşur.
            return ((x - self._low) ** 2) / (self._range * self._range)
        return 1.0 - ((self._high - x) ** 2) / (self._range * (self._high - self._mode))
