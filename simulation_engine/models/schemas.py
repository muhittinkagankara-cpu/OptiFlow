"""Pydantic veri modelleri — Şartname Bölüm 2.

Bu modül iki grup şema içerir:

1. **Girdi şemaları** (`Distribution`, `Station`, `Connection`, `ArrivalProcess`,
   `SimulationConfig`): şartnamede tanımlanan simülasyon konfigürasyonu.
2. **Çıktı şemaları** (`StationRunMetrics`, `SystemRunMetrics`, `StabilityCheck`,
   `ReplicationResult`): `core.engine.SimulationEngine` tek bir replikasyondan
   ham gözlemleri bu tiplerle döndürür. `analytics/` katmanı (OEE, Little's Law,
   Monte Carlo güven aralığı, TOC darboğaz analizi) bu ham gözlemleri tüketerek
   Bölüm 5'teki API yanıtını üretir. Motor katmanının hiçbir türetilmiş metriği
   hesaplamaması bilinçlidir: analitik formüller tek bir yerde, `analytics/`
   içinde tutulur ve bağımsız olarak test edilebilir.

Kaynaklar
---------
- Law, A. M. (2015). *Simulation Modeling and Analysis*, 5th ed., McGraw-Hill.
- Gross, D. & Harris, C. M. (2008). *Fundamentals of Queueing Theory*, 4th ed.
- Banks, J. et al. (2010). *Discrete-Event System Simulation*, 5th ed.
"""

from typing import Any, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, model_validator

# --------------------------------------------------------------------------- #
# Adlandırılmış sabitler (magic number kullanılmaz)
# --------------------------------------------------------------------------- #

#: `buffer_capacity_before` için sonsuz kapasiteyi ifade eden sentinel değer.
INFINITE_CAPACITY: int = -1

#: Monte Carlo için önerilen asgari replikasyon sayısı. Merkezi Limit Teoremi'nin
#: normal yaklaşımının güvenilir olması için literatürde kabul gören eşik
#: (Law 2015, Bölüm 9.4.1). Zorlayıcı değildir, yalnızca varsayılan olarak kullanılır.
MIN_RECOMMENDED_REPLICATIONS: int = 30

#: Yönlendirme olasılıkları toplamı kontrolünde kullanılan kayan nokta toleransı.
ROUTING_PROBABILITY_TOLERANCE: float = 1e-9

#: Ampirik dağılım için gereken asgari gözlem sayısı (sürekli enterpolasyon
#: yapılabilmesi için en az iki nokta gerekir).
MIN_EMPIRICAL_OBSERVATIONS: int = 2


DistributionType = Literal["exponential", "normal", "triangular", "constant", "empirical"]

#: Kullanıcı dostu parametre adlarının kanonik adlara eşlemesi. Doğrulamadan
#: sonra `params` sözlüğü her zaman kanonik anahtarları içerir; böylece
#: `distributions/` katmanı tek bir isimlendirmeye güvenebilir.
_PARAMETER_ALIASES: Dict[str, Dict[str, str]] = {
    "exponential": {"beta": "mean", "scale": "mean", "lambda": "rate", "lam": "rate"},
    "normal": {"mu": "mean", "sigma": "std", "std_dev": "std", "stdev": "std"},
    "triangular": {
        "a": "min",
        "b": "max",
        "c": "mode",
        "minimum": "min",
        "maximum": "max",
        "most_likely": "mode",
    },
    "constant": {"v": "value", "duration": "value"},
    "empirical": {"data": "values", "observations": "values"},
}


class Distribution(BaseModel):
    """Bir süre değişkeninin olasılık dağılımı.

    `params` içeriği `type` alanına göre doğrulanır ve kanonik anahtarlara
    normalize edilir:

    ==============  ==========================================================
    type            kanonik params anahtarları
    ==============  ==========================================================
    exponential     ``mean`` (> 0) — ``rate`` verilirse ``mean = 1 / rate``
    normal          ``mean`` (>= 0), ``std`` (> 0) — sıfırdan soldan budanmış
    triangular      ``min``, ``mode``, ``max``  (0 <= min <= mode <= max)
    constant        ``value`` (>= 0)
    empirical       ``values`` (>= 2 adet, hepsi >= 0), ``method``
                    ("continuous" | "discrete", varsayılan "continuous")
    ==============  ==========================================================

    Tüm dağılımlar bir **süre** modeller (varışlar arası zaman, işlem süresi,
    onarım süresi); bu nedenle negatif değer üretmeleri yasaktır ve parametre
    doğrulaması bunu kaynağında engeller.
    """

    model_config = ConfigDict(extra="forbid")

    type: DistributionType
    params: Dict[str, Any] = Field(default_factory=dict)

    # ------------------------------------------------------------------ #
    # Doğrulama
    # ------------------------------------------------------------------ #
    @model_validator(mode="after")
    def _normalize_and_validate_params(self) -> "Distribution":
        """Takma adları çözer ve tipe özgü zorunlu parametreleri doğrular."""
        aliases = _PARAMETER_ALIASES.get(self.type, {})
        normalized: Dict[str, Any] = {}
        for key, value in self.params.items():
            canonical = aliases.get(key, key)
            if canonical in normalized:
                raise ValueError(
                    f"{self.type} dagilimi icin '{canonical}' parametresi birden fazla "
                    f"kez (takma adlariyla) verilmis."
                )
            normalized[canonical] = value

        validator = {
            "exponential": self._validate_exponential,
            "normal": self._validate_normal,
            "triangular": self._validate_triangular,
            "constant": self._validate_constant,
            "empirical": self._validate_empirical,
        }[self.type]
        self.params = validator(normalized)
        return self

    @staticmethod
    def _require(params: Dict[str, Any], key: str, dist_type: str) -> float:
        """Zorunlu sayısal parametreyi çeker; yoksa veya sayısal değilse hata verir."""
        if key not in params:
            raise ValueError(f"{dist_type} dagilimi '{key}' parametresini gerektirir.")
        value = params[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{dist_type}.{key} sayisal olmalidir, alinan: {value!r}")
        return float(value)

    @classmethod
    def _validate_exponential(cls, params: Dict[str, Any]) -> Dict[str, Any]:
        """Üstel dağılım: mean > 0 (veya rate > 0, mean = 1 / rate olarak saklanır)."""
        if "mean" in params and "rate" in params:
            raise ValueError("Ustel dagilimda 'mean' ve 'rate' birlikte verilemez.")
        if "rate" in params:
            rate = cls._require(params, "rate", "exponential")
            if rate <= 0.0:
                raise ValueError("Ustel dagilimda 'rate' (lambda) pozitif olmalidir.")
            return {"mean": 1.0 / rate}
        mean = cls._require(params, "mean", "exponential")
        if mean <= 0.0:
            raise ValueError("Ustel dagilimda 'mean' pozitif olmalidir.")
        return {"mean": mean}

    @classmethod
    def _validate_normal(cls, params: Dict[str, Any]) -> Dict[str, Any]:
        """Normal dağılım: mean >= 0 ve std > 0."""
        mean = cls._require(params, "mean", "normal")
        std = cls._require(params, "std", "normal")
        if std <= 0.0:
            raise ValueError("Normal dagilimda 'std' pozitif olmalidir.")
        if mean < 0.0:
            raise ValueError("Normal dagilim bir sure modelledigi icin 'mean' negatif olamaz.")
        return {"mean": mean, "std": std}

    @classmethod
    def _validate_triangular(cls, params: Dict[str, Any]) -> Dict[str, Any]:
        """Üçgen dağılım: 0 <= min <= mode <= max ve min < max."""
        low = cls._require(params, "min", "triangular")
        mode = cls._require(params, "mode", "triangular")
        high = cls._require(params, "max", "triangular")
        if low < 0.0:
            raise ValueError("Ucgen dagilimda 'min' negatif olamaz (sure modeli).")
        if not low <= mode <= high:
            raise ValueError(
                f"Ucgen dagilimda min <= mode <= max kosulu saglanmali; "
                f"alinan min={low}, mode={mode}, max={high}."
            )
        if low == high:
            raise ValueError(
                "Ucgen dagilimda min == max dejenere durumdur; "
                "sabit sure icin type='constant' kullanin."
            )
        return {"min": low, "mode": mode, "max": high}

    @classmethod
    def _validate_constant(cls, params: Dict[str, Any]) -> Dict[str, Any]:
        """Sabit (deterministik) süre: value >= 0."""
        value = cls._require(params, "value", "constant")
        if value < 0.0:
            raise ValueError("Sabit dagilimda 'value' negatif olamaz (sure modeli).")
        return {"value": value}

    @classmethod
    def _validate_empirical(cls, params: Dict[str, Any]) -> Dict[str, Any]:
        """Ampirik dağılım: en az iki negatif olmayan gözlem ve geçerli yöntem."""
        if "values" not in params:
            raise ValueError("Ampirik dagilim 'values' parametresini gerektirir.")
        raw = params["values"]
        if not isinstance(raw, (list, tuple)):
            raise ValueError("empirical.values bir sayi listesi olmalidir.")
        if len(raw) < MIN_EMPIRICAL_OBSERVATIONS:
            raise ValueError(
                f"Ampirik dagilim en az {MIN_EMPIRICAL_OBSERVATIONS} gozlem gerektirir, "
                f"alinan: {len(raw)}."
            )
        values: List[float] = []
        for item in raw:
            if isinstance(item, bool) or not isinstance(item, (int, float)):
                raise ValueError(f"empirical.values sayisal olmalidir, alinan: {item!r}")
            if item < 0.0:
                raise ValueError("empirical.values negatif deger iceremez (sure modeli).")
            values.append(float(item))

        method = params.get("method", "continuous")
        if method not in ("continuous", "discrete"):
            raise ValueError(
                f"empirical.method 'continuous' veya 'discrete' olmalidir, alinan: {method!r}"
            )
        return {"values": values, "method": method}

    # ------------------------------------------------------------------ #
    # Kolaylık kurucuları (senaryo kurulumu ve testler için)
    # ------------------------------------------------------------------ #
    @classmethod
    def exponential(cls, mean: float) -> "Distribution":
        """Ortalaması `mean` olan üstel dağılım (Poisson süreci için)."""
        return cls(type="exponential", params={"mean": mean})

    @classmethod
    def exponential_rate(cls, rate: float) -> "Distribution":
        """Hızı `rate` (lambda ya da mu) olan üstel dağılım."""
        return cls(type="exponential", params={"rate": rate})

    @classmethod
    def normal(cls, mean: float, std: float) -> "Distribution":
        """Sıfırdan soldan budanmış normal dağılım."""
        return cls(type="normal", params={"mean": mean, "std": std})

    @classmethod
    def triangular(cls, low: float, mode: float, high: float) -> "Distribution":
        """Min / mode / max tahminine dayalı üçgen dağılım."""
        return cls(type="triangular", params={"min": low, "mode": mode, "max": high})

    @classmethod
    def constant(cls, value: float) -> "Distribution":
        """Deterministik (dejenere) süre."""
        return cls(type="constant", params={"value": value})

    @classmethod
    def empirical(cls, values: List[float], method: str = "continuous") -> "Distribution":
        """Gerçek gözlemlerden oluşturulan ampirik dağılım."""
        return cls(type="empirical", params={"values": list(values), "method": method})


class Station(BaseModel):
    """Bir üretim istasyonu: paralel sunucular ve önündeki tampon (buffer).

    Kuyruk teorisi karşılığı: `num_servers` alanı M/M/c modelindeki **c**
    değeridir. `buffer_capacity_before` = -1 ise M/M/c (sonsuz kuyruk), sonlu
    ise M/M/c/K modeline karşılık gelir.

    Arıza modeli isteğe bağlıdır. `failure_rate` verildiğinde arızalar arası
    süre Exp(1 / failure_rate) ile dağılır; MTBF = 1 / failure_rate ve
    MTTR = E[repair_time_distribution]. Teorik kullanılabilirlik
    A = MTBF / (MTBF + MTTR) olup OEE'nin Availability bileşeninin beklenen
    değeridir (Nakajima 1988, *Introduction to TPM*).
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, description="Benzersiz istasyon kimligi")
    name: str = Field(min_length=1, description="Okunabilir istasyon adi")
    line_name: Optional[str] = Field(
        default=None,
        description=(
            "Istasyonun bagli oldugu hat/bolum adi (or. 'Kesim Hatti'). Yalnizca "
            "arayuzde gruplama icin kullanilir; simulasyon motorunun hesaplama "
            "mantigini hicbir sekilde etkilemez. Verilmezse istasyon gruplanmamis "
            "sayilir, bu yuzden mevcut modeller geriye donuk uyumlu kalir."
        ),
    )
    num_servers: int = Field(
        default=1,
        ge=1,
        description="Paralel makine/operator sayisi (M/M/c modelindeki c)",
    )
    service_time_distribution: Distribution = Field(
        description="Islem suresi dagilimi; hizmet hizi mu = 1 / E[islem suresi]"
    )
    failure_rate: Optional[float] = Field(
        default=None,
        description="Sunucu basina birim zamandaki ariza orani; MTBF = 1 / failure_rate",
    )
    repair_time_distribution: Optional[Distribution] = Field(
        default=None, description="Onarim suresi dagilimi; MTTR = E[bu dagilim]"
    )
    buffer_capacity_before: int = Field(
        default=INFINITE_CAPACITY,
        ge=INFINITE_CAPACITY,
        description=(
            "Istasyon onundeki kuyruk kapasitesi. Sonsuz kuyruk icin -1, "
            "tamponsuz (blokajli) hat icin 0."
        ),
    )
    scrap_rate: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description=(
            "Bu istasyonda islemi biten bir parcanin hurdaya ayrilma olasiligi "
            "(0 = hicbir fire yok, 1 = tum parcalar hurda). Hurdaya ayrilan parca "
            "sunucuyu tam islem suresi boyunca mesgul eder, uretilen birim olarak "
            "sayilir ve ardindan sistemden cikarilir; bir sonraki istasyona "
            "gitmez. OEE'nin Quality bileseni bu orandan beslenir."
        ),
    )

    @model_validator(mode="after")
    def _validate_failure_model(self) -> "Station":
        """Arıza oranı ve onarım dağılımı yalnızca birlikte anlamlıdır."""
        if (self.failure_rate is None) != (self.repair_time_distribution is None):
            raise ValueError(
                f"'{self.id}' istasyonunda ariza modeli eksik: 'failure_rate' ve "
                f"'repair_time_distribution' ya birlikte verilmeli ya da ikisi de "
                f"verilmemelidir (MTBF olmadan MTTR, MTTR olmadan MTBF anlamsizdir)."
            )
        if self.failure_rate is not None and self.failure_rate <= 0.0:
            raise ValueError(
                f"'{self.id}' istasyonunda 'failure_rate' pozitif olmalidir "
                f"(MTBF = 1 / failure_rate), alinan: {self.failure_rate}"
            )
        return self

    @property
    def mtbf(self) -> Optional[float]:
        """Ortalama arızalar arası süre (Mean Time Between Failures)."""
        return None if self.failure_rate is None else 1.0 / self.failure_rate

    @property
    def has_infinite_buffer(self) -> bool:
        """Tampon kapasitesi sınırsız mı?"""
        return self.buffer_capacity_before == INFINITE_CAPACITY


class Connection(BaseModel):
    """İki istasyon arasındaki yönlendirme bağlantısı.

    Bir istasyondan çıkan tüm bağlantıların `routing_probability` toplamı 1.0'ı
    aşamaz. Toplam 1.0'dan küçükse kalan olasılık **sistemden çıkış** anlamına
    gelir (ör. hattın sonu ya da hurdaya ayırma).
    """

    model_config = ConfigDict(extra="forbid")

    from_station_id: str = Field(min_length=1)
    to_station_id: str = Field(min_length=1)
    routing_probability: float = Field(
        default=1.0,
        gt=0.0,
        le=1.0,
        description="Birden fazla cikis varsa parcalarin bu yola gitme olasiligi",
    )


class ArrivalProcess(BaseModel):
    """Sisteme dışarıdan gelen parça akışı.

    Üstel varışlar arası süre => Poisson varış süreci; varış hızı
    lambda = 1 / E[varışlar arası süre]. Kuyruk teorisindeki M/M/... notasyonunun
    ilk 'M' harfi (Markovian) bu varsayıma karşılık gelir.
    """

    model_config = ConfigDict(extra="forbid")

    distribution: Distribution = Field(
        description="Varislar arasi sure dagilimi (Poisson sureci icin 'exponential')"
    )
    entry_station_id: str = Field(min_length=1, description="Parcalarin girdigi istasyon")


class SimulationConfig(BaseModel):
    """Tam bir simülasyon senaryosunun tanımı.

    `warmup_period_minutes` istatistiksel geçerlilik için zorunludur: kesikli
    olay simülasyonları boş ve boşta (empty-and-idle) durumdan başlar; ilk
    dönemdeki gözlemler kararlı durum (steady-state) ortalamasını aşağı yönlü
    saptırır. Isınma periyodu boyunca toplanan gözlemler silinir (Welch'in
    yöntemi; Law 2015, Bölüm 9.5.1).
    """

    model_config = ConfigDict(extra="forbid")

    stations: List[Station] = Field(min_length=1)
    connections: List[Connection] = Field(default_factory=list)
    arrival_process: ArrivalProcess
    simulation_duration_minutes: float = Field(
        gt=0.0, description="Toplam simulasyon suresi (isinma dahil)"
    )
    warmup_period_minutes: float = Field(
        default=0.0,
        ge=0.0,
        description="Isinma periyodu; bu suredeki gozlemler istatistiklerden cikarilir",
    )
    num_replications: int = Field(
        default=MIN_RECOMMENDED_REPLICATIONS,
        ge=1,
        description="Monte Carlo replikasyon sayisi (onerilen en az 30)",
    )
    random_seed: Optional[int] = Field(
        default=None,
        description="Tekrarlanabilirlik icin ana tohum; verilmezse rastgele uretilir",
    )

    @model_validator(mode="after")
    def _validate_topology(self) -> "SimulationConfig":
        """Ağ topolojisinin ve zaman parametrelerinin tutarlılığını doğrular."""
        ids = [station.id for station in self.stations]
        duplicates = sorted({sid for sid in ids if ids.count(sid) > 1})
        if duplicates:
            raise ValueError(f"Yinelenen istasyon kimlikleri: {duplicates}")

        known = set(ids)
        for connection in self.connections:
            if connection.from_station_id not in known:
                raise ValueError(
                    f"Baglanti kaynagi bilinmiyor: '{connection.from_station_id}'"
                )
            if connection.to_station_id not in known:
                raise ValueError(f"Baglanti hedefi bilinmiyor: '{connection.to_station_id}'")

        if self.arrival_process.entry_station_id not in known:
            raise ValueError(
                f"Giris istasyonu bilinmiyor: '{self.arrival_process.entry_station_id}'"
            )

        outgoing_total: Dict[str, float] = {}
        for connection in self.connections:
            outgoing_total[connection.from_station_id] = (
                outgoing_total.get(connection.from_station_id, 0.0)
                + connection.routing_probability
            )
        for station_id, total in sorted(outgoing_total.items()):
            if total > 1.0 + ROUTING_PROBABILITY_TOLERANCE:
                raise ValueError(
                    f"'{station_id}' istasyonundan cikan yonlendirme olasiliklari "
                    f"toplami 1.0'i asiyor: {total:.6f}"
                )

        if self.random_seed is not None and self.random_seed < 0:
            raise ValueError(
                f"'random_seed' negatif olamaz, alinan: {self.random_seed}"
            )

        if self.warmup_period_minutes >= self.simulation_duration_minutes:
            raise ValueError(
                f"Isinma periyodu ({self.warmup_period_minutes}) toplam simulasyon "
                f"suresinden ({self.simulation_duration_minutes}) kisa olmalidir; "
                f"aksi halde istatistik toplanacak pencere kalmaz."
            )
        return self

    # ------------------------------------------------------------------ #
    # Yardımcılar
    # ------------------------------------------------------------------ #
    @property
    def statistics_window_minutes(self) -> float:
        """İstatistiklerin toplandığı pencere uzunluğu (ısınma hariç)."""
        return self.simulation_duration_minutes - self.warmup_period_minutes

    def station_by_id(self) -> Dict[str, Station]:
        """İstasyonları kimliğe göre indeksler."""
        return {station.id: station for station in self.stations}

    def outgoing_connections(self, station_id: str) -> List[Connection]:
        """Verilen istasyondan çıkan bağlantıları konfigürasyon sırasıyla döndürür."""
        return [c for c in self.connections if c.from_station_id == station_id]

    def incoming_connections(self, station_id: str) -> List[Connection]:
        """Verilen istasyona giren bağlantıları konfigürasyon sırasıyla döndürür."""
        return [c for c in self.connections if c.to_station_id == station_id]


# --------------------------------------------------------------------------- #
# Çıktı şemaları — motorun ham gözlemleri
# --------------------------------------------------------------------------- #


class StationRunMetrics(BaseModel):
    """Tek bir replikasyonda tek bir istasyondan toplanan ham gözlemler.

    Bu model **türetilmiş** metrik içermez (OEE skoru, darboğaz kararı vb.);
    yalnızca `analytics/` katmanının bu metrikleri hesaplayabilmesi için gereken
    ham büyüklükleri taşır. Örneğin OEE bileşenleri şöyle türetilir:

        Availability = uptime / planned_production_time_minutes
        Performance  = (units_produced * ideal_cycle_time) / busy_minutes
        Quality      = (units_produced - units_scrapped) / units_produced
    """

    model_config = ConfigDict(extra="forbid")

    station_id: str
    station_name: str
    num_servers: int

    # --- Akış sayaçları (istatistik penceresi içinde) ---
    entries: int = Field(description="Istasyona giren parca sayisi")
    service_completions: int = Field(description="Tamamlanan islem sayisi")
    units_produced: int = Field(description="Uretilen toplam birim (= service_completions)")
    units_scrapped: int = Field(
        default=0,
        description=(
            "Bu istasyonda hurdaya ayrilan birim sayisi (Station.scrap_rate'ten "
            "beslenir). OEE'nin Quality bileseni "
            "(units_produced - units_scrapped) / units_produced olarak hesaplanir."
        ),
    )
    rejected: int = Field(
        default=0, description="Tampon dolu oldugu icin kabul edilmeyen parca sayisi"
    )

    # --- Zaman ağırlıklı sunucu istatistikleri (sunucu-dakika cinsinden) ---
    busy_minutes: float = Field(description="Sunucularin islem yaptigi toplam sure")
    blocked_minutes: float = Field(
        description="Sunucularin cikisi tikali oldugu icin bekledigi toplam sure"
    )
    down_minutes: float = Field(description="Sunucularin arizali oldugu toplam sure")
    idle_minutes: float = Field(description="Sunucularin bosta bekledigi toplam sure")
    planned_production_time_minutes: float = Field(
        description="num_servers * istatistik penceresi uzunlugu (OEE paydasi)"
    )

    # --- Oranlar ---
    utilization: float = Field(
        description="rho = busy_minutes / planned_production_time_minutes"
    )
    blocked_fraction: float = Field(description="blocked_minutes / planlanan sure")
    availability_fraction: float = Field(
        description="uptime / planlanan sure; OEE'nin Availability bileseni"
    )

    # --- Kuyruk istatistikleri ---
    avg_queue_length: float = Field(description="Lq — zaman agirlikli ortalama kuyruk boyu")
    max_queue_length: int
    avg_wait_time: float = Field(
        description="Wq — kuyrukta ortalama bekleme (hic beklemeyenlerin 0 degeri dahil)"
    )
    max_wait_time: float
    wait_time_observations: int = Field(
        description=(
            "Wq ortalamasindaki gozlem sayisi. Bu deger `entries` degerinden, "
            "isinma periyodunun bittigi anda kuyrukta bekleyen parca sayisi kadar "
            "buyuk olabilir: o parcalarin istasyona girisi isinma penceresinde "
            "sayilip silinmis, bekleme gozlemi ise kuyruktan cikarken (istatistik "
            "penceresinde) kaydedilmistir. Gozlem silme yonteminin bilinen ve uzun "
            "kosumlarda ihmal edilebilir bir sinir etkisidir."
        )
    )

    # --- İşlem süresi ---
    avg_service_time: float
    service_time_std_dev: float = Field(
        default=0.0,
        description=(
            "Islem suresi standart sapmasi. Drum-Buffer-Rope tampon boyutlandirmasi "
            "yukari akistaki degiskenligin olcusu olarak bu degeri kullanir."
        ),
    )
    ideal_cycle_time: float = Field(
        description="E[islem suresi] — OEE Performance bileseninde ideal cevrim suresi"
    )

    # --- Arıza istatistikleri ---
    failure_count: int = 0
    total_repair_minutes: float = 0.0


class SystemRunMetrics(BaseModel):
    """Tek bir replikasyonda sistem geneli ham gözlemler.

    Little's Law doğrulaması (`analytics/littles_law.py`) bu alanları kullanır:
    L = `avg_wip`, W = `avg_flow_time`, lambda = `effective_arrival_rate`.
    Etkin varış hızı olarak **çıkış** sayısının pencere uzunluğuna bölümü
    kullanılır; kararlı durumda giriş ve çıkış hızları eşitlenir ve bu seçim
    L = lambda * W özdeşliğinin sonlu örneklem sapmasını en aza indirir
    (Little 1961; Law 2015, Bölüm 11.5).
    """

    model_config = ConfigDict(extra="forbid")

    window_start_minutes: float
    window_end_minutes: float
    window_duration_minutes: float

    entities_created: int = Field(description="Pencere icinde uretilen varis sayisi")
    entities_admitted: int = Field(description="Sisteme kabul edilen parca sayisi")
    entities_rejected: int = Field(description="Giris tamponu dolu oldugu icin kaybedilen parca")
    entities_departed: int = Field(
        description=(
            "Sistemi terk eden toplam parca (iyi + hurda). Little's Law'daki "
            "etkin varis hizi bu sayidan turetilir; hurdaya ayrilan bir parca da "
            "sistemde gercek bir sure gecirmistir."
        )
    )
    entities_scrapped: int = Field(
        default=0, description="Hurdaya ayrildigi icin hattan cikarilan parca sayisi"
    )
    entities_completed: int = Field(
        default=0, description="Rotasini tamamlayip iyi urun olarak cikan parca sayisi"
    )

    avg_wip: float = Field(description="L — zaman agirlikli ortalama sistemdeki parca sayisi")
    max_wip: int
    wip_at_end: int

    avg_flow_time: float = Field(description="W — sistemde ortalama gecirilen sure")
    flow_time_std_dev: float
    min_flow_time: float
    max_flow_time: float

    arrival_rate: float = Field(description="entities_admitted / pencere uzunlugu")
    effective_arrival_rate: float = Field(
        description="entities_departed / pencere uzunlugu; Little's Law'da kullanilan lambda"
    )
    throughput_per_minute: float = Field(
        description="Iyi urun debisi: entities_completed / pencere uzunlugu (hurda haric)"
    )


class StabilityCheck(BaseModel):
    """Çalıştırma öncesi kararlılık (stability) ön denetimi — Şartname TEST 3.

    Açık kuyruk ağlarında her istasyonun ziyaret oranı v_j, trafik denklemleri
    v = e + v*P çözülerek bulunur (Jackson 1957). İstasyon yükü:

        rho_j = lambda * v_j / (c_j * mu_j * A_j)

    burada A_j arızalardan kaynaklanan kullanılabilirlik düzeltmesidir
    (A_j = MTBF / (MTBF + MTTR), arıza modeli yoksa 1.0).

    rho_j >= 1 olan bir istasyonun **iki farklı** sonucu olabilir ve ikisi
    birbirinden kesin biçimde ayrılmalıdır:

    - **Kararsız (unbounded).** İstasyona ulaşabilen bir yerde sınırsız tampon
      varsa iş orada birikir: kuyruk sınırsız büyür, kararlı durum
      ortalamaları tanımsızdır ve simülasyon sonuçları yorumlanamaz.
    - **Kapasite sınırlı (bounded).** İstasyonun ve ona ulaşabilen tüm
      istasyonların tamponu sonluysa kuyruk büyüyemez; sistem kararlıdır ve
      kararlı duruma yakınsar. Bedeli, talebin bir kısmının karşılanamaması,
      yani parçaların reddedilmesidir.

    Bu ayrımın yapılmaması, sonlu tamponlu ve tamamen kararlı bir sistem için
    "kuyruk sınırsız büyüyecek" uyarısı üretilmesine yol açar.
    """

    model_config = ConfigDict(extra="forbid")

    is_stable: bool = Field(
        description=(
            "Sistemdeki is miktari sinirli mi? Kapasite sinirli (sonlu tamponlu) "
            "bir sistem rho >= 1 olsa bile kararlidir ve bu alan True doner."
        )
    )
    arrival_rate: float
    station_loads: Dict[str, float] = Field(
        description="Istasyon kimligi -> teorik rho (offered load) degeri"
    )
    visit_ratios: Dict[str, float] = Field(
        description="Istasyon kimligi -> ziyaret orani v_j (trafik denklemi cozumu)"
    )
    unstable_station_ids: List[str] = Field(
        default_factory=list,
        description="rho >= 1 ve birikimin sinirsiz oldugu istasyonlar",
    )
    capacity_limited_station_ids: List[str] = Field(
        default_factory=list,
        description=(
            "rho >= 1 ancak tampon sonlu oldugu icin kuyrugun sinirli kaldigi "
            "istasyonlar. Sistem kararlidir; talebin bir kismi reddedilir."
        ),
    )
    estimated_rejection_rates: Dict[str, float] = Field(
        default_factory=dict,
        description=(
            "Kapasite sinirli istasyonlar icin M/M/1/K yaklasimiyla kestirilen "
            "engellenme olasiligi (istasyon kimligi -> oran)."
        ),
    )
    messages: List[str] = Field(default_factory=list)


class ReplicationResult(BaseModel):
    """Tek bir simülasyon replikasyonunun tam çıktısı.

    `analytics/monte_carlo.py` bu sonuçlardan N tanesini toplayarak ortalama,
    standart sapma ve %95 güven aralığı üretir.
    """

    model_config = ConfigDict(extra="forbid")

    replication_index: int
    seed: int = Field(description="Bu replikasyonda kullanilan etkin ana tohum")
    system: SystemRunMetrics
    stations: List[StationRunMetrics]
    stability: StabilityCheck
    events_processed: int
    simulated_minutes: float
    wall_clock_seconds: float
    warnings: List[str] = Field(default_factory=list)

    def station(self, station_id: str) -> StationRunMetrics:
        """Kimliğe göre istasyon metriklerini döndürür."""
        for metrics in self.stations:
            if metrics.station_id == station_id:
                return metrics
        raise KeyError(f"Sonuclarda '{station_id}' istasyonu bulunamadi.")


# --------------------------------------------------------------------------- #
# Kuyruk teorisi şemaları — Şartname Bölüm 3.1 ve 3.2
# --------------------------------------------------------------------------- #


class QueueingMetrics(BaseModel):
    """Bir istasyonun analitik kuyruk modeli sonuçları (M/M/1 veya M/M/c).

    Alan adlarında `model_` öneki bilinçli olarak kullanılmaz; Pydantic bu
    önekleri kendi ad alanı için ayırmıştır.
    """

    model_config = ConfigDict(extra="forbid")

    notation: str = Field(description="Kendall notasyonu, or. 'M/M/1' veya 'M/M/c'")
    arrival_rate: float = Field(description="lambda — birim zamandaki varis sayisi")
    service_rate: float = Field(description="mu — sunucu basina birim zamandaki hizmet")
    num_servers: int = Field(description="c — paralel sunucu sayisi")

    offered_load: float = Field(
        description="a = lambda / mu (erlang cinsinden sunulan yuk)"
    )
    utilization: float = Field(description="rho = a / c — sunucu basina kullanim orani")
    is_stable: bool = Field(description="rho < 1 mi? Degilse kuyruk sinirsiz buyur")

    probability_system_empty: float = Field(
        description="P0 — sistemde hic parca bulunmama olasiligi"
    )
    probability_of_waiting: float = Field(
        description=(
            "Gelen bir parcanin beklemek zorunda kalma olasiligi. M/M/c'de "
            "Erlang-C degeri C(c, a), M/M/1'de rho'ya esittir."
        )
    )

    l_system: float = Field(description="L — sistemdeki ortalama birim sayisi")
    l_queue: float = Field(description="Lq — kuyruktaki ortalama birim sayisi")
    w_system: float = Field(description="W — sistemde ortalama gecirilen sure")
    w_queue: float = Field(description="Wq — kuyrukta ortalama bekleme suresi")

    warnings: List[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Little's Law şemaları — Şartname Bölüm 3.3
# --------------------------------------------------------------------------- #


class LittlesLawValidation(BaseModel):
    """Tek bir kapsam için L = lambda * W tutarlılık denetimi sonucu."""

    model_config = ConfigDict(extra="forbid")

    scope: str = Field(description="'system' veya istasyon kimligi")
    description: str = Field(description="Hangi buyukluklerin karsilastirildigi")

    observed_l: float = Field(description="Simulasyondan olculen L (zaman agirlikli)")
    predicted_l: float = Field(description="lambda * W carpimi")
    arrival_rate: float = Field(description="Kullanilan lambda degeri")
    average_time: float = Field(description="Kullanilan W degeri")

    deviation_pct: float = Field(description="Bagil sapma yuzdesi")
    tolerance_pct: float = Field(description="Kabul edilen azami sapma yuzdesi")
    passed: bool
    message: str


class LittlesLawReport(BaseModel):
    """Bir replikasyonun sistem ve istasyon düzeyi Little's Law denetimi."""

    model_config = ConfigDict(extra="forbid")

    system: LittlesLawValidation
    stations: List[LittlesLawValidation] = Field(default_factory=list)
    passed: bool = Field(description="Tum denetimler toleransi gecti mi?")
    max_deviation_pct: float
    messages: List[str] = Field(default_factory=list)

    def station(self, station_id: str) -> LittlesLawValidation:
        """Kimliğe göre istasyon denetimini döndürür."""
        for validation in self.stations:
            if validation.scope == station_id:
                return validation
        raise KeyError(f"Little's Law raporunda '{station_id}' istasyonu bulunamadi.")


# --------------------------------------------------------------------------- #
# Monte Carlo şemaları — Şartname Bölüm 3.7
# --------------------------------------------------------------------------- #


class MonteCarloStatistic(BaseModel):
    """Bağımsız replikasyonlardan elde edilen tek bir metriğin özeti."""

    model_config = ConfigDict(extra="forbid")

    metric: str = Field(description="Metrigin makine okunabilir adi")
    label: str = Field(description="Raporda gosterilecek ad")
    unit: str = Field(default="", description="Birim, or. 'birim' veya 'dk'")

    count: int = Field(description="Replikasyon sayisi n")
    mean: float = Field(description="Replikasyon ortalamasi")
    std_dev: float = Field(description="Replikasyonlar arasi ornek standart sapmasi")
    standard_error: float = Field(description="s / KAREKOK(n)")
    critical_value: float = Field(
        description="Guven araliginda kullanilan kritik deger (z veya t)"
    )
    half_width: float = Field(description="kritik deger x standart hata")

    ci_lower: float
    ci_upper: float
    minimum: float
    maximum: float
    relative_precision: float = Field(
        description=(
            "yari genislik / |ortalama|. 0.05'in altinda olmasi, kestirimin "
            "%5'ten daha iyi bir kesinlikte oldugu anlamina gelir."
        )
    )


class MonteCarloStationSummary(BaseModel):
    """Tek bir istasyonun replikasyonlar arası özetleri."""

    model_config = ConfigDict(extra="forbid")

    station_id: str
    station_name: str
    statistics: List[MonteCarloStatistic]

    def metric(self, name: str) -> MonteCarloStatistic:
        """Ada göre metrik özetini döndürür."""
        for statistic in self.statistics:
            if statistic.metric == name:
                return statistic
        raise KeyError(f"'{name}' metrigi bulunamadi.")


class MonteCarloReport(BaseModel):
    """Çoklu replikasyon çalıştırmasının tam çıktısı."""

    model_config = ConfigDict(extra="forbid")

    num_replications: int
    master_seed: int = Field(description="Tum replikasyonlarin turetildigi ana tohum")
    replication_seeds: List[int]
    confidence_level: float = Field(description="Guven duzeyi, or. 0.95")
    uses_student_t: bool = Field(
        description="Kritik deger Student t dagilimindan mi alindi?"
    )

    system: List[MonteCarloStatistic]
    stations: List[MonteCarloStationSummary]

    headline: str = Field(description="Ana sonucun tek cumlelik ozeti")
    total_wall_clock_seconds: float
    warnings: List[str] = Field(default_factory=list)

    def metric(self, name: str) -> MonteCarloStatistic:
        """Ada göre sistem düzeyi metrik özetini döndürür."""
        for statistic in self.system:
            if statistic.metric == name:
                return statistic
        raise KeyError(f"'{name}' sistem metrigi bulunamadi.")

    def station(self, station_id: str) -> MonteCarloStationSummary:
        """Kimliğe göre istasyon özetini döndürür."""
        for summary in self.stations:
            if summary.station_id == station_id:
                return summary
        raise KeyError(f"Monte Carlo raporunda '{station_id}' istasyonu bulunamadi.")


# --------------------------------------------------------------------------- #
# Takt time ve hat dengeleme şemaları — Şartname Bölüm 3.5
# --------------------------------------------------------------------------- #


class Task(BaseModel):
    """Montaj hattında istasyonlara atanacak bölünemez bir iş öğesi.

    Görev süreleri ve öncelik ilişkileri hat dengeleme probleminin girdisidir;
    simülasyon konfigürasyonundan bağımsızdır çünkü dengeleme, istasyonların
    **nasıl oluşturulacağına** karar verir.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    duration_minutes: float = Field(gt=0.0, description="Gorevin standart suresi")
    predecessors: List[str] = Field(
        default_factory=list,
        description="Bu gorevden once tamamlanmasi zorunlu gorevlerin kimlikleri",
    )


class BalancedStation(BaseModel):
    """Hat dengeleme sonucunda oluşan tek bir iş istasyonu."""

    model_config = ConfigDict(extra="forbid")

    index: int = Field(description="Istasyon sirasi (1'den baslar)")
    task_ids: List[str]
    task_names: List[str]
    total_time_minutes: float = Field(description="Istasyona atanan gorevlerin toplami")
    idle_time_minutes: float = Field(description="Takt time eksi toplam sure")
    utilization: float = Field(description="Toplam sure / takt time")


class LineBalancingResult(BaseModel):
    """Ranked Positional Weight algoritmasının çıktısı."""

    model_config = ConfigDict(extra="forbid")

    takt_time_minutes: float
    total_task_time_minutes: float = Field(description="Tum gorev surelerinin toplami")

    theoretical_minimum_stations: int = Field(
        description="TAVAN(toplam gorev suresi / takt time) — asagi inilemez alt sinir"
    )
    assigned_stations: int = Field(description="RPW'nin kullandigi istasyon sayisi")
    stations: List[BalancedStation]

    line_efficiency: float = Field(
        description="toplam gorev suresi / (istasyon sayisi x takt time)"
    )
    balance_delay: float = Field(description="1 - hat verimliligi (denge kaybi)")
    smoothness_index: float = Field(
        description=(
            "KAREKOK(TOPLAM (en yuklu istasyon - istasyon suresi)^2). Sifira ne "
            "kadar yakinsa is yuku o kadar esit dagilmistir."
        )
    )
    bottleneck_station_index: int = Field(description="En yuklu istasyonun sirasi")

    positional_weights: Dict[str, float] = Field(
        description="Gorev kimligi -> pozisyonel agirlik (RPW sirasi bundan gelir)"
    )
    is_feasible: bool
    warnings: List[str] = Field(default_factory=list)


class TaktTimeAnalysis(BaseModel):
    """Takt time hesabı ve hattın talebi karşılayıp karşılamadığı."""

    model_config = ConfigDict(extra="forbid")

    available_time_minutes: float = Field(description="Kullanilabilir uretim suresi")
    customer_demand_units: float = Field(description="Ayni surede karsilanacak talep")
    takt_time_minutes: float = Field(
        description="Kullanilabilir Uretim Suresi / Musteri Talebi"
    )
    required_throughput_per_minute: float = Field(description="1 / takt time")

    observed_throughput_per_minute: Optional[float] = Field(
        default=None, description="Simulasyondan olculen iyi urun debisi"
    )
    observed_cycle_time_minutes: Optional[float] = Field(
        default=None, description="1 / olculen debi"
    )
    meets_demand: Optional[bool] = Field(
        default=None, description="Olculen debi talebi karsiliyor mu?"
    )
    throughput_gap_per_minute: Optional[float] = Field(
        default=None, description="Gerekli debi eksi olculen debi (negatifse fazla)"
    )
    stations_exceeding_takt: List[str] = Field(
        default_factory=list,
        description="Cevrim suresi takt time'i asan istasyonlarin kimlikleri",
    )
    message: str


# --------------------------------------------------------------------------- #
# Kısıtlar Teorisi (TOC) şemaları — Şartname Bölüm 3.6
# --------------------------------------------------------------------------- #


class StationLoad(BaseModel):
    """Bir istasyonun yük profili; darboğaz sıralamasında kullanılır."""

    model_config = ConfigDict(extra="forbid")

    station_id: str
    station_name: str
    rank: int = Field(description="Yuke gore sira; 1 = darbogaz")

    utilization: float = Field(description="rho — sunucularin islem yaptigi sure orani")
    blocked_fraction: float = Field(description="Cikisi tikali gecen sure orani")
    starvation_fraction: float = Field(description="Bosta (parca bekleyerek) gecen sure orani")

    visit_ratio: float = Field(
        description="v_j — bir is emri basina bu istasyonun ziyaret edilme sayisi"
    )
    capacity_per_minute: float = Field(
        description="c * mu * A — istasyonun kendi islem kapasitesi"
    )
    system_capacity_per_minute: float = Field(
        description=(
            "capacity_per_minute / v_j — bu istasyonun sinirladigi sistem ciktisi. "
            "Iki kez ziyaret edilen bir istasyon, sistem ciktisini yarisi kadar sinirlar."
        )
    )


class DrumBufferRopeRecommendation(BaseModel):
    """Darboğaz önündeki koruyucu tamponun boyutlandırılması."""

    model_config = ConfigDict(extra="forbid")

    bottleneck_station_id: str
    upstream_station_id: Optional[str] = Field(
        default=None, description="Darbogazi besleyen istasyon (yoksa dis varis sureci)"
    )

    upstream_variation_minutes: float = Field(
        description=(
            "Yukari akistaki degiskenligin sure karsiligi: besleyen istasyonun "
            "islem suresi standart sapmasi + ortalama onarim suresi (MTTR)."
        )
    )
    safety_factor: float = Field(description="Guvenlik katsayisi")
    recommended_time_buffer_minutes: float = Field(
        description="Degiskenlik suresi x guvenlik katsayisi"
    )
    recommended_buffer_units: int = Field(
        description=(
            "Zaman tamponunun parca cinsinden karsiligi: darbogazin bu sure icinde "
            "tuketecegi parca sayisi (yukari yuvarlanir)."
        )
    )

    current_buffer_capacity: int = Field(description="Mevcut tampon kapasitesi (-1 = sinirsiz)")
    is_current_buffer_sufficient: bool
    observed_starvation_minutes: float = Field(
        description="Darbogazin istatistik penceresinde bosta bekledigi sure"
    )
    estimated_lost_units: float = Field(
        description=(
            "Aclik suresinde uretilebilecek tahmini birim sayisi. Bu bir 'kayip' "
            "yalnizca sistem kapasite kisitliysa ve tampon yetersizse anlamlidir; "
            "kisit disaridaysa (talep yetersizse) ayni sure sadece bos kapasitedir."
        )
    )
    rationale: str


class BottleneckAnalysis(BaseModel):
    """Kısıtlar Teorisi'ne göre darboğaz tespiti ve iyileştirme önerileri."""

    model_config = ConfigDict(extra="forbid")

    bottleneck_station_id: str
    bottleneck_station_name: str
    bottleneck_utilization: float
    secondary_bottleneck_station_id: Optional[str] = Field(
        default=None,
        description=(
            "Ikinci en yuklu istasyon. Darbogaz genisletildiginde kisit buraya "
            "kayar; iyilestirme planlanirken bilinmesi gerekir."
        ),
    )

    theoretical_max_throughput_per_minute: float = Field(
        description="Darbogazin sinirladigi azami sistem ciktisi"
    )
    observed_throughput_per_minute: float = Field(description="Olculen iyi urun debisi")
    capacity_utilization_pct: float = Field(
        description="Olculen ciktinin teorik azami ciktiya orani"
    )

    station_loads: List[StationLoad] = Field(description="Yuke gore azalan sirada")
    drum_buffer_rope: Optional[DrumBufferRopeRecommendation] = None

    diagnosis: str
    recommendations: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# OEE şemaları — Şartname Bölüm 3.4
# --------------------------------------------------------------------------- #

OEEComponent = Literal["availability", "performance", "quality"]


class StationOEE(BaseModel):
    """Tek bir istasyonun OEE kırılımı.

    Şartname yalnızca tek bir OEE skoru değil, **hangi bileşenin düşük olduğunu
    gösteren kırılım** istediği için bu model üç bileşeni, her birinin dakika
    cinsinden kayıp karşılığını ve kaybın nedenini ayrı ayrı taşır. Böylece
    kullanıcı "OEE neden düşük?" sorusunu tek bakışta yanıtlayabilir.
    """

    model_config = ConfigDict(extra="forbid")

    station_id: str
    station_name: str

    # --- Üç bileşen ve çarpımları ---
    availability: float = Field(description="Calisma Suresi / Planlanan Uretim Suresi")
    performance: float = Field(
        description="(Toplam Uretim x Ideal Cevrim Suresi) / Calisma Suresi"
    )
    quality: float = Field(description="Iyi Urun Sayisi / Toplam Uretim")
    oee: float = Field(description="Availability x Performance x Quality")

    # --- Zaman merdiveni (dakika) ---
    planned_production_time_minutes: float = Field(
        description="Pencere uzunlugu x sunucu sayisi — OEE merdiveninin en ust basamagi"
    )
    run_time_minutes: float = Field(
        description="Planlanan sure eksi arizali sure (Availability'nin payi)"
    )
    net_operating_time_minutes: float = Field(
        description="Toplam uretim x ideal cevrim suresi (Performance'in payi)"
    )
    fully_productive_time_minutes: float = Field(
        description="Iyi urun x ideal cevrim suresi (OEE'nin payi)"
    )

    # --- Kayıp kırılımı (dakika) ---
    availability_loss_minutes: float = Field(description="Arizalardan kaybedilen sure")
    performance_loss_minutes: float = Field(
        description="Calisma suresi icinde uretime donusmeyen sure (bosta + bloke + hiz kaybi)"
    )
    quality_loss_minutes: float = Field(description="Hurda urune harcanan sure")

    # --- Performans kaybının nedeni ---
    starvation_minutes: float = Field(
        description="Besleme olmadigi icin bosta gecen sure (aclik)"
    )
    blocking_minutes: float = Field(
        description="Cikisi tikali oldugu icin bekleyerek gecen sure (blokaj)"
    )

    # --- Sayımlar ---
    units_produced: int
    units_good: int
    units_scrapped: int

    # --- Teşhis ---
    limiting_component: Optional[OEEComponent] = Field(
        default=None, description="En dusuk bileseni; OEE'yi en cok kisitlayan faktor"
    )
    diagnosis: str = Field(description="Kaybin nerede oldugunu ozetleyen aciklama")
    warnings: List[str] = Field(default_factory=list)


class OEEReport(BaseModel):
    """Bir replikasyondaki tüm istasyonların OEE kırılımı."""

    model_config = ConfigDict(extra="forbid")

    stations: List[StationOEE]
    bottleneck_station_id: Optional[str] = Field(
        default=None,
        description=(
            "En yuksek kullanim oranina (rho) sahip istasyon — Kisitlar Teorisi "
            "anlamindaki sistem darbogazi. Hattin ciktisini bu istasyon belirler."
        ),
    )
    line_oee: float = Field(
        description=(
            "Hattin OEE'si: **darbogaz istasyonunun** OEE degeri. Kisitlar "
            "Teorisi geregi hattin ciktisi kisit tarafindan belirlendigi icin "
            "OEE de kisitta olculur (Goldratt 1984; Nakajima 1988)."
        )
    )
    lowest_oee_station_id: Optional[str] = Field(
        default=None,
        description=(
            "En dusuk OEE degerine sahip istasyon. Bu genellikle darbogaz "
            "DEGILDIR: az yuklu bir istasyon calisacak parca bulamadigi icin "
            "dusuk Performance ve dolayisiyla dusuk OEE gosterir. Bu alani hat "
            "verimliligi olarak yorumlamak, yerel optimizasyon tuzagina yol acar."
        ),
    )
    lowest_oee: float = Field(
        default=0.0, description="lowest_oee_station_id istasyonunun OEE degeri"
    )

    def station(self, station_id: str) -> StationOEE:
        """Kimliğe göre istasyon OEE kırılımını döndürür."""
        for metrics in self.stations:
            if metrics.station_id == station_id:
                return metrics
        raise KeyError(f"OEE raporunda '{station_id}' istasyonu bulunamadi.")


# --------------------------------------------------------------------------- #
# API yanıt şemaları — Şartname Bölüm 5
# --------------------------------------------------------------------------- #

SimulationStatus = Literal["completed", "failed"]


class OEEComponentsResponse(BaseModel):
    """API yanıtında bir istasyonun OEE kırılımı."""

    model_config = ConfigDict(extra="forbid")

    availability: float
    performance: float
    quality: float
    oee: float = Field(description="Uc bilesenin carpimi")


class StationMetricsResponse(BaseModel):
    """API yanıtında tek bir istasyonun metrikleri."""

    model_config = ConfigDict(extra="forbid")

    station_id: str
    station_name: str
    utilization: float
    avg_queue_length: float
    avg_wait_time: float
    oee: OEEComponentsResponse
    is_bottleneck: bool = Field(
        default=False, description="Bu istasyon sistem darbogazi mi?"
    )


class LittlesLawValidationResponse(BaseModel):
    """API yanıtında Little's Law denetiminin özeti."""

    model_config = ConfigDict(extra="forbid")

    passed: bool
    deviation_pct: float = Field(
        description="Tum replikasyonlarda gozlenen azami bagil sapma yuzdesi"
    )
    tolerance_pct: float
    replications_checked: int
    replications_passed: int


class SimulationResults(BaseModel):
    """`POST /api/simulations/run` yanıtının `results` bölümü."""

    model_config = ConfigDict(extra="forbid")

    total_throughput: int = Field(
        description="Replikasyon basina ortalama iyi urun sayisi (yuvarlanmis)"
    )
    confidence_interval_95: Tuple[float, float] = Field(
        description="Toplam uretim icin %95 guven araligi [alt, ust]"
    )
    station_metrics: List[StationMetricsResponse]
    bottleneck_station_id: str
    littles_law_validation: LittlesLawValidationResponse

    # --- Ek alanlar: sartnamedeki cekirdek yapiya eklenen baglam ---
    num_replications: int
    is_stable: bool = Field(description="Hicbir istasyonda rho >= 1 degil mi?")
    avg_wip: float = Field(description="L — replikasyonlar arasi ortalama WIP")
    avg_flow_time: float = Field(description="W — ortalama akis suresi (dk)")
    throughput_per_minute: float
    line_oee: float = Field(description="Darbogaz istasyonunun OEE degeri")
    theoretical_max_throughput_per_minute: float


class SimulationRunResponse(BaseModel):
    """`POST /api/simulations/run` yanıtı."""

    model_config = ConfigDict(extra="forbid")

    simulation_id: str
    status: SimulationStatus
    results: SimulationResults

    master_seed: int = Field(
        description="Kosumu birebir tekrarlamak icin kullanilabilecek ana tohum"
    )
    duration_seconds: float
    warnings: List[str] = Field(default_factory=list)
    headline: str = Field(description="Ana sonucun tek cumlelik ozeti")


class AnalyticalStationComparison(BaseModel):
    """Bir istasyonun analitik kuyruk modeliyle karşılaştırması."""

    model_config = ConfigDict(extra="forbid")

    station_id: str
    station_name: str

    applicable: bool = Field(
        description="Kapali form kuyruk modeli bu istasyona uygulanabilir mi?"
    )
    reason: str = Field(description="Uygulanabilir degilse gerekcesi")

    analytical: Optional[QueueingMetrics] = None
    simulated_utilization: float
    simulated_l_queue: float
    simulated_w_queue: float

    deviation_utilization_pct: Optional[float] = None
    deviation_l_queue_pct: Optional[float] = None
    deviation_w_queue_pct: Optional[float] = None
    passed: Optional[bool] = Field(
        default=None, description="Tum sapmalar tolerans icinde mi?"
    )


class ValidationReportResponse(BaseModel):
    """`GET /api/simulations/{id}/validation-report` yanıtı."""

    model_config = ConfigDict(extra="forbid")

    simulation_id: str
    tolerance_pct: float
    passed: bool = Field(description="Tum analitik denetimler gecti mi?")

    littles_law: LittlesLawReport = Field(
        description="En kotu sapmayi gosteren replikasyonun ayrintili raporu"
    )
    littles_law_summary: LittlesLawValidationResponse
    queueing_comparisons: List[AnalyticalStationComparison]
    stability: StabilityCheck

    master_seed: int
    replication_seeds: List[int]
    reproducibility_note: str

    summary: str


class ScenarioComparisonRow(BaseModel):
    """Karşılaştırma tablosunda tek bir senaryonun satırı."""

    model_config = ConfigDict(extra="forbid")

    scenario_index: int
    label: str
    simulation_id: str
    is_stable: bool

    total_throughput: float
    throughput_ci_95: Tuple[float, float]
    avg_wip: float
    avg_flow_time: float
    bottleneck_station_id: str
    bottleneck_utilization: float
    line_oee: float
    warnings: List[str] = Field(default_factory=list)


class PairwiseDifference(BaseModel):
    """İki senaryo arasındaki farkın istatistiksel değerlendirmesi.

    İki ortalamanın farkı için güven aralığı Welch yaklaşımıyla kurulur:

        fark  = m1 - m2
        s_e   = KAREKOK(s1^2 / n1 + s2^2 / n2)
        aralik = fark +/- 1.96 * s_e

    Aralık sıfırı içeriyorsa fark istatistiksel olarak anlamlı değildir; iki
    senaryo arasında gözlenen ayrım rastgelelikle açıklanabilir. Bu ayrımın
    yapılmaması, simülasyon karşılaştırmalarındaki en yaygın hatadır.
    """

    model_config = ConfigDict(extra="forbid")

    baseline_index: int
    candidate_index: int
    metric: str
    label: str

    baseline_mean: float
    candidate_mean: float
    difference: float = Field(description="aday - referans")
    difference_pct: float

    ci_lower: float
    ci_upper: float
    is_significant: bool = Field(
        description="Farkin %95 guven araligi sifiri disarida birakiyor mu?"
    )
    interpretation: str


class ComparisonResponse(BaseModel):
    """`POST /api/simulations/compare` yanıtı."""

    model_config = ConfigDict(extra="forbid")

    scenarios: List[ScenarioComparisonRow]
    differences: List[PairwiseDifference] = Field(
        description="Her senaryonun ilk senaryoyla (referans) karsilastirmasi"
    )

    best_scenario_index: int = Field(description="En yuksek ortalama ciktiya sahip senaryo")
    best_scenario_rationale: str
    total_duration_seconds: float


# --------------------------------------------------------------------------- #
# Olay izi (event trace) şemaları — canlı fabrika animasyonu
# --------------------------------------------------------------------------- #

SimulationEventType = Literal[
    "arrival",
    "queue_enter",
    "queue_exit",
    "service_start",
    "service_end",
    "blocked",
    "system_exit",
]


class SimulationEvent(BaseModel):
    """Simülasyon sırasında gerçekleşen tek bir olay.

    Bu şema yalnızca **görselleştirme** içindir; istatistiksel sonuçlar olay
    izinden değil, motorun kendi zaman ağırlıklı toplayıcılarından üretilir.
    """

    model_config = ConfigDict(extra="forbid")

    timestamp: float = Field(description="Olayin gerceklestigi simulasyon dakikasi")
    entity_id: str = Field(description="Olaya konu parcanin kimligi")
    event_type: SimulationEventType
    station_id: Optional[str] = Field(
        default=None,
        description=(
            "Olayin gerceklestigi istasyon. Sistem geneli olaylarda (parcanin "
            "sisteme girisi) bos birakilir."
        ),
    )


class SimulationTrace(BaseModel):
    """Bir simülasyonun ilk N dakikasında gerçekleşen olayların kaydı.

    **Temsili bir örnektir, bilimsel kanıt değildir.** İz tek bir
    replikasyondan alınır; raporlanan istatistikler ise tüm replikasyonların
    ortalamasına dayanır. Animasyonda görülen belirli bir kuyruk birikmesi o
    tek koşuma özgü olabilir. Bu ayrım arayüzde de kullanıcıya belirtilir.

    Kayıt penceresi bilinçli olarak simülasyonun **başından** başlar: sistem
    boş durumdan dolmaya başlar ve kuyrukların oluşumu izlenebilir. Pencere
    ortadan başlasaydı, o anda sistemde bulunan parçaların nasıl oraya geldiği
    kayıtta bulunmaz ve animasyon tutarsız görünürdü.
    """

    model_config = ConfigDict(extra="forbid")

    events: List[SimulationEvent]
    duration_minutes: float = Field(
        description="Izin kapsadigi sure; simulasyonun tamami degil, ilk penceresi"
    )
    replication_index: int = Field(
        description="Izin alindigi replikasyon (varsayilan olarak ilki)"
    )
    total_replications: int = Field(
        description="Sonuclarin dayandigi toplam replikasyon sayisi"
    )
    truncated: bool = Field(
        default=False,
        description=(
            "Olay sayisi ust sinira ulastigi icin kayit erken durduysa True. "
            "Animasyon bu durumda pencerenin tamamini gosteremez."
        ),
    )
    station_ids: List[str] = Field(
        default_factory=list,
        description="Modeldeki istasyonlarin kimlikleri (animasyon yerlesimi icin)",
    )
