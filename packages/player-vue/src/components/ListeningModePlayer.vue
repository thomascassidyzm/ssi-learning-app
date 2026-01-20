<script setup>
import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick } from 'vue'

// ============================================================================
// Listening Mode Player - Spotify Lyrics / Teleprompter Style
// Plays eternal_eligible phrases with random voice selection
// ============================================================================

class ListeningAudioController {
  constructor() {
    this.audio = null
    this.endedCallbacks = new Set()
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
      console.warn('[ListeningAudioController] No audio URL provided')
      this.notifyEnded()
      return
    }

    if (!this.audio) {
      this.audio = new Audio()
    }

    this.audio.src = url
    this.audio.load()

    return new Promise((resolve, reject) => {
      const onEnded = () => {
        this.audio.removeEventListener('ended', onEnded)
        this.audio.removeEventListener('error', onError)
        this.notifyEnded()
        resolve()
      }

      const onError = (e) => {
        console.error('[ListeningAudioController] Playback error:', e)
        this.audio.removeEventListener('ended', onEnded)
        this.audio.removeEventListener('error', onError)
        this.notifyEnded()
        reject(e)
      }

      this.audio.addEventListener('ended', onEnded)
      this.audio.addEventListener('error', onError)

      // Set playbackRate right before play() - some browsers reset it after load()
      this.audio.playbackRate = this.playbackRate
      this.audio.play().catch((e) => {
        console.error('[ListeningAudioController] Play failed:', e)
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

const emit = defineEmits(['close', 'playStateChanged'])

const props = defineProps({
  course: {
    type: Object,
    default: null
  },
  beltColor: {
    type: String,
    default: '#d4a853' // Default gold for backwards compatibility
  }
})

// Playback speed options
const SPEED_OPTIONS = [1, 1.2, 1.5, 2] as const
const playbackSpeed = ref(1)

// Inject providers
const supabase = inject('supabase', null)

// State
const isLoading = ref(true)
const error = ref(null)
const mode = ref('ordered') // 'ordered' | 'shuffled'

// Phrase data
const allPhrases = ref([]) // All loaded phrases
const visiblePhrases = ref([]) // Currently visible in teleprompter (rolling window)
const currentIndex = ref(-1) // Current phrase index in allPhrases
const isPlaying = ref(false)
const audioController = ref(null)

// Pagination
const BATCH_SIZE = 50 // Load 50 phrases at a time
const VISIBLE_WINDOW = 11 // Show 11 phrases (5 above, current, 5 below)
const PRELOAD_THRESHOLD = 10 // Load more when < 10 phrases remaining
const loadedCount = ref(0)
const totalCount = ref(0)
const hasMore = ref(true)
const isLoadingMore = ref(false)

// Audio map for caching lookups
const audioMap = ref(new Map())
const audioBaseUrl = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com'

// Playback control
let playbackId = 0

// Computed
const courseCode = computed(() => props.course?.course_code || '')
const courseName = computed(() => props.course?.display_name || props.course?.title || 'Course')

const currentPhrase = computed(() => {
  if (currentIndex.value >= 0 && currentIndex.value < allPhrases.value.length) {
    return allPhrases.value[currentIndex.value]
  }
  return null
})

const progressPercent = computed(() => {
  if (allPhrases.value.length === 0) return 0
  return Math.round(((currentIndex.value + 1) / allPhrases.value.length) * 100)
})

// ============================================================================
// Data Loading
// ============================================================================

const loadPhrases = async (offset = 0) => {
  if (!supabase?.value || !courseCode.value) {
    error.value = 'Database not configured'
    isLoading.value = false
    return
  }

  try {
    if (offset === 0) {
      isLoading.value = true
      error.value = null
    } else {
      isLoadingMore.value = true
    }

    // First, get total count
    if (offset === 0) {
      const { count } = await supabase.value
        .from('course_practice_phrases')
        .select('*', { count: 'exact', head: true })
        .eq('course_code', courseCode.value)
        .eq('phrase_role', 'eternal_eligible')

      totalCount.value = count || 0
      console.log('[ListeningMode] Total eternal phrases:', totalCount.value)
    }

    // Fetch batch of phrases
    const { data, error: fetchError } = await supabase.value
      .from('course_practice_phrases')
      .select('seed_number, lego_index, known_text, target_text, position')
      .eq('course_code', courseCode.value)
      .eq('phrase_role', 'eternal_eligible')
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .order('position', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)

    if (fetchError) throw fetchError

    if (data && data.length > 0) {
      // Add phrases with IDs
      const newPhrases = data.map((p, i) => ({
        id: `${p.seed_number}-${p.lego_index}-${p.position || i}`,
        seedNumber: p.seed_number,
        legoIndex: p.lego_index,
        knownText: p.known_text,
        targetText: p.target_text,
        position: p.position
      }))

      if (offset === 0) {
        allPhrases.value = newPhrases
      } else {
        allPhrases.value = [...allPhrases.value, ...newPhrases]
      }

      loadedCount.value = allPhrases.value.length
      hasMore.value = data.length >= BATCH_SIZE && loadedCount.value < totalCount.value

      console.log('[ListeningMode] Loaded', newPhrases.length, 'phrases, total:', loadedCount.value)

      // If shuffled mode, shuffle what we have
      if (mode.value === 'shuffled' && offset === 0) {
        shufflePhrases()
      }

      updateVisibleWindow()
    } else {
      hasMore.value = false
    }
  } catch (err) {
    console.error('[ListeningMode] Load error:', err)
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
    console.log('[ListeningMode] Preloading more phrases, remaining:', remaining)
    await loadPhrases(loadedCount.value)
  }
}

const shufflePhrases = () => {
  // Fisher-Yates shuffle
  const arr = [...allPhrases.value]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  allPhrases.value = arr
  console.log('[ListeningMode] Shuffled phrases')
}

const updateVisibleWindow = () => {
  const center = Math.max(0, currentIndex.value)
  const halfWindow = Math.floor(VISIBLE_WINDOW / 2)
  const start = Math.max(0, center - halfWindow)
  const end = Math.min(allPhrases.value.length, start + VISIBLE_WINDOW)

  visiblePhrases.value = allPhrases.value.slice(start, end).map((p, i) => ({
    ...p,
    displayIndex: start + i,
    isCurrent: start + i === currentIndex.value,
    isPast: start + i < currentIndex.value
  }))
}

// ============================================================================
// Audio Loading
// ============================================================================

const lookupAudio = async (text, role) => {
  if (!supabase?.value || !courseCode.value) return null

  const cacheKey = `${text}:${role}`
  if (audioMap.value.has(cacheKey)) {
    return audioMap.value.get(cacheKey)
  }

  try {
    const { data, error } = await supabase.value
      .from('course_audio')
      .select('s3_key')
      .eq('course_code', courseCode.value)
      .eq('text_normalized', text.toLowerCase().trim())
      .eq('role', role)
      .maybeSingle()

    if (error || !data?.s3_key) return null

    const url = `${audioBaseUrl}/${data.s3_key}`
    audioMap.value.set(cacheKey, url)
    return url
  } catch (err) {
    console.warn('[ListeningMode] Audio lookup failed:', err)
    return null
  }
}

const getRandomVoice = () => {
  return Math.random() < 0.5 ? 'target1' : 'target2'
}

// ============================================================================
// Playback Controls
// ============================================================================

const playFromIndex = async (index) => {
  if (index < 0 || index >= allPhrases.value.length) return

  const myPlaybackId = ++playbackId
  currentIndex.value = index
  isPlaying.value = true
  updateVisibleWindow()

  // Scroll current phrase into view
  await nextTick()
  scrollCurrentIntoView()

  // Check if we need to load more
  await loadMoreIfNeeded()

  // Start playback loop
  await playCurrentPhrase(myPlaybackId)
}

const playCurrentPhrase = async (myPlaybackId) => {
  if (myPlaybackId !== playbackId || !isPlaying.value) return

  const phrase = allPhrases.value[currentIndex.value]
  if (!phrase) {
    // End of list - loop
    await handleEndOfList(myPlaybackId)
    return
  }

  // Random voice selection
  const voice = getRandomVoice()
  const audioUrl = await lookupAudio(phrase.targetText, voice)

  if (myPlaybackId !== playbackId) return

  if (audioUrl) {
    try {
      await audioController.value.play(audioUrl)
    } catch (err) {
      console.warn('[ListeningMode] Playback error, advancing:', err)
    }
  }

  if (myPlaybackId !== playbackId) return

  // Small gap between phrases
  await new Promise(resolve => setTimeout(resolve, 800))

  if (myPlaybackId !== playbackId) return

  // Advance to next
  await advanceToNext(myPlaybackId)
}

const advanceToNext = async (myPlaybackId) => {
  if (myPlaybackId !== playbackId) return

  const nextIndex = currentIndex.value + 1

  if (nextIndex >= allPhrases.value.length) {
    // Check if more to load
    if (hasMore.value) {
      await loadMoreIfNeeded()
      if (allPhrases.value.length > nextIndex) {
        currentIndex.value = nextIndex
        updateVisibleWindow()
        await nextTick()
        scrollCurrentIntoView()
        await playCurrentPhrase(myPlaybackId)
        return
      }
    }
    // End of list - loop
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

  console.log('[ListeningMode] End of list, looping...')

  // Reset to start
  if (mode.value === 'shuffled') {
    shufflePhrases()
  }

  currentIndex.value = 0
  updateVisibleWindow()
  await nextTick()
  scrollCurrentIntoView()

  // Continue playing
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
  if (audioController.value) {
    audioController.value.stop()
  }
}

const skipNext = () => {
  if (currentIndex.value < allPhrases.value.length - 1) {
    stopPlayback()
    playFromIndex(currentIndex.value + 1)
  }
}

const skipPrev = () => {
  if (currentIndex.value > 0) {
    stopPlayback()
    playFromIndex(currentIndex.value - 1)
  }
}

const scrollCurrentIntoView = () => {
  const currentEl = document.querySelector('.phrase-row.current')
  if (currentEl) {
    currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

// ============================================================================
// Mode Toggle
// ============================================================================

const setMode = (newMode) => {
  if (newMode === mode.value) return

  const wasPlaying = isPlaying.value
  stopPlayback()

  mode.value = newMode

  if (newMode === 'shuffled') {
    shufflePhrases()
  } else {
    // Re-sort by original order (seed_number, lego_index, position)
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

// ============================================================================
// Click to Play
// ============================================================================

const handlePhraseClick = (displayIndex) => {
  stopPlayback()
  playFromIndex(displayIndex)
}

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(() => {
  console.log('[ListeningMode] Mounted for course:', courseCode.value)
  audioController.value = new ListeningAudioController()
  loadPhrases()
})

onUnmounted(() => {
  stopPlayback()
})

watch(() => props.course?.course_code, () => {
  stopPlayback()
  allPhrases.value = []
  visiblePhrases.value = []
  currentIndex.value = -1
  loadedCount.value = 0
  loadPhrases()
})

// Emit play state changes to parent
watch(isPlaying, (newVal) => {
  emit('playStateChanged', newVal)
})

// Sync playback speed with audio controller
watch(playbackSpeed, (newSpeed) => {
  if (audioController.value) {
    audioController.value.setPlaybackRate(newSpeed)
  }
})

// Expose for external control (e.g., BottomNav play button)
defineExpose({
  isPlaying,
  togglePlayback
})
</script>

<template>
  <div class="listening-mode" :style="{ '--belt-color': beltColor }">
    <!-- Deep Space Background Layers (matches main player) -->
    <div class="space-gradient"></div>
    <div class="space-nebula"></div>
    <div class="bg-noise"></div>

    <!-- Static Star Field -->
    <div class="star-field">
      <div class="star star-1"></div>
      <div class="star star-2"></div>
      <div class="star star-3"></div>
      <div class="star star-4"></div>
      <div class="star star-5"></div>
      <div class="star star-6"></div>
      <div class="star star-7"></div>
      <div class="star star-8"></div>
      <div class="star star-9"></div>
      <div class="star star-10"></div>
      <div class="star star-11"></div>
      <div class="star star-12"></div>
    </div>

    <!-- Header -->
    <header class="header">
      <div class="header-stack">
        <!-- Brand row -->
        <div class="brand-row">
          <div class="brand">
            <span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span>
          </div>
        </div>
        <!-- Title and badge row -->
        <div class="listening-badge-row">
          <span class="listening-badge">Listening Mode</span>
          <span class="phrase-count">{{ loadedCount }} / {{ totalCount }}</span>
        </div>
      </div>
    </header>

    <!-- Mode Toggle -->
    <div class="mode-toggle">
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
    <div class="speed-controls">
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
    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
      <button @click="loadPhrases()">Retry</button>
    </div>

    <!-- Teleprompter View -->
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
          @click="handlePhraseClick(phrase.displayIndex)"
        >
          <div class="phrase-target">{{ phrase.targetText }}</div>
        </div>
      </div>

      <!-- Loading More Indicator -->
      <div v-if="isLoadingMore" class="loading-more">
        <div class="loading-spinner small"></div>
      </div>
    </div>

    <!-- Progress Bar -->
    <div class="progress-container">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <span class="progress-text">{{ progressPercent }}%</span>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=DM+Sans:wght@400;500;600;700&display=swap');

.listening-mode {
  /* Layout system matching main player */
  --safe-area-top: env(safe-area-inset-top, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --header-height: clamp(56px, 8vh, 72px);
  --nav-height: 80px;
  --nav-total: calc(var(--nav-height) + var(--safe-area-bottom));
  --space-md: clamp(12px, 2vmin, 20px);
  --space-lg: clamp(16px, 3vmin, 32px);

  /* Theme colors - belt color is set dynamically via inline style */
  --accent: #c23a3a;
  /* --belt-color is set dynamically from beltColor prop */
  --belt-glow: color-mix(in srgb, var(--belt-color) 15%, transparent);

  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  font-family: 'DM Sans', -apple-system, sans-serif;
  overflow: hidden;
  /* Bottom padding for nav bar */
  padding-bottom: var(--nav-total);
}

/* ============ DEEP SPACE BACKGROUNDS ============ */
.space-gradient {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 120% 80% at 20% 10%, rgba(30, 20, 50, 0.8) 0%, transparent 50%),
    radial-gradient(ellipse 100% 60% at 80% 90%, rgba(20, 30, 50, 0.6) 0%, transparent 40%),
    radial-gradient(ellipse 80% 80% at 50% 50%, rgba(10, 10, 20, 1) 0%, #08080c 100%);
  pointer-events: none;
  z-index: 0;
}

.space-nebula {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 40% at 30% 30%, rgba(100, 80, 140, 0.05) 0%, transparent 50%),
    radial-gradient(ellipse 50% 30% at 70% 60%, rgba(80, 100, 140, 0.04) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}

.bg-noise {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  opacity: 0.03;
  pointer-events: none;
  z-index: 0;
}

/* ============ STAR FIELD ============ */
.star-field {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.star {
  position: absolute;
  width: 2px;
  height: 2px;
  background: white;
  border-radius: 50%;
  animation: star-twinkle 4s ease-in-out infinite;
}

.star-1 { left: 5%; top: 8%; animation-delay: 0s; opacity: 0.4; }
.star-2 { left: 15%; top: 22%; animation-delay: -0.5s; opacity: 0.6; width: 3px; height: 3px; }
.star-3 { left: 28%; top: 12%; animation-delay: -1s; opacity: 0.3; }
.star-4 { left: 42%; top: 5%; animation-delay: -1.5s; opacity: 0.5; }
.star-5 { left: 55%; top: 18%; animation-delay: -2s; opacity: 0.4; width: 3px; height: 3px; }
.star-6 { left: 68%; top: 8%; animation-delay: -2.5s; opacity: 0.6; }
.star-7 { left: 82%; top: 15%; animation-delay: -3s; opacity: 0.3; }
.star-8 { left: 92%; top: 25%; animation-delay: -3.5s; opacity: 0.5; }
.star-9 { left: 8%; top: 35%; animation-delay: -0.3s; opacity: 0.5; }
.star-10 { left: 22%; top: 42%; animation-delay: -0.8s; opacity: 0.4; }
.star-11 { left: 35%; top: 32%; animation-delay: -1.3s; opacity: 0.6; width: 3px; height: 3px; }
.star-12 { left: 62%; top: 28%; animation-delay: -2.3s; opacity: 0.5; }

@keyframes star-twinkle {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.72; }
}

/* Belt-colored glow on some stars */
.star-2, .star-5, .star-11 {
  box-shadow: 0 0 4px var(--belt-color);
}

/* ============ MIST THEME OVERRIDES - Bright light mode ============ */
:root[data-theme="mist"] .space-gradient {
  background:
    radial-gradient(ellipse 120% 80% at 20% 10%, rgba(200, 210, 230, 0.4) 0%, transparent 50%),
    radial-gradient(ellipse 100% 60% at 80% 90%, rgba(210, 200, 220, 0.3) 0%, transparent 40%),
    radial-gradient(ellipse 80% 80% at 50% 50%, #f5f5f7 0%, #e8e8ec 100%);
}

:root[data-theme="mist"] .space-nebula {
  background:
    radial-gradient(ellipse 60% 40% at 30% 30%, rgba(180, 190, 210, 0.15) 0%, transparent 50%),
    radial-gradient(ellipse 50% 30% at 70% 60%, rgba(200, 180, 200, 0.1) 0%, transparent 40%);
}

:root[data-theme="mist"] .bg-noise {
  opacity: 0.02;
  filter: invert(1);
}

/* ============ HEADER ============ */
.header {
  position: relative;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(var(--space-md) + var(--safe-area-top)) var(--space-lg) var(--space-md);
  min-height: var(--header-height);
  pointer-events: auto;
}

.header-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-weight: 700;
  font-size: clamp(1.3125rem, 3vw, 1.6rem);
  letter-spacing: -0.02em;
  opacity: 0.7;
  transition: opacity 0.2s ease;
}

.brand:hover {
  opacity: 1;
}

.logo-say, .logo-in { color: var(--accent); }
.logo-something { color: var(--text-primary); }

.listening-badge-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.listening-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0.25rem 0.625rem;
  background: var(--belt-glow);
  color: var(--belt-color);
  border: 1px solid var(--belt-color);
  border-radius: 4px;
}

.phrase-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Mode Toggle */
.mode-toggle {
  position: relative;
  z-index: 10;
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1.5rem;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-secondary);
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
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.25rem 1.5rem 0.5rem;
}

.speed-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
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
  border-top-color: var(--belt-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-spinner.small {
  width: 20px;
  height: 20px;
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
  position: relative;
  z-index: 10;
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
  padding-block: 35vh;
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
    0 8px 32px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(8px);
}

.phrase-row:hover:not(.current) {
  opacity: 0.8;
  background: rgba(255, 255, 255, 0.03);
}

.phrase-target {
  font-size: 1.0625rem;
  font-weight: 500;
  color: var(--text-primary);
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

.loading-more {
  padding: 1rem;
}

/* Progress Bar */
.progress-container {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1.5rem;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--bg-elevated);
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
  color: var(--text-muted);
  min-width: 36px;
}

/* Responsive */
@media (max-width: 480px) {
  .phrase-target {
    font-size: 1rem;
  }

  .phrase-row.current .phrase-target {
    font-size: 1.125rem;
  }
}
</style>
