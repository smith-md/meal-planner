import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { fetchMeals, createMeal, updateMealYield, updateMealDetails } from '../api';
import { EMPTY_FILTERS, filterMeals, filtersActive } from '../mealFilters';
import { Button, Input, Textarea, EmptyState, ErrorState, Skeleton } from './ui';
import { PlusIcon } from './ui/icons.jsx';
import './MealsLibrary.css';

const IMPORT_URL = 'http://localhost:8000/import-recipe';

const EMPTY_FORM = {
  name: '', notes: '', tags: '', ingredients: '', yield_servings: '',
  prep_minutes: '', cook_minutes: '', make_ahead: false
};

const minutesOrNull = (value) => (value === '' ? null : Number(value));

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

function DetailsControl({ meal, onSaved }) {
  const [prep, setPrep] = useState(meal.prep_minutes ?? '');
  const [cook, setCook] = useState(meal.cook_minutes ?? '');
  const [makeAhead, setMakeAhead] = useState(meal.make_ahead);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const prepChanged = String(prep) !== String(meal.prep_minutes ?? '');
  const cookChanged = String(cook) !== String(meal.cook_minutes ?? '');
  const aheadChanged = makeAhead !== meal.make_ahead;
  const unchanged = !prepChanged && !cookChanged && !aheadChanged;

  const save = async () => {
    // Send only what changed so the other fields are left alone.
    const changes = {};
    if (prepChanged) changes.prep_minutes = minutesOrNull(prep);
    if (cookChanged) changes.cook_minutes = minutesOrNull(cook);
    if (aheadChanged) changes.make_ahead = makeAhead;
    setSaving(true);
    setError('');
    try {
      await updateMealDetails(meal.id, changes);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save times.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="meals-details__group">
      <div className="meals-details__row">
        <Input
          label="Prep (min)"
          type="number" inputMode="numeric" min="0" max="1440" step="1"
          value={prep}
          onChange={(e) => setPrep(e.target.value)}
          aria-label={`Prep minutes for ${meal.name}`}
        />
        <Input
          label="Cook (min)"
          type="number" inputMode="numeric" min="0" max="1440" step="1"
          value={cook}
          onChange={(e) => setCook(e.target.value)}
          aria-label={`Cook minutes for ${meal.name}`}
        />
      </div>
      <label className="meals-check">
        <input
          type="checkbox"
          checked={makeAhead}
          onChange={(e) => setMakeAhead(e.target.checked)}
          aria-label={`Make-ahead ${meal.name}`}
        />
        <span>Make-ahead</span>
      </label>
      <Button variant="secondary" onClick={save} disabled={saving || unchanged} loading={saving}>
        Save times
      </Button>
      {error && <p role="alert" className="meals-error">{error}</p>}
    </div>
  );
}

function YieldControl({ meal, onSaved }) {
  const [value, setValue] = useState(meal.yield_servings ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const unchanged = String(value) === String(meal.yield_servings ?? '');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await updateMealYield(meal.id, value === '' ? null : Number(value));
      await onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save servings.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="meals-details__group">
      <Input
        label="Serves"
        type="number" inputMode="numeric" min="1" max="99" step="1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Servings ${meal.name} makes`}
        hint={meal.yield_servings == null ? 'Yield not set. Quantities are used as written.' : undefined}
      />
      <Button variant="secondary" onClick={save} disabled={saving || unchanged} loading={saving}>
        Save servings
      </Button>
      {error && <p role="alert" className="meals-error">{error}</p>}
    </div>
  );
}

function MealCard({ meal, onSaved }) {
  const [open, setOpen] = useState(false);
  const tags = splitTags(meal.tags);
  const count = countIngredients(meal.ingredients);
  const panelId = `meals-details-${meal.id}`;
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
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span>Details</span>
        <span className="meals-card__chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="meals-details" id={panelId}>
          {meal.notes && <p className="meals-details__notes">{meal.notes}</p>}
          <YieldControl key={`${meal.id}-${meal.yield_servings ?? ''}`} meal={meal} onSaved={onSaved} />
          <DetailsControl
            key={`${meal.id}-${meal.prep_minutes ?? ''}-${meal.cook_minutes ?? ''}-${meal.make_ahead}`}
            meal={meal}
            onSaved={onSaved}
          />
        </div>
      )}
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
  const [showForm, setShowForm] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const nameRef = useRef(null);
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
    setLoading(true);
    await loadMeals();
    setLoading(false);
  };

  useEffect(() => {
    if (showForm) nameRef.current?.focus();
  }, [showForm]);

  const allTags = useMemo(() => {
    const seen = new Map();
    meals.forEach((m) => splitTags(m.tags).forEach((t) => {
      const key = t.toLowerCase();
      if (!seen.has(key)) seen.set(key, t);
    }));
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [meals]);

  const setField = (field) => (e) => setFormData({ ...formData, [field]: e.target.value });

  const toggleForm = () => {
    setShowForm(!showForm);
    setFormError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setFormError('Enter a meal name.');
      nameRef.current?.focus();
      return;
    }
    setCreating(true);
    setFormError('');
    try {
      const created = await createMeal({
        ...formData,
        yield_servings: formData.yield_servings === '' ? null : Number(formData.yield_servings),
        prep_minutes: minutesOrNull(formData.prep_minutes),
        cook_minutes: minutesOrNull(formData.cook_minutes)
      });
      // api.createMeal returns the parsed body even for HTTP errors, so check it.
      if (!created || created.id == null) {
        throw new Error((created && typeof created.detail === 'string' && created.detail) || 'The meal was not saved.');
      }
      setFormData(EMPTY_FORM);
      setShowForm(false);
      setShowLink(false);
      await loadMeals();
    } catch (err) {
      setFormError(`Could not create the meal. ${errorMessage(err, 'Please try again.')}`);
    } finally {
      setCreating(false);
    }
  };

  const handleImportRecipe = async (e) => {
    e.preventDefault();
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError('');
    try {
      const response = await fetch(IMPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl })
      });
      if (!response.ok) {
        setImportError('Could not import that recipe. Check the link and try again.');
        return;
      }
      const recipeData = await response.json();
      setFormData({
        ...EMPTY_FORM,
        name: recipeData.name || '',
        notes: recipeData.notes || '',
        tags: recipeData.tags || '',
        ingredients: recipeData.ingredients || '',
        yield_servings: recipeData.yield_servings ?? ''
      });
      setFormError('');
      setImportUrl('');
      setShowLink(false);
    } catch (err) {
      console.error('Error importing recipe:', err);
      setImportError('Could not import that recipe. Please try again.');
    } finally {
      setImporting(false);
    }
  };

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
          variant="primary"
          onClick={toggleForm}
          aria-expanded={showForm}
          aria-controls="meals-new-panel"
        >
          <PlusIcon />
          New meal
        </Button>
      </header>

      {showForm && (
        <form className="meals-panel" id="meals-new-panel" onSubmit={handleSubmit} aria-label="New meal">
          <div className="meals-panel__section">
            <button
              type="button"
              className="meals-panel__toggle"
              aria-expanded={showLink}
              aria-controls="meals-link-panel"
              onClick={() => setShowLink(!showLink)}
            >
              <span>Paste a link</span>
              <span className="meals-card__chevron" aria-hidden="true">{showLink ? '−' : '+'}</span>
            </button>
            {showLink && (
              <div className="meals-link" id="meals-link-panel">
                <p className="meals-hint">
                  Paste a recipe link (NYT Cooking, AllRecipes, etc.). We fill in the form below so you can review it.
                </p>
                <Input
                  label="Recipe link"
                  type="url"
                  placeholder="https://cooking.nytimes.com/recipes/..."
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleImportRecipe(e); }}
                />
                <div>
                  <Button
                    variant="secondary"
                    onClick={handleImportRecipe}
                    loading={importing}
                    disabled={!importUrl.trim()}
                  >
                    Fill from link
                  </Button>
                </div>
                {importError && <p role="alert" className="meals-error">{importError}</p>}
              </div>
            )}
          </div>

          <Input
            ref={nameRef}
            label="Name"
            type="text"
            value={formData.name}
            onChange={setField('name')}
            required
          />
          <Input
            label="Tags"
            type="text"
            hint="Separate with commas, e.g. vegetarian, quick, chicken"
            value={formData.tags}
            onChange={setField('tags')}
          />
          <div className="meals-panel__row">
            <Input
              label="Servings this recipe makes"
              type="number" inputMode="numeric" min="1" max="99" step="1"
              placeholder="e.g. 4"
              value={formData.yield_servings}
              onChange={setField('yield_servings')}
            />
            <Input
              label="Prep time (min)"
              type="number" inputMode="numeric" min="0" max="1440" step="1"
              placeholder="optional"
              value={formData.prep_minutes}
              onChange={setField('prep_minutes')}
            />
            <Input
              label="Cook time (min)"
              type="number" inputMode="numeric" min="0" max="1440" step="1"
              placeholder="optional"
              value={formData.cook_minutes}
              onChange={setField('cook_minutes')}
            />
          </div>
          <label className="meals-check">
            <input
              type="checkbox"
              checked={formData.make_ahead}
              onChange={(e) => setFormData({ ...formData, make_ahead: e.target.checked })}
            />
            <span>Can be made ahead</span>
          </label>
          <Textarea label="Notes" value={formData.notes} onChange={setField('notes')} />
          <Textarea label="Ingredients" rows={5} value={formData.ingredients} onChange={setField('ingredients')} />

          {formError && <p role="alert" className="meals-error">{formError}</p>}

          <div className="meals-panel__actions">
            <Button type="submit" variant="primary" loading={creating}>Create meal</Button>
            <Button variant="quiet" onClick={toggleForm}>Cancel</Button>
          </div>
        </form>
      )}

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

      {loading ? (
        <Skeleton rows={4} label="Loading meals" />
      ) : loadError && meals.length === 0 ? (
        <ErrorState message={`Could not load your meals. ${loadError}`} onRetry={retry} />
      ) : meals.length === 0 ? (
        <EmptyState
          message="No meals yet. Add your first meal to start planning."
          actionLabel="New meal"
          onAction={() => setShowForm(true)}
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
              <MealCard key={meal.id} meal={meal} onSaved={loadMeals} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default MealsLibrary;
