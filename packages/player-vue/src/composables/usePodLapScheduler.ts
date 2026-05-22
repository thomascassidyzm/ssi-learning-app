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

export type PodPlayRole = 'ps08x' | 'ps' | 'ps15x' | 'ps2x' | 'trans'

/** Role → runtime playback rate. Single source of truth. */
const ROLE_SPEED: Record<string, number> = {
  ps08x: 0.8,
  ps: 1.0,
  ps15x: 1.5,
  ps2x: 2.0,
  trans: 1.0,
}

/**
 * Default stage playlists — mirrored to the `pods` row in algorithm_config.
 * PS = pod sentence at 1.0×, PS×2 at 2.0×, trans = known-language translation.
 *
 * The number of stages is *not* hardcoded in the runtime — podStageFor reads
 * `totalStages` from the actual playlist. Admins can add / remove stages
 * from the listening admin page without code changes; the highest-numbered
 * stage is always treated as the eternal hold.
 *
 * Stage 1 is intentionally all 1.0× — no 2× until stage 2 — so the learner
 * gets a clean target / known / target / target intro. Aran's 2026-05-07
 * insertion (new stage 2) bridges the jump from "no 2×" to "all 2×".
 */
export const DEFAULT_STAGE_PLAYLIST: Record<number, PodPlayRole[]> = {
  1: ['ps', 'trans', 'ps', 'ps'],
  2: ['ps', 'trans', 'ps', 'ps2x'],
  3: ['ps', 'trans', 'ps2x', 'ps2x'],
  4: ['ps', 'trans', 'ps2x'],
  5: ['ps2x', 'trans', 'ps2x'],
  6: ['ps', 'ps2x'],
  7: ['ps2x', 'ps2x'],
  8: ['ps2x'],
}

/**
 * Default pod-rounds spent in each transitional stage before promoting.
 * The final stage is eternal regardless. Aran asked for 5 (was 3) — gives
 * the learner more reps at each pattern before the speed/structure changes.
 */
export const DEFAULT_STAGE_DURATION = 5

/**
 * Map an alive-count to a stage. Transitional stages 1..(totalStages-1)
 * each last `stageDuration` pod-rounds; the highest-numbered stage is
 * eternal. `totalStages` defaults to the length of DEFAULT_STAGE_PLAYLIST
 * so unit tests calling podStageFor() without args still see consistent
 * behaviour; callers in the runtime pass the live playlist's key count.
 */
export function podStageFor(
  entryPodRound: number,
  currentPodRound: number,
  stageDuration: number = DEFAULT_STAGE_DURATION,
  totalStages: number = Object.keys(DEFAULT_STAGE_PLAYLIST).length,
): { stage: number; iter: number | null } | null {
  const alive = currentPodRound - entryPodRound + 1
  if (alive < 1) return null
  for (let stage = 1; stage < totalStages; stage++) {
    const stageEnd = stage * stageDuration
    if (alive <= stageEnd) {
      return { stage, iter: alive - (stage - 1) * stageDuration }
    }
  }
  return { stage: totalStages, iter: null }
}

const DEFAULT_POD_ACTIVATION = 5

// Hotfix cap (2026-05-20). Some learners have stale enrollment values like
// 21 / 31 / 58 from an earlier activation rule. Cap at 5 so the first pod
// surfaces ~5 rounds into a session (gives the learner time to settle into
// speaking practice before listening pods start interleaving). The proper
// redesign (mode-agnostic monotonic counter, growing intervals like
// 2 / 2 / 3 / 3 / 4 / 4 / 5 / 5 / 5 / 5...) lands separately.
const POD_ACTIVATION_CAP = 5

// ============================================================================
// Types
// ============================================================================

export interface PodSentenceRow {
  global_order: number
  target_text: string
  known_text: string
  target_audio_id: string | null
  known_audio_id: string | null
  /** True iff this row's natural utterance continues into the next row.
   *  Drives inter-chunk gap timing in the runtime player — glued chunks
   *  flow tight; the last chunk of an utterance gets the longer
   *  between-phrases pause. */
  glue_to_next: boolean
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
  /** Display text (target for ps*; known for trans). May be empty. */
  text: string
  /** Native script variant when target uses romanization (not currently populated; future use). */
  textNative?: string
  /** Runtime playback rate per ROLE_SPEED — 0.8 / 1.0 / 1.5 / 2.0. */
  playbackSpeed: number
  /** True iff this play's source sentence has glue_to_next set AND this is
   *  the LAST play in the source sentence's playlist. Tells the runtime
   *  player to use a glued-chunk gap (tight, or zero at stage 7) before
   *  the next play, rather than the standard between-phrases gap. False
   *  for plays mid-sentence — those use the within-chunk gap matrix. */
  glueToNextChunk: boolean
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
  /** Stage playlist override — keyed by stage number ('1'..'7'). When omitted,
   *  uses DEFAULT_STAGE_PLAYLIST. Reactive so admin tweaks via algorithm_config
   *  flow through on next lap. */
  stagePlaylist?: Ref<Record<string, PodPlayRole[]>> | Record<string, PodPlayRole[]>
  /** Pod-rounds per stage 1-6. Defaults to DEFAULT_STAGE_DURATION. */
  stageDuration?: Ref<number> | number
  /** Fire a pod-lap every N main rounds from activation onward. Default 1
   *  (every round). Stretches every stage proportionally because the
   *  pod-round ratchet only ticks on actual fires. */
  roundInterval?: Ref<number> | number
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
          .select('global_order, target_text, known_text, target_audio_id, known_audio_id, glue_to_next')
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
        // Cap stale lifetime activation values (e.g. 21, 31, 58) so they
        // don't keep pods locked behind a 20+-round wait. See
        // POD_ACTIVATION_CAP block above for context.
        const stored = enrollment.pod_activation_round
        podActivationRound.value = stored != null
          ? Math.min(stored, POD_ACTIVATION_CAP)
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

  /**
   * Sticky flag that forces the NEXT round to fire a lap regardless of the
   * cadence rule. Set by deferLap() — typically when a session resumes
   * mid-round and the remaining cycles are too few for the pod audio to
   * pre-warm. Cleared once we actually consume the lap (markLapCompleted
   * / skipAhead). Cadence anchor is unaffected, so the regular schedule
   * resumes normally on the round after the deferred firing.
   */
  const deferredPodPending = ref(false)

  /** True iff pods should fire at the given main round. */
  const shouldFireLapAt = (mainRound: number): boolean => {
    if (!isInitialized.value) return false
    if (podSentences.value.length === 0) return false
    if (mainRound < podActivationRound.value) return false
    if (deferredPodPending.value) return true
    const interval = Math.max(1, Math.floor(unwrap(options.roundInterval) ?? 1))
    return (mainRound - podActivationRound.value) % interval === 0
  }

  /**
   * Defer the next due lap by one round. Caller invokes this when a pod is
   * about to fire but there aren't enough cycles left to pre-warm its audio
   * (resume mid-round). The defer flag forces shouldFireLapAt to return true
   * on the NEXT round entry, giving a full round of runway for prefetchLap
   * to land the audio.
   */
  const deferLap = (): void => {
    deferredPodPending.value = true
  }

  /**
   * Fire-and-forget warm-up of the next lap's audio. Pods live behind a
   * full round (~5 min) of buffer when prefetched on round entry, so we
   * use priority='low' — the prefetch shouldn't compete with current
   * cycle's known audio (high) or next cycle's known prefetch (high).
   *
   * No-op if there's no lap to fetch. Idempotent — repeated calls just
   * hit the SW cache layer redundantly which is harmless.
   */
  const prefetchLap = (): void => {
    if (podSentences.value.length === 0) return
    const lap = nextLap()
    if (!lap) return
    const ids = new Set<string>()
    if (lap.intro?.id) ids.add(lap.intro.id)
    if (lap.outro?.id) ids.add(lap.outro.id)
    for (const p of lap.plays) {
      if (p.audioId) ids.add(p.audioId)
    }
    for (const id of ids) {
      const url = `/api/audio/${id}`
      fetch(url, { priority: 'low' }).catch(() => undefined)
    }
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

    // Snapshot the live config — stagePlaylist keys are strings in JSON,
    // numbers in the default; normalise via `String(stage)` lookup.
    // totalStages is derived from the actual key count so admins can
    // add or remove stages from the admin page without code changes.
    const livePlaylist = unwrap(options.stagePlaylist) as Record<string | number, PodPlayRole[]> | undefined
    const liveDuration = unwrap(options.stageDuration) as number | undefined
    const stagePlaylistMap: Record<string | number, PodPlayRole[]> = livePlaylist || DEFAULT_STAGE_PLAYLIST
    const stageDuration: number = liveDuration ?? DEFAULT_STAGE_DURATION
    const totalStages = Object.keys(stagePlaylistMap).length

    const plays: PodPlay[] = []
    for (let i = 1; i <= activeCount; i++) {
      const sentence = podSentences.value[i - 1]
      if (!sentence.target_audio_id) continue
      const stageInfo = podStageFor(i, podRound, stageDuration, totalStages)
      if (!stageInfo) continue
      const playlist = stagePlaylistMap[stageInfo.stage] || stagePlaylistMap[String(stageInfo.stage)]
      if (!playlist) continue
      for (let j = 0; j < playlist.length; j++) {
        const playRole = playlist[j]
        if (playRole === 'trans' && !sentence.known_audio_id) continue
        const isTrans = playRole === 'trans'
        const audioId = isTrans ? sentence.known_audio_id! : sentence.target_audio_id!
        // glueToNextChunk is set on the LAST play of a sentence whose
        // source row has glue_to_next = true. Earlier plays in the
        // sentence stay false (they use within-chunk gap matrix); only
        // the final play looks ahead to the next chunk's first play.
        const isLastPlayInSentence = j === playlist.length - 1
        plays.push({
          sentenceIdx: i,
          stage: stageInfo.stage,
          playRole,
          audioId,
          text: isTrans ? sentence.known_text : sentence.target_text,
          playbackSpeed: ROLE_SPEED[playRole] ?? 1.0,
          glueToNextChunk: isLastPlayInSentence && !!sentence.glue_to_next,
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
    deferredPodPending.value = false
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
    deferredPodPending.value = false
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
    prefetchLap,
    deferLap,
    markLapCompleted,
    skipAhead,
    reset,
  }
}
