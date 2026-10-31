"""Train the explainable architecture classifier on engine-labelled synthetic sites.

    cd backend && python -m app.ml.train_backup_classifier            # writes app/data/backup_classifier_model.json
    cd backend && python -m app.ml.train_backup_classifier --out /tmp/model.json   # reproduce without replacing the shipped model

Options: --n (sites, default 10000), --seed (default 2026), --trees (default 30), --out (default: the shipped model file).
The run is deterministic for a given seed: the same seed gives the same model and the same held-out scores.

Sites are sampled over ranges observed across Nigeria / sub-Saharan Africa (solar 3.6–6.6 PSH, 50 m wind
2.5–7.5 m/s, grid classes A–E weighted toward Nigerian DisCo conditions, terrain, water and land), with
healthcare-weighted facility types. Each sample is labelled by the full engine (sizing + 24-h dispatch +
9-criterion scoring, "balanced" priority), so the tree learns the engine's decision surface.
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import random
import sys

from app.config import settings
from app.ml import backup_classifier
from app.engine.profiles import build_load_model
from app.engine.recommend import evaluate
from app.engine.scoring import site_summary
from app.services.fallback import model_hourly_day
from app.services.geocode import STATE_CLASSES

# hospitals first, then every other kind of critical infrastructure the engine models
FACILITY_MIX = [("hospital_general", 0.22), ("hospital_tertiary", 0.14), ("clinic_phc", 0.16), ("emergency_center", 0.08),
                ("telecom_tower", 0.08), ("data_center", 0.07), ("cold_chain", 0.07), ("water_treatment", 0.08), ("school", 0.06), ("custom", 0.04)]
GRID_MIX = [("A", 0.10), ("B", 0.20), ("C", 0.30), ("D", 0.25), ("E", 0.15)]
BACKUP_MIX = [(2, 0.06), (4, 0.12), (6, 0.10), (8, 0.14), (12, 0.24), (16, 0.08), (24, 0.14), (48, 0.07), (72, 0.05)]


def _pick(rng: random.Random, mix):
    r, acc = rng.random(), 0.0
    for v, w in mix:
        acc += w
        if r <= acc:
            return v
    return mix[-1][0]


def _seasonal(rng, mean, worst_factor):
    amp = 1 - worst_factor
    phase = rng.randrange(12)
    return [round(mean * (1 - amp * math.cos(2 * math.pi * (m - phase) / 12)), 2) for m in range(12)]


def sample_site(rng: random.Random):
    psh = rng.uniform(3.6, 6.6)
    monthly_psh = _seasonal(rng, psh, rng.uniform(0.68, 0.94))
    ws = rng.uniform(2.5, 7.5)
    monthly_ws = _seasonal(rng, ws, rng.uniform(0.75, 0.95))
    tmean = rng.uniform(22, 31)
    temps = _seasonal(rng, tmean, rng.uniform(0.88, 0.97))
    head = rng.uniform(0, 40) if rng.random() < 0.7 else rng.uniform(40, 400)
    micro = rng.uniform(0, 90)
    water = {"scores": {"water_availability": round(rng.uniform(20, 90)), "micro_hydro": round(micro),
                        "pumped_hydro": round(min(95, head / 4 + rng.uniform(0, 20))), "hydrogen_water": round(rng.uniform(40, 90)),
                        "nearest_distance_km": round(rng.uniform(0.2, 10), 1), "discharge_class": rng.choice(["stream", "small river", "river", "none nearby"]),
                        "head_m": round(head), "rain_mm_yr": round(rng.uniform(400, 2500))}}
    cls = _pick(rng, GRID_MIX)
    meta = STATE_CLASSES[cls]
    grid = {"reliability": {"reliability_score": meta["score"], "grid_class": cls, "class_label": meta["label"], "outage_risk": meta["outage_risk"],
                            "expected_supply_hours_per_day": meta["supply_hours"], "expected_outage_hours_per_day": 24 - meta["supply_hours"],
                            "infrastructure_score": round(rng.uniform(10, 90)), "disco": None, "state": None}}
    clim = {"annual_psh": round(psh, 2), "monthly_psh": monthly_psh, "monthly_wind_50m_ms": monthly_ws, "monthly_temp_c": temps}
    hourly = model_hourly_day(monthly_psh[2], monthly_ws[2], temps[2], 9.0, 2)
    return site_summary(clim, water, grid), water, hourly


def sample_facility(rng: random.Random):
    ftype = _pick(rng, FACILITY_MIX)
    load = build_load_model(ftype, None, None, None, None)
    beds = max(4, round(load["beds"] * rng.uniform(0.4, 2.0))) if load["beds"] else None
    load = build_load_model(ftype, beds, None, None, None) if beds else build_load_model(ftype, None, load["avg_load_kw"] * rng.uniform(0.5, 3), None, None)
    roof = round(load["avg_load_kw"] * rng.uniform(2, 25))
    land = 0 if rng.random() < 0.4 else round(rng.uniform(500, 20000))
    gen = round(load["protected_peak_kw"] / 0.8 * rng.uniform(1.0, 2.0) / 10) * 10 if rng.random() < 0.55 else 0
    fac = {"type": ftype, "name": None, "beds": beds, "backup_hours": float(_pick(rng, BACKUP_MIX)), "roof_area_m2": float(roof),
           "land_area_m2": float(land), "water_source": "borehole", "budget_usd": None, "priority": "balanced", "allow_new_generator": True}
    existing = {"grid_connection": True, "generator_kva": float(gen), "solar_kwp": 0.0, "ups_kva": 0.0}
    return load, fac, existing


def build_dataset(n: int, seed: int):
    rng = random.Random(seed)
    X, y = [], []
    for _ in range(n):
        site, water, hourly = sample_site(rng)
        load, fac, existing = sample_facility(rng)
        diesel = round(rng.uniform(0.9, 2.6), 2)
        res = evaluate(site, water, load, fac, hourly, existing, {"outage_start_hour": 18, "charge_from_grid": True,
                                                                  "econ": {"diesel_price_usd_per_l": diesel}})
        X.append(backup_classifier.features_from(site, load, fac, existing, diesel))
        y.append(backup_classifier.family_of(res["recommended"]["parts"]))
    return X, y


def main(n: int = 10000, seed: int = 2026, n_trees: int = 30, out: str | None = None) -> dict:
    X, y = build_dataset(n, seed)
    cut = int(0.8 * n)
    Xtr, ytr, Xte, yte = X[:cut], y[:cut], X[cut:], y[cut:]
    # 1 · the explanation: one CART tree (readable rules)
    model = backup_classifier.fit(Xtr, ytr)
    cart_te = backup_classifier.accuracy(model, Xte, yte)
    # 2 · the prediction: a Random Forest of CART trees
    model.update(backup_classifier.fit_forest(Xtr, ytr, n_trees=n_trees, seed=seed))
    acc_tr, acc_te = backup_classifier.accuracy(model, Xtr, ytr, True), backup_classifier.accuracy(model, Xte, yte, True)
    top2 = sum(1 for xi, yi in zip(Xte, yte) if yi in [p["family"] for p in backup_classifier.predict(model, xi)["probabilities"][:2]]) / len(yte)
    base = max(set(ytr), key=ytr.count)
    baseline = sum(1 for v in yte if v == base) / len(yte)
    dist: dict[str, int] = {}
    for v in y:
        dist[v] = dist.get(v, 0) + 1
    # recall per family on the held-out sites (how often each family is recognised when it is the right answer)
    recall = {}
    for fam in dist:
        idx = [i for i, v in enumerate(yte) if v == fam]
        if len(idx) >= 10:
            recall[fam] = round(sum(1 for i in idx if backup_classifier.predict_label(model, Xte[i]) == fam) / len(idx), 3)
    model["meta"] = {"engine_version": settings.version, "seed": seed, "n_train": cut, "n_test": n - cut,
                     "algorithm": "Random Forest (bagged CART trees, √features per split) + CART tree as explanation",
                     "n_features": len(backup_classifier.FEATURES), "infrastructure_types": [t for t, _ in FACILITY_MIX],
                     "accuracy_train": round(acc_tr, 3), "accuracy_test": round(acc_te, 3), "top2_accuracy_test": round(top2, 3),
                     "cart_accuracy_test": round(cart_te, 3), "majority_baseline_test": round(baseline, 3), "recall_test": recall,
                     "priority": "balanced", "label_distribution": dict(sorted(dist.items(), key=lambda kv: -kv[1])),
                     "labels_from": "GridRescue AI engine (sizing + 24-h dispatch + 9-criterion scoring)"}
    (pathlib.Path(out) if out else backup_classifier.MODEL_PATH).write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
    return model["meta"]


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Train the Random Forest + CART classifier on engine-labelled synthetic sites.")
    ap.add_argument("n", nargs="?", type=int, help=argparse.SUPPRESS)          # kept for the earlier `... 10000` form
    ap.add_argument("--n", dest="n_opt", type=int, default=10000, help="number of synthetic sites (80 %% train, 20 %% test)")
    ap.add_argument("--seed", type=int, default=2026, help="random seed for sampling, bagging and feature subsets")
    ap.add_argument("--trees", type=int, default=30, help="trees in the forest")
    ap.add_argument("--out", help="write the model here instead of app/data/backup_classifier_model.json")
    a = ap.parse_args()
    print(json.dumps(main(a.n or a.n_opt, a.seed, a.trees, a.out), indent=1, ensure_ascii=False))
