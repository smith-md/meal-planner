from pydantic import BaseModel, Field, field_validator
from datetime import date, datetime
from typing import List, Literal, Optional


class MealBase(BaseModel):
    name: str
    notes: Optional[str] = None
    tags: Optional[str] = None
    ingredients: Optional[str] = None
    yield_servings: Optional[int] = Field(None, ge=1, le=99)


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


class WeekMealServings(BaseModel):
    meal_id: int
    servings: Optional[int] = None

    class Config:
        from_attributes = True


class WeekMealSchedule(BaseModel):
    meal_id: int
    day_id: Optional[int] = None
    status: str = "planned"
    cooked_servings: Optional[int] = None
    cooked_at: Optional[datetime] = None

    @field_validator("status", mode="before")
    @classmethod
    def _null_is_planned(cls, value):
        return value or "planned"

    class Config:
        from_attributes = True


class WeekPlan(WeekPlanBase):
    id: int
    days: List[Day] = []
    meals: List[Meal] = []
    meal_servings: List[WeekMealServings] = []
    meal_schedule: List[WeekMealSchedule] = []

    class Config:
        from_attributes = True


class DayUpdate(BaseModel):
    state: Optional[str] = None


class WeekMealAdd(BaseModel):
    meal_id: int
    servings: Optional[int] = Field(None, ge=1, le=99)


class WeekMealUpdate(BaseModel):
    servings: int = Field(ge=1, le=99)


class WeekMealDayUpdate(BaseModel):
    day_id: Optional[int] = None


class WeekMealStatusUpdate(BaseModel):
    status: Literal["planned", "skipped"]


class CookDeduction(BaseModel):
    item: str
    unit: str
    requested: str
    deducted: str
    short: str


class CookResult(BaseModel):
    meal_id: int
    status: str
    cooked_servings: Optional[int] = None
    cooked_at: Optional[datetime] = None
    day_id: Optional[int] = None
    replayed: bool
    deductions: List[CookDeduction]
    untracked: List[str]


class MealYieldUpdate(BaseModel):
    yield_servings: Optional[int] = Field(None, ge=1, le=99)


class PairingIngredientCreate(BaseModel):
    amount: str = Field(min_length=1, max_length=200)
    meal_id: Optional[int] = None


class PairingSuggestion(BaseModel):
    meal_id: int
    name: str
    uses: str
    extra: str
    needs_more: bool = False


class PairingIngredient(BaseModel):
    id: int
    amount: str
    source: Optional[str]
    carried: bool
    remaining: str
    needs_more: bool = False
    shortfall: str = ""
    current: List[PairingSuggestion]
    next_week: List[PairingSuggestion]


class RecipeImportURL(BaseModel):
    url: str


class RecipeImportResponse(BaseModel):
    name: str
    notes: Optional[str] = None
    tags: Optional[str] = None
    ingredients: Optional[str] = None
    yield_servings: Optional[int] = None


class InventoryItem(BaseModel):
    id: int
    item: str
    unit: str
    quantity: str
    location: str


class InventoryPurchaseCreate(BaseModel):
    purchase_id: str = Field(min_length=8, max_length=64)
    amount: str = Field(min_length=1, max_length=200)
    location: Literal["fridge", "pantry"]


class InventoryPurchase(BaseModel):
    purchase_id: str
    amount: str
    location: str
    reverted: bool
    replayed: bool
    inventory: InventoryItem


class InventoryQuantityUpdate(BaseModel):
    quantity: str = Field(min_length=1, max_length=20)


class ReservedBy(BaseModel):
    week_plan_id: int
    meal_id: int
    name: str
    day: Optional[str] = None


class InventoryAvailability(BaseModel):
    item: str
    unit: str
    on_hand: str
    reserved: str
    available: str
    short: str
    reserved_by: List[ReservedBy]
