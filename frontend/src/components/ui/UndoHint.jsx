import { UNDO_SHORTCUT_LABEL } from './useUndoShortcut.js'
import './Toast.css'

// Visible shortcut hint shown inside an Undo button; hidden on touch-only devices via CSS.
// aria-hidden: the button carries aria-keyshortcuts, so the hint is not read twice.
export default function UndoHint() {
  return (
    <kbd className="ui-undo-hint" aria-hidden="true">
      {UNDO_SHORTCUT_LABEL}
    </kbd>
  )
}
