"""Saha tanılama: sahadaki mühendisin tek ekranı.

Sorun
-----
Kurulum sırasında bir şey çalışmadığında sorulan soru hep aynıdır: "sorun ağda
mı, cihazda mı, bizde mi?" Bu sorunun yanıtı bugüne kadar üç ayrı ekrandan
toplanıyordu. Sahadaki mühendisin merdiven altında telefonla bakacağı tek bir
ekran gerekiyor.

Ölçülemeyen alan neden `null`
-----------------------------
Ping ölçülemediyse "0 ms" yazmak, ağın kusursuz olduğunu söylemek olurdu.
Bu ekranın bütün değeri, **neyin bilinmediğini** de göstermesindedir.

Saat senkronu neden burada
--------------------------
Cihazın saati sunucununkinden saparsa, telemetri yanlış zamana yazılır ve
trend grafiği kayar. Bu, aylar sonra "veriler tutmuyor" diye geri dönen ve
kaynağı çok geç bulunan bir hatadır. Sapma kurulumda ölçülür.

Paket kaybı neden oran değil, sayı da
-------------------------------------
Yüzde tek başına yanıltır: 1000 pakette %1 kayıp ile 10 pakette %10 kayıp aynı
ekranda çok farklı şeylerdir. İkisi de yazılır.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

#: Ağ gecikmesi bu eşiği aşarsa uyarı verilir (ms).
#:
#: Yüz milisaniye, yerel bir fabrika ağında yüksektir; aşılıyorsa arada bir
#: sorun (kablo, anahtar, VPN) vardır.
SLOW_PING_MS = 100.0

#: Protokol gecikmesi bu eşiği aşarsa uyarı verilir (ms).
#:
#: Yarım saniye: saniyede bir yoklanan bir akışta gecikmenin yarım saniyeyi
#: bulması, ölçümlerin yarısının geç geldiği anlamına gelir.
SLOW_PROTOCOL_MS = 500.0

#: Saat sapması bu eşiği aşarsa uyarı verilir (ms).
#:
#: İki saniye: telemetri kovaları dakikalıktır, iki saniyelik sapma grafiği
#: bozmaz; on saniyelik sapma bozar.
CLOCK_SKEW_MS = 2_000.0

#: Paket kaybı bu oranı aşarsa uyarı verilir.
LOSSY_RATIO = 0.01


class ProbeState(str, Enum):
    """Bir tanılama satırının durumu."""

    OK = "ok"
    WARNING = "warning"
    FAILED = "failed"
    #: Ölçülmedi; iyi de kötü de değil.
    UNKNOWN = "unknown"


PROBE_STATE_LABEL: Dict[ProbeState, str] = {
    ProbeState.OK: "Normal",
    ProbeState.WARNING: "Dikkat",
    ProbeState.FAILED: "Başarısız",
    ProbeState.UNKNOWN: "Ölçülmedi",
}

#: En kötüden iyiye; özet durum bu sıraya göre seçilir.
STATE_ORDER: List[ProbeState] = [
    ProbeState.FAILED,
    ProbeState.WARNING,
    ProbeState.OK,
    ProbeState.UNKNOWN,
]


@dataclass(frozen=True)
class DiagnosticLine:
    """Tanılama ekranındaki tek bir satır."""

    id: str
    label: str
    state: ProbeState
    #: Ölçülen değer; ölçülemediyse `None`.
    value: Optional[float] = None
    unit: Optional[str] = None
    #: Sayısal olmayan sonuç (protokol durumu gibi); yoksa `None`.
    text: Optional[str] = None
    #: Ölçülemediyse **neden**; ölçüldüyse `None` ya da uyarının açıklaması.
    reason: Optional[str] = None

    @property
    def measured(self) -> bool:
        return self.value is not None or self.text is not None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "state": self.state.value,
            "state_label": PROBE_STATE_LABEL[self.state],
            "value": self.value,
            "unit": self.unit,
            "text": self.text,
            "reason": self.reason,
            "measured": self.measured,
        }


def unmeasured(line_id: str, label: str, reason: str, unit: Optional[str] = None) -> DiagnosticLine:
    """Ölçülemeyen bir satır; nedeni taşır."""
    return DiagnosticLine(
        id=line_id,
        label=label,
        state=ProbeState.UNKNOWN,
        value=None,
        unit=unit,
        reason=reason,
    )


def worst_state(lines: List[DiagnosticLine]) -> ProbeState:
    """Satırların en kötüsü; satır yoksa `UNKNOWN`."""
    if not lines:
        return ProbeState.UNKNOWN
    states = {line.state for line in lines}
    for candidate in STATE_ORDER:
        if candidate in states:
            return candidate
    return ProbeState.UNKNOWN


def latency_line(
    line_id: str,
    label: str,
    latency_ms: Optional[float],
    threshold_ms: float,
    missing_reason: str,
) -> DiagnosticLine:
    """Gecikme satırı; ölçülemediyse `UNKNOWN`."""
    if latency_ms is None:
        return unmeasured(line_id, label, missing_reason, "ms")
    state = ProbeState.WARNING if latency_ms >= threshold_ms else ProbeState.OK
    return DiagnosticLine(
        id=line_id,
        label=label,
        state=state,
        value=round(float(latency_ms), 2),
        unit="ms",
        reason=None if state is ProbeState.OK else f"{threshold_ms:.0f} ms eşiği aşıldı",
    )


def protocol_line(
    line_id: str,
    label: str,
    connected: Optional[bool],
    detail: Optional[str],
) -> DiagnosticLine:
    """Protokol durumu satırı.

    Üç durum vardır: bağlandı, bağlanamadı, denenmedi. Üçüncüsü ikincisiyle
    karıştırılmaz — denenmemiş bir protokolü "başarısız" göstermek, sahadaki
    mühendisi olmayan bir arızanın peşine düşürürdü.
    """
    if connected is None:
        return DiagnosticLine(
            id=line_id,
            label=label,
            state=ProbeState.UNKNOWN,
            text=None,
            reason=detail or "Bu protokol için bağlantı denenmedi",
        )
    return DiagnosticLine(
        id=line_id,
        label=label,
        state=ProbeState.OK if connected else ProbeState.FAILED,
        text="Bağlandı" if connected else "Bağlanamadı",
        reason=detail,
    )


def clock_line(skew_ms: Optional[float]) -> DiagnosticLine:
    """Saat senkronu satırı.

    Sapmanın **işareti** korunur: cihaz ileri mi geri mi, arıza ararken fark
    eder. Mutlak değer alınsaydı bu bilgi kaybolurdu.
    """
    if skew_ms is None:
        return unmeasured(
            "clock",
            "Saat senkronu",
            "Cihaz saati okunamadı; sapma bilinmiyor",
            "ms",
        )
    state = ProbeState.WARNING if abs(skew_ms) >= CLOCK_SKEW_MS else ProbeState.OK
    return DiagnosticLine(
        id="clock",
        label="Saat senkronu",
        state=state,
        value=round(float(skew_ms), 1),
        unit="ms",
        reason=(
            None
            if state is ProbeState.OK
            else "Cihaz saati sunucudan sapıyor; telemetri yanlış zamana yazılır"
        ),
    )


def loss_line(
    packets: Optional[int], errors: Optional[int]
) -> DiagnosticLine:
    """Paket kaybı satırı.

    Hiç paket gelmemişse oran hesaplanamaz: sıfıra bölmek yerine `UNKNOWN`
    döner. "Kayıp %0" demek, hiç veri almamış bir bağlantıyı kusursuz
    göstermek olurdu.
    """
    if packets is None or errors is None:
        return unmeasured(
            "loss", "Paket kaybı", "Paket sayaçları okunamadı", "%"
        )
    total = packets + errors
    if total <= 0:
        return unmeasured(
            "loss", "Paket kaybı", "Hiç paket alınmadı; oran hesaplanamaz", "%"
        )
    ratio = errors / total
    state = ProbeState.WARNING if ratio >= LOSSY_RATIO else ProbeState.OK
    return DiagnosticLine(
        id="loss",
        label="Paket kaybı",
        state=state,
        value=round(ratio * 100, 2),
        unit="%",
        text=f"{errors}/{total} paket",
        reason=None if state is ProbeState.OK else f"{errors} pakette hata",
    )


def last_data_line(age_ms: Optional[int]) -> DiagnosticLine:
    """Son veri yaşı satırı."""
    if age_ms is None:
        return unmeasured(
            "last_data", "Son veri", "Hiç veri gelmedi; yaş ölçülemez", "ms"
        )
    state = ProbeState.WARNING if age_ms >= 30_000 else ProbeState.OK
    return DiagnosticLine(
        id="last_data",
        label="Son veri",
        state=state,
        value=float(age_ms),
        unit="ms",
        reason=None if state is ProbeState.OK else "Uzun süredir veri gelmiyor",
    )


@dataclass
class FieldDiagnostics:
    """Saha tanılama ekranının tam görünümü."""

    at_ms: int
    lines: List[DiagnosticLine] = field(default_factory=list)
    #: Hangi uçta ölçüldü? Bilinmiyorsa boş.
    endpoint: str = ""

    @property
    def state(self) -> ProbeState:
        return worst_state(self.lines)

    @property
    def measured_count(self) -> int:
        return len([line for line in self.lines if line.measured])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "at_ms": self.at_ms,
            "endpoint": self.endpoint,
            "state": self.state.value,
            "state_label": PROBE_STATE_LABEL[self.state],
            "lines": [line.to_dict() for line in self.lines],
            "measured_count": self.measured_count,
            "line_count": len(self.lines),
        }


@dataclass
class FieldInput:
    """Saha tanılamasının girdisi; her alan ölçülemeyebilir."""

    ping_ms: Optional[float] = None
    opcua_latency_ms: Optional[float] = None
    opcua_connected: Optional[bool] = None
    mqtt_connected: Optional[bool] = None
    mqtt_detail: Optional[str] = None
    rest_connected: Optional[bool] = None
    rest_detail: Optional[str] = None
    last_data_age_ms: Optional[int] = None
    clock_skew_ms: Optional[float] = None
    packets: Optional[int] = None
    errors: Optional[int] = None
    endpoint: str = ""


def build(data: FieldInput, now_ms: int) -> FieldDiagnostics:
    """Yedi satırın tamamı.

    Eksik bir girdi raporu düşürmez: ölçülemeyen satır "Ölçülmedi" olarak
    görünür ve nedenini yazar. Eksik satır gizlenseydi, sahadaki mühendis
    neyin ölçülmediğini bilemezdi.
    """
    lines = [
        latency_line(
            "ping",
            "Ping",
            data.ping_ms,
            SLOW_PING_MS,
            "Ağ gecikmesi ölçülmedi",
        ),
        latency_line(
            "opcua",
            "OPC UA gecikmesi",
            data.opcua_latency_ms,
            SLOW_PROTOCOL_MS,
            "OPC UA bağlantısı denenmedi",
        ),
        protocol_line("mqtt", "MQTT durumu", data.mqtt_connected, data.mqtt_detail),
        protocol_line("rest", "REST durumu", data.rest_connected, data.rest_detail),
        last_data_line(data.last_data_age_ms),
        clock_line(data.clock_skew_ms),
        loss_line(data.packets, data.errors),
    ]
    return FieldDiagnostics(at_ms=now_ms, lines=lines, endpoint=data.endpoint)
