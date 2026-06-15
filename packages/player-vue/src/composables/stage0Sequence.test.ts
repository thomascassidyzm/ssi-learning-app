import { describe, it, expect } from 'vitest'
import {
  tierSequence,
  buildLadder,
  sequenceDurationMs,
  DEFAULT_STAGE0,
  type ResolvedAtom,
  type SentenceClips,
  type Stage0Event,
} from './stage0Sequence'

// Fixture: "Muy bien, gracias. ¿Vas al trabajo?" — 3 fully-decomposed atoms
const ATOMS: ResolvedAtom[] = [
  { targetSurface: 'Muy bien', gloss: 'very well', targetClipId: 't1', meansGlossClipId: 'm1' },
  { targetSurface: 'gracias', gloss: 'thank you', targetClipId: 't2', meansGlossClipId: 'm2' },
  { targetSurface: '¿Vas al trabajo', gloss: 'are you going to work', targetClipId: 't3', meansGlossClipId: 'm3' },
]
const CLIPS: SentenceClips = {
  wholeTakeId: 'whole',
  translationId: 'trans',
  targetText: 'Muy bien, gracias. ¿Vas al trabajo?',
  knownText: "I'm very well, thank you. Are you going to work?",
}
const tierByKey = (k: string) => DEFAULT_STAGE0.tiers.find((t) => t.key === k)!
const clipIds = (seq: Stage0Event[]) =>
  seq.filter((e): e is Extract<Stage0Event, { type: 'clip' }> => e.type === 'clip').map((e) => e.audioId)
const roles = (seq: Stage0Event[]) =>
  seq.filter((e): e is Extract<Stage0Event, { type: 'clip' }> => e.type === 'clip').map((e) => e.role)

describe('tierSequence — explainer (whole-part-whole)', () => {
  const seq = tierSequence(tierByKey('explainer'), ATOMS, CLIPS, DEFAULT_STAGE0)

  it('opens chunked, states meaning, breaks down, closes chunked', () => {
    // opener = 3 targets; then translation; then 3×(target+meansGloss); then closer 3 targets
    expect(roles(seq).filter((r) => r === 'translation')).toHaveLength(1)
    expect(roles(seq).filter((r) => r === 'meansGloss')).toHaveLength(3)
    // targets: 3 opener + 3 breakdown + 3 closer = 9
    expect(roles(seq).filter((r) => r === 'target')).toHaveLength(9)
  })

  it('opens with the chunked target phrase, not the smooth whole take', () => {
    const firstClip = seq.find((e) => e.type === 'clip') as Extract<Stage0Event, { type: 'clip' }>
    expect(firstClip.audioId).toBe('t1')
    expect(clipIds(seq)).not.toContain('whole') // smooth take is tier 5 only
  })

  it('never emits a dangling trailing gap', () => {
    expect(seq[seq.length - 1].type).toBe('clip')
  })
})

describe('tierSequence — translation / pairs / intention', () => {
  it('translation: each atom target followed by its means-gloss', () => {
    const seq = tierSequence(tierByKey('translation'), ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(roles(seq)).toEqual([
      'target', 'meansGloss', 'target', 'meansGloss', 'target', 'meansGloss',
    ])
  })

  it('pairs200: targets fused at fusionPairs gap, then translation', () => {
    const seq = tierSequence(tierByKey('pairs200'), ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['t1', 't2', 't3', 'trans'])
    const fusionGaps = seq.filter((e) => e.type === 'gap' && e.kind === 'fusion')
    expect(fusionGaps).toHaveLength(2)
    expect((fusionGaps[0] as any).ms).toBe(DEFAULT_STAGE0.gaps.fusionPairs) // 200
  })

  it('pairs0: targets fused at 0ms (no fusion gaps emitted), then translation', () => {
    const seq = tierSequence(tierByKey('pairs0'), ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['t1', 't2', 't3', 'trans'])
    expect(seq.filter((e) => e.type === 'gap' && e.kind === 'fusion')).toHaveLength(0)
  })

  it('intention: the smooth whole take then the translation', () => {
    const seq = tierSequence(tierByKey('intention'), ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['whole', 'trans'])
    expect(roles(seq)).toEqual(['wholeTake', 'translation'])
  })
})

describe('robustness', () => {
  it('skips atoms with no target clip without dangling gaps', () => {
    const partial: ResolvedAtom[] = [
      ATOMS[0],
      { targetSurface: 'x', gloss: 'y', targetClipId: null, meansGlossClipId: null },
      ATOMS[2],
    ]
    const seq = tierSequence(tierByKey('pairs200'), partial, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['t1', 't3', 'trans']) // the null-clip atom is skipped
    // no two gaps in a row
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i].type === 'gap' && seq[i - 1].type === 'gap').toBe(false)
    }
  })

  it('a missing means-gloss falls back to target-only in the breakdown', () => {
    const noMeans: ResolvedAtom[] = ATOMS.map((a) => ({ ...a, meansGlossClipId: null }))
    const seq = tierSequence(tierByKey('explainer'), noMeans, CLIPS, DEFAULT_STAGE0)
    expect(roles(seq).filter((r) => r === 'meansGloss')).toHaveLength(0)
    expect(roles(seq).filter((r) => r === 'target').length).toBeGreaterThan(0)
  })

  it('handles a single-atom sentence', () => {
    const one = [ATOMS[0]]
    expect(() => buildLadder(one, CLIPS, DEFAULT_STAGE0)).not.toThrow()
    const seq = tierSequence(tierByKey('pairs200'), one, CLIPS, DEFAULT_STAGE0)
    expect(seq.filter((e) => e.type === 'gap' && e.kind === 'fusion')).toHaveLength(0)
  })
})

describe('buildLadder', () => {
  const ladder = buildLadder(ATOMS, CLIPS, DEFAULT_STAGE0)

  it('concatenates all 5 tiers separated by stage gaps', () => {
    const tiersSeen = new Set(ladder.map((e) => e.tier))
    expect(tiersSeen).toEqual(new Set(['explainer', 'translation', 'pairs200', 'pairs0', 'intention']))
    expect(ladder.filter((e) => e.type === 'gap' && e.kind === 'stage')).toHaveLength(4) // between 5 tiers
  })

  it('sequenceDurationMs sums clips (÷speed) + gaps', () => {
    const dur = (id: string) => (id === 'trans' || id === 'whole' ? 1000 : 500)
    const ms = sequenceDurationMs(tierSequence(tierByKey('intention'), ATOMS, CLIPS, DEFAULT_STAGE0), dur)
    // whole(1000) + tm gap(500) + trans(1000) = 2500
    expect(ms).toBe(2500)
  })
})
