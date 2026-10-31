"""Recommendation orchestrator — evaluates every candidate architecture for a site + facility
and returns an explainable ranking (scores, sizing, costs, 24 h simulation, reasons)."""
from __future__ import annotations

from app.engine import sizing
from app.engine.catalogue import REFERENCES, TECHNOLOGIES
from app.engine.costs import build_cost_model, lifecycle
from app.engine.simulation import simulate

WEIGHTS: dict[str, dict[str, float]] = {
    "balanced":       {"response": .12, "duration": .16, "site": .14, "cost": .16, "opex": .10, "complexity": .08, "healthcare": .14, "clean": .06, "expansion": .04},
    "cheapest":       {"response": .08, "duration": .12, "site": .10, "cost": .30, "opex": .18, "complexity": .08, "healthcare": .08, "clean": .02, "expansion": .04},
    "greenest":       {"response": .08, "duration": .12, "site": .16, "cost": .08, "opex": .08, "complexity": .06, "healthcare": .08, "clean": .30, "expansion": .04},
    "most_reliable":  {"response": .18, "duration": .20, "site": .10, "cost": .08, "opex": .06, "complexity": .10, "healthcare": .20, "clean": .04, "expansion": .04},
    "longest_backup": {"response": .10, "duration": .32, "site": .12, "cost": .10, "opex": .08, "complexity": .08, "healthcare": .12, "clean": .04, "expansion": .04},
}

DIMENSION_LABELS = {"response": "Response speed", "duration": "Backup-duration fit", "site": "Site suitability",
                    "cost": "CAPEX fit", "opex": "Lifecycle cost", "complexity": "Simplicity / O&M", "healthcare": "Healthcare suitability",
                    "clean": "Clean-energy share", "expansion": "Expansion potential"}

CANONICAL = [
    {"id": "ups_only", "name": "UPS only", "short": "UPS", "parts": ["ups"], "color": "#B8C4D9"},
    {"id": "li_ion_backup", "name": "UPS + Li-ion backup device (grid-charged)", "short": "Li-ion backup device", "parts": ["ups", "li_ion"], "color": "#D4A056"},
    {"id": "solar_li_ion", "name": "UPS + Solar PV + Li-ion backup device", "short": "Solar + Li-ion", "parts": ["ups", "solar_pv", "li_ion"], "color": "#F0CB72"},
    {"id": "wind_li_ion", "name": "UPS + Wind + Li-ion backup device", "short": "Wind + Li-ion", "parts": ["ups", "wind", "li_ion"], "color": "#22B7E8"},
    {"id": "solar_flow", "name": "UPS + Solar PV + Flow backup device", "short": "Solar + Flow", "parts": ["ups", "solar_pv", "flow"], "color": "#4ADE80"},
    {"id": "solar_hydrogen", "name": "UPS + Solar PV + Hydrogen (electrolyser + fuel cell)", "short": "Solar + H₂", "parts": ["ups", "solar_pv", "hydrogen"], "color": "#8B8BFF"},
    {"id": "pumped_hydro", "name": "Pumped hydro / river-linked (regional concept)", "short": "Pumped hydro", "parts": ["pumped_hydro"], "color": "#3A86E6"},
    {"id": "gen_hybrid", "name": "UPS + Generator + Li-ion backup device hybrid", "short": "Gen + Li-ion", "parts": ["ups", "diesel_gen", "li_ion"], "color": "#EF6B5C"},
]


def _label(score: float) -> str:
    return "High" if score >= 72 else "Medium" if score >= 55 else "Low" if score >= 38 else "Not suitable"


def _build_components(arch: dict, load: dict, site: dict, fac: dict, water: dict, existing: dict) -> dict:
    parts = arch["parts"]
    hours = fac["backup_hours"]
    comp: dict = {}
    solar = site["solar"]
    roof, land = fac["roof_area_m2"], fac["land_area_m2"]
    if "ups" in parts:
        comp["ups"] = sizing.size_ups(load["critical_peak_kw"])
        if existing.get("ups_kva", 0) >= comp["ups"]["kva"]:
            comp["ups"]["existing"] = True
    pv_kwp = 0.0
    if "solar_pv" in parts:
        pv = sizing.size_pv(load["protected_daily_kwh"], solar["design_psh"], solar["annual_psh"], roof, land,
                            temp_derate=site["temperature"]["pv_derate"], target_fraction=1.25 if hours <= 24 else 1.6)
        if existing.get("solar_kwp", 0) > 0:
            pv["existing_kwp"] = existing["solar_kwp"]
            pv["kwp"] = max(pv["kwp"], existing["solar_kwp"])
        comp["pv"] = pv
        pv_kwp = pv["kwp"]
    if "wind" in parts:
        comp["wind"] = sizing.size_wind(load["protected_daily_kwh"], site["wind"]["capacity_factor"], site["wind"]["score"], land)
    has_gen_tier = "diesel_gen" in parts
    bat_hours = min(hours, 24) if not (has_gen_tier and hours > 10) else min(hours, 8.0)  # generator carries extended outages
    if "li_ion" in parts:
        comp["backup_device"] = sizing.size_backup(load["protected_peak_kw"], load["protected_daily_kwh"], bat_hours, "li_ion", pv_kwp, solar["design_psh"])
        if has_gen_tier and hours > 10:
            comp["backup_device"]["design_note"] = f"sized for {bat_hours:g} h bridging; generator covers the remaining {hours - bat_hours:g} h"
    if "flow" in parts:
        comp["backup_device"] = sizing.size_backup(load["protected_peak_kw"], load["protected_daily_kwh"], bat_hours, "flow", pv_kwp, solar["design_psh"])
    if "hydrogen" in parts:
        comp["hydrogen"] = sizing.size_hydrogen(load["protected_peak_kw"], load["protected_daily_kwh"], max(hours, 24), solar["design_psh"])
        # a small Li-ion buffer smooths fuel-cell ramping
        comp["backup_device"] = sizing.size_backup(load["protected_peak_kw"], load["protected_daily_kwh"], 1.0, "li_ion", pv_kwp, solar["design_psh"])
    if "diesel_gen" in parts:
        comp["generator"] = sizing.size_generator(load["protected_peak_kw"], existing.get("generator_kva") or None)
    elif existing.get("generator_kva", 0) > 0 and arch.get("keep_existing_generator", False):
        comp["generator"] = sizing.size_generator(load["protected_peak_kw"], existing["generator_kva"])
        comp["generator"]["retained_only"] = True
    if "pumped_hydro" in parts:
        comp["pumped_hydro"] = sizing.size_pumped_hydro(load["protected_peak_kw"], load["protected_daily_kwh"], hours, water["scores"]["head_m"])
    return comp


def _dimension_scores(arch: dict, comp: dict, sim: dict, cost: dict, life: dict, site: dict, fac: dict, load: dict,
                      capex_min: float, cost15_min: float) -> dict:
    parts = arch["parts"]
    s = sim["summary"]
    hours = fac["backup_hours"]

    # response
    if "ups" in parts:
        response = 100
    elif "li_ion" in parts or "flow" in parts:
        response = 82
    elif "hydrogen" in parts:
        response = 50
    elif "pumped_hydro" in parts:
        response = 45
    else:
        response = 30

    # duration fit (uses simulated critical service + storage autonomy)
    if "ups" in parts and len(parts) == 1:
        autonomy = comp["ups"]["autonomy_min"] / 60
    elif "pumped_hydro" in parts:
        autonomy = hours if comp["pumped_hydro"]["site_level_feasible"] else 0.5
    elif "hydrogen" in parts:
        autonomy = comp["hydrogen"]["autonomy_h"]
    elif "backup_device" in comp:
        autonomy = comp["backup_device"]["autonomy_h"]
        if "generator" in comp and comp["generator"].get("adequate", True):
            autonomy = max(autonomy, 72)  # fuel-limited but multi-day
        if "pv" in comp and comp["pv"]["kwp"] > 0:
            autonomy = max(autonomy, min(hours, comp["backup_device"]["autonomy_h"] * 1.3))
    else:
        autonomy = 0
    ratio = min(1.5, autonomy / max(hours, 0.25))
    duration = 100 if ratio >= 1 else round(100 * ratio ** 1.4)
    if not s["critical_supplied_during_outage"]:
        crit = s["critical_served_pct"]
        duration = min(duration, 75 if crit >= 95 else 55 if crit >= 85 else 40)

    # site suitability
    if "pumped_hydro" in parts:
        site_s = site["water"]["pumped_hydro"] if comp["pumped_hydro"]["site_level_feasible"] else min(30, site["water"]["pumped_hydro"])
    elif "wind" in parts:
        site_s = site["wind"]["score"] if comp.get("wind", {}).get("kw", 0) > 0 else 12
    elif "hydrogen" in parts:
        site_s = round(0.6 * site["solar"]["score"] + 0.4 * site["water"]["hydrogen_water"])
    elif "solar_pv" in parts:
        site_s = site["solar"]["score"] if comp["pv"]["kwp"] > 0 else 15
        if comp["pv"].get("area_capped"):
            site_s = round(site_s * max(0.75, comp["pv"]["kwp"] / max(comp["pv"]["kwp_needed"], 1)))
    elif "li_ion" in parts:
        site_s = round(100 - (24 - site["grid"]["supply_hours"]) / 24 * 70)  # needs the grid to recharge
    elif "ups" in parts:
        site_s = round(100 - (24 - site["grid"]["supply_hours"]) / 24 * 80)
    else:
        site_s = 60

    # cost fit
    capex = cost["capex_usd"]
    budget = fac.get("budget_usd")
    if budget and budget > 0:
        r = capex / budget
        cost_s = 100 if r <= 0.8 else 85 if r <= 1.0 else 55 if r <= 1.3 else 25 if r <= 2 else 5
    else:
        cost_s = round(100 * (capex_min / max(capex, 1)) ** 0.6) if capex > 0 else 50
    net_ref = max(life["net_cost_15y_usd"], 0.05 * max(capex, 1.0))   # floor: 5 % of CAPEX
    opex_s = round(100 * (cost15_min / net_ref) ** 0.7)

    complexity_level = max([TECHNOLOGIES[p]["complexity"] for p in parts] + [1])
    complexity = 100 - (complexity_level - 1) * 22

    healthcare = round(0.45 * response + 0.55 * s["critical_served_pct"])
    if fac["type"].startswith("hospital") and "ups" not in parts:
        healthcare = max(0, healthcare - 25)

    clean = round(s["renewable_share_pct"])
    if "hydrogen" in parts:
        clean = max(clean, 70)
    if "pumped_hydro" in parts:
        clean = max(clean, 60)

    expansion = max([{"ups": 30, "li_ion": 80, "flow": 85, "hydrogen": 90, "pumped_hydro": 55, "solar_pv": 90, "wind": 70, "diesel_gen": 35}[p] for p in parts])

    dims = {"response": response, "duration": duration, "site": site_s, "cost": cost_s, "opex": opex_s, "complexity": complexity,
            "healthcare": healthcare, "clean": clean, "expansion": expansion}
    return {k: int(max(0, min(100, round(v)))) for k, v in dims.items()} | {"autonomy_h": round(autonomy, 1)}


def _gates(arch: dict, comp: dict, site: dict, fac: dict, load: dict, existing: dict) -> tuple[float, list[str]]:
    """Hard rules → score cap + explanations."""
    cap, notes = 100.0, []
    hours = fac["backup_hours"]
    aid = arch["id"]
    if aid == "ups_only" and hours > 0.5:
        cap, notes = 30, [f"UPS alone bridges minutes; the facility needs {hours:g} h of backup."]
    if aid == "wind_li_ion":
        if comp.get("wind", {}).get("kw", 0) == 0:
            cap = min(cap, 25)
            notes.append(f"Wind resource too weak: {site['wind']['annual_ws50']} m/s at 50 m (score {site['wind']['score']}/100) or no open land.")
        elif site["wind"]["score"] < 60:
            cap = min(cap, 60)
            notes.append("Wind is only marginal here — a turbine would be a secondary source, not the backbone.")
    if aid == "pumped_hydro":
        ph = comp["pumped_hydro"]
        if not ph["site_level_feasible"]:
            cap = min(cap, 22)
            notes.append(f"Pumped hydro is a regional/utility concept: site head ≈ {site['water']['head_m']} m (needs > 50 m) and protected load "
                         f"{load['protected_peak_kw']:.0f} kW (needs > 2 MW). Keep as a community-scale option.")
    if aid == "solar_hydrogen":
        if hours < 48:
            cap = min(cap, 42)
            notes.append(f"Hydrogen suits ≥ 48 h / multi-day autonomy; at {hours:g} h its 35 % round-trip efficiency and complexity are not justified.")
        elif fac.get("budget_usd") and comp and comp.get("hydrogen") and fac["budget_usd"] < 1_000_000:
            cap = min(cap, 55)
            notes.append("Hydrogen CAPEX exceeds the stated budget class.")
    if aid == "solar_flow" and hours < 6:
        cap = min(cap, 60)
        notes.append("Flow backup devices pay off for 6–12 h daily cycling; shorter backup favours Li-ion.")
    if aid == "gen_hybrid":
        if fac["priority"] == "greenest":
            cap = min(cap, 60)
            notes.append("Diesel tier conflicts with the greenest-priority goal (kept as transitional option).")
        if not existing.get("generator_kva") and not fac.get("allow_new_generator", True):
            cap = min(cap, 20)
            notes.append("New generator not allowed by the user.")
    if aid == "li_ion_backup" and site["grid"]["supply_hours"] <= 0:
        cap = min(cap, 15)
        notes.append("Not connected to the grid — a grid-charged backup device could never recharge.")
    elif aid == "li_ion_backup" and site["grid"]["supply_hours"] < 10:
        cap = min(cap, 62)
        notes.append(f"Grid supplies only ≈ {site['grid']['supply_hours']} h/day here — a grid-charged backup device may not fully recharge without solar.")
    if aid in ("solar_li_ion", "solar_flow", "solar_hydrogen") and comp.get("pv", {}).get("kwp", 0) == 0:
        cap = min(cap, 30)
        notes.append("No roof or land area available for PV.")
    return cap, notes


def recommended_stack(site: dict, fac: dict, load: dict, existing: dict) -> dict:
    """Rule engine that composes the headline architecture."""
    hours = fac["backup_hours"]
    parts: list[str] = []
    reasons: list[dict] = []
    if load["critical_share"] > 0.05:
        parts.append("ups")
        reasons.append({"kind": "need", "text": f"Critical load ({load['critical_peak_kw']:.0f} kW peak — ICU, theatre, labs) requires zero-break supply → online UPS on critical circuits."})
    area_ok = (fac["roof_area_m2"] + fac["land_area_m2"]) > 0
    if site["solar"]["score"] >= 50 and area_ok:
        parts.append("solar_pv")
        reasons.append({"kind": "resource", "text": f"Strong solar resource: {site['solar']['annual_psh']} peak-sun-hours/day (score {site['solar']['score']}/100) → PV covers daytime load and recharges storage."})
    elif not area_ok:
        reasons.append({"kind": "constraint", "text": "No roof/land area entered — PV omitted; add area to unlock solar."})
    if site["wind"]["score"] >= 60 and fac["land_area_m2"] >= 2000:
        parts.append("wind")
        reasons.append({"kind": "resource", "text": f"Usable wind: {site['wind']['annual_ws50']} m/s at 50 m (score {site['wind']['score']}/100) with open land → wind turbine adds night-time generation."})
    else:
        reasons.append({"kind": "exclusion", "text": f"Wind not strong enough: {site['wind']['annual_ws50']} m/s at 50 m (score {site['wind']['score']}/100) → no turbine."})
    if hours <= 12:
        parts.append("li_ion")
        reasons.append({"kind": "storage", "text": f"{hours:g} h backup target → Li-ion (LFP) backup_device: fastest deployment, best cost for sub-day outages."})
    elif hours <= 24 and site["grid"]["class"] in ("D", "E") and load["protected_daily_kwh"] / 24 * hours >= 500 \
            and (fac.get("budget_usd") is None or fac["budget_usd"] >= 500_000):
        parts.append("flow")
        reasons.append({"kind": "storage", "text": f"{hours:g} h backup with a Class {site['grid']['class']} grid means daily deep cycling → vanadium flow backup device (15,000+ cycles, no thermal runaway)."})
    else:
        parts.append("li_ion")
        reasons.append({"kind": "storage", "text": f"{hours:g} h backup → Li-ion backup device sized for the protected load; multi-day autonomy handled by the generator tier."})
    if existing.get("generator_kva", 0) > 0:
        parts.append("diesel_gen")
        reasons.append({"kind": "existing", "text": f"Existing {existing['generator_kva']:.0f} kVA generator retained as last-tier backup (N+1) — runs far fewer hours behind solar + storage."})
    elif hours > 12 and fac.get("allow_new_generator", True) and fac["priority"] != "greenest":
        parts.append("diesel_gen")
        reasons.append({"kind": "storage", "text": "Backup beyond 12 h → a small generator as the last tier is cheaper than doubling the backup_device."})
    if hours >= 48 and fac["priority"] in ("longest_backup", "greenest"):
        reasons.append({"kind": "future", "text": "Multi-day target: hydrogen storage is the future-fit upgrade path once costs fall (shown in comparison)."})
    else:
        reasons.append({"kind": "exclusion", "text": f"Hydrogen not economical at this scale/duration ({hours:g} h) — 35 % round-trip efficiency, high complexity."})
    if site["water"]["pumped_hydro"] >= 55:
        reasons.append({"kind": "regional", "text": f"Site terrain/water (head ≈ {site['water']['head_m']} m, {site['water']['discharge_class']}) supports a regional pumped-hydro concept — utility/community scale, not single-facility."})
    else:
        reasons.append({"kind": "exclusion", "text": f"Pumped hydro not feasible at site level (head ≈ {site['water']['head_m']} m, {site['water']['discharge_class']} nearby)."})
    if site["water"]["micro_hydro"] >= 60:
        reasons.append({"kind": "resource", "text": f"Flowing water nearby ({site['water']['discharge_class']}, {site['water']['nearest_km']} km): a run-of-river micro-hydro study is worthwhile as a supplementary source."})
    reasons.insert(0, {"kind": "grid", "text": f"Grid class {site['grid']['class']} ({site['grid']['label']}): ≈ {24 - site['grid']['supply_hours']} h/day without supply, outage risk {site['grid']['outage_risk']} → storage is essential, not optional."})
    names = {"ups": "UPS", "solar_pv": "Solar PV", "wind": "Wind", "li_ion": "Li-ion backup device", "flow": "Flow backup device",
             "diesel_gen": "Existing diesel backup" if existing.get("generator_kva", 0) > 0 else "Generator (last tier)"}
    return {"id": "recommended_stack", "name": " + ".join(names[p] for p in parts), "short": "Recommended stack", "parts": parts,
            "color": "#4ADE80", "reasons": reasons, "keep_existing_generator": True}


def evaluate(site: dict, water: dict, load: dict, fac: dict, hourly: dict, existing: dict, opts: dict) -> dict:
    supply_hours = site["grid"]["supply_hours"]
    hours = fac["backup_hours"]
    stack = recommended_stack(site, fac, load, existing)
    archs = [stack] + [dict(a) for a in CANONICAL]
    evaluated = []
    for a in archs:
        comp = _build_components(a, load, site, fac, water, existing)
        cost = build_cost_model(comp, opts.get("econ"))
        sim = simulate(load, hourly, comp, supply_hours, opts.get("outage_start_hour", 18), min(hours, 24), opts.get("charge_from_grid", True))
        life = lifecycle(cost, sim["summary"], load["protected_daily_kwh"], 24 - supply_hours, hours, load["protected_peak_kw"], opts.get("econ"))
        evaluated.append({"arch": a, "components": comp, "cost": cost, "sim": sim, "life": life})

    weights = WEIGHTS[fac["priority"]]
    # pass 1: autonomy of each option → cost references only among options that meet ≥ 75 % of the target
    pre = {e["arch"]["id"]: _dimension_scores(e["arch"], e["components"], e["sim"], e["cost"], e["life"], site, fac, load, 1.0, 1.0)["autonomy_h"]
           for e in evaluated}
    viable = [e for e in evaluated if e["cost"]["capex_usd"] > 0 and pre[e["arch"]["id"]] >= 0.75 * hours and e["arch"]["id"] != "pumped_hydro"]
    if not viable:
        viable = [e for e in evaluated if e["cost"]["capex_usd"] > 0]
    capex_min = min(e["cost"]["capex_usd"] for e in viable) if viable else 1.0
    cost15_min = min(max(e["life"]["net_cost_15y_usd"], 0.05 * e["cost"]["capex_usd"]) for e in viable) if viable else 1.0

    results = []
    for e in evaluated:
        dims = _dimension_scores(e["arch"], e["components"], e["sim"], e["cost"], e["life"], site, fac, load, capex_min, cost15_min)
        cap, notes = _gates(e["arch"], e["components"], site, fac, load, existing)
        total = sum(weights[k] * dims[k] for k in weights)
        total = min(total, cap)
        results.append({
            "id": e["arch"]["id"], "name": e["arch"]["name"], "short": e["arch"]["short"], "parts": e["arch"]["parts"], "color": e["arch"]["color"],
            "score": round(total, 1), "suitability": _label(total), "capped": cap < 100, "notes": notes,
            "dimensions": {k: dims[k] for k in weights}, "autonomy_h": dims["autonomy_h"],
            "components": e["components"], "cost": e["cost"], "lifecycle": e["life"], "simulation_summary": e["sim"]["summary"],
            "simulation_hourly": e["sim"]["hourly"], "reasons": e["arch"].get("reasons", []),
        })
    canonical = [r for r in results if r["id"] != "recommended_stack"]
    canonical.sort(key=lambda r: -r["score"])
    for i, r in enumerate(canonical):
        r["rank"] = i + 1
    stack_res = next(r for r in results if r["id"] == "recommended_stack")
    best = canonical[0]
    # The rule-built stack is the headline unless a canonical option clearly beats it
    recommended = stack_res if stack_res["score"] >= best["score"] - 4 else best
    if recommended is best:
        recommended = {**best, "reasons": stack_res["reasons"] + [{"kind": "engine", "text": f"Scoring engine preferred '{best['name']}' over the rule-built stack for the '{fac['priority']}' priority."}]}
    # keep hourly rows only for the recommended option + top 3 (payload size), plus the best-ranked design for each
    # resource lens (sun · wind · water), so the 3D simulation can play the design that matches the lens the user picked
    keep = {recommended["id"]} | {r["id"] for r in canonical[:3]}
    for lens_parts in (("solar_pv",), ("wind",), ("hydrogen", "pumped_hydro")):
        fit = next((r for r in canonical if any(p in r["parts"] for p in lens_parts)), None)
        if fit:
            keep.add(fit["id"])
    for r in results:
        if r["id"] not in keep:
            r["simulation_hourly"] = []
    return {
        "recommended": recommended,
        "recommended_stack": {k: v for k, v in stack_res.items() if k != "simulation_hourly"},
        "ranked": canonical,
        "weights": weights, "dimension_labels": DIMENSION_LABELS,
        "technologies": {k: {**v} for k, v in TECHNOLOGIES.items()},
        "references": REFERENCES,
    }
