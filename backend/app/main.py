from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional

from . import models, schemas, crud
from .database import engine, get_db

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Meal Planner API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite default port
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


@app.post("/week-plans/days/{day_id}/meals", response_model=schemas.Day)
def add_meal_to_day(day_id: int, meal_data: schemas.DayMealAdd, db: Session = Depends(get_db)):
    day = crud.add_meal_to_day(db, day_id, meal_data.meal_id)
    if not day:
        raise HTTPException(status_code=404, detail="Day or Meal not found")
    return day


@app.delete("/week-plans/days/{day_id}/meals/{meal_id}", response_model=schemas.Day)
def remove_meal_from_day(day_id: int, meal_id: int, db: Session = Depends(get_db)):
    day = crud.remove_meal_from_day(db, day_id, meal_id)
    if not day:
        raise HTTPException(status_code=404, detail="Day or Meal not found")
    return day
