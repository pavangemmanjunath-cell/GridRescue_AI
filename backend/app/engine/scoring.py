"""Site resource scores (0–100) from the climatology / water / grid layers."""
from __future__ import annotations


def _interp(x: float, pts: list[tuple[float, float]]) -> float:
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def solar_score(annual_psh: float, monthly_psh: list[float] | None = None) -> dict:
    base = _interp(annual_psh, [(2.5, 10), (3.0, 20), (4.0, 50), (5.0, 80), (5.5, 90), (6.0, 96), (7.0, 100)])
    penalty = 0.0
    worst = min(monthly_psh) if monthly_psh else annual_psh
    if monthly_psh and worst < 0.72 * annual_psh:
        penalty = 6.0
    score = int(round(max(0, min(100, base - penalty))))
    label = "excellent" if score >= 85 else "strong" if score >= 70 else "good" if score >= 50 else "moderate" if score >= 35 else "weak"
    return {"score": score, "label": label, "annual_psh": round(annual_psh, 2), "worst_month_psh": round(worst, 2),
            "design_psh": round(min(annual_psh, worst * 1.15), 2)}


def wind_score(ws50_annual: float, monthly_ws50: list[float] | None = None) -> dict:
    v80 = ws50_annual * (80 / 50) ** 0.14  # power-law shear to an 80 m hub
    base = _interp(v80, [(2.5, 5), (3.5, 15), (4.5, 32), (5.5, 52), (6.5, 70), (7.5, 85), (8.5, 95), (10, 100)])
    score = int(round(base))
    label = "excellent" if score >= 80 else "good" if score >= 60 else "fair" if score >= 45 else "marginal" if score >= 30 else "poor"
    cf = max(0.04, min(0.42, (v80 / 11.0) ** 3 * 1.1))  # crude capacity factor for a mid-size turbine
    return {"score": score, "label": label, "annual_ws50": round(ws50_annual, 2), "hub_ws80": round(v80, 2),
            "capacity_factor": round(cf, 3), "best_month_ws50": round(max(monthly_ws50), 2) if monthly_ws50 else None}


def temperature_context(monthly_temp_c: list[float]) -> dict:
    tmax = max(monthly_temp_c) if monthly_temp_c else 28.0
    tmean = sum(monthly_temp_c) / len(monthly_temp_c) if monthly_temp_c else 27.0
    return {
        "mean_c": round(tmean, 1), "hottest_month_c": round(tmax, 1),
        "pv_derate": round(max(0.0, (tmean + 20 - 25) * 0.004), 3),   # cell ≈ ambient + 20 °C
        "backup_hvac_class": "heavy" if tmax >= 30 else "standard" if tmax >= 24 else "light",
    }


def outage_severity(reliability: dict) -> dict:
    h = reliability.get("expected_outage_hours_per_day", 8)
    cls = reliability.get("grid_class", "C")
    sev = "low" if h <= 3 else "medium" if h <= 8 else "high" if h <= 14 else "severe"
    return {"expected_outage_hours_per_day": h, "class": cls, "severity": sev,
            "annual_outage_hours": h * 365, "score": reliability.get("reliability_score", 50)}


def site_summary(clim: dict, water: dict, grid: dict) -> dict:
    solar = solar_score(clim["annual_psh"], clim["monthly_psh"])
    wind = wind_score(sum(clim["monthly_wind_50m_ms"]) / 12, clim["monthly_wind_50m_ms"])
    temp = temperature_context(clim["monthly_temp_c"])
    ws = water["scores"]
    rel = grid["reliability"]
    return {
        "solar": solar, "wind": wind, "temperature": temp,
        "water": {"score": ws["water_availability"], "micro_hydro": ws["micro_hydro"], "pumped_hydro": ws["pumped_hydro"],
                  "hydrogen_water": ws["hydrogen_water"], "nearest_km": ws.get("nearest_distance_km"),
                  "discharge_class": ws.get("discharge_class"), "head_m": ws.get("head_m"), "rain_mm_yr": ws.get("rain_mm_yr"),
                  "label": "abundant" if ws["water_availability"] >= 70 else "available" if ws["water_availability"] >= 45 else "limited"},
        "grid": {"score": rel["reliability_score"], "class": rel["grid_class"], "label": rel["class_label"],
                 "outage_risk": rel["outage_risk"], "supply_hours": rel["expected_supply_hours_per_day"],
                 "infrastructure_score": rel["infrastructure_score"], "disco": rel.get("disco"), "state": rel.get("state")},
        "outage": outage_severity(rel),
    }
