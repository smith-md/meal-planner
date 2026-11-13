import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./meal_planner.db")

_engine_options = {"connect_args": {"check_same_thread": False}}
if SQLALCHEMY_DATABASE_URL in ("sqlite://", "sqlite:///:memory:"):
    _engine_options["poolclass"] = StaticPool

engine = create_engine(SQLALCHEMY_DATABASE_URL, **_engine_options)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Columns added after the first release; create_all does not alter existing tables.
_ADDED_COLUMNS = (
    ("meals", "yield_servings", "INTEGER"),
    ("week_meals", "servings", "INTEGER"),
)


def ensure_columns(bind):
    """Idempotently add columns that older databases lack."""
    for table, column, ddl_type in _ADDED_COLUMNS:
        existing = {c["name"] for c in inspect(bind).get_columns(table)}
        if column not in existing:
            with bind.begin() as connection:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
