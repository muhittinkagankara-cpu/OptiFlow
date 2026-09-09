"""Pilot kurulum kontrol listesi.

Bu listenin tek kuralı SALES-14'ten beri aynıdır: **hiçbir adım kullanıcının
işaretlemesiyle tamamlanmaz.** Her adımın durumu sistemin gerçek hâlinden
türer — sunucu gerçekten ayakta mı, lisans gerçekten etkin mi, ilk veri
gerçekten geldi mi.

Elle işaretlenebilen bir liste, kurulumu yapan kişinin iyi niyetini ölçer;
ürünün hazır olup olmadığını değil. İlk fabrika kurulumunda yanlış işaretlenmiş
tek bir kutu, sahada saatlerce süren bir arıza aramasına yol açar.

Üç durum, dört değil
--------------------
* **Tamam** — ölçüldü ve doğrulandı.
* **Bekliyor** — ölçüldü, henüz yapılmadı; birinin bir iş yapması gerekiyor.
* **Ölçülemedi** — sistem bu adımın durumunu okuyamıyor.

Üçüncüsü ikincisiyle karıştırılmaz: birincisinde eksik olan **iş**,
ikincisinde **ölçümdür**. "Yedek doğrulanmadı" ile "yedek durumu okunamadı"
farklı iki sorundur ve farklı iki kişiyi ilgilendirir.

Müşteri imzası neden burada
---------------------------
Son adım imzadır ve o da elle işaretlenmez: imzanın **kaydedildiği**
doğrulanır. İmzasız bir kurulum teknik olarak çalışıyor olabilir ama teslim
edilmemiştir.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class StepState(str, Enum):
    """Bir adımın durumu."""

    DONE = "done"
    PENDING = "pending"
    #: Ölçülemedi; "bekliyor" ile aynı şey değildir.
    UNKNOWN = "unknown"


STEP_STATE_LABEL: Dict[StepState, str] = {
    StepState.DONE: "Tamam",
    StepState.PENDING: "Bekliyor",
    StepState.UNKNOWN: "Ölçülemedi",
}


@dataclass(frozen=True)
class ChecklistStep:
    """Kontrol listesindeki tek bir adım."""

    id: str
    label: str
    state: StepState
    #: Bu durumun **nedeni**; her zaman doludur.
    reason: str
    #: Kullanıcının yapması gereken iş; yapacak bir şey yoksa `None`.
    action: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "state": self.state.value,
            "state_label": STEP_STATE_LABEL[self.state],
            "reason": self.reason,
            "action": self.action,
        }


@dataclass
class DeploymentInput:
    """Kontrol listesinin okuduğu gerçek ölçümler.

    Her alan üç değerli olabilir: `True`, `False` ve `None` (ölçülemedi).
    `None`'ı `False` saymak, okunamayan bir ölçümü "yapılmadı" diye
    raporlamak olurdu.
    """

    #: Sunucu sağlık ucundan yanıt alındı mı?
    server_up: Optional[bool] = None
    #: Kalıcılık veritabanı modunda mı? Bellek modu kurulum için yeterli değil.
    database_ready: Optional[bool] = None
    #: Lisans etkin mi?
    license_active: Optional[bool] = None
    #: Cihaz keşfi yapıldı mı? Bulunan etiket sayısı; yapılmadıysa `None`.
    discovered_tags: Optional[int] = None
    #: Eşlemesi kurulmuş etiket sayısı; ölçülemediyse `None`.
    mapped_tags: Optional[int] = None
    #: Eşlenmemiş etiket sayısı; ölçülemediyse `None`.
    unmapped_tags: Optional[int] = None
    #: Telemetri tablosundaki satır sayısı; ölçülemediyse `None`.
    telemetry_rows: Optional[int] = None
    #: Şimdiye kadar açılmış alarm sayısı; ölçülemediyse `None`.
    alarms_raised: Optional[int] = None
    #: Hesaplanmış OEE; hesaplanamadıysa `None`.
    oee: Optional[float] = None
    #: Doğrulanmış yedek var mı?
    backup_verified: Optional[bool] = None
    #: Müşteri imzası kaydedildi mi?
    signature_recorded: Optional[bool] = None


#: Sunucudan okunamayan ölçümler için varsayılan yönlendirme.
SERVER_ACTION = "Sunucuya erişimi doğrulayın."


def _step(
    step_id: str,
    label: str,
    state: StepState,
    reason: str,
    action: Optional[str] = None,
) -> ChecklistStep:
    return ChecklistStep(
        id=step_id, label=label, state=state, reason=reason, action=action
    )


def _unknown(
    step_id: str, label: str, what: str, action: str = SERVER_ACTION
) -> ChecklistStep:
    """Ölçülemeyen bir adım.

    `action` bu ölçümün **nerede** üretildiğini söyler. Hepsine "sunucuya
    erişimi doğrulayın" demek, sunucuya erişilebildiği hâlde ölçümü verilmemiş
    bir adımı sunucu arızası gibi gösterirdi — tarayıcıda tam olarak böyle
    göründü.
    """
    return _step(
        step_id,
        label,
        StepState.UNKNOWN,
        f"{what} bu çağrıya verilmedi; adımın durumu bilinmiyor.",
        action,
    )


def _flag_step(
    step_id: str,
    label: str,
    value: Optional[bool],
    done_reason: str,
    pending_reason: str,
    action: str,
    unknown_what: str,
    unknown_action: Optional[str] = None,
) -> ChecklistStep:
    """Üç değerli bir bayrağı adıma çevirir.

    Ölçülemeyen hâlde de **yapılacak iş** yazılır ve bu, bekleyen hâldekinden
    farklı olabilir: birinde iş yapılmamıştır, ötekinde ölçüm verilmemiştir.
    """
    if value is None:
        return _unknown(step_id, label, unknown_what, unknown_action or action)
    if value:
        return _step(step_id, label, StepState.DONE, done_reason)
    return _step(step_id, label, StepState.PENDING, pending_reason, action)


def build_checklist(data: DeploymentInput) -> List[ChecklistStep]:
    """On adımın tamamı, sırayla."""
    steps: List[ChecklistStep] = [
        _flag_step(
            "server",
            "Sunucu çalışıyor",
            data.server_up,
            "Sağlık ucundan yanıt alındı.",
            "Sağlık ucu yanıt vermiyor.",
            "Sunucuyu başlatın ve günlüğü inceleyin.",
            "Sunucu durumu",
        ),
        _flag_step(
            "database",
            "Veritabanı hazır",
            data.database_ready,
            "Kalıcılık veritabanı modunda çalışıyor.",
            "Kalıcılık bellek modunda; sunucu yeniden başladığında veri kaybolur.",
            "DATABASE_URL tanımlayın ve göçleri uygulayın.",
            "Kalıcılık modu",
        ),
        _flag_step(
            "license",
            "Lisans aktif",
            data.license_active,
            "Lisans etkin ve sınırlar aşılmamış.",
            "Lisans etkin değil ya da sınır aşıldı.",
            "Lisansı yenileyin veya planı yükseltin.",
            "Lisans durumu",
        ),
    ]

    # -- Keşif --------------------------------------------------------------
    if data.discovered_tags is None:
        steps.append(
            _unknown(
                "discovery",
                "Cihaz keşfi",
                "Keşif sonucu",
                "Devreye alma sihirbazında keşfi çalıştırın.",
            )
        )
    elif data.discovered_tags > 0:
        steps.append(
            _step(
                "discovery",
                "Cihaz keşfi",
                StepState.DONE,
                f"Cihazda {data.discovered_tags} etiket bulundu.",
            )
        )
    else:
        steps.append(
            _step(
                "discovery",
                "Cihaz keşfi",
                StepState.PENDING,
                "Hiç etiket bulunamadı.",
                "Uç adresini ve kimlik bilgilerini doğrulayın.",
            )
        )

    # -- Eşleme -------------------------------------------------------------
    if data.mapped_tags is None or data.unmapped_tags is None:
        steps.append(
            _unknown(
                "mapping",
                "Mapping",
                "Eşleme tablosu",
                "Devreye alma sihirbazında eşlemeyi tamamlayın.",
            )
        )
    elif data.mapped_tags > 0 and data.unmapped_tags == 0:
        steps.append(
            _step(
                "mapping",
                "Mapping",
                StepState.DONE,
                f"{data.mapped_tags} etiketin tamamı eşlendi.",
            )
        )
    elif data.unmapped_tags > 0:
        steps.append(
            _step(
                "mapping",
                "Mapping",
                StepState.PENDING,
                f"{data.unmapped_tags} etiketin eşlemesi yok; verisi hiçbir "
                "makineye yazılmaz.",
                "Eşleme sihirbazında eksik etiketleri tamamlayın.",
            )
        )
    else:
        steps.append(
            _step(
                "mapping",
                "Mapping",
                StepState.PENDING,
                "Hiç eşleme kurulmadı.",
                "Eşleme sihirbazını çalıştırın.",
            )
        )

    # -- İlk veri -----------------------------------------------------------
    if data.telemetry_rows is None:
        steps.append(_unknown("first_data", "İlk veri geldi", "Telemetri sayacı"))
    elif data.telemetry_rows > 0:
        steps.append(
            _step(
                "first_data",
                "İlk veri geldi",
                StepState.DONE,
                f"Telemetri tablosuna {data.telemetry_rows} satır yazıldı.",
            )
        )
    else:
        steps.append(
            _step(
                "first_data",
                "İlk veri geldi",
                StepState.PENDING,
                "Telemetri tablosu boş; cihazdan henüz veri gelmedi.",
                "Akışı başlatın ve bağlantı durumunu kontrol edin.",
            )
        )

    # -- Alarm testi --------------------------------------------------------
    if data.alarms_raised is None:
        steps.append(_unknown("alarm_test", "Alarm testi geçti", "Alarm sayacı"))
    elif data.alarms_raised > 0:
        steps.append(
            _step(
                "alarm_test",
                "Alarm testi geçti",
                StepState.DONE,
                f"{data.alarms_raised} alarm gerçekten tetiklendi.",
            )
        )
    else:
        steps.append(
            _step(
                "alarm_test",
                "Alarm testi geçti",
                StepState.PENDING,
                "Hiç alarm tetiklenmedi; zincirin çalıştığı doğrulanmadı.",
                "Bir bağlantıyı geçici olarak kesip alarmın açıldığını görün.",
            )
        )

    # -- OEE ----------------------------------------------------------------
    if data.oee is None:
        steps.append(
            _step(
                "oee",
                "OEE hesaplandı",
                StepState.PENDING,
                "OEE hesaplanamadı; planlanan süre ya da ideal çevrim eksik.",
                "Vardiya süresini ve ideal çevrim süresini girin.",
            )
        )
    else:
        steps.append(
            _step(
                "oee",
                "OEE hesaplandı",
                StepState.DONE,
                f"OEE %{round(data.oee * 100)} olarak hesaplandı.",
            )
        )

    steps.append(
        _flag_step(
            "backup",
            "Backup doğrulandı",
            data.backup_verified,
            "Yedek alındı ve sağlaması doğrulandı.",
            "Doğrulanmış yedek yok.",
            "Operasyon ekranından yedek alın ve geri yüklemeyi deneyin.",
            "Yedek durumu",
            "Operasyon ekranından yedek durumunu okuyun.",
        )
    )
    steps.append(
        _flag_step(
            "signature",
            "Müşteri imzası",
            data.signature_recorded,
            "Kabul raporu imzalandı ve kaydedildi.",
            "Kabul raporu henüz imzalanmadı.",
            "Saha kabul raporunu yazdırıp imzalatın.",
            "İmza kaydı",
            "Saha kabul raporunu yazdırıp imzalatın, sonra işaretleyin.",
        )
    )
    return steps


@dataclass
class DeploymentReport:
    """Kontrol listesinin tam görünümü."""

    steps: List[ChecklistStep] = field(default_factory=list)

    @property
    def done(self) -> int:
        return len([item for item in self.steps if item.state is StepState.DONE])

    @property
    def pending(self) -> int:
        return len([item for item in self.steps if item.state is StepState.PENDING])

    @property
    def unknown(self) -> int:
        return len([item for item in self.steps if item.state is StepState.UNKNOWN])

    @property
    def total(self) -> int:
        return len(self.steps)

    @property
    def ready(self) -> bool:
        """Kurulum tamamlandı mı?

        Ölçülemeyen bir adım varken **tamamlandı sayılmaz**: bilinmeyen bir
        adımı geçmiş saymak, listenin tamamını güvenilmez kılardı.
        """
        return bool(self.steps) and all(
            item.state is StepState.DONE for item in self.steps
        )

    @property
    def ratio(self) -> Optional[float]:
        """Tamamlanma oranı; adım yoksa `None`."""
        if not self.steps:
            return None
        return round(self.done / len(self.steps), 4)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "steps": [item.to_dict() for item in self.steps],
            "done": self.done,
            "pending": self.pending,
            "unknown": self.unknown,
            "total": self.total,
            "ready": self.ready,
            "ratio": self.ratio,
        }


def build_report(data: DeploymentInput) -> DeploymentReport:
    return DeploymentReport(steps=build_checklist(data))


def describe(report: DeploymentReport) -> str:
    """Listenin tek cümlelik özeti."""
    if not report.steps:
        return "Kontrol listesi okunamadı."
    if report.ready:
        return "Kurulum tamamlandı; on adımın tamamı doğrulandı."
    parts = [f"{report.done}/{report.total} adım tamam"]
    if report.pending:
        parts.append(f"{report.pending} adım bekliyor")
    if report.unknown:
        parts.append(f"{report.unknown} adım ölçülemedi")
    return " · ".join(parts)
