/**
 * useDistinctionNetwork - Live distinction network state for learning sessions
 *
 * Based on distinction physics principles:
 * - Each LEGO is a distinction (a boundary between known→target)
 * - Edges are directional pathways (language is temporal)
 * - Connection strength affects spatial clustering (fire together → wire together → cluster together)
 * - Network visualizes the actual structure being built in the learner's brain
 *
 * Key differences from useLegoNetwork:
 * - This manages LIVE state during a learning session
 * - Nodes are added dynamically as LEGOs are introduced
 * - Edges strengthen in real-time as phrases are practiced
 * - Provides D3-compatible data with clustering physics
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue'

// ============================================================================
// TYPES
// ============================================================================

export interface DistinctionNode {
  id: string                    // LEGO ID
  targetText: string            // Target language text
  knownText: string             // Known language text
  belt: string                  // Belt level when introduced
  practiceCount: number         // Times this distinction was practiced
  introducedAt: number          // Timestamp of introduction
  lastPracticedAt: number       // Timestamp of last practice

  // D3 simulation properties (mutable by force simulation)
  x?: number
  y?: number
  fx?: number | null            // Fixed x (for hero node)
  fy?: number | null            // Fixed y (for hero node)
  vx?: number
  vy?: number
}

export interface DirectionalEdge {
  id: string                    // Unique edge ID: "sourceId→targetId"
  source: string                // Source LEGO ID
  target: string                // Target LEGO ID (direction matters!)
  strength: number              // Times this exact sequence was fired
  lastFiredAt: number           // Timestamp of last firing

  // Derived for D3 (calculated from strength)
  distance?: number             // Link distance for force simulation
}

export interface PathHighlight {
  nodeIds: string[]             // Ordered list of nodes in the path
  edgeIds: string[]             // Ordered list of edges in the path
  activeIndex: number           // Current position in animation (-1 = not active)
}

export interface NetworkStats {
  totalNodes: number
  totalEdges: number
  totalPractices: number        // Sum of all edge strengths
  avgEdgeStrength: number
  maxEdgeStrength: number
  density: number               // edges / possible edges
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Clustering physics: how connection strength affects spatial distance
const CLUSTERING = {
  maxDistance: 400,             // Maximum link distance (weak/new connections)
  minDistance: 80,              // Minimum link distance (strong connections)
  strengthExponent: 0.3,        // How quickly distance decreases with strength
                                // 0.3 = very gradual, 0.5 = square root, 1 = linear
}

// Belt thresholds - at which LEGO index each belt begins
// This determines what color a node has based on when it was introduced
const BELT_THRESHOLDS = [
  { belt: 'black', threshold: 800 },
  { belt: 'brown', threshold: 560 },
  { belt: 'purple', threshold: 300 },
  { belt: 'blue', threshold: 160 },
  { belt: 'green', threshold: 80 },
  { belt: 'orange', threshold: 40 },
  { belt: 'yellow', threshold: 16 },
  { belt: 'white', threshold: 0 },
]

/**
 * Get belt color for a LEGO based on its introduction position
 */
function getBeltForPosition(position: number): string {
  for (const { belt, threshold } of BELT_THRESHOLDS) {
    if (position >= threshold) return belt
  }
  return 'white'
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useDistinctionNetwork() {
  // Core state
  const nodes: Ref<DistinctionNode[]> = ref([])
  const edges: Ref<DirectionalEdge[]> = ref([])

  // Hero node (the current focus - usually the LEGO being practiced)
  const heroNodeId: Ref<string | null> = ref(null)

  // Path highlighting (for Voice 2 phase animation)
  const currentPath: Ref<PathHighlight | null> = ref(null)

  // Lookup maps for fast access
  const nodeMap: Ref<Map<string, DistinctionNode>> = ref(new Map())
  const edgeMap: Ref<Map<string, DirectionalEdge>> = ref(new Map())

  // ============================================================================
  // COMPUTED PROPERTIES
  // ============================================================================

  // D3-compatible nodes array
  const d3Nodes: ComputedRef<DistinctionNode[]> = computed(() => nodes.value)

  // D3-compatible links array with calculated distances
  const d3Links: ComputedRef<DirectionalEdge[]> = computed(() => {
    return edges.value.map(edge => ({
      ...edge,
      distance: calculateLinkDistance(edge.strength)
    }))
  })

  // Network statistics
  const stats: ComputedRef<NetworkStats> = computed(() => {
    const totalEdges = edges.value.length
    const totalNodes = nodes.value.length
    const totalPractices = edges.value.reduce((sum, e) => sum + e.strength, 0)
    const maxEdgeStrength = edges.value.length > 0
      ? Math.max(...edges.value.map(e => e.strength))
      : 0
    const avgEdgeStrength = totalEdges > 0 ? totalPractices / totalEdges : 0

    // Density: actual edges / possible directed edges
    // For directed graph: n * (n-1) possible edges
    const possibleEdges = totalNodes * (totalNodes - 1)
    const density = possibleEdges > 0 ? totalEdges / possibleEdges : 0

    return {
      totalNodes,
      totalEdges,
      totalPractices,
      avgEdgeStrength,
      maxEdgeStrength,
      density
    }
  })

  // Get the current hero node
  const heroNode: ComputedRef<DistinctionNode | null> = computed(() => {
    if (!heroNodeId.value) return null
    return nodeMap.value.get(heroNodeId.value) || null
  })

  // Get edges connected to hero (for highlighting)
  const heroEdges: ComputedRef<{ incoming: DirectionalEdge[], outgoing: DirectionalEdge[] }> = computed(() => {
    if (!heroNodeId.value) return { incoming: [], outgoing: [] }

    const heroId = heroNodeId.value
    return {
      incoming: edges.value.filter(e => e.target === heroId),
      outgoing: edges.value.filter(e => e.source === heroId)
    }
  })

  // ============================================================================
  // CORE METHODS
  // ============================================================================

  /**
   * Calculate link distance from strength
   * Stronger connections = shorter distance = nodes cluster together
   * Like rivers carving channels - high-flow paths pull nodes closer
   */
  function calculateLinkDistance(strength: number): number {
    // Inverse relationship: more strength = less distance
    // Using power function for gradual curve
    const normalized = Math.pow(strength, CLUSTERING.strengthExponent)
    const distance = CLUSTERING.maxDistance / (1 + normalized * 0.5)
    return Math.max(CLUSTERING.minDistance, distance)
  }

  /**
   * Add a new distinction (LEGO) to the network
   * Returns true if added, false if already exists
   */
  function addNode(
    id: string,
    targetText: string,
    knownText: string,
    belt: string = 'white',
    initialPosition?: { x: number, y: number }
  ): boolean {
    // Check if already exists
    if (nodeMap.value.has(id)) {
      console.log(`[DistinctionNetwork] Node ${id} already exists`)
      return false
    }

    const now = Date.now()
    const node: DistinctionNode = {
      id,
      targetText,
      knownText,
      belt,
      practiceCount: 0,
      introducedAt: now,
      lastPracticedAt: now,
      x: initialPosition?.x,
      y: initialPosition?.y,
      fx: null,
      fy: null,
    }

    nodes.value.push(node)
    nodeMap.value.set(id, node)

    console.log(`[DistinctionNetwork] Added node: ${id} (${targetText})`)
    return true
  }

  /**
   * Set a node as the hero (centered focus)
   * Pins the node to a fixed position
   */
  function setHero(nodeId: string, position: { x: number, y: number }): boolean {
    const node = nodeMap.value.get(nodeId)
    if (!node) {
      console.warn(`[DistinctionNetwork] Cannot set hero: node ${nodeId} not found`)
      return false
    }

    // Unpin previous hero
    if (heroNodeId.value && heroNodeId.value !== nodeId) {
      const prevHero = nodeMap.value.get(heroNodeId.value)
      if (prevHero) {
        prevHero.fx = null
        prevHero.fy = null
      }
    }

    // Pin new hero
    node.fx = position.x
    node.fy = position.y
    node.x = position.x
    node.y = position.y
    heroNodeId.value = nodeId

    console.log(`[DistinctionNetwork] Set hero: ${nodeId} at (${position.x}, ${position.y})`)
    return true
  }

  /**
   * Fire a directional pathway: strengthen or create edge from source → target
   * This is the core Hebbian operation: "fire together, wire together"
   *
   * IMPORTANT: Direction matters! A→B is NOT the same as B→A
   * Language is temporal - sequences only go one way
   */
  function fireEdge(sourceId: string, targetId: string): DirectionalEdge | null {
    // Validate nodes exist
    if (!nodeMap.value.has(sourceId) || !nodeMap.value.has(targetId)) {
      console.warn(`[DistinctionNetwork] Cannot fire edge: missing node(s)`)
      return null
    }

    // No self-loops
    if (sourceId === targetId) return null

    const edgeId = `${sourceId}→${targetId}`
    const now = Date.now()

    let edge = edgeMap.value.get(edgeId)

    if (edge) {
      // Strengthen existing edge
      edge.strength += 1
      edge.lastFiredAt = now
      console.log(`[DistinctionNetwork] Strengthened edge ${edgeId} → strength: ${edge.strength}`)
    } else {
      // Create new edge
      edge = {
        id: edgeId,
        source: sourceId,
        target: targetId,
        strength: 1,
        lastFiredAt: now,
      }
      edges.value.push(edge)
      edgeMap.value.set(edgeId, edge)
      console.log(`[DistinctionNetwork] Created edge ${edgeId}`)
    }

    // Update node practice counts
    const sourceNode = nodeMap.value.get(sourceId)
    const targetNode = nodeMap.value.get(targetId)
    if (sourceNode) {
      sourceNode.practiceCount += 1
      sourceNode.lastPracticedAt = now
    }
    if (targetNode) {
      targetNode.practiceCount += 1
      targetNode.lastPracticedAt = now
    }

    return edge
  }

  /**
   * Fire a complete path through the network
   * Called when a phrase is practiced - creates/strengthens all sequential edges
   *
   * For phrase with LEGOs [A, B, C]:
   *   Creates: A→B, B→C
   *   Does NOT create: B→A, C→B (wrong direction)
   */
  function firePath(legoIds: string[]): DirectionalEdge[] {
    if (!legoIds || legoIds.length < 2) return []

    const firedEdges: DirectionalEdge[] = []

    // Fire each sequential pair
    for (let i = 0; i < legoIds.length - 1; i++) {
      const edge = fireEdge(legoIds[i], legoIds[i + 1])
      if (edge) {
        firedEdges.push(edge)
      }
    }

    console.log(`[DistinctionNetwork] Fired path: ${legoIds.join('→')} (${firedEdges.length} edges)`)
    return firedEdges
  }

  /**
   * Set the currently highlighted path (for Voice 2 animation)
   */
  function setHighlightPath(legoIds: string[]): void {
    if (!legoIds || legoIds.length === 0) {
      currentPath.value = null
      return
    }

    // Build edge IDs for the path
    const edgeIds: string[] = []
    for (let i = 0; i < legoIds.length - 1; i++) {
      edgeIds.push(`${legoIds[i]}→${legoIds[i + 1]}`)
    }

    currentPath.value = {
      nodeIds: [...legoIds],
      edgeIds,
      activeIndex: -1  // Not yet animating
    }
  }

  /**
   * Animate through the path (call repeatedly with increasing index)
   */
  function setPathActiveIndex(index: number): void {
    if (currentPath.value) {
      currentPath.value.activeIndex = index
    }
  }

  /**
   * Clear the highlighted path
   */
  function clearHighlightPath(): void {
    currentPath.value = null
  }

  /**
   * Check if a node is in the current highlighted path
   */
  function isNodeInPath(nodeId: string): boolean {
    return currentPath.value?.nodeIds.includes(nodeId) ?? false
  }

  /**
   * Check if a node is the currently active one in path animation
   */
  function isNodeActive(nodeId: string): boolean {
    if (!currentPath.value || currentPath.value.activeIndex < 0) return false
    return currentPath.value.nodeIds[currentPath.value.activeIndex] === nodeId
  }

  /**
   * Check if an edge is in the current highlighted path
   */
  function isEdgeInPath(edgeId: string): boolean {
    return currentPath.value?.edgeIds.includes(edgeId) ?? false
  }

  /**
   * Check if an edge is currently being animated
   */
  function isEdgeActive(edgeId: string): boolean {
    if (!currentPath.value || currentPath.value.activeIndex < 0) return false
    // Edge at index i connects nodes i and i+1
    return currentPath.value.edgeIds[currentPath.value.activeIndex] === edgeId
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get all edges connected to a node (both directions)
   */
  function getNodeConnections(nodeId: string): {
    incoming: DirectionalEdge[],
    outgoing: DirectionalEdge[]
  } {
    return {
      incoming: edges.value.filter(e => e.target === nodeId),
      outgoing: edges.value.filter(e => e.source === nodeId)
    }
  }

  /**
   * Get nodes within N hops of a given node
   * Useful for showing "neighborhood" around hero
   */
  function getNeighborhood(nodeId: string, maxHops: number = 2): Set<string> {
    const visited = new Set<string>([nodeId])
    let frontier = new Set<string>([nodeId])

    for (let hop = 0; hop < maxHops; hop++) {
      const nextFrontier = new Set<string>()

      for (const id of frontier) {
        // Add all connected nodes (both directions for neighborhood)
        edges.value.forEach(e => {
          if (e.source === id && !visited.has(e.target)) {
            nextFrontier.add(e.target)
            visited.add(e.target)
          }
          if (e.target === id && !visited.has(e.source)) {
            nextFrontier.add(e.source)
            visited.add(e.source)
          }
        })
      }

      frontier = nextFrontier
    }

    return visited
  }

  /**
   * Get edge by ID
   */
  function getEdge(edgeId: string): DirectionalEdge | undefined {
    return edgeMap.value.get(edgeId)
  }

  /**
   * Get edge between two specific nodes (direction matters!)
   */
  function getDirectionalEdge(sourceId: string, targetId: string): DirectionalEdge | undefined {
    return edgeMap.value.get(`${sourceId}→${targetId}`)
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Populate network from an array of rounds (for resume/backfill)
   * Adds all nodes up to a given round index
   * Each node gets its belt color based on when it was introduced
   *
   * Edges are created based on actual phrase co-occurrence:
   * "fire together, wire together" - LEGOs that appear in the same
   * practice phrase get connected, showing real language pathways.
   */
  function populateFromRounds(
    rounds: Array<{
      legoId: string,
      targetText?: string,
      knownText?: string,
      items?: Array<{ type: string, targetText?: string, knownText?: string }>
    }>,
    upToIndex: number,
    centerPosition: { x: number, y: number },
    _currentBelt: string = 'white' // deprecated, belt is now calculated per-node
  ): void {
    const maxIndex = Math.min(upToIndex, rounds.length - 1)
    console.log(`[DistinctionNetwork] Populating from rounds 0-${maxIndex}`)

    // Calculate orbital positions for non-hero nodes
    // Use larger radius to fill more screen space - increased for better spread
    const nodeCount = maxIndex + 1
    const orbitalRadius = Math.min(250 + nodeCount * 15, 800)

    // First pass: add all nodes and collect their target text for co-occurrence matching
    // Map of legoId → targetText (normalized for matching)
    const legoTexts = new Map<string, string>()

    for (let i = 0; i <= maxIndex; i++) {
      const round = rounds[i]
      if (!round?.legoId) continue

      // Get text from intro/debut item if available
      const introItem = round.items?.find(item =>
        item.type === 'intro' || item.type === 'debut'
      )
      const targetText = introItem?.targetText || round.targetText || round.legoId
      const knownText = introItem?.knownText || round.knownText || ''

      // Store normalized text for co-occurrence matching (even for existing nodes)
      // This is needed for edge detection later
      legoTexts.set(round.legoId, targetText.toLowerCase())

      // Skip adding node if already exists
      if (nodeMap.value.has(round.legoId)) continue

      // Calculate belt based on introduction position (birth belt)
      const nodeBelt = getBeltForPosition(i)

      // Position: hero at center, others scattered with organic randomness
      let position: { x: number, y: number }
      if (i === maxIndex) {
        // This will be the hero
        position = centerPosition
      } else {
        // Random position in a cloud around center with some clustering zones
        // Use golden angle for base distribution, then add significant jitter
        const goldenAngle = Math.PI * (3 - Math.sqrt(5)) // ~137.5 degrees
        const baseAngle = i * goldenAngle + Math.random() * 0.8 - 0.4
        const baseRadius = orbitalRadius * (0.5 + Math.random() * 0.8) // 50-130% of orbital

        // Add noise to prevent perfect patterns
        const jitterX = (Math.random() - 0.5) * 60
        const jitterY = (Math.random() - 0.5) * 60

        position = {
          x: centerPosition.x + Math.cos(baseAngle) * baseRadius + jitterX,
          y: centerPosition.y + Math.sin(baseAngle) * baseRadius + jitterY
        }
      }

      addNode(round.legoId, targetText, knownText, nodeBelt, position)
    }

    // Set the last one as hero
    const heroRound = rounds[maxIndex]
    if (heroRound?.legoId) {
      setHero(heroRound.legoId, centerPosition)
    }

    // Second pass: create edges based on actual phrase co-occurrence
    // "fire together, wire together" - LEGOs that appear in the same phrase
    // get directional edges showing the language pathway

    // Track which LEGO pairs we've already connected to avoid duplicates
    const connectedPairs = new Set<string>()
    let itemsChecked = 0
    let itemsWithMatches = 0

    for (let roundIdx = 0; roundIdx <= maxIndex; roundIdx++) {
      const round = rounds[roundIdx]
      if (!round?.items) continue

      // Look at each practice item in this round
      for (const item of round.items) {
        // Skip intro/debut items - they only have one LEGO
        if (item.type === 'intro' || item.type === 'debut') continue

        const phraseText = item.targetText?.toLowerCase()
        if (!phraseText) continue

        itemsChecked++

        // Find which LEGOs' text appears in this phrase and where
        // Only check LEGOs introduced up to this round (can't practice what you haven't learned)
        const matchingLegos: Array<{ legoId: string, position: number }> = []

        for (let j = 0; j <= roundIdx; j++) {
          const legoId = rounds[j]?.legoId
          const legoText = legoTexts.get(legoId)
          if (legoId && legoText) {
            const position = phraseText.indexOf(legoText)
            if (position >= 0) {
              matchingLegos.push({ legoId, position })
            }
          }
        }

        // Sort by position in phrase (left to right = temporal order in speech)
        matchingLegos.sort((a, b) => a.position - b.position)

        // Create edges between all co-occurring LEGOs (in phrase order)
        // If phrase contains [A, B, C], create A→B, B→C
        if (matchingLegos.length >= 2) {
          itemsWithMatches++
          for (let k = 0; k < matchingLegos.length - 1; k++) {
            const sourceId = matchingLegos[k].legoId
            const targetId = matchingLegos[k + 1].legoId
            const pairKey = `${sourceId}→${targetId}`

            if (!connectedPairs.has(pairKey) && sourceId !== targetId) {
              fireEdge(sourceId, targetId)
              connectedPairs.add(pairKey)
            }
          }
        }
      }
    }

    console.log(`[DistinctionNetwork] Edge detection: checked ${itemsChecked} items, found ${itemsWithMatches} with 2+ LEGOs`)

    // Third pass: ensure every node has at least one connection (no isolated nodes)
    // If a LEGO appears only in single-LEGO phrases, it would have no connections
    // Connect it to the previous node in sequence
    const connectedNodes = new Set<string>()
    for (const edge of edges.value) {
      connectedNodes.add(edge.source)
      connectedNodes.add(edge.target)
    }

    let syntheticConnections = 0
    for (let i = 0; i <= maxIndex; i++) {
      const round = rounds[i]
      if (!round?.legoId) continue

      if (!connectedNodes.has(round.legoId) && i > 0) {
        // This node has no connections - connect to previous node
        // Find the previous node that exists
        for (let j = i - 1; j >= 0; j--) {
          const prevRound = rounds[j]
          if (prevRound?.legoId && nodeMap.value.has(prevRound.legoId)) {
            fireEdge(prevRound.legoId, round.legoId)
            connectedNodes.add(round.legoId)
            syntheticConnections++
            break
          }
        }
      }
    }

    if (syntheticConnections > 0) {
      console.log(`[DistinctionNetwork] Added ${syntheticConnections} synthetic connections for isolated nodes`)
    }

    console.log(`[DistinctionNetwork] Populated ${nodes.value.length} nodes, ${edges.value.length} edges (phrase co-occurrence${syntheticConnections ? ` + ${syntheticConnections} synthetic` : ''})`)
  }

  /**
   * Clear the entire network (for reset)
   */
  function clear(): void {
    nodes.value = []
    edges.value = []
    nodeMap.value.clear()
    edgeMap.value.clear()
    heroNodeId.value = null
    currentPath.value = null
    console.log('[DistinctionNetwork] Cleared')
  }

  // ============================================================================
  // EXPORT
  // ============================================================================

  return {
    // State
    nodes,
    edges,
    heroNodeId,
    currentPath,

    // Computed
    d3Nodes,
    d3Links,
    stats,
    heroNode,
    heroEdges,

    // Core operations
    addNode,
    setHero,
    fireEdge,
    firePath,

    // Path highlighting
    setHighlightPath,
    setPathActiveIndex,
    clearHighlightPath,
    isNodeInPath,
    isNodeActive,
    isEdgeInPath,
    isEdgeActive,

    // Queries
    getNodeConnections,
    getNeighborhood,
    getEdge,
    getDirectionalEdge,

    // Bulk operations
    populateFromRounds,
    clear,

    // Utils
    calculateLinkDistance,
  }
}
