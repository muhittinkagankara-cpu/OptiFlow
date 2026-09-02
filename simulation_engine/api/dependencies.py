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

from simulation_engine.api.storage import (
    DatabaseSimulationStore,
    SimulationStore,
    create_simulation_store,
)

SimulationStoreProtocol = Union[SimulationStore, DatabaseSimulationStore]

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
