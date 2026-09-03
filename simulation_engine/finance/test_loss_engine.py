"""Finansal kayıp motorunun doğrulaması.

Buradaki hatalar sessizdir ve pahalıdır: yanlış bir çarpan, bir üretim
müdürüne olmayan bir zararı ya da gerçek zararın onda birini gösterir; ikisi de
ürünün güvenilirliğini bitirir. Bu yüzden yalnızca formüller değil, **hesabın
reddettiği durumlar** da sınanır:

* eksik bir maliyet oranı sıfır kabul edilmemeli,
* kısıt dışarıdayken fırsat maliyeti üretilmemeli,
* kestirime dayanan bir sonuç, sayıma dayanan bir sonuçla aynı güveni
  almamalı,
* aynı kayıp iki kez sayılmamalı (fırsat maliyeti yalnızca darboğazda).
"""

from __future__ import annotations

import pytest

from simulation_engine.analytics.bottleneck import CRITICAL_UTILIZATION
from simulation_engine.finance.loss_engine import (
    ESTIMATE_CONFIDENCE_DISCOUNT,
    MINUTES_PER_HOUR,
    build_report,
    compute_financial_impact,
    compute_station_impact,
    confidence_of,
    data_completeness,
    hours,
    is_capacity_constrained,
    lost_units_from,
    recoverable_loss,
    suggest_improvements,
)
from simulation_engine.finance.models import (
    FinancialSettings,
    MetricProvenance,
    StationFinancialImpact,
)
from simulation_engine.models.schemas import (
    BottleneckAnalysis,
    DrumBufferRopeRecommendation,
    StationLoad,
    StationRunMetrics,
)

# --------------------------------------------------------------------------- #
# Yardımcılar
# --------------------------------------------------------------------------- #


def station(
    station_id: str = "kesim",
    *,
    name: str = "Kesim",
    down_minutes: float = 0.0,
    blocked_minutes: float = 0.0,
    units_scrapped: int = 0,
    units_produced: int = 100,
) -> StationRunMetrics:
    """Yalnızca finans hesabının okuduğu alanları anlamlı olan bir metrik."""
    planned = 600.0
    return StationRunMetrics(
        station_id=station_id,
        station_name=name,
        num_servers=1,
        entries=units_produced,
        service_completions=units_produced,
        units_produced=units_produced,
        units_scrapped=units_scrapped,
        rejected=0,
        busy_minutes=300.0,
        blocked_minutes=blocked_minutes,
        down_minutes=down_minutes,
        idle_minutes=0.0,
        planned_production_time_minutes=planned,
        utilization=0.5,
        blocked_fraction=blocked_minutes / planned,
        availability_fraction=1.0 - down_minutes / planned,
        avg_queue_length=0.0,
        max_queue_length=0,
        avg_wait_time=0.0,
        max_wait_time=0.0,
        wait_time_observations=units_produced,
        avg_service_time=3.0,
        ideal_cycle_time=3.0,
    )


def bottleneck_analysis(
    *,
    station_id: str = "kesim",
    utilization: float = 0.95,
    lost_units: float = 0.0,
) -> BottleneckAnalysis:
    """Yalnızca finans hesabının okuduğu alanları anlamlı olan bir analiz."""
    return BottleneckAnalysis(
        bottleneck_station_id=station_id,
        bottleneck_station_name=station_id.title(),
        bottleneck_utilization=utilization,
        theoretical_max_throughput_per_minute=1.0,
        observed_throughput_per_minute=0.9,
        capacity_utilization_pct=90.0,
        station_loads=[
            StationLoad(
                station_id=station_id,
                station_name=station_id.title(),
                rank=1,
                utilization=utilization,
                blocked_fraction=0.0,
                starvation_fraction=0.1,
                visit_ratio=1.0,
                capacity_per_minute=1.0,
                system_capacity_per_minute=1.0,
            )
        ],
        drum_buffer_rope=DrumBufferRopeRecommendation(
            bottleneck_station_id=station_id,
            upstream_variation_minutes=2.0,
            safety_factor=1.5,
            recommended_time_buffer_minutes=10.0,
            recommended_buffer_units=5,
            current_buffer_capacity=2,
            is_current_buffer_sufficient=False,
            observed_starvation_minutes=60.0,
            estimated_lost_units=lost_units,
            rationale="test",
        ),
        diagnosis="test",
    )


FULL = FinancialSettings(
    selling_price=100.0,
    contribution_margin=40.0,
    labor_cost_per_hour=200.0,
    machine_cost_per_hour=500.0,
    scrap_cost_per_unit=25.0,
    overtime_cost_per_hour=300.0,
)


# --------------------------------------------------------------------------- #
# 1. Formüller
# --------------------------------------------------------------------------- #


def test_hours_converts_minutes() -> None:
    assert hours(60.0) == 1.0
    assert hours(90.0) == 1.5
    assert hours(0.0) == 0.0
    assert MINUTES_PER_HOUR == 60.0


def test_downtime_loss_is_hours_times_machine_rate() -> None:
    """Downtime Loss = ariza saati x machine_cost_per_hour."""
    impact = compute_financial_impact([station(down_minutes=120.0)], FULL)
    assert impact.downtime_loss == pytest.approx(2.0 * 500.0)


def test_waiting_loss_is_hours_times_labor_rate() -> None:
    """Waiting Loss = bloke saati x labor_cost_per_hour."""
    impact = compute_financial_impact([station(blocked_minutes=30.0)], FULL)
    assert impact.waiting_loss == pytest.approx(0.5 * 200.0)


def test_scrap_loss_is_units_times_unit_cost() -> None:
    """Scrap Loss = hurda adedi x scrap_cost_per_unit."""
    impact = compute_financial_impact([station(units_scrapped=12)], FULL)
    assert impact.scrap_loss == pytest.approx(12 * 25.0)


def test_opportunity_loss_is_lost_units_times_margin() -> None:
    """Opportunity Loss = kayip birim x contribution_margin."""
    impact = compute_financial_impact(
        [station()], FULL, bottleneck_analysis(lost_units=30.0)
    )
    assert impact.opportunity_loss == pytest.approx(30.0 * 40.0)


def test_opportunity_loss_uses_margin_not_selling_price() -> None:
    """Uretilemeyen birimin kaybi cirosu degil, katki payidir.

    Satis fiyatiyla carpmak kaybi 2,5 kat abartirdi; bu, yatirim kararini
    dogrudan degistirecek bir hatadir.
    """
    impact = compute_financial_impact(
        [station()], FULL, bottleneck_analysis(lost_units=10.0)
    )
    assert impact.opportunity_loss == pytest.approx(10.0 * 40.0)
    assert impact.opportunity_loss != pytest.approx(10.0 * 100.0)


def test_total_is_the_sum_of_the_four_components() -> None:
    impact = compute_financial_impact(
        [station(down_minutes=60.0, blocked_minutes=60.0, units_scrapped=4)],
        FULL,
        bottleneck_analysis(lost_units=10.0),
    )
    assert impact.total_loss == pytest.approx(
        impact.downtime_loss
        + impact.waiting_loss
        + impact.scrap_loss
        + impact.opportunity_loss
    )
    assert impact.total_loss == pytest.approx(500.0 + 200.0 + 100.0 + 400.0)


def test_losses_sum_across_stations() -> None:
    impact = compute_financial_impact(
        [
            station("a", down_minutes=60.0, units_scrapped=2),
            station("b", down_minutes=30.0, units_scrapped=3),
        ],
        FULL,
    )
    assert impact.downtime_loss == pytest.approx(1.5 * 500.0)
    assert impact.scrap_loss == pytest.approx(5 * 25.0)


def test_zero_activity_produces_zero_loss() -> None:
    impact = compute_financial_impact([station()], FULL)
    assert impact.total_loss == 0.0


def test_no_stations_produces_zero_loss() -> None:
    impact = compute_financial_impact([], FULL)
    assert impact.total_loss == 0.0


# --------------------------------------------------------------------------- #
# 2. Eksik oran sıfır DEĞİLDİR
# --------------------------------------------------------------------------- #


def test_missing_rate_does_not_silently_become_zero() -> None:
    """Oran verilmediyse kalem hesaplanmaz ve eksikligi raporlanir.

    Sifir kabul edilseydi, hic maliyet girmemis bir kullanici "toplam kaybiniz
    0 TL" yanitini alir ve bunu iyi haber sanardi.
    """
    partial = FinancialSettings(machine_cost_per_hour=500.0)
    impact = compute_financial_impact(
        [station(down_minutes=60.0, blocked_minutes=60.0, units_scrapped=4)], partial
    )

    assert impact.downtime_loss == pytest.approx(500.0)
    assert impact.waiting_loss == 0.0
    assert "labor_cost_per_hour" in impact.missing_inputs
    assert "scrap_cost_per_unit" in impact.missing_inputs
    assert any("KATILMADI" in note for note in impact.notes)


def test_unavailable_component_is_flagged_not_just_zero() -> None:
    """Tutari sifir olan kalem ile HESAPLANAMAYAN kalem ayirt edilebilmeli."""
    partial = FinancialSettings(machine_cost_per_hour=500.0)
    impact = compute_financial_impact([station()], partial)

    by_name = {item.name: item for item in impact.components}
    # Ariza yok: tutar sifir ama oran VAR, yani hesaplanabildi.
    assert by_name["downtime_loss"].amount == 0.0
    assert by_name["downtime_loss"].is_available is True
    # Iscilik orani yok: hesaplanamadi.
    assert by_name["waiting_loss"].is_available is False
    assert "verilmedigi icin" in by_name["waiting_loss"].basis


def test_empty_settings_yield_zero_completeness() -> None:
    impact = compute_financial_impact([station(down_minutes=60.0)], FinancialSettings())
    assert impact.total_loss == 0.0
    assert impact.data_completeness == 0.0
    assert len(impact.missing_inputs) == 4


def test_full_settings_yield_full_completeness() -> None:
    impact = compute_financial_impact([station()], FULL)
    assert impact.data_completeness == 1.0
    assert impact.missing_inputs == []


def test_completeness_is_the_provided_fraction() -> None:
    two_of_four = FinancialSettings(
        machine_cost_per_hour=500.0, labor_cost_per_hour=200.0
    )
    impact = compute_financial_impact([station()], two_of_four)
    assert impact.data_completeness == pytest.approx(0.5)


# --------------------------------------------------------------------------- #
# 3. Fırsat maliyeti yalnızca kısıt İÇERİDEYSE
# --------------------------------------------------------------------------- #


def test_external_constraint_produces_no_opportunity_loss() -> None:
    """Talep yetersizken bos gecen kapasite bir kayip DEGILDIR.

    Bunu paraya cevirmek, olmayan bir zarari rapor etmek olurdu.
    """
    demand_limited = bottleneck_analysis(utilization=0.40, lost_units=500.0)
    assert not is_capacity_constrained(demand_limited)

    impact = compute_financial_impact([station()], FULL, demand_limited)
    assert impact.opportunity_loss == 0.0
    assert any("Kisit disaridadir" in note for note in impact.notes)


def test_internal_constraint_produces_opportunity_loss() -> None:
    capacity_limited = bottleneck_analysis(utilization=0.95, lost_units=20.0)
    assert is_capacity_constrained(capacity_limited)

    impact = compute_financial_impact([station()], FULL, capacity_limited)
    assert impact.opportunity_loss == pytest.approx(20.0 * 40.0)


def test_constraint_threshold_matches_the_engine() -> None:
    """Esik motorun kendi kuralindan gelir; burada yeni bir esik uydurulmaz.

    Ayri bir esik tanimlansaydi, ayni kosum icin darbogaz analizi "kisit
    disarida" derken finans raporu "uretim kaybiniz var" diyebilirdi.
    """
    just_below = bottleneck_analysis(utilization=CRITICAL_UTILIZATION - 0.01)
    just_at = bottleneck_analysis(utilization=CRITICAL_UTILIZATION)

    assert not is_capacity_constrained(just_below)
    assert is_capacity_constrained(just_at)


def test_no_bottleneck_means_no_opportunity_loss() -> None:
    """Darbogaz analizi verilmezse kayip birim bilinemez."""
    impact = compute_financial_impact([station()], FULL, None)
    assert impact.opportunity_loss == 0.0
    assert lost_units_from(None) == 0.0


def test_negative_lost_units_are_clamped() -> None:
    """Kayip birim negatif olamaz; olsa bile kaybi azaltmamali."""
    weird = bottleneck_analysis(utilization=0.95, lost_units=-5.0)
    assert lost_units_from(weird) == 0.0


def test_missing_drum_buffer_rope_means_no_opportunity_loss() -> None:
    analysis = bottleneck_analysis(utilization=0.95, lost_units=10.0)
    without = analysis.model_copy(update={"drum_buffer_rope": None})
    assert lost_units_from(without) == 0.0


# --------------------------------------------------------------------------- #
# 4. Şeffaflık: Observed / Calculated / Estimated
# --------------------------------------------------------------------------- #


def test_every_component_carries_a_provenance_label() -> None:
    impact = compute_financial_impact([station()], FULL, bottleneck_analysis())
    assert len(impact.components) == 4
    for item in impact.components:
        assert isinstance(item.provenance, MetricProvenance)


def test_counted_losses_are_calculated_not_estimated() -> None:
    """Ariza, bekleme ve fire sayima dayanir; kestirim degildir."""
    impact = compute_financial_impact([station()], FULL, bottleneck_analysis())
    by_name = {item.name: item for item in impact.components}

    for name in ("downtime_loss", "waiting_loss", "scrap_loss"):
        assert by_name[name].provenance is MetricProvenance.CALCULATED


def test_opportunity_loss_is_labelled_estimated() -> None:
    """Kayip birim sayisi bir SAYIM degil, KESTIRIMDIR ve oyle etiketlenir."""
    impact = compute_financial_impact([station()], FULL, bottleneck_analysis())
    by_name = {item.name: item for item in impact.components}
    assert by_name["opportunity_loss"].provenance is MetricProvenance.ESTIMATED


def test_components_expose_quantity_and_rate_for_traceability() -> None:
    """Her tutar, hangi ham buyukluk ve hangi oranla elde edildigini tasir."""
    impact = compute_financial_impact([station(down_minutes=120.0)], FULL)
    by_name = {item.name: item for item in impact.components}
    down = by_name["downtime_loss"]

    assert down.quantity == pytest.approx(2.0)
    assert down.quantity_unit == "saat"
    assert down.rate_name == "machine_cost_per_hour"
    assert down.rate_value == 500.0
    assert down.amount == pytest.approx(down.quantity * down.rate_value)


# --------------------------------------------------------------------------- #
# 5. Güven
# --------------------------------------------------------------------------- #


def test_confidence_equals_completeness_when_nothing_is_estimated() -> None:
    impact = compute_financial_impact([station(down_minutes=60.0)], FULL)
    assert impact.confidence == pytest.approx(impact.data_completeness)


def test_estimated_share_lowers_confidence() -> None:
    """Tumuyle kestirime dayanan sonuc, oranlar tam olsa bile iskonto gorur."""
    only_estimate = compute_financial_impact(
        [station()], FULL, bottleneck_analysis(lost_units=10.0)
    )
    assert only_estimate.data_completeness == 1.0
    assert only_estimate.confidence == pytest.approx(
        1.0 - ESTIMATE_CONFIDENCE_DISCOUNT
    )


def test_mixed_result_lands_between_the_two_extremes() -> None:
    mixed = compute_financial_impact(
        [station(down_minutes=60.0)], FULL, bottleneck_analysis(lost_units=10.0)
    )
    assert 1.0 - ESTIMATE_CONFIDENCE_DISCOUNT < mixed.confidence < 1.0


def test_missing_rates_lower_confidence() -> None:
    partial = compute_financial_impact(
        [station(down_minutes=60.0)], FinancialSettings(machine_cost_per_hour=500.0)
    )
    full = compute_financial_impact([station(down_minutes=60.0)], FULL)
    assert partial.confidence < full.confidence


def test_confidence_stays_within_bounds() -> None:
    for settings in (FinancialSettings(), FULL):
        impact = compute_financial_impact(
            [station(down_minutes=60.0, units_scrapped=3)],
            settings,
            bottleneck_analysis(lost_units=10.0),
        )
        assert 0.0 <= impact.confidence <= 1.0
        assert 0.0 <= impact.data_completeness <= 1.0


def test_confidence_helper_handles_zero_total() -> None:
    """Toplam sifirken kestirim payi tanimsizdir; guven completeness'e esittir."""
    impact = compute_financial_impact([station()], FULL)
    assert confidence_of(impact.components, 1.0) == pytest.approx(1.0)


def test_data_completeness_helper_handles_empty_input() -> None:
    assert data_completeness([]) == 0.0


# --------------------------------------------------------------------------- #
# 6. İstasyon dökümü
# --------------------------------------------------------------------------- #


def test_station_impact_uses_only_that_stations_numbers() -> None:
    metrics = station("pres", name="Pres", down_minutes=60.0, units_scrapped=2)
    result = compute_station_impact(metrics, FULL)

    assert result.station_id == "pres"
    assert result.station_name == "Pres"
    assert result.downtime_loss == pytest.approx(500.0)
    assert result.scrap_loss == pytest.approx(50.0)


def test_opportunity_loss_is_charged_only_to_the_bottleneck() -> None:
    """Ayni kayip birden cok istasyona yazilmamali.

    Uretilemeyen birim sistemin ciktisidir ve onu sinirlayan tek istasyon
    kisittir; kaybi tum istasyonlara dagitmak ayni zarari birden cok kez
    saymak olurdu.
    """
    analysis = bottleneck_analysis(station_id="kesim", lost_units=10.0)
    at_bottleneck = compute_station_impact(station("kesim"), FULL, analysis)
    elsewhere = compute_station_impact(station("montaj"), FULL, analysis)

    assert at_bottleneck.is_bottleneck is True
    assert at_bottleneck.opportunity_loss == pytest.approx(400.0)
    assert elsewhere.is_bottleneck is False
    assert elsewhere.opportunity_loss == 0.0


def test_station_totals_reconcile_with_the_overall_total() -> None:
    """Istasyon dokumunun toplami, genel toplamla ayni olmali."""
    stations = [
        station("a", down_minutes=60.0, units_scrapped=2),
        station("b", blocked_minutes=30.0, units_scrapped=1),
    ]
    analysis = bottleneck_analysis(station_id="a", lost_units=10.0)

    overall = compute_financial_impact(stations, FULL, analysis)
    per_station = [compute_station_impact(item, FULL, analysis) for item in stations]

    assert sum(item.total_loss for item in per_station) == pytest.approx(
        overall.total_loss
    )


# --------------------------------------------------------------------------- #
# 7. Kurtarılabilir kayıp ve öneriler
# --------------------------------------------------------------------------- #


def test_recoverable_excludes_scrap() -> None:
    """Fire otomatik olarak kurtarilabilir sayilmaz.

    Fireyi azaltmak bir surec degisikligi gerektirir ve ne kadarinin
    giderilebilecegi bu modelden bilinemez.
    """
    impact = compute_financial_impact(
        [station(down_minutes=60.0, blocked_minutes=60.0, units_scrapped=4)],
        FULL,
        bottleneck_analysis(lost_units=10.0),
    )
    assert recoverable_loss(impact) == pytest.approx(500.0 + 200.0 + 400.0)
    assert recoverable_loss(impact) < impact.total_loss


def test_suggestions_are_ranked_by_money_lost() -> None:
    stations = [
        StationFinancialImpact(
            station_id="kucuk",
            station_name="Kucuk",
            downtime_loss=100.0,
            waiting_loss=0.0,
            scrap_loss=0.0,
            opportunity_loss=0.0,
            total_loss=100.0,
        ),
        StationFinancialImpact(
            station_id="buyuk",
            station_name="Buyuk",
            downtime_loss=0.0,
            waiting_loss=900.0,
            scrap_loss=0.0,
            opportunity_loss=0.0,
            total_loss=900.0,
        ),
    ]
    suggestions = suggest_improvements(stations)
    assert [item.station_id for item in suggestions] == ["buyuk", "kucuk"]


def test_suggestion_targets_the_dominant_loss_type() -> None:
    stations = [
        StationFinancialImpact(
            station_id="pres",
            station_name="Pres",
            downtime_loss=50.0,
            waiting_loss=0.0,
            scrap_loss=800.0,
            opportunity_loss=0.0,
            total_loss=850.0,
        )
    ]
    suggestion = suggest_improvements(stations)[0]
    assert suggestion.dominant_loss == "scrap_loss"
    assert suggestion.recoverable_amount == pytest.approx(800.0)
    assert "Kalite kontrol" in suggestion.action


def test_stations_without_loss_get_no_suggestion() -> None:
    clean = [
        StationFinancialImpact(
            station_id="temiz",
            station_name="Temiz",
            downtime_loss=0.0,
            waiting_loss=0.0,
            scrap_loss=0.0,
            opportunity_loss=0.0,
            total_loss=0.0,
        )
    ]
    assert suggest_improvements(clean) == []


def test_suggestion_count_is_limited() -> None:
    many = [
        StationFinancialImpact(
            station_id=f"s{index}",
            station_name=f"S{index}",
            downtime_loss=float(index + 1) * 10.0,
            waiting_loss=0.0,
            scrap_loss=0.0,
            opportunity_loss=0.0,
            total_loss=float(index + 1) * 10.0,
        )
        for index in range(10)
    ]
    assert len(suggest_improvements(many, limit=3)) == 3


# --------------------------------------------------------------------------- #
# 8. Rapor ve günlük projeksiyon
# --------------------------------------------------------------------------- #


def test_report_bundles_impact_stations_and_suggestions() -> None:
    report = build_report(
        [station("a", down_minutes=60.0)],
        FULL,
        window_minutes=600.0,
        bottleneck=bottleneck_analysis(station_id="a", lost_units=10.0),
    )
    assert report.impact.total_loss > 0.0
    assert len(report.stations) == 1
    assert len(report.suggestions) >= 1
    assert report.window_minutes == 600.0


def test_report_stations_are_sorted_by_loss() -> None:
    report = build_report(
        [station("az", down_minutes=6.0), station("cok", down_minutes=120.0)],
        FULL,
        window_minutes=600.0,
    )
    assert [item.station_id for item in report.stations] == ["cok", "az"]


def test_daily_projection_scales_the_window() -> None:
    """Gunluk kayip, pencere kaybinin gunluk uretim suresine olceklenmesidir."""
    settings = FULL.model_copy(update={"production_minutes_per_day": 480.0})
    report = build_report(
        [station(down_minutes=60.0)], settings, window_minutes=240.0
    )
    # 240 dakikalik pencerede 500 birim kayip -> 480 dakikada iki kati.
    assert report.daily_loss == pytest.approx(report.impact.total_loss * 2.0)


def test_daily_projection_is_absent_without_production_minutes() -> None:
    """Vardiya suresi verilmediginde gunluk rakam URETILMEZ.

    Uydurulmus bir vardiya suresiyle hesaplanan "gunluk kayip", hic rakam
    vermemekten kotudur: kullanici onu kendi verisi sanir.
    """
    report = build_report([station(down_minutes=60.0)], FULL, window_minutes=600.0)
    assert report.daily_loss is None


def test_zero_window_is_rejected() -> None:
    """Sifir pencereye bolmek sonsuz bir gunluk kayip uretirdi."""
    with pytest.raises(ValueError):
        build_report([station()], FULL, window_minutes=0.0)


# --------------------------------------------------------------------------- #
# 9. Saflık
# --------------------------------------------------------------------------- #


def test_functions_do_not_mutate_their_inputs() -> None:
    """Saf islevler girdilerini degistirmemeli."""
    metrics = station(down_minutes=60.0, units_scrapped=3)
    before = metrics.model_dump()
    analysis = bottleneck_analysis(lost_units=10.0)
    analysis_before = analysis.model_dump()
    settings_before = FULL.model_dump()

    build_report([metrics], FULL, window_minutes=600.0, bottleneck=analysis)

    assert metrics.model_dump() == before
    assert analysis.model_dump() == analysis_before
    assert FULL.model_dump() == settings_before


def test_repeated_calls_give_identical_results() -> None:
    """Ayni girdi her zaman ayni ciktiyi vermeli."""
    args = ([station(down_minutes=60.0)], FULL, bottleneck_analysis(lost_units=5.0))
    first = compute_financial_impact(*args)
    second = compute_financial_impact(*args)
    assert first.model_dump() == second.model_dump()
