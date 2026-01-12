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

      // Load all LEGOs for the course (using lego_cycles view to get duration)
      const { data: legos, error: legoError } = await supabase.value
        .from('lego_cycles')
        .select('lego_id, seed_number, lego_index, known_text, target_text, target1_duration_ms')
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

      // Load all phrases from practice_cycles (has duration data for eternal/debut sorting)
      let allPhrases: { id: string; target_text: string; target1_duration_ms: number | null }[] = []
      let offset = 0
      const pageSize = 1000

      while (true) {
        const { data: phrasePage, error: phraseError } = await supabase.value
          .from('practice_cycles')
          .select('id, target_text, target1_duration_ms')
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
            durationMs: phrase.target1_duration_ms || undefined,
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

      // Find which nodes have connections
      const connectedNodeIds = new Set<string>()
      for (const conn of connections) {
        connectedNodeIds.add(conn.source)
        connectedNodeIds.add(conn.target)
      }

      // Find isolated nodes (no connections at all) and connect them to neighbors
      // This ensures they stay in the network cluster instead of floating away
      const isolatedNodes = nodes.filter(n => !connectedNodeIds.has(n.id))
      if (isolatedNodes.length > 0) {
        let connectionsAdded = 0

        for (const isolated of isolatedNodes) {
          // Find index in nodes array (sorted by seed_number, lego_index)
          const idx = nodes.findIndex(n => n.id === isolated.id)
          if (idx < 0) continue

          // Connect to previous node if exists
          if (idx > 0) {
            const prevNode = nodes[idx - 1]
            const key = `${prevNode.id}→${isolated.id}`
            if (!connectionCounts.has(key)) {
              connections.push({ source: prevNode.id, target: isolated.id, count: 1 })
              connectionsAdded++
            }
          }

          // Connect to next node if exists
          if (idx < nodes.length - 1) {
            const nextNode = nodes[idx + 1]
            const key = `${isolated.id}→${nextNode.id}`
            if (!connectionCounts.has(key)) {
              connections.push({ source: isolated.id, target: nextNode.id, count: 1 })
              connectionsAdded++
            }
          }
        }

        console.log(`[useLegoNetwork] Connected ${isolatedNodes.length} isolated LEGOs to neighbors (+${connectionsAdded} edges)`)
      }

      // Add edges between components and their parent M-LEGOs
      let componentEdgesAdded = 0
      for (const node of nodes) {
        if (node.isComponent && node.parentLegoIds) {
          for (const parentId of node.parentLegoIds) {
            // Create bidirectional edges between component and parent
            const key1 = `${node.id}→${parentId}`
            const key2 = `${parentId}→${node.id}`
            if (!connectionCounts.has(key1)) {
              connections.push({ source: node.id, target: parentId, count: 1 })
              connectedNodeIds.add(node.id)
              connectedNodeIds.add(parentId)
              componentEdgesAdded++
            }
            if (!connectionCounts.has(key2)) {
              connections.push({ source: parentId, target: node.id, count: 1 })
              componentEdgesAdded++
            }
          }
        }
      }
      if (componentEdgesAdded > 0) {
        console.log(`[useLegoNetwork] Added ${componentEdgesAdded} component-parent edges`)
      }

      // Update node usage stats
      for (const node of nodes) {
        node.usedInPhrases = legoUsage.get(node.id) || 0
      }

      console.log(`[useLegoNetwork] Built ${connections.length} unique connections from ${phrasesWithPathCount} phrases`)
      console.log(`[useLegoNetwork] Indexed ${phrasesWithPath.length} phrases across ${phrasesByLego.size} LEGOs`)

      const componentCount = nodes.filter(n => n.isComponent).length
      const legoCount = nodes.length - componentCount

      const data: NetworkData = {
        nodes,
        connections,
        phrases: phrasesWithPath,
        phrasesByLego,
        legoMap,
        stats: {
          totalLegos: legoCount,
          totalComponents: componentCount,
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

  /**
   * Get eternal phrases for a LEGO - the 5 longest by audio duration
   * These are used for spaced repetition practice
   */
  function getEternalPhrasesForLego(legoId: string): PhraseWithPath[] {
    if (!networkData.value) return []

    const phrases = networkData.value.phrasesByLego.get(legoId) || []

    // Sort by duration descending (longest first), then by path length as tiebreaker
    return [...phrases]
      .sort((a, b) => {
        const durA = a.durationMs || 0
        const durB = b.durationMs || 0
        if (durA !== durB) {
          return durB - durA // Longest first
        }
        // Tiebreaker: more LEGOs = longer phrase
        return b.legoPath.length - a.legoPath.length
      })
      .slice(0, 5) // Eternal = 5 longest
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
