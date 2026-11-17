import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createMeal, updateMeal, importRecipe } from '../api';
import { Button, Input, Textarea } from './ui';
import './MealDrawer.css';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FIELD_ORDER = ['name', 'tags', 'yield_servings', 'prep_minutes', 'cook_minutes', 'notes', 'ingredients'];
const NUMBER_FIELDS = ['yield_servings', 'prep_minutes', 'cook_minutes'];
const FORM_ID = 'meal-drawer-form';

const EMPTY = {
  name: '', tags: '', notes: '', ingredients: '',
  yield_servings: '', prep_minutes: '', cook_minutes: '', make_ahead: false
};

function toForm(meal) {
  return {
    name: meal.name ?? '',
    tags: meal.tags ?? '',
    notes: meal.notes ?? '',
    ingredients: meal.ingredients ?? '',
    yield_servings: meal.yield_servings ?? '',
    prep_minutes: meal.prep_minutes ?? '',
    cook_minutes: meal.cook_minutes ?? '',
    make_ahead: Boolean(meal.make_ahead)
  };
}

function validateField(field, value) {
  const text = String(value ?? '').trim();
  if (field === 'name') return text ? '' : 'Enter a meal name.';
  if (field === 'yield_servings') {
    if (text === '') return '';
    return /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 99 ? '' : 'Use a whole number from 1 to 99.';
  }
  if (field === 'prep_minutes' || field === 'cook_minutes') {
    if (text === '') return '';
    return /^\d+$/.test(text) && Number(text) <= 1440 ? '' : 'Use whole minutes from 0 to 1440.';
  }
  return '';
}

function validateAll(values) {
  const errors = {};
  FIELD_ORDER.forEach((f) => {
    const message = validateField(f, values[f]);
    if (message) errors[f] = message;
  });
  return errors;
}

function apiValue(field, value) {
  if (NUMBER_FIELDS.includes(field)) return String(value).trim() === '' ? null : Number(value);
  if (field === 'name') return String(value).trim();
  return value;
}

function sameValue(field, a, b) {
  return field === 'make_ahead' ? a === b : String(a ?? '').trim() === String(b ?? '').trim();
}

function changedFields(values, baseline) {
  return Object.keys(EMPTY).filter((f) => !sameValue(f, values[f], baseline[f]));
}

// Right-side drawer on desktop (page stays visible), full-height sheet on phones.
// meal: existing meal to edit, or null for a new one. initial: optional pre-fill for a new meal.
// onSaved: called after a successful save (reload the list); onClose: dismiss the drawer.
// returnFocusRef: element to focus on close if the opener no longer exists.
export default function MealDrawer({ meal = null, initial = null, onSaved, onClose, returnFocusRef }) {
  const isNew = !meal;
  const [baseline] = useState(() => (meal ? toForm(meal) : { ...EMPTY, ...(initial || {}) }));
  const [form, setForm] = useState(baseline);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [imported, setImported] = useState(false);

  const panel = useRef(null);
  const fieldRefs = useRef({});
  const retryRef = useRef(null);
  const linkRef = useRef(null);
  const keepRef = useRef(null);
  const priorFocus = useRef(null);
  // True while the drawer is programmatically giving focus away (effect cleanup, which StrictMode
  // runs once on mount). Blur then is not the user leaving the field, so it must not validate.
  const suppressBlur = useRef(false);
  const titleId = useId();
  // A failed save keeps the attempted values for Retry, so closing still counts as discarding them.
  const dirty = changedFields(form, baseline).length > 0 || Boolean(saveError);

  // Latest values for the document-level key handler.
  const live = useRef({});
  live.current = { dirty, saving, confirmDiscard, onClose };

  const requestClose = useCallback(() => {
    const { dirty: d, saving: s, onClose: close } = live.current;
    if (s) return;
    if (d) {
      priorFocus.current = document.activeElement;
      setConfirmDiscard(true);
    } else {
      close();
    }
  }, []);

  const keepEditing = useCallback(() => {
    setConfirmDiscard(false);
    const target = priorFocus.current;
    if (target?.isConnected && panel.current?.contains(target)) target.focus();
    else fieldRefs.current.name?.focus();
  }, []);

  useEffect(() => {
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    const lockScroll = window.matchMedia('(max-width: 767px)').matches;
    if (lockScroll) document.body.style.overflow = 'hidden';
    suppressBlur.current = false;
    fieldRefs.current.name?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (live.current.confirmDiscard) keepEditing();
        else requestClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = panel.current.contains(active) && active !== panel.current;
      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      suppressBlur.current = true;
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
      else returnFocusRef?.current?.focus();
    };
  }, [keepEditing, requestClose, returnFocusRef]);

  useEffect(() => {
    if (confirmDiscard) keepRef.current?.focus();
  }, [confirmDiscard]);

  useEffect(() => {
    if (saveError) retryRef.current?.focus();
  }, [saveError]);

  const setField = (field, value) => {
    // After a failed save the form shows the last saved values. Editing brings the attempted values
    // back and applies the edit on top, so nothing the user typed is lost; Save then sends them all.
    const attempted = saveError?.attempted;
    setSaveError(null);
    setForm((f) => ({ ...(attempted || f), [field]: value }));
    // Clear a shown error as soon as the value becomes valid.
    setErrors((e) => (e[field] && !validateField(field, value) ? { ...e, [field]: '' } : e));
  };

  const onBlur = (field) => () => {
    if (suppressBlur.current) return;
    const message = validateField(field, form[field]);
    setErrors((e) => ((e[field] || '') === message ? e : { ...e, [field]: message }));
  };

  const fieldProps = (field) => ({
    ref: (el) => { fieldRefs.current[field] = el; },
    value: form[field],
    error: errors[field] || undefined,
    onChange: (e) => setField(field, e.target.value),
    onBlur: onBlur(field)
  });

  const save = async (values) => {
    const found = validateAll(values);
    if (Object.keys(found).length) {
      setErrors(found);
      const first = FIELD_ORDER.find((f) => found[f]);
      fieldRefs.current[first]?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (isNew) {
        const payload = {};
        Object.keys(EMPTY).forEach((f) => { payload[f] = apiValue(f, values[f]); });
        const created = await createMeal(payload);
        // api.createMeal returns the parsed body even for HTTP errors, so check it.
        if (!created || created.id == null) {
          throw new Error((created && typeof created.detail === 'string' && created.detail) || 'The meal was not saved.');
        }
      } else {
        const changes = {};
        changedFields(values, baseline).forEach((f) => { changes[f] = apiValue(f, values[f]); });
        if (Object.keys(changes).length) await updateMeal(meal.id, changes);
      }
      await onSaved();
      onClose();
    } catch (err) {
      // Put the last saved values back and keep what the user typed so Retry can resend it.
      setForm(baseline);
      setErrors({});
      setSaveError({ message: err?.message || 'Please try again.', attempted: values });
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    save(form);
  };

  const retry = () => {
    const attempted = saveError.attempted;
    setForm(attempted);
    save(attempted);
  };

  const runImport = async () => {
    if (!importUrl.trim() || importing) return;
    setImporting(true);
    setImportError('');
    try {
      const data = await importRecipe(importUrl.trim());
      setForm((f) => ({
        ...f,
        name: data.name || '',
        notes: data.notes || '',
        tags: data.tags || '',
        ingredients: data.ingredients || '',
        yield_servings: data.yield_servings ?? ''
      }));
      setErrors({});
      setImportUrl('');
      setLinkOpen(false);
      setImported(true);
      fieldRefs.current.name?.focus();
    } catch (err) {
      setImportError(err?.message || 'Could not import that recipe. Please try again.');
      // The button was disabled while loading, which dropped focus; keep it in the drawer by the error.
      linkRef.current?.focus();
    } finally {
      setImporting(false);
    }
  };

  const title = isNew ? 'New meal' : 'Edit meal';

  return createPortal(
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel}>
        <div className="drawer__header">
          <h2 id={titleId} className="drawer__title">{title}</h2>
          <Button variant="secondary" onClick={requestClose} disabled={saving}>
            <span aria-hidden="true">×&nbsp;</span>Close
          </Button>
        </div>

        <div className="drawer__body">
          {isNew && (
            <section className="drawer__import" aria-label="Import a recipe">
              <button
                type="button"
                className="drawer__toggle"
                aria-expanded={linkOpen}
                aria-controls="drawer-link-panel"
                onClick={() => setLinkOpen(!linkOpen)}
              >
                <span>Paste a link</span>
                <span aria-hidden="true">{linkOpen ? '−' : '+'}</span>
              </button>
              {linkOpen && (
                <div className="drawer__link" id="drawer-link-panel">
                  <p className="drawer__hint">
                    Paste a recipe link (NYT Cooking, AllRecipes, etc.). We fill in the form below so you can review it.
                  </p>
                  <Input
                    ref={linkRef}
                    label="Recipe link"
                    type="url"
                    placeholder="https://cooking.nytimes.com/recipes/..."
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runImport(); } }}
                  />
                  <div>
                    <Button variant="secondary" onClick={runImport} loading={importing} disabled={!importUrl.trim()}>
                      Fill from link
                    </Button>
                  </div>
                  {importError && <p role="alert" className="drawer__error">{importError}</p>}
                </div>
              )}
              <p className="drawer__hint">Photo import is not available yet.</p>
              {imported && <p role="status" className="drawer__ok">Filled from the link. Review the details, then save.</p>}
            </section>
          )}

          <form id={FORM_ID} className="drawer__form" onSubmit={onSubmit} noValidate>
            <Input {...fieldProps('name')} label="Name" type="text" required />
            <Input
              {...fieldProps('tags')}
              label="Tags"
              type="text"
              hint="Separate with commas, e.g. vegetarian, quick, chicken"
            />
            <Input
              {...fieldProps('yield_servings')}
              label="Servings this recipe makes"
              type="number" inputMode="numeric" min="1" max="99" step="1"
              placeholder="e.g. 4"
            />
            <div className="drawer__row">
              <Input
                {...fieldProps('prep_minutes')}
                label="Prep time (min)"
                type="number" inputMode="numeric" min="0" max="1440" step="1"
                placeholder="optional"
              />
              <Input
                {...fieldProps('cook_minutes')}
                label="Cook time (min)"
                type="number" inputMode="numeric" min="0" max="1440" step="1"
                placeholder="optional"
              />
            </div>
            <label className="drawer__check">
              <input
                type="checkbox"
                checked={form.make_ahead}
                onChange={(e) => setField('make_ahead', e.target.checked)}
              />
              <span>Can be made ahead</span>
            </label>
            <Textarea {...fieldProps('notes')} label="Notes" rows={3} />
            <Textarea
              {...fieldProps('ingredients')}
              label="Ingredients"
              rows={6}
              hint="One per line."
            />
          </form>
        </div>

        <div className="drawer__footer">
          {saveError && (
            <div role="alert" className="drawer__error drawer__save-error">
              <span className="drawer__save-error-text">
                Could not save. {saveError.message} Your last saved values are shown. Retry resends the changes you tried to save. If you edit a field instead, the changes you tried to save come back along with your edit.
              </span>
              <Button ref={retryRef} variant="secondary" onClick={retry} loading={saving}>Retry</Button>
            </div>
          )}
          {confirmDiscard ? (
            <div className="drawer__discard" role="group" aria-label="Discard changes?">
              <p className="drawer__discard-text">Discard changes?</p>
              <div className="drawer__actions">
                <Button ref={keepRef} variant="secondary" onClick={keepEditing}>Keep editing</Button>
                <Button variant="primary" onClick={onClose}>Discard</Button>
              </div>
            </div>
          ) : (
            <div className="drawer__actions">
              <Button type="submit" form={FORM_ID} variant="primary" loading={saving && !saveError}>
                {isNew ? 'Create meal' : 'Save changes'}
              </Button>
              <Button variant="quiet" onClick={requestClose} disabled={saving}>Cancel</Button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
