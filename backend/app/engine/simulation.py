"""24-hour dispatch simulation with an outage event.

Merit order when the grid is down: PV → wind → backup device → generator → load shedding
(non-essential first, then essential, critical last). Stored energy (backup device, pumped hydro,
hydrogen) only feeds the protected critical + essential bus it was sized for. When the grid is up: PV → wind → grid,
with surplus renewables (and grid, if allowed) recharging the backup_device.
"""
from __future__ import annotations

from app.engine.catalogue import ECON


def grid_schedule(supply_hours: float, event_start: int, event_hours: float) -> list[int]:
    """1 = grid available. The user-defined outage window is always off; if the DisCo supplies fewer
    hours than 24 − event, the remaining shortfall is placed as afternoon load-shedding blocks."""
    avail = [1] * 24
    ev_h = int(round(event_hours))
    for i in range(min(24, ev_h)):
        avail[(event_start + i) % 24] = 0
    target_off = int(round(24 - supply_hours))
    current_off = avail.count(0)
    # typical DisCo shedding pattern: 12:00–16:00 then 20:00–00:00 then 04:00–08:00
    order = [12, 13, 14, 15, 20, 21, 22, 23, 4, 5, 6, 7, 16, 17, 8, 9, 0, 1, 2, 3, 10, 11, 18, 19]
    for h in order:
        if current_off >= target_off:
            break
        if avail[h] == 1:
            avail[h] = 0
            current_off += 1
    return avail


def pv_output(kwp: float, ghi_w_m2: list[float], temp_c: list[float], pr: float = ECON["pv_performance_ratio"]) -> list[float]:
    out = []
    for g, t in zip(ghi_w_m2, temp_c):
        cell = t + 20 * (g / 800)  # NOCT-ish cell temperature rise
        derate = 1 + ECON["pv_temp_coeff_per_c"] * max(0.0, cell - 25)
        out.append(max(0.0, kwp * (g / 1000) * pr * derate))
    return out


def wind_output(kw: float, wind_ms: list[float]) -> list[float]:
    out = []
    for v in wind_ms:
        if v < 3.0 or v > 25:
            p = 0.0
        elif v < 11.0:
            p = kw * ((v - 3.0) / 8.0) ** 3 * 1.0
        else:
            p = kw
        out.append(min(kw, p))
    return out


def simulate(load: dict, hourly: dict, arch: dict, supply_hours: float, event_start: int = 18, event_hours: float = 12,
             charge_from_grid: bool = True) -> dict:
    """arch: {backup_device:{energy_kwh,power_kw,chemistry}, pv:{kwp}, wind:{kw}, generator:{kva}, hydrogen:{fuel_cell_kw,h2_kg}, ups:{...}}"""
    total = load["hourly"]["total"]
    crit = load["hourly"]["critical"]
    ess = load["hourly"]["essential"]
    non = load["hourly"]["non_essential"]

    bat = arch.get("backup_device") or {}
    cap = float(bat.get("energy_kwh", 0.0))
    p_bat = float(bat.get("power_kw", 0.0))
    rte = 0.90 if bat.get("chemistry", "li_ion") == "li_ion" else 0.72
    eff_c = eff_d = rte ** 0.5
    soc_max = cap * ECON["backup_max_soc"]
    soc_min = cap * ECON["backup_min_soc"]
    soc = soc_max  # start full (protected facilities keep backup devices topped up)

    pv = pv_output(float((arch.get("pv") or {}).get("kwp", 0.0)), hourly["ghi_w_m2"], hourly["temp_c"])
    wind = wind_output(float((arch.get("wind") or {}).get("kw", 0.0)), hourly["wind_ms"])
    gen_kw = float((arch.get("generator") or {}).get("kva", 0.0)) * 0.8
    h2 = arch.get("hydrogen") or {}
    fc_kw = float(h2.get("fuel_cell_kw", 0.0))
    h2_kwh = float(h2.get("h2_kg", 0.0)) * ECON["h2_kwh_per_kg"] * ECON["fuel_cell_efficiency"]
    ph = arch.get("pumped_hydro") or {}
    ph_kw = float(ph.get("power_kw", 0.0))
    ph_kwh = float(ph.get("energy_kwh", 0.0))

    avail = grid_schedule(supply_hours, event_start, event_hours)
    in_event = [0] * 24
    for i in range(int(round(min(24, event_hours)))):
        in_event[(event_start + i) % 24] = 1

    rows = []
    fuel_l = 0.0
    unserved = {"critical": 0.0, "essential": 0.0, "non_essential": 0.0}
    pv_used = wind_used = grid_import = gen_kwh = bat_dis_kwh = h2_used = 0.0
    bat_grid_charge = 0.0
    curtailed = 0.0
    hours_on_backup = 0
    min_soc = soc

    for h in range(24):
        demand = total[h]
        supply_pv = pv[h]
        supply_wind = wind[h]
        ren = supply_pv + supply_wind
        served_by_ren = min(demand, ren)
        surplus = ren - served_by_ren
        remaining = demand - served_by_ren
        pv_used += min(supply_pv, served_by_ren)
        wind_used += max(0.0, served_by_ren - supply_pv)

        g_import = 0.0
        b_charge = 0.0
        b_dis = 0.0
        g_kw = 0.0
        fc = 0.0
        ph_out = 0.0
        shed = {"critical": 0.0, "essential": 0.0, "non_essential": 0.0}

        if avail[h]:
            g_import = remaining
            remaining = 0.0
            # charge backup device from surplus renewables, then grid (if allowed)
            room = max(0.0, soc_max - soc)
            c_ren = min(surplus, p_bat, room / eff_c)
            soc += c_ren * eff_c
            surplus -= c_ren
            b_charge += c_ren
            if charge_from_grid and cap > 0:
                room = max(0.0, soc_max - soc)
                c_grid = min(p_bat - c_ren, room / eff_c)
                soc += c_grid * eff_c
                g_import += c_grid
                b_charge += c_grid
                bat_grid_charge += c_grid
            curtailed += surplus
        else:
            # surplus renewables recharge backup device even during outage
            room = max(0.0, soc_max - soc)
            c_ren = min(surplus, p_bat, room / eff_c)
            soc += c_ren * eff_c
            surplus -= c_ren
            b_charge += c_ren
            curtailed += surplus
            # renewables cover the protected bus first; stored energy is reserved for protected
            # (critical + essential) load — non-essential circuits are dropped at transfer
            prot_rem = min(remaining, max(0.0, crit[h] + ess[h] - served_by_ren))
            non_rem = remaining - prot_rem
            # backup device
            if prot_rem > 0 and cap > 0:
                d = min(prot_rem, p_bat, max(0.0, soc - soc_min) * eff_d)
                soc -= d / eff_d
                prot_rem -= d
                b_dis = d
                bat_dis_kwh += d
                if d > 0:
                    hours_on_backup += 1
            # pumped hydro (regional) behaves like a big backup device
            if prot_rem > 0 and ph_kw > 0 and ph_kwh > 0:
                d = min(prot_rem, ph_kw, ph_kwh)
                ph_kwh -= d
                prot_rem -= d
                ph_out = d
            # fuel cell
            if prot_rem > 0 and fc_kw > 0 and h2_kwh > 0:
                d = min(prot_rem, fc_kw, h2_kwh)
                h2_kwh -= d
                prot_rem -= d
                fc = d
                h2_used += d
            # generator (last tier) — fuel is not energy-limited, so it may also carry non-essential load
            if prot_rem + non_rem > 0 and gen_kw > 0:
                d_p = min(prot_rem, gen_kw)
                d_n = min(non_rem, gen_kw - d_p)
                prot_rem -= d_p
                non_rem -= d_n
                g_kw = d_p + d_n
                gen_kwh += g_kw
                fuel_l += g_kw * ECON["diesel_l_per_kwh"]
            # shedding: non-essential first, then essential, critical last
            shed["non_essential"] = max(0.0, non_rem)
            shed["essential"] = min(prot_rem, ess[h])
            shed["critical"] = max(0.0, prot_rem - shed["essential"])
            for cls in shed:
                unserved[cls] += shed[cls]
        min_soc = min(min_soc, soc)
        rows.append({
            "hour": h, "load_kw": round(demand, 1), "critical_kw": round(crit[h], 1), "essential_kw": round(ess[h], 1),
            "non_essential_kw": round(non[h], 1), "pv_kw": round(supply_pv, 1), "wind_kw": round(supply_wind, 1),
            "grid_available": avail[h], "outage_event": in_event[h], "grid_import_kw": round(g_import, 1),
            "backup_charge_kw": round(b_charge, 1), "backup_discharge_kw": round(b_dis, 1),
            "soc_pct": round(100 * soc / cap, 1) if cap > 0 else 0.0, "generator_kw": round(g_kw, 1),
            "fuel_cell_kw": round(fc, 1), "pumped_hydro_kw": round(ph_out, 1), "curtailed_kw": round(max(0.0, surplus), 1),
            "unserved_kw": round(sum(shed.values()), 1), "unserved_critical_kw": round(shed["critical"], 1),
        })
        grid_import += g_import

    crit_total = sum(crit)
    ess_total = sum(ess)
    tot = sum(total)
    ren_total = pv_used + wind_used
    served_total = tot - sum(unserved.values())
    event_hours_list = [i for i in range(24) if in_event[i]]
    crit_ok = unserved["critical"] < 0.01 * max(crit_total, 1)
    return {
        "hourly": rows,
        "summary": {
            "critical_served_pct": round(100 * (1 - unserved["critical"] / max(crit_total, 1e-6)), 1),
            "essential_served_pct": round(100 * (1 - unserved["essential"] / max(ess_total, 1e-6)), 1),
            "total_served_pct": round(100 * served_total / max(tot, 1e-6), 1),
            "unserved_kwh": round(sum(unserved.values()), 1), "unserved_critical_kwh": round(unserved["critical"], 1),
            "unserved_essential_kwh": round(unserved["essential"], 1), "unserved_non_essential_kwh": round(unserved["non_essential"], 1),
            "critical_supplied_during_outage": crit_ok,
            "hours_on_backup": hours_on_backup, "min_soc_pct": round(100 * min_soc / cap, 1) if cap > 0 else 0.0,
            "pv_used_kwh": round(pv_used, 1), "wind_used_kwh": round(wind_used, 1), "curtailed_kwh": round(curtailed, 1),
            "grid_import_kwh": round(grid_import, 1), "generator_kwh": round(gen_kwh, 1), "fuel_l": round(fuel_l, 1),
            "backup_discharge_kwh": round(bat_dis_kwh, 1), "backup_grid_charge_kwh": round(bat_grid_charge, 1), "hydrogen_kwh": round(h2_used, 1),
            "renewable_share_pct": round(100 * ren_total / max(served_total, 1e-6), 1),
            "grid_hours": sum(avail), "outage_hours": 24 - sum(avail), "event_window": [event_start, event_hours],
            "event_hours": event_hours_list,
        },
    }
