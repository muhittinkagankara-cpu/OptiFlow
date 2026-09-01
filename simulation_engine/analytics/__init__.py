"""Analitik katman — Şartname Bölüm 3 formülleri.

Modüller:
    queueing_theory.py  M/M/1 ve M/M/c (Erlang-C) analitik hesaplamaları (3.1-3.2)
    littles_law.py      L = lambda * W iç tutarlılık doğrulaması (3.3)
    oee.py              Availability x Performance x Quality kırılımlı OEE (3.4)
    takt_time.py        Takt time ve RPW tabanlı hat dengeleme (3.5)
    bottleneck.py       Kısıtlar Teorisi darboğaz tespiti + Drum-Buffer-Rope (3.6)
    monte_carlo.py      Çoklu replikasyon ve %95 güven aralığı (3.7)

Birkaç modülde aynı adı taşıyan fonksiyonlar bulunduğu için (`analyze`,
`format_report`) paket düzeyinde yalnızca **belirsizliğe yer bırakmayan** adlar
dışa aktarılır. Modüle özgü yardımcılar için modülün kendisi içe aktarılmalıdır:
``from simulation_engine.analytics import bottleneck`` gibi.
"""

from simulation_engine.analytics import (
    bottleneck,
    littles_law,
    monte_carlo,
    oee,
    queueing_theory,
    takt_time,
)
from simulation_engine.analytics.bottleneck import DBR_SAFETY_FACTOR
from simulation_engine.analytics.bottleneck import analyze as analyze_bottleneck
from simulation_engine.analytics.littles_law import (
    DEFAULT_TOLERANCE_PCT,
    assert_consistent,
)
from simulation_engine.analytics.littles_law import validate as validate_littles_law
from simulation_engine.analytics.monte_carlo import (
    Z_SCORE_95,
    required_replications,
    run_monte_carlo,
    summarize,
)
from simulation_engine.analytics.oee import (
    WORLD_CLASS_AVAILABILITY,
    WORLD_CLASS_OEE,
    WORLD_CLASS_PERFORMANCE,
    WORLD_CLASS_QUALITY,
    compute_oee_report,
    compute_station_oee,
    verify_oee_identity,
)
from simulation_engine.analytics.queueing_theory import (
    erlang_b,
    erlang_c,
    mm1_metrics,
    mmc_metrics,
    probability_system_empty,
    verify_erlang_consistency,
)
from simulation_engine.analytics.takt_time import (
    analyze_takt,
    balance_line,
    compute_positional_weights,
    compute_takt_time,
)

__all__ = [
    "DBR_SAFETY_FACTOR",
    "DEFAULT_TOLERANCE_PCT",
    "WORLD_CLASS_AVAILABILITY",
    "WORLD_CLASS_OEE",
    "WORLD_CLASS_PERFORMANCE",
    "WORLD_CLASS_QUALITY",
    "Z_SCORE_95",
    "analyze_bottleneck",
    "analyze_takt",
    "assert_consistent",
    "balance_line",
    "bottleneck",
    "compute_oee_report",
    "compute_positional_weights",
    "compute_station_oee",
    "compute_takt_time",
    "erlang_b",
    "erlang_c",
    "littles_law",
    "mm1_metrics",
    "mmc_metrics",
    "monte_carlo",
    "oee",
    "probability_system_empty",
    "queueing_theory",
    "required_replications",
    "run_monte_carlo",
    "summarize",
    "takt_time",
    "validate_littles_law",
    "verify_erlang_consistency",
    "verify_oee_identity",
]
