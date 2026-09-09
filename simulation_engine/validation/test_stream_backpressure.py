"""Sınırlı kuyruk ve olay düşürme.

Bu dosyanın koruduğu üç davranış:

1. **Kuyruk sınırlıdır.** Sınırsız olsaydı, tüketici bir saniye yavaşladığında
   bellek büyümeye başlar ve sunucu saatler içinde çökerdi.
2. **En eski düşürülür.** Bir üretim ekranında en değerli olay en yenisidir;
   yeni olayı reddetmek ekranı geçmişte dondurmak olurdu.
3. **Kayıp sayılır.** Sessizce kaybolan bir olay, ekrandaki üretim sayısını
   gerçeğin altında bırakır ve kimse nedenini bilemez.
"""

from __future__ import annotations

import pytest

from simulation_engine.runtime.stream.backpressure import (
    DEFAULT_CAPACITY,
    PRESSURE_RATIO,
    BoundedEventQueue,
    loss_ratio,
)


class TestKuyrukKurulumu:
    def test_varsayilan_sinir(self):
        assert BoundedEventQueue().capacity == DEFAULT_CAPACITY

    def test_ozel_sinir_kabul_edilir(self):
        assert BoundedEventQueue(capacity=10).capacity == 10

    def test_sifir_sinir_bire_cekilir(self):
        """Sıfır sınır, her olayı düşüren bir kuyruk demek olurdu."""
        assert BoundedEventQueue(capacity=0).capacity == 1

    def test_negatif_sinir_bire_cekilir(self):
        assert BoundedEventQueue(capacity=-5).capacity == 1

    def test_bos_kuyruk_derinligi_sifir(self):
        assert BoundedEventQueue().depth == 0

    def test_bos_kuyruk_dolu_degil(self):
        assert BoundedEventQueue().is_full is False


class TestEklemeVeDusurme:
    def test_olay_eklenir(self):
        queue = BoundedEventQueue(capacity=3)
        assert queue.push("a") is None
        assert queue.depth == 1

    def test_sinira_kadar_dusurme_yok(self):
        queue = BoundedEventQueue(capacity=3)
        for item in "abc":
            assert queue.push(item) is None
        assert queue.dropped == 0

    def test_sinir_asilinca_en_eski_duser(self):
        queue = BoundedEventQueue(capacity=3)
        queue.extend("abc")
        assert queue.push("d") == "a"

    def test_dusurme_sayilir(self):
        queue = BoundedEventQueue(capacity=2)
        queue.extend("abcd")
        assert queue.dropped == 2

    def test_en_yeni_olay_kuyrukta_kalir(self):
        """En yeni ölçüm, ekranın gösterdiği şeydir; asla düşürülmez."""
        queue = BoundedEventQueue(capacity=2)
        queue.extend("abcd")
        assert queue.drain() == ["c", "d"]

    def test_toplu_ekleme_dusurulen_sayisini_verir(self):
        queue = BoundedEventQueue(capacity=2)
        assert queue.extend("abcde") == 3

    def test_dolu_kuyruk_isaretlenir(self):
        queue = BoundedEventQueue(capacity=2)
        queue.extend("ab")
        assert queue.is_full is True

    def test_tepe_derinlik_kaydedilir(self):
        queue = BoundedEventQueue(capacity=5)
        queue.extend("abc")
        queue.drain()
        assert queue.peak_depth == 3


class TestBaskiEsigi:
    def test_esik_yuzde_seksen(self):
        assert PRESSURE_RATIO == 0.8

    def test_bos_kuyruk_baski_altinda_degil(self):
        assert BoundedEventQueue(capacity=10).under_pressure is False

    def test_esigin_altinda_baski_yok(self):
        queue = BoundedEventQueue(capacity=10)
        queue.extend(range(7))
        assert queue.under_pressure is False

    def test_esikte_baski_var(self):
        """Yüzde yüzü beklemek geç olurdu; kullanıcıya zaman tanınmalı."""
        queue = BoundedEventQueue(capacity=10)
        queue.extend(range(8))
        assert queue.under_pressure is True

    def test_doluluk_orani_hesaplanir(self):
        queue = BoundedEventQueue(capacity=4)
        queue.extend("ab")
        assert queue.fill_ratio == 0.5


class TestOkumaVeBosaltma:
    def test_en_eski_once_okunur(self):
        queue = BoundedEventQueue(capacity=5)
        queue.extend("abc")
        assert queue.pop() == "a"

    def test_bos_kuyruktan_okuma_none(self):
        assert BoundedEventQueue().pop() is None

    def test_bakma_kuyrugu_degistirmez(self):
        queue = BoundedEventQueue(capacity=5)
        queue.extend("abc")
        assert queue.peek() == "a"
        assert queue.depth == 3

    def test_bos_kuyrukta_bakma_none(self):
        assert BoundedEventQueue().peek() is None

    def test_bosaltma_hepsini_verir(self):
        queue = BoundedEventQueue(capacity=5)
        queue.extend("abc")
        assert queue.drain() == ["a", "b", "c"]
        assert queue.depth == 0

    def test_sinirli_bosaltma(self):
        queue = BoundedEventQueue(capacity=5)
        queue.extend("abcd")
        assert queue.drain(2) == ["a", "b"]
        assert queue.depth == 2

    def test_sinirdan_fazla_istenirse_var_olan_doner(self):
        queue = BoundedEventQueue(capacity=5)
        queue.extend("ab")
        assert queue.drain(10) == ["a", "b"]

    def test_temizleme_kuyrugu_bosaltir(self):
        queue = BoundedEventQueue(capacity=5)
        queue.extend("abc")
        queue.clear()
        assert queue.depth == 0

    def test_temizleme_kayip_sayacini_korur(self):
        """Kayıp bilgisi, kuyruk boşaltılınca da kaybolmamalı."""
        queue = BoundedEventQueue(capacity=2)
        queue.extend("abcd")
        queue.clear()
        assert queue.dropped == 2

    def test_sayac_sifirlama_ayri_islemdir(self):
        queue = BoundedEventQueue(capacity=2)
        queue.extend("abcd")
        queue.reset_counters()
        assert queue.dropped == 0

    def test_uzunluk_operatoru_calisir(self):
        queue = BoundedEventQueue(capacity=5)
        queue.extend("abc")
        assert len(queue) == 3


class TestKuyrukSozlugu:
    def test_butun_alanlar_yazilir(self):
        payload = BoundedEventQueue(capacity=4).to_dict()
        assert set(payload) == {
            "depth",
            "capacity",
            "dropped",
            "peak_depth",
            "fill_ratio",
            "full",
            "under_pressure",
        }

    def test_doluluk_yuvarlanir(self):
        queue = BoundedEventQueue(capacity=3)
        queue.push("a")
        assert payload_ratio(queue) == round(1 / 3, 4)

    def test_kayip_sozlukte_gorunur(self):
        queue = BoundedEventQueue(capacity=1)
        queue.extend("ab")
        assert queue.to_dict()["dropped"] == 1


def payload_ratio(queue: BoundedEventQueue) -> float:
    return queue.to_dict()["fill_ratio"]


class TestKayipOrani:
    def test_kayipsiz_akista_sifir(self):
        """Ölçülmüş sıfır: olay aktı ve hiçbiri düşmedi."""
        assert loss_ratio(100, 0) == 0.0

    def test_yarisi_dusmusse_yarim(self):
        assert loss_ratio(50, 50) == 0.5

    def test_hepsi_dusmusse_bir(self):
        assert loss_ratio(0, 10) == 1.0

    def test_hic_olay_yoksa_none(self):
        """Sıfır dönmek, hiç veri akmamış bir akışı "kayıpsız" göstermek olurdu."""
        assert loss_ratio(0, 0) is None

    def test_negatif_degerler_sifir_sayilir(self):
        assert loss_ratio(-5, -5) is None

    def test_oran_sifir_bir_arasinda(self):
        assert 0.0 <= loss_ratio(30, 70) <= 1.0
