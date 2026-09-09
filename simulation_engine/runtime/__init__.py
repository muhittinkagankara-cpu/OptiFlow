"""Runtime köprüsü: fabrika cihazlarına sunucu tarafından bağlanan katman.

Akış tek yönlüdür — Frontend → Backend → Connector → Device. Tarayıcı hiçbir
cihaza doğrudan bağlanmaz.

Katmanlar:

* `types`    — ortak şema ve dürüstlük sözleşmesi (ölçülmeyen alan `None`).
* `registry` — organizasyon başına bağlantı kayıtları (süreç belleğinde).
* `health`   — gecikme, hata, yeniden bağlanma ve çalışma süresi ölçümü.
* `events`   — son 1000 olayın tamponu ve SSE dağıtımı.
* `adapters` — REST, OPC UA ve MQTT sürücüleri.
* `manager`  — hepsini birleştiren tek giriş noktası.
* `api`      — HTTP uçları.
"""

from simulation_engine.runtime.events import (
    EventBuffer,
    EventDispatcher,
    RuntimeEvent,
    format_sse,
)
from simulation_engine.runtime.health import HealthMonitor, retry_delay_ms, should_retry
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.registry import (
    ConnectionExists,
    ConnectionNotFound,
    ConnectionRegistry,
    ConnectionState,
)
from simulation_engine.runtime.types import (
    ConnectionKind,
    ConnectionSpec,
    ConnectionStatus,
    EventLevel,
    ProbeResult,
    SecurityPolicy,
    STATUS_LABEL,
    not_attempted,
)

__all__ = [
    "ConnectionExists",
    "ConnectionKind",
    "ConnectionNotFound",
    "ConnectionRegistry",
    "ConnectionSpec",
    "ConnectionState",
    "ConnectionStatus",
    "EventBuffer",
    "EventDispatcher",
    "EventLevel",
    "HealthMonitor",
    "ProbeResult",
    "RuntimeEvent",
    "RuntimeManager",
    "STATUS_LABEL",
    "SecurityPolicy",
    "format_sse",
    "not_attempted",
    "retry_delay_ms",
    "should_retry",
]
