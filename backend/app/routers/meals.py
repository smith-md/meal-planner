from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas, models, crud
from ..deps import get_db

router = APIRouter(prefix="/meals", tags=["meals"])


@router.get("/items", response_model=List[schemas.ItemRead])
def list_items(db: Session = Depends(get_db)):
    items = crud.get_items(db)
    return items


@router.post("/items", response_model=schemas.ItemRead)
def create_item(item: schemas.ItemCreate, db: Session = Depends(get_db)):
    existing = crud.get_item_by_name(db, item.name)
    if existing:
        raise HTTPException(status_code=400, detail="Item already exists")
    return crud.create_item(db, item)


@router.get("/", response_model=List[schemas.MealRead])
def list_meals(db: Session = Depends(get_db)):
    meals = crud.get_meals(db)
    return meals


@router.post("/", response_model=schemas.MealRead)
def create_meal(meal: schemas.MealCreate, db: Session = Depends(get_db)):
    # Ensure all item_ids exist
    for ing in meal.ingredients:
        item = db.query(models.Item).filter(models.Item.id == ing.item_id).first()
        if not item:
            raise HTTPException(status_code=400, detail=f"Item id {ing.item_id} not found")

    db_meal = crud.create_meal(db, meal)
    return db_meal


@router.get("/{meal_id}", response_model=schemas.MealRead)
def get_meal(meal_id: int, db: Session = Depends(get_db)):
    meal = crud.get_meal(db, meal_id)
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    return meal
