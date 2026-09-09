"""Bağlayıcı sürücüleri.

Her sürücü tek bir soruya yanıt verir: cihazdan gerçek bir yanıt alındı mı?
Kütüphaneler (asyncua, aiomqtt) **tembel** içe aktarılır; kurulu değillerse
uygulama yine açılır ve ilgili bağlantı "Doğrulanmadı" olarak görünür.
"""

from simulation_engine.runtime.adapters.base import (
    RuntimeAdapter,
    clamp_qos,
    clamp_timeout_ms,
    describe_network_error,
    failed,
    is_valid_endpoint,
    missing_library,
    split_endpoint,
    succeeded,
)
from simulation_engine.runtime.adapters.mqtt import MqttAdapter
from simulation_engine.runtime.adapters.opcua import OpcUaAdapter
from simulation_engine.runtime.adapters.rest import RestAdapter

__all__ = [
    "MqttAdapter",
    "OpcUaAdapter",
    "RestAdapter",
    "RuntimeAdapter",
    "clamp_qos",
    "clamp_timeout_ms",
    "describe_network_error",
    "failed",
    "is_valid_endpoint",
    "missing_library",
    "split_endpoint",
    "succeeded",
]
