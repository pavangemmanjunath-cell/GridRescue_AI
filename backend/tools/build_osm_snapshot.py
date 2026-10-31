"""Build the offline OSM snapshot used by the fast grid / hospital / river scan.

    pip install osmium
    curl -L -o nigeria-latest.osm.pbf https://download.geofabrik.de/africa/nigeria-latest.osm.pbf
    curl -L -o nigeria.poly https://download.geofabrik.de/africa/nigeria.poly
    python tools/build_osm_snapshot.py nigeria-latest.osm.pbf nigeria.poly

Writes app/data/osm_ng.json: substations, power plants, power lines, hospitals/clinics and named rivers
from OpenStreetMap (© OpenStreetMap contributors, ODbL). Two passes keep memory low: pass 1 keeps tagged
nodes and the node ids of tagged ways, pass 2 looks up only those node coordinates.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import osmium

OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "osm_ng.json"


def kv(tag: str | None) -> float:
    try:
        v = max(float(x) for x in re.findall(r"\d+(?:\.\d+)?", tag or ""))
        return round(v / 1000 if v > 1000 else v, 1)
    except ValueError:
        return 0.0


def mw(tags) -> float:
    m = re.search(r"([\d.]+)\s*(MW|kW|GW)?", tags.get("plant:output:electricity", ""), re.I)
    if not m:
        return 0.0
    v, u = float(m.group(1)), (m.group(2) or "MW").upper()
    return round(v / 1000 if u == "KW" else v * 1000 if u == "GW" else v, 1)


def kind(tags) -> str | None:
    if tags.get("power") in ("substation", "plant", "line"):
        return tags["power"]
    if tags.get("amenity") in ("hospital", "clinic") or tags.get("healthcare") in ("hospital", "clinic", "centre"):
        return "hospital" if "hospital" in (tags.get("amenity"), tags.get("healthcare")) else "clinic"
    if tags.get("waterway") == "river" and tags.get("name"):
        return "river"
    if tags.get("waterway") == "dam":
        return "dam"
    if tags.get("natural") == "water" and tags.get("water") in ("lake", "reservoir") and tags.get("name"):
        return "lake"
    return None


WANTED = osmium.filter.TagFilter(
    ("power", "substation"), ("power", "plant"), ("power", "line"), ("amenity", "hospital"), ("amenity", "clinic"),
    ("healthcare", "hospital"), ("healthcare", "clinic"), ("healthcare", "centre"),
    ("waterway", "river"), ("waterway", "dam"), ("natural", "water"))


def pass1(pbf: str):
    """Tagged nodes (with location) and tagged ways (node ids only); the tag filter runs in C++."""
    points, ways, need = [], [], set()
    for o in osmium.FileProcessor(pbf, osmium.osm.NODE | osmium.osm.WAY).with_filter(WANTED):
        k = kind(o.tags)
        if not k:
            continue
        if o.is_node():
            if k not in ("line", "river"):
                points.append((k, o.location.lat, o.location.lon, dict(o.tags)))
        else:
            refs = [r.ref for r in o.nodes]
            if k in ("line", "river") and len(refs) > 60:   # keep shape, drop density
                refs = refs[::len(refs) // 60 + 1] + [refs[-1]]
            ways.append((k, refs, dict(o.tags)))
            need.update(refs)
    return points, ways, need


def pass2(pbf: str, need: set) -> dict:
    """Coordinates of just the nodes the kept ways reference (C++ id filter)."""
    return {n.id: (round(n.location.lat, 4), round(n.location.lon, 4))
            for n in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(osmium.filter.IdFilter(need))}

def read_poly(path: str) -> list[list[float]]:
    """Geofabrik .poly clipping boundary (lon lat per line) → [[lat, lng], ...] — the area the snapshot covers."""
    pts = []
    for line in Path(path).read_text().splitlines():
        p = line.split()
        if len(p) == 2:
            try:
                pts.append([round(float(p[1]), 3), round(float(p[0]), 3)])
            except ValueError:
                pass
    return pts


def main(pbf: str, poly: str) -> None:
    points, ways, need = pass1(pbf)
    loc = pass2(pbf, need)
    out = {"substations": [], "plants": [], "lines": [], "facilities": [], "rivers": [], "lakes": []}

    def add(k, lat, lng, t):
        name = t.get("name:en") or t.get("name") or t.get("operator") or ""
        if k == "substation":
            out["substations"].append([round(lat, 4), round(lng, 4), kv(t.get("voltage")), name])
        elif k == "plant":
            out["plants"].append([round(lat, 4), round(lng, 4), mw(t), t.get("plant:source", ""), name])
        elif k in ("hospital", "clinic"):
            beds = re.findall(r"\d+", t.get("beds", ""))
            out["facilities"].append([round(lat, 4), round(lng, 4), k, name, int(beds[0]) if beds else None])
        elif k in ("lake", "dam"):
            out["lakes"].append([round(lat, 4), round(lng, 4), t.get("water", k), name])

    for k, lat, lng, t in points:
        add(k, lat, lng, t)
    for k, refs, t in ways:
        pts = [loc[r] for r in refs if r in loc]
        if not pts:
            continue
        if k == "line":
            out["lines"].append([kv(t.get("voltage")), t.get("name:en") or t.get("name", ""), pts])
        elif k == "river":
            out["rivers"].append([t.get("name:en") or t["name"], pts])
        else:   # area feature → centroid of its outline
            add(k, sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), t)

    out["boundary"] = read_poly(poly)
    out["meta"] = {"source": "OpenStreetMap via Geofabrik Nigeria extract (ODbL)", "file": Path(pbf).name,
                   "counts": {k: len(v) for k, v in out.items() if isinstance(v, list)}}
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(OUT, f"{OUT.stat().st_size / 1e6:.1f} MB", out["meta"]["counts"])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
