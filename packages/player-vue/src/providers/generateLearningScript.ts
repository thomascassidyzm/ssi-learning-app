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
  // Layer 2 — Pod 0
  podActivationRound: number  // first pod lap fires at end of this main round (start of seed 2)
}

export const DEFAULT_LISTENING_CONFIG: ListeningConfig = {
  enabled: true,
  offset: 56,
  l1ActiveSize: 10,
  l1ActiveInterval: 3,
  l1ReserveSize: 50,
  l1ReserveInterval: 13,
  podActivationRound: 6,
}

export interface LearningScriptResult {
  items: ScriptItem[]
  cycleCount: number
  roundCount: number
  hasRomanizedText: boolean
}

export async function generateLearningScript(
  supabase: SupabaseClient,
  courseCode: string,
  startSeed: number,
  endSeed: number,
  emitFromRound: number = 1,  // Only emit ScriptItems from this round onward
  listeningConfig: ListeningConfig = DEFAULT_LISTENING_CONFIG
): Promise<LearningScriptResult> {
  // Constants
  const SPACED_REP_OFFSETS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
  const MAX_BUILD_PHRASES = 7
  const USE_CONSOLIDATION_COUNT = 2
  const MAX_SPACED_REP_PHRASES = 12
  const N1_PHRASE_COUNT = 3

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

  // Query tables directly - audio IDs stored on each row, no joins needed
  const [legosResult, phrasesResult, seedsResult, bookendsResult, podsResult] = await Promise.all([
    supabase
      .from('course_legos')
      .select('seed_number, lego_index, known_text, target_text, target_text_roman, type, is_new, known_audio_id, target1_audio_id, target2_audio_id, presentation_audio_id, target1_duration_ms, target2_duration_ms')
      .eq('course_code', courseCode)
      .gte('seed_number', startSeed)
      .lte('seed_number', endSeed)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .limit(5000),
    supabase
      .from('course_practice_phrases')
      .select('seed_number, lego_index, known_text, target_text, target_text_roman, phrase_role, target_syllable_count, position, known_audio_id, target1_audio_id, target2_audio_id, presentation_audio_id, target1_duration_ms, target2_duration_ms, introduce')
      .eq('course_code', courseCode)
      .gte('seed_number', startSeed)
      .lte('seed_number', endSeed)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .order('position', { ascending: true })
      .limit(10000),
    // Fetch seed sentences for listening phase (whole-sentence replay after graduation).
    // No upper-N cap any more — graduation is event-driven and any seed in [startSeed, endSeed]
    // can land in the L1 active/reserve window over the course's lifetime.
    listeningConfig.enabled
      ? supabase
          .from('course_seeds')
          .select('seed_number, known_text, target_text, target_text_roman, known_audio_id, target1_audio_id, target2_audio_id')
          .eq('course_code', courseCode)
          .gte('seed_number', startSeed)
          .lte('seed_number', endSeed)
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

  // ---------------------------------------------------------------------------
  // AUDIO ID FALLBACK (tolerance layer — Lever 1)
  //
  // The dashboard's text-edit trigger NULLs `*_audio_id` columns on
  // course_legos / course_practice_phrases when text changes, but no inverse
  // trigger re-links them when fresh audio later lands in course_audio. So
  // rows can stay NULL even when the audio exists. This block looks up any
  // missing IDs in course_audio by (role, normalized text) and patches them
  // in memory before the downstream audio-completeness filters run.
  //
  // Once the dashboard closes the re-link gap at source, this section becomes
  // redundant and should be deleted.
  // ---------------------------------------------------------------------------
  const normalizeForAudioMatch = (text: string | undefined | null): string => {
    if (!text || typeof text !== 'string') return ''
    // Mirror dashboard's normalize_text(): lower(trim(t)) then strip trailing
    // sentence-ending punctuation across English / Spanish / CJK marks.
    return text.toLowerCase().trim().replace(/[.?!¿¡。？！]+$/, '')
  }
  type FallbackRow = {
    phrase_role?: string
    known_text: string
    target_text: string
    known_audio_id?: string
    target1_audio_id?: string
    target2_audio_id?: string
  }
  const legosForFallback = (legosResult.data || []) as FallbackRow[]
  const phrasesForFallback = (phrasesResult.data || []) as FallbackRow[]
  const phraseNeedsFallback = (p: FallbackRow) =>
    p.phrase_role !== 'component' &&
    (!p.known_audio_id || !p.target1_audio_id || !p.target2_audio_id)
  const legoNeedsFallback = (l: FallbackRow) =>
    !l.known_audio_id || !l.target1_audio_id || !l.target2_audio_id
  const fallbackNeeded =
    legosForFallback.some(legoNeedsFallback) ||
    phrasesForFallback.some(phraseNeedsFallback)

  if (fallbackNeeded) {
    const audioRowsResult = await supabase
      .from('course_audio')
      .select('id, text_normalized, role')
      .eq('course_code', courseCode)
      .in('role', ['known', 'target1', 'target2'])
      .limit(20000)

    if (audioRowsResult.error) {
      console.warn(`[generateLearningScript] Audio fallback query failed: ${audioRowsResult.error.message}`)
    } else if (audioRowsResult.data && audioRowsResult.data.length > 0) {
      const audioLookup = new Map<string, string>()
      for (const row of audioRowsResult.data as Array<{ id: string; text_normalized: string; role: string }>) {
        audioLookup.set(`${row.role}:${normalizeForAudioMatch(row.text_normalized)}`, row.id)
      }

      let patchedLego = 0
      let patchedPhrase = 0
      const tryPatch = (row: FallbackRow, isPhrase: boolean) => {
        if (!row.known_audio_id) {
          const id = audioLookup.get(`known:${normalizeForAudioMatch(row.known_text)}`)
          if (id) { row.known_audio_id = id; if (isPhrase) patchedPhrase++; else patchedLego++ }
        }
        if (!row.target1_audio_id) {
          const id = audioLookup.get(`target1:${normalizeForAudioMatch(row.target_text)}`)
          if (id) { row.target1_audio_id = id; if (isPhrase) patchedPhrase++; else patchedLego++ }
        }
        if (!row.target2_audio_id) {
          const id = audioLookup.get(`target2:${normalizeForAudioMatch(row.target_text)}`)
          if (id) { row.target2_audio_id = id; if (isPhrase) patchedPhrase++; else patchedLego++ }
        }
      }
      for (const lego of legosForFallback) {
        if (legoNeedsFallback(lego)) tryPatch(lego, false)
      }
      for (const phrase of phrasesForFallback) {
        if (phraseNeedsFallback(phrase)) tryPatch(phrase, true)
      }
      if (patchedLego > 0 || patchedPhrase > 0) {
        console.info(`[generateLearningScript] Audio fallback recovered ${patchedLego} LEGO + ${patchedPhrase} phrase audio IDs from course_audio (link drift)`)
      }
    }
  }

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
  const POD_ACTIVATION_ROUND = listeningConfig.podActivationRound
  type PodPlayRole = 'ps' | 'trans' | 'ps2x'
  // Stage playlists (per Aran's notebook 2026-04-29). PS = pod sentence at 1.0×,
  // PS×2 at 2.0×, trans = English translation. Stages 1-6 each last 3 pod-rounds;
  // stage 7 is the eternal holding bay.
  const STAGE_PLAYLIST: Record<number, PodPlayRole[]> = {
    1: ['ps', 'trans', 'ps', 'ps2x'],
    2: ['ps', 'trans', 'ps2x', 'ps2x'],
    3: ['ps', 'trans', 'ps2x'],
    4: ['ps2x', 'trans', 'ps2x'],
    5: ['ps', 'ps2x'],
    6: ['ps2x', 'ps2x'],
    7: ['ps2x'],
  }
  function podStageFor(entryPodRound: number, currentPodRound: number): { stage: number; iter: number | null } | null {
    const alive = currentPodRound - entryPodRound + 1
    if (alive < 1) return null
    if (alive <= 3) return { stage: 1, iter: alive }
    if (alive <= 6) return { stage: 2, iter: alive - 3 }
    if (alive <= 9) return { stage: 3, iter: alive - 6 }
    if (alive <= 12) return { stage: 4, iter: alive - 9 }
    if (alive <= 15) return { stage: 5, iter: alive - 12 }
    if (alive <= 18) return { stage: 6, iter: alive - 15 }
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

  // Pod-round = main-round - activation + 1, 1:1 from the activation round onwards.
  function podRoundForMainRound(mainRound: number): number {
    if (mainRound < POD_ACTIVATION_ROUND) return 0
    return mainRound - POD_ACTIVATION_ROUND + 1
  }
  function l2FiresAt(round: number): boolean {
    return hasPods && round >= POD_ACTIVATION_ROUND
  }

  // Emit Layer 1 LISTEN cluster — bookend-wrapped block of graduated seeds.
  // Caller passes the seeds to play (active, reserve, or both reserve+active
  // when their rotations clash). Each seed plays once at PS×2 per Aran's
  // simplification (real impl could add a 1×→2× ramp on the first few replays).
  function emitL1Cluster(seedNums: number[], mainRoundNumber: number, cycleCounter: { v: number }): boolean {
    if (seedNums.length === 0) return false

    const plays: Array<{ sNum: number; seedData: SeedData }> = []
    for (const sNum of seedNums) {
      const seedData = seedMap.get(sNum)
      if (!seedData || !seedData.target1_audio_id) continue
      plays.push({ sNum, seedData })
    }
    if (plays.length === 0) return false

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
    for (const { sNum, seedData } of plays) {
      cycleCounter.v++
      emitItem({
        uuid: `listening_S${String(sNum).padStart(4, '0')}_2x_${cycleCounter.v}`,
        cycleNum: cycleCounter.v, roundNumber: mainRoundNumber,
        seedId: `S${String(sNum).padStart(4, '0')}`,
        legoKey: `S${String(sNum).padStart(4, '0')}L00`,
        seedCode: `S${String(sNum).padStart(4, '0')}`,
        legoCode: '00',
        type: 'listening',
        knownText: seedData.known_text,
        targetText: seedData.target_text_roman || seedData.target_text,
        ...nativeFields(seedData),
        knownAudioId: seedData.known_audio_id,
        target1Id: seedData.target1_audio_id,
        target2Id: seedData.target2_audio_id,
        isNew: false,
        playbackSpeed: 2.0,
        listeningSeedNumber: sNum,
      })
    }
    if (hasBookends && listenOutroAudio) {
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
      // Aran spec: only 1.0× and 2.0× exist for listening. PS and trans both
      // play at natural speed; PS×2 plays at 2×.
      const speed = playRole === 'ps2x' ? 2.0 : 1.0
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
  let phrasesSkippedForAudio = 0
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
          phrasesSkippedForAudio++
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
    console.warn(`[generateLearningScript] No LEGOs found for course "${courseCode}" seeds ${startSeed}-${endSeed}`)
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

  // Listening phase state
  const seedLastRound = new Map<number, number>()  // seedNum → last LEGO round
  const graduatedSeeds = new Set<number>()         // idempotency check
  const graduatedQueue: number[] = []              // graduation order; L1 windows are slices

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

  // Helper: only emit items from emitFromRound onward
  // Earlier rounds are still fully processed (legoState, spaced rep) but not emitted
  const shouldEmit = () => roundNumber >= emitFromRound
  const emitItem = (item: ScriptItem) => {
    if (!shouldEmit()) return
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

      // Phase 1: INTRO or COMPONENT PRIMING
      // M-LEGOs with components: introduce each component solo first (in target
      //   language order), then show the assembled M-LEGO so the learner sees
      //   the pieces snap together before the debut asks them to produce it.
      // A-LEGOs / Welsh: standard intro with presentation audio.
      const isWelsh = courseCode.startsWith('cym_')
      const compPhrases = isWelsh ? undefined : componentPhrasesByLego.get(phraseKey)
      if (compPhrases && compPhrases.length > 0) {
        const practiceReps = 2
        for (const comp of compPhrases) {
          // Component intro: presentation audio ("The X for 'word', as in 'phrase', is:") → target audio
          cycleNum++
          emitItem({
            uuid: `${legoKey}_cmp_intro_${cycleNum}`,
            cycleNum, roundNumber, seedId, legoKey,
            seedCode: seedId, legoCode: legoNum,
            type: 'component_intro',
            knownText: comp.known_text,
            targetText: comp.target_text_roman || comp.target_text,
            ...nativeFields(comp),
            presentationAudioId: comp.presentation_audio_id,
            target1Id: comp.target1_audio_id,
            target2Id: comp.target2_audio_id,
            target1DurationMs: comp.target1_duration_ms,
            target2DurationMs: comp.target2_duration_ms,
            isNew: true,
          })

          // Component practice: standard 4-phase cycle (tapered by seed)
          for (let cp = 0; cp < practiceReps; cp++) {
            cycleNum++
            emitItem({
              uuid: `${legoKey}_cmp_practice_${cycleNum}`,
              cycleNum, roundNumber, seedId, legoKey,
              seedCode: seedId, legoCode: legoNum,
              type: 'component_practice',
              knownText: comp.known_text,
              targetText: comp.target_text_roman || comp.target_text,
              ...nativeFields(comp),
              knownAudioId: comp.known_audio_id,
              target1Id: comp.target1_audio_id,
              target2Id: comp.target2_audio_id,
              target1DurationMs: comp.target1_duration_ms,
              target2DurationMs: comp.target2_duration_ms,
              isNew: true,
            })
          }
        }

        // M-LEGO intro: after all components are primed, show the assembled
        // M-LEGO tile with internal stubs so the learner sees how the pieces
        // they just learned snap together as a single unit.
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
      } else {
        // A-LEGO or Welsh: standard intro with presentation audio
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
      }

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
          syllableCount: phrase.target_syllable_count || countTargetSyllables(phrase.target_text)
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
          syllableCount: phrase.target_syllable_count || countTargetSyllables(phrase.target_text)
        })
      }

      // Initialize LEGO state
      legoState.set(legoKey, {
        lastRound: roundNumber,
        usePhrases: [...phrases.use],
        useIndex: 0,
        seedNum, legoIndex: lego.lego_index, lego
      })

      // Track seed's last LEGO round for listening graduation
      seedLastRound.set(seedNum, roundNumber)

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
            reviewOf: state.lastRound
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
          isNew: true
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
        for (const [sNum, lastRound] of seedLastRound) {
          if (graduatedSeeds.has(sNum)) continue
          if (roundNumber - lastRound < listeningConfig.offset) continue
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
          emitL1Cluster(seeds, roundNumber, listenCounter)
          cycleNum = listenCounter.v
        }
      }

      // Phase 7: Layer 2 (Pod 0) — fires every round at and after activation.
      if (l2FiresAt(roundNumber)) {
        const podCounter = { v: cycleNum }
        emitPodLap(roundNumber, podCounter)
        cycleNum = podCounter.v
      }
    }
  }

  // ==========================================================================
  // REVIVAL ROUNDS — infinite play after all new LEGOs are introduced
  // ==========================================================================
  //
  // The course never ends. Once the main loop has introduced every new LEGO
  // from the range, we keep incrementing roundNumber and pulling LEGOs from
  // the "retired" pool (those outside the fib-decay window, i.e. lastRound
  // older than MAX_FIB_OFFSET rounds ago) back into rotation.
  //
  // A revived LEGO's lastRound is updated to the current round, so it
  // re-enters the fib decay cycle naturally: spaced-rep in the following
  // rounds picks it up at N-1, N-2, N-3, ..., N-89, and it eventually
  // retires again. The schedule is self-sustaining — every LEGO the
  // learner has introduced keeps coming back.
  //
  // How many revival rounds we generate is driven by endSeed: the caller
  // effectively says "give me this many rounds of content." The player's
  // expansion logic bumps endSeed as the learner approaches the end, so
  // play is unbounded in practice.
  const MAX_FIB_OFFSET = SPACED_REP_OFFSETS[SPACED_REP_OFFSETS.length - 1]  // 89
  const REVIVE_PHRASES_PER_ROUND = 3
  let revivalShuffle: string[] = []

  const refillRevivalPool = () => {
    revivalShuffle = [...legoState.entries()]
      .filter(([, s]) => s.usePhrases.length > 0 && roundNumber - s.lastRound > MAX_FIB_OFFSET)
      .map(([key]) => key)
      .sort(() => Math.random() - 0.5)
  }

  while (roundNumber < endSeed) {
    roundNumber++

    // Pick a retired LEGO to revive. If the retired pool is empty (course
    // has fewer than ~90 LEGOs, or we just started revival), fall back to
    // the oldest-seen LEGO in legoState.
    if (revivalShuffle.length === 0) refillRevivalPool()
    if (revivalShuffle.length === 0) {
      // Fallback: pick the LEGO with the oldest lastRound that has USE phrases.
      const fallback = [...legoState.entries()]
        .filter(([, s]) => s.usePhrases.length > 0)
        .sort((a, b) => a[1].lastRound - b[1].lastRound)[0]
      if (!fallback) break  // no LEGOs at all — nothing to revive
      revivalShuffle.push(fallback[0])
    }

    const revivedKey = revivalShuffle.shift()!
    const revivedState = legoState.get(revivedKey)
    if (!revivedState || revivedState.usePhrases.length === 0) continue

    const revivedLegoNum = revivedKey.match(/L(\d+)/)?.[1] || ''
    const revivedSeedId = revivedKey.match(/S\d+/)?.[0] || ''
    let cycleNum = 0

    // Revival phase: emit a few USE phrases for the revived LEGO. Treat
    // this as the "featured" slot of the round — similar shape to what
    // a normal consolidate phase emits, but for a revived LEGO.
    if (shouldEmit()) {
      const phrasesToEmit = Math.min(REVIVE_PHRASES_PER_ROUND, revivedState.usePhrases.length)
      for (let p = 0; p < phrasesToEmit; p++) {
        const phrase = revivedState.usePhrases[revivedState.useIndex % revivedState.usePhrases.length]
        revivedState.useIndex++
        if (!phrase.known_audio_id || !phrase.target1_audio_id || !phrase.target2_audio_id) continue
        cycleNum++
        emitItem({
          uuid: `${revivedKey}_revive_R${roundNumber}_${cycleNum}`,
          cycleNum, roundNumber, seedId: revivedSeedId, legoKey: revivedKey,
          seedCode: revivedSeedId, legoCode: revivedLegoNum,
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

    // Spaced-rep phase — same logic as the main loop. Pulls LEGOs that
    // fall on N-1, N-2, ..., N-89 offsets. After several revival rounds
    // this includes previously-revived LEGOs, so the fib cycle carries
    // the rotation forward automatically.
    const revivalDueForReview: { key: string; state: LegoState; fibPosition: number; phraseCount: number }[] = []
    const revivalSeenLegos = new Set<string>()
    for (let offsetIdx = 0; offsetIdx < SPACED_REP_OFFSETS.length; offsetIdx++) {
      const offset = SPACED_REP_OFFSETS[offsetIdx]
      const reviewRound = roundNumber - offset
      if (reviewRound < 1) break
      for (const [prevKey, state] of legoState.entries()) {
        if (prevKey === revivedKey || revivalSeenLegos.has(prevKey)) continue
        if (graduatedSeeds.has(state.seedNum)) continue
        if (state.lastRound === reviewRound) {
          const isN1 = offset === 1
          const phraseCount = isN1 ? N1_PHRASE_COUNT : 1
          revivalDueForReview.push({ key: prevKey, state, fibPosition: offsetIdx, phraseCount })
          revivalSeenLegos.add(prevKey)
        }
      }
    }

    if (shouldEmit()) {
      let spacedRepCount = 0
      for (const { key: reviewKey, state, fibPosition, phraseCount } of revivalDueForReview) {
        if (spacedRepCount >= MAX_SPACED_REP_PHRASES) break
        if (state.usePhrases.length === 0) continue

        const reviewLegoNum = reviewKey.match(/L(\d+)/)?.[1] || ''
        const reviewSeedId = reviewKey.match(/S\d+/)?.[0] || ''

        const phrasesToUse = Math.min(phraseCount, MAX_SPACED_REP_PHRASES - spacedRepCount, state.usePhrases.length)
        for (let i = 0; i < phrasesToUse; i++) {
          const phrase = state.usePhrases[state.useIndex % state.usePhrases.length]
          state.useIndex++
          if (!phrase.known_audio_id || !phrase.target1_audio_id || !phrase.target2_audio_id) continue
          cycleNum++
          spacedRepCount++
          emitItem({
            uuid: `${reviewKey}_revive_sr_R${roundNumber}_${cycleNum}`,
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
          })
        }
      }
    }

    // Mark the revived LEGO as freshly used so it re-enters the fib cycle.
    revivedState.lastRound = roundNumber

    // Phase 6+7 (revival): listening continues forever. L1 active-10 every 3
    // rounds + reserve every 13 rounds keeps graduated seeds in rotation. L2
    // pod lap holds Stage 7 (eternal 2× holding bay) as steady state every
    // round.
    if (shouldEmit()) {
      const fireActive = l1ActiveFiresAt(roundNumber)
      const fireReserve = l1ReserveFiresAt(roundNumber)
      if (fireActive || fireReserve) {
        const seeds: number[] = []
        if (fireReserve) seeds.push(...l1ReserveSeedsList())
        if (fireActive) seeds.push(...l1ActiveSeedsList())
        const listenCounter = { v: cycleNum }
        emitL1Cluster(seeds, roundNumber, listenCounter)
        cycleNum = listenCounter.v
      }
      if (l2FiresAt(roundNumber)) {
        const podCounter = { v: cycleNum }
        emitPodLap(roundNumber, podCounter)
        cycleNum = podCounter.v
      }
    }
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
  const incompleteByAudio = new Set([...roundMissingAudio].filter(r => !roundHasAudio.has(r)))
  let droppedByText = 0
  const playableItems = dedupedItems.filter(item => {
    if (incompleteByAudio.has(item.roundNumber)) return false
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
  if (import.meta.env.DEV) {
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
  const skippedRounds = emitFromRound > 1 ? emitFromRound - 1 : 0
  const listeningItemCount = playableItems.filter(i => i.type === 'listening').length
  const listeningStats = listeningConfig.enabled && graduatedSeeds.size > 0
    ? `, ${graduatedSeeds.size} seeds graduated, ${listeningItemCount} listening items`
    : ''
  console.debug(`[generateLearningScript] ${playableItems.length} items, ${playableRoundCount} rounds for ${courseCode} S${startSeed}-${endSeed}${removedCount > 0 ? `, ${removedCount} deduped` : ''}${incompleteByAudio.size > 0 ? `, ${incompleteByAudio.size} no-audio rounds` : ''}${droppedByText > 0 ? `, ${droppedByText} bad-text cycles` : ''}${skippedRounds > 0 ? `, from R${emitFromRound}` : ''}${listeningStats}`)
  return { items: playableItems, cycleCount: playableItems.length, roundCount: playableRoundCount, hasRomanizedText: courseHasRomanized }
}
