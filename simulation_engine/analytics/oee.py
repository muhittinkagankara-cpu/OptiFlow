"""OEE (Overall Equipment Effectiveness) hesaplama — Şartname Bölüm 3.4.

Teorik dayanak
--------------
OEE, Seiichi Nakajima'nın Toplam Verimli Bakım (TPM) çerçevesinde tanımladığı
ve bir ekipmanın teorik kapasitesinin ne kadarını gerçekten değere dönüştürdüğünü
ölçen bileşik göstergedir:

    OEE = Availability x Performance x Quality

    Availability = Çalışma Süresi / Planlanan Üretim Süresi
    Performance  = (Toplam Üretim x İdeal Çevrim Süresi) / Çalışma Süresi
    Quality      = İyi Ürün Sayısı / Toplam Üretim

Üç bileşen bir **zaman merdiveni** oluşturur; her basamak bir kayıp türünü
düşer ve OEE aslında en alt basamağın en üst basamağa oranıdır:

    Planlanan Üretim Süresi          (pencere uzunluğu x sunucu sayısı)
      - arıza süresi                 -> Availability kaybı
    = Çalışma Süresi
      - üretime dönüşmeyen süre      -> Performance kaybı (açlık, blokaj, hız)
    = Net Çalışma Süresi             (toplam üretim x ideal çevrim süresi)
      - hurdaya harcanan süre        -> Quality kaybı
    = Tam Verimli Süre               (iyi ürün x ideal çevrim süresi)

    OEE = Tam Verimli Süre / Planlanan Üretim Süresi

Bu özdeşlik, üç bileşenin çarpımının doğrudan zaman oranına eşit olmasını
sağlar ve modülün kendi kendini denetlemesine imkân verir.

"Neden düşük?" sorusunun yanıtı
-------------------------------
Şartname tek bir OEE skoru değil, hangi bileşenin düşük olduğunu gösteren
kırılım istiyor. Bu modül her bileşenin dakika cinsinden kaybını ayrı ayrı
raporlar ve Performance kaybını iki fiziksel nedene ayırır:

- **Açlık (starvation):** istasyon boşta çünkü işleyecek parça yok. Kök neden
  yukarı akıştadır; bu istasyona yatırım yapmak OEE'yi yükseltmez.
- **Blokaj (blocking):** istasyon işini bitirdi ama aşağı akış dolu olduğu için
  parçayı bırakamıyor. Kök neden aşağı akıştadır.

Bu ayrım Kısıtlar Teorisi ile doğrudan bağlantılıdır: yalnızca darboğaz
istasyonunun OEE'si hattın çıktısını belirler; darboğaz olmayan bir istasyonun
düşük OEE'si çoğunlukla açlık kaynaklıdır ve "iyileştirilmesi" çıktıyı
artırmaz.

Bunun pratik bir sonucu vardır ve `compute_oee_report` bu sonuca göre kurulur:
**hattın OEE'si, en düşük OEE'li istasyonunki değil, darboğaz istasyonununkidir.**
En düşük OEE'ye sahip istasyon tipik olarak en az yüklü olandır; parça
bulamadığı için Performance'ı düşüktür. Örneğin çevrim süresi 0,5 dk olan bir
besleme istasyonu 0,8 parça/dk akışta yalnızca %40 meşguldür ve OEE'si 0,40
çıkar; ardındaki 1,1 dk'lık gerçek darboğaz %88 meşgul olup (fire %20 ile)
0,70 OEE gösterir. Hattı 0,40 ile raporlamak, kısıt olmayan bir istasyona
yatırım yapılmasına yol açan klasik yerel optimizasyon hatasıdır.

Simülasyon ölçümüne özgü bir not
--------------------------------
Gerçek bir fabrikada Performance yalnızca hız kaybını (yavaş çalışma, küçük
duruşlar) ölçer; planlanan süre içinde iş beklemesi genelde ayrı raporlanır.
Simülasyonda ise açlık ve blokaj doğrudan gözlenebildiği için bunlar da
Performance kaybının içinde çıkar ve ayrıca kırılımda gösterilir. Bu,
Nakajima'nın "altı büyük kayıp" listesindeki *boşta bekleme ve küçük duruşlar*
kaybının tam karşılığıdır.

Kaynaklar
---------
- Nakajima, S. (1988). *Introduction to TPM: Total Productive Maintenance*,
  Productivity Press.
- Goldratt, E. M. (1984). *The Goal* (darboğaz ve yerel optimizasyon).
"""

from __future__ import annotations

from typing import List, Optional

from simulation_engine.models.schemas import (
    OEEComponent,
    OEEReport,
    ReplicationResult,
    StationOEE,
    StationRunMetrics,
)

# --------------------------------------------------------------------------- #
# Adlandırılmış sabitler
# --------------------------------------------------------------------------- #

#: Nakajima'nın "dünya standardı" (world-class) hedefleri. Bir bileşen bu
#: eşiğin altındaysa iyileştirmeye açık kabul edilir.
WORLD_CLASS_AVAILABILITY: float = 0.90
WORLD_CLASS_PERFORMANCE: float = 0.95
WORLD_CLASS_QUALITY: float = 0.999
WORLD_CLASS_OEE: float = 0.85

#: Bileşenlerin çarpımı ile zaman oranı arasındaki tutarlılık kontrolünde
#: kabul edilen kayan nokta toleransı.
IDENTITY_TOLERANCE: float = 1e-9

#: Performance bileşeni bu değerin üzerine çıkarsa ideal çevrim süresi gerçek
#: çevrim süresinden büyük demektir; kullanıcı uyarılır.
PERFORMANCE_UPPER_SANITY_LIMIT: float = 1.0 + 1e-6

#: Bir kaybın teşhis metninde "baskın neden" sayılması için gereken asgari pay.
DOMINANT_CAUSE_SHARE: float = 0.5


def compute_station_oee(metrics: StationRunMetrics) -> StationOEE:
    """Tek bir istasyonun OEE kırılımını hesaplar.

    Args:
        metrics: Motorun ürettiği ham istasyon gözlemleri.

    Returns:
        Üç bileşen, zaman merdiveni, kayıp kırılımı ve teşhis metni.

    Notes:
        Üretim hiç gerçekleşmediyse Performance 0, Quality 1.0 kabul edilir
        (hurda kanıtı yoktur) ve OEE 0 çıkar. Bu, 0/0 belirsizliğini sessizce
        1.0'a yuvarlamaktan daha dürüst bir davranıştır: üretim yapmayan bir
        makinenin verimliliği sıfırdır.
    """
    warnings: List[str] = []

    planned = metrics.planned_production_time_minutes
    run_time = planned - metrics.down_minutes
    units_produced = metrics.units_produced
    units_scrapped = metrics.units_scrapped
    units_good = units_produced - units_scrapped

    if units_scrapped > units_produced:  # pragma: no cover - motor bunu engeller
        raise ValueError(
            f"'{metrics.station_id}' istasyonunda hurda sayisi ({units_scrapped}) "
            f"uretim sayisindan ({units_produced}) buyuk olamaz."
        )

    # --- Zaman merdiveni ---
    net_operating_time = units_produced * metrics.ideal_cycle_time
    fully_productive_time = units_good * metrics.ideal_cycle_time

    # --- Üç bileşen ---
    availability = run_time / planned if planned > 0.0 else 0.0
    performance = net_operating_time / run_time if run_time > 0.0 else 0.0
    quality = units_good / units_produced if units_produced > 0 else 1.0
    oee = availability * performance * quality

    if performance > PERFORMANCE_UPPER_SANITY_LIMIT:
        warnings.append(
            f"Performance = {performance:.4f} > 1. Ideal cevrim suresi "
            f"({metrics.ideal_cycle_time:.4f} dk) gercek cevrim suresinden buyuk "
            f"gorunuyor; islem suresi dagiliminin ortalamasini kontrol edin."
        )
    if planned <= 0.0:
        warnings.append(
            "Planlanan uretim suresi sifir; istatistik penceresi bos oldugu icin "
            "OEE hesaplanamadi."
        )
    if units_produced == 0 and planned > 0.0:
        warnings.append(
            "Istatistik penceresinde hic uretim yok; OEE sifir olarak raporlandi."
        )

    return StationOEE(
        station_id=metrics.station_id,
        station_name=metrics.station_name,
        availability=availability,
        performance=performance,
        quality=quality,
        oee=oee,
        planned_production_time_minutes=planned,
        run_time_minutes=run_time,
        net_operating_time_minutes=net_operating_time,
        fully_productive_time_minutes=fully_productive_time,
        availability_loss_minutes=metrics.down_minutes,
        performance_loss_minutes=max(run_time - net_operating_time, 0.0),
        quality_loss_minutes=max(net_operating_time - fully_productive_time, 0.0),
        starvation_minutes=metrics.idle_minutes,
        blocking_minutes=metrics.blocked_minutes,
        units_produced=units_produced,
        units_good=units_good,
        units_scrapped=units_scrapped,
        limiting_component=_limiting_component(availability, performance, quality),
        diagnosis=_build_diagnosis(
            metrics, availability, performance, quality, oee, run_time, net_operating_time
        ),
        warnings=warnings,
    )


def compute_oee_report(result: ReplicationResult) -> OEEReport:
    """Bir replikasyondaki tüm istasyonların OEE kırılımını üretir.

    Hat düzeyi OEE, **darboğaz istasyonunun** OEE'sidir. Darboğaz, en yüksek
    kullanım oranına (rho) sahip istasyon olarak belirlenir; Kısıtlar Teorisi
    gereği hattın çıktısını bu istasyon sınırlar (Goldratt 1984). İstasyon
    OEE'lerinin aritmetik ortalaması hattı olduğundan verimli, en düşük istasyon
    OEE'si ise olduğundan verimsiz gösterir — ikincisi genellikle yalnızca aç
    kalmış, kısıt olmayan bir istasyonu işaret eder (bkz. modül açıklaması).

    Args:
        result: Tek bir replikasyonun ham sonuçları.

    Returns:
        İstasyon bazında OEE kırılımı, darboğaz kimliği ve hat düzeyi OEE.
    """
    stations = [compute_station_oee(metrics) for metrics in result.stations]
    if not stations:
        return OEEReport(stations=[], line_oee=0.0)

    # Darboğaz: en yüksek kullanım oranı. Eşitlik durumunda konfigürasyon
    # sırası belirleyicidir, böylece sonuç deterministik kalır.
    bottleneck_metrics = max(result.stations, key=lambda item: item.utilization)
    bottleneck = next(
        station
        for station in stations
        if station.station_id == bottleneck_metrics.station_id
    )
    lowest = min(stations, key=lambda item: item.oee)

    return OEEReport(
        stations=stations,
        bottleneck_station_id=bottleneck.station_id,
        line_oee=bottleneck.oee,
        lowest_oee_station_id=lowest.station_id,
        lowest_oee=lowest.oee,
    )


def verify_oee_identity(station_oee: StationOEE) -> bool:
    """OEE = Tam Verimli Süre / Planlanan Üretim Süresi özdeşliğini doğrular.

    Üç bileşenin çarpımı, tanım gereği zaman merdiveninin en alt basamağının
    en üst basamağa oranına eşit olmalıdır. Bu iç tutarlılık kontrolü, bileşen
    formüllerinden birinde yapılacak bir hatayı anında yakalar.

    Args:
        station_oee: Hesaplanmış istasyon OEE kırılımı.

    Returns:
        Özdeşlik `IDENTITY_TOLERANCE` içinde sağlanıyorsa True.
    """
    planned = station_oee.planned_production_time_minutes
    if planned <= 0.0:
        return station_oee.oee == 0.0
    expected = station_oee.fully_productive_time_minutes / planned
    return abs(station_oee.oee - expected) < IDENTITY_TOLERANCE


def _limiting_component(
    availability: float, performance: float, quality: float
) -> Optional[OEEComponent]:
    """OEE'yi en çok kısıtlayan (en düşük) bileşeni belirler."""
    candidates: List[tuple[float, OEEComponent]] = [
        (availability, "availability"),
        (performance, "performance"),
        (quality, "quality"),
    ]
    return min(candidates, key=lambda item: item[0])[1]


def _build_diagnosis(
    metrics: StationRunMetrics,
    availability: float,
    performance: float,
    quality: float,
    oee: float,
    run_time: float,
    net_operating_time: float,
) -> str:
    """Kaybın nerede olduğunu açıklayan insan tarafından okunabilir metin üretir."""
    if metrics.planned_production_time_minutes <= 0.0:
        return "Istatistik penceresi bos; OEE hesaplanamadi."
    if metrics.units_produced == 0:
        return (
            f"'{metrics.station_name}' istatistik penceresinde hic uretim yapmadi. "
            f"Bosta gecen sure {metrics.idle_minutes:,.0f} dk, arizali gecen sure "
            f"{metrics.down_minutes:,.0f} dk."
        )

    limiting = _limiting_component(availability, performance, quality)
    parts = [
        f"OEE = %{oee * 100:.1f} "
        f"(A=%{availability * 100:.1f} x P=%{performance * 100:.1f} x "
        f"Q=%{quality * 100:.1f})."
    ]

    if limiting == "availability":
        parts.append(
            f"En kisitlayici bilesen KULLANILABILIRLIK: {metrics.failure_count} ariza "
            f"toplam {metrics.down_minutes:,.0f} dk durusa yol acti "
            f"(planlanan surenin %{(1 - availability) * 100:.1f}'i). "
            f"Onleyici bakim veya daha kisa onarim suresi en yuksek getiriyi saglar."
        )
    elif limiting == "performance":
        performance_loss = max(run_time - net_operating_time, 0.0)
        starvation_share = (
            metrics.idle_minutes / performance_loss if performance_loss > 0.0 else 0.0
        )
        blocking_share = (
            metrics.blocked_minutes / performance_loss if performance_loss > 0.0 else 0.0
        )
        detail = (
            f"En kisitlayici bilesen PERFORMANS: calisma suresinin "
            f"{performance_loss:,.0f} dk'si uretime donusmedi "
            f"(aclik {metrics.idle_minutes:,.0f} dk, blokaj "
            f"{metrics.blocked_minutes:,.0f} dk)."
        )
        if starvation_share >= DOMINANT_CAUSE_SHARE:
            detail += (
                " Kaybin buyuk bolumu ACLIK kaynakli: istasyon islenecek parca "
                "bekliyor. Kok neden yukari akista; bu istasyona yapilacak "
                "iyilestirme hattin ciktisini artirmaz."
            )
        elif blocking_share >= DOMINANT_CAUSE_SHARE:
            detail += (
                " Kaybin buyuk bolumu BLOKAJ kaynakli: istasyon isini bitirdigi "
                "halde parcayi birakamiyor. Kok neden asagi akistaki darbogaz "
                "veya yetersiz tampon kapasitesi."
            )
        parts.append(detail)
    else:
        parts.append(
            f"En kisitlayici bilesen KALITE: {metrics.units_produced:,} birimin "
            f"{metrics.units_scrapped:,} tanesi hurdaya ayrildi "
            f"(%{(1 - quality) * 100:.1f}). Bu, "
            f"{metrics.units_scrapped * metrics.ideal_cycle_time:,.0f} dk'lik "
            f"kapasitenin bosa harcanmasi demektir."
        )

    below = []
    if availability < WORLD_CLASS_AVAILABILITY:
        below.append(f"A<%{WORLD_CLASS_AVAILABILITY * 100:.0f}")
    if performance < WORLD_CLASS_PERFORMANCE:
        below.append(f"P<%{WORLD_CLASS_PERFORMANCE * 100:.0f}")
    if quality < WORLD_CLASS_QUALITY:
        below.append(f"Q<%{WORLD_CLASS_QUALITY * 100:.1f}")
    if below:
        parts.append(f"Dunya standardi hedeflerinin altinda: {', '.join(below)}.")

    return " ".join(parts)
