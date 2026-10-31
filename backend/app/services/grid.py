"""Grid layer: OSM power infrastructure (Overpass), World Bank reliability indicators and
Nigeria state-level outage classes → grid strength score + outage risk class.
"""
from __future__ import annotations

import re

from app.core.cache import cached
from app.core.geo import bearing_deg, compass, haversine_km, polyline_min_distance_km
from app.core.http import fetch_json, gather_safe
from app.services.geocode import STATE_CLASSES, nearest_nigeria_state, state_by_iso
from app.services import osm_snapshot
from app.services.overpass import elem_geometry, elem_latlng, run_query

WB_URL = "https://api.worldbank.org/v2/country/{iso3}/indicator/{ind}"
WB_INDICATORS = {
    "access_pct": "EG.ELC.ACCS.ZS",       # Access to electricity (% of population)
    "firms_outages_pct": "IC.ELC.OUTG.ZS",  # Firms experiencing electrical outages (% of firms)
    "td_losses_pct": "EG.ELC.LOSS.ZS",     # Transmission & distribution losses (% of output)
}
# Snapshot of World Bank API values, used offline / as fallback
WB_FALLBACK = {
    "NGA": {"access_pct": (62.5, 2024), "firms_outages_pct": (82.5, 2025), "td_losses_pct": (14.2, 2023)},
    "GHA": {"access_pct": (91.9, 2024), "firms_outages_pct": (63.0, 2013), "td_losses_pct": (26.0, 2022)},
    "KEN": {"access_pct": (77.0, 2024), "firms_outages_pct": (75.0, 2018), "td_losses_pct": (23.0, 2022)},
    "ZAF": {"access_pct": (90.2, 2024), "firms_outages_pct": (48.0, 2020), "td_losses_pct": (11.0, 2022)},
    "EGY": {"access_pct": (100.0, 2024), "firms_outages_pct": (30.0, 2020), "td_losses_pct": (13.0, 2022)},
}
ISO2_TO_ISO3 = {"NG": "NGA", "GH": "GHA", "KE": "KEN", "ZA": "ZAF", "EG": "EGY", "ET": "ETH", "TZ": "TZA", "UG": "UGA",
                "SN": "SEN", "CI": "CIV", "CM": "CMR", "MA": "MAR", "DZ": "DZA", "TN": "TUN", "RW": "RWA", "ZM": "ZMB",
                "ZW": "ZWE", "MZ": "MOZ", "AO": "AGO", "CD": "COD", "SD": "SDN", "NE": "NER", "ML": "MLI", "BF": "BFA",
                "TG": "TGO", "BJ": "BEN", "TD": "TCD", "MG": "MDG", "DE": "DEU", "GB": "GBR", "FR": "FRA", "US": "USA",
                "IN": "IND", "AE": "ARE", "BR": "BRA", "AU": "AUS", "ES": "ESP", "IT": "ITA"}


@cached("worldbank", ttl=7 * 86400)
async def country_indicators(country_code: str) -> dict:
    iso3 = ISO2_TO_ISO3.get(country_code.upper(), country_code.upper())
    out: dict = {"country_code": country_code.upper(), "iso3": iso3, "source": "world-bank-api"}
    results = await gather_safe(*[
        fetch_json(WB_URL.format(iso3=iso3, ind=ind), params={"format": "json", "mrv": 1}, timeout=10)
        for ind in WB_INDICATORS.values()
    ])
    ok = 0
    for key, res in zip(WB_INDICATORS.keys(), results):
        val, year = None, None
        if isinstance(res, list) and len(res) > 1 and isinstance(res[1], list) and res[1]:
            row = res[1][0]
            val, year = row.get("value"), row.get("date")
            ok += 1 if val is not None else 0
        if val is None and iso3 in WB_FALLBACK:
            val, year = WB_FALLBACK[iso3][key]
            out["source"] = "world-bank-snapshot"
        out[key] = {"value": round(val, 1) if isinstance(val, (int, float)) else None, "year": year, "indicator": WB_INDICATORS[key]}
    if ok == 0 and iso3 not in WB_FALLBACK:
        out["source"] = "unavailable"
    return out


def _power_query(lat: float, lng: float, radius_m: int) -> str:
    return (
        f'[out:json][timeout:30];('
        f'node["power"="substation"](around:{radius_m},{lat},{lng});'
        f'way["power"="substation"](around:{radius_m},{lat},{lng});'
        f'node["power"="plant"](around:{radius_m},{lat},{lng});'
        f'way["power"="plant"](around:{radius_m},{lat},{lng});'
        f'relation["power"="plant"](around:{radius_m},{lat},{lng});'
        f');out center tags qt 300;'   # lines come from _lines_query; including them here ate the element limit
    )


def _lines_query(lat: float, lng: float, radius_m: int) -> str:
    return f'[out:json][timeout:30];(way["power"="line"](around:{radius_m},{lat},{lng}););out geom qt 60;'


def _voltage_kv(tag: str | None) -> float:
    if not tag:
        return 0.0
    try:
        v = max(float(x) for x in re.findall(r"\d+(?:\.\d+)?", tag))
        return v / 1000 if v > 1000 else v
    except ValueError:
        return 0.0


def _plant_mw(tags: dict) -> float:
    raw = tags.get("plant:output:electricity") or tags.get("generator:output:electricity") or ""
    m = re.search(r"([\d.]+)\s*(MW|kW|GW)?", raw, re.I)
    if not m:
        return 0.0
    v = float(m.group(1))
    unit = (m.group(2) or "MW").upper()
    return v / 1000 if unit == "KW" else v * 1000 if unit == "GW" else v


@cached("osm_power_v2", ttl=7 * 86400)
async def nearby_power(lat: float, lng: float, radius_km: float = 30.0) -> dict:
    if osm_snapshot.covers(lat, lng):   # local Nigeria snapshot: milliseconds instead of a 30–130 s Overpass round trip
        return osm_snapshot.power(lat, lng, radius_km, min(radius_km, 20))
    subs, plants, lines = [], [], []
    source = "openstreetmap-overpass"
    try:
        elems, line_elems = await gather_safe(run_query(_power_query(lat, lng, int(radius_km * 1000))),
                                             run_query(_lines_query(lat, lng, int(min(radius_km, 20) * 1000))))
        if isinstance(elems, Exception):
            raise elems
        for e in elems:
            tags = e.get("tags", {})
            kind = tags.get("power")
            pos = elem_latlng(e)
            if not pos or kind == "line":
                continue
            d = haversine_km(lat, lng, *pos)
            item = {"id": f"{e.get('type')}/{e.get('id')}", "name": tags.get("name") or tags.get("operator") or f"unnamed {kind}",
                    "lat": pos[0], "lng": pos[1], "distance_km": round(d, 2), "bearing": compass(bearing_deg(lat, lng, *pos)),
                    "operator": tags.get("operator")}
            if kind == "substation":
                item.update({"voltage_kv": _voltage_kv(tags.get("voltage")), "substation_type": tags.get("substation")})
                subs.append(item)
            elif kind == "plant":
                item.update({"source": tags.get("plant:source"), "method": tags.get("plant:method"), "capacity_mw": _plant_mw(tags)})
                plants.append(item)
        if isinstance(line_elems, list):
            for e in line_elems:
                tags = e.get("tags", {})
                geom = elem_geometry(e)
                if not geom:
                    continue
                step = max(1, len(geom) // 40)
                lines.append({"id": f"way/{e.get('id')}", "name": tags.get("name"), "voltage_kv": _voltage_kv(tags.get("voltage")),
                              "operator": tags.get("operator"), "distance_km": round(polyline_min_distance_km(lat, lng, geom), 2),
                              "geometry": [[round(a, 5), round(b, 5)] for a, b in geom[::step]]})
    except Exception:
        source = "unavailable"
    subs.sort(key=lambda s: s["distance_km"])
    plants.sort(key=lambda s: s["distance_km"])
    lines.sort(key=lambda s: s["distance_km"])
    return {"radius_km": radius_km, "source": source, "substations": subs[:60], "plants": plants[:30], "lines": lines[:60],
            "summary": {"substations": len(subs), "plants": len(plants), "lines": len(lines),
                        "hv_substations": len([s for s in subs if s.get("voltage_kv", 0) >= 110]),
                        "max_voltage_kv": max([s.get("voltage_kv", 0) for s in subs] + [l.get("voltage_kv", 0) for l in lines] + [0]),
                        "plant_capacity_mw": round(sum(p.get("capacity_mw", 0) for p in plants), 1),
                        "nearest_substation_km": subs[0]["distance_km"] if subs else None,
                        "nearest_line_km": lines[0]["distance_km"] if lines else None}}


def infrastructure_score(power: dict) -> int:
    """0–100 physical grid-density score from OSM features."""
    s = power["summary"]
    score = 10
    n_sub = s["substations"]
    score += min(30, n_sub * 4)
    if s["hv_substations"]:
        score += 15
    if s["max_voltage_kv"] >= 330:
        score += 15
    elif s["max_voltage_kv"] >= 132:
        score += 10
    elif s["max_voltage_kv"] >= 33:
        score += 5
    d = s["nearest_substation_km"]
    if d is not None:
        score += 15 if d <= 3 else 10 if d <= 8 else 5 if d <= 15 else 0
    if s["plants"]:
        score += 10
    if power.get("source") == "unavailable":
        return 0
    return max(0, min(100, score))


def class_for_hours(supply_hours: float) -> str:
    """Grid class for a reported supply (same bands as the Facility page: A > 20 h, B 14–20, C 10–14, D 6–10, E < 6)."""
    return "A" if supply_hours > 20 else "B" if supply_hours >= 14 else "C" if supply_hours >= 10 else "D" if supply_hours >= 6 else "E"


def reliability_profile(lat: float, lng: float, country_code: str, state_iso: str | None, power: dict,
                        wb: dict, override_class: str | None = None, supply_hours_override: float | None = None) -> dict:
    """Combine state outage class, World Bank indicators and OSM density into one reliability score.
    A facility's own reported supply hours (e.g. a hospital's feeder log) replace the state assumption."""
    st = state_by_iso(state_iso) if state_iso else None
    if st is None and country_code == "NG":
        st = nearest_nigeria_state(lat, lng)
    if override_class is None and supply_hours_override is not None:
        override_class = class_for_hours(supply_hours_override)
    cls = override_class or (st["grid_class"] if st else None)
    if cls is None:
        # Non-Nigerian: derive from World Bank access + outage share
        acc = (wb.get("access_pct") or {}).get("value")
        outg = (wb.get("firms_outages_pct") or {}).get("value")
        if acc is None:
            cls = "C"
        elif acc >= 97 and (outg is None or outg < 35):
            cls = "A"
        elif acc >= 85:
            cls = "B"
        elif acc >= 65:
            cls = "C"
        elif acc >= 45:
            cls = "D"
        else:
            cls = "E"
    meta = STATE_CLASSES[cls]
    infra = infrastructure_score(power)
    base = meta["score"]
    # infra density nudges ±10 within the class
    score = int(round(base + (infra - 50) * 0.2)) if power.get("source") != "unavailable" else base
    score = max(0, min(100, score))
    supply_h = meta["supply_hours"] if supply_hours_override is None else round(float(supply_hours_override), 1)
    basis = ("Nigeria state-level DisCo assumption + OSM density + World Bank indicators" if st else
             "World Bank access/outage indicators + OSM density")
    if supply_hours_override is not None:
        basis = f"Supply reported by the facility ({supply_h:g} h a day) + OSM density"
    return {
        "grid_class": cls, "class_label": meta["label"], "outage_risk": meta["outage_risk"],
        "expected_supply_hours_per_day": supply_h, "expected_outage_hours_per_day": round(24 - supply_h, 1),
        "reliability_score": score, "infrastructure_score": infra,
        "state": st["name"] if st else None, "state_iso": st["iso"] if st else state_iso, "disco": st["disco"] if st else None,
        "override": override_class is not None, "reported_supply_hours": supply_hours_override,
        "basis": basis,
    }


async def grid_profile(lat: float, lng: float, country_code: str, state_iso: str | None, radius_km: float = 30.0,
                       override_class: str | None = None, supply_hours_override: float | None = None) -> dict:
    power, wb = await gather_safe(nearby_power(lat, lng, radius_km), country_indicators(country_code))
    if not isinstance(power, dict):
        power = {"radius_km": radius_km, "source": "unavailable", "substations": [], "plants": [], "lines": [],
                 "summary": {"substations": 0, "plants": 0, "lines": 0, "hv_substations": 0, "max_voltage_kv": 0,
                             "plant_capacity_mw": 0, "nearest_substation_km": None, "nearest_line_km": None}}
    if not isinstance(wb, dict):
        wb = {"country_code": country_code, "source": "unavailable"}
    rel = reliability_profile(lat, lng, country_code, state_iso, power, wb, override_class, supply_hours_override)
    return {"power": power, "country": wb, "reliability": rel}


async def grid_scan(lat: float, lng: float, country_code: str, state_iso: str | None, override_class: str | None = None,
                    supply_hours_override: float | None = None) -> dict:
    """One 100 km lookup, split into the 50 km and 100 km rings the explorer draws (green strong → red weak)."""
    power, wb = await gather_safe(nearby_power(lat, lng, 100.0), country_indicators(country_code))
    if not isinstance(power, dict):
        power = {"source": "unavailable", "substations": [], "plants": [], "lines": []}
    if not isinstance(wb, dict):
        wb = {"country_code": country_code, "source": "unavailable"}
    rings = []
    for km in (50, 100):
        subs = [s for s in power["substations"] if s["distance_km"] <= km]
        plants = [p for p in power["plants"] if p["distance_km"] <= km]
        p = {**power, "radius_km": km, "substations": subs, "plants": plants, "summary": osm_snapshot.summary(subs, plants, power["lines"])}
        rings.append({"radius_km": km, "power": p, "reliability": reliability_profile(lat, lng, country_code, state_iso, p, wb, override_class, supply_hours_override)})
    return {"source": power.get("source"), "country": wb, "rings": rings}