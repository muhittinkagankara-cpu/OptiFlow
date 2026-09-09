# OptiFlow backend — uretim kapsayicisi.
#
# Iki asamali: derleme asamasi bagimliliklari kurar, calisma asamasi yalnizca
# kurulmus paketleri ve kaynak kodu tasir. Tek asamali bir imaj, derleme
# araclarini (gcc, baslik dosyalari) uretime tasirdi; bunlar hem imaji
# buyutur hem de saldiri yuzeyini genisletir.

FROM python:3.12-slim AS builder

WORKDIR /build

# Once yalnizca bagimlilik listesi kopyalanir: kaynak kod degistiginde
# katman onbellegi bozulmaz ve kurulum yeniden calismaz.
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


FROM python:3.12-slim

# Kok kullanici olarak calismaz. Kapsayicidan kacan bir surec, kok yetkisiyle
# ana makineye erisebilir; sinirli bir kullanici bunu zorlastirir.
RUN useradd --create-home --shell /bin/bash optiflow

WORKDIR /app

COPY --from=builder /install /usr/local
COPY simulation_engine ./simulation_engine
COPY migrations ./migrations
COPY alembic.ini ./alembic.ini

USER optiflow

# Python ciktisinin tamponlanmamasi zorunludur: tamponlanirsa kapsayici
# gunlukleri dakikalarca gec gorunur ve bir arizanin nedeni kaybolur.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OPTIFLOW_ENV=production \
    PORT=8000

EXPOSE 8000

# Saglik denetimi **canlilik** ucunu kullanir, hazirlik ucunu degil:
# veritabani gecici olarak yanit vermediginde kapsayiciyi yeniden baslatmak
# sorunu cozmez, yalnizca hizmeti busbutun kaybettirir.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

CMD ["sh", "-c", "python -m simulation_engine.api.schema_bootstrap && uvicorn simulation_engine.api.simulation_service:app --host 0.0.0.0 --port ${PORT} --timeout-graceful-shutdown 25"]
