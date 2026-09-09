"""Cihaz devreye alma: keşif, etiket ve parmak izi modelleri.

Sorun
-----
Bugüne kadar bir bağlantı kurmak için kullanıcının `ns=2;i=2` gibi düğüm
kimliklerini elle yazması gerekiyordu. Bir sahada bu bilgi çoğu zaman yoktur:
PLC'yi kuran firma gitmiştir, belgeler eksiktir, etiket adları kimsenin
bilmediği bir Excel dosyasındadır. Keşif, cihazın kendisine sormaktır.

Dürüstlük kuralı
----------------
Keşif **uydurmaz**. Bir uçtan yanıt alınamadıysa boş liste döner ve nedeni
yazılır; örnek etiketler üretilmez. Örnek üretilseydi, kullanıcı olmayan bir
düğümü eşler ve hata ancak üretimde ortaya çıkardı.

Parmak izi neden var
--------------------
Aynı uç adresine bir gün farklı bir cihaz takılabilir (PLC değişimi, IP
yeniden atama). Parmak izi, uçtaki cihazın "aynı cihaz" olup olmadığını
söyler: uç adresi ile bulunan düğüm kümesinin özetidir. Değiştiğinde eşleme
sessizce yanlış makineye yazmak yerine uyarı üretir.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Iterable, List, Optional

from simulation_engine.runtime.types import ConnectionKind

#: Keşifte döndürülen en fazla etiket.
#:
#: Büyük bir OPC UA sunucusunda on binlerce düğüm bulunabilir; hepsini
#: tarayıcıya göndermek listeyi kullanılamaz hâle getirir. Kullanıcı arama
#: kutusuyla daraltır, keşif ilk katmanı verir.
MAX_DISCOVERED_TAGS = 500

#: MQTT keşfinde dinlenen süre (ms).
#:
#: MQTT'de "hangi konular var?" diye sorulamaz; yalnızca dinlenip gelen
#: konular toplanabilir. Üç saniye, saniyede bir yayın yapan bir hattın
#: konularını yakalamaya yeter.
MQTT_LISTEN_MS = 3_000


class ProvisioningStep(str, Enum):
    """Sihirbazın adımları.

    Sıra bir karardır: uç adresi doğrulanmadan keşif yapılamaz, keşif
    yapılmadan etiket seçilemez, etiket seçilmeden eşleme kurulamaz. Test
    adımı kaydetmeden **önce** gelir: kaydedilmiş ama hiç denenmemiş bir
    bağlantı, arayüzde çalışıyormuş gibi durur.
    """

    ENDPOINT = "endpoint"
    DISCOVERY = "discovery"
    TAGS = "tags"
    MAPPING = "mapping"
    TEST = "test"
    SAVE = "save"


PROVISIONING_STEP_LABEL: Dict[ProvisioningStep, str] = {
    ProvisioningStep.ENDPOINT: "Uç adresi",
    ProvisioningStep.DISCOVERY: "Keşif",
    ProvisioningStep.TAGS: "Etiket seçimi",
    ProvisioningStep.MAPPING: "Eşleme",
    ProvisioningStep.TEST: "Test",
    ProvisioningStep.SAVE: "Kaydet",
}

#: Adımların sırası.
PROVISIONING_ORDER: List[ProvisioningStep] = [
    ProvisioningStep.ENDPOINT,
    ProvisioningStep.DISCOVERY,
    ProvisioningStep.TAGS,
    ProvisioningStep.MAPPING,
    ProvisioningStep.TEST,
    ProvisioningStep.SAVE,
]


class TagKind(str, Enum):
    """Bulunan etiketin ne tür veri taşıdığı."""

    #: Artan sayaç (üretim adedi, hurda adedi).
    COUNTER = "counter"
    #: Anlık ölçüm (sıcaklık, kuyruk uzunluğu).
    GAUGE = "gauge"
    #: Açık/kapalı.
    BOOLEAN = "boolean"
    #: Metin (durum adı).
    TEXT = "text"
    #: Türü anlaşılamadı; **tahmin edilmez**.
    UNKNOWN = "unknown"


TAG_KIND_LABEL: Dict[TagKind, str] = {
    TagKind.COUNTER: "Sayaç",
    TagKind.GAUGE: "Ölçüm",
    TagKind.BOOLEAN: "Açık/Kapalı",
    TagKind.TEXT: "Metin",
    TagKind.UNKNOWN: "Bilinmiyor",
}


@dataclass(frozen=True)
class DiscoveredTag:
    """Cihazda bulunmuş bir etiket.

    `value` alanı keşif anındaki **gerçek** okumadır; okunamadıysa `None`
    kalır. Örnek bir değer üretilseydi, kullanıcı grafiği ona göre kurar ve
    gerçek veri geldiğinde ölçek tutmazdı.
    """

    #: Cihazdaki adres: OPC UA düğümü, MQTT konusu ya da REST alan yolu.
    address: str
    #: İnsan tarafından okunabilir ad; türetilemezse adresin kendisi.
    name: str
    kind: TagKind = TagKind.UNKNOWN
    #: Keşif anında okunan değer; okunamadıysa `None`.
    value: Optional[Any] = None
    #: Birim, cihaz bildirdiyse.
    unit: Optional[str] = None
    #: Veri tipi adı, cihaz bildirdiyse.
    data_type: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "address": self.address,
            "name": self.name,
            "kind": self.kind.value,
            "kind_label": TAG_KIND_LABEL[self.kind],
            "value": self.value,
            "unit": self.unit,
            "data_type": self.data_type,
        }


@dataclass
class DiscoveryResult:
    """Bir keşif denemesinin sonucu.

    Başarısızlıkta `tags` boş kalır ve `detail` nedeni yazar. Kısmi başarı da
    olabilir: bazı düğümler okunur, bazıları okunamaz; okunamayanlar
    `unreadable` listesinde görünür ve sessizce yutulmaz.
    """

    ok: bool
    kind: ConnectionKind
    endpoint: str
    #: Bulunan etiketler; hiçbiri bulunamadıysa boş.
    tags: List[DiscoveredTag] = field(default_factory=list)
    #: Ne olduğu; başarısızlıkta neden olmadığı.
    detail: str = ""
    #: Cihazdan gelen somut kanıt; yoksa `None`.
    evidence: Optional[str] = None
    #: Denenip okunamayan adresler.
    unreadable: List[str] = field(default_factory=list)
    #: Keşfin süresi (ms); ölçülemediyse `None`.
    latency_ms: Optional[float] = None
    #: Keşfin anı (epoch ms); yapılmadıysa `None`.
    at_ms: Optional[int] = None

    @property
    def tag_count(self) -> int:
        return len(self.tags)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "kind": self.kind.value,
            "endpoint": self.endpoint,
            "tags": [tag.to_dict() for tag in self.tags],
            "tag_count": self.tag_count,
            "detail": self.detail,
            "evidence": self.evidence,
            "unreadable": list(self.unreadable),
            "latency_ms": self.latency_ms,
            "at_ms": self.at_ms,
        }


def discovery_failed(
    kind: ConnectionKind, endpoint: str, detail: str, latency_ms: Optional[float] = None
) -> DiscoveryResult:
    """Başarısız keşif; etiket listesi **boş** kalır.

    Örnek etiket üretilseydi, kullanıcı olmayan bir düğümü eşler ve hata ancak
    üretimde ortaya çıkardı.
    """
    return DiscoveryResult(
        ok=False, kind=kind, endpoint=endpoint, detail=detail, latency_ms=latency_ms
    )


def not_discovered(kind: ConnectionKind, endpoint: str, reason: str) -> DiscoveryResult:
    """Hiç denenmemiş keşif; bütün ölçümler `None`."""
    return DiscoveryResult(
        ok=False,
        kind=kind,
        endpoint=endpoint,
        detail=reason,
        latency_ms=None,
        at_ms=None,
    )


@dataclass(frozen=True)
class DeviceFingerprint:
    """Uçtaki cihazın kimliği.

    Uç adresi ile bulunan adres kümesinin özetidir. Yalnızca uç adresinden
    türetilseydi, aynı IP'ye takılan farklı bir PLC aynı cihaz sanılırdı;
    yalnızca adreslerden türetilseydi, iki özdeş makine ayırt edilemezdi.
    """

    endpoint: str
    kind: ConnectionKind
    #: Bulunan adreslerin sıralı özeti.
    digest: str
    tag_count: int

    def matches(self, other: Optional["DeviceFingerprint"]) -> bool:
        """Aynı cihaz mı?

        Karşılaştırılacak bir parmak izi yoksa `False` döner: bilinmeyen bir
        cihazı "aynı" saymak, değişimi sessizce geçirmek olurdu.
        """
        if other is None:
            return False
        return self.digest == other.digest and self.endpoint == other.endpoint

    def to_dict(self) -> Dict[str, Any]:
        return {
            "endpoint": self.endpoint,
            "kind": self.kind.value,
            "digest": self.digest,
            "tag_count": self.tag_count,
        }


def fingerprint_of(
    endpoint: str, kind: ConnectionKind, addresses: Iterable[str]
) -> DeviceFingerprint:
    """Uç ve adres kümesinden parmak izi üretir.

    Adresler sıralanır: aynı cihazın düğümleri farklı sırada döndüğünde
    parmak izi değişmemelidir, yoksa her keşif "cihaz değişti" derdi.
    """
    ordered = sorted({str(item) for item in addresses})
    body = "|".join([endpoint, kind.value, *ordered])
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:32]
    return DeviceFingerprint(
        endpoint=endpoint, kind=kind, digest=digest, tag_count=len(ordered)
    )


@dataclass(frozen=True)
class CredentialTest:
    """Kimlik bilgisi denemesinin sonucu.

    Kullanıcı adı saklanır, parola **saklanmaz**: sonucun içinde parola
    taşınsaydı, API yanıtına ve tarayıcı geçmişine sızardı.
    """

    ok: bool
    detail: str
    #: Denenen kullanıcı adı; anonim denendiyse `None`.
    username: Optional[str] = None
    #: Kimlik doğrulama gerekiyor muydu?
    requires_auth: Optional[bool] = None
    latency_ms: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "detail": self.detail,
            "username": self.username,
            "requires_auth": self.requires_auth,
            "latency_ms": self.latency_ms,
        }
