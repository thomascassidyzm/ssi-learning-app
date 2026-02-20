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
  type: 'intro' | 'debut' | 'build' | 'spaced_rep' | 'use'
  knownText: string
  targetText: string
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
}

export interface LearningScriptResult {
  items: ScriptItem[]
  cycleCount: number
  roundCount: number
}

export async function generateLearningScript(
  supabase: SupabaseClient,
  courseCode: string,
  startSeed: number,
  endSeed: number,
  emitFromRound: number = 1  // Only emit ScriptItems from this round onward
): Promise<LearningScriptResult> {
  // Constants
  const SPACED_REP_OFFSETS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
  const MAX_BUILD_PHRASES = 7
  const USE_CONSOLIDATION_COUNT = 2
  const MAX_SPACED_REP_PHRASES = 12
  const N1_PHRASE_COUNT = 3

  const normalizeText = (text: string | null | undefined): string => {
    if (!text) return ''
    return text.toLowerCase().trim().replace(/[.,!?;:¡¿'"]+/g, '')
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
  const [legosResult, phrasesResult] = await Promise.all([
    supabase
      .from('course_legos')
      .select('seed_number, lego_index, known_text, target_text, type, is_new, known_audio_id, target1_audio_id, target2_audio_id, presentation_audio_id, target1_duration_ms, target2_duration_ms')
      .eq('course_code', courseCode)
      .gte('seed_number', startSeed)
      .lte('seed_number', endSeed)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true }),
    supabase
      .from('course_practice_phrases')
      .select('seed_number, lego_index, known_text, target_text, phrase_role, target_syllable_count, position, known_audio_id, target1_audio_id, target2_audio_id, target1_duration_ms, target2_duration_ms')
      .eq('course_code', courseCode)
      .gte('seed_number', startSeed)
      .lte('seed_number', endSeed)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .order('position', { ascending: true })
  ])

  if (legosResult.error) throw new Error('Failed to query LEGOs: ' + legosResult.error.message)
  if (phrasesResult.error) throw new Error('Failed to query phrases: ' + phrasesResult.error.message)

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
  for (const phrase of (phrasesResult.data || []) as Phrase[]) {
    const key = `${phrase.seed_number}:${phrase.lego_index}`
    if (!phrasesByLego.has(key)) phrasesByLego.set(key, { build: [], use: [], practice: [] })
    const group = phrasesByLego.get(key)!
    if (phrase.phrase_role === 'component') continue
    if (phrase.phrase_role === 'build') group.build.push(phrase)
    else if (phrase.phrase_role === 'use') group.use.push(phrase)
    else if (phrase.phrase_role === 'practice') group.practice.push(phrase)
  }

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

  // Build LEGO text map for phrase decomposition (normalised target text → LEGO key)
  // Uses ALL LEGOs (not just is_new) since reused LEGOs are still valid vocabulary
  const legoTextMap = new Map<string, string>()
  for (const lego of allLegos) {
    const legoKey = `S${String(lego.seed_number).padStart(4, '0')}L${String(lego.lego_index).padStart(2, '0')}`
    const normalized = normalizeText(lego.target_text)
    if (normalized) legoTextMap.set(normalized, legoKey)
  }

  // Greedy longest-match decomposition of a phrase into component LEGO IDs
  // Supports both space-separated languages and CJK (no spaces)
  const cjkRegex = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/
  const isCJK = (text: string) => cjkRegex.test(text)

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
    } else {
      // Non-intro items need all three audio IDs to be useful
      if (!item.knownAudioId || !item.target1Id || !item.target2Id) return
    }
    items.push(item)
  }

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
        targetText: lego.target_text,
        presentationAudioId,
        knownAudioId: introAudioId,  // Presentation audio, or known audio as fallback
        target1Id: isWelsh ? undefined : lego.target1_audio_id,
        target2Id: isWelsh ? undefined : lego.target2_audio_id,
        target1DurationMs: isWelsh ? undefined : lego.target1_duration_ms,
        target2DurationMs: isWelsh ? undefined : lego.target2_duration_ms,
        isNew: true
      })

      // Phase 2: DEBUT
      cycleNum++
      emitItem({
        uuid: `${legoKey}_debut_${cycleNum}`,
        cycleNum, roundNumber, seedId, legoKey,
        seedCode: seedId, legoCode: legoNum,
        type: 'debut',
        knownText: lego.known_text,
        targetText: lego.target_text,
        knownAudioId: lego.known_audio_id,
        target1Id: lego.target1_audio_id,
        target2Id: lego.target2_audio_id,
        target1DurationMs: lego.target1_duration_ms,
        target2DurationMs: lego.target2_duration_ms,
        isNew: true
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
          targetText: phrase.target_text,
          knownAudioId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          target1DurationMs: phrase.target1_duration_ms,
          target2DurationMs: phrase.target2_duration_ms,
          isNew: true,
          syllableCount: phrase.target_syllable_count || countTargetSyllables(phrase.target_text)
        })
      }

      // Reserve USE phrases for consolidation BEFORE using them for BUILD padding
      // This prevents BUILD from consuming all USE phrases, leaving nothing for CONSOLIDATE
      const sortedUsePhrases = [...phrases.use].sort((a, b) =>
        (a.target_syllable_count || countTargetSyllables(a.target_text)) -
        (b.target_syllable_count || countTargetSyllables(b.target_text))
      )
      const reservedForConsolidation = new Set<string>()
      let reservedCount = 0
      for (const phrase of sortedUsePhrases) {
        if (reservedCount >= USE_CONSOLIDATION_COUNT) break
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        if (usedPhrasesThisRound.has(phraseId)) continue
        reservedForConsolidation.add(phraseId)
        reservedCount++
      }

      // Fill remaining practice slots with USE phrases (excluding reserved ones)
      for (const phrase of sortedUsePhrases) {
        if (practiceCount >= MAX_BUILD_PHRASES) break
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        if (usedPhrasesThisRound.has(phraseId)) continue
        if (reservedForConsolidation.has(phraseId)) continue

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
          targetText: phrase.target_text,
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

      // Phase 4: SPACED REP
      const dueForReview: { key: string; state: LegoState; fibPosition: number; phraseCount: number }[] = []
      const seenLegos = new Set<string>()

      for (let offsetIdx = 0; offsetIdx < SPACED_REP_OFFSETS.length; offsetIdx++) {
        const offset = SPACED_REP_OFFSETS[offsetIdx]
        const reviewRound = roundNumber - offset
        if (reviewRound < 1) break

        for (const [prevKey, state] of legoState.entries()) {
          if (prevKey === legoKey || seenLegos.has(prevKey)) continue
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
            targetText: phrase.target_text,
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

      // Phase 5: CONSOLIDATE ×2 - use the reserved phrases
      let consolidateCount = 0
      for (const phrase of sortedUsePhrases) {
        if (consolidateCount >= USE_CONSOLIDATION_COUNT) break
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        if (!reservedForConsolidation.has(phraseId)) continue
        if (usedPhrasesThisRound.has(phraseId)) continue
        consolidateCount++
        usedPhrasesThisRound.add(phraseId)

        cycleNum++
        emitItem({
          uuid: `${legoKey}_use_${cycleNum}`,
          cycleNum, roundNumber, seedId, legoKey,
          seedCode: seedId, legoCode: legoNum,
          type: 'use',
          knownText: phrase.known_text,
          targetText: phrase.target_text,
          knownAudioId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          target1DurationMs: phrase.target1_duration_ms,
          target2DurationMs: phrase.target2_duration_ms,
          isNew: true
        })
      }
    }
  }

  // Decompose phrases into component LEGO IDs
  let decomposedCount = 0
  for (const item of items) {
    if (item.type === 'intro' || item.type === 'debut') continue
    const components = decomposePhrase(item.targetText)
    if (components.length > 0) {
      item.componentLegoIds = components
      decomposedCount++
    }
  }
  console.debug(`[generateLearningScript] Decomposed ${decomposedCount}/${items.filter(i => i.type !== 'intro' && i.type !== 'debut').length} phrases into LEGO components (${legoTextMap.size} LEGOs in map)`)

  // Remove consecutive duplicates (matching dashboard logic)
  const dedupedItems: ScriptItem[] = []
  let lastNonIntroItem: ScriptItem | null = null

  for (const item of items) {
    if (item.type === 'intro') {
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
  console.debug(`[generateLearningScript] ${dedupedItems.length} items, ${roundNumber} rounds for ${courseCode} S${startSeed}-${endSeed}${removedCount > 0 ? `, ${removedCount} deduped` : ''}${skippedRounds > 0 ? `, from R${emitFromRound}` : ''}`)
  return { items: dedupedItems, cycleCount: dedupedItems.length, roundCount: roundNumber }
}
