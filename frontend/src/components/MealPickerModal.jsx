import { useState } from 'react';
import './MealPickerModal.css';

// Create new meal hands off to the meal drawer (rendered by the parent), pre-filled with the typed search.
function MealPickerModal({ meals, onSelect, onClose, onCreateNew }) {
  const [searchTerm, setSearchTerm] = useState('');
  const filteredMeals = meals.filter(meal =>
    meal.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (meal.notes && meal.notes.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (meal.tags && meal.tags.toLowerCase().includes(searchTerm.toLowerCase()))
  );

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

        <button
          className="new-meal-btn"
          onClick={() => onCreateNew(searchTerm.trim())}
        >
          + Create New Meal
        </button>
      </div>
    </div>
  );
}

export default MealPickerModal;
