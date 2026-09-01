"""Little's Law doğrulama modülü — Şartname Bölüm 3.3.

Little's Law
------------
J. D. C. Little'ın 1961'de kanıtladığı bağıntı, kararlı durumdaki her kuyruk
sistemi için geçerlidir:

    L = lambda * W

burada L sistemdeki ortalama birim sayısı, lambda etkin varış hızı ve W bir
birimin sistemde geçirdiği ortalama süredir. Bağıntının olağanüstü yanı,
**hiçbir dağılım varsayımı gerektirmemesidir**: varışlar Poisson olmak
zorunda değildir, hizmet süreleri üstel olmak zorunda değildir, hizmet
disiplini FIFO olmak zorunda değildir. Yalnızca sistemin kararlı olması ve
uzun vadede giren birim sayısının çıkanla eşitlenmesi yeterlidir.

Bu genellik, bağıntıyı bir simülasyon motoru için **iç tutarlılık testine**
dönüştürür: L zaman ağırlıklı bir integralden, W ise parça başına gözlemlerden
üretilir. İkisi birbirinden tamamen bağımsız yollarla ölçülür; eşitlik
bozuluyorsa motorun sayaçlarında mantık hatası vardır (parça sayacının
düşürülmemesi, akış süresi gözleminin kaydedilmemesi, ısınma sıfırlamasının
eksik yapılması gibi).

Hangi lambda kullanılır?
------------------------
Ölçüm penceresi sonlu olduğu için lambda seçimi sonucu etkiler. Bu modül
sistem düzeyinde **çıkış** hızını kullanır (`effective_arrival_rate`):
pencerede kaydedilen W gözlemleri tam olarak pencerede *çıkan* parçalara
aittir, dolayısıyla aynı kümeden türetilen bir hız sonlu örneklem sapmasını
en aza indirir. Kararlı durumda giriş ve çıkış hızları zaten eşitlenir.

İstasyon düzeyi denetim
-----------------------
Bağıntı her alt sisteme ayrı ayrı uygulanabilir. Bir istasyonun **tamponu**
için:

    Lq = lambda_j * Wq

burada lambda_j o tamponu kullanan parçaların hızıdır. Bu denetim sistem
düzeyindekinden daha keskindir, çünkü sonlu pencere etkisi dışında özdeşlik
tam olarak sağlanmalıdır:

    INTEGRAL(kuyruk uzunlugu) dt = TOPLAM(bekleme sureleri)

Sol taraf Lq * pencere, sağ taraf gözlem sayısı * Wq'dur. Bu nedenle lambda_j
olarak istasyona giren parça sayısı değil, **bekleme gözlemi sayısı** kullanılır;
ikisi ısınma sınırında birkaç parça kadar farklılaşabilir.

Sınır etkisi
------------
Pencere sonunda hâlâ sistemde olan parçalar integrale katkı yapmış ama akış
süresi gözlemi üretmemiştir. Bu artık terim pencere uzadıkça sıfıra gider;
şartnamedeki %5 tolerans tam olarak bu sonlu pencere etkisini soğurmak içindir.

Kaynaklar
---------
- Little, J. D. C. (1961). "A Proof for the Queuing Formula: L = lambda W."
  *Operations Research*, 9(3), 383-387.
- Law, A. M. (2015). *Simulation Modeling and Analysis*, 5th ed., Bölüm 11.5.
"""

from __future__ import annotations

from typing import List, Optional

from simulation_engine.models.schemas import (
    LittlesLawReport,
    LittlesLawValidation,
    ReplicationResult,
    StationRunMetrics,
)

# --------------------------------------------------------------------------- #
# Adlandırılmış sabitler
# --------------------------------------------------------------------------- #

#: Şartnamede belirtilen kabul edilebilir azami sapma yüzdesi.
DEFAULT_TOLERANCE_PCT: float = 5.0

#: L ve lambda*W değerlerinin ikisi de bu eşiğin altındaysa sistem pratikte
#: boştur; bağıl sapma hesaplamak anlamsız olacağından denetim geçmiş sayılır.
NEGLIGIBLE_MAGNITUDE: float = 1e-9

SYSTEM_SCOPE: str = "system"


def _relative_deviation_pct(observed: float, predicted: float) -> float:
    """İki değer arasındaki bağıl sapmayı yüzde olarak döndürür.

    Payda olarak ikisinin büyüğü kullanılır; böylece hangisinin "doğru" kabul
    edildiğine bağlı olmayan, simetrik bir ölçü elde edilir.
    """
    scale = max(abs(observed), abs(predicted))
    if scale < NEGLIGIBLE_MAGNITUDE:
        return 0.0
    return abs(observed - predicted) / scale * 100.0


def _build_validation(
    scope: str,
    description: str,
    observed_l: float,
    arrival_rate: float,
    average_time: float,
    tolerance_pct: float,
) -> LittlesLawValidation:
    """Tek bir kapsam için denetim sonucunu ve açıklama metnini üretir."""
    predicted_l = arrival_rate * average_time
    deviation_pct = _relative_deviation_pct(observed_l, predicted_l)
    passed = deviation_pct <= tolerance_pct

    if passed:
        message = (
            f"{description}: L = {observed_l:.6f}, lambda * W = {predicted_l:.6f}, "
            f"sapma %{deviation_pct:.3f} (tolerans %{tolerance_pct:.1f})."
        )
    else:
        message = (
            f"TUTARSIZLIK — {description}: olculen L = {observed_l:.6f} ile "
            f"lambda * W = {predicted_l:.6f} arasinda %{deviation_pct:.3f} sapma var "
            f"(tolerans %{tolerance_pct:.1f}). Little's Law kararli durumdaki her "
            f"kuyruk sistemi icin dagilimdan bagimsiz olarak gecerlidir; bu kadar "
            f"buyuk bir sapma motorun sayaclarinda mantik hatasi oldugunu gosterir. "
            f"Olasi nedenler: sistemdeki parca sayacinin dusurulmemesi, akis suresi "
            f"gozleminin kaydedilmemesi, isinma sifirlamasinin eksik yapilmasi veya "
            f"sistemin kararsiz olmasi (rho >= 1)."
        )

    return LittlesLawValidation(
        scope=scope,
        description=description,
        observed_l=observed_l,
        predicted_l=predicted_l,
        arrival_rate=arrival_rate,
        average_time=average_time,
        deviation_pct=deviation_pct,
        tolerance_pct=tolerance_pct,
        passed=passed,
        message=message,
    )


def validate_system(
    result: ReplicationResult, tolerance_pct: float = DEFAULT_TOLERANCE_PCT
) -> LittlesLawValidation:
    """Sistem geneli L = lambda * W denetimi.

    Args:
        result: Tek bir replikasyonun ham sonuçları.
        tolerance_pct: Kabul edilen azami bağıl sapma yüzdesi.

    Returns:
        Sistem düzeyi denetim sonucu.
    """
    system = result.system
    return _build_validation(
        scope=SYSTEM_SCOPE,
        description="Sistem geneli (L = ortalama WIP, W = ortalama akis suresi)",
        observed_l=system.avg_wip,
        arrival_rate=system.effective_arrival_rate,
        average_time=system.avg_flow_time,
        tolerance_pct=tolerance_pct,
    )


def validate_station_queue(
    metrics: StationRunMetrics,
    window_minutes: float,
    tolerance_pct: float = DEFAULT_TOLERANCE_PCT,
) -> LittlesLawValidation:
    """Bir istasyonun tamponu için Lq = lambda_j * Wq denetimi.

    lambda_j olarak bekleme gözlemi sayısının pencereye oranı kullanılır;
    kuyruk uzunluğu integrali ile bekleme süreleri toplamı tam olarak bu
    parçalar üzerinden eşleşir (bkz. modül açıklaması).

    Args:
        metrics: İstasyonun ham gözlemleri.
        window_minutes: İstatistik penceresinin uzunluğu.
        tolerance_pct: Kabul edilen azami bağıl sapma yüzdesi.

    Returns:
        İstasyon tamponu için denetim sonucu.
    """
    arrival_rate = (
        metrics.wait_time_observations / window_minutes if window_minutes > 0.0 else 0.0
    )
    return _build_validation(
        scope=metrics.station_id,
        description=(
            f"'{metrics.station_name}' tamponu "
            f"(Lq = ortalama kuyruk boyu, Wq = ortalama bekleme)"
        ),
        observed_l=metrics.avg_queue_length,
        arrival_rate=arrival_rate,
        average_time=metrics.avg_wait_time,
        tolerance_pct=tolerance_pct,
    )


def validate(
    result: ReplicationResult, tolerance_pct: float = DEFAULT_TOLERANCE_PCT
) -> LittlesLawReport:
    """Sistem ve tüm istasyonlar için Little's Law denetimini çalıştırır.

    Şartname Bölüm 3.3'ün öngördüğü otomatik iç tutarlılık testidir: her
    simülasyon sonunda çağrılması, motorun kendi kendini denetlemesini sağlar.

    Args:
        result: Tek bir replikasyonun ham sonuçları.
        tolerance_pct: Kabul edilen azami bağıl sapma yüzdesi.

    Returns:
        Sistem düzeyi ve istasyon düzeyi denetimleri içeren rapor.
    """
    window = result.system.window_duration_minutes
    system_validation = validate_system(result, tolerance_pct)
    station_validations = [
        validate_station_queue(metrics, window, tolerance_pct)
        for metrics in result.stations
    ]

    all_validations = [system_validation, *station_validations]
    failures = [item for item in all_validations if not item.passed]
    messages: List[str] = [item.message for item in failures]

    if not result.stability.is_stable:
        messages.append(
            "NOT: Model kararsiz oldugu icin (rho >= 1) Little's Law denetimi "
            "anlamli bir yorum tasimaz; kararli durum ortalamalari tanimsizdir."
        )

    return LittlesLawReport(
        system=system_validation,
        stations=station_validations,
        passed=not failures,
        max_deviation_pct=max(item.deviation_pct for item in all_validations),
        messages=messages,
    )


def format_report(report: LittlesLawReport) -> str:
    """Raporu insan tarafından okunabilir bir tabloya dönüştürür.

    Şartname Bölüm 5'teki `/validation-report` ucu bu metni doğrudan
    kullanabilir.
    """
    lines: List[str] = [
        "LITTLE'S LAW DOGRULAMASI (L = lambda * W)",
        "-" * 78,
        f"{'Kapsam':<20}{'Olculen L':>13}{'lambda*W':>13}"
        f"{'Sapma':>10}{'Sonuc':>10}",
        "-" * 78,
    ]
    for validation in [report.system, *report.stations]:
        verdict = "GECTI" if validation.passed else "KALDI"
        lines.append(
            f"{validation.scope:<20}{validation.observed_l:>13.6f}"
            f"{validation.predicted_l:>13.6f}"
            f"{f'%{validation.deviation_pct:.3f}':>10}{verdict:>10}"
        )
    lines.append("-" * 78)
    lines.append(
        f"Genel sonuc: {'GECTI' if report.passed else 'KALDI'} | "
        f"azami sapma %{report.max_deviation_pct:.3f} | "
        f"tolerans %{report.system.tolerance_pct:.1f}"
    )
    for message in report.messages:
        lines.append(f"  ! {message}")
    return "\n".join(lines)


def assert_consistent(
    result: ReplicationResult,
    tolerance_pct: float = DEFAULT_TOLERANCE_PCT,
    scope: Optional[str] = None,
) -> LittlesLawReport:
    """Tutarsızlık hâlinde hata yükselten katı sürüm.

    Motorda yapılan bir değişikliğin Little's Law'ı bozmadığından emin olmak
    için sürekli tümleştirme (CI) akışlarında kullanılır.

    Args:
        result: Tek bir replikasyonun ham sonuçları.
        tolerance_pct: Kabul edilen azami bağıl sapma yüzdesi.
        scope: Yalnızca belirli bir kapsam denetlenecekse kimliği.

    Returns:
        Denetim raporu (tutarlıysa).

    Raises:
        AssertionError: Herhangi bir denetim toleransı aşarsa.
    """
    report = validate(result, tolerance_pct)
    failures = [
        item
        for item in [report.system, *report.stations]
        if not item.passed and (scope is None or item.scope == scope)
    ]
    if failures:
        raise AssertionError("\n".join(item.message for item in failures))
    return report
