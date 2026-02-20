/**
 * usePrebuiltNetworkIntegration - Drop-in replacement for useDistinctionNetworkIntegration
 *
 * Uses pre-calculated positions instead of runtime D3 force simulation.
 * Provides the same API for easy swapping in LearningPlayer.
 *
 * Key differences:
 * - Positions calculated ONCE when script loads (not during learning)
 * - Network pans via CSS transform to center on hero
 * - No simulation.tick() - simpler and more predictable
 * - Spatial relationships are FIXED (preserves memory)
 */

import { ref, computed, watch, type Ref, type ComponentPublicInstance } from 'vue'
import { usePrebuiltNetwork, preCalculatePositions, type NetworkNode, type NetworkEdge, type PathHighlight, type ExternalConnection } from './usePrebuiltNetwork'

// ============================================================================
// TYPES
// ============================================================================

export interface PrebuiltIntegrationConfig {
  pathAnimationStepMs: number
  autoCenterOnHeroChange: boolean
  canvasSize: { width: number; height: number }
}

const DEFAULT_CONFIG: PrebuiltIntegrationConfig = {
  pathAnimationStepMs: 200,
  autoCenterOnHeroChange: true,
  canvasSize: { width: 800, height: 800 },
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function usePrebuiltNetworkIntegration(
  options: Partial<PrebuiltIntegrationConfig> = {}
) {
  const config = { ...DEFAULT_CONFIG, ...options }

  // Core pre-built network
  const prebuiltNetwork = usePrebuiltNetwork()

  // ============================================================================
  // STATE
  // ============================================================================

  // Reference to the view component
  const viewRef = ref<ComponentPublicInstance | null>(null)

  // Center position
  const center = ref({ x: config.canvasSize.width / 2, y: config.canvasSize.height / 2 })

  // Current belt level
  const currentBelt = ref('white')

  // Fire path animation toggle (saved to localStorage)
  const showFirePath = ref(localStorage.getItem('ssi-show-fire-path') !== 'false')

  // Listen for storage changes (cross-tab and same-tab via custom event)
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === 'ssi-show-fire-path') {
        showFirePath.value = e.newValue !== 'false'
      }
    })
    // Custom event for same-tab updates
    window.addEventListener('ssi-setting-changed', ((e: CustomEvent) => {
      if (e.detail?.key === 'showFirePath') {
        showFirePath.value = e.detail.value
      }
    }) as EventListener)
  }

  // Path animation state
  const isAnimatingPath = ref(false)
  let pathAnimationTimers: number[] = []

  // Track if network has been initialized with rounds
  const isInitialized = ref(false)
  let cachedRoundsForNetwork: any[] = []

  // Track if FULL network has been loaded (all course rounds, not just playback chunk)
  // Once true, we never recalculate - just reveal/hide nodes
  const isFullNetworkLoaded = ref(false)
  let fullNetworkRounds: any[] = []

  // ============================================================================
  // LEARNING EVENT HANDLERS (matching existing API)
  // ============================================================================

  /**
   * Introduce a new LEGO node to the network
   * In pre-built mode: reveals the pre-calculated position
   */
  function introduceLegoNode(
    legoId: string,
    targetText: string,
    knownText: string,
    makeHero: boolean = true
  ): boolean {
    // If not initialized yet, can't reveal
    if (!isInitialized.value) {
      console.warn(`[PrebuiltNetworkIntegration] Network not initialized, queueing reveal for ${legoId}`)
      return false
    }

    // If node doesn't exist in pre-calculated network (e.g. from later-loaded rounds),
    // dynamically add it so it can be revealed
    const existingNode = prebuiltNetwork.nodes.value.find(n => n.id === legoId)
    if (!existingNode && targetText) {
      const nodeCount = prebuiltNetwork.nodes.value.length
      const goldenAngle = 137.508 * Math.PI / 180
      const angle = nodeCount * goldenAngle
      const maxRadius = 38
      const r = Math.min(maxRadius, 8 + Math.sqrt(nodeCount) * 7)
      const cx = center.value.x + Math.cos(angle) * r * 3
      const cy = center.value.y + Math.sin(angle) * r * 3
      prebuiltNetwork.nodes.value = [...prebuiltNetwork.nodes.value, {
        id: legoId,
        targetText,
        knownText,
        belt: currentBelt.value,
        x: cx,
        y: cy,
      }]
      console.debug(`[PrebuiltNetworkIntegration] Dynamically added node ${legoId} (${targetText})`)
    } else if (existingNode && targetText && existingNode.targetText === existingNode.id) {
      // Node exists but has LEGO ID as placeholder text — update with real text
      existingNode.targetText = targetText
      if (knownText) existingNode.knownText = knownText
    }

    prebuiltNetwork.revealNode(legoId, makeHero)
    return true
  }

  /**
   * Record a phrase practice
   */
  function practicePhrase(legoIds: string[]): void {
    if (!legoIds || legoIds.length < 2) return
    prebuiltNetwork.firePath(legoIds)
  }

  /**
   * Animate nodes during Voice 1 (no edges, no labels)
   */
  async function animateNodesForVoice1(legoIds: string[], audioDurationMs: number = 2000): Promise<void> {
    if (!legoIds || legoIds.length === 0) return

    clearPathAnimation()
    prebuiltNetwork.setHighlightPath(legoIds)
    isAnimatingPath.value = true

    const stepDuration = Math.max(150, audioDurationMs / legoIds.length)

    return new Promise((resolve) => {
      for (let i = 0; i < legoIds.length; i++) {
        const timer = window.setTimeout(() => {
          prebuiltNetwork.setPathActiveIndex(i)
        }, i * stepDuration)
        pathAnimationTimers.push(timer)
      }

      const finalTimer = window.setTimeout(() => {
        isAnimatingPath.value = false
        resolve()
      }, legoIds.length * stepDuration)
      pathAnimationTimers.push(finalTimer)
    })
  }

  /**
   * Animate path during Voice 2 (edges + labels)
   */
  async function animatePathForVoice2(legoIds: string[], audioDurationMs: number = 2000): Promise<void> {
    if (!legoIds || legoIds.length === 0) return

    prebuiltNetwork.setHighlightPath(legoIds)
    isAnimatingPath.value = true

    const stepDuration = Math.max(150, audioDurationMs / legoIds.length)

    return new Promise((resolve) => {
      for (let i = 0; i < legoIds.length; i++) {
        const timer = window.setTimeout(() => {
          prebuiltNetwork.setPathActiveIndex(i)
        }, i * stepDuration)
        pathAnimationTimers.push(timer)
      }

      const finalTimer = window.setTimeout(() => {
        isAnimatingPath.value = false
        resolve()
      }, legoIds.length * stepDuration)
      pathAnimationTimers.push(finalTimer)
    })
  }

  /**
   * Clear path animation
   */
  function clearPathAnimation(): void {
    pathAnimationTimers.forEach(t => clearTimeout(t))
    pathAnimationTimers = []
    prebuiltNetwork.clearHighlightPath()
    isAnimatingPath.value = false
  }

  /**
   * Complete phrase with animation
   */
  async function completePhraseWithAnimation(legoIds: string[]): Promise<void> {
    await animatePathForVoice2(legoIds)
    practicePhrase(legoIds)
    await new Promise(r => setTimeout(r, 300))
    clearPathAnimation()
  }

  // ============================================================================
  // SETUP METHODS
  // ============================================================================

  /**
   * Initialize the network (called after view mounted)
   * For pre-built network, this is a no-op - actual init happens in populateFromRounds
   */
  function initialize(): void {
    console.debug('[PrebuiltNetworkIntegration] Initialize called - waiting for populateFromRounds')
  }

  /**
   * Set the center position
   */
  function setCenter(x: number, y: number): void {
    center.value = { x, y }
    prebuiltNetwork.setCenter(x, y)
  }

  /**
   * Update belt level
   */
  function setBelt(belt: string): void {
    currentBelt.value = belt
  }

  /**
   * Toggle fire path animation
   */
  function setShowFirePath(show: boolean): void {
    showFirePath.value = show
    localStorage.setItem('ssi-show-fire-path', show ? 'true' : 'false')
  }

  /**
   * Initialize the FULL network once at startup
   * This loads ALL course rounds and calculates positions ONCE.
   * After this, we never recalculate - just reveal/hide nodes.
   *
   * @param allRounds - ALL rounds for the entire course
   * @param externalConnections - Connections from database
   * @param currentRoundIndex - Current playback position (to reveal nodes up to this point)
   * @param externalNodes - Nodes from database (optional, ensures all LEGOs in connections have nodes)
   */
  function initializeFullNetwork(
    allRounds: Array<{
      legoId: string
      targetText?: string
      knownText?: string
      items?: Array<{ type: string; targetText?: string; knownText?: string }>
    }>,
    externalConnections?: ExternalConnection[],
    currentRoundIndex: number = 0,
    externalNodes?: Array<{
      id: string
      targetText: string
      knownText: string
      seedId?: string
      legoIndex?: number
      belt?: string
      isComponent?: boolean
      parentLegoIds?: string[]
    }>
  ): void {
    if (isFullNetworkLoaded.value) {
      console.debug('[PrebuiltNetworkIntegration] Full network already loaded, skipping')
      return
    }

    fullNetworkRounds = allRounds

    // Debug: Check if rounds have valid legoIds
    const validRounds = allRounds.filter(r => r?.legoId)
    console.debug(`%c[PrebuiltNetworkIntegration] ===== initializeFullNetwork =====`, 'background: #00f; color: #fff; font-weight: bold')
    console.debug(`  Total rounds: ${allRounds.length}`)
    console.debug(`  Valid rounds (with legoId): ${validRounds.length}`)
    console.debug(`  External connections: ${externalConnections?.length || 0}`)
    console.debug(`  External nodes: ${externalNodes?.length || 0}`)
    console.debug(`  Current round index: ${currentRoundIndex}`)
    if (validRounds.length !== allRounds.length) {
      console.warn(`  ⚠️ ${allRounds.length - validRounds.length} rounds missing legoId!`)
    }

    // Calculate ALL positions once - startOffset is always 0 for full network
    // Pass 'black' belt explicitly to ensure full brain boundary (scale 1.0)
    // Pass externalNodes so all LEGOs referenced in connections have network nodes
    prebuiltNetwork.loadFromRounds(allRounds, config.canvasSize, externalConnections, 0, 'black', externalNodes)

    // Debug: Check positions after calculation
    const calculatedNodes = prebuiltNetwork.nodes.value
    if (calculatedNodes.length > 0) {
      const samplePositions = calculatedNodes.slice(0, 3).map(n => ({ id: n.id, x: Math.round(n.x), y: Math.round(n.y) }))
      console.debug(`[PrebuiltNetworkIntegration] Sample node positions:`, samplePositions)
    }

    // Reveal nodes up to the current playback position
    // This is critical - loadFromRounds clears revealed nodes, so we must re-reveal
    if (currentRoundIndex >= 0) {
      prebuiltNetwork.revealUpToRound(currentRoundIndex, allRounds)
      console.debug(`[PrebuiltNetworkIntegration] Revealed ${currentRoundIndex + 1} nodes after full network load`)
    }

    isFullNetworkLoaded.value = true
    isInitialized.value = true

    console.debug(`[PrebuiltNetworkIntegration] FULL network initialized: ${prebuiltNetwork.nodes.value.length} nodes with positions`)
  }

  /**
   * Reveal nodes up to a given round index (0-based)
   * Only works if full network is loaded - just shows/hides, never recalculates
   *
   * @param upToRoundIndex - Reveal all nodes from round 0 to this index
   */
  function revealNodesUpToIndex(upToRoundIndex: number): void {
    if (!isFullNetworkLoaded.value) {
      console.warn('[PrebuiltNetworkIntegration] Cannot reveal - full network not loaded')
      return
    }

    prebuiltNetwork.revealUpToRound(upToRoundIndex, fullNetworkRounds)
    console.debug(`[PrebuiltNetworkIntegration] Revealed nodes up to round ${upToRoundIndex}`)
  }

  /**
   * Populate network from rounds
   * If full network is loaded, just reveals nodes (no recalculation).
   * Otherwise, falls back to calculating from provided rounds.
   *
   * @param rounds - Learning script rounds
   * @param upToIndex - Reveal nodes up to this index
   * @param externalConnections - Pre-loaded connections from database (like brain view)
   * @param startOffset - The seed position where these rounds start (for correct belt colors)
   */
  function populateFromRounds(
    rounds: Array<{
      legoId: string
      targetText?: string
      knownText?: string
      items?: Array<{ type: string; targetText?: string; knownText?: string }>
    }>,
    upToIndex: number,
    externalConnections?: ExternalConnection[],
    startOffset: number = 0
  ): void {
    // If full network is loaded, just reveal - don't recalculate!
    if (isFullNetworkLoaded.value) {
      // Convert playback script index to absolute round index
      const absoluteIndex = startOffset + upToIndex
      revealNodesUpToIndex(absoluteIndex)
      return
    }

    // Fallback: calculate from provided rounds (legacy behavior)
    cachedRoundsForNetwork = rounds

    // Pre-calculate ALL positions (even beyond upToIndex)
    // This way positions are stable as we reveal more nodes
    // Pass external connections if provided (from database)
    // Pass startOffset so belt colors are correct when loading mid-course
    // Pass 'black' belt to ensure full brain boundary (scale 1.0)
    prebuiltNetwork.loadFromRounds(rounds, config.canvasSize, externalConnections, startOffset, 'black')

    // Debug: Check positions after calculation
    if (prebuiltNetwork.nodes.value.length > 0) {
      const sample = prebuiltNetwork.nodes.value.slice(0, 3).map(n => ({ id: n.id, x: Math.round(n.x), y: Math.round(n.y) }))
      console.debug(`[PrebuiltNetworkIntegration] Sample positions:`, sample)
    }

    // Reveal nodes up to the current round
    prebuiltNetwork.revealUpToRound(upToIndex, rounds)

    isInitialized.value = true

    console.debug(`[PrebuiltNetworkIntegration] Pre-calculated ${prebuiltNetwork.nodes.value.length} positions (offset: ${startOffset}), revealed ${upToIndex + 1} nodes, connections: ${externalConnections ? 'database' : 'items'}`)
  }

  /**
   * Reset everything
   */
  function reset(): void {
    clearPathAnimation()
    prebuiltNetwork.reset()
  }

  // ============================================================================
  // NETWORK DATA MODEL (for backwards compatibility)
  // Wraps prebuiltNetwork with existing API surface
  // ============================================================================

  /**
   * Set hero node and pan to it
   */
  function setHero(nodeId: string, _position?: { x: number, y: number }): boolean {
    // Reveal the node if not already revealed
    if (!prebuiltNetwork.revealedNodeIds.value.has(nodeId)) {
      prebuiltNetwork.revealNode(nodeId, true)
    } else {
      // Just set hero and pan
      prebuiltNetwork.heroNodeId.value = nodeId
      prebuiltNetwork.updatePanOffset()
    }
    return true
  }

  const network = {
    nodes: prebuiltNetwork.visibleNodes,
    edges: prebuiltNetwork.visibleEdges,
    heroNodeId: prebuiltNetwork.heroNodeId,
    currentPath: prebuiltNetwork.currentPath,
    d3Nodes: prebuiltNetwork.visibleNodes,
    d3Links: prebuiltNetwork.visibleEdges,
    stats: computed(() => ({
      totalNodes: prebuiltNetwork.visibleNodes.value.length,
      totalEdges: prebuiltNetwork.visibleEdges.value.length,
      totalPractices: prebuiltNetwork.visibleEdges.value.reduce((sum, e) => sum + e.strength, 0),
      avgEdgeStrength: prebuiltNetwork.visibleEdges.value.length > 0
        ? prebuiltNetwork.visibleEdges.value.reduce((sum, e) => sum + e.strength, 0) / prebuiltNetwork.visibleEdges.value.length
        : 0,
      maxEdgeStrength: prebuiltNetwork.visibleEdges.value.length > 0
        ? Math.max(...prebuiltNetwork.visibleEdges.value.map(e => e.strength))
        : 0,
      density: 0,
    })),
    // Hero management
    setHero,
    // Path methods
    setHighlightPath: prebuiltNetwork.setHighlightPath,
    setPathActiveIndex: prebuiltNetwork.setPathActiveIndex,
    clearHighlightPath: prebuiltNetwork.clearHighlightPath,
    // Hebbian learning
    firePath: prebuiltNetwork.firePath,
  }

  // Fake simulation for compatibility (no-op in pre-built mode)
  const simulation = {
    isRunning: ref(false),
    tickCount: ref(0),
    initialize: () => {},
    restart: () => {},
    nudge: () => {},
    stop: () => {},
    onTick: () => () => {},
    setCenter: () => {},
  }

  // ============================================================================
  // VIEW PROPS
  // ============================================================================

  const viewProps = computed(() => {
    const edges = prebuiltNetwork.visibleEdges.value
    const nodes = prebuiltNetwork.visibleNodes.value
    const allNodes = prebuiltNetwork.nodes.value
    const revealedCount = prebuiltNetwork.revealedNodeIds.value.size

    // Debug: always log to diagnose empty network issue
    if (allNodes.length > 0 && nodes.length === 0) {
      console.warn(`[PrebuiltNetworkIntegration] viewProps: 0 visible of ${allNodes.length} total nodes! Revealed IDs: ${revealedCount}`)
      if (revealedCount > 0) {
        console.debug('[PrebuiltNetworkIntegration] Revealed IDs sample:', Array.from(prebuiltNetwork.revealedNodeIds.value).slice(0, 5))
        console.debug('[PrebuiltNetworkIntegration] Node IDs sample:', allNodes.slice(0, 5).map(n => n.id))
      }
    } else if (nodes.length > 0) {
      console.debug(`[PrebuiltNetworkIntegration] viewProps: ${nodes.length} nodes, ${edges.length} edges`)
    }

    return {
      nodes,
      edges,
      heroNodeId: prebuiltNetwork.heroNodeId.value,
      currentPath: prebuiltNetwork.currentPath.value,
      panTransform: prebuiltNetwork.networkTransform.value,
      beltLevel: currentBelt.value,
      showFirePath: showFirePath.value,
    }
  })

  // ============================================================================
  // MINIMAL CONSTELLATION (for focused phrase view)
  // ============================================================================

  /**
   * Load a minimal constellation showing only the current LEGO and its phrase LEGOs
   * Much lighter than full network - perfect for focused learning view
   */
  function loadMinimalConstellation(
    heroId: string,
    heroData: { target: string; known: string; belt: string },
    phraseLegoIds: string[],
    legoDataMap: Map<string, { target: string; known: string }>
  ): void {
    prebuiltNetwork.loadMinimalConstellation(
      heroId,
      heroData,
      phraseLegoIds,
      legoDataMap,
      config.canvasSize
    )
    isInitialized.value = true
    console.debug(`[PrebuiltNetworkIntegration] Loaded minimal constellation for ${heroId}`)
  }

  // ============================================================================
  // EXPORT (matching existing API)
  // ============================================================================

  return {
    // Core composables (wrapped for compatibility)
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
    animateNodesForVoice1,
    animatePathForVoice2,
    completePhraseWithAnimation,
    clearPathAnimation,

    // Setup methods
    initialize,
    setCenter,
    setBelt,
    setShowFirePath,
    populateFromRounds,
    reset,

    // Full network (load once, never recalculate)
    initializeFullNetwork,
    revealNodesUpToIndex,
    isFullNetworkLoaded,

    // Minimal constellation (for focused phrase view)
    loadMinimalConstellation,

    // Display settings
    showFirePath,

    // Statistics
    stats: network.stats,

    // Pre-built specific
    prebuiltNetwork,
    isInitialized,
  }
}
