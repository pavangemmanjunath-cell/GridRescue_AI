"""Solar-yield cross-check from the sources the hackathon brief names — three independent answers to
"how many kWh does one kWp of ground-mounted PV make here in a year?"

  * NASA POWER climatology (already used by the engine)  → GHI, worst month
  * PVGIS 5.2 PVcalc (EU JRC, SARAH-2)                    → kWh/kWp/yr
  * NLR PVWatts v8 (US National Laboratory of the Rockies, formerly NREL; NSRDB Meteosat Prime Meridian TMY)
  * Global Solar Atlas (World Bank · Solargis)             → kWh/kWp/yr, long-term average
    The old developer.nrel.gov host no longer resolves; the same API answers on developer.nlr.gov.
"""
from __future__ import annotations

from app.config import settings
from app.core.cache import cached
from app.core.http import fetch_json, gather_safe
from app.services import fallback
from app.services.open_data import global_solar_atlas
from app.services.resources import nasa_climatology

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
PVWATTS_URL = "https://developer.nlr.gov/api/pvwatts/v8.json"
PVGIS_PVCALC = "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc"


@cached("nlr_pvwatts_v8", ttl=30 * 86400)
async def pvwatts(lat: float, lng: float) -> dict:
    """Annual and monthly AC yield of 1 kWp of fixed PV tilted at the latitude, facing the equator."""
    tilt = round(abs(lat), 0)
    params = {"api_key": settings.nlr_api_key, "lat": lat, "lon": lng, "system_capacity": 1, "azimuth": 180 if lat >= 0 else 0,
              "tilt": tilt, "array_type": 0, "module_type": 0, "losses": 14}
    last_err = "no output"
    for dataset in ("nsrdb", "intl"):
        data = await fetch_json(PVWATTS_URL, params={**params, "dataset": dataset}, timeout=30)
        out = data.get("outputs") or {}
        if out.get("ac_annual"):
            st = data.get("station_info") or {}
            return {"source": "NLR PVWatts v8 (formerly NREL)", "dataset": st.get("weather_data_source") or dataset,
                    "kwh_per_kwp_year": round(out["ac_annual"], 0), "monthly_kwh_per_kwp": [round(v, 1) for v in out.get("ac_monthly", [])],
                    "solrad_kwh_m2_day": round(out.get("solrad_annual", 0), 2), "tilt_deg": tilt}
        last_err = (data.get("errors") or [last_err])[0]
    raise RuntimeError(f"PVWatts: {last_err}")


@cached("pvgis_pvcalc", ttl=30 * 86400)
async def pvgis_yield(lat: float, lng: float) -> dict:
    data = await fetch_json(PVGIS_PVCALC, params={"lat": lat, "lon": lng, "peakpower": 1, "loss": 14, "optimalangles": 1, "outputformat": "json"}, timeout=30)
    fixed = data["outputs"]["totals"]["fixed"]
    return {"source": f"PVGIS 5.2 ({data['inputs']['meteo_data']['radiation_db']})", "kwh_per_kwp_year": round(fixed["E_y"], 0),
            "tilt_deg": data["inputs"]["mounting_system"]["fixed"]["slope"]["value"]}


async def solar_check(lat: float, lng: float) -> dict:
    nasa, pvw, pvg, gsa = await gather_safe(nasa_climatology(lat, lng), pvwatts(lat, lng), pvgis_yield(lat, lng), global_solar_atlas(lat, lng))
    live_nasa = isinstance(nasa, dict)
    base = nasa if live_nasa else fallback.model_climatology(lat, lng)
    m = [v or 0.0 for v in base["ghi_kwh_m2_day"]]
    worst = min(range(12), key=lambda i: m[i])
    rows = [{"id": "nasa", "source": "NASA POWER climatology" if live_nasa else "Climatology model (offline)", "value": round(sum(m) / 12, 2),
             "unit": "kWh/m² a day", "note": f"worst month {MONTHS[worst]} {m[worst]:.2f}", "live": live_nasa}]
    rows.append({"id": "pvgis", "source": pvg["source"] if isinstance(pvg, dict) else "PVGIS 5.2", "value": pvg["kwh_per_kwp_year"] if isinstance(pvg, dict) else None,
                 "unit": "kWh per kWp a year", "note": f"optimal tilt {pvg['tilt_deg']}°" if isinstance(pvg, dict) else "not reachable", "live": isinstance(pvg, dict)})
    rows.append({"id": "pvwatts", "source": pvw["source"] if isinstance(pvw, dict) else "NLR PVWatts v8", "value": pvw["kwh_per_kwp_year"] if isinstance(pvw, dict) else None,
                 "unit": "kWh per kWp a year", "note": (pvw["dataset"] if isinstance(pvw, dict) else "not reachable"), "live": isinstance(pvw, dict)})
    rows.append({"id": "gsa", "source": gsa["source"] if isinstance(gsa, dict) else "Global Solar Atlas", "value": gsa["pvout_kwh_per_kwp_year"] if isinstance(gsa, dict) else None,
                 "unit": "kWh per kWp a year", "note": f"optimal tilt {gsa['optimal_tilt_deg']}°" if isinstance(gsa, dict) else "not reachable", "live": isinstance(gsa, dict)})
    yields = [r["value"] for r in rows if r["id"] != "nasa" and r["value"]]
    spread = round(100 * (max(yields) - min(yields)) / max(yields), 1) if len(yields) >= 2 else None
    return {"lat": lat, "lng": lng, "rows": rows, "yield_spread_pct": spread,
            "agreement": None if spread is None else ("good" if spread <= 10 else "check"),
            "pvwatts_monthly": pvw.get("monthly_kwh_per_kwp") if isinstance(pvw, dict) else None}
