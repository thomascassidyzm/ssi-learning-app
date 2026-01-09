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
  } else {
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
  }

  // Run D3 force simulation to completion
  if (nodes.length > 0) {
    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(edges as any)
        .id((d: any) => d.id)
        .distance((d: any) => {
          const strength = (d as ConstellationEdge).strength || 1
          const baseDistance = 120
          const minDistance = 40
          const scaleFactor = 1 + Math.pow(strength, 0.6)
          return Math.max(minDistance, baseDistance / scaleFactor)
        })
        .strength((d: any) => {
          const strength = (d as ConstellationEdge).strength || 1
          return Math.min(1.5, 0.3 + Math.pow(strength, 0.3) * 0.2)
        })
      )
      .force('charge', d3.forceManyBody().strength(-300).distanceMax(500))
      .force('center', d3.forceCenter(center.x, center.y))
      .force('collide', d3.forceCollide().radius(25).strength(0.8))
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
    sampleEdges: edges.slice(0, 5).map(e => `${e.source} → ${e.target} (strength: ${e.strength})`),
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
   */
  function fireEdge(sourceId: string, targetId: string): void {
    const edgeId = `${sourceId}->${targetId}`
    const edge = edges.value.find(e => e.id === edgeId)
    if (edge) {
      edge.strength++
    }
    // Note: We don't add new edges at runtime - network structure is fixed
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

  // Only edges between revealed nodes are visible
  const visibleEdges = computed(() => {
    const visible = edges.value.filter(e =>
      revealedNodeIds.value.has(e.source) &&
      revealedNodeIds.value.has(e.target)
    )
    if (edges.value.length > 0 && visible.length === 0 && revealedNodeIds.value.size > 1) {
      console.log('[PrebuiltNetwork] WARNING: No visible edges!', {
        totalEdges: edges.value.length,
        revealedNodes: Array.from(revealedNodeIds.value).slice(0, 10),
        sampleEdges: edges.value.slice(0, 5).map(e => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceRevealed: revealedNodeIds.value.has(e.source),
          targetRevealed: revealedNodeIds.value.has(e.target),
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
