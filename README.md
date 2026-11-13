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

See `backend/README.md` for endpoint details.

## Future Enhancements

- Grocery store tagging for items
- Voice assistant integration
- AI meal suggestions
- Grocery budget tracker
- User accounts for cross-device syncing

## License

MIT
