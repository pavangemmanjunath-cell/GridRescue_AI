"""Geocoding: Nominatim reverse (OSM), Open-Meteo geocoding search, Open-Meteo elevation.

All free, no API key. Nominatim asks for ≤1 req/s and a descriptive User-Agent — we cache
for 24 h and only call it when the pin moves.
"""
from __future__ import annotations

import json
from pathlib import Path

from app.config import DATA_DIR, settings
from app.core.cache import cached
from app.core.geo import haversine_km, in_africa, in_nigeria, offset_point
from app.core.http import fetch_json

NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse"
OPEN_METEO_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
OPEN_METEO_ELEVATION = "https://api.open-meteo.com/v1/elevation"

_STATES = json.loads((DATA_DIR / "nigeria_states.json").read_text(encoding="utf-8"))
STATE_CLASSES: dict = _STATES["classes"]
NIGERIA_STATES: list[dict] = _STATES["states"]

_TZ = {
    "NG": "Africa/Lagos", "GH": "Africa/Accra", "KE": "Africa/Nairobi", "ZA": "Africa/Johannesburg",
    "EG": "Africa/Cairo", "ET": "Africa/Addis_Ababa", "TZ": "Africa/Dar_es_Salaam", "UG": "Africa/Kampala",
    "SN": "Africa/Dakar", "CI": "Africa/Abidjan", "CM": "Africa/Douala", "MA": "Africa/Casablanca",
    "DZ": "Africa/Algiers", "TN": "Africa/Tunis", "RW": "Africa/Kigali", "ZM": "Africa/Lusaka",
    "ZW": "Africa/Harare", "MZ": "Africa/Maputo", "AO": "Africa/Luanda", "CD": "Africa/Kinshasa",
    "SD": "Africa/Khartoum", "NE": "Africa/Niamey", "ML": "Africa/Bamako", "BF": "Africa/Ouagadougou",
    "TG": "Africa/Lome", "BJ": "Africa/Porto-Novo", "TD": "Africa/Ndjamena", "MG": "Indian/Antananarivo",
    "DE": "Europe/Berlin", "GB": "Europe/London", "FR": "Europe/Paris", "US": "America/New_York",
    "IN": "Asia/Kolkata", "AE": "Asia/Dubai", "BR": "America/Sao_Paulo", "AU": "Australia/Sydney",
}


def nearest_nigeria_state(lat: float, lng: float) -> dict | None:
    if not in_nigeria(lat, lng):
        return None
    return min(NIGERIA_STATES, key=lambda s: haversine_km(lat, lng, s["lat"], s["lng"]))


def state_by_iso(iso: str | None) -> dict | None:
    if not iso:
        return None
    for s in NIGERIA_STATES:
        if s["iso"] == iso:
            return s
    return None


def _fallback_place(lat: float, lng: float) -> dict:
    st = nearest_nigeria_state(lat, lng)
    if st:
        return {
            "name": f"near {st['capital']}", "state": st["name"], "state_iso": st["iso"], "country": "Nigeria",
            "country_code": "NG", "timezone": "Africa/Lagos", "display_name": f"{st['name']} State, Nigeria",
            "source": "fallback:nigeria-states",
        }
    return {
        "name": f"{abs(lat):.2f}°{'N' if lat >= 0 else 'S'}, {abs(lng):.2f}°{'E' if lng >= 0 else 'W'}",
        "state": None, "state_iso": None, "country": "Africa" if in_africa(lat, lng) else "World",
        "country_code": "XX", "timezone": "UTC", "display_name": "Unresolved coordinate", "source": "fallback:coordinate",
    }


@cached("nominatim_reverse", ttl=86400)
async def reverse_geocode(lat: float, lng: float) -> dict:
    try:
        data = await fetch_json(
            NOMINATIM_REVERSE,
            params={"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 10, "accept-language": "en"},
            headers={"User-Agent": settings.user_agent}, timeout=8,
        )
    except Exception:
        return _fallback_place(lat, lng)
    if not data or "address" not in data:
        return _fallback_place(lat, lng)
    a = data["address"]
    cc = (a.get("country_code") or "xx").upper()
    name = (a.get("city") or a.get("town") or a.get("village") or a.get("municipality") or a.get("county")
            or a.get("state") or (data.get("display_name", "Unknown").split(",")[0].strip()))
    iso = a.get("ISO3166-2-lvl4") or a.get("ISO3166-2-lvl3")
    st = state_by_iso(iso) if cc == "NG" else None
    if cc == "NG" and st is None:
        st = nearest_nigeria_state(lat, lng)
    return {
        "name": name,
        "state": (st["name"] if st else a.get("state")),
        "state_iso": (st["iso"] if st else iso),
        "county": a.get("county"),
        "country": a.get("country", "Unknown"),
        "country_code": cc,
        "timezone": _TZ.get(cc, "UTC"),
        "display_name": data.get("display_name"),
        "source": "nominatim",
    }


@cached("geocode_search", ttl=86400)
async def search_places(q: str, count: int = 6) -> list[dict]:
    """Free-text place search (Open-Meteo geocoding, GeoNames-based). Africa results first."""
    try:
        data = await fetch_json(OPEN_METEO_GEOCODE, params={"name": q, "count": max(count * 2, 10), "language": "en", "format": "json"}, timeout=8)
        results = data.get("results") or []
    except Exception:
        results = []
    if not results:
        ql = q.strip().lower()
        results = [
            {"name": s["capital"], "latitude": s["lat"], "longitude": s["lng"], "country": "Nigeria",
             "country_code": "NG", "admin1": s["name"], "timezone": "Africa/Lagos", "population": None}
            for s in NIGERIA_STATES if ql and (ql in s["capital"].lower() or ql in s["name"].lower())
        ]
    out = []
    for r in results:
        out.append({
            "name": r.get("name"), "lat": r.get("latitude"), "lng": r.get("longitude"),
            "country": r.get("country"), "country_code": r.get("country_code"), "admin1": r.get("admin1"),
            "timezone": r.get("timezone"), "population": r.get("population"),
            "in_africa": in_africa(r.get("latitude", 0), r.get("longitude", 0)),
        })
    out.sort(key=lambda r: (not r["in_africa"], r["country_code"] != "NG", -(r["population"] or 0)))
    return out[:count]


@cached("elevation_point", ttl=7 * 86400)
async def elevation(lat: float, lng: float) -> float:
    try:
        d = await fetch_json(OPEN_METEO_ELEVATION, params={"latitude": lat, "longitude": lng}, timeout=6)
        return float(d["elevation"][0])
    except Exception:
        return 0.0


@cached("elevation_relief", ttl=7 * 86400)
async def terrain_relief(lat: float, lng: float, radius_km: float = 2.0) -> dict:
    """Sample elevation at the centre and on two rings (r and 2r, 8 bearings each)."""
    pts = [(lat, lng)]
    for ring in (radius_km, radius_km * 2):
        for b in range(0, 360, 45):
            pts.append(offset_point(lat, lng, ring, b))
    try:
        d = await fetch_json(
            OPEN_METEO_ELEVATION,
            params={"latitude": ",".join(f"{p[0]:.5f}" for p in pts), "longitude": ",".join(f"{p[1]:.5f}" for p in pts)},
            timeout=8,
        )
        el = [float(v) for v in d["elevation"]]
        source = "open-meteo-elevation"
    except Exception:
        el = [0.0] * len(pts)
        source = "unavailable"
    center = el[0]
    ring = el[1:]
    return {
        "center_m": center, "min_m": min(el), "max_m": max(el),
        "head_up_m": max(0.0, max(ring) - center) if ring else 0.0,
        "head_down_m": max(0.0, center - min(ring)) if ring else 0.0,
        "relief_m": max(el) - min(el), "radius_km": radius_km, "samples": len(pts), "source": source,
    }
