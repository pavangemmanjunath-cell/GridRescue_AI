"""Investment case — turns the numbers into a decision a hospital board can act on.

Answers: how much power does this facility need, what should we buy, why this technology (and not the
others), what it costs, what it saves, what happens if we do nothing, and the recommended next steps.
"""
from __future__ import annotations

DIESEL_KG_CO2_PER_L = 2.68
GRID_KG_CO2_PER_KWH = {"NG": 0.42, "GH": 0.30, "KE": 0.12, "ZA": 0.90, "EG": 0.45, "ET": 0.02, "TZ": 0.35, "SN": 0.55, "CI": 0.40, "CM": 0.30, "MA": 0.65, "DZ": 0.50}
TECH_LABEL = {"ups": "UPS", "li_ion": "Li-ion (LFP) backup device", "flow": "vanadium flow backup device", "hydrogen": "hydrogen storage", "pumped_hydro": "pumped hydro",
              "solar_pv": "solar PV", "wind": "wind turbine", "diesel_gen": "diesel generator"}


def _by_id(ranked: list[dict], aid: str) -> dict | None:
    return next((r for r in ranked if r["id"] == aid), None)


def _annuity(principal: float, rate: float, years: int) -> float:
    """Monthly repayment of a fully amortising loan."""
    r, n = rate / 12, years * 12
    return principal / n if r == 0 else principal * r / (1 - (1 + r) ** -n)


# Financing structures a Nigerian hospital can realistically sign; rates are editable assumptions, not offers.
FINANCING = [
    {"id": "concessional", "label": "Concessional / DFI loan (USD)", "rate": 0.08, "years": 10},
    {"id": "commercial", "label": "Commercial bank loan (USD)", "rate": 0.14, "years": 7},
]


def affordability(cost: dict, life: dict, load: dict, fx: float) -> dict:
    """Monthly view for a hospital board: today's diesel spend vs the new system's repayment and running cost."""
    capex = cost["capex_usd"]
    diesel_m = life["baseline_diesel_usd_per_year"] / 12
    grid_sav_m = life["renewable_grid_savings_usd_per_year"] / 12
    run_m = life["system_opex_usd_per_year"] / 12
    beds = max(1, load.get("beds") or 0)
    options = []
    for f in FINANCING:
        pay = _annuity(capex, f["rate"], f["years"])
        net = diesel_m + grid_sav_m - run_m - pay
        options.append({**f, "monthly_payment_usd": round(pay), "monthly_net_cashflow_usd": round(net),
                        "monthly_net_cashflow_ngn": round(net * fx), "cash_positive_from_month_1": net >= 0})
    best = max(options, key=lambda o: o["monthly_net_cashflow_usd"])
    return {
        "monthly_diesel_today_usd": round(diesel_m), "monthly_diesel_today_ngn": round(diesel_m * fx),
        "monthly_grid_savings_usd": round(grid_sav_m), "monthly_running_cost_usd": round(run_m),
        "capex_per_bed_usd": round(capex / beds) if load.get("beds") else None,
        "cost_per_resilient_kwh_usd": life["cost_per_resilient_kwh_usd"], "financing": options,
        "statement": (f"Today the outage hours cost ≈ US$ {diesel_m:,.0f}/month (₦{diesel_m * fx / 1e6:,.1f} M) in diesel. "
                      f"Financed with a {best['label']} at {best['rate'] * 100:.0f} % over {best['years']} years, the system costs "
                      f"US$ {best['monthly_payment_usd']:,.0f}/month in repayments plus US$ {run_m:,.0f}/month to run, and saves "
                      f"US$ {grid_sav_m:,.0f}/month of grid purchases — net "
                      + (f"+US$ {best['monthly_net_cashflow_usd']:,.0f}/month from the first month." if best["cash_positive_from_month_1"]
                         else f"US$ {-best['monthly_net_cashflow_usd']:,.0f}/month more than today until the loan is repaid.")),
    }


def build_case(rec: dict, ranked: list[dict], load: dict, site: dict, fac: dict, location: dict, existing: dict) -> dict:
    cost, life, sim = rec["cost"], rec["lifecycle"], rec["simulation_summary"]
    comp = rec["components"]
    hours = fac["backup_hours"]
    cc = (location.get("country_code") or "NG").upper()
    grid_ef = GRID_KG_CO2_PER_KWH.get(cc, 0.45)
    outage_h_day = 24 - site["grid"]["supply_hours"]

    # ── Power requirement statement ─────────────────────────────────────────────────────────
    need = {
        "facility": fac.get("name") or load["facility_label"], "beds": load["beds"],
        "avg_load_kw": load["avg_load_kw"], "peak_load_kw": load["peak_load_kw"], "daily_kwh": load["daily_kwh"],
        "critical_peak_kw": load["critical_peak_kw"], "protected_peak_kw": load["protected_peak_kw"], "protected_daily_kwh": load["protected_daily_kwh"],
        "backup_hours": hours, "energy_to_ride_through_kwh": round(load["protected_daily_kwh"] / 24 * hours, 0),
        "expected_outage_hours_per_year": round(outage_h_day * 365),
        "statement": (f"{fac.get('name') or load['facility_label']} needs about {load['avg_load_kw']:.0f} kW on average and {load['peak_load_kw']:.0f} kW at peak "
                      f"({load['daily_kwh']:.0f} kWh/day). {load['critical_peak_kw']:.0f} kW of that is life-critical (ICU, theatres, labs, cold chain) and must never see a break; "
                      f"{load['protected_peak_kw']:.0f} kW must survive a {hours:g}-hour outage — about {load['protected_daily_kwh'] / 24 * hours:,.0f} kWh of stored or generated energy."),
    }

    # ── Do-nothing scenario ────────────────────────────────────────────────────────────────
    diesel_l_year = life["outage_kwh_per_year"] * 0.32
    do_nothing = {
        "outage_hours_per_year": round(outage_h_day * 365), "diesel_litres_per_year": round(diesel_l_year),
        "diesel_cost_per_year_usd": life["baseline_diesel_usd_per_year"], "diesel_cost_15y_usd": life["baseline_diesel_usd_15y"],
        "co2_t_per_year": round(diesel_l_year * DIESEL_KG_CO2_PER_L / 1000, 1),
        "statement": (f"Doing nothing means ≈ {outage_h_day * 365:,.0f} grid-outage hours a year covered by diesel: ≈ {diesel_l_year:,.0f} litres, "
                      f"US$ {life['baseline_diesel_usd_per_year']:,.0f} every year (US$ {life['baseline_diesel_usd_15y']:,.0f} over 15 years) and "
                      f"{diesel_l_year * DIESEL_KG_CO2_PER_L / 1000:,.0f} t CO₂/yr — plus the clinical risk of every generator start-up gap."),
    }

    # ── Proposed investment ────────────────────────────────────────────────────────────────
    fuel_l_year = sim.get("fuel_l", 0.0) * 365
    # CO₂ = change in diesel burnt (Scope 1) + change in grid electricity bought (Scope 2). Without the system the grid
    # serves the whole load while it is on; with it, the grid serves what solar does not and also charges the storage.
    # Counting solar once this way avoids crediting outage-hour solar twice (it already replaces diesel).
    rows = rec.get("simulation_hourly") or []
    co2_s1 = (diesel_l_year - fuel_l_year) * DIESEL_KG_CO2_PER_L / 1000
    if len(rows) == 24:
        grid_saved_kwh_day = sum(r["load_kw"] - r["grid_import_kw"] for r in rows if r["grid_available"])
    else:   # no hourly rows: solar used while the grid is on, as a fraction of the day the grid is on
        grid_saved_kwh_day = (sim.get("pv_used_kwh", 0.0) + sim.get("wind_used_kwh", 0.0)) * site["grid"]["supply_hours"] / 24
    co2_s2 = grid_saved_kwh_day * 365 * grid_ef / 1000
    co2_avoided = co2_s1 + co2_s2
    invest = {
        "capex_usd": cost["capex_usd"], "capex_ngn": cost["capex_ngn"], "opex_usd_per_year": life["system_opex_usd_per_year"],
        "annual_net_savings_usd": life["annual_net_savings_usd"], "simple_payback_years": life["simple_payback_years"],
        "net_cost_15y_usd": life["net_cost_15y_usd"], "diesel_avoided_l_per_year": round(max(0.0, diesel_l_year - fuel_l_year)),
        "co2_avoided_t_per_year": round(max(0.0, co2_avoided), 1), "co2_scope1_avoided_t": round(co2_s1, 1), "co2_scope2_avoided_t": round(co2_s2, 1),
        "renewable_share_pct": sim.get("renewable_share_pct", 0),
        "critical_served_pct": sim.get("critical_served_pct", 0), "hours_on_backup": sim.get("hours_on_backup", 0),
        "roi_15y_pct": round(100 * (life["annual_net_savings_usd"] * 15 - cost["capex_usd"]) / max(cost["capex_usd"], 1)),
    }

    # ── Decision call ──────────────────────────────────────────────────────────────────────
    payback = life["simple_payback_years"]
    if rec["id"] == "pumped_hydro":
        decision, decision_kind = "Regional concept — do not fund at facility level", "defer"
    elif payback and payback <= 6 and invest["critical_served_pct"] >= 99:
        decision, decision_kind = "Invest now — bankable", "go"
    elif payback and payback <= 10 and invest["critical_served_pct"] >= 95:
        decision, decision_kind = "Invest — phase the build (UPS + storage first, PV next)", "go_phased"
    elif invest["critical_served_pct"] >= 95:
        decision, decision_kind = "Invest for resilience — payback is long, justify on clinical continuity", "go_resilience"
    else:
        decision, decision_kind = "Re-scope — the configuration does not yet protect the critical load", "rescope"

    # ── Why this technology and not the others ─────────────────────────────────────────────
    why: list[dict] = []
    parts = rec["parts"]
    if "ups" in parts:
        why.append({"tech": "UPS", "verdict": "include", "text": f"Online UPS on the {load['critical_peak_kw']:.0f} kW critical circuits gives 0 ms transfer — the only technology that removes the 10–30 s generator gap that resets ventilators, monitors and imaging."})
    if "solar_pv" in parts and comp.get("pv"):
        pv = comp["pv"]
        why.append({"tech": "Solar PV", "verdict": "include", "text": f"{pv['kwp']:.0f} kWp on {pv['area_m2']:.0f} m² yields ≈ {pv['annual_kwh']:,.0f} kWh/yr at {site['solar']['annual_psh']} peak-sun-hours — the cheapest kWh available here and it recharges the backup device every day."})
    if "li_ion" in parts and comp.get("backup_device"):
        b = comp["backup_device"]
        flow = _by_id(ranked, "solar_flow")
        why.append({"tech": "Li-ion backup device", "verdict": "include", "text": f"{b['energy_kwh']:,.0f} kWh / {b['power_kw']:,.0f} kW LFP bank covers {b['autonomy_h']} h of protected load. "
                    + (f"A flow backup device would cost US$ {flow['cost']['capex_usd'] - cost['capex_usd']:,.0f} more for the same duty; " if flow and flow['cost']['capex_usd'] > cost['capex_usd'] else "")
                    + "LFP has the fastest delivery and the deepest local installer base."})
    if "flow" in parts and comp.get("backup_device"):
        b = comp["backup_device"]
        why.append({"tech": "Flow backup device", "verdict": "include", "text": f"{b['energy_kwh']:,.0f} kWh vanadium flow bank: the grid here is Class {site['grid']['class']}, so the backup device cycles deeply every day — 15,000+ cycles, 20-year life and no thermal-runaway risk in a {site['temperature']['hottest_month_c']} °C climate justify its higher CAPEX."})
    if "wind" in parts and comp.get("wind", {}).get("kw"):
        why.append({"tech": "Wind", "verdict": "include", "text": f"{comp['wind']['kw']} kW turbine at {site['wind']['annual_ws50']} m/s (50 m) adds night-time generation that solar cannot."})
    if "diesel_gen" in parts and comp.get("generator"):
        g = comp["generator"]
        why.append({"tech": "Generator", "verdict": "include", "text": (f"The existing {g['kva']:.0f} kVA generator stays as the last tier — it now runs only for outages longer than the backup device, cutting fuel by ≈ {invest['diesel_avoided_l_per_year']:,.0f} L/yr."
                                                                       if g.get("existing") else f"A {g['kva']:.0f} kVA generator as last tier is cheaper than doubling the backup device for the rare multi-day event.")})
    # exclusions with numbers
    wind_opt = _by_id(ranked, "wind_li_ion")
    if "wind" not in parts and wind_opt:
        why.append({"tech": "Wind", "verdict": "exclude", "text": f"Wind scores {site['wind']['score']}/100 ({site['wind']['annual_ws50']} m/s at 50 m) — a turbine would run at ≈ {site['wind']['capacity_factor'] * 100:.0f} % capacity factor; option ranked #{wind_opt.get('rank')} with score {wind_opt['score']}."})
    h2 = _by_id(ranked, "solar_hydrogen")
    if "hydrogen" not in parts and h2:
        why.append({"tech": "Hydrogen", "verdict": "exclude", "text": f"Hydrogen would cost US$ {h2['cost']['capex_usd']:,.0f} (≈ {h2['cost']['capex_usd'] / max(cost['capex_usd'], 1):.1f}× the recommended CAPEX) at 35 % round-trip efficiency — only justified for multi-day autonomy; keep as the 2030 upgrade path."})
    ph = _by_id(ranked, "pumped_hydro")
    if ph:
        why.append({"tech": "Pumped hydro", "verdict": "exclude" if rec["id"] != "pumped_hydro" else "include", "text": f"Terrain head ≈ {site['water']['head_m']} m and a {load['protected_peak_kw']:.0f} kW load: pumped hydro needs > 50 m head and > 2 MW to be economic — a community/utility concept, not a hospital asset."})
    grid_only = _by_id(ranked, "li_ion_backup")
    if "solar_pv" in parts and grid_only:
        why.append({"tech": "Grid-charged backup device only", "verdict": "exclude", "text": f"A backup device without PV is US$ {max(0, cost['capex_usd'] - grid_only['cost']['capex_usd']):,.0f} cheaper up front but costs US$ {max(0, grid_only['lifecycle']['net_cost_15y_usd'] - life['net_cost_15y_usd']):,.0f} more over 15 years because every stored kWh is bought from the grid or diesel."})

    afford = affordability(cost, life, load, fx=cost["assumptions"]["usd_to_ngn"])

    next_steps = [
        "Commission a 2-week load audit (critical / essential / non-essential circuits) to replace the archetype load model.",
        "Get 3 EPC quotations against the sizing sheet (UPS, PV, storage, controls) — target ±15 % of the CAPEX here.",
        "Confirm roof structural capacity and shading; confirm fire-safety clearance for the backup device container.",
        "Agree an O&M contract with remote monitoring (EMS) and a spare-parts plan — the #1 cause of failed hospital solar projects.",
        "Structure financing: energy-as-a-service / PPA, development-bank concessional loan, or capex with the diesel savings as debt service.",
    ]
    if rec["id"] in ("solar_flow",) or "flow" in parts:
        next_steps.insert(2, "Shortlist two flow-backup vendors with African references and ask for 20-year performance guarantees.")

    return {
        "decision": decision, "decision_kind": decision_kind,
        "headline": f"Invest US$ {cost['capex_usd']:,.0f} (≈ ₦{cost['capex_ngn'] / 1e6:,.0f} M) in {rec['name']}: pays back in {payback if payback else '> 15'} years and keeps {invest['critical_served_pct']:.0f} % of critical load alive through a {hours:g}-hour outage.",
        "power_requirement": need, "do_nothing": do_nothing, "investment": invest, "affordability": afford, "why_technology": why, "next_steps": next_steps,
        "assumptions": {"diesel_kg_co2_per_l": DIESEL_KG_CO2_PER_L, "grid_kg_co2_per_kwh": grid_ef, "diesel_l_per_kwh": 0.32},
    }
