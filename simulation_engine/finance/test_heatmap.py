"""Isı skorunun doğrulaması.

Isı haritası bir hüküm verir: "buraya bak". Yanlış bir ağırlık ya da kayan bir
bant sınırı, üretim müdürünü yanlış istasyona yönlendirir — ve bu, hiç harita
göstermemekten kötüdür çünkü yanlış yönlendirme güvenle birlikte gelir.

Bu yüzden yalnızca formül değil, skorun **iddia etmediği** şeyler de sınanır:
skorun göreli olduğu, en sıcak istasyonun her zaman en pahalı istasyon
olmadığı ve kayıp yokken kimsenin kırmızıya boyanmadığı.
"""

from __future__ import annotations

import pytest

from simulation_engine.finance.heatmap import (
    GREEN_MAX,
    MAX_SCORE,
    ORANGE_MAX,
    WEIGHT_LOSS,
    WEIGHT_SCRAP,
    WEIGHT_UTILIZATION,
    WEIGHT_WAITING,
    YELLOW_MAX,
    band_for,
    clamp01,
    compute_heatmap,
    compute_station_heat,
    scrap_rate,
    top_loss_stations,
)
from simulation_engine.finance.models import HeatBand, StationFinancialImpact
from simulation_engine.finance.test_loss_engine import station


def impact(
    station_id: str = "kesim",
    *,
    name: str = "Kesim",
    total_loss: float = 0.0,
    is_bottleneck: bool = False,
) -> StationFinancialImpact:
    """Yalnızca ısı hesabının okuduğu alanları anlamlı olan bir kayıp kaydı."""
    return StationFinancialImpact(
        station_id=station_id,
        station_name=name,
        downtime_loss=total_loss,
        waiting_loss=0.0,
        scrap_loss=0.0,
        opportunity_loss=0.0,
        total_loss=total_loss,
        is_bottleneck=is_bottleneck,
    )


def metrics(
    station_id: str = "kesim",
    *,
    utilization: float = 0.0,
    blocked_fraction: float = 0.0,
    units_produced: int = 100,
    units_scrapped: int = 0,
):
    """Isı bileşenlerini doğrudan kontrol edebilmek için hazırlanmış metrik."""
    base = station(station_id, units_produced=units_produced, units_scrapped=units_scrapped)
    return base.model_copy(
        update={"utilization": utilization, "blocked_fraction": blocked_fraction}
    )


# --------------------------------------------------------------------------- #
# 1. Ağırlıklar
# --------------------------------------------------------------------------- #


def test_weights_match_the_specification() -> None:
    """%40 kayip, %25 kullanim, %20 bekleme, %15 fire."""
    assert WEIGHT_LOSS == 0.40
    assert WEIGHT_UTILIZATION == 0.25
    assert WEIGHT_WAITING == 0.20
    assert WEIGHT_SCRAP == 0.15


def test_weights_sum_to_one() -> None:
    """Toplam 1.0 olmazsa skor 100'un altinda ya da ustunde sikisirdi."""
    total = WEIGHT_LOSS + WEIGHT_UTILIZATION + WEIGHT_WAITING + WEIGHT_SCRAP
    assert total == pytest.approx(1.0)


# --------------------------------------------------------------------------- #
# 2. Skor hesabı
# --------------------------------------------------------------------------- #


def test_all_inputs_at_maximum_give_one_hundred() -> None:
    heat = compute_station_heat(
        metrics(utilization=1.0, blocked_fraction=1.0, units_produced=0, units_scrapped=10),
        impact(total_loss=1000.0),
        max_loss=1000.0,
    )
    assert heat.score == pytest.approx(MAX_SCORE)
    assert heat.band is HeatBand.RED


def test_all_inputs_at_zero_give_zero() -> None:
    heat = compute_station_heat(metrics(), impact(), max_loss=0.0)
    assert heat.score == 0.0
    assert heat.band is HeatBand.GREEN


def test_each_component_contributes_its_weight() -> None:
    """Tek bir bilesen tam degerdeyken skor, o bilesenin agirligi kadar olur."""
    only_utilization = compute_station_heat(
        metrics(utilization=1.0), impact(), max_loss=0.0
    )
    assert only_utilization.score == pytest.approx(WEIGHT_UTILIZATION * MAX_SCORE)

    only_waiting = compute_station_heat(
        metrics(blocked_fraction=1.0), impact(), max_loss=0.0
    )
    assert only_waiting.score == pytest.approx(WEIGHT_WAITING * MAX_SCORE)

    only_loss = compute_station_heat(
        metrics(), impact(total_loss=500.0), max_loss=500.0
    )
    assert only_loss.score == pytest.approx(WEIGHT_LOSS * MAX_SCORE)

    only_scrap = compute_station_heat(
        metrics(units_produced=0, units_scrapped=5), impact(), max_loss=0.0
    )
    assert only_scrap.score == pytest.approx(WEIGHT_SCRAP * MAX_SCORE)


def test_score_is_the_weighted_sum() -> None:
    heat = compute_station_heat(
        metrics(utilization=0.8, blocked_fraction=0.5, units_produced=90, units_scrapped=10),
        impact(total_loss=250.0),
        max_loss=500.0,
    )
    expected = (
        0.5 * WEIGHT_LOSS
        + 0.8 * WEIGHT_UTILIZATION
        + 0.5 * WEIGHT_WAITING
        + 0.1 * WEIGHT_SCRAP
    ) * MAX_SCORE
    assert heat.score == pytest.approx(expected)


def test_score_never_leaves_zero_hundred() -> None:
    heat = compute_station_heat(
        metrics(utilization=1.5, blocked_fraction=2.0), impact(total_loss=99.0), 1.0
    )
    assert 0.0 <= heat.score <= MAX_SCORE


def test_components_are_exposed_for_the_tooltip() -> None:
    """Bir kutunun NEDEN kirmizi oldugu okunabilmeli."""
    heat = compute_station_heat(
        metrics(utilization=0.9), impact(total_loss=100.0), max_loss=100.0
    )
    names = {item.name for item in heat.components}
    assert names == {"loss", "utilization", "waiting", "scrap"}

    for item in heat.components:
        assert 0.0 <= item.normalized <= 1.0
        assert item.contribution == pytest.approx(
            item.normalized * item.weight * MAX_SCORE
        )

    assert sum(item.contribution for item in heat.components) == pytest.approx(
        heat.score
    )


# --------------------------------------------------------------------------- #
# 3. Bant eşlemesi
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "score,expected",
    [
        (0.0, HeatBand.GREEN),
        (24.99, HeatBand.GREEN),
        (25.0, HeatBand.YELLOW),
        (49.99, HeatBand.YELLOW),
        (50.0, HeatBand.ORANGE),
        (74.99, HeatBand.ORANGE),
        (75.0, HeatBand.RED),
        (100.0, HeatBand.RED),
    ],
)
def test_band_boundaries_are_inclusive_at_the_lower_edge(
    score: float, expected: HeatBand
) -> None:
    """Sinirin hangi tarafa ait oldugu belirsiz birakilmamali.

    Belirsiz birakilsaydi ayni skor iki farkli yerde iki farkli renk alabilirdi.
    """
    assert band_for(score) is expected


def test_band_thresholds_match_the_specification() -> None:
    assert (GREEN_MAX, YELLOW_MAX, ORANGE_MAX) == (25.0, 50.0, 75.0)


# --------------------------------------------------------------------------- #
# 4. Göreli kayıp — ve dürüstlüğü
# --------------------------------------------------------------------------- #


def test_loss_is_normalised_against_the_worst_station() -> None:
    worst = compute_station_heat(metrics(), impact(total_loss=1000.0), 1000.0)
    half = compute_station_heat(metrics(), impact(total_loss=500.0), 1000.0)

    assert worst.components[0].normalized == pytest.approx(1.0)
    assert half.components[0].normalized == pytest.approx(0.5)


def test_no_loss_anywhere_means_no_relative_amplification() -> None:
    """Hicbir istasyonda kayip yoksa kimse 'en kotu' ilan edilmez."""
    heat = compute_station_heat(metrics(), impact(total_loss=0.0), max_loss=0.0)
    assert heat.components[0].normalized == 0.0
    assert heat.is_relative is False


def test_relative_flag_is_set_when_losses_exist() -> None:
    """Skorun goreli oldugu, arayuzun gizleyemeyecegi bicimde isaretlenir.

    Kayiplarin tamami onemsizse bile en kotu istasyon kirmiziya boyanir; bu
    yuzden mutlak tutar skorla BIRLIKTE tasinir.
    """
    heat = compute_station_heat(metrics(), impact(total_loss=5.0), max_loss=5.0)
    assert heat.is_relative is True
    assert heat.total_loss == 5.0
    assert heat.components[0].normalized == pytest.approx(1.0)


# --------------------------------------------------------------------------- #
# 5. Fire oranı
# --------------------------------------------------------------------------- #


def test_scrap_rate_uses_everything_the_station_handled() -> None:
    """Payda uretilen + hurda; yalnizca uretilene bolunseydi oran 1'i asardi."""
    assert scrap_rate(metrics(units_produced=90, units_scrapped=10)) == pytest.approx(0.1)
    assert scrap_rate(metrics(units_produced=0, units_scrapped=10)) == pytest.approx(1.0)


def test_scrap_rate_of_an_idle_station_is_zero() -> None:
    assert scrap_rate(metrics(units_produced=0, units_scrapped=0)) == 0.0


def test_clamp_handles_out_of_range_and_nan() -> None:
    assert clamp01(-1.0) == 0.0
    assert clamp01(2.0) == 1.0
    assert clamp01(0.5) == 0.5
    assert clamp01(float("nan")) == 0.0


# --------------------------------------------------------------------------- #
# 6. Harita ve sıralama
# --------------------------------------------------------------------------- #


def test_heatmap_is_sorted_hottest_first() -> None:
    heat = compute_heatmap(
        [
            metrics("soguk", utilization=0.1),
            metrics("sicak", utilization=1.0, blocked_fraction=1.0),
        ],
        [impact("soguk", name="Soguk"), impact("sicak", name="Sicak")],
    )
    assert [item.station_id for item in heat] == ["sicak", "soguk"]
    assert heat[0].score > heat[1].score


def test_heatmap_matches_metrics_to_impacts_by_id() -> None:
    heat = compute_heatmap(
        [metrics("a", utilization=1.0), metrics("b", utilization=0.0)],
        [impact("b", name="B"), impact("a", name="A")],
    )
    by_id = {item.station_id: item for item in heat}
    assert by_id["a"].score > by_id["b"].score


def test_mismatched_station_raises_instead_of_guessing() -> None:
    """Eslesmeyen kayit sessizce atlanmaz.

    Sessiz atlama, iki listenin farkli kosumlardan geldigi durumda kullaniciya
    baska bir istasyonun rakamlarini gostermek olurdu.
    """
    with pytest.raises(KeyError):
        compute_heatmap([metrics("a")], [impact("olmayan")])


def test_empty_input_produces_empty_heatmap() -> None:
    assert compute_heatmap([], []) == []


def test_bottleneck_flag_is_carried_through() -> None:
    heat = compute_heatmap(
        [metrics("a")], [impact("a", name="A", is_bottleneck=True)]
    )
    assert heat[0].is_bottleneck is True


# --------------------------------------------------------------------------- #
# 7. Top Loss — para sıralaması, ısı sıralaması değil
# --------------------------------------------------------------------------- #


def test_top_loss_is_ranked_by_money_not_heat() -> None:
    """En sicak istasyon her zaman en pahali istasyon degildir.

    Isi skoru kullanim ve fireyi de icerir; 'Top Loss' panelinin sordugu soru
    ise tumuyle parasaldir.
    """
    heat = compute_heatmap(
        [
            # Cok sicak (kullanim + blokaj tam) ama parasal kaybi kucuk.
            metrics("sicak", utilization=1.0, blocked_fraction=1.0),
            # Serin ama parasal kaybi buyuk.
            metrics("pahali", utilization=0.0),
        ],
        [
            impact("sicak", name="Sicak", total_loss=10.0),
            impact("pahali", name="Pahali", total_loss=9000.0),
        ],
    )
    assert heat[0].station_id == "sicak"  # isi siralamasi
    assert top_loss_stations(heat)[0].station_id == "pahali"  # para siralamasi


def test_top_loss_excludes_stations_without_loss() -> None:
    heat = compute_heatmap(
        [metrics("a", utilization=0.9)], [impact("a", name="A", total_loss=0.0)]
    )
    assert top_loss_stations(heat) == []


def test_top_loss_is_limited_to_five_by_default() -> None:
    ids = [f"s{index}" for index in range(8)]
    heat = compute_heatmap(
        [metrics(item) for item in ids],
        [
            impact(item, name=item.upper(), total_loss=float(index + 1) * 100.0)
            for index, item in enumerate(ids)
        ],
    )
    top = top_loss_stations(heat)
    assert len(top) == 5
    assert top[0].station_id == "s7"


# --------------------------------------------------------------------------- #
# 8. Saflık
# --------------------------------------------------------------------------- #


def test_heatmap_does_not_mutate_inputs() -> None:
    station_metrics = metrics("a", utilization=0.5)
    station_impact = impact("a", total_loss=100.0)
    before_metrics = station_metrics.model_dump()
    before_impact = station_impact.model_dump()

    compute_heatmap([station_metrics], [station_impact])

    assert station_metrics.model_dump() == before_metrics
    assert station_impact.model_dump() == before_impact


def test_repeated_calls_are_identical() -> None:
    args = ([metrics("a", utilization=0.7)], [impact("a", total_loss=50.0)])
    first = compute_heatmap(*args)
    second = compute_heatmap(*args)
    assert [item.model_dump() for item in first] == [
        item.model_dump() for item in second
    ]
