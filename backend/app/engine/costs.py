"""CAPEX / OPEX / lifecycle economics for an architecture (USD, with NGN conversion)."""
from __future__ import annotations

from app.config import settings
from app.engine.catalogue import BACKUP_BREAKDOWN, ECON, TECHNOLOGIES


def _tech(key: str) -> dict:
    return TECHNOLOGIES[key]


def storage_capex(chem: str, energy_kwh: float, power_kw: float) -> float:
    t = _tech(chem)
    return energy_kwh * t["capex_usd_per_kwh"] + power_kw * t["capex_usd_per_kw"]


def build_cost_model(components: dict, econ_overrides: dict | None = None) -> dict:
    """components: {ups:{kva}, backup_device:{chemistry,energy_kwh,power_kw}, pv:{kwp}, wind:{kw},
    hydrogen:{...}, generator:{kva,existing}, pumped_hydro:{power_kw,energy_kwh}}"""
    ov = econ_overrides or {}
    diesel_price = ov.get("diesel_price_usd_per_l", settings.diesel_price_usd_per_l)
    fx = ov.get("usd_to_ngn", settings.usd_to_ngn)
    grid_tariff = ov.get("grid_tariff_usd_per_kwh", settings.grid_tariff_usd_per_kwh)

    lines: list[dict] = []
    opex_year = 0.0
    replacement_year = 0.0

    def add(category: str, label: str, usd: float, tech: str | None = None):
        if usd <= 0:
            return
        lines.append({"category": category, "label": label, "usd": round(usd, 0)})

    ups = components.get("ups")
    if ups and ups.get("kva", 0) > 0:
        c = ups["kva"] * _tech("ups")["capex_usd_per_kw"]
        add("UPS (critical circuits)", f"{ups['kva']} kVA online UPS incl. 15 min backup devices", c)
        opex_year += c * _tech("ups")["opex_pct"] / 100
        replacement_year += c * 0.30 / 4  # backup device strings every ~4 years

    bat = components.get("backup_device")
    if bat and bat.get("energy_kwh", 0) > 0:
        chem = bat["chemistry"]
        total = storage_capex(chem, bat["energy_kwh"], bat["power_kw"])
        for cat, share in BACKUP_BREAKDOWN.items():
            add(cat, f"{_tech(chem)['name']} — {cat.lower()}", total * share)
        opex_year += total * _tech(chem)["opex_pct"] / 100
        life = _tech(chem)["life_years"]
        if life < ECON["analysis_years"]:
            replacement_year += total * 0.55 * (ECON["analysis_years"] - life) / ECON["analysis_years"] / ECON["analysis_years"]

    pv = components.get("pv")
    if pv and pv.get("kwp", 0) > 0:
        c = pv["kwp"] * _tech("solar_pv")["capex_usd_per_kw"]
        add("Solar PV (modules + mounting + inverters)", f"{pv['kwp']:.0f} kWp PV array", c)
        opex_year += c * _tech("solar_pv")["opex_pct"] / 100

    wind = components.get("wind")
    if wind and wind.get("kw", 0) > 0:
        c = wind["kw"] * _tech("wind")["capex_usd_per_kw"]
        add("Wind turbine", f"{wind['kw']} kW wind turbine incl. tower & foundation", c)
        opex_year += c * _tech("wind")["opex_pct"] / 100

    h2 = components.get("hydrogen")
    if h2 and h2.get("h2_kg", 0) > 0:
        t = _tech("hydrogen")
        c_el = h2["electrolyser_kw"] * 1400
        c_fc = h2["fuel_cell_kw"] * 1800
        c_st = h2["h2_kg"] * 600
        c_pv = h2.get("pv_dedicated_kwp", 0) * _tech("solar_pv")["capex_usd_per_kw"]
        add("Hydrogen — electrolyser + water treatment", f"{h2['electrolyser_kw']:.0f} kW PEM electrolyser", c_el)
        add("Hydrogen — compressed storage", f"{h2['h2_kg']:.0f} kg H₂ at 350 bar", c_st)
        add("Hydrogen — fuel cell", f"{h2['fuel_cell_kw']:.0f} kW fuel cell", c_fc)
        add("Solar PV (dedicated to electrolysis)", f"{h2.get('pv_dedicated_kwp', 0):.0f} kWp", c_pv)
        opex_year += (c_el + c_fc + c_st) * t["opex_pct"] / 100 + c_pv * 0.015

    gen = components.get("generator")
    if gen and gen.get("kva", 0) > 0:
        if gen.get("existing"):
            c = gen["kva"] * 35  # integration: ATS, sync controller, load-sharing with the backup device
            add("Generator integration (ATS / controls)", f"Integrate existing {gen['kva']:.0f} kVA generator", c)
        else:
            c = gen["kva"] * _tech("diesel_gen")["capex_usd_per_kw"]
            add("Diesel generator (new)", f"{gen['kva']:.0f} kVA generator + fuel tank", c)
        opex_year += c * 0.02

    ph = components.get("pumped_hydro")
    if ph and ph.get("power_kw", 0) > 0:
        c = ph["power_kw"] * _tech("pumped_hydro")["capex_usd_per_kw"] + ph["energy_kwh"] * _tech("pumped_hydro")["capex_usd_per_kwh"]
        add("Pumped hydro (civil + turbines)", f"{ph['power_kw']:.0f} kW / {ph['energy_kwh']:.0f} kWh, {ph['head_m']:.0f} m head", c)
        opex_year += c * 0.01

    capex = sum(l["usd"] for l in lines)
    # engineering / commissioning / contingency on top of component costs (if not already in the backup device cost split)
    if capex > 0 and not bat:
        add("Engineering / commissioning", "Design, permitting, commissioning (6 %)", capex * 0.06)
        capex = sum(l["usd"] for l in lines)

    # aggregate by category for the chart
    by_cat: dict[str, float] = {}
    for l in lines:
        by_cat[l["category"]] = by_cat.get(l["category"], 0) + l["usd"]
    breakdown = [{"category": k, "usd": round(v, 0), "pct": round(100 * v / capex, 1) if capex else 0} for k, v in by_cat.items()]
    breakdown.sort(key=lambda x: -x["usd"])

    return {
        "capex_usd": round(capex, 0), "capex_ngn": round(capex * fx, 0), "opex_usd_per_year": round(opex_year, 0),
        "replacement_usd_per_year": round(replacement_year, 0), "lines": lines, "breakdown": breakdown,
        "assumptions": {"usd_to_ngn": fx, "diesel_price_usd_per_l": diesel_price, "grid_tariff_usd_per_kwh": grid_tariff,
                        "analysis_years": ECON["analysis_years"], "discount_rate": settings.discount_rate},
    }


def lifecycle(cost_model: dict, sim_summary: dict, protected_daily_kwh: float, outage_hours_per_day: float,
              required_hours: float, protected_peak_kw: float, econ_overrides: dict | None = None) -> dict:
    """Lifecycle cost, diesel baseline, savings, payback, LCOS-style metrics."""
    ov = econ_overrides or {}
    diesel_price = ov.get("diesel_price_usd_per_l", settings.diesel_price_usd_per_l)
    grid_tariff = ov.get("grid_tariff_usd_per_kwh", settings.grid_tariff_usd_per_kwh)
    years = ECON["analysis_years"]
    fx = cost_model["assumptions"]["usd_to_ngn"]

    # Baseline: protected load during expected outages served 100 % by diesel
    outage_kwh_year = protected_daily_kwh / 24 * outage_hours_per_day * 365
    diesel_usd_per_kwh = ECON["diesel_l_per_kwh"] * diesel_price + ECON["diesel_opex_usd_per_kwh"]
    baseline_fuel_year = outage_kwh_year * diesel_usd_per_kwh
    baseline_15y = baseline_fuel_year * years

    # Proposed system running costs from the simulation (scaled to a year)
    fuel_l_day = sim_summary.get("fuel_l", 0.0)
    fuel_year = fuel_l_day * 365 * diesel_price
    pv_kwh_day = sim_summary.get("pv_used_kwh", 0.0) + sim_summary.get("wind_used_kwh", 0.0)
    grid_savings_year = pv_kwh_day * 365 * grid_tariff  # renewable energy displacing grid purchases
    grid_charge_year = sim_summary.get("backup_grid_charge_kwh", 0.0) * 365 * grid_tariff  # energy bought to recharge storage
    opex_year = cost_model["opex_usd_per_year"] + cost_model["replacement_usd_per_year"] + fuel_year + grid_charge_year
    total_15y = cost_model["capex_usd"] + opex_year * years
    net_15y = total_15y - grid_savings_year * years
    annual_savings = baseline_fuel_year + grid_savings_year - opex_year
    payback = cost_model["capex_usd"] / annual_savings if annual_savings > 0 else None

    served_kwh_year = max(1.0, outage_kwh_year)
    lcoe_resilience = total_15y / (served_kwh_year * years)
    return {
        "analysis_years": years,
        "baseline_diesel_usd_per_kwh": round(diesel_usd_per_kwh, 3),
        "baseline_diesel_usd_per_year": round(baseline_fuel_year, 0),
        "baseline_diesel_usd_15y": round(baseline_15y, 0),
        "system_opex_usd_per_year": round(opex_year, 0), "system_fuel_usd_per_year": round(fuel_year, 0),
        "storage_grid_charging_usd_per_year": round(grid_charge_year, 0),
        "net_cost_15y_usd": round(net_15y, 0),
        "renewable_grid_savings_usd_per_year": round(grid_savings_year, 0),
        "total_cost_15y_usd": round(total_15y, 0), "total_cost_15y_ngn": round(total_15y * fx, 0),
        "annual_net_savings_usd": round(annual_savings, 0), "simple_payback_years": round(payback, 1) if payback else None,
        "cost_per_resilient_kwh_usd": round(lcoe_resilience, 3),
        "capex_per_protected_kw_usd": round(cost_model["capex_usd"] / max(protected_peak_kw, 1), 0),
        "capex_per_backup_hour_usd": round(cost_model["capex_usd"] / max(required_hours, 0.25), 0),
        "outage_kwh_per_year": round(outage_kwh_year, 0),
    }
