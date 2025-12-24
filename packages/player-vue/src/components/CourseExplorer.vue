<script setup>
import { ref, computed, inject, onMounted, onUnmounted, nextTick } from 'vue'
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

// Course content
const rounds = ref([])
const totalSeeds = ref(0)
const totalLegos = ref(0)        // Total LEGOs in course (from DB)
const loadedLegos = ref(0)       // LEGOs loaded in current script preview
const totalCycles = ref(0)       // Cycles in current script preview
const LEGOS_PER_PAGE = 50        // How many LEGOs to load at a time
const currentPage = ref(0)       // Current pagination page (0-indexed)
const isLoadingMore = ref(false) // Loading state for pagination
const scriptLoaded = ref(false)  // Has script been loaded yet?
const isLoadingScript = ref(false) // Loading state for script tab

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
const hasMoreLegos = computed(() => (currentPage.value + 1) * LEGOS_PER_PAGE < totalLegos.value)
const hasPreviousPage = computed(() => currentPage.value > 0)
const pageStart = computed(() => currentPage.value * LEGOS_PER_PAGE + 1)
const pageEnd = computed(() => Math.min((currentPage.value + 1) * LEGOS_PER_PAGE, totalLegos.value))

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

// FAST: Load just summary stats (seed count, LEGO count) - called on mount
const loadSummary = async () => {
  console.log('[CourseExplorer] loadSummary called (FAST)')

  if (!supabase?.value) {
    console.log('[CourseExplorer] No supabase, using demo mode')
    totalSeeds.value = 10
    totalLegos.value = 10
    isLoading.value = false
    return
  }

  const courseId = props.course?.course_code || 'demo'
  currentCourseId.value = courseId

  try {
    // Run both count queries in parallel - FAST
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
    console.log('[CourseExplorer] Summary loaded: ', totalSeeds.value, 'seeds,', totalLegos.value, 'LEGOs')
  } catch (err) {
    console.warn('[CourseExplorer] Summary load error:', err)
  } finally {
    isLoading.value = false
  }
}

// DEFERRED: Load script and audio (only when Script tab is opened)
const loadScript = async (forceRefresh = false) => {
  console.log('[CourseExplorer] loadScript called, forceRefresh:', forceRefresh)

  // Skip if already loaded and not forcing refresh
  if (scriptLoaded.value && !forceRefresh) {
    console.log('[CourseExplorer] Script already loaded, skipping')
    return
  }

  if (!courseDataProvider?.value) {
    // Demo mode
    rounds.value = createDemoRounds()
    loadedLegos.value = 10
    totalCycles.value = 50
    scriptLoaded.value = true
    return
  }

  const courseId = props.course?.course_code || 'demo'

  // Try cache first (unless forcing refresh)
  if (!forceRefresh) {
    try {
      const cached = await getCachedScript(courseId)
      if (cached) {
        console.log('[CourseExplorer] Using cached script from', new Date(cached.cachedAt).toLocaleString())
        rounds.value = cached.rounds
        loadedLegos.value = cached.loadedLegos || cached.rounds?.length || 0
        totalCycles.value = cached.totalCycles
        audioMap.value = new Map(Object.entries(cached.audioMapObj || {}))
        loadedFromCache.value = true
        cachedAt.value = cached.cachedAt
        scriptLoaded.value = true
        isLoadingScript.value = false
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

    // Generate learning script for first N LEGOs
    console.log('[CourseExplorer] Generating script for:', courseId)
    const script = await generateLearningScript(
      courseDataProvider.value,
      supabase.value,
      courseId,
      audioBaseUrl,
      LEGOS_PER_PAGE
    )
    console.log('[CourseExplorer] Script generated:', script?.rounds?.length, 'rounds')

    rounds.value = script.rounds
    loadedLegos.value = script.rounds.length
    totalCycles.value = script.allItems.length

    // Load intro audio for first few rounds only (rest loads lazily)
    const legoIds = new Set()
    const PRELOAD_ROUNDS = 5
    for (let i = 0; i < Math.min(PRELOAD_ROUNDS, script.rounds.length); i++) {
      for (const item of script.rounds[i].items) {
        if (item.type === 'intro' && item.legoId) {
          legoIds.add(item.legoId)
        }
      }
    }
    await loadIntroAudio(courseId, legoIds)
    console.log('[CourseExplorer] Preloaded intro audio for first', PRELOAD_ROUNDS, 'rounds')

    // Load remaining intro audio in background (non-blocking)
    const remainingLegoIds = new Set()
    for (let i = PRELOAD_ROUNDS; i < script.rounds.length; i++) {
      for (const item of script.rounds[i].items) {
        if (item.type === 'intro' && item.legoId) {
          remainingLegoIds.add(item.legoId)
        }
      }
    }
    if (remainingLegoIds.size > 0) {
      loadIntroAudio(courseId, remainingLegoIds).then(() => {
        console.log('[CourseExplorer] Background loaded remaining intro audio')
      })
    }

    scriptLoaded.value = true

    // Cache the script structure (audio map is minimal now - just intros)
    // Target/source audio will be cached as it's lazily loaded
    console.log('[CourseExplorer] Converting audioMap to object...')
    const audioMapObj = Object.fromEntries(audioMap.value)
    console.log('[CourseExplorer] audioMapObj keys:', Object.keys(audioMapObj).length, '(intros only, rest loads lazily)')
    try {
      console.log('[CourseExplorer] Serializing rounds...')
      const serializableRounds = JSON.parse(JSON.stringify(script.rounds))
      console.log('[CourseExplorer] Caching to localStorage...')

      // Extract course welcome UUID from course metadata
      // The 'welcome' field is just a UUID string, convert to object format for cache
      let welcomeUuid = props.course?.welcome || null

      // Fallback: fetch welcome directly from database if not in props
      if (!welcomeUuid && supabase?.value && courseId) {
        console.log('[CourseExplorer] Welcome not in props, fetching from database...')
        try {
          const { data: courseData } = await supabase.value
            .from('courses')
            .select('welcome')
            .eq('course_code', courseId)
            .single()
          welcomeUuid = courseData?.welcome || null
          console.log('[CourseExplorer] Fetched welcome from database:', welcomeUuid)
        } catch (e) {
          console.warn('[CourseExplorer] Could not fetch welcome from database:', e)
        }
      }

      const courseWelcome = welcomeUuid ? { id: welcomeUuid } : null
      console.log('[CourseExplorer] Including course welcome:', welcomeUuid)

      await setCachedScript(courseId, {
        rounds: serializableRounds,
        totalSeeds: totalSeeds.value,
        totalLegos: totalLegos.value,
        loadedLegos: loadedLegos.value,
        totalCycles: totalCycles.value,
        audioMapObj,
        courseWelcome
      })
      console.log('[CourseExplorer] Cache write completed')
    } catch (cacheErr) {
      console.warn('[CourseExplorer] Could not cache data:', cacheErr)
      // Continue without caching - data is still loaded in memory
    }

    loadedFromCache.value = false
    cachedAt.value = Date.now()

    console.log('[CourseExplorer] Loaded', script.rounds.length, 'rounds,', script.allItems.length, 'total cycles')
  } catch (err) {
    console.error('[CourseExplorer] Script load error:', err)
    error.value = 'Failed to load script'
  } finally {
    isLoadingScript.value = false
    isRefreshing.value = false
  }
}

// Switch to script view (triggers load if needed)
const switchToScript = () => {
  view.value = 'script'
  if (!scriptLoaded.value) {
    loadScript()
  }
}

// Force refresh from database
const refreshContent = () => {
  currentPage.value = 0
  scriptLoaded.value = false
  loadScript(true)
}

// Load a specific page of LEGOs
const loadPage = async (page) => {
  if (!courseDataProvider?.value || !supabase?.value) return

  const courseId = props.course?.course_code || 'demo'
  const offset = page * LEGOS_PER_PAGE

  console.log('[CourseExplorer] Loading page', page, 'offset', offset)
  isLoadingMore.value = true

  try {
    // Stop any current playback
    stopPlayback()

    const script = await generateLearningScript(
      courseDataProvider.value,
      supabase.value,
      courseId,
      audioBaseUrl,
      LEGOS_PER_PAGE,
      offset
    )

    rounds.value = script.rounds
    loadedLegos.value = script.rounds.length
    totalCycles.value = script.allItems.length
    currentPage.value = page

    // Load intro audio for new LEGOs
    const legoIds = new Set()
    for (const item of script.allItems) {
      if (item.type === 'intro' && item.legoId) {
        legoIds.add(item.legoId)
      }
    }
    await loadIntroAudio(courseId, legoIds)

    console.log('[CourseExplorer] Loaded page', page, 'with', script.rounds.length, 'rounds')
  } catch (err) {
    console.error('[CourseExplorer] Error loading page:', err)
  } finally {
    isLoadingMore.value = false
  }
}

// Pagination controls
const nextPage = () => {
  if (hasMoreLegos.value) {
    loadPage(currentPage.value + 1)
  }
}

const previousPage = () => {
  if (hasPreviousPage.value) {
    loadPage(currentPage.value - 1)
  }
}

// Store current course ID for lazy lookups
const currentCourseId = ref('')

// ============================================================================
// LAZY AUDIO LOADING - Look up audio on-demand instead of pre-loading all
// ============================================================================

// Lookup audio for a single text on-demand (cache-first)
const lookupAudioLazy = async (text, role, isKnown = false) => {
  if (!supabase?.value || !currentCourseId.value) return null

  // Check cache first
  const cached = audioMap.value.get(text)
  if (cached?.[role]) {
    return cached[role]
  }

  // Query the v12 chain: texts → audio_files → course_audio
  try {
    const { data: textsData } = await supabase.value
      .from('texts')
      .select('id')
      .eq('content', text)
      .limit(1)

    if (!textsData || textsData.length === 0) return null

    const textId = textsData[0].id

    const { data: audioData } = await supabase.value
      .from('audio_files')
      .select('id')
      .eq('text_id', textId)

    if (!audioData || audioData.length === 0) return null

    const audioIds = audioData.map(a => a.id)

    // For known/source audio, look for 'known' role; for target, look for target1/target2
    const targetRole = isKnown ? 'known' : role

    const { data: courseAudio } = await supabase.value
      .from('course_audio')
      .select('audio_id, role')
      .eq('course_code', currentCourseId.value)
      .in('audio_id', audioIds)

    // Find matching role
    for (const ca of (courseAudio || [])) {
      const matchRole = isKnown ? 'known' : role
      if (ca.role === matchRole) {
        // Cache the result
        if (!audioMap.value.has(text)) {
          audioMap.value.set(text, {})
        }
        // Store with the role key
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

// Async get audio URL - uses lazy lookup on cache miss
const getAudioUrlAsync = async (text, role, item = null) => {
  // For INTRO items, look up by lego_id in lego_introductions
  if (role === 'intro' && item?.legoId) {
    const introEntry = audioMap.value.get(`intro:${item.legoId}`)
    if (introEntry?.intro) {
      return `${audioBaseUrl}/${introEntry.intro.toUpperCase()}.mp3`
    }
    return null
  }

  // Check cache first
  const audioEntry = audioMap.value.get(text)
  let uuid = audioEntry?.[role]

  // Lazy load if not in cache
  if (!uuid) {
    const isKnown = role === 'known'
    uuid = await lookupAudioLazy(text, role, isKnown)
  }

  if (!uuid) return null

  return `${audioBaseUrl}/${uuid.toUpperCase()}.mp3`
}

// Load only intro audio (fast) - skip target/known which are loaded lazily
// Tries v12 schema (course_audio with role='presentation') first, falls back to legacy lego_introductions
const loadIntroAudio = async (courseId, legoIds) => {
  if (!supabase?.value || legoIds.size === 0) return

  console.log('[CourseExplorer] Loading intro audio for', legoIds.size, 'LEGOs')

  // Try v12 schema first: course_audio with role='presentation'
  // context field contains the lego_id (e.g., 'S0001L01')
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
    console.log('[CourseExplorer] Found', v12Data.length, 'intro audio entries (v12 schema)')
    return
  }

  // Fall back to legacy lego_introductions table
  const { data: introData, error: introError } = await supabase.value
    .from('lego_introductions')
    .select('lego_id, audio_uuid, course_code')
    .eq('course_code', courseId)
    .in('lego_id', [...legoIds])

  if (introError) {
    console.warn('[CourseExplorer] Could not query lego_introductions:', introError)
    return
  }

  console.log('[CourseExplorer] Found', introData?.length || 0, 'intro audio entries (legacy)')

  for (const intro of (introData || [])) {
    audioMap.value.set(`intro:${intro.lego_id}`, { intro: intro.audio_uuid })
  }
}

// Build audio map by querying texts + audio_files tables (correct schema v12)
// DO NOT use audio_samples table - it's legacy with 145k embedded text records
// NOTE: This is now only used for cache restoration - new loads use lazy loading
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
  console.log('[CourseExplorer] V12 lookup: checking', targetTextsArray.length, 'target texts')
  console.log('[CourseExplorer] V12 lookup: sample texts:', targetTextsArray.slice(0, 3))

  for (let i = 0; i < targetTextsArray.length; i += 100) {
    const batch = targetTextsArray.slice(i, i + 100)

    // Step 1: Get text IDs for this batch
    const { data: textsData, error: textsError } = await supabase.value
      .from('texts')
      .select('id, content')
      .in('content', batch)

    if (i === 0) {
      console.log('[CourseExplorer] V12 step 1: textsData count:', textsData?.length || 0, 'error:', textsError?.message || 'none')
      if (textsData?.length > 0) console.log('[CourseExplorer] V12 step 1: sample:', textsData[0])
    }

    if (textsError || !textsData || textsData.length === 0) {
      continue // Will fall back to legacy
    }

    // Don't set foundInV12 yet - wait to see if we actually find audio
    const textIdToTarget = new Map()
    const textIds = []
    for (const t of textsData) {
      textIdToTarget.set(t.id, t.content)
      textIds.push(t.id)
    }

    // Step 2: Get audio files for these texts
    const { data: audioFilesData, error: afError } = await supabase.value
      .from('audio_files')
      .select('id, text_id')
      .in('text_id', textIds)

    if (i === 0) {
      console.log('[CourseExplorer] V12 step 2: audioFilesData count:', audioFilesData?.length || 0, 'error:', afError?.message || 'none')
    }

    if (!audioFilesData || audioFilesData.length === 0) continue

    const audioIdToTextId = new Map()
    const audioIds = []
    for (const af of audioFilesData) {
      audioIdToTextId.set(af.id, af.text_id)
      audioIds.push(af.id)
    }

    // Step 3: Get course_audio entries with roles
    const { data: courseAudioData, error: caError } = await supabase.value
      .from('course_audio')
      .select('audio_id, role')
      .eq('course_code', courseId)
      .in('audio_id', audioIds)

    if (i === 0) {
      console.log('[CourseExplorer] V12 step 3: courseAudioData count:', courseAudioData?.length || 0, 'error:', caError?.message || 'none')
    }

    for (const row of (courseAudioData || [])) {
      const textId = audioIdToTextId.get(row.audio_id)
      const targetText = textIdToTarget.get(textId)
      if (!targetText) continue

      if (!map.has(targetText)) {
        map.set(targetText, {})
      }
      if (row.role) {
        map.get(targetText)[row.role] = row.audio_id
        foundInV12 = true // Only set when we actually find audio
      }
    }
  }

  // Also lookup source/known audio (for prompts)
  console.log('[CourseExplorer] V12 lookup: checking', knownTextsArray.length, 'known/source texts')
  for (let i = 0; i < knownTextsArray.length; i += 100) {
    const batch = knownTextsArray.slice(i, i + 100)

    const { data: textsData, error: textsError } = await supabase.value
      .from('texts')
      .select('id, content')
      .in('content', batch)

    if (textsError || !textsData || textsData.length === 0) continue

    const textIdToKnown = new Map()
    const textIds = []
    for (const t of textsData) {
      textIdToKnown.set(t.id, t.content)
      textIds.push(t.id)
    }

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

    const { data: courseAudioData } = await supabase.value
      .from('course_audio')
      .select('audio_id, role')
      .eq('course_code', courseId)
      .in('audio_id', audioIds)

    for (const row of (courseAudioData || [])) {
      if (row.role !== 'known') continue // Known audio for prompts
      const textId = audioIdToTextId.get(row.audio_id)
      const knownText = textIdToKnown.get(textId)
      if (!knownText) continue

      if (!map.has(knownText)) {
        map.set(knownText, {})
      }
      map.get(knownText).known = row.audio_id // Store with 'known' role
      foundInV12 = true
    }
  }

  if (!foundInV12) {
    console.warn('[CourseExplorer] V12 schema returned no audio - check RLS policies on texts/audio_files/course_audio tables')
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
      return `${audioBaseUrl}/${introEntry.intro.toUpperCase()}.mp3`
    }
    return null
  }

  // Look up by text
  const audioEntry = audioMap.value.get(text)
  if (!audioEntry) return null

  const uuid = audioEntry[role]
  if (!uuid) return null

  // Always use the public ssi-audio-stage bucket with mastered/ prefix
  // S3 keys are lowercase, DB may store uppercase UUIDs
  return `${audioBaseUrl}/${uuid.toUpperCase()}.mp3`
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
        // Intro audio is pre-loaded, use sync lookup
        promptUrl = getAudioUrl(null, 'intro', item)
        if (promptUrl) {
          console.log('[CourseExplorer] Playing intro audio for LEGO:', item.legoId, '→', promptUrl)
        } else {
          console.warn('[CourseExplorer] NO intro audio found for LEGO:', item.legoId)
          const introKey = `intro:${item.legoId}`
          console.log('[CourseExplorer] Looked for key:', introKey, 'audioMap has:', audioMap.value.has(introKey))
        }
      } else {
        // Known language audio uses lazy loading
        promptUrl = await getAudioUrlAsync(item.knownText, 'known', item)
        if (myCycleId !== cycleId) return // Check after async
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
      // Play target1 audio (lazy load)
      const voice1Url = await getAudioUrlAsync(item.targetText, 'target1', item)
      if (myCycleId !== cycleId) return // Check after async
      console.log('[CourseExplorer] Voice1 URL for "' + item.targetText + '":', voice1Url)
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
      console.warn('[CourseExplorer] No voice1 audio available for:', item.targetText)
      stopPlayback()
      break
    }

    case 'voice2': {
      // Play target2 audio (lazy load)
      const voice2Url = await getAudioUrlAsync(item.targetText, 'target2', item)
      if (myCycleId !== cycleId) return // Check after async
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
  console.log('[CourseExplorer] === VERSION 2024-12-24-A === Component mounted')
  // FAST: Only load summary stats on mount (seeds + LEGOs count)
  // Script is loaded lazily when user switches to Script tab
  loadSummary()
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
        <span class="stat-value">{{ loadedLegos }}/{{ totalLegos }}</span>
        <span class="stat-label">Loaded</span>
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
        @click="switchToScript"
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
            <div class="overview-icon cycles"></div>
            <div class="overview-info">
              <span class="overview-value">{{ totalCycles }}</span>
              <span class="overview-label">Cycles (loaded)</span>
            </div>
          </div>
        </div>
      </div>

      <div class="summary-card">
        <h2>Learning Script</h2>
        <p class="preview-hint">View the complete learning journey with all cycles. Click any phrase to play its audio.</p>
        <button class="view-script-btn" @click="switchToScript">
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
      <!-- Loading state for script -->
      <div v-if="isLoadingScript" class="script-loading">
        <div class="loading-spinner"></div>
        <p>Loading script...</p>
      </div>

      <div v-else class="script-content">
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

        <!-- Pagination Controls -->
        <div class="pagination-bar">
          <button
            class="pagination-btn"
            :disabled="!hasPreviousPage || isLoadingMore"
            @click="previousPage"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
            Previous 50
          </button>

          <span class="pagination-info">
            <span v-if="isLoadingMore" class="loading-dots">Loading...</span>
            <span v-else>LEGOs {{ pageStart }}–{{ pageEnd }} of {{ totalLegos }}</span>
          </span>

          <button
            class="pagination-btn"
            :disabled="!hasMoreLegos || isLoadingMore"
            @click="nextPage"
          >
            Next 50
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Global floating stop button - always visible when playing -->
    <button
      v-if="isPlaying"
      class="global-stop-btn"
      @click.stop.prevent="stopPlayback"
      @touchend.stop.prevent="stopPlayback"
    >
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

.script-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  gap: 1rem;
  color: var(--text-secondary);
}

.script-loading p {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.875rem;
}

/* Pagination Controls */
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.5rem 1rem;
  margin-top: 1rem;
  background: var(--bg-elevated);
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
}

.pagination-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: var(--text-primary);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pagination-btn:hover:not(:disabled) {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
}

.pagination-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pagination-btn svg {
  width: 16px;
  height: 16px;
}

.pagination-info {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  color: var(--text-secondary);
  text-align: center;
}

.loading-dots {
  animation: pulse 1.5s ease-in-out infinite;
}

/* Global floating stop button */
.global-stop-btn {
  position: fixed;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  right: 24px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  background: #dc2626; /* Bright red */
  border: none;
  border-radius: 50px;
  color: white;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(220, 38, 38, 0.5);
  pointer-events: auto;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  animation: pulse-stop 2s ease-in-out infinite;
}

.global-stop-btn:hover {
  background: #b91c1c;
  transform: scale(1.05);
}

.global-stop-btn:active {
  transform: scale(0.95);
}

.global-stop-btn svg {
  width: 20px;
  height: 20px;
}

@keyframes pulse-stop {
  0%, 100% { box-shadow: 0 4px 20px rgba(220, 38, 38, 0.5); }
  50% { box-shadow: 0 4px 30px rgba(220, 38, 38, 0.8); }
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
