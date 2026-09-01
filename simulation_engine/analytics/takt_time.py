"""Takt time ve hat dengeleme (RPW) — Şartname Bölüm 3.5.

Takt time
---------
Takt, Almanca'da "vuruş / ritim" demektir. Bir üretim hattının müşteri talebine
ayak uydurabilmesi için bir birimi hangi ritimde tamamlaması gerektiğini söyler:

    Takt Time = Kullanılabilir Üretim Süresi / Müşteri Talebi

Takt bir **hedeftir**, bir ölçüm değildir: hattın ne kadar hızlı çalıştığını
değil, ne kadar hızlı çalışması *gerektiğini* verir. Bir istasyonun çevrim
süresi takt'ı aşıyorsa o istasyon talebi karşılayamaz ve hattın tamamı geride
kalır.

Hat dengeleme — Ranked Positional Weight (RPW)
----------------------------------------------
Montaj hattı dengeleme problemi (Assembly Line Balancing Problem, ALBP-1),
verilen bir takt time altında görevleri en az sayıda istasyona dağıtmayı
hedefler ve NP-zor bir problemdir. RPW, Helgeson ve Birnie'nin (1961)
önerdiği ve pratikte en yaygın kullanılan sezgisel yöntemdir:

1. Her görev için **pozisyonel ağırlık** hesaplanır: görevin kendi süresi ile
   kendisinden sonra gelen **tüm** görevlerin sürelerinin toplamı.
2. Görevler pozisyonel ağırlığa göre azalan sırada sıralanır.
3. Sıra takip edilerek görevler istasyonlara atanır; bir görev ancak tüm
   öncülleri atanmışsa ve istasyonda kalan süre yetiyorsa yerleştirilir.
   Hiçbir görev sığmıyorsa yeni istasyon açılır.

Yöntemin sezgisi şudur: ardında uzun bir iş zinciri bulunan görevler mümkün
olduğunca erken yerleştirilmelidir, çünkü geciktirilmeleri kendilerinden
sonraki her şeyi geciktirir.

**Ardıl kümesi geçişlidir (transitive) ve kümedir.** A görevinin ardılları
B ve C, ikisinin de ardılı D ise, D'nin süresi A'nın pozisyonel ağırlığına
yalnızca **bir kez** eklenir. Bu ayrıntının kaçırılması, çok yollu grafiklerde
ağırlıkları şişirir ve sıralamayı bozar.

RPW sezgiseldir, en iyi çözümü garanti etmez
--------------------------------------------
Sonuç her zaman teorik alt sınıra (TAVAN(toplam süre / takt)) ulaşmayabilir.
Bu modül alt sınırı ayrıca raporlar; aradaki fark, sezgiselin bu örnekte ne
kadar iyi çalıştığının ölçüsüdür.

Kaynaklar
---------
- Helgeson, W. B. & Birnie, D. P. (1961). "Assembly Line Balancing Using the
  Ranked Positional Weight Technique." *Journal of Industrial Engineering*,
  12(6), 394-398.
- Scholl, A. (1999). *Balancing and Sequencing of Assembly Lines*, 2nd ed.
- Rother, M. & Shook, J. (1999). *Learning to See* (takt time ve değer akışı).
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Set

from simulation_engine.models.schemas import (
    BalancedStation,
    LineBalancingResult,
    ReplicationResult,
    TaktTimeAnalysis,
    Task,
)

# --------------------------------------------------------------------------- #
# Adlandırılmış sabitler
# --------------------------------------------------------------------------- #

#: Bir görevin takt time'a sığıp sığmadığı kontrolünde kullanılan tolerans.
#: Kayan nokta toplamları nedeniyle tam eşit süreler "sığmıyor" görünebilir.
CAPACITY_TOLERANCE: float = 1e-9

#: Bir istasyonun çevrim süresinin takt'ı aştığı sayılması için gereken pay.
TAKT_EXCEEDANCE_TOLERANCE: float = 1e-6


def compute_takt_time(
    available_time_minutes: float, customer_demand_units: float
) -> float:
    """Takt time'ı hesaplar.

    Args:
        available_time_minutes: Vardiyada üretime ayrılabilen net süre
            (molalar ve planlı duruşlar düşülmüş olmalıdır).
        customer_demand_units: Aynı sürede karşılanması gereken talep.

    Returns:
        Birim başına düşen hedef süre (dakika).

    Raises:
        ValueError: Süre veya talep pozitif değilse.
    """
    if available_time_minutes <= 0.0:
        raise ValueError(
            f"Kullanilabilir uretim suresi pozitif olmalidir, alinan: "
            f"{available_time_minutes}"
        )
    if customer_demand_units <= 0.0:
        raise ValueError(
            f"Musteri talebi pozitif olmalidir, alinan: {customer_demand_units}"
        )
    return available_time_minutes / customer_demand_units


def _validate_tasks(tasks: Sequence[Task]) -> Dict[str, Task]:
    """Görev listesini doğrular ve kimliğe göre indeksler.

    Raises:
        ValueError: Görev listesi boşsa, kimlikler yinelenmişse, bilinmeyen bir
            öncül varsa veya öncelik grafiğinde döngü bulunuyorsa.
    """
    if not tasks:
        raise ValueError("Hat dengeleme icin en az bir gorev gereklidir.")

    by_id: Dict[str, Task] = {}
    for task in tasks:
        if task.id in by_id:
            raise ValueError(f"Yinelenen gorev kimligi: '{task.id}'")
        by_id[task.id] = task

    for task in tasks:
        for predecessor in task.predecessors:
            if predecessor not in by_id:
                raise ValueError(
                    f"'{task.id}' gorevinin onculu bilinmiyor: '{predecessor}'"
                )
            if predecessor == task.id:
                raise ValueError(f"'{task.id}' gorevi kendi onculu olamaz.")

    _detect_cycles(by_id)
    return by_id


def _detect_cycles(by_id: Dict[str, Task]) -> None:
    """Öncelik grafiğinin çevrimsiz (DAG) olduğunu doğrular.

    Kahn'ın topolojik sıralama algoritmasıyla: tüm görevler sıralanamıyorsa
    grafikte döngü vardır. Döngülü bir öncelik grafiği fiziksel olarak
    imkânsızdır (A, B'den önce gelmeli ve B, A'dan önce gelmeli).

    Raises:
        ValueError: Döngü bulunursa.
    """
    remaining_predecessors = {
        task_id: set(task.predecessors) for task_id, task in by_id.items()
    }
    ready = sorted(
        task_id for task_id, preds in remaining_predecessors.items() if not preds
    )
    resolved: List[str] = []

    while ready:
        current = ready.pop(0)
        resolved.append(current)
        newly_ready = []
        for task_id, preds in remaining_predecessors.items():
            if current in preds:
                preds.discard(current)
                if not preds and task_id not in resolved:
                    newly_ready.append(task_id)
        ready = sorted(set(ready) | set(newly_ready))

    if len(resolved) != len(by_id):
        stuck = sorted(set(by_id) - set(resolved))
        raise ValueError(
            f"Oncelik grafiginde dongu var; su gorevler siralanamadi: {stuck}. "
            f"Dongulu bir oncelik iliskisi fiziksel olarak imkansizdir."
        )


def _build_successors(by_id: Dict[str, Task]) -> Dict[str, Set[str]]:
    """Her görev için doğrudan ardıllarının kümesini çıkarır."""
    successors: Dict[str, Set[str]] = {task_id: set() for task_id in by_id}
    for task in by_id.values():
        for predecessor in task.predecessors:
            successors[predecessor].add(task.id)
    return successors


def compute_positional_weights(tasks: Sequence[Task]) -> Dict[str, float]:
    """Her görevin pozisyonel ağırlığını hesaplar.

    Pozisyonel ağırlık = görevin kendi süresi + geçişli ardıllarının süreleri
    toplamı. Ardıllar **küme** olarak toplanır; çok yollu grafiklerde aynı görev
    birden fazla yoldan erişilebilir olsa da bir kez sayılır.

    Args:
        tasks: Görev listesi.

    Returns:
        Görev kimliğinden pozisyonel ağırlığa eşleme.
    """
    by_id = _validate_tasks(tasks)
    successors = _build_successors(by_id)
    memo: Dict[str, Set[str]] = {}

    def transitive_successors(task_id: str) -> Set[str]:
        """Bir görevin geçişli ardıl kümesini bellekleyerek hesaplar."""
        if task_id in memo:
            return memo[task_id]
        collected: Set[str] = set()
        for direct in successors[task_id]:
            collected.add(direct)
            collected |= transitive_successors(direct)
        memo[task_id] = collected
        return collected

    return {
        task_id: task.duration_minutes
        + math.fsum(by_id[s].duration_minutes for s in transitive_successors(task_id))
        for task_id, task in by_id.items()
    }


def balance_line(
    tasks: Sequence[Task], takt_time_minutes: float
) -> LineBalancingResult:
    """Ranked Positional Weight algoritmasıyla görevleri istasyonlara atar.

    Args:
        tasks: Öncelik ilişkileriyle birlikte görev listesi.
        takt_time_minutes: Hiçbir istasyonun aşmaması gereken hedef süre.

    Returns:
        Önerilen istasyon sayısı, her istasyona atanan görevler ve denge
        ölçütleri.

    Raises:
        ValueError: Takt time pozitif değilse veya görev listesi geçersizse.
    """
    if takt_time_minutes <= 0.0:
        raise ValueError(f"Takt time pozitif olmalidir, alinan: {takt_time_minutes}")

    by_id = _validate_tasks(tasks)
    weights = compute_positional_weights(tasks)
    total_task_time = math.fsum(task.duration_minutes for task in tasks)

    warnings: List[str] = []
    oversized = sorted(
        task.id
        for task in tasks
        if task.duration_minutes > takt_time_minutes + CAPACITY_TOLERANCE
    )
    if oversized:
        warnings.append(
            f"COZUM YOK: su gorevlerin suresi takt time'i ({takt_time_minutes:.4f} dk) "
            f"asiyor: {oversized}. Bolunemez bir gorev takt'tan uzunsa hicbir "
            f"istasyona sigmaz. Cozum icin gorev alt gorevlere bolunmeli, "
            f"paralel istasyon kurulmali veya takt time buyutulmelidir "
            f"(kullanilabilir sure artirilarak ya da talep dusurulerek)."
        )

    # Sıralama anahtarı: pozisyonel ağırlık azalan, eşitlikte kimlik artan.
    # İkinci anahtar sonucun deterministik olmasını sağlar.
    ordered_ids = sorted(by_id, key=lambda task_id: (-weights[task_id], task_id))

    assigned: Set[str] = set()
    stations: List[BalancedStation] = []
    remaining = list(ordered_ids)

    while remaining:
        station_tasks: List[str] = []
        station_time = 0.0
        progress = True

        while progress:
            progress = False
            for task_id in remaining:
                task = by_id[task_id]
                predecessors_ready = all(p in assigned for p in task.predecessors)
                fits = (
                    station_time + task.duration_minutes
                    <= takt_time_minutes + CAPACITY_TOLERANCE
                )
                if predecessors_ready and fits:
                    station_tasks.append(task_id)
                    assigned.add(task_id)
                    station_time += task.duration_minutes
                    remaining.remove(task_id)
                    progress = True
                    break

        if not station_tasks:
            # Hiçbir görev yeni ve boş bir istasyona bile sığmıyor: bu yalnızca
            # görev süresi takt'ı aştığında olur ve yukarıda uyarısı verildi.
            warnings.append(
                f"Atanamayan gorevler kaldi: {sorted(remaining)}. Bunlar tek "
                f"baslarina takt time'a sigmiyor."
            )
            break

        stations.append(
            BalancedStation(
                index=len(stations) + 1,
                task_ids=station_tasks,
                task_names=[by_id[task_id].name for task_id in station_tasks],
                total_time_minutes=station_time,
                idle_time_minutes=takt_time_minutes - station_time,
                utilization=station_time / takt_time_minutes,
            )
        )

    return _build_result(
        takt_time_minutes=takt_time_minutes,
        total_task_time=total_task_time,
        stations=stations,
        weights=weights,
        is_feasible=not oversized and not remaining,
        warnings=warnings,
    )


def _build_result(
    takt_time_minutes: float,
    total_task_time: float,
    stations: List[BalancedStation],
    weights: Dict[str, float],
    is_feasible: bool,
    warnings: List[str],
) -> LineBalancingResult:
    """Denge ölçütlerini hesaplayıp sonucu paketler."""
    minimum_stations = math.ceil(
        total_task_time / takt_time_minutes - CAPACITY_TOLERANCE
    )
    station_count = len(stations)

    if station_count == 0:
        return LineBalancingResult(
            takt_time_minutes=takt_time_minutes,
            total_task_time_minutes=total_task_time,
            theoretical_minimum_stations=minimum_stations,
            assigned_stations=0,
            stations=[],
            line_efficiency=0.0,
            balance_delay=1.0,
            smoothness_index=0.0,
            bottleneck_station_index=0,
            positional_weights=weights,
            is_feasible=False,
            warnings=warnings,
        )

    max_station_time = max(station.total_time_minutes for station in stations)
    efficiency = total_task_time / (station_count * takt_time_minutes)
    smoothness = math.sqrt(
        math.fsum(
            (max_station_time - station.total_time_minutes) ** 2
            for station in stations
        )
    )
    bottleneck_index = max(
        stations, key=lambda station: (station.total_time_minutes, -station.index)
    ).index

    if station_count > minimum_stations:
        warnings.append(
            f"RPW {station_count} istasyon kullandi; teorik alt sinir "
            f"{minimum_stations}. RPW sezgisel bir yontemdir ve en iyi cozumu "
            f"garanti etmez. Alt sinira ulasmak icin gorev sureleri veya oncelik "
            f"kisitlari gozden gecirilmelidir."
        )

    return LineBalancingResult(
        takt_time_minutes=takt_time_minutes,
        total_task_time_minutes=total_task_time,
        theoretical_minimum_stations=minimum_stations,
        assigned_stations=station_count,
        stations=stations,
        line_efficiency=efficiency,
        balance_delay=1.0 - efficiency,
        smoothness_index=smoothness,
        bottleneck_station_index=bottleneck_index,
        positional_weights=weights,
        is_feasible=is_feasible,
        warnings=warnings,
    )


def analyze_takt(
    available_time_minutes: float,
    customer_demand_units: float,
    result: Optional[ReplicationResult] = None,
) -> TaktTimeAnalysis:
    """Takt time'ı hesaplar ve verilirse simülasyon sonucuyla karşılaştırır.

    Args:
        available_time_minutes: Kullanılabilir üretim süresi.
        customer_demand_units: Aynı sürede karşılanacak talep.
        result: Karşılaştırma yapılacak simülasyon sonucu (isteğe bağlı).

    Returns:
        Takt time ve hattın talebi karşılayıp karşılamadığına dair değerlendirme.
    """
    takt = compute_takt_time(available_time_minutes, customer_demand_units)
    required_throughput = 1.0 / takt

    if result is None:
        return TaktTimeAnalysis(
            available_time_minutes=available_time_minutes,
            customer_demand_units=customer_demand_units,
            takt_time_minutes=takt,
            required_throughput_per_minute=required_throughput,
            message=(
                f"Talebi karsilamak icin her {takt:.4f} dakikada bir birim "
                f"tamamlanmalidir ({required_throughput:.4f} birim/dk)."
            ),
        )

    observed_throughput = result.system.throughput_per_minute
    observed_cycle = 1.0 / observed_throughput if observed_throughput > 0.0 else math.inf
    meets_demand = observed_throughput >= required_throughput
    gap = required_throughput - observed_throughput

    exceeding = sorted(
        metrics.station_id
        for metrics in result.stations
        if metrics.num_servers > 0
        and metrics.ideal_cycle_time / metrics.num_servers
        > takt + TAKT_EXCEEDANCE_TOLERANCE
    )

    if meets_demand:
        message = (
            f"Hat talebi karsiliyor: gerekli {required_throughput:.4f} birim/dk, "
            f"olculen {observed_throughput:.4f} birim/dk. Gerceklesen cevrim "
            f"suresi {observed_cycle:.4f} dk, takt {takt:.4f} dk."
        )
    else:
        shortfall_units = gap * available_time_minutes
        message = (
            f"TALEP KARSILANMIYOR: gerekli {required_throughput:.4f} birim/dk, "
            f"olculen {observed_throughput:.4f} birim/dk. Kullanilabilir surede "
            f"yaklasik {shortfall_units:.0f} birimlik acik olusur. Gerceklesen "
            f"cevrim suresi {observed_cycle:.4f} dk, takt {takt:.4f} dk."
        )
        if exceeding:
            message += (
                f" Cevrim suresi takt'i asan istasyonlar: {exceeding}. Bu "
                f"istasyonlar tek baslarina hattin talebi karsilamasini engeller."
            )
        else:
            message += (
                " Hicbir istasyonun cevrim suresi takt'i asmiyor; acik degiskenlik, "
                "arizalar veya blokajdan kaynaklaniyor olabilir."
            )

    return TaktTimeAnalysis(
        available_time_minutes=available_time_minutes,
        customer_demand_units=customer_demand_units,
        takt_time_minutes=takt,
        required_throughput_per_minute=required_throughput,
        observed_throughput_per_minute=observed_throughput,
        observed_cycle_time_minutes=observed_cycle,
        meets_demand=meets_demand,
        throughput_gap_per_minute=gap,
        stations_exceeding_takt=exceeding,
        message=message,
    )


def format_report(balancing: LineBalancingResult) -> str:
    """Hat dengeleme sonucunu okunabilir bir tabloya dönüştürür."""
    lines: List[str] = [
        "HAT DENGELEME — RANKED POSITIONAL WEIGHT",
        f"Takt time {balancing.takt_time_minutes:.4f} dk | "
        f"toplam gorev suresi {balancing.total_task_time_minutes:.4f} dk",
        f"Teorik alt sinir {balancing.theoretical_minimum_stations} istasyon | "
        f"RPW sonucu {balancing.assigned_stations} istasyon",
        "-" * 78,
        f"{'#':>2}  {'Gorevler':<34}{'Sure':>9}{'Bosta':>9}{'Kullanim':>10}",
        "-" * 78,
    ]
    for station in balancing.stations:
        marker = " <==" if station.index == balancing.bottleneck_station_index else ""
        tasks_label = ", ".join(station.task_ids)
        if len(tasks_label) > 33:
            tasks_label = tasks_label[:30] + "..."
        lines.append(
            f"{station.index:>2}  {tasks_label:<34}"
            f"{station.total_time_minutes:>9.3f}{station.idle_time_minutes:>9.3f}"
            f"{f'%{station.utilization * 100:.1f}':>10}{marker}"
        )
    lines.append("-" * 78)
    lines.append(
        f"Hat verimliligi %{balancing.line_efficiency * 100:.2f} | "
        f"denge kaybi %{balancing.balance_delay * 100:.2f} | "
        f"duzgunluk indeksi {balancing.smoothness_index:.4f}"
    )
    for warning in balancing.warnings:
        lines.append(f"  ! {warning}")
    return "\n".join(lines)
