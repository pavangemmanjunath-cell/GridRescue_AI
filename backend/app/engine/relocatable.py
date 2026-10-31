"""Relocatable hospital power — Global Energy Hackathon Brief 12, "Relocatable solar for a hospital on the move".

Takes the engine's recommended design as it is (no new physics) and answers what the brief asks for:
  * a critical-load list and a phased build that powers the surgical theatres first
  * a relocatable layout (ground-mounted solar, containerised storage) and a move plan for the new building
  * an ownership and financing model that keeps the kit off the hospital's federal asset register
  * a 5- and 10-year cost comparison of diesel, grid and solar
  * named funders and the case for each
  * the brief's five starter questions, answered with this site's numbers
  * the brief's success metrics, framed as the Three A's: Access, Affordability, Availability

Every number below is either the engine's output or a labelled planning assumption (ASSUMPTIONS), so a load audit
or the hospital's own fuel records can replace it. Works for any hospital, so other federal hospitals can reuse it.
"""
from __future__ import annotations

import math

from app.engine.investment import FINANCING, _annuity

# ── Planning assumptions (each is shown to the user; replace with audit data when available) ─────────────────────
# Split of the life-critical and essential loads for an orthopaedic / trauma hospital (shares of the engine's peaks).
CRITICAL_ITEMS = [
    ("theatres", "Surgical theatres", 0.30, "theatre lights, anaesthesia machines, diathermy, laminar-flow air"),
    ("icu", "Recovery, ICU and HDU", 0.20, "ventilators, patient monitors, infusion pumps"),
    ("imaging", "Theatre imaging (C-arm, X-ray)", 0.15, "image-guided fracture fixation"),
    ("burns", "Burns unit", 0.10, "patient warming, isolation air handling"),
    ("lab", "Laboratory and blood bank", 0.10, "analysers, blood and plasma fridges"),
    ("cssd", "Sterilisation (CSSD)", 0.10, "autoclaves that turn instruments round for the next list"),
    ("gases", "Medical gases, nurse call, IT", 0.05, "oxygen plant controls, alarms, patient records"),
]
ESSENTIAL_ITEMS = [
    ("wards", "Wards — lights, sockets, fans", 0.45, "night-time nursing care"),
    ("water", "Water pumping to the tanks", 0.20, "theatres and CSSD need water pressure"),
    ("cold", "Pharmacy and kitchen cold rooms", 0.15, "drugs, food"),
    ("security", "Security and outdoor lighting", 0.10, "safe access at night"),
    ("records", "Records and admin servers", 0.10, "billing, HR"),
]
NON_ESSENTIAL_LABEL = "Office air-conditioning, laundry, workshops, staff housing"

BESS_KWH_PER_CONTAINER = 2000      # one 20-ft LFP container (commercial scale)
PCS_KW_PER_SKID = 1000             # one inverter / power-conversion skid
MODULE_KW = 0.55                   # 550 W PV module
MODULES_PER_TRUCK = 600
PV_REINSTALL_USD_PER_KWP = 70      # take down row by row, pallet, re-rack, re-cable (local EPC labour)
CONTAINER_MOVE_USD = 4000          # crane + low-loader for one container within a city
TRUCK_USD_PER_KM = 3.0
RECOMMISSION_SHARE = 0.02          # protection settings, UPS transfer tests, acceptance — share of the investment
BREAKAGE_SHARE = 0.02              # modules damaged in handling — share of the PV cost
FIXED_CATEGORIES = ("EPC / civil works", "Grid connection", "Engineering / commissioning")   # stay behind / are spent
PV_FIXED_SHARE = 0.10              # trench cabling and ballast pads of the PV field stay behind
PV_LIFE_YEARS = 25
ESCO_MARGIN = 0.10
TERM_YEARS = 10

FUNDERS = [
    {"id": "rea", "name": "Rural Electrification Agency — National Public Sector Solarisation Initiative",
     "backed": "A 1.5 MW solar-hybrid mini-grid at the National Orthopaedic Hospital, Dala (Kano), the sister federal orthopaedic hospital.",
     "case": "A federal pathway already exists for a federal orthopaedic hospital. Ask for the hospital in the next phase, specified as ground-mounted and containerised so the asset follows the hospital to its new building.",
     "bring": ["Load audit and theatre schedule", "Federal ministry endorsement", "Site plans for today's campus and the new building"], "ref": 2},
    {"id": "eu_enugu", "name": "European Union and Enugu State — Solar for Health (₦4.3 B, 25 health facilities)", "state": "Enugu",
     "backed": "Solar microgrids at 25 Enugu health facilities, with local businesses and telecom towers as anchor customers.",
     "case": "The hospital is in Enugu. Surplus midday solar on weekends and between lists can be sold to neighbouring businesses or telecom towers, as the programme already does, which lowers the hospital's fee.",
     "bring": ["Anchor-customer list within 1 km", "Community-benefit statement", "State electricity-market (EERC) approval route"], "ref": 10},
    {"id": "state_health", "name": "The state's solar-for-health programme (template: EU + Enugu State, ₦4.3 B for 25 facilities)", "not_state": "Enugu",
     "backed": "State-run solar microgrids at health facilities, with local businesses and telecom towers as anchor customers to improve the economics.",
     "case": "Bring the Enugu template to the state ministry of health: the hospital as anchor, surplus midday solar sold to neighbours, and the system specified as relocatable.",
     "bring": ["Anchor-customer list within 1 km", "State ministry of health endorsement", "State electricity-market approval route"], "ref": 10},
    {"id": "dfi", "name": "Development-bank financing for renewable electrification of health facilities ($1.7 B committed)",
     "backed": "Renewable power for health and education facilities, mostly primary health centres.",
     "case": "A tertiary referral hospital as the anchor of a health cluster: the same contract model can then cover the primary health centres that refer patients to it.",
     "bring": ["Metered monthly output and uptime (remote monitoring)", "Bankable savings model", "O&M and spare-parts plan"], "ref": 7},
    {"id": "esco", "name": "Private energy service company (ESCO) with concessional debt",
     "backed": "Energy-as-a-service contracts with hospitals, schools and businesses, paid from the diesel budget they replace.",
     "case": "The fee is paid from the diesel line the hospital already funds. The ESCO owns the kit, so nothing enters the federal asset register, and the move in year five is written into the contract.",
     "bring": ["12 months of generator and fuel logs", "A 10-year service agreement with a relocation clause", "Hospital management's sign-off on the fee"], "ref": None},
]


# Movable storage units: the limit decides which loads can be added, in priority order (theatres first).
MOBILE_UNITS = [
    {"id": "trailer", "label": "Trailer battery", "kwh": 500, "kw": 250, "moves": "towed by road — can also carry the theatres through the move weekend"},
    {"id": "container", "label": "20-ft battery container", "kwh": 2000, "kw": 1000, "moves": "lifted by crane onto a low-loader"},
]
USABLE_SHARE = 0.90 * 0.95        # depth of discharge × inverter efficiency


def load_ladder(items: list[dict], units_kwh: float, units_kw: float, hours: float, load_factor: float) -> dict:
    """Add loads in priority order until the movable storage runs out of power (kW) or energy (kWh) for `hours`.
    Same rule as the frontend's ladder (frontend/src/case/ladder.ts)."""
    usable = units_kwh * USABLE_SHARE
    kw = kwh = 0.0
    out, limited_by = [], None
    for it in items:
        need_kwh = it["kw"] * load_factor * hours
        over_kw = kw + it["kw"] > units_kw + 1e-6
        over_kwh = kwh + need_kwh > usable + 1e-6
        fits = limited_by is None and not over_kw and not over_kwh
        if fits:
            kw += it["kw"]
            kwh += need_kwh
        elif limited_by is None:
            limited_by = "power" if over_kw else "energy"   # the first load that does not fit names the limit
        out.append({"id": it["id"], "name": it["name"], "kw": it["kw"], "kwh": round(need_kwh), "carried": fits})
    return {"ladder": out, "kw_used": round(kw), "kwh_used": round(kwh), "kw_limit": round(units_kw), "kwh_limit": round(usable),
            "carried": sum(1 for x in out if x["carried"]), "limited_by": limited_by}


def _cyclic_off_blocks(avail: list[int]) -> int:
    """Number of separate grid-off blocks in a 24-h cycle (each one is a drop and a restoration)."""
    if all(a == 0 for a in avail):
        return 0
    return sum(1 for h in range(24) if avail[h] == 0 and avail[h - 1] == 1)


def build_relocatable_case(rec: dict, load: dict, site: dict, fac: dict, investment: dict, agent: dict | None,
                           reloc: dict | None = None, new_site: dict | None = None, ranked: list[dict] | None = None, location_cc: str | None = None) -> dict:
    ranked = ranked or []
    reloc = {"move_year": 5, "horizon_years": 10, "theatre_suites": 4, "theatre_hours_per_day": 10, "theatre_days_per_week": 6,
             "reported_diesel_ngn_per_month": None, **(reloc or {})}
    name = fac.get("name") or "The hospital"
    cost, life, sim, comp = rec["cost"], rec["lifecycle"], rec["simulation_summary"], rec["components"]
    a = cost["assumptions"]
    fx, tariff, diesel_price = a["usd_to_ngn"], a["grid_tariff_usd_per_kwh"], a["diesel_price_usd_per_l"]
    supply_h = site["grid"]["supply_hours"]
    move_year, horizon = int(reloc["move_year"]), int(reloc["horizon_years"])
    capex = cost["capex_usd"]
    ngn_m = lambda usd: round(usd * fx / 1e6, 1)   # US$ → ₦ million

    # ── 1. Critical-load list ───────────────────────────────────────────────────────────────────────────────────
    crit_pk, ess_pk, prot_pk, peak = load["critical_peak_kw"], load["essential_peak_kw"], load["protected_peak_kw"], load["peak_load_kw"]
    non_pk = max(0.0, peak - prot_pk)
    items = [{"id": i, "name": n, "kw": round(crit_pk * s, 1), "class": "critical", "phase": 1, "never_off": True,
              "backed_by": "Online UPS (0 ms) + storage", "what": w} for i, n, s, w in CRITICAL_ITEMS]
    items += [{"id": i, "name": n, "kw": round(ess_pk * s, 1), "class": "essential", "phase": 2, "never_off": False,
               "backed_by": "Storage + solar ride-through", "what": w} for i, n, s, w in ESSENTIAL_ITEMS]
    items.append({"id": "comfort", "name": NON_ESSENTIAL_LABEL, "kw": round(non_pk, 1), "class": "non_essential", "phase": None,
                  "never_off": False, "backed_by": "Waits for the grid", "what": "shed automatically when the grid drops"})
    theatres_kw = items[0]["kw"]

    # ── 2. Relocatable design ───────────────────────────────────────────────────────────────────────────────────
    pv = comp.get("pv") or {}
    bat = comp.get("backup_device") or {}
    ups = comp.get("ups") or {}
    pv_kwp = float(pv.get("kwp", 0) or 0)
    modules = math.ceil(pv_kwp / MODULE_KW) if pv_kwp else 0
    bess_kwh = float(bat.get("energy_kwh", 0) or 0)
    n_bess = math.ceil(bess_kwh / BESS_KWH_PER_CONTAINER) if bess_kwh else 0
    n_skids = math.ceil(float(bat.get("power_kw", 0) or 0) / PCS_KW_PER_SKID) if bess_kwh else 0
    n_ups = 1 if ups else 0
    containers = n_bess + n_skids + n_ups
    land_m2 = round(pv.get("area_m2", 0) or 0)
    roof_kwp = float(pv.get("roof_kwp", 0) or 0)
    design_items = []
    if pv_kwp:
        design_items.append({"part": "Solar field", "spec": f"{modules:,} modules · {pv_kwp:,.0f} kWp on ballasted ground racks · {land_m2:,} m² of campus land",
                             "moves": "Unbolt row by row, stack on pallets, re-rack at the new site", "fixed_to_building": roof_kwp > 0})
    if bess_kwh:
        design_items.append({"part": "Battery storage", "spec": f"{n_bess} × 20-ft LFP container{'s' if n_bess > 1 else ''} · {bess_kwh:,.0f} kWh / {bat.get('power_kw', 0):,.0f} kW",
                             "moves": "Crane onto a low-loader, set down on new concrete pads", "fixed_to_building": False})
        design_items.append({"part": "Inverters", "spec": f"{n_skids} power-conversion skid{'s' if n_skids > 1 else ''} with plug-in connectors",
                             "moves": "Skid-mounted, unplug and lift", "fixed_to_building": False})
    if ups:
        design_items.append({"part": "Theatre UPS", "spec": f"{ups.get('kva')} kVA online double-conversion UPS in a containerised e-house",
                             "moves": "Moves with the battery containers", "fixed_to_building": False})
    design_items.append({"part": "Connection", "spec": "One changeover panel at the main switchboard — the only part fixed to today's building",
                         "moves": "A new panel is pre-wired in the new building; the old one stays as a spare", "fixed_to_building": True})
    design_items.append({"part": "Diesel generators", "spec": "Existing sets stay on standby until the new system proves itself",
                         "moves": "The hospital's own asset — moved or kept under its own rules", "fixed_to_building": False})

    by_cat = {b["category"]: b["usd"] for b in cost["breakdown"]}
    pv_cost = sum(v for k, v in by_cat.items() if k.startswith("Solar PV"))
    fixed_cost = sum(by_cat.get(c, 0) for c in FIXED_CATEGORIES) + pv_cost * PV_FIXED_SHARE
    movable_cost = max(0.0, capex - fixed_cost)
    dist_km = float(new_site["distance_km"]) if new_site else 10.0
    trucks = math.ceil(modules / MODULES_PER_TRUCK) + containers
    move_lines = [
        {"item": "Take down and re-rack the solar field", "usd": round(pv_kwp * PV_REINSTALL_USD_PER_KWP)},
        {"item": f"Crane and low-loader for {containers} container{'s' if containers != 1 else ''}", "usd": round(containers * CONTAINER_MOVE_USD)},
        {"item": f"Haulage · {trucks} truck trips × {dist_km:.0f} km and back", "usd": round(trucks * dist_km * 2 * TRUCK_USD_PER_KM)},
        {"item": "New pads, trenches and connection at the new building", "usd": round(sum(by_cat.get(c, 0) for c in FIXED_CATEGORIES[:2]) + pv_cost * PV_FIXED_SHARE)},
        {"item": "Re-commissioning and acceptance tests", "usd": round(capex * RECOMMISSION_SHARE)},
        {"item": "Module breakage allowance", "usd": round(pv_cost * BREAKAGE_SHARE)},
    ]
    move_cost = sum(l["usd"] for l in move_lines)
    reuse_pct = round(100 * (movable_cost - pv_cost * BREAKAGE_SHARE) / max(capex, 1))
    stranded_if_rooftop = round(pv_cost * (1 - move_year / PV_LIFE_YEARS))
    move_steps = [
        {"when": "6 months before", "what": "Survey the new plot; design ballast rows, container pads and the cable route; pre-wire a changeover panel in the new building."},
        {"when": "2 months before", "what": "Build the pads and ballast rows at the new site."},
        {"when": "Weeks 1–2", "what": "Move the solar field half at a time — the other half keeps producing at the old site."},
        {"when": "Move weekend", "what": "Lift the battery containers, inverter skids and UPS e-house onto low-loaders; the old site runs on grid and the existing diesel sets."},
        {"when": "Week 3", "what": "Re-commission at the new building: protection settings, UPS transfer tests, black-start test, acceptance with the hospital engineers."},
        {"when": "First theatre list", "what": "Theatres open in the new building on the re-commissioned system; diesel returns to standby."},
    ]

    # ── 3. Phased build — theatres first ───────────────────────────────────────────────────────────────────────
    ups_cost = sum(v for k, v in by_cat.items() if k.startswith("UPS"))
    gen_cost = sum(v for k, v in by_cat.items() if k.startswith("Generator"))
    rest = max(0.0, capex - ups_cost - gen_cost)
    f1 = min(1.0, crit_pk / max(prot_pk, 1e-6))
    phases = [
        {"id": 1, "name": "Phase 1 · Theatres first", "when": "Months 0–4", "protects_kw": round(crit_pk), "loads": "Theatres, recovery and ICU, burns, theatre imaging, lab, sterilisation",
         "capex_usd": round(ups_cost + gen_cost + rest * f1), "storage_kwh": round(bess_kwh * f1), "pv_kwp": round(pv_kwp * f1),
         "containers": max(1 if containers else 0, math.ceil(containers * f1)), "note": f"Online UPS on every critical circuit removes the switchover gap from day one; diesel stays as the last tier."},
        {"id": 2, "name": "Phase 2 · Whole protected bus", "when": "Months 5–10", "protects_kw": round(prot_pk - crit_pk), "loads": "Wards, water pumping, cold rooms, security lighting, records",
         "capex_usd": round(rest * (1 - f1)), "storage_kwh": round(bess_kwh * (1 - f1)), "pv_kwp": round(pv_kwp * (1 - f1)),
         "containers": max(0, containers - max(1 if containers else 0, math.ceil(containers * f1))), "note": "More containers and solar rows on the same pads and cable route."},
        {"id": 3, "name": f"Phase 3 · Move with the hospital (year {move_year})", "when": f"Year {move_year}", "protects_kw": round(prot_pk), "loads": "Everything above, at the new building",
         "capex_usd": round(move_cost), "storage_kwh": round(bess_kwh), "pv_kwp": round(pv_kwp), "containers": containers,
         "note": f"{reuse_pct} % of the investment is reused; nothing is left stranded on today's roofs."},
    ]

    # ── 4. Ownership and financing ─────────────────────────────────────────────────────────────────────────────
    fin = next(f for f in FINANCING if f["id"] == "concessional")
    om_y = cost["opex_usd_per_year"] + cost["replacement_usd_per_year"]
    fee_m = (_annuity(capex + move_cost, fin["rate"], TERM_YEARS) + om_y / 12) * (1 + ESCO_MARGIN)
    grid_sav_y = life["renewable_grid_savings_usd_per_year"]
    delivered_kwh_y = life["outage_kwh_per_year"] + (grid_sav_y / tariff if tariff else 0)
    fee_per_kwh = fee_m * 12 / max(delivered_kwh_y, 1)
    ownership = {
        "recommended": "eaas",
        "options": [
            {"id": "capex", "label": "Hospital buys the system", "owner": "The hospital — a federal asset", "upfront_ngn_m": ngn_m(capex),
             "fits_asset_rules": False, "upfront_capital": True, "who_maintains": "Hospital engineers",
             "verdict": "Not recommended: the hospital has little capital, and equipment tied to today's buildings becomes a federal asset it cannot simply move or dispose of."},
            {"id": "lease", "label": "Equipment lease", "owner": "Leasing company", "upfront_ngn_m": 0.0, "fits_asset_rules": True, "upfront_capital": False,
             "who_maintains": "Hospital engineers", "verdict": "Workable: no upfront capital, but the hospital still runs, insures and moves the system."},
            {"id": "eaas", "label": "Energy-as-a-service (recommended)", "owner": "Energy service company (ESCO)", "upfront_ngn_m": 0.0, "fits_asset_rules": True, "upfront_capital": False,
             "who_maintains": "ESCO, with two hospital electricians trained on site",
             "verdict": "Best fit: no upfront capital, the kit never enters the federal asset register, and the ESCO maintains it and moves it under the contract."},
        ],
        "fee_ngn_m_per_month": ngn_m(fee_m), "fee_usd_per_month": round(fee_m), "fee_ngn_per_kwh": round(fee_per_kwh * fx),
        "diesel_ngn_per_kwh": round(life["baseline_diesel_usd_per_kwh"] * fx), "grid_ngn_per_kwh": round(tariff * fx),
        "financing": f"{fin['label']} at {fin['rate'] * 100:.0f} % over {TERM_YEARS} years, plus O&M and a {ESCO_MARGIN * 100:.0f} % ESCO margin",
        "contract_terms": [
            f"{TERM_YEARS}-year energy-as-a-service agreement, paid monthly from the diesel budget line",
            "The ESCO owns, insures, maintains and remotely monitors the system",
            f"Relocation clause: the ESCO moves and re-commissions the system once, in year {move_year}; the cost is already inside the fee",
            "Performance guarantee: theatre power available ≥ 99.9 % of the time, or the fee is reduced",
            "At the end of the term, the hospital can take the system over for a nominal sum or renew",
        ],
    }

    # ── 5. Cost over 5 and 10 years: diesel, grid, solar ───────────────────────────────────────────────────────
    grid_part_y = load["protected_daily_kwh"] * supply_h / 24 * 365 * tariff
    diesel_y = grid_part_y + life["baseline_diesel_usd_per_year"]
    grid_ref_y = load["protected_daily_kwh"] * 365 * tariff
    solar_y = fee_m * 12 + max(0.0, grid_part_y - grid_sav_y) + life["storage_grid_charging_usd_per_year"] + life["system_fuel_usd_per_year"]
    reported_m = reloc.get("reported_diesel_ngn_per_month")
    reported_y = (reported_m * 12 / fx + grid_part_y) if reported_m else None
    series = [{"year": y, "diesel": round(diesel_y * y), "grid": round(grid_ref_y * y), "solar": round(solar_y * y),
               **({"reported": round(reported_y * y)} if reported_y else {})} for y in range(horizon + 1)]
    at = lambda y: {"year": y, "diesel_ngn_m": ngn_m(diesel_y * y), "grid_ngn_m": ngn_m(grid_ref_y * y), "solar_ngn_m": ngn_m(solar_y * y),
                    "saving_vs_diesel_ngn_m": ngn_m((diesel_y - solar_y) * y), **({"reported_ngn_m": ngn_m(reported_y * y)} if reported_y else {})}
    do_nothing = investment["do_nothing"]
    inv = investment["investment"]
    frac = inv["diesel_avoided_l_per_year"] / max(do_nothing["diesel_litres_per_year"], 1)
    diesel_saving_y = life["baseline_diesel_usd_per_year"] - life["system_fuel_usd_per_year"]
    payback_diesel = (capex + move_cost) / (diesel_saving_y - om_y) if diesel_saving_y > om_y else None
    # today's diesel bill above which the switch saves money from month one: where the "today" and "solar" lines cross
    # (the solar path already carries the fee, the remaining diesel and the remaining grid purchases)
    breakeven_m = max(0.0, solar_y - grid_part_y) / 12
    payback_reported = None
    if reported_m:
        sav = reported_m / fx * 12 * frac - om_y
        payback_reported = round((capex + move_cost) / sav, 1) if sav > 0 else None
    cost_model = {
        "series": series, "at_5": at(5), "at_10": at(min(10, horizon)),
        "lines": [
            {"key": "diesel", "label": f"Today: grid {supply_h:g} h a day + diesel for the rest"},
            {"key": "grid", "label": "Grid only at the EERC tariff (if it supplied 24 h — not available today)"},
            {"key": "solar", "label": "Solar + storage as a service + remaining grid"},
            *([{"key": "reported", "label": "Today, from the hospital's reported diesel bill"}] if reported_y else []),
        ],
        "basis": f"Protected load ({load['protected_daily_kwh']:,.0f} kWh a day). Diesel ₦{diesel_price * fx:,.0f}/L, grid ₦{tariff * fx:,.0f}/kWh, ₦{fx:,.0f}/US$. The service fee includes the year-{move_year} move.",
        "diesel_ngn_m_per_month": ngn_m(life["baseline_diesel_usd_per_year"] / 12), "diesel_share_avoided_pct": round(100 * frac),
        "payback_diesel_savings_years": round(payback_diesel, 1) if payback_diesel else None, "payback_reported_years": payback_reported,
        "breakeven_diesel_ngn_m_per_month": ngn_m(breakeven_m), "peer_reported_diesel_ngn_m_per_month": 47.0,
    }

    # ── 6. Impact metrics (the brief's success metrics) ────────────────────────────────────────────────────────
    hourly = rec.get("simulation_hourly") or []
    avail = [int(r["grid_available"]) for r in hourly] if len(hourly) == 24 else [1 if h < supply_h else 0 for h in range(24)]
    t_start, t_hours = 8, int(round(reloc["theatre_hours_per_day"]))
    window = [(t_start + i) % 24 for i in range(min(24, t_hours))]
    off_frac = sum(1 for h in window if avail[h] == 0) / max(len(window), 1)
    theatre_hours_y = reloc["theatre_suites"] * reloc["theatre_hours_per_day"] * reloc["theatre_days_per_week"] * 52
    drops_day = _cyclic_off_blocks(avail)
    switchovers_y = drops_day * 2 * 365
    crit_served = sim.get("critical_served_pct", 0)
    tests = (agent or {}).get("stress_tests") or []
    passed = sum(1 for t in tests if t.get("status") == "pass")
    impact = {
        "theatre_hours_per_year": round(theatre_hours_y), "theatre_hours_uninterrupted": round(theatre_hours_y * crit_served / 100),
        "theatre_hours_on_diesel_today": round(theatre_hours_y * off_frac), "theatre_share_without_grid_pct": round(100 * off_frac),
        "switchovers_per_year_today": switchovers_y, "switchovers_per_year_with_system": 0 if ups else switchovers_y,
        "diesel_litres_avoided_per_year": inv["diesel_avoided_l_per_year"], "diesel_litres_avoided_10y": inv["diesel_avoided_l_per_year"] * 10,
        "co2_avoided_t_per_year": inv["co2_avoided_t_per_year"], "reuse_pct": reuse_pct, "stress_tests_passed": f"{passed}/{len(tests)}" if tests else None,
    }
    metrics = [
        {"id": "impact", "weight": 25, "title": "Impact", "brief": "Theatre hours with uninterrupted power, diesel litres avoided, equipment failures reduced",
         "ours": [f"{impact['theatre_hours_on_diesel_today']:,} theatre-hours a year ({impact['theatre_share_without_grid_pct']} %) fall when the grid is off today → 0 on the system ({reloc['theatre_suites']} suites, schedule editable)",
                  f"{inv['diesel_avoided_l_per_year']:,} L of diesel avoided a year",
                  f"About {switchovers_y:,} switchovers a year (modelled: the grid drops and returns {drops_day} times a day) no longer reach theatre and ICU equipment" if ups else "Switchovers still reach equipment — add a UPS"]},
        {"id": "innovation", "weight": 25, "title": "Innovation", "brief": "Relocatable design and ownership model that survives the hospital's move",
         "ours": [f"Nothing fixed to today's buildings: ground racks + {containers} containers", f"Energy-as-a-service with a relocation clause in year {move_year}",
                  "An advisor that sizes, simulates hour by hour, stress-tests and prices the design for any hospital in seconds"]},
        {"id": "sustainability", "weight": 25, "title": "Sustainability", "brief": "System reused at the new building, diesel and emissions cut over 10+ years, maintainable by local staff",
         "ours": [f"{reuse_pct} % of the investment reused at the new building", f"{inv['co2_avoided_t_per_year']:,} t CO₂ avoided a year",
                  "ESCO maintenance with two hospital electricians trained on site"]},
        {"id": "feasibility", "weight": 15, "title": "Feasibility", "brief": "Sized against real load and grid data; switchover safe for surgery",
         "ours": [f"Grid at {supply_h:g} h a day (hospital's head engineer); sun from NASA POWER, PVGIS and NLR PVWatts",
                  f"Online UPS: 0 ms switchover for {crit_pk:,.0f} kW of theatre and ICU load", f"{impact['stress_tests_passed'] or '—'} outage stress tests passed"]},
        {"id": "scalability", "weight": 10, "title": "Scalability", "brief": "Model reusable by other federal hospitals facing the same tariffs and diesel costs",
         "ours": ["Same five inputs for any hospital: location, beds, grid hours, diesel price, land",
                  "Sister hospital already on the federal pathway: National Orthopaedic Hospital, Dala (Kano)"]},
    ]

    three_as = {
        "access": {"headline": f"Theatres first — {crit_pk:,.0f} kW never loses power",
                   "facts": [f"{theatres_kw:,.0f} kW of surgical theatres on the first phase", f"{impact['theatre_hours_uninterrupted']:,} theatre-hours a year on clean power",
                             f"Today {impact['theatre_share_without_grid_pct']} % of theatre time has no grid"]},
        "affordability": {"headline": f"No upfront capital — ₦{ownership['fee_ngn_m_per_month']:,.1f} M a month instead of ₦{cost_model['diesel_ngn_m_per_month']:,.1f} M of diesel",
                          "facts": [f"Saves ₦{cost_model['at_10']['saving_vs_diesel_ngn_m']:,.0f} M over {min(10, horizon)} years", f"Solar + storage at ₦{ownership['fee_ngn_per_kwh']:,}/kWh vs diesel at ₦{ownership['diesel_ngn_per_kwh']:,}/kWh",
                                    f"Saves money from month one whenever diesel costs more than ₦{cost_model['breakeven_diesel_ngn_m_per_month']:,.1f} M a month"]},
        "availability": {"headline": "0 ms switchover, and the power moves with the hospital",
                         "facts": [f"{bess_kwh:,.0f} kWh of storage carries the protected load through the night" if bess_kwh else "Grid-charged backup",
                                   f"{impact['stress_tests_passed'] or '—'} outage stress tests passed", f"{reuse_pct} % reused at the new building in year {move_year}"]},
    }

    state = (site["grid"].get("state") or "").strip()
    funders = [f for f in FUNDERS if f.get("state", state) == state and f.get("not_state") != state]
    state_prog = ("the EU and Enugu State's ₦4.3 B Solar for Health programme (25 facilities, with local businesses and telecom towers as anchor customers)" if state == "Enugu"
                  else f"the state's solar-for-health programme — {state or 'the state'} can copy the EU and Enugu State template (₦4.3 B, 25 facilities, anchor customers)")

    # ── 7. The brief's five starter questions, answered ────────────────────────────────────────────────────────
    dist_txt = f", {new_site['distance_km']:.0f} km away" if new_site else ""
    peer = cost_model["peer_reported_diesel_ngn_m_per_month"]
    answers = [
        {"id": "q1", "question": "Which loads must never lose power, and which can wait for the grid?",
         "answer": (f"Never off: {crit_pk:,.0f} kW — surgical theatres ({theatres_kw:,.0f} kW), recovery and ICU, theatre imaging, burns, lab and blood bank, sterilisation — "
                    f"on a {ups.get('kva', '—')} kVA online UPS that switches in 0 ms, backed by storage. Ride-through: {ess_pk:,.0f} kW of wards, water pumping and cold rooms on storage and solar. "
                    f"Can wait for the grid: {non_pk:,.0f} kW of office air-conditioning, laundry and workshops. The grid is off about {24 - supply_h:g} h a day here, "
                    f"so storage is sized for {bat.get('autonomy_h', 0):g} h of the protected load."),
         "facts": [{"label": "Never off", "value": f"{crit_pk:,.0f} kW"}, {"label": "Ride-through", "value": f"{ess_pk:,.0f} kW"}, {"label": "Waits for grid", "value": f"{non_pk:,.0f} kW"},
                   {"label": "Storage", "value": f"{bess_kwh:,.0f} kWh"}], "tab": "loads"},
        {"id": "q2", "question": "How do you build a system that can move to a new building in five years?",
         "answer": (f"Nothing is fixed to today's buildings. {pv_kwp:,.0f} kWp of solar sits on ballasted ground racks ({land_m2:,} m² of campus land), the storage is in {n_bess} × 20-ft containers "
                    f"and the inverters and UPS are on plug-in skids, joined to the hospital at one changeover panel. In year {move_year} it moves in about three weeks{dist_txt}, "
                    f"for ₦{ngn_m(move_cost):,.0f} M ({100 * move_cost / max(capex, 1):.0f} % of the investment), and {reuse_pct} % of the investment is reused at the new building."),
         "facts": [{"label": "Containers", "value": str(containers)}, {"label": "Move cost", "value": f"₦{ngn_m(move_cost):,.0f} M"}, {"label": "Reused", "value": f"{reuse_pct} %"},
                   {"label": "Rooftop would strand", "value": f"₦{ngn_m(stranded_if_rooftop):,.0f} M"}], "tab": "move"},
        {"id": "q3", "question": "Who should own the system so the hospital avoids asset-disposal problems?",
         "answer": (f"An energy service company (ESCO) owns, insures, maintains and moves it under a {TERM_YEARS}-year energy-as-a-service contract. The hospital buys power, not equipment, "
                    f"so nothing enters its federal asset register and nothing has to be disposed of when it moves. It pays ₦{ownership['fee_ngn_m_per_month']:,.1f} M a month "
                    f"(₦{ownership['fee_ngn_per_kwh']:,}/kWh) and can take the system over for a nominal sum at the end of the term."),
         "facts": [{"label": "Owner", "value": "ESCO"}, {"label": "Upfront", "value": "₦0"}, {"label": "Fee", "value": f"₦{ownership['fee_ngn_m_per_month']:,.1f} M/month"},
                   {"label": "Term", "value": f"{TERM_YEARS} years"}], "tab": "money"},
        {"id": "q4", "question": "Can diesel savings alone repay the system, and over how long?",
         "answer": (f"Yes. At ₦{diesel_price * fx:,.0f}/L, running the protected load on diesel whenever the grid is off costs about ₦{cost_model['diesel_ngn_m_per_month']:,.1f} M a month. "
                    f"The system avoids {cost_model['diesel_share_avoided_pct']} % of those litres, so diesel savings alone repay the investment and the move in "
                    f"{cost_model['payback_diesel_savings_years'] if cost_model['payback_diesel_savings_years'] else 'more than 15'} years. "
                    f"Under energy-as-a-service — fee, remaining diesel and grid included — the switch saves money from the first month whenever today's diesel bill "
                    f"is above ₦{cost_model['breakeven_diesel_ngn_m_per_month']:,.1f} M a month. A lower bill means the theatres are not really being carried through "
                    f"outages today (a peer federal teaching hospital reported ₦{peer:,.0f} M a month on diesel, before the latest price rise)."
                    + (f" From this hospital's reported bill, the payback is {payback_reported} years." if payback_reported else "")),
         "facts": [{"label": "Payback", "value": f"{cost_model['payback_diesel_savings_years'] or '> 15'} yr"}, {"label": "Break-even bill", "value": f"₦{cost_model['breakeven_diesel_ngn_m_per_month']:,.1f} M/month"},
                   {"label": "10-yr saving", "value": f"₦{cost_model['at_10']['saving_vs_diesel_ngn_m']:,.0f} M"}, {"label": "Diesel avoided", "value": f"{cost_model['diesel_share_avoided_pct']} %"}], "tab": "money"},
        {"id": "q5", "question": "Which funders have backed similar projects, and what do they require?",
         "answer": (f"The federal Rural Electrification Agency's public-sector solarisation programme (1.5 MW at the National Orthopaedic Hospital, Dala, Kano); {state_prog}; "
                    "development-bank financing for health-facility electrification ($1.7 B committed); and energy service companies with concessional debt. Each will want the same pack: "
                    "a load audit, 12 months of generator and fuel logs, site plans for both buildings, and an O&M plan with remote monitoring."),
         "facts": [{"label": "Federal", "value": "REA solarisation"}, {"label": "State + EU", "value": "Solar for Health"}, {"label": "Banks", "value": "$1.7 B"},
                   {"label": "Private", "value": "ESCO"}], "tab": "money"},
    ]

    # ── 8. Movable storage: how many units, and which loads they can carry ─────────────────────────────────────
    load_factor = round(load["avg_load_kw"] / max(load["peak_load_kw"], 1), 3)
    ride_h = float(bat.get("autonomy_h") or fac["backup_hours"])
    cont = MOBILE_UNITS[1]
    ladder_default = load_ladder(items, n_bess * cont["kwh"], n_bess * cont["kw"], ride_h, load_factor) if n_bess else None
    trailer = MOBILE_UNITS[0]
    move_hours = 24   # one shift at a time over the move weekend, recharged from the grid or diesel in between
    theatre_kwh = theatres_kw * load_factor * move_hours / USABLE_SHARE
    trailers_for_move = max(1, math.ceil(max(theatre_kwh / trailer["kwh"], theatres_kw / trailer["kw"])))
    mobile_storage = {
        "units": MOBILE_UNITS, "usable_share": USABLE_SHARE, "load_factor": load_factor, "default_unit": "container", "default_count": n_bess,
        "default_hours": ride_h, "default_ladder": ladder_default,
        "move_bridge": {"trailers": trailers_for_move, "hours": move_hours, "theatres_kw": theatres_kw,
                        "text": f"{trailers_for_move} trailer batter{'ies' if trailers_for_move > 1 else 'y'} keep the {theatres_kw:,.0f} kW of theatres on silent power "
                                f"for {move_hours} h at a time during the move weekend, recharged from the grid or diesel between shifts."},
    }

    # ── 9. Energy type: the ML classifier's pick, every family's cost difference, why a UPS stays ───────────────
    from app.ml.backup_classifier import FAMILY_LABEL, family_of
    ml_step = next((st for st in (agent or {}).get("steps", []) if st.get("id") == "classify"), None)
    ml_pred = (ml_step or {}).get("detail", {}).get("prediction") or {}
    # the plan itself is the first row (it may be the rule-built stack, which is not one of the ranked options); the other rows
    # are the alternatives by family, and families that are not viable at this site are counted, not listed
    def _row(r, label, is_plan):
        famly = family_of(r["parts"])
        return {"family": famly, "label": label, "option": r["short"], "rank": r.get("rank"), "score": r["score"],
                "capex_ngn_m": ngn_m(r["cost"]["capex_usd"]), "net_10y_ngn_m": ngn_m(r["cost"]["capex_usd"] + (r["lifecycle"]["system_opex_usd_per_year"] - r["lifecycle"]["renewable_grid_savings_usd_per_year"]) * 10),
                "capex_diff_ngn_m": 0 if is_plan else ngn_m(r["cost"]["capex_usd"] - capex), "critical_served_pct": r["simulation_summary"]["critical_served_pct"],
                "has_ups": "ups" in r["parts"], "recommended": is_plan, "ml_pick": bool(ml_pred) and ml_pred.get("family") == famly}
    rec_id = rec["id"] if any(r["id"] == rec["id"] for r in ranked) else (ranked[0]["id"] if ranked else None)   # the stack is built from the top option
    energy_types = [_row(rec, f"The plan — {rec['name']}", True)]
    seen, not_viable = {rec["id"]}, 0
    for r in ranked:
        if r["id"] in seen or family_of(r["parts"]) == "pumped_hydro":
            continue
        seen.add(r["id"])
        if r.get("suitability") == "Not suitable":
            not_viable += 1
            continue
        energy_types.append(_row(r, r["name"], False))
    energy_type = {"ml": {"family": ml_pred.get("family"), "label": ml_pred.get("family_label"), "confidence": ml_pred.get("confidence"),
                          "agrees": bool(ml_pred) and ml_pred.get("family") == family_of(rec["parts"])} if ml_pred else None,
                   "options": energy_types, "not_viable": not_viable,
                   "why_ups": (f"Yes, still a UPS. A battery inverter takes 10–20 ms to take over the bus and a generator 10–30 s; theatre and ICU equipment "
                               f"resets at anything above a few milliseconds. The online UPS is small ({ups.get('kva', '—')} kVA, 15 min) and sits only on the "
                               f"{crit_pk:,.0f} kW of critical circuits — the batteries and solar carry everything else.")}

    # ── 9b. Adaptable: if part of the plan can't be used, step down to what the engine already simulated ────────
    by_id = {r["id"]: r for r in ranked}
    def _rung(when, then, r):
        if not r:
            return None
        s = r["simulation_summary"]
        return {"if": when, "then": then, "option": r["short"], "capex_ngn_m": ngn_m(r["cost"]["capex_usd"]),
                "critical_served_pct": s["critical_served_pct"], "fuel_l_day": round(s.get("fuel_l") or 0),
                "renewable_pct": round(s.get("renewable_share_pct") or 0), "note": (r.get("notes") or [None])[0]}
    rec_r = by_id.get(rec_id) or rec
    adapt = {"rungs": [x for x in (
        _rung("Everything fits", "Solar + storage + UPS at one changeover panel, diesel as the last tier", rec_r),
        _rung("No land or roof for solar", "The grid charges the storage whenever the feeder is live; the UPS holds the theatres", by_id.get("li_ion_backup")),
        _rung("No storage possible yet (budget, space or rules)", "Grid-first: UPS on the theatre and ICU circuits for 0 ms, the existing generator for the outage hours", by_id.get("ups_only")),
    ) if x],
             "grid_first": [
                 "Pick the new plot on the grid lens: nearest substations and the strongest feeder first",
                 "Ask the distribution company for a dedicated hospital feeder; every extra grid hour shrinks the storage needed — re-run the plan with the new hours",
                 "Containers are added later as money allows: they plug into the same changeover panel, nothing is rebuilt"],
             "text": "The plan adapts: if a part can't be used, it steps down to what still keeps the theatres on, using the same site scan."}

    # ── 10. No sun: night charging at the cheaper tariff, used in the early morning ─────────────────────────────
    night = [h for h in range(24) if h >= 22 or h < 6]
    morning = [5, 6, 7, 8]
    night_kwh = sum(r["backup_charge_kw"] for r in hourly if r["hour"] in night and r["grid_available"]) if len(hourly) == 24 else 0.0
    morning_kwh = sum(r["backup_discharge_kw"] for r in hourly if r["hour"] in morning) if len(hourly) == 24 else 0.0
    # the night price comes from the published tariff table — in Nigeria there is no night discount, and the text says so
    from app.services.tariffs import price_at
    cc = (location_cc or "NG").upper()
    t_day = price_at(cc, site["grid"].get("state"), 12) or {}
    t_night = price_at(cc, site["grid"].get("state"), 2) or {}
    tests = (agent or {}).get("stress_tests") or []
    worst = next((t for t in tests if "solar" in t["scenario"].lower()), None)
    night_cheaper = bool(t_day.get("tou")) and t_night.get("period") == "off-peak"
    cost_flat = night_kwh * tariff * fx
    no_sun = {"night_charge_kwh": round(night_kwh), "morning_use_kwh": round(morning_kwh), "night_hours": "22:00–06:00", "morning_hours": "05:00–09:00",
              "cost_ngn": round(cost_flat), "night_cheaper": night_cheaper, "tariff_label": t_day.get("label"), "tariff_source": t_day.get("source"),
              "night_note": t_day.get("night_note"), "grid_hours": supply_h, "worst_solar_month": worst,
              "text": (f"When the sun is poor the batteries charge from the grid overnight ({night_kwh:,.0f} kWh between 22:00 and 06:00 whenever the feeder is live) "
                       f"and carry the first theatre list ({morning_kwh:,.0f} kWh between 05:00 and 09:00). That night energy costs ₦{cost_flat:,.0f} at the "
                       f"{t_day.get('label') or 'local'} tariff. {t_day.get('night_note') or ''} "
                       + (f"In the cloudiest month the design still serves {worst['critical_served_pct']} % of the critical load" + (" with the generator as the last tier." if comp.get("generator") else ".") if worst else ""))}

    # ── 11. ESG: what the report can state, from the engine's numbers only ─────────────────────────────────────
    co2_y = inv["co2_avoided_t_per_year"]
    esg = {"co2_t_per_year": co2_y, "co2_t_10y": round(co2_y * 10), "diesel_l_per_year": inv["diesel_avoided_l_per_year"],
           "renewable_share_pct": sim.get("renewable_share_pct", 0), "critical_served_pct": sim.get("critical_served_pct", 0),
           "factors": "2.68 kg CO₂ per litre of diesel (IPCC default) and the national grid factor for electricity displaced by solar",
           "credits_note": "Avoided emissions become carbon credits only after a registered methodology, third-party verification and issuance; the tonnes here are the engine's estimate, not issued credits. Enter your buyer's price to value them.",
           "report_lines": [f"Environment: {co2_y:,.0f} t CO₂ avoided a year, {inv['diesel_avoided_l_per_year']:,.0f} L of diesel not burnt, {sim.get('renewable_share_pct', 0):.0f} % of the hospital's energy from solar on the design day",
                            f"Social: {crit_pk:,.0f} kW of theatres, ICU and burns on uninterrupted power; {impact['theatre_hours_uninterrupted']:,} theatre-hours a year",
                            f"Governance: no asset on the federal register; energy-as-a-service contract with metered output, uptime guarantee and a relocation clause; open-data sizing anyone can re-run"]}

    two_sites = None
    if new_site:
        today = {"psh": site["solar"]["annual_psh"], "grid_class": site["grid"]["class"], "grid_label": site["grid"]["label"], "supply_hours": supply_h}
        two_sites = {"today": today, "new": new_site, "distance_km": new_site["distance_km"],
                     "solar_change_pct": round(100 * (new_site["psh"] / max(today["psh"], 0.1) - 1), 1)}

    return {
        "brief": {"number": 12, "track": "Clean Energy Solutions", "title": "Relocatable solar for a hospital on the move"},
        "facility": name, "starter_answers": answers, "critical_loads": items, "phases": phases,
        "relocatable_design": {"items": design_items, "containers": containers, "bess_containers": n_bess, "power_skids": n_skids, "ups_ehouse": n_ups,
                               "modules": modules, "land_m2": land_m2, "pv_kwp": pv_kwp, "storage_kwh": bess_kwh, "roof_kwp": roof_kwp},
        "move_plan": {"year": move_year, "distance_km": round(dist_km, 1), "steps": move_steps, "cost_lines": move_lines, "cost_usd": round(move_cost),
                      "cost_ngn_m": ngn_m(move_cost), "cost_pct": round(100 * move_cost / max(capex, 1), 1), "reuse_pct": reuse_pct,
                      "stranded_if_rooftop_ngn_m": ngn_m(stranded_if_rooftop), "duration": "about 3 weeks; theatres stay on UPS and diesel throughout"},
        "ownership": ownership, "cost_model": cost_model, "funders": funders, "impact": impact, "metrics": metrics, "three_as": three_as,
        "two_sites": two_sites, "mobile_storage": mobile_storage, "energy_type": energy_type, "adapt": adapt, "no_sun": no_sun, "esg": esg,
        "assumptions": [
            {"label": "Load split", "value": "Theatres 30 % of critical load, ICU 20 %, imaging 15 % …", "note": "planning split for an orthopaedic hospital — replace with the load audit"},
            {"label": "Theatres", "value": f"{reloc['theatre_suites']} suites × {reloc['theatre_hours_per_day']:g} h × {reloc['theatre_days_per_week']} days", "note": "replace with the theatre schedule"},
            {"label": "Containers", "value": f"{BESS_KWH_PER_CONTAINER:,} kWh per 20-ft battery container, {PCS_KW_PER_SKID:,} kW per inverter skid", "note": "commercial-scale LFP"},
            {"label": "Moving", "value": f"US$ {PV_REINSTALL_USD_PER_KWP}/kWp to re-rack solar, US$ {CONTAINER_MOVE_USD:,} per container lift, {RECOMMISSION_SHARE * 100:.0f} % re-commissioning", "note": "local EPC rates — get two quotes"},
            {"label": "ESCO fee", "value": f"{fin['rate'] * 100:.0f} % over {TERM_YEARS} years + O&M + {ESCO_MARGIN * 100:.0f} % margin", "note": "editable; concessional debt assumed"},
        ],
    }
