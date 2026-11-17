import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { fetchMeals } from '../api';
import { EMPTY_FILTERS, filterMeals, filtersActive } from '../mealFilters';
import { Button, Input, EmptyState, ErrorState, Skeleton } from './ui';
import MealDrawer from './MealDrawer';
import { PlusIcon } from './ui/icons.jsx';
import './MealsLibrary.css';

// Tags are stored as one comma-separated string. Split, trim, drop blanks.
function splitTags(tags) {
  if (!tags) return [];
  return tags.split(',').map((t) => t.trim()).filter(Boolean);
}

// Ingredients are stored as free text, one per line (or comma separated).
function countIngredients(ingredients) {
  if (!ingredients) return 0;
  return ingredients.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean).length;
}

function mealHasTags(meal, selectedTags) {
  if (selectedTags.length === 0) return true;
  const own = splitTags(meal.tags).map((t) => t.toLowerCase());
  return selectedTags.every((t) => own.includes(t.toLowerCase()));
}

function errorMessage(err, fallback) {
  return err && err.message ? err.message : fallback;
}

function MealCard({ meal, onEdit }) {
  const tags = splitTags(meal.tags);
  const count = countIngredients(meal.ingredients);
  const hasTimes = meal.prep_minutes != null || meal.cook_minutes != null || meal.make_ahead;

  return (
    <li className="meals-card">
      <h3 className="meals-card__name">{meal.name}</h3>
      {tags.length > 0 && (
        <ul className="meals-card__tags" aria-label="Tags">
          {tags.map((t) => (
            <li key={t} className="meals-tag">{t}</li>
          ))}
        </ul>
      )}
      <p className="meals-card__meta">
        {count} ingredient{count === 1 ? '' : 's'}
        {meal.yield_servings != null && <span> · Serves {meal.yield_servings}</span>}
        {hasTimes && (
          <>
            {meal.prep_minutes != null && <span> · Prep {meal.prep_minutes} min</span>}
            {meal.cook_minutes != null && <span> · Cook {meal.cook_minutes} min</span>}
            {meal.make_ahead && <span> · Make-ahead</span>}
          </>
        )}
      </p>
      <button
        type="button"
        className="meals-card__toggle"
        aria-haspopup="dialog"
        aria-label={`Edit ${meal.name}`}
        onClick={onEdit}
      >
        <span>Edit</span>
      </button>
    </li>
  );
}

function MealsLibrary() {
  const [meals, setMeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [drawer, setDrawer] = useState(null);
  const newButtonRef = useRef(null);
  const searchRef = useRef(null);

  const loadMeals = useCallback(async () => {
    try {
      const data = await fetchMeals();
      if (!Array.isArray(data)) {
        throw new Error((data && data.detail) || 'Unexpected response.');
      }
      setMeals(data);
      setLoadError('');
    } catch (err) {
      console.error('Error loading meals:', err);
      setLoadError(errorMessage(err, 'Could not load meals.'));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadMeals();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadMeals]);

  const retry = async () => {
    // Keep the existing grid visible when reloading a list that already loaded.
    if (meals.length === 0) setLoading(true);
    await loadMeals();
    setLoading(false);
  };

  const allTags = useMemo(() => {
    const seen = new Map();
    meals.forEach((m) => splitTags(m.tags).forEach((t) => {
      const key = t.toLowerCase();
      if (!seen.has(key)) seen.set(key, t);
    }));
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [meals]);

  const toggleTag = (tag) => {
    setSelectedTags(
      selectedTags.includes(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag]
    );
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedTags([]);
    setFilters(EMPTY_FILTERS);
    searchRef.current?.focus();
  };

  const anyFilter = filtersActive(searchTerm, filters) || selectedTags.length > 0;
  const filteredMeals = filterMeals(meals, searchTerm, filters).filter((m) => mealHasTags(m, selectedTags));
  const timeFilterActive = filters.maxPrep !== '' || filters.maxCook !== '';

  return (
    <section className="meals" aria-labelledby="meals-title">
      <header className="meals-header">
        <h2 id="meals-title" className="meals-header__title">Meals</h2>
        <Button
          ref={newButtonRef}
          variant="primary"
          onClick={() => setDrawer({ meal: null })}
          aria-haspopup="dialog"
        >
          <PlusIcon />
          New meal
        </Button>
      </header>

      <div className="meals-search">
        <Input
          ref={searchRef}
          label="Search meals"
          type="search"
          placeholder="Name, notes, tags or ingredients"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="meals-toolbar">
        {allTags.length > 0 && (
          <ul className="meals-chips" aria-label="Filter by tag">
            {allTags.map((tag) => {
              const pressed = selectedTags.includes(tag);
              return (
                <li key={tag}>
                  <button
                    type="button"
                    className={`meals-chip${pressed ? ' meals-chip--on' : ''}`}
                    aria-pressed={pressed}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="meals-filters">
          <Input
            label="Max prep (min)"
            type="number" inputMode="numeric" min="0" max="1440" step="1"
            value={filters.maxPrep}
            onChange={(e) => setFilters({ ...filters, maxPrep: e.target.value })}
            aria-label="Maximum prep minutes"
          />
          <Input
            label="Max cook (min)"
            type="number" inputMode="numeric" min="0" max="1440" step="1"
            value={filters.maxCook}
            onChange={(e) => setFilters({ ...filters, maxCook: e.target.value })}
            aria-label="Maximum cook minutes"
          />
          <label className="meals-check">
            <input
              type="checkbox"
              checked={filters.makeAheadOnly}
              onChange={(e) => setFilters({ ...filters, makeAheadOnly: e.target.checked })}
            />
            <span>Make-ahead only</span>
          </label>
          <Button variant="quiet" onClick={clearFilters} disabled={!anyFilter}>Clear filters</Button>
        </div>
        {timeFilterActive && (
          <p className="meals-hint">Meals with no prep or cook time set are hidden while a time filter is on.</p>
        )}
      </div>

      {!loading && loadError && meals.length > 0 && (
        <div role="alert" className="meals-error meals-reload-error">
          <span className="meals-reload-error__text">Could not refresh your meals. {loadError}</span>
          <Button variant="secondary" onClick={retry}>Retry</Button>
        </div>
      )}

      {loading ? (
        <Skeleton rows={4} label="Loading meals" />
      ) : loadError && meals.length === 0 ? (
        <ErrorState message={`Could not load your meals. ${loadError}`} onRetry={retry} />
      ) : meals.length === 0 ? (
        <EmptyState
          message="No meals yet. Add your first meal to start planning."
          actionLabel="New meal"
          onAction={() => setDrawer({ meal: null })}
        />
      ) : filteredMeals.length === 0 ? (
        <EmptyState
          message="No meals match your search and filters."
          actionLabel="Clear filters"
          onAction={clearFilters}
        />
      ) : (
        <>
          <p className="meals-count" aria-live="polite">
            {filteredMeals.length} meal{filteredMeals.length === 1 ? '' : 's'}
          </p>
          <ul className="meals-grid">
            {filteredMeals.map((meal) => (
              <MealCard key={meal.id} meal={meal} onEdit={() => setDrawer({ meal })} />
            ))}
          </ul>
        </>
      )}

      {drawer && (
        <MealDrawer
          meal={drawer.meal}
          onSaved={loadMeals}
          onClose={() => setDrawer(null)}
          returnFocusRef={newButtonRef}
        />
      )}
    </section>
  );
}

export default MealsLibrary;
