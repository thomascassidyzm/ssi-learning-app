/**
 * selectionParity — THE permanent guard against the script drift of 2026-08-29.
 *
 * The drift: two producers implemented the same pedagogy differently. The walk
 * (`player-vue/src/providers/generateLearningScript.ts`) ordered a LEGO's
 * baskets shortest-first by target syllables and drew reviews from a per-LEGO
 * round-robin urn; the bundle path ordered by DB position and drew reviews with
 * an independent `Math.random()`. Most rounds in a sampled comparison differed.
 *
 * The fix was to extract the walk's selection algorithm into one shared module
 * (`phraseSelection.ts`) and have the bundle path call it. This file is what
 * stops that collapsing again, and it is deliberately built so it CANNOT pass
 * by construction:
 *
 *   - `walkDebutSelection` below is an INDEPENDENT restatement of the walk's
 *     phases 3 and 5, transcribed from `generateLearningScript.ts` and using
 *     nothing from `phraseSelection.ts`. If either implementation drifts, this
 *     disagrees.
 *   - It runs against REAL baskets from all fifteen cut-over courses
 *     (`__fixtures__/selection-pools.json`, captured by
 *     `tools/bundle-cutover/capture-selection-fixture.mjs`), not synthetic data.
 *
 * WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT. Debut selection is asserted
 * IDENTICAL — same phrases, same order, per LEGO, on every course. Review draws
 * are asserted STRUCTURALLY (pool membership, no repeat before the pool is
 * exhausted, exact wraparound) and NOT phrase-for-phrase against the walk:
 * Tom's ruling, 2026-08-29, is that specific review draws need not match, only
 * the urn properties must.
 */
import { describe, it, expect } from 'vitest'
import fixture from './__fixtures__/selection-pools.json'
import { generateScript } from './generateScript'
import type { BundleLego, BundlePhrase, BundleRoundMapEntry, CourseBundle } from './courseBundle'
import {
  MIN_BUILD_PHRASES_AFTER_CAP,
  MIN_USE_PHRASES_AFTER_CAP,
  capPhrasesByLength,
  countTargetSyllables,
  drawReviewPhrases,
  orderLegoPools,
  phraseTextLength,
  reviewCursorStart,
  selectDebutPhrases,
} from './phraseSelection'

// ---------------------------------------------------------------------------
// FIXTURE
// ---------------------------------------------------------------------------

interface FixturePhrase {
  role: 'build' | 'use'
  position: number
  knownText: string
  targetText: string
  targetTextRoman?: string
  targetSyllableCount?: number
  playable: boolean
}
interface FixtureLego { legoId: string; roundIndex: number; phrases: FixturePhrase[] }
const COURSES = fixture.courses as Record<string, FixtureLego[]>
const COURSE_CODES = Object.keys(COURSES)

/** `script_shape` values in force on every cut-over course. */
const MAX_BUILD_PHRASES = 7
const USE_CONSOLIDATION_COUNT = 2
const N1_PHRASE_COUNT = 3

// ---------------------------------------------------------------------------
// THE WALK, RESTATED INDEPENDENTLY
// ---------------------------------------------------------------------------

/**
 * `getPhraseId` from generateLearningScript.ts — the round's dedup key.
 * Transcribed, not imported: an imported copy would make the comparison
 * circular.
 */
function walkNormalize(text: string): string {
  return text.toLowerCase().trim().replace(/[.,!?;:¡¿'"　-〿＀-／：-＠［-｀｛-･]+/g, '')
}
function walkPhraseId(knownText: string, targetText: string): string {
  return `${walkNormalize(knownText)}|${walkNormalize(targetText)}`
}

/** The walk's `phraseSyllables`: stored count, else derived from target_text. */
function walkSyllables(p: FixturePhrase): number {
  if (p.targetSyllableCount) return p.targetSyllableCount
  const t = p.targetText
  if (!t) return 0
  const cjk = t.match(/[一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯]/g)
  if (cjk && cjk.length > 0) return cjk.length
  const vowels = t.toLowerCase().match(/[aeiouyáéíóúàèìòùâêîôûäëïöü]+/gi)
  return vowels ? vowels.length : 1
}

/**
 * generateLearningScript.ts phases 3 and 5, restated.
 *
 * Phase 3 — BUILD: walk the shortest-first BUILD pool taking up to 7, skipping
 * anything the round already claimed BEFORE it consumes a slot; then top up the
 * remaining slots from the shortest-first USE pool the same way.
 * Phase 5 — CONSOLIDATE ×2: unused USE phrases first, then a relaxed pass that
 * may reuse a phrase already played this round.
 *
 * Fast mode, which is what the bundle path generates: no length cap
 * (`PHRASE_LENGTH_LIMIT = Infinity`), no known-side pull filter, no word cap.
 */
function walkDebutSelection(lego: FixtureLego): { build: FixturePhrase[]; consolidate: FixturePhrase[] } {
  // The walk drops a phrase without all three clips as it READS it, so it never
  // enters a basket and never costs a slot.
  const eligible = lego.phrases.filter((p) => p.playable)
  const bySyllables = (pool: FixturePhrase[]) =>
    [...pool].sort((a, b) => walkSyllables(a) - walkSyllables(b)) // stable ⇒ ties keep position order
  const buildPool = bySyllables(eligible.filter((p) => p.role === 'build'))
  const usePool = bySyllables(eligible.filter((p) => p.role === 'use'))

  const used = new Set<string>()
  const build: FixturePhrase[] = []
  for (const p of buildPool) {
    if (build.length >= MAX_BUILD_PHRASES) break
    const id = walkPhraseId(p.knownText, p.targetText)
    if (used.has(id)) continue
    used.add(id)
    build.push(p)
  }
  for (const p of usePool) {
    if (build.length >= MAX_BUILD_PHRASES) break
    const id = walkPhraseId(p.knownText, p.targetText)
    if (used.has(id)) continue
    used.add(id)
    build.push(p)
  }

  const consolidate: FixturePhrase[] = []
  for (const p of usePool) {
    if (consolidate.length >= USE_CONSOLIDATION_COUNT) break
    const id = walkPhraseId(p.knownText, p.targetText)
    if (used.has(id)) continue
    used.add(id)
    consolidate.push(p)
  }
  if (consolidate.length < USE_CONSOLIDATION_COUNT) {
    for (const p of usePool) {
      if (consolidate.length >= USE_CONSOLIDATION_COUNT) break
      consolidate.push(p)
    }
  }
  return { build, consolidate }
}

// ---------------------------------------------------------------------------
// THE SHARED SELECTOR, DRIVEN AS THE BUNDLE PATH DRIVES IT
// ---------------------------------------------------------------------------

/**
 * Exactly what `generateScript.ts` does — same accessors, same
 * `limit: Infinity`, same claim set seeded with the bare LEGO — so this test
 * exercises the live wiring, not a friendly paraphrase of it.
 *
 * The bundle's `targetText` is the ROMAN form when a course has one and the
 * native script moves to `targetTextNative`, so the sort key reads
 * `targetTextNative ?? targetText` to land back on the walk's `target_text`.
 */
function sharedDebutSelection(lego: FixtureLego): { build: FixturePhrase[]; consolidate: FixturePhrase[] } {
  const asBundleShape = lego.phrases.map((p) => ({
    ...p,
    // The bundle's two text fields, derived exactly as api/.../bundle.ts's
    // `pickTargets` derives them.
    bundleTargetText: p.targetTextRoman ?? p.targetText,
    bundleTargetTextNative: p.targetTextRoman ? p.targetText : undefined,
  }))
  type P = (typeof asBundleShape)[number]
  const nativeOf = (p: P) => p.bundleTargetTextNative ?? p.bundleTargetText

  const pools = orderLegoPools(
    asBundleShape.filter((p) => p.role === 'build'),
    asBundleShape.filter((p) => p.role === 'use'),
    {
      eligible: (p: P) => p.playable,
      syllablesOf: (p: P) => p.targetSyllableCount || countTargetSyllables(nativeOf(p)),
      lengthOf: (p: P) => phraseTextLength(nativeOf(p)),
      limit: Infinity,
    },
  )

  const claimed = new Set<string>()
  const claim = (p: P): boolean => {
    const key = walkPhraseId(p.knownText, p.bundleTargetText)
    if (claimed.has(key)) return false
    claimed.add(key)
    return true
  }
  const sel = selectDebutPhrases(pools, {
    maxBuildPhrases: MAX_BUILD_PHRASES,
    useConsolidationCount: USE_CONSOLIDATION_COUNT,
    claim,
    isBareLego: () => false, // the fixture carries phrases only, never the LEGO row
  })
  return { build: sel.build, consolidate: sel.selectConsolidate() }
}

const idsOf = (ps: Array<{ knownText: string; targetText: string }>) =>
  ps.map((p) => `${p.knownText} → ${p.targetText}`)

// ---------------------------------------------------------------------------
// (a) DEBUT PARITY — identical, all fifteen courses
// ---------------------------------------------------------------------------

describe('debut selection is identical between the walk and the shared selector', () => {
  it('covers every cut-over course', () => {
    expect(COURSE_CODES).toHaveLength(15)
  })

  for (const code of COURSE_CODES) {
    it(code, () => {
      const legos = COURSES[code]
      expect(legos.length).toBeGreaterThan(0)
      let compared = 0
      for (const lego of legos) {
        const walk = walkDebutSelection(lego)
        const shared = sharedDebutSelection(lego)
        expect(idsOf(shared.build), `${code} ${lego.legoId} BUILD`).toEqual(idsOf(walk.build))
        expect(idsOf(shared.consolidate), `${code} ${lego.legoId} CONSOLIDATE`).toEqual(idsOf(walk.consolidate))
        compared += walk.build.length + walk.consolidate.length
      }
      // A vacuous pass is not a pass: assert the comparison had something in it.
      expect(compared).toBeGreaterThan(0)
    })
  }

  it('is NOT satisfied by DB-position order — the rule that drifted', () => {
    // If ordering by position happened to equal ordering by syllables on every
    // fixture LEGO, the assertions above would prove nothing. At least one real
    // LEGO must actually distinguish them.
    let differing = 0
    for (const code of COURSE_CODES) {
      for (const lego of COURSES[code]) {
        const eligible = lego.phrases.filter((p) => p.playable && p.role === 'build')
        const byPosition = [...eligible].sort((a, b) => a.position - b.position)
        const bySyllable = [...eligible].sort((a, b) => walkSyllables(a) - walkSyllables(b))
        if (idsOf(byPosition).join('|') !== idsOf(bySyllable).join('|')) differing++
      }
    }
    expect(differing).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// (b) URN STRUCTURE — properties, not specific draws
// ---------------------------------------------------------------------------

describe('the review urn', () => {
  /** Every index a LEGO's reviews visit, in order, over `reviews` reviews. */
  function urnIndices(poolLength: number, reviews: number): number[] {
    const out: number[] = []
    for (let offsetIndex = 0; offsetIndex < reviews; offsetIndex++) {
      const take = offsetIndex === 0 ? N1_PHRASE_COUNT : 1
      let cursor = reviewCursorStart(offsetIndex, poolLength, N1_PHRASE_COUNT)
      for (let i = 0; i < Math.min(take, poolLength); i++) {
        out.push(cursor % poolLength)
        cursor++
      }
    }
    return out
  }

  it('draws only from the LEGO’s own USE pool, and that pool is the debut’s', () => {
    for (const code of COURSE_CODES) {
      for (const lego of COURSES[code]) {
        const use = lego.phrases.filter((p) => p.role === 'use' && p.playable)
        if (use.length === 0) continue
        const pool = capPhrasesByLength(use, walkSyllables, (p) => phraseTextLength(p.targetText), Infinity, MIN_USE_PHRASES_AFTER_CAP)
        const members = new Set(idsOf(pool))
        const drawn = drawReviewPhrases(pool, 0, N1_PHRASE_COUNT, N1_PHRASE_COUNT, () => true)
        for (const p of drawn) {
          expect(p, `${code} ${lego.legoId}`).not.toBeNull()
          expect(members.has(`${p!.knownText} → ${p!.targetText}`)).toBe(true)
        }
      }
    }
  })

  it('never repeats a phrase before the pool is exhausted', () => {
    for (let poolLength = 1; poolLength <= 24; poolLength++) {
      const seq = urnIndices(poolLength, 17) // the full Fibonacci offset ladder
      for (let start = 0; start + poolLength <= seq.length; start++) {
        const window = new Set(seq.slice(start, start + poolLength))
        expect(window.size, `pool ${poolLength}, window at ${start}`).toBe(poolLength)
      }
    }
  })

  it('wraps around exactly — +1 per draw, modulo the pool', () => {
    for (let poolLength = 1; poolLength <= 24; poolLength++) {
      const seq = urnIndices(poolLength, 17)
      for (let i = 1; i < seq.length; i++) {
        expect((seq[i - 1] + 1) % poolLength, `pool ${poolLength} at draw ${i}`).toBe(seq[i])
      }
    }
  })

  it('covers the whole pool once the pool length is reached', () => {
    for (let poolLength = 1; poolLength <= 24; poolLength++) {
      const seq = urnIndices(poolLength, 17)
      if (seq.length < poolLength) continue
      expect(new Set(seq.slice(0, poolLength)).size).toBe(poolLength)
    }
  })

  it('advances on a suppressed draw, so rotation stays in step with the walk', () => {
    const pool = ['a', 'b', 'c', 'd']
    // 'b' is already claimed by an earlier slot in this round.
    const claimed = new Set(['b'])
    const drawn = drawReviewPhrases(pool, 0, 3, 3, (p) => {
      if (claimed.has(p)) return false
      claimed.add(p)
      return true
    })
    expect(drawn).toEqual(['a', null, 'c'])
    // Next review resumes at index 3, not 2 — the suppressed draw consumed its
    // turn, exactly as the walk's `useIndex++`-before-dedup does.
    expect(reviewCursorStart(1, pool.length, 3)).toBe(3)
  })

  it('is position-independent, which is what the paged bundle path needs', () => {
    // Same offsetIndex ⇒ same cursor, no matter how many times the generator has
    // been re-entered. A stateful per-invocation Map would restart at 0 on every
    // page and is why the closed form is the shared one.
    expect(reviewCursorStart(4, 9, 3)).toBe(reviewCursorStart(4, 9, 3))
    expect(reviewCursorStart(0, 9, 3)).toBe(0)
    expect(reviewCursorStart(1, 9, 3)).toBe(3)
    expect(reviewCursorStart(2, 9, 3)).toBe(4)
    // A pool shorter than the N-1 draw clamps rather than skipping ahead.
    expect(reviewCursorStart(1, 2, 3)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// FLOORS
// ---------------------------------------------------------------------------

describe('the length cap yields to the phrase floors', () => {
  it('returns the shortest minKeep rather than starve a LEGO', () => {
    const pool = [
      { s: 1, t: 'aaaaaaaaaaaaaaaaaaaa' },
      { s: 2, t: 'bbbbbbbbbbbbbbbbbbbb' },
      { s: 3, t: 'cccccccccccccccccccc' },
      { s: 4, t: 'dddddddddddddddddddd' },
      { s: 5, t: 'eeeeeeeeeeeeeeeeeeee' },
      { s: 6, t: 'ffffffffffffffffffff' },
    ]
    const capped = capPhrasesByLength(pool, (p) => p.s, (p) => p.t.length, 5, MIN_BUILD_PHRASES_AFTER_CAP)
    expect(capped).toHaveLength(MIN_BUILD_PHRASES_AFTER_CAP)
    expect(capped.map((p) => p.s)).toEqual([1, 2, 3, 4])
  })
})

// ---------------------------------------------------------------------------
// END-TO-END — the live wiring, not just the shared helper
// ---------------------------------------------------------------------------

/**
 * The assertions above prove the shared selector agrees with the walk. This one
 * proves `generateScript` actually CALLS it: it builds a real `CourseBundle`
 * from each fixture course and checks the debut cycles the generator emits are
 * the walk's selection, in the walk's order. Without this, `generateScript`
 * could quietly go back to DB-position order and every test above would still
 * pass.
 */
describe('generateScript emits the shared selector’s debut, on every cut-over course', () => {
  function bundleFor(code: string): CourseBundle {
    const legos = COURSES[code]
    const bundleLegos: BundleLego[] = []
    const phrases: BundlePhrase[] = []
    const roundMap: BundleRoundMapEntry[] = []

    legos.forEach((lego, i) => {
      const seedNumber = i + 1
      bundleLegos.push({
        legoId: lego.legoId,
        seedNumber,
        legoIndex: 1,
        seedId: `S${String(seedNumber).padStart(4, '0')}`,
        type: 'A',
        // Deliberately not any phrase's text, so the bare-LEGO claim never
        // suppresses one and the comparison stays about ordering.
        knownText: `__lego_${i}__`,
        targetText: `__objectif_${i}__`,
        isNew: true,
        ephemeralAudio: {
          known: { id: `k${i}`, lifecycle: 'ephemeral', durationMs: 1000 },
          target1: { id: `t1_${i}`, lifecycle: 'ephemeral', durationMs: 1000 },
          target2: { id: `t2_${i}`, lifecycle: 'ephemeral', durationMs: 1000 },
        },
      })
      roundMap.push({ roundIndex: i + 1, legoId: lego.legoId, seedNumber })

      const counters = { build: 0, use: 0 }
      for (const p of lego.phrases) {
        counters[p.role] += 1
        const pos = counters[p.role]
        const lifecycle = p.role === 'use' ? 'persistent' : 'ephemeral'
        const phrase: BundlePhrase = {
          phraseId: `${lego.legoId}_${p.role}_${String(pos).padStart(2, '0')}`,
          legoId: lego.legoId,
          position: pos,
          role: p.role,
          knownText: p.knownText,
          // Exactly api/.../bundle.ts's `pickTargets`.
          targetText: p.targetTextRoman ?? p.targetText,
          audio: p.playable
            ? {
                known: { id: `${lego.legoId}_${p.role}_${pos}_k`, lifecycle, durationMs: 1000 },
                target1: { id: `${lego.legoId}_${p.role}_${pos}_1`, lifecycle, durationMs: 1000 },
                target2: { id: `${lego.legoId}_${p.role}_${pos}_2`, lifecycle, durationMs: 1000 },
              }
            : {},
        }
        if (p.targetTextRoman) phrase.targetTextNative = p.targetText
        if (p.targetSyllableCount) phrase.targetSyllableCount = p.targetSyllableCount
        phrases.push(phrase)
      }
    })

    return {
      courseCode: code,
      version: 1,
      contentVersion: 1,
      scriptShape: {
        spacedRepOffsets: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584],
        maxBuildPhrases: MAX_BUILD_PHRASES,
        useConsolidationCount: USE_CONSOLIDATION_COUNT,
        maxSpacedRepPhrases: 12,
        n1PhraseCount: N1_PHRASE_COUNT,
      },
      scriptShapeVersion: 1,
      generatorVersion: 1,
      mainLoopCount: legos.length,
      legos: bundleLegos,
      phrases,
      seeds: [],
      roundMap,
      pods: [],
    }
  }

  for (const code of COURSE_CODES) {
    it(code, () => {
      const bundle = bundleFor(code)
      const { rounds } = generateScript({
        bundle,
        position: { mode: 'main', fromLegoId: bundle.roundMap[0].legoId },
        roundLimit: bundle.roundMap.length,
      })
      expect(rounds.length).toBeGreaterThan(0)

      // Round 1 has no spaced rep to interleave, so its BUILD and USE cycles are
      // the debut selection outright — the cleanest place to compare.
      const first = rounds[0]
      const walk = walkDebutSelection(COURSES[code][0])
      const emitted = (type: 'build' | 'use') =>
        first.cycles.filter((c) => c.type === type).map((c) => c.known.text)
      const expected = (ps: FixturePhrase[]) => ps.map((p) => p.knownText)

      expect(emitted('build'), `${code} round 1 BUILD`).toEqual(expected(walk.build))
      expect(emitted('use'), `${code} round 1 CONSOLIDATE`).toEqual(expected(walk.consolidate))

      // And every later round's BUILD slots too — spaced rep sits between BUILD
      // and CONSOLIDATE, so only the BUILD half is directly comparable there.
      for (let i = 1; i < rounds.length; i++) {
        const round = rounds[i]
        const lego = COURSES[code].find((l) => l.legoId === round.legoId)
        if (!lego) continue
        const w = walkDebutSelection(lego)
        expect(
          round.cycles.filter((c) => c.type === 'build').map((c) => c.known.text),
          `${code} ${round.legoId} BUILD`,
        ).toEqual(w.build.map((p) => p.knownText))
      }
    })
  }

  it('an unplayable phrase never consumes a BUILD slot', () => {
    // The bug this replaces: the generator counted the slot, then emitted
    // nothing because the cycle builder rejected the missing audio, so the round
    // came up short. Find a real LEGO with an unplayable row and enough
    // playable ones to fill behind it.
    let checked = 0
    for (const code of COURSE_CODES) {
      const bundle = bundleFor(code)
      const { rounds } = generateScript({
        bundle,
        position: { mode: 'main', fromLegoId: bundle.roundMap[0].legoId },
        roundLimit: bundle.roundMap.length,
      })
      for (const round of rounds) {
        const lego = COURSES[code].find((l) => l.legoId === round.legoId)
        if (!lego) continue
        if (lego.phrases.every((p) => p.playable)) continue
        const playable = lego.phrases.filter((p) => p.playable)
        const builds = round.cycles.filter((c) => c.type === 'build').length
        expect(builds, `${code} ${lego.legoId}`).toBe(Math.min(MAX_BUILD_PHRASES, playable.length))
        checked++
      }
    }
    // If no fixture course has an unplayable row this assertion proves nothing;
    // say so out loud rather than passing silently.
    expect(checked, 'no fixture LEGO carries an unplayable phrase — regenerate the fixture').toBeGreaterThan(0)
  })
})
