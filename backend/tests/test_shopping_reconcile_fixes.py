"""Corrective tests for issue #5: bounded plan entries, strict restore/undo, and review gaps."""
from test_api_servings import WEEK, NEXT_WEEK, make_meal, week, plan
from test_inventory import buy
from test_shopping_reconcile import (
    reconcile, apply, apply_now, entries, by_item, add_manual, rice_week, rice_row_id,
)

THIRD_WEEK = "2026-01-19"
NAN_BODY = (b'{"removed":[{"entry_key":"manual:12345678","source":"manual","name":"x",'
            b'"quantity_base":NaN,"purchase_id":"abcdefgh12"}]}')
NAN_UPDATE = b'{"updated":[{"entry_key":"manual:manual-00000001","name":"x","quantity_base":NaN}]}'
JSON = {"Content-Type": "application/json"}


def restore_payload(**changes):
    base = {"entry_key": "manual:12345678", "source": "manual", "name": "milk",
            "purchase_id": "restore-0001", "purchased": False}
    return {"removed": [{**base, **changes}]}


def test_long_unmeasured_line_applies_removes_and_undoes(client):  # AC7
    line = "a pinch of " + "very long seasoning " * 15  # over 250 characters, no quantity
    assert len(line) > 250
    w, meal = rice_week(client, line)
    first = apply_now(client, w)
    assert first["summary"] == {"added": 1, "updated": 0, "removed": 0}
    entry = first["entries"][0]
    assert len(entry["name"]) <= 200 and len(entry["entry_key"]) <= 300
    assert reconcile(client, w)["changes"] == {"add": [], "update": [], "remove": []}
    client.delete(f"/week-plans/{w['id']}/meals/{meal['id']}")
    removed = apply(client, w, reconcile(client, w)["fingerprint"])
    assert removed.status_code == 200, removed.text
    assert removed.json()["entries"] == [] and removed.json()["undo"]["removed"]
    restored = client.post("/grocery-entries/undo", json=removed.json()["undo"])
    assert restored.status_code == 200, restored.text
    assert [e["entry_key"] for e in restored.json()] == [entry["entry_key"]]


def test_nan_quantity_is_rejected_and_list_still_loads(client):  # AC1
    add_manual(client, "milk")
    assert client.post("/grocery-entries/undo", content=NAN_BODY, headers=JSON).status_code == 422
    assert client.post("/grocery-entries/undo", content=NAN_UPDATE, headers=JSON).status_code == 422
    assert client.post("/grocery-entries/undo", json=restore_payload(quantity_base=-1)).status_code == 422
    assert client.get("/grocery-entries").status_code == 200


def test_restore_rejects_source_that_does_not_match_key(client):  # AC1
    for body in (restore_payload(source="plan"), restore_payload(source="legacy"),
                 restore_payload(source="added"),
                 restore_payload(entry_key="plan:2:rice:volume", source="plan", week_plan_id=1)):
        assert client.post("/grocery-entries/undo", json=body).status_code == 422
    assert entries(client) == []


def test_restore_and_undo_reject_oversized_or_empty_fields(client):  # AC1
    for field, value in (("item", "x" * 201), ("unit_group", "x" * 51), ("unit", "x" * 51),
                         ("note", "x" * 201), ("name", "x" * 201), ("name", "")):
        response = client.post("/grocery-entries/undo", json=restore_payload(**{field: value}))
        assert response.status_code == 422, field
    entry = add_manual(client, "milk")
    for update in ({"name": ""}, {"name": "x" * 201}, {"note": "x" * 201}):
        body = {"updated": [{"entry_key": entry["entry_key"], "name": "milk", **update}]}
        assert client.post("/grocery-entries/undo", json=body).status_code == 422
    assert entries(client)[0]["name"] == "milk"


def test_restore_and_import_reject_purchase_id_of_another_entry(client):  # AC1
    first = add_manual(client, "milk", "manual-00000001")
    clash = client.post("/grocery-entries/undo", json=restore_payload(
        entry_key="manual:manual-00000002", purchase_id=first["purchase_id"]))
    assert clash.status_code == 409 and isinstance(clash.json()["detail"], str)
    assert [e["id"] for e in entries(client)] == [first["id"]]
    imported = client.post("/grocery-entries/import-local", json={"entries": [
        {"id": 7, "name": "eggs", "purchaseId": first["purchase_id"]}]})
    assert imported.status_code == 200 and [e["id"] for e in imported.json()] == [first["id"]]


def test_import_local_in_chunks_is_idempotent_and_truncates(client):  # AC2
    rows = [{"id": index, "name": f"item {index}"} for index in range(1100)]
    rows[0] = {"id": 0, "name": "n" * 5000, "item": "i" * 5000, "quantity": "1", "unit": "u" * 5000}
    chunks = [rows[start:start + 500] for start in range(0, len(rows), 500)]
    assert len(chunks) == 3
    for chunk in chunks:
        assert client.post("/grocery-entries/import-local", json={"entries": chunk}).status_code == 200
    assert len(entries(client)) == 1100
    for chunk in chunks:
        client.post("/grocery-entries/import-local", json={"entries": chunk})
    stored = entries(client)
    assert len(stored) == 1100
    assert len(stored[0]["name"]) <= 200 and len(stored[0]["item"] or "") <= 200
    assert client.post("/grocery-entries/import-local", json={"entries": rows[:501]}).status_code == 422


def test_three_week_chain_allocates_stock_once(client):  # AC3
    buy(client, "purchase-0001", "3 cups rice")
    weeks = []
    for ref in (WEEK, NEXT_WEEK, THIRD_WEEK):
        meal = make_meal(client, f"Rice {ref}", "2 cups rice")
        w = week(client, ref)
        plan(client, w["id"], meal["id"])
        weeks.append(w)
    rows = [by_item(reconcile(client, w))["rice"] for w in weeks]
    assert [r["available"] for r in rows] == ["3 cups", "1 cup", "0"]
    assert [r["to_buy"] for r in rows] == ["0", "1 cup", "2 cups"]
    assert reconcile(client, weeks[2])["position"] == "later"


def test_minimum_and_shortfall_warn_together(client):  # AC5
    buy(client, "purchase-0001", "1 cup rice")
    client.put(f"/inventory/{rice_row_id(client)}/minimum", json={"minimum": "2"})
    w, _ = rice_week(client, "3 cups rice")
    row = by_item(reconcile(client, w))["rice"]
    assert [x["type"] for x in row["warnings"]] == ["below_minimum", "short"]


def test_purchased_and_other_week_entries_do_not_cover(client):  # AC6
    w, _ = rice_week(client, "2 cups rice")
    added = client.post("/grocery-entries", json={
        "entry_key": "added:11111111", "name": "2 cups of rice", "week_plan_id": w["id"]}).json()
    assert client.patch(f"/grocery-entries/{added['id']}", json={"purchased": True}).status_code == 200
    assert by_item(reconcile(client, w))["rice"]["covered"] is False
    meal = make_meal(client, "Pilaf", "2 cups rice")
    next_week = week(client, NEXT_WEEK)
    plan(client, next_week["id"], meal["id"])
    apply_now(client, next_week)
    assert by_item(reconcile(client, w))["rice"]["covered"] is False
    assert by_item(reconcile(client, next_week))["rice"]["covered"] is True


def test_undo_reverts_a_servings_update(client):  # AC7
    w, meal = rice_week(client, "1 cup rice", yield_servings=2, servings=2)
    apply_now(client, w)
    original = entries(client)[0]
    client.patch(f"/week-plans/{w['id']}/meals/{meal['id']}", json={"servings": 6})
    result = apply_now(client, w)
    assert result["summary"] == {"added": 0, "updated": 1, "removed": 0}
    assert entries(client)[0]["quantity"] == "3" and result["undo"]["updated"]
    restored = client.post("/grocery-entries/undo", json=result["undo"]).json()
    assert restored[0]["quantity"] == original["quantity"] == "1"
    assert restored[0]["quantity_base"] == original["quantity_base"]
    assert restored[0]["name"] == original["name"]


def test_nested_nan_in_undo_body_is_422_not_500(client):  # AC7
    response = client.post("/grocery-entries/undo", content=b'{"removed":[{"quantity_base":NaN}]}', headers=JSON)
    assert response.status_code == 422, response.text
    assert response.json()["detail"]


def test_apply_with_more_lines_than_undo_cap_still_succeeds(client):  # AC2
    lines = "\n".join(f"pinch of spice number {n}" for n in range(501))
    w, _ = rice_week(client, lines)
    preview = reconcile(client, w)
    assert len(preview["changes"]["add"]) == 501
    response = apply(client, w, preview["fingerprint"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["summary"]["added"] == 501 and body["undo"] is None
    assert len(entries(client)) == 501
