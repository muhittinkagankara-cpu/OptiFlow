"""Alarm yükseltme: sahipsiz alarmın kendini duyurması.

Sorun
-----
Bir alarm listede `OPEN` durduğu sürece "birileri bakıyordur" sanılır. Gece
vardiyasında açılan kritik bir alarm, kimse ekrana bakmadığı için sabaha kadar
açık kalabilir ve raporda yalnızca "alarm vardı" diye görünür. Kaç dakika
sahipsiz kaldığı hiçbir yerde yazmaz.

Dört mekanizma
--------------
1. **Yineleme** — açık bir alarm belirli aralıklarla yeniden bildirilir. Tek
   bir bildirim kaçırılabilir; yineleme onu kaçırılamaz kılar.
2. **Yükseltme** — süresi içinde ilgilenilmeyen alarm bir üst kademeye taşınır
   (operatör → vardiya amiri → üretim müdürü).
3. **Susturma** — bakımdaki bir makine için bildirim bilinçli olarak kesilir.
   Alarm kapatılmaz; bakım bittiğinde kendiliğinden geri döner.
4. **Vardiya bildirimi** — vardiya değişiminde devredilen açık alarmlar
   listelenir. Devredilmeyen bir alarm, yeni vardiyanın hiç bilmediği bir
   arızadır.

Neden kademeler süreye bağlı
----------------------------
Kritik bir alarm iki dakikada, uyarı on beş dakikada yükselir. Hepsi aynı
sürede yükselseydi, kritik bir duruş bir kuyruk uyarısıyla aynı aciliyette
görünürdü.

Bu modül bildirim **göndermez**
-------------------------------
Ürettiği şey `EscalationAction` listesidir: "şu alarm şu kademeye taşınsın",
"şu alarm yeniden bildirilsin". Gerçek bir e-posta ya da SMS gönderimi
kurulmadığı için, gönderildiğini iddia eden hiçbir şey yazılmaz — eylemler
olay günlüğüne düşer ve arayüzde görünür.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Iterable, List, Optional

from simulation_engine.runtime.alarms.types import (
    Alarm,
    AlarmSeverity,
    AlarmState,
)

#: Aciliyete göre yükseltme süresi (ms).
#:
#: Kritik iki dakika: bir hattın durduğu iki dakika, vardiya amirinin haberi
#: olması gereken süredir. Uyarı on beş dakika: kuyruk yükselmesi genelde
#: kendiliğinden düzelir, daha kısa bir süre gereksiz gürültü olurdu.
ESCALATE_AFTER_MS: Dict[AlarmSeverity, Optional[int]] = {
    AlarmSeverity.CRITICAL: 120_000,
    AlarmSeverity.WARNING: 900_000,
    #: Bilgi alarmları yükselmez; yükselseydi zincir anlamsız gürültüyle dolardı.
    AlarmSeverity.INFO: None,
}

#: Yinelenen bildirimin aralığı (ms).
REPEAT_INTERVAL_MS: Dict[AlarmSeverity, Optional[int]] = {
    AlarmSeverity.CRITICAL: 300_000,
    AlarmSeverity.WARNING: 1_800_000,
    AlarmSeverity.INFO: None,
}

#: Bir alarmın çıkabileceği en yüksek kademe.
MAX_ESCALATION_LEVEL = 3

#: Kritik alarm bildirim zinciri: kademe → sorumlu.
#:
#: Zincir bir listedir çünkü sıra önemlidir: önce yerinde olan kişi,
#: sonra sorumlusu, en son kararı verebilecek kişi uyarılır.
ESCALATION_CHAIN: Dict[int, str] = {
    1: "Operatör",
    2: "Vardiya amiri",
    3: "Üretim müdürü",
}

#: Susturmanın kabul edilen en uzun süresi (ms).
#:
#: Sekiz saat bir vardiyadır. Daha uzun bir susturma, bir sonraki vardiyanın
#: hiç bilmediği sessiz bir alarm bırakırdı.
MAX_SILENCE_MS = 8 * 3_600_000

#: Susturmanın varsayılan süresi (ms).
DEFAULT_SILENCE_MS = 3_600_000


class EscalationKind(str, Enum):
    """Yükseltme motorunun ürettiği eylem türleri."""

    #: Alarm bir üst kademeye taşındı.
    ESCALATE = "escalate"
    #: Açık alarm yeniden bildirildi.
    REPEAT = "repeat"
    #: Susturma süresi doldu, alarm geri döndü.
    UNSILENCE = "unsilence"
    #: Vardiya değişiminde devredilen alarm.
    SHIFT_HANDOVER = "shift_handover"


ESCALATION_KIND_LABEL: Dict[EscalationKind, str] = {
    EscalationKind.ESCALATE: "Yükseltildi",
    EscalationKind.REPEAT: "Yeniden bildirildi",
    EscalationKind.UNSILENCE: "Susturma bitti",
    EscalationKind.SHIFT_HANDOVER: "Vardiyaya devredildi",
}


@dataclass(frozen=True)
class EscalationAction:
    """Motorun önerdiği tek bir eylem.

    Bildirim **gönderilmez**; eylem kaydedilir ve arayüzde görünür. Gerçek bir
    e-posta ya da SMS servisi bağlanmadığı sürece "bildirim gönderildi" demek
    doğrulanamayan bir iddia olurdu.
    """

    kind: EscalationKind
    alarm_id: str
    at_ms: int
    message: str
    #: Zincirdeki kademe; yineleme ve susturma için mevcut kademe.
    level: int = 0
    #: Kademenin sorumlusu; kademe yoksa `None`.
    target: Optional[str] = None
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind.value,
            "kind_label": ESCALATION_KIND_LABEL[self.kind],
            "alarm_id": self.alarm_id,
            "at_ms": self.at_ms,
            "message": self.message,
            "level": self.level,
            "target": self.target,
            "data": dict(self.data),
        }


@dataclass
class EscalationPolicy:
    """Yükseltme ve yineleme süreleri."""

    escalate_after_ms: Dict[AlarmSeverity, Optional[int]] = field(
        default_factory=lambda: dict(ESCALATE_AFTER_MS)
    )
    repeat_interval_ms: Dict[AlarmSeverity, Optional[int]] = field(
        default_factory=lambda: dict(REPEAT_INTERVAL_MS)
    )
    max_level: int = MAX_ESCALATION_LEVEL

    def escalation_delay(self, severity: AlarmSeverity) -> Optional[int]:
        """Bu aciliyet için yükseltme süresi; yükselmiyorsa `None`."""
        return self.escalate_after_ms.get(severity)

    def repeat_delay(self, severity: AlarmSeverity) -> Optional[int]:
        return self.repeat_interval_ms.get(severity)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "escalate_after_ms": {
                key.value: value for key, value in self.escalate_after_ms.items()
            },
            "repeat_interval_ms": {
                key.value: value for key, value in self.repeat_interval_ms.items()
            },
            "max_level": self.max_level,
        }


def chain_target(level: int) -> Optional[str]:
    """Kademenin sorumlusu; kademe tanımlı değilse `None`.

    Tanımsız bir kademede "Operatör" varsayılanına düşmek, üçüncü kademeye
    ulaşmış bir alarmı birinci kademedeymiş gibi göstermek olurdu.
    """
    return ESCALATION_CHAIN.get(level)


def clamp_silence_ms(duration_ms: Optional[int]) -> int:
    """Susturma süresini kabul edilen aralığa çeker.

    Sıfır ya da negatif bir süre varsayılana düşer; sonsuz susturma yoktur.
    """
    if duration_ms is None:
        return DEFAULT_SILENCE_MS
    try:
        value = int(duration_ms)
    except (TypeError, ValueError):
        return DEFAULT_SILENCE_MS
    if value <= 0:
        return DEFAULT_SILENCE_MS
    return min(MAX_SILENCE_MS, value)


@dataclass
class MaintenanceWindow:
    """Bir makinenin bakım penceresi.

    Bakımdaki bir makine duruş alarmı üretir; bu alarm doğrudur ama bilinen bir
    nedendir. Alarmın **kapatılması** yanlış olurdu: bakım bittiğinde gerçek
    bir arıza da kapanmış görünürdü. Bu yüzden susturulur.
    """

    subject: str
    start_ms: int
    end_ms: int
    reason: str = "Planlı bakım"
    opened_by: str = "sistem"

    def covers(self, now_ms: int) -> bool:
        """Bu an pencerenin içinde mi? Başlangıç dahil, bitiş hariçtir."""
        return self.start_ms <= now_ms < self.end_ms

    def remaining_ms(self, now_ms: int) -> Optional[int]:
        """Kalan süre; pencere dışındaysa `None`."""
        if not self.covers(now_ms):
            return None
        return self.end_ms - now_ms

    def to_dict(self, now_ms: Optional[int] = None) -> Dict[str, Any]:
        return {
            "subject": self.subject,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "reason": self.reason,
            "opened_by": self.opened_by,
            "active": None if now_ms is None else self.covers(now_ms),
            "remaining_ms": None if now_ms is None else self.remaining_ms(now_ms),
        }


class MaintenanceRegistry:
    """Açık bakım pencereleri."""

    def __init__(self) -> None:
        self._windows: Dict[str, MaintenanceWindow] = {}

    def open(self, window: MaintenanceWindow) -> MaintenanceWindow:
        """Pencereyi kaydeder; aynı makinenin önceki penceresi değiştirilir."""
        self._windows[window.subject] = window
        return window

    def close(self, subject: str) -> bool:
        return self._windows.pop(subject, None) is not None

    def active(self, subject: str, now_ms: int) -> Optional[MaintenanceWindow]:
        """Bu makine şu an bakımda mı?"""
        window = self._windows.get(subject)
        if window is None or not window.covers(now_ms):
            return None
        return window

    def windows(self, now_ms: Optional[int] = None) -> List[Dict[str, Any]]:
        return [window.to_dict(now_ms) for window in self._windows.values()]

    def clear(self) -> None:
        self._windows.clear()


class EscalationEngine:
    """Alarmların yükseltilmesine ve yinelenmesine karar verir.

    Saati okumaz ve depoyu değiştirmez: `evaluate` yalnızca eylem listesi
    döndürür, uygulama kararını çağıran verir. Motor doğrudan yazsaydı, bir
    yükseltmenin neden olduğu testte ancak depo içeriğine bakarak
    anlaşılabilirdi.
    """

    def __init__(self, policy: Optional[EscalationPolicy] = None) -> None:
        self._policy = policy or EscalationPolicy()

    @property
    def policy(self) -> EscalationPolicy:
        return self._policy

    def evaluate(self, alarms: Iterable[Alarm], now_ms: int) -> List[EscalationAction]:
        """Etkin alarmları gözden geçirir ve gereken eylemleri üretir."""
        actions: List[EscalationAction] = []
        for alarm in alarms:
            if alarm.state is AlarmState.RESOLVED:
                continue
            if alarm.state is AlarmState.SILENCED:
                if alarm.silence_expired(now_ms):
                    actions.append(_unsilence_action(alarm, now_ms))
                continue
            if not alarm.needs_attention:
                continue
            escalation = self._escalation_for(alarm, now_ms)
            if escalation is not None:
                actions.append(escalation)
                continue
            repeat = self._repeat_for(alarm, now_ms)
            if repeat is not None:
                actions.append(repeat)
        return actions

    def _escalation_for(self, alarm: Alarm, now_ms: int) -> Optional[EscalationAction]:
        delay = self._policy.escalation_delay(alarm.severity)
        if delay is None:
            return None
        if alarm.escalation_level >= self._policy.max_level:
            return None
        unattended = alarm.unattended_ms(now_ms)
        if unattended is None:
            return None
        # Her kademe bir öncekinin süresi kadar daha bekler: birinci kademe
        # iki dakikada, ikincisi dört dakikada, üçüncüsü altı dakikada.
        needed = delay * (alarm.escalation_level + 1)
        if unattended < needed:
            return None
        level = alarm.escalation_level + 1
        return EscalationAction(
            kind=EscalationKind.ESCALATE,
            alarm_id=alarm.id,
            at_ms=now_ms,
            message=_escalate_message(alarm, level, unattended),
            level=level,
            target=chain_target(level),
            data={"unattended_ms": unattended, "severity": alarm.severity.value},
        )

    def _repeat_for(self, alarm: Alarm, now_ms: int) -> Optional[EscalationAction]:
        interval = self._policy.repeat_delay(alarm.severity)
        if interval is None:
            return None
        last = alarm.last_notified_ms
        if last is None:
            # Hiç bildirilmemiş bir alarm için yineleme değil, ilk bildirim
            # gerekir; onu alarmın açılması zaten üretti.
            return None
        if now_ms - last < interval:
            return None
        return EscalationAction(
            kind=EscalationKind.REPEAT,
            alarm_id=alarm.id,
            at_ms=now_ms,
            message=_repeat_message(alarm, alarm.repeat_count + 1),
            level=alarm.escalation_level,
            target=chain_target(max(1, alarm.escalation_level)),
            data={"repeat_count": alarm.repeat_count + 1},
        )

    def handover(
        self, alarms: Iterable[Alarm], now_ms: int, shift_label: str
    ) -> List[EscalationAction]:
        """Vardiya değişiminde devredilen alarmları listeler.

        Görülmüş alarmlar da devredilir: müdahale eden kişi vardiyayı
        bitiriyorsa, işi devralanın da bilmesi gerekir. Yalnızca kapanmış
        alarmlar dışarıda kalır.
        """
        actions: List[EscalationAction] = []
        for alarm in alarms:
            if alarm.state is AlarmState.RESOLVED:
                continue
            actions.append(
                EscalationAction(
                    kind=EscalationKind.SHIFT_HANDOVER,
                    alarm_id=alarm.id,
                    at_ms=now_ms,
                    message=_handover_message(alarm, shift_label),
                    level=alarm.escalation_level,
                    target=shift_label,
                    data={
                        "state": alarm.state.value,
                        "duration_ms": alarm.duration_ms(now_ms),
                    },
                )
            )
        return actions


def _unsilence_action(alarm: Alarm, now_ms: int) -> EscalationAction:
    return EscalationAction(
        kind=EscalationKind.UNSILENCE,
        alarm_id=alarm.id,
        at_ms=now_ms,
        message=f"{alarm.subject}: susturma bitti, alarm yeniden etkin",
        level=alarm.escalation_level,
        target=chain_target(max(1, alarm.escalation_level)),
        data={"silence_reason": alarm.silence_reason},
    )


def _minutes(duration_ms: Optional[int]) -> str:
    if duration_ms is None:
        return "süre bilinmiyor"
    minutes = duration_ms // 60_000
    if minutes < 1:
        return f"{duration_ms // 1000} sn"
    return f"{minutes} dk"


def _escalate_message(alarm: Alarm, level: int, unattended_ms: Optional[int]) -> str:
    target = chain_target(level) or "üst kademe"
    return (
        f"{alarm.subject}: {_minutes(unattended_ms)} süredir sahipsiz, "
        f"{target} kademesine yükseltildi"
    )


def _repeat_message(alarm: Alarm, repeat_count: int) -> str:
    return f"{alarm.subject}: alarm sürüyor ({repeat_count}. yineleme)"


def _handover_message(alarm: Alarm, shift_label: str) -> str:
    return f"{alarm.subject}: {shift_label} vardiyasına devredildi"
