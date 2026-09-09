"""Performans (Performance) — OEE'nin ikinci çarpanı.

    Performance = Gerçekleşen Çıktı / Beklenen Çıktı

Beklenen çıktı, çalışma süresinin ideal çevrim süresine bölümüdür. İdeal
çevrim süresi bilinmiyorsa performans **hesaplanamaz**: bir hattın ne kadar
hızlı olabileceğini bilmeden ne kadar hızlı olduğunu söylemek mümkün değildir.

Neden 1'in üstü kırpılır
------------------------
Gerçekleşen çıktı beklenenin üstüne çıkabilir (ideal çevrim süresi olduğundan
uzun tanımlanmışsa). %118 performans göstermek, tanımın yanlış olduğunu
gizler; değer kırpılır ve kırpıldığı ayrıca bildirilir.
"""

from __future__ import annotations

from typing import Optional

from simulation_engine.runtime.oee.availability import clamp_ratio, is_clamped


def expected_output(
    run_time_ms: Optional[float], ideal_cycle_seconds: Optional[float]
) -> Optional[float]:
    """Çalışma süresinde üretilebilecek parça sayısı; bilinmiyorsa `None`."""
    if run_time_ms is None or ideal_cycle_seconds is None:
        return None
    if ideal_cycle_seconds <= 0 or run_time_ms <= 0:
        return None
    return (run_time_ms / 1000.0) / ideal_cycle_seconds


def performance(
    actual_output: Optional[float],
    run_time_ms: Optional[float],
    ideal_cycle_seconds: Optional[float],
) -> Optional[float]:
    """Performans oranı (0-1); hesaplanamıyorsa `None`."""
    if actual_output is None:
        return None

    expected = expected_output(run_time_ms, ideal_cycle_seconds)
    if expected is None or expected <= 0:
        return None

    return clamp_ratio(actual_output / expected)


def performance_was_clamped(
    actual_output: Optional[float],
    run_time_ms: Optional[float],
    ideal_cycle_seconds: Optional[float],
) -> bool:
    """Değer 0-1 dışına çıktığı için kırpıldı mı?"""
    expected = expected_output(run_time_ms, ideal_cycle_seconds)
    if actual_output is None or expected is None or expected <= 0:
        return False
    return is_clamped(actual_output / expected)


def performance_reason(
    actual_output: Optional[float],
    run_time_ms: Optional[float],
    ideal_cycle_seconds: Optional[float],
) -> Optional[str]:
    """Hesaplanamadıysa nedeni."""
    if actual_output is None:
        return "Üretim adedi ölçülmedi."
    if ideal_cycle_seconds is None:
        return "İdeal çevrim süresi tanımlı değil."
    if ideal_cycle_seconds <= 0:
        return "İdeal çevrim süresi sıfır ya da negatif."
    if run_time_ms is None:
        return "Çalışma süresi hesaplanamadı (planlanan süre ya da duruş eksik)."
    if run_time_ms <= 0:
        return "Çalışma süresi sıfır."
    return None
