/**
 * shouldAutoEnterInfinitePlay — the auto-entry gate (2026-08-31).
 *
 * Auto-entry stamps the learner's cursor to the course's FINAL LEGO, so every
 * false positive is permanent, silent progress corruption. The gate exists so
 * that rule lives in ONE place with tests rather than inline in a 19k-line SFC.
 *
 * The case that put it here: a learner on a weak connection is served rounds
 * built from the cache, which by definition hold only material already covered.
 * Those rounds are review-only SHAPED — and on that shape alone the app used to
 * conclude the course was finished.
 */

import { describe, it, expect, vi } from 'vitest'
import { roundShapeSuggestsInfinitePlay, shouldAutoEnterInfinitePlay } from './infinitePlay'

const REVIEW_ONLY = { cycles: [{ type: 'use' }, { type: 'spaced_rep' }] }
const MAIN_LOOP = { cycles: [{ type: 'intro' }, { type: 'debut' }, { type: 'use' }] }

/** `legosBeyondCursor` empty = the course has nothing new left. */
function mockClient(legosBeyondCursor: Array<{ lego_id: string }>) {
  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: legosBeyondCursor, error: null }),
  } as any
}

const gate = (over: Partial<Parameters<typeof shouldAutoEnterInfinitePlay>[0]> = {}) =>
  shouldAutoEnterInfinitePlay({
    round: REVIEW_ONLY,
    contentFetchingDegraded: false,
    cursorLegoId: 'S0013L02',
    courseCode: 'deu_for_eng',
    supabaseClient: mockClient([]),
    ...over,
  })

describe('roundShapeSuggestsInfinitePlay', () => {
  it('is true for a round of nothing but review cycles', () => {
    expect(roundShapeSuggestsInfinitePlay(REVIEW_ONLY)).toBe(true)
  })

  it('is false as soon as one intro, debut or build cycle is present', () => {
    expect(roundShapeSuggestsInfinitePlay(MAIN_LOOP)).toBe(false)
    expect(roundShapeSuggestsInfinitePlay({ cycles: [{ type: 'use' }, { type: 'build' }] })).toBe(false)
  })

  it('is false for an empty or absent round rather than vacuously true', () => {
    expect(roundShapeSuggestsInfinitePlay({ cycles: [] })).toBe(false)
    expect(roundShapeSuggestsInfinitePlay(null)).toBe(false)
    expect(roundShapeSuggestsInfinitePlay(undefined)).toBe(false)
  })
})

describe('shouldAutoEnterInfinitePlay', () => {
  it('allows entry when the shape proposes it, the session is healthy, and no new LEGO remains', async () => {
    expect(await gate()).toBe(true)
  })

  it('REFUSES while content fetching is degraded, even with every other signal saying yes', async () => {
    // The Beuno case. A weak connection is why the round looks like this; it is
    // not evidence about the course. Must never stamp the cursor.
    expect(await gate({ contentFetchingDegraded: true })).toBe(false)
  })

  it('refuses on a degraded session without even asking the database', async () => {
    const client = mockClient([])
    await gate({ contentFetchingDegraded: true, supabaseClient: client })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('refuses when the course still has new LEGOs beyond the cursor', async () => {
    expect(await gate({ supabaseClient: mockClient([{ lego_id: 'S0400L01' }]) })).toBe(false)
  })

  it('refuses on a main-loop round regardless of everything else', async () => {
    expect(await gate({ round: MAIN_LOOP })).toBe(false)
  })

  it('fails closed — an unanswerable check keeps the learner in the main loop', async () => {
    const erroring = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'network' } }),
    } as any
    expect(await gate({ supabaseClient: erroring })).toBe(false)
    expect(await gate({ supabaseClient: null })).toBe(false)
  })
})
