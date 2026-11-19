import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

// jsdom does not implement scrollIntoView; PutAwayPanel calls it on mount.
Element.prototype.scrollIntoView = () => {}

beforeEach(() => {
  localStorage.clear()
})
