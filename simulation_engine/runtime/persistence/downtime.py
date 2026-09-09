"""Duruş takibi.

Bir makine `RUNNING` iken `DOWN` olduğunda bir duruş **başlar**; yeniden
`RUNNING` olduğunda **biter**. Aradaki süre duruştur ve kullanılabilirliğin
tek gerçek kaynağıdır.

Neden ayrı kayıt
----------------
Görüntü (snapshot) yalnızca **son** durumu tutar. Vardiya boyunca üç kez duran
bir makine, görüntüde yalnızca "şu an çalışıyor" görünür ve toplam duruş
kaybolur. Duruş aralıkları ayrı kaydedilmezse "bugün ne kadar durduk?"
sorusunun yanıtı yoktur.

Açık duruş nasıl sayılır
------------------------
Hâlâ süren bir duruşun bitişi yoktur; süresi **o ana kadar** hesaplanır ve
`is_open` ile işaretlenir. Kapanmamış bir duruşu yok saymak, devam eden bir
arızayı raporun dışında bırakırdı.

Neden `UNKNOWN` duruşu bitirmez
-------------------------------
Cihazdan haber alınamaması, makinenin çalışmaya başladığı anlamına gelmez.
Durumu bilinmeyen bir makinede duruş açık kalır ve "veri gelmiyor" alarmı
ayrıca üretilir.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

from simulation_engine.runtime.persistence.snapshots import DOWN, RUNNING

#: Duruşun nedeni bildirilmediğinde yazılan değer.
UNKNOWN_REASON = "Bildirilmedi"


@dataclass
class DowntimeEvent:
    """Tek bir duruş aralığı."""

    machine_id: str
    start_ms: int
    end_ms: Optional[int] = None
    reason: str = UNKNOWN_REASON
    #: Duruşu bildiren bağlantı.
    source: Optional[str] = None

    @property
    def is_open(self) -> bool:
        """Duruş hâlâ sürüyor mu?"""
        return self.end_ms is None

    def duration_ms(self, now_ms: Optional[int] = None) -> Optional[int]:
        """Duruş süresi; açık duruşta `now_ms` verilmezse `None`."""
        if self.end_ms is not None:
            return max(0, self.end_ms - self.start_ms)
        if now_ms is None:
            return None
        return max(0, now_ms - self.start_ms)

    def to_dict(self, now_ms: Optional[int] = None) -> Dict[str, object]:
        return {
            "machine_id": self.machine_id,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "duration_ms": self.duration_ms(now_ms),
            "reason": self.reason,
            "source": self.source,
            "open": self.is_open,
        }


@dataclass
class DowntimeTracker:
    """Makine durumlarından duruş aralıkları çıkarır."""

    #: Kapanmış duruşlar.
    events: List[DowntimeEvent] = field(default_factory=list)
    #: Makine başına açık duruş.
    open_events: Dict[str, DowntimeEvent] = field(default_factory=dict)
    #: Makine başına son bilinen durum.
    last_status: Dict[str, str] = field(default_factory=dict)

    def observe(
        self,
        machine_id: str,
        status: str,
        at_ms: int,
        reason: str = UNKNOWN_REASON,
        source: Optional[str] = None,
    ) -> Optional[DowntimeEvent]:
        """Yeni bir durum bildirimini işler.

        Duruş **başladıysa** ya da **bittiyse** ilgili kaydı döndürür; durum
        değişmediyse `None`. Aynı durumun tekrar bildirilmesi yeni kayıt
        üretmez — cihazlar durumu saniyede bir yayınlar ve her yayın için
        duruş açmak, duruş sayısını yüz katına çıkarırdı.
        """
        previous = self.last_status.get(machine_id)
        self.last_status[machine_id] = status

        if status == DOWN and machine_id not in self.open_events:
            event = DowntimeEvent(
                machine_id=machine_id, start_ms=at_ms, reason=reason, source=source
            )
            self.open_events[machine_id] = event
            return event

        if status == RUNNING and machine_id in self.open_events:
            event = self.open_events.pop(machine_id)
            event.end_ms = max(event.start_ms, at_ms)
            self.events.append(event)
            return event

        # `UNKNOWN` ve `BLOCKED`: açık duruş açık kalır (bkz. modül başlığı).
        _ = previous
        return None

    def total_ms(self, now_ms: Optional[int] = None) -> Optional[int]:
        """Toplam duruş; hiç duruş kaydı yoksa `None`.

        Sıfır dönmek, hiç izlenmemiş bir hattı "hiç durmadı" diye
        raporlamak olurdu — oysa "duruş ölçülmedi" ile "duruş olmadı" farklı
        şeylerdir.
        """
        durations = [
            event.duration_ms(now_ms)
            for event in [*self.events, *self.open_events.values()]
        ]
        measured = [value for value in durations if value is not None]
        return sum(measured) if measured else None

    def total_for(self, machine_id: str, now_ms: Optional[int] = None) -> Optional[int]:
        """Bir makinenin toplam duruşu."""
        durations = [
            event.duration_ms(now_ms)
            for event in [*self.events, *self.open_events.values()]
            if event.machine_id == machine_id
        ]
        measured = [value for value in durations if value is not None]
        return sum(measured) if measured else None

    def open_count(self) -> int:
        return len(self.open_events)

    def all_events(self) -> List[DowntimeEvent]:
        """Kapanmış ve açık bütün duruşlar, başlangıca göre sıralı."""
        return sorted(
            [*self.events, *self.open_events.values()],
            key=lambda event: event.start_ms,
        )

    def load(self, events: Iterable[DowntimeEvent]) -> int:
        """Diskten okunan duruşları belleğe alır (kurtarma)."""
        count = 0
        for event in events:
            if event.is_open:
                self.open_events[event.machine_id] = event
            else:
                self.events.append(event)
            count += 1
        return count

    def clear(self) -> None:
        self.events.clear()
        self.open_events.clear()
        self.last_status.clear()
