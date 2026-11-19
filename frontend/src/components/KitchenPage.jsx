import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { consumeInventory, getAvailability, getInventory, getStaples, returnInventory, setInventoryQuantity } from '../api';
import { useGroceryEntries } from './GroceryEntriesContext';
import {
  Button, EmptyState, ErrorState, InlineEditable, SegmentedControl, Skeleton, StatusPill, useToast
} from './ui';
import { formatAddedDate, formatQuantity, formatQuantityText, parseQuantityText, shortDayName } from '../utils/format';
import './KitchenPage.css';

const TABS = [
  { value: 'fridge', label: 'Fridge' },
  { value: 'pantry', label: 'Pantry' }
];
const TAB_NAMES = { fridge: 'Fridge', pantry: 'Pantry' };
const EPSILON = 1e-6;

// The tab lives in the address (#/kitchen?tab=pantry) so refresh and shared links keep it.
function tabFromHash() {
  const query = window.location.hash.split('?')[1] || '';
  const tab = new URLSearchParams(query.split('#')[0]).get('tab');
  return TABS.some(option => option.value === tab) ? tab : 'fridge';
}

const byName = (a, b) => a.item.localeCompare(b.item, undefined, { sensitivity: 'base' }) || a.id - b.id;

// Availability is per ingredient (item + unit group), so every Kitchen row of it gets the pill.
const shortKey = row => `${row.item}\u0000${row.unit_group}`;

const mealLabel = meal => `${meal.name}${meal.day ? ` (${shortDayName(meal.day)})` : ''}`;

// "1 head on hand, ½ head reserved for Slaw (Tue)". Each meal shows the amount the API gave for it.
function reservedLine(row) {
  const meals = row.reserved_by || [];
  if (meals.length === 0) return '';
  const onHand = `${formatQuantityText(row.quantity, row.unit) || '0'} on hand`;
  const reserved = meals.map(meal => `${formatQuantityText(meal.amount, row.unit)} reserved for ${mealLabel(meal)}`);
  return `${onHand}, ${reserved.join(', ')}`;
}

function KitchenRow({ row, short, onCount, onUsedUp, onUse, error, clearError }) {
  const [panel, setPanel] = useState(null); // null | 'menu' | 'use'
  const [amount, setAmount] = useState('');
  const [useError, setUseError] = useState('');
  const [busy, setBusy] = useState(false);
  const rowRef = useRef(null);
  const trigger = useRef(null);
  const amountInput = useRef(null);
  const panelId = useId();
  const amountId = useId();
  const useErrorId = useId();

  const empty = (parseQuantityText(row.quantity) ?? 0) < EPSILON;
  const reserved = row.reserved_by || [];
  const line = reservedLine(row);
  const added = formatAddedDate(row.added_at);
  const quantityText = formatQuantityText(row.quantity, row.unit) || '0';

  useEffect(() => {
    if (panel === 'use') amountInput.current?.focus();
  }, [panel]);

  const closePanel = () => {
    setPanel(null);
    setUseError('');
    setAmount('');
    trigger.current?.focus();
  };

  const onPanelKeyDown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel();
    }
  };

  const submitUse = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onUse(row, amount.trim());
      setPanel(null);
      setUseError('');
      setAmount('');
    } catch (err) {
      setUseError(err && err.message ? err.message : 'Could not save that.');
      amountInput.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const correctCount = () => {
    setPanel(null);
    rowRef.current?.querySelector('.ui-inline-editable__value')?.click();
  };

  return (
    <li className="kitchen-row" data-kitchen-row={row.id} ref={rowRef}>
      <div className="kitchen-row__head">
        <span className="kitchen-row__name">{row.item}</span>
        <InlineEditable
          className="kitchen-row__quantity"
          label={`Quantity of ${row.item}`}
          value={quantityText}
          editValue={row.quantity}
          placeholder="2 or 1/2"
          onSave={text => { clearError(); return onCount(row, text); }}
        />
      </div>

      <div className="kitchen-row__pills">
        {row.low && (empty ? <StatusPill status="danger">Out</StatusPill> : <StatusPill status="warn">Low</StatusPill>)}
        {short && <StatusPill status="warn">Needs more</StatusPill>}
        {reserved.length === 1 && <StatusPill status="neutral">{`Reserved for ${mealLabel(reserved[0])}`}</StatusPill>}
        {reserved.length > 1 && <StatusPill status="neutral">{`Reserved for ${reserved.length} meals`}</StatusPill>}
      </div>

      <p className="kitchen-row__meta">
        {TAB_NAMES[row.location] || row.location}
        {added && <span> &middot; {added}</span>}
      </p>
      {line && <p className="kitchen-row__reserved">{line}</p>}
      {error && <p className="kitchen-row__error" role="alert">{error}</p>}

      <div className="kitchen-row__adjust">
        <Button
          ref={trigger}
          variant="secondary"
          aria-expanded={panel !== null}
          aria-controls={panelId}
          onClick={() => (panel ? closePanel() : setPanel('menu'))}
        >
          Adjust<span className="kitchen-row__sr"> {row.item}</span>
        </Button>
        <div id={panelId} hidden={panel === null} onKeyDown={onPanelKeyDown} className="kitchen-row__panel">
          {panel === 'menu' && (
            <div className="kitchen-row__actions">
              <Button variant="quiet" onClick={() => setPanel('use')}>
                Use some<span className="kitchen-row__sr"> of {row.item}</span>
              </Button>
              <Button variant="quiet" onClick={() => { setPanel(null); onUsedUp(row); }}>
                Used up<span className="kitchen-row__sr">: {row.item}</span>
              </Button>
              <Button variant="quiet" onClick={correctCount}>
                Correct count<span className="kitchen-row__sr"> of {row.item}</span>
              </Button>
            </div>
          )}
          {panel === 'use' && (
            <form className="kitchen-use" onSubmit={submitUse}>
              <label className="kitchen-use__label" htmlFor={amountId}>
                {`How much ${row.item} did you use?`}
              </label>
              <div className="kitchen-use__controls">
                <input
                  id={amountId}
                  ref={amountInput}
                  className="kitchen-use__input"
                  value={amount}
                  inputMode="text"
                  autoComplete="off"
                  placeholder="1/2"
                  aria-invalid={useError ? true : undefined}
                  aria-describedby={useError ? useErrorId : undefined}
                  onChange={event => setAmount(event.target.value)}
                />
                {row.unit && <span className="kitchen-use__unit">{row.unit}</span>}
                <Button type="submit" variant="primary" loading={busy}>Use</Button>
                <Button variant="quiet" onClick={closePanel}>Cancel</Button>
              </div>
              {useError && <p className="kitchen-row__error" id={useErrorId} role="alert">{useError}</p>}
            </form>
          )}
        </div>
      </div>
    </li>
  );
}

function RowList({ rows, shortKeys, errors, clearError, ...handlers }) {
  return (
    <ul className="kitchen-list">
      {rows.map(row => (
        <KitchenRow key={row.id} row={row} short={shortKeys.has(shortKey(row))} error={errors[row.id]} clearError={() => clearError(row.id)} {...handlers} />
      ))}
    </ul>
  );
}

export default function KitchenPage() {
  const { refreshKitchenStatus } = useGroceryEntries();
  const toast = useToast();
  const [tab, setTab] = useState(tabFromHash);
  const [rows, setRows] = useState(null);
  const [staples, setStaples] = useState(null);
  const [shortKeys, setShortKeys] = useState(() => new Set()); // ingredients short for planned meals
  const [loadError, setLoadError] = useState('');
  const [staplesFailed, setStaplesFailed] = useState(false);
  const [rowErrors, setRowErrors] = useState({});
  const loadToken = useRef(0);
  const pendingFocus = useRef(null);
  const orderedIds = useRef([]);
  const headingId = useId();

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const chooseTab = useCallback(value => {
    setTab(value);
    // replace, not push: Back should leave the Kitchen, not step through every toggle.
    window.history.replaceState(null, '', `#/kitchen?tab=${value}`);
  }, []);

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    const [inventory, stapleList, availability] = await Promise.allSettled([
      getInventory(), getStaples(), getAvailability()
    ]);
    if (token !== loadToken.current) return false;
    if (stapleList.status === 'fulfilled') {
      setStaples(stapleList.value);
      setStaplesFailed(false);
    } else {
      setStaplesFailed(true);
    }
    // A failed availability check shows no "Needs more" pill and no error.
    setShortKeys(availability.status === 'fulfilled' && Array.isArray(availability.value)
      ? new Set(availability.value.filter(row => row.short).map(shortKey))
      : new Set());
    if (inventory.status === 'rejected') {
      setLoadError(inventory.reason?.message || 'Could not load the kitchen.');
      return false;
    }
    setRows(inventory.value);
    setLoadError('');
    refreshKitchenStatus();
    return true;
  }, [refreshKitchenStatus]);

  useEffect(() => {
    load();
    return () => { loadToken.current += 1; };
  }, [load]);

  const retry = () => {
    setLoadError('');
    load();
  };

  const view = useMemo(() => {
    const listFor = value => {
      const inLocation = (rows || []).filter(row => row.location === value);
      const known = new Set(inLocation.map(row => row.id));
      // Staples at zero are not in /inventory; they are shown as Out so the nav dot leads somewhere.
      const out = (staples || [])
        .filter(row => row.location === value && row.low && !known.has(row.id))
        .map(row => ({ ...row, added_at: null, reserved: '0', reserved_by: [] }));
      const all = [...inLocation, ...out];
      return {
        low: all.filter(row => row.low).sort(byName),
        rest: all.filter(row => !row.low).sort(byName)
      };
    };
    return { current: listFor(tab), counts: { fridge: listFor('fridge'), pantry: listFor('pantry') } };
  }, [rows, staples, tab]);

  orderedIds.current = [...view.current.low, ...view.current.rest].map(row => row.id);

  const options = TABS.map(option => {
    const lists = view.counts[option.value];
    const count = lists.low.length + lists.rest.length;
    return { ...option, label: rows ? `${option.label} (${count})` : option.label };
  });

  const focusAfter = useCallback(() => {
    const pending = pendingFocus.current;
    pendingFocus.current = null;
    if (!pending) return;
    const find = id => document.querySelector(`[data-kitchen-row="${id}"]`);
    const own = find(pending.id);
    const target = own
      ? own.querySelector(pending.target === 'adjust' ? '.kitchen-row__adjust > button' : '.ui-inline-editable__value')
      : (pending.nextId != null ? find(pending.nextId)?.querySelector('.ui-inline-editable__value') : null);
    (target || document.getElementById('page-title'))?.focus();
  }, []);

  // Applied once the refetched rows have rendered.
  useEffect(() => { if (pendingFocus.current && rows) focusAfter(); }, [rows, staples, focusAfter]);

  const nextIdAfter = id => {
    const ids = orderedIds.current;
    const at = ids.indexOf(id);
    return at >= 0 && at + 1 < ids.length ? ids[at + 1] : null;
  };

  const refetch = async () => {
    const ok = await load();
    if (!ok) focusAfter();
  };

  const undoToast = (message, undo, row) => {
    toast.show({
      message,
      actionLabel: 'Undo',
      // The control focused when the toast appeared is unmounted by then; fall back to the row's Adjust button.
      returnFocus: () =>
        document.querySelector('[data-kitchen-row="' + row.id + '"] .kitchen-row__adjust > button') ||
        document.getElementById('page-title'),
      onAction: async () => {
        try {
          await undo();
          pendingFocus.current = { id: row.id, target: 'adjust', nextId: null };
          await refetch();
        } catch (err) {
          toast.show({ message: err && err.message ? err.message : `Could not undo that for ${row.item}.` });
        }
      }
    });
  };

  const setRowError = (id, message) => setRowErrors(errors => ({ ...errors, [id]: message }));
  const clearError = id => setRowErrors(errors => (errors[id] ? { ...errors, [id]: '' } : errors));

  const markUsedUp = async row => {
    const prior = row.quantity;
    await setInventoryQuantity(row.id, '0');
    undoToast(`Used up ${row.item}`, () => setInventoryQuantity(row.id, prior), row);
    pendingFocus.current = { id: row.id, target: 'qty', nextId: nextIdAfter(row.id) };
    await refetch();
  };

  const onCount = async (row, text) => {
    const number = parseQuantityText(text);
    if (number === null) throw new Error('Enter a quantity like 2 or 1/2.');
    if (number < EPSILON) {
      await markUsedUp(row);
      return;
    }
    await setInventoryQuantity(row.id, text);
    await refetch();
  };

  const onUsedUp = async row => {
    clearError(row.id);
    try {
      await markUsedUp(row);
    } catch (err) {
      setRowError(row.id, err && err.message ? err.message : `Could not mark ${row.item} used up.`);
    }
  };

  const onUse = async (row, text) => {
    const number = parseQuantityText(text);
    if (number === null || number < EPSILON) throw new Error('Enter an amount like 2 or 1/2.');
    const have = parseQuantityText(row.quantity) ?? 0;
    if (number > have + EPSILON) throw new Error(`You only have ${formatQuantity(have, row.unit) || '0'}`);
    const { removed } = await consumeInventory(row.id, text);
    if ((parseQuantityText(removed) ?? 0) > EPSILON) {
      undoToast(
        `Used ${formatQuantityText(removed, row.unit)} of ${row.item}`,
        () => returnInventory(row.id, removed),
        row
      );
    }
    pendingFocus.current = { id: row.id, target: 'adjust', nextId: nextIdAfter(row.id) };
    await refetch();
  };

  const handlers = { shortKeys, onCount, onUsedUp, onUse, errors: rowErrors, clearError };
  const { low, rest } = view.current;
  const place = TAB_NAMES[tab].toLowerCase();
  const loading = rows === null && !loadError;

  return (
    <div className="kitchen-page">
      <SegmentedControl label="Kitchen location" options={options} value={tab} onChange={chooseTab} className="kitchen-page__tabs" />

      {rows !== null && loadError && (
        <p className="kitchen-page__notice" role="alert">
          {loadError} <Button variant="quiet" onClick={retry}>Retry</Button>
        </p>
      )}
      {rows !== null && staplesFailed && (
        <p className="kitchen-page__notice" role="alert">
          Could not check which staples are out, so empty staples may be missing. <Button variant="quiet" onClick={retry}>Retry</Button>
        </p>
      )}

      {loading && <Skeleton rows={4} label="Loading your kitchen" />}
      {rows === null && loadError && <ErrorState message={loadError} retryLabel="Retry" onRetry={retry} />}

      {rows !== null && low.length === 0 && rest.length === 0 && (
        <EmptyState
          message={`Nothing in the ${place} yet. Groceries you put away from your Shop list show up here.`}
          actionLabel="Go to Shop"
          onAction={() => { window.location.hash = '#/shop'; }}
        />
      )}

      {rows !== null && low.length > 0 && (
        <section className="kitchen-page__group" aria-labelledby={`${headingId}-low`}>
          <h2 className="kitchen-page__heading" id={`${headingId}-low`}>Running low</h2>
          <RowList rows={low} {...handlers} />
        </section>
      )}

      {rows !== null && rest.length > 0 && (
        <section className="kitchen-page__group" aria-labelledby={`${headingId}-rest`}>
          <h2 className="kitchen-page__heading" id={`${headingId}-rest`}>{`In your ${place}`}</h2>
          <RowList rows={rest} {...handlers} />
        </section>
      )}
    </div>
  );
}
