"""REST yoklama motoru.

Bu dosyanın koruduğu davranışlar:

* Yoklama gerçek bir yanıtı olaya çevirir ve sıra numarasını **kaynağında**
  verir; dağıtıcıda verilseydi yineleme denetimi işe yaramazdı.
* Hata döngüyü durdurmaz; aralık büyür ve sonraki tur denenir.
* Görevin ayakta olması "çalışıyor" demek değildir: veri gelmediyse durum
  `IDLE`'dır.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from simulation_engine.runtime.pipeline.transformers import MappingTable, MetricMapping
from simulation_engine.runtime.pipeline.device_events import Metric
from simulation_engine.runtime.stream.backpressure import BoundedEventQueue
from simulation_engine.runtime.stream.dispatcher import StreamDispatcher
from simulation_engine.runtime.stream.poller import PollOutcome, RestPoller, usable_events
from simulation_engine.runtime.stream.scheduler import StreamHealth
from simulation_engine.runtime.stream.types import SequenceCounter
from simulation_engine.runtime.types import ConnectionKind, ConnectionSpec

NOW = 1_000_000


def spec(connection_id: str = "c1") -> ConnectionSpec:
    return ConnectionSpec(
        connection_id=connection_id,
        kind=ConnectionKind.REST,
        label="TORNA_01",
        endpoint="http://127.0.0.1:9/veri",
    )


def body(**values) -> str:
    return json.dumps(values or {"production_count": 100, "queue_length": 3})


def make_poller(fetch=None, **overrides) -> RestPoller:
    defaults = {
        "spec": spec(),
        "fetch": fetch if fetch is not None else (lambda: body()),
        "dispatcher": StreamDispatcher(),
        "sequences": SequenceCounter(),
        "clock": lambda: NOW,
    }
    defaults.update(overrides)
    return RestPoller(**defaults)


def run(coro):
    return asyncio.run(coro)


class TestKurulum:
    def test_varsayilan_aralik_uygulanir(self):
        assert make_poller().interval_ms == 1_000

    def test_cok_kisa_aralik_sinirlanir(self):
        assert make_poller(interval_ms=10).interval_ms == 250

    def test_cok_uzun_aralik_sinirlanir(self):
        assert make_poller(interval_ms=600_000).interval_ms == 60_000

    def test_plana_kaydedilir(self):
        poller = make_poller()
        assert "c1" in poller.scheduler.entries

    def test_baglanti_kimligi_okunur(self):
        assert make_poller().connector_id == "c1"

    def test_baslangicta_calismiyor(self):
        assert make_poller().running is False

    def test_baslangicta_veri_yok(self):
        assert make_poller().first_data_at_ms is None


class TestTekYoklama:
    def test_yanit_olaya_cevrilir(self):
        poller = make_poller()
        outcome = run(poller.poll_once(NOW))
        assert outcome.ok is True
        assert outcome.events == 2

    def test_olaylar_dagiticiya_gider(self):
        poller = make_poller()
        run(poller.poll_once(NOW))
        assert poller.dispatcher.queue.depth == 2

    def test_sira_numaralari_artar(self):
        poller = make_poller()
        run(poller.poll_once(NOW))
        events = poller.dispatcher.drain(NOW)
        assert [item.sequence for item in events] == [1, 2]

    def test_ikinci_yoklama_devam_eder(self):
        poller = make_poller()
        run(poller.poll_once(NOW))
        run(poller.poll_once(NOW + 1_000))
        events = poller.dispatcher.drain(NOW + 1_000)
        assert [item.sequence for item in events] == [1, 2, 3, 4]

    def test_ilk_veri_ani_kaydedilir(self):
        poller = make_poller()
        run(poller.poll_once(NOW))
        assert poller.first_data_at_ms == NOW

    def test_son_veri_ani_gunceller(self):
        poller = make_poller()
        run(poller.poll_once(NOW))
        run(poller.poll_once(NOW + 5_000))
        assert poller.last_data_at_ms == NOW + 5_000

    def test_protokol_rest_olarak_isaretlenir(self):
        poller = make_poller()
        run(poller.poll_once(NOW))
        assert poller.dispatcher.drain(NOW)[0].source_protocol.value == "rest"

    def test_zaman_damgasi_yoklama_ani(self):
        poller = make_poller()
        run(poller.poll_once(NOW))
        assert poller.dispatcher.drain(NOW)[0].timestamp == NOW

    def test_bos_yanit_olay_uretmez(self):
        poller = make_poller(fetch=lambda: json.dumps({}))
        outcome = run(poller.poll_once(NOW))
        assert outcome.events == 0

    def test_veri_gelmezse_ilk_veri_ani_bos_kalir(self):
        poller = make_poller(fetch=lambda: json.dumps({}))
        run(poller.poll_once(NOW))
        assert poller.first_data_at_ms is None

    def test_asenkron_fetch_desteklenir(self):
        async def fetch():
            return body()

        poller = make_poller(fetch=fetch)
        assert run(poller.poll_once(NOW)).events == 2

    def test_esleme_tablosu_uygulanir(self):
        mapping = MappingTable(
            entries=[
                MetricMapping(
                    origin="adet",
                    machine_id="FREZE_01",
                    metric=Metric.PRODUCTION_COUNT,
                )
            ]
        )
        poller = make_poller(
            fetch=lambda: json.dumps({"adet": 55}), mapping=mapping
        )
        run(poller.poll_once(NOW))
        event = poller.dispatcher.drain(NOW)[0]
        assert event.machine_id == "FREZE_01"
        assert event.value == 55


class TestHataDavranisi:
    def _patlayan(self):
        def fetch():
            raise ConnectionError("uc kapali")

        return fetch

    def test_hata_yakalanir(self):
        poller = make_poller(fetch=self._patlayan())
        outcome = run(poller.poll_once(NOW))
        assert outcome.ok is False
        assert outcome.error == "uc kapali"

    def test_hata_olay_uretmez(self):
        poller = make_poller(fetch=self._patlayan())
        run(poller.poll_once(NOW))
        assert poller.dispatcher.queue.depth == 0

    def test_hata_araligi_buyutur(self):
        poller = make_poller(fetch=self._patlayan())
        run(poller.poll_once(NOW))
        assert poller.scheduler.entries["c1"].current_interval_ms == 2_000

    def test_art_arda_hata_birikir(self):
        poller = make_poller(fetch=self._patlayan())
        run(poller.poll_once(NOW))
        run(poller.poll_once(NOW))
        assert poller.scheduler.entries["c1"].consecutive_failures == 2

    def test_basari_geri_cekilmeyi_sifirlar(self):
        calls = {"n": 0}

        def fetch():
            calls["n"] += 1
            if calls["n"] == 1:
                raise ConnectionError("gecici")
            return body()

        poller = make_poller(fetch=fetch)
        run(poller.poll_once(NOW))
        run(poller.poll_once(NOW))
        assert poller.scheduler.entries["c1"].consecutive_failures == 0

    def test_gecersiz_yanit_sorun_uretir(self):
        poller = make_poller(fetch=lambda: "bu json degil")
        outcome = run(poller.poll_once(NOW))
        assert outcome.ok is True
        assert outcome.problems >= 1

    def test_sonuclar_sinirlanir(self):
        poller = make_poller()
        for step in range(60):
            run(poller.poll_once(NOW + step))
        assert len(poller.outcomes) == 50


class TestDongu:
    def test_dongu_belirli_tur_kadar_calisir(self):
        poller = make_poller(sleep=lambda seconds: asyncio.sleep(0))
        run(poller.run(max_cycles=3))
        assert len(poller.outcomes) == 3

    def test_dongu_sonunda_durur(self):
        poller = make_poller(sleep=lambda seconds: asyncio.sleep(0))
        run(poller.run(max_cycles=1))
        assert poller.running is False

    def test_dongu_olaylari_dagitir(self):
        poller = make_poller(sleep=lambda seconds: asyncio.sleep(0))
        seen = []
        poller.dispatcher.register("izle", seen.append)
        run(poller.run(max_cycles=2))
        assert len(seen) == 4

    def test_durdurma_dongunun_disina_cikarir(self):
        poller = make_poller(sleep=lambda seconds: asyncio.sleep(0))
        poller.stop()
        run(poller.run(max_cycles=5))
        assert poller.outcomes == []


class TestSaglikDurumu:
    def test_calismayan_akis_durduruldu(self):
        assert make_poller().health is StreamHealth.STOPPED

    def test_veri_gelmeden_bekleniyor(self):
        """Açık bir görev, akan veri demek değildir."""
        poller = make_poller(fetch=lambda: json.dumps({}))
        poller.running = True
        run(poller.poll_once(NOW))
        assert poller.health is StreamHealth.IDLE

    def test_veri_gelince_calisiyor(self):
        poller = make_poller()
        poller.running = True
        run(poller.poll_once(NOW))
        assert poller.health is StreamHealth.RUNNING

    def test_hata_alan_akis_isaretlenir(self):
        poller = make_poller(fetch=lambda: (_ for _ in ()).throw(OSError("kapali")))
        poller.running = True
        run(poller.poll_once(NOW))
        assert poller.health is StreamHealth.FAILING

    def test_dolu_kuyruk_baski_bildirir(self):
        dispatcher = StreamDispatcher(queue=BoundedEventQueue(capacity=2))
        poller = make_poller(dispatcher=dispatcher)
        poller.running = True
        run(poller.poll_once(NOW))
        assert poller.health is StreamHealth.BACKPRESSURE

    def test_durum_sozlugu_iki_kimlik_tasir(self):
        state = make_poller().state()
        assert state["connector_id"] == "c1"
        assert state["connection_id"] == "c1"

    def test_durum_sozlugu_plani_tasir(self):
        assert make_poller().state()["schedule"]["poll_rate_hz"] == 1.0

    def test_durum_sozlugu_son_sonucu_tasir(self):
        poller = make_poller()
        run(poller.poll_once(NOW))
        assert poller.state()["last_outcome"]["events"] == 2


class TestYardimcilar:
    def test_kullanilabilir_olaylar_suzulur(self):
        poller = make_poller()
        run(poller.poll_once(NOW))
        events = poller.dispatcher.drain(NOW)
        assert len(usable_events(events)) == 2

    def test_sonuc_sozlugu_alanlari(self):
        outcome = PollOutcome(connector_id="c1", at_ms=NOW, ok=True)
        assert set(outcome.to_dict()) == {
            "connector_id",
            "at_ms",
            "ok",
            "events",
            "accepted",
            "duplicates",
            "problems",
            "error",
        }
