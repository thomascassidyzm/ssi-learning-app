<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, shallowRef, inject, nextTick } from 'vue'
import * as d3 from 'd3'
import {
  AudioController,
  CyclePhase,
  DEFAULT_CONFIG,
  createVoiceActivityDetector,
  createSpeechTimingAnalyzer,
} from '@ssi/core'
import { useCyclePlayback } from '../composables/useCyclePlayback'
import { scriptItemToCycle, collectAllAudioRefs } from '../utils/scriptItemToCycle'
import type { Cycle } from '../types/Cycle'
import SessionComplete from './SessionComplete.vue'
// OnboardingTooltips removed - deprecated
import ReportIssueButton from './ReportIssueButton.vue'
// AwakeningLoader removed - loading state now shown inline in player
import { useLearningSession } from '../composables/useLearningSession'
import { useScriptCache, setCachedScript } from '../composables/useScriptCache'
import { useMetaCommentary } from '../composables/useMetaCommentary'
import { useSharedBeltProgress, type BeltProgressSyncConfig } from '../composables/useBeltProgress'
import { useBeltLoader, getBeltForSeed, BELT_RANGES, type BeltLoaderConfig } from '../composables/useBeltLoader'
import { useOfflinePlay } from '../composables/useOfflinePlay'
import { useOfflineCache } from '../composables/useOfflineCache'
// SimplePlayer - clean playback engine
import { useSimplePlayer } from '../composables/useSimplePlayer'
// New simple script generation - direct database queries
import { generateLearningScript as generateSimpleScript } from '../providers/generateLearningScript'
import { toSimpleRounds } from '../providers/toSimpleRounds'
// Prebuilt network: positions pre-calculated, pans to hero via CSS
import { usePrebuiltNetworkIntegration } from '../composables/usePrebuiltNetworkIntegration'
import { useLegoNetwork } from '../composables/useLegoNetwork'
import { useAlgorithmConfig } from '../composables/useAlgorithmConfig'
import { useAuthModal } from '../composables/useAuthModal'
import LegoTextNetwork from './LegoTextNetwork.vue'
import LegoAssembly from './LegoAssembly.vue'
import type { LegoBlock } from './LegoAssembly.vue'
import BeltProgressModal from './BeltProgressModal.vue'
import ListeningOverlay from './ListeningOverlay.vue'
import DrivingModeOverlay from './DrivingModeOverlay.vue'
import { useDrivingMode } from '../composables/useDrivingMode'
import { simpleRoundToTypedCycles } from '../utils/drivingModeAdapter'

const emit = defineEmits(['close', 'playStateChanged', 'viewProgress', 'listeningModeChanged', 'cycle-started'])

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
  },
  // Auto-start playback when component mounts (after loading)
  // Default false — user must tap play or press the BottomNav play button
  autoStart: {
    type: Boolean,
    default: false
  },
  // Whether the player is currently visible/selected
  // When false, prevents any audio from playing until explicitly navigated to
  // Used with v-show to prevent autoplay when player stays mounted but hidden
  isVisible: {
    type: Boolean,
    default: true
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
const supabase = inject('supabase', ref(null))
const auth = inject('auth', null)
const themeContext = inject('theme', null)
const eagerScript = inject<any>('eagerScript', null)

// Algorithm config - admin-tweakable parameters (Turbo Boost, pause timing, etc.)
const {
  loadConfigs: loadAlgorithmConfigs,
  normalConfig,
  turboConfig,
  calculatePause,
  isLoaded: algorithmConfigLoaded
} = useAlgorithmConfig(supabase)

// Auth modal for sign-in/sign-up prompts
const { openSignIn, openSignUp: openCreateAccount } = useAuthModal()

// Network data from database (for edge connections - like brain view)
const { loadNetworkData: loadLegoNetworkData } = useLegoNetwork(supabase)
const networkConnections = ref<Array<{ source: string; target: string; count: number }>>([])
const dbNetworkNodes = ref<Array<{
  id: string
  targetText: string
  knownText: string
  seedId?: string
  legoIndex?: number
  belt?: string
  isComponent?: boolean
  parentLegoIds?: string[]
}>>([])

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

// Developer settings (can be toggled in Settings > Developer)
const showFragileProgressWarning = ref(true)
const enableQaMode = ref(false)
const showDebugOverlay = ref(false)
const enableVerboseLogging = ref(false)

// Computed properties for conditional rendering
const shouldShowProgressWarning = computed(() => isGuestLearner.value && showFragileProgressWarning.value)
const shouldShowQaMode = computed(() => enableQaMode.value || isQaMode.value) // Either setting or URL param

// Class session tracking
const classSessionId = ref<string | null>(null)
const classSessionStartTime = ref<number>(0)
const classSessionLastLegoId = ref<string>('')

// Update class progress in Supabase
const updateClassLegoProgress = async (classId: string, lastLegoId: string) => {
  if (!supabase?.value) return
  classSessionLastLegoId.value = lastLegoId
  const { error } = await supabase.value
    .from('classes')
    .update({ last_lego_id: lastLegoId })
    .eq('id', classId)
  if (error) console.error('[LearningPlayer] Failed to update class progress:', error)
}

// Start a class session
const startClassSessionTracking = async () => {
  if (!props.classContext || !supabase?.value) return
  const startLegoId = props.classContext.last_lego_id || 'S0001L01'
  classSessionStartTime.value = Date.now()
  classSessionLastLegoId.value = startLegoId

  const { data, error } = await supabase.value
    .from('class_sessions')
    .insert({
      class_id: props.classContext.id,
      teacher_user_id: learnerId.value || 'unknown',
      start_lego_id: startLegoId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[LearningPlayer] Failed to start class session:', error)
  } else {
    classSessionId.value = data.id
    console.log('[LearningPlayer] Class session started:', data.id)
  }
}

// End a class session
const endClassSessionTracking = async () => {
  if (!classSessionId.value || !supabase?.value) return
  const durationSeconds = Math.floor((Date.now() - classSessionStartTime.value) / 1000)
  const { error } = await supabase.value
    .from('class_sessions')
    .update({
      ended_at: new Date().toISOString(),
      end_lego_id: classSessionLastLegoId.value,
      cycles_completed: totalCycles.value,
      duration_seconds: durationSeconds,
    })
    .eq('id', classSessionId.value)
  if (error) console.error('[LearningPlayer] Failed to end class session:', error)
  else console.log('[LearningPlayer] Class session ended:', classSessionId.value)
  classSessionId.value = null
}

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

// ============================================
// SIMPLE PLAYER - Clean playback architecture
// ============================================
const simplePlayer = useSimplePlayer()

// Rounds storage (loaded from database, adapted for SimplePlayer)
// Using any[] to allow mixed format: SimpleRound (cycles) + legacy ScriptItem (items)
const loadedRounds = ref<any[]>([])

// Expose reactive state for UI - writable refs that sync with simplePlayer
// We need writable refs because legacy code assigns to these directly
const currentRoundIndex = ref(0)
const currentItemInRound = ref(0)
const isPlaying = ref(false)

// Sync state with simplePlayer
watch(() => simplePlayer.roundIndex.value, (idx) => { currentRoundIndex.value = idx })
watch(() => simplePlayer.cycleIndex.value, (idx) => { currentItemInRound.value = idx })
watch(() => simplePlayer.isPlaying.value, (playing) => { isPlaying.value = playing })

// Backwards compatibility aliases
const effectiveRounds = loadedRounds
const cachedRounds = loadedRounds  // Legacy alias
const effectiveRoundIndex = currentRoundIndex
const effectiveItemInRound = currentItemInRound

const playbackGeneration = ref(0)  // Counter for playback generation tracking
const scriptBaseOffset = ref(0)  // Base offset for script loading

// ============================================
// SIMPLE PLAYER EVENT SUBSCRIPTIONS
// ============================================

// Phase changes - update UI and trigger animations
// Note: Phase mapping happens AFTER the local Phase constant is defined (around line 1429)
// So we store phases here and apply them later in a watcher
const pendingPhase = ref<string>('idle')
simplePlayer.onPhaseChanged((phase) => {
  pendingPhase.value = phase

  // Handle phase-specific UI updates
  if (phase === 'prompt') {
    isTransitioningItem.value = false
    clearPreparingState()
  }
})

// Cycle completed - update counters and animations
simplePlayer.onCycleCompleted((cycle) => {
  itemsPracticed.value++
  learningHintPromptsShown.value++

  // Clear path highlights
  distinctionNetwork.clearPathAnimation()
  resonatingNodes.value = []

  // Trigger reward animation
  const { points, bonusLevel } = calculateCyclePoints()
  const multipliedPoints = Math.round(points * sessionMultiplier.value)
  sessionPoints.value += multipliedPoints
  triggerRewardAnimation(multipliedPoints, bonusLevel)

  // Track turbo usage
  totalCycles.value++
  if (turboActive.value) {
    turboCycles.value++
  }
})

// Round completed - save progress and update current LEGO ID
simplePlayer.onRoundCompleted((round) => {
  const completedRoundIndex = simplePlayer.roundIndex.value
  if (round.legoId) {
    if (props.classContext) {
      // Class mode: update class progress, NOT personal belt
      updateClassLegoProgress(props.classContext.id, round.legoId)
      // Update localStorage classContext so page refresh works
      const stored = localStorage.getItem('ssi-active-class')
      if (stored) {
        try {
          const ctx = JSON.parse(stored)
          ctx.last_lego_id = round.legoId
          localStorage.setItem('ssi-active-class', JSON.stringify(ctx))
        } catch {}
      }
    } else {
      // Individual mode: existing behavior
      saveRoundProgress(round.legoId, completedRoundIndex)
      handleRoundBoundary(completedRoundIndex, round.legoId)
      if (beltProgress.value?.setCurrentLegoId) {
        beltProgress.value.setCurrentLegoId(round.legoId)
      }
    }
  }
  // Preload audio for the NEXT round (N+1) so it's cached before the user gets there
  const nextRoundIndex = completedRoundIndex + 1
  if (nextRoundIndex < loadedRounds.value.length) {
    preloadSimpleRoundAudio(loadedRounds.value, 2, nextRoundIndex)
  }
})

// Session complete - show summary
simplePlayer.onSessionComplete(() => {
  showPausedSummary()
})

// Sync simplePlayer's current cycle to local currentCycle ref for text display
// This watcher runs after currentCycle ref is defined (around line 1240)
watch(() => simplePlayer.currentCycle.value, (simpleCycle) => {
  console.log('[LearningPlayer] Cycle watcher triggered:', simpleCycle ? `"${simpleCycle.known?.text}" → "${simpleCycle.target?.text}"` : 'null')
  if (!simpleCycle) return
  // Map SimpleCycle format to legacy Cycle format for currentPhrase computed
  // Only the text fields are needed for display
  currentCycle.value = {
    id: simpleCycle.id,
    seedId: '',
    legoId: simpleCycle.id.split('-')[0] || '',
    type: 'practice',
    known: {
      text: simpleCycle.known.text,
      audioId: '',
      durationMs: 0,
    },
    target: {
      text: simpleCycle.target.text,
      voice1AudioId: '',
      voice1DurationMs: 0,
      voice2AudioId: '',
      voice2DurationMs: 0,
    },
    pauseDurationMs: simpleCycle.pauseDuration || 6500,
  } as any
}, { immediate: true })

// ============================================
// LEGO ASSEMBLY VISUALISATION - magnetic block assembly during playback
// ============================================

// Build lookup: LEGO ID → target text from all loaded rounds
// Each round's first cycle (intro/debut) has the LEGO's own target text
const legoTargetTextMap = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  for (const round of (loadedRounds.value || [])) {
    if (round.legoId && round.cycles?.[0]?.target?.text) {
      map.set(round.legoId, round.cycles[0].target.text)
    }
  }
  return map
})

// Current phrase's LEGO blocks for the assembly view
const currentPhraseLegoBlocks = computed<LegoBlock[]>(() => {
  const cycle = simplePlayer.currentCycle.value as any
  if (!cycle?.componentLegoIds?.length) {
    // Detect intro/debut from cycle ID (sync, no async dependency on currentPlayableItem)
    const cycleId = cycle?.id || ''
    const isIntroOrDebut = cycleId.includes('_intro_') || cycleId.includes('_debut_')
    if (isIntroOrDebut && currentRound.value?.legoId) {
      const legoId = currentRound.value.legoId
      const targetText = legoTargetTextMap.value.get(legoId) || ''
      if (targetText) {
        return [{ id: legoId, targetText, isSalient: true }]
      }
    }
    return []
  }
  // Use the cycle's own legoId (the LEGO this phrase practises), not the round's
  const salientLegoId = cycle.legoId || currentRound.value?.legoId || ''
  const texts: string[] = cycle.componentLegoTexts || []
  const textMap = legoTargetTextMap.value
  return cycle.componentLegoIds
    .map((id: string, idx: number) => {
      const targetText = texts[idx] || textMap.get(id) || ''
      if (!targetText) return null
      return { id, targetText, isSalient: id === salientLegoId }
    })
    .filter((b: LegoBlock | null): b is LegoBlock => b !== null)
})

// Voice1 duration for assembly timing
const currentVoice1DurationMs = computed(() => {
  const cycle = simplePlayer.currentCycle.value as any
  // Duration not on SimplePlayer Cycle — use a reasonable default
  return 2000
})

// ============================================
// PROGRESSIVE LOADING - Start small, expand as learner progresses
// ============================================
const INITIAL_ROUNDS = 20           // Fast initial load
const EXPANSION_THRESHOLD = 5       // Expand when within 5 rounds of end
const MAX_EXPANSION_BATCH = 200     // Cap each expansion batch
const ROUNDS_TO_FETCH = 50          // Legacy: rounds to fetch in skip operations (deprecated code)
const isExpandingScript = ref(false)
const allPlayableItems = ref<any[]>([])  // Legacy: all script items for backwards compat
const totalSeedsPlayed = ref(0)     // Legacy: total seeds played in current session
const isInitialized = ref(false)    // Legacy: whether component is fully initialized
const prebuiltNetwork = { clear: () => {} }  // Legacy: stub for network operations

// ============================================
// LOCAL STORAGE PERSISTENCE - Works for all users (guests + logged-in)
// Primary source of truth for position, works offline, persists across sessions
// ============================================
const POSITION_STORAGE_KEY_PREFIX = 'ssi_learning_position_'

const getPositionStorageKey = () => `${POSITION_STORAGE_KEY_PREFIX}${courseCode.value}`

/**
 * Extract seed number from seedId (e.g., "S0045" → 45)
 */
const extractSeedNumber = (seedId: string): number => {
  if (!seedId) return 0
  const match = seedId.match(/S(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * Save current learning position to localStorage
 * Uses ABSOLUTE identifiers (LEGO ID, seed number) - not relative round indices
 * This ensures position is valid across script regeneration
 */
const savePositionToLocalStorage = () => {
  if (!courseCode.value) return

  const round = currentRound.value
  if (!round) return

  try {
    const position = {
      // Absolute identifiers - stable across script regeneration
      legoId: round.legoId,
      seedId: round.seedId,
      seedNumber: extractSeedNumber(round.seedId),
      // Item within the round (still relative, but within a known LEGO)
      itemInRound: currentItemInRound.value,
      // Metadata
      lastUpdated: Date.now(),
      courseCode: courseCode.value,
    }
    localStorage.setItem(getPositionStorageKey(), JSON.stringify(position))
    console.log('[LearningPlayer] Position saved: LEGO', position.legoId, 'seed', position.seedNumber, 'item', position.itemInRound)
  } catch (err) {
    console.warn('[LearningPlayer] Failed to save position to localStorage:', err)
  }
}

/**
 * Load learning position from localStorage
 * Returns absolute identifiers (LEGO ID, seed number) for restoration
 * No offset validation needed - we use absolute positions
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

    // Must have absolute identifiers
    if (!position.legoId || typeof position.seedNumber !== 'number') {
      console.log('[LearningPlayer] Legacy position format, starting fresh')
      return null
    }

    console.log('[LearningPlayer] Loaded position: LEGO', position.legoId, 'seed', position.seedNumber, 'item', position.itemInRound)
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
const useRoundBasedPlayback = computed(() => {
  return loadedRounds.value.length > 0
})

// Current round (from loadedRounds which has both cycles and items for compatibility)
const currentRound = computed(() => {
  return loadedRounds.value[currentRoundIndex.value] ?? null
})

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
 * Validate a playable item has all required audio URLs.
 * Returns false if any required audio is missing.
 */
const isValidPlayableItem = (playable, scriptItem) => {
  if (!playable) return false

  // For INTRO items, we don't validate here - intro audio is handled separately
  if (scriptItem?.type === 'intro') return true

  // For practice items, need known + target1 + target2
  const hasKnown = !!playable.lego?.audioRefs?.known?.url
  const hasTarget1 = !!playable.lego?.audioRefs?.target?.voice1?.url
  const hasTarget2 = !!playable.lego?.audioRefs?.target?.voice2?.url

  return hasKnown && hasTarget1 && hasTarget2
}

/**
 * Convert a ScriptItem to a playable item for the orchestrator.
 * Uses pre-populated audioRefs from script generation when available,
 * falls back to lazy audio lookup from cache.
 * Returns null if item is invalid (missing audio) - caller should skip to next item.
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

  const playable = {
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
    // Pass through component breakdown for M-type LEGOs (shown during intro/debut)
    components: scriptItem.components || undefined,
  }

  // RUNTIME SAFETY NET: Validate the item has all required audio
  // If validation fails, return null so caller skips to next item silently
  if (!isValidPlayableItem(playable, scriptItem)) {
    console.warn('[scriptItemToPlayableItem] Skipping item with missing audio:',
      scriptItem.type, scriptItem.targetText?.slice(0, 30))
    return null
  }

  return playable
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
    phrasesSpokenCount.value++
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
// Uses localStorage for persistence with Supabase sync for cross-device
const beltProgress = shallowRef(null)

// Belt loader for progressive loading with priority queue
// Loads current belt first 5 rounds (P0 blocking), then background loads next belts
const beltLoader = shallowRef(null)

// Offline play composable for infinite play when offline
// Seamlessly cycles through cached content when network is unavailable
const offlinePlay = shallowRef(null)

// Track if we're using belt loader for playback
const useBeltLoaderPlayback = ref(false)

// Online/offline state for UI indicators
const isOnline = ref(navigator.onLine)

// Computed properties that delegate to the composable (with fallbacks for initial load)
const completedRounds = computed(() => beltProgress.value?.completedRounds.value ?? 0)
const currentBelt = computed(() => beltProgress.value?.currentBelt.value ?? { name: 'white', seedsRequired: 0, color: '#f5f5f5', colorDark: '#e0e0e0', glow: 'rgba(245, 245, 245, 0.3)', index: 0 })
const nextBelt = computed(() => beltProgress.value?.nextBelt.value ?? null)
const previousBelt = computed(() => beltProgress.value?.previousBelt.value ?? null)

// Calculate which belt the "back" button will go TO
// Mirrors goBackToBeltStart logic: if >2 seeds into current belt, stays on current; otherwise goes to previous
const backTargetBelt = computed(() => {
  const currentStart = currentBelt.value.seedsRequired
  // If we're more than 2 seeds into current belt, target is current belt start
  if (completedRounds.value > currentStart + 2 || !previousBelt.value) {
    return currentBelt.value
  }
  // Otherwise, target is previous belt
  return previousBelt.value
})

// Belt skip loading state: true when target belt's first round is NOT yet loaded
// Belt skip buttons flash until their target rounds are available
const nextBeltLoading = computed(() => {
  const nb = nextBelt.value
  if (!nb) return false
  // Use findRoundIndexForSeed to check if target seed's rounds are loaded
  return simplePlayer.findRoundIndexForSeed(nb.seedsRequired) < 0
})

const prevBeltLoading = computed(() => {
  const bt = backTargetBelt.value
  if (!bt) return false
  const targetSeed = bt.seedsRequired === 0 ? 1 : bt.seedsRequired
  // Use findRoundIndexForSeed to check if target seed's rounds are loaded
  return simplePlayer.findRoundIndexForSeed(targetSeed) < 0
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

// Star field fades as constellation fills in - your LEGOs become your stars
// White=100%, Yellow=75%, Orange=50%, Green=25%, Blue+=0%
const starFieldOpacity = computed(() => 1)

// Initialize belt progress when course code is available
const initializeBeltProgress = async () => {
  if (courseCode.value && !beltProgress.value) {
    // Initialize belt progress with Supabase sync config
    const syncConfig: BeltProgressSyncConfig = {
      supabase: supabase,
      learnerId: computed(() => learnerId.value),
    }
    beltProgress.value = useSharedBeltProgress(courseCode.value, syncConfig)

    // Await async initialization to merge with remote progress
    if (beltProgress.value.canSync()) {
      await beltProgress.value.initialize()
    }

    console.log('[LearningPlayer] Belt progress initialized for', courseCode.value, '- seeds:', beltProgress.value.completedRounds.value)
  }
}

/**
 * Initialize belt loader for progressive loading
 * Call after belt progress is initialized to know starting position
 */
const initializeBeltLoader = async () => {
  if (!courseCode.value || !beltProgress.value || beltLoader.value) return

  console.log('[LearningPlayer] Initializing belt loader...')

  // Script chunk generator (uses real generateLearningScript + toSimpleRounds)
  const generateScriptChunk = async (startSeed: number, count: number) => {
    if (!supabase?.value) return { rounds: [] as any[], nextSeed: startSeed, hasMore: false }
    const endSeed = startSeed + count
    const result = await generateSimpleScript(supabase.value, courseCode.value, startSeed, endSeed, 1)
    const rounds = toSimpleRounds(result.items)
    return {
      rounds: rounds as any[],
      nextSeed: endSeed + 1,
      hasMore: endSeed < 668,
    }
  }

  // Initialize belt loader
  const loaderConfig: BeltLoaderConfig = {
    supabase: supabase,
    courseCode: computed(() => courseCode.value),
    audioBaseUrl: AUDIO_S3_BASE_URL,
    generateScriptChunk,
  }

  beltLoader.value = useBeltLoader(loaderConfig)

  // Initialize from current progress position
  let startSeed: number
  if (props.classContext?.last_lego_id) {
    const seedMatch = props.classContext.last_lego_id.match(/^S(\d{4})L/)
    startSeed = seedMatch ? parseInt(seedMatch[1], 10) : 1
  } else {
    startSeed = beltProgress.value.completedRounds.value + 1
  }
  await beltLoader.value.initializeFromSeed(startSeed)

  console.log('[LearningPlayer] Belt loader ready, starting from seed', startSeed)
}

/**
 * Initialize offline play composable
 */
const initializeOfflinePlay = () => {
  if (offlinePlay.value) return

  offlinePlay.value = useOfflinePlay({
    getCachedItems: () => beltLoader.value?.getAllCachedItems() || [],
    recentAvoidCount: 10,
  })

  // Setup online/offline event listeners
  const handleOnline = () => {
    isOnline.value = true
    console.log('[LearningPlayer] Network: online')
  }
  const handleOffline = () => {
    isOnline.value = false
    console.log('[LearningPlayer] Network: offline - infinite play available')
  }

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  // Store cleanup for later
  const cleanup = () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }

  // Return cleanup for onUnmounted
  return cleanup
}

// Track cleanup function for offline play
let offlinePlayCleanup: (() => void) | null = null

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
  const previousSeeds = beltProgress.value.completedRounds.value

  // Set seeds to match current position (1 seed ≈ 1 round/LEGO)
  // Convert relative round index to absolute seed number using base offset
  const newSeeds = scriptBaseOffset.value + roundIndex + 1
  beltProgress.value.setSeeds(newSeeds)

  // Check for belt promotion (only celebrate if moving forward)
  // During driving mode, skip celebration — queue for display on exit
  if (showCelebration && newSeeds > previousSeeds && !isDrivingModeActive.value) {
    const newBelt = beltProgress.value.currentBelt.value
    if (newBelt.index > previousBelt.index) {
      beltJustEarned.value = newBelt
      console.log('[LearningPlayer] Belt promotion!', previousBelt.name, '->', newBelt.name)
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

// Create audio controller
const audioController = shallowRef(null)

// Use new cycle playback composable
const { state: cyclePlaybackState, playCycle, stop: stopCycle } = useCyclePlayback()
const currentCycle = ref<Cycle | null>(null)

// Offline cache for IndexedDB-based audio caching
const { initAudioSource, cache: offlineCache, cacheStats, refreshCacheStats } = useOfflineCache()

/**
 * Build an audio URL map from a ScriptItem
 * Maps audioId to URL for all audio in the item
 */
const buildAudioUrlMap = (scriptItem: any): Map<string, string> => {
  const map = new Map<string, string>()

  if (scriptItem?.audioRefs?.known?.id && scriptItem?.audioRefs?.known?.url) {
    map.set(scriptItem.audioRefs.known.id, scriptItem.audioRefs.known.url)
  }
  if (scriptItem?.audioRefs?.target?.voice1?.id && scriptItem?.audioRefs?.target?.voice1?.url) {
    map.set(scriptItem.audioRefs.target.voice1.id, scriptItem.audioRefs.target.voice1.url)
  }
  if (scriptItem?.audioRefs?.target?.voice2?.id && scriptItem?.audioRefs?.target?.voice2?.url) {
    map.set(scriptItem.audioRefs.target.voice2.id, scriptItem.audioRefs.target.voice2.url)
  }
  if (scriptItem?.presentationAudio?.id && scriptItem?.presentationAudio?.url) {
    map.set(scriptItem.presentationAudio.id, scriptItem.presentationAudio.url)
  }

  return map
}

/**
 * Create a getAudioSource function for a specific ScriptItem
 * Returns cached blob if available, otherwise falls back to URL for direct playback
 */
const createGetAudioSource = (scriptItem: any) => {
  const urlMap = buildAudioUrlMap(scriptItem)

  return async (audioId: string): Promise<{ type: 'blob'; blob: Blob } | { type: 'url'; url: string } | null> => {
    // Try IndexedDB cache first (for offline support)
    if (offlineCache) {
      const cached = await offlineCache.getCachedAudio(audioId)
      if (cached) {
        return { type: 'blob', blob: cached }
      }
    }

    // Fall back to URL for direct playback (works online, bypasses CORS)
    const url = urlMap.get(audioId)
    if (url) {
      return { type: 'url', url }
    }

    console.error('[getAudioSource] No URL found for audioId:', audioId)
    return null
  }
}

/**
 * Generic getAudioSource function for SimplePlayer pipeline
 * Resolves any audioId to either a cached blob or proxy URL
 */
const getAudioSourceForSession = async (audioId: string): Promise<{ type: 'blob'; blob: Blob } | { type: 'url'; url: string } | null> => {
  if (!audioId || audioId === 'undefined' || audioId === 'null') {
    console.error('[getAudioSourceForSession] Invalid audioId:', audioId)
    return null
  }

  // Try IndexedDB cache first (for offline support)
  if (offlineCache) {
    const cached = await offlineCache.getCachedAudio(audioId)
    if (cached) {
      return { type: 'blob', blob: cached }
    }
  }

  // Fall back to proxy URL for direct playback
  const proxyUrl = `/api/audio/${audioId}?courseId=${encodeURIComponent(courseCode.value)}`
  return { type: 'url', url: proxyUrl }
}

/**
 * Build proxy URL for audio caching.
 * The proxy bypasses CORS and allows us to fetch audio blobs.
 * Falls back to direct S3 URL if proxy isn't available.
 */
const buildCacheUrl = (audioId: string, s3Url: string, courseId: string): string => {
  // Use proxy endpoint for fetching (bypasses CORS)
  // Proxy: /api/audio/{audioId}?courseId={courseId}
  if (audioId && audioId !== 'undefined' && audioId !== 'null') {
    const proxyUrl = `/api/audio/${audioId}?courseId=${encodeURIComponent(courseId)}`
    return proxyUrl
  }
  // Fallback to S3 URL (will likely fail due to CORS, but try anyway)
  return s3Url
}

/**
 * Prefetch all audio for a round's items
 * Downloads audio files through proxy and caches them by audioId
 *
 * Call this BEFORE starting playback to ensure all audio is ready
 * Returns true if all audio was cached successfully, false if any failed
 */
const prefetchRoundAudio = async (items: any[], courseId: string): Promise<boolean> => {
  if (!offlineCache) {
    console.warn('[prefetchRoundAudio] No offline cache available')
    return false
  }

  const audioRefs = collectAllAudioRefs(items)
  const uncached = audioRefs.filter(ref => !offlineCache.isAudioCached(ref.id))

  if (uncached.length === 0) {
    // All audio already cached
    return true
  }

  console.log(`[prefetchRoundAudio] Caching ${uncached.length} audio files...`)

  // Fetch all uncached audio in parallel using proxy URLs
  const results = await Promise.allSettled(
    uncached.map(ref => {
      const cacheUrl = buildCacheUrl(ref.id, ref.url, courseId)
      return offlineCache.cacheAudio({ id: ref.id, url: cacheUrl }, courseId)
    })
  )

  const failed = results.filter(r => r.status === 'rejected')
  if (failed.length > 0) {
    console.warn(`[prefetchRoundAudio] ${failed.length}/${uncached.length} audio files failed to cache (non-blocking)`)
    // Don't return false - caching failures shouldn't block playback
    // Playback will still work using direct S3 URLs via Audio element
  }

  const succeeded = uncached.length - failed.length
  if (succeeded > 0) {
    console.log(`[prefetchRoundAudio] Successfully cached ${succeeded} audio files`)
  }
  return true  // Always return true - caching is best-effort, not required
}

/**
 * Track which round indices have already had their audio preloaded.
 * Prevents duplicate fetch() calls for the same round.
 */
const audioPreloadedRounds = new Set<number>()

/**
 * Preload audio for the first N SimpleRounds using fetch().
 * Warms the service worker's CacheFirst cache for /api/audio/* URLs.
 * Fire-and-forget: never blocks, silently ignores failures.
 * Tracks preloaded rounds to avoid duplicate fetches.
 */
const preloadSimpleRoundAudio = (rounds: any[], maxRounds = 1, startIndex = 0): Promise<void> => {
  const urls = new Set<string>()
  const end = Math.min(startIndex + maxRounds, rounds.length)
  for (let i = startIndex; i < end; i++) {
    if (audioPreloadedRounds.has(i)) continue
    audioPreloadedRounds.add(i)
    const round = rounds[i]
    for (const cycle of round.cycles || []) {
      if (cycle.known?.audioUrl) urls.add(cycle.known.audioUrl)
      if (cycle.target?.voice1Url) urls.add(cycle.target.voice1Url)
      if (cycle.target?.voice2Url) urls.add(cycle.target.voice2Url)
    }
  }

  if (urls.size === 0) return Promise.resolve()

  console.log(`[preloadSimpleRoundAudio] Preloading ${urls.size} audio URLs for rounds ${startIndex}-${end - 1}`)

  const fetches = Array.from(urls).map(url => fetch(url).catch(() => {}))
  return Promise.all(fetches).then(() => {})
}

/**
 * Start playing a cycle using the new useCyclePlayback system
 * Replaces orchestrator.startItem() calls
 *
 * Accepts either a ScriptItem or a playable item (which has _scriptItem attached)
 */
const startCyclePlayback = async (itemOrPlayable: any) => {
  if (!itemOrPlayable) return

  // Extract ScriptItem - either directly or from playable._scriptItem
  const scriptItem = itemOrPlayable._scriptItem || itemOrPlayable

  // Convert ScriptItem to Cycle
  const cycle = scriptItemToCycle(scriptItem)
  currentCycle.value = cycle

  // Create audio source resolver for this ScriptItem
  // Uses cached blobs if available, falls back to direct URL playback
  const getAudioSource = createGetAudioSource(scriptItem)

  // Emit fire-path event for network visualization
  // Extract LEGO IDs from the cycle for brain animation
  const legoIds = [cycle.legoId]  // Primary LEGO being taught
  const cycleDuration = cycle.known.durationMs + cycle.pauseDurationMs + cycle.target.voice1DurationMs + cycle.target.voice2DurationMs

  // Emit event that Brain3DView can listen to
  emit('cycle-started', { legoId: cycle.legoId, duration: cycleDuration })

  try {
    // Play the cycle - this handles all 4 phases internally
    await playCycle(cycle, getAudioSource)

    // When cycle completes, trigger the cycle_completed event
    // This maintains compatibility with existing event handling
    handleCycleEvent({ type: 'cycle_completed', data: { item: scriptItem } })
  } catch (err) {
    console.error('[startCyclePlayback] Cycle playback error:', err)
    // On error, still trigger completion to move to next item
    handleCycleEvent({ type: 'cycle_completed', data: { item: scriptItem } })
  }
}

// Map core CyclePhase to UI phases (for backward compatibility)
const Phase = {
  PROMPT: 'prompt',      // Maps to CyclePhase.PROMPT
  SPEAK: 'speak',        // Maps to CyclePhase.PAUSE
  VOICE_1: 'voice_1',    // Maps to CyclePhase.VOICE_1
  VOICE_2: 'voice_2',    // Maps to CyclePhase.VOICE_2
}

// Map cycle playback phases to UI phases
const cyclePhaseToUiPhase = (phase: string) => {
  switch (phase) {
    case 'PROMPT': return Phase.PROMPT
    case 'PAUSE': return Phase.SPEAK
    case 'VOICE_1': return Phase.VOICE_1
    case 'VOICE_2': return Phase.VOICE_2
    case 'IDLE': return Phase.PROMPT
    default: return Phase.PROMPT
  }
}

// Watch cycle playback state and update UI phase
watch(() => cyclePlaybackState.value.phase, (phase) => {
  currentPhase.value = cyclePhaseToUiPhase(phase)
})

// Watch SimplePlayer phase and map to UI phase (using local Phase constant)
watch(pendingPhase, (phase) => {
  const phaseMap: Record<string, string> = {
    'idle': Phase.PROMPT,
    'intro': Phase.PROMPT,  // Intro uses prompt styling
    'prompt': Phase.PROMPT,
    'pause': Phase.SPEAK,
    'voice1': Phase.VOICE_1,
    'voice2': Phase.VOICE_2,
  }
  currentPhase.value = phaseMap[phase] ?? Phase.PROMPT

  // Start ring animation when entering pause phase
  if (phase === 'pause') {
    // Get pause duration from current cycle
    const cycle = simplePlayer.currentCycle.value
    const duration = cycle?.pauseDuration || 6500
    startRingAnimation(duration)
  }
})

watch(() => cyclePlaybackState.value.isPlaying, (playing) => {
  if (!playing && !isSkipInProgress.value && !isSkippingBelt.value && !isCycleTransitioning.value) {
    isPlaying.value = false
  }
})

// State
const currentPhase = ref(Phase.PROMPT)
const currentItemIndex = ref(0)
// Note: isPlaying is now a computed from simplePlayer (defined above)
const isSkipInProgress = ref(false) // Flag to prevent cycle_stopped from resetting isPlaying during skip
const isCycleTransitioning = ref(false) // Flag to prevent watcher from resetting isPlaying between cycles
const isPreparingToPlay = ref(false) // True when play pressed but audio hasn't started yet
const preparingMessage = ref('') // Current "preparing" message being displayed

// Messages shown while preparing to play (after pressing play button)
const PREPARING_MESSAGES = [
  'firing up the engines...',
  'your brain called ahead...',
  'getting the ducks lined up...',
  'firing up the neurons...',
  'getting your phrases ready...',
  'connecting the pathways...',
  'tuning into your frequency...',
  'warming up the synapses...',
  'rounding up the vocabulary...',
  'polishing your words...',
  'queuing up the good stuff...',
]

// Start the "preparing to play" state with typewriter effect
let preparingTypewriterTimeout: ReturnType<typeof setTimeout> | null = null
const startPreparingState = () => {
  isPreparingToPlay.value = true
  const message = PREPARING_MESSAGES[Math.floor(Math.random() * PREPARING_MESSAGES.length)]
  preparingMessage.value = ''

  let charIndex = 0
  const typeChar = () => {
    if (charIndex < message.length && isPreparingToPlay.value) {
      preparingMessage.value += message[charIndex]
      charIndex++
      preparingTypewriterTimeout = setTimeout(typeChar, 35)
    }
  }
  typeChar()
}

const clearPreparingState = () => {
  isPreparingToPlay.value = false
  preparingMessage.value = ''
  if (preparingTypewriterTimeout) {
    clearTimeout(preparingTypewriterTimeout)
    preparingTypewriterTimeout = null
  }
}

// Emit play state changes to parent (for nav bar play/stop toggle)
watch(isPlaying, (playing) => {
  emit('playStateChanged', playing)
})

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
const phrasesSpokenCount = ref(0) // Cycles where VAD detected learner speech
const showSessionComplete = ref(false)
const showBeltProgressModal = ref(false)

// Lifetime learning minutes (would come from persistence in production)
// For now, track session time and estimate based on session history
const lifetimeLearningMinutes = ref(0)

// ============================================
// LEARNING HINTS - Contextual phase instructions
// Show for first ~10 prompts per session, dismissible with X
// ============================================
const LEARNING_HINT_PROMPT_LIMIT = 10 // Show hints for first N prompts per session
const learningHintDismissed = ref(false) // User clicked X to dismiss
const learningHintPromptsShown = ref(0) // Counter for this session

// NOTE: showLearningHint and phaseInstruction computed properties are defined
// after isIntroPhase (around line ~1510) to avoid dependency issues

// Function to dismiss learning hints
function dismissLearningHint() {
  learningHintDismissed.value = true
}

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
  loadMinimalConstellation,
  stats: networkStats,
  reset: resetNetwork,  // Reset network on belt skip
  prebuiltNetwork: networkState,  // Direct access for clearing revealed nodes
} = distinctionNetwork

// Backwards compatibility aliases
const networkNodes = network.nodes
const networkLinks = network.edges
const heroNodeId = network.heroNodeId
const introducedLegoIds = computed(() => {
  const ids = new Set<string>()
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
  const count = dbNetworkNodes.value.length
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
const networkInitialized = ref(false) // True after initializeNetwork() has been called once

// Smooth ring progress (0-100) - continuous animation
const ringProgressRaw = ref(0)
let ringAnimationFrame = null
let pauseStartTime = 0
const pauseDurationRef = ref(DEFAULT_CONFIG.cycle.pause_duration_ms)

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
  // Read from currentCycle to ensure text/audio are locked together
  if (currentCycle.value) {
    return {
      known: currentCycle.value.known.text || '',
      target: currentCycle.value.target.text || '',
    }
  }
  // Fallback to currentItem for backwards compatibility
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

// Target text visible during VOICE_2 — always shown as fallback when no LEGO tiles
const showTargetText = computed(() =>
  currentPhase.value === Phase.VOICE_2 && !isTransitioningItem.value
)

// Stable known text - updates when not transitioning (prevents flash) OR when phrase changes
const displayedKnownText = ref('')
const lastKnownPhrase = ref('') // Track what phrase we've displayed
watch([() => isTransitioningItem.value, () => currentPhrase.value.known], ([transitioning, newKnown]) => {
  // CRITICAL FIX: Always update if the underlying phrase changed (item transitioned)
  // This prevents showing old known text while new audio plays
  const phraseChanged = newKnown !== lastKnownPhrase.value

  // Update when NOT transitioning, OR when phrase changed (MUST update regardless of transition state)
  if (!transitioning || phraseChanged) {
    displayedKnownText.value = newKnown
    lastKnownPhrase.value = newKnown
  }
}, { immediate: true })

// Stable target text - only updates when hidden (prevents flash of new target between cycles)
const displayedTargetText = ref('')
watch([showTargetText, () => currentPhrase.value.target], ([showing, newTarget]) => {
  // Only update when target text is NOT visible or on first render.
  // When a new cycle loads, the phase briefly stays VOICE_2 from the previous cycle
  // before switching to PROMPT. If we updated here, the new target would flash visibly.
  // Instead, we wait until showTargetText becomes false (PROMPT phase), update then,
  // and the correct text is ready by the time VOICE_2 arrives.
  if (!showing || !displayedTargetText.value) {
    displayedTargetText.value = newTarget
  }
}, { immediate: true })

// Component breakdown for M-type LEGOs (visual display only)
// Format: [{known: "after", target: "después de"}, ...]
const displayedComponents = ref<Array<{known: string, target: string}>>([])
watch(() => {
  // Read from current cycle first (sync, always up-to-date)
  const cycle = simplePlayer.currentCycle.value as any
  if (cycle?.components) return cycle.components
  // Fallback: playable item (set async, may lag behind cycle changes)
  const item = useRoundBasedPlayback.value
    ? currentPlayableItem.value
    : sessionItems.value[currentItemIndex.value]
  if (item?.components) return item.components
  return undefined
}, (components) => {
  displayedComponents.value = components || []
}, { immediate: true })

// Is current item an intro? (network should fade, show typewriter message)
// NOTE: Only 'intro' items show typewriter. 'debut' items (lego_itself) show normal phrase display.
const isIntroPhase = computed(() => {
  const item = useRoundBasedPlayback.value
    ? currentPlayableItem.value
    : sessionItems.value[currentItemIndex.value]
  return item?.type === 'intro'
})

// Is current item intro OR debut? (for showing component breakdown tiles)
// Uses cycle ID for sync detection (currentPlayableItem is set async, causes race)
const isIntroOrDebutPhase = computed(() => {
  const cycleId = (simplePlayer.currentCycle.value as any)?.id || ''
  if (cycleId.includes('_intro_') || cycleId.includes('_debut_')) return true
  // Fallback for legacy path
  const item = useRoundBasedPlayback.value
    ? currentPlayableItem.value
    : sessionItems.value[currentItemIndex.value]
  return item?.type === 'intro' || item?.type === 'debut'
})

// ============================================
// LEARNING HINTS - Computed properties (defined after isIntroPhase)
// ============================================

// Computed: should we show the learning hint?
const showLearningHint = computed(() => {
  // Don't show if user dismissed
  if (learningHintDismissed.value) return false
  // Don't show after prompt limit
  if (learningHintPromptsShown.value >= LEARNING_HINT_PROMPT_LIMIT) return false
  // Don't show during intro phase (typewriter message shows instead)
  if (isIntroPhase.value) return false
  return true
})

// Computed: instruction text based on current phase
const phaseInstruction = computed(() => {
  switch (currentPhase.value) {
    case Phase.PROMPT:
      return 'get ready to speak'
    case Phase.SPEAK:
      return "you're meant to be speaking now"
    case Phase.VOICE_1:
    case Phase.VOICE_2:
      return 'listen carefully'
    default:
      return ''
  }
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
// Read from currentCycle to ensure text/audio are locked together
const visibleTexts = computed(() => {
  if (currentCycle.value) {
    return {
      known: currentCycle.value.known.text || '',
      target: currentCycle.value.target.text || '',
    }
  }
  // Fallback to currentItem for backwards compatibility during transition
  return {
    known: currentItem.value?.phrase?.phrase?.known || '',
    target: currentItem.value?.phrase?.phrase?.target || '',
  }
})

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
  const progress = Math.min((elapsed / pauseDurationRef.value) * 100, 100)

  ringProgressRaw.value = progress

  if (progress < 100) {
    ringAnimationFrame = requestAnimationFrame(animateRing)
  }
}

const startRingAnimation = (duration) => {
  pauseStartTime = Date.now()
  pauseDurationRef.value = duration || DEFAULT_CONFIG.cycle.pause_duration_ms
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
  // Maximum number of preloaded URLs to keep (prevents memory leak in long sessions)
  static MAX_PRELOAD_CACHE_SIZE = 50

  // TypeScript property declarations
  endedCallbacks: Set<() => void>
  audio: HTMLAudioElement
  currentCleanup: (() => void) | null
  preloadedUrls: Set<string>
  preloadOrder: string[]
  preloadedAudioElements: Map<string, HTMLAudioElement>
  skipNextNotify: boolean
  suppressAllCallbacks: boolean
  playGeneration: number
  audioSource: any
  _lastEndedHandler: (() => void) | null
  _lastErrorHandler: ((e: any) => void) | null

  constructor() {
    this.endedCallbacks = new Set()
    // Create audio element immediately for mobile compatibility
    // This ensures intro and cycle audio use the SAME element (mobile unlock)
    this.audio = new Audio()
    this.currentCleanup = null
    this.preloadedUrls = new Set()
    this.preloadOrder = []  // Track insertion order for LRU eviction
    this.preloadedAudioElements = new Map()  // url → Audio element (to stop zombie preloads)
    this.skipNextNotify = false  // Set true to skip orchestrator callbacks (for intro/welcome)
    this.suppressAllCallbacks = false  // Set true during skip to prevent any audio callbacks
    this.playGeneration = 0  // Incremented on stop() to invalidate pending callbacks
    this.audioSource = null  // Optional AudioSource for IndexedDB caching
    this._lastEndedHandler = null
    this._lastErrorHandler = null
  }

  /**
   * Set the AudioSource for cache-first URL resolution.
   * When set, play() will use cached blob URLs when available.
   */
  setAudioSource(audioSource) {
    this.audioSource = audioSource
  }

  async play(audioRef) {
    // Stop any currently playing audio and cleanup handlers
    this.stop()

    if (!audioRef?.url) {
      console.warn('[AudioController] No URL in audioRef:', audioRef)
      this._notifyEnded()
      return Promise.resolve()
    }

    // Resolve URL through cache layer if available (returns blob: URL if cached)
    let url = audioRef.url
    if (this.audioSource) {
      try {
        url = await this.audioSource.getAudioUrl(audioRef)
      } catch (err) {
        // Fall back to direct URL silently
        url = audioRef.url
      }
    }

    // Capture generation at start of this play - if it changes, this play was cancelled
    const playGen = this.playGeneration || 0

    return new Promise<void>((resolve) => {
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
        // Audio errors are handled gracefully - cycle continues
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
          // NotAllowedError means autoplay blocked - expected on mobile
          // All errors advance the cycle to keep playback moving
          onError(e)
        })
      }
    })
  }

  _notifyEnded() {
    // Skip all notifications during skip operation
    if (this.suppressAllCallbacks) {
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
      // Clear src completely to prevent cached audio playback
      this.audio.removeAttribute('src')
      // Force browser to release the audio buffer by calling load() with empty src
      // This is more aggressive than just removing src
      this.audio.load()
      // Don't null the audio element - reuse it for mobile compatibility
    }

    // Stop all "zombie" preload audio elements that may still be playing
    for (const preloadAudio of this.preloadedAudioElements.values()) {
      try {
        preloadAudio.pause()
        preloadAudio.src = ''
        preloadAudio.load()
      } catch (e) {
        console.warn('[AudioController] Error stopping preload element:', e)
      }
    }
  }

  /**
   * Hard reset - completely destroys and recreates audio state
   * Use this on skip operations to ensure NO audio from previous state can play
   */
  hardReset() {
    // First do a normal stop (this also stops all preload elements)
    this.stop()

    // Clear all callbacks
    this.endedCallbacks.clear()

    // Clear preload cache
    this.preloadedUrls.clear()
    this.preloadOrder.length = 0
    this.preloadedAudioElements.clear()

    // Recreate audio element to ensure clean state
    // This is the nuclear option - guarantees no stale audio
    if (this.audio) {
      // Remove all event listeners by cloning
      const oldAudio = this.audio
      this.audio = new Audio()
      this.audio.preload = 'auto'

      // Clean up old element
      oldAudio.pause()
      oldAudio.src = ''
      oldAudio.load()
    }

    console.log('[AudioController] Hard reset complete - all audio state cleared')
  }

  async preload(audioRef) {
    const url = audioRef?.url
    if (!url || this.preloadedUrls.has(url)) return

    // LRU eviction: if cache is full, remove oldest entries
    while (this.preloadOrder.length >= RealAudioController.MAX_PRELOAD_CACHE_SIZE) {
      const oldestUrl = this.preloadOrder.shift()
      this.preloadedUrls.delete(oldestUrl)
      // Stop and remove the old Audio element to prevent zombie playback
      const oldAudio = this.preloadedAudioElements.get(oldestUrl)
      if (oldAudio) {
        oldAudio.pause()
        oldAudio.src = ''
        oldAudio.load()
        this.preloadedAudioElements.delete(oldestUrl)
      }
    }

    // Create a temporary Audio element just to trigger browser caching
    const audio = new Audio()
    audio.preload = 'auto'
    audio.src = url
    audio.load()

    this.preloadedUrls.add(url)
    this.preloadOrder.push(url)
    this.preloadedAudioElements.set(url, audio)  // Track element for cleanup
  }

  isPreloaded(audioRef) {
    return this.preloadedUrls.has(audioRef?.url)
  }

  // Clear the preload cache (call on skip to prevent stale audio)
  clearPreloadCache() {
    // Stop all preloaded audio elements to prevent zombie playback
    for (const preloadAudio of this.preloadedAudioElements.values()) {
      preloadAudio.pause()
      preloadAudio.src = ''
      preloadAudio.load()
    }
    this.preloadedAudioElements.clear()
    this.preloadedUrls.clear()
    this.preloadOrder.length = 0
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
  switch (event.type) {
    case 'phase_changed':
      // Handle phase-specific logic
      switch (event.phase) {
        case CyclePhase.PROMPT:
          // Clear "preparing to play" message - audio is now playing
          clearPreparingState()
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
            }
          }
          break
      }
      currentPhase.value = cyclePhaseToUiPhase(event.phase)
      break

    case 'pause_started':
      // Start the ring animation for the SPEAK phase
      startRingAnimation(event.data?.duration)
      break

    case 'cycle_completed':
      // Handle cycle completion from new playback system
      // Falls through to item_completed logic
    case 'item_completed':
      itemsPracticed.value++
      learningHintPromptsShown.value++ // Track for auto-hiding learning hints

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

          // Prefetch audio for new round (fire-and-forget - will complete during setTimeout delay)
          const newRound = cachedRounds.value[currentRoundIndex.value]
          if (newRound?.items && courseCode.value) {
            prefetchRoundAudio(newRound.items, courseCode.value).then(() => {
              // Also prefetch next round after current finishes
              const nextRound = cachedRounds.value[currentRoundIndex.value + 1]
              if (nextRound?.items) {
                prefetchRoundAudio(nextRound.items, courseCode.value)
              }
            })
          }
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
        // Set transition flag to prevent watcher from setting isPlaying = false
        isCycleTransitioning.value = true
        console.log('[LearningPlayer] Scheduling next item, nextScriptItem:', nextScriptItem?.type, nextScriptItem?.legoId)
        setTimeout(async () => {
          console.log('[LearningPlayer] setTimeout fired, isPlaying:', isPlaying.value, 'generation:', playbackGeneration.value, '===', generationAtStart)
          // CRITICAL: Check if we've jumped since this callback was queued
          if (playbackGeneration.value !== generationAtStart) {
            console.log('[LearningPlayer] Stale callback detected (generation mismatch), skipping')
            isCycleTransitioning.value = false
            return
          }
          if (!isPlaying.value) {
            console.log('[LearningPlayer] Not playing, aborting next item')
            isCycleTransitioning.value = false
            return
          }

          // Ensure previous audio is fully stopped
          if (audioController.value) {
            audioController.value.stop()
          }

          // INTRO items: play introduction audio directly, then advance
          if (nextScriptItem.type === 'intro') {
              console.log('[LearningPlayer] Playing INTRO item for:', nextScriptItem.legoId)
              // Clear transition flag for intro playback
              isCycleTransitioning.value = false
              const introPlayable = await scriptItemToPlayableItem(nextScriptItem)
              // CRITICAL: Check generation after async - user may have skipped during conversion
              if (playbackGeneration.value !== generationAtStart) {
                console.log('[LearningPlayer] Stale after introPlayable conversion, aborting')
                return
              }
              if (introPlayable) {
                currentPlayableItem.value = introPlayable
                // Play intro audio and wait for completion
                const introPlayed = await playIntroductionAudioDirectly(nextScriptItem)
                // CRITICAL: Check generation after async intro audio
                if (playbackGeneration.value !== generationAtStart) {
                  console.log('[LearningPlayer] Stale after intro audio, aborting')
                  return
                }
                if (introPlayed) {
                  console.log('[LearningPlayer] INTRO complete, advancing to next item')
                }
                // Advance to next item in round (the DEBUT that follows)
                currentItemInRound.value++
                // Get and play the next item directly (don't call handleCycleEvent which would double-increment)
                const followingItem = currentRound.value?.items[currentItemInRound.value]
                if (followingItem && isPlaying.value) {
                  const followingPlayable = await scriptItemToPlayableItem(followingItem)
                  // CRITICAL: Check generation after async conversion
                  if (playbackGeneration.value !== generationAtStart) {
                    console.log('[LearningPlayer] Stale after followingPlayable conversion, aborting')
                    return
                  }
                  if (followingPlayable) {
                    currentPlayableItem.value = followingPlayable
                    await startCyclePlayback(followingItem)
                  }
                }
              }
              return
            }

            console.log('[LearningPlayer] Converting next script item to playable...')
            const nextPlayable = await scriptItemToPlayableItem(nextScriptItem)
            // CRITICAL: Check generation after async - user may have skipped during conversion
            if (playbackGeneration.value !== generationAtStart) {
              console.log('[LearningPlayer] Stale after nextPlayable conversion, aborting')
              isCycleTransitioning.value = false
              return
            }
            if (nextPlayable) {
              // Store for currentItem computed
              currentPlayableItem.value = nextPlayable
              console.log('[LearningPlayer] Starting next cycle playback')
              // Clear transition flag - cycle is starting
              isCycleTransitioning.value = false
              await startCyclePlayback(nextScriptItem)
            } else {
              console.warn('[LearningPlayer] nextPlayable is null - cannot start next cycle')
              isCycleTransitioning.value = false
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
          if (isPlaying.value) {
            // Stop any previous audio
            stopCycle()
            // Check if next LEGO needs an introduction first
            await playIntroductionIfNeeded(nextItem)
            // Then start the practice cycles
            if (isPlaying.value) {
              await startCyclePlayback(nextItem)
            }
          }
        }, 350)
      }
      break

    case 'cycle_stopped':
      // Don't reset isPlaying if we're in the middle of a skip operation
      // (skip stops the old cycle but immediately starts a new one)
      // isSkipInProgress: used by skip/revisit/jumpToRound for single-item navigation
      // isSkippingBelt: used by belt skip functions that stop audio before calling jumpToRound
      if (!isSkipInProgress.value && !isSkippingBelt.value) {
        isPlaying.value = false
      }
      break

    case 'error':
      // Errors are handled gracefully - playback continues
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
  // Use the component's exposed zoomIn method
  ;(networkViewRef.value as any)?.zoomIn?.()
}

const handleZoomOut = () => {
  // Use the component's exposed zoomOut method
  ;(networkViewRef.value as any)?.zoomOut?.()
}

const handleZoomReset = () => {
  // Use the component's exposed resetZoomPan method
  ;(networkViewRef.value as any)?.resetZoomPan?.()
}

const handlePause = () => {
  // Stop introduction audio if playing
  if (isPlayingIntroduction.value) {
    skipIntroduction()
  }

  // Stop welcome audio if playing
  if (isPlayingWelcome.value) {
    skipWelcome()
  }

  // Use SimplePlayer
  simplePlayer.pause()

  if (ringAnimationFrame) {
    cancelAnimationFrame(ringAnimationFrame)
  }
}

const handleResume = async () => {
  // On first play, ask for adaptation consent (user gesture context)
  // Wait for response before starting playback
  if (adaptationConsent.value === null) {
    showAdaptationPrompt.value = true
    return // Don't start until consent is resolved
  }

  // On first play, ensure audio for first 2 rounds is fully cached before starting
  // Better to wait 1-2s at startup than stall mid-playback
  if (!hasEverStarted.value && loadedRounds.value.length > 0) {
    startPreparingState()
    const currentIdx = simplePlayer.roundIndex.value ?? 0
    await preloadSimpleRoundAudio(loadedRounds.value, 2, currentIdx)
  }

  // Mark as started so displayPhrases shows cycle text instead of "ready when you are"
  hasEverStarted.value = true

  // Lazily initialize network on first play (deferred from startup)
  if (!networkInitialized.value) {
    nextTick(() => {
      ensureNetworkInitialized()
      const roundIdx = simplePlayer.roundIndex.value ?? 0
      if (roundIdx > 0) {
        populateNetworkUpToRound(roundIdx)
      } else if (loadedRounds.value.length > 0) {
        populateNetworkUpToRound(0)
      }
    })
  }

  // Check if welcome audio needs to play first (only on first ever play)
  // Must await — don't start SimplePlayer until welcome finishes
  await playWelcomeIfNeeded()

  // Use SimplePlayer
  simplePlayer.play()
}

/**
 * Start playback using SimplePlayer
 */
const startSimplePlayback = async () => {
  console.log('[LearningPlayer] Starting SimplePlayer playback...')

  // Wait for rounds to be loaded
  if (loadedRounds.value.length === 0) {
    console.log('[LearningPlayer] Waiting for rounds to load...')
    startPreparingState()
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        unwatch()
        console.error('[LearningPlayer] Timed out waiting for rounds to load (30s)')
        resolve()
      }, 30_000)
      const unwatch = watch(
        () => loadedRounds.value.length > 0,
        (hasRounds) => {
          if (hasRounds) {
            clearTimeout(timeout)
            unwatch()
            resolve()
          }
        },
        { immediate: true }
      )
    })
    console.log('[LearningPlayer] Rounds loaded')
  }

  hasEverStarted.value = true

  // Start belt progress session for time tracking
  if (beltProgress.value) {
    beltProgress.value.startSession(beltProgress.value.currentSeedNumber.value ?? 0)
  }

  // Check if welcome audio needs to play first (only on first ever play)
  await playWelcomeIfNeeded()

  // Start playback
  simplePlayer.play()
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

    // Create abort controller for this intro
    introAbortController = new AbortController()
    introEventCleanups = []

    // Play intro using DEDICATED audio element (not shared with audioController)
    // This prevents cross-contamination when skip is called
    return new Promise((resolve) => {
      audioController.value?.stop()

      // Tell audioController to skip notifying orchestrator when this audio ends
      if (audioController.value) {
        audioController.value.skipNextNotify = true
      }

      // Check if already aborted (null OR aborted signal)
      if (!introAbortController || introAbortController.signal.aborted) {
        resolve(false)
        return
      }

      // IMPORTANT: Use dedicated audio element, not shared with audioController
      const audio = new Audio()
      introAudioElement = audio

      const cleanup = () => {
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        const idx = introEventCleanups.indexOf(cleanup)
        if (idx > -1) introEventCleanups.splice(idx, 1)
      }

      const onEnded = () => {
        cleanup()
        isPlayingIntroduction.value = false
        introductionPhase.value = false
        introAudioElement = null
        introAbortController = null
        introEventCleanups = []
        // Reset skipNextNotify so next audio triggers orchestrator callbacks
        if (audioController.value) {
          audioController.value.skipNextNotify = false
        }
        console.log('[LearningPlayer] Introduction complete for LEGO:', legoId)
        resolve(true)
      }

      const onError = (e) => {
        console.error('[LearningPlayer] Introduction audio error:', e)
        cleanup()
        isPlayingIntroduction.value = false
        introductionPhase.value = false
        introAudioElement = null
        introAbortController = null
        introEventCleanups = []
        // Reset skipNextNotify so next audio triggers orchestrator callbacks
        if (audioController.value) {
          audioController.value.skipNextNotify = false
        }
        resolve(false)
      }

      // Track cleanup for skipIntroduction
      introEventCleanups.push(cleanup)

      // Listen to abort controller
      if (introAbortController) {
        introAbortController.signal.addEventListener('abort', () => {
          audio.pause()
          audio.src = ''
          cleanup()
          resolve(false)
        }, { once: true })
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
      { legoId } as import('../composables/useScriptCache').ScriptItem
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

  // Create abort controller for this intro sequence
  introAbortController = new AbortController()
  introEventCleanups = []

  // Create ONE dedicated audio element for the entire intro sequence
  // CRITICAL: Reuse same element for mobile compatibility (user gesture permission)
  // Don't share with audioController to avoid cross-contamination on skip
  const introAudio = new Audio()
  introAudio.preload = 'auto'
  introAudioElement = introAudio

  // Helper to play a single audio and wait for it to end (with cancellation support)
  // Reuses the same introAudio element for all segments
  const playAudioAndWait = (url) => {
    return new Promise((resolve) => {
      // Check if already aborted (introAbortController set to null OR aborted)
      // CRITICAL: skipIntroduction nulls out introAbortController AND introAudioElement
      if (!introAbortController || introAbortController.signal.aborted || !introAudioElement) {
        resolve(false)
        return
      }

      const cleanup = () => {
        introAudio.removeEventListener('ended', onEnded)
        introAudio.removeEventListener('error', onError)
        // Remove from tracked cleanups
        const idx = introEventCleanups.indexOf(cleanup)
        if (idx > -1) introEventCleanups.splice(idx, 1)
      }

      const onEnded = () => {
        cleanup()
        resolve(true)
      }

      const onError = (e) => {
        console.error('[LearningPlayer] Intro audio error:', e)
        cleanup()
        resolve(false)
      }

      // Track cleanup function for skipIntroduction to call
      introEventCleanups.push(cleanup)

      introAudio.addEventListener('ended', onEnded)
      introAudio.addEventListener('error', onError)

      // Also listen to abort controller signal
      if (introAbortController) {
        introAbortController.signal.addEventListener('abort', () => {
          introAudio.pause()
          introAudio.src = ''
          cleanup()
          resolve(false)
        }, { once: true })
      }

      introAudio.src = url
      introAudio.load()
      introAudio.play().catch((e) => {
        console.error('[LearningPlayer] Intro play() failed:', e)
        cleanup()
        resolve(false)
      })
    })
  }

  // Helper to pause for a duration (with cancellation support)
  const pause = (ms: number) => new Promise<void>(resolve => {
    // Check if already aborted (null OR aborted signal)
    if (!introAbortController || introAbortController.signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    // Safe to add listener since we already checked introAbortController exists
    introAbortController.signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })

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

    // Check if we were aborted mid-sequence
    if (introAbortController?.signal.aborted) {
      console.log('[LearningPlayer] Introduction was aborted mid-sequence')
      return false
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
    introAbortController = null
    introEventCleanups = []
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
    introAbortController = null
    introEventCleanups = []
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
let introAbortController = null // AbortController for cancelling pending intro audio
let introEventCleanups = [] // Array of cleanup functions for intro audio event listeners

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
    if (completedRounds.value > 0) {
      console.log('[LearningPlayer] Learner has progress (', completedRounds.value, 'seeds) - skipping welcome')
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
  console.log('[LearningPlayer] skipWelcome called')

  // 1. Stop and clean up the audio element
  if (welcomeAudioElement) {
    // Remove any event listeners by cloning the approach from skipIntroduction
    // We can't easily get references to the handlers, so we'll do a full cleanup
    welcomeAudioElement.pause()
    welcomeAudioElement.removeAttribute('src')
    welcomeAudioElement.src = ''
    try { welcomeAudioElement.load() } catch (e) { /* ignore */ }
  }

  // 2. Reset state
  isPlayingWelcome.value = false
  showWelcomeSkip.value = false
  welcomeAudioElement = null

  // 3. Reset skipNextNotify so next audio triggers orchestrator callbacks
  if (audioController.value) {
    audioController.value.skipNextNotify = false
  }

  // 4. Resolve the promise so startPlayback can continue
  if (welcomeResolve) {
    welcomeResolve(true)
    welcomeResolve = null
  }

  // 5. Mark as played (skipped counts as played)
  if (courseDataProvider.value) {
    await courseDataProvider.value.markWelcomePlayed(learnerId.value)
  }
  console.log('[LearningPlayer] Welcome fully skipped and cleaned up')
}

const skipIntroduction = () => {
  console.log('[LearningPlayer] skipIntroduction called')

  // 1. ABORT the abort controller FIRST - this signals all pending promises to resolve
  if (introAbortController) {
    introAbortController.abort()
    introAbortController = null
  }

  // 2. Call all tracked cleanup functions to remove event listeners
  for (const cleanup of introEventCleanups) {
    try { cleanup() } catch (e) { /* ignore */ }
  }
  introEventCleanups = []

  // 3. Force stop the audio element
  if (introAudioElement) {
    // Pause immediately
    introAudioElement.pause()
    // Remove src to release browser resources
    introAudioElement.removeAttribute('src')
    introAudioElement.src = ''
    // Force browser to release audio buffer
    try { introAudioElement.load() } catch (e) { /* ignore */ }
  }

  // 4. Reset state
  isPlayingIntroduction.value = false
  introductionPhase.value = false
  introAudioElement = null

  console.log('[LearningPlayer] Introduction fully skipped and cleaned up')
}

const startPlayback = async () => {
  // Show "preparing to play" message on cold start (first ever play)
  const isColdStart = !hasEverStarted.value
  if (isColdStart) {
    startPreparingState()
  }

  hasEverStarted.value = true
  isPlaying.value = true

  // Lazily initialize network on first play (deferred from startup)
  if (!networkInitialized.value) {
    nextTick(() => {
      ensureNetworkInitialized()
      // Populate network up to current position
      if (currentRoundIndex.value > 0) {
        populateNetworkUpToRound(currentRoundIndex.value)
      } else if (cachedRounds.value.length > 0) {
        populateNetworkUpToRound(0)
      }
    })
  }

  // Start belt progress session for time tracking
  if (beltProgress.value) {
    beltProgress.value.startSession(beltProgress.value.currentSeedNumber.value ?? 0)
  }

  // Check if welcome audio needs to play first (only on first ever play)
  await playWelcomeIfNeeded()

  // ============================================
  // ROUND-BASED PLAYBACK
  // ============================================
  if (useRoundBasedPlayback.value) {
    // Prefetch audio for current round before starting
    if (currentRound.value?.items && courseCode.value) {
      await prefetchRoundAudio(currentRound.value.items, courseCode.value)

      // Also prefetch next round in background (don't await)
      const nextRound = cachedRounds.value[currentRoundIndex.value + 1]
      if (nextRound?.items) {
        prefetchRoundAudio(nextRound.items, courseCode.value)
      }
    }

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

        // CRITICAL: Ensure complete audio silence before starting next item
        if (audioController.value) {
          audioController.value.stop()
        }
        await new Promise(resolve => setTimeout(resolve, 50))

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
            }
            await startCyclePlayback(nextPlayable)
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
    }

    await startCyclePlayback(playableItem)
    return
  }

  // ============================================
  // FALLBACK: SESSION-BASED PLAYBACK (demo mode)
  // ============================================
  if (currentItem.value) {
    // Check if this LEGO needs an introduction first
    await playIntroductionIfNeeded(currentItem.value)

    // Set pause duration: 1.5s boot up + target1 duration
    if (currentItem.value.audioDurations) {
      const pauseMs = getPauseDuration(Math.round(currentItem.value.audioDurations.target1 * 1000))
    }
    await startCyclePlayback(currentItem.value)
  }
}

/**
 * SKIP - Jump to start of NEXT round
 * IMPORTANT: Must fully halt all audio before advancing
 */
const handleSkip = async () => {
  // CRITICAL: Guard against concurrent skips - if already skipping, abort any playing intro and return
  if (isSkipInProgress.value) {
    console.log('[LearningPlayer] Skip already in progress - aborting current intro and returning')
    skipIntroduction() // Nuclear abort any playing intro
    return
  }

  console.log('[LearningPlayer] ========== SKIP REQUESTED ==========')

  // Use SimplePlayer
  console.log('[LearningPlayer] Using SimplePlayer skipRound')
  isSkipInProgress.value = true
  try {
    // Skip any intro/welcome audio
    if (isPlayingIntroduction.value) skipIntroduction()
    if (isPlayingWelcome.value) skipWelcome()
    // Clear path animations
    clearPathAnimation()
    // Skip to next round
    simplePlayer.skipRound()
  } finally {
    isSkipInProgress.value = false
  }
  return

  // Mark that we're in a skip operation (prevents cycle_stopped from resetting isPlaying)
  const wasPlaying = isPlaying.value
  isSkipInProgress.value = true

  // 0. INCREMENT GENERATION FIRST - invalidates any pending callbacks from previous position
  playbackGeneration.value++
  console.log('[LearningPlayer] Skip: Generation incremented to', playbackGeneration.value, 'wasPlaying:', wasPlaying)

  // 1. IMMEDIATELY suppress all audio callbacks to prevent race conditions
  if (audioController.value?.suppressCallbacks) {
    audioController.value.suppressCallbacks()
  }

  // 2. HALT ORCHESTRATOR FIRST - prevents it from starting new audio
  {
    stopCycle()
    console.log('[LearningPlayer] Skip: Orchestrator stopped')
  }

  // 3. HARD RESET audio controller - nuclear option to ensure clean slate
  // This recreates the audio element, clearing ALL browser buffers
  if (audioController.value) {
    audioController.value.hardReset()
    console.log('[LearningPlayer] Skip: Audio controller hard reset complete')
  }

  // 4. Skip any playing intro/welcome (these use separate audio elements)
  if (isPlayingIntroduction.value) {
    skipIntroduction()
    console.log('[LearningPlayer] Skip: Intro skipped')
  }
  if (isPlayingWelcome.value) {
    skipWelcome()
    console.log('[LearningPlayer] Skip: Welcome skipped')
  }

  // 5. Clear any path animations
  clearPathAnimation()

  // 6. Wait for complete audio silence - ensures no fragments can play
  // This is critical: we MUST wait for browser to fully release audio resources
  await new Promise(resolve => setTimeout(resolve, 50))

  // 7. Double-stop: call stop again after delay to catch any stragglers
  if (audioController.value) {
    audioController.value.stop()
  }

  // 8. Final settling delay for CSS transitions (300ms transition, add buffer)
  await new Promise(resolve => setTimeout(resolve, 100))
  console.log('[LearningPlayer] Skip: All audio cleanup complete, proceeding to next item')

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

    // Start the new round if wasPlaying (use captured value, not current isPlaying which may have been reset)
    if (wasPlaying && firstItem) {
      // Restore playing state since we're about to play
      isPlaying.value = true

      // INTRO items: play introduction audio directly, then advance to next item
      if (firstItem.type === 'intro') {
        console.log('[LearningPlayer] Skip → Playing INTRO for:', firstItem.legoId)
        const introPlayed = await playIntroductionAudioDirectly(firstItem)
        console.log('[LearningPlayer] Skip → intro played:', introPlayed)

        // CRITICAL: If intro was aborted (another skip happened), bail out completely
        // The other skip is now in control - don't interfere
        if (!introPlayed) {
          console.log('[LearningPlayer] Skip → intro was aborted, bailing out')
          isSkipInProgress.value = false
          return
        }

        // CRITICAL: Ensure complete audio silence before starting next item
        // This prevents any stale audio fragments from contaminating the new playback
        if (audioController.value) {
          audioController.value.stop()
        }
        // Brief delay to ensure browser has released audio resources
        await new Promise(resolve => setTimeout(resolve, 50))

        // Advance to next item (the DEBUT)
        currentItemInRound.value++
        const nextItem = cachedRounds.value[nextIndex]?.items?.[currentItemInRound.value]
        console.log('[LearningPlayer] Skip → advancing to item:', currentItemInRound.value, nextItem?.type)
        if (nextItem && isPlaying.value) {
          const nextPlayable = await scriptItemToPlayableItem(nextItem)
          if (nextPlayable) {
            currentPlayableItem.value = nextPlayable
            // Set pause duration for new item
            if (nextPlayable.audioDurations) {
              const pauseMs = getPauseDuration(Math.round(nextPlayable.audioDurations.target1 * 1000))
            }
            await startCyclePlayback(nextPlayable)
          }
        }
      } else {
        console.log('[LearningPlayer] Skip → firstItem NOT intro, starting directly')
        // Non-intro item: start directly via orchestrator
        {
          await startCyclePlayback(currentPlayableItem.value)
        }
      }
    }
  } else {
    // Fallback: skip current phase in demo mode
    {
      
    }
  }

  // Re-enable callbacks now that skip is complete
  if (audioController.value?.enableCallbacks) {
    audioController.value.enableCallbacks()
  }

  // Clear skip flag - skip operation complete
  isSkipInProgress.value = false
  console.log('[LearningPlayer] Skip: Complete, isPlaying:', isPlaying.value)
}

/**
 * REVISIT - Go back to start of current round, or previous round if already at start
 * Delegates to SimplePlayer.jumpToRound() which owns playback state.
 */
const handleRevisit = async () => {
  if (!useRoundBasedPlayback.value || cachedRounds.value.length === 0) return

  console.log('[LearningPlayer] ========== REVISIT REQUESTED ==========')

  // Skip any playing intro/welcome
  if (isPlayingIntroduction.value) skipIntroduction()
  if (isPlayingWelcome.value) skipWelcome()
  clearPathAnimation()

  // Determine target round: go to start of current, or previous if already at start
  let targetIndex = currentRoundIndex.value
  if (currentItemInRound.value <= 1 && currentRoundIndex.value > 0) {
    targetIndex = currentRoundIndex.value - 1
  }

  console.log('[LearningPlayer] Revisit → jumping to round', targetIndex, 'LEGO:', cachedRounds.value[targetIndex]?.legoId)

  // Update belt to match new position (no celebration when going back)
  updateBeltForPosition(targetIndex, false)

  // Delegate to SimplePlayer which handles stop/play/state correctly
  simplePlayer.jumpToRound(targetIndex)
}

/**
 * Jump to a specific round by index (0-based)
 * For QA/Script View: allows jumping to any point in the course
 * Belt progress updates to match position (allows quick calibration)
 * IMPORTANT: Must fully halt all audio before jumping
 */
const jumpToRound = async (roundIndex) => {
  if (!useRoundBasedPlayback.value) {
    console.log('[LearningPlayer] Jump not available - not in round mode')
    return false
  }

  console.log('[LearningPlayer] Using SimplePlayer jumpToRound:', roundIndex)
  // Skip any intro/welcome audio
  if (isPlayingIntroduction.value) skipIntroduction()
  if (isPlayingWelcome.value) skipWelcome()
  // Clear path animations
  clearPathAnimation()
  // Jump via SimplePlayer (0-based index)
  simplePlayer.jumpToRound(roundIndex)
  return true

  // Legacy validation
  if (!cachedRounds.value.length) {
    console.log('[LearningPlayer] Jump not available - no cached rounds')
    return false
  }

  if (roundIndex < 0 || roundIndex >= cachedRounds.value.length) {
    console.log('[LearningPlayer] Invalid round index:', roundIndex)
    return false
  }

  // Guard against concurrent operations
  if (isSkipInProgress.value) {
    console.log('[LearningPlayer] Skip/jump already in progress - aborting intro and returning')
    skipIntroduction()
    return false
  }

  console.log('[LearningPlayer] ========== JUMP TO ROUND', roundIndex, '==========')

  // Mark that we're in a skip operation (prevents cycle_stopped from resetting isPlaying)
  const wasPlaying = isPlaying.value
  isSkipInProgress.value = true

  // 0. Increment generation to invalidate any pending callbacks from previous position
  playbackGeneration.value++
  console.log('[LearningPlayer] Jump: Generation incremented to', playbackGeneration.value, 'wasPlaying:', wasPlaying)

  // 1. IMMEDIATELY suppress all audio callbacks to prevent race conditions
  if (audioController.value?.suppressCallbacks) {
    audioController.value.suppressCallbacks()
  }

  // 2. HALT ORCHESTRATOR FIRST - prevents it from starting new audio
  {
    stopCycle()
    console.log('[LearningPlayer] Jump: Orchestrator stopped')
  }

  // 3. HARD RESET audio controller - nuclear option to ensure clean slate
  if (audioController.value) {
    audioController.value.hardReset()
    console.log('[LearningPlayer] Jump: Audio controller hard reset complete')
  }

  // 4. Skip any playing intro/welcome (these use separate audio elements)
  if (isPlayingIntroduction.value) {
    skipIntroduction()
    console.log('[LearningPlayer] Jump: Intro skipped')
  }
  if (isPlayingWelcome.value) {
    skipWelcome()
    console.log('[LearningPlayer] Jump: Welcome skipped')
  }

  // 5. Clear path animations
  clearPathAnimation()

  // 6. Wait for complete audio silence
  await new Promise(resolve => setTimeout(resolve, 50))

  // 7. Double-stop: call stop again after delay to catch any stragglers
  if (audioController.value) {
    audioController.value.stop()
  }

  // 8. Final settling delay for CSS transitions
  await new Promise(resolve => setTimeout(resolve, 100))
  console.log('[LearningPlayer] Jump: All audio cleanup complete, proceeding')

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

      // CRITICAL: If intro was aborted, bail out
      if (!introPlayed) {
        console.log('[LearningPlayer] Jump → intro was aborted, bailing out')
        isSkipInProgress.value = false
        return false
      }

      // CRITICAL: Ensure complete audio silence before starting next item
      if (audioController.value) {
        audioController.value.stop()
      }
      await new Promise(resolve => setTimeout(resolve, 50))

      // Advance to next item (the DEBUT)
      currentItemInRound.value++
      const nextItem = cachedRounds.value[roundIndex]?.items?.[currentItemInRound.value]
      console.log('[LearningPlayer] Jump → advancing to item:', currentItemInRound.value, nextItem?.type)
      if (nextItem && isPlaying.value) {
        const nextPlayable = await scriptItemToPlayableItem(nextItem)
        if (nextPlayable) {
          currentPlayableItem.value = nextPlayable
          await startCyclePlayback(nextPlayable)
        }
      }
    } else {
      console.log('[LearningPlayer] Jump → firstItem NOT intro, starting directly')
      // Non-intro item: start directly via orchestrator
      {
        await startCyclePlayback(currentPlayableItem.value)
      }
    }
  }

  // Re-enable callbacks now that jump is complete
  if (audioController.value?.enableCallbacks) {
    audioController.value.enableCallbacks()
  }

  // Clear skip flag - jump operation complete
  isSkipInProgress.value = false
  console.log('[LearningPlayer] Jump: Complete, isPlaying:', isPlaying.value)

  return true
}

/**
 * Jump to start of next belt
 * Uses SessionController's lazy loading to load the target round on demand
 */
const handleSkipToNextBelt = async () => {
  // Get current playing position's seed (not stored progress)
  const currentRound = simplePlayer.currentRound.value
  const currentSeedId = currentRound?.seedId || 'S0001'
  const currentSeedNumber = parseInt(currentSeedId.substring(1, 5), 10) || 1

  // Calculate next belt based on CURRENT playing position
  const BELT_THRESHOLDS = [0, 8, 20, 40, 80, 150, 280, 400]
  const BELT_NAMES = ['White', 'Yellow', 'Orange', 'Green', 'Blue', 'Purple', 'Brown', 'Black']

  let currentBeltIndex = 0
  for (let i = BELT_THRESHOLDS.length - 1; i >= 0; i--) {
    if (currentSeedNumber >= BELT_THRESHOLDS[i]) {
      currentBeltIndex = i
      break
    }
  }

  const nextBeltIndex = currentBeltIndex + 1
  const nextBeltThreshold = BELT_THRESHOLDS[nextBeltIndex]
  const nextBeltNameFromPosition = BELT_NAMES[nextBeltIndex]

  console.log('[LearningPlayer] handleSkipToNextBelt called', {
    currentSeedId,
    currentSeedNumber,
    currentBeltName: BELT_NAMES[currentBeltIndex],
    nextBeltName: nextBeltNameFromPosition,
    nextBeltThreshold,
    isPlaying: simplePlayer.isPlaying.value,
  })

  if (nextBeltIndex >= BELT_THRESHOLDS.length || !nextBeltThreshold) {
    console.log('[LearningPlayer] Cannot skip - already at highest belt')
    return
  }

  isSkippingBelt.value = true
  try {
    const targetSeed = nextBeltThreshold
    console.log(`[LearningPlayer] Skipping to ${nextBeltNameFromPosition} belt - seed ${targetSeed}`)

    // Reset the brain network for fresh start at new belt
    // This keeps the network lightweight during belt skipping
    if (networkState?.revealedNodeIds) {
      networkState.revealedNodeIds.value = new Set<string>()
      console.log('[LearningPlayer] Reset brain network for belt skip')
    }

    // Check if target seed is already loaded
    const existingRoundIndex = simplePlayer.findRoundIndexForSeed(targetSeed)

    if (existingRoundIndex < 0 && supabase?.value) {
      // Target seed not loaded - load it via generateSimpleScript (blocking)
      // Always emit from round 1 to ensure correct round building (including intros)
      console.debug(`[progressiveLoad] Belt skip: target seed ${targetSeed} not loaded, loading now...`)
      const skipResult = await generateSimpleScript(supabase.value, courseCode.value, targetSeed, targetSeed + 5, 1)

      if (skipResult.items.length > 0) {
        const newRounds = toSimpleRounds(skipResult.items)
        simplePlayer.addRounds(newRounds as any)
        console.debug(`[progressiveLoad] Belt skip: added ${newRounds.length} rounds`)
      }
    }

    // Now jump to the seed
    simplePlayer.jumpToSeed(targetSeed)

    // Update belt progress to match (uses absolute seed number)
    if (beltProgress.value) {
      beltProgress.value.setSeeds(targetSeed)
    }
  } finally {
    isSkippingBelt.value = false
  }
}

/**
 * Load rounds for a target seed if not already loaded.
 * Shared helper for belt skip operations.
 */
const loadSeedIfNeeded = async (targetSeed: number) => {
  const existingRoundIndex = simplePlayer.findRoundIndexForSeed(targetSeed)
  if (existingRoundIndex >= 0) return // Already loaded

  if (!supabase?.value) return

  // Always emit from round 1 to ensure correct round building (including intros)
  console.debug(`[progressiveLoad] Belt skip: target seed ${targetSeed} not loaded, loading now...`)
  const skipResult = await generateSimpleScript(supabase.value, courseCode.value, targetSeed, targetSeed + 5, 1)

  if (skipResult.items.length > 0) {
    const newRounds = toSimpleRounds(skipResult.items)
    simplePlayer.addRounds(newRounds as any)
    console.debug(`[progressiveLoad] Belt skip: added ${newRounds.length} rounds`)
  }
}

/**
 * Jump back to start of current or previous belt
 * If close to current belt start, goes to previous belt
 */
const handleGoBackBelt = async () => {
  // Get current playing position's seed (not stored progress)
  const currentRound = simplePlayer.currentRound.value
  const currentSeedId = currentRound?.seedId || 'S0001'
  const currentSeedNumber = parseInt(currentSeedId.substring(1, 5), 10) || 1

  // Calculate current belt based on CURRENT playing position
  const BELT_THRESHOLDS = [0, 8, 20, 40, 80, 150, 280, 400]
  const BELT_NAMES = ['White', 'Yellow', 'Orange', 'Green', 'Blue', 'Purple', 'Brown', 'Black']

  let currentBeltIndex = 0
  for (let i = BELT_THRESHOLDS.length - 1; i >= 0; i--) {
    if (currentSeedNumber >= BELT_THRESHOLDS[i]) {
      currentBeltIndex = i
      break
    }
  }

  // Calculate target: start of current belt, or previous belt if near the start
  const currentBeltStart = BELT_THRESHOLDS[currentBeltIndex] === 0 ? 1 : BELT_THRESHOLDS[currentBeltIndex]
  const prevBeltIndex = currentBeltIndex > 0 ? currentBeltIndex - 1 : 0
  const prevBeltStart = BELT_THRESHOLDS[prevBeltIndex] === 0 ? 1 : BELT_THRESHOLDS[prevBeltIndex]

  // If we're more than 2 seeds into current belt, go to its start
  // Otherwise, go to previous belt's start
  const targetSeed = (currentSeedNumber > currentBeltStart + 2 && currentBeltIndex > 0)
    ? currentBeltStart
    : prevBeltStart

  console.log('[LearningPlayer] handleGoBackBelt called', {
    currentSeedId,
    currentSeedNumber,
    currentBeltName: BELT_NAMES[currentBeltIndex],
    targetSeed,
    targetBeltName: BELT_NAMES[targetSeed >= currentBeltStart ? currentBeltIndex : prevBeltIndex],
    isPlaying: simplePlayer.isPlaying.value,
  })

  isSkippingBelt.value = true

  try {
    console.log(`[LearningPlayer] Going back to seed ${targetSeed}`)

    // Reset the brain network for fresh start at new belt
    if (networkState?.revealedNodeIds) {
      networkState.revealedNodeIds.value = new Set<string>()
      console.log('[LearningPlayer] Reset brain network for belt skip')
    }

    // Handle edge case: seed 0 (white belt) means go to round 0
    if (targetSeed === 0) {
      simplePlayer.jumpToRound(0)
    } else {
      await loadSeedIfNeeded(targetSeed)
      simplePlayer.jumpToSeed(targetSeed)
    }

    // Update belt progress to match
    if (beltProgress.value) {
      beltProgress.value.setSeeds(targetSeed)
    }

    console.log(`[LearningPlayer] handleGoBackBelt: complete, now at seed ${targetSeed}`)
  } finally {
    isSkippingBelt.value = false
  }
}

/**
 * Jump to a specific belt from the modal
 * Handles both forward and backward jumps
 */
const handleSkipToBeltFromModal = async (belt) => {
  if (!belt || !beltProgress.value) {
    console.log('[LearningPlayer] Cannot skip - invalid belt or no belt progress')
    return
  }

  const targetSeed = belt.seedsRequired
  console.log(`[LearningPlayer] Skipping to ${belt.name} belt (seed ${targetSeed}) from modal`)

  // Close modal first for better UX
  closeBeltProgressModal()

  isSkippingBelt.value = true
  try {
    // Reset the brain network for fresh start at new belt
    if (networkState?.revealedNodeIds) {
      networkState.revealedNodeIds.value = new Set<string>()
      console.log('[LearningPlayer] Reset brain network for modal belt skip')
    }

    // Handle edge case: seed 0 (white belt) means go to round 0
    if (targetSeed === 0) {
      simplePlayer.jumpToRound(0)
    } else {
      await loadSeedIfNeeded(targetSeed)
      simplePlayer.jumpToSeed(targetSeed)
    }

    // Update belt progress to match
    if (beltProgress.value) {
      beltProgress.value.setSeeds(targetSeed)
    }
  } finally {
    isSkippingBelt.value = false
  }
}

// Mode toggles
const turboActive = ref(false)
const turboPopupShownThisSession = ref(false)
const showListeningOverlay = ref(false) // Show listening mode overlay
const isDrivingModeActive = ref(false)
let drivingModeInitialRound: number | null = null

// Driving mode composable
const drivingMode = useDrivingMode({
  getCyclesForRound: (roundIndex: number) => {
    const rounds = cachedRounds.value
    if (!rounds || roundIndex < 0 || roundIndex >= rounds.length) return []
    return simpleRoundToTypedCycles(rounds[roundIndex].cycles)
  },
  getTotalRounds: () => cachedRounds.value?.length ?? 0,
  getAudioSource: getAudioSourceForSession,
  onRoundChange: (newRoundIndex: number) => {
    if (drivingModeInitialRound === null) {
      drivingModeInitialRound = newRoundIndex
      return // first call = initial round, nothing completed yet
    }
    // Previous round just completed — save progress
    const completedIdx = newRoundIndex - 1
    if (completedIdx >= 0 && cachedRounds.value && completedIdx < cachedRounds.value.length) {
      const round = cachedRounds.value[completedIdx]
      if (round?.legoId && beltProgress.value?.setCurrentLegoId) {
        beltProgress.value.setCurrentLegoId(round.legoId)
      }
    }
  },
  onSessionComplete: () => {
    isDrivingModeActive.value = false
    drivingModeInitialRound = null
  },
})

// Driving mode text tracking
const drivingModeKnownText = computed(() => {
  const seg = drivingMode.currentSegment.value
  if (!seg || !cachedRounds.value) return ''
  const round = cachedRounds.value[drivingMode.currentRoundIndex.value]
  const cycle = round?.cycles?.[seg.cycleIndex]
  return cycle?.known?.text ?? ''
})

const drivingModeTargetText = computed(() => {
  const seg = drivingMode.currentSegment.value
  if (!seg || !cachedRounds.value) return ''
  const round = cachedRounds.value[drivingMode.currentRoundIndex.value]
  const cycle = round?.cycles?.[seg.cycleIndex]
  return cycle?.target?.text ?? ''
})

const drivingModeShowTarget = computed(() => {
  return drivingMode.currentSegment.value?.phase === 'voice2'
})

const drivingModeCycleCount = computed(() => {
  if (!cachedRounds.value) return 0
  const round = cachedRounds.value[drivingMode.currentRoundIndex.value]
  return round?.cycles?.length ?? 0
})

// Mode explanation popups
const showTurboPopup = ref(false)

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

  // Wait for rounds to load if not yet available (first play may race with initialization)
  if (loadedRounds.value.length === 0) {
    console.log('[LearningPlayer] Waiting for rounds to load after consent...')
    startPreparingState()
    await new Promise<void>((resolve) => {
      const unwatch = watch(
        () => loadedRounds.value.length > 0,
        (hasRounds) => {
          if (hasRounds) {
            unwatch()
            resolve()
          }
        },
        { immediate: true }
      )
    })
    isPreparingToPlay.value = false
  }

  // Play welcome audio on first play if needed
  await playWelcomeIfNeeded()

  // Let the learner tap to start — don't auto-play after consent
  isPlaying.value = false
}

// Preload first round audio during consent overlay (first visit only).
// When the consent overlay is showing AND rounds are available, fire-and-forget preload
// so that audio is cached by the time the user finishes consent + welcome.
watch(
  [showAdaptationPrompt, loadedRounds],
  ([showingConsent, rounds]) => {
    if (showingConsent && rounds && rounds.length > 0) {
      preloadSimpleRoundAudio(rounds, 2)
    }
  }
)

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

// Open listening mode overlay
const handleListeningMode = () => {
  // Stop main player using the proper pause method (handles all audio/animation states)
  handlePause()

  // CRITICAL: Also abort any playing intro/welcome audio (these use separate audio elements)
  if (isPlayingIntroduction.value) {
    skipIntroduction()
    console.log('[LearningPlayer] Listening mode: Intro aborted')
  }
  if (isPlayingWelcome.value) {
    skipWelcome()
    console.log('[LearningPlayer] Listening mode: Welcome aborted')
  }

  showListeningOverlay.value = true
  emit('listeningModeChanged', true)
}

// Close listening overlay and resume main player
const handleCloseListening = () => {
  showListeningOverlay.value = false
  emit('listeningModeChanged', false)
  // Don't auto-resume - user will tap to play when ready
}

// Exit listening mode completely - close overlay AND stop all audio
// Called when user navigates away via bottom nav
const exitListeningMode = () => {
  if (showListeningOverlay.value) {
    showListeningOverlay.value = false
    emit('listeningModeChanged', false)
  }
  // Stop all audio immediately
  handlePause()
}

// ============================================
// DRIVING MODE
// ============================================

// Mode picker popover
const showModePicker = ref(false)
const showListeningExplainer = ref(false)
const showDrivingExplainer = ref(false)
const listeningExplainerShownThisSession = ref(false)
const drivingExplainerShownThisSession = ref(false)

const handleModeButtonClick = () => {
  if (isDrivingModeActive.value) {
    handleExitDrivingMode()
    return
  }
  if (showListeningOverlay.value) {
    handleCloseListening()
    return
  }
  showModePicker.value = true
}

const handlePickListening = () => {
  showModePicker.value = false
  if (listeningExplainerShownThisSession.value) {
    handleListeningMode()
  } else {
    showListeningExplainer.value = true
  }
}

const confirmListeningMode = () => {
  showListeningExplainer.value = false
  listeningExplainerShownThisSession.value = true
  handleListeningMode()
}

const cancelListeningExplainer = () => {
  showListeningExplainer.value = false
  listeningExplainerShownThisSession.value = true
}

const handlePickDriving = () => {
  showModePicker.value = false
  if (drivingExplainerShownThisSession.value) {
    handleEnterDrivingMode()
  } else {
    showDrivingExplainer.value = true
  }
}

const confirmDrivingMode = () => {
  showDrivingExplainer.value = false
  drivingExplainerShownThisSession.value = true
  handleEnterDrivingMode()
}

const cancelDrivingExplainer = () => {
  showDrivingExplainer.value = false
  drivingExplainerShownThisSession.value = true
}

const handleEnterDrivingMode = async () => {
  handlePause() // stop SimplePlayer
  if (isPlayingIntroduction.value) skipIntroduction()
  if (isPlayingWelcome.value) skipWelcome()

  isDrivingModeActive.value = true
  drivingModeInitialRound = null

  try {
    await drivingMode.enter(simplePlayer.roundIndex.value)
  } catch (err) {
    console.error('[LearningPlayer] Failed to enter driving mode:', err)
    isDrivingModeActive.value = false
  }
}

const handleExitDrivingMode = () => {
  const position = drivingMode.exit()
  isDrivingModeActive.value = false
  drivingModeInitialRound = null

  if (position && position.roundIndex >= 0) {
    simplePlayer.jumpToRound(position.roundIndex)
  }
  // Don't auto-resume — user taps play when ready
}

// Exit all overlays — called when navigating away via bottom nav
const exitAllModes = () => {
  if (isDrivingModeActive.value) {
    drivingMode.exit()
    isDrivingModeActive.value = false
    drivingModeInitialRound = null
  }
  if (showListeningOverlay.value) {
    showListeningOverlay.value = false
    emit('listeningModeChanged', false)
  }
  handlePause()
}

// Show turbo explanation popup (first time in session) or toggle directly
const handleTurboClick = () => {
  if (turboActive.value) {
    // Already on - just toggle off
    toggleTurbo()
  } else if (turboPopupShownThisSession.value) {
    // Popup already shown this session - just toggle on directly
    toggleTurbo()
  } else {
    // First time this session - show explanation popup
    showTurboPopup.value = true
  }
}

// Confirm and enable turbo mode
const confirmTurbo = () => {
  showTurboPopup.value = false
  turboPopupShownThisSession.value = true  // Don't show popup again this session
  turboActive.value = true
  applyTurboConfig()
}

// Close turbo popup without enabling
const closeTurboPopup = () => {
  showTurboPopup.value = false
  turboPopupShownThisSession.value = true  // They've seen it, don't show again
}

// Apply turbo config to orchestrator
const applyTurboConfig = () => {
  {
    const config = turboActive.value ? turboConfig.value : normalConfig.value
    const item = currentItem.value
    const targetDurationMs = item?.audioDurations
      ? Math.round(item.audioDurations.target1 * 1000)
      : 2000 // Fallback

    // Calculate pause using the config formula
    const pauseMs = calculatePause(config, targetDurationMs)
    console.log(`[Turbo] ${turboActive.value ? 'ON' : 'OFF'} - pause: ${pauseMs}ms`)
  }
}

const toggleTurbo = () => {
  turboActive.value = !turboActive.value
  applyTurboConfig()
}

// ============================================
// PAUSE/RESUME HANDLERS
// ============================================

const showPausedSummary = () => {
  // Stop playback and show summary
  {
    stopCycle()
  }
  isPlaying.value = false
  showSessionComplete.value = true

  // End belt progress session (saves session history for time estimates)
  if (beltProgress.value) {
    beltProgress.value.endSession(beltProgress.value.currentSeedNumber.value ?? 0, phrasesSpokenCount.value)
  }

  // Increment session count for guests (triggers signup prompt)
  if (auth && itemsPracticed.value > 0) {
    auth.incrementSessionCount()
  }
}

// Belt Progress Modal handlers
const openBeltProgressModal = () => {
  showBeltProgressModal.value = true
}

const closeBeltProgressModal = () => {
  showBeltProgressModal.value = false
}

const handleViewFullProgress = () => {
  closeBeltProgressModal()
  // Lazily initialize network if not yet done (e.g. user opens Progress before first play)
  ensureNetworkInitialized()
  // Populate network up to current position
  if (currentRoundIndex.value > 0) {
    populateNetworkUpToRound(currentRoundIndex.value)
  } else if (cachedRounds.value.length > 0) {
    populateNetworkUpToRound(0)
  }
  // Lazily load full network data before navigating to Brain View
  ensureNetworkLoaded()
  // Emit to parent to navigate to Brain View / Progress screen
  emit('viewProgress')
}

/**
 * Lazily load network data from database (deferred from init to avoid blocking startup)
 */
const ensureNetworkLoaded = () => {
  if (isFullNetworkLoaded.value || !supabase?.value) return

  loadLegoNetworkData(courseCode.value).then(networkData => {
    if (networkData?.connections) {
      networkConnections.value = networkData.connections
      console.log(`[LearningPlayer] Loaded ${networkData.connections.length} network connections`)
    }
    if (networkData?.nodes) {
      const nodes = networkData.nodes.map(n => ({
        id: n.id,
        targetText: n.targetText,
        knownText: n.knownText,
        seedId: n.seedId,
        legoIndex: n.legoIndex,
        belt: n.birthBelt,
        isComponent: n.isComponent,
        parentLegoIds: n.parentLegoIds,
      }))
      dbNetworkNodes.value = nodes

      const sortedNodes = [...nodes].sort((a, b) => (a.legoIndex || 0) - (b.legoIndex || 0))
      const syntheticRounds = sortedNodes.map(node => ({
        legoId: node.id,
        targetText: node.targetText,
        knownText: node.knownText,
      }))

      const revealUpTo = getRevealUpTo(syntheticRounds)
      initializeFullNetwork(syntheticRounds, networkConnections.value, revealUpTo, nodes)
      console.log(`[LearningPlayer] Full network initialized: ${syntheticRounds.length} nodes, revealed up to ${revealUpTo}`)
    }
  }).catch(err => {
    console.warn('[LearningPlayer] Failed to load network connections:', err)
  })
}

const handleResumeLearning = async () => {
  // Hide summary and continue the infinite stream
  showSessionComplete.value = false
  isPlaying.value = true

  // Start new belt progress session for time tracking
  if (beltProgress.value) {
    beltProgress.value.startSession(beltProgress.value.currentSeedNumber.value ?? 0)
  }

  if (currentItem.value) {
    // Check for introduction before starting
    await playIntroductionIfNeeded(currentItem.value)
    if (isPlaying.value) {
      await startCyclePlayback(currentItem.value)
    }
  }
}

const handleExit = () => {
  // Stop playback and exit the player
  {
    stopCycle()
  }
  isPlaying.value = false

  // End belt progress session (saves session history)
  if (beltProgress.value) {
    beltProgress.value.endSession(beltProgress.value.currentSeedNumber.value ?? 0, phrasesSpokenCount.value)
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

// Lazily initialize the network on first play or when Progress screen is opened
const ensureNetworkInitialized = () => {
  if (networkInitialized.value) return
  networkInitialized.value = true
  initializeNetwork()
}

// Add a new LEGO node to the network - no longer hero-centered, just adds to network
const addNetworkNode = (legoId, targetText, knownText, beltColor = 'white') => {
  // Use the composable to add the node (makeHero=false for organic growth)
  const added = introduceLegoNode(legoId, targetText, knownText, false)

  if (added) {
    console.log(`[LearningPlayer] Added network node: ${legoId} (${targetText})`)
  }
}

/**
 * Build LEGO map from cached rounds (not from network nodes)
 * Used for phrase decomposition when network might be empty
 */
const buildLegoMapFromRounds = (): Map<string, { id: string; target: string; known: string }> => {
  const legoMap = new Map<string, { id: string; target: string; known: string }>()

  cachedRounds.value.forEach(round => {
    if (round.legoId && round.targetText) {
      const normalizedTarget = round.targetText.toLowerCase().trim()
      legoMap.set(normalizedTarget, {
        id: round.legoId,
        target: round.targetText,
        known: round.knownText || round.items?.[0]?.knownText || ''
      })
    }
  })

  return legoMap
}

/**
 * Extract LEGO IDs from phrase text using cached rounds as source
 * (doesn't rely on network nodes being populated)
 */
const extractLegoIdsFromText = (text: string, legoMap: Map<string, { id: string; target: string; known: string }>): string[] => {
  if (!text) return []

  const normalized = text.toLowerCase().trim()
  const words = normalized.split(/\s+/)
  const result: string[] = []
  let i = 0

  while (i < words.length) {
    let longestMatch: string | null = null
    let longestLength = 0

    // Try longest phrases first (up to 5 words)
    for (let len = Math.min(words.length - i, 5); len > 0; len--) {
      const candidate = words.slice(i, i + len).join(' ')
      const legoData = legoMap.get(candidate)
      if (legoData) {
        longestMatch = legoData.id
        longestLength = len
        break
      }
    }

    if (longestMatch) {
      if (!result.includes(longestMatch)) {
        result.push(longestMatch)
      }
      i += longestLength
    } else {
      i++ // Skip unmatched word
    }
  }

  return result
}

/**
 * Load minimal constellation for the current round
 * Shows only the hero LEGO and the LEGOs used in its practice phrases
 * Much lighter than the full network - perfect for focused learning
 */
const loadConstellationForRound = (roundIndex: number) => {
  if (!cachedRounds.value.length) return
  if (roundIndex < 0 || roundIndex >= cachedRounds.value.length) return

  const round = cachedRounds.value[roundIndex]
  if (!round) return

  const heroId = round.legoId
  if (!heroId) return

  // Get hero data
  const heroTarget = round.targetText || round.items?.[0]?.targetText || heroId
  const heroKnown = round.knownText || round.items?.[0]?.knownText || ''
  const heroBelt = currentBelt.value?.name || 'white'

  // Build LEGO map from cached rounds (not from network which might be empty)
  const legoMap = buildLegoMapFromRounds()
  console.log(`[LearningPlayer] Built LEGO map from rounds: ${legoMap.size} LEGOs`)

  // Extract all LEGOs from this round's practice phrases
  const phraseLegoIds: string[] = []
  const legoDataMap = new Map<string, { target: string; known: string }>()

  // Add hero to map
  legoDataMap.set(heroId, { target: heroTarget, known: heroKnown })

  // Process each item in the round to find LEGOs in phrases
  round.items?.forEach(item => {
    const phraseText = item?.phrase?.phrase?.target || item?.targetText || ''
    if (phraseText) {
      // Extract LEGOs from this phrase using cached rounds
      const itemLegoIds = extractLegoIdsFromText(phraseText, legoMap)
      itemLegoIds.forEach(id => {
        if (!phraseLegoIds.includes(id)) {
          phraseLegoIds.push(id)
        }
        // Store data for this LEGO
        if (!legoDataMap.has(id)) {
          const legoData = Array.from(legoMap.values()).find(l => l.id === id)
          if (legoData) {
            legoDataMap.set(id, { target: legoData.target, known: legoData.known })
          } else {
            legoDataMap.set(id, { target: id, known: '' })
          }
        }
      })
    }
  })

  console.log(`[LearningPlayer] Loading minimal constellation for ${heroId}: ${phraseLegoIds.length} phrase LEGOs`, phraseLegoIds)

  // Load the minimal constellation
  loadMinimalConstellation(
    heroId,
    { target: heroTarget, known: heroKnown, belt: heroBelt },
    phraseLegoIds,
    legoDataMap
  )
}

// Reveal network nodes up to a given round
// If full network is loaded, just reveal nodes (no recalculation)
// Otherwise fall back to minimal constellation for the current round
const populateNetworkUpToRound = (targetRoundIndex: number) => {
  if (isFullNetworkLoaded.value) {
    revealNodesUpToIndex(targetRoundIndex)
    return
  }
  loadConstellationForRound(targetRoundIndex)
}

// ============================================
// PROGRESSIVE SCRIPT EXPANSION
// Now handled by PriorityRoundLoader in the background
// This function is kept as a no-op stub for backwards compatibility
// ============================================
const expandScript = async () => {
  // PriorityRoundLoader handles script expansion automatically in the background
  // This function is a no-op stub - the background loader should have already
  // loaded rounds before they're needed
  console.log('[LearningPlayer] expandScript called - handled by PriorityRoundLoader')
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
  console.debug('[Network] Node tapped:', node.id, node.targetText)

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
  dbNetworkNodes.value.forEach(node => {
    if (node.targetText) {
      legoMap.set(node.targetText.toLowerCase().trim(), node.id)
    }
  })


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
    if (legoId && dbNetworkNodes.value.find(n => n.id === legoId)) {
      result.push(legoId)
    }
  }

  return result
}

// Find M-LEGOs that have partial word overlap with the phrase (resonance effect)
// These are LEGOs where some (but not all) words appear in the phrase
const findResonatingNodes = (item, exactMatches) => {
  const targetText = item?.phrase?.phrase?.target || item?.targetText || ''
  if (!targetText) return []

  const targetWords = targetText.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const resonating = []

  dbNetworkNodes.value.forEach(node => {
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
// NETWORK REVEAL HELPER
// ============================================

/**
 * Calculate how many nodes to reveal based on highestLegoId (LEGO-granular high-water mark).
 * Falls back to belt-granular completedRounds if highestLegoId not available.
 */
const getRevealUpTo = (rounds: Array<{ legoId: string }>): number => {
  const highestLego = beltProgress.value?.highestLegoId?.value
  if (highestLego && rounds.length > 0) {
    const idx = rounds.findIndex(r => r.legoId === highestLego)
    if (idx >= 0) return Math.max(idx, currentRoundIndex.value)
    // If exact match not found, find last node that sorts before highestLego
    const lastBefore = rounds.reduce((best, r, i) => r.legoId <= highestLego ? i : best, -1)
    if (lastBefore >= 0) return Math.max(lastBefore, currentRoundIndex.value)
  }
  // Fallback: belt-granular
  return Math.max(completedRounds.value, currentRoundIndex.value)
}

// ============================================
// LIFECYCLE
// ============================================

// Event handler references for cleanup
let settingChangedHandler: ((e: Event) => void) | null = null
let jumpToSeedHandler: ((e: Event) => void) | null = null

onMounted(async () => {
  // ============================================
  // AWAKENING SEQUENCE - Parallel loading with cinematic timing
  // Data loads in background while animation plays
  // Ready = BOTH data loaded AND animation enjoyed
  // ============================================

  const startTime = Date.now()
  const isReturnUser = adaptationConsent.value !== null
  const MINIMUM_ANIMATION_MS = isReturnUser ? 300 : 2800

  // Stage 1: Awakening (immediate)
  setLoadingStage('awakening')

  // Initialize sync stuff immediately (no await needed)
  loadAdaptationConsent()

  // Load developer settings
  showFragileProgressWarning.value = localStorage.getItem('ssi-show-fragile-warning') !== 'false'
  enableQaMode.value = localStorage.getItem('ssi-enable-qa-mode') === 'true'
  showDebugOverlay.value = localStorage.getItem('ssi-show-debug-overlay') === 'true'
  enableVerboseLogging.value = localStorage.getItem('ssi-verbose-logging') === 'true'

  // Listen for developer settings changes (from Settings screen)
  settingChangedHandler = (e: Event) => {
    const detail = (e as CustomEvent).detail
    if (!detail?.key) return
    
    switch (detail.key) {
      case 'showFragileProgressWarning':
        showFragileProgressWarning.value = detail.value
        break
      case 'enableQaMode':
        enableQaMode.value = detail.value
        break
      case 'showDebugOverlay':
        showDebugOverlay.value = detail.value
        break
      case 'enableVerboseLogging':
        enableVerboseLogging.value = detail.value
        break
    }
  }
  window.addEventListener('ssi-setting-changed', settingChangedHandler)

  // Listen for external jump-to-seed events (from DevRoleSwitcher, CourseBrowser)
  jumpToSeedHandler = async (e: Event) => {
    const seedNumber = (e as CustomEvent).detail?.seedNumber
    if (typeof seedNumber !== 'number' || seedNumber < 1) return
    console.log('[LearningPlayer] Jump to seed requested:', seedNumber)
    try {
      await loadSeedIfNeeded(seedNumber)
      simplePlayer.jumpToSeed(seedNumber)
      // Update belt progress to match the jumped position
      const legoId = `S${String(seedNumber).padStart(4, '0')}L01`
      beltProgress.value?.setLastLegoId(legoId)
    } catch (err) {
      console.warn('[LearningPlayer] Jump to seed failed:', err)
    }
  }
  window.addEventListener('ssi-jump-to-seed', jumpToSeedHandler)

  audioController.value = new RealAudioController()
  currentCourseCode.value = courseCode.value

  // Initialize audio caching layer (IndexedDB-based)
  // AudioSource provides cache-first URL resolution for offline support
  if (courseCode.value) {
    const audioSource = initAudioSource(courseCode.value)
    audioController.value.setAudioSource(audioSource)
    console.log('[LearningPlayer] Audio cache layer initialized for course:', courseCode.value)
  }

  // Initialize belt progress (loads from localStorage, merges with Supabase)
  await initializeBeltProgress()

  // Initialize offline play composable (sets up online/offline listeners)
  offlinePlayCleanup = initializeOfflinePlay()

  // Network initialization deferred to first play or Progress screen open

  // Track data loading state
  let dataReady = false
  let cachedScript = null


  // ============================================
  // PARALLEL TASK 1: Load all data
  // ============================================
  const loadAllData = async () => {
    try {
      // Load algorithm configs (Turbo Boost settings, etc.) - non-blocking
      loadAlgorithmConfigs().catch(err => {
        console.warn('[LearningPlayer] Failed to load algorithm configs, using defaults:', err)
      })

      // ============================================
      // SessionController initialization path
      // ============================================
      // Wait for courseDataProvider to be set (App.vue sets it in onMounted, which runs after children mount)
      if (!courseDataProvider.value) {
        console.log('[LearningPlayer] Waiting for courseDataProvider...')
        await new Promise<void>((resolve) => {
          const unwatch = watch(
            () => courseDataProvider.value,
            (provider) => {
              if (provider) {
                unwatch()
                resolve()
              }
            },
            { immediate: true }
          )
          // Timeout after 5 seconds to avoid hanging forever
          setTimeout(() => {
            unwatch()
            resolve()
          }, 5000)
        })
        console.log('[LearningPlayer] courseDataProvider ready:', !!courseDataProvider.value)
      }

      if (courseDataProvider.value) {
        console.log('[LearningPlayer] Initializing SimplePlayer...')
        try {
          // ============================================
          // EAGER LOADING: Await preloaded full script from App.vue
          // The script was fired as soon as the course was known (~300ms)
          // By now it's likely already resolved
          // ============================================
          if (supabase?.value) {
            // Determine starting position from saved progress
            let startingSeed: number
            let isReturningUser: boolean
            const classLastLegoId = props.classContext?.last_lego_id

            if (classLastLegoId) {
              // Class mode: derive seed from class's last LEGO position
              const seedMatch = classLastLegoId.match(/^S(\d{4})L/)
              startingSeed = seedMatch ? parseInt(seedMatch[1], 10) : 0
              isReturningUser = startingSeed > 0
            } else {
              const completedSeeds = beltProgress.value?.completedRounds.value ?? 0
              const currentSeedFromLegoId = beltProgress.value?.currentSeedNumber.value ?? 0
              startingSeed = currentSeedFromLegoId > 0 ? currentSeedFromLegoId : (completedSeeds > 0 ? completedSeeds : 0)
              isReturningUser = startingSeed > 0
            }

            // Await eager script (preloaded from App.vue) or fall back to direct call
            let result
            if (eagerScript?.scriptPromise?.value && eagerScript.courseCode.value === courseCode.value) {
              console.log('[LearningPlayer] Awaiting eager script preload...')
              result = await eagerScript.scriptPromise.value
              console.log(`[LearningPlayer] Eager script ready: ${result.items.length} items, ${result.roundCount} rounds`)
            } else {
              console.log('[LearningPlayer] No eager preload available, loading directly...')
              result = await generateSimpleScript(supabase.value, courseCode.value, 1, 668, 1)
              console.log(`[LearningPlayer] Direct load: ${result.items.length} items, ${result.roundCount} rounds`)
            }

            if (result.items.length > 0) {
              const simpleRounds = toSimpleRounds(result.items)
              console.debug(`[eagerLoad] ${simpleRounds.length} SimplePlayer rounds built`)

              simplePlayer.initialize(simpleRounds as any)

              // Restore position for returning users
              if (isReturningUser) {
                if (classLastLegoId) {
                  // Class mode: find the round AFTER the last completed LEGO
                  const lastIdx = simpleRounds.findIndex(r => r.legoId === classLastLegoId)
                  if (lastIdx >= 0 && lastIdx + 1 < simpleRounds.length) {
                    console.debug(`[eagerLoad] Class mode: resuming after ${classLastLegoId} (round ${lastIdx + 1})`)
                    simplePlayer.jumpToRound(lastIdx + 1)
                  } else if (lastIdx >= 0) {
                    // Last LEGO was the final round — stay there
                    simplePlayer.jumpToRound(lastIdx)
                  }
                } else {
                  const nextSeed = startingSeed + 1
                  const roundIndex = simplePlayer.findRoundIndexForSeed(nextSeed)
                  if (roundIndex >= 0) {
                    console.debug(`[eagerLoad] Restoring: seed ${startingSeed} → starting at seed ${nextSeed} (round ${roundIndex})`)
                    simplePlayer.jumpToRound(roundIndex)
                  }
                }
              }

              // Store for legacy code
              loadedRounds.value = simpleRounds as any

              // Populate network with all loaded rounds
              const currentRoundIdx = simplePlayer.roundIndex.value ?? 0
              const networkRounds = simpleRounds.map(r => ({
                legoId: r.legoId,
                targetText: r.cycles[0]?.target?.text,
                knownText: r.cycles[0]?.known?.text,
              }))
              populateNetworkFromRounds(networkRounds, currentRoundIdx)

              // Preload audio for the first 2 rounds immediately
              preloadSimpleRoundAudio(simpleRounds, 2, currentRoundIdx)

            } else {
              console.warn('[eagerLoad] No script items generated')
            }
          }
          console.log('[LearningPlayer] SimplePlayer initialized successfully')

          // Start class session tracking if in class mode
          if (props.classContext) {
            startClassSessionTracking()
          }

          // Network data is loaded lazily when the user navigates to the Progress screen
          // This avoids blocking startup for courses with many LEGOs (1000+)

          // Mark data as ready
          dataReady = true
          return
        } catch (err) {
          console.error('[LearningPlayer] SessionController initialization failed, falling back to legacy:', err)
          // Fall through to legacy path
        }
      }

      // ============================================
      // Legacy initialization path
      // ============================================

      // Load cache first (needed for other operations)
      cachedScript = await getCachedScript(courseCode.value)

      if (cachedScript) {
        console.log('[LearningPlayer] Found cached script with', cachedScript.rounds.length, 'rounds')
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


        // Task: Load saved progress (localStorage first, then database for logged-in users)
        parallelTasks.push(
          (async () => {
            let resumed = false

            // 1. Try localStorage first (works for all users, fast, offline-ready)
            // Position is stored as absolute LEGO ID + seed number
            const localPosition = loadPositionFromLocalStorage()
            if (localPosition?.legoId) {
              // Find the round with this LEGO ID
              const resumeRoundIndex = cachedScript.rounds.findIndex(r => r.legoId === localPosition.legoId)

              if (resumeRoundIndex >= 0) {
                currentRoundIndex.value = resumeRoundIndex
                currentItemInRound.value = localPosition.itemInRound ?? 0
                // Clamp item index to valid range
                const maxItem = cachedScript.rounds[resumeRoundIndex]?.items?.length ?? 1
                if (currentItemInRound.value >= maxItem) {
                  currentItemInRound.value = 0
                }

                // Also set currentPlayableItem so splash screen shows correct text
                const resumeScriptItem = cachedScript.rounds[resumeRoundIndex]?.items?.[currentItemInRound.value]
                if (resumeScriptItem) {
                  const playable = await scriptItemToPlayableItem(resumeScriptItem)
                  if (playable) {
                    currentPlayableItem.value = playable
                  }
                }

                console.log('[LearningPlayer] Resumed at LEGO', localPosition.legoId, '→ round', resumeRoundIndex, 'item', currentItemInRound.value)
                resumed = true
              } else {
                console.log('[LearningPlayer] Saved LEGO', localPosition.legoId, 'not in cached rounds, will regenerate')
                // The cached script might be from a different position - we need to regenerate
                // Clear the cache and fall through to regeneration
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

            // 3. If no resume position, start from beginning (round 0 = current belt level)
            // This is the absolute fallback - player must ALWAYS have somewhere to go
            if (!resumed && cachedScript.rounds.length > 0) {
              // Explicitly set indices to beginning
              currentRoundIndex.value = 0
              currentItemInRound.value = 0

              const firstItem = cachedScript.rounds[0]?.items?.[0]
              if (firstItem) {
                const playable = await scriptItemToPlayableItem(firstItem)
                if (playable) {
                  currentPlayableItem.value = playable
                  console.log('[LearningPlayer] Fresh start: round 0 (belt level:', beltProgress.value?.completedRounds.value ?? 0, 'seeds)')
                }
              }
            }

            // Safety check: if we still have no playable item but have rounds, force set one
            if (!currentPlayableItem.value && cachedScript.rounds.length > 0) {
              console.warn('[LearningPlayer] Safety fallback: forcing position to round 0')
              currentRoundIndex.value = 0
              currentItemInRound.value = 0
              const firstItem = cachedScript.rounds[0]?.items?.[0]
              if (firstItem) {
                const playable = await scriptItemToPlayableItem(firstItem)
                if (playable) {
                  currentPlayableItem.value = playable
                }
              }
            }

            // If we have NO rounds at all, something went wrong - log error
            if (cachedScript.rounds.length === 0) {
              console.error('[LearningPlayer] CRITICAL: No rounds generated - cannot start player')
            }

            // Mark position as initialized (enables saving on future changes)
            positionInitialized.value = true
          })()
        )

        // Task: Initialize VAD if previously consented
        if (adaptationConsent.value === true) {
          parallelTasks.push(initializeVad().catch(() => {}))
        }

        // Wait for all parallel tasks
        await Promise.all(parallelTasks)

        // Block on intro audio AFTER parallel tasks — must be ready before first playback
        if (supabase?.value) {
          const legoIds = new Set(
            cachedRounds.value.map(r => r.legoId).filter(Boolean)
          )
          if (legoIds.size > 0) {
            await loadIntroAudio(supabase.value, courseCode.value, legoIds, audioMap.value)
          }
        }
      } else if (courseDataProvider.value) {
        // ============================================
        // GENERATE NEW SCRIPT (cache was empty)
        // ============================================
        console.log('[LearningPlayer] No cached script, generating new one...')

        // Network data is loaded lazily via ensureNetworkLoaded() when Progress screen is opened

        try {
          // Check for saved position FIRST to determine script generation offset
          // This ensures we generate the script from the right starting point
          const savedPosition = loadPositionFromLocalStorage()

          // Use saved seed position if available, otherwise use current belt progress
          const startOffset = savedPosition?.seedNumber ?? beltProgress.value?.completedRounds.value ?? 0
          scriptBaseOffset.value = startOffset // Track for expansion calculations
          console.log('[LearningPlayer] Generating script with offset:', startOffset,
            savedPosition ? `(from saved position, LEGO ${savedPosition.legoId})` : '(from belt progress)')

          // Use real generateLearningScript + toSimpleRounds for legacy fallback
          const endSeed = startOffset + INITIAL_ROUNDS
          const result = await generateSimpleScript(supabase.value, courseCode.value, 1, endSeed, 1)
          const simpleRounds = toSimpleRounds(result.items)

          if (simpleRounds.length > 0) {
            console.log('[LearningPlayer] Legacy fallback: generated', simpleRounds.length, 'rounds')
            cachedRounds.value = simpleRounds as any

            // Restore position
            if (savedPosition?.legoId) {
              const resumeRoundIndex = simpleRounds.findIndex(r => r.legoId === savedPosition.legoId)
              if (resumeRoundIndex >= 0) {
                currentRoundIndex.value = resumeRoundIndex
                currentItemInRound.value = savedPosition.itemInRound ?? 0
                const maxItem = simpleRounds[resumeRoundIndex]?.cycles?.length ?? 1
                if (currentItemInRound.value >= maxItem) {
                  currentItemInRound.value = 0
                }
                console.log('[LearningPlayer] Resumed at LEGO', savedPosition.legoId, '→ round', resumeRoundIndex)
              } else {
                currentRoundIndex.value = 0
                currentItemInRound.value = 0
              }
            } else {
              currentRoundIndex.value = 0
              currentItemInRound.value = 0
            }

            positionInitialized.value = true
          } else {
            console.error('[LearningPlayer] No valid rounds generated! Course cannot play.')
            positionInitialized.value = true
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
    if (isReturnUser) {
      // Return users: skip cinematic timeline, go straight to preparing
      setLoadingStage('preparing')
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, MINIMUM_ANIMATION_MS - elapsed)
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining))
      return
    }

    // First visit: full cinematic timeline
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

  // Preview mode: set position at startup (but defer network population to first play)
  nextTick(async () => {
    if (props.previewLegoIndex > 0) {
      // Preview mode: expand script if needed, then set position
      let targetIndex = props.previewLegoIndex
      const absoluteEnd = scriptBaseOffset.value + cachedRounds.value.length

      // Expand script if preview index exceeds cached rounds
      if (targetIndex >= absoluteEnd && supabase?.value) {
        console.log(`[LearningPlayer] Preview ${targetIndex} exceeds cached ${absoluteEnd}, expanding...`)
        const neededEnd = absoluteEnd + (targetIndex - absoluteEnd) + 10
        const expandResult = await generateSimpleScript(supabase.value, courseCode.value, 1, neededEnd, 1)
        const expandedRounds = toSimpleRounds(expandResult.items)
        if (expandedRounds.length > cachedRounds.value.length) {
          cachedRounds.value = expandedRounds as any
          console.log(`[LearningPlayer] Expanded to ${cachedRounds.value.length} rounds for preview`)
        }
      }

      // Cap to actual available rounds
      targetIndex = Math.min(targetIndex, cachedRounds.value.length - 1)

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
    }
    // Network population deferred to first play via ensureNetworkInitialized()
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

  // No orchestrator initialization needed - using useCyclePlayback composable

  // Start session timer
  sessionTimerInterval = setInterval(() => {
    if (isPlaying.value) sessionSeconds.value++
  }, 1000)

  // Auto-start if prop is true (default), otherwise wait for user to click play
  // The user gesture from tapping the play button carries through for audio
  // IMPORTANT: Only start audio if player is actually visible (prevents autoplay when v-show hidden)
  if (props.autoStart && props.isVisible) {
    // Small delay to ensure orchestrator is ready
    setTimeout(() => {
      handleResume()
    }, 100)
  } else {
    isPlaying.value = false

    // Even without auto-start, play welcome audio if this is a fresh start
    // But only if player is visible - don't play audio when hidden
    if (props.isVisible && currentRoundIndex.value === 0 && !welcomeChecked.value) {
      setTimeout(async () => {
        await playWelcomeIfNeeded()
      }, 100)
    }
  }

  console.log('[LearningPlayer] Total awakening time:', Date.now() - startTime, 'ms')
})

onUnmounted(() => {
  // End class session if active
  if (classSessionId.value) {
    endClassSessionTracking()
  }

  // CRITICAL: Stop any playing intro/welcome audio to prevent zombie audio
  if (isPlayingIntroduction.value) {
    skipIntroduction()
  }
  if (isPlayingWelcome.value) {
    skipWelcome()
  }

  // Stop cycle playback
  stopCycle()
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
  // Cleanup offline play event listeners
  if (offlinePlayCleanup) {
    offlinePlayCleanup()
    offlinePlayCleanup = null
  }
  // Clear belt loader
  if (beltLoader.value) {
    beltLoader.value.clearCache()
  }
  // Cleanup event listeners
  if (settingChangedHandler) {
    window.removeEventListener('ssi-setting-changed', settingChangedHandler)
    settingChangedHandler = null
  }
  if (jumpToSeedHandler) {
    window.removeEventListener('ssi-jump-to-seed', jumpToSeedHandler)
  }

  // Safety cleanup: directly stop any audio elements that might still exist
  // (in case state flags were out of sync)
  if (introAudioElement) {
    try {
      introAudioElement.pause()
      introAudioElement.src = ''
    } catch (e) { /* ignore */ }
    introAudioElement = null
  }
  if (welcomeAudioElement) {
    try {
      welcomeAudioElement.pause()
      welcomeAudioElement.src = ''
    } catch (e) { /* ignore */ }
    welcomeAudioElement = null
  }
})

// ============================================
// VISIBILITY CHANGE DETECTION
// When player becomes visible after being hidden (v-show), trigger deferred auto-start
// This ensures audio only plays when user explicitly navigates to the player screen
// ============================================
let hasTriggeredAutoStart = false // Track if we've already auto-started this session

watch(() => props.isVisible, (isNowVisible, wasVisible) => {
  // Only trigger when transitioning from hidden to visible
  if (isNowVisible && !wasVisible && !hasTriggeredAutoStart) {
    console.log('[LearningPlayer] Player became visible, checking for deferred auto-start')

    // Only auto-start if the prop is enabled and we haven't already started
    if (props.autoStart && !isPlaying.value) {
      hasTriggeredAutoStart = true
      setTimeout(() => {
        handleResume()
      }, 100)
    } else if (!props.autoStart && currentRoundIndex.value === 0 && !welcomeChecked.value) {
      // Play welcome audio if needed (deferred from mount)
      hasTriggeredAutoStart = true
      setTimeout(async () => {
        await playWelcomeIfNeeded()
      }, 100)
    }
  }
})

// ============================================
// COURSE CHANGE DETECTION
// Since we use v-show (not v-if) to preserve state when navigating to BrainView,
// we need to detect course changes and reinitialize everything
// ============================================
let previousCourseCode = ''

watch(courseCode, async (newCourseCode, oldCourseCode) => {
  // Skip if this is the initial mount (no previous course)
  if (!oldCourseCode || !newCourseCode || newCourseCode === oldCourseCode) {
    previousCourseCode = newCourseCode
    return
  }

  console.log(`[LearningPlayer] COURSE CHANGED: ${oldCourseCode} → ${newCourseCode}`)

  // 1. Stop all audio immediately
  handlePause()
  if (isPlayingIntroduction.value) skipIntroduction()
  if (isPlayingWelcome.value) skipWelcome()
  {
    stopCycle()
  }

  // 2. Reset all state
  currentRoundIndex.value = 0
  currentItemInRound.value = 0
  // Legacy items array for deprecated code paths
  allPlayableItems.value = []
  cachedRounds.value = []
  cachedCourseWelcome.value = null
  // completedRounds is computed from beltProgress, which is managed separately
  totalSeedsPlayed.value = 0
  sessionSeconds.value = 0
  welcomeChecked.value = false
  isInitialized.value = false

  // 3. Clear in-memory audio map (each course has different audio)
  audioMap.value.clear()
  currentCourseCode.value = newCourseCode

  // 4. Clear network state
  networkConnections.value = []
  prebuiltNetwork.clear()

  // 5. Reset UI state
  setLoadingStage('awakening')

  // 6. Longer delay to let Vue propagate all reactive changes (courseDataProvider, etc.)
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 300))

  console.log('[LearningPlayer] Reinitializing for new course...')

  // Verify courseDataProvider is for the new course before using it
  const providerCourseId = courseDataProvider.value?.getCourseId?.()
  if (providerCourseId && providerCourseId !== newCourseCode) {
    console.warn(`[LearningPlayer] courseDataProvider mismatch: ${providerCourseId} vs ${newCourseCode}, skipping script generation`)
  }

  // Load cached script for new course
  let cachedScript = await getCachedScript(newCourseCode)

  if (cachedScript) {
    console.log('[LearningPlayer] Found cached script for new course:', cachedScript.rounds.length, 'rounds')
    cachedRounds.value = cachedScript.rounds

    if (cachedScript.courseWelcome) {
      cachedCourseWelcome.value = cachedScript.courseWelcome
    }

    if (cachedScript.audioMapObj) {
      for (const [key, value] of Object.entries(cachedScript.audioMapObj)) {
        audioMap.value.set(key, value)
      }
    }
  }

  // Network data loaded lazily when Progress screen is opened

  // Generate rounds if no cache - prefer eager preload
  if (cachedRounds.value.length === 0 && supabase?.value) {
    let freshResult
    if (eagerScript?.scriptPromise?.value && eagerScript.courseCode.value === newCourseCode) {
      console.log('[LearningPlayer] Awaiting eager preload for course switch:', newCourseCode)
      freshResult = await eagerScript.scriptPromise.value
    } else {
      console.log('[LearningPlayer] No eager preload, generating full script for', newCourseCode)
      freshResult = await generateSimpleScript(supabase.value, newCourseCode, 1, 668, 1)
    }
    const freshRounds = toSimpleRounds(freshResult.items)
    cachedRounds.value = freshRounds as any
  }

  // Initialize for new course - legacy initOrchestrator removed
  // The SessionController path handles this automatically

  // Mark as ready
  setLoadingStage('ready')
  isInitialized.value = true

  previousCourseCode = newCourseCode
  console.log('[LearningPlayer] Course change complete, ready to play')
}, { immediate: false })

// Expose methods for parent component (PlayerContainer) to control playback
const togglePlayback = () => {
  if (isPlaying.value) {
    handlePause()
  } else {
    handleResume()
  }
}

// Safari requires audio.play() within a user gesture to unlock the audio element.
// Call this synchronously from the tap handler BEFORE any setTimeout/async delay.
const unlockAudio = () => {
  if (!audioController.value?.audio) return
  const audio = audioController.value.audio
  // Minimal silent WAV (44 bytes header + 0 samples)
  audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
  audio.play().then(() => {
    audio.pause()
    audio.src = ''
    console.log('[LearningPlayer] Audio element unlocked for Safari')
  }).catch(() => {
    // Not in user gesture context — no-op, Chrome doesn't need this
  })
}

defineExpose({
  isPlaying,
  togglePlayback,
  handlePause,
  handleResume,
  exitListeningMode,
  exitAllModes,
  unlockAudio,
})
</script>

<template>
  <!-- Single root wrapper - required for v-show from parent to work correctly -->
  <div class="learning-player-root">

  <!-- Belt Skip Loading Overlay -->
  <Transition name="fade">
    <div v-if="isSkippingBelt" class="belt-skip-overlay">
      <div class="belt-skip-spinner"></div>
      <span class="belt-skip-label">Jumping to {{ nextBelt?.name || 'next' }} belt...</span>
    </div>
  </Transition>

  <!-- Paused Summary Overlay -->
  <Transition name="session-complete">
    <SessionComplete
      v-if="showSessionComplete"
      :items-practiced="itemsPracticed"
      :time-spent-seconds="sessionSeconds"
      :current-belt="currentBelt"
      :belt-progress="beltProgressPercent"
      :completed-seeds="completedRounds"
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

    <!-- LEGO Assembly Visualization - blocks assemble during phrase playback -->
    <LegoAssembly
      v-if="currentPhraseLegoBlocks.length > 0"
      :blocks="currentPhraseLegoBlocks"
      :phase="currentPhase"
      :belt-color="beltCssVars['--belt-color'] || '#f5f5f5'"
      :belt-glow="beltCssVars['--belt-glow'] || 'rgba(245, 245, 245, 0.3)'"
      :voice1-duration-ms="currentVoice1DurationMs"
    />

    <!-- Text Network Visualization Layer - kept for Brain View / Progress screen -->
    <LegoTextNetwork
      v-if="networkViewProps.nodes.length > 0 && showSessionComplete"
      :nodes="networkViewProps.nodes"
      :edges="networkViewProps.edges"
      :revealed-node-ids="introducedLegoIds"
      :current-path="networkViewProps.currentPath"
      :belt-level="currentBelt.name"
      class="brain-network-container"
      @node-tap="handleNetworkNodeTap"
    />

    <!-- Hero-Centric Text Labels - Floating above/below the hero node -->
    <div class="hero-text-pane" :class="[currentPhase, { 'is-intro': isIntroPhase, 'has-hint': showLearningHint && !isIntroPhase }]">

      <!-- Learning Hint Box - sits ABOVE the main text box -->
      <div v-if="showLearningHint && !isIntroPhase" class="learning-hint-box" :class="{ 'is-speaking': currentPhase === 'speak' }">
        <span class="hint-text">{{ phaseInstruction }}</span>
        <button class="hint-dismiss" @click.stop="dismissLearningHint" title="Hide hints">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
        <!-- Timer bar during speak phase -->
        <div v-if="currentPhase === 'speak'" class="hint-timer">
          <div class="hint-timer-fill" :style="{ width: ringProgress + '%' }"></div>
        </div>
      </div>

      <!-- Main Text Box -->
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

        <!-- NORMAL MODE: Text only (hint is now above) -->
        <template v-else>
          <!-- Text container - fades all text together during transition -->
          <div class="hero-text-container" :class="{ 'is-transitioning': isTransitioningItem }">
            <!-- Known text - always visible, stable position -->
            <div class="hero-text-known">
              <p v-if="isAwakening" class="hero-known loading-text">
                {{ currentLoadingMessage }}<span class="loading-cursor">▌</span>
              </p>
              <p v-else-if="isPreparingToPlay" class="hero-known loading-text preparing-text">
                {{ preparingMessage }}<span class="loading-cursor">▌</span>
              </p>
              <p v-else class="hero-known">
                {{ displayedKnownText }}
              </p>
            </div>

            <!-- Target text removed — duplicated by LEGO tiles below -->
          </div>
        </template>
      </div>

      <!-- Pause countdown bar - only shows after hint box auto-hides -->
      <div v-if="currentPhase === 'speak' && !isIntroPhase && !showLearningHint" class="pause-timer-bar">
        <div class="pause-timer-fill" :style="{ width: ringProgress + '%' }"></div>
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

    <!-- Static Star Field - Deep space backdrop (fades as constellation fills) -->
    <div class="star-field" :style="{ opacity: starFieldOpacity }">
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

    <!-- Drifting Star Particles - Slow motion through space (fades with constellation) -->
    <div class="drift-stars" :style="{ opacity: starFieldOpacity }">
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

    <!-- Landscape Silhouette - Visible only in mist theme -->
    <div class="mountain-silhouette">
      <svg viewBox="0 0 1200 1000" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
        <!-- Distant misty peaks (very faint, high up) -->
        <g opacity="0.12">
          <path d="M0 1000 L0 340 Q80 240 160 300 Q240 180 360 260 Q440 160 540 220 Q620 120 720 200 Q800 80 920 180 Q1000 100 1080 200 Q1140 160 1200 240 L1200 1000Z" fill="currentColor"/>
        </g>
        <!-- Far mountain range -->
        <g opacity="0.18">
          <path d="M0 1000 L0 440 Q120 340 240 400 Q360 300 480 370 Q580 280 700 350 Q820 260 940 340 Q1060 290 1200 380 L1200 1000Z" fill="currentColor"/>
        </g>
        <!-- Mid hills with torii gate -->
        <g opacity="0.28">
          <path d="M0 1000 L0 560 Q100 480 220 520 Q360 440 500 500 Q620 450 740 490 Q860 420 980 480 Q1100 450 1200 500 L1200 1000Z" fill="currentColor"/>
          <!-- Torii gate on ridge -->
          <g transform="translate(420, 455)">
            <rect x="-14" y="0" width="3.5" height="45" fill="currentColor"/>
            <rect x="10.5" y="0" width="3.5" height="45" fill="currentColor"/>
            <rect x="-18" y="0" width="36" height="3.5" rx="1.5" fill="currentColor"/>
            <rect x="-16" y="9" width="32" height="2.5" fill="currentColor"/>
          </g>
        </g>
        <!-- Rolling hills with pagoda -->
        <g opacity="0.38">
          <path d="M0 1000 L0 660 Q140 600 280 630 Q400 580 540 620 Q680 570 800 610 Q920 580 1060 620 Q1140 600 1200 640 L1200 1000Z" fill="currentColor"/>
          <!-- Pagoda -->
          <g transform="translate(860, 572)">
            <rect x="-10" y="24" width="20" height="38" fill="currentColor"/>
            <path d="M-16 24 L0 12 L16 24Z" fill="currentColor"/>
            <path d="M-13 12 L0 2 L13 12Z" fill="currentColor"/>
          </g>
        </g>
        <!-- Near foreground with pines -->
        <g opacity="0.55">
          <path d="M0 1000 L0 780 Q80 740 180 760 Q320 720 460 750 Q580 730 700 760 Q840 720 960 750 Q1080 740 1200 770 L1200 1000Z" fill="currentColor"/>
          <!-- Pine cluster left -->
          <g transform="translate(120, 725)">
            <path d="M0 0 L-7 22 L-3 20 L-9 36 L9 36 L3 20 L7 22Z" fill="currentColor"/>
          </g>
          <g transform="translate(145, 730)">
            <path d="M0 0 L-5 18 L-2 16 L-7 28 L7 28 L2 16 L5 18Z" fill="currentColor"/>
          </g>
          <!-- Pine cluster right -->
          <g transform="translate(680, 722)">
            <path d="M0 0 L-8 24 L-3 22 L-10 40 L10 40 L3 22 L8 24Z" fill="currentColor"/>
          </g>
          <g transform="translate(710, 730)">
            <path d="M0 0 L-6 20 L-2 18 L-8 32 L8 32 L2 18 L6 20Z" fill="currentColor"/>
          </g>
          <!-- Distant pine -->
          <g transform="translate(1020, 735)">
            <path d="M0 0 L-5 16 L-2 14 L-6 26 L6 26 L2 14 L5 16Z" fill="currentColor"/>
          </g>
        </g>
        <!-- Closest foreground ridge -->
        <g opacity="0.7">
          <path d="M0 1000 L0 880 Q100 850 220 870 Q380 840 520 860 Q660 845 800 870 Q940 850 1080 875 L1200 885 L1200 1000Z" fill="currentColor"/>
        </g>
      </svg>
    </div>

    <!-- Class Context Banner (when launched from Schools) -->
    <div v-if="props.classContext" class="class-banner">
      <span class="class-icon">🏫</span>
      <span class="class-name">{{ props.classContext.name }}</span>
      <span class="class-course">{{ props.classContext.course }}</span>
    </div>

    <!-- Header - Logo with belt underneath, centered -->
    <header class="header" :class="{ 'has-banner': props.classContext }">
      <div class="header-stack">
        <!-- Logo row with theme toggle -->
        <div class="brand-row">
          <div class="brand">
            <span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span>
          </div>
          <!-- Theme toggle button -->
          <button
            v-if="themeContext"
            class="theme-toggle-btn"
            @click="themeContext.toggleTheme"
            :title="themeContext.theme.value === 'cosmos' ? 'Switch to Mist theme' : 'Switch to Cosmos theme'"
          >
            <!-- Sun icon for mist/day mode -->
            <svg v-if="themeContext.theme.value === 'cosmos'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/>
              <line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
            <!-- Moon icon for cosmos/night mode -->
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          </button>
        </div>

        <!-- Belt row: Skip buttons + progress/timer + Skip buttons -->
        <div class="belt-row">
          <!-- Skip back button -->
          <button
            class="belt-header-skip belt-header-skip--back"
            :class="{ 'is-skipping': isSkippingBelt, 'is-loading-target': prevBeltLoading }"
            @click="handleGoBackBelt"
            :disabled="!previousBelt && currentBelt.seedsRequired === completedRounds"
            :title="`Back to ${backTargetBelt.name} belt`"
            :style="{ '--skip-belt-color': backTargetBelt.color }"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="11 17 6 12 11 7"/>
              <polyline points="18 17 13 12 18 7"/>
            </svg>
          </button>

          <!-- Belt + Timer - narrower, opens modal on tap -->
          <button
            class="belt-timer-unified"
            @click="openBeltProgressModal"
            :title="!nextBelt ? 'Black belt achieved!' : `${Math.round(beltProgressPercent)}% to ${nextBelt.name} belt`"
          >
            <div class="belt-bar-track">
              <div class="belt-bar-fill" :style="{ width: `${beltProgressPercent}%` }"></div>
            </div>
            <span class="belt-timer-label">{{ formattedSessionTime }}</span>
          </button>

          <!-- Skip forward button -->
          <button
            class="belt-header-skip belt-header-skip--forward"
            :class="{ 'is-skipping': isSkippingBelt, 'is-loading-target': nextBeltLoading }"
            @click="handleSkipToNextBelt"
            :disabled="!nextBelt"
            :title="nextBelt ? `Skip to ${nextBelt.name} belt` : 'Black belt achieved!'"
            :style="nextBelt ? { '--skip-belt-color': nextBelt.color, '--skip-belt-glow': nextBelt.glow } : {}"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="13 17 18 12 13 7"/>
              <polyline points="6 17 11 12 6 7"/>
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Belt Progress Modal -->
    <BeltProgressModal
      :is-open="showBeltProgressModal"
      :current-belt="currentBelt"
      :next-belt="nextBelt"
      :completed-seeds="completedRounds"
      :session-seconds="sessionSeconds"
      :lifetime-learning-minutes="lifetimeLearningMinutes"
      :is-skipping="isSkippingBelt"
      @close="closeBeltProgressModal"
      @view-progress="handleViewFullProgress"
      @skip-to-belt="handleSkipToBeltFromModal"
    />

    <!-- Turbo Mode Explanation Popup -->
    <Transition name="fade">
      <div v-if="showTurboPopup" class="mode-popup-overlay" @click.self="closeTurboPopup">
        <div class="mode-popup">
          <div class="mode-popup-icon mode-popup-icon--turbo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </div>
          <h3 class="mode-popup-title">Turbo Mode</h3>
          <p class="mode-popup-desc">
            Turbo mode reduces the pause time between phrases, giving you less thinking time.
            It also gives you fewer repetitions.
            It's great for building fluency once you're comfortable with the material.
          </p>
          <div class="mode-popup-actions">
            <button class="mode-popup-btn mode-popup-btn--cancel" @click="closeTurboPopup">Cancel</button>
            <button class="mode-popup-btn mode-popup-btn--confirm" @click="confirmTurbo">Enable Turbo</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Mode Picker Popover -->
    <Transition name="fade">
      <div v-if="showModePicker" class="mode-picker-overlay" @click.self="showModePicker = false">
        <div class="mode-picker">
          <button class="mode-picker-option" @click="handlePickListening">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
            </svg>
            <span>Listening</span>
          </button>
          <button class="mode-picker-option" @click="handlePickDriving">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/>
              <path d="M5 17H3v-6l2-5h10l4 5h2v6h-2"/>
              <path d="M5 11h14"/>
              <path d="M9 17h6"/>
            </svg>
            <span>Driving</span>
          </button>
        </div>
      </div>
    </Transition>

    <!-- Listening Mode Explanation Popup -->
    <Transition name="fade">
      <div v-if="showListeningExplainer" class="mode-popup-overlay" @click.self="cancelListeningExplainer">
        <div class="mode-popup">
          <div class="mode-popup-icon mode-popup-icon--listening">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
            </svg>
          </div>
          <h3 class="mode-popup-title">Listening Mode</h3>
          <p class="mode-popup-desc">
            Just listen and absorb — no need to speak.
            Perfect for when you're in public or just want to take it easy.
            This will take a few moments to prepare.
          </p>
          <p class="mode-popup-hint">Tap the mode button again to exit.</p>
          <div class="mode-popup-actions">
            <button class="mode-popup-btn mode-popup-btn--cancel" @click="cancelListeningExplainer">Cancel</button>
            <button class="mode-popup-btn mode-popup-btn--confirm" @click="confirmListeningMode">Start Listening</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Driving Mode Explanation Popup -->
    <Transition name="fade">
      <div v-if="showDrivingExplainer" class="mode-popup-overlay" @click.self="cancelDrivingExplainer">
        <div class="mode-popup">
          <div class="mode-popup-icon mode-popup-icon--driving">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/>
              <path d="M5 17H3v-6l2-5h10l4 5h2v6h-2"/>
              <path d="M5 11h14"/>
              <path d="M9 17h6"/>
            </svg>
          </div>
          <h3 class="mode-popup-title">Driving Mode</h3>
          <p class="mode-popup-desc">
            Audio plays continuously — switch to Maps and learn while you drive.
            This will take a minute or two to prepare the audio.
          </p>
          <p class="mode-popup-hint">Use the X button or lock screen controls to exit.</p>
          <div class="mode-popup-actions">
            <button class="mode-popup-btn mode-popup-btn--cancel" @click="cancelDrivingExplainer">Cancel</button>
            <button class="mode-popup-btn mode-popup-btn--confirm" @click="confirmDrivingMode">Start Driving</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Listening Mode Overlay -->
    <Transition name="listening-overlay">
      <ListeningOverlay
        v-if="showListeningOverlay"
        :course-code="activeCourseCode"
        :belt-color="currentBelt.color"
        :highest-lego-id="beltProgress?.highestLegoId?.value ?? null"
        @close="handleCloseListening"
      />
    </Transition>

    <!-- Driving Mode Overlay -->
    <Transition name="driving-overlay">
      <DrivingModeOverlay
        v-if="isDrivingModeActive"
        :state="drivingMode.state.value"
        :current-round-index="drivingMode.currentRoundIndex.value"
        :total-rounds="cachedRounds?.length ?? 0"
        :prep-progress="drivingMode.preparationProgress.value"
        :current-segment="drivingMode.currentSegment.value"
        :current-known-text="drivingModeKnownText"
        :current-target-text="drivingModeTargetText"
        :show-target-text="drivingModeShowTarget"
        :cycle-count="drivingModeCycleCount"
        :current-cycle-index="drivingMode.currentSegment.value?.cycleIndex ?? 0"
        :belt-color="currentBelt.color"
        :belt-name="currentBelt.name"
        @exit="handleExitDrivingMode"
        @toggle-play-pause="drivingMode.togglePlayPause"
        @skip-next="drivingMode.skipToNextRound"
        @skip-prev="drivingMode.skipToPreviousRound"
      />
    </Transition>

    <!-- SPLIT-STAGE LAYOUT: Network Theater (top) + Control Pane (bottom) -->

    <!-- NETWORK THEATER - The brain visualization fills this space -->
    <section ref="networkTheaterRef" class="network-theater">
      <!-- Session Points Counter - HIDDEN (belt progression system is used instead) -->
      <!-- Points are still calculated internally for reward words but not shown to users -->
      <!--
      <div v-if="sessionPoints > 0" class="session-points-display" :class="{ 'has-multiplier': sessionMultiplier > 1 }">
        <span v-if="sessionMultiplier > 1" class="session-multiplier-indicator" title="Turbo bonus active">×</span>
        <span class="session-points-value">{{ sessionPoints }}</span>
        <span class="session-points-label">pts</span>
      </div>
      -->

      <!-- Progress Warning Overlay - shown for guest users (can be toggled in Settings > Developer) -->
      <div v-if="shouldShowProgressWarning" class="progress-warning-overlay">
        <div class="progress-warning-content">
          <div class="progress-warning-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <h3 class="progress-warning-title">Your progress is fragile</h3>
          <p class="progress-warning-text">
            Create an account or sign-in to store your progress in our database.
          </p>
          <p class="progress-warning-cta">Sign-in to save your progress.</p>
          <div class="progress-warning-actions">
            <button class="progress-warning-btn progress-warning-btn--primary" @click="openSignIn">
              Sign In
            </button>
            <button class="progress-warning-btn progress-warning-btn--secondary" @click="openCreateAccount">
              Create Account
            </button>
          </div>
        </div>
      </div>

      <!-- Debug Overlay - shows current phase, round, LEGO info (can be toggled in Settings > Developer) -->
      <div v-if="showDebugOverlay" class="debug-overlay">
        <div class="debug-info">
          <div class="debug-section-title">Position</div>
          <div class="debug-row"><span class="debug-label">Phase:</span> {{ currentPhase }}</div>
          <div class="debug-row"><span class="debug-label">Round:</span> {{ currentRoundIndex + 1 }} / {{ cachedRounds.length }}</div>
          <div class="debug-row"><span class="debug-label">Item:</span> {{ currentItemInRound + 1 }} / {{ currentRound?.items?.length || 0 }}</div>
          <div class="debug-row"><span class="debug-label">LEGO:</span> {{ currentItem?.legoId || '-' }}</div>
          <div class="debug-row"><span class="debug-label">Type:</span> {{ currentItem?.type || '-' }}</div>
          <div class="debug-row" v-if="currentItem?.reviewOf"><span class="debug-label">Review of:</span> LEGO {{ currentItem.reviewOf }}</div>
          
          <div class="debug-section-title">Audio Durations</div>
          <div class="debug-row"><span class="debug-label">Source:</span> {{ currentItem?.audioDurations?.source ? (currentItem.audioDurations.source * 1000).toFixed(0) + 'ms' : '-' }}</div>
          <div class="debug-row"><span class="debug-label">Target1:</span> {{ currentItem?.audioDurations?.target1 ? (currentItem.audioDurations.target1 * 1000).toFixed(0) + 'ms' : '-' }}</div>
          <div class="debug-row"><span class="debug-label">Target2:</span> {{ currentItem?.audioDurations?.target2 ? (currentItem.audioDurations.target2 * 1000).toFixed(0) + 'ms' : '-' }}</div>
          
          <div class="debug-section-title">Timing</div>
          <div class="debug-row"><span class="debug-label">Pause:</span> {{ Math.round(pauseDurationRef) }}ms</div>
          <div class="debug-row"><span class="debug-label">Turbo:</span> {{ turboActive ? 'ON' : 'OFF' }}</div>
          <div class="debug-row"><span class="debug-label">Adaptation:</span> {{ isAdaptationActive ? 'ON' : 'OFF' }}</div>
          
          <div class="debug-section-title" v-if="lastTimingResult?.speech_detected">Last Response</div>
          <div class="debug-row" v-if="lastTimingResult?.speech_detected"><span class="debug-label">Latency:</span> {{ lastTimingResult.response_latency_ms !== null ? Math.round(lastTimingResult.response_latency_ms) + 'ms' : '-' }}</div>
          <div class="debug-row" v-if="lastTimingResult?.speech_detected"><span class="debug-label">Delta:</span> {{ lastTimingResult.duration_delta_ms !== null ? (lastTimingResult.duration_delta_ms > 0 ? '+' : '') + Math.round(lastTimingResult.duration_delta_ms) + 'ms' : '-' }}</div>
        </div>
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
          <!-- Points hidden - belt progression system is used instead -->
          <!-- <span class="ink-points">+{{ reward.points }}</span> -->
        </div>
      </TransitionGroup>

      <!-- Text display area - fades together during transition -->
      <div class="pane-text" :class="{ 'is-transitioning': isTransitioningItem }">
        <!-- Known Language Text - always visible, stable position -->
        <div class="pane-text-known">
          <p v-if="isAwakening" class="known-text loading-text">
            {{ currentLoadingMessage }}<span class="loading-cursor">▌</span>
          </p>
          <p v-else-if="isPreparingToPlay" class="known-text loading-text preparing-text">
            {{ preparingMessage }}<span class="loading-cursor">▌</span>
          </p>
          <p v-else class="known-text">
            {{ displayedKnownText }}
          </p>
        </div>

        <!-- Visual separator -->
        <div class="pane-text-divider"></div>

        <!-- Target text removed — duplicated by LEGO tiles below -->

        <!-- Component Breakdown for M-type LEGOs (visual only, shown during intro & debut) -->
        <div v-if="displayedComponents.length > 0 && isIntroOrDebutPhase" class="pane-components">
          <div class="components-tiles">
            <template v-for="(comp, i) in displayedComponents" :key="i">
              <div class="component-tile">
                <span class="component-tile-target">{{ comp.target }}</span>
                <span class="component-tile-known">{{ comp.known }}</span>
              </div>
              <span v-if="i < displayedComponents.length - 1" class="component-plus">+</span>
            </template>
          </div>
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

    <!-- Control Bar - 2+2 balanced layout around nav bar play button -->
    <div class="control-bar" :class="{ 'control-bar--hidden': !isPlaying && !showListeningOverlay && !isDrivingModeActive }">
      <!-- Left side: Mode | Revisit -->
      <div class="control-group control-group--left">
        <button
          class="mode-btn mode-btn--modes"
          :class="{
            'active active--listening': showListeningOverlay,
            'active active--driving': isDrivingModeActive,
          }"
          @click="handleModeButtonClick"
          title="Learning Modes"
        >
          <svg v-if="isDrivingModeActive" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/>
            <path d="M5 17H3v-6l2-5h10l4 5h2v6h-2"/>
            <path d="M5 11h14"/>
            <path d="M9 17h6"/>
          </svg>
          <svg v-else-if="showListeningOverlay" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20v-6M6 20v-4M18 20v-2"/>
            <circle cx="12" cy="10" r="2"/>
            <path d="M8 12a4 4 0 0 1 8 0"/>
            <path d="M5 14a7 7 0 0 1 14 0"/>
          </svg>
        </button>

        <button class="transport-btn" @click="handleRevisit" :disabled="isDrivingModeActive" title="Revisit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      </div>

      <!-- Right side: Skip | Turbo -->
      <div class="control-group control-group--right">
        <button class="transport-btn" @click="handleSkip" :disabled="isDrivingModeActive" title="Skip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>

        <button
          class="mode-btn mode-btn--turbo"
          :class="{ active: turboActive }"
          @click="handleTurboClick"
          :disabled="isDrivingModeActive"
          title="Turbo Boost"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Report Issue Button - moved to header area for QA mode only -->
    <ReportIssueButton
      v-if="shouldShowQaMode"
      class="qa-report-btn"
      :course-code="activeCourseCode"
      :current-item="currentItem"
      :current-known="visibleTexts.known"
      :current-target="visibleTexts.target"
      :qa-mode="shouldShowQaMode"
    />

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
  </div><!-- /.learning-player-root -->
</template>

<style scoped>
/* ============================================
   SSi Learning Player - Zen Sanctuary Edition
   Refined minimalism, premium feel
   ============================================ */

/* Fonts loaded globally in style.css */

/* Belt Skip Loading Overlay */
.belt-skip-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.belt-skip-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--belt-color, var(--ssi-red));
  border-radius: 50%;
  animation: belt-skip-spin 0.8s linear infinite;
}

@keyframes belt-skip-spin {
  to { transform: rotate(360deg); }
}

.belt-skip-label {
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

/* Root wrapper - enables v-show to work correctly from parent component */
/* When parent uses v-show="currentScreen === 'player'", this div receives display:none */
/* which properly hides all fixed-position children (space-gradient, overlays, etc.) */
.learning-player-root {
  /* Fill viewport so fixed children display correctly when visible */
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
}

.player {
  /* ════════════════════════════════════════════════════════════════════════════
     RESPONSIVE DESIGN SYSTEM - Single Source of Truth

     All sizing controlled by CSS variables. Breakpoints ONLY update these vars.
     Components use vars - no hardcoded sizes in component styles.

     BREAKPOINTS (mobile-first):
     - Base: 0-359px (extra small phones)
     - sm: 360px+ (small phones - iPhone SE, etc)
     - md: 480px+ (larger phones - iPhone Pro Max, etc)
     - lg: 768px+ (tablets)
     - xl: 1024px+ (desktop)
     ════════════════════════════════════════════════════════════════════════════ */

  /* ============ SAFE AREAS ============ */
  --safe-area-top: env(safe-area-inset-top, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);

  /* ============ LAYOUT STRUCTURE ============ */
  --header-height: 56px;
  --header-total: calc(var(--header-height) + var(--safe-area-top));
  --nav-height: 80px;
  --nav-total: calc(var(--nav-height) + var(--safe-area-bottom));
  --control-bar-bottom: var(--nav-total);
  --hero-offset: 64px;
  --hero-top: calc(var(--header-total) + var(--hero-offset));

  /* ============ SPACING SCALE ============ */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;

  /* ============ TYPOGRAPHY SCALE ============ */
  --text-xs: 0.6875rem;   /* 11px */
  --text-sm: 0.8125rem;   /* 13px */
  --text-base: 1rem;      /* 16px */
  --text-lg: 1.375rem;    /* 22px */
  --text-xl: 1.625rem;    /* 26px */
  --text-2xl: 1.875rem;   /* 30px */

  /* ============ BUTTON SIZES ============ */
  /* Touch target: always 44px min for accessibility */
  --btn-touch-target: 44px;

  /* Mode buttons (listening, turbo) */
  --mode-btn-size: 36px;
  --mode-btn-icon: 16px;

  /* Transport buttons (skip, revisit) */
  --transport-btn-size: 32px;
  --transport-btn-icon: 14px;

  /* Belt nav buttons (header skip arrows) */
  --belt-skip-btn-size: 36px;
  --belt-skip-btn-icon: 16px;

  /* Belt nav buttons (control bar double arrows) */
  --belt-nav-btn-size: 36px;
  --belt-nav-btn-icon: 16px;

  /* ============ CONTROL BAR ============ */
  --control-bar-gap: 3rem;      /* Gap between left and right groups (for play button) */
  --control-group-gap: 0.5rem;  /* Gap between buttons in a group */
  --control-bar-padding: var(--space-sm) var(--space-md);
  --control-bar-radius: 20px;

  /* ============ HEADER ============ */
  --header-padding: var(--space-md) var(--space-lg) var(--space-sm);
  --belt-row-gap: 0.5rem;
  --belt-timer-width: 180px;
  --belt-bar-width: 60px;
  --belt-bar-height: 5px;

  /* ============ RING / TEXT ZONE ============ */
  --ring-size: 180px;
  --ring-center-size: 110px;
  --ring-icon-size: 36px;
  --text-zone-min-height: 90px;  /* Increased for larger text */
  --known-text-size: 1.35rem;
  --target-text-size: 1.35rem;

  /* ============ THEME COLORS ============ */
  --accent: var(--ssi-red);
  --accent-soft: rgba(194, 58, 58, 0.15);
  --accent-glow: rgba(194, 58, 58, 0.4);
  --gold: var(--ssi-gold);
  --gold-soft: rgba(212, 168, 83, 0.15);
  --success: #22c55e;

  /* ============ LAYOUT ============ */
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-primary);
  font-family: var(--font-body);
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

/* Belt-aware background: brighter, warmer for early belts */
.belt-white .space-gradient,
.belt-yellow .space-gradient {
  background:
    radial-gradient(ellipse 120% 80% at 20% 10%, rgba(50, 35, 70, 0.8) 0%, transparent 50%),
    radial-gradient(ellipse 100% 60% at 80% 90%, rgba(40, 35, 60, 0.6) 0%, transparent 40%),
    radial-gradient(ellipse 80% 80% at 50% 50%, rgba(18, 15, 30, 1) 0%, #0e0c14 100%);
}

.belt-white .space-nebula,
.belt-yellow .space-nebula {
  background:
    radial-gradient(ellipse 60% 40% at 30% 30%, rgba(140, 100, 180, 0.12) 0%, transparent 50%),
    radial-gradient(ellipse 50% 30% at 70% 60%, rgba(120, 100, 160, 0.09) 0%, transparent 40%),
    radial-gradient(ellipse 70% 50% at 50% 80%, rgba(160, 120, 100, 0.06) 0%, transparent 50%);
}

.belt-white .star-field .star,
.belt-yellow .star-field .star {
  opacity: 0.7;
}

.belt-orange .space-nebula {
  background:
    radial-gradient(ellipse 60% 40% at 30% 30%, rgba(120, 90, 160, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse 50% 30% at 70% 60%, rgba(100, 90, 150, 0.06) 0%, transparent 40%);
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

/* Mountain/landscape silhouette - hidden by default (shown in mist theme via non-scoped style) */
.mountain-silhouette {
  display: none;
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  color: rgba(44, 37, 32, var(--mountain-opacity, 0.06));
}

.mountain-silhouette svg {
  width: 100%;
  height: 100%;
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
  font-family: var(--font-body);
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
  z-index: 15; /* Higher than hero-text-pane (10) to prevent overlap issues */
  display: flex;
  align-items: center;
  justify-content: center; /* Center the header stack */
  /* Use safe area + spacing from design system */
  padding: calc(var(--space-md) + var(--safe-area-top)) var(--space-lg) var(--space-sm);
  gap: var(--space-md);
  pointer-events: auto; /* Header buttons clickable */
  /* Height defined by CSS custom property for consistency */
  min-height: var(--header-height);
}

.header.has-banner {
  padding-top: 0.5rem;
}

/* Header stack - logo on top, belt underneath */
.header-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
}

/* Close button removed - navigation handled by bottom nav */
.close-btn {
  display: none;
}

/* Brand row - logo + theme toggle */
.brand-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Brand/logo - centered in stack */
.brand {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 1.5rem; /* Fixed size - don't scale */
  letter-spacing: -0.02em;
  opacity: 0.7;
  transition: opacity 0.2s ease;
}

/* Theme toggle button */
.theme-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--bg-card);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s ease;
  opacity: 0.6;
}

.theme-toggle-btn:hover {
  opacity: 1;
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.theme-toggle-btn:active {
  transform: scale(0.95);
}

.theme-toggle-btn svg {
  width: 18px;
  height: 18px;
}

.brand:hover {
  opacity: 1;
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

/* ============ BELT ROW WITH SKIP BUTTONS ============ */
/* Container for belt skip buttons + progress/timer */
.belt-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--belt-row-gap);
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
  margin-top: var(--space-md);
  padding: 0 var(--space-lg);
}

/* Belt header skip buttons - subtle chevrons only (no circle) */
.belt-header-skip {
  width: var(--belt-skip-btn-size);
  height: var(--belt-skip-btn-size);
  min-width: var(--btn-touch-target);
  min-height: var(--btn-touch-target);
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--skip-belt-color, var(--text-muted));
  opacity: 0.6;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.belt-header-skip svg {
  width: var(--belt-skip-btn-icon);
  height: var(--belt-skip-btn-icon);
}

.belt-header-skip:hover:not(:disabled) {
  opacity: 1;
  transform: scale(1.1);
}

.belt-header-skip:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.belt-header-skip.is-skipping {
  animation: belt-skip-flash 0.6s ease-in-out infinite;
  pointer-events: none;
  opacity: 1;
}

/* Belt skip loading state: target rounds not yet loaded */
.belt-header-skip.is-loading-target:not(.is-skipping) {
  animation: belt-skip-pulse 1.5s ease-in-out infinite;
  opacity: 0.5;
}

@keyframes belt-skip-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.2; }
}

/* ============ UNIFIED BELT + TIMER ============ */
/* Single element showing belt progress bar + session time, opens modal on tap */
/* Narrower to fit alongside skip buttons */
.belt-timer-unified {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-lg);
  background: var(--bg-card);
  border: 1px solid color-mix(in srgb, var(--belt-color) 35%, var(--border-subtle));
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 0 15px color-mix(in srgb, var(--belt-glow) 12%, transparent);
  flex: 1;
  min-width: 0;
  max-width: var(--belt-timer-width);
}

.belt-timer-unified:hover {
  background: var(--bg-elevated);
  border-color: var(--belt-color);
  box-shadow: 0 0 12px var(--belt-glow);
}

.belt-timer-unified:active {
  transform: scale(0.98);
}

.belt-timer-unified .belt-bar-track {
  flex: 1;
  min-width: var(--belt-bar-width);
  height: var(--belt-bar-height);
  background: var(--bg-elevated);
  border-radius: 4px;
  overflow: hidden;
}

.belt-timer-unified .belt-bar-fill {
  height: 100%;
  background: var(--belt-color);
  border-radius: 4px;
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1), background 0.5s ease;
  box-shadow: 0 0 6px var(--belt-glow);
  min-width: 2px;
}

.belt-timer-label {
  font-family: 'Space Mono', monospace;
  font-size: clamp(0.75rem, 2vw, 0.875rem);
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

/* Legacy styles kept for backwards compatibility */
.belt-progress-btn {
  display: none; /* Hidden - replaced by belt-timer-unified */
}

.belt-bar-label {
  display: none; /* Hidden - replaced by belt-timer-label */
}

.belt-inline-timer {
  display: none; /* Hidden - timer now always visible in belt-timer-label */
}

/* ============ FULLSCREEN NETWORK LAYOUT ============ */
/* Network fills the whole screen, controls float on top */

.network-theater {
  position: absolute;
  /* Use the calculated header total from CSS custom properties */
  top: var(--header-total);
  left: 0;
  right: 0;
  bottom: 0; /* FULLSCREEN - extends to bottom */
  z-index: 5;
  pointer-events: none; /* Let events pass through to network below */
}

/* Progress Warning Overlay - Shown for guest users */
.progress-warning-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: radial-gradient(
    ellipse at center,
    rgba(10, 10, 20, 0.92) 0%,
    rgba(5, 5, 12, 0.96) 100%
  );
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 10;
  pointer-events: auto;
}

.progress-warning-content {
  max-width: 380px;
  text-align: center;
  animation: warningFadeIn 0.5s ease-out;
}

@keyframes warningFadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.progress-warning-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 20px;
  color: #e8a87c;
  opacity: 0.9;
}

.progress-warning-icon svg {
  width: 100%;
  height: 100%;
}

.progress-warning-title {
  font-family: var(--font-display, 'DM Sans', sans-serif);
  font-size: 1.5rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  margin: 0 0 16px 0;
  letter-spacing: -0.01em;
}

.progress-warning-text {
  font-size: 0.95rem;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.7);
  margin: 0 0 12px 0;
}

.progress-warning-cta {
  font-size: 0.95rem;
  line-height: 1.6;
  color: #e8a87c;
  margin: 0 0 28px 0;
  font-weight: 500;
}

.progress-warning-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-warning-btn {
  display: block;
  width: 100%;
  padding: 14px 24px;
  border-radius: 10px;
  font-size: 0.95rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.progress-warning-btn--primary {
  background: linear-gradient(135deg, #e8a87c 0%, #d4896b 100%);
  color: #1a1a2e;
  box-shadow: 0 4px 16px rgba(232, 168, 124, 0.25);
}

.progress-warning-btn--primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(232, 168, 124, 0.35);
}

.progress-warning-btn--primary:active {
  transform: translateY(0);
}

.progress-warning-btn--secondary {
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.progress-warning-btn--secondary:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.95);
}

.progress-warning-btn--secondary:active {
  background: rgba(255, 255, 255, 0.08);
}

/* Debug Overlay - Developer tool for showing current state */
.debug-overlay {
  position: absolute;
  /* Position below header area so it doesn't push content up */
  top: calc(80px + env(safe-area-inset-top, 0px));
  left: 12px;
  z-index: 100;
  pointer-events: none;
}

.debug-info {
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 10px 14px;
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.debug-row {
  display: flex;
  gap: 8px;
}

.debug-label {
  color: rgba(255, 255, 255, 0.5);
  min-width: 70px;
}

.debug-section-title {
  font-size: 9px;
  font-weight: 600;
  color: rgba(255, 200, 100, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 6px;
  margin-bottom: 2px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.debug-section-title:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
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

/* Component breakdown tiles for M-type LEGOs */
.pane-components {
  margin-top: 1rem;
}

.components-tiles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.component-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.4rem 0.75rem;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
}

.component-tile-target {
  font-size: 1rem;
  font-weight: 600;
  color: var(--belt-color, rgba(251, 191, 36, 0.9));
  line-height: 1.3;
}

.component-tile-known {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.3;
}

.component-plus {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.3);
  font-weight: 300;
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

/* Hide network text during prompt/pause so learner recalls without reading answers */
.brain-network-container.network-hidden-text :deep(.target-text) {
  opacity: 0;
  transition: opacity 0.3s ease;
}

.brain-network-container:not(.network-hidden-text) :deep(.target-text) {
  transition: opacity 0.3s ease;
}

/* ============ HERO-CENTRIC TEXT PANE ============ */
/* Text labels floating above/below the hero node with glass effect */
.hero-text-pane {
  position: absolute;
  /* Position below header using CSS custom property - no media queries needed */
  top: var(--hero-top);
  left: 50%;
  transform: translate(-50%, 0);
  z-index: 10;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem; /* Fixed gap between hint and text box */
  /* Fixed phone-like width */
  width: calc(100% - 2rem);
  max-width: 400px;
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
  gap: var(--space-sm);
  /* Responsive padding using spacing scale */
  padding: var(--space-md) var(--space-lg) var(--space-md);
  /* Responsive border-radius */
  border-radius: clamp(16px, 3vmin, 24px);
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: none;
  box-shadow:
    0 2px 16px rgba(0, 0, 0, 0.3),
    0 0 0 1px var(--belt-glow, rgba(194, 58, 58, 0.08));
  /* Fill parent width - parent handles max-width */
  width: 100%;
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
  gap: var(--space-sm);
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  /* Responsive text size using CSS custom property */
  font-size: var(--text-base);
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
  font-size: var(--known-text-size);
  font-weight: 400;
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
  line-height: 1.5;
  letter-spacing: 0.01em;
}

.hero-target {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: var(--target-text-size);
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

/* ============ LEARNING HINT BOX - Matches hero-glass style ============ */
.learning-hint-box {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 24px;
  /* Match hero-glass styling */
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: none;
  box-shadow:
    0 2px 16px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(255, 255, 255, 0.08);
  /* Match hero-glass width */
  min-width: 320px;
  max-width: 400px;
  width: 100%;
  position: relative;
  transition: all 0.3s ease;
  /* Make clickable despite parent pointer-events: none */
  pointer-events: auto;
}

.hint-text {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 0.9375rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.75);
  letter-spacing: 0.02em;
  text-align: center;
}

.hint-dismiss {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0.5;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.hint-dismiss:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.15);
}

.hint-dismiss svg {
  width: 14px;
  height: 14px;
  color: rgba(255, 255, 255, 0.8);
}

/* Speaking state - ALIVE! Recording feel */
.learning-hint-box.is-speaking {
  background: rgba(220, 38, 38, 0.12);
  box-shadow:
    0 2px 16px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(220, 38, 38, 0.4),
    0 0 30px rgba(220, 38, 38, 0.2),
    inset 0 0 30px rgba(220, 38, 38, 0.05);
  animation: speaking-pulse 1.2s ease-in-out infinite;
}

.learning-hint-box.is-speaking .hint-text {
  color: rgba(255, 255, 255, 0.95);
  font-weight: 600;
}

@keyframes speaking-pulse {
  0%, 100% {
    box-shadow:
      0 2px 16px rgba(0, 0, 0, 0.3),
      0 0 0 1px rgba(220, 38, 38, 0.4),
      0 0 20px rgba(220, 38, 38, 0.15),
      inset 0 0 20px rgba(220, 38, 38, 0.03);
  }
  50% {
    box-shadow:
      0 2px 16px rgba(0, 0, 0, 0.3),
      0 0 0 2px rgba(220, 38, 38, 0.6),
      0 0 40px rgba(220, 38, 38, 0.3),
      inset 0 0 40px rgba(220, 38, 38, 0.08);
  }
}

/* Timer bar inside hint during speak phase */
/* Inset to respect the 24px rounded corners */
.hint-timer {
  position: absolute;
  bottom: 6px;
  /* Inset from edges so it doesn't extend beyond the rounded corners */
  left: 20px;
  right: 20px;
  height: 3px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 2px;
  overflow: hidden;
}

.hint-timer-fill {
  height: 100%;
  background: #dc2626;
  border-radius: 2px;
  transition: width 0.1s linear;
  box-shadow: 0 0 8px rgba(220, 38, 38, 0.6);
}

/* Standalone pause countdown bar - always visible during speak phase */
.pause-timer-bar {
  width: 80%;
  max-width: 500px;
  height: 4px;
  margin: 12px auto 0;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 2px;
  overflow: hidden;
}
.pause-timer-fill {
  height: 100%;
  background: #dc2626;
  border-radius: 2px;
  transition: width 0.1s linear;
  box-shadow: 0 0 8px rgba(220, 38, 38, 0.6);
}

/* ============ PHASE STRIP (legacy - kept for reference) ============ */
/* Horizontal Phase Strip - speaker → mic → speaker → eyes */
/* NOTE: This is now replaced by .learning-hint in the template */
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
   RESPONSIVE LAYOUT - Consolidated using CSS Custom Properties

   Core sizing handled by clamp() in --text-*, --space-*, etc.
   Only special cases (landscape compact mode) need media queries.
   ═══════════════════════════════════════════════════════════════ */

/* Phase strip - responsive sizing using clamp() */
.phase-strip {
  gap: clamp(3px, 1vmin, 12px);
  margin-bottom: clamp(6px, 1.5vmin, 16px);
}

.phase-section {
  width: clamp(28px, 6vmin, 64px);
  height: clamp(28px, 6vmin, 64px);
  border-radius: clamp(6px, 1.5vmin, 16px);
}

.phase-icon-svg {
  width: clamp(14px, 3vmin, 32px);
  height: clamp(14px, 3vmin, 32px);
}

.phase-icon-emoji {
  font-size: clamp(14px, 3vmin, 32px);
}

/* Session points display - floating above transport controls, centered */
.session-points-display {
  position: fixed;
  /* Position above control bar */
  bottom: calc(var(--nav-total) + var(--control-bar-offset) + 80px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 6px 16px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 20px;
  /* Belt-colored subtle border accent */
  border: 1px solid color-mix(in srgb, var(--belt-color) 30%, rgba(255, 255, 255, 0.1));
  z-index: 25;
  /* Subtle belt glow */
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3),
              0 0 12px color-mix(in srgb, var(--belt-glow) 15%, transparent);
}

.session-points-value {
  font-family: var(--font-body);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--belt-color, var(--gold));
  text-shadow: 0 0 10px var(--belt-glow, rgba(212, 168, 83, 0.4));
}

.session-points-label {
  font-family: var(--font-body);
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
  min-height: var(--text-zone-min-height);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.text-zone--known {
  /* Known language styling */
}

.known-text {
  font-size: var(--known-text-size);
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.3;
}

.text-zone--target {
  min-height: 80px; /* Always reserve space */
}

.target-text {
  font-size: var(--target-text-size);
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
  width: var(--ring-size);
  height: var(--ring-size);
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
  width: var(--ring-center-size);
  height: var(--ring-center-size);
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
  font-family: var(--font-body);
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
  gap: var(--control-bar-gap);
  padding: var(--control-bar-padding);
  position: absolute;
  bottom: var(--control-bar-bottom);
  left: 50%;
  transform: translateX(-50%);
  /* Above BottomNav backdrop (z:100) but below BottomNav play button (z:110) */
  z-index: 105;
  pointer-events: auto;
  background: rgba(10, 10, 15, 0.5);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: var(--control-bar-radius);
  border: 1px solid color-mix(in srgb, var(--belt-color) 25%, rgba(255, 255, 255, 0.06));
  /* Subtle belt glow on bottom edge */
  box-shadow: 0 -4px 30px rgba(0, 0, 0, 0.3),
              0 0 20px color-mix(in srgb, var(--belt-glow) 10%, transparent);
  /* Fixed phone-like width - matches other content */
  width: calc(100% - 2rem);
  max-width: 400px;
  transition: opacity 0.3s ease;
}

/* Hide control bar when player is resting (not playing) */
.control-bar--hidden {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

/* Control groups for 3+3 layout */
.control-group {
  display: flex;
  align-items: center;
  gap: var(--control-group-gap);
}

/* QA Report button - positioned in header area */
.qa-report-btn {
  position: fixed;
  top: calc(1rem + env(safe-area-inset-top, 0px));
  right: 1rem;
  z-index: 100;
}

.mode-btn {
  width: var(--mode-btn-size);
  height: var(--mode-btn-size);
  min-width: var(--btn-touch-target);
  min-height: var(--btn-touch-target);
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
  width: var(--mode-btn-icon);
  height: var(--mode-btn-icon);
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

/* Mode Picker - compact two-option popover above control bar */
.mode-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  padding-bottom: calc(80px + env(safe-area-inset-bottom));
}

.mode-picker {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: rgba(20, 20, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  backdrop-filter: blur(20px);
}

.mode-picker-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.85rem;
}

.mode-picker-option:active {
  background: rgba(255, 255, 255, 0.12);
  transform: scale(0.97);
}

.mode-picker-option svg {
  width: 28px;
  height: 28px;
}

/* Mode Explanation Popups */
.mode-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  padding: 1.5rem;
}

.mode-popup {
  background: var(--bg-secondary);
  border: 1px solid var(--border-medium);
  border-radius: 1rem;
  padding: 1.5rem;
  max-width: 320px;
  text-align: center;
}

.mode-popup-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 1rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mode-popup-icon svg {
  width: 28px;
  height: 28px;
}

.mode-popup-icon--turbo {
  background: var(--gold-soft);
  color: var(--gold);
}

.mode-popup-icon--listening {
  background: rgba(96, 165, 250, 0.15);
  color: #60a5fa;
}

.mode-popup-icon--driving {
  background: rgba(96, 165, 250, 0.15);
  color: #60a5fa;
}

.mode-popup-hint {
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin: -0.5rem 0 1.25rem;
  font-style: italic;
}

.mode-popup-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.75rem;
}

.mode-popup-desc {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 1.25rem;
}

.mode-popup-coming-soon {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--accent);
  margin: -0.5rem 0 1.25rem;
}

.mode-popup-actions {
  display: flex;
  gap: 0.75rem;
}

.mode-popup-btn {
  flex: 1;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.mode-popup-btn--cancel {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.mode-popup-btn--cancel:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.mode-popup-btn--confirm {
  background: var(--accent);
  color: white;
}

.mode-popup-btn--confirm:hover {
  filter: brightness(1.1);
}

/* Belt Navigation Buttons - Double chevrons for belt jumps */
.belt-nav-btn {
  width: var(--belt-nav-btn-size);
  height: var(--belt-nav-btn-size);
  min-width: var(--btn-touch-target);
  min-height: var(--btn-touch-target);
  border-radius: 50%;
  border: 2px solid;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.belt-nav-btn svg {
  width: var(--belt-nav-btn-icon);
  height: var(--belt-nav-btn-icon);
}

.belt-nav-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  transform: scale(1.05);
}

.belt-nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Forward button shows next belt color - always visible border */
.belt-nav-btn--forward {
  color: var(--next-belt-color, var(--text-muted));
  border-color: var(--next-belt-color, var(--text-muted));
}

.belt-nav-btn--forward:hover:not(:disabled) {
  color: var(--next-belt-color, var(--text-primary));
  box-shadow: 0 0 12px var(--next-belt-glow, transparent);
}

/* Back button shows target belt color - always visible border */
.belt-nav-btn--back {
  color: var(--back-belt-color, var(--text-muted));
  border-color: var(--back-belt-color, var(--text-muted));
}

.belt-nav-btn--back:hover:not(:disabled) {
  color: var(--back-belt-color, var(--text-primary));
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

/* Transport buttons (Revisit, Skip) */
.transport-btn {
  width: var(--transport-btn-size);
  height: var(--transport-btn-size);
  min-width: var(--btn-touch-target);
  min-height: var(--btn-touch-target);
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

.transport-btn svg {
  width: var(--transport-btn-icon);
  height: var(--transport-btn-icon);
}

.transport-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--text-primary);
  transform: scale(1.05);
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
/* transition only on .is-visible so hide is instant (prevents flash of new text during fade-out) */
.hero-text-target,
.pane-text-target {
  opacity: 0;
}

.hero-text-target.is-visible,
.pane-text-target.is-visible {
  opacity: 1;
  transition: opacity 0.3s ease;
}

/* ============ PAUSED STATE ============ */
.player.is-paused .ring-ambient {
  opacity: 0 !important;
}

/* ════════════════════════════════════════════════════════════════════════════
   RESPONSIVE BREAKPOINTS - Just 2

   Mobile (base) = the default experience, where 95% of users are
   Tablet+ (768px) = larger screens, slightly more generous sizing

   Player content is always phone-sized. On desktop, it centers with
   the space background extending to fill the viewport.
   ════════════════════════════════════════════════════════════════════════════ */

/* Tablet and Desktop (768px+) - more breathing room */
@media (min-width: 768px) {
  .player {
    --header-height: 64px;
    --hero-offset: 80px;
    --space-md: 16px;
    --space-lg: 20px;
    --mode-btn-size: 44px;
    --mode-btn-icon: 20px;
    --transport-btn-size: 40px;
    --transport-btn-icon: 18px;
    --belt-skip-btn-size: 40px;
    --belt-skip-btn-icon: 18px;
    --belt-nav-btn-size: 40px;
    --belt-nav-btn-icon: 18px;
    --belt-timer-width: 240px;
    --belt-bar-width: 90px;
    --belt-bar-height: 6px;
    --control-bar-gap: 3.5rem;
    --control-group-gap: 0.625rem;
    --ring-size: 220px;
    --ring-center-size: 130px;
    --ring-icon-size: 44px;
    --text-zone-min-height: 100px;
    --known-text-size: 2.25rem;
    --target-text-size: 2rem;
  }
}

/* Landscape phones - compact vertical spacing */
@media (orientation: landscape) and (max-height: 500px) {
  .player {
    --header-height: 48px;
    --hero-offset: 20px;
    --space-sm: 4px;
    --space-md: 8px;
    --space-lg: 12px;
    --control-bar-gap: 3rem;
    --control-group-gap: 0.25rem;
    --ring-size: 140px;
    --ring-center-size: 85px;
    --ring-icon-size: 28px;
    --text-zone-min-height: 50px;
    --known-text-size: 1.5rem;
    --target-text-size: 1.25rem;
  }
}

/* PWA standalone mode - safe area handled by CSS custom properties */
/* Note: --control-bar-bottom already includes --nav-total which includes --safe-area-bottom */

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

/* Listening overlay transition - slides up from bottom */
.listening-overlay-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.listening-overlay-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.listening-overlay-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.listening-overlay-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

/* Mode button active states */
.mode-btn--modes.active--listening {
  background: var(--gold-glow, rgba(212, 168, 83, 0.15));
  border-color: var(--gold, #d4a853);
  color: var(--gold, #d4a853);
}

.mode-btn--modes.active--driving {
  background: rgba(96, 165, 250, 0.15);
  border-color: #60a5fa;
  color: #60a5fa;
}

/* Driving overlay transition */
.driving-overlay-enter-active {
  transition: opacity 0.3s ease;
}

.driving-overlay-leave-active {
  transition: opacity 0.25s ease;
}

.driving-overlay-enter-from,
.driving-overlay-leave-to {
  opacity: 0;
}

</style>

<!-- ═══════════════════════════════════════════════════════════════
     MISTY DOJO THEME — Non-scoped overrides
     Must be non-scoped because Vue adds [data-v-xxx] to :root
     selectors in scoped styles, making them unmatchable.
     Scoped manually via .player parent class.
     ═══════════════════════════════════════════════════════════════ -->
<style>
/* --- Player wrapper background --- */
[data-theme="mist"] .player {
  background: #D9D6D2;
}

/* --- Space / Background layers → Washi paper --- */
[data-theme="mist"] .player .space-gradient {
  background:
    radial-gradient(ellipse 90% 70% at 15% 10%, rgba(255, 248, 230, 0.6) 0%, transparent 50%),
    radial-gradient(ellipse 100% 60% at 80% 90%, rgba(232, 224, 206, 0.4) 0%, transparent 40%),
    radial-gradient(ellipse 80% 80% at 50% 50%, #D9D6D2 0%, #E0DDDA 100%);
}

[data-theme="mist"] .player .space-nebula {
  background:
    linear-gradient(180deg, transparent 0%, rgba(122, 110, 98, 0.04) 30%, rgba(122, 110, 98, 0.06) 50%, transparent 70%),
    linear-gradient(180deg, transparent 40%, rgba(122, 110, 98, 0.03) 60%, transparent 80%);
  animation: mist-drift 20s ease-in-out infinite;
}

@keyframes mist-drift {
  0%, 100% { opacity: 1; transform: translateY(0); }
  50% { opacity: 0.7; transform: translateY(-8px); }
}

[data-theme="mist"] .player .bg-noise {
  opacity: 0.06;
  filter: none;
  mix-blend-mode: multiply;
}

/* Subtle washi fiber lines */
[data-theme="mist"] .player .bg-noise::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, transparent 18%, rgba(122, 110, 98, 0.02) 18.5%, transparent 19%),
    linear-gradient(90deg, transparent 42%, rgba(122, 110, 98, 0.015) 42.3%, transparent 42.8%),
    linear-gradient(90deg, transparent 71%, rgba(122, 110, 98, 0.02) 71.4%, transparent 72%),
    linear-gradient(90deg, transparent 89%, rgba(122, 110, 98, 0.015) 89.3%, transparent 89.8%);
  pointer-events: none;
}

/* --- Hide stars & drift-stars in mist (landscape replaces them) --- */
[data-theme="mist"] .player .star-field,
[data-theme="mist"] .player .drift-stars {
  display: none;
}

/* --- Nebula glow → Belt-colored floor accent wash --- */
[data-theme="mist"] .player .nebula-glow {
  background:
    linear-gradient(
      to top,
      color-mix(in srgb, var(--belt-color) 12%, transparent) 0%,
      color-mix(in srgb, var(--belt-color) 4%, transparent) 30%,
      transparent 50%
    );
  opacity: 0.8;
}

/* --- Mountain silhouette → Belt color wash overlay --- */
[data-theme="mist"] .player .mountain-silhouette::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--belt-color) 8%, transparent) 0%,
    color-mix(in srgb, var(--belt-color) 3%, transparent) 40%,
    transparent 70%
  );
  pointer-events: none;
  mix-blend-mode: multiply;
}

/* --- Mountain silhouette (shown only in mist) --- */
[data-theme="mist"] .player .mountain-silhouette {
  display: block;
}

/* --- Hero glass → Solid paper card with belt glow --- */
[data-theme="mist"] .player .hero-glass {
  background: #F2F0ED;
  border: 1.5px solid color-mix(in srgb, var(--belt-color) 40%, rgba(122, 110, 98, 0.18));
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.1),
              0 4px 12px rgba(44, 38, 34, 0.08),
              0 0 8px color-mix(in srgb, var(--belt-color) 20%, transparent),
              0 0 20px color-mix(in srgb, var(--belt-color) 10%, transparent);
}

/* --- Hero text --- */
[data-theme="mist"] .player .hero-known {
  color: #1A1614;
}

[data-theme="mist"] .player .hero-target {
  color: color-mix(in srgb, var(--belt-color) 70%, #1A1614);
  text-shadow: none;
}

/* --- Control bar → Solid paper with belt glow --- */
[data-theme="mist"] .player .control-bar {
  background: #F2F0ED;
  border: 1.5px solid color-mix(in srgb, var(--belt-color) 40%, rgba(122, 110, 98, 0.18));
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.1),
              0 4px 12px rgba(44, 38, 34, 0.08),
              0 0 8px color-mix(in srgb, var(--belt-color) 20%, transparent),
              0 0 20px color-mix(in srgb, var(--belt-color) 10%, transparent);
}

/* --- Belt timer → Match edge definition with belt glow --- */
[data-theme="mist"] .player .belt-timer-unified {
  background: #F2F0ED;
  border: 1.5px solid color-mix(in srgb, var(--belt-color) 40%, rgba(122, 110, 98, 0.18));
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.1),
              0 4px 12px rgba(44, 38, 34, 0.08),
              0 0 8px color-mix(in srgb, var(--belt-color) 25%, transparent),
              0 0 20px color-mix(in srgb, var(--belt-color) 12%, transparent);
}

/* --- Skip buttons → Visible circular buttons with belt color --- */
[data-theme="mist"] .player .belt-header-skip {
  background: color-mix(in srgb, var(--skip-belt-color, var(--belt-color)) 12%, #F2F0ED);
  border: 1.5px solid color-mix(in srgb, var(--skip-belt-color, var(--belt-color)) 35%, rgba(122, 110, 98, 0.2));
  opacity: 1;
  color: color-mix(in srgb, var(--skip-belt-color, var(--belt-color)) 70%, #1A1614);
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.1),
              0 0 6px color-mix(in srgb, var(--skip-belt-color, var(--belt-color)) 15%, transparent);
}

[data-theme="mist"] .player .belt-header-skip:hover:not(:disabled) {
  background: color-mix(in srgb, var(--skip-belt-color, var(--belt-color)) 20%, #F2F0ED);
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.1),
              0 0 10px color-mix(in srgb, var(--skip-belt-color, var(--belt-color)) 25%, transparent);
}

[data-theme="mist"] .player .belt-header-skip:disabled {
  background: rgba(122, 110, 98, 0.06);
  border-color: rgba(122, 110, 98, 0.1);
  color: rgba(122, 110, 98, 0.3);
  box-shadow: none;
}

/* --- Mode / Transport buttons --- */
[data-theme="mist"] .player .mode-btn,
[data-theme="mist"] .player .transport-btn {
  background: rgba(122, 110, 98, 0.08);
  border-color: rgba(122, 110, 98, 0.12);
  color: #2C2622;
}

[data-theme="mist"] .player .mode-btn:hover,
[data-theme="mist"] .player .transport-btn:hover {
  background: rgba(122, 110, 98, 0.14);
}

[data-theme="mist"] .player .mode-btn.active {
  background: rgba(122, 110, 98, 0.16);
  color: #1A1614;
}

[data-theme="mist"] .player .mode-picker {
  background: #F2F0ED;
  border: 1.5px solid rgba(122, 110, 98, 0.2);
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.1),
              0 4px 12px rgba(44, 38, 34, 0.08),
              0 12px 40px rgba(44, 38, 34, 0.07);
}

[data-theme="mist"] .player .mode-picker-option {
  background: rgba(122, 110, 98, 0.07);
  border-color: rgba(122, 110, 98, 0.12);
  color: #1A1614;
}

/* --- Brain Network overrides → Ink tones --- */
[data-theme="mist"] .player .brain-network-container .network-link {
  stroke: rgba(122, 110, 98, 0.15);
}

[data-theme="mist"] .player .brain-network-container .network-label {
  fill: rgba(26, 22, 20, 0.5);
}

[data-theme="mist"] .player .brain-network-container .network-label.visible {
  fill: rgba(26, 22, 20, 0.7);
}

[data-theme="mist"] .player .brain-network-container .network-label.active {
  fill: #1A1614;
  filter: none;
  text-shadow: none;
}

[data-theme="mist"] .player .brain-network-container .network-node.hero {
  animation: mist-node-pulse 2s ease-in-out infinite;
}

@keyframes mist-node-pulse {
  0%, 100% {
    filter: drop-shadow(0 0 6px rgba(44, 38, 34, 0.25));
    transform: scale(1);
  }
  50% {
    filter: drop-shadow(0 0 14px rgba(44, 38, 34, 0.4));
    transform: scale(1.1);
  }
}

/* --- Belt celebration overlay --- */
[data-theme="mist"] .player .belt-celebration-overlay {
  background: rgba(26, 22, 20, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* --- Belt particles → Shuriken burst --- */
[data-theme="mist"] .player .belt-particle {
  clip-path: polygon(50% 0%, 65% 35%, 100% 50%, 65% 65%, 50% 100%, 35% 65%, 0% 50%, 35% 35%);
  border-radius: 0;
}

/* --- Ink spirit rewards --- */
[data-theme="mist"] .player .ink-spirit-reward {
  text-shadow: none;
}

[data-theme="mist"] .player .ink-spirit-reward .ink-word {
  color: #1A1614;
}

/* --- Learning hint box → Solid paper --- */
[data-theme="mist"] .player .learning-hint,
[data-theme="mist"] .player .learning-hint-box {
  background: #F2F0ED;
  border: 1.5px solid rgba(122, 110, 98, 0.2);
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.1),
              0 4px 12px rgba(44, 38, 34, 0.08);
  color: #2C2622;
}

[data-theme="mist"] .player .learning-hint-box .hint-text {
  color: #2C2622;
}

/* --- Component breakdown tiles → Paper style --- */
[data-theme="mist"] .player .component-tile {
  background: #F2F0ED;
  border-color: rgba(122, 110, 98, 0.2);
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.08);
}

[data-theme="mist"] .player .component-tile-target {
  color: color-mix(in srgb, var(--belt-color) 70%, #1A1614);
}

[data-theme="mist"] .player .component-tile-known {
  color: #7A6E62;
}

[data-theme="mist"] .player .component-plus {
  color: #A89C8E;
}
</style>
