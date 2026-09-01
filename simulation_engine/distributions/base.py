"""Olasılık dağılımları için ortak taban sınıf ve rastgele sayı akışı yönetimi.

Teorik dayanak
--------------
Tüm dağılımlar mümkün olan her yerde **ters dönüşüm yöntemi** (inverse transform
sampling) ile örneklenir: U ~ Uniform(0,1) ise X = F^-1(U) dağılım fonksiyonu F
olan bir rastgele değişkendir. Kaynak: Law, A. M. (2015), *Simulation Modeling
and Analysis*, 5th ed., Bölüm 8.2.1.

Ters dönüşümün iki pratik faydası vardır:

1. Her örnek için **tek bir** düzgün rastgele sayı harcanır. Bu, ortak rastgele
   sayı (common random numbers) varyans azaltma tekniğini ve senaryolar arası
   adil karşılaştırmayı mümkün kılar (Law 2015, Bölüm 11.2).
2. Örnekleme tamamen deterministiktir; aynı tohum aynı sonucu verir
   (Şartname TEST 5 — reprodüktibilite).

Akış ayrımı (stream separation)
-------------------------------
Her rastgele kaynağa (her istasyonun işlem süresi, her istasyonun arıza süreci,
varış süreci, her istasyonun yönlendirme kararı) **ayrı** bir üreteç atanır.
Tek bir küresel üreteç kullanılsaydı, modelin bir yerindeki küçük bir değişiklik
(ör. bir istasyona bir makine eklemek) diğer tüm kaynakların çektiği sayıları
kaydırır ve senaryo karşılaştırmalarını geçersiz kılardı. Akış ayrımı bu
etkiyi ortadan kaldırır (Law 2015, Bölüm 7.2).
"""

from __future__ import annotations

import hashlib
import math
import random
from abc import ABC, abstractmethod
from typing import ClassVar

# --------------------------------------------------------------------------- #
# Adlandırılmış sabitler
# --------------------------------------------------------------------------- #

#: `random.Random.random()` [0, 1) aralığında değer üretir. Ters dönüşüm
#: formüllerinde u = 0 (ve bazı dağılımlarda u = 1) tekilliğe yol açtığı için
#: örnekler açık (0, 1) aralığına sıkıştırılır.
MIN_UNIFORM: float = 1e-15
MAX_UNIFORM: float = 1.0 - 1e-15

#: Türetilmiş tohumların bit genişliği. 63 bit, Python'un Mersenne Twister
#: uygulaması için fazlasıyla yeterli ve platformlar arası taşınabilir.
SEED_BITS: int = 63


class RandomStreamFactory:
    """Ana tohumdan bağımsız ve tekrarlanabilir rastgele sayı akışları türetir.

    Akış tohumu ``SHA-256(master_seed:label)`` özetinden üretilir. Etiket tabanlı
    türetmenin kritik faydası şudur: bir akışın tohumu, akışların **oluşturulma
    sırasından** bağımsızdır. Böylece modele yeni bir istasyon eklendiğinde
    mevcut istasyonların rastgele sayı dizileri değişmez ve senaryolar
    karşılaştırılabilir kalır.

    Python'un yerleşik `hash()` fonksiyonu süreçler arası rastgeleleştirildiği
    (PYTHONHASHSEED) için bilinçli olarak kullanılmaz; SHA-256 deterministiktir.
    """

    def __init__(self, master_seed: int | None = None) -> None:
        """Ana tohumu belirler; verilmezse kriptografik olarak rastgele üretir.

        Args:
            master_seed: Tekrarlanabilirlik için ana tohum. `None` ise rastgele
                bir tohum üretilir ve `master_seed` özelliğinden okunabilir —
                böylece bir çalıştırma sonradan birebir tekrarlanabilir.
        """
        if master_seed is None:
            master_seed = random.SystemRandom().getrandbits(SEED_BITS)
        if master_seed < 0:
            raise ValueError(f"Ana tohum negatif olamaz, alinan: {master_seed}")
        self._master_seed: int = int(master_seed)
        self._issued_labels: set[str] = set()

    @property
    def master_seed(self) -> int:
        """Bu fabrikanın türetme yaptığı ana tohum."""
        return self._master_seed

    @property
    def issued_labels(self) -> frozenset[str]:
        """Şimdiye kadar akış verilen etiketler (hata ayıklama için)."""
        return frozenset(self._issued_labels)

    def stream(self, label: str) -> random.Random:
        """Verilen etiket için bağımsız bir rastgele sayı üreteci döndürür.

        Args:
            label: Akışın benzersiz adı, ör. ``"service:CNC-01"``.

        Returns:
            Etikete ve ana tohuma göre deterministik olarak tohumlanmış üreteç.

        Raises:
            ValueError: Aynı etiket ikinci kez istenirse. İki farklı rastgele
                kaynağın aynı akışı paylaşması, aralarında yapay korelasyon
                yaratıp sonuçları geçersiz kılacağı için sessizce izin verilmez.
        """
        if label in self._issued_labels:
            raise ValueError(
                f"'{label}' etiketi icin zaten bir akis verilmis. Her rastgele "
                f"kaynak benzersiz bir etiket kullanmalidir."
            )
        self._issued_labels.add(label)
        digest = hashlib.sha256(f"{self._master_seed}:{label}".encode("utf-8")).digest()
        derived_seed = int.from_bytes(digest[:8], "big") >> (64 - SEED_BITS)
        return random.Random(derived_seed)


class BaseDistribution(ABC):
    """Süre üreten tüm olasılık dağılımlarının ortak arayüzü.

    Alt sınıflar dört şeyi sağlamak zorundadır: ters dağılım fonksiyonu
    (`_inverse_cdf`), analitik ortalama (`mean`), analitik varyans (`variance`)
    ve dağılım fonksiyonu (`cdf`). Analitik momentlerin sağlanması zorunludur
    çünkü `analytics/queueing_theory.py` bunları kullanır: M/M/c formülleri
    hizmet hızı mu = 1 / E[S] üzerine, Kingman'ın G/G/c yaklaşımı ise
    varyasyon katsayısı cv = sigma / mu üzerine kuruludur.
    """

    #: Şemadaki `Distribution.type` değeri ile eşleşen kanonik ad.
    type_name: ClassVar[str] = "base"

    def __init__(self, rng: random.Random | None = None) -> None:
        """Dağılımı bir rastgele sayı akışına bağlar.

        Args:
            rng: Kullanılacak üreteç. `None` ise tohumsuz bir üreteç atanır;
                tekrarlanabilirlik gerektiren her yerde `RandomStreamFactory`
                üzerinden üretilmiş bir akış geçilmelidir.
        """
        self._rng: random.Random = rng if rng is not None else random.Random()
        self._sample_count: int = 0

    # ------------------------------------------------------------------ #
    # Akış yönetimi
    # ------------------------------------------------------------------ #
    def bind_stream(self, rng: random.Random) -> None:
        """Dağılımı başka bir rastgele sayı akışına bağlar."""
        self._rng = rng

    @property
    def sample_count(self) -> int:
        """Bu dağılımdan çekilen toplam örnek sayısı."""
        return self._sample_count

    # ------------------------------------------------------------------ #
    # Örnekleme
    # ------------------------------------------------------------------ #
    def _uniform(self) -> float:
        """Açık (0, 1) aralığında bir düzgün rastgele sayı üretir."""
        u = self._rng.random()
        if u < MIN_UNIFORM:
            return MIN_UNIFORM
        if u > MAX_UNIFORM:
            return MAX_UNIFORM
        return u

    def sample(self) -> float:
        """Dağılımdan tek bir örnek çeker (ters dönüşüm yöntemiyle)."""
        self._sample_count += 1
        return self._inverse_cdf(self._uniform())

    def sample_duration(self) -> float:
        """Süre olarak kullanılacak, negatif olmayan bir örnek çeker.

        Simülasyon motoru zamanı yalnızca ileri alabilir; negatif bir süre
        olay kuyruğunun zaman sıralamasını bozar. Bu nedenle negatif örnek
        sessizce sıfıra kırpılmaz, hata olarak yükseltilir.

        Raises:
            ValueError: Örnek negatif çıkarsa (dağılım parametreleri şema
                düzeyinde doğrulandığı için bu durum bir uygulama hatasıdır).
        """
        value = self.sample()
        if value < 0.0:
            raise ValueError(
                f"{self.__class__.__name__} negatif sure uretti: {value}. "
                f"Sure dagilimlari negatif deger uretemez."
            )
        return value

    def sample_many(self, count: int) -> list[float]:
        """Ardışık `count` adet örnek çeker (dağılım uyum testleri için)."""
        if count < 0:
            raise ValueError(f"Ornek sayisi negatif olamaz, alinan: {count}")
        return [self.sample() for _ in range(count)]

    @abstractmethod
    def _inverse_cdf(self, u: float) -> float:
        """Ters dağılım fonksiyonu F^-1(u); u açık (0, 1) aralığındadır."""

    # ------------------------------------------------------------------ #
    # Analitik momentler
    # ------------------------------------------------------------------ #
    @abstractmethod
    def mean(self) -> float:
        """Dağılımın analitik beklenen değeri E[X]."""

    @abstractmethod
    def variance(self) -> float:
        """Dağılımın analitik varyansı Var[X]."""

    @abstractmethod
    def cdf(self, x: float) -> float:
        """Dağılım fonksiyonu F(x) = P(X <= x)."""

    def std_dev(self) -> float:
        """Standart sapma, sigma = sqrt(Var[X])."""
        return math.sqrt(self.variance())

    def coefficient_of_variation(self) -> float:
        """Varyasyon katsayısı cv = sigma / mu.

        Kuyruk teorisinde değişkenliğin ölçüsüdür: üstel dağılım için cv = 1,
        deterministik süre için cv = 0. Kingman'ın G/G/1 bekleme yaklaşımında
        (Wq ~ (ca^2 + cs^2) / 2 * rho / (1 - rho) * E[S]) doğrudan kullanılır.
        """
        mu = self.mean()
        if mu <= 0.0:
            return 0.0
        return self.std_dev() / mu

    def rate(self) -> float:
        """Hizmet/varış hızı = 1 / E[X].

        İşlem süresi dağılımları için bu değer kuyruk teorisindeki **mu**,
        varışlar arası süre dağılımları için **lambda** parametresidir.
        """
        mu = self.mean()
        if mu <= 0.0:
            raise ZeroDivisionError(
                f"{self.__class__.__name__} ortalamasi sifir; hiz (1 / E[X]) tanimsiz."
            )
        return 1.0 / mu

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}(mean={self.mean():.6g}, "
            f"std={self.std_dev():.6g}, cv={self.coefficient_of_variation():.6g})"
        )


class ConstantDistribution(BaseDistribution):
    """Dejenere (deterministik) dağılım: X = value olasılıkla 1.

    Montaj hatlarındaki sabit çevrim süreleri ve otomatik makinelerin
    değişkenliği ihmal edilebilir işlem süreleri için kullanılır. Varyansı
    sıfır olduğundan cv = 0'dır; kuyruk notasyonunda M/D/c modellerinin
    'D' bileşenine karşılık gelir.
    """

    type_name: ClassVar[str] = "constant"

    def __init__(self, value: float, rng: random.Random | None = None) -> None:
        """Sabit süreyi tanımlar.

        Args:
            value: Her örnekte döndürülecek negatif olmayan süre.
        """
        super().__init__(rng)
        if value < 0.0:
            raise ValueError(f"Sabit sure negatif olamaz, alinan: {value}")
        self._value = float(value)

    @property
    def value(self) -> float:
        """Sabit süre değeri."""
        return self._value

    def _inverse_cdf(self, u: float) -> float:
        """Dejenere dağılımda F^-1(u) = value (her u için)."""
        return self._value

    def sample(self) -> float:
        """Sabit değeri döndürür; rastgele sayı akışından çekim yapmaz.

        Akıştan sayı çekilmemesi bilinçlidir: deterministik bir süre, modelin
        geri kalanının rastgele sayı dizisini kaydırmamalıdır.
        """
        self._sample_count += 1
        return self._value

    def mean(self) -> float:
        """E[X] = value."""
        return self._value

    def variance(self) -> float:
        """Var[X] = 0."""
        return 0.0

    def cdf(self, x: float) -> float:
        """Basamak fonksiyonu: x < value ise 0, aksi halde 1."""
        return 0.0 if x < self._value else 1.0
