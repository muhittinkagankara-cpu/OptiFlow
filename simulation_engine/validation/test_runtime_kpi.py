"""Runtime KPI motoru: ekrandaki her sayının kaynağı.

Bu dosyanın koruduğu iki kural
------------------------------
1. **Ölçülemeyen alan `None` döner ve nedeni yazılır.** Sıfır göstermek,
   "ölçüldü ve sıfır çıktı" demektir; ikisi çok farklı bilgilerdir.
2. **`NaN` ve sonsuz asla dışarı sızmaz.** Ekranda bir kez "NaN" gören
   kullanıcı, doğru olan öteki sayılara da güvenmez.
"""

from __future__ import annotations

import math

import pytest

from simulation_engine.runtime.kpi import (
    MIN_THROUGHPUT_WINDOW_MS,
    KpiInput,
    ProductionSample,
    active_machines,
    alarm_count,
    availability_ratio,
    compute_kpi,
    downtime_minutes,
    is_finite_number,
    production_total,
    queue_total,
    scrap_total,
    throughput_per_hour,
)
from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord

NOW = 1_000_000
SAAT_MS = 3_600_000


def machine(
    machine_id: str = "TORNA_01",
    status: str = "running",
    production: float | None = None,
    scrap: float | None = None,
    queue: float | None = None,
) -> MachineSnapshotRecord:
    return MachineSnapshotRecord(
        machine_id=machine_id,
        status=status,
        production_count=production,
        scrap_count=scrap,
        queue_length=queue,
        updated_at_ms=NOW,
    )


# -- Sayı denetimi ----------------------------------------------------------


class TestSayiDenetimi:
    def test_normal_sayi_gecerli(self):
        assert is_finite_number(12.5) is True

    def test_sifir_gecerli(self):
        """Ölçülmüş sıfır gerçek bir ölçümdür."""
        assert is_finite_number(0) is True

    def test_none_gecersiz(self):
        assert is_finite_number(None) is False

    def test_nan_gecersiz(self):
        assert is_finite_number(float("nan")) is False

    def test_pozitif_sonsuz_gecersiz(self):
        assert is_finite_number(math.inf) is False

    def test_negatif_sonsuz_gecersiz(self):
        assert is_finite_number(-math.inf) is False

    def test_metin_gecersiz(self):
        assert is_finite_number("12") is False


# -- Toplamlar --------------------------------------------------------------


class TestToplamlar:
    def test_uretim_toplanir(self):
        assert production_total([machine(production=10), machine(production=5)]) == 15

    def test_olculmemis_makine_toplama_girmez(self):
        assert production_total([machine(production=10), machine()]) == 10

    def test_hicbiri_olculmemisse_none(self):
        """Hiç ölçüm yokken sıfır göstermek, hattı durmuş gibi anlatırdı."""
        assert production_total([machine(), machine()]) is None

    def test_bos_liste_none(self):
        assert production_total([]) is None

    def test_kuyruk_toplanir(self):
        assert queue_total([machine(queue=3), machine(queue=4)]) == 7

    def test_fire_toplanir(self):
        assert scrap_total([machine(scrap=1), machine(scrap=2)]) == 3

    def test_fire_olculmemisse_none(self):
        assert scrap_total([machine()]) is None

    def test_nan_uretim_toplama_girmez(self):
        assert production_total([machine(production=float("nan")), machine(production=5)]) == 5


class TestMakineSayilari:
    def test_calisan_makineler_sayilir(self):
        machines = [machine(status="running"), machine("M2", status="down")]
        assert active_machines(machines) == 1

    def test_bos_listede_sifir(self):
        """Bu sıfır ölçülmüştür: sıfır makine gerçekten çalışıyor."""
        assert active_machines([]) == 0


class TestAlarmSayaclari:
    def test_sayaclar_gecer(self):
        assert alarm_count(3, 2) == {"active": 3, "open": 2}

    def test_negatif_sayac_sifira_cekilir(self):
        assert alarm_count(-1, -5) == {"active": 0, "open": 0}


# -- Hız --------------------------------------------------------------------


def sample(at_ms: int, value: float, machine_id: str = "TORNA_01") -> ProductionSample:
    return ProductionSample(machine_id=machine_id, at_ms=at_ms, value=value)


class TestHiz:
    def test_saatlik_cikti_hesaplanir(self):
        samples = [sample(0, 0), sample(SAAT_MS, 100)]
        assert throughput_per_hour(samples, SAAT_MS) == pytest.approx(100)

    def test_yarim_saatte_yarisi_kadar_sure(self):
        samples = [sample(0, 0), sample(SAAT_MS // 2, 50)]
        assert throughput_per_hour(samples, SAAT_MS // 2) == pytest.approx(100)

    def test_tek_okumadan_hiz_cikmaz(self):
        """İki nokta olmadan zaman farkı, dolayısıyla hız yoktur."""
        assert throughput_per_hour([sample(0, 10)], NOW) is None

    def test_bos_ornekten_hiz_cikmaz(self):
        assert throughput_per_hour([], NOW) is None

    def test_kisa_pencerede_hiz_hesaplanmaz(self):
        samples = [sample(0, 0), sample(MIN_THROUGHPUT_WINDOW_MS - 1, 10)]
        assert throughput_per_hour(samples, NOW) is None

    def test_tam_pencerede_hiz_hesaplanir(self):
        samples = [sample(0, 0), sample(MIN_THROUGHPUT_WINDOW_MS, 10)]
        assert throughput_per_hour(samples, NOW) is not None

    def test_sayac_geri_giderse_makine_atlanir(self):
        """PLC yeniden başladığında sayaç sıfırlanır; bu üretim değildir."""
        samples = [sample(0, 500), sample(SAAT_MS, 20)]
        assert throughput_per_hour(samples, SAAT_MS) is None

    def test_iki_makine_ayri_hesaplanip_toplanir(self):
        samples = [
            sample(0, 0, "M1"),
            sample(SAAT_MS, 100, "M1"),
            sample(0, 0, "M2"),
            sample(SAAT_MS, 50, "M2"),
        ]
        assert throughput_per_hour(samples, SAAT_MS) == pytest.approx(150)

    def test_bir_makinenin_sifirlanmasi_otekini_etkilemez(self):
        samples = [
            sample(0, 0, "M1"),
            sample(SAAT_MS, 100, "M1"),
            sample(0, 500, "M2"),
            sample(SAAT_MS, 10, "M2"),
        ]
        assert throughput_per_hour(samples, SAAT_MS) == pytest.approx(100)

    def test_nan_okuma_atlanir(self):
        samples = [sample(0, float("nan")), sample(SAAT_MS, 100)]
        assert throughput_per_hour(samples, SAAT_MS) is None

    def test_hicbir_uretim_artisi_yoksa_sifir(self):
        """Ölçülmüş sıfır hız: sayaç okundu ama artmadı."""
        samples = [sample(0, 100), sample(SAAT_MS, 100)]
        assert throughput_per_hour(samples, SAAT_MS) == 0.0


# -- Duruş ve kullanılabilirlik ---------------------------------------------


class TestDurusVeKullanilabilirlik:
    def test_duruş_dakikaya_cevrilir(self):
        assert downtime_minutes(120_000) == 2.0

    def test_olculmemis_durus_none(self):
        assert downtime_minutes(None) is None

    def test_nan_durus_none(self):
        assert downtime_minutes(float("nan")) is None

    def test_kullanilabilirlik_oee_formulunu_kullanir(self):
        assert availability_ratio(SAAT_MS, SAAT_MS / 2) == 0.5

    def test_planlanan_sure_yoksa_none(self):
        assert availability_ratio(None, 1_000) is None


# -- Bileşim ----------------------------------------------------------------


class TestKpiBilesimi:
    def test_tam_veride_alanlar_dolar(self):
        data = KpiInput(
            snapshots=[machine(production=100, scrap=5, queue=3)],
            production_samples=[sample(0, 0), sample(SAAT_MS, 100)],
            downtime_ms=60_000,
            now_ms=SAAT_MS,
        )
        result = compute_kpi(data, planned_time_ms=SAAT_MS)
        assert result.production == 100
        assert result.throughput == pytest.approx(100)
        assert result.downtime_minutes == 1.0
        assert result.availability is not None

    def test_bos_girdide_her_sey_none(self):
        result = compute_kpi(KpiInput(now_ms=NOW))
        assert result.production is None
        assert result.queue is None
        assert result.throughput is None
        assert result.availability is None
        assert result.downtime_minutes is None

    def test_bos_girdide_her_eksik_alan_icin_neden_yazilir(self):
        result = compute_kpi(KpiInput(now_ms=NOW))
        assert set(result.reasons) >= {
            "production",
            "queue",
            "throughput",
            "downtime",
            "availability",
        }

    def test_olculebilen_alan_icin_neden_yazilmaz(self):
        result = compute_kpi(
            KpiInput(snapshots=[machine(production=10)], now_ms=NOW)
        )
        assert "production" not in result.reasons

    def test_makine_durumlari_sayilir(self):
        data = KpiInput(
            snapshots=[
                machine("M1", status="running"),
                machine("M2", status="blocked"),
                machine("M3", status="down"),
                machine("M4", status="unknown"),
            ],
            now_ms=NOW,
        )
        result = compute_kpi(data)
        assert result.active_machines == 1
        assert result.blocked_machines == 1
        assert result.down_machines == 1
        assert result.unknown_machines == 1
        assert result.total_machines == 4

    def test_olculen_makine_sayisi_ayri_tutulur(self):
        """Kaç makinenin gerçekten veri gönderdiği, ekranda ayrıca yazılır."""
        data = KpiInput(
            snapshots=[machine("M1", production=10), machine("M2")], now_ms=NOW
        )
        assert compute_kpi(data).measured_machines == 1

    def test_alarm_sayaclari_gecer(self):
        data = KpiInput(active_alarms=4, open_alarms=2, now_ms=NOW)
        result = compute_kpi(data)
        assert result.alarm_count == 4
        assert result.open_alarm_count == 2

    def test_sozluk_butun_alanlari_icerir(self):
        payload = compute_kpi(KpiInput(now_ms=NOW)).to_dict()
        assert "reasons" in payload
        assert payload["production"] is None

    def test_hicbir_alan_nan_donmez(self):
        """Kabul listesinin aradığı şey: çıktıda `NaN` ya da sonsuz yok."""
        data = KpiInput(
            snapshots=[machine(production=float("inf"), queue=float("nan"))],
            downtime_ms=float("nan"),
            now_ms=NOW,
        )
        payload = compute_kpi(data, planned_time_ms=SAAT_MS).to_dict()
        for key, value in payload.items():
            if isinstance(value, float):
                assert math.isfinite(value), f"{key} sonlu degil"
