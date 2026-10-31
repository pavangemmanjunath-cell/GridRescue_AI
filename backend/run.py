"""Convenience runner: python run.py  (same as uvicorn app.main:app --port 8000)."""
import uvicorn

from app.config import settings

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=settings.reload)
