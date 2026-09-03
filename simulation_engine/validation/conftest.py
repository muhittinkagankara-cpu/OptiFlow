"""Test dizini genelinde geçerli olan ortak fixture'lar.

Kimlik doğrulama gerekli hâle geldiğinde (Faz 2), veri uçlarına dokunan
yaklaşık 500 mevcut test aniden 401 almaya başlardı — hepsi `TestClient(app)`
ile doğrudan çağrı yapıyor ve hiçbiri `Authorization` başlığı taşımıyor.

Bu dosyadaki `_fixed_org` fixture'ı **otomatik uygulanır** (`autouse=True`) ve
`get_current_org` bağımlılığını sabit bir test organizasyonuna çevirir. Böylece
mevcut testlerin hiçbiri değiştirilmeden çalışmaya devam eder — onlar zaten
`app.dependency_overrides` üzerinden kendi depolarını (`get_factory_store`,
`get_store`, `get_inventory_store`) geçiriyor; bu fixture yalnızca ayrı bir
anahtara (`get_current_org`) aynı sözlükte bir üçüncü geçersiz kılma ekler ve
temiz biçimde geri alır.

Kimlik doğrulamanın **kendisini** sınayan testler (`test_auth_jwt.py`,
`test_auth_tenant_isolation.py`) bu geçersiz kılmayı kullanmaz: gerçek bir
token üretip gerçek doğrulama yolundan geçer. `test_auth_tenant_isolation.py`
kendi dosyasında, her testten önce bu geçersiz kılmayı geçici olarak kaldırıp
testten sonra geri koyan ayrı bir fixture kullanır.

Neden oturum (session) kapsamı
-------------------------------
Fixture fonksiyon değil **oturum** kapsamındadır. Bazı test dosyalarında
(`test_api.py`) modül kapsamında bir istemci çağrısı yapan fixture'lar var
(`mm1_run` gibi); pytest daha geniş kapsamlı fixture'ları daha dar kapsamlı
olanlardan (burada fonksiyon kapsamlı `_fixed_org`'dan) önce kurar. Fixture
fonksiyon kapsamında olsaydı, modül kapsamındaki bir fixture ilk testten önce
override hiç uygulanmamışken bir HTTP isteği atar ve 401 alırdı. Oturum
kapsamı, override'ın **her şeyden önce** bir kez kurulmasını garanti eder.
"""

from __future__ import annotations

import pytest

from simulation_engine.api.simulation_service import app
from simulation_engine.auth.dependencies import get_current_org

#: Kimlik doğrulamayı sınamayan tüm testlerin çalıştığı sabit organizasyon.
TEST_ORG_ID = "test-org-00000000000000000000000000"


@pytest.fixture(scope="session", autouse=True)
def _fixed_org():
    """`get_current_org`'u tüm test oturumu boyunca sabit bir organizasyona bağlar.

    `autouse=True` olduğu için hiçbir test dosyasının bunu açıkça istemesi
    gerekmez — mevcut ~500 testin tek satırı bile değişmez. Oturum kapsamında
    olması bilinçlidir (yukarıdaki not); tek tek testler arasında sıfırlanması
    gerekmez çünkü hiçbir test bu override'ın kendisini sınamaz.
    """
    app.dependency_overrides[get_current_org] = lambda: TEST_ORG_ID
    yield
    app.dependency_overrides.pop(get_current_org, None)
