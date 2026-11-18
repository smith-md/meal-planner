import { useEffect, useRef, useState } from 'react';
import WeekPlanner from './components/WeekPlanner';
import ShoppingList from './components/ShoppingList';
import MealsLibrary from './components/MealsLibrary';
import { PlanIcon, MealsIcon, ShopIcon } from './components/NavIcons';
import { ToastProvider } from './components/ui';
import './App.css';

const PAGES = [
  { id: 'plan', label: 'Plan', Icon: PlanIcon, View: WeekPlanner },
  { id: 'meals', label: 'Meals', Icon: MealsIcon, View: MealsLibrary },
  { id: 'shop', label: 'Shop', Icon: ShopIcon, View: ShoppingList }
];

// Each page has its own address (#/plan, #/meals, #/shop) so the phone's back button,
// refresh, and shared links all land on the right page.
const pageFromHash = () => {
  const id = window.location.hash.replace(/^#\/?/, '');
  return PAGES.some(page => page.id === id) ? id : 'plan';
};

function App() {
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
    <ToastProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>
          Skip to content
        </a>

        <header className="app-header">
          <span className="app-brand">Meal Planner</span>
        </header>

        <nav className="app-nav" aria-label="Main">
          {PAGES.map(({ id, label: pageLabel, Icon }) => (
            <a
              key={id}
              href={`#/${id}`}
              className="app-nav__item"
              aria-current={id === current ? 'page' : undefined}
            >
              <span className="app-nav__icon"><Icon /></span>
              <span className="app-nav__label">{pageLabel}</span>
            </a>
          ))}
        </nav>

        <main id="main" className="app-main" tabIndex={-1} ref={main}>
          <h1 id="page-title" className="app-title" tabIndex={-1} ref={title}>{label}</h1>
          {current === 'shop'
            ? <ShoppingList onOpenPlanner={() => { window.location.hash = '#/plan'; }} />
            : <View />}
        </main>
      </div>
    </ToastProvider>
  );
}

export default App;
