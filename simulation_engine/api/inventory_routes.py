"""Envanter kalemlerinin API uçları.

Ayrı bir router olarak tutulur ve simülasyon uygulamasına takılır. Bunun iki
sebebi var. Birincisi, envanter modülü üretim simülasyonundan bağımsızdır:
hiç kalem eklenmeden simülasyon aynen çalışır, hiç simülasyon çalıştırılmadan
envanter analizi yapılabilir. İkincisi, `simulation_service.py` zaten
dokuz yüz satır; yeni bir alanı oraya eklemek dosyayı iki ayrı işin karıştığı
bir yere çevirirdi.

Kimlik çakışması bilinçli olarak hata döndürür (409). Sessizce üzerine yazmak,
kullanıcının farkında olmadan bir kalemin geçmişini silmesi demek olurdu.
"""

from __future__ import annotations

from typing import List, Optional, Union

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status

from simulation_engine.analytics.inventory import (
    DEFAULT_HORIZON_DAYS,
    DEFAULT_SERVICE_LEVEL,
    DEFAULT_STOCKOUT_REPLICATIONS,
    analyze,
    estimate_production_impact,
    simulate_stockout_risk,
)
from simulation_engine.api.dependencies import SimulationStoreProtocol, get_store
from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.api.inventory_storage import (
    DatabaseInventoryStore,
    InMemoryInventoryStore,
    InventoryItemExists,
    InventoryItemNotFound,
    create_inventory_store,
)
from simulation_engine.models.schemas import (
    InventoryAnalysis,
    InventoryItem,
    StockoutRiskReport,
)

INVENTORY_PREFIX: str = "/api/inventory"

InventoryStoreProtocol = Union[InMemoryInventoryStore, DatabaseInventoryStore]

#: Modül düzeyinde tek depo; uygulama ömrü boyunca yaşar.
_inventory_store: InventoryStoreProtocol = create_inventory_store()


def get_inventory_store() -> InventoryStoreProtocol:
    """Envanter deposu bağımlılığı."""
    return _inventory_store


router = APIRouter(prefix=INVENTORY_PREFIX, tags=["inventory"])


@router.post(
    "/items",
    response_model=InventoryItem,
    status_code=status.HTTP_201_CREATED,
    summary="Yeni envanter kalemi ekler",
)
def create_item(
    item: InventoryItem = Body(...),
    org_id: str = Depends(get_current_org),
    store: InventoryStoreProtocol = Depends(get_inventory_store),
) -> InventoryItem:
    """Yeni bir kalem kaydeder.

    Kalem, çağrıyı yapan kullanıcının organizasyonuna yazılır.

    Raises:
        HTTPException: Aynı kimlikte bir kalem zaten varsa (409).
    """
    try:
        return store.add(org_id, item)
    except InventoryItemExists as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"'{item.id}' kimlikli bir envanter kalemi zaten var. Guncellemek "
                f"icin PUT kullanin."
            ),
        ) from error


@router.get(
    "/items",
    response_model=List[InventoryItem],
    summary="Envanter kalemlerini listeler",
)
def list_items(
    org_id: str = Depends(get_current_org),
    store: InventoryStoreProtocol = Depends(get_inventory_store),
) -> List[InventoryItem]:
    """Çağrıyı yapan kullanıcının organizasyonuna ait kalemleri ada göre sıralı döndürür."""
    return store.list(org_id)


@router.get(
    "/items/{item_id}",
    response_model=InventoryItem,
    summary="Tek bir envanter kalemini getirir",
)
def read_item(
    item_id: str = Path(..., min_length=1),
    org_id: str = Depends(get_current_org),
    store: InventoryStoreProtocol = Depends(get_inventory_store),
) -> InventoryItem:
    """Kalemi kimliğine göre getirir.

    Raises:
        HTTPException: Kalem bulunamazsa ya da başka bir organizasyona aitse
            (404).
    """
    try:
        return store.get(org_id, item_id)
    except InventoryItemNotFound as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"'{item_id}' kimlikli envanter kalemi bulunamadi.",
        ) from error


@router.put(
    "/items/{item_id}",
    response_model=InventoryItem,
    summary="Envanter kalemini gunceller",
)
def update_item(
    item_id: str = Path(..., min_length=1),
    item: InventoryItem = Body(...),
    org_id: str = Depends(get_current_org),
    store: InventoryStoreProtocol = Depends(get_inventory_store),
) -> InventoryItem:
    """Kalemi tümüyle değiştirir.

    Kimlik yoldan alınır; gövdedeki `id` alanı yok sayılır. Aksi hâlde bir
    güncelleme isteği kimliği değiştirip ortada iki kayıt bırakabilirdi.

    Raises:
        HTTPException: Kalem bulunamazsa ya da başka bir organizasyona aitse
            (404).
    """
    try:
        return store.update(org_id, item_id, item)
    except InventoryItemNotFound as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"'{item_id}' kimlikli envanter kalemi bulunamadi.",
        ) from error


@router.delete(
    "/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Envanter kalemini siler",
)
def delete_item(
    item_id: str = Path(..., min_length=1),
    org_id: str = Depends(get_current_org),
    store: InventoryStoreProtocol = Depends(get_inventory_store),
) -> None:
    """Kalemi kalıcı olarak siler.

    Raises:
        HTTPException: Kalem bulunamazsa ya da başka bir organizasyona aitse
            (404).
    """
    try:
        store.delete(org_id, item_id)
    except InventoryItemNotFound as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"'{item_id}' kimlikli envanter kalemi bulunamadi.",
        ) from error


# --------------------------------------------------------------------------- #
# Analiz uçları
# --------------------------------------------------------------------------- #


@router.post(
    "/analyze/{item_id}",
    response_model=InventoryAnalysis,
    summary="EOQ, guvenlik stoku ve yeniden siparis noktasi hesaplar",
)
def analyze_item(
    item_id: str = Path(..., min_length=1),
    service_level: float = Query(
        DEFAULT_SERVICE_LEVEL,
        gt=0.0,
        lt=1.0,
        description="Hizmet seviyesi oran olarak (0.95 = %95)",
    ),
    org_id: str = Depends(get_current_org),
    store: InventoryStoreProtocol = Depends(get_inventory_store),
) -> InventoryAnalysis:
    """Kalemin klasik envanter teorisi göstergelerini döndürür.

    Hizmet seviyesi bir sorgu parametresidir çünkü aynı kalem farklı hizmet
    hedefleriyle değerlendirilebilir; kaleme sabitlenseydi karşılaştırma için
    kaydı değiştirmek gerekirdi.

    Raises:
        HTTPException: Kalem bulunamazsa ya da başka bir organizasyona aitse
            (404).
    """
    item = _require_item(store, org_id, item_id)
    return analyze(item, service_level=service_level)


@router.post(
    "/stockout-risk/{item_id}",
    response_model=StockoutRiskReport,
    summary="Stok tukenme riskini Monte Carlo ile kestirir",
)
def stockout_risk(
    item_id: str = Path(..., min_length=1),
    horizon_days: int = Query(
        DEFAULT_HORIZON_DAYS, gt=0, le=365, description="Kac gunluk projeksiyon"
    ),
    num_replications: int = Query(
        DEFAULT_STOCKOUT_REPLICATIONS,
        gt=0,
        le=5000,
        description="Bagimsiz kosum sayisi",
    ),
    random_seed: Optional[int] = Query(
        None, ge=0, description="Kosumu tekrarlamak icin ana tohum"
    ),
    simulation_id: Optional[str] = Query(
        None,
        description=(
            "Uretim etkisi icin okunacak kosum. Kalem bir istasyona bagliysa ve "
            "bu kosumda o istasyon varsa kayip uretim de hesaplanir."
        ),
    ),
    org_id: str = Depends(get_current_org),
    store: InventoryStoreProtocol = Depends(get_inventory_store),
    simulations: SimulationStoreProtocol = Depends(get_store),
) -> StockoutRiskReport:
    """Mevcut stokla, yeni sipariş gelmediği varsayımıyla tükenme riskini verir.

    `simulation_id` verilir ve kalem bir istasyona bağlıysa, o koşumun
    **kaydedilmiş** çıktısı okunarak üretim kaybı da kestirilir. Motor bu iş
    için yeniden çalıştırılmaz ve hiçbir şekilde değiştirilmez; bağlantı tek
    yönlüdür.

    Günde kaç dakika üretim yapıldığı kalemin kendi alanından okunur; şema onu
    istasyon bağlantısıyla birlikte şart koşar. Bu bilgi olmadan üretim etkisi
    hesaplanmaz — uydurulmuş bir süreyle üretilen uyarı, hiç uyarı vermemekten
    kötüdür.

    Bağlantının kurulamaması hata değildir: koşum bulunamazsa ya da o koşumda
    istasyon yoksa rapor üretim etkisi olmadan döner. Envanter analizinin
    üretim tarafına bağımlı hâle gelmesi, modülün bağımsızlığını bozardı.

    Raises:
        HTTPException: Kalem bulunamazsa ya da başka bir organizasyona aitse
            (404).
    """
    item = _require_item(store, org_id, item_id)
    report = simulate_stockout_risk(
        item,
        horizon_days=horizon_days,
        num_replications=num_replications,
        master_seed=random_seed,
    )

    if simulation_id is None or item.linked_station_id is None:
        return report

    try:
        record = simulations.get(org_id, simulation_id)
    except KeyError:
        # Kosum bulunamadi (silinmis, sunucu yeniden baslamis, ya da baska bir
        # organizasyona ait olabilir). Risk raporu kendi basina eksiksizdir;
        # uretim etkisi olmadan doner.
        return report

    impact = estimate_production_impact(
        item, report, record.replications, simulation_id=simulation_id
    )
    return report.model_copy(update={"production_impact": impact})


def _require_item(
    store: InventoryStoreProtocol, org_id: str, item_id: str
) -> InventoryItem:
    """Kalemi getirir; yoksa ya da başka bir organizasyona aitse 404 üretir."""
    try:
        return store.get(org_id, item_id)
    except InventoryItemNotFound as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"'{item_id}' kimlikli envanter kalemi bulunamadi.",
        ) from error
