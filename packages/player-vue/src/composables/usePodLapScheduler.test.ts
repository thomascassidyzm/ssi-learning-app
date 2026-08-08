import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { usePodLapScheduler, podStageFor, DEFAULT_STAGE_DURATIONS } from './usePodLapScheduler'
import {
  DEFAULT_FAST_LISTENING_RAMP,
  DEFAULT_LISTENING_PATTERN,
  LISTENING_SPEED_CEILING,
} from '../playback/listeningExposureRamp'
import type { ListeningPlayPolicy } from './useAlgorithmConfig'

/**
 * The ESCAPE-HATCH policy — replays the retired nine-stage ladder (Tom's
 * 2026-08-07 simplification kept it reachable by DB config alone, see
 * ListeningModeConfig.listeningUseStagePlaylist). The stage-shaped invariants
 * below — the Phase-0 explainer slot, the end-on-target close, the per-role
 * ps2x speeds — only exist on this path now, so they are tested on it.
 */
const STAGE_LADDER_POLICY: ListeningPlayPolicy = {
  pattern: [...DEFAULT_LISTENING_PATTERN],
  ramp: [...DEFAULT_FAST_LISTENING_RAMP],
  ceiling: LISTENING_SPEED_CEILING,
  speedSource: 'exposure',
  useStagePlaylist: true,
}

// ============================================================================
// Supabase mock — covers the four query shapes the scheduler issues:
//   .from('listening_pod_sentences').select(...).eq(...).order(...)
//   .from('course_audio').select(...).eq(...).in(...)
//   .from('course_enrollments').select(...).eq(...).eq(...).maybeSingle()
//   .from('course_enrollments').update({...}).eq(...).eq(...)
// ============================================================================

interface MockState {
  podSentences: any[]
  bookends: any[]
  enrollment: { pod_activation_round: number | null; completed_pod_rounds: number } | null
  enrollmentUpdates: Array<Record<string, any>>
  /** learner_pod_state rows for the two-doors exposure counter (optional). */
  podState?: Array<{ sentence_id: string; exposures: number }>
}

function makeMockSupabase(state: MockState) {
  const builder = (table: string) => {
    let mode: 'select' | 'update' = 'select'
    let updatePayload: any = null
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      maybeSingle: () => {
        if (table === 'course_enrollments') {
          return Promise.resolve({ data: state.enrollment, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      update: (payload: any) => {
        mode = 'update'
        updatePayload = payload
        return chain
      },
      then: (cb: any) => {
        // Direct await on the chain (no terminal called) — used for select queries
        if (mode === 'update') {
          state.enrollmentUpdates.push(updatePayload)
          return Promise.resolve({ error: null }).then(cb)
        }
        if (table === 'listening_pod_sentences') {
          return Promise.resolve({ data: state.podSentences, error: null }).then(cb)
        }
        if (table === 'course_audio') {
          return Promise.resolve({ data: state.bookends, error: null }).then(cb)
        }
        if (table === 'learner_pod_state') {
          return Promise.resolve({ data: state.podState ?? [], error: null }).then(cb)
        }
        return Promise.resolve({ data: null, error: null }).then(cb)
      },
    }
    return chain
  }
  // .schema() is what PodStateStore chains through before .from().
  return { from: builder, schema: () => ({ from: builder }) } as any
}

const podSentence = (i: number) => ({
  global_order: i,
  target_text: `T${i}`,
  known_text: `K${i}`,
  target_audio_id: `tgt-${i}`,
  known_audio_id: `kn-${i}`,
})

const bookendIntro = { role: 'bookend_listen_intro', id: 'intro-1', text: 'Listen', duration_ms: 2000 }
const bookendOutro = { role: 'bookend_listen_outro', id: 'outro-1', text: 'Talk', duration_ms: 2000 }

describe('podStageFor', () => {
  it('returns null for sentences not yet alive', () => {
    expect(podStageFor(5, 4)).toBeNull()
  })
  it('stage 1 spans alive 1-5', () => {
    expect(podStageFor(1, 1)?.stage).toBe(1)
    expect(podStageFor(1, 5)?.stage).toBe(1)
  })
  it('stage 2 spans alive 6-10', () => {
    expect(podStageFor(1, 6)?.stage).toBe(2)
    expect(podStageFor(1, 10)?.stage).toBe(2)
  })
  it('stage 9 is the eternal hold for alive >= 41 (default 9-stage playlist, uniform durations)', () => {
    // 8 transitional stages × 5 rounds = 40 alive; stage 9 = eternal.
    expect(podStageFor(1, 40)?.stage).toBe(8)
    expect(podStageFor(1, 41)?.stage).toBe(9)
    expect(podStageFor(1, 100)?.stage).toBe(9)
  })
  it('honours a custom totalStages so admins can add or remove stages', () => {
    // With totalStages=4, stage 4 is eternal at alive >= 16 (3 × 5).
    expect(podStageFor(1, 16, 5, 4)?.stage).toBe(4)
    expect(podStageFor(1, 15, 5, 4)?.stage).toBe(3)
  })
  it('per-stage durations: Phase 0 (2 rounds) then Phase 1 (3 rounds) then uniform', () => {
    const d = DEFAULT_STAGE_DURATIONS // {1: 2, 2: 3}
    expect(podStageFor(1, 1, 5, 9, d)).toEqual({ stage: 1, iter: 1 })
    expect(podStageFor(1, 2, 5, 9, d)).toEqual({ stage: 1, iter: 2 })
    expect(podStageFor(1, 3, 5, 9, d)).toEqual({ stage: 2, iter: 1 })
    expect(podStageFor(1, 5, 5, 9, d)).toEqual({ stage: 2, iter: 3 })
    expect(podStageFor(1, 6, 5, 9, d)).toEqual({ stage: 3, iter: 1 })
    expect(podStageFor(1, 10, 5, 9, d)).toEqual({ stage: 3, iter: 5 })
    // Transitional total = 2 + 3 + 6×5 = 35 → eternal stage 9 from alive 36.
    expect(podStageFor(1, 35, 5, 9, d)?.stage).toBe(8)
    expect(podStageFor(1, 36, 5, 9, d)?.stage).toBe(9)
  })
  it('string-keyed durations (JSON config shape) work the same', () => {
    expect(podStageFor(1, 3, 5, 9, { '1': 2, '2': 3 })?.stage).toBe(2)
  })
})

describe('usePodLapScheduler — initialization', () => {
  let state: MockState
  beforeEach(() => {
    state = {
      podSentences: [],
      bookends: [],
      enrollment: null,
      enrollmentUpdates: [],
    }
  })

  it('brand new user (no enrollment) defaults activation=6, ratchet=0', async () => {
    state.podSentences = [podSentence(1), podSentence(2)]
    state.bookends = [bookendIntro, bookendOutro]
    state.enrollment = null

    const scheduler = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'hrv_for_eng',
      learnerId: 'real-uuid',
    })
    await scheduler.initialize()

    expect(scheduler.isInitialized.value).toBe(true)
    // Default activation lowered from 6 to 5 (commit 65ee76b8:
    // "L2 pod activation: round 5 — give learners speaking-practice warm-up")
    expect(scheduler.podActivationRound.value).toBe(5)
    expect(scheduler.completedPodRounds.value).toBe(0)
    expect(scheduler.shouldFireLapAt(4)).toBe(false)
    expect(scheduler.shouldFireLapAt(5)).toBe(true)
  })

  it('returning user with pin reads stored values (capped by POD_ACTIVATION_CAP)', async () => {
    state.podSentences = [podSentence(1)]
    state.bookends = [bookendIntro, bookendOutro]
    // Stored value 50 is larger than POD_ACTIVATION_CAP (5). Per commit
    // 839dc9f ("cap stale activation values"), values bigger than the
    // cap are clamped down so historical pre-cap rows don't keep pods
    // locked behind a 20+-round wait. Stored count (7) is unaffected.
    state.enrollment = { pod_activation_round: 50, completed_pod_rounds: 7 }

    const scheduler = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'hrv_for_eng',
      learnerId: 'real-uuid',
    })
    await scheduler.initialize()

    expect(scheduler.podActivationRound.value).toBe(5)
    expect(scheduler.completedPodRounds.value).toBe(7)
    expect(scheduler.shouldFireLapAt(4)).toBe(false)
    expect(scheduler.shouldFireLapAt(5)).toBe(true)
  })

  it('guests skip the enrollment read entirely (in-memory ratchet)', async () => {
    state.podSentences = [podSentence(1)]
    state.bookends = [bookendIntro, bookendOutro]
    // enrollment is null but shouldn't be read for guests anyway
    const scheduler = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'hrv_for_eng',
      learnerId: 'guest-abc-123',
    })
    await scheduler.initialize()
    expect(scheduler.completedPodRounds.value).toBe(0)
  })
})

describe('usePodLapScheduler — nextLap composition', () => {
  let state: MockState
  beforeEach(() => {
    state = {
      podSentences: [podSentence(1), podSentence(2), podSentence(3)],
      bookends: [bookendIntro, bookendOutro],
      enrollment: { pod_activation_round: 6, completed_pod_rounds: 0 },
      enrollmentUpdates: [],
    }
  })

  it('first lap (ratchet=0 → podRound=1) debuts exactly the opening exchange at Phase 0 (Tom 2026-07-24, cold-start window T-13 2026-08-07)', async () => {
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLap()
    expect(lap).not.toBeNull()
    expect(lap!.podRound).toBe(1)
    // The three fixtures share a scene (no scene_number = one scene) and have
    // no glue/speaker info, so each is its own turn → exchanges of [2, 1].
    // The cold-start window serves that opening exchange and nothing more: a
    // turn plus its reply, never a lone line and never the whole scene. Each
    // sentence plays its full Stage-1 pattern before the next:
    // ONE MODE (Tom, 2026-08-07): every sentence, at every age, plays the same
    // four-slot target·known·target·target pattern. The stage ladder that used
    // to vary this per stage is retired; `stage` is still stamped (it is the
    // exposure clock) but no longer changes what you hear. Default policy =
    // Fast's flat 1.0 ramp.
    expect(lap!.plays.map(p => p.playRole)).toEqual(
      ['ps', 'trans', 'ps', 'ps', 'ps', 'trans', 'ps', 'ps'])
    expect(lap!.plays.map(p => p.sentenceIdx)).toEqual([1, 1, 1, 1, 2, 2, 2, 2])
    expect(lap!.plays.every(p => p.stage === 1)).toBe(true)
    expect(lap!.plays.every(p => p.playbackSpeed === 1.0)).toBe(true)
    expect(lap!.intro?.id).toBe('intro-1')
    expect(lap!.outro?.id).toBe('outro-1')
  })

  it('the EXPLAINER slot no longer plays: one mode, one pattern (Tom 2026-08-07)', async () => {
    // The Phase-0 explainer was stage 1 of the retired ladder. Tom's
    // simplification is "that's all that happens" — the single pattern has no
    // explainer slot, so a sentence WITH explainer audio now hears its plain
    // translation like every other. The audio and its code path are kept
    // (buildMainStage still resolves the slot) but nothing references it on the
    // default path. Flagged to Tom as the one deliberate content loss.
    state.podSentences = [{ ...podSentence(1), explainer_audio_id: 'exp-1' }]
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLap()
    expect(lap!.plays.map(p => p.playRole)).toEqual(['ps', 'trans', 'ps', 'ps'])
    expect(lap!.plays.find(p => p.playRole === 'explainer')).toBeUndefined()
  })

  it('the explainer is still reachable through the stage-ladder escape hatch', async () => {
    state.podSentences = [{ ...podSentence(1), explainer_audio_id: 'exp-1' }]
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
      listeningPolicy: STAGE_LADDER_POLICY,
    })
    await s.initialize()
    const lap = s.nextLap()
    expect(lap!.plays.map(p => p.playRole)).toEqual(['ps', 'explainer', 'ps'])
    expect(lap!.plays.find(p => p.playRole === 'explainer')!.audioId).toBe('exp-1')
  })

  it('Phase 0 retires after 2 rounds: alive=3 lands in Phase 1 with the plain translation pattern', async () => {
    state.enrollment = { pod_activation_round: 6, completed_pod_rounds: 2 }
    state.podSentences = [{ ...podSentence(1), explainer_audio_id: 'exp-1' }]
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLap()
    // podRound=3 → sentence 1 alive=3. Under ONE MODE the age changes nothing
    // about the pattern — that is the whole point of the simplification. Only
    // the SPEED is allowed to vary with age, and Fast's ramp is flat.
    const s1 = lap!.plays.filter(p => p.sentenceIdx === 1)
    expect(s1.map(p => p.playRole)).toEqual(['ps', 'trans', 'ps', 'ps'])
    expect(s1.find(p => p.playRole === 'explainer')).toBeUndefined()
  })

  it('second lap debuts cohort 2 while cohort 1 replays one stage-step older — stage cohesion within each cohort', async () => {
    // Three SCENES of two sentences → cohorts [s1+s2], [s3+s4], [s5+s6];
    // the cold-start window leaves all three alone (each is already one full
    // exchange). Ratchet = 2 sentences covered (cohort 1 completed) → round 2:
    // cohort 1 alive=2 (still stage 1, Phase-0 lasts 2 rounds), cohort 2
    // debuts at alive=1; cohort 3 is not in the intake window yet.
    state.podSentences = [
      { ...podSentence(1), scene_number: 1 }, { ...podSentence(2), scene_number: 1 },
      { ...podSentence(3), scene_number: 2 }, { ...podSentence(4), scene_number: 2 },
      { ...podSentence(5), scene_number: 3 }, { ...podSentence(6), scene_number: 3 },
    ]
    state.enrollment = { pod_activation_round: 6, completed_pod_rounds: 2 }
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLap()
    expect(lap!.podRound).toBe(2)
    const idxs = new Set(lap!.plays.map(p => p.sentenceIdx))
    expect(idxs).toEqual(new Set([1, 2, 3, 4]))
    // Cohort-mates always share a stage.
    const stageOf = (idx: number) => new Set(lap!.plays.filter(p => p.sentenceIdx === idx).map(p => p.stage))
    expect(stageOf(1)).toEqual(stageOf(2))
    expect(stageOf(3)).toEqual(stageOf(4))
  })

  it('cohorts age as ONE unit: at round 3 the first cohort reaches stage 2 together, the second stays at stage 1 together', async () => {
    state.podSentences = [
      { ...podSentence(1), scene_number: 1 }, { ...podSentence(2), scene_number: 1 },
      { ...podSentence(3), scene_number: 2 }, { ...podSentence(4), scene_number: 2 },
      { ...podSentence(5), scene_number: 3 }, { ...podSentence(6), scene_number: 3 },
    ]
    // Cohorts: [s1+s2], [s3+s4], [s5+s6]. 4 sentences covered = cohorts 1-2
    // completed → round 3: cohort 1 alive=3 (stage 2 under Phase-0's 2-round
    // duration), cohort 2 alive=2 (stage 1), cohort 3 debuts at alive=1.
    state.enrollment = { pod_activation_round: 6, completed_pod_rounds: 4 }
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLap()
    expect(lap!.podRound).toBe(3)
    const stages = (idx: number) => [...new Set(lap!.plays.filter(p => p.sentenceIdx === idx).map(p => p.stage))]
    expect(stages(1)).toEqual([2])
    expect(stages(2)).toEqual([2])
    expect(stages(3)).toEqual([1])
    expect(stages(4)).toEqual([1])
  })

  it('two-doors lift raises a cohort only as far as its LEAST-drilled member (cohesion beats drill-ahead)', async () => {
    // One cohort of two glued sentences. Sentence p1 was drilled hard in
    // Listening Drill (exposures 10); p2 never (no row). The cohort must NOT
    // fast-forward to p1's ladder position — both serve at the same stage,
    // lifted only by min(stored)+1 = 1 → derived alive 1 wins → stage 1.
    state.podSentences = [
      { ...podSentence(1), id: 'p1', glue_to_next: true },
      { ...podSentence(2), id: 'p2' },
    ]
    state.podState = [{ sentence_id: 'p1', exposures: 10 }]
    state.enrollment = { pod_activation_round: 6, completed_pod_rounds: 0 }
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLap()
    expect([...new Set(lap!.plays.map(p => p.stage))]).toEqual([1])
    // Both drilled: min lift = 5+1 = 6 → whole cohort serves at alive 6
    // together (stage 3 under durations {1:2, 2:3}).
    state.podState = [
      { sentence_id: 'p1', exposures: 10 },
      { sentence_id: 'p2', exposures: 5 },
    ]
    const s2 = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s2.initialize()
    const lap2 = s2.nextLap()
    expect([...new Set(lap2!.plays.map(p => p.stage))]).toEqual([3])
  })

  it('omits trans plays when sentence has no known_audio_id', async () => {
    state.podSentences = [{ ...podSentence(1), known_audio_id: null }]
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLap()
    expect(lap!.plays.find(p => p.playRole === 'trans')).toBeUndefined()
  })

  // ── End-on-target invariant (Aran 2026-06-21 hiccup) ──────────────────────
  it('appends a target close when a stage playlist ends on trans (never strands on the known language)', async () => {
    // Saved stage ending on 'trans' played Croatian → English → next sentence
    // with no target to close. The guard appends one target rep.
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
      stagePlaylist: { '1': ['ps', 'trans'] },
      listeningPolicy: STAGE_LADDER_POLICY,
    })
    await s.initialize()
    const lap = s.nextLap()
    const s1 = lap!.plays.filter(p => p.sentenceIdx === 1)
    expect(s1.map(p => p.playRole)).toEqual(['ps', 'trans', 'ps'])
  })

  it('mirrors the last target speed for the appended close (…ps2x, trans → + ps2x)', async () => {
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
      stagePlaylist: { '1': ['ps2x', 'trans'] },
      listeningPolicy: STAGE_LADDER_POLICY,
    })
    await s.initialize()
    const lap = s.nextLap()
    const s1 = lap!.plays.filter(p => p.sentenceIdx === 1)
    expect(s1.map(p => p.playRole)).toEqual(['ps2x', 'trans', 'ps2x'])
    expect(s1[s1.length - 1].playbackSpeed).toBe(2.0)
  })

  it('leaves a well-formed playlist (already ends on target) untouched — no extra rep', async () => {
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
      stagePlaylist: { '1': ['ps', 'trans', 'ps2x'] },
      listeningPolicy: STAGE_LADDER_POLICY,
    })
    await s.initialize()
    const lap = s.nextLap()
    const s1 = lap!.plays.filter(p => p.sentenceIdx === 1)
    expect(s1.map(p => p.playRole)).toEqual(['ps', 'trans', 'ps2x'])
  })

  it('returns null when no pod sentences exist', async () => {
    state.podSentences = []
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    expect(s.nextLap()).toBeNull()
  })

  it('omits bookends when only one is configured (must have both)', async () => {
    state.bookends = [bookendIntro] // outro missing
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLap()
    expect(lap!.intro).toBeNull()
    expect(lap!.outro).toBeNull()
  })
})

describe('usePodLapScheduler — nextLapPreviewFallback (?pod=1 preview cheat)', () => {
  let state: MockState
  beforeEach(() => {
    state = {
      podSentences: [podSentence(1), podSentence(2), podSentence(3)],
      bookends: [bookendIntro, bookendOutro],
      enrollment: { pod_activation_round: 6, completed_pod_rounds: 0 },
      enrollmentUpdates: [],
    }
  })

  it('returns null when the course has no pod content at all', async () => {
    state.podSentences = []
    const s = usePodLapScheduler({ supabase: makeMockSupabase(state), courseCode: 'c', learnerId: 'u' })
    await s.initialize()
    expect(s.nextLapPreviewFallback()).toBeNull()
  })

  it('finds a playable COHORT when the ratchet-windowed slice has nothing (whole first cohort missing audio)', async () => {
    // Ratchet is fresh (round 1 → cohort 1 only) and the entire first cohort
    // (scene 1, three lines) has no target audio. Real cadence and the plain
    // preview cheat would both stay stuck forever; the fallback must reach
    // past the window to cohort 2 (scene 2).
    state.podSentences = [
      { ...podSentence(1), target_audio_id: null, scene_number: 1 },
      { ...podSentence(2), target_audio_id: null, scene_number: 1 },
      { ...podSentence(3), target_audio_id: null, scene_number: 1 },
      { ...podSentence(4), scene_number: 2 },
      { ...podSentence(5), scene_number: 2 },
    ]
    const s = usePodLapScheduler({ supabase: makeMockSupabase(state), courseCode: 'c', learnerId: 'u' })
    await s.initialize()
    expect(s.nextLap()).toBeNull() // confirms the windowed path is genuinely stuck
    const lap = s.nextLapPreviewFallback()
    expect(lap).not.toBeNull()
    // The whole second cohort previews — an exchange, like a real lap.
    expect(lap!.plays.map(p => p.sentenceIdx)).toEqual([4, 4, 4, 4, 5, 5, 5, 5])
  })

  it('searches outward from the ratchet cursor, reaching the farthest sentence only when nothing closer is playable', async () => {
    // Ratchet cursor sits at index 2 (0-based) — completedPodRounds=2, TOTAL=5.
    // Everything except the last sentence (idx 4, two steps away) is unplayable.
    state.enrollment = { pod_activation_round: 1, completed_pod_rounds: 2 }
    state.podSentences = [
      { ...podSentence(1), target_audio_id: null },
      { ...podSentence(2), target_audio_id: null },
      { ...podSentence(3), target_audio_id: null },
      { ...podSentence(4), target_audio_id: null },
      podSentence(5),
    ]
    const s = usePodLapScheduler({ supabase: makeMockSupabase(state), courseCode: 'c', learnerId: 'u' })
    await s.initialize()
    const lap = s.nextLapPreviewFallback()
    expect(lap).not.toBeNull()
    expect(lap!.plays.every(p => p.sentenceIdx === 5)).toBe(true)
  })

  it('returns null when every sentence in the course is unplayable', async () => {
    state.podSentences = [
      { ...podSentence(1), target_audio_id: null },
      { ...podSentence(2), target_audio_id: null },
    ]
    const s = usePodLapScheduler({ supabase: makeMockSupabase(state), courseCode: 'c', learnerId: 'u' })
    await s.initialize()
    expect(s.nextLapPreviewFallback()).toBeNull()
  })
})

describe('usePodLapScheduler — per-sentence split (flattenPodRows integration)', () => {
  // A whole speaker TURN row that's been silence-split: target_audio_id /
  // known_audio_id are the WHOLE-turn clips (must never be played once split);
  // sentence_audio_ids / sentence_known_audio_ids hold the per-sentence clips.
  const splitTurn = {
    id: 'c:pod-0:SC01-S001',
    global_order: 1,
    speaker: 'Sarah',
    target_text: 'Buongiorno. Come stai?',
    known_text: 'Good morning. How are you?',
    target_audio_id: 'TURN_TGT',
    known_audio_id: 'TURN_KN',
    explainer_audio_id: null,
    glue_to_next: false,
    atom_map: null,
    sentence_audio_ids: ['t0', 't1'],
    sentence_known_audio_ids: ['k0', 'k1'],
  }

  it('plays the SENTENCE as the unit: target/known interleave PER sentence, never the whole-turn clip', async () => {
    const state: MockState = {
      podSentences: [splitTurn],
      bookends: [bookendIntro, bookendOutro],
      // podRound = 2 → both split sentences active (activeCount = min(2,2)).
      enrollment: { pod_activation_round: 1, completed_pod_rounds: 1 },
      enrollmentUpdates: [],
    }
    const s = usePodLapScheduler({ supabase: makeMockSupabase(state), courseCode: 'c', learnerId: 'u' })
    await s.initialize()
    const lap = s.nextLap()
    expect(lap).not.toBeNull()
    const ids = lap!.plays.map(p => p.audioId)
    // The whole-turn clips (3 sentences each) must NEVER play — that was the
    // "3 target sentences then 3 known sentences" bug (Tom 2026-06-16).
    expect(ids).not.toContain('TURN_TGT')
    expect(ids).not.toContain('TURN_KN')
    // Each sentence plays its FULL four-slot pattern before the next —
    // target→known→target→target PER sentence (Tom 2026-08-07).
    expect(ids).toEqual(['t0', 'k0', 't0', 't0', 't1', 'k1', 't1', 't1'])
    expect(lap!.plays.map(p => p.playRole)).toEqual(
      ['ps', 'trans', 'ps', 'ps', 'ps', 'trans', 'ps', 'ps'])
    // Distinct sentenceIdx → podGapMs treats the two sentences as separate chunks.
    expect(lap!.plays.map(p => p.sentenceIdx)).toEqual([1, 1, 1, 1, 2, 2, 2, 2])
  })

  it('a row without a split passes through as one whole-turn unit (back-compat)', async () => {
    const state: MockState = {
      podSentences: [{ ...splitTurn, sentence_audio_ids: null, sentence_known_audio_ids: null }],
      bookends: [bookendIntro, bookendOutro],
      enrollment: { pod_activation_round: 1, completed_pod_rounds: 0 },
      enrollmentUpdates: [],
    }
    const s = usePodLapScheduler({ supabase: makeMockSupabase(state), courseCode: 'c', learnerId: 'u' })
    await s.initialize()
    const lap = s.nextLap()
    // The whole-turn clip plays as a single unit — unchanged behaviour.
    expect(lap!.plays.map(p => p.audioId)).toEqual(['TURN_TGT', 'TURN_KN', 'TURN_TGT', 'TURN_TGT'])
    expect(lap!.plays.every(p => p.sentenceIdx === 1)).toBe(true)
  })
})

describe('usePodLapScheduler — ratchet semantics', () => {
  let state: MockState
  beforeEach(() => {
    state = {
      podSentences: [podSentence(1), podSentence(2)],
      bookends: [bookendIntro, bookendOutro],
      enrollment: { pod_activation_round: 6, completed_pod_rounds: 3 },
      enrollmentUpdates: [],
    }
  })

  it('markLapCompleted increments counter and persists', async () => {
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'real-uuid',
    })
    await s.initialize()
    expect(s.completedPodRounds.value).toBe(3)
    await s.markLapCompleted()
    expect(s.completedPodRounds.value).toBe(4)
    expect(state.enrollmentUpdates).toContainEqual({ completed_pod_rounds: 4 })
  })

  it('skipping a lap (no markLapCompleted call) leaves counter unchanged', async () => {
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'real-uuid',
    })
    await s.initialize()
    // simulate "user skipped" — caller does NOT invoke markLapCompleted
    expect(s.completedPodRounds.value).toBe(3)
    expect(state.enrollmentUpdates).toEqual([])
    // Next lap is still keyed off the same ratchet: both sentences form one
    // cohort (started) and the ratchet is 1 past its end → cohort-round 3.
    const lap = s.nextLap()
    expect(lap!.podRound).toBe(3)
  })

  // The `skipAhead` ratchet bump was Turbo's alone and went with Turbo
  // (retired 2026-08-06). The counter now only ever advances by a played
  // lap — see 'markLapCompleted' above.

  it('reset clears the counter and pin', async () => {
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'real-uuid',
    })
    await s.initialize()
    await s.reset()
    expect(s.completedPodRounds.value).toBe(0)
    // Default activation is 5 (was 6 pre-65ee76b8).
    expect(s.podActivationRound.value).toBe(5)
    expect(state.enrollmentUpdates).toContainEqual({
      completed_pod_rounds: 0,
      pod_activation_round: null,
    })
  })

  it('guests do not write to course_enrollments', async () => {
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'guest-abc',
    })
    await s.initialize()
    await s.markLapCompleted()
    // In-memory: completing the first lap covers the whole first cohort
    // (both fixture sentences), so the sentence-unit ratchet lands on 2.
    expect(s.completedPodRounds.value).toBe(2)
    expect(state.enrollmentUpdates).toEqual([])
  })
})

describe('usePodLapScheduler — reactive args', () => {
  it('accepts ref-wrapped supabase, courseCode, learnerId', async () => {
    const state: MockState = {
      podSentences: [podSentence(1)],
      bookends: [bookendIntro, bookendOutro],
      enrollment: null,
      enrollmentUpdates: [],
    }
    const courseCode = ref('c')
    const learnerId = ref<string | null>('u')
    const supabase = ref<any>(makeMockSupabase(state))
    const s = usePodLapScheduler({ supabase, courseCode, learnerId })
    await s.initialize()
    expect(s.isInitialized.value).toBe(true)
    expect(s.nextLap()!.podRound).toBe(1)
  })
})
