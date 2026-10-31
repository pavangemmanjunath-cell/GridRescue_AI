"""Sun / wind / weather / climate / hourly-profile endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.http import gather_safe
from app.services.resources import SECTORS, climatology, typical_day, weather, wind_rose
from app.services.solar_check import solar_check

router = APIRouter(tags=["resources"])


@router.get("/sun", summary="Monthly peak-sun-hours and GHI (PVGIS → NASA POWER → model)")
async def get_sun(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180)):
    c = await climatology(lat, lng)
    return {"annual_ghi_kwh_m2": c["annual_ghi_kwh_m2"], "annual_psh": c["annual_psh"], "monthly_psh": c["monthly_psh"],
            "monthly_ghi_kwh_m2": c["monthly_ghi_kwh_m2"], "monthly_temp_c": c["monthly_temp_c"], "source": c["ghi_source"],
            "sources": c["sources"], "live": c["live"]}


@router.get("/wind", summary="Monthly wind speeds (10 m / 50 m) and 8-sector wind rose")
async def get_wind(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180)):
    c, rose = await gather_safe(climatology(lat, lng), wind_rose(lat, lng))
    if not isinstance(c, dict):
        raise RuntimeError("climatology unavailable")
    if not isinstance(rose, dict):
        rose = {"sectors": {s: {"freq": 12.5, "speed": 0.0} for s in SECTORS}, "source": "unavailable"}
    m50 = c["monthly_wind_50m_ms"]
    return {"annual_avg_ms": round(sum(m50) / 12, 2), "monthly_avg_ms": m50, "monthly_avg_10m_ms": c["monthly_wind_10m_ms"],
            "wind_rose": [{"direction": s, "frequency_pct": rose["sectors"][s]["freq"], "avg_speed_ms": rose["sectors"][s]["speed"]} for s in SECTORS],
            "rose_source": rose.get("source"), "rose_year": rose.get("year"), "sources": c["sources"]}


@router.get("/weather", summary="Current conditions + 7-day forecast (Open-Meteo)")
async def get_weather(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180)):
    try:
        return await weather(lat, lng)
    except Exception as exc:  # offline → empty but valid payload
        return {"current": None, "forecast": [], "timezone": "UTC", "source": "unavailable", "error": str(exc)[:120]}


@router.get("/climate", summary="Merged monthly climatology (solar, wind, temperature, rainfall)")
async def get_climate(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180)):
    return await climatology(lat, lng)


@router.get("/solar-check", summary="Solar-yield cross-check: NASA POWER, PVGIS and NLR PVWatts (formerly NREL) for one site")
async def get_solar_check(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180)):
    return await solar_check(lat, lng)


@router.get("/hourly", summary="Typical-day hourly GHI / wind / temperature for a month (ERA5 reanalysis)")
async def get_hourly(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180), month: int = Query(2, ge=0, le=11)):
    return await typical_day(lat, lng, month)
