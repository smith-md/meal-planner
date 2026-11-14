import { useEffect, useRef, useState } from 'react';

const SHEET_QUERY = '(max-width: 767px)';

// True on phone widths, where the review is a modal bottom sheet; wider screens get an inline panel.
function useIsSheet() {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [sheet, setSheet] = useState(() => (supported ? window.matchMedia(SHEET_QUERY).matches : false));
  useEffect(() => {
    if (!supported) return undefined;
    const media = window.matchMedia(SHEET_QUERY);
    const update = () => setSheet(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [supported]);
  return sheet;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ReviewChanges({ changes, weekLabel, busy, error, nothingChanged, locked, onApply, onCancel, returnFocusRef }) {
  const isSheet = useIsSheet();
  const panelRef = useRef(null);
  const titleRef = useRef(null);
  const wasBusy = useRef(false);
  const total = changes.add.length + changes.update.length + changes.remove.length;

  // Focus moves in on open and returns to the button that opened the review on close.
  useEffect(() => {
    const fallback = document.activeElement;
    if (titleRef.current) titleRef.current.focus();
    return () => {
      const opener = (returnFocusRef && returnFocusRef.current) || fallback;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, [returnFocusRef]);

  // Buttons are disabled while applying, which drops focus: put it back inside the sheet afterwards.
  useEffect(() => {
    if (wasBusy.current && !busy && titleRef.current) titleRef.current.focus();
    wasBusy.current = busy;
  }, [busy]);

  // Escape closes the review (not while applying), wherever focus is on the page or in the sheet.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || busy || event.defaultPrevented) return;
      const target = event.target;
      const inPanel = panelRef.current && target instanceof Node && panelRef.current.contains(target);
      const idle = !target || target === document.body || target === document.documentElement;
      if (inPanel || idle || isSheet) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, isSheet, onCancel]);

  const handleKeyDown = (event) => {
    if (event.key === 'Tab' && isSheet && panelRef.current) {
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const applyLabel = busy
    ? 'Applying...'
    : error && !nothingChanged
      ? 'Retry'
      : `Apply ${total} change${total === 1 ? '' : 's'}`;

  return (
    <>
      {isSheet && <div className="review-scrim" onClick={() => !busy && onCancel()} aria-hidden="true" />}
      <section
        ref={panelRef}
        className="review-sheet"
        role={isSheet ? 'dialog' : 'region'}
        aria-modal={isSheet ? 'true' : undefined}
        aria-labelledby="review-title"
        onKeyDown={handleKeyDown}
      >
        <h3 id="review-title" tabIndex={-1} ref={titleRef}>Review changes for {weekLabel}</h3>
        <div className="review-body">
          {error && (
            <p className="review-error" role="alert">
              {error}{nothingChanged ? ' Nothing was changed.' : ''}
            </p>
          )}
          {total === 0 ? (
            <p className="review-empty">Your list is up to date.</p>
          ) : (
            <>
              <p className="review-note">Items you added yourself and items you have bought are never changed.</p>
              {changes.add.length > 0 && (
                <div className="review-group">
                  <h4>Add ({changes.add.length})</h4>
                  <ul>
                    {changes.add.map(change => (
                      <li key={change.entry_key}>
                        <b aria-hidden="true">+</b> {change.name}
                        {change.note && <small className="review-detail"> ({change.note})</small>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {changes.update.length > 0 && (
                <div className="review-group">
                  <h4>Update ({changes.update.length})</h4>
                  <ul>
                    {changes.update.map(change => (
                      <li key={change.entry_key}>
                        <b aria-hidden="true">~</b> {change.item || change.name}: {change.from_quantity}
                        {' '}<span aria-label="changes to">→</span> {change.to_quantity}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {changes.remove.length > 0 && (
                <div className="review-group">
                  <h4>Remove ({changes.remove.length})</h4>
                  <ul>
                    {changes.remove.map(change => (
                      <li key={change.entry_key}>
                        <b aria-hidden="true">-</b> {change.name}
                        <small className="review-detail"> (no longer needed)</small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
        <div className="review-actions">
          {total > 0 && (
            <button className="review-apply" onClick={onApply} disabled={busy || locked}>
              {applyLabel}
            </button>
          )}
          <button className="review-cancel" onClick={onCancel} disabled={busy}>
            {total > 0 ? 'Cancel' : 'Close'}
          </button>
        </div>
        <p className="sr-only" aria-live="polite">{busy ? 'Applying changes' : ''}</p>
      </section>
    </>
  );
}

export default ReviewChanges;
