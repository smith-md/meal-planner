import Button from './Button.jsx'
import { AlertIcon, InboxIcon } from './icons.jsx'
import './States.css'

// One sentence and (optionally) one action.
export function EmptyState({ icon, message, actionLabel, onAction }) {
  return (
    <div className="ui-state ui-empty">
      <span className="ui-state__icon">{icon || <InboxIcon size={32} />}</span>
      <p className="ui-state__message">{message}</p>
      {actionLabel && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}

export function ErrorState({ message = 'Something went wrong.', retryLabel = 'Try again', onRetry }) {
  return (
    <div className="ui-state ui-error" role="alert">
      <span className="ui-state__icon ui-state__icon--danger">
        <AlertIcon size={32} />
      </span>
      <p className="ui-state__message">{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  )
}

// Placeholder rows while loading. Announced once as busy, not per row.
export function Skeleton({ rows = 3, label = 'Loading' }) {
  return (
    <div className="ui-skeleton" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ui-skeleton__row" aria-hidden="true" />
      ))}
    </div>
  )
}
