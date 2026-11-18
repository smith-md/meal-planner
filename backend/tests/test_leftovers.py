"""Tests for servings made/eaten and leftover reservations (issue #44, AC1-AC11)."""
import sqlite3

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import SessionLocal, ensure_columns
from test_api_servings import WEEK, NEXT_WEEK, make_meal, week, plan
from test_cooking import set_status
from test_inventory import buy, stock


def place(client, w, meal, day_index, slot="dinner", servings=None):
    plan(client, w["id"], meal["id"], servings)
    response = client.patch(f"/week-plans/{w['id']}/meals/{meal['id']}",
                            json={"date": w["days"][day_index]["date"], "slot": slot})
    assert response.status_code == 200, response.text


def cook(client, w, meal, body=None):
    url = f"/week-plans/{w['id']}/meals/{meal['id']}/cook"
    return client.post(url) if body is None else client.post(url, json=body)


def reserve(client, w, meal, day_index, slot="lunch", portions=1):
    return client.post(
        f"/week-plans/{w['id']}/meals/{meal['id']}/leftovers",
        json={"date": w["days"][day_index]["date"], "slot": slot, "portions": portions})


def cooked_meal(client, name="Chili", servings=6, day_index=0, slot="dinner", body=None, ingredients="1 cup rice"):
    w = week(client)
    meal = make_meal(client, name, ingredients, servings)
    place(client, w, meal, day_index, slot, servings)
    response = cook(client, w, meal, body)
    assert response.status_code == 200, response.text
    return w, meal, response.json()


def plan_json(client, w):
    return client.get("/week-plans/current", params={"ref_date": WEEK}).json()


def row_for(client, w, meal):
    return {r["meal_id"]: r for r in plan_json(client, w)["meal_schedule"]}[meal["id"]]


def snapshot(client, w):
    """Everything demand-related, read through the API."""
    wid = w["id"]
    reconcile = client.get(f"/week-plans/{wid}/reconcile", params={"ref_date": WEEK}).json()
    return {
        "reconcile": reconcile,
        "shopping": client.get(f"/week-plans/{wid}/shopping-list").json(),
        "availability": client.get("/inventory/availability", params={"ref_date": WEEK}).json(),
        "inventory": client.get("/inventory", params={"ref_date": WEEK}).json(),
        "suggestions": client.get(f"/week-plans/{wid}/stock-suggestions", params={"ref_date": WEEK}).json(),
        "pairings": client.get(f"/week-plans/{wid}/pairings").json(),
    }


def week_meal_count():
    with SessionLocal() as db:
        return db.query(models.WeekMeal).count()


# ---- AC1: servings made and eaten

def test_cook_without_body_defaults_made_to_planned_and_eaten_to_made(client):  # AC1
    w, meal, result = cooked_meal(client, servings=4)
    assert (result["servings_made"], result["servings_eaten"], result["servings_remaining"]) == (4, 4, 0)
    assert result["cooked_servings"] == 4 and result["servings_reserved"] == 0
    row = row_for(client, w, meal)
    assert (row["cooked_servings"], row["eaten_servings"], row["remaining_servings"]) == (4, 4, 0)


def test_cook_with_made_and_eaten_reports_remaining(client):  # AC1
    w, meal, result = cooked_meal(client, servings=4, body={"servings_made": 6, "servings_eaten": 2})
    assert (result["servings_made"], result["servings_eaten"], result["servings_remaining"]) == (6, 2, 4)
    row = row_for(client, w, meal)
    assert (row["cooked_servings"], row["eaten_servings"], row["remaining_servings"]) == (6, 2, 4)
    # Planned servings are unchanged by cooking a different number.
    with SessionLocal() as db:
        assert db.query(models.WeekMeal).one().servings == 4


def test_cook_eaten_defaults_to_made_when_only_made_sent(client):  # AC1
    _, _, result = cooked_meal(client, servings=4, body={"servings_made": 5})
    assert (result["servings_made"], result["servings_eaten"], result["servings_remaining"]) == (5, 5, 0)


def test_cook_rejects_invalid_servings(client):  # AC1
    w = week(client)
    meal = make_meal(client, "Soup", "1 cup rice", 4)
    place(client, w, meal, 0, "dinner", 4)
    for body in ({"servings_made": 0}, {"servings_made": 100}, {"servings_eaten": -1},
                 {"servings_made": 3, "servings_eaten": 4}, {"servings_eaten": 5}):
        response = cook(client, w, meal, body)
        assert 400 <= response.status_code < 500, (body, response.text)
    assert row_for(client, w, meal)["status"] == "planned"  # nothing was cooked or deducted


def test_cook_without_planned_servings_keeps_made_unknown(client):  # AC1
    w = week(client)
    meal = make_meal(client, "Toast", "1 cup rice")
    place(client, w, meal, 0)
    result = cook(client, w, meal).json()
    assert result["servings_made"] is None and result["servings_remaining"] is None
    assert reserve(client, w, meal, 1).status_code == 409


# ---- AC2: idempotent, deduction unchanged

def test_replayed_cook_returns_stored_values_without_second_deduction(client):  # AC2
    buy(client, "purchase-0001", "10 cups rice")
    w, meal, first = cooked_meal(client, servings=4, body={"servings_made": 4, "servings_eaten": 1},
                                 ingredients="1 cup rice")
    after_first = stock(client)
    second = cook(client, w, meal, {"servings_made": 9, "servings_eaten": 9}).json()
    assert second["replayed"] is True
    assert (second["servings_made"], second["servings_eaten"], second["servings_remaining"]) == (4, 1, 3)
    assert stock(client) == after_first


def test_deduction_scales_with_servings_made_not_eaten(client):  # AC2
    buy(client, "purchase-0001", "20 cups rice")
    w = week(client)
    meal = make_meal(client, "Rice", "2 cup rice", 2)
    place(client, w, meal, 0, "dinner", 2)
    result = cook(client, w, meal, {"servings_made": 4, "servings_eaten": 1}).json()
    # Yield 2, made 4: scale 2x -> 4 cups deducted, regardless of what was eaten.
    assert [d["deducted"] for d in result["deductions"]] == ["4"]
    assert stock(client)[0]["quantity"] == "16"


def test_default_cook_deducts_same_as_before(client):  # AC2
    buy(client, "purchase-0001", "20 cups rice")
    w = week(client)
    meal = make_meal(client, "Rice", "2 cup rice", 2)
    place(client, w, meal, 0, "dinner", 2)
    result = cook(client, w, meal).json()
    assert [d["deducted"] for d in result["deductions"]] == ["2"]


# ---- AC3: reserving

def test_reserve_portions_up_to_remaining_and_reject_more(client):  # AC3
    w, meal, _ = cooked_meal(client, body={"servings_made": 6, "servings_eaten": 2})
    first = reserve(client, w, meal, 1, "lunch", 1)
    assert first.status_code == 200, first.text
    second = reserve(client, w, meal, 2, "lunch", 3)
    assert second.status_code == 200
    over = reserve(client, w, meal, 3, "lunch", 1)
    assert over.status_code == 409
    leftovers = plan_json(client, w)["leftovers"]
    assert [(x["day_id"], x["slot"], x["portions"]) for x in leftovers] == [
        (w["days"][1]["id"], "lunch", 1), (w["days"][2]["id"], "lunch", 3)]
    assert row_for(client, w, meal)["reserved_servings"] == 4
    assert row_for(client, w, meal)["remaining_servings"] == 4  # made minus eaten, unchanged


def test_reserve_requires_cooked_source_and_known_week_meal(client):  # AC3
    w = week(client)
    meal = make_meal(client, "Soup", "", 4)
    place(client, w, meal, 0, "dinner", 4)
    assert reserve(client, w, meal, 1).status_code == 409
    other = make_meal(client, "Other", "")
    assert reserve(client, w, other, 1).status_code == 404


def test_reserve_same_slot_twice_is_rejected(client):  # AC3
    w, meal, _ = cooked_meal(client, body={"servings_made": 6, "servings_eaten": 1})
    assert reserve(client, w, meal, 1, "lunch").status_code == 200
    assert reserve(client, w, meal, 1, "lunch").status_code == 409
    assert len(plan_json(client, w)["leftovers"]) == 1


def test_reserve_validates_portions_and_slot(client):  # AC3
    w, meal, _ = cooked_meal(client, body={"servings_made": 6, "servings_eaten": 1})
    assert reserve(client, w, meal, 1, "lunch", 0).status_code == 422
    assert reserve(client, w, meal, 1, "brunch", 1).status_code == 422


# ---- AC4: strictly later, same week

def test_reservation_must_be_strictly_later(client):  # AC4
    w = week(client)
    meal = make_meal(client, "Stew", "", 6)
    place(client, w, meal, 2, "lunch", 6)  # Wednesday lunch
    assert cook(client, w, meal, {"servings_made": 6, "servings_eaten": 0}).status_code == 200
    assert reserve(client, w, meal, 2, "lunch").status_code == 400      # same day and slot
    assert reserve(client, w, meal, 2, "breakfast").status_code == 400  # earlier slot, same day
    assert reserve(client, w, meal, 1, "dinner").status_code == 400     # earlier day
    next_week = week(client, NEXT_WEEK)
    outside = client.post(f"/week-plans/{w['id']}/meals/{meal['id']}/leftovers",
                          json={"date": next_week["days"][0]["date"], "slot": "dinner", "portions": 1})
    assert outside.status_code == 400                                   # another week
    assert reserve(client, w, meal, 2, "dinner").status_code == 200     # later slot, same day
    assert reserve(client, w, meal, 3, "breakfast").status_code == 200  # later day, earliest slot
    assert plan_json(client, w)["leftovers"][0]["source_slot"] == "lunch"


# ---- AC5: plan shows the reserved slot

def test_plan_lists_leftover_with_slot_and_source_meal(client):  # AC5
    w, meal, _ = cooked_meal(client, "Lasagna", body={"servings_made": 6, "servings_eaten": 2})
    assert reserve(client, w, meal, 1, "lunch", 2).status_code == 200
    (leftover,) = plan_json(client, w)["leftovers"]
    assert leftover["meal_name"] == "Lasagna" and leftover["meal_id"] == meal["id"]
    assert (leftover["day_id"], leftover["slot"], leftover["portions"]) == (w["days"][1]["id"], "lunch", 2)
    assert (leftover["source_day_id"], leftover["source_slot"]) == (w["days"][0]["id"], "dinner")


# ---- AC6 / AC7: reservations add no demand

def test_reservations_do_not_change_reconcile_shopping_or_stock(client):  # AC6 AC7
    buy(client, "purchase-0001", "3 cups rice")
    track_meal = make_meal(client, "Side", "1 cup beans", 2)
    w, meal, _ = cooked_meal(client, "Rice bowl", servings=4, ingredients="1 cup rice",
                             body={"servings_made": 4, "servings_eaten": 1})
    place(client, w, track_meal, 3, "dinner", 2)
    before = snapshot(client, w)
    assert reserve(client, w, meal, 1, "lunch", 2).status_code == 200
    assert snapshot(client, w) == before
    (leftover,) = plan_json(client, w)["leftovers"]
    moved = client.patch(f"/week-plans/{w['id']}/leftovers/{leftover['id']}",
                         json={"date": w["days"][2]["date"], "slot": "dinner"})
    assert moved.status_code == 200
    assert snapshot(client, w) == before
    assert client.delete(f"/week-plans/{w['id']}/leftovers/{leftover['id']}").status_code == 200
    assert snapshot(client, w) == before


def test_applying_reconcile_is_identical_with_and_without_reservations(client):  # AC6
    w, meal, _ = cooked_meal(client, servings=4, ingredients="1 cup rice",
                             body={"servings_made": 4, "servings_eaten": 1})
    other = make_meal(client, "Beans", "2 cup beans", 2)
    place(client, w, other, 4, "dinner", 2)
    fingerprint = client.get(f"/week-plans/{w['id']}/reconcile", params={"ref_date": WEEK}).json()["fingerprint"]
    assert reserve(client, w, meal, 1, "lunch", 2).status_code == 200
    assert client.get(f"/week-plans/{w['id']}/reconcile", params={"ref_date": WEEK}).json()["fingerprint"] == fingerprint
    applied = client.post(f"/week-plans/{w['id']}/reconcile", json={"fingerprint": fingerprint, "ref_date": WEEK})
    assert applied.status_code == 200, applied.text
    entries_with = sorted((e["entry_key"], e["name"], e["quantity_base"]) for e in client.get("/grocery-entries").json())
    assert entries_with  # the plan does need groceries (beans), so the comparison below is meaningful
    # Releasing the reservation and re-applying changes nothing: the entries came from the meals only.
    client.delete(f"/week-plans/{w['id']}/leftovers/{plan_json(client, w)['leftovers'][0]['id']}")
    fingerprint = client.get(f"/week-plans/{w['id']}/reconcile", params={"ref_date": WEEK}).json()["fingerprint"]
    client.post(f"/week-plans/{w['id']}/reconcile", json={"fingerprint": fingerprint, "ref_date": WEEK})
    entries_without = sorted((e["entry_key"], e["name"], e["quantity_base"]) for e in client.get("/grocery-entries").json())
    assert entries_with == entries_without


# ---- AC8 is frontend slot/count logic; the API only guarantees Day.state is untouched

def test_reserving_does_not_change_day_state(client):  # AC8
    w, meal, _ = cooked_meal(client, body={"servings_made": 6, "servings_eaten": 1})
    assert reserve(client, w, meal, 1, "lunch").status_code == 200
    assert [d["state"] for d in plan_json(client, w)["days"]] == [d["state"] for d in w["days"]]


# ---- AC9: one row per (week, meal)

def test_reservation_creates_no_week_meal_row_and_duplicates_still_conflict(client):  # AC9
    w, meal, _ = cooked_meal(client, body={"servings_made": 6, "servings_eaten": 1})
    other = make_meal(client, "Other", "", 2)
    plan(client, w["id"], other["id"], 2)
    rows = week_meal_count()
    assert reserve(client, w, meal, 1, "lunch", 2).status_code == 200
    assert reserve(client, w, meal, 2, "lunch", 2).status_code == 200
    assert week_meal_count() == rows
    again = client.post(f"/week-plans/{w['id']}/meals",
                        json={"meal_id": meal["id"], "date": w["days"][3]["date"], "slot": "dinner"})
    assert again.status_code == 409
    assert week_meal_count() == rows
    base = f"/week-plans/{w['id']}/meals/{meal['id']}"
    assert client.patch(base, json={"servings": 3}).status_code == 409
    assert set_status(client, w["id"], meal["id"], "skipped").status_code in (400, 409)
    assert client.patch(f"/week-plans/{w['id']}/meals/{other['id']}", json={"servings": 3}).status_code == 200
    assert week_meal_count() == rows


# ---- AC10: release and move

def test_release_restores_unreserved_portions(client):  # AC10
    w, meal, _ = cooked_meal(client, body={"servings_made": 3, "servings_eaten": 0})
    assert reserve(client, w, meal, 1, "lunch", 3).status_code == 200
    assert reserve(client, w, meal, 2, "lunch", 1).status_code == 409
    (leftover,) = plan_json(client, w)["leftovers"]
    released = client.delete(f"/week-plans/{w['id']}/leftovers/{leftover['id']}")
    assert released.status_code == 200 and released.json()["leftovers"] == []
    assert row_for(client, w, meal)["reserved_servings"] == 0
    assert reserve(client, w, meal, 2, "lunch", 3).status_code == 200


def test_move_and_resize_reservation_with_same_checks(client):  # AC10 AC3 AC4
    w, meal, _ = cooked_meal(client, body={"servings_made": 4, "servings_eaten": 0})
    assert reserve(client, w, meal, 1, "lunch", 2).status_code == 200
    assert reserve(client, w, meal, 2, "lunch", 1).status_code == 200
    first, second = plan_json(client, w)["leftovers"]
    url = f"/week-plans/{w['id']}/leftovers/{first['id']}"
    moved = client.patch(url, json={"date": w["days"][4]["date"], "slot": "breakfast"})
    assert moved.status_code == 200
    updated = {x["id"]: x for x in moved.json()["leftovers"]}[first["id"]]
    assert (updated["day_id"], updated["slot"], updated["portions"]) == (w["days"][4]["id"], "breakfast", 2)
    assert client.patch(url, json={"date": w["days"][0]["date"], "slot": "lunch"}).status_code == 400  # earlier
    assert client.patch(url, json={"date": w["days"][2]["date"], "slot": "lunch"}).status_code == 409  # occupied
    assert client.patch(url, json={"portions": 4}).status_code == 409                                  # over
    assert client.patch(url, json={"portions": 3}).status_code == 200
    assert client.patch(url, json={"date": w["days"][1]["date"]}).status_code == 422                    # half a move
    assert client.patch(url, json={}).status_code == 422


def test_unknown_or_other_week_reservation_is_404(client):  # AC10
    w, meal, _ = cooked_meal(client, body={"servings_made": 4, "servings_eaten": 0})
    assert reserve(client, w, meal, 1, "lunch").status_code == 200
    (leftover,) = plan_json(client, w)["leftovers"]
    other_week = week(client, NEXT_WEEK)
    assert client.delete(f"/week-plans/{other_week['id']}/leftovers/{leftover['id']}").status_code == 404
    assert client.patch(f"/week-plans/{w['id']}/leftovers/9999", json={"portions": 1}).status_code == 404
    assert client.delete(f"/week-plans/{w['id']}/leftovers/9999").status_code == 404


# ---- AC11: nothing happens at week end

def test_unused_reservations_after_week_end_cause_no_error_or_change(client):  # AC11
    w, meal, _ = cooked_meal(client, body={"servings_made": 4, "servings_eaten": 0})
    assert reserve(client, w, meal, 6, "dinner", 4).status_code == 200
    after = "2026-02-20"
    assert client.get("/week-plans/current", params={"ref_date": after}).status_code == 200
    for path in ("/inventory/availability",):
        assert client.get(path, params={"ref_date": after}).status_code == 200
    (leftover,) = client.get("/week-plans/current", params={"ref_date": WEEK}).json()["leftovers"]
    assert leftover["portions"] == 4 and row_for(client, w, meal)["status"] == "cooked"


# ---- Migration

def test_old_database_gets_eaten_column_table_and_backfill(tmp_path):  # AC1 AC2
    path = tmp_path / "old.db"
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE meals (id INTEGER PRIMARY KEY, name VARCHAR, notes VARCHAR, tags VARCHAR, ingredients VARCHAR);
        CREATE TABLE week_meals (
            id INTEGER PRIMARY KEY, week_plan_id INTEGER, meal_id INTEGER, servings INTEGER,
            day_id INTEGER, status VARCHAR, cooked_servings INTEGER, cooked_at DATETIME, slot VARCHAR);
        INSERT INTO meals (id, name) VALUES (1, 'A'), (2, 'B'), (3, 'C');
        INSERT INTO week_meals VALUES
            (1, 1, 1, 4, 1, 'cooked', 5, '2026-01-06 18:30:00', 'dinner'),
            (2, 1, 2, 2, 1, NULL, NULL, NULL, 'dinner'),
            (3, 1, 3, 2, 1, 'cooked', NULL, '2026-01-06 18:30:00', 'dinner');
    """)
    connection.commit()
    connection.close()

    engine = create_engine(f"sqlite:///{path}")
    ensure_columns(engine)
    ensure_columns(engine)  # idempotent
    assert "eaten_servings" in {c["name"] for c in inspect(engine).get_columns("week_meals")}
    assert inspect(engine).has_table("leftover_reservations")
    session = sessionmaker(bind=engine)()
    rows = {r.id: r for r in session.query(models.WeekMeal).all()}
    assert (rows[1].eaten_servings, rows[1].remaining_servings) == (5, 0)  # eaten in full, no phantom leftovers
    assert (rows[2].eaten_servings, rows[2].remaining_servings) == (None, None)
    assert rows[3].eaten_servings is None
    session.execute(models.WeekMeal.__table__.update().where(models.WeekMeal.id == 1).values(eaten_servings=2))
    session.commit()
    ensure_columns(engine)
    session.expire_all()
    assert session.get(models.WeekMeal, 1).eaten_servings == 2  # a stored value is never overwritten
    session.close()
    engine.dispose()
