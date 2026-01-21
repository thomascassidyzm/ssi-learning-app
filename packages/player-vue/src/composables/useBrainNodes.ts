/**
 * useBrainNodes - Three.js Particle System for Brain Network Visualization
 *
 * Creates a GPU-accelerated particle system using THREE.Points where each node
 * represents a learned word, displayed as glowing particles arranged in an
 * organic tree-like 3D neural structure.
 *
 * Performance target: 2000+ nodes at 60fps
 *
 * Features:
 * - BufferGeometry for optimal GPU performance
 * - Custom ShaderMaterial with soft glow effect
 * - Belt-based coloring with brightness based on usage
 * - Organic tree-like 3D positioning (dendrite growth pattern)
 * - Force-directed layout for natural clustering
 * - Node highlighting with pulse animation
 *
 * Positioning Algorithm:
 * - Early nodes (first learned) form the "stem" (center-bottom)
 * - Later nodes branch outward like dendrites
 * - Connected nodes cluster together (Hebbian: "fire together, wire together")
 * - Belt-based depth layering as secondary factor
 * - Simple force simulation: attraction between connected nodes, repulsion between all
 */

import * as THREE from 'three'
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'

// ============================================================================
// TYPES
// ============================================================================

export type Belt = 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'purple' | 'brown' | 'black'

export interface BrainNode {
  id: string
  x: number  // pre-calculated 2D position (used as seed for organic layout)
  y: number
  targetText: string
  knownText: string
  belt: Belt
  isComponent: boolean
  usageCount?: number  // how often this word has been practiced
}

// Edge data for force-directed layout (compatible with useBrainEdges.BrainEdge)
export interface BrainEdge {
  id?: string         // optional for force layout (used by useBrainEdges for rendering)
  source: string
  target: string
  strength: number
}

// Internal representation with computed 3D position
interface InternalNode extends BrainNode {
  index: number
  position: THREE.Vector3
  baseBrightness: number
  currentBrightness: number
  isHighlighted: boolean
  highlightPhase: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Muted, moonlit dojo palette - soft glowing neurons in darkness
export const BELT_COLORS: Record<Belt, string> = {
  white: '#7a8090',    // Soft silver-gray, like moonlight on stone
  yellow: '#c9a84c',   // Warm amber, like candlelight
  orange: '#b87a4a',   // Muted terracotta, earthy warmth
  green: '#4a9068',    // Forest green, soft moss
  blue: '#5a7fa8',     // Twilight blue, calm depth
  purple: '#7a6a98',   // Dusty lavender, gentle mystery
  brown: '#8a6a50',    // Warm walnut, grounded
  black: '#a89868',    // Aged gold, mastery's quiet glow
}

// Belt depth layers (Z position multiplier based on belt level)
// Earlier belts are closer to camera, later belts are deeper
const BELT_DEPTH: Record<Belt, number> = {
  white: 0.0,
  yellow: 0.15,
  orange: 0.3,
  green: 0.45,
  blue: 0.6,
  purple: 0.75,
  brown: 0.9,
  black: 1.0,
}

// Particle sizes - larger for organic neuron clusters
const BASE_PARTICLE_SIZE = 28.0  // Larger base size for visibility
const MAX_PARTICLE_SIZE = 55.0  // Max size for high-frequency nodes
const COMPONENT_SIZE_MULTIPLIER = 0.6  // Components are smaller
const SIZE_LOG_SCALE = 0.15  // Logarithmic scaling factor for usage-based sizing

// Brightness range based on usage
const MIN_BRIGHTNESS = 0.85  // Much brighter baseline - nodes must be visible!
const MAX_BRIGHTNESS = 1.0
const USAGE_SCALE_FACTOR = 0.02  // Subtle increase with usage

// Highlight animation
const HIGHLIGHT_PULSE_SPEED = 3.0  // Radians per second
const HIGHLIGHT_PULSE_AMPLITUDE = 0.3  // Brightness variation

// Brain shape parameters - tighter clustering for organic neuron groups
const BRAIN_ELLIPSOID = {
  radiusX: 140,  // Width (left-right) - reduced for tighter packing
  radiusY: 110,  // Height (top-bottom) - reduced for tighter packing
  radiusZ: 85,   // Depth (front-back) - reduced for tighter packing
}

// ============================================================================
// SHADERS
// ============================================================================

const VERTEX_SHADER = `
  attribute float brightness;
  attribute float size;
  attribute vec3 customColor;
  attribute float highlighted;

  varying vec3 vColor;
  varying float vBrightness;
  varying float vHighlighted;

  void main() {
    vColor = customColor;
    vBrightness = brightness;
    vHighlighted = highlighted;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // Size attenuation - particles appear smaller when further away
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vBrightness;
  varying float vHighlighted;

  void main() {
    // Distance from center of point (0 at center, 1 at edge)
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center) * 2.0;

    // Crisp node with subtle glow - "bright stars" not "fuzzy blobs"
    // Larger solid core with sharper edge, thin glow halo
    float coreRadius = 0.5;   // Solid core extends further
    float edgeSharpness = 0.1;  // Sharp transition at edge
    float glowStart = 0.6;   // Glow starts at edge of core
    float glowEnd = 1.0;

    // Sharp-edged core with slight anti-aliasing
    float core = 1.0 - smoothstep(coreRadius - edgeSharpness, coreRadius, dist);

    // Subtle outer glow - thin halo effect
    float glow = 1.0 - smoothstep(glowStart, glowEnd, dist);
    glow *= 0.4;  // Reduce glow intensity

    // Combine: solid core with subtle glow halo
    float alpha = core * 1.0 + glow * 0.4;
    alpha *= vBrightness;
    alpha = clamp(alpha, 0.0, 1.0);

    // Add extra glow when highlighted (still subtle)
    float highlightGlow = vHighlighted * glow * 0.4;
    alpha += highlightGlow;

    // Discard fully transparent fragments for performance
    if (alpha < 0.01) discard;

    // Final color - brighter core, slight bloom
    vec3 finalColor = vColor * (vBrightness + highlightGlow * 0.3);

    // Boost for highlighted particles
    if (vHighlighted > 0.5) {
      finalColor += vec3(0.1, 0.1, 0.15);
    }

    gl_FragColor = vec4(finalColor, alpha);
  }
`

// ============================================================================
// ORGANIC TREE POSITIONING - Force-Directed 3D Layout
// ============================================================================

/**
 * Position data for force simulation
 */
interface ForceNode {
  id: string
  x: number
  y: number
  z: number
  vx: number  // velocity
  vy: number
  vz: number
  birthOrder: number  // index in learning sequence
  belt: Belt
  isComponent: boolean
}

/**
 * Seeded random number generator for reproducible organic randomness
 * Uses a simple mulberry32 algorithm
 */
function seededRandom(seed: number): () => number {
  return function() {
    seed |= 0
    seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/**
 * Simple string hash for consistent node seeding
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

/**
 * Calculate initial 3D position based on birth order (organic tree growth)
 * Early nodes form the stem, later nodes branch outward
 */
function getInitialTreePosition(
  birthOrder: number,
  totalNodes: number,
  belt: Belt,
  nodeId: string
): { x: number; y: number; z: number } {
  const random = seededRandom(hashString(nodeId))

  // Normalize birth order to 0-1 range
  const progress = totalNodes > 1 ? birthOrder / (totalNodes - 1) : 0

  // Belt affects depth (z-position) - earlier belts more central
  const beltDepth = BELT_DEPTH[belt]

  // Tree growth pattern:
  // - Early nodes (progress < 0.1): Stem - near bottom center
  // - Middle nodes (0.1 - 0.6): Main branches - spread outward
  // - Late nodes (0.6 - 1.0): Dendrite tips - outer regions

  let radius: number
  let height: number // y-position (up in the brain)
  let angleSpread: number

  if (progress < 0.1) {
    // STEM: First ~10% of nodes form the central core
    radius = progress * 30 + random() * 10
    height = -BRAIN_ELLIPSOID.radiusY * 0.6 + progress * BRAIN_ELLIPSOID.radiusY * 0.4
    angleSpread = Math.PI * 2 // Full circle but small radius
  } else if (progress < 0.4) {
    // MAIN BRANCHES: Spread outward and upward
    const branchProgress = (progress - 0.1) / 0.3
    radius = 30 + branchProgress * BRAIN_ELLIPSOID.radiusX * 0.6
    height = -BRAIN_ELLIPSOID.radiusY * 0.2 + branchProgress * BRAIN_ELLIPSOID.radiusY * 0.5
    angleSpread = Math.PI * 2
  } else if (progress < 0.7) {
    // SECONDARY BRANCHES: Continue spreading
    const secondaryProgress = (progress - 0.4) / 0.3
    radius = BRAIN_ELLIPSOID.radiusX * 0.5 + secondaryProgress * BRAIN_ELLIPSOID.radiusX * 0.35
    height = BRAIN_ELLIPSOID.radiusY * 0.1 + secondaryProgress * BRAIN_ELLIPSOID.radiusY * 0.4
    angleSpread = Math.PI * 2
  } else {
    // DENDRITE TIPS: Outermost nodes
    const tipProgress = (progress - 0.7) / 0.3
    radius = BRAIN_ELLIPSOID.radiusX * 0.7 + tipProgress * BRAIN_ELLIPSOID.radiusX * 0.25
    height = BRAIN_ELLIPSOID.radiusY * 0.3 + tipProgress * BRAIN_ELLIPSOID.radiusY * 0.3
    angleSpread = Math.PI * 2
  }

  // Add organic variation based on node ID (reproducible randomness)
  const angle = random() * angleSpread
  const radiusJitter = (random() - 0.5) * radius * 0.3
  const heightJitter = (random() - 0.5) * 20

  const x = Math.cos(angle) * (radius + radiusJitter)
  const y = height + heightJitter

  // Z depth combines belt depth with organic variation
  // Earlier belts are more central (smaller z), later belts more peripheral
  const baseZ = (random() - 0.5) * BRAIN_ELLIPSOID.radiusZ * 0.8
  const beltInfluence = (beltDepth - 0.5) * BRAIN_ELLIPSOID.radiusZ * 0.4
  const z = baseZ + beltInfluence

  return { x, y, z }
}

/**
 * Run force-directed simulation in 3D
 * - Connected nodes attract
 * - All nodes repel (prevent overlap)
 * - Gravity toward center keeps brain compact
 * - Boundary constraint keeps nodes within brain shell
 */
function runForceSimulation(
  forceNodes: ForceNode[],
  edges: BrainEdge[],
  iterations: number = 50
): void {
  if (forceNodes.length === 0) return

  // Build adjacency map for quick edge lookup
  const adjacency = new Map<string, Set<string>>()
  const edgeStrength = new Map<string, number>()

  for (const node of forceNodes) {
    adjacency.set(node.id, new Set())
  }

  for (const edge of edges) {
    const sourceAdj = adjacency.get(edge.source)
    const targetAdj = adjacency.get(edge.target)
    if (sourceAdj) sourceAdj.add(edge.target)
    if (targetAdj) targetAdj.add(edge.source)
    edgeStrength.set(`${edge.source}-${edge.target}`, edge.strength)
    edgeStrength.set(`${edge.target}-${edge.source}`, edge.strength)
  }

  // Force parameters
  const attractionStrength = 0.015   // Connected nodes pull together
  const repulsionStrength = 800     // All nodes push apart (scaled by distance squared)
  const gravityStrength = 0.002     // Pull toward center
  const dampening = 0.85            // Velocity decay per iteration
  const maxVelocity = 8             // Prevent explosive movement

  // Ideal distance between connected nodes
  const idealDistance = 40

  for (let iter = 0; iter < iterations; iter++) {
    // Apply forces to each node
    for (let i = 0; i < forceNodes.length; i++) {
      const nodeA = forceNodes[i]

      // 1. REPULSION: Push away from all other nodes
      for (let j = i + 1; j < forceNodes.length; j++) {
        const nodeB = forceNodes[j]

        const dx = nodeB.x - nodeA.x
        const dy = nodeB.y - nodeA.y
        const dz = nodeB.z - nodeA.z
        const distSq = dx * dx + dy * dy + dz * dz + 0.01 // Avoid division by zero
        const dist = Math.sqrt(distSq)

        // Repulsion force (inverse square law)
        const repulsion = repulsionStrength / distSq
        const fx = (dx / dist) * repulsion
        const fy = (dy / dist) * repulsion
        const fz = (dz / dist) * repulsion

        nodeA.vx -= fx
        nodeA.vy -= fy
        nodeA.vz -= fz
        nodeB.vx += fx
        nodeB.vy += fy
        nodeB.vz += fz
      }

      // 2. ATTRACTION: Pull toward connected nodes
      const neighbors = adjacency.get(nodeA.id)
      if (neighbors) {
        for (const neighborId of neighbors) {
          const nodeB = forceNodes.find(n => n.id === neighborId)
          if (!nodeB) continue

          const dx = nodeB.x - nodeA.x
          const dy = nodeB.y - nodeA.y
          const dz = nodeB.z - nodeA.z
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01

          // Attraction based on edge strength (stronger = closer)
          const strength = edgeStrength.get(`${nodeA.id}-${neighborId}`) || 1
          const attractionMult = Math.min(strength / 5, 3) // Cap at 3x

          // Spring-like force: pull if too far, push if too close
          const displacement = dist - idealDistance
          const attraction = displacement * attractionStrength * attractionMult

          nodeA.vx += (dx / dist) * attraction
          nodeA.vy += (dy / dist) * attraction
          nodeA.vz += (dz / dist) * attraction
        }
      }

      // 3. GRAVITY: Pull toward center to keep brain compact
      const distFromCenter = Math.sqrt(nodeA.x * nodeA.x + nodeA.y * nodeA.y + nodeA.z * nodeA.z)
      if (distFromCenter > 1) {
        nodeA.vx -= nodeA.x * gravityStrength
        nodeA.vy -= nodeA.y * gravityStrength
        nodeA.vz -= nodeA.z * gravityStrength
      }

      // 4. BOUNDARY CONSTRAINT: Keep within brain ellipsoid
      const normalizedDist = Math.sqrt(
        (nodeA.x / BRAIN_ELLIPSOID.radiusX) ** 2 +
        (nodeA.y / BRAIN_ELLIPSOID.radiusY) ** 2 +
        (nodeA.z / BRAIN_ELLIPSOID.radiusZ) ** 2
      )

      if (normalizedDist > 0.95) {
        // Push back toward center if too close to boundary
        const pushBack = (normalizedDist - 0.85) * 0.3
        nodeA.vx -= (nodeA.x / distFromCenter) * pushBack * distFromCenter
        nodeA.vy -= (nodeA.y / distFromCenter) * pushBack * distFromCenter
        nodeA.vz -= (nodeA.z / distFromCenter) * pushBack * distFromCenter
      }
    }

    // Apply velocity and dampening
    for (const node of forceNodes) {
      // Clamp velocity
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy + node.vz * node.vz)
      if (speed > maxVelocity) {
        const scale = maxVelocity / speed
        node.vx *= scale
        node.vy *= scale
        node.vz *= scale
      }

      // Update position
      node.x += node.vx
      node.y += node.vy
      node.z += node.vz

      // Apply dampening
      node.vx *= dampening
      node.vy *= dampening
      node.vz *= dampening
    }
  }

  // Final boundary enforcement - hard clamp to ellipsoid
  for (const node of forceNodes) {
    const normalizedDist = Math.sqrt(
      (node.x / BRAIN_ELLIPSOID.radiusX) ** 2 +
      (node.y / BRAIN_ELLIPSOID.radiusY) ** 2 +
      (node.z / BRAIN_ELLIPSOID.radiusZ) ** 2
    )

    if (normalizedDist > 0.95) {
      const scale = 0.95 / normalizedDist
      node.x *= scale
      node.y *= scale
      node.z *= scale
    }
  }
}

/**
 * Calculate organic 3D positions for all nodes using tree growth + force-directed layout
 *
 * @param nodes - Array of brain nodes in birth order (first = earliest learned)
 * @param edges - Connections between nodes
 * @returns Map of node ID to 3D position
 */
function calculateOrganicPositions(
  nodes: BrainNode[],
  edges: BrainEdge[]
): Map<string, THREE.Vector3> {
  const positions = new Map<string, THREE.Vector3>()

  if (nodes.length === 0) return positions

  // 1. Create force nodes with initial tree-based positions
  const forceNodes: ForceNode[] = nodes.map((node, index) => {
    const initial = getInitialTreePosition(index, nodes.length, node.belt, node.id)
    return {
      id: node.id,
      x: initial.x,
      y: initial.y,
      z: initial.z,
      vx: 0,
      vy: 0,
      vz: 0,
      birthOrder: index,
      belt: node.belt,
      isComponent: node.isComponent
    }
  })

  // 2. Run force simulation to cluster connected nodes
  // More iterations for larger networks
  const iterations = Math.min(100, 30 + Math.floor(nodes.length / 20))
  runForceSimulation(forceNodes, edges, iterations)

  // 3. Convert to THREE.Vector3 positions
  for (const node of forceNodes) {
    positions.set(node.id, new THREE.Vector3(node.x, node.y, node.z))
  }

  return positions
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert hex color string to THREE.Color
 */
function hexToColor(hex: string): THREE.Color {
  return new THREE.Color(hex)
}

/**
 * Calculate brightness based on usage count
 */
function calculateBrightness(usageCount: number = 0): number {
  // Logarithmic scaling so early uses matter more
  const scaledUsage = Math.log1p(usageCount * USAGE_SCALE_FACTOR)
  return Math.min(MAX_BRIGHTNESS, MIN_BRIGHTNESS + scaledUsage * (MAX_BRIGHTNESS - MIN_BRIGHTNESS))
}

/**
 * Calculate particle size based on usage count
 * Uses logarithmic scaling so high-frequency nodes don't dominate
 */
function calculateSizeFromUsage(usageCount: number = 0, isComponent: boolean): number {
  const baseSize = isComponent
    ? BASE_PARTICLE_SIZE * COMPONENT_SIZE_MULTIPLIER
    : BASE_PARTICLE_SIZE

  // Logarithmic scaling: log1p(x) = ln(1 + x), gives diminishing returns
  // This prevents extremely used nodes from being too large
  const usageBoost = Math.log1p(usageCount * SIZE_LOG_SCALE)

  // Scale the boost to fit within our size range
  const maxBoost = MAX_PARTICLE_SIZE - BASE_PARTICLE_SIZE
  const sizeBoost = Math.min(usageBoost * 3, maxBoost)  // Cap at max size

  // Apply component multiplier to the boost as well
  const finalBoost = isComponent ? sizeBoost * COMPONENT_SIZE_MULTIPLIER : sizeBoost

  return baseSize + finalBoost
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useBrainNodes() {
  // State
  const nodes: Ref<BrainNode[]> = ref([])
  const internalNodes: Ref<Map<string, InternalNode>> = ref(new Map())
  const points: ShallowRef<THREE.Points | null> = shallowRef(null)

  // Geometry and material references for updates
  let geometry: THREE.BufferGeometry | null = null
  let material: THREE.ShaderMaterial | null = null

  // Canvas dimensions for 2D to 3D mapping
  let canvasWidth = 800
  let canvasHeight = 800

  // Animation state
  let animationTime = 0

  // Store edges for force-directed layout
  let storedEdges: BrainEdge[] = []

  /**
   * Create the particle system from node data
   * Uses organic tree-like positioning with force-directed layout
   *
   * @param inputNodes - Brain nodes in learning order (first = earliest learned)
   * @param width - Canvas width (used for fallback positioning)
   * @param height - Canvas height (used for fallback positioning)
   * @param edges - Optional edges for force-directed clustering
   */
  function createNodes(
    inputNodes: BrainNode[],
    width = 800,
    height = 800,
    edges: BrainEdge[] = []
  ): THREE.Points {
    canvasWidth = width
    canvasHeight = height
    nodes.value = inputNodes
    storedEdges = edges

    const nodeCount = inputNodes.length
    if (nodeCount === 0) {
      // Return empty points object
      geometry = new THREE.BufferGeometry()
      material = createMaterial()
      points.value = new THREE.Points(geometry, material)
      return points.value
    }

    // Calculate organic 3D positions using tree growth + force simulation
    const organicPositions = calculateOrganicPositions(inputNodes, edges)

    // Create internal node representations
    const nodeMap = new Map<string, InternalNode>()

    // Prepare buffer arrays
    const positions = new Float32Array(nodeCount * 3)
    const colors = new Float32Array(nodeCount * 3)
    const brightnesses = new Float32Array(nodeCount)
    const sizes = new Float32Array(nodeCount)
    const highlighted = new Float32Array(nodeCount)

    inputNodes.forEach((node, index) => {
      // Get pre-calculated organic 3D position
      const pos3d = organicPositions.get(node.id) || new THREE.Vector3(0, 0, 0)

      // Calculate brightness from usage
      const baseBrightness = calculateBrightness(node.usageCount)

      // Get belt color
      const color = hexToColor(BELT_COLORS[node.belt])

      // Calculate particle size based on usage frequency
      const size = calculateSizeFromUsage(node.usageCount, node.isComponent)

      // Store internal node
      const internalNode: InternalNode = {
        ...node,
        index,
        position: pos3d,
        baseBrightness,
        currentBrightness: baseBrightness,
        isHighlighted: false,
        highlightPhase: 0,
      }
      nodeMap.set(node.id, internalNode)

      // Fill buffer arrays
      positions[index * 3] = pos3d.x
      positions[index * 3 + 1] = pos3d.y
      positions[index * 3 + 2] = pos3d.z

      colors[index * 3] = color.r
      colors[index * 3 + 1] = color.g
      colors[index * 3 + 2] = color.b

      brightnesses[index] = baseBrightness
      sizes[index] = size
      highlighted[index] = 0.0
    })

    internalNodes.value = nodeMap

    // Create BufferGeometry
    geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('brightness', new THREE.BufferAttribute(brightnesses, 1))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('highlighted', new THREE.BufferAttribute(highlighted, 1))

    // Create material
    material = createMaterial()

    // Create Points object
    points.value = new THREE.Points(geometry, material)
    points.value.frustumCulled = false  // Always render all particles

    console.log(`[useBrainNodes] Created ${nodeCount} nodes with organic tree positioning (${edges.length} edges)`)

    return points.value
  }

  /**
   * Create shader material for particles
   */
  function createMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,  // Prevents z-fighting with overlapping particles
    })
  }

  /**
   * Update the brightness of a specific node
   */
  function updateNodeBrightness(nodeId: string, brightness: number): void {
    const node = internalNodes.value.get(nodeId)
    if (!node || !geometry) return

    const clampedBrightness = Math.max(MIN_BRIGHTNESS, Math.min(MAX_BRIGHTNESS, brightness))
    node.baseBrightness = clampedBrightness
    node.currentBrightness = clampedBrightness

    // Update buffer attribute
    const brightnessAttr = geometry.getAttribute('brightness') as THREE.BufferAttribute
    brightnessAttr.array[node.index] = clampedBrightness
    brightnessAttr.needsUpdate = true
  }

  /**
   * Highlight a node (make it pulse/glow brighter)
   */
  function highlightNode(nodeId: string): void {
    const node = internalNodes.value.get(nodeId)
    if (!node || !geometry) return

    node.isHighlighted = true
    node.highlightPhase = 0

    // Set highlighted attribute
    const highlightedAttr = geometry.getAttribute('highlighted') as THREE.BufferAttribute
    highlightedAttr.array[node.index] = 1.0
    highlightedAttr.needsUpdate = true
  }

  /**
   * Remove highlight from a node
   */
  function unhighlightNode(nodeId: string): void {
    const node = internalNodes.value.get(nodeId)
    if (!node || !geometry) return

    node.isHighlighted = false
    node.currentBrightness = node.baseBrightness

    // Reset highlighted attribute
    const highlightedAttr = geometry.getAttribute('highlighted') as THREE.BufferAttribute
    highlightedAttr.array[node.index] = 0.0
    highlightedAttr.needsUpdate = true

    // Reset brightness to base
    const brightnessAttr = geometry.getAttribute('brightness') as THREE.BufferAttribute
    brightnessAttr.array[node.index] = node.baseBrightness
    brightnessAttr.needsUpdate = true
  }

  /**
   * Get the 3D position of a node by ID
   */
  function getNodePosition(nodeId: string): THREE.Vector3 | null {
    const node = internalNodes.value.get(nodeId)
    return node ? node.position.clone() : null
  }

  /**
   * Get the BrainNode at a specific index (for raycasting)
   */
  function getNodeAtIndex(index: number): BrainNode | null {
    if (index < 0 || index >= nodes.value.length) return null

    // Find node with this index
    for (const [, internalNode] of internalNodes.value) {
      if (internalNode.index === index) {
        // Return the original BrainNode (without internal fields)
        return {
          id: internalNode.id,
          x: internalNode.x,
          y: internalNode.y,
          targetText: internalNode.targetText,
          knownText: internalNode.knownText,
          belt: internalNode.belt,
          isComponent: internalNode.isComponent,
          usageCount: internalNode.usageCount,
        }
      }
    }
    return null
  }

  /**
   * Update animation (call in render loop)
   * Handles highlight pulse animation
   */
  function update(deltaTime: number): void {
    if (!geometry) return

    animationTime += deltaTime

    let needsBrightnessUpdate = false
    const brightnessAttr = geometry.getAttribute('brightness') as THREE.BufferAttribute

    // Update highlighted nodes with pulse effect
    for (const [, node] of internalNodes.value) {
      if (node.isHighlighted) {
        node.highlightPhase += deltaTime * HIGHLIGHT_PULSE_SPEED

        // Sine wave pulse
        const pulse = Math.sin(node.highlightPhase) * HIGHLIGHT_PULSE_AMPLITUDE
        node.currentBrightness = Math.min(1.0, node.baseBrightness + 0.3 + pulse)

        brightnessAttr.array[node.index] = node.currentBrightness
        needsBrightnessUpdate = true
      }
    }

    if (needsBrightnessUpdate) {
      brightnessAttr.needsUpdate = true
    }

    // Update time uniform if material exists
    if (material) {
      material.uniforms.time.value = animationTime
    }
  }

  /**
   * Increment usage count for a node and update brightness and size
   */
  function incrementUsage(nodeId: string): void {
    const node = internalNodes.value.get(nodeId)
    if (!node || !geometry) return

    node.usageCount = (node.usageCount || 0) + 1

    // Update brightness
    const newBrightness = calculateBrightness(node.usageCount)
    updateNodeBrightness(nodeId, newBrightness)

    // Update size based on new usage count
    const newSize = calculateSizeFromUsage(node.usageCount, node.isComponent)
    const sizeAttr = geometry.getAttribute('size') as THREE.BufferAttribute
    sizeAttr.array[node.index] = newSize
    sizeAttr.needsUpdate = true
  }

  /**
   * Get node by ID
   */
  function getNode(nodeId: string): BrainNode | null {
    const node = internalNodes.value.get(nodeId)
    if (!node) return null

    return {
      id: node.id,
      x: node.x,
      y: node.y,
      targetText: node.targetText,
      knownText: node.knownText,
      belt: node.belt,
      isComponent: node.isComponent,
      usageCount: node.usageCount,
    }
  }

  /**
   * Update node color (e.g., when belt changes)
   */
  function updateNodeColor(nodeId: string, belt: Belt): void {
    const node = internalNodes.value.get(nodeId)
    if (!node || !geometry) return

    node.belt = belt
    const color = hexToColor(BELT_COLORS[belt])

    const colorAttr = geometry.getAttribute('customColor') as THREE.BufferAttribute
    colorAttr.array[node.index * 3] = color.r
    colorAttr.array[node.index * 3 + 1] = color.g
    colorAttr.array[node.index * 3 + 2] = color.b
    colorAttr.needsUpdate = true
  }

  /**
   * Dispose of Three.js resources
   */
  function dispose(): void {
    if (geometry) {
      geometry.dispose()
      geometry = null
    }
    if (material) {
      material.dispose()
      material = null
    }
    points.value = null
    internalNodes.value.clear()
    nodes.value = []
  }

  /**
   * Get all node IDs
   */
  function getAllNodeIds(): string[] {
    return Array.from(internalNodes.value.keys())
  }

  /**
   * Check if a node exists
   */
  function hasNode(nodeId: string): boolean {
    return internalNodes.value.has(nodeId)
  }

  /**
   * Get the THREE.Points object for adding to scene
   */
  function getPointsObject(): THREE.Points | null {
    return points.value
  }

  /**
   * Highlight multiple nodes at once (efficient batch update)
   */
  function highlightNodes(nodeIds: string[]): void {
    if (!geometry) return

    const highlightedAttr = geometry.getAttribute('highlighted') as THREE.BufferAttribute

    for (const nodeId of nodeIds) {
      const node = internalNodes.value.get(nodeId)
      if (node) {
        node.isHighlighted = true
        node.highlightPhase = 0
        highlightedAttr.array[node.index] = 1.0
      }
    }

    highlightedAttr.needsUpdate = true
  }

  /**
   * Unhighlight all nodes (efficient batch update)
   */
  function unhighlightAll(): void {
    if (!geometry) return

    const highlightedAttr = geometry.getAttribute('highlighted') as THREE.BufferAttribute
    const brightnessAttr = geometry.getAttribute('brightness') as THREE.BufferAttribute

    for (const [, node] of internalNodes.value) {
      if (node.isHighlighted) {
        node.isHighlighted = false
        node.currentBrightness = node.baseBrightness
        highlightedAttr.array[node.index] = 0.0
        brightnessAttr.array[node.index] = node.baseBrightness
      }
    }

    highlightedAttr.needsUpdate = true
    brightnessAttr.needsUpdate = true
  }

  return {
    // Methods
    createNodes,
    updateNodeBrightness,
    highlightNode,
    unhighlightNode,
    getNodePosition,
    getNodeAtIndex,

    // Additional utilities
    update,
    incrementUsage,
    getNode,
    updateNodeColor,
    dispose,
    getAllNodeIds,
    hasNode,
    getPointsObject,
    highlightNodes,
    unhighlightAll,

    // State (reactive)
    nodes,
    points,
  }
}

// Export types
export type UseBrainNodes = ReturnType<typeof useBrainNodes>
