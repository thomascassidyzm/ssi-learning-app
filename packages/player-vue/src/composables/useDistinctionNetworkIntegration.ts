/**
 * useDistinctionNetworkIntegration - Ties together all network pieces
 *
 * This is the "glue" composable that:
 * - Creates the network data model
 * - Creates the physics simulation
 * - Provides methods for learning events (LEGO intro, phrase practice)
 * - Manages path animation during Voice 2
 *
 * Usage in LearningPlayer:
 *
 *   const {
 *     network,
 *     simulation,
 *     viewRef,
 *     introduceLegoNode,
 *     practicePhrase,
 *     animatePathForVoice2,
 *   } = useDistinctionNetworkIntegration()
 *
 *   // When a new LEGO is introduced (round start):
 *   introduceLegoNode(legoId, targetText, knownText)
 *
 *   // When a phrase is practiced (Voice 2 phase):
 *   await animatePathForVoice2(legoIds)
 */

import { ref, computed, watch, nextTick, type Ref, type ComponentPublicInstance } from 'vue'
import { useDistinctionNetwork, type DistinctionNode, type DirectionalEdge } from './useDistinctionNetwork'
import { useDistinctionNetworkSimulation, type SimulationConfig } from './useDistinctionNetworkSimulation'
import type { DistinctionNetworkConfig } from '../components/DistinctionNetworkView.vue'

// ============================================================================
// TYPES
// ============================================================================

export interface IntegrationConfig {
  // View configuration (passed to DistinctionNetworkView)
  view: Partial<DistinctionNetworkConfig>

  // Simulation configuration
  simulation: Partial<SimulationConfig>

  // Animation timing
  pathAnimationStepMs: number

  // Auto-center on hero change
  autoCenterOnHeroChange: boolean
}

const DEFAULT_INTEGRATION_CONFIG: IntegrationConfig = {
  view: {},
  simulation: {},
  pathAnimationStepMs: 200,
  autoCenterOnHeroChange: true,
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useDistinctionNetworkIntegration(
  options: Partial<IntegrationConfig> = {}
) {
  const config = { ...DEFAULT_INTEGRATION_CONFIG, ...options }

  // ============================================================================
  // CORE COMPOSABLES
  // ============================================================================

  const network = useDistinctionNetwork()
  const simulation = useDistinctionNetworkSimulation(
    network.d3Nodes,
    network.d3Links,
    network.heroNodeId,
    config.simulation
  )

  // ============================================================================
  // STATE
  // ============================================================================

  // Reference to the view component (for calling updatePositions)
  const viewRef = ref<ComponentPublicInstance & {
    updatePositions: () => void
    centerView: (animate?: boolean) => void
    render: () => void
    currentZoom: Ref<number>
    animatePulseAlongEdge: (edgeId: string, duration?: number) => void
    animatePathPulses: (edgeIds: string[], stepDelay?: number) => void
  } | null>(null)

  // Center position (should be set by parent based on layout)
  const center = ref({ x: 0, y: 0 })

  // Current belt level
  const currentBelt = ref('white')

  // Path animation state
  const isAnimatingPath = ref(false)
  let pathAnimationTimers: number[] = []

  // ============================================================================
  // LEARNING EVENT HANDLERS
  // ============================================================================

  /**
   * Introduce a new LEGO node to the network
   * Called when a new LEGO round begins
   *
   * @param legoId - The LEGO identifier
   * @param targetText - Target language text
   * @param knownText - Known language text
   * @param makeHero - Whether to make this the hero node (default: true)
   */
  function introduceLegoNode(
    legoId: string,
    targetText: string,
    knownText: string,
    makeHero: boolean = true
  ): boolean {
    // Add the node
    const added = network.addNode(legoId, targetText, knownText, currentBelt.value, center.value)

    if (added && makeHero) {
      // Set as hero (centered)
      network.setHero(legoId, center.value)

      // Restart simulation to reorganize
      simulation.restart(0.5)
    } else if (added) {
      // Just nudge simulation for new satellite
      simulation.nudge()
    }

    return added
  }

  /**
   * Record a phrase practice - fires the path and strengthens edges
   * Called when a practice phrase cycle completes
   *
   * @param legoIds - Ordered list of LEGO IDs in the phrase
   */
  function practicePhrase(legoIds: string[]): void {
    if (!legoIds || legoIds.length < 2) return

    // Fire the path (Hebbian strengthening)
    network.firePath(legoIds)

    // Nudge simulation - edges got stronger, clustering will update
    simulation.nudge()
  }

  /**
   * Animate the path during Voice 2 phase
   * Highlights each node/edge in sequence
   *
   * @param legoIds - Ordered list of LEGO IDs to animate
   * @returns Promise that resolves when animation completes
   */
  async function animatePathForVoice2(legoIds: string[]): Promise<void> {
    if (!legoIds || legoIds.length === 0) return

    // Cancel any existing animation
    clearPathAnimation()

    // Set the path
    network.setHighlightPath(legoIds)
    isAnimatingPath.value = true

    // Trigger pulse animation along edges (traveling dots)
    if (viewRef.value && legoIds.length >= 2) {
      const edgeIds: string[] = []
      for (let i = 0; i < legoIds.length - 1; i++) {
        edgeIds.push(`${legoIds[i]}->${legoIds[i + 1]}`)
      }
      viewRef.value.animatePathPulses(edgeIds, config.pathAnimationStepMs)
    }

    // Animate through each step (node highlighting)
    return new Promise((resolve) => {
      const stepDuration = config.pathAnimationStepMs

      for (let i = 0; i < legoIds.length; i++) {
        const timer = window.setTimeout(() => {
          network.setPathActiveIndex(i)
        }, i * stepDuration)
        pathAnimationTimers.push(timer)
      }

      // Clear after last step
      const finalTimer = window.setTimeout(() => {
        isAnimatingPath.value = false
        resolve()
      }, legoIds.length * stepDuration + stepDuration)
      pathAnimationTimers.push(finalTimer)
    })
  }

  /**
   * Clear the current path animation
   */
  function clearPathAnimation(): void {
    pathAnimationTimers.forEach(t => clearTimeout(t))
    pathAnimationTimers = []
    network.clearHighlightPath()
    isAnimatingPath.value = false
  }

  /**
   * Complete phrase practice with animation
   * Combines practicePhrase + animatePathForVoice2
   */
  async function completePhraseWithAnimation(legoIds: string[]): Promise<void> {
    // Animate first (visual feedback)
    await animatePathForVoice2(legoIds)

    // Trigger pulse animation along edges
    if (viewRef.value && legoIds.length >= 2) {
      // Get edge IDs from the path
      const edgeIds: string[] = []
      for (let i = 0; i < legoIds.length - 1; i++) {
        edgeIds.push(`${legoIds[i]}->${legoIds[i + 1]}`)
      }
      viewRef.value.animatePathPulses(edgeIds, config.pathAnimationStepMs)
    }

    // Then strengthen (Hebbian)
    practicePhrase(legoIds)

    // Clear highlight after a beat
    await new Promise(r => setTimeout(r, 300))
    clearPathAnimation()
  }

  // ============================================================================
  // SETUP METHODS
  // ============================================================================

  /**
   * Initialize the simulation and connect to view
   * Call this after the view component is mounted
   */
  function initialize(): void {
    // Initialize simulation
    simulation.initialize()

    // Connect tick to view update
    simulation.onTick(() => {
      if (viewRef.value) {
        viewRef.value.updatePositions()
      }
    })
  }

  /**
   * Set the center position (call when layout is known)
   */
  function setCenter(x: number, y: number): void {
    center.value = { x, y }
    simulation.setCenter(x, y)
  }

  /**
   * Update belt level (affects colors)
   */
  function setBelt(belt: string): void {
    currentBelt.value = belt
  }

  /**
   * Populate network from existing rounds (for resume)
   */
  function populateFromRounds(
    rounds: Array<{
      legoId: string
      targetText?: string
      knownText?: string
      items?: Array<{ type: string; targetText?: string; knownText?: string }>
    }>,
    upToIndex: number
  ): void {
    network.populateFromRounds(rounds, upToIndex, center.value, currentBelt.value)
    simulation.restart(0.8)
  }

  /**
   * Clear everything and start fresh
   */
  function reset(): void {
    clearPathAnimation()
    network.clear()
    simulation.restart()
  }

  // ============================================================================
  // COMPUTED PROPS FOR VIEW
  // ============================================================================

  // Props to pass to DistinctionNetworkView
  const viewProps = computed(() => ({
    nodes: network.nodes.value,
    edges: network.edges.value,
    heroNodeId: network.heroNodeId.value,
    currentPath: network.currentPath.value,
    center: center.value,
    config: config.view,
    beltLevel: currentBelt.value,
  }))

  // ============================================================================
  // EXPORT
  // ============================================================================

  return {
    // Core composables (for direct access if needed)
    network,
    simulation,

    // View integration
    viewRef,
    viewProps,

    // State
    center,
    currentBelt,
    isAnimatingPath,

    // Learning event handlers
    introduceLegoNode,
    practicePhrase,
    animatePathForVoice2,
    completePhraseWithAnimation,
    clearPathAnimation,

    // Setup methods
    initialize,
    setCenter,
    setBelt,
    populateFromRounds,
    reset,

    // Statistics (from network)
    stats: network.stats,
  }
}
