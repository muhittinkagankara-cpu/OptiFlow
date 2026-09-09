"""Runtime KPI motoru.

Ekrandaki her sayı buradan çıkar ve ölçüme dayanır; ölçülemeyen alan `None`
döner. Girdi iki kaynaktır: makine görüntüleri (son bilinen değerler) ve olay
geçmişi (hız ancak zaman içindeki değişimden çıkar).
"""

from simulation_engine.runtime.kpi.engine import (
    MIN_THROUGHPUT_WINDOW_MS,
    KpiInput,
    KpiSnapshot,
    ProductionSample,
    active_machines,
    alarm_count,
    availability_ratio,
    compute_kpi,
    downtime_minutes,
    is_finite_number,
    production_total,
    queue_total,
    scrap_total,
    throughput_per_hour,
)

__all__ = [
    "KpiInput",
    "KpiSnapshot",
    "MIN_THROUGHPUT_WINDOW_MS",
    "ProductionSample",
    "active_machines",
    "alarm_count",
    "availability_ratio",
    "compute_kpi",
    "downtime_minutes",
    "is_finite_number",
    "production_total",
    "queue_total",
    "scrap_total",
    "throughput_per_hour",
]
