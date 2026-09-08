/**
 * The TS port of the per-voice pace rule, asserted against the SHARED CASE
 * TABLE — `__fixtures__/voice-pace-cases.json`.
 *
 * The point of the fixture is that it is not this file's property. The
 * dashboard's `services/shared/voice-pace.cjs` is the original implementation
 * of the same rule and must be asserted against the same rows; as of
 * 2026-09-07 it has its own tests but no mirror against this fixture, and
 * writing that is the open half of the pairing.
 */
import { describe, it, expect } from 'vitest'
import cases from './__fixtures__/voice-pace-cases.json'
import {
  playbackSpeedForVoice, targetPace, effectivePaceRatio, paceMultiplier,
  voicePaceForSlot, MIN_SPEED, MAX_SPEED, type CourseVoicePace,
} from './voicePace'

describe('the shared case table', () => {
  it('agrees with the module about the clamp bounds', () => {
    expect(MIN_SPEED).toBe(cases.minSpeed)
    expect(MAX_SPEED).toBe(cases.maxSpeed)
  })

  for (const c of cases.cases) {
    it(c.name, () => {
      const r = playbackSpeedForVoice(c.voice as never, c.role, c.mode)
      expect(r.speed).toBe(c.expected.speed)
      expect(r.corrected).toBe(c.expected.corrected)
      expect(r.clamped).toBe(c.expected.clamped)
      if ('role' in c.expected) expect(r.role).toBe((c.expected as { role: string | null }).role)
    })
  }
})

describe('null is an absence, never 1.0', () => {
  it('reports no ratio for a voice that has never been measured', () => {
    expect(effectivePaceRatio(null)).toBeNull()
    expect(effectivePaceRatio({})).toBeNull()
    expect(effectivePaceRatio({ natural_pace_ratio: null })).toBeNull()
    expect(effectivePaceRatio({ natural_pace_ratio: 0 })).toBeNull()
  })

  it('an unmeasured voice plays at exactly the number it would with no per-voice pace at all', () => {
    for (const mode of ['easy', 'fast'] as const) {
      const withNothing = targetPace('target', mode).targetPace
      expect(playbackSpeedForVoice(null, 'target', mode).speed).toBe(withNothing)
      expect(paceMultiplier({ paceRatio: null, targetPace: withNothing }).speed).toBe(withNothing)
    }
  })

  it('says so in words, so the reason survives into a log line', () => {
    expect(playbackSpeedForVoice(null, 'target', 'easy').reason).toMatch(/no measured pace/)
  })
})

describe('the rule takes no belt and no seed', () => {
  it('has no parameter that could carry one', () => {
    // targetPace(role, mode). If a third argument ever appears here, somebody
    // has put the ladder back.
    expect(targetPace.length).toBe(2)
    expect(playbackSpeedForVoice.length).toBe(3)
  })

  it('is slower on Easy than on Fast for every voice, so 2026-08-07 cannot recur', () => {
    for (const ratio of [0.832, 0.985, 1.0, 1.114, 1.241, null]) {
      const easy = playbackSpeedForVoice({ natural_pace_ratio: ratio }, 'target', 'easy').speed
      const fast = playbackSpeedForVoice({ natural_pace_ratio: ratio }, 'target', 'fast').speed
      expect(easy).toBeLessThanOrEqual(fast)
    }
  })
})

describe('voicePaceForSlot', () => {
  const pace: CourseVoicePace = {
    courseCode: 'spa_for_eng',
    derivedFrom: 'course_audio.voice_id over referenced clips',
    roles: {
      target1: { primary: { voiceId: 'a', clips: 10, naturalPaceRatio: 0.985, naturalPaceNudge: null, effectivePaceRatio: 0.985, measured: true, knownVoice: true }, others: [], totalClips: 10 },
    },
  }

  it('hands back the primary voice for a slot it has', () => {
    expect(voicePaceForSlot(pace, 'target1')?.voiceId).toBe('a')
  })

  it('falls back to the other target slot rather than to no correction at all', () => {
    expect(voicePaceForSlot(pace, 'target2')?.voiceId).toBe('a')
  })

  it('hands back nothing when the derivation was unavailable — never a stand-in number', () => {
    expect(voicePaceForSlot({ ...pace, unavailable: true }, 'target1')).toBeNull()
    expect(voicePaceForSlot(null, 'target1')).toBeNull()
  })

  it('does not invent a known-language pace out of a target one', () => {
    expect(voicePaceForSlot(pace, 'known')).toBeNull()
  })
})
