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

// ============================================================================
// AUDIO CONTROLLER (target language only)
// ============================================================================

class TargetAudioController {
  private audio: HTMLAudioElement | null = null

  async play(url: string): Promise<void> {
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

// Slider state
const sliderValue = ref(100)
const sliderMax = computed(() => allRounds.value.length || 100)

// Container ref for sizing
const containerRef = ref<HTMLElement | null>(null)
const canvasSize = ref({ width: 800, height: 800 })

// Node selection state
const selectedNode = ref<ConstellationNode | null>(null)
const isPanelOpen = ref(false)

// Phrase playback state
const selectedNodePhrases = ref<PhraseWithPath[]>([])
const isPlayingAudio = ref(false)
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

// Search state
const searchQuery = ref('')
const isSearchFocused = ref(false)

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

// Nodes to show based on slider
const visibleCount = computed(() => Math.min(sliderValue.value, allRounds.value.length))

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

  // Reveal nodes up to the slider value
  prebuiltNetwork.revealedNodeIds.value = new Set()
  for (let i = 0; i < count && i < allRounds.value.length; i++) {
    const legoId = allRounds.value[i]?.legoId
    if (legoId) {
      prebuiltNetwork.revealedNodeIds.value.add(legoId)
    }
  }

  // NO hero panning - keep centered on network core
  // Clear hero to keep view centered
  prebuiltNetwork.heroNodeId.value = null
  prebuiltNetwork.panOffset.value = { x: 0, y: 0 }
}

/**
 * Handle node tap from ConstellationNetworkView
 */
function handleNodeTap(node: ConstellationNode) {
  selectedNode.value = node
  isPanelOpen.value = true

  // Load eternal phrases for this LEGO (5 longest by duration)
  selectedNodePhrases.value = getEternalPhrasesForLego(node.id)
  currentPhraseIndex.value = 0
  isPracticingPhrases.value = false
  currentPracticingPhrase.value = null

  // Load connection data (what precedes/follows this LEGO)
  selectedNodeConnections.value = getLegoConnections(node.id)

  console.log('[BrainView] Selected node:', node.id, 'phrases:', selectedNodePhrases.value.length, 'connections:', selectedNodeConnections.value)
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
 */
async function downloadBrainImage() {
  if (!containerRef.value || isDownloading.value) return

  isDownloading.value = true

  try {
    // Find the SVG element within the container
    const svgElement = containerRef.value.querySelector('svg')
    if (!svgElement) {
      console.warn('[BrainView] SVG element not found')
      return
    }

    // Get SVG dimensions
    const svgRect = svgElement.getBoundingClientRect()
    const width = Math.round(svgRect.width)
    const height = Math.round(svgRect.height)

    // Create canvas with extra space for title
    const titleHeight = 60
    const padding = 20
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height + titleHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Dark background
    ctx.fillStyle = '#0a0a0f'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw title in belt color
    ctx.fillStyle = accentColor.value
    ctx.font = '600 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.shadowColor = accentColor.value
    ctx.shadowBlur = 15
    ctx.fillText(`Your brain on ${languageName.value}`, canvas.width / 2, 42)
    ctx.shadowBlur = 0

    // Clone SVG for manipulation
    const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement

    // Ensure SVG has explicit dimensions
    clonedSvg.setAttribute('width', String(width))
    clonedSvg.setAttribute('height', String(height))

    // Inline all computed styles for external rendering
    const allElements = clonedSvg.querySelectorAll('*')
    allElements.forEach((el) => {
      const computedStyle = window.getComputedStyle(el as Element)
      const element = el as SVGElement
      // Copy key styles that affect rendering
      if (computedStyle.fill) element.style.fill = computedStyle.fill
      if (computedStyle.stroke) element.style.stroke = computedStyle.stroke
      if (computedStyle.strokeWidth) element.style.strokeWidth = computedStyle.strokeWidth
      if (computedStyle.opacity) element.style.opacity = computedStyle.opacity
    })

    // Serialize SVG to string
    const serializer = new XMLSerializer()
    const svgString = serializer.serializeToString(clonedSvg)

    // Create blob and image
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    // Load SVG into image
    const img = new Image()
    img.onload = () => {
      // Draw SVG below title
      ctx.drawImage(img, 0, titleHeight)

      // Clean up
      URL.revokeObjectURL(url)

      // Download
      const downloadUrl = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.download = `brain-on-${languageName.value.toLowerCase().replace(/\s+/g, '-')}.png`
      link.href = downloadUrl
      link.click()

      isDownloading.value = false
    }

    img.onerror = () => {
      console.warn('[BrainView] Failed to load SVG as image')
      URL.revokeObjectURL(url)
      isDownloading.value = false
    }

    img.src = url
  } catch (err) {
    console.error('[BrainView] Download failed:', err)
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

        // Play the audio
        await audioController.value.play(audioUrl)
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
  await playPhrase(phrase)

  // Schedule next phrase
  const delay = 2000 + (phrase.legoPath.length * 300)
  phrasePracticeTimer = setTimeout(() => {
    currentPhraseIndex.value++
    playNextPhraseInPractice()
  }, delay)
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

    console.log(`[BrainView] Loaded ${connections.length} connections, ${netData?.phrases?.length || 0} phrases`)

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

    // Pre-calculate all positions
    prebuiltNetwork.loadFromRounds(rounds, canvasSize.value, connections)

    // Set center for panning (centered on network, not hero)
    prebuiltNetwork.setCenter(canvasSize.value.width / 2, canvasSize.value.height / 2)

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
    <button class="close-btn" @click="emit('close')" title="Close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
    </button>

    <!-- Page title with mounting -->
    <div v-if="languageName" class="brain-title-mount">
      <h1 class="brain-title" :style="{ color: accentColor }">Your brain on {{ languageName }}</h1>
    </div>

    <!-- Download button -->
    <button
      class="download-btn"
      @click="downloadBrainImage"
      :disabled="isDownloading || isLoading"
      title="Download to share"
    >
      <svg v-if="!isDownloading" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <div v-else class="download-spinner"></div>
    </button>

    <!-- Stats badge -->
    <div class="stats-badge" :style="{ borderColor: accentColor }">
      <span class="stat-item">
        <span class="stat-value">{{ visibleCount }}</span>
        <span class="stat-label">concepts</span>
      </span>
      <span class="stat-divider">·</span>
      <span class="stat-item">
        <span class="stat-value">{{ globalStats.phrases.toLocaleString() }}</span>
        <span class="stat-label">phrases</span>
      </span>
    </div>

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

    <!-- Network visualization - shows all nodes, unrevealed ones greyed out -->
    <ConstellationNetworkView
      v-else
      :nodes="prebuiltNetwork.nodes.value"
      :edges="prebuiltNetwork.visibleEdges.value"
      :hero-node-id="null"
      :revealed-node-ids="prebuiltNetwork.revealedNodeIds.value"
      :current-path="prebuiltNetwork.currentPath.value"
      :pan-transform="'translate(0px, 0px)'"
      :show-path-labels="true"
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
          :class="{ active: sliderValue === preset }"
          :style="sliderValue === preset ? { backgroundColor: accentColor + '30', borderColor: accentColor } : {}"
          @click="sliderValue = Math.min(preset, sliderMax)"
          :disabled="preset > sliderMax"
        >
          {{ preset }}
        </button>
        <button
          class="preset-btn"
          :class="{ active: sliderValue === sliderMax }"
          :style="sliderValue === sliderMax ? { backgroundColor: accentColor + '30', borderColor: accentColor } : {}"
          @click="sliderValue = sliderMax"
        >
          All
        </button>
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
  left: 16px;
  z-index: 20;
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

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.close-btn svg {
  width: 20px;
  height: 20px;
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

.download-btn {
  position: absolute;
  top: calc(16px + env(safe-area-inset-top, 0px));
  right: 16px;
  z-index: 20;
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

.download-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.download-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.download-btn svg {
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

.stats-badge {
  position: absolute;
  top: calc(64px + env(safe-area-inset-top, 0px));
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
  bottom: calc(110px + env(safe-area-inset-bottom, 0px));
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
  padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
}

.detail-panel.open {
  transform: translateX(0);
}

.panel-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  font-size: 1.25rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.panel-content {
  margin-top: 40px;
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
