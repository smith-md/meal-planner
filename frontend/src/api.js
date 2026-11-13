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

export async function addMealToWeek(weekPlanId, mealId, servings) {
  const body = { meal_id: mealId };
  if (servings !== undefined && servings !== null) body.servings = servings;
  const response = await fetch(`${API_BASE_URL}/week-plans/${weekPlanId}/meals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error('Could not add the meal.');
  return response.json();
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

async function putJson(url, body, fallback) {
  const response = await fetch(url, {
    method: 'PUT',
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

export async function cookWeekMeal(weekPlanId, mealId) {
  const response = await fetch(`${API_BASE_URL}/week-plans/${weekPlanId}/meals/${mealId}/cook`, {
    method: 'POST'
  });
  if (!response.ok) throw new Error(await failureMessage(response, 'Could not mark the meal cooked.'));
  return response.json();
}

export function setInventoryQuantity(itemId, quantity) {
  return putJson(`${API_BASE_URL}/inventory/${itemId}`, { quantity }, 'Enter a quantity like 2 or 1/2.');
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
