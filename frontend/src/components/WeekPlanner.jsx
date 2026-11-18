import { useState, useEffect, useRef } from 'react';
import {
  getCurrentWeekPlan, updateDayState, addMealToWeek, moveWeekMeal, removeMealFromWeek, fetchMeals,
  updateWeekMealServings, setWeekMealStatus, cookWeekMeal
} from '../api';
import MealPickerModal from './MealPickerModal';
import MealDrawer from './MealDrawer';
import MealPairings from './MealPairings';
import StockSuggestions from './StockSuggestions';
import Sheet from './Sheet';
import { Button, EmptyState, ErrorState, Select, Skeleton, StatusPill } from './ui';
import './WeekPlanner.css';

const SLOTS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' }
];
const NOT_ON_A_DAY = 'none';
const SLOT_VISIBILITY_KEY = 'meal-planner.visibleSlots';

function loadVisibleSlots() {
  const all = SLOTS.map(slot => slot.id);
  try {
    const saved = JSON.parse(window.localStorage.getItem(SLOT_VISIBILITY_KEY));
    if (Array.isArray(saved)) return all.filter(id => saved.includes(id));
  } catch {
    // Storage unavailable or unreadable: show everything.
  }
  return all;
}

function saveVisibleSlots(ids) {
  try {
    window.localStorage.setItem(SLOT_VISIBILITY_KEY, JSON.stringify(ids));
  } catch {
    // The choice still applies for this session.
  }
}

const parseDate = key => new Date(`${key}T12:00:00`);
const dateKey = date => [
  date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')
].join('-');
const monthDay = key => parseDate(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const weekday = (key, style) => parseDate(key).toLocaleDateString(undefined, { weekday: style });
const slotLabel = id => SLOTS.find(slot => slot.id === id)?.label ?? id;
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function defaultDayId(plan) {
  const today = dateKey(new Date());
  return (plan.days.find(day => day.date === today) ?? plan.days[0])?.id ?? null;
}

function nextWeekStart(plan) {
  const start = new Date(`${plan.end_date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString().slice(0, 10);
}

function ServingsInput({ meal, servings, onCommit, disabled }) {
  const [draft, setDraft] = useState(servings ?? '');
  const [error, setError] = useState('');

  const commit = async () => {
    if (draft === '' || Number(draft) === servings) {
      setDraft(servings ?? '');
      return;
    }
    setError('');
    try {
      await onCommit(meal.id, Number(draft));
    } catch (err) {
      setError(err.message);
      setDraft(servings ?? '');
    }
  };

  return (
    <div className="meal-servings">
      <label>
        Planned servings{' '}
        <input
          type="number"
          min="1"
          max="99"
          step="1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          aria-label={`Planned servings for ${meal.name}`}
        />
      </label>
      {meal.yield_servings != null && <span className="yield-info"> (recipe makes {meal.yield_servings})</span>}
      {meal.yield_servings == null && (
        <p className="yield-note">No yield set, quantities used as written</p>
      )}
      {error && <p role="alert" className="yield-error">{error}</p>}
    </div>
  );
}

// One planned meal with all of its actions. Used in the slot rows and in the unplaced list.
function PlannedMealCard({
  entry, day, placed, message, moveButtonRef, onServings, onCook, onSkipToggle, onRemove, onMove, onPairing,
  dragging, onDragStart, onDragEnd
}) {
  const { meal, schedule, servings } = entry;
  const cooked = schedule.status === 'cooked';
  const skipped = schedule.status === 'skipped';
  const draggable = placed && !cooked && !!onDragStart;
  return (
    <li
      className={`planned-meal${skipped ? ' is-skipped' : ''}${placed ? '' : ' is-unplaced'}${draggable ? ' is-draggable' : ''}${dragging ? ' is-dragging' : ''}`}
      draggable={draggable || undefined}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
    >
      <div className="planned-meal__head">
        <span className="planned-meal__name">{meal.name}</span>
        {cooked && (
          <StatusPill status="ok">
            {`Cooked${day ? ` ${day.day_name}` : ''}${schedule.cooked_servings != null ? ` (${schedule.cooked_servings} servings)` : ''}`}
          </StatusPill>
        )}
        {skipped && <StatusPill status="warn">Skipped</StatusPill>}
      </div>
      {meal.tags && <span className="planned-meal__tags">{meal.tags}</span>}
      {meal.notes && <p className="planned-meal__notes">{meal.notes}</p>}
      <ServingsInput
        key={`${meal.id}-${servings ?? ''}-${cooked}`}
        meal={meal}
        servings={servings}
        onCommit={onServings}
        disabled={cooked}
      />
      <div className="planned-meal__actions">
        {!cooked && (
          <Button
            variant="secondary"
            className="card-action"
            disabled={!placed || skipped}
            title={!placed ? 'Choose a day first' : skipped ? 'Unskip first' : 'Use up the ingredients'}
            aria-label={`Mark cooked: ${meal.name}`}
            onClick={onCook}
          >
            Mark cooked
          </Button>
        )}
        {!cooked && (
          <Button
            variant="secondary"
            className="card-action"
            ref={moveButtonRef}
            aria-label={`${placed ? 'Move' : 'Choose day for'} ${meal.name}`}
            onClick={onMove}
          >
            {placed ? 'Move' : 'Choose day'}
          </Button>
        )}
        <Button
          variant="quiet"
          className="card-action"
          disabled={cooked}
          aria-label={`${skipped ? 'Unskip' : 'Skip'} ${meal.name}`}
          onClick={onSkipToggle}
        >
          {skipped ? 'Unskip' : 'Skip'}
        </Button>
        <Button
          variant="danger-quiet"
          className="card-action"
          disabled={cooked}
          title={cooked ? 'Cooked meals cannot be removed' : 'Remove from week'}
          aria-label={`Remove ${meal.name}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      {message && <p role="alert" className="cook-message">{message}</p>}
      <Button variant="quiet" className="planned-meal__link" onClick={onPairing}>
        Find a meal for leftover ingredients
      </Button>
    </li>
  );
}

function SlotRow({ slot, day, entries, renderCard, onAdd, dragActive, dropActive, onDragTarget, onDropMeal }) {
  const skipped = day.state === 'none';
  if (skipped && !entries.length) return null;
  const droppable = dragActive && !skipped;
  return (
    <div
      className={`slot${droppable ? ' is-drop-target' : ''}${droppable && dropActive ? ' is-drop-over' : ''}`}
      data-slot={slot.id}
      onDragOver={droppable ? event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onDragTarget(true);
      } : undefined}
      onDragLeave={droppable ? event => {
        if (!event.currentTarget.contains(event.relatedTarget)) onDragTarget(false);
      } : undefined}
      onDrop={droppable ? event => {
        event.preventDefault();
        onDropMeal();
      } : undefined}
    >
      <h4 className="slot__label">{slot.label}</h4>
      {entries.length > 0 && <ul className="slot__meals">{entries.map(renderCard)}</ul>}
      {!skipped && (
        <button
          type="button"
          className="slot__add"
          data-add={`${day.id}-${slot.id}`}
          onClick={event => onAdd(event.currentTarget)}
          aria-label={`Add ${entries.length ? 'another ' : ''}${slot.label.toLowerCase()} for ${weekday(day.date, 'long')}`}
        >
          {entries.length ? '+ Add another' : `+ Add ${slot.label.toLowerCase()}`}
        </button>
      )}
    </div>
  );
}

function DayColumn({
  day, selected, today, entriesFor, hasMeals, renderCard, onToggle, onAdd, slots,
  dragActive, dropKey, onDragTarget, onDropMeal
}) {
  const skipped = day.state === 'none';
  return (
    <section
      className={`day${selected ? ' is-selected' : ''}${skipped ? ' is-skipped' : ''}${today ? ' is-today' : ''}`}
      aria-labelledby={`day-${day.id}`}
    >
      <div className="day__head">
        <h3 id={`day-${day.id}`} tabIndex={-1}>
          {weekday(day.date, 'long')} <span className="day__date">{monthDay(day.date)}</span>
        </h3>
        <Button
          variant="quiet"
          className="day__toggle"
          onClick={() => onToggle(day)}
          aria-label={`${skipped ? 'Plan this day' : 'Skip day'}: ${weekday(day.date, 'long')}`}
        >
          {skipped ? 'Plan this day' : 'Skip day'}
        </Button>
      </div>
      {slots.map(slot => (
        <SlotRow
          key={slot.id}
          slot={slot}
          day={day}
          entries={entriesFor(day.id, slot.id)}
          renderCard={renderCard}
          onAdd={opener => onAdd(day, slot.id, opener)}
          dragActive={dragActive}
          dropActive={dropKey === `${day.id}-${slot.id}`}
          onDragTarget={over => onDragTarget(day, slot.id, over)}
          onDropMeal={() => onDropMeal(day, slot.id)}
        />
      ))}
      {skipped && !hasMeals && <p className="day__skipped-note">No meals needed.</p>}
    </section>
  );
}

function DayStrip({ days, selectedId, today, countFor, onSelect }) {
  return (
    <nav className="day-strip" aria-label="Choose a day">
      {days.map(day => {
        const count = countFor(day.id);
        const selected = day.id === selectedId;
        return (
          <button
            key={day.id}
            type="button"
            className={`day-strip__day${selected ? ' is-selected' : ''}${day.state === 'none' ? ' is-skipped' : ''}`}
            aria-pressed={selected}
            aria-current={day.date === today ? 'date' : undefined}
            aria-label={`${weekday(day.date, 'long')} ${monthDay(day.date)}, ${plural(count, 'meal')} planned${day.state === 'none' ? ', no meals needed' : ''}`}
            onClick={() => onSelect(day.id)}
          >
            <span className="day-strip__name" aria-hidden="true">{weekday(day.date, 'narrow')}</span>
            <span className="day-strip__num" aria-hidden="true">{parseDate(day.date).getDate()}</span>
            <span className="day-strip__dots" aria-hidden="true">
              {count > 0 ? '●'.repeat(Math.min(count, 3)) : '·'}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// onMove({ date, slot }) rejects on failure; the sheet then shows the message and keeps its values.
function MoveSheet({ entry, days, slots, defaultDayId: fallbackDayId, onMove, onClose }) {
  const { meal, schedule } = entry;
  const placedBefore = schedule.day_id != null && SLOTS.some(slot => slot.id === schedule.slot);
  // Offer only visible slots so a meal is not moved into a hidden one; if all are hidden, offer all.
  const options = slots.length > 0 ? slots : SLOTS;
  const [dayValue, setDayValue] = useState(String(placedBefore ? schedule.day_id : fallbackDayId));
  const [slot, setSlot] = useState(() => {
    if (placedBefore && options.some(option => option.id === schedule.slot)) return schedule.slot;
    return options.some(option => option.id === 'dinner') ? 'dinner' : options[0].id;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dayRef = useRef(null);
  const unplace = dayValue === NOT_ON_A_DAY;

  // Sheet records its opener and focuses its panel first, so focus the Day select afterwards.
  useEffect(() => { dayRef.current?.focus(); }, []);

  const save = async event => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const day = days.find(item => String(item.id) === dayValue);
      await onMove(unplace || !day ? { date: null, slot: null } : { date: day.date, slot });
    } catch (err) {
      setError(err.message || 'Could not move the meal.');
      setBusy(false);
    }
  };

  return (
    <Sheet title={placedBefore ? 'Move meal' : 'Choose a day'} onClose={onClose}>
      <p className="move__meal">{meal.name}</p>
      <form className="move__form" onSubmit={save}>
      <div className="move__field">
        <Select label="Day" ref={dayRef} value={dayValue} onChange={event => setDayValue(event.target.value)}>
          {days.map(day => (
            <option key={day.id} value={String(day.id)}>{weekday(day.date, 'long')}, {monthDay(day.date)}</option>
          ))}
          <option value={NOT_ON_A_DAY}>Not on a day yet</option>
        </Select>
      </div>
      <fieldset className="move__slots" disabled={unplace}>
        <legend>Meal</legend>
        {options.map(option => (
          <label key={option.id} className={slot === option.id ? 'is-on' : ''}>
            <input type="radio" name="move-slot" value={option.id} checked={slot === option.id}
              onChange={() => setSlot(option.id)} />
            {option.label}
          </label>
        ))}
      </fieldset>
      {error && <p className="planner__error" role="alert">{error}</p>}
      <Button className="move__save" type="submit" loading={busy}>
        {unplace ? 'Take off its day' : 'Move here'}
      </Button>
      </form>
    </Sheet>
  );
}

function WeekPlanner() {
  const [weekPlan, setWeekPlan] = useState(null);
  const [meals, setMeals] = useState([]);
  const [nextWeek, setNextWeek] = useState(false);
  const [selectedDayId, setSelectedDayId] = useState(null);
  const [picker, setPicker] = useState(null); // { day, slot } for a slot, {} for the header button
  const [moving, setMoving] = useState(null); // meal id being moved
  const [newMealDraft, setNewMealDraft] = useState(null);
  const [error, setError] = useState('');
  const [pairingSource, setPairingSource] = useState('');
  // Lifted here so the panel stays open when MealPairings remounts for another week.
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingFocus, setPairingFocus] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(null); // { detail }
  const [messages, setMessages] = useState({});
  const pickerOpener = useRef(null);
  const addMealButtonRef = useRef(null);
  const moveButtons = useRef({});
  const focusMoveFor = useRef(null);
  const focusAfter = useRef(null); // { mealId, selectors } resolved after the next plan render
  const [visibleSlotIds, setVisibleSlotIds] = useState(loadVisibleSlots);
  const [dragMealId, setDragMealId] = useState(null);
  const [dropKey, setDropKey] = useState(null);

  const loadInitial = () => {
    setLoadFailed(false);
    getCurrentWeekPlan()
      .then(plan => {
        setWeekPlan(plan);
        setSelectedDayId(defaultDayId(plan));
      })
      .catch(() => setLoadFailed(true));
    loadMeals();
  };

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After a move the opener unmounts (the card lands in another row), so put focus on the
  // moved card's Move button once the new plan has rendered.
  useEffect(() => {
    const mealId = focusMoveFor.current;
    if (mealId == null) return;
    focusMoveFor.current = null;
    moveButtons.current[mealId]?.focus();
  }, [weekPlan]);

  // After Remove or Mark cooked the activated button is gone or disabled, so focus would fall to
  // BODY. Prefer the card's own Move button, then the slot's add button, then a heading.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    const own = target.mealId != null ? moveButtons.current[target.mealId] : null;
    if (own && !own.disabled) {
      own.focus();
      return;
    }
    for (const selector of target.selectors) {
      const element = document.querySelector(selector);
      if (element) {
        element.focus();
        return;
      }
    }
  }, [weekPlan]);

  const afterActionTargets = schedule => [
    ...(schedule.day_id != null ? [`[data-add="${schedule.day_id}-${schedule.slot}"]`, `#day-${schedule.day_id}`] : []),
    '#unplaced-heading',
    '#planner-add-meal' // the unplaced section is not rendered for an empty week
  ];

  const loadMeals = async () => {
    try {
      setMeals(await fetchMeals());
    } catch {
      // The picker shows its empty state when the library cannot be loaded.
    }
  };

  const reloadWeekPlan = async () => {
    setWeekPlan(await getCurrentWeekPlan(weekPlan.start_date));
  };

  const setMealMessage = (mealId, text) => setMessages(prev => ({ ...prev, [mealId]: text }));

  const runMealAction = async (mealId, action) => {
    setMealMessage(mealId, '');
    try {
      const result = await action();
      if (result && result.meal_schedule) setWeekPlan(result);
      return true;
    } catch (err) {
      setMealMessage(mealId, err.message);
      return false;
    }
  };

  const toggleDayState = async day => {
    setError('');
    try {
      await updateDayState(day.id, day.state === 'need' ? 'none' : 'need');
      await reloadWeekPlan();
    } catch (err) {
      setError(err.message || 'Could not change the day.');
    }
  };

  // Rejects on failure so the picker can show the message and stay open.
  const handlePick = async meal => {
    const placement = picker?.day ? { date: picker.day.date, slot: picker.slot } : undefined;
    setWeekPlan(await addMealToWeek(weekPlan.id, meal.id, undefined, placement));
    setPicker(null);
  };

  const handleMove = async (meal, placement) => {
    const updated = await moveWeekMeal(weekPlan.id, meal.id, placement);
    const target = placement.date ? updated.days.find(day => day.date === placement.date) : null;
    focusMoveFor.current = meal.id;
    setWeekPlan(updated);
    if (target) setSelectedDayId(target.id);
    setMoving(null);
  };

  const toggleSlot = id => {
    const next = SLOTS.map(slot => slot.id).filter(slotId =>
      slotId === id ? !visibleSlotIds.includes(slotId) : visibleSlotIds.includes(slotId));
    setVisibleSlotIds(next);
    saveVisibleSlots(next);
  };

  // Drag-to-move. The plan only changes after the server accepts the move, so a failed drop leaves
  // the card where it was and the error shows on the card.
  const endDrag = () => {
    setDragMealId(null);
    setDropKey(null);
  };

  const handleDrop = async (entry, day, slotId) => {
    endDrag();
    const { schedule, meal } = entry;
    if (schedule.day_id === day.id && schedule.slot === slotId) return;
    setMealMessage(meal.id, '');
    try {
      await handleMove(meal, { date: day.date, slot: slotId });
    } catch (err) {
      setMealMessage(meal.id, err.message || 'Could not move the meal.');
    }
  };

  const handleServingsChange = async (mealId, servings) => {
    setWeekPlan(await updateWeekMealServings(weekPlan.id, mealId, servings));
  };

  const handleRemove = async ({ meal, schedule }) => {
    // Set before the call so the focus effect sees it on the render the new plan causes.
    focusAfter.current = { mealId: null, selectors: afterActionTargets(schedule) };
    const ok = await runMealAction(meal.id, () => removeMealFromWeek(weekPlan.id, meal.id));
    if (!ok) focusAfter.current = null;
  };

  const handleSkipToggle = (meal, schedule) => runMealAction(meal.id, () =>
    setWeekMealStatus(weekPlan.id, meal.id, schedule.status === 'skipped' ? 'planned' : 'skipped'));

  const handleCook = async ({ meal, schedule, servings }) => {
    const day = weekPlan.days.find(d => d.id === schedule.day_id);
    const what = servings != null ? `${servings} servings of ${meal.name}` : meal.name;
    if (!window.confirm(`Mark ${what} cooked${day ? ` on ${day.day_name}` : ''}? This uses up the ingredients from your inventory.`)) {
      return;
    }
    setMealMessage(meal.id, '');
    try {
      const result = await cookWeekMeal(weekPlan.id, meal.id);
      const notes = [];
      const short = result.deductions.filter(d => d.short);
      if (short.length) {
        notes.push(`Not enough in stock: ${short.map(d => `${d.item} (short ${d.short}${d.unit ? ` ${d.unit}` : ''})`).join(', ')}.`);
      }
      if (result.untracked.length) {
        notes.push(`Not deducted (no measurable amount): ${result.untracked.join(', ')}.`);
      }
      setMealMessage(meal.id, notes.join(' '));
      focusAfter.current = { mealId: meal.id, selectors: afterActionTargets(schedule) };
      await reloadWeekPlan();
    } catch (err) {
      focusAfter.current = null;
      setMealMessage(meal.id, err.message);
    }
  };

  // While the other week loads the button is disabled and the current week stays on screen.
  const switchWeek = async () => {
    setError('');
    setSwitchError(null);
    setSwitching(true);
    try {
      const current = await getCurrentWeekPlan();
      const plan = nextWeek ? current : await getCurrentWeekPlan(nextWeekStart(current));
      setPairingSource('');
      setMessages({});
      setWeekPlan(plan);
      setSelectedDayId(defaultDayId(plan));
      setNextWeek(!nextWeek);
    } catch (err) {
      setSwitchError({ detail: err.message });
    } finally {
      setSwitching(false);
    }
  };

  const openPicker = (placement, opener) => {
    pickerOpener.current = opener;
    setPicker(placement);
  };

  if (!weekPlan) {
    return (
      <div className="week-planner">
        {loadFailed
          ? <ErrorState message="Could not load your week plan." retryLabel="Retry" onRetry={loadInitial} />
          : <Skeleton rows={4} label="Loading your week" />}
      </div>
    );
  }

  const servingsFor = meal => {
    const row = (weekPlan.meal_servings || []).find(item => item.meal_id === meal.id);
    return row && row.servings != null ? row.servings : (meal.yield_servings ?? null);
  };

  const entries = (weekPlan.meals || []).map(meal => ({
    meal,
    servings: servingsFor(meal),
    schedule: (weekPlan.meal_schedule || []).find(item => item.meal_id === meal.id)
      || { day_id: null, slot: null, status: 'planned', cooked_servings: null }
  }));
  const isPlaced = entry => entry.schedule.day_id != null
    && SLOTS.some(slot => slot.id === entry.schedule.slot)
    && weekPlan.days.some(day => day.id === entry.schedule.day_id);
  const unplaced = entries.filter(entry => !isPlaced(entry));
  const visibleSlots = SLOTS.filter(slot => visibleSlotIds.includes(slot.id));
  const isVisible = entry => visibleSlotIds.includes(entry.schedule.slot);
  const entriesFor = (dayId, slot) => entries.filter(entry =>
    isPlaced(entry) && entry.schedule.day_id === dayId && entry.schedule.slot === slot);
  const countFor = dayId => entries.filter(entry =>
    isPlaced(entry) && isVisible(entry) && entry.schedule.day_id === dayId).length;

  const needDays = weekPlan.days.filter(day => day.state === 'need').length;
  const totalSlots = needDays * visibleSlots.length;
  const plannedOnDays = entries.filter(entry =>
    isPlaced(entry) && isVisible(entry) && entry.schedule.status !== 'skipped').length;
  const hiddenMeals = entries.filter(entry => isPlaced(entry) && !isVisible(entry)).length;
  const dragEntry = dragMealId != null ? entries.find(entry => entry.meal.id === dragMealId) : null;
  const today = dateKey(new Date());
  const movingEntry = moving != null ? entries.find(entry => entry.meal.id === moving) : null;

  const renderCard = entry => {
    const day = weekPlan.days.find(d => d.id === entry.schedule.day_id) ?? null;
    const mealId = entry.meal.id;
    return (
      <PlannedMealCard
        key={mealId}
        entry={entry}
        day={day}
        placed={isPlaced(entry)}
        message={messages[mealId]}
        moveButtonRef={el => {
          if (el) moveButtons.current[mealId] = el;
          else delete moveButtons.current[mealId];
        }}
        onServings={handleServingsChange}
        onCook={() => handleCook(entry)}
        onSkipToggle={() => handleSkipToggle(entry.meal, entry.schedule)}
        onRemove={() => handleRemove(entry)}
        onMove={() => setMoving(mealId)}
        dragging={dragMealId === mealId}
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(mealId));
          setDragMealId(mealId);
        }}
        onDragEnd={endDrag}
        onPairing={() => {
          // The panel body only exists once expanded, so MealPairings scrolls to it and focuses
          // the amount field after it renders (see focusRequest).
          setPairingSource(String(mealId));
          setPairingOpen(true);
          setPairingFocus(count => count + 1);
        }}
      />
    );
  };

  const pickerTitle = picker?.day
    ? `Add ${slotLabel(picker.slot).toLowerCase()} · ${weekday(picker.day.date, 'short')} ${monthDay(picker.day.date)}`
    : 'Add meal to week';

  return (
    <div className="week-planner">
      <header className="planner__top">
        <div>
          <h2>{nextWeek ? 'Next week' : 'This week'}</h2>
          <p className="planner__range">{monthDay(weekPlan.start_date)} – {monthDay(weekPlan.end_date)}</p>
        </div>
        <Button
          variant="secondary"
          onClick={switchWeek}
          loading={switching}
          aria-label={switching ? `Loading ${nextWeek ? 'this' : 'next'} week` : undefined}
        >
          {nextWeek ? 'See this week' : 'See next week'}
        </Button>
      </header>

      {error && <p className="planner__error" role="alert">{error}</p>}
      {switchError && (
        <div className="planner__error planner__error--retry" role="alert">
          <span>Could not load {nextWeek ? 'this' : 'next'} week. {switchError.detail}</span>
          <Button variant="secondary" onClick={switchWeek}>Retry</Button>
        </div>
      )}

      <div className="planner__summary">
        <p role="status">
          {plannedOnDays} of {totalSlots} slots planned
          {entries.length > 0 && (
            <span className="planner__count"> · {plural(entries.length, 'meal')} in the week</span>
          )}
          {hiddenMeals > 0 && (
            <span className="planner__count"> · {plural(hiddenMeals, 'meal')} in hidden slots</span>
          )}
        </p>
        <Button ref={addMealButtonRef} id="planner-add-meal" className="planner__add"
          onClick={event => openPicker({}, event.currentTarget)}>
          + Add meal to week
        </Button>
      </div>

      <fieldset className="slot-toggle">
        <legend>Show breakfast / lunch / dinner</legend>
        {SLOTS.map(slot => (
          <label key={slot.id} className={visibleSlotIds.includes(slot.id) ? 'is-on' : ''}>
            <input
              type="checkbox"
              checked={visibleSlotIds.includes(slot.id)}
              onChange={() => toggleSlot(slot.id)}
            />
            {slot.label}
          </label>
        ))}
      </fieldset>
      {visibleSlots.length === 0 && (
        <p className="slot-toggle__empty" role="status">All meal slots are hidden. Show one above to plan meals.</p>
      )}

      {entries.length === 0 && (
        <EmptyState message="No meals planned for this week yet. Tap a slot below, or use Add meal to week." />
      )}

      <DayStrip days={weekPlan.days} selectedId={selectedDayId} today={today}
        countFor={countFor} onSelect={setSelectedDayId} />

      <div className="days">
        {weekPlan.days.map(day => (
          <DayColumn
            key={day.id}
            day={day}
            selected={day.id === selectedDayId}
            today={day.date === today}
            entriesFor={entriesFor}
            hasMeals={countFor(day.id) > 0}
            renderCard={renderCard}
            onToggle={toggleDayState}
            onAdd={(addDay, slot, opener) => openPicker({ day: addDay, slot }, opener)}
            slots={visibleSlots}
            dragActive={dragEntry != null}
            dropKey={dropKey}
            onDragTarget={(targetDay, slotId, over) => {
              const key = `${targetDay.id}-${slotId}`;
              setDropKey(current => over ? key : (current === key ? null : current));
            }}
            onDropMeal={(targetDay, slotId) => dragEntry && handleDrop(dragEntry, targetDay, slotId)}
          />
        ))}
      </div>

      {entries.length > 0 && (
        <section className="unplaced" aria-labelledby="unplaced-heading">
          <h3 id="unplaced-heading" tabIndex={-1}>Planned, not on a day yet</h3>
          {unplaced.length > 0
            ? <ul>{unplaced.map(renderCard)}</ul>
            : <p className="unplaced__empty">Every planned meal is on a day.</p>}
        </section>
      )}

      {picker && (
        <MealPickerModal
          title={pickerTitle}
          meals={meals}
          plannedIds={new Set(weekPlan.meals.map(meal => meal.id))}
          onSelect={handlePick}
          onClose={() => setPicker(null)}
          onCreateNew={(name) => {
            setPicker(null);
            setNewMealDraft({ name });
          }}
        />
      )}

      {movingEntry && (
        <MoveSheet
          entry={movingEntry}
          days={weekPlan.days}
          slots={visibleSlots}
          defaultDayId={selectedDayId ?? weekPlan.days[0]?.id}
          onMove={placement => handleMove(movingEntry.meal, placement)}
          onClose={() => setMoving(null)}
        />
      )}

      {newMealDraft && (
        <MealDrawer
          meal={null}
          initial={{ name: newMealDraft.name }}
          onSaved={loadMeals}
          onClose={() => setNewMealDraft(null)}
          returnFocusRef={pickerOpener.current?.isConnected ? pickerOpener : addMealButtonRef}
        />
      )}

      <StockSuggestions key={`stock-${weekPlan.id}`} week={weekPlan} onAdd={async mealId => {
        setWeekPlan(await addMealToWeek(weekPlan.id, mealId));
      }} />

      <MealPairings key={weekPlan.id} week={weekPlan} selectedSource={pairingSource}
        onSelectSource={setPairingSource} nextWeek={nextWeek}
        open={pairingOpen} onOpenChange={setPairingOpen} focusRequest={pairingFocus} onAddMeal={async (mealId, next) => {
        const target = next ? await getCurrentWeekPlan(nextWeekStart(weekPlan)) : weekPlan;
        const updated = await addMealToWeek(target.id, mealId);
        if (!next) setWeekPlan(updated);
      }} />
    </div>
  );
}

export default WeekPlanner;
