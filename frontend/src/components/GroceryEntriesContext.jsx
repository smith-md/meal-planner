import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getStaples, importLocalEntries, listGroceryEntries } from '../api';

// Grocery entries live above the pages so the Shop nav badge can count unchecked items and the
// Kitchen nav dot can show low staples, whichever page is open.
const LOCAL_KEY = 'shoppingList';
const BACKUP_KEY = 'shoppingList.migrated';
const IMPORT_CHUNK = 500;

const GroceryEntriesContext = createContext(null);

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

export function GroceryEntriesProvider({ children }) {
  const [entries, setEntries] = useState([]);
  const [listState, setListState] = useState('loading'); // loading | ready | error
  const [listError, setListError] = useState('');
  const [migration, setMigration] = useState({ status: 'running', local: [], message: '' }); // running | failed | done
  const [notice, setNotice] = useState('');
  const [kitchenLow, setKitchenLow] = useState(false);

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

  // Quiet: a failed check keeps the last known dot rather than flashing an error in the nav.
  const refreshKitchenStatus = useCallback(async () => {
    try {
      const staples = await getStaples();
      setKitchenLow(Array.isArray(staples) && staples.some(row => row.low));
    } catch (err) {
      console.error('Error loading kitchen status:', err);
    }
  }, []);

  // Move the browser-only list to the server once, before the server list is read, so the
  // entries (and the Shop badge) are never counted from a half-migrated list.
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
        setNotice('Your saved list was moved.');
      } catch (err) {
        setMigration({ status: 'failed', local: local.items, message: err.message });
      }
      return;
    }
    if (local.valid) localStorage.removeItem(LOCAL_KEY); // an empty list needs no migration
    setMigration({ status: 'done', local: [], message: '' });
    await refreshEntries();
  }, [refreshEntries]);

  useEffect(() => {
    startup();
    refreshKitchenStatus();
  }, [startup, refreshKitchenStatus]);

  const clearNotice = useCallback(() => setNotice(''), []);

  const value = useMemo(() => ({
    entries, setEntries, refreshEntries, listState, setListState, listError, setListError,
    migration, retryMigration: startup, notice, clearNotice,
    kitchenLow, refreshKitchenStatus
  }), [entries, refreshEntries, listState, listError, migration, startup, notice, clearNotice,
    kitchenLow, refreshKitchenStatus]);

  return <GroceryEntriesContext.Provider value={value}>{children}</GroceryEntriesContext.Provider>;
}

export function useGroceryEntries() {
  const value = useContext(GroceryEntriesContext);
  if (!value) throw new Error('useGroceryEntries must be used inside GroceryEntriesProvider.');
  return value;
}
