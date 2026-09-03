"""FastAPI bağımlılıkları: token'ı doğrular, organizasyon kapsamını çözer.

Bu modül `simulation_engine.auth.jwt` (saf token doğrulama) ile
`simulation_engine.api.org_storage` (üyelik deposu) arasındaki köprüdür.
Route'lar yalnızca `get_current_org` bağımlılığını görür — ne token'ın nasıl
çözüldüğünü ne de organizasyonun nasıl bulunduğunu/kurulduğunu bilir. Bu
katmanlama, bir route'un yanlışlıkla `get_current_user`'ı çağırıp organizasyon
kontrolünü unutması ihtimalini ortadan kaldırır: veriye erişen her uç tek bir
bağımlılık ister ve o bağımlılık kimlik doğrulamayı da örtük olarak içerir.

Hata eşlemesi
-------------
İstemci kaynaklı her sorun (eksik/bozuk/süresi dolmuş/yanlış imzalı token)
**401** üretir ve aralarında ayrım yapılmaz; hangi denemenin "daha yakın"
olduğunu saldırgana söylemek istenmez. Sunucu kaynaklı sorunlar ayrılır:
yapılandırma eksikse **500**, imzalama anahtarları geçici olarak alınamıyorsa
**503**. Bu ayrım işletme içindir — üçü de aynı 401'e indirgenseydi, yanlış
yapılandırılmış bir sunucu "tüm kullanıcıların token'ı geçersiz" gibi görünür
ve gerçek neden gizlenirdi.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from simulation_engine.api.dependencies import OrgStoreProtocol, get_org_store
from simulation_engine.auth.jwt import (
    AuthConfigurationError,
    AuthenticatedUser,
    AuthError,
    AuthKeyUnavailableError,
    decode_access_token,
    resolve_config,
)

#: `auto_error=False`: eksik başlık durumunda FastAPI'nin kendi jenerik
#: mesajı yerine burada Türkçe, tutarlı bir hata üretilir.
_bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> AuthenticatedUser:
    """İsteğin `Authorization: Bearer <token>` başlığını doğrular.

    Raises:
        HTTPException: Başlık yoksa, token geçersizse ya da süresi dolmuşsa
            (401); sunucu yanlış yapılandırılmışsa (500); imzalama anahtarları
            geçici olarak alınamıyorsa (503).
    """
    if credentials is None:
        raise _unauthorized("Oturum acmadan bu uca erisilemez.")

    try:
        config = resolve_config()
    except AuthConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)
        ) from error

    try:
        return decode_access_token(credentials.credentials, config)
    except AuthKeyUnavailableError as error:
        # Anahtarlar alinamadi: dogrulama yapilamadigi icin istek reddedilir.
        # 503, gecici bir ust kaynak arizasini isaret eder; istemcinin
        # token'inda bir sorun oldugunu ima etmez.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error
    except AuthConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)
        ) from error
    except AuthError as error:
        raise _unauthorized(str(error)) from error


async def get_current_org(
    user: AuthenticatedUser = Depends(get_current_user),
    store: OrgStoreProtocol = Depends(get_org_store),
) -> str:
    """Doğrulanmış kullanıcının organizasyon kimliğini döndürür.

    Kullanıcının henüz bir organizasyonu yoksa (ilk giriş) burada
    **kendiliğinden kurulur**. Ayrı bir "organizasyon oluştur" ucu ya da adımı
    yoktur: giriş yapan her kullanıcı, veri isteyen ilk çağrısında zaten bir
    organizasyona sahip olur. Bu tüm veri uçlarının ortak bağımlılığıdır — bir
    route yalnızca bunu ister ve hem kimlik doğrulamayı hem organizasyon
    çözümünü örtük olarak alır.

    Organizasyon kimliği **yalnızca doğrulanmış token'ın `sub` alanından**
    türetilir. İstemcinin gönderdiği hiçbir alan (gövde, sorgu parametresi,
    başlık) bu çözüme katılmaz; katılsaydı bir kullanıcı başka bir
    organizasyonun kimliğini yazarak onun verisine erişebilirdi.
    """
    org = store.get_or_create_org_for_user(user.user_id, user.email)
    return org.id
