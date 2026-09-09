"""Gerçek verinin CSV olarak dışa aktarılması.

Neden gerekli
-------------
Müşteri kendi verisini kendi araçlarında görmek ister: kalite ekibi Excel'de
çalışır, danışman kendi modelini kurar, denetçi ham kaydı görmek ister.
Verisini dışa aktaramayan bir sistem, müşteriyi kilitler ve satın alma
kararının önünde durur.

Ne aktarılır
------------
Yalnızca **gerçek kayıtlar**: telemetri tablosu, alarm geçmişi ve OEE geçmişi.
Benzetim çıktısı bu uçlardan çıkmaz; çıksaydı, müşterinin elindeki dosyada
hangi satırın cihazdan hangisinin senaryodan geldiği bilinemezdi.

Boş dosya neden başlıklı çıkar
------------------------------
Kayıt yoksa yalnızca başlık satırı döner. Tamamen boş bir dosya, "veri yok"
ile "dışa aktarma bozuk" arasındaki farkı yok ederdi.

Ölçülemeyen alan neden boş hücre
--------------------------------
`None` değerler boş hücre olarak yazılır, sıfır olarak değil. Excel'de sıfır
gören biri onu ölçülmüş bir sıfır sanar; boş hücre "ölçülmedi" der.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence

#: Bir dışa aktarmada dönen en fazla satır.
#:
#: Elli bin satır, bir aylık telemetriyi kapsar ve Excel'in sınırının
#: (1.048.576) çok altındadır. Sınırsız bırakılsaydı, tek bir istek sunucunun
#: belleğini tüketebilirdi.
MAX_ROWS = 50_000

#: CSV ayracı.
#:
#: Noktalı virgül bilinçli: Türkçe yerel ayarda Excel ondalık ayracı olarak
#: virgül kullanır ve virgülle ayrılmış bir dosyayı tek sütuna yapıştırır.
DELIMITER = ";"


@dataclass(frozen=True)
class ExportResult:
    """Bir dışa aktarmanın sonucu."""

    file_name: str
    content: str
    row_count: int
    #: Sınıra dayanıldı mı? Dayanıldıysa dosya eksiktir ve bu söylenir.
    truncated: bool
    #: Aktarılan verinin kaynağı; her zaman gerçek bir tablo adıdır.
    source: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file_name": self.file_name,
            "row_count": self.row_count,
            "truncated": self.truncated,
            "source": self.source,
            "bytes": len(self.content.encode("utf-8")),
        }


def render_csv(columns: Sequence[str], rows: Iterable[Sequence[Any]]) -> str:
    """Satırları CSV metnine çevirir.

    `None` boş hücre olur; sıfıra çevrilmez. `lineterminator` açıkça verilir:
    varsayılan `\\r\\n`, bazı araçlarda fazladan boş satır üretir.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=DELIMITER, lineterminator="\n")
    writer.writerow(list(columns))
    for row in rows:
        writer.writerow(["" if value is None else value for value in row])
    return buffer.getvalue()


def telemetry_rows(points: Iterable[Any]) -> List[List[Any]]:
    """Telemetri satırları.

    Kalite sütunu **korunur**: bozuk kaliteli bir ölçüm dosyadan silinseydi,
    müşteri sensörün ne zaman bozulduğunu göremezdi.
    """
    return [
        [
            point.timestamp_ms,
            point.device,
            point.tag,
            point.value,
            point.quality,
            point.source,
        ]
        for point in points
    ]


def export_telemetry(
    points: Iterable[Any], file_name: str = "telemetri.csv"
) -> ExportResult:
    """Telemetri tablosunu CSV'ye çevirir."""
    rows = telemetry_rows(points)
    truncated = len(rows) > MAX_ROWS
    trimmed = rows[:MAX_ROWS]
    content = render_csv(
        ["zaman_ms", "cihaz", "etiket", "deger", "kalite", "kaynak"], trimmed
    )
    return ExportResult(
        file_name=file_name,
        content=content,
        row_count=len(trimmed),
        truncated=truncated,
        source="telemetry",
    )


def alarm_rows(alarms: Iterable[Dict[str, Any]]) -> List[List[Any]]:
    """Alarm satırları; sözlük biçimindeki alarm kayıtlarından."""
    return [
        [
            alarm.get("id"),
            alarm.get("rule"),
            alarm.get("subject"),
            alarm.get("severity"),
            alarm.get("state"),
            alarm.get("raised_at_ms"),
            alarm.get("resolved_at_ms"),
            alarm.get("duration_ms"),
            alarm.get("acknowledged_by"),
            alarm.get("message"),
        ]
        for alarm in alarms
    ]


def export_alarms(
    alarms: Iterable[Dict[str, Any]], file_name: str = "alarmlar.csv"
) -> ExportResult:
    """Alarm geçmişini CSV'ye çevirir."""
    rows = alarm_rows(alarms)
    truncated = len(rows) > MAX_ROWS
    trimmed = rows[:MAX_ROWS]
    content = render_csv(
        [
            "alarm_id",
            "kural",
            "konu",
            "aciliyet",
            "durum",
            "acilis_ms",
            "kapanis_ms",
            "sure_ms",
            "goren",
            "mesaj",
        ],
        trimmed,
    )
    return ExportResult(
        file_name=file_name,
        content=content,
        row_count=len(trimmed),
        truncated=truncated,
        source="alarms",
    )


def oee_rows(samples: Iterable[Dict[str, Any]]) -> List[List[Any]]:
    """OEE satırları.

    Hesaplanamamış bir çarpan boş hücre olur. Sıfır yazılsaydı, ölçüm eksikliği
    "kalite sıfır" gibi okunur ve müşteri olmayan bir hurda sorununu araştırırdı.
    """
    return [
        [
            sample.get("at_ms"),
            sample.get("machine_id"),
            sample.get("availability"),
            sample.get("performance"),
            sample.get("quality"),
            sample.get("oee"),
        ]
        for sample in samples
    ]


def export_oee(
    samples: Iterable[Dict[str, Any]], file_name: str = "oee.csv"
) -> ExportResult:
    """OEE geçmişini CSV'ye çevirir."""
    rows = oee_rows(samples)
    truncated = len(rows) > MAX_ROWS
    trimmed = rows[:MAX_ROWS]
    content = render_csv(
        ["zaman_ms", "makine", "kullanilabilirlik", "performans", "kalite", "oee"],
        trimmed,
    )
    return ExportResult(
        file_name=file_name,
        content=content,
        row_count=len(trimmed),
        truncated=truncated,
        source="oee",
    )


#: Desteklenen dışa aktarma türleri.
EXPORT_KINDS = ("telemetry", "alarms", "oee")

EXPORT_KIND_LABEL: Dict[str, str] = {
    "telemetry": "Telemetri",
    "alarms": "Alarm geçmişi",
    "oee": "OEE geçmişi",
}


def is_supported(kind: str) -> bool:
    """Tanınan bir tür mü?

    Tanınmayan bir türü varsayılana düşürmek, kullanıcının alarm istediği
    yerde telemetri indirmesi demek olurdu.
    """
    return kind in EXPORT_KINDS
