"""Slot-based planning: place a meal on a date and slot, move it, and upgrade old databases (issue #33)."""
import sqlite3
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app import models, schemas
from app.database import ensure_columns
from test_api_servings import WEEK, NEXT_WEEK, make_meal, week, plan
from test_cooking import assign, cook, schedule, set_status
from test_inventory import buy, stock

MONDAY = date.fromisoformat(WEEK)


def day(offset):
    return (MONDAY + timedelta(days=offset)).isoformat()


def url(w, meal, suffix=""):
    return f"/week-plans/{w['id']}/meals/{meal['id']}{suffix}" if meal else f"/week-plans/{w['id']}/meals"


def place(client, w, meal, when, slot, **extra):
    return client.post(url(w, None), json={"meal_id": meal["id"], "date": when, "slot": slot, **extra})


def move(client, w, meal, when, slot):
    return client.patch(url(w, meal), json={"date": when, "slot": slot})


def entry(client, w, meal):
    return schedule(client, w["id"])[meal["id"]]


# AC1
def test_plan_meal_for_date_and_slot(client):
    w = week(client)
    meal = make_meal(client, "Soup", "1 cup rice", yield_servings=4)
    response = place(client, w, meal, day(2), "lunch", servings=3)
    assert response.status_code == 200, response.text
    row = response.json()["meal_schedule"][0]
    assert row["day_id"] == w["days"][2]["id"] and row["slot"] == "lunch"
    assert response.json()["meal_servings"] == [{"meal_id": meal["id"], "servings": 3}]


# AC1
def test_plan_without_placement_leaves_day_and_slot_empty(client):
    w = week(client)
    meal = make_meal(client, "Soup")
    row = plan(client, w["id"], meal["id"])["meal_schedule"][0]
    assert row["day_id"] is None and row["slot"] is None


# AC1
@pytest.mark.parametrize("body, status", [
    ({"slot": "lunch"}, 422),                                # slot without a day
    ({"date": day(0)}, 422),                                 # day without a slot
    ({"date": day(0), "slot": "brunch"}, 422),               # unknown slot
    ({"date": day(0), "slot": None}, 422),
    ({"date": day(7), "slot": "dinner"}, 400),               # next Monday
    ({"date": day(-1), "slot": "dinner"}, 400),              # previous Sunday
])
def test_plan_rejects_bad_placement_and_persists_nothing(client, body, status):
    w = week(client)
    meal = make_meal(client, "Soup")
    response = client.post(url(w, None), json={"meal_id": meal["id"], **body})
    assert response.status_code == status, response.text
    assert client.get("/week-plans/current", params={"ref_date": WEEK}).json()["meal_schedule"] == []


# AC1
def test_placement_message_for_incomplete_pair(client):
    w = week(client)
    meal = make_meal(client, "Soup")
    response = client.post(url(w, None), json={"meal_id": meal["id"], "slot": "lunch"})
    assert "Choose both a day and a meal slot, or neither." in response.text
    outside = place(client, w, meal, day(7), "lunch")
    assert outside.json()["detail"] == "Choose a day in this week."


# AC1 (D2)
def test_placed_duplicate_is_409_and_unplaced_duplicate_is_noop(client):
    w = week(client)
    meal = make_meal(client, "Soup")
    assert place(client, w, meal, day(0), "dinner").status_code == 200
    again = place(client, w, meal, day(1), "lunch")
    assert again.status_code == 409
    assert again.json()["detail"] == "This meal is already planned this week. Move it instead."
    quiet = client.post(url(w, None), json={"meal_id": meal["id"]})
    assert quiet.status_code == 200 and len(quiet.json()["meal_schedule"]) == 1
    row = entry(client, w, meal)
    assert row["day_id"] == w["days"][0]["id"] and row["slot"] == "dinner"


# AC1
def test_plan_unknown_week_or_meal_is_404(client):
    w = week(client)
    meal = make_meal(client, "Soup")
    assert client.post("/week-plans/9999/meals", json={"meal_id": meal["id"]}).status_code == 404
    assert client.post(url(w, None), json={"meal_id": 9999}).status_code == 404


# AC2
def test_move_and_unschedule(client):
    w = week(client)
    meal = make_meal(client, "Soup", yield_servings=4)
    plan(client, w["id"], meal["id"], servings=6)
    moved = move(client, w, meal, day(3), "breakfast")
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert body["id"] == w["id"] and len(body["days"]) == 7
    assert body["meal_schedule"][0]["day_id"] == w["days"][3]["id"]
    assert body["meal_schedule"][0]["slot"] == "breakfast"
    assert body["meal_servings"] == [{"meal_id": meal["id"], "servings": 6}]
    again = move(client, w, meal, day(5), "dinner").json()["meal_schedule"][0]
    assert (again["day_id"], again["slot"]) == (w["days"][5]["id"], "dinner")
    cleared = client.patch(url(w, meal), json={"date": None, "slot": None})
    assert cleared.status_code == 200
    row = cleared.json()["meal_schedule"][0]
    assert row["day_id"] is None and row["slot"] is None and row["status"] == "planned"


# AC2
@pytest.mark.parametrize("body", [
    {},
    {"date": day(0)},
    {"slot": "lunch"},
    {"date": day(0), "slot": None},
    {"date": None, "slot": "lunch"},
    {"date": day(0), "slot": "brunch"},
    {"servings": None},
    {"servings": 0},
    {"servings": 100},
    {"servings": 2, "date": day(0)},
])
def test_patch_rejects_invalid_bodies(client, body):
    w = week(client)
    meal = make_meal(client, "Soup")
    plan(client, w["id"], meal["id"], servings=2)
    assert client.patch(url(w, meal), json=body).status_code == 422
    row = entry(client, w, meal)
    assert row["day_id"] is None and row["slot"] is None


# AC2
def test_move_errors(client):
    w = week(client)
    meal = make_meal(client, "Soup")
    other = make_meal(client, "Stew")
    plan(client, w["id"], meal["id"])
    assert move(client, w, meal, day(7), "dinner").status_code == 400
    assert move(client, w, meal, day(-1), "dinner").status_code == 400
    assert move(client, w, other, day(0), "dinner").status_code == 404
    assert entry(client, w, meal)["day_id"] is None


# AC2
def test_patch_can_change_servings_and_move_together(client):
    w = week(client)
    meal = make_meal(client, "Soup", yield_servings=4)
    plan(client, w["id"], meal["id"])
    response = client.patch(url(w, meal), json={"servings": 7, "date": day(1), "slot": "lunch"})
    assert response.status_code == 200
    body = response.json()
    assert body["meal_servings"] == [{"meal_id": meal["id"], "servings": 7}]
    assert body["meal_schedule"][0]["slot"] == "lunch"
    # servings-only patch keeps the placement
    kept = client.patch(url(w, meal), json={"servings": 2}).json()
    assert kept["meal_schedule"][0]["slot"] == "lunch"
    assert kept["meal_schedule"][0]["day_id"] == w["days"][1]["id"]


# AC2
def test_cooked_meal_cannot_be_moved(client):
    buy(client, "purchase-0001", "2 cups rice")
    w = week(client)
    meal = make_meal(client, "Rice bowl", "1/2 cup rice")
    place(client, w, meal, day(0), "dinner")
    assert cook(client, w["id"], meal["id"]).status_code == 200
    for body in ({"date": day(1), "slot": "lunch"}, {"date": None, "slot": None}):
        response = client.patch(url(w, meal), json=body)
        assert response.status_code == 409
        assert "cooked" in response.json()["detail"]
    row = entry(client, w, meal)
    assert row["status"] == "cooked" and row["slot"] == "dinner" and row["day_id"] == w["days"][0]["id"]


# AC2 (A move never changes stock)
def test_move_keeps_status_servings_and_stock(client):
    buy(client, "purchase-0001", "2 cups rice")
    w = week(client)
    meal = make_meal(client, "Rice bowl", "1/2 cup rice", yield_servings=2)
    place(client, w, meal, day(0), "dinner", servings=4)
    set_status(client, w["id"], meal["id"], "skipped")
    before = stock(client)
    assert move(client, w, meal, day(2), "lunch").status_code == 200
    assert stock(client) == before
    row = entry(client, w, meal)
    assert row["status"] == "skipped" and row["slot"] == "lunch"


# AC5
def test_move_then_cook_deducts_once(client):
    buy(client, "purchase-0001", "2 cups rice")
    w = week(client)
    meal = make_meal(client, "Rice bowl", "1/2 cup rice")
    place(client, w, meal, day(0), "dinner")
    assert move(client, w, meal, day(4), "lunch").status_code == 200
    assert [r["quantity"] for r in stock(client)] == ["2"]
    first = cook(client, w["id"], meal["id"])
    assert first.status_code == 200 and first.json()["replayed"] is False
    assert first.json()["day_id"] == w["days"][4]["id"]
    assert [r["quantity"] for r in stock(client)] == ["1 1/2"]
    assert cook(client, w["id"], meal["id"]).json()["replayed"] is True
    assert [r["quantity"] for r in stock(client)] == ["1 1/2"]


# AC5
def test_skip_remove_and_servings_unchanged_for_placed_meal(client):
    w = week(client)
    meal = make_meal(client, "Soup", yield_servings=4)
    place(client, w, meal, day(0), "dinner")
    assert client.patch(url(w, meal), json={"servings": 8}).status_code == 200
    assert set_status(client, w["id"], meal["id"], "skipped").status_code == 200
    assert entry(client, w, meal)["slot"] == "dinner"
    assert client.delete(url(w, meal)).json()["meal_schedule"] == []


# AC1 / AC3: PUT /day keeps working and keeps day and slot together
def test_put_day_sets_default_dinner_keeps_slot_and_clears_with_day(client):
    w = week(client)
    meal = make_meal(client, "Soup")
    plan(client, w["id"], meal["id"])
    assert assign(client, w["id"], meal["id"], w["days"][1]["id"]).status_code == 200
    row = entry(client, w, meal)
    assert (row["day_id"], row["slot"]) == (w["days"][1]["id"], "dinner")
    move(client, w, meal, day(2), "breakfast")
    assert assign(client, w["id"], meal["id"], w["days"][4]["id"]).status_code == 200
    row = entry(client, w, meal)
    assert (row["day_id"], row["slot"]) == (w["days"][4]["id"], "breakfast")
    assert assign(client, w["id"], meal["id"], None).status_code == 200
    row = entry(client, w, meal)
    assert row["day_id"] is None and row["slot"] is None
    other_week = week(client, NEXT_WEEK)
    assert assign(client, w["id"], meal["id"], other_week["days"][0]["id"]).status_code == 400


# AC3
def test_old_database_is_upgraded_without_losing_data(tmp_path):
    path = tmp_path / "pre_slot.db"
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE week_plans (id INTEGER PRIMARY KEY, start_date DATE, end_date DATE);
        CREATE TABLE days (id INTEGER PRIMARY KEY, week_plan_id INTEGER, date DATE, day_name VARCHAR, state VARCHAR);
        CREATE TABLE meals (id INTEGER PRIMARY KEY, name VARCHAR, notes VARCHAR, tags VARCHAR, ingredients VARCHAR);
        CREATE TABLE week_meals (
            id INTEGER PRIMARY KEY, week_plan_id INTEGER, meal_id INTEGER, servings INTEGER,
            day_id INTEGER, status VARCHAR, cooked_servings INTEGER, cooked_at DATETIME);
        CREATE TABLE inventory_consumptions (
            id INTEGER PRIMARY KEY, week_meal_id INTEGER NOT NULL, item VARCHAR NOT NULL,
            unit_group VARCHAR NOT NULL, unit VARCHAR NOT NULL, requested_base FLOAT NOT NULL,
            deducted_base FLOAT NOT NULL, created_at DATETIME);
        INSERT INTO week_plans VALUES (1, '2026-01-05', '2026-01-11');
        INSERT INTO days VALUES (1, 1, '2026-01-05', 'Monday', 'need'), (2, 1, '2026-01-06', 'Tuesday', 'need');
        INSERT INTO meals (id, name, ingredients) VALUES (1, 'A', '1 cup rice'), (2, 'B', ''), (3, 'C', ''), (4, 'D', '');
        INSERT INTO week_meals VALUES
            (1, 1, 1, 4, 1, NULL, NULL, NULL),
            (2, 1, 2, 2, NULL, NULL, NULL, NULL),
            (3, 1, 3, 3, 2, 'skipped', NULL, NULL),
            (4, 1, 4, 6, 2, 'cooked', 5, '2026-01-06 18:30:00');
        INSERT INTO inventory_consumptions VALUES (1, 4, 'rice', 'volume', 'cup', 0.5, 0.5, '2026-01-06 18:30:00');
    """)
    connection.commit()
    snapshot = "SELECT id, week_plan_id, meal_id, servings, day_id, status, cooked_servings, cooked_at FROM week_meals ORDER BY id"
    before = connection.execute(snapshot).fetchall()
    consumptions = connection.execute("SELECT * FROM inventory_consumptions").fetchall()
    connection.close()

    engine = create_engine(f"sqlite:///{path}")
    ensure_columns(engine)
    ensure_columns(engine)  # idempotent
    assert "slot" in {c["name"] for c in inspect(engine).get_columns("week_meals")}
    engine.dispose()

    connection = sqlite3.connect(path)
    assert connection.execute(snapshot).fetchall() == before
    assert connection.execute("SELECT id, slot FROM week_meals ORDER BY id").fetchall() == [
        (1, "dinner"), (2, None), (3, "dinner"), (4, "dinner")]
    assert connection.execute("SELECT * FROM inventory_consumptions").fetchall() == consumptions
    # A later manual slot choice is not overwritten by another startup.
    connection.execute("UPDATE week_meals SET slot = 'lunch' WHERE id = 1")
    connection.commit()
    connection.close()
    engine = create_engine(f"sqlite:///{path}")
    ensure_columns(engine)
    session = sessionmaker(bind=engine)()
    rows = {r.id: r for r in session.query(models.WeekMeal).all()}
    assert rows[1].slot == "lunch" and rows[2].slot is None
    plan_row = session.query(models.WeekPlan).one()
    exposed = {s.meal_id: s for s in schemas.WeekPlan.model_validate(plan_row).meal_schedule}
    assert exposed[1].slot == "lunch" and exposed[1].day_id == 1
    assert exposed[2].slot is None and exposed[2].day_id is None
    assert exposed[4].status == "cooked" and exposed[4].slot == "dinner"
    session.close()
    engine.dispose()


# AC2
def test_patch_changes_servings_and_unschedules_in_one_call(client):
    w = week(client)
    meal = make_meal(client, "Soup", yield_servings=4)
    place(client, w, meal, day(2), "lunch", servings=5)
    response = client.patch(url(w, meal), json={"servings": 3, "date": None, "slot": None})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["meal_servings"] == [{"meal_id": meal["id"], "servings": 3}]
    row = body["meal_schedule"][0]
    assert row["day_id"] is None and row["slot"] is None and row["status"] == "planned"


# AC1
def test_placing_an_already_planned_unplaced_meal_is_409_and_changes_nothing(client):
    w = week(client)
    meal = make_meal(client, "Soup", yield_servings=4)
    plan(client, w["id"], meal["id"], servings=2)
    response = place(client, w, meal, day(1), "lunch", servings=6)
    assert response.status_code == 409
    assert response.json()["detail"] == "This meal is already planned this week. Move it instead."
    after = client.get("/week-plans/current", params={"ref_date": WEEK}).json()
    assert len(after["meal_schedule"]) == 1
    row = after["meal_schedule"][0]
    assert row["day_id"] is None and row["slot"] is None
    assert after["meal_servings"] == [{"meal_id": meal["id"], "servings": 2}]
