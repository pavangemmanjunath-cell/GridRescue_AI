"""GridRescue agent — a deterministic, tool-using planning loop on top of the engine.

observe site → classify with the ML surrogate → verify against the physics simulation → stress-test the
outage cases a Nigerian hospital actually faces → check affordability → decide and explain.
Every step records the tool it used and the evidence, so the trace can be audited. No LLM is required;
the trace is structured so a language model can narrate it later without changing any number.
"""
from __future__ import annotations

import math

from app.config import settings
from app.ml import backup_classifier
from app.engine.catalogue import ECON
from app.engine.costs import lifecycle
from app.engine.simulation import simulate

NBS_DIESEL_PEAK_NGN_L = 3277.47   # NBS national average diesel price at its recent peak


def _step(sid: str, title: str, tool: str, status: str, summary: str, detail: dict | None = None) -> dict:
    return {"id": sid, "title": title, "tool": tool, "status": status, "summary": summary, "detail": detail or {}}


def _scaled_solar(hourly: dict, target_psh: float) -> dict:
    day = sum(hourly["ghi_w_m2"]) / 1000.0
    k = target_psh / day if day > 0 else 1.0
    return {**hourly, "ghi_w_m2": [g * k for g in hourly["ghi_w_m2"]]}


def _stress(name: str, why: str, s: dict) -> dict:
    ok_c = s["critical_served_pct"] >= 99.9
    ok_e = s["essential_served_pct"] >= 99.0
    status = "pass" if ok_c and ok_e else "warn" if ok_c else "fail"
    return {"scenario": name, "why": why, "status": status, "critical_served_pct": s["critical_served_pct"],
            "essential_served_pct": s["essential_served_pct"], "min_soc_pct": s["min_soc_pct"], "fuel_l": s["fuel_l"],
            "unserved_protected_kwh": round(s["unserved_critical_kwh"] + s["unserved_essential_kwh"], 1),
            "non_essential_shed_kwh": s["unserved_non_essential_kwh"]}


def _sim(load, hourly, comp, supply_h, start, hours, charge) -> dict:
    return simulate(load, hourly, comp, supply_h, start, hours, charge)["summary"]


def run_agent(site: dict, load: dict, fac: dict, hourly: dict, existing: dict, opts: dict, result: dict, investment: dict) -> dict:
    rec = result["recommended"]
    comp = rec["components"]
    econ = opts.get("econ") or {}
    fx = econ.get("usd_to_ngn", settings.usd_to_ngn)
    diesel = econ.get("diesel_price_usd_per_l", settings.diesel_price_usd_per_l)
    start = opts.get("outage_start_hour", 18)
    charge = opts.get("charge_from_grid", True)
    hours = fac["backup_hours"]
    supply_h = site["grid"]["supply_hours"]
    steps: list[dict] = []

    # 1 · observe
    area = fac["roof_area_m2"] + fac["land_area_m2"]
    steps.append(_step("observe", "Observe the site", "site scanner (NASA POWER · Open-Meteo · OSM · DisCo class)", "done",
                       f"Grid class {site['grid']['class']} ({site['grid']['label']}) ≈ {supply_h} h/day supply, outage risk {site['grid']['outage_risk']}; "
                       f"solar {site['solar']['annual_psh']} PSH (worst month {site['solar']['worst_month_psh']}); wind {site['wind']['annual_ws50']} m/s at 50 m; "
                       f"terrain head ≈ {site['water'].get('head_m', 0)} m; {area:,.0f} m² roof + land; target {hours:g} h backup for {load['protected_peak_kw']:.0f} kW protected load.",
                       {"grid_class": site["grid"]["class"], "supply_hours": supply_h}))

    # 2 · classify (ML surrogate)
    model = backup_classifier.load_model()
    pred = None
    if model:
        x = backup_classifier.features_from(site, load, fac, existing, diesel)
        pred = backup_classifier.predict(model, x)
        rules = " AND ".join(f"{p['label']} {p['op']} {p['threshold']:g}" for p in pred["decision_path"][:4])
        steps.append(_step("classify", "Classify the best-fit family", f"ML · {pred['algorithm']} (surrogate of the engine)", "done",
                           f"Predicts '{pred['family_label']}' with {pred['confidence'] * 100:.0f} % of the forest's vote; the decision-tree rules: {rules}.",
                           {"prediction": pred, "model": model["meta"]}))
    else:
        steps.append(_step("classify", "Classify the best-fit family", "ML decision tree", "skipped", "No trained model found — run python -m app.ml.train_backup_classifier."))

    # 3 · verify against the physics simulation
    eng_family = backup_classifier.family_of(rec["parts"])
    if pred:
        if pred["family"] == eng_family:
            steps.append(_step("verify", "Verify with the hourly simulation", "sizing + 24-h dispatch + 9-criterion scoring", "agree",
                               f"Full simulation agrees: '{rec['name']}' scores {rec['score']}/100 and serves {rec['simulation_summary']['critical_served_pct']} % of critical load."))
        else:
            alt = next((r for r in result["ranked"] if backup_classifier.family_of(r["parts"]) == pred["family"]), None)
            if alt and alt["score"] >= rec["score"]:
                why = (f"'{alt['name']}' scores {alt['score']} vs {rec['score']}, but that is within the engine's 4-point tolerance, so the "
                       f"rule-built stack '{rec['name']}' is kept")
            elif alt:
                why = f"'{rec['name']}' scores {rec['score']} vs {alt['score']} for '{alt['name']}'"
            else:
                why = f"'{rec['name']}' scores {rec['score']}; no option of the predicted family was viable"
            steps.append(_step("verify", "Verify with the hourly simulation", "sizing + 24-h dispatch + 9-criterion scoring", "override",
                               f"Simulation overrides the fast guess: {why}. The physics result is used; the ML guess is kept as context."))

    # 4 · stress-test the outage cases hospitals face
    tests = []
    s_design = dict(rec["simulation_summary"])
    tests.append(_stress(f"Design outage — {min(hours, 24):g} h from {start:02d}:00", "the backup target set by the facility", s_design))
    tests.append(_stress("National grid collapse — 24 h blackout", "Nigeria's grid collapsed 12 times in 2024; restoration can take a day",
                         _sim(load, hourly, comp, 0, start, 24, charge)))
    tests.append(_stress("Worst solar month + design outage", "harmattan haze / rainy-season months cut PV yield",
                         _sim(load, _scaled_solar(hourly, site["solar"]["worst_month_psh"]), comp, supply_h, start, min(hours, 24), charge)))
    longer = min(24.0, max(hours * 1.5, hours + 4))
    tests.append(_stress(f"Longer outage — {longer:g} h", "outages often run past the planned window",
                         _sim(load, hourly, comp, supply_h, start, longer, charge)))
    worst = {"pass": 0, "warn": 1, "fail": 2}
    status = max((t["status"] for t in tests), key=lambda v: worst[v])
    fails = [t for t in tests if t["status"] != "pass"]
    steps.append(_step("stress", "Stress-test real outage cases", "dispatch simulator", status,
                       f"{sum(t['status'] == 'pass' for t in tests)}/{len(tests)} outage scenarios keep critical and essential load fully served"
                       + (f"; weakest: {fails[0]['scenario']} ({fails[0]['essential_served_pct']} % essential)." if fails else "."), {"tests": tests}))

    # diesel price shock (affordability at the NBS peak price)
    shock_price = NBS_DIESEL_PEAK_NGN_L / fx
    life_shock = lifecycle(rec["cost"], rec["simulation_summary"], load["protected_daily_kwh"], 24 - supply_h, hours, load["protected_peak_kw"],
                           {**econ, "diesel_price_usd_per_l": shock_price})
    af = investment.get("affordability", {})
    best_fin = max(af.get("financing", []) or [{"monthly_net_cashflow_usd": 0, "label": "—", "cash_positive_from_month_1": False}],
                   key=lambda o: o["monthly_net_cashflow_usd"])
    steps.append(_step("afford", "Check affordability", "lifecycle + financing model", "pass" if best_fin["cash_positive_from_month_1"] else "warn",
                       f"Payback {rec['lifecycle']['simple_payback_years'] or '> 15'} yr at today's diesel (US$ {diesel:.2f}/L) and "
                       f"{life_shock['simple_payback_years'] or '> 15'} yr at the NBS peak price (US$ {shock_price:.2f}/L). "
                       f"Best financing ({best_fin['label']}): net {'+' if best_fin['monthly_net_cashflow_usd'] >= 0 else '−'}US$ {abs(best_fin['monthly_net_cashflow_usd']):,.0f}/month vs today.",
                       {"payback_today": rec["lifecycle"]["simple_payback_years"], "payback_diesel_shock": life_shock["simple_payback_years"],
                        "diesel_shock_usd_l": round(shock_price, 2), "best_financing": best_fin}))

    # 5 · decide
    actions = []
    for t in fails:
        if t["unserved_protected_kwh"] > 0:
            extra = math.ceil(t["unserved_protected_kwh"] / (ECON["backup_dod"] * 0.95) / 10) * 10
            short = f"{t['unserved_protected_kwh']:,.0f} kWh of protected load short"
            gen = comp.get("generator")
            if gen and gen.get("kva", 0) > 0:
                # the generator is already dispatched in this scenario, so it is too small for the protected peak
                fix = f"add ≈ {extra:,.0f} kWh of backup device"
                if not gen.get("adequate", True):
                    fix += f" or upgrade the {gen['kva']:.0f} kVA generator to {gen['recommended_kva']:.0f} kVA (it cannot carry the {load['protected_peak_kw']:.0f} kW protected peak)"
                actions.append(f"{t['scenario']}: {short} even with the generator running — {fix}.")
            elif existing.get("generator_kva"):
                actions.append(f"{t['scenario']}: {short} — retain the existing {existing['generator_kva']:.0f} kVA generator on auto-start as the last tier, or add ≈ {extra:,.0f} kWh of backup_device.")
            else:
                actions.append(f"{t['scenario']}: {short} — add ≈ {extra:,.0f} kWh of backup device or a small generator as the last tier.")
    if not actions:
        actions.append("All outage scenarios pass — proceed to a load audit and EPC quotations against this sizing sheet.")
    design_ok = tests[0]["status"] == "pass"
    verdict = (f"Recommend {rec['name']}. " + ("Resilient across every stress case tested." if not fails else
               (f"Resilient for the design outage; {len(fails)} stress case(s) need the mitigation below." if design_ok else
                "Not yet resilient for the design outage — apply the mitigation below before procurement.")))
    steps.append(_step("decide", "Decide and explain", "agent policy", "done", verdict, {"actions": actions}))
    return {"mode": "deterministic tool-using agent (audit trail; no LLM required)", "steps": steps, "verdict": verdict,
            "actions": actions, "ml": pred, "stress_tests": tests, "model_card": backup_classifier.model_card() if model else {"available": False}}
