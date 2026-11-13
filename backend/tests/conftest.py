import os

# Must be set before app.database is imported, or the tests would create/alter the
# real ./meal_planner.db in the current directory.
os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from fastapi.testclient import TestClient

from app import models
from app.database import engine, ensure_columns
from app.main import app

assert str(engine.url) == "sqlite://", "tests must run against the in-memory database"


@pytest.fixture(autouse=True)
def fresh_db():
    models.Base.metadata.drop_all(bind=engine)
    models.Base.metadata.create_all(bind=engine)
    ensure_columns(engine)
    yield
    models.Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return TestClient(app)
