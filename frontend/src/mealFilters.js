// Pure meal-library filtering, kept free of React so it is easy to reason about.

export const EMPTY_FILTERS = { maxPrep: '', maxCook: '', makeAheadOnly: false };

export function matchesSearch(meal, term) {
  const needle = term.toLowerCase();
  return (
    meal.name.toLowerCase().includes(needle) ||
    Boolean(meal.notes && meal.notes.toLowerCase().includes(needle)) ||
    Boolean(meal.tags && meal.tags.toLowerCase().includes(needle)) ||
    Boolean(meal.ingredients && meal.ingredients.toLowerCase().includes(needle))
  );
}

// An empty/invalid limit means the filter is inactive. A meal whose time is
// unset (null) never passes an active time filter.
function withinLimit(minutes, limit) {
  if (limit === '' || limit == null || Number.isNaN(Number(limit))) return true;
  return minutes != null && minutes <= Number(limit);
}

export function filterMeals(meals, searchTerm, filters) {
  return meals.filter(
    (meal) =>
      matchesSearch(meal, searchTerm) &&
      withinLimit(meal.prep_minutes, filters.maxPrep) &&
      withinLimit(meal.cook_minutes, filters.maxCook) &&
      (!filters.makeAheadOnly || meal.make_ahead === true)
  );
}

export function filtersActive(searchTerm, filters) {
  return (
    searchTerm !== '' ||
    filters.maxPrep !== '' ||
    filters.maxCook !== '' ||
    filters.makeAheadOnly
  );
}
