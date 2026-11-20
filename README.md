# Meal Planner & Shopping Assistant

A personal web application for weekly meal planning, shared grocery list management, and lightweight recipe storage.

## Features

- **Week Planner**: Plan meals for a day and a meal slot (breakfast, lunch, or dinner) with visual day states (Need Meal / No Meal / Neutral); meals not yet on a day are listed separately
- **Cooked portions and leftovers**: When you mark a meal cooked, say how many servings you made and how many you ate now; the rest can be saved as leftovers for a later slot in the same week. A leftover slot counts as planned and adds nothing to the shopping list or stock demand; unused portions just lapse at the end of the week
- **Meal Library**: Create and search meals with tags, notes, and ingredients; optionally record prep time, cook time, and a make-ahead flag, and filter by them
- **Worth repeating feedback**: After you cook a meal, mark it "Worth repeating" or "Not worth repeating" on the week planner (and change or clear the mark later). The latest mark shows as a badge in the library, meal picker, and suggestions, and the library can filter to meals worth repeating. It is only a mark: suggestion ranking is unchanged and there is no cook history view
- **Shopping**: A server-side shopping list that keeps manual items and purchase state, plus a This week / Next week view that compares what the planned meals need with your stock, warns about low staples and shortfalls, and previews list changes before applying them
- **Recipe yields and planned servings**: Each recipe can store how many servings it makes, and each planned meal has its own servings; the shopping list and pairings scale to match
- **Clean UI**: Modern, token-based design with intuitive interactions. A bottom tab bar (below 1024px) or a left rail (1024px and wider) switches between Plan, Meals, Shop, and Kitchen; each page has its own address (`#/plan`, `#/meals`, `#/shop`, `#/kitchen`; `#/plan` is the default), so the browser back button returns to the previous page. The Shop item shows a badge with the number of unchecked list entries (capped at "99+"; its accessible name is for example "Shop, 3 items to buy"), and the Kitchen item shows a dot when a tracked staple is low (accessible name "Kitchen, staples running low")

## Tech Stack

**Backend:**
- FastAPI
- SQLAlchemy
- SQLite
- Python 3.8+

**Frontend:**
- React 18
- Vite
- Modern CSS with design tokens

## Getting Started

### Prerequisites

- Python 3.8+
- Node.js 22.13 or newer (odd-numbered releases 23 and 25 are not supported)
- npm

### Backend Setup

1. Navigate to the backend directory:

   ```
   cd backend
   ```

2. Create and activate a virtual environment, then install dependencies:

   ```
   python -m venv venv
   venv\Scripts\activate        # macOS/Linux: source venv/bin/activate
   pip install -r requirements.txt
   ```

3. Run the server:

   ```
   uvicorn app.main:app --reload
   ```

The API will be available at http://127.0.0.1:8000 (the frontend calls http://localhost:8000).

### Frontend Setup

1. Navigate to the frontend directory:

   ```
   cd frontend
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Run the development server:

   ```
   npm run dev
   ```

The app will be available at http://localhost:5173

To run the front-end tests (Vitest, React Testing Library and jsdom), run `npm test` in the `frontend` directory. It runs the whole suite once and exits (no watch mode). The test tools need Node.js 22.13 or newer (see Prerequisites).

## API Endpoints

- `GET /meals` – Get all meals (optional search parameter)
- `POST /meals` – Create a new meal
- `GET /week-plans/current` – Get current week plan
- `PATCH /week-plans/days/{day_id}` – Update day state
- `POST /week-plans/{week_plan_id}/meals` – Add a meal to a week plan
- `DELETE /week-plans/{week_plan_id}/meals/{meal_id}` – Remove a meal from a week plan

### Prep time, cook time, and make-ahead

- Each meal has an optional `prep_minutes` and `cook_minutes` (whole minutes, 0-1440; `null` means not set) and a `make_ahead` flag (default `false`). They can be set in the meal drawer (see "Editing meals in the meal drawer" below) and are saved with `PATCH /meals/{id}`; `PATCH /meals/{id}/details` still works for these three fields (see `backend/README.md`).
- The Meals Library can filter by a maximum prep time, a maximum cook time, and make-ahead only. Filters combine with each other and with the text search; "Clear filters" resets them. Meals with no prep (or cook) time set are hidden while that time filter is active. Filtering happens in the browser.
- A "Worth repeating only" checkbox in the same filter row keeps meals whose latest cooked mark is "Worth repeating"; it combines with the other filters and the search, and "Clear filters" resets it. Meals that are unrated or marked "Not worth repeating" are hidden while it is on.

### Editing meals in the meal drawer

- Meals are created and edited in a right-side meal drawer (a full-height sheet on phones). Open it with the Edit button on a meal card, or with New meal. It replaces the inline new-meal form and the quick editors on the meal card. The drawer edits the name, tags, notes, ingredients, yield, prep and cook time, and make-ahead flag, and saves only the fields you changed.
- For a new meal the drawer has a "Paste a link" panel: paste a recipe link and choose "Fill from link" to fill the form, then review it and save. Photo import is not available yet.
- In the meal picker, "Create New Meal" opens the drawer pre-filled with the text typed in the search box.
- Saving an existing meal uses `PATCH /meals/{id}` with a partial body (see `backend/README.md`).

### Yields and planned servings

- A recipe's `yield_servings` (whole number 1-99, optional) is set when creating the meal or with `PATCH /meals/{id}` (body `{"yield_servings": 4}`; `null` clears it). The same endpoint also updates name, notes, tags, ingredients, and the times and make-ahead flag.
- A planned meal's servings are set with `servings` in the `POST /week-plans/{id}/meals` body (defaults to the recipe yield) and changed with `PATCH /week-plans/{id}/meals/{meal_id}` (body `{"servings": 6}`; the same endpoint also moves the meal, see "Assigning meals to days and cooking").
- Ingredient quantities are scaled by `servings / yield` before the shopping list and pairings are calculated. Fractions and compatible units are combined.
- If a recipe has no yield, quantities are used as written (factor 1) and the UI shows a note. Ingredient lines whose quantity cannot be parsed are not scaled and are listed separately, with a note when the recipe would otherwise be scaled.
- Each pairing row has `needs_more` and `shortfall`; changing servings recalculates the remaining amount and flags a pairing that now needs more.
- Set `DATABASE_URL` to override the default SQLite file (`sqlite:///./meal_planner.db`). On startup the backend adds the `meals.yield_servings`, `meals.prep_minutes`, `meals.cook_minutes`, `meals.make_ahead` and `week_meals.servings` columns to existing databases. It also adds `week_meals.slot` and sets the slot to `dinner` for every planned meal that already has a day and no slot, so existing day assignments keep working; meals, servings, status and cooked history are not changed, and running it again changes nothing.
- Startup also adds the nullable `week_meals.worth_repeating` column. Existing rows, including already cooked meals, stay unrated (`NULL`); nothing is backfilled.
- Startup also adds the nullable `week_meals.eaten_servings` column and creates the `leftover_reservations` table. Meals cooked before this existed get `eaten_servings` set to their `cooked_servings` (they were eaten in full, so no leftovers). The backfill only fills empty values, so running it again changes nothing.
- Backend tests: from `backend/`, run `pip install -r requirements-dev.txt` then `pytest`.

### Fridge and pantry inventory

- The backend keeps a running fridge/pantry inventory in SQLite (tables `inventory_items` and `inventory_purchases`, created at startup). It is global, not tied to any week, so it survives clearing the shopping list and opening new weeks.
- `GET /inventory` (optional `ref_date`) lists stock as `{id, item, unit, quantity, location, unit_group, added_at, low, reserved, reserved_by}` (location is `fridge` or `pantry`). Compatible units are combined; separate unit groups (for example cups vs. whole onions) stay separate rows. `added_at` is the ISO UTC time of the row's latest credit, or `null` when unknown; on startup, existing rows without one are filled from their latest non-reverted purchase. `low` is true when the ingredient is a tracked staple at or below its minimum, counted across fridge and pantry together. `reserved` is the amount planned meals (not skipped or cooked, in weeks that have not ended before `ref_date`, default today) reserve from that row, and `reserved_by` lists them as `{meal_id, name, day, amount}`. Reservations are split fridge first, then pantry (the order cooking deducts); a reservation beyond stock is not assigned to any row.
- `POST /inventory/{id}/use` with `{"amount": "1/2"}` removes up to that amount from a row, never below zero, and returns `{item, removed}` (`item` is the updated row; `removed` is what was actually taken). A non-positive or unreadable amount returns 400, an unknown id 404, and an empty amount 422. `POST /inventory/{id}/return` with the same body adds the amount back and returns `{item, added}`; the Kitchen page's Undo uses it.
- `POST /inventory/purchases` with `{"purchase_id", "amount", "location"}` credits an amount such as `"2 cups rice"`. `purchase_id` is a client-generated, single-use id (8-64 characters): repeating a request with the same id never credits again. An amount without a leading quantity returns 400; a missing or invalid location returns 422.
- `DELETE /inventory/purchases/{purchase_id}` reverts that credit (never below zero). A reverted id cannot be credited again.
- Kitchen page (`#/kitchen`): Fridge and Pantry share one page with a segmented control; the choice is kept in the address (`#/kitchen?tab=fridge` or `?tab=pantry`, default fridge). Staples that are low or out are listed first under "Running low". Each row shows the quantity (click it to edit the count), its location, the Added date (the last credit), status pills (Low or Out, and "Reserved for <meal>", or "Reserved for N meals"), and a line such as "1 head on hand, 1/2 head reserved for Slaw (Tue)". The Adjust control offers "Use some" (an amount, via `POST /inventory/{id}/use`), "Used up" (sets the quantity to 0), and "Correct count" (edits the quantity). Use some and Used up show a toast with Undo.
- On the Shopping screen, checking a list entry credits stock immediately only when its amount is known and the item is stocked in exactly one place; a toast offers Undo, and the bought row reads "Added X to Fridge" or "Added X to Pantry" with Edit and Undo buttons. Otherwise the item waits in a "Put away groceries (N)" inline panel, where each item goes to Fridge, Pantry, or Keep on list, with a quantity field (a number with an optional known unit; the item name is fixed). Keep on list leaves the item checked but not added to stock, and is remembered for the browser session only. Unchecking a credited entry reverts it, and Edit on a bought row reverts the credit and credits the corrected amount. Items already marked purchased before this feature are not credited.
- `GET /week-plans/{id}/shopping-list` and the pairings calculation are unchanged: they are not reduced by inventory, and they ignore whether a meal is cooked or skipped. Stock-aware figures come from the reconcile endpoints below.

### Assigning meals to days and cooking

- A planned meal has an optional day and meal slot (`breakfast`, `lunch`, or `dinner`); a slot always comes with a day. `POST /week-plans/{id}/meals` accepts an optional `date` (a day of that week, for example `"2026-11-17"`) and `slot` together (`{"meal_id": 3, "date": "2026-11-17", "slot": "lunch"}`); send both or neither (422 otherwise, and 422 for an unknown slot). A date outside the week returns 400. A meal can be planned once per week: posting a placement for a meal already planned that week returns 409 ("This meal is already planned this week. Move it instead."), while posting it without a placement changes nothing. The week's `meal_schedule` entries include `slot` next to `day_id`.
- To move a meal, use `PATCH /week-plans/{id}/meals/{meal_id}` with `{"date": "2026-11-18", "slot": "dinner"}`; `{"date": null, "slot": null}` takes it off its day. The body may also include `servings`, and it must include at least one of `servings` or `date` and `slot` (422 otherwise). It returns the updated week, or 404 if the meal is not planned in that week.
- The older `PUT /week-plans/{id}/meals/{meal_id}/day` (body `{"day_id": 12}`; `null` unassigns) still works: assigning a day gives the meal the `dinner` slot when it has none (an existing slot is kept), and unassigning clears the slot. Skip or unskip it with `PUT /week-plans/{id}/meals/{meal_id}/status` (body `{"status": "skipped"}` or `"planned"`). Planning, rescheduling, and skipping never change stock.
- `GET /inventory/availability` reports, per ingredient, `on_hand` (fridge + pantry), `reserved` (needed by planned meals, not skipped or cooked, in weeks that have not ended), and `available` (on hand minus reserved, never below 0). If reservations exceed stock, `short` shows the gap. Reservations are computed on request, not stored. Half a cabbage stays on hand while a planned meal reserves it.
- `POST /week-plans/{id}/meals/{meal_id}/cook` marks a meal cooked and deducts its ingredients. The body is optional: `{"servings_made": 6, "servings_eaten": 2}`. `servings_made` (whole number 1-99) defaults to the planned servings and is frozen as `cooked_servings`; `servings_eaten` (0 up to servings made) defaults to servings made, so cooking with no body behaves as before and leaves nothing over. Servings eaten above servings made returns 400, and out-of-range values 422. Deduction is scaled by servings made, not by servings eaten. The result and the week's `meal_schedule` entries show `servings_made`, `servings_eaten`, `servings_remaining` (made minus eaten) and `servings_reserved`. Cooking requires an assigned day (409 otherwise) and a meal that is not skipped (409). Cooking runs once: repeating the request deducts nothing more, ignores any servings sent, and returns the stored result with `replayed: true`.
- Deduction takes from the fridge first, then the pantry. If stock is short, the item is floored at zero (never negative) and the response lists `requested`, `deducted`, and `short` per ingredient; ingredient lines with no parseable quantity are returned as `untracked` and not deducted.
- A cooked meal's day, slot and servings are fixed, and it cannot be removed from the week (409). Moving it returns 409 ("This meal is already cooked; it cannot be moved.").
- Leftovers: the remaining portions of a cooked meal can be saved for a later slot in the same week. `POST /week-plans/{id}/meals/{meal_id}/leftovers` with `{"date": "2026-11-19", "slot": "lunch", "portions": 2}` (`portions` 1-99, default 1) saves them and returns the updated week. `PATCH /week-plans/{id}/leftovers/{leftover_id}` moves a reservation (`date` and `slot` together) and/or changes `portions`, and `DELETE /week-plans/{id}/leftovers/{leftover_id}` releases it; both return the updated week. The week's `leftovers` list has `{id, meal_id, meal_name, day_id, slot, portions, source_day_id, source_slot}`.
  - The slot must be strictly later than the cooked meal's day and slot (day order, then breakfast, lunch, dinner) and a day of the same week: otherwise 400 ("Leftovers must go in a later slot than the meal they came from." or "Choose a day in this week."). Total reserved cannot exceed the remaining portions (409, for example "Only 1 portion(s) left to save."). Other errors: 409 if the meal is not cooked or has no day and slot, 409 if the same meal already has leftovers in that slot, 404 for an unknown meal or reservation in that week, 422 for an invalid body.
  - A reservation is stored in its own table, so a meal still has exactly one planned row per week: adding the same meal again still returns 409, and servings, status and move operations are unchanged. A reserved slot shows as a leftover card, counts as planned, and satisfies that day's need for a meal. Reservations add no ingredient demand, grocery entry, stock reservation or stock suggestion, and never change stock: reconcile, the shopping list and availability give the same result with or without them.
  - Portions not used by the end of the week simply lapse: there is no error and nothing happens automatically. There is no un-cook; release a reservation to make its portions available again.
- Cook sheet and leftovers on the Plan page: a meal's "Mark cooked" button opens a "Mark cooked" sheet asking for "Servings made" (default the planned servings) and "Eaten now" (default all of them), with a note of how many portions are left over. The cooked card shows "Made 6 · ate 2 · 4 left" (plus "· N saved" once some are reserved). While portions remain unreserved the card has a "Save leftovers" button that opens a sheet to choose a later day, the meal slot and the number of portions. A reserved slot shows a dashed "Leftovers: <meal>" card naming the source meal, with Move and Release buttons, and counts toward slots planned. The sheets and buttons use the same touch-sized controls as the rest of the page and are meant for phone widths.
- Plan page: below 1100px it shows a day strip and the selected day's agenda; at 1100px and wider it shows all seven days as a grid. Each day lists its meals under Breakfast, Lunch, and Dinner, each slot has an add button that opens the meal picker for that day and slot, and "+ Add meal to week" adds a meal with no day. Meals with no day appear in "Planned, not on a day yet". Each meal's Move button (or "Choose day for" when it has no day) opens a sheet to pick a day and slot, or "Not on a day yet". It works by keyboard and touch, closes with Escape, and shows an error inside the sheet if the move fails.
- Worth repeating feedback: `PUT /week-plans/{id}/meals/{meal_id}/worth-repeating` with `{"worth_repeating": true}`, `false`, or `null` (clears the mark) records whether a cooked meal was worth repeating. It works on cooked meals only (409 otherwise), returns 404 if the meal is not planned in that week, can be changed or cleared, is harmless to repeat, and never changes stock. The mark belongs to that cook (the week's meal), and `worth_repeating` appears on the week's `meal_schedule` entries, the cook result, stock suggestions, and pairing suggestions. On a `Meal` it is the mark on the most recently cooked row, `null` when unrated. On the Plan page a cooked meal shows a "Worth repeating feedback" control (Not rated / Worth repeating / Not worth repeating) and a badge once rated; the badge also appears on meals in the library, meal picker, and suggestions. Unrated meals show no badge. It does not change suggestion ranking, and there is no history view of past marks. See `backend/README.md`.
- `PUT /inventory/{id}` with `{"quantity": "1 1/2"}` sets a stock row to an absolute quantity in its display unit as a manual correction (`0` empties it; an invalid quantity returns 400, an unknown id 404). It does not touch reservations or cook history.

### Shopping list, staples, and reconcile

- The shopping list is stored on the server (table `grocery_entries`), not only in the browser. Each entry has a stable `entry_key`, so repeating a create or import never duplicates it. Entries come from `manual:` or `added:` keys (typed by you, or "Add to shopping list" on a need card), `plan:` keys (created by Review changes), or `legacy:` keys (migrated from the browser).
- `GET /grocery-entries` lists entries; `POST /grocery-entries` creates one; `PATCH /grocery-entries/{id}` records `purchased` and the stock `credit`; `DELETE /grocery-entries/{id}` removes one; `DELETE /grocery-entries?purchased=true` clears purchased entries (any other call returns 400). `POST /grocery-entries/undo` restores the previous state from an undo payload.
- Migration: on first load the Shopping screen sends any browser `shoppingList` localStorage items to `POST /grocery-entries/import-local` (idempotent per old item id; purchase state and credits are kept and nothing is credited again). On success the old value is copied to `shoppingList.migrated` and `shoppingList` is removed; on failure the items stay in the browser and a Retry button is shown.
- Staples: `PUT /inventory/{id}/minimum` with `{"minimum": "2"}` sets the minimum to keep on hand for that ingredient (`0` warns only when it runs out; `null` clears it; an invalid value returns 400, an unknown id 404). `GET /inventory/staples` lists every stock row that has a minimum, including empty ones.
- `GET /week-plans/{id}/reconcile` (optional `ref_date`) previews one week without writing anything; `POST /week-plans/{id}/reconcile` with `{"fingerprint": "..."}` applies exactly the previewed changes. Only this week or a later week can be reconciled (400 otherwise).
- Stock is allocated week by week: weeks from the current one up to the selected week take what they need from the shared stock first, so the same stock never covers two weeks. Each ingredient row reports `demand`, `on_hand`, `held_for_earlier_weeks`, `available`, `to_buy`, and the meals that need it. Only planned meals count as demand (not skipped or cooked); inventory is the only stock source.
- Warnings: `below_minimum` when stock is at or below the minimum, and `short` when demand is above the stock available to that week. Staples with a minimum that no planned meal uses are listed separately in `staples`.
- `changes` lists `add`, `update` (`from_quantity` to `to_quantity`), and `remove` for this week's `plan:` entries. Each item has a `kind`: `plan` for a line that covers planned demand, `restock` for a staple topped up to its minimum. Purchased entries are never changed or removed, and an unpurchased manual, added, or legacy entry for the same ingredient counts as covering it, so no plan entry is added.
- Restock lines: a staple whose total stock is at or below its minimum (the `below_minimum` condition) gets a separate restock line in Review changes, in addition to any plan line for planned demand. The amount is what brings the stock left after this week's demand back up to the minimum (rounded up to whole packages when the ingredient has a package size), so demand plus minimum minus stock is bought once. A minimum of `0` never creates a line. The line has the key `plan:{week}:+restock:{item}:{unit_group}`, the note `Restock to minimum`, and is labelled "Restock" in Review changes and on the list; repeating a preview or apply changes nothing. Earlier weeks' restock top-ups count as available to later weeks, so the same shortfall is not restocked twice (`available` can then be higher than `on_hand`). An unpurchased manual, added, or legacy entry for the item suppresses the restock and is never changed. An unpurchased restock line is updated or removed by a later Review changes once the shortfall changes or the staple is back above its minimum; a purchased one is kept and counts as already restocked.
- Apply returns 409 if the previewed changes are no longer the current ones, for example because the plan, list, or stock changed (nothing is written). A successful apply returns `entries`, a fresh `reconcile`, a `summary` of counts, and an `undo` payload (`null` when a change list exceeds 500 entries) for `POST /grocery-entries/undo`.
- Package sizes: `PUT /package-sizes` saves the typical package size of an ingredient (table `package_sizes`, created at startup; global, keyed by ingredient and unit group, and it does not need any stock). Body: `{"item": "crushed tomatoes", "unit_group": "weight", "size": "28 oz", "label": "can"}`. It returns `{item, unit_group, size, label}`; saving again for the same item and group overwrites. `GET /package-sizes` lists all saved sizes.
  - `unit_group` must be `weight` or `volume`; anything else (`count`, `clove`, `bunch`, `head`, `can`, `bag`, `package`, ...) returns 400, so produce sold by count and ingredients already measured in cans, packages, or bags are not eligible.
  - `size` is a number (whole, decimal, or fraction such as `1 1/2`) followed by a unit, at most 20 characters, for example `28 oz` or `1 lb` for weight and `1 qt` or `16 fl oz` for volume. The unit is required and must belong to the chosen group (`28`, `lots`, `0 oz`, or `2 cups` as a weight returns 400). `size: null` (or blank) deletes the saved size and returns `null`.
  - `label` is optional (the container word, at most 20 characters; it cannot contain brackets, commas, or semicolons, otherwise 400). Without it the label is `package`. Over-long fields return 422.
- Packages in reconcile: each ingredient row now has `unit_group` and `package_eligible`, plus `package` (`null` when no size is saved or the row is not eligible) with `{size, label, packages, buy, remainder}`. `packages` is the whole number of packages needed to cover `to_buy` (0 when stock covers it), `buy` is the total of those packages, and `remainder` is what is projected to be left over after cooking (`buy` minus `to_buy`). For example, with 20 oz needed, 4 oz on hand and a 28 oz can, `to_buy` is 16 ounces and `package` is `{"size": "28 oz", "label": "can", "packages": 1, "buy": "28 ounces", "remainder": "12 ounces"}`.
- The full package amount is what goes on the list: the `plan:` entry for such an ingredient holds the full package amount and the package count, for example `28 ounces of crushed tomatoes (1 can)`, instead of the 16 ounces shortfall. Checking that entry off credits the full 28 ounces to stock, so the remainder stays on hand for later meals. Changing or removing a size or label updates the entry on the next Review changes; applying an older preview returns 409.
- Shopping screen: a This week / Next week selector, then "Review changes" (opens a sheet listing adds, updates, and removals to apply or cancel), need cards showing Need / On hand / Still to buy with warning badges and an "Add ... to shopping list" button (ingredients already on the list show "On list", and ones fully covered by stock are grouped under "Covered by stock"), a Staples section with "Set minimum", the checklist for all weeks, and an Undo snackbar after removing an entry or applying changes. Eligible need cards also have "Set package size" ("Change package size" once one is saved): enter the size and an optional container, or "Remove size". Once a size is saved the card shows Buy (for example "1 can (28 ounces)") and "Left after cooking", and the button reads "Add 1 can to shopping list".

### Meal suggestions from stock

- `GET /week-plans/{id}/stock-suggestions` (optional `ref_date`) ranks your saved meals by how much of the stock you already have they would use. It writes nothing. An unknown week returns 404, and a week before the current one returns 400. Meals already in the target week are never suggested, and meals that use none of your stock are left out. At most 10 suggestions are returned.
- What counts as stock: confirmed fridge and pantry inventory, minus what planned meals (not skipped or cooked) need from the current week through the target week, earlier weeks first (the same allocation as reconcile). What is left is the pool. Unbought purchase leftovers and the manual pairing leftovers are not counted, and items match only when the item and unit group are the same.
- Projected remainders: stock that a planned meal will leave over counts too. For example, if a planned slaw uses half a cabbage from a whole one, the other half is a projected remainder and can cover another meal this week or next. Stock that no planned meal draws on stays a confirmed remainder.
- Ranking: highest average per-ingredient coverage from stock first, then fewest groceries to buy, then more projected uses, then name. Each suggestion is evaluated against the same pool on its own, so suggestions do not compete with each other.
- Each suggestion returns `coverage_percent`, `covered_count`, `ingredient_count`, and three lists. `uses` shows the ingredient and quantity used (`used`, `needed`, `available`) with a `source` of `confirmed` (with `locations`, fridge and/or pantry) or `projected` (with `after_meals`, the planned meals it is left over after). `groceries` lists what else is needed (`amount`, `name`, and `partial` when stock covers only part of it). `unmeasured` lists ingredient lines with no parseable quantity; they are shown but not counted. The response also has `remainders`, the whole pool with the same `source`, `locations`, and `after_meals` fields.
- Week planner screen: a "Cook from what you have" panel lists each suggestion with "From stock" (quantity and ingredient), "Also buy", and an "Add to this week" / "Add to next week" button (for a later week the button reads "Add to this planned week"). Each stock line has a badge: "In fridge" or "In pantry" for confirmed stock, or "Projected: left after <meal>" for a remainder that depends on a planned meal, so you can tell what is on your shelf now from what only exists once an earlier meal is cooked.

See `backend/README.md` for endpoint details.

## Future Enhancements

- Grocery store tagging for items
- Voice assistant integration
- AI meal suggestions
- Grocery budget tracker
- User accounts for cross-device syncing

## License

MIT
