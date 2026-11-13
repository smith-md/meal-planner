from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import date, timedelta
from . import models, schemas
import re
from fractions import Fraction
from typing import Dict, List, Tuple, Optional


def get_meals(db: Session, search: str = None):
    query = db.query(models.Meal)
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (models.Meal.name.ilike(search_term)) |
            (models.Meal.notes.ilike(search_term)) |
            (models.Meal.tags.ilike(search_term)) |
            (models.Meal.ingredients.ilike(search_term))
        )
    return query.all()


def create_meal(db: Session, meal: schemas.MealCreate):
    db_meal = models.Meal(**meal.model_dump())
    db.add(db_meal)
    db.commit()
    db.refresh(db_meal)
    return db_meal


def get_current_week_plan(db: Session, ref_date: date = None):
    today = ref_date or date.today()
    start_of_week = today - timedelta(days=today.weekday())

    week_plan = db.query(models.WeekPlan).filter(
        models.WeekPlan.start_date == start_of_week
    ).first()

    if not week_plan:
        week_plan = create_week_plan(db, start_of_week)

    return week_plan


def create_week_plan(db: Session, start_date: date):
    end_date = start_date + timedelta(days=6)
    week_plan = models.WeekPlan(start_date=start_date, end_date=end_date)
    db.add(week_plan)

    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    for i in range(7):
        day = models.Day(
            week_plan=week_plan,
            date=start_date + timedelta(days=i),
            day_name=day_names[i],
            state="need"
        )
        db.add(day)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(models.WeekPlan).filter_by(start_date=start_date).first()
        if existing:
            return existing
        raise
    db.refresh(week_plan)
    return week_plan


def update_day_state(db: Session, day_id: int, day_update: schemas.DayUpdate):
    day = db.query(models.Day).filter(models.Day.id == day_id).first()
    if day and day_update.state:
        day.state = day_update.state
        db.commit()
        db.refresh(day)
    return day


def update_meal_yield(db: Session, meal_id: int, yield_servings: Optional[int]):
    meal = db.query(models.Meal).filter(models.Meal.id == meal_id).first()
    if meal:
        meal.yield_servings = yield_servings
        db.commit()
        db.refresh(meal)
    return meal


def add_meal_to_week(db: Session, week_plan_id: int, meal_id: int, servings: Optional[int] = None):
    week_plan = db.query(models.WeekPlan).filter(models.WeekPlan.id == week_plan_id).first()
    meal = db.query(models.Meal).filter(models.Meal.id == meal_id).first()

    if week_plan and meal and meal not in week_plan.meals:
        db.add(models.WeekMeal(
            week_plan_id=week_plan_id,
            meal_id=meal_id,
            servings=servings or meal.yield_servings,
        ))
        db.commit()
        db.refresh(week_plan)
    return week_plan


def remove_meal_from_week(db: Session, week_plan_id: int, meal_id: int):
    week_plan = db.query(models.WeekPlan).filter(models.WeekPlan.id == week_plan_id).first()
    meal = db.query(models.Meal).filter(models.Meal.id == meal_id).first()

    if week_plan and meal and meal in week_plan.meals:
        db.query(models.WeekMeal).filter_by(
            week_plan_id=week_plan_id, meal_id=meal_id
        ).delete()
        db.query(models.PairingIngredient).filter_by(
            week_plan_id=week_plan_id, meal_id=meal_id
        ).delete()
        db.commit()
        db.refresh(week_plan)
    return week_plan


def update_week_meal_servings(db: Session, week_plan_id: int, meal_id: int, servings: int):
    rows = db.query(models.WeekMeal).filter_by(
        week_plan_id=week_plan_id, meal_id=meal_id
    ).all()
    if not rows:
        return None
    for row in rows:
        row.servings = servings
    db.commit()
    week_plan = db.query(models.WeekPlan).filter(models.WeekPlan.id == week_plan_id).first()
    db.refresh(week_plan)
    return week_plan


# Unit conversion table to normalize units to a base unit
UNIT_CONVERSIONS = {
    # Volume - base: cups
    'cup': 1.0, 'cups': 1.0, 'c': 1.0,
    'tablespoon': 1/16, 'tablespoons': 1/16, 'tbsp': 1/16, 'tbs': 1/16,
    'teaspoon': 1/48, 'teaspoons': 1/48, 'tsp': 1/48,
    'fluid ounce': 1/8, 'fluid ounces': 1/8, 'fl oz': 1/8, 'floz': 1/8,
    'pint': 2.0, 'pints': 2.0, 'pt': 2.0,
    'quart': 4.0, 'quarts': 4.0, 'qt': 4.0,
    'gallon': 16.0, 'gallons': 16.0, 'gal': 16.0,
    # Exact US customary factors (1 US cup = 236.5882365 ml)
    'milliliter': 1/236.5882365, 'milliliters': 1/236.5882365, 'ml': 1/236.5882365,
    'liter': 1000/236.5882365, 'liters': 1000/236.5882365, 'l': 1000/236.5882365,

    # Weight - base: ounces
    'ounce': 1.0, 'ounces': 1.0, 'oz': 1.0,
    'pound': 16.0, 'pounds': 16.0, 'lb': 16.0, 'lbs': 16.0,
    # Exact factors (1 oz = 28.349523125 g)
    'gram': 1/28.349523125, 'grams': 1/28.349523125, 'g': 1/28.349523125,
    'kilogram': 1000/28.349523125, 'kilograms': 1000/28.349523125, 'kg': 1000/28.349523125,

    # Count - base: pieces
    'piece': 1.0, 'pieces': 1.0, 'pc': 1.0,
    'whole': 1.0, 'each': 1.0,
    'clove': 1.0, 'cloves': 1.0,
    'bunch': 1.0, 'bunches': 1.0,
    'can': 1.0, 'cans': 1.0,
    'package': 1.0, 'packages': 1.0, 'pkg': 1.0,
    'bag': 1.0, 'bags': 1.0,
}


def parse_ingredient(ingredient_line: str) -> Optional[Tuple[float, str, str]]:
    """
    Parse an ingredient line to extract quantity, unit, and item name.
    Returns (quantity, unit, item_name) or None if parsing fails.

    Examples:
    "2 cups flour" -> (2.0, "cups", "flour")
    "1/2 cup olive oil" -> (0.5, "cup", "olive oil")
    "4 chicken breasts" -> (4.0, "pieces", "chicken breasts")
    """
    ingredient_line = ingredient_line.strip()
    if not ingredient_line:
        return None

    # Pattern to match quantity (including fractions), optional unit, and item name
    # Matches: "2", "1/2", "2 1/2", "2.5", etc.
    pattern = r'^(\d+(?:\s+\d+/\d+|\.\d+|/\d+)?)\s*([a-zA-Z]+)?\s*(.+)$'
    match = re.match(pattern, ingredient_line)

    if match:
        quantity_str, unit, item_name = match.groups()

        # Parse quantity (handle fractions like "1/2" or "2 1/2")
        try:
            # Handle mixed fractions like "2 1/2"
            if ' ' in quantity_str:
                whole, frac = quantity_str.split(' ', 1)
                quantity = float(whole) + float(Fraction(frac))
            # Handle simple fractions like "1/2"
            elif '/' in quantity_str:
                quantity = float(Fraction(quantity_str))
            # Handle decimals like "2.5"
            else:
                quantity = float(quantity_str)
        except (ValueError, ZeroDivisionError):
            return None

        # Normalize unit
        unit = unit.lower() if unit else 'pieces'
        item_name = item_name.strip().lower()

        return (quantity, unit, item_name)

    # If no quantity found, treat as single piece
    return (1.0, 'pieces', ingredient_line.lower())


def aggregate_ingredients(ingredients_list: List[str]) -> List[Dict[str, str]]:
    """
    Aggregate ingredients by combining quantities of the same item.
    Returns a list of dicts with 'quantity', 'unit', and 'item' keys.
    """
    # Dictionary to store aggregated ingredients: item_name -> (total_quantity_in_base_unit, original_unit)
    aggregated: Dict[str, Tuple[float, str]] = {}

    for ingredient_line in ingredients_list:
        parsed = parse_ingredient(ingredient_line)
        if not parsed:
            continue

        quantity, unit, item_name = parsed

        # Normalize the unit to base unit for aggregation
        unit_lower = unit.lower()
        if unit_lower in UNIT_CONVERSIONS:
            # Convert to base unit
            base_quantity = quantity * UNIT_CONVERSIONS[unit_lower]

            if item_name in aggregated:
                # Add to existing quantity
                existing_qty, existing_unit = aggregated[item_name]
                aggregated[item_name] = (existing_qty + base_quantity, existing_unit)
            else:
                # New item
                aggregated[item_name] = (base_quantity, unit)
        else:
            # Unknown unit, keep as-is and don't aggregate
            if item_name in aggregated:
                existing_qty, existing_unit = aggregated[item_name]
                aggregated[item_name] = (existing_qty + quantity, existing_unit)
            else:
                aggregated[item_name] = (quantity, unit)

    # Convert back to original units for display
    result = []
    for item_name, (base_quantity, original_unit) in aggregated.items():
        # Convert back from base unit to original unit
        unit_lower = original_unit.lower()
        if unit_lower in UNIT_CONVERSIONS:
            display_quantity = base_quantity / UNIT_CONVERSIONS[unit_lower]
        else:
            display_quantity = base_quantity

        # Format quantity nicely
        if display_quantity == int(display_quantity):
            quantity_str = str(int(display_quantity))
        else:
            quantity_str = f"{display_quantity:.2f}".rstrip('0').rstrip('.')

        result.append({
            'quantity': quantity_str,
            'unit': original_unit,
            'item': item_name
        })

    return sorted(result, key=lambda x: x['item'])


def get_aggregated_shopping_list(db: Session, week_plan_id: int) -> List[Dict[str, str]]:
    """
    Get aggregated shopping list for a week plan with smart quantity combining.
    """
    week_plan = db.query(models.WeekPlan).filter(models.WeekPlan.id == week_plan_id).first()

    if not week_plan:
        return []

    # Collect all ingredients from all meals
    all_ingredients = []
    for meal in week_plan.meals:
        if meal.ingredients:
            # Split by newlines and filter empty lines
            ingredients_lines = [line.strip() for line in meal.ingredients.split('\n') if line.strip()]
            all_ingredients.extend(ingredients_lines)

    # Aggregate and return
    return aggregate_ingredients(all_ingredients)
