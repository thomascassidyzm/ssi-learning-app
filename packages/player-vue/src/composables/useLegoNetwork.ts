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

      // Load all phrases from practice_cycles
      // Include lego_id and connected_lego_ids for direct mapping (more reliable than text decomposition)
      let allPhrases: {
        id: string
        target_text: string
        target1_duration_ms: number | null
        lego_id: string | null
        connected_lego_ids: string[] | null  // Precomputed connections from database
      }[] = []
      let offset = 0
      const pageSize = 1000

      while (true) {
        const { data: phrasePage, error: phraseError } = await supabase.value
          .from('practice_cycles')
          .select('id, target_text, target1_duration_ms, lego_id, connected_lego_ids')
          .eq('course_code', courseCode)
          .range(offset, offset + pageSize - 1)

        if (phraseError) throw phraseError
        if (!phrasePage || phrasePage.length === 0) break

        allPhrases = allPhrases.concat(phrasePage)
        if (phrasePage.length < pageSize) break
        offset += pageSize
      }

      console.log(`[useLegoNetwork] practice_cycles returned ${allPhrases?.length || 0} rows for ${courseCode}`)
      if (allPhrases && allPhrases.length > 0) {
        console.log(`[useLegoNetwork] Sample phrases:`, allPhrases.slice(0, 3).map(p => ({ id: p.id, target: p.target_text?.slice(0, 50), lego_id: p.lego_id })))
      } else {
        console.warn(`[useLegoNetwork] ⚠️ No phrases returned from practice_cycles for ${courseCode}`)
        console.warn(`[useLegoNetwork] This is likely because practice_cycles JOINs with lego_cycles.`)
        console.warn(`[useLegoNetwork] Trying fallback: querying course_practice_phrases directly...`)

        // FALLBACK: Query course_practice_phrases directly
        // This bypasses the JOIN with lego_cycles
        let fallbackOffset = 0

        while (true) {
          const { data: page, error: pageError } = await supabase.value
            .from('course_practice_phrases')
            .select('id, target_text, seed_number, lego_index, connected_lego_ids')
            .eq('course_code', courseCode)
            .range(fallbackOffset, fallbackOffset + pageSize - 1)

          if (pageError) {
            console.error('[useLegoNetwork] Fallback query failed:', pageError)
            break
          }
          if (!page || page.length === 0) break

          // Construct lego_id from seed_number and lego_index (same as practice_cycles view does)
          for (const row of page) {
            const legoId = `S${String(row.seed_number).padStart(4, '0')}L${String(row.lego_index).padStart(2, '0')}`
            allPhrases.push({
              id: row.id,
              target_text: row.target_text,
              target1_duration_ms: null,
              lego_id: legoId,
              connected_lego_ids: row.connected_lego_ids || null
            })
          }

          if (page.length < pageSize) break
          fallbackOffset += pageSize
        }

        if (allPhrases.length > 0) {
          console.log(`[useLegoNetwork] Fallback: loaded ${allPhrases.length} phrases from course_practice_phrases`)
        } else {
          console.error(`[useLegoNetwork] ❌ Fallback ALSO returned 0 phrases!`)
          console.error(`[useLegoNetwork] The course_practice_phrases table has NO data for course_code="${courseCode}"`)
          console.error(`[useLegoNetwork] This means the course phrases have not been populated in the database.`)
          console.error(`[useLegoNetwork] Check: 1) Is the course_code correct? 2) Has the dashboard exported phrases for this course?`)
        }
      }

      // Build phrase index: any phrase containing a LEGO's text is indexed under that LEGO
      // Simple substring matching - if the LEGO text appears in the phrase, it counts
      const connectionCounts = new Map<string, number>()
      const legoUsage = new Map<string, number>()
      const phrasesWithPath: PhraseWithPath[] = []
      const phrasesByLego = new Map<string, PhraseWithPath[]>()
      let phrasesWithPathCount = 0

      // Build reverse lookup: normalized text -> lego_id (for connection building)
      const normalizedLegoTexts = new Map<string, { id: string, text: string }>()
      for (const node of nodes) {
        const normText = normalize(node.targetText)
        if (normText) {
          normalizedLegoTexts.set(node.id, { id: node.id, text: normText })
        }
      }

      for (const phrase of allPhrases || []) {
        if (!phrase.target_text) continue

        const normalizedPhrase = normalize(phrase.target_text)
        const matchingLegoIds: string[] = []

        // Find ALL LEGOs whose text appears in this phrase
        for (const [legoId, legoInfo] of normalizedLegoTexts) {
          if (normalizedPhrase.includes(legoInfo.text)) {
            matchingLegoIds.push(legoId)
          }
        }

        // Also ensure primary lego_id is included
        if (phrase.lego_id && !matchingLegoIds.includes(phrase.lego_id)) {
          matchingLegoIds.push(phrase.lego_id)
        }

        if (matchingLegoIds.length === 0) continue

        // Track LEGO usage
        for (const legoId of matchingLegoIds) {
          legoUsage.set(legoId, (legoUsage.get(legoId) || 0) + 1)
        }

        // Create phrase object
        const phraseWithPath: PhraseWithPath = {
          id: phrase.id,
          targetText: phrase.target_text,
          legoPath: matchingLegoIds,
          durationMs: phrase.target1_duration_ms || undefined,
        }
        phrasesWithPath.push(phraseWithPath)

        // Index phrase under EVERY matching LEGO
        for (const legoId of matchingLegoIds) {
          if (!phrasesByLego.has(legoId)) {
            phrasesByLego.set(legoId, [])
          }
          phrasesByLego.get(legoId)!.push(phraseWithPath)
        }

        // Build connections between LEGOs that co-occur in this phrase
        if (matchingLegoIds.length >= 2) {
          phrasesWithPathCount++
          // Connect each pair of LEGOs that appear together
          for (let i = 0; i < matchingLegoIds.length; i++) {
            for (let j = i + 1; j < matchingLegoIds.length; j++) {
              const key = `${matchingLegoIds[i]}→${matchingLegoIds[j]}`
              connectionCounts.set(key, (connectionCounts.get(key) || 0) + 1)
            }
          }
        }
      }

      console.log(`[useLegoNetwork] Indexed ${phrasesWithPath.length} phrases across ${phrasesByLego.size} LEGOs (substring matching)`)

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

      console.log(`[useLegoNetwork] Built ${connections.length} unique connections from ${phrasesWithPathCount} phrases (2+ LEGOs matched)`)
      console.log(`[useLegoNetwork] Indexed ${phrasesWithPath.length} phrases across ${phrasesByLego.size} LEGOs`)

      // Diagnostic: If we have phrases but few/no connections, decomposition is failing
      if (allPhrases && allPhrases.length > 0 && connections.length === 0) {
        console.warn(`[useLegoNetwork] ⚠️ DECOMPOSITION FAILED: ${allPhrases.length} phrases loaded but no connections built`)
        console.warn(`[useLegoNetwork] legoMap has ${legoMap.size} entries`)
        if (legoMap.size > 0) {
          console.warn(`[useLegoNetwork] Sample legoMap entries:`, [...legoMap.entries()].slice(0, 5))
        }
        // Test decomposition on first few phrases
        const testPhrases = allPhrases.slice(0, 3)
        for (const p of testPhrases) {
          const decomposed = decomposePhrase(p.target_text, legoMap)
          console.warn(`[useLegoNetwork] Phrase "${p.target_text?.slice(0, 40)}..." → decomposed to ${decomposed.length} LEGOs: [${decomposed.join(', ')}]`)
        }
      }

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
          totalPhrases: allPhrases?.length || 0,
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
   *
   * @param legoId - The LEGO ID to look up
   * @param targetText - Optional: the LEGO's target text for substring matching fallback
   */
  function getEternalPhrasesForLego(legoId: string, targetText?: string): PhraseWithPath[] {
    if (!networkData.value) return []

    // First try direct ID lookup
    let phrases = networkData.value.phrasesByLego.get(legoId) || []

    // If no results and we have targetText, do substring search on all phrases
    if (phrases.length === 0 && targetText && networkData.value.phrases.length > 0) {
      const normalizedTarget = normalize(targetText)
      if (normalizedTarget) {
        phrases = networkData.value.phrases.filter(p => {
          const normalizedPhrase = normalize(p.targetText)
          return normalizedPhrase.includes(normalizedTarget)
        })
        console.log(`[useLegoNetwork] ID lookup failed for ${legoId}, text search for "${targetText}" found ${phrases.length} phrases`)
      }
    }

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
