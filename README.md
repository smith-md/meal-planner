# Meal Planner & Shopping Assistant

A personal web application for weekly meal planning, shared grocery list management, and lightweight recipe storage.

## Features

- **Week Planner**: Plan meals for each day of the week with visual day states (Need Meal / No Meal / Neutral)
- **Meal Library**: Create and search meals with tags, notes, and ingredients
- **Shopping List**: Shared shopping list with localStorage persistence
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
- In the Shopping List, checking an item credits it immediately when the quantity and location are known; otherwise an inline panel asks for the amount and fridge/pantry. Unchecking a credited item reverts it, and "Edit" on a purchased row reverts it and reopens the panel. The panel also offers "Mark purchased without adding to inventory". Items already marked purchased before this feature are not credited.
- The shopping list calculation and pairings are not reduced by inventory, and they ignore whether a meal is cooked or skipped.

### Assigning meals to days and cooking

- A planned meal can be assigned to a day with `PUT /week-plans/{id}/meals/{meal_id}/day` (body `{"day_id": 12}`; `null` unassigns) and rescheduled by calling it again. Skip or unskip it with `PUT /week-plans/{id}/meals/{meal_id}/status` (body `{"status": "skipped"}` or `"planned"`). Planning, rescheduling, and skipping never change stock.
- `GET /inventory/availability` reports, per ingredient, `on_hand` (fridge + pantry), `reserved` (needed by planned meals, not skipped or cooked, in weeks that have not ended), and `available` (on hand minus reserved, never below 0). If reservations exceed stock, `short` shows the gap. Reservations are computed on request, not stored. Half a cabbage stays on hand while a planned meal reserves it.
- `POST /week-plans/{id}/meals/{meal_id}/cook` marks a meal cooked and deducts its ingredients, scaled to the servings at that moment (frozen as `cooked_servings`). It requires an assigned day (409 otherwise) and a meal that is not skipped (409). Cooking runs once: repeating the request deducts nothing more and returns the stored result with `replayed: true`.
- Deduction takes from the fridge first, then the pantry. If stock is short, the item is floored at zero (never negative) and the response lists `requested`, `deducted`, and `short` per ingredient; ingredient lines with no parseable quantity are returned as `untracked` and not deducted.
- A cooked meal's day and servings are fixed, and it cannot be removed from the week (409).
- `PUT /inventory/{id}` with `{"quantity": "1 1/2"}` sets a stock row to an absolute quantity in its display unit as a manual correction (`0` empties it; an invalid quantity returns 400, an unknown id 404). It does not touch reservations or cook history.

See `backend/README.md` for endpoint details.

## Future Enhancements

- Grocery store tagging for items
- Voice assistant integration
- AI meal suggestions
- Grocery budget tracker
- User accounts for cross-device syncing

## License

MIT
