"""FastAPI servis katmanı — Şartname Bölüm 5.

Modül:
    simulation_service.py  POST /api/simulations/run,
                           GET  /api/simulations/{id}/validation-report,
                           POST /api/simulations/compare

Çalıştırmak için:

    uvicorn simulation_engine.api.simulation_service:app --reload

Etkileşimli dokümantasyon http://127.0.0.1:8000/docs adresinde sunulur.

`app` nesnesi bu paketten doğrudan içe aktarılmaz: FastAPI'nin içe aktarılması
görece pahalıdır ve motoru kütüphane olarak kullanan kod bunun bedelini
ödememelidir.
"""
