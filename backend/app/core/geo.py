"""Geo helpers — haversine distance, bearings, bounding boxes, Africa test."""
from __future__ import annotations

from math import asin, atan2, cos, degrees, radians, sin, sqrt

EARTH_R_KM = 6371.0088

# Rough bounding box of the African continent + Madagascar (for "Africa focus" flags)
AFRICA_BBOX = (-35.5, -18.5, 38.5, 52.5)  # min_lat, min_lng, max_lat, max_lng

# Nigeria bounding box
NIGERIA_BBOX = (4.2, 2.6, 13.9, 14.7)


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dl = radians(lng2 - lng1)
    a = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * EARTH_R_KM * asin(sqrt(a))


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    dl = radians(lng2 - lng1)
    x = sin(dl) * cos(p2)
    y = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
    return (degrees(atan2(x, y)) + 360) % 360


def compass(bearing: float) -> str:
    dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return dirs[int((bearing + 22.5) // 45) % 8]


def in_bbox(lat: float, lng: float, bbox: tuple[float, float, float, float]) -> bool:
    min_lat, min_lng, max_lat, max_lng = bbox
    return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng


def in_africa(lat: float, lng: float) -> bool:
    return in_bbox(lat, lng, AFRICA_BBOX)


def in_nigeria(lat: float, lng: float) -> bool:
    return in_bbox(lat, lng, NIGERIA_BBOX)


def offset_point(lat: float, lng: float, dist_km: float, bearing: float) -> tuple[float, float]:
    """Destination point given distance and bearing (degrees)."""
    b = radians(bearing)
    p1, l1 = radians(lat), radians(lng)
    d = dist_km / EARTH_R_KM
    p2 = asin(sin(p1) * cos(d) + cos(p1) * sin(d) * cos(b))
    l2 = l1 + atan2(sin(b) * sin(d) * cos(p1), cos(d) - sin(p1) * sin(p2))
    return degrees(p2), degrees(l2)


def polyline_min_distance_km(lat: float, lng: float, coords: list[tuple[float, float]]) -> float:
    """Approximate minimum distance from a point to a polyline (vertex + segment sampling)."""
    if not coords:
        return float("inf")
    best = float("inf")
    for i, (a_lat, a_lng) in enumerate(coords):
        best = min(best, haversine_km(lat, lng, a_lat, a_lng))
        if i + 1 < len(coords):
            b_lat, b_lng = coords[i + 1]
            # sample 3 interior points of long segments
            seg = haversine_km(a_lat, a_lng, b_lat, b_lng)
            if seg > 0.4:
                for t in (0.25, 0.5, 0.75):
                    m_lat = a_lat + (b_lat - a_lat) * t
                    m_lng = a_lng + (b_lng - a_lng) * t
                    best = min(best, haversine_km(lat, lng, m_lat, m_lng))
    return best
