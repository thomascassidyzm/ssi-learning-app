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
import { buildBrain, findAbandonedDetours, phraseIdFromCycleId, type PlayRow, type PhraseRow } from './classBrain'

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

  it('reads a phrase id out of a cycle id, and nothing out of an intro', () => {
    expect(phraseIdFromCycleId('S0042L03_use_05_abc', 'fra_for_eng')).toBe('fra_for_eng:S0042L03U05')
    expect(phraseIdFromCycleId('S0042L03_intro', 'fra_for_eng')).toBeNull()
  })
})
