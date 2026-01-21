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
 * Smooth interpolation helper (ease in/out)
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Gaussian falloff for organic transitions
 */
function gaussian(x: number, sigma: number): number {
  return Math.exp(-(x * x) / (2 * sigma * sigma))
}

/**
 * Simple deterministic noise for organic surface variation
 */
function organicNoise(x: number, y: number, z: number, frequency: number): number {
  const fx = Math.sin(x * frequency * 1.7 + y * 2.3) * 0.5 + 0.5
  const fy = Math.sin(y * frequency * 2.1 + z * 1.9) * 0.5 + 0.5
  const fz = Math.sin(z * frequency * 1.5 + x * 2.7) * 0.5 + 0.5
  return (fx * fy * fz) * 2 - 0.5
}

/**
 * Generate an anatomically-inspired brain shape using custom vertex positioning.
 * Creates a realistic brain with:
 * - Two hemispheres with visible longitudinal fissure
 * - Rounded frontal lobes
 * - Slightly pointed occipital region
 * - Temporal lobe bulges
 * - Parietal dome
 * - Cerebellum hint at the back-bottom
 *
 * @param width - Left-right extent
 * @param height - Top-bottom extent
 * @param depth - Front-back extent
 * @param segments - Mesh resolution
 * @param params - Brain development parameters (belt-specific)
 */
function createBrainGeometry(
  width: number,
  height: number,
  depth: number,
  segments: number,
  params: BrainDevelopmentParams
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()

  const phiSegments = segments
  const thetaSegments = segments * 2

  const vertices: number[] = []
  const indices: number[] = []

  // Generate vertices on a brain-shaped surface
  for (let phi = 0; phi <= phiSegments; phi++) {
    // phi: 0 = top (Z+), PI = bottom (Z-)
    const phiRatio = phi / phiSegments
    const phiAngle = phiRatio * Math.PI

    for (let theta = 0; theta <= thetaSegments; theta++) {
      // theta: 0 = front (-Y), PI = back (+Y), wraps around
      const thetaRatio = theta / thetaSegments
      const thetaAngle = thetaRatio * Math.PI * 2

      // Base spherical coordinates (normalized)
      const baseX = Math.sin(phiAngle) * Math.cos(thetaAngle)
      const baseY = Math.sin(phiAngle) * Math.sin(thetaAngle)
      const baseZ = Math.cos(phiAngle)

      // Start with unit sphere radius
      let radius = 1.0

      // ==================================================================
      // 1. LONGITUDINAL FISSURE - Groove between hemispheres
      // Runs front-to-back along the top midline
      // ==================================================================
      const fissureX = Math.abs(baseX) // Distance from midline
      const fissureFalloff = gaussian(fissureX, params.fissureWidth)
      const topInfluence = smoothstep(0, 0.7, baseZ) // Only on top half
      const fissureDepression = params.fissureDepth * fissureFalloff * topInfluence
      radius -= fissureDepression

      // ==================================================================
      // 2. FRONTAL LOBE - Rounded bulge at the front
      // Front is -Y direction, bulges forward and slightly down
      // ==================================================================
      const frontalDirection = -baseY // Positive when facing front
      const frontalFalloff = smoothstep(0, 1, frontalDirection) * smoothstep(-0.3, 0.5, baseZ)
      const frontalHemisphereFalloff = 1 - Math.abs(baseX) * 0.4 // Less at edges
      radius += params.frontalBulge * frontalFalloff * frontalHemisphereFalloff

      // ==================================================================
      // 3. TEMPORAL LOBES - Bulges on the sides, lower half
      // Creates the characteristic "ear" bumps
      // ==================================================================
      const temporalSide = Math.abs(baseX) // Distance from center
      const temporalHeight = smoothstep(0.3, -0.2, baseZ) // Lower half
      const temporalFront = smoothstep(-0.5, 0.3, -baseY) // Slightly forward
      const temporalBulge = temporalSide * temporalHeight * temporalFront
      radius += params.temporalBulge * temporalBulge

      // ==================================================================
      // 4. OCCIPITAL REGION - Slightly pointed back
      // Back is +Y direction
      // ==================================================================
      const occipitalDirection = baseY // Positive when facing back
      const occipitalFalloff = smoothstep(0.3, 1, occipitalDirection)
      const occipitalMidline = gaussian(baseX, 0.5) // Strongest at midline
      const occipitalHeight = smoothstep(-0.3, 0.3, baseZ) // Mid height
      // Slight point effect: add at back center, reduce at edges
      radius += params.occipitalPoint * occipitalFalloff * occipitalMidline * occipitalHeight * 0.5
      // Slight taper at back
      radius -= params.occipitalPoint * occipitalFalloff * (1 - occipitalMidline) * 0.3

      // ==================================================================
      // 5. PARIETAL DOME - Rounded top-back area
      // ==================================================================
      const parietalHeight = smoothstep(0.2, 0.8, baseZ) // Upper region
      const parietalBack = smoothstep(-0.3, 0.5, baseY) // Toward back
      const parietalDome = parietalHeight * parietalBack * (1 - fissureFalloff * 0.5)
      radius += params.parietalRound * parietalDome * 0.5

      // ==================================================================
      // 6. CEREBELLUM HINT - Small bulge at back-bottom
      // ==================================================================
      const cerebellumBack = smoothstep(0.2, 0.8, baseY) // Back region
      const cerebellumBottom = smoothstep(0, -0.5, baseZ) // Bottom region
      const cerebellumMidline = gaussian(baseX, 0.4)
      radius += params.cerebellumBulge * cerebellumBack * cerebellumBottom * cerebellumMidline

      // ==================================================================
      // 7. NATURAL ASYMMETRY - Left hemisphere slightly larger
      // ==================================================================
      if (baseX < 0) {
        radius += params.asymmetry
      }

      // ==================================================================
      // 8. GYRIFICATION - Subtle surface complexity
      // More developed brains have more folding
      // ==================================================================
      const gyriNoise = organicNoise(baseX * 3, baseY * 3, baseZ * 3, 4)
      radius += params.gyrification * gyriNoise * 0.5

      // Second frequency for more organic feel
      const gyriNoise2 = organicNoise(baseX * 5, baseY * 5, baseZ * 5, 7)
      radius += params.gyrification * gyriNoise2 * 0.3

      // ==================================================================
      // 9. OVERALL BRAIN SHAPE - Ellipsoid scaling
      // Brain is wider than tall, and slightly shorter front-to-back
      // ==================================================================
      const scaledX = baseX * radius * (width / 2) * params.scale * 1.1  // Wider
      const scaledY = baseY * radius * (depth / 2) * params.scale * 0.95 // Slightly shorter
      const scaledZ = baseZ * radius * (height / 2) * params.scale       // Normal height

      vertices.push(scaledX, scaledY, scaledZ)
    }
  }

  // Generate indices for triangles
  for (let phi = 0; phi < phiSegments; phi++) {
    for (let theta = 0; theta < thetaSegments; theta++) {
      const first = phi * (thetaSegments + 1) + theta
      const second = first + thetaSegments + 1

      // Two triangles per quad
      indices.push(first, second, first + 1)
      indices.push(second, second + 1, first + 1)
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
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
  params: BrainDevelopmentParams,
  scale: number = 0.75
): THREE.BufferGeometry {
  // Create slightly simpler inner geometry
  const innerParams = { ...params }
  // Inner brain has less surface detail
  innerParams.gyrification *= 0.5

  const geometry = createBrainGeometry(
    width * scale,
    height * scale,
    depth * scale,
    Math.max(24, Math.floor(segments * 0.6)),
    innerParams
  )
  return geometry
}

/**
 * Interpolate between two brain parameter sets for smooth morphing
 */
function interpolateBrainParams(
  from: BrainDevelopmentParams,
  to: BrainDevelopmentParams,
  t: number
): BrainDevelopmentParams {
  const lerp = (a: number, b: number) => a + (b - a) * t

  return {
    scale: lerp(from.scale, to.scale),
    fissureDepth: lerp(from.fissureDepth, to.fissureDepth),
    fissureWidth: lerp(from.fissureWidth, to.fissureWidth),
    frontalBulge: lerp(from.frontalBulge, to.frontalBulge),
    temporalBulge: lerp(from.temporalBulge, to.temporalBulge),
    occipitalPoint: lerp(from.occipitalPoint, to.occipitalPoint),
    parietalRound: lerp(from.parietalRound, to.parietalRound),
    cerebellumBulge: lerp(from.cerebellumBulge, to.cerebellumBulge),
    gyrification: lerp(from.gyrification, to.gyrification),
    asymmetry: lerp(from.asymmetry, to.asymmetry),
  }
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
  const currentBelt: Ref<BeltLevel> = ref(cfg.belt)

  // Store references for updates
  let outerMaterial: THREE.LineBasicMaterial | null = null
  let innerMaterial: THREE.LineBasicMaterial | null = null
  let outerGeometry: THREE.BufferGeometry | null = null
  let innerGeometry: THREE.BufferGeometry | null = null
  let wireframeGeometry: THREE.WireframeGeometry | null = null
  let innerWireframeGeometry: THREE.WireframeGeometry | null = null
  let outerWireframeMesh: THREE.LineSegments | null = null
  let innerWireframeMesh: THREE.LineSegments | null = null

  // Store base dimensions for rebuilding
  let baseDimensions = { width: 0, height: 0, depth: 0 }

  // Animation state
  let morphAnimationId: number | null = null
  let currentParams: BrainDevelopmentParams = BELT_BRAIN_PARAMS[cfg.belt]

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

    // Store dimensions for rebuilding during morphing
    baseDimensions = { width, height, depth }

    // Get current belt parameters
    currentParams = BELT_BRAIN_PARAMS[currentBelt.value]

    // Create a group to hold both wireframe layers
    const group = new THREE.Group()
    group.name = 'brain-wireframe'

    // Parse color
    const color = new THREE.Color(cfg.color)

    // Create outer brain geometry with anatomical features
    outerGeometry = createBrainGeometry(width, height, depth, cfg.segments, currentParams)
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
    outerWireframeMesh = new THREE.LineSegments(wireframeGeometry, outerMaterial)
    outerWireframeMesh.name = 'brain-wireframe-outer'
    group.add(outerWireframeMesh)

    // Create inner brain geometry for depth
    innerGeometry = createInnerBrainGeometry(width, height, depth, cfg.segments, currentParams, 0.70)
    innerWireframeGeometry = new THREE.WireframeGeometry(innerGeometry)

    // Create inner wireframe material (slightly more transparent)
    innerMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: cfg.opacity * 0.4,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })

    // Create inner wireframe mesh
    innerWireframeMesh = new THREE.LineSegments(innerWireframeGeometry, innerMaterial)
    innerWireframeMesh.name = 'brain-wireframe-inner'
    group.add(innerWireframeMesh)

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
      belt: currentBelt.value,
    })

    return group
  }

  /**
   * Rebuild the wireframe geometry with new parameters
   * Used during morphing animation
   */
  function rebuildGeometry(params: BrainDevelopmentParams): void {
    if (!mesh.value || baseDimensions.width === 0) return

    const { width, height, depth } = baseDimensions
    const group = mesh.value as THREE.Group

    // Dispose old geometries
    if (outerGeometry) outerGeometry.dispose()
    if (innerGeometry) innerGeometry.dispose()
    if (wireframeGeometry) wireframeGeometry.dispose()
    if (innerWireframeGeometry) innerWireframeGeometry.dispose()

    // Create new outer geometry
    outerGeometry = createBrainGeometry(width, height, depth, cfg.segments, params)
    wireframeGeometry = new THREE.WireframeGeometry(outerGeometry)

    // Update outer wireframe
    if (outerWireframeMesh) {
      outerWireframeMesh.geometry.dispose()
      outerWireframeMesh.geometry = wireframeGeometry
    }

    // Create new inner geometry
    innerGeometry = createInnerBrainGeometry(width, height, depth, cfg.segments, params, 0.70)
    innerWireframeGeometry = new THREE.WireframeGeometry(innerGeometry)

    // Update inner wireframe
    if (innerWireframeMesh) {
      innerWireframeMesh.geometry.dispose()
      innerWireframeMesh.geometry = innerWireframeGeometry
    }
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
      innerMaterial.opacity = clampedOpacity * 0.4
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

  /**
   * Morph the brain wireframe to a specific belt developmental stage.
   * Animates smoothly between the current state and the target belt's brain shape.
   *
   * @param belt - The target belt level
   */
  function setBeltLevel(belt: BeltLevel): void {
    if (belt === currentBelt.value) return

    // Cancel any ongoing morphing animation
    if (morphAnimationId !== null) {
      cancelAnimationFrame(morphAnimationId)
      morphAnimationId = null
    }

    const fromParams = { ...currentParams }
    const toParams = BELT_BRAIN_PARAMS[belt]
    const previousBelt = currentBelt.value

    // Update the belt reference
    currentBelt.value = belt

    // Animation parameters
    const duration = 1200 // 1.2 seconds for smooth organic transition
    const startTime = performance.now()

    // Ease function for organic feel
    const easeInOutCubic = (t: number): number => {
      return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2
    }

    function animate(currentTime: number): void {
      const elapsed = currentTime - startTime
      const rawProgress = Math.min(elapsed / duration, 1)
      const progress = easeInOutCubic(rawProgress)

      // Interpolate parameters
      const interpolatedParams = interpolateBrainParams(fromParams, toParams, progress)

      // Rebuild geometry with interpolated params
      rebuildGeometry(interpolatedParams)

      // Update current params for potential interruption
      currentParams = interpolatedParams

      if (rawProgress < 1) {
        morphAnimationId = requestAnimationFrame(animate)
      } else {
        morphAnimationId = null
        currentParams = toParams
        console.log('[useBrainWireframe] Belt morphing complete', {
          from: previousBelt,
          to: belt,
        })
      }
    }

    console.log('[useBrainWireframe] Starting belt morph', {
      from: previousBelt,
      to: belt,
    })

    morphAnimationId = requestAnimationFrame(animate)
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Dispose of all Three.js resources
   */
  function dispose(): void {
    // Cancel any ongoing animation
    if (morphAnimationId !== null) {
      cancelAnimationFrame(morphAnimationId)
      morphAnimationId = null
    }

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

    outerWireframeMesh = null
    innerWireframeMesh = null
    mesh.value = null
    baseDimensions = { width: 0, height: 0, depth: 0 }

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
    setBeltLevel,
    dispose,
    mesh,
    isVisible,
    currentBelt,
  }
}

// Export types
export type UseBrainWireframe = ReturnType<typeof useBrainWireframe>
