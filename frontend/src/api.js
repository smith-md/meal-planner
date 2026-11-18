const API_BASE_URL = 'http://localhost:8000';

export async function fetchMeals(search = '') {
  const url = search 
    ? `${API_BASE_URL}/meals?search=${encodeURIComponent(search)}`
    : `${API_BASE_URL}/meals`;
  const response = await fetch(url);
  return response.json();
}

export async function createMeal(mealData) {
  const response = await fetch(`${API_BASE_URL}/meals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mealData)
  });
  return response.json();
}

export async function getCurrentWeekPlan(date) {
  const query = date ? `?ref_date=${encodeURIComponent(date)}` : '';
  const response = await fetch(`${API_BASE_URL}/week-plans/current${query}`);
  if (!response.ok) throw new Error('Could not load the week plan.');
  return response.json();
}

export async function updateDayState(dayId, state) {
  const response = await fetch(`${API_BASE_URL}/week-plans/days/${dayId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state })
  });
  return response.json();
}

// servings and placement are optional. placement is { date, slot } (slot: breakfast, lunch or dinner);
// without it the meal is planned for the week but not placed on a day. Errors carry the server message.
export function addMealToWeek(weekPlanId, mealId, servings, placement) {
  const body = { meal_id: mealId };
  if (servings !== undefined && servings !== null) body.servings = servings;
  if (placement && placement.date && placement.slot) {
    body.date = placement.date;
    body.slot = placement.slot;
  }
  return request(`${API_BASE_URL}/week-plans/${weekPlanId}/meals`, jsonOptions('POST', body),
    'Could not add the meal.');
}

// Moves a planned meal to { date, slot }; { date: null, slot: null } takes it off its day.
export function moveWeekMeal(weekPlanId, mealId, { date, slot }) {
  return request(`${API_BASE_URL}/week-plans/${weekPlanId}/meals/${mealId}`,
    jsonOptions('PATCH', { date: date ?? null, slot: slot ?? null }), 'Could not move the meal.');
}

async function failureMessage(response, fallback) {
  try {
    const result = await response.json();
    if (typeof result.detail === 'string') return result.detail;
  } catch (error) {
    // fall through to the generic message
  }
  return fallback;
}

export async function updateWeekMealServings(weekPlanId, mealId, servings) {
  const response = await fetch(`${API_BASE_URL}/week-plans/${weekPlanId}/meals/${mealId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ servings })
  });
  if (!response.ok) throw new Error(await failureMessage(response, 'Servings must be a whole number from 1 to 99.'));
  return response.json();
}

async function putJson(url, body, fallback, method = 'PUT') {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
  return response.json();
}

export function setWeekMealDay(weekPlanId, mealId, dayId) {
  return putJson(`${API_BASE_URL}/week-plans/${weekPlanId}/meals/${mealId}/day`,
    { day_id: dayId }, 'Could not change the day.');
}

export function setWeekMealStatus(weekPlanId, mealId, status) {
  return putJson(`${API_BASE_URL}/week-plans/${weekPlanId}/meals/${mealId}/status`,
    { status }, 'Could not change the meal status.');
}

// value: true (worth repeating), false (not worth repeating) or null (clear the mark). Cooked meals only.
export function setWeekMealWorthRepeating(weekPlanId, mealId, value) {
  return putJson(`${API_BASE_URL}/week-plans/${weekPlanId}/meals/${mealId}/worth-repeating`,
    { worth_repeating: value }, 'Could not save that feedback.');
}

// servingsMade is 1..99; servingsEaten is 0..servingsMade. Omitted values use the server defaults.
export async function cookWeekMeal(weekPlanId, mealId, { servingsMade, servingsEaten } = {}) {
  const body = {};
  if (servingsMade != null) body.servings_made = servingsMade;
  if (servingsEaten != null) body.servings_eaten = servingsEaten;
  const response = await fetch(`${API_BASE_URL}/week-plans/${weekPlanId}/meals/${mealId}/cook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await failureMessage(response, 'Could not mark the meal cooked.'));
  return response.json();
}

// Leftover reservations: portions of a cooked meal saved for a later slot in the same week.
// Each returns the updated week plan.
export function reserveLeftover(weekPlanId, mealId, { date, slot, portions }) {
  return request(`${API_BASE_URL}/week-plans/${weekPlanId}/meals/${mealId}/leftovers`,
    jsonOptions('POST', { date, slot, portions }), 'Could not save the leftovers.');
}

// changes: { date, slot } to move and/or { portions } to resize.
export function updateLeftover(weekPlanId, leftoverId, changes) {
  return request(`${API_BASE_URL}/week-plans/${weekPlanId}/leftovers/${leftoverId}`,
    jsonOptions('PATCH', changes), 'Could not change the leftovers.');
}

export function releaseLeftover(weekPlanId, leftoverId) {
  return request(`${API_BASE_URL}/week-plans/${weekPlanId}/leftovers/${leftoverId}`,
    { method: 'DELETE' }, 'Could not release the leftovers.');
}

export function setInventoryQuantity(itemId, quantity) {
  return putJson(`${API_BASE_URL}/inventory/${itemId}`, { quantity }, 'Enter a quantity like 2 or 1/2.');
}

// Take some stock out ("use some"). amount is text like "1/2 cup"; resolves { item, removed }.
export function consumeInventory(itemId, amount) {
  return putJson(`${API_BASE_URL}/inventory/${itemId}/use`, { amount }, 'Enter an amount like 2 or 1/2.', 'POST');
}

// Put some stock back (undo of use some). Resolves { item, added }.
export function returnInventory(itemId, amount) {
  return putJson(`${API_BASE_URL}/inventory/${itemId}/return`, { amount }, 'Could not put that back.', 'POST');
}

export async function updateMealYield(mealId, yieldServings) {
  const response = await fetch(`${API_BASE_URL}/meals/${mealId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yield_servings: yieldServings })
  });
  if (!response.ok) throw new Error(await failureMessage(response, 'Yield must be a whole number from 1 to 99.'));
  return response.json();
}

export async function updateMealDetails(mealId, changes) {
  const response = await fetch(`${API_BASE_URL}/meals/${mealId}/details`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes)
  });
  if (!response.ok) throw new Error(await failureMessage(response, 'Times must be whole minutes from 0 to 1440.'));
  return response.json();
}

export async function removeMealFromWeek(weekPlanId, mealId) {
  const response = await fetch(`${API_BASE_URL}/week-plans/${weekPlanId}/meals/${mealId}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error(await failureMessage(response, 'Could not remove the meal.'));
  return response.json();
}

export async function getAggregatedShoppingList(weekPlanId) {
  const response = await fetch(`${API_BASE_URL}/week-plans/${weekPlanId}/shopping-list`);
  return response.json();
}

export async function getPairings(weekPlanId) {
  const response = await fetch(`${API_BASE_URL}/week-plans/${weekPlanId}/pairings`);
  if (!response.ok) throw new Error('Could not load meal pairings.');
  return response.json();
}

export async function trackIngredient(weekPlanId, amount, mealId) {
  const response = await fetch(`${API_BASE_URL}/week-plans/${weekPlanId}/pairings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, meal_id: mealId })
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(typeof result.detail === 'string' ? result.detail : 'Could not save the ingredient.');
  }
  return result;
}

export async function removeTrackedIngredient(id) {
  const response = await fetch(`${API_BASE_URL}/pairing-ingredients/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not remove the ingredient.');
}

export async function getInventory() {
  const response = await fetch(`${API_BASE_URL}/inventory`);
  if (!response.ok) throw new Error(await failureMessage(response, 'Could not load the inventory.'));
  return response.json();
}

export async function recordPurchase(purchaseId, amount, location) {
  const response = await fetch(`${API_BASE_URL}/inventory/purchases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purchase_id: purchaseId, amount, location })
  });
  if (!response.ok) throw new Error(await failureMessage(response, 'Enter an amount like 2 cups of rice and choose fridge or pantry.'));
  return response.json();
}

export async function revertPurchase(purchaseId) {
  const response = await fetch(`${API_BASE_URL}/inventory/purchases/${encodeURIComponent(purchaseId)}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error(await failureMessage(response, 'Could not undo the purchase.'));
  return response.json();
}

// Grocery list, reconcile and minimums. Errors carry the server message and an HTTP status.
async function request(url, options, fallback) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error('Could not reach the server.');
  }
  if (!response.ok) {
    const error = new Error(await failureMessage(response, fallback));
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function jsonOptions(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export function listGroceryEntries() {
  return request(`${API_BASE_URL}/grocery-entries`, undefined, 'Could not load your shopping list.');
}

export function createGroceryEntry(body) {
  return request(`${API_BASE_URL}/grocery-entries`, jsonOptions('POST', body), 'Could not add the item.');
}

export function updateGroceryEntry(id, changes) {
  return request(`${API_BASE_URL}/grocery-entries/${id}`, jsonOptions('PATCH', changes),
    'Could not save the item.');
}

export function deleteGroceryEntry(id) {
  return request(`${API_BASE_URL}/grocery-entries/${id}`, { method: 'DELETE' }, 'Could not remove the item.');
}

export function clearPurchasedEntries() {
  return request(`${API_BASE_URL}/grocery-entries?purchased=true`, { method: 'DELETE' },
    'Could not clear the purchased items.');
}

export function importLocalEntries(entries) {
  return request(`${API_BASE_URL}/grocery-entries/import-local`, jsonOptions('POST', { entries }),
    'Could not move your saved list.');
}

export function undoGroceryChanges(undo) {
  return request(`${API_BASE_URL}/grocery-entries/undo`, jsonOptions('POST', undo), 'Could not undo that.');
}

export function getReconcile(weekPlanId) {
  return request(`${API_BASE_URL}/week-plans/${weekPlanId}/reconcile`, undefined,
    'Could not load what this week needs.');
}

export function applyReconcile(weekPlanId, fingerprint) {
  return request(`${API_BASE_URL}/week-plans/${weekPlanId}/reconcile`,
    jsonOptions('POST', { fingerprint }), 'Could not apply the changes.');
}

export function getStaples() {
  return request(`${API_BASE_URL}/inventory/staples`, undefined, 'Could not load your staples.');
}

export function listPackageSizes() {
  return request(`${API_BASE_URL}/package-sizes`, undefined, 'Could not load package sizes.');
}

// size null removes the saved package size.
export function setPackageSize({ item, unit_group, size, label }) {
  return request(`${API_BASE_URL}/package-sizes`,
    jsonOptions('PUT', { item, unit_group, size, label: label || null }),
    'Enter a size like 28 oz.');
}

export function setInventoryMinimum(itemId, minimum) {
  return request(`${API_BASE_URL}/inventory/${itemId}/minimum`, jsonOptions('PUT', { minimum }),
    'Enter a quantity like 2 or 1/2.');
}

export function getStockSuggestions(weekPlanId) {
  return request(`${API_BASE_URL}/week-plans/${weekPlanId}/stock-suggestions`, undefined,
    'Could not load suggestions.');
}

// Partial update: send only the fields that changed (name, notes, tags, ingredients,
// yield_servings, prep_minutes, cook_minutes, make_ahead).
export async function updateMeal(mealId, changes) {
  const response = await fetch(`${API_BASE_URL}/meals/${mealId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes)
  });
  if (!response.ok) throw new Error(await failureMessage(response, 'Could not save the meal.'));
  return response.json();
}

export async function importRecipe(url) {
  const response = await fetch(`${API_BASE_URL}/import-recipe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  if (!response.ok) throw new Error('Could not import that recipe. Check the link and try again.');
  return response.json();
}
