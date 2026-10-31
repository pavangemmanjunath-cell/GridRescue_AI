"""Regression test for the worked example (README › Key results, examples/quickstart.py).

The tests run offline (GR_OFFLINE=1), where hourly weather is modelled, so diesel and CO2 differ slightly from the
README, which uses live open data (866,678 L and 2,246 t a year). The design itself is the same either way.
If an engine change moves one of these numbers, update the README, the documents in FINAL_DOC/ and this test together.
"""

NOHE = {"lat": 6.4684, "lng": 7.5256}


def test_worked_example_headline_figures(client):
    case = client.get("/api/cases/noh-enugu").json()
    reloc = {**case["options"]["relocation"], "new_site": {k: case["new_site"][k] for k in ("lat", "lng", "label")}}
    j = client.post("/api/assess", json={"location": NOHE, "facility": case["facility"],
                                         "options": {**case["options"], "relocation": reloc}}).json()
    rec, inv = j["recommended"], j["investment_case"]["investment"]
    comp = rec["components"]
    assert j["site"]["grid"]["supply_hours"] == 6
    assert comp["pv"]["kwp"] == 1670 and comp["backup_device"]["energy_kwh"] == 5020
    assert comp["ups"]["kva"] == 500 and comp["generator"]["kva"] == 1000
    assert rec["simulation_summary"]["critical_served_pct"] == 100
    assert next(s for s in j["agent"]["steps"] if s["id"] == "stress")["summary"].startswith("4/4")
    assert round(inv["diesel_avoided_l_per_year"]) == 845654          # 866,678 with live open data
    # CO2 is counted once: Scope 1 (diesel not burnt) plus Scope 2 (net change in grid electricity bought)
    s1, s2, total = inv["co2_scope1_avoided_t"], inv["co2_scope2_avoided_t"], inv["co2_avoided_t_per_year"]
    assert round(s1) == 2266 and round(s2) == 78 and abs(s1 + s2 - total) < 1   # 2,323 − 77 = 2,246 t with live data
    assert round(total) == 2344 == round(j["relocatable_case"]["esg"]["co2_t_per_year"])
