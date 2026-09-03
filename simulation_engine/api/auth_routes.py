"""Kimlik ile ilgili tek uç: `GET /api/me`.

Envanter ve fabrika modülleriyle aynı desen — ayrı bir router, tek sorumluluk.
Bu uç herhangi bir iş verisine dokunmaz; yalnızca doğrulanmış kullanıcının
kimliğini ve organizasyonunu döndürür. Frontend, oturum açtıktan sonra ana
uygulamayı göstermeden önce bunu çağırır: `get_current_org` bağımlılığı
kullanıcının ilk girişinde organizasyonunu kendiliğinden kurduğu için, bu uç
aynı zamanda "kaydı tamamlama" adımının kendisidir — ayrı bir uç ya da ekrana
gerek kalmaz.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from simulation_engine.api.dependencies import OrgStoreProtocol, get_org_store
from simulation_engine.auth.dependencies import get_current_org, get_current_user
from simulation_engine.auth.jwt import AuthenticatedUser
from simulation_engine.models.schemas import MeResponse

router = APIRouter(prefix="/api", tags=["auth"])


@router.get("/me", response_model=MeResponse, summary="Dogrulanmis kimligi dondurur")
def read_me(
    user: AuthenticatedUser = Depends(get_current_user),
    org_id: str = Depends(get_current_org),
    store: OrgStoreProtocol = Depends(get_org_store),
) -> MeResponse:
    """Kullanıcının kimliğini ve organizasyonunu döndürür.

    `org_id` bağımlılığı, kullanıcının henüz organizasyonu yoksa burada
    kendiliğinden kurar; bu yüzden bu uç bir kullanıcının **ilk çağrısı**
    olarak da güvenle kullanılabilir. `store.get_org` çağrısı `get_current_org`
    ile aynı organizasyonu bir kez daha okur ama yalnızca adını almak için —
    kimlik doğrulaması zaten tamamlanmış durumdadır.
    """
    org = store.get_org(org_id)
    assert org is not None  # get_current_org zaten kurdu/dogruladi
    return MeResponse(
        user_id=user.user_id, email=user.email, org_id=org.id, org_name=org.name
    )
