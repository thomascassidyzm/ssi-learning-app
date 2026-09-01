import { describe, it, expect } from 'vitest'
import type { Round } from './SimplePlayer'
import {
  SectorMergeCursor,
  mergePreview,
  hasReachedAnchor,
  type MergeInputs,
  type ThreadView,
} from './sectorMerge'

/**
 * Lap cadence stub — activation 6, interval 5, the same rule
 * usePodLapScheduler.shouldFireLapAt applies to the main-round counter
 * ((round - activation) % interval === 0, round >= activation). The module
 * itself never does this arithmetic: the app injects the scheduler's own
 * function. This stub exists only so the tests can assert WHICH total rounds
 * carry a due lap.
 */
const ACTIVATION = 6
const INTERVAL = 5
const lapAt = (totalRound: number): boolean =>
  totalRound >= ACTIVATION && (totalRound - ACTIVATION) % INTERVAL === 0

/** Build a thread's rounds from per-seed round counts. */
function buildThread(prefix: string, seedRoundCounts: number[]): Round[] {
  const rounds: Round[] = []
  let n = 1
  seedRoundCounts.forEach((count, seedIdx) => {
    const seedNo = seedIdx + 1
    const seedId = `S${String(seedNo).padStart(4, '0')}`
    for (let i = 0; i < count; i++) {
      rounds.push({
        roundNumber: n++,
        legoId: `${seedId}L${String(i + 1).padStart(2, '0')}`,
        seedId: `${prefix}${seedId}`,
        cycles: [],
      })
    }
  })
  return rounds
}

const view = (rounds: readonly Round[], complete = true): ThreadView => ({ rounds, complete })

const CORE_SHAPE = [5, 2, 3, 3, 4, 2, 3, 2, 2, 4]
const SECTOR_SHAPE = [4, 3, 1, 3, 1, 2, 2, 1, 2, 2]

describe('sectorMerge — passthrough guarantee (the no-strand case)', () => {
  const core = buildThread('C', CORE_SHAPE)

  const passthroughInputs: MergeInputs[] = [
    { core: view(core), sector: null, sectorEnabled: false },
    { core: view(core), sector: null, sectorEnabled: true },
    { core: view(core), sector: view(buildThread('X', SECTOR_SHAPE)), sectorEnabled: false },
  ]

  it.each(passthroughInputs.map((inputs, i) => [i, inputs]))(
    'case %i orders exactly like the core thread alone',
    (_i, inputs) => {
      const cursor = new SectorMergeCursor({ shouldFireLapAt: lapAt })
      const served: Round[] = []
      for (;;) {
        const r = cursor.next(inputs as MergeInputs)
        if (r.status !== 'round') break
        expect(r.thread).toBe('core')
        served.push(r.round)
      }
      expect(served).toEqual(core)
    },
  )

  it('does not touch the sector cursor while the gate is closed', () => {
    const cursor = new SectorMergeCursor({ shouldFireLapAt: lapAt })
    const inputs: MergeInputs = {
      core: view(core),
      sector: view(buildThread('X', SECTOR_SHAPE)),
      sectorEnabled: false,
    }
    while (cursor.next(inputs).status === 'round') { /* drain */ }
    expect(cursor.state.sectorIndex).toBe(0)
  })
})

describe('sectorMerge — the design\'s worked interleave', () => {
  const core = buildThread('C', CORE_SHAPE)
  const sector = buildThread('X', SECTOR_SHAPE)
  const entries = mergePreview(core, sector, 60, { shouldFireLapAt: lapAt })

  it('plays core seed 1 (5 rounds), then sector seed 1 (4), then core seed 2 (2)…', () => {
    const shape = entries
      .slice(0, 17)
      .map((e) => `${e.thread}:${e.round.seedId}`)
    expect(shape).toEqual([
      ...Array(5).fill('core:CS0001'),
      ...Array(4).fill('sector:XS0001'),
      ...Array(2).fill('core:CS0002'),
      ...Array(3).fill('sector:XS0002'),
      ...Array(3).fill('core:CS0003'),
    ])
    expect(entries.slice(0, 17).map((e) => e.totalRound)).toEqual(
      Array.from({ length: 17 }, (_, i) => i + 1),
    )
  })

  it('never renumbers or drops a round — each thread keeps its own sequence', () => {
    const coreServed = entries.filter((e) => e.thread === 'core').map((e) => e.round.roundNumber)
    const sectorServed = entries.filter((e) => e.thread === 'sector').map((e) => e.round.roundNumber)
    expect(coreServed).toEqual(coreServed.map((_, i) => i + 1))
    expect(sectorServed).toEqual(sectorServed.map((_, i) => i + 1))
  })

  it('fires laps off the ONE total-rounds counter at 6, 11, 16, 21, 26, 31, 36, 41, 46, 51', () => {
    const due = entries.filter((e) => e.lapDue).map((e) => e.totalRound)
    expect(due.slice(0, 10)).toEqual([6, 11, 16, 21, 26, 31, 36, 41, 46, 51])
  })

  it('draws a due lap against the pod stream of the thread whose seed is in play', () => {
    const byTotal = new Map(entries.map((e) => [e.totalRound, e]))
    // total 6 is the first sector round; 11 is core seed 2's second round.
    expect(byTotal.get(6)!.lapStream).toBe('sector')
    expect(byTotal.get(11)!.lapStream).toBe('core')
    for (const e of entries) expect(e.lapStream).toBe(e.thread)
  })

  it('a lap landing mid-seed does not move a thread boundary', () => {
    // Total 16 falls inside core seed 3 (totals 15-17); the stint is unbroken.
    const mid = entries.slice(14, 17)
    expect(mid.map((e) => e.lapDue)).toEqual([false, true, false])
    expect(new Set(mid.map((e) => `${e.thread}:${e.round.seedId}`))).toEqual(
      new Set(['core:CS0003']),
    )
  })
})

describe('sectorMerge — swapping happens only at seed boundaries', () => {
  it('holds a thread for every round of its seed, however asymmetric', () => {
    const entries = mergePreview(
      buildThread('C', [5, 2, 3]),
      buildThread('X', [1, 1, 1]),
      30,
      { shouldFireLapAt: lapAt },
    )
    const stints: string[] = []
    for (const e of entries) {
      const key = `${e.thread}:${e.round.seedId}`
      if (stints[stints.length - 1] !== key) stints.push(key)
    }
    expect(stints).toEqual([
      'core:CS0001',
      'sector:XS0001',
      'core:CS0002',
      'sector:XS0002',
      'core:CS0003',
      'sector:XS0003',
    ])
    // every stint contains the whole seed, nothing split
    expect(entries.filter((e) => e.round.seedId === 'CS0001')).toHaveLength(5)
    expect(entries.filter((e) => e.round.seedId === 'CS0002')).toHaveLength(2)
  })
})

describe('sectorMerge — exhaustion', () => {
  it('sector exhausted → core alone, in core order', () => {
    const core = buildThread('C', [2, 2, 2])
    const sector = buildThread('X', [1])
    const entries = mergePreview(core, sector, 20, { shouldFireLapAt: lapAt })
    expect(entries.map((e) => `${e.thread}:${e.round.seedId}`)).toEqual([
      'core:CS0001', 'core:CS0001',
      'sector:XS0001',
      'core:CS0002', 'core:CS0002',
      'core:CS0003', 'core:CS0003',
    ])
  })

  it('core exhausted → sector alone', () => {
    const core = buildThread('C', [1])
    const sector = buildThread('X', [2, 2])
    const entries = mergePreview(core, sector, 20, { shouldFireLapAt: lapAt })
    expect(entries.map((e) => `${e.thread}:${e.round.seedId}`)).toEqual([
      'core:CS0001',
      'sector:XS0001', 'sector:XS0001',
      'sector:XS0002', 'sector:XS0002',
    ])
  })

  it('both exhausted → exhausted', () => {
    const cursor = new SectorMergeCursor({ shouldFireLapAt: lapAt })
    const inputs: MergeInputs = {
      core: view([]),
      sector: view([]),
      sectorEnabled: true,
    }
    expect(cursor.next(inputs).status).toBe('exhausted')
  })
})

describe('sectorMerge — the lazy case', () => {
  const core = buildThread('C', [2, 2])
  const sector = buildThread('X', [2, 2])

  it('waits mid-seed rather than treating a short load as a seed boundary', () => {
    const cursor = new SectorMergeCursor({ shouldFireLapAt: lapAt })
    // Only the first core round has loaded, and more is coming.
    const partial: MergeInputs = {
      core: { rounds: core.slice(0, 1), complete: false },
      sector: view(sector),
      sectorEnabled: true,
    }
    expect(cursor.next(partial).status).toBe('round')
    expect(cursor.next(partial)).toEqual({ status: 'waiting', waitingOn: 'core' })
    expect(cursor.state.sectorIndex).toBe(0) // did NOT swap early
  })

  it('waits for the thread it owes the next stint to, rather than running on', () => {
    const cursor = new SectorMergeCursor({ shouldFireLapAt: lapAt })
    const noSectorYet: MergeInputs = {
      core: view(core),
      sector: { rounds: [], complete: false },
      sectorEnabled: true,
    }
    expect(cursor.next(noSectorYet).status).toBe('round')
    expect(cursor.next(noSectorYet).status).toBe('round') // core seed 1 done
    expect(cursor.next(noSectorYet)).toEqual({ status: 'waiting', waitingOn: 'sector' })
    expect(cursor.state.coreIndex).toBe(2) // core seed 2 not started

    // …and resumes correctly once the sector rounds land.
    const loaded: MergeInputs = { core: view(core), sector: view(sector), sectorEnabled: true }
    const next = cursor.next(loaded)
    expect(next.status === 'round' && next.thread).toBe('sector')
  })
})

describe('sectorMerge — toggling off mid-session', () => {
  it('collapses to core alone and freezes the sector cursor where it was', () => {
    const core = buildThread('C', [2, 2, 2])
    const sector = buildThread('X', [3, 3])
    const cursor = new SectorMergeCursor({ shouldFireLapAt: lapAt })
    const on: MergeInputs = { core: view(core), sector: view(sector), sectorEnabled: true }
    cursor.next(on); cursor.next(on)          // core seed 1
    cursor.next(on); cursor.next(on)          // 2 of sector seed 1's 3 rounds
    expect(cursor.state.sectorIndex).toBe(2)

    const off: MergeInputs = { ...on, sectorEnabled: false }
    const a = cursor.next(off)
    const b = cursor.next(off)
    expect([a, b].map((e) => (e.status === 'round' ? e.round.seedId : e.status))).toEqual([
      'CS0002', 'CS0002',
    ])
    expect(cursor.state.sectorIndex).toBe(2) // frozen

    // Back on: the sector thread resumes exactly where it parked.
    const c = cursor.next(on)
    expect(c.status === 'round' && c.round.roundNumber).toBe(3)
    expect(c.status === 'round' && c.thread).toBe('sector')
  })
})

describe('sectorMerge — the entry gate helper', () => {
  it('opens only once the core ceiling reaches the anchor lego', () => {
    expect(hasReachedAnchor('S0041L03', 'S0042L01')).toBe(false)
    expect(hasReachedAnchor('S0042L01', 'S0042L01')).toBe(true)
    expect(hasReachedAnchor('S0042L02', 'S0042L01')).toBe(true)
    expect(hasReachedAnchor('S0100L01', 'S0042L05')).toBe(true)
    expect(hasReachedAnchor('S0042L01', 'S0042L05')).toBe(false)
  })

  it('is closed — the safe answer — on missing or unparseable ids', () => {
    expect(hasReachedAnchor(null, 'S0042L01')).toBe(false)
    expect(hasReachedAnchor('S0042L01', undefined)).toBe(false)
    expect(hasReachedAnchor('nonsense', 'S0042L01')).toBe(false)
  })
})
