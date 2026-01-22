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
  autoRotate: false,     // Off by default - user can enable via toggle
  minDistance: 200,      // Can get closer for detail
  maxDistance: 1500,     // Can zoom way out
  cameraDistance: 600,   // Start far enough to see entire brain (radius ~200-400)
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

  // Update callbacks (called each frame with deltaTime)
  const updateCallbacks: Array<(deltaTime: number) => void> = []
  let lastFrameTime: number = 0

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

    // Detect mobile for performance optimizations
    const isMobile = width < 768 || ('ontouchstart' in window && width < 1024)
    const isLowPower = isMobile || navigator.hardwareConcurrency <= 4

    // ========== SCENE ==========
    const newScene = new THREE.Scene()

    // Background - dark cosmic void
    if (cfg.backgroundColor === 'transparent') {
      newScene.background = null
    } else {
      newScene.background = new THREE.Color(cfg.backgroundColor)
    }

    // Optional: Add subtle fog for depth (very light - brain is ~400 units across)
    newScene.fog = new THREE.FogExp2(cfg.backgroundColor === 'transparent' ? 0x050508 : cfg.backgroundColor, 0.001)

    scene.value = newScene

    // ========== CAMERA ==========
    const newCamera = new THREE.PerspectiveCamera(cfg.fov, aspect, 0.1, 1000)

    // Position camera to look at center from a good angle
    newCamera.position.set(0, cfg.cameraDistance * 0.3, cfg.cameraDistance)
    newCamera.lookAt(0, 0, 0)

    camera.value = newCamera

    // ========== RENDERER ==========
    const newRenderer = new THREE.WebGLRenderer({
      antialias: !isLowPower && cfg.antialias,  // Disable antialiasing on mobile/low-power
      alpha: cfg.backgroundColor === 'transparent',
      powerPreference: isLowPower ? 'low-power' : 'high-performance',
    })

    // Handle devicePixelRatio - lower cap on mobile for performance
    const maxPixelRatio = isLowPower ? 1.5 : 2
    const pixelRatio = Math.min(window.devicePixelRatio, maxPixelRatio)
    newRenderer.setPixelRatio(pixelRatio)
    newRenderer.setSize(width, height)

    // Shadows disabled for performance
    newRenderer.shadowMap.enabled = false

    // Tone mapping for better visual quality
    newRenderer.toneMapping = THREE.ACESFilmicToneMapping
    newRenderer.toneMappingExposure = 1.0

    console.log('[useBrainScene] Initialized', {
      width, height, pixelRatio,
      isMobile, isLowPower,
      antialias: !isLowPower && cfg.antialias
    })

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
  }

  /**
   * Set up scene lighting
   * Creates ambient lighting + subtle point lights for depth
   */
  function setupLighting(targetScene: THREE.Scene): void {
    // Ambient light - soft overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    targetScene.add(ambientLight)

    // Main point light - from above-front for subtle highlights (scaled for brain size ~400 units)
    const mainLight = new THREE.PointLight(0xffffff, 0.6, 2000)
    mainLight.position.set(300, 500, 400)
    targetScene.add(mainLight)

    // Fill light - subtle from below to reduce harsh shadows
    const fillLight = new THREE.PointLight(0x4466ff, 0.3, 2000)
    fillLight.position.set(-300, -200, 300)
    targetScene.add(fillLight)

    // Rim light - from behind for subtle edge glow
    const rimLight = new THREE.PointLight(0xff6644, 0.2, 2000)
    rimLight.position.set(0, 0, -500)
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
    lastFrameTime = performance.now()

    function animate(currentTime: number): void {
      if (!isLoopRunning.value) {
        return
      }

      animationFrameId = requestAnimationFrame(animate)

      // Calculate delta time in seconds
      const deltaTime = (currentTime - lastFrameTime) / 1000
      lastFrameTime = currentTime

      // Call update callbacks (for animations like node pulsing)
      for (const callback of updateCallbacks) {
        callback(deltaTime)
      }

      render()
    }

    requestAnimationFrame(animate)

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
  // UPDATE CALLBACKS
  // ============================================================================

  /**
   * Register a callback to be called each frame with deltaTime
   * Used for animations like node pulsing
   * @param callback - Function that receives deltaTime in seconds
   * @returns Cleanup function to unregister the callback
   */
  function onUpdate(callback: (deltaTime: number) => void): () => void {
    updateCallbacks.push(callback)
    return () => {
      const index = updateCallbacks.indexOf(callback)
      if (index > -1) {
        updateCallbacks.splice(index, 1)
      }
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

    // Animation callbacks
    onUpdate,
  }
}
