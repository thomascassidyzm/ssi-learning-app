// ============================================================================
// vad-prosody.test.ts — the server-side fold behind the Voice & pause board's
// prosody panel.
//
// The property that matters: every mean must carry the base it was actually
// taken over. An event that omits a field must shrink that field's base, never
// count as a zero — the same honesty rule the board's uptake number enforces
// one level up.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { foldProsody } from './vad-prosody'

const ev = (userId: string, over: Record<string, unknown> = {}) => ({
  user_id: userId,
  peakEnergyDb: '-14.4',
  averageEnergyDb: '-60.5',
  startedDuringPrompt: 'false',
  stillSpeakingAtVoice1: 'false',
  peakCount: '10',
  ...over,
})

describe('foldProsody', () => {
  it('folds PostgREST string projections into per-learner numeric sums', () => {
    const out = foldProsody([ev('L1', { peakEnergyDb: '-10' }), ev('L1', { peakEnergyDb: '-20' })])
    expect(out.L1.events).toBe(2)
    expect(out.L1.peakEnergyDbSum).toBe(-30)
    expect(out.L1.peakEnergyDbBase).toBe(2)
    expect(out.L1.peakCountSum).toBe(20)
  })

  it('keeps learners separate', () => {
    const out = foldProsody([ev('L1'), ev('L2'), ev('L2')])
    expect(out.L1.events).toBe(1)
    expect(out.L2.events).toBe(2)
  })

  it('shrinks the base for a missing field rather than counting it as zero', () => {
    const out = foldProsody([
      ev('L1', { peakEnergyDb: '-10' }),
      ev('L1', { peakEnergyDb: null }),
    ])
    expect(out.L1.events).toBe(2)
    expect(out.L1.peakEnergyDbSum).toBe(-10)
    expect(out.L1.peakEnergyDbBase).toBe(1)     // NOT 2 with a phantom 0
  })

  it('reads the boolean flags in both JSON and string form, and skips nulls', () => {
    const out = foldProsody([
      ev('L1', { startedDuringPrompt: true, stillSpeakingAtVoice1: 'true' }),
      ev('L1', { startedDuringPrompt: 'false', stillSpeakingAtVoice1: false }),
      ev('L1', { startedDuringPrompt: null, stillSpeakingAtVoice1: undefined }),
    ])
    expect(out.L1.startedDuringPrompt).toBe(1)
    expect(out.L1.startedDuringPromptBase).toBe(2)
    expect(out.L1.stillSpeakingAtVoice1).toBe(1)
    expect(out.L1.stillSpeakingAtVoice1Base).toBe(2)
  })

  it('discards rows with no learner id rather than bucketing them under "null"', () => {
    const out = foldProsody([ev('L1'), { user_id: null } as Record<string, unknown>])
    expect(Object.keys(out)).toEqual(['L1'])
  })

  it('returns an empty map for no events', () => {
    expect(foldProsody([])).toEqual({})
  })
})
