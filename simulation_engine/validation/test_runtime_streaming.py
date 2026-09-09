"""Akış koşucuları: OPC UA aboneliği, MQTT dinleme, REST yoklama.

Koşucular sahte kaynaklarla sınanır: amaç döngü kararlarını (aralık, backoff,
durum ölçümü) doğrulamaktır. Gerçek protokollerle yapılan doğrulama
`test_runtime_device_flow.py` içindedir.
"""

from __future__ import annotations

import asyncio

from simulation_engine.runtime.pipeline.device_events import Metric, Quality
from simulation_engine.runtime.pipeline.transformers import MappingTable, MetricMapping
from simulation_engine.runtime.streaming import (
    DEFAULT_POLL_INTERVAL_MS,
    MAX_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
    MqttStreamRunner,
    OpcUaSubscriptionRunner,
    RestPollingRunner,
    StreamRegistry,
    StreamState,
    backoff_interval_ms,
    note_failure,
    note_payload,
    poll_interval_ms,
)
from simulation_engine.runtime.types import ConnectionKind, ConnectionSpec


def spec(kind=ConnectionKind.REST, **overrides) -> ConnectionSpec:
    base = dict(
        connection_id="c1",
        kind=kind,
        label="Hat 1",
        endpoint="http://127.0.0.1:9/veri",
    )
    base.update(overrides)
    return ConnectionSpec(**base)


def collect():
    """Koşucudan gelen sonuçları biriktiren geri çağrı."""
    results = []

    def handle(result, at_ms):
        results.append((result, at_ms))

    return results, handle


class TestPollInterval:
    def test_varsayilan_bes_saniye(self):
        assert poll_interval_ms(None) == DEFAULT_POLL_INTERVAL_MS

    def test_normal_deger_korunur(self):
        assert poll_interval_ms(2_000) == 2_000

    def test_cok_kisa_aralik_yukseltilir(self):
        # Saniyede besten fazla yoklama cogu MES'te kotuye kullanim sayilir.
        assert poll_interval_ms(10) == MIN_POLL_INTERVAL_MS

    def test_cok_uzun_aralik_kirpilir(self):
        assert poll_interval_ms(9_999_999) == MAX_POLL_INTERVAL_MS

    def test_metin_varsayilana_duser(self):
        assert poll_interval_ms("abc") == DEFAULT_POLL_INTERVAL_MS


class TestBackoff:
    def test_basarida_taban_aralik(self):
        assert backoff_interval_ms(1_000, 0) == 1_000

    def test_ilk_basarisizlikta_artar(self):
        assert backoff_interval_ms(1_000, 1) > 1_000

    def test_ard_arda_basarisizlikta_katlanir(self):
        birinci = backoff_interval_ms(1_000, 1)
        ikinci = backoff_interval_ms(1_000, 2)
        assert ikinci > birinci

    def test_tavan_asilmaz(self):
        assert backoff_interval_ms(1_000, 50) <= MAX_POLL_INTERVAL_MS

    def test_taban_altina_dusmez(self):
        assert backoff_interval_ms(5_000, 1) >= 5_000


class TestStreamState:
    def test_baslangicta_veri_yok(self):
        state = StreamState(connection_id="c1", kind="rest")
        assert state.has_data is False
        assert state.first_data_at_ms is None

    def test_veri_gelince_isaretlenir(self):
        state = StreamState(connection_id="c1", kind="rest")

        class Result:
            usable_events = [object()]
            problems = []

        note_payload(state, 1_000, Result())
        assert state.has_data is True
        assert state.first_data_at_ms == 1_000

    def test_bos_yuk_veri_sayilmaz(self):
        # Yuk geldi ama olcum cikmadi: akis hala "veri bekleniyor" durumunda.
        state = StreamState(connection_id="c1", kind="rest")

        class Result:
            usable_events = []
            problems = [object()]

        note_payload(state, 1_000, Result())
        assert state.has_data is False
        assert state.payloads == 1
        assert state.problems == 1

    def test_ilk_veri_ani_degismez(self):
        state = StreamState(connection_id="c1", kind="rest")

        class Result:
            usable_events = [object()]
            problems = []

        note_payload(state, 1_000, Result())
        note_payload(state, 5_000, Result())
        assert state.first_data_at_ms == 1_000
        assert state.last_data_at_ms == 5_000

    def test_basarisizlik_sayaci_artar(self):
        state = StreamState(connection_id="c1", kind="rest")
        note_failure(state, "kapali")
        note_failure(state, "kapali")
        assert state.consecutive_failures == 2
        assert state.last_error == "kapali"

    def test_basari_sayaci_sifirlar(self):
        state = StreamState(connection_id="c1", kind="rest")
        note_failure(state, "kapali")

        class Result:
            usable_events = [object()]
            problems = []

        note_payload(state, 1_000, Result())
        assert state.consecutive_failures == 0

    def test_sozluge_cevrilir(self):
        payload = StreamState(connection_id="c1", kind="mqtt").to_dict()
        assert payload["kind"] == "mqtt"
        assert payload["has_data"] is False
        assert payload["first_data_at_ms"] is None


class TestRestPolling:
    def test_yoklama_veri_uretir(self):
        results, handle = collect()
        runner = RestPollingRunner(
            spec=spec(),
            fetch=lambda: b'{"production_count": 5}',
            on_result=handle,
            sleep=lambda seconds: asyncio.sleep(0),
            clock=lambda: 1_000,
        )
        asyncio.run(runner.run(max_cycles=1))
        assert len(results) == 1
        assert results[0][0].events[0].value == 5

    def test_birden_cok_dongu_calisir(self):
        results, handle = collect()
        runner = RestPollingRunner(
            spec=spec(),
            fetch=lambda: b'{"adet": 1}',
            on_result=handle,
            sleep=lambda seconds: asyncio.sleep(0),
        )
        asyncio.run(runner.run(max_cycles=3))
        assert len(results) == 3

    def test_hata_dongusu_durdurmaz(self):
        calls = {"n": 0}

        def fetch():
            calls["n"] += 1
            if calls["n"] == 1:
                raise ConnectionError("kapali")
            return b'{"adet": 2}'

        results, handle = collect()
        runner = RestPollingRunner(
            spec=spec(), fetch=fetch, on_result=handle, sleep=lambda s: asyncio.sleep(0)
        )
        state = asyncio.run(runner.run(max_cycles=2))
        assert len(results) == 1
        assert state.payloads == 1

    def test_hata_sayaci_islenir(self):
        def fetch():
            raise ConnectionError("kapali")

        _, handle = collect()
        runner = RestPollingRunner(
            spec=spec(), fetch=fetch, on_result=handle, sleep=lambda s: asyncio.sleep(0)
        )
        state = asyncio.run(runner.run(max_cycles=2))
        assert state.consecutive_failures == 2
        assert state.last_error == "kapali"

    def test_basarida_sayac_sifirlanir(self):
        calls = {"n": 0}

        def fetch():
            calls["n"] += 1
            if calls["n"] == 1:
                raise ConnectionError("kapali")
            return b'{"adet": 2}'

        _, handle = collect()
        runner = RestPollingRunner(
            spec=spec(), fetch=fetch, on_result=handle, sleep=lambda s: asyncio.sleep(0)
        )
        state = asyncio.run(runner.run(max_cycles=2))
        assert state.consecutive_failures == 0

    def test_bekleme_suresi_backoff_ile_buyur(self):
        beklemeler = []

        async def sleep(seconds):
            beklemeler.append(seconds)

        def fetch():
            raise ConnectionError("kapali")

        _, handle = collect()
        runner = RestPollingRunner(
            spec=spec(),
            fetch=fetch,
            on_result=handle,
            interval_ms=1_000,
            sleep=sleep,
        )
        asyncio.run(runner.run(max_cycles=3))
        assert beklemeler[1] > beklemeler[0]

    def test_esleme_tablosu_kullanilir(self):
        table = MappingTable(
            entries=[
                MetricMapping(origin="x", machine_id="TORNA", metric=Metric.QUEUE_LENGTH)
            ]
        )
        results, handle = collect()
        runner = RestPollingRunner(
            spec=spec(),
            fetch=lambda: b'{"x": 3}',
            on_result=handle,
            mapping=table,
            sleep=lambda s: asyncio.sleep(0),
        )
        asyncio.run(runner.run(max_cycles=1))
        assert results[0][0].events[0].machine_id == "TORNA"

    def test_asenkron_fetch_desteklenir(self):
        async def fetch():
            return b'{"adet": 7}'

        results, handle = collect()
        runner = RestPollingRunner(
            spec=spec(), fetch=fetch, on_result=handle, sleep=lambda s: asyncio.sleep(0)
        )
        asyncio.run(runner.run(max_cycles=1))
        assert results[0][0].events[0].value == 7

    def test_durdurma_dongusu_bitirir(self):
        async def senaryo():
            _, handle = collect()
            runner = RestPollingRunner(
                spec=spec(),
                fetch=lambda: b'{"adet": 1}',
                on_result=handle,
                sleep=lambda s: asyncio.sleep(0),
            )
            runner.stop()
            return await runner.run()

        state = asyncio.run(senaryo())
        assert state.running is False
        assert state.payloads == 0


class TestMqttStreaming:
    def _messages(self, items):
        async def generator():
            for item in items:
                yield item

        return generator

    def test_mesajlar_olaya_cevrilir(self):
        results, handle = collect()
        runner = MqttStreamRunner(
            spec=spec(ConnectionKind.MQTT),
            messages=self._messages([("fab/torna", b'{"adet": 5}')]),
            on_result=handle,
            clock=lambda: 1_000,
        )
        asyncio.run(runner.run())
        assert results[0][0].events[0].machine_id == "torna"

    def test_birden_cok_mesaj_islenir(self):
        results, handle = collect()
        runner = MqttStreamRunner(
            spec=spec(ConnectionKind.MQTT),
            messages=self._messages(
                [("fab/torna", b'{"adet": 1}'), ("fab/kaynak", b'{"adet": 2}')]
            ),
            on_result=handle,
        )
        state = asyncio.run(runner.run())
        assert state.payloads == 2

    def test_bozuk_yuk_sorun_sayar(self):
        _, handle = collect()
        runner = MqttStreamRunner(
            spec=spec(ConnectionKind.MQTT),
            messages=self._messages([("fab/t", b"{bozuk")]),
            on_result=handle,
        )
        state = asyncio.run(runner.run())
        assert state.problems == 1
        assert state.has_data is False

    def test_veri_gelince_isaretlenir(self):
        _, handle = collect()
        runner = MqttStreamRunner(
            spec=spec(ConnectionKind.MQTT),
            messages=self._messages([("fab/t", b'{"adet": 1}')]),
            on_result=handle,
            clock=lambda: 4_000,
        )
        state = asyncio.run(runner.run())
        assert state.first_data_at_ms == 4_000

    def test_sinirli_mesaj_okunur(self):
        _, handle = collect()
        runner = MqttStreamRunner(
            spec=spec(ConnectionKind.MQTT),
            messages=self._messages([("f/t", b'{"adet": 1}')] * 5),
            on_result=handle,
        )
        state = asyncio.run(runner.run(max_messages=2))
        assert state.payloads == 2

    def test_kaynak_hatasi_kaydedilir(self):
        async def broken():
            raise ConnectionError("broker koptu")
            yield  # pragma: no cover

        _, handle = collect()
        runner = MqttStreamRunner(
            spec=spec(ConnectionKind.MQTT), messages=broken, on_result=handle
        )
        state = asyncio.run(runner.run())
        assert state.last_error == "broker koptu"
        assert state.running is False


class TestOpcUaSubscription:
    def _notifications(self, items):
        async def generator():
            for item in items:
                yield item

        return generator

    def _table(self) -> MappingTable:
        return MappingTable(
            entries=[
                MetricMapping(
                    origin="ns=2;i=2",
                    machine_id="TORNA_01",
                    metric=Metric.PRODUCTION_COUNT,
                )
            ]
        )

    def test_izlenen_ogeler_kaydedilir(self):
        _, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA),
            notifications=self._notifications([]),
            on_result=handle,
        )
        runner.subscribe(["ns=2;i=2", "ns=2;i=3"])
        assert runner.state.monitored_items == 2

    def test_ayni_ogenin_iki_kez_eklenmesi_cogaltmaz(self):
        _, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA),
            notifications=self._notifications([]),
            on_result=handle,
        )
        runner.subscribe(["ns=2;i=2"])
        runner.subscribe(["ns=2;i=2"])
        assert runner.state.monitored_items == 1

    def test_abonelikten_cikilir(self):
        _, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA),
            notifications=self._notifications([]),
            on_result=handle,
        )
        runner.subscribe(["ns=2;i=2"])
        assert runner.unsubscribe("ns=2;i=2") is True
        assert runner.state.monitored_items == 0

    def test_olmayan_ogeden_cikis_false(self):
        _, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA),
            notifications=self._notifications([]),
            on_result=handle,
        )
        assert runner.unsubscribe("yok") is False

    def test_tumunden_cikilir(self):
        _, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA),
            notifications=self._notifications([]),
            on_result=handle,
        )
        runner.subscribe(["a", "b", "c"])
        assert runner.unsubscribe_all() == 3
        assert runner.state.monitored_items == 0

    def test_degisiklik_bildirimi_olaya_cevrilir(self):
        results, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA),
            notifications=self._notifications([]),
            on_result=handle,
            mapping=self._table(),
        )
        runner.subscribe(["ns=2;i=2"])
        runner.on_change("ns=2;i=2", 1240, 5_000)
        assert results[0][0].events[0].value == 1240
        assert results[0][0].events[0].machine_id == "TORNA_01"

    def test_bildirim_sayaci_artar(self):
        _, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA),
            notifications=self._notifications([]),
            on_result=handle,
            mapping=self._table(),
        )
        runner.subscribe(["ns=2;i=2"])
        runner.on_change("ns=2;i=2", 1, 1_000)
        runner.on_change("ns=2;i=2", 2, 2_000)
        assert runner.items["ns=2;i=2"].notifications == 2
        assert runner.items["ns=2;i=2"].last_value == 2

    def test_izlenmeyen_dugum_kendiliginden_eklenir(self):
        # Sunucular bazen istenmeyen dugumleri de gonderir; atmak veriyi
        # gorunmez kilardi.
        _, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA),
            notifications=self._notifications([]),
            on_result=handle,
            mapping=self._table(),
        )
        runner.on_change("ns=2;i=2", 5, 1_000)
        assert runner.state.monitored_items == 1

    def test_bozuk_kalite_veri_sayilmaz(self):
        _, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA),
            notifications=self._notifications([]),
            on_result=handle,
            mapping=self._table(),
        )
        runner.on_change("ns=2;i=2", 5, 1_000, quality=Quality.BAD)
        assert runner.state.has_data is False
        assert runner.state.problems == 1

    def test_eslenmemis_dugum_sorun_uretir(self):
        _, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA),
            notifications=self._notifications([]),
            on_result=handle,
        )
        runner.on_change("ns=9;i=9", 5, 1_000)
        assert runner.state.problems == 1
        assert runner.state.has_data is False

    def test_akis_bildirimleri_isler(self):
        results, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA),
            notifications=self._notifications([("ns=2;i=2", 10), ("ns=2;i=2", 11)]),
            on_result=handle,
            mapping=self._table(),
            clock=lambda: 3_000,
        )
        state = asyncio.run(runner.run())
        assert state.payloads == 2
        assert len(results) == 2

    def test_kaynak_hatasi_kaydedilir(self):
        async def broken():
            raise ConnectionError("oturum koptu")
            yield  # pragma: no cover

        _, handle = collect()
        runner = OpcUaSubscriptionRunner(
            spec=spec(ConnectionKind.OPCUA), notifications=broken, on_result=handle
        )
        state = asyncio.run(runner.run())
        assert state.last_error == "oturum koptu"


class TestStreamRegistry:
    class FakeRunner:
        def __init__(self, connection_id):
            self.state = StreamState(connection_id=connection_id, kind="rest")

    def test_kayit_eklenir_ve_okunur(self):
        registry = StreamRegistry()
        registry.add("c1", self.FakeRunner("c1"))
        assert registry.get("c1") is not None

    def test_olmayan_kayit_none(self):
        assert StreamRegistry().get("yok") is None

    def test_kayit_silinir(self):
        registry = StreamRegistry()
        registry.add("c1", self.FakeRunner("c1"))
        registry.remove("c1")
        assert registry.get("c1") is None

    def test_calisma_durumu_okunur(self):
        registry = StreamRegistry()
        runner = self.FakeRunner("c1")
        registry.add("c1", runner)
        assert registry.is_running("c1") is False
        runner.state.running = True
        assert registry.is_running("c1") is True

    def test_durumlar_listelenir(self):
        registry = StreamRegistry()
        registry.add("c1", self.FakeRunner("c1"))
        registry.add("c2", self.FakeRunner("c2"))
        assert len(registry.states()) == 2
