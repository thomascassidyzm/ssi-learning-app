/**
 * The debut IS the bare LEGO — no later cycle may replay it.
 *
 * WHAT TOM HEARD (2026-08-09, fra_for_eng, dev): the LEGO was introduced, his
 * clone said the phrase, then a female voice said the LEGO's own words twice
 * over, then the phrase again. Telemetry named the cycles:
 *
 *   S0009L01_intro     known  "The French for: 'I speak' ... is:"
 *   S0009L01_debut     known  "I speak"
 *   S0009L01_build_1   known  "I speak"      <- the row under test
 *   S0009L01_build_1_x2 known "I speak"      <- Easy-mode repeat doubles it
 *
 * `S0009L01B01` is a build row whose known and target text are character-for-
 * character its own LEGO's. Both other sequence builders have always claimed
 * the bare LEGO before walking the phrases — `generateLearningScript.ts` and
 * the dashboard's `services/learning-script-generator.cjs` — so the row is
 * skipped there. This endpoint did not, which is why the same LEGO doubled
 * when entered by a skip or cold start and played clean on natural
 * progression: 10 bare-LEGO known plays across the unguarded path in that
 * session, 0 across the guarded one.
 *
 * Tom's ruling: the extra play must not happen at all — do not recolour it.
 */
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(() => {
  process.env.SUPABASE_URL ||= 'http://localhost:54321'
})

type Cycle = Record<string, any>

let buildLegoCycles: (lego: any, phrases: any[]) => Cycle[]
beforeAll(async () => {
  ;({ buildLegoCycles } = await import('./cycles'))
})

/** fra_for_eng S0009L01 — "I speak / je parle". */
const lego = (over: Record<string, unknown> = {}) => ({
  seed_number: 9,
  lego_index: 1,
  lego_id: 'S0009L01',
  type: 'M',
  known_text: 'I speak',
  target_text: 'je parle',
  target_text_roman: null,
  components: null,
  is_new: true,
  known_audio_id: 'lego-known',
  target1_audio_id: 'lego-t1',
  target2_audio_id: 'lego-t2',
  presentation_audio_id: 'lego-pres',
  target1_duration_ms: 1200,
  target2_duration_ms: 1200,
  ...over,
})

const phrase = (over: Record<string, unknown> = {}) => ({
  seed_number: 9,
  lego_index: 1,
  position: 2,
  phrase_role: 'build',
  known_text: 'I speak',
  target_text: 'je parle',
  target_text_roman: null,
  decomposition: null,
  known_audio_id: 'eve-i-speak',
  target1_audio_id: 'p-t1',
  target2_audio_id: 'p-t2',
  target1_duration_ms: 900,
  target2_duration_ms: 900,
  ...over,
})

describe('buildLegoCycles — the bare-LEGO build row', () => {
  it('does not emit a build cycle for the row that repeats its own LEGO', () => {
    const cycles = buildLegoCycles(lego(), [
      phrase(),
      phrase({ position: 5, known_text: 'I speak with you', target_text: 'je parle avec toi' }),
    ])

    const builds = cycles.filter((c) => c.type === 'build')
    expect(builds).toHaveLength(1)
    expect(builds[0].known_text).toBe('I speak with you')
    // The LEGO's own words are spoken by the intro and the debut, and by
    // nothing else.
    expect(cycles.filter((c) => c.known_text === 'I speak').map((c) => c.type)).toEqual([
      'intro',
      'debut',
    ])
  })

  it('does not burn a build ordinal on the skipped row', () => {
    const cycles = buildLegoCycles(lego(), [
      phrase(),
      phrase({ position: 5, known_text: 'I speak with you', target_text: 'je parle avec toi' }),
    ])
    // build_1, not build_2 — a skipped row costs nothing.
    expect(cycles.filter((c) => c.type === 'build').map((c) => c.id)).toEqual(['S0009L01_build_1'])
  })

  it('matches the LEGO through case and punctuation, as the script path does', () => {
    const cycles = buildLegoCycles(lego(), [phrase({ known_text: 'I speak.', target_text: 'Je parle!' })])
    expect(cycles.filter((c) => c.type === 'build')).toHaveLength(0)
  })

  it('skips a USE row that is also just the bare LEGO', () => {
    const cycles = buildLegoCycles(lego(), [phrase({ phrase_role: 'use', position: 7 })])
    expect(cycles.filter((c) => c.type === 'use')).toHaveLength(0)
  })

  it('plays a duplicated phrase row only once', () => {
    const dup = { known_text: 'I speak French', target_text: 'je parle français' }
    const cycles = buildLegoCycles(lego(), [
      phrase({ position: 7, phrase_role: 'use', ...dup }),
      phrase({ position: 8, phrase_role: 'use', ...dup }),
    ])
    expect(cycles.filter((c) => c.type === 'use')).toHaveLength(1)
  })

  it('leaves a LEGO with no bare-LEGO row untouched', () => {
    // fra_for_eng S0009L02 "a little" as Tom heard it play — every build is a
    // real extension, and all of them survive.
    const cycles = buildLegoCycles(
      lego({ lego_index: 2, lego_id: 'S0009L02', known_text: 'a little', target_text: 'un peu' }),
      [
        phrase({ position: 3, known_text: 'to say a little', target_text: 'dire un peu' }),
        phrase({ position: 4, known_text: 'to try a little', target_text: 'essayer un peu' }),
        phrase({ position: 5, known_text: 'I speak a little', target_text: 'je parle un peu' }),
      ]
    )
    expect(cycles.filter((c) => c.type === 'build')).toHaveLength(3)
  })
})
