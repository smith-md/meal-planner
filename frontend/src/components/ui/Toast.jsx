import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Button from './Button.jsx'
import { CloseIcon } from './icons.jsx'
import UndoHint from './UndoHint.jsx'
import { UNDO_ARIA_KEYSHORTCUTS, useUndoShortcut } from './useUndoShortcut.js'
import './Toast.css'

export const TOAST_DURATION_MS = 6000
// Toasts that carry an action (Undo) stay longer (30s), so there is time to notice and act on them.
export const ACTION_TOAST_DURATION_MS = 30000

const ToastContext = createContext(null)

// Single toast at a time: showing a new one replaces the current one.
// Timer pauses while the pointer is over the toast or focus is inside it.
export function Toast({ message, actionLabel, onAction, onDismiss, duration }) {
  if (duration === undefined) duration = actionLabel ? ACTION_TOAST_DURATION_MS : TOAST_DURATION_MS
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

  const runAction = () => {
    onAction?.()
    onDismiss?.({ restoreFocus: true })
  }
  useUndoShortcut(Boolean(actionLabel), runAction)

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
          aria-keyshortcuts={UNDO_ARIA_KEYSHORTCUTS}
          onClick={runAction}
        >
          {actionLabel}
          <UndoHint />
        </Button>
      )}
      <Button variant="icon" className="ui-toast__close" aria-label="Dismiss" onClick={() => onDismiss?.({ restoreFocus: true })}>
        <CloseIcon />
      </Button>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const counter = useRef(0)

  const regionRef = useRef(null)
  const previousFocus = useRef(null)
  // Optional resolver from show({ returnFocus }) for when previousFocus has been unmounted.
  const returnFocus = useRef(null)

  // restoreFocus is set only when the user closed the toast (Undo/Dismiss).
  // Timeout dismissal never moves focus.
  const dismiss = useCallback((options) => {
    if (options?.restoreFocus) {
      const active = document.activeElement
      const inToast = active && regionRef.current?.contains(active)
      if (inToast || !active || active === document.body) {
        const target = previousFocus.current
        if (target && target.isConnected && typeof target.focus === 'function') {
          target.focus()
        } else {
          const fallback = returnFocus.current?.()
          if (fallback && fallback.isConnected && typeof fallback.focus === 'function') fallback.focus()
        }
      }
    }
    previousFocus.current = null
    returnFocus.current = null
    setToast(null)
  }, [])
  const show = useCallback((options) => {
    const active = document.activeElement
    // Keep the original element when a toast replaces another one.
    if (!active || active === document.body || regionRef.current?.contains(active)) {
      if (!previousFocus.current?.isConnected) previousFocus.current = null
    } else {
      previousFocus.current = active
    }
    returnFocus.current = typeof options?.returnFocus === 'function' ? options.returnFocus : null
    counter.current += 1
    setToast({ ...options, id: counter.current })
  }, [])
  const value = useMemo(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div ref={regionRef} className="ui-toast-region" role="status" aria-live="polite">
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
