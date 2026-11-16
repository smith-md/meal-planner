"""Tests for ranking saved meals by available stock (issue #7, AC1-AC3)."""
from test_api_servings import WEEK, NEXT_WEEK, make_meal, week, plan, track
from test_cooking import assign, set_status, cook
from test_inventory import buy


def suggestions(client, w, ref=WEEK):
    response = client.get(f"/week-plans/{w['id']}/stock-suggestions", params={"ref_date": ref})
    assert response.status_code == 200, response.text
    return response.json()


def by_name(result):
    return {row["name"]: row for row in result["suggestions"]}


def use_for(suggestion, item):
    return next(use for use in suggestion["uses"] if use["item"] == item)


def cabbage_setup(client, slaw_servings=None):
    """1 head cabbage in the fridge, Slaw (1/2 head, yield 4) planned for Wednesday, a saved soup."""
    assert buy(client, "cab-0001", "1 head cabbage", "fridge").status_code == 200
    slaw = make_meal(client, "Slaw", "1/2 head cabbage", 4)
    soup = make_meal(client, "Cabbage soup", "1/2 head cabbage\n2 cups broth")
    w = week(client)
    plan(client, w["id"], slaw["id"], slaw_servings)
    assert assign(client, w["id"], slaw["id"], w["days"][2]["id"]).status_code == 200
    return w, slaw, soup


def test_uses_and_groceries_for_confirmed_stock(client):  # AC1
    assert buy(client, "rice-0001", "2 cups rice", "pantry").status_code == 200
    make_meal(client, "Fried rice", "1 cup rice\n2 eggs\n1 tablespoon soy sauce")
    result = suggestions(client, week(client))
    fried = by_name(result)["Fried rice"]
    rice = use_for(fried, "rice")
    assert rice["used"] == "1 cup"
    assert rice["source"] == "confirmed" and rice["locations"] == ["pantry"] and rice["after_meals"] == []
    assert {g["item"]: g["name"] for g in fried["groceries"]} == {
        "eggs": "2 eggs", "soy sauce": "1 tablespoon of soy sauce"}
    assert all(not g["partial"] for g in fried["groceries"])
    assert fried["coverage_percent"] == 33
    assert (fried["covered_count"], fried["ingredient_count"]) == (1, 3)


def test_partial_cover_lists_rest_to_buy(client):  # AC1
    assert buy(client, "rice-0001", "1/2 cup rice", "pantry").status_code == 200
    make_meal(client, "Rice bowl", "1 cup rice")
    bowl = by_name(suggestions(client, week(client)))["Rice bowl"]
    assert use_for(bowl, "rice")["used"] == "1/2 cup"
    assert bowl["groceries"] == [{"key": "rice|volume", "item": "rice", "amount": "1/2 cup",
                                  "name": "1/2 cup of rice", "partial": True}]
    assert bowl["coverage_percent"] == 50


def test_ranking_and_exclusions(client):  # AC1
    assert buy(client, "rice-0001", "2 cups rice", "pantry").status_code == 200
    make_meal(client, "Half covered", "1 cup rice\n1 cup lentils")
    make_meal(client, "Fully covered", "1 cup rice")
    make_meal(client, "No stock", "1 cup lentils")
    planned = make_meal(client, "Already planned", "1 cup rice")
    w = week(client)
    plan(client, w["id"], planned["id"])
    names = [row["name"] for row in suggestions(client, w)["suggestions"]]
    assert names == ["Fully covered", "Half covered"]


def test_ranking_tie_breaks_by_groceries_then_name(client):  # AC1 (D4)
    assert buy(client, "rice-0001", "2 cups rice", "pantry").status_code == 200
    make_meal(client, "B", "1 cup rice\n1 cup lentils")
    make_meal(client, "A", "1 cup rice\n1 cup lentils")
    names = [row["name"] for row in suggestions(client, week(client))["suggestions"]]
    assert names == ["A", "B"]


def test_unmeasured_lines_are_listed_not_counted(client):  # AC1 (D3)
    assert buy(client, "rice-0001", "1 cup rice", "pantry").status_code == 200
    make_meal(client, "Rice", "1 cup rice\nsalt to taste")
    rice = by_name(suggestions(client, week(client)))["Rice"]
    assert rice["unmeasured"] == ["salt to taste"]
    assert rice["groceries"] == []
    assert rice["coverage_percent"] == 100 and rice["ingredient_count"] == 1


def test_limit_is_ten(client):  # AC1 (D4)
    assert buy(client, "rice-0001", "20 cups rice", "pantry").status_code == 200
    for index in range(12):
        make_meal(client, f"Meal {index:02d}", "1 cup rice")
    names = [row["name"] for row in suggestions(client, week(client))["suggestions"]]
    assert names == [f"Meal {index:02d}" for index in range(10)]


def test_half_cabbage_is_projected_this_week(client):  # AC2
    w, slaw, soup = cabbage_setup(client)
    result = suggestions(client, w)
    assert "Slaw" not in by_name(result)
    cabbage = use_for(by_name(result)["Cabbage soup"], "cabbage")
    assert cabbage["used"] == "1/2 head" and cabbage["source"] == "projected"
    assert cabbage["locations"] == []
    assert [(m["name"], m["day"]) for m in cabbage["after_meals"]] == [("Slaw", "Wednesday")]
    remainder = next(r for r in result["remainders"] if r["item"] == "cabbage")
    assert remainder["amount"] == "1/2 head" and remainder["source"] == "projected"


def test_half_cabbage_is_projected_next_week(client):  # AC2
    w, slaw, soup = cabbage_setup(client)
    nxt = week(client, NEXT_WEEK)
    cabbage = use_for(by_name(suggestions(client, nxt))["Cabbage soup"], "cabbage")
    assert cabbage["used"] == "1/2 head" and cabbage["source"] == "projected"
    assert cabbage["after_meals"][0]["name"] == "Slaw"


def test_earlier_weeks_take_stock_first(client):  # AC2 (D1)
    w, slaw, soup = cabbage_setup(client)
    nxt = week(client, NEXT_WEEK)
    stir = make_meal(client, "Stir fry", "1/2 head cabbage")
    plan(client, nxt["id"], stir["id"])
    # Next week's own plan takes the remainder, so the soup no longer has cabbage to use there.
    assert "Cabbage soup" not in by_name(suggestions(client, nxt))
    # This week ignores next week's demand (earlier week first).
    cabbage = use_for(by_name(suggestions(client, w))["Cabbage soup"], "cabbage")
    assert cabbage["used"] == "1/2 head" and cabbage["source"] == "projected"


def test_cooking_turns_projected_into_confirmed(client):  # AC2, AC3
    w, slaw, soup = cabbage_setup(client)
    assert cook(client, w["id"], slaw["id"]).status_code == 200
    cabbage = use_for(by_name(suggestions(client, w))["Cabbage soup"], "cabbage")
    assert cabbage["used"] == "1/2 head"
    assert cabbage["source"] == "confirmed" and cabbage["locations"] == ["fridge"]
    assert cabbage["after_meals"] == []


def test_skipping_releases_planned_stock(client):  # AC2
    w, slaw, soup = cabbage_setup(client)
    assert set_status(client, w["id"], slaw["id"], "skipped").status_code == 200
    result = suggestions(client, w)
    cabbage = use_for(by_name(result)["Cabbage soup"], "cabbage")
    assert cabbage["source"] == "confirmed" and cabbage["locations"] == ["fridge"]
    remainder = next(r for r in result["remainders"] if r["item"] == "cabbage")
    assert remainder["amount"] == "1 head" and remainder["source"] == "confirmed"


def test_each_use_carries_its_own_source(client):  # AC3
    w, slaw, soup = cabbage_setup(client)
    assert buy(client, "rice-0001", "1 cup rice", "pantry").status_code == 200
    make_meal(client, "Rice and cabbage", "1/2 head cabbage\n1 cup rice")
    meal = by_name(suggestions(client, w))["Rice and cabbage"]
    sources = {use["item"]: use for use in meal["uses"]}
    assert sources["rice"]["source"] == "confirmed" and sources["rice"]["after_meals"] == []
    assert sources["rice"]["locations"] == ["pantry"]
    assert sources["cabbage"]["source"] == "projected" and sources["cabbage"]["locations"] == []
    assert sources["cabbage"]["after_meals"][0]["name"] == "Slaw"


def test_planned_servings_scale_the_projection(client):  # AC2
    w, slaw, soup = cabbage_setup(client, slaw_servings=8)  # 2x the yield uses the whole head
    result = suggestions(client, w)
    assert "Cabbage soup" not in by_name(result)
    assert not any(r["item"] == "cabbage" for r in result["remainders"])


def test_past_week_and_unknown_week_are_rejected(client):  # AC1
    w = week(client)
    past = client.get(f"/week-plans/{w['id']}/stock-suggestions", params={"ref_date": NEXT_WEEK})
    assert past.status_code == 400
    assert client.get("/week-plans/9999/stock-suggestions").status_code == 404


def test_unbought_purchase_leftover_is_not_stock(client):  # TR1 (D2)
    w = week(client)
    body = {"entry_key": "manual:00000001", "name": "2 cups rice", "week_plan_id": w["id"]}
    assert client.post("/grocery-entries", json=body).status_code == 200
    make_meal(client, "Fried rice", "1 cup rice")
    result = suggestions(client, w)
    assert result["suggestions"] == [] and result["remainders"] == []


def test_pairing_ingredient_leftover_is_not_stock(client):  # TR1 (D5)
    w = week(client)
    source = make_meal(client, "Source", "")
    plan(client, w["id"], source["id"])
    track(client, w["id"], "1/2 head of cabbage", meal_id=source["id"])
    make_meal(client, "Cabbage soup", "1/2 head cabbage")
    result = suggestions(client, w)
    assert result["suggestions"] == [] and result["remainders"] == []


def test_equal_coverage_ranks_fewer_groceries_before_name(client):  # TR2 (D4)
    assert buy(client, "rice-0001", "2 cups rice", "pantry").status_code == 200
    assert buy(client, "beans-0001", "2 cups beans", "pantry").status_code == 200
    make_meal(client, "A many groceries", "1 cup rice\n1 cup beans\n1 cup lentils\n1 cup peas")
    make_meal(client, "Z few groceries", "1 cup rice\n1 cup lentils")
    rows = suggestions(client, week(client))["suggestions"]
    assert [row["name"] for row in rows] == ["Z few groceries", "A many groceries"]
    assert [row["coverage_percent"] for row in rows] == [50, 50]
    assert [len(row["groceries"]) for row in rows] == [1, 2]


def test_equal_coverage_and_groceries_ranks_more_projected_uses_first(client):  # TR2 (D4)
    w, slaw, soup = cabbage_setup(client)
    assert buy(client, "rice-0001", "2 cups rice", "pantry").status_code == 200
    make_meal(client, "Aaa rice", "1 cup rice\n1 cup lentils")
    rows = suggestions(client, w)["suggestions"]
    assert [row["name"] for row in rows] == ["Cabbage soup", "Aaa rice"]
    assert [row["coverage_percent"] for row in rows] == [50, 50]
    assert [len(row["groceries"]) for row in rows] == [1, 1]
    assert [use["source"] for use in rows[0]["uses"]] == ["projected"]
    assert [use["source"] for use in rows[1]["uses"]] == ["confirmed"]


def test_limit_keeps_top_ten_by_rank(client):  # TR2 (D4)
    assert buy(client, "rice-0001", "20 cups rice", "pantry").status_code == 200
    for index in range(10):
        make_meal(client, f"Meal {index:02d}", "1 cup rice")
    make_meal(client, "A worse one", "1 cup rice\n1 cup lentils")
    make_meal(client, "A worse two", "1 cup rice\n1 cup lentils")
    rows = suggestions(client, week(client))["suggestions"]
    assert [row["name"] for row in rows] == [f"Meal {index:02d}" for index in range(10)]
    assert all(row["coverage_percent"] == 100 for row in rows)


def test_positive_scaling_leaves_a_quarter_head(client):  # TR3 (AC2)
    w, slaw, soup = cabbage_setup(client, slaw_servings=6)  # 6/4 x 1/2 head = 3/4 head
    result = suggestions(client, w)
    soup_row = by_name(result)["Cabbage soup"]
    cabbage = use_for(soup_row, "cabbage")
    assert (cabbage["used"], cabbage["needed"]) == ("1/4 head", "1/2 head")
    assert cabbage["source"] == "projected"
    grocery = next(g for g in soup_row["groceries"] if g["item"] == "cabbage")
    assert grocery["partial"] is True and grocery["amount"] == "1/4 head"
    remainder = next(r for r in result["remainders"] if r["item"] == "cabbage")
    assert remainder["amount"] == "1/4 head" and remainder["source"] == "projected"


def test_demand_exactly_equal_to_stock_leaves_nothing(client):  # TR3 (AC2, EPSILON)
    assert buy(client, "cab-0001", "1/2 head cabbage", "fridge").status_code == 200
    slaw = make_meal(client, "Slaw", "1/2 head cabbage", 4)
    make_meal(client, "Cabbage soup", "1/2 head cabbage")
    w = week(client)
    plan(client, w["id"], slaw["id"])
    result = suggestions(client, w)
    assert result["suggestions"] == []
    assert not any(r["item"] == "cabbage" for r in result["remainders"])


def test_fractions_summing_to_stock_leave_no_phantom(client):  # TR3 (AC2, EPSILON)
    assert buy(client, "cab-0001", "1/3 head cabbage", "fridge").status_code == 200
    assert buy(client, "cab-0002", "2/3 head cabbage", "fridge").status_code == 200
    third = make_meal(client, "Third", "1/3 head cabbage")
    twothirds = make_meal(client, "Two thirds", "2/3 head cabbage")
    make_meal(client, "Cabbage soup", "1/2 head cabbage")
    w = week(client)
    plan(client, w["id"], third["id"])
    plan(client, w["id"], twothirds["id"])
    result = suggestions(client, w)
    assert result["suggestions"] == []
    assert result["remainders"] == []


def test_two_consumers_across_weeks_keep_order_and_partial_depletion(client):  # TR3 (AC2, D1)
    assert buy(client, "cab-0001", "1 head cabbage", "fridge").status_code == 200
    slaw = make_meal(client, "Slaw", "1/4 head cabbage", 4)
    stir = make_meal(client, "Stir fry", "1/4 head cabbage")
    make_meal(client, "Cabbage soup", "1/2 head cabbage")
    make_meal(client, "Big soup", "1 head cabbage")
    w = week(client)
    nxt = week(client, NEXT_WEEK)
    plan(client, w["id"], slaw["id"])
    assert assign(client, w["id"], slaw["id"], w["days"][2]["id"]).status_code == 200
    plan(client, nxt["id"], stir["id"])
    result = suggestions(client, nxt)
    soup = use_for(by_name(result)["Cabbage soup"], "cabbage")
    assert soup["used"] == "1/2 head" and soup["source"] == "projected"
    assert [(m["name"], m["day"]) for m in soup["after_meals"]] == [("Slaw", "Wednesday"), ("Stir fry", None)]
    big = by_name(result)["Big soup"]
    cabbage = use_for(big, "cabbage")
    assert (cabbage["used"], cabbage["needed"]) == ("1/2 head", "1 head")
    assert [m["name"] for m in cabbage["after_meals"]] == ["Slaw", "Stir fry"]
    assert big["groceries"][0]["partial"] is True and big["groceries"][0]["amount"] == "1/2 head"
    # This week only sees the slaw ahead of it.
    this_week = use_for(by_name(suggestions(client, w))["Cabbage soup"], "cabbage")
    assert [m["name"] for m in this_week["after_meals"]] == ["Slaw"]


def test_different_unit_group_does_not_cover(client):  # TR1 (exact matching)
    assert buy(client, "rice-0001", "2 cups rice", "pantry").status_code == 200
    make_meal(client, "Ounce rice", "8 ounces rice")
    make_meal(client, "Gram rice", "100 grams rice")
    make_meal(client, "Cup rice", "1 cup rice")
    names = [row["name"] for row in suggestions(client, week(client))["suggestions"]]
    assert names == ["Cup rice"]


def test_item_names_match_exactly(client):  # TR1 (exact matching)
    assert buy(client, "cab-0001", "1 head cabbage", "fridge").status_code == 200
    make_meal(client, "Red slaw", "1/2 head red cabbage")
    make_meal(client, "Cabbage soup", "1/2 head cabbage")
    names = [row["name"] for row in suggestions(client, week(client))["suggestions"]]
    assert names == ["Cabbage soup"]
    assert buy(client, "red-0001", "1 head red cabbage", "fridge").status_code == 200
    rows = by_name(suggestions(client, week(client)))
    assert use_for(rows["Red slaw"], "red cabbage")["available"] == "1 head"
    assert use_for(rows["Cabbage soup"], "cabbage")["available"] == "1 head"


def test_fridge_and_pantry_pool_together(client):  # TR3 (AC1)
    assert buy(client, "rice-0001", "1 cup rice", "fridge").status_code == 200
    assert buy(client, "rice-0002", "1 cup rice", "pantry").status_code == 200
    make_meal(client, "Big rice", "1 1/2 cups rice")
    rice = use_for(by_name(suggestions(client, week(client)))["Big rice"], "rice")
    assert rice["locations"] == ["fridge", "pantry"]
    assert rice["available"] == "2 cups" and rice["used"] == "1 1/2 cups"
    assert rice["source"] == "confirmed"


def test_position_is_this_next_later(client):  # TR2
    assert suggestions(client, week(client))["position"] == "this"
    assert suggestions(client, week(client, NEXT_WEEK))["position"] == "next"
    assert suggestions(client, week(client, "2026-01-26"))["position"] == "later"


def test_duplicate_lines_sum_into_one_need(client):  # TR3 (AC1)
    assert buy(client, "rice-0001", "1 cup rice", "pantry").status_code == 200
    make_meal(client, "Double rice", "1/4 cup rice\n1/4 cup rice")
    meal = by_name(suggestions(client, week(client)))["Double rice"]
    assert len(meal["uses"]) == 1 and meal["ingredient_count"] == 1
    assert (meal["uses"][0]["used"], meal["uses"][0]["needed"]) == ("1/2 cup", "1/2 cup")
    assert meal["groceries"] == [] and meal["coverage_percent"] == 100


def test_suggestions_write_nothing(client):  # TR3 (read-only)
    w, slaw, soup = cabbage_setup(client)

    def snapshot():
        return (client.get("/inventory").json(), week(client), client.get("/grocery-entries").json())

    before = snapshot()
    suggestions(client, w)
    suggestions(client, w)
    assert snapshot() == before
