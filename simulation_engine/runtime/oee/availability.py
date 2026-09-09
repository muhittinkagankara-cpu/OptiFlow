"""Kullanılabilirlik (Availability) — OEE'nin ilk çarpanı.

    Availability = Çalışma Süresi / Planlanan Süre

Ölçülemeyen hiçbir şey uydurulmaz
---------------------------------
Planlanan süre bilinmiyorsa kullanılabilirlik **hesaplanamaz** ve `None`
döner. Sıfır dönmek, hiç izlenmemiş bir hattı "hiç çalışmadı" diye
raporlamak olurdu — ve OEE çarpımı olduğu için tek bir sahte sıfır bütün
göstergeyi sıfırlar.

Çalışma süresi nereden gelir
----------------------------
İki yol vardır ve ikisi de gerçek veridir:

1. **Duruş kayıtlarından** — makine `DOWN` olduğunda başlayan, `RUNNING`
   olduğunda biten aralıklar (`runtime_downtime_events`). Planlanan süreden
   duruşlar çıkarılır.
2. **Cihazın bildirdiği duruş süresinden** — bazı PLC'ler bunu doğrudan
   yayınlar (`downtime_minutes`).

Birincisi ölçülmüş, ikincisi bildirilmiştir; ikisi de varsa **ölçülen**
kullanılır çünkü bildirilen değer vardiya başında sıfırlanmış olabilir.
"""

from __future__ import annotations

import math
from typing import Optional

#: Bir değerin kullanılabilirlik olarak kabul edilebilmesi için sınırlar.
MIN_RATIO = 0.0
MAX_RATIO = 1.0


def clamp_ratio(value: Optional[float]) -> Optional[float]:
    """Oranı 0-1 aralığına çeker; ölçüm değilse `None` döner.

    Aralık dışına çıkmak ölçüm hatasıdır (ör. duruş süresi planlanan süreden
    uzun kaydedilmiş). Kırpmak, ekranda %120 kullanılabilirlik göstermekten
    dürüsttür; kırpıldığı da çağırana `is_clamped` ile bildirilir.

    `NaN` ve sonsuz **kırpılmaz, düşürülür**. Kırpılsalardı `NaN` sessizce
    0'a dönerdi ve bozuk bir hesap "hat hiç çalışmadı" gibi görünürdü;
    ölçülemeyen bir değerin doğru karşılığı `None`'dır.
    """
    if not _is_measurement(value):
        return None
    return max(MIN_RATIO, min(MAX_RATIO, value))


def is_clamped(value: Optional[float]) -> bool:
    """Bu değer kırpılmış mıydı?

    Ölçüm olmayan bir değer kırpılmış sayılmaz: kırpma, ölçülmüş ama aralık
    dışına düşmüş bir sayıyı anlatır.
    """
    if not _is_measurement(value):
        return False
    return value < MIN_RATIO or value > MAX_RATIO


def _is_measurement(value: Optional[float]) -> bool:
    """Değer gerçek bir sayı mı? (`None`, `NaN` ve sonsuz değil)"""
    if value is None or isinstance(value, bool):
        return False
    return isinstance(value, (int, float)) and math.isfinite(value)


def availability(
    planned_time_ms: Optional[float], downtime_ms: Optional[float]
) -> Optional[float]:
    """Kullanılabilirlik oranı (0-1); hesaplanamıyorsa `None`.

    Planlanan süre yoksa ya da sıfırsa oran tanımsızdır. Duruş süresi
    bilinmiyorsa da hesaplanmaz: duruşu sıfır varsaymak, izlenmeyen bir hattı
    kusursuz göstermek olurdu.
    """
    if planned_time_ms is None or downtime_ms is None:
        return None
    if planned_time_ms <= 0:
        return None

    run_time = planned_time_ms - max(0.0, downtime_ms)
    return clamp_ratio(run_time / planned_time_ms)


def run_time_ms(
    planned_time_ms: Optional[float], downtime_ms: Optional[float]
) -> Optional[float]:
    """Çalışma süresi; hesaplanamıyorsa `None`."""
    if planned_time_ms is None or downtime_ms is None:
        return None
    return max(0.0, planned_time_ms - max(0.0, downtime_ms))


def availability_from_minutes(
    planned_minutes: Optional[float], downtime_minutes: Optional[float]
) -> Optional[float]:
    """Dakika cinsinden girdiyle kullanılabilirlik."""
    if planned_minutes is None or downtime_minutes is None:
        return None
    return availability(planned_minutes * 60_000, downtime_minutes * 60_000)


def availability_reason(
    planned_time_ms: Optional[float], downtime_ms: Optional[float]
) -> Optional[str]:
    """Hesaplanamadıysa nedeni; hesaplandıysa `None`.

    Arayüz "—" gösterirken bu cümleyi de yazar: ölçülemeyen bir değerin neden
    ölçülemediğini söylemek, kullanıcının eksiği tamamlamasını sağlar.
    """
    if planned_time_ms is None:
        return "Planlanan üretim süresi tanımlı değil."
    if planned_time_ms <= 0:
        return "Planlanan üretim süresi sıfır."
    if downtime_ms is None:
        return "Duruş süresi ölçülmedi."
    return None
