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

import { ref, computed, inject, onMounted, onUnmounted, watch } from 'vue'
import ConstellationNetworkView from './ConstellationNetworkView.vue'
import { usePrebuiltNetwork, type ExternalConnection, type ConstellationNode } from '../composables/usePrebuiltNetwork'
import { useLegoNetwork, type PhraseWithPath } from '../composables/useLegoNetwork'
import { generateLearningScript } from '../providers/CourseDataProvider'
import { getLanguageName } from '../composables/useI18n'
import { BELTS } from '../composables/useBeltProgress'

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
  completedSeeds: {
    type: Number,
    default: 0
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

// Slider state - defaults to learner's progress (completedSeeds approximates LEGOs encountered)
const sliderValue = ref(props.completedSeeds || 100)
const sliderMax = computed(() => allRounds.value.length || 100)

// Admin/Testing mode - show all nodes regardless of progress
const showAllForTesting = ref(false)

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

// Search state
const searchQuery = ref('')
const isSearchFocused = ref(false)

// Tab state: 'brain' | 'belts' | 'usage'
const activeTab = ref<'brain' | 'belts' | 'usage'>('brain')

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
const visibleCount = computed(() => {
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
    if (props.completedSeeds >= BELTS[i].seedsRequired) {
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
 * Update network visibility when slider changes
 * NOTE: No hero panning - stays centered on network core
 */
function updateVisibility(count: number) {
  if (!allRounds.value.length) return

  // Build new Set first, then assign to trigger Vue reactivity
  // (Set mutations like .add() don't trigger reactive updates)
  const newSet = new Set<string>()
  for (let i = 0; i < count && i < allRounds.value.length; i++) {
    const legoId = allRounds.value[i]?.legoId
    if (legoId) {
      newSet.add(legoId)
    }
  }
  prebuiltNetwork.revealedNodeIds.value = newSet  // Triggers reactivity

  // NO hero panning - keep centered on network core
  // Clear hero to keep view centered
  prebuiltNetwork.heroNodeId.value = null
  prebuiltNetwork.panOffset.value = { x: 0, y: 0 }
}

/**
 * Handle node tap from ConstellationNetworkView
 */
async function handleNodeTap(node: ConstellationNode) {
  selectedNode.value = node
  isPanelOpen.value = true
  currentPhraseIndex.value = 0
  isPracticingPhrases.value = false
  currentPracticingPhrase.value = null

  // Clear previous phrases while loading new ones
  selectedNodePhrases.value = []

  // Load connection data (what precedes/follows this LEGO)
  selectedNodeConnections.value = getLegoConnections(node.id)

  // Load phrases on-demand (async database query)
  console.log('[BrainView] Loading phrases for:', node.targetText)
  selectedNodePhrases.value = await getEternalPhrasesForLego(node.id, node.targetText)
  console.log('[BrainView] Found', selectedNodePhrases.value.length, 'phrases')
}

/**
 * Handle selecting a search result
 */
function selectSearchResult(node: ConstellationNode) {
  // Clear search
  searchQuery.value = ''
  isSearchFocused.value = false

  // Select the node (same as tapping it)
  handleNodeTap(node)
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
 * Clear path animation timers
 */
function clearPathAnimation() {
  pathAnimationTimers.forEach(t => clearTimeout(t))
  pathAnimationTimers = []
}

/**
 * Animate the fire path - stepping through nodes synchronized with audio
 */
function animateFirePath(legoIds: string[], audioDurationMs: number) {
  clearPathAnimation()

  if (!legoIds || legoIds.length === 0) return

  // Set up the path (starts with activeIndex -1)
  prebuiltNetwork.setHighlightPath(legoIds)

  // Calculate step duration - spread nodes across audio
  const stepDuration = Math.max(150, audioDurationMs / legoIds.length)

  // Animate through each node
  for (let i = 0; i < legoIds.length; i++) {
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
      const edgeOpacity = bothRevealed
        ? 0.2 + Math.sqrt(edge.strength) * 0.04
        : 0.02  // Ghost edges for unlearned parts
      ctx.strokeStyle = `rgba(255, 255, 255, ${edgeOpacity})`
      ctx.lineWidth = bothRevealed ? 1 + Math.sqrt(edge.strength) * 0.3 : 0.5
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

    // Load connections AND phrases from database
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

    // Load learning script (all rounds up to reasonable max)
    const MAX_ROUNDS = 1000
    const { rounds } = await generateLearningScript(
      courseDataProvider.value,
      MAX_ROUNDS,
      0
    )

    allRounds.value = rounds
    console.log(`[BrainView] Loaded ${rounds.length} rounds from script`)

    // Update canvas size based on container
    if (containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect()
      canvasSize.value = {
        width: Math.max(800, rect.width),
        height: Math.max(800, rect.height)
      }
    }

    // Pre-calculate all positions with brain boundary based on belt level
    // The network will be constrained within a "growing brain" shape
    prebuiltNetwork.loadFromRounds(rounds, canvasSize.value, connections, 0, props.beltLevel)

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
  updateVisibility(newVal)
})

// ============================================================================
// LIFECYCLE
// ============================================================================

onMounted(() => {
  loadData()
})

onUnmounted(() => {
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
      <h1 class="brain-title" :style="{ color: accentColor }">Your brain on {{ languageName }}</h1>
    </div>

    <!-- Tab navigation -->
    <div class="progress-tabs">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'brain' }"
        :style="activeTab === 'brain' ? { color: accentColor, borderColor: accentColor } : {}"
        @click="activeTab = 'brain'"
      >
        Brain
      </button>
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
          placeholder="Search words..."
          @focus="isSearchFocused = true"
          @blur="setTimeout(() => isSearchFocused = false, 200)"
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
    <template v-if="activeTab === 'brain'">
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

    <!-- Network visualization - fixed view, only revealed nodes shown -->
    <!-- Network is constrained within a "growing brain" shape based on belt level -->
    <ConstellationNetworkView
      v-else
      ref="networkRef"
      :nodes="prebuiltNetwork.nodes.value"
      :edges="prebuiltNetwork.visibleEdges.value"
      :hero-node-id="null"
      :revealed-node-ids="showAllForTesting ? null : prebuiltNetwork.revealedNodeIds.value"
      :current-path="prebuiltNetwork.currentPath.value"
      :pan-transform="'translate(0px, 0px)'"
      :show-path-labels="true"
      :brain-boundary-svg-path="prebuiltNetwork.brainBoundarySvgPath.value"
      :brain-boundary-color="accentColor"
      :disable-interaction="true"
      :hide-unrevealed-nodes="!showAllForTesting"
      @node-tap="handleNodeTap"
    />

    <!-- Stage slider panel -->
    <div v-if="!isLoading && !error && allRounds.length > 0 && !isPanelOpen" class="stage-slider-panel">
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
    </template>

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
    <div v-if="activeTab === 'usage'" class="usage-tab-content">
      <div class="usage-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="placeholder-icon">
          <path d="M3 3v18h18"/>
          <path d="M7 16l4-4 4 4 5-6"/>
        </svg>
        <h3>Usage Statistics</h3>
        <p>Track your learning patterns over time</p>
        <p class="coming-soon">Coming soon</p>
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
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(10, 10, 15, 0.9);
  backdrop-filter: blur(12px);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
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
  background: rgba(10, 10, 15, 0.85);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  padding: 10px 24px;
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.brain-title {
  font-size: 1.375rem;
  font-weight: 600;
  text-align: center;
  margin: 0;
  letter-spacing: 0.02em;
  white-space: nowrap;
  text-shadow: 0 0 20px currentColor;
}

/* Tab Navigation */
.progress-tabs {
  position: absolute;
  top: calc(60px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  gap: 4px;
  background: rgba(10, 10, 15, 0.85);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
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
  color: rgba(255, 255, 255, 0.5);
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
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.05);
}

.tab-btn.active {
  background: rgba(255, 255, 255, 0.08);
  border-color: currentColor;
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
  background: rgba(10, 10, 15, 0.8);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
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
  color: rgba(255, 255, 255, 0.9);
  font-size: 1rem;
  font-weight: 600;
}

.belt-threshold {
  color: rgba(255, 255, 255, 0.4);
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
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.9);
}

.status-badge.completed {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.status-badge.locked {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.3);
}

/* Usage Tab Content */
.usage-tab-content {
  position: absolute;
  top: calc(120px + env(safe-area-inset-top, 0px));
  left: 16px;
  right: 16px;
  bottom: calc(100px + env(safe-area-inset-bottom, 0px));
  display: flex;
  align-items: center;
  justify-content: center;
}

.usage-placeholder {
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
}

.placeholder-icon {
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
  opacity: 0.3;
}

.usage-placeholder h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  margin: 0 0 8px 0;
}

.usage-placeholder p {
  font-size: 0.875rem;
  margin: 0 0 4px 0;
}

.usage-placeholder .coming-soon {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-top: 16px;
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
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(10, 10, 15, 0.8);
  backdrop-filter: blur(10px);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: white;
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
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: rgba(255, 255, 255, 0.7);
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
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  background: rgba(10, 10, 15, 0.9);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 8px 12px;
  transition: all 0.2s ease;
}

.search-container.focused .search-input-wrapper {
  border-color: rgba(255, 255, 255, 0.25);
  background: rgba(10, 10, 15, 0.95);
}

.search-icon {
  width: 16px;
  height: 16px;
  color: rgba(255, 255, 255, 0.4);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.875rem;
  padding: 0 8px;
  min-width: 0;
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.search-clear {
  width: 20px;
  height: 20px;
  padding: 0;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.6);
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
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: rgba(10, 10, 15, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  overflow: hidden;
  max-height: 300px;
  overflow-y: auto;
}

.search-result-item {
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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
  background: rgba(255, 255, 255, 0.08);
}

.result-target {
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.875rem;
  font-weight: 500;
}

.result-known {
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.75rem;
}

.search-no-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  padding: 12px;
  background: rgba(10, 10, 15, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.8125rem;
  text-align: center;
}

.stats-badge {
  position: absolute;
  top: calc(160px + env(safe-area-inset-top, 0px));
  right: 16px;
  z-index: 20;
  padding: 8px 16px;
  background: rgba(10, 10, 15, 0.9);
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
  color: rgba(255, 255, 255, 0.95);
}

.stats-badge .stat-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.stats-badge .stat-divider {
  color: rgba(255, 255, 255, 0.3);
}

.loading-state,
.error-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  gap: 1rem;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: rgba(255, 255, 255, 0.5);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state button {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  cursor: pointer;
}

/* Stage Slider Panel - positioned above bottom nav (nav is ~90px with play button, plus gap) */
.stage-slider-panel {
  position: absolute;
  bottom: calc(140px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  background: rgba(10, 10, 15, 0.9);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
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
  color: rgba(255, 255, 255, 0.6);
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
  background: rgba(255, 255, 255, 0.1);
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
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.preset-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.preset-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.preset-btn.active {
  color: white;
  font-weight: 600;
}

/* Testing Mode Toggle */
.testing-toggle {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.testing-btn {
  width: 100%;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.testing-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
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
  background: rgba(10, 10, 15, 0.95);
  backdrop-filter: blur(20px);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
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
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(10, 10, 15, 0.9);
  color: rgba(255, 255, 255, 0.8);
  font-size: 1.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}

.panel-close:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
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
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
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
  color: white;
}

.phrase-known {
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.875rem;
}

.phrase-usage {
  display: block;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.75rem;
}

/* Connection data */
.panel-connections {
  margin-top: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
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
  color: rgba(255, 255, 255, 0.4);
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
  background: rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.85);
  cursor: default;
  transition: background 0.2s ease;
}

.connection-chip:hover {
  background: rgba(255, 255, 255, 0.12);
}

.connection-count {
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.1);
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
  color: rgba(255, 255, 255, 0.6);
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
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.65rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.speed-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
}

.speed-btn.active {
  background: rgba(255, 255, 255, 0.1);
  border-color: currentColor;
}

.practice-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.practice-btn:hover {
  background: rgba(255, 255, 255, 0.1);
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
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.phrase-item:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.15);
}

.phrase-item.active {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.phrase-item.playing {
  border-color: #fbbf24;
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.2);
}

.phrase-text {
  display: block;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.9rem;
  margin-bottom: 4px;
}

.phrase-legos {
  display: block;
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.7rem;
}

.no-phrases {
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
  padding: 24px;
}

/* Mobile adjustments */
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
</style>
