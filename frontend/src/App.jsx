import { useState, useEffect } from 'react';
import WeekPlanner from './components/WeekPlanner';
import ShoppingList from './components/ShoppingList';
import './App.css';

function App() {
  return (
    <div className="app">
      <h1 className="app-title">Meal Planner & Shopping Assistant</h1>
      <div className="app-container">
        <WeekPlanner />
        <ShoppingList />
      </div>
    </div>
  );
}

export default App;
