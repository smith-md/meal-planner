import { forwardRef } from 'react'
import './Button.css'

const VARIANTS = ['primary', 'secondary', 'quiet', 'danger-quiet', 'icon']

// Loading keeps the label in the layout (hidden) so the button width never changes,
// and disables activation. For variant="icon" pass aria-label.
const Button = forwardRef(function Button(
  { variant = 'primary', loading = false, disabled = false, type = 'button', className = '', children, ...rest },
  ref,
) {
  const v = VARIANTS.includes(variant) ? variant : 'primary'
  const classes = ['ui-button', `ui-button--${v}`, loading ? 'ui-button--loading' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className="ui-button__content">{children}</span>
      {loading && <span className="ui-button__spinner" aria-hidden="true" />}
    </button>
  )
})

export default Button
