import { useEffect, useRef, useState } from 'react';
import Button from './ui/Button.jsx';
import { AlertIcon } from './ui/icons.jsx';
import { QUANTITY_ERROR, checkQuantityText, composeAmount } from '../utils/format';
import './PutAwayPanel.css';

const DESTINATIONS = [
  { value: 'fridge', label: 'Fridge' },
  { value: 'pantry', label: 'Pantry' },
  { value: 'keep', label: 'Keep on list' }
];

// Inline expanding region (not a dialog) for choosing where each bought item goes.
// The parent owns the stock and entry changes: putAway(item, amount, dest, previousAttempt)
// resolves with the saved entry (or null for Keep on list) and throws a readable error on failure.
export default function PutAwayPanel({ id, items, defaultsFor, putAway, onBusyChange, onClose }) {
  const [overrides, setOverrides] = useState({}); // item id -> { quantity?, dest? }
  const [errors, setErrors] = useState({}); // item id -> message
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [focusId, setFocusId] = useState(null); // item whose quantity field takes focus after a failed submit
  const headingRef = useRef(null);
  const summaryRef = useRef(null);
  const inputRefs = useRef({});
  const attempts = useRef({}); // last failed attempt per item, so a retry with new values reverts first
  const credited = useRef([]); // everything credited since the panel opened, across retries

  useEffect(() => {
    const node = headingRef.current;
    if (!node) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    node.focus({ preventScroll: true });
  }, []);

  const rowFor = (item) => ({ ...defaultsFor(item), ...(overrides[item.id] || {}) });
  const setRow = (item, change) => {
    setOverrides(current => ({ ...current, [item.id]: { ...(current[item.id] || {}), ...change } }));
  };

  // Ready to stock: a place is chosen and a quantity is filled in. Keep on list needs neither.
  const isStock = (row) => row.dest === 'fridge' || row.dest === 'pantry';
  const stockCount = items.filter(item => {
    const row = rowFor(item);
    return isStock(row) && row.quantity.trim() !== '';
  }).length;
  const notReady = items.filter(item => {
    const row = rowFor(item);
    return row.dest !== 'keep' && !(isStock(row) && row.quantity.trim() !== '');
  }).length;

  const close = (finished) => onClose({ credited: credited.current, finished });

  // After a failed submit the Put away button is disabled and drops focus: move it to the first
  // invalid quantity field, or the summary line, once the form is enabled again.
  useEffect(() => {
    if (focusId === null || busy) return;
    const node = inputRefs.current[focusId] || summaryRef.current;
    if (node) node.focus();
    setFocusId(null);
  }, [focusId, busy]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setSummary('');
    const failed = {};
    let done = 0;
    for (const item of items) {
      const row = rowFor(item);
      if (!row.dest) continue;
      const quantity = row.quantity.trim();
      // No quantity yet: the item stays in the waiting list rather than being an error.
      if (row.dest !== 'keep' && !quantity) continue;
      if (row.dest !== 'keep' && checkQuantityText(quantity) !== 'ok') {
        failed[item.id] = QUANTITY_ERROR;
        continue;
      }
      const attempt = { amount: row.dest === 'keep' ? '' : composeAmount(quantity, row.name), dest: row.dest };
      try {
        const saved = await putAway(item, attempt.amount, row.dest, attempts.current[item.id]);
        delete attempts.current[item.id];
        if (saved) credited.current.push(saved);
        done += 1;
      } catch (err) {
        attempts.current[item.id] = attempt;
        failed[item.id] = err.message || 'Could not save this item.';
      }
    }
    setErrors(failed);
    setBusy(false);
    onBusyChange(false);
    const failIds = Object.keys(failed);
    if (failIds.length > 0) {
      setSummary(`${done} put away, ${failIds.length} couldn't be saved. Try again.`);
      const first = items.find(item => failed[item.id] !== undefined);
      setFocusId(first ? first.id : 'summary');
      return;
    }
    close(true);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && !busy) {
      event.stopPropagation();
      close(false);
    }
  };

  const primaryLabel = busy
    ? 'Putting away...'
    : stockCount === 0 ? 'Done' : `Put away ${stockCount} ${stockCount === 1 ? 'item' : 'items'}`;

  return (
    <form
      id={id}
      className="put-away"
      role="region"
      aria-labelledby={`${id}-heading`}
      onSubmit={submit}
      onKeyDown={onKeyDown}
      noValidate
    >
      <h3 className="put-away__heading" id={`${id}-heading`} ref={headingRef} tabIndex={-1}>Put away groceries</h3>
      <p className="put-away__hint">
        Choose where each item goes. Keep on list marks it bought without adding it to stock.
      </p>
      <ul className="put-away__rows">
        {items.map(item => {
          const row = rowFor(item);
          const error = errors[item.id];
          const errorId = `${id}-error-${item.id}`;
          const amountId = `${id}-amount-${item.id}`;
          const missingQuantity = isStock(row) && row.quantity.trim() === '';
          return (
            <li key={item.id} className="put-away__row">
              <p className="put-away__name">{item.name}</p>
              <div className="put-away__field">
                <label className="put-away__label" htmlFor={amountId}>Quantity of {row.name}</label>
                <input
                  id={amountId}
                  ref={(node) => { if (node) inputRefs.current[item.id] = node; else delete inputRefs.current[item.id]; }}
                  className="put-away__input"
                  type="text"
                  value={row.quantity}
                  placeholder="e.g. 6 or 2 lb"
                  disabled={busy || row.dest === 'keep'}
                  onChange={(e) => {
                    setRow(item, { quantity: e.target.value });
                    if (errors[item.id]) setErrors(({ [item.id]: _cleared, ...rest }) => rest);
                  }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                />
                {missingQuantity && <p className="put-away__pick">Add a quantity to put this away</p>}
              </div>
              <fieldset className="put-away__place" disabled={busy}>
                <legend className="put-away__label">Where does {item.name} go?</legend>
                <div className="put-away__choices">
                  {DESTINATIONS.map(option => (
                    <label key={option.value} className="put-away__choice">
                      <input
                        type="radio"
                        name={`${id}-dest-${item.id}`}
                        value={option.value}
                        checked={row.dest === option.value}
                        onChange={() => setRow(item, { dest: option.value })}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                {!row.dest && <p className="put-away__pick">Pick a place</p>}
              </fieldset>
              {error && (
                <p className="put-away__error" id={errorId} role="alert">
                  <AlertIcon size={18} />
                  <span>{error}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {notReady > 0 && stockCount > 0 && (
        <p className="put-away__hint">
          {notReady} {notReady === 1 ? 'item is' : 'items are'} missing a place or a quantity and will stay here.
        </p>
      )}
      {summary && <p className="put-away__summary" role="status" tabIndex={-1} ref={summaryRef}>{summary}</p>}
      <div className="put-away__actions">
        <Button type="submit" disabled={busy}>{primaryLabel}</Button>
        <Button variant="secondary" onClick={() => close(false)} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}
