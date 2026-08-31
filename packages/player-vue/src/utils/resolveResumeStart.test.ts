/**
 * resolveResumeStart — a FAILURE to resolve is not a fresh learner.
 *
 * Regression coverage for the silent round-1 drop: on a cache miss (new
 * device, reinstall, cleared storage, a course never opened here) plus a
 * failing pipe, the round-map fetch throws. That throw used to be caught
 * and turned into `null` — which already means "genuinely fresh learner"
 * to useInstantPlayback.bootstrap, so a learner 300 rounds in was started
 * at round 1 with no error anywhere. The throw must survive so the
 * cutover catch in LearningPlayer falls through to the legacy loader.
 */

import { describe, it, expect, vi } from 'vitest'
import { resolveResumeStart, ResumeResolutionError } from './resolveResumeStart'

const ROUNDS = ['S0001L01', 'S0001L02', 'S0002L01', 'S0002L02'].map(legoId => ({ legoId }))
const noInfPlay = async () => false

describe('resolveResumeStart', () => {
  it('returns the cursor when it resolves in the round-map', async () => {
    await expect(resolveResumeStart({
      lastCompletedLegoId: 'S0002L01',
      ceilingLegoId: null,
      hasReachedInfinitePlay: noInfPlay,
      fetchRoundMap: async () => ({ rounds: ROUNDS }),
    })).resolves.toBe('S0002L01')
  })

  it('falls back to the ceiling when the cursor is unresolvable', async () => {
    const onCeilingFallback = vi.fn()
    await expect(resolveResumeStart({
      lastCompletedLegoId: 'S9999L01',
      ceilingLegoId: 'S0002L02',
      hasReachedInfinitePlay: noInfPlay,
      fetchRoundMap: async () => ({ rounds: ROUNDS }),
      onCeilingFallback,
    })).resolves.toBe('S0002L02')
    expect(onCeilingFallback).toHaveBeenCalled()
  })

  it('returns null ONLY when the learner genuinely has no resolvable position', async () => {
    await expect(resolveResumeStart({
      lastCompletedLegoId: null,
      ceilingLegoId: null,
      hasReachedInfinitePlay: noInfPlay,
      fetchRoundMap: async () => ({ rounds: ROUNDS }),
    })).resolves.toBeNull()
  })

  // THE regression: a round-map fetch failure must NOT resolve as
  // "fresh learner, start at round 1".
  it('throws when the round-map fetch fails — never null', async () => {
    const result = resolveResumeStart({
      lastCompletedLegoId: 'S0002L01',
      ceilingLegoId: 'S0002L02',
      hasReachedInfinitePlay: noInfPlay,
      fetchRoundMap: async () => { throw new Error('round-map fetch failed (offline)') },
    })
    await expect(result).rejects.toBeInstanceOf(ResumeResolutionError)
    await expect(result).rejects.toThrow(/round-map fetch failed/)
  })

  it('throws when the infinite-play check fails — never null', async () => {
    await expect(resolveResumeStart({
      lastCompletedLegoId: 'S0002L01',
      ceilingLegoId: null,
      hasReachedInfinitePlay: async () => { throw new Error('supabase down') },
      fetchRoundMap: async () => ({ rounds: ROUNDS }),
    })).rejects.toBeInstanceOf(ResumeResolutionError)
  })

  it('propagates CourseEndNoNextLego untouched so INF PLAY hands off to the legacy path', async () => {
    await expect(resolveResumeStart({
      lastCompletedLegoId: 'S0002L02',
      ceilingLegoId: null,
      hasReachedInfinitePlay: async () => true,
      fetchRoundMap: async () => ({ rounds: ROUNDS }),
    })).rejects.toThrow('CourseEndNoNextLego')
  })
})
