"""Kitchen page API (issue #27, AC3): added date, low flag, per-row reservations, use/return."""
import os
import sqlite3
import tempfile
from datetime import datetime

from sqlalchemy import create_engine

from app.database import ensure_columns
from test_api_servings import WEEK, make_meal, week, plan
from test_cooking import assign, availability
from test_inventory import buy, stock


def rows(client, ref=WEEK):
    return {(r["item"], r["location"]): r for r in client.get("/inventory", params={"ref_date": ref}).json()}


def schedule_meal(client, name, ingredients, day_index):
    meal = make_meal(client, name, ingredients)
    w = week(client)
    plan(client, w["id"], meal["id"])
    assert assign(client, w["id"], meal["id"], w["days"][day_index]["id"]).status_code == 200
    return meal


def row_id(client, item="rice", location="pantry"):
    return rows(client)[(item, location)]["id"]


def set_minimum(client, item_id, minimum):
    response = client.put(f"/inventory/{item_id}/minimum", json={"minimum": minimum})
    assert response.status_code == 200, response.text
    return response.json()


# unit_group (deliverable 1)

def test_unit_group_is_in_item_and_availability_payloads(client):  # AC3
    bought = buy(client, "purchase-0001", "2 cups rice").json()
    assert bought["inventory"]["unit_group"] == "volume"
    assert stock(client)[0]["unit_group"] == "volume"
    assert availability(client)[("rice", "cup")]["unit_group"] == "volume"


# added_at (deliverable 2)

def test_added_at_set_on_credit_and_unchanged_by_revert(client):  # AC3
    first = buy(client, "purchase-0001", "1 cup rice").json()["inventory"]
    stamp = first["added_at"]
    assert datetime.fromisoformat(stamp).utcoffset().total_seconds() == 0
    second = buy(client, "purchase-0002", "1 cup rice").json()["inventory"]
    assert datetime.fromisoformat(second["added_at"]) >= datetime.fromisoformat(stamp)
    before_revert = stock(client)[0]["added_at"]
    assert before_revert == second["added_at"]
    assert client.delete("/inventory/purchases/purchase-0002").status_code == 200
    assert stock(client)[0]["added_at"] == before_revert
    # A replayed credit changes nothing.
    buy(client, "purchase-0001", "1 cup rice")
    assert stock(client)[0]["added_at"] == before_revert


def test_added_at_backfill_is_guarded_and_idempotent(client):  # AC3
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "old.db")
        connection = sqlite3.connect(path)
        connection.executescript("""
            CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, item VARCHAR NOT NULL,
                unit_group VARCHAR NOT NULL, unit VARCHAR NOT NULL, location VARCHAR NOT NULL,
                base_quantity FLOAT NOT NULL);
            CREATE TABLE inventory_purchases (id INTEGER PRIMARY KEY, purchase_id VARCHAR NOT NULL,
                inventory_item_id INTEGER NOT NULL, amount VARCHAR NOT NULL, base_quantity FLOAT NOT NULL,
                reverted BOOLEAN NOT NULL, created_at DATETIME);
            INSERT INTO inventory_items VALUES (1, 'rice', 'volume', 'cup', 'pantry', 3);
            INSERT INTO inventory_items VALUES (2, 'salt', 'weight', 'ounce', 'pantry', 1);
            INSERT INTO inventory_items VALUES (3, 'kale', 'count', 'piece', 'fridge', 1);
            INSERT INTO inventory_purchases VALUES (1, 'p-1', 1, '1 cup rice', 1, 0, '2025-11-03 09:00:00');
            INSERT INTO inventory_purchases VALUES (2, 'p-2', 1, '1 cup rice', 1, 0, '2025-11-10 09:00:00');
            INSERT INTO inventory_purchases VALUES (3, 'p-3', 1, '1 cup rice', 1, 1, '2025-11-20 09:00:00');
            INSERT INTO inventory_purchases VALUES (4, 'p-4', 3, '1 kale', 1, 1, '2025-11-12 09:00:00');
        """)
        connection.commit()
        connection.close()
        engine = create_engine(f"sqlite:///{path}")
        ensure_columns(engine)
        with engine.connect() as conn:
            stored = dict(conn.exec_driver_sql("SELECT id, added_at FROM inventory_items").fetchall())
        # Latest non-reverted credit wins; no credit or only reverted credits stays NULL.
        assert stored[1].startswith("2025-11-10") and stored[2] is None and stored[3] is None
        # A stored date is never overwritten and a second run changes nothing.
        with engine.begin() as conn:
            conn.exec_driver_sql("INSERT INTO inventory_purchases VALUES (5, 'p-5', 1, '1 cup', 1, 0, '2026-01-01 09:00:00')")
        ensure_columns(engine)
        with engine.connect() as conn:
            again = dict(conn.exec_driver_sql("SELECT id, added_at FROM inventory_items").fetchall())
        assert again == stored
        engine.dispose()


# low flag (deliverable 3)

def test_low_is_aggregated_across_locations_around_the_minimum(client):  # AC3
    buy(client, "purchase-0001", "1 cup rice", "fridge")
    buy(client, "purchase-0002", "1 cup rice", "pantry")
    pantry = row_id(client)
    # No minimum: never low.
    assert [r["low"] for r in stock(client)] == [False, False]
    assert client.get("/inventory/staples").json() == []
    set_minimum(client, pantry, "2")  # on hand 2 across both rows == minimum: low
    assert [r["low"] for r in stock(client)] == [True, True]
    staples = client.get("/inventory/staples").json()
    assert staples[0]["low"] is True
    buy(client, "purchase-0003", "1/2 cup rice", "fridge")  # 2 1/2 > 2: not low
    assert [r["low"] for r in stock(client)] == [False, False]
    assert client.get("/inventory/staples").json()[0]["low"] is False
    # The row stock alone (1 cup) is under the minimum but the pool is not low.
    client.put(f"/inventory/{row_id(client, 'rice', 'fridge')}", json={"quantity": "1/2"})  # 1 1/2 <= 2
    assert all(r["low"] for r in stock(client))


def test_low_for_minimum_zero_and_other_units_stay_separate(client):  # AC3
    buy(client, "purchase-0001", "1 cup rice")
    buy(client, "purchase-0002", "1 lb rice")  # weight group: a different pool
    rice_volume = [r["id"] for r in stock(client) if r["unit"] == "cup"][0]
    result = set_minimum(client, rice_volume, "0")
    assert result["low"] is False  # 1 cup > 0
    by_unit = {r["unit"]: r for r in stock(client)}
    assert by_unit["cup"]["low"] is False and by_unit["pound"]["low"] is False
    client.put(f"/inventory/{rice_volume}", json={"quantity": "0"})  # run out
    staple = [s for s in client.get("/inventory/staples").json() if s["unit"] == "cup"][0]
    assert staple["low"] is True and staple["quantity"] == "0"
    assert set_minimum(client, rice_volume, "0")["low"] is True


# reservations per row (deliverable 4)

def test_reservations_split_fridge_first_then_pantry(client):  # AC3
    buy(client, "purchase-0001", "1 cup rice", "fridge")
    buy(client, "purchase-0002", "1 cup rice", "pantry")
    a = schedule_meal(client, "Rice bowl", "1 cup rice", 0)
    b = schedule_meal(client, "Rice salad", "1/2 cup rice", 1)
    c = schedule_meal(client, "Rice pudding", "1/2 cup rice", 2)
    listed = rows(client)
    fridge, pantry = listed[("rice", "fridge")], listed[("rice", "pantry")]
    assert fridge["reserved"] == "1" and pantry["reserved"] == "1"
    assert [(e["meal_id"], e["name"], e["day"], e["amount"]) for e in fridge["reserved_by"]] == [
        (a["id"], "Rice bowl", "Monday", "1")]
    assert [(e["meal_id"], e["amount"]) for e in pantry["reserved_by"]] == [(b["id"], "1/2"), (c["id"], "1/2")]


def test_one_meal_can_span_fridge_and_pantry_and_shortage_is_not_assigned(client):  # AC3
    buy(client, "purchase-0001", "1 cup rice", "fridge")
    buy(client, "purchase-0002", "1/2 cup rice", "pantry")
    meal = schedule_meal(client, "Big rice", "2 cups rice", 0)
    listed = rows(client)
    fridge, pantry = listed[("rice", "fridge")], listed[("rice", "pantry")]
    assert (fridge["reserved"], pantry["reserved"]) == ("1", "1/2")
    assert fridge["reserved_by"][0]["meal_id"] == meal["id"] == pantry["reserved_by"][0]["meal_id"]
    # Ingredient-wide figures still come from /inventory/availability, with a per-meal amount.
    row = availability(client)[("rice", "cup")]
    assert (row["on_hand"], row["reserved"], row["available"], row["short"]) == ("1 1/2", "2", "0", "1/2")
    assert [e["amount"] for e in row["reserved_by"]] == ["2"]


def test_rows_without_reservations_and_other_weeks(client):  # AC3
    buy(client, "purchase-0001", "1 cup rice")
    row = stock(client)[0]
    assert row["reserved"] == "0" and row["reserved_by"] == []
    schedule_meal(client, "Rice bowl", "1 cup rice", 0)
    # With today's date (after the planned week) nothing is reserved.
    assert client.get("/inventory").json()[0]["reserved"] == "0"
    assert rows(client)[("rice", "pantry")]["reserved"] == "1"


# use / return (deliverable 5)

def test_use_removes_amount_and_reports_what_was_removed(client):  # AC3
    buy(client, "purchase-0001", "2 cups rice")
    item_id = row_id(client)
    response = client.post(f"/inventory/{item_id}/use", json={"amount": "1/2"})
    assert response.status_code == 200
    body = response.json()
    assert body["removed"] == "1/2"
    assert body["item"]["quantity"] == "1 1/2" and body["item"]["id"] == item_id
    assert {"low", "reserved", "reserved_by", "unit_group", "added_at"} <= set(body["item"])
    assert stock(client)[0]["quantity"] == "1 1/2"


def test_use_clamps_at_zero(client):  # AC3
    buy(client, "purchase-0001", "1 cup rice")
    item_id = row_id(client)
    body = client.post(f"/inventory/{item_id}/use", json={"amount": "5"}).json()
    assert body["removed"] == "1" and body["item"]["quantity"] == "0"
    assert stock(client) == []  # empty rows are hidden from the list
    again = client.post(f"/inventory/{item_id}/use", json={"amount": "1"})
    assert again.status_code == 200 and again.json()["removed"] == "0"


def test_use_and_return_reject_bad_amounts_and_unknown_items(client):  # AC3
    buy(client, "purchase-0001", "1 cup rice")
    item_id = row_id(client)
    for path in ("use", "return"):
        for bad in ("0", "0/3", "abc", "-1", "1 cup"):
            response = client.post(f"/inventory/{item_id}/{path}", json={"amount": bad})
            assert response.status_code == 400 and isinstance(response.json()["detail"], str), (path, bad)
        assert client.post(f"/inventory/{item_id}/{path}", json={"amount": ""}).status_code == 422
        assert client.post(f"/inventory/9999/{path}", json={"amount": "1"}).status_code == 404
    assert stock(client)[0]["quantity"] == "1"  # nothing changed


def test_return_adds_back_and_undoes_a_use(client):  # AC3
    buy(client, "purchase-0001", "2 cups rice")
    item_id = row_id(client)
    used = client.post(f"/inventory/{item_id}/use", json={"amount": "3"}).json()
    assert used["removed"] == "2" and used["item"]["quantity"] == "0"
    back = client.post(f"/inventory/{item_id}/return", json={"amount": used["removed"]})
    assert back.status_code == 200
    assert back.json()["added"] == "2" and back.json()["item"]["quantity"] == "2"
    assert stock(client)[0]["quantity"] == "2"


def test_use_does_not_change_added_at_and_updates_low(client):  # AC3
    item = buy(client, "purchase-0001", "2 cups rice").json()["inventory"]
    set_minimum(client, item["id"], "1")
    assert stock(client)[0]["low"] is False
    body = client.post(f"/inventory/{item['id']}/use", json={"amount": "1"}).json()
    assert body["item"]["low"] is True and body["item"]["added_at"] == item["added_at"]
