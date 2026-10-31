"""Daily consumption of a case hospital — the numbers the hands-free page and the plan size against.

Order of truth:
  1. the hospital's own meter / generator log, dropped in as backend/app/data/external/<case>_meter.csv
     (columns: hour, kwh — any number of days; averaged per hour)
  2. otherwise the engine's archetype load model for the facility (beds, type), clearly labelled as an estimate

Either way the answer has the same shape, so the page does not care where it came from.
"""
from __future__ import annotations

import csv
from pathlib import Path

from app.config import DATA_DIR
from app.engine.profiles import build_load_model

EXTERNAL_DIR = DATA_DIR / "external"
# daily-use bands a hospital can be dialled through with the hand (kWh a day): the Explorer's bands, extended upwards
BANDS = [1000, 2500, 5000, 8000, 12000, 16000, 20000, 28000, 36000]


def _meter_profile(case_id: str) -> list[float] | None:
    path: Path = EXTERNAL_DIR / f"{case_id.replace('-', '_')}_meter.csv"
    if not path.exists():
        return None
    sums, counts = [0.0] * 24, [0] * 24
    with path.open(encoding="utf-8", errors="ignore", newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                h, kwh = int(float(row.get("hour", ""))) % 24, float(row.get("kwh", ""))
            except ValueError:
                continue
            sums[h] += kwh
            counts[h] += 1
    if sum(counts) < 24:
        return None
    return [round(sums[h] / max(counts[h], 1), 1) for h in range(24)]


def daily_consumption(case: dict, daily_kwh: float | None = None) -> dict:
    """Hourly kWh for one day, the day's total, the peak, and the critical / essential split the engine will protect."""
    fac = case["facility"]
    metered = _meter_profile(case["id"]) if daily_kwh is None else None
    if metered:
        total = round(sum(metered))
        lm = build_load_model(fac["type"], fac.get("beds"), None, None, total)
        source, note = "meter", "Averaged from the hospital's meter / generator log (external CSV)."
    else:
        lm = build_load_model(fac["type"], fac.get("beds"), fac.get("avg_load_kw"), fac.get("critical_load_kw"), daily_kwh or fac.get("daily_kwh"))
        total = lm["daily_kwh"]
        source = "estimate"
        note = (f"Estimated from {lm['beds']} beds ({lm['facility_label']}) with WHO / USAID 'Powering Health' benchmarks — "
                f"replace with the hospital's meter log (drop {case['id'].replace('-', '_')}_meter.csv into backend/app/data/external/).")
    hourly = metered or lm["hourly"]["total"]
    peak = max(hourly)
    connected = case["hospital"].get("connected_kw")
    return {
        "case_id": case["id"], "source": source, "note": note, "daily_kwh": round(total), "peak_kw": round(peak, 1), "avg_kw": round(total / 24, 1),
        "connected_kw": connected, "peak_share_of_connected_pct": round(100 * peak / connected) if connected else None,
        "critical_peak_kw": lm["critical_peak_kw"], "protected_peak_kw": lm["protected_peak_kw"], "protected_daily_kwh": lm["protected_daily_kwh"],
        "hourly_kwh": [round(v, 1) for v in hourly], "hourly_critical_kw": lm["hourly"]["critical"], "hourly_essential_kw": lm["hourly"]["essential"],
        "bands_kwh": BANDS, "band_index": min(range(len(BANDS)), key=lambda i: abs(BANDS[i] - total)),
        "grid_hours_per_day": case["hospital"].get("grid_hours_per_day"),
        "kwh_without_grid": round(total * (24 - (case["hospital"].get("grid_hours_per_day") or 0)) / 24),
    }
