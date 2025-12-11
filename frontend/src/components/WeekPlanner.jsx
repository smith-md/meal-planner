import { useState, useEffect } from 'react';
import { getCurrentWeekPlan, updateDayState, addMealToDay, removeMealFromDay, fetchMeals } from '../api';
import MealPickerModal from './MealPickerModal';
import './WeekPlanner.css';

function WeekPlanner() {
  const [weekPlan, setWeekPlan] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
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

  const openMealPicker = (day) => {
    setSelectedDay(day);
    setShowMealPicker(true);
  };

  const handleMealSelect = async (meal) => {
    if (selectedDay) {
      await addMealToDay(selectedDay.id, meal.id);
      await loadWeekPlan();
      setShowMealPicker(false);
    }
  };

  const handleRemoveMeal = async (dayId, mealId) => {
    await removeMealFromDay(dayId, mealId);
    await loadWeekPlan();
  };

  const getMealStats = () => {
    if (!weekPlan) return { total: 0, planned: 0, needed: 0 };
    
    const needDays = weekPlan.days.filter(d => d.state === 'need');
    const planned = needDays.filter(d => d.meals.length > 0).length;
    
    return {
      total: needDays.length,
      planned: planned,
      needed: needDays.length - planned
    };
  };

  if (!weekPlan) return <div>Loading...</div>;

  const stats = getMealStats();

  return (
    <div className="week-planner">
      <div className="planner-header">
        <h2>Week Planner</h2>
        <div className="stats">
          <span className="stat">Meals Needed: {stats.total}</span>
          <span className="stat">Planned: {stats.planned}</span>
          <span className="stat missing">Missing: {stats.needed}</span>
        </div>
      </div>
      
      <div className="days-grid">
        {weekPlan.days.map(day => (
          <div key={day.id} className={`day-card ${day.state}`}>
            <div className="day-header">
              <h3>{day.day_name}</h3>
              <button
                className="state-toggle"
                onClick={() => cycleDayState(day)}
                title="Click to toggle: Need Meal / No Meal"
              >
                {day.state === 'need' && 'Need Meal'}
                {day.state === 'none' && 'No Meal'}
              </button>
            </div>
            
            <div className="meals-list">
              {day.meals.map(meal => (
                <div key={meal.id} className="meal-item">
                  <span>{meal.name}</span>
                  <button onClick={() => handleRemoveMeal(day.id, meal.id)}>×</button>
                </div>
              ))}
            </div>
            
            <button 
              className="add-meal-btn"
              onClick={() => openMealPicker(day)}
            >
              + Add Meal
            </button>
          </div>
        ))}
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
