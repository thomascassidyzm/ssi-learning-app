import { describe, it, expect } from 'vitest'
import { baseSlate, continuations, continuationsByBranch, branchKey, isBaseRow } from './podSlate'

/** A CORE-shaped walk: scene 2, five sentences. */
const walk = [
  { scene_number: 2, sentence_number: 1, global_order: 5, variant_key: null },
  { scene_number: 2, sentence_number: 2, global_order: 6, variant_key: null },
  { scene_number: 2, sentence_number: 3, global_order: 7, variant_key: null },
  { scene_number: 2, sentence_number: 4, global_order: 8, variant_key: null },
  { scene_number: 2, sentence_number: 5, global_order: 9, variant_key: null },
]

/** The recovery-s2 flow: six rows, attached at scene 2 sentence 5. */
const recoveryS2 = [1, 2, 3, 4, 5, 6].map((n) => ({
  scene_number: 2,
  sentence_number: n,
  global_order: 10000 + n,
  variant_key: 'recovery-s2',
  attach_sentence_number: 5,
}))

describe('podSlate', () => {
  it('leaves a pod with no continuations exactly as it was', () => {
    expect(baseSlate(walk)).toEqual(walk)
    expect(continuations(walk)).toEqual([])
    expect(continuationsByBranch(walk).size).toBe(0)
  })

  it('does not lengthen the walk when continuations are attached', () => {
    const stored = [...walk, ...recoveryS2]
    expect(baseSlate(stored)).toEqual(walk)
    expect(baseSlate(stored)).toHaveLength(walk.length)
  })

  it('preserves order rather than sorting', () => {
    const shuffled = [recoveryS2[0], walk[3], walk[0], recoveryS2[1], walk[1]]
    expect(baseSlate(shuffled)).toEqual([walk[3], walk[0], walk[1]])
  })

  it('serves every row of an all-variant pod, so a flow book is unchanged', () => {
    expect(baseSlate(recoveryS2)).toEqual(recoveryS2)
    expect(continuations(recoveryS2)).toEqual([])
  })

  it('indexes a continuation by the branch point it attaches to', () => {
    const byBranch = continuationsByBranch([...walk, ...recoveryS2])
    const at = byBranch.get(branchKey(2, 5))
    expect(at).toHaveLength(1)
    expect(at![0].variantKey).toBe('recovery-s2')
    expect(at![0].rows).toHaveLength(6)
    expect(at![0].rows.map((r) => r.sentence_number)).toEqual([1, 2, 3, 4, 5, 6])
    // Not attached anywhere else — a recovery three scenes later is worth nothing.
    expect(byBranch.get(branchKey(2, 1))).toBeUndefined()
    expect(byBranch.get(branchKey(3, 5))).toBeUndefined()
  })

  it('holds two flows at one branch point, as CORE scene 22 does', () => {
    const m2 = { scene_number: 22, sentence_number: 1, variant_key: 'recovery-m2', attach_sentence_number: 8 }
    const m4 = { scene_number: 22, sentence_number: 1, variant_key: 'recovery-m4', attach_sentence_number: 8 }
    const base = [{ scene_number: 22, sentence_number: 8, variant_key: null }]
    const at = continuationsByBranch([...base, m4, m2]).get(branchKey(22, 8))
    expect(at!.map((f) => f.variantKey)).toEqual(['recovery-m2', 'recovery-m4'])
  })

  it('drops a continuation with no attach point rather than guessing one', () => {
    const orphan = { scene_number: 2, sentence_number: 1, variant_key: 'orphan', attach_sentence_number: null }
    const byBranch = continuationsByBranch([...walk, orphan])
    expect(byBranch.size).toBe(0)
    // It is still excluded from the walk — an unplaceable flow is not a line of CORE.
    expect(baseSlate([...walk, orphan])).toEqual(walk)
    expect(isBaseRow(orphan)).toBe(false)
  })
})
