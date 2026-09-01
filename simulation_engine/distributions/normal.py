"""Normal (Gauss) dağılım — sıfırdan soldan budanmış hâliyle.

Teorik dayanak
--------------
Standart işlem süreleri için en yaygın kullanılan dağılımdır: bir operatörün
veya makinenin çevrim süresi, çok sayıda küçük bağımsız etkinin toplamı olduğu
için Merkezi Limit Teoremi gereği normale yakınsar.

**Kritik uyarı ve tasarım kararı:** Normal dağılımın desteği (-sonsuz, +sonsuz)
olduğundan negatif süre üretebilir; negatif bir işlem süresi simülasyon saatini
geriye alacağı için fiziksel olarak anlamsızdır. Bu modül dağılımı **sıfırdan
soldan budar** (truncated normal) ve budamayı analitik olarak hesaba katar:

    alpha  = (0 - mu) / sigma
    Z      = 1 - Phi(alpha)                          (hayatta kalan kütle)
    E[X]   = mu + sigma * phi(alpha) / Z
    Var[X] = sigma^2 * (1 + alpha * phi(alpha) / Z - (phi(alpha) / Z)^2)

Bu nedenle `mean()` ve `variance()` metodları **kullanıcının girdiği** mu ve
sigma değerlerini değil, gerçekten örneklenen budanmış dağılımın momentlerini
döndürür. Kuyruk teorisi hesaplarının (mu = 1 / E[S]) doğru olması buna bağlıdır.

Yaygın bir alternatif olan "negatif çıkanı at, yeniden çek" yaklaşımı da aynı
budanmış dağılımı verir; ancak örnek başına değişken sayıda rastgele sayı
harcadığı için ortak rastgele sayı tekniğini bozar. Burada bunun yerine
budanmış dağılımın **doğrudan ters dönüşümü** kullanılır:

    u' = Phi(alpha) + u * Z,   X = mu + sigma * Phi^-1(u')

`statistics.NormalDist` sınıfının `inv_cdf` metodu Wichura'nın AS241
algoritmasını uygular (yaklaşık 1e-15 mutlak doğruluk); standart kütüphaneden
gelmesi sayesinde ayrıca test edilmiş ve platformlar arası tutarlıdır.

Kaynaklar
---------
- Johnson, N. L., Kotz, S. & Balakrishnan, N. (1994). *Continuous Univariate
  Distributions*, Vol. 1, Bölüm 13.10 (budanmış normal momentleri).
- Wichura, M. J. (1988). "Algorithm AS 241: The Percentage Points of the Normal
  Distribution." *Applied Statistics*, 37(3), 477-484.
- Law, A. M. (2015). *Simulation Modeling and Analysis*, 5th ed., Bölüm 6.2.2.
"""

from __future__ import annotations

import random
from statistics import NormalDist
from typing import ClassVar

from simulation_engine.distributions.base import (
    MAX_UNIFORM,
    MIN_UNIFORM,
    BaseDistribution,
)

#: Standart normal dağılım nesnesi (pdf / cdf / inv_cdf için).
_STANDARD_NORMAL = NormalDist(0.0, 1.0)

#: Budama sonrası kalan olasılık kütlesi bu eşiğin altına düşerse dağılım
#: pratikte tanımsızdır (ortalama sigma'nın çok altında kalmıştır).
MIN_SURVIVING_MASS: float = 1e-6

#: Budama sapmasının "ihmal edilebilir" sayıldığı eşik. mu >= 3 * sigma ise
#: negatif kuyruğun kütlesi %0.135'in altındadır ve momentlerdeki kayma
#: göz ardı edilebilir düzeydedir.
NEGLIGIBLE_TRUNCATION_SIGMA_RATIO: float = 3.0


class NormalDistribution(BaseDistribution):
    """Sıfırdan soldan budanmış normal dağılım N(mu, sigma^2) | X >= 0."""

    type_name: ClassVar[str] = "normal"

    def __init__(self, mean: float, std: float, rng: random.Random | None = None) -> None:
        """Dağılımı nominal ortalama ve standart sapma ile tanımlar.

        Args:
            mean: Budama öncesi nominal ortalama mu (negatif olamaz).
            std: Budama öncesi nominal standart sapma sigma (pozitif olmalı).
            rng: Bağlanacak rastgele sayı akışı.

        Raises:
            ValueError: Parametreler geçersizse veya budama sonrası kalan
                olasılık kütlesi sayısal olarak kullanılamayacak kadar küçükse.
        """
        super().__init__(rng)
        if std <= 0.0:
            raise ValueError(f"Normal dagilimda sigma pozitif olmalidir, alinan: {std}")
        if mean < 0.0:
            raise ValueError(
                f"Normal dagilim bir sure modelledigi icin mu negatif olamaz, alinan: {mean}"
            )

        self._nominal_mean = float(mean)
        self._nominal_std = float(std)

        # Sıfır noktasının standartlaştırılmış konumu ve budama büyüklükleri.
        self._alpha = (0.0 - self._nominal_mean) / self._nominal_std
        self._pdf_at_alpha = _STANDARD_NORMAL.pdf(self._alpha)
        self._cdf_at_alpha = _STANDARD_NORMAL.cdf(self._alpha)
        self._surviving_mass = 1.0 - self._cdf_at_alpha

        if self._surviving_mass < MIN_SURVIVING_MASS:
            raise ValueError(
                f"Normal dagilimda mu={mean}, sigma={std} icin dagilimin neredeyse "
                f"tamami negatif bolgede kaliyor (kalan kutle {self._surviving_mass:.2e}). "
                f"Bu parametrelerle bir sure modellenemez."
            )

        # Budanmış dağılımın ters Mills oranı; momentlerde tekrar tekrar kullanılır.
        self._inverse_mills_ratio = self._pdf_at_alpha / self._surviving_mass

    # ------------------------------------------------------------------ #
    # Nominal parametreler
    # ------------------------------------------------------------------ #
    @property
    def nominal_mean(self) -> float:
        """Kullanıcının girdiği, budama öncesi mu değeri."""
        return self._nominal_mean

    @property
    def nominal_std_dev(self) -> float:
        """Kullanıcının girdiği, budama öncesi sigma değeri."""
        return self._nominal_std

    @property
    def truncated_probability_mass(self) -> float:
        """Budama ile atılan olasılık kütlesi P(N(mu, sigma^2) < 0)."""
        return self._cdf_at_alpha

    @property
    def has_significant_truncation(self) -> bool:
        """Budamanın momentleri anlamlı ölçüde kaydırıp kaydırmadığını bildirir.

        mu < 3 * sigma olduğunda budanmış ortalama nominal ortalamadan gözle
        görülür biçimde yukarı kayar; model kurucusunun bunu bilmesi gerekir.
        """
        return self._nominal_mean < NEGLIGIBLE_TRUNCATION_SIGMA_RATIO * self._nominal_std

    @property
    def truncation_bias(self) -> float:
        """Budamanın ortalamada yarattığı kayma: E[X] - mu."""
        return self.mean() - self._nominal_mean

    # ------------------------------------------------------------------ #
    # Örnekleme ve momentler
    # ------------------------------------------------------------------ #
    def _inverse_cdf(self, u: float) -> float:
        """Budanmış normalin ters dağılım fonksiyonu.

        u' = Phi(alpha) + u * (1 - Phi(alpha)) dönüşümü, düzgün örneği doğrudan
        [0, sonsuz) bölgesine karşılık gelen olasılık aralığına eşler; böylece
        tek bir rastgele sayı ile reddetme yapmadan örnekleme sağlanır.
        """
        scaled = self._cdf_at_alpha + u * self._surviving_mass
        if scaled < MIN_UNIFORM:
            scaled = MIN_UNIFORM
        elif scaled > MAX_UNIFORM:
            scaled = MAX_UNIFORM
        value = self._nominal_mean + self._nominal_std * _STANDARD_NORMAL.inv_cdf(scaled)
        # Kayan nokta yuvarlaması nedeniyle -1e-17 gibi bir değer çıkabilir.
        return value if value > 0.0 else 0.0

    def mean(self) -> float:
        """Budanmış ortalama E[X] = mu + sigma * phi(alpha) / (1 - Phi(alpha))."""
        return self._nominal_mean + self._nominal_std * self._inverse_mills_ratio

    def variance(self) -> float:
        """Budanmış varyans: sigma^2 * (1 + alpha * IMR - IMR^2)."""
        imr = self._inverse_mills_ratio
        factor = 1.0 + self._alpha * imr - imr * imr
        # Analitik olarak pozitiftir; kayan nokta hatasına karşı korunur.
        return self._nominal_std * self._nominal_std * max(factor, 0.0)

    def cdf(self, x: float) -> float:
        """Budanmış dağılım fonksiyonu: (Phi(z) - Phi(alpha)) / (1 - Phi(alpha))."""
        if x <= 0.0:
            return 0.0
        z = (x - self._nominal_mean) / self._nominal_std
        return (_STANDARD_NORMAL.cdf(z) - self._cdf_at_alpha) / self._surviving_mass
