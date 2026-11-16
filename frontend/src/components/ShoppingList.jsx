import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getCurrentWeekPlan,
  getInventory,
  recordPurchase,
  revertPurchase,
  listGroceryEntries,
  createGroceryEntry,
  updateGroceryEntry,
  deleteGroceryEntry,
  clearPurchasedEntries,
  importLocalEntries,
  undoGroceryChanges,
  getReconcile,
  applyReconcile,
  setInventoryMinimum,
  setPackageSize
} from '../api';
import ReviewChanges from './ReviewChanges';
import './ShoppingList.css';

const HAS_QUANTITY = /^\s*[\d½¼¾⅓⅔⅛]/;
const LOCAL_KEY = 'shoppingList';
const BACKUP_KEY = 'shoppingList.migrated';
const IMPORT_CHUNK = 500;

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Safe element id fragment from a row key: letters, digits and hyphens only, plus a
// stable hash so different keys that slug alike cannot collide.
function idSlug(key) {
  const slug = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) hash = ((hash * 33) ^ key.charCodeAt(i)) >>> 0;
  return `${slug || 'row'}-${hash.toString(36)}`;
}

// The list used to live only in this browser. Returns the raw text and the usable entries.
function readLocalList() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { raw: null, items: [], valid: false };
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return { raw, items: [], valid: false };
    return { raw, items: saved.filter(item => item && typeof item.name === 'string'), valid: true };
  } catch (error) {
    return { raw: null, items: [], valid: false };
  }
}

// The amount to credit if it is known, e.g. "2 cups flour". Null when the quantity is missing.
function plannedAmount(entry) {
  if (entry.item && entry.quantity) {
    return [entry.quantity, entry.unit, entry.item].filter(Boolean).join(' ');
  }
  return HAS_QUANTITY.test(entry.name) ? entry.name : null;
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shortDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function mealsSummary(meals) {
  const named = meals.slice(0, 2).map(meal => (meal.day ? `${meal.name} (${meal.day.slice(0, 3)})` : meal.name));
  const more = meals.length > 2 ? ` +${meals.length - 2} more` : '';
  return `${named.join(', ')}${more}`;
}

const WARNING_LABELS = {
  below_minimum: 'Low: at or below minimum',
  short: 'Short: need more than you have'
};

function Warnings({ warnings }) {
  if (!warnings.length) return null;
  return (
    <div className="need-badges">
      {warnings.map(warning => (
        <small key={warning.type} className="need-badge need-badge-warning">
          <b aria-hidden="true">⚠</b> {WARNING_LABELS[warning.type]}
        </small>
      ))}
    </div>
  );
}

// The numeric part of a displayed minimum such as "1 1/2 cups", so the field starts at the current value.
function minimumDraft(row) {
  const match = row.minimum ? String(row.minimum).match(/^[\d/.\s]+/) : null;
  return match ? match[0].trim() : '';
}

function MinimumEditor({ row, onSaved, onClose }) {
  const [text, setText] = useState(() => minimumDraft(row));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const save = async (value) => {
    setBusy(true);
    setError('');
    try {
      await setInventoryMinimum(row.inventory_id, value);
      onSaved(value === null ? 'Minimum removed.' : 'Minimum saved.');
    } catch (err) {
      setError(err.message);
      // Return focus to the field so the value can be corrected.
      setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (!busy && text.trim()) save(text);
  };

  return (
    <form className="minimum-editor" onSubmit={submit} noValidate>
      <label>
        Minimum to keep on hand
        <span className="minimum-field">
          <input
            type="text"
            inputMode="decimal"
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`e.g. 2${row.unit ? ` ${row.unit}s` : ''}`}
            aria-describedby={error ? `min-error-${idSlug(row.key)}` : undefined}
          />
          <small className="minimum-unit">{row.unit || 'count'}</small>
        </span>
      </label>
      {row.minimum && <p className="minimum-current">Current minimum: {row.minimum}</p>}
      {error && <p className="checkout-error" id={`min-error-${idSlug(row.key)}`} role="alert">{error}</p>}
      <div className="minimum-actions">
        <button type="submit" className="minimum-save" disabled={busy || !text.trim()}>
          {busy ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
        {row.minimum && <button type="button" onClick={() => save(null)} disabled={busy}>Remove minimum</button>}
      </div>
    </form>
  );
}

// Same rule as the backend (reconcile.py): "es" after s/x/ch/sh, otherwise "s".
function pluralLabel(label, count) {
  if (count === 1) return label;
  return label + (/(s|x|ch|sh)$/.test(label) ? 'es' : 's');
}

function PackageSizeEditor({ row, onSaved, onClose }) {
  const [size, setSize] = useState(() => (row.package ? row.package.size : ''));
  const [label, setLabel] = useState(() => (row.package && row.package.label !== 'package' ? row.package.label : ''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const save = async (value) => {
    setBusy(true);
    setError('');
    try {
      await setPackageSize({ item: row.item, unit_group: row.unit_group, size: value, label });
      onSaved(value === null ? 'Package size removed.' : 'Package size saved.');
    } catch (err) {
      setError(err.message);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (!busy && size.trim()) save(size);
  };

  const hint = row.unit_group === 'weight' ? 'e.g. 28 oz' : 'e.g. 1 qt';
  const slug = idSlug(row.key);
  return (
    <form
      className="minimum-editor"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
      noValidate
    >
      <label>
        Typical package size
        <span className="minimum-field">
          <input
            type="text"
            ref={inputRef}
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder={hint}
            maxLength={20}
            aria-describedby={error ? `pkg-error-${slug}` : undefined}
          />
        </span>
      </label>
      <label>
        Container (optional)
        <span className="minimum-field">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. can"
            maxLength={20}
          />
        </span>
      </label>
      {row.package && <p className="minimum-current">Current size: {row.package.size}</p>}
      {error && <p className="checkout-error" id={`pkg-error-${slug}`} role="alert">{error}</p>}
      <div className="minimum-actions">
        <button type="submit" className="minimum-save" disabled={busy || !size.trim()}>
          {busy ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
        {row.package && <button type="button" onClick={() => save(null)} disabled={busy}>Remove size</button>}
      </div>
    </form>
  );
}

function ShoppingList({ onOpenPlanner }) {
  const [entries, setEntries] = useState([]);
  const [listState, setListState] = useState('loading'); // loading | ready | error
  const [listError, setListError] = useState('');
  const [migration, setMigration] = useState({ status: 'running', local: [], message: '' }); // running | failed | done
  const [weeks, setWeeks] = useState(null); // { this, next }
  const [weeksError, setWeeksError] = useState('');
  const [selected, setSelected] = useState('this');
  const [recon, setRecon] = useState({ status: 'loading', data: null, error: '' });
  const [inventory, setInventory] = useState([]);
  const [newItem, setNewItem] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [addingKey, setAddingKey] = useState(null);
  const [rowError, setRowError] = useState(null); // { key, message }
  const [expanded, setExpanded] = useState(null);
  const [editorKey, setEditorKey] = useState(null); // ingredient or staple key with the minimum editor open
  const [busyId, setBusyId] = useState(null);
  const [checkout, setCheckout] = useState(null); // { id, amount, location }
  const [error, setError] = useState(null); // { id, message }
  const [reviewOpen, setReviewOpen] = useState(false);
  const [apply, setApply] = useState({ busy: false, error: '', stale: false });
  const [flash, setFlash] = useState('');
  const [focusStatusKey, setFocusStatusKey] = useState(null);
  const [undo, setUndo] = useState(null); // { message, payload }
  const reconTicket = useRef(0);
  const reviewButtonRef = useRef(null);
  const weekButtons = useRef({});
  const statusRefs = useRef({});

  const locked = migration.status !== 'done';
  const selectedWeek = weeks ? weeks[selected] : null;
  const weekName = selected === 'this' ? 'this week' : 'next week';

  const refreshInventory = useCallback(async () => {
    try {
      setInventory(await getInventory());
    } catch (err) {
      console.error('Error loading inventory:', err);
    }
  }, []);

  const refreshEntries = useCallback(async () => {
    try {
      setEntries(await listGroceryEntries());
      setListState('ready');
      setListError('');
    } catch (err) {
      setListState(state => (state === 'ready' ? state : 'error'));
      setListError(err.message);
    }
  }, []);

  // Quiet reloads keep the figures on screen, so the page does not jump after an action.
  const loadRecon = useCallback(async (weekId, quiet = false) => {
    const ticket = ++reconTicket.current;
    if (!quiet) setRecon({ status: 'loading', data: null, error: '' });
    try {
      const data = await getReconcile(weekId);
      if (ticket === reconTicket.current) setRecon({ status: 'ready', data, error: '' });
      return data;
    } catch (err) {
      if (ticket === reconTicket.current) {
        setRecon(current => ({ status: 'error', data: quiet ? current.data : null, error: err.message }));
      }
      return null;
    }
  }, []);

  const refreshAfterChange = (weekId) => {
    refreshInventory();
    if (weekId) loadRecon(weekId, true);
  };

  // Move the browser-only list to the server once; keep a backup of what was moved.
  const startup = useCallback(async () => {
    const local = readLocalList();
    if (local.items.length > 0) {
      setMigration({ status: 'running', local: local.items, message: '' });
      try {
        // The server accepts at most IMPORT_CHUNK rows per request; keys make each chunk idempotent.
        let imported = [];
        for (let start = 0; start < local.items.length; start += IMPORT_CHUNK) {
          imported = await importLocalEntries(local.items.slice(start, start + IMPORT_CHUNK));
        }
        localStorage.setItem(BACKUP_KEY, local.raw);
        localStorage.removeItem(LOCAL_KEY);
        setEntries(imported);
        setListState('ready');
        setMigration({ status: 'done', local: [], message: '' });
        setFlash('Your saved list was moved.');
      } catch (err) {
        setMigration({ status: 'failed', local: local.items, message: err.message });
      }
      return;
    }
    if (local.valid) localStorage.removeItem(LOCAL_KEY); // an empty list needs no migration
    setMigration({ status: 'done', local: [], message: '' });
    await refreshEntries();
  }, [refreshEntries]);

  const loadWeeks = useCallback(async () => {
    setWeeksError('');
    try {
      const current = await getCurrentWeekPlan();
      const next = await getCurrentWeekPlan(addDays(current.end_date, 1));
      setWeeks({ this: current, next });
    } catch (err) {
      setWeeksError(err.message);
    }
  }, []);

  useEffect(() => {
    startup();
    loadWeeks();
    refreshInventory();
  }, [startup, loadWeeks, refreshInventory]);

  useEffect(() => {
    if (weeks) loadRecon(weeks[selected].id);
  }, [weeks, selected, loadRecon]);

  useEffect(() => {
    if (focusStatusKey === null) return;
    const target = statusRefs.current[focusStatusKey];
    if (target) {
      target.focus();
      setFocusStatusKey(null);
    }
  }, [focusStatusKey, recon.data, entries]);

  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(''), 8000);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), 12000);
    return () => clearTimeout(timer);
  }, [undo]);

  const selectWeek = (which) => {
    if (which === selected) return;
    setSelected(which);
    setExpanded(null);
    setEditorKey(null);
    setRowError(null);
    setReviewOpen(false);
    setFocusStatusKey(null);
  };

  // A location is known only when the item is already stocked in exactly one place.
  const knownLocation = (entry) => {
    if (!entry.item) return '';
    const locations = new Set(inventory.filter(row => row.item === entry.item).map(row => row.location));
    return locations.size === 1 ? [...locations][0] : '';
  };

  const replaceEntry = (saved) => {
    setEntries(current => current.map(entry => (entry.id === saved.id ? saved : entry)));
  };

  const addItem = async () => {
    const name = newItem.trim();
    if (!name || locked || adding) return;
    setAdding(true);
    setAddError('');
    try {
      const entry = await createGroceryEntry({ entry_key: `manual:${newId()}`, name });
      setEntries(current => [...current, entry]);
      setNewItem('');
      refreshAfterChange(selectedWeek && selectedWeek.id);
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const addIngredient = async (row) => {
    if (locked || addingKey !== null || busyId !== null || !selectedWeek) return;
    setAddingKey(row.key);
    setRowError(null);
    try {
      const entry = await createGroceryEntry({
        entry_key: `added:${newId()}`,
        name: row.add_name,
        week_plan_id: selectedWeek.id
      });
      setEntries(current => [...current, entry]);
      setFlash(`Added ${entry.name} to your shopping list.`);
      // The Add button is replaced by the On list badge: keep focus on a stable element.
      setFocusStatusKey(row.key);
    } catch (err) {
      if (err.status === 409) {
        setFlash('Already on your list.');
      } else {
        setRowError({ key: row.key, message: err.message });
      }
    } finally {
      setAddingKey(null);
      refreshEntries();
      loadRecon(selectedWeek.id, true);
    }
  };

  const clearPurchased = async () => {
    if (busyId !== null) return;
    try {
      await clearPurchasedEntries();
      setEntries(current => current.filter(entry => !entry.purchased));
      refreshAfterChange(selectedWeek && selectedWeek.id);
    } catch (err) {
      setListError(err.message);
    }
  };

  const creditEntry = async (entry, amount, location) => {
    setBusyId(entry.id);
    setError(null);
    try {
      // The entry's purchase_id is reused on retries, so the server credits it once.
      const result = await recordPurchase(entry.purchase_id, amount, location);
      const saved = await updateGroceryEntry(entry.id, {
        purchased: true,
        credit: { amount: result.amount, location: result.location }
      });
      replaceEntry(saved);
      setCheckout(null);
      refreshAfterChange(selectedWeek && selectedWeek.id);
      setFlash('Stock updated.');
    } catch (err) {
      setError({ id: entry.id, message: err.message });
      setCheckout({ id: entry.id, amount, location });
    } finally {
      setBusyId(null);
    }
  };

  const revertEntry = async (entry) => {
    setBusyId(entry.id);
    setError(null);
    try {
      if (entry.credit) await revertPurchase(entry.purchase_id);
      // The server gives the entry a fresh purchase_id, because the reverted one is spent.
      replaceEntry(await updateGroceryEntry(entry.id, { purchased: false }));
      refreshAfterChange(selectedWeek && selectedWeek.id);
      if (entry.credit) setFlash('Stock updated.');
      return true;
    } catch (err) {
      setError({ id: entry.id, message: err.message });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const togglePurchased = async (entry) => {
    if (busyId !== null) return;
    if (entry.purchased) {
      await revertEntry(entry);
      return;
    }
    const amount = plannedAmount(entry);
    const location = knownLocation(entry);
    if (amount && location) {
      await creditEntry(entry, amount, location);
    } else {
      setError(null);
      setEditorKey(null);
      setCheckout({ id: entry.id, amount: amount || entry.item || entry.name, location });
    }
  };

  const editCredit = async (entry) => {
    if (busyId !== null) return;
    const credit = entry.credit;
    if (await revertEntry(entry)) {
      setEditorKey(null);
      setCheckout({ id: entry.id, amount: credit.amount, location: credit.location });
    }
  };

  const saveCheckout = (entry) => {
    if (busyId !== null) return;
    if (!checkout.amount.trim() || !checkout.location) {
      setError({ id: entry.id, message: 'Enter an amount like 2 cups of rice and choose fridge or pantry.' });
      return;
    }
    creditEntry(entry, checkout.amount.trim(), checkout.location);
  };

  const markWithoutInventory = async (entry) => {
    if (busyId !== null) return;
    setBusyId(entry.id);
    try {
      replaceEntry(await updateGroceryEntry(entry.id, { purchased: true }));
      setCheckout(null);
      setError(null);
      refreshAfterChange(selectedWeek && selectedWeek.id);
    } catch (err) {
      setError({ id: entry.id, message: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const cancelCheckout = () => {
    setCheckout(null);
    setError(null);
  };

  const deleteEntry = async (entry) => {
    if (busyId !== null) return;
    try {
      await deleteGroceryEntry(entry.id);
      setEntries(current => current.filter(item => item.id !== entry.id));
      if (checkout && checkout.id === entry.id) setCheckout(null);
      setUndo({ message: `Removed "${entry.name}".`, payload: { removed: [entry] } });
      refreshAfterChange(selectedWeek && selectedWeek.id);
    } catch (err) {
      setError({ id: entry.id, message: err.message });
    }
  };

  const undoLast = async () => {
    if (!undo) return;
    const { payload } = undo;
    setUndo(null);
    try {
      setEntries(await undoGroceryChanges(payload));
      refreshAfterChange(selectedWeek && selectedWeek.id);
      setFlash('Undone.');
    } catch (err) {
      setFlash(`${err.message} Nothing was changed.`);
    }
  };

  const openReview = () => {
    if (!recon.data || reviewOpen) return;
    setApply({ busy: false, error: '', stale: false });
    setReviewOpen(true);
  };

  const closeReview = () => {
    if (apply.busy) return;
    setReviewOpen(false);
  };

  const applyChanges = async () => {
    if (!recon.data || locked || apply.busy) return;
    setApply({ busy: true, error: '', stale: false });
    try {
      const result = await applyReconcile(selectedWeek.id, recon.data.fingerprint);
      reconTicket.current += 1;
      setEntries(result.entries);
      setRecon({ status: 'ready', data: result.reconcile, error: '' });
      setReviewOpen(false);
      setApply({ busy: false, error: '', stale: false });
      const { added, updated, removed } = result.summary;
      setFlash(`Applied: ${added} added, ${updated} updated, ${removed} removed.`);
      if (result.undo) setUndo({ message: 'Changes applied.', payload: result.undo });
    } catch (err) {
      if (err.status === 409) {
        // The preview was stale: show the fresh one in place. Nothing was written.
        setApply({ busy: false, error: err.message, stale: true });
        await Promise.all([loadRecon(selectedWeek.id, true), refreshEntries()]);
      } else {
        setApply({ busy: false, error: err.message, stale: false });
      }
    }
  };

  const packageToggleRefs = useRef({});

  // Close the package-size editor and put focus back on its toggle button.
  const closePackageEditor = (pkgKey) => {
    setEditorKey(null);
    setTimeout(() => {
      const toggle = packageToggleRefs.current[pkgKey];
      if (toggle) toggle.focus();
    }, 0);
  };

  const packageSaved = (pkgKey, message) => {
    minimumSaved(message);
    setTimeout(() => {
      const toggle = packageToggleRefs.current[pkgKey];
      if (toggle) toggle.focus();
    }, 0);
  };

  const minimumSaved = (message) => {
    setEditorKey(null);
    setFlash(message);
    refreshAfterChange(selectedWeek && selectedWeek.id);
  };

  const openMinimumEditor = (row) => {
    setCheckout(null);
    setError(null);
    setEditorKey(editorKey === row.key ? null : row.key);
  };

  // Roving tabindex: arrows (and Home/End) move the selection and focus within the radio group.
  const weekKeyDown = (event) => {
    if (!weeks) return;
    const order = ['this', 'next'];
    let index = order.indexOf(selected);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % order.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (index + order.length - 1) % order.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = order.length - 1;
    else return;
    event.preventDefault();
    const which = order[index];
    selectWeek(which);
    const node = weekButtons.current[which];
    if (node) node.focus();
  };

  const weekTag = (entry) => {
    if (entry.source !== 'plan' || !entry.week_plan_id) return null;
    if (weeks && entry.week_plan_id === weeks.this.id) return 'From this week';
    if (weeks && entry.week_plan_id === weeks.next.id) return 'From next week';
    return entry.week_start ? `From week of ${shortDate(entry.week_start)}` : 'From a planned week';
  };

  const toBuy = entries.filter(entry => !entry.purchased);
  const purchased = entries.filter(entry => entry.purchased);
  const data = recon.data;
  const changeCount = data ? data.changes.add.length + data.changes.update.length + data.changes.remove.length : 0;
  const warningCount = data
    ? data.ingredients.reduce((sum, row) => sum + row.warnings.length, 0)
      + data.staples.reduce((sum, row) => sum + row.warnings.length, 0)
    : 0;
  const stillToBuy = data ? data.ingredients.filter(row => !row.covered_by_stock) : [];
  const coveredByStock = data ? data.ingredients.filter(row => row.covered_by_stock) : [];

  const renderError = (entry) =>
    error && error.id === entry.id ? <p className="checkout-error" role="alert">{error.message}</p> : null;

  const renderCheckout = (entry) => (
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
      {renderError(entry)}
      <div className="checkout-actions">
        <button className="checkout-save" onClick={() => saveCheckout(entry)} disabled={busyId !== null}>
          Save
        </button>
        <button onClick={() => markWithoutInventory(entry)} disabled={busyId !== null}>
          Mark purchased without adding to inventory
        </button>
        <button onClick={cancelCheckout} disabled={busyId !== null}>Cancel</button>
      </div>
    </div>
  );

  const renderMinimumControls = (row, showHint) => {
    if (row.inventory_id) {
      return (
        <>
          <button className="need-secondary" onClick={() => openMinimumEditor(row)} aria-expanded={editorKey === row.key}>
            {row.minimum ? 'Change minimum' : 'Set minimum'}
          </button>
          {editorKey === row.key && (
            <MinimumEditor row={row} onSaved={minimumSaved} onClose={() => setEditorKey(null)} />
          )}
        </>
      );
    }
    return showHint ? <p className="need-hint">Add stock first to set a minimum.</p> : null;
  };

  const renderPackageControls = (row) => {
    if (!row.package_eligible) return null;
    const pkgKey = `pkg:${row.key}`;
    return (
      <>
        <button
          className="need-secondary"
          ref={(node) => { if (node) packageToggleRefs.current[pkgKey] = node; else delete packageToggleRefs.current[pkgKey]; }}
          onClick={() => openMinimumEditor({ key: pkgKey })}
          aria-expanded={editorKey === pkgKey}
        >
          {row.package ? 'Change package size' : 'Set package size'}
        </button>
        {editorKey === pkgKey && (
          <PackageSizeEditor
            row={row}
            onSaved={(message) => packageSaved(pkgKey, message)}
            onClose={() => closePackageEditor(pkgKey)}
          />
        )}
      </>
    );
  };

  const renderNeedCard = (row) => {
    const open = expanded === row.key;
    const stillNeeded = !row.covered_by_stock;
    return (
      <article key={row.key} className="need-card">
        <div className="need-head">
          <h4>{row.item}</h4>
          <Warnings warnings={row.warnings} />
        </div>
        <dl className="need-figures">
          <div><dt>Need</dt><dd>{row.demand}</dd></div>
          <div><dt>On hand</dt><dd>{row.available}</dd></div>
          <div className={stillNeeded ? 'need-still' : ''}><dt>Still to buy</dt><dd>{row.to_buy}</dd></div>
        </dl>
        {row.package && row.package.packages > 0 && (
          <dl className="need-figures">
            <div>
              <dt>Buy</dt>
              <dd>{row.package.packages} {pluralLabel(row.package.label, row.package.packages)} ({row.package.buy})</dd>
            </div>
            <div><dt>Left after cooking</dt><dd>{row.package.remainder}</dd></div>
          </dl>
        )}
        <p className="need-meals">For: {mealsSummary(row.meals)}</p>
        <div
          className="need-status"
          tabIndex={-1}
          ref={(node) => { if (node) statusRefs.current[row.key] = node; else delete statusRefs.current[row.key]; }}
        >
          {row.covered_by_stock && (
            <small className="need-badge need-badge-ok"><b aria-hidden="true">✓</b> Covered by stock</small>
          )}
          {row.covered && (
            <small className="need-badge need-badge-ok"><b aria-hidden="true">✓</b> On list</small>
          )}
        </div>
        {stillNeeded && !row.covered && (
          <button
            className="need-add"
            onClick={() => addIngredient(row)}
            disabled={locked || addingKey !== null || busyId !== null}
          >
            {addingKey === row.key ? 'Adding...' : row.package && row.package.packages > 0
              ? `Add ${row.package.packages} ${pluralLabel(row.package.label, row.package.packages)} to shopping list`
              : `Add ${row.to_buy} to shopping list`}
          </button>
        )}
        {rowError && rowError.key === row.key && <p className="checkout-error" role="alert">{rowError.message}</p>}
        <button
          className="need-secondary"
          onClick={() => setExpanded(open ? null : row.key)}
          aria-expanded={open}
          aria-controls={`need-details-${idSlug(row.key)}`}
        >
          {open ? 'Hide details' : `Details (${row.meals.length} meal${row.meals.length === 1 ? '' : 's'})`}
        </button>
        {open && (
          <div className="need-details" id={`need-details-${idSlug(row.key)}`}>
            <ul>
              {row.meals.map(meal => (
                <li key={meal.meal_id}>
                  {meal.name}{meal.day ? ` (${meal.day})` : ''}
                  {meal.servings ? `, ${meal.servings} servings` : ''}: {meal.amount}
                </li>
              ))}
            </ul>
            {row.held_for_earlier_weeks && (
              <p>{row.held_for_earlier_weeks} of your stock is held for earlier weeks (total on hand {row.on_hand}).</p>
            )}
            {row.minimum && <p>Minimum: {row.minimum}.</p>}
            {row.warnings.map(warning => <p key={warning.type}>{warning.message}</p>)}
            {row.covered && row.entry && <p>On your list as "{row.entry.name}".</p>}
          </div>
        )}
        {renderPackageControls(row)}
        {renderMinimumControls(row, true)}
      </article>
    );
  };

  const renderStaple = (row) => (
    <article key={row.key} className="need-card">
      <div className="need-head">
        <h4>{row.item}</h4>
        <Warnings warnings={row.warnings} />
      </div>
      <p className="need-meals">On hand {row.on_hand}, minimum {row.minimum}</p>
      {row.covered && (
        <div className="need-status">
          <small className="need-badge need-badge-ok"><b aria-hidden="true">✓</b> On list</small>
        </div>
      )}
      {row.warnings.map(warning => <p key={warning.type} className="need-hint">{warning.message}</p>)}
      {renderMinimumControls(row, false)}
    </article>
  );

  const renderNeeds = () => {
    if (!weeks) {
      return weeksError
        ? (
          <div role="alert" className="inline-error">
            <p>{weeksError}</p>
            <button className="need-secondary" onClick={loadWeeks}>Retry</button>
          </div>
        )
        : <p className="no-items">Loading...</p>;
    }
    if (recon.status === 'loading') return <p className="no-items">Loading what {weekName} needs...</p>;
    if (!data) {
      return (
        <div role="alert" className="inline-error">
          <p>{recon.error}</p>
          <button className="need-secondary" onClick={() => loadRecon(selectedWeek.id)}>Retry</button>
        </div>
      );
    }
    return (
      <>
        {recon.error && (
          <div role="alert" className="inline-error">
            <p>{recon.error}</p>
            <button className="need-secondary" onClick={() => loadRecon(selectedWeek.id)}>Retry</button>
          </div>
        )}
        {data.no_yield.length > 0 && (
          <p className="import-hint need-yield-hint">
            No yield set for {data.no_yield.join(', ')}. {data.no_yield.length === 1 ? 'Its quantity is' : 'Their quantities are'} used as written, not scaled by planned servings.
          </p>
        )}
        {data.meal_count === 0 && data.ingredients.length === 0 && data.unmeasured.length === 0 ? (
          <div className="no-items">
            <p>No meals planned for {weekName}. Plan meals in the Weekly Planner.</p>
            {onOpenPlanner && <button className="need-secondary" onClick={onOpenPlanner}>Open Weekly Planner</button>}
          </div>
        ) : (
          <>
            {data.ingredients.length > 0 && stillToBuy.length === 0 && (
              <p className="need-all-good" role="status">You have everything for {weekName}.</p>
            )}
            {stillToBuy.length > 0 && (
              <div className="need-group">
                <h4 className="need-group-title">Still to buy ({stillToBuy.length})</h4>
                {stillToBuy.map(renderNeedCard)}
              </div>
            )}
            {coveredByStock.length > 0 && (
              <details className="need-group">
                <summary>Covered by stock ({coveredByStock.length})</summary>
                {coveredByStock.map(renderNeedCard)}
              </details>
            )}
            {data.unmeasured.length > 0 && (
              <div className="need-group">
                <h4 className="need-group-title">Unmeasured items ({data.unmeasured.length})</h4>
                {data.unmeasured.map(line => (
                  <article key={line.line} className="need-card">
                    <h4>{line.line}</h4>
                    <p className="need-meals">For: {mealsSummary(line.meals)}</p>
                    {line.note && <p className="need-hint">{line.note}</p>}
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </>
    );
  };

  const renderEntry = (entry, isPurchased) => {
    const tag = weekTag(entry);
    return (
      <div key={entry.id} className="item-wrap">
        <div className={isPurchased ? 'item purchased' : 'item'}>
          <input
            type="checkbox"
            checked={entry.purchased}
            disabled={busyId !== null}
            aria-label={`${entry.name}, ${isPurchased ? 'purchased' : 'to buy'}`}
            onChange={() => togglePurchased(entry)}
          />
          <span className={entry.source === 'plan' ? 'from-week' : ''}>
            {entry.name}
            {tag && <small className="entry-tag">{tag}</small>}
            {isPurchased && entry.credit && (
              <span className="credit-note">
                added {entry.credit.amount} to {entry.credit.location}
              </span>
            )}
          </span>
          {isPurchased && entry.credit && (
            <button className="edit-credit" onClick={() => editCredit(entry)} disabled={busyId !== null}>
              Edit
            </button>
          )}
          <button aria-label={`Remove ${entry.name}`} onClick={() => deleteEntry(entry)} disabled={busyId !== null}>×</button>
        </div>
        {!isPurchased && checkout && checkout.id === entry.id ? renderCheckout(entry) : renderError(entry)}
      </div>
    );
  };

  const renderChecklist = () => {
    if (migration.status === 'running' && migration.local.length === 0) {
      return <p className="no-items">Loading your list...</p>;
    }
    if (migration.status !== 'done') {
      return (
        <div className="list-section">
          <h3>Saved on this device</h3>
          <div className="items">
            {migration.local.map(item => (
              <div key={item.id ?? item.name} className="item-wrap">
                <div className={item.purchased ? 'item purchased' : 'item'}>
                  <span>{item.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (listState === 'loading') return <p className="no-items">Loading your list...</p>;
    if (listState === 'error') {
      return (
        <div role="alert" className="inline-error">
          <p>{listError}</p>
          <button className="need-secondary" onClick={refreshEntries}>Retry</button>
        </div>
      );
    }
    return (
      <>
        <div className="list-section">
          <div className="section-header">
            <h3>To Buy ({toBuy.length})</h3>
            {purchased.length > 0 && (
              <button className="clear-btn" onClick={clearPurchased} disabled={busyId !== null}>
                Clear purchased ({purchased.length})
              </button>
            )}
          </div>
          <div className="items">
            {toBuy.length === 0 ? (
              <p className="no-items">Nothing to buy yet. Use Review changes to add what this week needs, or add an item.</p>
            ) : (
              toBuy.map(entry => renderEntry(entry, false))
            )}
          </div>
        </div>
        {purchased.length > 0 && (
          <div className="list-section">
            <h3>Purchased ({purchased.length})</h3>
            <div className="items">{purchased.map(entry => renderEntry(entry, true))}</div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className={undo ? 'shopping-list has-undo' : 'shopping-list'}>
      <h2>Shopping</h2>

      {migration.status === 'failed' && (
        <div className="migration-banner" role="alert">
          <p>Could not move your saved list to the new storage. Your items are safe on this device.</p>
          <p className="need-hint">{migration.message}</p>
          <button className="need-secondary" onClick={startup}>Retry</button>
        </div>
      )}

      <div className="week-bar">
        <div className="week-selector" role="radiogroup" aria-label="Week" onKeyDown={weekKeyDown}>
          {['this', 'next'].map(which => (
            <button
              key={which}
              ref={(node) => { weekButtons.current[which] = node; }}
              role="radio"
              tabIndex={selected === which ? 0 : -1}
              aria-checked={selected === which}
              className={selected === which ? 'week-option selected' : 'week-option'}
              onClick={() => selectWeek(which)}
              disabled={!weeks}
            >
              {selected === which && <b aria-hidden="true">✓ </b>}
              {which === 'this' ? 'This week' : 'Next week'}
            </button>
          ))}
        </div>
        {selectedWeek && (
          <p className="week-range">{shortDate(selectedWeek.start_date)} to {shortDate(selectedWeek.end_date)}</p>
        )}
      </div>

      <div className="review-bar">
        <button
          className="review-open"
          ref={reviewButtonRef}
          onClick={openReview}
          disabled={!data}
          aria-expanded={reviewOpen}
        >
          Review changes
          {changeCount > 0 && <span className="count-badge" aria-label={`${changeCount} changes`}>{changeCount}</span>}
        </button>
        {data && (
          <p className="review-summary">
            {changeCount === 0 ? 'List is up to date' : `${changeCount} change${changeCount === 1 ? '' : 's'} to review`}
            {warningCount > 0 ? `, ${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}
          </p>
        )}
      </div>

      <p className="flash" role="status" aria-live="polite">{flash}</p>

      {reviewOpen && data && (
        <ReviewChanges
          changes={data.changes}
          weekLabel={weekName}
          busy={apply.busy}
          error={apply.error}
          nothingChanged={apply.stale}
          locked={locked}
          onApply={applyChanges}
          onCancel={closeReview}
          returnFocusRef={reviewButtonRef}
        />
      )}

      <section className="needs-section" aria-label={`Needs for ${weekName}`}>
        <h3>Needs for {weekName}</h3>
        {renderNeeds()}
      </section>

      {data && data.staples.length > 0 && (
        <section className="needs-section" aria-label="Staples">
          <h3>Staples ({data.staples.length})</h3>
          {data.staples.map(renderStaple)}
        </section>
      )}

      <div className="add-item">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addItem()}
          placeholder="Add item..."
          aria-label="Add item"
          disabled={locked}
        />
        <button onClick={addItem} disabled={locked || adding}>{adding ? 'Adding...' : 'Add'}</button>
      </div>
      {addError && <p className="checkout-error" role="alert">{addError}</p>}

      <h3 className="checklist-title">Shopping list (all weeks)</h3>
      {renderChecklist()}

      {undo && (
        <div className="undo-snackbar" role="status" aria-live="polite">
          <span>{undo.message}</span>
          <button onClick={undoLast}>Undo</button>
          <button className="undo-dismiss" aria-label="Dismiss" onClick={() => setUndo(null)}>×</button>
        </div>
      )}
    </div>
  );
}

export default ShoppingList;
