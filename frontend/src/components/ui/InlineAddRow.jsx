import { useRef, useState } from 'react'
import Button from './Button.jsx'
import { PlusIcon } from './icons.jsx'
import './InlineAddRow.css'

// Type, Enter to save, Esc to cancel. Stays open and cleared for the next entry.
export default function InlineAddRow({
  label = 'Add item',
  placeholder = '',
  saveLabel = 'Add',
  cancelLabel = 'Done',
  onSave,
  onCancel,
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef(null)

  const save = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSave?.(trimmed)
    setValue('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setValue('')
      onCancel?.()
    }
  }

  return (
    <div className="ui-inline-add" role="group" aria-label={label}>
      <input
        ref={inputRef}
        className="ui-inline-add__input"
        type="text"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Button variant="primary" onClick={save}>
        <PlusIcon />
        {saveLabel}
      </Button>
      <Button variant="quiet" onClick={() => onCancel?.()}>
        {cancelLabel}
      </Button>
    </div>
  )
}
