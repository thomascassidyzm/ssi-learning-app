import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { usePodLapScheduler, podStageFor, DEFAULT_STAGE_DURATIONS } from './usePodLapScheduler'

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
        return Promise.resolve({ data: null, error: null }).then(cb)
      },
    }
    return chain
  }
  return { from: builder } as any
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

  it('first lap (ratchet=0 → podRound=1) plays sentence 1 at Phase 0: ps,trans,ps (no explainer audio → translation fallback)', async () => {
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLap()
    expect(lap).not.toBeNull()
    expect(lap!.podRound).toBe(1)
    // Stage 1 ("Phase 0", Tom 2026-06-10) playlist is ['ps','explainer','ps'] —
    // explainer INSTEAD of translation. This fixture sentence has no
    // explainer_audio_id (fully-repeat line / vocab coda upstream), so the
    // explainer slot falls back to the TRANSLATION → ['ps','trans','ps'].
    // Meaning always arrives. Still all 1.0× (speed ramp from stage 3).
    expect(lap!.plays.map(p => p.playRole)).toEqual(['ps', 'trans', 'ps'])
    expect(lap!.plays.every(p => p.sentenceIdx === 1)).toBe(true)
    expect(lap!.plays.every(p => p.playbackSpeed === 1.0)).toBe(true)
    expect(lap!.intro?.id).toBe('intro-1')
    expect(lap!.outro?.id).toBe('outro-1')
  })

  it('Phase 0 plays the explainer INSTEAD of the translation when explainer audio exists', async () => {
    state.podSentences = [{ ...podSentence(1), explainer_audio_id: 'exp-1' }]
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLap()
    expect(lap!.plays.map(p => p.playRole)).toEqual(['ps', 'explainer', 'ps'])
    expect(lap!.plays.find(p => p.playRole === 'explainer')!.audioId).toBe('exp-1')
    expect(lap!.plays.find(p => p.playRole === 'trans')).toBeUndefined()
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
    // podRound=3 → sentence 1 alive=3 → stage 2 ('Phase 1': ['ps','trans','ps']).
    const s1 = lap!.plays.filter(p => p.sentenceIdx === 1)
    expect(s1.map(p => p.playRole)).toEqual(['ps', 'trans', 'ps'])
    expect(s1.find(p => p.playRole === 'explainer')).toBeUndefined()
  })

  it('second lap (ratchet=1 → podRound=2) covers sentences 1 and 2 both in stage 1', async () => {
    state.enrollment = { pod_activation_round: 6, completed_pod_rounds: 1 }
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLap()
    const idxs = new Set(lap!.plays.map(p => p.sentenceIdx))
    expect(idxs).toEqual(new Set([1, 2]))
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
    // Each sentence plays fully (ps,trans,ps via the explainer→trans fallback)
    // before the next — target→known→target PER sentence.
    expect(ids).toEqual(['t0', 'k0', 't0', 't1', 'k1', 't1'])
    expect(lap!.plays.map(p => p.playRole)).toEqual(['ps', 'trans', 'ps', 'ps', 'trans', 'ps'])
    // Distinct sentenceIdx → podGapMs treats the two sentences as separate chunks.
    expect(lap!.plays.map(p => p.sentenceIdx)).toEqual([1, 1, 1, 2, 2, 2])
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
    expect(lap!.plays.map(p => p.audioId)).toEqual(['TURN_TGT', 'TURN_KN', 'TURN_TGT'])
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
    // next lap is still keyed off podRound = 4 (3 + 1)
    const lap = s.nextLap()
    expect(lap!.podRound).toBe(4)
  })

  it('skipAhead bumps counter by N without playing', async () => {
    const s = usePodLapScheduler({
      supabase: makeMockSupabase(state),
      courseCode: 'c',
      learnerId: 'real-uuid',
    })
    await s.initialize()
    await s.skipAhead(5)
    expect(s.completedPodRounds.value).toBe(8)
    expect(state.enrollmentUpdates).toContainEqual({ completed_pod_rounds: 8 })
  })

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
    expect(s.completedPodRounds.value).toBe(1) // in-memory
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
