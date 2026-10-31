"""Facility load models — hourly shapes and critical/essential/non-essential splits.

Hospital defaults follow WHO/USAID 'Powering Health' benchmarks and Nigerian tertiary-hospital
audits (≈ 1.3–1.8 kW average demand per bed, 40–50 % of load on life-critical circuits).
"""
from __future__ import annotations

FACILITY_TYPES: dict[str, dict] = {
    "hospital_tertiary": {
        "label": "Teaching / tertiary hospital", "beds": 300, "kw_per_bed": 1.6, "base_kw": 60,
        "critical_share": 0.45, "essential_share": 0.35, "peak_factor": 1.35, "shape": "hospital",
        "description": "ICU, theatres, imaging, dialysis, labs, blood bank, wards, admin",
    },
    "hospital_general": {
        "label": "General / secondary hospital", "beds": 120, "kw_per_bed": 1.3, "base_kw": 25,
        "critical_share": 0.42, "essential_share": 0.38, "peak_factor": 1.35, "shape": "hospital",
        "description": "Emergency, theatre, maternity, labs, wards",
    },
    "clinic_phc": {
        "label": "Primary health centre / clinic", "beds": 12, "kw_per_bed": 0.6, "base_kw": 4,
        "critical_share": 0.55, "essential_share": 0.30, "peak_factor": 1.5, "shape": "clinic",
        "description": "Vaccine fridge, delivery room lighting, sterilisation, oxygen concentrator",
    },
    "emergency_center": {
        "label": "Emergency / trauma centre", "beds": 40, "kw_per_bed": 1.5, "base_kw": 20,
        "critical_share": 0.60, "essential_share": 0.30, "peak_factor": 1.4, "shape": "flat",
        "description": "Resuscitation bays, imaging, comms, cold chain",
    },
    "telecom_tower": {
        "label": "Telecom tower / data node", "beds": 0, "kw_per_bed": 0, "base_kw": 3.5,
        "critical_share": 0.90, "essential_share": 0.10, "peak_factor": 1.1, "shape": "flat",
        "description": "Radio, transmission, cooling",
    },
    "water_treatment": {
        "label": "Water treatment / pumping station", "beds": 0, "kw_per_bed": 0, "base_kw": 150,
        "critical_share": 0.70, "essential_share": 0.20, "peak_factor": 1.2, "shape": "pumping",
        "description": "Pumps, dosing, controls",
    },
    "school": {
        "label": "School / training centre", "beds": 0, "kw_per_bed": 0, "base_kw": 25,
        "critical_share": 0.20, "essential_share": 0.40, "peak_factor": 1.6, "shape": "daytime",
        "description": "Lighting, ICT, fans, labs",
    },
    "cold_chain": {
        "label": "Vaccine / cold-chain store", "beds": 0, "kw_per_bed": 0, "base_kw": 12,
        "critical_share": 0.90, "essential_share": 0.10, "peak_factor": 1.2, "shape": "flat",
        "description": "Walk-in freezers, monitoring",
    },
    "data_center": {
        "label": "Data / ICT centre", "beds": 0, "kw_per_bed": 0, "base_kw": 200,
        "critical_share": 0.85, "essential_share": 0.15, "peak_factor": 1.1, "shape": "flat",
        "description": "Servers, cooling, network",
    },
    "custom": {
        "label": "Other critical facility", "beds": 0, "kw_per_bed": 0, "base_kw": 100,
        "critical_share": 0.40, "essential_share": 0.35, "peak_factor": 1.3, "shape": "flat",
        "description": "User-defined",
    },
}

# Hourly shapes normalised to mean 1.0
SHAPES: dict[str, list[float]] = {
    "hospital": [0.74, 0.70, 0.68, 0.68, 0.70, 0.78, 0.90, 1.05, 1.18, 1.25, 1.28, 1.28, 1.25, 1.24, 1.22, 1.18, 1.12, 1.08, 1.05, 1.00, 0.95, 0.88, 0.82, 0.77],
    "clinic": [0.45, 0.42, 0.42, 0.42, 0.45, 0.55, 0.85, 1.20, 1.55, 1.70, 1.75, 1.70, 1.60, 1.55, 1.50, 1.40, 1.20, 1.00, 0.85, 0.70, 0.60, 0.55, 0.50, 0.48],
    "flat": [1.0] * 24,
    "pumping": [1.15, 1.15, 1.15, 1.15, 1.10, 1.05, 1.00, 0.95, 0.90, 0.88, 0.88, 0.88, 0.88, 0.88, 0.90, 0.92, 0.95, 1.00, 1.05, 1.08, 1.10, 1.12, 1.15, 1.15],
    "daytime": [0.15, 0.15, 0.15, 0.15, 0.15, 0.20, 0.60, 1.40, 2.10, 2.30, 2.35, 2.30, 2.20, 2.10, 1.90, 1.50, 0.90, 0.40, 0.25, 0.20, 0.18, 0.16, 0.15, 0.15],
}


def normalise(shape: list[float]) -> list[float]:
    m = sum(shape) / len(shape)
    return [v / m for v in shape]


def build_load_model(facility_type: str, beds: int | None, avg_load_kw: float | None,
                     critical_load_kw: float | None, daily_kwh: float | None) -> dict:
    """Return hourly load arrays (kW) for total / critical / essential / non-essential."""
    ft = FACILITY_TYPES.get(facility_type, FACILITY_TYPES["custom"])
    b = beds if beds is not None else ft["beds"]
    # average load precedence: explicit avg → from daily kWh → from beds
    if avg_load_kw and avg_load_kw > 0:
        avg = float(avg_load_kw)
    elif daily_kwh and daily_kwh > 0:
        avg = float(daily_kwh) / 24.0
    else:
        avg = ft["base_kw"] + b * ft["kw_per_bed"]
    shape = normalise(SHAPES[ft["shape"]])
    total = [round(avg * s, 2) for s in shape]
    peak = max(total)
    crit_share = ft["critical_share"]
    if critical_load_kw and critical_load_kw > 0:
        crit_share = max(0.05, min(0.95, float(critical_load_kw) / max(peak, 1e-6)))
    ess_share = min(ft["essential_share"], 1 - crit_share)
    non_share = max(0.0, 1 - crit_share - ess_share)
    # critical load is flatter than the total (ICU/servers run 24 h): 70 % flat + 30 % shaped
    crit_avg = avg * crit_share
    critical = [round(crit_avg * (0.7 + 0.3 * s), 2) for s in shape]
    essential = [round(max(0.0, t * (crit_share + ess_share) - c), 2) for t, c in zip(total, critical)]
    non_ess = [round(max(0.0, t - c - e), 2) for t, c, e in zip(total, critical, essential)]
    return {
        "facility_type": facility_type, "facility_label": ft["label"], "beds": b,
        "avg_load_kw": round(avg, 1), "peak_load_kw": round(peak, 1), "daily_kwh": round(sum(total), 0),
        "critical_share": round(crit_share, 3), "essential_share": round(ess_share, 3), "non_essential_share": round(non_share, 3),
        "critical_peak_kw": round(max(critical), 1), "essential_peak_kw": round(max(essential), 1),
        "protected_peak_kw": round(max(c + e for c, e in zip(critical, essential)), 1),
        "protected_daily_kwh": round(sum(c + e for c, e in zip(critical, essential)), 0),
        "critical_daily_kwh": round(sum(critical), 0),
        "hourly": {"total": total, "critical": critical, "essential": essential, "non_essential": non_ess},
    }
