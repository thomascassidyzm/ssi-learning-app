/**
 * useBrainEdges - Three.js Neural Connection System for Brain Network
 *
 * Renders CURVED, GLOWING connections between nodes in a 3D brain visualization.
 * Edges represent connections between words that appear together in phrases.
 *
 * Visual features:
 * - Curved paths using CatmullRomCurve3 for organic, axon-like appearance
 * - TubeGeometry for volumetric lines with proper thickness
 * - Multi-layer glow effect using overlapping tubes
 * - Additive blending for ethereal glow
 *
 * Performance optimizations:
 * - Batched updates (not per-frame unless needed)
 * - LOD: can hide edges when zoomed out far
 * - Geometry disposal on cleanup
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
  /** Base opacity for normal edges (default: 0.7) */
  baseOpacity?: number
  /** Maximum opacity for strong connections (default: 1.0) */
  maxOpacity?: number
  /** Base tube radius (default: 3) */
  baseWidth?: number
  /** Maximum tube radius for strong connections (default: 8) */
  maxWidth?: number
  /** Opacity for highlighted edges (default: 1.0) */
  highlightOpacity?: number
  /** Opacity for glow path edges (default: 1.0) */
  glowOpacity?: number
  /** Curve segments for smoothness (default: 20) */
  curveSegments?: number
  /** Tube radial segments (default: 6) */
  tubeSegments?: number
  /** Curve bend amount (default: 0.3) - how much curves deviate from straight */
  curveBend?: number
}

interface EdgeMeshData {
  edge: BrainEdge
  coreMesh: THREE.Mesh
  glowMesh: THREE.Mesh
  outerGlowMesh: THREE.Mesh
  sourcePos: THREE.Vector3
  targetPos: THREE.Vector3
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_OPTIONS: Required<EdgeRenderOptions> = {
  baseOpacity: 0.7,      // Much more visible
  maxOpacity: 1.0,       // Full opacity for strong connections
  baseWidth: 3,          // Thicker base width
  maxWidth: 8,           // Much thicker for strong connections
  highlightOpacity: 1.0,
  glowOpacity: 1.0,
  curveSegments: 24,     // Smooth curves
  tubeSegments: 6,       // Enough for round appearance
  curveBend: 0.3,        // Moderate curve deviation
}

const DEFAULT_COLORS: EdgeColors = {
  default: new THREE.Color(0xaaddff),  // Soft blue-white for neural look
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
  const normalizedStrength = Math.min(100, Math.max(1, strength)) / 100
  const opacityRange = options.maxOpacity - options.baseOpacity
  return options.baseOpacity + Math.sqrt(normalizedStrength) * opacityRange
}

/**
 * Calculate tube radius based on connection strength
 */
function calculateRadius(strength: number, options: Required<EdgeRenderOptions>): number {
  const normalizedStrength = Math.min(100, Math.max(1, strength)) / 100
  const widthRange = options.maxWidth - options.baseWidth
  // Scale down for tube radius (width values are now tube diameter-ish)
  return (options.baseWidth + Math.sqrt(normalizedStrength) * widthRange) * 0.1
}

/**
 * Generate a seeded random number for consistent curve offsets
 * Uses simple hash of edge ID
 */
function seededRandom(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return (Math.abs(hash) % 1000) / 1000
}

/**
 * Create a curved path between two points using CatmullRomCurve3
 * The curve has organic variation perpendicular to the direct line
 */
function createCurvedPath(
  source: THREE.Vector3,
  target: THREE.Vector3,
  edgeId: string,
  bendAmount: number
): THREE.CatmullRomCurve3 {
  // Get the direction vector
  const direction = new THREE.Vector3().subVectors(target, source)
  const distance = direction.length()
  direction.normalize()

  // Create a perpendicular vector for the curve offset
  // Use cross product with a reference vector
  const up = new THREE.Vector3(0, 1, 0)
  let perpendicular = new THREE.Vector3().crossVectors(direction, up)

  // If direction is parallel to up, use different reference
  if (perpendicular.length() < 0.1) {
    const right = new THREE.Vector3(1, 0, 0)
    perpendicular = new THREE.Vector3().crossVectors(direction, right)
  }
  perpendicular.normalize()

  // Also create another perpendicular for 3D variation
  const perpendicular2 = new THREE.Vector3().crossVectors(direction, perpendicular).normalize()

  // Use seeded random for consistent but varied curves
  const rand1 = seededRandom(edgeId) * 2 - 1  // -1 to 1
  const rand2 = seededRandom(edgeId + '_2') * 2 - 1
  const rand3 = seededRandom(edgeId + '_3') * 2 - 1
  const rand4 = seededRandom(edgeId + '_4') * 2 - 1

  // Calculate control points at 1/3 and 2/3 along the path
  const offsetScale = distance * bendAmount

  // First control point (1/3 along the line)
  const cp1 = new THREE.Vector3()
    .addVectors(source, direction.clone().multiplyScalar(distance * 0.33))
    .add(perpendicular.clone().multiplyScalar(rand1 * offsetScale))
    .add(perpendicular2.clone().multiplyScalar(rand2 * offsetScale * 0.5))

  // Second control point (2/3 along the line)
  const cp2 = new THREE.Vector3()
    .addVectors(source, direction.clone().multiplyScalar(distance * 0.67))
    .add(perpendicular.clone().multiplyScalar(rand3 * offsetScale))
    .add(perpendicular2.clone().multiplyScalar(rand4 * offsetScale * 0.5))

  // Create CatmullRom curve through the points
  // CatmullRom gives smooth organic curves through all points
  const curve = new THREE.CatmullRomCurve3([
    source.clone(),
    cp1,
    cp2,
    target.clone()
  ], false, 'centripetal', 0.5)

  return curve
}

/**
 * Create a tube mesh from a curve
 */
function createTubeMesh(
  curve: THREE.CatmullRomCurve3,
  radius: number,
  color: THREE.Color,
  opacity: number,
  segments: number,
  tubeSegments: number
): THREE.Mesh {
  const geometry = new THREE.TubeGeometry(
    curve,
    segments,
    radius,
    tubeSegments,
    false  // not closed
  )

  const material = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false

  return mesh
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

  // Group containing all edge meshes
  const edgeGroup: ShallowRef<THREE.Group | null> = shallowRef(null)

  // Edge mesh data storage for lookups and updates
  const edgeMeshMap: Ref<Map<string, EdgeMeshData>> = ref(new Map())

  // Current edges (stored for position updates)
  const currentEdges: Ref<BrainEdge[]> = ref([])

  // Highlighted edge IDs
  const highlightedEdgeIds: Ref<Set<string>> = ref(new Set())

  // Glow path edge IDs with intensity
  const glowEdgeIntensities: Ref<Map<string, number>> = ref(new Map())

  // Visibility flag
  const isVisible: Ref<boolean> = ref(true)

  // For backwards compatibility - expose as lineSegments
  const lineSegments: ShallowRef<THREE.Group | null> = shallowRef(null)

  // ============================================================================
  // GEOMETRY CREATION
  // ============================================================================

  /**
   * Create curved tube meshes for rendering edges
   * Each edge gets 3 layers:
   * - Core: main visible tube
   * - Glow: slightly larger, more transparent
   * - Outer glow: even larger, very transparent for soft halo
   */
  function createEdges(
    edges: BrainEdge[],
    getNodePosition: (id: string) => THREE.Vector3 | null
  ): THREE.Group {
    // Store edges for later updates
    currentEdges.value = edges
    edgeMeshMap.value.clear()

    // Create group to hold all edge meshes
    const group = new THREE.Group()
    group.name = 'brain-edges'

    for (const edge of edges) {
      const sourcePos = getNodePosition(edge.source)
      const targetPos = getNodePosition(edge.target)

      if (!sourcePos || !targetPos) continue

      // Calculate visual properties based on strength
      const opacity = calculateOpacity(edge.strength, opts)
      const radius = calculateRadius(edge.strength, opts)
      const color = colors.default.clone()

      // Create curved path
      const curve = createCurvedPath(
        sourcePos,
        targetPos,
        edge.id,
        opts.curveBend
      )

      // Core tube - main visible connection
      const coreMesh = createTubeMesh(
        curve,
        radius,
        color,
        opacity,
        opts.curveSegments,
        opts.tubeSegments
      )
      coreMesh.name = `edge-core-${edge.id}`

      // Inner glow - slightly larger, more transparent
      const glowMesh = createTubeMesh(
        curve,
        radius * 1.8,
        color,
        opacity * 0.4,
        opts.curveSegments,
        opts.tubeSegments
      )
      glowMesh.name = `edge-glow-${edge.id}`

      // Outer glow - even larger, very soft
      const outerGlowMesh = createTubeMesh(
        curve,
        radius * 3.0,
        color,
        opacity * 0.15,
        opts.curveSegments,
        opts.tubeSegments
      )
      outerGlowMesh.name = `edge-outer-glow-${edge.id}`

      // Add to group (outer first so it renders behind)
      group.add(outerGlowMesh)
      group.add(glowMesh)
      group.add(coreMesh)

      // Store mesh data for updates
      edgeMeshMap.value.set(edge.id, {
        edge,
        coreMesh,
        glowMesh,
        outerGlowMesh,
        sourcePos: sourcePos.clone(),
        targetPos: targetPos.clone()
      })
    }

    edgeGroup.value = group
    lineSegments.value = group  // For backwards compatibility
    return group
  }

  // ============================================================================
  // POSITION UPDATES
  // ============================================================================

  /**
   * Update edge positions when nodes move
   * Recreates the tube geometry for moved edges
   */
  function updateEdgePositions(
    getNodePosition: (id: string) => THREE.Vector3 | null
  ): void {
    if (!edgeGroup.value) return

    for (const [edgeId, meshData] of edgeMeshMap.value) {
      const sourcePos = getNodePosition(meshData.edge.source)
      const targetPos = getNodePosition(meshData.edge.target)

      if (!sourcePos || !targetPos) continue

      // Check if positions have changed
      if (sourcePos.equals(meshData.sourcePos) && targetPos.equals(meshData.targetPos)) {
        continue  // No change, skip update
      }

      // Update stored positions
      meshData.sourcePos.copy(sourcePos)
      meshData.targetPos.copy(targetPos)

      // Recreate curve and geometry
      const curve = createCurvedPath(
        sourcePos,
        targetPos,
        edgeId,
        opts.curveBend
      )

      const radius = calculateRadius(meshData.edge.strength, opts)

      // Dispose old geometries
      meshData.coreMesh.geometry.dispose()
      meshData.glowMesh.geometry.dispose()
      meshData.outerGlowMesh.geometry.dispose()

      // Create new geometries
      meshData.coreMesh.geometry = new THREE.TubeGeometry(
        curve, opts.curveSegments, radius, opts.tubeSegments, false
      )
      meshData.glowMesh.geometry = new THREE.TubeGeometry(
        curve, opts.curveSegments, radius * 1.8, opts.tubeSegments, false
      )
      meshData.outerGlowMesh.geometry = new THREE.TubeGeometry(
        curve, opts.curveSegments, radius * 3.0, opts.tubeSegments, false
      )
    }
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
    for (const [edgeId, meshData] of edgeMeshMap.value) {
      const isHighlighted = highlightedEdgeIds.value.has(edgeId)
      const glowIntensity = glowEdgeIntensities.value.get(edgeId) || 0

      let color: THREE.Color
      let opacity: number

      if (glowIntensity > 0) {
        // Fire path glow - interpolate from default to glow color
        color = colors.default.clone().lerp(colors.glowPath, glowIntensity)
        opacity = opts.baseOpacity + (opts.glowOpacity - opts.baseOpacity) * glowIntensity
      } else if (isHighlighted) {
        // Simple highlight
        color = colors.highlighted.clone()
        opacity = opts.highlightOpacity
      } else {
        // Normal state
        color = colors.default.clone()
        opacity = calculateOpacity(meshData.edge.strength, opts)
      }

      // Update core mesh
      const coreMat = meshData.coreMesh.material as THREE.MeshBasicMaterial
      coreMat.color.copy(color)
      coreMat.opacity = opacity

      // Update glow mesh (more transparent)
      const glowMat = meshData.glowMesh.material as THREE.MeshBasicMaterial
      glowMat.color.copy(color)
      glowMat.opacity = opacity * 0.4

      // Update outer glow mesh (even more transparent)
      const outerGlowMat = meshData.outerGlowMesh.material as THREE.MeshBasicMaterial
      outerGlowMat.color.copy(color)
      outerGlowMat.opacity = opacity * 0.15
    }
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
    if (edgeGroup.value) {
      edgeGroup.value.visible = visible
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
    for (const [, meshData] of edgeMeshMap.value) {
      // Dispose geometries
      meshData.coreMesh.geometry.dispose()
      meshData.glowMesh.geometry.dispose()
      meshData.outerGlowMesh.geometry.dispose()

      // Dispose materials
      if (meshData.coreMesh.material instanceof THREE.Material) {
        meshData.coreMesh.material.dispose()
      }
      if (meshData.glowMesh.material instanceof THREE.Material) {
        meshData.glowMesh.material.dispose()
      }
      if (meshData.outerGlowMesh.material instanceof THREE.Material) {
        meshData.outerGlowMesh.material.dispose()
      }
    }

    if (edgeGroup.value) {
      edgeGroup.value.clear()
      edgeGroup.value = null
    }

    lineSegments.value = null
    edgeMeshMap.value.clear()
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
  function getEdgeData(edgeId: string): EdgeMeshData | undefined {
    return edgeMeshMap.value.get(edgeId)
  }

  /**
   * Get all edge IDs
   */
  function getEdgeIds(): string[] {
    return Array.from(edgeMeshMap.value.keys())
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
    lineSegments,  // For backwards compatibility (now returns the Group)
    edgeGroup,     // New: the actual group
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
