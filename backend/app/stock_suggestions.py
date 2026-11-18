"""Rank saved meals by how much of the available stock they use.

Read-only. The pool is confirmed inventory (fridge and pantry together) minus the scaled demand of
planned, uncooked meals in the current week up to and including the target week, allocated
earlier week first as reconcile does. What is left is either confirmed stock (no planned meal draws
on it) or a projected remainder (it is left over after planned meals). PairingIngredient leftovers
and unbought purchase leftovers are not counted. Suggestions are each evaluated against the same
pool on their own; they do not compete with each other. Meals already in the target week are never
suggested.
"""
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import crud, models, pairings, reconcile

EPSILON = pairings.EPSILON


def _remainder_source(key, stock, pool, consumers, inventory_rows):
    """("projected", [], meals) when planned meals draw on the key, else ("confirmed", locations, [])."""
    if stock.get(key, 0.0) - pool.get(key, 0.0) > EPSILON:
        return "projected", [], consumers.get(key, [])
    locations = sorted({row.location for row in inventory_rows.get(key, []) if row.base_quantity > EPSILON})
    return "confirmed", locations, []


def compute(db: Session, week, ref_date=None, limit=10):
    today = ref_date or date.today()
    current_start = today - timedelta(days=today.weekday())
    if week.start_date < current_start:
        raise HTTPException(400, "Choose this week or a later week.")
    offset = (week.start_date - current_start).days
    position = "this" if offset == 0 else "next" if offset == 7 else "later"

    stock, stock_ingredient, inventory_rows, _ = reconcile.stock_pool(db)
    weeks = (
        db.query(models.WeekPlan)
        .filter(models.WeekPlan.start_date >= current_start, models.WeekPlan.start_date <= week.start_date)
        .order_by(models.WeekPlan.start_date)
        .all()
    )
    pool, consumers = reconcile.allocate(db, stock, weeks)

    remainders = []
    for key in sorted(pool, key=lambda k: (k[0].lower(), k[1])):
        if pool[key] <= EPSILON:
            continue
        source, locations, after = _remainder_source(key, stock, pool, consumers, inventory_rows)
        ingredient = stock_ingredient[key]
        remainders.append({
            "key": reconcile.key_text(key), "item": ingredient.item, "unit": reconcile.display_unit(ingredient),
            "amount": reconcile.amount_text(ingredient, pool[key]),
            "source": source, "locations": locations, "after_meals": after,
        })

    in_week = {row.meal_id for row in db.query(models.WeekMeal).filter(models.WeekMeal.week_plan_id == week.id)}
    ranked = []
    for meal in crud.get_meals(db):
        if meal.id in in_week:
            continue
        totals, first, unmeasured, _ = pairings.meal_lines(meal, meal.yield_servings)
        uses, groceries, fractions = [], [], []
        for key in sorted(totals, key=lambda k: (k[0].lower(), k[1])):
            need = totals[key]
            if need <= EPSILON:
                continue
            ingredient = first[key]
            available = max(pool.get(key, 0.0), 0.0)
            used = min(need, available)
            fractions.append(min(used / need, 1.0) if used > EPSILON else 0.0)
            if used > EPSILON:
                source, locations, after = _remainder_source(key, stock, pool, consumers, inventory_rows)
                uses.append({
                    "key": reconcile.key_text(key), "item": ingredient.item,
                    "unit": reconcile.display_unit(ingredient),
                    "used": reconcile.amount_text(ingredient, used),
                    "needed": reconcile.amount_text(ingredient, need),
                    "available": reconcile.amount_text(ingredient, available),
                    "source": source, "locations": locations, "after_meals": after,
                })
            missing = need - used if used > EPSILON else need
            if missing > EPSILON:
                groceries.append({
                    "key": reconcile.key_text(key), "item": ingredient.item,
                    "amount": reconcile.amount_text(ingredient, missing),
                    "name": ingredient.describe(missing), "partial": used > EPSILON,
                })
        if not uses:
            continue
        coverage = sum(fractions) / len(fractions)
        projected = sum(1 for use in uses if use["source"] == "projected")
        ranked.append(((-coverage, len(groceries), -projected, meal.name.lower()), {
            "meal_id": meal.id, "name": meal.name, "servings": meal.yield_servings,
            "worth_repeating": meal.worth_repeating,
            "coverage_percent": int(round(coverage * 100)),
            "covered_count": len(uses), "ingredient_count": len(fractions),
            "uses": uses, "groceries": groceries, "unmeasured": unmeasured,
        }))
    ranked.sort(key=lambda pair: pair[0])
    return {
        "week_plan_id": week.id, "start_date": week.start_date, "end_date": week.end_date,
        "ref_date": today, "position": position,
        "remainders": remainders, "suggestions": [item for _, item in ranked[:limit]],
    }
