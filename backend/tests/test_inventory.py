"""Tests for the persistent fridge/pantry inventory (issue #3, AC1-AC4 server side)."""
from test_api_servings import NEXT_WEEK, make_meal, week, plan

FAR_WEEK = "2027-06-07"


def buy(client, pid, amount="1 cup rice", location="pantry"):
    return client.post("/inventory/purchases", json={"purchase_id": pid, "amount": amount, "location": location})


def stock(client):
    return client.get("/inventory").json()


def test_same_purchase_id_credits_once(client):  # AC1
    first = buy(client, "purchase-0001")
    second = buy(client, "purchase-0001")
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["replayed"] is False
    assert second.json()["replayed"] is True
    assert stock(client) == [{"id": first.json()["inventory"]["id"], "item": "rice", "unit": "cup",
                              "quantity": "1", "location": "pantry"}]


def test_different_purchase_ids_add_up(client):  # AC1 control
    buy(client, "purchase-0001")
    buy(client, "purchase-0002")
    assert [row["quantity"] for row in stock(client)] == ["2"]


def test_revert_is_idempotent_and_id_is_single_use(client):  # AC1
    buy(client, "purchase-0001")
    first = client.delete("/inventory/purchases/purchase-0001")
    assert first.status_code == 200 and first.json()["reverted"] is True
    assert client.delete("/inventory/purchases/purchase-0001").status_code == 200
    assert stock(client) == []
    replay = buy(client, "purchase-0001")
    assert replay.json()["replayed"] is True and replay.json()["reverted"] is True
    assert stock(client) == []
    assert client.delete("/inventory/purchases/unknown-purchase").status_code == 404


def test_failed_parse_records_nothing_then_id_can_be_used(client):  # AC1
    bad = buy(client, "purchase-0001", "salt to taste")
    assert bad.status_code == 400 and isinstance(bad.json()["detail"], str)
    assert stock(client) == []
    assert buy(client, "purchase-0001", "1 cup salt").json()["replayed"] is False
    assert buy(client, "purchase-0001", "1 cup salt").json()["replayed"] is True
    assert [row["quantity"] for row in stock(client)] == ["1"]


def test_units_combine_and_groups_stay_separate(client):
    buy(client, "purchase-0001", "1 cup rice")
    buy(client, "purchase-0002", "8 tablespoons rice")
    buy(client, "purchase-0003", "2 onions")
    buy(client, "purchase-0004", "1 cup onion")
    buy(client, "purchase-0005", "1 cup rice", "fridge")
    rows = {(r["item"], r["unit"], r["location"]): r["quantity"] for r in stock(client)}
    assert rows == {
        ("rice", "cup", "pantry"): "1 1/2",
        ("onion", "", "pantry"): "2",
        ("onion", "cup", "pantry"): "1",
        ("rice", "cup", "fridge"): "1",
    }
    assert buy(client, "purchase-0006", "1/2 head cabbage").status_code == 200
    assert any(r["item"] == "cabbage" and r["unit"] == "head" for r in stock(client))


def test_inventory_survives_new_weeks(client):  # AC2, AC3
    buy(client, "purchase-0001")
    before = stock(client)
    week(client)
    week(client, NEXT_WEEK)
    far = week(client, FAR_WEEK)
    meal = make_meal(client, "Soup", "1 cup rice")
    plan(client, far["id"], meal["id"])
    client.delete(f"/week-plans/{far['id']}/meals/{meal['id']}")
    assert stock(client) == before


def test_invalid_inputs_rejected(client):  # AC4 server side
    for body in (
        {"purchase_id": "purchase-0001", "amount": "1 cup rice"},
        {"purchase_id": "purchase-0001", "amount": "1 cup rice", "location": "freezer"},
        {"purchase_id": "purchase-0001", "amount": "", "location": "pantry"},
    ):
        assert client.post("/inventory/purchases", json=body).status_code == 422
    bad = buy(client, "purchase-0001", "a pinch of salt")
    assert bad.status_code == 400 and isinstance(bad.json()["detail"], str)


def test_inventory_does_not_change_shopping_list(client):  # decision D1 guard
    meal = make_meal(client, "Rice bowl", "2 cups rice\nsalt to taste")
    w = week(client)
    plan(client, w["id"], meal["id"])
    before = client.get(f"/week-plans/{w['id']}/shopping-list").json()
    buy(client, "purchase-0001", "5 cups rice")
    assert client.get(f"/week-plans/{w['id']}/shopping-list").json() == before
