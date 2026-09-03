"""Supabase erişim token'larının doğrulanması.

Bu modülün FastAPI'den, veritabanından, hiçbir şeyden haberi yoktur — yalnızca
bir metin token alır ve ya bir `AuthenticatedUser` ya da bir hata döndürür.
Saf tutulması bilinçlidir: token doğrulama mantığı HTTP katmanından ayrılınca
hem web sunucusu çalıştırmadan test edilebilir hem de ileride başka bir giriş
noktasından yeniden kullanılabilir.

İki imzalama biçimi neden de destekleniyor
------------------------------------------
Supabase projeleri JWT'leri iki farklı biçimde imzalayabilir ve **hangisinin
kullanıldığı projenin ne zaman oluşturulduğuna bağlıdır**:

* **Asimetrik (RS256/ES256, JWKS).** 1 Mayıs 2025'ten sonra oluşturulan
  projelerin **varsayılanı** budur. Sunucu, projenin herkese açık anahtar
  kümesini (`/auth/v1/.well-known/jwks.json`) indirir ve imzayı onunla
  doğrular. Gizli bir değer paylaşılmaz.
* **Simetrik (HS256, paylaşılan sır).** Eski projelerin biçimi. Doğrulama için
  projenin "JWT Secret" değeri gerekir.

Bu yüzden tek bir biçime bağlanmak yanlış olurdu: yalnızca HS256 desteklenseydi
bugün açılan bir Supabase projesinin ürettiği hiçbir token doğrulanamaz,
yalnızca JWKS desteklenseydi eski bir proje çalışmazdı. Hangi yolun
kullanılacağını **sunucunun kendi yapılandırması** belirler (aşağıya bakınız);
token'ın kendi `alg` başlığı **asla** bu seçimi etkilemez — etkileseydi bir
saldırgan algoritmayı kendi lehine değiştirebilirdi (algoritma karışıklığı
saldırısı).

Yapılandırma
------------
* `SUPABASE_URL` verilirse (ör. `https://abcd.supabase.co`) asimetrik yol
  kullanılır: JWKS adresi ve beklenen `iss` (issuer) değeri bundan türetilir.
* `SUPABASE_JWT_SECRET` verilirse HS256 yolu kullanılabilir.
* İkisi birden verilirse önce asimetrik denenir, olmazsa HS256'ya düşülür.
  Bu, Supabase'in eski sırdan yeni anahtarlara geçiş penceresi içindir: geçiş
  sırasında eski sırla imzalanmış, süresi henüz dolmamış token'lar dolaşımda
  kalır. İki yolun **ayrı anahtar malzemesi** kullanması sayesinde bu güvenlidir;
  herhangi bir anahtarın diğer algoritmada kullanılması söz konusu değildir.
* Hiçbiri verilmezse doğrulama yapılamaz ve istek reddedilir (yapılandırma
  hatası; sessizce kabul **edilmez**).
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import jwt as pyjwt
from jwt import PyJWKClient

#: Supabase proje adresi (ör. `https://abcd.supabase.co`). Verildiğinde
#: asimetrik (JWKS) doğrulama kullanılır ve beklenen issuer bundan türetilir.
SUPABASE_URL_ENV: str = "SUPABASE_URL"

#: Eski projelerin paylaşılan sırrı. Supabase panelinde "JWT Secret" adıyla
#: bulunur (Project Settings → API). Yalnızca HS256 imzalı token'lar için.
SUPABASE_JWT_SECRET_ENV: str = "SUPABASE_JWT_SECRET"

#: Supabase Auth'un ürettiği kullanıcı token'larında `aud` alanı bu değeri
#: taşır. Kontrol edilmesi, başka amaçla üretilmiş bir token'ın (ör. projenin
#: herkese açık `anon` anahtarı, ki o da aynı proje tarafından imzalanmış
#: geçerli bir JWT'dir) kullanıcı oturumu yerine geçmesini engeller.
SUPABASE_AUDIENCE: str = "authenticated"

#: Asimetrik imzalarda kabul edilen algoritmalar. Supabase RS256 (varsayılan)
#: ya da ES256 kullanır; liste sabittir ve token'dan okunmaz.
ASYMMETRIC_ALGORITHMS: List[str] = ["RS256", "ES256"]

#: Simetrik imzada kabul edilen tek algoritma.
SYMMETRIC_ALGORITHMS: List[str] = ["HS256"]

#: JWKS anahtar kümesinin önbellekte tutulacağı süre (saniye). Her istekte
#: ağa çıkılmaz; anahtarlar bir kez indirilip bu süre boyunca yeniden
#: kullanılır. Anahtar döndürüldüğünde (rotation) en geç bu süre sonunda
#: yeni anahtar alınır.
JWKS_CACHE_SECONDS: float = 600.0

#: JWKS indirme zaman aşımı. Kısa tutulur: kimlik doğrulama isteği,
#: ulaşılamayan bir uç yüzünden dakikalarca asılı kalmamalıdır.
JWKS_TIMEOUT_SECONDS: float = 5.0


class AuthConfigurationError(RuntimeError):
    """Doğrulama için gereken yapılandırma eksik.

    Bu bir istemci hatası değildir (401 değil): sunucunun yanlış
    yapılandırıldığını gösterir ve 500 olarak ele alınmalıdır. İkisini
    karıştırmak, yanlış yapılandırılmış bir sunucuyu "herkesin token'ı
    geçersiz" gibi gösterip gerçek nedeni gizlerdi.
    """


class AuthKeyUnavailableError(RuntimeError):
    """İmzalama anahtarları (JWKS) alınamadı.

    Geçici bir üst kaynak arızasıdır; 503 olarak ele alınır. **Hiçbir koşulda
    doğrulamayı atlamaya yol açmaz** — anahtar yoksa istek reddedilir.
    """


class AuthError(ValueError):
    """Token eksik, süresi dolmuş, imzası geçersiz ya da biçimi bozuk."""


@dataclass(frozen=True)
class AuthenticatedUser:
    """Doğrulanmış bir token'dan çıkarılan kimlik.

    Yalnızca token'ın kendisinden gelen bilgiyi taşır — organizasyon üyeliği
    burada yoktur, çünkü o veritabanı bilgisidir ve bu modülün kapsamı
    dışındadır.
    """

    user_id: str
    email: Optional[str]


@dataclass(frozen=True)
class JwtConfig:
    """Sunucunun token doğrulama yapılandırması.

    `jwks_url` doluysa asimetrik yol, `secret` doluysa simetrik yol
    kullanılabilir. İkisi de boşsa doğrulama yapılamaz.
    """

    jwks_url: Optional[str]
    issuer: Optional[str]
    secret: Optional[str]

    @property
    def can_verify(self) -> bool:
        return bool(self.jwks_url or self.secret)


def resolve_config() -> JwtConfig:
    """Ortam değişkenlerinden doğrulama yapılandırmasını çözer.

    Raises:
        AuthConfigurationError: Ne `SUPABASE_URL` ne `SUPABASE_JWT_SECRET`
            tanımlıysa. Sessizce "doğrulama yok" moduna düşmek, kimlik
            doğrulamayı tümüyle devre dışı bırakmak olurdu.
    """
    base_url = os.environ.get(SUPABASE_URL_ENV, "").strip().rstrip("/")
    secret = os.environ.get(SUPABASE_JWT_SECRET_ENV, "").strip()

    jwks_url = f"{base_url}/auth/v1/.well-known/jwks.json" if base_url else None
    issuer = f"{base_url}/auth/v1" if base_url else None

    config = JwtConfig(jwks_url=jwks_url, issuer=issuer, secret=secret or None)
    if not config.can_verify:
        raise AuthConfigurationError(
            f"Kimlik dogrulama yapilandirilmamis: {SUPABASE_URL_ENV} (asimetrik, "
            f"onerilen) ya da {SUPABASE_JWT_SECRET_ENV} (eski projeler icin) "
            f"tanimli olmalidir."
        )
    return config


# --------------------------------------------------------------------------- #
# JWKS istemcisi (önbellekli)
# --------------------------------------------------------------------------- #

_jwks_clients: Dict[str, PyJWKClient] = {}
_jwks_lock = threading.Lock()


def get_jwks_client(jwks_url: str) -> PyJWKClient:
    """Adres başına tek bir önbellekli JWKS istemcisi döndürür.

    İstemci anahtar kümesini kendi içinde önbelleğe alır; her doğrulamada ağa
    çıkılmaz. Süreç genelinde tek örnek tutulması, `uvicorn`'un iş
    parçacıklarından gelen eşzamanlı isteklerin aynı önbelleği paylaşmasını
    sağlar — aksi hâlde her istek kendi kümesini indirirdi.
    """
    with _jwks_lock:
        client = _jwks_clients.get(jwks_url)
        if client is None:
            client = PyJWKClient(
                jwks_url,
                cache_jwk_set=True,
                lifespan=JWKS_CACHE_SECONDS,
                timeout=JWKS_TIMEOUT_SECONDS,
            )
            _jwks_clients[jwks_url] = client
        return client


def reset_jwks_cache() -> None:
    """Önbelleğe alınmış JWKS istemcilerini temizler (testler için)."""
    with _jwks_lock:
        _jwks_clients.clear()


# --------------------------------------------------------------------------- #
# Doğrulama
# --------------------------------------------------------------------------- #


def _extract_user(payload: Dict[str, Any]) -> AuthenticatedUser:
    """Doğrulanmış yükten kimliği çıkarır."""
    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        # Supabase'in `anon` / `service_role` anahtarlari da ayni proje
        # tarafindan imzalanmis gecerli JWT'lerdir ama `sub` tasimazlar.
        # Bu kontrol, boyle bir anahtarin kullanici oturumu yerine
        # gecirilmesini engeller.
        raise AuthError("Token 'sub' (kullanici kimligi) alani tasimiyor.")

    email = payload.get("email")
    if email is not None and not isinstance(email, str):
        email = None

    return AuthenticatedUser(user_id=user_id, email=email)


def _decode_options(config: JwtConfig) -> Dict[str, Any]:
    """PyJWT çözümleme seçenekleri.

    `require`, alanların **varlığını** zorunlu kılar; `verify_*` bayrakları
    değerlerinin doğrulanmasını sağlar. İkisi ayrı ayrı verilir çünkü PyJWT
    eksik bir alanı varsayılan olarak "doğrulanacak bir şey yok" sayar —
    `exp` alanı hiç olmayan bir token, `require` olmadan süresiz kabul
    edilirdi.
    """
    required = ["exp", "sub", "aud"]
    if config.issuer:
        required.append("iss")
    return {"require": required, "verify_aud": True, "verify_exp": True}


def _decode_asymmetric(token: str, config: JwtConfig) -> Dict[str, Any]:
    """JWKS'ten alınan herkese açık anahtarla imzayı doğrular."""
    assert config.jwks_url is not None
    try:
        signing_key = get_jwks_client(config.jwks_url).get_signing_key_from_jwt(token)
    except pyjwt.PyJWKClientError as error:
        # Token'in `kid` degeri anahtar kumesinde yok: gecersiz ya da baska bir
        # projeye ait bir token. Bu bir istemci hatasidir.
        raise AuthError(f"Token imzalama anahtari taninmadi: {error}") from error
    except Exception as error:  # ağ hatası, zaman aşımı, bozuk JWKS yanıtı
        # Anahtarlar alinamadi: dogrulama YAPILAMAZ, dolayisiyla istek
        # reddedilir. Hicbir kosulda "dogrulamayi atla" davranisi yoktur.
        raise AuthKeyUnavailableError(
            f"Imzalama anahtarlari alinamadi ({config.jwks_url}): {error}"
        ) from error

    return pyjwt.decode(
        token,
        signing_key.key,
        algorithms=ASYMMETRIC_ALGORITHMS,
        audience=SUPABASE_AUDIENCE,
        issuer=config.issuer,
        options=_decode_options(config),
    )


def _decode_symmetric(token: str, config: JwtConfig) -> Dict[str, Any]:
    """Paylaşılan sırla (HS256) imzayı doğrular."""
    assert config.secret is not None
    return pyjwt.decode(
        token,
        config.secret,
        algorithms=SYMMETRIC_ALGORITHMS,
        audience=SUPABASE_AUDIENCE,
        issuer=config.issuer,
        options=_decode_options(config),
    )


def decode_access_token(token: str, config: JwtConfig) -> AuthenticatedUser:
    """Bir Supabase erişim token'ını doğrular ve kullanıcı kimliğini çıkarır.

    İmza, son kullanma zamanı (`exp`), hedef kitle (`aud`) ve —yapılandırmada
    `SUPABASE_URL` varsa— yayıncı (`iss`) doğrulanır. Kabul edilen algoritmalar
    **sunucunun yapılandırmasından** belirlenir, token'ın `alg` başlığından
    değil; `alg: none` ile imzasız bir token bu yüzden hiçbir yolda kabul
    edilmez.

    Args:
        token: `Authorization: Bearer <token>` başlığından alınan ham metin.
        config: `resolve_config()` ile çözülmüş yapılandırma.

    Raises:
        AuthError: Token her ne sebeple olursa olsun geçersizse. Tek bir hata
            türü altında toplanması bilinçlidir — çağıran taraf (HTTP katmanı)
            hepsini aynı şekilde 401'e çevirir; süresi dolmuş bir token ile
            sahte bir imza arasındaki ayrım son kullanıcı için anlamsızdır ve
            saldırgana hangi denemenin daha "yakın" olduğunu söylemek güvenlik
            açısından istenmez.
        AuthKeyUnavailableError: JWKS alınamadıysa (503).
        AuthConfigurationError: Hiçbir doğrulama yolu yapılandırılmamışsa.
    """
    if not config.can_verify:
        raise AuthConfigurationError(
            "Kimlik dogrulama yapilandirilmamis; token dogrulanamaz."
        )

    last_error: Optional[Exception] = None

    if config.jwks_url:
        try:
            return _extract_user(_decode_asymmetric(token, config))
        except AuthKeyUnavailableError:
            # Anahtar kumesi alinamadi. HS256 yapilandirilmissa gecis
            # penceresi icin ona dusulur; degilse hata yukari verilir ve
            # istek 503 ile reddedilir.
            if not config.secret:
                raise
        except pyjwt.PyJWTError as error:
            if not config.secret:
                raise AuthError(
                    f"Gecersiz veya suresi dolmus oturum: {error}"
                ) from error
            last_error = error
        except AuthError:
            if not config.secret:
                raise
            last_error = None

    if config.secret:
        try:
            return _extract_user(_decode_symmetric(token, config))
        except pyjwt.PyJWTError as error:
            raise AuthError(f"Gecersiz veya suresi dolmus oturum: {error}") from error

    raise AuthError(
        f"Gecersiz veya suresi dolmus oturum: {last_error}"
        if last_error
        else "Gecersiz veya suresi dolmus oturum."
    )
