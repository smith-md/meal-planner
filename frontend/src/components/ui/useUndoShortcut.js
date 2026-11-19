import { useEffect, useRef } from 'react'

// Ctrl+Z (Cmd+Z on Apple platforms) triggers the most recently shown Undo.
// Entries live in a module-level stack so a toast and an in-page undo bar never both fire.
const stack = []
let listening = false

export function isApplePlatform() {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.userAgentData?.platform || navigator.platform || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

export const UNDO_SHORTCUT_LABEL = isApplePlatform() ? 'Cmd+Z' : 'Ctrl+Z'
export const UNDO_ARIA_KEYSHORTCUTS = isApplePlatform() ? 'Meta+Z' : 'Control+Z'

const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'range', 'color', 'file'
])

function isEditable(el) {
  if (!el || !(el instanceof Element)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  // Only text-entry inputs keep Ctrl+Z for themselves; checkboxes, buttons etc. do not.
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el.getAttribute('type') || '').toLowerCase())
  return false
}

function onKeyDown(e) {
  if (e.defaultPrevented || e.altKey || e.shiftKey) return
  if (String(e.key).toLowerCase() !== 'z') return
  const modifier = isApplePlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!modifier) return
  if (isEditable(document.activeElement) || isEditable(e.target)) return
  const top = stack[stack.length - 1]
  if (!top) return
  e.preventDefault()
  top.current()
}

export function useUndoShortcut(active, handler) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    if (!active) return undefined
    // A stable entry whose .current always calls the latest handler.
    const entry = { current: () => handlerRef.current() }
    stack.push(entry)
    if (!listening) {
      document.addEventListener('keydown', onKeyDown)
      listening = true
    }
    return () => {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
      if (!stack.length && listening) {
        document.removeEventListener('keydown', onKeyDown)
        listening = false
      }
    }
  }, [active])
}
