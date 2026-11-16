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
- `PATCH /meals/{meal_id}/details` – partially update `prep_minutes`, `cook_minutes` and `make_ahead` (404 if the meal does not exist)

`yield_servings` is how many servings the recipe's written quantities make.
It is an optional integer from 1 to 99 (`null` means no yield is set).

`prep_minutes` and `cook_minutes` are optional whole numbers of minutes from 0 to 1440
(`null` means not set; 0 is allowed). `make_ahead` is a boolean that defaults to `false`.
They are accepted by `POST /meals` and returned by `GET /meals`. Negative, non-integer
or above-1440 minutes, and a non-boolean or `null` `make_ahead`, return 422.

`PATCH /meals/{meal_id}/details` changes only the fields present in the body: an omitted
field is left as it is (including `yield_servings`), and `null` clears a time. The
yield-only `PATCH /meals/{meal_id}` is unchanged. Example (clears cook time, sets make-ahead):

```json
{ "cook_minutes": null, "make_ahead": true }
```

The Meals Library filters (maximum prep, maximum cook, make-ahead only) run in the
browser over the `GET /meals` result and need no extra endpoint. They combine with the
text search, and meals with an unset time are hidden while that time filter is active.

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

`GET /week-plans/{week_plan_id}/shopping-list` and the pairings do not subtract inventory and ignore cooked/skipped state. For stock-aware figures use the reconcile endpoints below.

#### Staples (minimums)

- `GET /inventory/staples` – every stock row with a minimum (`id`, `item`, `unit`, `location`, `quantity`, `minimum`), including empty rows.
- `PUT /inventory/{item_id}/minimum` with `{ "minimum": "2" }` – set the minimum for that ingredient (it applies across fridge and pantry rows; the other rows' minimums are cleared). `0` is allowed and warns only when the item runs out; `null` clears it. 400 for an invalid value, 404 for an unknown id.

#### Package sizes

Typical package sizes of ingredients, stored in the `package_sizes` table (created at startup). They are global (not per week), keyed by ingredient and unit group, and do not require any stock.

- `GET /package-sizes` – all saved sizes as `[{ "item", "unit_group", "size", "label" }]`, ordered by item then group. `size` is shown in short form (for example `28 oz`).
- `PUT /package-sizes` with `{ "item": "crushed tomatoes", "unit_group": "weight", "size": "28 oz", "label": "can" }` – save (upsert) the size for that item and group and return `{ "item", "unit_group", "size", "label" }`. `item` is lower-cased and whitespace-normalised.
  - `unit_group` must be `weight` or `volume`; any other group (`count`, `clove`, `bunch`, `head`, `can`, `bag`, `package`, ...) returns 400.
  - `size` is a number (whole, decimal, or fraction such as `1 1/2`) followed by a unit that belongs to the group (for example `28 oz`, `1 lb`, `1 qt`, `16 fl oz`), at most 20 characters. A missing unit, a unit from another group, zero, or a size too small to be meaningful returns 400.
  - `size: null` (or blank) deletes the saved size and returns `null`.
  - `label` is optional (at most 20 characters; no brackets, commas, or semicolons, otherwise 400). When absent, reconcile reports the label `package`.
  - Over-long `item`, `unit_group`, `size`, or `label` returns 422.

#### Grocery entries (server-side shopping list)

Each entry has a stable `entry_key`, a `source` (`manual`, `added`, `plan`, `legacy`), an optional `week_plan_id`, `purchased`, a `purchase_id`, and an optional `credit` (`amount`, `location`).

- `GET /grocery-entries` – list all entries.
- `POST /grocery-entries` with `{ "entry_key", "name", "note"?, "week_plan_id"? }` – create an entry. The key must start with `manual:` or `added:` (400 otherwise) and be 8-120 characters. Repeating a key returns the existing entry with `replayed: true`. An `added:` entry returns 409 if an unpurchased entry already covers that ingredient.
- `PATCH /grocery-entries/{entry_id}` with `{ "purchased"?, "credit"? }` – record purchase state. Setting `purchased` back to false clears the credit and issues a new `purchase_id`. A `credit` requires the entry to be purchased (400). 404 for an unknown id.
- `DELETE /grocery-entries/{entry_id}` – remove an entry (204).
- `DELETE /grocery-entries?purchased=true` – remove all purchased entries and return `{ "deleted": n }`; without `purchased=true` it returns 400.
- `POST /grocery-entries/import-local` with `{ "entries": [...] }` (at most 500) – one-time migration of the browser `shoppingList` localStorage items as `legacy:` entries. Rows are cleaned one by one, so a bad row is skipped; re-sending is harmless; purchase state and credits are kept and nothing is credited again.
- `POST /grocery-entries/undo` with `{ "added_keys", "updated", "removed" }` (each at most 500) – inverse of a delete or reconcile apply: removes the added entries, restores the old name/quantity/note of updated ones, and recreates removed ones. Purchased entries are never changed or deleted. 409 if the list changed during the undo.

#### Reconcile

- `GET /week-plans/{week_plan_id}/reconcile` (optional `ref_date`, default today) – preview only; nothing is written. 404 for an unknown week; 400 for a week before the current one.
- `POST /week-plans/{week_plan_id}/reconcile` with `{ "fingerprint", "ref_date"? }` – apply the previewed changes in one transaction. 409 if the fingerprint no longer matches the current changes.

Stock is allocated sequentially by week: weeks from the current one up to the selected week draw on the shared fridge+pantry stock in date order, so the same stock cannot cover two weeks. The result for a week does not depend on which week was requested first. Only planned meals (not skipped or cooked) are demand, and `PairingIngredient` leftovers are not subtracted.

The preview contains:

- `ingredients` – per ingredient `demand`, `on_hand`, `held_for_earlier_weeks`, `available`, `to_buy`, `add_name`, `unit_group`, `package_eligible`, `package`, `minimum`, `inventory_id`, `meals` (which meals need it), `covered` and `entry` (an unpurchased entry already covers it), `covered_by_stock` (nothing left to buy), and `warnings`.
- Package fields – `unit_group` is the row's unit group; `package_eligible` is true only for `weight` and `volume`. `package` is `null` when no size is saved or the row is not eligible; otherwise `{ "size", "label", "packages", "buy", "remainder" }`: `packages` is the whole number of packages needed to cover `to_buy` (0 when stock covers it), `buy` the total amount of those packages, `remainder` the projected leftover (`buy` minus `to_buy`), and `label` the container word (`package` by default). For a row with a package, `add_name` and the `plan:` entry hold the full package amount, for example `28 ounces of crushed tomatoes (1 can)` (label pluralised for several packages, e.g. `2 cans`), and the entry's quantity is that full amount, so checking it off credits the full amount to stock. A change to the size or label changes the entry name, so it appears as an `update` (the quantity may be unchanged) and changes the `fingerprint`.
- `warnings` – `below_minimum` (stock at or below the minimum) and `short` (demand above the stock available to that week).
- `unmeasured` – lines with no parseable quantity, with the meals that use them. `no_yield` – meals with no yield. `staples` – tracked ingredients with a minimum that the week does not use. `position` is `this`, `next`, or `later`.
- `changes` – `add`, `update` (`from_quantity`, `to_quantity`), and `remove` for the week's `plan:` entries, and `fingerprint`, a hash of `changes`. Every item carries `kind`: `"plan"` (covers planned demand) or `"restock"` (a staple topped up to its minimum). Purchased plan entries are never changed or removed. An unpurchased `manual:`, `added:`, or `legacy:` entry for the same ingredient counts as covering it, so no plan entry is added.
- Restock lines – for each key whose total stock is at or below its minimum (the `below_minimum` condition), reconcile also proposes a restock entry with `entry_key` `plan:{week_plan_id}:+restock:{item}:{unit_group}`, note `Restock to minimum`, and `kind` `"restock"`. Amount: `max(minimum - max(pool - this week's demand, 0), 0)`, where `pool` is the sequential allocation after earlier weeks; rounded up to whole packages when the group has a saved package size. A zero amount (including minimum `0` with stock 0) creates no line. The restock top-up of each earlier week is added to the pool of later weeks, so the same shortfall is not restocked twice (`available` can exceed `on_hand`). The restock line never counts as covering the key's plan line (`covered`/`entry` ignore it). An unpurchased `manual:`, `added:`, or `legacy:` entry for the same item and unit group suppresses the restock and is never modified. Unpurchased restock entries are updated or removed by a later reconcile when the amount changes or the key is back above its minimum; purchased ones are never changed or removed and count as already restocked. Apply and undo work as for plan entries.
- Serialized grocery entries have `kind`: `"restock"` for restock entries, `"plan"` for other `plan:` entries, `null` otherwise. The Review changes list and the shopping list label restock lines "Restock".

A successful apply returns `entries` (the whole list), a fresh `reconcile`, a `summary` (`added`, `updated`, `removed`), and `undo`, a payload for `POST /grocery-entries/undo` (`null` if a change list exceeds 500 entries).

#### Meal suggestions from stock

- `GET /week-plans/{week_plan_id}/stock-suggestions` (optional `ref_date`, default today) – read-only; nothing is written. 404 for an unknown week; 400 for a week before the current one.
- The pool is confirmed fridge+pantry inventory minus the scaled demand of planned meals (not skipped or cooked) from the current week through the target week, earlier weeks first (the same allocation as reconcile). Unbought purchase leftovers and manual `PairingIngredient` leftovers are not counted. Matching is exact by item and unit group.
- Candidates are all saved meals except those already in the target week. Each is evaluated against the same pool on its own, so suggestions do not compete with each other. Meals that use none of the pool are omitted.
- Ranking order: highest mean per-ingredient coverage from stock, then fewest groceries, then more projected uses, then name. At most 10 suggestions are returned.
- The response has `week_plan_id`, `start_date`, `end_date`, `ref_date`, `position` (`this`, `next`, or `later`), `remainders`, and `suggestions`.
- Each suggestion has `meal_id`, `name`, `servings`, `coverage_percent`, `covered_count`, `ingredient_count`, `uses`, `groceries`, and `unmeasured`. `uses` entries show the ingredient and quantity used: `key`, `item`, `unit`, `used`, `needed`, `available`, and `source`. `groceries` entries are the additional groceries needed: `key`, `item`, `amount`, `name`, and `partial` (true when stock covers only part of the need). `unmeasured` lists ingredient lines with no parseable quantity; they are shown but not counted.
- `source` is `confirmed` (stock no planned meal draws on; `locations` lists `fridge` and/or `pantry`) or `projected` (left over after planned meals; `after_meals` lists those meals). For example, half a cabbage left after a planned slaw is a projected remainder that can cover another meal this week or next. `remainders` lists the whole pool (`key`, `item`, `unit`, `amount`, `source`, `locations`, `after_meals`), so a client can tell projected remainders from confirmed stock; the web UI shows them with different badges.

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
`meals.yield_servings`, `meals.prep_minutes`, `meals.cook_minutes`, `meals.make_ahead` and
`week_meals.servings` columns to older databases that lack them. This is idempotent;
existing rows keep `NULL` values, except `meals.make_ahead`, which is `false` (column default 0).

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
