import { useState } from 'react';
import WeekPlanner from './components/WeekPlanner';
import ShoppingList from './components/ShoppingList';
import MealsLibrary from './components/MealsLibrary';
import './App.css';

function App() {
  const [currentView, setCurrentView] = useState('planner');

  return (
    <div className="app">
      <h1 className="app-title">Meal Planner & Shopping Assistant</h1>

      <div className="nav-tabs">
        <button
          className={currentView === 'planner' ? 'active' : ''}
          onClick={() => setCurrentView('planner')}
        >
          Weekly Planner
        </button>
        <button
          className={currentView === 'shopping' ? 'active' : ''}
          onClick={() => setCurrentView('shopping')}
        >
          Shopping List
        </button>
        <button
          className={currentView === 'meals' ? 'active' : ''}
          onClick={() => setCurrentView('meals')}
        >
          Meals Library
        </button>
      </div>

      {currentView === 'planner' && <WeekPlanner />}
      {currentView === 'meals' && <MealsLibrary />}
      {currentView === 'shopping' && <ShoppingList />}
    </div>
  );
}

export default App;
