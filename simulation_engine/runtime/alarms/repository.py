"""Birleşik alarm deposu.

Tek alarm kaynağı budur: Live Factory, Alarm Merkezi ve Runtime panosu aynı
depodan okur. Üç ekranın kendi listesini tutması, aynı duruşun üç farklı
sayıyla görünmesi demekti.

Durum geçişlerinin tamamı burada, tek yerde uygulanır:

* Aynı kimlikli alarm **yeniden yaratılmaz**; var olan güncellenir.
* `ACKNOWLEDGED` bir alarm, neden sürerken yeniden `OPEN` **olmaz**.
* Nedeni ortadan kalkan alarm silinmez, `RESOLVED` olur ve geçmişe geçer.
* Kapanmış bir alarmın nedeni yeniden ortaya çıkarsa **yeni bir alarm** açılır
  (aynı kimlikle, yeni bir başlangıç anıyla): iki ayrı duruşun tek bir kayıtta
  toplanması, duruş sayısını olduğundan az gösterirdi.
* Susturulmuş bir alarm etkin kalır ve nedeni sürerken güncellenir; susturma
  süresi dolduğunda kendiliğinden `OPEN` durumuna döner. Susturma bir alarmı
  kapatmaz — bakım bittiğinde gerçek bir arıza da kapanmış görünürdü.
* Yükseltilmiş bir alarm da görülebilir: yükseltme, ilgilenilmesini
  engellemez, tersine ilgilenilmesini ister.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional

from simulation_engine.runtime.alarms.escalation import (
    EscalationAction,
    EscalationKind,
    MaintenanceRegistry,
    chain_target,
    clamp_silence_ms,
)
from simulation_engine.runtime.alarms.types import (
    Alarm,
    AlarmCandidate,
    AlarmRuleId,
    AlarmState,
)

#: Geçmişte tutulan en fazla kapanmış alarm.
#:
#: Sınırsız bırakılsaydı, aylarca çalışan bir hatta liste okunamaz hâle
#: gelirdi; iki yüz kayıt birkaç vardiyalık geçmişi kapsar.
MAX_HISTORY = 200


class AlarmStore:
    """Etkin alarmlar ve kapanmış alarm geçmişi."""

    def __init__(self, max_history: int = MAX_HISTORY) -> None:
        self._active: Dict[str, Alarm] = {}
        self._history: List[Alarm] = []
        self._max_history = max(1, max_history)
        #: Kaç kez yeni alarm açıldı? Panoda gösterilir.
        self.raised_count = 0
        #: Kaç alarm kapandı?
        self.resolved_count = 0

    # -- Okuma --------------------------------------------------------------

    @property
    def active(self) -> List[Alarm]:
        """Etkin alarmlar; en yeni önce."""
        return sorted(self._active.values(), key=lambda item: item.raised_at_ms, reverse=True)

    @property
    def history(self) -> List[Alarm]:
        """Kapanmış alarmlar; en yeni önce."""
        return list(reversed(self._history))

    def get(self, alarm_id: str) -> Optional[Alarm]:
        return self._active.get(alarm_id)

    def open_alarms(self) -> List[Alarm]:
        """Henüz görülmemiş alarmlar."""
        return [item for item in self.active if item.state is AlarmState.OPEN]

    def by_rule(self, rule: AlarmRuleId) -> List[Alarm]:
        return [item for item in self.active if item.rule is rule]

    def by_subject(self, subject: str) -> List[Alarm]:
        return [item for item in self.active if item.subject == subject]

    def counts(self) -> Dict[str, int]:
        """Panolarda gösterilen sayaçlar."""
        return {
            "active": len(self._active),
            "open": len(self.open_alarms()),
            "acknowledged": len(
                [item for item in self.active if item.state is AlarmState.ACKNOWLEDGED]
            ),
            "silenced": len(
                [item for item in self.active if item.state is AlarmState.SILENCED]
            ),
            "escalated": len(
                [item for item in self.active if item.state is AlarmState.ESCALATED]
            ),
            "critical": len(
                [item for item in self.active if item.severity.value == "critical"]
            ),
            "history": len(self._history),
            "raised_total": self.raised_count,
            "resolved_total": self.resolved_count,
        }

    # -- Yazma --------------------------------------------------------------

    def sync(self, candidates: Iterable[AlarmCandidate], now_ms: int) -> Dict[str, int]:
        """Kuralların ürettiği adayları mevcut alarmlarla eşitler.

        Dönen sözlük ne olduğunu söyler: kaç yeni alarm açıldı, kaçı
        güncellendi, kaçı kapandı.
        """
        incoming = {candidate.id: candidate for candidate in candidates}
        opened = 0
        updated = 0

        for alarm_id, candidate in incoming.items():
            existing = self._active.get(alarm_id)
            if existing is None:
                self._active[alarm_id] = Alarm(
                    id=alarm_id,
                    rule=candidate.rule,
                    subject=candidate.subject,
                    severity=candidate.severity,
                    message=candidate.message,
                    state=AlarmState.OPEN,
                    raised_at_ms=now_ms,
                    updated_at_ms=now_ms,
                    context=dict(candidate.context),
                    last_notified_ms=now_ms,
                )
                opened += 1
                self.raised_count += 1
                continue

            # Var olan alarm: mesaj ve ölçüm tazelenir, **durum korunur**.
            existing.message = candidate.message
            existing.context = dict(candidate.context)
            existing.updated_at_ms = now_ms
            updated += 1

        resolved = 0
        for alarm_id in list(self._active):
            if alarm_id in incoming:
                continue
            resolved += 1
            self._resolve(alarm_id, now_ms)

        return {"opened": opened, "updated": updated, "resolved": resolved}

    def acknowledge(self, alarm_id: str, by: str, now_ms: int) -> Optional[Alarm]:
        """Alarmı "görüldü" işaretler.

        `OPEN` ve `ESCALATED` alarmlar görülebilir: yükseltme ilgilenilmesini
        engellemez, tersine ilgilenilmesini ister. Kapanmış bir alarmı görmek
        anlamsız, zaten görülmüş birini yeniden görmek ise sayaçları bozardı;
        susturulmuş bir alarm ise önce geri alınmalıdır.
        """
        alarm = self._active.get(alarm_id)
        if alarm is None:
            return None
        if alarm.state not in (AlarmState.OPEN, AlarmState.ESCALATED):
            return None

        alarm.state = AlarmState.ACKNOWLEDGED
        alarm.acknowledged_by = by
        alarm.acknowledged_at_ms = now_ms
        alarm.updated_at_ms = now_ms
        return alarm

    # -- Susturma ve yükseltme ---------------------------------------------

    def silence(
        self,
        alarm_id: str,
        by: str,
        now_ms: int,
        duration_ms: Optional[int] = None,
        reason: str = "Elle susturuldu",
    ) -> Optional[Alarm]:
        """Alarmın bildirimini geçici olarak keser.

        Kapanmış bir alarm susturulamaz (susturulacak bir bildirimi yoktur) ve
        süresiz susturma kabul edilmez: bitişi olmayan bir susturma, unutulan
        bir alarm demektir.
        """
        alarm = self._active.get(alarm_id)
        if alarm is None:
            return None
        window = clamp_silence_ms(duration_ms)
        alarm.state = AlarmState.SILENCED
        alarm.silenced_by = by
        alarm.silenced_until_ms = now_ms + window
        alarm.silence_reason = reason
        alarm.updated_at_ms = now_ms
        return alarm

    def unsilence(self, alarm_id: str, now_ms: int) -> Optional[Alarm]:
        """Susturmayı kaldırır; alarm `OPEN` durumuna döner.

        `ACKNOWLEDGED` durumuna dönmez: susturma sırasında kimsenin
        ilgilendiğine dair bir kanıt yoktur.
        """
        alarm = self._active.get(alarm_id)
        if alarm is None or alarm.state is not AlarmState.SILENCED:
            return None
        alarm.state = AlarmState.OPEN
        alarm.silenced_by = None
        alarm.silenced_until_ms = None
        alarm.silence_reason = None
        alarm.updated_at_ms = now_ms
        return alarm

    def escalate(self, alarm_id: str, level: int, now_ms: int) -> Optional[Alarm]:
        """Alarmı bir üst kademeye taşır.

        Görülmüş bir alarm yükseltilmez: biri zaten müdahale ediyor.
        """
        alarm = self._active.get(alarm_id)
        if alarm is None:
            return None
        if alarm.state not in (AlarmState.OPEN, AlarmState.ESCALATED):
            return None
        alarm.state = AlarmState.ESCALATED
        alarm.escalation_level = max(alarm.escalation_level, int(level))
        alarm.escalated_at_ms = now_ms
        alarm.updated_at_ms = now_ms
        alarm.last_notified_ms = now_ms
        return alarm

    def note_notified(self, alarm_id: str, now_ms: int) -> Optional[Alarm]:
        """Bildirim üretildiğini kaydeder (bildirimi **göndermez**).

        Gerçek bir e-posta ya da SMS servisi bağlanmadığı için "gönderildi"
        denmez; yalnızca bildirimin ne zaman üretildiği saklanır.
        """
        alarm = self._active.get(alarm_id)
        if alarm is None:
            return None
        alarm.repeat_count += 1
        alarm.last_notified_ms = now_ms
        alarm.updated_at_ms = now_ms
        return alarm

    def apply_maintenance(
        self, registry: MaintenanceRegistry, now_ms: int
    ) -> List[Alarm]:
        """Bakımdaki makinelerin alarmlarını susturur.

        Kapatmak yerine susturulur: bakım bittiğinde gerçek bir arıza da
        kapanmış görünürdü. Zaten susturulmuş bir alarm yeniden susturulmaz,
        yoksa susturma süresi her turda yeniden başlar ve alarm hiç geri
        dönmezdi.
        """
        touched: List[Alarm] = []
        for alarm in list(self._active.values()):
            if alarm.state is AlarmState.SILENCED:
                continue
            window = registry.active(alarm.subject, now_ms)
            if window is None:
                continue
            remaining = window.remaining_ms(now_ms)
            self.silence(
                alarm.id,
                by=window.opened_by,
                now_ms=now_ms,
                duration_ms=remaining,
                reason=window.reason,
            )
            touched.append(alarm)
        return touched

    def apply_actions(
        self, actions: Iterable[EscalationAction], now_ms: int
    ) -> Dict[str, int]:
        """Yükseltme motorunun ürettiği eylemleri uygular.

        Motor karar verir, depo uygular: ayrım, bir yükseltmenin neden
        olduğunu depo içeriğine bakmadan görebilmek içindir.
        """
        applied = {"escalated": 0, "repeated": 0, "unsilenced": 0, "skipped": 0}
        for action in actions:
            if action.kind is EscalationKind.ESCALATE:
                result = self.escalate(action.alarm_id, action.level, now_ms)
                applied["escalated" if result else "skipped"] += 1
            elif action.kind is EscalationKind.REPEAT:
                result = self.note_notified(action.alarm_id, now_ms)
                applied["repeated" if result else "skipped"] += 1
            elif action.kind is EscalationKind.UNSILENCE:
                result = self.unsilence(action.alarm_id, now_ms)
                applied["unsilenced" if result else "skipped"] += 1
            else:
                # Vardiya devri bir durum değişikliği değildir; yalnızca
                # bildirilir.
                applied["skipped"] += 1
        return applied

    def resolve(self, alarm_id: str, now_ms: int) -> Optional[Alarm]:
        """Alarmı elle kapatır (neden hâlâ sürüyor olabilir)."""
        if alarm_id not in self._active:
            return None
        return self._resolve(alarm_id, now_ms)

    def _resolve(self, alarm_id: str, now_ms: int) -> Alarm:
        alarm = self._active.pop(alarm_id)
        alarm.state = AlarmState.RESOLVED
        alarm.resolved_at_ms = now_ms
        alarm.updated_at_ms = now_ms
        self._history.append(alarm)
        if len(self._history) > self._max_history:
            del self._history[0 : len(self._history) - self._max_history]
        self.resolved_count += 1
        return alarm

    def clear(self) -> None:
        self._active.clear()
        self._history.clear()
        self.raised_count = 0
        self.resolved_count = 0

    def to_dict(self, now_ms: int) -> Dict[str, object]:
        """Ekranların okuduğu tam görünüm."""
        return {
            "active": [alarm.to_dict(now_ms) for alarm in self.active],
            "history": [alarm.to_dict(now_ms) for alarm in self.history],
            "counts": self.counts(),
        }
