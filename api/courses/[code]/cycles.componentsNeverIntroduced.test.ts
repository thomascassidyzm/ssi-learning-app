/**
 * The cycles endpoint's script assembly for one LEGO.
 *
 * THE RULING (Tom, 2026-08-06): "Components do NOT get introduced."
 * Only LEGOs get introductions. Between 2026-08-04 (9e9a19bf) and
 * 2026-08-06 this endpoint emitted one `component_intro` per component,
 * narrating each tiling piece as its own introduction; these tests asserted
 * that behaviour and are deliberately flipped to assert its absence.
 *
 * Also covers the surviving 2026-08-04 fix: intro cycles carry `known_id`,
 * which makes the client's `presentation_id || known_id` fallback reachable
 * instead of dead code.
 */
import { describe, it, expect, beforeAll } from 'vitest'

// The module validates env at import time (it builds a Supabase client for the
// handler). Only the pure assembly function is under test here.
beforeAll(() => {
  process.env.SUPABASE_URL ||= 'http://localhost:54321'
})

type Cycle = Record<string, any>

let buildLegoCycles: (lego: any, phrases: any[]) => Cycle[]
beforeAll(async () => {
  ;({ buildLegoCycles } = await import('./cycles'))
})

const lego = (over: Record<string, unknown> = {}) => ({
  seed_number: 5,
  lego_index: 2,
  lego_id: 'S0005L02',
  type: 'M',
  known_text: 'to practise speaking',
  target_text: 'fare pratica parlando',
  target_text_roman: null,
  components: [
    { known: 'to practise', target: 'fare pratica' },
    { known: 'speaking', target: 'parlando' },
  ],
  is_new: true,
  known_audio_id: 'lego-known',
  target1_audio_id: 'lego-t1',
  target2_audio_id: 'lego-t2',
  presentation_audio_id: 'lego-pres',
  target1_duration_ms: 1300,
  target2_duration_ms: 1300,
  ...over,
})

const component = (over: Record<string, unknown> = {}) => ({
  seed_number: 5,
  lego_index: 2,
  position: 1,
  phrase_role: 'component',
  known_text: 'to practise',
  target_text: 'fare pratica',
  target_text_roman: null,
  decomposition: null,
  known_audio_id: 'c1-known',
  target1_audio_id: 'c1-t1',
  target2_audio_id: 'c1-t2',
  presentation_audio_id: 'c1-pres',
  introduce: true,
  target1_duration_ms: 900,
  target2_duration_ms: 900,
  ...over,
})

const use = (over: Record<string, unknown> = {}) => ({
  ...component({ phrase_role: 'use', presentation_audio_id: null }),
  known_text: 'I want to practise speaking Italian',
  target_text: 'voglio fare pratica parlando italiano',
  ...over,
})

describe('buildLegoCycles — components are never introduced (Tom, 2026-08-06)', () => {
  it('emits no component_intro, however complete the component audio is', () => {
    const out = buildLegoCycles(lego(), [
      component({ position: 1 }),
      component({
        position: 2,
        known_text: 'speaking',
        target_text: 'parlando',
        presentation_audio_id: 'c2-pres',
        known_audio_id: 'c2-known',
        target1_audio_id: 'c2-t1',
        target2_audio_id: 'c2-t2',
      }),
    ])
    expect(out.some((c) => c.type === 'component_intro')).toBe(false)
  })

  it('orders intro -> debut with nothing between them', () => {
    const out = buildLegoCycles(lego(), [component(), use({ position: 9 })])
    expect(out.map((c) => c.type)).toEqual(['intro', 'debut', 'use'])
  })

  it('introduce=true is NOT a licence to introduce — still no cycle', () => {
    // The `introduce` flag was the old escape hatch. Tom's ruling is
    // unconditional: components are never introduced, either value.
    for (const introduce of [true, false]) {
      const out = buildLegoCycles(lego(), [component({ introduce })])
      expect(out.some((c) => c.type === 'component_intro')).toBe(false)
      // Still rendered as a ghost tile via the LEGO's components array.
      expect(out[0].components).toHaveLength(2)
    }
  })

  it('a component with its own narration clip is silent, not played', () => {
    const out = buildLegoCycles(lego(), [component({ presentation_audio_id: 'c1-pres' })])
    expect(out.map((c) => c.type)).toEqual(['intro', 'debut'])
  })

  it('never treats component rows as build or use phrases', () => {
    const out = buildLegoCycles(lego(), [component()])
    expect(out.some((c) => c.type === 'build' || c.type === 'use')).toBe(false)
  })

  it('A-LEGOs with no components emit the plain intro -> debut shape', () => {
    const out = buildLegoCycles(lego({ type: 'A', components: null }), [])
    expect(out.map((c) => c.type)).toEqual(['intro', 'debut'])
  })
})

describe('buildLegoCycles — intro known_id fallback (item 3)', () => {
  it('carries known_id on the intro so the client fallback is reachable', () => {
    const intro = buildLegoCycles(lego(), [])[0]
    expect(intro.type).toBe('intro')
    expect(intro.audio.known_id).toBe('lego-known')
  })

  it('presentation still wins as the prompt when both are present', () => {
    const intro = buildLegoCycles(lego(), [])[0]
    // Both are on the wire; the CLIENT picks presentation first. Carrying
    // known_id must not be read as "play two clips".
    expect(intro.audio.presentation_id).toBe('lego-pres')
    expect(intro.audio.known_id).toBe('lego-known')
  })

  it('a LEGO with no presentation audio still has an audible prompt', () => {
    const intro = buildLegoCycles(lego({ presentation_audio_id: null }), [])[0]
    expect(intro.audio.presentation_id).toBeUndefined()
    expect(intro.audio.known_id).toBe('lego-known')
  })
})
