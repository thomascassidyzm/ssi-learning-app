/**
 * podFadeSchedule.test.ts — the fade schedule that went live on 2026-08-24.
 *
 * Tom's ruling: run HIS stage playlist (the PROPOSED_STAGE_PLAYLIST /
 * "unified ladder" authored in Popty's Pod Lab, commits ee759557b + 97e8e09a5)
 * rather than Aran's live-but-off DB row, whose stages 1 and 2 are byte
 * identical — a fossil of the retired explainer stage that Tom's own version
 * already collapses.
 *
 * The schedule is DB state, not code: it lives in `algorithm_config` row
 * key='pods', switched on by `listeningUseStagePlaylist` on row key='listening'.
 * These tests pin the SHAPE the code must honour when that row is loaded, so a
 * future refactor of the scheduler cannot quietly change what a learner hears
 * without a red test. TOM_FADE_LADDER below is the row's stagePlaylist verbatim.
 *
 * Four things are locked here, one per decision taken on 2026-08-24:
 *   1. the fade sequence itself — eight rungs, t·k·t·t at 1× down to bare t@2×
 *   2. "twice" — the opening t·k·t·t is heard on the sentence's first TWO laps
 *      before anything thins (stageDurations {'1': 2})
 *   3. the gap defaults to 0 — a hard cut, and 0 must survive the config merge
 *   4. the 1.0 speed ceiling does NOT apply to pods, and DOES still apply to
 *      every other listening path
 */
import { describe, it, expect } from 'vitest'
import { podStageFor } from './usePodLapScheduler'
import {
  resolvePodsConfig,
  resolveListeningPlayPolicy,
  type PodsConfig,
} from './useAlgorithmConfig'
import { buildMainStage, ROLE_SPEED, isTargetRole, type PodPlayRole } from '@ssi/core/pods'
import {
  LISTENING_SPEED_CEILING,
  resolveListeningSpeed,
  DEFAULT_FAST_LISTENING_RAMP,
} from '../playback/listeningExposureRamp'

/** Tom's ladder, verbatim from the live `pods` row as written on 2026-08-24. */
const TOM_FADE_LADDER: Record<string, PodPlayRole[]> = {
  '1': ['ps', 'trans', 'ps', 'ps'], //     t · k · t · t
  '2': ['ps', 'trans', 'ps', 'ps2x'], //   t · k · t · t@2×
  '3': ['ps', 'trans', 'ps2x', 'ps2x'], // t · k · t@2× · t@2×
  '4': ['ps', 'trans', 'ps2x'], //         t · k · t@2×
  '5': ['ps2x', 'trans', 'ps2x'], //       t@2× · k · t@2×
  '6': ['ps', 'ps2x'], //                  t · t@2×
  '7': ['ps2x', 'ps2x'], //                t@2× · t@2×
  '8': ['ps2x'], //                        t@2×  (eternal)
}

/** The live row's own dwell settings: stage 1 twice, then five laps a rung. */
const TOM_STAGE_DURATIONS = { '1': 2 }
const TOM_STAGE_DURATION = 5
const TOTAL_STAGES = Object.keys(TOM_FADE_LADDER).length

const sentence = {
  sentence_id: 's-1',
  global_order: 1,
  target_text: 'Ciao',
  known_text: 'Hello',
  target_audio_id: 'tgt-1',
  known_audio_id: 'kn-1',
  explainer_audio_id: null,
  glue_to_next: false,
}

/** The roles the learner actually hears for a stage, in order. */
const rolesAt = (stage: number) =>
  buildMainStage(sentence, stage, 1, TOM_FADE_LADDER[String(stage)]).map((p) => p.playRole)

/** The playback rates the learner actually hears for a stage, in order. */
const speedsAt = (stage: number) =>
  buildMainStage(sentence, stage, 1, TOM_FADE_LADDER[String(stage)]).map((p) => p.playbackSpeed)

// ============================================================================
// 1. The fade sequence
// ============================================================================
describe('the pod fade schedule — the eight rungs', () => {
  it('rung 1 is t·k·t·t, every clip at 1×', () => {
    expect(rolesAt(1)).toEqual(['ps', 'trans', 'ps', 'ps'])
    expect(speedsAt(1)).toEqual([1.0, 1.0, 1.0, 1.0])
  })

  it('thins monotonically: 2× arrives on the last rep, then spreads, then the known clip drops, then it is bare target at 2× for ever', () => {
    expect(rolesAt(2)).toEqual(['ps', 'trans', 'ps', 'ps2x'])
    expect(rolesAt(3)).toEqual(['ps', 'trans', 'ps2x', 'ps2x'])
    expect(rolesAt(4)).toEqual(['ps', 'trans', 'ps2x'])
    expect(rolesAt(5)).toEqual(['ps2x', 'trans', 'ps2x'])
    expect(rolesAt(6)).toEqual(['ps', 'ps2x'])
    expect(rolesAt(7)).toEqual(['ps2x', 'ps2x'])
    expect(rolesAt(8)).toEqual(['ps2x'])
  })

  it('the known clip is present through rung 5 and gone from rung 6 on — the meaning scaffold is withdrawn once, and never returns', () => {
    for (const stage of [1, 2, 3, 4, 5]) expect(rolesAt(stage)).toContain('trans')
    for (const stage of [6, 7, 8]) expect(rolesAt(stage)).not.toContain('trans')
  })

  it('never strands the learner on the known language — every rung ends on a target rep', () => {
    for (let stage = 1; stage <= TOTAL_STAGES; stage++) {
      const roles = rolesAt(stage)
      expect(isTargetRole(roles[roles.length - 1])).toBe(true)
    }
  })

  it('has no duplicated rung: Aran\'s stage-1/stage-2 fossil is collapsed in Tom\'s version', () => {
    const patterns = Object.values(TOM_FADE_LADDER).map((p) => p.join('·'))
    expect(new Set(patterns).size).toBe(patterns.length)
  })

  it('never asks for a clip a pod sentence does not have — target and known only, no explainer slot', () => {
    for (const playlist of Object.values(TOM_FADE_LADDER)) {
      expect(playlist).not.toContain('explainer')
    }
  })

  it('the eternal rung is the last one, and it is bare target at 2× — the completion signal itself', () => {
    const eternal = Math.max(...Object.keys(TOM_FADE_LADDER).map(Number))
    expect(eternal).toBe(8)
    expect(TOM_FADE_LADDER[String(eternal)]).toEqual(['ps2x'])
    expect(podStageFor(1, 999, TOM_STAGE_DURATION, TOTAL_STAGES, TOM_STAGE_DURATIONS))
      .toEqual({ stage: 8, iter: null })
  })
})

// ============================================================================
// 2. "Twice" — the opening pattern is heard on the first two laps
// ============================================================================
describe('the pod fade schedule — "twice" at the top', () => {
  const stageOnLap = (lap: number) =>
    podStageFor(1, lap, TOM_STAGE_DURATION, TOTAL_STAGES, TOM_STAGE_DURATIONS)?.stage

  it('laps 1 and 2 both play the full t·k·t·t at 1× — the pattern is heard TWICE before anything changes', () => {
    expect(stageOnLap(1)).toBe(1)
    expect(stageOnLap(2)).toBe(1)
    expect(rolesAt(1)).toEqual(rolesAt(stageOnLap(2)!))
    expect(speedsAt(stageOnLap(1)!)).toEqual([1.0, 1.0, 1.0, 1.0])
    expect(speedsAt(stageOnLap(2)!)).toEqual([1.0, 1.0, 1.0, 1.0])
  })

  it('the thinning starts on lap 3 — the third hearing is the first with 2× in it', () => {
    expect(stageOnLap(3)).toBe(2)
    expect(speedsAt(stageOnLap(3)!)).toContain(2.0)
  })

  it('twice means two LAPS, not the pattern doubled inside one lap — one hearing is four clips, not eight', () => {
    expect(rolesAt(1)).toHaveLength(4)
  })

  it('every rung after the first gets the uniform dwell of five laps', () => {
    // rung 1: laps 1-2. rung 2: laps 3-7. rung 3: laps 8-12. …
    expect(stageOnLap(7)).toBe(2)
    expect(stageOnLap(8)).toBe(3)
    expect(stageOnLap(12)).toBe(3)
    expect(stageOnLap(13)).toBe(4)
  })
})

// ============================================================================
// 3. The gap: 0 by default, and 0 must survive the config merge
// ============================================================================
describe('the pod fade schedule — the gap', () => {
  const liveRow: Partial<PodsConfig> = {
    gapSuperTightMs: 0,
    gapTightMs: 0,
    gapGluedMs: 0,
    gapBetweenMs: 0,
  }

  it('launches on a hard cut: all four gaps resolve to 0', () => {
    const pods = resolvePodsConfig(liveRow)
    expect(pods.gapSuperTightMs).toBe(0)
    expect(pods.gapTightMs).toBe(0)
    expect(pods.gapGluedMs).toBe(0)
    expect(pods.gapBetweenMs).toBe(0)
  })

  it('a 0 gap is a VALUE, not an absence — the code defaults (100/200/300/1000) must not creep back in through a falsy check', () => {
    const pods = resolvePodsConfig(liveRow)
    expect(pods.gapBetweenMs).not.toBe(1000)
    expect(pods.gapGluedMs).not.toBe(300)
  })

  it('stays adjustable: any other value the row carries is honoured verbatim, so the gap can be tuned live without a deploy', () => {
    const tuned = resolvePodsConfig({ ...liveRow, gapBetweenMs: 450, gapTightMs: 120 })
    expect(tuned.gapBetweenMs).toBe(450)
    expect(tuned.gapTightMs).toBe(120)
    // fields the tuning edit did not mention keep their live values
    expect(tuned.gapGluedMs).toBe(0)
  })

  it('a row that omits the gaps entirely still gets the shipped defaults, not zeros', () => {
    const pods = resolvePodsConfig({ stageDuration: 5 })
    expect(pods.gapBetweenMs).toBe(1000)
  })
})

// ============================================================================
// 4. The 1.0 ceiling: retired for pods, untouched everywhere else
// ============================================================================
describe('the pod fade schedule — the 1.0 ceiling is retired for pods only', () => {
  it('the fade genuinely exceeds the ceiling: its closing reps are authored at 2×', () => {
    expect(ROLE_SPEED.ps2x).toBe(2.0)
    expect(ROLE_SPEED.ps2x).toBeGreaterThan(LISTENING_SPEED_CEILING)
  })

  it('a pod on the eternal rung plays at 2×, above the ceiling, as authored', () => {
    // No uniformSpeed argument — this is exactly what the scheduler passes on
    // the stage-playlist path, and it is the carve-out made deliberate.
    expect(speedsAt(8)).toEqual([2.0])
    expect(speedsAt(7)).toEqual([2.0, 2.0])
  })

  it('the ceiling is UNCHANGED for every non-pod listening path — the exposure ramp still clamps to 1.0', () => {
    for (const exposure of [1, 5, 20, 100, 5000]) {
      const speed = resolveListeningSpeed(exposure, DEFAULT_FAST_LISTENING_RAMP, 1.0)
      expect(speed).toBeLessThanOrEqual(LISTENING_SPEED_CEILING)
    }
  })

  it('the ceiling cannot be raised by config even for a non-pod path — a 2.0 maxSpeed is still clamped to 1.0', () => {
    const policy = resolveListeningPlayPolicy({ maxSpeed: 2.0 }, 'fast')
    expect(policy.ceiling).toBe(LISTENING_SPEED_CEILING)
  })
})

// ============================================================================
// The flag: one boolean on the `listening` row is what runs the whole thing
// ============================================================================
describe('the pod fade schedule — the flag that switched it on', () => {
  it('listeningUseStagePlaylist: true is what puts the ladder on the learner path', () => {
    expect(resolveListeningPlayPolicy({ listeningUseStagePlaylist: true }, 'fast').useStagePlaylist)
      .toBe(true)
  })

  it('absent or false, the fade does not run — the pre-2026-08-24 world', () => {
    expect(resolveListeningPlayPolicy({}, 'fast').useStagePlaylist).toBe(false)
    expect(resolveListeningPlayPolicy(null, 'fast').useStagePlaylist).toBe(false)
    expect(resolveListeningPlayPolicy({ listeningUseStagePlaylist: false }, 'fast').useStagePlaylist)
      .toBe(false)
  })
})
