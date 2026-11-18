import { useEffect, useRef, useState } from 'react';
import WeekPlanner from './components/WeekPlanner';
import ShoppingList from './components/ShoppingList';
import MealsLibrary from './components/MealsLibrary';
import { PlanIcon, MealsIcon, ShopIcon } from './components/NavIcons';
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
  const firstRender = useRef(true);

  useEffect(() => {
    const onHashChange = () => setCurrent(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [current]);

  const { View } = PAGES.find(page => page.id === current);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>
        Skip to content
      </a>

      <header className="app-header">
        <span className="app-brand">Meal Planner</span>
      </header>

      <nav className="app-nav" aria-label="Main">
        {PAGES.map(({ id, label, Icon }) => (
          <a
            key={id}
            href={`#/${id}`}
            className="app-nav__item"
            aria-current={id === current ? 'page' : undefined}
          >
            <span className="app-nav__icon"><Icon /></span>
            <span className="app-nav__label">{label}</span>
          </a>
        ))}
      </nav>

      <main id="main" className="app-main" tabIndex={-1} ref={main}>
        {current === 'shop'
          ? <ShoppingList onOpenPlanner={() => { window.location.hash = '#/plan'; }} />
          : <View />}
      </main>
    </div>
  );
}

export default App;
