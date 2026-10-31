"""Water, grid, facilities and country-indicator endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.http import gather_safe
from app.engine.profiles import FACILITY_TYPES
from app.services.facilities import nearby_facilities
from app.services.health_providers import PROVIDERS, featured, provider_status
from app.engine.profiles import build_load_model
from app.models import FacilityInput
from app.services.geocode import reverse_geocode
from app.services.grid import country_indicators, grid_profile, grid_scan
from app.services.resources import climatology
from app.services.water import water_profile

router = APIRouter(tags=["layers"])


@router.get("/water", summary="Rivers/streams/lakes nearby, GloFAS river discharge, terrain head, rainfall → hydro scores")
async def get_water(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180), radius_km: float = Query(10, ge=2, le=50)):
    clim = await climatology(lat, lng)
    return await water_profile(lat, lng, radius_km, clim["monthly_precip_mm_day"])


@router.get("/grid", summary="OSM power infrastructure + reliability / outage class")
async def get_grid(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180),
                   radius_km: float = Query(30, ge=5, le=100), grid_class: str | None = Query(None, pattern="^[A-E]$"),
                   supply_hours: float | None = Query(None, ge=0, le=24, description="grid hours a day reported by the facility")):
    geo = await reverse_geocode(lat, lng)
    return await grid_profile(lat, lng, geo.get("country_code", "XX"), geo.get("state_iso"), radius_km, grid_class, supply_hours)

@router.get("/grid/scan", summary="Grid strength in 50 km and 100 km rings around a site (one lookup, local OSM snapshot in Nigeria)")
async def get_grid_scan(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180),
                        grid_class: str | None = Query(None, pattern="^[A-E]$"),
                        supply_hours: float | None = Query(None, ge=0, le=24, description="grid hours a day reported by the facility")):
    geo = await reverse_geocode(lat, lng)
    return await grid_scan(lat, lng, geo.get("country_code", "XX"), geo.get("state_iso"), grid_class, supply_hours)


@router.get("/facilities", summary="Hospitals and clinics nearby (OSM + curated Nigerian tertiary list)")
async def get_facilities(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180), radius_km: float = Query(25, ge=2, le=100)):
    return await nearby_facilities(lat, lng, radius_km)


@router.get("/country/{country_code}", summary="World Bank electricity indicators for a country")
async def get_country(country_code: str):
    return await country_indicators(country_code)


@router.get("/facility-types", summary="Facility archetypes with default load assumptions")
async def facility_types():
    return {"types": [{"id": k, **v} for k, v in FACILITY_TYPES.items()]}


@router.get("/site", summary="Everything the explorer needs in one call (location, climate, water, grid, facilities)")
async def get_site(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180)):
    geo, clim = await gather_safe(reverse_geocode(lat, lng), climatology(lat, lng))
    if not isinstance(geo, dict):
        geo = {"country_code": "XX"}
    water, grid, fac = await gather_safe(
        water_profile(lat, lng, 10, clim["monthly_precip_mm_day"] if isinstance(clim, dict) else None),
        grid_profile(lat, lng, geo.get("country_code", "XX"), geo.get("state_iso"), 30),
        nearby_facilities(lat, lng, 25),
    )
    return {"location": geo, "climate": clim if isinstance(clim, dict) else None,
            "water": water if isinstance(water, dict) else None, "grid": grid if isinstance(grid, dict) else None,
            "facilities": fac if isinstance(fac, dict) else None}


@router.get("/health-data/providers", summary="Who provides health-facility data for Africa (and what is wired in)")
async def health_data_providers():
    return {"providers": provider_status(), "note": "OSM Overpass is queried live; drop CSV exports of the other datasets into backend/app/data/external/ to merge them."}


@router.get("/hospitals/featured", summary="Curated referral hospitals (Nigeria + Africa) for the hospital-first workflow")
async def hospitals_featured(country_code: str | None = Query(None, min_length=2, max_length=2)):
    items = featured(country_code)
    return {"count": len(items), "facilities": items}


@router.post("/load-model", summary="Power requirement of a facility from beds / type / explicit loads (no site data needed)")
async def load_model(facility: FacilityInput):
    lm = build_load_model(facility.type, facility.beds, facility.avg_load_kw, facility.critical_load_kw, facility.daily_kwh)
    hours = facility.backup_hours
    return {**{k: v for k, v in lm.items() if k != "hourly"}, "hourly": lm["hourly"], "backup_hours": hours,
            "energy_to_ride_through_kwh": round(lm["protected_daily_kwh"] / 24 * hours, 0),
            "statement": (f"{facility.name or lm['facility_label']} needs about {lm['avg_load_kw']:.0f} kW on average and {lm['peak_load_kw']:.0f} kW at peak "
                          f"({lm['daily_kwh']:.0f} kWh/day). {lm['critical_peak_kw']:.0f} kW is life-critical and must never see a break; "
                          f"{lm['protected_peak_kw']:.0f} kW must ride through a {hours:g}-hour outage ≈ {lm['protected_daily_kwh'] / 24 * hours:,.0f} kWh of stored or generated energy.")}
