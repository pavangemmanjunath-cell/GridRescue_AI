"""Solar, wind, temperature, rainfall and hourly profiles.

Primary sources (all free, keyless):
  * PVGIS 5.2 MRcalc (EU JRC, SARAH-2 covers Africa)          → monthly horizontal irradiation
  * NASA POWER climatology (2001–2020)                           → GHI, wind 10 m/50 m, temp, rain
  * Open-Meteo archive (ERA5, hourly)                            → wind rose + typical-day profiles
Fallback: bundled snapshots / climatology model (services.fallback).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from app.core.cache import cached
from app.core.http import fetch_json, gather_safe
from app.services import fallback

PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_2/MRcalc"
NASA_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"
OM_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
OM_FORECAST = "https://api.open-meteo.com/v1/forecast"

MONTHS = fallback.MONTHS
DAYS = fallback.DAYS
SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


# ─── NASA POWER (one call gives solar + wind + temp + rain) ───────────────────────────
@cached("nasa_climatology", ttl=30 * 86400)
async def nasa_climatology(lat: float, lng: float) -> dict:
    data = await fetch_json(
        NASA_URL,
        params={"parameters": "ALLSKY_SFC_SW_DWN,WS10M,WS50M,T2M,PRECTOTCORR,RH2M", "community": "RE",
                "longitude": lng, "latitude": lat, "format": "JSON"},
        timeout=30,
    )
    p = data["properties"]["parameter"]

    def series(key: str) -> list[float]:
        vals = p.get(key, {})
        return [None if vals.get(m, -999) == -999 else round(float(vals.get(m, 0)), 2) for m in MONTHS]

    return {
        "ghi_kwh_m2_day": series("ALLSKY_SFC_SW_DWN"),
        "ws10m": series("WS10M"),
        "ws50m": series("WS50M"),
        "t2m": series("T2M"),
        "precip_mm_day": series("PRECTOTCORR"),
        "rh2m": series("RH2M"),
        "source": "nasa-power",
    }


@cached("pvgis_monthly", ttl=30 * 86400)
async def pvgis_monthly(lat: float, lng: float) -> dict:
    data = await fetch_json(
        PVGIS_URL,
        params={"lat": lat, "lon": lng, "horirrad": 1, "startyear": 2020, "endyear": 2020, "outputformat": "json"},
        timeout=30,
    )
    monthly = [0.0] * 12
    for row in data.get("outputs", {}).get("monthly", []):
        monthly[int(row["month"]) - 1] = float(row.get("H(h)_m", 0))
    db = data.get("inputs", {}).get("meteo_data", {}).get("radiation_db", "PVGIS")
    return {"monthly_ghi_kwh_m2": [round(v, 1) for v in monthly], "source": f"pvgis:{db}"}


async def climatology(lat: float, lng: float) -> dict:
    """Merged monthly climatology: PVGIS GHI (preferred), NASA wind/temp/rain, model fallback."""
    nasa, pv = await gather_safe(nasa_climatology(lat, lng), pvgis_monthly(lat, lng))
    base = nasa if isinstance(nasa, dict) else fallback.model_climatology(lat, lng)
    sources = [base.get("source", "model")]
    if isinstance(pv, dict) and sum(pv["monthly_ghi_kwh_m2"]) > 0:
        ghi_day = [round(v / d, 2) for v, d in zip(pv["monthly_ghi_kwh_m2"], DAYS)]
        base = {**base, "ghi_kwh_m2_day": ghi_day, "ghi_source": pv["source"]}
        sources.insert(0, pv["source"])
    elif "pvgis_ghi_kwh_m2_month" in base:
        base = {**base, "ghi_kwh_m2_day": [round(v / d, 2) for v, d in zip(base["pvgis_ghi_kwh_m2_month"], DAYS)],
                "ghi_source": "snapshot:pvgis"}
    else:
        base = {**base, "ghi_source": base.get("source", "model")}
    ghi = [v if v is not None else 0.0 for v in base["ghi_kwh_m2_day"]]
    monthly_ghi = [round(v * d, 1) for v, d in zip(ghi, DAYS)]
    return {
        "monthly_psh": [round(v, 2) for v in ghi],
        "monthly_ghi_kwh_m2": monthly_ghi,
        "annual_ghi_kwh_m2": round(sum(monthly_ghi), 1),
        "annual_psh": round(sum(ghi) / 12, 2),
        "monthly_wind_10m_ms": [v if v is not None else 0.0 for v in base.get("ws10m", [0.0] * 12)],
        "monthly_wind_50m_ms": [v if v is not None else 0.0 for v in base.get("ws50m", [0.0] * 12)],
        "monthly_temp_c": [v if v is not None else 0.0 for v in base.get("t2m", [25.0] * 12)],
        "monthly_precip_mm_day": [v if v is not None else 0.0 for v in base.get("precip_mm_day", [0.0] * 12)],
        "monthly_rh_pct": base.get("rh2m"),
        "sources": sources,
        "ghi_source": base.get("ghi_source"),
        "live": base.get("source") in ("nasa-power",) or any(s.startswith("pvgis") for s in sources),
    }


# ─── Wind rose from one year of hourly ERA5 data ─────────────────────────────────────
@cached("wind_rose", ttl=30 * 86400)
async def wind_rose(lat: float, lng: float, year: int | None = None) -> dict:
    yr = year or (date.today().year - 1)
    try:
        data = await fetch_json(
            OM_ARCHIVE,
            params={"latitude": lat, "longitude": lng, "start_date": f"{yr}-01-01", "end_date": f"{yr}-12-31",
                    "hourly": "wind_speed_10m,wind_direction_10m", "timezone": "UTC"},
            timeout=40,
        )
    except Exception:
        rose = fallback.model_wind_rose(lat, lng)
        return {"sectors": rose, "year": yr, "source": "model"}
    speeds = data["hourly"]["wind_speed_10m"]
    dirs = data["hourly"]["wind_direction_10m"]
    buckets: dict[str, dict] = defaultdict(lambda: {"n": 0, "s": 0.0})
    total = 0
    for s, d in zip(speeds, dirs):
        if s is None or d is None:
            continue
        sec = SECTORS[int((d + 22.5) // 45) % 8]
        buckets[sec]["n"] += 1
        buckets[sec]["s"] += s / 3.6  # km/h → m/s
        total += 1
    rose = {sec: {"freq": round(buckets[sec]["n"] / total * 100, 1) if total else 12.5,
                  "speed": round(buckets[sec]["s"] / buckets[sec]["n"], 2) if buckets[sec]["n"] else 0.0}
            for sec in SECTORS}
    return {"sectors": rose, "year": yr, "source": "open-meteo-era5"}


# ─── Current weather + 7-day forecast ─────────────────────────────────────────────────
@cached("weather_now", ttl=1800)
async def weather(lat: float, lng: float) -> dict:
    data = await fetch_json(
        OM_FORECAST,
        params={
            "latitude": lat, "longitude": lng,
            "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,"
                       "wind_direction_10m,cloud_cover,surface_pressure,uv_index,precipitation",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,"
                     "precipitation_sum,wind_speed_10m_max,sunshine_duration,shortwave_radiation_sum",
            "timezone": "auto", "forecast_days": 7,
        },
        timeout=12,
    )
    c = data["current"]
    d = data["daily"]
    days = []
    for i, t in enumerate(d["time"]):
        days.append({
            "date": t, "weather_code": d["weather_code"][i], "temp_max_c": d["temperature_2m_max"][i],
            "temp_min_c": d["temperature_2m_min"][i], "sunrise": d["sunrise"][i], "sunset": d["sunset"][i],
            "uv_index_max": d["uv_index_max"][i], "precipitation_mm": d["precipitation_sum"][i],
            "wind_max_ms": round((d["wind_speed_10m_max"][i] or 0) / 3.6, 1),
            "sunshine_hours": round((d["sunshine_duration"][i] or 0) / 3600, 1),
            "radiation_kwh_m2": round((d["shortwave_radiation_sum"][i] or 0) / 3.6, 2),  # MJ → kWh
        })
    return {
        "current": {
            "temperature_c": c["temperature_2m"], "feels_like_c": c["apparent_temperature"],
            "humidity_pct": c["relative_humidity_2m"], "wind_speed_ms": round(c["wind_speed_10m"] / 3.6, 1),
            "wind_direction_deg": c["wind_direction_10m"], "cloud_cover_pct": c["cloud_cover"],
            "pressure_hpa": c["surface_pressure"], "uv_index": c.get("uv_index", 0),
            "precipitation_mm": c.get("precipitation", 0), "weather_code": c["weather_code"], "time": c["time"],
        },
        "timezone": data.get("timezone", "UTC"), "utc_offset_seconds": data.get("utc_offset_seconds", 0),
        "elevation_m": data.get("elevation"), "forecast": days, "source": "open-meteo",
    }


# ─── Typical hourly day for a month (average of 5 days around the 15th, previous year) ──
@cached("hourly_typical", ttl=30 * 86400)
async def typical_day(lat: float, lng: float, month: int, year: int | None = None) -> dict:
    """Hourly GHI (W/m²), wind at 100 m (m/s) and temperature for a typical day of `month` (0-11)."""
    yr = year or (date.today().year - 1)
    mid = date(yr, month + 1, 15)
    start, end = mid - timedelta(days=2), mid + timedelta(days=2)
    try:
        data = await fetch_json(
            OM_ARCHIVE,
            params={"latitude": lat, "longitude": lng, "start_date": start.isoformat(), "end_date": end.isoformat(),
                    "hourly": "shortwave_radiation,wind_speed_100m,wind_speed_10m,temperature_2m", "timezone": "auto"},
            timeout=40,
        )
        h = data["hourly"]
        n_days = len(h["time"]) // 24
        ghi = [0.0] * 24
        w100 = [0.0] * 24
        w10 = [0.0] * 24
        temp = [0.0] * 24
        for i, _t in enumerate(h["time"]):
            hh = i % 24
            ghi[hh] += (h["shortwave_radiation"][i] or 0) / n_days
            w100[hh] += (h["wind_speed_100m"][i] or 0) / 3.6 / n_days
            w10[hh] += (h["wind_speed_10m"][i] or 0) / 3.6 / n_days
            temp[hh] += (h["temperature_2m"][i] or 0) / n_days
        return {"ghi_w_m2": [round(v, 1) for v in ghi], "wind_ms": [round(v, 2) for v in w100],
                "wind_10m_ms": [round(v, 2) for v in w10], "temp_c": [round(v, 1) for v in temp],
                "timezone": data.get("timezone"), "source": "open-meteo-era5", "days_averaged": n_days, "year": yr}
    except Exception:
        clim = fallback.model_climatology(lat, lng)
        m = fallback.model_hourly_day(clim["ghi_kwh_m2_day"][month], clim["ws50m"][month], clim["t2m"][month], lat, month)
        return {**m, "wind_10m_ms": [round(v * 0.7, 2) for v in m["wind_ms"]], "timezone": "UTC", "year": yr, "days_averaged": 0}
