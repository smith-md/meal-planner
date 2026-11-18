// Small inline SVG icons (20px, stroke 1.75, decorative by default).
function Svg({ children, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function AlertIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5v.01" />
    </Svg>
  )
}

export function CheckIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </Svg>
  )
}

export function WarnIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 4 3 19.5h18L12 4Z" />
      <path d="M12 10v4" />
      <path d="M12 17v.01" />
    </Svg>
  )
}

export function CloseIcon(props) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </Svg>
  )
}

export function PlusIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  )
}

export function ChevronIcon(props) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

export function InboxIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 13 6.5 5h11L20 13v6H4v-6Z" />
      <path d="M4 13h5l1 2h4l1-2h5" />
    </Svg>
  )
}
