"""Olasılık dağılımları paketi — Şartname Bölüm 1 `distributions/` klasörü.

Bu paket, `models.schemas.Distribution` şemasını çalıştırılabilir örnekleyici
nesnelere dönüştüren fabrika fonksiyonunu (`create_distribution`) ve dört
dağılım ailesini içerir. Tüm dağılımlar `BaseDistribution` arayüzünü uygular:
ters dönüşümle örnekleme, analitik ortalama, analitik varyans ve dağılım
fonksiyonu.

`ConstantDistribution` bilinçli olarak `base.py` içinde tutulur: dejenere bir
dağılım olduğu ve rastgele sayı akışı tüketmediği için ayrı bir modülü hak
edecek bir teorik içeriği yoktur.
"""

from __future__ import annotations

import random
from typing import Callable, Dict

from simulation_engine.distributions.base import (
    MAX_UNIFORM,
    MIN_UNIFORM,
    SEED_BITS,
    BaseDistribution,
    ConstantDistribution,
    RandomStreamFactory,
)
from simulation_engine.distributions.empirical import EmpiricalDistribution
from simulation_engine.distributions.exponential import ExponentialDistribution
from simulation_engine.distributions.normal import NormalDistribution
from simulation_engine.distributions.triangular import TriangularDistribution
from simulation_engine.models.schemas import Distribution

#: Şema tipinden kurucu fonksiyona eşleme. Kurucular, `Distribution` şemasının
#: doğrulanmış ve kanonik adlara normalize edilmiş `params` sözlüğünü alır.
_BUILDERS: Dict[str, Callable[[dict, random.Random], BaseDistribution]] = {
    "exponential": lambda p, rng: ExponentialDistribution(mean=p["mean"], rng=rng),
    "normal": lambda p, rng: NormalDistribution(mean=p["mean"], std=p["std"], rng=rng),
    "triangular": lambda p, rng: TriangularDistribution(
        low=p["min"], mode=p["mode"], high=p["max"], rng=rng
    ),
    "constant": lambda p, rng: ConstantDistribution(value=p["value"], rng=rng),
    "empirical": lambda p, rng: EmpiricalDistribution(
        values=p["values"], method=p["method"], rng=rng
    ),
}


def create_distribution(spec: Distribution, rng: random.Random) -> BaseDistribution:
    """`Distribution` şemasından çalıştırılabilir bir örnekleyici üretir.

    Parametre doğrulaması şema katmanında (`models.schemas.Distribution`)
    yapıldığı için burada tekrarlanmaz; fabrika yalnızca eşleme yapar. Bu
    ayrım bilinçlidir: geçersiz bir konfigürasyon API sınırında, simülasyon
    başlamadan önce reddedilir.

    Args:
        spec: Doğrulanmış dağılım şeması.
        rng: Bu dağılıma ayrılmış rastgele sayı akışı. Her rastgele kaynağın
            kendi akışını alması, senaryolar arası karşılaştırmanın geçerli
            olması için gereklidir (bkz. `base.RandomStreamFactory`).

    Returns:
        `BaseDistribution` arayüzünü uygulayan örnekleyici.

    Raises:
        ValueError: Şema tipi için kayıtlı bir kurucu yoksa.
    """
    try:
        builder = _BUILDERS[spec.type]
    except KeyError as exc:  # pragma: no cover - Literal tipi bunu engeller
        raise ValueError(f"Bilinmeyen dagilim tipi: {spec.type!r}") from exc
    return builder(spec.params, rng)


__all__ = [
    "MAX_UNIFORM",
    "MIN_UNIFORM",
    "SEED_BITS",
    "BaseDistribution",
    "ConstantDistribution",
    "EmpiricalDistribution",
    "ExponentialDistribution",
    "NormalDistribution",
    "RandomStreamFactory",
    "TriangularDistribution",
    "create_distribution",
]
