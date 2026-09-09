"""Kalıcı telemetri: yazma, saklama ve trend hesabı.

Katmanlar:

* `types` — ölçüm, tampon ve trend penceresi modelleri
* `writer` — toplu yazma ve verim sayaçları
* `retention` — saklama politikası ve temizleme işi
* `trends` — ham ölçümleri zaman kovalarına toplama
"""

from simulation_engine.runtime.telemetry.retention import (
    CLEANUP_INTERVAL_MS,
    CleanupJob,
    CleanupResult,
    MAX_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
    RetentionPolicy,
    clamp_retention_days,
    cutoff_ms,
)
from simulation_engine.runtime.telemetry.trends import (
    bucket_index,
    build_series,
    empty_buckets,
    excluded_count,
    load_series,
    series_summary,
)
from simulation_engine.runtime.telemetry.types import (
    BATCH_SIZE,
    CLEANUP_BATCH,
    DEFAULT_RETENTION_DAYS,
    TREND_WINDOWS,
    TelemetryBatch,
    TelemetryPoint,
    TrendBucket,
    TrendSeries,
    TrendWindow,
    point_key,
    window_of,
)
from simulation_engine.runtime.telemetry.writer import (
    FLUSH_INTERVAL_MS,
    THROUGHPUT_WINDOW_MS,
    TelemetryWriter,
    WriterStats,
    writes_per_second,
)

__all__ = [
    "BATCH_SIZE",
    "CLEANUP_BATCH",
    "CLEANUP_INTERVAL_MS",
    "CleanupJob",
    "CleanupResult",
    "DEFAULT_RETENTION_DAYS",
    "FLUSH_INTERVAL_MS",
    "MAX_RETENTION_DAYS",
    "MIN_RETENTION_DAYS",
    "RetentionPolicy",
    "TREND_WINDOWS",
    "THROUGHPUT_WINDOW_MS",
    "TelemetryBatch",
    "TelemetryPoint",
    "TelemetryWriter",
    "TrendBucket",
    "TrendSeries",
    "TrendWindow",
    "WriterStats",
    "bucket_index",
    "build_series",
    "clamp_retention_days",
    "cutoff_ms",
    "empty_buckets",
    "excluded_count",
    "load_series",
    "point_key",
    "series_summary",
    "window_of",
    "writes_per_second",
]
