/**
 * useBrainWireframe - Three.js Wireframe Brain Mesh for Orientation
 *
 * Creates a subtle wireframe brain shape to provide structure and orientation
 * for the node visualization. The brain shape helps users understand which
 * direction they're looking at and frames the nodes visually.
 *
 * Design philosophy:
 * - Subtle, not distracting - low opacity wireframe
 * - Anatomically-inspired - recognizable brain silhouette with key features
 * - Provides orientation cues - users can see the shape of the brain
 * - Frames the nodes - contains the visualization visually
 * - Belt-responsive - brain "grows" with learner progression
 *
 * Anatomical features:
 * - Two hemispheres with visible longitudinal fissure (corpus callosum region)
 * - Rounded frontal lobe area
 * - Slightly pointed occipital (back) region
 * - Subtle temporal lobe bulges on the sides
 *
 * Belt progression mirrors human brain development:
 * - white/yellow (early): Smaller, simpler shape - like infant brain
 * - orange/green (middle): Medium size, more defined lobes
 * - blue/purple (advanced): Full adult brain shape
 * - brown/black (mastery): Slightly larger, fully developed
 */

import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'

// ============================================================================
// TYPES
// ============================================================================

export interface BrainWireframeConfig {
  /** Base opacity for the wireframe (default: 0.08) */
  opacity?: number
  /** Wireframe color (default: '#4a5568' - neutral gray) */
  color?: string
  /** Number of segments for mesh detail (default: 48) */
  segments?: number
  /** Show the wireframe (default: true) */
  visible?: boolean
  /** Initial belt level (default: 'white') */
  belt?: BeltLevel
}

export type BeltLevel = 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'purple' | 'brown' | 'black'

export interface BrainWireframeReturn {
  /** Create the wireframe mesh with specified dimensions */
  createWireframe: (width: number, height: number, depth: number) => THREE.Object3D
  /** Set the wireframe color */
  setColor: (color: string) => void
  /** Set the wireframe opacity */
  setOpacity: (opacity: number) => void
  /** Set visibility of the wireframe */
  setVisible: (visible: boolean) => void
  /** Morph the brain to a specific belt developmental stage */
  setBeltLevel: (belt: BeltLevel) => void
  /** Dispose of Three.js resources */
  dispose: () => void
  /** The wireframe mesh object */
  mesh: ShallowRef<THREE.Object3D | null>
  /** Current visibility state */
  isVisible: Ref<boolean>
  /** Current belt level */
  currentBelt: Ref<BeltLevel>
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: Required<BrainWireframeConfig> = {
  opacity: 0.08,
  color: '#4a5568',
  segments: 48,
  visible: true,
  belt: 'white',
}

/**
 * Belt-specific brain development parameters
 * Mirrors human brain development from infant to fully mature
 */
interface BrainDevelopmentParams {
  /** Overall scale multiplier */
  scale: number
  /** Depth of the longitudinal fissure (hemisphere divide) */
  fissureDepth: number
  /** Width of the fissure groove */
  fissureWidth: number
  /** Frontal lobe prominence */
  frontalBulge: number
  /** Temporal lobe prominence */
  temporalBulge: number
  /** Occipital (back) point sharpness */
  occipitalPoint: number
  /** Parietal (top-back) roundness */
  parietalRound: number
  /** Cerebellum bulge (back-bottom) */
  cerebellumBulge: number
  /** Overall surface complexity/folding */
  gyrification: number
  /** Left-right asymmetry (natural) */
  asymmetry: number
}

const BELT_BRAIN_PARAMS: Record<BeltLevel, BrainDevelopmentParams> = {
  // Early stage: Infant-like brain - smooth, round, smaller
  white: {
    scale: 0.75,
    fissureDepth: 0.08,
    fissureWidth: 0.35,
    frontalBulge: 0.06,
    temporalBulge: 0.04,
    occipitalPoint: 0.02,
    parietalRound: 0.08,
    cerebellumBulge: 0.03,
    gyrification: 0.01,
    asymmetry: 0.01,
  },
  yellow: {
    scale: 0.80,
    fissureDepth: 0.10,
    fissureWidth: 0.32,
    frontalBulge: 0.08,
    temporalBulge: 0.05,
    occipitalPoint: 0.04,
    parietalRound: 0.10,
    cerebellumBulge: 0.04,
    gyrification: 0.015,
    asymmetry: 0.012,
  },
  // Middle stage: Adolescent-like brain - more defined features
  orange: {
    scale: 0.87,
    fissureDepth: 0.14,
    fissureWidth: 0.28,
    frontalBulge: 0.12,
    temporalBulge: 0.08,
    occipitalPoint: 0.06,
    parietalRound: 0.12,
    cerebellumBulge: 0.06,
    gyrification: 0.02,
    asymmetry: 0.015,
  },
  green: {
    scale: 0.92,
    fissureDepth: 0.17,
    fissureWidth: 0.25,
    frontalBulge: 0.14,
    temporalBulge: 0.10,
    occipitalPoint: 0.08,
    parietalRound: 0.13,
    cerebellumBulge: 0.08,
    gyrification: 0.025,
    asymmetry: 0.018,
  },
  // Advanced stage: Adult brain - fully defined lobes
  blue: {
    scale: 0.96,
    fissureDepth: 0.20,
    fissureWidth: 0.22,
    frontalBulge: 0.16,
    temporalBulge: 0.12,
    occipitalPoint: 0.10,
    parietalRound: 0.14,
    cerebellumBulge: 0.10,
    gyrification: 0.03,
    asymmetry: 0.02,
  },
  purple: {
    scale: 0.98,
    fissureDepth: 0.22,
    fissureWidth: 0.20,
    frontalBulge: 0.17,
    temporalBulge: 0.13,
    occipitalPoint: 0.11,
    parietalRound: 0.15,
    cerebellumBulge: 0.11,
    gyrification: 0.035,
    asymmetry: 0.02,
  },
  // Mastery stage: Fully developed, slightly enlarged
  brown: {
    scale: 1.0,
    fissureDepth: 0.24,
    fissureWidth: 0.18,
    frontalBulge: 0.18,
    temporalBulge: 0.14,
    occipitalPoint: 0.12,
    parietalRound: 0.16,
    cerebellumBulge: 0.12,
    gyrification: 0.04,
    asymmetry: 0.022,
  },
  black: {
    scale: 1.05,
    fissureDepth: 0.25,
    fissureWidth: 0.16,
    frontalBulge: 0.20,
    temporalBulge: 0.15,
    occipitalPoint: 0.13,
    parietalRound: 0.17,
    cerebellumBulge: 0.13,
    gyrification: 0.045,
    asymmetry: 0.025,
  },
}

// ============================================================================
// GEOMETRY GENERATION
// ============================================================================

/**
 * Generate a brain-like shape by deforming a sphere using spherical harmonics
 * and custom displacement functions.
 *
 * The approach:
 * 1. Start with a sphere
 * 2. Scale to ellipsoid (wider than tall)
 * 3. Apply brain-like deformations (fissure, lobes, etc.)
 */
function createBrainGeometry(
  width: number,
  height: number,
  depth: number,
  segments: number
): THREE.BufferGeometry {
  // Start with a sphere geometry
  const geometry = new THREE.SphereGeometry(1, segments, segments)

  // Get position attribute for modification
  const positions = geometry.getAttribute('position')
  const posArray = positions.array as Float32Array

  // Process each vertex
  for (let i = 0; i < positions.count; i++) {
    const x = posArray[i * 3]
    const y = posArray[i * 3 + 1]
    const z = posArray[i * 3 + 2]

    // Convert to spherical coordinates for easier deformation
    const r = Math.sqrt(x * x + y * y + z * z)
    const theta = Math.atan2(y, x)  // Azimuthal angle (around Y axis)
    const phi = Math.acos(z / r)    // Polar angle (from Z axis)

    // Calculate brain-like deformation
    let deformation = 1.0

    // 1. Longitudinal fissure - groove down the middle (top)
    // This creates the characteristic split between hemispheres
    const fissureAmount = Math.exp(-Math.pow(theta / BRAIN_HARMONICS.fissureWidth, 2))
    const topFactor = Math.max(0, z)  // Only apply to top half
    deformation -= BRAIN_HARMONICS.fissureDepth * fissureAmount * topFactor

    // 2. Frontal lobe bulge (front, slightly lower)
    const frontalDirection = -y  // Front is -Y direction
    const frontalAmount = Math.max(0, frontalDirection) * (1 - Math.abs(x) * 0.5)
    deformation += BRAIN_HARMONICS.frontalBulge * frontalAmount * (1 - z * 0.3)

    // 3. Temporal lobe bulges (sides, lower half)
    const temporalAmount = Math.abs(x) * Math.max(0, -z + 0.3)
    deformation += BRAIN_HARMONICS.temporalBulge * temporalAmount

    // 4. Occipital indent (back, slightly)
    const occipitalDirection = y  // Back is +Y direction
    const occipitalAmount = Math.max(0, occipitalDirection) * (1 - Math.abs(x) * 0.3)
    deformation -= BRAIN_HARMONICS.occipitalIndent * occipitalAmount

    // 5. Slight left-right asymmetry (left hemisphere slightly larger)
    if (x < 0) {
      deformation += BRAIN_HARMONICS.asymmetry
    }

    // 6. Add subtle organic noise for natural look
    const noise = 0.02 * Math.sin(theta * 5) * Math.sin(phi * 4)
    deformation += noise

    // Apply deformation in radial direction
    const newR = r * deformation

    // Convert back to Cartesian and apply ellipsoid scaling
    const newX = (newR * Math.sin(phi) * Math.cos(theta)) * (width / 2)
    const newY = (newR * Math.sin(phi) * Math.sin(theta)) * (depth / 2)  // Depth is Y
    const newZ = (newR * Math.cos(phi)) * (height / 2)

    posArray[i * 3] = newX
    posArray[i * 3 + 1] = newY
    posArray[i * 3 + 2] = newZ
  }

  // Update geometry
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  return geometry
}

/**
 * Create a second, smaller brain geometry for the inner surface
 * This adds visual depth to the wireframe
 */
function createInnerBrainGeometry(
  width: number,
  height: number,
  depth: number,
  segments: number,
  scale: number = 0.85
): THREE.BufferGeometry {
  const geometry = createBrainGeometry(
    width * scale,
    height * scale,
    depth * scale,
    Math.max(16, Math.floor(segments * 0.7))
  )
  return geometry
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useBrainWireframe(config: BrainWireframeConfig = {}): BrainWireframeReturn {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // ============================================================================
  // STATE
  // ============================================================================

  const mesh: ShallowRef<THREE.Object3D | null> = shallowRef(null)
  const isVisible: Ref<boolean> = ref(cfg.visible)

  // Store references for updates
  let outerMaterial: THREE.LineBasicMaterial | null = null
  let innerMaterial: THREE.LineBasicMaterial | null = null
  let outerGeometry: THREE.BufferGeometry | null = null
  let innerGeometry: THREE.BufferGeometry | null = null
  let wireframeGeometry: THREE.WireframeGeometry | null = null
  let innerWireframeGeometry: THREE.WireframeGeometry | null = null

  // ============================================================================
  // CREATION
  // ============================================================================

  /**
   * Create the wireframe brain mesh
   *
   * @param width - Width of the brain (left-right extent)
   * @param height - Height of the brain (top-bottom extent)
   * @param depth - Depth of the brain (front-back extent)
   * @returns THREE.Object3D containing the wireframe mesh(es)
   */
  function createWireframe(width: number, height: number, depth: number): THREE.Object3D {
    // Dispose any existing resources
    dispose()

    // Create a group to hold both wireframe layers
    const group = new THREE.Group()
    group.name = 'brain-wireframe'

    // Parse color
    const color = new THREE.Color(cfg.color)

    // Create outer brain geometry
    outerGeometry = createBrainGeometry(width, height, depth, cfg.segments)
    wireframeGeometry = new THREE.WireframeGeometry(outerGeometry)

    // Create outer wireframe material
    outerMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: cfg.opacity,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })

    // Create outer wireframe mesh
    const outerWireframe = new THREE.LineSegments(wireframeGeometry, outerMaterial)
    outerWireframe.name = 'brain-wireframe-outer'
    group.add(outerWireframe)

    // Create inner brain geometry for depth
    innerGeometry = createInnerBrainGeometry(width, height, depth, cfg.segments, 0.75)
    innerWireframeGeometry = new THREE.WireframeGeometry(innerGeometry)

    // Create inner wireframe material (slightly more transparent)
    innerMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: cfg.opacity * 0.5,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })

    // Create inner wireframe mesh
    const innerWireframe = new THREE.LineSegments(innerWireframeGeometry, innerMaterial)
    innerWireframe.name = 'brain-wireframe-inner'
    group.add(innerWireframe)

    // Set initial visibility
    group.visible = isVisible.value

    // Rotate to match the scene orientation
    // The brain should be oriented with:
    // - Front facing the camera (negative Y in our scene)
    // - Top pointing up (positive Z)
    group.rotation.x = Math.PI / 2  // Rotate 90 degrees around X

    mesh.value = group

    console.log('[useBrainWireframe] Created wireframe', {
      width,
      height,
      depth,
      segments: cfg.segments,
      opacity: cfg.opacity,
    })

    return group
  }

  // ============================================================================
  // UPDATES
  // ============================================================================

  /**
   * Set the wireframe color
   */
  function setColor(color: string): void {
    const threeColor = new THREE.Color(color)

    if (outerMaterial) {
      outerMaterial.color = threeColor
    }
    if (innerMaterial) {
      innerMaterial.color = threeColor
    }

    console.log('[useBrainWireframe] Color set to', color)
  }

  /**
   * Set the wireframe opacity
   */
  function setOpacity(opacity: number): void {
    const clampedOpacity = Math.max(0, Math.min(1, opacity))

    if (outerMaterial) {
      outerMaterial.opacity = clampedOpacity
    }
    if (innerMaterial) {
      innerMaterial.opacity = clampedOpacity * 0.5
    }

    console.log('[useBrainWireframe] Opacity set to', clampedOpacity)
  }

  /**
   * Set visibility of the wireframe
   */
  function setVisible(visible: boolean): void {
    isVisible.value = visible

    if (mesh.value) {
      mesh.value.visible = visible
    }

    console.log('[useBrainWireframe] Visibility set to', visible)
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Dispose of all Three.js resources
   */
  function dispose(): void {
    if (outerGeometry) {
      outerGeometry.dispose()
      outerGeometry = null
    }
    if (innerGeometry) {
      innerGeometry.dispose()
      innerGeometry = null
    }
    if (wireframeGeometry) {
      wireframeGeometry.dispose()
      wireframeGeometry = null
    }
    if (innerWireframeGeometry) {
      innerWireframeGeometry.dispose()
      innerWireframeGeometry = null
    }
    if (outerMaterial) {
      outerMaterial.dispose()
      outerMaterial = null
    }
    if (innerMaterial) {
      innerMaterial.dispose()
      innerMaterial = null
    }

    mesh.value = null

    console.log('[useBrainWireframe] Disposed')
  }

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    createWireframe,
    setColor,
    setOpacity,
    setVisible,
    dispose,
    mesh,
    isVisible,
  }
}

// Export types
export type UseBrainWireframe = ReturnType<typeof useBrainWireframe>
