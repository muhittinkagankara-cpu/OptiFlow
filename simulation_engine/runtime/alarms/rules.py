"""Alarm kuralları.

Her kural saf bir işlevdir: girdi (makine görüntüsü ya da bağlantı durumu) ve
eşikler verilir, çıktı ya bir `AlarmCandidate` ya da `None` olur. Ağ, saat ve
veritabanı yoktur; saat bile dışarıdan gelir.

Neden eşikler tek yerde
-----------------------
"Kuyruk kaç olursa alarm?" sorusunun yanıtı bir üründür, bir görüntü ayarı
değil. Ekranda yazılsaydı, aynı eşik operatör ekranında 10, yönetici ekranında
15 olur ve iki ekran aynı hat için farklı şey söylerdi.

Ölçülmemiş veri alarm üretmez
-----------------------------
Kuyruk ölçülmediyse "kuyruk yüksek" alarmı **üretilmez**. Ölçülmemiş bir
değeri sıfır sayıp "sorun yok" demek de, eşik üstü sayıp alarm üretmek de
uydurma olurdu; ölçüm yoksa söylenecek tek doğru şey "veri gelmiyor"dur ve
onun kendi kuralı vardır.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from simulation_engine.runtime.alarms.types import (
    AlarmCandidate,
    AlarmRuleId,
    AlarmSeverity,
)
from simulation_engine.runtime.persistence.snapshots import (
    BLOCKED,
    DOWN,
    MachineSnapshotRecord,
)

#: Kuyruk bu değeri **aşarsa** alarm üretilir.
#:
#: On parça, tek vardiyalık bir hatta yaklaşık yarım saatlik birikim demektir;
#: daha düşük bir eşik her dalgalanmada alarm üretir ve liste okunmaz olur.
DEFAULT_QUEUE_THRESHOLD = 10.0

#: Bir makineden bu süredir ölçüm gelmiyorsa "veri gelmiyor" alarmı açılır.
DEFAULT_NO_DATA_TIMEOUT_MS = 5 * 60_000


@dataclass(frozen=True)
class AlarmThresholds:
    """Kuralların kullandığı sınırlar."""

    queue_threshold: float = DEFAULT_QUEUE_THRESHOLD
    no_data_timeout_ms: int = DEFAULT_NO_DATA_TIMEOUT_MS

    def with_queue(self, threshold: float) -> "AlarmThresholds":
        return AlarmThresholds(
            queue_threshold=threshold, no_data_timeout_ms=self.no_data_timeout_ms
        )


def queue_high(
    snapshot: MachineSnapshotRecord, thresholds: Optional[AlarmThresholds] = None
) -> Optional[AlarmCandidate]:
    """Kuyruk eşiği aşıldı mı?

    Ölçüm yoksa alarm üretilmez (bkz. modül başlığı).
    """
    limits = thresholds if thresholds is not None else AlarmThresholds()
    queue = snapshot.queue_length
    if queue is None or queue <= limits.queue_threshold:
        return None

    return AlarmCandidate(
        rule=AlarmRuleId.QUEUE_HIGH,
        subject=snapshot.machine_id,
        severity=AlarmSeverity.WARNING,
        message=(
            f"{snapshot.machine_id} kuyruğu {queue:g} parça "
            f"(eşik {limits.queue_threshold:g})."
        ),
        context={"queue": queue, "threshold": limits.queue_threshold},
    )


def machine_down(snapshot: MachineSnapshotRecord) -> Optional[AlarmCandidate]:
    """Makine duruş bildirdi mi?"""
    if snapshot.status != DOWN:
        return None

    return AlarmCandidate(
        rule=AlarmRuleId.MACHINE_DOWN,
        subject=snapshot.machine_id,
        severity=AlarmSeverity.CRITICAL,
        message=f"{snapshot.machine_id} duruşta.",
        context={"status": snapshot.status},
    )


def machine_blocked(snapshot: MachineSnapshotRecord) -> Optional[AlarmCandidate]:
    """Makine bloke mi?

    Bloke bir makine sağlamdır ama üretemez; bu yüzden uyarı seviyesindedir,
    kritik değil. İkisini aynı seviyeye koymak, gerçek arızayı gürültüye
    gömerdi.
    """
    if snapshot.status != BLOCKED:
        return None

    return AlarmCandidate(
        rule=AlarmRuleId.MACHINE_BLOCKED,
        subject=snapshot.machine_id,
        severity=AlarmSeverity.WARNING,
        message=f"{snapshot.machine_id} bloke; önü dolu ya da ayarda.",
        context={"status": snapshot.status},
    )


def no_data(
    snapshot: MachineSnapshotRecord,
    now_ms: int,
    thresholds: Optional[AlarmThresholds] = None,
) -> Optional[AlarmCandidate]:
    """Makineden ölçüm gelmiyor mu?

    Hiç ölçüm alınmamış bir makine için alarm üretilmez: "veri kesildi" ile
    "hiç bağlanılmadı" farklı şeylerdir ve ikincisi bağlantı ekranının işidir.
    """
    limits = thresholds if thresholds is not None else AlarmThresholds()
    # `updated_at_ms` sifir ise makineden hic olcum gelmemistir; "veri
    # kesildi" diyebilmek icin once akmis olmasi gerekir.
    if not snapshot.updated_at_ms or snapshot.updated_at_ms <= 0:
        return None

    age_ms = now_ms - snapshot.updated_at_ms
    if age_ms <= limits.no_data_timeout_ms:
        return None

    return AlarmCandidate(
        rule=AlarmRuleId.NO_DATA,
        subject=snapshot.machine_id,
        severity=AlarmSeverity.WARNING,
        message=(
            f"{snapshot.machine_id} makinesinden {age_ms // 60_000} dakikadır ölçüm "
            "gelmiyor; ekrandaki değer eski."
        ),
        context={"age_ms": age_ms, "timeout_ms": limits.no_data_timeout_ms},
    )


def runtime_disconnected(
    connection_id: str, label: str, status: str, ever_verified: bool
) -> Optional[AlarmCandidate]:
    """Bağlantı koptu mu?

    Yalnızca **daha önce doğrulanmış** bir bağlantı için alarm üretilir. Hiç
    kurulamamış bir bağlantı için "koptu" demek yanlış olurdu: kopan bir şey
    yok, hiç kurulmadı — ve o durum bağlantı ekranında zaten görünüyor.
    """
    if not ever_verified or status not in ("failed", "disconnected"):
        return None

    return AlarmCandidate(
        rule=AlarmRuleId.RUNTIME_DISCONNECTED,
        subject=connection_id,
        severity=AlarmSeverity.CRITICAL,
        message=f"{label} bağlantısı koptu; cihazdan veri gelmiyor.",
        context={"status": status},
    )


def evaluate_snapshot(
    snapshot: MachineSnapshotRecord,
    now_ms: int,
    thresholds: Optional[AlarmThresholds] = None,
) -> List[AlarmCandidate]:
    """Bir makinenin ürettiği bütün alarm adayları.

    Duruş ve bloke aynı anda üretilemez (makine tek bir durumdadır) ama kuyruk
    ve veri eskimesi duruşla birlikte görülebilir: duran bir makinenin önünde
    kuyruk birikmesi ayrı bir bilgidir.
    """
    limits = thresholds or AlarmThresholds()
    candidates = [
        machine_down(snapshot),
        machine_blocked(snapshot),
        queue_high(snapshot, limits),
        no_data(snapshot, now_ms, limits),
    ]
    return [item for item in candidates if item is not None]
