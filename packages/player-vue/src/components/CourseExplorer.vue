<script setup>
import { ref, computed, inject, onMounted, onUnmounted, nextTick } from 'vue'
import { CyclePhase } from '@ssi/core'
import { generateLearningScript } from '../providers/CourseDataProvider'

// ============================================================================
// IndexedDB Cache for Script Data
// ============================================================================
const DB_NAME = 'ssi-script-cache'
const DB_VERSION = 2  // Bumped to force cache refresh after audio schema change (texts+audio_files)
const STORE_NAME = 'scripts'

let dbInstance = null

const openDB = () => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance)
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'courseCode' })
      }
    }
  })
}

const getCachedScript = async (courseCode) => {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(courseCode)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || null)
    })
  } catch (err) {
    console.warn('[Cache] Could not read cache:', err)
    return null
  }
}

const setCachedScript = async (courseCode, data) => {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.put({
        courseCode,
        ...data,
        cachedAt: Date.now()
      })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (err) {
    console.warn('[Cache] Could not write cache:', err)
  }
}

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

// Course content
const rounds = ref([])
const totalSeeds = ref(0)
const totalLegos = ref(0)
const totalCycles = ref(0)
const estimatedMinutes = ref(0)

// Audio map for resolving text -> audio UUIDs
const audioMap = ref(new Map())
const audioBaseUrl = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered'

// Playback state - 4-phase cycle: prompt → pause → voice1 → voice2
// Uses cycle ID system for proper cancellation - each new playback increments the ID
// All async operations check their cycle ID is still current before proceeding
const isPlaying = ref(false)
const currentRoundIndex = ref(-1)
const currentItemIndex = ref(-1)
const currentPhase = ref('idle') // 'idle' | 'prompt' | 'pause' | 'voice1' | 'voice2'
const audioController = ref(null)
let cycleId = 0 // Increments on each new playback to invalidate old operations
let pendingTimers = [] // Track all timers for cleanup

// Scroll container ref
const scriptContainer = ref(null)

// Computed
const courseName = computed(() => props.course?.display_name || props.course?.title || 'Course')
const courseCode = computed(() => props.course?.course_code || '')
const estimatedHours = computed(() => Math.round(estimatedMinutes.value / 60 * 10) / 10)

// Get the currently playing item
const currentPlayingItem = computed(() => {
  if (currentRoundIndex.value >= 0 && currentItemIndex.value >= 0) {
    const round = rounds.value[currentRoundIndex.value]
    if (round && round.items[currentItemIndex.value]) {
      return {
        round: round,
        item: round.items[currentItemIndex.value],
        roundIndex: currentRoundIndex.value,
        itemIndex: currentItemIndex.value
      }
    }
  }
  return null
})

// Phase display info
const phaseLabel = computed(() => {
  switch (currentPhase.value) {
    case 'prompt': return 'PROMPT'
    case 'pause': return 'YOUR TURN'
    case 'voice1': return 'VOICE 1'
    case 'voice2': return 'VOICE 2'
    default: return ''
  }
})

// Load course content (with cache-first strategy)
const loadContent = async (forceRefresh = false) => {
  if (!courseDataProvider?.value) {
    // Demo mode - create sample rounds
    rounds.value = createDemoRounds()
    totalSeeds.value = 10
    totalLegos.value = 10
    totalCycles.value = 50
    estimatedMinutes.value = 10
    isLoading.value = false
    return
  }

  const courseId = props.course?.course_code || 'demo'

  // Try cache first (unless forcing refresh)
  if (!forceRefresh) {
    try {
      const cached = await getCachedScript(courseId)
      if (cached) {
        console.log('[CourseExplorer] Using cached data from', new Date(cached.cachedAt).toLocaleString())
        rounds.value = cached.rounds
        totalSeeds.value = cached.totalSeeds
        totalLegos.value = cached.totalLegos
        totalCycles.value = cached.totalCycles
        estimatedMinutes.value = cached.estimatedMinutes
        // Restore audio map from cached object
        audioMap.value = new Map(Object.entries(cached.audioMapObj || {}))
        loadedFromCache.value = true
        cachedAt.value = cached.cachedAt
        isLoading.value = false
        return
      }
    } catch (err) {
      console.warn('[CourseExplorer] Cache read failed:', err)
    }
  }

  try {
    // Show appropriate loading state
    if (forceRefresh) {
      isRefreshing.value = true
    } else {
      isLoading.value = true
    }
    error.value = null

    // Get total seed count first
    const { data: seedData, error: seedError } = await supabase.value
      .from('course_seeds')
      .select('seed_number', { count: 'exact' })
      .eq('course_code', courseId)

    if (seedError) {
      console.warn('[CourseExplorer] Could not get seed count:', seedError)
    }

    totalSeeds.value = seedData?.length || 0

    // Generate the full learning script with ROUNDs and spaced repetition
    const script = await generateLearningScript(
      courseDataProvider.value,
      supabase.value,
      courseId,
      audioBaseUrl,
      50 // Limit to first 50 LEGOs for preview
    )

    rounds.value = script.rounds
    totalLegos.value = script.rounds.length
    totalCycles.value = script.allItems.length

    // Build audio map from script items
    await buildAudioMap(courseId, script.allItems)

    // Estimate duration (avg 11 sec per cycle)
    estimatedMinutes.value = Math.round((script.allItems.length * 11) / 60)

    // Cache the results (convert Map to Object for storage)
    // Deep clone via JSON to ensure all data is serializable for IndexedDB
    const audioMapObj = Object.fromEntries(audioMap.value)
    try {
      const serializableRounds = JSON.parse(JSON.stringify(script.rounds))
      await setCachedScript(courseId, {
        rounds: serializableRounds,
        totalSeeds: totalSeeds.value,
        totalLegos: totalLegos.value,
        totalCycles: totalCycles.value,
        estimatedMinutes: estimatedMinutes.value,
        audioMapObj
      })
    } catch (cacheErr) {
      console.warn('[CourseExplorer] Could not cache data:', cacheErr)
      // Continue without caching - data is still loaded in memory
    }

    loadedFromCache.value = false
    cachedAt.value = Date.now()

    console.log('[CourseExplorer] Loaded', script.rounds.length, 'rounds,', script.allItems.length, 'total cycles (fresh)')
  } catch (err) {
    console.error('[CourseExplorer] Load error:', err)
    error.value = 'Failed to load course content'
  } finally {
    isLoading.value = false
    isRefreshing.value = false
  }
}

// Force refresh from database
const refreshContent = () => {
  loadContent(true)
}

// Build audio map by querying texts + audio_files tables (correct schema v12)
// DO NOT use audio_samples table - it's legacy with 145k embedded text records
const buildAudioMap = async (courseId, items) => {
  console.log('[CourseExplorer] Building audio map for courseId:', courseId)
  if (!supabase?.value) return

  // Collect unique texts (both known and target) and LEGO IDs for intro audio
  const uniqueTargetTexts = new Set()
  const uniqueKnownTexts = new Set()
  const legoIds = new Set()

  for (const item of items) {
    if (item.targetText) {
      uniqueTargetTexts.add(item.targetText)
    }
    if (item.knownText) {
      uniqueKnownTexts.add(item.knownText)
    }
    if (item.type === 'intro' && item.legoId) {
      legoIds.add(item.legoId)
    }
  }

  console.log('[CourseExplorer] Building audio map for', uniqueTargetTexts.size, 'target texts,', uniqueKnownTexts.size, 'known texts,', legoIds.size, 'LEGOs')

  const map = new Map()
  const targetTextsArray = [...uniqueTargetTexts]
  const knownTextsArray = [...uniqueKnownTexts]
  let foundInV12 = false

  // Try v12 schema first (texts + audio_files + course_audio)
  // Batch in chunks of 100 to avoid query limits
  for (let i = 0; i < targetTextsArray.length; i += 100) {
    const batch = targetTextsArray.slice(i, i + 100)

    // Step 1: Get text IDs for this batch
    const { data: textsData, error: textsError } = await supabase.value
      .from('texts')
      .select('id, content')
      .in('content', batch)

    if (textsError || !textsData || textsData.length === 0) {
      continue // Will fall back to legacy
    }

    foundInV12 = true
    const textIdToTarget = new Map()
    const textIds = []
    for (const t of textsData) {
      textIdToTarget.set(t.id, t.content)
      textIds.push(t.id)
    }

    // Step 2: Get audio files for these texts
    const { data: audioFilesData } = await supabase.value
      .from('audio_files')
      .select('id, text_id')
      .in('text_id', textIds)

    if (!audioFilesData || audioFilesData.length === 0) continue

    const audioIdToTextId = new Map()
    const audioIds = []
    for (const af of audioFilesData) {
      audioIdToTextId.set(af.id, af.text_id)
      audioIds.push(af.id)
    }

    // Step 3: Get course_audio entries with roles
    const { data: courseAudioData } = await supabase.value
      .from('course_audio')
      .select('audio_id, role')
      .eq('course_code', courseId)
      .in('audio_id', audioIds)

    for (const row of (courseAudioData || [])) {
      const textId = audioIdToTextId.get(row.audio_id)
      const targetText = textIdToTarget.get(textId)
      if (!targetText) continue

      if (!map.has(targetText)) {
        map.set(targetText, {})
      }
      if (row.role) {
        map.get(targetText)[row.role] = row.audio_id
      }
    }
  }

  // Fallback to legacy audio_samples table if v12 schema has no data
  if (!foundInV12) {
    console.log('[CourseExplorer] V12 schema empty, falling back to legacy audio_samples table')

    // Query for target audio (target1, target2)
    for (let i = 0; i < targetTextsArray.length; i += 100) {
      const batch = targetTextsArray.slice(i, i + 100)

      const { data: audioData, error: audioError } = await supabase.value
        .from('audio_samples')
        .select('uuid, text, role, s3_key, s3_bucket')
        .in('text', batch)
        .in('role', ['target1', 'target2'])

      if (audioError) {
        console.warn('[CourseExplorer] Could not query audio_samples:', audioError)
        continue
      }

      // Debug: log first sample to see the actual format
      if (audioData?.length > 0 && i === 0) {
        console.log('[CourseExplorer] Sample audio_samples entry:', audioData[0])
      }

      for (const row of (audioData || [])) {
        if (!map.has(row.text)) {
          map.set(row.text, {})
        }
        if (!map.get(row.text)[row.role]) {
          // Store both uuid and s3_key info
          map.get(row.text)[row.role] = row.uuid
          // Store s3_key if available for debugging
          if (row.s3_key) {
            map.get(row.text)[`${row.role}_s3_key`] = row.s3_key
          }
          if (row.s3_bucket) {
            map.get(row.text)[`${row.role}_bucket`] = row.s3_bucket
          }
        }
      }
    }

    // Query for source/known audio (prompt)
    for (let i = 0; i < knownTextsArray.length; i += 100) {
      const batch = knownTextsArray.slice(i, i + 100)

      const { data: audioData, error: audioError } = await supabase.value
        .from('audio_samples')
        .select('uuid, text, role, s3_key, s3_bucket')
        .in('text', batch)
        .eq('role', 'source')

      if (audioError) {
        console.warn('[CourseExplorer] Could not query source audio:', audioError)
        continue
      }

      for (const row of (audioData || [])) {
        if (!map.has(row.text)) {
          map.set(row.text, {})
        }
        if (!map.get(row.text).source) {
          map.get(row.text).source = row.uuid
          if (row.s3_key) {
            map.get(row.text).source_s3_key = row.s3_key
          }
          if (row.s3_bucket) {
            map.get(row.text).source_bucket = row.s3_bucket
          }
        }
      }
    }

    console.log('[CourseExplorer] Legacy fallback found', map.size, 'texts with audio')
  }

  // 2. Query lego_introductions for INTRO audio - MUST filter by course_code!
  if (legoIds.size > 0) {
    console.log('[CourseExplorer] Looking for intro audio for course:', courseId, 'LEGOs:', [...legoIds].slice(0, 5), '...')

    const { data: introData, error: introError } = await supabase.value
      .from('lego_introductions')
      .select('lego_id, audio_uuid, course_code')
      .eq('course_code', courseId)  // CRITICAL: Filter by course!
      .in('lego_id', [...legoIds])

    if (introError) {
      console.warn('[CourseExplorer] Could not query lego_introductions:', introError)
    } else {
      console.log('[CourseExplorer] Found', introData?.length || 0, 'intro audio entries for', courseId)
      if (introData?.length > 0) {
        console.log('[CourseExplorer] Sample intro:', introData[0])
      } else {
        console.warn('[CourseExplorer] NO intro audio found for this course! Intros may not be recorded yet.')
      }

      // Store intro audio under special key format: intro:{lego_id}
      for (const intro of (introData || [])) {
        map.set(`intro:${intro.lego_id}`, { intro: intro.audio_uuid })
      }
    }
  }

  audioMap.value = map
  console.log('[CourseExplorer] Audio map built with', map.size, 'entries')
}

// Create demo rounds for testing without database
const createDemoRounds = () => {
  return [
    {
      roundNumber: 1,
      legoId: 'S0001L01',
      seedId: 'S0001',
      items: [
        { type: 'intro', knownText: 'I want', targetText: '我想' },
        { type: 'debut', knownText: 'I want', targetText: '我想' },
        { type: 'debut_phrase', knownText: 'I want to speak', targetText: '我想说' },
        { type: 'debut_phrase', knownText: 'I want to learn', targetText: '我想学' },
      ],
      spacedRepReviews: []
    },
    {
      roundNumber: 2,
      legoId: 'S0001L02',
      seedId: 'S0001',
      items: [
        { type: 'intro', knownText: 'to speak', targetText: '说' },
        { type: 'debut', knownText: 'to speak', targetText: '说' },
        { type: 'debut_phrase', knownText: 'speak Chinese', targetText: '说中文' },
        { type: 'spaced_rep', knownText: 'I want', targetText: '我想', reviewOf: 1 },
      ],
      spacedRepReviews: [1]
    },
    {
      roundNumber: 3,
      legoId: 'S0001L03',
      seedId: 'S0001',
      items: [
        { type: 'intro', knownText: 'Chinese', targetText: '中文' },
        { type: 'debut', knownText: 'Chinese', targetText: '中文' },
        { type: 'spaced_rep', knownText: 'to speak', targetText: '说', reviewOf: 2 },
        { type: 'spaced_rep', knownText: 'I want', targetText: '我想', reviewOf: 1 },
        { type: 'consolidation', knownText: 'I want to speak Chinese', targetText: '我想说中文' },
      ],
      spacedRepReviews: [1, 2]
    }
  ]
}

// Get audio URL by text and role (source, target1, target2, intro)
// Always use ssi-audio-stage bucket (public) - ignore s3_bucket from database
const getAudioUrl = (text, role, item = null) => {
  // For INTRO items, look up by lego_id in lego_introductions
  if (role === 'intro' && item?.legoId) {
    const introEntry = audioMap.value.get(`intro:${item.legoId}`)
    if (introEntry?.intro) {
      return `${audioBaseUrl}/${introEntry.intro}.mp3`
    }
    return null
  }

  // Look up by text
  const audioEntry = audioMap.value.get(text)
  if (!audioEntry) return null

  const uuid = audioEntry[role]
  if (!uuid) return null

  // Always use the public ssi-audio-stage bucket with mastered/ prefix
  return `${audioBaseUrl}/${uuid}.mp3`
}

// Check if item has audio available
// For INTRO items: check intro audio; for others: check target1
const hasAudio = (item) => {
  if (item.type === 'intro' && item.legoId) {
    return !!getAudioUrl(null, 'intro', item)
  }
  return !!getAudioUrl(item.targetText, 'target1', item)
}

// ============================================================================
// Playback controls with CYCLE ID system for proper cancellation
// ============================================================================
// Key insight: async operations can race. When user clicks a new item while
// previous cycle is still running, the old cycle's pending operations continue.
//
// Solution: Each playback gets a unique cycleId. All async operations capture
// this ID and check it's still current before proceeding. Stop/new-playback
// increments the ID to invalidate all pending operations.
// ============================================================================

// Start playback from a specific item
const playItem = async (roundIndex, itemIndex) => {
  const round = rounds.value[roundIndex]
  if (!round || !round.items[itemIndex]) return

  const item = round.items[itemIndex]

  // CRITICAL: Stop any existing playback and invalidate its operations
  cancelCurrentPlayback()

  // Start new cycle with new ID
  const myCycleId = ++cycleId
  console.log('[CourseExplorer] Starting cycle', myCycleId, 'for:', item.knownText, '→', item.targetText)

  // Update current position
  currentRoundIndex.value = roundIndex
  currentItemIndex.value = itemIndex
  isPlaying.value = true

  // Scroll to current item
  await nextTick()
  scrollToCurrentItem()

  // Initialize audio controller if needed
  if (!audioController.value) {
    audioController.value = new ScriptAudioController()
  }

  // Start the cycle - pass cycleId to all operations
  await runPhase('prompt', myCycleId)
}

// Schedule a timer and track it for cleanup
const scheduleTimer = (callback, delay) => {
  const timerId = setTimeout(() => {
    // Remove from tracking when it fires
    pendingTimers = pendingTimers.filter(id => id !== timerId)
    callback()
  }, delay)
  pendingTimers.push(timerId)
  return timerId
}

// Clear all pending timers
const clearAllTimers = () => {
  for (const timerId of pendingTimers) {
    clearTimeout(timerId)
  }
  pendingTimers = []
}

// Cancel current playback - invalidates all pending operations
const cancelCurrentPlayback = () => {
  // Clear ALL pending timers
  clearAllTimers()

  // Stop audio immediately
  if (audioController.value) {
    audioController.value.stop()
  }
}

// Run a specific phase of the cycle
// CRITICAL: myCycleId must match current cycleId or we abort
const runPhase = async (phase, myCycleId) => {
  // Check if this cycle is still valid
  if (myCycleId !== cycleId) {
    console.log('[CourseExplorer] Cycle', myCycleId, 'cancelled (current is', cycleId + ')')
    return
  }

  const round = rounds.value[currentRoundIndex.value]
  const item = round?.items[currentItemIndex.value]
  if (!item) {
    stopPlayback()
    return
  }

  currentPhase.value = phase
  console.log('[CourseExplorer] Cycle', myCycleId, 'phase:', phase)

  switch (phase) {
    case 'prompt': {
      // For INTRO items, play intro audio; otherwise play known/source audio
      let promptUrl
      if (item.type === 'intro' && item.legoId) {
        promptUrl = getAudioUrl(null, 'intro', item)
        if (promptUrl) {
          console.log('[CourseExplorer] Playing intro audio for LEGO:', item.legoId, '→', promptUrl)
        } else {
          console.warn('[CourseExplorer] NO intro audio found for LEGO:', item.legoId)
          // Check what's in the audio map for debugging
          const introKey = `intro:${item.legoId}`
          console.log('[CourseExplorer] Looked for key:', introKey, 'audioMap has:', audioMap.value.has(introKey))
        }
      } else {
        promptUrl = getAudioUrl(item.knownText, 'source', item)
      }

      if (promptUrl) {
        try {
          await audioController.value.play({ url: promptUrl })
          // Check if still valid after await
          if (myCycleId !== cycleId) return
          runPhase('pause', myCycleId)
          return
        } catch (err) {
          if (myCycleId !== cycleId) return // Cancelled
          console.warn('[CourseExplorer] Prompt audio failed, skipping to pause')
        }
      }
      // No prompt audio or it failed - go directly to pause
      if (myCycleId === cycleId) runPhase('pause', myCycleId)
      break
    }

    case 'pause': {
      // Brief pause for preview rhythm (500ms - this is QA preview, not learning)
      scheduleTimer(() => {
        // Check if still valid after timeout
        if (myCycleId === cycleId) {
          runPhase('voice1', myCycleId)
        }
      }, 500)
      break
    }

    case 'voice1': {
      // Play target1 audio
      const voice1Url = getAudioUrl(item.targetText, 'target1', item)
      if (voice1Url) {
        try {
          await audioController.value.play({ url: voice1Url })
          // Check if still valid after await
          if (myCycleId !== cycleId) return
          runPhase('voice2', myCycleId)
          return
        } catch (err) {
          if (myCycleId !== cycleId) return // Cancelled
          console.error('[CourseExplorer] Voice1 playback error:', err)
          stopPlayback()
          return
        }
      }
      // No voice1 URL - stop (this is required audio)
      console.warn('[CourseExplorer] No voice1 audio available')
      stopPlayback()
      break
    }

    case 'voice2': {
      // Play target2 audio
      const voice2Url = getAudioUrl(item.targetText, 'target2', item)
      if (voice2Url) {
        try {
          await audioController.value.play({ url: voice2Url })
          // Check if still valid after await
          if (myCycleId !== cycleId) return
          advanceToNextItem(myCycleId)
          return
        } catch (err) {
          if (myCycleId !== cycleId) return // Cancelled
          console.warn('[CourseExplorer] Voice2 playback error, finishing cycle')
        }
      }
      // No voice2 or it failed - finish cycle and advance to next item
      if (myCycleId === cycleId) advanceToNextItem(myCycleId)
      break
    }
  }
}

// Advance to the next item after cycle completes
const advanceToNextItem = (myCycleId) => {
  // Check if still valid
  if (myCycleId !== cycleId) return

  const round = rounds.value[currentRoundIndex.value]
  if (!round) {
    stopPlayback()
    return
  }

  // Try next item in same round
  if (currentItemIndex.value < round.items.length - 1) {
    const nextItemIndex = currentItemIndex.value + 1
    const nextRoundIndex = currentRoundIndex.value
    scheduleTimer(() => {
      // Check if still valid after timeout
      if (myCycleId === cycleId) {
        playItem(nextRoundIndex, nextItemIndex)
      }
    }, 500)
    return
  }

  // Try next round
  if (currentRoundIndex.value < rounds.value.length - 1) {
    const nextRoundIndex = currentRoundIndex.value + 1
    scheduleTimer(() => {
      // Check if still valid after timeout
      if (myCycleId === cycleId) {
        playItem(nextRoundIndex, 0)
      }
    }, 800)
    return
  }

  // End of content
  stopPlayback()
}

// Stop playback completely
const stopPlayback = () => {
  console.log('[CourseExplorer] ========== STOP BUTTON CLICKED ==========')
  console.log('[CourseExplorer] Current cycleId:', cycleId, 'isPlaying:', isPlaying.value)
  console.log('[CourseExplorer] Pending timers:', pendingTimers.length)

  // CRITICAL: Increment cycleId FIRST to invalidate all pending operations
  const oldCycleId = cycleId
  cycleId++
  console.log('[CourseExplorer] cycleId changed from', oldCycleId, 'to', cycleId)

  // Clear ALL pending timers
  clearAllTimers()
  console.log('[CourseExplorer] Timers cleared')

  // Stop audio
  if (audioController.value) {
    audioController.value.stop()
    console.log('[CourseExplorer] Audio stopped')
  }

  // Update state
  isPlaying.value = false
  currentPhase.value = 'idle'
  currentRoundIndex.value = -1
  currentItemIndex.value = -1
  console.log('[CourseExplorer] State reset, isPlaying now:', isPlaying.value)
}

const scrollToCurrentItem = () => {
  if (!scriptContainer.value) return
  const currentEl = scriptContainer.value.querySelector('.round-item.playing')
  if (currentEl) {
    currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

// Check if an item is currently playing
const isItemPlaying = (roundIndex, itemIndex) => {
  return isPlaying.value &&
         currentRoundIndex.value === roundIndex &&
         currentItemIndex.value === itemIndex
}

// Get debut phrase index (1-based) within the round
const getDebutPhraseIndex = (round, itemIdx) => {
  let count = 0
  for (let i = 0; i <= itemIdx; i++) {
    if (round.items[i].type === 'debut_phrase') count++
  }
  return count
}

// Check if this is an N-1 review (gets 3 phrases, needs -1, -2, -3 suffix)
const isN1Review = (round, item) => {
  return item.reviewOf === round.roundNumber - 1
}

// Get spaced rep occurrence number (e.g., 1, 2, 3 for REP #8-1, REP #8-2, REP #8-3)
// Only used for N-1 reviews which have 3 phrases
const getSpacedRepOccurrence = (round, item, currentIdx) => {
  // Count how many spaced rep items for this reviewOf came before this one
  let count = 0
  for (let i = 0; i <= currentIdx; i++) {
    const ri = round.items[i]
    if (ri.type === 'spaced_rep' && ri.reviewOf === item.reviewOf) {
      count++
    }
  }
  return count
}

// Get consolidation index (e.g., 1, 2, 3 for ETERNAL-1, ETERNAL-2)
const getConsolidationIndex = (round, currentIdx) => {
  let count = 0
  for (let i = 0; i <= currentIdx; i++) {
    if (round.items[i].type === 'consolidation') {
      count++
    }
  }
  return count
}

// Format cached date for display
const formatCachedDate = computed(() => {
  if (!cachedAt.value) return ''
  const date = new Date(cachedAt.value)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})

// Lifecycle
onMounted(() => {
  console.log('[CourseExplorer] === VERSION 2024-12-23-A === Component mounted')
  loadContent()
})

onUnmounted(() => {
  clearAllTimers()
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
        <span v-if="loadedFromCache && formatCachedDate" class="cache-indicator" :title="'Cached: ' + formatCachedDate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
          </svg>
          cached
        </span>
      </div>
      <button
        class="refresh-btn"
        @click="refreshContent"
        :disabled="isRefreshing"
        :title="loadedFromCache ? 'Refresh from database' : 'Data is fresh'"
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
        :class="{ active: view === 'script' }"
        @click="view = 'script'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>
        </svg>
        Script
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
        <h2>Learning Script</h2>
        <p class="preview-hint">View the complete learning journey with all cycles. Click any phrase to play its audio.</p>
        <button class="view-script-btn" @click="view = 'script'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <path d="M14 2v6h6"/>
          </svg>
          View Script
        </button>
      </div>
    </div>

    <!-- Script View - Unified view with clickable items -->
    <div v-else class="script-view" ref="scriptContainer">
      <div class="script-content">
        <div
          v-for="(round, roundIdx) in rounds"
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

          <!-- Round Items - Clickable -->
          <div class="round-items">
            <div
              v-for="(item, idx) in round.items"
              :key="`${round.roundNumber}-${idx}`"
              class="round-item"
              :class="[item.type, { playing: isItemPlaying(roundIdx, idx), 'has-audio': hasAudio(item) }]"
              @click="playItem(roundIdx, idx)"
            >
              <!-- Play indicator -->
              <div class="item-play-indicator">
                <svg v-if="isItemPlaying(roundIdx, idx)" class="playing-icon" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1"/>
                  <rect x="14" y="4" width="4" height="16" rx="1"/>
                </svg>
                <svg v-else-if="hasAudio(item)" class="play-icon" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                <span v-else class="no-audio">—</span>
              </div>

              <!-- Type badge -->
              <div class="item-type-badge" :class="item.type">
                <template v-if="item.type === 'intro'">INTRO</template>
                <template v-else-if="item.type === 'debut'">LEGO</template>
                <template v-else-if="item.type === 'debut_phrase'">DEBUT-{{ getDebutPhraseIndex(round, idx) }}</template>
                <template v-else-if="item.type === 'spaced_rep'">
                  REP #{{ item.reviewOf }}{{ isN1Review(round, item) ? '-' + getSpacedRepOccurrence(round, item, idx) : '' }}
                </template>
                <template v-else-if="item.type === 'consolidation'">ETERNAL-{{ getConsolidationIndex(round, idx) }}</template>
              </div>

              <!-- Text content -->
              <div class="item-text-content">
                <span class="item-known">{{ item.knownText }}</span>
                <span class="item-arrow">→</span>
                <span class="item-target">{{ item.targetText }}</span>
              </div>

              <!-- Fibonacci badge for spaced rep -->
              <div v-if="item.type === 'spaced_rep'" class="fib-badge">
                {{ item.reviewOf === round.roundNumber - 1 ? '3x' : '1x' }}
              </div>
            </div>
          </div>

          <!-- Spaced Rep Summary -->
          <div v-if="round.spacedRepReviews && round.spacedRepReviews.length > 0" class="spaced-rep-summary">
            Reviews LEGOs: {{ round.spacedRepReviews.join(', ') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Playback Bar (when playing) -->
    <Transition name="slide-up">
      <div v-if="isPlaying && currentPlayingItem" class="playback-bar" @click.stop>
        <div class="playback-phase" :class="currentPhase">
          {{ phaseLabel }}
        </div>
        <div class="playback-info">
          <span class="playback-lego">{{ currentPlayingItem.round.legoId }}</span>
          <span class="playback-text">{{ currentPlayingItem.item.targetText }}</span>
        </div>
        <button
          class="playback-stop"
          @click.stop.prevent="stopPlayback"
          @touchend.stop.prevent="stopPlayback"
          @mousedown.stop
        >
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

.cache-indicator {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.5625rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding: 0.125rem 0.375rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.cache-indicator svg {
  width: 10px;
  height: 10px;
  opacity: 0.6;
}

.refresh-btn {
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

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-elevated);
  color: var(--gold);
  border-color: var(--gold);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-btn svg {
  width: 18px;
  height: 18px;
  transition: transform 0.3s ease;
}

.refresh-btn svg.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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

.script-content {
  padding: 1rem 1rem 120px;
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
  background: var(--bg-secondary);
  backdrop-filter: blur(24px);
  border-top: 1px solid var(--border-subtle);
  /* Ensure clicks don't pass through */
  pointer-events: auto;
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
.playback-phase.voice1 { background: #3b82f620; color: #3b82f6; }
.playback-phase.voice2 { background: #8b5cf620; color: #8b5cf6; }

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
  /* Ensure button is clickable */
  position: relative;
  z-index: 10;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
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

/* Round Cards */
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
  cursor: pointer;
}

.round-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.round-item.has-audio:hover {
  background: rgba(212, 168, 83, 0.1);
  border-left: 2px solid var(--gold);
  padding-left: calc(0.625rem - 2px);
}

.round-item.playing {
  background: linear-gradient(135deg, rgba(212, 168, 83, 0.15), rgba(212, 168, 83, 0.08));
  border-left: 3px solid var(--gold);
  padding-left: calc(0.625rem - 3px);
  animation: pulse-glow 2s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(212, 168, 83, 0.2); }
  50% { box-shadow: 0 0 16px rgba(212, 168, 83, 0.4); }
}

/* Play indicator */
.item-play-indicator {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-muted);
  transition: all 0.2s ease;
}

.round-item:hover .item-play-indicator {
  color: var(--text-secondary);
}

.round-item.has-audio:hover .item-play-indicator {
  color: var(--gold);
}

.round-item.playing .item-play-indicator {
  color: var(--gold);
}

.item-play-indicator .play-icon {
  width: 12px;
  height: 12px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.round-item:hover .item-play-indicator .play-icon {
  opacity: 1;
}

.item-play-indicator .playing-icon {
  width: 14px;
  height: 14px;
  animation: bounce-play 0.6s ease-in-out infinite;
}

@keyframes bounce-play {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.item-play-indicator .no-audio {
  font-size: 0.75rem;
  opacity: 0.3;
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

.round-item.playing .item-target {
  color: var(--gold);
  font-weight: 600;
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
