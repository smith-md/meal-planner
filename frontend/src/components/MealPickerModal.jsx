import { useState } from 'react';
import { createMeal } from '../api';
import './MealPickerModal.css';

function MealPickerModal({ meals, onSelect, onClose, onMealCreated }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewMealForm, setShowNewMealForm] = useState(false);
  const [newMeal, setNewMeal] = useState({
    name: '',
    notes: '',
    tags: '',
    ingredients: '',
    yield_servings: ''
  });

  const filteredMeals = meals.filter(meal =>
    meal.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (meal.notes && meal.notes.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (meal.tags && meal.tags.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleCreateMeal = async () => {
    if (newMeal.name.trim()) {
      await createMeal({
        ...newMeal,
        yield_servings: newMeal.yield_servings === '' ? null : Number(newMeal.yield_servings)
      });
      setNewMeal({ name: '', notes: '', tags: '', ingredients: '', yield_servings: '' });
      setShowNewMealForm(false);
      onMealCreated();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Select a Meal</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <input
          type="text"
          className="search-input"
          placeholder="Search meals..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <div className="meals-list">
          {filteredMeals.map(meal => (
            <div
              key={meal.id}
              className="meal-option"
              onClick={() => onSelect(meal)}
            >
              <div className="meal-name">{meal.name}</div>
              {meal.tags && <div className="meal-tags">{meal.tags}</div>}
            </div>
          ))}
        </div>

        {!showNewMealForm ? (
          <button 
            className="new-meal-btn"
            onClick={() => setShowNewMealForm(true)}
          >
            + Create New Meal
          </button>
        ) : (
          <div className="new-meal-form">
            <h3>New Meal</h3>
            <input
              type="text"
              placeholder="Meal name*"
              value={newMeal.name}
              onChange={(e) => setNewMeal({...newMeal, name: e.target.value})}
            />
            <input
              type="text"
              placeholder="Tags (e.g., vegetarian, quick)"
              value={newMeal.tags}
              onChange={(e) => setNewMeal({...newMeal, tags: e.target.value})}
            />
            <input
              type="number"
              min="1"
              max="99"
              step="1"
              placeholder="Servings this recipe makes"
              aria-label="Servings this recipe makes"
              value={newMeal.yield_servings}
              onChange={(e) => setNewMeal({...newMeal, yield_servings: e.target.value})}
            />
            <textarea
              placeholder="Notes"
              value={newMeal.notes}
              onChange={(e) => setNewMeal({...newMeal, notes: e.target.value})}
            />
            <textarea
              placeholder="Ingredients"
              value={newMeal.ingredients}
              onChange={(e) => setNewMeal({...newMeal, ingredients: e.target.value})}
            />
            <div className="form-buttons">
              <button onClick={handleCreateMeal}>Create</button>
              <button onClick={() => setShowNewMealForm(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MealPickerModal;
