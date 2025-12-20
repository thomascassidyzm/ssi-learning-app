<script setup>
import { ref, computed, inject, onMounted, onUnmounted, nextTick } from 'vue'
import { CycleOrchestrator, CyclePhase, DEFAULT_CONFIG } from '@ssi/core'
import { generateLearningScript } from '../providers/CourseDataProvider'

// Simple audio controller for script preview playback
class ScriptAudioController {
  constructor() {
    this.audio = null
    this.endedCallbacks = new Set()
  }

  async play(audioRef) {
    if (!audioRef?.url) {
      console.warn('[ScriptAudioController] No audio URL provided')
      this.notifyEnded()
      return
    }

    if (!this.audio) {
      this.audio = new Audio()
    }

    this.audio.src = audioRef.url
    this.audio.load()

    return new Promise((resolve, reject) => {
      const onEnded = () => {
        this.audio.removeEventListener('ended', onEnded)
        this.audio.removeEventListener('error', onError)
        this.notifyEnded()
        resolve()
      }

      const onError = (e) => {
        console.error('[ScriptAudioController] Playback error:', e)
        this.audio.removeEventListener('ended', onEnded)
        this.audio.removeEventListener('error', onError)
        this.notifyEnded()
        reject(e)
      }

      this.audio.addEventListener('ended', onEnded)
      this.audio.addEventListener('error', onError)

      this.audio.play().catch((e) => {
        console.error('[ScriptAudioController] Play failed:', e)
        onError(e)
      })
    })
  }

  stop() {
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
    }
  }

  preload(audioRef) {
    if (audioRef?.url) {
      const preloadAudio = new Audio()
      preloadAudio.src = audioRef.url
      preloadAudio.preload = 'auto'
    }
  }

  onEnded(callback) {
    this.endedCallbacks.add(callback)
  }

  offEnded(callback) {
    this.endedCallbacks.delete(callback)
  }

  notifyEnded() {
    for (const cb of [...this.endedCallbacks]) {
      cb()
    }
  }
}

const emit = defineEmits(['close'])

const props = defineProps({
  course: {
    type: Object,
    default: null
  }
})

// Inject providers
const courseDataProvider = inject('courseDataProvider', null)
const supabase = inject('supabase', null)

// State
const view = ref('summary') // 'summary' | 'script' | 'journey'
const isLoading = ref(true)
const error = ref(null)

// Course content
const allItems = ref([])
const rounds = ref([])
const scriptItems = ref([])
const totalSeeds = ref(0)
const totalLegos = ref(0)
const totalCycles = ref(0)
const estimatedMinutes = ref(0)

// Playback state
const isPlaying = ref(false)
const currentIndex = ref(-1)
const currentPhase = ref(CyclePhase.PROMPT)
const audioController = ref(null)
const orchestrator = ref(null)

// Scroll container ref
const scriptContainer = ref(null)

// Computed
const courseName = computed(() => props.course?.display_name || props.course?.title || 'Course')
const courseCode = computed(() => props.course?.course_code || '')
const estimatedHours = computed(() => Math.round(estimatedMinutes.value / 60 * 10) / 10)

const currentItem = computed(() => {
  if (currentIndex.value >= 0 && currentIndex.value < allItems.value.length) {
    return allItems.value[currentIndex.value]
  }
  return null
})

// Phase display info
const phaseLabel = computed(() => {
  switch (currentPhase.value) {
    case CyclePhase.PROMPT: return 'LISTEN'
    case CyclePhase.PAUSE: return 'SPEAK'
    case CyclePhase.VOICE_1: return 'VOICE 1'
    case CyclePhase.VOICE_2: return 'VOICE 2'
    default: return ''
  }
})

// Load course content
const loadContent = async () => {
  if (!courseDataProvider?.value) {
    // Demo mode - create sample items
    allItems.value = createDemoItems()
    totalSeeds.value = 10
    totalLegos.value = allItems.value.length
    totalCycles.value = allItems.value.length * 6
    estimatedMinutes.value = 30
    isLoading.value = false
    return
  }

  try {
    isLoading.value = true
    error.value = null

    const courseId = props.course?.course_code || 'demo'
    const audioBaseUrl = 'https://ssi-audio.s3.eu-west-2.amazonaws.com/mastered'

    // Get total seed count first
    const { data: seedData, error: seedError } = await supabase.value
      .from('course_seeds')
      .select('seed_number', { count: 'exact' })
      .eq('course_code', courseId)

    if (seedError) {
      console.warn('[CourseExplorer] Could not get seed count:', seedError)
    }

    totalSeeds.value = seedData?.length || 0

    // Load all unique LEGOs (for the simple script view)
    const items = await courseDataProvider.value.loadAllUniqueLegos(100)
    allItems.value = items
    totalLegos.value = items.length

    // Generate the full learning script with ROUNDs and spaced repetition
    const script = await generateLearningScript(
      courseDataProvider.value,
      supabase.value,
      courseId,
      audioBaseUrl,
      50 // Limit to first 50 LEGOs for preview
    )

    rounds.value = script.rounds
    scriptItems.value = script.allItems
    totalCycles.value = script.allItems.length

    // Estimate duration (avg 11 sec per cycle)
    estimatedMinutes.value = Math.round((script.allItems.length * 11) / 60)

    console.log('[CourseExplorer] Loaded', items.length, 'LEGOs,', script.rounds.length, 'rounds,', script.allItems.length, 'total cycles')
  } catch (err) {
    console.error('[CourseExplorer] Load error:', err)
    error.value = 'Failed to load course content'
  } finally {
    isLoading.value = false
  }
}

// Create demo items for testing
const createDemoItems = () => {
  const demos = [
    { seed: 'S0001', lego: 'L01', known: 'I want', target: 'Quiero' },
    { seed: 'S0001', lego: 'L02', known: 'to speak', target: 'hablar' },
    { seed: 'S0001', lego: 'L03', known: 'Spanish', target: 'español' },
    { seed: 'S0002', lego: 'L01', known: 'with you', target: 'contigo' },
    { seed: 'S0002', lego: 'L02', known: 'now', target: 'ahora' },
    { seed: 'S0003', lego: 'L01', known: 'how to speak', target: 'cómo hablar' },
    { seed: 'S0003', lego: 'L02', known: 'a little', target: 'un poco' },
    { seed: 'S0004', lego: 'L01', known: 'very well', target: 'muy bien' },
    { seed: 'S0005', lego: 'L01', known: 'thank you', target: 'gracias' },
    { seed: 'S0005', lego: 'L02', known: 'please', target: 'por favor' },
  ]

  return demos.map((d, i) => ({
    lego: { id: `${d.seed}${d.lego}`, type: 'A', new: i < 3 },
    phrase: { phrase: { known: d.known, target: d.target } },
    seed: { seed_id: d.seed },
    thread_id: (i % 3) + 1,
    mode: i < 3 ? 'introduction' : 'practice'
  }))
}

// Playback controls
const playFromIndex = async (index) => {
  if (!allItems.value[index]) return

  currentIndex.value = index
  isPlaying.value = true

  // Scroll to current item
  await nextTick()
  scrollToCurrentItem()

  // Initialize audio if needed
  if (!audioController.value) {
    audioController.value = new ScriptAudioController()
  }

  // Create orchestrator if needed
  if (!orchestrator.value) {
    const config = {
      ...DEFAULT_CONFIG.cycle,
      pause_duration_ms: 3000,
      transition_gap_ms: 200,
    }
    orchestrator.value = new CycleOrchestrator(audioController.value, config)
    orchestrator.value.addEventListener(handleCycleEvent)
  }

  // Start playing
  const item = allItems.value[index]
  if (item.audioDurations?.target1) {
    const pauseMs = Math.round(item.audioDurations.target1 * 2 * 1000)
    orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
  }
  orchestrator.value.startItem(item)
}

const stopPlayback = () => {
  isPlaying.value = false
  if (orchestrator.value) {
    orchestrator.value.stop()
  }
}

const handleCycleEvent = (event) => {
  switch (event.type) {
    case 'phase_changed':
      currentPhase.value = event.data.phase
      break

    case 'item_completed':
      // Auto-advance to next item
      if (isPlaying.value && currentIndex.value < allItems.value.length - 1) {
        const nextIdx = currentIndex.value + 1
        currentIndex.value = nextIdx
        scrollToCurrentItem()

        setTimeout(() => {
          if (isPlaying.value && orchestrator.value) {
            const nextItem = allItems.value[nextIdx]
            if (nextItem?.audioDurations?.target1) {
              const pauseMs = Math.round(nextItem.audioDurations.target1 * 2 * 1000)
              orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
            }
            orchestrator.value.startItem(nextItem)
          }
        }, 300)
      } else {
        stopPlayback()
      }
      break

    case 'cycle_stopped':
      isPlaying.value = false
      break
  }
}

const scrollToCurrentItem = () => {
  if (!scriptContainer.value) return
  const currentEl = scriptContainer.value.querySelector('.script-item.current')
  if (currentEl) {
    currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

// Get visual state for item
const getItemState = (index) => {
  if (index === currentIndex.value) return 'current'
  if (index < currentIndex.value) return 'past'
  return 'upcoming'
}

// Lifecycle
onMounted(() => {
  loadContent()
})

onUnmounted(() => {
  if (orchestrator.value) {
    orchestrator.value.stop()
    orchestrator.value.removeEventListener(handleCycleEvent)
  }
  if (audioController.value) {
    audioController.value.stop()
  }
})
</script>

<template>
  <div class="explorer">
    <!-- Ambient background -->
    <div class="bg-layer"></div>
    <div class="scanlines"></div>

    <!-- Header -->
    <header class="header">
      <button class="back-btn" @click="$emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <div class="header-content">
        <h1 class="header-title">{{ courseName }}</h1>
        <span class="header-badge">QA Preview</span>
      </div>
    </header>

    <!-- Stats Bar -->
    <div class="stats-bar">
      <div class="stat">
        <span class="stat-value">{{ totalSeeds }}</span>
        <span class="stat-label">Seeds</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <span class="stat-value">{{ totalLegos }}</span>
        <span class="stat-label">LEGOs</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <span class="stat-value">~{{ estimatedHours }}h</span>
        <span class="stat-label">Duration</span>
      </div>
    </div>

    <!-- Tab Navigation -->
    <nav class="tabs">
      <button
        class="tab"
        :class="{ active: view === 'summary' }"
        @click="view = 'summary'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        Summary
      </button>
      <button
        class="tab"
        :class="{ active: view === 'journey' }"
        @click="view = 'journey'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
        </svg>
        Journey
      </button>
      <button
        class="tab"
        :class="{ active: view === 'script' }"
        @click="view = 'script'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>
        </svg>
        LEGOs
      </button>
    </nav>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading">
      <div class="loading-spinner"></div>
      <p>Loading course content...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-state">
      <p>{{ error }}</p>
      <button @click="loadContent">Retry</button>
    </div>

    <!-- Summary View -->
    <div v-else-if="view === 'summary'" class="summary-view">
      <div class="summary-card">
        <h2>Course Overview</h2>
        <div class="overview-grid">
          <div class="overview-item">
            <div class="overview-icon seeds"></div>
            <div class="overview-info">
              <span class="overview-value">{{ totalSeeds }}</span>
              <span class="overview-label">Total Seeds</span>
            </div>
          </div>
          <div class="overview-item">
            <div class="overview-icon legos"></div>
            <div class="overview-info">
              <span class="overview-value">{{ totalLegos }}</span>
              <span class="overview-label">Total LEGOs</span>
            </div>
          </div>
          <div class="overview-item">
            <div class="overview-icon time"></div>
            <div class="overview-info">
              <span class="overview-value">~{{ estimatedHours }}h</span>
              <span class="overview-label">Est. Duration</span>
            </div>
          </div>
          <div class="overview-item">
            <div class="overview-icon cycles"></div>
            <div class="overview-info">
              <span class="overview-value">{{ totalCycles }}</span>
              <span class="overview-label">Total Cycles</span>
            </div>
          </div>
        </div>
      </div>

      <div class="summary-card">
        <h2>Learning Journey</h2>
        <p class="preview-hint">View the exact sequence of ROUNDs with spaced repetition interleaving.</p>
        <button class="view-script-btn" @click="view = 'journey'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          View Learning Journey
        </button>
      </div>
    </div>

    <!-- Journey View - Shows ROUNDs with spaced rep -->
    <div v-else-if="view === 'journey'" class="journey-view" ref="scriptContainer">
      <div class="journey-content">
        <div
          v-for="round in rounds"
          :key="round.roundNumber"
          class="round-card"
        >
          <!-- Round Header -->
          <div class="round-header">
            <div class="round-number">ROUND {{ round.roundNumber }}</div>
            <div class="round-lego">
              <span class="round-lego-id">{{ round.legoId }}</span>
              <span class="round-seed">{{ round.seedId }}</span>
            </div>
          </div>

          <!-- Round Items -->
          <div class="round-items">
            <div
              v-for="(item, idx) in round.items"
              :key="`${round.roundNumber}-${idx}`"
              class="round-item"
              :class="item.type"
            >
              <div class="item-type-badge" :class="item.type">
                <template v-if="item.type === 'intro'">INTRO</template>
                <template v-else-if="item.type === 'debut'">DEBUT</template>
                <template v-else-if="item.type === 'debut_phrase'">PHRASE</template>
                <template v-else-if="item.type === 'spaced_rep'">REP #{{ item.reviewOf }}</template>
                <template v-else-if="item.type === 'consolidation'">ETERNAL</template>
              </div>
              <div class="item-text-content">
                <span class="item-known">{{ item.knownText }}</span>
                <span class="item-arrow">→</span>
                <span class="item-target">{{ item.targetText }}</span>
              </div>
              <div v-if="item.type === 'spaced_rep'" class="fib-badge">
                fib[{{ item.fibonacciPosition }}]
              </div>
            </div>
          </div>

          <!-- Spaced Rep Summary -->
          <div v-if="round.spacedRepReviews.length > 0" class="spaced-rep-summary">
            Reviews LEGOs: {{ round.spacedRepReviews.join(', ') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Script View -->
    <div v-else class="script-view" ref="scriptContainer">
      <!-- Gradient overlays for depth -->
      <div class="script-gradient-top"></div>
      <div class="script-gradient-bottom"></div>

      <!-- Script items -->
      <div class="script-content">
        <div
          v-for="(item, index) in allItems"
          :key="item.lego.id + '-' + index"
          class="script-item"
          :class="[getItemState(index), { playing: isPlaying && index === currentIndex }]"
          @click="playFromIndex(index)"
        >
          <div class="item-marker">
            <span v-if="getItemState(index) === 'past'" class="marker-done">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </span>
            <span v-else-if="getItemState(index) === 'current'" class="marker-current">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </span>
            <span v-else class="marker-index">{{ index + 1 }}</span>
          </div>

          <div class="item-content">
            <div class="item-meta">
              <span class="seed-badge">{{ item.seed.seed_id }}</span>
              <span class="lego-id">{{ item.lego.id }}</span>
            </div>
            <div class="item-text">
              <p class="known-text">{{ item.phrase.phrase.known }}</p>
              <span class="arrow">→</span>
              <p class="target-text">{{ item.phrase.phrase.target }}</p>
            </div>
          </div>

          <div class="item-play">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- Playback Bar (when playing) -->
    <Transition name="slide-up">
      <div v-if="isPlaying" class="playback-bar">
        <div class="playback-phase" :class="currentPhase">
          {{ phaseLabel }}
        </div>
        <div class="playback-info">
          <span class="playback-lego">{{ currentItem?.lego.id }}</span>
          <span class="playback-text">{{ currentItem?.phrase.phrase.target }}</span>
        </div>
        <button class="playback-stop" @click="stopPlayback">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1"/>
          </svg>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=DM+Sans:wght@400;500;600;700&display=swap');

.explorer {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  font-family: 'DM Sans', -apple-system, sans-serif;
  position: relative;
  overflow-x: hidden;
}

/* Ambient background */
.bg-layer {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(212, 168, 83, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse 60% 40% at 80% 100%, rgba(194, 58, 58, 0.05) 0%, transparent 40%),
    var(--bg-primary);
  pointer-events: none;
}

.scanlines {
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.03) 2px,
    rgba(0, 0, 0, 0.03) 4px
  );
  pointer-events: none;
  opacity: 0.5;
}

/* Header */
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: linear-gradient(to bottom, var(--bg-primary) 60%, transparent);
  backdrop-filter: blur(16px);
}

.back-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.back-btn svg {
  width: 20px;
  height: 20px;
}

.header-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.header-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.header-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0.25rem 0.5rem;
  background: var(--gold-glow);
  color: var(--gold);
  border: 1px solid var(--gold);
  border-radius: 4px;
}

/* Stats Bar */
.stats-bar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  padding: 0.75rem 1.5rem;
  background: var(--bg-card);
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
}

.stat-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.stat-label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.stat-divider {
  width: 1px;
  height: 24px;
  background: var(--border-subtle);
}

/* Tabs */
.tabs {
  position: relative;
  z-index: 10;
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
}

.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab:hover {
  background: var(--bg-card);
  color: var(--text-secondary);
}

.tab.active {
  background: var(--bg-elevated);
  border-color: var(--gold);
  color: var(--gold);
}

.tab svg {
  width: 18px;
  height: 18px;
}

/* Loading */
.loading {
  position: relative;
  z-index: 10;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-muted);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--gold);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Error */
.error-state {
  position: relative;
  z-index: 10;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-muted);
}

.error-state button {
  padding: 0.5rem 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: var(--text-primary);
  cursor: pointer;
}

/* Summary View */
.summary-view {
  position: relative;
  z-index: 10;
  flex: 1;
  padding: 1rem 1.5rem;
  overflow-y: auto;
}

.summary-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.summary-card h2 {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 1rem;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.overview-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-elevated);
  border-radius: 12px;
}

.overview-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.overview-icon.seeds { background: linear-gradient(135deg, #22c55e20, #22c55e40); }
.overview-icon.legos { background: linear-gradient(135deg, #3b82f620, #3b82f640); }
.overview-icon.time { background: linear-gradient(135deg, #f59e0b20, #f59e0b40); }
.overview-icon.cycles { background: linear-gradient(135deg, #8b5cf620, #8b5cf640); }

.overview-icon::before {
  font-size: 1.25rem;
}
.overview-icon.seeds::before { content: '🌱'; }
.overview-icon.legos::before { content: '🧱'; }
.overview-icon.time::before { content: '⏱️'; }
.overview-icon.cycles::before { content: '🔄'; }

.overview-info {
  display: flex;
  flex-direction: column;
}

.overview-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.overview-label {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.preview-hint {
  font-size: 0.875rem;
  color: var(--text-muted);
  margin: 0 0 1rem;
  line-height: 1.5;
}

.view-script-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.875rem;
  background: var(--gradient-accent);
  border: none;
  border-radius: 10px;
  font-size: 0.9375rem;
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: var(--glow-accent);
}

.view-script-btn:hover {
  transform: translateY(-1px);
}

.view-script-btn svg {
  width: 18px;
  height: 18px;
}

/* Script View */
.script-view {
  flex: 1;
  position: relative;
  z-index: 10;
  overflow-y: auto;
  scroll-behavior: smooth;
}

.script-gradient-top,
.script-gradient-bottom {
  position: sticky;
  left: 0;
  right: 0;
  height: 60px;
  pointer-events: none;
  z-index: 10;
}

.script-gradient-top {
  top: 0;
  background: linear-gradient(to bottom, var(--bg-primary) 0%, transparent 100%);
}

.script-gradient-bottom {
  bottom: 0;
  background: linear-gradient(to top, var(--bg-primary) 0%, transparent 100%);
}

.script-content {
  padding: 1rem 1rem 120px;
}

.script-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  margin-bottom: 0.5rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.script-item:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
  transform: translateX(4px);
}

.script-item.past {
  opacity: 0.5;
}

.script-item.past .known-text,
.script-item.past .target-text {
  text-decoration: line-through;
  text-decoration-color: var(--text-muted);
}

.script-item.current {
  background: linear-gradient(135deg, rgba(212, 168, 83, 0.1), rgba(212, 168, 83, 0.05));
  border-color: var(--gold);
  box-shadow: 0 0 20px rgba(212, 168, 83, 0.15);
  transform: scale(1.02);
}

.script-item.playing {
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 20px rgba(212, 168, 83, 0.15); }
  50% { box-shadow: 0 0 30px rgba(212, 168, 83, 0.3); }
}

/* Item marker */
.item-marker {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.marker-index {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  border-radius: 50%;
}

.marker-done {
  width: 24px;
  height: 24px;
  color: #22c55e;
}

.marker-done svg {
  width: 100%;
  height: 100%;
}

.marker-current {
  width: 28px;
  height: 28px;
  color: var(--gold);
  animation: bounce 1s ease-in-out infinite;
}

.marker-current svg {
  width: 100%;
  height: 100%;
}

@keyframes bounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}

/* Item content */
.item-content {
  flex: 1;
  min-width: 0;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.375rem;
}

.seed-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  font-weight: 600;
  padding: 0.125rem 0.375rem;
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border-radius: 4px;
}

.lego-id {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: var(--text-muted);
}

.new-badge {
  font-size: 0.5625rem;
  font-weight: 700;
  padding: 0.125rem 0.375rem;
  background: var(--accent-glow);
  color: var(--accent);
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.item-text {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.known-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
}

.arrow {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.target-text {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
}

.script-item.current .target-text {
  color: var(--gold);
}

/* Item play button */
.item-play {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  opacity: 0;
  transition: all 0.2s ease;
}

.script-item:hover .item-play {
  opacity: 1;
  color: var(--text-secondary);
}

.script-item.current .item-play {
  opacity: 1;
  color: var(--gold);
}

.item-play svg {
  width: 16px;
  height: 16px;
}

/* Playback Bar */
.playback-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem calc(1rem + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(to top, var(--bg-secondary) 80%, transparent);
  backdrop-filter: blur(24px);
  border-top: 1px solid var(--border-subtle);
}

.playback-phase {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0.375rem 0.625rem;
  border-radius: 6px;
  min-width: 70px;
  text-align: center;
}

.playback-phase.prompt { background: #22c55e20; color: #22c55e; }
.playback-phase.pause { background: #f59e0b20; color: #f59e0b; }
.playback-phase.voice_1 { background: #3b82f620; color: #3b82f6; }
.playback-phase.voice_2 { background: #8b5cf620; color: #8b5cf6; }

.playback-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.playback-lego {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.playback-text {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playback-stop {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  border: none;
  border-radius: 50%;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 16px rgba(194, 58, 58, 0.4);
}

.playback-stop:hover {
  transform: scale(1.05);
}

.playback-stop svg {
  width: 20px;
  height: 20px;
}

/* Transitions */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

/* Journey View */
.journey-view {
  flex: 1;
  position: relative;
  z-index: 10;
  overflow-y: auto;
  scroll-behavior: smooth;
}

.journey-content {
  padding: 1rem 1rem 120px;
}

.round-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1rem;
  margin-bottom: 1rem;
  overflow: hidden;
}

.round-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
}

.round-number {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--gold);
  background: var(--gold-glow);
  padding: 0.25rem 0.75rem;
  border-radius: 6px;
}

.round-lego {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.round-lego-id {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
}

.round-seed {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: var(--text-muted);
  padding: 0.125rem 0.375rem;
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border-radius: 4px;
}

.round-items {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.round-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  background: var(--bg-elevated);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.round-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.item-type-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.5625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  min-width: 50px;
  text-align: center;
  flex-shrink: 0;
}

.item-type-badge.intro {
  background: rgba(139, 92, 246, 0.2);
  color: #a78bfa;
}

.item-type-badge.debut {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.item-type-badge.debut_phrase {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.item-type-badge.spaced_rep {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}

.item-type-badge.consolidation {
  background: rgba(236, 72, 153, 0.2);
  color: #f472b6;
}

.item-text-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  overflow: hidden;
}

.item-known {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-arrow {
  font-size: 0.625rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.item-target {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.round-item.spaced_rep .item-target {
  color: #fbbf24;
}

.fib-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.5rem;
  color: var(--text-muted);
  padding: 0.125rem 0.25rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  flex-shrink: 0;
}

.spaced-rep-summary {
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--border-subtle);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: var(--text-muted);
  text-align: right;
}

/* Responsive */
@media (max-width: 480px) {
  .stats-bar {
    gap: 1rem;
    padding: 0.625rem 1rem;
  }

  .stat-value {
    font-size: 1rem;
  }

  .tabs {
    padding: 0.5rem 1rem;
    gap: 0.25rem;
  }

  .tab {
    padding: 0.625rem 0.5rem;
    font-size: 0.75rem;
  }

  .tab svg {
    width: 14px;
    height: 14px;
  }

  .script-content {
    padding: 0.75rem 0.75rem 120px;
  }

  .script-item {
    padding: 0.75rem;
    gap: 0.5rem;
  }

  .overview-grid {
    grid-template-columns: 1fr;
  }

  .journey-content {
    padding: 0.75rem 0.75rem 120px;
  }

  .round-card {
    padding: 0.75rem;
  }

  .round-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .item-type-badge {
    min-width: 40px;
    font-size: 0.5rem;
  }

  .item-known, .item-target {
    font-size: 0.75rem;
  }
}
</style>
