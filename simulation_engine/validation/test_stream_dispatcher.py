"""Akışın tek çıkış kapısı: yineleme, dağıtım ve ölçüm.

Bu dosyanın koruduğu dört söz:

1. **Aynı olay iki kez işlenmez.** Yineleme gerçek bir durumdur — yeniden
   bağlanma tamponu yeniden oynatır, kurtarma diskteki olayları yeniden okur.
   Elenmeseydi üretim sayacı gerçeğin iki katı görünürdü.
2. **Bütün alıcılar aynı olayı alır.** Biri alarmı açıp öteki açmazsa iki
   ekran birbirini tutmaz.
3. **Bir alıcının hatası ötekini durdurmaz.** Dolu bir disk, ekrandaki canlı
   veriyi karartmamalı.
4. **Ölçülemeyen ölçüm `None` döner.** Hiç olay akmamış bir akışta olay hızı
   sıfır değil, ölçülmemiştir.
"""

from __future__ import annotations

import pytest

from simulation_engine.runtime.pipeline.device_events import Quality
from simulation_engine.runtime.stream.backpressure import BoundedEventQueue
from simulation_engine.runtime.stream.dispatcher import (
    DEDUP_WINDOW,
    LATENCY_SAMPLES,
    StreamDispatcher,
)
from simulation_engine.runtime.stream.types import DeviceDataEvent, SourceProtocol


def event(sequence: int = 1, **overrides) -> DeviceDataEvent:
    defaults = {
        "connector_id": "c1",
        "machine_id": "TORNA_01",
        "field": "production_count",
        "value": 100,
        "timestamp": 1_000,
        "source_protocol": SourceProtocol.REST,
        "quality": Quality.GOOD,
        "sequence": sequence,
    }
    defaults.update(overrides)
    return DeviceDataEvent(**defaults)


class TestAliciKaydi:
    def test_alici_eklenir(self):
        dispatcher = StreamDispatcher()
        dispatcher.register("a", lambda item: None)
        assert dispatcher.sink_names() == ["a"]

    def test_ayni_ad_ikinci_kez_eklenmez(self):
        """İki kayıt kalsaydı her olay o alıcıya iki kez giderdi."""
        dispatcher = StreamDispatcher()
        dispatcher.register("a", lambda item: None)
        dispatcher.register("a", lambda item: None)
        assert dispatcher.sink_names() == ["a"]

    def test_farkli_adlar_birlikte_durur(self):
        dispatcher = StreamDispatcher()
        dispatcher.register("a", lambda item: None)
        dispatcher.register("b", lambda item: None)
        assert set(dispatcher.sink_names()) == {"a", "b"}

    def test_alici_silinir(self):
        dispatcher = StreamDispatcher()
        dispatcher.register("a", lambda item: None)
        assert dispatcher.unregister("a") is True
        assert dispatcher.sink_names() == []

    def test_olmayan_alici_silinemez(self):
        assert StreamDispatcher().unregister("yok") is False


class TestYinelemeElemesi:
    def test_yeni_olay_kabul_edilir(self):
        assert StreamDispatcher().submit(event()) is True

    def test_ayni_olay_ikinci_kez_reddedilir(self):
        dispatcher = StreamDispatcher()
        dispatcher.submit(event(1))
        assert dispatcher.submit(event(1)) is False

    def test_yineleme_sayilir(self):
        dispatcher = StreamDispatcher()
        dispatcher.submit(event(1))
        dispatcher.submit(event(1))
        dispatcher.submit(event(1))
        assert dispatcher.duplicates == 2

    def test_farkli_sira_kabul_edilir(self):
        dispatcher = StreamDispatcher()
        dispatcher.submit(event(1))
        assert dispatcher.submit(event(2)) is True

    def test_farkli_baglanti_ayni_sira_kabul_edilir(self):
        dispatcher = StreamDispatcher()
        dispatcher.submit(event(1, connector_id="c1"))
        assert dispatcher.submit(event(1, connector_id="c2")) is True

    def test_yineleme_alicilara_gitmez(self):
        dispatcher = StreamDispatcher()
        seen = []
        dispatcher.register("izle", seen.append)
        dispatcher.submit(event(1))
        dispatcher.submit(event(1))
        dispatcher.drain(1_000)
        assert len(seen) == 1

    def test_yineleme_denetimi_sorgulanabilir(self):
        dispatcher = StreamDispatcher()
        dispatcher.submit(event(1))
        assert dispatcher.is_duplicate(event(1)) is True
        assert dispatcher.is_duplicate(event(2)) is False

    def test_toplu_gonderim_sayar(self):
        dispatcher = StreamDispatcher()
        result = dispatcher.submit_many([event(1), event(2), event(1)])
        assert result == {"accepted": 2, "duplicates": 1}

    def test_anahtar_bellegi_sinirlidir(self):
        """Sınırsız olsaydı küme milyonlarca satıra çıkardı."""
        dispatcher = StreamDispatcher(queue=BoundedEventQueue(capacity=5))
        for sequence in range(DEDUP_WINDOW + 100):
            dispatcher.submit(event(sequence + 1))
        assert len(dispatcher._seen) <= DEDUP_WINDOW

    def test_yuz_kez_ayni_olay_tek_kez_islenir(self):
        dispatcher = StreamDispatcher()
        seen = []
        dispatcher.register("izle", seen.append)
        for _ in range(100):
            dispatcher.submit(event(1))
        dispatcher.drain(1_000)
        assert len(seen) == 1


class TestDagitim:
    def test_butun_alicilar_ayni_olayi_alir(self):
        dispatcher = StreamDispatcher()
        first, second = [], []
        dispatcher.register("a", first.append)
        dispatcher.register("b", second.append)
        dispatcher.submit(event())
        dispatcher.drain(1_000)
        assert first == second
        assert len(first) == 1

    def test_tek_cagriyla_gonder_ve_dagit(self):
        dispatcher = StreamDispatcher()
        seen = []
        dispatcher.register("a", seen.append)
        assert dispatcher.dispatch(event(), 1_000) is True
        assert len(seen) == 1

    def test_yinelenen_olay_dagitilmaz(self):
        dispatcher = StreamDispatcher()
        dispatcher.dispatch(event(1), 1_000)
        assert dispatcher.dispatch(event(1), 1_000) is False

    def test_bir_alicinin_hatasi_otekini_durdurmaz(self):
        dispatcher = StreamDispatcher()
        seen = []

        def patlat(item):
            raise RuntimeError("disk dolu")

        dispatcher.register("bozuk", patlat)
        dispatcher.register("saglam", seen.append)
        dispatcher.dispatch(event(), 1_000)
        assert len(seen) == 1

    def test_alici_hatasi_sayilir(self):
        dispatcher = StreamDispatcher()

        def patlat(item):
            raise RuntimeError("disk dolu")

        registration = dispatcher.register("bozuk", patlat)
        dispatcher.dispatch(event(), 1_000)
        assert registration.errors == 1
        assert registration.last_error == "disk dolu"

    def test_basarili_teslim_sayilir(self):
        dispatcher = StreamDispatcher()
        registration = dispatcher.register("a", lambda item: None)
        dispatcher.dispatch(event(1), 1_000)
        dispatcher.dispatch(event(2), 1_000)
        assert registration.delivered == 2

    def test_islenen_olay_sayilir(self):
        dispatcher = StreamDispatcher()
        dispatcher.dispatch(event(1), 1_000)
        dispatcher.dispatch(event(2), 1_000)
        assert dispatcher.processed == 2

    def test_bozuk_kalite_sayilir_ama_dagitilir(self):
        """Bozuk ölçüm alıcılara gider; metriği güncellemeyi alıcı reddeder."""
        dispatcher = StreamDispatcher()
        seen = []
        dispatcher.register("a", seen.append)
        dispatcher.dispatch(event(quality=Quality.BAD), 1_000)
        assert dispatcher.unusable == 1
        assert len(seen) == 1

    def test_sinirli_bosaltma(self):
        dispatcher = StreamDispatcher()
        dispatcher.submit_many([event(1), event(2), event(3)])
        assert len(dispatcher.drain(1_000, limit=2)) == 2

    def test_bos_kuyrukta_bosaltma_bos_doner(self):
        assert StreamDispatcher().drain(1_000) == []


class TestKuyrukBaskisi:
    def test_dolu_kuyrukta_en_eski_duser(self):
        dispatcher = StreamDispatcher(queue=BoundedEventQueue(capacity=2))
        dispatcher.submit_many([event(1), event(2), event(3)])
        remaining = [item.sequence for item in dispatcher.drain(1_000)]
        assert remaining == [2, 3]

    def test_dusurulen_sayilir(self):
        dispatcher = StreamDispatcher(queue=BoundedEventQueue(capacity=1))
        dispatcher.submit_many([event(1), event(2), event(3)])
        assert dispatcher.queue.dropped == 2

    def test_kayip_orani_istatistikte(self):
        dispatcher = StreamDispatcher(queue=BoundedEventQueue(capacity=1))
        dispatcher.submit_many([event(1), event(2)])
        dispatcher.drain(1_000)
        assert dispatcher.stats()["loss_ratio"] == 0.5

    def test_hic_olay_yokken_kayip_orani_none(self):
        assert StreamDispatcher().stats()["loss_ratio"] is None


class TestGecikmeOlcumu:
    def test_gecikme_hesaplanir(self):
        dispatcher = StreamDispatcher()
        dispatcher.dispatch(event(timestamp=1_000), 1_050)
        assert dispatcher.average_latency_ms() == 50.0

    def test_ortalama_alinir(self):
        dispatcher = StreamDispatcher()
        dispatcher.dispatch(event(1, timestamp=1_000), 1_100)
        dispatcher.dispatch(event(2, timestamp=1_000), 1_300)
        assert dispatcher.average_latency_ms() == 200.0

    def test_en_yuksek_gecikme_ayri_tutulur(self):
        dispatcher = StreamDispatcher()
        dispatcher.dispatch(event(1, timestamp=1_000), 1_100)
        dispatcher.dispatch(event(2, timestamp=1_000), 1_500)
        assert dispatcher.max_latency_ms() == 500.0

    def test_hic_olay_yokken_none(self):
        assert StreamDispatcher().average_latency_ms() is None

    def test_negatif_gecikme_olcum_sayilmaz(self):
        """Cihaz saati ileriyse gecikme uydurulmaz, atlanır."""
        dispatcher = StreamDispatcher()
        dispatcher.dispatch(event(timestamp=5_000), 1_000)
        assert dispatcher.average_latency_ms() is None

    def test_ornek_sayisi_sinirlidir(self):
        dispatcher = StreamDispatcher()
        for sequence in range(LATENCY_SAMPLES + 50):
            dispatcher.dispatch(event(sequence + 1, timestamp=1_000), 1_100)
        assert len(dispatcher._latencies) == LATENCY_SAMPLES


class TestOlayHizi:
    def test_tek_olayda_hesaplanmaz(self):
        dispatcher = StreamDispatcher()
        dispatcher.dispatch(event(1), 1_000)
        assert dispatcher.events_per_second() is None

    def test_kisa_pencerede_hesaplanmaz(self):
        """Bir saniyeden kısa pencereden hız çıkarmak tahmin olurdu."""
        dispatcher = StreamDispatcher()
        dispatcher.dispatch(event(1), 1_000)
        dispatcher.dispatch(event(2), 1_500)
        assert dispatcher.events_per_second() is None

    def test_uzun_pencerede_hesaplanir(self):
        dispatcher = StreamDispatcher()
        dispatcher.dispatch(event(1), 1_000)
        dispatcher.dispatch(event(2), 3_000)
        assert dispatcher.events_per_second() == pytest.approx(1.0)

    def test_hic_olay_yokken_none(self):
        assert StreamDispatcher().events_per_second() is None


class TestIstatistikler:
    def test_butun_alanlar_yazilir(self):
        payload = StreamDispatcher().stats()
        assert set(payload) == {
            "processed",
            "duplicates",
            "unusable",
            "dropped",
            "queue",
            "events_per_second",
            "avg_latency_ms",
            "max_latency_ms",
            "loss_ratio",
            "sinks",
        }

    def test_alici_sayaclari_yazilir(self):
        dispatcher = StreamDispatcher()
        dispatcher.register("a", lambda item: None)
        dispatcher.dispatch(event(), 1_000)
        assert dispatcher.stats()["sinks"][0]["delivered"] == 1

    def test_temizleme_sayaclari_sifirlar(self):
        dispatcher = StreamDispatcher()
        dispatcher.dispatch(event(), 1_000)
        dispatcher.clear()
        assert dispatcher.processed == 0
        assert dispatcher.duplicates == 0

    def test_temizleme_alicilari_korur(self):
        dispatcher = StreamDispatcher()
        dispatcher.register("a", lambda item: None)
        dispatcher.clear()
        assert dispatcher.sink_names() == ["a"]

    def test_temizleme_sonrasi_ayni_olay_yeniden_kabul_edilir(self):
        dispatcher = StreamDispatcher()
        dispatcher.submit(event(1))
        dispatcher.clear()
        assert dispatcher.submit(event(1)) is True
