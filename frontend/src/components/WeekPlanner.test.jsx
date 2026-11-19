import { render, screen, waitFor } from '@testing-library/react'
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
