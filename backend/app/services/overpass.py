"""OpenStreetMap Overpass client (ODbL). Mirrors + short timeouts + graceful failure."""
from __future__ import annotations

import asyncio
import logging
import urllib.parse

from app.core.http import OfflineMode, post_form

log = logging.getLogger("gridrescue.overpass")

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
]
HEADERS = {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}


async def run_query(query: str, timeout: float = 15.0) -> list[dict]:
    """Ask every mirror at once and take the first answer; raise RuntimeError if none answers within `timeout`.
    (Asking one mirror after another cost up to 4 × 35 s when the public servers were overloaded.)"""
    body = "data=" + urllib.parse.quote(query)
    tasks = [asyncio.create_task(post_form(url, content=body, headers=HEADERS, timeout=timeout)) for url in MIRRORS]
    try:
        for fut in asyncio.as_completed(tasks, timeout=timeout + 1):
            try:
                return (await fut).get("elements", [])
            except OfflineMode:
                raise
            except Exception as exc:  # wait for the next mirror
                log.warning("overpass mirror failed: %s", exc)
    except asyncio.TimeoutError:
        pass
    finally:
        for t in tasks:
            t.cancel()
    raise RuntimeError("all overpass mirrors failed")


def elem_latlng(e: dict) -> tuple[float, float] | None:
    if "lat" in e and "lon" in e:
        return float(e["lat"]), float(e["lon"])
    c = e.get("center")
    if c:
        return float(c["lat"]), float(c["lon"])
    g = e.get("geometry")
    if g:
        return float(g[len(g) // 2]["lat"]), float(g[len(g) // 2]["lon"])
    return None


def elem_geometry(e: dict) -> list[tuple[float, float]]:
    return [(float(p["lat"]), float(p["lon"])) for p in e.get("geometry", []) if "lat" in p]
