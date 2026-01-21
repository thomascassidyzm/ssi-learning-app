/**
 * useBrainEdges - Three.js Line System for Brain Network Edges
 *
 * Renders connections between nodes in a 3D brain visualization.
 * Edges represent connections between words that appear together in phrases.
 *
 * Performance optimizations:
 * - Uses THREE.LineSegments with BufferGeometry for batch rendering
 * - Indexed geometry to minimize vertex data
 * - Batched updates (not per-frame unless needed)
 * - LOD: can hide edges when zoomed out far
 *
 * Visual style:
 * - Subtle but visible by default (opacity ~0.2-0.35)
 * - Slightly brighter for stronger connections
 * - Color: subtle white/gray, or tinted by connected node colors
 */

import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'

// ============================================================================
// TYPES
// ============================================================================

export interface BrainEdge {
  id: string
  source: string  // node ID
  target: string  // node ID
  strength: number  // how often these words appear together (1-100)
}

export interface EdgeColors {
  default: THREE.Color
  highlighted: THREE.Color
  glowPath: THREE.Color
}

export interface EdgeRenderOptions {
  /** Base opacity for normal edges (default: 0.20) */
  baseOpacity?: number
  /** Maximum opacity for strong connections (default: 0.35) */
  maxOpacity?: number
  /** Base line width (default: 1) */
  baseWidth?: number
  /** Maximum line width for strong connections (default: 2) */
  maxWidth?: number
  /** Opacity for highlighted edges (default: 0.8) */
  highlightOpacity?: number
  /** Opacity for glow path edges (default: 1.0) */
  glowOpacity?: number
}

interface EdgeData {
  edge: BrainEdge
  sourceIndex: number  // Index into positions array
  targetIndex: number  // Index into positions array
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_OPTIONS: Required<EdgeRenderOptions> = {
  baseOpacity: 0.5,    // Neural connections should be clearly visible
  maxOpacity: 0.85,    // Strong connections are prominent
  baseWidth: 1.5,      // Visible line width
  maxWidth: 4,         // Strong connections are thicker
  highlightOpacity: 1.0,
  glowOpacity: 1.0,
}

const DEFAULT_COLORS: EdgeColors = {
  default: new THREE.Color(0xffffff),
  highlighted: new THREE.Color(0x60a5fa),  // Blue highlight
  glowPath: new THREE.Color(0xfbbf24),      // Warm yellow/gold for fire path
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate edge opacity based on connection strength
 * Stronger connections (higher strength) are more visible
 */
function calculateOpacity(strength: number, options: Required<EdgeRenderOptions>): number {
  // Normalize strength (1-100) to opacity range
  const normalizedStrength = Math.min(100, Math.max(1, strength)) / 100
  // Use sqrt for more gradual opacity increase
  const opacityRange = options.maxOpacity - options.baseOpacity
  return options.baseOpacity + Math.sqrt(normalizedStrength) * opacityRange
}

/**
 * Calculate line width based on connection strength
 */
function calculateWidth(strength: number, options: Required<EdgeRenderOptions>): number {
  const normalizedStrength = Math.min(100, Math.max(1, strength)) / 100
  const widthRange = options.maxWidth - options.baseWidth
  return options.baseWidth + Math.sqrt(normalizedStrength) * widthRange
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useBrainEdges(options: EdgeRenderOptions = {}) {
  const opts: Required<EdgeRenderOptions> = { ...DEFAULT_OPTIONS, ...options }
  const colors: EdgeColors = { ...DEFAULT_COLORS }

  // ============================================================================
  // STATE
  // ============================================================================

  // The main LineSegments object containing all edges
  const lineSegments: ShallowRef<THREE.LineSegments | null> = shallowRef(null)

  // Edge data storage for lookups
  const edgeDataMap: Ref<Map<string, EdgeData>> = ref(new Map())

  // Current edges (stored for position updates)
  const currentEdges: Ref<BrainEdge[]> = ref([])

  // Highlighted edge IDs
  const highlightedEdgeIds: Ref<Set<string>> = ref(new Set())

  // Glow path edge IDs with intensity
  const glowEdgeIntensities: Ref<Map<string, number>> = ref(new Map())

  // Visibility flag
  const isVisible: Ref<boolean> = ref(true)

  // ============================================================================
  // GEOMETRY CREATION
  // ============================================================================

  /**
   * Create the line segments for rendering edges
   *
   * Uses BufferGeometry with:
   * - position: Float32Array of vertex positions (x, y, z for each endpoint)
   * - color: Float32Array of vertex colors (r, g, b for each endpoint)
   *
   * LineSegments draws a line between each pair of consecutive vertices
   */
  function createEdges(
    edges: BrainEdge[],
    getNodePosition: (id: string) => THREE.Vector3 | null
  ): THREE.LineSegments {
    // Store edges for later updates
    currentEdges.value = edges
    edgeDataMap.value.clear()

    // Count valid edges (both nodes must exist)
    const validEdges: BrainEdge[] = []
    for (const edge of edges) {
      const sourcePos = getNodePosition(edge.source)
      const targetPos = getNodePosition(edge.target)
      if (sourcePos && targetPos) {
        validEdges.push(edge)
      }
    }

    // Each edge needs 2 vertices (start and end)
    const vertexCount = validEdges.length * 2
    const positions = new Float32Array(vertexCount * 3)  // x, y, z per vertex
    const colors = new Float32Array(vertexCount * 3)      // r, g, b per vertex
    const opacities = new Float32Array(vertexCount)       // opacity per vertex

    let vertexIndex = 0
    for (let i = 0; i < validEdges.length; i++) {
      const edge = validEdges[i]
      const sourcePos = getNodePosition(edge.source)!
      const targetPos = getNodePosition(edge.target)!

      // Store edge data for lookups
      edgeDataMap.value.set(edge.id, {
        edge,
        sourceIndex: vertexIndex,
        targetIndex: vertexIndex + 1,
      })

      // Calculate visual properties based on strength
      const opacity = calculateOpacity(edge.strength, opts)
      const color = DEFAULT_COLORS.default

      // Source vertex
      positions[vertexIndex * 3] = sourcePos.x
      positions[vertexIndex * 3 + 1] = sourcePos.y
      positions[vertexIndex * 3 + 2] = sourcePos.z
      colors[vertexIndex * 3] = color.r * opacity
      colors[vertexIndex * 3 + 1] = color.g * opacity
      colors[vertexIndex * 3 + 2] = color.b * opacity
      opacities[vertexIndex] = opacity
      vertexIndex++

      // Target vertex
      positions[vertexIndex * 3] = targetPos.x
      positions[vertexIndex * 3 + 1] = targetPos.y
      positions[vertexIndex * 3 + 2] = targetPos.z
      colors[vertexIndex * 3] = color.r * opacity
      colors[vertexIndex * 3 + 1] = color.g * opacity
      colors[vertexIndex * 3 + 2] = color.b * opacity
      opacities[vertexIndex] = opacity
      vertexIndex++
    }

    // Create geometry
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1))

    // Create material
    // Using LineBasicMaterial with vertexColors for per-edge coloring
    // Opacity is baked into the color values for simplicity
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1.0,  // Opacity is controlled per-vertex via color
      depthWrite: false,  // Edges behind nodes should still be visible
      blending: THREE.AdditiveBlending,  // Additive for glow effect
    })

    // Create LineSegments
    const lines = new THREE.LineSegments(geometry, material)
    lines.name = 'brain-edges'
    lines.frustumCulled = false  // Always render (edges span large area)

    lineSegments.value = lines
    return lines
  }

  // ============================================================================
  // POSITION UPDATES
  // ============================================================================

  /**
   * Update edge positions when nodes move
   * Only updates the position attribute, not colors
   */
  function updateEdgePositions(
    getNodePosition: (id: string) => THREE.Vector3 | null
  ): void {
    if (!lineSegments.value) return

    const geometry = lineSegments.value.geometry
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute
    if (!positions) return

    for (const [, edgeData] of edgeDataMap.value) {
      const sourcePos = getNodePosition(edgeData.edge.source)
      const targetPos = getNodePosition(edgeData.edge.target)

      if (sourcePos && targetPos) {
        // Update source vertex
        positions.setXYZ(edgeData.sourceIndex, sourcePos.x, sourcePos.y, sourcePos.z)
        // Update target vertex
        positions.setXYZ(edgeData.targetIndex, targetPos.x, targetPos.y, targetPos.z)
      }
    }

    positions.needsUpdate = true
    geometry.computeBoundingSphere()
  }

  // ============================================================================
  // HIGHLIGHTING
  // ============================================================================

  /**
   * Highlight a single edge
   */
  function highlightEdge(edgeId: string): void {
    highlightedEdgeIds.value.add(edgeId)
    updateEdgeColors()
  }

  /**
   * Highlight multiple edges (for fire path)
   */
  function highlightPath(edgeIds: string[]): void {
    for (const edgeId of edgeIds) {
      highlightedEdgeIds.value.add(edgeId)
    }
    updateEdgeColors()
  }

  /**
   * Remove all highlights
   */
  function unhighlightAll(): void {
    highlightedEdgeIds.value.clear()
    glowEdgeIntensities.value.clear()
    updateEdgeColors()
  }

  /**
   * Set glow intensity for a specific edge (used in fire path animation)
   * @param edgeId - The edge ID
   * @param intensity - Glow intensity (0.0 to 1.0)
   */
  function setEdgeGlow(edgeId: string, intensity: number): void {
    if (intensity <= 0) {
      glowEdgeIntensities.value.delete(edgeId)
    } else {
      glowEdgeIntensities.value.set(edgeId, Math.min(1, intensity))
    }
    updateEdgeColors()
  }

  /**
   * Update edge colors based on current highlight/glow state
   */
  function updateEdgeColors(): void {
    if (!lineSegments.value) return

    const geometry = lineSegments.value.geometry
    const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute
    if (!colorAttr) return

    for (const [edgeId, edgeData] of edgeDataMap.value) {
      const isHighlighted = highlightedEdgeIds.value.has(edgeId)
      const glowIntensity = glowEdgeIntensities.value.get(edgeId) || 0

      let color: THREE.Color
      let opacity: number

      if (glowIntensity > 0) {
        // Fire path glow - interpolate from default to glow color
        color = DEFAULT_COLORS.default.clone().lerp(DEFAULT_COLORS.glowPath, glowIntensity)
        opacity = opts.baseOpacity + (opts.glowOpacity - opts.baseOpacity) * glowIntensity
      } else if (isHighlighted) {
        // Simple highlight
        color = DEFAULT_COLORS.highlighted
        opacity = opts.highlightOpacity
      } else {
        // Normal state
        color = DEFAULT_COLORS.default
        opacity = calculateOpacity(edgeData.edge.strength, opts)
      }

      // Apply color with opacity baked in
      const r = color.r * opacity
      const g = color.g * opacity
      const b = color.b * opacity

      // Update both vertices of the edge
      colorAttr.setXYZ(edgeData.sourceIndex, r, g, b)
      colorAttr.setXYZ(edgeData.targetIndex, r, g, b)
    }

    colorAttr.needsUpdate = true
  }

  // ============================================================================
  // VISIBILITY / LOD
  // ============================================================================

  /**
   * Set visibility of all edges
   * Used for LOD - hide edges when zoomed out far
   */
  function setVisible(visible: boolean): void {
    isVisible.value = visible
    if (lineSegments.value) {
      lineSegments.value.visible = visible
    }
  }

  /**
   * Check if edges should be visible based on camera distance
   * Returns true if edges should be visible
   */
  function shouldBeVisible(cameraDistance: number, threshold: number = 2000): boolean {
    return cameraDistance < threshold
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Dispose of all Three.js resources
   */
  function dispose(): void {
    if (lineSegments.value) {
      lineSegments.value.geometry.dispose()
      if (lineSegments.value.material instanceof THREE.Material) {
        lineSegments.value.material.dispose()
      }
      lineSegments.value = null
    }
    edgeDataMap.value.clear()
    currentEdges.value = []
    highlightedEdgeIds.value.clear()
    glowEdgeIntensities.value.clear()
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Get edge data by ID
   */
  function getEdgeData(edgeId: string): EdgeData | undefined {
    return edgeDataMap.value.get(edgeId)
  }

  /**
   * Get all edge IDs
   */
  function getEdgeIds(): string[] {
    return Array.from(edgeDataMap.value.keys())
  }

  /**
   * Get edges connected to a specific node
   */
  function getEdgesForNode(nodeId: string): BrainEdge[] {
    return currentEdges.value.filter(
      edge => edge.source === nodeId || edge.target === nodeId
    )
  }

  /**
   * Get the ID of the edge connecting two nodes (if it exists)
   */
  function getEdgeIdBetweenNodes(nodeA: string, nodeB: string): string | null {
    const edge = currentEdges.value.find(
      e => (e.source === nodeA && e.target === nodeB) ||
           (e.source === nodeB && e.target === nodeA)
    )
    return edge ? edge.id : null
  }

  /**
   * Update options dynamically
   */
  function setOptions(newOptions: Partial<EdgeRenderOptions>): void {
    Object.assign(opts, newOptions)
    updateEdgeColors()
  }

  /**
   * Update default colors
   */
  function setColors(newColors: Partial<EdgeColors>): void {
    Object.assign(colors, newColors)
    updateEdgeColors()
  }

  // ============================================================================
  // EXPORT
  // ============================================================================

  return {
    // Core state
    lineSegments,
    isVisible,

    // Methods
    createEdges,
    updateEdgePositions,
    highlightEdge,
    highlightPath,
    unhighlightAll,
    setEdgeGlow,
    setVisible,
    shouldBeVisible,
    dispose,

    // Utilities
    getEdgeData,
    getEdgeIds,
    getEdgesForNode,
    getEdgeIdBetweenNodes,
    setOptions,
    setColors,
  }
}
