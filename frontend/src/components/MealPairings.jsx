import { useEffect, useId, useRef, useState } from 'react';
import { getPairings, trackIngredient, removeTrackedIngredient } from '../api';
import { Button, EmptyState, ErrorState, Input, RepeatBadge, Select, Skeleton, StatusPill, useToast } from './ui';
import { AlertIcon, ChevronIcon } from './ui/icons.jsx';
import './MealPairings.css';

const CLOSE_MS = 140; // matches --dur-out

// trackIngredient only surfaces the server's message (no HTTP status), so the 409 conflict
// ("This ingredient is already tracked. ...") is recognised by its text. Retrying it can never succeed.
const ALREADY_TRACKED = /already tracked/i;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function sourceLine(row) {
  if (row.carried) return 'Carried from last week';
  return row.source ? `Left over from ${row.source}` : 'On hand';
}

function summaryText(status, pairings) {
  if (status === 'loading') return 'Checking what you have tracked';
  if (status === 'error') return 'Could not load. Open to retry';
  if (pairings.length === 0) return 'Nothing tracked yet';
  const needs = pairings.filter(row => row.needs_more).length;
  return `${plural(pairings.length, 'ingredient')} tracked${needs > 0 ? ` · ${needs} needs more` : ''}`;
}

// open/onOpenChange are owned by the parent so the panel stays open when the planner remounts it.
// focusRequest increments when something outside asks for the amount field (the planned-meal links);
// it is handled once the panel is expanded.
export default function MealPairings({
  week, selectedSource, onSelectSource, nextWeek, onAddMeal, open, onOpenChange, focusRequest = 0
}) {
  const toast = useToast();
  const bodyId = useId();
  const [pairings, setPairings] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [failure, setFailure] = useState(null); // { message, retry }
  const [statusText, setStatusText] = useState('');
  const [added, setAdded] = useState(() => new Set()); // adds that succeeded but are not yet refreshed
  const [closing, setClosing] = useState(false);
  const amountRef = useRef(null);
  const sectionRef = useRef(null);
  const rowHeadings = useRef({});
  const hasData = useRef(false);
  const pendingFocus = useRef(null); // { rowId } or { amount: true }
  const handledFocus = useRef(focusRequest);
  const closeTimer = useRef(null);
  const source = week.meals.some(meal => String(meal.id) === selectedSource) ? selectedSource : '';

  const apply = rows => {
    hasData.current = true;
    setPairings(rows);
    setStatus('ready');
  };

  async function refresh() {
    apply(await getPairings(week.id));
    setAdded(new Set());
  }

  // The data changed on the server but the list could not be reloaded: say so and offer a retry
  // that only reloads (it never repeats the change).
  function refreshFailed(message) {
    setFailure({
      message,
      retry: async () => {
        setBusy(true);
        setFailure(null);
        try {
          await refresh();
        } catch {
          refreshFailed(message);
        } finally {
          setBusy(false);
        }
      }
    });
  }

  useEffect(() => {
    let active = true;
    getPairings(week.id)
      .then(rows => { if (active) apply(rows); })
      .catch(() => {
        if (!active) return;
        if (hasData.current) refreshFailed('Could not refresh the suggestions.');
        else setStatus('error');
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Move focus after the list re-renders (after Add or Stop tracking).
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const heading = target.rowId != null ? rowHeadings.current[target.rowId] : null;
    (heading || amountRef.current)?.focus();
  }, [pairings]);

  // An outside link asked for the amount field. The body is rendered by now, so it can take focus.
  useEffect(() => {
    if (focusRequest === handledFocus.current) return;
    handledFocus.current = focusRequest;
    if (!open) return;
    sectionRef.current?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    amountRef.current?.focus({ preventScroll: true });
  }, [focusRequest, open]);

  function toggle() {
    clearTimeout(closeTimer.current);
    if (open) {
      if (!prefersReducedMotion()) {
        setClosing(true);
        closeTimer.current = setTimeout(() => setClosing(false), CLOSE_MS);
      }
      onOpenChange(false);
    } else {
      setClosing(false);
      onOpenChange(true);
    }
  }

  function retryLoad() {
    setStatus('loading');
    refresh().catch(() => setStatus('error'));
  }

  async function find(text, sourceId) {
    setBusy(true);
    setFinding(true);
    setFailure(null);
    setStatusText('');
    try {
      const rows = await trackIngredient(week.id, text, sourceId);
      apply(rows);
      const mine = rows.filter(row => row.amount === text);
      const row = (mine.length ? mine : rows).reduce((best, item) => (!best || item.id > best.id ? item : best), null);
      const count = row ? new Set([...row.current, ...row.next_week].map(meal => meal.meal_id)).size : 0;
      setStatusText(count > 0
        ? `Tracking ${text}. ${count === 1 ? '1 meal uses it.' : `${count} meals use it.`}`
        : `Tracking ${text}. No saved meals use it yet.`);
      setAmount('');
    } catch (err) {
      setFailure({ message: err.message, retry: () => find(text, sourceId) });
    } finally {
      setBusy(false);
      setFinding(false);
      amountRef.current?.focus();
    }
  }

  async function add(row, meal, next, label) {
    setBusy(true);
    setFailure(null);
    setStatusText('');
    try {
      await onAddMeal(meal.meal_id, next);
    } catch (err) {
      setFailure({ message: err.message, retry: () => add(row, meal, next, label) });
      setBusy(false);
      return;
    }
    // The meal is added: keep this Add disabled until the refreshed suggestions arrive.
    setAdded(previous => new Set(previous).add(`${row.id}:${meal.meal_id}:${next}`));
    pendingFocus.current = { rowId: row.id };
    try {
      await refresh();
      setStatusText(`Added ${meal.name} to ${label}.${next ? '' : ' Choose a day for it under Planned, not on a day yet.'}`);
    } catch {
      pendingFocus.current = null;
      refreshFailed(`Added ${meal.name} to ${label}, but the suggestions did not refresh.`);
    } finally {
      setBusy(false);
    }
  }

  async function restore(row, sourceId) {
    setFailure(null);
    try {
      apply(await trackIngredient(week.id, row.amount, sourceId));
    } catch (err) {
      setFailure({
        message: `Could not start tracking ${row.amount} again. ${err.message}`,
        retry: () => restore(row, sourceId)
      });
    }
  }

  async function stop(row, index) {
    // Tracked rows only carry the source meal's name, so look its id up in this week's meals.
    const sourceId = row.carried ? null : (week.meals.find(meal => meal.name === row.source)?.id ?? null);
    setBusy(true);
    setFailure(null);
    setStatusText('');
    try {
      await removeTrackedIngredient(row.id);
    } catch (err) {
      setFailure({ message: err.message, retry: () => stop(row, index) });
      setBusy(false);
      return;
    }
    const following = pairings[index + 1];
    pendingFocus.current = following ? { rowId: following.id } : { amount: true };
    toast.show({
      message: `Stopped tracking ${row.amount}`,
      actionLabel: 'Undo',
      onAction: () => restore(row, sourceId)
    });
    try {
      await refresh();
    } catch {
      pendingFocus.current = null;
      refreshFailed(`Stopped tracking ${row.amount}, but the list did not refresh.`);
    } finally {
      setBusy(false);
    }
  }

  const visible = open || closing;
  const bodyState = open ? 'open' : closing ? 'closing' : 'closed';

  return (
    <section className="meal-pairings" aria-labelledby="pairing-title" ref={sectionRef}>
      <h3 id="pairing-heading" className="meal-pairings__heading">
        <button
          type="button"
          className="meal-pairings__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <span className="meal-pairings__toggle-text">
            <span id="pairing-title" className="meal-pairings__title">Use up what you have</span>
            <span className="meal-pairings__summary">{summaryText(status, pairings)}</span>
          </span>
          <span className="meal-pairings__chevron"><ChevronIcon size={24} /></span>
        </button>
      </h3>

      <div id={bodyId} className="meal-pairings__body" data-state={bodyState} hidden={!visible}>
        <form
          className="meal-pairings__form"
          onSubmit={event => {
            event.preventDefault();
            if (busy || !amount.trim()) return;
            find(amount.trim(), source ? Number(source) : null);
          }}
        >
          <Input
            ref={amountRef}
            label="Ingredient left over"
            hint="For example ½ head cabbage"
            value={amount}
            onChange={event => setAmount(event.target.value)}
            maxLength={200}
            autoComplete="off"
            required
          />
          <Select
            label="Where it came from"
            value={source}
            onChange={event => onSelectSource(event.target.value)}
          >
            <option value="">Already on hand</option>
            {week.meals.map(meal => <option key={meal.id} value={meal.id}>{meal.name}</option>)}
          </Select>
          <Button
            type="submit"
            className="meal-pairings__find"
            loading={finding}
            disabled={busy || !amount.trim()}
            aria-label={finding ? 'Finding meals' : undefined}
          >
            Find meals
          </Button>
        </form>

        <p role="status" className="meal-pairings__status">{statusText}</p>

        {failure && (
          <div role="alert" className="meal-pairings__alert">
            <AlertIcon size={20} />
            <span className="meal-pairings__alert-text">{failure.message}</span>
            {!ALREADY_TRACKED.test(failure.message) && (
              <Button variant="secondary" disabled={busy} onClick={failure.retry}>Retry</Button>
            )}
          </div>
        )}

        {status === 'loading' && <Skeleton rows={2} label="Loading your tracked ingredients" />}
        {status === 'error' && (
          <ErrorState message="Could not load your tracked ingredients." retryLabel="Retry" onRetry={retryLoad} />
        )}
        {status === 'ready' && pairings.length === 0 && (
          <EmptyState message="Nothing tracked yet. Enter an ingredient you have left over above to see meals that use it." />
        )}

        {status === 'ready' && pairings.map((row, index) => {
          const groups = [
            [row.current, nextWeek ? 'next week' : 'this week', false],
            [row.next_week, nextWeek ? 'the following week' : 'next week', true]
          ];
          const noSuggestions = !row.current.length && !row.next_week.length;
          return (
            <article key={row.id} className="meal-pairings__row">
              <h4
                className="meal-pairings__amount"
                tabIndex={-1}
                ref={element => {
                  if (element) rowHeadings.current[row.id] = element;
                  else delete rowHeadings.current[row.id];
                }}
              >
                {row.remaining || row.amount}
              </h4>
              <p className="meal-pairings__source">{sourceLine(row)}</p>
              {row.needs_more && (
                <StatusPill status="warn">{`Needs ${row.shortfall} more`}</StatusPill>
              )}
              {!row.remaining && !row.needs_more && (
                <p className="meal-pairings__note">Planned meals already use all of this.</p>
              )}
              {row.remaining && noSuggestions && (
                <p className="meal-pairings__note">
                  No saved meals use this yet. <a href="#/meals">Add meals in Meals</a>
                </p>
              )}
              {groups.map(([meals, label, next]) => (
                meals.length > 0 && (
                  <ul key={label} className="meal-pairings__suggestions" aria-label={`Suggestions for ${label}`}>
                    {meals.map(meal => (
                      <li key={meal.meal_id} className="meal-pairings__suggestion">
                        <div className="meal-pairings__suggestion-text">
                          <strong className="meal-pairings__meal">{meal.name}</strong>
                          <RepeatBadge value={meal.worth_repeating} />
                          <span className="meal-pairings__uses">Uses {meal.uses}</span>
                          {meal.extra && <span className="meal-pairings__extra">Needs {meal.extra} more</span>}
                        </div>
                        <Button
                          variant="secondary"
                          disabled={busy || added.has(`${row.id}:${meal.meal_id}:${next}`)}
                          aria-label={`Add to ${label}: ${meal.name}`}
                          onClick={() => add(row, meal, next, label)}
                        >
                          Add to {label}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )
              ))}
              <Button
                variant="quiet"
                className="meal-pairings__stop"
                disabled={busy}
                aria-label={`Stop tracking: ${row.amount}`}
                onClick={() => stop(row, index)}
              >
                Stop tracking
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
