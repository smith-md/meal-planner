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
    }


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
            db.execute(
                update(models.InventoryItem)
                .where(models.InventoryItem.id == row.id)
                .values(base_quantity=models.InventoryItem.base_quantity + ingredient.base_quantity)
            )
            purchase = models.InventoryPurchase(
                purchase_id=purchase_id, inventory_item_id=row.id,
                amount=amount.strip(), base_quantity=ingredient.base_quantity,
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


def set_quantity(db: Session, item_id, quantity):
    """Manual correction: set a stock row to an absolute quantity in its display unit.

    0 empties the row (it stays in the table so purchase history keeps its reference).
    Reservations and the consumption ledger are untouched.
    """
    row = db.get(models.InventoryItem, item_id)
    if not row:
        raise HTTPException(404, "Inventory item not found")
    text = " ".join(quantity.split())
    if not QUANTITY_PATTERN.match(text):
        raise HTTPException(400, QUANTITY_HELP)
    try:
        value = float(sum(Fraction(part) for part in text.split()))
    except (ValueError, ZeroDivisionError, OverflowError):
        raise HTTPException(400, QUANTITY_HELP)
    base = value * pairings.Ingredient(0, row.unit, row.item).factor
    row.base_quantity = 0.0 if base < pairings.EPSILON else base
    db.commit()
    db.refresh(row)
    return row


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
    reserved = defaultdict(float)
    reserved_by = defaultdict(list)
    day_names = {}
    for week_meal in _planned_rows(db, today):
        if week_meal.day_id is not None and week_meal.day_id not in day_names:
            day = db.get(models.Day, week_meal.day_id)
            day_names[week_meal.day_id] = day.day_name if day else None
        totals, first, _, _ = pairings.meal_lines(week_meal.meal, week_meal.servings)
        for key, amount in totals.items():
            if amount <= pairings.EPSILON:
                continue
            reserved[key] += amount
            ingredients.setdefault(key, first[key])
            reserved_by[key].append({
                "week_plan_id": week_meal.week_plan_id,
                "meal_id": week_meal.meal_id,
                "name": week_meal.meal.name,
                "day": day_names.get(week_meal.day_id),
            })
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
            "on_hand": _display(ingredient, on_hand[key]),
            "reserved": _display(ingredient, reserved[key]),
            "available": _display(ingredient, max(left, 0.0)),
            "short": _display(ingredient, shortage) if shortage else "",
            "reserved_by": reserved_by[key],
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
        "cooked_at": week_meal.cooked_at,
        "day_id": week_meal.day_id,
        "replayed": replayed,
        "deductions": deductions,
        "untracked": untracked,
    }


def cook_week_meal(db: Session, week_plan_id, meal_id):
    """Mark a scheduled meal cooked and deduct its ingredients once, in one transaction.

    The conditional status update is the exactly-once guard: only the request that flips the
    row to cooked deducts; any later or concurrent request replays the stored result.
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
    try:
        flipped = db.execute(
            update(models.WeekMeal)
            .where(models.WeekMeal.id == week_meal.id)
            .where(or_(models.WeekMeal.status.is_(None), models.WeekMeal.status != "cooked"))
            .values(
                status="cooked",
                cooked_servings=models.WeekMeal.servings,
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
