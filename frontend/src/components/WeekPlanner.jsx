import { useState, useEffect } from 'react';
import { getCurrentWeekPlan, updateDayState, addMealToWeek, removeMealFromWeek, fetchMeals } from '../api';
import MealPickerModal from './MealPickerModal';
import './WeekPlanner.css';

function WeekPlanner() {
  const [weekPlan, setWeekPlan] = useState(null);
  const [showMealPicker, setShowMealPicker] = useState(false);
  const [meals, setMeals] = useState([]);

  useEffect(() => {
    loadWeekPlan();
    loadMeals();
  }, []);

  const loadWeekPlan = async () => {
    try {
      console.log('Loading week plan...');
      const plan = await getCurrentWeekPlan();
      console.log('Week plan loaded:', plan);
      setWeekPlan(plan);
    } catch (error) {
      console.error('Error loading week plan:', error);
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

  const handleRemoveMeal = async (mealId) => {
    if (weekPlan) {
      await removeMealFromWeek(weekPlan.id, mealId);
      await loadWeekPlan();
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

  if (!weekPlan) return <div>Loading...</div>;

  const stats = getStats();

  return (
    <div className="week-planner">
      {/* Stats Section */}
      <div className="planner-header">
        <h2>Week Planner</h2>
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
          <h3>Meals for This Week</h3>
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
            weekPlan.meals.map(meal => (
              <div key={meal.id} className="week-meal-item">
                <div className="meal-info">
                  <h4>{meal.name}</h4>
                  {meal.tags && <span className="meal-tags">{meal.tags}</span>}
                  {meal.notes && <p className="meal-notes">{meal.notes}</p>}
                </div>
                <button
                  className="remove-btn"
                  onClick={() => handleRemoveMeal(meal.id)}
                  title="Remove from week"
                >
                  ×
                </button>
              </div>
            ))
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
    </div>
  );
}

export default WeekPlanner;
