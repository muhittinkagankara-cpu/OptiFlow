"""API güvenlik sertleştirmesi: hız sınırı, başlıklar, boyut sınırı.

Hız sınırı neden gerekli
------------------------
Kimlik doğrulaması olan bir API bile sınırsız istek kabul ediyorsa, çalınmış
tek bir token ile veritabanı saniyede binlerce sorguyla meşgul edilebilir.
Sınır, kötü niyet olmadan da gereklidir: hatalı bir istemci döngüsü aynı
etkiyi yaratır.

Neden sabit pencere değil, jeton kovası
---------------------------------------
Sabit pencerede sınır, pencerenin başında ve sonunda iki katına çıkabilir
(dakikanın son saniyesinde 60, ilk saniyesinde 60 → iki saniyede 120). Jeton
kovası akışı düzler ve ani yüklere (burst) sınırlı ama gerçek bir pay bırakır.

Sayaç neden kimlik başına
-------------------------
IP başına sınırlamak, aynı fabrikadan bağlanan bütün operatörleri tek bir
kotaya sıkıştırırdı. Kimliği bilinen istekler kullanıcı başına, bilinmeyenler
IP başına sayılır.

Bu modül saf: saat dışarıdan verilir ve hiçbir HTTP nesnesi bilinmez.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Dict, Optional, Tuple

#: Varsayılan sınır: dakikada kaç istek.
DEFAULT_RATE_PER_MINUTE = 120

#: Ani yükte izin verilen en fazla istek (kova kapasitesi).
#:
#: Sınırın dörtte biri: bir ekranın açılışta beş-altı uç birden çağırması
#: normaldir ve engellenmemelidir; yüzlerce istek ise değildir.
DEFAULT_BURST = 30

#: Yazma uçları için daha dar sınır.
#:
#: Okuma isteği bir sorgu çalıştırır; yazma isteği veritabanına yazar, olay
#: üretir ve cihazla konuşabilir. İkisini aynı kotaya koymak, pahalı işlemi
#: ucuz olanla aynı sıklıkta yapılabilir kılardı.
WRITE_RATE_PER_MINUTE = 30

#: İstek gövdesinin üst sınırı (bayt).
#:
#: Bir megabayt, en büyük fabrika modelinin birkaç katıdır. Sınırsız gövde,
#: tek bir istekle sunucunun belleğini doldurmanın en kolay yoludur.
MAX_REQUEST_BYTES = 1024 * 1024

#: Yanıtlara eklenen güvenlik başlıkları.
#:
#: Her biri belirli bir saldırıyı kapatır ve hiçbiri uygulamayı kısıtlamaz:
#: API yanıtları HTML değildir, çerçevelenmez ve gömülü betik çalıştırmaz.
SECURITY_HEADERS: Dict[str, str] = {
    # Tarayıcı, sunucunun bildirdiği içerik türünü tahmin etmeye çalışmasın:
    # JSON olarak dönen bir yanıtın HTML sanılıp çalıştırılması engellenir.
    "X-Content-Type-Options": "nosniff",
    # API yanıtı hiçbir sayfada çerçevelenmemeli (tıklama hırsızlığı).
    "X-Frame-Options": "DENY",
    # Yönlendirmelerde tam adresin dış siteye sızmaması için.
    "Referrer-Policy": "no-referrer",
    # API'nin kamera, mikrofon ya da konum istemesi için hiçbir neden yok.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    # API yanıtı hiçbir kaynağı yüklemez; en dar politika uygulanır.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}

#: HTTPS zorlaması yalnızca üretimde eklenir.
#:
#: Geliştirmede eklenirse tarayıcı `localhost`'u da HTTPS'e zorlar ve yerel
#: kurulum çalışmaz hâle gelir.
HSTS_HEADER = ("Strict-Transport-Security", "max-age=31536000; includeSubDomains")


@dataclass
class TokenBucket:
    """Jeton kovası: sabit hızda dolar, her istek bir jeton harcar."""

    capacity: int
    refill_per_second: float
    tokens: float = 0.0
    last_refill_ms: int = 0

    def __post_init__(self) -> None:
        self.capacity = max(1, int(self.capacity))
        self.refill_per_second = max(0.001, float(self.refill_per_second))
        if self.tokens <= 0:
            # Kova dolu başlar: ilk isteği reddetmek, kotayı kullanmadan
            # cezalandırmak olurdu.
            self.tokens = float(self.capacity)

    def _refill(self, now_ms: int) -> None:
        if self.last_refill_ms == 0:
            self.last_refill_ms = now_ms
            return
        elapsed = max(0, now_ms - self.last_refill_ms)
        if elapsed == 0:
            return
        self.tokens = min(
            float(self.capacity),
            self.tokens + (elapsed / 1000) * self.refill_per_second,
        )
        self.last_refill_ms = now_ms

    def allow(self, now_ms: int) -> bool:
        """Bir jeton harcamayı dener."""
        self._refill(now_ms)
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True

    def retry_after_seconds(self, now_ms: int) -> int:
        """Bir sonraki jetona kalan süre (sn); en az 1.

        Sıfır dönmek, istemciye "hemen yeniden dene" demek ve sınırı
        anlamsız kılmak olurdu.
        """
        self._refill(now_ms)
        if self.tokens >= 1:
            return 0
        missing = 1 - self.tokens
        return max(1, int(missing / self.refill_per_second) + 1)


@dataclass
class RateLimiter:
    """Kimlik başına jeton kovası tutar."""

    rate_per_minute: int = DEFAULT_RATE_PER_MINUTE
    burst: int = DEFAULT_BURST
    clock: Callable[[], int] = lambda: int(time.time() * 1000)
    buckets: Dict[str, TokenBucket] = field(default_factory=dict)
    #: Reddedilen istek sayısı; Monitoring ekranı bunu gösterir.
    rejected: int = 0
    allowed: int = 0

    def _bucket(self, key: str) -> TokenBucket:
        bucket = self.buckets.get(key)
        if bucket is None:
            bucket = TokenBucket(
                capacity=self.burst,
                refill_per_second=self.rate_per_minute / 60,
            )
            self.buckets[key] = bucket
        return bucket

    def check(self, key: str, now_ms: Optional[int] = None) -> Tuple[bool, int]:
        """İsteğe izin verilir mi? `(izin, kaç saniye sonra)`."""
        moment = now_ms if now_ms is not None else self.clock()
        bucket = self._bucket(key)
        if bucket.allow(moment):
            self.allowed += 1
            return True, 0
        self.rejected += 1
        return False, bucket.retry_after_seconds(moment)

    def stats(self) -> Dict[str, object]:
        return {
            "allowed": self.allowed,
            "rejected": self.rejected,
            "tracked_clients": len(self.buckets),
            "rate_per_minute": self.rate_per_minute,
            "burst": self.burst,
        }

    def reset(self) -> None:
        self.buckets.clear()
        self.rejected = 0
        self.allowed = 0


def client_key(
    authorization: Optional[str], client_host: Optional[str]
) -> str:
    """İsteği sayacak anahtar.

    Kimlik varsa token'ın **özeti** kullanılır; token'ın kendisi hiçbir yerde
    saklanmaz. Kimlik yoksa IP'ye düşülür; ikisi de yoksa ortak bir kovaya
    girilir — anahtarsız istekler sınırsız olmamalıdır.
    """
    if authorization:
        import hashlib

        digest = hashlib.sha256(authorization.encode("utf-8")).hexdigest()
        return f"user:{digest[:32]}"
    if client_host:
        return f"ip:{client_host}"
    return "anonim"


def is_write_method(method: str) -> bool:
    """Bu yöntem yazma mı? Yazma uçlarının kotası daha dardır."""
    return method.upper() in {"POST", "PUT", "PATCH", "DELETE"}


def exceeds_size_limit(
    content_length: Optional[str], limit: int = MAX_REQUEST_BYTES
) -> bool:
    """Gövde sınırı aşıyor mu?

    Başlık okunamıyorsa **aşmıyor** sayılır: uzunluk bildirmeyen bir istek
    (chunked) burada reddedilemez; onu sunucunun kendi sınırı durdurur.
    """
    if not content_length:
        return False
    try:
        return int(content_length) > limit
    except (TypeError, ValueError):
        return False


def security_headers(production: bool) -> Dict[str, str]:
    """Yanıta eklenecek başlıklar."""
    headers = dict(SECURITY_HEADERS)
    if production:
        headers[HSTS_HEADER[0]] = HSTS_HEADER[1]
    return headers
