"""Local OpenStreetMap snapshot for Nigeria (built by tools/build_osm_snapshot.py from the Geofabrik extract).

Answers the grid / hospital / river radius queries in milliseconds, so the explorer does not wait on the
public Overpass servers (often 30–130 s or down). Sites outside the snapshot fall back to live Overpass.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache

from app.config import DATA_DIR
from app.core.geo import bearing_deg, compass, haversine_km, polyline_min_distance_km

PATH = DATA_DIR / "osm_ng.json"


@lru_cache(maxsize=1)
def _data() -> dict | None:
    if not PATH.exists():
        return None
    d = json.loads(PATH.read_text(encoding="utf-8"))
    cells: dict = {}
    for layer in ("substations", "plants", "facilities", "lakes"):
        for row in d[layer]:
            cells.setdefault((layer, math.floor(row[0]), math.floor(row[1])), []).append(row)
    for layer, idx in (("lines", 2), ("rivers", 1)):
        for row in d[layer]:
            for c in {(math.floor(a), math.floor(b)) for a, b in row[idx]}:
                cells.setdefault((layer, *c), []).append(row)
    d["_cells"] = cells
    return d


def label() -> str:
    d = _data()
    return "osm-snapshot" if d else "unavailable"


def covers(lat: float, lng: float) -> bool:
    """Inside the Geofabrik clipping polygon of the extract (ray casting) — Benin / Niger / Cameroon go live."""
    d = _data()
    poly = d.get("boundary") if d else None
    if not poly:
        return False
    inside, j = False, len(poly) - 1
    for i, (yi, xi) in enumerate(poly):
        yj, xj = poly[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _near(layer: str, lat: float, lng: float, radius_km: float) -> list:
    cells = _data()["_cells"]
    dlat = radius_km / 111.0
    dlng = radius_km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    seen, out = set(), []
    for a in range(math.floor(lat - dlat), math.floor(lat + dlat) + 1):
        for b in range(math.floor(lng - dlng), math.floor(lng + dlng) + 1):
            for row in cells.get((layer, a, b), []):
                if id(row) not in seen:
                    seen.add(id(row))
                    out.append(row)
    return out


def _pt(lat, lng, la, ln) -> dict:
    return {"lat": la, "lng": ln, "distance_km": round(haversine_km(lat, lng, la, ln), 2), "bearing": compass(bearing_deg(lat, lng, la, ln))}


def power(lat: float, lng: float, radius_km: float, lines_km: float = 20.0) -> dict:
    subs = [{"id": f"sub/{r[0]},{r[1]}", "name": r[3] or "unnamed substation", "voltage_kv": r[2], "operator": None, **_pt(lat, lng, r[0], r[1])}
            for r in _near("substations", lat, lng, radius_km)]
    plants = [{"id": f"plant/{r[0]},{r[1]}", "name": r[4] or "unnamed plant", "capacity_mw": r[2], "source": r[3], "operator": None, **_pt(lat, lng, r[0], r[1])}
              for r in _near("plants", lat, lng, radius_km)]
    lines = []
    for r in _near("lines", lat, lng, lines_km):
        d = polyline_min_distance_km(lat, lng, r[2])
        if d <= lines_km:
            lines.append({"id": f"line/{len(lines)}", "name": r[1], "voltage_kv": r[0], "operator": None, "distance_km": round(d, 2), "geometry": r[2]})
    subs = sorted((s for s in subs if s["distance_km"] <= radius_km), key=lambda s: s["distance_km"])
    plants = sorted((p for p in plants if p["distance_km"] <= radius_km), key=lambda p: p["distance_km"])
    lines.sort(key=lambda l: l["distance_km"])
    subs, plants, lines = subs[:300], plants[:60], lines[:60]
    return {"radius_km": radius_km, "source": label(), "substations": subs, "plants": plants, "lines": lines, "summary": summary(subs, plants, lines)}


def summary(subs: list, plants: list, lines: list) -> dict:
    return {"substations": len(subs), "plants": len(plants), "lines": len(lines),
            "hv_substations": len([s for s in subs if s.get("voltage_kv", 0) >= 110]),
            "max_voltage_kv": max([s.get("voltage_kv", 0) for s in subs] + [l.get("voltage_kv", 0) for l in lines] + [0]),
            "plant_capacity_mw": round(sum(p.get("capacity_mw", 0) for p in plants), 1),
            "nearest_substation_km": subs[0]["distance_km"] if subs else None,
            "nearest_line_km": lines[0]["distance_km"] if lines else None}


def facilities(lat: float, lng: float, radius_km: float) -> list[dict]:
    out = []
    for r in _near("facilities", lat, lng, radius_km):
        p = _pt(lat, lng, r[0], r[1])
        if p["distance_km"] <= radius_km:
            name = r[3] or f"unnamed {r[2]}"
            out.append({"id": f"osm/{r[0]},{r[1]}", "name": name, "type": r[2],
                        "tier": "tertiary" if "teaching" in name.lower() else ("secondary" if r[2] == "hospital" else "primary"),
                        "emergency": False, "beds": r[4], "operator": None, "precision": "osm", **p})
    return sorted(out, key=lambda f: f["distance_km"])


def waterways(lat: float, lng: float, radius_km: float) -> list[dict]:
    out = []
    for r in _near("rivers", lat, lng, radius_km):
        d = polyline_min_distance_km(lat, lng, r[1])
        if d <= radius_km:
            mid = r[1][len(r[1]) // 2]
            out.append({"id": f"river/{r[0]}/{len(out)}", "name": r[0], "kind": "river", "distance_km": round(d, 2),
                        "bearing": compass(bearing_deg(lat, lng, *mid)), "intermittent": False, "width_m": None,
                        "geometry": r[1], "lat": None, "lng": None})
    for r in _near("lakes", lat, lng, radius_km):
        p = _pt(lat, lng, r[0], r[1])
        if p["distance_km"] <= radius_km:
            out.append({"id": f"{r[2]}/{r[0]},{r[1]}", "name": r[3] or f"unnamed {r[2]}", "kind": r[2],
                        "intermittent": False, "width_m": None, "geometry": None, **p})
    return sorted(out, key=lambda f: f["distance_km"])
