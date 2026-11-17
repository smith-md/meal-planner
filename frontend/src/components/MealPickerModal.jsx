import { useState } from 'react';
import Sheet from './Sheet';
import './MealPickerModal.css';

// onSelect(meal) may be async: while it runs the options are disabled, and if it rejects the message
// shows inline and the sheet stays open. Create new meal hands off to the meal drawer (rendered by the
// parent), pre-filled with the typed search. plannedIds holds the meal ids already planned this week.
function MealPickerModal({ title = 'Choose a meal', meals, plannedIds = new Set(), onSelect, onClose, onCreateNew }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const term = searchTerm.trim().toLowerCase();
  const filteredMeals = meals.filter(meal =>
    meal.name.toLowerCase().includes(term) ||
    (meal.notes && meal.notes.toLowerCase().includes(term)) ||
    (meal.tags && meal.tags.toLowerCase().includes(term))
  );

  const choose = async meal => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSelect(meal);
    } catch (err) {
      setError(err.message || 'Could not add the meal.');
      setBusy(false);
    }
  };

  return (
    <Sheet title={title} onClose={onClose}>
      <input
        type="search"
        className="picker__search"
        placeholder="Search meals"
        aria-label="Search meals"
        value={searchTerm}
        onChange={event => setSearchTerm(event.target.value)}
      />

      {error && <p className="picker__error" role="alert">{error}</p>}

      <ul className="picker__list">
        {filteredMeals.map(meal => {
          const planned = plannedIds.has(meal.id);
          return (
            <li key={meal.id}>
              <button type="button" className="picker__option" disabled={planned || busy} onClick={() => choose(meal)}>
                <span className="picker__name">{meal.name}</span>
                {planned
                  ? <span className="picker__meta">Already planned this week. Use Move.</span>
                  : meal.tags && <span className="picker__meta">{meal.tags}</span>}
              </button>
            </li>
          );
        })}
        {!filteredMeals.length && (
          <li className="picker__empty">{meals.length ? 'No meals match that search.' : 'Your meal library is empty.'}</li>
        )}
      </ul>

      <button type="button" className="picker__create" disabled={busy} onClick={() => onCreateNew(searchTerm.trim())}>
        {searchTerm.trim() ? `Create "${searchTerm.trim()}"` : '+ Create a new meal'}
      </button>
    </Sheet>
  );
}

export default MealPickerModal;
