from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import date, datetime
from typing import Any, List, Literal, Optional


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


class MinimumUpdate(BaseModel):
    minimum: Optional[str] = Field(None, max_length=20)


class PackageSizeUpdate(BaseModel):
    item: str = Field(..., min_length=1, max_length=200)
    unit_group: str = Field(..., min_length=1, max_length=50)
    size: Optional[str] = Field(None, max_length=20)  # null removes the size
    label: Optional[str] = Field(None, max_length=20)


class PackageSizeOut(BaseModel):
    item: str
    unit_group: str
    size: str
    label: Optional[str] = None


class Staple(BaseModel):
    id: int
    item: str
    unit: str
    location: str
    quantity: str
    minimum: Optional[str] = None


class GroceryCredit(BaseModel):
    amount: str = Field(min_length=1, max_length=200)
    location: Literal["fridge", "pantry"]


class GroceryEntry(BaseModel):
    id: int
    entry_key: str
    source: str
    week_plan_id: Optional[int] = None
    week_start: Optional[date] = None
    name: str
    item: Optional[str] = None
    unit_group: Optional[str] = None
    unit: Optional[str] = None
    quantity: Optional[str] = None
    quantity_base: Optional[float] = None
    note: Optional[str] = None
    purchased: bool
    purchase_id: str
    credit: Optional[GroceryCredit] = None
    replayed: bool = False


class GroceryEntryCreate(BaseModel):
    entry_key: str = Field(min_length=8, max_length=120)
    name: str = Field(min_length=1, max_length=200)
    note: Optional[str] = Field(None, max_length=200)
    week_plan_id: Optional[int] = None


class GroceryEntryUpdate(BaseModel):
    purchased: Optional[bool] = None
    credit: Optional[GroceryCredit] = None


class GroceryEntryRestore(BaseModel):
    entry_key: str = Field(min_length=1, max_length=300)
    source: Literal["manual", "added", "plan", "legacy"]
    week_plan_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=200)
    item: Optional[str] = Field(None, max_length=200)
    unit_group: Optional[str] = Field(None, max_length=50)
    unit: Optional[str] = Field(None, max_length=50)
    quantity_base: Optional[float] = Field(None, ge=0, allow_inf_nan=False)
    note: Optional[str] = Field(None, max_length=200)
    purchased: bool = False
    purchase_id: str = Field(min_length=8, max_length=64)
    credit: Optional[GroceryCredit] = None

    @model_validator(mode="after")
    def source_matches_key(self):
        """The key prefix decides the source, so a restore cannot forge a plan or legacy entry."""
        prefix = {"manual": "manual:", "added": "added:", "legacy": "legacy:",
                  "plan": f"plan:{self.week_plan_id}:"}[self.source]
        if not self.entry_key.startswith(prefix):
            raise ValueError("source does not match the entry key")
        return self


class GroceryUndoUpdate(BaseModel):
    entry_key: str = Field(min_length=1, max_length=300)
    name: str = Field(min_length=1, max_length=200)
    quantity_base: Optional[float] = Field(None, ge=0, allow_inf_nan=False)
    note: Optional[str] = Field(None, max_length=200)


class GroceryUndo(BaseModel):
    added_keys: List[str] = Field(default_factory=list, max_length=500)
    updated: List[GroceryUndoUpdate] = Field(default_factory=list, max_length=500)
    removed: List[GroceryEntryRestore] = Field(default_factory=list, max_length=500)


class LocalImport(BaseModel):
    # Entries are sanitised one by one in grocery.import_local, so one bad row cannot fail the batch.
    entries: List[Any] = Field(max_length=500)


class ReconcileMeal(BaseModel):
    meal_id: int
    name: str
    day: Optional[str] = None
    servings: Optional[int] = None
    amount: str = ""


class ReconcileWarning(BaseModel):
    type: Literal["below_minimum", "short"]
    message: str


class ReconcileEntryRef(BaseModel):
    id: int
    name: str
    source: str
    purchased: bool


class ReconcilePackage(BaseModel):
    size: str
    label: str
    packages: int
    buy: str
    remainder: str


class ReconcileIngredient(BaseModel):
    key: str
    item: str
    unit: str
    unit_group: str
    package_eligible: bool
    package: Optional[ReconcilePackage] = None
    demand: str
    on_hand: str
    held_for_earlier_weeks: str
    available: str
    to_buy: str
    add_name: str
    minimum: Optional[str] = None
    inventory_id: Optional[int] = None
    warnings: List[ReconcileWarning]
    meals: List[ReconcileMeal]
    covered: bool
    covered_by_stock: bool
    entry: Optional[ReconcileEntryRef] = None


class ReconcileUnmeasured(BaseModel):
    line: str
    note: Optional[str] = None
    meals: List[ReconcileMeal]


class ReconcileStaple(BaseModel):
    key: str
    item: str
    unit: str
    on_hand: str
    minimum: str
    inventory_id: Optional[int] = None
    warnings: List[ReconcileWarning]
    covered: bool
    entry: Optional[ReconcileEntryRef] = None


class ReconcileAdd(BaseModel):
    entry_key: str
    name: str
    quantity: str
    note: Optional[str] = None


class ReconcileUpdate(BaseModel):
    entry_id: int
    entry_key: str
    name: str
    item: Optional[str] = None
    from_quantity: str
    to_quantity: str


class ReconcileRemove(BaseModel):
    entry_id: int
    entry_key: str
    name: str


class ReconcileChanges(BaseModel):
    add: List[ReconcileAdd]
    update: List[ReconcileUpdate]
    remove: List[ReconcileRemove]


class ReconcileResult(BaseModel):
    week_plan_id: int
    start_date: date
    end_date: date
    ref_date: date
    position: Literal["this", "next", "later"]
    meal_count: int
    no_yield: List[str]
    ingredients: List[ReconcileIngredient]
    unmeasured: List[ReconcileUnmeasured]
    staples: List[ReconcileStaple]
    changes: ReconcileChanges
    fingerprint: str


class ReconcileApply(BaseModel):
    fingerprint: str = Field(min_length=1, max_length=100)
    ref_date: Optional[date] = None


class ReconcileSummary(BaseModel):
    added: int
    updated: int
    removed: int


class ReconcileApplyResult(BaseModel):
    entries: List[GroceryEntry]
    reconcile: ReconcileResult
    summary: ReconcileSummary
    undo: Optional[GroceryUndo] = None


class StockUse(BaseModel):
    key: str
    item: str
    unit: str
    used: str
    needed: str
    available: str
    source: Literal["confirmed", "projected"]
    locations: List[Literal["fridge", "pantry"]] = []
    after_meals: List[ReconcileMeal] = []


class StockGrocery(BaseModel):
    key: str
    item: str
    amount: str
    name: str
    partial: bool


class StockSuggestion(BaseModel):
    meal_id: int
    name: str
    servings: Optional[int] = None
    coverage_percent: int
    covered_count: int
    ingredient_count: int
    uses: List[StockUse]
    groceries: List[StockGrocery]
    unmeasured: List[str]


class StockRemainder(BaseModel):
    key: str
    item: str
    unit: str
    amount: str
    source: Literal["confirmed", "projected"]
    locations: List[Literal["fridge", "pantry"]] = []
    after_meals: List[ReconcileMeal] = []


class StockSuggestionsResult(BaseModel):
    week_plan_id: int
    start_date: date
    end_date: date
    ref_date: date
    position: Literal["this", "next", "later"]
    remainders: List[StockRemainder]
    suggestions: List[StockSuggestion]
