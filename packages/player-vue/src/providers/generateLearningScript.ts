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
  type: 'intro' | 'debut' | 'build' | 'spaced_rep' | 'use' | 'listening' | 'component_intro' | 'component_practice' | 'listen_intro' | 'listen_outro'
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

export interface ListeningConfig {
  enabled: boolean
  offset: number                    // rounds after last LEGO before seed graduates
  totalSeeds: number                // total seeds entering listening across all batches
  batchSize: number                 // seeds per batch
  batchCount: number                // number of batches
  speedProgression: Array<{
    plays: number                   // times at this stage (Infinity for final)
    speeds: number[]                // e.g. [1.0], [1.0, 2.0], [2.0, 2.0], [2.0]
  }>
}

export const DEFAULT_LISTENING_CONFIG: ListeningConfig = {
  enabled: true,
  offset: 56,
  totalSeeds: 80,
  batchSize: 20,
  batchCount: 4,
  speedProgression: [
    { plays: 3, speeds: [1.0] },
    { plays: 3, speeds: [1.0, 2.0] },
    { plays: 3, speeds: [2.0, 2.0] },
    { plays: Infinity, speeds: [2.0] },
  ],
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
  const [legosResult, phrasesResult, seedsResult, bookendsResult] = await Promise.all([
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
    // Fetch seed sentences for listening phase (whole-sentence replay after graduation)
    listeningConfig.enabled
      ? supabase
          .from('course_seeds')
          .select('seed_number, known_text, target_text, target_text_roman, known_audio_id, target1_audio_id, target2_audio_id')
          .eq('course_code', courseCode)
          .gte('seed_number', startSeed)
          .lte('seed_number', Math.min(endSeed, startSeed + listeningConfig.totalSeeds - 1))
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
      : Promise.resolve({ data: [], error: null })
  ])

  if (legosResult.error) throw new Error('Failed to query LEGOs: ' + legosResult.error.message)
  if (phrasesResult.error) throw new Error('Failed to query phrases: ' + phrasesResult.error.message)
  if (seedsResult.error) throw new Error('Failed to query seeds for listening: ' + seedsResult.error.message)
  if (bookendsResult.error) throw new Error('Failed to query listen bookends: ' + bookendsResult.error.message)

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
  const seedLastRound = new Map<number, number>()       // seedNum → last LEGO round
  const graduatedSeeds = new Set<number>()               // seeds that have left Fibonacci
  const batches: Map<number, { playCount: number }>[] = [] // batches[0]=B1, etc.
  let nextBatchRotation = 0                              // round-robin index

  // Helper: get speed(s) for a given play count from the speed progression config
  const getSpeedsForPlayCount = (playCount: number, config: ListeningConfig): number[] => {
    let cumulative = 0
    for (const stage of config.speedProgression) {
      cumulative += stage.plays
      if (playCount < cumulative) return stage.speeds
    }
    // Past all stages — use the last one (which should have plays: Infinity)
    return config.speedProgression[config.speedProgression.length - 1].speeds
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

      // Phase 6: LISTENING — check for seed graduations and emit listening items
      if (listeningConfig.enabled) {
        let newGraduateThisRound = false

        // Check ALL seeds for graduation (not just current seed)
        for (const [sNum, lastRound] of seedLastRound) {
          if (graduatedSeeds.has(sNum)) continue
          if (roundNumber - lastRound < listeningConfig.offset) continue
          if (sNum > startSeed + listeningConfig.totalSeeds - 1) continue  // Cap at totalSeeds

          graduatedSeeds.add(sNum)
          // Assign to correct batch: S1-20 → B0, S21-40 → B1, etc.
          const batchIndex = Math.floor((sNum - startSeed) / listeningConfig.batchSize)
          if (batchIndex >= listeningConfig.batchCount) continue
          if (!batches[batchIndex]) batches[batchIndex] = new Map()
          batches[batchIndex].set(sNum, { playCount: 0 })
          newGraduateThisRound = true
        }

        // Trigger listening if any seed graduated this round
        if (newGraduateThisRound && batches.length > 0) {
          // During B1-only build-up: always play B1
          // Once B2+ exists: rotate through active batches
          const activeBatches = batches.filter(b => b && b.size > 0)
          const batchToPlay = activeBatches.length === 1
            ? 0  // Only B1 exists, always play it
            : nextBatchRotation % activeBatches.length

          const batch = activeBatches[batchToPlay]
          if (activeBatches.length > 1) nextBatchRotation++

          // Emit listening items for every seed in this batch, wrapped with
          // known-language bookends so learners get a verbal cue when the
          // mode switches from prompt/response into passive listening and
          // back. Bookends only emit if BOTH intro+outro audio rows exist
          // for this course (run scripts/generate-listen-bookends.cjs in
          // the dashboard repo to populate them).
          if (batch) {
            // Collect listening items first so we can decide whether the
            // batch produced any playable cycles before emitting bookends.
            const listeningEmissions: Array<() => void> = []
            for (const [sNum, entry] of batch) {
              const seedData = seedMap.get(sNum)
              if (!seedData || !seedData.target1_audio_id) continue  // Skip seeds without audio

              const speeds = getSpeedsForPlayCount(entry.playCount, listeningConfig)
              for (const speed of speeds) {
                listeningEmissions.push(() => {
                  cycleNum++
                  emitItem({
                    uuid: `listening_S${String(sNum).padStart(4, '0')}_${speed}x_${cycleNum}`,
                    cycleNum, roundNumber,
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
                    playbackSpeed: speed,
                    listeningSeedNumber: sNum,
                  })
                })
              }
              entry.playCount++
            }

            if (listeningEmissions.length > 0) {
              if (hasBookends && listenIntroAudio) {
                cycleNum++
                emitItem({
                  uuid: `listen_intro_R${String(roundNumber).padStart(4, '0')}_${cycleNum}`,
                  cycleNum, roundNumber,
                  seedId: '', legoKey: '', seedCode: '', legoCode: '',
                  type: 'listen_intro',
                  knownText: listenIntroAudio.text,
                  targetText: '',
                  knownAudioId: listenIntroAudio.id,
                  isNew: false,
                })
              }
              for (const emit of listeningEmissions) emit()
              if (hasBookends && listenOutroAudio) {
                cycleNum++
                emitItem({
                  uuid: `listen_outro_R${String(roundNumber).padStart(4, '0')}_${cycleNum}`,
                  cycleNum, roundNumber,
                  seedId: '', legoKey: '', seedCode: '', legoCode: '',
                  type: 'listen_outro',
                  knownText: listenOutroAudio.text,
                  targetText: '',
                  knownAudioId: listenOutroAudio.id,
                  isNew: false,
                })
              }
            }
          }
        }
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
  }

  // Decompose phrases into component LEGO IDs
  let decomposedCount = 0
  for (const item of items) {
    if (item.type === 'intro' || item.type === 'debut' || item.type === 'listening' || item.type === 'component_intro' || item.type === 'component_practice') continue
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
    if (item.type === 'intro' || item.type === 'debut' || item.type === 'listening' || item.type === 'component_intro') {
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
  // Remove items from rounds that have no audio at all (unbuilt seeds)
  const incompleteRounds = new Set([...roundMissingAudio].filter(r => !roundHasAudio.has(r)))
  const playableItems = incompleteRounds.size > 0
    ? dedupedItems.filter(i => !incompleteRounds.has(i.roundNumber))
    : dedupedItems

  if (incompleteRounds.size > 0) {
    console.info(`[generateLearningScript] Filtered out ${incompleteRounds.size} incomplete rounds (no audio yet)`)
  }

  // Validate generated script integrity (only playable items)
  const validationReport = validateLearningScript(playableItems)
  if (!validationReport.valid) {
    console.warn(`[generateLearningScript] Validation: ${validationReport.summary}`)
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
  console.debug(`[generateLearningScript] ${playableItems.length} items, ${playableRoundCount} rounds for ${courseCode} S${startSeed}-${endSeed}${removedCount > 0 ? `, ${removedCount} deduped` : ''}${incompleteRounds.size > 0 ? `, ${incompleteRounds.size} incomplete filtered` : ''}${skippedRounds > 0 ? `, from R${emitFromRound}` : ''}${listeningStats}`)
  return { items: playableItems, cycleCount: playableItems.length, roundCount: playableRoundCount, hasRomanizedText: courseHasRomanized }
}
