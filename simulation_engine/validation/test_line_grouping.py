"""`line_name` alanının doğrulaması — Fabrika geneli özet, Faz 1.

Bu alan yalnızca arayüzde istasyonları hatlara/bölümlere ayırmak içindir.
Dosyanın tek ve asıl görevi, bunun **gerçekten** böyle olduğunu kanıtlamaktır:
şemaya eklenen her yeni alan, motorun bir yerinde farkında olmadan okunma
riski taşır ve öyle bir sızıntı sonuçları sessizce kaydırırdı. Görsel bir
etiketin üretim sayılarını değiştirmesi, kullanıcının hiçbir zaman şüphe
etmeyeceği türden bir hatadır.

İkinci görev geriye dönük uyumluluktur: alan verilmeden kurulmuş mevcut
modeller (üç sektör şablonu dahil) hiç bozulmadan çalışmaya devam etmelidir.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from simulation_engine.core.engine import SimulationEngine
from simulation_engine.models.schemas import (
    ArrivalProcess,
    Connection,
    Distribution,
    SimulationConfig,
    Station,
)


def line_config(line_names: list[str | None]) -> SimulationConfig:
    """Uc istasyonlu ayni hat; yalnizca hat etiketleri degisir."""
    names = ["Kesim", "Pres", "Montaj"]
    ids = ["kesim", "pres", "montaj"]
    distributions = [
        Distribution.constant(1.0),
        Distribution.exponential(2.2),
        Distribution.triangular(0.6, 0.9, 1.4),
    ]
    return SimulationConfig(
        stations=[
            Station(
                id=station_id,
                name=name,
                line_name=line_name,
                service_time_distribution=distribution,
            )
            for station_id, name, line_name, distribution in zip(
                ids, names, line_names, distributions
            )
        ],
        connections=[
            Connection(from_station_id="kesim", to_station_id="pres"),
            Connection(from_station_id="pres", to_station_id="montaj"),
        ],
        arrival_process=ArrivalProcess(
            distribution=Distribution.exponential(2.6), entry_station_id="kesim"
        ),
        simulation_duration_minutes=4000.0,
        warmup_period_minutes=200.0,
        num_replications=3,
        random_seed=4242,
    )


# --------------------------------------------------------------------------- #
# 1. Alan motoru etkilemiyor (en kritik kriter)
# --------------------------------------------------------------------------- #


def test_line_name_does_not_change_results() -> None:
    """Hat etiketi verilen ve verilmeyen model birebir ayni sonucu uretmeli."""
    without_lines = SimulationEngine(line_config([None, None, None])).run()
    with_lines = SimulationEngine(
        line_config(["Kesim Hatti", "Kesim Hatti", "Montaj Hatti"])
    ).run()

    exclude = {"wall_clock_seconds"}
    assert with_lines.model_dump(exclude=exclude) == without_lines.model_dump(
        exclude=exclude
    )


def test_different_groupings_produce_identical_results() -> None:
    """Ayni istasyonlar farkli hatlara dagitilsa da sonuc degismemeli.

    Gruplama bir modelleme karari degil, yalnizca bir goruntuleme tercihidir;
    kullanicinin istasyonlari nasil etiketledigi uretimi etkileyemez.
    """
    grouping_a = SimulationEngine(
        line_config(["Hat A", "Hat A", "Hat A"])
    ).run()
    grouping_b = SimulationEngine(
        line_config(["Hat A", "Hat B", "Hat C"])
    ).run()

    exclude = {"wall_clock_seconds"}
    assert grouping_a.model_dump(exclude=exclude) == grouping_b.model_dump(
        exclude=exclude
    )


def test_engine_never_reads_line_name() -> None:
    """Motor kodunda alan hic gecmemeli.

    Sonuc karsilastirmasi bir sizintiyi ancak sonucu degistirdiginde yakalar.
    Bu test daha dogrudan davranir: motor cekirdegi alani okuyorsa, henuz
    zararsiz olsa bile bu bir tasarim ihlalidir ve ileride zararli olur.
    """
    from pathlib import Path

    core = Path(__file__).resolve().parent.parent / "core"
    offenders = [
        path.name
        for path in core.glob("*.py")
        if "line_name" in path.read_text(encoding="utf-8")
    ]
    assert offenders == [], (
        f"Motor cekirdegi gorsel bir alani okuyor: {offenders}. "
        f"'line_name' yalnizca arayuz gruplamasi icindir."
    )


# --------------------------------------------------------------------------- #
# 2. Geriye dönük uyumluluk
# --------------------------------------------------------------------------- #


def test_line_name_defaults_to_none() -> None:
    """Alan verilmeden kurulan istasyon gruplanmamis sayilir."""
    station = Station(
        id="kesim", name="Kesim", service_time_distribution=Distribution.constant(1.0)
    )
    assert station.line_name is None


def test_existing_payloads_without_line_name_still_validate() -> None:
    """Alan eklenmeden once yazilmis bir JSON govdesi hala kabul edilmeli."""
    payload = {
        "id": "kesim",
        "name": "Kesim",
        "num_servers": 2,
        "service_time_distribution": {"type": "constant", "params": {"value": 1.0}},
        "buffer_capacity_before": -1,
        "scrap_rate": 0.0,
    }
    station = Station.model_validate(payload)
    assert station.line_name is None
    assert station.num_servers == 2


@pytest.mark.parametrize("value", ["Kesim Hattı", "Montaj", "A"])
def test_line_name_accepts_free_text(value: str) -> None:
    """Hat adi serbest metindir; kullanici kendi adlandirmasini kullanir."""
    station = Station(
        id="kesim",
        name="Kesim",
        line_name=value,
        service_time_distribution=Distribution.constant(1.0),
    )
    assert station.line_name == value


def test_unknown_fields_are_still_rejected() -> None:
    """Yeni alan, sema sikiligini gevsetmemeli.

    `extra='forbid'` kurali yazim hatalarini yakalar; alan eklerken bu kuralin
    yanlislikla kaldirilmadigini dogrulamak ucuzdur.
    """
    with pytest.raises(ValidationError):
        Station(
            id="kesim",
            name="Kesim",
            line_nmae="yazim hatasi",  # type: ignore[call-arg]
            service_time_distribution=Distribution.constant(1.0),
        )
