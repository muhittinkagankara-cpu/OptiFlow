"""RuntimeManager: kayıt, deneme, yeniden deneme ve özetler.

Sahte bir sürücüyle çalışır; amaç yönetici katmanının kararlarını sınamaktır,
kütüphaneleri değil.
"""

from __future__ import annotations

import asyncio

import pytest

from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.registry import ConnectionNotFound
from simulation_engine.runtime.types import (
    ConnectionKind,
    ConnectionSpec,
    ConnectionStatus,
    ProbeResult,
)

ORG_A = "org-a"
ORG_B = "org-b"


class FakeAdapter:
    """Sırayla verilen sonuçları döndüren sürücü."""

    kind = "fake"

    def __init__(self, results):
        self.results = list(results)
        self.calls = 0

    async def probe(self, spec):
        self.calls += 1
        if not self.results:
            return ProbeResult(ok=False, latency_ms=None, detail="sonuc kalmadi")
        result = self.results.pop(0)
        return result


def ok_result(latency=5.0, at_ms=1_000) -> ProbeResult:
    return ProbeResult(
        ok=True, latency_ms=latency, detail="uc yanit verdi", evidence="42", at_ms=at_ms
    )


def fail_result(detail="Bağlantı kurulamadı: kapalı") -> ProbeResult:
    return ProbeResult(ok=False, latency_ms=None, detail=detail)


def spec(connection_id="c1", **overrides) -> ConnectionSpec:
    base = dict(
        connection_id=connection_id,
        kind=ConnectionKind.REST,
        label="Hat 1",
        endpoint="http://127.0.0.1:9/veri",
        max_retries=0,
    )
    base.update(overrides)
    return ConnectionSpec(**base)


def manager_with(results, **kwargs) -> RuntimeManager:
    adapter = FakeAdapter(results)
    return RuntimeManager(
        adapters={ConnectionKind.REST: adapter},
        # Testler beklemez; gercek gecikme `retry_delay_ms` icinde sinanir.
        sleep=lambda seconds: asyncio.sleep(0),
        **kwargs,
    )


class TestRegister:
    def test_kayit_eklenir(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        assert manager.registry.count(ORG_A) == 1

    def test_kayit_olay_uretir(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        assert manager.dispatcher.buffer.last().kind == "registered"

    def test_kayit_olayi_denenmedigini_soyler(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        assert "Henüz denenmedi" in manager.dispatcher.buffer.last().message

    def test_kayit_baglandi_demez(self):
        manager = manager_with([])
        state = manager.register(ORG_A, spec())
        assert state.status is ConnectionStatus.IDLE

    def test_ayni_kimlik_guncellenir(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        manager.register(ORG_A, spec(label="Yeni"))
        assert manager.registry.count(ORG_A) == 1

    def test_silme_olay_uretir(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        manager.forget(ORG_A, "c1")
        assert manager.dispatcher.buffer.last().kind == "removed"

    def test_silinen_kayit_kalmaz(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        manager.forget(ORG_A, "c1")
        assert manager.registry.count(ORG_A) == 0


class TestConnect:
    def test_basarili_deneme_baglandi_yazar(self):
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        state = asyncio.run(manager.connect(ORG_A, "c1"))
        assert state.status is ConnectionStatus.CONNECTED

    def test_basarili_deneme_dogrulanmis_isaretler(self):
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        assert asyncio.run(manager.connect(ORG_A, "c1")).ever_verified is True

    def test_basarili_deneme_olay_uretir(self):
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.connect(ORG_A, "c1"))
        assert manager.dispatcher.buffer.last().kind == "probe"

    def test_olayda_kanit_yer_alir(self):
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.connect(ORG_A, "c1"))
        assert manager.dispatcher.buffer.last().data["evidence"] == "42"

    def test_olculmeyen_gecikme_olaya_konmaz(self):
        # Sifir yazmak olcum yapilmis izlenimi verirdi.
        manager = manager_with([fail_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.connect(ORG_A, "c1"))
        assert "latency_ms" not in manager.dispatcher.buffer.last().data

    def test_basarisiz_deneme_kritik_seviyeli(self):
        manager = manager_with([fail_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.connect(ORG_A, "c1"))
        assert manager.dispatcher.buffer.last().level.value == "critical"

    def test_basarisiz_deneme_kurulamadi_yazar(self):
        manager = manager_with([fail_result()])
        manager.register(ORG_A, spec())
        assert asyncio.run(manager.connect(ORG_A, "c1")).status is ConnectionStatus.FAILED

    def test_surucusuz_tur_dogrulanmadi_der(self):
        manager = RuntimeManager(adapters={})
        manager.register(ORG_A, spec())
        state = asyncio.run(manager.connect(ORG_A, "c1"))
        assert state.status is ConnectionStatus.FAILED
        assert "Doğrulanmadı" in state.last_probe.detail

    def test_olmayan_kayit_hata_verir(self):
        manager = manager_with([])
        with pytest.raises(ConnectionNotFound):
            asyncio.run(manager.connect(ORG_A, "yok"))

    def test_baska_organizasyon_baglanamaz(self):
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        with pytest.raises(ConnectionNotFound):
            asyncio.run(manager.connect(ORG_B, "c1"))


class TestRetry:
    def test_yeniden_deneme_kapaliysa_bir_kez_denenir(self):
        adapter = FakeAdapter([fail_result(), ok_result()])
        manager = RuntimeManager(
            adapters={ConnectionKind.REST: adapter}, sleep=lambda s: asyncio.sleep(0)
        )
        manager.register(ORG_A, spec(max_retries=0))
        asyncio.run(manager.connect(ORG_A, "c1"))
        assert adapter.calls == 1

    def test_basarisizlikta_yeniden_denenir(self):
        adapter = FakeAdapter([fail_result(), fail_result(), ok_result()])
        manager = RuntimeManager(
            adapters={ConnectionKind.REST: adapter}, sleep=lambda s: asyncio.sleep(0)
        )
        manager.register(ORG_A, spec(max_retries=2))
        state = asyncio.run(manager.connect(ORG_A, "c1"))
        assert adapter.calls == 3
        assert state.status is ConnectionStatus.CONNECTED

    def test_basarida_yeniden_denenmez(self):
        adapter = FakeAdapter([ok_result(), ok_result()])
        manager = RuntimeManager(
            adapters={ConnectionKind.REST: adapter}, sleep=lambda s: asyncio.sleep(0)
        )
        manager.register(ORG_A, spec(max_retries=3))
        asyncio.run(manager.connect(ORG_A, "c1"))
        assert adapter.calls == 1

    def test_deneme_sayisi_asilinca_durur(self):
        adapter = FakeAdapter([fail_result() for _ in range(10)])
        manager = RuntimeManager(
            adapters={ConnectionKind.REST: adapter}, sleep=lambda s: asyncio.sleep(0)
        )
        manager.register(ORG_A, spec(max_retries=2))
        asyncio.run(manager.connect(ORG_A, "c1"))
        assert adapter.calls == 3

    def test_yeniden_deneme_olayi_uretilir(self):
        adapter = FakeAdapter([fail_result(), ok_result()])
        manager = RuntimeManager(
            adapters={ConnectionKind.REST: adapter}, sleep=lambda s: asyncio.sleep(0)
        )
        manager.register(ORG_A, spec(max_retries=1))
        asyncio.run(manager.connect(ORG_A, "c1"))
        kinds = [event.kind for event in manager.dispatcher.buffer.all()]
        assert "retry" in kinds

    def test_yeniden_deneme_sayaci_artar(self):
        adapter = FakeAdapter([fail_result(), ok_result()])
        manager = RuntimeManager(
            adapters={ConnectionKind.REST: adapter}, sleep=lambda s: asyncio.sleep(0)
        )
        manager.register(ORG_A, spec(max_retries=1))
        state = asyncio.run(manager.connect(ORG_A, "c1"))
        assert state.health.reconnects == 1

    def test_basarida_deneme_sayaci_sifirlanir(self):
        adapter = FakeAdapter([fail_result(), ok_result()])
        manager = RuntimeManager(
            adapters={ConnectionKind.REST: adapter}, sleep=lambda s: asyncio.sleep(0)
        )
        manager.register(ORG_A, spec(max_retries=1))
        assert asyncio.run(manager.connect(ORG_A, "c1")).attempt == 0

    def test_yeniden_deneme_olayi_gecikmeyi_yazar(self):
        adapter = FakeAdapter([fail_result(), ok_result()])
        manager = RuntimeManager(
            adapters={ConnectionKind.REST: adapter}, sleep=lambda s: asyncio.sleep(0)
        )
        manager.register(ORG_A, spec(max_retries=1))
        asyncio.run(manager.connect(ORG_A, "c1"))
        retry = [e for e in manager.dispatcher.buffer.all() if e.kind == "retry"][0]
        assert retry.data["delay_ms"] == 500


class TestDisconnect:
    def test_durum_kapatildi_olur(self):
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.connect(ORG_A, "c1"))
        state = asyncio.run(manager.disconnect(ORG_A, "c1"))
        assert state.status is ConnectionStatus.DISCONNECTED

    def test_olay_uretilir(self):
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.disconnect(ORG_A, "c1"))
        assert manager.dispatcher.buffer.last().kind == "disconnected"

    def test_olcumler_silinmez(self):
        # Kapanmis bir baglantinin gecmisi, sorunun tek kaydidir.
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.connect(ORG_A, "c1"))
        state = asyncio.run(manager.disconnect(ORG_A, "c1"))
        assert state.health.avg_latency_ms() == 5.0
        assert state.health.packets == 1

    def test_calisma_suresi_durur(self):
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.connect(ORG_A, "c1"))
        state = asyncio.run(manager.disconnect(ORG_A, "c1"))
        assert state.health.uptime_ms(now_ms=9_999_999) is None

    def test_olmayan_kayit_hata_verir(self):
        manager = manager_with([])
        with pytest.raises(ConnectionNotFound):
            asyncio.run(manager.disconnect(ORG_A, "yok"))


class TestHealthReport:
    def test_bos_organizasyonda_toplam_sifir(self):
        assert manager_with([]).health_report(ORG_A)["total"] == 0

    def test_bos_organizasyonda_gecikme_none(self):
        # Hicbir olcum yoksa ortalama yoktur; sifir degil.
        assert manager_with([]).health_report(ORG_A)["avg_latency_ms"] is None

    def test_bagli_sayisi_dogru(self):
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.connect(ORG_A, "c1"))
        assert manager.health_report(ORG_A)["connected"] == 1

    def test_denenmemis_kayit_bagli_sayilmaz(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        report = manager.health_report(ORG_A)
        assert report["connected"] == 0
        assert report["idle"] == 1

    def test_basarisiz_sayisi_dogru(self):
        manager = manager_with([fail_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.connect(ORG_A, "c1"))
        assert manager.health_report(ORG_A)["failed"] == 1

    def test_olcumsuz_baglanti_ortalamaya_katilmaz(self):
        adapter = FakeAdapter([ok_result(latency=10.0), fail_result()])
        manager = RuntimeManager(
            adapters={ConnectionKind.REST: adapter}, sleep=lambda s: asyncio.sleep(0)
        )
        manager.register(ORG_A, spec("c1"))
        manager.register(ORG_A, spec("c2"))
        asyncio.run(manager.connect(ORG_A, "c1"))
        asyncio.run(manager.connect(ORG_A, "c2"))
        assert manager.health_report(ORG_A)["avg_latency_ms"] == 10.0

    def test_dogrulanmis_sayisi_bildirilir(self):
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.connect(ORG_A, "c1"))
        assert manager.health_report(ORG_A)["verified_ever"] == 1

    def test_baska_organizasyon_sayilmaz(self):
        manager = manager_with([ok_result()])
        manager.register(ORG_A, spec())
        asyncio.run(manager.connect(ORG_A, "c1"))
        assert manager.health_report(ORG_B)["total"] == 0

    def test_tampon_boyutu_bildirilir(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        assert manager.health_report(ORG_A)["buffered_events"] == 1

    def test_hata_ve_paket_toplamlari(self):
        adapter = FakeAdapter([ok_result(), fail_result()])
        manager = RuntimeManager(
            adapters={ConnectionKind.REST: adapter}, sleep=lambda s: asyncio.sleep(0)
        )
        manager.register(ORG_A, spec("c1"))
        manager.register(ORG_A, spec("c2"))
        asyncio.run(manager.connect(ORG_A, "c1"))
        asyncio.run(manager.connect(ORG_A, "c2"))
        report = manager.health_report(ORG_A)
        assert report["total_packets"] == 1
        assert report["total_errors"] == 1


class TestStatusReport:
    def test_bos_organizasyonda_liste_bos(self):
        assert manager_with([]).status_report(ORG_A)["connections"] == []

    def test_kayit_listede_gorunur(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        assert len(manager.status_report(ORG_A)["connections"]) == 1

    def test_parola_listede_gorunmez(self):
        manager = manager_with([])
        manager.register(ORG_A, spec(password="gizli"))
        assert "gizli" not in str(manager.status_report(ORG_A))

    def test_baska_organizasyonun_kaydi_gorunmez(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        assert manager.status_report(ORG_B)["connections"] == []


class TestOwns:
    def test_kendi_kaydini_taniyor(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        assert manager.owns(ORG_A, "c1") is True

    def test_baskasinin_kaydini_tanimiyor(self):
        manager = manager_with([])
        manager.register(ORG_A, spec())
        assert manager.owns(ORG_B, "c1") is False

    def test_olmayan_kayit_false(self):
        assert manager_with([]).owns(ORG_A, "yok") is False
