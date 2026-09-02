"""Envanter formüllerinin analitik doğrulaması.

`test_queueing_theory.py` M/M/1 sonuçlarını kapalı form çözümlerle
karşılaştırıyor; bu dosya aynı şeyi envanter tarafı için yapar. İki tür çıpa
kullanılır:

1. **Ders kitabı örnekleri.** Literatürde yayımlanmış, sayısal cevabı bilinen
   problemler. Kodun bağımsız bir kaynakla aynı sonucu vermesi, formülün
   yalnızca "kendi içinde tutarlı" değil *doğru* olduğunu gösterir.

2. **Yapısal özdeşlikler.** EOQ'da sipariş maliyeti ile tutma maliyetinin
   eşitlenmesi gibi, formülün cebirinden çıkan ve sayıdan bağımsız olarak her
   zaman sağlanması gereken ilişkiler. Bunlar, birinin formülü "düzeltmek" için
   değiştirmesi hâlinde ders kitabı örneğinden önce düşer.

Ders kitabı değerleri yuvarlanmış olarak yayımlanır (ör. Z = 1,65). Kod Z'yi
ters normal dağılımdan hesaplar ve daha kesindir; karşılaştırmalar bu yüzden
kaynağın yuvarlama payı kadar toleransla yapılır.
"""

from __future__ import annotations

import math

import pytest

from simulation_engine.analytics.inventory import (
    DAYS_PER_YEAR,
    SERVICE_LEVELS,
    analyze,
    annual_holding_cost_per_unit,
    economic_order_quantity,
    reorder_point,
    safety_stock,
    total_annual_cost,
    z_for_service_level,
)
from simulation_engine.models.schemas import InventoryItem, InventoryStatus


def item(**overrides) -> InventoryItem:
    """Alanlari tek tek ezilebilen bir taban kalem."""
    payload = {
        "id": "kalem",
        "name": "Kalem",
        "unit": "adet",
        "current_stock": 1000.0,
        "unit_cost": 10.0,
        "lead_time_days": 5.0,
        "daily_demand_avg": 10.0,
        "daily_demand_std": 0.0,
        "ordering_cost": 100.0,
        "holding_cost_rate": 0.2,
    }
    payload.update(overrides)
    return InventoryItem.model_validate(payload)


def item_with_annual_demand(
    demand_per_year: float, ordering_cost: float, holding_per_unit: float, **overrides
) -> InventoryItem:
    """Yillik talep ve birim tutma maliyeti verilen bir kalem kurar.

    Ders kitaplari EOQ problemlerini D, S ve H cinsinden verir; bu model ise
    gunluk talep ve tutma **orani** ister. Donusum burada tek yerde yapilir ki
    her testte tekrarlanmasin ve bir cevrim hatasi tum testleri birden
    dusursun.
    """
    unit_cost = overrides.pop("unit_cost", 10.0)
    return item(
        daily_demand_avg=demand_per_year / DAYS_PER_YEAR,
        ordering_cost=ordering_cost,
        unit_cost=unit_cost,
        holding_cost_rate=holding_per_unit / unit_cost,
        **overrides,
    )


# --------------------------------------------------------------------------- #
# 1. Ders kitabı örnekleri — EOQ
# --------------------------------------------------------------------------- #


def test_eoq_heizer_render_sharp_inc() -> None:
    """Heizer & Render, *Operations Management* — Sharp Inc. ornegi.

    D = 1.000 birim/yil, S = 10 TL/siparis, H = 0,50 TL/birim/yil.
    Yayimlanan cevap: EOQ = 200 birim.

    Ornegin cazibesi tam sayi cikmasidir: 2 x 1000 x 10 / 0,5 = 40.000 ve
    karekoku tam 200'dur, yani bir yuvarlama tartismasi yoktur.
    """
    subject = item_with_annual_demand(1000.0, 10.0, 0.50)
    assert economic_order_quantity(subject) == pytest.approx(200.0, rel=1e-9)


def test_eoq_chase_jacobs_example() -> None:
    """Chase & Jacobs, *Operations and Supply Chain Management*.

    D = 1.000 birim/yil, S = 5 TL, H = 1,25 TL/birim/yil.
    Yayimlanan cevap: EOQ ~ 89,44 birim.
    """
    subject = item_with_annual_demand(1000.0, 5.0, 1.25)
    assert economic_order_quantity(subject) == pytest.approx(89.44, abs=0.01)


def test_eoq_stevenson_example() -> None:
    """Stevenson, *Operations Management* — yillik 4.860 birimlik kalem.

    D = 4.860 birim/yil, S = 12,50 TL, H = 0,50 TL/birim/yil.
    Beklenen: sqrt(2 x 4860 x 12,5 / 0,5) = sqrt(243.000) ~ 492,95 birim.
    """
    subject = item_with_annual_demand(4860.0, 12.50, 0.50)
    assert economic_order_quantity(subject) == pytest.approx(math.sqrt(243_000.0), rel=1e-9)


def test_orders_per_year_matches_textbook_example() -> None:
    """Sharp Inc. orneginin devami: yilda 1.000/200 = 5 siparis."""
    report = analyze(item_with_annual_demand(1000.0, 10.0, 0.50))
    assert report.orders_per_year == pytest.approx(5.0, rel=1e-9)
    assert report.days_between_orders == pytest.approx(73.0, rel=1e-9)


# --------------------------------------------------------------------------- #
# 2. Ders kitabı örnekleri — güvenlik stoku ve sipariş noktası
# --------------------------------------------------------------------------- #


def test_reorder_point_without_variability() -> None:
    """Heizer & Render: gunluk talep 8 birim, tedarik 3 gun, dalgalanma yok.

    Yayimlanan cevap: ROP = 24 birim. Dalgalanma olmadigi icin guvenlik stoku
    sifirdir ve sipariş noktasi yalnizca tedarik suresi tuketimidir.
    """
    subject = item(daily_demand_avg=8.0, lead_time_days=3.0, daily_demand_std=0.0)
    assert reorder_point(subject, 0.95) == pytest.approx(24.0, rel=1e-9)
    assert safety_stock(subject, 0.95) == 0.0


def test_safety_stock_textbook_case() -> None:
    """Gunluk sapma 5 birim, tedarik 4 gun, %95 hizmet seviyesi.

    Ders kitabi Z = 1,65 ile hesaplar: 1,65 x 5 x sqrt(4) = 16,5 birim.
    Kod Z'yi ters normal dagilimdan alir (1,6449) ve 16,45 bulur; fark
    kaynagin yuvarlamasindan gelir.
    """
    subject = item(daily_demand_std=5.0, lead_time_days=4.0)
    assert safety_stock(subject, 0.95) == pytest.approx(16.5, abs=0.1)


def test_reorder_point_combines_usage_and_buffer() -> None:
    """ROP = tedarik suresi tuketimi + guvenlik stoku."""
    subject = item(daily_demand_avg=20.0, lead_time_days=9.0, daily_demand_std=4.0)
    expected = 20.0 * 9.0 + safety_stock(subject, 0.95)
    assert reorder_point(subject, 0.95) == pytest.approx(expected, rel=1e-12)


@pytest.mark.parametrize(
    "level,published_z",
    [(0.90, 1.28), (0.95, 1.65), (0.99, 2.33)],
)
def test_z_values_match_published_tables(level: float, published_z: float) -> None:
    """Hesaplanan Z, standart normal tablolardaki yuvarlanmis degerlerle ortusmeli."""
    assert z_for_service_level(level) == pytest.approx(published_z, abs=0.01)


# --------------------------------------------------------------------------- #
# 3. Yapısal özdeşlikler — sayıdan bağımsız olarak her zaman doğru
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("demand", [500.0, 1000.0, 25_000.0])
@pytest.mark.parametrize("ordering", [5.0, 150.0])
def test_costs_balance_at_eoq(demand: float, ordering: float) -> None:
    """EOQ'da yillik siparis maliyeti, yillik tutma maliyetine esittir.

    EOQ'nun tanimi budur: iki karsit maliyetin kesistigi nokta. Bu ozdeslik
    formulun cebirinden cikar ve sayilardan bagimsizdir; birisi formulu
    "duzeltmek" icin degistirirse ders kitabi orneginden once bu duser.

    Not: burada guvenlik stoku disarida birakilir. Guvenlik stoku parti
    buyuklugunden bagimsiz sabit bir yuktur ve EOQ'nun turevinde yer almaz.
    """
    subject = item_with_annual_demand(demand, ordering, 2.0, daily_demand_std=0.0)
    eoq = economic_order_quantity(subject)

    annual = subject.daily_demand_avg * DAYS_PER_YEAR
    ordering_cost = (annual / eoq) * subject.ordering_cost
    holding_cost = (eoq / 2.0) * annual_holding_cost_per_unit(subject)

    assert ordering_cost == pytest.approx(holding_cost, rel=1e-9)


@pytest.mark.parametrize("factor", [0.5, 0.8, 1.25, 2.0])
def test_eoq_minimises_total_cost(factor: float) -> None:
    """EOQ disindaki her parti buyuklugu daha pahalidir.

    Optimallik iddiasinin dogrudan sinanmasi. Formul yanlis bir noktayi
    isaret etseydi bu test, komsu noktalarin daha ucuz oldugunu gostererek
    duserdi.
    """
    subject = item_with_annual_demand(3600.0, 40.0, 1.0)
    eoq = economic_order_quantity(subject)

    assert total_annual_cost(subject, eoq * factor) > total_annual_cost(subject, eoq)


def test_eoq_scales_with_square_root_of_demand() -> None:
    """Talep dorde katlandiginda EOQ ikiye katlanir.

    Karekok iliskisi EOQ'nun en cok yanlis anlasilan ozelligidir: talep iki
    katina ciktiginda parti buyuklugu iki katina cikmaz. Bu testi gecmek, ustel
    terimin dogru yerde oldugunu gosterir.
    """
    base = item_with_annual_demand(1000.0, 20.0, 1.0)
    quadrupled = item_with_annual_demand(4000.0, 20.0, 1.0)

    assert economic_order_quantity(quadrupled) == pytest.approx(
        2.0 * economic_order_quantity(base), rel=1e-9
    )


def test_safety_stock_scales_with_square_root_of_lead_time() -> None:
    """Tedarik suresi dorde katlandiginda guvenlik stoku ikiye katlanir.

    Karekok, tedarik suresi boyunca bagimsiz gunluk taleplerin varyanslarinin
    toplanmasindan gelir. Dogrudan carpma kullanilsaydi uzun tedarik surelerinde
    guvenlik stoku ciddi bicimde sisirilirdi.
    """
    short = item(lead_time_days=4.0, daily_demand_std=6.0)
    long = item(lead_time_days=16.0, daily_demand_std=6.0)

    assert safety_stock(long, 0.95) == pytest.approx(
        2.0 * safety_stock(short, 0.95), rel=1e-12
    )


def test_higher_service_level_requires_more_safety_stock() -> None:
    """Hizmet seviyesi arttikca tampon buyumeli; sira bozulursa formul terstir."""
    subject = item(daily_demand_std=5.0)
    stocks = [safety_stock(subject, level) for level in SERVICE_LEVELS]
    assert stocks == sorted(stocks)
    assert stocks[0] < stocks[-1]


def test_eoq_is_independent_of_current_stock() -> None:
    """EOQ bir **parti buyuklugu** karari; elde ne kadar oldugu onu degistirmez."""
    empty = item(current_stock=0.0)
    full = item(current_stock=99_999.0)
    assert economic_order_quantity(empty) == economic_order_quantity(full)


# --------------------------------------------------------------------------- #
# 4. Uç durumlar
# --------------------------------------------------------------------------- #


def test_zero_demand_is_reported_as_not_applicable() -> None:
    """Hic tuketilmeyen kalem icin EOQ tanimsizdir; sifira bolme degil anlamsizlik."""
    report = analyze(item(daily_demand_avg=0.0))

    assert report.is_applicable is False
    assert report.economic_order_quantity == 0.0
    assert report.days_of_stock == -1.0
    assert report.status is InventoryStatus.OK
    assert "talep" in report.recommendation.lower()


def test_zero_variability_yields_zero_safety_stock() -> None:
    """Dalgalanma yoksa korunulacak belirsizlik de yoktur."""
    assert safety_stock(item(daily_demand_std=0.0), 0.99) == 0.0


def test_zero_lead_time_yields_zero_safety_stock() -> None:
    """Aninda teslimatta belirsizlige maruz kalinan sure sifirdir."""
    assert safety_stock(item(lead_time_days=0.0, daily_demand_std=10.0), 0.99) == 0.0


@pytest.mark.parametrize("level", [0.0, 1.0, -0.5, 1.5, 95.0])
def test_invalid_service_level_is_rejected(level: float) -> None:
    """Yuzde olarak (95) verilen seviye sessizce kabul edilmemeli."""
    with pytest.raises(ValueError):
        z_for_service_level(level)


# --------------------------------------------------------------------------- #
# 5. Sipariş aciliyeti
# --------------------------------------------------------------------------- #


def test_stock_below_reorder_point_is_critical() -> None:
    subject = item(daily_demand_avg=10.0, lead_time_days=5.0, current_stock=10.0)
    report = analyze(subject)

    assert report.status is InventoryStatus.CRITICAL
    assert "Şimdi" in report.recommendation


def test_stock_approaching_reorder_point_warns() -> None:
    """Esik, uydurulmus bir yuzde degil kalemin kendi tedarik suresidir.

    Stok, siparis noktasina tedarik suresinden kisa surede inecekse kullanici
    hazirlanmalidir. Sabit bir "%20 yakin" esigi, uc gunluk ve altmis gunluk
    tedarik surelerine ayni uyariyi verirdi.
    """
    # ROP = 10 x 5 = 50. Stok 90 ise siparis noktasina (90-50)/10 = 4 gunde
    # iner; tedarik 5 gun surdugu icin uyari verilmeli.
    subject = item(daily_demand_avg=10.0, lead_time_days=5.0, current_stock=90.0)
    assert analyze(subject).status is InventoryStatus.WARNING


def test_ample_stock_is_ok() -> None:
    subject = item(daily_demand_avg=10.0, lead_time_days=5.0, current_stock=1000.0)
    report = analyze(subject)

    assert report.status is InventoryStatus.OK
    assert report.days_of_stock == pytest.approx(100.0, rel=1e-9)


def test_analysis_reports_the_service_level_it_used() -> None:
    """Kullanici hangi hizmet seviyesiyle hesaplandigini gormeli.

    Guvenlik stoku tek basina anlamsizdir; hangi hizmet seviyesine karsilik
    geldigi yazilmadan yorumlanamaz.
    """
    report = analyze(item(daily_demand_std=5.0), service_level=0.99)
    assert report.service_level == 0.99
    assert report.z_value == pytest.approx(2.326, abs=0.001)


def test_holding_cost_includes_safety_stock() -> None:
    """Guvenlik stoku da rafta bekler ve maliyet uretir.

    Disarida birakilsaydi tutma maliyeti oldugundan dusuk gorunur ve yuksek
    hizmet seviyelerinin bedeli gizlenirdi.
    """
    without = analyze(item(daily_demand_std=0.0))
    with_buffer = analyze(item(daily_demand_std=20.0))

    assert with_buffer.safety_stock > 0.0
    assert with_buffer.annual_holding_cost > without.annual_holding_cost


# --------------------------------------------------------------------------- #
# 6. Tedarik süresini karşılama — durum kartıyla tükenme riskinin ayrımı
# --------------------------------------------------------------------------- #


def test_ample_stock_covers_lead_time() -> None:
    """Bol stokta siparis bugun verilse mal zamaninda gelir."""
    report = analyze(item(current_stock=1000.0, daily_demand_avg=10.0, lead_time_days=5.0))
    assert report.covers_lead_time is True


def test_stock_below_reorder_point_may_still_cover_lead_time() -> None:
    """Siparis noktasinin altinda olmak, gec kalmis olmak demek degildir.

    Yeniden siparis noktasi zaten tedarik suresi + guvenlik payi kadar once
    uyarir; tam da bu yuzden "siparis ver" uyarisi aldiginda kullanicinin hala
    vakti vardir.
    """
    # ROP = 10 x 5 = 50; stok 45 ise altinda ama 4,5 gun yetiyor.
    report = analyze(item(current_stock=45.0, daily_demand_avg=10.0, lead_time_days=5.0))
    assert report.status is InventoryStatus.CRITICAL
    assert report.covers_lead_time is False


def test_stock_shorter_than_lead_time_is_flagged() -> None:
    """Stok tedarik suresinden kisaysa siparis vermek tek basina yetmez.

    Bu durumu siradan bir "simdi siparis verin" uyarisiyla ayni kefeye koymak,
    kullanicinin hizlandirilmis tedarik gibi bir onlem alma firsatini
    kacirmasina yol acardi.
    """
    report = analyze(item(current_stock=20.0, daily_demand_avg=10.0, lead_time_days=7.0))

    assert report.covers_lead_time is False
    assert "stoksuz kalacaksınız" in report.recommendation
    assert "hızlandırılmış" in report.recommendation


def test_zero_demand_always_covers_lead_time() -> None:
    """Hic tuketilmeyen kalem tukenmez; tedarik suresi sorusu anlamsizdir."""
    assert analyze(item(daily_demand_avg=0.0)).covers_lead_time is True


def test_sufficient_stock_recommendation_explains_the_stockout_section() -> None:
    """"Yeterli" onerisi, asagidaki tukenme riskiyle celiskiyi onceden acmali.

    Kart "Yeterli" derken risk bolumu "%100 ihtimalle tukenir" diyebilir; ikisi
    farkli sorularin cevabidir. Aciklanmadan yan yana konmalari, kullanicinin
    hangisine guvenecegini bilememesine yol acar.
    """
    report = analyze(item(current_stock=1000.0, daily_demand_avg=10.0, lead_time_days=5.0))

    assert report.status is InventoryStatus.OK
    assert "hiç sipariş verilmediği" in report.recommendation
    assert "zamanında sipariş verildiğinde" in report.recommendation
