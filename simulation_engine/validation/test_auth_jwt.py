"""Supabase erişim token'larının doğrulanması — `auth/jwt.py`.

Bu dosya HTTP katmanına hiç dokunmaz: token üretir (gerçek bir Supabase
projesi yerine test anahtarlarıyla) ve `decode_access_token`'ın doğru kabul
edip reddettiğini sınar.

İki imzalama biçimi de sınanır çünkü ikisi de gerçekte kullanılır:
asimetrik (RS256/ES256, JWKS) 1 Mayıs 2025'ten sonra açılan Supabase
projelerinin varsayılanıdır; simetrik (HS256) eski projelerin biçimidir.
Yalnızca biri sınansaydı, diğer biçimi kullanan bir projede kimlik doğrulama
tümüyle çalışmaz ve bu ancak canlıda fark edilirdi.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from simulation_engine.auth.jwt import (
    SUPABASE_AUDIENCE,
    AuthConfigurationError,
    AuthError,
    AuthKeyUnavailableError,
    JwtConfig,
    decode_access_token,
    reset_jwks_cache,
    resolve_config,
)

SECRET = "test-secret-yalnizca-testler-icin-en-az-otuz-iki-bayt"
OTHER_SECRET = "farkli-bir-sir-bu-da-en-az-otuz-iki-bayt-uzunlugunda"

PROJECT_URL = "https://testproject.supabase.co"
ISSUER = f"{PROJECT_URL}/auth/v1"
JWKS_URL = f"{PROJECT_URL}/auth/v1/.well-known/jwks.json"

SYMMETRIC_CONFIG = JwtConfig(jwks_url=None, issuer=ISSUER, secret=SECRET)


# --------------------------------------------------------------------------- #
# Anahtar ve token yardımcıları
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def rsa_key():
    """Asimetrik testler için tek seferlik bir RSA anahtar çifti."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def claims(
    *,
    sub: Optional[str] = "11111111-1111-1111-1111-111111111111",
    email: Optional[str] = "kagan@example.com",
    audience: Optional[str] = SUPABASE_AUDIENCE,
    issuer: Optional[str] = ISSUER,
    expires_in_seconds: float = 3600,
) -> Dict[str, Any]:
    """Supabase'in ürettiğine benzer bir yük oluşturur."""
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "exp": now + timedelta(seconds=expires_in_seconds),
        "iat": now,
    }
    if sub is not None:
        payload["sub"] = sub
    if email is not None:
        payload["email"] = email
    if audience is not None:
        payload["aud"] = audience
    if issuer is not None:
        payload["iss"] = issuer
    return payload


def hs256(secret: str = SECRET, **overrides: Any) -> str:
    return pyjwt.encode(claims(**overrides), secret, algorithm="HS256")


def rs256(private_key, *, kid: str = "test-key-1", **overrides: Any) -> str:
    return pyjwt.encode(
        claims(**overrides), private_key, algorithm="RS256", headers={"kid": kid}
    )


def jwks_document(private_key, *, kid: str = "test-key-1") -> Dict[str, Any]:
    """Anahtar çiftinin herkese açık yarısını JWKS biçiminde döndürür."""
    public_jwk = json.loads(pyjwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    public_jwk.update({"kid": kid, "use": "sig", "alg": "RS256"})
    return {"keys": [public_jwk]}


@pytest.fixture
def asymmetric_config(rsa_key, monkeypatch: pytest.MonkeyPatch) -> JwtConfig:
    """JWKS'i ağa çıkmadan sunan bir asimetrik yapılandırma.

    `PyJWKClient`'ın ağ çağrısı, yerel bir belge döndürecek biçimde
    değiştirilir; testler gerçek bir Supabase projesine bağımlı olmamalıdır.
    """
    reset_jwks_cache()
    document = jwks_document(rsa_key)

    def fake_fetch(self, refresh: bool = False):  # noqa: ANN001 - imza PyJWKClient'a ait
        return pyjwt.PyJWKSet.from_dict(document)

    monkeypatch.setattr(pyjwt.PyJWKClient, "get_jwk_set", fake_fetch)
    yield JwtConfig(jwks_url=JWKS_URL, issuer=ISSUER, secret=None)
    reset_jwks_cache()


# --------------------------------------------------------------------------- #
# 1. Yapılandırmanın çözülmesi
# --------------------------------------------------------------------------- #


def test_supabase_url_selects_asymmetric_verification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`SUPABASE_URL` verildiginde JWKS adresi ve issuer ondan turetilir."""
    monkeypatch.setenv("SUPABASE_URL", PROJECT_URL)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)

    config = resolve_config()
    assert config.jwks_url == JWKS_URL
    assert config.issuer == ISSUER
    assert config.secret is None


def test_trailing_slash_in_url_is_tolerated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", f"{PROJECT_URL}/")
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    assert resolve_config().jwks_url == JWKS_URL


def test_secret_only_selects_symmetric_verification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)

    config = resolve_config()
    assert config.jwks_url is None
    assert config.secret == SECRET


def test_missing_configuration_is_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hicbir yapilandirma yoksa sessizce 'dogrulama yok' moduna dusulmez."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    with pytest.raises(AuthConfigurationError):
        resolve_config()


def test_unconfigured_config_refuses_to_decode() -> None:
    empty = JwtConfig(jwks_url=None, issuer=None, secret=None)
    with pytest.raises(AuthConfigurationError):
        decode_access_token(hs256(), empty)


# --------------------------------------------------------------------------- #
# 2. Asimetrik (RS256 / JWKS) — yeni projelerin varsayılanı
# --------------------------------------------------------------------------- #


def test_valid_rs256_token_is_accepted(rsa_key, asymmetric_config: JwtConfig) -> None:
    user = decode_access_token(rs256(rsa_key), asymmetric_config)
    assert user.user_id == "11111111-1111-1111-1111-111111111111"
    assert user.email == "kagan@example.com"


def test_rs256_token_signed_by_another_key_is_rejected(
    asymmetric_config: JwtConfig,
) -> None:
    """Baska bir anahtarla imzalanan token, `kid` ayni olsa da reddedilir."""
    attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = rs256(attacker_key)
    with pytest.raises(AuthError):
        decode_access_token(forged, asymmetric_config)


def test_rs256_unknown_kid_is_rejected(rsa_key, asymmetric_config: JwtConfig) -> None:
    with pytest.raises(AuthError):
        decode_access_token(rs256(rsa_key, kid="bilinmeyen"), asymmetric_config)


def test_hs256_token_is_rejected_when_only_asymmetric_is_configured(
    asymmetric_config: JwtConfig,
) -> None:
    """Algoritma karisikligi: HS256 token asimetrik yapilandirmada gecmemeli.

    Saldirgan, herkese acik anahtari HMAC sirri gibi kullanip HS256 token
    uretmeye calisabilir. Kabul edilen algoritmalar sunucunun
    yapilandirmasindan geldigi icin bu yol kapalidir.
    """
    with pytest.raises(AuthError):
        decode_access_token(hs256(), asymmetric_config)


def test_expired_rs256_token_is_rejected(
    rsa_key, asymmetric_config: JwtConfig
) -> None:
    with pytest.raises(AuthError):
        decode_access_token(rs256(rsa_key, expires_in_seconds=-10), asymmetric_config)


def test_wrong_issuer_is_rejected_asymmetric(
    rsa_key, asymmetric_config: JwtConfig
) -> None:
    """Baska bir Supabase projesinin token'i kabul edilmemeli."""
    with pytest.raises(AuthError):
        decode_access_token(
            rs256(rsa_key, issuer="https://baskaproje.supabase.co/auth/v1"),
            asymmetric_config,
        )


def test_missing_issuer_is_rejected_asymmetric(
    rsa_key, asymmetric_config: JwtConfig
) -> None:
    with pytest.raises(AuthError):
        decode_access_token(rs256(rsa_key, issuer=None), asymmetric_config)


def test_wrong_audience_is_rejected_asymmetric(
    rsa_key, asymmetric_config: JwtConfig
) -> None:
    with pytest.raises(AuthError):
        decode_access_token(rs256(rsa_key, audience="storage"), asymmetric_config)


def test_missing_subject_is_rejected_asymmetric(
    rsa_key, asymmetric_config: JwtConfig
) -> None:
    """`sub` tasimayan token (or. projenin `anon` anahtari) reddedilmeli."""
    with pytest.raises(AuthError):
        decode_access_token(rs256(rsa_key, sub=None), asymmetric_config)


def test_unreachable_jwks_fails_closed(rsa_key, monkeypatch: pytest.MonkeyPatch) -> None:
    """Anahtarlar alinamiyorsa istek reddedilir; dogrulama ATLANMAZ.

    Bu, tum kimlik dogrulamanin en kritik basarisizlik modudur: ag hatasinda
    "gecici olarak herkesi iceri al" davranisi, kimlik dogrulamayi tumuyle
    devre disi birakmak olurdu.
    """
    reset_jwks_cache()

    def explode(self, refresh: bool = False):  # noqa: ANN001
        raise ConnectionError("JWKS ucuna ulasilamadi")

    monkeypatch.setattr(pyjwt.PyJWKClient, "get_jwk_set", explode)
    config = JwtConfig(jwks_url=JWKS_URL, issuer=ISSUER, secret=None)

    with pytest.raises(AuthKeyUnavailableError):
        decode_access_token(rs256(rsa_key), config)
    reset_jwks_cache()


# --------------------------------------------------------------------------- #
# 3. Simetrik (HS256) — eski projeler
# --------------------------------------------------------------------------- #


def test_valid_hs256_token_is_accepted() -> None:
    user = decode_access_token(hs256(), SYMMETRIC_CONFIG)
    assert user.user_id == "11111111-1111-1111-1111-111111111111"
    assert user.email == "kagan@example.com"


def test_token_without_email_is_accepted() -> None:
    """Yalnızca telefonla kayıtlı bir kullanıcının `email` alanı olmayabilir."""
    assert decode_access_token(hs256(email=None), SYMMETRIC_CONFIG).email is None


def test_expired_token_is_rejected() -> None:
    with pytest.raises(AuthError):
        decode_access_token(hs256(expires_in_seconds=-10), SYMMETRIC_CONFIG)


def test_wrong_secret_is_rejected() -> None:
    with pytest.raises(AuthError):
        decode_access_token(hs256(secret=OTHER_SECRET), SYMMETRIC_CONFIG)


def test_wrong_audience_is_rejected() -> None:
    with pytest.raises(AuthError):
        decode_access_token(hs256(audience="storage"), SYMMETRIC_CONFIG)


def test_missing_audience_is_rejected() -> None:
    with pytest.raises(AuthError):
        decode_access_token(hs256(audience=None), SYMMETRIC_CONFIG)


def test_wrong_issuer_is_rejected() -> None:
    with pytest.raises(AuthError):
        decode_access_token(
            hs256(issuer="https://baskaproje.supabase.co/auth/v1"), SYMMETRIC_CONFIG
        )


def test_issuer_is_not_checked_when_not_configured() -> None:
    """Issuer beklentisi yoksa (yalnizca sir verilmisse) `iss` zorunlu degildir.

    `SUPABASE_URL` verilmeyen eski kurulumlarda beklenen issuer bilinemez;
    uydurmak yerine denetim atlanir. Bu bilincli bir odundur ve sirrin zaten
    projeye ozel olmasiyla sinirlanir.
    """
    legacy = JwtConfig(jwks_url=None, issuer=None, secret=SECRET)
    assert decode_access_token(hs256(issuer=None), legacy).user_id


def test_missing_subject_is_rejected() -> None:
    with pytest.raises(AuthError):
        decode_access_token(hs256(sub=None), SYMMETRIC_CONFIG)


def test_missing_expiry_is_rejected() -> None:
    token = pyjwt.encode(
        {"sub": "u1", "aud": SUPABASE_AUDIENCE, "iss": ISSUER},
        SECRET,
        algorithm="HS256",
    )
    with pytest.raises(AuthError):
        decode_access_token(token, SYMMETRIC_CONFIG)


def test_malformed_token_is_rejected() -> None:
    with pytest.raises(AuthError):
        decode_access_token("bu-bir-jwt-degil", SYMMETRIC_CONFIG)


def test_empty_token_is_rejected() -> None:
    with pytest.raises(AuthError):
        decode_access_token("", SYMMETRIC_CONFIG)


def test_none_algorithm_is_rejected() -> None:
    """'none' algoritmasıyla imzasız bir token asla kabul edilmemeli.

    Bu, JWT kütüphanelerinde tarihsel olarak en ciddi güvenlik açığıdır:
    algoritma denetimi istemciden geliyorsa, bir saldırgan `alg: none` ile
    imzasız bir token üretip herhangi bir kullanıcı gibi davranabilir.
    Kabul edilen algoritmalar sunucunun yapılandırmasından geldiği için bu
    kapalıdır; test bunu açıkça kilitler.
    """
    forged = pyjwt.encode(claims(sub="saldirgan"), key="", algorithm="none")
    with pytest.raises(AuthError):
        decode_access_token(forged, SYMMETRIC_CONFIG)


def test_none_algorithm_is_rejected_asymmetric(asymmetric_config: JwtConfig) -> None:
    forged = pyjwt.encode(claims(sub="saldirgan"), key="", algorithm="none")
    with pytest.raises(AuthError):
        decode_access_token(forged, asymmetric_config)


def test_email_of_wrong_type_is_ignored_not_trusted() -> None:
    """`email` alani beklenmedik bir tipte gelirse sessizce yok sayilir.

    Bu alan yalnızca **görüntüleme** amaçlıdır; yetkilendirme `user_id`
    (`sub`) üzerinden yürür.
    """
    payload = claims()
    payload["email"] = ["liste", "olamaz"]
    token = pyjwt.encode(payload, SECRET, algorithm="HS256")
    assert decode_access_token(token, SYMMETRIC_CONFIG).email is None


# --------------------------------------------------------------------------- #
# 4. Geçiş penceresi: iki yapılandırma birden
# --------------------------------------------------------------------------- #


def test_both_configured_accepts_asymmetric(
    rsa_key, asymmetric_config: JwtConfig
) -> None:
    """Ikisi de yapilandirildiginda asimetrik token kabul edilir."""
    both = JwtConfig(
        jwks_url=asymmetric_config.jwks_url, issuer=ISSUER, secret=SECRET
    )
    assert decode_access_token(rs256(rsa_key), both).user_id


def test_both_configured_falls_back_to_symmetric(
    rsa_key, asymmetric_config: JwtConfig
) -> None:
    """Gecis penceresinde eski sirla imzalanmis token'lar da calismali.

    Supabase yeni anahtarlara gecerken, eski sirla imzalanmis ve suresi henuz
    dolmamis token'lar bir sure dolasimda kalir; ikisi de yapilandirilmissa
    ikisi de kabul edilir.
    """
    both = JwtConfig(
        jwks_url=asymmetric_config.jwks_url, issuer=ISSUER, secret=SECRET
    )
    assert decode_access_token(hs256(), both).user_id


def test_both_configured_still_rejects_a_forged_token(
    asymmetric_config: JwtConfig,
) -> None:
    """Iki yol acikken bile yanlis sirla imzalanan token reddedilir."""
    both = JwtConfig(
        jwks_url=asymmetric_config.jwks_url, issuer=ISSUER, secret=SECRET
    )
    with pytest.raises(AuthError):
        decode_access_token(hs256(secret=OTHER_SECRET), both)
