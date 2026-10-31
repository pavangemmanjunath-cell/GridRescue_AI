"""Location endpoints: reverse geocode, place search, Nigeria states."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.geo import in_africa, in_nigeria
from app.core.http import gather_safe
from app.services.geocode import NIGERIA_STATES, STATE_CLASSES, elevation, reverse_geocode, search_places

router = APIRouter(tags=["location"])


@router.get("/location", summary="Reverse-geocode a coordinate (+ elevation, Nigerian state, region flags)")
async def get_location(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180)):
    geo, elev = await gather_safe(reverse_geocode(lat, lng), elevation(lat, lng))
    if not isinstance(geo, dict):
        from app.services.geocode import _fallback_place
        geo = _fallback_place(lat, lng)
    if not isinstance(elev, (int, float)):
        elev = 0.0
    st = None
    if geo.get("country_code") == "NG" and geo.get("state_iso"):
        st = next((s for s in NIGERIA_STATES if s["iso"] == geo["state_iso"]), None)
    return {
        **geo, "lat": lat, "lng": lng, "elevation_m": int(round(elev)),
        "in_africa": in_africa(lat, lng), "in_nigeria": in_nigeria(lat, lng),
        "grid_class": st["grid_class"] if st else None,
        "grid_class_meta": STATE_CLASSES[st["grid_class"]] if st else None,
        "disco": st["disco"] if st else None, "zone": st["zone"] if st else None,
    }


@router.get("/geocode", summary="Search places by name (Africa results first)")
async def geocode(q: str = Query(..., min_length=2, max_length=80), count: int = Query(6, ge=1, le=15)):
    return {"query": q, "results": await search_places(q, count)}


@router.get("/states", summary="Nigeria states with DisCo and grid-reliability class")
async def states():
    return {"classes": STATE_CLASSES, "states": NIGERIA_STATES}
