"""Operasyon uçları: sağlık, hazırlık, ölçüm, yedekleme ve denetim.

Kimlik doğrulaması olmayan iki uç
---------------------------------
`/api/health` ve `/api/ready` **token istemez**. Bunun nedeni, bu uçları
çağıranın bir kullanıcı değil altyapı olmasıdır: Docker sağlık denetimi, yük
dengeleyici ve düzenleyici token taşıyamaz. Karşılığında bu uçlar hiçbir iş
verisi döndürmez — yalnızca "ayakta mı" ve "hazır mı" bilgisini verir.

Öteki bütün uçlar kimlik ve kiracı kapsamı ister; yedekleme ve denetim
kayıtları bir kiracının en hassas verileridir.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.runtime.api import get_runtime_manager
from simulation_engine.runtime.audit import AuditAction, AuditOutcome
from simulation_engine.runtime.manager import RuntimeManager
from simulation_engine.runtime.ops import (
    HealthService,
    ProcessMetrics,
    check_environment,
    create_backup,
    restore_backup,
    summarize_backup,
    verify_backup,
)

OPS_PREFIX = "/api"

router = APIRouter(prefix=OPS_PREFIX, tags=["operasyon"])

#: Sürecin başlangıç anı; çalışma süresi buradan hesaplanır.
_STARTED_AT_MS = int(time.time() * 1000)

#: Uygulama düzeyinde tek ölçüm toplayıcı.
_metrics = ProcessMetrics(started_at_ms=_STARTED_AT_MS)

#: Sürüm; dağıtımda hangi kodun çalıştığını söyler.
try:  # pragma: no cover — sürüm okunamazsa ölçüm değil bilgi kaybıdır
    from simulation_engine import __version__ as APP_VERSION
except ImportError:  # pragma: no cover
    APP_VERSION = "bilinmiyor"


def get_metrics() -> ProcessMetrics:
    """Ölçüm toplayıcı bağımlılığı; testler kendi örneğini geçirebilir."""
    return _metrics


def get_health_service(
    manager: RuntimeManager = Depends(get_runtime_manager),
    metrics: ProcessMetrics = Depends(get_metrics),
) -> HealthService:
    return HealthService(
        version=str(APP_VERSION),
        metrics=metrics,
        repository=manager.repository,
    )


# -- Sağlık ve hazırlık -----------------------------------------------------


@router.get("/health")
async def health(service: HealthService = Depends(get_health_service)) -> dict:
    """Canlılık: süreç ayakta mı?

    Bağımlılık **yoklanmaz**. Veritabanı geçici olarak yanıt vermediğinde
    kapsayıcıyı yeniden başlatmak sorunu çözmez, yalnızca hizmeti büsbütün
    kaybettirir.
    """
    return service.health()


@router.get("/ready")
async def ready(service: HealthService = Depends(get_health_service)) -> dict:
    """Hazırlık: bu sürece istek gönderilebilir mi?

    Hazır değilse **503** döner; yük dengeleyici bu örneğe trafik göndermez
    ama kapsayıcı yaşamayı sürdürür.
    """
    payload = service.readiness()
    if not payload["ready"]:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=payload
        )
    return payload


# -- Ölçümler ---------------------------------------------------------------


@router.get("/ops/metrics")
async def ops_metrics(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
    metrics: ProcessMetrics = Depends(get_metrics),
) -> dict:
    """Üretim izleme ölçümleri.

    Ölçülemeyen alan `null` döner: `psutil` kurulu değilse bellek ve işlemci
    değeri uydurulmaz.
    """
    return {
        "process": metrics.snapshot(),
        "stream": manager.stream_stats(org_id),
        "connections": manager.status_report(org_id),
        "audit": manager.audit.summary(org_id),
        "environment": check_environment().to_dict(),
    }


@router.get("/ops/environment")
async def ops_environment(org_id: str = Depends(get_current_org)) -> dict:
    """Ortam denetimi: eksik ya da hatalı ayarlar."""
    return check_environment().to_dict()


# -- Yedekleme --------------------------------------------------------------


class RestoreRequest(BaseModel):
    """Geri yükleme isteği."""

    backup: Dict[str, Any] = Field(..., description="Yedek gövdesi")
    #: Hedef kiracı; verilmezse yedeğin kendi kiracısına yüklenir.
    target_org_id: Optional[str] = None


@router.post("/ops/backup")
async def ops_backup(
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Kiracının runtime durumunu yedekler.

    Yedek **mantıksal**tır: dosya kopyası değil, tabloların JSON çıktısıdır.
    Aynı yedek hem SQLite hem PostgreSQL'de geri yüklenebilir.
    """
    payload = create_backup(manager.repository, org_id)
    summary = summarize_backup(payload)

    manager.audit.record(
        org_id=org_id,
        action=AuditAction.BACKUP_CREATED,
        resource=f"backup::{summary.checksum[:12]}",
        details={"rows": summary.total_rows},
    )

    return {"backup": payload, "summary": summary.to_dict()}


@router.post("/ops/restore")
async def ops_restore(
    payload: RestoreRequest,
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Yedeği geri yükler.

    Hedef kiracı **her zaman** oturumun kiracısıdır: istek gövdesindeki
    `target_org_id` yalnızca yedeğin kendi kiracısından farklı bir kiracıya
    yüklenmesini engellemek için okunur. Gövdedeki kimliğe güvenilseydi, bir
    kullanıcı başka bir organizasyonun verisini ezebilirdi.
    """
    problems = verify_backup(payload.backup)
    if problems:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"problems": problems},
        )

    result = restore_backup(manager.repository, payload.backup, org_id=org_id)

    manager.audit.record(
        org_id=org_id,
        action=AuditAction.BACKUP_RESTORED,
        resource=f"backup::{str(payload.backup.get('checksum', ''))[:12]}",
        outcome=AuditOutcome.SUCCESS if result.ok else AuditOutcome.FAILURE,
        details={"restored": result.total_restored},
    )

    if not result.ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=result.to_dict()
        )

    # Geri yükleme diski değiştirir; bellekteki durum eskir ve yeniden okunur.
    manager.recover(org_id)
    return result.to_dict()


@router.post("/ops/backup/verify")
async def ops_backup_verify(
    backup: Dict[str, Any] = Body(...),
    org_id: str = Depends(get_current_org),
) -> dict:
    """Yedeği geri yüklemeden doğrular."""
    problems = verify_backup(backup)
    return {
        "ok": not problems,
        "problems": problems,
        "summary": summarize_backup(backup).to_dict() if not problems else None,
    }


# -- Denetim ----------------------------------------------------------------


@router.get("/audit")
async def audit_log(
    limit: int = Query(default=100, ge=1, le=500),
    action: Optional[str] = Query(default=None),
    org_id: str = Depends(get_current_org),
    manager: RuntimeManager = Depends(get_runtime_manager),
) -> dict:
    """Denetim kayıtları, yeniden eskiye.

    Kayıtlar yalnızca okunur: bu uçta silme ya da güncelleme yoktur ve
    olmaması bilinçlidir.
    """
    parsed: Optional[AuditAction] = None
    if action:
        try:
            parsed = AuditAction(action)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Tanınmayan işlem türü: {action}",
            ) from None

    entries = manager.audit.entries(org_id, limit=limit, action=parsed)
    return {
        "entries": [item.to_dict() for item in entries],
        "count": len(entries),
        "summary": manager.audit.summary(org_id),
    }
