from pydantic import BaseModel
from datetime import date
from typing import List, Optional


class MealBase(BaseModel):
    name: str
    notes: Optional[str] = None
    tags: Optional[str] = None
    ingredients: Optional[str] = None


class MealCreate(MealBase):
    pass


class Meal(MealBase):
    id: int

    class Config:
        from_attributes = True


class DayBase(BaseModel):
    date: date
    day_name: str
    state: str = "neutral"


class DayCreate(DayBase):
    pass


class Day(DayBase):
    id: int
    week_plan_id: int
    meals: List[Meal] = []

    class Config:
        from_attributes = True


class WeekPlanBase(BaseModel):
    start_date: date
    end_date: date


class WeekPlanCreate(WeekPlanBase):
    pass


class WeekPlan(WeekPlanBase):
    id: int
    days: List[Day] = []

    class Config:
        from_attributes = True


class DayUpdate(BaseModel):
    state: Optional[str] = None


class DayMealAdd(BaseModel):
    meal_id: int
