import { useState, useEffect } from 'react';
import {
  getCurrentWeekPlan, updateDayState, addMealToWeek, removeMealFromWeek, fetchMeals,
  updateWeekMealServings, setWeekMealDay, setWeekMealStatus, cookWeekMeal
} from '../api';
import MealPickerModal from './MealPickerModal';
import MealPairings from './MealPairings';
import './WeekPlanner.css';

function ServingsInput({ meal, servings, onCommit, disabled }) {
  const [draft, setDraft] = useState(servings ?? '');
  const [error, setError] = useState('');

  const commit = async () => {
    if (draft === '' || Number(draft) === servings) {
      setDraft(servings ?? '');
      return;
    }
    setError('');
    try {
      await onCommit(meal.id, Number(draft));
    } catch (err) {
      setError(err.message);
      setDraft(servings ?? '');
    }
  };

  return (
    <div className="meal-servings">
      <label>
        Planned servings{' '}
        <input
          type="number"
          min="1"
          max="99"
          step="1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          aria-label={`Planned servings for ${meal.name}`}
        />
      </label>
      {meal.yield_servings != null && <span className="yield-info"> (recipe makes {meal.yield_servings})</span>}
      {meal.yield_servings == null && (
        <p className="yield-note">No yield set, quantities used as written</p>
      )}
      {error && <p role="alert" className="yield-error">{error}</p>}
    </div>
  );
}

function WeekPlanner() {
  const [weekPlan, setWeekPlan] = useState(null);
  const [showMealPicker, setShowMealPicker] = useState(false);
  const [meals, setMeals] = useState([]);
  const [nextWeek, setNextWeek] = useState(false);
  const [error, setError] = useState('');
  const [pairingSource, setPairingSource] = useState('');
  const [messages, setMessages] = useState({});

  useEffect(() => {
    loadWeekPlan();
    loadMeals();
  }, []);

  const loadWeekPlan = async () => {
    try {
      console.log('Loading week plan...');
      const plan = await getCurrentWeekPlan(nextWeek ? weekPlan.start_date : undefined);
      console.log('Week plan loaded:', plan);
      setWeekPlan(plan);
    } catch (error) {
      console.error('Error loading week plan:', error);
      setError('Could not load the week plan.');
    }
  };

  const loadMeals = async () => {
    try {
      console.log('Loading meals...');
      const mealsData = await fetchMeals();
      console.log('Meals loaded:', mealsData);
      setMeals(mealsData);
    } catch (error) {
      console.error('Error loading meals:', error);
    }
  };

  const cycleDayState = async (day) => {
    const nextState = day.state === 'need' ? 'none' : 'need';
    await updateDayState(day.id, nextState);
    await loadWeekPlan();
  };

  const handleMealSelect = async (meal) => {
    if (weekPlan) {
      await addMealToWeek(weekPlan.id, meal.id);
      await loadWeekPlan();
      setShowMealPicker(false);
    }
  };

  const handleServingsChange = async (mealId, servings) => {
    const updated = await updateWeekMealServings(weekPlan.id, mealId, servings);
    setWeekPlan(updated);
  };

  const servingsFor = (meal) => {
    const row = (weekPlan.meal_servings || []).find(entry => entry.meal_id === meal.id);
    return row && row.servings != null ? row.servings : (meal.yield_servings ?? null);
  };

  const handleRemoveMeal = async (mealId) => {
    if (weekPlan) {
      try {
        await removeMealFromWeek(weekPlan.id, mealId);
        await loadWeekPlan();
      } catch (err) {
        setMealMessage(mealId, err.message);
      }
    }
  };

  const scheduleFor = (meal) => (
    (weekPlan.meal_schedule || []).find(entry => entry.meal_id === meal.id)
    || { day_id: null, status: 'planned', cooked_servings: null }
  );

  const setMealMessage = (mealId, text) => setMessages(prev => ({ ...prev, [mealId]: text }));

  const runMealAction = async (mealId, action) => {
    setMealMessage(mealId, '');
    try {
      const result = await action();
      if (result && result.meal_schedule) setWeekPlan(result);
      return result;
    } catch (err) {
      setMealMessage(mealId, err.message);
      return null;
    }
  };

  const handleDayChange = (meal, value) => runMealAction(meal.id, () =>
    setWeekMealDay(weekPlan.id, meal.id, value === '' ? null : Number(value)));

  const handleSkipToggle = (meal, schedule) => runMealAction(meal.id, () =>
    setWeekMealStatus(weekPlan.id, meal.id, schedule.status === 'skipped' ? 'planned' : 'skipped'));

  const handleCook = async (meal, schedule) => {
    const servings = servingsFor(meal);
    const day = weekPlan.days.find(d => d.id === schedule.day_id);
    const what = servings != null ? `${servings} servings of ${meal.name}` : meal.name;
    if (!window.confirm(`Mark ${what} cooked${day ? ` on ${day.day_name}` : ''}? This uses up the ingredients from your inventory.`)) {
      return;
    }
    setMealMessage(meal.id, '');
    try {
      const result = await cookWeekMeal(weekPlan.id, meal.id);
      const notes = [];
      const short = result.deductions.filter(d => d.short);
      if (short.length) {
        notes.push(`Not enough in stock: ${short.map(d => `${d.item} (short ${d.short}${d.unit ? ` ${d.unit}` : ''})`).join(', ')}.`);
      }
      if (result.untracked.length) {
        notes.push(`Not deducted (no measurable amount): ${result.untracked.join(', ')}.`);
      }
      setMealMessage(meal.id, notes.join(' '));
      await loadWeekPlan();
    } catch (err) {
      setMealMessage(meal.id, err.message);
    }
  };

  const getStats = () => {
    if (!weekPlan) return { daysNeed: 0, mealsAdded: 0, hasExcess: false };

    const daysNeed = weekPlan.days.filter(d => d.state === 'need').length;
    const mealsAdded = weekPlan.meals ? weekPlan.meals.length : 0;

    return {
      daysNeed,
      mealsAdded,
      hasExcess: mealsAdded > daysNeed
    };
  };

  const switchWeek = async () => {
    setError('');
    try {
      const current = await getCurrentWeekPlan();
      const nextStart = new Date(`${current.end_date}T00:00:00Z`);
      nextStart.setUTCDate(nextStart.getUTCDate() + 1);
      const plan = nextWeek ? current : await getCurrentWeekPlan(nextStart.toISOString().slice(0, 10));
      setPairingSource('');
      setWeekPlan(plan);
      setNextWeek(!nextWeek);
    } catch (error) {
      setError(error.message);
    }
  };

  if (!weekPlan) return <div>{error || 'Loading...'}</div>;

  const stats = getStats();

  return (
    <div className="week-planner">
      {/* Stats Section */}
      <div className="planner-header">
        <h2>{nextWeek ? 'Next Week' : 'Week Planner'}</h2>
        <button onClick={switchWeek}>{nextWeek ? 'View this week' : 'View next week'}</button>
        {error && <p role="alert">{error}</p>}
        <div className="stats">
          <span className="stat">{stats.daysNeed} days need meals</span>
          <span className="stat">{stats.mealsAdded} meals added</span>
          {stats.hasExcess && (
            <span className="stat warning">⚠ More meals than needed!</span>
          )}
        </div>
      </div>

      {/* Days Section - Simplified */}
      <div className="days-section">
        <h3>Days Status</h3>
        <div className="days-grid">
          {weekPlan.days.map(day => (
            <div key={day.id} className={`day-card simple ${day.state}`}>
              <h4>{day.day_name}</h4>
              <button
                className={`state-toggle ${day.state}`}
                onClick={() => cycleDayState(day)}
                title="Click to toggle: Need Meal / No Meal"
              >
                {day.state === 'need' ? '✓ Need Meal' : '✗ No Meal'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Meals Section - NEW */}
      <div className="meals-section">
        <div className="meals-header">
          <h3>Meals for {nextWeek ? 'Next' : 'This'} Week</h3>
          <button
            className="add-meal-btn"
            onClick={() => setShowMealPicker(true)}
          >
            + Add Meal to Week
          </button>
        </div>

        <div className="week-meals-list">
          {(!weekPlan.meals || weekPlan.meals.length === 0) ? (
            <p className="no-meals">No meals added yet. Click "Add Meal to Week" to get started!</p>
          ) : (
            weekPlan.meals.map(meal => {
              const schedule = scheduleFor(meal);
              const cooked = schedule.status === 'cooked';
              const skipped = schedule.status === 'skipped';
              const day = weekPlan.days.find(d => d.id === schedule.day_id);
              return (
                <div key={meal.id} className={`week-meal-item ${schedule.status}`}>
                  <div className="meal-info">
                    <h4>
                      {meal.name}{' '}
                      <span className={`status-badge ${schedule.status}`}>
                        {cooked
                          ? `Cooked${day ? ` ${day.day_name}` : ''}${schedule.cooked_servings != null ? ` (${schedule.cooked_servings} servings)` : ''}`
                          : skipped ? 'Skipped' : 'Planned'}
                      </span>
                    </h4>
                    {meal.tags && <span className="meal-tags">{meal.tags}</span>}
                    {meal.notes && <p className="meal-notes">{meal.notes}</p>}
                    <ServingsInput
                      key={`${meal.id}-${servingsFor(meal) ?? ''}-${cooked}`}
                      meal={meal}
                      servings={servingsFor(meal)}
                      onCommit={handleServingsChange}
                      disabled={cooked}
                    />
                    <div className="meal-schedule">
                      <label>
                        Day{' '}
                        <select
                          value={schedule.day_id ?? ''}
                          disabled={cooked}
                          onChange={(e) => handleDayChange(meal, e.target.value)}
                          aria-label={`Day for ${meal.name}`}
                        >
                          <option value="">Unscheduled</option>
                          {weekPlan.days.map(d => (
                            <option key={d.id} value={d.id}>{d.day_name}</option>
                          ))}
                        </select>
                      </label>
                      {!cooked && (
                        <button
                          type="button"
                          className="cook-btn"
                          disabled={schedule.day_id == null || skipped}
                          title={schedule.day_id == null ? 'Choose a day first' : skipped ? 'Unskip first' : 'Use up the ingredients'}
                          onClick={() => handleCook(meal, schedule)}
                        >
                          Mark cooked
                        </button>
                      )}
                      <button
                        type="button"
                        className="skip-btn"
                        disabled={cooked}
                        onClick={() => handleSkipToggle(meal, schedule)}
                      >
                        {skipped ? 'Unskip' : 'Skip'}
                      </button>
                    </div>
                    {messages[meal.id] && <p role="alert" className="cook-message">{messages[meal.id]}</p>}
                    <a href="#pairing-heading" onClick={() => setPairingSource(String(meal.id))}>Find a meal for leftover ingredients</a>
                  </div>
                  <button
                    className="remove-btn"
                    onClick={() => handleRemoveMeal(meal.id)}
                    disabled={cooked}
                    title={cooked ? 'Cooked meals cannot be removed' : 'Remove from week'}
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {showMealPicker && (
        <MealPickerModal
          meals={meals}
          onSelect={handleMealSelect}
          onClose={() => setShowMealPicker(false)}
          onMealCreated={loadMeals}
        />
      )}

      <MealPairings key={weekPlan.id} week={weekPlan} selectedSource={pairingSource}
        onSelectSource={setPairingSource} nextWeek={nextWeek} onAddMeal={async (mealId, next) => {
        const nextStart = new Date(`${weekPlan.end_date}T00:00:00Z`);
        nextStart.setUTCDate(nextStart.getUTCDate() + 1);
        const target = next ? await getCurrentWeekPlan(nextStart.toISOString().slice(0, 10)) : weekPlan;
        const updated = await addMealToWeek(target.id, mealId);
        if (!next) setWeekPlan(updated);
      }} />
    </div>
  );
}

export default WeekPlanner;
