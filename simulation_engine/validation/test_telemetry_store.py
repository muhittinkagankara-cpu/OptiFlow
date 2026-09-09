# -*- coding: utf-8 -*-
"""Kalici telemetri deposunun testleri.

Bu dosya uc soruyu yanitlar:

1. Olcumler diske dogru yaziliyor mu, tekrar gonderilen olcum cift satir
   yaratiyor mu?
2. Saklama temizligi dogru sinirdan mi kesiyor ve turlara mi boluyor?
3. Trend hesabi bos kovada sifir mi gosteriyor, yoksa "olculmedi" mi?

Ucuncusu bu sprintin en onemli davranisidir: bos bir kovaya sifir yazmak,
cihazin kapali oldugu saatleri "uretim sifira dustu" gibi gosterirdi.
"""

from __future__ import annotations

import os
import tempfile

import pytest

from simulation_engine.runtime.persistence.repository import (
    DatabaseRuntimeRepository,
    InMemoryRuntimeRepository,
)
from simulation_engine.runtime.telemetry import (
    BATCH_SIZE,
    CleanupJob,
    DEFAULT_RETENTION_DAYS,
    MAX_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
    RetentionPolicy,
    TREND_WINDOWS,
    TelemetryBatch,
    TelemetryPoint,
    TelemetryWriter,
    bucket_index,
    build_series,
    clamp_retention_days,
    cutoff_ms,
    empty_buckets,
    excluded_count,
    load_series,
    point_key,
    series_summary,
    window_of,
    writes_per_second,
)
from simulation_engine.runtime.telemetry.retention import DAY_MS
from simulation_engine.runtime.telemetry.writer import THROUGHPUT_WINDOW_MS

ORG = "org-telemetri"
OTHER = "org-baska"
NOW = 1_700_000_000_000


def point(
    offset_ms: int = 0,
    value: float = 10.0,
    device: str = "FREZE_01",
    tag: str = "production_count",
    quality: str = "good",
    source: str = "plc-1",
) -> TelemetryPoint:
    return TelemetryPoint(
        timestamp_ms=NOW + offset_ms,
        device=device,
        tag=tag,
        value=value,
        quality=quality,
        source=source,
    )


@pytest.fixture(params=["bellek", "veritabani"])
def repository(request):
    """Iki depo da ayni testlerden gecer.

    Arayuzleri ayni oldugu icin cagiran taraf hangisini kullandigini bilmez;
    davranislari da ayni olmalidir, yoksa yerel gelistirme ile yayin ortami
    farkli sonuc uretirdi.
    """
    if request.param == "bellek":
        yield InMemoryRuntimeRepository()
        return
    path = os.path.join(tempfile.mkdtemp(), "telemetri.db")
    yield DatabaseRuntimeRepository(f"sqlite:///{path}")


# ---------------------------------------------------------------- modeller


class TestOlcumModeli:
    def test_iyi_kaliteli_olcum_kullanilabilir(self):
        assert point().is_usable is True

    def test_bozuk_kaliteli_olcum_kullanilamaz(self):
        assert point(quality="bad").is_usable is False

    def test_degeri_olmayan_olcum_kullanilamaz(self):
        assert point(value=None).is_usable is False

    def test_belirsiz_kalite_kullanilabilir(self):
        # Karsit ornek: yalnizca "bad" disarida kalir; "uncertain" veri tasir.
        assert point(quality="uncertain").is_usable is True

    def test_sozluk_kullanilabilirligi_tasir(self):
        assert point(quality="bad").to_dict()["usable"] is False

    def test_sozlukte_kaynak_korunur(self):
        assert point().to_dict()["source"] == "plc-1"

    def test_olcum_degistirilemez(self):
        with pytest.raises(Exception):
            point().value = 5.0


class TestAnahtar:
    def test_anahtar_kiraci_cihaz_etiket_ve_ani_icerir(self):
        key = point_key(ORG, point())
        assert key == f"{ORG}::FREZE_01::production_count::{NOW}"

    def test_farkli_kiraci_farkli_anahtar(self):
        assert point_key(ORG, point()) != point_key(OTHER, point())

    def test_farkli_cihaz_farkli_anahtar(self):
        assert point_key(ORG, point()) != point_key(ORG, point(device="TORNA_02"))

    def test_farkli_etiket_farkli_anahtar(self):
        assert point_key(ORG, point()) != point_key(ORG, point(tag="scrap_count"))

    def test_ayni_an_ayni_anahtar(self):
        # Deger degisse bile anahtar aynidir: ayni etiket ayni anda iki deger alamaz.
        assert point_key(ORG, point(value=1.0)) == point_key(ORG, point(value=9.0))


class TestTampon:
    def test_bos_tampon(self):
        assert TelemetryBatch().is_empty is True

    def test_kapasiteye_ulasmadan_dolu_degil(self):
        batch = TelemetryBatch(capacity=3)
        assert batch.add(point()) is False

    def test_kapasitede_dolu(self):
        batch = TelemetryBatch(capacity=2)
        batch.add(point())
        assert batch.add(point(1)) is True

    def test_bosaltma_icerigi_dondurur(self):
        batch = TelemetryBatch(capacity=5)
        batch.add(point())
        assert len(batch.drain()) == 1

    def test_bosaltma_sonrasi_tampon_bos(self):
        batch = TelemetryBatch(capacity=5)
        batch.add(point())
        batch.drain()
        assert batch.is_empty is True

    def test_toplu_ekleme(self):
        batch = TelemetryBatch(capacity=2)
        assert batch.extend([point(), point(1)]) is True

    def test_varsayilan_kapasite(self):
        assert TelemetryBatch().capacity == BATCH_SIZE


# ------------------------------------------------------------------- depo


class TestDepoYazma:
    def test_yazilan_satir_sayisi(self, repository):
        assert repository.write_telemetry(ORG, [point(), point(1)]) == 2

    def test_tekrar_gonderilen_olcum_yeni_satir_degil(self, repository):
        repository.write_telemetry(ORG, [point()])
        assert repository.write_telemetry(ORG, [point()]) == 0

    def test_tekrar_gonderilen_olcum_sayimi_artirmaz(self, repository):
        repository.write_telemetry(ORG, [point()])
        repository.write_telemetry(ORG, [point()])
        assert repository.telemetry_count(ORG) == 1

    def test_tekrar_gonderilen_olcum_degeri_gunceller(self, repository):
        repository.write_telemetry(ORG, [point(value=1.0)])
        repository.write_telemetry(ORG, [point(value=7.0)])
        assert repository.query_telemetry(ORG)[0].value == 7.0

    def test_bos_liste_yazmaz(self, repository):
        assert repository.write_telemetry(ORG, []) == 0

    def test_kiracilar_ayri(self, repository):
        repository.write_telemetry(ORG, [point()])
        assert repository.telemetry_count(OTHER) == 0

    def test_bozuk_kaliteli_olcum_de_yazilir(self, repository):
        # Kaydedilmeseydi, sensorun ne zaman bozuldugu geriye donuk gorulemezdi.
        repository.write_telemetry(ORG, [point(quality="bad")])
        assert repository.telemetry_count(ORG) == 1

    def test_degeri_olmayan_olcum_de_yazilir(self, repository):
        repository.write_telemetry(ORG, [point(value=None)])
        assert repository.query_telemetry(ORG)[0].value is None

    def test_kaynak_korunur(self, repository):
        repository.write_telemetry(ORG, [point(source="opc-1")])
        assert repository.query_telemetry(ORG)[0].source == "opc-1"

    def test_kaynaksiz_olcum_null_kalir(self, repository):
        repository.write_telemetry(ORG, [point(source=None)])
        assert repository.query_telemetry(ORG)[0].source is None


class TestDepoSorgu:
    def test_zaman_sirasinda_doner(self, repository):
        repository.write_telemetry(ORG, [point(5_000), point(0), point(2_000)])
        stamps = [item.timestamp_ms for item in repository.query_telemetry(ORG)]
        assert stamps == sorted(stamps)

    def test_cihaza_gore_suzer(self, repository):
        repository.write_telemetry(ORG, [point(), point(1, device="TORNA_02")])
        assert len(repository.query_telemetry(ORG, device="TORNA_02")) == 1

    def test_etikete_gore_suzer(self, repository):
        repository.write_telemetry(ORG, [point(), point(1, tag="scrap_count")])
        assert len(repository.query_telemetry(ORG, tag="scrap_count")) == 1

    def test_baslangic_dahildir(self, repository):
        repository.write_telemetry(ORG, [point(0), point(1_000)])
        assert len(repository.query_telemetry(ORG, start_ms=NOW)) == 2

    def test_bitis_dahildir(self, repository):
        repository.write_telemetry(ORG, [point(0), point(1_000)])
        assert len(repository.query_telemetry(ORG, end_ms=NOW + 1_000)) == 2

    def test_aralik_disi_atilir(self, repository):
        repository.write_telemetry(ORG, [point(0), point(10_000)])
        found = repository.query_telemetry(ORG, start_ms=NOW + 1, end_ms=NOW + 9_999)
        assert found == []

    def test_sinir_uygulanir(self, repository):
        repository.write_telemetry(ORG, [point(index) for index in range(10)])
        assert len(repository.query_telemetry(ORG, limit=3)) == 3

    def test_sinir_en_eskiyi_verir(self, repository):
        repository.write_telemetry(ORG, [point(index * 1_000) for index in range(5)])
        found = repository.query_telemetry(ORG, limit=2)
        assert found[0].timestamp_ms == NOW

    def test_bos_depoda_sorgu_bos_liste(self, repository):
        assert repository.query_telemetry(ORG) == []


class TestDepoOzet:
    def test_etiket_listesi(self, repository):
        repository.write_telemetry(ORG, [point(), point(1, tag="scrap_count")])
        assert repository.telemetry_tags(ORG) == [
            ("FREZE_01", "production_count"),
            ("FREZE_01", "scrap_count"),
        ]

    def test_etiket_listesi_tekrarsiz(self, repository):
        repository.write_telemetry(ORG, [point(0), point(1_000)])
        assert len(repository.telemetry_tags(ORG)) == 1

    def test_bos_depoda_etiket_yok(self, repository):
        assert repository.telemetry_tags(ORG) == []

    def test_en_eski_olcum(self, repository):
        repository.write_telemetry(ORG, [point(5_000), point(0)])
        assert repository.oldest_telemetry_ms(ORG) == NOW

    def test_bos_depoda_en_eski_none(self, repository):
        # Sifir donseydi, bos bir tablo "1970'ten beri veri var" gibi okunurdu.
        assert repository.oldest_telemetry_ms(ORG) is None

    def test_baska_kiracinin_verisi_en_eskiyi_etkilemez(self, repository):
        repository.write_telemetry(OTHER, [point()])
        assert repository.oldest_telemetry_ms(ORG) is None


class TestDepoTemizlik:
    def test_kesimden_eski_silinir(self, repository):
        repository.write_telemetry(ORG, [point(0), point(10_000)])
        assert repository.delete_telemetry_before(ORG, NOW + 5_000) == 1

    def test_kesim_ani_silinmez(self, repository):
        # Kesim aninin kendisi saklanir: sinir dahildir.
        repository.write_telemetry(ORG, [point(0)])
        assert repository.delete_telemetry_before(ORG, NOW) == 0

    def test_silinmeyen_kalir(self, repository):
        repository.write_telemetry(ORG, [point(0), point(10_000)])
        repository.delete_telemetry_before(ORG, NOW + 5_000)
        assert repository.telemetry_count(ORG) == 1

    def test_tur_siniri_uygulanir(self, repository):
        repository.write_telemetry(ORG, [point(index) for index in range(10)])
        assert repository.delete_telemetry_before(ORG, NOW + 100, limit=4) == 4

    def test_baska_kiraci_etkilenmez(self, repository):
        repository.write_telemetry(OTHER, [point(0)])
        repository.delete_telemetry_before(ORG, NOW + 100_000)
        assert repository.telemetry_count(OTHER) == 1

    def test_silinecek_yoksa_sifir(self, repository):
        assert repository.delete_telemetry_before(ORG, NOW) == 0

    def test_temizlik_en_eskiden_baslar(self, repository):
        repository.write_telemetry(ORG, [point(index * 1_000) for index in range(5)])
        repository.delete_telemetry_before(ORG, NOW + 10_000, limit=2)
        assert repository.oldest_telemetry_ms(ORG) == NOW + 2_000

    def test_temizlik_sonrasi_bos_depo_en_eski_none(self, repository):
        repository.write_telemetry(ORG, [point(0)])
        repository.delete_telemetry_before(ORG, NOW + 1)
        assert repository.oldest_telemetry_ms(ORG) is None
