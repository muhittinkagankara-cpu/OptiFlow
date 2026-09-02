"""Stok tükenme riski simülasyonunun doğrulaması.

Bu simülasyon bir uyarı üretir ("30 günde %X ihtimalle stok tükenir") ve
uyarılar sessizce yanlış olduğunda en zararlıdır: kullanıcı yanlış bir güvenle
sipariş vermez ya da gereksiz yere stok yığar. Bu yüzden testler yalnızca
"çalışıyor mu" diye bakmaz; sonucun **analitik olarak bilinen** değerlerle
örtüştüğünü sınar.

En güçlü çıpa dalgalanmasız senaryodur: talep hiç sapmıyorsa tükenme günü
kalemle hesaplanabilir ve simülasyonun tam olarak o günü bulması gerekir.

Ayrıca kabul kriteri gereği güven aralıklarının üretim simülasyonuyla **aynı**
fonksiyondan geldiği doğrulanır; iki modülün aynı istatistiği iki ayrı biçimde
hesaplaması, aralarındaki farkların açıklanamaz hâle gelmesi demek olurdu.
"""

from __future__ import annotations

import pytest

from simulation_engine.analytics.inventory import (
    DEFAULT_STOCKOUT_REPLICATIONS,
    simulate_stockout_risk,
)
from simulation_engine.models.schemas import InventoryItem


def item(**overrides) -> InventoryItem:
    payload = {
        "id": "ham-kumas",
        "name": "Ham Kumaş",
        "unit": "metre",
        "current_stock": 400.0,
        "unit_cost": 25.0,
        "lead_time_days": 7.0,
        "daily_demand_avg": 40.0,
        "daily_demand_std": 0.0,
        "ordering_cost": 150.0,
        "holding_cost_rate": 0.2,
    }
    payload.update(overrides)
    return InventoryItem.model_validate(payload)


# --------------------------------------------------------------------------- #
# 1. Dalgalanmasız senaryo — analitik çıpa
# --------------------------------------------------------------------------- #


def test_deterministic_depletion_day_is_exact() -> None:
    """Talep hic sapmiyorsa tukenme gunu kalemle hesaplanabilir.

    400 metre stok, gunde tam 40 metre tuketim: stok 10. gunun sonunda tam
    sifirlanir. Simulasyonun baska bir gun bulmasi, gunluk dongude bir kayma
    (off-by-one) oldugunu gosterirdi.
    """
    report = simulate_stockout_risk(
        item(current_stock=400.0, daily_demand_avg=40.0, daily_demand_std=0.0),
        horizon_days=30,
        num_replications=20,
        master_seed=1,
    )

    assert report.stockout_probability == 1.0
    assert report.mean_first_stockout_day == pytest.approx(10.0)
    # 10. gunun sonunda tukendi; 11-30 arasi 20 gun bos, artı tukendigi gun.
    assert report.expected_stockout_days.mean == pytest.approx(21.0)


def test_deterministic_projection_matches_arithmetic() -> None:
    """Her gunun ortalama stogu, dogrudan cikarma ile ayni olmali."""
    report = simulate_stockout_risk(
        item(current_stock=400.0, daily_demand_avg=40.0, daily_demand_std=0.0),
        horizon_days=10,
        num_replications=5,
        master_seed=2,
    )

    assert report.projection[0].mean_stock == pytest.approx(400.0)
    assert report.projection[5].mean_stock == pytest.approx(200.0)
    assert report.projection[10].mean_stock == pytest.approx(0.0)


def test_ample_stock_never_runs_out() -> None:
    """Ufuk boyunca yetecek stokta risk sifir olmali."""
    report = simulate_stockout_risk(
        item(current_stock=10_000.0, daily_demand_avg=40.0, daily_demand_std=5.0),
        horizon_days=30,
        num_replications=200,
        master_seed=3,
    )

    assert report.stockout_probability == 0.0
    assert report.expected_stockout_days.mean == 0.0
    assert report.mean_first_stockout_day is None
    assert "tükenmesi" in report.headline


# --------------------------------------------------------------------------- #
# 2. Yapısal özellikler
# --------------------------------------------------------------------------- #


def test_stock_never_goes_negative() -> None:
    """Eksi stok, olmayan bir mali varmis gibi saymanin aynasidir."""
    report = simulate_stockout_risk(
        item(current_stock=50.0, daily_demand_avg=40.0, daily_demand_std=10.0),
        horizon_days=30,
        num_replications=100,
        master_seed=4,
    )

    for day in report.projection:
        assert day.mean_stock >= 0.0
        assert day.ci_lower >= 0.0


def test_mean_stock_never_increases() -> None:
    """Yeni siparis gelmedigi varsayildigi icin stok yalnizca azalabilir."""
    report = simulate_stockout_risk(
        item(current_stock=800.0, daily_demand_avg=40.0, daily_demand_std=8.0),
        horizon_days=20,
        num_replications=150,
        master_seed=5,
    )

    levels = [day.mean_stock for day in report.projection]
    for earlier, later in zip(levels, levels[1:]):
        assert later <= earlier + 1e-9


def test_projection_covers_every_day_including_today() -> None:
    """Gun 0 bugunku stoktur; grafigin baslangic noktasi olmadan egri asili kalir."""
    report = simulate_stockout_risk(item(), horizon_days=14, num_replications=30, master_seed=6)

    assert len(report.projection) == 15
    assert report.projection[0].day == 0
    assert report.projection[0].mean_stock == pytest.approx(400.0)
    assert report.projection[-1].day == 14


def test_more_variability_raises_risk() -> None:
    """Ayni ortalama talepte dalgalanma arttikca erken tukenme ihtimali artar."""
    steady = simulate_stockout_risk(
        item(current_stock=1300.0, daily_demand_avg=40.0, daily_demand_std=1.0),
        horizon_days=30,
        num_replications=400,
        master_seed=7,
    )
    volatile = simulate_stockout_risk(
        item(current_stock=1300.0, daily_demand_avg=40.0, daily_demand_std=20.0),
        horizon_days=30,
        num_replications=400,
        master_seed=7,
    )

    assert volatile.stockout_probability > steady.stockout_probability


def test_probability_stays_within_bounds() -> None:
    for stock in [0.0, 100.0, 500.0, 5000.0]:
        report = simulate_stockout_risk(
            item(current_stock=stock, daily_demand_std=10.0),
            horizon_days=30,
            num_replications=50,
            master_seed=8,
        )
        assert 0.0 <= report.stockout_probability <= 1.0


# --------------------------------------------------------------------------- #
# 3. Tekrarlanabilirlik
# --------------------------------------------------------------------------- #


def test_same_seed_reproduces_the_run() -> None:
    """Ayni tohum birebir ayni sonucu vermeli.

    Kullaniciya "%37 ihtimal" denildiginde, sayfa yenilendiginde %41 gormesi
    guveni yok eder.
    """
    kwargs = dict(horizon_days=30, num_replications=100, master_seed=99)
    first = simulate_stockout_risk(item(daily_demand_std=12.0), **kwargs)
    second = simulate_stockout_risk(item(daily_demand_std=12.0), **kwargs)

    assert first.stockout_probability == second.stockout_probability
    assert first.expected_stockout_days.mean == second.expected_stockout_days.mean
    assert [d.mean_stock for d in first.projection] == [
        d.mean_stock for d in second.projection
    ]


def test_reported_seed_can_reproduce_an_unseeded_run() -> None:
    """Tohum verilmezse uretilen tohum raporlanmali ve kosumu tekrarlamali."""
    original = simulate_stockout_risk(
        item(daily_demand_std=12.0), horizon_days=20, num_replications=60
    )
    repeated = simulate_stockout_risk(
        item(daily_demand_std=12.0),
        horizon_days=20,
        num_replications=60,
        master_seed=original.master_seed,
    )

    assert repeated.stockout_probability == original.stockout_probability


def test_different_seeds_give_different_draws() -> None:
    """Farkli tohumlar farkli ornekler uretmeli; aksi halde tohum yok sayiliyordur."""
    # Karsilastirma tukenmeden onceki bir gunde yapilmali: stok sifirlandiktan
    # sonra her tohum ayni degeri (sifir) verir ve test hicbir sey kanitlamaz.
    kwargs = dict(horizon_days=30, num_replications=200)
    first = simulate_stockout_risk(item(daily_demand_std=15.0), master_seed=1, **kwargs)
    second = simulate_stockout_risk(item(daily_demand_std=15.0), master_seed=2, **kwargs)

    assert first.projection[5].mean_stock > 0.0
    assert first.projection[5].mean_stock != second.projection[5].mean_stock


# --------------------------------------------------------------------------- #
# 4. Güven aralığı — mevcut Monte Carlo mantığıyla tutarlılık
# --------------------------------------------------------------------------- #


def test_confidence_interval_uses_shared_monte_carlo_summary() -> None:
    """Aralik, uretim simulasyonuyla ayni fonksiyondan gelmeli.

    Kabul kriteri geregi kod tekrarı yerine `monte_carlo.summarize` yeniden
    kullanilir. Bu test, dondurulen istatistigin o fonksiyonun sozlesmesine
    (ortalama, standart hata, kritik deger, yari genislik) uydugunu dogrular.
    """
    report = simulate_stockout_risk(
        item(current_stock=500.0, daily_demand_std=12.0),
        horizon_days=30,
        num_replications=120,
        master_seed=11,
    )
    statistic = report.expected_stockout_days

    assert statistic.count == 120
    assert statistic.critical_value == pytest.approx(1.96)
    assert statistic.half_width == pytest.approx(
        statistic.critical_value * statistic.standard_error, rel=1e-12
    )
    assert statistic.ci_lower == pytest.approx(statistic.mean - statistic.half_width)
    assert statistic.ci_upper == pytest.approx(statistic.mean + statistic.half_width)


def test_interval_narrows_with_more_replications() -> None:
    """Yari genislik KAREKOK(n) ile daralmali; Monte Carlo'nun temel ozelligi."""
    few = simulate_stockout_risk(
        item(daily_demand_std=12.0), horizon_days=30, num_replications=50, master_seed=12
    )
    many = simulate_stockout_risk(
        item(daily_demand_std=12.0), horizon_days=30, num_replications=800, master_seed=12
    )

    assert many.expected_stockout_days.half_width < few.expected_stockout_days.half_width


def test_projection_interval_brackets_the_mean() -> None:
    report = simulate_stockout_risk(
        item(current_stock=900.0, daily_demand_std=10.0),
        horizon_days=20,
        num_replications=100,
        master_seed=13,
    )

    for day in report.projection:
        assert day.ci_lower <= day.mean_stock <= day.ci_upper


# --------------------------------------------------------------------------- #
# 5. Uç durumlar
# --------------------------------------------------------------------------- #


def test_empty_stock_is_out_from_the_first_day() -> None:
    report = simulate_stockout_risk(
        item(current_stock=0.0), horizon_days=10, num_replications=10, master_seed=14
    )

    assert report.stockout_probability == 1.0
    assert report.mean_first_stockout_day == pytest.approx(1.0)


def test_zero_demand_never_depletes() -> None:
    """Hic tuketilmeyen kalem tukenmez."""
    report = simulate_stockout_risk(
        item(current_stock=10.0, daily_demand_avg=0.0, daily_demand_std=0.0),
        horizon_days=365,
        num_replications=10,
        master_seed=15,
    )

    assert report.stockout_probability == 0.0
    assert report.projection[-1].mean_stock == pytest.approx(10.0)


@pytest.mark.parametrize("horizon", [0, -1])
def test_invalid_horizon_is_rejected(horizon: int) -> None:
    with pytest.raises(ValueError):
        simulate_stockout_risk(item(), horizon_days=horizon)


@pytest.mark.parametrize("replications", [0, -5])
def test_invalid_replication_count_is_rejected(replications: int) -> None:
    with pytest.raises(ValueError):
        simulate_stockout_risk(item(), num_replications=replications)


def test_default_replication_count_is_meaningful() -> None:
    """Varsayilan kosum sayisi, olasiligi yuzde birlik hassasiyetle verecek kadar olmali."""
    assert DEFAULT_STOCKOUT_REPLICATIONS >= 100
