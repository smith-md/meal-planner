from pydantic import BaseModel, Field, StrictBool, StrictInt, field_validator, model_validator
from datetime import date, datetime
from typing import Any, List, Literal, Optional


class MealBase(BaseModel):
    name: str
    notes: Optional[str] = None
    tags: Optional[str] = None
    ingredients: Optional[str] = None
    yield_servings: Optional[int] = Field(None, ge=1, le=99)
    prep_minutes: Optional[StrictInt] = Field(None, ge=0, le=1440)
    cook_minutes: Optional[StrictInt] = Field(None, ge=0, le=1440)
    make_ahead: StrictBool = False


class MealCreate(MealBase):
    pass


class Meal(MealBase):
    id: int
    worth_repeating: Optional[bool] = None  # latest cooked mark; null when unrated

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


Slot = Literal["breakfast", "lunch", "dinner"]
_Date = date  # a field named `date` shadows the type inside a class body


class WeekMealSchedule(BaseModel):
    meal_id: int
    day_id: Optional[int] = None
    slot: Optional[str] = None
    status: str = "planned"
    cooked_servings: Optional[int] = None
    cooked_at: Optional[datetime] = None
    worth_repeating: Optional[bool] = None

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


_PLACEMENT_MESSAGE = "Choose both a day and a meal slot, or neither."


class WeekMealAdd(BaseModel):
    meal_id: int
    servings: Optional[int] = Field(None, ge=1, le=99)
    date: Optional[_Date] = None
    slot: Optional[Slot] = None

    @model_validator(mode="after")
    def _placement_is_complete(self):
        if (self.date is None) != (self.slot is None):
            raise ValueError(_PLACEMENT_MESSAGE)
        return self


class WeekMealUpdate(BaseModel):
    """Partial update: servings and/or a move. date+slot both null unschedules."""
    servings: Optional[int] = Field(None, ge=1, le=99)
    date: Optional[_Date] = None
    slot: Optional[Slot] = None

    @model_validator(mode="after")
    def _valid_change(self):
        fields = self.model_fields_set
        if not fields & {"servings", "date", "slot"}:
            raise ValueError("Send servings, or a day and a meal slot.")
        if "servings" in fields and self.servings is None:
            raise ValueError("servings cannot be null")
        if fields & {"date", "slot"}:
            if not {"date", "slot"} <= fields or (self.date is None) != (self.slot is None):
                raise ValueError(_PLACEMENT_MESSAGE)
        return self

    @property
    def moves(self) -> bool:
        return "date" in self.model_fields_set


class WeekMealDayUpdate(BaseModel):
    day_id: Optional[int] = None


class WeekMealStatusUpdate(BaseModel):
    status: Literal["planned", "skipped"]


class WeekMealWorthRepeating(BaseModel):
    worth_repeating: Optional[StrictBool] = None  # null clears the mark


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
    worth_repeating: Optional[bool] = None
    day_id: Optional[int] = None
    replayed: bool
    deductions: List[CookDeduction]
    untracked: List[str]


class MealYieldUpdate(BaseModel):
    yield_servings: Optional[int] = Field(None, ge=1, le=99)


class MealUpdate(BaseModel):
    """Partial update for PATCH /meals/{id}: only fields present in the body are changed.

    A yield_servings-only body behaves as it did before (null clears the yield).
    """
    name: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[str] = None
    ingredients: Optional[str] = None
    yield_servings: Optional[int] = Field(None, ge=1, le=99)
    prep_minutes: Optional[StrictInt] = Field(None, ge=0, le=1440)
    cook_minutes: Optional[StrictInt] = Field(None, ge=0, le=1440)
    make_ahead: Optional[StrictBool] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value):
        if value is None or not value.strip():
            raise ValueError("name cannot be blank")
        return value.strip()

    @field_validator("make_ahead")
    @classmethod
    def make_ahead_not_null(cls, value):
        if value is None:
            raise ValueError("make_ahead cannot be null")
        return value


class MealDetailsUpdate(BaseModel):
    """Partial update: only fields present in the body are changed."""
    prep_minutes: Optional[StrictInt] = Field(None, ge=0, le=1440)
    cook_minutes: Optional[StrictInt] = Field(None, ge=0, le=1440)
    make_ahead: Optional[StrictBool] = None

    @field_validator("make_ahead")
    @classmethod
    def make_ahead_not_null(cls, value):
        if value is None:
            raise ValueError("make_ahead cannot be null")
        return value


class PairingIngredientCreate(BaseModel):
    amount: str = Field(min_length=1, max_length=200)
    meal_id: Optional[int] = None


class PairingSuggestion(BaseModel):
    meal_id: int
    name: str
    uses: str
    extra: str
    needs_more: bool = False
    worth_repeating: Optional[bool] = None


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
    unit_group: str
    added_at: Optional[str] = None  # ISO UTC time of the latest credit; null when unknown


class RowReservation(BaseModel):
    meal_id: int
    name: str
    day: Optional[str] = None
    amount: str


class InventoryRow(InventoryItem):
    """A stock row as listed by GET /inventory: the item plus low flag and reservations."""
    low: bool
    reserved: str
    reserved_by: List[RowReservation]


class InventoryUse(BaseModel):
    amount: str = Field(min_length=1, max_length=20)


class InventoryUseResult(BaseModel):
    item: InventoryRow
    removed: str


class InventoryReturnResult(BaseModel):
    item: InventoryRow
    added: str


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
    amount: str


class InventoryAvailability(BaseModel):
    item: str
    unit: str
    unit_group: str
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
    low: bool = False


class GroceryCredit(BaseModel):
    amount: str = Field(min_length=1, max_length=200)
    location: Literal["fridge", "pantry"]


class GroceryEntry(BaseModel):
    id: int
    entry_key: str
    source: str
    kind: Optional[Literal["plan", "restock"]] = None  # "restock": a staple topped up to its minimum
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
    kind: Literal["plan", "restock"] = "plan"


class ReconcileUpdate(BaseModel):
    entry_id: int
    entry_key: str
    name: str
    item: Optional[str] = None
    from_quantity: str
    to_quantity: str
    kind: Literal["plan", "restock"] = "plan"


class ReconcileRemove(BaseModel):
    entry_id: int
    entry_key: str
    name: str
    kind: Literal["plan", "restock"] = "plan"


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
    worth_repeating: Optional[bool] = None
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
