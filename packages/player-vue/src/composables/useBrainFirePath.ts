/**
 * useBrainFirePath - Fire path animation for 3D brain visualization
 *
 * When a phrase is spoken, the words "fire" in sequence through the network:
 * - Nodes light up one by one (quick brightening, then fade back)
 * - Edges pulse as activation travels from node to node
 * - Like electricity flowing through neural pathways
 *
 * "Fire together, wire together" - visualizing Hebbian learning in action
 *
 * Usage:
 *   const firePath = useBrainFirePath()
 *   firePath.init(nodeSystem, edgeSystem)
 *   await firePath.playFirePath({ nodeIds: ['L001', 'L002', 'L003'], duration: 2000 })
 */

import { ref, type Ref } from 'vue'
import type { usePrebuiltNetwork } from './usePrebuiltNetwork'

// ============================================================================
// TYPES
// ============================================================================

export interface FirePathConfig {
  /** Ordered list of node IDs in the phrase (the firing sequence) */
  nodeIds: string[]
  /** Total animation duration in milliseconds */
  duration: number
}

export interface NodeAnimationState {
  /** Current brightness multiplier (1.0 = normal, 2.0+ = glowing) */
  brightness: number
  /** Current scale multiplier (1.0 = normal) */
  scale: number
  /** Is this node currently firing? */
  isFiring: boolean
}

export interface EdgeAnimationState {
  /** Current glow intensity (0.0 = none, 1.0 = full) */
  glowIntensity: number
  /** Pulse position along the edge (0.0 = source, 1.0 = target) */
  pulsePosition: number
  /** Is this edge currently pulsing? */
  isPulsing: boolean
}

// Animation timing constants
const ANIMATION = {
  /** How quickly nodes brighten (fraction of step duration) */
  NODE_ATTACK: 0.2,
  /** How long nodes stay bright (fraction of step duration) */
  NODE_SUSTAIN: 0.3,
  /** How quickly nodes fade back (fraction of step duration) */
  NODE_DECAY: 0.5,
  /** Peak brightness multiplier for firing nodes */
  PEAK_BRIGHTNESS: 2.5,
  /** Peak scale multiplier for firing nodes */
  PEAK_SCALE: 1.15,
  /** Edge pulse travels slightly ahead of node firing */
  EDGE_LEAD_TIME: 0.1,
  /** How long edge stays glowing */
  EDGE_GLOW_DURATION: 0.6,
}

// Easing functions for smooth animations
const ease = {
  /** Quick attack - fast rise */
  easeOutQuad: (t: number): number => 1 - (1 - t) * (1 - t),
  /** Smooth fade - gradual decay */
  easeInQuad: (t: number): number => t * t,
  /** Elastic bounce for emphasis */
  easeOutBack: (t: number): number => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  },
  /** Smooth sine wave */
  easeInOutSine: (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2,
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useBrainFirePath() {
  // ============================================================================
  // STATE
  // ============================================================================

  /** Is a fire path animation currently playing? */
  const isPlaying: Ref<boolean> = ref(false)

  /** Animation state for each node (keyed by node ID) */
  const nodeStates: Ref<Map<string, NodeAnimationState>> = ref(new Map())

  /** Animation state for each edge (keyed by edge ID: "sourceId->targetId") */
  const edgeStates: Ref<Map<string, EdgeAnimationState>> = ref(new Map())

  /** Current animation frame request ID (for cancellation) */
  let animationFrameId: number | null = null

  /** Animation start time */
  let animationStartTime: number = 0

  /** Current animation config */
  let currentConfig: FirePathConfig | null = null

  /** References to the node and edge systems */
  let nodeSystemRef: ReturnType<typeof usePrebuiltNetwork> | null = null
  // Edge system is part of the node system in the pre-built architecture

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize with references to the node and edge systems
   * @param nodeSystem - The prebuilt network composable (contains both nodes and edges)
   * @param _edgeSystem - Unused, kept for API compatibility
   */
  function init(
    nodeSystem: ReturnType<typeof usePrebuiltNetwork>,
    _edgeSystem?: unknown
  ): void {
    nodeSystemRef = nodeSystem

    // Initialize states for all nodes
    const nodes = nodeSystem.nodes.value
    nodes.forEach(node => {
      nodeStates.value.set(node.id, {
        brightness: 1.0,
        scale: 1.0,
        isFiring: false,
      })
    })

    // Initialize states for all edges
    const edges = nodeSystem.edges.value
    edges.forEach(edge => {
      // Handle both string IDs and object references (D3 mutates these)
      const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as any)?.id
      const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as any)?.id
      if (sourceId && targetId) {
        edgeStates.value.set(`${sourceId}->${targetId}`, {
          glowIntensity: 0.0,
          pulsePosition: 0.0,
          isPulsing: false,
        })
      }
    })

    console.log(`[BrainFirePath] Initialized with ${nodeStates.value.size} nodes, ${edgeStates.value.size} edges`)
  }

  // ============================================================================
  // ANIMATION CORE
  // ============================================================================

  /**
   * Calculate node animation state based on progress through the sequence
   * @param nodeIndex - Index of this node in the firing sequence
   * @param totalNodes - Total number of nodes in sequence
   * @param progress - Overall animation progress (0.0 to 1.0)
   */
  function calculateNodeState(
    nodeIndex: number,
    totalNodes: number,
    progress: number
  ): NodeAnimationState {
    // Each node has its own "window" within the total duration
    const stepSize = 1.0 / totalNodes
    const nodeStartProgress = nodeIndex * stepSize
    const nodeEndProgress = nodeStartProgress + stepSize

    // How far through this node's window are we?
    let localProgress: number
    if (progress < nodeStartProgress) {
      localProgress = 0 // Not started yet
    } else if (progress > nodeEndProgress + stepSize * ANIMATION.NODE_DECAY) {
      localProgress = 1 + ANIMATION.NODE_DECAY // Fully faded
    } else {
      localProgress = (progress - nodeStartProgress) / stepSize
    }

    // Calculate brightness and scale based on attack/sustain/decay phases
    let brightness = 1.0
    let scale = 1.0
    let isFiring = false

    if (localProgress >= 0 && localProgress <= 1 + ANIMATION.NODE_DECAY) {
      if (localProgress < ANIMATION.NODE_ATTACK) {
        // Attack phase - quick rise to peak
        const attackProgress = localProgress / ANIMATION.NODE_ATTACK
        const easedProgress = ease.easeOutBack(attackProgress)
        brightness = 1.0 + (ANIMATION.PEAK_BRIGHTNESS - 1.0) * easedProgress
        scale = 1.0 + (ANIMATION.PEAK_SCALE - 1.0) * easedProgress
        isFiring = true
      } else if (localProgress < ANIMATION.NODE_ATTACK + ANIMATION.NODE_SUSTAIN) {
        // Sustain phase - stay at peak
        brightness = ANIMATION.PEAK_BRIGHTNESS
        scale = ANIMATION.PEAK_SCALE
        isFiring = true
      } else if (localProgress < 1 + ANIMATION.NODE_DECAY) {
        // Decay phase - gradual fade back
        const decayStart = ANIMATION.NODE_ATTACK + ANIMATION.NODE_SUSTAIN
        const decayProgress = (localProgress - decayStart) / (1 + ANIMATION.NODE_DECAY - decayStart)
        const easedProgress = ease.easeInQuad(decayProgress)
        brightness = ANIMATION.PEAK_BRIGHTNESS - (ANIMATION.PEAK_BRIGHTNESS - 1.0) * easedProgress
        scale = ANIMATION.PEAK_SCALE - (ANIMATION.PEAK_SCALE - 1.0) * easedProgress
        isFiring = decayProgress < 0.5 // Still considered firing in early decay
      }
    }

    return { brightness, scale, isFiring }
  }

  /**
   * Calculate edge animation state
   * Edges pulse as the "activation" travels from source to target
   * @param sourceIndex - Index of source node in sequence
   * @param targetIndex - Index of target node in sequence
   * @param totalNodes - Total nodes in sequence
   * @param progress - Overall animation progress
   */
  function calculateEdgeState(
    sourceIndex: number,
    targetIndex: number,
    totalNodes: number,
    progress: number
  ): EdgeAnimationState {
    const stepSize = 1.0 / totalNodes
    const edgeStartProgress = sourceIndex * stepSize - ANIMATION.EDGE_LEAD_TIME * stepSize
    const edgeEndProgress = targetIndex * stepSize + ANIMATION.EDGE_GLOW_DURATION * stepSize

    // Edge pulse position travels from source to target
    let pulsePosition = 0.0
    let glowIntensity = 0.0
    let isPulsing = false

    if (progress >= edgeStartProgress && progress <= edgeEndProgress) {
      isPulsing = true

      // Calculate pulse position (0 = at source, 1 = at target)
      const edgeDuration = edgeEndProgress - edgeStartProgress
      const edgeLocalProgress = (progress - edgeStartProgress) / edgeDuration
      pulsePosition = ease.easeInOutSine(Math.min(1, edgeLocalProgress * 1.5))

      // Glow intensity: ramps up, stays bright, then fades
      if (edgeLocalProgress < 0.3) {
        glowIntensity = ease.easeOutQuad(edgeLocalProgress / 0.3)
      } else if (edgeLocalProgress < 0.7) {
        glowIntensity = 1.0
      } else {
        glowIntensity = 1.0 - ease.easeInQuad((edgeLocalProgress - 0.7) / 0.3)
      }
    }

    return { glowIntensity, pulsePosition, isPulsing }
  }

  /**
   * Animation frame handler
   * Updates all node and edge states based on elapsed time
   */
  function animationFrame(timestamp: number): void {
    if (!isPlaying.value || !currentConfig) {
      return
    }

    const elapsed = timestamp - animationStartTime
    const progress = Math.min(1.0, elapsed / currentConfig.duration)

    const { nodeIds } = currentConfig
    const totalNodes = nodeIds.length

    // Update node states
    nodeIds.forEach((nodeId, index) => {
      const state = calculateNodeState(index, totalNodes, progress)
      nodeStates.value.set(nodeId, state)
    })

    // Update edge states (edges between consecutive nodes in sequence)
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const sourceId = nodeIds[i]
      const targetId = nodeIds[i + 1]
      const edgeId = `${sourceId}->${targetId}`

      const state = calculateEdgeState(i, i + 1, totalNodes, progress)
      edgeStates.value.set(edgeId, state)
    }

    // Continue animation or finish
    if (progress < 1.0) {
      animationFrameId = requestAnimationFrame(animationFrame)
    } else {
      finishAnimation()
    }
  }

  /**
   * Clean up after animation completes
   */
  function finishAnimation(): void {
    // Reset all states to default
    nodeStates.value.forEach((_, nodeId) => {
      nodeStates.value.set(nodeId, {
        brightness: 1.0,
        scale: 1.0,
        isFiring: false,
      })
    })

    edgeStates.value.forEach((_, edgeId) => {
      edgeStates.value.set(edgeId, {
        glowIntensity: 0.0,
        pulsePosition: 0.0,
        isPulsing: false,
      })
    })

    isPlaying.value = false
    currentConfig = null
    animationFrameId = null
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Play the fire path animation
   * Nodes light up in sequence, edges pulse between them
   *
   * @param config - Animation configuration (nodeIds and duration)
   * @returns Promise that resolves when animation completes
   */
  async function playFirePath(config: FirePathConfig): Promise<void> {
    // Stop any existing animation
    stopFirePath()

    // Validate config
    if (!config.nodeIds || config.nodeIds.length === 0) {
      console.warn('[BrainFirePath] No nodeIds provided, skipping animation')
      return Promise.resolve()
    }

    if (config.duration <= 0) {
      console.warn('[BrainFirePath] Invalid duration, skipping animation')
      return Promise.resolve()
    }

    // Ensure states exist for all nodes in the path
    config.nodeIds.forEach(nodeId => {
      if (!nodeStates.value.has(nodeId)) {
        nodeStates.value.set(nodeId, {
          brightness: 1.0,
          scale: 1.0,
          isFiring: false,
        })
      }
    })

    // Ensure states exist for edges between consecutive nodes
    for (let i = 0; i < config.nodeIds.length - 1; i++) {
      const edgeId = `${config.nodeIds[i]}->${config.nodeIds[i + 1]}`
      if (!edgeStates.value.has(edgeId)) {
        edgeStates.value.set(edgeId, {
          glowIntensity: 0.0,
          pulsePosition: 0.0,
          isPulsing: false,
        })
      }
    }

    currentConfig = config
    isPlaying.value = true

    console.log(`[BrainFirePath] Starting animation: ${config.nodeIds.length} nodes over ${config.duration}ms`)

    return new Promise((resolve) => {
      animationStartTime = performance.now()
      animationFrameId = requestAnimationFrame((timestamp) => {
        animationFrame(timestamp)
      })

      // Set up completion callback
      const checkComplete = () => {
        if (!isPlaying.value) {
          resolve()
        } else {
          requestAnimationFrame(checkComplete)
        }
      }
      requestAnimationFrame(checkComplete)
    })
  }

  /**
   * Stop the fire path animation immediately
   */
  function stopFirePath(): void {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }

    if (isPlaying.value) {
      finishAnimation()
    }
  }

  /**
   * Get the current animation state for a specific node
   * @param nodeId - The node ID to query
   * @returns The node's animation state, or default if not found
   */
  function getNodeState(nodeId: string): NodeAnimationState {
    return nodeStates.value.get(nodeId) || {
      brightness: 1.0,
      scale: 1.0,
      isFiring: false,
    }
  }

  /**
   * Get the current animation state for a specific edge
   * @param sourceId - Source node ID
   * @param targetId - Target node ID
   * @returns The edge's animation state, or default if not found
   */
  function getEdgeState(sourceId: string, targetId: string): EdgeAnimationState {
    return edgeStates.value.get(`${sourceId}->${targetId}`) || {
      glowIntensity: 0.0,
      pulsePosition: 0.0,
      isPulsing: false,
    }
  }

  /**
   * Reset the fire path system
   * Clears all animation states and stops any running animation
   */
  function reset(): void {
    stopFirePath()
    nodeStates.value.clear()
    edgeStates.value.clear()
  }

  // ============================================================================
  // EXPORT
  // ============================================================================

  return {
    // Setup
    init,
    reset,

    // Animation control
    playFirePath,
    stopFirePath,

    // State queries
    getNodeState,
    getEdgeState,

    // Reactive state
    isPlaying,
    nodeStates,
    edgeStates,
  }
}

// Type export for consumers
export type BrainFirePath = ReturnType<typeof useBrainFirePath>
