"""Üretim Süreç Simülasyon Motoru — discrete-event simulation (DES) çekirdeği.

Paket düzeni (Şartname Bölüm 1):

    core/           Olay tabanlı simülasyon çekirdeği (saat, olay kuyruğu, varlıklar, motor)
    distributions/  Olasılık dağılımları (varış / işlem / onarım süreleri)
    analytics/      Kuyruk teorisi, Little's Law, OEE, Takt Time, TOC, Monte Carlo
    validation/     Analitik doğrulama test paketi
    api/            FastAPI servis katmanı
    models/         Pydantic veri modelleri

Bu aşamada `models/`, `distributions/` ve `core/` uygulanmıştır; `analytics/`,
`validation/` ve `api/` paketleri bir sonraki aşamada doldurulacaktır.
"""

__version__ = "0.1.0"
__all__ = ["__version__"]
