<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, shallowRef, inject, nextTick } from 'vue'
import * as d3 from 'd3'
import {
  CycleOrchestrator,
  AudioController,
  CyclePhase,
  DEFAULT_CONFIG,
  createVoiceActivityDetector,
  createSpeechTimingAnalyzer,
} from '@ssi/core'
import SessionComplete from './SessionComplete.vue'
// OnboardingTooltips removed - deprecated
import ReportIssueButton from './ReportIssueButton.vue'
// AwakeningLoader removed - loading state now shown inline in player
import { useLearningSession } from '../composables/useLearningSession'
import { useScriptCache, setCachedScript } from '../composables/useScriptCache'
import { useMetaCommentary } from '../composables/useMetaCommentary'
import { useSharedBeltProgress } from '../composables/useBeltProgress'
import { generateLearningScript } from '../providers/CourseDataProvider'
// Prebuilt network: positions pre-calculated, pans to hero via CSS
import { usePrebuiltNetworkIntegration } from '../composables/usePrebuiltNetworkIntegration'
import { useLegoNetwork } from '../composables/useLegoNetwork'
import { useAlgorithmConfig } from '../composables/useAlgorithmConfig'
import ConstellationNetworkView from './ConstellationNetworkView.vue'

const emit = defineEmits(['close'])

const props = defineProps({
  classContext: {
    type: Object,
    default: null
  },
  course: {
    type: Object,
    default: null
  },
  // Network preview mode: auto-populate network up to this LEGO index
  // Set to 0 for normal playback, or higher number to preview network shape
  // e.g., 50 will show first 50 LEGOs without playing audio
  previewLegoIndex: {
    type: Number,
    default: 0  // 0 = normal mode, >0 = preview mode
  }
})

// ============================================
// DEMO DATA - Real Italian course audio from SSi
// Audio files bundled locally in /public/audio/
// ============================================

const AUDIO_BASE_URL = '/audio'

const createDemoItem = (id, known, target, audio) => ({
  lego: {
    id: `L${id}`,
    type: 'A',
    new: false,
    lego: { known, target },
    audioRefs: {
      known: { id: audio.source.id, url: `${AUDIO_BASE_URL}/${audio.source.id}.mp3` },
      target: {
        voice1: { id: audio.target1.id, url: `${AUDIO_BASE_URL}/${audio.target1.id}.mp3` },
        voice2: { id: audio.target2.id, url: `${AUDIO_BASE_URL}/${audio.target2.id}.mp3` },
      },
    },
  },
  phrase: {
    id: `P${id}`,
    phraseType: 'practice',
    phrase: { known, target },
    audioRefs: {
      known: { id: audio.source.id, url: `${AUDIO_BASE_URL}/${audio.source.id}.mp3` },
      target: {
        voice1: { id: audio.target1.id, url: `${AUDIO_BASE_URL}/${audio.target1.id}.mp3` },
        voice2: { id: audio.target2.id, url: `${AUDIO_BASE_URL}/${audio.target2.id}.mp3` },
      },
    },
    wordCount: target.split(' ').length,
    containsLegos: [`L${id}`],
  },
  seed: {
    seed_id: `S${id}`,
    seed_pair: { known, target },
    legos: [],
  },
  thread_id: 1,
  mode: 'practice',
  // Store durations for pause calculation
  audioDurations: {
    source: audio.source.duration,
    target1: audio.target1.duration,
    target2: audio.target2.duration,
  },
})

// Real Italian course demo items with audio UUIDs
const demoItems = [
  createDemoItem('001',
    'I want to speak Italian with you now.',
    'Voglio parlare italiano con te adesso.',
    {
      source: { id: '0B3EB395-78B0-36CD-8F4E-5836D47DDCC6', duration: 2.06 },
      target1: { id: '0E6545AE-78B0-AC07-8F4E-C266E5A3F142', duration: 2.48 },
      target2: { id: '0D53FF62-78B0-E115-8F4E-628B5399FA29', duration: 3.29 },
    }
  ),
  createDemoItem('002',
    'I speak Italian now.',
    'Parlo italiano adesso.',
    {
      source: { id: 'F1A4B92A-78B0-36CD-8F4E-D4F89A95F5C4', duration: 1.52 },
      target1: { id: 'EAF65674-78B0-AC07-8F4E-F3336C6EDDB8', duration: 2.46 },
      target2: { id: 'A4268ED0-78B0-E115-8F4E-681C8EF03175', duration: 2.27 },
    }
  ),
  createDemoItem('003',
    'If I speak Italian now.',
    'Se parlo italiano adesso.',
    {
      source: { id: '609DBB08-78B0-36CD-8F4E-16C1CB6F920A', duration: 1.65 },
      target1: { id: '7A4A5844-78B0-AC07-8F4E-79803B6E0188', duration: 2.53 },
      target2: { id: '29298269-78B0-E115-8F4E-8E7985F16946', duration: 2.38 },
    }
  ),
  createDemoItem('004',
    "I'd like to be able to speak Italian.",
    'Vorrei potere parlare italiano.',
    {
      source: { id: 'AFF9FCD7-78B0-36CD-8F4E-5644712602D5', duration: 2.19 },
      target1: { id: 'F8FD1CC8-78B0-AC07-8F4E-2C0059DFAB65', duration: 2.69 },
      target2: { id: 'E645EAB0-78B0-E115-8F4E-B6BDBF413689', duration: 2.32 },
    }
  ),
  createDemoItem('005',
    'You speak Italian very well.',
    'Parli italiano molto bene.',
    {
      source: { id: 'E28D5521-78B0-36CD-8F4E-1194C85BC7A0', duration: 1.78 },
      target1: { id: 'B91B1D58-78B0-AC07-8F4E-4A953003E5D0', duration: 2.66 },
      target2: { id: '1A6B10E7-78B0-E115-8F4E-BE8F3310BC8B', duration: 2.38 },
    }
  ),
]

// ============================================
// PERSISTENCE LAYER INTEGRATION
// Inject stores from parent (App.vue)
// ============================================

const progressStore = inject('progressStore', { value: null })
const sessionStore = inject('sessionStore', { value: null })
const courseDataProvider = inject('courseDataProvider', { value: null })
const supabase = inject('supabase', { value: null })
const auth = inject('auth', null)

// Algorithm config - admin-tweakable parameters (Turbo Boost, pause timing, etc.)
const {
  loadConfigs: loadAlgorithmConfigs,
  normalConfig,
  turboConfig,
  calculatePause,
  isLoaded: algorithmConfigLoaded
} = useAlgorithmConfig(supabase)

// Network data from database (for edge connections - like brain view)
const { loadNetworkData: loadLegoNetworkData } = useLegoNetwork(supabase)
const networkConnections = ref<Array<{ source: string; target: string; count: number }>>([])

// Get course code from prop (required - App.vue ensures course exists before rendering)
const courseCode = computed(() => props.course?.course_code || '')

// Alias for ReportIssueButton
const activeCourseCode = courseCode

// Check if launched from dashboard in QA mode
const isQaMode = computed(() => {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('qa_mode') === 'true'
})

// Get learner ID from auth (or fallback to 'demo-learner' for dev)
const learnerId = computed(() => auth?.learnerId?.value || 'demo-learner')

// Helper to check if learner is a guest (no persistence for guests)
const isGuestLearner = computed(() => {
  const id = learnerId.value
  return !id || id === 'demo-learner' || id.startsWith('guest-')
})

// Save round completion progress to database
const saveRoundProgress = async (legoId, roundIndex) => {
  if (isGuestLearner.value || !progressStore?.value) {
    console.log('[LearningPlayer] Skipping progress save (guest mode)')
    return
  }

  try {
    await progressStore.value.updateEnrollmentProgress(
      learnerId.value,
      courseCode.value,
      legoId,
      roundIndex
    )
    console.log('[LearningPlayer] Saved progress: round', roundIndex, 'LEGO:', legoId)
  } catch (err) {
    console.warn('[LearningPlayer] Failed to save progress:', err)
    // Don't throw - continue learning even if save fails
  }
}

// Load saved progress from database
const loadSavedProgress = async () => {
  if (isGuestLearner.value || !progressStore?.value) {
    return null
  }

  try {
    const enrollment = await progressStore.value.getEnrollment(
      learnerId.value,
      courseCode.value
    )
    if (enrollment && enrollment.last_completed_round_index !== null) {
      return {
        lastCompletedLegoId: enrollment.last_completed_lego_id,
        lastCompletedRoundIndex: enrollment.last_completed_round_index
      }
    }
  } catch (err) {
    console.warn('[LearningPlayer] Failed to load saved progress:', err)
  }
  return null
}

// ============================================
// SCRIPT CACHE - Shared with CourseExplorer
// ============================================
const {
  audioMap,
  currentCourseCode,
  getCachedScript,
  loadIntroAudio,
  getAudioUrl: getAudioUrlFromCache,
} = useScriptCache()

// Script-based learning state
const cachedRounds = ref([])
const currentRoundIndex = ref(0)
const currentItemInRound = ref(0)
const scriptBaseOffset = ref(0) // Tracks where the script started (completedSeeds at load time)
const playbackGeneration = ref(0) // Increments on every jump - invalidates stale callbacks

// ============================================
// PROGRESSIVE LOADING - Start small, expand as learner progresses
// ============================================
const INITIAL_ROUNDS = 20           // Fast initial load
const EXPANSION_THRESHOLD = 5       // Expand when within 5 rounds of end
const MAX_EXPANSION_BATCH = 200     // Cap each expansion batch
const isExpandingScript = ref(false)

// ============================================
// LOCAL STORAGE PERSISTENCE - Works for all users (guests + logged-in)
// Primary source of truth for position, works offline, persists across sessions
// ============================================
const POSITION_STORAGE_KEY_PREFIX = 'ssi_learning_position_'

const getPositionStorageKey = () => `${POSITION_STORAGE_KEY_PREFIX}${courseCode.value}`

/**
 * Save current learning position to localStorage
 * Called whenever position changes (round or item)
 * Includes 'view' field to enable same-view vs cross-view resume logic
 * Includes 'scriptOffset' to detect when belt progress changed (invalidates position)
 */
const savePositionToLocalStorage = () => {
  if (!courseCode.value) return

  try {
    const position = {
      roundIndex: currentRoundIndex.value,
      itemInRound: currentItemInRound.value,
      lastUpdated: Date.now(),
      courseCode: courseCode.value,
      view: 'player', // Track which view saved this position
      scriptOffset: beltProgress.value?.completedSeeds.value ?? 0, // Track offset for validation
    }
    localStorage.setItem(getPositionStorageKey(), JSON.stringify(position))
    console.log('[LearningPlayer] Position saved:', position.roundIndex, '/', position.itemInRound, 'at offset', position.scriptOffset)
  } catch (err) {
    console.warn('[LearningPlayer] Failed to save position to localStorage:', err)
  }
}

/**
 * Load learning position from localStorage
 * Returns null if no saved position, position is too old (>7 days), or offset changed
 * The offset check ensures position is valid when belt progress changes between sessions
 */
const loadPositionFromLocalStorage = () => {
  if (!courseCode.value) return null

  try {
    const stored = localStorage.getItem(getPositionStorageKey())
    if (!stored) return null

    const position = JSON.parse(stored)

    // Validate the position is for the current course
    if (position.courseCode && position.courseCode !== courseCode.value) {
      return null
    }

    // Check if position is stale (older than 7 days)
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    if (position.lastUpdated && Date.now() - position.lastUpdated > sevenDaysMs) {
      console.log('[LearningPlayer] Saved position is stale (>7 days), starting fresh')
      return null
    }

    // Check if offset changed (belt progress changed since position was saved)
    // If so, the stored roundIndex is no longer valid for the new script batch
    const currentOffset = beltProgress.value?.completedSeeds.value ?? 0
    const storedOffset = position.scriptOffset ?? 0
    if (storedOffset !== currentOffset) {
      console.log('[LearningPlayer] Belt progress changed (offset', storedOffset, '→', currentOffset, '), position invalidated')
      return null
    }

    console.log('[LearningPlayer] Loaded position from localStorage:', position.roundIndex, '/', position.itemInRound, 'at offset', storedOffset)
    return position
  } catch (err) {
    console.warn('[LearningPlayer] Failed to load position from localStorage:', err)
    return null
  }
}

/**
 * Clear saved position (used when resetting progress)
 */
const clearPositionFromLocalStorage = () => {
  if (!courseCode.value) return
  try {
    localStorage.removeItem(getPositionStorageKey())
    console.log('[LearningPlayer] Position cleared from localStorage')
  } catch (err) {
    console.warn('[LearningPlayer] Failed to clear position:', err)
  }
}

// Course welcome from cached script (plays once on first visit)
const cachedCourseWelcome = ref(null)

// Are we using round-based playback?
const useRoundBasedPlayback = computed(() => cachedRounds.value.length > 0)

// Current round
const currentRound = computed(() =>
  useRoundBasedPlayback.value ? cachedRounds.value[currentRoundIndex.value] : null
)

// Flag to track if initial position has been loaded (prevents saving during initialization)
const positionInitialized = ref(false)

// Watch for position changes and persist to localStorage
// Only saves after initial load is complete (positionInitialized is true)
watch([currentRoundIndex, currentItemInRound], () => {
  if (positionInitialized.value && useRoundBasedPlayback.value) {
    savePositionToLocalStorage()
  }
})

// Watch for approaching end of cached rounds - trigger expansion
// This enables infinite progressive loading without hard limits
watch(currentRoundIndex, async (index) => {
  if (!positionInitialized.value) return
  if (!cachedRounds.value.length) return

  const remaining = cachedRounds.value.length - index
  if (remaining <= EXPANSION_THRESHOLD && !isExpandingScript.value) {
    console.log(`[LearningPlayer] Approaching end (${remaining} rounds left), expanding...`)
    await expandScript()
  }
})

// Audio base URL for S3 (no /mastered suffix - s3_key already contains full path)
const AUDIO_S3_BASE_URL = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com'

/**
 * Fix audio URLs that have double mastered path (legacy cached data issue)
 * e.g., ".../mastered/mastered/UUID.mp3" -> ".../mastered/UUID.mp3"
 */
const normalizeAudioUrl = (url) => {
  if (!url) return url
  return url.replace('/mastered/mastered/', '/mastered/')
}

/**
 * Convert a ScriptItem to a playable item for the orchestrator.
 * Uses pre-populated audioRefs from script generation when available,
 * falls back to lazy audio lookup from cache.
 */
const scriptItemToPlayableItem = async (scriptItem) => {
  if (!scriptItem) return null

  // Check if script item already has audio refs populated (from generateLearningScript)
  const hasPreloadedAudio = scriptItem.audioRefs?.known?.url || scriptItem.audioRefs?.target?.voice1?.url

  // Debug: log what we're receiving
  console.log('[scriptItemToPlayableItem] Item type:', scriptItem.type, 'hasPreloadedAudio:', hasPreloadedAudio,
    'audioRefs:', scriptItem.audioRefs ? {
      known: scriptItem.audioRefs.known?.url ? 'YES' : 'NO',
      target1: scriptItem.audioRefs.target?.voice1?.url ? 'YES' : 'NO',
      target2: scriptItem.audioRefs.target?.voice2?.url ? 'YES' : 'NO'
    } : 'NONE')

  let knownAudioUrl, target1AudioUrl, target2AudioUrl

  if (hasPreloadedAudio) {
    // Use pre-populated audio URLs from script generation
    // Normalize to fix any cached URLs with double mastered path
    knownAudioUrl = normalizeAudioUrl(scriptItem.audioRefs?.known?.url)
    target1AudioUrl = normalizeAudioUrl(scriptItem.audioRefs?.target?.voice1?.url)
    target2AudioUrl = normalizeAudioUrl(scriptItem.audioRefs?.target?.voice2?.url)
    console.log('[scriptItemToPlayableItem] Using preloaded:', { knownAudioUrl, target1AudioUrl, target2AudioUrl })
  } else {
    // Fallback: Look up audio URLs from cache (lazy loaded)
    knownAudioUrl = await getAudioUrlFromCache(
      supabase?.value,
      scriptItem.knownText,
      'known',
      scriptItem.type === 'intro' ? scriptItem : null,
      AUDIO_S3_BASE_URL
    )

    target1AudioUrl = await getAudioUrlFromCache(
      supabase?.value,
      scriptItem.targetText,
      'target1',
      null,
      AUDIO_S3_BASE_URL
    )

    target2AudioUrl = await getAudioUrlFromCache(
      supabase?.value,
      scriptItem.targetText,
      'target2',
      null,
      AUDIO_S3_BASE_URL
    )
  }

  // Build the playable item
  // LEGO is "new" when it's being introduced in its own round (legoIndex === roundNumber)
  // Spaced rep items review OLD LEGOs from previous rounds, so they're not "new"
  const isNewLego = scriptItem.legoIndex === scriptItem.roundNumber

  return {
    lego: {
      id: scriptItem.legoId,
      type: 'M', // Default to molecular
      new: isNewLego,
      lego: {
        known: scriptItem.knownText,
        target: scriptItem.targetText,
      },
      audioRefs: {
        known: knownAudioUrl ? { id: 'known', url: knownAudioUrl } : null,
        target: {
          voice1: target1AudioUrl ? { id: 'target1', url: target1AudioUrl } : null,
          voice2: target2AudioUrl ? { id: 'target2', url: target2AudioUrl } : null,
        },
      },
    },
    phrase: {
      id: `${scriptItem.legoId}-${scriptItem.legoIndex}`,
      phraseType: scriptItem.type,
      phrase: {
        known: scriptItem.knownText,
        target: scriptItem.targetText,
      },
      audioRefs: {
        known: knownAudioUrl ? { id: 'known', url: knownAudioUrl } : null,
        target: {
          voice1: target1AudioUrl ? { id: 'target1', url: target1AudioUrl } : null,
          voice2: target2AudioUrl ? { id: 'target2', url: target2AudioUrl } : null,
        },
      },
      wordCount: scriptItem.targetText.split(' ').length,
      containsLegos: [scriptItem.legoId],
    },
    seed: {
      seed_id: scriptItem.seedId,
      seed_pair: {
        known: scriptItem.knownText,
        target: scriptItem.targetText,
      },
      legos: [scriptItem.legoId],
    },
    thread_id: 1,
    type: scriptItem.type,  // Top-level type for easy access
    mode: scriptItem.type,
    // Durations from cache or defaults
    audioDurations: scriptItem.audioDurations || {
      source: 2.0,
      target1: 2.5,
      target2: 2.5,
    },
    // Track original script item data
    _scriptItem: scriptItem,
  }
}

// Current script item (from round)
const currentScriptItem = computed(() => {
  if (!currentRound.value || !currentRound.value.items) return null
  return currentRound.value.items[currentItemInRound.value] || null
})

// Round progress tracking
const isRoundComplete = computed(() => {
  if (!currentRound.value) return false
  return currentItemInRound.value >= currentRound.value.items.length
})

const roundProgress = computed(() => {
  if (!currentRound.value || !currentRound.value.items.length) return 0
  return (currentItemInRound.value / currentRound.value.items.length) * 100
})

// Initialize learning session composable
const learningSession = useLearningSession({
  progressStore: progressStore.value,
  sessionStore: sessionStore.value,
  courseDataProvider: courseDataProvider.value,
  learnerId: learnerId.value,
  courseId: courseCode.value,
  demoItems,
})

// Use items from session (will be demo items if database not available)
const sessionItems = computed(() => learningSession.items.value.length > 0 ? learningSession.items.value : demoItems)

// ============================================
// META-COMMENTARY: Welcome, Instructions, Encouragements
// Plays between rounds based on timing and adaptation
// ============================================

// Initialize meta-commentary composable (only if we have a data provider)
const metaCommentary = courseDataProvider.value
  ? useMetaCommentary({
      courseDataProvider: courseDataProvider.value,
      learnerId: learnerId.value || 'guest',
    })
  : null

// Track if we're currently playing commentary audio
const playingCommentaryAudio = ref(false)

// ============================================
// INK SPIRIT REWARDS
// Target language congratulations that drift upward
// Hidden formula - show results, not mechanics
// ============================================

const REWARD_WORDS = {
  // Chinese - common encouragements
  zho: [
    { word: '好', weight: 1 },        // hǎo - good (common)
    { word: '不错', weight: 2 },      // bù cuò - not bad
    { word: '很好', weight: 2 },      // hěn hǎo - very good
    { word: '对', weight: 1 },        // duì - correct
    { word: '棒', weight: 3 },        // bàng - great
    { word: '厉害', weight: 4 },      // lìhai - impressive
    { word: '太棒了', weight: 5 },    // tài bàng le - awesome (rare)
    { word: '加油', weight: 3 },      // jiā yóu - keep going
  ],
  // Italian
  ita: [
    { word: 'bene', weight: 1 },
    { word: 'bravo', weight: 2 },
    { word: 'perfetto', weight: 4 },
    { word: 'ottimo', weight: 3 },
    { word: 'così', weight: 1 },
    { word: 'esatto', weight: 2 },
    { word: 'fantastico', weight: 5 },
  ],
  // Spanish
  spa: [
    { word: 'bien', weight: 1 },
    { word: 'muy bien', weight: 2 },
    { word: 'genial', weight: 3 },
    { word: 'perfecto', weight: 4 },
    { word: 'excelente', weight: 5 },
    { word: 'así', weight: 1 },
    { word: 'eso', weight: 1 },
  ],
  // Welsh
  cym: [
    { word: 'da', weight: 1 },        // good
    { word: 'da iawn', weight: 2 },   // very good
    { word: 'gwych', weight: 3 },     // great
    { word: 'ardderchog', weight: 5 }, // excellent
    { word: 'bendigedig', weight: 4 }, // wonderful
  ],
  // Fallback
  default: [
    { word: '✓', weight: 1 },
    { word: '◆', weight: 2 },
    { word: '★', weight: 4 },
  ]
}

// Active floating rewards
const floatingRewards = ref([])
let rewardIdCounter = 0

// Get target language from course code
const targetLang = computed(() => {
  const code = courseCode.value
  if (code?.startsWith('zho')) return 'zho'
  if (code?.startsWith('ita') || code?.includes('_ita')) return 'ita'
  if (code?.startsWith('spa') || code?.includes('_spa')) return 'spa'
  if (code?.startsWith('cym') || code?.includes('_cym')) return 'cym'
  // Check if target is in the code (e.g., "zho_for_eng")
  if (code?.includes('zho')) return 'zho'
  if (code?.includes('ita')) return 'ita'
  if (code?.includes('spa')) return 'spa'
  if (code?.includes('cym')) return 'cym'
  return 'default'
})

// Calculate points for a cycle (hidden formula)
const calculateCyclePoints = () => {
  let points = 1 // Base point for completing cycle
  let bonusLevel = 0 // 0=normal, 1=good, 2=great, 3=amazing

  // Check timing results if available
  if (lastTimingResult.value?.speech_detected) {
    points += 1 // Bonus for detected speech

    const latency = lastTimingResult.value.response_latency_ms
    if (latency !== null) {
      if (latency < 500) {
        points += 3 // Flow state - very fast
        bonusLevel = 3
      } else if (latency < 1000) {
        points += 2 // Quick response
        bonusLevel = 2
      } else if (latency < 2000) {
        points += 1 // Good response
        bonusLevel = 1
      }
    }

    // Duration match bonus
    const delta = lastTimingResult.value.duration_delta_ms
    if (delta !== null) {
      const absDelta = Math.abs(delta)
      if (absDelta < 200) {
        points += 2 // Natural rhythm
        bonusLevel = Math.max(bonusLevel, 2)
      } else if (absDelta < 500) {
        points += 1
        bonusLevel = Math.max(bonusLevel, 1)
      }
    }
  }

  // Add some controlled randomness (±1) so it feels alive
  const variance = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0
  points = Math.max(1, points + variance)

  return { points, bonusLevel }
}

// Select reward word based on points/bonus level
const selectRewardWord = (bonusLevel) => {
  const words = REWARD_WORDS[targetLang.value] || REWARD_WORDS.default

  // Filter words by weight - higher bonus = access to rarer words
  const maxWeight = bonusLevel + 2 // 0→2, 1→3, 2→4, 3→5
  const eligible = words.filter(w => w.weight <= maxWeight)

  // Weighted random selection favoring higher weights when earned
  const weighted = eligible.flatMap(w => {
    // More bonus = more likely to get the better words
    const copies = bonusLevel >= w.weight ? 2 : 1
    return Array(copies).fill(w.word)
  })

  return weighted[Math.floor(Math.random() * weighted.length)]
}

// Trigger floating reward animation
const triggerRewardAnimation = (points, bonusLevel) => {
  const word = selectRewardWord(bonusLevel)
  const id = ++rewardIdCounter

  // Random horizontal offset for variety
  const xOffset = (Math.random() - 0.5) * 60 // -30 to +30 px

  floatingRewards.value.push({
    id,
    word,
    points,
    bonusLevel,
    xOffset,
  })

  // Remove after animation completes
  setTimeout(() => {
    floatingRewards.value = floatingRewards.value.filter(r => r.id !== id)
  }, 2000)
}

// Session points total
const sessionPoints = ref(0)

// Turbo cycle tracking for session multiplier
const totalCycles = ref(0)
const turboCycles = ref(0)

// Session multiplier based on turbo usage (hidden formula)
const sessionMultiplier = computed(() => {
  if (totalCycles.value < 5) return 1.0 // Need minimum cycles before multiplier kicks in
  const turboPercent = turboCycles.value / totalCycles.value
  // Tiered multiplier - reward consistent turbo usage
  if (turboPercent >= 0.75) return 1.5 // 75%+ turbo = 1.5x
  if (turboPercent >= 0.50) return 1.25 // 50%+ turbo = 1.25x
  return 1.0
})

// ============================================
// BELT PROGRESSION SYSTEM
// Uses useBeltProgress composable with localStorage persistence
// Starts at white belt (0 seeds), progresses through 8 belts
// ============================================

// Belt progress composable - initialized after courseCode is available
// Uses localStorage for persistence, will swap to Supabase later
const beltProgress = shallowRef(null)

// Computed properties that delegate to the composable (with fallbacks for initial load)
const completedSeeds = computed(() => beltProgress.value?.completedSeeds.value ?? 0)
const currentBelt = computed(() => beltProgress.value?.currentBelt.value ?? { name: 'white', seedsRequired: 0, color: '#f5f5f5', colorDark: '#e0e0e0', glow: 'rgba(245, 245, 245, 0.3)', index: 0 })
const nextBelt = computed(() => beltProgress.value?.nextBelt.value ?? null)
const previousBelt = computed(() => beltProgress.value?.previousBelt.value ?? null)

// Calculate which belt the "back" button will go TO
// Mirrors goBackToBeltStart logic: if >2 seeds into current belt, stays on current; otherwise goes to previous
const backTargetBelt = computed(() => {
  const currentStart = currentBelt.value.seedsRequired
  // If we're more than 2 seeds into current belt, target is current belt start
  if (completedSeeds.value > currentStart + 2 || !previousBelt.value) {
    return currentBelt.value
  }
  // Otherwise, target is previous belt
  return previousBelt.value
})

const beltProgressPercent = computed(() => beltProgress.value?.beltProgress.value ?? 0)
const seedsToNextBelt = computed(() => beltProgress.value?.seedsToNextBelt.value ?? 8)
const timeToNextBelt = computed(() => beltProgress.value?.timeToNextBelt.value ?? 'Keep learning to see estimate')
const beltJourney = computed(() => beltProgress.value?.beltJourney.value ?? [])

// CSS custom properties for belt theming
const beltCssVars = computed(() => beltProgress.value?.beltCssVars.value ?? {
  '--belt-color': '#f5f5f5',
  '--belt-color-dark': '#e0e0e0',
  '--belt-glow': 'rgba(245, 245, 245, 0.3)',
})

// Initialize belt progress when course code is available
const initializeBeltProgress = () => {
  if (courseCode.value && !beltProgress.value) {
    beltProgress.value = useSharedBeltProgress(courseCode.value)
    console.log('[LearningPlayer] Belt progress initialized for', courseCode.value, '- seeds:', beltProgress.value.completedSeeds.value)
  }
}

// ============================================
// ROUND BOUNDARY INTERRUPTIONS
// Belt promotions, encouragements, break suggestions
// ============================================

// Track rounds completed in this session (for break suggestions)
const roundsThisSession = ref(0)
const showBreakSuggestion = ref(false)
const beltJustEarned = ref(null)

/**
 * Play commentary audio (welcome, instruction, or encouragement)
 * Returns a promise that resolves when audio finishes
 */
const playCommentaryAudio = async (commentary) => {
  if (!commentary?.url || !audioController.value) {
    console.warn('[LearningPlayer] Cannot play commentary - missing audio or controller')
    return false
  }

  playingCommentaryAudio.value = true
  console.log('[LearningPlayer] Playing', commentary.type, ':', commentary.text?.substring(0, 50))

  return new Promise((resolve) => {
    const audio = audioController.value

    // Create a one-time ended handler
    const onEnded = () => {
      audio.offEnded(onEnded)
      playingCommentaryAudio.value = false
      resolve(true)
    }

    audio.onEnded(onEnded)

    // Play the commentary audio
    audio.play({
      id: commentary.id,
      url: commentary.url,
      duration_ms: commentary.duration_ms,
    }).catch((err) => {
      console.error('[LearningPlayer] Commentary audio error:', err)
      audio.offEnded(onEnded)
      playingCommentaryAudio.value = false
      resolve(false)
    })

    // Safety timeout (max 60 seconds for any commentary)
    setTimeout(() => {
      if (playingCommentaryAudio.value) {
        audio.offEnded(onEnded)
        audio.stop()
        playingCommentaryAudio.value = false
        resolve(false)
      }
    }, 60000)
  })
}

/**
 * Update belt progress based on current position in course
 * Belts are POSITION-based, not completion-based
 * This allows learners to skip ahead and calibrate quickly
 *
 * @param roundIndex - Current round position (0-based, relative to loaded batch)
 * @param showCelebration - Whether to show belt promotion celebration
 */
const updateBeltForPosition = (roundIndex, showCelebration = true) => {
  if (!beltProgress.value) return

  const previousBelt = beltProgress.value.currentBelt.value
  const previousSeeds = beltProgress.value.completedSeeds.value

  // Set seeds to match current position (1 seed ≈ 1 round/LEGO)
  // Convert relative round index to absolute seed number using base offset
  const newSeeds = scriptBaseOffset.value + roundIndex + 1
  beltProgress.value.setSeeds(newSeeds)

  // Check for belt promotion (only celebrate if moving forward)
  if (showCelebration && newSeeds > previousSeeds) {
    const newBelt = beltProgress.value.currentBelt.value
    if (newBelt.index > previousBelt.index) {
      beltJustEarned.value = newBelt
      console.log('[LearningPlayer] 🥋 Belt promotion!', previousBelt.name, '→', newBelt.name)
      triggerRewardAnimation(100, 5)
      setTimeout(() => {
        beltJustEarned.value = null
      }, 5000)
    }
  }
}

// Handle round boundary - called when a round completes
const handleRoundBoundary = async (completedRoundIndex, completedLegoId) => {
  roundsThisSession.value++

  // Update belt progress to match current position (NO celebration during play - manual only)
  updateBeltForPosition(completedRoundIndex, false)

  // ============================================
  // META-COMMENTARY: Instructions & Encouragements
  // Check if it's time for audio commentary between rounds
  // Timing is CYCLE-based (consistent ~11s), but plays at round boundaries
  // ============================================
  if (metaCommentary && !beltJustEarned.value) {
    // Get cycle count from the completed round
    const cyclesInRound = currentRound.value?.items?.length || 0

    // Build performance metrics from current session data
    const performance = {
      averageResponseTime: 1500, // TODO: Wire up from actual timing data
      correctStreak: roundsThisSession.value, // Approximate for now
      strugglingItems: 0, // TODO: Wire up from adaptation engine
    }

    // Check if commentary should play this round (based on cycle accumulation)
    const commentary = metaCommentary.onRoundComplete(
      completedRoundIndex + 1, // 1-based round number
      cyclesInRound,           // Number of cycles in this round
      performance
    )

    if (commentary) {
      console.log('[LearningPlayer] 📢 Playing', commentary.type, 'commentary')

      // Play the commentary audio (pauses learning while playing)
      await playCommentaryAudio(commentary)

      // Mark commentary as complete
      metaCommentary.finishCommentaryPlayback()
    }
  }

  // Fallback: Show visual encouragement if no audio commentary played
  // (only if we don't have meta-commentary or it didn't return anything)
  if (!metaCommentary || !playingCommentaryAudio.value) {
    const encouragementInterval = 3 + Math.floor(Math.random() * 3) // 3, 4, or 5
    if (roundsThisSession.value % encouragementInterval === 0 && !beltJustEarned.value) {
      // Trigger visual encouragement animation
      triggerRewardAnimation(25, Math.min(roundsThisSession.value / 3, 4))
    }
  }

  // Suggest break every 10 rounds (roughly 15-20 minutes of learning)
  if (roundsThisSession.value > 0 && roundsThisSession.value % 10 === 0) {
    showBreakSuggestion.value = true
    console.log('[LearningPlayer] ☕ Suggesting break after', roundsThisSession.value, 'rounds')
    // Auto-dismiss after 5 seconds if they keep playing
    setTimeout(() => {
      showBreakSuggestion.value = false
    }, 5000)
  }
}

// Dismiss break suggestion (user chose to continue)
const dismissBreakSuggestion = () => {
  showBreakSuggestion.value = false
}

// ============================================
// CORE ENGINE INTEGRATION
// Using @ssi/core CycleOrchestrator
// ============================================

// Create mock audio controller (no actual audio for now)
const audioController = shallowRef(null)
const orchestrator = shallowRef(null)

// Map core CyclePhase to UI phases (for backward compatibility)
const Phase = {
  PROMPT: 'prompt',      // Maps to CyclePhase.PROMPT
  SPEAK: 'speak',        // Maps to CyclePhase.PAUSE
  VOICE_1: 'voice_1',    // Maps to CyclePhase.VOICE_1
  VOICE_2: 'voice_2',    // Maps to CyclePhase.VOICE_2
}

// Map core phases to UI phases
const corePhaseToUiPhase = (corePhase) => {
  switch (corePhase) {
    case CyclePhase.PROMPT: return Phase.PROMPT
    case CyclePhase.PAUSE: return Phase.SPEAK
    case CyclePhase.VOICE_1: return Phase.VOICE_1
    case CyclePhase.VOICE_2: return Phase.VOICE_2
    case CyclePhase.IDLE: return Phase.PROMPT
    case CyclePhase.TRANSITION: return Phase.PROMPT  // Hide target text during item transition
    default: return Phase.PROMPT
  }
}

// State
const currentPhase = ref(Phase.PROMPT)
const currentItemIndex = ref(0)
const isPlaying = ref(false) // Start paused until engine ready

// Layout mode: 'default' | 'subtitle' | 'floating' | 'minimal'
const layoutMode = ref('subtitle')  // Try subtitle mode by default
const layoutModes = ['default', 'subtitle', 'floating', 'minimal'] as const
const layoutModeLabels: Record<string, string> = {
  default: 'Card',
  subtitle: 'Strip',
  floating: 'Float',
  minimal: 'Text'
}
function cycleLayoutMode() {
  const currentIndex = layoutModes.indexOf(layoutMode.value as typeof layoutModes[number])
  const nextIndex = (currentIndex + 1) % layoutModes.length
  layoutMode.value = layoutModes[nextIndex]
}
const itemsPracticed = ref(0)
const showSessionComplete = ref(false)

// Current playable item (for round-based playback)
const currentPlayableItem = ref(null)

// ============================================
// AWAKENING LOADER STATE
// Progressive loading stages for atmospheric effect
// ============================================
const loadingStage = ref('awakening') // 'awakening' | 'finding' | 'preparing' | 'ready'
const isAwakening = computed(() => loadingStage.value !== 'ready')
const loadingMessages = ref([]) // Messages that have finished typing
const currentLoadingMessage = ref('') // Message currently being typed

// Varied awakening messages - randomly selected each session
const AWAKENING_MESSAGES = [
  'tuning into your wavelength',
  'warming up the neurons',
  'finding where we left off',
  'preparing your next step',
  'gathering your words',
  'dusting off the vocabulary',
  'reconnecting the pathways',
  'setting the stage',
  'your brain called ahead',
  'ready when you are',
  'finding your rhythm',
  'picking up the thread',
]

const getRandomAwakeningMessage = () => {
  return AWAKENING_MESSAGES[Math.floor(Math.random() * AWAKENING_MESSAGES.length)]
}

// Transition to next loading stage
const setLoadingStage = (stage) => {
  console.log('[LearningPlayer] Loading stage:', stage)
  loadingStage.value = stage

  // Start typing on first stage only
  if (stage === 'awakening') {
    typeLoadingMessage(getRandomAwakeningMessage())
  }
}

// Typewriter effect for loading message
let typewriterTimeout = null
const typeLoadingMessage = (message) => {
  currentLoadingMessage.value = ''
  let charIndex = 0

  const typeChar = () => {
    if (charIndex < message.length) {
      currentLoadingMessage.value += message[charIndex]
      charIndex++
      typewriterTimeout = setTimeout(typeChar, 40)
    }
  }
  typeChar()
}

// Introduction playback state
const playedIntroductions = ref(new Set()) // LEGOs that have had their intro played this session
const isPlayingIntroduction = ref(false) // True when introduction audio is playing
const introductionPhase = ref(false) // True during introduction phase (shows different UI)

// ============================================
// DISTINCTION NETWORK VISUALIZATION
// Split-stage layout: Network Theater + Control Pane
// ============================================
const ringContainerRef = ref(null)
const networkTheaterRef = ref<HTMLElement | null>(null)

// Initialize prebuilt network composable (positions calculated once, pans to hero)
const distinctionNetwork = usePrebuiltNetworkIntegration({
  pathAnimationStepMs: 180,
  autoCenterOnHeroChange: true, // Pan to hero on change
  canvasSize: { width: 800, height: 800 },
})

// Handle tap on network theater (play/pause)
const handleTheaterTap = (event: MouseEvent) => {
  // Don't trigger if tapping on a node (let node-tap handle it)
  const target = event.target as HTMLElement
  if (target.closest('.node')) return

  // Toggle play/pause
  if (isPlaying.value) {
    handlePause()
  } else {
    handleResume()
  }
}

// Destructure for convenience
const {
  viewRef: networkViewRef,
  viewProps: networkViewProps,
  network,
  simulation,
  center: networkCenter,
  isAnimatingPath: isPathAnimating,
  introduceLegoNode,
  completePhraseWithAnimation,
  clearPathAnimation,
  setCenter: setNetworkCenter,
  setBelt: setNetworkBelt,
  populateFromRounds: populateNetworkFromRounds,
  initializeFullNetwork,
  revealNodesUpToIndex,
  isFullNetworkLoaded,
  stats: networkStats,
} = distinctionNetwork

// Backwards compatibility aliases
const networkNodes = network.nodes
const networkLinks = network.edges
const heroNodeId = network.heroNodeId
const introducedLegoIds = computed(() => {
  const ids = new Set()
  network.nodes.value.forEach(n => ids.add(n.id))
  return ids
})

// Additional state for resonance effect (M-LEGOs with partial word overlap)
const resonatingNodes = ref([])

// Hovered node state (for tooltip showing practice phrases)
const hoveredNode = ref(null)
const hoveredNodePhrases = computed(() => {
  if (!hoveredNode.value) return []
  // Find the round that introduced this LEGO
  const legoId = hoveredNode.value.id
  const roundIndex = cachedRounds.value.findIndex(r => r.legoId === legoId)
  if (roundIndex < 0) return []
  const round = cachedRounds.value[roundIndex]
  if (!round?.items) return []
  // Return all practice phrases from that round (exclude intro/debut)
  return round.items
    .filter(item => item.type !== 'intro' && item.type !== 'debut')
    .map(item => ({
      target: item.targetText || '',
      known: item.knownText || ''
    }))
    .slice(0, 5) // Limit to 5 phrases
})

// State for node tap playback (plays all phrases for tapped node)
const isPlayingNodePhrases = ref(false)
const playingNodeId = ref<string | null>(null)
const currentPlayingPhraseIndex = ref(0)
const nodePhraseItems = ref<any[]>([])

// Hero node scaling - fewer nodes = bigger nodes (for ring visual)
const heroNodeScale = computed(() => {
  const count = networkNodes.value.length
  if (count <= 3) return 2.5
  if (count <= 8) return 1.8
  if (count <= 15) return 1.3
  return 1
})

// Welcome audio state (plays once on first course load)
const welcomeChecked = ref(false) // True after we've checked welcome status
const isPlayingWelcome = ref(false) // True when welcome audio is playing
const showWelcomeSkip = ref(false) // Show skip button during welcome
const welcomeText = ref('') // Text to display during welcome audio

// Initial state - before user has ever tapped play
const hasEverStarted = ref(false) // True after first play tap (even if welcome plays first)

// Smooth ring progress (0-100) - continuous animation
const ringProgressRaw = ref(0)
let ringAnimationFrame = null
let pauseStartTime = 0
let pauseDuration = DEFAULT_CONFIG.cycle.pause_duration_ms

// Session timer
const sessionSeconds = ref(0)
let sessionTimerInterval = null

const formattedSessionTime = computed(() => {
  const mins = Math.floor(sessionSeconds.value / 60)
  const secs = sessionSeconds.value % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
})

// Computed - use round-based item when available, fallback to session items
const currentItem = computed(() => {
  if (useRoundBasedPlayback.value && currentPlayableItem.value) {
    return currentPlayableItem.value
  }
  return sessionItems.value[currentItemIndex.value]
})
const currentPhrase = computed(() => {
  // While welcome is playing, show listening message
  if (isPlayingWelcome.value) {
    return {
      known: 'Listen to your guide...',
      target: '',
    }
  }
  // Before first play tap, show a welcome message instead of the first phrase
  if (!hasEverStarted.value) {
    return {
      known: 'ready when you are',
      target: '',
    }
  }
  return {
    known: currentItem.value?.phrase?.phrase?.known || '',
    target: currentItem.value?.phrase?.phrase?.target || '',
  }
})
const sessionProgress = computed(() => {
  if (useRoundBasedPlayback.value && cachedRounds.value.length > 0) {
    // Total items across all rounds
    const totalItems = cachedRounds.value.reduce((sum, r) => sum + (r.items?.length || 0), 0)
    return (itemsPracticed.value + 1) / totalItems
  }
  return (itemsPracticed.value + 1) / sessionItems.value.length
})
// Track item transitions to prevent text glitch
// This flag is set TRUE 500ms before VOICE_2 ends, cleared when next PROMPT begins
const isTransitioningItem = ref(false)

// ============================================
// DURATION ESTIMATION
// Build running average from observed data to estimate missing durations
// Uses CHARACTER count (not words) - works across all languages including
// character-based scripts like Chinese/Japanese where each char ≈ 1 syllable
// ============================================
const durationObservations = ref<Array<{ charCount: number; durationMs: number }>>([])
const avgMsPerChar = computed(() => {
  if (durationObservations.value.length === 0) return 120 // Default ~120ms/char (~3 chars/syllable at 400ms/syllable)
  const totalMs = durationObservations.value.reduce((sum, o) => sum + o.durationMs, 0)
  const totalChars = durationObservations.value.reduce((sum, o) => sum + o.charCount, 0)
  return totalChars > 0 ? totalMs / totalChars : 120
})

/**
 * Record an observed duration to improve future estimates
 */
const recordDurationObservation = (targetText: string, durationMs: number) => {
  const charCount = targetText?.length || 0
  if (charCount > 0 && durationMs > 100) {
    durationObservations.value.push({ charCount, durationMs })
    // Keep last 50 observations for rolling average
    if (durationObservations.value.length > 50) {
      durationObservations.value.shift()
    }
  }
}

/**
 * Get duration for an item - uses actual duration if available, estimates from character count otherwise
 * Character count is language-agnostic and approximates syllable count across all scripts
 */
const getEstimatedDuration = (item: any, audioType: 'target1' | 'target2'): number | null => {
  const actualDuration = item?.audioDurations?.[audioType]
  const targetText = item?.phrase?.target || item?.targetText || ''

  if (actualDuration && actualDuration > 0) {
    // Record for future estimates
    if (targetText) {
      recordDurationObservation(targetText, actualDuration * 1000)
    }
    return actualDuration * 1000 // Convert to ms
  }

  // Estimate from character count (language-agnostic proxy for syllables)
  const charCount = targetText.length
  if (charCount > 0) {
    return charCount * avgMsPerChar.value
  }

  return null // No data to estimate from
}

// During transition, fade ALL text (known + target together)
const showAllText = computed(() => !isTransitioningItem.value)

// Target text only visible during VOICE_2 (and not transitioning)
const showTargetText = computed(() =>
  currentPhase.value === Phase.VOICE_2 && !isTransitioningItem.value
)

// Stable known text - only updates when not transitioning (prevents flash on item change)
const displayedKnownText = ref('')
watch([() => isTransitioningItem.value, () => currentPhrase.value.known], ([transitioning, newKnown]) => {
  // Only update when NOT transitioning
  if (!transitioning) {
    displayedKnownText.value = newKnown
  }
}, { immediate: true })

// Stable target text - only updates when text is NOT showing (prevents flash on phrase change)
const displayedTargetText = ref('')
watch([showTargetText, () => currentPhrase.value.target], ([showing, newTarget]) => {
  // Only update displayed text when it's hidden OR when first showing
  if (!showing || !displayedTargetText.value) {
    displayedTargetText.value = newTarget
  }
}, { immediate: true })

// Is current item an intro? (network should fade, show typewriter message)
// NOTE: Only 'intro' items show typewriter. 'debut' items (lego_itself) show normal phrase display.
const isIntroPhase = computed(() => {
  const item = useRoundBasedPlayback.value
    ? currentPlayableItem.value
    : sessionItems.value[currentItemIndex.value]
  return item?.type === 'intro'
})

// Intro typewriter messages - gentle "listen up" prompts during introductions
const INTRO_MESSAGES = [
  '...listen for new item...',
  'right, here we go...',
  '...something new...',
  'listen carefully...',
  '...pay attention...',
  'here it comes...',
]
// Rotate through messages based on round index
const introMessage = computed(() => {
  if (!isIntroPhase.value) return ''
  const idx = currentRoundIndex.value % INTRO_MESSAGES.length
  return INTRO_MESSAGES[idx]
})

// Visible texts for QA reporting - always shows both for context
const visibleTexts = computed(() => ({
  known: currentItem.value?.phrase?.phrase?.known || '',
  target: currentItem.value?.phrase?.phrase?.target || '',
}))

// Phase symbols/icons - CORRECT ORDER
const phaseInfo = computed(() => {
  switch (currentPhase.value) {
    case Phase.PROMPT:
      return { icon: 'speaker', label: 'Listen', instruction: 'Hear the phrase' }
    case Phase.SPEAK:
      return { icon: 'mic', label: 'Speak', instruction: 'Say it in the target language' }
    case Phase.VOICE_1:
      return { icon: 'ear', label: 'Listen', instruction: 'Listen to the answer' }
    case Phase.VOICE_2:
      return { icon: 'eye', label: 'Read', instruction: 'See and hear the answer' }
    default:
      return { icon: 'speaker', label: '', instruction: '' }
  }
})

// Ring progress for SPEAK phase only (0-100)
const ringProgress = computed(() => {
  if (currentPhase.value !== Phase.SPEAK) return 0
  return ringProgressRaw.value
})

// Smooth ring animation using requestAnimationFrame
const animateRing = () => {
  if (!isPlaying.value || currentPhase.value !== Phase.SPEAK) {
    ringAnimationFrame = null
    return
  }

  const elapsed = Date.now() - pauseStartTime
  const progress = Math.min((elapsed / pauseDuration) * 100, 100)

  ringProgressRaw.value = progress

  if (progress < 100) {
    ringAnimationFrame = requestAnimationFrame(animateRing)
  }
}

const startRingAnimation = (duration) => {
  pauseStartTime = Date.now()
  pauseDuration = duration || DEFAULT_CONFIG.cycle.pause_duration_ms
  ringProgressRaw.value = 0
  if (ringAnimationFrame) cancelAnimationFrame(ringAnimationFrame)
  ringAnimationFrame = requestAnimationFrame(animateRing)
}

// Theme is always dark - constellation network designed for dark mode only

// ============================================
// REAL AUDIO CONTROLLER
// Plays actual MP3 audio from S3
// ============================================

class RealAudioController {
  constructor() {
    this.endedCallbacks = new Set()
    // Create audio element immediately for mobile compatibility
    // This ensures intro and cycle audio use the SAME element (mobile unlock)
    this.audio = new Audio()
    this.currentCleanup = null
    this.preloadedUrls = new Set()
    this.skipNextNotify = false  // Set true to skip orchestrator callbacks (for intro/welcome)
    this.suppressAllCallbacks = false  // Set true during skip to prevent any audio callbacks
    this.playGeneration = 0  // Incremented on stop() to invalidate pending callbacks
  }

  async play(audioRef) {
    // Stop any currently playing audio and cleanup handlers
    this.stop()

    const url = audioRef?.url
    if (!url) {
      console.warn('[AudioController] No URL in audioRef:', audioRef)
      this._notifyEnded()
      return Promise.resolve()
    }

    // Capture generation at start of this play - if it changes, this play was cancelled
    const playGen = this.playGeneration || 0

    return new Promise((resolve) => {
      // Audio element is created in constructor for mobile compatibility

      const onEnded = () => {
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
        this.currentCleanup = null
        // Only notify if this play wasn't cancelled by a subsequent stop()
        if (this.playGeneration === playGen) {
          this._notifyEnded()
        }
        resolve()
      }

      const onError = (e) => {
        console.error('[AudioController] Error playing:', url, e)
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
        this.currentCleanup = null
        // Only notify if this play wasn't cancelled
        if (this.playGeneration === playGen) {
          this._notifyEnded()
        }
        resolve()
      }

      // Remove any stale listeners first (if they exist)
      if (this._lastEndedHandler) {
        this.audio.removeEventListener('ended', this._lastEndedHandler)
      }
      if (this._lastErrorHandler) {
        this.audio.removeEventListener('error', this._lastErrorHandler)
      }

      // Track handlers for cleanup
      this._lastEndedHandler = onEnded
      this._lastErrorHandler = onError

      this.audio.addEventListener('ended', onEnded)
      this.audio.addEventListener('error', onError)

      // Store cleanup
      this.currentCleanup = () => {
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
      }

      // Set source and play
      this.audio.src = url
      this.audio.load()

      const playPromise = this.audio.play()
      if (playPromise) {
        playPromise.catch((e) => {
          // NotAllowedError means autoplay blocked - this is expected on mobile
          if (e.name === 'NotAllowedError') {
            console.warn('[AudioController] Autoplay blocked, waiting for audio to be ready')
            // Don't trigger error handler, just wait - user needs to interact
            // For now, advance anyway to keep cycle moving
            onError(e)
          } else {
            onError(e)
          }
        })
      }
    })
  }

  _notifyEnded() {
    // Skip all notifications during skip operation
    if (this.suppressAllCallbacks) {
      console.log('[AudioController] Callbacks suppressed during skip')
      return
    }
    // Skip notification if intro/welcome is playing (they handle their own ended events)
    if (this.skipNextNotify) {
      this.skipNextNotify = false
      return
    }
    // Snapshot callbacks to avoid issues if callbacks modify the Set
    const callbacks = [...this.endedCallbacks]
    for (const cb of callbacks) {
      try { cb() } catch (e) { console.error(e) }
    }
  }

  // Call during skip to suppress all audio callbacks
  suppressCallbacks() {
    this.suppressAllCallbacks = true
  }

  // Call after skip operation completes to re-enable callbacks
  enableCallbacks() {
    this.suppressAllCallbacks = false
  }

  stop() {
    // Increment generation to invalidate any pending play callbacks
    this.playGeneration = (this.playGeneration || 0) + 1

    if (this.currentCleanup) {
      this.currentCleanup()
      this.currentCleanup = null
    }

    // Also clear tracked handlers
    this._lastEndedHandler = null
    this._lastErrorHandler = null

    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
      // Clear src completely - empty string prevents cached audio playback
      // Don't use silent data URI as it can cause race conditions
      this.audio.removeAttribute('src')
      // Don't call load() - just clearing src is enough
      // Don't null the audio element - reuse it for mobile compatibility
    }
  }

  async preload(audioRef) {
    const url = audioRef?.url
    if (!url || this.preloadedUrls.has(url)) return

    // Create a temporary Audio element just to trigger browser caching
    const audio = new Audio()
    audio.preload = 'auto'
    audio.src = url
    audio.load()
    this.preloadedUrls.add(url)
  }

  isPreloaded(audioRef) {
    return this.preloadedUrls.has(audioRef?.url)
  }

  // Clear the preload cache (call on skip to prevent stale audio)
  clearPreloadCache() {
    this.preloadedUrls.clear()
  }

  isPlaying() {
    return this.audio && !this.audio.paused
  }

  getCurrentTime() {
    return this.audio?.currentTime || 0
  }

  onEnded(cb) { this.endedCallbacks.add(cb) }
  offEnded(cb) { this.endedCallbacks.delete(cb) }
}

// ============================================
// ENGINE EVENT HANDLING
// ============================================

const handleCycleEvent = (event) => {
  console.log('[CycleEvent]', event.type, event.phase, event.data)

  switch (event.type) {
    case 'phase_changed':
      // Handle phase-specific logic
      switch (event.phase) {
        case CyclePhase.PROMPT:
          // Clear transition flag - new cycle has started, safe to show text again
          isTransitioningItem.value = false
          // Timing analysis: end previous cycle, start new one
          if (isAdaptationActive.value) {
            if (timingAnalyzer.value?.isAnalyzing()) {
              const item = currentItem.value
              const modelDuration = item?.audioDurations?.target1 ? item.audioDurations.target1 * 1000 : 2000
              endTimingCycle(modelDuration)
            }
            startTimingCycle()
          }
          break
        case CyclePhase.TRANSITION:
          // Hide target text immediately when TRANSITION starts
          // This ensures text fades BEFORE the next item's data arrives
          isTransitioningItem.value = true
          break
        case CyclePhase.PAUSE:
          // Mark phase for timing analyzer (if adaptation enabled)
          if (isAdaptationActive.value) {
            markPhaseTransition('PROMPT_END')
            markPhaseTransition('PAUSE')
          }
          break
        case CyclePhase.VOICE_1:
          if (isAdaptationActive.value) markPhaseTransition('VOICE_1')
          // Voice 1: Nodes light up in sequence (NO edges, NO labels)
          // Learner is listening - visual follows the audio timing
          {
            const itemForVoice1 = useRoundBasedPlayback.value
              ? currentPlayableItem.value
              : sessionItems.value[currentItemIndex.value]
            if (itemForVoice1) {
              const legoIds = extractLegoIdsFromPhrase(itemForVoice1)
              if (legoIds.length > 0) {
                // Get audio duration for timing sync - uses actual or estimates from word count
                const audioDurationMs = getEstimatedDuration(itemForVoice1, 'target1')
                distinctionNetwork.animateNodesForVoice1(legoIds, audioDurationMs || 2000)
              }
            }
          }
          break
        case CyclePhase.VOICE_2:
          if (isAdaptationActive.value) markPhaseTransition('VOICE_2')
          // Voice 2: Full experience - nodes + edges + labels
          // Text is now visible, show the full pathway with traveling pulses
          {
            const currentItemForPath = useRoundBasedPlayback.value
              ? currentPlayableItem.value
              : sessionItems.value[currentItemIndex.value]
            if (currentItemForPath) {
              const legoIds = extractLegoIdsFromPhrase(currentItemForPath)
              if (legoIds.length > 0) {
                // Get audio duration for network animation timing
                const audioDurationMs = getEstimatedDuration(currentItemForPath, 'target2')
                distinctionNetwork.animatePathForVoice2(legoIds, audioDurationMs || 2000)
                // Text visibility is now purely phase-driven:
                // - Target text appears when VOICE_2 starts (showTargetText computed)
                // - Text hides when TRANSITION starts (isTransitioningItem set in TRANSITION case)
                // No need for early-fade timeouts - phases drive everything
              }
              // Find M-LEGOs with partial word overlap (resonance effect)
              const resonating = findResonatingNodes(currentItemForPath, legoIds)
              resonatingNodes.value = resonating
              if (resonating.length > 0) {
                console.log(`[Network] Resonating M-LEGOs (partial match):`, resonating)
              }
            }
          }
          break
      }
      currentPhase.value = corePhaseToUiPhase(event.phase)
      break

    case 'pause_started':
      // Start the ring animation for the SPEAK phase
      startRingAnimation(event.data?.duration)
      break

    case 'item_completed':
      itemsPracticed.value++

      // Clear path highlights - cycle is complete, ready for next item
      distinctionNetwork.clearPathAnimation()
      resonatingNodes.value = []

      // End timing cycle and capture results
      const completedItem = useRoundBasedPlayback.value
        ? currentPlayableItem.value
        : sessionItems.value[currentItemIndex.value]

      if (isAdaptationActive.value && timingAnalyzer.value?.isAnalyzing()) {
        const modelDuration = completedItem?.audioDurations?.target1
          ? completedItem.audioDurations.target1 * 1000
          : 2000
        endTimingCycle(modelDuration)
      }

      // "Fire together, wire together" - strengthen edges between LEGOs in this phrase
      if (completedItem) {
        const phraseLegoIds = extractLegoIdsFromPhrase(completedItem)
        if (phraseLegoIds.length >= 2) {
          strengthenPhrasePath(phraseLegoIds)
        }
      }

      // Track turbo usage for session multiplier
      totalCycles.value++
      if (turboActive.value) {
        turboCycles.value++
      }

      // Trigger floating reward animation (Ink Spirit)
      const { points, bonusLevel } = calculateCyclePoints()
      // Apply session multiplier (hidden from user - they just see higher points)
      const multipliedPoints = Math.round(points * sessionMultiplier.value)
      sessionPoints.value += multipliedPoints
      triggerRewardAnimation(multipliedPoints, bonusLevel)

      // Record progress if database is available
      if (completedItem) {
        learningSession.recordCycleComplete(completedItem).catch(err => {
          console.error('[LearningPlayer] Failed to record progress:', err)
        })
      }

      // ============================================
      // ROUND-BASED PROGRESSION
      // ============================================
      if (useRoundBasedPlayback.value) {
        // Advance within current round
        currentItemInRound.value++

        // Check if round is complete
        if (currentItemInRound.value >= currentRound.value.items.length) {
          const completedLegoId = currentRound.value.legoId
          const completedRoundIndex = currentRoundIndex.value
          console.log('[LearningPlayer] Round', completedRoundIndex, 'complete! LEGO:', completedLegoId)

          // Persist progress (async, fire-and-forget)
          saveRoundProgress(completedLegoId, completedRoundIndex)

          // Handle round boundary events (belt check, encouragements, breaks)
          handleRoundBoundary(completedRoundIndex, completedLegoId)

          // Move to next round
          currentRoundIndex.value++
          currentItemInRound.value = 0

          // Check if we've completed all rounds
          if (currentRoundIndex.value >= cachedRounds.value.length) {
            console.log('[LearningPlayer] All rounds complete!')
            showPausedSummary()
            return
          }

          console.log('[LearningPlayer] Starting round', currentRoundIndex.value, 'LEGO:', cachedRounds.value[currentRoundIndex.value].legoId)
        }

        // Get next script item and convert to playable
        const nextScriptItem = currentRound.value?.items[currentItemInRound.value]
        if (!nextScriptItem) {
          console.warn('[LearningPlayer] No next script item found')
          return
        }

        // Capture current generation - if it changes (user jumped), this callback becomes stale
        const generationAtStart = playbackGeneration.value

        // Start next item after delay (ensure text transitions complete)
        // CSS transition is 300ms, so wait 350ms to be safe
        setTimeout(async () => {
          // CRITICAL: Check if we've jumped since this callback was queued
          if (playbackGeneration.value !== generationAtStart) {
            console.log('[LearningPlayer] Stale callback detected (generation mismatch), skipping')
            return
          }
          if (!isPlaying.value || !orchestrator.value) return

          // Ensure previous audio is fully stopped
          if (audioController.value) {
            audioController.value.stop()
          }

          // INTRO items: play introduction audio directly, then advance
          if (nextScriptItem.type === 'intro') {
              console.log('[LearningPlayer] Playing INTRO item for:', nextScriptItem.legoId)
              const introPlayable = await scriptItemToPlayableItem(nextScriptItem)
              if (introPlayable) {
                currentPlayableItem.value = introPlayable
                // Play intro audio and wait for completion
                const introPlayed = await playIntroductionAudioDirectly(nextScriptItem)
                if (introPlayed) {
                  console.log('[LearningPlayer] INTRO complete, advancing to next item')
                }
                // Advance to next item in round (the DEBUT that follows)
                currentItemInRound.value++
                // Get and play the next item directly (don't call handleCycleEvent which would double-increment)
                const followingItem = currentRound.value?.items[currentItemInRound.value]
                if (followingItem && isPlaying.value) {
                  const followingPlayable = await scriptItemToPlayableItem(followingItem)
                  if (followingPlayable) {
                    currentPlayableItem.value = followingPlayable
                    if (followingPlayable.audioDurations) {
                      const pauseMs = getPauseDuration(Math.round(followingPlayable.audioDurations.target1 * 1000))
                      orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
                    }
                    orchestrator.value.startItem(followingPlayable)
                  }
                }
              }
              return
            }

            const nextPlayable = await scriptItemToPlayableItem(nextScriptItem)
            if (nextPlayable) {
              // Update pause duration: 1.5s boot up + target1 duration
              if (nextPlayable.audioDurations) {
                const pauseMs = getPauseDuration(Math.round(nextPlayable.audioDurations.target1 * 1000))
                orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
              }
              // Store for currentItem computed
              currentPlayableItem.value = nextPlayable
              orchestrator.value.startItem(nextPlayable)
            }
        }, 350)
      } else {
        // ============================================
        // FALLBACK: SESSION-BASED PROGRESSION (demo mode)
        // ============================================
        // Move to next item - skip identical consecutive phrases
        let nextIndex = (currentItemIndex.value + 1) % sessionItems.value.length
        let nextItem = sessionItems.value[nextIndex]

        // Prevent identical consecutive phrases (same known AND target text)
        const maxSkips = sessionItems.value.length // Don't infinite loop
        let skips = 0
        while (
          skips < maxSkips &&
          nextItem &&
          completedItem &&
          nextItem.phrase?.phrase?.known === completedItem.phrase?.phrase?.known &&
          nextItem.phrase?.phrase?.target === completedItem.phrase?.phrase?.target
        ) {
          console.log('[LearningPlayer] Skipping duplicate phrase:', nextItem.phrase?.phrase?.target)
          nextIndex = (nextIndex + 1) % sessionItems.value.length
          nextItem = sessionItems.value[nextIndex]
          skips++
        }
        currentItemIndex.value = nextIndex

        // Update pause duration: 1.5s boot up + target1 duration
        // Unless turbo mode is active
        if (nextItem?.audioDurations) {
          const pauseMs = getPauseDuration(Math.round(nextItem.audioDurations.target1 * 1000))
          orchestrator.value?.updateConfig({ pause_duration_ms: pauseMs })
        }

        // Capture generation for stale callback detection
        const genAtStart = playbackGeneration.value

        // Start next item (with introduction if needed)
        // CSS transition is 300ms, wait 350ms to ensure text fades complete
        setTimeout(async () => {
          // Check if we've jumped since this callback was queued
          if (playbackGeneration.value !== genAtStart) {
            console.log('[LearningPlayer] Stale session callback (generation mismatch), skipping')
            return
          }
          if (isPlaying.value && orchestrator.value) {
            // Ensure previous audio is fully stopped
            if (audioController.value) {
              audioController.value.stop()
            }
            // Check if next LEGO needs an introduction first
            await playIntroductionIfNeeded(nextItem)
            // Then start the practice cycles
            if (isPlaying.value) {
              orchestrator.value.startItem(nextItem)
            }
          }
        }, 350)
      }
      break

    case 'cycle_stopped':
      isPlaying.value = false
      break

    case 'error':
      console.error('[CycleOrchestrator Error]', event.data?.error)
      break
  }
}

// Tap on ring to toggle play/stop
const handleRingTap = () => {
  if (isPlaying.value) {
    handlePause()
  } else {
    handleResume()
  }
}

// Zoom controls for network view
const handleZoomIn = () => {
  if (networkViewRef.value?.currentZoom) {
    const current = networkViewRef.value.currentZoom.value || 1
    const newZoom = Math.min(current * 1.3, 4)
    networkViewRef.value?.zoomTo(newZoom)
  }
}

const handleZoomOut = () => {
  if (networkViewRef.value?.currentZoom) {
    const current = networkViewRef.value.currentZoom.value || 1
    const newZoom = Math.max(current / 1.3, 0.3)
    networkViewRef.value?.zoomTo(newZoom)
  }
}

const handleZoomReset = () => {
  networkViewRef.value?.zoomTo(1)
  networkViewRef.value?.centerView(true)
}

const handlePause = () => {
  isPlaying.value = false

  // Stop introduction audio if playing
  if (isPlayingIntroduction.value) {
    skipIntroduction()
  }

  // Stop welcome audio if playing
  if (isPlayingWelcome.value) {
    skipWelcome()
  }

  if (orchestrator.value) {
    orchestrator.value.stop()
  }
  if (ringAnimationFrame) {
    cancelAnimationFrame(ringAnimationFrame)
  }
}

const handleResume = () => {
  // On first play, ask for adaptation consent (user gesture context)
  // Wait for response before starting playback
  if (adaptationConsent.value === null) {
    showAdaptationPrompt.value = true
    return // Don't start until consent is resolved
  }

  startPlayback()
}

/**
 * Check if a LEGO needs its introduction played.
 * Returns true if intro was played (caller should wait for it to finish).
 */
const playIntroductionIfNeeded = async (item) => {
  console.log('[LearningPlayer] playIntroductionIfNeeded called:', {
    legoId: item?.lego?.id,
    isNew: item?.lego?.new,
    phraseType: item?.phrase?.phraseType,
  })

  // Only play intro for new LEGOs
  if (!item?.lego?.new) {
    console.log('[LearningPlayer] Skipping intro - LEGO not new')
    return false
  }

  const legoId = item.lego.id

  // Skip if already played this session
  if (playedIntroductions.value.has(legoId)) {
    console.log('[LearningPlayer] Skipping intro - already played this session')
    return false
  }

  // Check if introduction audio exists in database
  if (!courseDataProvider.value) {
    console.log('[LearningPlayer] Skipping intro - no courseDataProvider')
    return false
  }

  try {
    const introAudio = await courseDataProvider.value.getIntroductionAudio(legoId)
    console.log('[LearningPlayer] Intro audio lookup result:', introAudio)
    if (!introAudio || !introAudio.url) {
      console.log('[LearningPlayer] Skipping intro - no audio found')
      return false
    }

    console.log('[LearningPlayer] Playing introduction for LEGO:', legoId)

    // Mark as playing intro
    isPlayingIntroduction.value = true
    introductionPhase.value = true
    playedIntroductions.value.add(legoId)

    // Play intro using shared audio element (for mobile compatibility)
    // Set skipNextNotify to prevent orchestrator callbacks from firing when intro ends
    return new Promise((resolve) => {
      audioController.value?.stop()

      // Tell audioController to skip notifying orchestrator when this audio ends
      if (audioController.value) {
        audioController.value.skipNextNotify = true
      }

      const audio = audioController.value?.audio || new Audio()

      const onEnded = () => {
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        isPlayingIntroduction.value = false
        introductionPhase.value = false
        // Reset skipNextNotify so next audio triggers orchestrator callbacks
        if (audioController.value) {
          audioController.value.skipNextNotify = false
        }
        console.log('[LearningPlayer] Introduction complete for LEGO:', legoId)
        resolve(true)
      }

      const onError = (e) => {
        console.error('[LearningPlayer] Introduction audio error:', e)
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        isPlayingIntroduction.value = false
        introductionPhase.value = false
        // Reset skipNextNotify so next audio triggers orchestrator callbacks
        if (audioController.value) {
          audioController.value.skipNextNotify = false
        }
        resolve(false)
      }

      audio.addEventListener('ended', onEnded)
      audio.addEventListener('error', onError)
      audio.src = introAudio.url
      audio.load()

      audio.play().catch((e) => {
        console.error('[LearningPlayer] Failed to play introduction:', e)
        onError(e)
      })
    })
  } catch (err) {
    console.error('[LearningPlayer] Error checking for introduction:', err)
    return false
  }
}

/**
 * Play introduction/presentation audio directly for a LEGO (for script-based playback).
 * Unlike playIntroductionIfNeeded, this doesn't check if the LEGO is "new" -
 * it just plays the intro audio for the given legoId.
 *
 * v14: Handles two presentation modes based on origin:
 * - origin='human' (Welsh): Single pre-recorded file - play once
 * - origin='tts'/'ai': TTS sequence - presentation → pause → target1 → pause → target2
 */
const playIntroductionAudioDirectly = async (scriptItem) => {
  const legoId = scriptItem?.legoId
  console.log('[LearningPlayer] playIntroductionAudioDirectly for:', legoId)

  // Skip if already played this session
  if (playedIntroductions.value.has(legoId)) {
    console.log('[LearningPlayer] Intro already played this session for:', legoId)
    return false
  }

  // Get audio from currentPlayableItem for target voices
  const playable = currentPlayableItem.value
  if (!playable) {
    console.log('[LearningPlayer] No currentPlayableItem for intro')
    return false
  }

  // Get target audio URLs from the playable item
  const target1Url = playable.lego?.audioRefs?.target?.voice1?.url
  const target2Url = playable.lego?.audioRefs?.target?.voice2?.url

  // Get PRESENTATION audio - v13: use presentationAudio from script item (already resolved)
  // This is the narration: "The Welsh for 'X' is..."
  let presentationUrl = scriptItem?.presentationAudio?.url

  // Fallback: try audioMap cache (for backwards compatibility with cached scripts)
  if (!presentationUrl) {
    presentationUrl = await getAudioUrlFromCache(
      supabase.value,
      '', // text not used for intro
      'intro',
      { legoId }
    )
  }

  // Last resort: query database directly
  if (!presentationUrl && courseDataProvider.value) {
    console.log('[LearningPlayer] Presentation not in script, querying database for:', legoId)
    const introAudio = await courseDataProvider.value.getIntroductionAudio(legoId)
    if (introAudio?.url) {
      presentationUrl = introAudio.url
    }
  }

  console.log('[LearningPlayer] Intro audio:', {
    presentation: presentationUrl ? 'YES' : 'NO',
    target1: target1Url ? 'YES' : 'NO',
    target2: target2Url ? 'YES' : 'NO',
    fromScript: !!scriptItem?.presentationAudio?.url
  })

  // If no presentation audio, skip intro entirely
  if (!presentationUrl) {
    console.log('[LearningPlayer] No presentation audio for intro - skipping')
    return false
  }

  // Mark as playing intro (don't mark as "played" until successful completion)
  isPlayingIntroduction.value = true
  introductionPhase.value = true

  // Helper to play a single audio and wait for it to end
  const playAudioAndWait = (url) => {
    return new Promise((resolve) => {
      const audio = audioController.value?.audio || new Audio()
      introAudioElement = audio

      const cleanup = () => {
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
      }

      const onEnded = () => {
        cleanup()
        resolve(true)
      }

      const onError = (e) => {
        console.error('[LearningPlayer] Audio error:', e)
        cleanup()
        resolve(false)
      }

      audio.addEventListener('ended', onEnded)
      audio.addEventListener('error', onError)
      audio.src = url
      audio.load()
      audio.play().catch(onError)
    })
  }

  // Helper to pause for a duration
  const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  if (audioController.value) {
    audioController.value.stop()
    audioController.value.skipNextNotify = true
  }

  try {
    // Check origin - human recordings (Welsh) already contain target audio
    // TTS recordings need target1/target2 added separately
    const origin = scriptItem?.presentationAudio?.origin || 'tts'
    const isHumanRecording = origin === 'human'

    console.log('[LearningPlayer] Playing intro sequence for:', legoId, '(origin:', origin, ')')

    // 1. Play presentation audio ("The Spanish for 'X', as in 'Y', is:")
    console.log('[LearningPlayer] Playing presentation:', presentationUrl)
    await playAudioAndWait(normalizeAudioUrl(presentationUrl))

    // 2. Play target voices ONLY for TTS intros (human recordings already include them)
    if (!isHumanRecording) {
      // 2a. Play target voice 1 with pause (from LEGO phrase data)
      if (target1Url) {
        await pause(1000)
        console.log('[LearningPlayer] Playing target1:', target1Url)
        await playAudioAndWait(normalizeAudioUrl(target1Url))
      }

      // 2b. Play target voice 2 with pause (from LEGO phrase data)
      if (target2Url) {
        await pause(1000)
        console.log('[LearningPlayer] Playing target2:', target2Url)
        await playAudioAndWait(normalizeAudioUrl(target2Url))
      }
    } else {
      console.log('[LearningPlayer] Human recording - skipping target1/target2 (already in presentation)')
    }

    // Success - mark as played so it won't repeat this session
    playedIntroductions.value.add(legoId)

    // Add LEGO node to the brain network visualization
    const targetText = playable.lego?.lego?.target || scriptItem?.targetText || ''
    const knownText = playable.lego?.lego?.known || scriptItem?.knownText || ''
    addNetworkNode(legoId, targetText, knownText, currentBelt.value?.name || 'white')

    // Cleanup
    isPlayingIntroduction.value = false
    introductionPhase.value = false
    introAudioElement = null
    if (audioController.value) {
      audioController.value.skipNextNotify = false
    }
    console.log('[LearningPlayer] Introduction complete for:', legoId)
    return true

  } catch (err) {
    console.error('[LearningPlayer] Error playing introduction:', err)
    isPlayingIntroduction.value = false
    introductionPhase.value = false
    introAudioElement = null
    if (audioController.value) {
      audioController.value.skipNextNotify = false
    }
    return false
  }
}

/**
 * Play welcome/introduction audio if this is the learner's first time with the course.
 * Checks cached course introduction first, then falls back to database lookup.
 * Returns true if welcome was played (or skipped), false if no welcome needed.
 */
let welcomeAudioElement = null // Store reference for skip functionality
let welcomeResolve = null // Store resolve function so skip can complete the promise
let introAudioElement = null // Store reference for intro skip functionality

const playWelcomeIfNeeded = async () => {
  // Only check once per session
  if (welcomeChecked.value) return false
  welcomeChecked.value = true

  try {
    // If resuming beyond round 1, they've obviously already heard/skipped the welcome
    if (currentRoundIndex.value > 0) {
      console.log('[LearningPlayer] Resuming at round', currentRoundIndex.value + 1, '- skipping welcome')
      return false
    }

    // If learner has any progress (seeds > 0), they've already done a session
    // This covers guests who can't persist welcome_played to database
    if (completedSeeds.value > 0) {
      console.log('[LearningPlayer] Learner has progress (', completedSeeds.value, 'seeds) - skipping welcome')
      return false
    }

    // Check if learner has already heard the welcome (requires courseDataProvider)
    if (courseDataProvider.value) {
      const alreadyPlayed = await courseDataProvider.value.hasPlayedWelcome(learnerId.value)
      if (alreadyPlayed) {
        console.log('[LearningPlayer] Welcome already played for this learner')
        return false
      }
    }

    // Get welcome audio - prefer cached course welcome, fall back to database
    let welcomeAudio = null

    // Try cached course welcome first (from database via cache)
    if (cachedCourseWelcome.value && (cachedCourseWelcome.value.s3_key || cachedCourseWelcome.value.id)) {
      // Use s3_key if available (new format), fall back to id (legacy)
      const s3Key = cachedCourseWelcome.value.s3_key
      const welcomeId = cachedCourseWelcome.value.id
      const audioUrl = s3Key
        ? `${AUDIO_S3_BASE_URL}/${s3Key}`
        : `${AUDIO_S3_BASE_URL}/${welcomeId.toUpperCase()}.mp3`
      welcomeAudio = {
        id: welcomeId,
        url: audioUrl,
        duration_ms: cachedCourseWelcome.value.duration || null,
        text: cachedCourseWelcome.value.text || null,
      }
      console.log('[LearningPlayer] Using cached course welcome:', welcomeId || s3Key)
    }
    // Fall back to database lookup
    else if (courseDataProvider.value) {
      welcomeAudio = await courseDataProvider.value.getWelcomeAudio()
    }

    if (!welcomeAudio || !welcomeAudio.url) {
      console.log('[LearningPlayer] No welcome audio for this course')
      // Mark as played anyway so we don't keep checking
      if (courseDataProvider.value) {
        await courseDataProvider.value.markWelcomePlayed(learnerId.value)
      }
      return false
    }

    console.log('[LearningPlayer] Playing welcome audio:', welcomeAudio.id)
    isPlayingWelcome.value = true
    showWelcomeSkip.value = true
    welcomeText.value = welcomeAudio.text || 'Welcome to your course'

    // Play welcome using shared audio element (for mobile compatibility)
    // Set skipNextNotify to prevent orchestrator callbacks from firing when welcome ends
    return new Promise((resolve) => {
      welcomeResolve = resolve // Store so skipWelcome can resolve
      audioController.value?.stop()

      // Tell audioController to skip notifying orchestrator when this audio ends
      if (audioController.value) {
        audioController.value.skipNextNotify = true
      }

      const audio = audioController.value?.audio || new Audio()
      welcomeAudioElement = audio

      const cleanup = async () => {
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        isPlayingWelcome.value = false
        showWelcomeSkip.value = false
        welcomeAudioElement = null
        welcomeResolve = null
        // Reset skipNextNotify so next audio triggers orchestrator callbacks
        if (audioController.value) {
          audioController.value.skipNextNotify = false
        }
        // Mark as played
        if (courseDataProvider.value) {
          await courseDataProvider.value.markWelcomePlayed(learnerId.value)
        }
      }

      const onEnded = async () => {
        console.log('[LearningPlayer] Welcome audio complete')
        await cleanup()
        resolve(true)
      }

      const onError = async (e) => {
        console.error('[LearningPlayer] Welcome audio error:', e)
        await cleanup()
        resolve(false)
      }

      audio.addEventListener('ended', onEnded)
      audio.addEventListener('error', onError)
      audio.src = welcomeAudio.url
      audio.load()

      audio.play().catch((e) => {
        console.error('[LearningPlayer] Failed to play welcome:', e)
        onError(e)
      })
    })
  } catch (err) {
    console.error('[LearningPlayer] Error checking for welcome:', err)
    return false
  }
}

const skipWelcome = async () => {
  if (welcomeAudioElement) {
    welcomeAudioElement.pause()
    welcomeAudioElement.currentTime = 0
  }
  isPlayingWelcome.value = false
  showWelcomeSkip.value = false
  welcomeAudioElement = null

  // Reset skipNextNotify so next audio triggers orchestrator callbacks
  if (audioController.value) {
    audioController.value.skipNextNotify = false
  }

  // Resolve the promise so startPlayback can continue
  if (welcomeResolve) {
    welcomeResolve(true)
    welcomeResolve = null
  }

  // Mark as played (skipped counts as played)
  if (courseDataProvider.value) {
    await courseDataProvider.value.markWelcomePlayed(learnerId.value)
  }
  console.log('[LearningPlayer] Welcome skipped')
}

const skipIntroduction = () => {
  if (introAudioElement) {
    // Remove all event listeners to prevent stale callbacks
    introAudioElement.onended = null
    introAudioElement.onerror = null
    introAudioElement.pause()
    introAudioElement.currentTime = 0
    // Clear src to fully reset
    introAudioElement.removeAttribute('src')
  }
  isPlayingIntroduction.value = false
  introductionPhase.value = false
  introAudioElement = null
  console.log('[LearningPlayer] Introduction skipped')
}

const startPlayback = async () => {
  hasEverStarted.value = true
  isPlaying.value = true

  // Start belt progress session for time tracking
  if (beltProgress.value) {
    beltProgress.value.startSession()
  }

  // Check if welcome audio needs to play first (only on first ever play)
  await playWelcomeIfNeeded()

  // ============================================
  // ROUND-BASED PLAYBACK
  // ============================================
  if (useRoundBasedPlayback.value && orchestrator.value) {
    // Get the first item from the current round
    const scriptItem = currentRound.value?.items[currentItemInRound.value]
    if (!scriptItem) {
      console.warn('[LearningPlayer] No script item to play')
      return
    }

    console.log('[LearningPlayer] Starting round-based playback, round:', currentRoundIndex.value, 'LEGO:', currentRound.value?.legoId)
    console.log('[LearningPlayer] Current scriptItem:', {
      type: scriptItem.type,
      legoId: scriptItem.legoId,
      knownText: scriptItem.knownText,
      targetText: scriptItem.targetText
    })

    // INTRO items: play intro audio directly, then advance to next item
    if (scriptItem.type === 'intro') {
      console.log('[LearningPlayer] First item is INTRO for:', scriptItem.legoId)
      const playableItem = await scriptItemToPlayableItem(scriptItem)
      if (playableItem) {
        currentPlayableItem.value = playableItem
        // Play intro audio and wait for completion
        await playIntroductionAudioDirectly(scriptItem)
        // Advance to next item in round (the DEBUT that follows)
        currentItemInRound.value++
        // Get and play the next item directly (don't call handleCycleEvent which would double-increment)
        const nextItem = currentRound.value?.items[currentItemInRound.value]
        if (nextItem && isPlaying.value) {
          const nextPlayable = await scriptItemToPlayableItem(nextItem)
          if (nextPlayable) {
            currentPlayableItem.value = nextPlayable
            if (nextPlayable.audioDurations) {
              const pauseMs = getPauseDuration(Math.round(nextPlayable.audioDurations.target1 * 1000))
              orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
            }
            orchestrator.value.startItem(nextPlayable)
          }
        }
      }
      return
    }

    // Convert to playable item
    const playableItem = await scriptItemToPlayableItem(scriptItem)
    if (!playableItem) {
      console.error('[LearningPlayer] Failed to convert script item')
      return
    }

    // Store for currentItem computed
    currentPlayableItem.value = playableItem

    // Set pause duration: 1.5s boot up + target1 duration
    if (playableItem.audioDurations) {
      const pauseMs = getPauseDuration(Math.round(playableItem.audioDurations.target1 * 1000))
      orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
    }

    orchestrator.value.startItem(playableItem)
    return
  }

  // ============================================
  // FALLBACK: SESSION-BASED PLAYBACK (demo mode)
  // ============================================
  if (orchestrator.value && currentItem.value) {
    // Check if this LEGO needs an introduction first
    await playIntroductionIfNeeded(currentItem.value)

    // Set pause duration: 1.5s boot up + target1 duration
    if (currentItem.value.audioDurations) {
      const pauseMs = getPauseDuration(Math.round(currentItem.value.audioDurations.target1 * 1000))
      orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
    }
    orchestrator.value.startItem(currentItem.value)
  }
}

/**
 * SKIP - Jump to start of NEXT round
 * IMPORTANT: Must fully halt all audio before advancing
 */
const handleSkip = async () => {
  console.log('[LearningPlayer] Skip requested - halting all audio')

  // 0. IMMEDIATELY suppress all audio callbacks to prevent race conditions
  if (audioController.value?.suppressCallbacks) {
    audioController.value.suppressCallbacks()
  }

  // 1. HALT EVERYTHING - stop orchestrator first (prevents new audio from starting)
  if (orchestrator.value) {
    orchestrator.value.stop()
  }

  // 2. Stop audio controller (stops current playback and clears any pending listeners)
  if (audioController.value) {
    audioController.value.stop()
    // Clear preload cache to prevent stale audio from previous round
    audioController.value.clearPreloadCache()
  }

  // 3. Skip any playing intro/welcome
  if (isPlayingIntroduction.value) {
    skipIntroduction()
  }
  if (isPlayingWelcome.value) {
    skipWelcome()
  }

  // 4. Clear any path animations
  clearPathAnimation()

  // 5. Delay to ensure everything is settled (audio stops + text transitions complete)
  // CSS text transition is 300ms, so 150ms is a reasonable buffer after stopping audio
  await new Promise(resolve => setTimeout(resolve, 150))

  // 6. Re-enable callbacks AFTER skip navigation is complete
  // (this happens at end of function)

  // Round-based navigation
  if (useRoundBasedPlayback.value && cachedRounds.value.length) {
    let nextIndex = currentRoundIndex.value + 1

    // Check if we're at/near the end and need expansion
    if (nextIndex >= cachedRounds.value.length - EXPANSION_THRESHOLD) {
      console.log('[LearningPlayer] Skip: Near end, triggering expansion...')
      await expandScript()
    }

    // Re-check after expansion
    if (nextIndex >= cachedRounds.value.length) {
      console.log('[LearningPlayer] Skip: Reached end of course (no more content)')
      showPausedSummary()
      return
    }

    currentRoundIndex.value = nextIndex
    currentItemInRound.value = 0
    // Don't increment roundsThisSession when skipping - only natural completion counts

    // Update belt to match new position (NO celebration when skipping - only natural completion)
    updateBeltForPosition(nextIndex, false)

    // Populate network with all LEGOs up to this point (backfill skipped nodes)
    populateNetworkUpToRound(nextIndex)

    console.log('[LearningPlayer] Skip → Round', nextIndex, 'LEGO:', cachedRounds.value[nextIndex]?.legoId)

    // Always get the first item to update display
    const firstItem = cachedRounds.value[nextIndex]?.items?.[0]
    console.log('[LearningPlayer] Skip → firstItem:', firstItem?.type, firstItem?.knownText, '→', firstItem?.targetText)

    // Update display (even when paused)
    if (firstItem) {
      const playable = await scriptItemToPlayableItem(firstItem)
      if (playable) {
        currentPlayableItem.value = playable
      }
    }

    // Start the new round if playing
    if (isPlaying.value && firstItem) {
      // INTRO items: play introduction audio directly, then advance to next item
      if (firstItem.type === 'intro') {
        console.log('[LearningPlayer] Skip → Playing INTRO for:', firstItem.legoId)
        const introPlayed = await playIntroductionAudioDirectly(firstItem)
        console.log('[LearningPlayer] Skip → intro played:', introPlayed)

        // CRITICAL: Fully reset audio state before starting next item
        // This ensures no stale audio from intro contaminates the new playback
        if (audioController.value) {
          audioController.value.stop()
        }

        // Advance to next item (the DEBUT)
        currentItemInRound.value++
        const nextItem = cachedRounds.value[nextIndex]?.items?.[currentItemInRound.value]
        console.log('[LearningPlayer] Skip → advancing to item:', currentItemInRound.value, nextItem?.type)
        if (nextItem && isPlaying.value) {
          const nextPlayable = await scriptItemToPlayableItem(nextItem)
          if (nextPlayable && orchestrator.value) {
            currentPlayableItem.value = nextPlayable
            // Set pause duration for new item
            if (nextPlayable.audioDurations) {
              const pauseMs = getPauseDuration(Math.round(nextPlayable.audioDurations.target1 * 1000))
              orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
            }
            orchestrator.value.startItem(nextPlayable)
          }
        }
      } else {
        console.log('[LearningPlayer] Skip → firstItem NOT intro, starting directly')
        // Non-intro item: start directly via orchestrator
        if (orchestrator.value) {
          orchestrator.value.startItem(currentPlayableItem.value)
        }
      }
    }
  } else {
    // Fallback: skip current phase in demo mode
    if (orchestrator.value) {
      orchestrator.value.skipPhase()
    }
  }

  // Re-enable callbacks now that skip is complete
  if (audioController.value?.enableCallbacks) {
    audioController.value.enableCallbacks()
  }
}

/**
 * REVISIT - Go back to start of current round, or previous round if already at start
 * IMPORTANT: Must fully halt all audio before navigating
 */
const handleRevisit = async () => {
  console.log('[LearningPlayer] Revisit requested - halting all audio')

  // 0. IMMEDIATELY suppress all audio callbacks to prevent race conditions
  if (audioController.value?.suppressCallbacks) {
    audioController.value.suppressCallbacks()
  }

  // 1. HALT EVERYTHING - stop orchestrator first (prevents new events)
  if (orchestrator.value) {
    orchestrator.value.stop()
  }

  // 2. Stop audio controller (stops current playback)
  if (audioController.value) {
    audioController.value.stop()
    // Clear preload cache to prevent stale audio
    audioController.value.clearPreloadCache()
  }

  // 3. Skip any playing intro/welcome
  if (isPlayingIntroduction.value) {
    skipIntroduction()
  }
  if (isPlayingWelcome.value) {
    skipWelcome()
  }

  // 4. Clear path animations
  clearPathAnimation()

  // 5. Delay to ensure everything is settled (audio stops + text transitions complete)
  await new Promise(resolve => setTimeout(resolve, 150))

  // Round-based navigation
  if (useRoundBasedPlayback.value && cachedRounds.value.length) {
    // If we're past the first few items, go to start of current round
    // If already at start (item 0 or 1, since intro auto-advances to 1), go to previous round
    let targetIndex = currentRoundIndex.value
    if (currentItemInRound.value <= 1 && currentRoundIndex.value > 0) {
      targetIndex = currentRoundIndex.value - 1
    }

    currentRoundIndex.value = targetIndex
    currentItemInRound.value = 0

    // Update belt to match new position (no celebration when going back)
    updateBeltForPosition(targetIndex, false)

    console.log('[LearningPlayer] Revisit → Round', targetIndex, 'LEGO:', cachedRounds.value[targetIndex]?.legoId)

    // Always get the first item to update display
    const firstItem = cachedRounds.value[targetIndex]?.items?.[0]
    console.log('[LearningPlayer] Revisit → firstItem:', firstItem?.type, firstItem?.knownText, '→', firstItem?.targetText)

    // Update display (even when paused)
    if (firstItem) {
      const playable = await scriptItemToPlayableItem(firstItem)
      if (playable) {
        currentPlayableItem.value = playable
      }
    }

    // Start the round if playing
    if (isPlaying.value && firstItem) {
      // INTRO items: play introduction audio directly, then advance to next item
      if (firstItem.type === 'intro') {
        console.log('[LearningPlayer] Revisit → Playing INTRO for:', firstItem.legoId)
        const introPlayed = await playIntroductionAudioDirectly(firstItem)
        console.log('[LearningPlayer] Revisit → intro played:', introPlayed)
        // Advance to next item (the DEBUT)
        currentItemInRound.value++
        const nextItem = cachedRounds.value[targetIndex]?.items?.[currentItemInRound.value]
        console.log('[LearningPlayer] Revisit → advancing to item:', currentItemInRound.value, nextItem?.type)
        if (nextItem && isPlaying.value) {
          const nextPlayable = await scriptItemToPlayableItem(nextItem)
          if (nextPlayable && orchestrator.value) {
            currentPlayableItem.value = nextPlayable
            orchestrator.value.startItem(nextPlayable)
          }
        }
      } else {
        console.log('[LearningPlayer] Revisit → firstItem NOT intro, starting directly')
        // Non-intro item: start directly via orchestrator
        if (orchestrator.value) {
          orchestrator.value.startItem(currentPlayableItem.value)
        }
      }
    }
  } else {
    // Fallback: restart current item in demo mode
    ringProgressRaw.value = 0
    if (orchestrator.value && currentItem.value) {
      orchestrator.value.startItem(currentItem.value)
    }
  }

  // Re-enable callbacks now that revisit is complete
  if (audioController.value?.enableCallbacks) {
    audioController.value.enableCallbacks()
  }
}

/**
 * Jump to a specific round by index (0-based)
 * For QA/Script View: allows jumping to any point in the course
 * Belt progress updates to match position (allows quick calibration)
 * IMPORTANT: Must fully halt all audio before jumping
 */
const jumpToRound = async (roundIndex) => {
  if (!useRoundBasedPlayback.value || !cachedRounds.value.length) {
    console.log('[LearningPlayer] Jump not available - not in round mode')
    return false
  }

  if (roundIndex < 0 || roundIndex >= cachedRounds.value.length) {
    console.log('[LearningPlayer] Invalid round index:', roundIndex)
    return false
  }

  console.log('[LearningPlayer] Jump requested - halting all audio')

  // 0. Increment generation to invalidate any pending callbacks from previous position
  playbackGeneration.value++

  // 1. IMMEDIATELY suppress all audio callbacks to prevent race conditions
  if (audioController.value?.suppressCallbacks) {
    audioController.value.suppressCallbacks()
  }

  // 1. HALT EVERYTHING - stop orchestrator first (prevents new events)
  if (orchestrator.value) {
    orchestrator.value.stop()
  }

  // 2. Stop audio controller
  if (audioController.value) {
    audioController.value.stop()
  }

  // 3. Skip any playing intro/welcome
  if (isPlayingIntroduction.value) {
    skipIntroduction()
  }
  if (isPlayingWelcome.value) {
    skipWelcome()
  }

  // 4. Clear path animations
  clearPathAnimation()

  // 5. Delay to ensure everything is settled
  await new Promise(resolve => setTimeout(resolve, 100))

  const previousIndex = currentRoundIndex.value
  currentRoundIndex.value = roundIndex
  currentItemInRound.value = 0

  // Update belt to match new position (NO celebration when jumping - only natural completion)
  updateBeltForPosition(roundIndex, false)

  // Populate network with all LEGOs up to this point (backfill skipped nodes)
  populateNetworkUpToRound(roundIndex)

  console.log('[LearningPlayer] Jump → Round', roundIndex, 'LEGO:', cachedRounds.value[roundIndex]?.legoId)

  // Always get the first item to update display
  const firstItem = cachedRounds.value[roundIndex]?.items?.[0]
  console.log('[LearningPlayer] Jump → firstItem:', firstItem?.type, firstItem?.knownText, '→', firstItem?.targetText)

  // Update display (even when paused)
  if (firstItem) {
    const playable = await scriptItemToPlayableItem(firstItem)
    if (playable) {
      currentPlayableItem.value = playable
    }
  }

  // Start the round if playing
  if (isPlaying.value && firstItem) {
    // INTRO items: play introduction audio directly, then advance to next item
    if (firstItem.type === 'intro') {
      console.log('[LearningPlayer] Jump → Playing INTRO for:', firstItem.legoId)
      const introPlayed = await playIntroductionAudioDirectly(firstItem)
      console.log('[LearningPlayer] Jump → intro played:', introPlayed)
      // Advance to next item (the DEBUT)
      currentItemInRound.value++
      const nextItem = cachedRounds.value[roundIndex]?.items?.[currentItemInRound.value]
      console.log('[LearningPlayer] Jump → advancing to item:', currentItemInRound.value, nextItem?.type)
      if (nextItem && isPlaying.value) {
        const nextPlayable = await scriptItemToPlayableItem(nextItem)
        if (nextPlayable && orchestrator.value) {
          currentPlayableItem.value = nextPlayable
          orchestrator.value.startItem(nextPlayable)
        }
      }
    } else {
      console.log('[LearningPlayer] Jump → firstItem NOT intro, starting directly')
      // Non-intro item: start directly via orchestrator
      if (orchestrator.value) {
        orchestrator.value.startItem(currentPlayableItem.value)
      }
    }
  }

  // Re-enable callbacks now that jump is complete
  if (audioController.value?.enableCallbacks) {
    audioController.value.enableCallbacks()
  }

  return true
}

/**
 * Jump to start of next belt
 * Expands script if needed, then navigates to the belt boundary
 */
const handleSkipToNextBelt = async () => {
  if (!beltProgress.value || !nextBelt.value) {
    console.log('[LearningPlayer] Cannot skip - no next belt')
    return
  }

  isSkippingBelt.value = true
  const targetSeed = nextBelt.value.seedsRequired
  console.log(`[LearningPlayer] Skipping to ${nextBelt.value.name} belt (seed ${targetSeed})`)

  // Calculate absolute position of currently loaded rounds
  const absoluteEnd = scriptBaseOffset.value + cachedRounds.value.length

  // Expand script if we need more rounds to reach target
  if (targetSeed >= absoluteEnd && courseDataProvider.value) {
    console.log(`[LearningPlayer] Expanding script to reach seed ${targetSeed} (currently at ${absoluteEnd})...`)
    const neededRounds = targetSeed - absoluteEnd + 10 // How many more we need
    const { rounds: moreRounds } = await generateLearningScript(
      courseDataProvider.value,
      neededRounds,
      absoluteEnd  // Expansion offset = base + loaded count
    )
    if (moreRounds.length > 0) {
      cachedRounds.value = [...cachedRounds.value, ...moreRounds]
      console.log(`[LearningPlayer] Expanded to ${cachedRounds.value.length} rounds (base offset: ${scriptBaseOffset.value})`)
    }
  }

  // Convert absolute target to relative round index
  const targetRound = Math.min(targetSeed - scriptBaseOffset.value, cachedRounds.value.length - 1)

  // Jump to the target round
  await jumpToRound(targetRound)

  // Update belt progress to match (uses absolute seed number)
  if (beltProgress.value) {
    beltProgress.value.setSeeds(targetSeed)
  }

  isSkippingBelt.value = false
}

/**
 * Jump back to start of current or previous belt
 * If close to current belt start, goes to previous belt
 * If target is before loaded script, reloads from that position
 */
const handleGoBackBelt = async () => {
  if (!beltProgress.value) {
    console.log('[LearningPlayer] Cannot go back - no belt progress')
    return
  }

  isSkippingBelt.value = true
  const targetSeed = beltProgress.value.goBackToBeltStart()
  console.log(`[LearningPlayer] Going back to seed ${targetSeed}, current base offset: ${scriptBaseOffset.value}`)

  // Check if target is before our currently loaded script
  if (targetSeed < scriptBaseOffset.value) {
    console.log(`[LearningPlayer] Target seed ${targetSeed} is before loaded range (${scriptBaseOffset.value}), reloading script...`)

    // Need to reload script from the target position
    if (courseDataProvider.value) {
      // Stop current playback
      if (orchestrator.value) orchestrator.value.stop()
      if (audioController.value) audioController.value.stop()
      clearPathAnimation()

      // Update base offset and reload
      scriptBaseOffset.value = targetSeed

      const { rounds, allItems } = await generateLearningScript(
        courseDataProvider.value,
        ROUNDS_TO_FETCH,
        targetSeed
      )

      if (rounds.length > 0) {
        cachedRounds.value = rounds
        allPlayableItems.value = allItems

        // Populate network for reloaded rounds (pass targetSeed as offset for correct belt colors)
        populateNetworkFromRounds(rounds, 0, networkConnections.value, targetSeed)

        // Jump to first round (which is now at targetSeed)
        await jumpToRound(0)
        console.log(`[LearningPlayer] Reloaded script from seed ${targetSeed}, now at round 0`)
        isSkippingBelt.value = false
        return
      }
    }
  }

  // Target is within loaded range - simple jump
  const targetRound = Math.max(0, Math.min(targetSeed - scriptBaseOffset.value, cachedRounds.value.length - 1))
  console.log(`[LearningPlayer] Jumping to round ${targetRound} (seed ${targetSeed})`)
  await jumpToRound(targetRound)
  isSkippingBelt.value = false
}

// Mode toggles
const turboActive = ref(false)
const listeningModeComingSoon = ref(false) // Future: passive listening mode

// Belt skip feedback state
const isSkippingBelt = ref(false)

// Helper: Calculate pause duration using current mode config
const getPauseDuration = (targetDurationMs: number): number => {
  const config = turboActive.value ? turboConfig.value : normalConfig.value
  return calculatePause(config, targetDurationMs)
}

// ============================================
// ADAPTATION CONSENT & TIMING
// Learner consents once, then timing runs silently
// ============================================

const ADAPTATION_CONSENT_KEY = 'ssi-adaptation-consent'

// Consent states: null (not asked), true (granted), false (declined)
const adaptationConsent = ref(null)
const showAdaptationPrompt = ref(false)

// Voice Activity Detection (VAD) and Speech Timing state
const vadInstance = shallowRef(null)
const timingAnalyzer = shallowRef(null)
const vadInitialized = ref(false)
const vadInitializing = ref(false)
const isSpeaking = ref(false)
const lastTimingResult = ref(null)
let vadStatusInterval = null

// Load consent from localStorage
const loadAdaptationConsent = () => {
  const stored = localStorage.getItem(ADAPTATION_CONSENT_KEY)
  if (stored === 'true') adaptationConsent.value = true
  else if (stored === 'false') adaptationConsent.value = false
  else adaptationConsent.value = null
}

// Save consent to localStorage
const saveAdaptationConsent = (value) => {
  adaptationConsent.value = value
  localStorage.setItem(ADAPTATION_CONSENT_KEY, String(value))
}

// Handle consent response
const handleAdaptationConsent = async (granted) => {
  showAdaptationPrompt.value = false
  saveAdaptationConsent(granted)

  if (granted) {
    // Initialize VAD now (user gesture context)
    const success = await initializeVad()
    if (success) {
      console.log('[LearningPlayer] Adaptation enabled - timing will run silently')
    }
  } else {
    console.log('[LearningPlayer] Adaptation declined - learning continues normally')
  }

  // Now start playback (consent resolved)
  startPlayback()
}

// Initialize VAD (must be called from user gesture)
const initializeVad = async () => {
  if (vadInitialized.value || vadInitializing.value) return true

  vadInitializing.value = true
  try {
    vadInstance.value = createVoiceActivityDetector({
      energy_threshold_db: -45,
      min_frames_above: 3,
    })

    const success = await vadInstance.value.initialize()
    vadInitialized.value = success

    if (success) {
      // Create the SpeechTimingAnalyzer wrapper
      timingAnalyzer.value = createSpeechTimingAnalyzer(vadInstance.value)
      console.log('[LearningPlayer] VAD + SpeechTimingAnalyzer initialized')
    } else {
      console.warn('[LearningPlayer] VAD initialization failed (mic permission denied?)')
      // If mic denied, treat as declined consent
      saveAdaptationConsent(false)
    }

    return success
  } catch (err) {
    console.error('[LearningPlayer] VAD initialization error:', err)
    return false
  } finally {
    vadInitializing.value = false
  }
}

// Check if adaptation is active (consented + initialized)
const isAdaptationActive = computed(() =>
  adaptationConsent.value === true && vadInitialized.value
)

// Start timing cycle at PROMPT start
const startTimingCycle = () => {
  if (!timingAnalyzer.value || !isAdaptationActive.value) return

  timingAnalyzer.value.startCycle()

  // Poll status for UI feedback during the cycle (subtle, not intrusive)
  vadStatusInterval = setInterval(() => {
    if (vadInstance.value) {
      const status = vadInstance.value.getStatus()
      isSpeaking.value = status.is_speaking
    }
  }, 100) // 10fps - less frequent since it's subtle
}

// Mark phase transition during timing cycle
const markPhaseTransition = (phase) => {
  if (!timingAnalyzer.value || !isAdaptationActive.value) return
  timingAnalyzer.value.onPhaseChange(phase)
}

// End timing cycle and get results
const endTimingCycle = (modelDurationMs) => {
  if (!timingAnalyzer.value) return null

  if (vadStatusInterval) {
    clearInterval(vadStatusInterval)
    vadStatusInterval = null
  }

  const result = timingAnalyzer.value.endCycle(modelDurationMs)
  lastTimingResult.value = result
  isSpeaking.value = false

  if (result.speech_detected) {
    console.log('[LearningPlayer] Timing:', {
      latency: result.response_latency_ms !== null ? Math.round(result.response_latency_ms) + 'ms' : null,
      delta: result.duration_delta_ms !== null ? Math.round(result.duration_delta_ms) + 'ms' : null,
    })
  }

  return result
}

// Show "coming soon" for listening mode
const handleListeningMode = () => {
  listeningModeComingSoon.value = true
  setTimeout(() => {
    listeningModeComingSoon.value = false
  }, 2000)
}

const toggleTurbo = () => {
  turboActive.value = !turboActive.value

  // Update orchestrator config based on algorithm settings
  if (orchestrator.value) {
    const config = turboActive.value ? turboConfig.value : normalConfig.value
    const item = currentItem.value
    const targetDurationMs = item?.audioDurations
      ? Math.round(item.audioDurations.target1 * 1000)
      : 2000 // Fallback

    // Calculate pause using config parameters
    const pauseMs = calculatePause(config, targetDurationMs)
    orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })

    // TODO: Apply playback_speed to audio controller when supported
    // audioController.value?.setPlaybackRate(config.playback_speed)

    console.log(`[Turbo] ${turboActive.value ? 'ON' : 'OFF'} - pause: ${pauseMs}ms, config:`, config)
  }
}

// ============================================
// PAUSE/RESUME HANDLERS
// ============================================

const showPausedSummary = () => {
  // Stop playback and show summary
  if (orchestrator.value) {
    orchestrator.value.stop()
  }
  isPlaying.value = false
  showSessionComplete.value = true

  // End belt progress session (saves session history for time estimates)
  if (beltProgress.value) {
    beltProgress.value.endSession()
  }

  // Increment session count for guests (triggers signup prompt)
  if (auth && itemsPracticed.value > 0) {
    auth.incrementSessionCount()
  }
}

const handleResumeLearning = async () => {
  // Hide summary and continue the infinite stream
  showSessionComplete.value = false
  isPlaying.value = true

  // Start new belt progress session for time tracking
  if (beltProgress.value) {
    beltProgress.value.startSession()
  }

  if (orchestrator.value && currentItem.value) {
    // Check for introduction before starting
    await playIntroductionIfNeeded(currentItem.value)
    if (isPlaying.value) {
      orchestrator.value.startItem(currentItem.value)
    }
  }
}

const handleExit = () => {
  // Stop playback and exit the player
  if (orchestrator.value) {
    orchestrator.value.stop()
  }
  isPlaying.value = false

  // End belt progress session (saves session history)
  if (beltProgress.value) {
    beltProgress.value.endSession()
  }

  emit('close')
}

// ============================================
// DISTINCTION NETWORK FUNCTIONS
// Wrapper functions that delegate to the composable
// ============================================

// Initialize the network visualization
const initializeNetwork = () => {
  // Calculate center - use viewport center for fullscreen network
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  // Get safe area inset for notch/status bar
  // Read from CSS custom property which stores env(safe-area-inset-top)
  const playerEl = document.querySelector('.player')
  const safeAreaTop = playerEl
    ? parseInt(getComputedStyle(playerEl).getPropertyValue('--safe-area-top') || '0', 10)
    : 0

  // Center in the available space:
  // - Header at top: ~60px + safe area
  // - Transport bar at bottom: ~80px
  // So available space is roughly (60 + safeArea) to (height - 80px)
  const headerHeight = 60 + safeAreaTop
  const bottomControlsHeight = 100 // Transport bar + safe area
  const availableTop = headerHeight
  const availableBottom = viewportHeight - bottomControlsHeight
  const centerX = viewportWidth / 2
  const centerY = (availableTop + availableBottom) / 2

  setNetworkCenter(centerX, centerY)
  console.log('[Network] Center set to:', centerX, centerY, `(available: ${availableTop}-${availableBottom})`)

  // Initialize simulation
  distinctionNetwork.initialize()

  // Set initial belt color
  setNetworkBelt(currentBelt.value?.name || 'white')

  console.log('[LearningPlayer] Distinction network initialized (organic growth mode)')
}

// Add a new LEGO node to the network - no longer hero-centered, just adds to network
const addNetworkNode = (legoId, targetText, knownText, beltColor = 'white') => {
  // Use the composable to add the node (makeHero=false for organic growth)
  const added = introduceLegoNode(legoId, targetText, knownText, false)

  if (added) {
    console.log(`[LearningPlayer] Added network node: ${legoId} (${targetText})`)
  }
}

// Populate network with all LEGOs up to a given round index
// Called when skipping/jumping to ensure network reflects all "learned" LEGOs
const populateNetworkUpToRound = (targetRoundIndex) => {
  if (!cachedRounds.value.length) return

  console.log(`[LearningPlayer] populateNetworkUpToRound: ${targetRoundIndex}, connections: ${networkConnections.value.length}`)
  if (networkConnections.value.length > 0) {
    console.log('[LearningPlayer] Sample connections:', networkConnections.value.slice(0, 3))
  }

  // Use composable to populate with database connections (like brain view)
  // Pass scriptBaseOffset so belt colors are correct for mid-course positions
  populateNetworkFromRounds(
    cachedRounds.value,
    targetRoundIndex,
    networkConnections.value.length > 0 ? networkConnections.value : undefined,
    scriptBaseOffset.value
  )
}

// ============================================
// PROGRESSIVE SCRIPT EXPANSION
// Fetches more rounds as learner approaches end of cached content
// ============================================
const expandScript = async () => {
  if (isExpandingScript.value) return
  if (!courseDataProvider.value) return

  isExpandingScript.value = true
  const currentCount = cachedRounds.value.length
  const absoluteOffset = scriptBaseOffset.value + currentCount // Expansion offset = base + loaded count

  try {
    // Double each time, capped at MAX_EXPANSION_BATCH
    // 20 → 40 → 80 → 160 → 200 → 200...
    const fetchCount = Math.min(currentCount, MAX_EXPANSION_BATCH)

    console.log(`[LearningPlayer] Expanding script: fetching ${fetchCount} more rounds (offset: ${absoluteOffset}, base: ${scriptBaseOffset.value})`)

    const { rounds: newRounds } = await generateLearningScript(
      courseDataProvider.value,
      fetchCount,
      absoluteOffset  // Expansion offset = base + loaded count
    )

    if (newRounds.length > 0) {
      // Append new rounds
      cachedRounds.value = [...cachedRounds.value, ...newRounds]

      // Preload intro audio for new LEGOs
      const newLegoIds = new Set(newRounds.map(r => r.legoId).filter(Boolean))
      if (newLegoIds.size > 0 && supabase.value) {
        loadIntroAudio(supabase.value, courseCode.value, newLegoIds, audioMap.value)
      }

      // Update cache with expanded script (include offset for validation on reload)
      await setCachedScript(courseCode.value, {
        rounds: cachedRounds.value,
        totalSeeds: cachedRounds.value.length,
        totalLegos: cachedRounds.value.length,
        totalCycles: cachedRounds.value.reduce((sum, r) => sum + (r.items?.length || 0), 0),
        audioMapObj: {},
        scriptOffset: scriptBaseOffset.value,
      })

      console.log(`[LearningPlayer] Expanded to ${cachedRounds.value.length} rounds`)
    } else {
      console.log('[LearningPlayer] No more rounds available - reached end of course')
    }
  } catch (err) {
    console.warn('[LearningPlayer] Script expansion failed:', err)
    // Graceful fail - user can still use cached rounds
  } finally {
    isExpandingScript.value = false
  }
}

// Highlight a specific LEGO node (glow effect, not centering)
const highlightNetworkNode = (legoId) => {
  if (!legoId) return
  // Instead of setHero, just highlight the node visually
  // The node will glow but won't be forced to center
  network.setHero(legoId, networkCenter.value)
}

// Create edges between all LEGOs in a phrase path (DIRECTIONAL)
// This is called when a practice phrase is completed
// "Fire together, wire together" - edges are directional because language is temporal
const strengthenPhrasePath = (legoIds) => {
  if (!legoIds || legoIds.length < 2) return
  // Use composable - fires directional edges A→B, B→C, etc.
  network.firePath(legoIds)
}


// Handle tap on a network node - play all practice phrases for this LEGO
const handleNetworkNodeTap = async (node) => {
  console.log('[Network] Node tapped:', node.id, node.targetText)

  // If already playing phrases for a node, stop it
  if (isPlayingNodePhrases.value) {
    stopNodePhrasePlayback()
    // If same node, just stop
    if (playingNodeId.value === node.id) return
  }

  // Pause main playback if running
  const wasPlaying = isPlaying.value
  if (wasPlaying) {
    isPlaying.value = false
  }

  // Get all practice items for this LEGO
  const roundIndex = cachedRounds.value.findIndex(r => r.legoId === node.id)
  if (roundIndex < 0) {
    console.log('[Network] No round found for LEGO:', node.id)
    return
  }

  const round = cachedRounds.value[roundIndex]
  if (!round?.items) return

  // Get practice phrases (skip intro/debut)
  const practiceItems = round.items.filter(item =>
    item.type !== 'intro' && item.type !== 'debut'
  )

  if (practiceItems.length === 0) {
    console.log('[Network] No practice phrases for LEGO:', node.id)
    return
  }

  // Start playback
  console.log(`[Network] Playing ${practiceItems.length} phrases for ${node.targetText}`)
  isPlayingNodePhrases.value = true
  playingNodeId.value = node.id
  nodePhraseItems.value = practiceItems
  currentPlayingPhraseIndex.value = 0

  // Play through all phrases (each phrase highlights its own path)
  await playNodePhrasesSequentially()
}

// Play through node phrases one by one - just target audio, with path highlighting
const playNodePhrasesSequentially = async () => {
  if (!isPlayingNodePhrases.value || !audioController.value) {
    stopNodePhrasePlayback()
    return
  }

  while (currentPlayingPhraseIndex.value < nodePhraseItems.value.length) {
    if (!isPlayingNodePhrases.value) break

    const item = nodePhraseItems.value[currentPlayingPhraseIndex.value]

    // Extract LEGOs in this phrase and highlight the path
    const phraseLegoIds = extractLegoIdsFromPhrase(item)
    if (phraseLegoIds.length > 0) {
      // Animate the full path (like Voice 2) for tap exploration
      const audioDurationMs = (item.audioDurations?.target1 || 2) * 1000
      distinctionNetwork.animatePathForVoice2(phraseLegoIds, audioDurationMs)
      resonatingNodes.value = phraseLegoIds
    }

    if (!isPlayingNodePhrases.value) break

    // Play just target audio (fast exploration)
    const targetUrl = item.targetAudioUrl || item.target1AudioUrl
    if (targetUrl) {
      try {
        await audioController.value.play({ url: targetUrl })
      } catch (e) {
        console.warn('[Network] Failed to play target audio:', e)
      }
    }

    // Brief pause between phrases to see the path
    await new Promise(resolve => setTimeout(resolve, 400))

    currentPlayingPhraseIndex.value++
  }

  // Done playing all phrases
  stopNodePhrasePlayback()
}

// Stop node phrase playback
const stopNodePhrasePlayback = () => {
  isPlayingNodePhrases.value = false
  playingNodeId.value = null
  nodePhraseItems.value = []
  currentPlayingPhraseIndex.value = 0
  // Clear highlighting after a delay
  setTimeout(() => {
    if (!isPlayingNodePhrases.value) {
      resonatingNodes.value = []
    }
  }, 300)
}

const handleNetworkNodeHover = (node) => {
  hoveredNode.value = node
}

// Play a phrase from the hover tooltip
const playHoverPhrase = async (phrase) => {
  if (!phrase?.target) return

  // Find the round with this LEGO
  const legoId = hoveredNode.value?.id
  if (!legoId) return

  const roundIndex = cachedRounds.value.findIndex(r => r.legoId === legoId)
  if (roundIndex < 0) return

  const round = cachedRounds.value[roundIndex]
  if (!round?.items) return

  // Find the item that matches this phrase
  const item = round.items.find(i => i.targetText === phrase.target)
  if (!item) return

  // Get audio URL and play
  const audioUrl = item.targetAudioUrl || item.target1AudioUrl
  if (audioUrl) {
    console.log('[Hover] Playing phrase:', phrase.target)
    // Use the audio controller to play
    if (audioController.value) {
      await audioController.value.play({ url: audioUrl })
    }
  }
}

// Extract LEGO IDs from a practice phrase (for path animation and edge creation)
// Uses greedy decomposition to find all LEGOs that compose the phrase
const extractLegoIdsFromPhrase = (item) => {
  const targetText = item?.phrase?.phrase?.target || item?.targetText || ''
  if (!targetText) {
    // Fallback to just the current LEGO if no text
    const legoId = item?.lego?.id || item?.legoId
    return legoId ? [legoId] : []
  }

  // Build a map of normalized LEGO text -> ID from current network nodes
  const legoMap = new Map()
  networkNodes.value.forEach(node => {
    if (node.targetText) {
      legoMap.set(node.targetText.toLowerCase().trim(), node.id)
    }
  })

  // Debug: Show what we're searching for and what nodes are available
  console.log(`[extractLegoIdsFromPhrase] Phrase: "${targetText.slice(0, 40)}...", ${legoMap.size} LEGOs available`)

  // Greedy decomposition - find longest matching LEGO at each position
  const normalized = targetText.toLowerCase().trim()
  const words = normalized.split(/\s+/)
  const result: string[] = []
  let i = 0

  while (i < words.length) {
    let longestMatch: string | null = null
    let longestLength = 0

    // Try longest phrases first
    for (let len = Math.min(words.length - i, 5); len > 0; len--) {
      const candidate = words.slice(i, i + len).join(' ')
      const legoId = legoMap.get(candidate)
      if (legoId) {
        longestMatch = legoId
        longestLength = len
        break
      }
    }

    if (longestMatch) {
      result.push(longestMatch)
      i += longestLength
    } else {
      i++ // Skip unmatched word
    }
  }

  // If decomposition found nothing, fall back to the current LEGO
  if (result.length === 0) {
    const legoId = item?.lego?.id || item?.legoId
    if (legoId && networkNodes.value.find(n => n.id === legoId)) {
      result.push(legoId)
    }
  }

  console.log(`[extractLegoIdsFromPhrase] Result: [${result.join(', ')}]`)
  return result
}

// Find M-LEGOs that have partial word overlap with the phrase (resonance effect)
// These are LEGOs where some (but not all) words appear in the phrase
const findResonatingNodes = (item, exactMatches) => {
  const targetText = item?.phrase?.phrase?.target || item?.targetText || ''
  if (!targetText) return []

  const targetWords = targetText.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const resonating = []

  networkNodes.value.forEach(node => {
    // Skip if already an exact match
    if (exactMatches.includes(node.id)) return

    // Check if this is an M-LEGO (multi-word)
    const nodeWords = (node.targetText || '').toLowerCase().split(/\s+/).filter(w => w.length > 2)
    if (nodeWords.length < 2) return // Only check M-LEGOs

    // Check for partial word overlap
    const matchingWords = nodeWords.filter(nw =>
      targetWords.some(tw => tw.includes(nw) || nw.includes(tw))
    )

    // Resonance if some (but not all) words match
    if (matchingWords.length > 0 && matchingWords.length < nodeWords.length) {
      resonating.push(node.id)
    }
  })

  return resonating
}

// ============================================
// LIFECYCLE
// ============================================

onMounted(async () => {
  // ============================================
  // AWAKENING SEQUENCE - Parallel loading with cinematic timing
  // Data loads in background while animation plays
  // Ready = BOTH data loaded AND animation enjoyed
  // ============================================

  const startTime = Date.now()
  const MINIMUM_ANIMATION_MS = 2800 // Let users enjoy the awakening

  // Stage 1: Awakening (immediate)
  setLoadingStage('awakening')

  // Initialize sync stuff immediately (no await needed)
  loadAdaptationConsent()
  // Force dark mode - constellation network is designed for dark only
  document.documentElement.setAttribute('data-theme', 'dark')
  audioController.value = new RealAudioController()
  currentCourseCode.value = courseCode.value

  // Initialize belt progress (loads from localStorage)
  initializeBeltProgress()

  // Initialize brain network visualization (after DOM is ready)
  nextTick(() => {
    initializeNetwork()
  })

  // Track data loading state
  let dataReady = false
  let cachedScript = null
  // Promise that resolves when network connections are loaded (from either path)
  let networkConnectionsReady: Promise<void> = Promise.resolve()

  // ============================================
  // PARALLEL TASK 1: Load all data
  // ============================================
  const loadAllData = async () => {
    try {
      // Load algorithm configs (Turbo Boost settings, etc.) - non-blocking
      loadAlgorithmConfigs().catch(err => {
        console.warn('[LearningPlayer] Failed to load algorithm configs, using defaults:', err)
      })

      // Load cache first (needed for other operations)
      cachedScript = await getCachedScript(courseCode.value)

      // Validate cached script offset matches current belt progress
      // If offset changed (completedSeeds changed since script was cached), invalidate
      const currentOffset = beltProgress.value?.completedSeeds.value ?? 0
      if (cachedScript && (cachedScript.scriptOffset ?? 0) !== currentOffset) {
        console.log('[LearningPlayer] Belt progress changed (cached offset:', cachedScript.scriptOffset, '→ current:', currentOffset, '), invalidating cache')
        cachedScript = null
      }

      if (cachedScript) {
        console.log('[LearningPlayer] Found cached script with', cachedScript.rounds.length, 'rounds at offset', cachedScript.scriptOffset ?? 0)
        scriptBaseOffset.value = cachedScript.scriptOffset ?? 0 // Restore base offset from cache
        // Debug: show items per round for first few rounds
        cachedScript.rounds.slice(0, 3).forEach((r, i) => {
          console.log(`[LearningPlayer] Cached Round ${i} has ${r.items?.length} items:`, r.items?.map(it => it.type).join(', '))
        })
        cachedRounds.value = cachedScript.rounds

        // Capture course welcome if present
        if (cachedScript.courseWelcome) {
          cachedCourseWelcome.value = cachedScript.courseWelcome
          console.log('[LearningPlayer] Found course welcome:', cachedScript.courseWelcome.id)
        }

        // Restore audio map from cache
        if (cachedScript.audioMapObj) {
          for (const [key, value] of Object.entries(cachedScript.audioMapObj)) {
            audioMap.value.set(key, value)
          }
          console.log('[LearningPlayer] Restored', audioMap.value.size, 'audio entries from cache')
        }

        // Now run remaining tasks in parallel
        const parallelTasks = []

        // Task: Load network connections from database (like brain view)
        // This gives us dense edges for the network visualization
        const connectionsTask = (async () => {
          console.log('[LearningPlayer] Starting network connections load, supabase:', !!supabase?.value)
          try {
            if (!supabase?.value) {
              console.warn('[LearningPlayer] No supabase client - skipping network connections')
              return
            }
            console.log('[LearningPlayer] Loading network connections from database...')
            const networkData = await loadLegoNetworkData(courseCode.value)
            if (networkData?.connections) {
              networkConnections.value = networkData.connections
              console.log(`[LearningPlayer] Loaded ${networkData.connections.length} network connections`)
            } else {
              console.warn('[LearningPlayer] No connections returned from loadLegoNetworkData')
            }
          } catch (err) {
            console.warn('[LearningPlayer] Failed to load network connections:', err)
            // Not fatal - network will use fallback edge inference
          }
        })()
        parallelTasks.push(connectionsTask)
        networkConnectionsReady = connectionsTask

        // Task: Load FULL network (all course rounds) in background
        // This runs in parallel - network will be ready by the time user starts learning
        // Once loaded, network positions never recalculate - just reveal/hide nodes
        const fullNetworkTask = (async () => {
          try {
            // Wait for connections first (needed for edge data)
            await connectionsTask

            if (!courseDataProvider.value) {
              console.warn('[LearningPlayer] No courseDataProvider - skipping full network load')
              return
            }

            console.log('[LearningPlayer] Loading FULL network (all course rounds)...')
            const MAX_ROUNDS = 1000 // Full course
            const { rounds: allRounds } = await generateLearningScript(
              courseDataProvider.value,
              MAX_ROUNDS,
              0 // Always start from beginning for full network
            )

            if (allRounds.length > 0) {
              initializeFullNetwork(allRounds, networkConnections.value)
              console.log(`[LearningPlayer] Full network ready: ${allRounds.length} nodes`)
            }
          } catch (err) {
            console.warn('[LearningPlayer] Failed to load full network:', err)
            // Not fatal - will fall back to legacy chunk-based calculation
          }
        })()
        parallelTasks.push(fullNetworkTask)

        // Task: Load saved progress (localStorage first, then database for logged-in users)
        parallelTasks.push(
          (async () => {
            let resumed = false

            // 1. Try localStorage first (works for all users, fast, offline-ready)
            const localPosition = loadPositionFromLocalStorage()
            if (localPosition && typeof localPosition.roundIndex === 'number') {
              const resumeRound = localPosition.roundIndex

              // Same-view resume: restore exact item position
              // Cross-view resume: restart at beginning of round
              const sameView = localPosition.view === 'player'
              const resumeItem = sameView ? (localPosition.itemInRound || 0) : 0

              if (resumeRound < cachedScript.rounds.length) {
                currentRoundIndex.value = resumeRound
                currentItemInRound.value = resumeItem

                // Also set currentPlayableItem so splash screen shows correct text
                const resumeScriptItem = cachedScript.rounds[resumeRound]?.items?.[resumeItem]
                if (resumeScriptItem) {
                  const playable = await scriptItemToPlayableItem(resumeScriptItem)
                  if (playable) {
                    currentPlayableItem.value = playable
                  }
                }

                if (sameView) {
                  console.log('[LearningPlayer] Same-view resume: round', resumeRound, 'item', resumeItem)
                } else {
                  console.log('[LearningPlayer] Cross-view resume: round', resumeRound, '(from explorer, starting at item 0)')
                }
                resumed = true
              } else {
                console.log('[LearningPlayer] localStorage position beyond available rounds, starting fresh')
              }
            }

            // 2. For logged-in users, also check database (might have synced from another device)
            if (!resumed) {
              try {
                const savedProgress = await loadSavedProgress()
                if (savedProgress?.lastCompletedRoundIndex !== null) {
                  const resumeIndex = savedProgress.lastCompletedRoundIndex + 1
                  if (resumeIndex < cachedScript.rounds.length) {
                    currentRoundIndex.value = resumeIndex
                    currentItemInRound.value = 0 // Database only stores round, not item

                    // Also set currentPlayableItem so splash screen shows correct text
                    const resumeScriptItem = cachedScript.rounds[resumeIndex]?.items?.[0]
                    if (resumeScriptItem) {
                      const playable = await scriptItemToPlayableItem(resumeScriptItem)
                      if (playable) {
                        currentPlayableItem.value = playable
                      }
                    }

                    console.log('[LearningPlayer] Resuming from database: round', resumeIndex)
                    resumed = true
                  } else {
                    console.log('[LearningPlayer] All rounds completed, starting fresh')
                    currentRoundIndex.value = 0
                  }
                }
              } catch (err) {
                // Database load failed, that's OK - we already tried localStorage
              }
            }

            // 3. If no resume position, set currentPlayableItem to first item for splash screen
            if (!resumed && cachedScript.rounds.length > 0) {
              const firstItem = cachedScript.rounds[0]?.items?.[0]
              if (firstItem) {
                const playable = await scriptItemToPlayableItem(firstItem)
                if (playable) {
                  currentPlayableItem.value = playable
                }
              }
            }

            // Mark position as initialized (enables saving on future changes)
            positionInitialized.value = true
          })()
        )

        // Task: Preload intro audio for ALL LEGOs
        if (supabase?.value) {
          const legoIds = new Set(
            cachedRounds.value.map(r => r.legoId).filter(Boolean)
          )
          if (legoIds.size > 0) {
            parallelTasks.push(
              loadIntroAudio(supabase.value, courseCode.value, legoIds, audioMap.value)
            )
          }
        }

        // Task: Initialize VAD if previously consented
        if (adaptationConsent.value === true) {
          parallelTasks.push(initializeVad().catch(() => {}))
        }

        // Wait for all parallel tasks
        await Promise.all(parallelTasks)
      } else if (courseDataProvider.value) {
        // ============================================
        // GENERATE NEW SCRIPT (cache was empty)
        // ============================================
        console.log('[LearningPlayer] No cached script, generating new one...')

        // Load network connections in parallel with script generation
        // Store the promise so we can await it later (before populating network)
        console.log('[LearningPlayer] Fresh gen: starting network connections load, supabase:', !!supabase?.value)
        networkConnectionsReady = (async () => {
          if (!supabase?.value) {
            console.warn('[LearningPlayer] Fresh gen: No supabase client - skipping network connections')
            return
          }
          try {
            const networkData = await loadLegoNetworkData(courseCode.value)
            if (networkData?.connections) {
              networkConnections.value = networkData.connections
              console.log(`[LearningPlayer] Loaded ${networkData.connections.length} network connections (fresh generation)`)
            } else {
              console.warn('[LearningPlayer] Fresh gen: No connections returned')
            }
          } catch (err) {
            console.warn('[LearningPlayer] Failed to load network connections:', err)
          }
        })()

        // Load FULL network in background (all course rounds)
        // This runs in parallel - positions calculated once, never recalculated
        ;(async () => {
          try {
            await networkConnectionsReady
            if (!courseDataProvider.value) return

            console.log('[LearningPlayer] Fresh gen: Loading FULL network...')
            const MAX_ROUNDS = 1000
            const { rounds: allRounds } = await generateLearningScript(
              courseDataProvider.value,
              MAX_ROUNDS,
              0
            )

            if (allRounds.length > 0) {
              initializeFullNetwork(allRounds, networkConnections.value)
              console.log(`[LearningPlayer] Fresh gen: Full network ready: ${allRounds.length} nodes`)
            }
          } catch (err) {
            console.warn('[LearningPlayer] Fresh gen: Failed to load full network:', err)
          }
        })()

        try {
          // Provider now contains all config - single source of truth
          // Start with small batch for fast initial load, expand progressively
          // Use completedSeeds as offset so returning learners resume from their progress
          const startOffset = beltProgress.value?.completedSeeds.value ?? 0
          scriptBaseOffset.value = startOffset // Track for expansion calculations
          console.log('[LearningPlayer] Generating script with offset:', startOffset, '(completedSeeds)')
          const { rounds, allItems } = await generateLearningScript(
            courseDataProvider.value,
            INITIAL_ROUNDS, // Start small, expand as learner progresses
            startOffset     // Resume from belt progress
          )

          if (rounds.length > 0) {
            console.log('[LearningPlayer] Generated script with', rounds.length, 'rounds')
            // Debug: show items per round for first few rounds
            rounds.slice(0, 3).forEach((r, i) => {
              console.log(`[LearningPlayer] Round ${i} has ${r.items?.length} items:`, r.items?.map(it => it.type).join(', '))
            })
            cachedRounds.value = rounds

            // Try to restore position from localStorage (even for fresh script generation)
            // Note: loadPositionFromLocalStorage validates the offset matches, so position is only
            // returned if it's valid for the current script batch
            const localPosition = loadPositionFromLocalStorage()
            if (localPosition && typeof localPosition.roundIndex === 'number') {
              if (localPosition.roundIndex < rounds.length) {
                // Same-view resume: restore exact item position
                // Cross-view resume: restart at beginning of round
                const sameView = localPosition.view === 'player'
                currentRoundIndex.value = localPosition.roundIndex
                currentItemInRound.value = sameView ? (localPosition.itemInRound || 0) : 0
                console.log('[LearningPlayer] Resuming from localStorage: round', localPosition.roundIndex, sameView ? `item ${currentItemInRound.value}` : '(cross-view, item 0)')
              }
            }
            // No belt progress fallback needed - the script is generated with startOffset=completedSeeds,
            // so rounds[0] already represents the correct starting position for returning learners.
            // If localStorage position is invalid (offset changed), we start at round 0 which is correct.

            // Mark position as initialized
            positionInitialized.value = true

            // Cache for next time
            const audioMapObj = Object.fromEntries(audioMap.value)
            const totalCycles = allItems.length
            const estimatedMinutes = Math.round(totalCycles * 0.2) // ~12s per cycle

            await setCachedScript(courseCode.value, {
              rounds,
              totalSeeds: rounds.length,
              totalLegos: rounds.length,
              totalCycles,
              estimatedMinutes,
              audioMapObj,
              scriptOffset: startOffset,
            })

            console.log('[LearningPlayer] Cached script for future use')

            // Preload intro audio for ALL LEGOs
            const legoIds = new Set(
              rounds.map(r => r.legoId).filter(Boolean)
            )
            if (legoIds.size > 0) {
              await loadIntroAudio(supabase.value, courseCode.value, legoIds, audioMap.value)
            }
          }
        } catch (genErr) {
          console.warn('[LearningPlayer] Script generation failed:', genErr)
          // Will fall back to session-based progression
          positionInitialized.value = true
        }
      } else {
        // No script available, still mark as initialized
        positionInitialized.value = true
      }
    } catch (err) {
      console.warn('[LearningPlayer] Data load error:', err)
      positionInitialized.value = true
    }

    dataReady = true
    console.log('[LearningPlayer] Data loading complete in', Date.now() - startTime, 'ms')
  }

  // ============================================
  // PARALLEL TASK 2: Run animation timeline
  // Stage transitions happen on fixed timing for visual consistency
  // ============================================
  const runAnimationTimeline = async () => {
    // Stage 1: awakening (already set)
    await new Promise(r => setTimeout(r, 800))

    // Stage 2: finding
    setLoadingStage('finding')
    await new Promise(r => setTimeout(r, 900))

    // Stage 3: preparing
    setLoadingStage('preparing')

    // Wait for minimum animation time
    const elapsed = Date.now() - startTime
    const remaining = Math.max(0, MINIMUM_ANIMATION_MS - elapsed)
    if (remaining > 0) {
      await new Promise(r => setTimeout(r, remaining))
    }
  }

  // ============================================
  // RUN BOTH IN PARALLEL
  // ============================================
  await Promise.all([loadAllData(), runAnimationTimeline()])

  // ============================================
  // STAGE 4: READY - Splash animation done
  // Show player immediately, orchestrator inits in background
  // ============================================
  setLoadingStage('ready')

  // Populate network with all LEGOs up to target position
  // Priority: previewLegoIndex prop > restored position > nothing
  nextTick(async () => {
    // Wait for network connections to load before populating (fixes edge timing issue)
    await networkConnectionsReady

    if (props.previewLegoIndex > 0) {
      // Preview mode: expand script if needed, then show network up to specified LEGO index
      let targetIndex = props.previewLegoIndex
      const absoluteEnd = scriptBaseOffset.value + cachedRounds.value.length

      // Expand script if preview index exceeds cached rounds
      if (targetIndex >= absoluteEnd && courseDataProvider.value) {
        console.log(`[LearningPlayer] Preview ${targetIndex} exceeds cached ${absoluteEnd}, expanding...`)
        const neededRounds = targetIndex - absoluteEnd + 10 // How many more we need
        const { rounds: moreRounds } = await generateLearningScript(
          courseDataProvider.value,
          neededRounds,
          absoluteEnd  // Expansion offset = base + loaded count
        )
        if (moreRounds.length > 0) {
          cachedRounds.value = [...cachedRounds.value, ...moreRounds]
          console.log(`[LearningPlayer] Expanded to ${cachedRounds.value.length} rounds for preview (base offset: ${scriptBaseOffset.value})`)
        }
      }

      // Cap to actual available rounds
      targetIndex = Math.min(targetIndex, cachedRounds.value.length - 1)
      console.log(`[LearningPlayer] Preview mode: populating network up to LEGO ${targetIndex}`)
      populateNetworkUpToRound(targetIndex)

      // Set playback position so hitting play continues from here
      currentRoundIndex.value = targetIndex
      currentItemInRound.value = 0

      // Update belt to match preview position
      updateBeltForPosition(targetIndex, false)

      // Update display to show the preview LEGO's text
      const previewItem = cachedRounds.value[targetIndex]?.items?.[0]
      if (previewItem) {
        const playable = await scriptItemToPlayableItem(previewItem)
        if (playable) {
          currentPlayableItem.value = playable
        }
      }
    } else if (currentRoundIndex.value > 0) {
      // Resuming: show network up to restored position
      populateNetworkUpToRound(currentRoundIndex.value)
    } else if (cachedRounds.value.length > 0) {
      // Fresh start: show first LEGO as the starting point
      populateNetworkUpToRound(0)
    }
  })

  // ============================================
  // META-COMMENTARY INITIALIZATION
  // Initialize the service for instructions and encouragements
  // ============================================
  if (metaCommentary) {
    try {
      await metaCommentary.initialize()
      console.log('[LearningPlayer] Meta-commentary initialized:', metaCommentary.instructionProgress.value)
    } catch (err) {
      console.warn('[LearningPlayer] Meta-commentary init failed:', err)
      // Continue without meta-commentary
    }
  }

  // ============================================
  // ORCHESTRATOR INITIALIZATION (async, non-blocking)
  // ============================================
  const initOrchestrator = async () => {
    if (sessionItems.value.length === 0) return

    // Calculate default pause duration from first item (1.5s boot up + target1)
    const defaultPauseDuration = 1500 + Math.round(sessionItems.value[0].audioDurations.target1 * 1000)

    // Create CycleOrchestrator with dynamic pause duration
    const demoConfig = {
      ...DEFAULT_CONFIG.cycle,
      pause_duration_ms: defaultPauseDuration,
      transition_gap_ms: 100, // Short gap - text fade already started 500ms before audio ended
    }
    orchestrator.value = new CycleOrchestrator(
      audioController.value,
      demoConfig
    )

    // Subscribe to events
    orchestrator.value.addEventListener(handleCycleEvent)

    // Preload first few items (fire and forget - don't wait)
    for (const item of sessionItems.value.slice(0, 3)) {
      if (item?.phrase?.audioRefs) {
        audioController.value.preload(item.phrase.audioRefs.known)
        audioController.value.preload(item.phrase.audioRefs.target?.voice1)
        audioController.value.preload(item.phrase.audioRefs.target?.voice2)
      }
    }
  }

  // Initialize orchestrator when items become available
  if (sessionItems.value.length > 0) {
    await initOrchestrator()
  } else {
    // Watch for items to load
    const unwatch = watch(sessionItems, async () => {
      if (sessionItems.value.length > 0) {
        await initOrchestrator()
        unwatch()
      }
    })
  }

  // Start session timer
  sessionTimerInterval = setInterval(() => {
    if (isPlaying.value) sessionSeconds.value++
  }, 1000)

  // Don't auto-start learning - wait for user to click play
  isPlaying.value = false

  // BUT auto-play the welcome audio if this is a fresh start
  // (The user gesture from "Continue Learning" button should carry through)
  if (currentRoundIndex.value === 0 && !welcomeChecked.value) {
    // Small delay to ensure audio controller is ready
    setTimeout(async () => {
      await playWelcomeIfNeeded()
    }, 100)
  }

  console.log('[LearningPlayer] Total awakening time:', Date.now() - startTime, 'ms')
})

onUnmounted(() => {
  if (orchestrator.value) {
    orchestrator.value.removeEventListener(handleCycleEvent)
    orchestrator.value.stop()
  }
  if (ringAnimationFrame) cancelAnimationFrame(ringAnimationFrame)
  if (sessionTimerInterval) clearInterval(sessionTimerInterval)
  if (vadStatusInterval) clearInterval(vadStatusInterval)
  if (timingAnalyzer.value) {
    timingAnalyzer.value.reset()
    timingAnalyzer.value = null
  }
  if (vadInstance.value) {
    vadInstance.value.dispose()
    vadInstance.value = null
  }
})
</script>

<template>

  <!-- Paused Summary Overlay -->
  <Transition name="session-complete">
    <SessionComplete
      v-if="showSessionComplete"
      :items-practiced="itemsPracticed"
      :time-spent-seconds="sessionSeconds"
      :current-belt="currentBelt"
      :belt-progress="beltProgressPercent"
      :completed-seeds="completedSeeds"
      :next-belt="nextBelt"
      :time-to-next-belt="timeToNextBelt"
      :belt-journey="beltJourney"
      @resume="handleResumeLearning"
    />
  </Transition>

  <!-- Adaptation Consent Prompt -->
  <Transition name="fade">
    <div v-if="showAdaptationPrompt" class="consent-overlay">
      <div class="consent-card">
        <div class="consent-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
          </svg>
        </div>
        <h3 class="consent-title">Learn at your natural pace</h3>
        <p class="consent-description">
          SSi adapts to your rhythm, keeping you in the optimal learning zone — not too fast, not too slow, just right for you.
        </p>
        <p class="consent-detail">
          Uses your microphone to detect timing only — no audio is recorded or stored.
        </p>
        <div class="consent-actions">
          <button class="consent-btn consent-btn--secondary" @click="handleAdaptationConsent(false)">
            No thanks
          </button>
          <button class="consent-btn consent-btn--primary" @click="handleAdaptationConsent(true)">
            Yes, personalise
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- Welcome Audio Overlay (with skip button) -->
  <Transition name="fade">
    <div v-if="isPlayingWelcome" class="welcome-overlay">
      <div class="welcome-content">
        <button class="welcome-skip" @click="skipWelcome">
          Skip Welcome
        </button>
      </div>
    </div>
  </Transition>


  <div
    class="player"
    :class="[`belt-${currentBelt.name}`, { 'is-paused': !isPlaying }]"
    :style="beltCssVars"
    v-show="!showSessionComplete"
  >
    <!-- Deep Space Background Layers -->
    <div class="space-gradient"></div>
    <div class="space-nebula"></div>
    <div class="bg-noise"></div>

    <!-- Brain Network Visualization Layer - Prebuilt Constellation -->
    <ConstellationNetworkView
      ref="networkViewRef"
      v-bind="networkViewProps"
      :resonating-node-ids="resonatingNodes"
      :show-path-labels="showTargetText"
      class="brain-network-container"
      :class="{ 'network-faded': isIntroPhase }"
      @node-tap="handleNetworkNodeTap"
      @node-hover="handleNetworkNodeHover"
    />

    <!-- Hero-Centric Text Labels - Floating above/below the hero node -->
    <div class="hero-text-pane" :class="[currentPhase, { 'is-intro': isIntroPhase }]">
      <div class="hero-glass">
        <!-- INTRO MODE: Typewriter-style encouraging message -->
        <template v-if="isIntroPhase && !isAwakening">
          <div class="intro-display">
            <div class="intro-typewriter">
              <span class="intro-prefix">›</span>
              <span class="intro-message">{{ introMessage }}</span>
              <span class="intro-cursor">▌</span>
            </div>
          </div>
        </template>

        <!-- NORMAL MODE: Phase strip + text -->
        <template v-else>
          <!-- Horizontal Phase Strip: speaker → mic → speaker → eyes -->
          <div class="phase-strip">
            <div class="phase-section speaker-section" :class="{ active: currentPhase === 'prompt' }">
              <svg class="phase-icon-svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            </div>
            <div class="phase-section mic-section" :class="{ active: currentPhase === 'speak' }">
              <svg class="phase-icon-svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
              </svg>
              <div class="speak-timer" v-if="currentPhase === 'speak'">
                <div class="speak-timer-fill" :style="{ width: ringProgress + '%' }"></div>
              </div>
            </div>
            <div class="phase-section speaker-section" :class="{ active: currentPhase === 'voice_1' }">
              <svg class="phase-icon-svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            </div>
            <div class="phase-section eyes-section" :class="{ active: currentPhase === 'voice_2' }">
              <span class="phase-icon-emoji">👀</span>
            </div>
          </div>

          <!-- Text container - fades all text together during transition -->
          <div class="hero-text-container" :class="{ 'is-transitioning': isTransitioningItem }">
            <!-- Known text - always visible, stable position -->
            <div class="hero-text-known">
              <p v-if="isAwakening" class="hero-known loading-text">
                {{ currentLoadingMessage }}<span class="loading-cursor">▌</span>
              </p>
              <p v-else class="hero-known">
                {{ displayedKnownText }}
              </p>
            </div>

            <!-- Target text - always present for stable sizing, opacity controlled -->
            <div class="hero-text-target" :class="{ 'is-visible': showTargetText }">
              <p class="hero-target">
                {{ displayedTargetText }}
              </p>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Node Hover Tooltip -->
    <Transition name="tooltip-fade">
      <div v-if="hoveredNode" class="node-hover-tooltip">
        <div class="tooltip-header">
          <span class="tooltip-target">{{ hoveredNode.targetText }}</span>
          <span class="tooltip-known">{{ hoveredNode.knownText }}</span>
        </div>
        <div v-if="hoveredNodePhrases.length > 0" class="tooltip-phrases">
          <div
            v-for="(phrase, i) in hoveredNodePhrases"
            :key="i"
            class="tooltip-phrase"
            @click.stop="playHoverPhrase(phrase)"
          >
            <span class="phrase-target">{{ phrase.target }}</span>
            <span class="phrase-known">{{ phrase.known }}</span>
            <span class="phrase-play">▶</span>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Static Star Field - Deep space backdrop -->
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
      <div class="star star-13"></div>
      <div class="star star-14"></div>
      <div class="star star-15"></div>
      <div class="star star-16"></div>
      <div class="star star-17"></div>
      <div class="star star-18"></div>
      <div class="star star-19"></div>
      <div class="star star-20"></div>
      <div class="star star-21"></div>
      <div class="star star-22"></div>
      <div class="star star-23"></div>
      <div class="star star-24"></div>
    </div>

    <!-- Drifting Star Particles - Slow motion through space -->
    <div class="drift-stars">
      <div class="drift-star drift-1"></div>
      <div class="drift-star drift-2"></div>
      <div class="drift-star drift-3"></div>
      <div class="drift-star drift-4"></div>
      <div class="drift-star drift-5"></div>
      <div class="drift-star drift-6"></div>
      <div class="drift-star drift-7"></div>
      <div class="drift-star drift-8"></div>
    </div>

    <!-- Subtle Nebula Glow - Belt colored -->
    <div class="nebula-glow"></div>

    <!-- Class Context Banner (when launched from Schools) -->
    <div v-if="props.classContext" class="class-banner">
      <span class="class-icon">🏫</span>
      <span class="class-name">{{ props.classContext.name }}</span>
      <span class="class-course">{{ props.classContext.course }}</span>
    </div>

    <!-- Header -->
    <header class="header" :class="{ 'has-banner': props.classContext }">
      <button class="close-btn" @click="handleExit" :title="props.classContext ? 'Back to Schools' : 'Exit to Home'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <div class="brand">
        <span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span>
      </div>

      <div class="header-right">
        <!-- Belt Navigation Group -->
        <div class="belt-nav-header">
          <!-- Back to previous/current belt start -->
          <button
            class="belt-nav-header-btn belt-nav-header-btn--back"
            :class="{ 'is-skipping': isSkippingBelt }"
            @click.stop="handleGoBackBelt"
            :disabled="!previousBelt && currentBelt.seedsRequired === completedSeeds"
            :title="`Back to ${backTargetBelt.name} belt`"
            :style="{ '--back-belt-color': backTargetBelt.color }"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>

          <!-- Belt Progress Bar - Clickable to show summary -->
          <button
            class="belt-progress-btn"
            @click="showPausedSummary"
            :title="!nextBelt ? 'Black belt achieved!' : `${Math.round(beltProgressPercent)}% to ${nextBelt.name} belt`"
          >
            <div class="belt-bar-track">
              <div class="belt-bar-fill" :style="{ width: `${beltProgressPercent}%` }"></div>
            </div>
            <div class="belt-bar-label">{{ Math.round(beltProgressPercent) }}%</div>
          </button>

          <!-- Skip to next belt -->
          <button
            class="belt-nav-header-btn belt-nav-header-btn--forward"
            :class="{ 'is-skipping': isSkippingBelt }"
            @click.stop="handleSkipToNextBelt"
            :disabled="!nextBelt"
            :title="nextBelt ? `Skip to ${nextBelt.name} belt` : 'Black belt achieved!'"
            :style="nextBelt ? { '--next-belt-color': nextBelt.color } : {}"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>

        <!-- Session Timer - Also clickable -->
        <button class="session-timer" @click="showPausedSummary" title="Pause &amp; Summary">
          <span class="timer-value">{{ formattedSessionTime }}</span>
          <svg class="timer-end-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="6" width="12" height="12" rx="1"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- SPLIT-STAGE LAYOUT: Network Theater (top) + Control Pane (bottom) -->

    <!-- NETWORK THEATER - The brain visualization fills this space -->
    <section ref="networkTheaterRef" class="network-theater">
      <!-- Session Points Counter - subtle top-right display -->
      <div v-if="sessionPoints > 0" class="session-points-display" :class="{ 'has-multiplier': sessionMultiplier > 1 }">
        <span v-if="sessionMultiplier > 1" class="session-multiplier-indicator" title="Turbo bonus active">×</span>
        <span class="session-points-value">{{ sessionPoints }}</span>
        <span class="session-points-label">pts</span>
      </div>
    </section>

    <!-- CONTROL PANE - Minimal text display, tap to play/pause -->
    <section class="control-pane" :class="[currentPhase, `layout-${layoutMode}`, { 'is-paused': !isPlaying }]" @click="handleRingTap">
      <!-- Ink Spirit Rewards - Float upward from the text area -->
      <TransitionGroup name="ink-spirit" tag="div" class="ink-spirit-container">
        <div
          v-for="reward in floatingRewards"
          :key="reward.id"
          class="ink-spirit-reward"
          :class="`bonus-${reward.bonusLevel}`"
          :style="{ '--x-offset': `${reward.xOffset}px` }"
        >
          <span class="ink-word">{{ reward.word }}</span>
          <span class="ink-points">+{{ reward.points }}</span>
        </div>
      </TransitionGroup>

      <!-- Text display area - fades together during transition -->
      <div class="pane-text" :class="{ 'is-transitioning': isTransitioningItem }">
        <!-- Known Language Text - always visible, stable position -->
        <div class="pane-text-known">
          <p v-if="isAwakening" class="known-text loading-text">
            {{ currentLoadingMessage }}<span class="loading-cursor">▌</span>
          </p>
          <p v-else class="known-text">
            {{ displayedKnownText }}
          </p>
        </div>

        <!-- Visual separator -->
        <div class="pane-text-divider"></div>

        <!-- Target Language Text - always present for stable sizing, opacity controlled -->
        <div class="pane-text-target" :class="{ 'is-visible': showTargetText }">
          <p class="target-text">
            {{ displayedTargetText }}
          </p>
        </div>
      </div>

      <!-- Play button when paused -->
      <div v-if="!isPlaying && !isPlayingWelcome" class="pane-play-hint" :class="{ 'initial-start': !hasEverStarted }">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <polygon points="6 3 20 12 6 21 6 3"/>
        </svg>
        <span v-if="!hasEverStarted" class="start-label">Tap to start</span>
      </div>
    </section>

    <!-- Layout toggle removed - dark mode constellation is the only mode -->

    <!-- Hidden ring container for position reference (used by network centering) -->
    <div ref="ringContainerRef" class="ring-reference" style="display: none;"></div>

    <!-- Break Suggestion Overlay -->
    <Transition name="break-fade">
      <div v-if="showBreakSuggestion" class="break-suggestion-overlay" @click="dismissBreakSuggestion">
        <div class="break-card" @click.stop>
          <div class="break-icon">☕</div>
          <h3 class="break-title">Time for a break?</h3>
          <p class="break-message">You've completed {{ roundsThisSession }} rounds. Great progress!</p>
          <div class="break-actions">
            <button class="break-btn break-btn--continue" @click="dismissBreakSuggestion">
              Keep Going
            </button>
            <button class="break-btn break-btn--pause" @click="handlePause">
              Take a Break
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Belt Promotion Celebration -->
    <Transition name="belt-celebration">
      <div v-if="beltJustEarned" class="belt-celebration-overlay" @click="beltJustEarned = null">
        <div class="belt-celebration-card" @click.stop>
          <!-- Decorative particles -->
          <div class="belt-particles">
            <span v-for="i in 12" :key="i" class="belt-particle" :style="{ '--particle-delay': `${i * 0.1}s`, '--particle-angle': `${i * 30}deg` }"></span>
          </div>
          <div class="belt-celebration-glow" :style="{ '--belt-glow-color': beltJustEarned.color }"></div>

          <!-- Belt SVG instead of emoji -->
          <div class="belt-icon-large" :style="{ '--belt-color': beltJustEarned.color }">
            <svg viewBox="0 0 64 40" class="belt-svg-celebration">
              <rect x="0" y="14" width="64" height="12" rx="2" :fill="beltJustEarned.color"/>
              <circle cx="32" cy="20" r="10" :fill="beltJustEarned.colorDark"/>
              <circle cx="32" cy="20" r="6" fill="rgba(255,255,255,0.2)"/>
              <path d="M22 20 L10 34" :stroke="beltJustEarned.color" stroke-width="4" stroke-linecap="round" fill="none"/>
              <path d="M42 20 L54 34" :stroke="beltJustEarned.color" stroke-width="4" stroke-linecap="round" fill="none"/>
            </svg>
          </div>

          <h2 class="belt-title">New Belt Earned!</h2>
          <p class="belt-name" :style="{ color: beltJustEarned.color }">
            {{ beltJustEarned.name.charAt(0).toUpperCase() + beltJustEarned.name.slice(1) }} Belt
          </p>
          <p class="belt-subtitle">Keep learning to reach the next level!</p>

          <button class="belt-continue-btn" @click="beltJustEarned = null">
            Continue
          </button>
        </div>
      </div>
    </Transition>

    <!-- Control Bar - Always visible -->
    <div class="control-bar">
      <button
        class="mode-btn"
        :class="{ 'coming-soon': listeningModeComingSoon }"
        @click="handleListeningMode"
        title="Listening Mode (Coming Soon)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
        </svg>
        <span v-if="listeningModeComingSoon" class="coming-soon-label">Coming Soon</span>
      </button>

      <!-- Belt Navigation: Back -->
      <button
        class="belt-nav-btn belt-nav-btn--back"
        :class="{ 'is-skipping': isSkippingBelt }"
        @click="handleGoBackBelt"
        :disabled="!previousBelt && currentBelt.seedsRequired === completedSeeds"
        :title="`Back to ${backTargetBelt.name} belt`"
        :style="{ '--back-belt-color': backTargetBelt.color }"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="11 17 6 12 11 7"/>
          <polyline points="18 17 13 12 18 7"/>
        </svg>
      </button>

      <div class="transport-controls">
        <button class="transport-btn" @click="handleRevisit" title="Revisit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
        </button>

        <!-- Main Play/Stop Button -->
        <button
          class="transport-btn transport-btn--main"
          @click="isPlaying ? handlePause() : handleResume()"
          :title="isPlaying ? 'Stop' : 'Play'"
        >
          <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 3 20 12 6 21 6 3"/>
          </svg>
        </button>

        <button class="transport-btn" @click="handleSkip" title="Skip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 4 15 12 5 20 5 4" fill="currentColor"/>
            <line x1="19" y1="5" x2="19" y2="19"/>
          </svg>
        </button>
      </div>

      <!-- Belt Navigation: Forward - colored with next belt -->
      <button
        class="belt-nav-btn belt-nav-btn--forward"
        :class="{ 'is-skipping': isSkippingBelt }"
        @click="handleSkipToNextBelt"
        :disabled="!nextBelt"
        :title="nextBelt ? `Skip to ${nextBelt.name} belt` : 'Black belt achieved!'"
        :style="nextBelt ? { '--next-belt-color': nextBelt.color, '--next-belt-glow': nextBelt.glow } : {}"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="13 17 18 12 13 7"/>
          <polyline points="6 17 11 12 6 7"/>
        </svg>
      </button>

      <button
        class="mode-btn mode-btn--turbo"
        :class="{ active: turboActive }"
        @click="toggleTurbo"
        title="Turbo Boost"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
      </button>

      <!-- Report Issue Button (for QA feedback) -->
      <ReportIssueButton
        :course-code="activeCourseCode"
        :current-item="currentItem"
        :current-known="visibleTexts.known"
        :current-target="visibleTexts.target"
        :qa-mode="isQaMode"
      />
    </div>

    <!-- Footer -->
    <footer class="footer">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${sessionProgress * 100}%` }"></div>
      </div>
      <div class="footer-stats">
        <span>{{ itemsPracticed }} / {{ sessionItems.length }}</span>
        <span v-if="learningSession.isDemoMode.value" class="demo-badge">Demo Mode</span>
      </div>
    </footer>

  </div>
</template>

<style scoped>
/* ============================================
   SSi Learning Player - Zen Sanctuary Edition
   Refined minimalism, premium feel
   ============================================ */

@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@300;400;500&family=Space+Mono:wght@400;700&family=Noto+Serif+SC:wght@600&family=Noto+Serif:wght@500&display=swap');

.player {
  --accent: #c23a3a;
  --accent-soft: rgba(194, 58, 58, 0.15);
  --accent-glow: rgba(194, 58, 58, 0.4);
  --gold: #d4a853;
  --gold-soft: rgba(212, 168, 83, 0.15);
  --success: #22c55e;
  --safe-area-top: env(safe-area-inset-top, 0px);

  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-primary);
  font-family: 'DM Sans', sans-serif;
  overflow: hidden;
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

/* Subtle milky way nebula effect */
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

/* ============ STATIC STAR FIELD ============ */
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

/* Distribute stars across the canvas */
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
.star-12 { left: 48%; top: 38%; animation-delay: -1.8s; opacity: 0.3; }
.star-13 { left: 62%; top: 28%; animation-delay: -2.3s; opacity: 0.5; }
.star-14 { left: 75%; top: 35%; animation-delay: -2.8s; opacity: 0.4; }
.star-15 { left: 88%; top: 42%; animation-delay: -3.3s; opacity: 0.6; }
.star-16 { left: 95%; top: 55%; animation-delay: -3.8s; opacity: 0.3; }
.star-17 { left: 12%; top: 58%; animation-delay: -0.2s; opacity: 0.4; }
.star-18 { left: 25%; top: 65%; animation-delay: -0.7s; opacity: 0.5; width: 3px; height: 3px; }
.star-19 { left: 38%; top: 52%; animation-delay: -1.2s; opacity: 0.3; }
.star-20 { left: 52%; top: 62%; animation-delay: -1.7s; opacity: 0.6; }
.star-21 { left: 65%; top: 55%; animation-delay: -2.2s; opacity: 0.4; }
.star-22 { left: 78%; top: 68%; animation-delay: -2.7s; opacity: 0.5; }
.star-23 { left: 3%; top: 75%; animation-delay: -3.2s; opacity: 0.3; }
.star-24 { left: 45%; top: 78%; animation-delay: -3.7s; opacity: 0.4; }

@keyframes star-twinkle {
  0%, 100% { opacity: var(--star-opacity, 0.4); }
  50% { opacity: calc(var(--star-opacity, 0.4) * 1.8); }
}

/* Belt-colored glow on some stars */
.star-2, .star-5, .star-11, .star-18 {
  box-shadow: 0 0 4px var(--belt-glow, rgba(255,255,255,0.3));
}

/* ============ DRIFTING STAR PARTICLES ============ */
.drift-stars {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  overflow: hidden;
}

.drift-star {
  position: absolute;
  width: 2px;
  height: 2px;
  background: var(--belt-color, white);
  border-radius: 50%;
  opacity: 0.6;
  animation: drift-motion 25s linear infinite;
}

/* Distribute drifting stars */
.drift-1 { left: 10%; top: 20%; animation-delay: 0s; animation-duration: 28s; }
.drift-2 { left: 30%; top: 40%; animation-delay: -5s; animation-duration: 22s; opacity: 0.4; }
.drift-3 { left: 50%; top: 15%; animation-delay: -10s; animation-duration: 30s; }
.drift-4 { left: 70%; top: 55%; animation-delay: -15s; animation-duration: 26s; opacity: 0.5; }
.drift-5 { left: 85%; top: 30%; animation-delay: -3s; animation-duration: 24s; }
.drift-6 { left: 20%; top: 70%; animation-delay: -8s; animation-duration: 32s; opacity: 0.4; }
.drift-7 { left: 60%; top: 75%; animation-delay: -12s; animation-duration: 27s; }
.drift-8 { left: 90%; top: 60%; animation-delay: -18s; animation-duration: 29s; opacity: 0.5; }

@keyframes drift-motion {
  0% {
    transform: translate(0, 0) scale(1);
    opacity: 0;
  }
  10% {
    opacity: 0.5;
  }
  25% {
    transform: translate(15px, -8px) scale(1.02);
    opacity: 0.6;
  }
  50% {
    transform: translate(30px, -15px) scale(1);
    opacity: 0.4;
  }
  75% {
    transform: translate(20px, -25px) scale(0.95);
    opacity: 0.5;
  }
  90% {
    opacity: 0.3;
  }
  100% {
    transform: translate(10px, -40px) scale(0.9);
    opacity: 0;
  }
}

/* ============ NEBULA GLOW - Belt colored ambient light ============ */
/* Removed central radial gradient (looks oval on mobile) */
/* Belt color now expressed via edge accents on UI elements */
.nebula-glow {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  /* Very subtle edge glow at bottom - where transport controls are */
  background:
    linear-gradient(
      to top,
      var(--belt-glow, rgba(194, 58, 58, 0.04)) 0%,
      transparent 15%
    );
  opacity: 0.6;
  transition: background 1s ease, opacity 0.5s ease;
}

/* Slightly brighter during intro/debut */
.player:has(.hero-text-pane.is-intro) .nebula-glow {
  opacity: 0.8;
}

/* ============ BRAIN NETWORK VISUALIZATION ============ */
.brain-network-container {
  position: fixed;
  inset: 0;
  z-index: 3;
  pointer-events: auto; /* Allow pan/zoom interactions */
  overflow: hidden;
}

.brain-network-container svg {
  width: 100%;
  height: 100%;
  pointer-events: auto;
  cursor: grab;
}

.brain-network-container svg:active {
  cursor: grabbing;
}

/* Network links (edges) */
.brain-network-container :deep(.network-link) {
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 1;
  fill: none;
  transition: stroke 0.5s ease, stroke-width 0.3s ease, opacity 0.5s ease;
}

.brain-network-container :deep(.network-link.active) {
  stroke: var(--belt-color, #c23a3a);
  stroke-width: 2;
  opacity: 1;
  filter: drop-shadow(0 0 4px var(--belt-color, #c23a3a));
}

/* Network nodes */
.brain-network-container :deep(.network-node) {
  transition: r 0.5s ease, opacity 0.5s ease;
}

.brain-network-container :deep(.network-node.hero) {
  animation: network-node-pulse 2s ease-in-out infinite;
}

.brain-network-container :deep(.network-node.active) {
  filter: drop-shadow(0 0 12px var(--belt-color, #c23a3a));
}

/* Resonance effect for M-LEGOs with partial word overlap */
/* Subtle 30% opacity ring pulse - "echo" of related concepts */
.brain-network-container :deep(.network-node.resonating) .node-glow {
  animation: resonance-pulse 1.2s ease-in-out infinite;
  stroke-opacity: 0.3;
}

@keyframes resonance-pulse {
  0%, 100% {
    stroke-width: 2;
    stroke-opacity: 0.3;
  }
  50% {
    stroke-width: 4;
    stroke-opacity: 0.5;
  }
}

/* Node labels */
.brain-network-container :deep(.network-label) {
  font-family: 'DM Sans', sans-serif;
  font-size: 11px;
  fill: rgba(255, 255, 255, 0.8);
  text-anchor: middle;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.4s ease;
}

.brain-network-container :deep(.network-label.visible) {
  opacity: 1;
}

.brain-network-container :deep(.network-label.active) {
  fill: white;
  font-weight: 600;
  opacity: 1;
  filter: drop-shadow(0 0 4px var(--belt-color, #c23a3a));
}

/* Animations */
@keyframes network-node-pulse {
  0%, 100% {
    filter: drop-shadow(0 0 8px var(--belt-color, #c23a3a));
    transform: scale(1);
  }
  50% {
    filter: drop-shadow(0 0 20px var(--belt-color, #c23a3a));
    transform: scale(1.1);
  }
}

@keyframes network-node-intro {
  0% {
    r: 0;
    opacity: 0;
    filter: drop-shadow(0 0 0px var(--belt-color, #c23a3a));
  }
  50% {
    r: 20;
    opacity: 1;
    filter: drop-shadow(0 0 30px var(--belt-color, #c23a3a));
  }
  100% {
    r: 8;
    opacity: 0.8;
    filter: drop-shadow(0 0 8px var(--belt-color, #c23a3a));
  }
}

@keyframes network-path-fire {
  0% {
    stroke-dashoffset: 100;
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
  100% {
    stroke-dashoffset: 0;
    opacity: 0.8;
  }
}

/* ============ CLASS BANNER (Schools context) ============ */
.class-banner {
  position: relative;
  z-index: 11;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, rgba(194, 58, 58, 0.15), rgba(212, 168, 83, 0.1));
  border-bottom: 1px solid rgba(194, 58, 58, 0.2);
}

.class-icon {
  font-size: 0.875rem;
}

.class-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.class-course {
  font-size: 0.75rem;
  color: var(--text-secondary);
  padding-left: 0.5rem;
  border-left: 1px solid var(--border-subtle);
}

/* ============ HEADER ============ */
.header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(1rem + var(--safe-area-top, 0px)) 1.5rem 1rem 1.5rem;
  gap: 0.75rem;
  pointer-events: auto; /* Header buttons clickable */
  min-height: 60px; /* Prevent header from getting too small */
}

.header.has-banner {
  padding-top: 0.75rem;
}

.close-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
}

.close-btn svg {
  width: 20px;
  height: 20px;
}

.close-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.close-btn:active {
  transform: scale(0.95);
}

.brand {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-weight: 700;
  font-size: 1.0625rem;
  letter-spacing: -0.02em;
}

.logo-say, .logo-in { color: var(--accent); }
.logo-something { color: var(--text-primary); }

.session-timer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'Space Mono', monospace;
  font-size: 0.875rem;
  color: var(--text-secondary);
  padding: 0.5rem 1rem;
  background: var(--bg-card);
  border-radius: 100px;
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: all 0.2s ease;
}

.session-timer:hover {
  background: var(--bg-elevated);
  border-color: var(--accent);
  color: var(--text-primary);
}

.session-timer:hover .timer-end-icon {
  opacity: 1;
  color: var(--accent);
}

.timer-end-icon {
  width: 14px;
  height: 14px;
  opacity: 0.5;
  transition: all 0.2s ease;
}

.timer-value {
  font-variant-numeric: tabular-nums;
}

.theme-toggle {
  width: 48px;
  height: 28px;
  padding: 0;
  border: none;
  background: var(--bg-card);
  border-radius: 100px;
  cursor: pointer;
  position: relative;
  border: 1px solid var(--border-subtle);
}

.toggle-track {
  width: 100%;
  height: 100%;
  position: relative;
}

.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.toggle-thumb.light {
  transform: translateX(20px);
  background: var(--gold);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* ============ BELT NAVIGATION HEADER ============ */
.belt-nav-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.belt-nav-header-btn {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  padding: 0;
}

.belt-nav-header-btn svg {
  width: 14px;
  height: 14px;
}

.belt-nav-header-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--belt-color, var(--text-primary));
}

.belt-nav-header-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Forward button shows next belt color */
.belt-nav-header-btn--forward {
  color: var(--next-belt-color, var(--text-muted));
}

.belt-nav-header-btn--forward:hover:not(:disabled) {
  color: var(--next-belt-color, var(--text-primary));
}

/* Back button shows target belt color */
.belt-nav-header-btn--back {
  color: var(--back-belt-color, var(--text-muted));
}

.belt-nav-header-btn--back:hover:not(:disabled) {
  color: var(--back-belt-color, var(--text-primary));
}

/* Belt skip processing animation */
@keyframes belt-skip-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.belt-nav-header-btn.is-skipping {
  animation: belt-skip-flash 0.6s ease-in-out infinite;
  pointer-events: none;
}

.belt-nav-header-btn--forward.is-skipping {
  color: var(--next-belt-color, var(--accent));
  background: rgba(255, 255, 255, 0.1);
}

.belt-nav-header-btn--back.is-skipping {
  color: var(--back-belt-color, var(--accent));
  background: rgba(255, 255, 255, 0.1);
}

/* ============ BELT PROGRESS BAR ============ */
.belt-progress-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.belt-progress-btn:hover {
  background: var(--bg-elevated);
  border-color: var(--belt-color);
}

.belt-bar-track {
  width: 60px;
  height: 6px;
  background: var(--bg-elevated);
  border-radius: 3px;
  overflow: hidden;
}

.belt-bar-fill {
  height: 100%;
  background: var(--belt-color);
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1), background 0.5s ease;
  box-shadow: 0 0 6px var(--belt-glow);
  min-width: 2px;
}

.belt-bar-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--belt-color);
  min-width: 32px;
  text-align: right;
}

/* ============ FULLSCREEN NETWORK LAYOUT ============ */
/* Network fills the whole screen, controls float on top */

.network-theater {
  position: absolute;
  top: calc(60px + var(--safe-area-top, 0px)); /* Below header, accounting for notch */
  left: 0;
  right: 0;
  bottom: 0; /* FULLSCREEN - extends to bottom */
  z-index: 5;
  pointer-events: none; /* Let events pass through to network below */
}

/* Layout Mode Toggle Button */
.layout-toggle-btn {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(20, 20, 30, 0.7);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
}

.layout-toggle-btn:hover {
  background: rgba(30, 30, 45, 0.85);
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.2);
}

.layout-toggle-btn:active {
  transform: scale(0.95);
}

.layout-toggle-btn .layout-icon {
  font-size: 14px;
  opacity: 0.7;
}

.layout-toggle-btn .layout-label {
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Adjust toggle position based on layout mode to avoid overlap */
.player:has(.control-pane.layout-subtitle) .layout-toggle-btn,
.player:has(.control-pane.layout-floating) .layout-toggle-btn,
.player:has(.control-pane.layout-minimal) .layout-toggle-btn {
  bottom: 80px;
}

.control-pane {
  /* Hidden - replaced by hero-centric text pane */
  display: none !important;
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 15;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 1.5rem;
  gap: 1rem;
  /* Minimal glassmorphism */
  background: rgba(10, 10, 15, 0.5);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  max-width: 90%;
  cursor: pointer;
  pointer-events: auto; /* Clickable despite parent being pointer-events: none */
  transition: all 0.2s ease;
}

.control-pane:hover {
  background: rgba(10, 10, 15, 0.6);
  border-color: rgba(255, 255, 255, 0.1);
}

.control-pane:active {
  transform: translateX(-50%) scale(0.98);
}

/* Phase color accent on border */
.control-pane.prompt {
  border-color: var(--accent);
  box-shadow: 0 0 20px rgba(194, 58, 58, 0.2);
}

.control-pane.speak {
  border-color: #ff6b6b;
  box-shadow: 0 0 20px rgba(255, 107, 107, 0.25);
}

.control-pane.voice_1 {
  border-color: #a855f7;
  box-shadow: 0 0 20px rgba(168, 85, 247, 0.2);
}

.control-pane.voice_2 {
  border-color: #3b82f6;
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.2);
}

/* Play hint when paused */
.pane-play-hint {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  opacity: 0.7;
}

.pane-play-hint svg {
  width: 20px;
  height: 20px;
}

.control-pane.is-paused {
  border-color: rgba(255, 255, 255, 0.15);
}

.control-pane.is-paused:hover .pane-play-hint {
  opacity: 1;
  color: var(--text-primary);
}

/* Initial start state - more prominent */
.pane-play-hint.initial-start {
  flex-direction: column;
  gap: 0.5rem;
  width: auto;
  height: auto;
  opacity: 1;
  color: var(--accent);
}

.pane-play-hint.initial-start svg {
  width: 32px;
  height: 32px;
}

.pane-play-hint .start-label {
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

/* ============================================
   LAYOUT VARIATIONS
   ============================================ */

/* SUBTITLE MODE - Thin strip at very bottom, full width */
.control-pane.layout-subtitle {
  bottom: 0;
  left: 0;
  right: 0;
  transform: none;
  border-radius: 0;
  max-width: none;
  padding: 12px 20px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.4) 70%, transparent 100%);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.control-pane.layout-subtitle .pane-text {
  max-width: 800px;
}

.control-pane.layout-subtitle .pane-text-known .known-text {
  font-size: 1.3rem;
}

.control-pane.layout-subtitle .pane-text-target .target-text {
  font-size: 1.1rem;
}

.control-pane.layout-subtitle:active {
  transform: none;
}

/* FLOATING MODE - Compact floating card, lower opacity */
.control-pane.layout-floating {
  bottom: 40px;
  padding: 10px 20px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 12px;
}

.control-pane.layout-floating .pane-text {
  max-width: 500px;
}

.control-pane.layout-floating .pane-text-known .known-text {
  font-size: 1.2rem;
}

.control-pane.layout-floating .pane-text-target .target-text {
  font-size: 1rem;
}

/* MINIMAL MODE - Just text, barely visible container */
.control-pane.layout-minimal {
  bottom: 30px;
  padding: 8px 16px;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: none;
}

.control-pane.layout-minimal .pane-text-known .known-text {
  font-size: 1.4rem;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
}

.control-pane.layout-minimal .pane-text-target .target-text {
  font-size: 1.1rem;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
}

.control-pane.layout-minimal .pane-play-hint {
  display: none;
}

/* Node hover tooltip */
.node-hover-tooltip {
  position: absolute;
  top: 80px;
  left: 20px;
  z-index: 20;
  max-width: 280px;
  padding: 12px 16px;
  background: rgba(10, 10, 20, 0.9);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  pointer-events: none;
}

.tooltip-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.tooltip-target {
  font-size: 14px;
  font-weight: 600;
  color: var(--belt-color, #fff);
}

.tooltip-known {
  font-size: 12px;
  color: var(--text-muted);
}

.tooltip-phrases {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tooltip-phrase {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  margin: 0 -8px;
  border-radius: 6px;
  cursor: pointer;
  pointer-events: auto;
  position: relative;
  transition: background 0.15s ease;
}

.tooltip-phrase:hover {
  background: rgba(255, 255, 255, 0.08);
}

.phrase-target {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
}

.phrase-known {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
}

.phrase-play {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  color: var(--belt-color, #fff);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.tooltip-phrase:hover .phrase-play {
  opacity: 0.8;
}

/* Tooltip fade transition */
.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity 0.15s ease;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}

/* Hide tooltip on mobile (use tap instead) */
@media (max-width: 768px) {
  .node-hover-tooltip {
    display: none;
  }
}

/* Text display area */
.pane-text {
  text-align: center;
  width: 100%;
  max-width: 600px;
  cursor: pointer;
  padding: 0.5rem 1rem;
  border-radius: 12px;
  transition: background 0.2s ease;
}

.pane-text:active {
  background: rgba(255, 255, 255, 0.05);
}

.pane-text-known {
  margin-bottom: 0.25rem;
}

.pane-text-known .known-text {
  font-size: 1.5rem;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
  margin: 0;
}

/* Visual divider between known and target */
.pane-text-divider {
  width: 60px;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--text-muted), transparent);
  margin: 0.5rem auto;
  opacity: 0.3;
}

.pane-text-target {
  min-height: 2.5rem;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  transition: background 0.3s ease, box-shadow 0.3s ease;
}

/* Highlight strip when target text is showing */
.pane-text-target.has-text {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(251, 191, 36, 0.05));
  box-shadow: 0 0 20px rgba(251, 191, 36, 0.2), inset 0 0 30px rgba(251, 191, 36, 0.05);
}

.pane-text-target .target-text {
  font-size: 1.35rem;
  font-weight: 600;
  color: #fbbf24; /* Amber/gold - always visible regardless of belt */
  line-height: 1.4;
  margin: 0;
  text-shadow: 0 0 20px rgba(251, 191, 36, 0.5);
}

.pane-text-target .target-placeholder {
  font-size: 1rem;
  color: var(--text-muted);
  opacity: 0.3;
  letter-spacing: 0.3em;
}

/* Hidden ring reference (for backwards compatibility) */
.ring-reference {
  position: absolute;
  width: 200px;
  height: 200px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

/* Update brain-network-container for fullscreen mode */
.brain-network-container {
  position: absolute;
  top: 60px;
  left: 0;
  right: 0;
  bottom: 0; /* FULLSCREEN - extends to bottom */
  z-index: 2;
  transition: opacity 0.5s ease;
}

/* Network fades during intro/debut phases - hero text takes focus */
.brain-network-container.network-faded {
  opacity: 0.3;
}

/* ============ HERO-CENTRIC TEXT PANE ============ */
/* Text labels floating above/below the hero node with glass effect */
.hero-text-pane {
  position: absolute;
  /* Position in top 1/4 of screen - leaves network visible below */
  top: 18%;
  left: 50%;
  transform: translate(-50%, 0);
  z-index: 10;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px; /* Tighter gap since no hero node between */
  max-width: 90vw;
  transition: opacity 0.4s ease, transform 0.4s ease;
}

/* Intro mode: show the typewriter message pane */
.hero-text-pane.is-intro {
  /* Keep pane visible for intro display */
  opacity: 1;
}

.hero-glass {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 24px 16px;
  /* Match transport control styling - pill shape with mounted feel */
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: none;
  box-shadow:
    0 2px 16px rgba(0, 0, 0, 0.3),
    0 0 0 1px var(--belt-glow, rgba(194, 58, 58, 0.08));
  /* Match transport control width */
  min-width: 320px;
  max-width: 400px;
}

/* Glass pane is hidden during intro - this rule kept for any edge cases */
.hero-text-pane.is-intro .hero-glass {
  /* Pane hidden via parent opacity, but keep these for transitions */
}

/* ===========================================
   INTRO TYPEWRITER DISPLAY
   Encouraging terminal-style message during introductions
   =========================================== */
.intro-display {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 2rem;
  min-height: 80px;
}

.intro-typewriter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 1rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--belt-color, rgba(255, 255, 255, 0.85));
}

.intro-prefix {
  color: var(--belt-color, #fcd34d);
  opacity: 0.7;
  font-weight: 500;
}

.intro-message {
  color: rgba(255, 255, 255, 0.85);
}

.intro-cursor {
  color: var(--belt-color, #fcd34d);
  animation: cursor-blink 1s ease-in-out infinite;
  font-weight: 300;
  margin-left: -2px;
}

@keyframes cursor-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.hero-text-known,
.hero-text-target {
  text-align: center;
}

.hero-known {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 1.25rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
  line-height: 1.5;
  letter-spacing: 0.01em;
}

.hero-target {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 1.35rem;
  font-weight: 500;
  color: var(--belt-color, #c23a3a);
  margin: 0;
  line-height: 1.5;
  letter-spacing: 0.01em;
  text-shadow: 0 0 20px var(--belt-glow, rgba(194, 58, 58, 0.4));
}

.hero-target-placeholder {
  height: 1.6rem;
  margin: 0;
}

/* Voice 2 phase: known text stays visible, target appears below */

/* Timing ring - REMOVED (keeping CSS for cleanup later) */
.hero-timing-ring {
  display: none; /* Removed - distracting */
  position: absolute;
  inset: -8px;
  width: calc(100% + 16px);
  height: calc(100% + 16px);
  pointer-events: none;
}

.timing-ring-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.06);
  stroke-width: 2;
}

.timing-ring-progress {
  fill: none;
  stroke: var(--belt-color, #c23a3a);
  stroke-width: 2;
  stroke-dasharray: 688; /* Perimeter of rounded rect */
  stroke-dashoffset: 688; /* Start hidden */
  stroke-linecap: round;
  opacity: 0.6;
  transition: stroke-dashoffset 0.3s ease;
}

/* Phase-based progress animation */
.timing-ring-progress.prompt {
  stroke-dashoffset: 516; /* 25% visible */
  animation: timing-pulse 2s ease-in-out;
}

.timing-ring-progress.speak {
  stroke-dashoffset: 344; /* 50% visible */
  animation: timing-fill 4s linear forwards;
}

.timing-ring-progress.voice_1 {
  stroke-dashoffset: 172; /* 75% visible */
}

.timing-ring-progress.voice_2 {
  stroke-dashoffset: 0; /* 100% visible */
  stroke: var(--belt-color, #c23a3a);
  opacity: 0.8;
}

@keyframes timing-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
}

@keyframes timing-fill {
  from { stroke-dashoffset: 516; }
  to { stroke-dashoffset: 172; }
}

/* Horizontal Phase Strip - speaker → mic → speaker → eyes */
.phase-strip {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-bottom: 10px;
}

.phase-section {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  opacity: 0.35;
  transition: all 0.3s ease;
  position: relative;
}

.phase-section.active {
  opacity: 1;
  background: rgba(255, 255, 255, 0.15);
}

/* SVG icon styling */
.phase-icon-svg {
  width: 22px;
  height: 22px;
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.3s ease;
}

.phase-section.active .phase-icon-svg {
  color: rgba(255, 255, 255, 0.95);
}

/* Emoji icon styling */
.phase-icon-emoji {
  font-size: 22px;
  line-height: 1;
  opacity: 0.6;
  transition: all 0.3s ease;
}

.phase-section.active .phase-icon-emoji {
  opacity: 1;
  transform: scale(1.15);
}

/* Speaker sections - pulse when active */
.phase-section.speaker-section.active {
  animation: speaker-pulse 0.8s ease-in-out infinite;
}

.phase-section.speaker-section.active .phase-icon-svg {
  color: var(--belt-color, #c23a3a);
}

@keyframes speaker-pulse {
  0%, 100% {
    box-shadow: 0 0 8px var(--belt-glow, rgba(194, 58, 58, 0.3));
  }
  50% {
    box-shadow: 0 0 16px var(--belt-glow, rgba(194, 58, 58, 0.6));
  }
}

/* Mic section - red recording indicator when active */
.phase-section.mic-section {
  position: relative;
  overflow: hidden;
}

.phase-section.mic-section.active {
  background: rgba(220, 38, 38, 0.25);
  box-shadow: 0 0 12px rgba(220, 38, 38, 0.4);
}

.phase-section.mic-section.active .phase-icon-svg {
  color: #ef4444;
  animation: mic-pulse 1s ease-in-out infinite;
}

@keyframes mic-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.speak-timer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 0 0 8px 8px;
  overflow: hidden;
}

.speak-timer-fill {
  height: 100%;
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
  transition: width 0.1s linear;
}

/* Eyes section - appears clearly on final phase */
.phase-section.eyes-section.active {
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 12px var(--belt-glow, rgba(194, 58, 58, 0.5));
}

/* Intro phase: NO TEXT AT ALL - pure listen mode */
.hero-text-pane.is-intro .hero-text-known,
.hero-text-pane.is-intro .hero-text-target {
  display: none;
}

/* ═══════════════════════════════════════════════════════════════
   RESPONSIVE HERO TEXT PANE - Full breakpoint coverage
   ═══════════════════════════════════════════════════════════════ */

/* Extra small phones (320px) */
@media (max-width: 360px) {
  .hero-text-pane {
    top: 12%;
    max-width: 98vw;
    gap: 8px;
  }

  .hero-glass {
    padding: 10px 14px 12px;
    gap: 6px;
    min-width: 90vw;
    max-width: 96vw;
    border-radius: 18px;
  }

  .hero-known {
    font-size: 1.125rem;
    line-height: 1.4;
  }

  .hero-target {
    font-size: 1.25rem;
    line-height: 1.4;
  }

  .intro-typewriter {
    font-size: 0.8125rem;
  }

  /* Phase strip extra small */
  .phase-strip {
    gap: 3px;
    margin-bottom: 6px;
  }

  .phase-section {
    width: 32px;
    height: 32px;
    border-radius: 8px;
  }

  .phase-icon-svg {
    width: 16px;
    height: 16px;
  }

  .phase-icon-emoji {
    font-size: 16px;
  }
}

/* Small phones (361-479px) */
@media (min-width: 361px) and (max-width: 479px) {
  .hero-text-pane {
    top: 14%;
    max-width: 95vw;
    gap: 12px;
  }

  .hero-glass {
    padding: 12px 18px 14px;
    gap: 8px;
    min-width: 85vw;
    max-width: 92vw;
    border-radius: 20px;
  }

  .hero-known {
    font-size: 1.3rem;
  }

  .hero-target {
    font-size: 1.5rem;
  }

  .intro-typewriter {
    font-size: 0.9375rem;
  }

  /* Phase strip small */
  .phase-strip {
    gap: 4px;
    margin-bottom: 8px;
  }

  .phase-section {
    width: 36px;
    height: 36px;
  }

  .phase-icon-svg {
    width: 18px;
    height: 18px;
  }

  .phase-icon-emoji {
    font-size: 18px;
  }
}

/* Phone landscape / small tablets (480-767px) */
@media (min-width: 480px) and (max-width: 767px) {
  .hero-text-pane {
    top: 15%;
    max-width: 90vw;
    gap: 14px;
  }

  .hero-glass {
    padding: 14px 22px 18px;
    gap: 10px;
    min-width: 380px;
    max-width: 480px;
  }

  .hero-known {
    font-size: 1.4rem;
  }

  .hero-target {
    font-size: 1.6rem;
  }

  .intro-typewriter {
    font-size: 1rem;
  }
}

/* Tablets (768-1023px) */
@media (min-width: 768px) and (max-width: 1023px) {
  .hero-text-pane {
    top: 16%;
    gap: 16px;
  }

  .hero-glass {
    padding: 16px 28px 20px;
    gap: 12px;
    min-width: 400px;
    max-width: 520px;
  }

  .hero-known {
    font-size: 1.5rem;
  }

  .hero-target {
    font-size: 1.75rem;
  }

  .phase-strip {
    gap: 8px;
    margin-bottom: 12px;
  }

  .phase-section {
    width: 48px;
    height: 48px;
    border-radius: 12px;
  }

  .phase-icon-svg {
    width: 24px;
    height: 24px;
  }

  .phase-icon-emoji {
    font-size: 24px;
  }

  .intro-typewriter {
    font-size: 1.125rem;
  }
}

/* Laptops (1024-1279px) */
@media (min-width: 1024px) and (max-width: 1279px) {
  .hero-text-pane {
    top: 16%;
    gap: 18px;
  }

  .hero-glass {
    padding: 18px 32px 24px;
    gap: 14px;
    min-width: 420px;
    max-width: 560px;
  }

  .hero-known {
    font-size: 1.625rem;
  }

  .hero-target {
    font-size: 1.875rem;
  }

  .phase-section {
    width: 52px;
    height: 52px;
  }

  .phase-icon-svg {
    width: 26px;
    height: 26px;
  }
}

/* Desktops (1280-1535px) */
@media (min-width: 1280px) and (max-width: 1535px) {
  .hero-text-pane {
    top: 15%;
    gap: 20px;
  }

  .hero-glass {
    padding: 20px 40px 28px;
    gap: 16px;
    min-width: 480px;
    max-width: 640px;
    border-radius: 28px;
  }

  .hero-known {
    font-size: 1.75rem;
  }

  .hero-target {
    font-size: 2rem;
  }

  .intro-typewriter {
    font-size: 1.25rem;
  }

  .phase-strip {
    gap: 10px;
    margin-bottom: 14px;
  }

  .phase-section {
    width: 56px;
    height: 56px;
    border-radius: 14px;
  }

  .phase-icon-svg {
    width: 28px;
    height: 28px;
  }

  .phase-icon-emoji {
    font-size: 28px;
  }
}

/* Large desktops and ultrawides (1536px+) */
@media (min-width: 1536px) {
  .hero-text-pane {
    top: 14%;
    gap: 24px;
  }

  .hero-glass {
    padding: 24px 48px 32px;
    gap: 18px;
    min-width: 520px;
    max-width: 720px;
    border-radius: 32px;
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.4),
      0 0 0 1px var(--belt-glow, rgba(194, 58, 58, 0.1));
  }

  .hero-known {
    font-size: 2rem;
  }

  .hero-target {
    font-size: 2.25rem;
  }

  .intro-typewriter {
    font-size: 1.375rem;
  }

  .phase-strip {
    gap: 12px;
    margin-bottom: 16px;
  }

  .phase-section {
    width: 64px;
    height: 64px;
    border-radius: 16px;
  }

  .phase-icon-svg {
    width: 32px;
    height: 32px;
  }

  .phase-icon-emoji {
    font-size: 32px;
  }
}

/* Landscape orientation - compact hero pane */
@media (orientation: landscape) and (max-height: 500px) {
  .hero-text-pane {
    top: 10%;
    gap: 8px;
  }

  .hero-glass {
    padding: 8px 16px 10px;
    gap: 6px;
    min-width: 280px;
    max-width: 400px;
    border-radius: 14px;
  }

  .hero-known {
    font-size: 1rem;
    line-height: 1.3;
  }

  .hero-target {
    font-size: 1.125rem;
    line-height: 1.3;
  }

  .intro-typewriter {
    font-size: 0.8125rem;
  }

  .phase-strip {
    gap: 4px;
    margin-bottom: 6px;
  }

  .phase-section {
    width: 28px;
    height: 28px;
    border-radius: 6px;
  }

  .phase-icon-svg {
    width: 14px;
    height: 14px;
  }

  .phase-icon-emoji {
    font-size: 14px;
  }
}

/* Session points display */
.session-points-display {
  position: absolute;
  top: 12px;
  right: 16px;
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 20;
}

.session-points-value {
  font-family: 'DM Sans', sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--belt-color, var(--gold));
  text-shadow: 0 0 10px var(--belt-glow, rgba(212, 168, 83, 0.4));
}

.session-points-label {
  font-family: 'DM Sans', sans-serif;
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Session multiplier indicator - subtle glow when bonus active */
.session-points-display.has-multiplier {
  border-color: rgba(212, 168, 83, 0.4);
  box-shadow: 0 0 12px rgba(212, 168, 83, 0.2);
}

.session-multiplier-indicator {
  font-size: 0.75rem;
  color: var(--gold);
  opacity: 0.8;
  animation: multiplier-pulse 2s ease-in-out infinite;
}

@keyframes multiplier-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

/* Ink spirit rewards - now in control pane */
.control-pane .ink-spirit-container {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  pointer-events: none;
}

/* ============ MAIN - FIXED LAYOUT (legacy, may be removed) ============ */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem 1.5rem;
  position: relative;
  z-index: 10;
  gap: 1.5rem;
}


/* Text Zones - FIXED HEIGHT */
.text-zone {
  width: 100%;
  max-width: 600px;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.text-zone--known {
  /* Known language styling */
}

.known-text {
  font-size: clamp(1.5rem, 5vw, 2rem);
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.3;
}

.text-zone--target {
  min-height: 80px; /* Always reserve space */
}

.target-text {
  font-size: clamp(1.25rem, 4vw, 1.75rem);
  font-weight: 600;
  color: var(--gold);
  line-height: 1.3;
}

.target-placeholder {
  height: 1.75rem; /* Match target text height */
  opacity: 0;
}

/* ============ HERO NODE - Brain Network Center ============ */
.ring-container {
  position: relative;
  width: 200px;
  height: 200px;
  cursor: pointer;
  transition: transform 0.2s ease;
  z-index: 10; /* Above network edges */
}

.ring-container:hover {
  transform: scale(1.02);
}

.ring-container:active {
  transform: scale(0.98);
}

/* Multi-layer glow for node effect */
.ring-ambient {
  position: absolute;
  inset: -40px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--belt-glow, var(--accent-soft)) 0%, transparent 70%);
  opacity: 0.4;
  transition: opacity 0.5s ease;
}

/* Outer constellation glow - belt colored */
.ring-container::before {
  content: '';
  position: absolute;
  inset: -80px;
  border-radius: 50%;
  background: radial-gradient(circle,
    var(--belt-glow, rgba(194, 58, 58, 0.15)) 0%,
    transparent 50%
  );
  animation: node-breathe 4s ease-in-out infinite;
  pointer-events: none;
}

/* Inner pulse ring */
.ring-container::after {
  content: '';
  position: absolute;
  inset: -20px;
  border-radius: 50%;
  border: 1px solid var(--belt-color, var(--accent));
  opacity: 0.3;
  animation: node-pulse-ring 3s ease-out infinite;
  pointer-events: none;
}

@keyframes node-breathe {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.1); }
}

@keyframes node-pulse-ring {
  0% { transform: scale(0.9); opacity: 0.5; }
  50% { transform: scale(1.2); opacity: 0; }
  100% { transform: scale(0.9); opacity: 0; }
}

.ring-container.is-speak .ring-ambient {
  opacity: 1;
  animation: ambient-breathe 3s ease-in-out infinite;
}

@keyframes ambient-breathe {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.1); opacity: 1; }
}

.ring-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 12px var(--belt-glow, rgba(194, 58, 58, 0.4)));
}

.ring-track {
  stroke: var(--belt-color, var(--accent));
  opacity: 0.2;
}

.ring-progress {
  stroke: var(--belt-color, var(--accent));
  stroke-linecap: round;
  transition: stroke-dashoffset 0.05s linear;
  filter: drop-shadow(0 0 8px var(--belt-glow, var(--accent-glow)));
}

.ring-inner {
  stroke: var(--belt-color, var(--accent));
  opacity: 0.15;
}

.ring-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%,
    var(--bg-elevated) 0%,
    var(--bg-card) 50%,
    rgba(10, 10, 15, 0.95) 100%
  );
  /* Center always uses SSi red accent - belt colors on outer rings only */
  border: 2px solid var(--accent);
  box-shadow:
    0 0 20px rgba(194, 58, 58, 0.3),
    inset 0 0 30px rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

/* Hero node when paused - ready to start */
.ring-container.is-paused .ring-center {
  /* Center always stays SSi red accent - belt colors only on outer rings */
  background: radial-gradient(circle at 30% 30%,
    var(--accent) 0%,
    color-mix(in srgb, var(--accent) 70%, black) 100%
  );
  border-color: var(--accent);
  box-shadow:
    0 0 40px rgba(194, 58, 58, 0.5),
    inset 0 0 20px rgba(255, 255, 255, 0.1);
}

.play-indicator {
  color: white;
  opacity: 0.3;
  transition: opacity 0.5s ease;
}

.play-indicator.fade-in {
  opacity: 1;
}

.play-indicator svg {
  width: 40px;
  height: 40px;
  margin-left: 4px; /* Optical centering */
}

/* Loading state styles */
.loading-text {
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-secondary);
}

.loading-cursor {
  color: var(--accent, #fcd34d);
  animation: cursor-blink 1s step-end infinite;
}

@keyframes cursor-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* Ring during loading - subtle appearance */
.ring-center.is-loading {
  background: rgba(0, 0, 0, 0.3);
  border-color: transparent;
}

.phase-icon {
  color: var(--text-secondary);
  transition: all 0.3s ease;
}

.phase-icon svg {
  width: 36px;
  height: 36px;
}

.phase-icon.speak {
  color: var(--accent);
  animation: icon-pulse 1.5s ease-in-out infinite;
}

@keyframes icon-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

/* ============ CONSENT PROMPT ============ */

.consent-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-overlay);
  backdrop-filter: blur(8px);
  padding: 1.5rem;
}

.consent-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-medium);
  border-radius: 1rem;
  padding: 2rem;
  max-width: 360px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.consent-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 1rem;
  color: var(--accent);
}

.consent-icon svg {
  width: 100%;
  height: 100%;
}

.consent-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
}

.consent-description {
  font-size: 0.9375rem;
  color: var(--text-primary);
  line-height: 1.5;
  margin-bottom: 0.75rem;
}

.consent-detail {
  font-size: 0.8125rem;
  color: var(--text-muted);
  line-height: 1.4;
  margin-bottom: 1.5rem;
}

.consent-actions {
  display: flex;
  gap: 0.75rem;
}

.consent-btn {
  flex: 1;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.consent-btn--secondary {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.consent-btn--secondary:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.consent-btn--primary {
  background: var(--gradient-accent);
  color: white;
}

.consent-btn--primary:hover {
  filter: brightness(1.1);
}

/* ============ WELCOME OVERLAY ============ */

.welcome-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-overlay);
  backdrop-filter: blur(8px);
  padding: 1.5rem;
}

.welcome-content {
  text-align: center;
}

.welcome-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 1.5rem;
  color: var(--accent);
  animation: pulse 2s ease-in-out infinite;
}

.welcome-icon svg {
  width: 100%;
  height: 100%;
}

.welcome-text {
  font-size: 1.25rem;
  color: var(--text-primary);
  margin-bottom: 2rem;
  opacity: 0.9;
}

.welcome-skip {
  padding: 0.75rem 2rem;
  border-radius: 2rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid var(--border-medium);
  background: transparent;
  color: var(--text-secondary);
}

.welcome-skip:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-color: var(--accent);
}


@keyframes pulse {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.05); }
}

/* ============ COMING SOON LABEL ============ */

.mode-btn.coming-soon {
  position: relative;
}

.coming-soon-label {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 0.625rem;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  white-space: nowrap;
  animation: fade-in-out 2s ease-out;
}

@keyframes fade-in-out {
  0% { opacity: 0; transform: translateX(-50%) translateY(4px); }
  10% { opacity: 1; transform: translateX(-50%) translateY(0); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}

.ring-label {
  position: absolute;
  bottom: -32px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.8125rem;
  color: var(--text-secondary);
  white-space: nowrap;
  transition: opacity 0.3s ease;
}

.ring-container.is-paused .ring-label {
  opacity: 0.5;
}

/* ============ INK SPIRIT REWARDS ============ */
/* Calligraphic rewards that drift upward like incense smoke */

.ink-spirit-container {
  position: absolute;
  pointer-events: none;
  z-index: 20;
}

.ink-spirit-reward {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  transform: translate(calc(-50% + var(--x-offset, 0px)), -50%);
  animation: ink-rise 1.8s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.ink-word {
  font-family: 'Noto Serif SC', 'Noto Serif', Georgia, serif;
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--belt-color, var(--text-primary));
  text-shadow:
    0 0 20px var(--belt-glow, rgba(255,255,255,0.2)),
    0 2px 4px rgba(0,0,0,0.3);
  opacity: 0;
  animation: ink-appear 0.4s ease-out 0.1s forwards;
  letter-spacing: 0.05em;
}

.ink-points {
  font-family: 'DM Sans', sans-serif;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
  opacity: 0;
  animation: ink-appear 0.3s ease-out 0.3s forwards;
}

/* Bonus level variations - rarer words glow more */
.ink-spirit-reward.bonus-0 .ink-word {
  opacity: 0;
  animation: ink-appear 0.4s ease-out 0.1s forwards;
}

.ink-spirit-reward.bonus-1 .ink-word {
  filter: brightness(1.1);
}

.ink-spirit-reward.bonus-2 .ink-word {
  filter: brightness(1.2);
  text-shadow:
    0 0 30px var(--belt-glow, rgba(255,255,255,0.3)),
    0 0 60px var(--belt-glow, rgba(255,255,255,0.15)),
    0 2px 4px rgba(0,0,0,0.3);
}

.ink-spirit-reward.bonus-3 .ink-word {
  filter: brightness(1.3);
  font-size: 2rem;
  text-shadow:
    0 0 40px var(--belt-glow, rgba(255,255,255,0.4)),
    0 0 80px var(--belt-glow, rgba(255,255,255,0.2)),
    0 2px 4px rgba(0,0,0,0.3);
}

.ink-spirit-reward.bonus-3 .ink-points {
  color: var(--belt-color, var(--gold));
}

@keyframes ink-rise {
  0% {
    transform: translate(calc(-50% + var(--x-offset, 0px)), -50%);
  }
  100% {
    transform: translate(calc(-50% + var(--x-offset, 0px)), calc(-50% - 100px));
  }
}

@keyframes ink-appear {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
  }
  100% {
    opacity: 0.9;
    transform: scale(1);
  }
}

/* Fade out at end of animation */
.ink-spirit-reward {
  animation: ink-rise 1.8s cubic-bezier(0.22, 1, 0.36, 1) forwards,
             ink-fade 0.6s ease-in 1.2s forwards;
}

@keyframes ink-fade {
  to {
    opacity: 0;
  }
}

/* Vue transition hooks */
.ink-spirit-enter-active {
  transition: none; /* Let CSS animations handle it */
}

.ink-spirit-leave-active {
  transition: opacity 0.3s ease-out;
}

.ink-spirit-leave-to {
  opacity: 0;
}

/* ============ CONTROLS ============ */
.control-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1.25rem;
  padding: 0.75rem 1.5rem;
  position: absolute;
  /* Position above iOS home indicator safe area */
  bottom: calc(30px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 15;
  pointer-events: auto; /* Clickable buttons */
  /* Glassmorphism - slightly more prominent at bottom */
  background: rgba(10, 10, 15, 0.5);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 100px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 -4px 30px rgba(0, 0, 0, 0.3);
  /* Always visible */
  opacity: 1;
  pointer-events: auto;
}

.mode-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.mode-btn svg {
  width: 20px;
  height: 20px;
}

.mode-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  transform: scale(1.05);
  border-color: var(--text-muted);
}

.mode-btn.active {
  background: rgba(74, 222, 128, 0.15);
  border-color: var(--success);
  color: var(--success);
  box-shadow: 0 0 16px rgba(74, 222, 128, 0.3);
}

.mode-btn--turbo.active {
  background: var(--gold-soft);
  border-color: var(--gold);
  color: var(--gold);
  box-shadow: 0 0 16px rgba(212, 168, 83, 0.4);
}

/* Belt Navigation Buttons - Double chevrons for belt jumps */
.belt-nav-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.belt-nav-btn svg {
  width: 18px;
  height: 18px;
}

.belt-nav-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--belt-color, var(--text-primary));
  border-color: var(--belt-color, var(--text-muted));
}

.belt-nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Forward button shows next belt color */
.belt-nav-btn--forward {
  color: var(--next-belt-color, var(--text-muted));
}

.belt-nav-btn--forward:hover:not(:disabled) {
  color: var(--next-belt-color, var(--text-primary));
  border-color: var(--next-belt-color, var(--text-muted));
  box-shadow: 0 0 12px var(--next-belt-glow, transparent);
}

/* Back button shows target belt color */
.belt-nav-btn--back {
  color: var(--back-belt-color, var(--text-muted));
}

.belt-nav-btn--back:hover:not(:disabled) {
  color: var(--back-belt-color, var(--text-primary));
  border-color: var(--back-belt-color, var(--text-muted));
}

/* Belt skip processing animation for bottom nav */
.belt-nav-btn.is-skipping {
  animation: belt-skip-flash 0.6s ease-in-out infinite;
  pointer-events: none;
}

.belt-nav-btn--forward.is-skipping {
  color: var(--next-belt-color, var(--accent));
  background: rgba(255, 255, 255, 0.15);
  border-color: var(--next-belt-color, var(--accent));
  box-shadow: 0 0 12px var(--next-belt-glow, transparent);
}

.belt-nav-btn--back.is-skipping {
  color: var(--back-belt-color, var(--accent));
  background: rgba(255, 255, 255, 0.15);
  border-color: var(--back-belt-color, var(--accent));
}

.transport-controls {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  border-radius: 100px;
  /* Subtle belt-colored glow underneath */
  box-shadow:
    0 2px 12px rgba(0, 0, 0, 0.3),
    0 0 0 1px var(--belt-glow, rgba(194, 58, 58, 0.06));
}

.transport-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.transport-btn svg {
  width: 16px;
  height: 16px;
}

.transport-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

/* Main Play/Stop Button - Prominent */
.transport-btn--main {
  width: 44px;
  height: 44px;
  background: var(--accent);
  color: white;
  border-radius: 50%;
  box-shadow: 0 2px 12px var(--accent-glow);
  transition: all 0.2s ease;
}

.transport-btn--main svg {
  width: 18px;
  height: 18px;
}

.transport-btn--main:hover {
  background: var(--accent);
  color: white;
  transform: scale(1.1);
  box-shadow: 0 6px 24px var(--accent-glow);
}

/* ============ FOOTER ============ */
.footer {
  /* Hidden - transport controls now at bottom, progress in header */
  display: none;
  padding: 0 1.5rem 1.5rem;
  position: relative;
  z-index: 10;
  pointer-events: auto; /* Progress bar clickable */
}

.progress-bar {
  height: 3px;
  background: var(--bg-elevated);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent) 0%, var(--gold) 100%);
  border-radius: 2px;
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.footer-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: 'Space Mono', monospace;
}

.demo-badge {
  padding: 0.125rem 0.375rem;
  background: rgba(212, 168, 83, 0.15);
  border: 1px solid var(--gold);
  border-radius: 4px;
  font-size: 0.625rem;
  color: var(--gold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ============ TRANSITIONS ============ */
.text-fade-enter-active,
.text-fade-leave-active {
  transition: all 0.3s ease;
}

.text-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.text-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.text-reveal-enter-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.text-reveal-leave-active {
  transition: all 0.2s ease;
}

.text-reveal-enter-from {
  opacity: 0;
  transform: scale(0.95);
}

.text-reveal-leave-to {
  opacity: 0;
}

/* Text container fade - both known and target fade together during transition */
.hero-text-container,
.pane-text {
  transition: opacity 0.3s ease;
}

.hero-text-container.is-transitioning,
.pane-text.is-transitioning {
  opacity: 0;
}

/* Target text - always rendered for stable sizing, opacity controlled */
.hero-text-target,
.pane-text-target {
  opacity: 0;
  transition: opacity 0.3s ease;
}

.hero-text-target.is-visible,
.pane-text-target.is-visible {
  opacity: 1;
}

/* ============ PAUSED STATE ============ */
.player.is-paused .ring-ambient {
  opacity: 0 !important;
}

/* ============ RESPONSIVE ============ */
@media (min-width: 768px) {
  .main {
    gap: 2rem;
  }

  .ring-container {
    width: 240px;
    height: 240px;
  }

  .ring-center {
    width: 140px;
    height: 140px;
  }

  .phase-icon svg {
    width: 44px;
    height: 44px;
  }

  .play-indicator svg {
    width: 48px;
    height: 48px;
  }

  .text-zone {
    min-height: 100px;
  }

  .known-text {
    font-size: 2.25rem;
  }

  .target-text {
    font-size: 1.875rem;
  }
}

/* ═══════════════════════════════════════════════════════════════
   RESPONSIVE HEADER & CONTROLS - Full breakpoint coverage
   ═══════════════════════════════════════════════════════════════ */

/* Extra small phones (320px) */
@media (max-width: 360px) {
  .header {
    padding: calc(0.5rem + var(--safe-area-top, 0px)) 0.75rem 0.5rem 0.75rem;
    flex-wrap: wrap;
    gap: 0.375rem;
    min-height: 52px;
  }

  .brand {
    font-size: 0.875rem;
  }

  .close-btn {
    width: 36px;
    height: 36px;
    min-width: 44px;
    min-height: 44px;
    border-radius: 10px;
  }

  .close-btn svg {
    width: 18px;
    height: 18px;
  }

  .header-right {
    gap: 0.25rem;
  }

  .belt-nav-header-btn {
    min-width: 44px;
    min-height: 44px;
    width: 28px;
    height: 28px;
  }

  .belt-nav-header-btn svg {
    width: 12px;
    height: 12px;
  }

  .belt-progress-btn {
    padding: 0.25rem 0.375rem;
    gap: 0.25rem;
    min-height: 36px;
  }

  .belt-bar-track {
    width: 32px;
    height: 4px;
  }

  .belt-bar-label {
    font-size: 0.625rem;
    min-width: 24px;
  }

  .session-timer {
    padding: 0.25rem 0.375rem;
    font-size: 0.625rem;
    gap: 0.25rem;
    min-height: 36px;
  }

  .timer-end-icon {
    width: 12px;
    height: 12px;
  }

  .main {
    padding: 0.5rem 0.75rem;
    gap: 0.75rem;
  }

  .ring-container {
    width: 140px;
    height: 140px;
  }

  .ring-center {
    width: 90px;
    height: 90px;
  }

  .play-indicator svg {
    width: 28px;
    height: 28px;
  }

  .text-zone {
    min-height: 50px;
  }

  .control-bar {
    gap: 0.5rem;
    padding: 0.375rem 0.5rem;
    bottom: calc(24px + env(safe-area-inset-bottom, 0px));
    border-radius: 14px;
  }

  .mode-btn,
  .transport-btn,
  .belt-nav-btn {
    min-width: 44px;
    min-height: 44px;
  }

  .mode-btn {
    width: 32px;
    height: 32px;
  }

  .mode-btn svg {
    width: 14px;
    height: 14px;
  }

  .transport-btn {
    width: 28px;
    height: 28px;
  }

  .transport-btn svg {
    width: 12px;
    height: 12px;
  }

  .transport-btn--main {
    width: 36px;
    height: 36px;
  }

  .transport-btn--main svg {
    width: 14px;
    height: 14px;
  }
}

/* Small phones (361-479px) */
@media (min-width: 361px) and (max-width: 479px) {
  .header {
    padding: calc(0.75rem + var(--safe-area-top, 0px)) 1rem 0.75rem 1rem;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .brand {
    font-size: 1rem;
  }

  .close-btn {
    min-width: 44px;
    min-height: 44px;
  }

  .header-right {
    gap: 0.375rem;
  }

  .belt-nav-header-btn {
    width: 24px;
    height: 24px;
    min-width: 44px;
    min-height: 44px;
  }

  .belt-nav-header-btn svg {
    width: 12px;
    height: 12px;
  }

  .belt-progress-btn {
    padding: 0.25rem 0.5rem;
    gap: 0.375rem;
  }

  .belt-bar-track {
    width: 40px;
    height: 5px;
  }

  .belt-bar-label {
    font-size: 0.6875rem;
    min-width: 28px;
  }

  .session-timer {
    padding: 0.25rem 0.5rem;
    font-size: 0.6875rem;
    gap: 0.375rem;
    min-height: 40px;
  }

  .main {
    padding: 0.75rem 1rem;
    gap: 1rem;
  }

  .ring-container {
    width: 160px;
    height: 160px;
  }

  .ring-center {
    width: 100px;
    height: 100px;
  }

  .play-indicator svg {
    width: 32px;
    height: 32px;
  }

  .text-zone {
    min-height: 60px;
  }

  .control-bar {
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    bottom: calc(30px + env(safe-area-inset-bottom, 0px));
  }

  .mode-btn,
  .transport-btn,
  .belt-nav-btn {
    min-width: 44px;
    min-height: 44px;
  }

  .mode-btn {
    width: 36px;
    height: 36px;
  }

  .mode-btn svg {
    width: 16px;
    height: 16px;
  }

  .transport-btn {
    width: 32px;
    height: 32px;
  }

  .transport-btn svg {
    width: 14px;
    height: 14px;
  }

  .transport-btn--main {
    width: 40px;
    height: 40px;
  }

  .transport-btn--main svg {
    width: 16px;
    height: 16px;
  }
}

/* Tablets (768-1023px) */
@media (min-width: 768px) and (max-width: 1023px) {
  .header {
    padding: calc(1.25rem + var(--safe-area-top, 0px)) 2rem 1.25rem 2rem;
    min-height: 72px;
  }

  .brand {
    font-size: 1.125rem;
  }

  .close-btn {
    width: 44px;
    height: 44px;
  }

  .belt-progress-btn {
    padding: 0.5rem 0.875rem;
    gap: 0.625rem;
  }

  .belt-bar-track {
    width: 72px;
    height: 7px;
  }

  .session-timer {
    padding: 0.625rem 1.125rem;
    font-size: 0.9375rem;
  }

  .ring-container {
    width: 220px;
    height: 220px;
  }

  .ring-center {
    width: 140px;
    height: 140px;
  }

  .play-indicator svg {
    width: 44px;
    height: 44px;
  }

  .control-bar {
    gap: 1.25rem;
    padding: 0.875rem 1.5rem;
    border-radius: 22px;
  }

  .mode-btn {
    width: 48px;
    height: 48px;
  }

  .mode-btn svg {
    width: 22px;
    height: 22px;
  }

  .transport-btn {
    width: 44px;
    height: 44px;
  }

  .transport-btn svg {
    width: 20px;
    height: 20px;
  }

  .transport-btn--main {
    width: 56px;
    height: 56px;
  }

  .transport-btn--main svg {
    width: 24px;
    height: 24px;
  }
}

/* Large desktops and ultrawides (1536px+) */
@media (min-width: 1536px) {
  .header {
    padding: calc(1.75rem + var(--safe-area-top, 0px)) 3rem 1.75rem 3rem;
    min-height: 88px;
  }

  .brand {
    font-size: 1.25rem;
  }

  .close-btn {
    width: 52px;
    height: 52px;
    border-radius: 16px;
  }

  .close-btn svg {
    width: 24px;
    height: 24px;
  }

  .belt-progress-btn {
    padding: 0.625rem 1rem;
    gap: 0.75rem;
    border-radius: 10px;
  }

  .belt-bar-track {
    width: 100px;
    height: 8px;
  }

  .belt-bar-label {
    font-size: 0.875rem;
    min-width: 44px;
  }

  .session-timer {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    gap: 0.75rem;
  }

  .timer-end-icon {
    width: 18px;
    height: 18px;
  }

  .main {
    padding: 1.5rem 2.5rem;
    gap: 2rem;
  }

  .ring-container {
    width: 280px;
    height: 280px;
  }

  .ring-center {
    width: 180px;
    height: 180px;
  }

  .play-indicator svg {
    width: 56px;
    height: 56px;
  }

  .text-zone {
    min-height: 100px;
    max-width: 800px;
  }

  .control-bar {
    gap: 1.75rem;
    padding: 1.25rem 2.5rem;
    border-radius: 28px;
    bottom: calc(48px + env(safe-area-inset-bottom, 0px));
  }

  .mode-btn {
    width: 56px;
    height: 56px;
    border-radius: 16px;
  }

  .mode-btn svg {
    width: 26px;
    height: 26px;
  }

  .transport-btn {
    width: 52px;
    height: 52px;
  }

  .transport-btn svg {
    width: 24px;
    height: 24px;
  }

  .transport-btn--main {
    width: 68px;
    height: 68px;
  }

  .transport-btn--main svg {
    width: 28px;
    height: 28px;
  }

  .belt-nav-btn {
    width: 52px;
    height: 52px;
  }

  .belt-nav-btn svg {
    width: 24px;
    height: 24px;
  }
}

/* Landscape orientation - compact layout */
@media (orientation: landscape) and (max-height: 500px) {
  .header {
    padding: 0.5rem 1rem;
    min-height: 48px;
  }

  .brand {
    font-size: 0.9375rem;
  }

  .main {
    padding: 0.5rem 1rem;
    gap: 0.75rem;
    flex-direction: row;
    justify-content: center;
    align-items: center;
  }

  .ring-container {
    width: 100px;
    height: 100px;
  }

  .ring-center {
    width: 64px;
    height: 64px;
  }

  .play-indicator svg {
    width: 24px;
    height: 24px;
  }

  .control-bar {
    padding: 0.375rem 0.75rem;
    gap: 0.5rem;
    bottom: 8px;
  }

  .mode-btn {
    width: 36px;
    height: 36px;
    min-height: 44px;
    min-width: 44px;
  }

  .transport-btn {
    width: 32px;
    height: 32px;
    min-height: 44px;
    min-width: 44px;
  }

  .transport-btn--main {
    width: 40px;
    height: 40px;
  }
}

/* PWA standalone mode - extra bottom padding for iOS home indicator */
@media (display-mode: standalone) {
  .control-bar {
    bottom: calc(40px + env(safe-area-inset-bottom, 0px));
  }
}

/* ============ SESSION COMPLETE TRANSITION ============ */
.session-complete-enter-active {
  animation: session-complete-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.session-complete-leave-active {
  animation: session-complete-out 0.3s ease-in;
}

@keyframes session-complete-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes session-complete-out {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(1.05);
  }
}

/* ============================================
   ROUND BOUNDARY INTERRUPTIONS
   Break suggestions & Belt celebrations
   ============================================ */

/* Break Suggestion Overlay */
.break-suggestion-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(4px);
}

.break-card {
  background: linear-gradient(145deg, rgba(30, 30, 35, 0.98), rgba(20, 20, 25, 0.98));
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 1.5rem;
  padding: 2.5rem;
  text-align: center;
  max-width: 320px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.break-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
  filter: drop-shadow(0 0 20px rgba(210, 180, 140, 0.3));
}

.break-title {
  font-family: var(--font-display, 'Crimson Pro', serif);
  font-size: 1.75rem;
  color: var(--text-primary, #f5f5f5);
  margin: 0 0 0.75rem 0;
}

.break-message {
  color: var(--text-secondary, rgba(245, 245, 245, 0.7));
  font-size: 0.95rem;
  margin: 0 0 1.5rem 0;
  line-height: 1.5;
}

.break-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
}

.break-btn {
  padding: 0.75rem 1.25rem;
  border-radius: 0.75rem;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.break-btn--continue {
  background: var(--belt-color, #4ade80);
  color: #1a1a1a;
}

.break-btn--continue:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(74, 222, 128, 0.3);
}

.break-btn--pause {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary, #f5f5f5);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.break-btn--pause:hover {
  background: rgba(255, 255, 255, 0.15);
}

/* Break fade transition */
.break-fade-enter-active,
.break-fade-leave-active {
  transition: opacity 0.3s ease;
}

.break-fade-enter-from,
.break-fade-leave-to {
  opacity: 0;
}

/* Belt Celebration Overlay */
.belt-celebration-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 150;
}

.belt-celebration-card {
  position: relative;
  text-align: center;
  padding: 3rem;
}

.belt-celebration-glow {
  position: absolute;
  inset: -50px;
  background: radial-gradient(circle, var(--belt-glow-color, #4ade80) 0%, transparent 70%);
  opacity: 0.4;
  filter: blur(40px);
  animation: belt-glow-pulse 2s ease-in-out infinite;
}

@keyframes belt-glow-pulse {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.1); }
}

/* Belt particles starburst */
.belt-particles {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 200px;
  height: 200px;
  margin: -100px 0 0 -100px;
  pointer-events: none;
}

.belt-particle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 4px;
  background: var(--belt-glow-color, #4ade80);
  border-radius: 50%;
  transform: rotate(var(--particle-angle)) translateY(0);
  animation: belt-particle-burst 1s ease-out var(--particle-delay) forwards;
  opacity: 0;
}

@keyframes belt-particle-burst {
  0% { transform: rotate(var(--particle-angle)) translateY(0); opacity: 1; }
  100% { transform: rotate(var(--particle-angle)) translateY(120px); opacity: 0; }
}

.belt-icon-large {
  width: 120px;
  height: 80px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1.5rem;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: 0 0 40px rgba(255, 255, 255, 0.2), 0 0 60px var(--belt-color, rgba(255,255,255,0.3));
  animation: belt-bounce 0.6s ease-out;
}

.belt-svg-celebration {
  width: 80px;
  height: 50px;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
}

@keyframes belt-bounce {
  0% { transform: scale(0); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}

.belt-title {
  font-family: var(--font-display, 'Crimson Pro', serif);
  font-size: 2rem;
  color: var(--text-primary, #f5f5f5);
  margin: 0 0 0.5rem 0;
  animation: belt-title-in 0.5s ease-out 0.2s both;
}

@keyframes belt-title-in {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.belt-name {
  font-family: var(--font-display, 'Crimson Pro', serif);
  font-size: 2.5rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
  text-transform: capitalize;
  text-shadow: 0 0 30px currentColor;
  animation: belt-title-in 0.5s ease-out 0.4s both;
}

.belt-subtitle {
  color: var(--text-secondary, rgba(245, 245, 245, 0.7));
  font-size: 1rem;
  margin: 0;
  animation: belt-title-in 0.5s ease-out 0.6s both;
}

.belt-continue-btn {
  margin-top: 2rem;
  padding: 0.75rem 2rem;
  background: transparent;
  border: 2px solid var(--text-muted, rgba(245, 245, 245, 0.4));
  color: var(--text-primary, #f5f5f5);
  border-radius: 100px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  animation: belt-title-in 0.5s ease-out 0.8s both;
}

.belt-continue-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--text-primary, #f5f5f5);
}

/* Belt celebration transition */
.belt-celebration-enter-active {
  animation: belt-celebration-in 0.5s ease-out;
}

.belt-celebration-leave-active {
  animation: belt-celebration-out 0.4s ease-in;
}

@keyframes belt-celebration-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes belt-celebration-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
</style>
