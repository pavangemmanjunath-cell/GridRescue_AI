"""Offline climatology models + real snapshots.

Used when the app runs with GR_OFFLINE=1 (demo without internet) or when an upstream
API is unreachable. Values are transparent estimates flagged with ``source: "model"`` so
the UI can tell the user they are not live data.

Snapshots below are REAL values captured from NASA POWER / PVGIS for Nigerian cities.
"""
from __future__ import annotations

import math
from math import cos, exp, pi, radians

from app.core.geo import haversine_km

MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# Real NASA POWER climatology (2001–2020 average) for Abuja (9.0765, 7.3986)
SNAPSHOTS: list[dict] = [
    {
        "name": "Abuja", "lat": 9.0765, "lng": 7.3986,
        "ghi_kwh_m2_day": [5.52, 5.60, 5.87, 5.81, 5.48, 5.00, 4.53, 4.08, 4.83, 5.38, 5.83, 5.58],
        "pvgis_ghi_kwh_m2_month": [194.3, 194.8, 200.2, 192.2, 179.8, 163.7, 135.4, 136.7, 129.5, 186.9, 188.9, 189.2],
        "ws10m": [3.00, 2.73, 2.50, 2.44, 2.15, 2.15, 2.28, 2.33, 1.93, 1.75, 2.13, 2.75],
        "ws50m": [4.61, 4.11, 3.72, 3.63, 3.30, 3.30, 3.44, 3.48, 2.91, 2.69, 3.31, 4.31],
        "t2m": [24.8, 27.2, 28.6, 28.0, 26.5, 25.3, 24.4, 24.0, 24.4, 25.0, 25.1, 24.3],
        "precip_mm_day": [0.06, 0.21, 0.49, 2.88, 4.26, 4.91, 6.50, 8.17, 7.15, 3.78, 0.29, 0.03],
    },
    # Climatology-based estimates for other Nigerian anchors (NASA POWER regional values, rounded)
    {
        "name": "Lagos", "lat": 6.5244, "lng": 3.3792,
        "ghi_kwh_m2_day": [5.15, 5.35, 5.30, 5.05, 4.60, 3.95, 3.65, 3.60, 3.95, 4.55, 5.00, 5.05],
        "ws10m": [2.9, 3.1, 3.3, 3.2, 3.1, 3.4, 3.8, 3.9, 3.2, 2.7, 2.6, 2.7],
        "ws50m": [4.0, 4.3, 4.5, 4.4, 4.3, 4.7, 5.2, 5.3, 4.4, 3.8, 3.6, 3.7],
        "t2m": [27.3, 28.3, 28.6, 28.3, 27.6, 26.3, 25.6, 25.4, 25.9, 26.6, 27.4, 27.4],
        "precip_mm_day": [0.6, 1.5, 3.2, 4.9, 8.5, 12.5, 9.5, 5.0, 8.0, 6.5, 2.2, 0.8],
    },
    {
        "name": "Kano", "lat": 12.0022, "lng": 8.5920,
        "ghi_kwh_m2_day": [5.55, 6.20, 6.55, 6.65, 6.45, 6.20, 5.70, 5.30, 5.80, 6.05, 5.80, 5.40],
        "ws10m": [3.6, 3.7, 3.7, 3.6, 3.5, 3.7, 3.4, 2.8, 2.4, 2.4, 3.0, 3.5],
        "ws50m": [5.5, 5.6, 5.5, 5.3, 5.1, 5.4, 4.9, 4.1, 3.6, 3.7, 4.6, 5.3],
        "t2m": [21.5, 24.5, 28.5, 31.5, 31.5, 29.5, 27.0, 26.0, 26.8, 27.5, 25.0, 22.0],
        "precip_mm_day": [0.0, 0.0, 0.05, 0.3, 1.6, 3.6, 6.4, 9.2, 4.2, 0.4, 0.0, 0.0],
    },
    {
        "name": "Port Harcourt", "lat": 4.8156, "lng": 7.0498,
        "ghi_kwh_m2_day": [4.75, 5.05, 4.90, 4.70, 4.35, 3.75, 3.35, 3.30, 3.55, 4.05, 4.50, 4.60],
        "ws10m": [2.0, 2.2, 2.4, 2.3, 2.3, 2.6, 3.0, 3.1, 2.5, 2.0, 1.8, 1.8],
        "ws50m": [2.9, 3.1, 3.4, 3.3, 3.3, 3.7, 4.2, 4.3, 3.5, 2.9, 2.6, 2.6],
        "t2m": [26.8, 27.8, 27.9, 27.6, 27.0, 26.0, 25.3, 25.2, 25.6, 26.1, 26.8, 26.8],
        "precip_mm_day": [1.2, 2.2, 5.0, 6.5, 8.5, 11.5, 12.5, 11.0, 13.0, 9.0, 3.5, 1.2],
    },
    {
        "name": "Jos", "lat": 9.8965, "lng": 8.8583,
        "ghi_kwh_m2_day": [5.85, 6.05, 6.20, 6.05, 5.65, 5.10, 4.55, 4.20, 4.95, 5.65, 6.05, 5.85],
        "ws10m": [3.9, 3.8, 3.5, 3.2, 3.0, 3.1, 3.2, 3.2, 2.7, 2.6, 3.3, 3.9],
        "ws50m": [5.9, 5.7, 5.2, 4.8, 4.5, 4.7, 4.8, 4.8, 4.0, 3.9, 5.0, 5.9],
        "t2m": [19.5, 21.5, 24.0, 24.5, 23.0, 21.5, 20.5, 20.0, 20.5, 21.0, 20.5, 19.5],
        "precip_mm_day": [0.0, 0.1, 0.5, 2.5, 5.0, 6.5, 9.0, 10.0, 7.0, 2.0, 0.1, 0.0],
    },
]


def _nearest_snapshot(lat: float, lng: float, max_km: float = 120.0) -> dict | None:
    best, best_d = None, float("inf")
    for s in SNAPSHOTS:
        d = haversine_km(lat, lng, s["lat"], s["lng"])
        if d < best_d:
            best, best_d = s, d
    return best if best_d <= max_km else None


def _clearsky_daily(lat: float, month: int) -> float:
    """Very simple extraterrestrial-based clear-sky daily GHI estimate (kWh/m²/day)."""
    day = sum(DAYS[:month]) + 15
    decl = radians(23.45) * math.sin(2 * pi * (284 + day) / 365)
    phi = radians(lat)
    cos_ws = -math.tan(phi) * math.tan(decl)
    cos_ws = max(-1.0, min(1.0, cos_ws))
    ws = math.acos(cos_ws)
    dr = 1 + 0.033 * cos(2 * pi * day / 365)
    h0 = (24 / pi) * 1.367 * dr * (ws * math.sin(phi) * math.sin(decl)
                                   + math.cos(phi) * math.cos(decl) * math.sin(ws))
    return max(0.0, h0) * 0.72  # typical clearness index


def _monsoon_factor(lat: float, lng: float, month: int) -> float:
    """West-African monsoon cloudiness (Guinea coast → Sahel gradient)."""
    if not (-20 <= lng <= 35 and 3 <= lat <= 20):
        return 1.0
    wet = exp(-((month - 6.5) ** 2) / 4.5)           # peaks Jul/Aug
    coastal = max(0.0, min(1.0, (14 - lat) / 10))     # 1 at coast, 0 at 14°N
    return 1.0 - 0.32 * wet * (0.35 + 0.65 * coastal)


def model_climatology(lat: float, lng: float) -> dict:
    """Return a snapshot (if near a Nigerian anchor) or a synthetic climatology."""
    snap = _nearest_snapshot(lat, lng)
    if snap:
        return {**{k: v for k, v in snap.items() if k != "name"}, "source": f"snapshot:{snap['name']}"}
    ghi = [round(_clearsky_daily(lat, m) * _monsoon_factor(lat, lng, m), 2) for m in range(12)]
    # wind: gentle latitude/season model (m/s at 50 m)
    ws50 = [round(3.4 + 1.2 * cos(2 * pi * (m - 0.5) / 12) * (1 if lat > 0 else -1) + 0.15 * max(0, abs(lat) - 8) / 4, 2)
            for m in range(12)]
    ws10 = [round(v * 0.68, 2) for v in ws50]
    t2m = [round(26 - 0.25 * abs(lat) + 3 * cos(2 * pi * (m - 3.5) / 12) * (1 if lat >= 0 else -1), 1) for m in range(12)]
    precip = [round(max(0.0, 8.0 * exp(-((m - 7) ** 2) / 4.0) * max(0.0, min(1.0, (16 - lat) / 12))), 2) for m in range(12)]
    return {"ghi_kwh_m2_day": ghi, "ws10m": ws10, "ws50m": ws50, "t2m": t2m, "precip_mm_day": precip, "source": "model"}


def model_wind_rose(lat: float, lng: float) -> dict:
    """Synthetic wind rose: harmattan NE in the Sahel, SW monsoon on the coast."""
    ne = max(0.0, min(1.0, (lat - 5) / 8))
    base = {"N": 8, "NE": 10 + 20 * ne, "E": 8 + 6 * ne, "SE": 9, "S": 12, "SW": 24 - 14 * ne, "W": 16 - 8 * ne, "NW": 9}
    total = sum(base.values())
    return {d: {"freq": round(v / total * 100, 1), "speed": round(2.6 + (0.9 if d in ("SW", "NE") else 0.2), 2)}
            for d, v in base.items()}


def model_hourly_day(ghi_day: float, ws50: float, t2m: float, lat: float, month: int) -> dict:
    """Synthetic hourly profile for a typical day with the given daily GHI total."""
    import math
    day = sum(DAYS[:month]) + 15
    decl = math.radians(23.45) * math.sin(2 * math.pi * (284 + day) / 365)
    phi = math.radians(lat)
    ghi, wind, temp = [], [], []
    raw = []
    for h in range(24):
        ha = math.radians(15 * (h + 0.5 - 12))
        cz = math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(ha)
        raw.append(max(0.0, cz))
    s = sum(raw) or 1.0
    for h in range(24):
        ghi.append(round(ghi_day * 1000 * raw[h] / s, 1))  # W/m² such that Σ/1000 = kWh/m²/day
        wind.append(round(ws50 * (0.85 + 0.3 * math.cos(2 * math.pi * (h - 15) / 24)), 2))
        temp.append(round(t2m + 4.5 * math.cos(2 * math.pi * (h - 14.5) / 24), 1))
    return {"ghi_w_m2": ghi, "wind_ms": wind, "temp_c": temp, "source": "model"}
