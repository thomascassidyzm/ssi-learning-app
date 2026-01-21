/**
 * useBrainWireframe - Three.js Wireframe Brain Mesh for Orientation
 *
 * Creates a subtle wireframe brain shape to provide structure and orientation
 * for the node visualization. The brain shape helps users understand which
 * direction they're looking at and frames the nodes visually.
 *
 * Design philosophy:
 * - Subtle, not distracting - low opacity wireframe
 * - Brain-like but stylized - think "brain icon" not "medical illustration"
 * - Provides orientation cues - users can see the shape of the brain
 * - Frames the nodes - contains the visualization visually
 *
 * The brain shape is procedurally generated using spherical harmonics to
 * create a recognizable brain silhouette with:
 * - Two hemispheres with slight separation (longitudinal fissure)
 * - Bulging frontal and temporal lobes
 * - Overall ellipsoidal form (wider than tall, flattened front-to-back)
 */

import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'

// ============================================================================
// TYPES
// ============================================================================

export interface BrainWireframeConfig {
  /** Base opacity for the wireframe (default: 0.12) */
  opacity?: number
  /** Wireframe color (default: '#4a5568' - neutral gray) */
  color?: string
  /** Number of segments for mesh detail (default: 32) */
  segments?: number
  /** Show the wireframe (default: true) */
  visible?: boolean
}

export interface BrainWireframeReturn {
  /** Create the wireframe mesh with specified dimensions */
  createWireframe: (width: number, height: number, depth: number) => THREE.Object3D
  /** Set the wireframe color */
  setColor: (color: string) => void
  /** Set the wireframe opacity */
  setOpacity: (opacity: number) => void
  /** Set visibility of the wireframe */
  setVisible: (visible: boolean) => void
  /** Dispose of Three.js resources */
  dispose: () => void
  /** The wireframe mesh object */
  mesh: ShallowRef<THREE.Object3D | null>
  /** Current visibility state */
  isVisible: Ref<boolean>
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: Required<BrainWireframeConfig> = {
  opacity: 0.12,
  color: '#4a5568',
  segments: 32,
  visible: true,
}

// Spherical harmonic coefficients for brain-like deformation
// These create the characteristic bulges and indentations
const BRAIN_HARMONICS = {
  // Longitudinal fissure (central groove between hemispheres)
  fissureDepth: 0.15,
  fissureWidth: 0.2,
  // Frontal lobe bulge
  frontalBulge: 0.12,
  // Temporal lobe bulges (sides)
  temporalBulge: 0.08,
  // Occipital (back) slight indent
  occipitalIndent: 0.05,
  // Overall asymmetry (left slightly larger than right, like real brains)
  asymmetry: 0.02,
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
