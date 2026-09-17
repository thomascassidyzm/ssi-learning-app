/**
 * Job #128. THE CYCLE ID NAMES THE PHRASE IT PLAYS.
 *
 * The class brain draws the Course journey card from which PHRASE each play
 * was, and the only place that survives the diary is the cycle id. This
 * endpoint used to stamp `S0040L01_build_1`, where the number is the slot the
 * phrase happened to fill in this round — which names nothing, and matched the
 * brain's two-digit read by accident whenever it reached ten. It now carries
 * the phrase's own id: `S0040L01_build_03_build_1`.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { phraseIdFromCycleId } from '../../_utils/classBrain'

beforeAll(() => {
  process.env.SUPABASE_URL ||= 'http://localhost:54321'
})

let buildLegoCycles: (lego: any, phrases: any[], reviews?: any[]) => Record<string, any>[]

beforeAll(async () => {
  ;({ buildLegoCycles } = await import('./cycles'))
})

const lego = {
  seed_number: 40,
  lego_index: 1,
  lego_id: 'S0040L01',
  type: 'A',
  known_text: 'to remember',
  target_text: 'cofio',
  target_text_roman: null,
  components: null,
  is_new: true,
  known_audio_id: 'lego-known',
  target1_audio_id: 'lego-t1',
  target2_audio_id: 'lego-t2',
  presentation_audio_id: 'lego-pres',
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
}

/**
 * A phrase row as the window now serves it — carrying its own id. `n` is the
 * index in that id; `position` is the per-LEGO ordinal, which is NOT the same
 * number and is exactly why the id has to travel.
 */
const phrase = (role: 'build' | 'use', n: number, position: number) => ({
  id: `cym_n_for_eng:S0040L01${role === 'use' ? 'U' : 'B'}${String(n).padStart(2, '0')}`,
  seed_number: 40,
  lego_index: 1,
  position,
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
})

// Indices with a GAP at B02 and U01/U02 — rows deleted since authoring, which
// is the live shape on several courses. Counting rows would name B02 where the
// learner heard B03.
const PHRASES = [
  phrase('build', 1, 1),
  phrase('build', 3, 2),
  phrase('build', 4, 3),
  phrase('use', 3, 4),
  phrase('use', 4, 5),
  phrase('use', 5, 6),
]

describe('a cycle id minted by /cycles names its phrase', () => {
  it('carries the phrase row id, so the brain reads back the phrase that played', () => {
    const cycles = buildLegoCycles(lego, PHRASES)
    const byText = new Map(PHRASES.map((p) => [p.known_text, p.id]))
    const phraseCycles = cycles.filter((c) => c.type === 'build' || c.type === 'use')
    expect(phraseCycles.length).toBeGreaterThan(0)

    for (const c of phraseCycles) {
      const resolved = phraseIdFromCycleId(c.id, 'cym_n_for_eng')
      expect(resolved, `unnamed cycle id: ${c.id}`).not.toBeNull()
      expect(resolved, `wrong phrase named by ${c.id}`).toBe(byText.get(c.known_text))
    }

    // The intro and debut are the chunk itself and name no phrase, as before.
    expect(cycles.find((c) => c.type === 'intro')?.id).toBe('S0040L01_intro')
    expect(cycles.find((c) => c.type === 'debut')?.id).toBe('S0040L01_debut')
  })

  it('falls back to the LEGO alone when a row has no readable id', () => {
    const noIds = PHRASES.map(({ id: _id, ...rest }) => rest)
    const cycles = buildLegoCycles(lego, noIds as any)
    for (const c of cycles.filter((x) => x.type === 'build' || x.type === 'use')) {
      // Unnamed — and the brain resolves it to NOTHING rather than guessing.
      expect(phraseIdFromCycleId(c.id, 'cym_n_for_eng')).toBeNull()
    }
  })
})
