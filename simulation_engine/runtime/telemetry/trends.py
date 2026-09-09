"""Trend hesabı: ham ölçümleri zaman kovalarına toplar.

Neden kova
----------
Yedi günlük bir pencerede saniyede bir ölçüm alan bir cihazın 600 binden fazla
noktası vardır. Bunları tarayıcıya göndermek hem ağı hem de çizim katmanını
boğar; üstelik ekranda 600 bin nokta zaten ayırt edilemez. Kova, veriyi
ekrandaki piksel sayısına yakın bir çözünürlüğe indirir.

Boş kova neden sıfır değil
--------------------------
Bir kovada hiç ölçüm yoksa `average` `None` kalır. Sıfır yazılsaydı, cihazın
kapalı olduğu saatler grafikte "üretim sıfıra düştü" gibi görünür ve gerçek
bir duruşla veri boşluğu ayırt edilemezdi.

Bozuk kalite neden dışarıda
---------------------------
Kalitesi `bad` olan ölçüm kaydedilir ama ortalamaya girmez: bozuk bir sensörün
gönderdiği uç değer, bütün kovanın ortalamasını kaydırırdı. Bu ölçümler
`excluded` sayacında ayrıca raporlanır, sessizce yutulmaz.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from simulation_engine.runtime.telemetry.types import (
    TelemetryPoint,
    TrendBucket,
    TrendSeries,
    TrendWindow,
    window_of,
)


def bucket_index(timestamp_ms: int, start_ms: int, bucket_ms: int) -> int:
    """Bir ölçümün hangi kovaya düştüğü."""
    if bucket_ms <= 0:
        return 0
    return (timestamp_ms - start_ms) // bucket_ms


def empty_buckets(start_ms: int, window: TrendWindow) -> List[TrendBucket]:
    """Pencerenin bütün kovalarını boş olarak üretir.

    Kovalar veri gelmeden de oluşturulur: grafiğin ekseni, veri olmayan
    saatlerde de doğru zaman aralığını göstermelidir.
    """
    return [
        TrendBucket(
            start_ms=start_ms + index * window.bucket_ms,
            end_ms=start_ms + (index + 1) * window.bucket_ms,
        )
        for index in range(window.buckets)
    ]


def build_series(
    device: str,
    tag: str,
    window: TrendWindow,
    points: Iterable[TelemetryPoint],
    now_ms: int,
) -> TrendSeries:
    """Ölçümleri kovalara toplar.

    Pencere `now_ms`'de biter ve geriye doğru uzanır. Pencerenin dışındaki
    ölçümler atılır: sorgu zaten aralıkla yapılır, ama depo sınırı aşan bir
    kayıt döndürürse grafik yanlış bir dönemi göstermemelidir.
    """
    start_ms = now_ms - window.duration_ms
    buckets = empty_buckets(start_ms, window)
    #: Kova başına ham değerler; ortalama sonunda hesaplanır.
    values: Dict[int, List[float]] = {}
    total = 0

    for point in points:
        if point.timestamp_ms < start_ms or point.timestamp_ms > now_ms:
            continue
        if not point.is_usable:
            continue
        index = bucket_index(point.timestamp_ms, start_ms, window.bucket_ms)
        if index < 0 or index >= len(buckets):
            continue
        values.setdefault(index, []).append(float(point.value))
        bucket = buckets[index]
        bucket.count += 1
        # Ölçümler zaman sırasında geldiği için son atama en son değeri tutar.
        bucket.last = float(point.value)
        total += 1

    for index, samples in values.items():
        bucket = buckets[index]
        bucket.average = round(sum(samples) / len(samples), 4)
        bucket.minimum = min(samples)
        bucket.maximum = max(samples)

    return TrendSeries(
        device=device,
        tag=tag,
        window=window.id,
        buckets=buckets,
        total_points=total,
    )


def excluded_count(points: Iterable[TelemetryPoint]) -> int:
    """Kalitesi ya da değeri yüzünden hesaba girmeyen ölçüm sayısı."""
    return sum(1 for point in points if not point.is_usable)


def series_summary(series: TrendSeries) -> Dict[str, Any]:
    """Serinin özeti: en düşük, en yüksek, ortalama.

    Veri yoksa üçü de `None` döner. Sıfır dönseydi, boş bir grafik "ortalama
    sıfır" diye okunurdu.
    """
    filled = [bucket for bucket in series.buckets if bucket.count > 0]
    if not filled:
        return {
            "average": None,
            "min": None,
            "max": None,
            "filled_buckets": 0,
            "coverage": None,
            "reason": "Bu aralıkta kayıtlı ölçüm yok",
        }
    weighted = sum(
        (bucket.average or 0.0) * bucket.count for bucket in filled
    )
    count = sum(bucket.count for bucket in filled)
    minimums = [bucket.minimum for bucket in filled if bucket.minimum is not None]
    maximums = [bucket.maximum for bucket in filled if bucket.maximum is not None]
    total_buckets = len(series.buckets) or 1
    return {
        "average": round(weighted / count, 4) if count else None,
        "min": min(minimums) if minimums else None,
        "max": max(maximums) if maximums else None,
        "filled_buckets": len(filled),
        #: Kaç kovada veri var? Kesintili bir akış burada görülür.
        "coverage": round(len(filled) / total_buckets, 4),
        "reason": None,
    }


def load_series(
    repository,
    org_id: str,
    device: str,
    tag: str,
    window_id: str,
    now_ms: int,
) -> Optional[Dict[str, Any]]:
    """Depodan okuyup seriyi kurar; pencere tanınmıyorsa `None`.

    Sorgu sınırı kova sayısının çok üstünde tutulur: bir kovaya yüzlerce
    ölçüm düşebilir ve ortalama ancak hepsi okunursa doğru çıkar. Yine de
    sınırsız değildir; sınırsız bir sorgu haftalık pencerede milyonlarca satır
    döndürürdü.
    """
    window = window_of(window_id)
    if window is None:
        return None
    start_ms = now_ms - window.duration_ms
    points = repository.query_telemetry(
        org_id,
        device=device,
        tag=tag,
        start_ms=start_ms,
        end_ms=now_ms,
        limit=50_000,
    )
    series = build_series(device, tag, window, points, now_ms)
    payload = series.to_dict()
    payload["summary"] = series_summary(series)
    payload["excluded"] = excluded_count(points)
    payload["label"] = window.label
    payload["start_ms"] = start_ms
    payload["end_ms"] = now_ms
    #: Veri gerçek telemetri tablosundan gelir; benzetim değildir.
    payload["origin"] = "telemetry"
    return payload
