"""Grid-first feeder check: can a dedicated feeder from the nearest substation carry the hospital?

A two-bus AC load flow: the substation is the slack bus at nominal voltage, the hospital a constant-power load at the
end of an overhead line. This is the network pandapower would build ("Grid: pandapower + open grid data", the GEH 2026
project starter), and the conductors are pandapower's standard line types. When pandapower is installed it solves the
network itself; otherwise the same equations are solved exactly here, in closed form (shunt capacitance neglected, which
is a few tenths of a percent on a feeder of a few kilometres):

    Vr⁴ + (2(P·R + Q·X) − Vs²)·Vr² + (P² + Q²)(R² + X²) = 0        (Vr, Vs in kV line-to-line, P in MW, Q in Mvar, R, X in Ω)

Planning limits (stated, not a code requirement): ≤ 5 % voltage drop and ≤ 80 % conductor loading."""
from __future__ import annotations

import math

# pandapower standard overhead line types (r, x in Ω/km, max current in kA)
CONDUCTORS = {
    11: {"std_type": "149-AL1/24-ST1A 10.0", "r": 0.194, "x": 0.315, "c_nf": 11.25, "max_i_ka": 0.47},
    33: {"std_type": "243-AL1/39-ST1A 20.0", "r": 0.1188, "x": 0.32, "c_nf": 11.0, "max_i_ka": 0.645},
}
DROP_LIMIT, LOADING_LIMIT = 5.0, 80.0


def _closed_form(kv: float, d_km: float, p_mw: float, q_mvar: float, cond: dict) -> dict:
    r, x = cond["r"] * d_km, cond["x"] * d_km
    b = kv ** 2 - 2 * (p_mw * r + q_mvar * x)
    disc = b ** 2 - 4 * (p_mw ** 2 + q_mvar ** 2) * (r ** 2 + x ** 2)
    if disc < 0:
        return {"converged": False}
    vr = math.sqrt((b + math.sqrt(disc)) / 2)
    i_ka = math.hypot(p_mw, q_mvar) / (math.sqrt(3) * vr)
    return {"converged": True, "vm_pu": vr / kv, "i_ka": i_ka, "losses_kw": 3 * i_ka ** 2 * r * 1000}


def _pandapower(kv: float, d_km: float, p_mw: float, q_mvar: float, cond: dict) -> dict | None:
    try:
        import pandapower as pp  # optional: used when installed
    except Exception:
        return None
    net = pp.create_empty_network()
    b0, b1 = pp.create_bus(net, vn_kv=kv), pp.create_bus(net, vn_kv=kv)
    pp.create_ext_grid(net, b0, vm_pu=1.0)
    pp.create_line(net, b0, b1, length_km=d_km, std_type=cond["std_type"])
    pp.create_load(net, b1, p_mw=p_mw, q_mvar=q_mvar)
    try:
        pp.runpp(net)
    except Exception:
        return {"converged": False}
    return {"converged": True, "vm_pu": float(net.res_bus.vm_pu[b1]), "i_ka": float(net.res_line.i_ka[0]), "losses_kw": float(net.res_line.pl_mw[0]) * 1000}


def feeder_check(distance_km: float, kw: float, kv: int = 11, pf: float = 0.9) -> dict:
    cond = CONDUCTORS[kv]
    d = max(0.1, float(distance_km))
    p = kw / 1000
    q = p * math.tan(math.acos(pf))
    res = _pandapower(kv, d, p, q, cond)
    solver = "pandapower" if res is not None else "two-bus AC load flow (pandapower's model and conductor data)"
    if res is None:
        res = _closed_form(kv, d, p, q, cond)
    out = {"kv": kv, "distance_km": round(d, 2), "kw": round(kw), "pf": pf, "conductor": cond["std_type"], "solver": solver,
           "limits": f"planning limits: ≤ {DROP_LIMIT:g} % voltage drop, ≤ {LOADING_LIMIT:g} % conductor loading"}
    if not res.get("converged"):
        return {**out, "ok": False, "text": f"A {kv} kV feeder of {d:.1f} km cannot carry {kw:,.0f} kW: the voltage collapses."}
    drop = (1 - res["vm_pu"]) * 100
    loading = 100 * res["i_ka"] / cond["max_i_ka"]
    ok = drop <= DROP_LIMIT and loading <= LOADING_LIMIT
    return {**out, "voltage_pu": round(res["vm_pu"], 4), "drop_pct": round(drop, 2), "loading_pct": round(loading, 1),
            "losses_kw": round(res["losses_kw"], 1), "ok": ok,
            "text": (f"A dedicated {kv} kV feeder of {d:.1f} km carries {kw:,.0f} kW at {loading:.0f} % conductor loading and "
                     f"{drop:.1f} % voltage drop — " + ("within planning limits." if ok else "outside planning limits: a heavier conductor or 33 kV is needed."))}


def site_feeders(power: dict, kw_protected: float, kw_connected: float | None = None) -> dict:
    """The nearest substation from the grid mapper, and the feeder check at 11 kV (and 33 kV) for the protected and connected load."""
    subs = sorted(power.get("substations") or [], key=lambda s: s.get("distance_km") or 1e9)
    if not subs:
        return {"substation": None, "checks": [], "note": "No substation mapped near this site: ask the distribution company for the feeder route."}
    s0 = subs[0]
    loads = [("protected load", kw_protected)] + ([("whole hospital (connected)", kw_connected)] if kw_connected else [])
    checks = [{"load": name, **feeder_check(s0["distance_km"], kw, kv)} for name, kw in loads for kv in (11, 33)]
    return {"substation": {k: s0.get(k) for k in ("name", "voltage_kv", "distance_km", "bearing", "lat", "lng")}, "checks": checks,
            "note": "The distance is straight-line from the mapped substation; a real feeder route is longer, so the utility confirms it."}
