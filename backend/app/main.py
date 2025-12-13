from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
import httpx
from bs4 import BeautifulSoup
import json
import base64
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from . import models, schemas, crud
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
def get_current_week_plan(db: Session = Depends(get_db)):
    return crud.get_current_week_plan(db)


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
    return crud.get_aggregated_shopping_list(db, week_plan_id)


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
            ingredients = '\\n'.join(ingredients_list) if ingredients_list else ''

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
    try:
        # Read and encode image
        image_data = await image.read()
        base64_image = base64.b64encode(image_data).decode('utf-8')

        # Determine media type
        media_type = image.content_type or "image/jpeg"

        # Get Anthropic API key from environment
        api_key = os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="ANTHROPIC_API_KEY not configured. Please set it in your environment."
            )

        # Call Claude API with vision
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                json={
                    "model": "claude-3-5-sonnet-20241022",
                    "max_tokens": 1024,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": base64_image
                                }
                            },
                            {
                                "type": "text",
                                "text": """Please extract recipe information from this image. Return a JSON object with the following fields:
- name: The recipe name
- notes: Brief description or cooking notes
- tags: Relevant tags (e.g., "vegetarian", "quick", "italian") as comma-separated values
- ingredients: List of ingredients, one per line

If this is not a recipe image, return an error message in the name field."""
                            }
                        ]
                    }]
                },
                timeout=30.0
            )

            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Claude API error: {response.text}"
                )

            result = response.json()
            content = result['content'][0]['text']

            # Try to parse JSON from the response
            try:
                # Look for JSON in the response
                import re
                json_match = re.search(r'\{[\s\S]*\}', content)
                if json_match:
                    recipe_data = json.loads(json_match.group())
                else:
                    # Fallback: treat the whole response as the recipe name
                    recipe_data = {
                        "name": content[:100],
                        "notes": "Extracted from image",
                        "tags": "",
                        "ingredients": ""
                    }

                return schemas.RecipeImportResponse(
                    name=recipe_data.get('name', 'Recipe from Image'),
                    notes=recipe_data.get('notes', ''),
                    tags=recipe_data.get('tags', ''),
                    ingredients=recipe_data.get('ingredients', '')
                )
            except json.JSONDecodeError:
                # If no valid JSON, use the text response as notes
                return schemas.RecipeImportResponse(
                    name="Recipe from Image",
                    notes=content,
                    tags="",
                    ingredients=""
                )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")
