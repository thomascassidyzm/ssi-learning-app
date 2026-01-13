/**
 * Network Engine - Constellation/Brain Network Calculation
 *
 * Framework-agnostic network calculation for visualizing LEGO connections.
 * Used by both the learning player (visualization) and dashboard (course creation).
 *
 * The network represents how LEGOs connect through phrases:
 * - Nodes = LEGOs (vocabulary items)
 * - Edges = Connections (LEGOs used together in phrases)
 * - Positions = Calculated via D3 force simulation (stable layout)
 *
 * Key features:
 * - Pre-calculates all positions upfront (no runtime physics)
 * - Infers component nodes from M-type LEGOs (multi-word phrases)
 * - Supports external connections from database OR infers from round items
 * - Belt colors based on introduction position
 */

// Note: d3 is a peer dependency - must be installed in consuming package
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
  source: string | ConstellationNode
  target: string | ConstellationNode
  strength: number
}

export interface PathHighlight {
  nodeIds: string[]
  edgeIds: string[]
  activeIndex: number
}

export interface RoundData {
  legoId: string
  targetText?: string
  knownText?: string
  items?: Array<{ type: string; targetText?: string; knownText?: string }>
}

export interface ExternalConnection {
  source: string
  target: string
  count: number
}

export interface NetworkCalculationResult {
  nodes: ConstellationNode[]
  edges: ConstellationEdge[]
}

export interface CanvasSize {
  width: number
  height: number
}

// ============================================================================
// BELT THRESHOLDS
// ============================================================================

export const BELT_THRESHOLDS = [
  { belt: 'black', threshold: 400 },
  { belt: 'brown', threshold: 280 },
  { belt: 'purple', threshold: 150 },
  { belt: 'blue', threshold: 80 },
  { belt: 'green', threshold: 40 },
  { belt: 'orange', threshold: 20 },
  { belt: 'yellow', threshold: 8 },
  { belt: 'white', threshold: 0 },
] as const

export function getBeltForPosition(position: number): string {
  for (const { belt, threshold } of BELT_THRESHOLDS) {
    if (position >= threshold) return belt
  }
  return 'white'
}

// ============================================================================
// NETWORK CALCULATION
// ============================================================================

/**
 * Pre-calculate all node positions by running D3 force simulation to completion.
 * This is the core engine function - call ONCE per network, not during learning.
 *
 * @param rounds - The learning script rounds (LEGOs to include)
 * @param canvasSize - Canvas dimensions for layout (default 800x800)
 * @param externalConnections - Pre-loaded connections from database (optional)
 *                              If provided, uses these instead of inferring from round items
 * @param startOffset - The seed position where these rounds start (for correct belt colors)
 * @returns Object with nodes and edges arrays, positions calculated
 */
export function calculateNetworkPositions(
  rounds: RoundData[],
  canvasSize: CanvasSize = { width: 800, height: 800 },
  externalConnections?: ExternalConnection[],
  startOffset: number = 0
): NetworkCalculationResult {
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
      belt: getBeltForPosition(startOffset + i),
      // Initial position will be set by D3
      x: center.x + (Math.random() - 0.5) * 200,
      y: center.y + (Math.random() - 0.5) * 200,
    }

    nodes.push(node)
    nodeMap.set(round.legoId, node)
  }

  // ============================================================================
  // INFERRED COMPONENT NODES
  // For M-type LEGOs (multi-word), create component nodes for individual words
  // This enriches the network by creating bridges between related phrases
  // ============================================================================

  const componentNodes = new Map<string, ConstellationNode>()
  const componentEdges: ConstellationEdge[] = []

  for (const node of nodes) {
    const words = node.targetText.trim().split(/\s+/)

    // Only process M-type LEGOs (more than one word)
    if (words.length <= 1) continue

    for (const word of words) {
      const wordLower = word.toLowerCase()
      // Skip very short words (articles, particles) - they add noise
      if (wordLower.length < 2) continue

      const componentId = `_c_${wordLower}`  // Prefix to distinguish from real LEGOs

      let componentNode = componentNodes.get(wordLower)

      if (!componentNode) {
        // Create new component node
        componentNode = {
          id: componentId,
          targetText: word,
          knownText: '',  // Components don't have known text
          belt: node.belt,  // Inherit belt from first parent
          x: node.x + (Math.random() - 0.5) * 100,  // Near parent
          y: node.y + (Math.random() - 0.5) * 100,
          isComponent: true,
          parentLegoIds: [node.id],
        }
        componentNodes.set(wordLower, componentNode)
      } else {
        // Add this LEGO as another parent
        componentNode.parentLegoIds = componentNode.parentLegoIds || []
        if (!componentNode.parentLegoIds.includes(node.id)) {
          componentNode.parentLegoIds.push(node.id)
        }
      }

      // Create edge from component to parent M-type
      const edgeId = `${componentId}->${node.id}`
      componentEdges.push({
        id: edgeId,
        source: componentId,
        target: node.id,
        strength: 1,
      })
    }
  }

  // Add component nodes to the main nodes array
  const componentArray = Array.from(componentNodes.values())
  nodes.push(...componentArray)
  for (const cn of componentArray) {
    nodeMap.set(cn.id, cn)
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
  }

  // FINAL FALLBACK: If STILL no edges, create edges between consecutive rounds
  if (edges.length === 0 && nodes.length > 1) {
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
  }

  // RESCUE ISOLATED NODES: Connect any nodes with NO edges to their neighbors
  const connectedNodes = new Set<string>()
  for (const edge of edges) {
    const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as any)?.id
    const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as any)?.id
    if (sourceId) connectedNodes.add(sourceId)
    if (targetId) connectedNodes.add(targetId)
  }

  const isolatedNodes = nodes.filter(n => !connectedNodes.has(n.id))
  if (isolatedNodes.length > 0) {
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
          }
        }
      }
    }
  }

  // Add component edges (from inferred components to their parent M-types)
  for (const ce of componentEdges) {
    if (!edgeMap.has(ce.id)) {
      edges.push(ce)
      edgeMap.set(ce.id, ce)
    }
  }

  // Run D3 force simulation to completion
  if (nodes.length > 0) {
    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(edges as any)
        .id((d: any) => d.id)
        .distance((d: any) => {
          const edge = d as ConstellationEdge
          const strength = edge.strength || 1
          // Component edges should be shorter to keep components close to parents
          const isComponentEdge = edge.source.toString().startsWith('_c_') ||
                                   (typeof edge.source === 'object' && (edge.source as any).id?.startsWith('_c_'))
          const baseDistance = isComponentEdge ? 80 : 180
          const minDistance = isComponentEdge ? 40 : 80
          const scaleFactor = 1 + Math.pow(strength, 0.4)
          return Math.max(minDistance, baseDistance / scaleFactor)
        })
        .strength((d: any) => {
          const edge = d as ConstellationEdge
          const strength = edge.strength || 1
          // Stronger pull for component edges to keep them close
          const isComponentEdge = edge.source.toString().startsWith('_c_') ||
                                   (typeof edge.source === 'object' && (edge.source as any).id?.startsWith('_c_'))
          return isComponentEdge ? 0.8 : Math.min(1.0, 0.2 + Math.pow(strength, 0.3) * 0.15)
        })
      )
      // Stronger repulsion to spread nodes apart (less for components)
      .force('charge', d3.forceManyBody()
        .strength((d: any) => (d as ConstellationNode).isComponent ? -200 : -500)
        .distanceMax(600))
      .force('center', d3.forceCenter(center.x, center.y))
      // Smaller collision radius for component nodes
      .force('collide', d3.forceCollide()
        .radius((d: any) => (d as ConstellationNode).isComponent ? 25 : 45)
        .strength(0.9))
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

  return { nodes, edges }
}

// ============================================================================
// INCREMENTAL NETWORK BUILDING (for course creation)
// ============================================================================

/**
 * Network Builder - incrementally build a network by adding LEGOs one by one.
 * Useful for course creation where you want to see the network evolve.
 */
export class NetworkBuilder {
  private nodes: ConstellationNode[] = []
  private edges: ConstellationEdge[] = []
  private nodeMap = new Map<string, ConstellationNode>()
  private edgeMap = new Map<string, ConstellationEdge>()
  private canvasSize: CanvasSize

  constructor(canvasSize: CanvasSize = { width: 800, height: 800 }) {
    this.canvasSize = canvasSize
  }

  /**
   * Add a LEGO to the network
   * @returns The created node
   */
  addLego(legoId: string, targetText: string, knownText: string = ''): ConstellationNode {
    if (this.nodeMap.has(legoId)) {
      return this.nodeMap.get(legoId)!
    }

    const center = { x: this.canvasSize.width / 2, y: this.canvasSize.height / 2 }
    const position = this.nodes.length

    const node: ConstellationNode = {
      id: legoId,
      targetText,
      knownText,
      belt: getBeltForPosition(position),
      x: center.x + (Math.random() - 0.5) * 200,
      y: center.y + (Math.random() - 0.5) * 200,
    }

    this.nodes.push(node)
    this.nodeMap.set(legoId, node)

    return node
  }

  /**
   * Connect LEGOs to form a phrase (creates/strengthens edges)
   * @param legoIds - Array of LEGO IDs in phrase order
   * @returns Created/strengthened edges
   */
  connectPhrase(legoIds: string[]): ConstellationEdge[] {
    const affectedEdges: ConstellationEdge[] = []

    for (let i = 0; i < legoIds.length - 1; i++) {
      const sourceId = legoIds[i]
      const targetId = legoIds[i + 1]

      if (!this.nodeMap.has(sourceId) || !this.nodeMap.has(targetId)) continue
      if (sourceId === targetId) continue

      const edgeId = `${sourceId}->${targetId}`
      let edge = this.edgeMap.get(edgeId)

      if (edge) {
        edge.strength++
      } else {
        edge = { id: edgeId, source: sourceId, target: targetId, strength: 1 }
        this.edges.push(edge)
        this.edgeMap.set(edgeId, edge)
      }

      affectedEdges.push(edge)
    }

    return affectedEdges
  }

  /**
   * Remove a LEGO from the network
   */
  removeLego(legoId: string): boolean {
    const node = this.nodeMap.get(legoId)
    if (!node) return false

    // Remove node
    this.nodes = this.nodes.filter(n => n.id !== legoId)
    this.nodeMap.delete(legoId)

    // Remove edges involving this node
    this.edges = this.edges.filter(e => {
      const sourceId = typeof e.source === 'string' ? e.source : (e.source as any).id
      const targetId = typeof e.target === 'string' ? e.target : (e.target as any).id
      const shouldKeep = sourceId !== legoId && targetId !== legoId
      if (!shouldKeep) {
        this.edgeMap.delete(e.id)
      }
      return shouldKeep
    })

    return true
  }

  /**
   * Recalculate all positions using D3 force simulation
   */
  recalculatePositions(): NetworkCalculationResult {
    if (this.nodes.length === 0) {
      return { nodes: [], edges: [] }
    }

    const center = { x: this.canvasSize.width / 2, y: this.canvasSize.height / 2 }

    const simulation = d3.forceSimulation(this.nodes as any)
      .force('link', d3.forceLink(this.edges as any)
        .id((d: any) => d.id)
        .distance(150)
        .strength(0.5)
      )
      .force('charge', d3.forceManyBody().strength(-400).distanceMax(500))
      .force('center', d3.forceCenter(center.x, center.y))
      .force('collide', d3.forceCollide().radius(40).strength(0.8))
      .stop()

    // Run to completion
    for (let i = 0; i < 300; i++) {
      simulation.tick()
    }

    // Ensure positions are numbers
    this.nodes.forEach((node: any) => {
      node.x = node.x ?? center.x
      node.y = node.y ?? center.y
    })

    return { nodes: [...this.nodes], edges: [...this.edges] }
  }

  /**
   * Get current network state (without recalculating)
   */
  getState(): NetworkCalculationResult {
    return { nodes: [...this.nodes], edges: [...this.edges] }
  }

  /**
   * Get a node by ID
   */
  getNode(legoId: string): ConstellationNode | undefined {
    return this.nodeMap.get(legoId)
  }

  /**
   * Get edges for a specific node
   */
  getNodeEdges(legoId: string): ConstellationEdge[] {
    return this.edges.filter(e => {
      const sourceId = typeof e.source === 'string' ? e.source : (e.source as any).id
      const targetId = typeof e.target === 'string' ? e.target : (e.target as any).id
      return sourceId === legoId || targetId === legoId
    })
  }

  /**
   * Find isolated nodes (nodes with no connections)
   */
  getIsolatedNodes(): ConstellationNode[] {
    const connectedIds = new Set<string>()
    for (const edge of this.edges) {
      const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as any).id
      const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as any).id
      connectedIds.add(sourceId)
      connectedIds.add(targetId)
    }
    return this.nodes.filter(n => !connectedIds.has(n.id))
  }

  /**
   * Get network statistics
   */
  getStats(): {
    nodeCount: number
    edgeCount: number
    isolatedCount: number
    avgEdgeStrength: number
    maxEdgeStrength: number
  } {
    const isolated = this.getIsolatedNodes()
    const totalStrength = this.edges.reduce((sum, e) => sum + e.strength, 0)
    const maxStrength = this.edges.length > 0
      ? Math.max(...this.edges.map(e => e.strength))
      : 0

    return {
      nodeCount: this.nodes.length,
      edgeCount: this.edges.length,
      isolatedCount: isolated.length,
      avgEdgeStrength: this.edges.length > 0 ? totalStrength / this.edges.length : 0,
      maxEdgeStrength: maxStrength,
    }
  }

  /**
   * Clear the network
   */
  clear(): void {
    this.nodes = []
    this.edges = []
    this.nodeMap.clear()
    this.edgeMap.clear()
  }

  /**
   * Import from existing network data
   */
  import(data: NetworkCalculationResult): void {
    this.clear()
    for (const node of data.nodes) {
      this.nodes.push({ ...node })
      this.nodeMap.set(node.id, this.nodes[this.nodes.length - 1])
    }
    for (const edge of data.edges) {
      const edgeCopy = { ...edge }
      this.edges.push(edgeCopy)
      this.edgeMap.set(edge.id, edgeCopy)
    }
  }

  /**
   * Export to JSON (for saving to database)
   */
  export(): {
    nodes: Array<{ id: string; targetText: string; knownText: string; belt: string; x: number; y: number }>
    edges: Array<{ source: string; target: string; strength: number }>
  } {
    return {
      nodes: this.nodes.map(n => ({
        id: n.id,
        targetText: n.targetText,
        knownText: n.knownText,
        belt: n.belt,
        x: n.x,
        y: n.y,
      })),
      edges: this.edges.map(e => ({
        source: typeof e.source === 'string' ? e.source : (e.source as any).id,
        target: typeof e.target === 'string' ? e.target : (e.target as any).id,
        strength: e.strength,
      })),
    }
  }
}
