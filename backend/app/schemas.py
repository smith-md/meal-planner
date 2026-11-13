from pydantic import BaseModel, Field
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
    state: str = "need"


class DayCreate(DayBase):
    pass


class Day(DayBase):
    id: int
    week_plan_id: int

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
    meals: List[Meal] = []

    class Config:
        from_attributes = True


class DayUpdate(BaseModel):
    state: Optional[str] = None


class WeekMealAdd(BaseModel):
    meal_id: int


class PairingIngredientCreate(BaseModel):
    amount: str = Field(min_length=1, max_length=200)
    meal_id: Optional[int] = None


class PairingSuggestion(BaseModel):
    meal_id: int
    name: str
    uses: str
    extra: str


class PairingIngredient(BaseModel):
    id: int
    amount: str
    source: Optional[str]
    carried: bool
    remaining: str
    current: List[PairingSuggestion]
    next_week: List[PairingSuggestion]


class RecipeImportURL(BaseModel):
    url: str


class RecipeImportResponse(BaseModel):
    name: str
    notes: Optional[str] = None
    tags: Optional[str] = None
    ingredients: Optional[str] = None
