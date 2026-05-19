/**
 * generateLearningScript - Build complete learning script from Supabase
 *
 * Copied from dashboard (src/services/supabase.js) - this is the source of truth.
 * Same database, same query, same result.
 *
 * Round Structure:
 * 1. INTRO     - presentation audio ("The Dutch for X is...")
 * 2. DEBUT     - the LEGO itself (known → target)
 * 3. BUILD ×7  - up to 7 BUILD phrases (drilling)
 * 4. SPACED REP - USE phrases from older LEGOs (max 12, Fibonacci timing)
 * 5. USE ×2    - exactly 2 USE phrases (consolidation)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { validateLearningScript } from './validateLearningScript'

export interface ScriptItem {
  uuid: string
  cycleNum: number
  roundNumber: number
  seedId: string
  legoKey: string
  seedCode: string
  legoCode: string
  type: 'intro' | 'debut' | 'build' | 'spaced_rep' | 'use' | 'listening' | 'component_intro' | 'component_practice' | 'listen_intro' | 'listen_outro' | 'pod'
  knownText: string
  targetText: string
  /** Native script text — only set when targetText is romanized */
  targetTextNative?: string
  presentationAudioId?: string
  knownAudioId?: string
  target1Id?: string
  target2Id?: string
  target1DurationMs?: number
  target2DurationMs?: number
  isNew: boolean
  syllableCount?: number
  fibPosition?: number
  reviewOf?: number
  componentLegoIds?: string[]
  componentLegoTexts?: string[]
  /** Native script variants — only set when romanized text exists */
  componentLegoTextsNative?: string[]
  /** M-LEGO component breakdown: [{known: "with", target: "con"}, ...] */
  components?: Array<{ known: string; target: string }>
  /** Native script variant of components */
  componentsNative?: Array<{ known: string; target: string }>
  /** Listening phase: playback speed multiplier (1.0 = normal, 2.0 = double) */
  playbackSpeed?: number
  /** Listening phase: which seed this listening item is for */
  listeningSeedNumber?: number
  /** Skip this cycle when Turbo is active. Set on:
   *   - 4th–7th BUILD phrases (Turbo keeps the first 3)
   *   - 2nd CONSOLIDATE/USE phrase (Turbo keeps 1)
   *   - spaced_rep phrases at alternate fib offsets (skip 5, 13, 34, 89; keep 1, 2, 3, 8, 21, 55)
   * intro/debut/listening/pod/bookend cycles are never tagged. */
  turboOmit?: boolean
}

/**
 * Default Turbo culling rules — mirrored to algorithm_config.turbo_boost.
 * fibKeep: indices into SPACED_REP_OFFSETS that Turbo keeps; default
 *   {0,1,2,4,6,8} = N-1, N-2, N-3, N-8, N-21, N-55 (skip the rest).
 * buildKeep: how many BUILD phrases per LEGO Turbo keeps (rest tagged).
 * useKeep: how many CONSOLIDATE/USE phrases per LEGO Turbo keeps.
 */
export const DEFAULT_TURBO_FIB_KEEP = [0, 1, 2, 4, 6, 8]
export const DEFAULT_TURBO_BUILD_KEEP = 3
export const DEFAULT_TURBO_USE_KEEP = 1

/**
 * Default per-round script shape — mirrored to algorithm_config.script_shape.
 * Changing these reshapes every round generated after the change.
 */
export interface ScriptShape {
  spacedRepOffsets: number[]
  maxBuildPhrases: number
  useConsolidationCount: number
  maxSpacedRepPhrases: number
  n1PhraseCount: number
}

export const DEFAULT_SCRIPT_SHAPE: ScriptShape = {
  spacedRepOffsets: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89],
  maxBuildPhrases: 7,
  useConsolidationCount: 2,
  maxSpacedRepPhrases: 12,
  n1PhraseCount: 3,
}

/** Subset of turbo_boost config fields used at script-generation time
 *  (cycle tagging). Other fields like playback_speed apply at runtime. */
export interface TurboCullConfig {
  fibKeep?: number[]
  buildKeep?: number
  useKeep?: number
}

/**
 * Layer 1 per-seed play roles — mirrors usePodLapScheduler's PodPlayRole.
 *   ps08x = target audio at 0.8× (extra-slow for first exposure)
 *   ps    = target audio at 1.0× (slow listen for clarity)
 *   ps15x = target audio at 1.5× (gentle stretch on the way up)
 *   ps2x  = target audio at 2.0× (fast rep for retention)
 *   trans = known-language audio at 1.0× (translation cue, off by default
 *           since graduated seeds have dropped out of spaced rep — learner
 *           should already know the meaning)
 */
export type Layer1PlayRole = 'ps08x' | 'ps' | 'ps15x' | 'ps2x' | 'trans'

// Single source of truth for role → runtime playback rate. All audio
// (target or known) plays back at the role's speed; 'trans' is always 1.0×
// because the known-language clip is reference material.
const ROLE_SPEED: Record<string, number> = {
  ps08x: 0.8,
  ps: 1.0,
  ps15x: 1.5,
  ps2x: 2.0,
  trans: 1.0,
}

// Per Aran's listening-layers spec (canonical visualiser at popty.app/listening-playground.html).
// Graduation is event-driven (1 LEGO == 1 round; a seed graduates once all its
// LEGOs have been introduced and the offset has elapsed). Active-10 and reserve
// fire on co-prime intervals (3 / 13) so they only clash every 39 rounds.
export interface ListeningConfig {
  enabled: boolean
  offset: number              // rounds after last LEGO before seed graduates
  // Layer 1 — graduated seed sentences
  l1ActiveSize: number        // sliding window of N most recent graduated seeds
  l1ActiveInterval: number    // active fires every N rounds
  l1ReserveSize: number       // older seeds beyond active, capped (overflow → Choice Pods later)
  l1ReserveInterval: number   // reserve fires every N rounds (coprime with active)
  /** Legacy / fallback flat playlist. Used when layer1StagePlaylist is
   * empty — every L1 fire of every seed plays this same sequence, no
   * decay. Kept for back-compat with the pre-staged-decay model. */
  layer1Playlist: Layer1PlayRole[]
  /** Staged Layer 1 playlist — keys are stage numbers (1..N), values
   * are the playlist for that stage. Mirrors Layer 2's pod stagePlaylist
   * shape. Each time a graduated seed plays in an L1 cluster its
   * per-seed fire counter advances; stage = floor((fireCount-1) /
   * layer1StageDuration) + 1, capped at the highest key (eternal hold).
   * Aran 2026-05-07 spec: seeds eventually decay to a single 2× rep. */
  layer1StagePlaylist: Record<string, Layer1PlayRole[]>
  /** L1 fires spent in each transitional stage before promoting. The
   * highest-numbered stage in layer1StagePlaylist is eternal regardless. */
  layer1StageDuration: number
  // Layer 2 — Pod 0
  /** First pod lap fires at end of this main round (start of seed 2).
   *  Optional now that the field's primary home is PodsConfig — callers
   *  that pass the listening config without merging it in still work;
   *  the generator falls back to 6 (matches DEFAULT_POD_ACTIVATION). */
  podActivationRound?: number
}

export const DEFAULT_LISTENING_CONFIG: ListeningConfig = {
  enabled: true,
  // Graduation offset: rounds after a seed's LAST LEGO debut before it
  // becomes eligible for L1 listening. Calibrated to N-89 spaced-rep
  // decay — final fib review for the last LEGO is at lastRound + 89,
  // graduation one round later means the seed enters listening only
  // after every one of its LEGOs has fully dropped out of spaced rep.
  offset: 90,
  l1ActiveSize: 10,
  l1ActiveInterval: 3,
  l1ReserveSize: 50,
  l1ReserveInterval: 13,
  layer1Playlist: ['ps', 'ps2x', 'ps2x'],
  layer1StagePlaylist: {
    '1': ['ps', 'ps2x', 'ps2x'],
    '2': ['ps2x', 'ps2x', 'ps2x'],
    '3': ['ps2x', 'ps2x'],
    '4': ['ps2x'],
  },
  layer1StageDuration: 3,
  podActivationRound: 6,
}

export interface LearningScriptResult {
  items: ScriptItem[]
  cycleCount: number
  roundCount: number
  hasRomanizedText: boolean
}

/** Sample `n` items without replacement using a partial Fisher-Yates shuffle. */
function sampleWithoutReplacement<T>(arr: T[], n: number): T[] {
  if (n >= arr.length) return [...arr]
  const a = [...arr]
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

export async function generateLearningScript(
  supabase: SupabaseClient,
  courseCode: string,
  /**
   * Number of revival (infinite-play) rounds to emit AFTER the main loop
   * exhausts every is_new LEGO. The main-loop walk is always full-course;
   * this only controls how far the post-main tail extends. Default 50.
   */
  infinitePlayLookahead: number = 50,
  listeningConfig: ListeningConfig = DEFAULT_LISTENING_CONFIG,
  scriptShape: ScriptShape = DEFAULT_SCRIPT_SHAPE,
  turboCull: TurboCullConfig = {},
  /**
   * Per-seed L1 fire counts from persisted state (learner_l1_state table).
   * Hydrates seedL1FireCount so the Stage 1 → Stage 4 playlist progression
   * compounds across sessions. Pass null/undefined for cold start (every
   * seed at fire_count=0, Stage 1).
   */
  initialL1FireCounts: Map<number, number> | null = null,
  /**
   * Fire a pod-lap every N main rounds from podActivationRound onward.
   * Mirrors PodsConfig.roundInterval — passed in so the generator's
   * L1-outro merge decision stays in sync with the runtime scheduler.
   * Default 1 (every round, legacy behaviour).
   */
  podRoundInterval: number = 6,
): Promise<LearningScriptResult> {
  // Per-round shape — DB-tweakable via algorithm_config.script_shape.
  const SPACED_REP_OFFSETS = scriptShape.spacedRepOffsets
  const MAX_BUILD_PHRASES = scriptShape.maxBuildPhrases
  const USE_CONSOLIDATION_COUNT = scriptShape.useConsolidationCount
  const MAX_SPACED_REP_PHRASES = scriptShape.maxSpacedRepPhrases
  const N1_PHRASE_COUNT = scriptShape.n1PhraseCount

  // Turbo culling — DB-tweakable via algorithm_config.turbo_boost
  // (fibKeep, buildKeep, useKeep). Defaults preserved for any consumer
  // that omits the param.
  const TURBO_FIB_KEEP = new Set(turboCull.fibKeep ?? DEFAULT_TURBO_FIB_KEEP)
  const TURBO_BUILD_KEEP = turboCull.buildKeep ?? DEFAULT_TURBO_BUILD_KEEP
  const TURBO_USE_KEEP = turboCull.useKeep ?? DEFAULT_TURBO_USE_KEEP

  const normalizeText = (text: string | null | undefined): string => {
    if (!text) return ''
    return text.toLowerCase().trim().replace(/[.,!?;:¡¿'"\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g, '')
  }

  const getPhraseId = (knownText: string, targetText: string): string => {
    return `${normalizeText(knownText)}|${normalizeText(targetText)}`
  }

  const countTargetSyllables = (targetText: string | null | undefined): number => {
    if (!targetText) return 0
    const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g
    const cjkChars = targetText.match(cjkRegex)
    if (cjkChars && cjkChars.length > 0) return cjkChars.length
    const vowelClusters = targetText.toLowerCase().match(/[aeiouyáéíóúàèìòùâêîôûäëïöü]+/gi)
    return vowelClusters ? vowelClusters.length : 1
  }

  // Query tables directly - audio IDs stored on each row, no joins needed.
  // ALL course-content queries are course-wide — no startSeed/endSeed
  // filtering. The script generator always walks the full course. Chunking
  // by seed range was the original cause of the L1-listening silent-fail
  // bug: any course-wide derivation (graduated seeds, anchor ordinals,
  // cross-LEGO references) needs the whole inventory in scope, not just
  // the current chunk's window.
  const [legosResult, phrasesResult, seedsResult, bookendsResult, podsResult, catalogueResult] = await Promise.all([
    supabase
      .from('course_legos')
      .select('seed_number, lego_index, known_text, target_text, target_text_roman, type, is_new, known_audio_id, target1_audio_id, target2_audio_id, presentation_audio_id, target1_duration_ms, target2_duration_ms')
      .eq('course_code', courseCode)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .limit(5000),
    supabase
      .from('course_practice_phrases')
      .select('seed_number, lego_index, known_text, target_text, target_text_roman, phrase_role, target_syllable_count, position, known_audio_id, target1_audio_id, target2_audio_id, presentation_audio_id, target1_duration_ms, target2_duration_ms, introduce')
      .eq('course_code', courseCode)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .order('position', { ascending: true })
      .limit(10000),
    // Seed sentences for L1 listening (whole-sentence replay after graduation).
    listeningConfig.enabled
      ? supabase
          .from('course_seeds')
          .select('seed_number, known_text, target_text, target_text_roman, known_audio_id, target1_audio_id, target2_audio_id')
          .eq('course_code', courseCode)
          .order('seed_number', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    // Pre-fetch the two LISTEN-block bookend audio rows for this course.
    // Generated by scripts/generate-listen-bookends.cjs in the dashboard repo;
    // missing rows just mean this course's bookends haven't been generated yet
    // and Phase 6 will skip emitting them silently.
    listeningConfig.enabled
      ? supabase
          .from('course_audio')
          .select('role, text, id, duration_ms')
          .eq('course_code', courseCode)
          .in('role', ['bookend_listen_intro', 'bookend_listen_outro'])
      : Promise.resolve({ data: [], error: null }),
    // Pre-fetch Pod 0 sentences (Layer 2 listening — round-end lap after
    // activation). Pod ID convention: "${course_code}:${slug}". Sentences
    // ordered by global_order; entry into the lap is 1 sentence/round.
    // Returns empty if course has no pod-0 — Phase 7 silently skips.
    listeningConfig.enabled
      ? supabase
          .from('listening_pod_sentences')
          .select('global_order, target_text, known_text, target_audio_id, known_audio_id')
          .eq('pod_id', `${courseCode}:pod-0`)
          .order('global_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    // Course-wide LEGO catalogue (just seed_number + lego_index). Used to
    // assign every LEGO an absolute ordinal position in the course — drives
    // L1 graduation tracking. Now redundant with the legos query above (same
    // course-wide scope), but kept as a separate fetch with only the two
    // columns needed for ordinal mapping — slightly cheaper than re-iterating
    // legosResult.
    listeningConfig.enabled
      ? supabase
          .from('course_legos')
          .select('seed_number, lego_index')
          .eq('course_code', courseCode)
          .order('seed_number', { ascending: true })
          .order('lego_index', { ascending: true })
          .limit(10000)
      : Promise.resolve({ data: [], error: null })
  ])

  if (legosResult.error) throw new Error('Failed to query LEGOs: ' + legosResult.error.message)
  if (phrasesResult.error) throw new Error('Failed to query phrases: ' + phrasesResult.error.message)
  if (seedsResult.error) throw new Error('Failed to query seeds for listening: ' + seedsResult.error.message)
  if (bookendsResult.error) throw new Error('Failed to query listen bookends: ' + bookendsResult.error.message)
  if (podsResult.error) throw new Error('Failed to query pod sentences: ' + podsResult.error.message)

  // Map bookend role → audio (used in Phase 6 to wrap the listening batch).
  // Both intro and outro must exist for either to be emitted.
  interface BookendAudio { id: string; text: string; duration_ms?: number }
  const bookendByRole = new Map<string, BookendAudio>()
  for (const row of (bookendsResult.data || []) as Array<{ role: string; text: string; id: string; duration_ms?: number }>) {
    bookendByRole.set(row.role, { id: row.id, text: row.text, duration_ms: row.duration_ms })
  }
  const listenIntroAudio = bookendByRole.get('bookend_listen_intro')
  const listenOutroAudio = bookendByRole.get('bookend_listen_outro')
  const hasBookends = !!(listenIntroAudio && listenOutroAudio)

  // (Audio-ID fallback layer removed 2026-05-03. It scanned up to 20K rows
  // from course_audio per script generation to patch NULL audio_id columns
  // left behind by the dashboard's text-edit trigger, and was the heaviest
  // query in the trio for big courses — tipping Estonian / Basque over
  // Postgres' statement timeout. The fix lives upstream in the dashboard:
  // close the re-link gap when fresh audio lands. Until then, phrases with
  // NULL audio IDs are gracefully skipped by the downstream filters.)

  // -------------------------------------------------------------------------
  // Listening Layers (Aran spec, 2026-04-29 — canonical visualiser at
  // popty.app/listening-playground.html).
  //
  //   Layer 2 (Pod 0):     fires every round at and after podActivationRound
  //                        (default R6 = start of seed 2). Pod-round = main-round
  //                        - activation + 1 (1:1). Stage progression follows the
  //                        7-stage table below.
  //   Layer 1 (graduated): two co-prime rotations on the queue of graduated
  //                        seeds —
  //                          active = last `l1ActiveSize` (10) seeds, every
  //                          `l1ActiveInterval` (3) rounds
  //                          reserve = next `l1ReserveSize` (50) older seeds,
  //                          every `l1ReserveInterval` (13) rounds
  //                        Both can fire in the same round (every 39); when
  //                        they do, we emit one combined cluster (reserve
  //                        first, then active) with a single bookend pair.
  //
  // L1 + L2 bookends may both fire in the same round — Aran approved.
  // -------------------------------------------------------------------------
  const POD_ACTIVATION_ROUND = listeningConfig.podActivationRound ?? 6
  const POD_ROUND_INTERVAL = Math.max(1, Math.floor(podRoundInterval))
  type PodPlayRole = 'ps08x' | 'ps' | 'ps15x' | 'ps2x' | 'trans'
  // Stage playlists per Aran's road-test 2026-05-05. PS = pod sentence at
  // 1.0×, PS×2 at 2.0×, trans = English translation. Stage 1 stays all 1.0×;
  // 2× kicks in from stage 2. Stages 1–6 each last 5 pod-rounds (was 3);
  // stage 7 is the eternal holding bay.
  const STAGE_PLAYLIST: Record<number, PodPlayRole[]> = {
    1: ['ps', 'trans', 'ps', 'ps'],
    2: ['ps', 'trans', 'ps2x', 'ps2x'],
    3: ['ps', 'trans', 'ps2x'],
    4: ['ps2x', 'trans', 'ps2x'],
    5: ['ps', 'ps2x'],
    6: ['ps2x', 'ps2x'],
    7: ['ps2x'],
  }
  const STAGE_DURATION = 5
  function podStageFor(entryPodRound: number, currentPodRound: number): { stage: number; iter: number | null } | null {
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
  interface PodSentenceRow {
    global_order: number
    target_text: string
    known_text: string
    target_audio_id: string | null
    known_audio_id: string | null
  }
  const podSentences = (podsResult.data || []) as PodSentenceRow[]
  const hasPods = podSentences.length > 0

  // Pod-round counts actual fires, not player rounds. With interval N, a
  // pod-lap only fires on rounds where (mainRound - activation) % N === 0;
  // the pod-round increments by 1 per fire (so stage clocks still measure
  // laps, not session-rounds). Non-firing rounds map to 0.
  function podRoundForMainRound(mainRound: number): number {
    if (mainRound < POD_ACTIVATION_ROUND) return 0
    const offset = mainRound - POD_ACTIVATION_ROUND
    if (offset % POD_ROUND_INTERVAL !== 0) return 0
    return Math.floor(offset / POD_ROUND_INTERVAL) + 1
  }
  function l2FiresAt(round: number): boolean {
    if (!hasPods || round < POD_ACTIVATION_ROUND) return false
    return (round - POD_ACTIVATION_ROUND) % POD_ROUND_INTERVAL === 0
  }

  // Emit Layer 1 LISTEN cluster — bookend-wrapped block of graduated seeds.
  // Each seed expands to one cycle per entry in listeningConfig.layer1Playlist
  // (default ['ps', 'ps2x', 'ps2x'] = one 1× listen, two 2× reps). Each cycle
  // plays exactly one audio: target at the role's speed for 'ps'/'ps2x',
  // known audio for 'trans'. No prompt → target1 → target2 trio — graduated
  // seeds are past meaning-acquisition, so the playlist drives repetition
  // instead of layering known + target.
  //
  // omitOutro: when L2 will fire the same round, drop the L1 outro bookend so
  // the L1 cluster flows straight into the L2 pod lap. Pair with the runtime
  // L2 intro suppression in LearningPlayer's playPodLap — together they make
  // a co-firing round play as one continuous listening section, not two.
  function emitL1Cluster(seedNums: number[], mainRoundNumber: number, cycleCounter: { v: number }, omitOutro: boolean = false): boolean {
    if (seedNums.length === 0) return false

    const validSeeds: Array<{ sNum: number; seedData: SeedData }> = []
    for (const sNum of seedNums) {
      const seedData = seedMap.get(sNum)
      if (!seedData || !seedData.target1_audio_id) continue
      validSeeds.push({ sNum, seedData })
    }
    if (validSeeds.length === 0) return false

    if (hasBookends && listenIntroAudio) {
      cycleCounter.v++
      emitItem({
        uuid: `listen_intro_R${String(mainRoundNumber).padStart(4, '0')}_${cycleCounter.v}`,
        cycleNum: cycleCounter.v, roundNumber: mainRoundNumber,
        seedId: '', legoKey: '', seedCode: '', legoCode: '',
        type: 'listen_intro',
        knownText: listenIntroAudio.text,
        targetText: '',
        knownAudioId: listenIntroAudio.id,
        isNew: false,
      })
    }
    for (const { sNum, seedData } of validSeeds) {
      // Bump per-seed fire counter and pick the stage-aware playlist.
      // Each seed decays through layer1StagePlaylist as it accumulates
      // fires, eventually settling on the eternal-stage playlist.
      const fireCount = (seedL1FireCount.get(sNum) ?? 0) + 1
      seedL1FireCount.set(sNum, fireCount)
      const playlist = layer1PlaylistForFireCount(fireCount)
      if (!playlist || playlist.length === 0) continue

      const seedIdStr = `S${String(sNum).padStart(4, '0')}`
      for (const role of playlist) {
        const isTrans = role === 'trans'
        // Skip 'trans' for seeds without known audio rather than dropping
        // the whole seed — a missing translation shouldn't silence retries.
        if (isTrans && !seedData.known_audio_id) continue
        cycleCounter.v++
        const speed = ROLE_SPEED[role] ?? 1.0
        emitItem({
          uuid: `listening_${seedIdStr}_${role}_${cycleCounter.v}`,
          cycleNum: cycleCounter.v, roundNumber: mainRoundNumber,
          seedId: seedIdStr,
          legoKey: `${seedIdStr}L00`,
          seedCode: seedIdStr,
          legoCode: '00',
          type: 'listening',
          knownText: seedData.known_text,
          targetText: seedData.target_text_roman || seedData.target_text,
          ...nativeFields(seedData),
          // 'trans' plays the known-language clip; 'ps'/'ps2x' play target.
          // Unused side stays undefined so the corresponding phase silently
          // skips in SimplePlayer.
          ...(isTrans
            ? { knownAudioId: seedData.known_audio_id }
            : { target1Id: seedData.target1_audio_id }),
          isNew: false,
          playbackSpeed: speed,
          listeningSeedNumber: sNum,
        })
      }
    }
    if (hasBookends && listenOutroAudio && !omitOutro) {
      cycleCounter.v++
      emitItem({
        uuid: `listen_outro_R${String(mainRoundNumber).padStart(4, '0')}_${cycleCounter.v}`,
        cycleNum: cycleCounter.v, roundNumber: mainRoundNumber,
        seedId: '', legoKey: '', seedCode: '', legoCode: '',
        type: 'listen_outro',
        knownText: listenOutroAudio.text,
        targetText: '',
        knownAudioId: listenOutroAudio.id,
        isNew: false,
      })
    }
    return true
  }

  // Compute lap items for a given main-course round. Returns false when pods
  // not activated, course has none, or pod-0 has been fully introduced and
  // no sentence is in any stage (shouldn't happen since stage 7 is eternal).
  // Caller is responsible for gating on l2FiresAt(round).
  function emitPodLap(mainRoundNumber: number, cycleCounter: { v: number }): boolean {
    if (!hasPods) return false
    const podRound = podRoundForMainRound(mainRoundNumber)
    if (podRound < 1) return false
    const TOTAL = podSentences.length
    const activeCount = Math.min(podRound, TOTAL)
    if (activeCount < 1) return false

    // Pre-flight: collect plays so we can decide whether to emit bookends.
    const plays: Array<{ i: number; sentence: PodSentenceRow; playRole: PodPlayRole }> = []
    for (let i = 1; i <= activeCount; i++) {
      const sentence = podSentences[i - 1]
      if (!sentence.target_audio_id) continue
      const stageInfo = podStageFor(i, podRound)
      if (!stageInfo) continue
      for (const playRole of STAGE_PLAYLIST[stageInfo.stage]) {
        if (playRole === 'trans' && !sentence.known_audio_id) continue
        plays.push({ i, sentence, playRole })
      }
    }
    if (plays.length === 0) return false

    if (hasBookends && listenIntroAudio) {
      cycleCounter.v++
      emitItem({
        uuid: `listen_intro_pod_R${String(mainRoundNumber).padStart(4, '0')}_${cycleCounter.v}`,
        cycleNum: cycleCounter.v, roundNumber: mainRoundNumber,
        seedId: '', legoKey: '', seedCode: '', legoCode: '',
        type: 'listen_intro',
        knownText: listenIntroAudio.text,
        targetText: '',
        knownAudioId: listenIntroAudio.id,
        isNew: false,
      })
    }
    for (const { i, sentence, playRole } of plays) {
      cycleCounter.v++
      const cyc = cycleCounter.v
      const speed = ROLE_SPEED[playRole] ?? 1.0
      const isTrans = playRole === 'trans'
      emitItem({
        uuid: `pod_R${String(mainRoundNumber).padStart(4, '0')}_S${String(i).padStart(3, '0')}_${playRole}_${cyc}`,
        cycleNum: cyc, roundNumber: mainRoundNumber,
        seedId: '', legoKey: '', seedCode: '', legoCode: '',
        type: 'pod',
        knownText: isTrans ? sentence.known_text : '',
        targetText: isTrans ? '' : sentence.target_text,
        knownAudioId: isTrans ? (sentence.known_audio_id || undefined) : undefined,
        target1Id: isTrans ? undefined : (sentence.target_audio_id || undefined),
        isNew: false,
        playbackSpeed: speed,
      })
    }
    if (hasBookends && listenOutroAudio) {
      cycleCounter.v++
      emitItem({
        uuid: `listen_outro_pod_R${String(mainRoundNumber).padStart(4, '0')}_${cycleCounter.v}`,
        cycleNum: cycleCounter.v, roundNumber: mainRoundNumber,
        seedId: '', legoKey: '', seedCode: '', legoCode: '',
        type: 'listen_outro',
        knownText: listenOutroAudio.text,
        targetText: '',
        knownAudioId: listenOutroAudio.id,
        isNew: false,
      })
    }
    return true
  }

  // Build seed map for listening phase
  interface SeedData {
    seed_number: number
    known_text: string
    target_text: string
    target_text_roman?: string
    known_audio_id?: string
    target1_audio_id?: string
    target2_audio_id?: string
  }
  const seedMap = new Map<number, SeedData>()
  for (const seed of (seedsResult.data || []) as SeedData[]) {
    seedMap.set(seed.seed_number, seed)
  }

  // FLAG: LEGOs with bracket explanations (these shouldn't exist in production)
  const bracketPattern = /\[.*?\]/
  const legosWithBrackets = (legosResult.data || []).filter(
    (l: any) => bracketPattern.test(l.known_text) || bracketPattern.test(l.target_text)
  )
  if (legosWithBrackets.length > 0) {
    console.warn(`[generateLearningScript] ${legosWithBrackets.length} LEGOs with bracket explanations`)
  }

  // Group phrases by LEGO into BUILD and USE pools
  interface Phrase {
    seed_number: number
    lego_index: number
    known_text: string
    target_text: string
    target_text_roman?: string
    phrase_role: string
    target_syllable_count?: number
    position?: number
    known_audio_id?: string
    target1_audio_id?: string
    target2_audio_id?: string
    presentation_audio_id?: string
    target1_duration_ms?: number
    target2_duration_ms?: number
    introduce?: boolean
  }
  const phrasesByLego = new Map<string, { build: Phrase[]; use: Phrase[]; practice: Phrase[] }>()
  // Collect M-LEGO component breakdowns: legoKey → [{known, target}, ...]
  const componentsByLego = new Map<string, Array<{ known: string; target: string }>>()
  const componentsByLegoNative = new Map<string, Array<{ known: string; target: string }>>()
  // Full component phrases with audio IDs for component priming
  const componentPhrasesByLego = new Map<string, Phrase[]>()
  // Same audio-completeness invariant as LEGOs: a phrase used in a cycle
  // must have all three audio IDs. Visual-only component tiles
  // (introduce === false, shown on intro cards without audio playback)
  // are exempt — they're purely presentational.
  const phraseHasFullAudio = (p: Phrase): boolean =>
    !!(p.known_audio_id && p.target1_audio_id && p.target2_audio_id)
  // Untranslatable component particles (Chinese 了/的/得 etc.) intentionally
  // have empty known_text and no known_audio_id — they're function words
  // with no English equivalent. They're skipped from audio cycles by design,
  // not because of a missing-audio bug. Don't count them in the warning.
  const isIntentionalParticleSkip = (p: Phrase): boolean =>
    p.phrase_role === 'component' && (!p.known_text || p.known_text.trim() === '')
  let phrasesSkippedForAudio = 0
  let particleSkips = 0
  for (const phrase of (phrasesResult.data || []) as Phrase[]) {
    const key = `${phrase.seed_number}:${phrase.lego_index}`
    if (!phrasesByLego.has(key)) phrasesByLego.set(key, { build: [], use: [], practice: [] })
    const group = phrasesByLego.get(key)!
    if (phrase.phrase_role === 'component') {
      // Visual tiles on intro/debut — ALL components (even introduce=false)
      if (!componentsByLego.has(key)) componentsByLego.set(key, [])
      componentsByLego.get(key)!.push({ known: phrase.known_text, target: phrase.target_text_roman || phrase.target_text })
      // Store native script variant when romanized exists
      if (phrase.target_text_roman) {
        if (!componentsByLegoNative.has(key)) componentsByLegoNative.set(key, [])
        componentsByLegoNative.get(key)!.push({ known: phrase.known_text, target: phrase.target_text })
      }
      // Audio cycles (component_intro/component_practice) — only introduced components with full audio
      if (phrase.introduce !== false) {
        if (!phraseHasFullAudio(phrase)) {
          if (isIntentionalParticleSkip(phrase)) particleSkips++
          else phrasesSkippedForAudio++
          continue
        }
        if (!componentPhrasesByLego.has(key)) componentPhrasesByLego.set(key, [])
        componentPhrasesByLego.get(key)!.push(phrase)
      }
      continue
    }
    if (!phraseHasFullAudio(phrase)) {
      phrasesSkippedForAudio++
      continue
    }
    if (phrase.phrase_role === 'build') group.build.push(phrase)
    else if (phrase.phrase_role === 'use') group.use.push(phrase)
    else if (phrase.phrase_role === 'practice') group.practice.push(phrase)
  }
  if (phrasesSkippedForAudio > 0) {
    console.warn(`[generateLearningScript] Skipped ${phrasesSkippedForAudio} practice phrases for "${courseCode}" (missing audio IDs)`)
  }
  if (particleSkips > 0) {
    console.debug(`[generateLearningScript] Skipped ${particleSkips} untranslatable particles for "${courseCode}" (intentional)`)
  }

  console.log(`[generateLearningScript] ${phrasesResult.data?.length || 0} phrases fetched, ${componentsByLego.size} LEGOs with components`)

  // Classify legacy 'practice' phrases per LEGO:
  // - If the LEGO already has explicit USE phrases, practice → BUILD (fragments, drill once)
  // - If the LEGO has NO USE phrases, practice → USE (so it has spaced rep material)
  for (const [, group] of phrasesByLego.entries()) {
    if (group.practice.length === 0) continue
    if (group.use.length > 0) {
      group.build.push(...group.practice)
    } else {
      group.use.push(...group.practice)
    }
    group.practice = []
  }

  // Sort BUILD phrases by syllable count
  for (const [, group] of phrasesByLego.entries()) {
    group.build.sort((a, b) =>
      (a.target_syllable_count || countTargetSyllables(a.target_text)) -
      (b.target_syllable_count || countTargetSyllables(b.target_text))
    )
  }

  // Organize LEGOs by seed
  interface Lego {
    seed_number: number
    lego_index: number
    known_text: string
    target_text: string
    target_text_roman?: string
    type: string
    is_new: boolean
    known_audio_id?: string
    target1_audio_id?: string
    target2_audio_id?: string
    presentation_audio_id?: string
    target1_duration_ms?: number
    target2_duration_ms?: number
  }
  const allLegosRaw = (legosResult.data || []) as Lego[]
  // Invariant: a cycle must never present without all three audio IDs.
  // Partial-import courses (e.g. Greek 2026-04) had LEGOs with NULL target
  // audio, which caused silent-play + circuit-breaker halts. Skip those
  // rows here so the session only schedules playable cycles.
  const allLegos = allLegosRaw.filter(
    l => l.known_audio_id && l.target1_audio_id && l.target2_audio_id
  )
  const legosSkippedForAudio = allLegosRaw.length - allLegos.length

  // Backfill missing presentation_audio_id from course_audio / lego_introductions
  // Some courses have presentation audio generated but not yet linked to course_legos
  const legosMissingPresentation = allLegos.filter(l => l.is_new && !l.presentation_audio_id)
  if (legosMissingPresentation.length > 0) {
    const missingLegoIds = legosMissingPresentation.map(l =>
      `S${String(l.seed_number).padStart(4, '0')}L${String(l.lego_index).padStart(2, '0')}`
    )

    // Try course_audio first (authoritative), then lego_introductions (legacy)
    const [courseAudioResult, introResult] = await Promise.all([
      supabase
        .from('course_audio')
        .select('id, lego_id')
        .eq('course_code', courseCode)
        .eq('role', 'presentation')
        .in('lego_id', missingLegoIds),
      supabase
        .from('lego_introductions')
        .select('lego_id, presentation_audio_id, audio_uuid')
        .eq('course_code', courseCode)
        .in('lego_id', missingLegoIds)
    ])

    // Build lookup: lego_id → audio ID (prefer course_audio.id, fallback to lego_introductions)
    const presLookup = new Map<string, string>()
    for (const row of (introResult.data || []) as any[]) {
      const audioId = row.presentation_audio_id || row.audio_uuid
      if (audioId) presLookup.set(row.lego_id, String(audioId))
    }
    for (const row of (courseAudioResult.data || []) as any[]) {
      if (row.id && row.lego_id) presLookup.set(row.lego_id, row.id)  // overwrites legacy
    }

    if (presLookup.size > 0) {
      console.debug(`[generateLearningScript] Backfilled ${presLookup.size}/${legosMissingPresentation.length} missing presentation audio IDs`)
      for (const lego of legosMissingPresentation) {
        const legoId = `S${String(lego.seed_number).padStart(4, '0')}L${String(lego.lego_index).padStart(2, '0')}`
        const audioId = presLookup.get(legoId)
        if (audioId) lego.presentation_audio_id = audioId
      }
    } else if (legosMissingPresentation.length > 0) {
      console.warn(`[generateLearningScript] ${legosMissingPresentation.length} LEGOs missing presentation audio (not in course_audio or lego_introductions)`)
    }
  }

  const legosBySeed = new Map<number, Lego[]>()
  for (const lego of allLegos) {
    if (!legosBySeed.has(lego.seed_number)) legosBySeed.set(lego.seed_number, [])
    legosBySeed.get(lego.seed_number)!.push(lego)
  }

  // Diagnostic: report what was loaded and what was skipped for missing audio.
  if (allLegosRaw.length === 0) {
    console.warn(`[generateLearningScript] No LEGOs found for course "${courseCode}"`)
  } else if (allLegos.length === 0) {
    console.warn(`[generateLearningScript] ALL ${allLegosRaw.length} LEGOs for "${courseCode}" are missing audio IDs — skipped, course will not play`)
  } else if (legosSkippedForAudio > 0) {
    console.warn(`[generateLearningScript] Skipped ${legosSkippedForAudio}/${allLegosRaw.length} LEGOs for "${courseCode}" (missing audio IDs)`)
  }

  const sortedSeedNums = Array.from(legosBySeed.keys()).sort((a, b) => a - b)
  interface LegoState {
    lastRound: number
    usePhrases: Phrase[]
    useIndex: number
    seedNum: number
    legoIndex: number
    lego: Lego
  }
  const legoState = new Map<string, LegoState>()
  const items: ScriptItem[] = []
  let cycleNum = 0
  let roundNumber = 0

  // Listening phase state.
  // Graduation is anchored to absolute LEGO position in the course
  // catalogue, NOT chunk-local roundNumber. The chunk's roundNumber
  // resets to 0 every script generation, so the old `seedLastRound`
  // map was incomplete whenever a chunk didn't start at seed 1 (belt
  // skip, partial loads) — earlier seeds never entered the map and
  // never graduated, so L1 silently never fired. Catalogue ordinals
  // are stable: pos(S0001L01) = 1, pos(S0001L02) = 2, ... regardless
  // of which chunk is being generated.
  const seedLastLegoOrdinal = new Map<number, number>()  // seedNum → ordinal of its highest-index LEGO
  const legoOrdinalMap = new Map<string, number>()       // legoKey → ordinal
  {
    const catalogue = (catalogueResult.data || []) as Array<{ seed_number: number; lego_index: number }>
    let ord = 0
    for (const row of catalogue) {
      ord++
      const k = `S${String(row.seed_number).padStart(4, '0')}L${String(row.lego_index).padStart(2, '0')}`
      legoOrdinalMap.set(k, ord)
      // Final write for each seed wins → that's the seed's last-LEGO ordinal
      // because the query is ordered by (seed_number, lego_index).
      seedLastLegoOrdinal.set(row.seed_number, ord)
    }
  }
  let currentLegoOrdinal = 0  // updated as each LEGO is introduced in the walk
  const graduatedSeeds = new Set<number>()         // idempotency check
  const graduatedQueue: number[] = []              // graduation order; L1 windows are slices
  // Per-seed L1 fire counter — bumped on each emit in emitL1Cluster.
  // Drives stage progression: stage = floor((fireCount-1) / layer1StageDuration) + 1
  // capped at the highest key in layer1StagePlaylist (eternal hold).
  // Hydrated from persisted learner_l1_state so progression compounds
  // across sessions; null/undefined initialL1FireCounts → cold start
  // (every seed at 0, Stage 1).
  const seedL1FireCount = new Map<number, number>(initialL1FireCounts ?? undefined)

  // Cached sorted stage keys + eternal stage. layer1StagePlaylist may be
  // empty (legacy config) — caller falls back to flat layer1Playlist.
  const layer1StageKeys: number[] = Object.keys(listeningConfig.layer1StagePlaylist || {})
    .map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => a - b)
  const layer1EternalStage: number = layer1StageKeys.length > 0
    ? layer1StageKeys[layer1StageKeys.length - 1]
    : 1
  const layer1StageDuration = listeningConfig.layer1StageDuration ?? 3

  /** Map a per-seed fire count to a stage. Mirrors Layer 2's
   *  podStageFor: transitional stages last `stageDuration` fires; the
   *  highest-numbered stage is eternal. fireCount must be >= 1 (the
   *  count for the current emission). */
  function layer1StageFor(fireCount: number): number {
    if (layer1StageKeys.length === 0) return 1
    for (const stage of layer1StageKeys) {
      if (stage === layer1EternalStage) return stage
      if (fireCount <= stage * layer1StageDuration) return stage
    }
    return layer1EternalStage
  }

  /** Resolve the playlist for a seed at its current fire count. Falls
   *  back to the flat layer1Playlist when no staged config is present. */
  function layer1PlaylistForFireCount(fireCount: number): Layer1PlayRole[] {
    if (layer1StageKeys.length === 0) return listeningConfig.layer1Playlist || []
    const stage = layer1StageFor(fireCount)
    return listeningConfig.layer1StagePlaylist[String(stage)]
      || listeningConfig.layer1StagePlaylist[stage as any]
      || listeningConfig.layer1Playlist
      || []
  }

  // L1 windowing helpers
  function l1ActiveSeedsList(): number[] {
    return graduatedQueue.slice(-listeningConfig.l1ActiveSize)
  }
  function l1ReserveSeedsList(): number[] {
    if (graduatedQueue.length <= listeningConfig.l1ActiveSize) return []
    const reserveEnd = graduatedQueue.length - listeningConfig.l1ActiveSize
    const reserveStart = Math.max(0, reserveEnd - listeningConfig.l1ReserveSize)
    return graduatedQueue.slice(reserveStart, reserveEnd)
  }
  function l1ActiveFiresAt(round: number): boolean {
    return round > 0
      && round % listeningConfig.l1ActiveInterval === 0
      && graduatedQueue.length > 0
  }
  function l1ReserveFiresAt(round: number): boolean {
    return round > 0
      && round % listeningConfig.l1ReserveInterval === 0
      && graduatedQueue.length > listeningConfig.l1ActiveSize
  }

  // Build LEGO text map for phrase decomposition (normalised target text → LEGO key)
  // Uses ALL LEGOs (not just is_new) since reused LEGOs are still valid vocabulary
  const legoTextMap = new Map<string, string>()
  for (const lego of allLegos) {
    const legoKey = `S${String(lego.seed_number).padStart(4, '0')}L${String(lego.lego_index).padStart(2, '0')}`
    const normalized = normalizeText(lego.target_text)
    if (normalized) legoTextMap.set(normalized, legoKey)
    // Also index by romanized text so phrases using target_text_roman can decompose
    if (lego.target_text_roman) {
      const normalizedRoman = normalizeText(lego.target_text_roman)
      if (normalizedRoman && !legoTextMap.has(normalizedRoman)) {
        legoTextMap.set(normalizedRoman, legoKey)
      }
    }
  }

  // Reverse map: LEGO key → display text (prefer romanized for display when available)
  const legoIdToText = new Map<string, string>()
  // Native script map: LEGO key → native text (only populated when romanized exists)
  const legoIdToTextNative = new Map<string, string>()
  for (const lego of allLegos) {
    const legoKey = `S${String(lego.seed_number).padStart(4, '0')}L${String(lego.lego_index).padStart(2, '0')}`
    if (lego.target_text) legoIdToText.set(legoKey, lego.target_text_roman || lego.target_text)
    if (lego.target_text_roman) legoIdToTextNative.set(legoKey, lego.target_text)
  }

  // Greedy longest-match decomposition of a phrase into component LEGO IDs
  // Supports both space-separated languages and CJK (no spaces)
  const cjkRegex = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/
  const isCJK = (text: string) => cjkRegex.test(text)

  // Track synthetic (on-the-fly) LEGOs for unmatched text
  let syntheticCounter = 0
  const syntheticLegoMap = new Map<string, string>() // normalized text → synthetic ID

  const getOrCreateSyntheticLego = (text: string): string => {
    const existing = syntheticLegoMap.get(text)
    if (existing) return existing
    const id = `_SYN${String(++syntheticCounter).padStart(4, '0')}`
    syntheticLegoMap.set(text, id)
    legoIdToText.set(id, text)
    return id
  }

  const decomposePhrase = (targetText: string): string[] => {
    const normalized = normalizeText(targetText)
    if (!normalized) return []

    // CJK: character-level sliding window (no spaces to split on)
    if (isCJK(normalized)) {
      const chars = [...normalized] // proper Unicode split
      const result: string[] = []
      let i = 0
      while (i < chars.length) {
        let longestMatch: string | null = null
        let longestLength = 0
        for (let len = chars.length - i; len > 0; len--) {
          const candidate = chars.slice(i, i + len).join('')
          const legoId = legoTextMap.get(candidate)
          if (legoId) {
            longestMatch = legoId
            longestLength = len
            break
          }
        }
        if (longestMatch) {
          result.push(longestMatch)
          i += longestLength
        } else {
          // Create synthetic LEGO for this character
          const char = chars[i]
          result.push(getOrCreateSyntheticLego(char))
          i++
        }
      }
      return result
    }

    // Space-separated languages: word-level sliding window
    const words = normalized.split(/\s+/).filter(w => w.length > 0)
    const result: string[] = []
    let i = 0
    while (i < words.length) {
      let longestMatch: string | null = null
      let longestLength = 0
      for (let len = words.length - i; len > 0; len--) {
        const candidate = words.slice(i, i + len).join(' ')
        const legoId = legoTextMap.get(candidate)
        if (legoId) {
          longestMatch = legoId
          longestLength = len
          break
        }
      }
      if (longestMatch) {
        result.push(longestMatch)
        i += longestLength
      } else {
        // Create synthetic LEGO for this word
        result.push(getOrCreateSyntheticLego(words[i]))
        i++
      }
    }
    return result
  }

  // Track intros missing presentation audio (logged as summary at end, not per-item)
  const introsMissingAudio: string[] = []

  // Always-true emit gate. The full-course refactor drops emit windowing —
  // the script generator is now one-shot whole-course. The player handles
  // resume-from-position via cursor jumps, not by skipping early items in
  // the script. Helper retained as a no-op for now so the in-loop call
  // sites below don't need editing in this pass.
  const shouldEmit = () => true
  const emitItem = (item: ScriptItem) => {
    if (item.type === 'intro' || item.type === 'component_intro') {
      // Intros ALWAYS pass — they define the round structure.
      // Missing presentation audio is handled by SimplePlayer (skips empty prompt phase).
      // Target voice1/voice2 still play to introduce the LEGO pronunciation.
      if (!item.presentationAudioId && !item.knownAudioId && item.type === 'intro') {
        introsMissingAudio.push(item.legoKey || 'unknown')
      }
    } else if (item.type === 'listening') {
      // Listening items only need target audio (passive listening, no known prompt)
      if (!item.target1Id) return
    } else if (item.type === 'listen_intro' || item.type === 'listen_outro') {
      // Bookends play one known-language clip — no target voices, no pause.
      // The audio is stored under knownAudioId so SimplePlayer's prompt phase
      // picks it up; voice1/voice2 are intentionally absent.
      if (!item.knownAudioId) return
    } else if (item.type === 'pod') {
      // Pod plays carry exactly one of {knownAudioId (translation play),
      // target1Id (sentence play, possibly with playbackSpeed=2.0)}. Never
      // both, never target2Id. The "all three audio IDs" check below would
      // wrongly drop every pod item, leaving the round-end lap empty.
      if (!item.knownAudioId && !item.target1Id) return
    } else {
      // Non-intro items need all three audio IDs to be useful
      if (!item.knownAudioId || !item.target1Id || !item.target2Id) return
    }
    items.push(item)
  }

  // Whether this course has any romanized text (for toggle detection)
  const courseHasRomanized = legoIdToTextNative.size > 0

  // Helper: returns native text fields when romanized text exists
  const nativeFields = (item: { target_text?: string; target_text_roman?: string }) =>
    item.target_text_roman ? { targetTextNative: item.target_text } : {}

  // Process each seed
  for (const seedNum of sortedSeedNums) {
    // Only process LEGOs that are NEW (is_new = true)
    // LEGOs with is_new = false were already introduced in earlier seeds
    const seedLegos = legosBySeed.get(seedNum)!
      .filter(l => l.is_new)
      .sort((a, b) => a.lego_index - b.lego_index)

    for (const lego of seedLegos) {
      roundNumber++
      const legoKey = `S${String(seedNum).padStart(4, '0')}L${String(lego.lego_index).padStart(2, '0')}`
      const seedId = `S${String(seedNum).padStart(4, '0')}`
      const legoNum = String(lego.lego_index).padStart(2, '0')
      const phraseKey = `${seedNum}:${lego.lego_index}`
      const phrases = phrasesByLego.get(phraseKey) || { build: [], use: [] }
      // presentation_audio_id comes directly from course_legos (or backfilled above)
      const presentationAudioId = lego.presentation_audio_id
      // Fallback: if no presentation audio, use known_audio_id so the intro still plays
      // the LEGO itself (known → target1 → target2, no pause) — learner hears it passively
      // before the debut asks them to produce it.
      const introAudioId = presentationAudioId || lego.known_audio_id

      const usedPhrasesThisRound = new Set<string>()
      const legoComponents = componentsByLego.get(phraseKey)
      const legoComponentsNative = componentsByLegoNative.get(phraseKey)

      // Phase 1: INTRO
      // The M-LEGO is the cognitive unit. For M-LEGOs the per-component breakdown
      // is rendered as ghost text under each target word (visual scaffolding) — we
      // do NOT pre-introduce components with their own audio cycles. A-LEGOs just
      // get a standard intro.
      cycleNum++
      emitItem({
        uuid: `${legoKey}_intro_${cycleNum}`,
        cycleNum, roundNumber, seedId, legoKey,
        seedCode: seedId, legoCode: legoNum,
        type: 'intro',
        knownText: lego.known_text,
        targetText: lego.target_text_roman || lego.target_text,
        ...nativeFields(lego),
        presentationAudioId: introAudioId,
        target1Id: lego.target1_audio_id,
        target2Id: lego.target2_audio_id,
        target1DurationMs: lego.target1_duration_ms,
        target2DurationMs: lego.target2_duration_ms,
        isNew: true,
        ...(legoComponents ? { components: legoComponents } : {}),
        ...(legoComponentsNative ? { componentsNative: legoComponentsNative } : {}),
      })

      // Phase 2: DEBUT
      cycleNum++
      emitItem({
        uuid: `${legoKey}_debut_${cycleNum}`,
        cycleNum, roundNumber, seedId, legoKey,
        seedCode: seedId, legoCode: legoNum,
        type: 'debut',
        knownText: lego.known_text,
        targetText: lego.target_text_roman || lego.target_text,
        ...nativeFields(lego),
        knownAudioId: lego.known_audio_id,
        target1Id: lego.target1_audio_id,
        target2Id: lego.target2_audio_id,
        target1DurationMs: lego.target1_duration_ms,
        target2DurationMs: lego.target2_duration_ms,
        isNew: true,
        ...(legoComponents ? { components: legoComponents } : {}),
        ...(legoComponentsNative ? { componentsNative: legoComponentsNative } : {}),
      })

      // Phase 3: BUILD phrases up to 7
      let practiceCount = 0
      const usedForPractice = new Set<string>()

      for (const phrase of phrases.build) {
        if (practiceCount >= MAX_BUILD_PHRASES) break
        cycleNum++
        practiceCount++
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        usedPhrasesThisRound.add(phraseId)
        emitItem({
          uuid: `${legoKey}_build_${cycleNum}`,
          cycleNum, roundNumber, seedId, legoKey,
          seedCode: seedId, legoCode: legoNum,
          type: 'build',
          knownText: phrase.known_text,
          targetText: phrase.target_text_roman || phrase.target_text,
          ...nativeFields(phrase),
          knownAudioId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          target1DurationMs: phrase.target1_duration_ms,
          target2DurationMs: phrase.target2_duration_ms,
          isNew: true,
          syllableCount: phrase.target_syllable_count || countTargetSyllables(phrase.target_text),
          ...(practiceCount > TURBO_BUILD_KEEP ? { turboOmit: true } : {}),
        })
      }

      // Fill remaining BUILD slots with USE phrases (BUILD priority > CONSOLIDATE)
      // CONSOLIDATE can repeat BUILD phrases if needed — filling 7 BUILD is non-negotiable
      const sortedUsePhrases = [...phrases.use].sort((a, b) =>
        (a.target_syllable_count || countTargetSyllables(a.target_text)) -
        (b.target_syllable_count || countTargetSyllables(b.target_text))
      )
      for (const phrase of sortedUsePhrases) {
        if (practiceCount >= MAX_BUILD_PHRASES) break
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        if (usedPhrasesThisRound.has(phraseId)) continue

        cycleNum++
        practiceCount++
        usedPhrasesThisRound.add(phraseId)
        usedForPractice.add(phraseId)
        emitItem({
          uuid: `${legoKey}_build_${cycleNum}`,
          cycleNum, roundNumber, seedId, legoKey,
          seedCode: seedId, legoCode: legoNum,
          type: 'build',
          knownText: phrase.known_text,
          targetText: phrase.target_text_roman || phrase.target_text,
          ...nativeFields(phrase),
          knownAudioId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          target1DurationMs: phrase.target1_duration_ms,
          target2DurationMs: phrase.target2_duration_ms,
          isNew: true,
          syllableCount: phrase.target_syllable_count || countTargetSyllables(phrase.target_text),
          ...(practiceCount > TURBO_BUILD_KEEP ? { turboOmit: true } : {}),
        })
      }

      // Initialize LEGO state
      legoState.set(legoKey, {
        lastRound: roundNumber,
        usePhrases: [...phrases.use],
        useIndex: 0,
        seedNum, legoIndex: lego.lego_index, lego
      })

      // Update absolute LEGO ordinal for graduation tracking. Catalogue
      // lookup, NOT chunk-local roundNumber — see seedLastLegoOrdinal
      // comment for why.
      currentLegoOrdinal = legoOrdinalMap.get(legoKey) ?? currentLegoOrdinal

      // Phase 4: SPACED REP
      const dueForReview: { key: string; state: LegoState; fibPosition: number; phraseCount: number }[] = []
      const seenLegos = new Set<string>()

      for (let offsetIdx = 0; offsetIdx < SPACED_REP_OFFSETS.length; offsetIdx++) {
        const offset = SPACED_REP_OFFSETS[offsetIdx]
        const reviewRound = roundNumber - offset
        if (reviewRound < 1) break

        for (const [prevKey, state] of legoState.entries()) {
          if (prevKey === legoKey || seenLegos.has(prevKey)) continue
          // Skip LEGOs from graduated seeds — they're in listening now
          if (graduatedSeeds.has(state.seedNum)) continue
          if (state.lastRound === reviewRound) {
            const isN1 = offset === 1
            const phraseCount = isN1 ? N1_PHRASE_COUNT : 1
            dueForReview.push({ key: prevKey, state, fibPosition: offsetIdx, phraseCount })
            seenLegos.add(prevKey)
          }
        }
      }

      let spacedRepCount = 0
      for (const { key: reviewKey, state, fibPosition, phraseCount } of dueForReview) {
        if (spacedRepCount >= MAX_SPACED_REP_PHRASES) break
        if (state.usePhrases.length === 0) continue

        const reviewLegoNum = reviewKey.match(/L(\d+)/)?.[1] || ''
        const reviewSeedId = reviewKey.match(/S\d+/)?.[0] || ''

        const phrasesToUse = Math.min(phraseCount, MAX_SPACED_REP_PHRASES - spacedRepCount, state.usePhrases.length)
        for (let i = 0; i < phrasesToUse; i++) {
          const phrase = state.usePhrases[state.useIndex % state.usePhrases.length]
          state.useIndex++

          const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
          if (usedPhrasesThisRound.has(phraseId)) continue
          usedPhrasesThisRound.add(phraseId)

          cycleNum++
          spacedRepCount++
          emitItem({
            uuid: `${reviewKey}_spaced_rep_${cycleNum}`,
            cycleNum, roundNumber, seedId: reviewSeedId, legoKey: reviewKey,
            seedCode: reviewSeedId, legoCode: reviewLegoNum,
            type: 'spaced_rep',
            knownText: phrase.known_text,
            targetText: phrase.target_text_roman || phrase.target_text,
            ...nativeFields(phrase),
            knownAudioId: phrase.known_audio_id,
            target1Id: phrase.target1_audio_id,
            target2Id: phrase.target2_audio_id,
            target1DurationMs: phrase.target1_duration_ms,
            target2DurationMs: phrase.target2_duration_ms,
            isNew: false,
            fibPosition,
            reviewOf: state.lastRound,
            ...(TURBO_FIB_KEEP.has(fibPosition) ? {} : { turboOmit: true }),
          })
        }
      }

      // Phase 5: CONSOLIDATE ×2 - prefer unused USE phrases, allow reuse if pool exhausted
      let consolidateCount = 0
      const emitConsolidate = (phrase: Phrase) => {
        consolidateCount++
        cycleNum++
        emitItem({
          uuid: `${legoKey}_use_${cycleNum}`,
          cycleNum, roundNumber, seedId, legoKey,
          seedCode: seedId, legoCode: legoNum,
          type: 'use',
          knownText: phrase.known_text,
          targetText: phrase.target_text_roman || phrase.target_text,
          ...nativeFields(phrase),
          knownAudioId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          target1DurationMs: phrase.target1_duration_ms,
          target2DurationMs: phrase.target2_duration_ms,
          isNew: true,
          ...(consolidateCount > TURBO_USE_KEEP ? { turboOmit: true } : {}),
        })
      }
      // First pass: unused USE phrases
      for (const phrase of sortedUsePhrases) {
        if (consolidateCount >= USE_CONSOLIDATION_COUNT) break
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        if (usedPhrasesThisRound.has(phraseId)) continue
        usedPhrasesThisRound.add(phraseId)
        emitConsolidate(phrase)
      }
      // Second pass: reuse USE phrases already used in BUILD (pool was too small)
      if (consolidateCount < USE_CONSOLIDATION_COUNT) {
        for (const phrase of sortedUsePhrases) {
          if (consolidateCount >= USE_CONSOLIDATION_COUNT) break
          emitConsolidate(phrase)
        }
      }

      // Phase 6: Layer 1 (graduated seeds) — graduation tracking + dual-rotation emission.
      // Graduation is event-driven: a seed graduates once `offset` rounds have
      // elapsed since its last LEGO. The active-10 plays every 3 rounds; the
      // reserve plays every 13 rounds. When both fire (every 39 rounds) we
      // emit one combined cluster, reserve first then active.
      if (listeningConfig.enabled) {
        // Graduate any seed whose last LEGO is at least `offset` LEGOs
        // behind the learner's current LEGO. Catalogue-anchored — works
        // identically whether this is a fresh full-course generation or
        // a belt-skip chunk dropping in mid-course.
        for (const [sNum, lastOrd] of seedLastLegoOrdinal) {
          if (graduatedSeeds.has(sNum)) continue
          if (currentLegoOrdinal === 0) continue  // no LEGO seen yet in this walk
          if (currentLegoOrdinal - lastOrd < listeningConfig.offset) continue
          graduatedSeeds.add(sNum)
          graduatedQueue.push(sNum)
        }

        const fireActive = l1ActiveFiresAt(roundNumber)
        const fireReserve = l1ReserveFiresAt(roundNumber)
        if (fireActive || fireReserve) {
          const seeds: number[] = []
          if (fireReserve) seeds.push(...l1ReserveSeedsList())
          if (fireActive) seeds.push(...l1ActiveSeedsList())
          const listenCounter = { v: cycleNum }
          // When L2 will fire on the same round, drop the L1 outro — the
          // runtime pod lap will also drop its intro so the two clusters
          // play as one continuous listening section.
          emitL1Cluster(seeds, roundNumber, listenCounter, l2FiresAt(roundNumber))
          cycleNum = listenCounter.v
        }
      }

      // Phase 7 (Layer 2 Pod 0) used to emit pod laps here. Pods are now
      // runtime-scheduled by usePodLapScheduler so they decouple from main
      // round arithmetic — see migration 20260504_pod_ratchet.sql for the
      // model. The pod emission helpers below (emitPodLap / podStageFor /
      // STAGE_PLAYLIST / hasPods / podSentences / podRoundForMainRound /
      // l2FiresAt / listenIntroAudio / listenOutroAudio / hasBookends) are
      // intentionally retained as dead code for one release so a hot-fix
      // rollback only needs to re-add this if-block. Safe to delete after
      // the runtime path is proven on staging.
    }
  }

  // ==========================================================================
  // INFINITE-PLAY ROUNDS — review-only rounds after all new LEGOs introduced
  // ==========================================================================
  //
  // The course never ends. Once the main loop has introduced every new LEGO
  // from the range, we keep incrementing roundNumber and emitting review
  // rounds shaped as:
  //
  //   - target ~TARGET_ROUND_CYCLES (20) cycles per round
  //   - spaced-rep fills first via the same N-1, N-2, ..., N-89 fib-offset
  //     logic as the main loop, capped at MAX_SPACED_REP_PHRASES
  //   - random USE fills the remainder, with a floor of MIN_RANDOM_USE (10):
  //     one phrase each from distinct LEGOs sampled uniformly at random
  //     across the whole debuted inventory. (Previously recency-tiered, but
  //     in infinite play every LEGO has been debuted, so a recency bias
  //     becomes topic clustering toward the back end of the course.)
  //     Random-USE selections are deduped against this round's spaced-rep set.
  //
  // We do NOT mutate lastRound on random USE — the fib decay drains
  // naturally. Long-tail steady state is pure recency-biased USE.
  //
  // How many infinite-play rounds we generate is `infinitePlayLookahead`
  // rounds beyond the main loop's last round. After the full-course
  // refactor this is always the same number (default 50) regardless of
  // where the learner is — the script is one-shot whole-course; the
  // player consumes from wherever its cursor lands.

  const TARGET_ROUND_CYCLES = 20
  const MIN_RANDOM_USE = 10
  const mainLoopLastRound = roundNumber
  const revivalCap = mainLoopLastRound + infinitePlayLookahead

  while (roundNumber < revivalCap) {
    roundNumber++
    const usedPhrasesThisRound = new Set<string>()
    let cycleNum = 0

    // Phase 1: SPACED-REP candidate set — same logic as the main loop.
    // LEGOs whose lastRound matches N-1, N-2, ..., N-89 from the current
    // round, skipping graduated-into-listening seeds.
    const dueForReview: { key: string; state: LegoState; fibPosition: number; phraseCount: number }[] = []
    const seenLegos = new Set<string>()
    for (let offsetIdx = 0; offsetIdx < SPACED_REP_OFFSETS.length; offsetIdx++) {
      const offset = SPACED_REP_OFFSETS[offsetIdx]
      const reviewRound = roundNumber - offset
      if (reviewRound < 1) break
      for (const [prevKey, state] of legoState.entries()) {
        if (seenLegos.has(prevKey)) continue
        if (graduatedSeeds.has(state.seedNum)) continue
        if (state.lastRound === reviewRound) {
          const isN1 = offset === 1
          const phraseCount = isN1 ? N1_PHRASE_COUNT : 1
          dueForReview.push({ key: prevKey, state, fibPosition: offsetIdx, phraseCount })
          seenLegos.add(prevKey)
        }
      }
    }

    // Project how many spaced-rep cycles will actually fire (capped) so
    // we can size the random-USE bucket to maintain ~TARGET_ROUND_CYCLES.
    let projectedSpacedRep = 0
    for (const { phraseCount } of dueForReview) {
      if (projectedSpacedRep >= MAX_SPACED_REP_PHRASES) break
      projectedSpacedRep += Math.min(phraseCount, MAX_SPACED_REP_PHRASES - projectedSpacedRep)
    }
    const randomUseCount = Math.max(MIN_RANDOM_USE, TARGET_ROUND_CYCLES - projectedSpacedRep)

    // Phase 2: RANDOM USE selection — uniform random over ALL debuted LEGOs.
    //
    // Previous design used recency tiers (50% last 55 / 25% next 100 / 25%
    // rest), which made sense mid-course where "recent" tracks current
    // content. In infinite play every LEGO has been debuted, so the recency
    // bias becomes a topic-clustering bias toward the back end of the
    // course — for a 300-seed course that's half the round locked to ~26
    // seeds at the top. Uniform sampling gives the learner genuine variety
    // across the whole inventory.
    //
    // Deduped against the spaced-rep set so a LEGO can't appear twice in
    // one round.
    const spacedRepKeys = new Set(dueForReview.map(d => d.key))
    const allKeys = [...legoState.keys()]
    const pool = allKeys.filter(k => !spacedRepKeys.has(k))
    const chosenKeys = sampleWithoutReplacement(pool, randomUseCount)

    // Phase 3: emit random USE (1 phrase per LEGO, advance round-robin
    // useIndex so phrases rotate across visits).
    if (shouldEmit()) {
      for (const legoKey of chosenKeys) {
        const state = legoState.get(legoKey)
        if (!state || state.usePhrases.length === 0) continue
        const phrase = state.usePhrases[state.useIndex % state.usePhrases.length]
        state.useIndex++
        if (!phrase.known_audio_id || !phrase.target1_audio_id || !phrase.target2_audio_id) continue
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        if (usedPhrasesThisRound.has(phraseId)) continue
        usedPhrasesThisRound.add(phraseId)
        const legoNum = legoKey.match(/L(\d+)/)?.[1] || ''
        const seedId = legoKey.match(/S\d+/)?.[0] || ''
        cycleNum++
        emitItem({
          uuid: `${legoKey}_inf_R${roundNumber}_${cycleNum}`,
          cycleNum, roundNumber, seedId, legoKey,
          seedCode: seedId, legoCode: legoNum,
          type: 'use',
          knownText: phrase.known_text,
          targetText: phrase.target_text_roman || phrase.target_text,
          ...nativeFields(phrase),
          knownAudioId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          target1DurationMs: phrase.target1_duration_ms,
          target2DurationMs: phrase.target2_duration_ms,
          isNew: false,
        })
      }
    }

    // Phase 4: emit spaced rep — same shape as main-loop spaced rep.
    if (shouldEmit()) {
      let spacedRepCount = 0
      for (const { key: reviewKey, state, fibPosition, phraseCount } of dueForReview) {
        if (spacedRepCount >= MAX_SPACED_REP_PHRASES) break
        if (state.usePhrases.length === 0) continue

        const reviewLegoNum = reviewKey.match(/L(\d+)/)?.[1] || ''
        const reviewSeedId = reviewKey.match(/S\d+/)?.[0] || ''

        const phrasesToUse = Math.min(phraseCount, MAX_SPACED_REP_PHRASES - spacedRepCount, state.usePhrases.length)
        for (let i = 0; i < phrasesToUse; i++) {
          const phrase = state.usePhrases[state.useIndex % state.usePhrases.length]
          state.useIndex++
          const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
          if (usedPhrasesThisRound.has(phraseId)) continue
          usedPhrasesThisRound.add(phraseId)
          if (!phrase.known_audio_id || !phrase.target1_audio_id || !phrase.target2_audio_id) continue
          cycleNum++
          spacedRepCount++
          emitItem({
            uuid: `${reviewKey}_inf_sr_R${roundNumber}_${cycleNum}`,
            cycleNum, roundNumber, seedId: reviewSeedId, legoKey: reviewKey,
            seedCode: reviewSeedId, legoCode: reviewLegoNum,
            type: 'spaced_rep',
            knownText: phrase.known_text,
            targetText: phrase.target_text_roman || phrase.target_text,
            ...nativeFields(phrase),
            knownAudioId: phrase.known_audio_id,
            target1Id: phrase.target1_audio_id,
            target2Id: phrase.target2_audio_id,
            target1DurationMs: phrase.target1_duration_ms,
            target2DurationMs: phrase.target2_duration_ms,
            isNew: false,
            fibPosition,
            reviewOf: state.lastRound,
            ...(TURBO_FIB_KEEP.has(fibPosition) ? {} : { turboOmit: true }),
          })
        }
      }
    }

    // Phase 5: Listening (L1 active-10 every 3 rounds + reserve every 13;
    // L2 runtime-scheduled). Same as main loop — keeps the listening layer
    // ticking through infinite play.
    if (shouldEmit()) {
      const fireActive = l1ActiveFiresAt(roundNumber)
      const fireReserve = l1ReserveFiresAt(roundNumber)
      if (fireActive || fireReserve) {
        const seeds: number[] = []
        if (fireReserve) seeds.push(...l1ReserveSeedsList())
        if (fireActive) seeds.push(...l1ActiveSeedsList())
        const listenCounter = { v: cycleNum }
        emitL1Cluster(seeds, roundNumber, listenCounter, l2FiresAt(roundNumber))
        cycleNum = listenCounter.v
      }
    }

    // Safety: if nothing emitted (no usable LEGOs at all), stop — otherwise
    // we'd loop emitting empty rounds.
    if (cycleNum === 0) break
  }

  // Decompose phrases into component LEGO IDs
  let decomposedCount = 0
  for (const item of items) {
    if (item.type === 'intro' || item.type === 'debut' || item.type === 'listening' || item.type === 'component_intro' || item.type === 'component_practice' || item.type === 'pod' || item.type === 'listen_intro' || item.type === 'listen_outro') continue
    const components = decomposePhrase(item.targetText)
    if (components.length > 0) {
      item.componentLegoIds = components
      item.componentLegoTexts = components.map(id => legoIdToText.get(id) || '')
      if (courseHasRomanized) {
        item.componentLegoTextsNative = components.map(id => legoIdToTextNative.get(id) || legoIdToText.get(id) || '')
      }
      decomposedCount++
    }
  }
  console.debug(`[generateLearningScript] Decomposed ${decomposedCount}/${items.filter(i => i.type !== 'intro' && i.type !== 'debut').length} phrases into LEGO components (${legoTextMap.size} LEGOs in map)`)

  // Remove consecutive duplicates (matching dashboard logic)
  const dedupedItems: ScriptItem[] = []
  let lastNonIntroItem: ScriptItem | null = null

  for (const item of items) {
    if (item.type === 'intro' || item.type === 'debut' || item.type === 'listening' || item.type === 'component_intro' || item.type === 'pod' || item.type === 'listen_intro' || item.type === 'listen_outro') {
      dedupedItems.push(item)
      continue
    }

    if (lastNonIntroItem) {
      const sameKnown = normalizeText(item.knownText) === normalizeText(lastNonIntroItem.knownText)
      const sameTarget = normalizeText(item.targetText) === normalizeText(lastNonIntroItem.targetText)
      if (sameKnown && sameTarget) continue
    }

    dedupedItems.push(item)
    lastNonIntroItem = item
  }

  const removedCount = items.length - dedupedItems.length

  // Filter out incomplete rounds (LEGOs that exist but have no audio yet — unbuilt seeds)
  // Group items by round, check if the round's intro/debut has a target1Id
  const roundHasAudio = new Set<number>()
  const roundMissingAudio = new Set<number>()
  for (const item of dedupedItems) {
    if ((item.type === 'intro' || item.type === 'debut' || item.type === 'component_intro') && item.target1Id) {
      roundHasAudio.add(item.roundNumber)
    }
    if ((item.type === 'intro' || item.type === 'debut' || item.type === 'component_intro') && !item.target1Id) {
      roundMissingAudio.add(item.roundNumber)
    }
  }
  // Drop rounds that have no audio at all (unbuilt seeds), and drop individual
  // cycles missing required text (partially-built phrases). Per-cycle filtering
  // preserves the good cycles in a partially-incomplete round; whole-round
  // filtering preserves nothing if even one cycle is good.
  //
  // Listening items (pod/bookend) are exempt: pod sentence plays have empty
  // knownText, pod translation plays have empty targetText, and bookends
  // have empty targetText. These are by design — the text-completeness check
  // is for unbuilt LEGO/phrase rows, not for listening cycles whose missing
  // side reflects their play role.
  const TEXT_CHECK_EXEMPT = new Set(['pod', 'listen_intro', 'listen_outro', 'listening'])
  const incompleteByAudio = new Set([...roundMissingAudio].filter(r => !roundHasAudio.has(r)))
  let droppedByText = 0
  const playableItems = dedupedItems.filter(item => {
    if (incompleteByAudio.has(item.roundNumber)) return false
    if (TEXT_CHECK_EXEMPT.has(item.type)) return true
    const knownOk = typeof item.knownText === 'string' && item.knownText.trim().length > 0
    const targetOk = typeof item.targetText === 'string' && item.targetText.trim().length > 0
    if (!knownOk || !targetOk) {
      droppedByText++
      return false
    }
    return true
  })

  if (incompleteByAudio.size > 0 || droppedByText > 0) {
    console.info(`[generateLearningScript] Filtered ${incompleteByAudio.size} no-audio rounds, ${droppedByText} missing-text cycles`)
  }

  // Validate generated script integrity in dev mode only — production cold
  // start doesn't benefit from re-checking script integrity at runtime, and
  // validating a 9999-round script costs hundreds of ms on in-progress
  // courses where most rounds end up with errors anyway.
  // Defensive: import.meta.env is Vite-specific, so guard for non-Vite hosts
  // (e.g. running this module under tsx for diagnostic scripts).
  const isDevBuild = (() => {
    try { return !!(import.meta as any)?.env?.DEV } catch { return false }
  })()
  if (isDevBuild) {
    const validationReport = validateLearningScript(playableItems)
    if (!validationReport.valid) {
      console.warn(`[generateLearningScript] Validation: ${validationReport.summary}`)
    }
  }

  // Summary: intros missing presentation audio (single log instead of per-item spam)
  if (introsMissingAudio.length > 0) {
    console.warn(`[generateLearningScript] ${introsMissingAudio.length} intros missing presentation audio — will play target audio only`)
  }

  // Recount rounds from playable items
  const playableRoundCount = new Set(playableItems.map(i => i.roundNumber)).size
  const listeningItemCount = playableItems.filter(i => i.type === 'listening').length
  const listeningStats = listeningConfig.enabled && graduatedSeeds.size > 0
    ? `, ${graduatedSeeds.size} seeds graduated, ${listeningItemCount} listening items`
    : ''
  console.debug(`[generateLearningScript] ${playableItems.length} items, ${playableRoundCount} rounds for ${courseCode}${removedCount > 0 ? `, ${removedCount} deduped` : ''}${incompleteByAudio.size > 0 ? `, ${incompleteByAudio.size} no-audio rounds` : ''}${droppedByText > 0 ? `, ${droppedByText} bad-text cycles` : ''}${listeningStats}`)
  return { items: playableItems, cycleCount: playableItems.length, roundCount: playableRoundCount, hasRomanizedText: courseHasRomanized }
}
