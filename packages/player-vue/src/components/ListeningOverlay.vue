<script setup>
import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { getSilentAudioUrl } from '../utils/silentAudio'
import { useOfflineCache } from '../composables/useOfflineCache'

// ============================================================================
// Listening Overlay - Teleprompter style overlay for passive listening
// Lives inside LearningPlayer as an overlay, not a separate screen
// ============================================================================

class ListeningAudioController {
  constructor() {
    this.audio = null
    this.silentAudio = null
    this.playbackRate = 1
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate
    if (this.audio) {
      this.audio.playbackRate = rate
    }
  }

  // Silent looped audio keeps the iOS audio session alive between phrases —
  // without this the session drops during the 800ms inter-phrase gap when
  // the tab is backgrounded, killing playback.
  ensureSilentRunning() {
    if (!this.silentAudio) {
      this.silentAudio = new Audio()
      this.silentAudio.src = getSilentAudioUrl()
      this.silentAudio.loop = true
      this.silentAudio.volume = 0
      this.silentAudio.setAttribute('playsinline', 'true')
      this.silentAudio.setAttribute('webkit-playsinline', 'true')
    }
    if (this.silentAudio.paused) {
      this.silentAudio.play().catch((err) => {
        console.warn('[ListeningAudio] Silent bridge play failed:', err)
      })
    }
  }

  stopSilent() {
    if (this.silentAudio && !this.silentAudio.paused) {
      this.silentAudio.pause()
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
   * Current playing seed number.
   * Filters phrases to only completed seeds (strictly less than this seed).
   * When null/0, shows all USE phrases (no filtering).
   */
  upToSeed: {
    type: Number,
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
// Progress Filtering - Filter phrases by current playing position
// ============================================================================

/**
 * Available phrases filtered by playing position.
 * DB query already filters by seed_number <= upToSeed.
 */
const availablePhrases = computed(() => {
  return allPhrases.value // DB query handles the filtering
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

      if (props.upToSeed) {
        countQuery = countQuery.lt('seed_number', props.upToSeed)
      }

      const { count, error: countError } = await countQuery

      if (countError) {
        console.warn('[ListeningOverlay] Count query error:', countError.message)
      }
      totalCount.value = count || 0
      console.log('[ListeningOverlay] USE phrases available:', totalCount.value, props.upToSeed ? `(up to seed ${props.upToSeed})` : '(all)')
    }

    let dataQuery = supabase.value
      .from('course_practice_phrases')
      .select('seed_number, lego_index, known_text, target_text, position, target1_audio_id, target2_audio_id')
      .eq('course_code', props.courseCode)
      .in('phrase_role', ['use', 'eternal_eligible'])

    if (props.upToSeed) {
      dataQuery = dataQuery.lt('seed_number', props.upToSeed)
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
  audioController.value?.ensureSilentRunning()
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
  audioController.value?.stopSilent()
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
// Wake Lock + Media Session (lock-screen + bluetooth controls)
// ============================================================================

let wakeLock = null

const acquireWakeLock = async () => {
  if (!('wakeLock' in navigator)) return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => { wakeLock = null })
  } catch {
    // Wake Lock not available or denied — fine, silent bridge keeps audio alive
  }
}

const releaseWakeLock = () => {
  if (wakeLock) {
    wakeLock.release().catch(() => {})
    wakeLock = null
  }
}

const handleVisibilityChange = async () => {
  // Android releases wake lock on tab switch — re-acquire on return
  if (document.visibilityState === 'visible' && isPlaying.value && !wakeLock) {
    await acquireWakeLock()
  }
}

const setupMediaSession = () => {
  if (!('mediaSession' in navigator)) return

  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'Listening Mode',
    artist: 'SSi Learning',
    album: 'Practice'
  })

  const handlers = [
    ['play', () => { if (!isPlaying.value) togglePlayback() }],
    ['pause', () => { if (isPlaying.value) togglePlayback() }],
    ['nexttrack', () => {
      if (currentIndex.value + 1 < availablePhrases.value.length) {
        playFromIndex(currentIndex.value + 1)
      }
    }],
    ['previoustrack', () => {
      if (currentIndex.value > 0) {
        playFromIndex(currentIndex.value - 1)
      }
    }]
  ]

  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // Action not supported — skip
    }
  }
}

const clearMediaSession = () => {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = null
  for (const action of ['play', 'pause', 'nexttrack', 'previoustrack']) {
    try { navigator.mediaSession.setActionHandler(action, null) } catch {}
  }
}

watch(isPlaying, async (playing) => {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }
  if (playing) {
    await acquireWakeLock()
  } else {
    releaseWakeLock()
  }
})

// ============================================================================
// Offline Pack Download — preload USE phrase audio for plane-ride listening
// ============================================================================

const { cache: offlineCache } = useOfflineCache()

const packState = ref('idle') // 'idle' | 'downloading' | 'complete' | 'error'
const packTotal = ref(0)
const packDone = ref(0)

const packKey = computed(() => `listening-pack:${props.courseCode}:${props.upToSeed ?? 'all'}`)

const packPercent = computed(() => {
  if (packTotal.value === 0) return 0
  return Math.round((packDone.value / packTotal.value) * 100)
})

const checkPackComplete = () => {
  try {
    if (localStorage.getItem(packKey.value) === 'complete') {
      packState.value = 'complete'
    }
  } catch {
    // localStorage may be blocked — fine, just skip the persisted flag
  }
}

const fetchAllAudioIds = async () => {
  if (!supabase?.value || !props.courseCode) return []

  let query = supabase.value
    .from('course_practice_phrases')
    .select('target1_audio_id, target2_audio_id')
    .eq('course_code', props.courseCode)
    .in('phrase_role', ['use', 'eternal_eligible'])

  if (props.upToSeed) {
    query = query.lt('seed_number', props.upToSeed)
  }

  const { data, error: fetchError } = await query
  if (fetchError) throw fetchError

  const ids = new Set()
  for (const row of data || []) {
    if (row.target1_audio_id) ids.add(row.target1_audio_id)
    if (row.target2_audio_id) ids.add(row.target2_audio_id)
  }
  return Array.from(ids)
}

const PACK_CONCURRENCY = 5

const downloadListeningPack = async () => {
  if (packState.value === 'downloading') return

  try {
    packState.value = 'downloading'
    packDone.value = 0
    packTotal.value = 0

    const ids = await fetchAllAudioIds()
    packTotal.value = ids.length

    if (ids.length === 0) {
      packState.value = 'complete'
      try { localStorage.setItem(packKey.value, 'complete') } catch {}
      return
    }

    // Filter out already-cached IDs
    const missing = []
    for (const id of ids) {
      if (offlineCache.isAudioCached(id)) {
        packDone.value++
      } else {
        missing.push(id)
      }
    }

    // cacheAudio fetches the URL internally and stores the blob in IndexedDB;
    // the SW (CacheFirst on /api/audio/*) also caches en route, giving
    // belt-and-braces durability.
    for (let i = 0; i < missing.length; i += PACK_CONCURRENCY) {
      if (packState.value !== 'downloading') return // cancelled by close

      const batch = missing.slice(i, i + PACK_CONCURRENCY)
      await Promise.all(batch.map(async (id) => {
        const url = `/api/audio/${id}?courseId=${encodeURIComponent(props.courseCode)}`
        try {
          await offlineCache.cacheAudio({ id, url, durationMs: 0 }, props.courseCode)
        } catch (err) {
          console.warn('[ListeningOverlay] Failed to cache', id, err)
        } finally {
          packDone.value++
        }
      }))
    }

    packState.value = 'complete'
    try { localStorage.setItem(packKey.value, 'complete') } catch {}
  } catch (err) {
    console.error('[ListeningOverlay] Pack download failed:', err)
    packState.value = 'error'
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(() => {
  audioController.value = new ListeningAudioController()
  loadPhrases()
  setupMediaSession()
  document.addEventListener('visibilitychange', handleVisibilityChange)
  checkPackComplete()
})

onUnmounted(() => {
  stopPlayback()
  releaseWakeLock()
  clearMediaSession()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  // Cancel any in-flight pack download
  if (packState.value === 'downloading') {
    packState.value = 'idle'
  }
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

    <!-- Offline download button -->
    <button
      class="download-btn"
      :class="{ downloading: packState === 'downloading', complete: packState === 'complete', error: packState === 'error' }"
      :disabled="packState === 'downloading'"
      :title="packState === 'complete' ? 'Available offline' : packState === 'downloading' ? `Downloading ${packPercent}%` : 'Download for offline'"
      @click.stop="downloadListeningPack"
    >
      <svg v-if="packState === 'idle'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
      </svg>
      <svg v-else-if="packState === 'complete'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <svg v-else-if="packState === 'error'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span v-else class="download-pct">{{ packPercent }}%</span>
    </button>

    <!-- Controls bar: mode toggle + transport + speed -->
    <div class="controls-bar" @click.stop>
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

      <!-- Transport: play/stop + progress bar -->
      <div class="transport-bar">
        <button class="transport-btn" @click="togglePlayback">
          <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <polygon points="7 3 20 12 7 21 7 3"/>
          </svg>
        </button>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <span class="progress-text">{{ progressPercent }}%</span>
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
          <div v-if="phrase.isCurrent && phrase.knownText" class="phrase-known">{{ phrase.knownText }}</div>
        </div>
      </div>

      <!-- Play/Pause indicator -->
      <div class="playback-hint" :class="{ playing: isPlaying }">
        <span v-if="isPlaying">Tap to pause</span>
        <span v-else>Tap to play</span>
      </div>
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
  background: color-mix(in srgb, var(--bg-primary) 55%, transparent);
  backdrop-filter: blur(8px);
  font-family: var(--font-body);
  padding: env(safe-area-inset-top, 20px) 0 calc(env(safe-area-inset-bottom, 20px) + 100px) 0;
  cursor: pointer;
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
  background: var(--bg-elevated);
  border: 1px solid var(--border-medium);
  border-radius: 50%;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 10;
}

.close-btn:hover {
  background: var(--pill-bg-hover);
  color: var(--text-primary);
}

.close-btn svg {
  width: 20px;
  height: 20px;
}

/* Offline download button — sits to the left of close */
.download-btn {
  position: absolute;
  top: calc(env(safe-area-inset-top, 20px) + 12px);
  right: 72px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border-medium);
  border-radius: 50%;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 10;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: 600;
}

.download-btn:hover:not(:disabled) {
  background: var(--pill-bg-hover);
  color: var(--text-primary);
}

.download-btn:disabled {
  cursor: progress;
}

.download-btn.complete {
  color: var(--belt-color, #4a7c4a);
  border-color: var(--belt-color, #4a7c4a);
}

.download-btn.error {
  color: var(--ssi-red, #b83232);
  border-color: var(--ssi-red, #b83232);
}

.download-btn svg {
  width: 18px;
  height: 18px;
}

.download-pct {
  font-size: 0.6875rem;
  letter-spacing: -0.02em;
}

/* Controls bar — pushed down to clear the SSi logo */
.controls-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 3.5rem 1.5rem 0.5rem;
  cursor: default;
}

/* Mode Toggle */
.mode-toggle {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border-medium);
  border-radius: 20px;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-btn:hover {
  background: var(--pill-bg-hover);
  color: var(--text-secondary);
}

.mode-btn.active {
  background: var(--bg-elevated);
  border-color: var(--text-secondary);
  color: var(--text-primary);
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
  border: 1px solid var(--border-medium);
  border-radius: 4px;
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.speed-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.speed-btn.active {
  background: var(--bg-elevated);
  border-color: var(--text-secondary);
  color: var(--text-primary);
}

/* Loading / Error */
.loading, .error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-muted);
  cursor: default;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid var(--border-medium);
  border-top-color: var(--text-muted);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error button {
  padding: 0.5rem 1rem;
  background: var(--ssi-red, #b83232);
  border: none;
  border-radius: 8px;
  color: white;
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
  padding-block: 25vh;
}

.phrase-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0.75rem 1.5rem;
  border-radius: 12px;
  cursor: pointer;
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
  padding: 1rem 1.5rem;
  background: #ffffff;
  border: 1px solid var(--border-medium);
  box-shadow: 0 2px 20px rgba(0, 0, 0, 0.1);
}

.phrase-row:hover:not(.current) {
  opacity: 0.8;
  background: var(--bg-card-hover);
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
  color: var(--text-primary);
}

.phrase-known {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-top: 0.375rem;
  font-style: italic;
}

/* Playback hint */
.playback-hint {
  margin-top: 2rem;
  font-size: 0.875rem;
  color: var(--text-muted);
  opacity: 0.6;
  transition: opacity 0.3s ease;
}

.playback-hint.playing {
  opacity: 0.4;
}

/* Transport + Progress */
.transport-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.transport-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(145deg, var(--ssi-red-light, #d44545) 0%, var(--ssi-red, #b83232) 100%);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 4px 12px rgba(194, 58, 58, 0.35);
  -webkit-tap-highlight-color: transparent;
}

.transport-btn:active {
  transform: scale(0.9);
}

.transport-btn svg {
  width: 18px;
  height: 18px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
}

/* Play icon offset for optical centering */
.transport-btn svg polygon {
  transform: translateX(1px);
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--border-medium);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--ssi-red, #b83232);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: var(--text-muted);
  min-width: 36px;
}
</style>
