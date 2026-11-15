# Meal Planner & Shopping Assistant

A personal web application for weekly meal planning, shared grocery list management, and lightweight recipe storage.

## Features

- **Week Planner**: Plan meals for each day of the week with visual day states (Need Meal / No Meal / Neutral)
- **Meal Library**: Create and search meals with tags, notes, and ingredients
- **Shopping**: A server-side shopping list that keeps manual items and purchase state, plus a This week / Next week view that compares what the planned meals need with your stock, warns about low staples and shortfalls, and previews list changes before applying them
- **Recipe yields and planned servings**: Each recipe can store how many servings it makes, and each planned meal has its own servings; the shopping list and pairings scale to match
- **Clean UI**: Modern design with light gradients and intuitive interactions

## Tech Stack

**Backend:**
- FastAPI
- SQLAlchemy
- SQLite
- Python 3.8+

**Frontend:**
- React 18
- Vite
- Modern CSS with gradients

## Getting Started

### Prerequisites

- Python 3.8+
- Node.js 16+
- npm

### Backend Setup

1. Navigate to the backend directory:
   

2. Install dependencies:
   

3. Run the server:
   

The API will be available at 

### Frontend Setup

1. Navigate to the frontend directory:
   

2. Install dependencies:
   

3. Run the development server:
   

The app will be available at 

## API Endpoints

-  - Get all meals (optional search parameter)
-  - Create a new meal
-  - Get current week plan
-  - Update day state
-  - Add meal to day
-  - Remove meal from day

### Yields and planned servings

- A recipe's `yield_servings` (whole number 1-99, optional) is set when creating the meal or with `PATCH /meals/{id}` (body `{"yield_servings": 4}`; `null` clears it).
- A planned meal's servings are set with `servings` in the `POST /week-plans/{id}/meals` body (defaults to the recipe yield) and changed with `PATCH /week-plans/{id}/meals/{meal_id}` (body `{"servings": 6}`).
- Ingredient quantities are scaled by `servings / yield` before the shopping list and pairings are calculated. Fractions and compatible units are combined.
- If a recipe has no yield, quantities are used as written (factor 1) and the UI shows a note. Ingredient lines whose quantity cannot be parsed are not scaled and are listed separately, with a note when the recipe would otherwise be scaled.
- Each pairing row has `needs_more` and `shortfall`; changing servings recalculates the remaining amount and flags a pairing that now needs more.
- Set `DATABASE_URL` to override the default SQLite file (`sqlite:///./meal_planner.db`). On startup the backend adds the `meals.yield_servings` and `week_meals.servings` columns to existing databases.
- Backend tests: from `backend/`, run `pip install -r requirements-dev.txt` then `pytest`.

### Fridge and pantry inventory

- The backend keeps a running fridge/pantry inventory in SQLite (tables `inventory_items` and `inventory_purchases`, created at startup). It is global, not tied to any week, so it survives clearing the shopping list and opening new weeks.
- `GET /inventory` lists stock as `{id, item, unit, quantity, location}` (location is `fridge` or `pantry`). Compatible units are combined; separate unit groups (for example cups vs. whole onions) stay separate rows.
- `POST /inventory/purchases` with `{"purchase_id", "amount", "location"}` credits an amount such as `"2 cups rice"`. `purchase_id` is a client-generated, single-use id (8-64 characters): repeating a request with the same id never credits again. An amount without a leading quantity returns 400; a missing or invalid location returns 422.
- `DELETE /inventory/purchases/{purchase_id}` reverts that credit (never below zero). A reverted id cannot be credited again.
- On the Shopping screen, checking a list entry credits it immediately when the quantity and location are known (the location is known when the item is stocked in exactly one place); otherwise an inline panel asks for the amount and fridge/pantry. Unchecking a credited entry reverts it, and "Edit" on a purchased row reverts it and reopens the panel. The panel also offers "Mark purchased without adding to inventory". Items already marked purchased before this feature are not credited.
- `GET /week-plans/{id}/shopping-list` and the pairings calculation are unchanged: they are not reduced by inventory, and they ignore whether a meal is cooked or skipped. Stock-aware figures come from the reconcile endpoints below.

### Assigning meals to days and cooking

- A planned meal can be assigned to a day with `PUT /week-plans/{id}/meals/{meal_id}/day` (body `{"day_id": 12}`; `null` unassigns) and rescheduled by calling it again. Skip or unskip it with `PUT /week-plans/{id}/meals/{meal_id}/status` (body `{"status": "skipped"}` or `"planned"`). Planning, rescheduling, and skipping never change stock.
- `GET /inventory/availability` reports, per ingredient, `on_hand` (fridge + pantry), `reserved` (needed by planned meals, not skipped or cooked, in weeks that have not ended), and `available` (on hand minus reserved, never below 0). If reservations exceed stock, `short` shows the gap. Reservations are computed on request, not stored. Half a cabbage stays on hand while a planned meal reserves it.
- `POST /week-plans/{id}/meals/{meal_id}/cook` marks a meal cooked and deducts its ingredients, scaled to the servings at that moment (frozen as `cooked_servings`). It requires an assigned day (409 otherwise) and a meal that is not skipped (409). Cooking runs once: repeating the request deducts nothing more and returns the stored result with `replayed: true`.
- Deduction takes from the fridge first, then the pantry. If stock is short, the item is floored at zero (never negative) and the response lists `requested`, `deducted`, and `short` per ingredient; ingredient lines with no parseable quantity are returned as `untracked` and not deducted.
- A cooked meal's day and servings are fixed, and it cannot be removed from the week (409).
- `PUT /inventory/{id}` with `{"quantity": "1 1/2"}` sets a stock row to an absolute quantity in its display unit as a manual correction (`0` empties it; an invalid quantity returns 400, an unknown id 404). It does not touch reservations or cook history.

### Shopping list, staples, and reconcile

- The shopping list is stored on the server (table `grocery_entries`), not only in the browser. Each entry has a stable `entry_key`, so repeating a create or import never duplicates it. Entries come from `manual:` or `added:` keys (typed by you, or "Add to shopping list" on a need card), `plan:` keys (created by Review changes), or `legacy:` keys (migrated from the browser).
- `GET /grocery-entries` lists entries; `POST /grocery-entries` creates one; `PATCH /grocery-entries/{id}` records `purchased` and the stock `credit`; `DELETE /grocery-entries/{id}` removes one; `DELETE /grocery-entries?purchased=true` clears purchased entries (any other call returns 400). `POST /grocery-entries/undo` restores the previous state from an undo payload.
- Migration: on first load the Shopping screen sends any browser `shoppingList` localStorage items to `POST /grocery-entries/import-local` (idempotent per old item id; purchase state and credits are kept and nothing is credited again). On success the old value is copied to `shoppingList.migrated` and `shoppingList` is removed; on failure the items stay in the browser and a Retry button is shown.
- Staples: `PUT /inventory/{id}/minimum` with `{"minimum": "2"}` sets the minimum to keep on hand for that ingredient (`0` warns only when it runs out; `null` clears it; an invalid value returns 400, an unknown id 404). `GET /inventory/staples` lists every stock row that has a minimum, including empty ones.
- `GET /week-plans/{id}/reconcile` (optional `ref_date`) previews one week without writing anything; `POST /week-plans/{id}/reconcile` with `{"fingerprint": "..."}` applies exactly the previewed changes. Only this week or a later week can be reconciled (400 otherwise).
- Stock is allocated week by week: weeks from the current one up to the selected week take what they need from the shared stock first, so the same stock never covers two weeks. Each ingredient row reports `demand`, `on_hand`, `held_for_earlier_weeks`, `available`, `to_buy`, and the meals that need it. Only planned meals count as demand (not skipped or cooked); inventory is the only stock source.
- Warnings: `below_minimum` when stock is at or below the minimum, and `short` when demand is above the stock available to that week. Staples with a minimum that no planned meal uses are listed separately in `staples`.
- `changes` lists `add`, `update` (`from_quantity` to `to_quantity`), and `remove` for this week's `plan:` entries. Purchased entries are never changed or removed, and an unpurchased manual, added, or legacy entry for the same ingredient counts as covering it, so no plan entry is added.
- Apply returns 409 if the previewed changes are no longer the current ones, for example because the plan, list, or stock changed (nothing is written). A successful apply returns `entries`, a fresh `reconcile`, a `summary` of counts, and an `undo` payload (`null` when a change list exceeds 500 entries) for `POST /grocery-entries/undo`.
- Shopping screen: a This week / Next week selector, then "Review changes" (opens a sheet listing adds, updates, and removals to apply or cancel), need cards showing Need / On hand / Still to buy with warning badges and an "Add ... to shopping list" button (ingredients already on the list show "On list", and ones fully covered by stock are grouped under "Covered by stock"), a Staples section with "Set minimum", the checklist for all weeks, and an Undo snackbar after removing an entry or applying changes.

See `backend/README.md` for endpoint details.

## Future Enhancements

- Grocery store tagging for items
- Voice assistant integration
- AI meal suggestions
- Grocery budget tracker
- User accounts for cross-device syncing

## License

MIT
