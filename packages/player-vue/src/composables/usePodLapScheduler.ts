/**
 * usePodLapScheduler — runtime scheduler for Listening Pods (Layer 2).
 *
 * Sibling to MetaCommentaryService. Replaces the previous script-baked
 * approach where pod laps were emitted into rounds at every main-round ≥
 * activation, with stage progression keyed off `main_round - activation + 1`.
 *
 * The old model coupled pod state to main-flow position. Belt-skipping
 * (round 60 → 120) caused a 60-sentence avalanche. Going back to earlier
 * rounds re-fired pod content. Skipping a single pod meant losing it.
 *
 * New model — Listening Pods are an independent track with their own
 * ratchet counter (`course_enrollments.completed_pod_rounds`):
 *
 *   • Pod-round in stage maths = `completed_pod_rounds + 1`
 *   • Each completed lap → counter += 1
 *   • Skipped lap → counter unchanged → same content next session
 *   • Belt-skip → no avalanche; pods just keep advancing one per played lap
 *   • Going back to earlier main rounds → pods continue forward
 *   • Course reset → counter back to 0 (and pod_activation_round back to NULL)
 *   • Turbo → explicit increment without playing (skipAhead method)
 *
 * `pod_activation_round` (added 2026-05-03) still gates the main-round at
 * which pods START FIRING for that user.
 *
 * Guests (no enrollment row): use an in-memory counter that resets each
 * session. Friendlier than skipping pods entirely; matches the model where
 * guest progress is ephemeral anyway.
 */

import { ref, shallowRef, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// Pod stage logic — mirrors what was in generateLearningScript.ts
// ============================================================================

export type PodPlayRole = 'ps' | 'trans' | 'ps2x'

/**
 * Stage playlists per Aran's road-test 2026-05-05.
 * PS = pod sentence at 1.0×, PS×2 at 2.0×, trans = known-language translation.
 * Stage 1 is intentionally all 1.0× — no 2× until stage 2 — so the learner
 * gets a clean target / known / target / target intro.
 */
const STAGE_PLAYLIST: Record<number, PodPlayRole[]> = {
  1: ['ps', 'trans', 'ps', 'ps'],
  2: ['ps', 'trans', 'ps2x', 'ps2x'],
  3: ['ps', 'trans', 'ps2x'],
  4: ['ps2x', 'trans', 'ps2x'],
  5: ['ps', 'ps2x'],
  6: ['ps2x', 'ps2x'],
  7: ['ps2x'],
}

/**
 * Pod-rounds spent in each of stages 1–6 before promoting to the next.
 * Stage 7 is the eternal holding bay. Aran asked for 5 (was 3) — gives the
 * learner more reps at each pattern before the speed/structure changes.
 */
const STAGE_DURATION = 5

/** Stages 1–6 each last STAGE_DURATION pod-rounds; stage 7 is eternal. */
export function podStageFor(
  entryPodRound: number,
  currentPodRound: number
): { stage: number; iter: number | null } | null {
  const alive = currentPodRound - entryPodRound + 1
  if (alive < 1) return null
  for (let stage = 1; stage <= 6; stage++) {
    const stageEnd = stage * STAGE_DURATION
    if (alive <= stageEnd) {
      return { stage, iter: alive - (stage - 1) * STAGE_DURATION }
    }
  }
  return { stage: 7, iter: null }
}

const DEFAULT_POD_ACTIVATION = 6

// ============================================================================
// Types
// ============================================================================

export interface PodSentenceRow {
  global_order: number
  target_text: string
  known_text: string
  target_audio_id: string | null
  known_audio_id: string | null
}

export interface BookendAudio {
  id: string
  text: string
  duration_ms?: number
}

export interface PodPlay {
  /** 1-based sentence index (matches global_order) */
  sentenceIdx: number
  /** Stage 1–7 */
  stage: number
  /** What's playing in this slot of the lap */
  playRole: PodPlayRole
  /** UUID of audio to play. For 'trans' = sentence.known_audio_id; otherwise sentence.target_audio_id. */
  audioId: string
  /** Display text (target for ps/ps2x, known for trans). May be empty. */
  text: string
  /** Native script variant when target uses romanization (not currently populated; future use). */
  textNative?: string
  /** 1.0 for ps/trans, 2.0 for ps2x. */
  playbackSpeed: number
}

export interface PodLap {
  /** Pod-round number this lap represents (= completed_pod_rounds + 1). */
  podRound: number
  /** Bookend to play before the lap. Null if not generated for this course. */
  intro: BookendAudio | null
  /** Plays in lap order. */
  plays: PodPlay[]
  /** Bookend to play after the lap. Null if not generated for this course. */
  outro: BookendAudio | null
}

export interface UsePodLapSchedulerOptions {
  supabase: Ref<SupabaseClient | null> | SupabaseClient | null
  /** Reactive course code — scheduler re-loads when this changes. */
  courseCode: Ref<string> | string
  /** Reactive learner ID. Guests (id starts with `guest-`) use in-memory counter. */
  learnerId: Ref<string | null | undefined> | string | null | undefined
}

const isGuestLearner = (id: string | null | undefined): boolean => {
  return !id || id === 'demo-learner' || id.startsWith('guest-')
}

const unwrap = <T,>(v: Ref<T> | T): T =>
  v && typeof v === 'object' && 'value' in (v as any) ? (v as Ref<T>).value : (v as T)

// ============================================================================
// Composable
// ============================================================================

export function usePodLapScheduler(options: UsePodLapSchedulerOptions) {
  const supabaseRef = options.supabase
  const courseCodeRef = options.courseCode
  const learnerIdRef = options.learnerId

  const isInitialized = ref(false)
  const isLoading = ref(false)
  const podSentences = shallowRef<PodSentenceRow[]>([])
  const introAudio = ref<BookendAudio | null>(null)
  const outroAudio = ref<BookendAudio | null>(null)

  /** Main-round at which pods START FIRING. NULL → use default 6. */
  const podActivationRound = ref<number>(DEFAULT_POD_ACTIVATION)
  /** Independent ratchet counter. Increments only on completed laps. */
  const completedPodRounds = ref<number>(0)

  /**
   * Load pod sentences, bookends, and the learner's enrollment ratchet state.
   * Idempotent — safe to call again on course or learner change.
   */
  const initialize = async (): Promise<void> => {
    const supabase = unwrap(supabaseRef)
    const courseCode = unwrap(courseCodeRef)
    const learnerId = unwrap(learnerIdRef)
    if (!supabase || !courseCode) return

    isLoading.value = true
    try {
      const [podsResult, bookendsResult, enrollmentResult] = await Promise.all([
        supabase
          .from('listening_pod_sentences')
          .select('global_order, target_text, known_text, target_audio_id, known_audio_id')
          .eq('pod_id', `${courseCode}:pod-0`)
          .order('global_order', { ascending: true }),
        supabase
          .from('course_audio')
          .select('role, text, id, duration_ms')
          .eq('course_code', courseCode)
          .in('role', ['bookend_listen_intro', 'bookend_listen_outro']),
        // Guests have no enrollment row → in-memory counter only.
        !isGuestLearner(learnerId)
          ? supabase
              .from('course_enrollments')
              .select('pod_activation_round, completed_pod_rounds')
              .eq('learner_id', learnerId)
              .eq('course_id', courseCode)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as { data: null; error: null }),
      ])

      if (podsResult.error) throw new Error(`pod sentences: ${podsResult.error.message}`)
      if (bookendsResult.error) throw new Error(`bookends: ${bookendsResult.error.message}`)

      podSentences.value = (podsResult.data || []) as PodSentenceRow[]

      const byRole = new Map<string, BookendAudio>()
      for (const row of (bookendsResult.data || []) as Array<{
        role: string
        text: string
        id: string
        duration_ms?: number
      }>) {
        byRole.set(row.role, { id: row.id, text: row.text, duration_ms: row.duration_ms })
      }
      introAudio.value = byRole.get('bookend_listen_intro') || null
      outroAudio.value = byRole.get('bookend_listen_outro') || null

      const enrollment = (enrollmentResult as any)?.data
      if (enrollment) {
        podActivationRound.value =
          enrollment.pod_activation_round != null
            ? enrollment.pod_activation_round
            : DEFAULT_POD_ACTIVATION
        completedPodRounds.value = enrollment.completed_pod_rounds ?? 0
      } else {
        // Brand-new enrollment, guest, or read failed — keep defaults.
        podActivationRound.value = DEFAULT_POD_ACTIVATION
        completedPodRounds.value = 0
      }

      isInitialized.value = true
    } catch (err) {
      console.warn('[podLapScheduler] init failed:', err)
    } finally {
      isLoading.value = false
    }
  }

  /** True iff pods should fire at the given main round. */
  const shouldFireLapAt = (mainRound: number): boolean => {
    if (!isInitialized.value) return false
    if (podSentences.value.length === 0) return false
    return mainRound >= podActivationRound.value
  }

  /**
   * Compose the lap that should play right now, based on the current ratchet
   * value. Returns null if there's nothing to play (no sentences, or every
   * sentence's audio is missing).
   */
  const nextLap = (): PodLap | null => {
    if (podSentences.value.length === 0) return null

    const podRound = completedPodRounds.value + 1
    const TOTAL = podSentences.value.length
    const activeCount = Math.min(podRound, TOTAL)
    if (activeCount < 1) return null

    const plays: PodPlay[] = []
    for (let i = 1; i <= activeCount; i++) {
      const sentence = podSentences.value[i - 1]
      if (!sentence.target_audio_id) continue
      const stageInfo = podStageFor(i, podRound)
      if (!stageInfo) continue
      for (const playRole of STAGE_PLAYLIST[stageInfo.stage]) {
        if (playRole === 'trans' && !sentence.known_audio_id) continue
        const isTrans = playRole === 'trans'
        const audioId = isTrans ? sentence.known_audio_id! : sentence.target_audio_id!
        plays.push({
          sentenceIdx: i,
          stage: stageInfo.stage,
          playRole,
          audioId,
          text: isTrans ? sentence.known_text : sentence.target_text,
          playbackSpeed: playRole === 'ps2x' ? 2.0 : 1.0,
        })
      }
    }
    if (plays.length === 0) return null

    const hasBookends = !!(introAudio.value && outroAudio.value)
    return {
      podRound,
      intro: hasBookends ? introAudio.value : null,
      plays,
      outro: hasBookends ? outroAudio.value : null,
    }
  }

  /**
   * Advance the ratchet by 1. Call this only after the user has played the
   * lap to completion — skipped laps must NOT call this.
   */
  const markLapCompleted = async (): Promise<void> => {
    completedPodRounds.value += 1
    await persistRatchet()
  }

  /**
   * Turbo path: bump the counter without playing. UI affordance is out of
   * scope; this just exposes the increment so a settings toggle or shortcut
   * can call it.
   */
  const skipAhead = async (n: number = 1): Promise<void> => {
    if (n <= 0) return
    completedPodRounds.value += n
    await persistRatchet()
  }

  /**
   * Reset the ratchet (for course reset). Also clears the activation pin so
   * it gets recaptured on next session.
   */
  const reset = async (): Promise<void> => {
    completedPodRounds.value = 0
    podActivationRound.value = DEFAULT_POD_ACTIVATION

    const supabase = unwrap(supabaseRef)
    const learnerId = unwrap(learnerIdRef)
    const courseCode = unwrap(courseCodeRef)
    if (!supabase || !courseCode || !learnerId || isGuestLearner(learnerId)) return
    try {
      await supabase
        .from('course_enrollments')
        .update({ completed_pod_rounds: 0, pod_activation_round: null })
        .eq('learner_id', learnerId)
        .eq('course_id', courseCode)
    } catch (err) {
      console.warn('[podLapScheduler] reset write failed:', err)
    }
  }

  /**
   * Persist the ratchet counter to course_enrollments. Guests no-op.
   * Errors are logged but don't throw — runtime audio shouldn't depend on
   * a successful DB write.
   */
  const persistRatchet = async (): Promise<void> => {
    const supabase = unwrap(supabaseRef)
    const learnerId = unwrap(learnerIdRef)
    const courseCode = unwrap(courseCodeRef)
    if (!supabase || !courseCode || !learnerId || isGuestLearner(learnerId)) return
    try {
      const { error } = await supabase
        .from('course_enrollments')
        .update({ completed_pod_rounds: completedPodRounds.value })
        .eq('learner_id', learnerId)
        .eq('course_id', courseCode)
      if (error) console.warn('[podLapScheduler] persist error:', error.message)
    } catch (err) {
      console.warn('[podLapScheduler] persist threw:', err)
    }
  }

  return {
    // State
    isInitialized,
    isLoading,
    podActivationRound,
    completedPodRounds,
    podSentences,
    introAudio,
    outroAudio,

    // Methods
    initialize,
    shouldFireLapAt,
    nextLap,
    markLapCompleted,
    skipAhead,
    reset,
  }
}
