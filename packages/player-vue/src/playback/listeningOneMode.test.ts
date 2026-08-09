/**
 * listeningOneMode.test.ts — the acceptance suite for Tom's 2026-08-07
 * listening redesign: ONE mode, one pattern, one speed per phrase, ramped over
 * exposures, hard-capped at 1.0.
 *
 * These are deliberately end-to-end-ish: where a rule is about what the learner
 * HEARS, the test asserts on the plays a real scheduler emits, not on the pure
 * helper. A pure-helper-only suite would have passed happily while the schedulers
 * still read the retired stage ladder.
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_EASY_BELT_CEILINGS,
  DEFAULT_EASY_LISTENING_RAMP,
  DEFAULT_FAST_LISTENING_RAMP,
  DEFAULT_LISTENING_PATTERN,
  LISTENING_SPEED_CEILING,
  beltCeilingForSeed,
  normalizeBeltCeilings,
  normalizeListeningRamp,
  rampSpeedForExposure,
  resolveListeningPattern,
  resolveListeningSpeed,
  type ListeningRampStep,
} from './listeningExposureRamp'
import {
  buildSeedPlays,
  l1PlaylistFromPattern,
  seedExposureAt,
  batchReadyRound,
} from '../composables/useLayer1Scheduler'
import { usePodLapScheduler, podPlaylistFromPattern } from '../composables/usePodLapScheduler'
import { resolveListeningPlayPolicy, DEFAULT_EASY, DEFAULT_FAST } from '../composables/useAlgorithmConfig'
import { beltSpeed } from '../providers/toSimpleRounds'
import type { ListeningPlayPolicy } from '../composables/useAlgorithmConfig'

// ============================================================================
// Fixtures — a minimal Layer-2 pod scheduler over one sentence, so the
// pattern/speed assertions run against the real lap composer.
// ============================================================================

const podSentence = (i: number) => ({
  id: `p${i}`,
  global_order: i,
  speaker: null,
  target_text: `target ${i}`,
  known_text: `known ${i}`,
  target_audio_id: `t${i}`,
  known_audio_id: `k${i}`,
  explainer_audio_id: null,
  glue_to_next: false,
})

function makeMockSupabase(podSentences: any[], completedPodRounds = 0) {
  const builder = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      update: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: table === 'course_enrollments'
            ? { pod_activation_round: 1, completed_pod_rounds: completedPodRounds }
            : null,
          error: null,
        }),
      then: (cb: any) => {
        if (table === 'listening_pod_sentences') return Promise.resolve({ data: podSentences, error: null }).then(cb)
        return Promise.resolve({ data: [], error: null }).then(cb)
      },
    }
    return chain
  }
  return { from: (t: string) => builder(t) } as any
}

/** A policy built the way the player builds it: from the live rows. */
const policyFor = (
  mode: 'easy' | 'fast',
  listeningRow: Record<string, unknown> = {},
  modeOverrides: Record<string, unknown> = {},
): ListeningPlayPolicy =>
  resolveListeningPlayPolicy(
    listeningRow as any,
    mode,
    { ...(mode === 'easy' ? DEFAULT_EASY : DEFAULT_FAST), ...modeOverrides } as any,
  )

/** Compose the first lap of a one-sentence pod under `policy`. */
async function firstLap(policy: ListeningPlayPolicy, targetSpeed?: { globalSpeed: number; nativeSpeed: boolean }) {
  const s = usePodLapScheduler({
    supabase: makeMockSupabase([podSentence(1)]),
    courseCode: 'c',
    learnerId: 'u',
    listeningPolicy: policy,
    ...(targetSpeed ? { targetSpeed } : {}),
  })
  await s.initialize()
  return s.nextLap()!
}

const L1_SEED = {
  seedNumber: 1,
  target1Id: 'T1',
  target2Id: 'T2',
  knownId: 'K',
  targetText: 'target',
  knownText: 'known',
}

// ============================================================================
// 1. Every listening phrase yields exactly four plays: target, known, target, target
// ============================================================================

describe('1 — the pattern is target · known · target · target, and nothing else', () => {
  it('Layer 2 (pods): four plays per sentence, in that order', async () => {
    const lap = await firstLap(policyFor('fast'))
    expect(lap.plays).toHaveLength(4)
    expect(lap.plays.map(p => p.playRole)).toEqual(['ps', 'trans', 'ps', 'ps'])
    expect(lap.plays.map(p => p.audioId)).toEqual(['t1', 'k1', 't1', 't1'])
  })

  it('Layer 1 (seed sandwiches): four plays per seed, target · known · target(voice 2) · target', () => {
    const plays = buildSeedPlays(L1_SEED, l1PlaylistFromPattern(DEFAULT_LISTENING_PATTERN), undefined, 0.8)
    expect(plays).toHaveLength(4)
    expect(plays.map(p => p.role)).toEqual(['ps', 'trans', 'ps', 'ps'])
    // The second target uses voice 2 where the seed has one — a voice choice,
    // not a pattern change.
    expect(plays.map(p => p.audioId)).toEqual(['T1', 'K', 'T2', 'T1'])
  })

  it('the two layers share ONE pattern definition — neither carries its own list', () => {
    expect(podPlaylistFromPattern(DEFAULT_LISTENING_PATTERN)).toEqual(['ps', 'trans', 'ps', 'ps'])
    expect(l1PlaylistFromPattern(DEFAULT_LISTENING_PATTERN)).toEqual(['t1', 'known', 't2', 't1'])
    expect(DEFAULT_LISTENING_PATTERN).toHaveLength(4)
  })

  it('a phrase with no known audio drops that slot, and A-64 then caps the target run at two', async () => {
    // T·K·T·T with no K collapses to three identical target clips back to back,
    // which breaches A-64 ("no mode repeats the same prompt more than twice
    // consecutively", Tom 2026-08-06). The cap drops the surplus, so such a
    // phrase plays twice. The normal four-slot pattern is untouched by A-64 —
    // its trailing T·T pair is exactly two, which is legal (test above).
    const s = usePodLapScheduler({
      supabase: makeMockSupabase([{ ...podSentence(1), known_audio_id: null }]),
      courseCode: 'c',
      learnerId: 'u',
      listeningPolicy: policyFor('fast'),
    })
    await s.initialize()
    const lap = s.nextLap()!
    expect(lap.plays.map(p => p.playRole)).toEqual(['ps', 'ps'])
  })
})

// ============================================================================
// 2. All four plays of a phrase carry the SAME playbackSpeed
// ============================================================================

describe('2 — a phrase\'s four clips are all at the same speed, known slot included', () => {
  it('Layer 2: one distinct speed across the whole phrase, at every exposure', async () => {
    for (const mode of ['easy', 'fast'] as const) {
      const lap = await firstLap(policyFor(mode))
      const speeds = new Set(lap.plays.map(p => p.playbackSpeed))
      expect(speeds.size).toBe(1)
    }
  })

  it('Layer 1: the KNOWN clip is no longer pinned at 1.0 while the targets ramp', () => {
    const plays = buildSeedPlays(L1_SEED, l1PlaylistFromPattern(DEFAULT_LISTENING_PATTERN), undefined, 0.7)
    expect(plays.map(p => p.playbackSpeed)).toEqual([0.7, 0.7, 0.7, 0.7])
    // ...which is the change: with no uniform speed supplied (the pre-2026-08-07
    // path, still reachable via speedSource:'belt'), the known clip splits off.
    const legacy = buildSeedPlays(L1_SEED, l1PlaylistFromPattern(DEFAULT_LISTENING_PATTERN))
    expect(new Set(legacy.map(p => p.playbackSpeed)).size).toBe(2)
  })

  it('exposure-ramped plays are flagged FINAL so the runtime does not belt-ramp them again', async () => {
    // LearningPlayer.playPodLap multiplies pod plays by the 2026-08-06 belt
    // ramp — and only on TARGET roles. Applied on top of an exposure speed that
    // has already folded in globalSpeed, that would both double-count the
    // course speed and re-split the phrase's four clips into two rates.
    const ramped = await firstLap(policyFor('easy'))
    expect(ramped.plays.every(p => p.speedIsFinal === true)).toBe(true)
    // The escape-hatch ladder still wants the belt ramp, so it is NOT flagged.
    const ladder = await firstLap(policyFor('fast', { listeningUseStagePlaylist: true }))
    expect(ladder.plays.every(p => p.speedIsFinal !== true)).toBe(true)
  })
})

// ============================================================================
// 3. Nothing ever exceeds 1.0 — prove the CLAMP, not the default
// ============================================================================

describe('3 — 1.0 is a hard ceiling enforced in code, not by the default values', () => {
  it('a ramp step above 1.0 in the config is clamped, not honoured', () => {
    const reckless: ListeningRampStep[] = [{ speed: 1.5, plays: null }]
    expect(rampSpeedForExposure(1, normalizeListeningRamp(reckless, DEFAULT_FAST_LISTENING_RAMP))).toBe(1.0)
    expect(resolveListeningSpeed(1, reckless, 1.0)).toBe(1.0)
  })

  it('a ceiling above 1.0 in the config cannot raise the ceiling', () => {
    expect(resolveListeningSpeed(1, [{ speed: 2.0, plays: null }], 1.0, 4.0)).toBe(1.0)
    // ...but a LOWER configured ceiling is honoured — the key can only tighten.
    expect(resolveListeningSpeed(1, [{ speed: 1.0, plays: null }], 1.0, 0.9)).toBe(0.9)
  })

  it('a course globalSpeed above 1.0 cannot push a listening clip past the ceiling', () => {
    expect(resolveListeningSpeed(99, DEFAULT_FAST_LISTENING_RAMP, 1.4)).toBe(1.0)
  })

  it('end to end: a live `listening` row asking for 1.6 still emits 1.0 plays', async () => {
    const lap = await firstLap(
      policyFor('fast', { maxSpeed: 1.6 }, { listeningSpeedRamp: [{ speed: 1.6, plays: null }] }),
      { globalSpeed: 1.3, nativeSpeed: true },
    )
    expect(lap.plays.every(p => p.playbackSpeed <= LISTENING_SPEED_CEILING)).toBe(true)
    expect(lap.plays.every(p => p.playbackSpeed === 1.0)).toBe(true)
  })

  it('no ramp step, at any exposure, in either shipped mode, exceeds the ceiling', () => {
    for (const ramp of [DEFAULT_EASY_LISTENING_RAMP, DEFAULT_FAST_LISTENING_RAMP]) {
      for (let e = 1; e <= 50; e++) {
        expect(resolveListeningSpeed(e, ramp, 1.0)).toBeLessThanOrEqual(LISTENING_SPEED_CEILING)
      }
    }
  })
})

// ============================================================================
// 4. Easy starts slower than Fast; Fast may start at 1.0
// ============================================================================

describe('4 — Easy is slower, Fast starts at the regular speed', () => {
  it('Easy opens at 0.7 and Fast opens at 1.0', () => {
    expect(resolveListeningSpeed(1, policyFor('easy').ramp, 1.0)).toBe(0.7)
    expect(resolveListeningSpeed(1, policyFor('fast').ramp, 1.0)).toBe(1.0)
  })

  it('Easy is never faster than Fast at ANY exposure', () => {
    const easy = policyFor('easy').ramp
    const fast = policyFor('fast').ramp
    for (let e = 1; e <= 30; e++) {
      expect(resolveListeningSpeed(e, easy, 1.0)).toBeLessThanOrEqual(resolveListeningSpeed(e, fast, 1.0))
    }
  })

  it('the Easy RAMP alone is 0.7 · 0.8 ×4 · then 1.0 (the belt ceiling caps it — see 4b)', () => {
    const easy = policyFor('easy').ramp
    const curve = [1, 2, 3, 4, 5, 6, 7, 100].map(e => resolveListeningSpeed(e, easy, 1.0))
    expect(curve).toEqual([0.7, 0.8, 0.8, 0.8, 0.8, 1.0, 1.0, 1.0])
  })

  it('the exposure count reaches the ramp end to end, in both layers', async () => {
    // Layer 2: cohort `alive` is the exposure clock, so a first-lap phrase is
    // exposure 1 — Easy's 0.7.
    const lap = await firstLap(policyFor('easy'))
    expect(lap.plays.every(p => p.playbackSpeed === 0.7)).toBe(true)
    // Layer 1: the wheel serves a seed once per turn, so exposures advance one
    // per `cups` rounds.
    const at = (mainRound: number) =>
      seedExposureAt({ mainRound, activationRound: 30, cups: 30, readyRound: 30 })
    expect([at(30), at(59), at(60), at(89), at(90)]).toEqual([1, 1, 2, 2, 3])
  })
})

// ============================================================================
// 4b. THE BELT CEILING (Tom, 2026-08-07 23:56Z — correcting exposure-only)
//     "for Easy the BELT TABLE is authoritative... 0.8x for white/yellow belt,
//     0.9x for orange/green, 1.0x for blue and beyond, NEVER above 1.0. The
//     per-exposure ramp applies UNDERNEATH the belt ceiling."
// ============================================================================

describe('4b — the belt ceiling caps the exposure ramp, Easy only', () => {
  const easy = () => policyFor('easy')

  it('THE ASSERTION: a white-belt Easy learner never exceeds 0.8x, at ANY exposure', () => {
    const { ramp, beltCeilings, ceiling } = easy()
    const white = beltCeilingForSeed(1, beltCeilings)
    expect(white).toBe(0.8)
    for (let e = 1; e <= 200; e++) {
      expect(resolveListeningSpeed(e, ramp, 1.0, ceiling, white)).toBeLessThanOrEqual(0.8)
    }
    // ...and specifically it does NOT rise to 1.0 on the sixth hearing, which
    // is exactly what exposure-only shipped and what this corrects.
    expect(resolveListeningSpeed(6, ramp, 1.0, ceiling, white)).toBe(0.8)
    expect(resolveListeningSpeed(99, ramp, 1.0, ceiling, white)).toBe(0.8)
  })

  it('the ramp still approaches the ceiling FROM BELOW on early hearings', () => {
    const { ramp, beltCeilings, ceiling } = easy()
    const white = beltCeilingForSeed(1, beltCeilings)
    const curve = [1, 2, 3, 4, 5, 6].map(e => resolveListeningSpeed(e, ramp, 1.0, ceiling, white))
    // 0.7 first (slower than the ceiling), then held at the ceiling for ever.
    expect(curve).toEqual([0.7, 0.8, 0.8, 0.8, 0.8, 0.8])
  })

  it('Tom\'s belt table, band by band', () => {
    const t = easy().beltCeilings
    // white (1-7) + yellow (8-19) → 0.8
    expect([1, 7, 8, 19].map(s => beltCeilingForSeed(s, t))).toEqual([0.8, 0.8, 0.8, 0.8])
    // orange (20-39) + green (40-79) → 0.9
    expect([20, 39, 40, 79].map(s => beltCeilingForSeed(s, t))).toEqual([0.9, 0.9, 0.9, 0.9])
    // blue (80+) and beyond → 1.0
    expect([80, 150, 280, 400, 9999].map(s => beltCeilingForSeed(s, t))).toEqual([1.0, 1.0, 1.0, 1.0, 1.0])
  })

  it('it is its OWN table, gentler than the speaking beltSpeed curve', () => {
    const t = easy().beltCeilings
    // beltSpeed reaches 0.95 at orange and 1.0 at green; this holds 0.9 through
    // green and does not reach 1.0 until blue. Deliberate — Tom's numbers.
    expect(beltCeilingForSeed(20, t)).toBe(0.9)
    expect(beltSpeed(20)).toBe(0.95)
    expect(beltCeilingForSeed(40, t)).toBe(0.9)
    expect(beltSpeed(40)).toBe(1.0)
  })

  it('the ceiling only ever LOWERS the exposure ramp, never raises it', () => {
    const { ramp, ceiling } = easy()
    for (const belt of [0.8, 0.9, 1.0]) {
      for (let e = 1; e <= 20; e++) {
        const capped = resolveListeningSpeed(e, ramp, 1.0, ceiling, belt)
        const uncapped = resolveListeningSpeed(e, ramp, 1.0, ceiling, 1.0)
        expect(capped).toBeLessThanOrEqual(uncapped)
      }
    }
  })

  it('FAST is untouched — no ceiling, still starts at 1.0', () => {
    const { ramp, beltCeilings, ceiling } = policyFor('fast')
    for (const seed of [1, 20, 80, 400]) {
      expect(beltCeilingForSeed(seed, beltCeilings)).toBe(1.0)
      expect(resolveListeningSpeed(1, ramp, 1.0, ceiling, beltCeilingForSeed(seed, beltCeilings))).toBe(1.0)
    }
  })

  it('an unknown learner position takes the GENTLEST rung, not full speed', () => {
    const t = easy().beltCeilings
    expect(beltCeilingForSeed(null, t)).toBe(0.8)
    expect(beltCeilingForSeed(undefined, t)).toBe(0.8)
    expect(beltCeilingForSeed(0, t)).toBe(0.8)
  })

  it('composes with the course globalSpeed — French white-belt Easy tops out at 0.76', () => {
    const { ramp, beltCeilings, ceiling } = easy()
    const white = beltCeilingForSeed(1, beltCeilings)
    expect(resolveListeningSpeed(1, ramp, 0.95, ceiling, white)).toBe(0.665) // 0.7 x 0.95
    expect(resolveListeningSpeed(99, ramp, 0.95, ceiling, white)).toBe(0.76) // 0.8 x 0.95
  })

  it('the table is config-driven and degrades to the shipped one, never to no ceiling', () => {
    const bespoke = policyFor('easy', {}, {
      listeningBeltCeilings: [{ fromSeed: 1, speed: 0.6 }, { fromSeed: 50, speed: 1.0 }],
    }).beltCeilings
    expect(beltCeilingForSeed(1, bespoke)).toBe(0.6)
    expect(beltCeilingForSeed(50, bespoke)).toBe(1.0)
    // Out-of-order rows are sorted; over-1.0 rows are clamped, not dropped.
    expect(normalizeBeltCeilings(
      [{ fromSeed: 80, speed: 1.5 }, { fromSeed: 1, speed: 0.8 }],
      DEFAULT_EASY_BELT_CEILINGS,
    )).toEqual([{ fromSeed: 1, speed: 0.8 }, { fromSeed: 80, speed: 1.0 }])
    for (const junk of [null, undefined, [], [{ speed: 0, fromSeed: 1 }]] as any[]) {
      expect(normalizeBeltCeilings(junk, DEFAULT_EASY_BELT_CEILINGS)).toEqual(DEFAULT_EASY_BELT_CEILINGS)
    }
  })

  it('end to end: a white-belt Easy learner\'s pod lap never emits above 0.8', async () => {
    // The scheduler is handed the learner's anchor seed; every emitted play must
    // respect the ceiling however aged the cohort is.
    for (const exposureLap of [0, 5, 40]) {
      const s = usePodLapScheduler({
        supabase: makeMockSupabase([podSentence(1)], exposureLap),
        courseCode: 'c',
        learnerId: 'u',
        listeningPolicy: easy(),
        beltAnchorSeed: 1,
      })
      await s.initialize()
      const lap = s.nextLap()!
      expect(lap.plays.length).toBeGreaterThan(0)
      expect(lap.plays.every(p => p.playbackSpeed <= 0.8)).toBe(true)
    }
  })

  it('end to end: a blue-belt Easy learner DOES reach 1.0 once the ramp tops out', async () => {
    const s = usePodLapScheduler({
      supabase: makeMockSupabase([podSentence(1)], 40),
      courseCode: 'c',
      learnerId: 'u',
      listeningPolicy: easy(),
      beltAnchorSeed: 120,
    })
    await s.initialize()
    const lap = s.nextLap()!
    expect(lap.plays.every(p => p.playbackSpeed === 1.0)).toBe(true)
  })
})

// ============================================================================
// 5. Every number comes from config — change the config, the speeds change
// ============================================================================

describe('5 — nothing is hardcoded: the ramp is whatever the config says', () => {
  it('a bespoke step table drives the emitted speeds exactly', () => {
    const bespoke: ListeningRampStep[] = [
      { speed: 0.5, plays: 2 },
      { speed: 0.6, plays: 1 },
      { speed: 0.95, plays: null },
    ]
    const ramp = policyFor('easy', {}, { listeningSpeedRamp: bespoke }).ramp
    expect([1, 2, 3, 4, 99].map(e => resolveListeningSpeed(e, ramp, 1.0))).toEqual(
      [0.5, 0.5, 0.6, 0.95, 0.95],
    )
  })

  it('changing the config changes what the SCHEDULER emits, not just the helper', async () => {
    const slow = await firstLap(policyFor('easy', {}, { listeningSpeedRamp: [{ speed: 0.55, plays: null }] }))
    expect(slow.plays.every(p => p.playbackSpeed === 0.55)).toBe(true)
    const shipped = await firstLap(policyFor('easy'))
    expect(shipped.plays.every(p => p.playbackSpeed === 0.7)).toBe(true)
  })

  it('the dwell length is a config value: widen it and full speed arrives later', () => {
    const patient = policyFor('easy', {}, {
      listeningSpeedRamp: [{ speed: 0.7, plays: 1 }, { speed: 0.8, plays: 9 }, { speed: 1.0, plays: null }],
    }).ramp
    expect(resolveListeningSpeed(10, patient, 1.0)).toBe(0.8)
    expect(resolveListeningSpeed(11, patient, 1.0)).toBe(1.0)
    // The shipped Easy ramp is already at 1.0 by exposure 6.
    expect(resolveListeningSpeed(10, policyFor('easy').ramp, 1.0)).toBe(1.0)
  })

  it('a malformed ramp degrades to the shipped ramp for that mode — never to full speed', () => {
    for (const junk of [null, undefined, [], [{ speed: 0 }], [{ speed: NaN, plays: 3 }]] as any[]) {
      expect(normalizeListeningRamp(junk, DEFAULT_EASY_LISTENING_RAMP)).toEqual(DEFAULT_EASY_LISTENING_RAMP)
    }
    expect(resolveListeningSpeed(1, policyFor('easy', {}, { listeningSpeedRamp: [] as any }).ramp, 1.0)).toBe(0.7)
  })
})

// ============================================================================
// 6. The pattern is config-driven, and the retired ladder no longer varies it
// ============================================================================

describe('6 — the pattern is config, and the nine-stage ladder is retired', () => {
  it('a configured pattern drives the emitted plays', async () => {
    const lap = await firstLap(policyFor('fast', { playPattern: ['target', 'known', 'target'] }))
    expect(lap.plays.map(p => p.playRole)).toEqual(['ps', 'trans', 'ps'])
  })

  it('a live nine-stage `pods` row no longer produces per-stage variation', async () => {
    // This is the DB gotcha made a test: the live `pods` row still carries all
    // nine stages and OVERRIDES the code default at runtime. Under the one-mode
    // default it must change nothing at all — including the 1.5x/2x stages.
    const NINE_STAGES = {
      '1': ['ps08x', 'explainer', 'ps08x'],
      '2': ['ps08x', 'trans', 'ps08x', 'ps08x'],
      '3': ['ps08x', 'trans', 'ps', 'ps15x'],
      '4': ['ps', 'trans', 'ps15x', 'ps15x'],
      '5': ['ps', 'trans', 'ps2x', 'ps2x'],
      '6': ['ps', 'trans', 'ps2x'],
      '7': ['ps', 'ps2x'],
      '8': ['ps2x', 'ps2x'],
      '9': ['ps2x'],
    } as any
    const s = usePodLapScheduler({
      supabase: makeMockSupabase([podSentence(1)]),
      courseCode: 'c',
      learnerId: 'u',
      stagePlaylist: NINE_STAGES,
      listeningPolicy: policyFor('fast'),
    })
    await s.initialize()
    const lap = s.nextLap()!
    expect(lap.plays.map(p => p.playRole)).toEqual(['ps', 'trans', 'ps', 'ps'])
    // Not one 1.5x or 2x rep survives anywhere.
    expect(lap.plays.every(p => p.playbackSpeed <= 1.0)).toBe(true)
  })

  it('the ladder is still reachable by config alone (escape hatch), and then it DOES vary', async () => {
    const s = usePodLapScheduler({
      supabase: makeMockSupabase([podSentence(1)]),
      courseCode: 'c',
      learnerId: 'u',
      stagePlaylist: { '1': ['ps', 'trans', 'ps2x'] } as any,
      listeningPolicy: policyFor('fast', { listeningUseStagePlaylist: true }),
    })
    await s.initialize()
    const lap = s.nextLap()!
    expect(lap.plays.map(p => p.playbackSpeed)).toEqual([1.0, 1.0, 2.0])
  })

  it('a pattern ending on the known language is rejected — never strand the learner', () => {
    expect(resolveListeningPattern(['target', 'known'])).toEqual(DEFAULT_LISTENING_PATTERN)
    expect(resolveListeningPattern(['nonsense'] as any)).toEqual(DEFAULT_LISTENING_PATTERN)
    expect(resolveListeningPattern([])).toEqual(DEFAULT_LISTENING_PATTERN)
  })
})

// ============================================================================
// 7. The course globalSpeed still folds in (the French 0.95 shape)
// ============================================================================

describe('7 — the course globalSpeed still folds in, and can only slow things down', () => {
  const FRENCH = 0.95

  it('French Easy: 0.7 x 0.95 on the first hearing, 0.95 at the top of the ramp', () => {
    const easy = policyFor('easy').ramp
    expect(resolveListeningSpeed(1, easy, FRENCH)).toBe(0.665)
    expect(resolveListeningSpeed(2, easy, FRENCH)).toBe(0.76)
    expect(resolveListeningSpeed(6, easy, FRENCH)).toBe(0.95)
  })

  it('French Fast: flat 0.95 — the course speed is the only modulation', () => {
    expect(resolveListeningSpeed(1, policyFor('fast').ramp, FRENCH)).toBe(0.95)
  })

  it('end to end through the pod scheduler', async () => {
    const lap = await firstLap(policyFor('easy'), { globalSpeed: FRENCH, nativeSpeed: true })
    expect(lap.plays.every(p => p.playbackSpeed === 0.665)).toBe(true)
  })

  it('a legacy slow-recorded course (0.9) is not sped up by the ramp reaching 1.0', () => {
    expect(resolveListeningSpeed(99, policyFor('easy').ramp, 0.9)).toBe(0.9)
  })

  it('a nonsense globalSpeed degrades to 1.0 rather than silencing the clip', () => {
    expect(resolveListeningSpeed(1, DEFAULT_FAST_LISTENING_RAMP, 0)).toBe(1.0)
    expect(resolveListeningSpeed(1, DEFAULT_FAST_LISTENING_RAMP, NaN)).toBe(1.0)
  })
})

// ============================================================================
// The Layer-1 exposure derivation (no persisted counter — the wheel IS one)
// ============================================================================

describe('Layer-1 exposure is derived from the cup wheel, not stored', () => {
  it('a seed is heard once per full turn of the wheel', () => {
    const at = (mainRound: number) =>
      seedExposureAt({ mainRound, activationRound: 10, cups: 5, readyRound: 10 })
    expect([at(10), at(14), at(15), at(19), at(20)]).toEqual([1, 1, 2, 2, 3])
  })

  it('a seed whose batch landed later has had fewer exposures at the same round', () => {
    const early = seedExposureAt({ mainRound: 100, activationRound: 10, cups: 5, readyRound: 10 })
    const late = seedExposureAt({ mainRound: 100, activationRound: 10, cups: 5, readyRound: 80 })
    expect(early).toBeGreaterThan(late)
    expect(late).toBeGreaterThanOrEqual(1)
  })

  it('never returns less than 1 — a seed being heard now has had one exposure', () => {
    expect(seedExposureAt({ mainRound: 1, activationRound: 30, cups: 30, readyRound: 30 })).toBe(1)
    expect(seedExposureAt({ mainRound: 5, activationRound: 10, cups: 0, readyRound: 10 })).toBe(1)
  })

  it('batchReadyRound: a batch is pourable when its (b x cups)-th seed was introduced', () => {
    // 6 seeds introduced at rounds 1..6, cups = 2 → batches of 2.
    const ordinals = [1, 2, 3, 4, 5, 6]
    expect(batchReadyRound(ordinals, 0, 2)).toBe(2) // batch 1 completes at round 2
    expect(batchReadyRound(ordinals, 1, 2)).toBe(2)
    expect(batchReadyRound(ordinals, 2, 2)).toBe(4) // batch 2 completes at round 4
    expect(batchReadyRound(ordinals, 5, 2)).toBe(6)
    // Past the end (a batch that never completes) falls back to the seed's own
    // introduction round rather than blowing up.
    expect(batchReadyRound([1, 2, 3], 2, 2)).toBe(3)
  })
})
