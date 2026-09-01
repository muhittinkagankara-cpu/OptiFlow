"""Analitik kuyruk teorisi — M/M/1 ve M/M/c (Erlang-C) — Şartname Bölüm 3.1-3.2.

Bu modül simülasyondan tamamen bağımsızdır: yalnızca lambda, mu ve c
parametrelerinden kapalı form sonuçlar üretir. Bağımsızlığı kritiktir, çünkü
simülasyon motorunun doğruluğu bu modülün sonuçlarıyla sınanır (Şartname
TEST 1). İki taraf aynı koda dayansaydı, ortak bir hata her iki tarafta da
görünmez kalırdı.

M/M/1 (tek sunucu)
------------------
    rho = lambda / mu
    P0  = 1 - rho
    L   = rho / (1 - rho)
    Lq  = rho^2 / (1 - rho)
    W   = 1 / (mu - lambda)
    Wq  = rho / (mu - lambda)

M/M/c (çok sunucu)
------------------
Sunulan yük a = lambda / mu (erlang), sunucu başına kullanım rho = a / c.
Sistemin boş olma olasılığı:

    P0 = [ SUM_{n=0}^{c-1} a^n / n!  +  (a^c / c!) * (1 / (1 - rho)) ]^-1

Erlang-C, gelen bir parçanın beklemek zorunda kalma olasılığıdır:

    C(c, a) = (a^c / (c! * (1 - rho))) * P0

Diğer büyüklükler bu iki değerden türetilir:

    Lq = C(c, a) * rho / (1 - rho)
    Wq = Lq / lambda
    W  = Wq + 1 / mu
    L  = lambda * W = Lq + a

Sayısal kararlılık
------------------
a^n ve n! ayrı ayrı hesaplanırsa c yaklaşık 170'i geçtiğinde taşma olur ve
büyük a değerlerinde anlamlı basamak kaybı yaşanır. Bu modül toplamı
**artımlı terimlerle** kurar: t_0 = 1 ve t_n = t_{n-1} * a / n. Böylece ne
faktöriyel ne de üs doğrudan hesaplanır.

İkinci bir güvence olarak Erlang-B, taşmaya tamamen bağışık olan klasik
özyinelemeyle ayrıca hesaplanır:

    B(0, a) = 1,   B(n, a) = a * B(n-1, a) / (n + a * B(n-1, a))

ve iki yöntemin tutarlılığı şu bilinen özdeşlikle sınanabilir:

    C(c, a) = B(c, a) / (1 - rho * (1 - B(c, a)))

Bu özdeşlik `verify_erlang_consistency` fonksiyonuyla test edilir.

Kararlılık uyarısı
------------------
rho >= 1 olduğunda kapalı form çözümler tanımsızdır: kuyruk sınırsız büyür.
Bu durumda fonksiyonlar hata yükseltmek yerine `is_stable=False`, sonsuz
kuyruk büyüklükleri ve açık bir uyarı metni döndürür — böylece API katmanı
kullanıcıya sessizce anlamsız bir sayı sunmak yerine durumu bildirebilir
(Şartname TEST 3).

Kaynaklar
---------
- Gross, D. & Harris, C. M. (2008). *Fundamentals of Queueing Theory*, 4th ed.,
  Bölüm 2.2 (M/M/1) ve 2.3 (M/M/c, Erlang-C).
- Cooper, R. B. (1981). *Introduction to Queueing Theory*, 2nd ed., Bölüm 3
  (Erlang-B özyinelemesi ve Erlang-B / Erlang-C ilişkisi).
"""

from __future__ import annotations

import math
from typing import List

from simulation_engine.models.schemas import QueueingMetrics

# --------------------------------------------------------------------------- #
# Adlandırılmış sabitler
# --------------------------------------------------------------------------- #

#: rho bu değere eşit veya büyükse sistem kararsızdır.
STABILITY_LIMIT: float = 1.0

#: Erlang-B / Erlang-C tutarlılık denetiminde kabul edilen mutlak fark.
ERLANG_CONSISTENCY_TOLERANCE: float = 1e-9

#: M/M/1 için Kendall notasyonu.
NOTATION_MM1: str = "M/M/1"

#: M/M/c için Kendall notasyonu.
NOTATION_MMC: str = "M/M/c"


def _validate_rates(arrival_rate: float, service_rate: float, num_servers: int) -> None:
    """Kuyruk modeli parametrelerinin fiziksel olarak anlamlı olduğunu doğrular."""
    if arrival_rate <= 0.0:
        raise ValueError(f"Varis hizi lambda pozitif olmalidir, alinan: {arrival_rate}")
    if service_rate <= 0.0:
        raise ValueError(f"Hizmet hizi mu pozitif olmalidir, alinan: {service_rate}")
    if num_servers < 1:
        raise ValueError(f"Sunucu sayisi c en az 1 olmalidir, alinan: {num_servers}")


def _unstable_metrics(
    notation: str,
    arrival_rate: float,
    service_rate: float,
    num_servers: int,
    offered_load: float,
    utilization: float,
) -> QueueingMetrics:
    """Kararsız sistem için sonsuz kuyruk büyüklükleri ve uyarı üretir."""
    warning = (
        f"KARARSIZ SISTEM: rho = {utilization:.4f} >= 1. Varis hizi "
        f"(lambda = {arrival_rate:.4f}) toplam hizmet kapasitesini "
        f"(c * mu = {num_servers * service_rate:.4f}) asiyor; kuyruk sinirsiz "
        f"buyur ve kararli durum ortalamalari tanimsizdir. Kapali form "
        f"formulleri bu bolgede uygulanamaz."
    )
    return QueueingMetrics(
        notation=notation,
        arrival_rate=arrival_rate,
        service_rate=service_rate,
        num_servers=num_servers,
        offered_load=offered_load,
        utilization=utilization,
        is_stable=False,
        probability_system_empty=0.0,
        probability_of_waiting=1.0,
        l_system=math.inf,
        l_queue=math.inf,
        w_system=math.inf,
        w_queue=math.inf,
        warnings=[warning],
    )


def mm1_metrics(arrival_rate: float, service_rate: float) -> QueueingMetrics:
    """M/M/1 kuyruk modelinin kapalı form sonuçlarını hesaplar.

    Args:
        arrival_rate: lambda, birim zamandaki varış sayısı.
        service_rate: mu, birim zamandaki hizmet sayısı.

    Returns:
        rho, P0, L, Lq, W ve Wq değerleri. rho >= 1 ise sonsuz kuyruk
        büyüklükleri ve kararsızlık uyarısı.

    Raises:
        ValueError: Hızlardan biri pozitif değilse.
    """
    _validate_rates(arrival_rate, service_rate, 1)
    utilization = arrival_rate / service_rate

    if utilization >= STABILITY_LIMIT:
        return _unstable_metrics(
            NOTATION_MM1, arrival_rate, service_rate, 1, utilization, utilization
        )

    idle_rate = service_rate - arrival_rate
    return QueueingMetrics(
        notation=NOTATION_MM1,
        arrival_rate=arrival_rate,
        service_rate=service_rate,
        num_servers=1,
        offered_load=utilization,
        utilization=utilization,
        is_stable=True,
        probability_system_empty=1.0 - utilization,
        # M/M/1'de bir parçanın beklemek zorunda kalma olasılığı, sunucunun
        # meşgul olma olasılığına yani rho'ya eşittir (PASTA özelliği).
        probability_of_waiting=utilization,
        l_system=utilization / (1.0 - utilization),
        l_queue=utilization**2 / (1.0 - utilization),
        w_system=1.0 / idle_rate,
        w_queue=utilization / idle_rate,
    )


def erlang_b(num_servers: int, offered_load: float) -> float:
    """Erlang-B kayıp olasılığını özyinelemeli olarak hesaplar.

    B(c, a), c sunuculu ve **kuyruksuz** bir sistemde gelen bir parçanın tüm
    sunucuları dolu bulup kaybolma olasılığıdır. Özyineleme taşmaya bağışıktır:

        B(0, a) = 1,   B(n, a) = a * B(n-1, a) / (n + a * B(n-1, a))

    Args:
        num_servers: Sunucu sayısı c (>= 0).
        offered_load: Sunulan yük a = lambda / mu (>= 0).

    Returns:
        0 ile 1 arasında kayıp olasılığı.

    Raises:
        ValueError: Parametreler negatifse.
    """
    if num_servers < 0:
        raise ValueError(f"Sunucu sayisi negatif olamaz, alinan: {num_servers}")
    if offered_load < 0.0:
        raise ValueError(f"Sunulan yuk negatif olamaz, alinan: {offered_load}")

    blocking_probability = 1.0
    for n in range(1, num_servers + 1):
        blocking_probability = (offered_load * blocking_probability) / (
            n + offered_load * blocking_probability
        )
    return blocking_probability


def erlang_c(num_servers: int, offered_load: float) -> float:
    """Erlang-C bekleme olasılığını Erlang-B üzerinden hesaplar.

    C(c, a) = B(c, a) / (1 - rho * (1 - B(c, a))),  rho = a / c

    Args:
        num_servers: Sunucu sayısı c (>= 1).
        offered_load: Sunulan yük a = lambda / mu.

    Returns:
        Gelen bir parçanın beklemek zorunda kalma olasılığı. Sistem kararsızsa
        (rho >= 1) 1.0 döner: her parça beklemek zorundadır.

    Raises:
        ValueError: Sunucu sayısı 1'den küçükse.
    """
    if num_servers < 1:
        raise ValueError(f"Erlang-C icin c >= 1 olmalidir, alinan: {num_servers}")
    utilization = offered_load / num_servers
    if utilization >= STABILITY_LIMIT:
        return 1.0
    blocking = erlang_b(num_servers, offered_load)
    return blocking / (1.0 - utilization * (1.0 - blocking))


def probability_system_empty(num_servers: int, offered_load: float) -> float:
    """M/M/c sisteminin boş olma olasılığı P0'ı hesaplar.

    Toplam artımlı terimlerle kurulur (t_n = t_{n-1} * a / n); böylece a^n ve
    n! hiçbir zaman ayrı ayrı hesaplanmaz ve büyük c değerlerinde taşma olmaz.

    Args:
        num_servers: Sunucu sayısı c (>= 1).
        offered_load: Sunulan yük a = lambda / mu.

    Returns:
        P0 değeri; sistem kararsızsa 0.0.
    """
    if num_servers < 1:
        raise ValueError(f"P0 icin c >= 1 olmalidir, alinan: {num_servers}")
    utilization = offered_load / num_servers
    if utilization >= STABILITY_LIMIT:
        return 0.0

    term = 1.0  # t_0 = a^0 / 0! = 1
    partial_sum = 1.0  # SUM_{n=0}^{c-1}
    for n in range(1, num_servers):
        term = term * offered_load / n
        partial_sum += term
    # t_c = a^c / c!
    term_at_c = term * offered_load / num_servers
    return 1.0 / (partial_sum + term_at_c / (1.0 - utilization))


def mmc_metrics(
    arrival_rate: float, service_rate: float, num_servers: int
) -> QueueingMetrics:
    """M/M/c kuyruk modelinin kapalı form sonuçlarını Erlang-C ile hesaplar.

    c = 1 verildiğinde sonuçlar M/M/1 ile matematiksel olarak özdeştir; bu,
    modülün kendi kendini denetleyen bir özelliğidir ve testlerle doğrulanır.

    Args:
        arrival_rate: lambda, birim zamandaki varış sayısı.
        service_rate: mu, **sunucu başına** birim zamandaki hizmet sayısı.
        num_servers: c, paralel sunucu sayısı.

    Returns:
        a, rho, P0, Erlang-C, L, Lq, W ve Wq değerleri.

    Raises:
        ValueError: Parametreler fiziksel olarak anlamsızsa.
    """
    _validate_rates(arrival_rate, service_rate, num_servers)
    offered_load = arrival_rate / service_rate
    utilization = offered_load / num_servers
    notation = NOTATION_MM1 if num_servers == 1 else NOTATION_MMC

    if utilization >= STABILITY_LIMIT:
        return _unstable_metrics(
            notation, arrival_rate, service_rate, num_servers, offered_load, utilization
        )

    p_zero = probability_system_empty(num_servers, offered_load)
    wait_probability = erlang_c(num_servers, offered_load)

    l_queue = wait_probability * utilization / (1.0 - utilization)
    w_queue = l_queue / arrival_rate
    w_system = w_queue + 1.0 / service_rate
    l_system = arrival_rate * w_system

    warnings: List[str] = []
    if not math.isclose(l_system, l_queue + offered_load, rel_tol=1e-9, abs_tol=1e-12):
        # L = Lq + a ozdesligi tanim geregi saglanmalidir; saglanmiyorsa
        # hesaplamada sayisal bir sorun var demektir.
        warnings.append(
            f"Ic tutarsizlik: L={l_system:.9f} ile Lq+a={l_queue + offered_load:.9f} "
            f"esit degil."
        )

    return QueueingMetrics(
        notation=notation,
        arrival_rate=arrival_rate,
        service_rate=service_rate,
        num_servers=num_servers,
        offered_load=offered_load,
        utilization=utilization,
        is_stable=True,
        probability_system_empty=p_zero,
        probability_of_waiting=wait_probability,
        l_system=l_system,
        l_queue=l_queue,
        w_system=w_system,
        w_queue=w_queue,
        warnings=warnings,
    )


def analyze(
    arrival_rate: float, service_time_mean: float, num_servers: int = 1
) -> QueueingMetrics:
    """İstasyon parametrelerinden uygun kuyruk modelini seçip çözer.

    İşlem süresi ortalamasından hizmet hızını türetir (mu = 1 / E[S]) ve
    sunucu sayısına göre M/M/1 veya M/M/c formüllerini uygular. Motorun
    `Station` nesnelerinden gelen verilerle doğrudan çağrılabilir.

    Args:
        arrival_rate: İstasyona gelen lambda (ziyaret oranıyla çarpılmış olmalı).
        service_time_mean: E[S], ortalama işlem süresi.
        num_servers: c, paralel sunucu sayısı.

    Returns:
        Seçilen modelin kapalı form sonuçları.

    Raises:
        ValueError: Ortalama işlem süresi pozitif değilse.
    """
    if service_time_mean <= 0.0:
        raise ValueError(
            f"Ortalama islem suresi pozitif olmalidir, alinan: {service_time_mean}"
        )
    service_rate = 1.0 / service_time_mean
    if num_servers == 1:
        return mm1_metrics(arrival_rate, service_rate)
    return mmc_metrics(arrival_rate, service_rate, num_servers)


def verify_erlang_consistency(num_servers: int, offered_load: float) -> bool:
    """Erlang-C'nin iki bağımsız hesabının uyuştuğunu doğrular.

    Birinci yol: P0 üzerinden doğrudan tanım,
    C = (a^c / (c! * (1 - rho))) * P0.
    İkinci yol: Erlang-B özyinelemesi üzerinden,
    C = B / (1 - rho * (1 - B)).

    İki yolun uyuşması, hem faktöriyel toplamının hem de özyinelemenin doğru
    uygulandığını gösterir.

    Args:
        num_servers: Sunucu sayısı c.
        offered_load: Sunulan yük a.

    Returns:
        Fark `ERLANG_CONSISTENCY_TOLERANCE` içindeyse True.
    """
    utilization = offered_load / num_servers
    if utilization >= STABILITY_LIMIT:
        return erlang_c(num_servers, offered_load) == 1.0

    p_zero = probability_system_empty(num_servers, offered_load)
    term = 1.0
    for n in range(1, num_servers + 1):
        term = term * offered_load / n
    direct = term / (1.0 - utilization) * p_zero
    via_erlang_b = erlang_c(num_servers, offered_load)
    return abs(direct - via_erlang_b) < ERLANG_CONSISTENCY_TOLERANCE
