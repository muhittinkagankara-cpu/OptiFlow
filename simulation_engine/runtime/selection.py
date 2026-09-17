"""Sürücü seçimi — canlı ekranı hangi bağlantı beslesin?

Bu modül **saftır**: ağ kullanmaz, saat okumaz, kayıt defterine yazmaz. Yalnızca
elindeki bağlantı durumlarına bakıp bir karar döndürür. Böylece bir cihaz
olmadan da sınanabilir; karar mantığının doğruluğu bir PLC'nin varlığına
bağlanmamalıdır.

Neden otomatik seçim
--------------------
Kaynak bugüne kadar elle seçiliyordu. Doğrulanmış bir cihaz varken ekranın
demo veriyi göstermeye devam etmesi, operatöre gerçek hattı değil bir benzetimi
okutur; bu, ürünün en pahalı hatasıdır.

Seçim ölçütü — iki kapı
-----------------------
Bir bağlantı ancak şu iki koşulu birden sağlarsa seçilebilir:

1. `ever_verified` — cihazdan **gerçekten** bir yanıt alınmış olmalı. Bu bayrak
   yalnızca somut bir okuma sonrası yazılır (`ConnectionState.apply_probe`).
2. `status is CONNECTED` — bağlantı **şu anda** ayakta olmalı.

İkinci kapı olmasaydı, bir kez doğrulanmış ama sonra kopmuş bir bağlantı
seçilir ve ekran boş kalırdı; boş bir canlı ekran "fabrika duruyor" diye
okunur. Hiçbiri geçemezse `None` döner ve çağıran demo veriye düşer — demo
olduğu ekranda ayrıca etiketlenir.

Öncelik sırası
--------------
OPC UA → REST → MQTT.

OPC UA önce gelir çünkü denetleyiciden **doğrudan** etiket okur; arada bir
sistem yoktur. REST ikincidir: MES uçları bu türden okunur ve MES, makinenin
kendisini değil kaydını verir. MQTT sonuncudur ama listede olmak zorundadır —
dışarıda bırakılsaydı, yalnızca MQTT ile bağlanmış doğrulanmış bir fabrika
sessizce demo veriye düşerdi.

Sprint 2L. `ConnectionKind` bu sprintte genişletilmedi: MES ayrı bir tür değil,
REST üzerinden okunan bir uçtur.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence

from simulation_engine.runtime.types import ConnectionKind, ConnectionStatus

#: Seçim sırası. Listedeki ilk tür, doğrulanmış bir adayı varsa kazanır.
DRIVER_PRIORITY: Sequence[ConnectionKind] = (
    ConnectionKind.OPCUA,
    ConnectionKind.REST,
    ConnectionKind.MQTT,
)

#: Her tür için kararın gerekçesinde geçen ad.
KIND_LABEL = {
    ConnectionKind.OPCUA: "OPC UA",
    ConnectionKind.REST: "REST/MES",
    ConnectionKind.MQTT: "MQTT",
}

#: Hiçbir aday yokken yazılan gerekçe.
NO_DRIVER_REASON = (
    "Doğrulanmış ve şu anda bağlı bir cihaz yok; canlı ekran benzetim verisiyle "
    "çalışıyor. Gerçek veri için Bağlantılar ekranından bir cihaz tanımlayıp "
    "bağlantıyı doğrulayın."
)


@dataclass(frozen=True)
class DriverChoice:
    """Canlı akışı besleyecek bağlantı ve bu kararın gerekçesi."""

    connection_id: str
    kind: ConnectionKind
    label: str
    reason: str


def is_eligible(state) -> bool:
    """Bu bağlantı canlı akışı besleyebilir mi?

    İki kapı da geçilmeli: cihazdan bir kez gerçek yanıt alınmış olmalı ve
    bağlantı şu anda ayakta olmalı. Tek başına `ever_verified` yeterli
    sayılsaydı, kopmuş bir hat seçilir ve ekran sessizce boşalırdı.
    """
    return bool(getattr(state, "ever_verified", False)) and (
        getattr(state, "status", None) is ConnectionStatus.CONNECTED
    )


def eligible_states(states: Iterable) -> List:
    """Seçilebilir bağlantılar; kayıt defterinin sırasını korur."""
    return [state for state in states if is_eligible(state)]


def select_driver(states: Iterable) -> Optional[DriverChoice]:
    """Öncelik sırasına göre canlı akışı besleyecek bağlantıyı seçer.

    Aynı türden birden fazla aday varsa **ilk gelen** kazanır. Kayıt defteri
    listeyi etikete göre sıraladığı için bu seçim kararlıdır: aynı girdi her
    zaman aynı bağlantıyı verir. Gecikmeye göre sıralamak cazip görünür ama
    ölçüm gürültüsü yüzünden kaynağın kendiliğinden değişmesine yol açardı.

    Aday yoksa `None` döner; çağıran demo veriye düşer.
    """
    candidates = eligible_states(states)
    if not candidates:
        return None

    for kind in DRIVER_PRIORITY:
        for state in candidates:
            if state.spec.kind is not kind:
                continue
            return DriverChoice(
                connection_id=state.spec.connection_id,
                kind=kind,
                label=state.spec.label,
                reason=(
                    f"{KIND_LABEL[kind]} bağlantısı '{state.spec.label}' doğrulandı "
                    f"ve şu anda bağlı; canlı ekran bu cihazdan besleniyor."
                ),
            )

    # Buraya düşmek, tanınmayan bir tür eklendiği anlamına gelir. Sessizce demo
    # veriye düşmek yerine durum açıkça bildirilir.
    return None


def describe_selection(choice: Optional[DriverChoice]) -> str:
    """Kararın operatöre gösterilecek tek cümlelik gerekçesi."""
    return NO_DRIVER_REASON if choice is None else choice.reason


def selection_report(states: Iterable) -> dict:
    """API'ye giden hâli: seçilen sürücü, gerekçesi ve aday sayısı.

    `candidates` sayısı gerekçeyi denetlenebilir kılar: operatör "neden demo
    veri görüyorum?" diye sorduğunda, hiç aday olmadığını buradan okur.
    """
    candidates = eligible_states(states)
    choice = select_driver(candidates)
    return {
        "connection_id": None if choice is None else choice.connection_id,
        "kind": None if choice is None else choice.kind.value,
        "label": None if choice is None else choice.label,
        "reason": describe_selection(choice),
        "candidates": len(candidates),
        "simulated": choice is None,
    }
