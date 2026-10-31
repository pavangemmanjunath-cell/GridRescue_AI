"""Water layer: nearby rivers/streams/lakes (OSM), river discharge (Open-Meteo Flood API / GloFAS),
terrain head (Open-Meteo elevation) and rainfall (NASA POWER) → hydro / pumped-hydro / hydrogen-water feasibility.
"""
from __future__ import annotations

from app.core.cache import cached
from app.core.geo import bearing_deg, compass, haversine_km, polyline_min_distance_km
from app.core.http import fetch_json, gather_safe
from app.services import fallback
from app.services.geocode import terrain_relief
from app.services import osm_snapshot
from app.services.overpass import elem_geometry, elem_latlng, run_query

FLOOD_URL = "https://flood-api.open-meteo.com/v1/flood"

# Known major Nigerian rivers for the offline fallback (approximate polylines, WGS84)
FALLBACK_RIVERS = [
    {"name": "River Niger", "type": "river", "mean_m3s": 5500, "coords": [(11.9, 3.6), (10.9, 4.6), (9.1, 5.0), (8.4, 6.0), (7.8, 6.73), (6.7, 6.6), (5.8, 6.4), (5.2, 6.0)]},
    {"name": "River Benue", "type": "river", "mean_m3s": 3400, "coords": [(9.3, 12.5), (8.9, 11.4), (8.3, 10.0), (7.9, 9.3), (7.73, 8.52), (7.8, 7.5), (7.8, 6.75)]},
    {"name": "Kaduna River", "type": "river", "mean_m3s": 190, "coords": [(10.6, 8.3), (10.5, 7.42), (10.0, 6.7), (9.5, 6.0)]},
    {"name": "Ogun River", "type": "river", "mean_m3s": 110, "coords": [(8.3, 3.2), (7.7, 3.4), (7.15, 3.36), (6.7, 3.4), (6.5, 3.45)]},
    {"name": "Cross River", "type": "river", "mean_m3s": 900, "coords": [(6.3, 8.9), (5.7, 8.5), (5.2, 8.3), (4.9, 8.3)]},
    {"name": "Sokoto River", "type": "river", "mean_m3s": 120, "coords": [(12.1, 6.0), (12.9, 5.3), (13.0, 5.25), (12.8, 4.5), (12.4, 4.2)]},
    {"name": "Hadejia River", "type": "river", "mean_m3s": 45, "coords": [(12.1, 8.5), (12.3, 9.5), (12.45, 10.05), (12.6, 10.6)]},
    {"name": "Osun River", "type": "river", "mean_m3s": 60, "coords": [(7.9, 4.6), (7.78, 4.54), (7.5, 4.5), (7.0, 4.4), (6.6, 4.1)]},
    {"name": "Gongola River", "type": "river", "mean_m3s": 150, "coords": [(10.3, 9.9), (10.0, 10.7), (9.8, 11.4), (9.7, 12.05)]},
    {"name": "Jamaare / Katagum River", "type": "river", "mean_m3s": 40, "coords": [(10.6, 9.6), (11.3, 10.1), (11.7, 10.2), (12.3, 10.4)]},
]


def _waterway_query(lat: float, lng: float, radius_m: int) -> str:
    return (
        f'[out:json][timeout:30];('
        f'way["waterway"~"^(river|stream|canal)$"](around:{radius_m},{lat},{lng});'
        f'way["natural"="water"]["water"~"^(lake|reservoir|river)$"](around:{radius_m},{lat},{lng});'
        f'relation["natural"="water"]["water"~"^(lake|reservoir)$"](around:{radius_m},{lat},{lng});'
        f'node["waterway"="dam"](around:{radius_m},{lat},{lng});'
        f'way["waterway"="dam"](around:{radius_m},{lat},{lng});'
        f');out geom qt 70;'
    )


@cached("osm_waterways_v2", ttl=7 * 86400)
async def nearby_waterways(lat: float, lng: float, radius_km: float = 10.0) -> dict:
    features: list[dict] = []
    source = "openstreetmap-overpass"
    try:
        if osm_snapshot.covers(lat, lng):
            features = osm_snapshot.waterways(lat, lng, radius_km)
            source = osm_snapshot.label()
            elems = []
        else:
            elems = await run_query(_waterway_query(lat, lng, int(radius_km * 1000)))
        for e in elems:
            tags = e.get("tags", {})
            kind = tags.get("waterway") or tags.get("water") or tags.get("natural") or "water"
            geom = elem_geometry(e)
            pos = elem_latlng(e)
            if not geom and not pos:
                continue
            d = polyline_min_distance_km(lat, lng, geom) if geom else haversine_km(lat, lng, *pos)
            # thin geometry for transport (max 60 points per way)
            step = max(1, len(geom) // 60)
            features.append({
                "id": f"{e.get('type')}/{e.get('id')}",
                "name": tags.get("name") or tags.get("name:en") or f"unnamed {kind}",
                "kind": kind,
                "distance_km": round(d, 2),
                "bearing": compass(bearing_deg(lat, lng, *(pos or geom[0]))),
                "intermittent": tags.get("intermittent") == "yes",
                "width_m": tags.get("width"),
                "geometry": [[round(a, 5), round(b, 5)] for a, b in geom[::step]] if geom else None,
                "lat": pos[0] if pos else None, "lng": pos[1] if pos else None,
            })
    except Exception:
        source = "fallback:major-rivers"
        for r in FALLBACK_RIVERS:
            d = polyline_min_distance_km(lat, lng, r["coords"])
            if d <= max(radius_km, 40):
                features.append({"id": r["name"], "name": r["name"], "kind": r["type"], "distance_km": round(d, 2), "mean_m3s": r.get("mean_m3s"),
                                 "bearing": compass(bearing_deg(lat, lng, *r["coords"][len(r['coords']) // 2])),
                                 "intermittent": False, "width_m": None, "geometry": [[a, b] for a, b in r["coords"]],
                                 "lat": None, "lng": None})
    features.sort(key=lambda f: f["distance_km"])
    rivers = [f for f in features if f["kind"] == "river"]
    streams = [f for f in features if f["kind"] in ("stream", "canal")]
    lakes = [f for f in features if f["kind"] in ("lake", "reservoir", "water")]
    dams = [f for f in features if f["kind"] == "dam"]
    return {
        "radius_km": radius_km, "source": source, "count": len(features),
        "rivers": len(rivers), "streams": len(streams), "lakes": len(lakes), "dams": len(dams),
        "nearest": features[0] if features else None,
        "nearest_river": rivers[0] if rivers else None,
        "features": features[:70],
    }


@cached("river_discharge", ttl=6 * 3600)
async def river_discharge(lat: float, lng: float) -> dict:
    """GloFAS river discharge (m³/s) at the nearest 5 km grid cell: today + 30-day window."""
    try:
        d = await fetch_json(FLOOD_URL, params={"latitude": lat, "longitude": lng,
                                                "daily": "river_discharge,river_discharge_mean,river_discharge_max,river_discharge_min",
                                                "past_days": 30, "forecast_days": 7}, timeout=20)
        daily = d["daily"]
        q = [v for v in daily["river_discharge"] if v is not None]
        today_idx = 30 if len(daily["time"]) > 30 else len(q) - 1
        return {
            "today_m3s": round(q[today_idx], 1) if q else None,
            "mean_30d_m3s": round(sum(q[:31]) / max(1, len(q[:31])), 1) if q else None,
            "max_30d_m3s": round(max(q[:31]), 1) if q else None,
            "min_30d_m3s": round(min(q[:31]), 1) if q else None,
            "series": [{"date": t, "m3s": v} for t, v in zip(daily["time"], daily["river_discharge"])],
            "grid_lat": d.get("latitude"), "grid_lng": d.get("longitude"),
            "source": "open-meteo-flood (GloFAS v4, 5 km)",
        }
    except Exception:
        return {"today_m3s": None, "mean_30d_m3s": None, "max_30d_m3s": None, "min_30d_m3s": None, "series": [],
                "source": "unavailable"}


def classify_discharge(q: float | None) -> str:
    if q is None:
        return "unknown"
    if q < 2:
        return "negligible"
    if q < 20:
        return "small stream"
    if q < 200:
        return "small river"
    if q < 1000:
        return "medium river"
    return "large river"


def water_scores(waterways: dict, discharge: dict, relief: dict, precip_mm_day: list[float] | None) -> dict:
    """0–100 scores for water availability, run-of-river micro-hydro and pumped-hydro suitability."""
    nearest = waterways.get("nearest")
    dist = nearest["distance_km"] if nearest else 99.0
    q = discharge.get("mean_30d_m3s") or discharge.get("today_m3s") or 0.0
    head = max(relief.get("head_up_m", 0.0), relief.get("head_down_m", 0.0))
    rain = sum(precip_mm_day) / 12 * 365 if precip_mm_day else 0.0  # mm/yr

    # Proximity 0–100
    prox = 100 if dist <= 0.5 else 85 if dist <= 1.5 else 65 if dist <= 3 else 40 if dist <= 6 else 20 if dist <= 10 else 5
    # Flow magnitude 0–100 (log-ish)
    flow = 0 if q <= 0 else 20 if q < 2 else 40 if q < 20 else 65 if q < 200 else 85 if q < 1000 else 100
    # Head 0–100
    head_s = 5 if head < 10 else 25 if head < 25 else 50 if head < 50 else 75 if head < 100 else 95
    # Rainfall 0–100 (>1200 mm = plentiful)
    rain_s = max(0, min(100, rain / 12))

    water_availability = round(0.35 * prox + 0.35 * flow + 0.30 * rain_s)
    micro_hydro = round(0.45 * flow + 0.35 * head_s + 0.20 * prox) if q >= 2 and dist <= 6 else round(0.2 * flow + 0.1 * head_s)
    pumped_hydro = round(0.5 * head_s + 0.25 * (prox if dist <= 6 else 0) + 0.25 * min(100, flow + rain_s / 2))
    hydrogen_water = round(min(100, 40 + 0.6 * water_availability))  # electrolysis needs modest, treatable water

    return {
        "water_availability": water_availability, "micro_hydro": micro_hydro, "pumped_hydro": pumped_hydro,
        "hydrogen_water": hydrogen_water, "nearest_distance_km": dist if nearest else None,
        "discharge_class": classify_discharge(q if q > 0 else None), "head_m": round(head, 1), "rain_mm_yr": round(rain),
    }


async def water_profile(lat: float, lng: float, radius_km: float = 10.0, precip_mm_day: list[float] | None = None) -> dict:
    ww, q, relief = await gather_safe(nearby_waterways(lat, lng, radius_km), river_discharge(lat, lng), terrain_relief(lat, lng, 2.0))
    if not isinstance(ww, dict):
        ww = {"radius_km": radius_km, "source": "unavailable", "count": 0, "rivers": 0, "streams": 0, "lakes": 0, "dams": 0,
              "nearest": None, "nearest_river": None, "features": []}
    if not isinstance(q, dict):
        q = {"today_m3s": None, "mean_30d_m3s": None, "max_30d_m3s": None, "min_30d_m3s": None, "series": [], "source": "unavailable"}
    if q.get("mean_30d_m3s") is None:
        # offline fallback: long-term mean of the nearest known major river within 3 km
        nr = ww.get("nearest_river")
        mean = nr and (nr.get("mean_m3s") or next((r["mean_m3s"] for r in FALLBACK_RIVERS
                                                   if r["name"].replace("River ", "").split(" ")[0] in nr["name"]), None))
        if mean and nr["distance_km"] <= 3.0:
            q = {**q, "mean_30d_m3s": mean, "today_m3s": mean, "source": "fallback:long-term-mean"}
    if not isinstance(relief, dict):
        relief = {"center_m": 0, "min_m": 0, "max_m": 0, "head_up_m": 0, "head_down_m": 0, "relief_m": 0, "radius_km": 2, "source": "unavailable"}
    if precip_mm_day is None:
        precip_mm_day = fallback.model_climatology(lat, lng)["precip_mm_day"]
    scores = water_scores(ww, q, relief, precip_mm_day)
    return {"waterways": ww, "discharge": q, "terrain": relief, "monthly_precip_mm_day": precip_mm_day, "scores": scores}
