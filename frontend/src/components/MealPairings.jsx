import { useEffect, useState } from 'react';
import { getPairings, trackIngredient, removeTrackedIngredient } from '../api';

export default function MealPairings({ week, selectedSource, onSelectSource, nextWeek, onAddMeal }) {
  const [pairings, setPairings] = useState([]);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const source = week.meals.some(meal => String(meal.id) === selectedSource) ? selectedSource : '';

  useEffect(() => {
    let active = true;
    getPairings(week.id)
      .then(rows => { if (active) setPairings(rows); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [week]);

  async function run(action) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="meal-pairings" aria-labelledby="pairing-heading">
      <h3 id="pairing-heading">Use up an ingredient</h3>
      <form onSubmit={event => {
        event.preventDefault();
        run(async () => {
          setPairings(await trackIngredient(week.id, amount.trim(), source ? Number(source) : null));
          setAmount('');
        });
      }}>
        <label>
          Ingredient left over
          <input value={amount} onChange={event => setAmount(event.target.value)}
            placeholder="1/2 head of cabbage" maxLength={200} required />
        </label>
        <label>
          Where it came from
          <select value={source} onChange={event => onSelectSource(event.target.value)}>
            <option value="">Already on hand</option>
            {week.meals.map(meal => <option key={meal.id} value={meal.id}>{meal.name}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy || !amount.trim()}>Find meals</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pairings.map(row => (
        <article key={row.id}>
          <h4>{row.remaining || row.amount}</h4>
          <p>{row.carried ? 'Carried from last week' : row.source ? `Left over from ${row.source}` : 'On hand'}</p>
          {row.needs_more && (
            <p role="status" className="needs-more">Planned meals need {row.shortfall} more than you have</p>
          )}
          {!row.remaining && !row.needs_more && <p>Used by meals already in the plan.</p>}
          {row.remaining && !row.current.length && !row.next_week.length && <p>No matching meals in your library.</p>}
          {[[row.current, nextWeek ? 'next week' : 'this week', false], [row.next_week, nextWeek ? 'the following week' : 'next week', true]].map(([meals, label, next]) => (
            meals.length > 0 && <ul key={label} aria-label={`Suggestions for ${label}`}>
              {meals.map(meal => (
                <li key={meal.meal_id}>
                  <div>
                    <strong>{meal.name}</strong>
                    <p>Uses {meal.uses}{meal.extra && ` · Needs ${meal.extra} more`}</p>
                  </div>
                  <button disabled={busy} onClick={() => run(async () => {
                    await onAddMeal(meal.meal_id, next);
                    setPairings(await getPairings(week.id));
                    setNotice(`Added ${meal.name} to ${label}.`);
                  })}>Add to {label}</button>
                </li>
              ))}
            </ul>
          ))}
          <button disabled={busy} onClick={() => run(async () => {
            await removeTrackedIngredient(row.id);
            setPairings(await getPairings(week.id));
          })}>Stop tracking</button>
        </article>
      ))}
    </section>
  );
}
