"""Runtime kalıcılığı.

    Device → Runtime → PostgreSQL → BridgeLiveProvider → Live Factory

Katmanlar:

* `models`     — dört tablo: bağlantılar, görüntüler, olaylar, sağlık.
* `snapshots`  — makine görüntüsü motoru ve KPI toplamı (saf).
* `repository` — bellek ve veritabanı depoları; arayüzleri aynıdır.
* `migrations` — tabloların oluşturulması ve şema kontrolü.
"""

from simulation_engine.runtime.persistence.migrations import (
    drop_runtime_tables,
    ensure_runtime_tables,
    missing_tables,
    runtime_schema_ready,
)
from simulation_engine.runtime.persistence.models import (
    RUNTIME_TABLE_NAMES,
    DeviceSnapshotRow,
    RuntimeConnectionRow,
    RuntimeEventRow,
    RuntimeHealthRow,
    scoped_id,
)
from simulation_engine.runtime.persistence.repository import (
    MAX_PERSISTED_EVENTS,
    DatabaseRuntimeRepository,
    InMemoryRuntimeRepository,
    StoredConnection,
    StoredEvent,
    StoredHealth,
    create_runtime_repository,
    persisted_status,
)
from simulation_engine.runtime.persistence.snapshots import (
    BLOCKED,
    DOWN,
    IDLE,
    RUNNING,
    STATION_STATUS_LABEL,
    UNKNOWN,
    LiveKpi,
    MachineSnapshotRecord,
    aggregate_kpi,
    apply_event,
    apply_events,
    conflicting_metrics,
    stale_snapshots,
    status_from_event,
)

__all__ = [
    "BLOCKED",
    "DOWN",
    "DatabaseRuntimeRepository",
    "DeviceSnapshotRow",
    "IDLE",
    "InMemoryRuntimeRepository",
    "LiveKpi",
    "MAX_PERSISTED_EVENTS",
    "MachineSnapshotRecord",
    "RUNNING",
    "RUNTIME_TABLE_NAMES",
    "RuntimeConnectionRow",
    "RuntimeEventRow",
    "RuntimeHealthRow",
    "STATION_STATUS_LABEL",
    "StoredConnection",
    "StoredEvent",
    "StoredHealth",
    "UNKNOWN",
    "aggregate_kpi",
    "apply_event",
    "apply_events",
    "conflicting_metrics",
    "create_runtime_repository",
    "drop_runtime_tables",
    "ensure_runtime_tables",
    "missing_tables",
    "persisted_status",
    "runtime_schema_ready",
    "scoped_id",
    "stale_snapshots",
    "status_from_event",
]
