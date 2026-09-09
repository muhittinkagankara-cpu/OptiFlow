"""Cihaz verisi boru hattı.

    Device → Transformer → DeviceEvent → Dispatcher → SSE → Frontend

Katmanlar:

* `device_events` — bütün protokollerin ortak veri modeli ve kalite bilgisi.
* `transformers`  — OPC UA / MQTT / REST yüklerinin bu modele çevrilmesi.
* `aggregators`   — üretim metriklerinin gerçek veriden hesaplanması
                    (ölçülemeyen alan `None`).
* `dispatcher`    — tek çıkış kapısı: yayım, tanılama ve eşleme doğrulaması.
"""

from simulation_engine.runtime.pipeline.aggregators import (
    LineTotals,
    MachineSnapshot,
    aggregate,
    line_totals,
    production_delta,
    snapshot_for,
    throughput_per_hour,
)
from simulation_engine.runtime.pipeline.device_events import (
    METRIC_LABEL,
    DeviceEvent,
    MachineState,
    Metric,
    PipelineProblem,
    Quality,
    TransformResult,
    metric_from_name,
    parse_machine_state,
)
from simulation_engine.runtime.pipeline.dispatcher import (
    DeviceDispatcher,
    MappingWarning,
    detect_source_conflicts,
    verify_mapping,
)
from simulation_engine.runtime.pipeline.transformers import (
    MappingTable,
    MetricMapping,
    flatten,
    from_json_payload,
    from_mqtt_message,
    from_opcua_value,
    from_rest_payload,
)

__all__ = [
    "DeviceDispatcher",
    "DeviceEvent",
    "LineTotals",
    "METRIC_LABEL",
    "MachineSnapshot",
    "MachineState",
    "MappingTable",
    "MappingWarning",
    "Metric",
    "MetricMapping",
    "PipelineProblem",
    "Quality",
    "TransformResult",
    "aggregate",
    "detect_source_conflicts",
    "flatten",
    "from_json_payload",
    "from_mqtt_message",
    "from_opcua_value",
    "from_rest_payload",
    "line_totals",
    "metric_from_name",
    "parse_machine_state",
    "production_delta",
    "snapshot_for",
    "throughput_per_hour",
    "verify_mapping",
]
