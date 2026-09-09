"""Sağlık ve hazırlık.

İkisi farklı sorulardır ve karıştırılırsa dağıtım bozulur:

* **Sağlık (`/api/health`)** — "bu süreç ayakta mı?" Yanıtı neredeyse her zaman
  evettir; hayır olduğunda düzenleyici (orchestrator) kapsayıcıyı yeniden
  başlatır. Bu yüzden sağlık ucu **hiçbir bağımlılığı yoklamaz**: veritabanı
  geçici olarak yanıt vermediğinde kapsayıcıyı yeniden başlatmak sorunu
  çözmez, yalnızca hizmeti büsbütün kaybettirir.
* **Hazırlık (`/api/ready`)** — "bu sürece istek gönderilebilir mi?" Yanıt
  hayırsa yük dengeleyici o örneğe trafik vermez ama kapsayıcı yaşamayı
  sürdürür. Veritabanı ve yapılandırma burada yoklanır.

Bu ayrım olmasaydı, veritabanı bir dakikalığına yavaşladığında bütün
kapsayıcılar sırayla yeniden başlar ve kesinti dakikalarca sürerdi.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from simulation_engine.runtime.ops.environment import (
    EnvironmentReport,
    check_environment,
)


@dataclass(frozen=True)
class DependencyCheck:
    """Tek bir bağımlılığın durumu."""

    name: str
    ok: bool
    detail: str
    #: Ölçülen süre (ms); ölçülemediyse `None`.
    latency_ms: Optional[float] = None

    def to_dict(self) -> Dict[str, object]:
        return {
            "name": self.name,
            "ok": self.ok,
            "detail": self.detail,
            "latency_ms": self.latency_ms,
        }


def check_database(repository: Any, clock: Callable[[], float] = time.perf_counter) -> DependencyCheck:
    """Veritabanına gerçek bir sorgu atar.

    Yalnızca nesnenin var olmasına bakmak yetmez: bir bağlantı havuzu, hedef
    sunucu kapalıyken de nesne olarak durur. "Hazır" demek için gerçekten
    okumak gerekir.
    """
    if repository is None:
        return DependencyCheck(
            name="database",
            ok=False,
            detail="Depo kurulmadı.",
        )

    if not getattr(repository, "is_persistent", False):
        # Bellek deposu bir arıza değildir; yalnızca kalıcı değildir.
        return DependencyCheck(
            name="database",
            ok=True,
            detail="Bellek deposu kullanılıyor; veriler yeniden başlatmada kaybolur.",
        )

    started = clock()
    try:
        repository.known_orgs()
    except Exception as error:  # noqa: BLE001
        return DependencyCheck(
            name="database",
            ok=False,
            detail=f"Veritabanı okunamadı: {error}",
        )
    return DependencyCheck(
        name="database",
        ok=True,
        detail="Veritabanı yanıt verdi.",
        latency_ms=round((clock() - started) * 1000, 2),
    )


def check_configuration(report: EnvironmentReport) -> DependencyCheck:
    """Ortam yapılandırmasını değerlendirir."""
    if report.ok:
        return DependencyCheck(
            name="configuration",
            ok=True,
            detail=(
                f"{report.environment} ortamı; {len(report.warnings)} uyarı."
                if report.warnings
                else f"{report.environment} ortamı; eksik yok."
            ),
        )
    missing = ", ".join(item.key for item in report.errors)
    return DependencyCheck(
        name="configuration",
        ok=False,
        detail=f"Eksik ya da hatalı ayar: {missing}",
    )


@dataclass
class HealthService:
    """Sağlık ve hazırlık yanıtlarını üretir."""

    version: str
    metrics: Any
    repository: Any = None
    env: Optional[Dict[str, str]] = None
    #: Süreç kapanışa geçtiğinde `False` olur; hazırlık bunu okur.
    accepting: bool = True

    def health(self, now_ms: Optional[int] = None) -> Dict[str, object]:
        """Canlılık yanıtı: süreç ayakta mı?

        Bağımlılık yoklanmaz (bkz. modül başlığı).
        """
        return {
            "status": "ok",
            "version": self.version,
            "uptime_ms": self.metrics.uptime_ms(now_ms),
        }

    def readiness(self, now_ms: Optional[int] = None) -> Dict[str, object]:
        """Hazırlık yanıtı: bu sürece istek gönderilebilir mi?"""
        report = check_environment(self.env)
        checks: List[DependencyCheck] = [
            check_configuration(report),
            check_database(self.repository),
        ]

        if not self.accepting:
            checks.append(
                DependencyCheck(
                    name="shutdown",
                    ok=False,
                    detail="Süreç kapanıyor; yeni istek kabul edilmiyor.",
                )
            )

        ready = all(item.ok for item in checks)
        return {
            "ready": ready,
            "version": self.version,
            "uptime_ms": self.metrics.uptime_ms(now_ms),
            "environment": report.environment,
            "checks": [item.to_dict() for item in checks],
            "warnings": [item.to_dict() for item in report.warnings],
        }

    def begin_shutdown(self) -> None:
        """Zarif kapanışı başlatır.

        Süreç hemen ölmez: hazırlık ucu `false` dönmeye başlar, yük
        dengeleyici yeni istek göndermeyi bırakır ve süren istekler bitirilir.
        Hemen ölseydi, o anda işlenen istekler yarıda kalırdı.
        """
        self.accepting = False
