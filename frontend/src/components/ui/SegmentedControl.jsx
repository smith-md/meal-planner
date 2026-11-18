import { useRef } from 'react'
import './SegmentedControl.css'

// A radiogroup with a roving tabindex: Tab enters on the selected option, Arrow keys move
// (and select) with wrap-around, Home/End jump to the first/last option.
export default function SegmentedControl({ label, options, value, onChange, className = '' }) {
  const refs = useRef([])
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))

  const choose = (index) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    refs.current[index]?.focus()
  }

  const onKeyDown = (event, index) => {
    const last = options.length - 1
    let next = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index === last ? 0 : index + 1
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index === 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return
    event.preventDefault()
    choose(next)
  }

  return (
    <div role="radiogroup" aria-label={label} className={['ui-segmented', className].filter(Boolean).join(' ')}>
      {options.map((option, index) => {
        const checked = index === selectedIndex
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            ref={node => { refs.current[index] = node }}
            className={`ui-segmented__option${checked ? ' ui-segmented__option--on' : ''}`}
            onClick={() => choose(index)}
            onKeyDown={event => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
