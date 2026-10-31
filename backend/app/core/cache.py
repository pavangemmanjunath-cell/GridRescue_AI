"""Disk cache for upstream API responses (keeps the free APIs happy and the demo fast)."""
from __future__ import annotations

import hashlib
import json
from functools import wraps
from typing import Any, Callable

import diskcache

from app.config import settings

_cache = diskcache.Cache(settings.cache_dir, size_limit=256 * 1024 * 1024)


def cache_key(prefix: str, *args: Any, **kwargs: Any) -> str:
    raw = f"{prefix}:{json.dumps(args, sort_keys=True, default=str)}:{json.dumps(kwargs, sort_keys=True, default=str)}"
    return hashlib.sha256(raw.encode()).hexdigest()


def cached(prefix: str, ttl: int | None = None) -> Callable:
    """Cache the JSON-serialisable result of an async function by its arguments."""
    _ttl = ttl or settings.cache_ttl_seconds

    def deco(fn: Callable):
        @wraps(fn)
        async def wrapper(*args, **kwargs):
            key = cache_key(prefix, *args, **kwargs)
            hit = _cache.get(key)
            if hit is not None:
                return hit
            result = await fn(*args, **kwargs)
            # never cache a failed upstream call, or one outage would stick for the whole TTL
            src = str(result.get("source", "")) if isinstance(result, dict) else ""
            if result is not None and src != "unavailable" and not src.startswith("fallback"):
                _cache.set(key, result, expire=_ttl)
            return result

        wrapper.__wrapped_fn__ = fn  # type: ignore[attr-defined]
        return wrapper

    return deco


def get(key: str) -> Any:
    return _cache.get(key)


def put(key: str, value: Any, ttl: int | None = None) -> None:
    _cache.set(key, value, expire=ttl or settings.cache_ttl_seconds)


def clear() -> None:
    _cache.clear()
