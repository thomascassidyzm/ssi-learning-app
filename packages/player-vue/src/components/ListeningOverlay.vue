<script setup>
import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick } from 'vue'

// ============================================================================
// Listening Overlay - Teleprompter style overlay for passive listening
// Lives inside LearningPlayer as an overlay, not a separate screen
// ============================================================================

class ListeningAudioController {
  constructor() {
    this.audio = null
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
      const onEnded = () => {
        this.audio.removeEventListener('ended', onEnded)
        this.audio.removeEventListener('error', onError)
        resolve()
      }

      const onError = (e) => {
        this.audio.removeEventListener('ended', onEnded)
        this.audio.removeEventListener('error', onError)
        reject(e)
      }

      this.audio.addEventListener('ended', onEnded)
      this.audio.addEventListener('error', onError)

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
  }
})

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

// Audio
const audioMap = ref(new Map())
const audioBaseUrl = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com'

let playbackId = 0

const progressPercent = computed(() => {
  if (allPhrases.value.length === 0) return 0
  return Math.round(((currentIndex.value + 1) / allPhrases.value.length) * 100)
})

// ============================================================================
// Data Loading
// ============================================================================

const loadPhrases = async (offset = 0) => {
  if (!supabase?.value || !props.courseCode) {
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

    if (offset === 0) {
      const { count } = await supabase.value
        .from('course_practice_phrases')
        .select('*', { count: 'exact', head: true })
        .eq('course_code', props.courseCode)
        .eq('phrase_role', 'eternal_eligible')

      totalCount.value = count || 0
    }

    const { data, error: fetchError } = await supabase.value
      .from('course_practice_phrases')
      .select('seed_number, lego_index, known_text, target_text, position')
      .eq('course_code', props.courseCode)
      .eq('phrase_role', 'eternal_eligible')
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .order('position', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)

    if (fetchError) throw fetchError

    if (data && data.length > 0) {
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
// Audio
// ============================================================================

const lookupAudio = async (text, role) => {
  if (!supabase?.value || !props.courseCode) return null

  const cacheKey = `${text}:${role}`
  if (audioMap.value.has(cacheKey)) {
    return audioMap.value.get(cacheKey)
  }

  try {
    const { data, error } = await supabase.value
      .from('course_audio')
      .select('s3_key')
      .eq('course_code', props.courseCode)
      .eq('text_normalized', text.toLowerCase().trim())
      .eq('role', role)
      .maybeSingle()

    if (error || !data?.s3_key) return null

    const url = `${audioBaseUrl}/${data.s3_key}`
    audioMap.value.set(cacheKey, url)
    return url
  } catch {
    return null
  }
}

const getRandomVoice = () => Math.random() < 0.5 ? 'target1' : 'target2'

// ============================================================================
// Playback
// ============================================================================

const playFromIndex = async (index) => {
  if (index < 0 || index >= allPhrases.value.length) return

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

  const phrase = allPhrases.value[currentIndex.value]
  if (!phrase) {
    await handleEndOfList(myPlaybackId)
    return
  }

  const voice = getRandomVoice()
  const audioUrl = await lookupAudio(phrase.targetText, voice)

  if (myPlaybackId !== playbackId) return

  if (audioUrl) {
    try {
      await audioController.value.play(audioUrl)
    } catch {
      // Continue on error
    }
  }

  if (myPlaybackId !== playbackId) return

  await new Promise(resolve => setTimeout(resolve, 800))

  if (myPlaybackId !== playbackId) return

  await advanceToNext(myPlaybackId)
}

const advanceToNext = async (myPlaybackId) => {
  if (myPlaybackId !== playbackId) return

  const nextIndex = currentIndex.value + 1

  if (nextIndex >= allPhrases.value.length) {
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
</script>

<template>
  <div class="listening-overlay" @click="handleOverlayTap">
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
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=DM+Sans:wght@400;500;600;700&display=swap');

.listening-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: rgba(8, 8, 12, 0.97);
  backdrop-filter: blur(20px);
  font-family: 'DM Sans', -apple-system, sans-serif;
  padding: env(safe-area-inset-top, 20px) 0 calc(env(safe-area-inset-bottom, 20px) + 100px) 0;
  cursor: pointer;
}

/* Theme colors */
.listening-overlay {
  --gold: #d4a853;
  --gold-glow: rgba(212, 168, 83, 0.15);
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
  background: var(--gold-glow);
  color: var(--gold);
  border: 1px solid var(--gold);
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
  background: var(--gold-glow);
  border-color: var(--gold);
  color: var(--gold);
}

.mode-btn svg {
  width: 16px;
  height: 16px;
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
  border-top-color: var(--gold);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error button {
  padding: 0.5rem 1rem;
  background: var(--gold);
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
  justify-content: center;
  padding: 1rem;
  overflow: hidden;
}

.phrase-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  max-width: 600px;
}

.phrase-row {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0.75rem 1.5rem;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: center;
}

.phrase-row.past {
  opacity: 0.3;
  transform: scale(0.95);
}

.phrase-row.future {
  opacity: 0.5;
}

.phrase-row.current {
  opacity: 1;
  transform: scale(1.05);
  background: linear-gradient(135deg,
    rgba(212, 168, 83, 0.12) 0%,
    rgba(212, 168, 83, 0.06) 50%,
    rgba(212, 168, 83, 0.03) 100%);
  border: 1px solid rgba(212, 168, 83, 0.5);
  box-shadow:
    0 0 20px rgba(212, 168, 83, 0.15),
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
  transition: all 0.3s ease;
}

.phrase-row.current .phrase-target {
  font-size: clamp(1.25rem, 3vmin, 1.5rem);
  font-weight: 600;
  color: var(--gold);
  text-shadow: 0 0 20px rgba(212, 168, 83, 0.3);
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
  background: var(--gold);
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
