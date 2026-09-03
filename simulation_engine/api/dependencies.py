"""Uygulama düzeyinde paylaşılan bağımlılıklar.

Simülasyon deposu burada, iki router'ın da (simülasyon ve envanter)
erişebileceği yerde tutulur. Depo `simulation_service` içinde kalsaydı,
envanter router'ının ona ulaşması için o modülü içe aktarması gerekirdi —
oysa `simulation_service` zaten envanter router'ını içe aktarıyor ve dairesel
bir bağımlılık oluşurdu.

Bağımlılığın **tek bir fonksiyon nesnesi** olması önemlidir: FastAPI'nin
`dependency_overrides` sözlüğü anahtar olarak nesnenin kendisini kullanır.
İki modül aynı işi yapan iki ayrı fonksiyon tanımlasaydı, testlerin geçirdiği
sahte depo yalnızca birinde geçerli olur ve diğeri sessizce gerçek depoyu
kullanmaya devam ederdi.
"""

from __future__ import annotations

from typing import Union

from simulation_engine.api.factory_storage import (
    DatabaseFactoryStore,
    InMemoryFactoryStore,
    create_factory_store,
)
from simulation_engine.api.org_storage import (
    DatabaseOrgStore,
    InMemoryOrgStore,
    create_org_store,
)
from simulation_engine.api.storage import (
    DatabaseSimulationStore,
    SimulationStore,
    create_simulation_store,
)

SimulationStoreProtocol = Union[SimulationStore, DatabaseSimulationStore]
FactoryStoreProtocol = Union[InMemoryFactoryStore, DatabaseFactoryStore]
OrgStoreProtocol = Union[InMemoryOrgStore, DatabaseOrgStore]

#: Uygulama düzeyinde tekil depo. `DATABASE_URL` tanımlıysa kalıcı, değilse
#: bellek içi bir depo oluşturulur (bkz. `api.storage`). İki deponun arayüzü
#: aynı olduğu için uç noktalar hangisinin kullanıldığını bilmez.
_store: SimulationStoreProtocol = create_simulation_store()


def get_store() -> SimulationStoreProtocol:
    """Simülasyon deposu bağımlılığı.

    Testler veya farklı bir dağıtım, `app.dependency_overrides` üzerinden kendi
    deposunu geçirebilir.
    """
    return _store


#: Uygulama düzeyinde tekil fabrika deposu.
_factory_store: FactoryStoreProtocol = create_factory_store()


def get_factory_store() -> FactoryStoreProtocol:
    """Fabrika deposu bağımlılığı.

    Simülasyon deposuyla aynı sebeple burada durur: hem `factory_routes` hem de
    fabrikadan koşum başlatan uç (`simulation_service`) aynı depoya erişmek
    zorundadır ve depo bunlardan birinin içinde tanımlansaydı diğeri onu içe
    aktarmak zorunda kalıp dairesel bir bağımlılık oluştururdu.
    """
    return _factory_store


#: Uygulama düzeyinde tekil organizasyon deposu.
_org_store: OrgStoreProtocol = create_org_store()


def get_org_store() -> OrgStoreProtocol:
    """Organizasyon deposu bağımlılığı.

    `simulation_engine.auth.dependencies.get_current_org` bunu kullanarak
    doğrulanmış kullanıcının organizasyonunu bulur ya da (ilk girişte) kurar.
    """
    return _org_store
