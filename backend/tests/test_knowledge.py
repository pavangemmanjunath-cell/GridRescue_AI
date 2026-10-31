"""The ML classifier (Random Forest + CART explanation), the internal database and Ask GridRescue (retrieval-augmented)."""
from tests.conftest import ABUJA

HOSPITAL = {"type": "hospital_general", "beds": 150, "backup_hours": 12, "existing": {"generator_kva": 500, "grid_connection": True},
            "roof_area_m2": 3000, "land_area_m2": 5000, "priority": "balanced"}
GEN_FAMILIES = {"solar_backup_gen", "gen_backup"}


def _predict(client, **fac):
    body = {"location": ABUJA, "facility": {**HOSPITAL, **fac}}
    j = client.post("/api/ml/predict", json=body).json()
    assert j["available"]
    return j["prediction"]


def test_forest_model_card_beats_tree_and_baseline(client):
    card = client.get("/api/ml/model").json()
    m = card["meta"]
    assert "Random Forest" in card["kind"] and card["forest"]["n_trees"] >= 20
    assert m["accuracy_test"] > m["cart_accuracy_test"] > m["majority_baseline_test"]   # the forest beats one tree, which beats guessing
    assert m["accuracy_test"] >= m["majority_baseline_test"] + 0.25 and m["top2_accuracy_test"] >= 0.9
    assert len(m["infrastructure_types"]) >= 8 and m["n_features"] >= 20


def test_ml_predict_reads_the_configuration(client):
    p = _predict(client)
    assert p["algorithm"].startswith("Random Forest") and p["decision_path"]
    probs = [q["p"] for q in p["probabilities"]]
    assert probs == sorted(probs, reverse=True) and 0.99 <= sum(probs) <= 1.01 or sum(probs) <= 1.01
    assert p["features"]["kind_hospital"] == 1 and p["features"]["backup_h"] == 12
    # longer backup → the generator families gain probability; no generator on site → they lose it
    gen = lambda q: sum(x["p"] for x in q["probabilities"] if x["family"] in GEN_FAMILIES)   # noqa: E731
    assert gen(_predict(client, backup_hours=72)) > gen(p) > gen(_predict(client, existing={"generator_kva": 0, "grid_connection": True}))
    # the kind of infrastructure is an input: a telecom tower is recognised as ICT
    t = _predict(client, type="telecom_tower", beds=None, avg_load_kw=8)
    assert t["features"]["kind_ict"] == 1 and t["features"]["kind_hospital"] == 0


def test_agent_uses_the_forest_and_verifies_it(client):
    a = client.post("/api/assess", json={"location": ABUJA, "facility": HOSPITAL}).json()
    step = next(s for s in a["agent"]["steps"] if s["id"] == "classify")
    assert "Random Forest" in step["tool"] and "% of the forest's vote" in step["summary"]
    assert any(s["id"] == "verify" and s["status"] in ("agree", "override") for s in a["agent"]["steps"])


def test_knowledge_base_and_search(client):
    st = client.get("/api/kb/stats").json()
    assert st["documents"] >= 40 and {"technology", "method", "tariff", "data source", "case"} <= set(st["by_kind"])
    r = client.get("/api/kb/search", params={"q": "vanadium flow battery cycles"}).json()["results"]
    assert r and "flow" in r[0]["title"].lower()


def test_ask_answers_from_cited_sources_only(client):
    j = client.post("/api/ask", json={"question": "How does GridRescue select the energy system?"}).json()
    assert j["mode"] == "extractive" and not j["llm_enabled"] and j["sources"]
    assert "[1]" in j["answer"] or "[2]" in j["answer"]
    # every cited number points at a returned source, and the answer sentences come from those sources
    import re
    cited = {int(n) for n in re.findall(r"\[(\d+)\]", j["answer"])}
    assert cited <= {s["n"] for s in j["sources"]}
    for sent in re.split(r" \[\d+\] ?", j["answer"]):
        if sent.strip():
            assert any(sent.strip()[:40] in re.sub(r"\s*\[\d+\]", "", s["text"]) for s in j["sources"])
    # the user's own assessment can be the first source
    j2 = client.post("/api/ask", json={"question": "How much CO2 does this site avoid?",
                                        "context": {"place": "Abuja", "facts": ["This site avoids 1,234 t CO₂ a year with the recommended design."]}}).json()
    assert j2["sources"][0]["kind"] == "your assessment" and "1,234 t CO₂" in j2["answer"]
    # nothing relevant → it says so instead of inventing
    j3 = client.post("/api/ask", json={"question": "zzzz qqqq"}).json()
    assert j3["mode"] == "none"


def test_history_records_assessments(client):
    client.post("/api/assess", json={"location": ABUJA, "facility": {**HOSPITAL, "name": "History test hospital"}})
    rows = client.get("/api/history").json()["assessments"]
    row = next(r for r in rows if r["facility"] == "History test hospital")
    assert row["design"] and row["ml_family"] and row["lat"] == ABUJA["lat"] and row["co2_t"] is not None


def test_outage_survival_curve(client):
    """REopt-style resilience: outage started at each hour; a short backup without a generator fails long outages."""
    small = client.post("/api/assess", json={"location": ABUJA, "facility": {**HOSPITAL, "backup_hours": 4,
                        "existing": {"generator_kva": 0, "grid_connection": True}}}).json()["resilience"]
    curve = [c["survival_pct"] for c in small["curve"]]
    assert small["starts_tested"] == 24 and [c["hours"] for c in small["curve"]] == [4, 8, 12, 18, 24]
    assert all(0 <= v <= 100 for v in curve) and curve == sorted(curve, reverse=True)   # longer outages never survive more often
    assert curve[0] == 100 and curve[-1] < 50
    big = client.post("/api/assess", json={"location": ABUJA, "facility": HOSPITAL}).json()["resilience"]
    assert big["curve"][2]["survival_pct"] >= small["curve"][2]["survival_pct"]          # a 12 h design survives 12 h at least as often
