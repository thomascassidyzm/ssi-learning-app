<script setup>
import { ref, computed, inject, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useVirtualList } from '@vueuse/core'
import { CyclePhase } from '@ssi/core'
import { generateLearningScript } from '../providers/CourseDataProvider'
import {
  getCachedScript,
  setCachedScript,
} from '../composables/useScriptCache'

// ============================================================================
// Simple audio controller for script preview playback
// ============================================================================
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
const view = ref('summary') // 'summary' | 'script'
const isLoading = ref(true)
const isRefreshing = ref(false)
const loadedFromCache = ref(false)
const cachedAt = ref(null)
const error = ref(null)

// Course content - ALL rounds loaded at once
const rounds = ref([])
const allItems = ref([]) // Flattened items for virtual list
const totalSeeds = ref(0)
const totalLegos = ref(0)
const scriptLoaded = ref(false)
const isLoadingScript = ref(false)

// Audio map for resolving text -> audio UUIDs
const audioMap = ref(new Map())
const audioBaseUrl = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered'

// Playback state
const isPlaying = ref(false)
const currentFlatIndex = ref(-1) // Index in flattened allItems
const currentPhase = ref('idle')
const audioController = ref(null)
let cycleId = 0
let pendingTimers = []

// Jump navigation state
const selectedRound = ref(1)
const selectedSeed = ref('')

// Computed
const courseName = computed(() => props.course?.display_name || props.course?.title || 'Course')
const courseCode = computed(() => props.course?.course_code || '')
const currentCourseId = ref('')

// Get unique seeds for dropdown
const uniqueSeeds = computed(() => {
  const seeds = new Set()
  for (const round of rounds.value) {
    seeds.add(round.seedId)
  }
  return [...seeds]
})

// Progress through course (0-100)
const progressPercent = computed(() => {
  if (currentFlatIndex.value < 0 || allItems.value.length === 0) return 0
  return Math.round((currentFlatIndex.value / allItems.value.length) * 100)
})

// Current item info
const currentItem = computed(() => {
  if (currentFlatIndex.value >= 0 && currentFlatIndex.value < allItems.value.length) {
    return allItems.value[currentFlatIndex.value]
  }
  return null
})

// Virtual list setup - renders only visible items
const { list: virtualItems, containerProps, wrapperProps, scrollTo } = useVirtualList(
  allItems,
  {
    itemHeight: 52, // Approximate height of each item row
    overscan: 10, // Render extra items above/below viewport
  }
)

// ============================================================================
// Data Loading
// ============================================================================

// FAST: Load just summary stats
const loadSummary = async () => {
  console.log('[CourseExplorer] loadSummary called')

  if (!supabase?.value) {
    totalSeeds.value = 10
    totalLegos.value = 10
    isLoading.value = false
    return
  }

  const courseId = props.course?.course_code || 'demo'
  currentCourseId.value = courseId

  try {
    const [seedResult, legoResult] = await Promise.all([
      supabase.value
        .from('course_seeds')
        .select('seed_number', { count: 'exact', head: true })
        .eq('course_code', courseId),
      supabase.value
        .from('course_legos')
        .select('lego_id', { count: 'exact', head: true })
        .eq('course_code', courseId)
    ])

    totalSeeds.value = seedResult.count || 0
    totalLegos.value = legoResult.count || 0
    console.log('[CourseExplorer] Summary loaded:', totalSeeds.value, 'seeds,', totalLegos.value, 'LEGOs')
  } catch (err) {
    console.warn('[CourseExplorer] Summary load error:', err)
  } finally {
    isLoading.value = false
  }
}

// Load ALL script data at once
const loadScript = async (forceRefresh = false) => {
  console.log('[CourseExplorer] loadScript called, forceRefresh:', forceRefresh)

  if (scriptLoaded.value && !forceRefresh) {
    console.log('[CourseExplorer] Script already loaded')
    return
  }

  if (!courseDataProvider?.value) {
    rounds.value = createDemoRounds()
    flattenItems()
    scriptLoaded.value = true
    return
  }

  const courseId = props.course?.course_code || 'demo'

  // Try cache first
  if (!forceRefresh) {
    try {
      const cached = await getCachedScript(courseId)
      if (cached) {
        console.log('[CourseExplorer] Using cached script from', new Date(cached.cachedAt).toLocaleString())
        rounds.value = cached.rounds
        audioMap.value = new Map(Object.entries(cached.audioMapObj || {}))
        loadedFromCache.value = true
        cachedAt.value = cached.cachedAt
        flattenItems()
        scriptLoaded.value = true
        isLoadingScript.value = false

        // Load intro audio in background
        const legoIds = new Set()
        for (const round of cached.rounds || []) {
          for (const item of round.items || []) {
            if (item.type === 'intro' && item.legoId) {
              legoIds.add(item.legoId)
            }
          }
        }
        if (legoIds.size > 0) {
          loadIntroAudio(courseId, legoIds)
        }
        return
      }
    } catch (err) {
      console.warn('[CourseExplorer] Cache read failed:', err)
    }
  }

  try {
    isLoadingScript.value = true
    if (forceRefresh) isRefreshing.value = true
    error.value = null

    // Generate FULL script - all LEGOs
    console.log('[CourseExplorer] Generating FULL script for:', courseId)
    // Provider now contains all config - single source of truth
    const script = await generateLearningScript(
      courseDataProvider.value,
      totalLegos.value || 1000 // Load all LEGOs
    )
    console.log('[CourseExplorer] Full script generated:', script?.rounds?.length, 'rounds')

    rounds.value = script.rounds
    flattenItems()

    // Load all intro audio
    const legoIds = new Set()
    for (const item of script.allItems) {
      if (item.type === 'intro' && item.legoId) {
        legoIds.add(item.legoId)
      }
    }
    await loadIntroAudio(courseId, legoIds)

    scriptLoaded.value = true

    // Cache the full script
    try {
      const audioMapObj = Object.fromEntries(audioMap.value)
      const serializableRounds = JSON.parse(JSON.stringify(script.rounds))

      let welcomeUuid = props.course?.welcome || null
      if (!welcomeUuid && supabase?.value && courseId) {
        try {
          const { data: courseData } = await supabase.value
            .from('courses')
            .select('welcome')
            .eq('course_code', courseId)
            .single()
          welcomeUuid = courseData?.welcome || null
        } catch (e) {}
      }

      const courseWelcome = welcomeUuid ? { id: welcomeUuid } : null

      await setCachedScript(courseId, {
        rounds: serializableRounds,
        totalSeeds: totalSeeds.value,
        totalLegos: totalLegos.value,
        loadedLegos: script.rounds.length,
        totalCycles: script.allItems.length,
        audioMapObj,
        courseWelcome
      })
      console.log('[CourseExplorer] Full script cached')
    } catch (cacheErr) {
      console.warn('[CourseExplorer] Cache write failed:', cacheErr)
    }

    loadedFromCache.value = false
    cachedAt.value = Date.now()

    console.log('[CourseExplorer] Loaded', script.rounds.length, 'rounds,', allItems.value.length, 'total items')
  } catch (err) {
    console.error('[CourseExplorer] Script load error:', err)
    error.value = 'Failed to load script'
  } finally {
    isLoadingScript.value = false
    isRefreshing.value = false
  }
}

// Flatten rounds into single item list with round markers
const flattenItems = () => {
  const flat = []
  for (const round of rounds.value) {
    // Add round header as special item
    flat.push({
      isRoundHeader: true,
      roundNumber: round.roundNumber,
      legoId: round.legoId,
      seedId: round.seedId,
      spacedRepReviews: round.spacedRepReviews || [],
    })

    // Add all items with round context
    for (let i = 0; i < round.items.length; i++) {
      flat.push({
        ...round.items[i],
        isRoundHeader: false,
        roundNumber: round.roundNumber,
        itemIndexInRound: i,
        roundRef: round, // Keep reference for helper functions
      })
    }
  }
  allItems.value = flat
  console.log('[CourseExplorer] Flattened to', flat.length, 'items')
}

// Switch to script view
const switchToScript = () => {
  view.value = 'script'
  if (!scriptLoaded.value) {
    loadScript()
  }
}

// Force refresh
const refreshContent = () => {
  scriptLoaded.value = false
  loadScript(true)
}

// ============================================================================
// Jump Navigation
// ============================================================================

// Jump to specific round
const jumpToRound = (roundNum) => {
  const targetIndex = allItems.value.findIndex(
    item => item.isRoundHeader && item.roundNumber === roundNum
  )
  if (targetIndex >= 0) {
    scrollTo(targetIndex)
    selectedRound.value = roundNum
    // Update seed dropdown to match
    const round = rounds.value.find(r => r.roundNumber === roundNum)
    if (round) selectedSeed.value = round.seedId
  }
}

// Jump to specific seed
const jumpToSeed = (seedId) => {
  const targetIndex = allItems.value.findIndex(
    item => item.isRoundHeader && item.seedId === seedId
  )
  if (targetIndex >= 0) {
    scrollTo(targetIndex)
    selectedSeed.value = seedId
    // Update round dropdown to match
    const round = rounds.value.find(r => r.seedId === seedId)
    if (round) selectedRound.value = round.roundNumber
  }
}

// Jump via progress bar click
const jumpToProgress = (event) => {
  const rect = event.currentTarget.getBoundingClientRect()
  const percent = (event.clientX - rect.left) / rect.width
  const targetIndex = Math.floor(percent * allItems.value.length)
  if (targetIndex >= 0 && targetIndex < allItems.value.length) {
    scrollTo(targetIndex)
  }
}

// ============================================================================
// Audio Loading
// ============================================================================

const loadIntroAudio = async (courseId, legoIds) => {
  if (!supabase?.value || legoIds.size === 0) return

  console.log('[CourseExplorer] Loading intro audio for', legoIds.size, 'LEGOs')

  // Try v12 schema first
  const { data: v12Data, error: v12Error } = await supabase.value
    .from('course_audio')
    .select('context, audio_id')
    .eq('course_code', courseId)
    .eq('role', 'presentation')
    .in('context', [...legoIds])

  if (!v12Error && v12Data && v12Data.length > 0) {
    for (const intro of v12Data) {
      if (intro.context && intro.audio_id) {
        audioMap.value.set(`intro:${intro.context}`, { intro: intro.audio_id })
      }
    }
    console.log('[CourseExplorer] Found', v12Data.length, 'intro audio entries (v12)')
    return
  }

  // Fall back to legacy
  const { data: introData, error: introError } = await supabase.value
    .from('lego_introductions')
    .select('lego_id, audio_uuid, course_code')
    .eq('course_code', courseId)
    .in('lego_id', [...legoIds])

  if (!introError) {
    for (const intro of (introData || [])) {
      audioMap.value.set(`intro:${intro.lego_id}`, { intro: intro.audio_uuid })
    }
    console.log('[CourseExplorer] Found', introData?.length || 0, 'intro audio entries (legacy)')
  }
}

// Lazy audio lookup
const lookupAudioLazy = async (text, role, isKnown = false) => {
  if (!supabase?.value || !currentCourseId.value) return null

  const cached = audioMap.value.get(text)
  if (cached?.[role]) return cached[role]

  try {
    const { data: textsData } = await supabase.value
      .from('texts')
      .select('id')
      .eq('content', text)
      .limit(1)

    if (!textsData?.length) return null

    const textId = textsData[0].id
    const { data: audioData } = await supabase.value
      .from('audio_files')
      .select('id')
      .eq('text_id', textId)

    if (!audioData?.length) return null

    const audioIds = audioData.map(a => a.id)
    const targetRole = isKnown ? 'known' : role

    const { data: courseAudio } = await supabase.value
      .from('course_audio')
      .select('audio_id, role')
      .eq('course_code', currentCourseId.value)
      .in('audio_id', audioIds)

    for (const ca of (courseAudio || [])) {
      const matchRole = isKnown ? 'known' : role
      if (ca.role === matchRole) {
        if (!audioMap.value.has(text)) audioMap.value.set(text, {})
        audioMap.value.get(text)[role] = ca.audio_id
        return ca.audio_id
      }
    }
    return null
  } catch (err) {
    console.warn('[CourseExplorer] Lazy audio lookup failed:', err)
    return null
  }
}

const getAudioUrlAsync = async (text, role, item = null) => {
  if (role === 'intro' && item?.legoId) {
    const introEntry = audioMap.value.get(`intro:${item.legoId}`)
    if (introEntry?.intro) {
      return `${audioBaseUrl}/${introEntry.intro.toUpperCase()}.mp3`
    }
    return null
  }

  const audioEntry = audioMap.value.get(text)
  let uuid = audioEntry?.[role]

  if (!uuid) {
    const isKnown = role === 'known'
    uuid = await lookupAudioLazy(text, role, isKnown)
  }

  if (!uuid) return null
  return `${audioBaseUrl}/${uuid.toUpperCase()}.mp3`
}

const getAudioUrl = (text, role, item = null) => {
  if (role === 'intro' && item?.legoId) {
    const introEntry = audioMap.value.get(`intro:${item.legoId}`)
    if (introEntry?.intro) {
      return `${audioBaseUrl}/${introEntry.intro.toUpperCase()}.mp3`
    }
    return null
  }

  const audioEntry = audioMap.value.get(text)
  if (!audioEntry) return null
  const uuid = audioEntry[role]
  if (!uuid) return null
  return `${audioBaseUrl}/${uuid.toUpperCase()}.mp3`
}

const hasAudio = (item) => {
  if (item.isRoundHeader) return false
  if (item.type === 'intro' && item.legoId) {
    return !!getAudioUrl(null, 'intro', item)
  }
  return !!getAudioUrl(item.targetText, 'target1', item)
}

const createDemoRounds = () => {
  return [
    {
      roundNumber: 1,
      legoId: 'S0001L01',
      seedId: 'S0001',
      items: [
        { type: 'intro', knownText: 'I want', targetText: 'demo' },
        { type: 'debut', knownText: 'I want', targetText: 'demo' },
      ],
      spacedRepReviews: []
    },
  ]
}

// ============================================================================
// Playback Controls
// ============================================================================

const scheduleTimer = (callback, delay) => {
  const timerId = setTimeout(() => {
    pendingTimers = pendingTimers.filter(id => id !== timerId)
    callback()
  }, delay)
  pendingTimers.push(timerId)
  return timerId
}

const clearAllTimers = () => {
  for (const timerId of pendingTimers) clearTimeout(timerId)
  pendingTimers = []
}

const cancelCurrentPlayback = () => {
  clearAllTimers()
  if (audioController.value) audioController.value.stop()
}

// Play from flat index
const playFromIndex = async (flatIndex) => {
  const item = allItems.value[flatIndex]
  if (!item || item.isRoundHeader) return

  cancelCurrentPlayback()
  const myCycleId = ++cycleId
  console.log('[CourseExplorer] Starting cycle', myCycleId, 'at index', flatIndex)

  currentFlatIndex.value = flatIndex
  isPlaying.value = true

  // Update dropdowns to match
  selectedRound.value = item.roundNumber
  if (item.seedId) selectedSeed.value = item.seedId

  // Scroll to item
  await nextTick()
  scrollTo(flatIndex)

  if (!audioController.value) {
    audioController.value = new ScriptAudioController()
  }

  await runPhase('prompt', myCycleId)
}

const runPhase = async (phase, myCycleId) => {
  if (myCycleId !== cycleId) return

  const item = allItems.value[currentFlatIndex.value]
  if (!item || item.isRoundHeader) {
    advanceToNextItem(myCycleId)
    return
  }

  currentPhase.value = phase
  console.log('[CourseExplorer] Cycle', myCycleId, 'phase:', phase)

  switch (phase) {
    case 'prompt': {
      let promptUrl
      if (item.type === 'intro' && item.legoId) {
        promptUrl = getAudioUrl(null, 'intro', item)
      } else {
        promptUrl = await getAudioUrlAsync(item.knownText, 'known', item)
        if (myCycleId !== cycleId) return
      }

      if (promptUrl) {
        try {
          await audioController.value.play({ url: promptUrl })
          if (myCycleId !== cycleId) return
          runPhase('pause', myCycleId)
          return
        } catch (err) {
          if (myCycleId !== cycleId) return
        }
      }
      if (myCycleId === cycleId) runPhase('pause', myCycleId)
      break
    }

    case 'pause': {
      const isIntroItem = item.type === 'intro'
      scheduleTimer(() => {
        if (myCycleId === cycleId) {
          if (isIntroItem) {
            advanceToNextItem(myCycleId)
          } else {
            runPhase('voice1', myCycleId)
          }
        }
      }, 1000)
      break
    }

    case 'voice1': {
      const voice1Url = await getAudioUrlAsync(item.targetText, 'target1', item)
      if (myCycleId !== cycleId) return
      if (voice1Url) {
        try {
          await audioController.value.play({ url: voice1Url })
          if (myCycleId !== cycleId) return
          runPhase('voice2', myCycleId)
          return
        } catch (err) {
          if (myCycleId !== cycleId) return
          stopPlayback()
          return
        }
      }
      stopPlayback()
      break
    }

    case 'voice2': {
      const voice2Url = await getAudioUrlAsync(item.targetText, 'target2', item)
      if (myCycleId !== cycleId) return
      if (voice2Url) {
        try {
          await audioController.value.play({ url: voice2Url })
          if (myCycleId !== cycleId) return
          advanceToNextItem(myCycleId)
          return
        } catch (err) {
          if (myCycleId !== cycleId) return
        }
      }
      if (myCycleId === cycleId) advanceToNextItem(myCycleId)
      break
    }
  }
}

const advanceToNextItem = (myCycleId) => {
  if (myCycleId !== cycleId) return

  // Find next non-header item
  let nextIndex = currentFlatIndex.value + 1
  while (nextIndex < allItems.value.length && allItems.value[nextIndex].isRoundHeader) {
    nextIndex++
  }

  if (nextIndex >= allItems.value.length) {
    stopPlayback()
    return
  }

  scheduleTimer(() => {
    if (myCycleId === cycleId) {
      playFromIndex(nextIndex)
    }
  }, 500)
}

const stopPlayback = () => {
  console.log('[CourseExplorer] STOP')
  cycleId++
  clearAllTimers()
  if (audioController.value) audioController.value.stop()
  isPlaying.value = false
  currentPhase.value = 'idle'
  currentFlatIndex.value = -1
}

// ============================================================================
// Helper functions for display
// ============================================================================

const getDebutPhraseIndex = (item) => {
  if (!item.roundRef) return 1
  let count = 0
  for (let i = 0; i <= item.itemIndexInRound; i++) {
    if (item.roundRef.items[i].type === 'debut_phrase') count++
  }
  return count
}

const isN1Review = (item) => {
  return item.reviewOf === item.roundNumber - 1
}

const getSpacedRepOccurrence = (item) => {
  if (!item.roundRef) return 1
  let count = 0
  for (let i = 0; i <= item.itemIndexInRound; i++) {
    const ri = item.roundRef.items[i]
    if (ri.type === 'spaced_rep' && ri.reviewOf === item.reviewOf) count++
  }
  return count
}

const getConsolidationIndex = (item) => {
  if (!item.roundRef) return 1
  let count = 0
  for (let i = 0; i <= item.itemIndexInRound; i++) {
    if (item.roundRef.items[i].type === 'consolidation') count++
  }
  return count
}

const formatCachedDate = computed(() => {
  if (!cachedAt.value) return ''
  const date = new Date(cachedAt.value)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})

// Lifecycle
onMounted(() => {
  console.log('[CourseExplorer] === VERSION 2024-12-25-VIRTUAL === Mounted')
  loadSummary()
})

onUnmounted(() => {
  clearAllTimers()
  if (audioController.value) audioController.value.stop()
})
</script>

<template>
  <div class="explorer">
    <!-- Ambient background -->
    <div class="bg-layer"></div>

    <!-- Header -->
    <header class="header">
      <button class="back-btn" @click="$emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <div class="header-content">
        <h1 class="header-title">{{ courseName }}</h1>
        <span class="header-badge">QA Script</span>
        <span v-if="loadedFromCache" class="cache-indicator" :title="'Cached: ' + formatCachedDate">
          cached
        </span>
      </div>
      <button
        class="refresh-btn"
        @click="refreshContent"
        :disabled="isRefreshing"
        title="Refresh from database"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          :class="{ spinning: isRefreshing }"
        >
          <path d="M23 4v6h-6M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      </button>
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
        <span class="stat-value">{{ rounds.length }}</span>
        <span class="stat-label">Rounds</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <span class="stat-value">{{ allItems.length }}</span>
        <span class="stat-label">Items</span>
      </div>
    </div>

    <!-- Tab Navigation -->
    <nav class="tabs">
      <button class="tab" :class="{ active: view === 'summary' }" @click="view = 'summary'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        Summary
      </button>
      <button class="tab" :class="{ active: view === 'script' }" @click="switchToScript">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/>
        </svg>
        Script
      </button>
    </nav>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading">
      <div class="loading-spinner"></div>
      <p>Loading course...</p>
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
        </div>
      </div>

      <div class="summary-card">
        <h2>Learning Script</h2>
        <p class="preview-hint">View and play the complete learning journey. Click any phrase to start playback.</p>
        <button class="view-script-btn" @click="switchToScript">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <path d="M14 2v6h6"/>
          </svg>
          View Full Script
        </button>
      </div>
    </div>

    <!-- Script View with Virtual Scrolling -->
    <div v-else class="script-view">
      <!-- Loading state -->
      <div v-if="isLoadingScript" class="script-loading">
        <div class="loading-spinner"></div>
        <p>Generating full script ({{ totalLegos }} LEGOs)...</p>
      </div>

      <template v-else>
        <!-- Jump Navigation Bar -->
        <div class="jump-nav">
          <div class="jump-group">
            <label>Round:</label>
            <select v-model="selectedRound" @change="jumpToRound(selectedRound)">
              <option v-for="r in rounds.length" :key="r" :value="r">{{ r }}</option>
            </select>
          </div>
          <div class="jump-group">
            <label>Seed:</label>
            <select v-model="selectedSeed" @change="jumpToSeed(selectedSeed)">
              <option v-for="seed in uniqueSeeds" :key="seed" :value="seed">{{ seed }}</option>
            </select>
          </div>
          <div class="jump-progress" @click="jumpToProgress">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
            </div>
            <span class="progress-text">{{ progressPercent }}%</span>
          </div>
        </div>

        <!-- Virtual List Container -->
        <div class="virtual-list-container" v-bind="containerProps">
          <div v-bind="wrapperProps">
            <div
              v-for="{ data: item, index } in virtualItems"
              :key="index"
              class="script-row"
              :class="{
                'round-header': item.isRoundHeader,
                [item.type]: !item.isRoundHeader,
                'playing': !item.isRoundHeader && currentFlatIndex === index,
                'has-audio': !item.isRoundHeader && hasAudio(item)
              }"
              @click="!item.isRoundHeader && playFromIndex(index)"
            >
              <!-- Round Header -->
              <template v-if="item.isRoundHeader">
                <div class="round-badge">ROUND {{ item.roundNumber }}</div>
                <div class="round-lego-id">{{ item.legoId }}</div>
                <div class="round-seed-id">{{ item.seedId }}</div>
                <div class="round-reviews" v-if="item.spacedRepReviews?.length">
                  Reviews: {{ item.spacedRepReviews.join(', ') }}
                </div>
              </template>

              <!-- Item Row -->
              <template v-else>
                <div class="item-play">
                  <svg v-if="currentFlatIndex === index" class="playing-icon" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1"/>
                    <rect x="14" y="4" width="4" height="16" rx="1"/>
                  </svg>
                  <svg v-else-if="hasAudio(item)" class="play-icon" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  <span v-else class="no-audio">-</span>
                </div>

                <div class="item-type" :class="item.type">
                  <template v-if="item.type === 'intro'">INTRO</template>
                  <template v-else-if="item.type === 'debut'">LEGO</template>
                  <template v-else-if="item.type === 'debut_phrase'">DEBUT-{{ getDebutPhraseIndex(item) }}</template>
                  <template v-else-if="item.type === 'spaced_rep'">
                    REP #{{ item.reviewOf }}{{ isN1Review(item) ? '-' + getSpacedRepOccurrence(item) : '' }}
                  </template>
                  <template v-else-if="item.type === 'consolidation'">ETERNAL-{{ getConsolidationIndex(item) }}</template>
                </div>

                <div class="item-known">{{ item.knownText }}</div>
                <div class="item-arrow">→</div>
                <div class="item-target">{{ item.targetText }}</div>

                <div v-if="item.type === 'spaced_rep'" class="item-fib">
                  {{ item.reviewOf === item.roundNumber - 1 ? '3x' : '1x' }}
                </div>
              </template>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Global Stop Button -->
    <button v-if="isPlaying" class="global-stop-btn" @click.stop.prevent="stopPlayback">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="2"/>
      </svg>
      <span>STOP</span>
    </button>
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
}

.bg-layer {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(212, 168, 83, 0.08) 0%, transparent 50%),
    var(--bg-primary);
  pointer-events: none;
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

.back-btn, .refresh-btn {
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
  flex-shrink: 0;
}

.back-btn:hover, .refresh-btn:hover:not(:disabled) {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.refresh-btn svg { width: 18px; height: 18px; }
.refresh-btn svg.spinning { animation: spin 1s linear infinite; }
.back-btn svg { width: 20px; height: 20px; }

@keyframes spin { to { transform: rotate(360deg); } }

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

.cache-indicator {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.5625rem;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 0.125rem 0.375rem;
  background: rgba(255, 255, 255, 0.05);
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
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.stat-label {
  font-size: 0.625rem;
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

.tab:hover { background: var(--bg-card); color: var(--text-secondary); }
.tab.active { background: var(--bg-elevated); border-color: var(--gold); color: var(--gold); }
.tab svg { width: 18px; height: 18px; }

/* Loading */
.loading, .script-loading {
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
.overview-icon::before { font-size: 1.25rem; }
.overview-icon.seeds::before { content: '🌱'; }
.overview-icon.legos::before { content: '🧱'; }

.overview-info { display: flex; flex-direction: column; }
.overview-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}
.overview-label { font-size: 0.75rem; color: var(--text-muted); }

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

.view-script-btn:hover { transform: translateY(-1px); }
.view-script-btn svg { width: 18px; height: 18px; }

/* Script View */
.script-view {
  flex: 1;
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Jump Navigation */
.jump-nav {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-subtle);
}

.jump-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.jump-group label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
}

.jump-group select {
  padding: 0.375rem 0.75rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8125rem;
  cursor: pointer;
}

.jump-group select:focus {
  outline: none;
  border-color: var(--gold);
}

.jump-progress {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: var(--bg-elevated);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--gold);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: var(--text-muted);
  min-width: 32px;
}

/* Virtual List Container */
.virtual-list-container {
  flex: 1;
  height: 0; /* Critical: forces flex item to respect overflow */
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 100px;
}

/* Script Rows */
.script-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background 0.15s ease;
}

.script-row:hover:not(.round-header) {
  background: rgba(255, 255, 255, 0.03);
}

.script-row.has-audio:hover {
  background: rgba(212, 168, 83, 0.08);
}

.script-row.playing {
  background: linear-gradient(90deg, rgba(212, 168, 83, 0.15), rgba(212, 168, 83, 0.05));
  border-left: 3px solid var(--gold);
  padding-left: calc(1rem - 3px);
}

/* Round Header */
.script-row.round-header {
  background: var(--bg-elevated);
  cursor: default;
  padding: 0.5rem 1rem;
  gap: 0.75rem;
}

.round-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  font-weight: 700;
  color: var(--gold);
  background: var(--gold-glow);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.round-lego-id {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
}

.round-seed-id {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.15);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
}

.round-reviews {
  flex: 1;
  text-align: right;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.5625rem;
  color: var(--text-muted);
}

/* Item Elements */
.item-play {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-muted);
}

.item-play .play-icon { width: 10px; height: 10px; opacity: 0; }
.script-row:hover .item-play .play-icon { opacity: 0.6; }
.script-row.has-audio:hover .item-play .play-icon { opacity: 1; color: var(--gold); }
.item-play .playing-icon { width: 14px; height: 14px; color: var(--gold); }
.item-play .no-audio { font-size: 0.75rem; opacity: 0.3; }

.item-type {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.5rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  min-width: 48px;
  text-align: center;
  flex-shrink: 0;
}

.item-type.intro { background: rgba(139, 92, 246, 0.2); color: #a78bfa; }
.item-type.debut { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
.item-type.debut_phrase { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
.item-type.spaced_rep { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
.item-type.consolidation { background: rgba(236, 72, 153, 0.2); color: #f472b6; }

.item-known {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 35%;
}

.item-arrow {
  font-size: 0.625rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.item-target {
  flex: 1;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.script-row.playing .item-target {
  color: var(--gold);
}

.item-fib {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.5rem;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.05);
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
}

/* Global Stop Button */
.global-stop-btn {
  position: fixed;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  right: 24px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  background: #dc2626;
  border: none;
  border-radius: 50px;
  color: white;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(220, 38, 38, 0.5);
  animation: pulse-stop 2s ease-in-out infinite;
}

.global-stop-btn:hover { background: #b91c1c; transform: scale(1.05); }
.global-stop-btn:active { transform: scale(0.95); }
.global-stop-btn svg { width: 20px; height: 20px; }

@keyframes pulse-stop {
  0%, 100% { box-shadow: 0 4px 20px rgba(220, 38, 38, 0.5); }
  50% { box-shadow: 0 4px 30px rgba(220, 38, 38, 0.8); }
}

/* Responsive */
@media (max-width: 480px) {
  .stats-bar { gap: 0.75rem; padding: 0.5rem 1rem; }
  .stat-value { font-size: 0.875rem; }
  .tabs { padding: 0.5rem 1rem; }
  .tab { padding: 0.625rem 0.5rem; font-size: 0.75rem; }
  .jump-nav { flex-wrap: wrap; gap: 0.5rem; }
  .jump-group select { padding: 0.25rem 0.5rem; font-size: 0.75rem; }
  .item-known { max-width: 25%; }
  .item-type { min-width: 40px; font-size: 0.4375rem; }
}
</style>
