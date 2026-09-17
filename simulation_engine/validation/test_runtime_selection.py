"""Sürücü seçimi — canlı ekranı hangi bağlantı besler?

En kritik testler iki kapıyla ilgilidir: doğrulanmamış ya da kopmuş bir
bağlantı **asla** seçilemez. Seçilebilseydi, canlı ekran boş kalır ve boş bir
canlı ekran "fabrika duruyor" diye okunurdu.
"""

from __future__ import annotations

from simulation_engine.runtime.registry import ConnectionState
from simulation_engine.runtime.selection import (
    DRIVER_PRIORITY,
    NO_DRIVER_REASON,
    describe_selection,
    eligible_states,
    is_eligible,
    select_driver,
    selection_report,
)
from simulation_engine.runtime.types import (
    ConnectionKind,
    ConnectionSpec,
    ConnectionStatus,
)

ORG = "org-a"


def spec(connection_id: str, kind: ConnectionKind, label: str) -> ConnectionSpec:
    endpoints = {
        ConnectionKind.OPCUA: "opc.tcp://127.0.0.1:4840",
        ConnectionKind.REST: "http://127.0.0.1:9/veri",
        ConnectionKind.MQTT: "mqtt://127.0.0.1:1883",
    }
    return ConnectionSpec(
        connection_id=connection_id,
        kind=kind,
        label=label,
        endpoint=endpoints[kind],
    )


def state(
    connection_id: str,
    kind: ConnectionKind,
    label: str = "Hat",
    *,
    verified: bool = True,
    status: ConnectionStatus = ConnectionStatus.CONNECTED,
) -> ConnectionState:
    item = ConnectionState(spec=spec(connection_id, kind, label), org_id=ORG)
    item.ever_verified = verified
    item.status = status
    return item


class TestUygunluk:
    def test_dogrulanmis_ve_bagli_baglanti_uygundur(self):
        assert is_eligible(state("c1", ConnectionKind.OPCUA)) is True

    def test_dogrulanmamis_baglanti_uygun_degildir(self):
        # Cihazdan hic yanit alinmadi; secilirse ekran bos kalir.
        assert is_eligible(state("c1", ConnectionKind.OPCUA, verified=False)) is False

    def test_kopmus_baglanti_uygun_degildir(self):
        # Bir kez dogrulandi ama su anda bagli degil.
        item = state("c1", ConnectionKind.OPCUA, status=ConnectionStatus.FAILED)
        assert is_eligible(item) is False

    def test_yeniden_deneyen_baglanti_uygun_degildir(self):
        item = state("c1", ConnectionKind.OPCUA, status=ConnectionStatus.RETRYING)
        assert is_eligible(item) is False

    def test_uygun_olanlar_kayit_sirasini_korur(self):
        items = [
            state("c1", ConnectionKind.REST, "A"),
            state("c2", ConnectionKind.REST, "B", verified=False),
            state("c3", ConnectionKind.REST, "C"),
        ]
        assert [s.spec.connection_id for s in eligible_states(items)] == ["c1", "c3"]


class TestOncelik:
    def test_opcua_rest_onunde_gelir(self):
        items = [
            state("rest", ConnectionKind.REST, "MES"),
            state("opc", ConnectionKind.OPCUA, "Torna"),
        ]
        choice = select_driver(items)
        assert choice is not None
        assert choice.connection_id == "opc"

    def test_rest_mqtt_onunde_gelir(self):
        items = [
            state("mqtt", ConnectionKind.MQTT, "Broker"),
            state("rest", ConnectionKind.REST, "MES"),
        ]
        choice = select_driver(items)
        assert choice is not None
        assert choice.connection_id == "rest"

    def test_mqtt_tek_basinaysa_secilir(self):
        # MQTT listede olmasaydi, yalnizca MQTT ile bagli dogrulanmis bir
        # fabrika sessizce demo veriye duserdi.
        choice = select_driver([state("mqtt", ConnectionKind.MQTT, "Broker")])
        assert choice is not None
        assert choice.kind is ConnectionKind.MQTT

    def test_oncelik_sirasi_sozlesmesi(self):
        assert DRIVER_PRIORITY == (
            ConnectionKind.OPCUA,
            ConnectionKind.REST,
            ConnectionKind.MQTT,
        )

    def test_dogrulanmamis_opcua_dogrulanmis_resti_gecemez(self):
        # Oncelik tek basina yetmez; once uygunluk kapisi gelir.
        items = [
            state("opc", ConnectionKind.OPCUA, "Torna", verified=False),
            state("rest", ConnectionKind.REST, "MES"),
        ]
        choice = select_driver(items)
        assert choice is not None
        assert choice.connection_id == "rest"

    def test_ayni_turden_ilk_aday_kazanir(self):
        items = [
            state("a", ConnectionKind.OPCUA, "Hat A"),
            state("b", ConnectionKind.OPCUA, "Hat B"),
        ]
        assert select_driver(items).connection_id == "a"

    def test_secim_kararlidir(self):
        items = [
            state("a", ConnectionKind.OPCUA, "Hat A"),
            state("b", ConnectionKind.OPCUA, "Hat B"),
        ]
        assert select_driver(items) == select_driver(items)


class TestDemoyaDusme:
    def test_hic_baglanti_yoksa_none_doner(self):
        assert select_driver([]) is None

    def test_hicbiri_uygun_degilse_none_doner(self):
        items = [
            state("c1", ConnectionKind.OPCUA, verified=False),
            state("c2", ConnectionKind.REST, status=ConnectionStatus.FAILED),
        ]
        assert select_driver(items) is None

    def test_none_gerekcesi_ne_yapilacagini_soyler(self):
        metin = describe_selection(None)
        assert metin == NO_DRIVER_REASON
        assert "benzetim" in metin.lower()
        assert "bağlantıyı doğrulayın" in metin


class TestGerekce:
    def test_secilen_baglantinin_gerekcesi_adini_icerir(self):
        choice = select_driver([state("opc", ConnectionKind.OPCUA, "Torna")])
        assert "Torna" in choice.reason
        assert "OPC UA" in choice.reason

    def test_gerekce_dogrulandi_der(self):
        choice = select_driver([state("rest", ConnectionKind.REST, "MES")])
        assert "doğrulandı" in choice.reason


class TestSecimRaporu:
    def test_aday_yokken_benzetim_isaretlenir(self):
        rapor = selection_report([])
        assert rapor["simulated"] is True
        assert rapor["connection_id"] is None
        assert rapor["kind"] is None
        assert rapor["candidates"] == 0

    def test_aday_varken_benzetim_isaretlenmez(self):
        rapor = selection_report([state("opc", ConnectionKind.OPCUA, "Torna")])
        assert rapor["simulated"] is False
        assert rapor["connection_id"] == "opc"
        assert rapor["kind"] == "opcua"
        assert rapor["label"] == "Torna"

    def test_aday_sayisi_yalnizca_uygunlari_sayar(self):
        items = [
            state("c1", ConnectionKind.OPCUA),
            state("c2", ConnectionKind.REST, verified=False),
            state("c3", ConnectionKind.MQTT),
        ]
        assert selection_report(items)["candidates"] == 2

    def test_rapor_asla_sifira_dusmez(self):
        # Olculmeyen deger sifir degil None olarak gider (Yasa 4).
        rapor = selection_report([])
        assert rapor["label"] is None
