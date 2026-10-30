import { describe, expect, it } from 'vitest'
import { CloseCoordinator } from './close-coordinator'

describe('close coordination', () => {
  it('does not close until pending operations finish and blocks new operations while closing', () => {
    const coordinator = new CloseCoordinator()
    const finish = coordinator.start()!
    expect(coordinator.begin()).toBe(false)
    finish(); finish()
    expect(coordinator.pending).toBe(0)
    expect(coordinator.begin()).toBe(true)
    expect(coordinator.start()).toBeNull()
    expect(coordinator.begin()).toBe(false)
    coordinator.end()
    expect(coordinator.start()).toBeTypeOf('function')
  })
})
