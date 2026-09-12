/**
 * cachedScriptCoversLearner — a truncated script cache must not be hydrated
 * for a learner whose place lies beyond it.
 *
 * The specimen is production cym_s_for_eng on build 5ea385e (job #326): the
 * free-preview bundle is 33 rounds, S0001L01..S0019L01. A learner with the
 * cursor at S0020L01 (Orange) was resolved against those 33 rounds by the
 * cache fast-path, found nowhere, and started at White belt round 1.
 */
import { describe, it, expect } from 'vitest'
import { cachedScriptCoversLearner } from './cachedScriptCoversLearner'

// The preview slice as production serves it: two LEGOs a seed through S0016,
// then one — 33 rounds ending on S0019L01. Shape is what matters, not the count.
const PREVIEW_ROUNDS = [
  ...Array.from({ length: 16 }, (_, i) => i + 1).flatMap((s) => [
    { legoId: `S${String(s).padStart(4, '0')}L01` },
    { legoId: `S${String(s).padStart(4, '0')}L02` },
  ]),
  { legoId: 'S0019L01' },
]

describe('cachedScriptCoversLearner', () => {
  // THE regression: a cursor past the end of a preview-sliced cache.
  it('is false when the cursor lies beyond a preview-sliced cache (the White-belt reset)', () => {
    expect(cachedScriptCoversLearner(PREVIEW_ROUNDS, 'S0020L01', null)).toBe(false)
    expect(cachedScriptCoversLearner(PREVIEW_ROUNDS, 'S0215L01', 'S0215L01')).toBe(false)
  })

  it('is true when the cursor is inside the cache', () => {
    expect(cachedScriptCoversLearner(PREVIEW_ROUNDS, 'S0008L01', null)).toBe(true)
    expect(cachedScriptCoversLearner(PREVIEW_ROUNDS, 'S0019L01', null)).toBe(true)
  })

  it('is true for a fresh learner with no server position — round 1 is correct for them', () => {
    expect(cachedScriptCoversLearner(PREVIEW_ROUNDS, null, null)).toBe(true)
  })

  it('accepts the cursor\'s seed when the exact LEGO is gone (seed fallback)', () => {
    // S0010L03 no longer exists; S0010L01 does, so the learner still has a place.
    expect(cachedScriptCoversLearner(PREVIEW_ROUNDS, 'S0010L03', null)).toBe(true)
  })

  it('accepts the ceiling when the cursor is unresolvable but the ceiling is cached', () => {
    expect(cachedScriptCoversLearner(PREVIEW_ROUNDS, 'S9999L01', 'S0012L01')).toBe(true)
  })

  it('is false when neither cursor nor ceiling is cached', () => {
    expect(cachedScriptCoversLearner(PREVIEW_ROUNDS, 'S0040L01', 'S0045L02')).toBe(false)
  })
})
