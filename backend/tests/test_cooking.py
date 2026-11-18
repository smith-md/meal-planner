"""Tests for assigning meals to days and cooking them (issue #4, AC1-AC5)."""
import sqlite3
from datetime import datetime

from sqlalchemy import create_engine, inspect
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import inventory, models, schemas
from app.database import SessionLocal, ensure_columns
from app.main import app
from test_api_servings import WEEK, NEXT_WEEK, make_meal, week, plan, pairings, track
from test_inventory import buy, stock


def schedule(client, week_id):
    plan_json = client.get("/week-plans/current", params={"ref_date": WEEK}).json()
    assert plan_json["id"] == week_id
    return {row["meal_id"]: row for row in plan_json["meal_schedule"]}


def assign(client, week_id, meal_id, day_id):
    return client.put(f"/week-plans/{week_id}/meals/{meal_id}/day", json={"day_id": day_id})


def set_status(client, week_id, meal_id, status):
    return client.put(f"/week-plans/{week_id}/meals/{meal_id}/status", json={"status": status})


def cook(client, week_id, meal_id):
    return client.post(f"/week-plans/{week_id}/meals/{meal_id}/cook")


def availability(client, ref=WEEK):
    rows = client.get("/inventory/availability", params={"ref_date": ref}).json()
    return {(row["item"], row["unit"]): row for row in rows}


def scheduled_meal(client, name="Rice bowl", ingredients="1/2 cup rice", yield_servings=None,
                   servings=None, day_index=0):
    meal = make_meal(client, name, ingredients, yield_servings)
    w = week(client)
    plan(client, w["id"], meal["id"], servings)
    assert assign(client, w["id"], meal["id"], w["days"][day_index]["id"]).status_code == 200
    return w, meal


def test_assign_reschedule_unassign(client):  # AC1
    meal = make_meal(client, "Soup", "1 cup rice")
    w = week(client)
    plan(client, w["id"], meal["id"])
    assert schedule(client, w["id"])[meal["id"]]["day_id"] is None
    assert schedule(client, w["id"])[meal["id"]]["status"] == "planned"
    first, second = w["days"][0]["id"], w["days"][3]["id"]
    assert assign(client, w["id"], meal["id"], first).status_code == 200
    assert schedule(client, w["id"])[meal["id"]]["day_id"] == first
    response = assign(client, w["id"], meal["id"], second)
    assert response.status_code == 200
    assert response.json()["meal_schedule"][0]["day_id"] == second
    assert assign(client, w["id"], meal["id"], None).json()["meal_schedule"][0]["day_id"] is None
    # meal_servings keeps its original shape.
    assert response.json()["meal_servings"] == [{"meal_id": meal["id"], "servings": None}]


def test_assign_rejects_other_week_unplanned_and_cooked(client):  # AC1
    meal = make_meal(client, "Soup", "1/2 cup rice")
    other = make_meal(client, "Stew", "1 cup rice")
    w = week(client)
    other_week = week(client, NEXT_WEEK)
    plan(client, w["id"], meal["id"])
    assert assign(client, w["id"], meal["id"], other_week["days"][0]["id"]).status_code == 400
    assert assign(client, w["id"], meal["id"], 99999).status_code == 400
    assert assign(client, w["id"], other["id"], w["days"][0]["id"]).status_code == 404
    assert set_status(client, w["id"], other["id"], "skipped").status_code == 404
    assert cook(client, w["id"], other["id"]).status_code == 404
    assert set_status(client, w["id"], meal["id"], "cooked").status_code == 422
    assert assign(client, w["id"], meal["id"], w["days"][0]["id"]).status_code == 200
    assert cook(client, w["id"], meal["id"]).status_code == 200
    assert assign(client, w["id"], meal["id"], w["days"][1]["id"]).status_code == 409


def test_planning_changes_only_reservations(client):  # AC2
    buy(client, "purchase-0001", "2 cups rice")
    before = stock(client)
    meal = make_meal(client, "Rice bowl", "1 cup rice")
    w = week(client)
    shopping_before = client.get(f"/week-plans/{w['id']}/shopping-list").json()

    def reserved():
        row = availability(client).get(("rice", "cup"))
        return row["reserved"] if row else None

    assert reserved() == "0"
    plan(client, w["id"], meal["id"])
    assert reserved() == "1"
    assert stock(client) == before
    assign(client, w["id"], meal["id"], w["days"][0]["id"])
    assert reserved() == "1" and stock(client) == before
    assign(client, w["id"], meal["id"], w["days"][2]["id"])
    assert reserved() == "1" and stock(client) == before
    assert set_status(client, w["id"], meal["id"], "skipped").status_code == 200
    assert reserved() == "0" and stock(client) == before
    assert schedule(client, w["id"])[meal["id"]]["status"] == "skipped"
    assert set_status(client, w["id"], meal["id"], "planned").status_code == 200
    assert reserved() == "1" and stock(client) == before
    row = availability(client)[("rice", "cup")]
    assert row["on_hand"] == "2" and row["available"] == "1" and row["short"] == ""
    # "amount" was added to each entry (AC3); the original keys are unchanged.
    assert row["reserved_by"] == [{"week_plan_id": w["id"], "meal_id": meal["id"],
                                   "name": "Rice bowl", "day": "Wednesday", "amount": "1"}]
    # Shopping list is unaffected by scheduling, skipping, or cooking (decision D1).
    listed = client.get(f"/week-plans/{w['id']}/shopping-list").json()
    assert listed != shopping_before and listed != []
    set_status(client, w["id"], meal["id"], "skipped")
    assert client.get(f"/week-plans/{w['id']}/shopping-list").json() == listed
    set_status(client, w["id"], meal["id"], "planned")
    assert cook(client, w["id"], meal["id"]).status_code == 200
    assert client.get(f"/week-plans/{w['id']}/shopping-list").json() == listed


def test_past_weeks_do_not_reserve(client):  # AC2 (reservation scope)
    buy(client, "purchase-0001", "2 cups rice")
    meal = make_meal(client, "Rice bowl", "1 cup rice")
    w = week(client)
    plan(client, w["id"], meal["id"])
    assert availability(client, WEEK)[("rice", "cup")]["reserved"] == "1"
    assert availability(client, "2026-01-11")[("rice", "cup")]["reserved"] == "1"  # last day of the week
    assert availability(client, NEXT_WEEK)[("rice", "cup")]["reserved"] == "0"  # week is over


def test_cook_deducts_scaled_once(client):  # AC3
    buy(client, "purchase-0001", "2 cups rice")
    w, meal = scheduled_meal(client, yield_servings=4, servings=6)
    first = cook(client, w["id"], meal["id"])
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["replayed"] is False and body["status"] == "cooked"
    assert body["cooked_servings"] == 6 and body["day_id"] == w["days"][0]["id"]
    assert body["deductions"] == [{"item": "rice", "unit": "cup", "requested": "3/4",
                                   "deducted": "3/4", "short": ""}]
    assert [row["quantity"] for row in stock(client)] == ["1 1/4"]
    second = cook(client, w["id"], meal["id"])
    assert second.status_code == 200
    assert second.json()["replayed"] is True
    assert second.json()["deductions"] == body["deductions"]
    assert [row["quantity"] for row in stock(client)] == ["1 1/4"]
    entry = schedule(client, w["id"])[meal["id"]]
    assert entry["status"] == "cooked" and entry["cooked_servings"] == 6 and entry["cooked_at"]


def test_cooked_meal_is_frozen(client):  # AC3
    w, meal = scheduled_meal(client, yield_servings=4, servings=6)
    assert cook(client, w["id"], meal["id"]).status_code == 200
    patch = client.patch(f"/week-plans/{w['id']}/meals/{meal['id']}", json={"servings": 2})
    assert patch.status_code == 409
    assert client.delete(f"/week-plans/{w['id']}/meals/{meal['id']}").status_code == 409
    assert set_status(client, w["id"], meal["id"], "skipped").status_code == 409
    assert set_status(client, w["id"], meal["id"], "planned").status_code == 409
    assert assign(client, w["id"], meal["id"], None).status_code == 409
    entry = schedule(client, w["id"])[meal["id"]]
    assert entry["cooked_servings"] == 6 and entry["status"] == "cooked"
    assert client.get("/week-plans/current", params={"ref_date": WEEK}).json()["meal_servings"] == [
        {"meal_id": meal["id"], "servings": 6}]


def test_cook_requires_day_and_not_skipped(client):  # AC3
    buy(client, "purchase-0001", "2 cups rice")
    meal = make_meal(client, "Rice bowl", "1 cup rice")
    w = week(client)
    plan(client, w["id"], meal["id"])
    response = cook(client, w["id"], meal["id"])
    assert response.status_code == 409 and isinstance(response.json()["detail"], str)
    assign(client, w["id"], meal["id"], w["days"][0]["id"])
    set_status(client, w["id"], meal["id"], "skipped")
    assert cook(client, w["id"], meal["id"]).status_code == 409
    assert [row["quantity"] for row in stock(client)] == ["2"]
    assert schedule(client, w["id"])[meal["id"]]["status"] == "skipped"


def test_cook_short_stock_floors_and_reports(client):  # AC3
    buy(client, "purchase-0001", "1/2 cup rice")
    w, meal = scheduled_meal(client, ingredients="1 cup rice\n2 cups lentils")
    body = cook(client, w["id"], meal["id"]).json()
    by_item = {row["item"]: row for row in body["deductions"]}
    assert by_item["rice"] == {"item": "rice", "unit": "cup", "requested": "1",
                               "deducted": "1/2", "short": "1/2"}
    assert by_item["lentils"]["deducted"] == "0" and by_item["lentils"]["short"] == "2"
    assert stock(client) == []
    assert body["status"] == "cooked"


def test_cook_spans_fridge_then_pantry(client):  # AC3
    buy(client, "purchase-0001", "1 cup rice", "fridge")
    buy(client, "purchase-0002", "2 cups rice", "pantry")
    w, meal = scheduled_meal(client, ingredients="2 cups rice")
    body = cook(client, w["id"], meal["id"]).json()
    assert body["deductions"][0]["short"] == ""
    assert [(row["location"], row["quantity"]) for row in stock(client)] == [("pantry", "1")]


def test_unmeasured_lines_not_deducted(client):  # AC3
    buy(client, "purchase-0001", "2 cups rice")
    buy(client, "purchase-0002", "1 cup salt")
    w, meal = scheduled_meal(client, ingredients="1 cup rice\nsalt to taste")
    body = cook(client, w["id"], meal["id"]).json()
    assert body["untracked"] == ["salt to taste"]
    assert [d["item"] for d in body["deductions"]] == ["rice"]
    assert {row["item"]: row["quantity"] for row in stock(client)} == {"rice": "1", "salt": "1"}


def test_half_cabbage_reserved_until_cooked(client):  # AC4
    buy(client, "purchase-0001", "1 head cabbage")
    w = week(client)
    a = make_meal(client, "Slaw", "1/2 head of cabbage")
    b = make_meal(client, "Stir fry", "1/2 head of cabbage")
    plan(client, w["id"], a["id"])
    assert assign(client, w["id"], a["id"], w["days"][0]["id"]).status_code == 200
    assert cook(client, w["id"], a["id"]).status_code == 200
    assert [(r["item"], r["unit"], r["quantity"]) for r in stock(client)] == [("cabbage", "head", "1/2")]
    plan(client, w["id"], b["id"])
    assign(client, w["id"], b["id"], w["days"][1]["id"])
    # Planned but not cooked: still physically on hand, reserved, nothing left to spare.
    assert [r["quantity"] for r in stock(client)] == ["1/2"]
    row = availability(client)[("cabbage", "head")]
    assert row["on_hand"] == "1/2" and row["reserved"] == "1/2"
    assert row["available"] == "0" and row["short"] == ""
    assert cook(client, w["id"], b["id"]).status_code == 200
    assert stock(client) == []
    assert availability(client).get(("cabbage", "head")) is None


def test_reservation_shortfall_is_reported(client):  # AC4
    buy(client, "purchase-0001", "1/2 head cabbage")
    w = week(client)
    for name in ("Slaw", "Stir fry"):
        plan(client, w["id"], make_meal(client, name, "1/2 head of cabbage")["id"])
    row = availability(client)[("cabbage", "head")]
    assert row["reserved"] == "1" and row["available"] == "0" and row["short"] == "1/2"


def test_old_week_meals_schema_is_migrated(tmp_path):  # AC1
    path = tmp_path / "old.db"
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE meals (id INTEGER PRIMARY KEY, name VARCHAR, notes VARCHAR, tags VARCHAR, ingredients VARCHAR);
        CREATE TABLE week_meals (id INTEGER PRIMARY KEY, week_plan_id INTEGER, meal_id INTEGER);
        INSERT INTO meals (name, ingredients) VALUES ('Old', '1 cup rice');
        INSERT INTO week_meals (week_plan_id, meal_id) VALUES (1, 1);
    """)
    connection.commit()
    connection.close()

    engine = create_engine(f"sqlite:///{path}")
    ensure_columns(engine)
    ensure_columns(engine)
    columns = {c["name"] for c in inspect(engine).get_columns("week_meals")}
    assert {"servings", "day_id", "status", "cooked_servings", "cooked_at"} <= columns
    session = sessionmaker(bind=engine)()
    row = session.query(models.WeekMeal).one()
    assert (row.day_id, row.status, row.cooked_servings, row.cooked_at) == (None, None, None, None)
    assert schemas.WeekMealSchedule.model_validate(row).status == "planned"
    session.close()
    engine.dispose()


def test_credit_and_revert_still_work_after_cook(client):  # AC5
    buy(client, "purchase-0001", "1 cup rice")
    w, meal = scheduled_meal(client, ingredients="3/4 cup rice")
    assert cook(client, w["id"], meal["id"]).status_code == 200
    assert [r["quantity"] for r in stock(client)] == ["1/4"]
    assert buy(client, "purchase-0002", "1 cup rice").status_code == 200
    assert [r["quantity"] for r in stock(client)] == ["1 1/4"]
    assert client.delete("/inventory/purchases/purchase-0002").status_code == 200
    assert [r["quantity"] for r in stock(client)] == ["1/4"]
    # Reverting the original purchase after partial consumption floors at zero.
    assert client.delete("/inventory/purchases/purchase-0001").status_code == 200
    assert stock(client) == []


def test_put_inventory_sets_absolute_quantity(client):  # AC5
    item = buy(client, "purchase-0001", "2 cups rice").json()["inventory"]
    url = f"/inventory/{item['id']}"
    response = client.put(url, json={"quantity": "1 1/2"})
    assert response.status_code == 200
    # unit_group and added_at were added to the item payload (AC3); the original keys are unchanged.
    body = {k: v for k, v in response.json().items() if k not in ("unit_group", "added_at")}
    assert body == {"id": item["id"], "item": "rice", "unit": "cup",
                    "quantity": "1 1/2", "location": "pantry"}
    assert client.put(url, json={"quantity": "3"}).json()["quantity"] == "3"
    assert [r["quantity"] for r in stock(client)] == ["3"]
    assert client.put(url, json={"quantity": "0"}).status_code == 200
    assert stock(client) == []
    assert client.put(url, json={"quantity": "2"}).status_code == 200
    assert [r["quantity"] for r in stock(client)] == ["2"]
    for bad in ("abc", "-1", "1/0", "2 cups"):
        assert client.put(url, json={"quantity": bad}).status_code == 400
    assert client.put(url, json={"quantity": ""}).status_code == 422
    assert client.put("/inventory/99999", json={"quantity": "1"}).status_code == 404
    assert [r["quantity"] for r in stock(client)] == ["2"]


def test_put_inventory_leaves_reservations_alone(client):  # AC5
    item = buy(client, "purchase-0001", "2 cups rice").json()["inventory"]
    meal = make_meal(client, "Rice bowl", "1 cup rice")
    w = week(client)
    plan(client, w["id"], meal["id"])
    client.put(f"/inventory/{item['id']}", json={"quantity": "1/2"})
    row = availability(client)[("rice", "cup")]
    assert row["on_hand"] == "1/2" and row["reserved"] == "1" and row["short"] == "1/2"


def consumption_rows():
    session = SessionLocal()
    try:
        return session.query(models.InventoryConsumption).count()
    finally:
        session.close()


def test_stale_precheck_still_deducts_once(client):  # AC3
    buy(client, "purchase-0001", "2 cups rice")
    buy(client, "purchase-0002", "2 cups lentils")
    w, meal = scheduled_meal(client, ingredients="1 cup rice\n1 cup lentils")
    stale = SessionLocal()
    first = SessionLocal()
    try:
        # The second request has already loaded the meal as not cooked...
        assert stale.query(models.WeekMeal).one().status is None
        won = inventory.cook_week_meal(first, w["id"], meal["id"])
        # ...so its pre-check passes, and only the conditional UPDATE can stop a second deduction.
        lost = inventory.cook_week_meal(stale, w["id"], meal["id"])
    finally:
        stale.close()
        first.close()
    assert won["replayed"] is False and lost["replayed"] is True
    assert lost["deductions"] == won["deductions"]
    assert {row["item"]: row["quantity"] for row in stock(client)} == {"rice": "1", "lentils": "1"}
    assert consumption_rows() == 2


def test_failure_mid_cook_rolls_back_and_retry_succeeds(client, monkeypatch):  # AC3
    buy(client, "purchase-0001", "2 cups rice")
    buy(client, "purchase-0002", "2 cups lentils")
    w, meal = scheduled_meal(client, ingredients="1 cup rice\n1 cup lentils")
    before = stock(client)
    real = models.InventoryConsumption
    calls = []

    def failing_second(*args, **kwargs):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("simulated failure")
        return real(*args, **kwargs)

    monkeypatch.setattr(models, "InventoryConsumption", failing_second)
    failing_client = TestClient(app, raise_server_exceptions=False)
    assert cook(failing_client, w["id"], meal["id"]).status_code == 500
    monkeypatch.undo()
    assert schedule(client, w["id"])[meal["id"]]["status"] == "planned"
    assert schedule(client, w["id"])[meal["id"]]["cooked_servings"] is None
    assert stock(client) == before
    assert consumption_rows() == 0
    retry = cook(client, w["id"], meal["id"])
    assert retry.status_code == 200 and retry.json()["replayed"] is False
    assert {row["item"]: row["quantity"] for row in stock(client)} == {"rice": "1", "lentils": "1"}
    assert consumption_rows() == 2


def test_two_half_head_meals_reserve_whole_head(client):  # AC4
    buy(client, "purchase-0001", "1 head cabbage")
    w = week(client)
    for name in ("Slaw", "Stir fry"):
        plan(client, w["id"], make_meal(client, name, "1/2 head of cabbage")["id"])
    assert [r["quantity"] for r in stock(client)] == ["1"]
    row = availability(client)[("cabbage", "head")]
    assert (row["on_hand"], row["reserved"], row["available"], row["short"]) == ("1", "1", "0", "")


def test_cook_mixed_units_and_repeated_ingredient(client):  # AC3
    item = buy(client, "purchase-0001", "1 cup rice").json()["inventory"]
    w, meal = scheduled_meal(client, ingredients="4 tablespoons rice\n4 tbsp rice")
    body = cook(client, w["id"], meal["id"]).json()
    assert body["deductions"] == [{"item": "rice", "unit": "tablespoon", "requested": "8",
                                   "deducted": "8", "short": ""}]
    # Fields added for AC3 are ignored here; the original keys keep their exact values.
    assert [{k: row[k] for k in ("id", "item", "unit", "quantity", "location")} for row in stock(client)] == [
        {"id": item["id"], "item": "rice", "unit": "cup", "quantity": "1/2", "location": "pantry"}]
    assert consumption_rows() == 1


def test_zeroed_item_then_purchase_revert_stays_empty(client):  # AC5
    item = buy(client, "purchase-0001", "1 cup rice").json()["inventory"]
    assert client.put(f"/inventory/{item['id']}", json={"quantity": "0"}).status_code == 200
    assert client.delete("/inventory/purchases/purchase-0001").status_code == 200
    assert stock(client) == []


# --- Worth-repeating feedback (issue #43) ---

def mark(client, week_id, meal_id, value):
    return client.put(f"/week-plans/{week_id}/meals/{meal_id}/worth-repeating",
                      json={"worth_repeating": value})


def meal_payload(client, meal_id):
    return next(m for m in client.get("/meals").json() if m["id"] == meal_id)


def test_mark_requires_cooked_row(client):  # AC2
    w, meal = scheduled_meal(client)
    assert mark(client, w["id"], meal["id"], True).status_code == 409
    assert set_status(client, w["id"], meal["id"], "skipped").status_code == 200
    assert mark(client, w["id"], meal["id"], False).status_code == 409
    assert schedule(client, w["id"])[meal["id"]]["worth_repeating"] is None
    other = make_meal(client, "Stew", "1 cup rice")
    assert mark(client, w["id"], other["id"], True).status_code == 404


def test_cook_without_mark_is_unrated_and_distinct_from_false(client):  # AC3
    w, meal = scheduled_meal(client)
    body = cook(client, w["id"], meal["id"]).json()
    assert body["status"] == "cooked" and body["worth_repeating"] is None
    assert schedule(client, w["id"])[meal["id"]]["worth_repeating"] is None
    assert meal_payload(client, meal["id"])["worth_repeating"] is None
    assert mark(client, w["id"], meal["id"], False).status_code == 200
    assert schedule(client, w["id"])[meal["id"]]["worth_repeating"] is False
    assert meal_payload(client, meal["id"])["worth_repeating"] is False


def test_mark_set_change_clear_and_persist(client):  # AC1, AC5, AC7
    w, meal = scheduled_meal(client)
    assert cook(client, w["id"], meal["id"]).status_code == 200
    response = mark(client, w["id"], meal["id"], True)
    assert response.status_code == 200
    assert response.json()["meal_schedule"][0]["worth_repeating"] is True
    assert meal_payload(client, meal["id"])["worth_repeating"] is True
    assert cook(client, w["id"], meal["id"]).json()["worth_repeating"] is True  # replay shows it
    assert mark(client, w["id"], meal["id"], False).json()["meal_schedule"][0]["worth_repeating"] is False
    assert mark(client, w["id"], meal["id"], None).json()["meal_schedule"][0]["worth_repeating"] is None
    assert meal_payload(client, meal["id"])["worth_repeating"] is None
    assert mark(client, w["id"], meal["id"], "yes").status_code == 422


def test_mark_rejects_non_boolean_values_and_unknown_week(client):  # AC2, AC10 (F1: StrictBool)
    w, meal = scheduled_meal(client)
    assert cook(client, w["id"], meal["id"]).status_code == 200
    assert mark(client, w["id"], meal["id"], True).status_code == 200
    for bad in (1, 0, "true", "yes"):
        assert mark(client, w["id"], meal["id"], bad).status_code == 422, bad
    assert schedule(client, w["id"])[meal["id"]]["worth_repeating"] is True  # unchanged by rejected writes
    assert mark(client, w["id"] + 999, meal["id"], True).status_code == 404


def test_mark_is_idempotent_and_leaves_row_and_stock_alone(client):  # AC6
    buy(client, "purchase-0001", "1 cup rice")
    w, meal = scheduled_meal(client, ingredients="1/2 cup rice", servings=2)
    assert cook(client, w["id"], meal["id"]).status_code == 200
    before = schedule(client, w["id"])[meal["id"]]
    stock_before, consumptions_before = stock(client), consumption_rows()
    for _ in range(2):
        assert mark(client, w["id"], meal["id"], True).status_code == 200
    after = schedule(client, w["id"])[meal["id"]]
    assert after.pop("worth_repeating") is True
    before.pop("worth_repeating")
    assert after == before
    assert stock(client) == stock_before
    assert consumption_rows() == consumptions_before


def test_meal_value_is_latest_cooked_mark(client):  # AC5
    meal = make_meal(client, "Soup", "1/2 cup rice")
    first, second = week(client), week(client, NEXT_WEEK)
    for w in (first, second):
        plan(client, w["id"], meal["id"])
        assert assign(client, w["id"], meal["id"], w["days"][0]["id"]).status_code == 200
        assert cook(client, w["id"], meal["id"]).status_code == 200
    assert mark(client, first["id"], meal["id"], True).status_code == 200
    assert meal_payload(client, meal["id"])["worth_repeating"] is None  # latest cooking is unrated
    assert mark(client, second["id"], meal["id"], False).status_code == 200
    assert meal_payload(client, meal["id"])["worth_repeating"] is False


def test_meal_value_ignores_newer_uncooked_rows(client):  # AC5 (F7)
    meal = make_meal(client, "Soup", "1/2 cup rice")
    first, second = week(client), week(client, NEXT_WEEK)
    plan(client, first["id"], meal["id"])
    assert assign(client, first["id"], meal["id"], first["days"][0]["id"]).status_code == 200
    assert cook(client, first["id"], meal["id"]).status_code == 200
    assert mark(client, first["id"], meal["id"], True).status_code == 200
    plan(client, second["id"], meal["id"])  # newer week, planned but not cooked
    assert meal_payload(client, meal["id"])["worth_repeating"] is True
    assert set_status(client, second["id"], meal["id"], "skipped").status_code == 200
    assert meal_payload(client, meal["id"])["worth_repeating"] is True
    # Even a stray mark and a newer timestamp on the non-cooked row must not be picked up.
    session = SessionLocal()
    try:
        row = session.query(models.WeekMeal).filter_by(week_plan_id=second["id"], meal_id=meal["id"]).one()
        assert row.status == "skipped"
        row.worth_repeating = False
        row.cooked_at = datetime(2999, 1, 1)
        session.commit()
    finally:
        session.close()
    assert meal_payload(client, meal["id"])["worth_repeating"] is True


def test_meal_value_tie_on_cooked_at_uses_higher_id(client):  # AC5 (F7)
    meal = make_meal(client, "Soup", "1/2 cup rice")
    first, second = week(client), week(client, NEXT_WEEK)
    for w in (first, second):
        plan(client, w["id"], meal["id"])
        assert assign(client, w["id"], meal["id"], w["days"][0]["id"]).status_code == 200
        assert cook(client, w["id"], meal["id"]).status_code == 200
    assert mark(client, first["id"], meal["id"], True).status_code == 200
    assert mark(client, second["id"], meal["id"], False).status_code == 200
    session = SessionLocal()
    try:
        rows = session.query(models.WeekMeal).order_by(models.WeekMeal.id).all()
        assert len(rows) == 2
        for row in rows:
            row.cooked_at = rows[0].cooked_at
        session.commit()
    finally:
        session.close()
    assert meal_payload(client, meal["id"])["worth_repeating"] is False  # higher id wins the tie


def test_worth_repeating_column_is_added_idempotently(tmp_path):  # AC4
    path = tmp_path / "old.db"
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE meals (id INTEGER PRIMARY KEY, name VARCHAR, notes VARCHAR, tags VARCHAR, ingredients VARCHAR);
        CREATE TABLE week_meals (id INTEGER PRIMARY KEY, week_plan_id INTEGER, meal_id INTEGER,
                                 status VARCHAR, cooked_servings INTEGER, cooked_at DATETIME);
        INSERT INTO meals (name, ingredients) VALUES ('Old', '1 cup rice');
        INSERT INTO week_meals (week_plan_id, meal_id, status) VALUES (1, 1, 'cooked');
    """)
    connection.commit()
    connection.close()

    engine = create_engine(f"sqlite:///{path}")
    ensure_columns(engine)
    ensure_columns(engine)
    # F2: exactly one column after the second call, and the legacy row is neither lost nor duplicated
    assert [c["name"] for c in inspect(engine).get_columns("week_meals")].count("worth_repeating") == 1
    with engine.connect() as raw:
        assert [c[1] for c in raw.exec_driver_sql("PRAGMA table_info(week_meals)")].count("worth_repeating") == 1
        assert raw.exec_driver_sql("SELECT COUNT(*) FROM week_meals").scalar() == 1
    session = sessionmaker(bind=engine)()
    row = session.query(models.WeekMeal).one()
    assert row.status == "cooked" and row.worth_repeating is None
    assert schemas.WeekMealSchedule.model_validate(row).worth_repeating is None
    session.close()
    engine.dispose()


def test_suggestions_carry_mark_without_changing_order(client):  # AC9
    buy(client, "purchase-0001", "4 cups rice")
    first = make_meal(client, "Alpha rice", "1 cup rice")
    second = make_meal(client, "Beta rice", "1 cup rice")
    w, next_w = week(client), week(client, NEXT_WEEK)
    for cooked in (first, second):
        plan(client, w["id"], cooked["id"])
        assert assign(client, w["id"], cooked["id"], w["days"][0]["id"]).status_code == 200
        assert cook(client, w["id"], cooked["id"]).status_code == 200

    def suggestions():
        body = client.get(f"/week-plans/{next_w['id']}/stock-suggestions", params={"ref_date": NEXT_WEEK}).json()
        return [(s["meal_id"], s["worth_repeating"]) for s in body["suggestions"]]

    unmarked = suggestions()
    assert {meal_id for meal_id, _ in unmarked} == {first["id"], second["id"]}
    assert all(mark_ is None for _, mark_ in unmarked)
    # F5/F6: mark the meal that sorts second (Beta) true and the first (Alpha) false, so a bias
    # toward marked or unmarked meals in either direction would reorder the list.
    assert [meal_id for meal_id, _ in unmarked] == [first["id"], second["id"]]
    assert mark(client, w["id"], second["id"], True).status_code == 200
    assert mark(client, w["id"], first["id"], False).status_code == 200
    marked = suggestions()
    assert [meal_id for meal_id, _ in marked] == [meal_id for meal_id, _ in unmarked]
    assert dict(marked) == {first["id"]: False, second["id"]: True}
    # Swap the marks: a bias in the opposite direction must not reorder either.
    assert mark(client, w["id"], second["id"], False).status_code == 200
    assert mark(client, w["id"], first["id"], True).status_code == 200
    swapped = suggestions()
    assert [meal_id for meal_id, _ in swapped] == [meal_id for meal_id, _ in unmarked]
    assert dict(swapped) == {first["id"]: True, second["id"]: False}


def test_pairings_carry_mark_without_changing_order(client):  # AC9 (F5/F6)
    w = week(client)
    prior = week(client, "2025-12-29")
    alpha = make_meal(client, "Alpha rice", "1/2 cup rice")
    beta = make_meal(client, "Beta rice", "1/2 cup rice")
    gamma = make_meal(client, "Gamma rice", "1/2 cup rice")
    for cooked in (alpha, beta):
        plan(client, prior["id"], cooked["id"])
        assert assign(client, prior["id"], cooked["id"], prior["days"][0]["id"]).status_code == 200
        assert cook(client, prior["id"], cooked["id"]).status_code == 200
    track(client, w["id"], "1 cup rice")

    def listed():
        rows = pairings(client, w["id"])
        assert len(rows) == 1
        return [[(s["meal_id"], s["worth_repeating"]) for s in rows[0][key]] for key in ("current", "next_week")]

    unmarked = listed()
    assert [meal_id for meal_id, _ in unmarked[0]] == [alpha["id"], beta["id"], gamma["id"]]
    assert unmarked[0] == unmarked[1] and all(mark_ is None for _, mark_ in unmarked[0])
    assert mark(client, prior["id"], beta["id"], True).status_code == 200
    assert mark(client, prior["id"], alpha["id"], False).status_code == 200
    marked = listed()
    for before, after in zip(unmarked, marked):
        assert [meal_id for meal_id, _ in after] == [meal_id for meal_id, _ in before]
    assert dict(marked[0]) == {alpha["id"]: False, beta["id"]: True, gamma["id"]: None}
    assert dict(marked[1]) == dict(marked[0])
    assert mark(client, prior["id"], beta["id"], False).status_code == 200
    assert mark(client, prior["id"], alpha["id"], True).status_code == 200
    swapped = listed()
    for before, after in zip(unmarked, swapped):
        assert [meal_id for meal_id, _ in after] == [meal_id for meal_id, _ in before]
    assert dict(swapped[0]) == {alpha["id"]: True, beta["id"]: False, gamma["id"]: None}
