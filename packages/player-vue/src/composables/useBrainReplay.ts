/**
 * useBrainReplay - Growth Replay Functionality for 3D Brain Visualization
 *
 * Creates a timelapse animation showing the brain "growing" from empty
 * to current state. Nodes appear one by one in learning order, with
 * connections appearing when both connected nodes are visible.
 *
 * This is the "wow" feature - watching your brain grow is the shareable moment.
 *
 * Features:
 * - Start with empty brain (all nodes hidden)
 * - Reveal nodes one by one in learning order
 * - Connections appear when both endpoints are visible
 * - Speed controls: 1x, 2x, 4x, 8x
 * - Nodes "pop" in with a glow effect
 * - Camera pulls back at start, returns at end
 * - Optional slow auto-rotate during replay
 * - Auto-calculate timing: ~500 nodes in 15-20 seconds at 1x
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue'
import * as THREE from 'three'
import type { UseBrainNodes, BrainNode } from './useBrainNodes'
import type { BrainEdge } from './useBrainEdges'

// ============================================================================
// TYPES
// ============================================================================

export interface ReplayNode {
  id: string
  learnedAt: number  // order index (0, 1, 2, ...) or timestamp
}

export interface ReplayConfig {
  /** Base milliseconds per node reveal at 1x speed */
  baseIntervalMs: number
  /** Glow duration for "pop" effect in ms */
  glowDurationMs: number
  /** Camera pull-back factor at start (1.0 = no change, 2.0 = twice as far) */
  cameraZoomOutFactor: number
  /** Whether to auto-rotate camera during replay */
  autoRotate: boolean
  /** Auto-rotate speed in radians per second */
  autoRotateSpeed: number
  /** Particle burst count when node appears */
  particleBurstCount: number
}

export interface ReplayState {
  /** Current speed multiplier */
  speed: number
  /** Index of next node to reveal (0 = nothing revealed yet) */
  currentIndex: number
  /** Total nodes to reveal */
  totalNodes: number
  /** Set of currently revealed node IDs */
  revealedIds: Set<string>
  /** Currently glowing node ID (just appeared) */
  glowingNodeId: string | null
  /** Particle burst position (just appeared node) */
  particleBurst: { x: number; y: number; z: number } | null
}

export interface NodeSystem {
  nodes: Ref<BrainNode[]>
  highlightNode: (nodeId: string) => void
  unhighlightNode: (nodeId: string) => void
  getNodePosition: (nodeId: string) => THREE.Vector3 | null
  updateNodeBrightness: (nodeId: string, brightness: number) => void
}

export interface EdgeSystem {
  setEdgeGlow: (edgeId: string, intensity: number) => void
  unhighlightAll: () => void
  getEdgeIdBetweenNodes: (nodeA: string, nodeB: string) => string | null
}

export interface CameraControls {
  /** Get camera position */
  position: THREE.Vector3
  /** Look at target */
  lookAt: (target: THREE.Vector3) => void
  /** Set camera distance from target */
  setDistance?: (distance: number) => void
  /** Get current distance from target */
  getDistance?: () => number
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

/**
 * Default replay configuration.
 * Targets ~500 nodes in 15-20 seconds at 1x speed.
 * 500 nodes / 17.5 seconds = ~28.5 nodes/second = ~35ms per node
 */
const DEFAULT_CONFIG: ReplayConfig = {
  baseIntervalMs: 35, // ~28-29 nodes per second at 1x
  glowDurationMs: 400, // Brief glow when node appears
  cameraZoomOutFactor: 1.5, // Pull back to see whole brain
  autoRotate: true, // Slow rotation during replay
  autoRotateSpeed: 0.15, // Radians per second
  particleBurstCount: 5, // Subtle particle burst
}

// ============================================================================
// SPEED OPTIONS
// ============================================================================

export const SPEED_OPTIONS = [1, 2, 4, 8] as const
export type SpeedMultiplier = typeof SPEED_OPTIONS[number]

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useBrainReplay() {
  // ============================================================================
  // STATE
  // ============================================================================

  // Playback state
  const isPlaying = ref(false)
  const isPaused = ref(false)
  const progress = ref(0) // 0-1
  const currentSpeed = ref<number>(1)

  // Animation state
  const currentIndex = ref(0)
  const totalNodes = ref(0)
  const glowingNodeId = ref<string | null>(null)
  const particleBurst = ref<{ x: number; y: number; z: number } | null>(null)

  // Configuration
  const config = ref<ReplayConfig>({ ...DEFAULT_CONFIG })

  // References to external systems (set via init)
  let nodeSystem: NodeSystem | null = null
  let edgeSystem: EdgeSystem | null = null
  let camera: THREE.Camera | null = null
  let controls: any = null // OrbitControls

  // Animation timing
  let animationFrameId: number | null = null
  let lastTickTime = 0
  let accumulatedTime = 0
  let resolveComplete: (() => void) | null = null
  let rejectComplete: ((reason?: any) => void) | null = null

  // Saved camera state (to restore after replay)
  let savedCameraState: {
    position: THREE.Vector3
    target: THREE.Vector3
    distance: number
    autoRotate: boolean
  } | null = null

  // Learning order (node IDs in the order they were learned)
  let learningOrder: string[] = []

  // Track revealed nodes during replay
  const revealedDuringReplay = ref<Set<string>>(new Set())

  // Track brightness states for restoration
  let originalBrightnesses: Map<string, number> = new Map()

  // ============================================================================
  // COMPUTED
  // ============================================================================

  /**
   * Current interval between node reveals (accounting for speed)
   */
  const currentInterval = computed(() => {
    return config.value.baseIntervalMs / currentSpeed.value
  })

  /**
   * Estimated total duration at current speed (in seconds)
   */
  const estimatedDuration = computed(() => {
    return (totalNodes.value * currentInterval.value) / 1000
  })

  /**
   * Replay state for external consumers
   */
  const state = computed<ReplayState>(() => ({
    speed: currentSpeed.value,
    currentIndex: currentIndex.value,
    totalNodes: totalNodes.value,
    revealedIds: revealedDuringReplay.value,
    glowingNodeId: glowingNodeId.value,
    particleBurst: particleBurst.value,
  }))

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the replay system with external dependencies.
   *
   * @param nodes - Node system from useBrainNodes
   * @param edges - Edge system from useBrainEdges
   * @param cam - THREE.Camera for positioning
   */
  function init(
    nodes: NodeSystem,
    edges: EdgeSystem,
    cam: THREE.Camera
  ): void {
    nodeSystem = nodes
    edgeSystem = edges
    camera = cam

    console.log('[BrainReplay] Initialized with', nodes.nodes.value.length, 'nodes')
  }

  /**
   * Set OrbitControls reference (optional, for auto-rotate)
   */
  function setControls(orbitControls: any): void {
    controls = orbitControls
  }

  /**
   * Set custom configuration
   */
  function setConfig(newConfig: Partial<ReplayConfig>): void {
    config.value = { ...config.value, ...newConfig }
  }

  // ============================================================================
  // LEARNING ORDER EXTRACTION
  // ============================================================================

  /**
   * Build learning order from nodes.
   * Nodes are ordered by their array position (which reflects learning sequence).
   * Filters out component nodes (those with isComponent: true)
   */
  function buildLearningOrder(): void {
    if (!nodeSystem) return

    const nodes = nodeSystem.nodes.value

    // Filter out component nodes and preserve order
    learningOrder = nodes
      .filter(n => !n.isComponent)
      .map(n => n.id)

    totalNodes.value = learningOrder.length

    console.log('[BrainReplay] Learning order built:', learningOrder.length, 'nodes')
  }

  // ============================================================================
  // CAMERA ANIMATION
  // ============================================================================

  /**
   * Pull camera back to see whole brain at start
   */
  function pullCameraBack(): void {
    if (!camera || !controls) return

    // Save current state
    savedCameraState = {
      position: camera.position.clone(),
      target: controls.target ? controls.target.clone() : new THREE.Vector3(0, 0, 0),
      distance: camera.position.distanceTo(controls.target || new THREE.Vector3(0, 0, 0)),
      autoRotate: controls.autoRotate || false,
    }

    // Calculate new distance
    const newDistance = savedCameraState.distance * config.value.cameraZoomOutFactor

    // Move camera back along its current direction
    const direction = camera.position.clone().sub(savedCameraState.target).normalize()
    camera.position.copy(savedCameraState.target.clone().add(direction.multiplyScalar(newDistance)))

    // Enable auto-rotate during replay if configured
    if (config.value.autoRotate && controls) {
      controls.autoRotate = true
      controls.autoRotateSpeed = config.value.autoRotateSpeed * 10 // OrbitControls scale
    }

    console.log('[BrainReplay] Camera pulled back to', newDistance)
  }

  /**
   * Smoothly return camera to original position
   */
  function returnCamera(): void {
    if (!camera || !savedCameraState) return

    // Restore camera position
    camera.position.copy(savedCameraState.position)

    // Restore controls state
    if (controls) {
      if (savedCameraState.target) {
        controls.target.copy(savedCameraState.target)
      }
      controls.autoRotate = savedCameraState.autoRotate
      controls.update()
    }

    savedCameraState = null

    console.log('[BrainReplay] Camera returned to original position')
  }

  // ============================================================================
  // NODE REVEAL ANIMATION
  // ============================================================================

  /**
   * Reveal the next node in learning order with visual effects.
   * Returns true if there are more nodes to reveal.
   */
  function revealNextNode(): boolean {
    if (!nodeSystem || currentIndex.value >= learningOrder.length) {
      return false
    }

    const nodeId = learningOrder[currentIndex.value]

    // Track this node as revealed
    const newRevealed = new Set(revealedDuringReplay.value)
    newRevealed.add(nodeId)
    revealedDuringReplay.value = newRevealed

    // Make node visible with glow effect
    nodeSystem.updateNodeBrightness(nodeId, 1.0) // Full brightness
    nodeSystem.highlightNode(nodeId) // Add highlight pulse

    // Set glowing state for external visual effects
    glowingNodeId.value = nodeId

    // Set particle burst position
    const position = nodeSystem.getNodePosition(nodeId)
    if (position) {
      particleBurst.value = { x: position.x, y: position.y, z: position.z }
    }

    // Show edges to previously revealed nodes
    if (edgeSystem) {
      const previousNodes = Array.from(revealedDuringReplay.value)
      for (const prevId of previousNodes) {
        if (prevId === nodeId) continue
        const edgeId = edgeSystem.getEdgeIdBetweenNodes(nodeId, prevId)
        if (edgeId) {
          edgeSystem.setEdgeGlow(edgeId, 0.5) // Subtle glow
        }
      }
    }

    // Clear glow after duration
    const currentNodeId = nodeId
    setTimeout(() => {
      if (glowingNodeId.value === currentNodeId) {
        glowingNodeId.value = null
        particleBurst.value = null
        // Remove highlight but keep visible
        if (nodeSystem) {
          nodeSystem.unhighlightNode(currentNodeId)
        }
      }
    }, config.value.glowDurationMs)

    // Advance index
    currentIndex.value++

    // Update progress
    progress.value = currentIndex.value / totalNodes.value

    return currentIndex.value < learningOrder.length
  }

  /**
   * Hide all nodes (for replay start)
   */
  function hideAllNodes(): void {
    if (!nodeSystem) return

    // Store original brightnesses and set all to minimum
    originalBrightnesses.clear()
    for (const node of nodeSystem.nodes.value) {
      // Store original (we'll assume 0.5 as default)
      originalBrightnesses.set(node.id, 0.5)
      // Set to nearly invisible
      nodeSystem.updateNodeBrightness(node.id, 0.05)
    }

    // Hide all edges
    if (edgeSystem) {
      edgeSystem.unhighlightAll()
    }

    revealedDuringReplay.value = new Set()
  }

  /**
   * Restore all nodes to their original state
   */
  function restoreAllNodes(): void {
    if (!nodeSystem) return

    // Restore original brightnesses
    for (const [nodeId, brightness] of originalBrightnesses) {
      nodeSystem.updateNodeBrightness(nodeId, brightness)
      nodeSystem.unhighlightNode(nodeId)
    }

    // Restore edge visibility
    if (edgeSystem) {
      edgeSystem.unhighlightAll()
    }

    originalBrightnesses.clear()
  }

  // ============================================================================
  // ANIMATION LOOP
  // ============================================================================

  /**
   * Main animation tick (called via requestAnimationFrame)
   */
  function animationTick(timestamp: number): void {
    if (!isPlaying.value || isPaused.value) {
      animationFrameId = null
      return
    }

    // Calculate delta time
    if (lastTickTime === 0) {
      lastTickTime = timestamp
    }
    const deltaTime = timestamp - lastTickTime
    lastTickTime = timestamp

    // Accumulate time
    accumulatedTime += deltaTime

    // Reveal nodes based on accumulated time and speed
    const interval = currentInterval.value

    while (accumulatedTime >= interval) {
      accumulatedTime -= interval

      const hasMore = revealNextNode()

      if (!hasMore) {
        // Animation complete
        completeReplay()
        return
      }
    }

    // Continue animation
    animationFrameId = requestAnimationFrame(animationTick)
  }

  /**
   * Start the animation loop
   */
  function startAnimationLoop(): void {
    lastTickTime = 0
    accumulatedTime = 0
    animationFrameId = requestAnimationFrame(animationTick)
  }

  /**
   * Stop the animation loop
   */
  function stopAnimationLoop(): void {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  // ============================================================================
  // PLAYBACK CONTROL
  // ============================================================================

  /**
   * Start the replay animation.
   * Resolves when animation completes (all nodes revealed).
   *
   * @param speed - Initial speed multiplier (default: 1)
   */
  function startReplay(speed: number = 1): Promise<void> {
    if (!nodeSystem) {
      return Promise.reject(new Error('Replay not initialized. Call init() first.'))
    }

    if (isPlaying.value) {
      return Promise.reject(new Error('Replay already in progress'))
    }

    return new Promise((resolve, reject) => {
      resolveComplete = resolve
      rejectComplete = reject

      // Build learning order
      buildLearningOrder()

      if (learningOrder.length === 0) {
        resolve()
        return
      }

      // Reset state
      currentIndex.value = 0
      progress.value = 0
      currentSpeed.value = speed
      glowingNodeId.value = null
      particleBurst.value = null
      revealedDuringReplay.value = new Set()

      // Hide all nodes (start from empty)
      hideAllNodes()

      // Pull camera back
      pullCameraBack()

      // Start animation
      isPlaying.value = true
      isPaused.value = false

      console.log('[BrainReplay] Starting replay:', {
        totalNodes: totalNodes.value,
        speed: currentSpeed.value,
        estimatedDuration: estimatedDuration.value + 's',
      })

      startAnimationLoop()
    })
  }

  /**
   * Pause the replay
   */
  function pauseReplay(): void {
    if (!isPlaying.value || isPaused.value) return

    isPaused.value = true
    stopAnimationLoop()

    console.log('[BrainReplay] Paused at', currentIndex.value, '/', totalNodes.value)
  }

  /**
   * Resume a paused replay
   */
  function resumeReplay(): void {
    if (!isPlaying.value || !isPaused.value) return

    isPaused.value = false
    startAnimationLoop()

    console.log('[BrainReplay] Resumed from', currentIndex.value, '/', totalNodes.value)
  }

  /**
   * Stop the replay and reset to current state
   */
  function stopReplay(): void {
    if (!isPlaying.value) return

    stopAnimationLoop()

    // Reset playback state
    isPlaying.value = false
    isPaused.value = false
    progress.value = 0
    currentIndex.value = 0
    glowingNodeId.value = null
    particleBurst.value = null

    // Restore all nodes to original state
    restoreAllNodes()

    // Return camera
    returnCamera()

    // Reject the promise if still pending
    if (rejectComplete) {
      rejectComplete(new Error('Replay stopped'))
      rejectComplete = null
      resolveComplete = null
    }

    console.log('[BrainReplay] Stopped and reset')
  }

  /**
   * Complete the replay (called when all nodes revealed)
   */
  function completeReplay(): void {
    stopAnimationLoop()

    isPlaying.value = false
    isPaused.value = false
    progress.value = 1
    glowingNodeId.value = null
    particleBurst.value = null

    // Return camera smoothly (with delay)
    setTimeout(() => {
      returnCamera()
    }, 500)

    // Resolve the promise
    if (resolveComplete) {
      resolveComplete()
      resolveComplete = null
      rejectComplete = null
    }

    console.log('[BrainReplay] Complete!', totalNodes.value, 'nodes revealed')
  }

  /**
   * Set playback speed (can be changed during replay)
   *
   * @param multiplier - Speed multiplier (1, 2, 4, 8)
   */
  function setSpeed(multiplier: number): void {
    if (!SPEED_OPTIONS.includes(multiplier as SpeedMultiplier)) {
      console.warn('[BrainReplay] Invalid speed:', multiplier, '- using 1x')
      multiplier = 1
    }

    currentSpeed.value = multiplier

    console.log('[BrainReplay] Speed set to', multiplier + 'x')
  }

  /**
   * Jump to a specific progress point (0-1)
   * Useful for scrubbing through the replay
   */
  function seekTo(targetProgress: number): void {
    if (!nodeSystem || learningOrder.length === 0) return

    // Clamp progress
    targetProgress = Math.max(0, Math.min(1, targetProgress))

    // Calculate target index
    const targetIndex = Math.floor(targetProgress * learningOrder.length)

    // Reset visibility
    hideAllNodes()

    // Reveal all nodes up to target index
    const newRevealed = new Set<string>()
    for (let i = 0; i < targetIndex; i++) {
      const nodeId = learningOrder[i]
      newRevealed.add(nodeId)
      nodeSystem.updateNodeBrightness(nodeId, 0.5) // Normal brightness
    }

    // Update revealed edges
    if (edgeSystem) {
      for (const nodeId of newRevealed) {
        for (const otherId of newRevealed) {
          if (nodeId >= otherId) continue
          const edgeId = edgeSystem.getEdgeIdBetweenNodes(nodeId, otherId)
          if (edgeId) {
            edgeSystem.setEdgeGlow(edgeId, 0.2) // Subtle visibility
          }
        }
      }
    }

    // Update state
    revealedDuringReplay.value = newRevealed
    currentIndex.value = targetIndex
    progress.value = targetProgress

    console.log('[BrainReplay] Seeked to', Math.round(targetProgress * 100) + '%')
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Clean up resources (call on component unmount)
   */
  function dispose(): void {
    stopReplay()
    nodeSystem = null
    edgeSystem = null
    camera = null
    controls = null
    learningOrder = []
    originalBrightnesses.clear()
    savedCameraState = null
  }

  // ============================================================================
  // EXPORT
  // ============================================================================

  return {
    // Setup
    init,
    setControls,
    setConfig,
    dispose,

    // Playback control
    startReplay,
    pauseReplay,
    resumeReplay,
    stopReplay,
    setSpeed,
    seekTo,

    // State (reactive)
    isPlaying,
    isPaused,
    progress,
    currentSpeed,
    state,

    // Computed
    estimatedDuration,
    currentInterval,

    // Visual effect state (for rendering)
    glowingNodeId,
    particleBurst,

    // Constants
    SPEED_OPTIONS,
  }
}

// ============================================================================
// TYPE EXPORT
// ============================================================================

export type BrainReplay = ReturnType<typeof useBrainReplay>
