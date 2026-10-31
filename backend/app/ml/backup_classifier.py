"""Explainable ML layer — classical supervised classification of the best-fit energy system family for a
facility (hospital or any other critical infrastructure) from its configuration, the grid, the environment
and the landscape.

Two classical models, both trained (``python -m app.ml.train_backup_classifier``) on thousands of synthetic
sites labelled by the full sizing + 24-h dispatch + scoring engine:

* a **Random Forest** — bootstrap-aggregated CART trees, each split chosen among a random subset of features —
  that votes the family and gives a probability for each (the prediction shown to the user);
* a single **CART decision tree** (Gini) whose path reads as plain rules (the explanation shown beside it).

Both are *surrogates* of the physics-based engine: they answer in microseconds, while the engine's hourly
simulation remains the authority — the agent (app.engine.agent) uses the forest as the fast first pick and
verifies it. Pure Python, no ML dependencies.
"""
from __future__ import annotations

import json
import math
import random
from collections import Counter
from pathlib import Path

MODEL_PATH = Path(__file__).resolve().parent.parent / "data" / "backup_classifier_model.json"

GRID_ORDINAL = {"A": 4, "B": 3, "C": 2, "D": 1, "E": 0}
# infrastructure kind of each facility type (the model learns how the kind of site changes the best system)
KIND_OF = {"hospital_tertiary": "hospital", "hospital_general": "hospital", "emergency_center": "hospital", "clinic_phc": "clinic",
           "telecom_tower": "ict", "data_center": "ict", "cold_chain": "cold_chain", "water_treatment": "water", "school": "school", "custom": "other"}

# feature → human label (used in decision paths and importances)
FEATURES: dict[str, str] = {
    "grid_supply_h": "grid supply (h/day)",
    "grid_strength": "grid strength class (E=0 … A=4)",
    "solar_psh": "solar resource (peak-sun-hours/day)",
    "solar_worst_psh": "worst-month solar (PSH)",
    "wind_ms": "wind speed at 50 m (m/s)",
    "head_m": "terrain head (m)",
    "micro_hydro": "flowing-water score",
    "area_m2": "roof + land area (m²)",
    "land_m2": "open land (m²)",
    "backup_h": "required backup (h)",
    "protected_kw": "protected peak load (kW)",
    "has_generator": "existing generator (0/1)",
    "diesel_usd_l": "diesel price (US$/L)",
    "avg_load_kw": "average load (kW)",
    "critical_share": "share of load that is critical",
    "kind_hospital": "infrastructure: hospital (0/1)",
    "kind_clinic": "infrastructure: clinic (0/1)",
    "kind_ict": "infrastructure: telecom / data (0/1)",
    "kind_cold_chain": "infrastructure: cold chain (0/1)",
    "kind_water": "infrastructure: water works (0/1)",
    "kind_school": "infrastructure: school (0/1)",
}

# architecture family labels (parts → family)
FAMILY_LABEL = {
    "solar_backup": "Solar PV + Li-ion backup device (+ UPS)",
    "solar_backup_gen": "Solar PV + Li-ion backup device + generator last tier",
    "solar_flow": "Solar PV + flow backup device",
    "grid_backup": "Grid-charged Li-ion backup device (+ UPS)",
    "gen_backup": "Generator + Li-ion backup device hybrid",
    "wind_backup": "Wind + Li-ion backup device",
    "solar_wind_backup": "Solar + wind + backup device",
    "hydrogen": "Solar PV + hydrogen",
    "pumped_hydro": "Pumped hydro (regional)",
    "ups_only": "UPS only",
}


def family_of(parts: list[str]) -> str:
    p = set(parts)
    if "pumped_hydro" in p:
        return "pumped_hydro"
    if "hydrogen" in p:
        return "hydrogen"
    if "flow" in p:
        return "solar_flow"
    if "wind" in p and "solar_pv" in p:
        return "solar_wind_backup"
    if "wind" in p:
        return "wind_backup"
    if "solar_pv" in p:
        return "solar_backup_gen" if "diesel_gen" in p else "solar_backup"
    if "diesel_gen" in p:
        return "gen_backup"
    if "li_ion" in p:
        return "grid_backup"
    return "ups_only"


def features_from(site: dict, load: dict, fac: dict, existing: dict, diesel_usd_l: float) -> dict:
    return {
        "grid_supply_h": float(site["grid"]["supply_hours"]),
        "grid_strength": float(GRID_ORDINAL.get(site["grid"]["class"], 2)),
        "solar_psh": float(site["solar"]["annual_psh"]),
        "solar_worst_psh": float(site["solar"]["worst_month_psh"]),
        "wind_ms": float(site["wind"]["annual_ws50"]),
        "head_m": float(site["water"].get("head_m") or 0.0),
        "micro_hydro": float(site["water"].get("micro_hydro") or 0.0),
        "area_m2": float(fac["roof_area_m2"] + fac["land_area_m2"]),
        "land_m2": float(fac["land_area_m2"]),
        "backup_h": float(fac["backup_hours"]),
        "protected_kw": float(load["protected_peak_kw"]),
        "has_generator": 1.0 if (existing.get("generator_kva") or 0) > 0 else 0.0,
        "diesel_usd_l": float(diesel_usd_l),
        "avg_load_kw": float(load.get("avg_load_kw") or 0.0),
        "critical_share": round(float(load.get("critical_peak_kw") or 0.0) / max(float(load.get("peak_load_kw") or 1.0), 1e-6), 3),
        **{f"kind_{k}": 1.0 if KIND_OF.get(fac.get("type") or "custom", "other") == k else 0.0
           for k in ("hospital", "clinic", "ict", "cold_chain", "water", "school")},
    }


# ── CART (Gini) ────────────────────────────────────────────────────────────────────────
def _gini(counts: Counter, n: int) -> float:
    return 1.0 - sum((c / n) ** 2 for c in counts.values()) if n else 0.0


def _best_split(X: list[dict], y: list[str], idx: list[int], min_leaf: int, feats=None):
    n = len(idx)
    parent = _gini(Counter(y[i] for i in idx), n)
    best = None
    for f in feats or FEATURES:
        vals = sorted({X[i][f] for i in idx})
        if len(vals) < 2:
            continue
        # candidate thresholds at ≤ 24 quantile midpoints keeps training fast and the tree readable
        step = max(1, len(vals) // 24)
        cands = [(vals[k] + vals[k + 1]) / 2 for k in range(0, len(vals) - 1, step)]
        for t in cands:
            left = [i for i in idx if X[i][f] <= t]
            nl = len(left)
            if nl < min_leaf or n - nl < min_leaf:
                continue
            lc = Counter(y[i] for i in left)
            rc = Counter(y[i] for i in idx) - lc
            g = (nl * _gini(lc, nl) + (n - nl) * _gini(rc, n - nl)) / n
            gain = parent - g
            if best is None or gain > best[0]:
                best = (gain, f, t, left)
    return best


def _grow(X, y, idx, depth, max_depth, min_leaf, importance, rng: random.Random | None = None, k: int | None = None):
    counts = Counter(y[i] for i in idx)
    node = {"n": len(idx), "dist": {c: round(v / len(idx), 4) for c, v in counts.most_common()}, "label": counts.most_common(1)[0][0]}
    if depth >= max_depth or len(counts) == 1 or len(idx) < 2 * min_leaf:
        return node
    feats = rng.sample(list(FEATURES), k) if rng and k else None   # random-forest: a random feature subset at every split
    s = _best_split(X, y, idx, min_leaf, feats)
    if s is None or s[0] <= 1e-6:
        return node
    gain, f, t, left = s
    importance[f] = importance.get(f, 0.0) + gain * len(idx)
    lset = set(left)
    right = [i for i in idx if i not in lset]
    node.update({"feature": f, "threshold": round(t, 3),
                 "left": _grow(X, y, left, depth + 1, max_depth, min_leaf, importance, rng, k),
                 "right": _grow(X, y, right, depth + 1, max_depth, min_leaf, importance, rng, k)})
    return node


def _slim(node: dict) -> dict:
    """Leaves keep only their class distribution (the forest is stored in the repo)."""
    if "feature" not in node:
        return {"dist": node["dist"]}
    return {"feature": node["feature"], "threshold": node["threshold"], "left": _slim(node["left"]), "right": _slim(node["right"])}


def fit_forest(X: list[dict], y: list[str], n_trees: int = 30, max_depth: int = 10, min_leaf: int = 5, seed: int = 2026) -> dict:
    """Random Forest: n_trees CART trees, each grown on a bootstrap sample with √(features) candidates per split."""
    rng = random.Random(seed)
    n, k = len(y), max(2, round(math.sqrt(len(FEATURES))))
    trees, importance = [], {}
    for _ in range(n_trees):
        boot = [rng.randrange(n) for _ in range(n)]
        trees.append(_slim(_grow(X, y, boot, 0, max_depth, min_leaf, importance, rng, k)))
    tot = sum(importance.values()) or 1.0
    return {"forest": trees, "forest_importance": {f: round(v / tot, 4) for f, v in sorted(importance.items(), key=lambda kv: -kv[1])},
            "forest_params": {"n_trees": n_trees, "max_depth": max_depth, "min_leaf": min_leaf, "features_per_split": k}}


def forest_proba(model: dict, x: dict) -> dict[str, float]:
    """Average of the trees' leaf distributions = the forest's probability for each family."""
    acc: dict[str, float] = {}
    trees = model["forest"]
    for t in trees:
        node = t
        while "feature" in node:
            node = node["left"] if x[node["feature"]] <= node["threshold"] else node["right"]
        for c, p in node["dist"].items():
            acc[c] = acc.get(c, 0.0) + p / len(trees)
    return dict(sorted(acc.items(), key=lambda kv: -kv[1]))


def fit(X: list[dict], y: list[str], max_depth: int = 7, min_leaf: int = 8) -> dict:
    importance: dict[str, float] = {}
    tree = _grow(X, y, list(range(len(y))), 0, max_depth, min_leaf, importance)
    tot = sum(importance.values()) or 1.0
    return {"tree": tree, "importance": {k: round(v / tot, 4) for k, v in sorted(importance.items(), key=lambda kv: -kv[1])}}


def _walk(tree: dict, x: dict):
    node, path = tree, []
    while "feature" in node:
        f, t = node["feature"], node["threshold"]
        go_left = x[f] <= t
        path.append({"feature": f, "label": FEATURES[f], "threshold": t, "value": round(x[f], 2), "op": "≤" if go_left else ">"})
        node = node["left"] if go_left else node["right"]
    return node, path


def predict(model: dict, x: dict) -> dict:
    """The forest's vote (family, probability of each) with the CART tree's rules as the explanation."""
    leaf, path = _walk(model["tree"], x)
    if model.get("forest"):
        probs = list(forest_proba(model, x).items())
        algo = f"Random Forest · {len(model['forest'])} CART trees"
    else:
        probs = sorted(leaf["dist"].items(), key=lambda kv: -kv[1])
        algo = "CART decision tree"
    fam = probs[0][0]
    return {"family": fam, "family_label": FAMILY_LABEL.get(fam, fam), "confidence": round(probs[0][1], 3),
            "probabilities": [{"family": k, "label": FAMILY_LABEL.get(k, k), "p": round(v, 3)} for k, v in probs[:4]],
            "algorithm": algo, "explainer": "CART decision tree (Gini)", "explainer_family": leaf["label"],
            "leaf_samples": leaf["n"], "decision_path": path, "features": {f: round(v, 3) for f, v in x.items()}}


def predict_label(model: dict, x: dict, use_forest: bool = True) -> str:
    if use_forest and model.get("forest"):
        return next(iter(forest_proba(model, x)))
    return _walk(model["tree"], x)[0]["label"]


def accuracy(model: dict, X: list[dict], y: list[str], use_forest: bool = False) -> float:
    return sum(1 for xi, yi in zip(X, y) if predict_label(model, xi, use_forest) == yi) / max(1, len(y))


_MODEL: dict | None = None


def load_model() -> dict | None:
    global _MODEL
    if _MODEL is None and MODEL_PATH.exists():
        _MODEL = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    return _MODEL


def model_card() -> dict:
    m = load_model()
    if not m:
        return {"available": False}
    imp = m.get("forest_importance") or m["importance"]
    return {"available": True,
            "kind": ("Random Forest of CART trees (bagging + random feature subsets) with a CART decision tree as the explanation; "
                     "both are surrogates of the physics-based engine") if m.get("forest") else "CART decision tree (Gini), surrogate of the physics-based engine",
            "meta": m["meta"], "importance": [{"feature": k, "label": FEATURES[k], "weight": v} for k, v in imp.items() if k in FEATURES],
            "families": FAMILY_LABEL, "depth": _depth(m["tree"]), "forest": m.get("forest_params")}


def _depth(node: dict) -> int:
    return 0 if "feature" not in node else 1 + max(_depth(node["left"]), _depth(node["right"]))
