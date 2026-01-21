/**
 * useBrainScene - Three.js Foundation for 3D Brain Network Visualization
 *
 * Creates a WebGL 3D scene for visualizing a "brain network" - the learner's
 * growing neural connections as they learn a language.
 *
 * Design philosophy:
 * - Dark, cosmic, subtle - like looking at something alive in space
 * - "Your brain on Spanish" - should feel organic and mysterious
 * - Museum exhibit feel - slowly rotating, inviting exploration
 *
 * Usage:
 *   const brainScene = useBrainScene()
 *   brainScene.init(containerElement)
 *   brainScene.startLoop()
 *   // ... later
 *   brainScene.dispose()
 */

import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// ============================================================================
// TYPES
// ============================================================================

export interface BrainSceneConfig {
  /** Background color (default: #050508 - matches app dark theme) */
  backgroundColor?: number | 'transparent'
  /** Enable antialiasing (default: true) */
  antialias?: boolean
  /** Auto-rotation speed in radians per second (default: 0.1) */
  autoRotateSpeed?: number
  /** Enable auto-rotation (default: true) */
  autoRotate?: boolean
  /** Minimum zoom distance (default: 2) */
  minDistance?: number
  /** Maximum zoom distance (default: 20) */
  maxDistance?: number
  /** Initial camera distance (default: 8) */
  cameraDistance?: number
  /** Camera field of view (default: 60) */
  fov?: number
  /** Enable damping for smooth controls (default: true) */
  enableDamping?: boolean
  /** Damping factor (default: 0.05) */
  dampingFactor?: number
}

export interface BrainSceneReturn {
  // Core Three.js objects (shallow refs for performance)
  scene: ShallowRef<THREE.Scene | null>
  camera: ShallowRef<THREE.PerspectiveCamera | null>
  renderer: ShallowRef<THREE.WebGLRenderer | null>
  controls: ShallowRef<OrbitControls | null>

  // Lifecycle methods
  init: (container: HTMLElement) => void
  dispose: () => void
  resize: () => void
  render: () => void
  startLoop: () => void
  stopLoop: () => void

  // State
  isAutoRotating: Ref<boolean>
  isInitialized: Ref<boolean>
  isLoopRunning: Ref<boolean>
  setAutoRotate: (enabled: boolean) => void
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: Required<BrainSceneConfig> = {
  backgroundColor: 0x050508,
  antialias: true,
  autoRotateSpeed: 0.1,
  autoRotate: true,
  minDistance: 2,
  maxDistance: 20,
  cameraDistance: 8,
  fov: 60,
  enableDamping: true,
  dampingFactor: 0.05,
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useBrainScene(config: BrainSceneConfig = {}): BrainSceneReturn {
  // Merge config with defaults
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // ============================================================================
  // STATE
  // ============================================================================

  // Core Three.js objects (use shallowRef for performance - these are complex objects)
  const scene: ShallowRef<THREE.Scene | null> = shallowRef(null)
  const camera: ShallowRef<THREE.PerspectiveCamera | null> = shallowRef(null)
  const renderer: ShallowRef<THREE.WebGLRenderer | null> = shallowRef(null)
  const controls: ShallowRef<OrbitControls | null> = shallowRef(null)

  // Internal state
  const isAutoRotating = ref(cfg.autoRotate)
  const isInitialized = ref(false)
  const isLoopRunning = ref(false)

  // Animation frame ID for cleanup
  let animationFrameId: number | null = null

  // Container reference for resize handling
  let container: HTMLElement | null = null

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the Three.js scene with all components
   * @param containerElement - The DOM element to render into
   */
  function init(containerElement: HTMLElement): void {
    if (isInitialized.value) {
      console.warn('[useBrainScene] Already initialized. Call dispose() first to reinitialize.')
      return
    }

    container = containerElement

    // Apply will-change for better performance
    container.style.willChange = 'transform'

    // Get container dimensions
    const width = container.clientWidth
    const height = container.clientHeight
    const aspect = width / height

    // ========== SCENE ==========
    const newScene = new THREE.Scene()

    // Background - dark cosmic void
    if (cfg.backgroundColor === 'transparent') {
      newScene.background = null
    } else {
      newScene.background = new THREE.Color(cfg.backgroundColor)
    }

    // Optional: Add subtle fog for depth
    newScene.fog = new THREE.FogExp2(cfg.backgroundColor === 'transparent' ? 0x050508 : cfg.backgroundColor, 0.02)

    scene.value = newScene

    // ========== CAMERA ==========
    const newCamera = new THREE.PerspectiveCamera(cfg.fov, aspect, 0.1, 1000)

    // Position camera to look at center from a good angle
    newCamera.position.set(0, cfg.cameraDistance * 0.3, cfg.cameraDistance)
    newCamera.lookAt(0, 0, 0)

    camera.value = newCamera

    // ========== RENDERER ==========
    const newRenderer = new THREE.WebGLRenderer({
      antialias: cfg.antialias,
      alpha: cfg.backgroundColor === 'transparent',
      powerPreference: 'high-performance',
    })

    // Handle devicePixelRatio for crisp rendering on retina displays
    const pixelRatio = Math.min(window.devicePixelRatio, 2) // Cap at 2x for performance
    newRenderer.setPixelRatio(pixelRatio)
    newRenderer.setSize(width, height)

    // Enable shadows for depth (optional, can be toggled for performance)
    newRenderer.shadowMap.enabled = false // Disabled by default for performance
    newRenderer.shadowMap.type = THREE.PCFSoftShadowMap

    // Tone mapping for better visual quality
    newRenderer.toneMapping = THREE.ACESFilmicToneMapping
    newRenderer.toneMappingExposure = 1.0

    // Append canvas to container
    container.appendChild(newRenderer.domElement)

    renderer.value = newRenderer

    // ========== LIGHTING ==========
    setupLighting(newScene)

    // ========== CONTROLS ==========
    const newControls = new OrbitControls(newCamera, newRenderer.domElement)

    // Auto-rotate like a museum exhibit
    newControls.autoRotate = isAutoRotating.value
    newControls.autoRotateSpeed = cfg.autoRotateSpeed * 10 // OrbitControls uses a different scale

    // Zoom limits
    newControls.minDistance = cfg.minDistance
    newControls.maxDistance = cfg.maxDistance

    // Smooth controls
    newControls.enableDamping = cfg.enableDamping
    newControls.dampingFactor = cfg.dampingFactor

    // Enable touch support
    newControls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    }

    // Disable pan for simpler interaction (just rotate and zoom)
    newControls.enablePan = false

    // Stop auto-rotate when user interacts
    newControls.addEventListener('start', () => {
      if (isAutoRotating.value) {
        newControls.autoRotate = false
      }
    })

    // Resume auto-rotate after interaction ends (with delay)
    let autoRotateTimeout: ReturnType<typeof setTimeout> | null = null
    newControls.addEventListener('end', () => {
      if (isAutoRotating.value) {
        // Clear any existing timeout
        if (autoRotateTimeout) {
          clearTimeout(autoRotateTimeout)
        }
        // Resume auto-rotate after 3 seconds of no interaction
        autoRotateTimeout = setTimeout(() => {
          if (controls.value && isAutoRotating.value) {
            controls.value.autoRotate = true
          }
        }, 3000)
      }
    })

    controls.value = newControls

    // ========== RESIZE HANDLING ==========
    // Note: We don't add a window resize listener here - resize() should be called
    // by the parent component when needed (e.g., via ResizeObserver)

    isInitialized.value = true

    console.log('[useBrainScene] Initialized', {
      width,
      height,
      pixelRatio,
      autoRotate: isAutoRotating.value,
    })
  }

  /**
   * Set up scene lighting
   * Creates ambient lighting + subtle point lights for depth
   */
  function setupLighting(targetScene: THREE.Scene): void {
    // Ambient light - soft overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    targetScene.add(ambientLight)

    // Main point light - from above-front for subtle highlights
    const mainLight = new THREE.PointLight(0xffffff, 0.6, 100)
    mainLight.position.set(5, 10, 5)
    targetScene.add(mainLight)

    // Fill light - subtle from below to reduce harsh shadows
    const fillLight = new THREE.PointLight(0x4466ff, 0.2, 100)
    fillLight.position.set(-5, -5, 5)
    targetScene.add(fillLight)

    // Rim light - from behind for subtle edge glow
    const rimLight = new THREE.PointLight(0xff6644, 0.15, 100)
    rimLight.position.set(0, 0, -10)
    targetScene.add(rimLight)

    console.log('[useBrainScene] Lighting configured')
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Clean up all Three.js resources
   * IMPORTANT: Must be called when component unmounts to prevent memory leaks
   */
  function dispose(): void {
    // Stop animation loop
    stopLoop()

    // Dispose controls
    if (controls.value) {
      controls.value.dispose()
      controls.value = null
    }

    // Dispose renderer and remove canvas
    if (renderer.value) {
      renderer.value.dispose()
      renderer.value.domElement.remove()
      renderer.value = null
    }

    // Dispose scene objects
    if (scene.value) {
      disposeSceneObjects(scene.value)
      scene.value = null
    }

    // Clear camera
    camera.value = null

    // Clear container reference
    if (container) {
      container.style.willChange = 'auto'
      container = null
    }

    isInitialized.value = false

    console.log('[useBrainScene] Disposed')
  }

  /**
   * Recursively dispose of all objects in a scene
   */
  function disposeSceneObjects(obj: THREE.Object3D): void {
    // Dispose children first
    while (obj.children.length > 0) {
      const child = obj.children[0]
      disposeSceneObjects(child)
      obj.remove(child)
    }

    // Dispose geometry
    if ((obj as THREE.Mesh).geometry) {
      (obj as THREE.Mesh).geometry.dispose()
    }

    // Dispose material(s)
    if ((obj as THREE.Mesh).material) {
      const material = (obj as THREE.Mesh).material
      if (Array.isArray(material)) {
        material.forEach((m) => disposeMaterial(m))
      } else {
        disposeMaterial(material)
      }
    }
  }

  /**
   * Dispose a material and its textures
   */
  function disposeMaterial(material: THREE.Material): void {
    // Dispose textures
    const textureProps = ['map', 'lightMap', 'bumpMap', 'normalMap', 'specularMap', 'envMap', 'alphaMap', 'aoMap', 'displacementMap', 'emissiveMap', 'roughnessMap', 'metalnessMap'] as const

    for (const prop of textureProps) {
      if ((material as any)[prop]) {
        (material as any)[prop].dispose()
      }
    }

    material.dispose()
  }

  /**
   * Handle container resize
   * Should be called when the container size changes
   */
  function resize(): void {
    if (!isInitialized.value || !container || !camera.value || !renderer.value) {
      return
    }

    const width = container.clientWidth
    const height = container.clientHeight

    // Update camera aspect ratio
    camera.value.aspect = width / height
    camera.value.updateProjectionMatrix()

    // Update renderer size
    renderer.value.setSize(width, height)

    console.log('[useBrainScene] Resized', { width, height })
  }

  // ============================================================================
  // RENDERING
  // ============================================================================

  /**
   * Render a single frame
   */
  function render(): void {
    if (!isInitialized.value || !scene.value || !camera.value || !renderer.value) {
      return
    }

    // Update controls (required for damping and auto-rotate)
    if (controls.value) {
      controls.value.update()
    }

    renderer.value.render(scene.value, camera.value)
  }

  /**
   * Start the animation loop
   */
  function startLoop(): void {
    if (!isInitialized.value) {
      console.warn('[useBrainScene] Cannot start loop - not initialized')
      return
    }

    if (isLoopRunning.value) {
      console.warn('[useBrainScene] Animation loop already running')
      return
    }

    isLoopRunning.value = true

    function animate(): void {
      if (!isLoopRunning.value) {
        return
      }

      animationFrameId = requestAnimationFrame(animate)
      render()
    }

    animate()

    console.log('[useBrainScene] Animation loop started')
  }

  /**
   * Stop the animation loop
   */
  function stopLoop(): void {
    isLoopRunning.value = false

    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }

    console.log('[useBrainScene] Animation loop stopped')
  }

  // ============================================================================
  // AUTO-ROTATE CONTROL
  // ============================================================================

  /**
   * Enable or disable auto-rotation
   */
  function setAutoRotate(enabled: boolean): void {
    isAutoRotating.value = enabled

    if (controls.value) {
      controls.value.autoRotate = enabled
    }
  }

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    // Core objects
    scene,
    camera,
    renderer,
    controls,

    // Lifecycle
    init,
    dispose,
    resize,
    render,
    startLoop,
    stopLoop,

    // State
    isAutoRotating,
    isInitialized,
    isLoopRunning,
    setAutoRotate,
  }
}
