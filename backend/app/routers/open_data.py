"""The organisers' open data and tools: ENERGYDATA.INFO datasets, the grid-first feeder check, the grid as GeoJSON for QGIS,
and the list of every source GridRescue uses."""
from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.services.feeder import site_feeders
from app.services.geocode import reverse_geocode
from app.services.grid import ISO2_TO_ISO3, nearby_power
from app.services.open_data import energydata_datasets, global_solar_atlas, grid_geojson, sources

router = APIRouter(tags=["open data"])


@router.get("/sources", summary="Every open data source and tool GridRescue uses (the GEH 2026 list), and its status")
def get_sources():
    return {"sources": sources()}


@router.get("/solar-atlas", summary="Global Solar Atlas: long-term PV output per kWp, GHI and optimal tilt")
async def get_solar_atlas(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180)):
    return await global_solar_atlas(lat, lng)


@router.get("/energydata", summary="World Bank ENERGYDATA.INFO: the open energy datasets for the site's country")
async def get_energydata(lat: float | None = Query(None, ge=-90, le=90), lng: float | None = Query(None, ge=-180, le=180),
                         cc: str | None = Query(None, min_length=2, max_length=3)):
    if not cc and lat is not None and lng is not None:
        cc = (await reverse_geocode(lat, lng)).get("country_code")
    cc = (cc or "NG").upper()
    try:
        return await energydata_datasets(ISO2_TO_ISO3.get(cc, cc))
    except Exception as e:   # the portal is down: say so, with the link
        return {"source": "World Bank ENERGYDATA.INFO", "country": cc, "count": 0, "datasets": [], "error": f"not reachable ({type(e).__name__})",
                "url": "https://energydata.info"}


@router.get("/grid/feeder", summary="Grid-first feeder check: a dedicated 11 / 33 kV feeder from the nearest substation (pandapower model)")
async def get_feeder(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180),
                     kw: float = Query(..., gt=0, le=200_000, description="protected load to carry, kW"),
                     kw_connected: float | None = Query(None, gt=0, le=500_000, description="whole facility, kW")):
    power = await nearby_power(lat, lng, 30.0)
    return {"lat": lat, "lng": lng, **site_feeders(power, kw, kw_connected)}


@router.get("/grid/geojson", summary="The mapped grid around a site as GeoJSON (substations, lines, plants), to open in QGIS")
async def get_grid_geojson(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180),
                           radius_km: float = Query(30, ge=5, le=100), name: str | None = Query(None, max_length=120)):
    power = await nearby_power(lat, lng, radius_km)
    return JSONResponse(grid_geojson(power, {"lat": lat, "lng": lng, "name": name}), media_type="application/geo+json",
                        headers={"Content-Disposition": 'attachment; filename="gridrescue_grid.geojson"'})
