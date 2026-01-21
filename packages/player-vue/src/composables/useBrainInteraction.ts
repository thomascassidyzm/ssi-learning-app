/**
 * useBrainInteraction - 3D Brain Visualization Interaction Layer
 *
 * Provides raycasting, hover, click, and search/fly-to functionality
 * for a THREE.js-based 3D brain network visualization.
 *
 * Features:
 * - Throttled raycasting for efficient node detection (~30fps max)
 * - Hover events with debouncing for tooltip display
 * - Click events for node selection and detail panel
 * - Animated camera fly-to for search results
 * - Spatial indexing via octree for large node counts
 *
 * Integration:
 * - Works with useBrainScene (camera, renderer)
 * - Works with useBrainNodes (points, node data)
 * - Emits events that parent components can subscribe to
 */

import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Brain node data structure
 * Matches the ConstellationNode from usePrebuiltNetwork but extended for 3D
 */
export interface BrainNode {
  id: string
  targetText: string
  knownText: string
  belt: string
  x: number
  y: number
  z?: number  // Z coordinate for 3D (optional, defaults to 0 for 2D compat)
  isComponent?: boolean
  parentLegoIds?: string[]
  /** Index in the Points geometry (set after initialization) */
  pointIndex?: number
}

/**
 * Hover event payload
 */
export interface NodeHoverEvent {
  node: BrainNode | null
  screenPosition: { x: number; y: number } | null
}

/**
 * Click event payload
 */
export interface NodeClickEvent {
  node: BrainNode
  screenPosition: { x: number; y: number }
}

/**
 * Callback types
 */
type NodeHoverCallback = (event: NodeHoverEvent) => void
type NodeClickCallback = (event: NodeClickEvent) => void

/**
 * Octree cell for spatial indexing
 */
interface OctreeCell {
  bounds: THREE.Box3
  nodeIndices: number[]
  children?: OctreeCell[]
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Raycasting throttle interval in ms (~30fps) */
const RAYCAST_THROTTLE_MS = 33

/** Maximum distance for point intersection (in world units) */
const POINT_THRESHOLD = 0.5

/** Hover debounce time - prevents flicker on edge of nodes */
const HOVER_DEBOUNCE_MS = 50

/** Default fly-to animation duration in ms */
const DEFAULT_FLY_DURATION_MS = 800

/** Octree max depth for spatial indexing */
const OCTREE_MAX_DEPTH = 6

/** Octree max nodes per cell before subdivision */
const OCTREE_MAX_NODES_PER_CELL = 50

// ============================================================================
// EASING FUNCTIONS
// ============================================================================

/**
 * Smooth step easing function for camera animation
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * Ease out cubic for natural deceleration
 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// ============================================================================
// OCTREE SPATIAL INDEXING
// ============================================================================

/**
 * Build an octree for efficient spatial queries on large point sets
 */
function buildOctree(
  positions: Float32Array,
  nodeCount: number,
  maxDepth: number = OCTREE_MAX_DEPTH
): OctreeCell {
  // Calculate bounds
  const bounds = new THREE.Box3()
  for (let i = 0; i < nodeCount; i++) {
    const idx = i * 3
    bounds.expandByPoint(new THREE.Vector3(
      positions[idx],
      positions[idx + 1],
      positions[idx + 2]
    ))
  }

  // Expand bounds slightly to avoid edge cases
  bounds.expandByScalar(0.1)

  // Create root cell with all indices
  const rootIndices: number[] = []
  for (let i = 0; i < nodeCount; i++) {
    rootIndices.push(i)
  }

  return subdivideCell(positions, { bounds, nodeIndices: rootIndices }, 0, maxDepth)
}

/**
 * Recursively subdivide an octree cell
 */
function subdivideCell(
  positions: Float32Array,
  cell: OctreeCell,
  depth: number,
  maxDepth: number
): OctreeCell {
  // Stop if max depth reached or few enough nodes
  if (depth >= maxDepth || cell.nodeIndices.length <= OCTREE_MAX_NODES_PER_CELL) {
    return cell
  }

  // Create 8 child cells
  const center = new THREE.Vector3()
  cell.bounds.getCenter(center)

  const children: OctreeCell[] = []

  for (let i = 0; i < 8; i++) {
    const childBounds = new THREE.Box3()

    // Determine octant based on bit pattern
    const xHigh = (i & 1) !== 0
    const yHigh = (i & 2) !== 0
    const zHigh = (i & 4) !== 0

    childBounds.min.set(
      xHigh ? center.x : cell.bounds.min.x,
      yHigh ? center.y : cell.bounds.min.y,
      zHigh ? center.z : cell.bounds.min.z
    )
    childBounds.max.set(
      xHigh ? cell.bounds.max.x : center.x,
      yHigh ? cell.bounds.max.y : center.y,
      zHigh ? cell.bounds.max.z : center.z
    )

    children.push({
      bounds: childBounds,
      nodeIndices: []
    })
  }

  // Distribute node indices to children
  for (const nodeIdx of cell.nodeIndices) {
    const idx = nodeIdx * 3
    const point = new THREE.Vector3(
      positions[idx],
      positions[idx + 1],
      positions[idx + 2]
    )

    for (const child of children) {
      if (child.bounds.containsPoint(point)) {
        child.nodeIndices.push(nodeIdx)
        break
      }
    }
  }

  // Recursively subdivide non-empty children
  cell.children = children
    .filter(c => c.nodeIndices.length > 0)
    .map(c => subdivideCell(positions, c, depth + 1, maxDepth))

  // Clear node indices from non-leaf cells
  cell.nodeIndices = []

  return cell
}

/**
 * Query octree for nodes near a ray
 */
function queryOctreeForRay(
  cell: OctreeCell,
  ray: THREE.Ray,
  maxDistance: number,
  results: number[]
): void {
  // Check if ray intersects cell bounds
  const intersection = ray.intersectBox(cell.bounds, new THREE.Vector3())
  if (!intersection) return

  // If leaf cell, add all node indices
  if (!cell.children || cell.children.length === 0) {
    results.push(...cell.nodeIndices)
    return
  }

  // Recurse into children
  for (const child of cell.children) {
    queryOctreeForRay(child, ray, maxDistance, results)
  }
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useBrainInteraction() {
  // ============================================================================
  // STATE
  // ============================================================================

  // THREE.js objects (set via init)
  const camera: ShallowRef<THREE.Camera | null> = shallowRef(null)
  const renderer: ShallowRef<THREE.WebGLRenderer | null> = shallowRef(null)
  const points: ShallowRef<THREE.Points | null> = shallowRef(null)

  // Node data
  const nodes: Ref<BrainNode[]> = ref([])
  const nodeIndexMap: Ref<Map<string, number>> = ref(new Map())

  // Spatial indexing
  const octree: ShallowRef<OctreeCell | null> = shallowRef(null)
  const useOctree: Ref<boolean> = ref(false)

  // Raycaster
  const raycaster = new THREE.Raycaster()
  raycaster.params.Points = { threshold: POINT_THRESHOLD }

  // Mouse state
  const mousePosition = new THREE.Vector2()
  const lastRaycastTime = ref(0)
  const isMouseOverCanvas = ref(false)

  // Hover state
  const hoveredNode: Ref<BrainNode | null> = ref(null)
  const hoverDebounceTimer: Ref<ReturnType<typeof setTimeout> | null> = ref(null)

  // Highlighted node (for search results)
  const highlightedNodeId: Ref<string | null> = ref(null)

  // Animation state
  const isAnimating = ref(false)
  const animationId: Ref<number | null> = ref(null)

  // Event callbacks
  const hoverCallbacks: Set<NodeHoverCallback> = new Set()
  const clickCallbacks: Set<NodeClickCallback> = new Set()

  // DOM element reference
  let domElement: HTMLElement | null = null

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the interaction layer
   *
   * @param cam - THREE.js camera (PerspectiveCamera or OrthographicCamera)
   * @param rend - THREE.js WebGLRenderer
   * @param pts - THREE.Points particle system
   * @param nodeData - Array of BrainNode data
   */
  function init(
    cam: THREE.Camera,
    rend: THREE.WebGLRenderer,
    pts: THREE.Points,
    nodeData: BrainNode[]
  ): void {
    camera.value = cam
    renderer.value = rend
    points.value = pts
    nodes.value = nodeData

    // Build node index map
    const indexMap = new Map<string, number>()
    nodeData.forEach((node, index) => {
      node.pointIndex = index
      indexMap.set(node.id, index)
    })
    nodeIndexMap.value = indexMap

    // Get DOM element for event listeners
    domElement = rend.domElement

    // Build spatial index if we have many nodes
    if (nodeData.length > 1000) {
      buildSpatialIndex()
    }

    // Add event listeners
    addEventListeners()

    console.log(`[useBrainInteraction] Initialized with ${nodeData.length} nodes`)
  }

  /**
   * Build spatial index (octree) for efficient raycasting
   */
  function buildSpatialIndex(): void {
    if (!points.value) return

    const geometry = points.value.geometry
    const positions = geometry.getAttribute('position')

    if (!positions || !(positions.array instanceof Float32Array)) {
      console.warn('[useBrainInteraction] Cannot build octree: invalid position attribute')
      return
    }

    octree.value = buildOctree(
      positions.array as Float32Array,
      nodes.value.length
    )
    useOctree.value = true

    console.log(`[useBrainInteraction] Built octree for ${nodes.value.length} nodes`)
  }

  // ============================================================================
  // EVENT LISTENERS
  // ============================================================================

  function addEventListeners(): void {
    if (!domElement) return

    domElement.addEventListener('mousemove', handleMouseMove)
    domElement.addEventListener('click', handleClick)
    domElement.addEventListener('mouseenter', handleMouseEnter)
    domElement.addEventListener('mouseleave', handleMouseLeave)

    // Touch events for mobile
    domElement.addEventListener('touchstart', handleTouchStart, { passive: false })
    domElement.addEventListener('touchmove', handleTouchMove, { passive: false })
    domElement.addEventListener('touchend', handleTouchEnd)
  }

  function removeEventListeners(): void {
    if (!domElement) return

    domElement.removeEventListener('mousemove', handleMouseMove)
    domElement.removeEventListener('click', handleClick)
    domElement.removeEventListener('mouseenter', handleMouseEnter)
    domElement.removeEventListener('mouseleave', handleMouseLeave)
    domElement.removeEventListener('touchstart', handleTouchStart)
    domElement.removeEventListener('touchmove', handleTouchMove)
    domElement.removeEventListener('touchend', handleTouchEnd)
  }

  // ============================================================================
  // MOUSE HANDLING
  // ============================================================================

  function handleMouseEnter(): void {
    isMouseOverCanvas.value = true
  }

  function handleMouseLeave(): void {
    isMouseOverCanvas.value = false
    clearHover()
  }

  function handleMouseMove(event: MouseEvent): void {
    if (!domElement || !isMouseOverCanvas.value) return

    // Update normalized mouse coordinates
    const rect = domElement.getBoundingClientRect()
    mousePosition.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mousePosition.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    // Throttle raycasting
    const now = performance.now()
    if (now - lastRaycastTime.value < RAYCAST_THROTTLE_MS) return
    lastRaycastTime.value = now

    // Perform raycast
    performRaycast(event.clientX, event.clientY)
  }

  function handleClick(event: MouseEvent): void {
    if (!domElement || !camera.value || !points.value) return

    // Update mouse position
    const rect = domElement.getBoundingClientRect()
    mousePosition.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mousePosition.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    // Raycast immediately for click
    const intersectedNode = getIntersectedNode()

    if (intersectedNode) {
      const screenPos = { x: event.clientX, y: event.clientY }
      emitClick({ node: intersectedNode, screenPosition: screenPos })
    }
  }

  // ============================================================================
  // TOUCH HANDLING
  // ============================================================================

  let touchStartPosition: { x: number; y: number } | null = null
  let isTouchDrag = false

  function handleTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) return

    const touch = event.touches[0]
    touchStartPosition = { x: touch.clientX, y: touch.clientY }
    isTouchDrag = false
  }

  function handleTouchMove(event: TouchEvent): void {
    if (!touchStartPosition || event.touches.length !== 1) return

    const touch = event.touches[0]
    const dx = touch.clientX - touchStartPosition.x
    const dy = touch.clientY - touchStartPosition.y

    // If moved more than 10px, consider it a drag (not a tap)
    if (Math.sqrt(dx * dx + dy * dy) > 10) {
      isTouchDrag = true
    }
  }

  function handleTouchEnd(event: TouchEvent): void {
    if (!touchStartPosition || isTouchDrag) {
      touchStartPosition = null
      return
    }

    // Treat as click
    if (!domElement || !camera.value || !points.value) return

    const rect = domElement.getBoundingClientRect()
    mousePosition.x = ((touchStartPosition.x - rect.left) / rect.width) * 2 - 1
    mousePosition.y = -((touchStartPosition.y - rect.top) / rect.height) * 2 + 1

    const intersectedNode = getIntersectedNode()

    if (intersectedNode) {
      const screenPos = { x: touchStartPosition.x, y: touchStartPosition.y }
      emitClick({ node: intersectedNode, screenPosition: screenPos })
    }

    touchStartPosition = null
  }

  // ============================================================================
  // RAYCASTING
  // ============================================================================

  /**
   * Perform raycast and update hover state
   */
  function performRaycast(screenX: number, screenY: number): void {
    const node = getIntersectedNode()

    // Clear any pending debounce
    if (hoverDebounceTimer.value) {
      clearTimeout(hoverDebounceTimer.value)
    }

    // Debounce hover changes to prevent flicker
    hoverDebounceTimer.value = setTimeout(() => {
      if (node !== hoveredNode.value) {
        hoveredNode.value = node
        emitHover({
          node,
          screenPosition: node ? { x: screenX, y: screenY } : null
        })
      }
    }, HOVER_DEBOUNCE_MS)
  }

  /**
   * Get the node intersected by the current mouse position
   */
  function getIntersectedNode(): BrainNode | null {
    if (!camera.value || !points.value) return null

    raycaster.setFromCamera(mousePosition, camera.value)

    // Use octree if available for large datasets
    if (useOctree.value && octree.value) {
      return getIntersectedNodeViaOctree()
    }

    // Standard THREE.js raycast for smaller datasets
    const intersects = raycaster.intersectObject(points.value)

    if (intersects.length > 0) {
      const pointIndex = intersects[0].index
      if (pointIndex !== undefined && pointIndex < nodes.value.length) {
        return nodes.value[pointIndex]
      }
    }

    return null
  }

  /**
   * Get intersected node using octree spatial indexing
   */
  function getIntersectedNodeViaOctree(): BrainNode | null {
    if (!octree.value || !points.value || !camera.value) return null

    // Get candidate node indices from octree
    const ray = raycaster.ray
    const candidates: number[] = []
    queryOctreeForRay(octree.value, ray, POINT_THRESHOLD * 2, candidates)

    if (candidates.length === 0) return null

    // Check candidates for actual intersection
    const geometry = points.value.geometry
    const positions = geometry.getAttribute('position')
    const pointThreshold = raycaster.params.Points?.threshold ?? POINT_THRESHOLD

    let closestNode: BrainNode | null = null
    let closestDistance = Infinity

    const point = new THREE.Vector3()

    for (const index of candidates) {
      const idx = index * 3
      point.set(
        positions.getX(index),
        positions.getY(index),
        positions.getZ(index)
      )

      // Calculate distance from ray to point
      const rayPoint = new THREE.Vector3()
      ray.closestPointToPoint(point, rayPoint)
      const distance = point.distanceTo(rayPoint)

      if (distance < pointThreshold && distance < closestDistance) {
        closestDistance = distance
        closestNode = nodes.value[index]
      }
    }

    return closestNode
  }

  /**
   * Clear hover state
   */
  function clearHover(): void {
    if (hoverDebounceTimer.value) {
      clearTimeout(hoverDebounceTimer.value)
    }

    if (hoveredNode.value) {
      hoveredNode.value = null
      emitHover({ node: null, screenPosition: null })
    }
  }

  // ============================================================================
  // EVENT EMISSION
  // ============================================================================

  function emitHover(event: NodeHoverEvent): void {
    for (const callback of hoverCallbacks) {
      try {
        callback(event)
      } catch (err) {
        console.error('[useBrainInteraction] Hover callback error:', err)
      }
    }
  }

  function emitClick(event: NodeClickEvent): void {
    for (const callback of clickCallbacks) {
      try {
        callback(event)
      } catch (err) {
        console.error('[useBrainInteraction] Click callback error:', err)
      }
    }
  }

  // ============================================================================
  // EVENT SUBSCRIPTION
  // ============================================================================

  /**
   * Subscribe to node hover events
   */
  function onNodeHover(callback: NodeHoverCallback): () => void {
    hoverCallbacks.add(callback)
    return () => {
      hoverCallbacks.delete(callback)
    }
  }

  /**
   * Subscribe to node click events
   */
  function onNodeClick(callback: NodeClickCallback): () => void {
    clickCallbacks.add(callback)
    return () => {
      clickCallbacks.delete(callback)
    }
  }

  // ============================================================================
  // FLY-TO ANIMATION
  // ============================================================================

  /**
   * Animate camera to focus on a specific node
   *
   * @param nodeId - ID of the node to fly to
   * @param duration - Animation duration in ms (default 800ms)
   * @returns Promise that resolves when animation completes
   */
  async function flyToNode(nodeId: string, duration: number = DEFAULT_FLY_DURATION_MS): Promise<void> {
    const nodeIndex = nodeIndexMap.value.get(nodeId)
    if (nodeIndex === undefined) {
      console.warn(`[useBrainInteraction] Node ${nodeId} not found`)
      return Promise.resolve()
    }

    const node = nodes.value[nodeIndex]
    if (!node || !camera.value || !points.value) {
      return Promise.resolve()
    }

    // Cancel any ongoing animation
    if (animationId.value) {
      cancelAnimationFrame(animationId.value)
    }

    // Set highlight
    highlightedNodeId.value = nodeId

    // Get target position
    const geometry = points.value.geometry
    const positions = geometry.getAttribute('position')
    const targetPosition = new THREE.Vector3(
      positions.getX(nodeIndex),
      positions.getY(nodeIndex),
      positions.getZ(nodeIndex)
    )

    // Calculate camera offset - keep some distance from the node
    const currentCamera = camera.value as THREE.PerspectiveCamera
    const fov = currentCamera.fov || 60
    const viewDistance = 5 / Math.tan((fov / 2) * Math.PI / 180)

    // Camera will look at node from its current angle direction
    const cameraOffset = camera.value.position.clone().sub(
      camera.value instanceof THREE.PerspectiveCamera
        ? new THREE.Vector3(0, 0, 0)
        : camera.value.position
    ).normalize().multiplyScalar(viewDistance)

    const finalCameraPosition = targetPosition.clone().add(cameraOffset)

    // Animation
    const startPosition = camera.value.position.clone()
    const startLookAt = getLookAtTarget()
    const startTime = performance.now()

    isAnimating.value = true

    return new Promise<void>((resolve) => {
      function animate(): void {
        if (!camera.value) {
          isAnimating.value = false
          resolve()
          return
        }

        const elapsed = performance.now() - startTime
        const progress = Math.min(elapsed / duration, 1)
        const eased = easeOutCubic(progress)

        // Interpolate camera position
        camera.value.position.lerpVectors(startPosition, finalCameraPosition, eased)

        // Interpolate look-at target
        const currentLookAt = new THREE.Vector3().lerpVectors(startLookAt, targetPosition, eased)

        if (camera.value instanceof THREE.PerspectiveCamera ||
            camera.value instanceof THREE.OrthographicCamera) {
          camera.value.lookAt(currentLookAt)
        }

        if (progress < 1) {
          animationId.value = requestAnimationFrame(animate)
        } else {
          isAnimating.value = false
          animationId.value = null
          resolve()
        }
      }

      animationId.value = requestAnimationFrame(animate)
    })
  }

  /**
   * Get the current camera look-at target
   */
  function getLookAtTarget(): THREE.Vector3 {
    if (!camera.value) return new THREE.Vector3()

    // Get look direction from camera matrix
    const direction = new THREE.Vector3()
    camera.value.getWorldDirection(direction)

    // Calculate a point along the look direction
    return camera.value.position.clone().add(direction.multiplyScalar(10))
  }

  /**
   * Clear highlight
   */
  function clearHighlight(): void {
    highlightedNodeId.value = null
  }

  // ============================================================================
  // NODE LOOKUP
  // ============================================================================

  /**
   * Find a node by ID
   */
  function findNodeById(nodeId: string): BrainNode | null {
    const index = nodeIndexMap.value.get(nodeId)
    if (index === undefined) return null
    return nodes.value[index] || null
  }

  /**
   * Find nodes by text search (target or known text)
   */
  function searchNodes(query: string, limit: number = 10): BrainNode[] {
    if (!query || query.length < 2) return []

    const queryLower = query.toLowerCase()
    const results: BrainNode[] = []

    for (const node of nodes.value) {
      if (results.length >= limit) break

      const targetMatch = node.targetText?.toLowerCase().includes(queryLower)
      const knownMatch = node.knownText?.toLowerCase().includes(queryLower)

      if (targetMatch || knownMatch) {
        results.push(node)
      }
    }

    return results
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Dispose of all resources and event listeners
   */
  function dispose(): void {
    // Remove event listeners
    removeEventListeners()

    // Clear timers
    if (hoverDebounceTimer.value) {
      clearTimeout(hoverDebounceTimer.value)
    }

    // Cancel animation
    if (animationId.value) {
      cancelAnimationFrame(animationId.value)
    }

    // Clear callbacks
    hoverCallbacks.clear()
    clickCallbacks.clear()

    // Clear state
    camera.value = null
    renderer.value = null
    points.value = null
    nodes.value = []
    nodeIndexMap.value = new Map()
    octree.value = null
    hoveredNode.value = null
    highlightedNodeId.value = null
    domElement = null

    console.log('[useBrainInteraction] Disposed')
  }

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    // Setup
    init,

    // Event subscription
    onNodeHover,
    onNodeClick,

    // Methods
    flyToNode,
    findNodeById,
    searchNodes,
    clearHighlight,
    buildSpatialIndex,

    // State (readonly)
    hoveredNode: hoveredNode as Readonly<Ref<BrainNode | null>>,
    highlightedNodeId: highlightedNodeId as Readonly<Ref<string | null>>,
    isAnimating: isAnimating as Readonly<Ref<boolean>>,

    // Cleanup
    dispose,
  }
}
