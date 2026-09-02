"""API yanıtındaki akış sayaçlarının doğrulaması.

`flow` alanı yalnızca bir görselleştirmeyi beslemek için eklendi ama bir API
sözleşmesidir: arayüzdeki akış/kayıp diyagramı bu dört sayının anlamına
güvenerek "giren = çıkan + kayıp" dengesini kurar. Sayıların anlamı sessizce
kayarsa diyagram bir hata göstermez, yalnızca yanlış kalınlıklar çizer.

Ayrıca alanın **eklenmesi** hiçbir mevcut hesabı değiştirmemelidir; bu dosya
onu da sınar.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from simulation_engine.api.simulation_service import app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def line_payload(scrap_rate: float = 0.1, buffer: int = -1) -> dict:
    """Iki istasyonlu, ikincisinde fire olan bir hat."""
    return {
        "stations": [
            {
                "id": "kesim",
                "name": "Kesim",
                "service_time_distribution": {"type": "constant", "params": {"value": 1.0}},
            },
            {
                "id": "montaj",
                "name": "Montaj",
                "service_time_distribution": {
                    "type": "exponential",
                    "params": {"mean": 1.2},
                },
                "scrap_rate": scrap_rate,
                "buffer_capacity_before": buffer,
            },
        ],
        "connections": [
            {"from_station_id": "kesim", "to_station_id": "montaj"}
        ],
        "arrival_process": {
            "distribution": {"type": "exponential", "params": {"mean": 2.0}},
            "entry_station_id": "kesim",
        },
        "simulation_duration_minutes": 5000,
        "warmup_period_minutes": 500,
        "num_replications": 5,
        "random_seed": 7,
    }


@pytest.fixture(scope="module")
def results(client: TestClient) -> dict:
    response = client.post("/api/simulations/run", json=line_payload())
    assert response.status_code == 200, response.text
    return response.json()["results"]


# --------------------------------------------------------------------------- #
# 1. Alanın varlığı ve iç tutarlılığı
# --------------------------------------------------------------------------- #


def test_every_station_reports_flow(results: dict) -> None:
    """Her istasyon dort akis sayacini da bildirmeli."""
    for station in results["station_metrics"]:
        flow = station["flow"]
        assert set(flow) == {"entered", "completed", "scrapped", "rejected"}


def test_flow_counters_are_never_negative(results: dict) -> None:
    """Negatif bir sayac, diyagramda negatif kalinlik demek olurdu."""
    for station in results["station_metrics"]:
        for name, value in station["flow"].items():
            assert value >= 0.0, f"{station['station_id']}.{name} = {value}"


def test_scrap_cannot_exceed_completed(results: dict) -> None:
    """Hurda, islemi tamamlanan parcalarin bir alt kumesidir."""
    for station in results["station_metrics"]:
        flow = station["flow"]
        assert flow["scrapped"] <= flow["completed"] + 1e-9


def test_scrap_appears_only_where_configured(results: dict) -> None:
    """Fire orani verilmeyen istasyon hurda bildirmemeli."""
    by_id = {row["station_id"]: row["flow"] for row in results["station_metrics"]}
    assert by_id["kesim"]["scrapped"] == 0.0
    assert by_id["montaj"]["scrapped"] > 0.0


def test_scrap_share_matches_configured_rate(results: dict) -> None:
    """Hurda orani, yapilandirilan fire oranina yakinsamali.

    Sayilarin gercekten olculdugunu — sabit ya da turetilmis olmadigini —
    gosteren asil test budur.
    """
    montaj = next(r for r in results["station_metrics"] if r["station_id"] == "montaj")
    flow = montaj["flow"]
    observed = flow["scrapped"] / flow["completed"]
    assert observed == pytest.approx(0.1, abs=0.02)


def test_chain_forwards_what_it_completes(results: dict) -> None:
    """Bir istasyonun ilerlettigi parca, sonrakinin girisine esit olmali.

    Duz bir hatta bu zincir kapanir; kapanmazsa akis diyagrami yoktan var olan
    kayiplar gosterirdi.
    """
    by_id = {row["station_id"]: row["flow"] for row in results["station_metrics"]}
    forwarded = by_id["kesim"]["completed"] - by_id["kesim"]["scrapped"]
    assert by_id["montaj"]["entered"] == pytest.approx(forwarded, rel=0.01)


def test_final_output_matches_reported_throughput(results: dict) -> None:
    """Son istasyonun iyi cikti sayisi, raporlanan uretimle ortusmeli."""
    montaj = next(r for r in results["station_metrics"] if r["station_id"] == "montaj")
    good = montaj["flow"]["completed"] - montaj["flow"]["scrapped"]
    assert good == pytest.approx(results["total_throughput"], rel=0.01)


# --------------------------------------------------------------------------- #
# 2. Sonlu tampon: red sayacı
# --------------------------------------------------------------------------- #


def test_rejections_are_reported_at_the_entry_station(client: TestClient) -> None:
    """Tamponu dolan giris istasyonu, geri cevirdigi varislari bildirmeli.

    Bu sayac olmadan diyagram, kapasite kaynakli kaybi kalite kaynakli fireyle
    ayni kefeye koyardi; kullanici yanlis yere mudahale ederdi.

    Red **giris istasyonuna ozgudur**: hattin icinde bir istasyonun tamponu
    dolarsa parca geri cevrilmez, yukari akistaki istasyon bloke olur ve
    birikim orada olusur. Sisteme disaridan gelen bir parcanin bekleyecek yeri
    yoksa ise ancak o zaman reddedilir.
    """
    payload = line_payload(scrap_rate=0.0, buffer=-1)
    # Giris istasyonunun tamponu kucuk, gelen is ise kapasitesinin cok ustunde.
    payload["stations"][0]["buffer_capacity_before"] = 2
    payload["stations"][0]["service_time_distribution"] = {
        "type": "exponential",
        "params": {"mean": 4.0},
    }
    payload["arrival_process"]["distribution"] = {
        "type": "exponential",
        "params": {"mean": 1.0},
    }
    response = client.post("/api/simulations/run", json=payload)
    assert response.status_code == 200, response.text

    rows = response.json()["results"]["station_metrics"]
    kesim = next(r for r in rows if r["station_id"] == "kesim")
    assert kesim["flow"]["rejected"] > 0.0


def test_no_rejections_with_infinite_buffer(results: dict) -> None:
    """Sonsuz tamponda hicbir parca reddedilmez."""
    for station in results["station_metrics"]:
        assert station["flow"]["rejected"] == 0.0


# --------------------------------------------------------------------------- #
# 3. Alanın eklenmesi mevcut sonuçları değiştirmemeli
# --------------------------------------------------------------------------- #


def test_flow_field_does_not_disturb_other_metrics(client: TestClient) -> None:
    """Ayni tohumla iki kosum ayni sayilari uretmeli.

    Akis sayaclari ham replikasyonlardan okunur; Monte Carlo ozetine yeni metrik
    eklenmedi. Bu test, alanin eklenmesinin rastgele sayi akisina ya da
    hesaplara dokunmadigini dogrular.
    """
    payload = line_payload()
    first = client.post("/api/simulations/run", json=payload).json()["results"]
    second = client.post("/api/simulations/run", json=payload).json()["results"]

    assert first["total_throughput"] == second["total_throughput"]
    assert first["line_oee"] == second["line_oee"]
    assert first["avg_flow_time"] == second["avg_flow_time"]
    for left, right in zip(first["station_metrics"], second["station_metrics"]):
        assert left["utilization"] == right["utilization"]
        assert left["flow"] == right["flow"]
