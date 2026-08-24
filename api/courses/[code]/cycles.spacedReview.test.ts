/**
 * The cycles endpoint's round shape — spaced review and consolidation.
 *
 * THE BUG (Tom, 2026-08-09, live on the Chinese course): one round played with
 * no spaced-review phrases at all, the very next LEGO had full spaced rep plus
 * two consolidation phrases. Cause: this endpoint emitted only
 * intro|debut|build|use, and INSTANT_PLAYBACK_ALL makes it the live default —
 * so a session queue mixed endpoint-built rounds (no review) with walk-built
 * rounds (full review) and the learner met both.
 *
 * These tests pin the shape the endpoint now emits against the rules in
 * packages/player-vue/src/providers/generateLearningScript.ts, which remains
 * the source of truth: Fibonacci offsets, the N-1 triple, the 12-phrase cap,
 * USE-only review material, and a consolidation tail of at most two.
 */
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(() => {
  process.env.SUPABASE_URL ||= 'http://localhost:54321'
})

type Cycle = Record<string, any>

let buildLegoCycles: (lego: any, phrases: any[], reviews?: any[]) => Cycle[]
let dueReviewRounds: (roundIndex: number) => Array<{ offsetIndex: number; reviewRound: number }>
let reviewCursor: (offsetIndex: number, poolLength: number) => number
let SPACED_REP_OFFSETS: number[]
let MAX_SPACED_REP_PHRASES: number
let MAX_BUILD_PHRASES: number
let USE_CONSOLIDATION_COUNT: number
let N1_PHRASE_COUNT: number

beforeAll(async () => {
  ;({
    buildLegoCycles,
    dueReviewRounds,
    reviewCursor,
    SPACED_REP_OFFSETS,
    MAX_SPACED_REP_PHRASES,
    MAX_BUILD_PHRASES,
    USE_CONSOLIDATION_COUNT,
    N1_PHRASE_COUNT,
  } = await import('./cycles'))
})

const lego = (over: Record<string, unknown> = {}) => ({
  seed_number: 40,
  lego_index: 1,
  lego_id: 'S0040L01',
  type: 'A',
  known_text: 'to remember',
  target_text: 'jide',
  target_text_roman: null,
  components: null,
  is_new: true,
  known_audio_id: 'lego-known',
  target1_audio_id: 'lego-t1',
  target2_audio_id: 'lego-t2',
  presentation_audio_id: 'lego-pres',
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
  ...over,
})

/** A fully-audible phrase row for the LEGO under test. */
const phrase = (role: string, n: number, over: Record<string, unknown> = {}) => ({
  seed_number: 40,
  lego_index: 1,
  position: n,
  phrase_role: role,
  known_text: `${role} known ${n}`,
  target_text: `${role} target ${n}`,
  target_text_roman: null,
  decomposition: null,
  known_audio_id: `${role}-${n}-k`,
  target1_audio_id: `${role}-${n}-t1`,
  target2_audio_id: `${role}-${n}-t2`,
  target1_duration_ms: 900,
  target2_duration_ms: 900,
  ...over,
})

/** A USE row belonging to some EARLIER lego, as a review basket entry. */
const reviewPhrase = (legoId: string, n: number) => ({
  seed_number: parseInt(legoId.slice(1, 5), 10),
  lego_index: parseInt(legoId.slice(6), 10),
  position: n,
  phrase_role: 'use',
  known_text: `${legoId} known ${n}`,
  target_text: `${legoId} target ${n}`,
  target_text_roman: null,
  decomposition: null,
  known_audio_id: `${legoId}-${n}-k`,
  target1_audio_id: `${legoId}-${n}-t1`,
  target2_audio_id: `${legoId}-${n}-t2`,
  target1_duration_ms: 900,
  target2_duration_ms: 900,
})

const review = (offsetIndex: number, legoId: string, basketSize = 5) => ({
  offsetIndex,
  legoId,
  seedNumber: parseInt(legoId.slice(1, 5), 10),
  reviewOf: 40 - SPACED_REP_OFFSETS[offsetIndex],
  usePhrases: Array.from({ length: basketSize }, (_, i) => reviewPhrase(legoId, i + 1)),
})

/** Every review this LEGO's round would have at round 40 — all ten offsets. */
const fullReviewSet = () =>
  SPACED_REP_OFFSETS.map((offset, k) =>
    review(k, `S${String(40 - offset).padStart(4, '0')}L01`)
  )

describe('dueReviewRounds — the Fibonacci offsets', () => {
  it('is exactly the use-phrase Fibonacci set', () => {
    expect(SPACED_REP_OFFSETS).toEqual([1, 2, 3, 5, 8, 13, 21, 34, 55, 89])
  })

  it('offsets a late round back by each Fibonacci step', () => {
    const due = dueReviewRounds(100)
    expect(due.map((d) => d.reviewRound)).toEqual([99, 98, 97, 95, 92, 87, 79, 66, 45, 11])
  })

  it('an early round that has no prior material comes up empty', () => {
    expect(dueReviewRounds(1)).toEqual([])
  })

  it('a round early in a course reviews only the offsets that exist', () => {
    // Round 4 can look back 1, 2 and 3 rounds; offset 5 would be round -1.
    expect(dueReviewRounds(4).map((d) => d.reviewRound)).toEqual([3, 2, 1])
  })
})

describe('buildLegoCycles — a round past the opening carries reviews', () => {
  const phrases = [
    ...Array.from({ length: 4 }, (_, i) => phrase('build', i + 1)),
    ...Array.from({ length: 6 }, (_, i) => phrase('use', i + 1)),
  ]

  it('emits spaced_rep cycles for every LEGO that came due', () => {
    const out = buildLegoCycles(lego(), phrases, fullReviewSet())
    const reps = out.filter((c) => c.type === 'spaced_rep')
    expect(reps.length).toBeGreaterThan(0)
    // Ten offsets: N-1 gives three, the other nine give one each = 12, the cap.
    expect(reps).toHaveLength(MAX_SPACED_REP_PHRASES)
  })

  it('N-1 contributes three review phrases, every later offset one', () => {
    const out = buildLegoCycles(lego(), phrases, fullReviewSet())
    const byOffset = new Map<number, number>()
    for (const c of out.filter((x) => x.type === 'spaced_rep')) {
      byOffset.set(c.fib_position, (byOffset.get(c.fib_position) ?? 0) + 1)
    }
    expect(byOffset.get(0)).toBe(N1_PHRASE_COUNT)
    for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      if (byOffset.has(k)) expect(byOffset.get(k)).toBe(1)
    }
  })

  it('never exceeds the 12-phrase review cap even with more offsets due', () => {
    // Two LEGOs at N-1 would be 6 phrases; the tail still cannot push past 12.
    const reps = buildLegoCycles(lego(), phrases, fullReviewSet()).filter(
      (c) => c.type === 'spaced_rep'
    )
    expect(reps.length).toBeLessThanOrEqual(MAX_SPACED_REP_PHRASES)
  })

  it('reviews name the LEGO under review, and the round they play in', () => {
    const out = buildLegoCycles(lego(), phrases, fullReviewSet())
    for (const c of out.filter((x) => x.type === 'spaced_rep')) {
      expect(c.lego_id).not.toBe('S0040L01')
      expect(c.round_lego_id).toBe('S0040L01')
      expect(typeof c.review_of).toBe('number')
    }
  })

  it('rotates through the reviewed LEGO`s basket rather than replaying one phrase', () => {
    const n1 = buildLegoCycles(lego(), phrases, [review(0, 'S0039L01')]).filter(
      (c) => c.type === 'spaced_rep'
    )
    expect(new Set(n1.map((c) => c.target_text)).size).toBe(N1_PHRASE_COUNT)
    // The cursor for a later offset sits past the N-1 draw, so N-2 does not
    // hand back the same phrase N-1 opened with.
    expect(reviewCursor(0, 5)).toBe(0)
    expect(reviewCursor(1, 5)).toBe(N1_PHRASE_COUNT)
    expect(reviewCursor(2, 5)).toBe(N1_PHRASE_COUNT + 1)
  })
})

describe('buildLegoCycles — only USE phrases, never components, enter review', () => {
  it('drops non-use rows handed to a review basket', () => {
    const poisoned = {
      ...review(0, 'S0039L01', 3),
      usePhrases: [
        { ...reviewPhrase('S0039L01', 1), phrase_role: 'component' },
        { ...reviewPhrase('S0039L01', 2), phrase_role: 'build' },
      ],
    }
    const out = buildLegoCycles(lego(), [], [poisoned])
    expect(out.some((c) => c.type === 'spaced_rep')).toBe(false)
  })

  it('reviews only the use rows when a basket is mixed', () => {
    const mixed = {
      ...review(0, 'S0039L01', 0),
      usePhrases: [
        { ...reviewPhrase('S0039L01', 1), phrase_role: 'component' },
        reviewPhrase('S0039L01', 2),
        reviewPhrase('S0039L01', 3),
      ],
    }
    const reps = buildLegoCycles(lego(), [], [mixed]).filter((c) => c.type === 'spaced_rep')
    expect(reps).toHaveLength(2)
    expect(reps.every((c) => String(c.target_text).match(/target (2|3)$/))).toBe(true)
  })

  it('emits no cycle of any kind for a component row of the round LEGO', () => {
    const out = buildLegoCycles(
      lego(),
      [phrase('component', 1), phrase('use', 1)],
      fullReviewSet()
    )
    expect(out.some((c) => String(c.known_text).startsWith('component'))).toBe(false)
    expect(out.some((c) => c.type === 'component_intro')).toBe(false)
  })
})

describe('buildLegoCycles — consolidation is at most two, and last', () => {
  const phrases = [
    ...Array.from({ length: 3 }, (_, i) => phrase('build', i + 1)),
    ...Array.from({ length: 8 }, (_, i) => phrase('use', i + 1)),
  ]

  it('caps the consolidation tail at two USE cycles', () => {
    const out = buildLegoCycles(lego(), phrases, fullReviewSet())
    expect(out.filter((c) => c.type === 'use')).toHaveLength(USE_CONSOLIDATION_COUNT)
  })

  it('puts them at the very end of the round', () => {
    const types = buildLegoCycles(lego(), phrases, fullReviewSet()).map((c) => c.type)
    expect(types.slice(-USE_CONSOLIDATION_COUNT)).toEqual(
      Array(USE_CONSOLIDATION_COUNT).fill('use')
    )
    // …and the full order is the walk's: intro, debut, builds, reviews, uses.
    const firstRep = types.indexOf('spaced_rep')
    const lastBuild = types.lastIndexOf('build')
    expect(types[0]).toBe('intro')
    expect(types[1]).toBe('debut')
    expect(lastBuild).toBeLessThan(firstRep)
    expect(firstRep).toBeLessThan(types.indexOf('use'))
  })

  it('fills the BUILD slots from the USE basket before consolidating', () => {
    // 3 BUILD rows + 7 build slots means 4 USE rows are promoted to builds.
    const out = buildLegoCycles(lego(), phrases, [])
    expect(out.filter((c) => c.type === 'build')).toHaveLength(MAX_BUILD_PHRASES)
    expect(out.filter((c) => c.type === 'use')).toHaveLength(USE_CONSOLIDATION_COUNT)
  })

  it('never plays the same phrase twice in one round', () => {
    const out = buildLegoCycles(lego(), phrases, fullReviewSet())
    const practice = out.filter((c) => c.type !== 'intro' && c.type !== 'debut')
    const keys = practice.map((c) => `${c.known_text}|${c.target_text}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('buildLegoCycles — the opening rounds legitimately have no reviews', () => {
  it('emits no spaced_rep when nothing has come due', () => {
    const out = buildLegoCycles(
      lego({ seed_number: 1, lego_index: 1, lego_id: 'S0001L01' }),
      [phrase('build', 1), phrase('use', 1)],
      []
    )
    expect(out.some((c) => c.type === 'spaced_rep')).toBe(false)
    // The lone USE row fills a BUILD slot first (BUILD priority beats
    // consolidation in the walk), then the consolidation pass replays it
    // rather than leave the round without a tail. Same two cycles the walk
    // emits for a LEGO with one USE phrase.
    expect(out.map((c) => c.type)).toEqual(['intro', 'debut', 'build', 'build', 'use'])
  })

  it('is unchanged for callers that pass no reviews at all', () => {
    const withArg = buildLegoCycles(lego(), [phrase('use', 1)], [])
    const withoutArg = buildLegoCycles(lego(), [phrase('use', 1)])
    expect(withoutArg).toEqual(withArg)
  })
})
