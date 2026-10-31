"""Critical health facilities near a point: OSM hospitals/clinics (Overpass) with a curated
Nigerian tertiary-hospital fallback. Healthsites.io mirrors the same OSM data."""
from __future__ import annotations

import json

from app.config import DATA_DIR
from app.core.cache import cached
from app.core.geo import bearing_deg, compass, haversine_km
from app.services import osm_snapshot
from app.services.overpass import elem_latlng, run_query
from app.services.health_providers import external_near, featured, healthsites_near

_CURATED = json.loads((DATA_DIR / "nigeria_hospitals.json").read_text(encoding="utf-8"))["facilities"]


def _query(lat: float, lng: float, radius_m: int) -> str:
    return (
        f'[out:json][timeout:30];('
        f'node["amenity"~"^(hospital|clinic)$"](around:{radius_m},{lat},{lng});'
        f'way["amenity"~"^(hospital|clinic)$"](around:{radius_m},{lat},{lng});'
        f'relation["amenity"="hospital"](around:{radius_m},{lat},{lng});'
        f');out center tags qt 150;'
    )


def curated_near(lat: float, lng: float, radius_km: float) -> list[dict]:
    out = []
    for f in featured():
        d = haversine_km(lat, lng, f["lat"], f["lng"])
        if d <= radius_km:
            out.append({**f, "id": f"curated/{f['name']}", "type": "hospital", "distance_km": round(d, 2), "bearing": compass(bearing_deg(lat, lng, f["lat"], f["lng"])),
                        "emergency": True, "beds": f.get("beds"), "operator": f.get("operator") or "Public (teaching / referral)", "precision": "city", "provider": "curated"})
    out.sort(key=lambda f: f["distance_km"])
    return out


@cached("osm_health_v2", ttl=7 * 86400)
async def nearby_facilities(lat: float, lng: float, radius_km: float = 25.0) -> dict:
    items: list[dict] = []
    source = "openstreetmap-overpass"
    providers_used: list[str] = []
    try:
        if osm_snapshot.covers(lat, lng):   # local snapshot first: instant
            items, source = osm_snapshot.facilities(lat, lng, radius_km), osm_snapshot.label()
            providers_used.append("osm_snapshot")
        elems = [] if items else await run_query(_query(lat, lng, int(radius_km * 1000)))
        if elems:
            providers_used.append("osm_overpass")
        for e in elems:
            tags = e.get("tags", {})
            pos = elem_latlng(e)
            if not pos:
                continue
            beds = tags.get("beds")
            try:
                beds = int(beds) if beds else None
            except ValueError:
                beds = None
            items.append({
                "id": f"{e.get('type')}/{e.get('id')}", "name": tags.get("name") or tags.get("name:en") or f"unnamed {tags.get('amenity')}",
                "type": tags.get("amenity"), "tier": "tertiary" if "teaching" in (tags.get("name") or "").lower() else
                        ("secondary" if tags.get("amenity") == "hospital" else "primary"),
                "lat": pos[0], "lng": pos[1], "distance_km": round(haversine_km(lat, lng, *pos), 2),
                "bearing": compass(bearing_deg(lat, lng, *pos)), "emergency": tags.get("emergency") == "yes",
                "beds": beds, "operator": tags.get("operator") or tags.get("operator:type"), "precision": "osm",
                "healthcare": tags.get("healthcare"), "phone": tags.get("phone") or tags.get("contact:phone"),
            })
    except Exception:
        source = "fallback:curated"
        try:
            hs = await healthsites_near(lat, lng, radius_km)
            if hs:
                items = hs
                source = "healthsites.io"
                providers_used.append("healthsites_io")
        except Exception:
            pass
    ext = external_near(lat, lng, radius_km)
    if ext:
        providers_used.append("external-csv")
    curated = curated_near(lat, lng, radius_km)
    if curated:
        providers_used.append("curated")
    names = {i["name"].lower() for i in items}
    for extra in ext + curated:
        if extra["name"].lower() not in names:
            items.append(extra)
            names.add(extra["name"].lower())
    items.sort(key=lambda f: f["distance_km"])
    hospitals = [i for i in items if i["type"] == "hospital"]
    return {"radius_km": radius_km, "source": source, "providers": providers_used, "count": len(items), "hospitals": len(hospitals),
            "clinics": len(items) - len(hospitals), "nearest": items[0] if items else None,
            "nearest_hospital": hospitals[0] if hospitals else None, "facilities": items[:150]}
