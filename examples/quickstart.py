"""Quick start: assess a site with the GridRescue AI engine in a few seconds.

Runs the same path as the web app's "Run the plan" (POST /api/assess) inside this process, so no server, browser
or API key is needed. By default it reads open data (NASA POWER, Open-Meteo, OpenStreetMap) like the app does and
reproduces the README figures; with --offline it uses only the bundled snapshots and modelled hourly weather.

Usage (from the repository root, with the backend dependencies installed):

    python examples/quickstart.py
        Reproduces the worked example in the README: National Orthopaedic Hospital, Enugu (Brief 12 case,
        6 h of grid a day, moving to a new site in year 5).

    python examples/quickstart.py --lat 12.0022 --lng 8.5920 --type hospital_general --beds 150
        Any other site, with a benchmark facility (here a 150-bed general hospital in Kano).

    python examples/quickstart.py --offline
        No network: bundled snapshots and modelled hourly weather (same design, slightly different diesel and CO2).

The numbers are pre-feasibility estimates (about +/-30 %) from open data and benchmark loads, not an engineering study.
"""
from __future__ import annotations

import argparse
import logging
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def request_body(client, a: argparse.Namespace) -> dict:
    if a.lat is None:   # the worked example: the hospital's own inputs from the Brief 12 case file
        case = client.get("/api/cases/noh-enugu").json()
        reloc = {**case["options"]["relocation"], "new_site": {k: case["new_site"][k] for k in ("lat", "lng", "label")}}
        return {"location": {"lat": case["hospital"]["lat"], "lng": case["hospital"]["lng"]},
                "facility": case["facility"], "options": {**case["options"], "relocation": reloc}}
    return {"location": {"lat": a.lat, "lng": a.lng},
            "facility": {"type": a.type, "beds": a.beds, "backup_hours": a.backup_hours,
                         "existing": {"generator_kva": a.generator_kva}, "priority": "balanced"}}


def main() -> None:
    ap = argparse.ArgumentParser(description="Assess a site with the GridRescue AI engine (offline).")
    ap.add_argument("--lat", type=float, help="latitude in degrees (omit to run the Enugu worked example)")
    ap.add_argument("--lng", type=float, help="longitude in degrees")
    ap.add_argument("--type", default="hospital_general", help="facility type, e.g. hospital_general, clinic_phc, school")
    ap.add_argument("--beds", type=int, default=150, help="number of beds (drives the benchmark load)")
    ap.add_argument("--backup-hours", type=float, default=12, help="hours the protected load must ride through")
    ap.add_argument("--generator-kva", type=float, default=500, help="existing generator size, 0 if none")
    ap.add_argument("--offline", action="store_true", help="use only bundled snapshots and modelled weather (no network)")
    a = ap.parse_args()
    if (a.lat is None) != (a.lng is None):
        ap.error("give both --lat and --lng, or neither")

    # settings are read when the app is imported, so set the environment first
    if a.offline:
        os.environ["GR_OFFLINE"] = "1"
    os.environ.setdefault("GR_CACHE_DIR", str(ROOT / "backend" / (".cache-offline" if a.offline else ".cache")))  # git-ignored
    sys.path.insert(0, str(ROOT / "backend"))
    logging.disable(logging.INFO)                                          # keep the output to the results
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        r = client.post("/api/assess", json=request_body(client, a))
        r.raise_for_status()
        j = r.json()

    rec, inv = j["recommended"], j["investment_case"]["investment"]
    comp = rec["components"]
    grid = j["site"]["grid"]
    print(f"Site            {j['location']['lat']:.4f}, {j['location']['lng']:.4f} · grid about {grid['supply_hours']:g} h a day")
    print(f"Recommended     {rec['name']}")
    sizes = [("Solar PV", comp.get("pv", {}).get("kwp"), "kWp"), ("Storage", comp.get("backup_device", {}).get("energy_kwh"), "kWh"),
             ("UPS", comp.get("ups", {}).get("kva"), "kVA"), ("Generator", comp.get("generator", {}).get("kva"), "kVA")]
    for label, value, unit in sizes:
        if value:
            print(f"  {label:13} {value:>9,.0f} {unit}")
    steps = {s["id"]: s for s in j["agent"]["steps"]}
    print(f"Critical load   {rec['simulation_summary']['critical_served_pct']:.0f} % served through the design outage (hourly simulation)")
    print(f"Stress tests    {steps['stress']['summary']}")
    print(f"Diesel avoided  {inv['diesel_avoided_l_per_year']:,.0f} L a year")
    print(f"CO2 avoided     {inv['co2_avoided_t_per_year']:,.0f} t a year net "
          f"(Scope 1 {inv['co2_scope1_avoided_t']:,.0f} t, Scope 2 {inv['co2_scope2_avoided_t']:,.0f} t)")
    print(f"ML first pick   {steps['classify']['summary'][:110]}...")
    print(f"Verified        {steps['verify']['status']}: the hourly simulation decides the recommendation")


if __name__ == "__main__":
    main()
