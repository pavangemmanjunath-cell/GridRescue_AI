from app.services.health_providers import featured, provider_status


def test_featured_lists_nigeria_and_africa():
    all_items = featured()
    assert len(all_items) >= 70
    ng = featured("NG")
    ke = featured("KE")
    assert all(f["country_code"] == "NG" for f in ng) and len(ng) >= 35
    assert any("Kenyatta" in f["name"] for f in ke)


def test_provider_status_shape():
    ps = provider_status()
    ids = {p["id"] for p in ps}
    assert {"osm_overpass", "healthsites_io", "who_kemri_ssa", "grid3_nigeria", "nhfr_nigeria", "curated"} <= ids
    assert all("status" in p and "url" in p for p in ps)


def test_load_model_and_providers_endpoints(client):
    r = client.get("/api/health-data/providers")
    assert r.status_code == 200 and len(r.json()["providers"]) == 7
    r = client.post("/api/load-model", json={"type": "hospital_tertiary", "beds": 761, "backup_hours": 12, "name": "LUTH"})
    j = r.json()
    assert "LUTH needs about" in j["statement"] and j["protected_peak_kw"] > 0
    r = client.get("/api/hospitals/featured", params={"country_code": "GH"})
    assert r.json()["count"] >= 2


def test_assessment_has_investment_case(client):
    body = {"location": {"lat": 6.518, "lng": 3.355}, "facility": {"type": "hospital_tertiary", "name": "LUTH", "beds": 761, "backup_hours": 12,
            "existing": {"generator_kva": 2000}, "roof_area_m2": 12000, "land_area_m2": 8000}}
    j = client.post("/api/assess", json=body).json()
    ic = j["investment_case"]
    assert ic["decision_kind"] in ("go", "go_phased", "go_resilience", "rescope", "defer")
    assert ic["power_requirement"]["statement"].startswith("LUTH needs")
    assert ic["do_nothing"]["diesel_litres_per_year"] > 0
    assert any(w["tech"] == "Hydrogen" and w["verdict"] == "exclude" for w in ic["why_technology"])
    assert len(ic["next_steps"]) >= 4
