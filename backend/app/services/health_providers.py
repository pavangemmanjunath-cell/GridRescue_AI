"""Health-facility data providers for Africa — registry, optional live connectors and CSV loaders.

Providers (who provides what):
  1. OpenStreetMap / Overpass API      live, keyless, global. amenity=hospital|clinic (services.facilities)
  2. healthsites.io API v3             live, free API key, global (OSM-synced, HXL tags).  GR_HEALTHSITES_API_KEY
  3. WHO / KEMRI-Wellcome Trust SSA    CSV: "A spatial database of health facilities managed by the public health
     public health facilities (2019)   sector in sub-Saharan Africa" (Maina et al., Sci Data 2019; 98,745 facilities)
                                       https://data.humdata.org/dataset/health-facilities-in-sub-saharan-africa
  4. GRID3 Nigeria Health Facilities   CSV/GeoJSON from https://data.grid3.org (Nigeria, ~40k facilities, v2.0)
  5. Nigeria Health Facility Registry  CSV export from https://hfr.fmohconnect.gov.ng / NCDC data portal
  6. HOT OSM Nigeria export (HDX)      https://data.humdata.org/dataset/hotosm_nga_health_facilities
Drop any downloaded CSV into backend/app/data/external/ (see EXTERNAL_FILES) and it is merged automatically.
"""
from __future__ import annotations

import csv
import json
import logging
import os
from functools import lru_cache
from pathlib import Path

from app.config import DATA_DIR
from app.core.cache import cached
from app.core.geo import bearing_deg, compass, haversine_km, in_africa
from app.core.http import fetch_json

log = logging.getLogger("gridrescue.health")

EXTERNAL_DIR = DATA_DIR / "external"
HEALTHSITES_URL = "https://healthsites.io/api/v3/facilities/"

EXTERNAL_FILES = {
    "who_kemri_ssa": {"file": "ssa_health_facilities.csv", "lat": ["Lat", "lat", "latitude"], "lng": ["Long", "lon", "lng", "longitude"],
                      "name": ["Facility name", "Facility_n", "name"], "type": ["Facility type", "Facility_t", "type"], "country": ["Country", "country"]},
    "grid3_nigeria": {"file": "grid3_nga_health_facilities.csv", "lat": ["latitude", "lat", "Latitude"], "lng": ["longitude", "lng", "Longitude"],
                      "name": ["name", "prmry_name", "facility_name"], "type": ["type", "category", "func_stats"], "country": []},
    "nhfr_nigeria": {"file": "nhfr_facilities.csv", "lat": ["latitude", "Latitude"], "lng": ["longitude", "Longitude"],
                     "name": ["facility_name", "name"], "type": ["facility_level", "type"], "country": []},
    "hotosm_nigeria": {"file": "hotosm_nga_health_facilities.csv", "lat": ["latitude", "lat"], "lng": ["longitude", "lon"],
                       "name": ["name"], "type": ["amenity", "healthcare"], "country": []},
}

PROVIDERS = [
    {"id": "osm_overpass", "name": "OpenStreetMap — Overpass API", "coverage": "Global (Africa well mapped via HOT/Healthsites)", "access": "live · no key",
     "license": "ODbL", "url": "https://wiki.openstreetmap.org/wiki/Overpass_API", "fields": "name, amenity, beds, operator, emergency, phone", "role": "primary live source"},
    {"id": "healthsites_io", "name": "healthsites.io API v3", "coverage": "Global, OSM-synced; HXL tags", "access": "live · free API key (GR_HEALTHSITES_API_KEY)",
     "license": "ODbL", "url": "https://healthsites.io/api/docs/", "fields": "geojson facilities by country/extent", "role": "live alternative when Overpass is slow"},
    {"id": "who_kemri_ssa", "name": "WHO / KEMRI-Wellcome — Public health facilities in sub-Saharan Africa (Maina et al. 2019)", "coverage": "50 countries, 98,745 facilities",
     "access": "CSV download (HDX / figshare)", "license": "CC BY 4.0", "url": "https://data.humdata.org/dataset/health-facilities-in-sub-saharan-africa", "fields": "name, type, admin1, lat/long, ownership", "role": "offline master list (drop CSV in data/external)"},
    {"id": "grid3_nigeria", "name": "GRID3 Nigeria — Health Facilities v2.0", "coverage": "Nigeria (~40,000 facilities)", "access": "CSV/GeoJSON download (ArcGIS Hub)",
     "license": "CC BY 4.0", "url": "https://data.grid3.org/maps/GRID3::grid3-nga-health-facilities-v2-0", "fields": "name, category (primary/secondary/tertiary), ownership, LGA, state", "role": "Nigeria master list"},
    {"id": "nhfr_nigeria", "name": "Nigeria Health Facility Registry (FMoH / NCDC data portal)", "coverage": "Nigeria (official registry)", "access": "CSV export / CKAN portal",
     "license": "Open Government Data", "url": "https://hfr.fmohconnect.gov.ng/", "fields": "facility level, ownership, services, coordinates (partial)", "role": "official validation"},
    {"id": "hotosm_nigeria", "name": "HOT OSM — Nigeria Health Facilities export (HDX)", "coverage": "Nigeria", "access": "CSV/GeoJSON download",
     "license": "ODbL", "url": "https://data.humdata.org/dataset/hotosm_nga_health_facilities", "fields": "OSM tags", "role": "bulk OSM snapshot"},
    {"id": "curated", "name": "GridRescue curated tertiary hospitals (Nigeria + Africa)", "coverage": "40 Nigerian federal hospitals + 37 African referral hospitals", "access": "bundled",
     "license": "CC0 (compiled from public sources)", "url": "bundled", "fields": "name, city, beds, tier", "role": "demo fallback with bed counts"},
]

_AFRICA = json.loads((DATA_DIR / "africa_hospitals.json").read_text(encoding="utf-8"))["facilities"]
_NIGERIA = json.loads((DATA_DIR / "nigeria_hospitals.json").read_text(encoding="utf-8"))["facilities"]


def provider_status() -> list[dict]:
    out = []
    for p in PROVIDERS:
        status = "bundled"
        if p["id"] == "osm_overpass":
            status = "live"
        elif p["id"] == "healthsites_io":
            status = "live" if os.environ.get("GR_HEALTHSITES_API_KEY") else "needs API key"
        elif p["id"] in EXTERNAL_FILES:
            status = "installed" if (EXTERNAL_DIR / EXTERNAL_FILES[p["id"]]["file"]).exists() else "not installed (download CSV)"
        out.append({**p, "status": status})
    return out


def featured(country_code: str | None = None) -> list[dict]:
    """Curated featured hospitals (Nigeria first, then Africa)."""
    ng = [{**f, "country": "Nigeria", "country_code": "NG", "id": f"curated/{f['name']}", "precision": "city"} for f in _NIGERIA]
    af = [{**f, "id": f"curated/{f['name']}", "type": "hospital", "precision": "city"} for f in _AFRICA]
    items = ng + af
    if country_code:
        items = [i for i in items if i["country_code"] == country_code.upper()]
    return items


@lru_cache(maxsize=8)
def _load_external(provider_id: str) -> list[dict]:
    spec = EXTERNAL_FILES[provider_id]
    path: Path = EXTERNAL_DIR / spec["file"]
    if not path.exists():
        return []
    rows: list[dict] = []

    def pick(row: dict, keys: list[str]) -> str | None:
        for k in keys:
            if k in row and row[k] not in (None, ""):
                return row[k]
        return None

    try:
        with path.open(encoding="utf-8", errors="ignore", newline="") as fh:
            for row in csv.DictReader(fh):
                try:
                    lat = float(pick(row, spec["lat"]) or "nan")
                    lng = float(pick(row, spec["lng"]) or "nan")
                except ValueError:
                    continue
                if lat != lat or lng != lng:
                    continue
                name = pick(row, spec["name"]) or "unnamed facility"
                ftype = (pick(row, spec["type"]) or "").lower()
                rows.append({"name": name, "lat": lat, "lng": lng, "raw_type": ftype,
                             "type": "hospital" if "hosp" in ftype or "tertiary" in ftype or "secondary" in ftype else "clinic",
                             "tier": "tertiary" if "tertiary" in ftype or "teaching" in name.lower() else "secondary" if "hosp" in ftype or "secondary" in ftype else "primary",
                             "country": pick(row, spec["country"]) if spec["country"] else None, "provider": provider_id, "precision": "dataset"})
    except Exception as exc:
        log.warning("failed to load %s: %s", path, exc)
    log.info("loaded %d facilities from %s", len(rows), path.name)
    return rows


def external_near(lat: float, lng: float, radius_km: float) -> list[dict]:
    out = []
    for pid in EXTERNAL_FILES:
        for f in _load_external(pid):
            d = haversine_km(lat, lng, f["lat"], f["lng"])
            if d <= radius_km:
                out.append({**f, "id": f"{pid}/{f['name']}", "distance_km": round(d, 2), "bearing": compass(bearing_deg(lat, lng, f["lat"], f["lng"]))})
    out.sort(key=lambda f: f["distance_km"])
    return out


@cached("healthsites", ttl=7 * 86400)
async def healthsites_near(lat: float, lng: float, radius_km: float) -> list[dict]:
    key = os.environ.get("GR_HEALTHSITES_API_KEY")
    if not key:
        return []
    d = radius_km / 111.0
    extent = f"{lng - d},{lat - d},{lng + d},{lat + d}"
    items: list[dict] = []
    try:
        for page in (1, 2):
            data = await fetch_json(HEALTHSITES_URL, params={"api-key": key, "page": page, "extent": extent, "output": "geojson", "flat-properties": "true"}, timeout=20)
            feats = data.get("features", []) if isinstance(data, dict) else []
            for f in feats:
                geom = f.get("geometry", {})
                coords = geom.get("coordinates") or []
                if len(coords) < 2:
                    continue
                p = f.get("properties", {})
                flat = {**p, **(p.get("attributes") or {})}
                amenity = (flat.get("amenity") or flat.get("healthcare") or "clinic").lower()
                dist = haversine_km(lat, lng, coords[1], coords[0])
                if dist > radius_km:
                    continue
                items.append({"id": f"healthsites/{flat.get('osm_id') or flat.get('uuid') or len(items)}", "name": flat.get("name") or f"unnamed {amenity}", "type": "hospital" if amenity == "hospital" else "clinic",
                              "tier": "secondary" if amenity == "hospital" else "primary", "lat": coords[1], "lng": coords[0], "distance_km": round(dist, 2),
                              "bearing": compass(bearing_deg(lat, lng, coords[1], coords[0])), "beds": flat.get("beds"), "operator": flat.get("operator"), "precision": "osm", "provider": "healthsites_io"})
            if len(feats) < 100:
                break
    except Exception as exc:
        log.warning("healthsites failed: %s", exc)
    return items


def africa_flag(lat: float, lng: float) -> bool:
    return in_africa(lat, lng)
