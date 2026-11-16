import { useState, useEffect } from 'react';
import { fetchMeals, createMeal, updateMealYield, updateMealDetails } from '../api';
import { EMPTY_FILTERS, filterMeals, filtersActive } from '../mealFilters';
import './MealsLibrary.css';

const EMPTY_FORM = {
  name: '', notes: '', tags: '', ingredients: '', yield_servings: '',
  prep_minutes: '', cook_minutes: '', make_ahead: false
};

const minutesOrNull = (value) => (value === '' ? null : Number(value));

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
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="meal-details">
      <label>
        Prep (min){' '}
        <input
          type="number" min="0" max="1440" step="1"
          value={prep}
          onChange={(e) => setPrep(e.target.value)}
          aria-label={`Prep minutes for ${meal.name}`}
        />
      </label>
      <label>
        Cook (min){' '}
        <input
          type="number" min="0" max="1440" step="1"
          value={cook}
          onChange={(e) => setCook(e.target.value)}
          aria-label={`Cook minutes for ${meal.name}`}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={makeAhead}
          onChange={(e) => setMakeAhead(e.target.checked)}
          aria-label={`Make-ahead ${meal.name}`}
        />{' '}
        Make-ahead
      </label>
      <button type="button" onClick={save} disabled={saving || unchanged}>Save times</button>
      {error && <p role="alert" className="yield-error">{error}</p>}
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
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="meal-yield">
      <label>
        Serves{' '}
        <input
          type="number"
          min="1"
          max="99"
          step="1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={`Servings ${meal.name} makes`}
        />
      </label>
      <button type="button" onClick={save} disabled={saving || unchanged}>Save</button>
      {meal.yield_servings == null && (
        <p className="yield-note">Yield not set. Quantities are used as written.</p>
      )}
      {error && <p role="alert" className="yield-error">{error}</p>}
    </div>
  );
}

function MealsLibrary() {
  const [meals, setMeals] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewMealForm, setShowNewMealForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [showImageImportForm, setShowImageImportForm] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [editingMeal, setEditingMeal] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  useEffect(() => {
    loadMeals();
  }, []);

  const loadMeals = async () => {
    try {
      const mealsData = await fetchMeals();
      setMeals(mealsData);
    } catch (error) {
      console.error('Error loading meals:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.name.trim()) {
      await createMeal({
        ...formData,
        yield_servings: formData.yield_servings === '' ? null : Number(formData.yield_servings),
        prep_minutes: minutesOrNull(formData.prep_minutes),
        cook_minutes: minutesOrNull(formData.cook_minutes)
      });
      setFormData(EMPTY_FORM);
      setShowNewMealForm(false);
      await loadMeals();
    }
  };

  const handleImportRecipe = async (e) => {
    e.preventDefault();
    if (!importUrl.trim()) return;

    setImporting(true);
    try {
      const response = await fetch('http://localhost:8000/import-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl })
      });

      if (response.ok) {
        const recipeData = await response.json();
        setFormData({
          ...EMPTY_FORM,
          name: recipeData.name || '',
          notes: recipeData.notes || '',
          tags: recipeData.tags || '',
          ingredients: recipeData.ingredients || '',
          yield_servings: recipeData.yield_servings ?? ''
        });
        setImportUrl('');
        setShowImportForm(false);
        setShowNewMealForm(true);
      } else {
        alert('Failed to import recipe. Please check the URL and try again.');
      }
    } catch (error) {
      console.error('Error importing recipe:', error);
      alert('Failed to import recipe. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  const handleImageImport = async (e) => {
    e.preventDefault();
    if (!imageFile) return;

    setImporting(true);
    try {
      const formDataUpload = new FormData();
      formDataUpload.append('image', imageFile);

      const response = await fetch('http://localhost:8000/import-recipe-from-image', {
        method: 'POST',
        body: formDataUpload
      });

      if (response.ok) {
        const recipeData = await response.json();
        setFormData({
          ...EMPTY_FORM,
          name: recipeData.name || '',
          notes: recipeData.notes || '',
          tags: recipeData.tags || '',
          ingredients: recipeData.ingredients || '',
          yield_servings: recipeData.yield_servings ?? ''
        });
        setImageFile(null);
        setShowImageImportForm(false);
        setShowNewMealForm(true);
      } else {
        const error = await response.json();
        alert(error.detail || 'Failed to import recipe from image. Please try again.');
      }
    } catch (error) {
      console.error('Error importing recipe from image:', error);
      alert('Failed to import recipe from image. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  const filteredMeals = filterMeals(meals, searchTerm, filters);
  const timeFilterActive = filters.maxPrep !== '' || filters.maxCook !== '';

  const clearFilters = () => {
    setSearchTerm('');
    setFilters(EMPTY_FILTERS);
  };

  return (
    <div className="meals-library">
      <div className="library-header">
        <h2>Meals Library</h2>
        <div className="header-buttons">
          <button
            className="import-btn"
            onClick={() => {
              setShowImportForm(!showImportForm);
              setShowNewMealForm(false);
              setShowImageImportForm(false);
            }}
          >
            {showImportForm ? 'Cancel' : 'Import from URL'}
          </button>
          <button
            className="image-import-btn"
            onClick={() => {
              setShowImageImportForm(!showImageImportForm);
              setShowNewMealForm(false);
              setShowImportForm(false);
            }}
          >
            {showImageImportForm ? 'Cancel' : 'Import from Image'}
          </button>
          <button
            className="new-meal-btn"
            onClick={() => {
              setShowNewMealForm(!showNewMealForm);
              setShowImportForm(false);
              setShowImageImportForm(false);
            }}
          >
            {showNewMealForm ? 'Cancel' : '+ New Meal'}
          </button>
        </div>
      </div>

      {showImportForm && (
        <form className="import-form" onSubmit={handleImportRecipe}>
          <h3>Import from Recipe URL</h3>
          <p className="import-instructions">
            Paste a recipe URL (NYT Cooking, AllRecipes, etc.):
          </p>
          <input
            type="url"
            placeholder="https://cooking.nytimes.com/recipes/..."
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            required
          />
          <button type="submit" className="submit-btn" disabled={importing}>
            {importing ? 'Importing...' : 'Import Recipe'}
          </button>
        </form>
      )}

      {showImageImportForm && (
        <form className="import-form image-form" onSubmit={handleImageImport}>
          <h3>Import from Image</h3>
          <p className="import-instructions">
            Upload a screenshot or photo of a recipe:
          </p>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setImageFile(e.target.files[0])}
            required
            className="file-input"
          />
          {imageFile && (
            <div className="file-preview">
              <span>Selected: {imageFile.name}</span>
            </div>
          )}
          <button type="submit" className="submit-btn" disabled={importing || !imageFile}>
            {importing ? 'Analyzing Image...' : 'Import from Image'}
          </button>
        </form>
      )}

      {showNewMealForm && (
        <form className="meal-form" onSubmit={handleSubmit}>
          <h3>Create New Meal</h3>
          <input
            type="text"
            placeholder="Meal name*"
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            required
          />
          <input
            type="text"
            placeholder="Tags (e.g., vegetarian, quick, chicken)"
            value={formData.tags}
            onChange={(e) => setFormData({...formData, tags: e.target.value})}
          />
          <label className="yield-field">
            Servings this recipe makes
            <input
              type="number"
              min="1"
              max="99"
              step="1"
              placeholder="e.g., 4"
              value={formData.yield_servings}
              onChange={(e) => setFormData({...formData, yield_servings: e.target.value})}
            />
          </label>
          <div className="time-fields">
            <label className="yield-field">
              Prep time (minutes)
              <input
                type="number" min="0" max="1440" step="1"
                placeholder="optional"
                value={formData.prep_minutes}
                onChange={(e) => setFormData({...formData, prep_minutes: e.target.value})}
              />
            </label>
            <label className="yield-field">
              Cook time (minutes)
              <input
                type="number" min="0" max="1440" step="1"
                placeholder="optional"
                value={formData.cook_minutes}
                onChange={(e) => setFormData({...formData, cook_minutes: e.target.value})}
              />
            </label>
            <label className="make-ahead-field">
              <input
                type="checkbox"
                checked={formData.make_ahead}
                onChange={(e) => setFormData({...formData, make_ahead: e.target.checked})}
              />{' '}
              Can be made ahead
            </label>
          </div>
          <textarea
            placeholder="Notes"
            value={formData.notes}
            onChange={(e) => setFormData({...formData, notes: e.target.value})}
          />
          <textarea
            placeholder="Ingredients"
            value={formData.ingredients}
            onChange={(e) => setFormData({...formData, ingredients: e.target.value})}
          />
          <button type="submit" className="submit-btn">Create Meal</button>
        </form>
      )}

      <div className="search-section">
        <input
          type="text"
          className="search-input"
          placeholder="Search meals by name, tags, ingredients..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <span className="results-count">{filteredMeals.length} meal{filteredMeals.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="filter-section">
        <label>
          Max prep (min){' '}
          <input
            type="number" min="0" max="1440" step="1"
            value={filters.maxPrep}
            onChange={(e) => setFilters({...filters, maxPrep: e.target.value})}
            aria-label="Maximum prep minutes"
          />
        </label>
        <label>
          Max cook (min){' '}
          <input
            type="number" min="0" max="1440" step="1"
            value={filters.maxCook}
            onChange={(e) => setFilters({...filters, maxCook: e.target.value})}
            aria-label="Maximum cook minutes"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.makeAheadOnly}
            onChange={(e) => setFilters({...filters, makeAheadOnly: e.target.checked})}
          />{' '}
          Make-ahead only
        </label>
        <button
          type="button"
          className="clear-filters-btn"
          onClick={clearFilters}
          disabled={!filtersActive(searchTerm, filters)}
        >
          Clear filters
        </button>
        {timeFilterActive && (
          <p className="filter-note">Meals with no prep or cook time set are hidden while a time filter is on.</p>
        )}
      </div>

      <div className="meals-grid">
        {filteredMeals.map(meal => (
          <div key={meal.id} className="meal-card">
            <div className="meal-card-header">
              <h3>{meal.name}</h3>
            </div>
            {(meal.prep_minutes != null || meal.cook_minutes != null || meal.make_ahead) && (
              <div className="meal-times">
                {meal.prep_minutes != null && <span>Prep {meal.prep_minutes} min</span>}
                {meal.cook_minutes != null && <span>Cook {meal.cook_minutes} min</span>}
                {meal.make_ahead && <span className="make-ahead-badge">Make-ahead</span>}
              </div>
            )}
            <YieldControl key={`${meal.id}-${meal.yield_servings ?? ''}`} meal={meal} onSaved={loadMeals} />
            <DetailsControl
              key={`${meal.id}-${meal.prep_minutes ?? ''}-${meal.cook_minutes ?? ''}-${meal.make_ahead}`}
              meal={meal}
              onSaved={loadMeals}
            />
            {meal.tags && (
              <div className="meal-tags">
                <strong>Tags:</strong> {meal.tags}
              </div>
            )}
            {meal.notes && (
              <div className="meal-notes">
                <strong>Notes:</strong> {meal.notes}
              </div>
            )}
            {meal.ingredients && (
              <div className="meal-ingredients">
                <strong>Ingredients:</strong> {meal.ingredients}
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredMeals.length === 0 && (
        <div className="no-meals">
          <p>
            {meals.length > 0 && filtersActive(searchTerm, filters)
              ? 'No meals match the current search and filters.'
              : 'No meals found. Create your first meal to get started!'}
          </p>
        </div>
      )}
    </div>
  );
}

export default MealsLibrary;
