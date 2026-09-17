/**
 * The brain's two substantive rules, on their own.
 *
 *  1. NEW PHRASES vs PRACTISED. A chunk is NEW once — the cycle that first
 *     introduced it. Every hearing after that is PRACTICE and must not inflate
 *     the new count. Tom's ruling, 2026-09-17: "capture the distinction between
 *     a new item being introduced and a phrase being practiced".
 *  2. The abandoned detour. A chunk the class was promptly skipped BACK from
 *     was never introduced, so it lights nothing and counts in nothing.
 */
import { describe, it, expect } from 'vitest'
import { buildBrain, chooseAxis, findAbandonedDetours, phraseIdFromCycleId, AXIS_LEADIN, AXIS_HEADROOM, AXIS_MIN, type PlayRow, type PhraseRow } from './classBrain'

const COURSE = 'cym_s_for_eng'
const LEGOS = [
  { id: 'S0001L01', seed: 1 },
  { id: 'S0001L02', seed: 1 },
  { id: 'S0002L01', seed: 2 },
  { id: 'S0009L01', seed: 9 },
]
const ordinalOf = new Map(LEGOS.map((l, i) => [l.id, i]))
const seedOf = new Map(LEGOS.map((l) => [l.id, l.seed]))

const phrases = new Map<string, PhraseRow>([
  [`${COURSE}:S0002L01B01`, {
    id: `${COURSE}:S0002L01B01`,
    target_text: 'dw i eisiau dysgu',
    known_text: 'I want to learn',
    phrase_role: 'build',
    position: 1,
    lego_id: 'S0002L01',
    decomposition: [{ legoId: 'S0001L01' }, { legoId: 'S0002L01' }],
  }],
])

let clock = Date.parse('2026-09-16T09:00:00.000Z')
const at = (offsetMs = 0): string => new Date((clock += offsetMs)).toISOString()

function play(legoId: string, cycleId: string, role: 'target1' | 'target2', offsetMs = 4000): PlayRow {
  return { event_type: 'audio_play', occurred_at: at(offsetMs), role, lego_id: legoId, cycle_id: cycleId }
}
/** One whole cycle: the target in voice A then voice B. */
function cycle(legoId: string, cycleId: string, offsetMs = 4000): PlayRow[] {
  return [play(legoId, cycleId, 'target1', offsetMs), play(legoId, cycleId, 'target2', 2000)]
}

describe('the class brain', () => {
  it('counts a chunk as NEW once, however many times it is then practised', () => {
    clock = Date.parse('2026-09-16T09:00:00.000Z')
    const rows = [
      ...cycle('S0001L01', 'S0001L01_intro'),
      ...cycle('S0001L01', 'S0001L01_debut'),
      ...cycle('S0002L01', 'S0002L01_intro'),
      ...cycle('S0002L01', 'S0002L01_build_01_a'),
      ...cycle('S0002L01', 'S0002L01_build_01_a'),
      ...cycle('S0002L01', 'S0002L01_build_01_a'),
      // A later lesson replays the first chunk's introduction. It is NOT new
      // again: the class has met it. This is the whole distinction.
      ...cycle('S0001L01', 'S0001L01_intro', 90_000),
    ]
    const brain = buildBrain({ courseCode: COURSE, rows, skips: [], ordinalOf, seedOf, phrases })

    // NEW PHRASES: two chunks were introduced, and only two, though six cycles played.
    expect(brain.introducedCount).toBe(2)
    // PRACTISED: every cycle, and both voices of each, are hearings.
    expect(brain.tally.total).toBe(7)
    expect(brain.tally.hearings).toBe(14)
    expect(brain.distinctPhrases).toBe(1)
    // The build phrase fires BOTH its chunks, so an arc joins them.
    const build = brain.events.filter((e) => e.kind === 'build')
    expect(build).toHaveLength(3)
    expect(build[0].fires.sort()).toEqual([0, 2])
  })

  it('a chunk the class was skipped straight back off was never introduced', () => {
    clock = Date.parse('2026-09-16T10:00:00.000Z')
    const settled = cycle('S0001L01', 'S0001L01_intro')
    const detour = cycle('S0009L01', 'S0009L01_intro', 5000)
    const skipAt = at(6000)
    const rows = [...settled, ...detour]
    const skips = [{ occurred_at: skipAt, event_type: 'belt_skip', target_seed: 1 }]

    const withSkip = buildBrain({ courseCode: COURSE, rows, skips, ordinalOf, seedOf, phrases })
    const without = buildBrain({ courseCode: COURSE, rows, skips: [], ordinalOf, seedOf, phrases })

    expect(without.introducedCount).toBe(2)
    expect(withSkip.introducedCount).toBe(1)
    expect(withSkip.tally.detoured).toBe(1)
    expect(withSkip.events.some((e) => e.lego === 3)).toBe(false)
  })

  it('a run the class stuck with for longer than the cap is real practice, kept lit', () => {
    clock = Date.parse('2026-09-16T11:00:00.000Z')
    const settled = cycle('S0001L01', 'S0001L01_intro')
    // Two minutes of real work on seed 9 before the skip back — over the 90s cap.
    const stayed = [...cycle('S0009L01', 'S0009L01_intro', 5000), ...cycle('S0009L01', 'S0009L01_debut', 50_000)]
    const skipAt = at(50_000)
    const brain = buildBrain({
      courseCode: COURSE,
      rows: [...settled, ...stayed],
      skips: [{ occurred_at: skipAt, event_type: 'belt_skip', target_seed: 1 }],
      ordinalOf, seedOf, phrases,
    })
    expect(brain.tally.detoured).toBe(0)
    expect(brain.introducedCount).toBe(2)
  })

  it('a clip that never sounded is not a hearing', () => {
    clock = Date.parse('2026-09-16T12:00:00.000Z')
    const rows = cycle('S0001L01', 'S0001L01_intro')
    rows.push({ event_type: 'audio_failed', occurred_at: rows[1].occurred_at, role: 'target2', lego_id: 'S0001L01', cycle_id: 'S0001L01_intro' })
    const brain = buildBrain({ courseCode: COURSE, rows, skips: [], ordinalOf, seedOf, phrases })
    expect(brain.tally.hearings).toBe(1)
  })

  it('derives a lego_skip destination from the next play, since the player never logs one', () => {
    clock = Date.parse('2026-09-16T13:00:00.000Z')
    const detour = cycle('S0009L01', 'S0009L01_intro')
    const skipAt = at(5000)
    const back = cycle('S0001L01', 'S0001L01_intro', 3000)
    const brain = buildBrain({
      courseCode: COURSE,
      rows: [...detour, ...back],
      skips: [{ occurred_at: skipAt, event_type: 'lego_skip', target_seed: null }],
      ordinalOf, seedOf, phrases,
    })
    expect(brain.tally.detoured).toBe(1)
    expect(brain.introducedCount).toBe(1)
  })

  it('a jump with no derivable destination is ignored rather than guessed', () => {
    const plays = [{ occurred_at: '2026-09-16T09:00:00.000Z', lego_id: 'S0009L01' }]
    expect(findAbandonedDetours(plays, [{ occurred_at: '2026-09-16T09:00:10.000Z', target_seed: null }], (id) => seedOf.get(id)).size).toBe(0)
  })

  /**
   * THE AUDIT, 2026-09-17. Tom on his phone: "these phrase numbers look
   * suspicious, statistically unlikely that they are so symmetrical" — the ZZ
   * Test — Year 7 Welsh class read New phrases 8, Practised 28 phrases, 8 lit
   * chunks and a cursor at the 8th LEGO of 679. Every one of those was
   * recomputed straight off player_events in plain SQL and every one held.
   *
   * The three 8s are not a coincidence AND not a bug: they are three views of
   * the SAME eight chunks, because that class started at seed 1 and skipped
   * nothing, so each chunk it met it met through its own intro cycle. The two
   * tests below pin both halves of that — the agreement when the class starts
   * at the start, and the fact that it is NOT true by construction.
   */
  it('AUDIT: starting at the start, new phrases and lit chunks are the same chunks', () => {
    clock = Date.parse('2026-09-16T14:00:00.000Z')
    const rows = [
      ...cycle('S0001L01', 'S0001L01_intro'),
      ...cycle('S0001L01', 'S0001L01_debut'),
      ...cycle('S0002L01', 'S0002L01_intro'),
      ...cycle('S0002L01', 'S0002L01_debut'),
      ...cycle('S0002L01', 'S0002L01_build_01_a'),
    ]
    const brain = buildBrain({ courseCode: COURSE, rows, skips: [], ordinalOf, seedOf, phrases })
    const lit = new Set(brain.events.flatMap((e) => e.fires))
    expect(brain.introducedCount).toBe(2)
    expect(lit.size).toBe(2)
    // And hearings are exactly twice the counted cycles when every clip sounds
    // — the live class's 154 against 77, which is what that ratio was.
    expect(brain.tally.hearings).toBe(brain.tally.total * 2)
  })

  it('AUDIT: joining mid-course lights chunks the class was never introduced to', () => {
    clock = Date.parse('2026-09-16T15:00:00.000Z')
    // Nothing but a build phrase, which fires BOTH its chunks. No intro cycle
    // played at all, so nothing is new — but two chunks light.
    const rows = cycle('S0002L01', 'S0002L01_build_01_a')
    const brain = buildBrain({ courseCode: COURSE, rows, skips: [], ordinalOf, seedOf, phrases })
    const lit = new Set(brain.events.flatMap((e) => e.fires))
    expect(brain.introducedCount).toBe(0)
    expect(lit.size).toBe(2)
    expect(brain.distinctPhrases).toBe(1)
  })

  it('reads a phrase id out of a cycle id, and nothing out of an intro', () => {
    expect(phraseIdFromCycleId('S0042L03_use_05_abc', 'fra_for_eng')).toBe('fra_for_eng:S0042L03U05')
    expect(phraseIdFromCycleId('S0042L03_use_05', 'fra_for_eng')).toBe('fra_for_eng:S0042L03U05')
    expect(phraseIdFromCycleId('S0042L03_intro', 'fra_for_eng')).toBeNull()
  })

  /**
   * Job #128. The walk used to stamp a BARE SCRIPT COUNTER after `_build_`,
   * and the parser read its first two digits as a phrase index — so
   * `_build_11827` named BUILD 11, a phrase the class may never have heard.
   * An unindexed id must resolve to NOTHING rather than to the wrong sentence.
   */
  it('refuses a bare script counter rather than naming the wrong phrase', () => {
    expect(phraseIdFromCycleId('S0001L01_build_12345', 'fra_for_eng')).toBeNull()
    expect(phraseIdFromCycleId('S0001L01_build_1', 'fra_for_eng')).toBeNull()
    expect(phraseIdFromCycleId('S0274L01_spaced_rep_11838', 'fra_for_eng')).toBeNull()
    // …while the indexed forms the player now stamps still resolve.
    expect(phraseIdFromCycleId('S0001L01_build_03_build_12345', 'fra_for_eng')).toBe('fra_for_eng:S0001L01B03')
    expect(phraseIdFromCycleId('S0001L01_use_02_review_9', 'fra_for_eng')).toBe('fra_for_eng:S0001L01U02')
  })

  /** The drained-seed sandwich plays the whole sentence — a kind, not a blank. */
  it('names the seed sandwich as its own kind', () => {
    clock = Date.parse('2026-09-16T09:00:00.000Z')
    const rows = cycle('S0002L01', 'S0002L01_seed_rep_11813')
    const brain = buildBrain({ courseCode: COURSE, rows, skips: [], ordinalOf, seedOf, phrases })
    expect(brain.events[0].kind).toBe('seed_rep')
    expect(buildBrain({ courseCode: COURSE, rows: cycle('S0002L01', 'S0002L01_seedrep'), skips: [], ordinalOf, seedOf, phrases }).events[0].kind).toBe('seed_rep')
  })
})

/**
 * Job #126. A class that did some of the course last year does not start at
 * chunk 1, and the fold compresses by AGE rather than by whether a chunk was
 * ever met — so an axis that always started at chunk 0 spent most of the card
 * on untouched grey. The axis anchors on first light.
 */
describe('chooseAxis', () => {
  const ev = (...fires: number[]): { fires: number[] } => ({ fires })

  it('anchors on the first lit chunk, not on chunk 0', () => {
    // A class resuming at chunk 150 and playing 24 chunks this term.
    const { axisFrom, axisTo, reachOrd } = chooseAxis(1000, [ev(150), ev(160, 155), ev(173)], 2000)
    expect(reachOrd).toBe(173)
    expect(axisFrom).toBe(150 - AXIS_LEADIN)
    expect(axisTo).toBe(173 + 1 + AXIS_HEADROOM)
    // The whole drawn axis is the class's own stretch plus a few chunks of
    // context, not 150 chunks of never-met course.
    expect(axisTo - axisFrom).toBe(24 + AXIS_LEADIN + AXIS_HEADROOM)
  })

  it('still starts at chunk 0 for a class that started at the beginning', () => {
    const { axisFrom, axisTo } = chooseAxis(1000, [ev(0), ev(40, 2), ev(90)], 2000)
    expect(axisFrom).toBe(0)
    expect(axisTo).toBe(94)
  })

  it('keeps a minimum axis for a class one sitting in, wherever it started', () => {
    const { axisFrom, axisTo } = chooseAxis(1000, [ev(400), ev(402)], 2000)
    expect(axisTo - axisFrom).toBeGreaterThanOrEqual(AXIS_MIN)
    expect(axisFrom).toBeLessThanOrEqual(400 - AXIS_LEADIN)
  })

  it('has nothing to anchor on when the class has played nothing', () => {
    const { axisFrom, axisTo, reachOrd } = chooseAxis(1000, [], 2000)
    expect(reachOrd).toBe(-1)
    expect(axisFrom).toBe(0)
    expect(axisTo).toBe(AXIS_MIN)
  })

  it('gives way at the oldest end when the axis would exceed the ceiling', () => {
    const { axisFrom, axisTo } = chooseAxis(5000, [ev(0), ev(3000)], 2000)
    expect(axisTo).toBe(3004)
    expect(axisTo - axisFrom).toBe(2000)
  })
})
