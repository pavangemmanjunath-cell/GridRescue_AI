"""ML classifier, agent trace and affordability (offline)."""
from app.ml import backup_classifier
from app.engine.investment import _annuity
from tests.conftest import ABUJA

KANO = {"lat": 12.0, "lng": 8.52}


def _assess(client, loc, **fac):
    base = {"type": "hospital_general", "beds": 150, "backup_hours": 12, "existing": {"generator_kva": 500},
            "roof_area_m2": 3000, "land_area_m2": 5000, "priority": "balanced"}
    r = client.post("/api/assess", json={"location": loc, "facility": {**base, **fac}})
    assert r.status_code == 200
    return r.json()


def test_model_card_beats_baseline(client):
    card = client.get("/api/ml/model").json()
    assert card["available"] and card["depth"] <= 7
    meta = card["meta"]
    assert meta["accuracy_test"] > meta["majority_baseline_test"] + 0.15
    assert meta["top2_accuracy_test"] >= meta["accuracy_test"]
    assert abs(sum(i["weight"] for i in card["importance"]) - 1.0) < 0.01


def test_agent_trace_is_complete_and_auditable(client):
    ag = _assess(client, KANO)["agent"]
    assert [s["id"] for s in ag["steps"]] == ["observe", "classify", "verify", "stress", "afford", "decide"]
    pred = ag["ml"]
    assert pred["family"] in backup_classifier.FAMILY_LABEL and 0 < pred["confidence"] <= 1 and pred["decision_path"]
    names = [t["scenario"] for t in ag["stress_tests"]]
    assert any("grid collapse" in n for n in names) and any("Worst solar" in n for n in names)
    for t in ag["stress_tests"]:
        assert t["status"] in ("pass", "warn", "fail") and t["unserved_protected_kwh"] >= 0
    assert ag["actions"]


def test_weak_grid_small_backup_gets_mitigation(client):
    # no roof/land (no PV), no generator, critical grid: the 24 h collapse must not pass silently
    ag = _assess(client, ABUJA, roof_area_m2=0, land_area_m2=0, existing={"generator_kva": 0}, backup_hours=4)["agent"]
    collapse = next(t for t in ag["stress_tests"] if "grid collapse" in t["scenario"])
    assert collapse["status"] != "pass"
    assert any("grid collapse" in a for a in ag["actions"])


def test_affordability_block(client):
    af = _assess(client, KANO)["investment_case"]["affordability"]
    assert af["monthly_diesel_today_usd"] > 0 and len(af["financing"]) == 2
    for f in af["financing"]:
        assert f["monthly_payment_usd"] > 0
    assert abs(_annuity(120_000, 0.0, 10) - 1000) < 1e-6
    assert abs(_annuity(100_000, 0.12, 1) - 8884.88) < 0.1
