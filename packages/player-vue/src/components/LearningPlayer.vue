<script setup>
import { ref, computed, onMounted, onUnmounted, watch, shallowRef, inject } from 'vue'
import {
  CycleOrchestrator,
  AudioController,
  CyclePhase,
  DEFAULT_CONFIG,
  createVoiceActivityDetector,
  createSpeechTimingAnalyzer,
} from '@ssi/core'
import SessionComplete from './SessionComplete.vue'
import OnboardingTooltips from './OnboardingTooltips.vue'
import ReportIssueButton from './ReportIssueButton.vue'
// AwakeningLoader removed - loading state now shown inline in player
import { useLearningSession } from '../composables/useLearningSession'
import { useScriptCache, setCachedScript } from '../composables/useScriptCache'
import { generateLearningScript } from '../providers/CourseDataProvider'

const emit = defineEmits(['close'])

const props = defineProps({
  classContext: {
    type: Object,
    default: null
  },
  course: {
    type: Object,
    default: null
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

// Get course code from prop, falling back to Chinese course (has full data)
const courseCode = computed(() => props.course?.course_code || 'zho_for_eng')

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

// Course welcome from cached script (plays once on first visit)
const cachedCourseWelcome = ref(null)

// Are we using round-based playback?
const useRoundBasedPlayback = computed(() => cachedRounds.value.length > 0)

// Current round
const currentRound = computed(() =>
  useRoundBasedPlayback.value ? cachedRounds.value[currentRoundIndex.value] : null
)

// Audio base URL for S3
const AUDIO_S3_BASE_URL = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered'

/**
 * Convert a ScriptItem to a playable item for the orchestrator.
 * Uses lazy audio lookup from the audioMap cache.
 */
const scriptItemToPlayableItem = async (scriptItem) => {
  if (!scriptItem) return null

  // Look up audio URLs from cache (lazy loaded)
  const knownAudioUrl = await getAudioUrlFromCache(
    supabase?.value,
    scriptItem.knownText,
    'known',
    scriptItem.type === 'intro' ? scriptItem : null,
    AUDIO_S3_BASE_URL
  )

  const target1AudioUrl = await getAudioUrlFromCache(
    supabase?.value,
    scriptItem.targetText,
    'target1',
    null,
    AUDIO_S3_BASE_URL
  )

  const target2AudioUrl = await getAudioUrlFromCache(
    supabase?.value,
    scriptItem.targetText,
    'target2',
    null,
    AUDIO_S3_BASE_URL
  )

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

// ============================================
// BELT PROGRESSION SYSTEM
// Parametrized martial arts progression
// ============================================

const BELT_CONFIG = {
  totalSeeds: 668,

  // Belt thresholds - seeds required to ACHIEVE each belt
  // Early belts come quickly for motivation
  belts: [
    { name: 'white',   seedsRequired: 0,   color: '#f5f5f5', colorDark: '#e0e0e0', glow: 'rgba(245, 245, 245, 0.3)' },
    { name: 'yellow',  seedsRequired: 8,   color: '#fcd34d', colorDark: '#f59e0b', glow: 'rgba(252, 211, 77, 0.4)' },
    { name: 'orange',  seedsRequired: 20,  color: '#fb923c', colorDark: '#ea580c', glow: 'rgba(251, 146, 60, 0.4)' },
    { name: 'green',   seedsRequired: 40,  color: '#4ade80', colorDark: '#16a34a', glow: 'rgba(74, 222, 128, 0.4)' },
    { name: 'blue',    seedsRequired: 80,  color: '#60a5fa', colorDark: '#2563eb', glow: 'rgba(96, 165, 250, 0.4)' },
    { name: 'purple',  seedsRequired: 150, color: '#a78bfa', colorDark: '#7c3aed', glow: 'rgba(167, 139, 250, 0.4)' },
    { name: 'brown',   seedsRequired: 280, color: '#a8856c', colorDark: '#78350f', glow: 'rgba(168, 133, 108, 0.4)' },
    { name: 'black',   seedsRequired: 400, color: '#1f1f1f', colorDark: '#0a0a0a', glow: 'rgba(255, 255, 255, 0.15)' },
  ]
}

// Simulated completed seeds (in real app, this comes from user state)
const completedSeeds = ref(42) // Demo: Green belt territory

// Belt computations
const currentBelt = computed(() => {
  const belts = BELT_CONFIG.belts
  for (let i = belts.length - 1; i >= 0; i--) {
    if (completedSeeds.value >= belts[i].seedsRequired) {
      return { ...belts[i], index: i }
    }
  }
  return { ...belts[0], index: 0 }
})

const nextBelt = computed(() => {
  const nextIndex = currentBelt.value.index + 1
  if (nextIndex >= BELT_CONFIG.belts.length) return null
  return BELT_CONFIG.belts[nextIndex]
})

const beltProgress = computed(() => {
  if (!nextBelt.value) return 100 // Already at black belt
  const current = currentBelt.value.seedsRequired
  const next = nextBelt.value.seedsRequired
  const progress = (completedSeeds.value - current) / (next - current)
  return Math.min(Math.max(progress * 100, 0), 100)
})

// CSS custom properties for belt theming
const beltCssVars = computed(() => ({
  '--belt-color': currentBelt.value.color,
  '--belt-color-dark': currentBelt.value.colorDark,
  '--belt-glow': currentBelt.value.glow,
}))

// ============================================
// ROUND BOUNDARY INTERRUPTIONS
// Belt promotions, encouragements, break suggestions
// ============================================

// Track rounds completed in this session (for break suggestions)
const roundsThisSession = ref(0)
const previousBeltIndex = ref(0)
const showBreakSuggestion = ref(false)
const beltJustEarned = ref(null)

// Handle round boundary - called when a round completes
const handleRoundBoundary = async (completedRoundIndex, completedLegoId) => {
  roundsThisSession.value++

  // Track previous belt for promotion detection
  const oldBeltIndex = currentBelt.value.index
  previousBeltIndex.value = oldBeltIndex

  // Update completed seeds based on round (each round = ~1 seed progress)
  // In production this would come from actual progress tracking
  completedSeeds.value = Math.min(completedSeeds.value + 1, BELT_CONFIG.totalSeeds)

  // Check for belt promotion
  const newBeltIndex = currentBelt.value.index
  if (newBeltIndex > oldBeltIndex) {
    beltJustEarned.value = currentBelt.value
    console.log('[LearningPlayer] 🥋 Belt promotion!', currentBelt.value.name)
    // Play celebration sound and show animation
    triggerRewardAnimation(100, 5) // Max bonus for belt promotion
    // Belt promotion animation will show via beltJustEarned reactive state
    setTimeout(() => {
      beltJustEarned.value = null
    }, 4000)
  }

  // Show encouragement every 3-5 rounds (random to feel natural)
  const encouragementInterval = 3 + Math.floor(Math.random() * 3) // 3, 4, or 5
  if (roundsThisSession.value % encouragementInterval === 0 && !beltJustEarned.value) {
    // Trigger encouragement animation
    triggerRewardAnimation(25, Math.min(roundsThisSession.value / 3, 4))
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
const theme = ref('dark')
const currentPhase = ref(Phase.PROMPT)
const currentItemIndex = ref(0)
const isPlaying = ref(false) // Start paused until engine ready
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

// Single loading message - simple and quick
const LOADING_MESSAGE = 'preparing your session'

// Transition to next loading stage
const setLoadingStage = (stage) => {
  console.log('[LearningPlayer] Loading stage:', stage)
  loadingStage.value = stage

  // Start typing on first stage only
  if (stage === 'awakening') {
    typeLoadingMessage(LOADING_MESSAGE)
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

// Welcome audio state (plays once on first course load)
const welcomeChecked = ref(false) // True after we've checked welcome status
const isPlayingWelcome = ref(false) // True when welcome audio is playing
const showWelcomeSkip = ref(false) // Show skip button during welcome

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
const currentPhrase = computed(() => ({
  known: currentItem.value?.phrase?.phrase?.known || '',
  target: currentItem.value?.phrase?.phrase?.target || '',
}))
const sessionProgress = computed(() => {
  if (useRoundBasedPlayback.value && cachedRounds.value.length > 0) {
    // Total items across all rounds
    const totalItems = cachedRounds.value.reduce((sum, r) => sum + (r.items?.length || 0), 0)
    return (itemsPracticed.value + 1) / totalItems
  }
  return (itemsPracticed.value + 1) / sessionItems.value.length
})
const showTargetText = computed(() => currentPhase.value === Phase.VOICE_2)

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

// Theme toggle
const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme.value)
  localStorage.setItem('ssi-theme', theme.value)
}

// ============================================
// REAL AUDIO CONTROLLER
// Plays actual MP3 audio from S3
// ============================================

class RealAudioController {
  constructor() {
    this.endedCallbacks = new Set()
    this.audio = null  // Single reusable Audio element for mobile compatibility
    this.currentCleanup = null
    this.preloadedUrls = new Set()
    this.skipNextNotify = false  // Set true to skip orchestrator callbacks (for intro/welcome)
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

    return new Promise((resolve) => {
      // Reuse or create Audio element - reusing helps with mobile autoplay
      if (!this.audio) {
        this.audio = new Audio()
      }

      const onEnded = () => {
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
        this.currentCleanup = null
        this._notifyEnded()
        resolve()
      }

      const onError = (e) => {
        console.error('[AudioController] Error playing:', url, e)
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
        this.currentCleanup = null
        // On error, still notify so cycle can continue
        this._notifyEnded()
        resolve()
      }

      // Remove any stale listeners first
      this.audio.removeEventListener('ended', this._lastEndedHandler)
      this.audio.removeEventListener('error', this._lastErrorHandler)

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

  stop() {
    if (this.currentCleanup) {
      this.currentCleanup()
      this.currentCleanup = null
    }
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
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
      // Mark phase transitions for timing analyzer (if adaptation enabled)
      if (isAdaptationActive.value) {
        // Map CyclePhase to timing phases
        switch (event.phase) {
          case CyclePhase.PAUSE:
            markPhaseTransition('PROMPT_END')
            markPhaseTransition('PAUSE')
            break
          case CyclePhase.VOICE_1:
            markPhaseTransition('VOICE_1')
            break
          case CyclePhase.VOICE_2:
            markPhaseTransition('VOICE_2')
            break
          case CyclePhase.PROMPT:
            // New PROMPT = new cycle, start timing
            if (timingAnalyzer.value?.isAnalyzing()) {
              // End previous cycle if still active (shouldn't happen normally)
              const item = currentItem.value
              const modelDuration = item?.audioDurations?.target1 ? item.audioDurations.target1 * 1000 : 2000
              endTimingCycle(modelDuration)
            }
            startTimingCycle()
            break
        }
      }
      currentPhase.value = corePhaseToUiPhase(event.phase)
      break

    case 'pause_started':
      // Start the ring animation for the SPEAK phase
      startRingAnimation(event.data?.duration)
      break

    case 'item_completed':
      itemsPracticed.value++

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

      // Trigger floating reward animation (Ink Spirit)
      const { points, bonusLevel } = calculateCyclePoints()
      sessionPoints.value += points
      triggerRewardAnimation(points, bonusLevel)

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

        // Start next item after short delay
        setTimeout(async () => {
          if (isPlaying.value && orchestrator.value) {
            // INTRO items: play introduction audio directly, then advance
            // NOTE: Some courses (e.g., Spanish) have target voices baked into intro audio,
            // so we skip the DEBUT item that follows to avoid repeating the same audio.
            if (nextScriptItem.type === 'intro') {
              console.log('[LearningPlayer] Playing INTRO item for:', nextScriptItem.legoId)
              const nextPlayable = await scriptItemToPlayableItem(nextScriptItem)
              if (nextPlayable) {
                currentPlayableItem.value = nextPlayable
                // Play intro audio and wait for completion
                const introPlayed = await playIntroductionAudioDirectly(nextScriptItem.legoId)
                if (introPlayed) {
                  console.log('[LearningPlayer] INTRO complete, advancing to next item')
                }
                // Advance to next item in round
                currentItemInRound.value++
                // Trigger next item by emitting a fake completion
                if (isPlaying.value) {
                  handleCycleEvent({ type: 'item_completed' })
                }
              }
              return
            }

            const nextPlayable = await scriptItemToPlayableItem(nextScriptItem)
            if (nextPlayable) {
              // Update pause duration: 1.5s boot up + target1 duration
              if (!turboActive.value && nextPlayable.audioDurations) {
                const pauseMs = 1500 + Math.round(nextPlayable.audioDurations.target1 * 1000)
                orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
              }
              // Store for currentItem computed
              currentPlayableItem.value = nextPlayable
              orchestrator.value.startItem(nextPlayable)
            }
          }
        }, 300)
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
        if (!turboActive.value && nextItem?.audioDurations) {
          const pauseMs = 1500 + Math.round(nextItem.audioDurations.target1 * 1000)
          orchestrator.value?.updateConfig({ pause_duration_ms: pauseMs })
        }

        // Start next item (with introduction if needed)
        setTimeout(async () => {
          if (isPlaying.value && orchestrator.value) {
            // Check if next LEGO needs an introduction first
            await playIntroductionIfNeeded(nextItem)
            // Then start the practice cycles
            if (isPlaying.value) {
              orchestrator.value.startItem(nextItem)
            }
          }
        }, 300)
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

const handlePause = () => {
  isPlaying.value = false
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
        console.log('[LearningPlayer] Introduction complete for LEGO:', legoId)
        resolve(true)
      }

      const onError = (e) => {
        console.error('[LearningPlayer] Introduction audio error:', e)
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        isPlayingIntroduction.value = false
        introductionPhase.value = false
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
 * Play introduction audio directly for a LEGO (for script-based playback).
 * Unlike playIntroductionIfNeeded, this doesn't check if the LEGO is "new" -
 * it just plays the intro audio for the given legoId.
 */
const playIntroductionAudioDirectly = async (legoId) => {
  console.log('[LearningPlayer] playIntroductionAudioDirectly for:', legoId)

  // Skip if already played this session
  if (playedIntroductions.value.has(legoId)) {
    console.log('[LearningPlayer] Intro already played this session for:', legoId)
    return false
  }

  // Get intro audio from cache or database
  if (!courseDataProvider.value) {
    console.log('[LearningPlayer] No courseDataProvider')
    return false
  }

  try {
    const introAudio = await courseDataProvider.value.getIntroductionAudio(legoId)
    console.log('[LearningPlayer] Intro audio for', legoId, ':', introAudio)

    if (!introAudio || !introAudio.url) {
      console.log('[LearningPlayer] No intro audio found for:', legoId)
      return false
    }

    // Mark as playing intro
    isPlayingIntroduction.value = true
    introductionPhase.value = true
    playedIntroductions.value.add(legoId)

    console.log('[LearningPlayer] Playing introduction audio:', introAudio.url)

    // Play intro using shared audio element (for mobile compatibility)
    // Set skipNextNotify to prevent orchestrator callbacks from firing when intro ends
    return new Promise((resolve) => {
      audioController.value?.stop()

      // Tell audioController to skip notifying orchestrator when this audio ends
      if (audioController.value) {
        audioController.value.skipNextNotify = true
      }

      const audio = audioController.value?.audio || new Audio()
      introAudioElement = audio // Store for skip functionality

      const onEnded = () => {
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        isPlayingIntroduction.value = false
        introductionPhase.value = false
        introAudioElement = null
        console.log('[LearningPlayer] Introduction complete for:', legoId)
        resolve(true)
      }

      const onError = (e) => {
        console.error('[LearningPlayer] Introduction audio error:', e)
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        isPlayingIntroduction.value = false
        introductionPhase.value = false
        introAudioElement = null
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
    console.error('[LearningPlayer] Error playing introduction:', err)
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
    if (cachedCourseWelcome.value && cachedCourseWelcome.value.id) {
      const welcomeId = cachedCourseWelcome.value.id
      const audioUrl = `${AUDIO_S3_BASE_URL}/${welcomeId.toUpperCase()}.mp3`
      welcomeAudio = {
        id: welcomeId,
        url: audioUrl,
        duration_ms: cachedCourseWelcome.value.duration
          ? cachedCourseWelcome.value.duration * 1000
          : null,
      }
      console.log('[LearningPlayer] Using cached course welcome:', welcomeId)
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
    introAudioElement.pause()
    introAudioElement.currentTime = 0
  }
  isPlayingIntroduction.value = false
  introductionPhase.value = false
  introAudioElement = null
  console.log('[LearningPlayer] Introduction skipped')
}

const startPlayback = async () => {
  isPlaying.value = true

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

    // INTRO items: play intro audio directly, then advance to next item
    if (scriptItem.type === 'intro') {
      console.log('[LearningPlayer] First item is INTRO for:', scriptItem.legoId)
      const playableItem = await scriptItemToPlayableItem(scriptItem)
      if (playableItem) {
        currentPlayableItem.value = playableItem
        // Play intro audio and wait for completion
        await playIntroductionAudioDirectly(scriptItem.legoId)
        // Advance to next item in round
        currentItemInRound.value++
        // Continue with next item
        if (isPlaying.value) {
          handleCycleEvent({ type: 'item_completed' })
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
    if (!turboActive.value && playableItem.audioDurations) {
      const pauseMs = 1500 + Math.round(playableItem.audioDurations.target1 * 1000)
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
    if (!turboActive.value && currentItem.value.audioDurations) {
      const pauseMs = 1500 + Math.round(currentItem.value.audioDurations.target1 * 1000)
      orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
    }
    orchestrator.value.startItem(currentItem.value)
  }
}

const handleSkip = () => {
  // Skip intro audio if playing
  if (isPlayingIntroduction.value) {
    skipIntroduction()
    return
  }
  // Otherwise skip current orchestrator phase
  if (orchestrator.value) {
    orchestrator.value.skipPhase()
  }
}

const handleRevisit = () => {
  // Restart current item from beginning
  ringProgressRaw.value = 0
  if (orchestrator.value && currentItem.value) {
    orchestrator.value.startItem(currentItem.value)
  }
}

// Mode toggles
const turboActive = ref(false)
const listeningModeComingSoon = ref(false) // Future: passive listening mode

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
  // Update orchestrator config for faster timings
  if (orchestrator.value) {
    if (turboActive.value) {
      // Turbo mode: fixed 2s pause
      orchestrator.value.updateConfig({ pause_duration_ms: 2000 })
    } else {
      // Normal mode: 1.5s boot up + target1 duration
      const item = currentItem.value
      const pauseMs = item?.audioDurations
        ? 1500 + Math.round(item.audioDurations.target1 * 1000)
        : 5000 // Fallback
      orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
    }
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

  // Increment session count for guests (triggers signup prompt)
  if (auth && itemsPracticed.value > 0) {
    auth.incrementSessionCount()
  }
}

const handleResumeLearning = async () => {
  // Hide summary and continue the infinite stream
  showSessionComplete.value = false
  isPlaying.value = true
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
  emit('close')
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
  const savedTheme = localStorage.getItem('ssi-theme') || 'dark'
  theme.value = savedTheme
  document.documentElement.setAttribute('data-theme', savedTheme)
  audioController.value = new RealAudioController()
  currentCourseCode.value = courseCode.value

  // Track data loading state
  let dataReady = false
  let cachedScript = null

  // ============================================
  // PARALLEL TASK 1: Load all data
  // ============================================
  const loadAllData = async () => {
    try {
      // Load cache first (needed for other operations)
      cachedScript = await getCachedScript(courseCode.value)

      if (cachedScript) {
        console.log('[LearningPlayer] Found cached script with', cachedScript.rounds.length, 'rounds')
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

        // Task: Load saved progress
        parallelTasks.push(
          loadSavedProgress().then(savedProgress => {
            if (savedProgress?.lastCompletedRoundIndex !== null) {
              const resumeIndex = savedProgress.lastCompletedRoundIndex + 1
              if (resumeIndex < cachedScript.rounds.length) {
                currentRoundIndex.value = resumeIndex
                console.log('[LearningPlayer] Resuming from round', resumeIndex)
              } else {
                console.log('[LearningPlayer] All rounds completed, starting fresh')
                currentRoundIndex.value = 0
              }
            }
          }).catch(() => {})
        )

        // Task: Preload intro audio for first 5 LEGOs
        if (supabase?.value) {
          const legoIds = new Set(
            cachedRounds.value.slice(0, 5).map(r => r.legoId).filter(Boolean)
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
      } else if (courseDataProvider.value && supabase?.value) {
        // ============================================
        // GENERATE NEW SCRIPT (cache was empty)
        // ============================================
        console.log('[LearningPlayer] No cached script, generating new one...')

        try {
          const { rounds, allItems } = await generateLearningScript(
            courseDataProvider.value,
            supabase.value,
            courseCode.value,
            AUDIO_S3_BASE_URL,
            50, // maxLegos
            0   // offset
          )

          if (rounds.length > 0) {
            console.log('[LearningPlayer] Generated script with', rounds.length, 'rounds')
            cachedRounds.value = rounds

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
            })

            console.log('[LearningPlayer] Cached script for future use')

            // Preload intro audio for first 5 LEGOs
            const legoIds = new Set(
              rounds.slice(0, 5).map(r => r.legoId).filter(Boolean)
            )
            if (legoIds.size > 0) {
              await loadIntroAudio(supabase.value, courseCode.value, legoIds, audioMap.value)
            }
          }
        } catch (genErr) {
          console.warn('[LearningPlayer] Script generation failed:', genErr)
          // Will fall back to session-based progression
        }
      }
    } catch (err) {
      console.warn('[LearningPlayer] Data load error:', err)
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
      transition_gap_ms: 300,
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

  // Don't auto-start - wait for user to click play
  isPlaying.value = false

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
      :belt-progress="beltProgress"
      :completed-seeds="completedSeeds"
      :next-belt="nextBelt"
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
        <div class="welcome-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2v20M2 12h20M12 2a10 10 0 0 1 10 10M12 2a10 10 0 0 0-10 10"/>
          </svg>
        </div>
        <p class="welcome-text">Welcome to your course</p>
        <button class="welcome-skip" @click="skipWelcome">
          Skip intro
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

      <!-- Belt Indicator - Zen Style -->
      <div class="belt-indicator">
        <div class="belt-knot">
          <svg viewBox="0 0 32 16" class="belt-svg">
            <!-- Belt fabric -->
            <rect x="0" y="5" width="32" height="6" rx="1" class="belt-fabric"/>
            <!-- Knot center -->
            <circle cx="16" cy="8" r="4" class="belt-knot-center"/>
            <!-- Belt tails -->
            <path d="M12 8 L8 14 L6 14" class="belt-tail" />
            <path d="M20 8 L24 14 L26 14" class="belt-tail" />
          </svg>
        </div>
        <div class="belt-progress-ring">
          <svg viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" class="belt-progress-track" />
            <circle
              cx="18" cy="18" r="15"
              class="belt-progress-fill"
              :stroke-dasharray="94.25"
              :stroke-dashoffset="94.25 - (beltProgress / 100) * 94.25"
              transform="rotate(-90 18 18)"
            />
          </svg>
          <span class="belt-seed-count">{{ completedSeeds }}</span>
        </div>
      </div>

      <div class="header-right">
        <button class="session-timer" @click="showPausedSummary" title="Pause &amp; Summary">
          <span class="timer-value">{{ formattedSessionTime }}</span>
          <svg class="timer-end-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="6" width="12" height="12" rx="1"/>
          </svg>
        </button>

        <button class="theme-toggle" @click="toggleTheme">
          <div class="toggle-track">
            <div class="toggle-thumb" :class="{ light: theme === 'light' }"></div>
          </div>
        </button>
      </div>
    </header>

    <!-- Main Content - Fixed Layout -->
    <main class="main">
      <!-- 4-Phase Indicator: Speaker → Mic → Ear → Eye -->
      <div class="phase-dots">
        <div
          v-for="(phase, idx) in ['prompt', 'speak', 'voice_1', 'voice_2']"
          :key="phase"
          class="phase-dot"
          :class="{
            active: currentPhase === phase,
            complete: Object.values(Phase).indexOf(currentPhase) > idx
          }"
        >
          <!-- Phase 1: Speaker (playing audio) -->
          <svg v-if="idx === 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
          <!-- Phase 2: Mic (learner speaking) -->
          <svg v-else-if="idx === 1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <!-- Phase 3: Ear (listening to answer) -->
          <svg v-else-if="idx === 2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10.5"/>
            <circle cx="12" cy="22" r="1" fill="currentColor"/>
          </svg>
          <!-- Phase 4: Eye (see and hear) -->
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
      </div>

      <!-- Known Language Text - Fixed Height -->
      <div class="text-zone text-zone--known">
        <transition name="text-fade" mode="out-in">
          <!-- Loading message when awakening -->
          <p v-if="isAwakening" class="known-text loading-text" key="loading">
            {{ currentLoadingMessage }}<span class="loading-cursor">▌</span>
          </p>
          <!-- Normal known text -->
          <p v-else class="known-text" :key="currentPhrase.known">
            {{ currentPhrase.known }}
          </p>
        </transition>
      </div>

      <!-- Central Ring - Tap to Stop/Play -->
      <div
        class="ring-container"
        @click="handleRingTap"
        :class="{
          'is-speak': currentPhase === Phase.SPEAK,
          'is-paused': !isPlaying
        }"
      >
        <!-- Ambient glow -->
        <div class="ring-ambient"></div>

        <!-- SVG Ring -->
        <svg class="ring-svg" viewBox="0 0 200 200">
          <!-- Background track -->
          <circle
            class="ring-track"
            cx="100" cy="100" r="90"
            fill="none"
            stroke-width="4"
          />
          <!-- Progress arc - smooth continuous -->
          <circle
            class="ring-progress"
            cx="100" cy="100" r="90"
            fill="none"
            stroke-width="4"
            :stroke-dasharray="565.48"
            :stroke-dashoffset="565.48 - (ringProgress / 100) * 565.48"
            transform="rotate(-90 100 100)"
          />
          <!-- Inner decorative ring -->
          <circle
            class="ring-inner"
            cx="100" cy="100" r="78"
            fill="none"
            stroke-width="1"
          />
        </svg>

        <!-- Center content -->
        <div class="ring-center" :class="{ 'is-loading': isAwakening }">
          <!-- Play button - fades in when ready -->
          <div v-if="!isPlaying" class="play-indicator" :class="{ 'fade-in': !isAwakening }">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21 6 3"/>
            </svg>
          </div>
          <!-- Phase icon when playing -->
          <div v-else class="phase-icon" :class="currentPhase">
            <!-- Speaker (Phase 1: Hear prompt) -->
            <svg v-if="phaseInfo.icon === 'speaker'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
            <!-- Mic (Phase 2: Learner speaks) -->
            <svg v-else-if="phaseInfo.icon === 'mic'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            <!-- Ear (Phase 3: Listen to answer) -->
            <svg v-else-if="phaseInfo.icon === 'ear'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10.5"/>
              <circle cx="12" cy="22" r="1" fill="currentColor"/>
            </svg>
            <!-- Eye (Phase 4: See and hear) -->
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
        </div>

        <!-- Phase label below -->
        <div class="ring-label">{{ phaseInfo.instruction }}</div>

        <!-- Ink Spirit Rewards - Float upward like incense -->
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
      </div>

      <!-- Target Language Text - Fixed Height (Always Reserved) -->
      <div class="text-zone text-zone--target">
        <transition name="text-reveal" mode="out-in">
          <p v-if="showTargetText" class="target-text" :key="currentPhrase.target">
            {{ currentPhrase.target }}
          </p>
          <p v-else class="target-placeholder" key="placeholder">&nbsp;</p>
        </transition>
      </div>
    </main>

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
      <div v-if="beltJustEarned" class="belt-celebration-overlay">
        <div class="belt-celebration-card">
          <div class="belt-celebration-glow" :style="{ '--belt-glow-color': beltJustEarned.color }"></div>
          <div class="belt-icon-large" :style="{ background: beltJustEarned.color }">🥋</div>
          <h2 class="belt-title">New Belt Earned!</h2>
          <p class="belt-name" :style="{ color: beltJustEarned.color }">
            {{ beltJustEarned.name.charAt(0).toUpperCase() + beltJustEarned.name.slice(1) }} Belt
          </p>
          <p class="belt-seeds">{{ completedSeeds }} seeds mastered</p>
        </div>
      </div>
    </Transition>

    <!-- Control Bar -->
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

    <!-- First-time onboarding tooltips -->
    <OnboardingTooltips />
  </div>
</template>

<style scoped>
/* ============================================
   SSi Learning Player - Zen Sanctuary Edition
   Refined minimalism, premium feel
   ============================================ */

@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Noto+Serif+SC:wght@600&family=Noto+Serif:wght@500&display=swap');

.player {
  --accent: #c23a3a;
  --accent-soft: rgba(194, 58, 58, 0.15);
  --accent-glow: rgba(194, 58, 58, 0.4);
  --gold: #d4a853;
  --gold-soft: rgba(212, 168, 83, 0.15);
  --success: #22c55e;

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
.nebula-glow {
  position: fixed;
  inset: 0;
  background: radial-gradient(
    ellipse 80% 60% at 50% 70%,
    var(--belt-glow, rgba(194, 58, 58, 0.08)) 0%,
    transparent 50%
  );
  pointer-events: none;
  z-index: 1;
  opacity: 0.6;
  transition: background 1s ease;
}

/* Light theme adjustments for space elements */
[data-theme="light"] .space-gradient {
  background:
    radial-gradient(ellipse 120% 80% at 20% 10%, rgba(200, 190, 220, 0.4) 0%, transparent 50%),
    radial-gradient(ellipse 100% 60% at 80% 90%, rgba(180, 200, 220, 0.3) 0%, transparent 40%),
    radial-gradient(ellipse 80% 80% at 50% 50%, rgba(250, 248, 252, 1) 0%, #f5f3f8 100%);
}

[data-theme="light"] .space-nebula {
  background:
    radial-gradient(ellipse 60% 40% at 30% 30%, rgba(160, 140, 200, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse 50% 30% at 70% 60%, rgba(140, 160, 200, 0.06) 0%, transparent 40%);
}

[data-theme="light"] .star {
  background: rgba(100, 80, 120, 0.4);
}

[data-theme="light"] .drift-star {
  background: var(--belt-color);
  opacity: 0.4;
}

[data-theme="light"] .nebula-glow {
  opacity: 0.3;
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
  padding: 1rem 1.5rem;
  gap: 0.75rem;
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

/* ============ BELT INDICATOR ============ */
.belt-indicator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.375rem 0.75rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 100px;
  transition: all 0.3s ease;
}

.belt-knot {
  width: 32px;
  height: 16px;
}

.belt-svg {
  width: 100%;
  height: 100%;
}

.belt-fabric {
  fill: var(--belt-color);
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2));
  transition: fill 0.5s ease;
}

.belt-knot-center {
  fill: var(--belt-color-dark);
  transition: fill 0.5s ease;
}

.belt-tail {
  stroke: var(--belt-color);
  stroke-width: 2;
  stroke-linecap: round;
  fill: none;
  transition: stroke 0.5s ease;
}

/* Special styling for black belt - gold accents */
.belt-black .belt-knot-center {
  fill: #d4a853;
}

.belt-progress-ring {
  position: relative;
  width: 36px;
  height: 36px;
}

.belt-progress-ring svg {
  width: 100%;
  height: 100%;
}

.belt-progress-track {
  fill: none;
  stroke: var(--border-medium);
  stroke-width: 3;
}

.belt-progress-fill {
  fill: none;
  stroke: var(--belt-color);
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.5s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.5s ease;
  filter: drop-shadow(0 0 4px var(--belt-glow));
}

.belt-seed-count {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Space Mono', monospace;
  font-size: 0.625rem;
  font-weight: 700;
  color: var(--text-secondary);
}

/* ============ MAIN - FIXED LAYOUT ============ */
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

/* 4-Phase Dots */
.phase-dots {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.phase-dot {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 2px solid var(--border-medium);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.phase-dot svg {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  transition: all 0.3s ease;
}

.phase-dot.active {
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 0 20px var(--accent-glow);
}

.phase-dot.active svg {
  color: white;
}

.phase-dot.complete {
  background: var(--success);
  border-color: var(--success);
}

.phase-dot.complete svg {
  color: white;
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

/* ============ RING - THE HERO ============ */
.ring-container {
  position: relative;
  width: 200px;
  height: 200px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.ring-container:hover {
  transform: scale(1.02);
}

.ring-container:active {
  transform: scale(0.98);
}

.ring-ambient {
  position: absolute;
  inset: -40px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.5s ease;
}

/* Moonlight glow - always subtly present */
.ring-container::before {
  content: '';
  position: absolute;
  inset: -60px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 60%);
  animation: moonlight-pulse 8s ease-in-out infinite;
  pointer-events: none;
}

@keyframes moonlight-pulse {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.05); }
}

[data-theme="light"] .ring-container::before {
  background: radial-gradient(circle, rgba(212, 168, 83, 0.1) 0%, transparent 60%);
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
  filter: drop-shadow(0 4px 20px rgba(0,0,0,0.15));
}

.ring-track {
  stroke: var(--border-medium);
  opacity: 0.4;
}

.ring-progress {
  stroke: var(--accent);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.05s linear; /* Super smooth */
  filter: drop-shadow(0 0 8px var(--accent-glow));
}

.ring-inner {
  stroke: var(--border-subtle);
  opacity: 0.3;
}

.ring-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.ring-container.is-paused .ring-center {
  background: var(--accent);
  border-color: var(--accent);
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
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
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
  gap: 2rem;
  padding: 1rem 1.5rem 1.5rem;
  position: relative;
  z-index: 10;
}

.mode-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 1px solid var(--border-medium);
  background: var(--bg-card);
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

.transport-controls {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 100px;
}

.transport-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.transport-btn svg {
  width: 18px;
  height: 18px;
}

.transport-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  transform: scale(1.1);
}

/* Main Play/Stop Button - Prominent */
.transport-btn--main {
  width: 56px;
  height: 56px;
  background: var(--accent);
  color: white;
  border-radius: 50%;
  box-shadow: 0 4px 16px var(--accent-glow);
  transition: all 0.2s ease;
}

.transport-btn--main svg {
  width: 22px;
  height: 22px;
}

.transport-btn--main:hover {
  background: var(--accent);
  color: white;
  transform: scale(1.1);
  box-shadow: 0 6px 24px var(--accent-glow);
}

/* ============ FOOTER ============ */
.footer {
  padding: 0 1.5rem 1.5rem;
  position: relative;
  z-index: 10;
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

  .phase-dots {
    gap: 1.5rem;
  }

  .phase-dot {
    width: 44px;
    height: 44px;
  }

  .phase-dot svg {
    width: 20px;
    height: 20px;
  }
}

@media (max-width: 480px) {
  .header {
    padding: 0.75rem 1rem;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .brand {
    font-size: 1rem;
  }

  .belt-indicator {
    order: 3;
    width: 100%;
    justify-content: center;
    padding: 0.25rem 0.5rem;
    margin-top: 0.25rem;
  }

  .header-right {
    gap: 0.5rem;
  }

  .session-timer {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
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

  .phase-icon svg {
    width: 28px;
    height: 28px;
  }

  .play-indicator svg {
    width: 32px;
    height: 32px;
  }

  .ring-label {
    font-size: 0.75rem;
    bottom: -28px;
  }

  .text-zone {
    min-height: 60px;
  }

  .phase-dots {
    gap: 0.75rem;
  }

  .phase-dot {
    width: 32px;
    height: 32px;
  }

  .phase-dot svg {
    width: 14px;
    height: 14px;
  }

  .control-bar {
    gap: 1rem;
    padding: 0.75rem 1rem 1rem;
  }

  .mode-btn {
    width: 42px;
    height: 42px;
  }

  .transport-btn {
    width: 38px;
    height: 38px;
  }

  .transport-btn--main {
    width: 48px;
    height: 48px;
  }

  .transport-btn--main svg {
    width: 18px;
    height: 18px;
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

.belt-icon-large {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 3rem;
  margin: 0 auto 1.5rem;
  box-shadow: 0 0 40px rgba(255, 255, 255, 0.3);
  animation: belt-bounce 0.6s ease-out;
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

.belt-seeds {
  color: var(--text-secondary, rgba(245, 245, 245, 0.7));
  font-size: 1rem;
  margin: 0;
  animation: belt-title-in 0.5s ease-out 0.6s both;
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
