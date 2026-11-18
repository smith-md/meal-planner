import { useEffect, useRef, useState } from 'react';
import WeekPlanner from './components/WeekPlanner';
import ShoppingList from './components/ShoppingList';
import MealsLibrary from './components/MealsLibrary';
import KitchenPage from './components/KitchenPage';
import { GroceryEntriesProvider, useGroceryEntries } from './components/GroceryEntriesContext';
import { PlanIcon, MealsIcon, ShopIcon, KitchenIcon } from './components/NavIcons';
import { ToastProvider } from './components/ui';
import './App.css';

const PAGES = [
  { id: 'plan', label: 'Plan', Icon: PlanIcon, View: WeekPlanner },
  { id: 'meals', label: 'Meals', Icon: MealsIcon, View: MealsLibrary },
  { id: 'shop', label: 'Shop', Icon: ShopIcon, View: ShoppingList },
  { id: 'kitchen', label: 'Kitchen', Icon: KitchenIcon, View: KitchenPage }
];

// Each page has its own address (#/plan, #/meals, #/shop, #/kitchen) so the phone's back button,
// refresh, and shared links all land on the right page. A query such as #/kitchen?tab=pantry
// belongs to the page and is ignored here.
const pageFromHash = () => {
  const id = window.location.hash.replace(/^#\/?/, '').split(/[?#]/)[0];
  return PAGES.some(page => page.id === id) ? id : 'plan';
};

const BADGE_CAP = 99;

// Visible badge text and the spoken suffix for a page's nav item. Badge and dot are decorative.
function navStatus(id, { toBuy, kitchenLow }) {
  if (id === 'shop' && toBuy > 0) {
    return {
      badge: toBuy > BADGE_CAP ? `${BADGE_CAP}+` : String(toBuy),
      hint: `, ${toBuy} ${toBuy === 1 ? 'item' : 'items'} to buy`
    };
  }
  if (id === 'kitchen' && kitchenLow) return { dot: true, hint: ', staples running low' };
  return {};
}

function AppShell() {
  const { entries, kitchenLow } = useGroceryEntries();
  const toBuy = entries.filter(entry => !entry.purchased).length;
  const [current, setCurrent] = useState(pageFromHash);
  const main = useRef(null);
  const title = useRef(null);
  const renderedRoute = useRef(current);

  useEffect(() => {
    const onHashChange = () => setCurrent(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // On a route change focus moves to the page's h1, so a screen reader announces the new page.
  useEffect(() => {
    // Comparing with the previously rendered route is idempotent, so StrictMode's double
    // effect run on mount cannot move focus away from the skip link.
    if (renderedRoute.current === current) return;
    renderedRoute.current = current;
    window.scrollTo(0, 0);
    title.current?.focus({ preventScroll: true });
  }, [current]);

  const { View, label } = PAGES.find(page => page.id === current);

  return (
      <div className="app-shell">
        <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>
          Skip to content
        </a>

        <header className="app-header">
          <span className="app-brand">Meal Planner</span>
        </header>

        <nav className="app-nav" aria-label="Main">
          {PAGES.map(({ id, label: pageLabel, Icon }) => {
            const status = navStatus(id, { toBuy, kitchenLow });
            return (
              <a
                key={id}
                href={`#/${id}`}
                className="app-nav__item"
                aria-current={id === current ? 'page' : undefined}
              >
                <span className="app-nav__icon">
                  <Icon />
                  {status.badge && <span className="app-nav__badge" aria-hidden="true">{status.badge}</span>}
                  {status.dot && <span className="app-nav__dot" aria-hidden="true" />}
                </span>
                <span className="app-nav__label">
                  {pageLabel}
                  {status.hint && <span className="app-nav__hint">{status.hint}</span>}
                </span>
              </a>
            );
          })}
        </nav>

        <main id="main" className="app-main" tabIndex={-1} ref={main}>
          <h1 id="page-title" className="app-title" tabIndex={-1} ref={title}>{label}</h1>
          {current === 'shop'
            ? <ShoppingList onOpenPlanner={() => { window.location.hash = '#/plan'; }} />
            : <View />}
        </main>
      </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <GroceryEntriesProvider>
        <AppShell />
      </GroceryEntriesProvider>
    </ToastProvider>
  );
}

export default App;
