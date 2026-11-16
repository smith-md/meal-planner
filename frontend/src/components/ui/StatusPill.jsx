import { AlertIcon, CheckIcon, WarnIcon } from './icons.jsx'
import './StatusPill.css'

const ICONS = { ok: CheckIcon, warn: WarnIcon, danger: AlertIcon }

// Always shows an icon plus text, so color is never the only cue.
export default function StatusPill({ status = 'ok', children }) {
  const key = ICONS[status] ? status : 'ok'
  const Icon = ICONS[key]
  return (
    <span className={`ui-pill ui-pill--${key}`}>
      <Icon size={16} />
      <span>{children}</span>
    </span>
  )
}
