"""İzleme merkezi ve yöneticiye bağlanışı.

Bu dosya, üç ekranın (Live Factory, Alarm Merkezi, Runtime panosu) **aynı**
alarm gerçeğini okuduğunu doğrular. Her ekran kendi eşiğini uygulasaydı aynı
arıza üç farklı biçimde görünür, operatör hangisine güveneceğini bilemez ve
sonunda hiçbirine bakmazdı.

Ayrıca otomatik kurtarmayı sınar: sunucu açılışında durum diskten geri
yüklenmeli, ama geri yüklenen bağlantı **bağlı sayılmamalıdır**.
"""

from __future__ import annotations

import math
import os
import tempfile

import pytest

from simulation_engine.runtime.alarms import AlarmRuleId, AlarmState, ConnectionView, alarm_id
from simulation_engine.runtime.manager import RuntimeManager, score_label
from simulation_engine.runtime.monitoring import MonitoringCenter
from simulation_engine.runtime.oee import is_valid_oee
from simulation_engine.runtime.persistence.downtime import DowntimeEvent
from simulation_engine.runtime.persistence.repository import (
    DatabaseRuntimeRepository,
    StoredConnection,
)
from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord
from simulation_engine.runtime.types import ConnectionKind, ConnectionSpec

ORG = "izleme-org"
NOW = 1_000_000
DK = 60_000
SAAT_MS = 3_600_000


def machine(
    machine_id: str = "TORNA_01",
    status: str = "running",
    production: float | None = None,
    scrap: float | None = None,
    queue: float | None = None,
    at_ms: int = NOW,
) -> MachineSnapshotRecord:
    return MachineSnapshotRecord(
        machine_id=machine_id,
        status=status,
        production_count=production,
        scrap_count=scrap,
        queue_length=queue,
        updated_at_ms=at_ms,
    )


# -- Merkez -----------------------------------------------------------------


class TestGozlem:
    def test_duran_makine_hem_alarm_hem_durus_uretir(self):
        center = MonitoringCenter()
        result = center.observe([machine(status="down")], [], NOW)
        assert result["alarms"]["opened"] == 1
        assert result["downtime_changes"] == 1

    def test_durus_alarmdan_once_islenir(self):
        """Alarm açıldığı anda duruş da açık olmalı; yoksa çelişki görünür."""
        center = MonitoringCenter()
        center.observe([machine(status="down")], [], NOW)
        assert center.downtime.open_count() == 1
        assert center.alarms.active_count == 1

    def test_saglikli_makine_ne_alarm_ne_durus(self):
        center = MonitoringCenter()
        result = center.observe([machine(status="running")], [], NOW)
        assert result["alarms"]["opened"] == 0
        assert result["downtime_changes"] == 0

    def test_tekrarlanan_gozlem_yeni_alarm_acmaz(self):
        center = MonitoringCenter()
        for step in range(30):
            center.observe([machine(status="down")], [], NOW + step * 1_000)
        assert center.alarms.active_count == 1
        assert len(center.downtime.all_events()) == 1

    def test_makine_kalkinca_alarm_ve_durus_kapanir(self):
        center = MonitoringCenter()
        center.observe([machine(status="down")], [], NOW)
        center.observe([machine(status="running")], [], NOW + DK)
        assert center.alarms.active_count == 0
        assert center.downtime.open_count() == 0
        assert center.downtime.total_ms() == DK

    def test_durus_degisimi_geri_cagrilir(self):
        """Yönetici bu kancayla duruşu diske yazar."""
        yazilanlar: list[DowntimeEvent] = []
        center = MonitoringCenter(on_downtime=yazilanlar.append)
        center.observe([machine(status="down")], [], NOW)
        center.observe([machine(status="running")], [], NOW + DK)
        assert len(yazilanlar) == 2

    def test_baglanti_kopmasi_alarm_uretir(self):
        center = MonitoringCenter()
        views = [ConnectionView("c1", "PLC", "failed", True)]
        center.observe([], views, NOW)
        assert center.alarms.active_count == 1

    def test_uretim_okumasi_saklanir(self):
        center = MonitoringCenter()
        center.observe([machine(production=10, at_ms=NOW)], [], NOW)
        center.observe([machine(production=20, at_ms=NOW + DK)], [], NOW + DK)
        assert len(center.all_samples()) == 2

    def test_ayni_an_iki_kez_okunmaz(self):
        """Aynı zaman damgalı ölçüm iki kez sayılsaydı hız iki katına çıkardı."""
        center = MonitoringCenter()
        center.observe([machine(production=10, at_ms=NOW)], [], NOW)
        center.observe([machine(production=10, at_ms=NOW)], [], NOW + 1)
        assert len(center.all_samples()) == 1

    def test_olculmemis_uretim_ornek_uretmez(self):
        center = MonitoringCenter()
        center.observe([machine(production=None)], [], NOW)
        assert center.all_samples() == []


class TestMerkezKpi:
    def test_kpi_alarm_sayacini_icerir(self):
        center = MonitoringCenter()
        center.observe([machine(status="down")], [], NOW)
        assert center.kpi([machine(status="down")], NOW).alarm_count == 1

    def test_kpi_durus_suresini_icerir(self):
        center = MonitoringCenter()
        center.observe([machine(status="down")], [], NOW)
        assert center.kpi([machine(status="down")], NOW + DK).downtime_minutes == 1.0

    def test_olcumsuz_kpi_none_ve_nedenli(self):
        center = MonitoringCenter()
        result = center.kpi([], NOW)
        assert result.production is None
        assert "production" in result.reasons

    def test_kpi_hicbir_alanda_nan_dondurmez(self):
        center = MonitoringCenter()
        payload = center.kpi([machine(production=float("nan"))], NOW).to_dict()
        for key, value in payload.items():
            if isinstance(value, float):
                assert math.isfinite(value), key


class TestMerkezOee:
    def test_planlanan_sure_yoksa_oee_hesaplanmaz(self):
        """Varsayılan bir vardiya süresi uydurmak, OEE'yi uydurmak olurdu."""
        center = MonitoringCenter()
        assert center.oee([machine(production=100, scrap=5)], NOW).oee is None

    def test_tam_veride_oee_hesaplanir(self):
        center = MonitoringCenter()
        center.observe([machine(status="down")], [], NOW)
        center.observe([machine(status="running")], [], NOW + DK)
        result = center.oee(
            [machine(production=100, scrap=5)],
            NOW + SAAT_MS,
            planned_time_ms=SAAT_MS,
            ideal_cycle_seconds=30,
        )
        assert result.oee is not None

    def test_oee_sifir_bir_araliginda(self):
        center = MonitoringCenter()
        center.observe([machine(status="down")], [], NOW)
        center.observe([machine(status="running")], [], NOW + DK)
        result = center.oee(
            [machine(production=100, scrap=5)],
            NOW + SAAT_MS,
            planned_time_ms=SAAT_MS,
            ideal_cycle_seconds=30,
        )
        assert is_valid_oee(result.oee)

    def test_makine_oeesi_yalnizca_o_makinenin_durusunu_kullanir(self):
        center = MonitoringCenter()
        center.observe(
            [machine("M1", status="down"), machine("M2", status="running")], [], NOW
        )
        center.observe(
            [machine("M1", status="running"), machine("M2", status="running")],
            [],
            NOW + DK,
        )
        sonuc = center.machine_oee(
            machine("M2", production=100, scrap=0),
            NOW + SAAT_MS,
            planned_time_ms=SAAT_MS,
            ideal_cycle_seconds=30,
        )
        # M2 hiç durmadığı için duruşu ölçülmemiştir; uydurulmaz.
        assert sonuc.availability is None


class TestZamanCizelgesi:
    def test_durus_ve_alarm_tek_akista(self):
        center = MonitoringCenter()
        center.observe([machine(status="down")], [], NOW)
        turler = {row["type"] for row in center.timeline(NOW)}
        assert turler == {"downtime", "alarm"}

    def test_yeniden_eskiye_siralanir(self):
        center = MonitoringCenter()
        center.observe([machine("M1", status="down")], [], NOW)
        center.observe(
            [machine("M1", status="down"), machine("M2", status="down")], [], NOW + DK
        )
        anlar = [row["at_ms"] for row in center.timeline(NOW + DK)]
        assert anlar == sorted(anlar, reverse=True)

    def test_sinir_uygulanir(self):
        center = MonitoringCenter()
        for step in range(20):
            center.observe([machine(f"M{step}", status="down")], [], NOW + step)
        assert len(center.timeline(NOW + 100, limit=5)) == 5

    def test_kapanan_alarm_cizelgede_kapali_gorunur(self):
        center = MonitoringCenter()
        center.observe([machine(status="down")], [], NOW)
        center.observe([machine(status="running")], [], NOW + DK)
        alarmlar = [row for row in center.timeline(NOW + DK) if row["type"] == "alarm"]
        assert all(row["open"] is False for row in alarmlar)

    def test_bos_merkezde_cizelge_bos(self):
        assert MonitoringCenter().timeline(NOW) == []


class TestUretimDurumu:
    def test_makine_sayilari_dogru(self):
        center = MonitoringCenter()
        machines = [
            machine("M1", status="running"),
            machine("M2", status="blocked"),
            machine("M3", status="down"),
        ]
        status = center.production_status(machines, NOW)
        assert status["running_machines"] == 1
        assert status["blocked_machines"] == 1
        assert status["down_machines"] == 1

    def test_alarm_sayaclari_gecer(self):
        center = MonitoringCenter()
        center.observe([machine(status="down")], [], NOW)
        status = center.production_status([machine(status="down")], NOW)
        assert status["active_alarms"] == 1
        assert status["open_alarms"] == 1

    def test_olcumsuz_oee_none_ve_nedenli(self):
        status = MonitoringCenter().production_status([], NOW)
        assert status["oee"] is None
        assert status["oee_reasons"] != {}

    def test_yuzde_ve_oran_birlikte_doner(self):
        center = MonitoringCenter()
        center.observe([machine(status="down")], [], NOW)
        center.observe([machine(status="running")], [], NOW + DK)
        status = center.production_status(
            [machine(production=100, scrap=5)],
            NOW + SAAT_MS,
            planned_time_ms=SAAT_MS,
            ideal_cycle_seconds=30,
        )
        assert status["oee_percent"] == pytest.approx(status["oee"] * 100)


# -- Yönetici ---------------------------------------------------------------


@pytest.fixture
def manager() -> RuntimeManager:
    return RuntimeManager(adapters={})


def _kaydet(manager: RuntimeManager, connection_id: str = "c1") -> None:
    manager.register(
        ORG,
        ConnectionSpec(
            connection_id=connection_id,
            kind=ConnectionKind.REST,
            label=connection_id,
            endpoint="http://127.0.0.1:9/veri",
        ),
    )


class TestYoneticiBaglantisi:
    def test_baglanti_gorunumu_uretilir(self, manager):
        _kaydet(manager)
        views = manager.connection_views(ORG)
        assert views[0].connection_id == "c1"

    def test_alarm_merkezi_bos_baslar(self, manager):
        assert manager.alarm_center(ORG, NOW)["counts"]["active"] == 0

    def test_duran_makine_alarm_merkezinde_gorunur(self, manager):
        manager.active_org_id = ORG
        manager.devices.load_snapshots({"TORNA_01": machine(status="down")})
        state = manager.alarm_center(ORG, NOW)
        assert state["counts"]["active"] == 1

    def test_ayni_alarm_iki_okumada_cogalmaz(self, manager):
        manager.active_org_id = ORG
        manager.devices.load_snapshots({"TORNA_01": machine(status="down")})
        manager.alarm_center(ORG, NOW)
        state = manager.alarm_center(ORG, NOW + 1_000)
        assert state["counts"]["active"] == 1

    def test_alarm_onaylanir(self, manager):
        manager.active_org_id = ORG
        manager.devices.load_snapshots({"TORNA_01": machine(status="down")})
        manager.alarm_center(ORG, NOW)
        ident = alarm_id(AlarmRuleId.MACHINE_DOWN, "TORNA_01")
        result = manager.acknowledge_alarm(ORG, ident, "Ayşe", NOW + 1_000)
        assert result["state"] == AlarmState.ACKNOWLEDGED.value

    def test_onay_olay_uretir(self, manager):
        manager.active_org_id = ORG
        manager.devices.load_snapshots({"TORNA_01": machine(status="down")})
        manager.alarm_center(ORG, NOW)
        ident = alarm_id(AlarmRuleId.MACHINE_DOWN, "TORNA_01")
        manager.acknowledge_alarm(ORG, ident, "Ayşe", NOW + 1_000)
        kinds = [event.kind for event in manager.dispatcher.buffer.all()]
        assert "alarm_acknowledged" in kinds

    def test_bilinmeyen_alarm_onaylanamaz(self, manager):
        assert manager.acknowledge_alarm(ORG, "yok::yok", "Ayşe", NOW) is None

    def test_onaylanan_alarm_sonraki_okumada_acilmaz(self, manager):
        manager.active_org_id = ORG
        manager.devices.load_snapshots({"TORNA_01": machine(status="down")})
        manager.alarm_center(ORG, NOW)
        ident = alarm_id(AlarmRuleId.MACHINE_DOWN, "TORNA_01")
        manager.acknowledge_alarm(ORG, ident, "Ayşe", NOW + 1_000)
        state = manager.alarm_center(ORG, NOW + 10_000)
        assert state["active"][0]["state"] == AlarmState.ACKNOWLEDGED.value

    def test_uc_ekran_ayni_alarm_sayisini_gorur(self, manager):
        """Sprintin ana sözü: tek gerçek, üç ekran."""
        manager.active_org_id = ORG
        manager.devices.load_snapshots({"TORNA_01": machine(status="down")})

        merkez = manager.alarm_center(ORG, NOW)["counts"]["active"]
        canli = len(manager.live_state(ORG, NOW)["alarms"])
        pano = manager.runtime_dashboard(ORG, NOW)["alarms"]["active"]

        assert merkez == canli == pano == 1

    def test_zaman_cizelgesi_donulur(self, manager):
        manager.active_org_id = ORG
        manager.devices.load_snapshots({"TORNA_01": machine(status="down")})
        assert len(manager.timeline(ORG, NOW)) >= 1

    def test_uretim_durumu_donulur(self, manager):
        manager.active_org_id = ORG
        manager.devices.load_snapshots({"TORNA_01": machine(status="down")})
        status = manager.production_status(ORG, NOW)
        assert status["down_machines"] == 1

    def test_saglik_skoru_olcumsuzse_none(self, manager):
        _kaydet(manager)
        assert manager.health_score(ORG, NOW)["score"] is None

    def test_saglik_skoru_baglanti_yoksa_none(self, manager):
        assert manager.health_score(ORG, NOW)["score"] is None

    def test_skor_etiketleri(self):
        assert score_label(None) == "Ölçülmedi"
        assert score_label(90) == "İyi"
        assert score_label(70) == "Dikkat"
        assert score_label(10) == "Kötü"


class TestCanliDurum:
    def test_canli_durum_runtime_kpi_icerir(self, manager):
        manager.active_org_id = ORG
        manager.devices.load_snapshots({"TORNA_01": machine(production=100)})
        assert manager.live_state(ORG, NOW)["runtime_kpi"]["production"] == 100

    def test_canli_durum_oee_icerir(self, manager):
        assert "oee" in manager.live_state(ORG, NOW)

    def test_olcumsuz_oee_none(self, manager):
        assert manager.live_state(ORG, NOW)["oee"]["oee"] is None

    def test_canli_durum_durus_ozeti_icerir(self, manager):
        manager.active_org_id = ORG
        manager.devices.load_snapshots({"TORNA_01": machine(status="down")})
        manager.live_state(ORG, NOW)
        state = manager.live_state(ORG, NOW + DK)
        assert state["downtime"]["open"] == 1

    def test_olcumsuz_durus_none(self, manager):
        assert manager.live_state(ORG, NOW)["downtime"]["total_ms"] is None

    def test_kalicilik_kipi_bildirilir(self, manager):
        assert manager.live_state(ORG, NOW)["persistence"]["mode"] == "memory"


# -- Otomatik kurtarma ------------------------------------------------------


@pytest.fixture
def db_manager() -> RuntimeManager:
    path = os.path.join(tempfile.mkdtemp(), "kurtarma.db")
    repository = DatabaseRuntimeRepository(f"sqlite:///{path}")
    return RuntimeManager(adapters={}, repository=repository)


class TestOtomatikKurtarma:
    def test_bos_depoda_kurtarilacak_kiraci_yok(self, db_manager):
        assert db_manager.recover_all()["orgs"] == []

    def test_kayitli_kiraci_kurtarilir(self, db_manager):
        db_manager.repository.save_connection(
            ORG,
            StoredConnection(
                connection_id="c1", kind="rest", label="A", endpoint="http://x"
            ),
        )
        result = db_manager.recover_all()
        assert result["orgs"] == [ORG]

    def test_iki_kiraci_da_kurtarilir(self, db_manager):
        for org in ("org-1", "org-2"):
            db_manager.repository.save_connection(
                org,
                StoredConnection(
                    connection_id="c1", kind="rest", label="A", endpoint="http://x"
                ),
            )
        assert set(db_manager.recover_all()["orgs"]) == {"org-1", "org-2"}

    def test_kurtarilan_baglanti_bagli_sayilmaz(self, db_manager):
        """Açık soket bir sürece aittir; geri yüklenen bağlantı yeniden doğrulanmalı."""
        db_manager.repository.save_connection(
            ORG,
            StoredConnection(
                connection_id="c1",
                kind="rest",
                label="A",
                endpoint="http://x",
                status="connected",
                ever_verified=True,
            ),
        )
        db_manager.recover_all()
        state = db_manager.registry.list(ORG)[0]
        assert state.status.value != "connected"

    def test_acik_durus_kurtarmadan_sonra_acik_kalir(self, db_manager):
        db_manager.repository.save_connection(
            ORG,
            StoredConnection(
                connection_id="c1", kind="rest", label="A", endpoint="http://x"
            ),
        )
        db_manager.repository.save_downtime(ORG, DowntimeEvent("TORNA_01", NOW))
        db_manager.recover_all()
        assert db_manager.monitoring.downtime.open_count() == 1

    def test_kurtarilan_durus_suresi_korunur(self, db_manager):
        db_manager.repository.save_connection(
            ORG,
            StoredConnection(
                connection_id="c1", kind="rest", label="A", endpoint="http://x"
            ),
        )
        db_manager.repository.save_downtime(
            ORG, DowntimeEvent("TORNA_01", NOW, end_ms=NOW + DK)
        )
        db_manager.recover_all()
        assert db_manager.monitoring.downtime.total_ms() == DK

    def test_kurtarma_sonucu_durus_sayisini_bildirir(self, db_manager):
        db_manager.repository.save_connection(
            ORG,
            StoredConnection(
                connection_id="c1", kind="rest", label="A", endpoint="http://x"
            ),
        )
        db_manager.repository.save_downtime(ORG, DowntimeEvent("TORNA_01", NOW))
        assert db_manager.recover(ORG)["downtime"] == 1

    def test_bir_kiracinin_hatasi_otekini_engellemez(self, db_manager):
        """Tek bir bozuk kayıt bütün fabrikayı karanlıkta bırakmamalı."""
        db_manager.repository.save_connection(
            "org-iyi",
            StoredConnection(
                connection_id="c1", kind="rest", label="A", endpoint="http://x"
            ),
        )
        db_manager.repository.save_connection(
            "org-bozuk",
            StoredConnection(
                connection_id="c2", kind="gecersiz-tur", label="B", endpoint="http://y"
            ),
        )
        result = db_manager.recover_all()
        assert "org-iyi" in result["orgs"]
        assert "org-bozuk" in result["failures"]

    def test_kurtarma_kalicilik_kipini_bildirir(self, db_manager):
        assert db_manager.recover_all()["persistent"] is True

    def test_bellek_kipinde_kalici_degil(self, manager):
        assert manager.recover_all()["persistent"] is False
