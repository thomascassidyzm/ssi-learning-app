/**
 * The intro-audio contract on the instant-playback path.
 *
 * Three behaviours land here:
 *  1. `component_intro` cycles are REFUSED — components are never introduced
 *     (Tom, 2026-08-06). The 2026-08-04 test asserting they render is
 *     deliberately flipped; this is the render-side backstop for the ruling.
 *  2. The `presentation_id || known_id` fallback is REACHABLE — it used to be
 *     dead code because the endpoint omitted known_id from intro cycles, so a
 *     LEGO with no narration produced an empty prompt URL and silent skip.
 *  3. Both of those report `intro_audio_missing` telemetry, which is the only
 *     reason this class of silence would ever reach the health board.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { toPlayerCycle } from './backendCyclesToRounds'
import {
  setIntroAudioTelemetrySink,
  type IntroAudioMissingEvent,
} from '../playback/introAudioTelemetry'
import type { BackendCycle } from '../composables/useInstantPlayback'

const cycle = (over: Partial<BackendCycle> = {}): BackendCycle => ({
  id: 'S0005L02_intro',
  type: 'intro',
  lego_id: 'S0005L02',
  seed_number: 5,
  known_text: 'to practise speaking',
  target_text: 'fare pratica parlando',
  audio: { target1_id: 't1', target2_id: 't2', presentation_id: 'pres' },
  durations: { target1_ms: 1300, target2_ms: 1300 },
  is_new: true,
  ...over,
})

let reported: IntroAudioMissingEvent[]

beforeEach(() => {
  reported = []
  setIntroAudioTelemetrySink((e) => reported.push(e))
})
afterEach(() => setIntroAudioTelemetrySink(null))

describe('toPlayerCycle — components are never introduced (Tom, 2026-08-06)', () => {
  it('refuses a fully-playable component_intro', () => {
    const c = toPlayerCycle(
      cycle({
        id: 'S0005L02_component_intro_1',
        type: 'component_intro',
        known_text: 'to practise',
        target_text: 'fare pratica',
        audio: { known_id: 'k', target1_id: 't1', target2_id: 't2', presentation_id: 'cpres' },
      }),
    )
    // Every clip it needs exists; it is still dropped. The ruling is about
    // what a component IS, not about whether its audio happens to be complete.
    expect(c).toBeNull()
    // Silent by rule, not by fault — nothing for the health board.
    expect(reported).toHaveLength(0)
  })

  it('refuses a component_intro with no target voices too', () => {
    const c = toPlayerCycle(
      cycle({ type: 'component_intro', audio: { presentation_id: 'cpres' } }),
    )
    expect(c).toBeNull()
  })
})

describe('toPlayerCycle — the intro fallback', () => {
  it('falls back to known audio when the presentation clip is missing', () => {
    const c = toPlayerCycle(
      cycle({ audio: { known_id: 'k', target1_id: 't1', target2_id: 't2' } }),
    )
    // This is the assertion that was impossible before the server started
    // sending known_id on intro cycles: the fallback now actually fires.
    expect(c!.known.audioUrl).toBe('/api/audio/k')
  })

  it('reports known_fallback when it degrades to the known clip', () => {
    toPlayerCycle(cycle({ audio: { known_id: 'k', target1_id: 't1', target2_id: 't2' } }))
    expect(reported).toEqual([
      {
        legoId: 'S0005L02',
        cycleId: 'S0005L02_intro',
        cycleType: 'intro',
        tier: 'known_fallback',
        source: 'backend',
      },
    ])
  })

  it('reports silent when there is no prompt audio at all', () => {
    const c = toPlayerCycle(cycle({ audio: { target1_id: 't1', target2_id: 't2' } }))
    // Still playable (the reveal happens), but the prompt is gone — this is
    // the case that reads to a learner as "the intro never played".
    expect(c!.known.audioUrl).toBe('')
    expect(reported).toHaveLength(1)
    expect(reported[0].tier).toBe('silent')
  })

  it('stays quiet when the presentation clip is present', () => {
    toPlayerCycle(cycle())
    expect(reported).toHaveLength(0)
  })

  it('never reports for non-intro cycles', () => {
    toPlayerCycle(
      cycle({ type: 'build', audio: { known_id: 'k', target1_id: 't1', target2_id: 't2' } }),
    )
    expect(reported).toHaveLength(0)
  })

  it('survives a throwing sink — telemetry never breaks round building', () => {
    setIntroAudioTelemetrySink(() => {
      throw new Error('boom')
    })
    expect(() =>
      toPlayerCycle(cycle({ audio: { known_id: 'k', target1_id: 't1', target2_id: 't2' } })),
    ).not.toThrow()
  })
})
