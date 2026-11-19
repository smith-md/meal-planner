import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({
  getCurrentWeekPlan: vi.fn(),
  getInventory: vi.fn(),
  recordPurchase: vi.fn(),
  revertPurchase: vi.fn(),
  createGroceryEntry: vi.fn(),
  updateGroceryEntry: vi.fn(),
  deleteGroceryEntry: vi.fn(),
  clearPurchasedEntries: vi.fn(),
  undoGroceryChanges: vi.fn(),
  getReconcile: vi.fn(),
  applyReconcile: vi.fn(),
  setInventoryMinimum: vi.fn(),
  setPackageSize: vi.fn(),
  getStaples: vi.fn(),
  importLocalEntries: vi.fn(),
  listGroceryEntries: vi.fn()
}))

import * as api from '../api'
import ShoppingList from './ShoppingList.jsx'
import { GroceryEntriesProvider } from './GroceryEntriesContext.jsx'
import { ToastProvider } from './ui/Toast.jsx'

const week = { id: 1, start_date: '2026-11-16', end_date: '2026-11-22' }
const flour = { id: 1, name: '2 lb flour', purchased: true, credit: null, purchase_id: 'p1' }
const milk = { id: 2, name: 'Milk', purchased: true, credit: null, purchase_id: 'p2' }

function setupApi(entries) {
  api.listGroceryEntries.mockResolvedValue(entries)
  api.getStaples.mockResolvedValue([])
  api.getInventory.mockResolvedValue([])
  api.getCurrentWeekPlan.mockResolvedValue(week)
  api.getReconcile.mockResolvedValue({
    ingredients: [],
    staples: [],
    changes: { add: [], update: [], remove: [] },
    no_yield: [],
    unmeasured: [],
    meal_count: 0,
    fingerprint: 'f'
  })
  api.recordPurchase.mockImplementation(async (_id, amount, location) => ({ amount, location }))
  api.updateGroceryEntry.mockImplementation(async (id, changes) => {
    const base = entries.find(entry => entry.id === id)
    return { ...base, ...changes }
  })
}

async function renderShop() {
  render(
    <ToastProvider>
      <GroceryEntriesProvider>
        <ShoppingList />
      </GroceryEntriesProvider>
    </ToastProvider>
  )
  await screen.findByRole('heading', { name: /^To buy \(/ })
}

// Opens the Put away panel, puts the flour in the fridge and submits. Anything else stays pending.
async function putAwayFlour(user) {
  await user.click(screen.getByRole('button', { name: /^Put away groceries \(/ }))
  const panel = await screen.findByRole('region', { name: 'Put away groceries' })
  const row = within(panel).getByText('2 lb flour').closest('li')
  await user.click(within(row).getByRole('radio', { name: 'Fridge' }))
  await user.click(within(panel).getByRole('button', { name: /^Put away 1 item$/ }))
  await screen.findByText('Put away 1 item')
}

describe('Shop: dismissing the Put away toast returns focus (AC2a)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('focuses the Put away groceries button when items are still waiting', async () => {
    setupApi([flour, milk])
    const user = userEvent.setup()
    await renderShop()
    await putAwayFlour(user)

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    const trigger = await screen.findByRole('button', { name: /^Put away groceries \(1\)$/ })
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('focuses the Bought heading when nothing is left to put away', async () => {
    setupApi([flour])
    const user = userEvent.setup()
    await renderShop()
    await putAwayFlour(user)
    expect(screen.queryByRole('button', { name: /^Put away groceries/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    const heading = screen.getByRole('heading', { name: /^Bought \(/ })
    await waitFor(() => expect(heading).toHaveFocus())
  })
})

describe('Shop: Ctrl/Cmd+Z undoes on the Put away toast and the undo bar (AC2b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Ctrl+Z undoes the Put away toast', async () => {
    setupApi([flour, milk])
    api.revertPurchase.mockResolvedValue({})
    const user = userEvent.setup()
    await renderShop()
    await putAwayFlour(user)

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    await waitFor(() => expect(api.revertPurchase).toHaveBeenCalledWith('p1'))
    expect(screen.queryByText('Put away 1 item')).not.toBeInTheDocument()
  })

  it('Ctrl+Z restores a removed item from the undo bar', async () => {
    const entry = { id: 3, name: 'Bread', purchased: false, credit: null, purchase_id: 'p3' }
    setupApi([entry])
    api.deleteGroceryEntry.mockResolvedValue({})
    api.undoGroceryChanges.mockResolvedValue([entry])
    const user = userEvent.setup()
    await renderShop()

    await user.click(screen.getByRole('button', { name: 'Remove Bread' }))
    await screen.findByText('Removed "Bread".')
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    await waitFor(() => expect(api.undoGroceryChanges).toHaveBeenCalledWith({ removed: [entry] }))
    expect(await screen.findByText('Undone.')).toBeInTheDocument()
    expect(screen.queryByText('Removed "Bread".')).not.toBeInTheDocument()
  })

  it('Cmd+Z restores a removed item from the undo bar on an Apple platform', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const entry = { id: 3, name: 'Bread', purchased: false, credit: null, purchase_id: 'p3' }
    setupApi([entry])
    api.deleteGroceryEntry.mockResolvedValue({})
    api.undoGroceryChanges.mockResolvedValue([entry])
    const user = userEvent.setup()
    await renderShop()

    await user.click(screen.getByRole('button', { name: 'Remove Bread' }))
    await screen.findByText('Removed "Bread".')
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(api.undoGroceryChanges).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true })

    await waitFor(() => expect(api.undoGroceryChanges).toHaveBeenCalledWith({ removed: [entry] }))
  })
})
