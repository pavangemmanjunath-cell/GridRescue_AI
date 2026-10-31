"""The organisers' open data and tools: the grid-first feeder load flow, the grid as GeoJSON for QGIS, the source list."""
import math

from app.services.feeder import CONDUCTORS, feeder_check
from app.services.open_data import grid_geojson

NOHE = {"lat": 6.4684, "lng": 7.5256}


def test_feeder_load_flow_matches_the_textbook_drop():
    # short line: the exact solution is close to the first-order drop (P·R + Q·X) / V²
    c, d, kw, kv = CONDUCTORS[11], 1.57, 641, 11
    p = kw / 1000; q = p * math.tan(math.acos(0.9))
    approx = 100 * (p * c["r"] * d + q * c["x"] * d) / kv ** 2
    r = feeder_check(d, kw, kv)
    assert r["ok"] and abs(r["drop_pct"] - approx) < 0.05
    assert 0 < r["loading_pct"] < 20 and r["losses_kw"] > 0


def test_long_11kv_feeder_fails_where_33kv_passes():
    assert not feeder_check(25, 1550, 11)["ok"]
    assert feeder_check(25, 1550, 33)["ok"]


def test_feeder_endpoint_uses_the_nearest_mapped_substation(client):
    r = client.get("/api/grid/feeder", params={**NOHE, "kw": 641, "kw_connected": 1550})
    assert r.status_code == 200
    d = r.json()
    assert d["substation"]["distance_km"] > 0
    assert {c["kv"] for c in d["checks"]} == {11, 33} and len(d["checks"]) == 4
    assert all("text" in c for c in d["checks"])


def test_grid_geojson_for_qgis(client):
    r = client.get("/api/grid/geojson", params=NOHE)
    assert r.status_code == 200 and "geo+json" in r.headers["content-type"]
    fc = r.json()
    kinds = {f["properties"]["kind"] for f in fc["features"]}
    assert fc["type"] == "FeatureCollection" and {"site", "substation", "line"} <= kinds
    pt = next(f for f in fc["features"] if f["properties"]["kind"] == "site")
    assert pt["geometry"]["coordinates"] == [NOHE["lng"], NOHE["lat"]]   # GeoJSON is lon, lat


def test_geojson_swaps_lat_lng_on_lines():
    fc = grid_geojson({"lines": [{"geometry": [[6.0, 7.0], [6.1, 7.1]], "voltage_kv": 33}]}, {"lat": 6, "lng": 7})
    line = next(f for f in fc["features"] if f["properties"]["kind"] == "line")
    assert line["geometry"]["coordinates"] == [[7.0, 6.0], [7.1, 6.1]]


def test_sources_list_covers_the_organisers_tools(client):
    names = {s["name"] for s in client.get("/api/sources").json()["sources"]}
    for n in ("NLR PVWatts API", "NASA POWER", "Global Solar Atlas", "World Bank ENERGYDATA.INFO", "pandapower", "QGIS", "OpenStreetMap"):
        assert n in names
