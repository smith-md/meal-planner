import { useEffect, useRef, useState } from 'react';
import { getStockSuggestions } from '../api';

function afterText(meals) {
  return meals.map(meal => (meal.day ? `${meal.name} (${meal.day})` : meal.name)).join(', ');
}

function sourceLabel(use) {
  if (use.source === 'projected') return `Projected: left after ${afterText(use.after_meals)}`;
  if (!use.locations.length) return 'In stock';
  return use.locations.map(place => `In ${place}`).join(' and ');
}

export default function StockSuggestions({ week, onAdd }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fetching, setFetching] = useState(false);
  const headingRef = useRef(null);

  useEffect(() => {
    let active = true;
    setFetching(true);
    getStockSuggestions(week.id)
      .then(data => { if (active) { setResult(data); setError(''); setFetching(false); } })
      .catch(err => { if (active) { setError(err.message); setFetching(false); } });
    return () => { active = false; };
  }, [week]);

  const label = result && result.position === 'this' ? 'this week'
    : result && result.position === 'next' ? 'next week' : 'this planned week';

  async function add(meal) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await onAdd(meal.meal_id);
      setNotice(`Added ${meal.name} to ${label}.`);
      if (headingRef.current) headingRef.current.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`stock-suggestions${fetching ? ' stock-refreshing' : ''}`}
      aria-labelledby="stock-heading"
      aria-busy={fetching}
    >
      <h3 id="stock-heading" tabIndex={-1} ref={headingRef}>Cook from what you have</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {result && result.suggestions.length === 0 && !error && (
        <p>
          {result.remainders && result.remainders.length > 0
            ? 'No other saved meals use your stock. Meals already in this week are not suggested.'
            : 'Nothing in stock to cook from yet.'}
        </p>
      )}
      {result && result.suggestions.map(meal => (
        <article key={meal.meal_id}>
          <div className="stock-suggestion-head">
            <div>
              <h4>{meal.name}</h4>
              <p>Uses {meal.covered_count} of {meal.ingredient_count} ingredients from stock</p>
            </div>
            <button disabled={busy || fetching} onClick={() => add(meal)}>Add to {label}</button>
          </div>
          <h5>From stock</h5>
          <ul>
            {meal.uses.map(use => (
              <li key={use.key}>
                <span>{use.used} {use.item}</span>
                <span className={`stock-badge stock-${use.source}`}>{sourceLabel(use)}</span>
              </li>
            ))}
          </ul>
          {meal.groceries.length > 0 && (
            <>
              <h5>Also buy</h5>
              <ul>
                {meal.groceries.map(item => (
                  <li key={item.key}>{item.partial ? `${item.name} (rest of)` : item.name}</li>
                ))}
              </ul>
            </>
          )}
          {meal.unmeasured.length > 0 && <p>Check: {meal.unmeasured.join(', ')}</p>}
        </article>
      ))}
    </section>
  );
}
