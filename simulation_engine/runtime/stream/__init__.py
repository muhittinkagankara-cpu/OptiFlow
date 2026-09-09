"""Gerçek cihaz veri akışı.

Akışın yolu tek yönlüdür ve tek kapıdan geçer:

    OPC UA aboneliği / MQTT aboneliği / REST yoklaması
        → RestPoller | OpcUaSubscriber | MqttSubscriber
        → DeviceDataEvent (bağlantı içinde artan sıra numarasıyla)
        → StreamDispatcher (yineleme elenir, kuyruk sınırlıdır)
        → depo, izleme, alarm, KPI, SSE

Hiçbir React bileşeni protokol kodu görmez; hiçbir alıcı doğrudan cihazla
konuşmaz.
"""

from simulation_engine.runtime.stream.backpressure import (
    DEFAULT_CAPACITY,
    PRESSURE_RATIO,
    BoundedEventQueue,
    loss_ratio,
)
from simulation_engine.runtime.stream.engine import (
    BROADCAST_BUFFER,
    EVALUATION_INTERVAL_MS,
    StreamEngine,
    build_mqtt_subscriber,
    build_opcua_subscriber,
    build_poller,
)
from simulation_engine.runtime.stream.dispatcher import (
    DEDUP_WINDOW,
    LATENCY_SAMPLES,
    SinkRegistration,
    StreamDispatcher,
)
from simulation_engine.runtime.stream.poller import (
    PollOutcome,
    RestPoller,
    emit_result,
    usable_events,
)
from simulation_engine.runtime.stream.scheduler import (
    DEFAULT_POLL_INTERVAL_MS,
    MAX_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
    STREAM_HEALTH_LABEL,
    PollScheduler,
    ScheduleEntry,
    StreamHealth,
    backoff_interval_ms,
    clamp_interval_ms,
    poll_rate_hz,
)
from simulation_engine.runtime.stream.subscriber import (
    MqttSubscriber,
    OpcUaSubscriber,
    SubscriptionOutcome,
)
from simulation_engine.runtime.stream.types import (
    SOURCE_PROTOCOL_LABEL,
    DeviceDataEvent,
    SequenceCounter,
    SourceProtocol,
    dedup_key,
    from_device_event,
    protocol_of,
)

__all__ = [
    "BROADCAST_BUFFER",
    "BoundedEventQueue",
    "DEDUP_WINDOW",
    "DEFAULT_CAPACITY",
    "DEFAULT_POLL_INTERVAL_MS",
    "DeviceDataEvent",
    "EVALUATION_INTERVAL_MS",
    "LATENCY_SAMPLES",
    "MAX_POLL_INTERVAL_MS",
    "MIN_POLL_INTERVAL_MS",
    "MqttSubscriber",
    "OpcUaSubscriber",
    "PRESSURE_RATIO",
    "PollOutcome",
    "PollScheduler",
    "RestPoller",
    "SOURCE_PROTOCOL_LABEL",
    "STREAM_HEALTH_LABEL",
    "ScheduleEntry",
    "SequenceCounter",
    "SinkRegistration",
    "SourceProtocol",
    "StreamDispatcher",
    "StreamEngine",
    "StreamHealth",
    "SubscriptionOutcome",
    "backoff_interval_ms",
    "build_mqtt_subscriber",
    "build_opcua_subscriber",
    "build_poller",
    "clamp_interval_ms",
    "dedup_key",
    "emit_result",
    "from_device_event",
    "loss_ratio",
    "poll_rate_hz",
    "protocol_of",
    "usable_events",
]
