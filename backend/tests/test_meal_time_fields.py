"""Prep/cook time and make-ahead fields on meals (issue #8, AC1-AC4)."""
import sqlite3

import pytest
from sqlalchemy import create_engine, inspect

from app.database import ensure_columns


def create(client, **extra):
    return client.post("/meals", json={"name": "Stew", **extra})


# AC1
def test_defaults_are_null_null_false_and_listed(client):
    meal = create(client).json()
    assert (meal["prep_minutes"], meal["cook_minutes"], meal["make_ahead"]) == (None, None, False)
    assert client.get("/meals").json()[0]["make_ahead"] is False


# AC1
def test_create_stores_values_and_keeps_yield(client):
    meal = create(client, prep_minutes=15, cook_minutes=0, make_ahead=True, yield_servings=4).json()
    assert (meal["prep_minutes"], meal["cook_minutes"], meal["make_ahead"], meal["yield_servings"]) == (15, 0, True, 4)
    listed = client.get("/meals").json()[0]
    assert (listed["prep_minutes"], listed["cook_minutes"], listed["make_ahead"]) == (15, 0, True)


# AC2
@pytest.mark.parametrize("field", ["prep_minutes", "cook_minutes"])
@pytest.mark.parametrize("value", [-1, 1441, 2.5, "abc", True])
def test_invalid_minutes_rejected_on_create_and_update(client, field, value):
    assert create(client, **{field: value}).status_code == 422
    meal = create(client).json()
    assert client.patch(f"/meals/{meal['id']}/details", json={field: value}).status_code == 422


# AC2
@pytest.mark.parametrize("field", ["prep_minutes", "cook_minutes"])
def test_boundary_minutes_accepted(client, field):
    assert create(client, **{field: 0}).status_code == 200
    assert create(client, **{field: 1440}).status_code == 200


# AC2
def test_make_ahead_must_be_boolean(client):
    assert create(client, make_ahead=None).status_code == 422
    meal = create(client).json()
    assert client.patch(f"/meals/{meal['id']}/details", json={"make_ahead": None}).status_code == 422
    assert client.patch(f"/meals/{meal['id']}/details", json={"make_ahead": "maybe"}).status_code == 422


# AC4 (server side): partial update
def test_details_update_is_partial_and_clearable(client):
    meal = create(client, yield_servings=4, prep_minutes=10, cook_minutes=20, make_ahead=True).json()
    url = f"/meals/{meal['id']}/details"

    r = client.patch(url, json={"prep_minutes": 5})
    assert r.status_code == 200
    body = r.json()
    assert (body["prep_minutes"], body["cook_minutes"], body["make_ahead"], body["yield_servings"]) == (5, 20, True, 4)

    body = client.patch(url, json={"cook_minutes": None}).json()
    assert (body["prep_minutes"], body["cook_minutes"], body["make_ahead"], body["yield_servings"]) == (5, None, True, 4)

    body = client.patch(url, json={"make_ahead": False}).json()
    assert (body["prep_minutes"], body["cook_minutes"], body["make_ahead"]) == (5, None, False)

    body = client.patch(url, json={}).json()  # empty body changes nothing
    assert (body["prep_minutes"], body["make_ahead"], body["yield_servings"]) == (5, False, 4)

    assert client.get("/meals").json()[0]["prep_minutes"] == 5  # persisted


# AC4: the yield-only PATCH keeps its behaviour and does not touch the new fields
def test_yield_patch_leaves_new_fields_alone(client):
    meal = create(client, prep_minutes=10, cook_minutes=20, make_ahead=True).json()
    body = client.patch(f"/meals/{meal['id']}", json={"yield_servings": 6}).json()
    assert (body["yield_servings"], body["prep_minutes"], body["cook_minutes"], body["make_ahead"]) == (6, 10, 20, True)


# AC4
def test_details_update_unknown_meal_404(client):
    assert client.patch("/meals/9999/details", json={"prep_minutes": 5}).status_code == 404


# AC3
def test_migration_adds_columns_preserving_data_and_is_idempotent(tmp_path):
    path = tmp_path / "old.db"
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE meals (id INTEGER PRIMARY KEY, name VARCHAR, notes VARCHAR, tags VARCHAR,
                            ingredients VARCHAR, yield_servings INTEGER);
        INSERT INTO meals (name, ingredients, yield_servings) VALUES ('Old', '1 cup rice', 4);
    """)
    connection.commit()
    connection.close()

    engine = create_engine(f"sqlite:///{path}")
    ensure_columns(engine)
    ensure_columns(engine)  # second run: no error
    names = {c["name"] for c in inspect(engine).get_columns("meals")}
    assert {"prep_minutes", "cook_minutes", "make_ahead"} <= names
    with engine.connect() as conn:
        row = conn.exec_driver_sql(
            "SELECT name, ingredients, yield_servings, prep_minutes, cook_minutes, make_ahead FROM meals").fetchall()
    assert row == [("Old", "1 cup rice", 4, None, None, 0)]
    engine.dispose()
