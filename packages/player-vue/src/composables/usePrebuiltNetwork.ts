/**
 * usePrebuiltNetwork - Pre-calculated Constellation Network
 *
 * A simpler network visualization where:
 * - ALL node positions are calculated upfront (when script loads)
 * - Positions are FIXED - nodes don't move during learning
 * - When hero changes, the entire network PANS to center on it
 * - Like panning a star map - spatial memory preserved
 *
 * Benefits:
 * - "quiero is always up-left of hablar" - spatial memory works
 * - Simpler than runtime D3 force simulation
 * - Better performance (no per-frame physics)
 * - More predictable (same layout every time)
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue'
import * as d3 from 'd3'

// ============================================================================
// TYPES
// ============================================================================

export interface ConstellationNode {
  id: string
  targetText: string
  knownText: string
  belt: string
  x: number  // Pre-calculated, fixed position
  y: number  // Pre-calculated, fixed position
  isComponent?: boolean  // True for inferred component nodes (smaller, derived from M-type splits)
  parentLegoIds?: string[]  // For components: which M-types contain this word
}

export interface ConstellationEdge {
  id: string
  source: string
  target: string
  strength: number
}

export interface PathHighlight {
  nodeIds: string[]
  edgeIds: string[]
  activeIndex: number
}

// ============================================================================
// BELT THRESHOLDS
// ============================================================================

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

function getBeltForPosition(position: number): string {
  for (const { belt, threshold } of BELT_THRESHOLDS) {
    if (position >= threshold) return belt
  }
  return 'white'
}

// ============================================================================
// PRE-CALCULATION
// ============================================================================

interface RoundData {
  legoId: string
  targetText?: string
  knownText?: string
  items?: Array<{ type: string; targetText?: string; knownText?: string }>
}

// External connections from database (same format as useLegoNetwork)
export interface ExternalConnection {
  source: string
  target: string
  count: number
}

/**
 * Pre-calculate all node positions by running D3 force simulation to completion
 * This is called ONCE when the script loads, not during learning
 *
 * @param rounds - The learning script rounds
 * @param canvasSize - Canvas dimensions for layout
 * @param externalConnections - Pre-loaded connections from database (optional)
 *                              If provided, uses these instead of inferring from round items
 */
export function preCalculatePositions(
  rounds: RoundData[],
  canvasSize: { width: number; height: number } = { width: 800, height: 800 },
  externalConnections?: ExternalConnection[]
): { nodes: ConstellationNode[], edges: ConstellationEdge[] } {
  const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }

  // Build nodes from rounds
  const nodes: ConstellationNode[] = []
  const nodeMap = new Map<string, ConstellationNode>()
  const legoTexts = new Map<string, string>()

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i]
    if (!round?.legoId || nodeMap.has(round.legoId)) continue

    const introItem = round.items?.find(item =>
      item.type === 'intro' || item.type === 'debut'
    )
    const targetText = introItem?.targetText || round.targetText || round.legoId
    const knownText = introItem?.knownText || round.knownText || ''

    legoTexts.set(round.legoId, targetText.toLowerCase())

    const node: ConstellationNode = {
      id: round.legoId,
      targetText,
      knownText,
      belt: getBeltForPosition(i),
      // Initial position will be set by D3
      x: center.x + (Math.random() - 0.5) * 200,
      y: center.y + (Math.random() - 0.5) * 200,
    }

    nodes.push(node)
    nodeMap.set(round.legoId, node)
  }

  // Build edges - either from external connections (database) or infer from items
  const edges: ConstellationEdge[] = []
  const edgeMap = new Map<string, ConstellationEdge>()
  let roundsWithItems = 0
  let phrasesChecked = 0

  if (externalConnections && externalConnections.length > 0) {
    // USE DATABASE CONNECTIONS (same as brain view)
    // Filter to only include edges where both nodes exist
    for (const conn of externalConnections) {
      if (!nodeMap.has(conn.source) || !nodeMap.has(conn.target)) continue

      const edgeId = `${conn.source}->${conn.target}`
      const edge: ConstellationEdge = {
        id: edgeId,
        source: conn.source,
        target: conn.target,
        strength: conn.count,
      }
      edges.push(edge)
      edgeMap.set(edgeId, edge)
    }

    console.log(`[PrebuiltNetwork] Using ${edges.length} edges from database (filtered from ${externalConnections.length} total)`)
  }

  // If no edges from database, try fallback inference
  if (edges.length === 0) {
    // FALLBACK: Infer edges from round items (less complete)
    for (let roundIdx = 0; roundIdx < rounds.length; roundIdx++) {
      const round = rounds[roundIdx]
      if (!round?.items) continue
      roundsWithItems++

      for (const item of round.items) {
        if (item.type === 'intro' || item.type === 'debut') continue

        const phraseText = item.targetText?.toLowerCase()
        if (!phraseText) continue
        phrasesChecked++

        // Find co-occurring LEGOs
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

        matchingLegos.sort((a, b) => a.position - b.position)

        // Create/strengthen edges
        for (let k = 0; k < matchingLegos.length - 1; k++) {
          const sourceId = matchingLegos[k].legoId
          const targetId = matchingLegos[k + 1].legoId
          const edgeId = `${sourceId}->${targetId}`

          if (sourceId === targetId) continue

          let edge = edgeMap.get(edgeId)
          if (edge) {
            edge.strength++
          } else {
            edge = { id: edgeId, source: sourceId, target: targetId, strength: 1 }
            edges.push(edge)
            edgeMap.set(edgeId, edge)
          }
        }
      }
    }

    console.log(`[PrebuiltNetwork] Fallback inference: ${edges.length} edges from ${phrasesChecked} phrases`)
  }

  // FINAL FALLBACK: If STILL no edges, create edges between consecutive rounds
  // This ensures some network structure even if phrase decomposition fails
  if (edges.length === 0 && nodes.length > 1) {
    console.log('[PrebuiltNetwork] Creating consecutive-round edges as final fallback')
    for (let i = 0; i < rounds.length - 1; i++) {
      const sourceId = rounds[i]?.legoId
      const targetId = rounds[i + 1]?.legoId
      if (sourceId && targetId && nodeMap.has(sourceId) && nodeMap.has(targetId)) {
        const edgeId = `${sourceId}->${targetId}`
        if (!edgeMap.has(edgeId)) {
          const edge: ConstellationEdge = { id: edgeId, source: sourceId, target: targetId, strength: 1 }
          edges.push(edge)
          edgeMap.set(edgeId, edge)
        }
      }
    }
    console.log(`[PrebuiltNetwork] Created ${edges.length} consecutive-round edges`)
  }

  // RESCUE ISOLATED NODES: Connect any nodes with NO edges to their neighbors
  // This is a backup - useLegoNetwork should already do this, but handles edge cases
  const connectedNodes = new Set<string>()
  for (const edge of edges) {
    const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as any)?.id
    const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as any)?.id
    if (sourceId) connectedNodes.add(sourceId)
    if (targetId) connectedNodes.add(targetId)
  }

  const isolatedNodes = nodes.filter(n => !connectedNodes.has(n.id))
  if (isolatedNodes.length > 0) {
    let edgesAdded = 0

    for (const isolatedNode of isolatedNodes) {
      const roundIdx = rounds.findIndex(r => r.legoId === isolatedNode.id)
      if (roundIdx < 0) continue

      // Connect to previous round if exists
      if (roundIdx > 0) {
        const prevLegoId = rounds[roundIdx - 1]?.legoId
        if (prevLegoId && nodeMap.has(prevLegoId)) {
          const edgeId = `${prevLegoId}->${isolatedNode.id}`
          if (!edgeMap.has(edgeId)) {
            edges.push({ id: edgeId, source: prevLegoId, target: isolatedNode.id, strength: 1 })
            edgeMap.set(edgeId, edges[edges.length - 1])
            edgesAdded++
          }
        }
      }

      // Connect to next round if exists
      if (roundIdx < rounds.length - 1) {
        const nextLegoId = rounds[roundIdx + 1]?.legoId
        if (nextLegoId && nodeMap.has(nextLegoId)) {
          const edgeId = `${isolatedNode.id}->${nextLegoId}`
          if (!edgeMap.has(edgeId)) {
            edges.push({ id: edgeId, source: isolatedNode.id, target: nextLegoId, strength: 1 })
            edgeMap.set(edgeId, edges[edges.length - 1])
            edgesAdded++
          }
        }
      }
    }

    if (edgesAdded > 0) {
      console.log(`[PrebuiltNetwork] Found ${isolatedNodes.length} isolated nodes, connecting to neighbors (+${edgesAdded} edges)`)
    }
  }

  // Run D3 force simulation to completion
  // Spread nodes out more so edges have room to display
  if (nodes.length > 0) {
    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(edges as any)
        .id((d: any) => d.id)
        .distance((d: any) => {
          const strength = (d as ConstellationEdge).strength || 1
          // Larger base distance for more spacing
          const baseDistance = 180
          const minDistance = 80
          const scaleFactor = 1 + Math.pow(strength, 0.4)
          return Math.max(minDistance, baseDistance / scaleFactor)
        })
        .strength((d: any) => {
          const strength = (d as ConstellationEdge).strength || 1
          return Math.min(1.0, 0.2 + Math.pow(strength, 0.3) * 0.15)
        })
      )
      // Stronger repulsion to spread nodes apart
      .force('charge', d3.forceManyBody().strength(-500).distanceMax(600))
      .force('center', d3.forceCenter(center.x, center.y))
      // Larger collision radius prevents overlap
      .force('collide', d3.forceCollide().radius(45).strength(0.9))
      .stop()

    // Run to completion (300 ticks is usually enough)
    for (let i = 0; i < 300; i++) {
      simulation.tick()
    }

    // Copy final positions to nodes
    nodes.forEach((node: any) => {
      node.x = node.x ?? center.x
      node.y = node.y ?? center.y
    })
  }

  // More detailed diagnostics
  // Note: D3 forceLink mutates edges, replacing string IDs with node object references
  const getNodeId = (ref: any): string => typeof ref === 'string' ? ref : ref?.id || '?'
  const edgeSource = externalConnections ? 'database' : 'items'
  const diagnostics = {
    totalRounds: rounds.length,
    edgeSource,
    externalConnectionsProvided: externalConnections?.length || 0,
    roundsWithItems,
    phrasesChecked,
    legoTextsCount: legoTexts.size,
    nodesCreated: nodes.length,
    edgesCreated: edges.length,
    sampleEdges: edges.slice(0, 5).map(e => `${getNodeId(e.source)} → ${getNodeId(e.target)} (strength: ${e.strength})`),
  }
  console.log(`[PrebuiltNetwork] Pre-calculated ${nodes.length} nodes, ${edges.length} edges (source: ${edgeSource})`)
  console.table(diagnostics)

  // Diagnose why no edges if that's the case
  if (edges.length === 0 && !externalConnections) {
    console.warn('[PrebuiltNetwork] No edges from items. Consider loading connections from database.')
  }

  return { nodes, edges }
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function usePrebuiltNetwork() {
  // Pre-calculated data (set once on load)
  const nodes: Ref<ConstellationNode[]> = ref([])
  const edges: Ref<ConstellationEdge[]> = ref([])

  // Runtime state
  const heroNodeId: Ref<string | null> = ref(null)
  const revealedNodeIds: Ref<Set<string>> = ref(new Set())
  const currentPath: Ref<PathHighlight | null> = ref(null)

  // Pan offset (to center on hero)
  const panOffset = ref({ x: 0, y: 0 })
  const networkCenter = ref({ x: 400, y: 400 })

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Load pre-calculated network from rounds
   * @param rounds - Learning script rounds
   * @param canvasSize - Canvas dimensions
   * @param externalConnections - Pre-loaded connections from database (optional)
   */
  function loadFromRounds(
    rounds: RoundData[],
    canvasSize?: { width: number; height: number },
    externalConnections?: ExternalConnection[]
  ): void {
    const result = preCalculatePositions(rounds, canvasSize, externalConnections)
    nodes.value = result.nodes
    edges.value = result.edges
    revealedNodeIds.value = new Set()
    heroNodeId.value = null
    currentPath.value = null

    if (canvasSize) {
      networkCenter.value = { x: canvasSize.width / 2, y: canvasSize.height / 2 }
    }
  }

  /**
   * Set center for pan calculations
   */
  function setCenter(x: number, y: number): void {
    networkCenter.value = { x, y }
    updatePanOffset()
  }

  // ============================================================================
  // LEARNING EVENTS
  // ============================================================================

  /**
   * Reveal a node (make it visible in the network)
   * Called when a LEGO is introduced
   */
  function revealNode(nodeId: string, makeHero: boolean = true): void {
    const node = nodes.value.find(n => n.id === nodeId)
    if (!node) {
      console.warn(`[PrebuiltNetwork] Node ${nodeId} not found in pre-calculated network`)
      return
    }

    revealedNodeIds.value.add(nodeId)

    if (makeHero) {
      heroNodeId.value = nodeId
      updatePanOffset()
    }

    console.log(`[PrebuiltNetwork] Revealed node: ${nodeId}, hero: ${makeHero}`)
  }

  /**
   * Reveal nodes up to a certain round (for resume)
   */
  function revealUpToRound(roundIndex: number, rounds: RoundData[]): void {
    for (let i = 0; i <= roundIndex && i < rounds.length; i++) {
      const legoId = rounds[i]?.legoId
      if (legoId) {
        revealedNodeIds.value.add(legoId)
      }
    }

    // Set hero to current round
    const heroId = rounds[roundIndex]?.legoId
    if (heroId) {
      heroNodeId.value = heroId
      updatePanOffset()
    }
  }

  /**
   * Update pan offset to center on hero
   */
  function updatePanOffset(): void {
    if (!heroNodeId.value) {
      panOffset.value = { x: 0, y: 0 }
      return
    }

    const heroNode = nodes.value.find(n => n.id === heroNodeId.value)
    if (!heroNode) {
      panOffset.value = { x: 0, y: 0 }
      return
    }

    // Calculate offset to center hero in view
    panOffset.value = {
      x: networkCenter.value.x - heroNode.x,
      y: networkCenter.value.y - heroNode.y,
    }
  }

  /**
   * Strengthen edge (Hebbian learning - fire together, wire together)
   * Creates edge if it doesn't exist - consecutive LEGOs in phrase = edge
   */
  function fireEdge(sourceId: string, targetId: string): void {
    // Only create edges between revealed nodes
    if (!revealedNodeIds.value.has(sourceId) || !revealedNodeIds.value.has(targetId)) {
      return
    }

    const edgeId = `${sourceId}->${targetId}`
    let edge = edges.value.find(e => e.id === edgeId)

    if (edge) {
      edge.strength++
    } else {
      // Create edge dynamically - "fire together, wire together"
      edge = { id: edgeId, source: sourceId, target: targetId, strength: 1 }
      edges.value.push(edge)
      console.log(`[PrebuiltNetwork] Created new edge: ${edgeId}`)
    }
  }

  /**
   * Fire a path (called when phrase is practiced)
   */
  function firePath(legoIds: string[]): void {
    for (let i = 0; i < legoIds.length - 1; i++) {
      fireEdge(legoIds[i], legoIds[i + 1])
    }
  }

  // ============================================================================
  // PATH HIGHLIGHTING
  // ============================================================================

  function setHighlightPath(legoIds: string[]): void {
    if (!legoIds || legoIds.length === 0) {
      currentPath.value = null
      return
    }

    const edgeIds: string[] = []
    for (let i = 0; i < legoIds.length - 1; i++) {
      edgeIds.push(`${legoIds[i]}->${legoIds[i + 1]}`)
    }

    currentPath.value = {
      nodeIds: [...legoIds],
      edgeIds,
      activeIndex: -1,
    }
  }

  function setPathActiveIndex(index: number): void {
    if (currentPath.value) {
      currentPath.value.activeIndex = index
    }
  }

  function clearHighlightPath(): void {
    currentPath.value = null
  }

  // ============================================================================
  // COMPUTED
  // ============================================================================

  // Only revealed nodes are visible
  const visibleNodes = computed(() =>
    nodes.value.filter(n => revealedNodeIds.value.has(n.id))
  )

  // Helper to extract ID from edge source/target
  // D3's forceLink mutates edges in place, replacing string IDs with node object references
  const getEdgeNodeId = (sourceOrTarget: string | { id: string }): string => {
    return typeof sourceOrTarget === 'string' ? sourceOrTarget : sourceOrTarget.id
  }

  // Only edges between revealed nodes are visible
  const visibleEdges = computed(() => {
    const visible = edges.value.filter(e => {
      const sourceId = getEdgeNodeId(e.source as string | { id: string })
      const targetId = getEdgeNodeId(e.target as string | { id: string })
      return revealedNodeIds.value.has(sourceId) && revealedNodeIds.value.has(targetId)
    })
    if (edges.value.length > 0 && visible.length === 0 && revealedNodeIds.value.size > 1) {
      console.log('[PrebuiltNetwork] WARNING: No visible edges!', {
        totalEdges: edges.value.length,
        revealedNodes: Array.from(revealedNodeIds.value).slice(0, 10),
        sampleEdges: edges.value.slice(0, 5).map(e => ({
          id: e.id,
          source: getEdgeNodeId(e.source as string | { id: string }),
          target: getEdgeNodeId(e.target as string | { id: string }),
          sourceRevealed: revealedNodeIds.value.has(getEdgeNodeId(e.source as string | { id: string })),
          targetRevealed: revealedNodeIds.value.has(getEdgeNodeId(e.target as string | { id: string })),
        }))
      })
    } else if (visible.length > 0) {
      console.log(`[PrebuiltNetwork] ${visible.length} edges visible of ${edges.value.length} total`)
    }
    return visible
  })

  // Hero node
  const heroNode = computed(() =>
    heroNodeId.value ? nodes.value.find(n => n.id === heroNodeId.value) : null
  )

  // Transform string for CSS
  const networkTransform = computed(() =>
    `translate(${panOffset.value.x}px, ${panOffset.value.y}px)`
  )

  // ============================================================================
  // RESET
  // ============================================================================

  function reset(): void {
    revealedNodeIds.value = new Set()
    heroNodeId.value = null
    currentPath.value = null
    panOffset.value = { x: 0, y: 0 }
  }

  function clear(): void {
    nodes.value = []
    edges.value = []
    reset()
  }

  // ============================================================================
  // EXPORT
  // ============================================================================

  return {
    // Data
    nodes,
    edges,
    visibleNodes,
    visibleEdges,

    // State
    heroNodeId,
    heroNode,
    revealedNodeIds,
    currentPath,
    panOffset,
    networkTransform,

    // Initialization
    loadFromRounds,
    setCenter,
    updatePanOffset,

    // Learning events
    revealNode,
    revealUpToRound,
    fireEdge,
    firePath,

    // Path highlighting
    setHighlightPath,
    setPathActiveIndex,
    clearHighlightPath,

    // Reset
    reset,
    clear,
  }
}
