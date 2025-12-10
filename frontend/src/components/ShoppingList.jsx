import { useState, useEffect } from 'react';
import './ShoppingList.css';

function ShoppingList() {
  const [items, setItems] = useState([]);
  const [newItem, setNewItem] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('shoppingList');
    if (saved) {
      setItems(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('shoppingList', JSON.stringify(items));
  }, [items]);

  const addItem = () => {
    if (newItem.trim()) {
      setItems([...items, { id: Date.now(), name: newItem, purchased: false }]);
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

      <div className="list-section">
        <h3>To Buy ({toBuy.length})</h3>
        <div className="items">
          {toBuy.map(item => (
            <div key={item.id} className="item">
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
