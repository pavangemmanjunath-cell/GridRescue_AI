"""Local OSM snapshot: coverage polygon, radius queries and the 50 / 100 km grid scan."""
import asyncio

import pytest

from app.services import osm_snapshot
from app.services.grid import grid_scan

pytestmark = pytest.mark.skipif(not osm_snapshot.PATH.exists(), reason="snapshot not built")


def test_coverage_follows_the_extract_boundary():
    assert osm_snapshot.covers(9.0765, 7.3986)      # Abuja
    assert osm_snapshot.covers(12.0, 8.52)          # Kano
    assert not osm_snapshot.covers(11.2646, 3.1036)  # Kandi, Benin — inside the lat/lng box, outside Nigeria
    assert not osm_snapshot.covers(51.5, -0.12)


def test_radius_queries_are_sorted_and_bounded():
    p = osm_snapshot.power(9.0765, 7.3986, 50)
    assert p["substations"] and all(s["distance_km"] <= 50 for s in p["substations"])
    assert [s["distance_km"] for s in p["substations"]] == sorted(s["distance_km"] for s in p["substations"])
    f = osm_snapshot.facilities(9.0765, 7.3986, 25)
    assert any(x["type"] == "hospital" for x in f)
    assert any("Niger" in w["name"] for w in osm_snapshot.waterways(7.8023, 6.7333, 10))   # Lokoja confluence


def test_scan_rings_nest():
    r = asyncio.run(grid_scan(9.0765, 7.3986, "NG", "NG-FC"))
    r50, r100 = r["rings"]
    assert (r50["radius_km"], r100["radius_km"]) == (50, 100)
    assert r50["power"]["summary"]["substations"] <= r100["power"]["summary"]["substations"]
    assert 0 <= r50["reliability"]["reliability_score"] <= 100
