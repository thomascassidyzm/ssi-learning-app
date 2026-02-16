<script setup>
import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { getSeedFromLegoId } from '../composables/useBeltProgress'

// ============================================================================
// Listening Overlay - Teleprompter style overlay for passive listening
// Lives inside LearningPlayer as an overlay, not a separate screen
// ============================================================================

class ListeningAudioController {
  constructor() {
    this.audio = null
    this.playbackRate = 1
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate
    if (this.audio) {
      this.audio.playbackRate = rate
    }
  }

  async play(url) {
    if (!url) {
      console.warn('[ListeningAudio] No audio URL')
      return
    }

    if (!this.audio) {
      this.audio = new Audio()
    }

    this.audio.src = url
    this.audio.load()

    return new Promise((resolve, reject) => {
      let settled = false
      let safetyTimer = null
      let stallCheck = null

      const cleanup = () => {
        if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null }
        if (stallCheck) { clearInterval(stallCheck); stallCheck = null }
        this.audio.removeEventListener('ended', onEnded)
        this.audio.removeEventListener('error', onError)
      }

      const onEnded = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }

      const onError = (e) => {
        if (settled) return
        settled = true
        cleanup()
        reject(e)
      }

      this.audio.addEventListener('ended', onEnded)
      this.audio.addEventListener('error', onError)

      // Stall detection: resolve if currentTime stops advancing for 3s
      let lastTime = -1
      stallCheck = setInterval(() => {
        if (settled) { cleanup(); return }
        const ct = this.audio?.currentTime || 0
        if (ct > 0 && ct === lastTime && !this.audio?.paused) {
          console.warn('[ListeningAudio] Audio stalled, skipping')
          onEnded()
        }
        lastTime = ct
      }, 1500)

      // Safety timeout: no clip should take more than 15s
      safetyTimer = setTimeout(() => {
        if (!settled) {
          console.warn('[ListeningAudio] Safety timeout, skipping')
          onEnded()
        }
      }, 15000)

      // Set playbackRate right before play() - some browsers reset it after load()
      this.audio.playbackRate = this.playbackRate
      this.audio.play().catch(onError)
    })
  }

  stop() {
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
    }
  }
}

const emit = defineEmits(['close'])

const props = defineProps({
  courseCode: {
    type: String,
    required: true
  },
  beltColor: {
    type: String,
    default: '#d4a853' // Default gold for backwards compatibility
  },
  /**
   * High-water mark LEGO ID (e.g., "S0050L03").
   * Filters phrases to only those the learner has reached.
   * When null, shows all USE phrases (no filtering).
   */
  highestLegoId: {
    type: String,
    default: null
  }
})

// Playback speed options
const SPEED_OPTIONS = [1, 1.2, 1.5, 2]
const playbackSpeed = ref(1)

// Inject providers
const supabase = inject('supabase', null)

// State
const isLoading = ref(true)
const error = ref(null)
const mode = ref('shuffled') // Start shuffled for variety

// Phrase data
const allPhrases = ref([])
const visiblePhrases = ref([])
const currentIndex = ref(-1)
const isPlaying = ref(false)
const audioController = ref(null)

// Pagination
const BATCH_SIZE = 50
const VISIBLE_WINDOW = 9
const PRELOAD_THRESHOLD = 10
const loadedCount = ref(0)
const totalCount = ref(0)
const hasMore = ref(true)
const isLoadingMore = ref(false)

// Audio - use /api/audio proxy for CORS bypass
const audioMap = ref(new Map())

let playbackId = 0

// ============================================================================
// Progress Filtering - Filter phrases by highest achieved LEGO
// ============================================================================

/**
 * Parse the highestLegoId into seed and lego index for filtering
 */
const highestSeed = computed(() => {
  if (!props.highestLegoId) return null
  return getSeedFromLegoId(props.highestLegoId)
})

const highestLegoIndex = computed(() => {
  if (!props.highestLegoId) return null
  const match = props.highestLegoId.match(/L(\d{2})$/)
  return match ? parseInt(match[1], 10) : null
})

/**
 * Available phrases filtered by progress.
 * DB query already filters by seed_number, this does LEGO-level precision
 * within the highest seed.
 */
const availablePhrases = computed(() => {
  if (!props.highestLegoId || highestSeed.value === null) {
    return allPhrases.value // No filtering
  }

  // DB query already filtered seed_number <= highestSeed
  // Just trim LEGOs within the highest seed that haven't been reached
  return allPhrases.value.filter(phrase =>
    phrase.seedNumber < highestSeed.value ||
    (phrase.seedNumber === highestSeed.value && phrase.legoIndex <= highestLegoIndex.value)
  )
})

const progressPercent = computed(() => {
  if (availablePhrases.value.length === 0) return 0
  return Math.round(((currentIndex.value + 1) / availablePhrases.value.length) * 100)
})

// ============================================================================
// Data Loading
// ============================================================================

const loadPhrases = async (offset = 0) => {
  if (!supabase?.value || !props.courseCode) {
    error.value = 'Database not configured'
    isLoading.value = false
    console.warn('[ListeningOverlay] No supabase or courseCode:', { supabase: !!supabase?.value, courseCode: props.courseCode })
    return
  }

  console.log('[ListeningOverlay] Loading phrases for course:', props.courseCode, 'offset:', offset)

  try {
    if (offset === 0) {
      isLoading.value = true
      error.value = null
    } else {
      isLoadingMore.value = true
    }

    // Query course_practice_phrases directly — audio IDs are on the table,
    // no need for the practice_cycles view (which JOINs course_audio and can multiply rows)
    if (offset === 0) {
      let countQuery = supabase.value
        .from('course_practice_phrases')
        .select('*', { count: 'exact', head: true })
        .eq('course_code', props.courseCode)
        .in('phrase_role', ['use', 'eternal_eligible'])

      if (highestSeed.value !== null) {
        countQuery = countQuery.lte('seed_number', highestSeed.value)
      }

      const { count, error: countError } = await countQuery

      if (countError) {
        console.warn('[ListeningOverlay] Count query error:', countError.message)
      }
      totalCount.value = count || 0
      console.log('[ListeningOverlay] USE phrases available:', totalCount.value, highestSeed.value !== null ? `(up to seed ${highestSeed.value})` : '(all)')
    }

    let dataQuery = supabase.value
      .from('course_practice_phrases')
      .select('seed_number, lego_index, known_text, target_text, position, target1_audio_id, target2_audio_id')
      .eq('course_code', props.courseCode)
      .in('phrase_role', ['use', 'eternal_eligible'])

    if (highestSeed.value !== null) {
      dataQuery = dataQuery.lte('seed_number', highestSeed.value)
    }

    const { data, error: fetchError } = await dataQuery
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .order('position', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)

    if (fetchError) throw fetchError

    if (data && data.length > 0) {
      console.log('[ListeningOverlay] Loaded', data.length, 'phrases, first:', data[0])

      const newPhrases = data.map((p, i) => ({
        id: `${p.seed_number}-${p.lego_index}-${p.position || i}`,
        seedNumber: p.seed_number,
        legoIndex: p.lego_index,
        legoId: `S${String(p.seed_number).padStart(4, '0')}L${String(p.lego_index).padStart(2, '0')}`,
        knownText: p.known_text,
        targetText: p.target_text,
        position: p.position,
        target1AudioId: p.target1_audio_id,
        target2AudioId: p.target2_audio_id
      }))

      if (offset === 0) {
        allPhrases.value = newPhrases
      } else {
        allPhrases.value = [...allPhrases.value, ...newPhrases]
      }

      loadedCount.value = allPhrases.value.length
      hasMore.value = data.length >= BATCH_SIZE && loadedCount.value < totalCount.value

      if (mode.value === 'shuffled' && offset === 0) {
        shufflePhrases()
      }

      updateVisibleWindow()
    } else {
      hasMore.value = false
    }
  } catch (err) {
    console.error('[ListeningOverlay] Load error:', err)
    error.value = 'Failed to load phrases'
  } finally {
    isLoading.value = false
    isLoadingMore.value = false
  }
}

const loadMoreIfNeeded = async () => {
  if (!hasMore.value || isLoadingMore.value) return
  const remaining = allPhrases.value.length - currentIndex.value - 1
  if (remaining < PRELOAD_THRESHOLD) {
    await loadPhrases(loadedCount.value)
  }
}

const shufflePhrases = () => {
  const arr = [...allPhrases.value]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  allPhrases.value = arr
}

const updateVisibleWindow = () => {
  const phrases = availablePhrases.value
  const center = Math.max(0, currentIndex.value)
  const halfWindow = Math.floor(VISIBLE_WINDOW / 2)
  const start = Math.max(0, center - halfWindow)
  const end = Math.min(phrases.length, start + VISIBLE_WINDOW)

  visiblePhrases.value = phrases.slice(start, end).map((p, i) => ({
    ...p,
    displayIndex: start + i,
    isCurrent: start + i === currentIndex.value,
    isPast: start + i < currentIndex.value
  }))
}

// ============================================================================
// Audio
// ============================================================================

/**
 * Get audio URL for a phrase using its audio IDs (no lookup needed)
 * Uses /api/audio proxy for CORS bypass
 */
const getAudioUrl = (audioId) => {
  if (!audioId) return null
  return `/api/audio/${audioId}?courseId=${encodeURIComponent(props.courseCode)}`
}


// ============================================================================
// Playback
// ============================================================================

const playFromIndex = async (index) => {
  if (index < 0 || index >= availablePhrases.value.length) return

  const myPlaybackId = ++playbackId
  currentIndex.value = index
  isPlaying.value = true
  updateVisibleWindow()

  await nextTick()
  scrollCurrentIntoView()
  await loadMoreIfNeeded()
  await playCurrentPhrase(myPlaybackId)
}

const playCurrentPhrase = async (myPlaybackId) => {
  if (myPlaybackId !== playbackId || !isPlaying.value) return

  const phrase = availablePhrases.value[currentIndex.value]
  if (!phrase) {
    await handleEndOfList(myPlaybackId)
    return
  }

  // Pick random voice (target1 or target2)
  const useVoice1 = Math.random() < 0.5
  const audioId = useVoice1 ? phrase.target1AudioId : phrase.target2AudioId
  const audioUrl = getAudioUrl(audioId)

  console.log('[ListeningOverlay] Playing phrase:', {
    index: currentIndex.value,
    text: phrase.targetText,
    voice: useVoice1 ? 'target1' : 'target2',
    audioId,
    hasUrl: !!audioUrl
  })

  if (myPlaybackId !== playbackId) return

  if (audioUrl) {
    try {
      console.log('[ListeningOverlay] Playing audio:', audioUrl)
      await audioController.value.play(audioUrl)
    } catch (err) {
      console.error('[ListeningOverlay] Audio play failed:', err)
    }
  } else {
    console.warn('[ListeningOverlay] No audio ID for phrase, skipping:', phrase.targetText)
  }

  if (myPlaybackId !== playbackId) return

  await new Promise(resolve => setTimeout(resolve, 800))

  if (myPlaybackId !== playbackId) return

  await advanceToNext(myPlaybackId)
}

const advanceToNext = async (myPlaybackId) => {
  if (myPlaybackId !== playbackId) return

  const nextIndex = currentIndex.value + 1

  if (nextIndex >= availablePhrases.value.length) {
    if (hasMore.value) {
      await loadMoreIfNeeded()
      if (availablePhrases.value.length > nextIndex) {
        currentIndex.value = nextIndex
        updateVisibleWindow()
        await nextTick()
        scrollCurrentIntoView()
        await playCurrentPhrase(myPlaybackId)
        return
      }
    }
    await handleEndOfList(myPlaybackId)
    return
  }

  currentIndex.value = nextIndex
  updateVisibleWindow()
  await nextTick()
  scrollCurrentIntoView()
  await loadMoreIfNeeded()
  await playCurrentPhrase(myPlaybackId)
}

const handleEndOfList = async (myPlaybackId) => {
  if (myPlaybackId !== playbackId) return

  if (mode.value === 'shuffled') {
    shufflePhrases()
  }

  currentIndex.value = 0
  updateVisibleWindow()
  await nextTick()
  scrollCurrentIntoView()
  await playCurrentPhrase(myPlaybackId)
}

const togglePlayback = () => {
  if (isPlaying.value) {
    stopPlayback()
  } else {
    if (currentIndex.value < 0) {
      playFromIndex(0)
    } else {
      playFromIndex(currentIndex.value)
    }
  }
}

const stopPlayback = () => {
  playbackId++
  isPlaying.value = false
  audioController.value?.stop()
}

const scrollCurrentIntoView = () => {
  const currentEl = document.querySelector('.listening-overlay .phrase-row.current')
  currentEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const handlePhraseClick = (displayIndex) => {
  stopPlayback()
  playFromIndex(displayIndex)
}

const setMode = (newMode) => {
  if (newMode === mode.value) return

  const wasPlaying = isPlaying.value
  stopPlayback()
  mode.value = newMode

  if (newMode === 'shuffled') {
    shufflePhrases()
  } else {
    allPhrases.value.sort((a, b) => {
      if (a.seedNumber !== b.seedNumber) return a.seedNumber - b.seedNumber
      if (a.legoIndex !== b.legoIndex) return a.legoIndex - b.legoIndex
      return (a.position || 0) - (b.position || 0)
    })
  }

  currentIndex.value = 0
  updateVisibleWindow()

  if (wasPlaying) {
    playFromIndex(0)
  }
}

const handleClose = () => {
  stopPlayback()
  emit('close')
}

// Handle tap on overlay background to toggle playback
const handleOverlayTap = (e) => {
  // Only toggle if tapping the background, not controls
  if (e.target.classList.contains('listening-overlay') ||
      e.target.classList.contains('teleprompter') ||
      e.target.classList.contains('phrase-list')) {
    togglePlayback()
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(() => {
  audioController.value = new ListeningAudioController()
  loadPhrases()
})

onUnmounted(() => {
  stopPlayback()
})

// Sync playback speed with audio controller
watch(playbackSpeed, (newSpeed) => {
  if (audioController.value) {
    audioController.value.setPlaybackRate(newSpeed)
  }
})
</script>

<template>
  <div class="listening-overlay" :style="{ '--belt-color': beltColor }" @click="handleOverlayTap">
    <!-- Close button -->
    <button class="close-btn" @click.stop="handleClose">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>

    <!-- Header -->
    <header class="overlay-header">
      <div class="header-content">
        <span class="listening-badge">Listening Mode</span>
        <span class="phrase-count">{{ loadedCount }} / {{ totalCount }}</span>
      </div>
    </header>

    <!-- Mode Toggle -->
    <div class="mode-toggle" @click.stop>
      <button
        class="mode-btn"
        :class="{ active: mode === 'ordered' }"
        @click="setMode('ordered')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="8" y1="6" x2="21" y2="6"/>
          <line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/>
          <line x1="3" y1="6" x2="3.01" y2="6"/>
          <line x1="3" y1="12" x2="3.01" y2="12"/>
          <line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        Ordered
      </button>
      <button
        class="mode-btn"
        :class="{ active: mode === 'shuffled' }"
        @click="setMode('shuffled')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="16 3 21 3 21 8"/>
          <line x1="4" y1="20" x2="21" y2="3"/>
          <polyline points="21 16 21 21 16 21"/>
          <line x1="15" y1="15" x2="21" y2="21"/>
          <line x1="4" y1="4" x2="9" y2="9"/>
        </svg>
        Shuffled
      </button>
    </div>

    <!-- Speed Selector -->
    <div class="speed-controls" @click.stop>
      <span class="speed-label">Speed</span>
      <div class="speed-selector">
        <button
          v-for="speed in SPEED_OPTIONS"
          :key="speed"
          class="speed-btn"
          :class="{ active: playbackSpeed === speed }"
          @click="playbackSpeed = speed"
        >
          {{ speed }}x
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading">
      <div class="loading-spinner"></div>
      <p>Loading phrases...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error" @click.stop>
      <p>{{ error }}</p>
      <button @click="loadPhrases()">Retry</button>
    </div>

    <!-- Teleprompter -->
    <div v-else class="teleprompter">
      <div class="phrase-list">
        <div
          v-for="phrase in visiblePhrases"
          :key="phrase.id"
          class="phrase-row"
          :class="{
            current: phrase.isCurrent,
            past: phrase.isPast,
            future: !phrase.isCurrent && !phrase.isPast
          }"
          @click.stop="handlePhraseClick(phrase.displayIndex)"
        >
          <div class="phrase-target">{{ phrase.targetText }}</div>
        </div>
      </div>

      <!-- Play/Pause indicator -->
      <div class="playback-hint" :class="{ playing: isPlaying }">
        <span v-if="isPlaying">Tap to pause</span>
        <span v-else>Tap to play</span>
      </div>
    </div>

    <!-- Progress Bar -->
    <div class="progress-container" @click.stop>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="progress-text">{{ progressPercent }}%</span>
    </div>
  </div>
</template>

<style scoped>
/* Fonts loaded globally in style.css */

.listening-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: rgba(8, 8, 12, 0.97);
  backdrop-filter: blur(20px);
  font-family: var(--font-body);
  padding: env(safe-area-inset-top, 20px) 0 calc(env(safe-area-inset-bottom, 20px) + 100px) 0;
  cursor: pointer;
}

/* Theme colors - belt color is set dynamically via inline style */
.listening-overlay {
  /* --belt-color is set dynamically from beltColor prop */
  --belt-glow: color-mix(in srgb, var(--belt-color) 15%, transparent);
}

/* Close button */
.close-btn {
  position: absolute;
  top: calc(env(safe-area-inset-top, 20px) + 12px);
  right: 16px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  color: var(--text-secondary, #a0a0a0);
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 10;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--text-primary, #ffffff);
}

.close-btn svg {
  width: 20px;
  height: 20px;
}

/* Header */
.overlay-header {
  padding: 1rem 1.5rem;
  text-align: center;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.listening-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0.375rem 0.75rem;
  background: var(--belt-glow);
  color: var(--belt-color);
  border: 1px solid var(--belt-color);
  border-radius: 4px;
}

.phrase-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-muted, #666);
}

/* Mode Toggle */
.mode-toggle {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1.5rem;
  cursor: default;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  color: var(--text-muted, #666);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary, #a0a0a0);
}

.mode-btn.active {
  background: var(--belt-glow);
  border-color: var(--belt-color);
  color: var(--belt-color);
}

.mode-btn svg {
  width: 16px;
  height: 16px;
}

/* Speed Controls */
.speed-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.25rem 1.5rem 0.5rem;
  cursor: default;
}

.speed-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted, #666);
}

.speed-selector {
  display: flex;
  gap: 2px;
}

.speed-btn {
  padding: 4px 10px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.speed-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
}

.speed-btn.active {
  background: var(--belt-glow);
  border-color: var(--belt-color);
  color: var(--belt-color);
}

/* Loading / Error */
.loading, .error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-muted, #666);
  cursor: default;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--belt-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error button {
  padding: 0.5rem 1rem;
  background: var(--belt-color);
  border: none;
  border-radius: 8px;
  color: #000;
  font-weight: 600;
  cursor: pointer;
}

/* Teleprompter */
.teleprompter {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 1rem;
  overflow-y: auto;
  overflow-x: hidden;
  /* Hide scrollbar for cleaner look */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.teleprompter::-webkit-scrollbar {
  display: none;
}

.phrase-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  max-width: 600px;
  /* Add padding to allow first/last items to scroll to center */
  padding-block: 25vh;
}

.phrase-row {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0.75rem 1.5rem;
  border-radius: 12px;
  cursor: pointer;
  /* Smooth, spring-like transitions for phase changes */
  transition:
    opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.3s ease,
    border-color 0.3s ease,
    box-shadow 0.4s ease;
  text-align: center;
  will-change: transform, opacity;
}

.phrase-row.past {
  opacity: 0.25;
  transform: scale(0.92) translateY(-2px);
}

.phrase-row.future {
  opacity: 0.45;
  transform: scale(0.96);
}

.phrase-row.current {
  opacity: 1;
  transform: scale(1.05);
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--belt-color) 12%, transparent) 0%,
    color-mix(in srgb, var(--belt-color) 6%, transparent) 50%,
    color-mix(in srgb, var(--belt-color) 3%, transparent) 100%);
  border: 1px solid color-mix(in srgb, var(--belt-color) 50%, transparent);
  box-shadow:
    0 0 20px color-mix(in srgb, var(--belt-color) 15%, transparent),
    0 8px 32px rgba(0, 0, 0, 0.3);
}

.phrase-row:hover:not(.current) {
  opacity: 0.8;
  background: rgba(255, 255, 255, 0.03);
}

.phrase-target {
  font-size: 1.0625rem;
  font-weight: 500;
  color: var(--text-primary, #ffffff);
  text-align: center;
  line-height: 1.4;
  transition:
    font-size 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    font-weight 0.2s ease,
    color 0.3s ease,
    text-shadow 0.4s ease;
}

.phrase-row.current .phrase-target {
  font-size: clamp(1.25rem, 3vmin, 1.5rem);
  font-weight: 600;
  color: var(--belt-color);
  text-shadow: 0 0 20px color-mix(in srgb, var(--belt-color) 30%, transparent);
}

/* Playback hint */
.playback-hint {
  margin-top: 2rem;
  font-size: 0.875rem;
  color: var(--text-muted, #666);
  opacity: 0.6;
  transition: opacity 0.3s ease;
}

.playback-hint.playing {
  opacity: 0.4;
}

/* Progress Bar */
.progress-container {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1.5rem;
  cursor: default;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--belt-color);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: var(--text-muted, #666);
  min-width: 36px;
}
</style>
