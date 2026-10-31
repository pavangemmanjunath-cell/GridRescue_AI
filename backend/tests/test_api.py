"""API tests (offline mode → fallbacks and snapshots)."""
from tests.conftest import ABUJA, LOKOJA


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_location_nigeria_state(client):
    j = client.get("/api/location", params=ABUJA).json()
    assert j["country_code"] == "NG" and j["in_nigeria"] and j["grid_class"] in "ABCDE"


def test_geocode_fallback(client):
    j = client.get("/api/geocode", params={"q": "Kano"}).json()
    assert j["results"] and j["results"][0]["country_code"] == "NG"


def test_sun_wind_weather(client):
    s = client.get("/api/sun", params=ABUJA).json()
    assert len(s["monthly_psh"]) == 12 and 3 < s["annual_psh"] < 7
    w = client.get("/api/wind", params=ABUJA).json()
    assert len(w["wind_rose"]) == 8 and abs(sum(x["frequency_pct"] for x in w["wind_rose"]) - 100) < 2
    wx = client.get("/api/weather", params=ABUJA).json()
    assert "forecast" in wx


def test_water_lokoja_has_river(client):
    j = client.get("/api/water", params=LOKOJA).json()
    assert "Niger" in j["waterways"]["nearest"]["name"]
    assert j["scores"]["water_availability"] >= 50


def test_grid_and_facilities(client):
    g = client.get("/api/grid", params=ABUJA).json()
    assert g["reliability"]["grid_class"] == "B" and 0 <= g["reliability"]["reliability_score"] <= 100
    g2 = client.get("/api/grid", params={**ABUJA, "grid_class": "E"}).json()
    assert g2["reliability"]["grid_class"] == "E" and g2["reliability"]["override"]
    f = client.get("/api/facilities", params=ABUJA).json()
    assert f["count"] >= 1 and f["hospitals"] >= 1


def test_hourly_and_technologies(client):
    h = client.get("/api/hourly", params={**ABUJA, "month": 2}).json()
    assert len(h["ghi_w_m2"]) == 24 and max(h["ghi_w_m2"]) > 300
    t = client.get("/api/technologies").json()
    assert len(t["technologies"]) >= 13 and len(t["references"]) >= 5


def test_assess_and_report(client):
    body = {"location": ABUJA, "facility": {"type": "hospital_general", "beds": 150, "backup_hours": 12, "existing": {"generator_kva": 500},
            "roof_area_m2": 3000, "land_area_m2": 5000, "priority": "balanced"}}
    r = client.post("/api/assess", json=body)
    assert r.status_code == 200
    j = r.json()
    rec = j["recommended"]
    assert "Solar" in rec["name"] and "Li-ion" in rec["name"]
    assert rec["components"]["ups"]["kva"] > 0 and rec["components"]["backup_device"]["energy_kwh"] > 0
    assert len(j["ranked"]) == 8 and j["ranked"][0]["rank"] == 1
    assert len(rec["simulation_hourly"]) == 24
    assert rec["simulation_summary"]["critical_served_pct"] >= 99
    assert rec["cost"]["capex_usd"] > 0 and rec["lifecycle"]["simple_payback_years"]
    assert any(x["id"] == "pumped_hydro" and x["suitability"] == "Not suitable" for x in j["ranked"])
    rep = client.post("/api/report", json=j)
    assert rep.status_code == 200 and "Recommended architecture" in rep.text


def test_esg_report_for_the_selected_site(client):
    """The ESG report is built for the site the user picked: its name and coordinates, scope 1 and 2 split, and the carbon value."""
    body = {"location": ABUJA, "facility": {"type": "hospital_general", "name": "Abuja test hospital", "beds": 150, "backup_hours": 12,
            "existing": {"generator_kva": 500}, "roof_area_m2": 3000, "land_area_m2": 5000, "priority": "balanced"}}
    j = client.post("/api/assess", json=body).json()
    from app.routers.report import esg_figures
    f = esg_figures(j)
    assert f["co2_t_per_year"] > 0 and f["diesel_avoided_l"] > 0
    assert f["scope1_today_t"] >= f["scope1_with_plan_t"] >= 0
    assert abs(f["co2_t_per_year"] - (f["scope1_today_t"] - f["scope1_with_plan_t"] + f["scope2_avoided_t"])) < 1   # the scopes add up
    r = client.post("/api/report/esg", json={"assessment": j, "carbon_price_usd_per_t": 12})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    t = r.text
    assert "ESG report" in t and "Abuja test hospital" in t and str(ABUJA["lat"]) in t
    assert "Scope 1" in t and "Scope 2" in t and "US$ 12.00 per tonne" in t
    assert "Environment" in t and "Social" in t and "Governance" in t
    # without a price the report still renders and asks for one
    r2 = client.post("/api/report/esg", json={"assessment": j})
    assert r2.status_code == 200 and "enter your buyer" in r2.text
    # through the Wind lens the report is about the best wind design at this site, with its own numbers
    wind = next(o for o in j["ranked"] if o["id"] == "wind_li_ion")
    fw = esg_figures(j, "wind_li_ion")
    assert fw["diesel_today_l"] == f["diesel_today_l"]                     # the same site, the same diesel today
    assert abs(fw["co2_t_per_year"] - (fw["scope1_today_t"] - fw["scope1_with_plan_t"] + fw["scope2_avoided_t"])) < 1
    r3 = client.post("/api/report/esg", json={"assessment": j, "option_id": "wind_li_ion", "lens": "wind"})
    assert r3.status_code == 200 and wind["name"] in r3.text and "Wind lens" in r3.text and "best wind-based design" in r3.text


def test_assess_validation(client):
    r = client.post("/api/assess", json={"location": {"lat": 200, "lng": 0}})
    assert r.status_code == 422


def test_assess_priorities_change_ranking(client):
    base = {"location": {"lat": 12.0022, "lng": 8.592}, "facility": {"type": "hospital_tertiary", "beds": 500, "backup_hours": 72,
            "existing": {"generator_kva": 1500}, "roof_area_m2": 8000, "land_area_m2": 30000}}
    a = client.post("/api/assess", json={**base, "facility": {**base["facility"], "priority": "cheapest"}}).json()
    b = client.post("/api/assess", json={**base, "facility": {**base["facility"], "priority": "greenest"}}).json()
    assert a["weights"] != b["weights"]
    h2_a = next(x for x in a["ranked"] if x["id"] == "solar_hydrogen")
    h2_b = next(x for x in b["ranked"] if x["id"] == "solar_hydrogen")
    assert h2_b["score"] >= h2_a["score"]


def test_off_grid_hospital_never_uses_the_grid(client):
    body = {"location": {"lat": 12.0, "lng": 8.52}, "facility": {"type": "hospital_general", "beds": 120, "backup_hours": 12,
            "existing": {"grid_connection": False, "generator_kva": 0, "solar_kwp": 0, "ups_kva": 0}, "allow_new_generator": False}}
    j = client.post("/api/assess", json=body).json()
    assert j["site"]["grid"]["supply_hours"] == 0
    assert all(r["grid_import_kw"] == 0 for r in j["recommended"]["simulation_hourly"])
    grid_charged = next(o for o in j["ranked"] if o["id"] == "li_ion_backup")
    assert grid_charged["score"] <= 15 and j["recommended"]["id"] != "li_ion_backup"