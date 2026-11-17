"""Partial update of name/notes/tags/ingredients via PATCH /meals/{id} (issue #22, AC7)."""
import pytest


def make(client, **extra):
    body = {"name": "Chili", "notes": "n", "tags": "spicy", "ingredients": "beans\nrice",
            "yield_servings": 4, "prep_minutes": 10, "cook_minutes": 30, "make_ahead": True}
    body.update(extra)
    return client.post("/meals", json=body).json()


# AC7
def test_patch_changes_only_fields_present(client):
    meal = make(client)
    res = client.patch(f"/meals/{meal['id']}", json={"notes": "new notes"})
    assert res.status_code == 200
    assert res.json() == {**meal, "notes": "new notes"}


# AC7
def test_patch_updates_text_fields_and_persists(client):
    meal = make(client)
    res = client.patch(f"/meals/{meal['id']}", json={
        "name": "  Veg chili ", "notes": "", "tags": "veg, quick", "ingredients": "beans\ncorn"})
    assert res.status_code == 200
    body = res.json()
    assert (body["name"], body["notes"], body["tags"], body["ingredients"]) == ("Veg chili", "", "veg, quick", "beans\ncorn")
    listed = next(m for m in client.get("/meals").json() if m["id"] == meal["id"])
    assert listed == body
    assert listed["yield_servings"] == 4 and listed["prep_minutes"] == 10


# AC7
@pytest.mark.parametrize("field", ["notes", "tags", "ingredients"])
def test_optional_text_fields_can_be_cleared_with_null(client, field):
    meal = make(client)
    res = client.patch(f"/meals/{meal['id']}", json={field: None})
    assert res.status_code == 200 and res.json()[field] is None


# AC7
@pytest.mark.parametrize("value", [None, "", "   ", 5])
def test_invalid_name_rejected_and_unchanged(client, value):
    meal = make(client)
    assert client.patch(f"/meals/{meal['id']}", json={"name": value}).status_code == 422
    assert client.get("/meals").json()[0]["name"] == "Chili"


# AC7
def test_times_and_make_ahead_can_be_patched_together_with_text(client):
    meal = make(client)
    res = client.patch(f"/meals/{meal['id']}", json={
        "name": "Soup", "prep_minutes": None, "cook_minutes": 0, "make_ahead": False, "yield_servings": None})
    body = res.json()
    assert (body["name"], body["prep_minutes"], body["cook_minutes"], body["make_ahead"], body["yield_servings"]) == (
        "Soup", None, 0, False, None)
    assert client.patch(f"/meals/{meal['id']}", json={"prep_minutes": 1441}).status_code == 422
    assert client.patch(f"/meals/{meal['id']}", json={"make_ahead": None}).status_code == 422


# AC7
def test_yield_only_patch_still_works_and_empty_body_is_noop(client):
    meal = make(client)
    assert client.patch(f"/meals/{meal['id']}", json={"yield_servings": None}).json()["yield_servings"] is None
    assert client.patch(f"/meals/{meal['id']}", json={}).json()["name"] == "Chili"


# AC7
def test_patch_unknown_meal_is_404(client):
    assert client.patch("/meals/9999", json={"name": "x"}).status_code == 404
