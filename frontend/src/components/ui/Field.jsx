import { forwardRef, useId } from 'react'
import { AlertIcon } from './icons.jsx'
import './Field.css'

// Field renders a visible label, optional hint, and inline error text.
// children is a render function receiving the props the control needs:
// ({ id, 'aria-describedby', 'aria-invalid' }) => <control />
export function Field({ label, error, hint, id, className = '', children }) {
  const autoId = useId()
  const controlId = id || `ui-field-${autoId}`
  const hintId = hint ? `${controlId}-hint` : null
  const errorId = error ? `${controlId}-error` : null
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const controlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  }
  return (
    <div className={['ui-field', error ? 'ui-field--error' : '', className].filter(Boolean).join(' ')}>
      <label className="ui-field__label" htmlFor={controlId}>
        {label}
      </label>
      {hint && (
        <p className="ui-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {children(controlProps)}
      {error && (
        <p className="ui-field__error" id={errorId}>
          <AlertIcon size={18} />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

export const Input = forwardRef(function Input({ label, error, hint, id, className = '', ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} id={id} className={className}>
      {(p) => <input ref={ref} className="ui-field__control ui-input" {...p} {...rest} />}
    </Field>
  )
})

export const Textarea = forwardRef(function Textarea(
  { label, error, hint, id, className = '', rows = 3, ...rest },
  ref,
) {
  return (
    <Field label={label} error={error} hint={hint} id={id} className={className}>
      {(p) => <textarea ref={ref} rows={rows} className="ui-field__control ui-textarea" {...p} {...rest} />}
    </Field>
  )
})

export const Select = forwardRef(function Select(
  { label, error, hint, id, className = '', children, ...rest },
  ref,
) {
  return (
    <Field label={label} error={error} hint={hint} id={id} className={className}>
      {(p) => (
        <select ref={ref} className="ui-field__control ui-select" {...p} {...rest}>
          {children}
        </select>
      )}
    </Field>
  )
})
