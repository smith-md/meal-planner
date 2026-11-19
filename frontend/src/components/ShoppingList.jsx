import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getCurrentWeekPlan,
  getInventory,
  recordPurchase,
  revertPurchase,
  createGroceryEntry,
  updateGroceryEntry,
  deleteGroceryEntry,
  clearPurchasedEntries,
  undoGroceryChanges,
  getReconcile,
  applyReconcile,
  setInventoryMinimum,
  setPackageSize
} from '../api';
import ReviewChanges from './ReviewChanges';
import { useGroceryEntries } from './GroceryEntriesContext';
import Button from './ui/Button.jsx';
import { EmptyState, ErrorState, Skeleton } from './ui/States.jsx';
import StatusPill from './ui/StatusPill.jsx';
import { ACTION_TOAST_DURATION_MS, useToast } from './ui/Toast.jsx';
import UndoHint from './ui/UndoHint.jsx';
import { UNDO_ARIA_KEYSHORTCUTS, useUndoShortcut } from './ui/useUndoShortcut.js';
import PutAwayPanel from './PutAwayPanel.jsx';
import { QUANTITY_ERROR, abbreviateAmount, abbreviateQuantity, checkQuantityText, composeAmount, shortDayName, splitAmount } from '../utils/format';
import { AlertIcon, CheckIcon, CloseIcon, PlusIcon } from './ui/icons.jsx';
import './ShoppingList.css';

const HAS_QUANTITY = /^\s*[\d½¼¾⅓⅔⅛]/;

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

// An entry as a quantity part ("2 lb", "6", or "" when unknown) and a fixed item name.
function amountParts(entry) {
  if (entry.item && entry.quantity) {
    return { quantity: [entry.quantity, entry.unit].filter(Boolean).join(' '), name: entry.item };
  }
  if (HAS_QUANTITY.test(entry.name)) {
    const parts = splitAmount(entry.name);
    if (parts.quantity && parts.name) return { quantity: parts.quantity, name: parts.name };
  }
  return { quantity: '', name: entry.item || entry.name };
}

// The amount to credit if it is known, e.g. "2 cups flour". Null when the quantity is missing.
// Check-time credit, the put-away panel and Edit amount all send "<quantity> <item name>".
function plannedAmount(entry) {
  const { quantity, name } = amountParts(entry);
  return quantity ? composeAmount(quantity, name) : null;
}

const PLACE_LABELS = { fridge: 'Fridge', pantry: 'Pantry' };
const KEPT_KEY = 'shopping.keptOnList';

// Items marked "Keep on list" stay checked but are not stock. The server has no flag for that,
// so the ids are remembered in this browser (localStorage) and pruned once they no longer apply.
function readKept() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEPT_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved : []);
  } catch (err) {
    return new Set();
  }
}

function writeKept(ids) {
  try {
    localStorage.setItem(KEPT_KEY, JSON.stringify([...ids]));
  } catch (err) {
    // Storage can be unavailable; the choice then lasts until reload.
  }
}

// The planned meals behind a bought entry, from the selected week's reconcile data. Matched like the
// server does (item + unit group), within the entry's own week. Manual, legacy and restock lines have
// no such match and give an empty list.
function mealsForEntry(entry, data, weekId) {
  if (!data || !entry.item || !entry.unit_group || entry.kind === 'restock') return [];
  if (weekId == null || entry.week_plan_id !== weekId) return [];
  const line = data.ingredients.find(row => row.item === entry.item && row.unit_group === entry.unit_group);
  return line && Array.isArray(line.meals) ? line.meals : [];
}

function putAwayMealText(meals) {
  if (meals.length === 0) return '';
  if (meals.length > 1) return `for ${meals.length} meals`;
  const [meal] = meals;
  return `for ${meal.name}${meal.day ? ` (${shortDayName(meal.day)})` : ''}`;
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
    <div className="shopping-list__badges">
      {warnings.map(warning => (
        <StatusPill key={warning.type} status="warn">{WARNING_LABELS[warning.type]}</StatusPill>
      ))}
    </div>
  );
}

function InlineError({ id, children }) {
  return (
    <p className="shopping-list__error" id={id} role="alert">
      <AlertIcon size={18} />
      <span>{children}</span>
    </p>
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
    <form className="shopping-list__panel" onSubmit={submit} noValidate>
      <label className="shopping-list__label">
        Minimum to keep on hand
        <span className="shopping-list__field-row">
          <input
            className="shopping-list__input"
            type="text"
            inputMode="decimal"
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`e.g. 2${row.unit ? ` ${row.unit}s` : ''}`}
            aria-describedby={error ? `min-error-${idSlug(row.key)}` : undefined}
          />
          <small className="shopping-list__unit">{row.unit || 'count'}</small>
        </span>
      </label>
      {row.minimum && <p className="shopping-list__hint">Current minimum: {row.minimum}</p>}
      {error && <InlineError id={`min-error-${idSlug(row.key)}`}>{error}</InlineError>}
      <div className="shopping-list__actions">
        <Button type="submit" disabled={busy || !text.trim()}>
          {busy ? 'Saving...' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        {row.minimum && <Button variant="secondary" onClick={() => save(null)} disabled={busy}>Remove minimum</Button>}
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
      className="shopping-list__panel"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
      noValidate
    >
      <label className="shopping-list__label">
        Typical package size
        <span className="shopping-list__field-row">
          <input
            className="shopping-list__input"
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
      <label className="shopping-list__label">
        Container (optional)
        <span className="shopping-list__field-row">
          <input
            className="shopping-list__input"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. can"
            maxLength={20}
          />
        </span>
      </label>
      {row.package && <p className="shopping-list__hint">Current size: {row.package.size}</p>}
      {error && <InlineError id={`pkg-error-${slug}`}>{error}</InlineError>}
      <div className="shopping-list__actions">
        <Button type="submit" disabled={busy || !size.trim()}>
          {busy ? 'Saving...' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        {row.package && <Button variant="secondary" onClick={() => save(null)} disabled={busy}>Remove size</Button>}
      </div>
    </form>
  );
}

function ShoppingList({ onOpenPlanner }) {
  const {
    entries, setEntries, refreshEntries, listState, listError, setListError,
    migration, retryMigration, notice, clearNotice, refreshKitchenStatus
  } = useGroceryEntries();
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
  const toast = useToast();
  const [kept, setKept] = useState(readKept); // ids of bought items left off the stock
  const [putAwayOpen, setPutAwayOpen] = useState(false);
  const [panelBusy, setPanelBusy] = useState(false);
  const [creditEdit, setCreditEdit] = useState(null); // { id, amount }
  const putAwayTrigger = useRef(null);
  const summaryRef = useRef(null); // the Bought heading
  const toBuyHeadingRef = useRef(null);
  const checkRefs = useRef({}); // entry id -> its checkbox
  const editRefs = useRef({}); // entry id -> its Edit button
  const pendingFocus = useRef(null); // { targets: [() => element], expires } where focus goes once the list settles
  const creditedPurchases = useRef(new Set()); // purchase ids the server accepted (a failed POST has nothing to revert)
  const freshEntries = useRef({}); // entry id -> entry with the new purchase id after a revert
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
    refreshKitchenStatus();
    if (weekId) loadRecon(weekId, true);
  };

  // The browser-only list is moved to the server by GroceryEntriesProvider before entries load.
  useEffect(() => {
    if (notice) {
      setFlash(notice);
      clearNotice();
    }
  }, [notice, clearNotice]);

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
    loadWeeks();
    refreshInventory();
  }, [loadWeeks, refreshInventory]);

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

  // Focus must never fall to BODY when a row moves between To buy and Bought, or after Undo. Rows
  // are remounted when they move and their checkboxes are disabled while a save is running, so
  // focus is applied after the render in which the target can take it.
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    if (Date.now() > want.expires) {
      pendingFocus.current = null;
      return;
    }
    const active = document.activeElement;
    const free = !active || active === document.body || active.disabled
      || (active.closest && active.closest('.ui-toast-region'))
      // Fallback headings that this component focuses itself are not a deliberate user choice.
      || active === summaryRef.current || active === toBuyHeadingRef.current;
    if (!free) {
      pendingFocus.current = null; // the user moved focus somewhere on purpose
      return;
    }
    for (const getTarget of want.targets) {
      const node = getTarget();
      if (!node) continue;
      if (node.disabled) return; // try again after the next render
      node.focus();
      pendingFocus.current = null;
      return;
    }
  });

  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(''), 8000);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), ACTION_TOAST_DURATION_MS);
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

  // Where this item was last put: the newest inventory row, else the newest credited list entry.
  const lastLocation = (entry) => {
    if (!entry.item) return '';
    const rows = inventory
      .filter(row => row.item === entry.item && PLACE_LABELS[row.location])
      .sort((a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')));
    if (rows.length > 0) return rows[0].location;
    const credited = entries.filter(other => other.item === entry.item && other.credit && PLACE_LABELS[other.credit.location]);
    return credited.length > 0 ? credited[credited.length - 1].credit.location : '';
  };

  const replaceEntry = (saved) => {
    setEntries(current => current.map(entry => (entry.id === saved.id ? saved : entry)));
  };

  const rememberKept = (id, isKept) => {
    setKept(current => {
      const next = new Set(current);
      if (isKept) next.add(id); else next.delete(id);
      writeKept(next);
      return next;
    });
  };

  // Drop kept ids whose entry is gone, un-bought or already credited, so stale ids neither pile up
  // nor hide a different entry. Only once the list has loaded, so an empty list never wipes them.
  useEffect(() => {
    if (listState !== 'ready') return;
    const live = new Set(entries.filter(entry => entry.purchased && !entry.credit).map(entry => entry.id));
    setKept(current => {
      if ([...current].every(id => live.has(id))) return current;
      const next = new Set([...current].filter(id => live.has(id)));
      writeKept(next);
      return next;
    });
  }, [entries, listState]);

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

  // Credits stock and marks the entry bought. Throws on failure. The purchase id is reused on
  // retries, so the server credits it once.
  const creditCore = async (entry, amount, location) => {
    const result = await recordPurchase(entry.purchase_id, amount, location);
    creditedPurchases.current.add(entry.purchase_id);
    const saved = await updateGroceryEntry(entry.id, {
      purchased: true,
      credit: { amount: result.amount, location: result.location }
    });
    creditedPurchases.current.delete(entry.purchase_id);
    delete freshEntries.current[entry.id];
    replaceEntry(saved);
    return saved;
  };

  const revertEntry = async (entry) => {
    setBusyId(entry.id);
    setError(null);
    // The badge counts unchecked items: show the change at once and restore it if the save fails.
    replaceEntry({ ...entry, purchased: false, credit: null });
    try {
      if (entry.credit) await revertPurchase(entry.purchase_id);
      // The server gives the entry a fresh purchase_id, because the reverted one is spent.
      const saved = await updateGroceryEntry(entry.id, { purchased: false });
      replaceEntry(saved);
      rememberKept(entry.id, false);
      refreshAfterChange(selectedWeek && selectedWeek.id);
      return saved;
    } catch (err) {
      replaceEntry(entry);
      setError({ id: entry.id, message: err.message });
      return null;
    } finally {
      setBusyId(null);
    }
  };

  // Credit at check time: the amount and place are known, so no question is asked.
  const creditEntry = async (entry, amount, location) => {
    setBusyId(entry.id);
    setError(null);
    try {
      const saved = await creditCore(entry, amount, location);
      refreshAfterChange(selectedWeek && selectedWeek.id);
      toast.show({
        message: `Added ${abbreviateAmount(saved.credit.amount)} to ${PLACE_LABELS[saved.credit.location] || saved.credit.location}`,
        actionLabel: 'Undo',
        onAction: () => {
          focusReverted([saved]);
          return revertEntry(saved);
        }
      });
      return saved;
    } catch (err) {
      replaceEntry({ ...entry, purchased: false, credit: null });
      setError({ id: entry.id, message: err.message });
      return null;
    } finally {
      setBusyId(null);
    }
  };

  // No known place or amount: the item is bought, and waits for the Put away groceries panel.
  const markWaiting = async (entry) => {
    setBusyId(entry.id);
    setError(null);
    try {
      replaceEntry(await updateGroceryEntry(entry.id, { purchased: true }));
      refreshAfterChange(selectedWeek && selectedWeek.id);
    } catch (err) {
      replaceEntry({ ...entry, purchased: false, credit: null });
      setError({ id: entry.id, message: err.message });
    } finally {
      setBusyId(null);
    }
  };

  // Where focus goes when a row leaves its group: the next row's checkbox, else the previous one,
  // else the group heading.
  const focusAfterMove = (entry, wasPurchased) => {
    const group = wasPurchased ? purchased : toBuy;
    const index = group.findIndex(other => other.id === entry.id);
    const targets = [group[index + 1], group[index - 1]]
      .filter(Boolean)
      .map(other => () => checkRefs.current[other.id]);
    targets.push(() => (wasPurchased ? summaryRef.current : null), () => toBuyHeadingRef.current);
    pendingFocus.current = { targets, expires: Date.now() + 8000 };
  };

  // After Undo the reverted row is back in To buy: focus its checkbox.
  const focusReverted = (saved) => {
    const targets = saved.map(entry => () => checkRefs.current[entry.id]);
    targets.push(() => toBuyHeadingRef.current);
    pendingFocus.current = { targets, expires: Date.now() + 8000 };
  };

  const togglePurchased = async (entry) => {
    if (busyId !== null || panelBusy) return;
    focusAfterMove(entry, entry.purchased);
    if (entry.purchased) {
      setCreditEdit(null);
      await revertEntry(entry);
      return;
    }
    const amount = plannedAmount(entry);
    // Credit on check only when the item is stocked in exactly one place. With two places or none
    // it waits for the Put away panel, where the last credited place is only the default.
    const location = knownLocation(entry);
    // Optimistic: the Shop badge drops as soon as the box is checked.
    replaceEntry({ ...entry, purchased: true });
    if (amount && location) {
      await creditEntry(entry, amount, location);
    } else {
      await markWaiting(entry);
    }
  };

  const startCreditEdit = (entry) => {
    if (busyId !== null || panelBusy) return;
    setError(null);
    // Only the quantity is editable; the item name stays fixed so it cannot be overwritten.
    const parts = splitAmount(entry.credit.amount);
    setCreditEdit({ id: entry.id, quantity: abbreviateQuantity(parts.quantity), name: parts.name });
  };

  const focusEditButton = (entry) => {
    pendingFocus.current = {
      targets: [
        () => editRefs.current[entry.id],
        () => checkRefs.current[entry.id],
        () => toBuyHeadingRef.current
      ],
      expires: Date.now() + 8000
    };
  };

  // Same as before: revert the credit, then credit the corrected amount.
  const saveCreditEdit = async (entry) => {
    if (busyId !== null || panelBusy || !creditEdit) return;
    const quantity = creditEdit.quantity.trim();
    if (!quantity) {
      setError({ id: entry.id, message: 'Enter a quantity like 6 or 2 lb.' });
      return;
    }
    if (checkQuantityText(quantity) !== 'ok') {
      setError({ id: entry.id, message: QUANTITY_ERROR });
      return;
    }
    const amount = composeAmount(quantity, creditEdit.name);
    if (abbreviateAmount(amount) === abbreviateAmount(entry.credit.amount)) {
      setCreditEdit(null);
      focusEditButton(entry);
      return;
    }
    const location = entry.credit.location;
    const fresh = await revertEntry(entry);
    if (!fresh) return;
    setCreditEdit(null);
    replaceEntry({ ...fresh, purchased: true });
    await creditEntry(fresh, amount, location);
    focusEditButton(entry);
  };

  // One row of the Put away panel. Throws a readable error so the panel can show it on the row.
  const putAwayEntry = async (entry, amount, dest, previous) => {
    if (dest === 'keep') {
      rememberKept(entry.id, true);
      return null;
    }
    if (!amount) throw new Error('Enter a quantity like 6 or 2 lb.');
    let base = freshEntries.current[entry.id] || entry;
    if (previous && previous.dest !== 'keep' && (previous.amount !== amount || previous.dest !== dest)) {
      // An earlier attempt may already have credited the old values: take them back first. If its
      // POST failed nothing was credited under this id, so no DELETE is sent for it.
      if (creditedPurchases.current.has(base.purchase_id)) {
        try {
          await revertPurchase(base.purchase_id);
          creditedPurchases.current.delete(base.purchase_id);
        } catch (err) {
          // Already gone on the server, so there is nothing to take back.
        }
      }
      base = await updateGroceryEntry(entry.id, { purchased: false });
      freshEntries.current[entry.id] = base;
    }
    return creditCore(base, amount, dest);
  };

  const closePutAway = ({ credited }) => {
    setPutAwayOpen(false);
    refreshAfterChange(selectedWeek && selectedWeek.id);
    if (credited.length > 0) {
      toast.show({
        message: `Put away ${credited.length} ${credited.length === 1 ? 'item' : 'items'}`,
        actionLabel: 'Undo',
        onAction: async () => {
          focusReverted(credited);
          let failures = 0;
          for (const saved of credited) {
            if (!(await revertEntry(saved))) failures += 1;
          }
          if (failures > 0) {
            toast.show({ message: `Couldn't undo ${failures} of ${credited.length} items. They are still in stock.` });
          }
        }
      });
    }
    // The trigger is gone once everything is put away: move focus to the summary instead.
    setTimeout(() => {
      const target = putAwayTrigger.current || summaryRef.current;
      if (target) target.focus();
    }, 0);
  };

  const deleteEntry = async (entry) => {
    if (busyId !== null || panelBusy) return;
    try {
      await deleteGroceryEntry(entry.id);
      setEntries(current => current.filter(item => item.id !== entry.id));
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
      const restored = await undoGroceryChanges(payload);
      // The Undo button (or the removed row's controls) is gone: put focus on the restored row.
      focusReverted(payload.removed || []);
      setEntries(restored);
      refreshAfterChange(selectedWeek && selectedWeek.id);
      setFlash('Undone.');
    } catch (err) {
      setFlash(`${err.message} Nothing was changed.`);
    }
  };

  useUndoShortcut(Boolean(undo), undoLast);

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
    if (entry.kind === 'restock') return 'Restock';
    if (weeks && entry.week_plan_id === weeks.this.id) return 'From this week';
    if (weeks && entry.week_plan_id === weeks.next.id) return 'From next week';
    return entry.week_start ? `From week of ${shortDate(entry.week_start)}` : 'From a planned week';
  };

  const toBuy = entries.filter(entry => !entry.purchased);
  const purchased = entries.filter(entry => entry.purchased);
  // Bought but not yet in stock and not set aside with Keep on list. An entry whose save is still
  // running is not settled (its credit may be about to land), so it is not counted yet.
  const pending = purchased.filter(entry => !entry.credit && !kept.has(entry.id) && entry.id !== busyId);
  const working = busyId !== null || panelBusy;
  const data = recon.data;
  const changeCount = data ? data.changes.add.length + data.changes.update.length + data.changes.remove.length : 0;
  const warningCount = data
    ? data.ingredients.reduce((sum, row) => sum + row.warnings.length, 0)
      + data.staples.reduce((sum, row) => sum + row.warnings.length, 0)
    : 0;
  const stillToBuy = data ? data.ingredients.filter(row => !row.covered_by_stock) : [];
  const coveredByStock = data ? data.ingredients.filter(row => row.covered_by_stock) : [];

  const renderError = (entry) =>
    error && error.id === entry.id ? <InlineError>{error.message}</InlineError> : null;

  const renderMinimumControls = (row, showHint) => {
    if (row.inventory_id) {
      return (
        <>
          <Button variant="secondary" className="shopping-list__secondary" onClick={() => openMinimumEditor(row)} aria-expanded={editorKey === row.key}>
            {row.minimum ? 'Change minimum' : 'Set minimum'}
          </Button>
          {editorKey === row.key && (
            <MinimumEditor row={row} onSaved={minimumSaved} onClose={() => setEditorKey(null)} />
          )}
        </>
      );
    }
    return showHint ? <p className="shopping-list__hint">Add stock first to set a minimum.</p> : null;
  };

  const renderPackageControls = (row) => {
    if (!row.package_eligible) return null;
    const pkgKey = `pkg:${row.key}`;
    return (
      <>
        <Button
          variant="secondary"
          className="shopping-list__secondary"
          ref={(node) => { if (node) packageToggleRefs.current[pkgKey] = node; else delete packageToggleRefs.current[pkgKey]; }}
          onClick={() => openMinimumEditor({ key: pkgKey })}
          aria-expanded={editorKey === pkgKey}
        >
          {row.package ? 'Change package size' : 'Set package size'}
        </Button>
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
      <article key={row.key} className="shopping-list__card">
        <div className="shopping-list__card-head">
          <h3 className="shopping-list__card-title">{row.item}</h3>
          <Warnings warnings={row.warnings} />
        </div>
        <dl className="shopping-list__figures">
          <div><dt>Need</dt><dd>{row.demand}</dd></div>
          <div><dt>On hand</dt><dd>{row.available}</dd></div>
          <div className={stillNeeded ? 'shopping-list__figure--still' : ''}><dt>Still to buy</dt><dd>{row.to_buy}</dd></div>
        </dl>
        {row.package && row.package.packages > 0 && (
          <dl className="shopping-list__figures">
            <div>
              <dt>Buy</dt>
              <dd>{row.package.packages} {pluralLabel(row.package.label, row.package.packages)} ({row.package.buy})</dd>
            </div>
            <div><dt>Left after cooking</dt><dd>{row.package.remainder}</dd></div>
          </dl>
        )}
        <p className="shopping-list__hint">For: {mealsSummary(row.meals)}</p>
        <div
          className="shopping-list__badges"
          tabIndex={-1}
          ref={(node) => { if (node) statusRefs.current[row.key] = node; else delete statusRefs.current[row.key]; }}
        >
          {row.covered_by_stock && <StatusPill status="ok">Covered by stock</StatusPill>}
          {row.covered && <StatusPill status="ok">On list</StatusPill>}
        </div>
        {stillNeeded && !row.covered && (
          <Button
            className="shopping-list__add-need"
            onClick={() => addIngredient(row)}
            disabled={locked || addingKey !== null || busyId !== null}
          >
            {addingKey === row.key ? 'Adding...' : row.package && row.package.packages > 0
              ? `Add ${row.package.packages} ${pluralLabel(row.package.label, row.package.packages)} to shopping list`
              : `Add ${row.to_buy} to shopping list`}
          </Button>
        )}
        {rowError && rowError.key === row.key && <InlineError>{rowError.message}</InlineError>}
        <Button
          variant="secondary"
          className="shopping-list__secondary"
          onClick={() => setExpanded(open ? null : row.key)}
          aria-expanded={open}
          aria-controls={`need-details-${idSlug(row.key)}`}
        >
          {open ? 'Hide details' : `Details (${row.meals.length} meal${row.meals.length === 1 ? '' : 's'})`}
        </Button>
        {open && (
          <div className="shopping-list__details" id={`need-details-${idSlug(row.key)}`}>
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
    <article key={row.key} className="shopping-list__card">
      <div className="shopping-list__card-head">
        <h3 className="shopping-list__card-title">{row.item}</h3>
        <Warnings warnings={row.warnings} />
      </div>
      <p className="shopping-list__hint">On hand {row.on_hand}, minimum {row.minimum}</p>
      {row.covered && (
        <div className="shopping-list__badges">
          <StatusPill status="ok">On list</StatusPill>
        </div>
      )}
      {row.warnings.map(warning => <p key={warning.type} className="shopping-list__hint">{warning.message}</p>)}
      {renderMinimumControls(row, false)}
    </article>
  );

  const renderNeeds = () => {
    if (!weeks) {
      return weeksError
        ? <ErrorState message={weeksError} retryLabel="Retry" onRetry={loadWeeks} />
        : <Skeleton rows={2} label="Loading weeks" />;
    }
    if (recon.status === 'loading') return <Skeleton rows={3} label={`Loading what ${weekName} needs`} />;
    if (!data) {
      return <ErrorState message={recon.error} retryLabel="Retry" onRetry={() => loadRecon(selectedWeek.id)} />;
    }
    return (
      <>
        {recon.error && (
          <ErrorState message={recon.error} retryLabel="Retry" onRetry={() => loadRecon(selectedWeek.id)} />
        )}
        {data.no_yield.length > 0 && (
          <p className="shopping-list__hint shopping-list__yield-hint">
            No yield set for {data.no_yield.join(', ')}. {data.no_yield.length === 1 ? 'Its quantity is' : 'Their quantities are'} used as written, not scaled by planned servings.
          </p>
        )}
        {data.meal_count === 0 && data.ingredients.length === 0 && data.unmeasured.length === 0 ? (
          <EmptyState
            message={`No meals planned for ${weekName}. Plan meals in the Weekly Planner.`}
            actionLabel={onOpenPlanner ? 'Open Weekly Planner' : undefined}
            onAction={onOpenPlanner}
          />
        ) : (
          <>
            {data.ingredients.length > 0 && stillToBuy.length === 0 && (
              <p className="shopping-list__all-good" role="status">You have everything for {weekName}.</p>
            )}
            {stillToBuy.length > 0 && (
              <div className="shopping-list__group">
                <h3 className="shopping-list__group-title">Still to buy ({stillToBuy.length})</h3>
                {stillToBuy.map(renderNeedCard)}
              </div>
            )}
            {coveredByStock.length > 0 && (
              <details className="shopping-list__group">
                <summary className="shopping-list__group-title">Covered by stock ({coveredByStock.length})</summary>
                {coveredByStock.map(renderNeedCard)}
              </details>
            )}
            {data.unmeasured.length > 0 && (
              <div className="shopping-list__group">
                <h3 className="shopping-list__group-title">Unmeasured items ({data.unmeasured.length})</h3>
                {data.unmeasured.map(line => (
                  <article key={line.line} className="shopping-list__card">
                    <h3 className="shopping-list__card-title">{line.line}</h3>
                    <p className="shopping-list__hint">For: {mealsSummary(line.meals)}</p>
                    {line.note && <p className="shopping-list__hint">{line.note}</p>}
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
      <div key={entry.id} className="shopping-list__item-wrap">
        <div className={isPurchased ? 'shopping-list__item shopping-list__item--bought' : 'shopping-list__item'}>
          <label className="shopping-list__check">
            <input
              type="checkbox"
              ref={(node) => { if (node) checkRefs.current[entry.id] = node; else delete checkRefs.current[entry.id]; }}
              checked={entry.purchased}
              disabled={working}
              aria-label={`${entry.name}, ${isPurchased ? 'bought' : 'to buy'}`}
              onChange={() => togglePurchased(entry)}
            />
          </label>
          <span className={entry.source === 'plan' ? 'shopping-list__name shopping-list__name--plan' : 'shopping-list__name'}>
            {entry.name}
            {tag && <small className="shopping-list__tag">{tag}</small>}
            {isPurchased && entry.credit && (
              <span className="shopping-list__credit">
                Added {abbreviateAmount(entry.credit.amount)} to {PLACE_LABELS[entry.credit.location] || entry.credit.location}
              </span>
            )}
            {isPurchased && !entry.credit && kept.has(entry.id) && (
              <span className="shopping-list__credit shopping-list__credit--plain">Kept on list, not added to stock</span>
            )}
            {isPurchased && !entry.credit && !kept.has(entry.id) && entry.id !== busyId && (
              <span className="shopping-list__credit shopping-list__credit--plain">Waiting to be put away</span>
            )}
          </span>
          {isPurchased && entry.credit && (
            <>
              <Button
                variant="secondary"
                ref={(node) => { if (node) editRefs.current[entry.id] = node; else delete editRefs.current[entry.id]; }}
                aria-label={`Edit amount added for ${entry.name}`}
                onClick={() => startCreditEdit(entry)}
                disabled={working}
              >
                Edit
              </Button>
              <Button
                variant="secondary"
                aria-label={`Undo: take ${entry.name} out of stock and back to To buy`}
                onClick={() => togglePurchased(entry)}
                disabled={working}
              >
                Undo
              </Button>
            </>
          )}
          <Button
            variant="icon"
            className="shopping-list__remove"
            aria-label={`Remove ${entry.name}`}
            onClick={() => deleteEntry(entry)}
            disabled={working}
          >
            <CloseIcon />
          </Button>
        </div>
        {isPurchased && entry.credit && creditEdit && creditEdit.id === entry.id && (
          <form
            className="shopping-list__panel"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              saveCreditEdit(entry);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setCreditEdit(null);
                setError(null);
                focusEditButton(entry);
              }
            }}
          >
            <label className="shopping-list__label">
              Quantity added of {creditEdit.name || entry.name}
              <input
                className="shopping-list__input"
                type="text"
                autoFocus
                value={creditEdit.quantity}
                placeholder="e.g. 6 or 2 lb"
                onChange={(e) => {
                  setCreditEdit({ ...creditEdit, quantity: e.target.value });
                  if (error && error.id === entry.id) setError(null);
                }}
                aria-invalid={error && error.id === entry.id ? true : undefined}
                aria-describedby={error && error.id === entry.id ? `credit-edit-error-${entry.id}` : undefined}
              />
            </label>
            {error && error.id === entry.id && (
              <InlineError id={`credit-edit-error-${entry.id}`}>{error.message}</InlineError>
            )}
            <div className="shopping-list__actions">
              <Button type="submit" disabled={working}>Save</Button>
              <Button variant="secondary" onClick={() => { setCreditEdit(null); setError(null); focusEditButton(entry); }} disabled={working}>
                Cancel
              </Button>
            </div>
          </form>
        )}
        {!(creditEdit && creditEdit.id === entry.id) && renderError(entry)}
      </div>
    );
  };

  const renderChecklist = () => {
    if (migration.status === 'running' && migration.local.length === 0) {
      return <Skeleton rows={3} label="Loading your list" />;
    }
    if (migration.status !== 'done') {
      return (
        <div className="shopping-list__list-section">
          <h3 className="shopping-list__group-title">Saved on this device</h3>
          <div className="shopping-list__items">
            {migration.local.map(item => (
              <div key={item.id ?? item.name} className="shopping-list__item-wrap">
                <div className={item.purchased ? 'shopping-list__item shopping-list__item--bought' : 'shopping-list__item'}>
                  <span className="shopping-list__name">{item.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (listState === 'loading') return <Skeleton rows={3} label="Loading your list" />;
    if (listState === 'error') {
      return <ErrorState message={listError} retryLabel="Retry" onRetry={refreshEntries} />;
    }
    return (
      <>
        <div className="shopping-list__list-section">
          <h3 className="shopping-list__group-title shopping-list__summary" tabIndex={-1} ref={toBuyHeadingRef}>
            To buy ({toBuy.length})
          </h3>
          <div className="shopping-list__items">
            {toBuy.length === 0 ? (
              <EmptyState message="Nothing to buy yet. Use Review changes to add what this week needs, or add an item." />
            ) : (
              toBuy.map(entry => renderEntry(entry, false))
            )}
          </div>
        </div>
        {purchased.length > 0 && (
          <div className="shopping-list__list-section shopping-list__bought">
            <div className="shopping-list__list-header">
              <h3 className="shopping-list__group-title shopping-list__summary" tabIndex={-1} ref={summaryRef}>
                Bought ({purchased.length})
              </h3>
              <Button variant="danger-quiet" onClick={clearPurchased} disabled={working}>
                Clear bought ({purchased.length})
              </Button>
            </div>
            <p className="shopping-list__put-status" role="status">
              {pending.length === 0
                ? 'Everything is put away'
                : `${pending.length} waiting to be put away`}
            </p>
            {putAwayOpen && pending.length > 0 && (
              <PutAwayPanel
                id="put-away-panel"
                items={pending}
                mealTextFor={(entry) => putAwayMealText(mealsForEntry(entry, recon.data, selectedWeek && selectedWeek.id))}
                defaultsFor={(entry) => ({
                  ...amountParts(entry),
                  dest: knownLocation(entry) || lastLocation(entry) || ''
                })}
                putAway={putAwayEntry}
                onBusyChange={setPanelBusy}
                onClose={closePutAway}
              />
            )}
            <div className="shopping-list__items">{purchased.map(entry => renderEntry(entry, true))}</div>
          </div>
        )}
      </>
    );
  };

  return (
    <div
      className={[
        'shopping-list',
        undo ? 'shopping-list--has-undo' : '',
        pending.length > 0 ? 'shopping-list--has-put-away' : ''
      ].filter(Boolean).join(' ')}
    >
      {migration.status === 'failed' && (
        <div className="shopping-list__banner" role="alert">
          <p className="shopping-list__banner-text">
            <AlertIcon size={18} />
            <span>Could not move your saved list to the new storage. Your items are safe on this device.</span>
          </p>
          <p className="shopping-list__hint">{migration.message}</p>
          <Button variant="secondary" onClick={retryMigration}>Retry</Button>
        </div>
      )}

      <div className="shopping-list__week-bar">
        <div className="shopping-list__week-selector" role="radiogroup" aria-label="Week" onKeyDown={weekKeyDown}>
          {['this', 'next'].map(which => (
            <button
              key={which}
              ref={(node) => { weekButtons.current[which] = node; }}
              role="radio"
              tabIndex={selected === which ? 0 : -1}
              aria-checked={selected === which}
              className={selected === which ? 'shopping-list__week-option shopping-list__week-option--selected' : 'shopping-list__week-option'}
              onClick={() => selectWeek(which)}
              disabled={!weeks}
            >
              {selected === which && <CheckIcon size={18} />}
              {which === 'this' ? 'This week' : 'Next week'}
            </button>
          ))}
        </div>
        {selectedWeek && (
          <p className="shopping-list__week-range">{shortDate(selectedWeek.start_date)} to {shortDate(selectedWeek.end_date)}</p>
        )}
      </div>

      <div className="shopping-list__review-bar">
        <Button
          ref={reviewButtonRef}
          onClick={openReview}
          disabled={!data}
          aria-expanded={reviewOpen}
        >
          Review changes
          {changeCount > 0 && <span className="shopping-list__count" aria-label={`${changeCount} changes`}>{changeCount}</span>}
        </Button>
        {data && (
          <p className="shopping-list__review-summary">
            {changeCount === 0 ? 'List is up to date' : `${changeCount} change${changeCount === 1 ? '' : 's'} to review`}
            {warningCount > 0 ? `, ${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}
          </p>
        )}
      </div>

      <p className="shopping-list__flash" role="status" aria-live="polite">{flash}</p>

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

      <section className="shopping-list__section" aria-label={`Needs for ${weekName}`}>
        <h2 className="shopping-list__section-title">Needs for {weekName}</h2>
        {renderNeeds()}
      </section>

      {data && data.staples.length > 0 && (
        <section className="shopping-list__section" aria-label="Staples">
          <h2 className="shopping-list__section-title">Staples ({data.staples.length})</h2>
          {data.staples.map(renderStaple)}
        </section>
      )}

      <h2 className="shopping-list__section-title">Shopping list (all weeks)</h2>
      {renderChecklist()}

      <div className="shopping-list__add" role="group" aria-label="Add item">
        <input
          className="shopping-list__input shopping-list__add-input"
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addItem();
            } else if (e.key === 'Escape') {
              setNewItem('');
              setAddError('');
            }
          }}
          placeholder="Add item..."
          aria-label="Add item"
          aria-invalid={addError ? true : undefined}
          aria-describedby={addError ? 'shopping-add-error' : undefined}
          disabled={locked}
        />
        <Button onClick={addItem} disabled={locked || !newItem.trim()} loading={adding}>
          <PlusIcon />
          Add
        </Button>
      </div>
      {addError && <InlineError id="shopping-add-error">{addError}</InlineError>}

      {pending.length > 0 && (
        <div className={putAwayOpen ? 'put-away-bar put-away-bar--open' : 'put-away-bar'}>
          <Button
            ref={putAwayTrigger}
            onClick={() => setPutAwayOpen(open => !open)}
            aria-expanded={putAwayOpen}
            aria-controls="put-away-panel"
          >
            Put away groceries ({pending.length})
          </Button>
        </div>
      )}

      {undo && (
        <div className="shopping-list__undo" role="status" aria-live="polite">
          <span className="shopping-list__undo-message">{undo.message}</span>
          <Button variant="quiet" aria-keyshortcuts={UNDO_ARIA_KEYSHORTCUTS} onClick={undoLast}>
            Undo
            <UndoHint />
          </Button>
          <Button variant="icon" aria-label="Dismiss" onClick={() => setUndo(null)}>
            <CloseIcon />
          </Button>
        </div>
      )}
    </div>
  );
}

export default ShoppingList;
