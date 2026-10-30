import { describe, expect, it } from 'vitest'
import { toggleAlwaysOnTop } from './always-on-top'

function window() {
  let enabled = false
  return { isAlwaysOnTop: () => enabled, setAlwaysOnTop: (value: boolean) => { enabled = value } }
}

describe('native always-on-top toggle', () => {
  it('toggles the requested window without affecting another', () => {
    const first = window(), second = window()
    expect(toggleAlwaysOnTop(first)).toBe(true)
    expect(second.isAlwaysOnTop()).toBe(false)
    expect(toggleAlwaysOnTop(first)).toBe(false)
  })
  it('uses the current native state even if it was changed elsewhere', () => {
    const target = window()
    target.setAlwaysOnTop(true)
    expect(toggleAlwaysOnTop(target)).toBe(false)
  })
})
