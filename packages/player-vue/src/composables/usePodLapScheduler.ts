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
import {
  resolveAtoms,
  stage0ViewFor,
  type Stage0Config,
  type AtomMapEntry,
  ROLE_SPEED,
  isTargetRole,
  buildStage0Tier,
  buildMainStage,
  loadStage0ClipMaps,
  type PodPlayRole,
  type PodPlay,
  type PodSentenceRow,
} from '@ssi/core/pods'
import { PodStateStore } from '@ssi/core'
import { splitRowUnits } from './podSentenceSplit'

// Re-export the moved symbols so existing importers (LearningPlayer,
// ListeningOverlay, PodStageAuditioner, tests) keep their import paths.
export {
  ROLE_SPEED,
  isTargetRole,
  type PodPlayRole,
  type PodPlay,
  type PodSentenceRow,
} from '@ssi/core/pods'

// ============================================================================
// Pod stage logic — mirrors what was in generateLearningScript.ts
// ============================================================================

// PodPlayRole + ROLE_SPEED now live in ./podStageComposition (re-exported above).

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
  // Stage 1 — "Phase 0" (Tom 2026-06-10): the sentence's introduction.
  // The explainer plays INSTEAD of the translation — raw target, Tom's
  // voice walking the chunks ("'X' means Y. 'A' means B."), target again.
  // Lasts 2 pod-rounds (DEFAULT_STAGE_DURATIONS) so the explainer is
  // heard exactly twice, then retires for good. A sentence with no
  // explainer_audio_id (fully-repeat line or vocab coda — the upstream
  // first-encounter discipline) plays its TRANSLATION in that slot
  // instead, so meaning always arrives (see the lap composer fallback).
  1: ['ps', 'explainer', 'ps'],
  // Stage 2 — "Phase 1": explainer retired, regular translation pattern,
  // still all 1.0×. Lasts 3 pod-rounds. Aran's 2026-05-07 bridge stage
  // (no 2× → all 2×) follows from stage 3.
  2: ['ps', 'trans', 'ps'],
  3: ['ps', 'trans', 'ps', 'ps2x'],
  4: ['ps', 'trans', 'ps2x', 'ps2x'],
  5: ['ps', 'trans', 'ps2x'],
  6: ['ps2x', 'trans', 'ps2x'],
  7: ['ps', 'ps2x'],
  8: ['ps2x', 'ps2x'],
  9: ['ps2x'],
}

/**
 * Default pod-rounds spent in each transitional stage before promoting.
 * The final stage is eternal regardless. Aran asked for 5 (was 3) — gives
 * the learner more reps at each pattern before the speed/structure changes.
 */
export const DEFAULT_STAGE_DURATION = 5

/**
 * Per-stage duration overrides (pod-rounds). Stages not listed fall back
 * to the uniform stageDuration. Phase 0 (stage 1) = 2 rounds so the
 * explainer plays exactly twice; Phase 1 (stage 2) = 3 rounds of the
 * plain translation pattern (Tom 2026-06-10).
 */
export const DEFAULT_STAGE_DURATIONS: Record<number, number> = { 1: 2, 2: 3 }

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
  /** Per-stage duration overrides (e.g. {1: 2, 2: 3}); unlisted stages use
   *  the uniform stageDuration. Omit for legacy uniform behaviour. */
  stageDurations?: Record<string | number, number>,
): { stage: number; iter: number | null } | null {
  const alive = currentPodRound - entryPodRound + 1
  if (alive < 1) return null
  let cum = 0
  for (let stage = 1; stage < totalStages; stage++) {
    const d = stageDurations?.[stage] ?? stageDurations?.[String(stage)] ?? stageDuration
    if (alive <= cum + d) {
      return { stage, iter: alive - cum }
    }
    cum += d
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

// isTargetRole + PodSentenceRow now live in ./podStageComposition (imported above).

// ============================================================================
// Types
// ============================================================================

/**
 * Raw listening_pod_sentences row as fetched — a whole speaker TURN. Flattened
 * into per-SENTENCE PodSentenceRow units by flattenPodRows when the turn was
 * silence-split (sentence_audio_ids present).
 */
interface RawPodRow {
  id: string
  global_order: number
  speaker: string | null
  target_text: string
  known_text: string
  target_audio_id: string | null
  known_audio_id: string | null
  explainer_audio_id: string | null
  glue_to_next: boolean
  atom_map?: AtomMapEntry[] | null
  sentence_audio_ids?: string[] | null
  sentence_known_audio_ids?: string[] | null
}

/** Strip everything but letters/numbers/combining-marks for a script-agnostic
 *  structural comparison (NOT a linguistic judgment — just whitespace/
 *  punctuation normalisation so pre-decided atom surfaces can be matched to
 *  pre-decided sentence text). \p{M} (combining marks) MUST be kept — dropping
 *  it would collapse e.g. Devanagari नमस्ते vs नमस्तें to the same string and
 *  wrongly accept a misaligned partition. Letters/numbers/marks cover every
 *  script; only separators + punctuation are stripped. */
const alnumOnly = (s: string): string => (s || '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '')

/**
 * Partition a turn's FLAT atom_map across its sentences, so each split sentence
 * gets only its OWN atoms for Stage-0. The atom_map is ordered and its atom
 * surfaces tile the turn's target text in order, so we walk the atoms
 * accumulating their surfaces and close a group when the accumulation exactly
 * covers the next sentence. Returns one atom group per sentence, or NULL if the
 * atoms don't cleanly align (then the caller drops Stage-0 for that turn's
 * splits — never a WRONG ladder). 'note' entries (no spoken surface) ride along
 * in the current group; only atom/passthrough surfaces are matched.
 */
export function partitionAtomMap(
  atomMap: AtomMapEntry[] | null | undefined,
  sentenceTexts: string[],
): AtomMapEntry[][] | null {
  if (!Array.isArray(atomMap) || atomMap.length === 0) return null
  if (sentenceTexts.length < 2) return null
  const targets = sentenceTexts.map(alnumOnly)
  if (targets.some((t) => !t)) return null
  const groups: AtomMapEntry[][] = sentenceTexts.map(() => [])
  let si = 0
  let acc = ''
  for (const entry of atomMap) {
    if (si >= groups.length) return null // more atoms than sentences to hold them
    groups[si].push(entry)
    if (entry.kind === 'atom' || entry.kind === 'passthrough') {
      const surf = alnumOnly(entry.target_surface || '')
      if (surf) {
        acc += surf
        if (acc === targets[si]) { si++; acc = '' }
        else if (!targets[si].startsWith(acc)) return null // misalignment
      }
    }
  }
  // Every sentence must be consumed exactly, every group non-empty.
  if (si !== groups.length || acc !== '') return null
  if (groups.some((g) => g.length === 0)) return null
  return groups
}

/**
 * Flatten raw turn-rows into per-SENTENCE PodSentenceRows. A row with a
 * silence-split (sentence_audio_ids ≥ 2) becomes one row per sentence, each
 * carrying its OWN target/known clip + text + partitioned atom_map; a row
 * without a split passes through unchanged. glue_to_next is recomputed
 * speaker-aware: a sentence glues to the next when they share a speaker (a
 * paragraph runs tight; a speaker change breathes). Split siblings of one turn
 * always glue; speakerless pods fall back to the row's original glue_to_next.
 */
export function flattenPodRows(rawRows: RawPodRow[]): PodSentenceRow[] {
  type Expanded = PodSentenceRow & { _turnId: string; _origGlue: boolean }
  const expanded: Expanded[] = []
  // Sibling detection keys off the SOURCE-ROW index (unique per turn), not
  // row.id — robust to a missing/duplicate id; sub-sentences of one turn share it.
  rawRows.forEach((row, rowIdx) => {
    const turnId = String(rowIdx)
    const units = splitRowUnits(row)
    if (units.length === 1) {
      expanded.push({
        // Shared two-doors counter key — same convention the overlay uses.
        sentence_id: row.id || null,
        global_order: row.global_order,
        target_text: row.target_text,
        known_text: row.known_text,
        target_audio_id: row.target_audio_id ?? null,
        known_audio_id: row.known_audio_id ?? null,
        explainer_audio_id: row.explainer_audio_id ?? null,
        glue_to_next: !!row.glue_to_next,
        atom_map: row.atom_map ?? null,
        speaker: row.speaker ?? null,
        _turnId: turnId,
        _origGlue: !!row.glue_to_next,
      })
    } else {
      const atomGroups = partitionAtomMap(row.atom_map, units.map((u) => u.targetText))
      units.forEach((u, k) => {
        expanded.push({
          sentence_id: row.id ? `${row.id}:s${k}` : null,
          global_order: row.global_order + k * 0.001,
          target_text: u.targetText,
          known_text: u.knownText,
          target_audio_id: u.targetAudioId,
          known_audio_id: u.knownAudioId,
          // No per-sentence explainer (it was per-turn) — Stage 1's explainer
          // slot falls back to this sentence's own translation.
          explainer_audio_id: null,
          glue_to_next: false, // set in the speaker-aware pass below
          atom_map: atomGroups ? atomGroups[k] : null,
          speaker: row.speaker ?? null,
          _turnId: turnId,
          _origGlue: !!row.glue_to_next,
        })
      })
    }
  })
  for (let k = 0; k < expanded.length; k++) {
    const cur = expanded[k]
    const next = expanded[k + 1]
    if (!next) { cur.glue_to_next = false; continue }
    if (next._turnId === cur._turnId) { cur.glue_to_next = true; continue } // sibling sentence of one turn
    const a = (cur.speaker || '').trim().toLowerCase()
    const b = (next.speaker || '').trim().toLowerCase()
    cur.glue_to_next = a && b ? a === b : cur._origGlue
  }
  return expanded.map(({ _turnId: _t, _origGlue: _g, ...row }) => row)
}

export interface BookendAudio {
  id: string
  text: string
  duration_ms?: number
}

// PodPlay now lives in ./podStageComposition (re-exported above).

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
  /** Per-stage duration overrides keyed by stage number (e.g. {'1': 2, '2': 3}
   *  — Phase 0 plays twice, Phase 1 three times). Unlisted stages use
   *  stageDuration. Omitted → uniform legacy behaviour. */
  stageDurations?: Ref<Record<string, number> | undefined> | Record<string, number>
  /** Fire a pod-lap every N main rounds from activation onward. Default 1
   *  (every round). Stretches every stage proportionally because the
   *  pod-round ratchet only ticks on actual fires. */
  roundInterval?: Ref<number> | number
  /** Stage-0 ladder config (algorithm_config['stage0']). When provided AND a
   *  sentence has resolvable atoms, the sentence's first N views (N = number
   *  of tiers) play the Stage-0 ladder before its existing Stages 1-9. Omit
   *  (or empty tiers) → no Stage-0; behaviour identical to before. */
  stage0?: Ref<Stage0Config | null | undefined> | Stage0Config | null
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

  // Stage-0 course-wide lookups (built in init): lego_key → "means <gloss>"
  // clip, and target_surface → "[atom] <target>" clip. Empty when the course
  // has no Stage-0 data, which disables the prepend for every sentence.
  let stage0MeansGloss = new Map<string, string>()
  let stage0TargetClip = new Map<string, string>()

  /** Main-round at which pods START FIRING. NULL → use default 6. */
  const podActivationRound = ref<number>(DEFAULT_POD_ACTIVATION)
  /** Independent ratchet counter. Increments only on completed laps. */
  const completedPodRounds = ref<number>(0)

  // ── Shared two-doors exposure counter (learner_pod_state) ────────────────
  // sentence_id → exposures COMPLETED across both doors (pod laps + Listening
  // Drill). A sentence's stage maths use max(derived alive, stored + 1) so a
  // drilled sentence enters/continues the lap ladder past the breakdown it
  // has outgrown; each completed lap writes back the served view. Guests keep
  // the derived-only behaviour (no rows).
  let podExposures = new Map<string, number>()
  /** Sentences served by the LAST built lap, with the exposure count each
   *  will have completed once that lap finishes. Flushed by markLapCompleted. */
  let pendingExposures: Array<{ sentence_id: string; exposures: number }> = []

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
          .select('id, global_order, speaker, target_text, known_text, target_audio_id, known_audio_id, explainer_audio_id, glue_to_next, atom_map, sentence_audio_ids, sentence_known_audio_ids')
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

      // Flatten turn-rows into per-SENTENCE units: a silence-split turn plays
      // as target→known→target PER SENTENCE (not 3 target sentences then 3
      // known — too hard to follow, Tom 2026-06-16). Rows without a split pass
      // through unchanged. Everything downstream (stages, Stage-0, gaps) then
      // works per-sentence by construction.
      podSentences.value = flattenPodRows((podsResult.data || []) as RawPodRow[])

      // Stage-0 lookups — only when the ladder is enabled (config present) and
      // at least one sentence carries an atom_map. Two small course-wide reads.
      stage0MeansGloss = new Map()
      stage0TargetClip = new Map()
      const stage0Enabled = !!unwrap(options.stage0) && podSentences.value.some((s) => Array.isArray(s.atom_map) && s.atom_map.length > 0)
      if (stage0Enabled) {
        const maps = await loadStage0ClipMaps(supabase, courseCode)
        stage0MeansGloss = maps.glossMap
        stage0TargetClip = maps.targetClipMap
      }

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

      // Shared exposure counters — best-effort: a failed read degrades to the
      // derived-only behaviour (identical to pre-bridge), never blocks init.
      podExposures = new Map()
      pendingExposures = []
      if (!isGuestLearner(learnerId)) {
        try {
          podExposures = await new PodStateStore({ client: supabase }).loadAll(learnerId!, courseCode)
        } catch (err) {
          console.warn('[podLapScheduler] pod state read failed (derived-only):', err)
        }
      }

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
   * full round (~5 min) of buffer when prefetched on round entry.
   *
   * If `ensureFn` is provided, audio is landed in IndexedDB via that
   * callback (typically `audioCache.persistent.ensure`). The pod playback
   * path resolves URLs through AudioCacheSource at play time, so once
   * the bytes are in IndexedDB, playback uses blob URLs — no SW
   * round-trip per play. Aligns with the "asset + program" architecture
   * for main-flow pod laps where stage-driven gapless playback matters.
   *
   * Fallback (no ensureFn): warm the SW CacheFirst layer via plain
   * fetch with priority='low'. Still cached, but goes through SW on
   * playback.
   *
   * No-op if there's no lap to fetch. Idempotent — repeat calls are
   * dedup'd by the underlying cache layer.
   */
  const prefetchLap = (ensureFn?: (audioId: string) => Promise<void>): void => {
    if (podSentences.value.length === 0) return
    const lap = nextLap()
    if (!lap) return
    const ids = new Set<string>()
    if (lap.intro?.id) ids.add(lap.intro.id)
    if (lap.outro?.id) ids.add(lap.outro.id)
    for (const p of lap.plays) {
      if (p.audioId) ids.add(p.audioId)
    }
    if (ensureFn) {
      for (const id of ids) {
        ensureFn(id).catch(() => undefined)
      }
    } else {
      for (const id of ids) {
        const url = `/api/audio/${id}`
        fetch(url, { priority: 'low' }).catch(() => undefined)
      }
    }
  }

  // Stage-0 / main-stage composition now lives in ./podStageComposition
  // (buildStage0Tier / buildMainStage), shared with the Progression audit walk.

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
    const liveDurations = unwrap(options.stageDurations) as Record<string, number> | undefined
    const stagePlaylistMap: Record<string | number, PodPlayRole[]> = livePlaylist || DEFAULT_STAGE_PLAYLIST
    const stageDuration: number = liveDuration ?? DEFAULT_STAGE_DURATION
    // Pair per-stage durations with their playlist: a live (admin-saved)
    // playlist without stageDurations keeps uniform legacy maths; the code
    // defaults pair DEFAULT_STAGE_PLAYLIST with DEFAULT_STAGE_DURATIONS.
    const stageDurationsMap: Record<string | number, number> | undefined =
      liveDurations ?? (livePlaylist ? undefined : DEFAULT_STAGE_DURATIONS)
    const totalStages = Object.keys(stagePlaylistMap).length

    const s0cfg = unwrap(options.stage0) as Stage0Config | null | undefined
    const stage0Tiers = s0cfg?.tiers?.length ?? 0

    const plays: PodPlay[] = []
    pendingExposures = []
    for (let i = 1; i <= activeCount; i++) {
      const sentence = podSentences.value[i - 1]
      if (!sentence.target_audio_id) continue

      // ── Stage-0 prepend: a sentence with resolvable atoms spends its first
      // N views (N = tier count) in the Stage-0 ladder, one tier per view,
      // before its existing Stages 1-9. Sentences with no atoms are untouched.
      const sentenceHasStage0 =
        !!s0cfg &&
        stage0Tiers > 0 &&
        resolveAtoms(sentence.atom_map, stage0MeansGloss, stage0TargetClip).some((a) => a.targetClipId)
      // Effective view: the derived lap-ladder position, lifted by the shared
      // two-doors counter when Listening Drill has taken this sentence
      // further (exposures = views COMPLETED → serve view = exposures + 1).
      // Intake stays ratchet-driven (activeCount above) — drilling ahead
      // never pulls a sentence into laps early, it just enters wiser.
      const derivedAlive = podRound - i + 1
      const stored = sentence.sentence_id ? podExposures.get(sentence.sentence_id) : undefined
      const alive = Math.max(derivedAlive, (stored ?? 0) + 1)
      const view = stage0ViewFor(alive, sentenceHasStage0 ? stage0Tiers : 0)
      if (view.phase === 'stage0') {
        // s0cfg is guaranteed truthy here (sentenceHasStage0 requires it), but
        // guard for the type-checker — fall through harmlessly if ever null.
        if (s0cfg) {
          plays.push(...buildStage0Tier(sentence, s0cfg.tiers[view.tierIndex].key, i, s0cfg, stage0MeansGloss, stage0TargetClip))
          if (sentence.sentence_id) pendingExposures.push({ sentence_id: sentence.sentence_id, exposures: alive })
        }
        continue
      }

      // Main stages — entry shifts past the Stage-0 views so view N+1 = Stage 1.
      // podStageFor(entry=1, current=alive−shift) ≡ the old (i+shift, podRound)
      // call, but driven by the EFFECTIVE view instead of the derived one.
      const stageInfo = podStageFor(1, alive - view.shift, stageDuration, totalStages, stageDurationsMap)
      if (!stageInfo) continue
      const playlist = stagePlaylistMap[stageInfo.stage] || stagePlaylistMap[String(stageInfo.stage)]
      if (!playlist) continue
      // Whole-sentence stage composition (explainer→trans fallback, end-on-target
      // invariant, glue) is the shared builder — same code the Progression walk runs.
      plays.push(...buildMainStage(sentence, stageInfo.stage, i, playlist))
      if (sentence.sentence_id) pendingExposures.push({ sentence_id: sentence.sentence_id, exposures: alive })
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
    await flushExposures()
  }

  /**
   * Write the last-built lap's exposure counts to the shared two-doors
   * counter (learner_pod_state). In-memory map merges by max first so the
   * next lap build sees the advance even if the network write fails; guests
   * keep derived-only behaviour. Best-effort — never blocks playback.
   */
  const flushExposures = async (): Promise<void> => {
    const batch = pendingExposures
    pendingExposures = []
    if (batch.length === 0) return
    for (const r of batch) {
      if ((podExposures.get(r.sentence_id) ?? 0) < r.exposures) podExposures.set(r.sentence_id, r.exposures)
    }
    const supabase = unwrap(supabaseRef)
    const learnerId = unwrap(learnerIdRef)
    const courseCode = unwrap(courseCodeRef)
    if (!supabase || !courseCode || !learnerId || isGuestLearner(learnerId)) return
    try {
      await new PodStateStore({ client: supabase }).upsertMany(
        batch.map((r) => ({
          learner_id: learnerId,
          course_code: courseCode,
          sentence_id: r.sentence_id,
          // The map holds the max seen this session — write that, so a stale
          // batch never regresses a counter another pass just advanced.
          exposures: podExposures.get(r.sentence_id) ?? r.exposures,
        })),
      )
    } catch (err) {
      console.warn('[podLapScheduler] pod state write failed:', err)
    }
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
    podExposures = new Map()
    pendingExposures = []

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
      // Course reset clears the shared two-doors counter too.
      await new PodStateStore({ client: supabase }).deleteAll(learnerId, courseCode)
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
