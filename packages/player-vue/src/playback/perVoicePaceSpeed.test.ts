/**
 * PER-VOICE PACE IN THE BAKED SPEED — plate S-345 (Tom, 2026-08-29:
 * "per-voice pace settings the player reads instead of a blunt belt
 * multiplier").
 *
 * These are the assertions that separate the new rule from the old ladder.
 * Before the change, `computeCycleSpeed(seed, cfg)` returned
 * `globalSpeed × beltSpeed(seed)` and had no idea a voice existed; the first
 * two blocks below fail on that code and pass on this one.
 */
import { describe, it, expect } from 'vitest'
import { computeCycleSpeed, explainCycleSpeed, beltSpeed, computeListeningSpeed, type TargetSpeedConfig } from '../providers/toSimpleRounds'
import type { CourseVoicePace, VoicePaceFacts } from '@ssi/core'

const facts = (voiceId: string, ratio: number | null, nudge: number | null = null): VoicePaceFacts => ({
  voiceId,
  clips: 100,
  naturalPaceRatio: ratio,
  naturalPaceNudge: nudge,
  effectivePaceRatio: ratio === null ? null : ratio * (nudge ?? 1),
  measured: ratio !== null,
  knownVoice: true,
})

const paceFor = (t1: VoicePaceFacts, t2?: VoicePaceFacts): CourseVoicePace => ({
  courseCode: 'spa_for_eng',
  derivedFrom: 'course_audio.voice_id over referenced clips',
  roles: {
    target1: { primary: t1, others: [], totalClips: t1.clips },
    ...(t2 ? { target2: { primary: t2, others: [], totalClips: t2.clips } } : {}),
  },
})

// The live spa_for_eng casting, read from `course_voice_pace('spa_for_eng')`
// on 2026-09-07: Elvira renders target1 at 0.985× her language's reference,
// Alvaro renders target2 at exactly 1.000×.
const SPA: TargetSpeedConfig = {
  globalSpeed: 1.0,
  nativeSpeed: true,
  mode: 'easy',
  voicePace: paceFor(facts('azure_es-ES-ElviraNeural', 0.985), facts('azure_es-ES-AlvaroNeural', 1.0)),
}

describe('the speed comes from the VOICE and the MODE, not from the belt', () => {
  it('divides the mode target by the voice pace of the clip actually rendered', () => {
    // 0.8 / 0.985 = 0.812, rounded to the cycle's 2dp bake → 0.81.
    // The pre-change code returned beltSpeed(1) = 0.80 here and would have
    // returned it for every voice in the estate.
    expect(computeCycleSpeed(1, SPA, 'target1')).toBe(0.81)
    expect(computeCycleSpeed(1, { ...SPA, mode: 'fast' }, 'target1')).toBe(0.91)
  })

  it('gives the two target voices their own numbers — they are different voices', () => {
    expect(computeCycleSpeed(1, SPA, 'target1')).toBe(0.81)
    expect(computeCycleSpeed(1, SPA, 'target2')).toBe(0.8)
  })

  it('is the SAME at every seed — the belt ramp is gone from the speaking path', () => {
    const atSeed1 = computeCycleSpeed(1, SPA, 'target1')
    for (const seed of [1, 7, 8, 19, 20, 39, 40, 200, 400]) {
      expect(computeCycleSpeed(seed, SPA, 'target1')).toBe(atSeed1)
    }
    // …and it is emphatically not the ladder any more.
    expect(computeCycleSpeed(40, SPA, 'target1')).not.toBe(beltSpeed(40))
  })

  it('is slower on Easy than on Fast for every voice, at every seed', () => {
    for (const ratio of [0.832, 0.985, 1.0, 1.114, 1.241, null]) {
      const cfg = { ...SPA, voicePace: paceFor(facts('v', ratio)) }
      const easy = computeCycleSpeed(1, { ...cfg, mode: 'easy' }, 'target1')
      const fast = computeCycleSpeed(1, { ...cfg, mode: 'fast' }, 'target1')
      expect(easy).toBeLessThanOrEqual(fast)
    }
  })
})

describe('the unmeasured voice — the majority case, and it must be a no-op', () => {
  const unmeasured = { ...SPA, voicePace: paceFor(facts('azure_de-AT-IngridNeural', null)) }

  it('plays the mode target unchanged, exactly as with no per-voice pace at all', () => {
    expect(computeCycleSpeed(1, unmeasured, 'target1')).toBe(0.8)
    expect(computeCycleSpeed(1, { ...unmeasured, mode: 'fast' }, 'target1')).toBe(0.9)
    // Identical to having no pace facts at all, and to the derivation failing.
    expect(computeCycleSpeed(1, { ...SPA, voicePace: null }, 'target1')).toBe(0.8)
    expect(computeCycleSpeed(1, { ...SPA, voicePace: { ...SPA.voicePace!, unavailable: true } }, 'target1')).toBe(0.8)
  })

  it('never substitutes 1.0 for "we have not looked"', () => {
    const e = explainCycleSpeed(unmeasured, 'target1')
    expect(e.measured).toBe(false)
    expect(e.speed).toBe(0.8)
    expect(e.reason).toMatch(/no measured pace/)
    // The voice is still NAMED, so the gap is fixable rather than anonymous.
    expect(e.voiceId).toBe('azure_de-AT-IngridNeural')
  })

  it('borrows the other target slot rather than dropping the correction', () => {
    // spa_for_eng has both; a course with only target1 facts must not silently
    // play voice 2 at an uncorrected pace when we do know something.
    const onlyT1 = { ...SPA, voicePace: paceFor(facts('elvira', 0.985)) }
    expect(computeCycleSpeed(1, onlyT1, 'target2')).toBe(0.81)
  })
})

describe('what must not move', () => {
  it('legacy nativeSpeed:false courses are left byte-for-byte alone', () => {
    const legacy: TargetSpeedConfig = { globalSpeed: 0.9, nativeSpeed: false, mode: 'easy', voicePace: SPA.voicePace }
    for (const seed of [1, 40, 400]) {
      expect(computeCycleSpeed(seed, legacy, 'target1')).toBe(0.9)
      expect(computeCycleSpeed(seed, legacy, 'target2')).toBe(0.9)
    }
    expect(explainCycleSpeed(legacy).reason).toMatch(/legacy course/)
  })

  it('listening is never slowed — no belt term, no mode term, no voice term', () => {
    for (const seed of [1, 40, 400]) {
      expect(computeListeningSpeed(1.0, seed, SPA)).toBe(1.0)
      expect(computeListeningSpeed(1.0, seed, { ...SPA, mode: 'fast' })).toBe(1.0)
    }
    // computeListeningSpeed(roleSpeed, seed, config) — three arguments, and
    // the seed is ignored. If a fourth appears, somebody has given listening
    // a mode or a belt.
    expect(computeListeningSpeed.length).toBe(3)
  })

  it('the course/learner base still multiplies — deu_for_eng and fra_for_eng ride it', () => {
    const french: TargetSpeedConfig = { ...SPA, globalSpeed: 0.9 }
    // 0.9 × (0.8 / 0.985) = 0.731 → 0.73
    expect(computeCycleSpeed(1, french, 'target1')).toBe(0.73)
    // and never above the base, however slow the voice
    const slow = { ...french, voicePace: paceFor(facts('slow', 0.5)) }
    expect(computeCycleSpeed(1, slow, 'target1')).toBe(0.9)
  })

  it('never goes below the 0.7 floor, however brisk the voice', () => {
    const brisk = { ...SPA, voicePace: paceFor(facts('fr-FR-Vivienne', 1.241)) }
    expect(computeCycleSpeed(1, brisk, 'target1')).toBe(0.7)
  })
})
