import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, screen, waitFor } from '@testing-library/react'
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
const bread = { id: 3, name: 'Bread', purchased: false, credit: null, purchase_id: 'p3' }

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
  api.deleteGroceryEntry.mockResolvedValue({})
}

async function renderShop() {
  const view = render(
    <ToastProvider>
      <GroceryEntriesProvider>
        <ShoppingList />
      </GroceryEntriesProvider>
    </ToastProvider>
  )
  await screen.findByRole('heading', { name: /^To buy \(/ })
  return view
}

// Removing an unbought item raises the undo bar.
async function showUndoBar(user) {
  await user.click(screen.getByRole('button', { name: 'Remove Bread' }))
  await screen.findByText('Removed "Bread".')
}

const root = container => container.querySelector('.shopping-list')
const clearanceVar = container => root(container).style.getPropertyValue('--put-away-bar-clearance')

// jsdom computes no layout and no CSS, so these tests check the wiring only: that the clearance
// variable follows the bar's (mocked) top edge and the window height and is refreshed on the right
// triggers. Where the bars land on screen is not verified here.
describe('Shop: undo bar clearance follows the measured Put away bar top edge (issue 65, AC1/AC2/AC3/AC4)', () => {
  let barTop
  let observers
  const originalInnerHeight = window.innerHeight

  const setInnerHeight = value => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    barTop = 700
    observers = []
    setInnerHeight(800)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const top = this.classList.contains('put-away-bar') ? barTop : 0
      return { x: 0, y: top, top, left: 0, right: 0, bottom: top, width: 0, height: 0 }
    })
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) {
        this.callback = callback
        this.observed = []
        this.disconnect = vi.fn()
        observers.push(this)
      }
      observe(target) { this.observed.push(target) }
      unobserve() {}
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setInnerHeight(originalInnerHeight)
  })

  it('is the distance from the bar top to the viewport bottom, 0 when the bar is below the viewport', async () => {
    setupApi([flour])
    const { container } = await renderShop()
    await waitFor(() => expect(clearanceVar(container)).toBe('100px')) // 800 - 700

    barTop = 640.4 // rounds: 800 - 640.4 = 159.6
    act(() => { window.dispatchEvent(new Event('scroll')) })
    await waitFor(() => expect(clearanceVar(container)).toBe('160px'))

    barTop = 900 // bar scrolled off-screen below the viewport: never negative
    act(() => { window.dispatchEvent(new Event('scroll')) })
    await waitFor(() => expect(clearanceVar(container)).toBe('0px'))
  })

  it('updates on window resize using the new window height', async () => {
    setupApi([flour])
    const { container } = await renderShop()
    await waitFor(() => expect(clearanceVar(container)).toBe('100px'))

    setInnerHeight(900)
    act(() => { window.dispatchEvent(new Event('resize')) })
    await waitFor(() => expect(clearanceVar(container)).toBe('200px'))
  })

  it('throttles scroll events to one measurement per animation frame', async () => {
    setupApi([flour])
    const { container } = await renderShop()
    await waitFor(() => expect(clearanceVar(container)).toBe('100px'))
    const raf = vi.spyOn(window, 'requestAnimationFrame')

    barTop = 600
    act(() => {
      window.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('scroll'))
    })
    expect(raf).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(clearanceVar(container)).toBe('200px'))
  })

  it('observes both the bar and the list root, and re-measures when either resizes', async () => {
    setupApi([flour])
    const { container } = await renderShop()
    await waitFor(() => expect(clearanceVar(container)).toBe('100px'))

    const observer = observers[observers.length - 1]
    expect(observer.observed).toContain(container.querySelector('.put-away-bar'))
    expect(observer.observed).toContain(root(container))

    barTop = 650 // e.g. the label wrapped and the bar grew upward
    act(() => observers.forEach(item => item.callback()))
    expect(clearanceVar(container)).toBe('150px')
  })

  it('re-measures when the undo bar appears, because its padding moves the bar without scroll or resize', async () => {
    setupApi([flour, bread])
    const user = userEvent.setup()
    const { container } = await renderShop()
    await waitFor(() => expect(clearanceVar(container)).toBe('100px'))

    barTop = 660 // layout moved the bar; no scroll, resize or observer callback fires
    await showUndoBar(user)

    expect(container.querySelector('.put-away-bar ~ .shopping-list__undo')).toBeInTheDocument()
    expect(clearanceVar(container)).toBe('140px')
  })

  it('leaves the variable unset (CSS default offset) when there is no Put away bar', async () => {
    setupApi([bread])
    const user = userEvent.setup()
    const { container } = await renderShop()
    await showUndoBar(user)

    expect(container.querySelector('.put-away-bar')).not.toBeInTheDocument()
    expect(clearanceVar(container)).toBe('')
  })

  it('leaves the variable unset while the panel is open and sets it again when closed', async () => {
    setupApi([flour, bread])
    const user = userEvent.setup()
    const { container } = await renderShop()
    await waitFor(() => expect(clearanceVar(container)).toBe('100px'))

    await user.click(screen.getByRole('button', { name: /^Put away groceries \(/ }))
    await waitFor(() => expect(container.querySelector('.put-away-bar--open')).toBeInTheDocument())
    expect(clearanceVar(container)).toBe('')

    await user.click(screen.getByRole('button', { name: /^Put away groceries \(/ }))
    await waitFor(() => expect(clearanceVar(container)).toBe('100px'))
  })

  it('measures and follows scroll without throwing when ResizeObserver is undefined', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    setupApi([flour])
    const { container } = await renderShop()

    await waitFor(() => expect(clearanceVar(container)).toBe('100px'))
    expect(observers).toHaveLength(0)
    barTop = 500
    act(() => { window.dispatchEvent(new Event('scroll')) })
    await waitFor(() => expect(clearanceVar(container)).toBe('300px'))
  })

  it('removes its listeners and disconnects the observer when the panel opens and when the list unmounts', async () => {
    setupApi([flour, bread])
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const user = userEvent.setup()
    const { container, unmount } = await renderShop()
    await waitFor(() => expect(clearanceVar(container)).toBe('100px'))

    expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true })
    expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    const first = observers[observers.length - 1]
    expect(first.disconnect).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^Put away groceries \(/ }))
    await waitFor(() => expect(first.disconnect).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /^Put away groceries \(/ }))
    await waitFor(() => expect(clearanceVar(container)).toBe('100px'))
    const second = observers[observers.length - 1]
    expect(second).not.toBe(first)

    const scrollListener = addSpy.mock.calls.filter(call => call[0] === 'scroll').pop()[1]
    const resizeListener = addSpy.mock.calls.filter(call => call[0] === 'resize').pop()[1]
    unmount()
    expect(second.disconnect).toHaveBeenCalled()
    expect(removeSpy).toHaveBeenCalledWith('scroll', scrollListener)
    expect(removeSpy).toHaveBeenCalledWith('resize', resizeListener)
  })
})

// Text check of the stylesheet, not a layout check: the CSS is not processed under vitest, so this
// only guards against the undo bar offset reverting to a hard-coded Put away bar height or an
// assumed sticky line instead of reading the measured clearance variable.
describe('ShoppingList.css: undo bar offset uses the measured clearance variable (issue 65, AC1/AC2/AC3)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/components/ShoppingList.css'), 'utf8') // vitest runs from frontend/
  const selector = '.put-away-bar:not(.put-away-bar--open) ~ .shopping-list__undo'
  const blocks = [...css.matchAll(/@media \(([^)]*)\) \{\r?\n([\s\S]*?)\r?\n\}/g)]
    .map(match => ({ query: match[1], body: match[2] }))
    .filter(block => block.body.includes(selector))

  const ruleBody = block => {
    const start = block.body.indexOf(selector)
    return block.body.slice(block.body.indexOf('{', start) + 1, block.body.indexOf('}', start))
  }

  it.each([
    ['max-width: 1023.98px', 'var(--nav-height) + var(--space-2)'],
    ['min-width: 1024px', 'var(--space-3)']
  ])('the (%s) rule is max(default offset, clearance + gap)', (query, defaultOffset) => {
    const block = blocks.find(candidate => candidate.query === query)
    expect(block, `no ${selector} rule in @media (${query})`).toBeDefined()
    const bottom = (ruleBody(block).match(/bottom:([\s\S]*?);/)?.[1] ?? '').replace(/\s+/g, ' ')
    expect(bottom).toMatch(/^ ?max\(/)
    expect(bottom).toContain(defaultOffset)
    expect(bottom).toContain('env(safe-area-inset-bottom')
    // The unset-variable fallback is 0px, so the default offset wins until the first measurement.
    expect(bottom).toContain('calc(var(--put-away-bar-clearance, 0px) + var(--space-2))')
    expect(bottom).not.toMatch(/\d+px\s*\+\s*2 \*/) // no hard-coded bar height (44px + padding + border)
    expect(bottom).not.toContain('44px')
  })
})
