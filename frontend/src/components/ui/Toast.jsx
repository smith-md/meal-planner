import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Button from './Button.jsx'
import { CloseIcon } from './icons.jsx'
import './Toast.css'

export const TOAST_DURATION_MS = 6000

const ToastContext = createContext(null)

// Single toast at a time: showing a new one replaces the current one.
// Timer pauses while the pointer is over the toast or focus is inside it.
export function Toast({ message, actionLabel, onAction, onDismiss, duration = TOAST_DURATION_MS }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  const remaining = useRef(duration)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (paused) return undefined
    const startedAt = Date.now()
    const id = setTimeout(() => onDismissRef.current?.(), remaining.current)
    return () => {
      clearTimeout(id)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt))
    }
  }, [paused])

  return (
    <div
      className="ui-toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      }}
    >
      <span className="ui-toast__message">{message}</span>
      {actionLabel && (
        <Button
          variant="quiet"
          className="ui-toast__action"
          onClick={() => {
            onAction?.()
            onDismiss?.()
          }}
        >
          {actionLabel}
        </Button>
      )}
      <Button variant="icon" className="ui-toast__close" aria-label="Dismiss" onClick={() => onDismiss?.()}>
        <CloseIcon />
      </Button>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const counter = useRef(0)

  const dismiss = useCallback(() => setToast(null), [])
  const show = useCallback((options) => {
    counter.current += 1
    setToast({ ...options, id: counter.current })
  }, [])
  const value = useMemo(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toast-region" role="status" aria-live="polite">
        {toast && (
          <Toast
            key={toast.id}
            message={toast.message}
            actionLabel={toast.actionLabel}
            onAction={toast.onAction}
            onDismiss={dismiss}
            duration={toast.duration}
          />
        )}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
