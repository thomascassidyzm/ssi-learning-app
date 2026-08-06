/**
 * Easy / Fast learning modes (Aran's ruling 2026-08-06, Turbo retired).
 *
 * The two things worth pinning down here are the two things a regression
 * would be silent about: that FAST is still byte-for-byte the old normal
 * mode, and that EASY really is "double the time, double the reps, longest
 * phrase" rather than merely "different".
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_FAST, DEFAULT_EASY, DEFAULT_SCRIPT_SHAPE } from './useAlgorithmConfig'
import { computePauseDuration } from '../playback/computePauseDuration'

describe('Fast mode is the old normal mode, unchanged', () => {
  it('plays at native speed with no culling and full spaced rep', () => {
    expect(DEFAULT_FAST.playback_speed).toBe(1.0)
    expect(DEFAULT_FAST.spaced_rep_fraction).toBe(1.0)
    expect(DEFAULT_FAST.debut_phrases_fraction).toBe(1.0)
    expect(DEFAULT_FAST.skip_voice2).toBe(false)
  })

  it('carries no script-shape overlay, so it uses the global shape as-is', () => {
    expect(DEFAULT_FAST.script_shape).toBeUndefined()
  })

  it('keeps the shortest-first phrase order', () => {
    // Absent means 'shortest' at every call site.
    expect(DEFAULT_FAST.phrase_length_preference ?? 'shortest').toBe('shortest')
  })

  it('retains the belt taper on long phrases', () => {
    expect(DEFAULT_FAST.pause_belt_assembly).toBe(0.8)
  })
})

describe('Easy mode — double the time', () => {
  // Every pause term is 2x its Fast counterpart.
  it.each([
    'pause_boot_ms',
    'pause_assembly_lin',
    'pause_multiplier',
    'min_pause_ms',
    'max_pause_ms',
  ] as const)('%s is exactly double Fast', (key) => {
    const fast = DEFAULT_FAST[key] as number
    const easy = DEFAULT_EASY[key] as number
    expect(easy).toBeCloseTo(fast * 2, 6)
  })

  it('switches the belt taper OFF so the gap never shrinks with rank', () => {
    // Fast tapers long phrases to 0.8 by Green; Easy holds them at full length.
    expect(DEFAULT_FAST.pause_belt_assembly).toBe(0.8)
    expect(DEFAULT_EASY.pause_belt_assembly).toBe(1.0)
    expect(DEFAULT_EASY.pause_belt_boot).toBe(1.0)
  })

  it('does not slow the voice down — the extra time is thinking time', () => {
    expect(DEFAULT_EASY.playback_speed).toBe(1.0)
  })

  it('gives a genuinely longer real pause across the phrase-length curve', () => {
    // Exercise the actual helper, not just the numbers, at White belt (speed
    // 0.8 is the belt proxy) for a short, medium and long phrase.
    for (const [t1, t2] of [[600, 600], [1500, 1500], [3000, 3000]]) {
      const fast = computePauseDuration(t1, t2, DEFAULT_FAST, 0.8)
      const easy = computePauseDuration(t1, t2, DEFAULT_EASY, 0.8)
      expect(easy).toBeGreaterThan(fast)
      // "Roughly double" — the clamps mean it is not exactly 2x everywhere,
      // but it must never collapse back towards Fast.
      expect(easy / fast).toBeGreaterThan(1.5)
    }
  })
})

describe('Easy mode — double the reps', () => {
  it('doubles every phrase-count knob against the global script shape', () => {
    const overlay = DEFAULT_EASY.script_shape
    expect(overlay).toBeDefined()
    expect(overlay!.maxBuildPhrases).toBe(DEFAULT_SCRIPT_SHAPE.maxBuildPhrases * 2)
    expect(overlay!.useConsolidationCount).toBe(DEFAULT_SCRIPT_SHAPE.useConsolidationCount * 2)
    expect(overlay!.maxSpacedRepPhrases).toBe(DEFAULT_SCRIPT_SHAPE.maxSpacedRepPhrases * 2)
    expect(overlay!.n1PhraseCount).toBe(DEFAULT_SCRIPT_SHAPE.n1PhraseCount * 2)
  })

  it('leaves the Fibonacci ladder alone — that is WHEN, not how many', () => {
    expect(DEFAULT_EASY.script_shape!.spacedRepOffsets).toBeUndefined()
  })
})

describe('Easy mode — longest phrase', () => {
  it('asks the generator for the longest available phrase', () => {
    expect(DEFAULT_EASY.phrase_length_preference).toBe('longest')
  })
})

describe('Turbo is genuinely gone', () => {
  it('neither mode carries the culling knobs', () => {
    for (const cfg of [DEFAULT_FAST, DEFAULT_EASY]) {
      expect((cfg as unknown as Record<string, unknown>).fibKeep).toBeUndefined()
      expect((cfg as unknown as Record<string, unknown>).buildKeep).toBeUndefined()
      expect((cfg as unknown as Record<string, unknown>).useKeep).toBeUndefined()
    }
  })

  it('neither mode thins the learner\'s round', () => {
    // Turbo shipped 0.33 / 0.5 here. Both modes now give the full session.
    for (const cfg of [DEFAULT_FAST, DEFAULT_EASY]) {
      expect(cfg.spaced_rep_fraction).toBe(1.0)
      expect(cfg.debut_phrases_fraction).toBe(1.0)
      expect(cfg.skip_voice2).toBe(false)
    }
  })
})
