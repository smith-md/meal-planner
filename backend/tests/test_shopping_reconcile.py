"""Tests for reconciling the shopping checklist with the plan and stock (issue #5, AC1-AC8)."""
import sqlite3

from sqlalchemy import create_engine, inspect

from app.database import ensure_columns
from test_api_servings import WEEK, NEXT_WEEK, make_meal, week, plan
from test_cooking import assign, set_status, cook
from test_inventory import buy, stock


def reconcile(client, w, ref=WEEK):
    response = client.get(f"/week-plans/{w['id']}/reconcile", params={"ref_date": ref})
    assert response.status_code == 200, response.text
    return response.json()


def apply(client, w, fingerprint, ref=WEEK):
    return client.post(f"/week-plans/{w['id']}/reconcile", json={"fingerprint": fingerprint, "ref_date": ref})


def apply_now(client, w, ref=WEEK):
    response = apply(client, w, reconcile(client, w, ref)["fingerprint"], ref)
    assert response.status_code == 200, response.text
    return response.json()


def entries(client):
    return client.get("/grocery-entries").json()


def by_item(result):
    return {row["item"]: row for row in result["ingredients"]}


def add_manual(client, name, key="manual-00000001"):
    response = client.post("/grocery-entries", json={"entry_key": f"manual:{key}", "name": name})
    assert response.status_code == 200, response.text
    return response.json()


def rice_week(client, ingredients="1 cup rice", yield_servings=None, servings=None, ref=WEEK):
    meal = make_meal(client, "Rice bowl", ingredients, yield_servings)
    w = week(client, ref)
    plan(client, w["id"], meal["id"], servings)
    return w, meal


def rice_row_id(client):
    return next(row["id"] for row in stock(client) if row["item"] == "rice")


def test_manual_entries_and_purchase_state_survive_reconcile(client):  # AC1
    w, meal = rice_week(client, "1 cup rice", yield_servings=2, servings=2)
    manual = add_manual(client, "paper towels")
    result = apply_now(client, w)
    plan_entry = next(e for e in result["entries"] if e["source"] == "plan")
    assert plan_entry["name"] == "1 cup of rice" and plan_entry["quantity"] == "1"
    assert buy(client, plan_entry["purchase_id"], "1 cup rice").status_code == 200
    credit = {"amount": "1 cup rice", "location": "pantry"}
    paid = client.patch(f"/grocery-entries/{plan_entry['id']}", json={"purchased": True, "credit": credit})
    assert paid.status_code == 200 and paid.json()["credit"] == credit
    # The plan now needs more rice; the bought entry and the manual entry must not change.
    client.patch(f"/week-plans/{w['id']}/meals/{meal['id']}", json={"servings": 6})
    preview = reconcile(client, w)
    assert preview["changes"]["update"] == [] and preview["changes"]["remove"] == []
    apply_now(client, w)
    after = {e["id"]: e for e in entries(client)}
    assert after[manual["id"]]["name"] == "paper towels" and after[manual["id"]]["purchased"] is False
    kept = after[plan_entry["id"]]
    assert kept["purchased"] is True and kept["credit"] == credit
    assert kept["purchase_id"] == plan_entry["purchase_id"] and kept["quantity"] == "1"


def test_legacy_import_keeps_credit_and_never_credits_again(client):  # AC1
    assert buy(client, "legacy-purchase-1", "2 cups flour").status_code == 200
    legacy = [{"id": 1731234567.5, "name": "2 cups flour", "purchased": True, "fromWeekPlan": True,
               "quantity": "2", "unit": "cup", "item": "flour", "purchaseId": "legacy-purchase-1",
               "credit": {"amount": "2 cups flour", "location": "pantry"}},
              {"id": 2, "name": "salt", "purchased": False}]
    first = client.post("/grocery-entries/import-local", json={"entries": legacy})
    assert first.status_code == 200
    flour = next(e for e in first.json() if e["name"] == "2 cups flour")
    assert flour["purchased"] and flour["purchase_id"] == "legacy-purchase-1"
    assert flour["credit"] == {"amount": "2 cups flour", "location": "pantry"}
    assert flour["item"] == "flour" and flour["source"] == "legacy"
    before = stock(client)
    # Importing did not credit stock; the old purchase id is still single-use and can be reverted.
    assert buy(client, "legacy-purchase-1", "2 cups flour").json()["replayed"] is True
    assert stock(client) == before
    assert client.delete("/inventory/purchases/legacy-purchase-1").json()["reverted"] is True
    assert stock(client) == []


def test_unpurchasing_rotates_purchase_id(client):  # AC1
    entry = add_manual(client, "2 cups rice")
    paid = client.patch(f"/grocery-entries/{entry['id']}", json={
        "purchased": True, "credit": {"amount": "2 cups rice", "location": "pantry"}}).json()
    assert paid["purchased"] and paid["purchase_id"] == entry["purchase_id"]
    back = client.patch(f"/grocery-entries/{entry['id']}", json={"purchased": False}).json()
    assert back["purchased"] is False and back["credit"] is None
    assert back["purchase_id"] != entry["purchase_id"]
    assert client.patch("/grocery-entries/9999", json={"purchased": True}).status_code == 404
    bad = client.patch(f"/grocery-entries/{entry['id']}", json={"credit": {"amount": "x", "location": "pantry"}})
    assert bad.status_code == 400 and isinstance(bad.json()["detail"], str)


def test_apply_then_preview_is_empty(client):  # AC2
    w, _ = rice_week(client, "2 cups rice\nsalt to taste")
    first = apply_now(client, w)
    assert first["summary"] == {"added": 2, "updated": 0, "removed": 0}
    count = len(entries(client))
    assert count == 2
    again = reconcile(client, w)
    assert again["changes"] == {"add": [], "update": [], "remove": []}
    second = apply(client, w, again["fingerprint"])
    assert second.status_code == 200 and second.json()["undo"] is None
    assert len(entries(client)) == count


def test_servings_change_updates_instead_of_duplicating(client):  # AC2
    w, meal = rice_week(client, "1 cup rice", yield_servings=2, servings=2)
    apply_now(client, w)
    client.patch(f"/week-plans/{w['id']}/meals/{meal['id']}", json={"servings": 6})
    changes = reconcile(client, w)["changes"]
    assert changes["add"] == [] and changes["remove"] == []
    assert [(c["from_quantity"], c["to_quantity"]) for c in changes["update"]] == [("1 cup", "3 cups")]
    apply_now(client, w)
    rows = entries(client)
    assert len(rows) == 1 and rows[0]["quantity"] == "3" and rows[0]["name"] == "3 cups of rice"


def test_import_local_twice_makes_no_duplicates(client):  # AC2
    legacy = [{"id": 11, "name": "milk"}, {"id": 12, "name": "eggs"}]
    client.post("/grocery-entries/import-local", json={"entries": legacy})
    again = client.post("/grocery-entries/import-local", json={"entries": legacy})
    assert again.status_code == 200 and [e["name"] for e in again.json()] == ["milk", "eggs"]
    assert client.post("/grocery-entries/import-local", json={"entries": [{"name": ""}, 5, None]}).status_code == 200
    assert len(entries(client)) == 2


def test_stale_fingerprint_is_rejected_and_writes_nothing(client):  # AC2
    w, meal = rice_week(client, "2 cups rice")
    stale = reconcile(client, w)["fingerprint"]
    other = make_meal(client, "Soup", "1 cup lentils")
    plan(client, w["id"], other["id"])
    response = apply(client, w, stale)
    assert response.status_code == 409 and isinstance(response.json()["detail"], str)
    assert entries(client) == []


def test_same_stock_does_not_cover_two_weeks(client):  # AC3
    buy(client, "purchase-0001", "3 cups rice")
    this_week, _ = rice_week(client, "2 cups rice")
    meal = make_meal(client, "Pilaf", "2 cups rice")
    next_week = week(client, NEXT_WEEK)
    plan(client, next_week["id"], meal["id"])
    current = by_item(reconcile(client, this_week))["rice"]
    assert current["to_buy"] == "0" and current["covered_by_stock"] is True
    following = reconcile(client, next_week)
    row = by_item(following)["rice"]
    assert following["position"] == "next"
    assert row["available"] == "1 cup" and row["held_for_earlier_weeks"] == "2 cups"
    assert row["demand"] == "2 cups" and row["to_buy"] == "1 cup"


def test_week_order_of_queries_does_not_change_allocation(client):  # AC3
    buy(client, "purchase-0001", "3 cups rice")
    this_week, _ = rice_week(client, "2 cups rice")
    meal = make_meal(client, "Pilaf", "2 cups rice")
    next_week = week(client, NEXT_WEEK)
    plan(client, next_week["id"], meal["id"])
    first_next = reconcile(client, next_week)
    first_this = reconcile(client, this_week)
    assert reconcile(client, next_week) == first_next
    assert reconcile(client, this_week) == first_this
    assert by_item(first_next)["rice"]["to_buy"] == "1 cup"
    assert by_item(first_this)["rice"]["to_buy"] == "0"


def test_cooked_and_skipped_meals_are_not_demand(client):  # AC3
    skipped = make_meal(client, "Skipped", "1 cup rice")
    cooked = make_meal(client, "Cooked", "1 cup lentils")
    w = week(client)
    plan(client, w["id"], skipped["id"])
    plan(client, w["id"], cooked["id"])
    assert set_status(client, w["id"], skipped["id"], "skipped").status_code == 200
    assert assign(client, w["id"], cooked["id"], w["days"][0]["id"]).status_code == 200
    assert cook(client, w["id"], cooked["id"]).status_code == 200
    result = reconcile(client, w)
    assert result["ingredients"] == [] and result["meal_count"] == 0


def test_demand_is_summed_with_the_meals_that_need_it(client):  # AC4
    buy(client, "purchase-0001", "1 cup rice")
    first = make_meal(client, "Chili", "1 cup rice")
    second = make_meal(client, "Burrito bowls", "2 cups rice")
    w = week(client)
    plan(client, w["id"], first["id"])
    plan(client, w["id"], second["id"])
    assign(client, w["id"], second["id"], w["days"][2]["id"])
    assign(client, w["id"], first["id"], w["days"][0]["id"])
    row = by_item(reconcile(client, w))["rice"]
    assert (row["demand"], row["available"], row["to_buy"]) == ("3 cups", "1 cup", "2 cups")
    assert [(m["name"], m["day"], m["amount"]) for m in row["meals"]] == [
        ("Chili", "Monday", "1 cup"), ("Burrito bowls", "Wednesday", "2 cups")]


def test_servings_scaling_is_reflected_in_demand(client):  # AC4
    w, _ = rice_week(client, "1 cup rice\nsalt to taste", yield_servings=2, servings=4)
    result = reconcile(client, w)
    assert by_item(result)["rice"]["demand"] == "2 cups"
    assert result["unmeasured"][0]["line"] == "salt to taste"
    assert result["unmeasured"][0]["note"] == "not scaled (recipe x2)"
    assert result["unmeasured"][0]["meals"][0]["name"] == "Rice bowl"
    unscaled = make_meal(client, "Plain", "1 cup oats")
    plan(client, w["id"], unscaled["id"])
    assert reconcile(client, w)["no_yield"] == ["Plain"]


def test_staple_at_or_below_minimum_warns(client):  # AC5
    buy(client, "purchase-0001", "1 cup rice")
    row_id = rice_row_id(client)
    below = client.put(f"/inventory/{row_id}/minimum", json={"minimum": "2"})
    assert below.status_code == 200 and below.json()["minimum"] == "2"
    w = week(client)
    staple = reconcile(client, w)["staples"][0]
    assert staple["item"] == "rice" and staple["on_hand"] == "1 cup" and staple["minimum"] == "2 cups"
    assert [x["type"] for x in staple["warnings"]] == ["below_minimum"]
    client.put(f"/inventory/{row_id}/minimum", json={"minimum": "1"})
    assert [x["type"] for x in reconcile(client, w)["staples"][0]["warnings"]] == ["below_minimum"]
    buy(client, "purchase-0002", "1 cup rice")
    staple = reconcile(client, w)["staples"][0]
    assert staple["warnings"] == [] and staple["on_hand"] == "2 cups"


def test_staple_with_demand_shows_in_ingredients_once(client):  # AC5
    buy(client, "purchase-0001", "1 cup rice")
    client.put(f"/inventory/{rice_row_id(client)}/minimum", json={"minimum": "2"})
    w, _ = rice_week(client, "1/2 cup rice")
    result = reconcile(client, w)
    assert result["staples"] == []
    assert [x["type"] for x in by_item(result)["rice"]["warnings"]] == ["below_minimum"]
    assert by_item(result)["rice"]["minimum"] == "2 cups" and by_item(result)["rice"]["inventory_id"]


def test_demand_above_stock_warns(client):  # AC5
    buy(client, "purchase-0001", "1 cup rice")
    w, _ = rice_week(client, "3 cups rice")
    row = by_item(reconcile(client, w))["rice"]
    assert [x["type"] for x in row["warnings"]] == ["short"]
    assert "2 cups" in row["warnings"][0]["message"]


def test_minimum_column_migrates_and_validates(client):  # AC5
    import tempfile
    import os
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "old.db")
        connection = sqlite3.connect(path)
        connection.executescript("""
            CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, item VARCHAR NOT NULL,
                unit_group VARCHAR NOT NULL, unit VARCHAR NOT NULL, location VARCHAR NOT NULL,
                base_quantity FLOAT NOT NULL);
            INSERT INTO inventory_items (item, unit_group, unit, location, base_quantity)
                VALUES ('rice', 'volume', 'cup', 'pantry', 1);
        """)
        connection.commit()
        connection.close()
        engine = create_engine(f"sqlite:///{path}")
        ensure_columns(engine)
        ensure_columns(engine)  # second run: no error, no change
        assert "minimum" in {c["name"] for c in inspect(engine).get_columns("inventory_items")}
        with engine.connect() as conn:
            assert conn.exec_driver_sql("SELECT minimum FROM inventory_items").fetchall() == [(None,)]
        engine.dispose()

    buy(client, "purchase-0001", "1 cup rice")
    row_id = rice_row_id(client)
    assert client.put(f"/inventory/{row_id}/minimum", json={"minimum": "lots"}).status_code == 400
    assert client.put("/inventory/9999/minimum", json={"minimum": "1"}).status_code == 404
    assert "minimum" not in stock(client)[0]  # GET /inventory keeps its shape
    assert client.put(f"/inventory/{row_id}/minimum", json={"minimum": "1/2"}).json()["minimum"] == "1/2"
    # An emptied stock row is hidden from /inventory but remains a tracked staple.
    client.put(f"/inventory/{row_id}", json={"quantity": "0"})
    assert stock(client) == []
    staples = client.get("/inventory/staples").json()
    assert [(s["item"], s["quantity"], s["minimum"]) for s in staples] == [("rice", "0", "1/2")]
    assert client.put(f"/inventory/{row_id}/minimum", json={"minimum": None}).json()["minimum"] is None
    assert client.get("/inventory/staples").json() == []


def test_minimum_is_one_value_across_fridge_and_pantry(client):  # AC5
    buy(client, "purchase-0001", "1 cup rice", "pantry")
    buy(client, "purchase-0002", "1 cup rice", "fridge")
    ids = [row["id"] for row in stock(client)]
    client.put(f"/inventory/{ids[0]}/minimum", json={"minimum": "3"})
    client.put(f"/inventory/{ids[1]}/minimum", json={"minimum": "2"})
    staples = client.get("/inventory/staples").json()
    assert len(staples) == 1
    staple = reconcile(client, week(client))["staples"][0]
    assert staple["on_hand"] == "2 cups" and staple["minimum"] == "2 cups"
    assert [x["type"] for x in staple["warnings"]] == ["below_minimum"]


def test_add_to_list_marks_ingredient_covered(client):  # AC6
    w, _ = rice_week(client, "2 cups rice")
    row = by_item(reconcile(client, w))["rice"]
    assert row["covered"] is False and row["add_name"] == "2 cups of rice"
    created = client.post("/grocery-entries", json={
        "entry_key": "added:11111111", "name": row["add_name"], "week_plan_id": w["id"]})
    assert created.status_code == 200 and created.json()["source"] == "added"
    after = by_item(reconcile(client, w))["rice"]
    assert after["covered"] is True and after["entry"]["id"] == created.json()["id"]


def test_second_add_for_covered_ingredient_is_rejected(client):  # AC6
    w, _ = rice_week(client, "2 cups rice")
    body = {"entry_key": "added:11111111", "name": "2 cups of rice", "week_plan_id": w["id"]}
    assert client.post("/grocery-entries", json=body).status_code == 200
    replay = client.post("/grocery-entries", json=body)
    assert replay.status_code == 200 and replay.json()["replayed"] is True
    other = client.post("/grocery-entries", json={**body, "entry_key": "added:22222222"})
    assert other.status_code == 409 and isinstance(other.json()["detail"], str)
    assert len(entries(client)) == 1
    bad = client.post("/grocery-entries", json={**body, "entry_key": "plan:1:rice:volume"})
    assert bad.status_code == 400 and isinstance(bad.json()["detail"], str)


def test_added_entry_suppresses_plan_add_and_manual_stays(client):  # AC6
    w, _ = rice_week(client, "2 cups rice")
    add_manual(client, "1 cup rice")
    result = reconcile(client, w)
    assert result["changes"]["add"] == []
    assert by_item(result)["rice"]["covered"] is True and by_item(result)["rice"]["entry"]["source"] == "manual"


def test_preview_writes_nothing(client):  # AC7
    w, _ = rice_week(client, "2 cups rice")
    add_manual(client, "paper towels")
    before = entries(client)
    first = reconcile(client, w)
    assert [a["name"] for a in first["changes"]["add"]] == ["2 cups of rice"]
    assert reconcile(client, w) == first
    assert entries(client) == before


def test_removing_a_meal_previews_a_removal(client):  # AC7
    w, meal = rice_week(client, "2 cups rice")
    apply_now(client, w)
    client.delete(f"/week-plans/{w['id']}/meals/{meal['id']}")
    changes = reconcile(client, w)["changes"]
    assert changes["add"] == [] and changes["update"] == []
    assert [r["name"] for r in changes["remove"]] == ["2 cups of rice"]
    assert len(entries(client)) == 1  # still there until applied
    result = apply_now(client, w)
    assert result["summary"] == {"added": 0, "updated": 0, "removed": 1} and entries(client) == []


def test_buying_stock_previews_a_lower_quantity(client):  # AC7
    w, _ = rice_week(client, "3 cups rice")
    apply_now(client, w)
    buy(client, "purchase-0001", "1 cup rice")
    changes = reconcile(client, w)["changes"]
    assert [(c["from_quantity"], c["to_quantity"]) for c in changes["update"]] == [("3 cups", "2 cups")]
    buy(client, "purchase-0002", "5 cups rice")
    assert [r["name"] for r in reconcile(client, w)["changes"]["remove"]] == ["3 cups of rice"]


def test_undo_restores_removed_and_updated_entries(client):  # AC7
    w, meal = rice_week(client, "2 cups rice\nsalt to taste", yield_servings=2, servings=2)
    apply_now(client, w)
    before = {e["entry_key"]: e for e in entries(client)}
    client.patch(f"/week-plans/{w['id']}/meals/{meal['id']}", json={"servings": 4})
    client.delete(f"/week-plans/{w['id']}/meals/{meal['id']}")
    other = make_meal(client, "Oats", "1 cup oats")
    plan(client, w["id"], other["id"])
    result = apply_now(client, w)
    assert result["summary"] == {"added": 1, "updated": 0, "removed": 2}
    restored = client.post("/grocery-entries/undo", json=result["undo"])
    assert restored.status_code == 200
    assert {e["entry_key"]: (e["name"], e["quantity"], e["purchase_id"]) for e in restored.json()} == {
        k: (v["name"], v["quantity"], v["purchase_id"]) for k, v in before.items()}


def test_undo_delete_recreates_entry_and_never_touches_purchased(client):  # AC1
    entry = add_manual(client, "2 cups rice")
    paid = client.patch(f"/grocery-entries/{entry['id']}", json={
        "purchased": True, "credit": {"amount": "2 cups rice", "location": "pantry"}}).json()
    assert client.delete(f"/grocery-entries/{entry['id']}").status_code == 204
    assert entries(client) == []
    restored = client.post("/grocery-entries/undo", json={"removed": [paid]}).json()
    assert restored[0]["purchased"] is True and restored[0]["credit"] == paid["credit"]
    assert restored[0]["purchase_id"] == paid["purchase_id"]
    # An undo that names a purchased entry as "added" must not delete it.
    kept = client.post("/grocery-entries/undo", json={"added_keys": [paid["entry_key"]]}).json()
    assert len(kept) == 1


def test_clear_purchased_only_removes_purchased(client):  # AC1
    keep = add_manual(client, "milk", "manual-00000001")
    done = add_manual(client, "eggs", "manual-00000002")
    client.patch(f"/grocery-entries/{done['id']}", json={"purchased": True})
    assert client.delete("/grocery-entries").status_code == 400
    assert client.delete("/grocery-entries", params={"purchased": "true"}).json() == {"deleted": 1}
    assert [e["id"] for e in entries(client)] == [keep["id"]]


def test_next_week_selection_and_past_week_rejected(client):  # AC8
    meal = make_meal(client, "Pilaf", "2 cups rice")
    next_week = week(client, NEXT_WEEK)
    plan(client, next_week["id"], meal["id"])
    result = reconcile(client, next_week)
    assert result["position"] == "next" and result["start_date"] == NEXT_WEEK
    assert by_item(result)["rice"]["to_buy"] == "2 cups"
    assert reconcile(client, week(client))["position"] == "this"
    past = week(client, "2025-12-01")
    response = client.get(f"/week-plans/{past['id']}/reconcile", params={"ref_date": WEEK})
    assert response.status_code == 400 and isinstance(response.json()["detail"], str)
    assert client.get("/week-plans/9999/reconcile").status_code == 404
    applied = apply_now(client, next_week)
    assert applied["entries"][0]["week_plan_id"] == next_week["id"]
    assert applied["entries"][0]["week_start"] == NEXT_WEEK
