"""Tests for package sizes on the shopping list (issue #6, AC1-AC4)."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from test_api_servings import WEEK, make_meal, week, plan
from test_inventory import buy, stock
from test_shopping_reconcile import reconcile, apply, apply_now, entries, by_item

TOMATOES = "crushed tomatoes"


def put_size(client, item=TOMATOES, group="weight", size="28 oz", label="can"):
    return client.put("/package-sizes", json={"item": item, "unit_group": group, "size": size, "label": label})


def tomato_week(client, need="20 oz crushed tomatoes"):
    meal = make_meal(client, "Sauce", need)
    w = week(client, WEEK)
    plan(client, w["id"], meal["id"], None)
    return w


def plan_entry(client):
    return next(e for e in entries(client) if e["source"] == "plan")


def test_save_list_overwrite_and_clear_size_without_stock(client):  # AC1
    assert stock(client) == []
    response = put_size(client)
    assert response.status_code == 200, response.text
    assert response.json() == {"item": TOMATOES, "unit_group": "weight", "size": "28 oz", "label": "can"}
    assert client.get("/package-sizes").json() == [response.json()]
    w = tomato_week(client)
    assert by_item(reconcile(client, w))[TOMATOES]["package"]["size"] == "28 oz"
    assert put_size(client, size="1 lb", label=None).json()["size"] == "1 lb"
    assert len(client.get("/package-sizes").json()) == 1
    cleared = client.put("/package-sizes", json={"item": TOMATOES, "unit_group": "weight", "size": None})
    assert cleared.status_code == 200 and cleared.json() is None
    assert client.get("/package-sizes").json() == []
    assert by_item(reconcile(client, w))[TOMATOES]["package"] is None


def test_invalid_sizes_are_rejected(client):  # AC1
    for size in ("lots", "0 oz", "2 cups", "28", "0.001 oz"):
        assert put_size(client, size=size).status_code == 400, size
    assert put_size(client, group="can", size="28 oz").status_code == 400
    assert put_size(client, size="1" * 21).status_code == 422
    assert put_size(client, label="x" * 21).status_code == 422
    assert put_size(client, label="can (big)").status_code == 400
    assert put_size(client, group="volume", size="28 oz").status_code == 400
    assert client.get("/package-sizes").json() == []


def test_issue_example_shows_packages_and_remainder(client):  # AC2
    w = tomato_week(client)
    assert buy(client, "purchase-0001", "4 oz crushed tomatoes").status_code == 200
    put_size(client)
    row = by_item(reconcile(client, w))[TOMATOES]
    assert row["to_buy"] == "16 ounces"
    assert row["package"] == {"size": "28 oz", "label": "can", "packages": 1,
                              "buy": "28 ounces", "remainder": "12 ounces"}
    assert row["unit_group"] == "weight" and row["package_eligible"] is True
    assert row["add_name"] == "28 ounces of crushed tomatoes (1 can)"
    change = reconcile(client, w)["changes"]["add"][0]
    assert change["name"] == "28 ounces of crushed tomatoes (1 can)" and change["quantity"] == "28 ounces"


def test_multiple_packages_exact_multiple_and_covered(client):  # AC2
    w = tomato_week(client, "40 oz crushed tomatoes")
    put_size(client)
    package = by_item(reconcile(client, w))[TOMATOES]["package"]
    assert (package["packages"], package["buy"], package["remainder"]) == (2, "56 ounces", "16 ounces")
    assert by_item(reconcile(client, w))[TOMATOES]["add_name"] == "56 ounces of crushed tomatoes (2 cans)"
    put_size(client, size="20 oz", label=None)
    package = by_item(reconcile(client, w))[TOMATOES]["package"]
    assert (package["packages"], package["remainder"], package["label"]) == (2, "0", "package")
    buy(client, "purchase-0001", "40 oz crushed tomatoes")
    row = by_item(reconcile(client, w))[TOMATOES]
    assert row["covered_by_stock"] is True and row["package"]["packages"] == 0
    assert reconcile(client, w)["changes"]["add"] == []


def test_label_change_updates_entry_and_stale_fingerprint(client):  # AC2
    w = tomato_week(client)
    put_size(client)
    apply_now(client, w)
    first = plan_entry(client)
    assert first["name"] == "28 ounces of crushed tomatoes (1 can)"
    stale = reconcile(client, w)["fingerprint"]
    put_size(client, label="jar")
    preview = reconcile(client, w)
    assert [c["name"] for c in preview["changes"]["update"]] == ["28 ounces of crushed tomatoes (1 jar)"]
    assert preview["fingerprint"] != stale
    assert apply(client, w, stale).status_code == 409
    apply_now(client, w)
    assert plan_entry(client)["name"] == "28 ounces of crushed tomatoes (1 jar)"
    client.put("/package-sizes", json={"item": TOMATOES, "unit_group": "weight", "size": None})
    result = apply(client, w, reconcile(client, w)["fingerprint"])
    assert result.status_code == 200
    assert plan_entry(client)["name"] == "20 ounces of crushed tomatoes"
    assert plan_entry(client)["quantity"] == "20"


def test_added_entry_with_package_name_covers_row(client):  # AC2
    w = tomato_week(client)
    put_size(client)
    row = by_item(reconcile(client, w))[TOMATOES]
    body = {"entry_key": "added:00000001", "name": row["add_name"], "week_plan_id": w["id"]}
    assert client.post("/grocery-entries", json=body).status_code == 200
    assert by_item(reconcile(client, w))[TOMATOES]["covered"] is True
    again = client.post("/grocery-entries", json={**body, "entry_key": "added:00000002"})
    assert again.status_code == 409


def test_checkoff_credits_full_package_quantity(client):  # AC3
    w = tomato_week(client)
    buy(client, "purchase-0001", "4 oz crushed tomatoes")
    put_size(client)
    apply_now(client, w)
    entry = plan_entry(client)
    assert entry["quantity"] == "28" and entry["unit"] == "ounce"
    amount = f"{entry['quantity']} {entry['unit']} {entry['item']}"  # what plannedAmount builds
    assert buy(client, entry["purchase_id"], amount).status_code == 200
    quantities = [row for row in stock(client) if row["item"] == TOMATOES]
    assert sum(float(row["quantity"]) for row in quantities) == 32
    assert by_item(reconcile(client, w))[TOMATOES]["covered_by_stock"] is True
    assert client.delete(f"/inventory/purchases/{entry['purchase_id']}").status_code == 200
    assert sum(float(row["quantity"]) for row in stock(client) if row["item"] == TOMATOES) == 4


def test_produce_and_package_units_stay_as_before(client):  # AC4
    for item, group in (("onion", "count"), ("cilantro", "bunch"), ("cabbage", "head"),
                        ("garlic", "clove"), ("beans", "can"), ("rice", "bag"), ("pasta", "package")):
        assert put_size(client, item=item, group=group, size="1 oz").status_code == 400, group
    meal = make_meal(client, "Veg", "3 onions\n1 bunch cilantro\n1 lb potatoes")
    w = week(client, WEEK)
    plan(client, w["id"], meal["id"], None)
    rows = by_item(reconcile(client, w))
    assert rows["onion"]["package_eligible"] is False and rows["onion"]["package"] is None
    assert rows["cilantro"]["package_eligible"] is False and rows["cilantro"]["add_name"] == "1 bunch of cilantro"
    assert rows["onion"]["add_name"] == "3 onion"
    assert rows["potato"]["package"] is None and rows["potato"]["add_name"] == "1 pound of potato"


def test_package_sizes_table_is_created_for_old_database(tmp_path):  # AC1 (existing databases keep working)
    path = tmp_path / "old.db"
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, item TEXT NOT NULL, "
                       "unit_group TEXT NOT NULL, unit TEXT NOT NULL, location TEXT NOT NULL, "
                       "base_quantity FLOAT NOT NULL)")
    connection.commit()
    assert "package_sizes" not in {r[0] for r in connection.execute("SELECT name FROM sqlite_master")}
    connection.close()
    backend = Path(__file__).resolve().parent.parent
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{path.as_posix()}"}
    # Importing app.main is the real startup path: it runs create_all and ensure_columns.
    result = subprocess.run([sys.executable, "-c", "import app.main"], cwd=backend, env=env,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    connection = sqlite3.connect(path)
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    columns = {r[1] for r in connection.execute("PRAGMA table_info(inventory_items)")}
    connection.close()
    assert "package_sizes" in tables
    assert "minimum" in columns  # the pre-existing table was migrated by the same startup


def test_large_package_total_never_uses_exponent_text_and_checks_off(client):  # AC3
    meal = make_meal(client, "Bread", "500 g flour")
    w = week(client, WEEK)
    plan(client, w["id"], meal["id"], None)
    assert put_size(client, item="flour", size="25 lb", label="bag").status_code == 200
    row = by_item(reconcile(client, w))["flour"]
    assert "e+" not in row["package"]["buy"] and "e+" not in row["add_name"], row
    apply_now(client, w)
    entry = plan_entry(client)
    assert "e" not in entry["quantity"], entry
    amount = f"{entry['quantity']} {entry['unit']} {entry['item']}"
    assert buy(client, entry["purchase_id"], amount).status_code == 200
    total = sum(float(r["quantity"]) for r in stock(client) if r["item"] == "flour")
    assert total > 0


def test_display_quantity_never_emits_exponent_and_keeps_ordinary_values():  # AC3
    from app.pairings import Ingredient, parse_amount
    gram = Ingredient(0, "gram", "flour")
    for grams in (321500.0, 11339.8, 0.00001234, 1e9):
        text = gram.display_quantity(grams * gram.factor)
        assert "e" not in text.lower(), text
    assert gram.display_quantity(1234.567 * gram.factor) == "1235"
    assert gram.display_quantity(0.123456 * gram.factor) == "0.1235"
    ounce = Ingredient(0, "ounce", "x")
    assert ounce.display_quantity(1.5 * ounce.factor) == "1 1/2"
    assert gram.display_quantity(2.5 * gram.factor) == "2 1/2"
    assert parse_amount(f"{gram.display_quantity(321500.0 * gram.factor)} grams flour") is not None


def test_oz_shortfall_with_lb_size(client):  # AC2
    w = tomato_week(client, "20 oz crushed tomatoes")
    buy(client, "purchase-0001", "4 oz crushed tomatoes")
    put_size(client, size="1 lb")
    package = by_item(reconcile(client, w))[TOMATOES]["package"]
    assert (package["packages"], package["buy"], package["remainder"]) == (1, "16 ounces", "0")
    assert package["size"] == "1 lb"


def test_oz_need_without_stock_rounds_up_lb_packages(client):  # AC2
    w = tomato_week(client, "40 oz crushed tomatoes")
    put_size(client, size="1 lb")
    package = by_item(reconcile(client, w))[TOMATOES]["package"]
    assert (package["packages"], package["buy"], package["remainder"]) == (3, "48 ounces", "8 ounces")


def test_volume_need_with_quart_size(client):  # AC2
    meal = make_meal(client, "Soup", "3 cups chicken stock")
    w = week(client, WEEK)
    plan(client, w["id"], meal["id"], None)
    assert put_size(client, item="chicken stock", group="volume", size="1 qt", label="carton").status_code == 200
    row = by_item(reconcile(client, w))["chicken stock"]
    package = row["package"]
    assert (package["packages"], package["buy"], package["remainder"]) == (1, "4 cups", "1 cup")
    assert row["add_name"] == "4 cups of chicken stock (1 carton)"


def test_label_is_none_after_overwrite_without_label(client):  # AC1
    assert put_size(client, label="can").json()["label"] == "can"
    assert put_size(client, size="1 lb", label=None).json()["label"] is None
    assert client.get("/package-sizes").json()[0]["label"] is None


def test_same_item_has_separate_rows_per_unit_group(client):  # AC1
    put_size(client, item="milk", group="weight", size="8 oz", label="pack")
    put_size(client, item="milk", group="volume", size="1 qt", label="carton")
    rows = client.get("/package-sizes").json()
    assert {(r["unit_group"], r["size"]) for r in rows} == {("weight", "8 oz"), ("volume", "1 qt")}
    client.put("/package-sizes", json={"item": "milk", "unit_group": "weight", "size": None})
    assert [r["unit_group"] for r in client.get("/package-sizes").json()] == ["volume"]


def test_blank_size_deletes_and_missing_delete_is_noop(client):  # AC1
    put_size(client)
    blank = client.put("/package-sizes", json={"item": TOMATOES, "unit_group": "weight", "size": "   "})
    assert blank.status_code == 200 and blank.json() is None
    assert client.get("/package-sizes").json() == []
    missing = client.put("/package-sizes", json={"item": "never saved", "unit_group": "weight", "size": None})
    assert missing.status_code == 200 and missing.json() is None


def test_item_name_is_normalized(client):  # AC1
    saved = put_size(client, item="  Crushed   TOMATOES ")
    assert saved.json()["item"] == TOMATOES
    again = put_size(client, item="crushed tomatoes", size="1 lb")
    assert again.json()["item"] == TOMATOES
    assert len(client.get("/package-sizes").json()) == 1


def test_plural_rule_for_labels(client):  # AC2
    w = tomato_week(client, "100 oz crushed tomatoes")
    expected = {"jar": "jars", "box": "boxes", "glass": "glasses", "bunch": "bunches", "dish": "dishes"}
    for label, plural in expected.items():
        put_size(client, size="28 oz", label=label)
        row = by_item(reconcile(client, w))[TOMATOES]
        assert row["add_name"].endswith(f"(4 {plural})"), row["add_name"]
    put_size(client, size="100 oz", label="box")
    assert by_item(reconcile(client, w))[TOMATOES]["add_name"].endswith("(1 box)")


def test_fractional_package_size(client):  # AC1, AC2
    w = tomato_week(client, "40 oz crushed tomatoes")
    saved = put_size(client, size="1 1/2 lb")
    assert saved.status_code == 200 and saved.json()["size"] == "1 1/2 lb"
    package = by_item(reconcile(client, w))[TOMATOES]["package"]
    assert (package["packages"], package["buy"], package["remainder"]) == (2, "48 ounces", "8 ounces")


def test_purchased_entry_is_not_changed_when_label_changes(client):  # AC3
    w = tomato_week(client)
    put_size(client)
    apply_now(client, w)
    entry = plan_entry(client)
    amount = f"{entry['quantity']} {entry['unit']} {entry['item']}"
    credit = {"amount": amount, "location": "pantry"}
    paid = client.patch(f"/grocery-entries/{entry['id']}", json={"purchased": True, "credit": credit})
    assert paid.status_code == 200, paid.text
    put_size(client, label="jar")
    preview = reconcile(client, w)
    assert all(c["entry_key"] != entry["entry_key"] for c in preview["changes"]["update"])
    apply_now(client, w)
    assert plan_entry(client)["name"] == "28 ounces of crushed tomatoes (1 can)"
