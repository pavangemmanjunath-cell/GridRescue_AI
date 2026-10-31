"""GridRescue AI — FastAPI backend.

Run from the backend/ folder:  uvicorn app.main:app --reload --port 8000
Offline demo (no internet):     GR_OFFLINE=1 uvicorn app.main:app --port 8000
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from app.config import settings
from app.core.http import close_client
from app.routers import assess, cases, knowledge, layers, location, open_data, report, resources

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    await close_client()


app = FastAPI(
    title="GridRescue AI API",
    description="Location-aware backup-power resilience advisor for critical infrastructure (Nigeria / Africa focus). "
                "Wraps Open-Meteo, NASA POWER, PVGIS, OpenStreetMap Overpass, Nominatim and World Bank open data — no API keys.",
    version=settings.version, docs_url="/docs", redoc_url="/redoc", lifespan=lifespan,
)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=["*"] if settings.cors_allow_all else origins,
                   allow_credentials=not settings.cors_allow_all, allow_methods=["*"], allow_headers=["*"])

for r in (location.router, resources.router, layers.router, assess.router, report.router, cases.router, open_data.router, knowledge.router):
    app.include_router(r, prefix="/api")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def root():
    return f"""<html><head><title>GridRescue AI API</title><style>
    body{{font-family:system-ui,sans-serif;background:#08111F;color:#F3F6FB;padding:60px;line-height:1.6}}
    .g{{color:#F0CB72}} .c{{color:#5BD4FF}} a{{color:#F0CB72}}</style></head><body>
    <h1><span class="g">Grid</span><span class="c">Rescue</span> AI API v{settings.version}</h1>
    <p>Mode: <b>{'offline / demo' if settings.offline else 'live open data'}</b></p>
    <p>Interactive docs: <a href="/docs">/docs</a> · <a href="/redoc">/redoc</a> · <a href="/health">/health</a></p></body></html>"""


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "service": "gridrescue-ai-api", "version": settings.version, "mode": "offline" if settings.offline else "live"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=settings.reload)
