"""Pre-feasibility sizing of UPS, backup devices, PV, wind, hydrogen, generator and pumped hydro."""
from __future__ import annotations

import math

from app.engine.catalogue import ECON, STANDARD_GEN_KVA, STANDARD_UPS_KVA


def _std(value: float, table: list[int]) -> int:
    for v in table:
        if v >= value:
            return v
    return table[-1] * math.ceil(value / table[-1])


def _round_up(value: float, step: float) -> float:
    return math.ceil(value / step) * step


def size_ups(critical_peak_kw: float) -> dict:
    kva = _std(critical_peak_kw / ECON["ups_pf"] * ECON["ups_margin"], STANDARD_UPS_KVA)
    return {"kva": kva, "kw": round(kva * ECON["ups_pf"], 1), "autonomy_min": 15,
            "energy_kwh": round(kva * ECON["ups_pf"] * 0.25, 1), "covers_kw": round(critical_peak_kw, 1)}


def size_backup(protected_peak_kw: float, protected_daily_kwh: float, hours: float, chemistry: str,
                 pv_kwp: float = 0.0, design_psh: float = 5.0) -> dict:
    """Energy for `hours` of protected load, with a conservative daytime PV credit for long outages."""
    avg_kw = protected_daily_kwh / 24.0
    evening_weight = 1.08 if hours <= 12 else 1.0   # outages hit the 18:00–06:00 valley/peak mix
    needed = avg_kw * hours * evening_weight
    if pv_kwp > 0 and hours > 14:
        # only outages longer than a night necessarily include daylight: credit 50 % of one day's PV yield
        daylight_days = (hours - 12) / 24
        pv_credit = pv_kwp * design_psh * ECON["pv_performance_ratio"] * daylight_days * 0.5
        needed = max(needed * 0.45, needed - pv_credit)
    rte_dis = 0.95 if chemistry == "li_ion" else 0.85
    nameplate = needed / (ECON["backup_dod"] * rte_dis)
    power = protected_peak_kw * 1.1
    if chemistry == "flow":
        power = max(power, nameplate / 12)   # ≥ C/12 for VRFB stacks
    else:
        power = max(power, nameplate / 8)    # ≥ C/8
    nameplate = _round_up(nameplate, 10)
    power = _round_up(power, 5)
    return {"chemistry": chemistry, "energy_kwh": nameplate, "power_kw": power, "usable_kwh": round(nameplate * ECON["backup_dod"], 0),
            "autonomy_h": round(nameplate * ECON["backup_dod"] * rte_dis / max(avg_kw, 1e-6), 1), "c_rate": round(power / nameplate, 2),
            "footprint_m2": round(nameplate * (0.05 if chemistry == "li_ion" else 0.12), 0)}


def size_pv(protected_daily_kwh: float, design_psh: float, annual_psh: float, roof_m2: float, land_m2: float,
            temp_derate: float = 0.0, target_fraction: float = 1.25) -> dict:
    pr = ECON["pv_performance_ratio"] * (1 - temp_derate)
    kwp_needed = protected_daily_kwh * target_fraction / max(design_psh * pr, 0.5)
    roof_cap = roof_m2 / 6.0
    land_cap = land_m2 / 12.0
    cap = roof_cap + land_cap
    capped = kwp_needed > cap and cap > 0
    kwp = min(kwp_needed, cap) if cap > 0 else 0.0
    kwp = _round_up(kwp, 5) if kwp > 0 else 0.0
    yield_kwh = kwp * annual_psh * 365 * pr
    return {"kwp": kwp, "kwp_needed": round(kwp_needed, 0), "area_capped": capped, "roof_kwp": round(min(kwp, roof_cap), 0),
            "ground_kwp": round(max(0.0, kwp - roof_cap), 0), "annual_kwh": round(yield_kwh, 0),
            "daily_kwh": round(kwp * design_psh * pr, 0), "area_m2": round(min(kwp, roof_cap) * 6 + max(0.0, kwp - roof_cap) * 12, 0),
            "performance_ratio": round(pr, 3), "coverage_pct": round(min(100.0, 100 * (kwp * design_psh * pr) / max(protected_daily_kwh, 1)), 0)}


def size_wind(protected_daily_kwh: float, capacity_factor: float, wind_score: int, land_m2: float) -> dict:
    if wind_score < 45 or land_m2 < 2000:
        return {"kw": 0, "annual_kwh": 0, "capacity_factor": capacity_factor, "reason": "wind resource or land insufficient"}
    kw_needed = protected_daily_kwh * 0.5 / (24 * capacity_factor)
    sizes = [50, 100, 250, 500, 800, 1000, 1500, 2000]
    kw = next((s for s in sizes if s >= kw_needed), sizes[-1])
    return {"kw": kw, "annual_kwh": round(kw * capacity_factor * 8760, 0), "capacity_factor": capacity_factor,
            "daily_kwh": round(kw * capacity_factor * 24, 0), "reason": None}


def size_hydrogen(protected_peak_kw: float, protected_daily_kwh: float, hours: float, design_psh: float) -> dict:
    days = max(1.0, hours / 24.0)
    energy = protected_daily_kwh * days
    kg = energy / (ECON["h2_kwh_per_kg"] * ECON["fuel_cell_efficiency"])
    fuel_cell_kw = _round_up(protected_peak_kw * 1.1, 10)
    recharge_days = 7.0
    electrolyser_kw = _round_up(kg * ECON["electrolyser_kwh_per_kg"] / (recharge_days * design_psh), 10)
    pv_for_h2_kwp = _round_up(electrolyser_kw * 1.2, 10)
    return {"h2_kg": round(kg, 0), "storage_kwh_lhv": round(kg * ECON["h2_kwh_per_kg"], 0), "fuel_cell_kw": fuel_cell_kw,
            "electrolyser_kw": electrolyser_kw, "pv_dedicated_kwp": pv_for_h2_kwp, "water_l_per_cycle": round(kg * 10, 0),
            "autonomy_h": round(hours, 1)}


def size_generator(protected_peak_kw: float, existing_kva: float | None) -> dict:
    needed = _std(protected_peak_kw / 0.8 * 1.25, STANDARD_GEN_KVA)
    if existing_kva and existing_kva > 0:
        ok = existing_kva * 0.8 >= protected_peak_kw
        return {"kva": existing_kva, "existing": True, "adequate": ok, "recommended_kva": needed if not ok else existing_kva}
    return {"kva": needed, "existing": False, "adequate": True, "recommended_kva": needed}


def size_pumped_hydro(protected_peak_kw: float, protected_daily_kwh: float, hours: float, head_m: float) -> dict:
    energy = protected_daily_kwh / 24 * hours
    head = max(head_m, 1.0)
    volume_m3 = energy * 367.0 / (head * 0.8)
    return {"power_kw": _round_up(protected_peak_kw * 1.1, 50), "energy_kwh": round(energy, 0), "head_m": round(head, 0),
            "reservoir_m3": round(volume_m3, 0), "site_level_feasible": head_m >= 50 and protected_peak_kw >= 2000}
