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

- `GET /meals` – list all meals
- `POST /meals` – create a meal (with ingredients)
- `GET /meals/{meal_id}` – get a single meal

Example `POST /meals` body:

```json
{
  "name": "Chicken Tacos",
  "notes": "Use leftover chicken if available",
  "default_servings": 4,
  "ingredients": [
    { "item_id": 1, "quantity_per_serving": 0.5, "unit": "lb" },
    { "item_id": 2, "quantity_per_serving": 2, "unit": "tortillas" }
  ]
}
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

#### Add a meal to a day

- `POST /week-plans/days/{day_id}/meals`

Body:

```json
{
  "meal_id": 1,
  "servings": 4
}
```

If `servings` is omitted, it will use the meal's `default_servings`.

#### Remove a meal from a day

- `DELETE /week-plans/day-meals/{day_meal_id}`

Removes that meal from the day and returns the updated week plan with summary.

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
