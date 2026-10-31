"""Application settings (environment variables / .env).

Every external data source used by GridRescue AI is free and needs no API key.
The only knobs are timeouts, cache location, CORS and the offline/demo switch.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore", env_prefix="GR_")

    app_name: str = "GridRescue AI"
    version: str = "1.0.0"

    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = False

    # CORS — the Vite dev server (5173) and any LAN host on the same ports.
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:4173,http://127.0.0.1:4173,"
        "http://localhost:3000,http://127.0.0.1:3000"
    )
    cors_allow_all: bool = True  # hackathon convenience — restrict for production

    # Caching of upstream API calls (disk based, survives restarts)
    cache_dir: str = ".cache"
    cache_ttl_seconds: int = 6 * 3600

    # Offline / demo mode: never call the internet, always use bundled snapshots + climatology models.
    offline: bool = False

    # HTTP client
    http_timeout: float = 15.0
    http_long_timeout: float = 40.0
    # OpenStreetMap/Nominatim ask every app to identify itself; add a contact for heavy use with GR_USER_AGENT in backend/.env
    user_agent: str = "GridRescueAI/1.0 (open-source hackathon prototype; https://github.com/)"

    # NLR (formerly NREL) PVWatts v8 — a solar-yield cross-check. DEMO_KEY is the public demo key (rate-limited);
    # set GR_NLR_API_KEY to a free personal key for heavier use.
    nlr_api_key: str = "DEMO_KEY"

    # Economics defaults (can be overridden per request)
    usd_to_ngn: float = 1330.0                 # CBN NFEM official rate ≈ ₦1,329/US$
    grid_tariff_usd_per_kwh: float = 0.158     # NERC Band A ₦209.50/kWh (last confirmed order) at ₦1,330/US$
    diesel_price_usd_per_l: float = 1.30       # Nigeria diesel ≈ ₦1,715/L; NBS national average peaked at ₦3,277/L
    discount_rate: float = 0.10


settings = Settings()
