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
  sourceId?: string
  target1Id?: string
  target2Id?: string
  hasAudio: boolean
  isNew: boolean
  syllableCount?: number
  fibPosition?: number
  reviewOf?: number
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

  // Query all data in parallel - audio IDs now directly on tables
  const [legosResult, phrasesResult, introsResult] = await Promise.all([
    supabase
      .from('course_legos')
      .select('seed_number, lego_index, known_text, target_text, type, is_new, known_audio_id, target1_audio_id, target2_audio_id')
      .eq('course_code', courseCode)
      .gte('seed_number', startSeed)
      .lte('seed_number', endSeed)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true }),
    supabase
      .from('course_practice_phrases')
      .select('seed_number, lego_index, known_text, target_text, phrase_role, target_syllable_count, position, known_audio_id, target1_audio_id, target2_audio_id')
      .eq('course_code', courseCode)
      .gte('seed_number', startSeed)
      .lte('seed_number', endSeed)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .order('position', { ascending: true }),
    supabase
      .from('lego_introductions')
      .select('lego_id, audio_uuid, presentation_audio_id')
      .eq('course_code', courseCode)
  ])

  if (legosResult.error) throw new Error('Failed to query LEGOs: ' + legosResult.error.message)
  if (phrasesResult.error) throw new Error('Failed to query phrases: ' + phrasesResult.error.message)

  // Build intro audio map - prefer presentation_audio_id (v13), fall back to audio_uuid (legacy)
  const introAudioMap = new Map<string, string>()
  for (const intro of (introsResult.data || [])) {
    const audioId = intro.presentation_audio_id || intro.audio_uuid
    if (intro.lego_id && audioId) {
      introAudioMap.set(intro.lego_id, audioId)
    }
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
  }
  const phrasesByLego = new Map<string, { build: Phrase[]; use: Phrase[] }>()
  for (const phrase of (phrasesResult.data || []) as Phrase[]) {
    const key = `${phrase.seed_number}:${phrase.lego_index}`
    if (!phrasesByLego.has(key)) phrasesByLego.set(key, { build: [], use: [] })
    const group = phrasesByLego.get(key)!
    if (phrase.phrase_role === 'component') continue
    if (phrase.phrase_role === 'build') group.build.push(phrase)
    else if (phrase.phrase_role === 'use') group.use.push(phrase)
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
  }
  const legosBySeed = new Map<number, Lego[]>()
  for (const lego of (legosResult.data || []) as Lego[]) {
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

  // Helper: only emit items from emitFromRound onward
  // Earlier rounds are still fully processed (legoState, spaced rep) but not emitted
  const shouldEmit = () => roundNumber >= emitFromRound
  const emitItem = (item: ScriptItem) => { if (shouldEmit()) items.push(item) }

  // Process each seed
  for (const seedNum of sortedSeedNums) {
    const seedLegos = legosBySeed.get(seedNum)!.sort((a, b) => a.lego_index - b.lego_index)

    for (const lego of seedLegos) {
      roundNumber++
      const legoKey = `S${String(seedNum).padStart(4, '0')}L${String(lego.lego_index).padStart(2, '0')}`
      const seedId = `S${String(seedNum).padStart(4, '0')}`
      const legoNum = String(lego.lego_index).padStart(2, '0')
      const phraseKey = `${seedNum}:${lego.lego_index}`
      const phrases = phrasesByLego.get(phraseKey) || { build: [], use: [] }
      const presentationAudioId = introAudioMap.get(legoKey)

      const usedPhrasesThisRound = new Set<string>()

      // Phase 1: INTRO
      cycleNum++
      emitItem({
        uuid: `${legoKey}_intro_${cycleNum}`,
        cycleNum, roundNumber, seedId, legoKey,
        seedCode: seedId, legoCode: legoNum,
        type: 'intro',
        knownText: lego.known_text,
        targetText: lego.target_text,
        presentationAudioId,
        hasAudio: !!presentationAudioId,
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
        sourceId: lego.known_audio_id,
        target1Id: lego.target1_audio_id,
        target2Id: lego.target2_audio_id,
        hasAudio: !!(lego.known_audio_id && lego.target1_audio_id),
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
          sourceId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          hasAudio: !!(phrase.known_audio_id && phrase.target1_audio_id),
          isNew: true,
          syllableCount: phrase.target_syllable_count || countTargetSyllables(phrase.target_text)
        })
      }

      // Fill remaining practice slots with USE phrases
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
          targetText: phrase.target_text,
          sourceId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          hasAudio: !!(phrase.known_audio_id && phrase.target1_audio_id),
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
            sourceId: phrase.known_audio_id,
            target1Id: phrase.target1_audio_id,
            target2Id: phrase.target2_audio_id,
            hasAudio: !!(phrase.known_audio_id && phrase.target1_audio_id),
            isNew: false,
            fibPosition,
            reviewOf: state.lastRound
          })
        }
      }

      // Phase 5: CONSOLIDATE ×2
      let consolidateCount = 0
      for (const phrase of phrases.use) {
        if (consolidateCount >= USE_CONSOLIDATION_COUNT) break
        const phraseId = getPhraseId(phrase.known_text, phrase.target_text)
        if (usedPhrasesThisRound.has(phraseId)) continue
        if (usedForPractice.has(phraseId)) continue
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
          sourceId: phrase.known_audio_id,
          target1Id: phrase.target1_audio_id,
          target2Id: phrase.target2_audio_id,
          hasAudio: !!(phrase.known_audio_id && phrase.target1_audio_id),
          isNew: true
        })
      }
    }
  }

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
  if (removedCount > 0) {
    console.log(`[generateLearningScript] Removed ${removedCount} consecutive duplicate(s)`)
  }

  const skippedRounds = emitFromRound > 1 ? emitFromRound - 1 : 0
  console.log(`[generateLearningScript] Generated ${dedupedItems.length} items for ${courseCode} seeds ${startSeed}-${endSeed}${skippedRounds > 0 ? ` (emitting from round ${emitFromRound}, ${skippedRounds} rounds processed silently)` : ''}`)
  return { items: dedupedItems, cycleCount: dedupedItems.length, roundCount: roundNumber }
}
