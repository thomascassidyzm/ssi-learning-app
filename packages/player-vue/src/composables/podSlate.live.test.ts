/**
 * The client rule, run against a REAL pod that carries continuations.
 *
 * The fixture is the exact row set of `deu_at_for_eng:pod-1` as read from the
 * live database on 2026-09-04, after the six CORE recovery halves were attached
 * to it: 231 base rows and 35 continuations. That course's pod is `held`, not
 * `live`, which is why it was chosen as the probe — no learner can reach it.
 *
 * What this pins is the thing the whole job is judged on: a learner who never
 * branches walks exactly the 231 sentences they walked before, in exactly that
 * order, and the six recoveries are reachable at the coordinates they attach to
 * rather than appended anywhere.
 */
import { describe, it, expect } from 'vitest'
import rows from './__fixtures__/deu_at_for_eng-pod-1-rows.json'
import { baseSlate, continuations, continuationsByBranch, branchKey } from './podSlate'

describe('podSlate against the live deu_at_for_eng:pod-1 rows', () => {
  it('has the shape the promotion wrote: 231 base rows, 35 continuations', () => {
    expect(rows).toHaveLength(266)
    expect(baseSlate(rows)).toHaveLength(231)
    expect(continuations(rows)).toHaveLength(35)
  })

  it('serves a walk of exactly global_order 1..231, no gaps and nothing above', () => {
    const walk = baseSlate(rows)
    expect(walk.map((r) => r.global_order)).toEqual(
      Array.from({ length: 231 }, (_, i) => i + 1),
    )
  })

  it('keeps every continuation out of the walk', () => {
    expect(baseSlate(rows).every((r) => r.variant_key === null)).toBe(true)
  })

  it('makes all six recoveries reachable at their own branch points', () => {
    const byBranch = continuationsByBranch(rows)
    const found = [...byBranch.entries()]
      .flatMap(([key, flows]) => flows.map((f) => [f.variantKey, key, f.rows.length] as const))
      .sort()
    expect(found).toEqual([
      ['recovery-m1', branchKey(3, 5), 6],   // "Do you have crisps, or nuts, or anything?"
      ['recovery-m2', branchKey(22, 1), 5],  // "…I haven't been learning for very long…"
      ['recovery-m3', branchKey(5, 1), 7],   // "Did you have a long day?"
      ['recovery-m4', branchKey(22, 8), 5],  // the disagreement, parked
      ['recovery-m5', branchKey(4, 3), 6],   // the counterbid, unanswered
      ['recovery-s2', branchKey(2, 5), 6],   // "Maybe three or four miles."
    ])
  })

  it('puts the two scene-22 flows at the coordinates they each attach to, not together', () => {
    const byBranch = continuationsByBranch(rows)
    expect(byBranch.get(branchKey(22, 1))!.map((f) => f.variantKey)).toEqual(['recovery-m2'])
    expect(byBranch.get(branchKey(22, 8))!.map((f) => f.variantKey)).toEqual(['recovery-m4'])
  })
})
