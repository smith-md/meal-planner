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
    ("meals", "prep_minutes", "INTEGER"),
    ("meals", "cook_minutes", "INTEGER"),
    ("meals", "make_ahead", "BOOLEAN NOT NULL DEFAULT 0"),
    ("week_meals", "servings", "INTEGER"),
    ("week_meals", "day_id", "INTEGER"),
    ("week_meals", "status", "VARCHAR"),
    ("week_meals", "cooked_servings", "INTEGER"),
    ("week_meals", "cooked_at", "DATETIME"),
    ("week_meals", "slot", "VARCHAR"),
    ("inventory_items", "minimum", "FLOAT"),
    ("inventory_items", "added_at", "DATETIME"),
)


def ensure_columns(bind):
    """Idempotently add columns that older databases lack."""
    for table, column, ddl_type in _ADDED_COLUMNS:
        if not inspect(bind).has_table(table):
            continue  # create_all builds a missing table with every column
        existing = {c["name"] for c in inspect(bind).get_columns(table)}
        if column not in existing:
            with bind.begin() as connection:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
    # Meals that already had a day before slots existed become dinners. Guarded, so it is idempotent
    # and never touches a row that already has a slot or has no day.
    if inspect(bind).has_table("week_meals"):
        with bind.begin() as connection:
            connection.execute(text(
                "UPDATE week_meals SET slot = 'dinner' WHERE day_id IS NOT NULL AND slot IS NULL"
            ))
    # Rows that predate added_at take the time of their latest non-reverted credit. Guarded, so it
    # is idempotent and never overwrites a stored date; a row without such a credit stays NULL.
    if inspect(bind).has_table("inventory_items") and inspect(bind).has_table("inventory_purchases"):
        with bind.begin() as connection:
            connection.execute(text(
                "UPDATE inventory_items SET added_at = ("
                "SELECT MAX(p.created_at) FROM inventory_purchases p "
                "WHERE p.inventory_item_id = inventory_items.id AND p.reverted = 0) "
                "WHERE added_at IS NULL"
            ))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
