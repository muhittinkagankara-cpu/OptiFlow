"""Yedekleme ve geri yükleme.

Neden dosya kopyası değil
-------------------------
SQLite dosyasını kopyalamak yazma sırasında bozuk bir yedek üretir; PostgreSQL
için zaten mümkün değildir. Bu yüzden yedek **mantıksal**tır: tablolar
SQLAlchemy üzerinden okunur ve JSON olarak yazılır. Aynı yedek her iki motorda
da geri yüklenebilir — SQLite'ta alınan bir yedeği PostgreSQL'e taşımak,
ilk fabrikadan üretime geçerken en olası senaryodur.

Geri yükleme neden önce siler
-----------------------------
Geri yükleme, hedef kiracının satırlarını siler ve yedektekileri yazar. Üstüne
eklenseydi, silinmiş bir kayıt geri gelmez ve iki kaydın karışımı ortaya
çıkardı — "geri yükleme" o zaman yedeğin durumunu değil, iki durumun
birleşimini verirdi.

Doğrulama
---------
Her yedek bir **sağlama** taşır. Geri yüklemeden önce sağlama hesaplanır ve
karşılaştırılır; tutmazsa geri yükleme yapılmaz. Bozuk bir yedeği yüklemek,
veriyi kaybetmenin en sessiz yoludur.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

#: Yedek biçiminin sürümü.
#:
#: Sürüm olmadan, biçim değiştiğinde eski bir yedeği yüklemeye çalışan bir
#: sunucu ne olduğunu anlamadan çökerdi.
BACKUP_FORMAT_VERSION = 1

#: Yedeğe giren tablolar ve okundukları depo işlevleri.
BACKUP_SECTIONS = (
    "connections",
    "snapshots",
    "health",
    "downtime",
    "audit",
)


def normalize(value: Any) -> Any:
    """Sağlama hesabı için sayıları ortak biçime çeker.

    Neden gerekli
    -------------
    Python `500.0` yazar, JavaScript aynı sayıyı `500` olarak yazar. Yedek
    tarayıcıdan geçtiğinde (indirilip yeniden gönderildiğinde ya da arayüz
    onu ayrıştırıp yeniden serileştirdiğinde) içerik hiç değişmediği hâlde
    metin değişir ve sağlama tutmaz.

    Tarayıcıda görülen gerçek bir hataydı: arayüzden alınan bir yedek, aynı
    arayüzden geri yüklenemiyor ve "sağlama tutmuyor" hatası veriyordu.

    Tam sayı değerli kayan noktalı sayılar tam sayıya çevrilir; böylece iki
    taraf aynı metni üretir. Kesirli sayılar olduğu gibi kalır.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize(item) for item in value]
    return value


def checksum(payload: Dict[str, Any]) -> str:
    """Yedeğin içeriğinden türeyen sağlama.

    Anahtarlar sıralanır ve sayılar ortak biçime çekilir: aynı içerik her
    zaman aynı sağlamayı vermelidir, yoksa karşılaştırma anlamsız olur.
    """
    body = json.dumps(
        normalize(payload.get("data", {})), sort_keys=True, ensure_ascii=False
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


@dataclass
class BackupResult:
    """Yedekleme sonucu."""

    org_id: str
    at_ms: int
    checksum: str
    counts: Dict[str, int] = field(default_factory=dict)
    format_version: int = BACKUP_FORMAT_VERSION

    @property
    def total_rows(self) -> int:
        return sum(self.counts.values())

    def to_dict(self) -> Dict[str, object]:
        return {
            "org_id": self.org_id,
            "at_ms": self.at_ms,
            "checksum": self.checksum,
            "counts": dict(self.counts),
            "total_rows": self.total_rows,
            "format_version": self.format_version,
        }


@dataclass
class RestoreResult:
    """Geri yükleme sonucu."""

    org_id: str
    restored: Dict[str, int] = field(default_factory=dict)
    removed: Dict[str, int] = field(default_factory=dict)
    ok: bool = True
    error: Optional[str] = None

    @property
    def total_restored(self) -> int:
        return sum(self.restored.values())

    def to_dict(self) -> Dict[str, object]:
        return {
            "org_id": self.org_id,
            "ok": self.ok,
            "error": self.error,
            "restored": dict(self.restored),
            "removed": dict(self.removed),
            "total_restored": self.total_restored,
        }


class BackupError(RuntimeError):
    """Yedek okunamadı ya da doğrulanamadı."""


def create_backup(
    repository: Any,
    org_id: str,
    clock: Callable[[], int] = lambda: int(time.time() * 1000),
) -> Dict[str, Any]:
    """Bir kiracının runtime durumunu JSON'a çıkarır."""
    from simulation_engine.runtime.persistence.repository import StoredEvent  # noqa: F401

    connections = [item.to_dict() for item in repository.list_connections(org_id)]
    snapshots = [
        item.to_dict() for item in repository.list_snapshots(org_id).values()
    ]
    health = [item.to_dict() for item in repository.list_health(org_id)]
    downtime = [item.to_dict() for item in repository.list_downtime(org_id)]
    audit = [item.to_dict() for item in repository.list_audit(org_id, limit=10_000)]

    payload: Dict[str, Any] = {
        "format_version": BACKUP_FORMAT_VERSION,
        "org_id": org_id,
        "at_ms": clock(),
        "data": {
            "connections": connections,
            "snapshots": snapshots,
            "health": health,
            "downtime": downtime,
            "audit": audit,
        },
    }
    payload["checksum"] = checksum(payload)
    return payload


def summarize_backup(payload: Dict[str, Any]) -> BackupResult:
    """Yedeğin özeti; ekran bunu gösterir."""
    data = payload.get("data", {})
    return BackupResult(
        org_id=str(payload.get("org_id", "")),
        at_ms=int(payload.get("at_ms", 0)),
        checksum=str(payload.get("checksum", "")),
        counts={key: len(data.get(key, [])) for key in BACKUP_SECTIONS},
        format_version=int(payload.get("format_version", 0)),
    )


def verify_backup(payload: Dict[str, Any]) -> List[str]:
    """Yedeği doğrular; sorunları döndürür (boş liste = sağlam)."""
    problems: List[str] = []

    version = payload.get("format_version")
    if version != BACKUP_FORMAT_VERSION:
        problems.append(
            f"Yedek biçimi tanınmıyor (beklenen {BACKUP_FORMAT_VERSION}, gelen {version})."
        )

    if not payload.get("org_id"):
        problems.append("Yedekte organizasyon kimliği yok.")

    if "data" not in payload:
        problems.append("Yedekte veri bölümü yok.")
        return problems

    recorded = payload.get("checksum")
    if not recorded:
        problems.append("Yedekte sağlama yok; içeriğin bozulmadığı doğrulanamaz.")
    elif recorded != checksum(payload):
        problems.append("Sağlama tutmuyor; yedek bozulmuş olabilir.")

    for section in BACKUP_SECTIONS:
        if section not in payload["data"]:
            problems.append(f"Yedekte '{section}' bölümü eksik.")

    return problems


def restore_backup(
    repository: Any,
    payload: Dict[str, Any],
    org_id: Optional[str] = None,
) -> RestoreResult:
    """Yedeği geri yükler.

    Hedef kiracı `org_id` ile değiştirilebilir: bir yedeği test kiracısına
    yüklemek, üretim verisine dokunmadan denemenin tek yoludur.
    """
    from simulation_engine.runtime.persistence.downtime import DowntimeEvent
    from simulation_engine.runtime.persistence.repository import (
        StoredConnection,
        StoredHealth,
    )
    from simulation_engine.runtime.persistence.snapshots import MachineSnapshotRecord

    problems = verify_backup(payload)
    if problems:
        return RestoreResult(
            org_id=org_id or str(payload.get("org_id", "")),
            ok=False,
            error=" ".join(problems),
        )

    target = org_id or str(payload["org_id"])
    data = payload["data"]

    removed = {
        "connections": _clear_connections(repository, target),
        "snapshots": repository.clear_snapshots(target),
        "downtime": repository.clear_downtime(target),
    }

    restored: Dict[str, int] = {}

    for row in data.get("connections", []):
        repository.save_connection(target, _connection_from_dict(row, StoredConnection))
    restored["connections"] = len(data.get("connections", []))

    for row in data.get("snapshots", []):
        repository.save_snapshot(target, _snapshot_from_dict(row, MachineSnapshotRecord))
    restored["snapshots"] = len(data.get("snapshots", []))

    for row in data.get("health", []):
        repository.save_health(target, _health_from_dict(row, StoredHealth))
    restored["health"] = len(data.get("health", []))

    for row in data.get("downtime", []):
        repository.save_downtime(target, _downtime_from_dict(row, DowntimeEvent))
    restored["downtime"] = len(data.get("downtime", []))

    # Denetim kayıtları geri yüklenmez ve **silinmez**: değiştirilemez bir
    # günlüğün yedekten yeniden yazılması, geçmişin değiştirilebilmesi
    # demek olurdu. Yedekte taşınırlar ki inceleme için okunabilsinler.
    restored["audit"] = 0

    return RestoreResult(org_id=target, restored=restored, removed=removed)


def _clear_connections(repository: Any, org_id: str) -> int:
    existing = repository.list_connections(org_id)
    for item in existing:
        repository.delete_connection(org_id, item.connection_id)
    return len(existing)


def _connection_from_dict(row: Dict[str, Any], cls):
    return cls(
        connection_id=row.get("connection_id", ""),
        kind=row.get("kind", "rest"),
        label=row.get("label", ""),
        endpoint=row.get("endpoint", ""),
        port=row.get("port"),
        username=row.get("username"),
        has_password=bool(row.get("has_password", False)),
        topics=list(row.get("topics", [])),
        security_policy=row.get("security_policy", "None"),
        qos=int(row.get("qos", 1)),
        timeout_ms=int(row.get("timeout_ms", 5_000)),
        max_retries=int(row.get("max_retries", 0)),
        status=row.get("status", "idle"),
        ever_verified=bool(row.get("ever_verified", False)),
        stream_enabled=bool(row.get("stream_enabled", False)),
        interval_ms=row.get("interval_ms"),
        mapping=list(row.get("mapping", [])),
        created_at_ms=int(row.get("created_at_ms", 0)),
        updated_at_ms=int(row.get("updated_at_ms", 0)),
    )


def _snapshot_from_dict(row: Dict[str, Any], cls):
    return cls(
        machine_id=row.get("machine_id", ""),
        status=row.get("status", "unknown"),
        production_count=row.get("production_count"),
        scrap_count=row.get("scrap_count"),
        queue_length=row.get("queue_length"),
        downtime_minutes=row.get("downtime_minutes"),
        throughput_per_hour=row.get("throughput_per_hour"),
        cycle_time_seconds=row.get("cycle_time_seconds"),
        oee=row.get("oee"),
        sources=dict(row.get("sources", {})),
        updated={},
        sample_count=int(row.get("sample_count", 0)),
        updated_at_ms=int(row.get("updated_at_ms", 0)),
    )


def _health_from_dict(row: Dict[str, Any], cls):
    return cls(
        connection_id=row.get("connection_id", ""),
        avg_latency_ms=row.get("avg_latency_ms"),
        max_latency_ms=row.get("max_latency_ms"),
        packets=int(row.get("packets", 0)),
        errors=int(row.get("errors", 0)),
        reconnects=int(row.get("reconnects", 0)),
        recoveries=int(row.get("recoveries", 0)),
        last_error=row.get("last_error"),
        last_packet_at_ms=row.get("last_packet_at_ms"),
        updated_at_ms=int(row.get("updated_at_ms", 0)),
    )


def _downtime_from_dict(row: Dict[str, Any], cls):
    return cls(
        machine_id=row.get("machine_id", ""),
        start_ms=int(row.get("start_ms", 0)),
        end_ms=row.get("end_ms"),
        reason=row.get("reason", "Bildirilmedi"),
        source=row.get("source"),
    )
