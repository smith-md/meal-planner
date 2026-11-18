import StatusPill from './StatusPill.jsx'

// Shows the "worth repeating" mark as text plus an icon. Unrated (null/undefined) renders nothing,
// so it stays distinguishable from an explicit "Not worth repeating".
export default function RepeatBadge({ value }) {
  if (value === true) return <StatusPill status="ok">Worth repeating</StatusPill>
  if (value === false) return <StatusPill status="neutral">Not worth repeating</StatusPill>
  return null
}
