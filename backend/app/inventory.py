"""Persistent fridge/pantry inventory, credited when a grocery is checked off.

Stock is global (no week reference) so it survives clearing the list and opening new weeks.
Each credit carries a client-generated single-use purchase_id, recorded in the same
transaction as the credit, so retries and repeated check-offs credit only once.
"""
import re
from collections import defaultdict
from datetime import date, datetime, timezone
from fractions import Fraction

from fastapi import HTTPException
from sqlalchemy import case, or_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models, pairings


def serialize_item(row):
    ingredient = pairings.Ingredient(0, row.unit, row.item)
    unit = "" if row.unit == "piece" else row.unit
    return {
        "id": row.id,
        "item": row.item,
        "unit": unit,
        "quantity": ingredient.display_quantity(row.base_quantity),
        "location": row.location,
        "unit_group": row.unit_group,
        "added_at": _iso(row.added_at),
    }


def _iso(moment):
    """ISO string of a stored (naive UTC) time, or None."""
    return moment.replace(tzinfo=timezone.utc).isoformat() if moment else None


def serialize_purchase(purchase, replayed):
    return {
        "purchase_id": purchase.purchase_id,
        "amount": purchase.amount,
        "location": purchase.inventory_item.location,
        "reverted": purchase.reverted,
        "replayed": replayed,
        "inventory": serialize_item(purchase.inventory_item),
    }


def _find_purchase(db: Session, purchase_id):
    return db.query(models.InventoryPurchase).filter_by(purchase_id=purchase_id).first()


def credit_purchase(db: Session, purchase_id, amount, location):
    """Credit the amount once per purchase_id. Returns (purchase, replayed)."""
    for attempt in range(2):
        existing = _find_purchase(db, purchase_id)
        if existing:
            return existing, True
        ingredient = pairings.parse_amount(amount)
        if not ingredient:
            raise HTTPException(400, "Enter an amount like 2 cups of rice.")
        group = pairings.UNIT_GROUPS.get(ingredient.unit, ingredient.unit)
        try:
            row = (
                db.query(models.InventoryItem)
                .filter_by(item=ingredient.item, unit_group=group, location=location)
                .first()
            )
            if not row:
                row = models.InventoryItem(
                    item=ingredient.item, unit_group=group, unit=ingredient.unit,
                    location=location, base_quantity=0.0,
                )
                db.add(row)
                db.flush()
            credited_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.execute(
                update(models.InventoryItem)
                .where(models.InventoryItem.id == row.id)
                .values(base_quantity=models.InventoryItem.base_quantity + ingredient.base_quantity,
                        added_at=credited_at)
            )
            purchase = models.InventoryPurchase(
                purchase_id=purchase_id, inventory_item_id=row.id,
                amount=amount.strip(), base_quantity=ingredient.base_quantity,
                created_at=credited_at,
            )
            db.add(purchase)
            db.commit()
        except IntegrityError:
            # A duplicate purchase_id or a race creating the stock row: retry once.
            db.rollback()
            if attempt == 1:
                raise
            continue
        db.refresh(purchase)
        db.refresh(row)
        return purchase, False


def revert_purchase(db: Session, purchase_id):
    """Undo a credit (never below zero). Idempotent; the id stays used."""
    purchase = _find_purchase(db, purchase_id)
    if not purchase:
        raise HTTPException(404, "Purchase not found")
    if not purchase.reverted:
        purchase.reverted = True
        db.execute(
            update(models.InventoryItem)
            .where(models.InventoryItem.id == purchase.inventory_item_id)
            .values(base_quantity=models.InventoryItem.base_quantity - purchase.base_quantity)
        )
        db.flush()
        item = db.get(models.InventoryItem, purchase.inventory_item_id)
        db.refresh(item)
        if item.base_quantity < 0:
            item.base_quantity = 0.0
        db.commit()
        db.refresh(purchase)
    return purchase


def list_inventory(db: Session):
    return (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.base_quantity > pairings.EPSILON)
        .order_by(models.InventoryItem.location, models.InventoryItem.item)
        .all()
    )


QUANTITY_PATTERN = re.compile(r"^(\d+\s+\d+/\d+|\d+/\d+|\d*\.\d+|\d+)$")
QUANTITY_HELP = "Enter a quantity like 2, 1/2 or 1 1/2 (0 removes the item)."
MINIMUM_HELP = "Enter a minimum like 2, 1/2 or 1 1/2 (0 warns only when you run out)."


def parse_quantity(quantity, row, help_text=QUANTITY_HELP):
    """Base-unit value of a typed quantity such as "2" or "1 1/2" in the row's display unit."""
    text = " ".join(quantity.split())
    if not QUANTITY_PATTERN.match(text):
        raise HTTPException(400, help_text)
    try:
        value = float(sum(Fraction(part) for part in text.split()))
    except (ValueError, ZeroDivisionError, OverflowError):
        raise HTTPException(400, help_text)
    return value * pairings.Ingredient(0, row.unit, row.item).factor


def set_quantity(db: Session, item_id, quantity):
    """Manual correction: set a stock row to an absolute quantity in its display unit.

    0 empties the row (it stays in the table so purchase history keeps its reference).
    Reservations and the consumption ledger are untouched.
    """
    row = db.get(models.InventoryItem, item_id)
    if not row:
        raise HTTPException(404, "Inventory item not found")
    base = parse_quantity(quantity, row)
    row.base_quantity = 0.0 if base < pairings.EPSILON else base
    db.commit()
    db.refresh(row)
    return row


def low_keys(db: Session):
    """(item, unit_group) keys of tracked staples at or below their minimum.

    Fridge and pantry rows are one pool and the highest minimum applies, as in reconcile.
    """
    stock = defaultdict(float)
    minimums = {}
    for row in db.query(models.InventoryItem).all():
        key = (row.item, row.unit_group)
        stock[key] += max(row.base_quantity, 0.0)
        if row.minimum is not None:
            minimums[key] = max(minimums.get(key, 0.0), row.minimum)
    return {key for key, minimum in minimums.items() if stock[key] <= minimum + pairings.EPSILON}


def serialize_staple(row, low=False):
    ingredient = pairings.Ingredient(0, row.unit, row.item)
    unit = "" if row.unit == "piece" else row.unit
    return {
        "id": row.id,
        "item": row.item,
        "unit": unit,
        "location": row.location,
        "quantity": _display(ingredient, max(row.base_quantity, 0.0)),
        "minimum": _display(ingredient, row.minimum) if row.minimum is not None else None,
        "low": low,
    }


def serialize_staples(db: Session, rows):
    low = low_keys(db)
    return [serialize_staple(row, (row.item, row.unit_group) in low) for row in rows]


def set_minimum(db: Session, item_id, minimum):
    """Set or clear (None) the restock minimum of an ingredient, given on one of its stock rows.

    The minimum belongs to the ingredient, not the location: it is stored on the given row and
    cleared on that ingredient's other rows, so the value shown is the value that applies.
    A minimum of 0 is allowed and makes the item a tracked staple.
    """
    row = db.get(models.InventoryItem, item_id)
    if not row:
        raise HTTPException(404, "Inventory item not found")
    value = None
    if minimum is not None:
        value = parse_quantity(minimum, row, MINIMUM_HELP)
        if value < pairings.EPSILON:
            value = 0.0
    siblings = db.query(models.InventoryItem).filter_by(item=row.item, unit_group=row.unit_group).all()
    for sibling in siblings:
        sibling.minimum = None
    row.minimum = value
    db.commit()
    db.refresh(row)
    return row


PACKAGE_GROUPS = {"weight", "volume"}
PACKAGE_LABEL_DEFAULT = "package"
MIN_PACKAGE_BASE = 0.02  # base units (oz / cup); stops absurd package counts
SHORT_UNITS = {
    "ounce": "oz", "pound": "lb", "gram": "g", "kilogram": "kg", "cup": "cup", "tablespoon": "tbsp",
    "teaspoon": "tsp", "fluid ounce": "fl oz", "pint": "pt", "quart": "qt", "gallon": "gal",
    "milliliter": "ml", "liter": "l",
}
PACKAGE_SIZE_PATTERN = re.compile(r"^(\d+\s+\d+/\d+|\d+/\d+|\d*\.\d+|\d+)\s*([a-z][a-z ]*)$")


def package_size_help(unit_group):
    example = "28 oz or 1 lb" if unit_group == "weight" else "1 qt or 16 fl oz"
    return f"Enter a size like {example}."


def parse_package_size(size, unit_group):
    """(canonical unit, base quantity) of a typed size such as "28 oz"; 400 when unusable."""
    help_text = package_size_help(unit_group)
    text = " ".join(size.lower().split())
    match = PACKAGE_SIZE_PATTERN.match(text)
    if not match:
        raise HTTPException(400, help_text)
    number, unit_text = match.groups()
    unit = pairings.UNIT_ALIASES.get(unit_text.strip())
    if unit is None or pairings.UNIT_GROUPS.get(unit) != unit_group:
        raise HTTPException(400, help_text)
    try:
        value = float(sum(Fraction(part) for part in number.split()))
    except (ValueError, ZeroDivisionError, OverflowError):
        raise HTTPException(400, help_text)
    base = value * pairings.Ingredient(0, unit, "").factor
    if not (base == base) or base in (float("inf"), float("-inf")) or base < MIN_PACKAGE_BASE:
        raise HTTPException(400, help_text)
    return unit, base


def package_size_text(row):
    ingredient = pairings.Ingredient(0, row.unit, row.item)
    return f"{ingredient.display_quantity(row.base_quantity)} {SHORT_UNITS.get(row.unit, row.unit)}"


def serialize_package_size(row):
    return {"item": row.item, "unit_group": row.unit_group, "size": package_size_text(row), "label": row.label}


def list_package_sizes(db: Session):
    return db.query(models.PackageSize).order_by(models.PackageSize.item, models.PackageSize.unit_group).all()


def package_sizes_by_key(db: Session):
    return {(row.item, row.unit_group): row for row in list_package_sizes(db)}


def set_package_size(db: Session, item, unit_group, size, label):
    """Save (upsert) or remove (size None) the package size of an ingredient. Returns the row or None."""
    item = " ".join(item.lower().split())
    if not item:
        raise HTTPException(400, "Choose an ingredient.")
    if unit_group not in PACKAGE_GROUPS:
        raise HTTPException(400, "Package sizes are only for ingredients measured by weight or volume.")
    for attempt in range(2):
        row = db.query(models.PackageSize).filter_by(item=item, unit_group=unit_group).first()
        if size is None or not size.strip():
            if row:
                db.delete(row)
                db.commit()
            return None
        unit, base = parse_package_size(size, unit_group)
        label_text = " ".join((label or "").split()) or None
        if label_text and re.search(r"[(),;]", label_text):
            raise HTTPException(400, "The container name cannot contain brackets, commas or semicolons.")
        try:
            if not row:
                row = models.PackageSize(item=item, unit_group=unit_group, unit=unit, base_quantity=base)
                db.add(row)
            row.unit, row.base_quantity, row.label = unit, base, label_text
            db.commit()
        except IntegrityError:
            db.rollback()
            if attempt == 1:
                raise
            continue
        db.refresh(row)
        return row


def list_staples(db: Session):
    """Every stock row with a minimum, including empty rows that list_inventory hides."""
    return (
        db.query(models.InventoryItem)
        .filter(models.InventoryItem.minimum.is_not(None))
        .order_by(models.InventoryItem.item, models.InventoryItem.location)
        .all()
    )


def _display(ingredient, base):
    return ingredient.display_quantity(base) if base > pairings.EPSILON else "0"


def _planned_rows(db: Session, today):
    return (
        db.query(models.WeekMeal)
        .join(models.WeekPlan, models.WeekMeal.week_plan_id == models.WeekPlan.id)
        .filter(models.WeekPlan.end_date >= today)
        .filter(or_(models.WeekMeal.status.is_(None), models.WeekMeal.status == "planned"))
        .order_by(models.WeekMeal.id)
        .all()
    )


def _reservations(db: Session, today):
    """What planned meals reserve per (item, unit_group).

    Returns (first, entries): the first Ingredient seen per key and, per key in meal order, the
    reserving meals as dicts with a base-unit amount.
    """
    first_seen = {}
    entries = defaultdict(list)
    day_names = {}
    for week_meal in _planned_rows(db, today):
        if week_meal.day_id is not None and week_meal.day_id not in day_names:
            day = db.get(models.Day, week_meal.day_id)
            day_names[week_meal.day_id] = day.day_name if day else None
        totals, first, _, _ = pairings.meal_lines(week_meal.meal, week_meal.servings)
        for key, amount in totals.items():
            if amount <= pairings.EPSILON:
                continue
            first_seen.setdefault(key, first[key])
            entries[key].append({
                "week_plan_id": week_meal.week_plan_id,
                "meal_id": week_meal.meal_id,
                "name": week_meal.meal.name,
                "day": day_names.get(week_meal.day_id),
                "base": amount,
            })
    return first_seen, entries


def _allocate_reservations(db: Session, today):
    """Split each ingredient's reservations over its stock rows, fridge first then pantry.

    Same row order cook_week_meal deducts in. Returns {row id: [(entry, base amount)]}; a
    reservation beyond what is on hand is not assigned to any row (that is a shortage).
    """
    _, entries = _reservations(db, today)
    rows_by_key = defaultdict(list)
    for row in db.query(models.InventoryItem).all():
        rows_by_key[(row.item, row.unit_group)].append(row)
    allocation = defaultdict(list)
    for key, key_entries in entries.items():
        rows = sorted(rows_by_key.get(key, []), key=lambda r: (0 if r.location == "fridge" else 1, r.id))
        free = [max(row.base_quantity, 0.0) for row in rows]
        for entry in key_entries:
            remaining = entry["base"]
            for index, row in enumerate(rows):
                take = min(free[index], remaining)
                if take <= pairings.EPSILON:
                    continue
                free[index] -= take
                remaining -= take
                allocation[row.id].append((entry, take))
                if remaining <= pairings.EPSILON:
                    break
    return allocation


def serialize_rows(db: Session, rows, today=None):
    """Stock rows with the low flag and per-row reservations (see _allocate_reservations)."""
    today = today or date.today()
    low = low_keys(db)
    allocation = _allocate_reservations(db, today)
    result = []
    for row in rows:
        ingredient = pairings.Ingredient(0, row.unit, row.item)
        portions = allocation.get(row.id, [])
        result.append({
            **serialize_item(row),
            "low": (row.item, row.unit_group) in low,
            "reserved": _display(ingredient, sum(take for _, take in portions)),
            "reserved_by": [
                {"meal_id": entry["meal_id"], "name": entry["name"], "day": entry["day"],
                 "amount": _display(ingredient, take)}
                for entry, take in portions
            ],
        })
    return result


def _positive_base(row, amount):
    base = parse_quantity(amount, row)
    if base <= pairings.EPSILON:
        raise HTTPException(400, "Enter an amount greater than 0, like 1, 1/2 or 1 1/2.")
    return base


def use_stock(db: Session, item_id, amount):
    """Remove an amount from a stock row, never below zero. Returns (row, base amount removed)."""
    row = db.get(models.InventoryItem, item_id)
    if not row:
        raise HTTPException(404, "Inventory item not found")
    wanted = _positive_base(row, amount)
    removed = min(max(row.base_quantity, 0.0), wanted)
    db.execute(
        update(models.InventoryItem)
        .where(models.InventoryItem.id == row.id)
        .values(base_quantity=models.InventoryItem.base_quantity - removed)
    )
    db.flush()
    db.refresh(row)
    if row.base_quantity < pairings.EPSILON:
        row.base_quantity = 0.0
    db.commit()
    db.refresh(row)
    return row, removed


def return_stock(db: Session, item_id, amount):
    """Add an amount back to a stock row (the undo of use_stock). Returns (row, base amount added)."""
    row = db.get(models.InventoryItem, item_id)
    if not row:
        raise HTTPException(404, "Inventory item not found")
    added = _positive_base(row, amount)
    db.execute(
        update(models.InventoryItem)
        .where(models.InventoryItem.id == row.id)
        .values(base_quantity=models.InventoryItem.base_quantity + added)
    )
    db.commit()
    db.refresh(row)
    return row, added


def stock_amount_text(row, base):
    return _display(pairings.Ingredient(0, row.unit, row.item), base)


def availability(db: Session, today=None):
    """Per ingredient: stock on hand (fridge + pantry), what planned meals reserve, what is left.

    Reservations are computed from planned (not skipped/cooked) meals in weeks ending on or
    after today; nothing here writes to stock.
    """
    today = today or date.today()
    on_hand = defaultdict(float)
    ingredients = {}
    for row in db.query(models.InventoryItem).order_by(models.InventoryItem.id).all():
        key = (row.item, row.unit_group)
        on_hand[key] += max(row.base_quantity, 0.0)
        ingredients.setdefault(key, pairings.Ingredient(0, row.unit, row.item))
    first_seen, entries = _reservations(db, today)
    reserved = defaultdict(float)
    for key, key_entries in entries.items():
        reserved[key] = sum(entry["base"] for entry in key_entries)
        ingredients.setdefault(key, first_seen[key])
    result = []
    for key in sorted(set(on_hand) | set(reserved)):
        if on_hand[key] <= pairings.EPSILON and reserved[key] <= pairings.EPSILON:
            continue
        ingredient = ingredients[key]
        left = on_hand[key] - reserved[key]
        shortage = -left if left < -pairings.EPSILON else 0.0
        result.append({
            "item": ingredient.item,
            "unit": "" if ingredient.unit == "piece" else ingredient.unit,
            "unit_group": key[1],
            "on_hand": _display(ingredient, on_hand[key]),
            "reserved": _display(ingredient, reserved[key]),
            "available": _display(ingredient, max(left, 0.0)),
            "short": _display(ingredient, shortage) if shortage else "",
            "reserved_by": [
                {**{k: v for k, v in entry.items() if k != "base"},
                 "amount": _display(ingredient, entry["base"])}
                for entry in entries.get(key, [])
            ],
        })
    return result


def _cook_result(db: Session, week_meal, replayed):
    consumptions = (
        db.query(models.InventoryConsumption)
        .filter_by(week_meal_id=week_meal.id)
        .order_by(models.InventoryConsumption.id)
        .all()
    )
    deductions = []
    for entry in consumptions:
        ingredient = pairings.Ingredient(0, entry.unit, entry.item)
        shortage = entry.requested_base - entry.deducted_base
        deductions.append({
            "item": entry.item,
            "unit": "" if entry.unit == "piece" else entry.unit,
            "requested": _display(ingredient, entry.requested_base),
            "deducted": _display(ingredient, entry.deducted_base),
            "short": _display(ingredient, shortage) if shortage > pairings.EPSILON else "",
        })
    untracked = pairings.meal_lines(week_meal.meal, week_meal.cooked_servings)[2]
    return {
        "meal_id": week_meal.meal_id,
        "status": "cooked",
        "cooked_servings": week_meal.cooked_servings,
        "servings_made": week_meal.cooked_servings,
        "servings_eaten": week_meal.eaten_servings,
        "servings_remaining": week_meal.remaining_servings,
        "servings_reserved": week_meal.reserved_servings,
        "cooked_at": week_meal.cooked_at,
        "worth_repeating": week_meal.worth_repeating,
        "day_id": week_meal.day_id,
        "replayed": replayed,
        "deductions": deductions,
        "untracked": untracked,
    }


def cook_week_meal(db: Session, week_plan_id, meal_id, servings_made=None, servings_eaten=None):
    """Mark a scheduled meal cooked and deduct its ingredients once, in one transaction.

    The conditional status update is the exactly-once guard: only the request that flips the
    row to cooked deducts; any later or concurrent request replays the stored result (the
    servings sent with a replayed request are ignored).
    """
    week_meal = db.query(models.WeekMeal).filter_by(
        week_plan_id=week_plan_id, meal_id=meal_id
    ).first()
    if not week_meal:
        raise HTTPException(404, "Meal is not planned in this week")
    if week_meal.status != "cooked":
        if week_meal.day_id is None:
            raise HTTPException(409, "Assign a day first.")
        if week_meal.status == "skipped":
            raise HTTPException(409, "This meal is skipped; unskip it before cooking.")
    made = servings_made if servings_made is not None else week_meal.servings
    eaten = servings_eaten if servings_eaten is not None else made
    if week_meal.status != "cooked" and made is not None and eaten is not None and eaten > made:
        raise HTTPException(400, "Servings eaten cannot exceed servings made.")
    try:
        flipped = db.execute(
            update(models.WeekMeal)
            .where(models.WeekMeal.id == week_meal.id)
            .where(or_(models.WeekMeal.status.is_(None), models.WeekMeal.status != "cooked"))
            .values(
                status="cooked",
                cooked_servings=made,
                eaten_servings=eaten,
                cooked_at=datetime.now(timezone.utc).replace(tzinfo=None),
            )
        ).rowcount
        if flipped == 0:
            db.rollback()
            db.refresh(week_meal)
            return _cook_result(db, week_meal, True)
        db.refresh(week_meal)
        totals, first, _, _ = pairings.meal_lines(week_meal.meal, week_meal.cooked_servings)
        for key, requested in totals.items():
            item, group = key
            remaining = requested
            rows = (
                db.query(models.InventoryItem)
                .filter_by(item=item, unit_group=group)
                .order_by(case((models.InventoryItem.location == "fridge", 0), else_=1),
                          models.InventoryItem.id)
                .all()
            )
            for row in rows:
                take = min(max(row.base_quantity, 0.0), remaining)
                if take <= 0:
                    continue
                db.execute(
                    update(models.InventoryItem)
                    .where(models.InventoryItem.id == row.id)
                    .values(base_quantity=models.InventoryItem.base_quantity - take)
                )
                remaining -= take
            db.flush()
            for row in rows:
                db.refresh(row)
                if row.base_quantity < pairings.EPSILON:
                    row.base_quantity = 0.0
            deducted = requested - remaining if remaining > pairings.EPSILON else requested
            db.add(models.InventoryConsumption(
                week_meal_id=week_meal.id, item=item, unit_group=group,
                unit=first[key].unit, requested_base=requested, deducted_base=deducted,
            ))
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(week_meal)
    return _cook_result(db, week_meal, False)
