import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeCycleSpeed, computeListeningSpeed, type TargetSpeedConfig } from '../providers/toSimpleRounds'
import { DEFAULT_EASY, DEFAULT_FAST } from '../composables/useAlgorithmConfig'

// REGRESSION (Tom's ruling, 2026-08-07): "Easy should follow the exact speed
// pattern on-ramps for the target language as Fast — but just with bigger
// pauses, more repetitions and so on as they currently are."
//
// Easy used to own a play-time hook (`getPlaybackSpeedMultiplier`) that
// CANCELLED the baked belt ramp and played the target voice flat at 1.0×. Fast
// kept the ramp. Net effect: a White-belt beginner on EASY heard speech at 1.0×
// while the same beginner on FAST heard 0.8× — the gentle mode was the faster
// one, backwards from what the names promise.
//
// The fix is a deletion, not a fork: the hook is gone from
// SimplePlayerRuntimeOverrides and from LearningPlayer's overrides object, so
// BOTH modes read the one baked `cycle.playbackSpeed`. These tests pin that
// there is no second speed path to drift.

const NATIVE_COURSE: TargetSpeedConfig = { globalSpeed: 1.0, nativeSpeed: true }
const FRENCH_COURSE: TargetSpeedConfig = { globalSpeed: 0.95, nativeSpeed: true }
const LEGACY_COURSE: TargetSpeedConfig = { globalSpeed: 0.9, nativeSpeed: false }

// (Builder-side coverage — that BOTH round-builders actually bake this curve —
// lives in speedRampSync.test.ts and is deliberately not duplicated here.)

const src = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')

describe('Easy and Fast share ONE target-voice speed ramp', () => {
  it('no mode speed hook survives anywhere in the playback path', () => {
    const simplePlayer = src('./SimplePlayer.ts')
    const learningPlayer = src('../components/LearningPlayer.vue')

    // The hook must not exist as a callable member on either side. (Both files
    // still MENTION the name in the comments explaining why it was removed —
    // so match the call/definition shapes, not the bare word.)
    expect(simplePlayer).not.toMatch(/getPlaybackSpeedMultiplier\?\.\(/)
    expect(simplePlayer).not.toMatch(/getPlaybackSpeedMultiplier\?:/)
    expect(learningPlayer).not.toMatch(/getPlaybackSpeedMultiplier\s*:/)
  })

  it('the baked rate is the whole rate — nothing multiplies it at play time', () => {
    const simplePlayer = src('./SimplePlayer.ts')
    // `rate` is assigned from the baked speed and then handed straight to the
    // element. Any `rate *= …` is a reintroduced fork.
    expect(simplePlayer).not.toMatch(/rate\s*\*=/)
  })

  it('speaking speed is a function of belt and course only — mode is not an input', () => {
    // computeCycleSpeed takes (seedNumber, courseConfig). There is deliberately
    // no mode parameter, so Easy and Fast cannot disagree by construction.
    expect(computeCycleSpeed.length).toBe(2)

    for (const cfg of [NATIVE_COURSE, FRENCH_COURSE, LEGACY_COURSE]) {
      for (const seed of [1, 7, 8, 19, 20, 39, 40, 400]) {
        const speed = computeCycleSpeed(seed, cfg)
        // Same call, same answer, whichever mode the learner is in.
        expect(computeCycleSpeed(seed, cfg)).toBe(speed)
      }
    }
  })

  it('listening clips are never slowed — not by mode, and since 2026-08-16 not by belt', () => {
    // Tom, 2026-08-16, confirming Aran: listening exercises expose the learner
    // to full and over-speed native tempo, so the belt ramp has no business
    // here. It stays on the SPEAKING side, which is why these two now differ.
    expect(computeListeningSpeed(1.0, 1, NATIVE_COURSE)).toBe(1.0)
    expect(computeListeningSpeed(1.0, 1, NATIVE_COURSE)).toBeGreaterThan(computeCycleSpeed(1, NATIVE_COURSE))
    expect(computeListeningSpeed(2.0, 1, NATIVE_COURSE)).toBe(2.0)
    expect(computeListeningSpeed(2.0, 40, NATIVE_COURSE)).toBe(2.0)

    // And no mode input exists at all: computeListeningSpeed takes
    // (roleSpeed, seedNumber, courseConfig) and reads neither of the last two
    // for a slow-down, so Easy and Fast cannot disagree by construction.
    for (const seed of [1, 7, 8, 19, 20, 39, 40, 400]) {
      expect(computeListeningSpeed(1.0, seed, NATIVE_COURSE)).toBe(computeListeningSpeed(1.0, 1, NATIVE_COURSE))
    }
  })

  it('the modes still differ where they are SUPPOSED to — pause and repetition', () => {
    // The guardrail against over-correcting: this fix must not have flattened
    // Easy into Fast. Easy keeps its longer pauses, its post-voice2 beat and
    // its extra repetitions / shorter phrases.
    expect(DEFAULT_EASY.pause_boot_ms!).toBeGreaterThan(DEFAULT_FAST.pause_boot_ms!)
    expect(DEFAULT_EASY.min_pause_ms).toBeGreaterThan(DEFAULT_FAST.min_pause_ms)
    expect(DEFAULT_EASY.post_voice2_gap_ms!).toBeGreaterThan(DEFAULT_FAST.post_voice2_gap_ms!)
    expect(DEFAULT_EASY.maxPhraseLengthFraction!).toBeLessThan(DEFAULT_FAST.maxPhraseLengthFraction!)
    // …and the one thing they must NOT differ on any more:
    expect(DEFAULT_EASY.playback_speed).toBe(DEFAULT_FAST.playback_speed)
  })
})
