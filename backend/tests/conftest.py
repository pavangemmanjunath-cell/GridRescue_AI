import os

os.environ.setdefault("GR_OFFLINE", "1")
os.environ.setdefault("GR_CACHE_DIR", ".cache-test")

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


ABUJA = {"lat": 9.0765, "lng": 7.3986}
LOKOJA = {"lat": 7.8023, "lng": 6.7333}
