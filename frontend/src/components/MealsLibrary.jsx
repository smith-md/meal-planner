import { useState, useEffect } from 'react';
import { fetchMeals, createMeal } from '../api';
import './MealsLibrary.css';

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
  const [formData, setFormData] = useState({
    name: '',
    notes: '',
    tags: '',
    ingredients: ''
  });

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
      await createMeal(formData);
      setFormData({ name: '', notes: '', tags: '', ingredients: '' });
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
          name: recipeData.name || '',
          notes: recipeData.notes || '',
          tags: recipeData.tags || '',
          ingredients: recipeData.ingredients || ''
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
          name: recipeData.name || '',
          notes: recipeData.notes || '',
          tags: recipeData.tags || '',
          ingredients: recipeData.ingredients || ''
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

  const filteredMeals = meals.filter(meal =>
    meal.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (meal.notes && meal.notes.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (meal.tags && meal.tags.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (meal.ingredients && meal.ingredients.toLowerCase().includes(searchTerm.toLowerCase()))
  );

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

      <div className="meals-grid">
        {filteredMeals.map(meal => (
          <div key={meal.id} className="meal-card">
            <div className="meal-card-header">
              <h3>{meal.name}</h3>
            </div>
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
          <p>No meals found. Create your first meal to get started!</p>
        </div>
      )}
    </div>
  );
}

export default MealsLibrary;
