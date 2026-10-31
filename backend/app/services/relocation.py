"""Where should the new building go? A grid lens over the area around a hospital that is moving (Brief 12).

Drops search points on rings around today's site and reads the same OpenStreetMap power data the explorer's grid
scan uses (local Nigeria snapshot: milliseconds). Each point is scored on how close it is to a substation and a
power line, whether a high-voltage substation is in reach, and how far the move is. The points are areas to look
for a plot — not plots that are known to be free.
"""
from __future__ import annotations

from app.core.geo import bearing_deg, compass, haversine_km, offset_point
from app.core.http import gather_safe
from app.services import osm_snapshot
from app.services.grid import nearby_power

BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315]
RINGS_KM = [4, 8, 12]


def _interp(x: float, pts: list[tuple[float, float]]) -> float:
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def score_point(power: dict, move_km: float) -> dict:
    s = power["summary"]
    sub_km = s.get("nearest_substation_km")
    line_km = s.get("nearest_line_km")
    hv_near = [x for x in power["substations"] if (x.get("voltage_kv") or 0) >= 110]
    sub_s = _interp(sub_km, [(1, 100), (3, 85), (6, 60), (10, 35), (20, 10)]) if sub_km is not None else 5
    line_s = _interp(line_km, [(0.5, 100), (2, 80), (5, 50), (10, 15)]) if line_km is not None else 5
    hv_s = 100 if hv_near else 30
    grid = 0.5 * sub_s + 0.3 * line_s + 0.2 * hv_s
    move = _interp(move_km, [(0, 100), (5, 95), (10, 70), (15, 40), (25, 10)])
    total = round(0.75 * grid + 0.25 * move)
    nearest = power["substations"][0] if power["substations"] else None
    reasons = []
    if nearest:
        kv = nearest.get("voltage_kv") or 0
        named = nearest.get("name") and not nearest["name"].startswith("unnamed")
        reasons.append(f"{f'{kv:g} kV ' if kv else ''}substation {sub_km:.1f} km away" + (f" ({nearest['name']})" if named else "")
                       + (" — short run for a dedicated feeder" if sub_km <= 3 else ""))
    if line_km is not None:
        reasons.append(f"power line {line_km:.1f} km away")
    if hv_near:
        reasons.append(f"high-voltage substation within {power['radius_km']:.0f} km")
    if move_km > 0.05:
        reasons.append(f"{move_km:.0f} km move from today's site")
    return {"score": total, "grid_score": round(grid), "move_score": round(move), "nearest_substation_km": sub_km, "nearest_line_km": line_km,
            "hv_within_radius": bool(hv_near), "reasons": reasons,
            "label": "Strong" if total >= 75 else "Good" if total >= 60 else "Fair" if total >= 45 else "Weak"}


async def suggest_sites(lat: float, lng: float, radius_km: float = 15.0, top: int = 5) -> dict:
    local = osm_snapshot.covers(lat, lng)
    rings = RINGS_KM if local else [8]   # outside the snapshot every point is a live Overpass call: keep it small
    points = [(0.0, 0, lat, lng)] + [(d, b, *offset_point(lat, lng, d, b)) for d in rings for b in BEARINGS]

    async def look(p):
        d, b, la, ln = p
        pw = osm_snapshot.power(la, ln, radius_km, min(radius_km, 10)) if local else await nearby_power(la, ln, radius_km)
        return {"lat": round(la, 4), "lng": round(ln, 4), "distance_km": round(d, 1), "direction": compass(b) if d else "today's site",
                **score_point(pw, haversine_km(lat, lng, la, ln))}

    results = [r for r in await gather_safe(*[look(p) for p in points]) if isinstance(r, dict)]
    today = next((r for r in results if r["distance_km"] == 0), None)
    cands = sorted([r for r in results if r["distance_km"] > 0], key=lambda r: -r["score"])
    for i, c in enumerate(cands, 1):
        c["rank"] = i
        c["bearing_from_today"] = compass(bearing_deg(lat, lng, c["lat"], c["lng"]))
    return {"center": {"lat": lat, "lng": lng}, "today": today, "candidates": cands, "top": cands[:top], "radius_km": radius_km,
            "source": osm_snapshot.label() if local else "openstreetmap-overpass",
            "note": "Areas to look for a plot, scored on grid access and move distance — confirm land, title and access on the ground."}
