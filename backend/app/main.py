from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
import httpx
from bs4 import BeautifulSoup
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from . import models, schemas, crud, pairings
from .database import engine, get_db

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Meal Planner API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],  # Vite ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {"message": "Meal Planner API"}


@app.get("/meals", response_model=List[schemas.Meal])
def get_meals(search: Optional[str] = None, db: Session = Depends(get_db)):
    return crud.get_meals(db, search=search)


@app.post("/meals", response_model=schemas.Meal)
def create_meal(meal: schemas.MealCreate, db: Session = Depends(get_db)):
    return crud.create_meal(db, meal)


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
    week_plan = crud.add_meal_to_week(db, week_plan_id, meal_data.meal_id)
    if not week_plan:
        raise HTTPException(status_code=404, detail="Week plan or Meal not found")
    return week_plan


@app.delete("/week-plans/{week_plan_id}/meals/{meal_id}", response_model=schemas.WeekPlan)
def remove_meal_from_week(week_plan_id: int, meal_id: int, db: Session = Depends(get_db)):
    week_plan = crud.remove_meal_from_week(db, week_plan_id, meal_id)
    if not week_plan:
        raise HTTPException(status_code=404, detail="Week plan or Meal not found")
    return week_plan


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


@app.delete("/pairing-ingredients/{ingredient_id}", status_code=204)
def remove_tracked_ingredient(ingredient_id: int, db: Session = Depends(get_db)):
    row = db.get(models.PairingIngredient, ingredient_id)
    if row:
        db.delete(row)
        db.commit()


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
                ingredients=ingredients
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
