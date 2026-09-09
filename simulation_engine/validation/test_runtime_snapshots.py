"""Makine görüntüsü motoru ve KPI toplamı.

Bu dosyadaki testler iki kuralı korur: **ölçülemeyen alan `None`** kalır ve
**sessiz üzerine yazma olmaz** — bir metriği başka bir kaynak yazdığında bu
görülebilir olmalıdır.
"""

from __future__ import annotations

from simulation_engine.runtime.persistence.snapshots import (
    BLOCKED,
    DOWN,
    IDLE,
    RUNNING,
    SNAPSHOT_METRICS,
    STATION_STATUS_LABEL,
    UNKNOWN,
    MachineSnapshotRecord,
    aggregate_kpi,
    apply_event,
    apply_events,
    conflicting_metrics,
    stale_snapshots,
    status_from_event,
)
from simulation_engine.runtime.pipeline.device_events import (
    DeviceEvent,
    Metric,
    Quality,
)
from simulation_engine.runtime.types import ConnectionKind

MINUTE = 60_000


def event(
    metric=Metric.PRODUCTION_COUNT,
    value=10,
    at_ms=1_000,
    machine="TORNA_01",
    connection="plc-1",
    **rest,
):
    return DeviceEvent(
        connection_id=connection,
        machine_id=machine,
        metric=metric,
        value=value,
        at_ms=at_ms,
        source=ConnectionKind.OPCUA,
        **rest,
    )


class TestStatusMapping:
    def test_dort_durum_ve_bilinmeyen_tanimli(self):
        assert set(STATION_STATUS_LABEL) == {RUNNING, IDLE, BLOCKED, DOWN, UNKNOWN}

    def test_calisiyor_cevrilir(self):
        assert status_from_event(event(Metric.MACHINE_STATUS, "running")) == RUNNING

    def test_bosta_cevrilir(self):
        assert status_from_event(event(Metric.MACHINE_STATUS, "idle")) == IDLE

    def test_durus_cevrilir(self):
        assert status_from_event(event(Metric.MACHINE_STATUS, "arıza")) == DOWN

    def test_bloke_sozcugu_taninir(self):
        # Bloke bir makine saglamdir, onu doludur; arizadan ayrilmalidir.
        assert status_from_event(event(Metric.MACHINE_STATUS, "blocked")) == BLOCKED

    def test_turkce_bloke_taninir(self):
        assert status_from_event(event(Metric.MACHINE_STATUS, "bloke")) == BLOCKED

    def test_ayar_bloke_sayilir(self):
        assert status_from_event(event(Metric.MACHINE_STATUS, "setup")) == BLOCKED

    def test_plc_kodu_cevrilir(self):
        assert status_from_event(event(Metric.MACHINE_STATUS, 1)) == RUNNING
        assert status_from_event(event(Metric.MACHINE_STATUS, 0)) == DOWN

    def test_taninmayan_durum_bilinmiyor(self):
        assert status_from_event(event(Metric.MACHINE_STATUS, "mavi")) == UNKNOWN

    def test_etiketler_turkce(self):
        assert STATION_STATUS_LABEL[BLOCKED] == "Bloke"
        assert STATION_STATUS_LABEL[UNKNOWN] == "Bilinmiyor"


class TestApplyEvent:
    def test_bos_goruntuye_olcum_islenir(self):
        snapshot = apply_event(None, event(value=1240))
        assert snapshot.machine_id == "TORNA_01"
        assert snapshot.production_count == 1240

    def test_olcum_sayaci_artar(self):
        first = apply_event(None, event(value=1))
        second = apply_event(first, event(value=2, at_ms=2_000))
        assert second.sample_count == 2

    def test_kaynak_kaydedilir(self):
        snapshot = apply_event(None, event(connection="plc-1"))
        assert snapshot.sources["production_count"] == "plc-1"

    def test_guncelleme_ani_kaydedilir(self):
        snapshot = apply_event(None, event(at_ms=5_000))
        assert snapshot.updated_at_ms == 5_000

    def test_kullanilamaz_olcum_goruntuyu_degistirmez(self):
        # Ekrandaki son gecerli deger, bozuk bir okumayla silinmemeli.
        first = apply_event(None, event(value=100))
        second = apply_event(first, event(value=999, quality=Quality.BAD, at_ms=2_000))
        assert second.production_count == 100
        assert second.sample_count == 1

    def test_sayisal_olmayan_uretim_yok_sayilir(self):
        first = apply_event(None, event(value=100))
        second = apply_event(first, event(value="cok", at_ms=2_000))
        assert second.production_count == 100

    def test_eski_olcum_yeniyi_ezmez(self):
        # Geciken bir paket sayaci geriye cekmemeli.
        first = apply_event(None, event(value=100, at_ms=5_000))
        second = apply_event(first, event(value=50, at_ms=1_000))
        assert second.production_count == 100

    def test_ayni_anli_olcum_islenir(self):
        first = apply_event(None, event(value=100, at_ms=5_000))
        second = apply_event(first, event(value=110, at_ms=5_000))
        assert second.production_count == 110

    def test_durum_olcumu_statusu_gunceller(self):
        snapshot = apply_event(None, event(Metric.MACHINE_STATUS, "running"))
        assert snapshot.status == RUNNING

    def test_durum_sayisal_alanlari_bozmaz(self):
        first = apply_event(None, event(value=42))
        second = apply_event(first, event(Metric.MACHINE_STATUS, "idle", at_ms=2_000))
        assert second.production_count == 42
        assert second.status == IDLE

    def test_kuyruk_islenir(self):
        snapshot = apply_event(None, event(Metric.QUEUE_LENGTH, 7))
        assert snapshot.queue_length == 7

    def test_sifir_kuyruk_islenir(self):
        # Olculmus sifir gecerlidir.
        snapshot = apply_event(None, event(Metric.QUEUE_LENGTH, 0))
        assert snapshot.queue_length == 0

    def test_islenmeyen_alanlar_none_kalir(self):
        snapshot = apply_event(None, event(value=5))
        assert snapshot.queue_length is None
        assert snapshot.downtime_minutes is None
        assert snapshot.oee is None

    def test_girdi_goruntusu_degismez(self):
        first = apply_event(None, event(value=1))
        apply_event(first, event(value=2, at_ms=2_000))
        assert first.production_count == 1

    def test_butun_snapshot_metrikleri_islenir(self):
        snapshot = None
        for index, metric in enumerate(SNAPSHOT_METRICS):
            value = 0.5 if metric is Metric.OEE else index + 1
            snapshot = apply_event(snapshot, event(metric, value, at_ms=1_000 + index))
        assert snapshot.production_count is not None
        assert snapshot.oee == 0.5


class TestApplyEvents:
    def test_makineler_ayrilir(self):
        snapshots = apply_events({}, [event(machine="A"), event(machine="B")])
        assert set(snapshots) == {"A", "B"}

    def test_ayni_makine_birikir(self):
        snapshots = apply_events(
            {}, [event(value=1), event(value=5, at_ms=2_000)]
        )
        assert snapshots["TORNA_01"].production_count == 5

    def test_bos_listede_degismez(self):
        assert apply_events({}, []) == {}


class TestConflicts:
    def test_ayni_kaynak_cakisma_degil(self):
        snapshot = apply_event(None, event(connection="plc-1"))
        assert conflicting_metrics(snapshot, event(connection="plc-1")) is None

    def test_farkli_kaynak_cakisma(self):
        snapshot = apply_event(None, event(connection="plc-1"))
        assert conflicting_metrics(snapshot, event(connection="mqtt-1")) == "plc-1"

    def test_yeni_metrikte_cakisma_yok(self):
        snapshot = apply_event(None, event(connection="plc-1"))
        other = event(Metric.QUEUE_LENGTH, 3, connection="mqtt-1")
        assert conflicting_metrics(snapshot, other) is None


class TestKpi:
    def _snapshots(self, *records):
        return {record.machine_id: record for record in records}

    def test_bos_hatta_hepsi_none(self):
        kpi = aggregate_kpi({})
        assert kpi.production is None
        assert kpi.queue is None
        assert kpi.availability is None
        assert kpi.total_machines == 0

    def test_uretim_toplanir(self):
        snapshots = self._snapshots(
            MachineSnapshotRecord(machine_id="A", production_count=10),
            MachineSnapshotRecord(machine_id="B", production_count=5),
        )
        assert aggregate_kpi(snapshots).production == 15

    def test_olculmeyen_makine_sifir_sayilmaz(self):
        snapshots = self._snapshots(
            MachineSnapshotRecord(machine_id="A", production_count=10),
            MachineSnapshotRecord(machine_id="B"),
        )
        kpi = aggregate_kpi(snapshots)
        assert kpi.production == 10
        assert kpi.measured_machines == 1
        assert kpi.total_machines == 2

    def test_hicbiri_olculmemisse_toplam_none(self):
        snapshots = self._snapshots(MachineSnapshotRecord(machine_id="A"))
        assert aggregate_kpi(snapshots).production is None

    def test_kuyruk_toplanir(self):
        snapshots = self._snapshots(
            MachineSnapshotRecord(machine_id="A", queue_length=2),
            MachineSnapshotRecord(machine_id="B", queue_length=3),
        )
        assert aggregate_kpi(snapshots).queue == 5

    def test_calisan_makine_sayilir(self):
        snapshots = self._snapshots(
            MachineSnapshotRecord(machine_id="A", status=RUNNING),
            MachineSnapshotRecord(machine_id="B", status=DOWN),
        )
        kpi = aggregate_kpi(snapshots)
        assert kpi.active_machines == 1

    def test_kullanilabilirlik_bildirilen_durumlardan_hesaplanir(self):
        snapshots = self._snapshots(
            MachineSnapshotRecord(machine_id="A", status=RUNNING),
            MachineSnapshotRecord(machine_id="B", status=DOWN),
        )
        assert aggregate_kpi(snapshots).availability == 0.5

    def test_bilinmeyen_durum_durus_sayilmaz(self):
        # Izlenmeyen bir hatti arizali gostermek yanlis olurdu.
        snapshots = self._snapshots(
            MachineSnapshotRecord(machine_id="A", status=RUNNING),
            MachineSnapshotRecord(machine_id="B", status=UNKNOWN),
        )
        kpi = aggregate_kpi(snapshots)
        assert kpi.availability == 1.0
        assert kpi.unknown_machines == 1

    def test_hicbir_durum_bildirilmezse_kullanilabilirlik_none(self):
        snapshots = self._snapshots(MachineSnapshotRecord(machine_id="A"))
        assert aggregate_kpi(snapshots).availability is None

    def test_durus_suresi_toplanir(self):
        snapshots = self._snapshots(
            MachineSnapshotRecord(machine_id="A", downtime_minutes=12),
            MachineSnapshotRecord(machine_id="B", downtime_minutes=3),
        )
        assert aggregate_kpi(snapshots).downtime_minutes == 15

    def test_hiz_toplanir(self):
        snapshots = self._snapshots(
            MachineSnapshotRecord(machine_id="A", throughput_per_hour=30),
            MachineSnapshotRecord(machine_id="B", throughput_per_hour=20),
        )
        assert aggregate_kpi(snapshots).throughput == 50

    def test_sozluge_cevrilir(self):
        payload = aggregate_kpi({}).to_dict()
        assert payload["production"] is None
        assert payload["total_machines"] == 0


class TestStaleSnapshots:
    def test_taze_goruntu_eskimis_sayilmaz(self):
        snapshots = {
            "A": MachineSnapshotRecord(machine_id="A", updated_at_ms=9_000),
        }
        assert stale_snapshots(snapshots, now_ms=10_000, max_age_ms=5_000) == []

    def test_eski_goruntu_bildirilir(self):
        # "Veri akiyor" ile "veri akiyordu" farklidir.
        snapshots = {
            "A": MachineSnapshotRecord(machine_id="A", updated_at_ms=1_000),
        }
        assert stale_snapshots(snapshots, now_ms=100_000, max_age_ms=5_000) == ["A"]

    def test_hic_guncellenmemis_goruntu_sayilmaz(self):
        snapshots = {"A": MachineSnapshotRecord(machine_id="A")}
        assert stale_snapshots(snapshots, now_ms=100_000, max_age_ms=5_000) == []


class TestSerialization:
    def test_sozlukte_durum_etiketi_var(self):
        record = MachineSnapshotRecord(machine_id="A", status=BLOCKED)
        assert record.to_dict()["status_label"] == "Bloke"

    def test_olculmeyen_alanlar_none_doner(self):
        payload = MachineSnapshotRecord(machine_id="A").to_dict()
        assert payload["production_count"] is None
        assert payload["queue_length"] is None

    def test_kaynaklar_kopyalanir(self):
        record = MachineSnapshotRecord(machine_id="A", sources={"x": "c1"})
        payload = record.to_dict()
        payload["sources"]["x"] = "degisti"
        assert record.sources["x"] == "c1"

    def test_value_of_okur(self):
        record = MachineSnapshotRecord(machine_id="A", queue_length=4)
        assert record.value_of(Metric.QUEUE_LENGTH) == 4
