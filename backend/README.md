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
- `PATCH /meals/{meal_id}` – partially update `name`, `notes`, `tags`, `ingredients`, `yield_servings`, `prep_minutes`, `cook_minutes` and `make_ahead` (404 if the meal does not exist)
- `PATCH /meals/{meal_id}/details` – partially update `prep_minutes`, `cook_minutes` and `make_ahead` (404 if the meal does not exist)

`yield_servings` is how many servings the recipe's written quantities make.
It is an optional integer from 1 to 99 (`null` means no yield is set).

`prep_minutes` and `cook_minutes` are optional whole numbers of minutes from 0 to 1440
(`null` means not set; 0 is allowed). `make_ahead` is a boolean that defaults to `false`.
They are accepted by `POST /meals` and returned by `GET /meals`. Negative, non-integer
or above-1440 minutes, and a non-boolean or `null` `make_ahead`, return 422.

`PATCH /meals/{meal_id}/details` changes only the fields present in the body: an omitted
field is left as it is (including `yield_servings`), and `null` clears a time. Example
(clears cook time, sets make-ahead):

```json
{ "cook_minutes": null, "make_ahead": true }
```

`PATCH /meals/{meal_id}` works the same way for all of `name`, `notes`, `tags`,
`ingredients`, `yield_servings`, `prep_minutes`, `cook_minutes` and `make_ahead`: only
fields present in the body change, and an empty body `{}` is a no-op that returns the meal.
`name` cannot be blank or `null`, and `make_ahead` cannot be `null` (422 for either).
`null` clears `yield_servings`, `notes`, `tags`, `ingredients`, `prep_minutes` and
`cook_minutes`. A yield-only body such as `{ "yield_servings": null }` behaves as before.
`name` is trimmed. The web UI's meal drawer saves with this endpoint, sending only the
fields that changed.

The Meals Library filters (maximum prep, maximum cook, make-ahead only) run in the
browser over the `GET /meals` result and need no extra endpoint. They combine with the
text search, and meals with an unset time are hidden while that time filter is active.
The "Worth repeating only" filter works the same way: it keeps meals whose
`worth_repeating` is `true` and composes with the other filters and the search.

Each `Meal` in the `GET /meals` result (and in other meal payloads) has a read-only
`worth_repeating`: the mark on that meal's most recently cooked week row (`true`,
`false`), or `null` when that row is unrated or the meal has never been cooked. It
cannot be set through the meal endpoints; use the week-meal endpoint below.

Example `POST /meals` body:

```json
{
  "name": "Chicken Tacos",
  "notes": "Use leftover chicken if available",
  "ingredients": "1/2 lb chicken breast\n8 tortillas",
  "yield_servings": 4
}
```

Example `PATCH /meals/{meal_id}` body (send `null` to clear the yield; other fields are left alone):

```json
{ "yield_servings": 6 }
```

Example changing several fields at once:

```json
{ "name": "Veg chili", "tags": "veg, quick", "notes": null }
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

To plan the meal for a day and meal slot, add `date` (a day of that week) and
`slot` (`breakfast`, `lunch` or `dinner`):

```json
{ "meal_id": 1, "date": "2026-11-17", "slot": "lunch" }
```

- `date` and `slot` must be sent together or not at all, and an unknown slot is rejected (422, "Choose both a day and a meal slot, or neither." for a lone one).
- A `date` that is not a day of that week returns 400 ("Choose a day in this week.").
- A meal can be planned once per week. Posting a placement for a meal that is already planned that week returns 409 ("This meal is already planned this week. Move it instead."); posting it without a placement leaves the plan unchanged.
- Without `date` and `slot` the meal is planned but not on a day.

#### Change planned servings or move a meal

- `PATCH /week-plans/{week_plan_id}/meals/{meal_id}` with a partial body: `{ "servings": 6 }`, `{ "date": "2026-11-18", "slot": "dinner" }`, or both.

`servings` is 1-99 and cannot be `null`. A move needs `date` and `slot` together;
`{ "date": null, "slot": null }` unschedules the meal (it stays planned, with no
day). The body must contain `servings` or a placement, otherwise 422. A date
outside the week returns 400. Returns the updated week plan (including the new
`meal_schedule`), or 404 if the meal is not planned in that week. A cooked meal
cannot be moved ("This meal is already cooked; it cannot be moved.") or have its
servings changed ("This meal is already cooked; its servings are fixed."); both
return 409. Moving never changes stock.

#### Remove a meal from a week

- `DELETE /week-plans/{week_plan_id}/meals/{meal_id}`

Removes that meal from the week and returns the updated week plan.

#### Assign a day, skip, and cook

- `PUT /week-plans/{week_plan_id}/meals/{meal_id}/day` with `{ "day_id": 12 }` assigns the meal to a day of that week (400 if the day is in another week); `null` unassigns. Assigning a day sets the slot to `dinner` when the meal has none (an existing slot is kept); unassigning clears the slot. Returns the week plan, or 404 if the meal is not planned there. 409 if already cooked. To choose the slot, use the PATCH above.
- `PUT /week-plans/{week_plan_id}/meals/{meal_id}/status` with `{ "status": "planned" | "skipped" }`. 409 if already cooked.
- `PUT /week-plans/{week_plan_id}/meals/{meal_id}/worth-repeating` with `{ "worth_repeating": true | false | null }` records feedback on a cooked meal: `true` worth repeating, `false` not worth repeating, `null` clears the mark. It returns the week plan. 409 if the meal is not cooked ("Only a cooked meal can be marked worth repeating."), 404 if the meal is not planned in that week, 422 for a value that is not a boolean or `null`. The mark can be changed or cleared later, and sending the same value again is harmless. It never changes stock, the schedule, servings or status.
- The week plan's `meal_schedule` lists `{ meal_id, day_id, slot, status, cooked_servings, cooked_at, eaten_servings, remaining_servings, reserved_servings, worth_repeating }` per planned meal (`eaten_servings` and `remaining_servings` are `null` until cooked; `reserved_servings` is `0` when nothing is saved); `worth_repeating` is that cooked row's own mark (`null` when unrated or not cooked); `slot` is `breakfast`, `lunch`, `dinner` or `null` (`null` exactly when `day_id` is `null`).
- `POST /week-plans/{week_plan_id}/meals/{meal_id}/cook` marks the meal cooked and deducts ingredients. The body is optional: `{ "servings_made": 6, "servings_eaten": 2 }`. `servings_made` (integer 1-99) defaults to the planned servings and is frozen as `cooked_servings`; `servings_eaten` (integer 0-99, at most servings made) defaults to servings made. Out-of-range values return 422 and servings eaten above servings made returns 400 ("Servings eaten cannot exceed servings made."). Deduction is scaled by servings made only. 409 if no day is assigned or the meal is skipped. It deducts exactly once; repeats ignore any servings sent and return the stored result with `replayed: true`. The result also carries `servings_made` (same as `cooked_servings`), `servings_eaten`, `servings_remaining` (made minus eaten) and `servings_reserved` (portions saved as leftovers), and `worth_repeating` (`null` until the cooked meal is rated).
  - Deduction order: fridge, then pantry. Short stock floors at zero; each `deductions` entry has `item`, `unit`, `requested`, `deducted`, `short`. Unparseable lines are in `untracked`.
  - A cooked meal cannot be re-dated, re-skipped, have its servings changed (PATCH), or be removed (DELETE); these return 409.
- Planning, rescheduling, and skipping never change stock; only cooking does.

#### Leftover reservations

Portions of a cooked meal that were made but not eaten (`servings_remaining`) can be set aside for a later slot in the same week. They are stored in the `leftover_reservations` table, not in `week_meals`, so a meal keeps one planned row per week (adding it again still returns 409; servings, status and move operations still act on that one row). All three endpoints return the updated week plan, whose `leftovers` list holds `{ id, meal_id, meal_name, day_id, slot, portions, source_day_id, source_slot }`.

- `POST /week-plans/{week_plan_id}/meals/{meal_id}/leftovers` with `{ "date": "2026-11-19", "slot": "lunch", "portions": 2 }` – reserve portions (`portions` integer 1-99, default 1; `date` and `slot` required).
- `PATCH /week-plans/{week_plan_id}/leftovers/{leftover_id}` – move (`date` and `slot` together) and/or change `portions`. The body must contain at least one of them; `portions` cannot be `null`.
- `DELETE /week-plans/{week_plan_id}/leftovers/{leftover_id}` – release the reservation; its portions become available again.

Errors:

- 400 if `date` is not a day of that week ("Choose a day in this week.") or the slot is not strictly later than the source meal's day and slot ("Leftovers must go in a later slot than the meal they came from."). Order is by day, then breakfast, lunch, dinner.
- 404 if the meal is not planned in that week, or the reservation is not in that week.
- 409 if the meal is not cooked ("Cook the meal before saving leftovers."), has no day and slot, would reserve more than remains ("Only N portion(s) left to save."; the total across its reservations cannot exceed `servings_remaining`), or already has leftovers in that slot ("These leftovers are already saved for that slot.").
- 422 for an invalid body (unknown slot, `portions` outside 1-99, a lone `date` or `slot`, or an empty PATCH body).

Reservations add no demand: reconcile, the shopping list, pairings, inventory availability and reservations, and stock suggestions never read them and are unchanged, and no endpoint here changes stock. A reserved slot counts as planned in the web UI and satisfies that day's need for a meal. There is no un-cook; release a reservation to free its portions or PATCH it to move it. Portions not used by the end of the week lapse with no error and no automatic action.

#### Inventory

- `GET /inventory` (optional `ref_date`) – stock rows (`id`, `item`, `unit`, `quantity`, `location`, `unit_group`, `added_at`, `low`, `reserved`, `reserved_by`). `added_at` is the ISO UTC time of the latest credit, `null` when unknown; on startup, existing rows are backfilled from their latest non-reverted purchase. `low` is true when the ingredient is a tracked staple at or below its minimum, aggregated across its fridge and pantry rows (the highest minimum applies). `reserved` is the amount of that row reserved by planned meals and `reserved_by` lists them (`meal_id`, `name`, `day`, `amount`). Reservations are split fridge first, then pantry, the same order cooking deducts; a reservation beyond stock is not assigned to any row. Reservations use the same rules as the availability endpoint below (`ref_date` defaults to today).
- `GET /inventory/availability` – per ingredient `unit_group`, `on_hand`, `reserved`, `available`, `short`, and `reserved_by` (week plan, meal, day, and the `amount` that meal reserves). Reservations are computed from planned meals (not skipped or cooked) in weeks ending on or after the optional `ref_date` (default today); nothing is stored.
- `PUT /inventory/{item_id}` with `{ "quantity": "2" }` – manual correction to an absolute quantity in the row's unit (whole numbers, fractions like `1/2` or `1 1/2`, or decimals; `0` empties the row). 400 for an invalid quantity, 404 for an unknown id.
- `POST /inventory/{item_id}/use` with `{ "amount": "1/2" }` – remove up to that amount from a row, never below zero. Returns `{ "item": <row as in GET /inventory>, "removed": "<amount actually removed>" }`. 400 for a non-positive or unreadable amount, 404 for an unknown id, 422 for an empty amount.
- `POST /inventory/{item_id}/return` with `{ "amount": "1/2" }` – add an amount back to a row (the undo of use). Returns `{ "item": <row>, "added": "<amount added>" }`; same errors as use.
- `POST /inventory/purchases` and `DELETE /inventory/purchases/{purchase_id}` credit and revert purchases (see the root `README.md`).

`GET /week-plans/{week_plan_id}/shopping-list` and the pairings do not subtract inventory and ignore cooked/skipped state. For stock-aware figures use the reconcile endpoints below.

#### Staples (minimums)

- `GET /inventory/staples` – every stock row with a minimum (`id`, `item`, `unit`, `location`, `quantity`, `minimum`, `low`), including empty rows. `low` is true when the ingredient's total stock (fridge plus pantry) is at or below its minimum.
- `PUT /inventory/{item_id}/minimum` with `{ "minimum": "2" }` – returns the staple row including `low`. Sets the minimum for that ingredient (it applies across fridge and pantry rows; the other rows' minimums are cleared). `0` is allowed and warns only when the item runs out; `null` clears it. 400 for an invalid value, 404 for an unknown id.

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
- Each suggestion has `meal_id`, `name`, `servings`, `worth_repeating` (the meal's latest cooked mark, `null` when unrated; display only, it does not affect ranking), `coverage_percent`, `covered_count`, `ingredient_count`, `uses`, `groceries`, and `unmeasured`. `uses` entries show the ingredient and quantity used: `key`, `item`, `unit`, `used`, `needed`, `available`, and `source`. `groceries` entries are the additional groceries needed: `key`, `item`, `amount`, `name`, and `partial` (true when stock covers only part of the need). `unmeasured` lists ingredient lines with no parseable quantity; they are shown but not counted.
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
- Each pairing suggestion also carries the meal's `worth_repeating` (latest cooked
  mark, `null` when unrated). It is display only and does not change the suggestions.

#### Database and migration

The database is SQLite at `./meal_planner.db` unless the `DATABASE_URL`
environment variable is set (for example `sqlite:///:memory:` for a throwaway
database). On startup the app runs `create_all` and then adds the
`meals.yield_servings`, `meals.prep_minutes`, `meals.cook_minutes`, `meals.make_ahead` and
`week_meals.servings` columns to older databases that lack them. This is idempotent;
existing rows keep `NULL` values, except `meals.make_ahead`, which is `false` (column default 0).

It also adds the nullable `week_meals.slot` column and backfills it: every planned meal that
has a day but no slot gets `dinner`. Rows that already have a slot, and meals with no day, are
left alone, so running it again changes nothing, and no meal, servings, status or cooked
history is lost.

It also adds the nullable `week_meals.worth_repeating` column (`NULL` unrated, `1` worth
repeating, `0` not worth repeating). Existing rows, including already cooked ones, stay
`NULL` (unrated); nothing is backfilled.

It also adds the nullable `week_meals.eaten_servings` column and creates the
`leftover_reservations` table (`week_meal_id`, `week_plan_id`, `day_id`, `slot`, `portions`,
`created_at`; unique on meal row, day and slot). Meals cooked before the column existed
were eaten in full, so rows with `status = 'cooked'`, a `cooked_servings` value and no
`eaten_servings` get `eaten_servings = cooked_servings`. The backfill is guarded: it only
fills empty values, never overwrites a stored one, and running it again changes nothing.

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
