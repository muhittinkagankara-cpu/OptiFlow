"""Finansal etki API ucu.

Kendi router'ında tutulur (envanter ve fabrika modülleriyle aynı desen).
Simülasyon uçlarının hiçbiri değişmez: finans katmanı, **zaten kaydedilmiş**
bir koşumun metriklerini okur ve maliyet oranlarıyla çarpar. Motor bu iş için
yeniden çalıştırılmaz ve hiçbir şekilde değiştirilmez.

Maliyet oranları neden gövdede?
-------------------------------
Oranlar isteğin gövdesinde gelir, veritabanından okunmaz. Sprint 1'in kapsamı
kayıp motorudur; oranları fabrika kaydına kalıcı olarak yazmak bir şema
değişikliği (yeni sütun + göç) gerektirir ve bu sprintte istenmedi. Hesabın
kendisi saf olduğu için, oranlar ileride fabrikadan gelmeye başladığında bu
uçtaki tek değişiklik gövde yerine depodan okumak olacaktır — motor hiç
değişmez.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Path, status

from simulation_engine.api.dependencies import SimulationStoreProtocol, get_store
from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.finance.loss_engine import build_report
from simulation_engine.finance.models import FinancialReport, FinancialSettings

FINANCE_PREFIX: str = "/api/finance"

router = APIRouter(prefix=FINANCE_PREFIX, tags=["finance"])


@router.post(
    "/impact/{simulation_id}",
    response_model=FinancialReport,
    summary="Bir kosumun finansal kayip raporunu uretir",
)
def financial_impact(
    simulation_id: str = Path(..., description="`/run` ucundan donen kimlik"),
    settings: FinancialSettings = Body(...),
    org_id: str = Depends(get_current_org),
    store: SimulationStoreProtocol = Depends(get_store),
) -> FinancialReport:
    """Kaydedilmiş bir koşumun kayıplarını paraya çevirir.

    Hesap ilk replikasyon üzerinden yapılır — darboğaz analizi ve OEE de aynı
    replikasyondan üretilir (bkz. `_execute_scenario`). Aynı koşumun farklı
    bölümlerinin farklı replikasyonlardan gelmesi, birbirini tutmayan sayılar
    üretirdi.

    Eksik maliyet oranları hata değildir: ilgili kalem hesaplanmaz ve
    `missing_inputs` içinde bildirilir. Sıfır kabul edilseydi, hiç oran
    girmemiş bir kullanıcı "toplam kaybınız 0" yanıtını alır ve bunu iyi haber
    sanardı.

    Raises:
        HTTPException: Koşum bulunamazsa ya da başka bir organizasyona
            aitse (404).
    """
    try:
        record = store.get(org_id, simulation_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"'{simulation_id}' kimlikli simulasyon bulunamadi.",
        ) from error

    representative = record.replications[0]
    return build_report(
        stations=representative.stations,
        settings=settings,
        window_minutes=representative.system.window_duration_minutes,
        bottleneck=record.bottleneck,
    )
