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
  type: 'intro' | 'debut' | 'build' | 'spaced_rep' | 'use' | 'listening' | 'component_intro' | 'component_practice'
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
  const [legosResult, phrasesResult, seedsResult] = await Promise.all([
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
      .select('seed_number, lego_index, known_text, target_text, target_text_roman, phrase_role, target_syllable_count, position, known_audio_id, target1_audio_id, target2_audio_id, target1_duration_ms, target2_duration_ms')
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
      : Promise.resolve({ data: [], error: null })
  ])

  if (legosResult.error) throw new Error('Failed to query LEGOs: ' + legosResult.error.message)
  if (phrasesResult.error) throw new Error('Failed to query phrases: ' + phrasesResult.error.message)
  if (seedsResult.error) throw new Error('Failed to query seeds for listening: ' + seedsResult.error.message)

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
    target1_duration_ms?: number
    target2_duration_ms?: number
  }
  const phrasesByLego = new Map<string, { build: Phrase[]; use: Phrase[]; practice: Phrase[] }>()
  // Collect M-LEGO component breakdowns: legoKey → [{known, target}, ...]
  const componentsByLego = new Map<string, Array<{ known: string; target: string }>>()
  const componentsByLegoNative = new Map<string, Array<{ known: string; target: string }>>()
  // Full component phrases with audio IDs for component priming
  const componentPhrasesByLego = new Map<string, Phrase[]>()
  for (const phrase of (phrasesResult.data || []) as Phrase[]) {
    const key = `${phrase.seed_number}:${phrase.lego_index}`
    if (!phrasesByLego.has(key)) phrasesByLego.set(key, { build: [], use: [], practice: [] })
    const group = phrasesByLego.get(key)!
    if (phrase.phrase_role === 'component') {
      if (!componentsByLego.has(key)) componentsByLego.set(key, [])
      componentsByLego.get(key)!.push({ known: phrase.known_text, target: phrase.target_text_roman || phrase.target_text })
      // Store native script variant when romanized exists
      if (phrase.target_text_roman) {
        if (!componentsByLegoNative.has(key)) componentsByLegoNative.set(key, [])
        componentsByLegoNative.get(key)!.push({ known: phrase.known_text, target: phrase.target_text })
      }
      // Also store full phrase with audio IDs for component priming
      if (!componentPhrasesByLego.has(key)) componentPhrasesByLego.set(key, [])
      componentPhrasesByLego.get(key)!.push(phrase)
      continue
    }
    if (phrase.phrase_role === 'build') group.build.push(phrase)
    else if (phrase.phrase_role === 'use') group.use.push(phrase)
    else if (phrase.phrase_role === 'practice') group.practice.push(phrase)
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
  const allLegos = (legosResult.data || []) as Lego[]

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

  // Diagnostic: warn if no LEGOs found or all missing audio
  if (allLegos.length === 0) {
    console.warn(`[generateLearningScript] No LEGOs found for course "${courseCode}" seeds ${startSeed}-${endSeed}`)
  } else {
    const missingAudio = allLegos.filter(l => !l.known_audio_id || !l.target1_audio_id || !l.target2_audio_id)
    if (missingAudio.length === allLegos.length) {
      console.warn(`[generateLearningScript] ALL ${allLegos.length} LEGOs for "${courseCode}" are missing audio IDs — course will not play`)
    } else if (missingAudio.length > 0) {
      console.warn(`[generateLearningScript] ${missingAudio.length}/${allLegos.length} LEGOs for "${courseCode}" missing audio IDs`)
    }
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

  // Helper: only emit items from emitFromRound onward
  // Earlier rounds are still fully processed (legoState, spaced rep) but not emitted
  const shouldEmit = () => roundNumber >= emitFromRound
  const emitItem = (item: ScriptItem) => {
    if (!shouldEmit()) return
    if (item.type === 'intro') {
      // Intros ALWAYS pass — they define the round structure.
      // Missing presentation audio is handled by SimplePlayer (skips empty prompt phase).
      // Target voice1/voice2 still play to introduce the LEGO pronunciation.
      if (!item.knownAudioId) {
        console.warn(`[generateLearningScript] Intro for ${item.legoKey} missing presentation audio — will play target audio only`)
      }
    } else if (item.type === 'listening') {
      // Listening items only need target audio (passive listening, no known prompt)
      if (!item.target1Id) return
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

      // Phase 1: INTRO - presentation audio introduces the new LEGO
      // Welsh courses (cym_*): presentation audio already contains the target
      //   pronunciation, so we play presentation only (no target1/target2).
      // All other courses: presentation is just the prompt ("The German for X is..."),
      //   followed by target1/target2. If presentation is missing, falls back to
      //   known audio — effectively playing the LEGO twice (once passive, once active).
      const isWelsh = courseCode.startsWith('cym_')
      cycleNum++
      emitItem({
        uuid: `${legoKey}_intro_${cycleNum}`,
        cycleNum, roundNumber, seedId, legoKey,
        seedCode: seedId, legoCode: legoNum,
        type: 'intro',
        knownText: lego.known_text,
        targetText: lego.target_text_roman || lego.target_text,
        ...nativeFields(lego),
        presentationAudioId,
        knownAudioId: introAudioId,  // Presentation audio, or known audio as fallback
        target1Id: isWelsh ? undefined : lego.target1_audio_id,
        target2Id: isWelsh ? undefined : lego.target2_audio_id,
        target1DurationMs: isWelsh ? undefined : lego.target1_duration_ms,
        target2DurationMs: isWelsh ? undefined : lego.target2_duration_ms,
        isNew: true,
        ...(legoComponents ? { components: legoComponents } : {}),
        ...(legoComponentsNative ? { componentsNative: legoComponentsNative } : {}),
      })

      // Phase 1b: COMPONENT PRIMING (M-LEGOs only)
      // For each component phrase, emit a component_intro + 2× component_practice
      const compPhrases = componentPhrasesByLego.get(phraseKey)
      if (compPhrases && compPhrases.length > 0) {
        for (const comp of compPhrases) {
          // Component intro: contextual display, target audio as confirmation, no pause
          cycleNum++
          emitItem({
            uuid: `${legoKey}_cmp_intro_${cycleNum}`,
            cycleNum, roundNumber, seedId, legoKey,
            seedCode: seedId, legoCode: legoNum,
            type: 'component_intro',
            knownText: `${comp.known_text}, as in ${lego.known_text}`,
            targetText: comp.target_text_roman || comp.target_text,
            ...nativeFields(comp),
            target1Id: comp.target1_audio_id,
            target2Id: comp.target2_audio_id,
            target1DurationMs: comp.target1_duration_ms,
            target2DurationMs: comp.target2_duration_ms,
            isNew: true,
          })

          // Component practice ×2: standard 4-phase cycle
          for (let cp = 0; cp < 2; cp++) {
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

          // Emit listening items for every seed in this batch
          if (batch) {
            for (const [sNum, entry] of batch) {
              const seedData = seedMap.get(sNum)
              if (!seedData || !seedData.target1_audio_id) continue  // Skip seeds without audio

              const speeds = getSpeedsForPlayCount(entry.playCount, listeningConfig)
              for (const speed of speeds) {
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
              }
              entry.playCount++
            }
          }
        }
      }
    }
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
    if (item.type === 'intro' || item.type === 'listening' || item.type === 'component_intro') {
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

  // Validate generated script integrity
  const validationReport = validateLearningScript(dedupedItems)
  if (!validationReport.valid) {
    console.error(`[generateLearningScript] VALIDATION FAILED: ${validationReport.summary}`)
    // Log first 5 round errors only
    let errorCount = 0
    for (const round of validationReport.rounds) {
      if (!round.valid && errorCount < 5) {
        console.error(`  [Round ${round.roundNumber}] ${round.errors[0]?.message}`)
        errorCount++
      }
    }
    if (errorCount < validationReport.rounds.filter(r => !r.valid).length) {
      console.error(`  ... and ${validationReport.rounds.filter(r => !r.valid).length - errorCount} more rounds with errors`)
    }
  }

  const skippedRounds = emitFromRound > 1 ? emitFromRound - 1 : 0
  const listeningItemCount = dedupedItems.filter(i => i.type === 'listening').length
  const listeningStats = listeningConfig.enabled && graduatedSeeds.size > 0
    ? `, ${graduatedSeeds.size} seeds graduated, ${listeningItemCount} listening items`
    : ''
  console.debug(`[generateLearningScript] ${dedupedItems.length} items, ${roundNumber} rounds for ${courseCode} S${startSeed}-${endSeed}${removedCount > 0 ? `, ${removedCount} deduped` : ''}${skippedRounds > 0 ? `, from R${emitFromRound}` : ''}${listeningStats}`)
  return { items: dedupedItems, cycleCount: dedupedItems.length, roundCount: roundNumber, hasRomanizedText: courseHasRomanized }
}
