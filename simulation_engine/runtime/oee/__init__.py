"""OEE motoru.

    OEE = Availability × Performance × Quality

Bir çarpan bile ölçülemiyorsa OEE hesaplanmaz ve `None` döner; eksik çarpanı
1 ya da 0 varsaymak, hattı olduğundan iyi ya da kötü gösterirdi.
"""

from simulation_engine.runtime.oee.availability import (
    availability,
    availability_from_minutes,
    availability_reason,
    clamp_ratio,
    is_clamped,
    run_time_ms,
)
from simulation_engine.runtime.oee.oee import (
    OeeInput,
    OeeResult,
    compute_oee,
    is_valid_oee,
    line_oee,
)
from simulation_engine.runtime.oee.performance import (
    expected_output,
    performance,
    performance_reason,
    performance_was_clamped,
)
from simulation_engine.runtime.oee.quality import (
    quality,
    quality_from_production,
    quality_reason,
    total_parts,
)

__all__ = [
    "OeeInput",
    "OeeResult",
    "availability",
    "availability_from_minutes",
    "availability_reason",
    "clamp_ratio",
    "compute_oee",
    "expected_output",
    "is_clamped",
    "is_valid_oee",
    "line_oee",
    "performance",
    "performance_reason",
    "performance_was_clamped",
    "quality",
    "quality_from_production",
    "quality_reason",
    "run_time_ms",
    "total_parts",
]
