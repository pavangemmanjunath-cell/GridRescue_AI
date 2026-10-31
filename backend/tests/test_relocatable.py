"""Brief 12 — relocatable solar for a hospital on the move (National Orthopaedic Hospital, Enugu)."""
import pytest

from app.engine.relocatable import load_ladder
from app.services.grid import class_for_hours

NOHE = {"lat": 6.4684, "lng": 7.5256}


@pytest.fixture(scope="module")
def case(client):
    return client.get("/api/cases/noh-enugu").json()


@pytest.fixture(scope="module")
def assessment(client, case):
    opts = {**case["options"], "relocation": {**case["options"]["relocation"], "new_site": {k: case["new_site"][k] for k in ("lat", "lng", "label")}}}
    r = client.post("/api/assess", json={"location": NOHE, "facility": case["facility"], "options": opts})
    assert r.status_code == 200
    return r.json()


def test_case_endpoint(client, case):
    assert client.get("/api/cases").json()["cases"][0]["id"] == "noh-enugu"
    assert case["hospital"]["name"] == "National Orthopaedic Hospital, Enugu" and "Abakaliki Road" in case["hospital"]["address"]
    assert len(case["brief"]["starter_questions"]) == 5 and case["facility"]["roof_area_m2"] == 0   # nothing on today's roofs
    assert client.get("/api/cases/nope").status_code == 404


def test_reported_supply_hours_drive_the_grid(client):
    g = client.get("/api/grid", params={**NOHE, "supply_hours": 6}).json()["reliability"]
    assert g["expected_supply_hours_per_day"] == 6 and g["expected_outage_hours_per_day"] == 18 and g["grid_class"] == "D"
    scan = client.get("/api/grid/scan", params={**NOHE, "supply_hours": 6}).json()
    assert all(r["reliability"]["expected_supply_hours_per_day"] == 6 for r in scan["rings"])
    assert [class_for_hours(h) for h in (22, 16, 12, 6, 3)] == ["A", "B", "C", "D", "E"]


def test_assessment_uses_six_hours_and_answers_the_brief(assessment):
    assert assessment["site"]["grid"]["supply_hours"] == 6
    assert assessment["recommended"]["simulation_summary"]["outage_hours"] == 18
    rc = assessment["relocatable_case"]
    assert [q["id"] for q in rc["starter_answers"]] == ["q1", "q2", "q3", "q4", "q5"]
    assert all(len(q["answer"]) > 80 and q["facts"] for q in rc["starter_answers"])
    assert rc["critical_loads"][0]["name"] == "Surgical theatres" and rc["critical_loads"][0]["never_off"]
    assert rc["phases"][0]["name"].startswith("Phase 1 · Theatres first")


def test_relocatable_design_and_move(assessment):
    rc = assessment["relocatable_case"]
    d, mv = rc["relocatable_design"], rc["move_plan"]
    assert d["roof_kwp"] == 0 and d["containers"] >= 2   # ground racks + containers only
    assert 0 < mv["cost_pct"] < 40 and 70 <= mv["reuse_pct"] <= 100 and mv["distance_km"] > 1
    assert rc["two_sites"]["new"]["supply_hours"] == 6   # never assume a better grid at the new building


def test_ownership_money_and_years(assessment):
    rc = assessment["relocatable_case"]
    own, cm = rc["ownership"], rc["cost_model"]
    assert own["recommended"] == "eaas" and next(o for o in own["options"] if o["id"] == "capex")["fits_asset_rules"] is False
    assert own["fee_ngn_per_kwh"] < own["diesel_ngn_per_kwh"]
    assert cm["at_5"]["year"] == 5 and cm["at_10"]["year"] == 10 and len(cm["series"]) == 11
    assert cm["at_10"]["solar_ngn_m"] < cm["at_10"]["diesel_ngn_m"]
    assert cm["breakeven_diesel_ngn_m_per_month"] > 0
    assert len(rc["funders"]) == 4 and {m["weight"] for m in rc["metrics"]} == {25, 15, 10}


def test_breakeven_is_where_today_meets_solar(client, case):
    """At the break-even diesel bill, 'today' (reported bill + grid) and the solar service cost the same."""
    base = {**case["options"], "relocation": {**case["options"]["relocation"]}}
    be = client.post("/api/assess", json={"location": NOHE, "facility": case["facility"], "options": base}).json()["relocatable_case"]["cost_model"]
    base["relocation"]["reported_diesel_ngn_per_month"] = be["breakeven_diesel_ngn_m_per_month"] * 1e6
    cm = client.post("/api/assess", json={"location": NOHE, "facility": case["facility"], "options": base}).json()["relocatable_case"]["cost_model"]
    assert abs(cm["at_10"]["reported_ngn_m"] - cm["at_10"]["solar_ngn_m"]) / cm["at_10"]["solar_ngn_m"] < 0.01


def test_impact_and_mobile_storage(assessment):
    rc = assessment["relocatable_case"]
    imp, ms = rc["impact"], rc["mobile_storage"]
    assert imp["theatre_hours_per_year"] == 4 * 10 * 6 * 52 and imp["switchovers_per_year_with_system"] == 0
    assert imp["diesel_litres_avoided_per_year"] > 0
    assert ms["default_ladder"]["ladder"][0]["carried"] and ms["move_bridge"]["trailers"] >= 1
    assert set(rc["three_as"]) == {"access", "affordability", "availability"}


def test_load_ladder_stops_at_the_limit():
    items = [{"id": "a", "name": "theatres", "kw": 100}, {"id": "b", "name": "icu", "kw": 100}, {"id": "c", "name": "wards", "kw": 100}]
    one = load_ladder(items, units_kwh=500, units_kw=250, hours=4, load_factor=1.0)   # 427 kWh usable, 250 kW
    assert [x["carried"] for x in one["ladder"]] == [True, False, False] and one["limited_by"] == "energy"
    big = load_ladder(items, units_kwh=4000, units_kw=250, hours=4, load_factor=1.0)
    assert [x["carried"] for x in big["ladder"]] == [True, True, False] and big["limited_by"] == "power"


def test_relocation_suggestions(client):
    s = client.get("/api/relocation/suggest", params=NOHE).json()
    assert s["today"] and len(s["top"]) == 5 and s["top"][0]["rank"] == 1
    assert s["top"][0]["score"] >= s["top"][-1]["score"] and all(c["reasons"] for c in s["top"])


def test_solar_check_offline_is_graceful(client):
    j = client.get("/api/solar-check", params=NOHE).json()
    assert [r["id"] for r in j["rows"]] == ["nasa", "pvgis", "pvwatts", "gsa"]   # + Global Solar Atlas


def test_report_has_brief12(client, assessment):
    html = client.post("/api/report", json=assessment).text
    assert "Brief 12" in html and "Which loads must never lose power" in html and "Impact estimate" in html


def test_consumption_endpoint(client):
    j = client.get("/api/cases/noh-enugu/consumption").json()
    assert len(j["hourly_kwh"]) == 24 and j["daily_kwh"] > 5000 and j["source"] == "estimate"
    assert j["peak_kw"] <= j["connected_kw"] and j["kwh_without_grid"] < j["daily_kwh"]
    j2 = client.get("/api/cases/noh-enugu/consumption", params={"daily_kwh": 8000}).json()
    assert j2["daily_kwh"] == 8000 and j2["bands_kwh"][j2["band_index"]] == 8000


def test_energy_type_and_no_sun(assessment):
    rc = assessment["relocatable_case"]
    et, ns = rc["energy_type"], rc["no_sun"]
    assert et["ml"] and et["ml"]["label"] and len(et["options"]) >= 3
    assert any(o["recommended"] for o in et["options"]) and all("capex_diff_ngn_m" in o for o in et["options"])
    assert "UPS" in et["why_ups"] and "overnight" in ns["text"] and ns["night_cheaper"] is False   # Nigeria: no night discount
    assert rc["esg"]["co2_t_per_year"] > 0 and len(rc["esg"]["report_lines"]) == 3


def test_tariff_endpoint(client):
    j = client.get("/api/tariff", params={**NOHE, "hour": 2}).json()
    assert j["available"] and j["country_code"] == "NG" and j["state"] == "Enugu" and j["rate_now"] == 160 and j["period"] == "flat"
    k = client.get("/api/tariff", params={"lat": 9.0765, "lng": 7.3986, "hour": 14}).json()
    assert k["rate_now"] == 209.5 and k["tou"] is False


def test_plan_adapts_when_storage_cannot_be_used(assessment):
    ad = assessment["relocatable_case"]["adapt"]
    rungs = ad["rungs"]
    assert len(rungs) == 3 and rungs[0]["if"] == "Everything fits"
    # every rung is an option the engine simulated, cheapest last; the UPS-only rung is cheaper but keeps fewer theatres on alone
    assert rungs[-1]["capex_ngn_m"] < rungs[1]["capex_ngn_m"] < rungs[0]["capex_ngn_m"]
    assert rungs[-1]["critical_served_pct"] <= rungs[0]["critical_served_pct"]
    assert any("feeder" in s for s in ad["grid_first"])
