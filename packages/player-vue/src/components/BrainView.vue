<script setup lang="ts">
/**
 * BrainView.vue - Pre-computed Network Visualization for Progress Screen
 *
 * Shows the learner's growing neural network using pre-computed positions.
 * - Slider controls how many LEGOs are visible (50/100/200/400/All)
 * - Click any node to see its phrases and play target audio
 * - Always centered on network core (no hero panning)
 *
 * Future: Will animate a fast-forward replay of how the brain grew.
 */

import { ref, computed, inject, onMounted, onUnmounted, watch, type PropType } from 'vue'
import CanvasNetworkView from './CanvasNetworkView.vue'
import UsageStats from './UsageStats.vue'
import Brain3DView from './Brain3DView.vue'
import BrainStatsMobile from './BrainStatsMobile.vue'
import { usePrebuiltNetwork, type ExternalConnection, type ExternalNode, type ConstellationNode } from '../composables/usePrebuiltNetwork'
import { useLegoNetwork, type PhraseWithPath } from '../composables/useLegoNetwork'
import { useCompletedContent } from '../composables/useCompletedContent'
// NOTE: generateLearningScript is deprecated and returns empty data
// BrainView uses database nodes (externalNodes) as primary source now
// The rounds from generateLearningScript are only used for backwards compat
import { generateLearningScript } from '../providers/CourseDataProvider'
import { getLanguageName } from '../composables/useI18n'
import { BELTS } from '../composables/useBeltProgress'
import type { SessionController } from '../playback/SessionController'

// ============================================================================
// AUDIO CONTROLLER (target language only)
// ============================================================================

class TargetAudioController {
  private audio: HTMLAudioElement | null = null

  async play(url: string, speed: number = 1): Promise<void> {
    if (!this.audio) {
      this.audio = new Audio()
    }

    this.audio.src = url
    this.audio.load()

    return new Promise((resolve, reject) => {
      const onEnded = () => {
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
        resolve()
      }

      const onError = (e: Event) => {
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
        reject(e)
      }

      this.audio!.addEventListener('ended', onEnded)
      this.audio!.addEventListener('error', onError)

      this.audio!.playbackRate = speed
      this.audio!.play().catch(onError)
    })
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
    }
  }
}

// ============================================================================
// PROPS & EMITS
// ============================================================================

const props = defineProps({
  course: {
    type: Object,
    default: null
  },
  beltLevel: {
    type: String,
    default: 'white'
  },
  completedRounds: {
    type: Number,
    default: 0
  },
  /**
   * When provided, BrainView uses completedLegoIds from the session
   * to determine which nodes are visible (session mode).
   * When null, uses the slider for visibility (standalone mode).
   */
  sessionController: {
    type: Object as PropType<SessionController | null>,
    default: null
  }
})

const emit = defineEmits(['close'])

// ============================================================================
// INJECTIONS
// ============================================================================

const supabase = inject<{ value: any }>('supabase', { value: null })
const courseDataProvider = inject<{ value: any }>('courseDataProvider', { value: null })

// ============================================================================
// CONSTANTS
// ============================================================================

// S3 base URL (s3_key contains the full path like "mastered/UUID.mp3")
const AUDIO_S3_BASE_URL = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com'

// ============================================================================
// STATE
// ============================================================================

const isLoading = ref(true)
const error = ref<string | null>(null)

// Pre-built network composable
const prebuiltNetwork = usePrebuiltNetwork()

// Network data from database (for connections AND phrases)
const { loadNetworkData, networkData, getEternalPhrasesForLego, getLegoConnections } = useLegoNetwork(supabase as any)

// All rounds loaded from script
const allRounds = ref<any[]>([])

// Slider state - defaults to learner's progress (completedRounds approximates LEGOs encountered)
const sliderValue = ref(props.completedRounds || 100)
const sliderMax = computed(() => allRounds.value.length || 100)

// Admin/Testing mode - show all nodes regardless of progress
const showAllForTesting = ref(false)

// ============================================================================
// SESSION MODE - Use completedLegoIds from SessionController when provided
// ============================================================================

/**
 * Whether we're in session mode (showing only completed LEGOs)
 * vs standalone mode (using slider for visibility)
 */
const isSessionMode = computed(() => props.sessionController !== null)

/**
 * Completed content from session controller (when in session mode)
 */
const completedContent = computed(() => {
  if (!props.sessionController) return null
  return useCompletedContent(props.sessionController)
})

/**
 * Visible node IDs based on mode:
 * - Session mode: completed LEGOs from SessionController
 * - Standalone mode: LEGOs up to slider value (existing behavior)
 */
const sessionVisibleNodeIds = computed<Set<string>>(() => {
  if (completedContent.value) {
    return completedContent.value.completedLegoIds.value
  }
  // Fallback: slider-based visibility (handled by updateVisibility)
  return new Set<string>()
})

// Admin mode - check URL param (?admin=true) or localStorage
const isAdmin = computed(() => {
  if (typeof window === 'undefined') return false
  try {
    // Check URL parameter first
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('admin') === 'true') {
      return true
    }
    // Fallback to localStorage
    return localStorage.getItem('ssi-admin-mode') === 'true'
  } catch (e) {
    return false
  }
})

// Container ref for sizing
const containerRef = ref<HTMLElement | null>(null)
const canvasSize = ref({ width: 800, height: 800 })

// Node selection state
const selectedNode = ref<ConstellationNode | null>(null)
const isPanelOpen = ref(false)

// Phrase playback state
const selectedNodePhrases = ref<PhraseWithPath[]>([])
const isPlayingAudio = ref(false)

// Playback speed options
const SPEED_OPTIONS = [1, 1.2, 1.5, 2] as const
const playbackSpeed = ref(1.5)  // Default to 1.5x for review mode
const isPracticingPhrases = ref(false)
const currentPhraseIndex = ref(0)
const currentPracticingPhrase = ref<PhraseWithPath | null>(null)

// Mobile subtitle overlay state
const showSubtitleOverlay = ref(false)

// Connection data for selected node
const selectedNodeConnections = ref<{ followsFrom: { legoId: string; count: number }[]; leadsTo: { legoId: string; count: number }[] }>({ followsFrom: [], leadsTo: [] })

// Audio
const audioController = ref<TargetAudioController | null>(null)
let phrasePracticeTimer: ReturnType<typeof setTimeout> | null = null

// Path animation timers
let pathAnimationTimers: ReturnType<typeof setTimeout>[] = []

// Download state
const isDownloading = ref(false)

// Network component ref (for fit-all button)
const networkRef = ref<{ resetZoomPan: () => void } | null>(null)

// 3D brain component ref (for flyToNode on desktop)
const brain3DRef = ref<InstanceType<typeof Brain3DView> | null>(null)

// Search state
const searchQuery = ref('')
const isSearchFocused = ref(false)

// Handler for search blur event - delays focus loss to allow result clicks
function handleSearchBlur(): void {
  window.setTimeout(() => {
    isSearchFocused.value = false
  }, 200)
}

// Tab state: 'brain' | 'belts' | 'usage'
// Default to 'belts' so brain loads in background while user views simpler content
const activeTab = ref<'brain' | 'belts' | 'usage'>('belts')

// ============================================================================
// PLATFORM DETECTION (Desktop vs Mobile)
// ============================================================================

/**
 * Reactive platform detection for conditional brain rendering
 * Desktop: screen width > 1024px (touchscreen laptops should still get 3D view)
 * Mobile: screen width <= 1024px (phones, tablets)
 *
 * Note: We removed the touch-primary check because many modern laptops have
 * touchscreens but should still render the full 3D brain visualization.
 */
const screenWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024)

// Reactive desktop detection - based purely on screen width
const isDesktop = computed(() => {
  const result = screenWidth.value > 1024
  console.log('[BrainView] Platform detection:', { screenWidth: screenWidth.value, isDesktop: result })
  return result
})

// Handle resize events for reactive platform detection
let resizeHandler: (() => void) | null = null

function setupPlatformDetection() {
  if (typeof window === 'undefined') return

  // Resize handler for screen width
  resizeHandler = () => {
    screenWidth.value = window.innerWidth
  }
  window.addEventListener('resize', resizeHandler)
}

function cleanupPlatformDetection() {
  if (typeof window === 'undefined') return

  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
}

// ============================================================================
// MOBILE STATS DATA (for BrainStatsMobile component)
// ============================================================================

// Calculate belt progress for mobile stats dashboard
const beltProgressData = computed(() => {
  const currentBelt = BELTS.find(b => b.name === props.beltLevel)
  const currentBeltIndex = BELTS.findIndex(b => b.name === props.beltLevel)
  const nextBelt = currentBeltIndex < BELTS.length - 1 ? BELTS[currentBeltIndex + 1] : null

  if (!currentBelt || !nextBelt) {
    return { current: props.completedRounds, target: currentBelt?.seedsRequired || 0, percentage: 100, ratio: 1 }
  }

  const progressInBelt = props.completedRounds - currentBelt.seedsRequired
  const beltRange = nextBelt.seedsRequired - currentBelt.seedsRequired
  const percentage = Math.min(100, Math.round((progressInBelt / beltRange) * 100))
  const ratio = Math.min(1, progressInBelt / beltRange)

  return {
    current: props.completedRounds,
    target: nextBelt.seedsRequired,
    percentage,
    ratio
  }
})

// Belt progress as 0-1 ratio for BrainStatsMobile
const beltProgressRatio = computed(() => beltProgressData.value.ratio)

// Seeds needed to reach next belt
const seedsToNextBelt = computed(() => {
  const currentBeltIndex = BELTS.findIndex(b => b.name === props.beltLevel)
  const nextBelt = currentBeltIndex < BELTS.length - 1 ? BELTS[currentBeltIndex + 1] : null
  if (!nextBelt) return 0
  return Math.max(0, nextBelt.seedsRequired - props.completedRounds)
})

// TODO: This should come from Supabase user_sessions table
// For now, provide placeholder values (all zeros)
const weekActivity = computed(() => {
  // Return array of 7 values representing activity for each day of the week
  // Once we have real data, this should query user_sessions
  return [0, 0, 0, 0, 0, 0, 0]
})

// TODO: These stats should come from Supabase user_sessions table
// For now, provide placeholder values
const totalMinutes = computed(() => {
  // Estimate: ~2.5 minutes per seed completed
  return Math.round(props.completedRounds * 2.5)
})

const currentStreak = computed(() => {
  // TODO: Calculate from user_sessions table
  // For now, return a placeholder
  return 0
})

// ============================================================================
// COMPUTED
// ============================================================================

// Belt-colored accent
const beltColors: Record<string, string> = {
  white: '#9ca3af',
  yellow: '#fbbf24',
  orange: '#f97316',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  brown: '#a87848',
  black: '#d4a853',
}

const accentColor = computed(() => beltColors[props.beltLevel] || beltColors.white)

// Nodes to show based on slider (or all if testing mode)
// In session mode, this is ignored since we use sessionVisibleNodeIds directly
const visibleCount = computed(() => {
  // In session mode, count is determined by completed LEGOs
  if (isSessionMode.value && completedContent.value) {
    return completedContent.value.completedLegoIds.value.size
  }
  if (showAllForTesting.value) {
    return allRounds.value.length
  }
  return Math.min(sliderValue.value, allRounds.value.length)
})

// Course code
const courseCode = computed(() => props.course?.course_code || '')

// Language name for title (e.g., "Spanish", "Welsh")
const languageName = computed(() => {
  const targetLang = props.course?.target_lang
  return targetLang ? getLanguageName(targetLang) : ''
})

// Global stats from network data
const globalStats = computed(() => {
  if (!networkData.value) return { phrases: 0, concepts: 0, connections: 0 }
  return {
    phrases: networkData.value.stats.totalPhrases,
    concepts: networkData.value.stats.totalLegos,
    connections: networkData.value.stats.uniqueConnections
  }
})

// Helper to look up LEGO text by ID
function getLegoText(legoId: string): string {
  if (!networkData.value) return legoId
  const node = networkData.value.nodes.find(n => n.id === legoId)
  return node?.targetText || legoId
}

// Selected node's phrase count (how many phrases use this LEGO)
const selectedNodePhraseCount = computed(() => {
  if (!selectedNode.value || !networkData.value) return 0
  const phrases = networkData.value.phrasesByLego.get(selectedNode.value.id)
  return phrases?.length || 0
})

// Belt data for belts tab
const beltsList = computed(() => BELTS)
const currentBeltIndex = computed(() => {
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (props.completedRounds >= BELTS[i].seedsRequired) {
      return i
    }
  }
  return 0
})

// Search results - filter nodes by target or known text
const searchResults = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query || query.length < 2) return []

  const nodes = prebuiltNetwork.nodes.value
  if (!nodes.length) return []

  return nodes
    .filter(node => {
      const targetMatch = node.targetText?.toLowerCase().includes(query)
      const knownMatch = node.knownText?.toLowerCase().includes(query)
      return targetMatch || knownMatch
    })
    .slice(0, 10) // Limit to 10 results
})

// ============================================================================
// METHODS
// ============================================================================

/**
 * Update network visibility when slider changes or session state updates
 * NOTE: No hero panning - stays centered on network core
 *
 * @param count - Number of LEGOs to show (ignored in session mode)
 */
function updateVisibility(count: number) {
  // In session mode, use completedLegoIds from SessionController
  if (isSessionMode.value && completedContent.value) {
    prebuiltNetwork.revealedNodeIds.value = completedContent.value.completedLegoIds.value
    // NO hero panning - keep centered on network core
    prebuiltNetwork.heroNodeId.value = null
    prebuiltNetwork.panOffset.value = { x: 0, y: 0 }
    return
  }

  // Standalone mode: use completedRounds to determine which seeds to show
  // Since generateLearningScript is deprecated, we use seedId from nodes
  if (!allRounds.value.length) {
    // Build set from nodes where seed number <= completedRounds
    const completedSeeds = props.completedRounds || 0
    const newSet = new Set<string>()

    // Get nodes from prebuiltNetwork (they have seedId like "S0001")
    for (const node of prebuiltNetwork.nodes.value) {
      // Parse seed number from seedId (e.g., "S0001" → 1, "COMP" → skip)
      const seedMatch = node.seedId?.match(/^S(\d+)$/)
      if (seedMatch) {
        const seedNum = parseInt(seedMatch[1], 10)
        if (seedNum <= completedSeeds) {
          newSet.add(node.id)
        }
      } else if (node.isComponent) {
        // Components: show if any parent LEGO is revealed
        // For now, show all components (they're extracted from M-type LEGOs)
        // TODO: Could filter based on parent LEGO visibility
        newSet.add(node.id)
      }
    }

    prebuiltNetwork.revealedNodeIds.value = newSet
    prebuiltNetwork.heroNodeId.value = null
    prebuiltNetwork.panOffset.value = { x: 0, y: 0 }

    console.log(`[BrainView] Standalone mode: showing ${newSet.size} nodes for ${completedSeeds} completed seeds`)
    return
  }

  // Legacy: slider-based visibility (if allRounds exists)
  // Build new Set first, then assign to trigger Vue reactivity
  const newSet = new Set<string>()
  for (let i = 0; i < count && i < allRounds.value.length; i++) {
    const legoId = allRounds.value[i]?.legoId
    if (legoId) {
      newSet.add(legoId)
    }
  }
  prebuiltNetwork.revealedNodeIds.value = newSet

  // NO hero panning - keep centered on network core
  // Clear hero to keep view centered
  prebuiltNetwork.heroNodeId.value = null
  prebuiltNetwork.panOffset.value = { x: 0, y: 0 }
}

/**
 * Handle node tap from ConstellationNetworkView
 * Desktop: Open full side panel
 * Mobile: Show subtitle overlay (keeps brain visible for fire path animation)
 */
async function handleNodeTap(node: ConstellationNode) {
  selectedNode.value = node
  currentPhraseIndex.value = 0
  isPracticingPhrases.value = false
  currentPracticingPhrase.value = null

  // Clear previous phrases while loading new ones
  selectedNodePhrases.value = []

  // Desktop: open full panel, Mobile: show subtitle overlay
  if (isDesktop.value) {
    isPanelOpen.value = true
  } else {
    showSubtitleOverlay.value = true
  }

  // Load connection data (what precedes/follows this LEGO)
  selectedNodeConnections.value = getLegoConnections(node.id)

  // Load eternal phrases for this LEGO (async database query)
  // These are phrases containing this LEGO - like the Brain Network does
  console.log('[BrainView] Loading eternal phrases for:', node.targetText)
  const phrases = await getEternalPhrasesForLego(node.id, node.targetText)

  // Don't filter phrases - show all eternal phrases for this LEGO
  // Fire path animation will only animate nodes that are visible in the brain
  selectedNodePhrases.value = phrases
  console.log('[BrainView] Found', phrases.length, 'eternal phrases for', node.targetText)
}

/**
 * Handle selecting a search result
 * Desktop: Fly to node in 3D view, then open detail panel
 * Mobile: Open detail panel directly (or show "view on desktop" message)
 */
function selectSearchResult(node: ConstellationNode) {
  // Clear search
  searchQuery.value = ''
  isSearchFocused.value = false

  if (isDesktop.value && brain3DRef.value?.flyToNode) {
    // Desktop: Fly to node in 3D view first
    brain3DRef.value.flyToNode(node.id)
    // Then open detail panel
    setTimeout(() => handleNodeTap(node), 500) // Small delay for fly animation
  } else {
    // Mobile or fallback: Select the node directly
    handleNodeTap(node)
  }
}

/**
 * Handle mobile search from BrainStatsMobile component
 * On mobile, searches filter a word list or show guidance
 */
function handleMobileSearch(query: string) {
  searchQuery.value = query
  isSearchFocused.value = true
  // The search results computed will filter nodes automatically
}

/**
 * Close the detail panel
 */
function closePanel() {
  isPanelOpen.value = false
  selectedNode.value = null
  stopPhrasePractice()
  clearPathAnimation()
  selectedNodePhrases.value = []
  prebuiltNetwork.clearHighlightPath()
}

/**
 * Close the mobile subtitle overlay
 */
function closeSubtitleOverlay() {
  showSubtitleOverlay.value = false
  selectedNode.value = null
  stopPhrasePractice()
  clearPathAnimation()
  selectedNodePhrases.value = []
  prebuiltNetwork.clearHighlightPath()
}

/**
 * Expand from subtitle overlay to full panel (mobile)
 */
function expandToFullPanel() {
  showSubtitleOverlay.value = false
  isPanelOpen.value = true
}

/**
 * Toggle phrase practice playback
 */
function togglePhrasePractice() {
  if (isPracticingPhrases.value) {
    stopPhrasePractice()
  } else {
    startPhrasePractice()
  }
}

/**
 * Clear path animation timers
 */
function clearPathAnimation() {
  pathAnimationTimers.forEach(t => clearTimeout(t))
  pathAnimationTimers = []
}

/**
 * Animate the fire path - stepping through nodes synchronized with audio
 * Only animates nodes that are visible in the brain (revealed)
 */
function animateFirePath(legoIds: string[], audioDurationMs: number) {
  clearPathAnimation()

  console.log('[BrainView] animateFirePath called with', legoIds?.length || 0, 'LEGOs:', legoIds)

  if (!legoIds || legoIds.length === 0) {
    console.log('[BrainView] No LEGOs in path, skipping animation')
    return
  }

  // Filter to only animate nodes that are visible in the brain
  // This allows phrases to play even when some LEGOs aren't revealed yet
  const revealedIds = prebuiltNetwork.revealedNodeIds.value
  const visiblePath = legoIds.filter(id => revealedIds.has(id))

  console.log('[BrainView] Fire path: full path has', legoIds.length, 'LEGOs,', visiblePath.length, 'visible in brain')

  if (visiblePath.length === 0) {
    console.log('[BrainView] No visible LEGOs in path, skipping animation (audio still plays)')
    return
  }

  // Set up the path with only visible nodes (starts with activeIndex -1)
  console.log('[BrainView] Setting highlight path for visible LEGOs:', visiblePath)
  prebuiltNetwork.setHighlightPath(visiblePath)
  console.log('[BrainView] currentPath is now:', prebuiltNetwork.currentPath.value)

  // Calculate step duration - spread visible nodes across audio
  const stepDuration = Math.max(150, audioDurationMs / visiblePath.length)

  // Animate through each visible node
  for (let i = 0; i < visiblePath.length; i++) {
    const timer = setTimeout(() => {
      prebuiltNetwork.setPathActiveIndex(i)
    }, i * stepDuration)
    pathAnimationTimers.push(timer)
  }
}

/**
 * Download brain network as shareable image
 * Renders directly to Canvas for reliability (bypasses SVG/CSS complexity)
 */
async function downloadBrainImage() {
  if (isDownloading.value) return

  isDownloading.value = true

  try {
    const nodes = prebuiltNetwork.nodes.value
    const edges = prebuiltNetwork.visibleEdges.value
    const revealed = prebuiltNetwork.revealedNodeIds.value

    if (!nodes.length) {
      console.warn('[BrainView] No nodes to render')
      isDownloading.value = false
      return
    }

    // Canvas dimensions (high-res for sharing)
    const size = 1200
    const titleHeight = 80
    const padding = 100

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size + titleHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Calculate bounds of the network
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    nodes.forEach(node => {
      minX = Math.min(minX, node.x)
      maxX = Math.max(maxX, node.x)
      minY = Math.min(minY, node.y)
      maxY = Math.max(maxY, node.y)
    })

    // Scale to fit canvas with padding
    const networkWidth = maxX - minX || 1
    const networkHeight = maxY - minY || 1
    const scale = Math.min(
      (size - padding * 2) / networkWidth,
      (size - padding * 2) / networkHeight
    )

    // Transform function to map network coords to canvas coords
    const toCanvas = (x: number, y: number) => ({
      x: padding + (x - minX) * scale,
      y: titleHeight + padding + (y - minY) * scale
    })

    // Dark background with subtle gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, '#0a0a0f')
    gradient.addColorStop(0.5, '#0f0f18')
    gradient.addColorStop(1, '#12121a')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw title in belt color
    ctx.fillStyle = accentColor.value
    ctx.font = '600 36px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.shadowColor = accentColor.value
    ctx.shadowBlur = 20
    ctx.fillText(`Your brain on ${languageName.value}`, canvas.width / 2, 52)
    ctx.shadowBlur = 0

    // Draw edges - only between revealed nodes are prominent
    ctx.lineCap = 'round'
    edges.forEach(edge => {
      const sourceNode = nodes.find(n => n.id === edge.source)
      const targetNode = nodes.find(n => n.id === edge.target)
      if (!sourceNode || !targetNode) return

      const sourceRevealed = !revealed || revealed.has(sourceNode.id)
      const targetRevealed = !revealed || revealed.has(targetNode.id)
      const bothRevealed = sourceRevealed && targetRevealed

      const from = toCanvas(sourceNode.x, sourceNode.y)
      const to = toCanvas(targetNode.x, targetNode.y)

      // Curved edge (quadratic bezier)
      const midX = (from.x + to.x) / 2
      const midY = (from.y + to.y) / 2
      const dx = to.x - from.x
      const dy = to.y - from.y
      const len = Math.sqrt(dx * dx + dy * dy)
      const curveAmount = Math.min(20, len * 0.12)
      const perpX = -dy / (len || 1)
      const perpY = dx / (len || 1)
      const hash = edge.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
      const direction = hash % 2 === 0 ? 1 : -1
      const cpX = midX + perpX * curveAmount * direction
      const cpY = midY + perpY * curveAmount * direction

      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.quadraticCurveTo(cpX, cpY, to.x, to.y)

      // Edges between learned nodes are visible; others are ghost outlines
      // FIXED: Increased opacity so edges are clearly visible
      const edgeOpacity = bothRevealed
        ? 0.35 + Math.sqrt(edge.strength) * 0.15
        : 0.04  // Ghost edges for unlearned parts
      ctx.strokeStyle = `rgba(255, 255, 255, ${edgeOpacity})`
      ctx.lineWidth = bothRevealed ? 1.5 + Math.sqrt(edge.strength) * 0.5 : 0.5
      ctx.stroke()
    })

    // Belt colors for nodes
    const beltColorMap: Record<string, { glow: string; core: string; inner: string }> = {
      white: { glow: '#9ca3af', core: '#2a2a35', inner: '#ffffff' },
      yellow: { glow: '#fbbf24', core: '#2a2518', inner: '#fbbf24' },
      orange: { glow: '#f97316', core: '#2a1a10', inner: '#f97316' },
      green: { glow: '#22c55e', core: '#102a1a', inner: '#22c55e' },
      blue: { glow: '#3b82f6', core: '#101a2a', inner: '#3b82f6' },
      purple: { glow: '#8b5cf6', core: '#1a102a', inner: '#8b5cf6' },
      brown: { glow: '#a87848', core: '#2a1a10', inner: '#a87848' },
      black: { glow: '#d4a853', core: '#2a2518', inner: '#d4a853' },
    }

    // Draw nodes - learned nodes prominent, unlearned are ghost outlines
    nodes.forEach(node => {
      const pos = toCanvas(node.x, node.y)
      const isRevealed = !revealed || revealed.has(node.id)
      const palette = beltColorMap[node.belt] || beltColorMap.white
      // Learned nodes are bright; unlearned are barely visible ghosts (0.03)
      const opacity = isRevealed ? (node.isComponent ? 0.7 : 1.0) : 0.03
      const nodeScale = node.isComponent ? 0.7 : 1
      const baseRadius = 6 * nodeScale

      // Only draw full node for revealed, just faint dot for unrevealed
      if (isRevealed) {
        // Outer glow ring
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, baseRadius * 1.8, 0, Math.PI * 2)
        ctx.strokeStyle = palette.glow
        ctx.globalAlpha = opacity * 0.7
        ctx.lineWidth = 2
        ctx.stroke()

        // Core circle
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, baseRadius, 0, Math.PI * 2)
        ctx.fillStyle = palette.core
        ctx.globalAlpha = opacity
        ctx.fill()
        ctx.strokeStyle = palette.glow
        ctx.lineWidth = 1.5
        ctx.stroke()

        // Bright inner dot
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, baseRadius * 0.4, 0, Math.PI * 2)
        ctx.fillStyle = palette.inner
        ctx.globalAlpha = opacity
        ctx.fill()
      } else {
        // Ghost node - just a tiny faint dot to show network shape
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
        ctx.globalAlpha = 1
        ctx.fill()
      }

      ctx.globalAlpha = 1
    })

    // Add watermark/branding
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText('saysomethingin.com', size - 20, size + titleHeight - 20)

    // Download
    const downloadUrl = canvas.toDataURL('image/png')
    const link = document.createElement('a')
    link.download = `brain-on-${languageName.value.toLowerCase().replace(/\s+/g, '-')}.png`
    link.href = downloadUrl
    link.click()

    console.log('[BrainView] Image downloaded successfully')
  } catch (err) {
    console.error('[BrainView] Download failed:', err)
  } finally {
    isDownloading.value = false
  }
}

/**
 * Play target audio for a phrase with fire path animation
 */
async function playPhrase(phrase: PhraseWithPath) {
  if (!phrase || !supabase?.value || !courseCode.value) return

  currentPracticingPhrase.value = phrase
  isPlayingAudio.value = true

  // Clear any existing animation
  clearPathAnimation()

  try {
    // Initialize audio controller if needed
    if (!audioController.value) {
      audioController.value = new TargetAudioController()
    }

    // Query practice_cycles to get audio s3_key and duration for this phrase
    // Use target2 (Voice 2) as that's the "reveal" voice in the learning cycle
    const { data: phraseData, error: err } = await supabase.value
      .from('practice_cycles')
      .select('target1_s3_key, target2_s3_key, target1_duration_ms, target2_duration_ms')
      .eq('course_code', courseCode.value)
      .eq('target_text', phrase.targetText)
      .limit(1)
      .single()

    if (err) {
      console.warn('[BrainView] Phrase audio lookup failed:', err.message)
      return
    }

    if (phraseData) {
      // Prefer target2 (reveal voice), fallback to target1
      const s3Key = phraseData.target2_s3_key || phraseData.target1_s3_key
      if (s3Key) {
        const audioUrl = `${AUDIO_S3_BASE_URL}/${s3Key}`
        console.log('[BrainView] Playing phrase:', phrase.targetText, audioUrl)

        // Get audio duration from database (prefer target2, fallback to target1, default 2000ms)
        const audioDuration = phraseData.target2_duration_ms || phraseData.target1_duration_ms || 2000

        // Start fire path animation synchronized with audio
        animateFirePath(phrase.legoPath, audioDuration)

        // Play the audio at user's selected speed
        await audioController.value.play(audioUrl, playbackSpeed.value)
      }
    }
  } catch (err) {
    console.warn('[BrainView] Phrase audio playback error:', err)
  } finally {
    isPlayingAudio.value = false
  }
}

/**
 * Start auto-playing through phrases
 */
async function startPhrasePractice() {
  if (selectedNodePhrases.value.length === 0) return

  isPracticingPhrases.value = true
  currentPhraseIndex.value = 0
  await playNextPhraseInPractice()
}

/**
 * Play the next phrase in practice sequence
 */
async function playNextPhraseInPractice() {
  if (!isPracticingPhrases.value) return

  if (currentPhraseIndex.value >= selectedNodePhrases.value.length) {
    // Loop back to start
    currentPhraseIndex.value = 0
  }

  const phrase = selectedNodePhrases.value[currentPhraseIndex.value]

  try {
    await playPhrase(phrase)
  } catch (err) {
    console.warn('[BrainView] Error playing phrase, continuing to next:', err)
  }

  // Schedule next phrase regardless of success/failure
  // Short delay between phrases for natural rhythm
  if (isPracticingPhrases.value) {
    const delay = 1500  // 1.5 second gap between phrases
    phrasePracticeTimer = setTimeout(() => {
      currentPhraseIndex.value++
      playNextPhraseInPractice()
    }, delay)
  }
}

/**
 * Stop phrase practice
 */
function stopPhrasePractice() {
  isPracticingPhrases.value = false
  currentPracticingPhrase.value = null
  isPlayingAudio.value = false

  if (phrasePracticeTimer) {
    clearTimeout(phrasePracticeTimer)
    phrasePracticeTimer = null
  }

  // Clear path animation
  clearPathAnimation()

  if (audioController.value) {
    audioController.value.stop()
  }

  prebuiltNetwork.clearHighlightPath()
}

/**
 * Play a specific phrase when clicked
 */
function playSpecificPhrase(phrase: PhraseWithPath) {
  stopPhrasePractice()
  playPhrase(phrase)
}

/**
 * Load all data and pre-calculate network
 */
async function loadData() {
  if (!props.course?.course_code || !courseDataProvider.value) {
    error.value = 'Course not configured'
    isLoading.value = false
    return
  }

  isLoading.value = true
  error.value = null

  try {
    console.log('[BrainView] Loading data for', props.course.course_code)

    // Load connections AND nodes from database
    // Using database nodes ensures all LEGOs referenced in connections have corresponding nodes
    const netData = await loadNetworkData(props.course.course_code)
    const connections: ExternalConnection[] = netData?.connections || []

    console.log(`[BrainView] Network data for ${props.course.course_code}:`)
    console.log(`  - LEGOs: ${netData?.stats?.totalLegos || 0}`)
    console.log(`  - Components: ${netData?.stats?.totalComponents || 0}`)
    console.log(`  - Phrases: ${netData?.stats?.totalPhrases || 0}`)
    console.log(`  - Phrases with paths: ${netData?.stats?.phrasesWithPaths || 0}`)
    console.log(`  - Connections: ${netData?.stats?.uniqueConnections || 0}`)
    console.log(`  - phrasesByLego entries: ${netData?.phrasesByLego?.size || 0}`)

    if (netData?.stats?.totalPhrases > 0 && netData?.stats?.phrasesWithPaths === 0) {
      console.warn(`[BrainView] ⚠️ PROBLEM: ${netData.stats.totalPhrases} phrases loaded but none have LEGO paths!`)
      console.warn(`[BrainView] This means phrase decomposition failed - phrase text doesn't match LEGO target texts`)
    }

    if (netData?.stats?.totalLegos > 0 && (netData?.phrasesByLego?.size || 0) === 0) {
      console.warn(`[BrainView] ⚠️ PROBLEM: LEGOs exist but no phrases are indexed to them`)
      console.warn(`[BrainView] When you click a LEGO, it will show "no phrases use this lego"`)
    }

    // Convert database nodes to ExternalNode format for the prebuilt network
    // This ensures all LEGOs are available for connections (not just those in learning script rounds)
    const externalNodes: ExternalNode[] = (netData?.nodes || []).map(dbNode => ({
      id: dbNode.id,
      targetText: dbNode.targetText,
      knownText: dbNode.knownText,
      seedId: dbNode.seedId,
      legoIndex: dbNode.legoIndex,
      belt: dbNode.birthBelt,
      isComponent: dbNode.isComponent,
      parentLegoIds: dbNode.parentLegoIds,
    }))

    console.log(`[BrainView] Converted ${externalNodes.length} database nodes for network`)

    // NOTE: generateLearningScript is deprecated and returns empty data
    // BrainView now uses externalNodes as the primary data source
    // The rounds were previously used for backwards compat but are now empty
    // Keeping the call for structure but it returns [] now
    const MAX_ROUNDS = 1000
    const { rounds } = await generateLearningScript(
      courseDataProvider.value,
      MAX_ROUNDS,
      0
    )

    allRounds.value = rounds
    // Since generateLearningScript is deprecated, rounds will be empty
    // The network now uses externalNodes directly
    if (rounds.length === 0) {
      console.log(`[BrainView] generateLearningScript returned empty (deprecated) - using ${externalNodes.length} database nodes directly`)
    } else {
      console.log(`[BrainView] Loaded ${rounds.length} rounds from script`)
    }

    // Update canvas size based on container
    if (containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect()
      canvasSize.value = {
        width: Math.max(800, rect.width),
        height: Math.max(800, rect.height)
      }
    }

    // Pre-calculate all positions with brain boundary based on belt level
    // Use database nodes as the primary source to ensure all LEGOs have nodes
    // The network will be constrained within a "growing brain" shape
    prebuiltNetwork.loadFromRounds(rounds, canvasSize.value, connections, 0, props.beltLevel, externalNodes)

    // Set center for panning (centered on network, not hero)
    prebuiltNetwork.setCenter(canvasSize.value.width / 2, canvasSize.value.height / 2)

    console.log(`[BrainView] Brain boundary set for ${props.beltLevel} belt`)

    // Initial visibility (no hero panning)
    updateVisibility(sliderValue.value)

    console.log(`[BrainView] Network ready: ${prebuiltNetwork.nodes.value.length} nodes pre-calculated`)

  } catch (err) {
    console.error('[BrainView] Error loading data:', err)
    error.value = err instanceof Error ? err.message : 'Failed to load network'
  } finally {
    isLoading.value = false
  }
}

// ============================================================================
// WATCHERS
// ============================================================================

watch(sliderValue, (newVal) => {
  // Only update from slider in standalone mode
  if (!isSessionMode.value) {
    updateVisibility(newVal)
  }
})

// Watch for session mode completedLegoIds changes
// This triggers when a new round is completed during an active session
watch(
  () => completedContent.value?.completedLegoIds.value,
  (newIds) => {
    if (isSessionMode.value && newIds) {
      updateVisibility(newIds.size)
    }
  },
  { deep: false }
)

// ============================================================================
// LIFECYCLE
// ============================================================================

onMounted(() => {
  setupPlatformDetection()
  loadData()
})

onUnmounted(() => {
  cleanupPlatformDetection()
  stopPhrasePractice()
  clearPathAnimation()
})
</script>

<template>
  <div class="brain-view" ref="containerRef">
    <!-- Close button -->
    <button class="close-btn" @click="emit('close')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
    </button>

    <!-- Page title with mounting -->
    <div v-if="languageName" class="brain-title-mount">
      <h1 class="brain-title">
        <span class="brain-title-prefix">Your brain on</span>
        <span class="brain-title-language" :style="{ color: accentColor }">{{ languageName }}</span>
      </h1>
    </div>

    <!-- Tab navigation -->
    <!-- Tab order: Belts → Usage → Brain (brain loads in background while viewing earlier tabs) -->
    <div class="progress-tabs">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'belts' }"
        :style="activeTab === 'belts' ? { color: accentColor, borderColor: accentColor } : {}"
        @click="activeTab = 'belts'"
      >
        Belts
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'usage' }"
        :style="activeTab === 'usage' ? { color: accentColor, borderColor: accentColor } : {}"
        @click="activeTab = 'usage'"
      >
        Usage
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'brain' }"
        :style="activeTab === 'brain' ? { color: accentColor, borderColor: accentColor } : {}"
        @click="activeTab = 'brain'"
      >
        Brain
      </button>
    </div>

    <!-- Action buttons (only on brain tab) -->
    <div v-if="activeTab === 'brain'" class="brain-actions">
      <!-- Download button -->
      <button
        class="action-btn"
        @click="downloadBrainImage"
        :disabled="isDownloading || isLoading"
        title="Copy this image for sharing"
      >
        <svg v-if="!isDownloading" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <div v-else class="download-spinner"></div>
      </button>
    </div>

    <!-- Search bar (only on brain tab) -->
    <div v-if="activeTab === 'brain'" class="search-container" :class="{ focused: isSearchFocused, 'has-results': searchResults.length > 0 }">
      <div class="search-input-wrapper">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          type="text"
          class="search-input"
          v-model="searchQuery"
          placeholder="Search your words..."
          @focus="isSearchFocused = true"
          @blur="handleSearchBlur"
        />
        <button
          v-if="searchQuery"
          class="search-clear"
          @click="searchQuery = ''"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Search results dropdown -->
      <div v-if="isSearchFocused && searchResults.length > 0" class="search-results">
        <button
          v-for="node in searchResults"
          :key="node.id"
          class="search-result-item"
          @mousedown.prevent="selectSearchResult(node)"
        >
          <span class="result-target">{{ node.targetText }}</span>
          <span class="result-known">{{ node.knownText }}</span>
        </button>
      </div>

      <!-- No results message -->
      <div v-else-if="isSearchFocused && searchQuery.length >= 2 && searchResults.length === 0" class="search-no-results">
        No matches found
      </div>
    </div>

    <!-- ============================================ -->
    <!-- BRAIN TAB CONTENT -->
    <!-- ============================================ -->
    <div class="tab-content-wrapper" v-if="activeTab === 'brain'">
      <!-- Loading state -->
      <div v-if="isLoading" class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading neural network...</p>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="error-state">
        <p>{{ error }}</p>
        <button @click="loadData">Retry</button>
      </div>

      <!-- ========================================== -->
      <!-- 3D Brain Visualization (all devices) -->
      <!-- ========================================== -->
      <Brain3DView
        v-else
        ref="brain3DRef"
        :nodes="prebuiltNetwork.nodes.value"
        :edges="prebuiltNetwork.visibleEdges.value"
        :revealed-node-ids="showAllForTesting ? null : prebuiltNetwork.revealedNodeIds.value"
        :current-path="prebuiltNetwork.currentPath.value"
        :selected-node-id="selectedNode?.id || null"
        :belt-level="beltLevel"
        @node-tap="handleNodeTap"
      />

      <!-- CanvasNetworkView fallback removed - Brain3DView now handles all devices -->

      <!-- Stage slider panel (admin only) -->
      <div v-if="isAdmin && !isLoading && !error && allRounds.length > 0 && !isPanelOpen" class="stage-slider-panel">
        <div class="stage-header">
          <span class="stage-label">Network Stage</span>
          <span class="stage-count" :style="{ color: accentColor }">
            {{ visibleCount }} / {{ sliderMax }} LEGOs
          </span>
        </div>

        <div class="stage-slider-row">
          <input
            type="range"
            class="stage-slider"
            :min="10"
            :max="sliderMax"
            :step="10"
            v-model.number="sliderValue"
            :style="{ '--accent-color': accentColor }"
          />
        </div>

        <div class="stage-presets">
          <button
            v-for="preset in [50, 100, 200, 400]"
            :key="preset"
            class="preset-btn"
            :class="{ active: sliderValue === preset && !showAllForTesting }"
            :style="sliderValue === preset && !showAllForTesting ? { backgroundColor: accentColor + '30', borderColor: accentColor } : {}"
            @click="sliderValue = Math.min(preset, sliderMax); showAllForTesting = false"
            :disabled="preset > sliderMax"
          >
            {{ preset }}
          </button>
          <button
            class="preset-btn"
            :class="{ active: sliderValue === sliderMax && !showAllForTesting }"
            :style="sliderValue === sliderMax && !showAllForTesting ? { backgroundColor: accentColor + '30', borderColor: accentColor } : {}"
            @click="sliderValue = sliderMax; showAllForTesting = false"
          >
            All
          </button>
        </div>

        <!-- Testing mode toggle -->
        <div class="testing-toggle">
          <button
            class="testing-btn"
            :class="{ active: showAllForTesting }"
            :style="showAllForTesting ? { backgroundColor: accentColor + '30', borderColor: accentColor, color: accentColor } : {}"
            @click="showAllForTesting = !showAllForTesting"
          >
            {{ showAllForTesting ? 'Showing All (Testing)' : 'Show All (Testing)' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ============================================ -->
    <!-- BELTS TAB CONTENT -->
    <!-- ============================================ -->
    <div v-if="activeTab === 'belts'" class="belts-tab-content">
      <div class="belts-list">
        <div
          v-for="(belt, index) in beltsList"
          :key="belt.name"
          class="belt-card"
          :class="{ current: belt.name === beltLevel, completed: index < currentBeltIndex }"
          :style="{ '--belt-color': belt.color }"
        >
          <div class="belt-indicator" :style="{ backgroundColor: belt.color }"></div>
          <div class="belt-info">
            <span class="belt-name">{{ belt.name.charAt(0).toUpperCase() + belt.name.slice(1) }} Belt</span>
            <span class="belt-threshold">{{ belt.seedsRequired }} seeds</span>
          </div>
          <div class="belt-status">
            <span v-if="belt.name === beltLevel" class="status-badge current">Current</span>
            <span v-else-if="index < currentBeltIndex" class="status-badge completed">✓</span>
            <span v-else class="status-badge locked">Locked</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================ -->
    <!-- USAGE TAB CONTENT -->
    <!-- ============================================ -->
    <UsageStats
      v-if="activeTab === 'usage'"
      :totalMinutes="0"
      :totalWordsIntroduced="globalStats.concepts"
      :totalPhrasesSpoken="globalStats.phrases"
      :embedded="true"
      @close="activeTab = 'brain'"
    />

    <!-- Mobile Subtitle Overlay -->
    <div v-if="!isDesktop && showSubtitleOverlay && selectedNode" class="subtitle-overlay">
      <button class="overlay-close" @click="closeSubtitleOverlay">×</button>
      <div class="subtitle-content">
        <div class="subtitle-phrase">
          <span class="target-text">{{ currentPracticingPhrase?.targetText || selectedNode.targetText }}</span>
          <span class="known-text">{{ currentPracticingPhrase ? '' : selectedNode.knownText }}</span>
        </div>
        <div class="subtitle-controls">
          <button
            class="play-btn"
            @click="togglePhrasePractice"
            :disabled="selectedNodePhrases.length === 0"
            :style="{ borderColor: accentColor, color: isPracticingPhrases ? accentColor : 'inherit' }"
          >
            <svg v-if="!isPracticingPhrases" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <rect x="6" y="4" width="4" height="16"/>
              <rect x="14" y="4" width="4" height="16"/>
            </svg>
          </button>
          <div class="speed-buttons">
            <button
              v-for="speed in SPEED_OPTIONS"
              :key="speed"
              class="speed-btn"
              :class="{ active: playbackSpeed === speed }"
              :style="playbackSpeed === speed ? { color: accentColor, borderColor: accentColor } : {}"
              @click="playbackSpeed = speed"
            >
              {{ speed }}x
            </button>
          </div>
          <button class="expand-btn" @click="expandToFullPanel" title="Show all phrases">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <path d="M18 15l-6-6-6 6"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Detail Panel (slides in from right) -->
    <div class="detail-panel" :class="{ open: isPanelOpen }">
      <button class="panel-close" @click="closePanel">×</button>

      <div v-if="selectedNode" class="panel-content">
        <!-- Header -->
        <div class="panel-header">
          <div class="panel-phrase">
            <span class="phrase-target">{{ selectedNode.targetText }}</span>
          </div>
          <span class="phrase-known">{{ selectedNode.knownText }}</span>
          <span class="phrase-usage">Used in {{ selectedNodePhraseCount }} phrases</span>
        </div>

        <!-- Connections: What typically precedes/follows this LEGO -->
        <div v-if="selectedNodeConnections.followsFrom.length > 0 || selectedNodeConnections.leadsTo.length > 0" class="panel-connections">
          <!-- Leads to (what follows) -->
          <div v-if="selectedNodeConnections.leadsTo.length > 0" class="connection-group">
            <span class="connection-label">Often followed by</span>
            <div class="connection-list">
              <span
                v-for="conn in selectedNodeConnections.leadsTo.slice(0, 5)"
                :key="conn.legoId"
                class="connection-chip"
                :title="`${conn.count} times`"
              >
                {{ getLegoText(conn.legoId) }}
                <span class="connection-count">{{ conn.count }}</span>
              </span>
            </div>
          </div>

          <!-- Follows from (what precedes) -->
          <div v-if="selectedNodeConnections.followsFrom.length > 0" class="connection-group">
            <span class="connection-label">Often preceded by</span>
            <div class="connection-list">
              <span
                v-for="conn in selectedNodeConnections.followsFrom.slice(0, 5)"
                :key="conn.legoId"
                class="connection-chip"
                :title="`${conn.count} times`"
              >
                {{ getLegoText(conn.legoId) }}
                <span class="connection-count">{{ conn.count }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Phrases containing this LEGO -->
        <div v-if="selectedNodePhrases.length > 0" class="panel-phrases">
          <div class="phrases-header">
            <span class="phrases-label">Practice phrases</span>
            <div class="phrases-controls">
              <!-- Speed selector -->
              <div class="speed-selector">
                <button
                  v-for="speed in SPEED_OPTIONS"
                  :key="speed"
                  class="speed-btn"
                  :class="{ active: playbackSpeed === speed }"
                  :style="playbackSpeed === speed ? { color: accentColor, borderColor: accentColor } : {}"
                  @click="playbackSpeed = speed"
                >
                  {{ speed }}x
                </button>
              </div>
              <!-- Play/Stop button -->
              <button
                class="practice-btn"
                @click="isPracticingPhrases ? stopPhrasePractice() : startPhrasePractice()"
                :style="{ borderColor: accentColor, color: isPracticingPhrases ? accentColor : 'inherit' }"
              >
                <svg v-if="!isPracticingPhrases" viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <rect x="6" y="4" width="4" height="16"/>
                  <rect x="14" y="4" width="4" height="16"/>
                </svg>
                {{ isPracticingPhrases ? 'Stop' : 'Play All' }}
              </button>
            </div>
          </div>

          <div class="phrases-list">
            <div
              v-for="(phrase, index) in selectedNodePhrases"
              :key="phrase.id"
              class="phrase-item"
              :class="{
                active: currentPracticingPhrase?.id === phrase.id,
                playing: currentPracticingPhrase?.id === phrase.id && isPlayingAudio
              }"
              @click="playSpecificPhrase(phrase)"
            >
              <span class="phrase-text">{{ phrase.targetText }}</span>
              <span class="phrase-legos">{{ phrase.legoPath.length }} LEGOs</span>
            </div>
          </div>
        </div>

        <div v-else class="no-phrases">
          <p>No phrases found for this LEGO</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.brain-view {
  position: fixed;
  inset: 0;
  background: linear-gradient(180deg, #0a0a0f 0%, #0f0f18 50%, #12121a 100%);
  z-index: 200;
  overflow: hidden;
}

.close-btn {
  position: absolute;
  top: calc(16px + env(safe-area-inset-top, 0px));
  left: calc(16px + env(safe-area-inset-left, 0px));
  z-index: 30;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--border-primary);
  background: var(--bg-elevated);
  backdrop-filter: blur(12px);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.close-btn:active {
  transform: scale(0.95);
}

.close-btn svg {
  width: 22px;
  height: 22px;
}

.brain-title-mount {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  background: var(--bg-elevated);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
  border-radius: 24px;
  padding: 10px 24px;
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 var(--border-subtle);
}

.brain-title {
  font-size: 1.375rem;
  font-weight: 600;
  text-align: center;
  margin: 0;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.brain-title-prefix {
  color: var(--text-primary);
}

.brain-title-language {
  text-shadow: 0 0 20px currentColor;
}

/* Tab Navigation */
.progress-tabs {
  position: absolute;
  top: calc(72px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  gap: 4px;
  background: var(--bg-elevated);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 4px;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: transparent;
  border: 2px solid transparent;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn svg {
  width: 16px;
  height: 16px;
}

.tab-btn:hover:not(.active) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.tab-btn.active {
  background: var(--bg-active);
  border-color: currentColor;
}

/* Tab content wrapper - clears the fixed header and tabs, accounts for bottom nav */
.tab-content-wrapper {
  position: absolute;
  top: calc(130px + env(safe-area-inset-top, 0px));
  left: 0;
  right: 0;
  /* Account for bottom nav (68px) + safe area to center brain in available viewport */
  bottom: calc(68px + env(safe-area-inset-bottom, 0px));
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Override BrainStatsMobile styles when embedded */
.tab-content-wrapper :deep(.brain-stats-mobile) {
  min-height: auto;
  height: 100%;
}

.tab-content-wrapper :deep(.brain-stats-mobile .header) {
  display: none;
}

.tab-content-wrapper :deep(.brain-stats-mobile .bg-gradient),
.tab-content-wrapper :deep(.brain-stats-mobile .bg-noise) {
  display: none;
}

/* Belts Tab Content */
.belts-tab-content {
  position: absolute;
  top: calc(120px + env(safe-area-inset-top, 0px));
  left: 16px;
  right: 16px;
  bottom: calc(100px + env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  padding: 16px 0;
}

.belts-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 400px;
  margin: 0 auto;
}

.belt-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--bg-elevated);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.belt-card.current {
  border-color: var(--belt-color);
  box-shadow: 0 0 20px color-mix(in srgb, var(--belt-color) 30%, transparent);
}

.belt-card.completed {
  opacity: 0.7;
}

.belt-indicator {
  width: 48px;
  height: 12px;
  border-radius: 6px;
  flex-shrink: 0;
}

.belt-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.belt-name {
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 600;
}

.belt-threshold {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.belt-status {
  flex-shrink: 0;
}

.status-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-badge.current {
  background: var(--bg-active);
  color: var(--text-primary);
}

.status-badge.completed {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.status-badge.locked {
  background: var(--bg-subtle);
  color: var(--text-muted);
}

/* Action buttons container (fit all, download) */
.brain-actions {
  position: absolute;
  top: calc(110px + env(safe-area-inset-top, 0px));
  right: 16px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border-primary);
  background: var(--bg-elevated);
  backdrop-filter: blur(10px);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn svg {
  width: 20px;
  height: 20px;
}

.download-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-primary);
  border-top-color: var(--text-secondary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Search bar */
.search-container {
  position: absolute;
  top: calc(110px + env(safe-area-inset-top, 0px));
  left: 16px;
  z-index: 25;
  width: 220px;
  pointer-events: none; /* Allow clicks to pass through to content below */
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  background: var(--bg-elevated);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-primary);
  border-radius: 20px;
  padding: 8px 12px;
  transition: all 0.2s ease;
  pointer-events: auto; /* Re-enable clicks on the actual search input */
}

.search-container.focused .search-input-wrapper {
  border-color: var(--border-secondary);
  background: var(--bg-elevated);
}

.search-icon {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.875rem;
  padding: 0 8px;
  min-width: 0;
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-clear {
  width: 20px;
  height: 20px;
  padding: 0;
  background: var(--bg-hover);
  border: none;
  border-radius: 50%;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.search-clear svg {
  width: 12px;
  height: 12px;
}

.search-clear:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--bg-elevated);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  overflow: hidden;
  max-height: 300px;
  overflow-y: auto;
  z-index: 100;
  pointer-events: auto;
}

.search-result-item {
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: background 0.15s ease;
}

.search-result-item:last-child {
  border-bottom: none;
}

.search-result-item:hover {
  background: var(--bg-hover);
}

.result-target {
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
}

.result-known {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.search-no-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  padding: 12px;
  background: var(--bg-elevated);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  color: var(--text-muted);
  font-size: 0.8125rem;
  text-align: center;
}

.stats-badge {
  position: absolute;
  top: calc(160px + env(safe-area-inset-top, 0px));
  right: 16px;
  z-index: 20;
  padding: 8px 16px;
  background: var(--bg-elevated);
  backdrop-filter: blur(10px);
  border: 1px solid;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.stats-badge .stat-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.stats-badge .stat-value {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
}

.stats-badge .stat-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.stats-badge .stat-divider {
  color: var(--text-muted);
}

.loading-state,
.error-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  gap: 1rem;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-primary);
  border-top-color: var(--text-secondary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state button {
  padding: 8px 16px;
  background: var(--bg-hover);
  border: 1px solid var(--border-secondary);
  border-radius: 8px;
  color: var(--text-primary);
  cursor: pointer;
}

/* Stage Slider Panel - positioned above bottom nav (nav is ~90px with play button, plus gap) */
.stage-slider-panel {
  position: absolute;
  bottom: calc(140px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  background: var(--bg-elevated);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border-primary);
  border-radius: 16px;
  padding: 16px 24px;
  min-width: 300px;
}

.stage-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.stage-label {
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stage-count {
  font-size: 0.875rem;
  font-weight: 600;
}

.stage-slider-row {
  margin-bottom: 12px;
}

.stage-slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--bg-hover);
  border-radius: 3px;
  cursor: pointer;
}

.stage-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: var(--accent-color, #fbbf24);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 10px var(--accent-color, #fbbf24);
}

.stage-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: var(--accent-color, #fbbf24);
  border-radius: 50%;
  cursor: pointer;
  border: none;
  box-shadow: 0 0 10px var(--accent-color, #fbbf24);
}

.stage-presets {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.preset-btn {
  padding: 6px 12px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-primary);
  border-radius: 20px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.preset-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.preset-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.preset-btn.active {
  color: var(--text-primary);
  font-weight: 600;
}

/* Testing Mode Toggle */
.testing-toggle {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-primary);
}

.testing-btn {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-subtle);
  border: 1px dashed var(--border-secondary);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.testing-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.testing-btn.active {
  font-weight: 600;
  border-style: solid;
}

/* Detail Panel */
.detail-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 320px;
  max-width: 90vw;
  background: var(--bg-elevated);
  backdrop-filter: blur(20px);
  border-left: 1px solid var(--border-primary);
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 30;
  overflow-y: auto;
  padding: 20px;
  padding-top: calc(20px + env(safe-area-inset-top, 0px));
  padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  padding-right: calc(20px + env(safe-area-inset-right, 0px));
}

.detail-panel.open {
  transform: translateX(0);
}

.panel-close {
  position: absolute;
  top: calc(16px + env(safe-area-inset-top, 0px));
  right: calc(16px + env(safe-area-inset-right, 0px));
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border-primary);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 1.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}

.panel-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.panel-close:active {
  transform: scale(0.95);
}

.panel-content {
  margin-top: calc(40px + env(safe-area-inset-top, 0px));
}

.panel-header {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-primary);
}

.panel-phrase {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.phrase-target {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.phrase-known {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.phrase-usage {
  display: block;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-primary);
  color: var(--text-muted);
  font-size: 0.75rem;
}

/* Connection data */
.panel-connections {
  margin-top: 16px;
  padding: 12px;
  background: var(--bg-subtle);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.connection-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.connection-label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.connection-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.connection-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--bg-hover);
  border-radius: 12px;
  font-size: 0.8125rem;
  color: var(--text-primary);
  cursor: default;
  transition: background 0.2s ease;
}

.connection-chip:hover {
  background: var(--bg-active);
}

.connection-count {
  font-size: 0.6875rem;
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 1px 5px;
  border-radius: 6px;
}

.panel-phrases {
  margin-top: 16px;
}

.phrases-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.phrases-label {
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.phrases-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.speed-selector {
  display: flex;
  gap: 2px;
}

.speed-btn {
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 0.65rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.speed-btn:hover {
  background: var(--bg-subtle);
  color: var(--text-primary);
}

.speed-btn.active {
  background: var(--bg-hover);
  border-color: currentColor;
}

.practice-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-secondary);
  border-radius: 20px;
  color: var(--text-primary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.practice-btn:hover {
  background: var(--bg-hover);
}

.practice-btn svg {
  width: 12px;
  height: 12px;
}

.phrases-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.phrase-item {
  padding: 12px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.phrase-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-primary);
}

.phrase-item.active {
  background: var(--bg-hover);
  border-color: var(--border-secondary);
}

.phrase-item.playing {
  border-color: #fbbf24;
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.2);
}

.phrase-text {
  display: block;
  color: var(--text-primary);
  font-size: 0.9rem;
  margin-bottom: 4px;
}

.phrase-legos {
  display: block;
  color: var(--text-muted);
  font-size: 0.7rem;
}

.no-phrases {
  text-align: center;
  color: var(--text-muted);
  padding: 24px;
}

/* Mobile adjustments */
@media (max-width: 768px) {
  /* Hide search on mobile - no side modal to show phrases */
  .search-container {
    display: none;
  }
}

@media (max-width: 480px) {
  .stage-slider-panel {
    min-width: unset;
    width: calc(100% - 32px);
    max-width: 320px;
    padding: 12px 16px;
  }

  .preset-btn {
    padding: 4px 10px;
    font-size: 0.7rem;
  }

  .detail-panel {
    width: 100%;
    max-width: 100%;
  }
}

/* Mobile Subtitle Overlay */
.subtitle-overlay {
  position: fixed;
  /* Position above bottom nav (68px) + safe area + breathing room */
  bottom: calc(68px + env(safe-area-inset-bottom, 0px) + 12px);
  left: 16px;
  right: 16px;
  z-index: 30;
  background: rgba(5, 5, 8, 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-primary);
  border-radius: 16px;
  padding: 16px;
  box-shadow:
    0 -4px 20px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 var(--border-subtle);
}

.overlay-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border-secondary);
  background: rgba(40, 40, 50, 0.9);
  color: var(--text-primary);
  font-size: 1.5rem;
  font-weight: 300;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  -webkit-tap-highlight-color: transparent;
}

.overlay-close:active {
  transform: scale(0.95);
}

.subtitle-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.subtitle-phrase {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 32px; /* Space for close button */
}

.subtitle-phrase .target-text {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.subtitle-phrase .known-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.subtitle-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.subtitle-controls .play-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 2px solid var(--border-secondary);
  background: var(--bg-elevated);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.subtitle-controls .play-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.subtitle-controls .play-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.subtitle-controls .play-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.speed-buttons {
  display: flex;
  gap: 4px;
  flex: 1;
}

.speed-buttons .speed-btn {
  flex: 1;
  padding: 8px 4px;
  background: transparent;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.speed-buttons .speed-btn:active {
  transform: scale(0.95);
}

.speed-buttons .speed-btn.active {
  background: var(--bg-hover);
  border-color: currentColor;
  color: var(--text-primary);
}

.subtitle-controls .expand-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--border-primary);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.subtitle-controls .expand-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.subtitle-controls .expand-btn:active {
  transform: scale(0.95);
}
</style>
