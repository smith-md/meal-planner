import math
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
import httpx
from bs4 import BeautifulSoup
import json
import re
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from . import models, schemas, crud, pairings, inventory, grocery, reconcile, stock_suggestions
from .database import engine, get_db, ensure_columns

models.Base.metadata.create_all(bind=engine)
ensure_columns(engine)

app = FastAPI(title="Meal Planner API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],  # Vite ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _without_non_finite(value):
    """Copy of value with every NaN/Infinity (at any depth) replaced by its text."""
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {key: _without_non_finite(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_without_non_finite(item) for item in value]
    return value


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request, exc):
    """Like FastAPI's default 422, but a rejected NaN/Infinity is echoed as text.

    The default echoes the raw input, and JSON cannot encode NaN, so the error response itself failed.
    """
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(_without_non_finite(exc.errors()))})


@app.get("/")
def read_root():
    return {"message": "Meal Planner API"}


@app.get("/meals", response_model=List[schemas.Meal])
def get_meals(search: Optional[str] = None, db: Session = Depends(get_db)):
    return crud.get_meals(db, search=search)


@app.post("/meals", response_model=schemas.Meal)
def create_meal(meal: schemas.MealCreate, db: Session = Depends(get_db)):
    return crud.create_meal(db, meal)


@app.patch("/meals/{meal_id}", response_model=schemas.Meal)
def update_meal(meal_id: int, data: schemas.MealUpdate, db: Session = Depends(get_db)):
    meal = crud.update_meal(db, meal_id, data)
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    return meal


@app.patch("/meals/{meal_id}/details", response_model=schemas.Meal)
def update_meal_details(meal_id: int, data: schemas.MealDetailsUpdate, db: Session = Depends(get_db)):
    meal = crud.update_meal_details(db, meal_id, data)
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    return meal


@app.get("/week-plans/current", response_model=schemas.WeekPlan)
def get_current_week_plan(ref_date: Optional[date] = None, db: Session = Depends(get_db)):
    return crud.get_current_week_plan(db, ref_date)


@app.patch("/week-plans/days/{day_id}", response_model=schemas.Day)
def update_day(day_id: int, day_update: schemas.DayUpdate, db: Session = Depends(get_db)):
    day = crud.update_day_state(db, day_id, day_update)
    if not day:
        raise HTTPException(status_code=404, detail="Day not found")
    return day


@app.post("/week-plans/{week_plan_id}/meals", response_model=schemas.WeekPlan)
def add_meal_to_week(week_plan_id: int, meal_data: schemas.WeekMealAdd, db: Session = Depends(get_db)):
    week_plan = crud.add_meal_to_week(db, week_plan_id, meal_data.meal_id, meal_data.servings)
    if not week_plan:
        raise HTTPException(status_code=404, detail="Week plan or Meal not found")
    return week_plan


@app.patch("/week-plans/{week_plan_id}/meals/{meal_id}", response_model=schemas.WeekPlan)
def update_week_meal_servings(week_plan_id: int, meal_id: int, data: schemas.WeekMealUpdate,
                              db: Session = Depends(get_db)):
    week_plan = crud.update_week_meal_servings(db, week_plan_id, meal_id, data.servings)
    if not week_plan:
        raise HTTPException(status_code=404, detail="Meal is not planned in this week")
    return week_plan


@app.delete("/week-plans/{week_plan_id}/meals/{meal_id}", response_model=schemas.WeekPlan)
def remove_meal_from_week(week_plan_id: int, meal_id: int, db: Session = Depends(get_db)):
    week_plan = crud.remove_meal_from_week(db, week_plan_id, meal_id)
    if not week_plan:
        raise HTTPException(status_code=404, detail="Week plan or Meal not found")
    return week_plan


@app.put("/week-plans/{week_plan_id}/meals/{meal_id}/day", response_model=schemas.WeekPlan)
def set_week_meal_day(week_plan_id: int, meal_id: int, data: schemas.WeekMealDayUpdate,
                      db: Session = Depends(get_db)):
    return crud.set_week_meal_day(db, week_plan_id, meal_id, data.day_id)


@app.put("/week-plans/{week_plan_id}/meals/{meal_id}/status", response_model=schemas.WeekPlan)
def set_week_meal_status(week_plan_id: int, meal_id: int, data: schemas.WeekMealStatusUpdate,
                         db: Session = Depends(get_db)):
    return crud.set_week_meal_status(db, week_plan_id, meal_id, data.status)


@app.post("/week-plans/{week_plan_id}/meals/{meal_id}/cook", response_model=schemas.CookResult)
def cook_week_meal(week_plan_id: int, meal_id: int, db: Session = Depends(get_db)):
    return inventory.cook_week_meal(db, week_plan_id, meal_id)


@app.get("/week-plans/{week_plan_id}/shopping-list")
def get_shopping_list(week_plan_id: int, db: Session = Depends(get_db)):
    """Get aggregated shopping list with smart quantity combining."""
    week = db.get(models.WeekPlan, week_plan_id)
    return pairings.shopping_list(db, week) if week else []


@app.get("/week-plans/{week_plan_id}/pairings", response_model=List[schemas.PairingIngredient])
def list_pairings(week_plan_id: int, db: Session = Depends(get_db)):
    week = db.get(models.WeekPlan, week_plan_id)
    if not week:
        raise HTTPException(404, "Week plan not found")
    return pairings.get_pairings(db, week)


@app.post("/week-plans/{week_plan_id}/pairings", response_model=List[schemas.PairingIngredient])
def track_ingredient(week_plan_id: int, data: schemas.PairingIngredientCreate, db: Session = Depends(get_db)):
    week = db.get(models.WeekPlan, week_plan_id)
    if not week:
        raise HTTPException(404, "Week plan not found")
    if data.meal_id is not None and data.meal_id not in {meal.id for meal in week.meals}:
        raise HTTPException(400, "Choose a meal in this week's plan")
    ingredient = pairings.parse_amount(data.amount)
    if not ingredient:
        raise HTTPException(400, "Enter an amount like 1/2 head of cabbage.")
    for _, existing, _, _ in pairings.tracked_ingredients(db, week):
        if existing.key == ingredient.key:
            raise HTTPException(409, "This ingredient is already tracked. Remove it before changing the amount.")
    db.add(models.PairingIngredient(week_plan_id=week.id, meal_id=data.meal_id, amount=data.amount.strip()))
    db.commit()
    return pairings.get_pairings(db, week)


@app.get("/inventory", response_model=List[schemas.InventoryItem])
def get_inventory(db: Session = Depends(get_db)):
    return [inventory.serialize_item(row) for row in inventory.list_inventory(db)]


@app.get("/inventory/availability", response_model=List[schemas.InventoryAvailability])
def get_inventory_availability(ref_date: Optional[date] = None, db: Session = Depends(get_db)):
    return inventory.availability(db, ref_date)


@app.get("/inventory/staples", response_model=List[schemas.Staple])
def get_staples(db: Session = Depends(get_db)):
    return [inventory.serialize_staple(row) for row in inventory.list_staples(db)]


@app.get("/package-sizes", response_model=List[schemas.PackageSizeOut])
def list_package_sizes(db: Session = Depends(get_db)):
    return [inventory.serialize_package_size(row) for row in inventory.list_package_sizes(db)]


@app.put("/package-sizes", response_model=Optional[schemas.PackageSizeOut])
def set_package_size(data: schemas.PackageSizeUpdate, db: Session = Depends(get_db)):
    row = inventory.set_package_size(db, data.item, data.unit_group, data.size, data.label)
    return inventory.serialize_package_size(row) if row else None


@app.put("/inventory/{item_id}/minimum", response_model=schemas.Staple)
def set_inventory_minimum(item_id: int, data: schemas.MinimumUpdate, db: Session = Depends(get_db)):
    return inventory.serialize_staple(inventory.set_minimum(db, item_id, data.minimum))


@app.put("/inventory/{item_id}", response_model=schemas.InventoryItem)
def set_inventory_quantity(item_id: int, data: schemas.InventoryQuantityUpdate, db: Session = Depends(get_db)):
    return inventory.serialize_item(inventory.set_quantity(db, item_id, data.quantity))


@app.post("/inventory/purchases", response_model=schemas.InventoryPurchase)
def create_inventory_purchase(data: schemas.InventoryPurchaseCreate, db: Session = Depends(get_db)):
    purchase, replayed = inventory.credit_purchase(db, data.purchase_id, data.amount, data.location)
    return inventory.serialize_purchase(purchase, replayed)


@app.delete("/inventory/purchases/{purchase_id}", response_model=schemas.InventoryPurchase)
def revert_inventory_purchase(purchase_id: str, db: Session = Depends(get_db)):
    return inventory.serialize_purchase(inventory.revert_purchase(db, purchase_id), False)


@app.get("/grocery-entries", response_model=List[schemas.GroceryEntry])
def list_grocery_entries(db: Session = Depends(get_db)):
    return [grocery.serialize(entry) for entry in grocery.list_entries(db)]


@app.post("/grocery-entries", response_model=schemas.GroceryEntry)
def create_grocery_entry(data: schemas.GroceryEntryCreate, db: Session = Depends(get_db)):
    entry, replayed = grocery.create_entry(db, data.entry_key, data.name, data.note, data.week_plan_id)
    return grocery.serialize(entry, replayed)


@app.post("/grocery-entries/import-local", response_model=List[schemas.GroceryEntry])
def import_local_grocery_entries(data: schemas.LocalImport, db: Session = Depends(get_db)):
    return [grocery.serialize(entry) for entry in grocery.import_local(db, data.entries)]


@app.post("/grocery-entries/undo", response_model=List[schemas.GroceryEntry])
def undo_grocery_changes(data: schemas.GroceryUndo, db: Session = Depends(get_db)):
    return [grocery.serialize(entry) for entry in grocery.undo_changes(db, data)]


@app.patch("/grocery-entries/{entry_id}", response_model=schemas.GroceryEntry)
def update_grocery_entry(entry_id: int, data: schemas.GroceryEntryUpdate, db: Session = Depends(get_db)):
    entry = grocery.update_entry(db, entry_id, data.model_fields_set, data.purchased, data.credit)
    return grocery.serialize(entry)


@app.delete("/grocery-entries/{entry_id}", status_code=204)
def delete_grocery_entry(entry_id: int, db: Session = Depends(get_db)):
    grocery.delete_entry(db, entry_id)


@app.delete("/grocery-entries")
def clear_purchased_grocery_entries(purchased: bool = False, db: Session = Depends(get_db)):
    if not purchased:
        raise HTTPException(400, "Only purchased entries can be cleared in bulk (purchased=true).")
    return {"deleted": grocery.clear_purchased(db)}


@app.get("/week-plans/{week_plan_id}/reconcile", response_model=schemas.ReconcileResult)
def get_reconcile(week_plan_id: int, ref_date: Optional[date] = None, db: Session = Depends(get_db)):
    week = db.get(models.WeekPlan, week_plan_id)
    if not week:
        raise HTTPException(404, "Week plan not found")
    return reconcile.compute(db, week, ref_date)[0]


@app.get("/week-plans/{week_plan_id}/stock-suggestions", response_model=schemas.StockSuggestionsResult)
def get_stock_suggestions(week_plan_id: int, ref_date: Optional[date] = None, db: Session = Depends(get_db)):
    week = db.get(models.WeekPlan, week_plan_id)
    if not week:
        raise HTTPException(404, "Week plan not found")
    return stock_suggestions.compute(db, week, ref_date)


@app.post("/week-plans/{week_plan_id}/reconcile", response_model=schemas.ReconcileApplyResult)
def apply_reconcile(week_plan_id: int, data: schemas.ReconcileApply, db: Session = Depends(get_db)):
    week = db.get(models.WeekPlan, week_plan_id)
    if not week:
        raise HTTPException(404, "Week plan not found")
    return reconcile.apply(db, week, data.fingerprint, data.ref_date)


@app.delete("/pairing-ingredients/{ingredient_id}", status_code=204)
def remove_tracked_ingredient(ingredient_id: int, db: Session = Depends(get_db)):
    row = db.get(models.PairingIngredient, ingredient_id)
    if row:
        db.delete(row)
        db.commit()


def parse_yield(value):
    """Best-effort servings count from a schema.org recipeYield (int, string, or list)."""
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = int(value)
    elif isinstance(value, str):
        match = re.search(r"\d+", value)
        number = int(match.group()) if match else 0
    else:
        return None
    return number if 1 <= number <= 99 else None


@app.post("/import-recipe", response_model=schemas.RecipeImportResponse)
async def import_recipe(recipe_url: schemas.RecipeImportURL):
    try:
        async with httpx.AsyncClient() as client:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            response = await client.get(recipe_url.url, headers=headers, timeout=10.0)
            response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Try to find recipe data in JSON-LD format
        script_tags = soup.find_all('script', type='application/ld+json')
        recipe_data = None

        for script in script_tags:
            try:
                data = json.loads(script.string)
                if isinstance(data, dict) and data.get('@type') == 'Recipe':
                    recipe_data = data
                    break
                elif isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and item.get('@type') == 'Recipe':
                            recipe_data = item
                            break
            except:
                continue

        if recipe_data:
            # Extract recipe information
            name = recipe_data.get('name', 'Imported Recipe')
            description = recipe_data.get('description', '')

            # Extract ingredients
            ingredients_list = recipe_data.get('recipeIngredient', [])
            ingredients = '\n'.join(ingredients_list) if ingredients_list else ''

            # Extract tags/keywords
            keywords = recipe_data.get('keywords', '')
            if isinstance(keywords, list):
                keywords = ', '.join(keywords)

            return schemas.RecipeImportResponse(
                name=name,
                notes=description,
                tags=keywords,
                ingredients=ingredients,
                yield_servings=parse_yield(recipe_data.get('recipeYield'))
            )
        else:
            # Fallback to basic scraping
            title_tag = soup.find('h1')
            name = title_tag.get_text(strip=True) if title_tag else 'Imported Recipe'

            return schemas.RecipeImportResponse(
                name=name,
                notes='Recipe imported from NYT Cooking',
                tags='',
                ingredients=''
            )

    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch recipe: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error importing recipe: {str(e)}")


@app.post("/import-recipe-from-image", response_model=schemas.RecipeImportResponse)
async def import_recipe_from_image(image: UploadFile = File(...)):
    # Photo import is not available yet; a replacement for the removed AI-based
    # extraction has not been chosen.
    raise HTTPException(status_code=501, detail="Photo import is not available yet.")
