"""Olay tamponu, SSE biçimi ve dağıtım."""

from __future__ import annotations

import asyncio
import json

from simulation_engine.runtime.events import (
    MAX_EVENTS,
    EventBuffer,
    EventDispatcher,
    Subscriber,
    format_sse,
    sse_comment,
)
from simulation_engine.runtime.types import EventLevel


class TestEventBuffer:
    def test_bos_tampon_uzunlugu_sifir(self):
        assert len(EventBuffer()) == 0

    def test_varsayilan_kapasite_bin(self):
        # Sprint sozlesmesi: son 1000 olay.
        assert MAX_EVENTS == 1_000
        assert EventBuffer().capacity == 1_000

    def test_olay_eklenir(self):
        buffer = EventBuffer()
        buffer.append("c1", "probe", "denendi")
        assert len(buffer) == 1

    def test_sira_numarasi_birden_baslar(self):
        buffer = EventBuffer()
        assert buffer.append("c1", "probe", "x").sequence == 1

    def test_sira_numarasi_artar(self):
        buffer = EventBuffer()
        buffer.append("c1", "probe", "x")
        assert buffer.append("c1", "probe", "y").sequence == 2

    def test_sira_numarasi_tampon_tasinca_da_artar(self):
        # Numara bir kimliktir; tampon tasinca yeniden kullanilamaz.
        buffer = EventBuffer(capacity=2)
        for index in range(5):
            buffer.append("c1", "probe", str(index))
        assert buffer.last().sequence == 5

    def test_kapasite_asilinca_en_eski_duser(self):
        buffer = EventBuffer(capacity=3)
        for index in range(5):
            buffer.append("c1", "probe", str(index))
        assert len(buffer) == 3
        assert [event.message for event in buffer.all()] == ["2", "3", "4"]

    def test_sifir_kapasite_bire_cekilir(self):
        buffer = EventBuffer(capacity=0)
        buffer.append("c1", "probe", "x")
        assert len(buffer) == 1

    def test_seviye_varsayilani_bilgi(self):
        assert EventBuffer().append("c1", "probe", "x").level is EventLevel.INFO

    def test_seviye_verilebilir(self):
        event = EventBuffer().append("c1", "probe", "x", level=EventLevel.CRITICAL)
        assert event.level is EventLevel.CRITICAL

    def test_veri_alani_kopyalanir(self):
        veri = {"latency_ms": 5}
        event = EventBuffer().append("c1", "probe", "x", data=veri)
        veri["latency_ms"] = 999
        assert event.data["latency_ms"] == 5

    def test_zaman_disaridan_verilebilir(self):
        event = EventBuffer().append("c1", "probe", "x", at_ms=1_700)
        assert event.at_ms == 1_700

    def test_zaman_verilmezse_uretilir(self):
        assert EventBuffer().append("c1", "probe", "x").at_ms > 0

    def test_since_sonraki_olaylari_verir(self):
        buffer = EventBuffer()
        for index in range(5):
            buffer.append("c1", "probe", str(index))
        assert [event.message for event in buffer.since(3)] == ["3", "4"]

    def test_since_sifir_hepsini_verir(self):
        buffer = EventBuffer()
        buffer.append("c1", "probe", "x")
        assert len(buffer.since(0)) == 1

    def test_since_gelecekteki_numara_bos_doner(self):
        buffer = EventBuffer()
        buffer.append("c1", "probe", "x")
        assert buffer.since(99) == []

    def test_baglantiya_gore_suzer(self):
        buffer = EventBuffer()
        buffer.append("c1", "probe", "a")
        buffer.append("c2", "probe", "b")
        assert [e.message for e in buffer.for_connection("c2")] == ["b"]

    def test_son_olay_doner(self):
        buffer = EventBuffer()
        buffer.append("c1", "probe", "a")
        buffer.append("c1", "probe", "b")
        assert buffer.last().message == "b"

    def test_bos_tamponda_son_olay_none(self):
        assert EventBuffer().last() is None

    def test_tasma_yoksa_dropped_before_none(self):
        buffer = EventBuffer(capacity=5)
        buffer.append("c1", "probe", "a")
        assert buffer.dropped_before() is None

    def test_tasma_varsa_kayip_numarasi_bildirilir(self):
        # Istemci eksik araligi sessizce atlamamali.
        buffer = EventBuffer(capacity=2)
        for index in range(5):
            buffer.append("c1", "probe", str(index))
        # Kapasite 2: 1-5 numarali olaylardan 4 ve 5 kaldi, 3'e kadari kayip.
        assert buffer.dropped_before() == 3

    def test_temizleme_tamponu_bosaltir(self):
        buffer = EventBuffer()
        buffer.append("c1", "probe", "x")
        buffer.clear()
        assert len(buffer) == 0

    def test_olay_sozluge_cevrilir(self):
        event = EventBuffer().append("c1", "probe", "merhaba", data={"a": 1})
        payload = event.to_dict()
        assert payload["connection_id"] == "c1"
        assert payload["message"] == "merhaba"
        assert payload["data"] == {"a": 1}
        assert payload["level"] == "info"


class TestSseFormat:
    def test_cerceve_bos_satirla_biter(self):
        # Tek satir sonuyla biten cerceve bir sonrakiyle birlesir.
        event = EventBuffer().append("c1", "probe", "x")
        assert format_sse(event).endswith("\n\n")

    def test_id_alani_sira_numarasidir(self):
        event = EventBuffer().append("c1", "probe", "x")
        assert format_sse(event).startswith(f"id: {event.sequence}\n")

    def test_event_alani_turdur(self):
        event = EventBuffer().append("c1", "retry", "x")
        assert "event: retry\n" in format_sse(event)

    def test_data_alani_gecerli_json(self):
        event = EventBuffer().append("c1", "probe", "x", data={"latency_ms": 4})
        line = [
            satir for satir in format_sse(event).split("\n") if satir.startswith("data: ")
        ][0]
        payload = json.loads(line[len("data: ") :])
        assert payload["data"]["latency_ms"] == 4

    def test_turkce_karakterler_bozulmaz(self):
        event = EventBuffer().append("c1", "probe", "bağlantı doğrulandı")
        assert "bağlantı doğrulandı" in format_sse(event)

    def test_yorum_satiri_iki_nokta_ile_baslar(self):
        assert sse_comment("bekleniyor").startswith(": ")

    def test_yorum_satiri_bos_satirla_biter(self):
        assert sse_comment("x").endswith("\n\n")


class TestSubscriber:
    def test_kuyruk_dolmadan_kabul_eder(self):
        buffer = EventBuffer()
        subscriber = Subscriber(queue_size=2)
        assert subscriber.offer(buffer.append("c1", "probe", "a")) is True

    def test_kuyruk_dolunca_atilan_sayilir(self):
        buffer = EventBuffer()
        subscriber = Subscriber(queue_size=1)
        subscriber.offer(buffer.append("c1", "probe", "a"))
        subscriber.offer(buffer.append("c1", "probe", "b"))
        assert subscriber.dropped == 1

    def test_kuyruk_dolunca_en_yeni_olay_kalir(self):
        # Izleme akisinda en yeni durum, en eskisinden degerlidir.
        buffer = EventBuffer()
        subscriber = Subscriber(queue_size=1)
        subscriber.offer(buffer.append("c1", "probe", "eski"))
        subscriber.offer(buffer.append("c1", "probe", "yeni"))
        assert subscriber.queue.get_nowait().message == "yeni"

    def test_kuyruk_sinirsiz_buyumez(self):
        buffer = EventBuffer()
        subscriber = Subscriber(queue_size=3)
        for index in range(50):
            subscriber.offer(buffer.append("c1", "probe", str(index)))
        assert subscriber.queue.qsize() <= 3


class TestDispatcher:
    def test_baslangicta_abone_yok(self):
        assert EventDispatcher().subscriber_count == 0

    def test_abone_eklenir(self):
        dispatcher = EventDispatcher()
        dispatcher.subscribe()
        assert dispatcher.subscriber_count == 1

    def test_abone_silinir(self):
        dispatcher = EventDispatcher()
        subscriber = dispatcher.subscribe()
        dispatcher.unsubscribe(subscriber)
        assert dispatcher.subscriber_count == 0

    def test_olmayan_abonenin_silinmesi_hata_vermez(self):
        dispatcher = EventDispatcher()
        dispatcher.unsubscribe(Subscriber())
        assert dispatcher.subscriber_count == 0

    def test_emit_tampona_yazar(self):
        dispatcher = EventDispatcher()
        dispatcher.emit("c1", "probe", "x")
        assert len(dispatcher.buffer) == 1

    def test_emit_abonelere_dagitir(self):
        dispatcher = EventDispatcher()
        subscriber = dispatcher.subscribe()
        dispatcher.emit("c1", "probe", "merhaba")
        assert subscriber.queue.get_nowait().message == "merhaba"

    def test_emit_tum_abonelere_gider(self):
        dispatcher = EventDispatcher()
        birinci = dispatcher.subscribe()
        ikinci = dispatcher.subscribe()
        dispatcher.emit("c1", "probe", "x")
        assert birinci.queue.qsize() == 1
        assert ikinci.queue.qsize() == 1

    def test_abone_yokken_emit_calisir(self):
        dispatcher = EventDispatcher()
        event = dispatcher.emit("c1", "probe", "x")
        assert event.sequence == 1

    def test_emit_uretilen_olayi_dondurur(self):
        dispatcher = EventDispatcher()
        assert dispatcher.emit("c1", "probe", "x").connection_id == "c1"

    def test_dis_tampon_verilebilir(self):
        buffer = EventBuffer(capacity=2)
        dispatcher = EventDispatcher(buffer=buffer)
        dispatcher.emit("c1", "probe", "x")
        assert len(buffer) == 1


class TestReplay:
    def test_replay_tampondaki_olaylari_verir(self):
        dispatcher = EventDispatcher()
        dispatcher.emit("c1", "probe", "a")
        dispatcher.emit("c1", "probe", "b")
        assert len(dispatcher.replay()) == 2

    def test_replay_belirli_numaradan_sonrasini_verir(self):
        dispatcher = EventDispatcher()
        dispatcher.emit("c1", "probe", "a")
        dispatcher.emit("c1", "probe", "b")
        assert [e.message for e in dispatcher.replay(since=1)] == ["b"]

    def test_replay_baglantiya_gore_suzer(self):
        dispatcher = EventDispatcher()
        dispatcher.emit("c1", "probe", "a")
        dispatcher.emit("c2", "probe", "b")
        assert [e.connection_id for e in dispatcher.replay(connection_id="c2")] == ["c2"]

    def test_bos_tamponda_replay_uydurmaz(self):
        # Gercek veri yoksa replay bos doner; olay uretmez.
        assert EventDispatcher().replay() == []

    def test_replay_gercek_veriyi_kullanir(self):
        dispatcher = EventDispatcher()
        dispatcher.emit("c1", "data", "42", data={"value": 42})
        assert dispatcher.replay()[0].data["value"] == 42


class TestQueueIntegration:
    def test_abone_kuyrugu_asenkron_okunur(self):
        async def senaryo():
            dispatcher = EventDispatcher()
            subscriber = dispatcher.subscribe()
            dispatcher.emit("c1", "probe", "asenkron")
            event = await asyncio.wait_for(subscriber.queue.get(), timeout=1)
            return event.message

        assert asyncio.run(senaryo()) == "asenkron"


class TestResumeFrom:
    """Numaralandırmanın yeniden başlatmayı aşması.

    Testte görüldü: sunucu yeniden başladığında tampon 1'den başlıyor ve
    kalıcı günlükteki numaralarla çakışıyordu.
    """

    def test_baslangicta_sonraki_numara_bir(self):
        assert EventBuffer().next_sequence == 1

    def test_surdurme_numarayi_ileri_alir(self):
        buffer = EventBuffer()
        buffer.resume_from(42)
        assert buffer.next_sequence == 43

    def test_surdurmeden_sonra_olay_dogru_numara_alir(self):
        buffer = EventBuffer()
        buffer.resume_from(42)
        assert buffer.append("c1", "probe", "x").sequence == 43

    def test_numara_geriye_alinmaz(self):
        buffer = EventBuffer()
        buffer.append("c1", "probe", "x")
        buffer.append("c1", "probe", "y")
        buffer.resume_from(1)
        assert buffer.next_sequence == 3

    def test_sifirdan_surdurme_degistirmez(self):
        buffer = EventBuffer()
        buffer.resume_from(0)
        assert buffer.next_sequence == 1


class TestEmitHook:
    """Her olayda çağrılan kanca; kalıcılık buraya bağlanır."""

    def test_baslangicta_kanca_yok(self):
        assert EventDispatcher().on_emit is None

    def test_kanca_her_olayda_cagrilir(self):
        dispatcher = EventDispatcher()
        seen = []
        dispatcher.on_emit = seen.append
        dispatcher.emit("c1", "probe", "x")
        dispatcher.emit("c1", "device_data", "y")
        assert len(seen) == 2

    def test_kanca_olayin_kendisini_alir(self):
        dispatcher = EventDispatcher()
        seen = []
        dispatcher.on_emit = seen.append
        dispatcher.emit("c1", "probe", "merhaba")
        assert seen[0].message == "merhaba"

    def test_kanca_abonelerden_sonra_calisir(self):
        dispatcher = EventDispatcher()
        subscriber = dispatcher.subscribe()
        order = []
        dispatcher.on_emit = lambda event: order.append(subscriber.queue.qsize())
        dispatcher.emit("c1", "probe", "x")
        # Kanca cagrildiginda olay abonenin kuyrugunda olmali.
        assert order == [1]
