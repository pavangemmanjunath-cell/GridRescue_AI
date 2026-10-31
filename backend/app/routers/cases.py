"""GET /api/cases — ready-made hackathon cases (a hospital, its brief and the inputs that reproduce it)."""
from __future__ import annotations

import json
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query

from app.config import DATA_DIR
from app.services.consumption import daily_consumption
from app.services.relocation import suggest_sites
from app.services.tariffs import tariff_here

router = APIRouter(tags=["cases"])
CASES_DIR = DATA_DIR / "cases"


@lru_cache(maxsize=1)
def _cases() -> dict[str, dict]:
    out = {}
    for p in sorted(CASES_DIR.glob("*.json")):
        c = json.loads(p.read_text(encoding="utf-8"))
        out[c["id"]] = c
    return out


@router.get("/cases", summary="Ready-made cases (e.g. Brief 12 — National Orthopaedic Hospital, Enugu)")
async def list_cases():
    return {"cases": [{"id": c["id"], "title": c["brief"]["title"], "brief": c["brief"]["number"], "hospital": c["hospital"]["name"]} for c in _cases().values()]}


@router.get("/relocation/suggest", summary="Grid lens for a hospital that is moving: areas around it ranked by grid access and move distance")
async def relocation_suggest(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180),
                             radius_km: float = Query(15, ge=5, le=30), top: int = Query(5, ge=1, le=12)):
    return await suggest_sites(lat, lng, radius_km, top)


@router.get("/tariff", summary="Published grid price at this place, now (or at a given hour): rate, time-of-use period, night note, source")
async def get_tariff(lat: float = Query(..., ge=-90, le=90), lng: float = Query(..., ge=-180, le=180), hour: float | None = Query(None, ge=0, lt=24)):
    return await tariff_here(lat, lng, hour)


@router.get("/cases/{case_id}/consumption", summary="The hospital's daily consumption: meter log if present, else the engine's estimate (hourly kWh, peak, protected share)")
async def case_consumption(case_id: str, daily_kwh: float | None = Query(None, ge=100, le=200000, description="override the day's total (hand-dialled)")):
    c = _cases().get(case_id)
    if c is None:
        raise HTTPException(404, f"unknown case {case_id}")
    return daily_consumption(c, daily_kwh)


@router.get("/cases/{case_id}", summary="One case: the brief, the hospital, and the facility + options that reproduce it")
async def get_case(case_id: str):
    c = _cases().get(case_id)
    if c is None:
        raise HTTPException(404, f"unknown case {case_id}")
    return c
