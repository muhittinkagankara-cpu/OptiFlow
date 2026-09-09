"""Kalite (Quality) — OEE'nin üçüncü çarpanı.

    Quality = Sağlam Parça / Toplam Parça

Fire ölçülmediyse kalite **hesaplanamaz**. Fireyi sıfır varsaymak, hiç
ölçülmemiş bir hattı kusursuz göstermek olurdu; ve kalite bir çarpan olduğu
için bu, OEE'yi olduğundan yüksek çıkarır.
"""

from __future__ import annotations

from typing import Optional

from simulation_engine.runtime.oee.availability import clamp_ratio


def total_parts(
    good_parts: Optional[float], scrap_parts: Optional[float]
) -> Optional[float]:
    """Toplam üretilen parça; ikisinden biri eksikse `None`."""
    if good_parts is None or scrap_parts is None:
        return None
    return max(0.0, good_parts) + max(0.0, scrap_parts)


def quality(
    good_parts: Optional[float], scrap_parts: Optional[float]
) -> Optional[float]:
    """Kalite oranı (0-1); hesaplanamıyorsa `None`."""
    total = total_parts(good_parts, scrap_parts)
    if total is None or total <= 0:
        return None
    return clamp_ratio(max(0.0, good_parts or 0.0) / total)


def quality_from_production(
    production_count: Optional[float], scrap_count: Optional[float]
) -> Optional[float]:
    """Üretim sayacı **toplamı** içeriyorsa kaliteyi hesaplar.

    Cihazların çoğu `production_count` alanında toplam üretimi (sağlam + fire)
    yayınlar. Bu durumda sağlam parça, toplamdan firenin çıkarılmasıdır.
    """
    if production_count is None or scrap_count is None:
        return None
    if production_count <= 0:
        return None
    good = max(0.0, production_count - max(0.0, scrap_count))
    return clamp_ratio(good / production_count)


def quality_reason(
    good_parts: Optional[float], scrap_parts: Optional[float]
) -> Optional[str]:
    """Hesaplanamadıysa nedeni."""
    if good_parts is None:
        return "Üretim adedi ölçülmedi."
    if scrap_parts is None:
        return "Fire adedi ölçülmedi."
    if total_parts(good_parts, scrap_parts) == 0:
        return "Hiç parça üretilmedi."
    return None
