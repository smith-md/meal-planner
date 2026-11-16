import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/tokens.css'
import './gallery.css'
import {
  Button,
  Input,
  Textarea,
  Select,
  ToastProvider,
  useToast,
  InlineAddRow,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusPill,
} from '../components/ui/index.js'
import { PlusIcon, CloseIcon } from '../components/ui/icons.jsx'

function ToastDemo() {
  const toast = useToast()
  const [undone, setUndone] = useState(false)
  return (
    <>
      <div className="gallery__row">
        <Button
          variant="secondary"
          onClick={() => {
            setUndone(false)
            toast.show({
              message: 'Removed Black bean tacos',
              actionLabel: 'Undo',
              onAction: () => setUndone(true),
            })
          }}
        >
          Show toast with Undo
        </Button>
        <Button variant="secondary" onClick={() => toast.show({ message: 'Saved your changes' })}>
          Replace with a plain toast
        </Button>
      </div>
      {undone && <p className="gallery__log">Undo was pressed.</p>}
    </>
  )
}

function AddRowDemo() {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(true)
  return (
    <div className="gallery__stack">
      {open ? (
        <InlineAddRow
          label="Add grocery"
          placeholder="Name"
          onSave={(v) => setItems((prev) => [...prev, v])}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <PlusIcon />
            Add grocery
          </Button>
        </div>
      )}
      <p className="gallery__log">Saved: {items.length ? items.join(', ') : 'nothing yet'}</p>
    </div>
  )
}

function Gallery() {
  const [loading, setLoading] = useState(false)
  return (
    <main className="gallery">
      <h1>UI gallery</h1>

      <h2>Button</h2>
      <div className="gallery__row">
        <Button variant="primary">Add meal</Button>
        <Button variant="secondary">Edit meal</Button>
        <Button variant="quiet">This week</Button>
        <Button variant="danger-quiet">Remove</Button>
        <Button variant="icon" aria-label="Close">
          <CloseIcon />
        </Button>
      </div>
      <h2>Button disabled</h2>
      <div className="gallery__row">
        <Button variant="primary" disabled>Add meal</Button>
        <Button variant="secondary" disabled>Edit meal</Button>
        <Button variant="quiet" disabled>This week</Button>
        <Button variant="danger-quiet" disabled>Remove</Button>
        <Button variant="icon" aria-label="Close" disabled>
          <CloseIcon />
        </Button>
      </div>
      <h2>Button loading (width preserved)</h2>
      <div className="gallery__row">
        <Button variant="primary" loading>Save meal</Button>
        <Button variant="secondary" loading>Save meal</Button>
        <Button
          variant="primary"
          loading={loading}
          onClick={() => {
            setLoading(true)
            setTimeout(() => setLoading(false), 2000)
          }}
        >
          Save meal
        </Button>
      </div>

      <h2>Field, Input, Textarea, Select</h2>
      <div className="gallery__stack">
        <Input label="Meal name" hint="Short and recognizable." defaultValue="Black bean tacos" />
        <Input label="Quantity" error="Enter a number, like 2 or 1/2." defaultValue="abc" />
        <Textarea label="Notes" defaultValue="Warm the tortillas first." />
        <Textarea label="Prep notes" error="Notes are too long." defaultValue="" />
        <Select label="Category" defaultValue="produce">
          <option value="produce">Produce</option>
          <option value="dairy">Dairy</option>
        </Select>
        <Select label="Category (error)" error="Pick a category." defaultValue="">
          <option value="" disabled>Choose one</option>
          <option value="produce">Produce</option>
        </Select>
        <Input label="Locked" disabled defaultValue="Can't edit" />
      </div>

      <h2>Toast</h2>
      <ToastDemo />

      <h2>InlineAddRow</h2>
      <AddRowDemo />

      <h2>EmptyState</h2>
      <div className="gallery__stack">
        <EmptyState message="No meals yet. Add your first one." actionLabel="Add meal" onAction={() => {}} />
      </div>

      <h2>Skeleton</h2>
      <div className="gallery__stack">
        <Skeleton rows={3} />
      </div>

      <h2>ErrorState</h2>
      <div className="gallery__stack">
        <ErrorState message="We couldn't load your meals." onRetry={() => {}} />
      </div>

      <h2>StatusPill</h2>
      <div className="gallery__row">
        <StatusPill status="ok">Covered by stock</StatusPill>
        <StatusPill status="warn">Needs 1 more</StatusPill>
        <StatusPill status="danger">Low</StatusPill>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <Gallery />
    </ToastProvider>
  </StrictMode>,
)
