"""Restock lines for staples at or below their minimum in reconcile (issue #14, AC1-AC6)."""
from test_api_servings import WEEK, NEXT_WEEK, make_meal, week, plan
from test_inventory import buy, stock
from test_shopping_reconcile import reconcile, apply, apply_now, entries, add_manual, rice_row_id


def staple(client, have="1 cup rice", minimum="3", pid="purchase-0001"):
    buy(client, pid, have)
    client.put(f"/inventory/{rice_row_id(client)}/minimum", json={"minimum": minimum})


def restock_adds(result):
    return [c for c in result["changes"]["add"] if c["kind"] == "restock"]


def plan_adds(result):
    return [c for c in result["changes"]["add"] if c["kind"] == "plan"]


def restock_entries(client):
    return [e for e in entries(client) if e["kind"] == "restock"]


def rice_demand_week(client, need, ref=WEEK):
    meal = make_meal(client, f"Rice {need}", f"{need} rice")
    w = week(client, ref)
    plan(client, w["id"], meal["id"])
    return w


def test_staple_at_minimum_gets_restock_add_up_to_minimum(client):  # AC1
    staple(client)  # 1 cup on hand, minimum 3
    w = week(client)
    adds = restock_adds(reconcile(client, w))
    assert len(adds) == 1
    assert adds[0]["quantity"] == "2 cups" and adds[0]["name"] == "2 cups of rice"
    assert adds[0]["entry_key"].startswith(f"plan:{w['id']}:+restock:rice:")


def test_restock_is_in_addition_to_plan_line_for_demand(client):  # AC1, constraint i
    staple(client)
    w = rice_demand_week(client, "2 cups")  # pool 1: plan buys 1; nothing remains; restock = 3
    result = reconcile(client, w)
    assert [c["quantity"] for c in plan_adds(result)] == ["1 cup"]
    assert [c["quantity"] for c in restock_adds(result)] == ["3 cups"]
    # Demand fully covered by stock: only the top-up of what remains is restocked.
    client.put(f"/inventory/{rice_row_id(client)}", json={"quantity": "3"})
    client.put(f"/inventory/{rice_row_id(client)}/minimum", json={"minimum": "3"})
    result = reconcile(client, w)
    assert plan_adds(result) == [] and [c["quantity"] for c in restock_adds(result)] == ["2 cups"]


def test_apply_twice_is_idempotent_with_stable_key(client):  # AC2
    staple(client)
    w = week(client)
    first = apply_now(client, w)
    key = restock_entries(client)[0]["entry_key"]
    assert first["summary"]["added"] == 1
    preview = reconcile(client, w)
    assert preview["changes"] == {"add": [], "update": [], "remove": []}
    fingerprint = preview["fingerprint"]
    again = apply_now(client, w)
    assert again["summary"] == {"added": 0, "updated": 0, "removed": 0} and again["undo"] is None
    assert [e["entry_key"] for e in restock_entries(client)] == [key]
    assert reconcile(client, w)["fingerprint"] == fingerprint


def test_manual_entry_suppresses_restock_and_is_untouched(client):  # AC3
    staple(client)
    manual = add_manual(client, "2 cups rice")
    w = week(client)
    assert restock_adds(reconcile(client, w)) == []
    apply_now(client, w)
    assert [e["name"] for e in entries(client)] == ["2 cups rice"] and entries(client)[0]["id"] == manual["id"]
    # A manual entry added after the restock was applied replaces it, without touching the manual one.
    client.delete(f"/grocery-entries/{manual['id']}")
    w = week(client)
    apply_now(client, w)
    assert len(restock_entries(client)) == 1
    add_manual(client, "2 cups rice", "manual-00000002")
    preview = reconcile(client, w)
    assert [c["kind"] for c in preview["changes"]["remove"]] == ["restock"]
    assert preview["changes"]["add"] == [] and preview["changes"]["update"] == []
    apply_now(client, w)
    assert [e["source"] for e in entries(client)] == ["manual"]


def test_purchased_restock_is_never_changed_or_removed_or_readded(client):  # AC3, AC6
    staple(client)
    w = week(client)
    apply_now(client, w)
    entry = restock_entries(client)[0]
    paid = client.patch(f"/grocery-entries/{entry['id']}", json={"purchased": True})
    assert paid.status_code == 200
    changes = reconcile(client, w)["changes"]
    assert changes == {"add": [], "update": [], "remove": []}  # counts as satisfying the restock
    client.put(f"/inventory/{rice_row_id(client)}/minimum", json={"minimum": "6"})  # amount would change
    assert reconcile(client, w)["changes"] == {"add": [], "update": [], "remove": []}
    client.put(f"/inventory/{rice_row_id(client)}/minimum", json={"minimum": "0"})  # would be removed
    assert reconcile(client, w)["changes"] == {"add": [], "update": [], "remove": []}
    kept = restock_entries(client)
    assert len(kept) == 1 and kept[0]["purchased"] is True and kept[0]["name"] == entry["name"]


def test_restock_is_marked_and_does_not_hide_demand(client):  # AC4, constraint b
    staple(client)
    w = rice_demand_week(client, "2 cups")
    result = reconcile(client, w)
    assert all(c["kind"] in ("plan", "restock") for c in result["changes"]["add"])
    assert {c["kind"] for c in result["changes"]["add"]} == {"plan", "restock"}
    apply_now(client, w)
    kinds = {e["entry_key"]: e["kind"] for e in entries(client)}
    assert sorted(kinds.values()) == ["plan", "restock"]
    ingredient = reconcile(client, w)["ingredients"][0]
    # The covering entry shown for the demand is the plan line, never the restock line.
    assert ingredient["covered"] is True and ingredient["entry"]["name"] == "1 cup of rice"
    # Without the plan line, the restock entry alone must not claim to cover the demand shortfall.
    plan_entry = next(e for e in entries(client) if e["kind"] == "plan")
    client.delete(f"/grocery-entries/{plan_entry['id']}")
    ingredient = reconcile(client, w)["ingredients"][0]
    assert ingredient["covered"] is False and ingredient["entry"] is None
    assert [c["kind"] for c in reconcile(client, w)["changes"]["add"]] == ["plan"]
    # And it does not block adding the ingredient by hand.
    added = client.post("/grocery-entries", json={"entry_key": "added:00000001", "name": "rice",
                                                  "week_plan_id": w["id"]})
    assert added.status_code == 200


def test_restock_not_counted_twice_across_weeks(client):  # AC5
    staple(client)  # 1 cup, minimum 3
    w1, w2 = week(client, WEEK), week(client, NEXT_WEEK)
    # Next week alone (this week not applied yet) sees this week's computed restock as already bought.
    assert restock_adds(reconcile(client, w2)) == []
    assert [c["quantity"] for c in restock_adds(reconcile(client, w1))] == ["2 cups"]
    apply_now(client, w1)
    assert restock_adds(reconcile(client, w2)) == []
    assert len(restock_entries(client)) == 1


def test_restock_amounts_follow_sequential_allocation_with_demand(client):  # AC5
    staple(client)  # 1 cup, minimum 3
    w1, w2 = week(client, WEEK), week(client, NEXT_WEEK)
    meal = make_meal(client, "Rice 2", "2 cups rice")
    plan(client, w2["id"], meal["id"])
    # Week 1: no demand, restock 2 (stock 3). Week 2: demand 2 from 3 -> 1 remains -> restock 2.
    result = reconcile(client, w2)
    assert plan_adds(result) == [] and [c["quantity"] for c in restock_adds(result)] == ["2 cups"]
    # Independent of apply order.
    apply_now(client, w2)
    apply_now(client, w1)
    assert sorted(e["quantity"] for e in restock_entries(client)) == ["2", "2"]
    assert reconcile(client, w1)["changes"] == {"add": [], "update": [], "remove": []}
    assert reconcile(client, w2)["changes"] == {"add": [], "update": [], "remove": []}
    # Total bought over both weeks, from the applied entries = demand 2 + minimum 3 - available 1 = 4.
    bought = sum(float(e["quantity"]) for e in entries(client) if e["source"] == "plan")
    assert bought == 2 + 3 - 1


def test_restock_removed_when_staple_back_above_minimum(client):  # AC6
    staple(client)
    w = week(client)
    apply_now(client, w)
    buy(client, "purchase-0002", "3 cups rice")  # 4 cups > minimum 3
    preview = reconcile(client, w)
    assert [c["kind"] for c in preview["changes"]["remove"]] == ["restock"]
    result = apply_now(client, w)
    assert result["summary"]["removed"] == 1 and restock_entries(client) == []


def test_restock_updated_when_shortfall_changes(client):  # AC6
    staple(client)
    w = week(client)
    apply_now(client, w)
    client.put(f"/inventory/{rice_row_id(client)}/minimum", json={"minimum": "4"})
    changes = reconcile(client, w)["changes"]
    assert [(c["kind"], c["from_quantity"], c["to_quantity"]) for c in changes["update"]] == [
        ("restock", "2 cups", "3 cups")]
    apply_now(client, w)
    assert restock_entries(client)[0]["quantity"] == "3"


def test_no_restock_for_zero_shortfall_or_zero_minimum(client):  # AC6, constraint h
    staple(client, have="2 cups rice", minimum="2")  # exactly at the minimum: shortfall 0
    w = week(client)
    assert restock_adds(reconcile(client, w)) == []
    row_id = rice_row_id(client)
    client.put(f"/inventory/{row_id}", json={"quantity": "0"})
    client.put(f"/inventory/{row_id}/minimum", json={"minimum": "0"})  # out of stock, minimum 0
    result = reconcile(client, w)
    assert result["changes"] == {"add": [], "update": [], "remove": []}
    assert [s["warnings"][0]["type"] for s in result["staples"]] == ["below_minimum"]
    client.put(f"/inventory/{row_id}/minimum", json={"minimum": "2"})
    assert [c["quantity"] for c in restock_adds(reconcile(client, w))] == ["2 cups"]


def test_undo_of_restock_changes(client):  # AC6, constraint f
    staple(client)
    w = week(client)
    added = apply_now(client, w)
    undone = client.post("/grocery-entries/undo", json=added["undo"])
    assert undone.status_code == 200 and restock_entries(client) == []
    apply_now(client, w)
    before = restock_entries(client)[0]
    client.put(f"/inventory/{rice_row_id(client)}/minimum", json={"minimum": "4"})
    updated = apply_now(client, w)
    assert updated["summary"]["updated"] == 1
    assert client.post("/grocery-entries/undo", json=updated["undo"]).status_code == 200
    assert restock_entries(client)[0]["quantity"] == before["quantity"]
    buy(client, "purchase-0002", "5 cups rice")
    removed = apply_now(client, w)
    assert removed["summary"]["removed"] == 1 and removed["undo"]["removed"][0]["entry_key"] == before["entry_key"]
    restored = client.post("/grocery-entries/undo", json=removed["undo"])
    assert restored.status_code == 200
    assert [(e["entry_key"], e["kind"]) for e in restock_entries(client)] == [(before["entry_key"], "restock")]


def test_restock_rounds_up_to_whole_packages(client):  # constraint g
    staple(client, have="1 cup rice", minimum="3")
    client.put("/package-sizes", json={"item": "rice", "unit_group": "volume", "size": "2 cups", "label": "bag"})
    adds = restock_adds(reconcile(client, week(client)))
    assert len(adds) == 1 and adds[0]["quantity"] == "2 cups" and adds[0]["name"].endswith("(1 bag)")
    client.put(f"/inventory/{rice_row_id(client)}/minimum", json={"minimum": "4"})
    adds = restock_adds(reconcile(client, week(client)))
    assert adds[0]["quantity"] == "4 cups" and adds[0]["name"].endswith("(2 bags)")


def test_added_entry_suppresses_restock_and_is_untouched(client):  # AC3
    staple(client)
    added = client.post("/grocery-entries", json={"entry_key": "added:00000002", "name": "2 cups rice"})
    assert added.status_code == 200
    w = week(client)
    assert reconcile(client, w)["changes"] == {"add": [], "update": [], "remove": []}
    apply_now(client, w)
    assert [(e["source"], e["name"], e["kind"]) for e in entries(client)] == [("added", "2 cups rice", None)]


def test_purchased_manual_entry_does_not_suppress_restock(client):  # AC3
    staple(client)
    manual = add_manual(client, "2 cups rice")
    assert client.patch(f"/grocery-entries/{manual['id']}", json={"purchased": True}).status_code == 200
    w = week(client)
    assert [c["quantity"] for c in restock_adds(reconcile(client, w))] == ["2 cups"]
    apply_now(client, w)
    kept = next(e for e in entries(client) if e["source"] == "manual")
    assert kept["purchased"] is True and kept["name"] == "2 cups rice"


def test_manual_entry_of_other_unit_group_does_not_suppress_restock(client):  # AC3
    staple(client)
    other = add_manual(client, "2 lb rice")
    assert other["unit_group"] != "volume"
    assert len(restock_adds(reconcile(client, week(client)))) == 1


def test_purchased_plan_line_untouched_while_restock_is_diffed(client):  # AC3, AC6
    staple(client)  # 1 cup, minimum 3
    w = rice_demand_week(client, "2 cups")  # plan line 1 cup, restock 3 cups
    apply_now(client, w)
    plan_entry = next(e for e in entries(client) if e["kind"] == "plan")
    assert client.patch(f"/grocery-entries/{plan_entry['id']}", json={"purchased": True}).status_code == 200
    client.put(f"/inventory/{rice_row_id(client)}/minimum", json={"minimum": "4"})
    more = make_meal(client, "More rice", "1 cup rice")
    plan(client, w["id"], more["id"])  # demand 3 cups: the plan line would now be 2 cups
    changes = reconcile(client, w)["changes"]
    assert changes["add"] == [] and changes["remove"] == []
    assert [(c["kind"], c["from_quantity"], c["to_quantity"]) for c in changes["update"]] == [
        ("restock", "3 cups", "4 cups")]
    apply_now(client, w)
    after = {e["kind"]: e for e in entries(client)}
    assert after["plan"]["purchased"] is True and after["plan"]["name"] == plan_entry["name"]
    assert after["plan"]["quantity"] == plan_entry["quantity"]
    assert after["restock"]["quantity"] == "4"


def test_kind_on_update_remove_and_manual_entry(client):  # AC4
    staple(client)
    w = week(client)
    manual = add_manual(client, "paper towels")
    assert manual["kind"] is None
    apply_now(client, w)
    client.put(f"/inventory/{rice_row_id(client)}/minimum", json={"minimum": "4"})
    update = reconcile(client, w)["changes"]["update"]
    assert [c["kind"] for c in update] == ["restock"]
    apply_now(client, w)
    buy(client, "purchase-0002", "5 cups rice")
    remove = reconcile(client, w)["changes"]["remove"]
    assert [c["kind"] for c in remove] == ["restock"]
    apply_now(client, w)
    assert [(e["source"], e["kind"]) for e in entries(client)] == [("manual", None)]


def test_purchased_earlier_week_restock_still_counts_for_later_week(client):  # AC5, AC3
    staple(client)  # 1 cup, minimum 3
    w1, w2 = week(client, WEEK), week(client, NEXT_WEEK)
    apply_now(client, w1)
    entry = restock_entries(client)[0]
    assert client.patch(f"/grocery-entries/{entry['id']}", json={"purchased": True}).status_code == 200
    # Intended: a purchased (even uncredited) earlier restock is treated as bought, so week 2 adds none,
    # and week 1 neither changes nor re-adds its purchased line.
    assert restock_adds(reconcile(client, w2)) == []
    assert reconcile(client, w1)["changes"] == {"add": [], "update": [], "remove": []}
    assert reconcile(client, w2)["changes"] == {"add": [], "update": [], "remove": []}


def test_staple_drained_below_minimum_only_by_demand_gets_no_restock(client):  # AC1, trigger rule
    staple(client, have="5 cups rice", minimum="3")  # above the minimum today
    w = rice_demand_week(client, "4 cups")  # leaves 1 cup, below the minimum after the week
    result = reconcile(client, w)
    assert result["changes"] == {"add": [], "update": [], "remove": []}
    assert restock_adds(result) == []
