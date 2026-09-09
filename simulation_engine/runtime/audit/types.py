"""Denetim günlüğünün modeli.

Neden denetim günlüğü
---------------------
Bir fabrikada "bu alarmı kim kapattı?", "bu bağlantıyı kim durdurdu?", "bu
kişiye yöneticiliği kim verdi?" soruları er ya da geç sorulur. Yanıtı olmayan
bir sistem, bir vardiya tartışmasında hiçbir işe yaramaz. Uygulama günlüğü
(log) bu iş için yetmez: dönüşümlüdür, silinir ve yapılandırılmamıştır.

Değiştirilemezlik
-----------------
Kayıtlar yalnızca **eklenir**. Güncelleme ve silme işlevi yoktur; olmaması
bilinçlidir, çünkü sonradan düzeltilebilen bir denetim günlüğü kanıt değeri
taşımaz. Yanlış bir kayıt düzeltilmez, üstüne düzeltme kaydı yazılır.

Her kaydın beş sorusu
---------------------
*Ne zaman* (`at_ms`), *kim* (`actor`), *hangi kiracı* (`org_id`), *neye*
(`resource`), *ne yaptı* (`action`). Beşinden biri eksikse kayıt bir işe
yaramaz; bu yüzden hepsi zorunludur ve bilinmeyen aktör "sistem" olarak
yazılır — boş bırakılmaz.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional

#: Aktörü bilinmeyen işlemlerin sahibi.
#:
#: Boş bırakmak yerine açıkça "sistem" yazılır: boş bir alan, kaydın eksik mi
#: yoksa gerçekten otomatik mi olduğunu ayırt ettirmezdi.
SYSTEM_ACTOR = "sistem"


class AuditAction(str, Enum):
    """Kaydedilen kritik işlemler.

    Liste kapalıdır: serbest metin kabul edilseydi, yazım hatası olan bir
    eylem adı sessizce yeni bir tür yaratır ve hiçbir sorguda görünmezdi.
    """

    CONNECTOR_CONNECT = "connector_connect"
    CONNECTOR_DISCONNECT = "connector_disconnect"
    STREAM_START = "stream_start"
    STREAM_STOP = "stream_stop"
    ALARM_ACKNOWLEDGE = "alarm_acknowledge"
    ROLE_CHANGE = "role_change"
    INVITATION = "invitation"
    RUNTIME_RECOVERY = "runtime_recovery"
    BACKUP_CREATED = "backup_created"
    BACKUP_RESTORED = "backup_restored"


ACTION_LABEL: Dict[AuditAction, str] = {
    AuditAction.CONNECTOR_CONNECT: "Bağlantı kuruldu",
    AuditAction.CONNECTOR_DISCONNECT: "Bağlantı kapatıldı",
    AuditAction.STREAM_START: "Akış başlatıldı",
    AuditAction.STREAM_STOP: "Akış durduruldu",
    AuditAction.ALARM_ACKNOWLEDGE: "Alarm görüldü işaretlendi",
    AuditAction.ROLE_CHANGE: "Rol değiştirildi",
    AuditAction.INVITATION: "Davet gönderildi",
    AuditAction.RUNTIME_RECOVERY: "Runtime kurtarıldı",
    AuditAction.BACKUP_CREATED: "Yedek alındı",
    AuditAction.BACKUP_RESTORED: "Yedekten geri yüklendi",
}


class AuditOutcome(str, Enum):
    """İşlem başarılı mıydı?

    Başarısız denemeler de kaydedilir: "kim bu bağlantıyı kurmayı denedi ve
    başaramadı?" sorusu, başarılı denemeler kadar önemlidir.
    """

    SUCCESS = "success"
    FAILURE = "failure"


OUTCOME_LABEL: Dict[AuditOutcome, str] = {
    AuditOutcome.SUCCESS: "Başarılı",
    AuditOutcome.FAILURE: "Başarısız",
}

#: Ayrıntı sözlüğünde **asla** saklanmayacak alan adları.
#:
#: Bir denetim kaydı çoğu zaman destek ekibiyle paylaşılır; parola ya da
#: token içeren bir kayıt, sızıntının en kolay yoludur.
REDACTED_KEYS = frozenset(
    {
        "password",
        "parola",
        "token",
        "access_token",
        "refresh_token",
        "secret",
        "api_key",
        "authorization",
        "jwt",
    }
)

#: Gizlenen alanların yerine yazılan değer.
REDACTED_VALUE = "***"


def redact(details: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Hassas alanları gizler.

    Anahtar adı büyük/küçük harf ve alt çizgiden bağımsız karşılaştırılır:
    `API_KEY`, `api-key` ve `apiKey` aynı alandır ve üçü de gizlenmelidir.
    """
    if not details:
        return {}

    cleaned: Dict[str, Any] = {}
    for key, value in details.items():
        normal = str(key).strip().lower().replace("-", "_")
        if normal in REDACTED_KEYS:
            cleaned[key] = REDACTED_VALUE
        elif isinstance(value, dict):
            cleaned[key] = redact(value)
        else:
            cleaned[key] = value
    return cleaned


@dataclass(frozen=True)
class AuditEntry:
    """Tek bir denetim kaydı.

    `frozen=True`: kayıt oluşturulduktan sonra değiştirilemez. Değiştirilebilir
    olsaydı, bellekte tutulan bir kaydın alanları sonradan düzeltilebilir ve
    günlüğün kanıt değeri kaybolurdu.
    """

    org_id: str
    action: AuditAction
    resource: str
    actor: str = SYSTEM_ACTOR
    outcome: AuditOutcome = AuditOutcome.SUCCESS
    at_ms: int = 0
    details: Dict[str, Any] = field(default_factory=dict)
    #: Organizasyon içinde artan sıra numarası.
    sequence: int = 0

    @property
    def label(self) -> str:
        return ACTION_LABEL[self.action]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sequence": self.sequence,
            "org_id": self.org_id,
            "action": self.action.value,
            "action_label": self.label,
            "resource": self.resource,
            "actor": self.actor,
            "outcome": self.outcome.value,
            "outcome_label": OUTCOME_LABEL[self.outcome],
            "at_ms": self.at_ms,
            "details": dict(self.details),
        }


def make_entry(
    org_id: str,
    action: AuditAction,
    resource: str,
    at_ms: int,
    actor: Optional[str] = None,
    outcome: AuditOutcome = AuditOutcome.SUCCESS,
    details: Optional[Dict[str, Any]] = None,
    sequence: int = 0,
) -> AuditEntry:
    """Kayıt oluşturur; hassas alanlar burada gizlenir.

    Gizleme kaydın **yaratıldığı** yerde yapılır, yazıldığı yerde değil:
    araya giren herhangi bir katman kaydı görecek olsa bile parolayı görmez.
    """
    return AuditEntry(
        org_id=org_id,
        action=action,
        resource=resource or "bilinmiyor",
        actor=(actor or SYSTEM_ACTOR).strip() or SYSTEM_ACTOR,
        outcome=outcome,
        at_ms=max(0, int(at_ms)),
        details=redact(details),
        sequence=sequence,
    )
