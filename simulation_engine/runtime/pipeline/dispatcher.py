"""Cihaz olaylarının tek çıkış kapısı.

    RuntimeManager → DeviceEvent → Dispatcher → SSE → Frontend

Bütün cihaz verisi bu sınıftan geçer. Tek kapı olması bilinçlidir: olaylar üç
ayrı yerden yayımlansaydı, biri kalite kontrolünü ya da eşleme doğrulamasını
atlar ve doğrulanmamış bir değer "canlı üretim verisi" olarak ekrana düşerdi.

Dağıtıcı üç şey yapar:

1. Kullanılabilir olayları `device_data` olarak yayar ve **son değerleri**
   saklar (Data Explorer ve metrik motoru bunları okur).
2. Kullanılamayan olayları ve çeviri sorunlarını `diagnostic` olarak yayar —
   sessizce yutmaz.
3. Ekran alanı eşleşmesini doğrular: bir makine modeldeki hiçbir istasyona
   karşılık gelmiyorsa uyarı üretir.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Dict, Iterable, List, Optional

from simulation_engine.runtime.events import EventDispatcher
from simulation_engine.runtime.pipeline.aggregators import (
    MachineSnapshot,
    aggregate,
    line_totals,
)
from simulation_engine.runtime.pipeline.device_events import (
    DeviceEvent,
    PipelineProblem,
)
from simulation_engine.runtime.types import EventLevel

if TYPE_CHECKING:  # pragma: no cover - yalnizca tip denetimi icin
    from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord

#: Saklanan en fazla cihaz olayı (Data Explorer penceresi).
MAX_DEVICE_EVENTS = 500

#: Saklanan en fazla tanılama kaydı.
MAX_PROBLEMS = 200


@dataclass(frozen=True)
class MappingWarning:
    """Bir makine kimliğinin ekranda karşılığı yok."""

    machine_id: str
    reason: str
    #: Bu makineden gelen ölçüm sayısı.
    sample_count: int

    def to_dict(self) -> Dict[str, object]:
        return {
            "machine_id": self.machine_id,
            "reason": self.reason,
            "sample_count": self.sample_count,
        }


def verify_mapping(
    events: Iterable[DeviceEvent], known_machine_ids: Iterable[str]
) -> List[MappingWarning]:
    """Cihaz makinelerini modeldeki istasyonlarla karşılaştırır.

    Eşleşmeyen bir makine **sessizce geçilmez**: verisi gelen ama ekranda yeri
    olmayan bir makine, "sistem çalışıyor ama ekranda hiçbir şey değişmiyor"
    şikâyetinin en sık nedenidir.

    Karşılaştırma büyük/küçük harfe duyarsızdır: PLC'ler çoğu zaman
    `TORNA_01` yazar, modelde ise `torna_01` durur.
    """
    known = {item.strip().lower() for item in known_machine_ids}
    counts: Dict[str, int] = {}
    for event in events:
        counts[event.machine_id] = counts.get(event.machine_id, 0) + 1

    warnings: List[MappingWarning] = []
    for machine_id, count in sorted(counts.items()):
        if machine_id.strip().lower() in known:
            continue
        warnings.append(
            MappingWarning(
                machine_id=machine_id,
                reason=(
                    f"'{machine_id}' cihazından veri geliyor ama modelde bu adla "
                    "bir istasyon yok; bu veri hiçbir ekrana yazılmıyor."
                ),
                sample_count=count,
            )
        )
    return warnings


def detect_source_conflicts(events: Iterable[DeviceEvent]) -> List[MappingWarning]:
    """Aynı ölçümü birden çok kaynaktan alan makineleri bulur.

    Uçtan uca koşumda görüldü: `TORNA_01` için üretim sayacı hem OPC UA hem
    MQTT bağlantısından gelince değerler birbirinin üstüne yazıldı ve hesaplanan
    saatlik çıktı anlamsızlaştı. İki kaynağın aynı ölçümü bildirmesi bir
    yapılandırma hatasıdır; sessizce harmanlamak, iki farklı gerçeği tek bir
    yanlışa çevirmek olurdu.

    Uyarı üretilir, veri **atılmaz**: hangi kaynağın doğru olduğuna kullanıcı
    karar verir.
    """
    seen: Dict[tuple, set] = {}
    counts: Dict[tuple, int] = {}
    for event in events:
        key = (event.machine_id, event.metric.value)
        seen.setdefault(key, set()).add(event.connection_id)
        counts[key] = counts.get(key, 0) + 1

    warnings: List[MappingWarning] = []
    for (machine_id, metric), connections in sorted(seen.items()):
        if len(connections) < 2:
            continue
        names = ", ".join(sorted(connections))
        warnings.append(
            MappingWarning(
                machine_id=machine_id,
                reason=(
                    f"'{machine_id}' için {metric} ölçümü {len(connections)} ayrı "
                    f"kaynaktan geliyor ({names}); değerler birbirinin üstüne "
                    "yazılıyor. Tek bir kaynak seçin."
                ),
                sample_count=counts[(machine_id, metric)],
            )
        )
    return warnings


class DeviceDispatcher:
    """Cihaz olaylarını saklar, yayar ve doğrular."""

    def __init__(
        self,
        dispatcher: EventDispatcher,
        max_events: int = MAX_DEVICE_EVENTS,
        max_problems: int = MAX_PROBLEMS,
    ) -> None:
        self._dispatcher = dispatcher
        self._max_events = max(1, max_events)
        self._max_problems = max(1, max_problems)
        self._events: List[DeviceEvent] = []
        self._problems: List[PipelineProblem] = []
        #: Modeldeki istasyon kimlikleri; eşleme doğrulaması buna bakar.
        self.known_machine_ids: List[str] = []
        #: Makine görüntüleri — Live Factory'nin tek veri kaynağı.
        self.snapshots_by_machine: Dict[str, "MachineSnapshotRecord"] = {}
        #: Görüntü değiştiğinde çağrılır; kalıcılık katmanı buraya bağlanır.
        self.on_snapshot = None
        #: Bir metriği başka bir bağlantının üzerine yazan ölçümler.
        self.overwrites: List[Dict[str, object]] = []

    # -- Okuma --------------------------------------------------------------

    @property
    def events(self) -> List[DeviceEvent]:
        """Saklanan cihaz olayları, eskiden yeniye."""
        return list(self._events)

    @property
    def problems(self) -> List[PipelineProblem]:
        return list(self._problems)

    def recent(self, limit: int = 50, connection_id: Optional[str] = None) -> List[DeviceEvent]:
        """En yeni olaylar; Data Explorer bunu gösterir."""
        source = (
            self._events
            if connection_id is None
            else [event for event in self._events if event.connection_id == connection_id]
        )
        return list(reversed(source[-limit:]))

    def snapshots(self) -> Dict[str, MachineSnapshot]:
        """Pencere içindeki olaylardan hesaplanan görüntüler.

        `snapshots_by_machine` ile karıştırılmamalıdır: bu, **son N olayın**
        özetidir (hız hesabı için zaman serisi gerekir), öteki ise kalıcı son
        durumdur. İkisi ayrı durur çünkü biri pencereye, öteki hafızaya
        dayanır.
        """
        return aggregate(self._events)

    def totals(self):
        return line_totals(self.snapshots())

    def mapping_warnings(self) -> List[MappingWarning]:
        """Eşleşmeyen makineler **ve** çakışan kaynaklar."""
        return [
            *verify_mapping(self._events, self.known_machine_ids),
            *detect_source_conflicts(self._events),
        ]

    # -- Yazma --------------------------------------------------------------

    def dispatch(self, events: Iterable[DeviceEvent], emit: bool = True) -> int:
        """Kullanılabilir olayları yayar; kaç tanesinin geçtiğini döndürür.

        Kullanılamayan olaylar yayımlanmaz ama tanılamaya yazılır. Bir bozuk
        ölçümü ekrana göndermek, ölçüm hiç gelmemesinden daha kötüdür: yanlış
        bir sayı, yokluğun aksine fark edilmez.

        `emit=False` yalnızca **görüntüyü** günceller, olay yaymaz. SALES-13'te
        akış katmanı eklendiğinde bir ölçüm iki kez yayılıyordu: bir kez
        burada, bir kez de sıra numarasını ve protokolü taşıyan akış olayı
        olarak. İki olay aynı ölçümü anlatıyor ama farklı alanlar taşıyordu ve
        ekran hangisini işleyeceğini bilemezdi. Akıştan gelen ölçümlerde yayını
        akış katmanı yapar; buradaki yayın yalnızca eski (akış dışı) yol için
        sürer.
        """
        published = 0
        for event in events:
            if not event.is_usable:
                self.record_problem(
                    PipelineProblem(
                        connection_id=event.connection_id,
                        reason=(
                            f"'{event.machine_id}' için {event.metric.value} değeri "
                            f"kullanılamadı (kalite: {event.quality.value})."
                        ),
                        at_ms=event.at_ms,
                        origin=event.origin,
                        sample=repr(event.value)[:80],
                    )
                )
                continue

            self._events.append(event)
            if len(self._events) > self._max_events:
                del self._events[0 : len(self._events) - self._max_events]

            self._update_snapshot(event)

            if not emit:
                published += 1
                continue

            self._dispatcher.emit(
                connection_id=event.connection_id,
                kind="device_data",
                message=(
                    f"{event.machine_id} · {event.metric.value} = {event.value}"
                    + (f" {event.unit}" if event.unit else "")
                ),
                level=EventLevel.INFO,
                data=event.to_dict(),
                at_ms=event.at_ms,
            )
            published += 1

        return published

    def _update_snapshot(self, event: DeviceEvent) -> None:
        """Ölçümü makine görüntüsüne işler ve kalıcılığa haber verir.

        Başka bir bağlantının yazdığı bir metrik üzerine yazılıyorsa bu
        **kaydedilir**: sessiz üzerine yazma, iki farklı gerçeği tek bir yanlışa
        çevirmek olurdu.
        """
        # Görüntü motoru **çağrı anında** içe aktarılır.
        #
        # `persistence.snapshots` bu paketin veri modelini (`DeviceEvent`)
        # kullanır; modül düzeyinde içe aktarılsaydı iki paket birbirini
        # beklerdi (dairesel içe aktarma) ve uygulama hiç açılmazdı. Python
        # modülleri bir kez yüklediği için bu, sıcak yolda sözlük aramasından
        # ibarettir.
        from simulation_engine.runtime.persistence.snapshots import (
            apply_event,
            conflicting_metrics,
        )

        current = self.snapshots_by_machine.get(event.machine_id)

        if current is not None:
            previous_source = conflicting_metrics(current, event)
            if previous_source is not None:
                self.overwrites.append(
                    {
                        "machine_id": event.machine_id,
                        "metric": event.metric.value,
                        "previous_source": previous_source,
                        "new_source": event.connection_id,
                        "at_ms": event.at_ms,
                    }
                )

        updated = apply_event(current, event)
        self.snapshots_by_machine[event.machine_id] = updated
        if self.on_snapshot is not None:
            self.on_snapshot(updated)

    def load_snapshots(self, snapshots: Dict[str, "MachineSnapshotRecord"]) -> int:
        """Kalıcı görüntüleri belleğe yükler (kurtarma)."""
        self.snapshots_by_machine = dict(snapshots)
        return len(self.snapshots_by_machine)

    def record_problem(self, problem: PipelineProblem) -> None:
        """Bir çeviri sorununu saklar ve tanılama olayı olarak yayar."""
        self._problems.append(problem)
        if len(self._problems) > self._max_problems:
            del self._problems[0 : len(self._problems) - self._max_problems]

        self._dispatcher.emit(
            connection_id=problem.connection_id,
            kind="diagnostic",
            message=problem.reason,
            level=EventLevel.WARNING,
            data=problem.to_dict(),
            at_ms=problem.at_ms,
        )

    def record_problems(self, problems: Iterable[PipelineProblem]) -> int:
        count = 0
        for problem in problems:
            self.record_problem(problem)
            count += 1
        return count

    def ingest(self, result) -> Dict[str, int]:
        """Bir çeviri sonucunu bütün olarak işler."""
        published = self.dispatch(result.events)
        recorded = self.record_problems(result.problems)
        return {"published": published, "problems": recorded}

    def clear(self) -> None:
        self._events.clear()
        self._problems.clear()

    # -- Özet ---------------------------------------------------------------

    def summary(self) -> Dict[str, object]:
        """Data Explorer başlığında görünen özet.

        Hiç veri gelmediyse sayılar sıfırdır ama bu **ölçülmüş** bir sıfırdır:
        "kaç olay geldi" sorusunun yanıtı gerçekten sıfırdır. Metrik değerleri
        için aynı şey geçerli değildir ve onlar `None` kalır.
        """
        totals = self.totals()
        return {
            "device_events": len(self._events),
            "problems": len(self._problems),
            "machines": len(self.snapshots()),
            "mapping_warnings": len(self.mapping_warnings()),
            "production_count": totals.production_count,
            "measured_machines": totals.measured_machines,
            "machines_running": totals.machines_running,
            "machines_down": totals.machines_down,
        }
