/**
 * useBrainNodes - Three.js Particle System for Brain Network Visualization
 *
 * Creates a GPU-accelerated particle system using THREE.Points where each node
 * represents a learned word, displayed as glowing particles arranged in a
 * brain-ish 3D shape.
 *
 * Performance target: 2000+ nodes at 60fps
 *
 * Features:
 * - BufferGeometry for optimal GPU performance
 * - Custom ShaderMaterial with soft glow effect
 * - Belt-based coloring with brightness based on usage
 * - 2D to 3D position mapping (ellipsoid brain shape)
 * - Node highlighting with pulse animation
 */

import * as THREE from 'three'
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'

// ============================================================================
// TYPES
// ============================================================================

export type Belt = 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'purple' | 'brown' | 'black'

export interface BrainNode {
  id: string
  x: number  // pre-calculated 2D position
  y: number
  targetText: string
  knownText: string
  belt: Belt
  isComponent: boolean
  usageCount?: number  // how often this word has been practiced
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

export const BELT_COLORS: Record<Belt, string> = {
  white: '#9ca3af',
  yellow: '#fbbf24',
  orange: '#f97316',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  brown: '#a87848',
  black: '#d4a853',
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

// Particle sizes
const BASE_PARTICLE_SIZE = 12.0
const COMPONENT_SIZE_MULTIPLIER = 0.6  // Components are smaller

// Brightness range based on usage
const MIN_BRIGHTNESS = 0.3
const MAX_BRIGHTNESS = 1.0
const USAGE_SCALE_FACTOR = 0.05  // How much each usage increases brightness

// Highlight animation
const HIGHLIGHT_PULSE_SPEED = 3.0  // Radians per second
const HIGHLIGHT_PULSE_AMPLITUDE = 0.3  // Brightness variation

// Brain shape parameters
const BRAIN_ELLIPSOID = {
  radiusX: 200,  // Width (left-right)
  radiusY: 160,  // Height (top-bottom)
  radiusZ: 120,  // Depth (front-back)
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

    // Soft circular falloff with glow
    // Inner core is solid, outer region fades out
    float coreRadius = 0.3;
    float glowRadius = 1.0;

    float core = 1.0 - smoothstep(0.0, coreRadius, dist);
    float glow = 1.0 - smoothstep(coreRadius, glowRadius, dist);

    // Combine core and glow with brightness
    float alpha = core * 0.9 + glow * 0.4;
    alpha *= vBrightness;

    // Add extra glow when highlighted
    float highlightGlow = vHighlighted * glow * 0.5;
    alpha += highlightGlow;

    // Discard fully transparent fragments for performance
    if (alpha < 0.01) discard;

    // Final color with HDR-like bloom effect
    vec3 finalColor = vColor * (vBrightness + highlightGlow * 0.5);

    // Slight color boost for highlighted particles
    if (vHighlighted > 0.5) {
      finalColor += vec3(0.1, 0.1, 0.15);
    }

    gl_FragColor = vec4(finalColor, alpha);
  }
`

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
 * Map 2D position to 3D brain-shaped ellipsoid position
 * Takes normalized 2D coordinates and maps them onto a 3D ellipsoid surface
 * with some depth variation based on belt level
 */
function map2DTo3DBrain(
  x2d: number,
  y2d: number,
  belt: Belt,
  canvasWidth: number,
  canvasHeight: number
): THREE.Vector3 {
  // Normalize 2D position to -1 to 1 range
  const normalizedX = (x2d / canvasWidth) * 2 - 1
  const normalizedY = (y2d / canvasHeight) * 2 - 1

  // Clamp to unit circle to avoid mapping issues at edges
  const dist2D = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY)
  const clampedDist = Math.min(dist2D, 0.95)
  const angle2D = Math.atan2(normalizedY, normalizedX)

  const clampedX = Math.cos(angle2D) * clampedDist
  const clampedY = Math.sin(angle2D) * clampedDist

  // Map to ellipsoid surface with belt-based depth
  // Use a dome-like mapping where center is front, edges curve back
  const beltDepth = BELT_DEPTH[belt]

  // Calculate Z depth based on distance from center and belt level
  // Nodes closer to center are more forward, edges curve back
  const distanceFactor = 1 - clampedDist * clampedDist  // 1 at center, 0 at edge
  const baseZ = distanceFactor * 0.6 + 0.2  // Range 0.2 to 0.8

  // Mix with belt depth - earlier belts are forward, later belts deeper
  const z = baseZ * (1 - beltDepth * 0.5)

  // Add slight random jitter for organic feel
  const jitterX = (Math.random() - 0.5) * 10
  const jitterY = (Math.random() - 0.5) * 10
  const jitterZ = (Math.random() - 0.5) * 15

  return new THREE.Vector3(
    clampedX * BRAIN_ELLIPSOID.radiusX + jitterX,
    clampedY * BRAIN_ELLIPSOID.radiusY + jitterY,
    z * BRAIN_ELLIPSOID.radiusZ - BRAIN_ELLIPSOID.radiusZ * 0.5 + jitterZ
  )
}

/**
 * Calculate brightness based on usage count
 */
function calculateBrightness(usageCount: number = 0): number {
  // Logarithmic scaling so early uses matter more
  const scaledUsage = Math.log1p(usageCount * USAGE_SCALE_FACTOR)
  return Math.min(MAX_BRIGHTNESS, MIN_BRIGHTNESS + scaledUsage * (MAX_BRIGHTNESS - MIN_BRIGHTNESS))
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

  /**
   * Create the particle system from node data
   */
  function createNodes(inputNodes: BrainNode[], width = 800, height = 800): THREE.Points {
    canvasWidth = width
    canvasHeight = height
    nodes.value = inputNodes

    const nodeCount = inputNodes.length
    if (nodeCount === 0) {
      // Return empty points object
      geometry = new THREE.BufferGeometry()
      material = createMaterial()
      points.value = new THREE.Points(geometry, material)
      return points.value
    }

    // Create internal node representations
    const nodeMap = new Map<string, InternalNode>()

    // Prepare buffer arrays
    const positions = new Float32Array(nodeCount * 3)
    const colors = new Float32Array(nodeCount * 3)
    const brightnesses = new Float32Array(nodeCount)
    const sizes = new Float32Array(nodeCount)
    const highlighted = new Float32Array(nodeCount)

    inputNodes.forEach((node, index) => {
      // Calculate 3D position
      const pos3d = map2DTo3DBrain(node.x, node.y, node.belt, canvasWidth, canvasHeight)

      // Calculate brightness from usage
      const baseBrightness = calculateBrightness(node.usageCount)

      // Get belt color
      const color = hexToColor(BELT_COLORS[node.belt])

      // Calculate particle size
      const size = node.isComponent
        ? BASE_PARTICLE_SIZE * COMPONENT_SIZE_MULTIPLIER
        : BASE_PARTICLE_SIZE

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
   * Increment usage count for a node and update brightness
   */
  function incrementUsage(nodeId: string): void {
    const node = internalNodes.value.get(nodeId)
    if (!node) return

    node.usageCount = (node.usageCount || 0) + 1
    const newBrightness = calculateBrightness(node.usageCount)
    updateNodeBrightness(nodeId, newBrightness)
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
