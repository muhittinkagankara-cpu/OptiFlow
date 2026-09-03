"""Fabrika modellerinin API uçları.

Envanter modülüyle aynı desen: ayrı bir router, kendi ön eki, kendi depo
bağımlılığı. Fabrikalar simülasyon uçlarından bağımsızdır — kaydedilmiş hiçbir
fabrika olmadan `POST /api/simulations/run` aynen çalışır ve mevcut istemciler
hiçbir şeyin değiştiğini fark etmez.

Doğrulama burada tekrarlanmaz
-----------------------------
Gövdedeki `config` alanı `SimulationConfig` tipindedir; yinelenen istasyon
kimliği, toplamı 1'i aşan yönlendirme olasılıkları, bilinmeyen bağlantı hedefi,
geçersiz dağılım parametreleri ve ısınma penceresi tutarsızlığı FastAPI'nin
gövdeyi çözerken uyguladığı mevcut doğrulayıcılar tarafından yakalanır ve 422
üretir. Depoya geçersiz bir model asla ulaşmaz ve aynı kurallar ikinci bir
yerde yazılmaz.

Koşum ucu neden burada değil
----------------------------
`POST /api/factories/{factory_id}/run` `simulation_service` içinde tanımlıdır;
çalıştırma hattı (`_execute_scenario`, `_build_run_response`) orada yaşar ve bu
modülden çağrılması dairesel bir içe aktarma oluştururdu. Mantığı kopyalamak
yerine ucun tanımı, kodun bulunduğu yere konuldu.
"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Body, Depends, HTTPException, Path, status

from simulation_engine.api.dependencies import FactoryStoreProtocol, get_factory_store
from simulation_engine.api.factory_storage import (
    FactoryNotFound,
    FactoryVersionNotFound,
)
from simulation_engine.auth.dependencies import get_current_org
from simulation_engine.models.schemas import (
    Factory,
    FactoryCreateRequest,
    FactoryDetail,
    FactorySaveRequest,
    FactoryVersion,
    FactoryVersionSummary,
)

FACTORY_PREFIX: str = "/api/factories"

router = APIRouter(prefix=FACTORY_PREFIX, tags=["factories"])


def factory_not_found(factory_id: str) -> HTTPException:
    """Fabrika bulunamadı hatasını tek bir yerde üretir."""
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"'{factory_id}' kimlikli fabrika bulunamadi.",
    )


@router.post(
    "",
    response_model=FactoryDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Yeni fabrika olusturur",
)
def create_factory(
    request: FactoryCreateRequest = Body(...),
    org_id: str = Depends(get_current_org),
    store: FactoryStoreProtocol = Depends(get_factory_store),
) -> FactoryDetail:
    """Yeni bir fabrika kaydeder.

    `config` verilirse ilk sürüm de birlikte oluşturulur; verilmezse fabrika
    sürümsüz doğar ve kullanıcı editörde ilk kaydı yaptığında sürüm 1 oluşur.
    Kimlik sunucuda üretilir — istemcinin kimlik seçmesine izin verilseydi iki
    sekmede aynı anda kurulan iki fabrika birbirinin üzerine yazabilirdi.
    Fabrika, çağrıyı yapan kullanıcının organizasyonuna yazılır.
    """
    return store.create(org_id, request)


@router.get(
    "",
    response_model=List[Factory],
    summary="Fabrikalari listeler",
)
def list_factories(
    org_id: str = Depends(get_current_org),
    store: FactoryStoreProtocol = Depends(get_factory_store),
) -> List[Factory]:
    """Çağrıyı yapan kullanıcının organizasyonuna ait fabrikaları döndürür.

    En son güncellenen başta gelir. Yanıt modeli taşımaz: liste ekranı yalnızca
    ad, sektör ve sürüm sayısını gösterir. Her satır için tam `SimulationConfig`
    göndermek, on fabrikalı bir hesapta liste ekranını gereksiz yere
    ağırlaştırırdı. Başka bir organizasyonun fabrikaları bu listeye hiç girmez.
    """
    return store.list(org_id)


@router.get(
    "/{factory_id}",
    response_model=FactoryDetail,
    summary="Fabrikayi ve guncel surumunu getirir",
)
def read_factory(
    factory_id: str = Path(..., min_length=1),
    org_id: str = Depends(get_current_org),
    store: FactoryStoreProtocol = Depends(get_factory_store),
) -> FactoryDetail:
    """Fabrikayı güncel modeliyle birlikte döndürür.

    Raises:
        HTTPException: Fabrika bulunamazsa **ya da başka bir organizasyona
            aitse** (404). İkisi aynı yanıtı üretir; aksi hâlde bir yanıt kodu
            farkı bile başka bir organizasyonun kimliğinin var olduğunu ele
            verirdi.
    """
    try:
        return store.get(org_id, factory_id)
    except FactoryNotFound as error:
        raise factory_not_found(factory_id) from error


@router.put(
    "/{factory_id}",
    response_model=FactoryDetail,
    summary="Fabrikayi kaydeder; model degistiyse yeni surum olusturur",
)
def save_factory(
    factory_id: str = Path(..., min_length=1),
    request: FactorySaveRequest = Body(...),
    org_id: str = Depends(get_current_org),
    store: FactoryStoreProtocol = Depends(get_factory_store),
) -> FactoryDetail:
    """Fabrikayı günceller.

    Model gönderilirse `config` ve `layout` üzerinden bir SHA-256 özeti
    hesaplanır. Özet güncel sürümünkiyle aynıysa **yeni sürüm oluşturulmaz** ve
    var olan sürüm geri döner; yanıttaki `version_number` alanına bakarak
    istemci kaydın yeni bir sürüm yaratıp yaratmadığını anlayabilir.

    Raises:
        HTTPException: Fabrika bulunamazsa ya da başka bir organizasyona
            aitse (404).
    """
    try:
        return store.save(org_id, factory_id, request)
    except FactoryNotFound as error:
        raise factory_not_found(factory_id) from error


@router.delete(
    "/{factory_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Fabrikayi ve tum surumlerini siler",
)
def delete_factory(
    factory_id: str = Path(..., min_length=1),
    org_id: str = Depends(get_current_org),
    store: FactoryStoreProtocol = Depends(get_factory_store),
) -> None:
    """Fabrikayı siler.

    Bu fabrikadan alınmış simülasyon kayıtları silinmez; koşumun kendisi hâlâ
    geçerli bir ölçümdür ve fabrikanın silinmesi geçmişi yeniden yazmamalıdır.

    Raises:
        HTTPException: Fabrika bulunamazsa ya da başka bir organizasyona
            aitse (404).
    """
    try:
        store.delete(org_id, factory_id)
    except FactoryNotFound as error:
        raise factory_not_found(factory_id) from error


@router.get(
    "/{factory_id}/versions",
    response_model=List[FactoryVersionSummary],
    summary="Fabrikanin surum gecmisini listeler",
)
def list_versions(
    factory_id: str = Path(..., min_length=1),
    org_id: str = Depends(get_current_org),
    store: FactoryStoreProtocol = Depends(get_factory_store),
) -> List[FactoryVersionSummary]:
    """Sürüm geçmişini en yeniden en eskiye döndürür.

    Raises:
        HTTPException: Fabrika bulunamazsa ya da başka bir organizasyona
            aitse (404).
    """
    try:
        return store.list_versions(org_id, factory_id)
    except FactoryNotFound as error:
        raise factory_not_found(factory_id) from error


@router.get(
    "/{factory_id}/versions/{version_id}",
    response_model=FactoryVersion,
    summary="Belirli bir surumu tam olarak getirir",
)
def read_version(
    factory_id: str = Path(..., min_length=1),
    version_id: str = Path(..., min_length=1),
    org_id: str = Depends(get_current_org),
    store: FactoryStoreProtocol = Depends(get_factory_store),
) -> FactoryVersion:
    """Sürümü modeliyle birlikte döndürür.

    Raises:
        HTTPException: Fabrika, sürüm bulunamazsa ya da fabrika başka bir
            organizasyona aitse (404).
    """
    try:
        return store.get_version(org_id, factory_id, version_id)
    except FactoryNotFound as error:
        raise factory_not_found(factory_id) from error
    except FactoryVersionNotFound as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"'{version_id}' kimlikli surum '{factory_id}' fabrikasinda "
                f"bulunamadi."
            ),
        ) from error
