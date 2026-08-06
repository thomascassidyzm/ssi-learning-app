/**
 * The cycles endpoint's script assembly for one LEGO.
 *
 * Covers the two 2026-08-04 fixes at their source:
 *  - `component_intro` cycles are emitted at all (they never were, so ~1189
 *    Italian and ~1105 Spanish authored narration clips had never played).
 *  - intro cycles carry `known_id`, which is what makes the client's
 *    `presentation_id || known_id` fallback reachable instead of dead code.
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

describe('buildLegoCycles — component_intro', () => {
  it('emits one component_intro per introduced component', () => {
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
    const ci = out.filter((c) => c.type === 'component_intro')
    expect(ci).toHaveLength(2)
    expect(ci[0].id).toBe('S0005L02_component_intro_1')
    expect(ci[1].id).toBe('S0005L02_component_intro_2')
    expect(ci[0].audio.presentation_id).toBe('c1-pres')
    expect(ci[0].known_text).toBe('to practise')
    expect(ci[0].target_text).toBe('fare pratica')
  })

  it('orders intro -> component_intro -> debut, matching client TYPE_ORDER', () => {
    const out = buildLegoCycles(lego(), [component(), use({ position: 9 })])
    expect(out.map((c) => c.type)).toEqual([
      'intro',
      'component_intro',
      'debut',
      'use',
    ])
  })

  it('skips visual-only components (introduce=false) — tile, never a cycle', () => {
    const out = buildLegoCycles(lego(), [component({ introduce: false })])
    expect(out.some((c) => c.type === 'component_intro')).toBe(false)
    // Still rendered as a ghost tile via the LEGO's components array.
    expect(out[0].components).toHaveLength(2)
  })

  it('skips an unplayable component rather than emitting a silent hole', () => {
    const noTarget = component({ target1_audio_id: null })
    const noPrompt = component({
      position: 2,
      presentation_audio_id: null,
      known_audio_id: null,
    })
    const out = buildLegoCycles(lego(), [noTarget, noPrompt])
    expect(out.some((c) => c.type === 'component_intro')).toBe(false)
  })

  it('falls back to the known clip when a component has no narration', () => {
    const out = buildLegoCycles(lego(), [component({ presentation_audio_id: null })])
    const ci = out.find((c) => c.type === 'component_intro')!
    expect(ci.audio.presentation_id).toBeUndefined()
    expect(ci.audio.known_id).toBe('c1-known')
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
