/**
 * hasReachedInfinitePlay — cursor-only model (2026-07-04).
 *
 * Infinite-play is derived from the cursor's position among the course's
 * is_new LEGOs, never from a separate ratcheted ceiling column or a stored
 * current_mode flag. These tests exercise the predicate directly against a
 * mocked Supabase client.
 */

import { describe, it, expect, vi } from 'vitest'
import { hasReachedInfinitePlay } from './infinitePlay'

function mockClient(legosBeyondCursor: Array<{ lego_id: string }>) {
  return {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: legosBeyondCursor, error: null }),
  } as any
}

describe('hasReachedInfinitePlay', () => {
  it('returns false when a null cursor is passed (fresh learner)', async () => {
    const client = mockClient([])
    expect(await hasReachedInfinitePlay(null, 'spa_for_eng', client)).toBe(false)
    expect(client.from).not.toHaveBeenCalled()
  })

  it('returns false when no course code or client is available', async () => {
    expect(await hasReachedInfinitePlay('S0045L03', '', mockClient([]))).toBe(false)
    expect(await hasReachedInfinitePlay('S0045L03', 'spa_for_eng', null)).toBe(false)
    expect(await hasReachedInfinitePlay('S0045L03', 'spa_for_eng', undefined)).toBe(false)
  })

  it('returns true when no is_new LEGO remains beyond the cursor', async () => {
    const client = mockClient([])
    expect(await hasReachedInfinitePlay('S0668L01', 'spa_for_eng', client)).toBe(true)
    expect(client.eq).toHaveBeenCalledWith('is_new', true)
    expect(client.gt).toHaveBeenCalledWith('lego_id', 'S0668L01')
  })

  it('returns false when an is_new LEGO remains beyond the cursor', async () => {
    const client = mockClient([{ lego_id: 'S0100L01' }])
    expect(await hasReachedInfinitePlay('S0045L03', 'spa_for_eng', client)).toBe(false)
  })

  it('agrees with a cursor moved BACK out of infinite-play (belt-back)', async () => {
    // A learner who was at the course end and belt-skips back to an
    // earlier seed is no longer past every is_new LEGO — the predicate
    // must flip back to false. This is the cursor-only guarantee: no
    // separate ratcheted flag can leave this stale.
    const client = mockClient([{ lego_id: 'S0300L01' }])
    expect(await hasReachedInfinitePlay('S0045L03', 'spa_for_eng', client)).toBe(false)
  })

  it('returns false and warns on a query error, rather than throwing', async () => {
    const client = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
    } as any
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await hasReachedInfinitePlay('S0045L03', 'spa_for_eng', client)).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
