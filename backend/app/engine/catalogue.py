"""Technology knowledge layer + public cost library.

All figures are pre-feasibility class estimates (±30 %) assembled from public sources:
  * NREL Annual Technology Baseline 2024 (commercial & utility-scale storage, PV)
  * Lazard Levelized Cost of Storage v9.0 (2024) and LCOE+ (2024)
  * IRENA Renewable Power Generation Costs 2023; IRENA Electricity Storage Valuation Framework
  * IRENA Renewable Power Generation Costs in 2025 (PV US$667/kW; 4-h utility-scale storage ≈ US$140/kWh)
  * BloombergNEF lithium-ion price survey 2025 (average pack US$108/kWh; stationary US$70/kWh; LFP US$81/kWh)
  * IEA Africa Energy Outlook 2022; World Bank Nigeria Electrification Project reports
  * NERC Multi-Year Tariff Order 2024 (Band A ₦209.50/kWh); NBS Diesel Price Watch 2026
Nigeria import, logistics and EPC premiums (+15–25 %) are included in the installed costs.
"""
from __future__ import annotations

# ─── Storage & generation technologies (knowledge layer, shown on the Learn page) ─────────
TECHNOLOGIES: dict[str, dict] = {
    "ups": {
        "name": "UPS (online double-conversion)", "category": "Immediate response", "group": "core",
        "duration_h": [0.1, 0.5], "response": "0 ms (no-break)", "rte": 0.94, "life_years": 8, "cycle_life": 500,
        "capex_usd_per_kw": 260, "capex_usd_per_kwh": 900, "opex_pct": 3.0, "trl": 9, "complexity": 1,
        "footprint": "indoor electrical room", "site_needs": "none",
        "nigeria_note": "Mandatory for ICU, theatres, imaging, labs, servers — bridges the 5–30 s generator/backup device transfer gap.",
        "evaluated": True,
    },
    "li_ion": {
        "name": "Li-ion backup device (LFP)", "category": "Short–medium duration", "group": "core",
        "duration_h": [1, 8], "response": "< 20 ms", "rte": 0.90, "life_years": 12, "cycle_life": 5000,
        "capex_usd_per_kw": 150, "capex_usd_per_kwh": 240, "opex_pct": 2.0, "trl": 9, "complexity": 2,
        "footprint": "≈ 0.05 m²/kWh (containerised or cabinet)", "site_needs": "shaded/ventilated pad, fire clearance",
        "nigeria_note": "Fastest to deploy, pairs naturally with solar; needs HVAC in >30 °C climates (LFP preferred over NMC).",
        "evaluated": True,
    },
    "flow": {
        "name": "Flow backup device (vanadium redox)", "category": "Medium–long duration", "group": "ldes",
        "duration_h": [4, 12], "response": "< 1 s", "rte": 0.72, "life_years": 20, "cycle_life": 15000,
        "capex_usd_per_kw": 600, "capex_usd_per_kwh": 350, "opex_pct": 1.5, "trl": 8, "complexity": 3,
        "footprint": "≈ 0.12 m²/kWh (tanks + stacks)", "site_needs": "ground pad, water for cooling, trained O&M",
        "nigeria_note": "Best when the backup device cycles fully every day for 6–12 h (chronic Class D/E grid); no thermal runaway.",
        "evaluated": True,
    },
    "hydrogen": {
        "name": "Hydrogen storage (electrolyser + H₂ tank + fuel cell)", "category": "Long duration / seasonal", "group": "ldes",
        "duration_h": [24, 720], "response": "seconds–minutes (fuel cell)", "rte": 0.35, "life_years": 15, "cycle_life": 20000,
        "capex_usd_per_kw": 3200, "capex_usd_per_kwh": 25, "opex_pct": 3.5, "trl": 7, "complexity": 5,
        "footprint": "large: electrolyser hall, compressed storage, safety zones", "site_needs": "treated water (≈ 10 L/kg H₂), safety distances, skilled O&M",
        "nigeria_note": "Future-fit for multi-day autonomy or fleets; today too costly and complex for a single hospital.",
        "evaluated": True,
    },
    "pumped_hydro": {
        "name": "Pumped hydropower (incl. river-linked / off-river)", "category": "Long duration, utility scale", "group": "ldes",
        "duration_h": [6, 24], "response": "30–90 s", "rte": 0.78, "life_years": 60, "cycle_life": 30000,
        "capex_usd_per_kw": 2000, "capex_usd_per_kwh": 100, "opex_pct": 1.0, "trl": 9, "complexity": 5,
        "footprint": "two reservoirs, > 50 m head, km-scale civil works", "site_needs": "topography, water, land rights, > 5 MW to be economic",
        "nigeria_note": "A regional/utility concept (e.g. Jos Plateau, Mambilla, Kainji region) — not a single-hospital solution.",
        "evaluated": True,
    },
    "caes": {
        "name": "Compressed-air storage (diabatic CAES)", "category": "Long duration, utility scale", "group": "ldes",
        "duration_h": [4, 24], "response": "minutes", "rte": 0.50, "life_years": 30, "cycle_life": 10000,
        "capex_usd_per_kw": 1500, "capex_usd_per_kwh": 120, "opex_pct": 2.0, "trl": 8, "complexity": 5,
        "footprint": "salt cavern or large pressure vessels", "site_needs": "geology (caverns) + gas for reheating",
        "nigeria_note": "No suitable salt caverns near most Nigerian load centres; gas-fired reheating reduces the climate benefit.",
        "evaluated": False,
    },
    "aa_caes": {
        "name": "Advanced adiabatic CAES", "category": "Long duration, utility scale", "group": "ldes",
        "duration_h": [4, 24], "response": "minutes", "rte": 0.65, "life_years": 30, "cycle_life": 10000,
        "capex_usd_per_kw": 1800, "capex_usd_per_kwh": 150, "opex_pct": 2.0, "trl": 6, "complexity": 5,
        "footprint": "pressure vessels + thermal store", "site_needs": "industrial site, demonstration-stage technology",
        "nigeria_note": "Demonstration stage (TRL 6) — watch-list only.",
        "evaluated": False,
    },
    "thermal": {
        "name": "Thermal storage (molten salt / hot rock / ice)", "category": "Medium–long duration", "group": "ldes",
        "duration_h": [4, 24], "response": "minutes", "rte": 0.45, "life_years": 25, "cycle_life": 10000,
        "capex_usd_per_kw": 1200, "capex_usd_per_kwh": 60, "opex_pct": 2.0, "trl": 7, "complexity": 4,
        "footprint": "insulated tanks", "site_needs": "heat demand or CSP; ice storage suits hospital chillers",
        "nigeria_note": "Ice/chilled-water storage can shift hospital cooling loads and shrink the backup device — a good add-on, not a backup source.",
        "evaluated": False,
    },
    "gravity": {
        "name": "Gravity storage (mass towers / shafts)", "category": "Medium duration", "group": "ldes",
        "duration_h": [2, 8], "response": "seconds", "rte": 0.80, "life_years": 35, "cycle_life": 20000,
        "capex_usd_per_kw": 1400, "capex_usd_per_kwh": 250, "opex_pct": 1.5, "trl": 6, "complexity": 4,
        "footprint": "tall structure or deep shaft", "site_needs": "structural site, early commercial stage",
        "nigeria_note": "Early commercial; no supply chain in West Africa yet.",
        "evaluated": False,
    },
    "zinc": {
        "name": "Zinc-based backup devices (Zn-Br, Zn-air, Zn-ion)", "category": "Medium–long duration", "group": "ldes",
        "duration_h": [4, 12], "response": "< 1 s", "rte": 0.70, "life_years": 15, "cycle_life": 5000,
        "capex_usd_per_kw": 500, "capex_usd_per_kwh": 300, "opex_pct": 2.0, "trl": 7, "complexity": 3,
        "footprint": "≈ 0.1 m²/kWh", "site_needs": "shaded pad; non-flammable electrolyte",
        "nigeria_note": "Promising for hot climates (non-flammable, tolerant of deep discharge); limited vendors today.",
        "evaluated": False,
    },
    "metal_air": {
        "name": "Metal-air backup devices (iron-air)", "category": "Multi-day", "group": "ldes",
        "duration_h": [24, 100], "response": "seconds", "rte": 0.40, "life_years": 20, "cycle_life": 3000,
        "capex_usd_per_kw": 1500, "capex_usd_per_kwh": 25, "opex_pct": 2.0, "trl": 6, "complexity": 4,
        "footprint": "large modular blocks", "site_needs": "utility-scale sites; first commercial plants 2025–2027",
        "nigeria_note": "Watch-list for multi-day resilience once commercial.",
        "evaluated": False,
    },
    "laes": {
        "name": "Liquid-air storage (LAES)", "category": "Long duration, utility scale", "group": "ldes",
        "duration_h": [6, 24], "response": "minutes", "rte": 0.55, "life_years": 30, "cycle_life": 10000,
        "capex_usd_per_kw": 1600, "capex_usd_per_kwh": 130, "opex_pct": 2.0, "trl": 7, "complexity": 5,
        "footprint": "cryogenic tanks + turbo-machinery", "site_needs": "industrial site with waste heat/cold",
        "nigeria_note": "Utility scale only; synergies with LNG cold in the Niger Delta are theoretical today.",
        "evaluated": False,
    },
    # Generation / sources
    "solar_pv": {
        "name": "Solar PV", "category": "Generation", "group": "source",
        "duration_h": [0, 0], "response": "n/a", "rte": 1.0, "life_years": 25, "cycle_life": 0,
        "capex_usd_per_kw": 850, "capex_usd_per_kwh": 0, "opex_pct": 1.5, "trl": 9, "complexity": 1,
        "footprint": "≈ 6 m² per kWp (rooftop), 12–15 m² per kWp (ground)", "site_needs": "roof/land, low shading",
        "nigeria_note": "4.5–6.5 kWh/m²/day across Nigeria — the strongest local resource; daytime hospital load matches the solar curve.",
        "evaluated": True,
    },
    "wind": {
        "name": "Wind turbine (100–500 kW class)", "category": "Generation", "group": "source",
        "duration_h": [0, 0], "response": "n/a", "rte": 1.0, "life_years": 20, "cycle_life": 0,
        "capex_usd_per_kw": 2200, "capex_usd_per_kwh": 0, "opex_pct": 3.0, "trl": 9, "complexity": 3,
        "footprint": "tower + 200 m exclusion", "site_needs": "≥ 5.5 m/s mean wind at hub height, open terrain",
        "nigeria_note": "Only marginal-to-fair in the far north (Sokoto, Kano, Katsina) and on the Jos Plateau; weak in the south.",
        "evaluated": True,
    },
    "diesel_gen": {
        "name": "Diesel generator (existing or new)", "category": "Backup generation", "group": "source",
        "duration_h": [0, 0], "response": "10–30 s start", "rte": 1.0, "life_years": 15, "cycle_life": 0,
        "capex_usd_per_kw": 280, "capex_usd_per_kwh": 0, "opex_pct": 2.0, "trl": 9, "complexity": 2,
        "footprint": "gen-house + fuel tank", "site_needs": "fuel logistics, noise/emissions setback",
        "nigeria_note": "Ubiquitous but ≈ US$0.46/kWh at current diesel prices (≈ US$1.30/L); best kept as the last tier behind solar + backup_device.",
        "evaluated": True,
    },
}

# ─── Economic constants ─────────────────────────────────────────────────────────────────
ECON = {
    "diesel_l_per_kwh": 0.32,           # part-load average for standby gensets (0.27 at 75 % load)
    "diesel_opex_usd_per_kwh": 0.04,    # servicing, oil, filters, attendants
    "pv_performance_ratio": 0.78,
    "pv_temp_coeff_per_c": -0.004,      # per °C above 25 °C cell temperature
    "backup_dod": 0.90,                # usable window = backup_max_soc − backup_min_soc (sizing and dispatch agree)
    "backup_min_soc": 0.05,
    "backup_max_soc": 0.95,
    "ups_pf": 0.9,
    "ups_margin": 1.25,
    "hours_per_year": 8760,
    "analysis_years": 15,
    "h2_kwh_per_kg": 33.3,
    "fuel_cell_efficiency": 0.50,
    "electrolyser_kwh_per_kg": 52.0,
}

STANDARD_UPS_KVA = [10, 15, 20, 30, 40, 60, 80, 100, 120, 160, 200, 250, 300, 400, 500, 600, 800, 1000, 1250, 1600, 2000]
STANDARD_GEN_KVA = [30, 50, 80, 100, 150, 200, 250, 300, 400, 500, 650, 800, 1000, 1250, 1500, 2000, 2500]

# CAPEX split of a turnkey storage project (used for the EPC cost breakdown chart) — share of the
# storage-system installed cost, based on NREL ATB commercial storage cost stack.
BACKUP_BREAKDOWN = {
    "Backup Device / storage system": 0.52,
    "PCS / inverter": 0.14,
    "Transformers / switchgear": 0.07,
    "EMS / BEMS & controls": 0.05,
    "HVAC / thermal management": 0.05,
    "Fire safety": 0.03,
    "EPC / civil works": 0.09,
    "Grid connection": 0.02,
    "Engineering / commissioning": 0.03,
}

REFERENCES = [
    {"id": "nrel-atb-2024", "title": "NREL Annual Technology Baseline 2024 — commercial & utility-scale storage, PV", "url": "https://atb.nrel.gov/electricity/2024/index"},
    {"id": "lazard-lcos-2024", "title": "Lazard Levelized Cost of Storage+ v9.0", "url": "https://www.lazard.com/research-insights/levelized-cost-of-energyplus/"},
    {"id": "irena-2023", "title": "IRENA Renewable Power Generation Costs in 2023", "url": "https://www.irena.org/Publications/2024/Sep/Renewable-Power-Generation-Costs-in-2023"},
    {"id": "bnef-2025", "title": "BloombergNEF lithium-ion price survey 2025", "url": "https://about.bnef.com/insights/clean-energy/lithium-ion-backup-pack-prices-fall-to-108-per-kilowatt-hour-despite-rising-metal-prices-bloombergnef/"},
    {"id": "irena-2025", "title": "IRENA Renewable Power Generation Costs in 2025 — Executive summary", "url": "https://www.irena.org/-/media/Files/IRENA/Agency/Publication/2026/Jul/IRENA_TEC_RPGC_2025_Executive_summary_2026.pdf"},
    {"id": "iea-africa", "title": "IEA Africa Energy Outlook 2022", "url": "https://www.iea.org/reports/africa-energy-outlook-2022"},
    {"id": "worldbank-nga", "title": "World Bank Open Data — Nigeria electricity indicators", "url": "https://data.worldbank.org/country/nigeria"},
    {"id": "nerc-myto", "title": "NERC Multi-Year Tariff Order 2024 (Band A tariff)", "url": "https://nerc.gov.ng/"},
    {"id": "ldes-council", "title": "LDES Council — long-duration storage technology overview", "url": "https://www.ldescouncil.com/"},
]
