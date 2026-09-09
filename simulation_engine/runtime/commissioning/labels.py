"""Makine etiketleri: sahadaki kalıcı kimlik.

Sorun
-----
Yazılımdaki makine kimliği (`freze_hat1_2`) ile makinenin üstünde yazan ad
(`FREZE-02`) aynı değilse, sahadaki bir teknisyen ekranda gördüğü arızayı
hangi makinede arayacağını bilemez. Bu, kurulumdan sonra en çok zaman
kaybettiren şeydir.

Etiket bu boşluğu kapatır: makinenin üstüne yapıştırılan, QR taşıyan ve
yazılımdaki kimliğe bağlı kalıcı bir ad.

Neden biçim zorunlu
-------------------
`HARFLER-SAYI` biçimi (`TORN-01`) bir seçimdir: kısa, okunur, telsizle
söylenebilir ve sıralanabilir. Serbest metne izin verilseydi, aynı makine iki
farklı kâğıtta iki farklı şekilde yazılırdı.

QR neden kimlik taşır, adres değil
----------------------------------
QR içeriği `optiflow:makine/<kiracı>/<etiket>` biçimindedir. Bir URL yazılsaydı,
sunucu adresi değiştiğinde fabrikadaki bütün etiketlerin yeniden basılması
gerekirdi. Kimlik değişmez; adresi okuyan uygulama çözer.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

#: Kabul edilen etiket biçimi: 2-8 harf, tire, 1-3 rakam.
LABEL_PATTERN = re.compile(r"^[A-Z]{2,8}-\d{1,3}$")

#: QR içeriğinin şeması.
QR_SCHEME = "optiflow:makine"

#: Türkçe harflerin ASCII karşılıkları.
#:
#: Etikette Türkçe harf kullanılmaz: etiketler telsizle okunur, farklı
#: klavyelerde aranır ve bazı yazıcılarda bozuk basılır. `ÖLÇÜM` yerine
#: `OLCUM` yazmak bir kayıp değil, sahada işleyen bir karardır.
TURKISH_MAP = str.maketrans(
    {
        "ç": "c", "Ç": "C",
        "ğ": "g", "Ğ": "G",
        "ı": "i", "İ": "I",
        "ö": "o", "Ö": "O",
        "ş": "s", "Ş": "S",
        "ü": "u", "Ü": "U",
    }
)


def is_valid_label(label: str) -> bool:
    """Etiket biçime uyuyor mu?"""
    return bool(LABEL_PATTERN.match(label.strip()))


def normalize_label(label: str) -> Optional[str]:
    """Etiketi ölçünlü biçime çeker; çevrilemiyorsa `None`.

    `freze 2` → `FREZE-02`, `torn_1` → `TORN-01`. Çevrilemeyen bir metin için
    uydurulmuş bir etiket üretilmez: yanlış bir etiket, sahada yanlış makineye
    yapıştırılan bir kâğıt demektir.
    """
    text = label.strip().translate(TURKISH_MAP)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    match = re.match(r"^\s*([A-Za-z]{2,8})[\s_\-]*(\d{1,3})\s*$", text)
    if match is None:
        return None
    letters = match.group(1).upper()
    number = int(match.group(2))
    # Numara iki basamağa tamamlanır: `FREZE-2` ile `FREZE-02` aynı makine
    # olmalıdır ve liste sıralaması doğru çıkmalıdır.
    return f"{letters}-{number:02d}"


def suggest_label(machine_id: str) -> Optional[str]:
    """Yazılımdaki kimlikten etiket önerir; türetilemezse `None`.

    Öneri kullanıcıya sunulur, sessizce uygulanmaz: etiket makinenin üstüne
    yapıştırılacak fiziksel bir şeydir ve onu insan onaylar.
    """
    direct = normalize_label(machine_id)
    if direct is not None:
        return direct
    # `freze_hat1_2` gibi kimliklerde ilk harf öbeği ve son sayı alınır.
    text = machine_id.strip().translate(TURKISH_MAP)
    letters = re.search(r"[A-Za-z]{2,8}", text)
    number = re.findall(r"\d{1,3}", text)
    if letters is None or not number:
        return None
    return f"{letters.group(0).upper()[:8]}-{int(number[-1]):02d}"


def qr_payload(org_id: str, label: str) -> str:
    """QR içeriği.

    Adres değil kimlik taşır: sunucu adresi değiştiğinde fabrikadaki bütün
    etiketlerin yeniden basılması gerekmemelidir.
    """
    return f"{QR_SCHEME}/{org_id}/{label}"


def parse_qr(payload: str) -> Optional[Dict[str, str]]:
    """QR içeriğini çözer; tanınmıyorsa `None`.

    Tanınmayan bir içerik için tahmin üretilmez: yanlış çözülen bir QR,
    teknisyeni başka bir makinenin ekranına götürürdü.
    """
    prefix = f"{QR_SCHEME}/"
    if not payload.startswith(prefix):
        return None
    rest = payload[len(prefix) :]
    parts = rest.split("/")
    if len(parts) != 2 or not parts[0] or not is_valid_label(parts[1]):
        return None
    return {"org_id": parts[0], "label": parts[1]}


@dataclass
class MachineLabel:
    """Bir makinenin kalıcı saha kimliği."""

    org_id: str
    #: Yazılımdaki makine kimliği.
    machine_id: str
    #: Sahadaki etiket (`FREZE-02`).
    label: str
    #: Hattın adı; bilinmiyorsa boş.
    line: str = ""
    #: Etiketin basıldığı an; hiç basılmadıysa `None`.
    printed_at_ms: Optional[int] = None
    created_at_ms: int = 0
    created_by: str = "sistem"
    note: str = ""

    @property
    def qr(self) -> str:
        return qr_payload(self.org_id, self.label)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "org_id": self.org_id,
            "machine_id": self.machine_id,
            "label": self.label,
            "line": self.line,
            "qr": self.qr,
            # Hiç basılmadıysa `null`; sıfır "1970'te basıldı" demek olurdu.
            "printed_at_ms": self.printed_at_ms,
            "created_at_ms": self.created_at_ms,
            "created_by": self.created_by,
            "note": self.note,
        }


def duplicate_labels(labels: Iterable[MachineLabel]) -> List[str]:
    """Aynı etiketi taşıyan kayıtlar.

    İki makineye aynı etiket yapıştırılırsa, sahadaki bir arıza kaydı hangi
    makineye ait olduğu bilinemeden kapatılır. Bu yüzden çakışma sessizce
    kabul edilmez.
    """
    seen: Dict[str, int] = {}
    for item in labels:
        seen[item.label] = seen.get(item.label, 0) + 1
    return sorted(label for label, count in seen.items() if count > 1)


def unlabeled_machines(
    machine_ids: Iterable[str], labels: Iterable[MachineLabel]
) -> List[str]:
    """Etiketi olmayan makineler.

    Kurulum bunlar kalırken tamamlanmış sayılmaz: etiketsiz bir makine,
    sahadaki teknisyen için ekrandaki bir satırdan ibarettir.
    """
    labeled = {item.machine_id for item in labels}
    return sorted(machine for machine in machine_ids if machine not in labeled)
