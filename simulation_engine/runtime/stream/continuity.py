"""Kesintisiz akış: kalp atışı, boşta kalma ve yeniden bağlanma.

Sorun
-----
Bir akış "başlatıldı" diye sonsuza dek veri getirmez. Kablo çekilir, PLC
yeniden başlatılır, ağ anahtarı düşer. Bu durumların hiçbiri hata olarak
görünmez: yoklayıcı bekler, abone dinler, kimse bir şey söylemez. Ekranda en
son gelen değer öylece durur ve operatör onu **şu anki** değer sanır.

Üç ayrı durum
-------------
* **Boşta (idle)** — veri gelmiyor ama bağlantı ayakta olabilir. Bir makine
  vardiya arasında gerçekten hiçbir şey bildirmeyebilir.
* **Bayat (stale)** — o kadar uzun süredir veri yok ki ekrandaki değer artık
  güvenilmez. Bu bir alarmdır.
* **Yeniden bağlandı** — kopmuş bir akış geri geldi. Bunun ayrı bir olay
  olması gerekir: operatör verinin ne zaman kesildiğini ve ne zaman döndüğünü
  görmelidir.

Bu üçünü tek bir "bağlantı yok" durumuna indirmek, kısa bir ağ kesintisiyle
saatlerdir ölü bir hattı aynı gösterirdi.

Kalp atışı neden gerekli
------------------------
Kalp atışı olayı, "sistem hâlâ bakıyor" demektir. Olmasaydı, veri gelmeyen bir
akışta ekran ile sunucu arasındaki sessizlik iki farklı şey anlamına gelirdi:
cihaz susuyor ya da sunucu çöktü. Ayırt edilemezdi.

Sarsıntı (jitter) neden var
---------------------------
Yirmi cihaz aynı anda koparsa (ağ anahtarı düştü), hepsi aynı gecikmeyle
yeniden dener ve ağ ayağa kalktığı anda hepsi aynı milisaniyede vurur. Bu,
yeni kalkan ağı ikinci kez düşürebilir. Sarsıntı, denemeleri zamana yayar.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

#: Veri gelmediğinde "boşta" sayılana kadar geçen süre (ms).
#:
#: On beş saniye, saniyede bir yoklanan bir akışta on beş kaçırılmış yoklama
#: demektir — geçici bir gecikmeden ayırt edilecek kadar uzun.
IDLE_AFTER_MS = 15_000

#: "Bayat" sayılana kadar geçen süre (ms).
#:
#: Altmış saniye: ekrandaki bir değerin bir dakikadan eski olması, üretim
#: hattında karar vermek için fazla eskidir.
STALE_AFTER_MS = 60_000

#: Kalp atışı olaylarının aralığı (ms).
#:
#: On saniye, tarayıcı tarafındaki SSE zaman aşımlarının altında kalır;
#: daha seyrek olsaydı, sağlıklı bir akış kopmuş sanılabilirdi.
HEARTBEAT_INTERVAL_MS = 10_000

#: Yeniden bağlanma denemesinin taban gecikmesi (ms).
BASE_RECONNECT_MS = 1_000

#: Yeniden bağlanma gecikmesinin üst sınırı (ms).
#:
#: Beş dakika: bundan uzun bir bekleme, hattın onarıldığı ama sistemin bunu
#: fark etmediği uzun bir pencere yaratırdı.
MAX_RECONNECT_MS = 300_000

#: Sarsıntının oranı: gecikmenin en fazla bu kadarı rastgele eklenir.
JITTER_RATIO = 0.25

#: Kesintisizlik olaylarının türleri.
HEARTBEAT = "heartbeat"
DEVICE_IDLE = "device_idle"
DEVICE_RECONNECTED = "device_reconnected"
DEVICE_STALE = "device_stale"

CONTINUITY_KINDS = (HEARTBEAT, DEVICE_IDLE, DEVICE_RECONNECTED, DEVICE_STALE)


class Liveness(str, Enum):
    """Bir akışın canlılık durumu."""

    #: Yakın zamanda veri geldi.
    LIVE = "live"
    #: Bir süredir veri yok ama henüz bayat değil.
    IDLE = "idle"
    #: Ekrandaki değer artık güvenilmez.
    STALE = "stale"
    #: Hiç veri gelmedi; akış yeni başladı.
    UNKNOWN = "unknown"


LIVENESS_LABEL: Dict[Liveness, str] = {
    Liveness.LIVE: "Veri akıyor",
    Liveness.IDLE: "Veri bekleniyor",
    Liveness.STALE: "Veri bayat",
    Liveness.UNKNOWN: "Henüz veri gelmedi",
}


@dataclass(frozen=True)
class ContinuityEvent:
    """Kesintisizlik değerlendirmesinin ürettiği olay."""

    kind: str
    connector_id: str
    at_ms: int
    message: str
    #: Son verinin üstünden geçen süre; hiç veri gelmediyse `None`.
    age_ms: Optional[int] = None
    #: Runtime olay sözlüğüyle aynı: `info`, `warning`, `critical`.
    #:
    #: Ayrı bir sözlük ("error" gibi) kullanılsaydı, olay kalıcılık katmanına
    #: yazılırken tanınmaz ve olay sessizce kaybolurdu.
    level: str = "info"
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "connector_id": self.connector_id,
            "at_ms": self.at_ms,
            "message": self.message,
            "age_ms": self.age_ms,
            "level": self.level,
            "data": dict(self.data),
        }


def data_age_ms(last_data_ms: Optional[int], now_ms: int) -> Optional[int]:
    """Son verinin üstünden geçen süre; hiç veri gelmediyse `None`.

    Sıfır dönseydi, hiç veri almamış bir akış "az önce veri geldi" gibi
    görünürdü — bu sprintin engellemeye çalıştığı tam olarak budur.
    """
    if last_data_ms is None:
        return None
    return max(0, now_ms - last_data_ms)


def liveness_of(
    last_data_ms: Optional[int],
    now_ms: int,
    idle_after_ms: int = IDLE_AFTER_MS,
    stale_after_ms: int = STALE_AFTER_MS,
) -> Liveness:
    """Son veri anına bakarak canlılık durumu.

    Hiç veri gelmemişse `UNKNOWN` döner, `STALE` değil: yeni başlatılmış bir
    akışın ilk saniyesinde "veri bayat" demek yanlış olurdu.
    """
    age = data_age_ms(last_data_ms, now_ms)
    if age is None:
        return Liveness.UNKNOWN
    if age >= stale_after_ms:
        return Liveness.STALE
    if age >= idle_after_ms:
        return Liveness.IDLE
    return Liveness.LIVE


def reconnect_delay_ms(
    attempt: int,
    base_ms: int = BASE_RECONNECT_MS,
    max_ms: int = MAX_RECONNECT_MS,
    jitter: float = 0.0,
) -> int:
    """Üstel geri çekilme + sarsıntı.

    `attempt` birinci denemede 1'dir. `jitter` 0 ile 1 arasında bir orandır ve
    çağıran tarafından üretilir: rastgeleliği burada üretseydik, gecikme
    testte doğrulanamazdı.

    Üst sınır sarsıntıdan **sonra** uygulanır; sarsıntı, sınıra dayanmış bir
    gecikmeyi sınırın üstüne çıkaramaz.
    """
    if attempt <= 0:
        return 0
    base = max(1, int(base_ms))
    grown = base * (2 ** (attempt - 1))
    ratio = min(1.0, max(0.0, jitter)) * JITTER_RATIO
    delayed = grown * (1.0 + ratio)
    return int(min(max_ms, delayed))


def jittered_delay_ms(
    attempt: int,
    rng: Optional[random.Random] = None,
    base_ms: int = BASE_RECONNECT_MS,
    max_ms: int = MAX_RECONNECT_MS,
) -> int:
    """`reconnect_delay_ms`'in rastgele sarsıntılı hâli."""
    source = rng or random.Random()
    return reconnect_delay_ms(attempt, base_ms, max_ms, source.random())


@dataclass
class ConnectorLiveness:
    """Bir bağlantının kesintisizlik durumu."""

    connector_id: str
    #: Son verinin anı; hiç veri gelmediyse `None`.
    last_data_ms: Optional[int] = None
    #: Son kalp atışının anı.
    last_heartbeat_ms: Optional[int] = None
    #: Şu an bildirilmiş olan durum; olay tekrarını engeller.
    reported: Liveness = Liveness.UNKNOWN
    #: Kaç kez yeniden bağlanıldı?
    reconnects: int = 0
    #: Art arda kaçıncı yeniden bağlanma denemesi?
    attempt: int = 0
    #: Akışın kesintiye uğradığı an; kesinti yoksa `None`.
    outage_started_ms: Optional[int] = None

    def to_dict(self, now_ms: int) -> Dict[str, Any]:
        return {
            "connector_id": self.connector_id,
            "last_data_ms": self.last_data_ms,
            "age_ms": data_age_ms(self.last_data_ms, now_ms),
            "liveness": self.reported.value,
            "liveness_label": LIVENESS_LABEL[self.reported],
            "reconnects": self.reconnects,
            "attempt": self.attempt,
            "outage_started_ms": self.outage_started_ms,
            "last_heartbeat_ms": self.last_heartbeat_ms,
        }


class ContinuityMonitor:
    """Akışların kesintisizliğini izler ve olay üretir.

    Saati kendisi okumaz: her çağrı `now_ms` alır. İçeride `time.time()`
    çağrılsaydı, boşta kalma ve bayatlama davranışı testte ancak gerçek süre
    beklenerek doğrulanabilirdi.
    """

    def __init__(
        self,
        idle_after_ms: int = IDLE_AFTER_MS,
        stale_after_ms: int = STALE_AFTER_MS,
        heartbeat_interval_ms: int = HEARTBEAT_INTERVAL_MS,
    ) -> None:
        self._idle_after_ms = max(1, int(idle_after_ms))
        self._stale_after_ms = max(self._idle_after_ms + 1, int(stale_after_ms))
        self._heartbeat_interval_ms = max(1, int(heartbeat_interval_ms))
        self._states: Dict[str, ConnectorLiveness] = {}

    # -- kayıt --------------------------------------------------------------

    def track(self, connector_id: str) -> ConnectorLiveness:
        """Bağlantıyı izlemeye alır; zaten izleniyorsa mevcut durumu döndürür."""
        state = self._states.get(connector_id)
        if state is None:
            state = ConnectorLiveness(connector_id=connector_id)
            self._states[connector_id] = state
        return state

    def forget(self, connector_id: str) -> bool:
        return self._states.pop(connector_id, None) is not None

    def state(self, connector_id: str) -> Optional[ConnectorLiveness]:
        return self._states.get(connector_id)

    def states(self, now_ms: int) -> List[Dict[str, Any]]:
        return [state.to_dict(now_ms) for state in self._states.values()]

    def clear(self) -> None:
        self._states.clear()

    # -- veri geldi ---------------------------------------------------------

    def note_data(self, connector_id: str, now_ms: int) -> Optional[ContinuityEvent]:
        """Veri geldiğini bildirir.

        Akış boşta ya da bayat durumdayken veri gelirse **yeniden bağlandı**
        olayı üretilir ve kesintinin ne kadar sürdüğü olaya yazılır. Bu olay
        olmasaydı, ekranda yalnızca değerin yeniden değişmeye başladığı
        görülür, kesintinin yaşandığı hiç bilinmezdi.
        """
        state = self.track(connector_id)
        previous = state.reported
        outage_started = state.outage_started_ms
        state.last_data_ms = now_ms
        state.reported = Liveness.LIVE
        state.attempt = 0
        state.outage_started_ms = None

        if previous in (Liveness.IDLE, Liveness.STALE):
            state.reconnects += 1
            gap = None if outage_started is None else max(0, now_ms - outage_started)
            return ContinuityEvent(
                kind=DEVICE_RECONNECTED,
                connector_id=connector_id,
                at_ms=now_ms,
                message=_reconnect_message(connector_id, gap),
                age_ms=gap,
                level="info",
                data={"outage_ms": gap, "reconnects": state.reconnects},
            )
        return None

    def note_failure(self, connector_id: str, now_ms: int) -> int:
        """Bir denemenin başarısız olduğunu bildirir; sıradaki deneme numarası.

        Kesintinin başlangıcı ilk başarısızlıkta işaretlenir; sonrakiler onu
        ileri taşımaz. Taşısaydı, on dakikalık bir kesinti son denemeden
        itibaren birkaç saniye görünürdü.
        """
        state = self.track(connector_id)
        state.attempt += 1
        if state.outage_started_ms is None:
            state.outage_started_ms = now_ms
        return state.attempt

    def next_delay_ms(
        self, connector_id: str, rng: Optional[random.Random] = None
    ) -> int:
        """Bu bağlantı için bir sonraki yeniden deneme gecikmesi."""
        state = self.track(connector_id)
        return jittered_delay_ms(max(1, state.attempt), rng)

    # -- değerlendirme ------------------------------------------------------

    def evaluate(self, now_ms: int) -> List[ContinuityEvent]:
        """Bütün akışları gözden geçirir ve durum değişikliklerini olaya çevirir.

        Yalnızca **değişiklik** olay üretir: aynı durum her turda yeniden
        bildirilseydi, bir dakika susan bir cihaz yüzlerce özdeş olay üretir
        ve olay günlüğü okunamaz hâle gelirdi.
        """
        events: List[ContinuityEvent] = []
        for state in self._states.values():
            current = liveness_of(
                state.last_data_ms, now_ms, self._idle_after_ms, self._stale_after_ms
            )
            if current is state.reported:
                continue
            if current is Liveness.IDLE:
                events.append(self._idle_event(state, now_ms))
            elif current is Liveness.STALE:
                events.append(self._stale_event(state, now_ms))
            elif current is Liveness.UNKNOWN:
                # Veri hiç gelmemiş: bu bir değişiklik değil, başlangıç hâlidir.
                pass
            if current in (Liveness.IDLE, Liveness.STALE):
                if state.outage_started_ms is None:
                    state.outage_started_ms = state.last_data_ms or now_ms
            state.reported = current
        return events

    def heartbeats(self, now_ms: int) -> List[ContinuityEvent]:
        """Zamanı gelmiş kalp atışlarını üretir.

        Kalp atışı, veri gelmese de "sistem hâlâ bakıyor" demektir; içinde son
        verinin yaşı taşınır ve arayüz bu yaşı gösterir.
        """
        events: List[ContinuityEvent] = []
        for state in self._states.values():
            last = state.last_heartbeat_ms
            if last is not None and now_ms - last < self._heartbeat_interval_ms:
                continue
            state.last_heartbeat_ms = now_ms
            age = data_age_ms(state.last_data_ms, now_ms)
            events.append(
                ContinuityEvent(
                    kind=HEARTBEAT,
                    connector_id=state.connector_id,
                    at_ms=now_ms,
                    message="Akış izleniyor",
                    age_ms=age,
                    level="info",
                    data={"liveness": state.reported.value},
                )
            )
        return events

    def _idle_event(self, state: ConnectorLiveness, now_ms: int) -> ContinuityEvent:
        age = data_age_ms(state.last_data_ms, now_ms)
        return ContinuityEvent(
            kind=DEVICE_IDLE,
            connector_id=state.connector_id,
            at_ms=now_ms,
            message=_idle_message(state.connector_id, age),
            age_ms=age,
            level="warning",
            data={"idle_after_ms": self._idle_after_ms},
        )

    def _stale_event(self, state: ConnectorLiveness, now_ms: int) -> ContinuityEvent:
        age = data_age_ms(state.last_data_ms, now_ms)
        return ContinuityEvent(
            kind=DEVICE_STALE,
            connector_id=state.connector_id,
            at_ms=now_ms,
            message=_stale_message(state.connector_id, age),
            age_ms=age,
            # Bayat veri kritiktir: ekrandaki değer artık güvenilmez ve
            # operatör onu şu anki değer sanar.
            level="critical",
            data={"stale_after_ms": self._stale_after_ms},
        )


def _seconds(age_ms: Optional[int]) -> str:
    """Süreyi okunur biçime çevirir; ölçülmemişse bunu yazar."""
    if age_ms is None:
        return "süre bilinmiyor"
    if age_ms < 60_000:
        return f"{age_ms // 1000} sn"
    return f"{age_ms // 60_000} dk"


def _idle_message(connector_id: str, age_ms: Optional[int]) -> str:
    return f"{connector_id}: {_seconds(age_ms)} süredir veri gelmiyor"


def _stale_message(connector_id: str, age_ms: Optional[int]) -> str:
    return f"{connector_id}: veri bayat ({_seconds(age_ms)} önce)"


def _reconnect_message(connector_id: str, outage_ms: Optional[int]) -> str:
    if outage_ms is None:
        return f"{connector_id}: veri yeniden akıyor"
    return f"{connector_id}: veri yeniden akıyor ({_seconds(outage_ms)} kesinti)"
