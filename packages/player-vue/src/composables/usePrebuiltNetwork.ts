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

// Must match useBeltProgress.ts BELTS thresholds!
const BELT_THRESHOLDS = [
  { belt: 'black', threshold: 400 },
  { belt: 'brown', threshold: 280 },
  { belt: 'purple', threshold: 150 },
  { belt: 'blue', threshold: 80 },
  { belt: 'green', threshold: 40 },
  { belt: 'orange', threshold: 20 },
  { belt: 'yellow', threshold: 8 },
  { belt: 'white', threshold: 0 },
]

function getBeltForPosition(position: number): string {
  for (const { belt, threshold } of BELT_THRESHOLDS) {
    if (position >= threshold) return belt
  }
  return 'white'
}

// ============================================================================
// GROWING BRAIN BOUNDARIES
// ============================================================================

/**
 * Brain boundary shapes for each belt level.
 * The brain "grows" as you progress - from a small embryonic shape at white belt
 * to a full adult brain shape at black belt.
 *
 * Each shape is defined by:
 * - scale: Overall size multiplier (0.0 to 1.0)
 * - asymmetry: How asymmetric left vs right (0.0 = symmetric, 1.0 = full brain asymmetry)
 * - lobeDefinition: How pronounced the brain lobes are (0.0 = smooth, 1.0 = full lobes)
 */
export interface BrainBoundary {
  belt: string
  scale: number        // 0.3 (small) to 1.0 (full size)
  asymmetry: number    // 0 (symmetric) to 1 (brain-like asymmetry)
  lobeDefinition: number  // 0 (smooth oval) to 1 (defined lobes)
}

export const BRAIN_BOUNDARIES: BrainBoundary[] = [
  { belt: 'white',  scale: 0.30, asymmetry: 0.0, lobeDefinition: 0.0 },   // Seed/embryo - tiny circle
  { belt: 'yellow', scale: 0.40, asymmetry: 0.1, lobeDefinition: 0.1 },   // Early growth
  { belt: 'orange', scale: 0.50, asymmetry: 0.2, lobeDefinition: 0.2 },   // Taking shape
  { belt: 'green',  scale: 0.60, asymmetry: 0.3, lobeDefinition: 0.35 },  // Developing structure
  { belt: 'blue',   scale: 0.70, asymmetry: 0.5, lobeDefinition: 0.5 },   // Clear brain form
  { belt: 'purple', scale: 0.80, asymmetry: 0.65, lobeDefinition: 0.65 }, // Maturing
  { belt: 'brown',  scale: 0.90, asymmetry: 0.8, lobeDefinition: 0.8 },   // Nearly complete
  { belt: 'black',  scale: 1.00, asymmetry: 1.0, lobeDefinition: 1.0 },   // Full adult brain
]

/**
 * Get the brain boundary for a given belt level
 */
export function getBrainBoundary(belt: string): BrainBoundary {
  return BRAIN_BOUNDARIES.find(b => b.belt === belt) || BRAIN_BOUNDARIES[0]
}

/**
 * Get the brain boundary based on the highest belt reached (by node count)
 */
export function getBrainBoundaryForNodeCount(nodeCount: number): BrainBoundary {
  // Find the highest belt threshold that nodeCount exceeds
  for (let i = 0; i < BELT_THRESHOLDS.length; i++) {
    if (nodeCount >= BELT_THRESHOLDS[i].threshold) {
      return BRAIN_BOUNDARIES.find(b => b.belt === BELT_THRESHOLDS[i].belt) || BRAIN_BOUNDARIES[0]
    }
  }
  return BRAIN_BOUNDARIES[0] // White belt default
}

/**
 * Check if a point is inside the brain boundary.
 * Uses a parametric brain shape that evolves based on boundary parameters.
 *
 * The brain shape is a modified super-ellipse with:
 * - Overall scale based on belt level
 * - Left-right asymmetry (left side slightly larger, like real brains)
 * - Lobe indentations that become more pronounced at higher belts
 *
 * @param x - X coordinate (relative to center)
 * @param y - Y coordinate (relative to center)
 * @param boundary - Brain boundary parameters
 * @param maxRadius - Maximum radius of the full brain at scale 1.0
 */
export function isInsideBrainBoundary(
  x: number,
  y: number,
  boundary: BrainBoundary,
  maxRadius: number
): boolean {
  // Calculate the boundary radius at this angle
  const angle = Math.atan2(y, x)
  const boundaryRadius = getBrainRadiusAtAngle(angle, boundary, maxRadius)

  // Check if point is inside
  const distance = Math.sqrt(x * x + y * y)
  return distance <= boundaryRadius
}

/**
 * Get the brain boundary radius at a given angle.
 * This creates the brain shape with:
 * - Base ellipse (wider than tall)
 * - Asymmetry (left side larger)
 * - Lobe modulation (creates the characteristic brain curves)
 */
export function getBrainRadiusAtAngle(
  angle: number,
  boundary: BrainBoundary,
  maxRadius: number
): number {
  const { scale, asymmetry, lobeDefinition } = boundary

  // Base ellipse - wider than tall (brain is wider)
  const aspectRatio = 1.15  // Width/Height ratio
  const ellipseRadius = maxRadius / Math.sqrt(
    Math.pow(Math.cos(angle), 2) +
    Math.pow(Math.sin(angle) / aspectRatio, 2)
  )

  // Left-right asymmetry (left hemisphere slightly larger)
  // cos(angle) > 0 means right side, < 0 means left side
  const asymmetryFactor = 1 + asymmetry * 0.08 * (Math.cos(angle) < 0 ? 1 : -0.5)

  // Lobe modulation - creates the characteristic brain curves
  // Uses a combination of harmonics to create frontal/parietal/occipital/temporal regions
  const lobeWave =
    Math.sin(angle * 2) * 0.08 +  // Major lobe division
    Math.sin(angle * 3) * 0.04 +  // Secondary features
    Math.sin(angle * 5) * 0.02    // Fine detail
  const lobeModulation = 1 + lobeDefinition * lobeWave

  // Flatten the bottom slightly (brainstem area)
  const bottomFlattening = angle > 0.3 && angle < Math.PI - 0.3
    ? 1 - lobeDefinition * 0.05 * Math.sin(angle)
    : 1

  return ellipseRadius * scale * asymmetryFactor * lobeModulation * bottomFlattening
}

/**
 * Get points defining the brain boundary (for SVG rendering)
 * Returns an array of {x, y} points forming the brain outline
 */
export function getBrainBoundaryPath(
  boundary: BrainBoundary,
  maxRadius: number,
  center: { x: number; y: number },
  numPoints: number = 100
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2 - Math.PI  // Start from left (-π)
    const radius = getBrainRadiusAtAngle(angle, boundary, maxRadius)
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    })
  }

  return points
}

/**
 * Convert boundary points to SVG path data
 */
export function brainBoundaryToSvgPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''

  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`
  }
  path += ' Z'

  return path
}

/**
 * Custom D3 force that constrains nodes within the brain boundary.
 * Nodes outside the boundary are gently pushed back inside.
 */
export function forceBrainBoundary(
  center: { x: number; y: number },
  boundary: BrainBoundary,
  maxRadius: number,
  strength: number = 0.3
) {
  let nodes: any[] = []

  function force(alpha: number) {
    for (const node of nodes) {
      // Calculate position relative to center
      const dx = node.x - center.x
      const dy = node.y - center.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance === 0) continue

      // Get the boundary radius at this angle
      const angle = Math.atan2(dy, dx)
      const boundaryRadius = getBrainRadiusAtAngle(angle, boundary, maxRadius)

      // If outside boundary, push back inside
      if (distance > boundaryRadius) {
        const overflow = distance - boundaryRadius
        const pushStrength = strength * alpha * (1 + overflow / boundaryRadius)

        // Push toward center, proportional to overflow
        node.vx -= (dx / distance) * overflow * pushStrength
        node.vy -= (dy / distance) * overflow * pushStrength
      }

      // Also add a gentle inward force to keep nodes from clustering at the edge
      const edgeProximity = distance / boundaryRadius
      if (edgeProximity > 0.85) {
        const gentlePush = (edgeProximity - 0.85) * 0.15 * alpha * strength
        node.vx -= (dx / distance) * gentlePush * distance
        node.vy -= (dy / distance) * gentlePush * distance
      }
    }
  }

  force.initialize = function(_nodes: any[]) {
    nodes = _nodes
  }

  return force
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

// External node data from database (from useLegoNetwork)
export interface ExternalNode {
  id: string
  targetText: string
  knownText: string
  seedId?: string
  legoIndex?: number
  belt?: string
  isComponent?: boolean
  parentLegoIds?: string[]
}

/**
 * Pre-calculate all node positions by running D3 force simulation to completion
 * This is called ONCE when the script loads, not during learning
 *
 * @param rounds - The learning script rounds (used if externalNodes not provided)
 * @param canvasSize - Canvas dimensions for layout
 * @param externalConnections - Pre-loaded connections from database (optional)
 *                              If provided, uses these instead of inferring from round items
 * @param startOffset - The seed position where these rounds start (for correct belt colors)
 * @param currentBelt - The current belt level (determines brain boundary size)
 * @param externalNodes - Pre-loaded nodes from database (optional)
 *                        If provided, uses these as the node source instead of rounds
 *                        This ensures all LEGOs referenced in connections have nodes
 */
export function preCalculatePositions(
  rounds: RoundData[],
  canvasSize: { width: number; height: number } = { width: 800, height: 800 },
  externalConnections?: ExternalConnection[],
  startOffset: number = 0,
  currentBelt: string = 'black',  // Default to full brain for backwards compat
  externalNodes?: ExternalNode[]
): { nodes: ConstellationNode[], edges: ConstellationEdge[], brainBoundary: BrainBoundary } {
  const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }
  // Calculate max radius early - needed for initial node positioning
  const maxRadius = Math.min(canvasSize.width, canvasSize.height) * 0.42

  // ========== DIAGNOSTIC: Input summary ==========
  console.log(`%c[PrebuiltNetwork] ===== preCalculatePositions INPUT =====`, 'background: #333; color: #0f0; font-weight: bold')
  console.log(`  Rounds: ${rounds?.length || 0}`)
  console.log(`  Canvas: ${canvasSize.width}x${canvasSize.height}`)
  console.log(`  External connections: ${externalConnections?.length || 0}`)
  console.log(`  External nodes: ${externalNodes?.length || 0}`)
  console.log(`  Start offset: ${startOffset}, Belt: ${currentBelt}`)
  if (rounds?.length > 0) {
    console.log(`  First round:`, { legoId: rounds[0]?.legoId, hasItems: !!rounds[0]?.items?.length })
  }
  // ========== END DIAGNOSTIC ==========

  // Build nodes - prefer external nodes (from database) if provided
  // This ensures all LEGOs referenced in connections have corresponding nodes
  const nodes: ConstellationNode[] = []
  const nodeMap = new Map<string, ConstellationNode>()
  const legoTexts = new Map<string, string>()

  if (externalNodes && externalNodes.length > 0) {
    // Use database nodes - these include ALL LEGOs for the course
    console.log(`[PrebuiltNetwork] Using ${externalNodes.length} external nodes from database`)

    for (let i = 0; i < externalNodes.length; i++) {
      const extNode = externalNodes[i]
      if (!extNode?.id || nodeMap.has(extNode.id)) continue

      legoTexts.set(extNode.id, extNode.targetText?.toLowerCase() || '')

      // Use golden angle distribution for initial positions
      const goldenAngle = Math.PI * (3 - Math.sqrt(5)) // ~137.5 degrees
      const angle = i * goldenAngle
      const radius = Math.sqrt(i / Math.max(externalNodes.length, 1)) * maxRadius * 0.8

      const node: ConstellationNode = {
        id: extNode.id,
        targetText: extNode.targetText || extNode.id,
        knownText: extNode.knownText || '',
        belt: extNode.belt || getBeltForPosition(startOffset + i),
        x: center.x + Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
        y: center.y + Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
        isComponent: extNode.isComponent,
        parentLegoIds: extNode.parentLegoIds,
      }

      nodes.push(node)
      nodeMap.set(extNode.id, node)
    }
  } else {
    // Fallback: Build nodes from rounds (learning script)
    for (let i = 0; i < rounds.length; i++) {
      const round = rounds[i]
      if (!round?.legoId || nodeMap.has(round.legoId)) continue

      const introItem = round.items?.find(item =>
        item.type === 'intro' || item.type === 'debut'
      )
      const targetText = introItem?.targetText || round.targetText || round.legoId
      const knownText = introItem?.knownText || round.knownText || ''

      legoTexts.set(round.legoId, targetText.toLowerCase())

      // Use golden angle distribution for initial positions
      const goldenAngle = Math.PI * (3 - Math.sqrt(5)) // ~137.5 degrees
      const angle = i * goldenAngle
      const radius = Math.sqrt(i / Math.max(rounds.length, 1)) * maxRadius * 0.8

      const node: ConstellationNode = {
        id: round.legoId,
        targetText,
        knownText,
        belt: getBeltForPosition(startOffset + i),
        x: center.x + Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
        y: center.y + Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
      }

      nodes.push(node)
      nodeMap.set(round.legoId, node)
    }
  }

  console.log(`[PrebuiltNetwork] Built ${nodes.length} nodes`)

  // ============================================================================
  // INFERRED COMPONENT NODES
  // For M-type LEGOs (multi-word), create component nodes for individual words
  // This enriches the network by creating bridges between related phrases
  // ============================================================================

  const componentNodes = new Map<string, ConstellationNode>()  // word -> node
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
        // Create new component node - position near parent with small offset
        // Smaller offset than before to reduce chance of overlapping clusters
        const offsetAngle = Math.random() * Math.PI * 2
        const offsetRadius = 30 + Math.random() * 40
        componentNode = {
          id: componentId,
          targetText: word,
          knownText: '',  // Components don't have known text
          belt: node.belt,  // Inherit belt from first parent
          x: node.x + Math.cos(offsetAngle) * offsetRadius,
          y: node.y + Math.sin(offsetAngle) * offsetRadius,
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

  console.log(`[PrebuiltNetwork] Created ${componentArray.length} inferred component nodes from M-type LEGOs`)

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

  // Add component edges (from inferred components to their parent M-types)
  // These create bridges between phrases that share vocabulary
  for (const ce of componentEdges) {
    if (!edgeMap.has(ce.id)) {
      edges.push(ce)
      edgeMap.set(ce.id, ce)
    }
  }

  if (componentEdges.length > 0) {
    console.log(`[PrebuiltNetwork] Added ${componentEdges.length} component→M-type edges`)
  }

  // Get brain boundary for current belt
  const brainBoundary = getBrainBoundary(currentBelt)

  // Run D3 force simulation to completion with brain boundary constraint
  // The network is constrained within a growing brain shape
  if (nodes.length > 0) {
    // Calculate effective radius for this brain size
    const effectiveRadius = maxRadius * brainBoundary.scale

    // IMPORTANT: Do NOT scale forces by brain size!
    // The brain boundary constraint already keeps nodes within the smaller area.
    // If we also weaken repulsion, nodes cluster in the center.
    // Instead, use STRONGER repulsion for smaller brains to spread nodes within the limited space.
    const densityFactor = Math.max(1.0, 1.5 - brainBoundary.scale)  // More repulsion for smaller brains

    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(edges as any)
        .id((d: any) => d.id)
        .distance((d: any) => {
          const edge = d as ConstellationEdge
          const strength = edge.strength || 1
          // Component edges should be shorter to keep components close to parents
          const isComponentEdge = edge.source.toString().startsWith('_c_') ||
                                   (typeof edge.source === 'object' && (edge.source as any).id?.startsWith('_c_'))
          // Scale link distances to brain size so connected nodes stay proportionally close
          const baseDistance = isComponentEdge ? 40 : 80
          const minDistance = isComponentEdge ? 20 : 40
          const distanceScale = 1 + Math.pow(strength, 0.4)
          return Math.max(minDistance, baseDistance / distanceScale) * brainBoundary.scale
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
      // Strong repulsion to spread nodes apart - NOT scaled by brain size
      // Actually increase repulsion for smaller brains to prevent clustering
      .force('charge', d3.forceManyBody()
        .strength((d: any) => {
          const baseStrength = (d as ConstellationNode).isComponent ? -200 : -500
          return baseStrength * densityFactor  // More repulsion for smaller/denser brains
        })
        .distanceMax(effectiveRadius * 2))
      .force('center', d3.forceCenter(center.x, center.y))
      // Collision radius - keep constant so nodes don't overlap regardless of brain size
      .force('collide', d3.forceCollide()
        .radius((d: any) => {
          const baseRadius = (d as ConstellationNode).isComponent ? 15 : 30
          return baseRadius
        })
        .strength(0.95))
      // BRAIN BOUNDARY CONSTRAINT - keeps nodes inside the growing brain shape
      // Use stronger boundary force to contain nodes firmly
      .force('brainBoundary', forceBrainBoundary(center, brainBoundary, maxRadius, 0.8))
      .stop()

    // Run to completion (500 ticks for better convergence with stronger forces)
    for (let i = 0; i < 500; i++) {
      simulation.tick()
    }

    // Copy final positions to nodes, with NaN guards
    let nanCount = 0
    nodes.forEach((node: any, idx: number) => {
      // Guard against NaN from numerical instability in large networks
      if (isNaN(node.x) || isNaN(node.y)) {
        nanCount++
        // Fall back to golden spiral position
        const goldenAngle = Math.PI * (3 - Math.sqrt(5))
        const angle = idx * goldenAngle
        const radius = Math.sqrt(idx / nodes.length) * maxRadius * 0.8
        node.x = center.x + Math.cos(angle) * radius
        node.y = center.y + Math.sin(angle) * radius
      }
      node.x = node.x ?? center.x
      node.y = node.y ?? center.y
    })

    if (nanCount > 0) {
      console.warn(`%c[PrebuiltNetwork] ⚠️ Fixed ${nanCount} NaN positions (numerical instability)`, 'background: #f80; color: #000; font-weight: bold')
    }

    // Diagnose position spread
    if (nodes.length > 0) {
      const xs = nodes.map(n => n.x)
      const ys = nodes.map(n => n.y)
      const xRange = { min: Math.round(Math.min(...xs)), max: Math.round(Math.max(...xs)) }
      const yRange = { min: Math.round(Math.min(...ys)), max: Math.round(Math.max(...ys)) }
      console.log(`[PrebuiltNetwork] Position ranges - X: ${xRange.min}-${xRange.max}, Y: ${yRange.min}-${yRange.max}`)
      console.log(`[PrebuiltNetwork] Sample positions:`, nodes.slice(0, 5).map(n => ({ id: n.id.slice(-8), x: Math.round(n.x), y: Math.round(n.y) })))
    }

    console.log(`[PrebuiltNetwork] Brain boundary: ${currentBelt} belt (scale: ${brainBoundary.scale}, asymmetry: ${brainBoundary.asymmetry})`)
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
  console.log(`%c[PrebuiltNetwork] ===== preCalculatePositions OUTPUT =====`, 'background: #333; color: #0f0; font-weight: bold')
  console.log(`  Nodes: ${nodes.length}, Edges: ${edges.length}`)
  console.table(diagnostics)

  // Diagnose why no edges if that's the case
  if (edges.length === 0 && !externalConnections) {
    console.warn('[PrebuiltNetwork] No edges from items. Consider loading connections from database.')
  }

  if (edges.length === 0) {
    console.warn(`%c[PrebuiltNetwork] ⚠️ NO EDGES - network will have no connections!`, 'background: #f00; color: #fff; font-weight: bold')
  }

  return { nodes, edges, brainBoundary }
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function usePrebuiltNetwork() {
  // Pre-calculated data (set once on load)
  const nodes: Ref<ConstellationNode[]> = ref([])
  const edges: Ref<ConstellationEdge[]> = ref([])

  // Brain boundary state (grows with belt level)
  const brainBoundary: Ref<BrainBoundary> = ref(BRAIN_BOUNDARIES[0])  // Default to white belt
  const maxBrainRadius: Ref<number> = ref(350)  // Will be set based on canvas size

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
   * @param rounds - Learning script rounds (used if externalNodes not provided)
   * @param canvasSize - Canvas dimensions
   * @param externalConnections - Pre-loaded connections from database (optional)
   * @param startOffset - The seed position where these rounds start (for correct belt colors)
   * @param currentBelt - Current belt level (determines brain boundary size)
   * @param externalNodes - Pre-loaded nodes from database (optional)
   *                        If provided, uses these as the node source instead of rounds
   */
  function loadFromRounds(
    rounds: RoundData[],
    canvasSize?: { width: number; height: number },
    externalConnections?: ExternalConnection[],
    startOffset: number = 0,
    currentBelt: string = 'black',  // Default to full brain for backwards compat
    externalNodes?: ExternalNode[]
  ): void {
    const result = preCalculatePositions(rounds, canvasSize, externalConnections, startOffset, currentBelt, externalNodes)
    nodes.value = result.nodes
    edges.value = result.edges
    brainBoundary.value = result.brainBoundary
    revealedNodeIds.value = new Set()
    heroNodeId.value = null
    currentPath.value = null

    if (canvasSize) {
      networkCenter.value = { x: canvasSize.width / 2, y: canvasSize.height / 2 }
      maxBrainRadius.value = Math.min(canvasSize.width, canvasSize.height) * 0.42
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

    // Create new Set to trigger Vue reactivity (Set.add() doesn't trigger reactive updates)
    revealedNodeIds.value = new Set([...revealedNodeIds.value, nodeId])

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
    // Build new Set to trigger Vue reactivity (Set mutations don't trigger reactive updates)
    const newSet = new Set(revealedNodeIds.value)
    for (let i = 0; i <= roundIndex && i < rounds.length; i++) {
      const legoId = rounds[i]?.legoId
      if (legoId) {
        newSet.add(legoId)
      }
    }
    revealedNodeIds.value = newSet  // Assign new Set to trigger reactivity

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
  // Component nodes are auto-revealed when any of their parent LEGOs are revealed
  const visibleNodes = computed(() =>
    nodes.value.filter(n => {
      // Regular nodes: check if explicitly revealed
      if (!n.isComponent) {
        return revealedNodeIds.value.has(n.id)
      }
      // Component nodes: revealed if ANY parent is revealed
      if (n.parentLegoIds && n.parentLegoIds.length > 0) {
        return n.parentLegoIds.some(parentId => revealedNodeIds.value.has(parentId))
      }
      return false
    })
  )

  // Helper to extract ID from edge source/target
  // D3's forceLink mutates edges in place, replacing string IDs with node object references
  const getEdgeNodeId = (sourceOrTarget: string | { id: string }): string => {
    return typeof sourceOrTarget === 'string' ? sourceOrTarget : sourceOrTarget.id
  }

  // Helper to check if a node (by ID) should be visible
  const isNodeVisible = (nodeId: string): boolean => {
    // Regular nodes
    if (revealedNodeIds.value.has(nodeId)) return true
    // Component nodes - check if any parent is revealed
    const node = nodes.value.find(n => n.id === nodeId)
    if (node?.isComponent && node.parentLegoIds) {
      return node.parentLegoIds.some(parentId => revealedNodeIds.value.has(parentId))
    }
    return false
  }

  // Only edges between revealed nodes are visible
  const visibleEdges = computed(() => {
    const visible = edges.value.filter(e => {
      const sourceId = getEdgeNodeId(e.source as string | { id: string })
      const targetId = getEdgeNodeId(e.target as string | { id: string })
      return isNodeVisible(sourceId) && isNodeVisible(targetId)
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

  /**
   * Load a minimal constellation for just the current phrase
   * Much lighter than full network - only shows hero + phrase LEGOs
   *
   * @param heroId - The main LEGO being learned
   * @param heroData - { target, known, belt } for the hero
   * @param phraseLegoIds - LEGO IDs that appear in the practice phrases
   * @param legoDataMap - Map of LEGO ID to { target, known } for phrase LEGOs
   * @param canvasSize - Canvas dimensions
   */
  function loadMinimalConstellation(
    heroId: string,
    heroData: { target: string; known: string; belt: string },
    phraseLegoIds: string[],
    legoDataMap: Map<string, { target: string; known: string }>,
    canvasSize: { width: number; height: number } = { width: 800, height: 800 }
  ): void {
    const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 }
    const radius = Math.min(canvasSize.width, canvasSize.height) * 0.25  // Smaller radius for minimal view

    // Collect unique LEGOs (hero + phrase LEGOs, deduplicated)
    const uniqueIds = new Set([heroId, ...phraseLegoIds])
    const legoList = Array.from(uniqueIds)

    // Create nodes - hero in center, others in a circle around it
    const newNodes: ConstellationNode[] = []
    const heroIndex = legoList.indexOf(heroId)

    legoList.forEach((id, i) => {
      const isHero = id === heroId
      let x: number, y: number

      if (isHero) {
        // Hero in center
        x = center.x
        y = center.y
      } else {
        // Others arranged in a circle
        const otherIndex = i > heroIndex ? i - 1 : i
        const totalOthers = legoList.length - 1
        const angle = (otherIndex / Math.max(totalOthers, 1)) * Math.PI * 2 - Math.PI / 2
        x = center.x + Math.cos(angle) * radius
        y = center.y + Math.sin(angle) * radius
      }

      // Get data for this node
      const data = id === heroId
        ? heroData
        : legoDataMap.get(id) || { target: id, known: '' }

      newNodes.push({
        id,
        x,
        y,
        targetText: data.target,
        knownText: data.known || '',
        belt: isHero ? heroData.belt : 'white',  // Hero has belt color, others are white
        isComponent: false,
      })
    })

    // Create edges between hero and each phrase LEGO
    const newEdges: ConstellationEdge[] = []
    phraseLegoIds.forEach(phraseId => {
      if (phraseId !== heroId) {
        const edgeId = `${heroId}->${phraseId}`
        newEdges.push({
          id: edgeId,
          source: heroId,
          target: phraseId,
          strength: 5,  // Medium strength for visual
        })
      }
    })

    // Set the data
    nodes.value = newNodes
    edges.value = newEdges
    networkCenter.value = center
    maxBrainRadius.value = radius * 1.5

    // Reveal all nodes and set hero
    revealedNodeIds.value = new Set(legoList)
    heroNodeId.value = heroId
    updatePanOffset()

    console.log(`[PrebuiltNetwork] Loaded minimal constellation: hero=${heroId}, ${newNodes.length} nodes, ${newEdges.length} edges`)
  }

  // ============================================================================
  // EXPORT
  // ============================================================================

  // Computed brain boundary path for SVG rendering
  const brainBoundaryPath = computed(() => {
    return getBrainBoundaryPath(
      brainBoundary.value,
      maxBrainRadius.value,
      networkCenter.value
    )
  })

  const brainBoundarySvgPath = computed(() => {
    return brainBoundaryToSvgPath(brainBoundaryPath.value)
  })

  return {
    // Data
    nodes,
    edges,
    visibleNodes,
    visibleEdges,

    // Brain boundary (grows with belt level)
    brainBoundary,
    maxBrainRadius,
    brainBoundaryPath,
    brainBoundarySvgPath,
    networkCenter,

    // State
    heroNodeId,
    heroNode,
    revealedNodeIds,
    currentPath,
    panOffset,
    networkTransform,

    // Initialization
    loadFromRounds,
    loadMinimalConstellation,
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
