"""POST /api/assess — the decision engine; GET /api/technologies — knowledge layer."""
from __future__ import annotations


from fastapi import APIRouter

from app.config import settings
from app.core.geo import haversine_km, in_africa, in_nigeria
from app.core.http import gather_safe
from app.ml import backup_classifier
from app.engine.agent import run_agent
from app.engine.catalogue import REFERENCES, TECHNOLOGIES
from app.engine.profiles import FACILITY_TYPES, build_load_model
from app.engine.investment import build_case
from app.engine.recommend import DIMENSION_LABELS, WEIGHTS, evaluate
from app.engine.relocatable import build_relocatable_case
from app.engine.resilience import survival_curve
from app.engine.scoring import site_summary
from app.models import AssessRequest
from app.services import fallback, knowledge
from app.services.geocode import reverse_geocode, elevation
from app.services.grid import grid_profile
from app.services.resources import climatology, typical_day
from app.services.water import water_profile

router = APIRouter(tags=["assessment"])


@router.get("/technologies", summary="All storage / generation technologies (knowledge layer) + references")
async def technologies():
    return {"technologies": [{"id": k, **v} for k, v in TECHNOLOGIES.items()], "references": REFERENCES,
            "weights": WEIGHTS, "dimension_labels": DIMENSION_LABELS}


@router.get("/ml/model", summary="Model card of the explainable architecture classifier (ML surrogate of the engine)")
async def ml_model():
    return backup_classifier.model_card()


async def new_site_profile(lat: float, lng: float, ns, supply_hours: float | None = None) -> dict:
    """Sun and grid at the hospital's new building site (Brief 12). The new building's feeder hours are unknown until
    it is connected, so today's reported hours are assumed there (same distribution company) — never a better grid."""
    geo2, clim2 = await gather_safe(reverse_geocode(ns.lat, ns.lng), climatology(ns.lat, ns.lng))
    if not isinstance(geo2, dict):
        from app.services.geocode import _fallback_place
        geo2 = _fallback_place(ns.lat, ns.lng)
    psh = clim2["annual_psh"] if isinstance(clim2, dict) else round(sum(fallback.model_climatology(ns.lat, ns.lng)["ghi_kwh_m2_day"]) / 12, 2)
    grid2 = await grid_profile(ns.lat, ns.lng, geo2.get("country_code", "XX"), geo2.get("state_iso"), 30, None, supply_hours)
    rel = grid2["reliability"]
    return {"lat": ns.lat, "lng": ns.lng, "label": ns.label or geo2.get("name"), "place": geo2.get("name"), "distance_km": round(haversine_km(lat, lng, ns.lat, ns.lng), 1),
            "psh": psh, "grid_class": rel["grid_class"], "grid_label": rel["class_label"], "supply_hours": rel["expected_supply_hours_per_day"],
            "grid_score": rel["reliability_score"], "substations_30km": grid2["power"]["summary"].get("substations"),
            "nearest_substation_km": grid2["power"]["summary"].get("nearest_substation_km"),
            "note": ("The new building's feeder hours are unknown until it is connected, so today's reported hours are assumed."
                     if supply_hours is not None else "The new building's feeder hours are unknown until it is connected, so the state class is used.")}


@router.post("/ml/predict", summary="ML pick for a facility configuration at a site: Random Forest probabilities + CART rules (fast, no simulation)")
async def ml_predict(req: AssessRequest):
    model = backup_classifier.load_model()
    if not model:
        return {"available": False}
    inp = await _site_inputs(req)
    diesel = inp["econ"].get("diesel_price_usd_per_l", settings.diesel_price_usd_per_l)
    x = backup_classifier.features_from(inp["site"], inp["load"], inp["fac_dict"], inp["existing"], diesel)
    pred = backup_classifier.predict(model, x)
    return {"available": True, "prediction": pred, "model": model["meta"],
            "facility_label": FACILITY_TYPES.get(req.facility.type, FACILITY_TYPES["custom"])["label"],
            "site": {"grid_class": inp["site"]["grid"]["class"], "supply_hours": inp["site"]["grid"]["supply_hours"],
                     "psh": inp["site"]["solar"]["annual_psh"], "wind_ms": inp["site"]["wind"]["annual_ws50"]},
            "load": {k: inp["load"].get(k) for k in ("avg_load_kw", "peak_load_kw", "critical_peak_kw", "protected_peak_kw", "daily_kwh")}}


async def _site_inputs(req: AssessRequest) -> dict:
    """Everything the engine and the ML model read about a site and a facility (shared by /assess and /ml/predict)."""
    lat, lng = req.location.lat, req.location.lng
    fac = req.facility
    opts = req.options

    geo, clim, elev = await gather_safe(reverse_geocode(lat, lng), climatology(lat, lng), elevation(lat, lng))
    if not isinstance(geo, dict):
        from app.services.geocode import _fallback_place
        geo = _fallback_place(lat, lng)
    if not isinstance(clim, dict):
        m = fallback.model_climatology(lat, lng)
        clim = {"monthly_psh": m["ghi_kwh_m2_day"], "monthly_ghi_kwh_m2": [round(v * d, 1) for v, d in zip(m["ghi_kwh_m2_day"], fallback.DAYS)],
                "annual_ghi_kwh_m2": round(sum(v * d for v, d in zip(m["ghi_kwh_m2_day"], fallback.DAYS)), 1),
                "annual_psh": round(sum(m["ghi_kwh_m2_day"]) / 12, 2), "monthly_wind_10m_ms": m["ws10m"], "monthly_wind_50m_ms": m["ws50m"],
                "monthly_temp_c": m["t2m"], "monthly_precip_mm_day": m["precip_mm_day"], "sources": ["model"], "ghi_source": "model", "live": False}
    water, grid, hourly = await gather_safe(
        water_profile(lat, lng, 10, clim["monthly_precip_mm_day"]),
        grid_profile(lat, lng, geo.get("country_code", "XX"), geo.get("state_iso"), opts.radius_km, opts.grid_class_override, opts.supply_hours_override),
        typical_day(lat, lng, opts.month),
    )
    if not isinstance(water, dict):
        water = {"waterways": {"count": 0, "nearest": None, "features": [], "source": "unavailable"}, "discharge": {"source": "unavailable"},
                 "terrain": {"head_up_m": 0, "head_down_m": 0}, "scores": {"water_availability": 30, "micro_hydro": 10, "pumped_hydro": 10,
                 "hydrogen_water": 55, "nearest_distance_km": None, "discharge_class": "unknown", "head_m": 0, "rain_mm_yr": 0}}
    if not isinstance(grid, dict):
        from app.services.grid import reliability_profile
        power = {"source": "unavailable", "summary": {"substations": 0, "plants": 0, "lines": 0, "hv_substations": 0, "max_voltage_kv": 0,
                                                       "plant_capacity_mw": 0, "nearest_substation_km": None, "nearest_line_km": None},
                 "substations": [], "plants": [], "lines": []}
        grid = {"power": power, "country": {}, "reliability": reliability_profile(lat, lng, geo.get("country_code", "XX"), geo.get("state_iso"), power, {},
                                                                                 opts.grid_class_override, opts.supply_hours_override)}
    if not isinstance(hourly, dict):
        m = fallback.model_climatology(lat, lng)
        hourly = fallback.model_hourly_day(clim["monthly_psh"][opts.month], clim["monthly_wind_50m_ms"][opts.month], clim["monthly_temp_c"][opts.month], lat, opts.month)

    # user-entered water source improves hydrogen-water feasibility
    ws = water["scores"]
    if fac.water_source in ("municipal", "borehole"):
        ws["hydrogen_water"] = max(ws["hydrogen_water"], 75)
    elif fac.water_source in ("river", "lake"):
        ws["hydrogen_water"] = max(ws["hydrogen_water"], 85)
        ws["water_availability"] = max(ws["water_availability"], 70)

    site = site_summary(clim, water, grid)
    if not fac.existing.grid_connection:   # off-grid hospital: no grid hours at all, whatever the area's class
        site["grid"] = {**site["grid"], "supply_hours": 0, "label": f"{site['grid']['label']} area · not connected"}
    load = build_load_model(fac.type, fac.beds, fac.avg_load_kw, fac.critical_load_kw, fac.daily_kwh)
    existing = fac.existing.model_dump()
    fac_dict = fac.model_dump()
    econ = {k: v for k, v in {"usd_to_ngn": opts.usd_to_ngn, "diesel_price_usd_per_l": opts.diesel_price_usd_per_l,
                              "grid_tariff_usd_per_kwh": opts.grid_tariff_usd_per_kwh}.items() if v is not None}
    return {"geo": geo, "clim": clim, "elev": elev, "water": water, "grid": grid, "hourly": hourly, "site": site, "load": load,
            "existing": existing, "fac_dict": fac_dict, "econ": econ}


@router.post("/assess", summary="Run the full location-aware resilience assessment")
async def assess(req: AssessRequest):
    lat, lng = req.location.lat, req.location.lng
    fac = req.facility
    opts = req.options
    inp = await _site_inputs(req)
    geo, clim, elev, water, grid, hourly = inp["geo"], inp["clim"], inp["elev"], inp["water"], inp["grid"], inp["hourly"]
    site, load, existing, fac_dict, econ = inp["site"], inp["load"], inp["existing"], inp["fac_dict"], inp["econ"]
    engine_opts = {"outage_start_hour": opts.outage_start_hour, "charge_from_grid": opts.charge_from_grid, "econ": econ}
    result = evaluate(site, water, load, fac_dict, hourly, existing, engine_opts)
    rec = result["recommended"]
    loc_payload = {**geo, "lat": lat, "lng": lng}
    investment = build_case(rec, result["ranked"], load, site, fac_dict, loc_payload, existing)
    agent = run_agent(site, load, fac_dict, hourly, existing, engine_opts, result, investment)
    reloc = opts.relocation.model_dump() if opts.relocation else {}
    new_site = (await new_site_profile(lat, lng, opts.relocation.new_site, opts.supply_hours_override)
                if opts.relocation and opts.relocation.new_site else None)
    relocatable_case = build_relocatable_case(rec, load, site, fac_dict, investment, agent, reloc, new_site, result["ranked"], geo.get("country_code"))
    resilience = survival_curve(load, hourly, rec["components"], site["grid"]["supply_hours"], opts.charge_from_grid)
    out = {
        "engine": {"name": settings.app_name, "version": settings.version, "mode": "offline" if settings.offline else "live",
                   "disclaimer": "Pre-feasibility decision support (±30 %). Not a substitute for an engineering study."},
        "location": {**geo, "lat": lat, "lng": lng, "elevation_m": int(round(elev)) if isinstance(elev, (int, float)) else 0,
                     "in_africa": in_africa(lat, lng), "in_nigeria": in_nigeria(lat, lng)},
        "inputs": {"facility": fac_dict, "options": opts.model_dump(), "facility_label": FACILITY_TYPES.get(fac.type, FACILITY_TYPES["custom"])["label"]},
        "climate": clim, "hourly_profile": hourly,
        "water": {k: v for k, v in water.items() if k != "waterways"} | {"waterways": {k: v for k, v in water["waterways"].items() if k != "features"}},
        "grid": {"reliability": grid["reliability"], "country": grid.get("country", {}), "power_summary": grid["power"]["summary"], "power_source": grid["power"].get("source")},
        "site": site, "load": load,
        "recommended": rec, "ranked": result["ranked"], "recommended_stack": result["recommended_stack"], "investment_case": investment, "agent": agent,
        "relocatable_case": relocatable_case,
        "resilience": resilience,
        "weights": result["weights"], "dimension_labels": result["dimension_labels"], "references": result["references"],
    }
    knowledge.record_assessment(out)   # a short record in the internal database (history)
    return out
