"""Olay tamponu ve dağıtımı.

Köprüde olan biten her şey bir olaya dönüşür: bağlantı denemesi, cihazdan gelen
veri, hata, yeniden bağlanma. Olaylar iki yere gider:

1. **Tampon** — son `MAX_EVENTS` olay bellekte tutulur ve yeniden oynatılabilir
   (`GET /api/runtime/events`, replay istekleri).
2. **Aboneler** — SSE ile bağlı istemcilere anında iletilir.

Neden SSE, WebSocket değil
--------------------------
Akış tek yönlüdür: sunucu olay yayar, tarayıcı yalnızca dinler. WebSocket iki
yönlü bir kanal kurar ve karşılığında proxy uyumsuzlukları, kendi yeniden
bağlanma mantığı ve ayrı bir kimlik doğrulama yolu getirir. SSE sıradan bir
HTTP yanıtıdır; mevcut `Authorization` başlığı ve CORS ayarı olduğu gibi geçerli
kalır.

Yavaş istemci sorunu
--------------------
Her abonenin sınırlı bir kuyruğu vardır. Kuyruk dolarsa **en eski olay düşer**
ve abone bunu bir "atlandı" sayacından öğrenir. Sınırsız kuyruk, bir sekmesi
donmuş tarayıcı yüzünden sunucunun belleğinin dolmasına yol açardı.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from simulation_engine.runtime.types import EventLevel

#: Tamponda tutulan en fazla olay. Sprint sözleşmesinde "son 1000 olay".
MAX_EVENTS = 1_000

#: Bir abonenin kuyruğunda bekleyebilecek en fazla olay.
SUBSCRIBER_QUEUE_SIZE = 200


@dataclass
class RuntimeEvent:
    """Köprüde olan tek bir şey."""

    #: Artan sıra numarası; istemci "bundan sonrasını ver" diyebilsin diye.
    sequence: int
    connection_id: str
    kind: str
    level: EventLevel
    message: str
    at_ms: int = field(default_factory=lambda: int(time.time() * 1000))
    #: Sayısal ekler (gecikme, bayt, düğüm değeri). Ölçülmeyen alan hiç konmaz.
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sequence": self.sequence,
            "connection_id": self.connection_id,
            "kind": self.kind,
            "level": self.level.value,
            "message": self.message,
            "at_ms": self.at_ms,
            "data": dict(self.data),
        }


def format_sse(event: RuntimeEvent) -> str:
    """Olayı SSE çerçevesine çevirir.

    `id:` alanı sıra numarasıdır; bağlantı koptuğunda tarayıcı
    `Last-Event-ID` başlığıyla kaldığı yerden devam edebilir. Satır sonları
    ikilidir (`\\n\\n`) — tek satır sonuyla biten bir çerçeve, istemci
    tarafında bir sonraki olayla birleşir ve ikisi de ayrıştırılamaz.
    """
    payload = json.dumps(event.to_dict(), ensure_ascii=False)
    return f"id: {event.sequence}\nevent: {event.kind}\ndata: {payload}\n\n"


def sse_comment(text: str) -> str:
    """Bağlantıyı canlı tutan yorum satırı.

    Aylak bir SSE bağlantısını proxy'ler ve mobil ağlar kapatır; iki nokta ile
    başlayan satır istemci tarafından yok sayılır ama kanalı açık tutar.
    """
    return f": {text}\n\n"


class EventBuffer:
    """Son olayların halka tamponu."""

    def __init__(self, capacity: int = MAX_EVENTS) -> None:
        self._capacity = max(1, capacity)
        self._events: List[RuntimeEvent] = []
        self._next_sequence = 1

    @property
    def capacity(self) -> int:
        return self._capacity

    def append(
        self,
        connection_id: str,
        kind: str,
        message: str,
        level: EventLevel = EventLevel.INFO,
        data: Optional[Dict[str, Any]] = None,
        at_ms: Optional[int] = None,
    ) -> RuntimeEvent:
        """Yeni olay ekler ve onu döndürür."""
        event = RuntimeEvent(
            sequence=self._next_sequence,
            connection_id=connection_id,
            kind=kind,
            level=level,
            message=message,
            at_ms=at_ms if at_ms is not None else int(time.time() * 1000),
            data=dict(data or {}),
        )
        self._next_sequence += 1
        self._events.append(event)
        if len(self._events) > self._capacity:
            del self._events[0 : len(self._events) - self._capacity]
        return event

    def resume_from(self, sequence: int) -> int:
        """Numaralandırmayı verilen noktadan sürdürür.

        Sunucu yeniden başladığında tampon bellekte sıfırdan başlar ama kalıcı
        günlükte o numaralar zaten vardır. Kurtarmada bu çağrılmazsa yeni
        olaylar eski numaraları alır ve kalıcı günlüğe yazılamaz (birincil
        anahtar çakışması) — testte tam olarak bu yaşandı.

        Numara **geriye alınmaz**: verilen değer mevcut sayaçtan küçükse
        değişiklik yapılmaz.
        """
        if sequence >= self._next_sequence:
            self._next_sequence = sequence + 1
        return self._next_sequence

    @property
    def next_sequence(self) -> int:
        """Bir sonraki olayın alacağı numara."""
        return self._next_sequence

    def all(self) -> List[RuntimeEvent]:
        """Tampondaki olaylar, eskiden yeniye."""
        return list(self._events)

    def since(self, sequence: int) -> List[RuntimeEvent]:
        """Verilen sıra numarasından **sonraki** olaylar.

        Tampon taştıysa istenen numara artık yoktur; o durumda elde kalan en
        eski olaydan başlanır. Boş liste dönmek, istemcinin aradaki olayları
        hiç öğrenememesi demek olurdu.
        """
        return [event for event in self._events if event.sequence > sequence]

    def for_connection(self, connection_id: str) -> List[RuntimeEvent]:
        return [event for event in self._events if event.connection_id == connection_id]

    def last(self) -> Optional[RuntimeEvent]:
        return self._events[-1] if self._events else None

    def dropped_before(self) -> Optional[int]:
        """Tampondan düşen en son sıra numarası; hiç düşmediyse `None`."""
        if not self._events:
            return None
        first = self._events[0].sequence
        return first - 1 if first > 1 else None

    def clear(self) -> None:
        self._events.clear()

    def __len__(self) -> int:
        return len(self._events)


class Subscriber:
    """SSE ile bağlı tek bir istemci."""

    def __init__(self, queue_size: int = SUBSCRIBER_QUEUE_SIZE) -> None:
        self.queue: asyncio.Queue[RuntimeEvent] = asyncio.Queue(maxsize=queue_size)
        #: Kuyruk dolduğu için atılan olay sayısı.
        self.dropped = 0

    def offer(self, event: RuntimeEvent) -> bool:
        """Olayı kuyruğa koymayı dener.

        Kuyruk doluysa **en eski olay atılır** ve yenisi konur: bir izleme
        akışında en yeni durum, en eski durumdan daha değerlidir.
        """
        try:
            self.queue.put_nowait(event)
            return True
        except asyncio.QueueFull:
            self.dropped += 1
            try:
                self.queue.get_nowait()
                self.queue.put_nowait(event)
            except (asyncio.QueueEmpty, asyncio.QueueFull):
                pass
            return False


class EventDispatcher:
    """Olayları tampona yazar ve abonelere dağıtır."""

    def __init__(self, buffer: Optional[EventBuffer] = None) -> None:
        self.buffer = buffer if buffer is not None else EventBuffer()
        self._subscribers: List[Subscriber] = []
        #: Her olayda çağrılan kanca; kalıcılık katmanı buraya bağlanır.
        #:
        #: Tek bir kanca olması bilinçlidir: olayları üç ayrı yerde diske
        #: yazmak, birinin unutulması ve yeniden oynatmanın eksik kalması
        #: demek olurdu.
        self.on_emit = None

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def subscribe(self) -> Subscriber:
        subscriber = Subscriber()
        self._subscribers.append(subscriber)
        return subscriber

    def unsubscribe(self, subscriber: Subscriber) -> None:
        if subscriber in self._subscribers:
            self._subscribers.remove(subscriber)

    def emit(
        self,
        connection_id: str,
        kind: str,
        message: str,
        level: EventLevel = EventLevel.INFO,
        data: Optional[Dict[str, Any]] = None,
        at_ms: Optional[int] = None,
    ) -> RuntimeEvent:
        """Olayı üretir, saklar ve dağıtır."""
        event = self.buffer.append(
            connection_id=connection_id,
            kind=kind,
            message=message,
            level=level,
            data=data,
            at_ms=at_ms,
        )
        for subscriber in list(self._subscribers):
            subscriber.offer(event)

        if self.on_emit is not None:
            self.on_emit(event)

        return event

    def replay(self, since: int = 0, connection_id: Optional[str] = None) -> List[RuntimeEvent]:
        """Tampondan yeniden oynatma.

        Gerçek veri geldiyse tampon onu taşır ve replay **gerçek olayları**
        döndürür; tampon boşsa boş liste döner ve çağıran benzetim verisine
        düşüp düşmeyeceğine kendisi karar verir. Burada uydurma bir olay
        üretilmez.
        """
        events = self.buffer.since(since)
        if connection_id is not None:
            events = [event for event in events if event.connection_id == connection_id]
        return events
