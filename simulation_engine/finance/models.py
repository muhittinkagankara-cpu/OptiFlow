"""Finansal kayıp katmanının veri modelleri.

Simülasyon şemalarından (`models/schemas.py`) ayrı tutulmaları bilinçlidir:
para, motorun ürettiği bir büyüklük değildir. Motor dakika ve adet sayar;
bunların ne kadar ettiği tümüyle işletmenin kendi maliyet oranlarına bağlıdır
ve bu oranlar simülasyonun hiçbir hesabına girmez. İki dünyayı ayrı şemalarda
tutmak, ileride maliyet modeli değiştiğinde simülasyon şemasının hiç
etkilenmemesini sağlar.

Şeffaflık
---------
Her kalem, değerinin **nereden geldiğini** taşır (`MetricProvenance`):

* `observed`   — motorun doğrudan saydığı bir büyüklük (arıza dakikası, hurda
  adedi). Sayımdır, varsayım içermez.
* `calculated` — gözlenen bir büyüklüğün, kullanıcının verdiği bir oranla
  çarpımı. Aritmetik kesindir; belirsizlik yalnızca oranın kendisindedir.
* `estimated`  — bir modelden türetilmiş kestirim (ör. darboğaz açlığında
  üretilebilecek birim sayısı). Sayım değildir; varsayım içerir.

Bu ayrım bir süs değil: bir üretim müdürüne "bugün 12.400 TL kaybettiniz"
demek ile "12.400 TL kaybetmiş olabilirsiniz, bunun 9.000'i sayıma, 3.400'ü
kestirime dayanıyor" demek arasındaki fark, ürünün güvenilir olup olmamasıdır.
"""

from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

#: Bir kalemin parasal karşılığının hesaplanabilmesi için gereken oranlar.
#: Eksik olan her oran, ilgili kalemi hesap dışı bırakır (sıfır kabul edilmez;
#: "bilinmiyor" ile "sıfır" farklı şeylerdir).
REQUIRED_RATE_BY_COMPONENT: dict[str, str] = {
    "downtime_loss": "machine_cost_per_hour",
    "waiting_loss": "labor_cost_per_hour",
    "scrap_loss": "scrap_cost_per_unit",
    "opportunity_loss": "contribution_margin",
}


class MetricProvenance(str, Enum):
    """Bir değerin nereden geldiği."""

    OBSERVED = "observed"
    CALCULATED = "calculated"
    ESTIMATED = "estimated"


class FinancialSettings(BaseModel):
    """Fabrika düzeyindeki maliyet oranları.

    Hepsi isteğe bağlıdır ve **varsayılan değeri yoktur**. Eksik bir oran için
    uydurma bir sayı kullanmak, kullanıcının hiç vermediği bir varsayımı ona
    kendi verisiymiş gibi geri sunmak olurdu; bunun yerine ilgili kalem
    hesaplanmaz ve eksikliği raporda açıkça belirtilir.
    """

    model_config = ConfigDict(extra="forbid")

    selling_price: Optional[float] = Field(
        default=None, ge=0.0, description="Birim satis fiyati"
    )
    contribution_margin: Optional[float] = Field(
        default=None,
        ge=0.0,
        description=(
            "Birim katki payi (satis fiyati eksi degisken maliyet). Firsat "
            "maliyeti bununla hesaplanir; satis fiyatiyla degil — uretilemeyen "
            "bir birimin kaybi cirosu degil, katki payidir."
        ),
    )
    labor_cost_per_hour: Optional[float] = Field(
        default=None, ge=0.0, description="Saatlik iscilik maliyeti"
    )
    machine_cost_per_hour: Optional[float] = Field(
        default=None, ge=0.0, description="Saatlik makine maliyeti"
    )
    scrap_cost_per_unit: Optional[float] = Field(
        default=None, ge=0.0, description="Hurdaya ayrilan birim basina maliyet"
    )
    overtime_cost_per_hour: Optional[float] = Field(
        default=None,
        ge=0.0,
        description=(
            "Saatlik fazla mesai maliyeti. Kayip hesabina girmez; kaybi telafi "
            "etmenin maliyetini kiyaslamak icin saklanir."
        ),
    )
    production_minutes_per_day: Optional[float] = Field(
        default=None,
        gt=0.0,
        description=(
            "Gunde kac dakika uretim yapildigi (tek vardiya 480, cift 960, "
            "kesintisiz 1440). Gunluk kayip projeksiyonu icin gereklidir ve "
            "**varsayilani yoktur**: uydurulmus bir vardiya suresiyle uretilen "
            "gunluk rakam, hic rakam vermemekten kotudur."
        ),
    )

    def rate(self, name: str) -> Optional[float]:
        """Adına göre bir oranı döndürür; tanımsızsa `None`."""
        return getattr(self, name, None)


class LossComponent(BaseModel):
    """Tek bir kayıp kaleminin parasal karşılığı ve kaynağı."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(description="Kalem anahtari, or. 'downtime_loss'")
    label: str = Field(description="Kullaniciya gosterilecek ad")
    amount: float = Field(ge=0.0, description="Parasal karsilik")
    provenance: MetricProvenance
    quantity: float = Field(
        ge=0.0, description="Olculen ham buyukluk (saat ya da adet)"
    )
    quantity_unit: str = Field(description="Ham buyuklugun birimi, or. 'saat'")
    rate_name: str = Field(description="Kullanilan oranin adi")
    rate_value: Optional[float] = Field(
        default=None, description="Kullanilan oranin degeri; eksikse None"
    )
    is_available: bool = Field(
        description="Gerekli oran verildi mi? Verilmediyse tutar 0 kabul EDILMEZ"
    )
    basis: str = Field(description="Tutarin nasil elde edildiginin aciklamasi")


class FinancialImpact(BaseModel):
    """Bir koşumun toplam finansal kaybı.

    İlk beş alan şartnamede tanımlanan sözleşmedir; kalanlar aynı hesabın
    şeffaflık bilgisidir ve sözleşmeyi bozmadan üzerine eklenir.
    """

    model_config = ConfigDict(extra="forbid")

    downtime_loss: float = Field(ge=0.0)
    waiting_loss: float = Field(ge=0.0)
    scrap_loss: float = Field(ge=0.0)
    opportunity_loss: float = Field(ge=0.0)
    total_loss: float = Field(ge=0.0)

    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description=(
            "Sonuca ne kadar guvenilebilecegi. Eksik oranlar ve kestirime "
            "dayanan pay arttikca duser."
        ),
    )
    data_completeness: float = Field(
        ge=0.0,
        le=1.0,
        description="Gerekli maliyet oranlarinin kaci verildi (0-1)",
    )

    components: List[LossComponent] = Field(
        default_factory=list, description="Kalem kalem dokum ve kaynaklari"
    )
    missing_inputs: List[str] = Field(
        default_factory=list,
        description="Verilmedigi icin hesaplanamayan oranlarin adlari",
    )
    notes: List[str] = Field(
        default_factory=list,
        description="Sonucun nasil okunmasi gerektigine dair uyarilar",
    )


class StationFinancialImpact(BaseModel):
    """Tek bir istasyonun kayıp dökümü."""

    model_config = ConfigDict(extra="forbid")

    station_id: str
    station_name: str
    downtime_loss: float = Field(ge=0.0)
    waiting_loss: float = Field(ge=0.0)
    scrap_loss: float = Field(ge=0.0)
    opportunity_loss: float = Field(ge=0.0)
    total_loss: float = Field(ge=0.0)
    is_bottleneck: bool = False


class HeatBand(str, Enum):
    """Isı skorunun renk bandı.

    Renk backend'de belirlenir, arayüzde değil: eşikler iki yerde tanımlansaydı
    biri değiştiğinde diğeri sessizce eskir ve aynı skor iki ekranda iki farklı
    renk alırdı.
    """

    GREEN = "green"
    YELLOW = "yellow"
    ORANGE = "orange"
    RED = "red"


class HeatComponent(BaseModel):
    """Isı skorunun tek bir bileşeni ve skora katkısı.

    İpucu balonunun içeriğidir: bir kutunun **neden** kırmızı olduğu, kutuya
    bakan kişi tarafından okunabilmelidir. Yalnızca skor gösterilseydi, sayı
    bir hükme dönüşür ama gerekçesi görünmez olurdu.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(description="Bilesen anahtari, or. 'loss'")
    label: str = Field(description="Kullaniciya gosterilecek ad")
    raw_value: float = Field(description="Ham deger (para ya da 0-1 oran)")
    normalized: float = Field(ge=0.0, le=1.0, description="0-1'e normalize hali")
    weight: float = Field(ge=0.0, le=1.0, description="Bilesenin agirligi")
    contribution: float = Field(
        ge=0.0, description="Bu bilesenin 100'luk skora katkisi"
    )


class StationHeat(BaseModel):
    """Bir istasyonun ısı skoru."""

    model_config = ConfigDict(extra="forbid")

    station_id: str
    station_name: str
    score: float = Field(ge=0.0, le=100.0)
    band: HeatBand
    components: List[HeatComponent] = Field(default_factory=list)

    total_loss: float = Field(
        ge=0.0,
        description=(
            "Istasyonun mutlak parasal kaybi. Skor goreli oldugu icin bu tutar "
            "skorla BIRLIKTE gosterilmelidir."
        ),
    )
    is_bottleneck: bool = False
    is_relative: bool = Field(
        description=(
            "Kayip bileseni koşumdaki en kotu istasyona gore mi olculdu? "
            "Hicbir istasyonda kayip yoksa False olur ve skor yalnizca "
            "kullanim/bekleme/fire'den gelir."
        )
    )


class ImprovementSuggestion(BaseModel):
    """En yüksek getirili iyileştirme önerisi.

    Öneri metinleri Kısıtlar Teorisi'nin mevcut sözlüğünden gelir
    (`analytics/bottleneck.py`); burada yeni bir tavsiye üretilmez, yalnızca
    hangi istasyonun hangi kalemde en çok para kaybettiği belirlenip o kaleme
    karşılık gelen bilinen eylem seçilir.
    """

    model_config = ConfigDict(extra="forbid")

    station_id: str
    station_name: str
    dominant_loss: str = Field(description="En buyuk kalemin anahtari")
    recoverable_amount: float = Field(
        ge=0.0, description="Bu eylemin hedefledigi kayip tutari"
    )
    action: str = Field(description="Onerilen somut eylem")
    rationale: str = Field(description="Neden bu istasyon ve bu eylem")


class FinancialReport(BaseModel):
    """Finansal etki raporunun tamamı."""

    model_config = ConfigDict(extra="forbid")

    impact: FinancialImpact
    stations: List[StationFinancialImpact] = Field(default_factory=list)
    suggestions: List[ImprovementSuggestion] = Field(default_factory=list)

    heat: List[StationHeat] = Field(
        default_factory=list,
        description=(
            "Isi haritasi: en sicaktan en soguga sirali istasyon skorlari. "
            "Ayni yanitta tasinmasi bilinclidir — arayuz ayni koşum icin ikinci "
            "bir istek atmak zorunda kalmaz ve iki panel her zaman ayni veriyi "
            "gosterir."
        ),
    )
    top_loss_stations: List[StationHeat] = Field(
        default_factory=list,
        description=(
            "En cok para kaybettiren istasyonlar; skora gore DEGIL tutara gore "
            "siralanir. En sicak istasyon her zaman en pahali istasyon degildir."
        ),
    )

    recoverable_loss: float = Field(
        ge=0.0,
        description=(
            "Bilinen bir eylemin dogrudan hedefleyebilecegi kayip toplami. "
            "Toplam kaybin tamami degildir: her kayip kalemi giderilebilir "
            "degildir."
        ),
    )
    daily_loss: Optional[float] = Field(
        default=None,
        description=(
            "Gunluk kayip projeksiyonu. Yalnizca `production_minutes_per_day` "
            "verildiginde doldurulur; aksi halde None kalir."
        ),
    )
    window_minutes: float = Field(
        gt=0.0, description="Kaybin olculdugu istatistik penceresi (dakika)"
    )
