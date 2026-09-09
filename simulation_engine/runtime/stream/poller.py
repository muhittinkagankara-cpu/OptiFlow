"""REST yoklama motoru.

REST'te itme yoktur: sunucu bir şey değiştiğinde haber vermez, sorulması
gerekir. Bu modül soruyu **düzenli** sorar, yanıtı ortak modele çevirir ve
dağıtıcıya verir.

Neden `poll_once` ayrı
----------------------
Döngü ile tek yoklama ayrılmıştır. Tek yoklama, gerçek bir HTTP sunucusuna
karşı ağsız beklemeden sınanabilir; döngü ise yalnızca zamanlamayı ekler.
Birleşik olsaydı, her test bir saniye beklemek zorunda kalırdı.

Neden sıra numarası burada verilir
----------------------------------
Numara, olayın **kaynağında** verilmelidir. Dağıtıcıda verilseydi, aynı yanıt
iki kez çekildiğinde iki farklı numara alır ve yineleme denetimi hiçbir işe
yaramazdı.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from simulation_engine.runtime.pipeline.device_events import TransformResult
from simulation_engine.runtime.pipeline.transformers import (
    MappingTable,
    from_rest_payload,
)
from simulation_engine.runtime.stream.dispatcher import StreamDispatcher
from simulation_engine.runtime.stream.scheduler import (
    PollScheduler,
    StreamHealth,
    clamp_interval_ms,
)
from simulation_engine.runtime.stream.types import (
    DeviceDataEvent,
    SequenceCounter,
    from_device_event,
)
from simulation_engine.runtime.types import ConnectionSpec


@dataclass
class PollOutcome:
    """Tek bir yoklamanın sonucu."""

    connector_id: str
    at_ms: int
    ok: bool
    #: Üretilen olay sayısı (yineleme elenmeden önce).
    events: int = 0
    #: Dağıtıcının kabul ettiği olay sayısı.
    accepted: int = 0
    duplicates: int = 0
    problems: int = 0
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, object]:
        return {
            "connector_id": self.connector_id,
            "at_ms": self.at_ms,
            "ok": self.ok,
            "events": self.events,
            "accepted": self.accepted,
            "duplicates": self.duplicates,
            "problems": self.problems,
            "error": self.error,
        }


def emit_result(
    result: TransformResult,
    dispatcher: StreamDispatcher,
    sequences: SequenceCounter,
    connector_id: str,
) -> Dict[str, int]:
    """Çevrilmiş olayları numaralandırıp dağıtıcıya verir.

    Numaralandırma **olay başına** yapılır, yanıt başına değil: tek bir REST
    yanıtı beş makineden ölçüm taşıyabilir ve bunların ayrı ayrı elenebilmesi
    gerekir.
    """
    accepted = 0
    duplicates = 0

    for event in result.events:
        data_event = from_device_event(event, sequences.next(connector_id))
        if dispatcher.submit(data_event):
            accepted += 1
        else:
            duplicates += 1

    return {
        "events": len(result.events),
        "accepted": accepted,
        "duplicates": duplicates,
        "problems": len(result.problems),
    }


@dataclass
class RestPoller:
    """Bir REST ucunu düzenli yoklar ve olayları dağıtıcıya verir."""

    spec: ConnectionSpec
    #: Gerçek HTTP çağrısı; testte sahte bir işlev verilir.
    fetch: Callable[[], Any]
    dispatcher: StreamDispatcher
    sequences: SequenceCounter
    mapping: Optional[MappingTable] = None
    interval_ms: Optional[int] = None
    scheduler: PollScheduler = field(default_factory=PollScheduler)
    clock: Callable[[], int] = lambda: int(time.time() * 1000)
    sleep: Callable[[float], Any] = asyncio.sleep

    #: Son yoklamaların sonuçları (en fazla 50).
    outcomes: List[PollOutcome] = field(default_factory=list)
    #: İlk verinin geldiği an; hiç veri gelmediyse `None`.
    first_data_at_ms: Optional[int] = None
    last_data_at_ms: Optional[int] = None
    running: bool = False
    _stopping: bool = False

    def __post_init__(self) -> None:
        self.interval_ms = clamp_interval_ms(self.interval_ms)
        self.scheduler.add(
            self.spec.connection_id, self.interval_ms, self.clock()
        )

    @property
    def connector_id(self) -> str:
        return self.spec.connection_id

    def stop(self) -> None:
        self._stopping = True
        self.running = False

    async def poll_once(self, now_ms: Optional[int] = None) -> PollOutcome:
        """Tek bir yoklama yapar.

        Hata döngüyü durdurmaz: kapalı bir uç noktanın hatası kaydedilir,
        zamanlayıcı aralığı büyütür ve sonraki tur denenir.
        """
        at_ms = now_ms if now_ms is not None else self.clock()

        try:
            payload = self.fetch()
            if asyncio.iscoroutine(payload):
                payload = await payload
        except Exception as error:  # noqa: BLE001 — tek hata akışı bitirmez
            self.scheduler.note_failure(self.connector_id, at_ms)
            outcome = PollOutcome(
                connector_id=self.connector_id,
                at_ms=at_ms,
                ok=False,
                error=str(error) or error.__class__.__name__,
            )
            self._record(outcome)
            return outcome

        result = from_rest_payload(
            connection_id=self.connector_id,
            payload=payload,
            at_ms=at_ms,
            mapping=self.mapping,
            default_machine=self.spec.label,
        )
        counts = emit_result(result, self.dispatcher, self.sequences, self.connector_id)
        self.scheduler.note_success(self.connector_id, at_ms)

        if counts["events"] > 0:
            if self.first_data_at_ms is None:
                self.first_data_at_ms = at_ms
            self.last_data_at_ms = at_ms

        outcome = PollOutcome(
            connector_id=self.connector_id,
            at_ms=at_ms,
            ok=True,
            events=counts["events"],
            accepted=counts["accepted"],
            duplicates=counts["duplicates"],
            problems=counts["problems"],
        )
        self._record(outcome)
        return outcome

    def _record(self, outcome: PollOutcome) -> None:
        self.outcomes.append(outcome)
        if len(self.outcomes) > 50:
            del self.outcomes[0 : len(self.outcomes) - 50]

    async def run(self, max_cycles: Optional[int] = None) -> "RestPoller":
        """Yoklama döngüsü; `max_cycles` yalnızca testler içindir."""
        # `_stopping` burada **sıfırlanmaz**. Sıfırlanıyordu ve bu gerçek bir
        # yarış açıyordu: `start_stream` görevi oluşturur, kullanıcı hemen
        # `stop_stream` çağırırsa durdurma bayrağı görev henüz sıraya
        # girmeden yazılır; döngü başlarken onu silince akış yine de
        # çalışırdı. Durdurulmuş bir kaynak yeniden başlatılmaz; yeni bir
        # kaynak kurulur.
        self.running = True
        cycles = 0

        while not self._stopping:
            await self.poll_once()
            self.dispatcher.drain(self.clock())

            cycles += 1
            if max_cycles is not None and cycles >= max_cycles:
                break

            entry = self.scheduler.entries.get(self.connector_id)
            delay_ms = entry.current_interval_ms if entry else self.interval_ms
            await self.sleep((delay_ms or 0) / 1000.0)

        self.running = False
        return self

    # -- Durum --------------------------------------------------------------

    @property
    def health(self) -> StreamHealth:
        """Akışın durumu.

        Görevin ayakta olması "çalışıyor" demek değildir: veri gelmediyse
        durum `IDLE`'dır ve arayüz "Veri bekleniyor" yazar.
        """
        if not self.running:
            return StreamHealth.STOPPED
        entry = self.scheduler.entries.get(self.connector_id)
        if entry is not None and entry.consecutive_failures > 0:
            return StreamHealth.FAILING
        if self.dispatcher.queue.under_pressure:
            return StreamHealth.BACKPRESSURE
        if self.first_data_at_ms is None:
            return StreamHealth.IDLE
        return StreamHealth.RUNNING

    def state(self) -> Dict[str, object]:
        entry = self.scheduler.entries.get(self.connector_id)
        return {
            # Anahtar iki adla da yazılır: olay modeli `connector_id`
            # kullanır (SALES-13), akış durumu sözleşmesi ise SALES-9'dan beri
            # `connection_id`. Tek ada indirgemek ya arayüzü ya da yöneticiyi
            # kırardı; iki ad aynı değeri taşır.
            "connector_id": self.connector_id,
            "connection_id": self.connector_id,
            "protocol": "rest",
            "running": self.running,
            "health": self.health.value,
            "first_data_at_ms": self.first_data_at_ms,
            "last_data_at_ms": self.last_data_at_ms,
            "schedule": entry.to_dict() if entry is not None else None,
            "last_outcome": self.outcomes[-1].to_dict() if self.outcomes else None,
        }


def usable_events(events: List[DeviceDataEvent]) -> List[DeviceDataEvent]:
    """Metrik güncellemeye elverişli olaylar."""
    return [event for event in events if event.is_usable]
