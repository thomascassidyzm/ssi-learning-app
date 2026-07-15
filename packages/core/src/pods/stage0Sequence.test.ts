import { describe, it, expect } from 'vitest'
import {
  tierSequence,
  buildLadder,
  sequenceDurationMs,
  foldEventsToPlays,
  DEFAULT_STAGE0,
  type Stage0Config,
  type Stage0Tier,
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

// DEFAULT_STAGE0 now ships ONLY the 4-movement explainer tier (Tom 2026-06-27).
// The pairs/intention/atoms code paths are retained in the composer for any
// course that re-adds them, so we exercise them via inline tier fixtures.
const EXPLAINER = DEFAULT_STAGE0.tiers.find((t) => t.key === 'explainer')!
const PAIRS200: Stage0Tier = { key: 'pairs200', visits: 1, fusionGap: 200, granularity: 'pairs', targetRepeats: 1 }
const PAIRS0: Stage0Tier = { key: 'pairs0', visits: 1, fusionGap: 0, granularity: 'pairs', targetRepeats: 1 }
const INTENTION: Stage0Tier = { key: 'intention', visits: 1, fusionGap: null, granularity: 'intention', targetRepeats: 1 }

const clipIds = (seq: Stage0Event[]) =>
  seq.filter((e): e is Extract<Stage0Event, { type: 'clip' }> => e.type === 'clip').map((e) => e.audioId)
const roles = (seq: Stage0Event[]) =>
  seq.filter((e): e is Extract<Stage0Event, { type: 'clip' }> => e.type === 'clip').map((e) => e.role)
const roleCount = (seq: Stage0Event[], r: string) => roles(seq).filter((x) => x === r).length

describe('tierSequence — explainer (4-movement breakdown)', () => {
  const seq = tierSequence(EXPLAINER, ATOMS, CLIPS, DEFAULT_STAGE0)

  it('whole target → whole known → per-chunk (target + means) → whole target', () => {
    // movements 1 & 4 are the smooth whole take; 2 is the translation; 3 is one
    // (target + "means X") per MEANINGFUL chunk, each heard ONCE.
    expect(roleCount(seq, 'wholeTake')).toBe(2) // open + close
    expect(roleCount(seq, 'translation')).toBe(1)
    expect(roleCount(seq, 'meansGloss')).toBe(3) // one per chunk
    expect(roleCount(seq, 'target')).toBe(3) // breakdown chunks only — NOT the bookends
    expect(clipIds(seq)).toEqual(['whole', 'trans', 't1', 'm1', 't2', 'm2', 't3', 'm3', 'whole'])
  })

  it('opens AND closes with the smooth whole take', () => {
    const ids = clipIds(seq)
    expect(ids[0]).toBe('whole')
    expect(ids[ids.length - 1]).toBe('whole')
  })

  it('never emits a dangling trailing gap', () => {
    expect(seq[seq.length - 1].type).toBe('clip')
  })

  it('a name (no means-gloss) is never drilled on its own — heard only in the whole takes', () => {
    // 'gracias' has a target clip but NO means clip → it is NOT a chunk.
    const withName: ResolvedAtom[] = [
      ATOMS[0],
      { ...ATOMS[1], meansGlossClipId: null },
      ATOMS[2],
    ]
    const s = tierSequence(EXPLAINER, withName, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(s)).toEqual(['whole', 'trans', 't1', 'm1', 't3', 'm3', 'whole']) // t2/gracias never appears alone
    expect(roleCount(s, 'meansGloss')).toBe(2)
  })
})

describe('tierSequence — atoms / pairs / intention (retained code paths)', () => {
  it('atoms granularity: atoms (no means-gloss), then the whole translation', () => {
    const atomsTier: Stage0Tier = { key: 'translation', visits: 1, fusionGap: null, granularity: 'atoms', targetRepeats: 0 }
    const seq = tierSequence(atomsTier, ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['t1', 't2', 't3', 'trans'])
    expect(roles(seq)).toEqual(['target', 'target', 'target', 'translation'])
    expect(roles(seq)).not.toContain('meansGloss') // means is the explainer's job
  })

  it('pairs200: fused targets → translation → the SAME fused targets again (symmetric, ends on target)', () => {
    const seq = tierSequence(PAIRS200, ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['t1', 't2', 't3', 'trans', 't1', 't2', 't3'])
    expect(roles(seq).slice(-1)[0]).toBe('target') // never ends on the known language
    const fusionGaps = seq.filter((e) => e.type === 'gap' && e.kind === 'fusion')
    expect(fusionGaps).toHaveLength(4) // 2 opener + 2 closer
    expect((fusionGaps[0] as any).ms).toBe(200)
  })

  it('pairs0: fused targets at 0ms → translation → fused targets again (no fusion gaps emitted)', () => {
    const seq = tierSequence(PAIRS0, ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['t1', 't2', 't3', 'trans', 't1', 't2', 't3'])
    expect(roles(seq).slice(-1)[0]).toBe('target')
    expect(seq.filter((e) => e.type === 'gap' && e.kind === 'fusion')).toHaveLength(0)
  })

  it('intention: whole take → translation → whole take again (ends on target)', () => {
    const seq = tierSequence(INTENTION, ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['whole', 'trans', 'whole'])
    expect(roles(seq)).toEqual(['wholeTake', 'translation', 'wholeTake'])
  })
})

describe('targetRepeats — parametrised closing target after the known (pairs / intention)', () => {
  const pairsTier = (n: number): Stage0Tier =>
    ({ key: 'pairs200', visits: 1, fusionGap: null, granularity: 'pairs', targetRepeats: n })
  const intentionTier = (n: number): Stage0Tier =>
    ({ key: 'intention', visits: 1, fusionGap: null, granularity: 'intention', targetRepeats: n })

  it('0 → ends on the known (legacy ends-on-translation shape)', () => {
    const seq = tierSequence(pairsTier(0), ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['t1', 't2', 't3', 'trans'])
    expect(roles(seq).slice(-1)[0]).toBe('translation')
  })

  it('1 (default) → one symmetric closing target', () => {
    const seq = tierSequence(pairsTier(1), ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['t1', 't2', 't3', 'trans', 't1', 't2', 't3'])
    expect(roles(seq).slice(-1)[0]).toBe('target')
  })

  it('2 → known then the fused target twice', () => {
    const seq = tierSequence(pairsTier(2), ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['t1', 't2', 't3', 'trans', 't1', 't2', 't3', 't1', 't2', 't3'])
    expect(roles(seq).slice(-1)[0]).toBe('target')
  })

  it('intention honours targetRepeats too (0 ends on known, 2 repeats the whole take)', () => {
    expect(clipIds(tierSequence(intentionTier(0), ATOMS, CLIPS, DEFAULT_STAGE0))).toEqual(['whole', 'trans'])
    expect(clipIds(tierSequence(intentionTier(2), ATOMS, CLIPS, DEFAULT_STAGE0))).toEqual(['whole', 'trans', 'whole', 'whole'])
  })
})

describe('robustness', () => {
  it('skips atoms with no target clip without dangling gaps', () => {
    const partial: ResolvedAtom[] = [
      ATOMS[0],
      { targetSurface: 'x', gloss: 'y', targetClipId: null, meansGlossClipId: null },
      ATOMS[2],
    ]
    const seq = tierSequence(PAIRS200, partial, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['t1', 't3', 'trans', 't1', 't3']) // null-clip atom skipped; symmetric target close
    // no two gaps in a row
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i].type === 'gap' && seq[i - 1].type === 'gap').toBe(false)
    }
  })

  it('a sentence with no means-glosses falls back to whole → known → whole (no per-chunk breakdown)', () => {
    const noMeans: ResolvedAtom[] = ATOMS.map((a) => ({ ...a, meansGlossClipId: null }))
    const seq = tierSequence(EXPLAINER, noMeans, CLIPS, DEFAULT_STAGE0)
    expect(clipIds(seq)).toEqual(['whole', 'trans', 'whole'])
    expect(roleCount(seq, 'meansGloss')).toBe(0)
    expect(roleCount(seq, 'target')).toBe(0) // no chunk is drilled
    expect(roleCount(seq, 'wholeTake')).toBe(2)
  })

  it('handles a single-atom sentence', () => {
    const one = [ATOMS[0]]
    expect(() => buildLadder(one, CLIPS, DEFAULT_STAGE0)).not.toThrow()
    const seq = tierSequence(PAIRS200, one, CLIPS, DEFAULT_STAGE0)
    expect(seq.filter((e) => e.type === 'gap' && e.kind === 'fusion')).toHaveLength(0)
  })
})

describe('buildLadder', () => {
  it('default ladder = the single 4-movement explainer tier, no stage gaps', () => {
    const ladder = buildLadder(ATOMS, CLIPS, DEFAULT_STAGE0)
    expect(new Set(ladder.map((e) => e.tier))).toEqual(new Set(['explainer']))
    expect(ladder.filter((e) => e.type === 'gap' && e.kind === 'stage')).toHaveLength(0) // one tier → no stage gaps
  })

  it('a multi-tier config concatenates tiers separated by a stage gap', () => {
    const multi: Stage0Config = { ...DEFAULT_STAGE0, tiers: [EXPLAINER, INTENTION] }
    const ladder = buildLadder(ATOMS, CLIPS, multi)
    expect(new Set(ladder.map((e) => e.tier))).toEqual(new Set(['explainer', 'intention']))
    expect(ladder.filter((e) => e.type === 'gap' && e.kind === 'stage')).toHaveLength(1) // 2 tiers → 1 stage gap
  })

  it('sequenceDurationMs sums clips (÷speed) + gaps', () => {
    const dur = (id: string) => (id === 'trans' || id === 'whole' ? 1000 : 500)
    const ms = sequenceDurationMs(tierSequence(INTENTION, ATOMS, CLIPS, DEFAULT_STAGE0), dur)
    // whole(1000) + tm(500) + trans(1000) + tm(500) + whole(1000) = 4000 (symmetric close)
    expect(ms).toBe(4000)
  })
})

describe('foldEventsToPlays', () => {
  it('folds gaps onto the preceding clip; last clip omits gapAfterMs', () => {
    const events = tierSequence(PAIRS200, ATOMS, CLIPS, DEFAULT_STAGE0)
    const plays = foldEventsToPlays(events)
    expect(plays.map((p) => p.audioId)).toEqual(['t1', 't2', 't3', 'trans', 't1', 't2', 't3'])
    expect(plays[0].gapAfterMs).toBe(200) // fusion after t1
    expect(plays[1].gapAfterMs).toBe(200) // fusion after t2
    expect(plays[2].gapAfterMs).toBe(DEFAULT_STAGE0.gaps.targetMeaning) // 500 t3→trans
    expect(plays[3].gapAfterMs).toBe(DEFAULT_STAGE0.gaps.targetMeaning) // 500 trans→closing target
    expect(plays.slice(-1)[0].audioId).toBe('t3') // ends on target, never the known clip
    expect(plays.slice(-1)[0].gapAfterMs).toBeUndefined() // last clip → caller supplies the inter-sentence gap
  })

  it('sums consecutive gaps onto one clip', () => {
    const events: Stage0Event[] = [
      { type: 'clip', audioId: 'a', role: 'target', label: 'a', speed: 1, tier: 'x' },
      { type: 'gap', ms: 100, kind: 'g', tier: 'x' },
      { type: 'gap', ms: 50, kind: 'g', tier: 'x' },
      { type: 'clip', audioId: 'b', role: 'target', label: 'b', speed: 1, tier: 'x' },
    ]
    const plays = foldEventsToPlays(events)
    expect(plays[0].gapAfterMs).toBe(150)
    expect(plays[1].gapAfterMs).toBeUndefined()
  })
})
