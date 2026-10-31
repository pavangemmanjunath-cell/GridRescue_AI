"""Outage survival — the resilience metric used by NREL's REopt: start the outage at every hour of the day and count how
often the critical load stays fully powered, for each outage length. Uses the engine's own hourly simulation unchanged."""
from __future__ import annotations

from app.engine.simulation import simulate

DURATIONS = (4, 8, 12, 18, 24)


def survival_curve(load: dict, hourly: dict, comp: dict, supply_hours: float, charge_from_grid: bool = True,
                   durations: tuple[int, ...] = DURATIONS) -> dict:
    curve = []
    for d in durations:
        ok = sum(1 for start in range(24)
                 if simulate(load, hourly, comp, supply_hours, start, d, charge_from_grid)["summary"]["critical_served_pct"] >= 99.9)
        curve.append({"hours": d, "survival_pct": round(100 * ok / 24)})
    return {"curve": curve, "starts_tested": 24,
            "method": "Outage started at each of the 24 hours of the design day; survival = share of starts in which the "
                      "critical load (theatres, ICU, burns) is fully served for the whole outage. Same method as NREL REopt's "
                      "outage simulator, on the engine's typical day."}
