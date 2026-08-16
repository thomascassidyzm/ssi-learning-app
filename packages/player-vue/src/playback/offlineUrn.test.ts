/**
 * offlineUrn — the weighted urn behind offline INFINITE PLAY.
 *
 * Tom's approved algorithm, 2026-08-15: measure the cache, then draw phrases
 * from a weighted urn WITHOUT replacement — tickets = 1 + length_bonus +
 * recency_bonus, capped at ~4x; full coverage each pass, weights controlling
 * frequency within a pass; length bonus by clip duration; recency bonus by
 * position in the course, not clock time; floor of one ticket each so the
 * early short phrases — the skeleton inside the long ones — keep resurfacing.
 *
 * These tests pin the properties that make it spaced repetition rather than
 * shuffle: coverage, the floor, and the weighting.
 */
import { describe, it, expect } from 'vitest'
import {
  assignTickets,
  buildPass,
  createOfflineUrn,
  URN_LENGTH_BONUS_TICKETS,
  URN_RECENCY_BONUS_TICKETS,
  URN_MAX_TICKETS,
  type UrnCandidate,
} from './offlineUrn'

/** Deterministic RNG so a failure is a real failure, never a bad roll. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** 12 phrases: durations rise with index, position rises with index. */
function syllabus(n = 12): UrnCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `p${i}`,
    durationMs: (i + 1) * 500,
    position: i + 1,
  }))
}

describe('offlineUrn — tickets', () => {
  it('gives every cached phrase a floor of one ticket — the skeleton guarantee', () => {
    const tickets = assignTickets(syllabus())
    expect(tickets.size).toBe(12)
    for (const [, n] of tickets) expect(n).toBeGreaterThanOrEqual(1)
  })

  it('the shortest, earliest phrase gets exactly the floor — no bonuses', () => {
    const tickets = assignTickets(syllabus())
    expect(tickets.get('p0')).toBe(1)
  })

  it('the longest, newest phrase gets both bonuses', () => {
    const tickets = assignTickets(syllabus())
    expect(tickets.get('p11')).toBe(1 + URN_LENGTH_BONUS_TICKETS + URN_RECENCY_BONUS_TICKETS)
  })

  it('never exceeds the ~4x cap, even with the knobs turned up', () => {
    const tickets = assignTickets(syllabus(), { lengthBonus: 10, recencyBonus: 10 })
    for (const [, n] of tickets) expect(n).toBeLessThanOrEqual(URN_MAX_TICKETS)
  })

  it('length and recency are independent — a long OLD phrase gets only the length bonus', () => {
    // Duration descends as position ascends, so the top third by length is the
    // BOTTOM third by position. Nothing should collect both.
    const candidates: UrnCandidate[] = Array.from({ length: 9 }, (_, i) => ({
      key: `p${i}`,
      durationMs: (9 - i) * 1000,
      position: i + 1,
    }))
    const tickets = assignTickets(candidates)
    expect(tickets.get('p0')).toBe(1 + URN_LENGTH_BONUS_TICKETS) // longest, oldest
    expect(tickets.get('p8')).toBe(1 + URN_RECENCY_BONUS_TICKETS) // shortest, newest
  })

  it('recency is course position, not clock time — identical durations, position alone decides', () => {
    const candidates: UrnCandidate[] = Array.from({ length: 9 }, (_, i) => ({
      key: `p${i}`,
      durationMs: 1000,
      position: i + 1,
    }))
    const tickets = assignTickets(candidates)
    expect(tickets.get('p8')).toBeGreaterThan(tickets.get('p0')!)
  })

  it('a phrase appearing in several rounds is still one phrase, with one allocation', () => {
    const dup = [...syllabus(3), ...syllabus(3)]
    expect(assignTickets(dup).size).toBe(3)
  })
})

describe('offlineUrn — sampling without replacement', () => {
  it('one pass covers the ENTIRE measured syllabus — nothing can go missing', () => {
    const candidates = syllabus()
    const pass = buildPass(candidates, { rng: seededRng(7) })
    expect(new Set(pass)).toEqual(new Set(candidates.map((c) => c.key)))
  })

  it('pass length is the ticket total — weights control frequency WITHIN a pass', () => {
    const candidates = syllabus()
    const tickets = assignTickets(candidates)
    const total = [...tickets.values()].reduce((a, b) => a + b, 0)
    expect(buildPass(candidates, { rng: seededRng(3) })).toHaveLength(total)
  })

  it('a 4-ticket phrase appears exactly four times in a pass; a 1-ticket phrase exactly once', () => {
    const pass = buildPass(syllabus(), { rng: seededRng(11) })
    const count = (k: string) => pass.filter((x) => x === k).length
    expect(count('p11')).toBe(4)
    expect(count('p0')).toBe(1)
  })

  it('does not repeat a phrase back-to-back within a pass', () => {
    const pass = buildPass(syllabus(), { rng: seededRng(99) })
    for (let i = 1; i < pass.length; i++) expect(pass[i]).not.toBe(pass[i - 1])
  })

  it('refills across the pass boundary without repeating what the last pass closed on', () => {
    const urn = createOfflineUrn(syllabus(), { rng: seededRng(5) })
    const tickets = urn.tickets()
    const total = [...tickets.values()].reduce((a, b) => a + b, 0)
    // Two full passes plus a bit, so the boundary is crossed.
    const drawn = urn.take(total * 2 + 3)
    expect(drawn).toHaveLength(total * 2 + 3)
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).not.toBe(drawn[i - 1])
  })

  it('over several passes every phrase keeps coming back — spaced repetition without a learner model', () => {
    const urn = createOfflineUrn(syllabus(), { rng: seededRng(23) })
    const total = [...urn.tickets().values()].reduce((a, b) => a + b, 0)
    const drawn = urn.take(total * 3)
    for (const c of syllabus()) {
      expect(drawn.filter((k) => k === c.key).length).toBe(urn.tickets().get(c.key)! * 3)
    }
  })

  it('an empty measured cache draws nothing — the one honest failure', () => {
    const urn = createOfflineUrn([])
    expect(urn.next()).toBeNull()
    expect(urn.take(10)).toEqual([])
  })

  it('a single cached phrase still plays rather than stalling', () => {
    // Spacing is impossible with a pool of one. Never stalling wins.
    const urn = createOfflineUrn([{ key: 'only', durationMs: 900, position: 1 }])
    expect(urn.take(5)).toEqual(['only', 'only', 'only', 'only', 'only'])
  })
})

describe('offlineUrn — properties that must hold whatever the roll', () => {
  it('never repeats back-to-back: 800 seeds x syllabus 2..40 x 3 passes', () => {
    // Not a formality. Two earlier implementations passed a single seed and
    // failed here: a shuffle-then-repair ordering starved at the tail of each
    // pass, and the ticket cap let a thin cache demand an arrangement that
    // does not exist. Both were structural, so only a sweep exposed them.
    for (let seed = 1; seed <= 800; seed++) {
      const n = 2 + (seed % 39)
      const candidates: UrnCandidate[] = Array.from({ length: n }, (_, i) => ({
        key: `p${i}`,
        durationMs: (i + 1) * 500,
        position: i + 1,
      }))
      const urn = createOfflineUrn(candidates, { rng: seededRng(seed) })
      const total = [...assignTickets(candidates).values()].reduce((a, b) => a + b, 0)
      const drawn = urn.take(total * 3)
      expect(drawn).toHaveLength(total * 3)
      for (let i = 1; i < drawn.length; i++) {
        if (drawn[i] === drawn[i - 1]) {
          throw new Error(`seed ${seed}, syllabus ${n}: back-to-back ${drawn[i]} at ${i}`)
        }
      }
    }
  })

  it('damps its own cap on a thin cache, where a heavy weighting cannot be spaced', () => {
    // Three phrases, one on 4 tickets, needs 7 slots in a 6-slot pass — an
    // impossible arrangement, so the cap drops to `distinct - 1`.
    const thin: UrnCandidate[] = [
      { key: 'a', durationMs: 100, position: 1 },
      { key: 'b', durationMs: 200, position: 2 },
      { key: 'c', durationMs: 9000, position: 3 },
    ]
    for (const [, n] of assignTickets(thin)) expect(n).toBeLessThanOrEqual(2)
  })

  it('stays fast enough to run mid-playback on a fully downloaded course', () => {
    // This is on the playback path: it runs when the queue drains. An O(n²)
    // selection cost ~470ms here, which is a freeze long enough to hear.
    const big: UrnCandidate[] = Array.from({ length: 2000 }, (_, i) => ({
      key: `p${i}`,
      durationMs: (i % 50) * 100,
      position: i,
    }))
    const started = Date.now()
    const drawn = createOfflineUrn(big).take(2000)
    const elapsed = Date.now() - started
    expect(drawn).toHaveLength(2000)
    expect(elapsed).toBeLessThan(150)
  })
})
