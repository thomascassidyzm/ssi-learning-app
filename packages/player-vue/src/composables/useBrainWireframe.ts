/**
 * useBrainWireframe - Glowing Polygonal Brain Mesh
 *
 * Creates a stylized brain visualization matching the reference image:
 * - Recognizable brain silhouette (frontal lobe, temporal, cerebellum, brain stem)
 * - Glowing vertices at mesh intersection points
 * - Triangulated mesh lines connecting vertices
 * - Deep blue glow aesthetic with higher luminosity
 *
 * The brain shape is generated from a 2D profile curve extruded and rotated
 * to create the characteristic brain silhouette that's immediately recognizable.
 */

import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'

// ============================================================================
// TYPES
// ============================================================================

export interface BrainWireframeConfig {
  /** Base opacity for the wireframe lines (default: 0.6) */
  opacity?: number
  /** Base color for wireframe and vertices (default: '#4a90d9') */
  color?: string
  /** Vertex glow intensity (default: 1.0) */
  glowIntensity?: number
  /** Vertex size (default: 4.0) */
  vertexSize?: number
  /** Show the wireframe (default: true) */
  visible?: boolean
  /** Initial belt level (default: 'white') */
  belt?: BeltLevel
}

export type BeltLevel = 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'purple' | 'brown' | 'black'

export interface BrainWireframeReturn {
  createWireframe: (width: number, height: number, depth: number) => THREE.Object3D
  setColor: (color: string) => void
  setOpacity: (opacity: number) => void
  setVisible: (visible: boolean) => void
  setBeltLevel: (belt: BeltLevel) => void
  /** Pulse the brain glow (for phrase playback) */
  pulse: (intensity?: number, duration?: number) => void
  /** Highlight specific region (future: for lobe-specific highlighting) */
  highlightRegion: (region: 'frontal' | 'temporal' | 'parietal' | 'occipital' | 'all', intensity?: number) => void
  dispose: () => void
  mesh: ShallowRef<THREE.Object3D | null>
  isVisible: Ref<boolean>
  currentBelt: Ref<BeltLevel>
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: Required<BrainWireframeConfig> = {
  opacity: 0.5,
  color: '#4a90d9',  // Deep blue like reference
  glowIntensity: 1.0,
  vertexSize: 3.0,
  visible: true,
  belt: 'white',
}

// Belt-specific scale multipliers (brain grows with learning)
const BELT_SCALES: Record<BeltLevel, number> = {
  white: 0.75,
  yellow: 0.80,
  orange: 0.87,
  green: 0.92,
  blue: 0.96,
  purple: 0.98,
  brown: 1.0,
  black: 1.05,
}

// ============================================================================
// BRAIN PROFILE GENERATION
// ============================================================================

/**
 * Generate the 2D brain profile curve points.
 * This creates the recognizable brain silhouette from a side view.
 * The curve is defined in the X-Y plane where:
 * - X is forward-backward (positive = front/frontal lobe)
 * - Y is up-down (positive = top)
 */
function generateBrainProfile(numPoints: number = 64): THREE.Vector2[] {
  const points: THREE.Vector2[] = []

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints  // 0 to 1
    const angle = t * Math.PI * 2  // Full rotation

    // Base radius
    let r = 1.0

    // Frontal lobe bulge (front-top)
    const frontalAngle = Math.PI * 0.3  // ~55 degrees from top
    const frontalDist = Math.abs(angle - frontalAngle)
    r += 0.15 * Math.exp(-frontalDist * frontalDist * 2)

    // Parietal dome (top-back)
    const parietalAngle = Math.PI * 0.6  // ~110 degrees
    const parietalDist = Math.abs(angle - parietalAngle)
    r += 0.08 * Math.exp(-parietalDist * parietalDist * 1.5)

    // Occipital bulge (back)
    const occipitalAngle = Math.PI * 0.85  // ~150 degrees
    const occipitalDist = Math.abs(angle - occipitalAngle)
    r += 0.1 * Math.exp(-occipitalDist * occipitalDist * 2)

    // Cerebellum (back-bottom) - distinct bulge
    const cerebellumAngle = Math.PI * 1.1  // ~200 degrees
    const cerebellumDist = Math.abs(angle - cerebellumAngle)
    r += 0.18 * Math.exp(-cerebellumDist * cerebellumDist * 4)

    // Brain stem indentation (bottom-back)
    const stemAngle = Math.PI * 1.25  // ~225 degrees
    const stemDist = Math.abs(angle - stemAngle)
    r -= 0.25 * Math.exp(-stemDist * stemDist * 6)

    // Temporal lobe (side-bottom)
    const temporalAngle = Math.PI * 1.5  // ~270 degrees (bottom)
    const temporalDist = Math.abs(angle - temporalAngle)
    r += 0.05 * Math.exp(-temporalDist * temporalDist * 1.5)

    // Front-bottom curve (under frontal lobe)
    const frontBottomAngle = Math.PI * 1.8  // ~325 degrees
    const frontBottomDist = Math.abs(angle - frontBottomAngle)
    r -= 0.1 * Math.exp(-frontBottomDist * frontBottomDist * 3)

    // Convert to cartesian
    const x = Math.cos(angle) * r
    const y = Math.sin(angle) * r

    points.push(new THREE.Vector2(x, y))
  }

  return points
}

/**
 * Create the 3D brain mesh by revolving the profile and adding bilateral asymmetry.
 * The brain is created as two hemispheres with a visible longitudinal fissure.
 */
function createBrainMesh(
  width: number,
  height: number,
  depth: number,
  segments: number,
  scale: number
): { geometry: THREE.BufferGeometry; vertices: Float32Array } {
  const profile = generateBrainProfile(segments)

  // Revolution parameters
  const radialSegments = Math.floor(segments * 1.5)
  const vertices: number[] = []
  const indices: number[] = []

  // Generate vertices by revolving the profile
  for (let i = 0; i <= radialSegments; i++) {
    const theta = (i / radialSegments) * Math.PI * 2
    const cosTheta = Math.cos(theta)
    const sinTheta = Math.sin(theta)

    for (let j = 0; j < profile.length; j++) {
      const p = profile[j]

      // Revolve around Y axis (up)
      // X in profile becomes radial distance
      // Y in profile stays as Y (height)
      let x = p.x * cosTheta
      let y = p.y
      let z = p.x * sinTheta

      // Add longitudinal fissure (groove at top-center)
      const topness = Math.max(0, y)  // Only affect top half
      const centerDist = Math.abs(x)  // Distance from center (X=0)
      const fissureWidth = 0.15
      const fissureFalloff = Math.exp(-centerDist * centerDist / (fissureWidth * fissureWidth))
      y -= topness * fissureFalloff * 0.12  // Indent at top center

      // Add natural asymmetry (left hemisphere slightly larger)
      if (x < 0) {
        x *= 1.02
      }

      // Scale to final dimensions
      x *= (width / 2) * scale
      y *= (height / 2) * scale
      z *= (depth / 2) * scale

      // Shift so brain stem is at origin height (not floating)
      y += height * 0.1 * scale

      vertices.push(x, y, z)
    }
  }

  // Generate triangle indices
  const profileLen = profile.length
  for (let i = 0; i < radialSegments; i++) {
    for (let j = 0; j < profileLen - 1; j++) {
      const a = i * profileLen + j
      const b = a + profileLen
      const c = a + 1
      const d = b + 1

      // Two triangles per quad
      indices.push(a, b, c)
      indices.push(b, d, c)
    }
  }

  const geometry = new THREE.BufferGeometry()
  const vertexArray = new Float32Array(vertices)
  geometry.setAttribute('position', new THREE.BufferAttribute(vertexArray, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return { geometry, vertices: vertexArray }
}

/**
 * Create glowing vertex points at each mesh vertex
 */
function createVertexPoints(
  vertices: Float32Array,
  color: THREE.Color,
  size: number,
  opacity: number
): THREE.Points {
  // Sample vertices (not all - would be too dense)
  const sampledVertices: number[] = []
  const sampleRate = 3  // Take every Nth vertex

  for (let i = 0; i < vertices.length; i += 3 * sampleRate) {
    sampledVertices.push(vertices[i], vertices[i + 1], vertices[i + 2])
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sampledVertices, 3))

  // Vertex shader for glowing points
  const vertexShader = `
    uniform float uSize;
    uniform float uScale;
    varying float vDistance;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vDistance = length(mvPosition.xyz);
      gl_PointSize = uSize * uScale * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `

  const fragmentShader = `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uGlowIntensity;
    varying float vDistance;

    void main() {
      // Create circular point with soft edges (glow)
      float distFromCenter = length(gl_PointCoord - vec2(0.5));

      // Core (bright center)
      float core = 1.0 - smoothstep(0.0, 0.2, distFromCenter);

      // Inner glow
      float innerGlow = 1.0 - smoothstep(0.0, 0.4, distFromCenter);

      // Outer glow (softer, larger)
      float outerGlow = 1.0 - smoothstep(0.0, 0.5, distFromCenter);

      // Combine glows
      float alpha = core * 0.9 + innerGlow * 0.4 + outerGlow * 0.15;
      alpha *= uOpacity * uGlowIntensity;

      // Brighten the color for the core
      vec3 finalColor = uColor;
      finalColor = mix(finalColor, vec3(1.0), core * 0.6);  // Whiten at core

      if (alpha < 0.01) discard;

      gl_FragColor = vec4(finalColor, alpha);
    }
  `

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uSize: { value: size },
      uScale: { value: 1.0 },
      uOpacity: { value: opacity },
      uGlowIntensity: { value: 1.0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'brain-vertices'
  points.frustumCulled = false

  return points
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
  let wireframeMesh: THREE.LineSegments | null = null
  let vertexPoints: THREE.Points | null = null
  let wireframeMaterial: THREE.LineBasicMaterial | null = null
  let vertexMaterial: THREE.ShaderMaterial | null = null
  let brainGeometry: THREE.BufferGeometry | null = null
  let wireframeGeometry: THREE.WireframeGeometry | null = null

  // Store base dimensions
  let baseDimensions = { width: 0, height: 0, depth: 0 }

  // Animation state
  let pulseAnimationId: number | null = null

  // ============================================================================
  // CREATION
  // ============================================================================

  function createWireframe(width: number, height: number, depth: number): THREE.Object3D {
    dispose()

    baseDimensions = { width, height, depth }
    const scale = BELT_SCALES[currentBelt.value]
    const color = new THREE.Color(cfg.color)

    // Create brain mesh
    const { geometry, vertices } = createBrainMesh(width, height, depth, 48, scale)
    brainGeometry = geometry

    // Create wireframe from the brain mesh
    wireframeGeometry = new THREE.WireframeGeometry(brainGeometry)

    wireframeMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: cfg.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial)
    wireframeMesh.name = 'brain-wireframe-lines'

    // Create glowing vertex points
    vertexPoints = createVertexPoints(vertices, color, cfg.vertexSize, cfg.opacity * 1.5)

    // Create group
    const group = new THREE.Group()
    group.name = 'brain-wireframe'
    group.add(wireframeMesh)
    group.add(vertexPoints)

    // Rotate to correct orientation (front facing camera)
    // The brain profile is in X-Y plane, we rotate so it faces -Z
    group.rotation.y = Math.PI * 0.5  // Rotate 90 degrees so front faces camera

    group.visible = isVisible.value
    mesh.value = group

    // Store vertex material reference
    vertexMaterial = vertexPoints.material as THREE.ShaderMaterial

    console.log('[useBrainWireframe] Created glowing brain wireframe', {
      width, height, depth,
      scale,
      belt: currentBelt.value,
      vertexCount: vertices.length / 3,
    })

    return group
  }

  // ============================================================================
  // UPDATES
  // ============================================================================

  function setColor(color: string): void {
    const threeColor = new THREE.Color(color)

    if (wireframeMaterial) {
      wireframeMaterial.color = threeColor
    }
    if (vertexMaterial) {
      vertexMaterial.uniforms.uColor.value = threeColor
    }
  }

  function setOpacity(opacity: number): void {
    const clamped = Math.max(0, Math.min(1, opacity))

    if (wireframeMaterial) {
      wireframeMaterial.opacity = clamped
    }
    if (vertexMaterial) {
      vertexMaterial.uniforms.uOpacity.value = clamped * 1.5
    }
  }

  function setVisible(visible: boolean): void {
    isVisible.value = visible
    if (mesh.value) {
      mesh.value.visible = visible
    }
  }

  function setBeltLevel(belt: BeltLevel): void {
    if (belt === currentBelt.value) return

    currentBelt.value = belt

    // Rebuild with new scale
    if (baseDimensions.width > 0 && mesh.value) {
      const parent = mesh.value.parent
      if (parent) {
        parent.remove(mesh.value)
        dispose()
        const newMesh = createWireframe(baseDimensions.width, baseDimensions.height, baseDimensions.depth)
        parent.add(newMesh)
      }
    }

    console.log('[useBrainWireframe] Belt level changed to', belt)
  }

  /**
   * Pulse the brain glow (useful during phrase playback)
   */
  function pulse(intensity: number = 1.5, duration: number = 500): void {
    if (pulseAnimationId !== null) {
      cancelAnimationFrame(pulseAnimationId)
    }

    if (!vertexMaterial) return

    const startTime = performance.now()
    const baseGlow = 1.0

    function animate(time: number): void {
      const elapsed = time - startTime
      const progress = Math.min(elapsed / duration, 1)

      // Ease out - quick rise, slow fall
      const eased = 1 - Math.pow(progress, 2)
      const currentIntensity = baseGlow + (intensity - baseGlow) * eased

      if (vertexMaterial) {
        vertexMaterial.uniforms.uGlowIntensity.value = currentIntensity
      }

      if (progress < 1) {
        pulseAnimationId = requestAnimationFrame(animate)
      } else {
        pulseAnimationId = null
      }
    }

    pulseAnimationId = requestAnimationFrame(animate)
  }

  /**
   * Highlight a specific brain region (placeholder for future implementation)
   */
  function highlightRegion(
    region: 'frontal' | 'temporal' | 'parietal' | 'occipital' | 'all',
    intensity: number = 1.5
  ): void {
    // For now, just pulse the whole brain
    // Future: Could implement per-vertex coloring based on region
    pulse(intensity, 800)
    console.log('[useBrainWireframe] Highlighting region:', region)
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  function dispose(): void {
    if (pulseAnimationId !== null) {
      cancelAnimationFrame(pulseAnimationId)
      pulseAnimationId = null
    }

    if (brainGeometry) {
      brainGeometry.dispose()
      brainGeometry = null
    }
    if (wireframeGeometry) {
      wireframeGeometry.dispose()
      wireframeGeometry = null
    }
    if (wireframeMaterial) {
      wireframeMaterial.dispose()
      wireframeMaterial = null
    }
    if (vertexMaterial) {
      vertexMaterial.dispose()
      vertexMaterial = null
    }
    if (vertexPoints?.geometry) {
      vertexPoints.geometry.dispose()
    }

    wireframeMesh = null
    vertexPoints = null
    mesh.value = null
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
    pulse,
    highlightRegion,
    dispose,
    mesh,
    isVisible,
    currentBelt,
  }
}

export type UseBrainWireframe = ReturnType<typeof useBrainWireframe>
