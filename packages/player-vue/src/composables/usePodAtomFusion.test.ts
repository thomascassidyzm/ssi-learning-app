import { describe, it, expect } from 'vitest'
import {
  buildAtomFusionPlan,
  computeFusionTiers,
  validateFusionInput,
  resolveFusionKnobs,
  DEFAULT_FUSION_KNOBS,
  type FusionAtom,
  type PlanStep,
} from './usePodAtomFusion'

// ============================================================================
// Fixtures — atom maps with total tiling (end[i] === start[i+1]), 500ms/atom
// ============================================================================

/** N fusible teachable atoms, contiguous 500ms slots. */
const teachableRow = (n: number): FusionAtom[] =>
  Array.from({ length: n }, (_, i) => ({
    lego_key: `k${i}`,
    kind: 'atom' as const,
    gloss: `gloss ${i}`,
    target_start_ms: i * 500,
    target_end_ms: (i + 1) * 500,
  }))

const KNOBS = { gapCurveMs: [400, 250, 120, 0] }

const stepsAt = (steps: PlanStep[], tier: string): PlanStep[] => steps.filter((s) => s.tier === tier)

const takeAt = (steps: PlanStep[], tier: string): PlanStep =>
  stepsAt(steps, tier).find((s) => s.play.source === 'target_clause' && s.screen.mergedGroups)!

// ============================================================================
// computeFusionTiers — the pairwise / leave-then-join law
// ============================================================================

describe('computeFusionTiers', () => {
  it('2 atoms collapse to a single tier, fully fused', () => {
    expect(computeFusionTiers([0, 1])).toEqual([[[0, 1]]])
  })

  it('3 atoms: leave the odd atom, then it joins the preceding pair as a three', () => {
    expect(computeFusionTiers([0, 1, 2])).toEqual([
      [[0, 1], [2]],
      [[0, 1, 2]],
    ])
  })

  it('4 atoms: two clean pairwise tiers', () => {
    expect(computeFusionTiers([0, 1, 2, 3])).toEqual([
      [[0, 1], [2, 3]],
      [[0, 1, 2, 3]],
    ])
  })

  it('5 atoms: odd atom stays un-fused at tier 1, joins the PRECEDING pair at tier 2', () => {
    expect(computeFusionTiers([0, 1, 2, 3, 4])).toEqual([
      [[0, 1], [2, 3], [4]],
      [[0, 1], [2, 3, 4]],
      [[0, 1, 2, 3, 4]],
    ])
  })

  it('6 atoms stretch over three tiers with correct pairwise grouping', () => {
    expect(computeFusionTiers([0, 1, 2, 3, 4, 5])).toEqual([
      [[0, 1], [2, 3], [4, 5]],
      [[0, 1, 2, 3], [4, 5]],
      [[0, 1, 2, 3, 4, 5]],
    ])
  })

  it('a single fusible atom yields zero fusion tiers', () => {
    expect(computeFusionTiers([0])).toEqual([])
  })

  it('works on non-contiguous atoms-array indices (notes interleaved in the map)', () => {
    // e.g. atoms array [atom, note, atom, atom] → fusible idxs [0, 2, 3]
    expect(computeFusionTiers([0, 2, 3])).toEqual([
      [[0, 2], [3]],
      [[0, 2, 3]],
    ])
  })
})

// ============================================================================
// Validation — gap curve + atom map integrity
// ============================================================================

describe('validateFusionInput', () => {
  const knobsWith = (gapCurveMs: number[]) => resolveFusionKnobs({ gapCurveMs })

  it('accepts a monotonically decreasing curve ending at 0', () => {
    expect(validateFusionInput(teachableRow(3), knobsWith([400, 250, 120, 0]))).toEqual([])
  })

  it('rejects a non-monotonic gap curve', () => {
    const problems = validateFusionInput(teachableRow(3), knobsWith([300, 400, 0]))
    expect(problems.some((p) => p.includes('monotonically decreasing'))).toBe(true)
  })

  it('rejects a gap curve that does not end at 0', () => {
    const problems = validateFusionInput(teachableRow(3), knobsWith([300, 100]))
    expect(problems.some((p) => p.includes('end at 0'))).toBe(true)
  })

  it('rejects an empty gap curve', () => {
    const problems = validateFusionInput(teachableRow(3), knobsWith([]))
    expect(problems.some((p) => p.includes('non-empty'))).toBe(true)
  })

  it('rejects fusible atoms without target offsets (R9 — not ladder-ready)', () => {
    const atoms: FusionAtom[] = [
      { lego_key: 'a', kind: 'atom', gloss: 'a', target_start_ms: 0, target_end_ms: 500 },
      { lego_key: 'b', kind: 'atom', gloss: 'b' }, // offsets missing
    ]
    const problems = validateFusionInput(atoms, resolveFusionKnobs())
    expect(problems.some((p) => p.includes('missing target_start_ms'))).toBe(true)
  })

  it('rejects notes without spans, and spans pointing at non-fusible entries', () => {
    const atoms: FusionAtom[] = [
      ...teachableRow(2),
      { lego_key: 'n1', kind: 'note', gloss: 'aside', explainer_start_ms: 0, explainer_end_ms: 900 },
      { lego_key: 'n2', kind: 'note', gloss: 'aside2', explainer_start_ms: 900, explainer_end_ms: 1500, spans: [2] },
    ]
    const problems = validateFusionInput(atoms, resolveFusionKnobs())
    expect(problems.some((p) => p.includes('missing spans'))).toBe(true)
    expect(problems.some((p) => p.includes('non-fusible'))).toBe(true)
  })
})

// ============================================================================
// buildAtomFusionPlan — the ladder
// ============================================================================

describe('buildAtomFusionPlan', () => {
  it('2-atom clause collapses: one fuse tier, straight to the untouched take', () => {
    const plan = buildAtomFusionPlan(teachableRow(2), KNOBS)
    expect(plan.fusionTierCount).toBe(1)
    const take = takeAt(plan.steps, 'fuse-1')
    expect(take.play.gapInsertsMs).toBeUndefined() // no remaining seams = the take
    expect(take.screen.mergedGroups).toEqual([[0, 1]])
    // Ladder shape: orientation → meet → fuse-1 → arrive
    expect(plan.steps[0].tier).toBe('orientation')
    expect(plan.steps[plan.steps.length - 2].play.source).toBe('target_clause')
    expect(plan.steps[plan.steps.length - 1].play.source).toBe('known_clause')
  })

  it('6-atom clause stretches: three tiers, gaps follow the curve, final tier untouched', () => {
    const plan = buildAtomFusionPlan(teachableRow(6), KNOBS)
    expect(plan.fusionTierCount).toBe(3)

    // Tier 1: [01][23][45] — two seams at 1000ms and 2000ms, gap = curve[0]
    const t1 = takeAt(plan.steps, 'fuse-1')
    expect(t1.screen.mergedGroups).toEqual([[0, 1], [2, 3], [4, 5]])
    expect(t1.play.gapInsertsMs).toEqual([
      { atMs: 1000, gapMs: 400 },
      { atMs: 2000, gapMs: 400 },
    ])

    // Tier 2: [0123][45] — one seam at 2000ms, gap = curve[1]
    const t2 = takeAt(plan.steps, 'fuse-2')
    expect(t2.screen.mergedGroups).toEqual([[0, 1, 2, 3], [4, 5]])
    expect(t2.play.gapInsertsMs).toEqual([{ atMs: 2000, gapMs: 250 }])

    // Tier 3 (final): one group, no seams — the untouched take
    const t3 = takeAt(plan.steps, 'fuse-3')
    expect(t3.screen.mergedGroups).toEqual([[0, 1, 2, 3, 4, 5]])
    expect(t3.play.gapInsertsMs).toBeUndefined()
  })

  it('5-atom leave-then-join shows up in the emitted tier groupings', () => {
    const plan = buildAtomFusionPlan(teachableRow(5), KNOBS)
    expect(plan.fusionTierCount).toBe(3)
    expect(takeAt(plan.steps, 'fuse-1').screen.mergedGroups).toEqual([[0, 1], [2, 3], [4]])
    expect(takeAt(plan.steps, 'fuse-2').screen.mergedGroups).toEqual([[0, 1], [2, 3, 4]])
    expect(takeAt(plan.steps, 'fuse-3').screen.mergedGroups).toEqual([[0, 1, 2, 3, 4]])
  })

  it('passthrough atoms join fusion but are never met', () => {
    const atoms: FusionAtom[] = [
      { lego_key: 'ides', kind: 'atom', gloss: "you're going", target_start_ms: 0, target_end_ms: 500 },
      { lego_key: 'na_posao', kind: 'atom', gloss: 'to work', target_start_ms: 500, target_end_ms: 1000 },
      { lego_key: 'maria', kind: 'passthrough', gloss: 'Maria', target_start_ms: 1000, target_end_ms: 1500 },
    ]
    const plan = buildAtomFusionPlan(atoms, KNOBS)

    expect(plan.fusibleAtomIdxs).toEqual([0, 1, 2])
    expect(plan.teachableAtomIdxs).toEqual([0, 1])

    // Absent from meet: no meet step highlights or cites the passthrough.
    const meet = stepsAt(plan.steps, 'meet')
    expect(meet.some((s) => s.screen.highlightAtomIdxs?.includes(2))).toBe(false)
    expect(meet.some((s) => s.play.legoKey === 'maria')).toBe(false)

    // Included in fusion: it appears in every tier's grouping.
    expect(takeAt(plan.steps, 'fuse-1').screen.mergedGroups).toEqual([[0, 1], [2]])
    expect(takeAt(plan.steps, 'fuse-2').screen.mergedGroups).toEqual([[0, 1, 2]])
  })

  it('single-span note plays in meet, immediately after the atom it spans, first pass only', () => {
    const atoms: FusionAtom[] = [
      ...teachableRow(3),
      {
        lego_key: 'note_k0',
        kind: 'note',
        gloss: 'a longer story about atom 0',
        explainer_start_ms: 0,
        explainer_end_ms: 1800,
        spans: [0],
      },
    ]
    const plan = buildAtomFusionPlan(atoms, { ...KNOBS, scaffoldFade: 'two-pass' })
    const meet = stepsAt(plan.steps, 'meet')

    // First pass for atom 0 = slice, explainer, echo; the note lands fourth.
    expect(meet[0].play).toEqual({ source: 'target_clause', sliceMs: [0, 500] })
    expect(meet[1].play).toEqual({ source: 'inventory_explainer', legoKey: 'k0' })
    expect(meet[2].play).toEqual({ source: 'target_clause', sliceMs: [0, 500] })
    expect(meet[3].play).toEqual({ source: 'note_audio', sliceMs: [0, 1800], noteIdx: 3 })
    expect(meet[3].screen.highlightAtomIdxs).toEqual([0])
    // Atom 1's first pass starts right after the note.
    expect(meet[4].play.sliceMs).toEqual([500, 1000])

    // The note plays exactly once — not repeated in the lighter pass.
    expect(meet.filter((s) => s.play.source === 'note_audio')).toHaveLength(1)
    // And never leaks into fusion.
    expect(
      plan.steps.filter((s) => s.tier.startsWith('fuse') && s.play.source === 'note_audio'),
    ).toHaveLength(0)
  })

  it('multi-span note fires at the EXACT first tier its atoms share a group', () => {
    // 6 atoms: [0,2] first share a group at tier 2 ([0123]); [4,5] at tier 1.
    const atoms: FusionAtom[] = [
      ...teachableRow(6),
      {
        lego_key: 'note_02',
        kind: 'note',
        gloss: 'junction quirk between 0 and 2',
        explainer_start_ms: 0,
        explainer_end_ms: 1200,
        spans: [0, 2],
      },
      {
        lego_key: 'note_45',
        kind: 'note',
        gloss: 'junction quirk between 4 and 5',
        explainer_start_ms: 1200,
        explainer_end_ms: 2400,
        spans: [4, 5],
      },
    ]
    const plan = buildAtomFusionPlan(atoms, KNOBS)

    const noteSteps = plan.steps.filter((s) => s.play.source === 'note_audio')
    expect(noteSteps).toHaveLength(2) // each fires exactly once

    const note02 = noteSteps.find((s) => s.play.noteIdx === 6)!
    const note45 = noteSteps.find((s) => s.play.noteIdx === 7)!
    expect(note02.tier).toBe('fuse-2')
    expect(note45.tier).toBe('fuse-1')

    // R7: the note comes immediately after its tier's clause take.
    const idxTake2 = plan.steps.indexOf(takeAt(plan.steps, 'fuse-2'))
    expect(plan.steps[idxTake2 + 1]).toBe(note02)
    expect(note02.screen.highlightAtomIdxs).toEqual([0, 2])
    expect(note02.screen.mergedGroups).toEqual([[0, 1, 2, 3], [4, 5]])
  })

  it('scaffoldFade: two-pass adds a lighter echo-free sweep; one-pass stops after the full sweep', () => {
    const atoms = teachableRow(2)

    const twoPass = buildAtomFusionPlan(atoms, { ...KNOBS, scaffoldFade: 'two-pass' })
    const onePass = buildAtomFusionPlan(atoms, { ...KNOBS, scaffoldFade: 'one-pass' })

    const meetTwo = stepsAt(twoPass.steps, 'meet')
    const meetOne = stepsAt(onePass.steps, 'meet')

    // Full sweep = 3 steps/atom; lighter sweep = 2 steps/atom (no echo).
    expect(meetTwo).toHaveLength(2 * 3 + 2 * 2)
    expect(meetOne).toHaveLength(2 * 3)

    // The lighter sweep really drops the echo: its per-atom pattern is
    // slice → explainer with no trailing slice.
    const lighter = meetTwo.slice(6)
    expect(lighter.map((s) => s.play.source)).toEqual([
      'target_clause',
      'inventory_explainer',
      'target_clause',
      'inventory_explainer',
    ])
  })

  it('anchoring per-tier re-plays the untouched clause after non-final tiers only', () => {
    const atoms = teachableRow(6) // 3 tiers
    const endsOnly = buildAtomFusionPlan(atoms, { ...KNOBS, anchoring: 'ends-only' })
    const perTier = buildAtomFusionPlan(atoms, { ...KNOBS, anchoring: 'per-tier' })

    const anchorsOf = (steps: PlanStep[]) =>
      steps.filter(
        (s) =>
          s.tier.startsWith('fuse') &&
          s.play.source === 'target_clause' &&
          !s.play.gapInsertsMs &&
          !s.play.sliceMs &&
          s !== takeAt(steps, 'fuse-3'), // final take is itself untouched
      )

    expect(anchorsOf(endsOnly.steps)).toHaveLength(0)
    const anchors = anchorsOf(perTier.steps)
    expect(anchors.map((s) => s.tier)).toEqual(['fuse-1', 'fuse-2']) // not fuse-3
  })

  it('throws on invalid input instead of emitting a broken plan', () => {
    expect(() => buildAtomFusionPlan([], KNOBS)).toThrow(/non-empty/)
    expect(() => buildAtomFusionPlan(teachableRow(3), { gapCurveMs: [100, 200, 0] })).toThrow(
      /monotonically decreasing/,
    )
  })

  it('is deterministic and fully serializable', () => {
    const atoms: FusionAtom[] = [
      ...teachableRow(5),
      {
        lego_key: 'note_23',
        kind: 'note',
        gloss: 'junction',
        explainer_start_ms: 0,
        explainer_end_ms: 1000,
        spans: [2, 3],
      },
    ]
    const a = buildAtomFusionPlan(atoms, KNOBS)
    const b = buildAtomFusionPlan(atoms, KNOBS)
    expect(a).toEqual(b)
    // JSON round-trip is lossless — no functions, no undefined-valued keys.
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  })

  it('full-plan snapshot: "Ideš na posao, Maria?" → [Ideš][na posao][Maria-passthrough]', () => {
    const atoms: FusionAtom[] = [
      { lego_key: 'ides', kind: 'atom', gloss: "you're going", target_start_ms: 0, target_end_ms: 620 },
      { lego_key: 'na_posao', kind: 'atom', gloss: 'to work', target_start_ms: 620, target_end_ms: 1450 },
      { lego_key: 'maria', kind: 'passthrough', gloss: 'Maria', target_start_ms: 1450, target_end_ms: 2100 },
    ]
    const plan = buildAtomFusionPlan(atoms, DEFAULT_FUSION_KNOBS)
    expect(plan).toMatchSnapshot()
  })
})
