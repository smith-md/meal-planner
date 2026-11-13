from collections import defaultdict
from dataclasses import dataclass
from datetime import timedelta
from fractions import Fraction
import re

from . import crud, models


UNIT_GROUPS = {
    "cup": "volume", "tablespoon": "volume", "teaspoon": "volume",
    "fluid ounce": "volume", "pint": "volume", "quart": "volume",
    "gallon": "volume", "milliliter": "volume", "liter": "volume",
    "ounce": "weight", "pound": "weight", "gram": "weight", "kilogram": "weight",
    "piece": "count", "clove": "clove", "bunch": "bunch", "can": "can",
    "package": "package", "bag": "bag", "head": "head",
}
UNIT_ALIASES = {}
for group in (
    "cup cups c", "tablespoon tablespoons tbsp tbs", "teaspoon teaspoons tsp",
    "pint pints pt", "quart quarts qt", "gallon gallons gal",
    "milliliter milliliters ml", "liter liters l", "ounce ounces oz",
    "pound pounds lb lbs", "gram grams g", "kilogram kilograms kg",
    "piece pieces pc each whole", "clove cloves", "bunch bunches", "can cans",
    "package packages pkg", "bag bags", "head heads",
):
    canonical, *aliases = group.split()
    UNIT_ALIASES.update({alias: canonical for alias in [canonical, *aliases]})
UNIT_ALIASES.update(dict.fromkeys(("fluid ounces", "fluid ounce", "fl oz", "floz"), "fluid ounce"))

QUANTITY = re.compile(r"^(\d+\s+\d+/\d+|\d+/\d+|\d*\.\d+|\d+)\s+(.+)$")
VULGAR_FRACTIONS = {"½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8"}
EPSILON = 0.00001


@dataclass
class Ingredient:
    quantity: float
    unit: str
    item: str

    @property
    def key(self):
        return (self.item, UNIT_GROUPS.get(self.unit, self.unit))

    @property
    def factor(self):
        return crud.UNIT_CONVERSIONS.get(self.unit, 1.0)

    @property
    def base_quantity(self):
        return self.quantity * self.factor

    def display_quantity(self, base_quantity):
        value = base_quantity / self.factor
        fraction = Fraction(value).limit_denominator(16)
        if abs(float(fraction) - value) < EPSILON:
            whole, numerator = divmod(fraction.numerator, fraction.denominator)
            quantity = f"{numerator}/{fraction.denominator}" if numerator else str(whole)
            if whole and numerator:
                quantity = f"{whole} {quantity}"
        else:
            quantity = f"{value:.4g}"
        return quantity

    def describe(self, base_quantity):
        quantity = self.display_quantity(base_quantity)
        unit = self.unit
        if unit == "piece":
            return f"{quantity} {self.item}"
        if base_quantity / self.factor > 1 + EPSILON:
            unit += "es" if unit == "bunch" else "s"
        return f"{quantity} {unit} of {self.item}"


def parse_amount(line):
    line = " ".join(line.lower().split())
    for glyph, fraction in VULGAR_FRACTIONS.items():
        line = line.replace(glyph, f" {fraction}").strip()
    match = QUANTITY.match(line)
    if not match:
        return None
    number, item = match.groups()
    if not item[0].isalpha():
        return None
    try:
        quantity = float(sum(Fraction(part) for part in number.split()))
    except (ValueError, ZeroDivisionError, OverflowError):
        return None
    if quantity <= 0:
        return None

    item = re.split(r"[,;(]", item, maxsplit=1)[0].strip()
    unit = "piece"
    for alias in sorted(UNIT_ALIASES, key=len, reverse=True):
        if item.startswith(f"{alias} "):
            unit = UNIT_ALIASES[alias]
            item = item[len(alias):].strip().removeprefix("of ").strip()
            break
    # Common countable produce. Avoid stripping arbitrary suffixes from names.
    item = {"cabbages": "cabbage", "onions": "onion", "carrots": "carrot",
            "lemons": "lemon", "limes": "lime", "peppers": "pepper",
            "potatoes": "potato", "tomatoes": "tomato"}.get(item, item)
    if item == "cabbage" and unit == "piece":
        unit = "head"
    if item:
        return Ingredient(quantity, unit, item)
    return None


def meal_amounts(meal):
    totals = defaultdict(float)
    for line in (meal.ingredients or "").replace("\\n", "\n").splitlines():
        ingredient = parse_amount(line)
        if ingredient:
            totals[ingredient.key] += ingredient.base_quantity
    return totals


def tracked_ingredients(db, week):
    previous = db.query(models.WeekPlan).filter_by(
        start_date=week.start_date - timedelta(days=7)
    ).first()
    weeks = {week.id: week}
    if previous:
        weeks[previous.id] = previous
    rows = db.query(models.PairingIngredient).filter(
        models.PairingIngredient.week_plan_id.in_(weeks)
    ).order_by(models.PairingIngredient.id).all()
    for row in rows:
        source_week = weeks[row.week_plan_id]
        source = next((meal for meal in source_week.meals if meal.id == row.meal_id), None)
        if row.meal_id is not None and source is None:
            continue
        ingredient = parse_amount(row.amount)
        yield row, ingredient, source, source_week


def available_amount(ingredient, source, source_week):
    used = sum(
        meal_amounts(meal)[ingredient.key] for meal in source_week.meals if meal != source
    )
    return max(0, ingredient.base_quantity - used)


def suggestions(ingredient, remaining, meals, planned):
    if remaining <= EPSILON:
        return []
    candidates = []
    for meal in meals:
        quantity = meal_amounts(meal)[ingredient.key]
        if meal.id not in planned and quantity > EPSILON:
            extra = max(0, quantity - remaining)
            candidates.append(((extra > EPSILON, abs(quantity - remaining), meal.name.lower()), {
                "meal_id": meal.id,
                "name": meal.name,
                "uses": ingredient.describe(min(quantity, remaining)),
                "extra": ingredient.describe(extra) if extra > EPSILON else "",
            }))
    return [suggestion for _, suggestion in sorted(candidates, key=lambda candidate: candidate[0])[:5]]


def get_pairings(db, week):
    following = db.query(models.WeekPlan).filter_by(
        start_date=week.end_date + timedelta(days=1)
    ).first()
    meals = crud.get_meals(db)
    current_planned = {meal.id for meal in week.meals}
    next_planned = {meal.id for meal in following.meals} if following else set()
    result = []
    for row, ingredient, source, source_week in tracked_ingredients(db, week):
        carried = source_week.id != week.id
        remaining = available_amount(ingredient, source, source_week)
        if carried:
            remaining -= sum(meal_amounts(meal)[ingredient.key] for meal in week.meals)
        next_remaining = remaining
        if following:
            next_remaining -= sum(meal_amounts(meal)[ingredient.key] for meal in following.meals)
        result.append({
            "id": row.id,
            "amount": row.amount,
            "source": source.name if source else None,
            "carried": carried,
            "remaining": ingredient.describe(remaining) if remaining > EPSILON else "",
            "current": suggestions(ingredient, remaining, meals, current_planned),
            "next_week": [] if carried else suggestions(
                ingredient, next_remaining, meals, current_planned | next_planned
            ),
        })
    return result


def shopping_list(db, week):
    on_hand = defaultdict(float)
    for _, ingredient, source, source_week in tracked_ingredients(db, week):
        if source_week.id != week.id:
            on_hand[ingredient.key] += available_amount(ingredient, source, source_week)
        elif source is None:
            on_hand[ingredient.key] += ingredient.base_quantity

    totals = defaultdict(float)
    ingredients = {}
    unmeasured = []
    for meal in week.meals:
        for line in (meal.ingredients or "").replace("\\n", "\n").splitlines():
            ingredient = parse_amount(line)
            if ingredient:
                totals[ingredient.key] += ingredient.base_quantity
                ingredients.setdefault(ingredient.key, ingredient)
            elif line.strip():
                unmeasured.append(line.strip())
    result = []
    for key, ingredient in ingredients.items():
        remaining = totals[key] - on_hand[key]
        if remaining > EPSILON:
            result.append({
                "quantity": ingredient.display_quantity(remaining),
                "unit": ingredient.unit if ingredient.unit != "piece" else "",
                "item": ingredient.item,
            })
    result.extend({"quantity": "", "unit": "", "item": line} for line in dict.fromkeys(unmeasured))
    return sorted(result, key=lambda item: item["item"].lower())
