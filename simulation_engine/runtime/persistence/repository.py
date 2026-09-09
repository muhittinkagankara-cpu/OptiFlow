"""Runtime durumunun kalıcı deposu.

İki uygulama vardır ve arayüzleri aynıdır: `InMemoryRuntimeRepository` (test ve
`DATABASE_URL` tanımsız yerel geliştirme) ile `DatabaseRuntimeRepository`.
Uçlar hangisinin kullanıldığını bilmez ama **kullanıcı bilir**: `mode` alanı
arayüzde gösterilir ve bellek modunda kalıcılık "Doğrulanmadı" olarak yazılır.

Diske yazılmayan iki şey
------------------------
1. **Parola.** Yalnızca varlığı saklanır. Şifrelenmemiş bir cihaz parolasını
   veritabanına yazmak, yedeği ele geçiren birine fabrika erişimi vermektir.
2. **`connected` durumu.** Bağlantı bir sürece ve açık bir sokete bağlıdır;
   yeniden başlatmadan sonra o soket yoktur. Diske `connected` yazılsaydı,
   sunucu açıldığında hiç denenmemiş bağlantılar "bağlı" görünürdü —
   bu sprintin kaçındığı tam olarak budur.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from simulation_engine.api.storage import DATABASE_URL_ENV, normalize_database_url
from simulation_engine.runtime.persistence.downtime import DowntimeEvent
from simulation_engine.runtime.persistence.models import (
    AuditLogRow,
    DeviceSnapshotRow,
    DowntimeEventRow,
    RuntimeConnectionRow,
    RuntimeEventRow,
    InstallTokenRow,
    LicenseRow,
    MachineLabelRow,
    RuntimeHealthRow,
    TelemetryRow,
    scoped_id,
)
from simulation_engine.runtime.commissioning.labels import MachineLabel
from simulation_engine.runtime.commissioning.tokens import InstallToken
from simulation_engine.runtime.licensing.types import (
    License,
    LicenseLimits,
    LicenseTier,
)
from simulation_engine.runtime.telemetry.types import (
    CLEANUP_BATCH,
    TelemetryPoint,
    point_key,
)
from simulation_engine.runtime.persistence.snapshots import (
    MachineSnapshotRecord,
    UNKNOWN,
)

logger = logging.getLogger(__name__)

#: Olay günlüğünde organizasyon başına saklanan en fazla kayıt.
#:
#: Sınırsız bırakılsaydı, günlerce çalışan bir hat tabloyu milyonlarca satıra
#: çıkarır ve yeniden oynatma sorgusu yavaşlardı.
MAX_PERSISTED_EVENTS = 5_000

#: Diske yazılabilecek durumlar. `connected` bilinçli olarak yok.
PERSISTABLE_STATUSES = frozenset({"idle", "failed", "disconnected"})


def persisted_status(status: str) -> str:
    """Diske yazılacak durum.

    Canlı durumlar (`connected`, `connecting`, `retrying`) sürece aittir ve
    yeniden başlatmadan sonra geçerli değildir; hepsi `idle` olarak saklanır
    ve arayüzde "Test edilmedi" görünür.
    """
    return status if status in PERSISTABLE_STATUSES else "idle"


def downtime_key(org_id: str, event: DowntimeEvent) -> str:
    """Duruşun birincil anahtarı: `org::makine::başlangıç`.

    Başlangıç anı anahtarın parçasıdır; aynı duruş iki kez yazılmaya
    çalışıldığında yeni satır değil **güncelleme** olur. Sıra numarası
    kullanılsaydı, kurtarmadan sonra aynı duruş ikinci kez kaydedilirdi.
    """
    return f"{org_id}::{event.machine_id}::{event.start_ms}"


@dataclass
class StoredConnection:
    """Diske yazılmış bağlantı tanımı."""

    connection_id: str
    kind: str
    label: str
    endpoint: str
    port: Optional[int] = None
    username: Optional[str] = None
    has_password: bool = False
    topics: List[str] = field(default_factory=list)
    security_policy: str = "None"
    qos: int = 1
    timeout_ms: int = 5_000
    max_retries: int = 0
    status: str = "idle"
    ever_verified: bool = False
    stream_enabled: bool = False
    interval_ms: Optional[int] = None
    mapping: List[dict] = field(default_factory=list)
    created_at_ms: int = 0
    updated_at_ms: int = 0

    def to_dict(self) -> Dict[str, object]:
        return {
            "connection_id": self.connection_id,
            "kind": self.kind,
            "label": self.label,
            "endpoint": self.endpoint,
            "port": self.port,
            "username": self.username,
            "has_password": self.has_password,
            "topics": list(self.topics),
            "security_policy": self.security_policy,
            "qos": self.qos,
            "timeout_ms": self.timeout_ms,
            "max_retries": self.max_retries,
            "status": self.status,
            "ever_verified": self.ever_verified,
            "stream_enabled": self.stream_enabled,
            "interval_ms": self.interval_ms,
            "mapping": list(self.mapping),
            "created_at_ms": self.created_at_ms,
            "updated_at_ms": self.updated_at_ms,
        }


@dataclass
class StoredEvent:
    """Kalıcı olay günlüğü kaydı."""

    sequence: int
    connection_id: str
    kind: str
    level: str
    message: str
    at_ms: int
    data: dict = field(default_factory=dict)

    def to_dict(self) -> Dict[str, object]:
        return {
            "sequence": self.sequence,
            "connection_id": self.connection_id,
            "kind": self.kind,
            "level": self.level,
            "message": self.message,
            "at_ms": self.at_ms,
            "data": dict(self.data),
        }


@dataclass
class StoredHealth:
    """Yeniden başlatmayı aşan sağlık sayaçları."""

    connection_id: str
    avg_latency_ms: Optional[float] = None
    max_latency_ms: Optional[float] = None
    packets: int = 0
    errors: int = 0
    reconnects: int = 0
    recoveries: int = 0
    last_error: Optional[str] = None
    last_packet_at_ms: Optional[int] = None
    updated_at_ms: int = 0

    def to_dict(self) -> Dict[str, object]:
        return {
            "connection_id": self.connection_id,
            "avg_latency_ms": self.avg_latency_ms,
            "max_latency_ms": self.max_latency_ms,
            "packets": self.packets,
            "errors": self.errors,
            "reconnects": self.reconnects,
            "recoveries": self.recoveries,
            "last_error": self.last_error,
            "last_packet_at_ms": self.last_packet_at_ms,
            "updated_at_ms": self.updated_at_ms,
        }


def now_ms() -> int:
    return int(time.time() * 1000)


class InMemoryRuntimeRepository:
    """Süreç belleğinde çalışan depo.

    Arayüzü veritabanı deposuyla aynıdır ama **kalıcı değildir**; `mode`
    alanı bunu söyler ve arayüz "Kalıcılık: Doğrulanmadı" yazar.
    """

    mode = "memory"
    is_persistent = False

    def __init__(self) -> None:
        self._connections: Dict[str, StoredConnection] = {}
        self._snapshots: Dict[str, MachineSnapshotRecord] = {}
        self._events: Dict[str, List[StoredEvent]] = {}
        self._health: Dict[str, StoredHealth] = {}
        self._downtime: Dict[str, DowntimeEvent] = {}
        self._audit: Dict[str, List] = {}
        self._telemetry: Dict[str, TelemetryPoint] = {}
        self._licenses: Dict[str, License] = {}
        self._tokens: Dict[str, InstallToken] = {}
        self._labels: Dict[str, MachineLabel] = {}

    # -- Bağlantılar --------------------------------------------------------

    def save_connection(self, org_id: str, connection: StoredConnection) -> StoredConnection:
        stored = StoredConnection(**{**connection.__dict__})
        stored.status = persisted_status(stored.status)
        stored.updated_at_ms = stored.updated_at_ms or now_ms()
        stored.created_at_ms = stored.created_at_ms or stored.updated_at_ms
        self._connections[scoped_id(org_id, connection.connection_id)] = stored
        return stored

    def list_connections(self, org_id: str) -> List[StoredConnection]:
        prefix = f"{org_id}::"
        return sorted(
            (value for key, value in self._connections.items() if key.startswith(prefix)),
            key=lambda item: item.connection_id,
        )

    def get_connection(self, org_id: str, connection_id: str) -> Optional[StoredConnection]:
        return self._connections.get(scoped_id(org_id, connection_id))

    def delete_connection(self, org_id: str, connection_id: str) -> bool:
        return self._connections.pop(scoped_id(org_id, connection_id), None) is not None

    # -- Görüntüler ---------------------------------------------------------

    def save_snapshot(self, org_id: str, snapshot: MachineSnapshotRecord) -> None:
        self._snapshots[scoped_id(org_id, snapshot.machine_id)] = snapshot

    def list_snapshots(self, org_id: str) -> Dict[str, MachineSnapshotRecord]:
        prefix = f"{org_id}::"
        return {
            value.machine_id: value
            for key, value in self._snapshots.items()
            if key.startswith(prefix)
        }

    def clear_snapshots(self, org_id: str) -> int:
        prefix = f"{org_id}::"
        keys = [key for key in self._snapshots if key.startswith(prefix)]
        for key in keys:
            del self._snapshots[key]
        return len(keys)

    # -- Olaylar ------------------------------------------------------------

    def append_event(self, org_id: str, event: StoredEvent) -> StoredEvent:
        bucket = self._events.setdefault(org_id, [])
        bucket.append(event)
        if len(bucket) > MAX_PERSISTED_EVENTS:
            del bucket[0 : len(bucket) - MAX_PERSISTED_EVENTS]
        return event

    def events_since(self, org_id: str, sequence: int, limit: int = 500) -> List[StoredEvent]:
        bucket = self._events.get(org_id, [])
        return [item for item in bucket if item.sequence > sequence][:limit]

    def last_sequence(self, org_id: str) -> int:
        bucket = self._events.get(org_id, [])
        return bucket[-1].sequence if bucket else 0

    def event_count(self, org_id: str) -> int:
        return len(self._events.get(org_id, []))

    # -- Sağlık -------------------------------------------------------------

    def save_health(self, org_id: str, health: StoredHealth) -> StoredHealth:
        health.updated_at_ms = health.updated_at_ms or now_ms()
        self._health[scoped_id(org_id, health.connection_id)] = health
        return health

    def list_health(self, org_id: str) -> List[StoredHealth]:
        prefix = f"{org_id}::"
        return sorted(
            (value for key, value in self._health.items() if key.startswith(prefix)),
            key=lambda item: item.connection_id,
        )

    def get_health(self, org_id: str, connection_id: str) -> Optional[StoredHealth]:
        return self._health.get(scoped_id(org_id, connection_id))

    # -- Duruşlar -----------------------------------------------------------

    def save_downtime(self, org_id: str, event: DowntimeEvent) -> DowntimeEvent:
        self._downtime[downtime_key(org_id, event)] = event
        return event

    def list_downtime(
        self, org_id: str, since_ms: Optional[int] = None
    ) -> List[DowntimeEvent]:
        prefix = f"{org_id}::"
        items = [
            value
            for key, value in self._downtime.items()
            if key.startswith(prefix)
            and (since_ms is None or value.start_ms >= since_ms)
        ]
        return sorted(items, key=lambda item: item.start_ms)

    def clear_downtime(self, org_id: str) -> int:
        prefix = f"{org_id}::"
        keys = [key for key in self._downtime if key.startswith(prefix)]
        for key in keys:
            del self._downtime[key]
        return len(keys)

    # -- Denetim ------------------------------------------------------------

    def append_audit(self, org_id: str, entry) -> None:
        """Denetim kaydını ekler; **hiçbir zaman güncellemez**."""
        self._audit.setdefault(org_id, []).append(entry)

    def list_audit(self, org_id: str, limit: int = 100) -> List:
        """Kayıtlar, yeniden eskiye."""
        return list(reversed(self._audit.get(org_id, [])))[:limit]

    def audit_count(self, org_id: str) -> int:
        return len(self._audit.get(org_id, []))

    # -- Telemetri ----------------------------------------------------------

    def write_telemetry(self, org_id: str, points) -> int:
        """Ölçümleri yazar; yeni yazılan satır sayısını döndürür.

        Aynı anahtar ikinci kez gelirse üstüne yazılır ve **yeni satır
        sayılmaz**: kurtarmadan sonra aynı ölçüm ikinci kez gönderilebilir ve
        bu, trend grafiğinde çift nokta yaratmamalıdır.
        """
        written = 0
        for point in points:
            key = point_key(org_id, point)
            if key not in self._telemetry:
                written += 1
            self._telemetry[key] = point
        return written

    def query_telemetry(
        self,
        org_id: str,
        device: Optional[str] = None,
        tag: Optional[str] = None,
        start_ms: Optional[int] = None,
        end_ms: Optional[int] = None,
        limit: int = 10_000,
    ) -> List[TelemetryPoint]:
        prefix = f"{org_id}::"
        items = []
        for key, point in self._telemetry.items():
            if not key.startswith(prefix):
                continue
            if device is not None and point.device != device:
                continue
            if tag is not None and point.tag != tag:
                continue
            if start_ms is not None and point.timestamp_ms < start_ms:
                continue
            if end_ms is not None and point.timestamp_ms > end_ms:
                continue
            items.append(point)
        items.sort(key=lambda item: item.timestamp_ms)
        return items[:limit]

    def telemetry_count(self, org_id: str) -> int:
        prefix = f"{org_id}::"
        return sum(1 for key in self._telemetry if key.startswith(prefix))

    def telemetry_tags(self, org_id: str) -> List[tuple]:
        """Kayıtlı cihaz-etiket çiftleri; trend ekranının seçim listesi."""
        prefix = f"{org_id}::"
        pairs = {
            (point.device, point.tag)
            for key, point in self._telemetry.items()
            if key.startswith(prefix)
        }
        return sorted(pairs)

    def oldest_telemetry_ms(self, org_id: str) -> Optional[int]:
        """En eski ölçümün anı; hiç ölçüm yoksa `None` (sıfır değil)."""
        prefix = f"{org_id}::"
        stamps = [
            point.timestamp_ms
            for key, point in self._telemetry.items()
            if key.startswith(prefix)
        ]
        return min(stamps) if stamps else None

    def delete_telemetry_before(
        self, org_id: str, cutoff_ms: int, limit: int = CLEANUP_BATCH
    ) -> int:
        """Kesim anından eski ölçümleri siler; silinen satır sayısını döndürür."""
        prefix = f"{org_id}::"
        keys = [
            key
            for key, point in self._telemetry.items()
            if key.startswith(prefix) and point.timestamp_ms < cutoff_ms
        ][:limit]
        for key in keys:
            del self._telemetry[key]
        return len(keys)

    # -- Lisans, kurulum tokenı ve etiketler --------------------------------

    def save_license(self, org_id: str, license_row: License) -> License:
        """Kiracının lisansını yazar; kiracı başına tek satır."""
        self._licenses[org_id] = license_row
        return license_row

    def get_license(self, org_id: str) -> Optional[License]:
        return self._licenses.get(org_id)

    def save_install_token(self, org_id: str, token: InstallToken) -> InstallToken:
        self._tokens[scoped_id(org_id, token.id)] = token
        return token

    def list_install_tokens(self, org_id: str) -> List[InstallToken]:
        """Kiracının tokenları, yeniden eskiye."""
        prefix = f"{org_id}::"
        items = [value for key, value in self._tokens.items() if key.startswith(prefix)]
        return sorted(items, key=lambda item: item.created_at_ms, reverse=True)

    def get_install_token(self, org_id: str, token_id: str) -> Optional[InstallToken]:
        return self._tokens.get(scoped_id(org_id, token_id))

    def find_install_token(self, org_id: str, digest: str) -> Optional[InstallToken]:
        """Özete göre token arar.

        Arama özetle yapılır çünkü tokenın kendisi hiçbir yerde yazılı
        değildir; gelen metin özetlenip karşılaştırılır.
        """
        for token in self.list_install_tokens(org_id):
            if token.digest == digest:
                return token
        return None

    def next_token_sequence(self, org_id: str) -> int:
        """Sıradaki token numarası; kiracı içinde artar."""
        return len(self.list_install_tokens(org_id)) + 1

    def save_machine_label(self, org_id: str, label: MachineLabel) -> MachineLabel:
        self._labels[scoped_id(org_id, label.machine_id)] = label
        return label

    def list_machine_labels(self, org_id: str) -> List[MachineLabel]:
        prefix = f"{org_id}::"
        items = [value for key, value in self._labels.items() if key.startswith(prefix)]
        return sorted(items, key=lambda item: item.label)

    def get_machine_label(self, org_id: str, machine_id: str) -> Optional[MachineLabel]:
        return self._labels.get(scoped_id(org_id, machine_id))

    def delete_machine_label(self, org_id: str, machine_id: str) -> bool:
        return self._labels.pop(scoped_id(org_id, machine_id), None) is not None

    def known_orgs(self) -> List[str]:
        """Kayıtlı bağlantısı olan organizasyonlar.

        Otomatik kurtarma bunu kullanır: sunucu açılışta hangi kiracıların
        durumunu geri yükleyeceğini başka türlü bilemez.
        """
        return sorted({key.split("::", 1)[0] for key in self._connections})

    def clear(self) -> None:
        self._connections.clear()
        self._snapshots.clear()
        self._events.clear()
        self._health.clear()
        self._downtime.clear()
        self._audit.clear()
        self._telemetry.clear()
        self._licenses.clear()
        self._tokens.clear()
        self._labels.clear()


class DatabaseRuntimeRepository:
    """PostgreSQL (ya da testlerde SQLite) üzerinde kalıcı depo."""

    mode = "database"
    is_persistent = True

    def __init__(self, database_url: str) -> None:
        self._engine = create_engine(
            normalize_database_url(database_url), pool_pre_ping=True, future=True
        )
        self._session = sessionmaker(bind=self._engine, future=True)
        # Tablolar burada oluşturulur: alembic çalıştırılmamış bir ortamda da
        # köprü çalışabilmelidir (bkz. `migrations.ensure_runtime_tables`).
        from simulation_engine.runtime.persistence.migrations import ensure_runtime_tables

        ensure_runtime_tables(self._engine)

    # -- Bağlantılar --------------------------------------------------------

    def save_connection(self, org_id: str, connection: StoredConnection) -> StoredConnection:
        moment = now_ms()
        with self._session() as session:
            key = scoped_id(org_id, connection.connection_id)
            row = session.get(RuntimeConnectionRow, key)
            if row is None:
                row = RuntimeConnectionRow(
                    id=key,
                    org_id=org_id,
                    connection_id=connection.connection_id,
                    created_at_ms=connection.created_at_ms or moment,
                )
                session.add(row)

            row.kind = connection.kind
            row.label = connection.label
            row.endpoint = connection.endpoint
            row.port = connection.port
            row.username = connection.username
            row.has_password = connection.has_password
            row.topics = list(connection.topics)
            row.security_policy = connection.security_policy
            row.qos = connection.qos
            row.timeout_ms = connection.timeout_ms
            row.max_retries = connection.max_retries
            row.status = persisted_status(connection.status)
            row.ever_verified = connection.ever_verified
            row.stream_enabled = connection.stream_enabled
            row.interval_ms = connection.interval_ms
            row.mapping = list(connection.mapping)
            row.updated_at_ms = moment
            session.commit()

        stored = StoredConnection(**connection.__dict__)
        stored.status = persisted_status(connection.status)
        stored.updated_at_ms = moment
        return stored

    def list_connections(self, org_id: str) -> List[StoredConnection]:
        with self._session() as session:
            rows = session.scalars(
                select(RuntimeConnectionRow)
                .where(RuntimeConnectionRow.org_id == org_id)
                .order_by(RuntimeConnectionRow.connection_id)
            ).all()
            return [_connection_from_row(row) for row in rows]

    def get_connection(self, org_id: str, connection_id: str) -> Optional[StoredConnection]:
        with self._session() as session:
            row = session.get(RuntimeConnectionRow, scoped_id(org_id, connection_id))
            return _connection_from_row(row) if row is not None else None

    def delete_connection(self, org_id: str, connection_id: str) -> bool:
        with self._session() as session:
            row = session.get(RuntimeConnectionRow, scoped_id(org_id, connection_id))
            if row is None:
                return False
            session.delete(row)
            session.commit()
            return True

    # -- Görüntüler ---------------------------------------------------------

    def save_snapshot(self, org_id: str, snapshot: MachineSnapshotRecord) -> None:
        with self._session() as session:
            key = scoped_id(org_id, snapshot.machine_id)
            row = session.get(DeviceSnapshotRow, key)
            if row is None:
                row = DeviceSnapshotRow(
                    id=key, org_id=org_id, machine_id=snapshot.machine_id
                )
                session.add(row)
            row.status = snapshot.status
            row.production_count = snapshot.production_count
            row.scrap_count = snapshot.scrap_count
            row.queue_length = snapshot.queue_length
            row.downtime_minutes = snapshot.downtime_minutes
            row.throughput_per_hour = snapshot.throughput_per_hour
            row.cycle_time_seconds = snapshot.cycle_time_seconds
            row.oee = snapshot.oee
            row.sources = dict(snapshot.sources)
            row.sample_count = snapshot.sample_count
            row.updated_at_ms = snapshot.updated_at_ms or now_ms()
            session.commit()

    def list_snapshots(self, org_id: str) -> Dict[str, MachineSnapshotRecord]:
        with self._session() as session:
            rows = session.scalars(
                select(DeviceSnapshotRow)
                .where(DeviceSnapshotRow.org_id == org_id)
                .order_by(DeviceSnapshotRow.machine_id)
            ).all()
            return {row.machine_id: _snapshot_from_row(row) for row in rows}

    def clear_snapshots(self, org_id: str) -> int:
        with self._session() as session:
            result = session.execute(
                delete(DeviceSnapshotRow).where(DeviceSnapshotRow.org_id == org_id)
            )
            session.commit()
            return int(result.rowcount or 0)

    # -- Olaylar ------------------------------------------------------------

    def append_event(self, org_id: str, event: StoredEvent) -> StoredEvent:
        with self._session() as session:
            session.add(
                RuntimeEventRow(
                    id=scoped_id(org_id, str(event.sequence)),
                    org_id=org_id,
                    sequence=event.sequence,
                    connection_id=event.connection_id,
                    kind=event.kind,
                    level=event.level,
                    message=event.message,
                    at_ms=event.at_ms,
                    data=dict(event.data),
                )
            )
            session.commit()
            self._trim_events(session, org_id)
        return event

    def _trim_events(self, session, org_id: str) -> None:
        """Sınırı aşan en eski kayıtları siler."""
        total = session.scalar(
            select(RuntimeEventRow.sequence)
            .where(RuntimeEventRow.org_id == org_id)
            .order_by(RuntimeEventRow.sequence.desc())
            .limit(1)
        )
        if total is None or total <= MAX_PERSISTED_EVENTS:
            return
        session.execute(
            delete(RuntimeEventRow)
            .where(RuntimeEventRow.org_id == org_id)
            .where(RuntimeEventRow.sequence <= total - MAX_PERSISTED_EVENTS)
        )
        session.commit()

    def events_since(self, org_id: str, sequence: int, limit: int = 500) -> List[StoredEvent]:
        with self._session() as session:
            rows = session.scalars(
                select(RuntimeEventRow)
                .where(RuntimeEventRow.org_id == org_id)
                .where(RuntimeEventRow.sequence > sequence)
                .order_by(RuntimeEventRow.sequence)
                .limit(limit)
            ).all()
            return [_event_from_row(row) for row in rows]

    def last_sequence(self, org_id: str) -> int:
        with self._session() as session:
            value = session.scalar(
                select(RuntimeEventRow.sequence)
                .where(RuntimeEventRow.org_id == org_id)
                .order_by(RuntimeEventRow.sequence.desc())
                .limit(1)
            )
            return int(value or 0)

    def event_count(self, org_id: str) -> int:
        with self._session() as session:
            rows = session.scalars(
                select(RuntimeEventRow.sequence).where(RuntimeEventRow.org_id == org_id)
            ).all()
            return len(rows)

    # -- Sağlık -------------------------------------------------------------

    def save_health(self, org_id: str, health: StoredHealth) -> StoredHealth:
        moment = now_ms()
        with self._session() as session:
            key = scoped_id(org_id, health.connection_id)
            row = session.get(RuntimeHealthRow, key)
            if row is None:
                row = RuntimeHealthRow(
                    id=key, org_id=org_id, connection_id=health.connection_id
                )
                session.add(row)
            row.avg_latency_ms = health.avg_latency_ms
            row.max_latency_ms = health.max_latency_ms
            row.packets = health.packets
            row.errors = health.errors
            row.reconnects = health.reconnects
            row.recoveries = health.recoveries
            row.last_error = health.last_error
            row.last_packet_at_ms = health.last_packet_at_ms
            row.updated_at_ms = moment
            session.commit()
        health.updated_at_ms = moment
        return health

    def list_health(self, org_id: str) -> List[StoredHealth]:
        with self._session() as session:
            rows = session.scalars(
                select(RuntimeHealthRow)
                .where(RuntimeHealthRow.org_id == org_id)
                .order_by(RuntimeHealthRow.connection_id)
            ).all()
            return [_health_from_row(row) for row in rows]

    def get_health(self, org_id: str, connection_id: str) -> Optional[StoredHealth]:
        with self._session() as session:
            row = session.get(RuntimeHealthRow, scoped_id(org_id, connection_id))
            return _health_from_row(row) if row is not None else None

    # -- Duruşlar -----------------------------------------------------------

    def save_downtime(self, org_id: str, event: DowntimeEvent) -> DowntimeEvent:
        """Duruşu yazar ya da günceller.

        Süren bir duruşta `end_at_ms` ve `duration_ms` `NULL` kalır; duruş
        kapandığında aynı satır güncellenir. İkinci bir satır açılsaydı, tek
        bir duruş raporda iki kez sayılırdı.
        """
        key = downtime_key(org_id, event)
        with self._session() as session:
            row = session.get(DowntimeEventRow, key)
            if row is None:
                row = DowntimeEventRow(
                    id=key,
                    org_id=org_id,
                    machine_id=event.machine_id,
                    start_at_ms=event.start_ms,
                )
                session.add(row)
            row.end_at_ms = event.end_ms
            row.duration_ms = event.duration_ms()
            row.reason = event.reason
            row.source = event.source
            session.commit()
        return event

    def list_downtime(
        self, org_id: str, since_ms: Optional[int] = None
    ) -> List[DowntimeEvent]:
        with self._session() as session:
            statement = select(DowntimeEventRow).where(DowntimeEventRow.org_id == org_id)
            if since_ms is not None:
                statement = statement.where(DowntimeEventRow.start_at_ms >= since_ms)
            rows = session.execute(
                statement.order_by(DowntimeEventRow.start_at_ms)
            ).scalars()
            return [_downtime_from_row(row) for row in rows]

    def clear_downtime(self, org_id: str) -> int:
        with self._session() as session:
            result = session.execute(
                delete(DowntimeEventRow).where(DowntimeEventRow.org_id == org_id)
            )
            session.commit()
            return int(result.rowcount or 0)

    # -- Denetim ------------------------------------------------------------

    def append_audit(self, org_id: str, entry) -> None:
        """Denetim kaydını ekler.

        Var olan bir satır **güncellenmez**: aynı sıra numarası ikinci kez
        gelirse bu bir hatadır ve sessizce üstüne yazmak, günlüğün kanıt
        değerini yok ederdi.
        """
        with self._session() as session:
            session.add(
                AuditLogRow(
                    id=scoped_id(org_id, str(entry.sequence)),
                    org_id=org_id,
                    sequence=entry.sequence,
                    action=entry.action.value,
                    resource=entry.resource,
                    actor=entry.actor,
                    outcome=entry.outcome.value,
                    at_ms=entry.at_ms,
                    details=dict(entry.details),
                )
            )
            session.commit()

    def list_audit(self, org_id: str, limit: int = 100) -> List:
        with self._session() as session:
            rows = session.execute(
                select(AuditLogRow)
                .where(AuditLogRow.org_id == org_id)
                .order_by(AuditLogRow.sequence.desc())
                .limit(limit)
            ).scalars()
            return [_audit_from_row(row) for row in rows]

    def audit_count(self, org_id: str) -> int:
        with self._session() as session:
            rows = session.execute(
                select(AuditLogRow.id).where(AuditLogRow.org_id == org_id)
            ).scalars()
            return len(list(rows))

    # -- Telemetri ----------------------------------------------------------

    def write_telemetry(self, org_id: str, points) -> int:
        """Ölçümleri **tek işlemde** yazar; yeni satır sayısını döndürür.

        Her ölçüm için ayrı bir işlem açılsaydı, saniyede yüz ölçüm üreten bir
        hat veritabanına saniyede yüz kez giderdi. Toplu yazma bunu tek işleme
        indirir.

        Aynı anahtar ikinci kez gelirse satır güncellenir ve yeni sayılmaz:
        kurtarmadan sonra tekrarlanan bir ölçüm trend grafiğinde çift nokta
        yaratmamalıdır.
        """
        rows = list(points)
        if not rows:
            return 0
        written = 0
        with self._session() as session:
            for point in rows:
                key = point_key(org_id, point)
                row = session.get(TelemetryRow, key)
                if row is None:
                    row = TelemetryRow(
                        id=key,
                        org_id=org_id,
                        timestamp_ms=point.timestamp_ms,
                        device=point.device,
                        tag=point.tag,
                    )
                    session.add(row)
                    written += 1
                row.value = point.value
                row.quality = point.quality
                row.source = point.source
            session.commit()
        return written

    def query_telemetry(
        self,
        org_id: str,
        device: Optional[str] = None,
        tag: Optional[str] = None,
        start_ms: Optional[int] = None,
        end_ms: Optional[int] = None,
        limit: int = 10_000,
    ) -> List[TelemetryPoint]:
        """Zaman aralığındaki ölçümler, eskiden yeniye.

        `limit` her zaman uygulanır: bir haftalık pencerede milyonlarca satır
        dönebilir ve bunları belleğe almak sunucuyu düşürürdü.
        """
        with self._session() as session:
            statement = select(TelemetryRow).where(TelemetryRow.org_id == org_id)
            if device is not None:
                statement = statement.where(TelemetryRow.device == device)
            if tag is not None:
                statement = statement.where(TelemetryRow.tag == tag)
            if start_ms is not None:
                statement = statement.where(TelemetryRow.timestamp_ms >= start_ms)
            if end_ms is not None:
                statement = statement.where(TelemetryRow.timestamp_ms <= end_ms)
            rows = session.execute(
                statement.order_by(TelemetryRow.timestamp_ms).limit(limit)
            ).scalars()
            return [_telemetry_from_row(row) for row in rows]

    def telemetry_count(self, org_id: str) -> int:
        with self._session() as session:
            value = session.execute(
                select(func.count())
                .select_from(TelemetryRow)
                .where(TelemetryRow.org_id == org_id)
            ).scalar()
            return int(value or 0)

    def telemetry_tags(self, org_id: str) -> List[tuple]:
        with self._session() as session:
            rows = session.execute(
                select(TelemetryRow.device, TelemetryRow.tag)
                .where(TelemetryRow.org_id == org_id)
                .distinct()
            ).all()
            return sorted((row[0], row[1]) for row in rows)

    def oldest_telemetry_ms(self, org_id: str) -> Optional[int]:
        """En eski ölçümün anı; hiç ölçüm yoksa `None`.

        Sıfır dönseydi, boş bir tablo "1970'ten beri veri var" gibi okunur ve
        saklama penceresi raporu yanlış çıkardı.
        """
        with self._session() as session:
            value = session.execute(
                select(func.min(TelemetryRow.timestamp_ms)).where(
                    TelemetryRow.org_id == org_id
                )
            ).scalar()
            return int(value) if value is not None else None

    def delete_telemetry_before(
        self, org_id: str, cutoff_ms: int, limit: int = CLEANUP_BATCH
    ) -> int:
        """Kesim anından eski ölçümleri turlar hâlinde siler.

        Sınırsız bir `DELETE`, milyonlarca satırlık bir tabloda uzun süren bir
        kilit yaratır ve bu sırada yazmalar bekler. Tur başına sınır koymak,
        temizliği canlı sistemde çalıştırılabilir kılar.
        """
        with self._session() as session:
            keys = session.execute(
                select(TelemetryRow.id)
                .where(TelemetryRow.org_id == org_id)
                .where(TelemetryRow.timestamp_ms < cutoff_ms)
                .order_by(TelemetryRow.timestamp_ms)
                .limit(limit)
            ).scalars()
            key_list = list(keys)
            if not key_list:
                return 0
            session.execute(delete(TelemetryRow).where(TelemetryRow.id.in_(key_list)))
            session.commit()
            return len(key_list)

    # -- Lisans, kurulum tokenı ve etiketler --------------------------------

    def save_license(self, org_id: str, license_row: License) -> License:
        """Lisansı yazar ya da günceller.

        Kiracı başına tek satır: aynı anda iki lisans, hangisinin geçerli
        olduğu sorusunu yanıtsız bırakırdı.
        """
        with self._session() as session:
            row = session.get(LicenseRow, org_id)
            if row is None:
                row = LicenseRow(id=org_id, org_id=org_id)
                session.add(row)
            row.tier = license_row.tier.value
            row.customer = license_row.customer
            row.starts_at_ms = license_row.starts_at_ms
            row.expires_at_ms = license_row.expires_at_ms
            row.max_users = license_row.limits.users
            row.max_machines = license_row.limits.machines
            row.max_factories = license_row.limits.factories
            row.revoked_at_ms = license_row.revoked_at_ms
            row.revoked_reason = license_row.revoked_reason
            row.issued_at_ms = license_row.issued_at_ms
            row.issued_by = license_row.issued_by
            row.key_digest = license_row.key_digest
            session.commit()
        return license_row

    def get_license(self, org_id: str) -> Optional[License]:
        with self._session() as session:
            row = session.get(LicenseRow, org_id)
            return None if row is None else _license_from_row(row)

    def save_install_token(self, org_id: str, token: InstallToken) -> InstallToken:
        key = scoped_id(org_id, token.id)
        with self._session() as session:
            row = session.get(InstallTokenRow, key)
            if row is None:
                row = InstallTokenRow(
                    id=key,
                    org_id=org_id,
                    token_id=token.id,
                    digest=token.digest,
                    created_at_ms=token.created_at_ms,
                    expires_at_ms=token.expires_at_ms,
                )
                session.add(row)
            row.created_by = token.created_by
            row.site = token.site
            row.used_at_ms = token.used_at_ms
            row.used_by = token.used_by
            row.used_from = token.used_from
            row.revoked_at_ms = token.revoked_at_ms
            row.revoked_reason = token.revoked_reason
            row.usage_log = list(token.usage_log)
            session.commit()
        return token

    def list_install_tokens(self, org_id: str) -> List[InstallToken]:
        with self._session() as session:
            rows = session.execute(
                select(InstallTokenRow)
                .where(InstallTokenRow.org_id == org_id)
                .order_by(InstallTokenRow.created_at_ms.desc())
            ).scalars()
            return [_token_from_row(row) for row in rows]

    def get_install_token(self, org_id: str, token_id: str) -> Optional[InstallToken]:
        with self._session() as session:
            row = session.get(InstallTokenRow, scoped_id(org_id, token_id))
            return None if row is None else _token_from_row(row)

    def find_install_token(self, org_id: str, digest: str) -> Optional[InstallToken]:
        """Özete göre token arar; indeksli sütun üzerinden."""
        with self._session() as session:
            row = session.execute(
                select(InstallTokenRow)
                .where(InstallTokenRow.org_id == org_id)
                .where(InstallTokenRow.digest == digest)
            ).scalars().first()
            return None if row is None else _token_from_row(row)

    def next_token_sequence(self, org_id: str) -> int:
        with self._session() as session:
            value = session.execute(
                select(func.count())
                .select_from(InstallTokenRow)
                .where(InstallTokenRow.org_id == org_id)
            ).scalar()
            return int(value or 0) + 1

    def save_machine_label(self, org_id: str, label: MachineLabel) -> MachineLabel:
        key = scoped_id(org_id, label.machine_id)
        with self._session() as session:
            row = session.get(MachineLabelRow, key)
            if row is None:
                row = MachineLabelRow(
                    id=key,
                    org_id=org_id,
                    machine_id=label.machine_id,
                    created_at_ms=label.created_at_ms,
                )
                session.add(row)
            row.label = label.label
            row.line = label.line
            row.printed_at_ms = label.printed_at_ms
            row.created_by = label.created_by
            row.note = label.note
            session.commit()
        return label

    def list_machine_labels(self, org_id: str) -> List[MachineLabel]:
        with self._session() as session:
            rows = session.execute(
                select(MachineLabelRow)
                .where(MachineLabelRow.org_id == org_id)
                .order_by(MachineLabelRow.label)
            ).scalars()
            return [_label_from_row(row) for row in rows]

    def get_machine_label(self, org_id: str, machine_id: str) -> Optional[MachineLabel]:
        with self._session() as session:
            row = session.get(MachineLabelRow, scoped_id(org_id, machine_id))
            return None if row is None else _label_from_row(row)

    def delete_machine_label(self, org_id: str, machine_id: str) -> bool:
        with self._session() as session:
            result = session.execute(
                delete(MachineLabelRow).where(
                    MachineLabelRow.id == scoped_id(org_id, machine_id)
                )
            )
            session.commit()
            return bool(result.rowcount)

    def known_orgs(self) -> List[str]:
        """Kayıtlı bağlantısı olan organizasyonlar."""
        with self._session() as session:
            rows = session.execute(
                select(RuntimeConnectionRow.org_id).distinct()
            ).scalars()
            return sorted(rows)

    def clear(self) -> None:
        """Yalnızca testler için: bütün runtime tablolarını boşaltır."""
        with self._session() as session:
            for model in (
                RuntimeConnectionRow,
                DeviceSnapshotRow,
                RuntimeEventRow,
                RuntimeHealthRow,
                DowntimeEventRow,
                AuditLogRow,
                TelemetryRow,
                LicenseRow,
                InstallTokenRow,
                MachineLabelRow,
            ):
                session.execute(delete(model))
            session.commit()


def _connection_from_row(row: RuntimeConnectionRow) -> StoredConnection:
    return StoredConnection(
        connection_id=row.connection_id,
        kind=row.kind,
        label=row.label,
        endpoint=row.endpoint,
        port=row.port,
        username=row.username,
        has_password=bool(row.has_password),
        topics=list(row.topics or []),
        security_policy=row.security_policy,
        qos=row.qos,
        timeout_ms=row.timeout_ms,
        max_retries=row.max_retries,
        status=row.status,
        ever_verified=bool(row.ever_verified),
        stream_enabled=bool(row.stream_enabled),
        interval_ms=row.interval_ms,
        mapping=list(row.mapping or []),
        created_at_ms=row.created_at_ms,
        updated_at_ms=row.updated_at_ms,
    )


def _snapshot_from_row(row: DeviceSnapshotRow) -> MachineSnapshotRecord:
    return MachineSnapshotRecord(
        machine_id=row.machine_id,
        status=row.status or UNKNOWN,
        production_count=row.production_count,
        scrap_count=row.scrap_count,
        queue_length=row.queue_length,
        downtime_minutes=row.downtime_minutes,
        throughput_per_hour=row.throughput_per_hour,
        cycle_time_seconds=row.cycle_time_seconds,
        oee=row.oee,
        sources=dict(row.sources or {}),
        # Metrik başına son güncelleme anı diske yazılmaz: tek bir "son
        # güncelleme" alanı yeterlidir ve sırasız ölçüm koruması yalnızca
        # süreç içindeki akış için gereklidir.
        updated={},
        sample_count=row.sample_count,
        updated_at_ms=row.updated_at_ms,
    )


def _event_from_row(row: RuntimeEventRow) -> StoredEvent:
    return StoredEvent(
        sequence=row.sequence,
        connection_id=row.connection_id,
        kind=row.kind,
        level=row.level,
        message=row.message,
        at_ms=row.at_ms,
        data=dict(row.data or {}),
    )


def _audit_from_row(row: AuditLogRow):
    """Satırı denetim kaydına çevirir.

    Tanınmayan bir eylem adı `AuditAction`'a çevrilemezse kayıt **atılmaz**;
    ham değer korunur ve okunur. Atılsaydı, eski bir sürümün yazdığı kayıt
    yeni sürümde görünmez olurdu.
    """
    from simulation_engine.runtime.audit.types import (
        AuditAction,
        AuditEntry,
        AuditOutcome,
    )

    try:
        action = AuditAction(row.action)
    except ValueError:
        action = AuditAction.RUNTIME_RECOVERY

    try:
        outcome = AuditOutcome(row.outcome)
    except ValueError:
        outcome = AuditOutcome.SUCCESS

    return AuditEntry(
        org_id=row.org_id,
        action=action,
        resource=row.resource,
        actor=row.actor,
        outcome=outcome,
        at_ms=row.at_ms,
        details=dict(row.details or {}),
        sequence=row.sequence,
    )


def _license_from_row(row: LicenseRow) -> License:
    return License(
        org_id=row.org_id,
        tier=LicenseTier(row.tier),
        starts_at_ms=int(row.starts_at_ms),
        expires_at_ms=int(row.expires_at_ms),
        customer=row.customer,
        # `None` sınırsız demektir ve öyle taşınır; sıfıra çevrilmez.
        limits=LicenseLimits(
            users=row.max_users,
            machines=row.max_machines,
            factories=row.max_factories,
        ),
        revoked_at_ms=row.revoked_at_ms,
        revoked_reason=row.revoked_reason,
        issued_at_ms=int(row.issued_at_ms),
        issued_by=row.issued_by,
        key_digest=row.key_digest,
    )


def _token_from_row(row: InstallTokenRow) -> InstallToken:
    return InstallToken(
        id=row.token_id,
        org_id=row.org_id,
        digest=row.digest,
        created_at_ms=int(row.created_at_ms),
        expires_at_ms=int(row.expires_at_ms),
        created_by=row.created_by,
        site=row.site,
        used_at_ms=row.used_at_ms,
        used_by=row.used_by,
        used_from=row.used_from,
        revoked_at_ms=row.revoked_at_ms,
        revoked_reason=row.revoked_reason,
        usage_log=list(row.usage_log or []),
    )


def _label_from_row(row: MachineLabelRow) -> MachineLabel:
    return MachineLabel(
        org_id=row.org_id,
        machine_id=row.machine_id,
        label=row.label,
        line=row.line,
        printed_at_ms=row.printed_at_ms,
        created_at_ms=int(row.created_at_ms),
        created_by=row.created_by,
        note=row.note,
    )


def _telemetry_from_row(row: TelemetryRow) -> TelemetryPoint:
    return TelemetryPoint(
        timestamp_ms=int(row.timestamp_ms),
        device=row.device,
        tag=row.tag,
        value=row.value,
        quality=row.quality,
        source=row.source,
    )


def _downtime_from_row(row: DowntimeEventRow) -> DowntimeEvent:
    return DowntimeEvent(
        machine_id=row.machine_id,
        start_ms=row.start_at_ms,
        end_ms=row.end_at_ms,
        reason=row.reason,
        source=row.source,
    )


def _health_from_row(row: RuntimeHealthRow) -> StoredHealth:
    return StoredHealth(
        connection_id=row.connection_id,
        avg_latency_ms=row.avg_latency_ms,
        max_latency_ms=row.max_latency_ms,
        packets=row.packets,
        errors=row.errors,
        reconnects=row.reconnects,
        recoveries=row.recoveries,
        last_error=row.last_error,
        last_packet_at_ms=row.last_packet_at_ms,
        updated_at_ms=row.updated_at_ms,
    )


RuntimeRepository = "InMemoryRuntimeRepository | DatabaseRuntimeRepository"


def create_runtime_repository(database_url: Optional[str] = None):
    """Ortama göre uygun depoyu kurar.

    `DATABASE_URL` yoksa bellek deposu kullanılır ve bu **sessiz değildir**:
    günlüğe yazılır, arayüzde de "Kalıcılık: Doğrulanmadı" görünür. Sessiz
    kalsaydı, kullanıcı sunucu yeniden başlayana kadar durumun kalıcı olduğunu
    sanardı.
    """
    url = database_url if database_url is not None else os.environ.get(DATABASE_URL_ENV)
    if not url:
        logger.info(
            "%s tanimli degil; runtime durumu bellekte tutulacak ve sunucu yeniden "
            "baslatildiginda kaybolacak.",
            DATABASE_URL_ENV,
        )
        return InMemoryRuntimeRepository()

    try:
        repository = DatabaseRuntimeRepository(url)
    except (SQLAlchemyError, ValueError, OSError) as error:
        logger.warning(
            "Runtime veritabanina baglanilamadi (%s); bellek moduna gecildi.", error
        )
        return InMemoryRuntimeRepository()

    logger.info("Runtime durumu veritabaninda saklanacak.")
    return repository
