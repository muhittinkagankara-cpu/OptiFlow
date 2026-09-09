"""Ortam doğrulaması.

Yayına alınan bir sunucunun eksik bir ortam değişkeniyle **sessizce** açılması,
üretimde en pahalı hata türüdür: uygulama çalışır görünür, kullanıcı giriş
yapamaz ya da veriler diske hiç yazılmaz ve bu ancak günler sonra fark edilir.

Bu modül, açılışta ortamı denetler ve iki tür bulgu üretir:

* **Hata** — bu ayar olmadan sunucu görevini yapamaz (ör. kimlik doğrulama
  yapılandırması). Hata varsa `ready` **false** döner ve yük dengeleyici bu
  örneğe istek göndermez.
* **Uyarı** — çalışır ama bir yeteneği eksik olur (ör. `DATABASE_URL` yoksa
  veriler yeniden başlatmada kaybolur). Uyarı sunucuyu durdurmaz; sessiz de
  kalmaz.

Ayrım bilinçlidir: her eksikliği hata saymak, yerel geliştirmeyi imkânsız
kılardı; hiçbirini saymamak ise yanlış yapılandırılmış bir üretim sunucusunu
"sağlıklı" göstermek olurdu.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"


SEVERITY_LABEL: Dict[Severity, str] = {
    Severity.ERROR: "Hata",
    Severity.WARNING: "Uyarı",
}

#: Üretimde tanımlı olması **zorunlu** değişkenler.
REQUIRED_IN_PRODUCTION = ("SUPABASE_JWKS_URL", "FRONTEND_ORIGINS")

#: Eksikliği yeteneği kısıtlayan ama sunucuyu durdurmayan değişkenler.
RECOMMENDED = ("DATABASE_URL",)

#: Ortamın adını taşıyan değişken.
ENVIRONMENT_ENV = "OPTIFLOW_ENV"

#: Üretim sayılan ortam adları.
PRODUCTION_NAMES = frozenset({"production", "prod", "uretim", "üretim"})


@dataclass(frozen=True)
class Finding:
    """Ortam denetiminin tek bir bulgusu."""

    key: str
    severity: Severity
    message: str
    #: Kullanıcının ne yapması gerektiği.
    remedy: str

    def to_dict(self) -> Dict[str, str]:
        return {
            "key": self.key,
            "severity": self.severity.value,
            "severity_label": SEVERITY_LABEL[self.severity],
            "message": self.message,
            "remedy": self.remedy,
        }


@dataclass
class EnvironmentReport:
    """Ortam denetiminin sonucu."""

    environment: str
    is_production: bool
    findings: List[Finding] = field(default_factory=list)

    @property
    def errors(self) -> List[Finding]:
        return [item for item in self.findings if item.severity is Severity.ERROR]

    @property
    def warnings(self) -> List[Finding]:
        return [item for item in self.findings if item.severity is Severity.WARNING]

    @property
    def ok(self) -> bool:
        """Sunucu görevini yapabilir mi? (Uyarılar engel değildir.)"""
        return not self.errors

    def to_dict(self) -> Dict[str, object]:
        return {
            "environment": self.environment,
            "production": self.is_production,
            "ok": self.ok,
            "errors": [item.to_dict() for item in self.errors],
            "warnings": [item.to_dict() for item in self.warnings],
        }


def environment_name(env: Optional[Dict[str, str]] = None) -> str:
    """Çalışılan ortamın adı; tanımlı değilse `development`.

    Varsayılanın geliştirme olması bilinçlidir: bir sunucu yanlışlıkla
    ortamsız açıldığında üretim kurallarına göre denetlenip reddedilmesi,
    yerel çalışmayı imkânsız kılardı. Üretim ortamı **açıkça** belirtilir.
    """
    source = env if env is not None else os.environ
    return (source.get(ENVIRONMENT_ENV) or "development").strip().lower()


def is_production(env: Optional[Dict[str, str]] = None) -> bool:
    return environment_name(env) in PRODUCTION_NAMES


def _value(source: Dict[str, str], key: str) -> str:
    return (source.get(key) or "").strip()


def check_environment(env: Optional[Dict[str, str]] = None) -> EnvironmentReport:
    """Ortam değişkenlerini denetler."""
    source = dict(env if env is not None else os.environ)
    production = is_production(source)
    findings: List[Finding] = []

    for key in REQUIRED_IN_PRODUCTION:
        if _value(source, key):
            continue
        if production:
            findings.append(
                Finding(
                    key=key,
                    severity=Severity.ERROR,
                    message=f"{key} tanımlı değil; üretimde zorunludur.",
                    remedy=f"{key} ortam değişkenini tanımlayıp sunucuyu yeniden başlatın.",
                )
            )
        else:
            findings.append(
                Finding(
                    key=key,
                    severity=Severity.WARNING,
                    message=f"{key} tanımlı değil; geliştirmede sorun değil.",
                    remedy=f"Yayına almadan önce {key} tanımlanmalıdır.",
                )
            )

    for key in RECOMMENDED:
        if _value(source, key):
            continue
        findings.append(
            Finding(
                key=key,
                severity=Severity.WARNING,
                message=(
                    f"{key} tanımlı değil; veriler süreç belleğinde tutulur ve "
                    "sunucu yeniden başladığında kaybolur."
                ),
                remedy="Kalıcılık için bir veritabanı adresi tanımlayın.",
            )
        )

    # Joker CORS: tarayıcıdaki herhangi bir sitenin API'yi çağırmasına izin
    # verir. Üretimde bu bir hatadır, geliştirmede yalnızca uyarı.
    origins = _value(source, "FRONTEND_ORIGINS")
    if "*" in origins:
        findings.append(
            Finding(
                key="FRONTEND_ORIGINS",
                severity=Severity.ERROR if production else Severity.WARNING,
                message="FRONTEND_ORIGINS joker (*) içeriyor.",
                remedy="Yalnızca gerçek frontend adreslerini virgülle ayırarak yazın.",
            )
        )

    return EnvironmentReport(
        environment=environment_name(source),
        is_production=production,
        findings=findings,
    )


def missing_keys(report: EnvironmentReport) -> List[str]:
    """Hata düzeyindeki eksik anahtarlar; hazırlık ucu bunu yazar."""
    return [item.key for item in report.errors]
