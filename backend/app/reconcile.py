"""Per-week reconcile of demand, stock and the grocery checklist.

Read-only computation (compute) plus a guarded apply. Stock is allocated sequentially by week:
earlier weeks (from the current week up to the selected one) take what they need from the shared
pool first, so the same stock never covers two weeks. The answer for a week does not depend on
which week was queried first.

Inventory is the only on-hand source here: PairingIngredient leftovers are not subtracted.
Skipped and cooked meals are not demand; planned meals on past days of the current week still are.
"""
import hashlib
import json
import math
from collections import defaultdict
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import grocery, inventory, models, pairings

EPSILON = pairings.EPSILON


def amount_text(ingredient, base):
    """"2 cups", "1 1/2 tablespoons" or "3" for countable items; "0" when empty."""
    if base <= EPSILON:
        return "0"
    quantity = ingredient.display_quantity(base)
    if ingredient.unit == "piece":
        return quantity
    unit = ingredient.unit
    if base / ingredient.factor > 1 + EPSILON:
        unit += "es" if unit == "bunch" else "s"
    return f"{quantity} {unit}"


def display_unit(ingredient):
    return "" if ingredient.unit == "piece" else ingredient.unit


def key_text(key):
    return f"{key[0]}|{key[1]}"


MAX_NAME = 200  # GroceryEntryRestore.name; plan entries must always be restorable
MAX_KEY_PART = 200


def _digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:40]


def bounded_name(text):
    return text[:MAX_NAME]


def plan_key(week_plan_id, key):
    return f"plan:{week_plan_id}:{key[0]}:{key[1]}"


def line_key(week_plan_id, line):
    normalized = " ".join(line.lower().split())
    if len(normalized) > MAX_KEY_PART:
        normalized = f"sha256-{_digest(normalized)}"
    return f"plan:{week_plan_id}:line:{normalized}"


def _planned_meals(db: Session, week_plan_id):
    return (
        db.query(models.WeekMeal)
        .filter(models.WeekMeal.week_plan_id == week_plan_id)
        .filter(or_(models.WeekMeal.status.is_(None), models.WeekMeal.status == "planned"))
        .order_by(models.WeekMeal.id)
        .all()
    )


def _week_demand(db: Session, week, detailed):
    """Scaled demand per key for the planned meals of a week (plus attribution when detailed)."""
    totals = defaultdict(float)
    first = {}
    meals = defaultdict(list)
    unmeasured = {}
    no_yield = []
    rows = _planned_meals(db, week.id)
    days = {}
    for row in rows:
        if row.day_id is not None and row.day_id not in days:
            days[row.day_id] = db.get(models.Day, row.day_id)
    ordered = sorted(rows, key=lambda row: (
        days[row.day_id].date if row.day_id in days and days[row.day_id] else date.max, row.id
    ))
    for row in ordered:
        meal = row.meal
        line_totals, lines_first, lines, factor = pairings.meal_lines(meal, row.servings)
        day = days.get(row.day_id)
        info = {"meal_id": meal.id, "name": meal.name, "day": day.day_name if day else None,
                "servings": row.servings}
        for key, amount in line_totals.items():
            totals[key] += amount
            first.setdefault(key, lines_first[key])
            if detailed and amount > EPSILON:
                meals[key].append({**info, "amount": amount_text(lines_first[key], amount)})
        if detailed:
            if meal.yield_servings is None and meal.name not in no_yield:
                no_yield.append(meal.name)
            note = f"not scaled (recipe x{factor:.3g})" if abs(factor - 1) > EPSILON else ""
            for line in lines:
                slot = unmeasured.setdefault(" ".join(line.lower().split()), {
                    "line": line, "note": note or None, "meals": []})
                if all(existing["meal_id"] != meal.id for existing in slot["meals"]):
                    slot["meals"].append({**info, "amount": ""})
    return totals, first, meals, unmeasured, no_yield, len(rows)


def _entry_ref(entry):
    if not entry:
        return None
    return {"id": entry.id, "name": entry.name, "source": entry.source, "purchased": entry.purchased}


def compute(db: Session, week, ref_date=None):
    """Return (result, operations). Nothing is written."""
    today = ref_date or date.today()
    current_start = today - timedelta(days=today.weekday())
    if week.start_date < current_start:
        raise HTTPException(400, "Choose this week or a later week.")
    offset = (week.start_date - current_start).days
    position = "this" if offset == 0 else "next" if offset == 7 else "later"

    # Stock pool: fridge and pantry rows of one ingredient are one pool.
    stock = defaultdict(float)
    minimums = {}
    stock_ingredient = {}
    inventory_rows = defaultdict(list)
    for row in db.query(models.InventoryItem).order_by(models.InventoryItem.id).all():
        key = (row.item, row.unit_group)
        stock[key] += max(row.base_quantity, 0.0)
        stock_ingredient.setdefault(key, pairings.Ingredient(0, row.unit, row.item))
        inventory_rows[key].append(row)
        if row.minimum is not None:
            minimums[key] = max(minimums.get(key, 0.0), row.minimum)

    def inventory_id(key):
        rows = inventory_rows.get(key)
        if not rows:
            return None
        with_minimum = [row for row in rows if row.minimum is not None]
        return (with_minimum or sorted(rows, key=lambda row: (-row.base_quantity, row.id)))[0].id

    # Sequential allocation over the weeks from the current one up to (not including) the selected one.
    earlier = (
        db.query(models.WeekPlan)
        .filter(models.WeekPlan.start_date >= current_start, models.WeekPlan.start_date < week.start_date)
        .order_by(models.WeekPlan.start_date)
        .all()
    )
    pool = dict(stock)
    for earlier_week in earlier:
        demand, _, _, _, _, _ = _week_demand(db, earlier_week, False)
        for key, amount in demand.items():
            taken = min(pool.get(key, 0.0), amount)
            if taken > 0:
                pool[key] = pool.get(key, 0.0) - taken

    totals, first, meals, unmeasured, no_yield, meal_count = _week_demand(db, week, True)
    entries = grocery.list_entries(db)
    sizes = inventory.package_sizes_by_key(db)

    def covering(key):
        return next((entry for entry in entries
                     if (entry.item, entry.unit_group) == key and grocery.covers(entry, week.id)), None)

    def warnings_for(key, ingredient, demand=0.0, available=None):
        found = []
        if key in minimums and stock.get(key, 0.0) <= minimums[key] + EPSILON:
            found.append({"type": "below_minimum", "message": (
                f"At or below your minimum: {amount_text(ingredient, stock.get(key, 0.0))} on hand, "
                f"minimum {amount_text(ingredient, minimums[key]) if minimums[key] > EPSILON else '0'}.")})
        if available is not None and demand > available + EPSILON:
            found.append({"type": "short", "message": (
                f"Short by {amount_text(ingredient, demand - available)} for this week.")})
        return found

    ingredients = []
    desired = {}
    non_plan_cover = {
        (entry.item, entry.unit_group) for entry in entries
        if not entry.purchased and entry.source != "plan" and entry.item and entry.unit_group
    }
    for key in sorted(totals, key=lambda k: (k[0].lower(), k[1])):
        demand = totals[key]
        if demand <= EPSILON:
            continue
        ingredient = first[key]
        available = pool.get(key, 0.0)
        to_buy = max(demand - available, 0.0)
        to_buy = 0.0 if to_buy <= EPSILON else to_buy
        entry = covering(key)
        eligible = key[1] in inventory.PACKAGE_GROUPS
        size_row = sizes.get(key) if eligible else None
        package = None
        buy_base = to_buy
        add_name = ingredient.describe(to_buy) if to_buy else ""
        if size_row:
            size_base = size_row.base_quantity
            packages = math.ceil(to_buy / size_base - EPSILON) if to_buy > 0 else 0
            buy_base = packages * size_base
            remainder = buy_base - to_buy
            remainder = 0.0 if remainder <= EPSILON else remainder
            label = size_row.label or inventory.PACKAGE_LABEL_DEFAULT
            if packages:
                plural = "" if packages == 1 else "es" if label.endswith(("s", "x", "ch", "sh")) else "s"
                add_name = f"{ingredient.describe(buy_base)} ({packages} {label}{plural})"
            package = {"size": inventory.package_size_text(size_row), "label": label, "packages": packages,
                       "buy": amount_text(ingredient, buy_base), "remainder": amount_text(ingredient, remainder)}
        ingredients.append({
            "key": key_text(key),
            "item": ingredient.item,
            "unit": display_unit(ingredient),
            "unit_group": key[1],
            "package_eligible": eligible,
            "package": package,
            "demand": amount_text(ingredient, demand),
            "on_hand": amount_text(ingredient, stock.get(key, 0.0)),
            "held_for_earlier_weeks": amount_text(ingredient, stock.get(key, 0.0) - available)
            if stock.get(key, 0.0) - available > EPSILON else "",
            "available": amount_text(ingredient, available),
            "to_buy": amount_text(ingredient, to_buy),
            "add_name": add_name,
            "minimum": amount_text(ingredient, minimums[key]) if key in minimums else None,
            "inventory_id": inventory_id(key),
            "warnings": warnings_for(key, ingredient, demand, available),
            "meals": meals[key],
            "covered": entry is not None,
            "covered_by_stock": to_buy == 0.0,
            "entry": _entry_ref(entry),
        })
        if to_buy > 0 and key not in non_plan_cover:
            if len(ingredient.item) > MAX_NAME:
                # An absurdly long item name cannot be a bounded, matchable entry: keep it as a
                # plain text line under a hashed key.
                text_key = line_key(week.id, add_name)
                desired[text_key] = {"entry_key": text_key, "name": bounded_name(add_name), "item": None,
                                     "unit_group": None, "unit": None, "quantity_base": None,
                                     "note": None, "ingredient": None}
            else:
                desired[plan_key(week.id, key)] = {
                    "entry_key": plan_key(week.id, key), "name": bounded_name(add_name),
                    "item": ingredient.item, "unit_group": key[1], "unit": ingredient.unit,
                    "quantity_base": buy_base, "note": None, "ingredient": ingredient,
                }

    unmeasured_out = []
    for slot in unmeasured.values():
        unmeasured_out.append(slot)
        key = line_key(week.id, slot["line"])
        desired[key] = {"entry_key": key, "name": bounded_name(slot["line"]), "item": None, "unit_group": None,
                        "unit": None, "quantity_base": None, "note": slot["note"], "ingredient": None}
    unmeasured_out.sort(key=lambda slot: slot["line"].lower())

    demand_keys = {key for key in totals if totals[key] > EPSILON}
    staples = []
    for key in sorted(minimums, key=lambda k: (k[0].lower(), k[1])):
        if key in demand_keys:
            continue
        ingredient = stock_ingredient[key]
        entry = covering(key)
        staples.append({
            "key": key_text(key),
            "item": ingredient.item,
            "unit": display_unit(ingredient),
            "on_hand": amount_text(ingredient, stock.get(key, 0.0)),
            "minimum": amount_text(ingredient, minimums[key]),
            "inventory_id": inventory_id(key),
            "warnings": warnings_for(key, ingredient),
            "covered": entry is not None,
            "entry": _entry_ref(entry),
        })

    # Diff against this week's own plan entries. Purchased plan entries are never changed or
    # removed, and count as satisfying their key so they are not added again.
    plan_entries = {e.entry_key: e for e in entries if e.source == "plan" and e.week_plan_id == week.id}
    adds, updates, removes = [], [], []
    for entry_key, wanted in desired.items():
        if entry_key not in plan_entries:
            adds.append(wanted)
    for entry_key, entry in plan_entries.items():
        if entry.purchased:
            continue
        wanted = desired.get(entry_key)
        if wanted is None:
            removes.append(entry)
        elif wanted["quantity_base"] is not None and (
                entry.quantity_base is None or abs(entry.quantity_base - wanted["quantity_base"]) > EPSILON
                or entry.name != wanted["name"]):
            updates.append((entry, wanted))

    changes = {
        "add": [{"entry_key": w["entry_key"], "name": w["name"],
                 "quantity": amount_text(w["ingredient"], w["quantity_base"]) if w["ingredient"] else "",
                 "note": w["note"]} for w in adds],
        "update": [{
            "entry_id": entry.id, "entry_key": entry.entry_key, "name": wanted["name"],
            "item": wanted["item"],
            "from_quantity": amount_text(wanted["ingredient"], entry.quantity_base or 0.0),
            "to_quantity": amount_text(wanted["ingredient"], wanted["quantity_base"]),
        } for entry, wanted in updates],
        "remove": [{"entry_id": entry.id, "entry_key": entry.entry_key, "name": entry.name}
                   for entry in removes],
    }
    fingerprint = hashlib.sha256(
        json.dumps(changes, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    result = {
        "week_plan_id": week.id, "start_date": week.start_date, "end_date": week.end_date,
        "ref_date": today, "position": position, "meal_count": meal_count, "no_yield": no_yield,
        "ingredients": ingredients, "unmeasured": unmeasured_out, "staples": staples,
        "changes": changes, "fingerprint": fingerprint,
    }
    return result, {"adds": adds, "updates": updates, "removes": removes}


def apply(db: Session, week, fingerprint, ref_date=None):
    """Apply the previewed changes in one transaction, only if they are still the current changes."""
    for attempt in range(2):
        result, ops = compute(db, week, ref_date)
        if fingerprint != result["fingerprint"]:
            raise HTTPException(409, "The plan or stock changed; review the changes again.")
        undo = None
        if ops["adds"] or ops["updates"] or ops["removes"]:
            undo = {
                "added_keys": [w["entry_key"] for w in ops["adds"]],
                "updated": [{"entry_key": entry.entry_key, "name": entry.name,
                             "quantity_base": entry.quantity_base, "note": entry.note}
                            for entry, _ in ops["updates"]],
                "removed": [grocery.restorable(entry) for entry in ops["removes"]],
            }
            # The response model caps each undo list; a valid apply must never fail after commit.
            if any(len(undo[name]) > grocery.UNDO_LIMIT for name in undo):
                undo = None
        try:
            for wanted in ops["adds"]:
                db.add(models.GroceryEntry(
                    entry_key=wanted["entry_key"], source="plan", week_plan_id=week.id,
                    name=wanted["name"], item=wanted["item"], unit_group=wanted["unit_group"],
                    unit=wanted["unit"], quantity_base=wanted["quantity_base"], note=wanted["note"],
                    purchased=False, purchase_id=grocery.new_purchase_id(),
                ))
            for entry, wanted in ops["updates"]:
                entry.name = wanted["name"]
                entry.quantity_base = wanted["quantity_base"]
            for entry in ops["removes"]:
                db.delete(entry)
            db.commit()
        except IntegrityError:
            # A concurrent apply created the same keys: recompute (the fingerprint check decides).
            db.rollback()
            if attempt == 1:
                raise
            continue
        summary = {"added": len(ops["adds"]), "updated": len(ops["updates"]), "removed": len(ops["removes"])}
        fresh, _ = compute(db, week, ref_date)
        return {
            "entries": [grocery.serialize(entry) for entry in grocery.list_entries(db)],
            "reconcile": fresh, "summary": summary, "undo": undo,
        }
