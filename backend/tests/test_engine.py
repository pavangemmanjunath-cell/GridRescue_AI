"""Unit tests for the decision engine (pure functions, no network)."""
from app.engine import sizing
from app.engine.catalogue import BACKUP_BREAKDOWN, TECHNOLOGIES
from app.engine.costs import build_cost_model
from app.engine.profiles import build_load_model
from app.engine.scoring import solar_score, wind_score
from app.engine.simulation import grid_schedule, simulate
from app.services.fallback import model_climatology, model_hourly_day


def test_load_model_shares_and_energy_balance():
    load = build_load_model("hospital_general", 150, None, None, None)
    h = load["hourly"]
    for i in range(24):
        assert abs(h["total"][i] - (h["critical"][i] + h["essential"][i] + h["non_essential"][i])) < 0.05
    assert 0.3 < load["critical_share"] < 0.6
    assert load["daily_kwh"] > 0 and load["peak_load_kw"] >= load["avg_load_kw"]


def test_load_model_respects_explicit_inputs():
    load = build_load_model("custom", None, 300, 120, None)
    assert abs(load["avg_load_kw"] - 300) < 0.01
    assert abs(load["critical_share"] - 120 / load["peak_load_kw"]) < 0.01


def test_scores_monotonic():
    assert solar_score(3.5)["score"] < solar_score(4.5)["score"] < solar_score(5.8)["score"]
    assert wind_score(3.0)["score"] < wind_score(5.0)["score"] < wind_score(7.5)["score"]
    assert wind_score(3.0)["label"] == "poor"


def test_ups_and_backup_sizing():
    ups = sizing.size_ups(100)
    assert ups["kva"] in (160,) and ups["kw"] >= 100
    b = sizing.size_backup(200, 4000, 12, "li_ion")
    assert b["energy_kwh"] >= 4000 / 24 * 12  # at least the raw energy
    assert b["power_kw"] >= 200 * 1.1
    assert 0.1 <= b["c_rate"] <= 1.0
    b8 = sizing.size_backup(200, 4000, 8, "li_ion")
    assert b8["energy_kwh"] < b["energy_kwh"]


def test_pv_area_cap():
    pv = sizing.size_pv(4000, 5.0, 5.2, roof_m2=600, land_m2=0)
    assert pv["area_capped"] and pv["kwp"] <= 100
    pv2 = sizing.size_pv(4000, 5.0, 5.2, roof_m2=0, land_m2=0)
    assert pv2["kwp"] == 0


def test_cost_breakdown_sums():
    comp = {"ups": sizing.size_ups(100), "backup_device": sizing.size_backup(200, 4000, 8, "li_ion"), "pv": sizing.size_pv(4000, 5, 5.2, 3000, 0)}
    cost = build_cost_model(comp)
    assert abs(sum(l["usd"] for l in cost["lines"]) - cost["capex_usd"]) < 1
    assert abs(sum(BACKUP_BREAKDOWN.values()) - 1.0) < 1e-9
    assert cost["capex_ngn"] > cost["capex_usd"]


def test_grid_schedule_respects_event_and_supply_hours():
    s = grid_schedule(16, 18, 12)
    assert sum(s) == 12 and all(s[(18 + i) % 24] == 0 for i in range(12))
    s2 = grid_schedule(8, 18, 4)
    assert sum(s2) == 8


def test_simulation_energy_balance_and_critical_priority():
    load = build_load_model("hospital_general", 150, None, None, None)
    clim = model_climatology(9.07, 7.4)
    hourly = model_hourly_day(clim["ghi_kwh_m2_day"][2], clim["ws50m"][2], clim["t2m"][2], 9.07, 2)
    arch = {"ups": sizing.size_ups(load["critical_peak_kw"]), "backup_device": sizing.size_backup(load["protected_peak_kw"], load["protected_daily_kwh"], 12, "li_ion"),
            "pv": sizing.size_pv(load["protected_daily_kwh"], 5, 5.2, 3000, 5000)}
    sim = simulate(load, hourly, arch, supply_hours=16, event_start=18, event_hours=12)
    s = sim["summary"]
    assert s["critical_served_pct"] >= 99
    assert 0 <= s["min_soc_pct"] <= 100
    for row in sim["hourly"]:
        supply = row["pv_kw"] + row["wind_kw"] + row["grid_import_kw"] + row["backup_discharge_kw"] + row["generator_kw"] + row["fuel_cell_kw"] + row["pumped_hydro_kw"]
        demand = row["load_kw"] + row["backup_charge_kw"] + row["curtailed_kw"] - row["unserved_kw"]
        assert abs(supply - demand) < 1.0, row
    # non-essential is shed before critical
    sim2 = simulate(load, hourly, {"backup_device": {"chemistry": "li_ion", "energy_kwh": 100, "power_kw": 50}}, supply_hours=8, event_start=18, event_hours=12)
    assert sim2["summary"]["unserved_kwh"] > 0
    assert sim2["summary"]["unserved_critical_kwh"] <= sim2["summary"]["unserved_kwh"]


def test_simulation_daytime_outage_balance_and_curtailment():
    # outage at midday with surplus PV: the backup device absorbs part of the surplus while the grid is down
    load = build_load_model("hospital_general", 150, None, None, None)
    clim = model_climatology(9.07, 7.4)
    hourly = model_hourly_day(clim["ghi_kwh_m2_day"][2], clim["ws50m"][2], clim["t2m"][2], 9.07, 2)
    arch = {"backup_device": sizing.size_backup(load["protected_peak_kw"], load["protected_daily_kwh"], 6, "li_ion"), "pv": {"kwp": 600}}
    sim = simulate(load, hourly, arch, supply_hours=20, event_start=8, event_hours=8)
    for row in sim["hourly"]:
        supply = row["pv_kw"] + row["wind_kw"] + row["grid_import_kw"] + row["backup_discharge_kw"] + row["generator_kw"] + row["fuel_cell_kw"] + row["pumped_hydro_kw"]
        demand = row["load_kw"] + row["backup_charge_kw"] + row["curtailed_kw"] - row["unserved_kw"]
        assert abs(supply - demand) < 1.0, row
    assert abs(sum(r["curtailed_kw"] for r in sim["hourly"]) - sim["summary"]["curtailed_kwh"]) < 2.0


def test_sized_backup_rides_through_its_design_hours():
    # a backup device sized for N h of protected load must carry an N-hour night outage without shedding protected load
    load = build_load_model("hospital_general", 150, None, None, None)
    hourly = {"ghi_w_m2": [0.0] * 24, "temp_c": [27.0] * 24, "wind_ms": [0.0] * 24}
    for hours in (4, 8, 12):
        arch = {"backup_device": sizing.size_backup(load["protected_peak_kw"], load["protected_daily_kwh"], hours, "li_ion")}
        s = simulate(load, hourly, arch, supply_hours=24 - hours, event_start=18, event_hours=hours)["summary"]
        assert s["critical_served_pct"] >= 99.9 and s["essential_served_pct"] >= 99.9, (hours, s)


def test_catalogue_integrity():
    for k, t in TECHNOLOGIES.items():
        assert 0 < t["rte"] <= 1 and t["life_years"] > 0 and 1 <= t["complexity"] <= 5, k
