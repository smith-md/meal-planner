import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({
  getCurrentWeekPlan: vi.fn(),
  updateDayState: vi.fn(),
  addMealToWeek: vi.fn(),
  moveWeekMeal: vi.fn(),
  removeMealFromWeek: vi.fn(),
  fetchMeals: vi.fn(),
  updateWeekMealServings: vi.fn(),
  setWeekMealStatus: vi.fn(),
  cookWeekMeal: vi.fn(),
  setWeekMealWorthRepeating: vi.fn(),
  reserveLeftover: vi.fn(),
  updateLeftover: vi.fn(),
  releaseLeftover: vi.fn(),
  getStockSuggestions: vi.fn(),
  getPairings: vi.fn(),
  trackIngredient: vi.fn(),
  removeTrackedIngredient: vi.fn()
}))

import * as api from '../api'
import WeekPlanner from './WeekPlanner.jsx'
import { ToastProvider } from './ui/Toast.jsx'

function makePlan(id, startDay) {
  const days = Array.from({ length: 7 }, (_, index) => ({
    id: id * 10 + index,
    date: `2026-11-${String(startDay + index).padStart(2, '0')}`,
    state: 'need'
  }))
  return {
    id,
    start_date: days[0].date,
    end_date: days[6].date,
    days,
    meals: [],
    meal_schedule: [],
    meal_servings: [],
    leftovers: []
  }
}

describe('Plan: switching weeks keeps focus on the week toggle (AC2c)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('moves focus back to the toggle after it was disabled while loading', async () => {
    const thisWeek = makePlan(1, 16)
    const nextWeek = makePlan(2, 23)
    api.fetchMeals.mockResolvedValue([])
    api.getStockSuggestions.mockResolvedValue({ suggestions: [], position: 'this' })
    api.getPairings.mockResolvedValue([])

    let releaseNextWeek
    const nextWeekLoaded = new Promise(resolve => {
      releaseNextWeek = () => resolve(nextWeek)
    })
    // 1: initial load, 2: switchWeek asks for the current week, 3: switchWeek asks for next week.
    api.getCurrentWeekPlan
      .mockResolvedValueOnce(thisWeek)
      .mockResolvedValueOnce(thisWeek)
      .mockReturnValueOnce(nextWeekLoaded)

    const user = userEvent.setup()
    render(
      <ToastProvider>
        <WeekPlanner />
      </ToastProvider>
    )
    const toggle = await screen.findByRole('button', { name: 'See next week' })

    // jsdom keeps focus on a button that becomes disabled (and ignores blur() on a disabled
    // element); browsers drop focus to BODY. Mimic the browser so the test can tell whether
    // the component restores focus: briefly clear the attribute, blur, then set it again.
    const observer = new MutationObserver(() => {
      if (toggle.hasAttribute('disabled') && document.activeElement === toggle) {
        toggle.removeAttribute('disabled')
        toggle.blur()
        toggle.setAttribute('disabled', '')
      }
    })
    observer.observe(toggle, { attributes: true, attributeFilter: ['disabled'] })

    try {
      await user.click(toggle)
      await waitFor(() => expect(toggle).toBeDisabled())
      expect(document.activeElement).toBe(document.body)

      releaseNextWeek()
      await screen.findByRole('heading', { level: 2, name: 'Next week' })
      const switched = screen.getByRole('button', { name: 'See this week' })
      expect(switched).toBe(toggle)
      await waitFor(() => expect(toggle).toBeEnabled())
      expect(document.activeElement).not.toBe(document.body)
      expect(toggle).toHaveFocus()
    } finally {
      observer.disconnect()
    }
  })
})

// Dates far from today so the default selected day is always the first one.
function makeCookPlan(cooked) {
  const days = Array.from({ length: 7 }, (_, index) => ({
    id: 10 + index,
    date: `2030-01-${String(7 + index).padStart(2, '0')}`,
    day_name: 'Monday',
    state: 'need'
  }))
  const schedule = { meal_id: 5, day_id: 10, slot: 'dinner', status: 'planned', cooked_servings: null }
  return {
    id: 1,
    start_date: days[0].date,
    end_date: days[6].date,
    days,
    meals: [{ id: 5, name: 'Soup', yield_servings: 4 }],
    meal_schedule: [cooked
      ? { ...schedule, status: 'cooked', cooked_servings: 4, eaten_servings: cooked.eaten,
        remaining_servings: 4 - cooked.eaten, reserved_servings: 0 }
      : schedule],
    meal_servings: [{ meal_id: 5, servings: 4 }],
    leftovers: []
  }
}

async function cookSoup(cookedPlan, eaten) {
  api.fetchMeals.mockResolvedValue([])
  api.getStockSuggestions.mockResolvedValue({ suggestions: [], position: 'this' })
  api.getPairings.mockResolvedValue([])
  api.getCurrentWeekPlan
    .mockResolvedValueOnce(makeCookPlan(null))
    .mockResolvedValueOnce(cookedPlan)
  api.cookWeekMeal.mockResolvedValue({ deductions: [], untracked: [] })

  const user = userEvent.setup()
  render(
    <ToastProvider>
      <WeekPlanner />
    </ToastProvider>
  )
  await user.click(await screen.findByRole('button', { name: 'Mark cooked: Soup' }))
  const dialog = await screen.findByRole('dialog')
  const eatenInput = within(dialog).getByLabelText('Eaten now')
  await user.clear(eatenInput)
  await user.type(eatenInput, String(eaten))
  await user.click(within(dialog).getByRole('button', { name: 'Mark cooked' }))
}

describe('Plan: focus after Mark cooked saves (#66)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('focuses Save leftovers when portions are left over (AC1)', async () => {
    await cookSoup(makeCookPlan({ eaten: 2 }), 2)
    const save = await screen.findByRole('button', { name: 'Save leftovers: Soup' })
    await waitFor(() => expect(save).toHaveFocus())
  })

  it('focuses the checked feedback option when nothing is left over (AC2)', async () => {
    await cookSoup(makeCookPlan({ eaten: 4 }), 4)
    const group = await screen.findByRole('radiogroup', { name: 'Worth repeating feedback for Soup' })
    expect(screen.queryByRole('button', { name: 'Save leftovers: Soup' })).toBeNull()
    const checked = within(group).getByRole('radio', { checked: true })
    await waitFor(() => expect(checked).toHaveFocus())
  })
})

describe('Plan: a failed week-switch Retry keeps focus on Retry (AC3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps focus on the toggle after the first failure and on Retry after a second', async () => {
    api.fetchMeals.mockResolvedValue([])
    api.getStockSuggestions.mockResolvedValue({ suggestions: [], position: 'this' })
    api.getPairings.mockResolvedValue([])
    api.getCurrentWeekPlan
      .mockResolvedValueOnce(makePlan(1, 16))
      .mockRejectedValueOnce(new Error('Network down'))
      .mockRejectedValueOnce(new Error('Still down'))

    const user = userEvent.setup()
    render(
      <ToastProvider>
        <WeekPlanner />
      </ToastProvider>
    )
    const toggle = await screen.findByRole('button', { name: 'See next week' })
    await user.click(toggle)
    await screen.findByText(/Network down/)
    await waitFor(() => expect(toggle).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(/Still down/)
    const retry = screen.getByRole('button', { name: 'Retry' })
    await waitFor(() => expect(retry).toHaveFocus())
  })

  it('moves focus to the toggle when Retry succeeds', async () => {
    api.fetchMeals.mockResolvedValue([])
    api.getStockSuggestions.mockResolvedValue({ suggestions: [], position: 'this' })
    api.getPairings.mockResolvedValue([])
    api.getCurrentWeekPlan
      .mockResolvedValueOnce(makePlan(1, 16))
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValueOnce(makePlan(1, 16))
      .mockResolvedValueOnce(makePlan(2, 23))

    const user = userEvent.setup()
    render(
      <ToastProvider>
        <WeekPlanner />
      </ToastProvider>
    )
    const toggle = await screen.findByRole('button', { name: 'See next week' })
    await user.click(toggle)
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    await screen.findByRole('heading', { level: 2, name: 'Next week' })
    await waitFor(() => expect(toggle).toHaveFocus())
  })
})
