/**
 * beltRewindTarget — the 60-day rewind lands on the FIRST round of the
 * learner's own belt, never before it (Tom, 2026-09-12).
 */
import { describe, it, expect } from 'vitest'
import { beltRewindTarget } from './beltRewindTarget'

const BELTS = [
  { name: 'white', seedsRequired: 0 },
  { name: 'yellow', seedsRequired: 8 },
  { name: 'orange', seedsRequired: 20 },
]
// Two LEGOs a seed through seed 25: S0007L02 is index 13, S0008L01 index 14,
// S0020L01 index 38.
const ROUNDS = Array.from({ length: 25 }, (_, i) => i + 1).flatMap((s) => [
  { legoId: `S${String(s).padStart(4, '0')}L01` },
  { legoId: `S${String(s).padStart(4, '0')}L02` },
])

describe('beltRewindTarget', () => {
  // THE ruling: a Yellow learner lands on Yellow's first round, not White's last.
  it('a learner past Yellow rewinds to the START of Yellow, never into White', () => {
    expect(beltRewindTarget('S0012L01', ROUNDS, BELTS)).toEqual({ roundIndex: 14, legoId: 'S0008L01', beltName: 'yellow' })
  })

  it('an Orange learner rewinds to the first round of Orange', () => {
    expect(beltRewindTarget('S0025L02', ROUNDS, BELTS)).toEqual({ roundIndex: 38, legoId: 'S0020L01', beltName: 'orange' })
  })

  it('a White learner rewinds to round 1 — the start of the belt they hold', () => {
    expect(beltRewindTarget('S0005L01', ROUNDS, BELTS)).toEqual({ roundIndex: 0, legoId: 'S0001L01', beltName: 'white' })
  })

  it('nothing to do when the learner is already on their belt\'s first round', () => {
    expect(beltRewindTarget('S0008L01', ROUNDS, BELTS)).toBeNull()
    expect(beltRewindTarget('S0001L01', ROUNDS, BELTS)).toBeNull()
  })

  it('takes the nearest round at or above the threshold when the threshold seed has no round', () => {
    const gappy = ROUNDS.filter((r) => !r.legoId.startsWith('S0008'))
    expect(beltRewindTarget('S0012L01', gappy, BELTS)?.legoId).toBe('S0009L01')
  })

  it('null for an unparsable cursor or rounds without the belt', () => {
    expect(beltRewindTarget(null, ROUNDS, BELTS)).toBeNull()
    expect(beltRewindTarget('S0012L01', ROUNDS.slice(0, 4), BELTS)).toBeNull()
  })
})
