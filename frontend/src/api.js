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
