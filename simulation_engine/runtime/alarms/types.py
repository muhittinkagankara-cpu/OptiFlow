"""Birleşik alarm modeli.

Şu ana kadar iki ayrı alarm anlayışı vardı: canlı ekranın olay tabanlı alarm
merkezi ve runtime'ın makine durumundan çıkardığı uyarılar. İkisi birbirini
görmüyordu; aynı duruş iki kez, farklı sözcüklerle görünebiliyordu.

Bu modül tek bir alarm tanımı verir. Kimlik (`alarm_id`) **kural + makine**
birleşiminden türetilir; aynı nedenin ikinci kez alarm üretmesi bu yüzden
imkânsızdır.

Yaşam döngüsü
-------------
    OPEN ──(operatör gördü)──▶ ACKNOWLEDGED ──(neden ortadan kalktı)──▶ RESOLVED
      │ ▲                                                                  │
      │ └──────────────────(neden yeniden ortaya çıktı)────────────────────┘
      │
      ├──(kimse görmedi, süre doldu)──▶ ESCALATED
      └──(bakım / bilinçli susturma)──▶ SILENCED ──(süre doldu)──▶ OPEN

`ACKNOWLEDGED` bir alarm, neden sürdüğü için yeniden `OPEN` **olmaz**: operatör
zaten gördü ve müdahale ediyor. Yeniden açılması, listeyi hiç azalmayan bir
gürültüye çevirirdi.

`SILENCED` ile `RESOLVED` arasındaki fark
----------------------------------------
Susturulmuş bir alarm **hâlâ etkindir**: nedeni sürüyor, yalnızca bildirimi
kesilmiş. Bakımdaki bir makinenin duruş alarmı kapatılsaydı, bakım bittiğinde
gerçek bir arıza da kapanmış görünürdü. Susturma her zaman bir süre ve bir kişi
taşır; süresiz susturma, unutulan bir alarm demektir.

`ESCALATED` neden ayrı bir durum
--------------------------------
Kimsenin görmediği kritik bir alarm, listede `OPEN` olarak durduğu sürece
"birileri bakıyordur" sanılır. Yükseltme, alarmın kaç dakikadır sahipsiz
olduğunu ve kaçıncı bildirim zincirine ulaştığını görünür kılar.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional


class AlarmState(str, Enum):
    """Alarmın yaşam döngüsündeki yeri."""

    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    #: Bildirimi kesilmiş ama nedeni süren alarm (bakım, bilinçli susturma).
    SILENCED = "SILENCED"
    #: Süresi içinde kimse ilgilenmediği için üst kademeye taşınmış alarm.
    ESCALATED = "ESCALATED"
    RESOLVED = "RESOLVED"


ALARM_STATE_LABEL: Dict[AlarmState, str] = {
    AlarmState.OPEN: "Açık",
    AlarmState.ACKNOWLEDGED: "Görüldü",
    AlarmState.SILENCED: "Susturuldu",
    AlarmState.ESCALATED: "Yükseltildi",
    AlarmState.RESOLVED: "Kapandı",
}


class AlarmSeverity(str, Enum):
    """Alarmın aciliyeti.

    Renk değil, **eylem** anlatır: `CRITICAL` hattı durdurur, `WARNING` yakında
    duracağını söyler, `INFO` yalnızca kaydedilir.
    """

    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


ALARM_SEVERITY_LABEL: Dict[AlarmSeverity, str] = {
    AlarmSeverity.CRITICAL: "Kritik",
    AlarmSeverity.WARNING: "Uyarı",
    AlarmSeverity.INFO: "Bilgi",
}


class AlarmRuleId(str, Enum):
    """Alarm üreten kurallar."""

    QUEUE_HIGH = "queue_high"
    MACHINE_DOWN = "machine_down"
    MACHINE_BLOCKED = "machine_blocked"
    NO_DATA = "no_data"
    RUNTIME_DISCONNECTED = "runtime_disconnected"


ALARM_RULE_LABEL: Dict[AlarmRuleId, str] = {
    AlarmRuleId.QUEUE_HIGH: "Kuyruk yüksek",
    AlarmRuleId.MACHINE_DOWN: "Makine duruşta",
    AlarmRuleId.MACHINE_BLOCKED: "Makine bloke",
    AlarmRuleId.NO_DATA: "Veri gelmiyor",
    AlarmRuleId.RUNTIME_DISCONNECTED: "Bağlantı koptu",
}


def alarm_id(rule: AlarmRuleId, subject: str) -> str:
    """Alarmın değişmez kimliği.

    Kural ve konu (makine ya da bağlantı) birleşiminden türetilir. Rastgele bir
    kimlik verilseydi, aynı duruş her değerlendirmede yeni bir alarm olur ve
    liste dakikada onlarca kopyayla dolardı.
    """
    return f"{rule.value}::{subject}"


@dataclass
class Alarm:
    """Tek bir alarm kaydı."""

    id: str
    rule: AlarmRuleId
    #: Alarmın ilgili olduğu makine ya da bağlantı.
    subject: str
    severity: AlarmSeverity
    message: str
    state: AlarmState = AlarmState.OPEN
    raised_at_ms: int = 0
    updated_at_ms: int = 0
    #: `ACKNOWLEDGED` yapan kişi; yapılmadıysa `None`.
    acknowledged_by: Optional[str] = None
    acknowledged_at_ms: Optional[int] = None
    resolved_at_ms: Optional[int] = None
    #: Susturan kişi; susturulmadıysa `None`.
    silenced_by: Optional[str] = None
    #: Susturmanın bitiş anı; süresiz susturma yoktur.
    silenced_until_ms: Optional[int] = None
    #: Susturma nedeni (bakım, planlı duruş...).
    silence_reason: Optional[str] = None
    #: Yükseltme anı; yükseltilmediyse `None`.
    escalated_at_ms: Optional[int] = None
    #: Bildirim zincirinde kaçıncı kademe? Hiç yükseltilmediyse 0.
    escalation_level: int = 0
    #: Kaç kez yinelenen bildirim gönderildi?
    repeat_count: int = 0
    #: Son bildirimin anı; hiç bildirilmediyse `None`.
    last_notified_ms: Optional[int] = None
    #: Alarmı tetikleyen ölçüm (kuyruk uzunluğu, geçen süre...).
    context: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_active(self) -> bool:
        """Alarm hâlâ ilgi bekliyor mu?

        Susturulmuş bir alarm da etkindir: nedeni sürüyor, yalnızca bildirimi
        kesilmiş. Etkin sayılmasaydı, bakım sırasında ortaya çıkan gerçek bir
        arıza listeden düşerdi.
        """
        return self.state is not AlarmState.RESOLVED

    @property
    def is_silenced(self) -> bool:
        return self.state is AlarmState.SILENCED

    @property
    def needs_attention(self) -> bool:
        """Bildirim üretilmeli mi?

        Görülmüş ve susturulmuş alarmlar bildirim üretmez: biri zaten
        müdahale ediyor, ötekini bilinçli olarak susturuldu.
        """
        return self.state in (AlarmState.OPEN, AlarmState.ESCALATED)

    def silence_expired(self, now_ms: int) -> bool:
        """Susturma süresi doldu mu?

        Bitiş anı olmayan bir susturma **süresi dolmuş** sayılır: süresiz
        susturma, unutulan bir alarm demektir.
        """
        if self.state is not AlarmState.SILENCED:
            return False
        if self.silenced_until_ms is None:
            return True
        return now_ms >= self.silenced_until_ms

    def unattended_ms(self, now_ms: int) -> Optional[int]:
        """Alarmın ne kadardır sahipsiz olduğu; ilgilenildiyse `None`.

        Görülmüş, susturulmuş ya da kapanmış bir alarmın sahipsizlik süresi
        yoktur. Sıfır dönseydi, ilgilenilmiş bir alarm "az önce açıldı" gibi
        görünürdü.
        """
        if self.state not in (AlarmState.OPEN, AlarmState.ESCALATED):
            return None
        if self.raised_at_ms <= 0:
            return None
        return max(0, now_ms - self.raised_at_ms)

    def duration_ms(self, now_ms: int) -> Optional[int]:
        """Alarmın ne kadardır sürdüğü; başlangıcı bilinmiyorsa `None`."""
        if self.raised_at_ms <= 0:
            return None
        end = self.resolved_at_ms if self.state is AlarmState.RESOLVED else now_ms
        return max(0, end - self.raised_at_ms)

    def to_dict(self, now_ms: Optional[int] = None) -> Dict[str, Any]:
        return {
            "id": self.id,
            "rule": self.rule.value,
            "rule_label": ALARM_RULE_LABEL[self.rule],
            "subject": self.subject,
            "severity": self.severity.value,
            "severity_label": ALARM_SEVERITY_LABEL[self.severity],
            "message": self.message,
            "state": self.state.value,
            "state_label": ALARM_STATE_LABEL[self.state],
            "raised_at_ms": self.raised_at_ms,
            "updated_at_ms": self.updated_at_ms,
            "acknowledged_by": self.acknowledged_by,
            "acknowledged_at_ms": self.acknowledged_at_ms,
            "resolved_at_ms": self.resolved_at_ms,
            "silenced_by": self.silenced_by,
            "silenced_until_ms": self.silenced_until_ms,
            "silence_reason": self.silence_reason,
            "escalated_at_ms": self.escalated_at_ms,
            "escalation_level": self.escalation_level,
            "repeat_count": self.repeat_count,
            "last_notified_ms": self.last_notified_ms,
            "duration_ms": None if now_ms is None else self.duration_ms(now_ms),
            "unattended_ms": None if now_ms is None else self.unattended_ms(now_ms),
            "context": dict(self.context),
        }


@dataclass(frozen=True)
class AlarmCandidate:
    """Bir kuralın ürettiği "şu an bu sorun var" bildirimi.

    Alarmın kendisi değildir: depo bunu mevcut alarmlarla karşılaştırıp yeni mi
    açacağına, güncelleyeceğine yoksa kapatacağına karar verir.
    """

    rule: AlarmRuleId
    subject: str
    severity: AlarmSeverity
    message: str
    context: Dict[str, Any] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return alarm_id(self.rule, self.subject)
