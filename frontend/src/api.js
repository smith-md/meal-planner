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

export async function getCurrentWeekPlan() {
  const response = await fetch(`${API_BASE_URL}/week-plans/current`);
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

export async function addMealToWeek(weekPlanId, mealId) {
  const response = await fetch(`${API_BASE_URL}/week-plans/${weekPlanId}/meals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meal_id: mealId })
  });
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
