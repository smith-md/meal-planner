"""API-level tests for yields, planned servings, scaling, and pairing flags (AC1-AC5)."""
import sqlite3

from sqlalchemy import create_engine, inspect

from app.database import ensure_columns

WEEK = "2026-01-05"       # a Monday
NEXT_WEEK = "2026-01-12"


def make_meal(client, name, ingredients="", yield_servings=None):
    body = {"name": name, "ingredients": ingredients}
    if yield_servings is not None:
        body["yield_servings"] = yield_servings
    response = client.post("/meals", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def week(client, ref=WEEK):
    return client.get("/week-plans/current", params={"ref_date": ref}).json()


def plan(client, week_id, meal_id, servings=None):
    body = {"meal_id": meal_id}
    if servings is not None:
        body["servings"] = servings
    response = client.post(f"/week-plans/{week_id}/meals", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def shopping(client, week_id):
    return client.get(f"/week-plans/{week_id}/shopping-list").json()


def pairings(client, week_id):
    response = client.get(f"/week-plans/{week_id}/pairings")
    assert response.status_code == 200, response.text
    return response.json()


def track(client, week_id, amount, meal_id=None):
    response = client.post(f"/week-plans/{week_id}/pairings", json={"amount": amount, "meal_id": meal_id})
    assert response.status_code == 200, response.text
    return response.json()


# T1 (AC1)
def test_meal_yield_stored_and_validated(client):
    meal = make_meal(client, "Stew", yield_servings=4)
    assert meal["yield_servings"] == 4
    listed = client.get("/meals").json()
    assert listed[0]["yield_servings"] == 4
    assert client.post("/meals", json={"name": "x", "yield_servings": 0}).status_code == 422
    assert client.post("/meals", json={"name": "x", "yield_servings": 100}).status_code == 422


# D2 / O3 (AC1): older recipes can be given a yield
def test_patch_meal_yield(client):
    meal = make_meal(client, "Old recipe")
    assert meal["yield_servings"] is None
    updated = client.patch(f"/meals/{meal['id']}", json={"yield_servings": 6})
    assert updated.status_code == 200 and updated.json()["yield_servings"] == 6
    cleared = client.patch(f"/meals/{meal['id']}", json={"yield_servings": None})
    assert cleared.json()["yield_servings"] is None
    assert client.patch(f"/meals/{meal['id']}", json={"yield_servings": 0}).status_code == 422
    assert client.patch(f"/meals/{meal['id']}", json={"yield_servings": 100}).status_code == 422
    assert client.patch("/meals/9999", json={"yield_servings": 2}).status_code == 404


# T2 (AC1)
def test_planned_servings_stored_with_defaults(client):
    w = week(client)
    explicit = make_meal(client, "A", yield_servings=4)
    defaulted = make_meal(client, "B", yield_servings=4)
    no_yield = make_meal(client, "C")
    plan(client, w["id"], explicit["id"], servings=6)
    plan(client, w["id"], defaulted["id"])
    result = plan(client, w["id"], no_yield["id"])
    servings = {row["meal_id"]: row["servings"] for row in result["meal_servings"]}
    assert servings == {explicit["id"]: 6, defaulted["id"]: 4, no_yield["id"]: None}
    assert {m["id"] for m in result["meals"]} == set(servings)
    assert client.post(f"/week-plans/{w['id']}/meals",
                       json={"meal_id": explicit["id"], "servings": 0}).status_code == 422


# T3 (AC1)
def test_patch_week_meal_servings(client):
    w = week(client)
    meal = make_meal(client, "A", yield_servings=4)
    other = make_meal(client, "B", yield_servings=4)
    plan(client, w["id"], meal["id"])
    response = client.patch(f"/week-plans/{w['id']}/meals/{meal['id']}", json={"servings": 8})
    assert response.status_code == 200
    assert response.json()["meal_servings"] == [{"meal_id": meal["id"], "servings": 8}]
    assert client.patch(f"/week-plans/{w['id']}/meals/{other['id']}", json={"servings": 8}).status_code == 404
    assert client.patch(f"/week-plans/{w['id']}/meals/{meal['id']}", json={"servings": 0}).status_code == 422


# T4 (AC1): old databases are upgraded in place, idempotently
def test_ensure_columns_migrates_old_schema(tmp_path):
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
    ensure_columns(engine)  # second run: no error, no change
    inspector = inspect(engine)
    assert "yield_servings" in {c["name"] for c in inspector.get_columns("meals")}
    assert "servings" in {c["name"] for c in inspector.get_columns("week_meals")}
    with engine.connect() as conn:
        rows = conn.exec_driver_sql("SELECT yield_servings FROM meals").fetchall()
        assert rows == [(None,)]
        assert conn.exec_driver_sql("SELECT servings FROM week_meals").fetchall() == [(None,)]
    engine.dispose()


# T5 (AC2)
def test_shopping_list_scaled_by_servings_over_yield(client):
    w = week(client)
    meal = make_meal(client, "Rice bowl", "1/2 cup rice\n2 onions", yield_servings=4)
    plan(client, w["id"], meal["id"], servings=6)
    items = {i["item"]: i for i in shopping(client, w["id"])}
    assert (items["rice"]["quantity"], items["rice"]["unit"]) == ("3/4", "cup")
    assert (items["onion"]["quantity"], items["onion"]["unit"]) == ("3", "")


# T6 (AC2): scaled planned meals reduce the tracked remainder
def test_pairing_remaining_uses_scaled_meals(client):
    w = week(client)
    meal = make_meal(client, "Slaw", "1/4 head of cabbage", yield_servings=2)
    plan(client, w["id"], meal["id"], servings=4)
    rows = track(client, w["id"], "1 head of cabbage")
    assert rows[0]["remaining"] == "1/2 head of cabbage"
    assert rows[0]["needs_more"] is False


# T8 (AC3)
def test_compatible_units_combine_in_shopping_list(client):
    w = week(client)
    a = make_meal(client, "A", "1 cup broth\n500 g flour")
    b = make_meal(client, "B", "8 tbsp broth\n1 kg flour")
    plan(client, w["id"], a["id"])
    plan(client, w["id"], b["id"])
    items = {i["item"]: i for i in shopping(client, w["id"])}
    assert len(items) == 2
    assert (items["broth"]["quantity"], items["broth"]["unit"]) == ("1 1/2", "cup")
    assert (items["flour"]["quantity"], items["flour"]["unit"]) == ("1500", "gram")


# T9 (AC3): older recipe without yield stays unscaled
def test_missing_yield_not_scaled(client):
    w = week(client)
    meal = make_meal(client, "Old", "2 cups rice")
    assert client.get("/meals").json()[0]["yield_servings"] is None
    plan(client, w["id"], meal["id"], servings=6)
    items = shopping(client, w["id"])
    assert items == [{"quantity": "2", "unit": "cup", "item": "rice"}]


# T10 (AC3): ambiguous lines are kept, unscaled, and annotated only when scaling applies
def test_unmeasured_lines_noted_when_scaled(client):
    w = week(client)
    meal = make_meal(client, "Pasta", "salt to taste\n2-3 cloves garlic\n1 (14 oz) can tomatoes",
                     yield_servings=2)
    plan(client, w["id"], meal["id"], servings=4)
    items = shopping(client, w["id"])
    assert sorted(i["item"] for i in items) == [
        "1 (14 oz) can tomatoes", "2-3 cloves garlic", "salt to taste",
    ]
    for item in items:
        assert item["quantity"] == "" and item["unit"] == ""
        assert item["note"] == "not scaled (recipe x2)"

    plan(client, week(client, NEXT_WEEK)["id"], meal["id"], servings=2)
    next_items = shopping(client, week(client, NEXT_WEEK)["id"])
    assert len(next_items) == 3
    assert all("note" not in item for item in next_items)


# T11 (AC4)
def test_units_stay_separate_in_shopping_list(client):
    w = week(client)
    meal = make_meal(client, "Mixed", "1 cup flour\n4 oz flour\n2 chicken breasts\n"
                                      "1 lb chicken breasts\n3 cloves garlic\n2 garlic")
    plan(client, w["id"], meal["id"])
    got = {(i["quantity"], i["unit"], i["item"]) for i in shopping(client, w["id"])}
    assert got == {
        ("1", "cup", "flour"), ("4", "ounce", "flour"),
        ("2", "", "chicken breasts"), ("1", "pound", "chicken breasts"),
        ("3", "clove", "garlic"), ("2", "", "garlic"),
    }


def _cabbage_setup(client):
    w = week(client)
    source = make_meal(client, "Source", "")
    consumer = make_meal(client, "Consumer", "1/4 head of cabbage", yield_servings=4)
    plan(client, w["id"], source["id"])
    plan(client, w["id"], consumer["id"], servings=4)
    track(client, w["id"], "1/2 head of cabbage", meal_id=source["id"])
    return w, consumer


# T12 (AC5)
def test_changing_servings_recalculates_remainder_and_flags_shortfall(client):
    w, consumer = _cabbage_setup(client)
    before = pairings(client, w["id"])[0]
    assert before["remaining"] == "1/4 head of cabbage"
    assert before["needs_more"] is False and before["shortfall"] == ""

    client.patch(f"/week-plans/{w['id']}/meals/{consumer['id']}", json={"servings": 12})
    after = pairings(client, w["id"])[0]
    assert after["remaining"] == ""
    assert after["needs_more"] is True
    assert after["shortfall"] == "1/4 head of cabbage"


# T13 (AC5): nothing is cached; reverting clears the flag
def test_reverting_servings_clears_flag(client):
    w, consumer = _cabbage_setup(client)
    client.patch(f"/week-plans/{w['id']}/meals/{consumer['id']}", json={"servings": 12})
    assert pairings(client, w["id"])[0]["needs_more"] is True
    client.patch(f"/week-plans/{w['id']}/meals/{consumer['id']}", json={"servings": 4})
    row = pairings(client, w["id"])[0]
    assert row["needs_more"] is False
    assert row["remaining"] == "1/4 head of cabbage"


# D4 (AC5): the following week's planned meals count toward the flag
def test_following_week_meals_raise_flag(client):
    w, consumer = _cabbage_setup(client)
    next_week = week(client, NEXT_WEEK)
    plan(client, next_week["id"], consumer["id"], servings=12)  # needs 3/4 head
    row = pairings(client, w["id"])[0]
    assert row["needs_more"] is True
    assert row["shortfall"] == "1/2 head of cabbage"


# T14 (AC5): suggestion candidates that need more are flagged, ordering unchanged
def test_suggestions_flag_needs_more(client):
    w = week(client)
    make_meal(client, "Big", "1/2 head of cabbage")
    make_meal(client, "Small", "1/4 head of cabbage")
    rows = track(client, w["id"], "1/4 head of cabbage")
    suggestions = rows[0]["current"]
    assert [s["name"] for s in suggestions] == ["Small", "Big"]
    assert [s["needs_more"] for s in suggestions] == [False, True]
    assert suggestions[1]["extra"] == "1/4 head of cabbage"
    assert suggestions[0]["extra"] == ""


# T15: regressions
def test_duplicate_tracked_ingredient_conflicts(client):
    w, _ = _cabbage_setup(client)
    response = client.post(f"/week-plans/{w['id']}/pairings", json={"amount": "1 head of cabbage"})
    assert response.status_code == 409


def test_removing_meal_deletes_tracked_rows_and_planning(client):
    w, consumer = _cabbage_setup(client)
    source_id = next(m["id"] for m in client.get("/meals").json() if m["name"] == "Source")
    result = client.delete(f"/week-plans/{w['id']}/meals/{source_id}")
    assert result.status_code == 200
    assert source_id not in {m["id"] for m in result.json()["meals"]}
    assert source_id not in {row["meal_id"] for row in result.json()["meal_servings"]}
    assert pairings(client, w["id"]) == []
    # the other meal is untouched and keeps its servings
    assert [row["servings"] for row in result.json()["meal_servings"]] == [4]


def test_adding_same_meal_twice_keeps_one_row(client):
    w = week(client)
    meal = make_meal(client, "A", yield_servings=4)
    plan(client, w["id"], meal["id"], servings=2)
    result = plan(client, w["id"], meal["id"], servings=9)
    assert result["meal_servings"] == [{"meal_id": meal["id"], "servings": 2}]


THIRD_WEEK = "2026-01-19"


def _carried_setup(client, tracked="1/2 head of cabbage", other_week1=None):
    """Week 1 tracks a leftover from an ingredient-free source meal; returns (week2, source)."""
    w1 = week(client)
    source = make_meal(client, "Source", "")
    plan(client, w1["id"], source["id"])
    if other_week1 is not None:
        plan(client, w1["id"], other_week1["id"])
    track(client, w1["id"], tracked, meal_id=source["id"])
    return week(client, NEXT_WEEK), source


def _carried_row(client, week_id):
    rows = pairings(client, week_id)
    assert len(rows) == 1
    return rows[0]


# F1 (AC5): carried row flags a shortfall from the viewed week's scaled meals
def test_carried_row_flags_shortfall_from_scaled_meal(client):
    w2, _ = _carried_setup(client)
    consumer = make_meal(client, "Consumer", "1/4 head of cabbage", yield_servings=4)
    plan(client, w2["id"], consumer["id"], servings=4)
    row = _carried_row(client, w2["id"])
    assert row["carried"] is True
    assert row["remaining"] == "1/4 head of cabbage"
    assert row["needs_more"] is False and row["shortfall"] == ""

    client.patch(f"/week-plans/{w2['id']}/meals/{consumer['id']}", json={"servings": 12})  # 3/4 head
    row = _carried_row(client, w2["id"])
    assert row["carried"] is True
    assert row["remaining"] == ""
    assert row["needs_more"] is True
    assert row["shortfall"] == "1/4 head of cabbage"


# F1 (AC5): in the carried case the following week's meals do not raise the flag
def test_carried_row_ignores_following_week_meals(client):
    w2, _ = _carried_setup(client)
    consumer = make_meal(client, "Consumer", "1/4 head of cabbage", yield_servings=4)
    plan(client, w2["id"], consumer["id"], servings=4)
    plan(client, week(client, THIRD_WEEK)["id"], consumer["id"], servings=12)  # needs 3/4 head
    row = _carried_row(client, w2["id"])
    assert row["carried"] is True
    assert row["needs_more"] is False and row["shortfall"] == ""
    assert row["remaining"] == "1/4 head of cabbage"
    assert row["next_week"] == []


# F2a (AC2): carried leftover reduces next week's purchase by exactly the leftover
def test_shopping_list_subtracts_carried_leftover(client):
    w2, _ = _carried_setup(client)
    meal = make_meal(client, "Slaw", "1 head of cabbage\n2 onions")
    plan(client, w2["id"], meal["id"])
    items = {i["item"]: i for i in shopping(client, w2["id"])}
    assert (items["cabbage"]["quantity"], items["cabbage"]["unit"]) == ("1/2", "head")
    assert (items["onion"]["quantity"], items["onion"]["unit"]) == ("2", "")


# F2b (AC2): a leftover over-used in its source week never reduces next week's purchases
def test_shopping_list_ignores_overused_carried_leftover(client):
    heavy = make_meal(client, "Heavy", "3/4 head of cabbage")
    w2, _ = _carried_setup(client, other_week1=heavy)
    meal = make_meal(client, "Slaw", "1 head of cabbage")
    plan(client, w2["id"], meal["id"])
    items = shopping(client, w2["id"])
    assert items == [{"quantity": "1", "unit": "head", "item": "cabbage"}]
    row = _carried_row(client, w2["id"])
    assert row["remaining"] == ""


# F4 (AC5): consuming exactly the leftover is not a shortfall
def test_exact_consumption_is_not_a_shortfall(client):
    w, consumer = _cabbage_setup(client)
    client.patch(f"/week-plans/{w['id']}/meals/{consumer['id']}", json={"servings": 8})  # 1/2 head
    row = pairings(client, w["id"])[0]
    assert row["remaining"] == ""
    assert row["needs_more"] is False and row["shortfall"] == ""


# F4 (AC5): exact consumption also holds for carried rows
def test_exact_consumption_carried_is_not_a_shortfall(client):
    w2, _ = _carried_setup(client)
    consumer = make_meal(client, "Consumer", "1/4 head of cabbage", yield_servings=4)
    plan(client, w2["id"], consumer["id"], servings=8)  # exactly 1/2 head
    row = _carried_row(client, w2["id"])
    assert row["carried"] is True
    assert row["remaining"] == ""
    assert row["needs_more"] is False and row["shortfall"] == ""


# F4 (AC5): float error from x3 scaling of repeating fractions stays within tolerance
def test_exact_consumption_survives_float_scaling_error(client):
    for amount, ingredient, servings in (
        ("1 head of cabbage", "1/3 head of cabbage", 6),      # 1/3 * 3
        ("0.3 head of cabbage", "0.1 head of cabbage", 6),    # 0.1 * 3 != 0.3 in floats
    ):
        w = week(client, WEEK)
        source = make_meal(client, f"Source {amount}", "")
        consumer = make_meal(client, f"Consumer {ingredient}", ingredient, yield_servings=2)
        plan(client, w["id"], source["id"])
        plan(client, w["id"], consumer["id"], servings=servings)
        rows = track(client, w["id"], amount, meal_id=source["id"])
        row = rows[-1]
        assert row["remaining"] == ""
        assert row["needs_more"] is False and row["shortfall"] == ""
        client.delete(f"/week-plans/{w['id']}/meals/{source['id']}")  # drops its tracked row
        client.delete(f"/week-plans/{w['id']}/meals/{consumer['id']}")
