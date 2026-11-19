import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTION_TOAST_DURATION_MS, ToastProvider, useToast } from './Toast.jsx'

function Harness({ onAction }) {
  const toast = useToast()
  return (
    <button type="button" onClick={() => toast.show({ message: 'Saved it', actionLabel: 'Undo', onAction })}>
      show toast
    </button>
  )
}

function renderHarness(onAction) {
  render(
    <ToastProvider>
      <Harness onAction={onAction} />
    </ToastProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'show toast' }))
  expect(screen.getByText('Saved it')).toBeInTheDocument()
}

const ctrlZ = () => fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
const cmdZ = () => fireEvent.keyDown(document.body, { key: 'z', metaKey: true })

describe('Undo toast keyboard shortcut (AC2b)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Ctrl+Z runs Undo on the toast and dismisses it', () => {
    const onAction = vi.fn()
    renderHarness(onAction)
    ctrlZ()
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Saved it')).not.toBeInTheDocument()
  })

  it('Cmd+Z runs Undo on an Apple platform, and Ctrl+Z does not', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const onAction = vi.fn()
    renderHarness(onAction)
    ctrlZ()
    expect(onAction).not.toHaveBeenCalled()
    cmdZ()
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Saved it')).not.toBeInTheDocument()
  })

  it('does not take Ctrl+Z away from a text field', () => {
    const onAction = vi.fn()
    renderHarness(onAction)
    const field = document.body.appendChild(document.createElement('input'))
    field.type = 'text'
    field.focus()
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true })
    expect(onAction).not.toHaveBeenCalled()
    field.remove()
  })
})

describe('Undo toast duration (AC2b)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays for 30 seconds', () => {
    expect(ACTION_TOAST_DURATION_MS).toBe(30000)
    renderHarness(vi.fn())
    act(() => {
      vi.advanceTimersByTime(29999)
    })
    expect(screen.getByText('Saved it')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText('Saved it')).not.toBeInTheDocument()
  })
})
