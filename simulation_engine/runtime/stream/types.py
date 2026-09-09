"""Akış katmanının ortak modeli.

Neden `DeviceEvent` yetmedi
---------------------------
`pipeline/device_events.DeviceEvent` bir **ölçümü** anlatır: hangi makinenin
hangi metriği, hangi kalitede. Akış katmanının buna ek olarak iki soruyu
yanıtlaması gerekir: *bu ölçüm kaçıncı sırada geldi* ve *hangi protokolden*.

Sıra numarası olmadan yinelenen bir olayı ayırt etmek mümkün değildir. Aynı
REST yanıtı iki kez yoklanırsa (yeniden bağlanma, çift zamanlayıcı, kurtarma
sonrası tekrar) içerik birebir aynı olur; zaman damgası bile aynı olabilir.
Sıra numarası bu iki okumayı ayırır ve dağıtıcı ikincisini eler.

Sıra numarası bağlantı başına
-----------------------------
Numaralar **bağlantı içinde** artar, sistem genelinde değil. Genel bir sayaç
tek bir kilit noktası olur ve iki bağlantı birbirini bekletirdi; ayrıca bir
bağlantının numaraları ötekinin kopmasından etkilenmemelidir.

Kalite neden taşınır
--------------------
OPC UA bir değerin yanında güvenilirliğini de bildirir. Bozuk kaliteli bir
değer sayısal olarak okunabilir ama anlamlı değildir; kaliteyi atıp yalnızca
sayıyı taşımak, arızalı bir sensörün son değerini gerçek üretim gibi
göstermek olurdu.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional

from simulation_engine.runtime.pipeline.device_events import (
    DeviceEvent,
    Quality,
)
from simulation_engine.runtime.types import ConnectionKind


class SourceProtocol(str, Enum):
    """Olayın hangi protokolden geldiği."""

    REST = "rest"
    OPCUA = "opcua"
    MQTT = "mqtt"
    UNKNOWN = "unknown"


SOURCE_PROTOCOL_LABEL: Dict[SourceProtocol, str] = {
    SourceProtocol.REST: "REST yoklama",
    SourceProtocol.OPCUA: "OPC UA aboneliği",
    SourceProtocol.MQTT: "MQTT aboneliği",
    SourceProtocol.UNKNOWN: "Bilinmeyen kaynak",
}


def protocol_of(kind: ConnectionKind) -> SourceProtocol:
    """Bağlantı türünü protokole çevirir; tanınmayan tür `UNKNOWN` olur."""
    mapping = {
        ConnectionKind.REST: SourceProtocol.REST,
        ConnectionKind.OPCUA: SourceProtocol.OPCUA,
        ConnectionKind.MQTT: SourceProtocol.MQTT,
    }
    return mapping.get(kind, SourceProtocol.UNKNOWN)


@dataclass(frozen=True)
class DeviceDataEvent:
    """Akıştan geçen tek bir cihaz ölçümü."""

    connector_id: str
    machine_id: str
    #: Ölçümün adı (`production_count`, `queue_length`, ...).
    field: str
    value: Any
    #: Ölçümün cihazdaki anı (epoch ms). Bu modülde saat okunmaz.
    timestamp: int
    source_protocol: SourceProtocol
    quality: Quality
    #: Bağlantı içinde artan sıra numarası.
    sequence: int
    #: Ölçümün geldiği ham adres (düğüm kimliği, konu adı, JSON alanı).
    origin: Optional[str] = None
    unit: Optional[str] = None
    #: Bu olayın çıktığı ham ölçüm.
    #:
    #: Taşınmasının nedeni, görüntü (snapshot) ve kalıcılık boru hattının
    #: `DeviceEvent` ile çalışmasıdır. Yeniden ayrıştırmak, aynı yükü iki kez
    #: çözmek ve iki farklı sonuç üretme riski almak olurdu.
    device_event: Optional[DeviceEvent] = None

    @property
    def key(self) -> str:
        """Yineleme denetiminin anahtarı: `bağlantı::sıra`."""
        return dedup_key(self.connector_id, self.sequence)

    @property
    def is_usable(self) -> bool:
        """Bu ölçüm bir metriği güncellemek için kullanılabilir mi?

        Bozuk kaliteli ya da değeri olmayan bir ölçüm sayı üretmez; sayaçları
        onunla güncellemek, arızalı bir sensörü gerçek üretim saymak olurdu.
        """
        return self.quality is not Quality.BAD and self.value is not None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "connector_id": self.connector_id,
            "machine_id": self.machine_id,
            "field": self.field,
            "value": self.value,
            "timestamp": self.timestamp,
            "source_protocol": self.source_protocol.value,
            "source_label": SOURCE_PROTOCOL_LABEL[self.source_protocol],
            "quality": self.quality.value,
            "sequence": self.sequence,
            "origin": self.origin,
            "unit": self.unit,
            "usable": self.is_usable,
        }


def dedup_key(connector_id: str, sequence: int) -> str:
    """Yineleme anahtarı.

    Anahtar yalnızca sıra numarasından oluşsaydı, iki bağlantının aynı
    numarayı üretmesi birinin olaylarını sessizce yutardı.
    """
    return f"{connector_id}::{sequence}"


@dataclass
class SequenceCounter:
    """Bağlantı başına monoton artan sıra numarası üretir.

    Kurtarmadan sonra numaralandırma **diskteki son numaradan** sürer
    (`resume_from`); sıfırdan başlasaydı yeni olaylar eski numaralarla
    çakışır ve dağıtıcı onları yinelenmiş sayıp atardı.
    """

    _values: Dict[str, int] = field(default_factory=dict)

    def next(self, connector_id: str) -> int:
        """Sıradaki numarayı verir (birden başlar)."""
        current = self._values.get(connector_id, 0) + 1
        self._values[connector_id] = current
        return current

    def current(self, connector_id: str) -> int:
        """Bu bağlantı için verilmiş son numara; hiç verilmediyse 0."""
        return self._values.get(connector_id, 0)

    def resume_from(self, connector_id: str, sequence: int) -> int:
        """Numaralandırmayı verilen noktadan sürdürür.

        Geriye alma yapılmaz: verilen numara mevcut olandan küçükse sayaç
        olduğu yerde kalır. Geri alınsaydı kurtarma, henüz işlenmiş
        numaraları yeniden üretir ve gerçek ölçümler yinelenmiş sayılırdı.
        """
        current = self._values.get(connector_id, 0)
        self._values[connector_id] = max(current, max(0, sequence))
        return self._values[connector_id]

    def reset(self, connector_id: Optional[str] = None) -> None:
        if connector_id is None:
            self._values.clear()
        else:
            self._values.pop(connector_id, None)


def from_device_event(
    event: DeviceEvent, sequence: int
) -> DeviceDataEvent:
    """`DeviceEvent`'i akış olayına çevirir.

    Çeviri kayıpsızdır: metrik adı `field`, ölçüm anı `timestamp`, bağlantı
    türü `source_protocol` olur. Böylece mevcut dönüştürücüler (OPC UA, MQTT,
    REST ayrıştırıcıları) olduğu gibi kullanılır ve akış katmanı protokol
    ayrıntısı bilmez.
    """
    return DeviceDataEvent(
        connector_id=event.connection_id,
        machine_id=event.machine_id,
        field=event.metric.value,
        value=event.value,
        timestamp=event.at_ms,
        source_protocol=protocol_of(event.source),
        quality=event.quality,
        sequence=sequence,
        origin=event.origin,
        unit=event.unit,
        device_event=event,
    )
