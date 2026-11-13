# Meal Planner Backend (FastAPI + SQLite)

This is a starter backend for your meal-planning and weekly-meal-coverage app.

It supports:

- Items (ingredients)
- Meals and meal ingredients
- Weekly plans
  - 7 days starting from the week's Monday
  - `need_meal` toggle per day
  - Attach meals to specific days
- A `summary` of how many nights need meals vs how many are planned

You can use this as the backend for a React frontend that shows a week view
and lets you click whether you need to plan a meal for each night.

---

## Project structure

```text
mealplanner-backend/
  app/
    __init__.py
    main.py
    database.py
    models.py
    schemas.py
    crud.py
    deps.py
    routers/
      __init__.py
      meals.py
      week_plans.py
```

- `database.py` – SQLAlchemy engine, session, and Base
- `models.py` – SQLAlchemy models (Item, Meal, MealIngredient, WeekPlan, WeekDay, WeekDayMeal)
- `schemas.py` – Pydantic schemas for request/response validation
- `crud.py` – Basic helper functions for DB operations
- `deps.py` – FastAPI dependency for DB session
- `routers/meals.py` – Endpoints for items and meals
- `routers/week_plans.py` – Endpoints for weekly planning (days, need_meal toggle, attach/remove meals)
- `main.py` – App entrypoint, CORS config, router registration

---

## Requirements

- Python 3.10+ (recommended)
- pip

Install dependencies:

```bash
pip install fastapi uvicorn sqlalchemy
```

You can also create a virtual environment first:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install fastapi uvicorn sqlalchemy
```

---

## Running the API

From the `mealplanner-backend` directory:

```bash
uvicorn app.main:app --reload
```

The API will be available at:

- Base URL: `http://127.0.0.1:8000/`
- Docs (Swagger UI): `http://127.0.0.1:8000/docs`

---

## Key endpoints

### Health check

- `GET /`  
  Returns `{ "status": "ok" }`.

### Items

- `GET /meals/items` – list all items
- `POST /meals/items` – create a new item

Example `POST /meals/items` body:

```json
{
  "name": "Chicken breast",
  "category": "Meat",
  "unit": "lb"
}
```

### Meals

- `GET /meals` – list all meals (optional `search` query parameter)
- `POST /meals` – create a meal; `ingredients` is free text, one line per ingredient
- `PATCH /meals/{meal_id}` – set or clear the recipe yield (404 if the meal does not exist)

`yield_servings` is how many servings the recipe's written quantities make.
It is an optional integer from 1 to 99 (`null` means no yield is set).

Example `POST /meals` body:

```json
{
  "name": "Chicken Tacos",
  "notes": "Use leftover chicken if available",
  "ingredients": "1/2 lb chicken breast\n8 tortillas",
  "yield_servings": 4
}
```

Example `PATCH /meals/{meal_id}` body (send `null` to clear the yield):

```json
{ "yield_servings": 6 }
```

### Weekly plan

- `GET /week-plans/current` – get or create the current week plan
  - Weeks are Monday-start by default.
  - If no plan exists for the current week, one is created automatically with 7 days.

Response contains:

- `days` – each day has:
  - `id`, `date`, `need_meal`, `notes`, `meals`
- `summary` – object with:
  - `nights_needing_meals`
  - `nights_planned`
  - `nights_missing`

#### Toggle need_meal

- `PATCH /week-plans/days/{day_id}`

Example body:

```json
{
  "need_meal": false,
  "notes": "Dinner with friends"
}
```

Returns the updated `WeekPlanRead` with recalculated summary.

#### Add a meal to a week

- `POST /week-plans/{week_plan_id}/meals`

Body:

```json
{
  "meal_id": 1,
  "servings": 4
}
```

`servings` (planned servings, integer 1-99) is optional. If omitted, it
defaults to the meal's `yield_servings`, which may be `null`. The response is
the week plan; its `meal_servings` list holds `{ "meal_id", "servings" }` for
each planned meal.

#### Change planned servings

- `PATCH /week-plans/{week_plan_id}/meals/{meal_id}` with body `{ "servings": 6 }`

`servings` is required (1-99). Returns the updated week plan, or 404 if the
meal is not planned in that week.

#### Remove a meal from a week

- `DELETE /week-plans/{week_plan_id}/meals/{meal_id}`

Removes that meal from the week and returns the updated week plan.

#### Assign a day, skip, and cook

- `PUT /week-plans/{week_plan_id}/meals/{meal_id}/day` with `{ "day_id": 12 }` assigns the meal to a day of that week (400 if the day is in another week); `null` unassigns. Returns the week plan, or 404 if the meal is not planned there. 409 if already cooked.
- `PUT /week-plans/{week_plan_id}/meals/{meal_id}/status` with `{ "status": "planned" | "skipped" }`. 409 if already cooked.
- The week plan's `meal_schedule` lists `{ meal_id, day_id, status, cooked_servings, cooked_at }` per planned meal.
- `POST /week-plans/{week_plan_id}/meals/{meal_id}/cook` marks the meal cooked and deducts ingredients at the planned servings, which are frozen as `cooked_servings`. 409 if no day is assigned or the meal is skipped. It deducts exactly once; repeats return the stored result with `replayed: true`.
  - Deduction order: fridge, then pantry. Short stock floors at zero; each `deductions` entry has `item`, `unit`, `requested`, `deducted`, `short`. Unparseable lines are in `untracked`.
  - A cooked meal cannot be re-dated, re-skipped, have its servings changed (PATCH), or be removed (DELETE); these return 409.
- Planning, rescheduling, and skipping never change stock; only cooking does.

#### Inventory

- `GET /inventory` – stock rows (`id`, `item`, `unit`, `quantity`, `location`).
- `GET /inventory/availability` – per ingredient `on_hand`, `reserved`, `available`, `short`, and `reserved_by` (week plan, meal, day). Reservations are computed from planned meals (not skipped or cooked) in weeks ending on or after the optional `ref_date` (default today); nothing is stored.
- `PUT /inventory/{item_id}` with `{ "quantity": "2" }` – manual correction to an absolute quantity in the row's unit (whole numbers, fractions like `1/2` or `1 1/2`, or decimals; `0` empties the row). 400 for an invalid quantity, 404 for an unknown id.
- `POST /inventory/purchases` and `DELETE /inventory/purchases/{purchase_id}` credit and revert purchases (see the root `README.md`).

The shopping list and pairings do not subtract inventory and ignore cooked/skipped state.

#### Scaling, pairings, and shopping list

Ingredient quantities are scaled by `servings / yield_servings` before the
shopping list (`GET /week-plans/{week_plan_id}/shopping-list`) and pairings
(`GET /week-plans/{week_plan_id}/pairings`) are calculated. Fractions
(`1/2`, `1 1/2`, `½`) and compatible units (for example cups and tablespoons)
are combined.

- If a meal has no yield (or no planned servings), the factor is 1 and the
  written quantities are used as is. The UI shows a note for meals with no yield.
- Lines whose quantity cannot be parsed are never scaled. In the shopping list
  they appear as unmeasured entries, with a `note` such as `not scaled (recipe x1.5)`
  when the meal's scale factor is not 1.
- Each pairing row includes `needs_more` (boolean) and `shortfall` (text such
  as `1/2 head of cabbage`, empty when `needs_more` is false). Changing a meal's
  servings recalculates the remaining amount; if planned meals now use more than
  the tracked ingredient provides, `needs_more` becomes true. Each suggestion in
  `current` and `next_week` also carries its own `needs_more` flag.

#### Database and migration

The database is SQLite at `./meal_planner.db` unless the `DATABASE_URL`
environment variable is set (for example `sqlite:///:memory:` for a throwaway
database). On startup the app runs `create_all` and then adds the
`meals.yield_servings` and `week_meals.servings` columns to older databases
that lack them. This is idempotent, and existing rows keep `NULL` values.

---

## Running the tests

From the `backend` directory:

```bash
pip install -r requirements-dev.txt
pytest
```

`pytest.ini` sets `pythonpath = .` and `testpaths = tests`.

---

## Next steps

From here you can:

- Add endpoints to generate a **shopping trip** from the weekly plan + routine + pantry lists.
- Add simple auth/household support so you and your wife have a shared account.
- Build a React frontend that:
  - Calls `GET /week-plans/current`
  - Renders a 7-day card layout
  - Lets you toggle `need_meal` and attach meals per day
  - Shows `nights_needing_meals`, `nights_planned`, and `nights_missing` at the top.
