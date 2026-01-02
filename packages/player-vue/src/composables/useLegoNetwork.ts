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
  totalPractices: number
  usedInPhrases: number
  mastery: number
  isEternal: boolean
  birthBelt?: string
  x?: number
  y?: number
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
}

export interface NetworkData {
  nodes: LegoNode[]
  connections: LegoConnection[]
  phrases: PhraseWithPath[] // All phrases with their decomposed LEGO paths
  phrasesByLego: Map<string, PhraseWithPath[]> // Index: lego_id → phrases containing it
  legoMap: Map<string, string> // normalized target text → lego_id
  stats: {
    totalLegos: number
    totalPhrases: number
    phrasesWithPaths: number
    uniqueConnections: number
  }
}

// Normalize text for matching
function normalize(text: string): string {
  return text?.toLowerCase().trim().replace(/\s+/g, ' ') || ''
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

  /**
   * Load network data for a course
   */
  async function loadNetworkData(courseCode: string): Promise<NetworkData | null> {
    if (!supabase.value) {
      error.value = 'Database not configured'
      return null
    }

    isLoading.value = true
    error.value = null

    try {
      console.log(`[useLegoNetwork] Loading data for ${courseCode}`)

      // Load all LEGOs for the course
      const { data: legos, error: legoError } = await supabase.value
        .from('course_legos')
        .select('lego_id, seed_number, lego_index, known_text, target_text')
        .eq('course_code', courseCode)
        .order('seed_number')
        .order('lego_index')

      if (legoError) throw legoError

      if (!legos || legos.length === 0) {
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
          totalPractices: 0,
          usedInPhrases: 0,
          mastery: 0,
          isEternal: false,
        })
      }

      console.log(`[useLegoNetwork] Loaded ${nodes.length} LEGOs`)

      // Load all phrases for the course (paginate to get beyond 1000 row limit)
      let allPhrases: { id: string; target_text: string }[] = []
      let offset = 0
      const pageSize = 1000

      while (true) {
        const { data: phrasePage, error: phraseError } = await supabase.value
          .from('course_practice_phrases')
          .select('id, target_text')
          .eq('course_code', courseCode)
          .range(offset, offset + pageSize - 1)

        if (phraseError) throw phraseError
        if (!phrasePage || phrasePage.length === 0) break

        allPhrases = allPhrases.concat(phrasePage)
        if (phrasePage.length < pageSize) break
        offset += pageSize
      }

      const phrases = allPhrases

      console.log(`[useLegoNetwork] Loaded ${phrases?.length || 0} phrases`)

      // Build connection graph from phrase co-occurrence
      // Also store phrases with their decomposed paths
      const connectionCounts = new Map<string, number>()
      const legoUsage = new Map<string, number>()
      const phrasesWithPath: PhraseWithPath[] = []
      const phrasesByLego = new Map<string, PhraseWithPath[]>()
      let phrasesWithPathCount = 0

      for (const phrase of phrases || []) {
        const legoIds = decomposePhrase(phrase.target_text, legoMap)

        // Track LEGO usage
        for (const legoId of legoIds) {
          legoUsage.set(legoId, (legoUsage.get(legoId) || 0) + 1)
        }

        // Store phrase with its path (only if it has at least one LEGO)
        if (legoIds.length >= 1) {
          const phraseWithPath: PhraseWithPath = {
            id: phrase.id,
            targetText: phrase.target_text,
            legoPath: legoIds,
          }
          phrasesWithPath.push(phraseWithPath)

          // Index by each LEGO in the path
          for (const legoId of legoIds) {
            if (!phrasesByLego.has(legoId)) {
              phrasesByLego.set(legoId, [])
            }
            phrasesByLego.get(legoId)!.push(phraseWithPath)
          }
        }

        // Build directional connections between consecutive LEGOs
        if (legoIds.length >= 2) {
          phrasesWithPathCount++
          for (let i = 0; i < legoIds.length - 1; i++) {
            const key = `${legoIds[i]}→${legoIds[i + 1]}`
            connectionCounts.set(key, (connectionCounts.get(key) || 0) + 1)
          }
        }
      }

      // Convert to connection array
      const connections: LegoConnection[] = []
      for (const [key, count] of connectionCounts) {
        const [source, target] = key.split('→')
        connections.push({ source, target, count })
      }

      // Sort by count (most frequent first)
      connections.sort((a, b) => b.count - a.count)

      // Update node usage stats
      for (const node of nodes) {
        node.usedInPhrases = legoUsage.get(node.id) || 0
      }

      console.log(`[useLegoNetwork] Built ${connections.length} unique connections from ${phrasesWithPathCount} phrases`)
      console.log(`[useLegoNetwork] Indexed ${phrasesWithPath.length} phrases across ${phrasesByLego.size} LEGOs`)

      const data: NetworkData = {
        nodes,
        connections,
        phrases: phrasesWithPath,
        phrasesByLego,
        legoMap,
        stats: {
          totalLegos: nodes.length,
          totalPhrases: phrases?.length || 0,
          phrasesWithPaths: phrasesWithPathCount,
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

  return {
    isLoading,
    error,
    networkData,
    loadNetworkData,
    getLegoConnections,
    getPhrasesForLego,
  }
}
