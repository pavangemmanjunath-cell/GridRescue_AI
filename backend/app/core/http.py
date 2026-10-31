"""Shared async HTTP client with connection pooling, retries and offline guard."""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger("gridrescue.http")

MAX_RETRIES = 1

_client: httpx.AsyncClient | None = None


class OfflineMode(RuntimeError):
    """Raised when the app runs in offline/demo mode and an upstream call was attempted."""


def _verify() -> bool | str:
    if os.environ.get("GR_SSL_VERIFY", "true").lower() in ("0", "false", "no"):
        return False
    bundle = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
    return bundle or True


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            verify=_verify(),
            timeout=settings.http_timeout,
            limits=httpx.Limits(max_connections=24, max_keepalive_connections=12),
            follow_redirects=True,
            headers={"User-Agent": settings.user_agent, "Accept": "application/json, */*"},
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


async def fetch_json(url: str, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None,
                     timeout: float | None = None) -> Any:
    """GET JSON with one retry on transient failures. Raises on final failure."""
    if settings.offline:
        raise OfflineMode(f"offline mode: {url}")
    client = get_client()
    last: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            r = await client.get(url, params=params, headers=headers, timeout=timeout or settings.http_timeout)
            r.raise_for_status()
            return r.json()
        except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError) as exc:
            last = exc
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code < 500 and exc.response.status_code != 429:
                raise
            last = exc
            if exc.response.status_code == 429:
                await asyncio.sleep(1.5)
        if attempt < MAX_RETRIES:
            await asyncio.sleep(0.4)
    raise RuntimeError(f"upstream failed: {url}") from last


async def post_form(url: str, content: str, headers: dict[str, str] | None = None,
                    timeout: float | None = None) -> Any:
    """POST form/plain body (used for Overpass QL) with one retry."""
    if settings.offline:
        raise OfflineMode(f"offline mode: {url}")
    client = get_client()
    last: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            r = await client.post(url, content=content, headers=headers, timeout=timeout or settings.http_long_timeout)
            if r.status_code == 429:
                await asyncio.sleep(2.0)
                last = RuntimeError("429 rate limited")
                continue
            r.raise_for_status()
            return r.json()
        except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError) as exc:
            last = exc
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code < 500:
                raise
            last = exc
        if attempt < MAX_RETRIES:
            await asyncio.sleep(0.4)
    raise RuntimeError(f"upstream failed: {url}") from last


async def gather_safe(*coros):
    """asyncio.gather that returns exceptions in place instead of raising."""
    return await asyncio.gather(*coros, return_exceptions=True)
