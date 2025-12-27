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

export interface NetworkData {
  nodes: LegoNode[]
  connections: LegoConnection[]
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

      // Load all phrases for the course
      const { data: phrases, error: phraseError } = await supabase.value
        .from('course_practice_phrases')
        .select('id, target_text')
        .eq('course_code', courseCode)

      if (phraseError) throw phraseError

      console.log(`[useLegoNetwork] Loaded ${phrases?.length || 0} phrases`)

      // Build connection graph from phrase co-occurrence
      const connectionCounts = new Map<string, number>()
      const legoUsage = new Map<string, number>()
      let phrasesWithPaths = 0

      for (const phrase of phrases || []) {
        const legoIds = decomposePhrase(phrase.target_text, legoMap)

        // Track LEGO usage
        for (const legoId of legoIds) {
          legoUsage.set(legoId, (legoUsage.get(legoId) || 0) + 1)
        }

        // Build directional connections between consecutive LEGOs
        if (legoIds.length >= 2) {
          phrasesWithPaths++
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

      console.log(`[useLegoNetwork] Built ${connections.length} unique connections from ${phrasesWithPaths} phrases`)

      const data: NetworkData = {
        nodes,
        connections,
        legoMap,
        stats: {
          totalLegos: nodes.length,
          totalPhrases: phrases?.length || 0,
          phrasesWithPaths,
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

  return {
    isLoading,
    error,
    networkData,
    loadNetworkData,
    getLegoConnections,
  }
}
