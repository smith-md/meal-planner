import { useState, useEffect } from 'react';
import {
  getCurrentWeekPlan,
  getAggregatedShoppingList,
  getInventory,
  recordPurchase,
  revertPurchase
} from '../api';
import './ShoppingList.css';

const HAS_QUANTITY = /^\s*[\d½¼¾⅓⅔⅛]/;

function newPurchaseId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Saved lists from before the inventory feature lack the new fields. Old purchased
// items are never credited retroactively.
function normalizeItem(item) {
  return {
    ...item,
    credit: item.credit || null,
    purchaseId: item.purchaseId || newPurchaseId()
  };
}

function loadSavedItems() {
  try {
    const saved = JSON.parse(localStorage.getItem('shoppingList'));
    return Array.isArray(saved) ? saved.filter(item => item && typeof item.name === 'string').map(normalizeItem) : [];
  } catch (error) {
    return [];
  }
}

// The amount to credit if it is known, e.g. "2 cups flour". Null when the quantity is missing.
function plannedAmount(item) {
  if (item.fromWeekPlan && item.item !== undefined) {
    if (!item.quantity) return null;
    return [item.quantity, item.unit, item.item].filter(Boolean).join(' ');
  }
  return HAS_QUANTITY.test(item.name) ? item.name : null;
}

function ShoppingList() {
  const [items, setItems] = useState(loadSavedItems);
  const [newItem, setNewItem] = useState('');
  const [weekPlan, setWeekPlan] = useState(null);
  const [importing, setImporting] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [checkout, setCheckout] = useState(null); // { id, amount, location }
  const [error, setError] = useState(null); // { id, message }

  useEffect(() => {
    loadWeekPlan();
    refreshInventory();
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

  const refreshInventory = async () => {
    try {
      setInventory(await getInventory());
    } catch (error) {
      console.error('Error loading inventory:', error);
    }
  };

  // A location is known only when the item is already stocked in exactly one place.
  const knownLocation = (item) => {
    if (item.item === undefined) return '';
    const locations = new Set(inventory.filter(row => row.item === item.item).map(row => row.location));
    return locations.size === 1 ? [...locations][0] : '';
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
        const baseName = [ingredient.quantity, ingredient.unit, ingredient.item].filter(Boolean).join(' ');
        const itemName = ingredient.note ? `${baseName} (${ingredient.note})` : baseName;

        if (!existingNames.has(itemName.toLowerCase())) {
          newItems.push({
            id: Date.now() + Math.random(),
            name: itemName,
            purchased: false,
            fromWeekPlan: true,
            quantity: ingredient.quantity,
            unit: ingredient.unit,
            item: ingredient.item,
            note: ingredient.note,
            purchaseId: newPurchaseId(),
            credit: null
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

  // Clearing purchased entries only edits the local list; credited stock stays on the server.
  const clearPurchased = () => {
    setItems(items.filter(item => !item.purchased));
  };

  const addItem = () => {
    if (newItem.trim()) {
      setItems([...items, {
        id: Date.now(),
        name: newItem,
        purchased: false,
        fromWeekPlan: false,
        purchaseId: newPurchaseId(),
        credit: null
      }]);
      setNewItem('');
    }
  };

  const updateItem = (id, changes) => {
    setItems(current => current.map(item => (item.id === id ? { ...item, ...changes } : item)));
  };

  const creditItem = async (item, amount, location) => {
    setBusyId(item.id);
    setError(null);
    try {
      // The item's stored purchaseId is reused on retries, so the server credits it once.
      const result = await recordPurchase(item.purchaseId, amount, location);
      updateItem(item.id, { purchased: true, credit: { amount: result.amount, location: result.location } });
      setCheckout(null);
      refreshInventory();
    } catch (err) {
      setError({ id: item.id, message: err.message });
      setCheckout({ id: item.id, amount, location });
    } finally {
      setBusyId(null);
    }
  };

  const revertItem = async (item) => {
    setBusyId(item.id);
    setError(null);
    try {
      if (item.credit) {
        await revertPurchase(item.purchaseId);
        refreshInventory();
      }
      // The reverted id is spent, so the next check-off gets a fresh one.
      updateItem(item.id, { purchased: false, credit: null, purchaseId: newPurchaseId() });
      return true;
    } catch (err) {
      setError({ id: item.id, message: err.message });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const togglePurchased = async (item) => {
    if (busyId !== null) return;
    if (item.purchased) {
      await revertItem(item);
      return;
    }
    const amount = plannedAmount(item);
    const location = knownLocation(item);
    if (amount && location) {
      await creditItem(item, amount, location);
    } else {
      setError(null);
      setCheckout({ id: item.id, amount: amount || (item.item !== undefined ? item.item : item.name), location });
    }
  };

  const editCredit = async (item) => {
    if (busyId !== null) return;
    const credit = item.credit;
    if (await revertItem(item)) {
      setCheckout({ id: item.id, amount: credit.amount, location: credit.location });
    }
  };

  const saveCheckout = (item) => {
    if (busyId !== null) return;
    if (!checkout.amount.trim() || !checkout.location) {
      setError({ id: item.id, message: 'Enter an amount like 2 cups of rice and choose fridge or pantry.' });
      return;
    }
    creditItem(item, checkout.amount.trim(), checkout.location);
  };

  const markWithoutInventory = (item) => {
    updateItem(item.id, { purchased: true, credit: null });
    setCheckout(null);
    setError(null);
  };

  const cancelCheckout = () => {
    setCheckout(null);
    setError(null);
  };

  const deleteItem = (id) => {
    setItems(items.filter(item => item.id !== id));
    if (checkout && checkout.id === id) setCheckout(null);
  };

  const toBuy = items.filter(item => !item.purchased);
  const purchased = items.filter(item => item.purchased);

  const renderError = (item) =>
    error && error.id === item.id ? <p className="checkout-error" role="alert">{error.message}</p> : null;

  const renderCheckout = (item) => (
    <div className="checkout-panel">
      <p className="checkout-hint">Confirm what you bought so it is added to your fridge or pantry.</p>
      <label>
        Amount bought
        <input
          type="text"
          value={checkout.amount}
          onChange={(e) => setCheckout({ ...checkout, amount: e.target.value })}
          placeholder="e.g. 2 cups rice"
        />
      </label>
      <label>
        Store in
        <select
          value={checkout.location}
          onChange={(e) => setCheckout({ ...checkout, location: e.target.value })}
        >
          <option value="">Choose...</option>
          <option value="fridge">Fridge</option>
          <option value="pantry">Pantry</option>
        </select>
      </label>
      {renderError(item)}
      <div className="checkout-actions">
        <button className="checkout-save" onClick={() => saveCheckout(item)} disabled={busyId !== null}>
          Save
        </button>
        <button onClick={() => markWithoutInventory(item)} disabled={busyId !== null}>
          Mark purchased without adding to inventory
        </button>
        <button onClick={cancelCheckout} disabled={busyId !== null}>Cancel</button>
      </div>
    </div>
  );

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
          {weekPlan.meals.some(meal => meal.yield_servings == null) && (
            <p className="import-hint">
              No yield set for {weekPlan.meals.filter(meal => meal.yield_servings == null).map(meal => meal.name).join(', ')}.
              Their quantities are used as written, not scaled by planned servings.
            </p>
          )}
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
              <div key={item.id} className="item-wrap">
                <div className="item">
                  <input
                    type="checkbox"
                    checked={item.purchased}
                    disabled={busyId !== null}
                    onChange={() => togglePurchased(item)}
                  />
                  <span className={item.fromWeekPlan ? 'from-week' : ''}>
                    {item.name}
                    {item.fromWeekPlan && <span className="badge">from plan</span>}
                  </span>
                  <button onClick={() => deleteItem(item.id)}>×</button>
                </div>
                {checkout && checkout.id === item.id ? renderCheckout(item) : renderError(item)}
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
              <div key={item.id} className="item-wrap">
                <div className="item purchased">
                  <input
                    type="checkbox"
                    checked={item.purchased}
                    disabled={busyId !== null}
                    onChange={() => togglePurchased(item)}
                  />
                  <span>
                    {item.name}
                    {item.credit && (
                      <span className="credit-note">
                        added {item.credit.amount} to {item.credit.location}
                      </span>
                    )}
                  </span>
                  {item.credit && (
                    <button className="edit-credit" onClick={() => editCredit(item)} disabled={busyId !== null}>
                      Edit
                    </button>
                  )}
                  <button onClick={() => deleteItem(item.id)}>×</button>
                </div>
                {renderError(item)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ShoppingList;
