/**
 * useLegoNetwork - Load real LEGO network data from database
 *
 * Loads LEGOs and phrases for a course, decomposes phrases into LEGOs,
 * and builds a directional connection graph based on co-occurrence.
 */

import { ref, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LegoNode {
  id: string
  seedId: string
  legoIndex: number
  knownText: string
  targetText: string
  durationMs: number // Audio duration - proxy for syllable count
  totalPractices: number
  usedInPhrases: number
  mastery: number
  isEternal: boolean
  birthBelt?: string
  x?: number
  y?: number
  isComponent?: boolean // True if this is a component extracted from an M-type LEGO
  parentLegoIds?: string[] // For components: which M-LEGOs contain this component
  legoType?: 'A' | 'M' // Atomic or Molecular
}

export interface LegoConnection {
  source: string
  target: string
  count: number
}

export interface PhraseWithPath {
  id: string
  targetText: string
  legoPath: string[] // Ordered list of LEGO IDs that compose this phrase
  durationMs?: number // Audio duration for sorting eternal/debut phrases
}

export interface NetworkData {
  nodes: LegoNode[]
  connections: LegoConnection[]
  phrases: PhraseWithPath[] // All phrases with their decomposed LEGO paths
  phrasesByLego: Map<string, PhraseWithPath[]> // Index: lego_id → phrases containing it
  legoMap: Map<string, string> // normalized target text → lego_id
  stats: {
    totalLegos: number
    totalComponents: number
    totalPhrases: number
    phrasesWithPaths: number
    uniqueConnections: number
  }
}

// Normalize text for matching
// Strips accents, removes punctuation, normalizes whitespace
function normalize(text: string): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .normalize('NFD')                    // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '')     // Remove accent marks
    .replace(/[¿¡.,;:!?'"«»""'']/g, '')  // Remove punctuation
    .trim()
    .replace(/\s+/g, ' ')                // Normalize whitespace
}

// Greedy decomposition - find longest matching LEGO at each position
function decomposePhrase(phraseText: string, legoMap: Map<string, string>): string[] {
  const normalized = normalize(phraseText)
  const words = normalized.split(' ')
  const result: string[] = []
  let i = 0

  while (i < words.length) {
    let longestMatch: string | null = null
    let longestLength = 0

    for (let len = words.length - i; len > 0; len--) {
      const candidate = words.slice(i, i + len).join(' ')
      const legoId = legoMap.get(candidate)
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
      i++ // Skip unmatched word
    }
  }

  return result
}

export function useLegoNetwork(supabase: Ref<SupabaseClient | null>) {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const networkData = ref<NetworkData | null>(null)
  const currentCourseCode = ref<string | null>(null)

  /**
   * Load network data for a course
   */
  async function loadNetworkData(courseCode: string): Promise<NetworkData | null> {
    currentCourseCode.value = courseCode
    if (!supabase.value) {
      error.value = 'Database not configured'
      return null
    }

    isLoading.value = true
    error.value = null

    try {
      console.log(`[useLegoNetwork] Loading data for ${courseCode}`)

      // Load all LEGOs for the course (using lego_cycles view to get duration)
      const { data: legos, error: legoError } = await supabase.value
        .from('lego_cycles')
        .select('lego_id, seed_number, lego_index, known_text, target_text, target1_duration_ms')
        .eq('course_code', courseCode)
        .order('seed_number')
        .order('lego_index')

      if (legoError) {
        console.error(`[useLegoNetwork] ❌ lego_cycles query error:`, legoError)
        throw legoError
      }

      console.log(`[useLegoNetwork] lego_cycles returned ${legos?.length || 0} rows for ${courseCode}`)
      if (legos && legos.length > 0) {
        console.log(`[useLegoNetwork] Sample LEGOs:`, legos.slice(0, 3).map(l => ({ id: l.lego_id, target: l.target_text })))
      }

      if (!legos || legos.length === 0) {
        console.error(`[useLegoNetwork] ⚠️ No LEGOs found in lego_cycles for course: ${courseCode}`)
        console.error(`[useLegoNetwork] This usually means course_legos table has no data for this course.`)
        console.error(`[useLegoNetwork] The lego_cycles view JOINs course_legos with course_audio.`)
        error.value = 'No LEGOs found for this course'
        return null
      }

      // Build lookup map (normalized target text → lego_id)
      const legoMap = new Map<string, string>()
      const nodes: LegoNode[] = []

      for (const lego of legos) {
        const targetNorm = normalize(lego.target_text)
        if (targetNorm) {
          legoMap.set(targetNorm, lego.lego_id)
        }

        nodes.push({
          id: lego.lego_id,
          seedId: `S${String(lego.seed_number).padStart(4, '0')}`,
          legoIndex: lego.lego_index,
          knownText: lego.known_text,
          targetText: lego.target_text,
          durationMs: lego.target1_duration_ms || 500, // Default 500ms if missing
          totalPractices: 0,
          usedInPhrases: 0,
          mastery: 0,
          isEternal: false,
        })
      }

      console.log(`[useLegoNetwork] Loaded ${nodes.length} LEGOs`)

      // Load M-type LEGOs to extract components
      const { data: mTypeLegos, error: mTypeError } = await supabase.value
        .from('course_legos')
        .select('lego_id, type, components, known_text, target_text')
        .eq('course_code', courseCode)
        .eq('type', 'M')
        .not('components', 'is', null)

      if (mTypeError) {
        console.warn('[useLegoNetwork] Error loading M-type LEGOs:', mTypeError)
      }

      // Extract unique components from M-type LEGOs
      const componentMap = new Map<string, {
        known: string
        target: string
        parentLegoIds: string[]
      }>()

      if (mTypeLegos && mTypeLegos.length > 0) {
        for (const mLego of mTypeLegos) {
          if (!mLego.components || !Array.isArray(mLego.components)) continue

          for (const comp of mLego.components) {
            // Handle both component formats
            const known = comp.known || comp.known_text || ''
            const target = comp.target || comp.target_text || ''
            if (!target) continue

            const targetNorm = normalize(target)

            // Skip if this component matches an existing LEGO (it's already a node)
            if (legoMap.has(targetNorm)) continue

            // Add or update component
            const existing = componentMap.get(targetNorm)
            if (existing) {
              if (!existing.parentLegoIds.includes(mLego.lego_id)) {
                existing.parentLegoIds.push(mLego.lego_id)
              }
            } else {
              componentMap.set(targetNorm, {
                known,
                target,
                parentLegoIds: [mLego.lego_id]
              })
            }
          }
        }

        // Create component nodes
        let componentIndex = 0
        for (const [targetNorm, comp] of componentMap) {
          const componentId = `COMP_${componentIndex++}`

          // Add to legoMap for phrase decomposition
          legoMap.set(targetNorm, componentId)

          nodes.push({
            id: componentId,
            seedId: 'COMP', // Special seed ID for components
            legoIndex: componentIndex,
            knownText: comp.known,
            targetText: comp.target,
            durationMs: 400, // Estimate - components are typically short
            totalPractices: 0,
            usedInPhrases: 0,
            mastery: 0,
            isEternal: false,
            isComponent: true,
            parentLegoIds: comp.parentLegoIds,
          })
        }

        console.log(`[useLegoNetwork] Extracted ${componentMap.size} unique components from ${mTypeLegos.length} M-type LEGOs`)
      }

      // Build connections from pre-computed connected_lego_ids in practice_cycles
      // This data is populated by the Dashboard during course generation
      const connections: LegoConnection[] = []
      const connectionMap = new Map<string, number>()  // "source|target" -> count

      // Helper to add bidirectional connection
      const addConnection = (sourceId: string, targetId: string) => {
        // Create consistent edge ID (alphabetical order)
        const [first, second] = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId]
        const key = `${first}|${second}`
        connectionMap.set(key, (connectionMap.get(key) || 0) + 1)
      }

      // Load phrases with their pre-computed connections
      const { data: phrases, error: phraseError } = await supabase.value
        .from('practice_cycles')
        .select('lego_id, connected_lego_ids')
        .eq('course_code', courseCode)
        .not('connected_lego_ids', 'is', null)

      if (phraseError) {
        console.warn('[useLegoNetwork] Error loading phrase connections:', phraseError)
      }

      if (phrases && phrases.length > 0) {
        console.log(`[useLegoNetwork] Loaded ${phrases.length} phrases with connection data`)

        for (const phrase of phrases) {
          if (!phrase.connected_lego_ids || !Array.isArray(phrase.connected_lego_ids)) continue

          // Connect the phrase's primary LEGO to each connected LEGO
          for (const connectedId of phrase.connected_lego_ids) {
            if (connectedId && connectedId !== phrase.lego_id) {
              addConnection(phrase.lego_id, connectedId)
            }
          }
        }
      } else {
        console.log('[useLegoNetwork] No pre-computed connections found, falling back to M-type components')

        // Fallback: Build connections from M-type LEGO components
        if (mTypeLegos && mTypeLegos.length > 0) {
          for (const mLego of mTypeLegos) {
            if (!mLego.components || !Array.isArray(mLego.components)) continue

            // Get all component IDs for this M-type
            const componentIds: string[] = []
            for (const comp of mLego.components) {
              const target = comp.target || comp.target_text || ''
              if (!target) continue
              const targetNorm = normalize(target)
              const compId = legoMap.get(targetNorm)
              if (compId) componentIds.push(compId)
            }

            // Connect M-type to each of its components
            for (const compId of componentIds) {
              addConnection(mLego.lego_id, compId)
            }

            // Connect components to each other (they co-occur in this M-type)
            for (let i = 0; i < componentIds.length; i++) {
              for (let j = i + 1; j < componentIds.length; j++) {
                addConnection(componentIds[i], componentIds[j])
              }
            }
          }
        }
      }

      // Convert connection map to array
      for (const [key, count] of connectionMap) {
        const [source, target] = key.split('|')
        connections.push({ source, target, count })
      }

      const phrasesByLego = new Map<string, PhraseWithPath[]>()

      console.log(`[useLegoNetwork] Loaded ${nodes.length} LEGOs, built ${connections.length} connections`)

      const componentCount = nodes.filter(n => n.isComponent).length
      const legoCount = nodes.length - componentCount

      const data: NetworkData = {
        nodes,
        connections,
        phrases: [],  // Loaded on-demand via search
        phrasesByLego,
        legoMap,
        stats: {
          totalLegos: legoCount,
          totalComponents: componentCount,
          totalPhrases: 0,  // Not loaded upfront
          phrasesWithPaths: 0,
          uniqueConnections: connections.length,
        }
      }

      networkData.value = data
      return data

    } catch (err) {
      console.error('[useLegoNetwork] Error:', err)
      error.value = err instanceof Error ? err.message : 'Failed to load network data'
      return null
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Get connections for a specific LEGO
   */
  function getLegoConnections(legoId: string) {
    if (!networkData.value) return { followsFrom: [], leadsTo: [] }

    const followsFrom = networkData.value.connections
      .filter(c => c.target === legoId)
      .map(c => ({ legoId: c.source, count: c.count }))
      .sort((a, b) => b.count - a.count)

    const leadsTo = networkData.value.connections
      .filter(c => c.source === legoId)
      .map(c => ({ legoId: c.target, count: c.count }))
      .sort((a, b) => b.count - a.count)

    return { followsFrom, leadsTo }
  }

  /**
   * Get phrases containing a specific LEGO, sorted by path length (simpler first)
   */
  function getPhrasesForLego(legoId: string, limit: number = 20): PhraseWithPath[] {
    if (!networkData.value) return []

    const phrases = networkData.value.phrasesByLego.get(legoId) || []

    // Sort by path length (simpler phrases first), then alphabetically
    return [...phrases]
      .sort((a, b) => {
        if (a.legoPath.length !== b.legoPath.length) {
          return a.legoPath.length - b.legoPath.length
        }
        return a.targetText.localeCompare(b.targetText)
      })
      .slice(0, limit)
  }

  /**
   * Get eternal phrases for a LEGO - searches database on-demand
   * Returns phrases containing the LEGO's text, sorted by duration (longest first)
   *
   * @param legoId - The LEGO ID to look up
   * @param targetText - The LEGO's target text for substring matching
   */
  async function getEternalPhrasesForLego(legoId: string, targetText?: string): Promise<PhraseWithPath[]> {
    if (!supabase.value || !currentCourseCode.value || !targetText) {
      console.warn('[useLegoNetwork] getEternalPhrasesForLego: missing supabase, courseCode, or targetText')
      return []
    }

    try {
      // Search for phrases containing this LEGO's text using ILIKE
      // This is a targeted query - much faster than loading all phrases
      const searchTerm = `%${targetText}%`

      const { data: phrases, error: err } = await supabase.value
        .from('practice_cycles')
        .select('id, target_text, target1_duration_ms, lego_id')
        .eq('course_code', currentCourseCode.value)
        .ilike('target_text', searchTerm)
        .order('target1_duration_ms', { ascending: false, nullsFirst: false })
        .limit(10)

      if (err) {
        console.error('[useLegoNetwork] Phrase search failed:', err.message)
        return []
      }

      if (!phrases || phrases.length === 0) {
        console.log(`[useLegoNetwork] No phrases found containing "${targetText}"`)
        return []
      }

      console.log(`[useLegoNetwork] Found ${phrases.length} phrases containing "${targetText}"`)

      // Convert to PhraseWithPath format
      // Use legoMap to decompose each phrase into its constituent LEGOs for fire path animation
      const legoMap = networkData.value?.legoMap
      const results: PhraseWithPath[] = phrases.map(p => {
        // Decompose phrase into LEGO path if we have the map
        let path: string[] = [legoId]  // Fallback to single LEGO
        if (legoMap && legoMap.size > 0) {
          const decomposed = decomposePhrase(p.target_text, legoMap)
          if (decomposed.length > 0) {
            path = decomposed
          }
        }
        return {
          id: p.id,
          targetText: p.target_text,
          legoPath: path,
          durationMs: p.target1_duration_ms || undefined,
        }
      })

      return results.slice(0, 5)  // Return top 5
    } catch (err) {
      console.error('[useLegoNetwork] Error searching phrases:', err)
      return []
    }
  }

  return {
    isLoading,
    error,
    networkData,
    loadNetworkData,
    getLegoConnections,
    getPhrasesForLego,
    getEternalPhrasesForLego,
  }
}
