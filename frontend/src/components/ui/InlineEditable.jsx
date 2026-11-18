import { useEffect, useId, useRef, useState } from 'react'
import { AlertIcon } from './icons.jsx'
import './InlineEditable.css'

// A value that is a button until clicked. Click/Enter opens a labeled input; Enter or blur saves,
// Esc cancels. onSave(text) may be async and throw: the error shows inline, the input stays open,
// and the shown value is never changed until the save succeeds.
export default function InlineEditable({ value, label, editValue, placeholder, inputMode, onSave, disabled = false, className = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const buttonRef = useRef(null)
  const inputRef = useRef(null)
  const restoreFocus = useRef(false)
  const finished = useRef(false)
  const errorId = useId()
  const inputId = useId()

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else if (restoreFocus.current) {
      restoreFocus.current = false
      buttonRef.current?.focus()
    }
  }, [editing])

  const open = () => {
    if (disabled) return
    finished.current = false
    setDraft(editValue !== undefined ? String(editValue) : String(value ?? ''))
    setError('')
    setEditing(true)
  }

  const cancel = () => {
    finished.current = true
    restoreFocus.current = true
    setError('')
    setEditing(false)
  }

  const save = async (fromKeyboard) => {
    if (finished.current || busy) return
    const text = draft.trim()
    const original = editValue !== undefined ? String(editValue) : String(value ?? '')
    if (text === original.trim()) {
      finished.current = true
      restoreFocus.current = fromKeyboard
      setEditing(false)
      return
    }
    if (!text) {
      setError(`Enter a ${label.toLowerCase()}.`)
      inputRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      await onSave(text)
      finished.current = true
      restoreFocus.current = fromKeyboard
      setError('')
      setEditing(false)
    } catch (err) {
      setError(err && err.message ? err.message : 'Could not save that.')
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      save(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  const wrapper = ['ui-inline-editable', className].filter(Boolean).join(' ')

  if (!editing) {
    return (
      <span className={wrapper}>
        <button
          type="button"
          ref={buttonRef}
          className="ui-inline-editable__value"
          onClick={open}
          disabled={disabled}
          aria-label={`${label}: ${value}. Edit`}
        >
          {value}
        </button>
      </span>
    )
  }

  return (
    <span className={`${wrapper} ui-inline-editable--editing`}>
      <label className="ui-inline-editable__label" htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        ref={inputRef}
        className="ui-inline-editable__input"
        value={draft}
        placeholder={placeholder}
        inputMode={inputMode}
        disabled={busy}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => save(false)}
      />
      {error && (
        <span className="ui-inline-editable__error" id={errorId} role="alert">
          <AlertIcon size={18} />
          <span>{error}</span>
        </span>
      )}
    </span>
  )
}
