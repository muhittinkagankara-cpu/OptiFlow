"""Eşleme sihirbazı 2.0: öneri, güven puanı ve eksik etiket denetimi.

SALES-15'te öneri ikili bir şeydi: ya vardı ya yoktu. Sahada bu yetmiyor —
`Hat1.FREZE_01.UretimSayaci` adresinden çıkarılan öneri ile
`ns=2;i=1005` adresinden çıkarılan öneri aynı güvenle sunulamaz. Kullanıcı
hangisine güvenebileceğini bilmelidir.

Güven puanı nedir, ne değildir
------------------------------
Puan, önerinin **kaç kanıta** dayandığını söyler: makine adı adreste geçiyor
mu, metrik sözcüğü var mı, okunan değerin türü metriğe uyuyor mu. Bir olasılık
değildir ve öyle sunulmaz; "%80 ihtimalle doğru" demek, ölçülmemiş bir sayı
uydurmak olurdu. Arayüzde "3 kanıttan 2'si" biçiminde okunur.

Neden geri alma
---------------
Yanlış bir eşleme, bir makinenin üretim sayısını başka bir makineye yazar ve
bu hata haftalar sonra raporda fark edilir. Geri alma, kullanıcının denemesini
ucuzlatır: yanlış bastığında kaybettiği şey bir tıklamadır.

Eksik etiket neden uyarı
------------------------
Eşlenmemiş bir etiketin verisi hiçbir makineye yazılmaz. Kurulum bu uyarıyı
görmeden tamamlanırsa, müşteri aylarca eksik veriyle çalışır ve eksikliği
ancak bir denetimde fark eder.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional

from simulation_engine.runtime.provisioning import naming
from simulation_engine.runtime.provisioning.types import DiscoveredTag, TagKind

#: Sayısal metrikler; okunan değerin türü bunlarla karşılaştırılır.
NUMERIC_METRICS = frozenset(
    {
        "production_count",
        "scrap_count",
        "queue_length",
        "cycle_time_seconds",
        "downtime_minutes",
        "throughput_per_hour",
        "oee",
    }
)

#: Metin taşıyan metrikler.
TEXT_METRICS = frozenset({"status"})

#: Bir önerinin dayanabileceği kanıtlar.
#:
#: Üçü de bağımsızdır: adreste makine adı geçmesi, metrik sözcüğü geçmesi ve
#: okunan değerin türünün metriğe uyması. Üçü birden varsa öneri sağlamdır.
EVIDENCE_MACHINE = "machine"
EVIDENCE_METRIC = "metric"
EVIDENCE_TYPE = "type"

EVIDENCE_LABEL: Dict[str, str] = {
    EVIDENCE_MACHINE: "Adreste makine adı geçiyor",
    EVIDENCE_METRIC: "Adreste ölçüm adı geçiyor",
    EVIDENCE_TYPE: "Okunan değerin türü ölçüme uyuyor",
}

#: Toplam kanıt sayısı.
MAX_EVIDENCE = 3


@dataclass(frozen=True)
class MappingSuggestion:
    """Bir etiket için eşleme önerisi."""

    address: str
    #: Önerilen makine; çıkarılamadıysa `None`.
    machine_id: Optional[str]
    #: Önerilen metrik; çıkarılamadıysa `None`.
    metric: Optional[str]
    #: Hangi kanıtlar bulundu?
    evidence: List[str] = field(default_factory=list)

    @property
    def score(self) -> int:
        """Kaç kanıt bulundu? (0-3)"""
        return len(self.evidence)

    @property
    def complete(self) -> bool:
        """Doğrudan uygulanabilir mi? İki alan da dolu olmalıdır."""
        return self.machine_id is not None and self.metric is not None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "address": self.address,
            "machine_id": self.machine_id,
            "metric": self.metric,
            "evidence": list(self.evidence),
            "evidence_labels": [EVIDENCE_LABEL[item] for item in self.evidence],
            "score": self.score,
            "max_score": MAX_EVIDENCE,
            "complete": self.complete,
        }


def type_matches(kind: TagKind, metric: Optional[str]) -> bool:
    """Okunan değerin türü metriğe uyuyor mu?

    Türü bilinmeyen bir etiket (`UNKNOWN`) uymuş **sayılmaz**: değer
    okunamadığında uyum bir varsayımdır, kanıt değil.
    """
    if metric is None:
        return False
    if kind is TagKind.UNKNOWN:
        return False
    if metric in NUMERIC_METRICS:
        return kind in (TagKind.COUNTER, TagKind.GAUGE)
    if metric in TEXT_METRICS:
        return kind in (TagKind.TEXT, TagKind.BOOLEAN)
    return False


def suggest(tag: DiscoveredTag) -> MappingSuggestion:
    """Bir etiket için öneri ve kanıtları."""
    machine_id = naming.machine_hint(tag.address)
    metric = naming.suggest_metric(tag.address)

    evidence: List[str] = []
    if machine_id is not None:
        evidence.append(EVIDENCE_MACHINE)
    if metric is not None:
        evidence.append(EVIDENCE_METRIC)
    if type_matches(tag.kind, metric):
        evidence.append(EVIDENCE_TYPE)

    return MappingSuggestion(
        address=tag.address,
        machine_id=machine_id,
        metric=metric,
        evidence=evidence,
    )


def suggest_all(tags: Iterable[DiscoveredTag]) -> List[MappingSuggestion]:
    return [suggest(tag) for tag in tags]


@dataclass(frozen=True)
class MappingEntry:
    """Kurulmuş bir eşleme."""

    address: str
    machine_id: str
    metric: str
    #: Öneriden mi geldi, elle mi kuruldu?
    source: str = "manual"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "address": self.address,
            "machine_id": self.machine_id,
            "metric": self.metric,
            "source": self.source,
        }


@dataclass
class MappingReview:
    """Eşleme tablosunun denetimi."""

    #: Seçili ama eşlenmemiş adresler.
    unmapped: List[str] = field(default_factory=list)
    #: Aynı makine-metrik çiftine yazan birden çok adres.
    conflicts: List[str] = field(default_factory=list)
    #: Kurulmuş eşleme sayısı.
    mapped: int = 0
    #: Seçili etiket sayısı.
    selected: int = 0

    @property
    def coverage(self) -> Optional[float]:
        """Seçili etiketlerin ne kadarı eşlendi? Seçim yoksa `None`.

        Sıfır dönseydi, hiç etiket seçilmemiş bir kurulum "%0 eşlendi" diye
        okunur ve eksik görünürdü — oysa eşlenecek bir şey yoktur.
        """
        if self.selected <= 0:
            return None
        return round(self.mapped / self.selected, 4)

    @property
    def ready(self) -> bool:
        """Kurulum bu eşlemeyle tamamlanabilir mi?"""
        return self.selected > 0 and not self.unmapped and not self.conflicts

    def to_dict(self) -> Dict[str, Any]:
        return {
            "unmapped": list(self.unmapped),
            "conflicts": list(self.conflicts),
            "mapped": self.mapped,
            "selected": self.selected,
            "coverage": self.coverage,
            "ready": self.ready,
        }


def review(selected: Iterable[str], entries: Iterable[MappingEntry]) -> MappingReview:
    """Eşleme tablosunu denetler.

    İki sorun aranır: eşlenmemiş etiket ve **çakışma**. Çakışma, iki farklı
    adresin aynı makinenin aynı metriğine yazmasıdır; ikisi de yazarsa
    hangisinin kazandığı belirsizdir ve ekrandaki sayı rastgele değişir.
    """
    chosen = list(selected)
    rows = list(entries)
    mapped_addresses = {item.address for item in rows if item.address in chosen}

    pairs: Dict[str, List[str]] = {}
    for item in rows:
        key = f"{item.machine_id}::{item.metric}"
        pairs.setdefault(key, []).append(item.address)

    return MappingReview(
        unmapped=sorted(item for item in chosen if item not in mapped_addresses),
        conflicts=sorted(key for key, addresses in pairs.items() if len(addresses) > 1),
        mapped=len(mapped_addresses),
        selected=len(chosen),
    )


def apply_suggestions(
    entries: Iterable[MappingEntry],
    suggestions: Iterable[MappingSuggestion],
    selected: Iterable[str],
    min_score: int = 2,
) -> List[MappingEntry]:
    """Yeterince kanıtlı önerileri eşlemeye çevirir.

    `min_score` iki: tek kanıta dayanan bir öneri (yalnızca metrik sözcüğü
    geçiyor, makine adı yok) sessizce uygulanacak kadar güvenilir değildir.
    Var olan eşlemeler korunur — kullanıcının elle kurduğunu öneri ezmemelidir.
    """
    chosen = set(selected)
    result = {item.address: item for item in entries}
    for suggestion in suggestions:
        if suggestion.address not in chosen:
            continue
        if suggestion.address in result:
            continue
        if not suggestion.complete or suggestion.score < min_score:
            continue
        result[suggestion.address] = MappingEntry(
            address=suggestion.address,
            machine_id=str(suggestion.machine_id),
            metric=str(suggestion.metric),
            source="suggestion",
        )
    return sorted(result.values(), key=lambda item: item.address)


def undo(entries: Iterable[MappingEntry], address: str) -> List[MappingEntry]:
    """Bir eşlemeyi kaldırır.

    Yanlış bir eşlemenin bedeli, haftalar sonra raporda fark edilen yanlış bir
    üretim sayısıdır; geri almanın bedeli bir tıklamadır.
    """
    return [item for item in entries if item.address != address]


def undo_suggestions(entries: Iterable[MappingEntry]) -> List[MappingEntry]:
    """Öneriden gelen bütün eşlemeleri kaldırır; elle kurulanlar kalır.

    Toplu geri alma, kullanıcının "önerileri uygula" düğmesine yanlışlıkla
    basmasını tek adımda düzeltir. Elle kurulanların da silinmesi, kullanıcının
    kendi emeğini kaybetmesi olurdu.
    """
    return [item for item in entries if item.source != "suggestion"]
