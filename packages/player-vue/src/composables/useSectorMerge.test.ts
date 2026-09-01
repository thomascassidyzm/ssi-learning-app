import { describe, it, expect } from 'vitest'
import type { Round } from '../playback/SimplePlayer'
import { useSectorMerge } from './useSectorMerge'

const round = (seedId: string, roundNumber: number): Round => ({
  roundNumber,
  legoId: `${seedId}L01`,
  seedId,
  cycles: [],
})

const core = [round('CS0001', 1), round('CS0001', 2), round('CS0002', 3)]
const sector = [round('XS0001', 1), round('XS0002', 2)]

// Same cadence rule usePodLapScheduler applies (activation 6, interval 5).
const lapAt = (n: number) => n >= 6 && (n - 6) % 5 === 0

describe('useSectorMerge', () => {
  it('is a core passthrough while no sector thread is enabled', () => {
    const m = useSectorMerge({ core: () => ({ rounds: core, complete: true }) })
    expect(m.isPassthrough.value).toBe(true)
    const served: number[] = []
    for (;;) {
      const r = m.nextRound()
      if (r.status !== 'round') break
      served.push(r.round.roundNumber)
    }
    expect(served).toEqual([1, 2, 3])
    expect(m.totalRounds.value).toBe(3)
  })

  it('interleaves at seed boundaries and tracks the total-rounds counter', () => {
    let enabled = true
    const m = useSectorMerge({
      core: () => ({ rounds: core, complete: true }),
      sector: () => ({ rounds: sector, complete: true }),
      sectorEnabled: () => enabled,
      shouldFireLapAt: lapAt,
    })
    const shape: string[] = []
    for (;;) {
      const r = m.nextRound()
      if (r.status !== 'round') break
      shape.push(`${r.thread}:${r.round.seedId}`)
    }
    expect(shape).toEqual([
      'core:CS0001', 'core:CS0001',
      'sector:XS0001',
      'core:CS0002',
      'sector:XS0002',
    ])
    expect(m.lastServed.value?.thread).toBe('sector')
    expect(m.activeThread.value).toBe('sector')
    enabled = false
    expect(m.isPassthrough.value).toBe(true)
  })

  it('round-trips its cursor through snapshot/restore', () => {
    const m = useSectorMerge({ core: () => ({ rounds: core, complete: true }) })
    m.nextRound()
    const snap = m.snapshot()
    const m2 = useSectorMerge({ core: () => ({ rounds: core, complete: true }), initial: snap })
    const r = m2.nextRound()
    expect(r.status === 'round' && r.round.roundNumber).toBe(2)
    m2.restore({ coreIndex: 0, servingSeedId: null, totalRounds: 0 })
    const again = m2.nextRound()
    expect(again.status === 'round' && again.round.roundNumber).toBe(1)
  })
})
