import { useState, useEffect } from 'react';
import { getCurrentWeekPlan, getAggregatedShoppingList } from '../api';
import './ShoppingList.css';

function ShoppingList() {
  const [items, setItems] = useState([]);
  const [newItem, setNewItem] = useState('');
  const [weekPlan, setWeekPlan] = useState(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('shoppingList');
    if (saved) {
      setItems(JSON.parse(saved));
    }
    loadWeekPlan();
  }, []);

  useEffect(() => {
    localStorage.setItem('shoppingList', JSON.stringify(items));
  }, [items]);

  const loadWeekPlan = async () => {
    try {
      const plan = await getCurrentWeekPlan();
      setWeekPlan(plan);
    } catch (error) {
      console.error('Error loading week plan:', error);
    }
  };

  const importFromWeekPlan = async () => {
    if (!weekPlan) return;

    setImporting(true);
    try {
      const aggregatedIngredients = await getAggregatedShoppingList(weekPlan.id);

      // Add aggregated ingredients to shopping list (avoid duplicates)
      const existingNames = new Set(items.map(i => i.name.toLowerCase()));
      const newItems = [...items];

      aggregatedIngredients.forEach(ingredient => {
        // Format as "quantity unit item" (e.g., "2 cups flour")
        const itemName = [ingredient.quantity, ingredient.unit, ingredient.item].filter(Boolean).join(' ');

        if (!existingNames.has(itemName.toLowerCase())) {
          newItems.push({
            id: Date.now() + Math.random(),
            name: itemName,
            purchased: false,
            fromWeekPlan: true
          });
        }
      });

      setItems(newItems);
    } catch (error) {
      console.error('Error importing from week plan:', error);
      alert('Failed to import ingredients from week plan');
    } finally {
      setImporting(false);
    }
  };

  const clearPurchased = () => {
    setItems(items.filter(item => !item.purchased));
  };

  const addItem = () => {
    if (newItem.trim()) {
      setItems([...items, {
        id: Date.now(),
        name: newItem,
        purchased: false,
        fromWeekPlan: false
      }]);
      setNewItem('');
    }
  };

  const togglePurchased = (id) => {
    setItems(items.map(item =>
      item.id === id ? { ...item, purchased: !item.purchased } : item
    ));
  };

  const deleteItem = (id) => {
    setItems(items.filter(item => item.id !== id));
  };

  const toBuy = items.filter(item => !item.purchased);
  const purchased = items.filter(item => item.purchased);

  return (
    <div className="shopping-list">
      <h2>Shopping List</h2>

      {/* Auto-import from week plan */}
      {weekPlan && weekPlan.meals && weekPlan.meals.length > 0 && (
        <div className="import-section">
          <button
            className="import-btn"
            onClick={importFromWeekPlan}
            disabled={importing}
          >
            {importing ? 'Importing...' : '📋 Import from Week Plan'}
          </button>
          <p className="import-hint">
            Auto-populate from {weekPlan.meals.length} meal{weekPlan.meals.length !== 1 ? 's' : ''} in this week's plan with smart quantity aggregation
          </p>
        </div>
      )}

      {/* Manual add */}
      <div className="add-item">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && addItem()}
          placeholder="Add item..."
        />
        <button onClick={addItem}>Add</button>
      </div>

      {/* To Buy Section */}
      <div className="list-section">
        <div className="section-header">
          <h3>To Buy ({toBuy.length})</h3>
          {purchased.length > 0 && (
            <button className="clear-btn" onClick={clearPurchased}>
              Clear Purchased
            </button>
          )}
        </div>
        <div className="items">
          {toBuy.length === 0 ? (
            <p className="no-items">No items to buy. Add items or import from week plan!</p>
          ) : (
            toBuy.map(item => (
              <div key={item.id} className="item">
                <input
                  type="checkbox"
                  checked={item.purchased}
                  onChange={() => togglePurchased(item.id)}
                />
                <span className={item.fromWeekPlan ? 'from-week' : ''}>
                  {item.name}
                  {item.fromWeekPlan && <span className="badge">from plan</span>}
                </span>
                <button onClick={() => deleteItem(item.id)}>×</button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Purchased Section */}
      {purchased.length > 0 && (
        <div className="list-section">
          <h3>Purchased ({purchased.length})</h3>
          <div className="items">
            {purchased.map(item => (
              <div key={item.id} className="item purchased">
                <input
                  type="checkbox"
                  checked={item.purchased}
                  onChange={() => togglePurchased(item.id)}
                />
                <span>{item.name}</span>
                <button onClick={() => deleteItem(item.id)}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ShoppingList;
