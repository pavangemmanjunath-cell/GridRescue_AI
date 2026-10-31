"""The open data and tools the Global Energy Hackathon 2026 lists for energy innovators, wired into GridRescue.

  * Global Solar Atlas (World Bank · Solargis)  → long-term PV output per kWp, GHI, optimal tilt: a fourth solar cross-check
  * World Bank ENERGYDATA.INFO (CKAN API)       → the country's open energy datasets (grid maps, access, tariffs)
  * pandapower                                  → the grid-first feeder check (services/feeder.py)
  * QGIS · OpenStreetMap                        → the mapped grid around a site as GeoJSON, ready to open in QGIS
  * NLR PVWatts (SAM's PV model), NASA POWER    → already in services/solar_check.py and services/resources.py
  * OpenEI URDB, U.S. EIA Open Data             → need a registered key (OPENEI_API_KEY / EIA_API_KEY); listed as "add a key"
  * Global Wind Atlas                           → publishes country GeoTIFFs, not a point API; ERA5 (Open-Meteo) answers wind here
"""
from __future__ import annotations

import os
from importlib.util import find_spec

from app.core.cache import cached
from app.core.http import fetch_json

GSA_URL = "https://api.globalsolaratlas.info/data/lta"
CKAN_URL = "https://energydata.info/api/3/action/package_search"


@cached("global_solar_atlas", ttl=30 * 86400)
async def global_solar_atlas(lat: float, lng: float) -> dict:
    data = await fetch_json(GSA_URL, params={"loc": f"{lat:.4f},{lng:.4f}"}, timeout=25)
    a = data["annual"]["data"]
    return {"source": "Global Solar Atlas (World Bank · Solargis)", "pvout_kwh_per_kwp_year": round(a["PVOUT_csi"]),
            "ghi_kwh_m2_year": round(a["GHI"]), "optimal_tilt_deg": a.get("OPTA"), "temp_c": round(a.get("TEMP", 0), 1)}


@cached("energydata_info", ttl=7 * 86400)
async def energydata_datasets(iso3: str, rows: int = 8) -> dict:
    data = await fetch_json(CKAN_URL, params={"q": "electricity OR grid OR energy OR solar", "fq": f"country_code:{iso3.upper()}", "rows": rows}, timeout=25)
    res = data.get("result") or {}
    items = [{"title": d.get("title"), "publisher": (d.get("organization") or {}).get("title") or d.get("author"),
              "url": f"https://energydata.info/dataset/{d.get('name')}",
              "formats": sorted({(r.get("format") or "").upper() for r in d.get("resources") or [] if r.get("format")})[:4]}
             for d in res.get("results") or []]
    return {"source": "World Bank ENERGYDATA.INFO", "country": iso3.upper(), "count": res.get("count", len(items)), "datasets": items}


def grid_geojson(power: dict, site: dict) -> dict:
    """Substations, plants and lines from the grid mapper as a GeoJSON FeatureCollection (lon, lat), for QGIS."""
    f = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [site["lng"], site["lat"]]}, "properties": {"kind": "site", "name": site.get("name") or "site"}}]
    for s in power.get("substations") or []:
        f.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [s["lng"], s["lat"]]},
                  "properties": {"kind": "substation", "name": s.get("name"), "voltage_kv": s.get("voltage_kv"), "distance_km": s.get("distance_km")}})
    for p in power.get("plants") or []:
        if p.get("lat") is not None:
            f.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [p["lng"], p["lat"]]},
                      "properties": {"kind": "plant", "name": p.get("name"), "capacity_mw": p.get("capacity_mw"), "source": p.get("source")}})
    for ln in power.get("lines") or []:
        g = ln.get("geometry") or []
        if len(g) >= 2:
            f.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[lo, la] for la, lo in g]},
                      "properties": {"kind": "line", "voltage_kv": ln.get("voltage_kv"), "distance_km": ln.get("distance_km")}})
    return {"type": "FeatureCollection", "name": "gridrescue_grid", "features": f,
            "properties": {"source": power.get("source"), "radius_km": power.get("radius_km"), "attribution": "© OpenStreetMap contributors (ODbL)"}}


def sources() -> list[dict]:
    """Every source on the organisers' list, and how GridRescue uses it."""
    key = lambda name: bool(os.environ.get(name))
    return [
        {"group": "Solar & wind", "name": "NLR PVWatts API", "use": "PV yield cross-check (runs SAM's PV model)", "status": "live", "route": "/api/solar-check"},
        {"group": "Solar & wind", "name": "NASA POWER", "use": "Climatology: sun, wind, temperature", "status": "live", "route": "/api/climate"},
        {"group": "Solar & wind", "name": "Global Solar Atlas", "use": "PV output per kWp, fourth solar cross-check", "status": "live", "route": "/api/solar-check"},
        {"group": "Solar & wind", "name": "Global Wind Atlas", "use": "Country wind maps (GeoTIFF); point wind from ERA5 instead", "status": "reference", "route": "/api/wind"},
        {"group": "Energy data", "name": "World Bank ENERGYDATA.INFO", "use": "The country's open energy datasets", "status": "live", "route": "/api/energydata"},
        {"group": "Energy data", "name": "World Bank indicators", "use": "Access, outages, grid losses by country", "status": "live", "route": "/api/country/{cc}"},
        {"group": "Energy data", "name": "OpenEI (utility rates)", "use": "US utility tariffs", "status": "live" if key("OPENEI_API_KEY") else "add key", "route": None},
        {"group": "Energy data", "name": "U.S. EIA Open Data", "use": "US state electricity prices", "status": "live" if key("EIA_API_KEY") else "add key", "route": None},
        {"group": "Model & map", "name": "pandapower", "use": "Grid-first feeder load flow from the nearest substation (pandapower's model and conductor data; runs pandapower itself when installed)",
         "status": "live" if find_spec("pandapower") else "model", "route": "/api/grid/feeder"},
        {"group": "Model & map", "name": "OpenStreetMap", "use": "Substations, lines, plants, hospitals", "status": "live", "route": "/api/grid"},
        {"group": "Model & map", "name": "QGIS", "use": "Grid around a site as GeoJSON, opens in QGIS", "status": "live", "route": "/api/grid/geojson"},
        {"group": "Weather", "name": "Open-Meteo (ERA5, forecast)", "use": "Hourly typical day, wind rose, 7-day forecast", "status": "live", "route": "/api/hourly"},
        {"group": "Solar", "name": "PVGIS (EU JRC)", "use": "Monthly sun and PV yield", "status": "live", "route": "/api/sun"},
    ]
