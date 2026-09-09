"""Yedekleme ve geri yükleme.

Sprintin zorunlu senaryosu burada uçtan uca koşulur: **veri oluştur → yedek al
→ sil → geri yükle → doğrula.** Hem bellek deposunda hem gerçek SQLite
üzerinde.

Korunan kararlar:

* Yedek **mantıksal**tır (JSON), dosya kopyası değil: aynı yedek iki motorda
  da yüklenebilir.
* Geri yükleme önce siler: üstüne eklenseydi iki durumun karışımı çıkardı.
* Sağlama tutmayan bir yedek **yüklenmez**: bozuk bir yedeği yüklemek, veriyi
  kaybetmenin en sessiz yoludur.
* Denetim kayıtları geri yüklenmez: değiştirilemez bir günlüğün yedekten
  yeniden yazılması, geçmişin değiştirilebilmesi demek olurdu.
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest

from simulation_engine.runtime.audit import AuditAction, AuditRecorder
from simulation_engine.runtime.ops.backup import (
    BACKUP_FORMAT_VERSION,
    BACKUP_SECTIONS,
    checksum,
    create_backup,
    restore_backup,
    summarize_backup,
    verify_backup,
)
from simulation_engine.runtime.ops.cli import main as cli_main
from simulation_engine.runtime.persistence.downtime import DowntimeEvent
from simulation_engine.runtime.persistence.repository import (
    DatabaseRuntimeRepository,
    InMemoryRuntimeRepository,
    StoredConnection,
    StoredHealth,
)
from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord

ORG = "yedek-org"
NOW = 2_000_000


def seed(repository) -> None:
    """Yedeklenecek gerçek veriyi kurar."""
    repository.save_connection(
        ORG,
        StoredConnection(
            connection_id="plc-1",
            kind="opcua",
            label="Torna PLC",
            endpoint="opc.tcp://127.0.0.1:4840",
            topics=["ns=2;i=2"],
            ever_verified=True,
            mapping=[{"origin": "ns=2;i=2", "machine": "TORNA_01"}],
        ),
    )
    repository.save_snapshot(
        ORG,
        MachineSnapshotRecord(
            machine_id="TORNA_01",
            status="running",
            production_count=162.0,
            updated_at_ms=NOW,
        ),
    )
    repository.save_health(
        ORG, StoredHealth(connection_id="plc-1", packets=120, errors=3)
    )
    repository.save_downtime(ORG, DowntimeEvent("TORNA_01", NOW, end_ms=NOW + 60_000))


@pytest.fixture(params=["memory", "sqlite"])
def repository(request):
    if request.param == "memory":
        return InMemoryRuntimeRepository()
    path = os.path.join(tempfile.mkdtemp(), "backup.db")
    return DatabaseRuntimeRepository(f"sqlite:///{path}")


class TestYedekAlma:
    def test_yedek_uretilir(self, repository):
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        assert payload["org_id"] == ORG

    def test_bicim_surumu_yazilir(self, repository):
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        assert payload["format_version"] == BACKUP_FORMAT_VERSION

    def test_butun_bolumler_var(self, repository):
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        for section in BACKUP_SECTIONS:
            assert section in payload["data"]

    def test_baglanti_yedege_girer(self, repository):
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        assert len(payload["data"]["connections"]) == 1

    def test_goruntu_yedege_girer(self, repository):
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        assert payload["data"]["snapshots"][0]["production_count"] == 162.0

    def test_durus_yedege_girer(self, repository):
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        assert len(payload["data"]["downtime"]) == 1

    def test_saglama_hesaplanir(self, repository):
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        assert payload["checksum"] == checksum(payload)

    def test_ayni_icerik_ayni_saglama(self, repository):
        seed(repository)
        first = create_backup(repository, ORG, clock=lambda: NOW)
        second = create_backup(repository, ORG, clock=lambda: NOW + 5_000)
        assert first["checksum"] == second["checksum"]

    def test_degisen_icerik_farkli_saglama(self, repository):
        seed(repository)
        first = create_backup(repository, ORG, clock=lambda: NOW)
        repository.save_snapshot(
            ORG, MachineSnapshotRecord(machine_id="FREZE_01", status="idle")
        )
        second = create_backup(repository, ORG, clock=lambda: NOW)
        assert first["checksum"] != second["checksum"]

    def test_bos_kiracinin_yedegi_alinabilir(self, repository):
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        assert summarize_backup(payload).total_rows == 0

    def test_ozet_satir_sayar(self, repository):
        seed(repository)
        summary = summarize_backup(create_backup(repository, ORG, clock=lambda: NOW))
        assert summary.counts["connections"] == 1
        assert summary.total_rows >= 4

    def test_kiraci_yalitimi_yedekte_de_surer(self, repository):
        seed(repository)
        payload = create_backup(repository, "baska-org", clock=lambda: NOW)
        assert payload["data"]["connections"] == []


class TestDogrulama:
    def test_saglam_yedekte_sorun_yok(self, repository):
        seed(repository)
        assert verify_backup(create_backup(repository, ORG, clock=lambda: NOW)) == []

    def test_bozulmus_icerik_yakalanir(self, repository):
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        payload["data"]["snapshots"][0]["production_count"] = 999
        problems = verify_backup(payload)
        assert any("Sağlama" in item for item in problems)

    def test_saglama_yoksa_uyarilir(self, repository):
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        del payload["checksum"]
        assert verify_backup(payload)

    def test_bilinmeyen_bicim_reddedilir(self, repository):
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        payload["format_version"] = 99
        assert any("biçimi" in item for item in verify_backup(payload))

    def test_kiraci_yoksa_uyarilir(self, repository):
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        payload["org_id"] = ""
        assert verify_backup(payload)

    def test_veri_bolumu_yoksa_uyarilir(self):
        assert verify_backup({"format_version": BACKUP_FORMAT_VERSION, "org_id": "a"})

    def test_eksik_bolum_yakalanir(self, repository):
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        del payload["data"]["downtime"]
        payload["checksum"] = checksum(payload)
        assert any("downtime" in item for item in verify_backup(payload))


class TestGeriYukleme:
    def test_tam_senaryo(self, repository):
        """Sprintin zorunlu senaryosu: oluştur → yedekle → sil → geri yükle."""
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)

        repository.delete_connection(ORG, "plc-1")
        repository.clear_snapshots(ORG)
        repository.clear_downtime(ORG)
        assert repository.list_connections(ORG) == []

        result = restore_backup(repository, payload)

        assert result.ok is True
        assert [item.connection_id for item in repository.list_connections(ORG)] == [
            "plc-1"
        ]
        assert repository.list_snapshots(ORG)["TORNA_01"].production_count == 162.0
        assert len(repository.list_downtime(ORG)) == 1

    def test_baglanti_alanlari_korunur(self, repository):
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        repository.delete_connection(ORG, "plc-1")
        restore_backup(repository, payload)

        stored = repository.get_connection(ORG, "plc-1")
        assert stored.endpoint == "opc.tcp://127.0.0.1:4840"
        assert stored.topics == ["ns=2;i=2"]
        assert stored.ever_verified is True

    def test_saglik_sayaclari_geri_gelir(self, repository):
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        restore_backup(repository, payload)
        assert repository.get_health(ORG, "plc-1").packets == 120

    def test_geri_yukleme_once_siler(self, repository):
        """Üstüne eklenseydi iki durumun karışımı çıkardı."""
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)

        repository.save_connection(
            ORG,
            StoredConnection(
                connection_id="sonradan",
                kind="rest",
                label="Sonradan",
                endpoint="http://x",
            ),
        )
        restore_backup(repository, payload)

        assert [item.connection_id for item in repository.list_connections(ORG)] == [
            "plc-1"
        ]

    def test_bozuk_yedek_yuklenmez(self, repository):
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        payload["checksum"] = "bozuk"

        result = restore_backup(repository, payload)

        assert result.ok is False
        assert result.error

    def test_bozuk_yedek_veriyi_silmez(self, repository):
        """Doğrulama başarısızsa hiçbir şeye dokunulmamalı."""
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        payload["checksum"] = "bozuk"

        restore_backup(repository, payload)

        assert len(repository.list_connections(ORG)) == 1

    def test_baska_kiraciya_yuklenebilir(self, repository):
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)

        restore_backup(repository, payload, org_id="test-kiraci")

        assert len(repository.list_connections("test-kiraci")) == 1
        assert len(repository.list_connections(ORG)) == 1

    def test_denetim_kayitlari_geri_yuklenmez(self, repository):
        """Değiştirilemez günlük yedekten yeniden yazılamaz."""
        recorder = AuditRecorder(repository=repository, clock=lambda: NOW)
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "plc-1")
        payload = create_backup(repository, ORG, clock=lambda: NOW)

        result = restore_backup(repository, payload)

        assert result.restored["audit"] == 0

    def test_denetim_kayitlari_yedekte_tasinir(self, repository):
        recorder = AuditRecorder(repository=repository, clock=lambda: NOW)
        recorder.record(ORG, AuditAction.CONNECTOR_CONNECT, "plc-1")
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        assert len(payload["data"]["audit"]) == 1

    def test_silinen_satir_sayilir(self, repository):
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        result = restore_backup(repository, payload)
        assert result.removed["connections"] == 1

    def test_json_uzerinden_gecirilebilir(self, repository):
        """Yedek dosyaya yazılıp okunduğunda da geçerli olmalı."""
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)
        roundtrip = json.loads(json.dumps(payload, ensure_ascii=False))
        assert verify_backup(roundtrip) == []


class TestKomutSatiri:
    def _sqlite(self) -> str:
        path = os.path.join(tempfile.mkdtemp(), "cli.db")
        return f"sqlite:///{path}"

    class Output:
        def __init__(self):
            self.lines = []

        def write(self, text):
            self.lines.append(text)

        @property
        def text(self):
            return "".join(self.lines)

    def test_uctan_uca_yedek_ve_geri_yukleme(self):
        url = self._sqlite()
        repository = DatabaseRuntimeRepository(url)
        seed(repository)

        out_file = os.path.join(tempfile.mkdtemp(), "yedek.json")
        output = self.Output()

        assert cli_main(["--database-url", url, "backup", "--org", ORG, "--out", out_file], out=output) == 0
        assert cli_main(["verify", "--file", out_file], out=output) == 0

        repository.delete_connection(ORG, "plc-1")
        assert repository.list_connections(ORG) == []

        assert cli_main(["--database-url", url, "restore", "--file", out_file, "--org", ORG], out=output) == 0
        assert len(DatabaseRuntimeRepository(url).list_connections(ORG)) == 1

    def test_veritabani_yoksa_yedek_alinmaz(self, monkeypatch):
        """Bellek deposundan yedek almak, boş dosya üretip "alındı" demek olurdu."""
        monkeypatch.delenv("DATABASE_URL", raising=False)
        output = self.Output()
        code = cli_main(
            ["backup", "--org", ORG, "--out", os.path.join(tempfile.mkdtemp(), "x.json")],
            out=output,
        )
        assert code == 2
        assert "tanimli degil" in output.text

    def test_bozuk_yedek_geri_yuklenmez(self):
        url = self._sqlite()
        DatabaseRuntimeRepository(url)

        path = os.path.join(tempfile.mkdtemp(), "bozuk.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"format_version": 1, "org_id": ORG, "data": {}}, handle)

        output = self.Output()
        assert cli_main(["--database-url", url, "restore", "--file", path], out=output) == 1
        assert "dogrulanamadi" in output.text

    def test_dogrulama_bozuk_dosyayi_yakalar(self):
        path = os.path.join(tempfile.mkdtemp(), "bozuk.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"format_version": 99, "org_id": "", "data": {}}, handle)

        output = self.Output()
        assert cli_main(["verify", "--file", path], out=output) == 1


class TestSaglamaKararliligi:
    """Sağlama, JSON gidiş-dönüşünde değişmemeli.

    Tarayıcıda görülen gerçek bir hataydı: Python `500.0` yazar, JavaScript
    aynı sayıyı `500` olarak yazar. Arayüzden alınan bir yedek, aynı
    arayüzden geri yüklenemiyor ve "sağlama tutmuyor" hatası veriyordu.
    """

    def test_tam_sayili_float_ile_int_ayni_saglama(self):
        from simulation_engine.runtime.ops.backup import checksum

        floats = {"data": {"snapshots": [{"production_count": 500.0}]}}
        ints = {"data": {"snapshots": [{"production_count": 500}]}}
        assert checksum(floats) == checksum(ints)

    def test_kesirli_sayi_korunur(self):
        from simulation_engine.runtime.ops.backup import checksum

        first = {"data": {"x": [{"v": 1.5}]}}
        second = {"data": {"x": [{"v": 2.5}]}}
        assert checksum(first) != checksum(second)

    def test_javascript_gidis_donusu_dogrulanir(self, repository):
        """Arayüzün yaptığı ayrıştır-yeniden serileştir döngüsü."""
        seed(repository)
        payload = create_backup(repository, ORG, clock=lambda: NOW)

        # JavaScript'in yaptığı şey: ayrıştır, sayıları kendi biçimine çevir,
        # yeniden serileştir.
        roundtrip = json.loads(json.dumps(payload))
        assert verify_backup(roundtrip) == []

    def test_gidis_donusunden_sonra_geri_yuklenebilir(self, repository):
        seed(repository)
        payload = json.loads(json.dumps(create_backup(repository, ORG, clock=lambda: NOW)))
        repository.delete_connection(ORG, "plc-1")

        result = restore_backup(repository, payload)

        assert result.ok is True
        assert repository.get_connection(ORG, "plc-1") is not None

    def test_bool_sayiya_cevrilmez(self):
        from simulation_engine.runtime.ops.backup import normalize

        assert normalize(True) is True
        assert isinstance(normalize(True), bool)

    def test_ic_ice_yapilar_normalize_edilir(self):
        from simulation_engine.runtime.ops.backup import normalize

        assert normalize({"a": [{"b": 3.0}]}) == {"a": [{"b": 3}]}

    def test_metin_degismez(self):
        from simulation_engine.runtime.ops.backup import normalize

        assert normalize("500.0") == "500.0"
