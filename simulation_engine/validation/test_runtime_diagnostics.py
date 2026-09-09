# -*- coding: utf-8 -*-
"""Runtime tanilama testleri.

Bu dosyanin savundugu kural: **olculmeyen deger sifir gostermez**. Hic olay
islememis bir dagitici "saniyede sifir olay" gosterseydi, calisan ama bosta
olan bir sistem arizali gibi gorunurdu. Her olculemeyen olcut `None` doner ve
nedenini tasir.
"""

from __future__ import annotations

import pytest

from simulation_engine.runtime.ops.diagnostics import (
    CRITICAL_LOSS_RATIO,
    DIAGNOSTIC_LEVEL_LABEL,
    DiagnosticLevel,
    DiagnosticMetric,
    DiagnosticsReport,
    QUEUE_PRESSURE_RATIO,
    SLOW_LAG_MS,
    STALE_HEARTBEAT_MS,
    build_report,
    dropped_metric,
    heartbeat_metric,
    lag_metric,
    pending_metric,
    queue_metric,
    reconnect_metric,
    telemetry_metric,
    throughput_metric,
    unmeasured,
    worst_level,
)

NOW = 1_700_000_000_000


def stats(**kwargs):
    base = {
        "processed": 100,
        "dropped": 0,
        "events_per_second": 12.5,
        "avg_latency_ms": 120.0,
        "loss_ratio": 0.0,
        "queue": {"depth": 5, "capacity": 1000},
    }
    base.update(kwargs)
    return base


def liveness(**kwargs):
    base = {"connector_id": "plc-1", "age_ms": 1_000, "reconnects": 0}
    base.update(kwargs)
    return [base]


def writer(**kwargs):
    base = {"writes_per_second": 8.0, "errors": 0, "pending": 3}
    base.update(kwargs)
    return base


class TestOlcut:
    def test_olculen_olcut(self):
        metric = DiagnosticMetric("x", "X", 5.0, "sn", DiagnosticLevel.OK)
        assert metric.measured is True

    def test_olculmeyen_olcut(self):
        assert unmeasured("x", "X", "neden").measured is False

    def test_olculmeyen_deger_none(self):
        assert unmeasured("x", "X", "neden").value is None

    def test_olculmeyen_neden_tasir(self):
        assert unmeasured("x", "X", "neden yok").reason == "neden yok"

    def test_olculmeyen_durum_bilinmiyor(self):
        assert unmeasured("x", "X", "n").level is DiagnosticLevel.UNKNOWN

    def test_olculen_olcutte_neden_yok(self):
        metric = DiagnosticMetric("x", "X", 5.0, "sn", DiagnosticLevel.OK)
        assert metric.reason is None

    def test_sozluk_alanlari(self):
        payload = unmeasured("x", "X", "n").to_dict()
        assert set(payload) == {
            "id",
            "label",
            "value",
            "unit",
            "level",
            "level_label",
            "reason",
            "measured",
        }

    def test_olcut_degistirilemez(self):
        with pytest.raises(Exception):
            unmeasured("x", "X", "n").value = 1.0

    def test_her_seviyenin_etiketi(self):
        assert set(DIAGNOSTIC_LEVEL_LABEL) == set(DiagnosticLevel)


class TestEnKotuSeviye:
    def test_bos_liste_bilinmiyor(self):
        # OK donseydi, hicbir sey olcmemis bir sistem saglikli gorunurdu.
        assert worst_level([]) is DiagnosticLevel.UNKNOWN

    def test_kritik_kazanir(self):
        metrics = [
            DiagnosticMetric("a", "A", 1.0, None, DiagnosticLevel.OK),
            DiagnosticMetric("b", "B", 1.0, None, DiagnosticLevel.CRITICAL),
        ]
        assert worst_level(metrics) is DiagnosticLevel.CRITICAL

    def test_uyari_normalden_once(self):
        metrics = [
            DiagnosticMetric("a", "A", 1.0, None, DiagnosticLevel.OK),
            DiagnosticMetric("b", "B", 1.0, None, DiagnosticLevel.WARNING),
        ]
        assert worst_level(metrics) is DiagnosticLevel.WARNING

    def test_hepsi_normal(self):
        metrics = [DiagnosticMetric("a", "A", 1.0, None, DiagnosticLevel.OK)]
        assert worst_level(metrics) is DiagnosticLevel.OK

    def test_bilinmeyen_normali_bozmaz(self):
        metrics = [
            DiagnosticMetric("a", "A", 1.0, None, DiagnosticLevel.OK),
            unmeasured("b", "B", "n"),
        ]
        assert worst_level(metrics) is DiagnosticLevel.OK


class TestVerim:
    def test_olculen_hiz(self):
        assert throughput_metric(stats()).value == 12.5

    def test_olculmeyen_hiz_none(self):
        assert throughput_metric(stats(events_per_second=None)).value is None

    def test_olculmeyen_hiz_neden_yazar(self):
        metric = throughput_metric(stats(events_per_second=None))
        assert "ölçülemez" in metric.reason

    def test_bos_sayacta_bilinmiyor(self):
        assert throughput_metric({}).level is DiagnosticLevel.UNKNOWN

    def test_birim(self):
        assert throughput_metric(stats()).unit == "olay/sn"


class TestKuyruk:
    def test_derinlik_okunur(self):
        assert queue_metric(stats()).value == 5.0

    def test_bos_kuyruk_normal(self):
        assert queue_metric(stats()).level is DiagnosticLevel.OK

    def test_esikte_uyari(self):
        depth = int(1000 * QUEUE_PRESSURE_RATIO)
        metric = queue_metric(stats(queue={"depth": depth, "capacity": 1000}))
        assert metric.level is DiagnosticLevel.WARNING

    def test_dolu_kuyruk_kritik(self):
        metric = queue_metric(stats(queue={"depth": 1000, "capacity": 1000}))
        assert metric.level is DiagnosticLevel.CRITICAL

    def test_kapasitesiz_kuyruk_olculmez(self):
        # Derinligi tek basina yorumlamak (yuz olay cok mu az mi?) anlamsizdir.
        metric = queue_metric(stats(queue={"depth": 5, "capacity": None}))
        assert metric.value is None

    def test_kuyruk_bilgisi_yoksa_neden_yazilir(self):
        assert queue_metric({}).reason == "Kuyruk bilgisi yok"

    def test_uyaride_oran_yazilir(self):
        metric = queue_metric(stats(queue={"depth": 900, "capacity": 1000}))
        assert "%90" in metric.reason


class TestDusenOlaylar:
    def test_hic_dusmemis_normal(self):
        assert dropped_metric(stats()).level is DiagnosticLevel.OK

    def test_dusen_sayisi_okunur(self):
        assert dropped_metric(stats(dropped=7, loss_ratio=0.07)).value == 7.0

    def test_dusme_kritik_orana_ulasinca_kritik(self):
        metric = dropped_metric(stats(dropped=7, loss_ratio=CRITICAL_LOSS_RATIO))
        assert metric.level is DiagnosticLevel.CRITICAL

    def test_kucuk_kayip_uyari(self):
        metric = dropped_metric(stats(dropped=1, loss_ratio=0.00000001))
        assert metric.level is DiagnosticLevel.WARNING

    def test_dusmede_neden_yazilir(self):
        metric = dropped_metric(stats(dropped=1, loss_ratio=0.01))
        assert "Kuyruk" in metric.reason

    def test_sayac_yoksa_olculmez(self):
        assert dropped_metric({}).value is None


class TestGecikme:
    def test_gecikme_okunur(self):
        assert lag_metric(stats()).value == 120.0

    def test_hizli_akis_normal(self):
        assert lag_metric(stats()).level is DiagnosticLevel.OK

    def test_yavas_akis_uyari(self):
        assert lag_metric(stats(avg_latency_ms=SLOW_LAG_MS)).level is DiagnosticLevel.WARNING

    def test_ornek_yoksa_olculmez(self):
        assert lag_metric(stats(avg_latency_ms=None)).value is None

    def test_ornek_yoksa_neden_yazilir(self):
        assert "ölçüm gelmedi" in lag_metric(stats(avg_latency_ms=None)).reason


class TestYenidenBaglanma:
    def test_akis_yoksa_olculmez(self):
        # Sifir yeniden baglanma, hic baglantisi olmayan kurulumda "hic kopmadi"
        # diye okunurdu.
        assert reconnect_metric([]).value is None

    def test_hic_kopmamis_normal(self):
        assert reconnect_metric(liveness()).level is DiagnosticLevel.OK

    def test_kopmus_uyari(self):
        assert reconnect_metric(liveness(reconnects=2)).level is DiagnosticLevel.WARNING

    def test_toplam_sayilir(self):
        states = liveness(reconnects=2) + liveness(reconnects=3)
        assert reconnect_metric(states).value == 5.0

    def test_kopmada_neden_yazilir(self):
        assert "2 kez" in reconnect_metric(liveness(reconnects=2)).reason


class TestVeriYasi:
    def test_yas_okunur(self):
        assert heartbeat_metric(liveness(), NOW).value == 1_000.0

    def test_yeni_veri_normal(self):
        assert heartbeat_metric(liveness(), NOW).level is DiagnosticLevel.OK

    def test_yarim_esikte_uyari(self):
        metric = heartbeat_metric(liveness(age_ms=STALE_HEARTBEAT_MS // 2), NOW)
        assert metric.level is DiagnosticLevel.WARNING

    def test_esikte_kritik(self):
        metric = heartbeat_metric(liveness(age_ms=STALE_HEARTBEAT_MS), NOW)
        assert metric.level is DiagnosticLevel.CRITICAL

    def test_en_eski_secilir(self):
        states = liveness(age_ms=1_000) + liveness(age_ms=9_000)
        assert heartbeat_metric(states, NOW).value == 9_000.0

    def test_veri_gelmemis_akis_sayilmaz(self):
        # Yasi olmayan bir akis "cok eski" degil, henuz baslamamistir.
        assert heartbeat_metric(liveness(age_ms=None), NOW).value is None

    def test_veri_yoksa_neden_yazilir(self):
        assert "henüz veri gelmedi" in heartbeat_metric([], NOW).reason


class TestTelemetriYazma:
    def test_hiz_okunur(self):
        assert telemetry_metric(writer()).value == 8.0

    def test_yazici_yoksa_olculmez(self):
        assert telemetry_metric(None).value is None

    def test_yazici_yoksa_neden_yazilir(self):
        assert "çalışmıyor" in telemetry_metric(None).reason

    def test_hic_yazma_yoksa_olculmez(self):
        assert telemetry_metric(writer(writes_per_second=None)).value is None

    def test_hata_kritik(self):
        assert telemetry_metric(writer(errors=2)).level is DiagnosticLevel.CRITICAL

    def test_hatada_sayi_yazilir(self):
        assert "2 yazma hatası" in telemetry_metric(writer(errors=2)).reason

    def test_bekleyen_okunur(self):
        assert pending_metric(writer()).value == 3.0

    def test_yazici_yoksa_bekleyen_olculmez(self):
        assert pending_metric(None).value is None


class TestRapor:
    def test_sekiz_olcut(self):
        report = build_report(NOW, stats(), liveness(), writer())
        assert len(report.metrics) == 8

    def test_saglikli_sistem_normal(self):
        report = build_report(NOW, stats(), liveness(), writer())
        assert report.level is DiagnosticLevel.OK

    def test_bos_rapor_bilinmiyor(self):
        assert build_report(NOW).level is DiagnosticLevel.UNKNOWN

    def test_eksik_kaynak_raporu_dusurmez(self):
        # Eksik bolum icin varsayilan uretilseydi, calismayan bir alt sistem
        # saglikli gorunurdu.
        assert len(build_report(NOW).metrics) == 8

    def test_eksik_kaynakta_hepsi_olculmemis(self):
        assert build_report(NOW).measured_count == 0

    def test_olculen_sayisi(self):
        report = build_report(NOW, stats(), liveness(), writer())
        assert report.measured_count == 8

    def test_dusen_olay_raporu_kritik_yapar(self):
        report = build_report(
            NOW, stats(dropped=50, loss_ratio=0.05), liveness(), writer()
        )
        assert report.level is DiagnosticLevel.CRITICAL

    def test_akislar_raporda(self):
        report = build_report(NOW, stats(), liveness(), writer())
        assert report.streams[0]["connector_id"] == "plc-1"

    def test_sozluk_alanlari(self):
        payload = build_report(NOW).to_dict()
        assert set(payload) == {
            "at_ms",
            "level",
            "level_label",
            "metrics",
            "streams",
            "measured_count",
            "metric_count",
        }

    def test_an_tasinir(self):
        assert build_report(NOW).to_dict()["at_ms"] == NOW

    def test_olcut_sayisi_sozlukte(self):
        assert build_report(NOW).to_dict()["metric_count"] == 8
