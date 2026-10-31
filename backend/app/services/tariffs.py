"""Grid electricity price at a place, right now — from the published tariff table (backend/app/data/tariffs.json).

Resolves country (and state in Nigeria) from the reverse geocode, then answers: what does a kWh cost at this hour,
is there a cheaper night period, and where does the figure come from. Nothing is estimated: where a regulator's
rate table could not be read, `rate_now` is null and the time-of-use structure is still described.
"""
from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from zoneinfo import ZoneInfo

from app.config import DATA_DIR, settings
from app.services.geocode import reverse_geocode


@lru_cache(maxsize=1)
def table() -> dict:
    return json.loads((DATA_DIR / "tariffs.json").read_text(encoding="utf-8"))["countries"]


def _in_windows(hour: float, windows: list[list[int]]) -> bool:
    for a, b in windows:
        if (a <= hour < b) if a < b else (hour >= a or hour < b):
            return True
    return False


def price_at(cc: str, state: str | None, hour: float) -> dict | None:
    c = table().get(cc)
    if not c:
        return None
    st = (c.get("states") or {}).get(state or "")
    rate = (st or c).get("rate_per_kwh")
    label = (st or c).get("label")
    source = (st or c).get("source")
    period, rate_now = "flat", rate
    if c.get("tou"):
        rule = c.get("tou_rule", {})
        if _in_windows(hour, rule.get("off_peak", [])):
            period = "off-peak"
            if rate is not None:
                rate_now = round(rate * (1 - rule.get("discount_pct", 0) / 100), 4)
        elif _in_windows(hour, rule.get("peak", [])):
            period = "peak"
        else:
            period = "standard"
    return {"country_code": cc, "country": c["name"], "state": state if st else None, "currency": c["currency"], "symbol": c["symbol"],
            "rate_per_kwh": rate, "rate_now": rate_now, "period": period, "tou": bool(c.get("tou")), "label": label, "source": source,
            "night_note": c.get("night_note"), "tou_text": c.get("tou_rule", {}).get("text"), "bands": c.get("bands")}


async def tariff_here(lat: float, lng: float, hour: float | None = None) -> dict:
    geo = await reverse_geocode(lat, lng)
    cc = (geo.get("country_code") or "XX").upper()
    tz = geo.get("timezone") or "UTC"
    try:
        local = datetime.now(ZoneInfo(tz))
    except Exception:
        local = datetime.utcnow()
    h = local.hour + local.minute / 60 if hour is None else hour
    p = price_at(cc, geo.get("state"), h)
    if p is None:
        return {"available": False, "country_code": cc, "country": geo.get("country"), "local_hour": round(h, 2), "timezone": tz,
                "note": "No published tariff loaded for this country — enter the grid price from the bill on the Facility page."}
    ngn = None
    if p["rate_now"] is not None and p["currency"] == "NGN":
        ngn = p["rate_now"]
    return {"available": True, **p, "local_hour": round(h, 2), "timezone": tz, "rate_now_ngn": ngn,
            "usd_to_ngn": settings.usd_to_ngn, "place": geo.get("name")}
