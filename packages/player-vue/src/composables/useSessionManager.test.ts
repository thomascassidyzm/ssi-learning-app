/**
 * useSessionManager.test.ts - Tests for session queue management
 */

import { describe, it, expect } from 'vitest'
import { useSessionManager } from './useSessionManager'
import type { Cycle } from '../types/Cycle'

// Helper to create test cycles
function createTestCycle(id: string): Cycle {
  return {
    id,
    seedId: 'S0001',
    legoId: 'L0001',
    type: 'debut',
    known: {
      text: 'Hello',
      audioId: 'audio-known-1',
      durationMs: 1000
    },
    target: {
      text: 'Hola',
      voice1AudioId: 'audio-target1-1',
      voice1DurationMs: 800,
      voice2AudioId: 'audio-target2-1',
      voice2DurationMs: 850
    },
    pauseDurationMs: 2000
  }
}

describe('useSessionManager', () => {
  it('getCurrentCycle returns cycle at current index', () => {
    const cycles = [
      createTestCycle('cycle-1'),
      createTestCycle('cycle-2'),
      createTestCycle('cycle-3')
    ]
    const manager = useSessionManager({ cycles })

    const current = manager.getCurrentCycle()
    expect(current).toEqual(cycles[0])
    expect(current?.id).toBe('cycle-1')
  })

  it('markCycleComplete advances index', () => {
    const cycles = [
      createTestCycle('cycle-1'),
      createTestCycle('cycle-2'),
      createTestCycle('cycle-3')
    ]
    const manager = useSessionManager({ cycles })

    expect(manager.currentIndex.value).toBe(0)

    manager.markCycleComplete()
    expect(manager.currentIndex.value).toBe(1)
    expect(manager.getCurrentCycle()?.id).toBe('cycle-2')

    manager.markCycleComplete()
    expect(manager.currentIndex.value).toBe(2)
    expect(manager.getCurrentCycle()?.id).toBe('cycle-3')
  })

  it('skipToNext skips current cycle', () => {
    const cycles = [
      createTestCycle('cycle-1'),
      createTestCycle('cycle-2'),
      createTestCycle('cycle-3')
    ]
    const manager = useSessionManager({ cycles })

    expect(manager.currentIndex.value).toBe(0)

    manager.skipToNext()
    expect(manager.currentIndex.value).toBe(1)
    expect(manager.getCurrentCycle()?.id).toBe('cycle-2')
  })

  it('jumpTo moves to specific index', () => {
    const cycles = [
      createTestCycle('cycle-1'),
      createTestCycle('cycle-2'),
      createTestCycle('cycle-3')
    ]
    const manager = useSessionManager({ cycles })

    manager.jumpTo(2)
    expect(manager.currentIndex.value).toBe(2)
    expect(manager.getCurrentCycle()?.id).toBe('cycle-3')

    manager.jumpTo(0)
    expect(manager.currentIndex.value).toBe(0)
    expect(manager.getCurrentCycle()?.id).toBe('cycle-1')
  })

  it('jumpTo ignores out-of-bounds indices', () => {
    const cycles = [
      createTestCycle('cycle-1'),
      createTestCycle('cycle-2')
    ]
    const manager = useSessionManager({ cycles })

    manager.jumpTo(10)
    expect(manager.currentIndex.value).toBe(0) // Should not change

    manager.jumpTo(-1)
    expect(manager.currentIndex.value).toBe(0) // Should not change
  })

  it('getNextCycle returns null at end', () => {
    const cycles = [
      createTestCycle('cycle-1'),
      createTestCycle('cycle-2')
    ]
    const manager = useSessionManager({ cycles })

    expect(manager.getNextCycle()?.id).toBe('cycle-2')

    manager.markCycleComplete()
    expect(manager.getNextCycle()).toBeNull()
  })

  it('getCurrentCycle returns null when complete', () => {
    const cycles = [
      createTestCycle('cycle-1')
    ]
    const manager = useSessionManager({ cycles })

    expect(manager.getCurrentCycle()?.id).toBe('cycle-1')

    manager.markCycleComplete()
    expect(manager.getCurrentCycle()).toBeNull()
    expect(manager.isComplete.value).toBe(true)
  })

  it('reset returns to start index', () => {
    const cycles = [
      createTestCycle('cycle-1'),
      createTestCycle('cycle-2'),
      createTestCycle('cycle-3')
    ]
    const manager = useSessionManager({ cycles, startIndex: 1 })

    expect(manager.currentIndex.value).toBe(1)

    manager.markCycleComplete()
    expect(manager.currentIndex.value).toBe(2)

    manager.reset()
    expect(manager.currentIndex.value).toBe(1)
    expect(manager.getCurrentCycle()?.id).toBe('cycle-2')
  })

  it('progressPercent calculates correctly', () => {
    const cycles = [
      createTestCycle('cycle-1'),
      createTestCycle('cycle-2'),
      createTestCycle('cycle-3'),
      createTestCycle('cycle-4')
    ]
    const manager = useSessionManager({ cycles })

    expect(manager.progressPercent.value).toBe(0)

    manager.markCycleComplete()
    expect(manager.progressPercent.value).toBe(25)

    manager.markCycleComplete()
    expect(manager.progressPercent.value).toBe(50)

    manager.markCycleComplete()
    expect(manager.progressPercent.value).toBe(75)

    manager.markCycleComplete()
    expect(manager.progressPercent.value).toBe(100)
  })

  it('handles empty cycle array', () => {
    const manager = useSessionManager({ cycles: [] })

    expect(manager.getCurrentCycle()).toBeNull()
    expect(manager.getNextCycle()).toBeNull()
    expect(manager.isComplete.value).toBe(true)
    expect(manager.progressPercent.value).toBe(0)
  })

  it('markCycleComplete does not advance beyond end', () => {
    const cycles = [
      createTestCycle('cycle-1')
    ]
    const manager = useSessionManager({ cycles })

    manager.markCycleComplete()
    expect(manager.currentIndex.value).toBe(1)
    expect(manager.isComplete.value).toBe(true)

    // Try to advance again
    manager.markCycleComplete()
    expect(manager.currentIndex.value).toBe(1) // Should not change
  })
})
