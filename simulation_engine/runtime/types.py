"""Runtime köprüsünün ortak şeması.

Bu katmanın tek amacı, tarayıcı ile fabrika cihazı arasına **sunucu tarafında**
bir köprü koymaktır. Akış tek yönlüdür:

    Frontend → Backend → Connector → Device

Tarayıcı hiçbir zaman doğrudan bir PLC'ye ya da broker'a bağlanmaz; bunu
yapabilseydi cihaz kimlik bilgileri istemciye inmek zorunda kalırdı.

Dürüstlük sözleşmesi
--------------------
Bu modüldeki en önemli karar `ConnectionStatus.CONNECTED`'in ne zaman
yazılabileceğidir. Bir bağlantı ancak **gerçek bir cihazdan yanıt alındığında**
bağlı sayılır: OPC UA'da oturum açılıp bir düğüm okunduğunda, MQTT'de broker
CONNACK döndürüp abonelik onaylandığında, REST'te uç bir HTTP durum kodu
döndürdüğünde. Yapılandırmanın kaydedilmiş olması, bir soketin açılmış olması
ya da bir kütüphanenin kurulu olması **bağlantı değildir**.

Ölçülemeyen her alan `None` döner. Sıfır yazmak, ölçülmüş bir sıfırla
ölçülmemiş bir bilinmezi aynı şeye çevirirdi: "gecikme 0 ms" ile "gecikme
ölçülmedi" arasındaki fark, bir hattın izlenip izlenmediği sorusunun yanıtıdır.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ConnectionKind(str, Enum):
    """Desteklenen bağlantı türleri."""

    REST = "rest"
    OPCUA = "opcua"
    MQTT = "mqtt"


class ConnectionStatus(str, Enum):
    """Bir bağlantının o andaki durumu.

    `CONNECTED` yalnızca gerçek bir cihaz yanıtından sonra yazılır. Ara
    durumların ayrı ayrı bulunması, arayüzün "deniyor" ile "kuruldu" arasındaki
    farkı gösterebilmesi içindir.
    """

    #: Hiç denenmedi.
    IDLE = "idle"
    #: Şu anda deneniyor; henüz yanıt yok.
    CONNECTING = "connecting"
    #: Gerçek cihazdan yanıt alındı.
    CONNECTED = "connected"
    #: Bağlantı koptu, yeniden deneniyor.
    RETRYING = "retrying"
    #: Denendi ve kurulamadı.
    FAILED = "failed"
    #: Kullanıcı kapattı.
    DISCONNECTED = "disconnected"


#: Kullanıcıya gösterilen durum metinleri.
#:
#: Sözleşme gereği yalnızca doğrulanmış bir bağlantı "Bağlandı" diyebilir;
#: ötekiler ne olduğunu değil, **ne olmadığını** söyler.
STATUS_LABEL: Dict[ConnectionStatus, str] = {
    ConnectionStatus.IDLE: "Test edilmedi",
    ConnectionStatus.CONNECTING: "Deneniyor",
    ConnectionStatus.CONNECTED: "Bağlandı (doğrulandı)",
    ConnectionStatus.RETRYING: "Yeniden deneniyor",
    ConnectionStatus.FAILED: "Bağlantı kurulamadı",
    ConnectionStatus.DISCONNECTED: "Kapatıldı",
}


class EventLevel(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class SecurityPolicy(str, Enum):
    """OPC UA güvenlik politikası.

    `NONE` şifreleme yoktur ve parola düz metin gider; kullanıcıya bu söylenir.
    """

    NONE = "None"
    BASIC256SHA256 = "Basic256Sha256"


@dataclass(frozen=True)
class ConnectionSpec:
    """Bir bağlantının yapılandırması.

    Kimlik bilgileri sunucuda kalır; `redacted()` bunları maskeler ve API
    yanıtlarında yalnızca maskelenmiş hâli görünür. Parolanın yanıtla geri
    dönmesi, tarayıcı geçmişine ve günlüklere sızması demek olurdu.
    """

    connection_id: str
    kind: ConnectionKind
    #: Kullanıcının verdiği ad.
    label: str
    #: REST için tam URL, OPC UA için `opc.tcp://...`, MQTT için broker adresi.
    endpoint: str
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    #: OPC UA düğümleri ya da MQTT konuları.
    topics: List[str] = field(default_factory=list)
    security_policy: SecurityPolicy = SecurityPolicy.NONE
    qos: int = 1
    timeout_ms: int = 5_000
    #: Kaç kez yeniden denensin? 0 = deneme.
    max_retries: int = 3

    def redacted(self) -> Dict[str, Any]:
        """Yanıtlarda gösterilebilecek hâli."""
        return {
            "connection_id": self.connection_id,
            "kind": self.kind.value,
            "label": self.label,
            "endpoint": self.endpoint,
            "port": self.port,
            "username": self.username,
            # Parola hiçbir yanıtta yer almaz; yalnızca var olup olmadığı.
            "has_password": self.password is not None and self.password != "",
            "topics": list(self.topics),
            "security_policy": self.security_policy.value,
            "qos": self.qos,
            "timeout_ms": self.timeout_ms,
            "max_retries": self.max_retries,
        }


@dataclass(frozen=True)
class ProbeResult:
    """Tek bir bağlantı denemesinin sonucu.

    `ok=True` yalnızca cihazdan gerçek bir yanıt alındığında döner ve o zaman
    `evidence` alanı **ne alındığını** yazar ("ns=2;i=2 düğümü okundu: 42").
    Kanıtsız bir başarı, sonradan doğrulanamaz bir iddiadır.
    """

    ok: bool
    #: Denemenin süresi (ms); ölçülemediyse `None`.
    latency_ms: Optional[float]
    #: Başarıda ne alındığı, başarısızlıkta neden kurulamadığı.
    detail: str
    #: Cihazdan gelen somut kanıt; yoksa `None`.
    evidence: Optional[str] = None
    #: Alınan bayt sayısı; ölçülemediyse `None`.
    bytes_received: Optional[int] = None
    #: Denemenin yapıldığı an (epoch ms).
    at_ms: int = field(default_factory=lambda: int(time.time() * 1000))


def not_attempted(reason: str) -> ProbeResult:
    """Hiç denenmemiş bir bağlantının sonucu.

    Ölçülmemiş alanların tamamı `None`'dır: deneme yapılmadıysa gecikme de
    bayt sayısı da yoktur ve sıfır yazmak ölçüm yapılmış izlenimi verirdi.
    """
    return ProbeResult(
        ok=False,
        latency_ms=None,
        detail=reason,
        evidence=None,
        bytes_received=None,
    )
