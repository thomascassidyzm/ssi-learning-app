<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, watchEffect, shallowRef, inject, nextTick, type PropType, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AudioController,
  CyclePhase,
  DEFAULT_CONFIG,
  createVoiceActivityDetector,
  createSpeechTimingAnalyzer,
  type ProgressStore,
  type SessionStore,
} from '@ssi/core'
import type { CourseDataProvider } from '../providers/CourseDataProvider'
import type { CourseInfo } from '../composables/useEntitlement'
import { useCyclePlayback } from '../composables/useCyclePlayback'
import { scriptItemToCycle } from '../utils/scriptItemToCycle'
import type { Cycle } from '../types/Cycle'
import SessionComplete from './SessionComplete.vue'
// OnboardingTooltips removed - deprecated
import ReportIssueButton from './ReportIssueButton.vue'
// AwakeningLoader removed - loading state now shown inline in player
import { useLearningSession } from '../composables/useLearningSession'
import { useScriptCache, setCachedScript } from '../composables/useScriptCache'
import { INITIAL_PRELOAD_SEEDS, LOOKAHEAD_CHUNK_SEEDS, LOOKAHEAD_TRIGGER_ROUNDS } from '../composables/useEagerScriptPreload'
import { useMetaCommentary } from '../composables/useMetaCommentary'
import { usePodLapScheduler, type PodLap, type PodPlay } from '../composables/usePodLapScheduler'
import { useSharedBeltProgress, getSeedFromLegoId, getBeltIndexForSeed, BELTS, type BeltProgressSyncConfig } from '../composables/useBeltProgress'
import { useBeltLoader, getBeltForSeed, BELT_RANGES, type BeltLoaderConfig } from '../composables/useBeltLoader'
import { useOfflinePlay } from '../composables/useOfflinePlay'
// SimplePlayer - clean playback engine
import { useSimplePlayer } from '../composables/useSimplePlayer'
import { useAdaptationEngine, type UseAdaptationEngineReturn } from '../composables/useAdaptationEngine'
import { useListeningProgress, type UseListeningProgressReturn } from '../composables/useListeningProgress'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import { usePairingsTelemetry } from '../composables/usePairingsTelemetry'
import { useAudioSessionKeepalive } from '../composables/useAudioSessionKeepalive'
import { usePlayerLog } from '../composables/usePlayerLog'
import type { ListeningConfig as ListeningConfigType } from '../providers/generateLearningScript'
// New simple script generation - direct database queries
import { generateLearningScript as generateSimpleScript, DEFAULT_LISTENING_CONFIG } from '../providers/generateLearningScript'
import { resolvePodActivationRound } from '../composables/usePodActivation'
import { toSimpleRounds, type TargetSpeedConfig } from '../providers/toSimpleRounds'
import { useAlgorithmConfig } from '../composables/useAlgorithmConfig'
import { computePauseDuration } from '../playback/computePauseDuration'
import { useAuthModal } from '../composables/useAuthModal'
import LegoAssembly from './LegoAssembly.vue'
import type { LegoBlock } from './LegoAssembly.vue'
import { ensureTileCoverage } from '../utils/ensureTileCoverage'
import { decomposePhrase } from '../utils/decomposePhrase'
import ListeningOverlay from './ListeningOverlay.vue'
import DrivingModeOverlay from './DrivingModeOverlay.vue'
import PronunciationOverlay from './PronunciationOverlay.vue'
import { useDrivingMode } from '../composables/useDrivingMode'
import { useScriptMode } from '../composables/useScriptMode'
import { getLanguageName, t } from '../composables/useI18n'
import { updateAvailable as pwaUpdateAvailable, userDismissed as pwaUserDismissed, applyUpdate as pwaApplyUpdate } from '../composables/usePwaUpdate'
import LanguageFlag from './schools/shared/LanguageFlag.vue'
import { simpleRoundToTypedCycles, audioIdsForSimpleRound, createChunkedPrefetch } from '../utils/drivingModeAdapter'
import ContributionCounter from './learner/ContributionCounter.vue'
import ProgressModal from './ProgressModal.vue'
import { useContribution } from '../composables/useContribution'
import { useEntitlement } from '../composables/useEntitlement'
import { useSharedUserEntitlements } from '../composables/useUserEntitlements'
import { PREMIUM_PREVIEW_MAX_SEED } from '@ssi/core'
import { useInstantPlayback } from '../composables/useInstantPlayback'
import { backendCyclesToRounds, infPlayCyclesToRounds } from '../providers/backendCyclesToRounds'
import type { Round as PlayerRound } from '../playback/SimplePlayer'
import { useCourseBundle } from '../composables/useCourseBundle'
import { getAudioCache } from '../cache/createAudioCache'
import { createAudioCacheSource, type AudioCacheSource } from '../cache/createAudioCacheSource'
import { createBundleDownloader, type BundleDownloader } from '../cache/BundleDownloader'
import { createAudioPrefetcher } from '../cache/AudioPrefetcher'
import { generateScript as generateBundleScript } from '../script/generateScript'

/**
 * Instant-playback feature flag — courses listed here use the new
 * `useInstantPlayback` composable (round-map + one-cycle cold start,
 * tier 1/2/3 prefetches during playback) instead of the legacy
 * upfront full-course load.
 *
 * Two routing controls:
 *   - INSTANT_PLAYBACK_ALL: wildcard — when true, every course uses the
 *     instant-playback path. Set to true on staging while we're soaking
 *     the new path across the whole catalogue.
 *   - INSTANT_PLAYBACK_COURSES: explicit allow-list, consulted only when
 *     INSTANT_PLAYBACK_ALL is false. Use this once we flip ALL back to
 *     false (e.g. for a cautious main-branch rollout one course at a time).
 *
 * Safety net: if the new path errors for any reason (round-map missing,
 * backend 500, etc.), LearningPlayer falls through to the legacy load —
 * see the try/catch around the bootstrap call in loadAllData. So flipping
 * INSTANT_PLAYBACK_ALL on doesn't risk breaking any course that lacks the
 * required round-map data; those just degrade silently to legacy.
 */
const INSTANT_PLAYBACK_ALL = true
const INSTANT_PLAYBACK_COURSES = new Set<string>([
  // Used only when INSTANT_PLAYBACK_ALL is false. Examples:
  //   'spa_for_eng', 'ell_for_eng', 'dan_for_eng', 'gle_for_eng',
])
function isInstantPlaybackCourse(courseCode: string): boolean {
  return INSTANT_PLAYBACK_ALL || INSTANT_PLAYBACK_COURSES.has(courseCode)
}

// ============================================================
// Bundle-based INF PLAY entry rollout flag
// ============================================================
// Mirrors the INSTANT_PLAYBACK rollout pattern above. When enabled
// for a course, the INF PLAY entry path uses the new client-side
// generateScript() + AudioCache + AudioPrefetcher pipeline instead
// of the legacy server-side /infplay-cycles + warm-up dance.
//
// Bundle load + BundleDownloader fire for ALL courses regardless —
// the downloader is polite enough now (concurrency=1, jitter,
// 429/503 backoff per BundleDownloader.ts) that it doesn't need a
// gate. Only the INF PLAY entry switches per course via this flag.
//
// Add a course code below to canary it. Leave empty + ALL=false to
// keep the new INF PLAY path dormant. Legacy INF PLAY path remains
// the safety net — the new path falls through to legacy if the
// bundle isn't loaded or generateScript returns no rounds.
const BUNDLE_BASED_INFPLAY_ALL = false
const BUNDLE_BASED_INFPLAY_COURSES = new Set<string>([
  // Add a single course here to canary, e.g. 'jpn_for_eng'.
])
function isBundleBasedInfplayCourse(courseCode: string): boolean {
  return BUNDLE_BASED_INFPLAY_ALL || BUNDLE_BASED_INFPLAY_COURSES.has(courseCode)
}

/**
 * Near-edge top-up threshold for the instant-playback path: when the
 * learner's current round is within this many rounds of the loaded
 * edge, fire tier-3 prefetch so the next batch lands before they hit
 * the end. Mirrors the legacy `LOOKAHEAD_TRIGGER_ROUNDS` knob but
 * applied to the round-map-driven loader instead of seed-range loads.
 */
const INSTANT_PLAYBACK_NEAR_EDGE_ROUNDS = 3

const emit = defineEmits(['close', 'playStateChanged', 'viewProgress', 'listeningModeChanged', 'drivingModeChanged', 'pronunciationModeChanged', 'cycle-started'])

const router = useRouter()

interface VoiceSettings {
  voiceId?: string
  settings?: { speed?: number }
}

interface TargetSpeedSettings {
  global_speed?: number
  intro_speed?: number
  first_review_speed?: number
  review_speed?: number
  ramp_seeds?: number
  ramp_start_speed?: number
  belt_ramp?: boolean
}

interface VoiceConfig {
  voices?: { target1?: VoiceSettings; target2?: VoiceSettings; known?: VoiceSettings }
  target1?: VoiceSettings
  target2?: VoiceSettings
  known?: VoiceSettings
  target_speed?: TargetSpeedSettings
}

interface PlayerCourse extends CourseInfo {
  variant_label?: string
  voice_config?: VoiceConfig
}

const props = defineProps({
  classContext: {
    type: Object,
    default: null
  },
  course: {
    type: Object as PropType<PlayerCourse | null>,
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

const progressStore = inject<Ref<ProgressStore | null>>('progressStore', ref(null))
const sessionStore = inject<Ref<SessionStore | null>>('sessionStore', ref(null))
const courseDataProvider = inject<Ref<CourseDataProvider | null>>('courseDataProvider', ref(null))
const supabase = inject('supabase', ref(null))
const auth = inject('auth', null)
const themeContext = inject('theme', null)
const eagerScript = inject<any>('eagerScript', null)

// Contribution counter - "Part of the Solution"
const contribution = useContribution(supabase as any)

// Unified progress modal — replaces the old split of
// showContributionExpanded (time/community stats) + showBeltModal
// (belt strip). Single ref, opened by either the contribution
// counter tap or the belt-pill tap.
const showProgressModal = ref(false)

// Algorithm config - admin-tweakable parameters (Turbo Boost, Normal mode pause, etc.)
const {
  loadConfigs: loadAlgorithmConfigs,
  turboConfig,
  normalConfig,
  listeningConfig,
  podsConfig,
  scriptShapeConfig,
  resumeConfig,
  isLoaded: algorithmConfigLoaded
} = useAlgorithmConfig(supabase)

/**
 * Wrapper for generateSimpleScript that threads the live algorithm_config
 * triple (listening, scriptShape, turbo cull) into every script-generation
 * call. Pass `listeningOverride` only when you need the per-learner pod
 * activation pin merged on top.
 */
const generateScript = (
  listeningOverride?: ListeningConfigType,
) => {
  if (!supabase?.value) {
    return Promise.reject(new Error('No supabase client'))
  }
  const tc = turboConfig.value
  // Pod activation default lives on PodsConfig (admin UI is in L2 section).
  // Merge it into the listening shape the generator consumes. Precedence:
  //   1. listeningOverride.podActivationRound (per-learner pin path)
  //   2. listeningConfig.value.podActivationRound (legacy `listening` row)
  //   3. podsConfig.value.podActivationRound (new primary home)
  //   4. hardcoded 6 (matches DEFAULT_POD_ACTIVATION elsewhere)
  const baseListening = listeningOverride || listeningConfig.value
  const podActivationRound =
    baseListening.podActivationRound ?? podsConfig.value.podActivationRound ?? 6
  const listening = { ...baseListening, podActivationRound }
  // Full-course one-shot generation. The script generator walks the
  // whole inventory; the player consumes from wherever its cursor is
  // (resume-by-lego-id). No seed-range chunking; no emit windowing.
  return generateSimpleScript(
    supabase.value,
    courseCode.value,
    50,  // infinitePlayLookahead — revival rounds after the main loop
    listening,
    scriptShapeConfig.value,
    { fibKeep: tc.fibKeep, buildKeep: tc.buildKeep, useKeep: tc.useKeep },
    // Persisted per-seed L1 fire counts — null on first session / pre-init
    // → cold start, every seed at Stage 1. After hydration this compounds
    // the Stage 1→4 progression across sessions.
    listeningProgress.value?.getFireCounts() ?? null,
    // Pod-lap firing cadence from the pods config — keeps the generator's
    // L1-outro merge decision in sync with the runtime scheduler.
    podsConfig.value.roundInterval ?? 1,
  )
}

// Auth modal for sign-in/sign-up prompts
const { open: openAuth } = useAuthModal()

// Network visualization removed — see archive/brain-views branch
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

// Instant-playback composable (flag-gated, see INSTANT_PLAYBACK_COURSES).
// Wires `last_completed_lego_id` from the enrollment row as the resume
// anchor — matches the resolution path used by the legacy eager-script
// load, so flipping the flag on a course doesn't change where the
// learner lands on resume. Kicked off in `loadAllData` only when the
// course is in the flag set; the cold path skips the full course load
// and renders the first cycle from the new endpoints.
const instantPlayback = useInstantPlayback(courseCode, {
  resolveStartLegoId: async () => {
    // localStorage is the device's last-known position — checked first
    // for everyone (guest + signed-in). Same code path; no special-
    // case for guests defaulting to LEGO 1. The position survives
    // refresh / browser close / iOS app kill and reads in <1ms.
    // Tom 2026-05-26.
    if (courseCode.value) {
      const localPos = loadPositionFromLocalStorage()
      if (localPos?.legoId) return localPos.legoId
    }

    if (!progressStore?.value || !learnerId.value || !courseCode.value) return null
    // Guest learner IDs have a `guest-` prefix that doesn't pass the UUID
    // column constraint on course_enrollments — Supabase returns 400 on
    // the lookup. With no localStorage cursor (handled above), let
    // bootstrap default to round 1.
    if (learnerId.value.startsWith('guest-')) return null
    try {
      const enrollment = await progressStore.value.getEnrollment(
        learnerId.value,
        courseCode.value,
      )

      // INF PLAY mode: skip instant-playback entirely and fall to the
      // legacy path, which emits the spaced-rep + random-USE rounds the
      // mode is designed around. The path is the same as the course-
      // end case below — throw and let the catch in LearningPlayer
      // pick up the legacy generator.
      if (enrollment?.current_mode === 'infplay') {
        throw new Error('CourseEndNoNextLego')
      }

      const lastCompleted = enrollment?.last_completed_lego_id ?? null
      if (!lastCompleted) return null  // fresh learner → bootstrap defaults to R1

      // last_completed_lego_id means the learner FINISHED that LEGO.
      // Resume should land on the NEXT one in script order, not replay
      // the one they just completed. Look it up in the round-map.
      const map = await instantPlayback.getOrFetchRoundMap()
      const idx = map.rounds.findIndex(r => r.legoId === lastCompleted)
      if (idx === -1) {
        // LEGO not in round-map (schema drift, deleted content, etc.).
        // Treat as fresh start rather than crashing.
        console.warn(`[InstantPlayback] last_completed ${lastCompleted} not in round-map; starting at R1`)
        return null
      }
      const next = map.rounds[idx + 1]
      if (!next) {
        // Course end — no further LEGOs to introduce. Auto-enter INF
        // PLAY so the mode flag is set for subsequent sessions (and the
        // back-belt-skip handler can detect it). Setting the mode is
        // idempotent — re-entering when already in infplay leaves the
        // counter alone (see ProgressStore.setMode). Then throw to
        // fall to the legacy path which generates the infplay content.
        try {
          await progressStore.value.setMode(learnerId.value, courseCode.value, 'infplay')
        } catch (modeErr) {
          console.warn('[InstantPlayback] setMode(infplay) failed:', modeErr)
        }
        throw new Error('CourseEndNoNextLego')
      }
      return next.legoId
    } catch (err) {
      if ((err as Error)?.message === 'CourseEndNoNextLego') throw err
      return null
    }
  },
})

// ============================================================
// Bundle-based caching architecture (cache-based-content-loading)
// ============================================================
// Single source of truth for "is this audio playable locally."
// Bundle ships the full course structure in one fetch; AudioCache
// stores blobs in IndexedDB with quota-aware LRU eviction; the
// BundleDownloader walks every persistent audio ref in the
// background so by the time the learner reaches spaced rep /
// INF PLAY, the audio is already local. The legacy warm-up
// surface stays alongside for now — this commit only adds the
// bundle layer; subsequent commits wire the prefetcher and
// remove the warm-up code.
const courseBundle = useCourseBundle()
const audioCache = getAudioCache()
let bundleDownloader: BundleDownloader | null = null
// Module-scoped so onUnmounted can revoke its blob URLs. Built per
// session in onMounted once the courseCode is known.
let audioCacheSource: AudioCacheSource | null = null
// JIT prefetcher — ephemeral acquire/release around LEGO debut rounds,
// persistent backstop for the next ~30 cycles. Replaces the warm-up
// surface in the existing instant-playback path (next commit removes
// the now-redundant code).
// Streaming-first AudioPrefetcher — accepts the library defaults
// (lookahead=1 LEGO, persistentLookaheadCycles=3) which warm just
// enough to avoid races between cycle entry and audio load. The
// SW CacheFirst layer (driven by SimplePlayer.prefetchNextCycle)
// handles ongoing playback caching. Learners who want full course
// caching get driving mode's chunked accumulation or the future
// paid "Download for offline" opt-in.
const audioPrefetcher = createAudioPrefetcher({ audioCache })

// Script mode: toggle between romanized and native script for target text
const { scriptMode, isNativeScript, toggleScriptMode } = useScriptMode(courseCode)
const hasRomanizedText = ref(false)

// Detect romanized text early (before play) via a lightweight DB check.
// Watch BOTH courseCode and supabase as sources: supabase is injected as
// a ref that the parent populates async, so on player mount it's often
// null while courseCode is already set. Watching courseCode alone with
// immediate=true fires once, hits the supabase?.value null-guard, and
// never re-fires — leaving hasRomanizedText permanently false and the
// script toggle hidden for jpn/kor/ara/etc. learners.
watch([courseCode, supabase], async ([code, sb]) => {
  if (!code || !sb) return
  const { count } = await sb
    .from('course_legos')
    .select('id', { count: 'exact', head: true })
    .eq('course_code', code)
    .not('target_text_roman', 'is', null)
    .limit(1)
  hasRomanizedText.value = (count ?? 0) > 0
}, { immediate: true })

const courseTargetLang = computed(() => {
  if (!props.course) return ''
  return props.course.target_lang || courseCode.value?.split('_')[0] || ''
})

const courseDisplayName = computed(() => {
  if (!props.course) return ''
  const baseName = getLanguageName(courseTargetLang.value)
  if (props.course.variant_label) {
    return `${baseName} (${props.course.variant_label})`
  }
  return baseName
})

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
const shouldShowProgressWarning = computed(() => false /* disabled during light theme work */)
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
/**
 * Explicit cursor write for intentional navigation (belt-back, jump-to-belt
 * pill, jump-to-furthest). Lets the cursor regress to where the learner has
 * navigated, so the resting-state "skip to round N" choice surfaces during
 * real revisits. Round-completion writes still go through saveRoundProgress
 * which is forward-only — the bug-overwrite safety net stays in place.
 */
const setRemoteCursor = async (legoId: string, roundIndex: number) => {
  if (isGuestLearner.value || !progressStore?.value || !legoId) return
  try {
    await progressStore.value.setEnrollmentCursor(
      learnerId.value,
      courseCode.value,
      legoId,
      roundIndex
    )
    console.log('[LearningPlayer] Cursor set to round', roundIndex, 'LEGO:', legoId)
  } catch (err) {
    console.warn('[LearningPlayer] Failed to set cursor:', err)
  }
}

/** Persist the simplePlayer's current position as the cursor. Called after
 *  intentional navigation (belt-back, belt-pill, jump-to-furthest) so the
 *  resting-state choice surfaces if the learner is now behind their ceiling. */
/** Mirror the DB ceiling trigger locally. Whenever the cursor advances
 *  past where we've been, lift the in-memory ceiling refs so the journey
 *  bar reflects current truth without needing a page reload. The DB
 *  trigger does this on its side; this keeps the client in sync. */
const liftLocalCeilingIfHigher = (legoId: string | null, roundIndex: number) => {
  if (typeof roundIndex !== 'number' || !legoId) return
  if (highestCompletedRoundIndex.value === null || roundIndex > highestCompletedRoundIndex.value) {
    highestCompletedRoundIndex.value = roundIndex
    highestCompletedLegoId.value = legoId
  }
}

const persistCursorAtCurrentRound = async () => {
  const round = simplePlayer.currentRound.value
  const idx = simplePlayer.roundIndex.value
  if (!round?.legoId || typeof idx !== 'number') return

  // INF PLAY rounds carry a random-USE LEGO as their primary legoId
  // (could be anywhere in the course). Writing THAT as the cursor
  // makes the cursor point at some random earlier position, BEHIND
  // the learner's actual highest LEGO — surfacing as "you've been
  // further than this" in the resting state. Substitute the last
  // main-loop LEGO (== the learner's true cursor anchor) so the
  // cursor stays meaningful in INF PLAY.
  //
  // Mirrors saveRoundProgress's substitution at line 623. Both writes
  // (round-completion AND explicit navigation) need the same logic
  // or one path overwrites the other with a bad value.
  let legoIdToSave = round.legoId
  const isInfPlayRound = !!round.cycles?.length && !round.cycles.some((c: any) =>
    c.type === 'intro' || c.type === 'debut' || c.type === 'build'
  )
  if (isInfPlayRound) {
    // Prefer the session high-water; fall back to the persisted
    // ceiling if we got here without playing any main-loop round
    // this session (e.g. jumpToFurthest straight into INF PLAY).
    const anchor = lastMainLoopLegoId.value ?? highestCompletedLegoId.value
    if (anchor) legoIdToSave = anchor
  }

  await setRemoteCursor(legoIdToSave, idx)
  liftLocalCeilingIfHigher(legoIdToSave, idx)
  // Mirror what we just wrote to DB into the local ref so the
  // resting-state journey-bar reflects current cursor without
  // waiting for the next enrollment reload.
  lastCompletedLegoIdRef.value = legoIdToSave
}

const saveRoundProgress = async (legoId, roundIndex, round?: any) => {
  if (isGuestLearner.value || !progressStore?.value) {
    console.log('[LearningPlayer] Skipping progress save (guest mode)')
    return
  }

  // For infinite-play rounds, substitute the last main-loop LEGO as
  // the cursor. The round's primaryLegoKey is the first random-USE
  // LEGO drawn (could be anywhere in the course); writing it as
  // last_completed_lego_id makes the cursor meaningless as a
  // course-progress marker. Even with the trigger fix that ratchets
  // highest_completed_lego_id independently, the CURSOR (last_lego_id)
  // should keep pointing at the boundary of what the learner has been
  // introduced to, not at whatever random review LEGO came up first.
  //
  // Use the round object passed by the caller, falling back to
  // cachedRounds for the legacy path. cachedRounds is empty on the
  // instant-playback path — the bug that froze the ceiling at the
  // last pre-instant-playback LEGO. See onRoundCompleted handler for
  // the source of `round` and lastMainLoopLegoId maintenance.
  let legoIdToSave = legoId
  const r = round ?? cachedRounds.value[roundIndex]
  const isInfPlayRound = !!r?.cycles?.length && !r.cycles.some((c: any) =>
    c.type === 'intro' || c.type === 'debut' || c.type === 'build'
  )
  if (isInfPlayRound && lastMainLoopLegoId.value) {
    legoIdToSave = lastMainLoopLegoId.value
  }

  try {
    await progressStore.value.updateEnrollmentProgress(
      learnerId.value,
      courseCode.value,
      legoIdToSave,
      roundIndex
    )
    if (isInfPlayRound && legoIdToSave !== legoId) {
      console.log(`[LearningPlayer] Saved progress: round ${roundIndex}, LEGO ${legoIdToSave} (infinite-play; substituted from round primaryLegoKey ${legoId})`)
    } else {
      console.log('[LearningPlayer] Saved progress: round', roundIndex, 'LEGO:', legoIdToSave)
    }
    liftLocalCeilingIfHigher(legoIdToSave, roundIndex)
    // Mirror cursor write into local ref for the resting-state
    // journey-bar comparison (DB-canonical cursor).
    lastCompletedLegoIdRef.value = legoIdToSave
    // INF PLAY auto-entry (mid-session). Crossing from the last main-
    // loop round into the first infplay round flips current_mode here
    // so we don't have to wait for a session restart for the mode flag
    // to land. setMode is idempotent (re-entry doesn't reset the
    // counter); chained bumpInfplayRound then increments per round.
    if (isInfPlayRound) {
      try {
        // Auto-entry also ratchets highest to course's final LEGO.
        // Same semantic as explicit-tap entry — once you're playing
        // INF PLAY rounds, your high-water mark is the end of the
        // main loop regardless of which path got you there.
        const finalLego = await getCourseFinalLego(courseCode.value)
        await progressStore.value.setMode(
          learnerId.value, courseCode.value, 'infplay',
          finalLego ?? undefined,
        )
        await progressStore.value.bumpInfplayRound(
          learnerId.value, courseCode.value,
        )
        // Local mirror: keep currentMode + counter in sync so the UI
        // (purple forward button, INF round display) updates without
        // waiting for the next enrollment reload.
        if (currentMode.value !== 'infplay') currentMode.value = 'infplay'
        infplayRoundIndex.value = Math.max(1, infplayRoundIndex.value + 1)
        if (finalLego && (!highestCompletedLegoId.value || finalLego.legoId > highestCompletedLegoId.value)) {
          highestCompletedLegoId.value = finalLego.legoId
          highestCompletedRoundIndex.value = finalLego.roundIndex
        }
      } catch (err) {
        console.warn('[LearningPlayer] INF PLAY mode/counter update failed:', err)
      }
    }
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
        lastCompletedRoundIndex: enrollment.last_completed_round_index,
        highestCompletedLegoId: enrollment.highest_completed_lego_id,
        highestCompletedRoundIndex: enrollment.highest_completed_round_index,
        currentCycleIndex: enrollment.current_cycle_index ?? 0,
        lastPracticedAt: enrollment.last_practiced_at ?? null,
        currentMode: enrollment.current_mode ?? 'main',
        infplayRoundIndex: enrollment.infplay_round_index ?? 0,
      }
    }
  } catch (err) {
    console.warn('[LearningPlayer] Failed to load saved progress:', err)
  }
  return null
}

// ============================================
// INFINITE-PLAY DETECTION (lego-id keyed)
// ============================================
// Cache the course's main-loop round count per session to avoid
// duplicate Supabase round-trips when the helpers fire from multiple
// branches (initial resume + jumpToFurthest both consult them).
let courseMainLoopCountCache: number | null = null
let courseMainLoopCountCacheKey: string | null = null

/**
 * True iff the learner has been introduced to every LEGO in the course
 * — i.e. they belong in infinite-play mode.
 *
 * highest_completed_lego_id is the canonical signal. The trigger on
 * course_enrollments ratchets it independently of round_index
 * (migration 20260512_lego_id_independent_ratchet.sql), and
 * saveRoundProgress substitutes the last main-loop LEGO when writing
 * the cursor for an infinite-play round, so the ceiling LEGO stays at
 * the actual course-progress boundary. Lexicographic comparison
 * works because lego_id is the zero-padded SNNNNLNN format.
 */
const hasReachedInfinitePlay = async (
  highestLegoId: string | null,
  course: string,
): Promise<boolean> => {
  if (!highestLegoId || !supabase?.value || !course) return false
  try {
    const { data, error } = await supabase.value
      .from('course_legos')
      .select('lego_id')
      .eq('course_code', course)
      .eq('is_new', true)
      .gt('lego_id', highestLegoId)
      .limit(1)
    if (error) {
      console.warn('[LearningPlayer] hasReachedInfinitePlay query failed:', error)
      return false
    }
    return (data?.length ?? 0) === 0
  } catch (err) {
    console.warn('[LearningPlayer] hasReachedInfinitePlay threw:', err)
    return false
  }
}

/**
 * The course's final main-loop LEGO ID, plus the 0-indexed
 * round_index it occupies. Used when entering INF PLAY to ratchet
 * highest_completed_* so the high-water mark reflects "done with new
 * content" regardless of whether the learner played every belt or
 * belt-skipped forward.
 *
 * Same caching shape as getCourseMainLoopRoundCount — single Supabase
 * query per course per session.
 */
let courseFinalLegoCacheKey: string | null = null
// Reactive ref backing the cache so computeds (wouldEnterInfplay) can
// derive end-of-course decisions without an extra async fetch on every
// tick. Populated by getCourseFinalLego below, kicked off early in
// loadAllData so it's ready by the time the learner can press
// forward-skip.
const courseFinalLegoRef = ref<{ legoId: string; roundIndex: number } | null>(null)
const getCourseFinalLego = async (course: string): Promise<{ legoId: string; roundIndex: number } | null> => {
  if (courseFinalLegoRef.value && courseFinalLegoCacheKey === course) {
    return courseFinalLegoRef.value
  }
  if (!supabase?.value || !course) return null
  try {
    const { data, error } = await supabase.value
      .from('course_legos')
      .select('seed_number, lego_index')
      .eq('course_code', course)
      .eq('is_new', true)
      .order('seed_number', { ascending: false })
      .order('lego_index', { ascending: false })
      .limit(1)
    if (error || !data || !data[0]) return null
    const row = data[0] as { seed_number: number; lego_index: number }
    const legoId = `S${String(row.seed_number).padStart(4, '0')}L${String(row.lego_index).padStart(2, '0')}`
    const count = await getCourseMainLoopRoundCount(course)
    if (count <= 0) return null
    courseFinalLegoRef.value = { legoId, roundIndex: count - 1 }  // 0-indexed
    courseFinalLegoCacheKey = course
    return courseFinalLegoRef.value
  } catch (err) {
    console.warn('[LearningPlayer] getCourseFinalLego threw:', err)
    return null
  }
}

/**
 * Number of is_new LEGOs in the course — used to size endSeed so the
 * script generator emits the entire main loop plus EXPANSION_BATCH
 * worth of infinite-play rounds.
 */
const getCourseMainLoopRoundCount = async (course: string): Promise<number> => {
  if (courseMainLoopCountCache !== null && courseMainLoopCountCacheKey === course) {
    return courseMainLoopCountCache
  }
  if (!supabase?.value || !course) return 0
  try {
    const { count, error } = await supabase.value
      .from('course_legos')
      .select('lego_id', { count: 'exact', head: true })
      .eq('course_code', course)
      .eq('is_new', true)
    if (error) {
      console.warn('[LearningPlayer] getCourseMainLoopRoundCount failed:', error)
      return 0
    }
    courseMainLoopCountCache = count ?? 0
    courseMainLoopCountCacheKey = course
    return courseMainLoopCountCache
  } catch (err) {
    console.warn('[LearningPlayer] getCourseMainLoopRoundCount threw:', err)
    return 0
  }
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

// Brain-view telemetry. Feeds Agent A's pairings store: every cycle that
// actually plays through bumps `fire_count` for its primary LEGO + any
// constituent A-LEGOs of an M-LEGO. Drives the v2 brain timelapse:
// thicker synapses + mastery tier. Skipped cycles (Turbo) never fire
// `cycle_completed`, so we automatically only count what the learner
// heard.
// Agent A's composable takes no args — pulls supabase via inject. We pass
// learnerId + courseCode per call at the recordCyclePlay site below.
const pairingsTelemetry = usePairingsTelemetry()

// Diagnostic event log — captures play/pause/skip/stop taps + lap and
// commentary lifecycle. Persisted in player_events; surfaced in the
// admin user-detail page so user reports like "skip didn't work" can
// be diagnosed without DevTools.
const playerLog = usePlayerLog({ courseCode })
const logEvent = playerLog.event
// Expose audio_failed banner state at top level so the template can
// use it directly (refs nested inside a plain object aren't auto-unwrapped).
const audioFailedBanner = simplePlayer.audioFailed

// Environment label shown inline next to the logo. Hostname-based so it
// can't drift from reality (no env var plumbing). null on production.
const envLabel = computed<string | null>(() => {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname
  const isProduction = host === 'saysomethingin.app'
    || host === 'www.saysomethingin.app'
    || host === 'app.saysomethingin.com'
  if (isProduction) return null
  if (host.startsWith('staging.') || host.includes('-staging')) return 'STAGING'
  return 'DEV'
})

// Rounds storage (loaded from database, adapted for SimplePlayer)
// Using any[] to allow mixed format: SimpleRound (cycles) + legacy ScriptItem (items)
const loadedRounds = ref<any[]>([])
// Tracks the highest main-loop LEGO whose round has been completed this
// session (or seeded from the DB ceiling on resume). Used by
// saveRoundProgress to substitute the cursor on infinite-play rounds —
// see comment there for why. Maintained by the onRoundCompleted handler.
// Compares lexicographically (matches SNNNNLNN ordering).
const lastMainLoopLegoId = ref<string | null>(null)
const isMainLoopRound = (round: any): boolean =>
  !!round?.cycles?.length && round.cycles.some((c: any) =>
    c.type === 'intro' || c.type === 'debut' || c.type === 'build'
  )

// For visual position (belt colour, playingSeedNumber) — during an
// infinite-play round, round.legoId is the random USE LEGO drawn for
// that round (anywhere in the course), so using it directly makes the
// belt indicator bounce around with each cycle. Anchor instead to the
// last main-loop LEGO the learner reached, which is what the belt is
// actually tracking. Falls back to round.legoId when no main-loop
// ceiling is known (cold start / fresh learner). */
const visualLegoIdForRound = (round: any): string | null => {
  if (!round) return null
  if (isMainLoopRound(round)) return round.legoId || null
  return lastMainLoopLegoId.value || round.legoId || null
}

// Expose reactive state for UI - writable refs that sync with simplePlayer
// We need writable refs because legacy code assigns to these directly
const currentRoundIndex = ref(0)
const currentItemInRound = ref(0)
const isPlaying = ref(false)

// Furthest round the learner has ever reached, with its lego companion.
// Read once on resume; the trigger keeps the DB ceiling in sync as the
// cursor moves. Drives the "skip to round N" choice in the resting state
// when the cursor is currently behind this ceiling.
const highestCompletedRoundIndex = ref<number | null>(null)
const highestCompletedLegoId = ref<string | null>(null)
// Cursor LEGO ID from the enrollment row (last_completed_lego_id).
// Reactive copy of the DB value — the canonical "where is the cursor"
// signal for the resting-state journey-bar comparison. DON'T derive
// this from simplePlayer.currentRound: that's null/stale during the
// resting state, and an INF PLAY round's legoId is a random USE that
// doesn't represent pedagogical position.
const lastCompletedLegoIdRef = ref<string | null>(null)
// Current cursor (vs ceiling). Critical for infinite-play resume:
// in infinite-play rounds the saved lastLegoId points to a LEGO
// reviewed via random-USE, which the legoId-based resume would map to
// that LEGO's MAIN-LOOP debut round — not the infinite-play round the
// learner was actually on. The round index is the only unambiguous
// position when legoIds get reused across infinite-play rounds.
const lastCompletedRoundIndex = ref<number | null>(null)
// Cycle cursor within the in-progress round, persisted on every cycle
// completion. Read once on resume so a PWA reload mid-round picks up
// from the cycle the learner was on rather than restarting cycle 0
// (a 20-cycle penalty on long rounds). Reset to 0 when the round finishes.
const savedCurrentCycleIndex = ref<number>(0)
// Last DB-recorded practice time. Drives resume-TTL regression: long
// gaps re-engage the learner with familiar territory by ignoring the
// cycle bookmark (round reset) or stepping back to the belt start.
const savedLastPracticedAt = ref<Date | null>(null)
// INF PLAY mode state — mirrors course_enrollments.current_mode +
// infplay_round_index. Read on enrollment load, updated on
// auto-entry (saveRoundProgress crosses into infplay) or exit
// (handleGoBackBelt out of infplay). Drives the purple forward-
// button styling and the visible "INF round N" indicator.
const currentMode = ref<'main' | 'infplay'>('main')
const infplayRoundIndex = ref<number>(0)

// Independent of the resume cascade — fires whenever course or learner
// changes so the ceiling is loaded for both cached-script and fresh-
// generate paths, and refreshes on course switch. Single row read, errors
// silently if offline / unauthenticated (choice just won't surface).
watch(
  () => [courseCode.value, learnerId.value],
  async () => {
    if (!progressStore?.value || !learnerId.value || !courseCode.value) return
    if (isGuestLearner.value) return
    try {
      const saved = await loadSavedProgress()
      if (saved) {
        highestCompletedRoundIndex.value = saved.highestCompletedRoundIndex ?? null
        highestCompletedLegoId.value = saved.highestCompletedLegoId ?? null
        lastCompletedRoundIndex.value = saved.lastCompletedRoundIndex ?? null
        lastCompletedLegoIdRef.value = saved.lastCompletedLegoId ?? null
        savedCurrentCycleIndex.value = saved.currentCycleIndex ?? 0
        savedLastPracticedAt.value = saved.lastPracticedAt ?? null
        currentMode.value = saved.currentMode ?? 'main'
        infplayRoundIndex.value = saved.infplayRoundIndex ?? 0
      } else {
        highestCompletedRoundIndex.value = null
        highestCompletedLegoId.value = null
        lastCompletedRoundIndex.value = null
        lastCompletedLegoIdRef.value = null
        savedCurrentCycleIndex.value = 0
        savedLastPracticedAt.value = null
        currentMode.value = 'main'
        infplayRoundIndex.value = 0
      }
    } catch { /* silent */ }
  },
  { immediate: true }
)

// Sync state with simplePlayer
watch(() => simplePlayer.roundIndex.value, (idx) => {
  currentRoundIndex.value = idx
  // Keep the instant-playback composable's cursor in lockstep with the
  // engine — tier-3 prefetch anchors on currentLegoId, and the
  // round-map-derived `currentRound` computed reads off it too. No-op
  // on legacy courses (composable is initialised but unused).
  const currentLegoIdNow = simplePlayer.currentRound?.value?.legoId
  if (currentLegoIdNow && isInstantPlaybackCourse(courseCode.value)) {
    instantPlayback.setCurrentLegoId(currentLegoIdNow)
  }
  // Near-edge trigger.
  //
  // Instant-playback path: fire tier-3 to pull the next round's cycles
  // into the buffer, then fold them into SimplePlayer via appendRounds.
  // The composable's `prefetchTier3` is idempotent (dedupes by cycle id
  // in the buffer), so this is safe to call from inside the watcher.
  //
  // Legacy path: kick `loadSeedIfNeeded` for the next seed range as
  // before. The unit changes (rounds vs seeds) but the trigger is the
  // same: "we're within N rounds of the loaded edge — fetch more".
  const totalLoaded = simplePlayer.roundCount?.value ?? 0
  if (totalLoaded === 0) return

  if (isInstantPlaybackCourse(courseCode.value)) {
    if (idx >= totalLoaded - INSTANT_PLAYBACK_NEAR_EDGE_ROUNDS) {
      // INF PLAY uses its own pagination (round-number-based) vs
      // main-loop tier-3 (legoId-based). Branch on mode.
      if (currentMode.value === 'infplay') {
        void instantPlayback.prefetchNextInfPlayBatch().then(() => {
          const mapForInf = instantPlayback.roundMap.value
          if (!mapForInf) return
          const mainLoopCount = mapForInf.rounds[0] ? mapForInf.rounds[0].r - 1 : 0
          const refreshed = infPlayCyclesToRounds(
            instantPlayback.infPlayCycles.value as any,
            mainLoopCount,
          )
          if (refreshed.length > totalLoaded) {
            const newRounds = refreshed.slice(totalLoaded) as any
            simplePlayer.appendRounds(newRounds)
            loadedRounds.value = refreshed as any
            // Warm up the new rounds' audio too.
            warmUpInfPlayRoundsBackground(newRounds as any, 0)
          }
        })
        return
      }
      void instantPlayback.prefetchTier3().then(() => {
        const map = instantPlayback.roundMap.value
        if (!map) return
        const refreshed = backendCyclesToRounds(
          instantPlayback.getBufferedCyclesForLego,
          map,
          instantPlayback.isLegoComplete,
        )
        // Diff against what SimplePlayer already has and append only
        // the new tail. appendRounds dedupes by roundNumber so even a
        // full-list pass is safe — but slicing keeps it cheap.
        if (refreshed.length > totalLoaded) {
          simplePlayer.appendRounds(refreshed.slice(totalLoaded) as any)
          loadedRounds.value = refreshed as any
        }
      })
    }
    return
  }

  if (idx >= totalLoaded - LOOKAHEAD_TRIGGER_ROUNDS) {
    const currentLegoId = simplePlayer.currentRound?.value?.legoId
    const currentSeed = currentLegoId ? getSeedFromLegoId(currentLegoId) : null
    if (currentSeed != null && currentSeed > 0) {
      // loadSeedIfNeeded is idempotent — early-returns if the target seed
      // is already loaded, so this is safe to call from inside the watcher.
      loadSeedIfNeeded(currentSeed + LOOKAHEAD_CHUNK_SEEDS).catch(() => { /* silent */ })
    }
  }
})
watch(() => simplePlayer.cycleIndex.value, (idx) => { currentItemInRound.value = idx })
watch(() => simplePlayer.isPlaying.value, (playing) => {
  isPlaying.value = playing
})

// Backwards compatibility aliases
const effectiveRounds = loadedRounds
const cachedRounds = loadedRounds  // Legacy alias
const effectiveRoundIndex = currentRoundIndex
const effectiveItemInRound = currentItemInRound

const playbackGeneration = ref(0)  // Counter for playback generation tracking
const scriptBaseOffset = ref(0)  // Base offset for script loading

// ============================================
// ENTITLEMENT / PAYWALL
// ============================================
const entitlementComposable = useEntitlement()
const showPaywall = ref(false)

// Watch entitlements — auto-dismiss paywall if user redeems a code or subscribes
const { entitlements: liveEntitlements } = useSharedUserEntitlements()
watch(liveEntitlements, () => {
  if (showPaywall.value && props.course) {
    const canAccess = entitlementComposable.canAccessSeed(props.course, PREMIUM_PREVIEW_MAX_SEED + 1)
    if (canAccess) {
      showPaywall.value = false
      simplePlayer.resume()
    }
  }
})

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

  // ── Comprehensive audio + L1 cluster telemetry ──
  // SimplePlayer reuses one Audio element so at most one audio plays at
  // a time; logging on phase transitions captures every audio start
  // regardless of cache vs network. Batches via usePlayerLog (5s + 10-
  // event flush + pagehide beacon) — complete, not continuous.
  const cycle = simplePlayer.currentCycle.value
  if (!cycle) return

  // L1 cluster boundary — fires once per cluster, on the prompt phase
  // of an L1 listen_intro (cycle id `listen_intro_R{n}_*`). Layer 2 pod
  // listen_intros are `listen_intro_pod_R{n}_*` and already have their
  // own pod_lap_start event, so explicitly skip those.
  if (phase === 'prompt' && cycle.type === 'listen_intro' && typeof cycle.id === 'string') {
    if (cycle.id.startsWith('listen_intro_R') && !cycle.id.startsWith('listen_intro_pod_')) {
      const m = cycle.id.match(/^listen_intro_R(\d+)_/)
      const round = m ? parseInt(m[1], 10) : null
      logEvent('l1_cluster_start', {
        cycleId: cycle.id,
        round,
        legoId: cycle.legoId ?? null,
      })
      // Reset the cluster dedup set — bump fire_count once per distinct
      // seed within this cluster (regardless of playlist length, which
      // varies 1-3 cycles per seed by stage).
      l1ClusterSeedsBumped = new Set<number>()
    }
  }

  // L1 listening cycle — bump persisted fire_count for this cluster's seed.
  // Pod (Layer 2) cycles have type='pod' so they're filtered out cleanly.
  // Seed number is parsed from cycle.id (`listening_S0001_ps_N` → 1) because
  // the script item's listeningSeedNumber custom field doesn't propagate
  // through the ScriptItem → SimplePlayer.Cycle transformation.
  if (
    phase === 'prompt' &&
    cycle.type === 'listening' &&
    typeof cycle.id === 'string' &&
    listeningProgress.value
  ) {
    const m = cycle.id.match(/^listening_S(\d+)_/)
    const sNum = m ? parseInt(m[1], 10) : null
    if (sNum !== null && l1ClusterSeedsBumped && !l1ClusterSeedsBumped.has(sNum)) {
      l1ClusterSeedsBumped.add(sNum)
      listeningProgress.value.recordClusterFire([sNum])
    }
  }

  // Audio play — log the URL + role for any phase that actually plays
  // a file. Skips silent phases (pause, or listening cycles with
  // missing prompt/voice2).
  let audioUrl: string | undefined
  let role: 'known' | 'target1' | 'target2' | null = null
  if (phase === 'prompt') { audioUrl = cycle.known?.audioUrl; role = 'known' }
  else if (phase === 'voice1') { audioUrl = cycle.target?.voice1Url; role = 'target1' }
  else if (phase === 'voice2') { audioUrl = cycle.target?.voice2Url; role = 'target2' }
  if (audioUrl && role) {
    // cacheHit reflects whether AudioCache.persistent has the id at the
    // moment the cycle begins playing — signal for "did the
    // BundleDownloader / AudioPrefetcher have time to land this audio
    // in IndexedDB before the learner reached it." Tri-state: null when
    // we couldn't extract an id (already a blob: URL post-resolution,
    // or an off-format URL) so queries can distinguish "uncached" from
    // "couldn't tell".
    const idMatch = audioUrl.match(/\/api\/audio\/([^?/]+)/)
    const audioId = idMatch ? idMatch[1] : null
    const cacheHit = audioId ? audioCache.has(audioId) : null
    logEvent('audio_play', {
      url: audioUrl,
      role,
      cycleId: cycle.id,
      cycleType: cycle.type ?? null,
      legoId: cycle.legoId ?? null,
      seedId: cycle.seedId ?? null,
      playbackSpeed: cycle.playbackSpeed ?? 1.0,
      cacheHit,
    })
  }
})

// Cycle completed - update counters and animations
simplePlayer.onCycleCompleted((cycle) => {
  itemsPracticed.value++
  learningHintPromptsShown.value++
  contribution.incrementLocal()

  // Brain-view telemetry — fire-count the LEGOs that actually played.
  // Primary LEGO + any A-LEGO constituents of an M-LEGO (pre-resolved on
  // the cycle by RoundBuilder). Skipped cycles don't reach this handler,
  // so we automatically respect the "only count what the learner heard"
  // rule. Guests have a learnerId fallback the composable filters on.
  if (cycle.legoId) {
    const firedLegoIds = [cycle.legoId]
    if (Array.isArray(cycle.componentLegoIds)) {
      for (const id of cycle.componentLegoIds) {
        if (id && id !== cycle.legoId) firedLegoIds.push(id)
      }
    }
    void pairingsTelemetry
      .recordCyclePlay({
        learnerId: learnerId.value,
        courseCode: courseCode.value,
        legoIds: firedLegoIds,
      })
      .catch((err: unknown) => {
        // Telemetry must never break playback — log and move on.
        console.warn('[LearningPlayer] pairings telemetry failed:', err)
      })
  }

  // Feed per-LEGO adaptive engine. Only when we have a real latency signal
  // (VAD detected speech). No-op when guest, when VAD disabled, or when the
  // cycle is a listening/intro type without a meaningful learner response.
  const latency = lastTimingResult.value?.response_latency_ms
  if (
    adaptationEngine.value &&
    cycle.legoId &&
    typeof latency === 'number' &&
    cycle.target?.text
  ) {
    adaptationEngine.value.recordCycle(
      cycle.legoId,
      latency,
      cycle.target.text.length
    )
  }

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

  // Record to session tracking (for analytics)
  const completedItem = currentPlayableItem.value
  if (completedItem) {
    // Legacy round-based playback path — fires the full
    // recordCycleComplete (helix engine + session checkpoint + opps bump).
    learningSession.recordCycleComplete(completedItem).catch(err => {
      console.error('[LearningPlayer] Failed to record cycle:', err)
    })
  } else {
    // SimplePlayer path — currentPlayableItem is never set here, so the
    // legacy branch above no-ops. We still need the opportunities counter
    // to advance so `learner_speaking_opportunities.opportunities` (and
    // the contribution modal's "YOUR PHRASES") actually accumulates.
    // 2026-05-23: fixes the long-standing "+0 phrases" display.
    learningSession.bumpOpportunity()
  }

  // Persist mid-round cursor so a PWA reload / app close+open mid-round
  // resumes from the cycle the learner was on instead of restarting
  // the whole 20-cycle round. The cycle that JUST completed is N; the
  // resume point is N+1 (next cycle to play). Reset to 0 happens on
  // round_completed via saveRoundProgress.
  if (!isGuestLearner.value && progressStore?.value && learnerId.value && courseCode.value) {
    const nextCycleIdx = simplePlayer.cycleIndex.value + 1
    progressStore.value.updateCurrentCycle(
      learnerId.value,
      courseCode.value,
      nextCycleIdx,
    ).catch(err => {
      console.warn('[LearningPlayer] Failed to persist current cycle:', err)
    })
  }
})

// Round completed - save progress and update current LEGO ID
simplePlayer.onRoundCompleted((round) => {
  const completedRoundIndex = simplePlayer.roundIndex.value
  logEvent('round_complete', {
    roundIndex: completedRoundIndex,
    legoId: round.legoId,
    seedId: round.seedId,
  })

  // AudioPrefetcher: release the completed LEGO's ephemeral audio
  // (intro/debut/builds) and acquire the next LEGOs' ephemeral sets.
  // No-op if the bundle hasn't loaded yet (setBundle hasn't fired).
  // Errors swallowed inside the prefetcher.
  void audioPrefetcher.onRoundCompleted(loadedRounds.value as any, completedRoundIndex)
  void audioPrefetcher.onRoundChanged(loadedRounds.value as any, completedRoundIndex + 1)

  // Synchronously pause if a pod is about to fire on this boundary.
  // handleRoundBoundary is async and runs on a later microtask — by the
  // time its own pause() lands, simplePlayer's orchestrator may have
  // already started the next round's prompt audio, causing the pod intro
  // to overlap with main-player audio. Pausing here, in the same tick as
  // the round-completed event, beats that race.
  const willFirePod = !!podScheduler
    && podScheduler.isInitialized.value
    && !beltJustEarned.value
    && podScheduler.shouldFireLapAt((completedRoundIndex || 0) + 1)
  if (willFirePod) {
    simplePlayer.pause()
  }

  if (round.legoId) {
    if (props.classContext) {
      // Class mode: update class progress, NOT personal belt
      updateClassLegoProgress(props.classContext.id, round.legoId)
      // Update localStorage classContext so page refresh works
      const demoStored = sessionStorage.getItem('ssi-demo-active-class')
      const stored = demoStored || localStorage.getItem('ssi-active-class')
      if (stored) {
        try {
          const ctx = JSON.parse(stored)
          ctx.last_lego_id = round.legoId
          // Write back to the same storage it came from
          if (demoStored) {
            sessionStorage.setItem('ssi-demo-active-class', JSON.stringify(ctx))
          } else {
            localStorage.setItem('ssi-active-class', JSON.stringify(ctx))
          }
        } catch {}
      }
    } else {
      // Maintain the main-loop high-water for the cursor substitution
      // in saveRoundProgress. Lex compare (SNNNNLNN format).
      if (isMainLoopRound(round) && round.legoId &&
          (!lastMainLoopLegoId.value || round.legoId > lastMainLoopLegoId.value)) {
        lastMainLoopLegoId.value = round.legoId
      }
      // Individual mode: existing behavior
      saveRoundProgress(round.legoId, completedRoundIndex, round)
      handleRoundBoundary(completedRoundIndex, round.legoId, round)
      // Belt visuals follow the main-loop LEGO this round is "for" —
      // for infplay rounds that's the last main-loop LEGO reached, NOT
      // the random USE drawn first (which would make the belt jump).
      const visualLegoId = visualLegoIdForRound(round)
      if (visualLegoId && beltProgress.value?.setCurrentLegoId) {
        beltProgress.value.setCurrentLegoId(visualLegoId)
      }
      if (visualLegoId && beltProgress.value?.setPlayingPosition) {
        const seed = getSeedFromLegoId(visualLegoId)
        if (seed !== null) beltProgress.value.setPlayingPosition(seed)
      }
    }
  }
  // Preload audio for the NEXT round (N+1) so it's cached before the user gets there
  const nextRoundIndex = completedRoundIndex + 1
  if (nextRoundIndex < loadedRounds.value.length) {
    preloadSimpleRoundAudio(loadedRounds.value, 2, nextRoundIndex)
  }

  // Paywall check: before advancing to next round, verify access
  if (props.course && nextRoundIndex < loadedRounds.value.length) {
    const nextRound = loadedRounds.value[nextRoundIndex]
    const nextSeedId = nextRound?.seedId || nextRound?.legoId?.substring(0, 5)
    if (nextSeedId) {
      const nextSeedNumber = parseInt(nextSeedId.substring(1, 5), 10) || 1
      if (!entitlementComposable.canAccessSeed(props.course, nextSeedNumber)) {
        simplePlayer.pause()
        showPaywall.value = true
      }
    }
  }
})

// Session complete — last round finished. If a pod lap or commentary
// is still in-flight (handleRoundBoundary fires lap → meanwhile
// advanceRound emits session_complete on the same tick), defer the
// summary screen. handleRoundBoundary checks sessionEnded after the
// lap and calls showPausedSummary then. Surfacing the summary now
// would call simplePlayer.stop() + release audioEngaged mid-lap and
// iOS would drop the session.
// Telemetry for audio failures. Both first-try (attempt=1, silently
// retried) and second-try (attempt=2, halted) emit through this — gives
// us visibility on how often the retry-once heuristic actually saves
// the cycle vs how often the learner gets the tap-to-retry chip. The
// payload mirrors AudioFailedEvent so admin diagnostics can group by
// reason / role / errorCode.
simplePlayer.onAudioFailed((event) => {
  logEvent('audio_failed', {
    reason: event.reason,
    role: event.role,
    cycleType: event.cycleType,
    legoId: event.legoId,
    cycleId: event.cycleId,
    errorCode: event.errorCode,
    attempt: event.attempt,
    lastError: event.lastError,
  })
})

simplePlayer.onSessionComplete(async () => {
  logEvent('session_complete', {
    deferredForLap: playingPodLapAudio.value || playingCommentaryAudio.value,
  })
  // Lap/commentary in flight? Defer — handleRoundBoundary will retry
  // expansion after the lap finishes (see post-lap branch below).
  if (playingPodLapAudio.value || playingCommentaryAudio.value) {
    sessionEnded.value = true
    return
  }
  // Infinite play: the course should never end. Try expanding the
  // script and resuming before falling through to a paused-quiet state.
  const added = await expandScript()
  if (added > 0) {
    simplePlayer.resume()
    return
  }
  sessionEnded.value = true
  showPausedSummary()
})

// AudioPrefetcher initial fire — once the bundle has loaded AND rounds
// are populated, kick the prefetcher at the current playback position.
// The watch refires when any of (bundle, rounds, roundIndex) changes,
// so progressive script loads / belt skips also re-arm the prefetcher.
// Idempotent inside the prefetcher (cache calls de-dupe).
watch(
  () => [
    courseBundle.bundle.value?.version ?? null,
    loadedRounds.value.length,
    simplePlayer.roundIndex.value,
  ] as const,
  () => {
    if (!courseBundle.bundle.value) return
    if (loadedRounds.value.length === 0) return
    void audioPrefetcher.onRoundChanged(
      loadedRounds.value as any,
      simplePlayer.roundIndex.value,
    )
  },
  { immediate: true },
)

// Round ENTRY persistence: whenever the player advances or jumps to a
// new round (skip-forward chevron, jump-to-seed, natural advance after a
// completed round, anything that changes currentRound.legoId), save the
// position immediately so the cursor + ceiling reflect what the learner
// has actually REACHED — not just what they've played through to the
// very last cycle of.
//
// The old contract (only round_completed persisted) was a methodology
// trap: a learner who skips forward through known LEGOs to validate
// recognition (the "I know this, next" flow) never completed those
// rounds, so their high-water stayed at the last full completion. The
// "you've been further than this — go to furthest point" affordance
// then jumped them BACKWARDS to where they last finished a round, even
// though they'd been practising cycles in much higher LEGOs.
//
// Ratchet trigger guarantees the ceiling never regresses, so skipping
// BACK to an earlier round just updates the cursor (correct for resume
// position) without lowering the high-water.
watch(
  () => simplePlayer.currentRound.value?.legoId,
  (newLegoId, prevLegoId) => {
    if (!newLegoId || newLegoId === prevLegoId) return
    if (isGuestLearner.value || props.classContext) return
    const round = simplePlayer.currentRound.value
    const roundIndex = simplePlayer.roundIndex.value
    if (!round || roundIndex == null) return
    if (isMainLoopRound(round) &&
        (!lastMainLoopLegoId.value || newLegoId > lastMainLoopLegoId.value)) {
      lastMainLoopLegoId.value = newLegoId
    }
    saveRoundProgress(newLegoId, roundIndex, round)
  }
)

// ============================================================================
// AUDIO PREFETCH LADDER (explicit phases)
// ============================================================================
//
// Phase 1 — instant: bootstrap fetches ~15 cycles via /api/courses/:code/cycles
//          (useInstantPlayback.bootstrap), so the first cycle starts in <2s.
// Phase 2 — background: generateScript() walks the whole course locally
//          (loadAllData → handoff replaces simplePlayer's queue with the
//          full Round[]). No network per round from here on.
// Phase 3 — eager: when a round becomes current (session start / advance /
//          skip / jump), prefetch the WHOLE round's audio + the next
//          AUDIO_EAGER_AHEAD rounds in parallel. Service worker
//          CacheFirst on /api/audio/* takes the responses.
// Phase 4 — deep: in the background, walk all remaining rounds and pull
//          their audio AUDIO_DEEP_BATCH at a time, serialised between
//          batches so we don't hammer the network. Listening clusters
//          (L1 / L2) are cycles in the round.cycles array, so they ride
//          along automatically with the per-round preload.
//
// Throttle / cellular-awareness lives downstream of these — for now
// fire-and-forget. Future: respect navigator.connection.saveData / type.

const AUDIO_EAGER_AHEAD = 3   // rounds (current + next 2) loaded on round entry
const AUDIO_DEEP_BATCH = 5    // rounds per batch in the deep background walk

// Phase 3 — eager prefetch on round entry. immediate: true catches session
// start / resume so the FIRST round of a session is preloaded before its
// first cycle plays (was the source of Aran's mid-cycle 4G stalls).
watch(
  () => [simplePlayer.roundIndex.value, loadedRounds.value?.length],
  ([roundIndex, totalLoaded]) => {
    if (typeof roundIndex !== 'number' || !totalLoaded) return
    if (!loadedRounds.value || roundIndex >= loadedRounds.value.length) return
    void preloadSimpleRoundAudio(loadedRounds.value, AUDIO_EAGER_AHEAD, roundIndex)
  },
  { immediate: true },
)

// Phase 4 — deep prefetch.
//
// 2026-05-23: DISABLED. This used to walk EVERY remaining round of the
// course on first load (and again on INF PLAY round append), firing
// `preloadSimpleRoundAudio` per batch of 5 rounds. For Portuguese
// (~1+ GB total course audio) this meant downloading basically the
// entire course in the background after every page refresh.
//
// Tom's stress test post-deploy: 57,859 SW CacheFirst requests /
// 589 MB transferred / 4.1 min of sustained fetching, almost all of
// it from this deep walk. Same anti-pattern we already removed from
// `warmUpInfPlayRoundsBackground` (the INF PLAY bulk warm-up) —
// speculative bulk caching that doesn't match the streaming-first
// architecture.
//
// Streaming-first reasoning (same as the INF PLAY no-op):
//   ~30 KB × 3 audios per cycle = ~90 KB/cycle, ~15s cycle (incl.
//   speaking pause) = ~6 KB/s steady-state. Comfortable on 3G.
//   AudioPrefetcher's per-round JIT (persistentLookaheadCycles=3) +
//   SimplePlayer.prefetchNextCycle priority hints cover the playback
//   path inside that envelope.
//
// Explicit full-course caching for offline use is provided by
// driving mode's chunked prefetch and the future paid "Download for
// offline" opt-in — both opt-in, both bounded by maxBytes.
//
// Function kept as a no-op (rather than deleted) so the call site
// stays in tree-shake-safe shape for the same reasons documented on
// `warmUpInfPlayRoundsBackground`.
let deepPrefetchRunning = false
async function deepPrefetchRestOfCourse() {
  // intentional no-op — see docblock above
  if (deepPrefetchRunning) return
  deepPrefetchRunning = false
  return
}

// Watcher kept wired (does nothing now that the callee is a no-op).
// Same reasoning as above — preserves a single grep handle if we ever
// revive an opt-in version.
watch(
  () => loadedRounds.value?.length,
  (total, prev) => {
    if (!total || total === prev) return
    void Promise.resolve().then(deepPrefetchRestOfCourse)
  },
)

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
    if (!round.legoId || !round.cycles?.length) continue
    // Use canonical text from Round (set by toSimpleRounds from intro item)
    // — no cycle scanning needed, immune to ID naming issues.
    const text = round.legoTargetText || round.cycles[0]?.target?.text
    if (text) map.set(round.legoId, text)
  }
  return map
})

// Native script variant of target text map
const legoTargetTextNativeMap = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  for (const round of (loadedRounds.value || [])) {
    if (!round.legoId || !round.cycles?.length) continue
    const native = round.legoTargetTextNative
    if (native) map.set(round.legoId, native)
  }
  return map
})

// Build lookup: LEGO ID → known text from all loaded rounds
const legoKnownTextMap = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  for (const round of (loadedRounds.value || [])) {
    if (!round.legoId || !round.cycles?.length) continue
    const text = round.legoKnownText || round.cycles[0]?.known?.text
    if (text) map.set(round.legoId, text)
  }
  return map
})

// Course-wide lookup: LEGO ID → known text, loaded once per course mount.
// The round-derived map above only contains LEGOs whose rounds are in
// loadedRounds — in infinite-play mode (where cycles surface random USE
// phrases referencing LEGOs from anywhere in the course) that map is
// incomplete, so the hero-card highlight silently disappears for any
// salient LEGO whose round isn't loaded. This map fills the gap with one
// cheap query (~300 rows per course) and serves as the primary source
// for the highlight lookup.
const globalLegoKnownTextMap = ref<Map<string, string>>(new Map())
// Course-wide target_text lookup. Same rationale as the known-text map
// above, but for the target language — INFPLAY USE phrases reference
// LEGOs anywhere in the course, and the round-derived legoTargetTextMap
// only has entries for loaded rounds. decomposePhrase needs every
// known-vocab text to bind tokens correctly, so we load all target_text
// + target_text_native rows once per course mount.
const globalLegoTargetTextMap = ref<Map<string, string>>(new Map())
const globalLegoTargetTextNativeMap = ref<Map<string, string>>(new Map())

async function loadGlobalLegoKnownTexts() {
  const client = supabase.value
  const code = courseCode.value
  if (!client || !code) return
  try {
    // course_legos.target_text holds the NATIVE script for romanised
    // courses (jpn/ara/kor — `target_text='話したい'`); course_legos.
    // target_text_roman holds the romanised form when present
    // (`'hanashitai'`). The bundle endpoint swaps these on the wire so
    // the player's round-derived legoTargetTextMap carries the romanised
    // form as `targetText` for those courses. The global maps here must
    // mirror that swap or the merged textMap ends up with mixed scripts
    // and decomposePhrase fails to bind romanised tokens to LEGOs whose
    // global entry is native-script.
    //
    // Convention:
    //   - globalLegoTargetTextMap       = romanised (target_text_roman)
    //                                     OR target_text when no
    //                                     romanisation exists.
    //   - globalLegoTargetTextNativeMap = native    (target_text)
    //                                     OR target_text_roman as a
    //                                     last-ditch fallback so the
    //                                     "native" path isn't empty for
    //                                     courses where the columns
    //                                     happen to be swapped.
    const { data, error } = await client
      .from('course_legos')
      .select('lego_id, known_text, target_text, target_text_roman')
      .eq('course_code', code)
    if (error) {
      console.warn('[LearningPlayer] Failed to load global lego texts:', error.message)
      return
    }
    const knownMap = new Map<string, string>()
    const targetMap = new Map<string, string>()
    const targetNativeMap = new Map<string, string>()
    for (const row of (data || [])) {
      if (!row.lego_id) continue
      if (row.known_text) knownMap.set(row.lego_id, row.known_text)
      // Primary (roman): prefer target_text_roman, fall back to target_text.
      const romanish = row.target_text_roman || row.target_text
      if (romanish) targetMap.set(row.lego_id, romanish)
      // Native: prefer target_text (which IS native on romanised courses),
      // fall back to target_text_roman.
      const nativeish = row.target_text || row.target_text_roman
      if (nativeish) targetNativeMap.set(row.lego_id, nativeish)
    }

    // Also pull M-LEGO component atoms course-wide. Without this the
    // INFPLAY decomposer only matches whole LEGO texts (strict ~26%
    // for German); adding atoms lifts to broader-match ~60%, matching
    // what the analysis scripts predict. Atoms get synthetic ids
    // (atom:<parent>:<text>) so they don't collide with real LEGO
    // ids in the reverse map; first-wins ordering in decomposePhrase
    // means a real A-LEGO of the same text still dominates an atom.
    const { data: compData, error: compErr } = await client
      .from('course_practice_phrases')
      .select('seed_number, lego_index, target_text, target_text_roman')
      .eq('course_code', code)
      .eq('phrase_role', 'component')
      .limit(20000)
    if (compErr) {
      console.warn('[LearningPlayer] Component atom load failed:', compErr.message)
    } else {
      for (const row of (compData || [])) {
        // Mirror the romanised/native split applied to LEGOs above.
        const romanish = row.target_text_roman || row.target_text
        const nativeish = row.target_text || row.target_text_roman
        if (!romanish && !nativeish) continue
        const parent = `S${String(row.seed_number).padStart(4, '0')}L${String(row.lego_index).padStart(2, '0')}`
        // Synth id keyed by the romanised text — keeps it stable across
        // both maps and avoids collisions when both forms are present.
        const synthId = `atom:${parent}:${romanish || nativeish}`
        if (romanish && !targetMap.has(synthId)) targetMap.set(synthId, romanish)
        if (nativeish && !targetNativeMap.has(synthId)) targetNativeMap.set(synthId, nativeish)
      }
    }

    globalLegoKnownTextMap.value = knownMap
    globalLegoTargetTextMap.value = targetMap
    globalLegoTargetTextNativeMap.value = targetNativeMap
    console.log(`[LearningPlayer] Loaded ${knownMap.size} legos + ${(compData || []).length} component atoms for ${code}`)
  } catch (err) {
    console.warn('[LearningPlayer] Global lego text load errored:', err)
  }
}

// Solo component detection: A-LEGOs whose target text appears as a component
// inside any M-LEGO. These get dashed edges to show "extracted from something bigger."
const soloComponentIds = computed<Set<string>>(() => {
  const ids = new Set<string>()
  // Collect all component target texts from M-LEGOs
  const componentTexts = new Set<string>()
  for (const comps of _componentsByLegoId.values()) {
    for (const c of comps) {
      componentTexts.add(c.target.toLowerCase().trim())
    }
  }
  // Find A-LEGOs (not in _componentsByLegoId = not M-LEGOs) whose text matches
  for (const [legoId, text] of legoTargetTextMap.value.entries()) {
    if (!_componentsByLegoId.has(legoId) && componentTexts.has(text.toLowerCase().trim())) {
      ids.add(legoId)
    }
  }
  return ids
})

// Current phrase's LEGO blocks for the assembly view
const currentPhraseLegoBlocks = computed<LegoBlock[]>(() => {
  const cycle = simplePlayer.currentCycle.value
  if (!cycle) return []
  const useNative = isNativeScript.value && hasRomanizedText.value
  if (!cycle.componentLegoIds?.length) {
    // Detect intro/debut/component cycles from the cycle.type field —
    // authoritative and works for both the legacy script-generator
    // path (toSimpleRounds preserves the type) and the instant-playback
    // bootstrap path (backend cycles carry type directly). The previous
    // substring match on cycle.id ('_intro_'/'_debut_' with trailing
    // underscores) only matched the legacy ID format
    // (S0287L01_intro_R123) and silently missed the backend's bare
    // S0287L01_intro / S0287L01_debut IDs, leaving intro/debut tiles
    // blank on the bootstrap path until full-script handoff landed.
    const cycleType = (cycle?.type || '') as string
    const isIntroOrDebut = cycleType === 'intro' || cycleType === 'debut'
    const isCmpCycle = cycleType === 'component_intro' || cycleType === 'component_practice'
    // The cycle's own known text — feeds the small ghost label under
    // the target tile on intro/debut/component cycles. Without it the
    // single-tile branch produces a tile-only render and the known
    // scaffold under the tile vanishes. The legacy path got knownText
    // via the componentLegoIds branch (legoKnownTextMap lookup); the
    // bootstrap path has it directly on the cycle.
    const cycleKnownText = cycle.known?.text || ''
    if (isCmpCycle) {
      // Component intro/practice: show a single tile with the component's target text
      const targetText = cycle.target?.text || ''
      if (targetText) {
        const legoId = cycle.legoId || currentRound.value?.legoId || cycle?.id || 'phrase'
        return [{
          id: legoId, targetText, isSalient: true, isSoloComponent: true,
          ...(cycleKnownText ? { knownText: cycleKnownText } : {}),
        }]
      }
    }
    if (isIntroOrDebut && currentRound.value?.legoId) {
      const legoId = currentRound.value.legoId
      // Read the LEGO text directly from the current cycle — avoids a map
      // that can be overwritten by later revival/review rounds sharing the
      // same legoId (which makes intro tiles render as whole phrases).
      const targetText = useNative
        ? (cycle.target?.textNative || cycle.target?.text || '')
        : (cycle.target?.text || '')
      if (targetText) {
        return [{
          id: legoId, targetText, isSalient: true,
          ...(cycleKnownText ? { knownText: cycleKnownText } : {}),
        }]
      }
    }
    // No phrase-level decomposition — try at minimum to isolate the
    // salient LEGO as its own tile against the rest of the phrase.
    // The salient must always be its own unit; collapsing the whole
    // phrase into one tile (the old fallback) hid the LEGO being
    // practised and made every USE phrase visually identical.
    if (cycle && !isIntroOrDebut && !isCmpCycle) {
      const targetText = useNative ? (cycle.target?.textNative || cycle.target?.text || '') : (cycle.target?.text || '')
      if (!targetText) return []
      const salientId = cycle.legoId || currentRound.value?.legoId || ''
      const salientText = salientId
        ? (useNative ? legoTargetTextNativeMap.value.get(salientId) : null) || legoTargetTextMap.value.get(salientId) || ''
        : ''

      // First try: client-side decomposition against the learner's known
      // vocab. Walks every phrase token and binds each to a previously-
      // introduced LEGO. Produces N tiles (one per LEGO) — chunked
      // rendering per methodology, rather than the before/salient/after
      // ribbon of the substring path. Used most heavily by INFPLAY USE
      // phrases where the backend's `decomposition` array isn't populated.
      // textMap merges round-derived (legoTargetTextMap, fast and current)
      // with course-wide (globalLegoTargetTextMap, loaded once per course
      // mount) so INFPLAY phrases referencing LEGOs whose rounds aren't
      // loaded still resolve. Round-derived wins on conflict (it's the
      // freshest source).
      if (salientId) {
        const roundDerived = useNative ? legoTargetTextNativeMap.value : legoTargetTextMap.value
        const globalDerived = useNative ? globalLegoTargetTextNativeMap.value : globalLegoTargetTextMap.value
        const textMap = new Map<string, string>(globalDerived)
        for (const [id, text] of roundDerived.entries()) textMap.set(id, text)
        const compsMap = useNative ? _componentsByLegoIdNative : _componentsByLegoId
        const decomposed = decomposePhrase({
          targetText,
          salientId,
          textMap,
          componentsByLegoId: compsMap,
        })
        if (decomposed && decomposed.length > 0) {
          const covered = ensureTileCoverage(decomposed, targetText)
          if (covered.length > 0) return covered
        }
      }

      // Second try: substring match of the canonical salient text. Cheap,
      // works for un-inflected LEGOs (Romance languages, English, simple
      // German cases).
      if (salientText && targetText.includes(salientText)) {
        const idx = targetText.indexOf(salientText)
        const before = targetText.slice(0, idx).trim()
        const after = targetText.slice(idx + salientText.length).trim()
        const blocks: LegoBlock[] = []
        if (before) blocks.push({ id: `${salientId}_rest_before`, targetText: before, isSalient: false })
        blocks.push({ id: salientId, targetText: salientText, isSalient: true })
        if (after) blocks.push({ id: `${salientId}_rest_after`, targetText: after, isSalient: false })
        return blocks
      }

      // Second try: atom-position span detection. For M-LEGOs (LEGOs with
      // declared atomic components), each atom is character-exact in the
      // phrase per methodology — even when the canonical M-LEGO text isn't
      // (separable verbs, V2 word order, conjugated participles like
      // "überrascht" inside an M-LEGO whose canonical form is different).
      // We locate each atom's token range independently, take the min/max
      // as the salient's span, and emit before/salient/after with the
      // salient block carrying its components so inserter rendering
      // engages for any non-atom tokens between atoms.
      // CJK skipped — substring-match already works for character-based
      // scripts and this path's word-tokeniser doesn't apply.
      const CJK_RE_LP = /[　-鿿가-힯＀-￯]/
      const PUNCT_RE_LP = /[.,!?;:¡¿'"]+/g
      if (
        salientId &&
        !CJK_RE_LP.test(targetText) &&
        _componentsByLegoId.has(salientId)
      ) {
        const atoms = (useNative ? _componentsByLegoIdNative.get(salientId) : null) || _componentsByLegoId.get(salientId) || []
        if (atoms.length >= 1) {
          // Tokenise the phrase, tracking original-text char offsets.
          const tokStarts: number[] = []
          const tokEnds: number[] = []
          const tokLower: string[] = []
          const tokenRe = /\S+/g
          let tm: RegExpExecArray | null
          while ((tm = tokenRe.exec(targetText)) !== null) {
            const raw = tm[0]
            const cleaned = raw.toLowerCase().replace(PUNCT_RE_LP, '')
            if (cleaned.length === 0) continue
            tokStarts.push(tm.index)
            tokEnds.push(tm.index + raw.length)
            tokLower.push(cleaned)
          }

          // Find each atom's token range — earliest unclaimed match,
          // out-of-order allowed (matches the word-order tolerance in
          // alignComponentsToFullText downstream).
          const claimed = new Set<number>()
          const atomStarts: number[] = []
          const atomEndsExcl: number[] = []
          let allFound = true
          for (const atom of atoms) {
            const atomToks = atom.target.toLowerCase().replace(PUNCT_RE_LP, '').split(/\s+/).filter(Boolean)
            if (atomToks.length === 0) continue
            let foundAt = -1
            outer: for (let i = 0; i <= tokLower.length - atomToks.length; i++) {
              for (let k = 0; k < atomToks.length; k++) {
                if (claimed.has(i + k)) continue outer
                if (tokLower[i + k] !== atomToks[k]) continue outer
              }
              foundAt = i
              break
            }
            if (foundAt === -1) { allFound = false; break }
            for (let k = 0; k < atomToks.length; k++) claimed.add(foundAt + k)
            atomStarts.push(foundAt)
            atomEndsExcl.push(foundAt + atomToks.length)
          }

          if (allFound && atomStarts.length > 0) {
            const spanStartTok = Math.min(...atomStarts)
            const spanEndTokExcl = Math.max(...atomEndsExcl)
            const spanStartChar = tokStarts[spanStartTok]
            const spanEndChar = tokEnds[spanEndTokExcl - 1]
            const before = targetText.slice(0, spanStartChar).trim()
            const salientPhrase = targetText.slice(spanStartChar, spanEndChar).trim()
            const after = targetText.slice(spanEndChar).trim()
            const blocks: LegoBlock[] = []
            if (before) blocks.push({ id: `${salientId}_rest_before`, targetText: before, isSalient: false })
            blocks.push({
              id: salientId,
              targetText: salientPhrase,
              isSalient: true,
              // Strip known text — only intro/debut shows it (LegoAssembly
              // gates the known-row render on isIntroOrDebut).
              components: atoms.map(a => ({ known: '', target: a.target })),
            })
            if (after) blocks.push({ id: `${salientId}_rest_after`, targetText: after, isSalient: false })
            return blocks
          }
        }
      }

      // Last resort: whole phrase as one tile. Reached when no atoms could
      // be located (A-LEGOs with inflected forms, CJK with non-substring
      // match, content gaps where _componentsByLegoId hasn't loaded the
      // salient yet).
      console.warn(
        `[displayBlocks] Single-tile fallback (non-intro/non-cmp): decomposePhrase + substring + atom-position all failed.`,
        {
          phrase: targetText,
          salientId,
          salientText,
          hasAtoms: salientId ? _componentsByLegoId.has(salientId) : false,
          vocabSize: legoTargetTextMap.value.size,
          globalVocabSize: globalLegoTargetTextMap.value.size,
          cycleType: (cycle?.type || ''),
        },
      )
      return [{ id: salientId || 'phrase', targetText, isSalient: false }]
    }
    // Golden rule: if audio will play, text must be present. Whatever
    // failed above (missing legoId, missing componentLegoIds, empty
    // targetText after the useNative dance), fall back to the cycle's
    // own target text as a single tile. Never render audio with a
    // blank screen.
    const fallbackText = cycle.target?.text || cycle.target?.textNative || ''
    if (fallbackText) {
      const fallbackId = cycle.legoId || currentRound.value?.legoId || cycle.id || 'phrase'
      console.warn(
        `[displayBlocks] Last-resort fallback (intro/debut/cmp branch fell through): emitting whole phrase as single salient tile.`,
        {
          phrase: fallbackText,
          fallbackId,
          cycleType: (cycle.type || ''),
          isIntroOrDebut,
          isCmpCycle,
          hasLegoId: !!currentRound.value?.legoId,
          knownText: cycleKnownText,
        },
      )
      return [{ id: fallbackId, targetText: fallbackText, isSalient: true }]
    }
    return []
  }
  // Use the cycle's own legoId (the LEGO this phrase practises), not the round's
  const salientLegoId = cycle.legoId || currentRound.value?.legoId || ''
  const texts: string[] = (useNative ? cycle.componentLegoTextsNative : null) || cycle.componentLegoTexts || []
  const textMap = useNative ? legoTargetTextNativeMap.value : legoTargetTextMap.value
  // Same-script fallback. textMapFallback used to be the roman map
  // unconditionally — in native mode that produced cross-script blocks
  // (block targetText='wakaranai', phrase tileText='分からない'), which
  // ensureTileCoverage then fails to align ('block not found in remaining
  // phrase'). Pull from the global map of the SAME script instead.
  const textMapFallback = useNative
    ? globalLegoTargetTextNativeMap.value
    : globalLegoTargetTextMap.value
  // Show known text only during intro and debut — the M-LEGO's first
  // appearance as a standalone unit. BUILDs and USEs (including the rare
  // case where a USE happens to have target text identical to the parent
  // LEGO's target — e.g. a single-word LEGO with a one-word USE) are
  // production practice; the per-component known mapping there is clutter.
  // In infinite play this rule naturally suppresses known entirely because
  // there are no intro/debut cycles — only USEs and spaced_reps.
  const cycleType = (cycle.type || '') as string
  const showKnown = cycleType === 'intro' || cycleType === 'debut'
  const knownMap = showKnown ? legoKnownTextMap.value : null
  const rawBlocks = cycle.componentLegoIds
    .map((id: string, idx: number) => {
      const targetText = texts[idx] || textMap.get(id) || textMapFallback.get(id) || ''
      // Skip blocks with no text — ensureTileCoverage will fill gaps from the phrase
      if (!targetText) return null
      const rawComps = useNative
        ? (_componentsByLegoIdNative.get(id) || _componentsByLegoId.get(id))
        : _componentsByLegoId.get(id)
      // Strip known text from components when not in a "show known" cycle — stubs still render
      const comps = rawComps
        ? (showKnown ? rawComps : rawComps.map(c => ({ known: '', target: c.target })))
        : undefined
      const knownText = (knownMap && id === salientLegoId) ? knownMap.get(id) : undefined
      return {
        id, targetText, isSalient: id === salientLegoId,
        ...(soloComponentIds.value.has(id) ? { isSoloComponent: true } : {}),
        ...(comps ? { components: comps } : {}),
        ...(knownText ? { knownText } : {}),
      }
    })
    .filter((b: LegoBlock | null): b is LegoBlock => b !== null)

  const tileText = useNative ? (cycle.target?.textNative || cycle.target?.text || '') : (cycle.target?.text || '')
  // Gap-fill but DO NOT absorb. Words not covered by a declared LEGO are
  // legitimate "grokable encounters" (any word seen inside any earlier
  // M-LEGO becomes grokable per SSi methodology). They render as their
  // own ghost tiles in LegoAssembly — never fused into adjacent LEGOs,
  // which would manufacture false units like [fratello vuole].
  const result = ensureTileCoverage(rawBlocks, tileText)

  // Fallback: if decomposition fails, show the full phrase as a single tile.
  // The audio still plays — the learner must see what they hear.
  if (result.length === 0 && tileText) {
    return [{ id: salientLegoId || 'phrase', targetText: tileText, isSalient: false }]
  }
  return result
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
 * Resolve resume position from localStorage against a rounds array.
 * Returns { roundIndex, cycleIndex } the player should jump to on cold
 * open, or null if there's no usable local cursor (no saved position,
 * stale, or its LEGO isn't in this course's rounds).
 *
 * Single source of truth for resume across guests + signed-in. The
 * old "guest defaults to LEGO 1" path bypassed localStorage entirely
 * — this helper makes the same lookup work for everyone, so a guest
 * who played a session genuinely resumes where they were. Server
 * sync (signed-in cross-device) overwrites localStorage before this
 * runs; localStorage is the only thing playback actually reads.
 * Tom 2026-05-26.
 */
const resolveResumePosition = (rounds: any[]): { roundIndex: number; cycleIndex: number } | null => {
  const localPos = loadPositionFromLocalStorage()
  if (!localPos?.legoId || !Array.isArray(rounds)) return null
  const idx = rounds.findIndex((r: any) => r?.legoId === localPos.legoId)
  if (idx < 0) return null
  return { roundIndex: idx, cycleIndex: Math.max(0, localPos.itemInRound || 0) }
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

// Watch for approaching end of loaded rounds - trigger expansion.
// Uses simplePlayer.roundCount as the source of truth: cachedRounds
// is only populated on the legacy path and stays empty on the modern
// SessionController path, but simplePlayer.roundCount reflects the
// rounds actually queued for playback in both paths. This is what
// the user can hit with skip/advance, so it's the right cutoff.
watch(currentRoundIndex, async (index) => {
  if (!positionInitialized.value) return
  const loaded = simplePlayer.roundCount.value
  if (loaded === 0) return

  const remaining = loaded - index
  if (remaining <= EXPANSION_THRESHOLD && !isExpandingScript.value) {
    console.log(`[LearningPlayer] Approaching end (${remaining} rounds left of ${loaded}), expanding...`)
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

  // For INTRO and COMPONENT_INTRO items, we don't validate here - intro audio is handled separately
  if (scriptItem?.type === 'intro' || scriptItem?.type === 'component_intro') return true

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
  } else if (scriptItem.type === 'component_intro' && scriptItem.target1Id) {
    // Component intros have target1Id/target2Id as bare UUIDs (no audioRefs)
    // Resolve directly via proxy URL — presentation audio handled by playIntroductionAudioDirectly
    target1AudioUrl = `/api/audio/${scriptItem.target1Id}`
    target2AudioUrl = scriptItem.target2Id ? `/api/audio/${scriptItem.target2Id}` : undefined
    console.log('[scriptItemToPlayableItem] Component intro resolved from UUIDs:', { target1AudioUrl, target2AudioUrl })
  } else {
    // Fallback: Look up audio URLs from cache (lazy loaded)
    knownAudioUrl = await getAudioUrlFromCache(
      supabase?.value,
      scriptItem.knownText,
      'known',
      (scriptItem.type === 'intro' || scriptItem.type === 'component_intro') ? scriptItem : null,
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
  progressStore: progressStore,
  sessionStore: sessionStore,
  // Direct supabase ref for the speaking-opportunities RPC — bypasses
  // sessionStore which has had chronic null-at-runtime issues.
  supabase: supabase,
  courseDataProvider: courseDataProvider,
  learnerId: learnerId,
  courseId: courseCode,
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
// LISTENING POD LAP SCHEDULER (Layer 2 — runtime, ratchet-driven)
// Replaces the old script-baked pod emission. Fires between rounds when
// the user has crossed pod_activation_round, plays the lap composed from
// completed_pod_rounds + 1, and increments the ratchet on completion.
// ============================================
const podScheduler = supabase?.value
  ? usePodLapScheduler({
      supabase: supabase as any,
      courseCode: courseCode,
      learnerId: learnerId,
      // Live from algorithm_config.pods — admin tweaks land on next lap.
      stagePlaylist: computed(() => podsConfig.value.stagePlaylist),
      stageDuration: computed(() => podsConfig.value.stageDuration),
      // Pod-lap cadence — lives alongside the stage playlist + gap matrix
      // on the pods config (semantically all "how pods behave" lives here).
      roundInterval: computed(() => podsConfig.value.roundInterval ?? 1),
    })
  : null
const playingPodLapAudio = ref(false)
// Set true when the learner presses stop *during* a pod lap or commentary.
// handleRoundBoundary checks this before calling simplePlayer.resume() so a
// deliberate stop doesn't auto-advance into the next round mid-pod.
const userStoppedDuringLap = ref(false)
// Set true when the learner presses skip *during* a pod lap. Distinct from
// userStoppedDuringLap: skip means "advance to the next round" (so resume
// fires), stop means "stay paused". In Turbo mode a skip also bumps the
// pod ratchet so the same sentences don't resurface; in regular mode the
// ratchet stays put so the listening work still has to be done.
const podLapSkippedByUser = ref(false)
// When the learner stops *during* a pod lap, we bookmark the lap here so
// the next play tap re-fires it (with omitIntro=true so the bookend
// doesn't double up). Without this, SimplePlayer was already parked at
// end-of-round-N when the lap started, so a plain resume() would advance
// straight to round N+1 and silently drop the lap until the next round
// completes — which felt like "stop in listening = skipped to next round".
const pendingLapResume = ref<PodLap | null>(null)
// Set true when SimplePlayer fires session_complete (the LAST round just
// finished). If this fires while a pod lap is still in-flight, we defer
// the summary screen until the lap finishes — otherwise showPausedSummary
// would tear down audioEngaged mid-lap and iOS would drop the session.
const sessionEnded = ref(false)

// Session-wide iOS audio-session keepalive is wired further down — see
// the useAudioSessionKeepalive call after isPlayingIntroduction +
// isPlayingWelcome are declared. Putting it here would cause a TDZ
// reference error since those refs come later in the setup script.
// Initialize once we know the course; re-init when course changes
watch(
  () => [courseCode.value, learnerId.value],
  async () => {
    if (podScheduler) await podScheduler.initialize()
  },
  { immediate: true }
)

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
const currentBelt = computed(() => beltProgress.value?.currentBelt.value ?? { name: 'white', seedsRequired: 0, color: '#ffffff', colorDark: '#e0e0e0', glow: 'rgba(255, 255, 255, 0.3)', index: 0 })
const playingBelt = computed(() => beltProgress.value?.playingBelt.value ?? { name: 'white', seedsRequired: 0, color: '#ffffff', colorDark: '#e0e0e0', glow: 'rgba(255, 255, 255, 0.3)', index: 0 })
const nextBelt = computed(() => beltProgress.value?.nextBelt.value ?? null)
const previousBelt = computed(() => beltProgress.value?.previousBelt.value ?? null)

// Skip nav: next/prev belts relative to PLAYING position (not highest achieved)
const playingNextBelt = computed(() => {
  const idx = playingBelt.value.index + 1
  if (idx >= BELTS.length) return null
  return { ...BELTS[idx], index: idx }
})

// "Would tapping forward-skip right now land the learner in INF PLAY?"
// True when (a) we're already in INF PLAY mode, or (b) the course
// doesn't extend into the next belt — i.e. handleSkipToNextBelt would
// enter INF PLAY via its `enterInfplay = !nextBeltThreshold ||
// nextBeltThreshold > courseMaxSeed` branch. Drives the button morph
// from chevron → "∞ INF PLAY" pill in the same forward-skip slot.
const wouldEnterInfplay = computed(() => {
  if (currentMode.value === 'infplay') return true
  const next = playingNextBelt.value
  if (!next) return true  // already past the last belt in the enum

  // LEGO-based end-of-course detection. The course's final LEGO is
  // what defines "end of course"; its parent seed determines which
  // belt has the last content. If the learner is at or past that
  // belt visually, the forward-skip slot morphs into "∞ INF PLAY"
  // and tapping it enters infplay rather than jumping to an empty
  // next belt.
  //
  // We deliberately stopped using seed-threshold math
  // (next.seedsRequired > courseMaxSeed) because:
  //   1. courseSeedCount could resolve as null/undefined, defaulting
  //      to a heuristic that didn't match short courses, causing the
  //      button to keep advancing into empty belts instead of
  //      offering INF PLAY entry.
  //   2. Seeds are an accounting unit. LEGO ids are the unit of
  //      learning, and encode their parent seed (S0048L02 = seed 48,
  //      lego 2) so we can derive belt from LEGO id directly.
  const finalLegoId = courseFinalLegoRef.value?.legoId
  if (finalLegoId) {
    const finalSeed = getSeedFromLegoId(finalLegoId)
    if (finalSeed !== null) {
      const finalBeltIdx = getBeltIndexForSeed(finalSeed)
      return playingBelt.value.index >= finalBeltIdx
    }
  }

  // Fallback for the brief window before getCourseFinalLego resolves
  // (or in environments without a Supabase client): treat "no further
  // belt in the enum" as the cue. Matches the previous default.
  return false
})

// Lifetime "has been in INF PLAY at least once" — counter is never
// reset on back-belt-skip out, so this is the persistent signal.
// Drives jumpToFurthest semantics and lets the pill show the count
// ("INF PLAY · 47") even when learner is currently in main mode.
const hasEverEnteredInfplay = computed(() =>
  currentMode.value === 'infplay' || infplayRoundIndex.value > 0
)

const playingPrevBelt = computed(() => {
  const idx = playingBelt.value.index - 1
  if (idx < 0) return null
  return { ...BELTS[idx], index: idx }
})

// Calculate which belt the "back" button will go TO.
// Unified rule: always the belt below the current visual playing belt.
// On White belt, stays on White (button is disabled by the template guard).
// Works the same in main loop and INF PLAY — in INF PLAY this is "exit
// + step down one belt from where you visually are", not "go to the
// highest LEGO" (which would land you in the same belt because the
// INF PLAY entry ratchets highest_lego to the course's final LEGO).
const backTargetBelt = computed(() => {
  return playingPrevBelt.value ?? playingBelt.value
})

// Belt skip loading state: true when target belt's first round is NOT yet loaded
// Belt skip buttons flash until their target rounds are available
const nextBeltLoading = computed(() => {
  const nb = playingNextBelt.value
  if (!nb) return false
  return simplePlayer.findRoundIndexForSeed(nb.seedsRequired) < 0
})

const prevBeltLoading = computed(() => {
  const bt = backTargetBelt.value
  if (!bt) return false
  const targetSeed = bt.seedsRequired === 0 ? 1 : bt.seedsRequired
  return simplePlayer.findRoundIndexForSeed(targetSeed) < 0
})

const beltProgressPercent = computed(() => beltProgress.value?.beltProgress.value ?? 0)
const seedsToNextBelt = computed(() => beltProgress.value?.seedsToNextBelt.value ?? 8)
const timeToNextBelt = computed(() => beltProgress.value?.timeToNextBelt.value ?? 'Keep learning to see estimate')
const beltJourney = computed(() => beltProgress.value?.beltJourney.value ?? [])

// CSS custom properties for belt theming
const beltCssVars = computed(() => {
  return beltProgress.value?.beltCssVars.value ?? {
    '--belt-color': '#ffffff',
    '--belt-color-dark': '#e0e0e0',
    '--belt-glow': 'rgba(255, 255, 255, 0.3)',
  }
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

    // Set actual course seed count so only reachable belts are shown
    if (courseDataProvider.value) {
      const maxSeed = await courseDataProvider.value.getMaxSeedNumber()
      if (maxSeed) {
        beltProgress.value.setCourseSeedCount(maxSeed)
        console.log('[LearningPlayer] Course seed count:', maxSeed, '- available belts:', beltProgress.value.availableBelts.value.length)
      }
    }

    console.log('[LearningPlayer] Belt progress initialized for', courseCode.value, '- seeds:', beltProgress.value.completedRounds.value)
  }
}

/**
 * Initialize per-LEGO adaptive pause engine.
 * Safe for guests (engine runs in memory, no Supabase reads/writes).
 */
const initializeAdaptationEngine = async () => {
  if (!courseCode.value || adaptationEngine.value) return
  const engine = useAdaptationEngine({
    supabase: supabase.value ?? null,
    learnerId: learnerId.value ?? null,
    courseCode: courseCode.value,
  })
  await engine.initialize()
  adaptationEngine.value = engine
}

/**
 * Initialize per-seed L1 fire-count persistence so the Stage 1→4
 * playlist progression compounds across sessions.
 */
const initializeListeningProgress = async () => {
  if (!courseCode.value || listeningProgress.value) return
  const progress = useListeningProgress({
    supabase: supabase.value ?? null,
    learnerId: learnerId.value ?? null,
    courseCode: courseCode.value,
  })
  await progress.initialize()
  listeningProgress.value = progress
}

/**
 * Initialize belt loader for progressive loading
 * Call after belt progress is initialized to know starting position
 */
const initializeBeltLoader = async () => {
  if (!courseCode.value || !beltProgress.value || beltLoader.value) return

  console.log('[LearningPlayer] Initializing belt loader...')

  // Script chunk generator — preserved as a wrapper for useBeltLoader's
  // interface, but now always returns the full course. The chunk-by-seed
  // pattern is gone (it was the cause of the L1-listening silent-fail bug).
  // beltLoader receives the same rounds every call; no incremental loading
  // happens here any more. Eventually useBeltLoader should be simplified
  // to a single load — until then this preserves the contract.
  const generateScriptChunk = async (_startSeed: number, _count: number) => {
    if (!supabase?.value) return { rounds: [] as any[], nextSeed: 1, hasMore: false }
    const result = await generateScript()
    if (result.hasRomanizedText) hasRomanizedText.value = true
    const rounds = toSimpleRoundsWithComponents(result.items)
    return {
      rounds: rounds as any[],
      nextSeed: 9999,
      hasMore: false,
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
// Belt promotions, encouragements, mode tips
// ============================================

// Track rounds completed in this session
const roundsThisSession = ref(0)
const beltJustEarned = ref(null)

// Mode discovery tips (shown between rounds, one at a time)
const modeTip = ref<{ mode: string; label: string; desc: string } | null>(null)

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
  logEvent('commentary_start', {
    type: commentary.type ?? null,
    textPreview: typeof commentary.text === 'string' ? commentary.text.substring(0, 80) : null,
  })

  // Reset cancellation flag for this commentary play. Mirrors the same
  // pattern as playPodLap so togglePlayback / handleSkip can cancel
  // commentary mid-clip and have handleRoundBoundary advance promptly
  // instead of waiting on the 60s safety timeout.
  podLapCancelled.value = false

  return new Promise((resolve) => {
    const audio = audioController.value
    let cancelPoll: ReturnType<typeof setInterval> | null = null
    let safetyTimeout: ReturnType<typeof setTimeout> | null = null
    let settled = false

    const cleanup = () => {
      audio.offEnded(onEnded)
      if (cancelPoll) { clearInterval(cancelPoll); cancelPoll = null }
      if (safetyTimeout) { clearTimeout(safetyTimeout); safetyTimeout = null }
    }

    const finish = (reason: 'natural' | 'error' | 'cancelled' | 'safety_timeout', success: boolean) => {
      if (settled) return
      settled = true
      cleanup()
      playingCommentaryAudio.value = false
      logEvent('commentary_end', { reason, type: commentary.type ?? null })
      resolve(success)
    }

    // Create a one-time ended handler
    const onEnded = () => finish('natural', true)

    audio.onEnded(onEnded)

    // Play the commentary audio
    audio.play({
      id: commentary.id,
      url: commentary.url,
      duration_ms: commentary.duration_ms,
    }).catch((err) => {
      console.error('[LearningPlayer] Commentary audio error:', err)
      finish('error', false)
    })

    // Cancellation poll — handleSkip / togglePlayback set podLapCancelled
    // when the user wants commentary to stop. 100ms is fine-grained
    // enough that a tap feels responsive.
    cancelPoll = setInterval(() => {
      if (settled || !podLapCancelled.value) return
      try { audio.stop() } catch {}
      finish('cancelled', false)
    }, 100)

    // Safety timeout — deadlock breaker for the case where audio.onEnded
    // never fires (mobile Safari quirks, silent load failures, etc.). NOT
    // a "commentary must finish in N seconds" cap. Sized to the clip's
    // actual duration plus a 10s buffer for codec/buffering slack, with a
    // 60s floor for clips without metadata. The fixed 60s cap previously
    // here cut off a 58–62s instruction by milliseconds on every play.
    const expectedMs = commentary.duration_ms ?? 0
    const safetyMs = Math.max(60_000, expectedMs + 10_000)
    safetyTimeout = setTimeout(() => {
      if (settled) return
      try { audio.stop() } catch {}
      finish('safety_timeout', false)
    }, safetyMs)
  })
}

/**
 * Explicit cancellation flag for pod laps. Set to true when the learner
 * presses stop during a pod (togglePlayback), reset at the start of each
 * lap. playPodSegment polls this and resolves false when set, so a user
 * stop ends the segment immediately rather than waiting on the 30s
 * safety timeout. We use this rather than audioController.playGeneration
 * because every audio.play() internally calls stop() (bumping the gen),
 * which would otherwise trigger spurious cancellations from the lap's
 * own play calls.
 */
const podLapCancelled = ref(false)

/**
 * Play a single pod-lap audio segment (one bookend or one pod play).
 * Uses the same audioController as commentary. Resolves on ended/error.
 */
type PodSegmentReason = 'natural' | 'cancelled' | 'safety_timeout'
type PodSegmentResult = { ok: boolean; reason: PodSegmentReason }

const playPodSegment = async (audioId: string, durationMs?: number, playbackSpeed = 1.0): Promise<PodSegmentResult> => {
  if (!audioId || !audioController.value) return { ok: false, reason: 'safety_timeout' }
  const audio = audioController.value
  return new Promise((resolve) => {
    let cancelPoll: ReturnType<typeof setInterval> | null = null
    let safetyTimeout: ReturnType<typeof setTimeout> | null = null
    let settled = false
    const cleanup = () => {
      audio.offEnded(onEnded)
      try { (audio as any).setPlaybackRate?.(1.0) } catch {}
      if (cancelPoll) clearInterval(cancelPoll)
      if (safetyTimeout) clearTimeout(safetyTimeout)
    }
    const finish = (result: PodSegmentResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    // AudioController._notifyEnded fires onEnded for BOTH natural-end AND
    // load/play errors (it has no error callback path). So this resolves
    // ok:true for both — we can't tell them apart from here. Per-play
    // telemetry in playPodLap lets us see latency anomalies that suggest
    // failed plays without bailing out the whole lap on transient errors.
    const onEnded = () => finish({ ok: true, reason: 'natural' })
    audio.onEnded(onEnded)
    try {
      ;(audio as any).setPlaybackRate?.(playbackSpeed)
    } catch {}
    audio.play({ id: audioId, url: `/api/audio/${audioId}?courseId=${encodeURIComponent(courseCode.value)}`, duration_ms: durationMs })
      .catch((err: any) => {
        console.warn('[LearningPlayer] Pod segment audio error:', err?.message || err)
        finish({ ok: false, reason: 'safety_timeout' })
      })
    cancelPoll = setInterval(() => {
      if (podLapCancelled.value) {
        // User stop signal — abort and stop the audio so it doesn't keep
        // playing in the background after we've released the promise.
        try { audio.stop() } catch {}
        finish({ ok: false, reason: 'cancelled' })
      }
    }, 100)
    safetyTimeout = setTimeout(() => {
      finish({ ok: false, reason: 'safety_timeout' })
    }, 30000)
  })
}

/**
 * Inter-play gap matrix per Aran's 2026-05-05 spec.
 *
 * Within ONE chunk's playlist (target → known → target → target):
 *   target → known   = TIGHT       — slight beat for translation transition
 *   known → target   = SUPER_TIGHT — comparison wants immediacy
 *   target → target  = SUPER_TIGHT — reinforcement reps flow
 *
 * Between chunks (one chunk's last play → next chunk's first play):
 *   glued at eternal stage = 0ms — sew them together at the single-2× rep
 *   glued earlier         = GLUED — small breath, still close-coupled
 *   not glued             = BETWEEN — Aran's "between phrases" pause
 */
// Inter-play gap matrix — values come live from algorithm_config.pods so
// admin tweaks land on the next lap. Aran's 2026-05-05 defaults are kept
// as fallback in DEFAULT_PODS (useAlgorithmConfig). The "eternal stage"
// is the highest-numbered key in stagePlaylist (was 7, will become 8
// after the new stage 2 ships, may shift again as Aran tunes).
const eternalStage = computed(() => {
  const keys = Object.keys(podsConfig.value.stagePlaylist || {}).map(Number).filter(n => !Number.isNaN(n))
  return keys.length > 0 ? Math.max(...keys) : 7
})
const podGapMs = (curr: PodPlay, next: PodPlay | null): number => {
  if (!next) return 0
  const gaps = podsConfig.value
  // Same chunk → role transition decides
  if (curr.sentenceIdx === next.sentenceIdx) {
    const c = curr.playRole // 'ps' or 'ps2x' = target; 'trans' = known
    const n = next.playRole
    const cIsTarget = c === 'ps' || c === 'ps2x'
    const nIsTarget = n === 'ps' || n === 'ps2x'
    if (cIsTarget && n === 'trans') return gaps.gapTightMs       // target → known
    if (c === 'trans' && nIsTarget) return gaps.gapSuperTightMs  // known → target
    return gaps.gapSuperTightMs                                   // target → target
  }
  // Different chunk — glue + stage decide
  if (curr.glueToNextChunk) {
    return curr.stage === eternalStage.value ? 0 : gaps.gapGluedMs
  }
  return gaps.gapBetweenMs
}

const podDelay = (ms: number) => ms <= 0
  ? Promise.resolve()
  : new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Play a full pod lap (intro bookend → all plays → outro bookend).
 * Returns true iff the lap played to completion (so the ratchet should advance).
 * Caller is responsible for pausing/resuming simplePlayer around this.
 *
 * Pod audio is reused many times per pod-round → the cache-based bundle
 * download path owns prefetch (lives in IndexedDB, served as blob: URLs
 * by AudioController.audioSource). No per-lap prefetch is done here; if
 * audio isn't cached yet, the gap manifests audibly and shows up in
 * audio_play telemetry as a long `elapsedMs`.
 */
const playPodLap = async (lap: PodLap, omitIntro: boolean = false): Promise<boolean> => {
  podLapCancelled.value = false
  podLapSkippedByUser.value = false
  playingPodLapAudio.value = true

  const courseId = encodeURIComponent(courseCode.value)
  const audioUrlFor = (id: string) => `/api/audio/${id}?courseId=${courseId}`

  let playsCompleted = 0
  let abortReason: 'completed' | 'audio_error' | 'cancelled' | 'safety_timeout' = 'completed'

  logEvent('pod_lap_start', {
    podRound: lap.podRound,
    plays: lap.plays.length,
    omitIntro,
  })

  const handleSegmentResult = (
    result: PodSegmentResult,
    payload: Record<string, unknown>,
  ): boolean => {
    // Emit per-play telemetry mirroring the main-cycle audio_play shape.
    // elapsedMs lets us spot plays that ended unnaturally fast (load
    // error masquerading as natural end via _notifyEnded) or slowly
    // (cold cache, prefetch missed).
    logEvent('audio_play', payload)
    if (result.ok) {
      playsCompleted++
      return true
    }
    abortReason = result.reason === 'cancelled' ? 'cancelled' : 'safety_timeout'
    return false
  }

  const startedAt = Date.now()

  try {
    if (lap.intro && !omitIntro) {
      const segStart = Date.now()
      const cacheHit = audioCache.has(lap.intro.id)
      const result = await playPodSegment(lap.intro.id, lap.intro.duration_ms, 1.0)
      const ok = handleSegmentResult(result, {
        url: audioUrlFor(lap.intro.id),
        role: 'pod_intro',
        cycleType: 'pod_intro',
        legoId: null,
        seedId: null,
        playbackSpeed: 1.0,
        podRound: lap.podRound,
        elapsedMs: Date.now() - segStart,
        reason: result.reason,
        cacheHit,
      })
      if (!ok) return false
      // Intro → first play: between-phrases pause, gives the bookend room
      await podDelay(podsConfig.value.gapBetweenMs)
    }
    for (let i = 0; i < lap.plays.length; i++) {
      const play = lap.plays[i] as PodPlay
      const next = (i + 1 < lap.plays.length) ? (lap.plays[i + 1] as PodPlay) : null
      const segStart = Date.now()
      const cacheHit = audioCache.has(play.audioId)
      const result = await playPodSegment(play.audioId, undefined, play.playbackSpeed)
      const ok = handleSegmentResult(result, {
        url: audioUrlFor(play.audioId),
        role: play.playRole,
        cycleType: 'pod_play',
        legoId: null,
        seedId: null,
        playbackSpeed: play.playbackSpeed,
        podRound: lap.podRound,
        playIndex: i,
        sentenceIdx: play.sentenceIdx,
        stage: play.stage,
        elapsedMs: Date.now() - segStart,
        reason: result.reason,
        cacheHit,
      })
      if (!ok) return false
      if (next) {
        await podDelay(podGapMs(play, next))
      } else if (lap.outro) {
        // Last play → outro: between-phrases pause before the bookend
        await podDelay(podsConfig.value.gapBetweenMs)
      }
    }
    if (lap.outro) {
      const segStart = Date.now()
      const cacheHit = audioCache.has(lap.outro.id)
      const result = await playPodSegment(lap.outro.id, lap.outro.duration_ms, 1.0)
      const ok = handleSegmentResult(result, {
        url: audioUrlFor(lap.outro.id),
        role: 'pod_outro',
        cycleType: 'pod_outro',
        legoId: null,
        seedId: null,
        playbackSpeed: 1.0,
        podRound: lap.podRound,
        elapsedMs: Date.now() - segStart,
        reason: result.reason,
        cacheHit,
      })
      if (!ok) return false
    }
    return true
  } finally {
    playingPodLapAudio.value = false
    logEvent('pod_lap_end', {
      podRound: lap.podRound,
      cancelled: podLapCancelled.value,
      skippedByUser: podLapSkippedByUser.value,
      stoppedByUser: userStoppedDuringLap.value,
      playsCompleted,
      playsExpected: lap.plays.length,
      abortReason,
      elapsedMs: Date.now() - startedAt,
    })
  }
}

/**
 * Update belt progress based on current position in course
 * Belts are POSITION-based, not completion-based
 * This allows learners to skip ahead and calibrate quickly
 *
 * @param roundIndex - Current round position (0-based, relative to loaded batch)
 * @param showCelebration - Whether to show belt promotion celebration
 */
const updateBeltForPosition = (roundIndex) => {
  if (!beltProgress.value) return
  // Use the visual helper — for main-loop rounds returns round.legoId,
  // for infplay rounds returns lastMainLoopLegoId. Without this the
  // single-chevron skip during infplay made the belt bounce around as
  // each random USE legoId was treated as the new "position".
  const round = loadedRounds.value?.[roundIndex]
  const legoId = visualLegoIdForRound(round)
  if (!legoId) return
  const seed = getSeedFromLegoId(legoId)
  if (seed === null) return
  beltProgress.value.setPlayingPosition(seed)
}

// Handle round boundary - called when a round completes
const handleRoundBoundary = async (completedRoundIndex, completedLegoId, completedRound = null) => {
  roundsThisSession.value++

  // Did the round we just finished contain a Layer 1 listen cluster? If so,
  // the L2 pod lap should drop its intro bookend so the two clusters play
  // as one continuous listening section. Pairs with the omitOutro flag in
  // emitL1Cluster (script side).
  const l1FiredThisRound = !!completedRound?.cycles?.some(
    (c: { type?: string }) => c.type === 'listen_intro' || c.type === 'listening' || c.type === 'listen_outro'
  )

  // Update belt progress to match current position (NO celebration during play - manual only)
  updateBeltForPosition(completedRoundIndex)

  // ============================================
  // META-COMMENTARY: Instructions & Encouragements
  // Check if it's time for audio commentary between rounds
  // Timing is CYCLE-based (consistent ~11s), but plays at round boundaries
  // ============================================
  if (metaCommentary && !beltJustEarned.value) {
    // Round-cadence gating lives in MetaCommentaryService (every Nth round).
    // No more cycle counting or performance heuristics from the player side —
    // the previous version had hardcoded perf inputs that pushed the cadence
    // multiplier toward "doing well" and effectively silenced commentary.
    const commentary = metaCommentary.onRoundComplete(completedRoundIndex + 1)

    if (commentary) {
      console.log('[LearningPlayer] Playing', commentary.type, 'commentary')

      // Pause the player so the next round doesn't start while commentary plays
      simplePlayer.pause()

      // Play the commentary audio
      await playCommentaryAudio(commentary)

      // Mark commentary as complete and resume learning — unless the learner
      // pressed stop during commentary, in which case stay paused.
      metaCommentary.finishCommentaryPlayback()
      if (userStoppedDuringLap.value) {
        userStoppedDuringLap.value = false
      } else {
        simplePlayer.resume()
      }
    }
  }

  // ============================================
  // LISTENING POD LAP (Layer 2 — runtime, ratchet-driven)
  // Fires between rounds when learner has crossed activation. Lap is keyed
  // off completed_pod_rounds + 1, NOT main round arithmetic. Only advances
  // the ratchet when the lap plays to completion.
  // ============================================
  if (podScheduler && podScheduler.isInitialized.value && !beltJustEarned.value) {
    const completedMainRound = (completedRoundIndex || 0) + 1

    // Look one round ahead: if the round about to start will end with a
    // pod, warm its audio now. The round gives ~5 min of runway —
    // comfortable for any working network.
    //
    // We land bytes in IndexedDB via audioCache.persistent.ensure so
    // pod playback gets blob URLs through the AudioCacheSource adapter
    // (same path the cycle player uses post-63cae57d). Skips SW
    // round-trip per play — matters for the stage-driven gapless
    // playback that pod laps depend on (per the asset + program
    // architecture model).
    if (podScheduler.shouldFireLapAt(completedMainRound + 1)) {
      podScheduler.prefetchLap((id) => audioCache.persistent.ensure(id))
    }

    if (podScheduler.shouldFireLapAt(completedMainRound)) {
      const lap = podScheduler.nextLap()
      if (lap) {
        console.log(`[LearningPlayer] Playing pod lap ${lap.podRound} (${lap.plays.length} plays)`)
        simplePlayer.pause()
        const completed = await playPodLap(lap, l1FiredThisRound)
        // Ratchet writes are fire-and-forget — awaiting the Supabase
        // round-trip put a 200-1000ms silence between the lap outro and
        // the next round's intro on mobile networks. The audible audio
        // pipeline shouldn't block on a write that doesn't affect the
        // next round; if the write fails the ratchet just doesn't bump
        // and the same lap plays next session, which is acceptable.
        if (completed) {
          podScheduler.markLapCompleted().catch((err) => {
            console.warn('[LearningPlayer] markLapCompleted failed (will retry next session):', err)
          })
        } else if (podLapSkippedByUser.value && turboActive.value) {
          // Turbo skip: bump the ratchet so the same sentences don't keep
          // resurfacing. Regular skip leaves the counter — listening work
          // still has to be done next session.
          podScheduler.skipAhead(1).catch((err) => {
            console.warn('[LearningPlayer] skipAhead failed (will retry next session):', err)
          })
          console.log('[LearningPlayer] Pod lap skipped in Turbo, ratchet advanced')
        } else {
          // Regular skip, audio error, or user stop — counter stays so the
          // same lap plays next session ("the listening work has to be done").
          console.log('[LearningPlayer] Pod lap not completed, ratchet unchanged')
        }
        podLapSkippedByUser.value = false
        // Resume into the next round — unless one of these has happened:
        //   • session_complete fired while the lap was playing → try
        //     to expand the script and resume; only fall through to
        //     the quiet pause if expansion genuinely produces nothing
        //     (infinite play means the course should never end)
        //   • the learner pressed stop during the lap → stay paused
        if (sessionEnded.value) {
          const added = await expandScript()
          if (added > 0) {
            sessionEnded.value = false
            simplePlayer.resume()
          } else {
            showPausedSummary()
          }
        } else if (userStoppedDuringLap.value) {
          // Bookmark the lap so the next play tap re-fires it instead of
          // skipping silently into round N+1. Re-fire uses omitIntro=true
          // so the bookend doesn't double up.
          userStoppedDuringLap.value = false
          pendingLapResume.value = lap
        } else {
          simplePlayer.resume()
        }
      }
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

  // Mode discovery tips — show between rounds after a minimum threshold
  // Each mode is suggested once per session at a random interval
  maybeShowModeTip()
}

// Mode tips — shown between rounds, one per mode per session, with randomness
const MODE_TIPS = [
  { mode: 'listening', key: 'ssi-mode-listening', label: 'Listening Mode', desc: 'Passive review — let phrases wash over you while you relax' },
  { mode: 'pronunciation', key: 'ssi-mode-pronunciation', label: 'Pronunciation Practice', desc: 'Record yourself and compare with native speakers' },
  { mode: 'driving', key: 'ssi-mode-driving', label: 'Driving Mode', desc: 'Hands-free learning — perfect for the car or a walk' },
]
const tipsShownThisSession = new Set<string>()
// Each tip has a minimum round threshold + random jitter so they don't all appear together
const TIP_SCHEDULE = { listening: 7, pronunciation: 14, driving: 21 }

const maybeShowModeTip = () => {
  if (modeTip.value) return // already showing one
  const rounds = roundsThisSession.value

  // Shuffle order so it's not always the same sequence
  const candidates = MODE_TIPS
    .filter(t => {
      if (tipsShownThisSession.has(t.mode)) return false
      if (localStorage.getItem(t.key) === 'true') return false // already enabled
      const minRound = TIP_SCHEDULE[t.mode as keyof typeof TIP_SCHEDULE] || 10
      // Add random jitter of 0-3 rounds
      return rounds >= minRound + Math.floor(Math.random() * 4)
    })

  if (candidates.length === 0) return

  // Pick one at random
  const tip = candidates[Math.floor(Math.random() * candidates.length)]
  tipsShownThisSession.add(tip.mode)
  modeTip.value = tip

  // Auto-dismiss after 6 seconds
  setTimeout(() => { if (modeTip.value?.mode === tip.mode) modeTip.value = null }, 6000)
}

const dismissModeTip = () => { modeTip.value = null }
const openSettingsFromTip = () => {
  modeTip.value = null
  // Dispatch event that PlayerContainer listens to
  window.dispatchEvent(new CustomEvent('ssi-open-settings'))
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
// AudioController.audioSource is built from createAudioCacheSource over the
// Wave 3 AudioCache (IndexedDB ssi-audio-cache-v2) — see onMounted. The
// legacy OfflineCache + useOfflineCache composable were deleted along
// with DownloadCourseButton / OfflineStatusIndicator; AudioCache is the
// only IndexedDB audio cache now.

/**
 * Resolve an audioId to a URL for the SimplePlayer / useCyclePlayback /
 * useDrivingMode pipelines (different surface from AudioController's
 * audioSource — these consume `{type:'url', url} | {type:'blob', blob}`
 * and call URL.createObjectURL on the blob branch).
 *
 * We always return the URL branch — AudioCache hands us blob: URLs
 * when the id is cached, otherwise we fall through to the /api/audio
 * proxy URL. The Audio element treats blob: and http: URLs identically
 * so the distinction is moot for the consumers.
 *
 * Replaces three legacy helpers (createGetAudioSource / buildAudioUrlMap
 * / getAudioSourceForSession) that wrapped the now-deleted OfflineCache.
 */
const resolveAudioFromCache = async (
  audioId: string,
): Promise<{ type: 'url'; url: string } | null> => {
  if (!audioId || audioId === 'undefined' || audioId === 'null') {
    console.error('[resolveAudioFromCache] Invalid audioId:', audioId)
    return null
  }
  // 2026-05-23: blob URL substitution removed for the same reason as
  // SimplePlayer.resolveAudioUrl (ed490d9c) and AudioCacheSource:
  // iOS Safari fails to decode `audio.src = blob:...` reliably. SW
  // CacheFirst on /api/audio/* serves cached bytes when warm.
  return {
    type: 'url',
    url: `/api/audio/${audioId}?courseId=${encodeURIComponent(courseCode.value)}`,
  }
}

/**
 * Track which round indices have already had their audio preloaded.
 * Prevents duplicate fetch() calls for the same round.
 */
const audioPreloadedRounds = new Set<number>()

/**
 * 2026-05-23: DISABLED. preloadSimpleRoundAudio used to fire N rounds
 * × ~15 cycles × 3 audio URLs = up to 135 parallel /api/audio/<id>
 * fetches per round entry, intended to warm the SW CacheFirst layer.
 *
 * Desktop Chrome handles 135 parallel fetches fine (HTTP/2 streams +
 * generous connection limits). Mobile Safari WebKit has much lower
 * parallel limits AND serializes against the <audio> element's own
 * fetch — so the playback path's known-audio fetch ends up queued
 * behind the prefetch flood, the cycle gate's 5s timeout fires, and
 * the cycle fails. Tom's mobile reproduces this exact failure mode
 * even on WiFi because the constraint isn't bandwidth, it's
 * WebKit's connection queue.
 *
 * Same anti-pattern as warmUpInfPlayRoundsBackground (no-op'd) and
 * deepPrefetchRestOfCourse (no-op'd) — speculative bulk warming
 * that streaming-first doesn't need. AudioPrefetcher's
 * persistentLookaheadCycles=3 + SimplePlayer.prefetchNextCycle
 * priority hints cover the playback path within the bandwidth
 * envelope (~6 KB/s steady-state).
 *
 * Callers remain wired (line 1453, 1606, 5537) so the call sites
 * stay greppable. The function is a no-op.
 */
const preloadSimpleRoundAudio = (_rounds: any[], _maxRounds = 1, _startIndex = 0): Promise<void> => {
  // intentional no-op — see docblock
  return Promise.resolve()
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
  const getAudioSource = resolveAudioFromCache

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

// Buffering-prompt dialog message — surfaces when the gate in
// SimplePlayer.startPhase('prompt') is waiting for known audio.
//
// 2026-05-23: 200ms threshold removed. The threshold was meant to
// avoid flicker on fast cache resolves, but it caused a worse UX
// bug: jumpToRound updates currentCycle synchronously → the new
// phrase text rendered immediately → then 200ms later the buffering
// dialog replaced it → then the dialog disappeared and the text
// returned for actual play. Sequence looked like "phrase ready /
// just kidding, fetching / actually ready" — confusing.
//
// New behaviour: dialog shows the instant phase = 'buffering' (no
// delay). On a fast cache resolve the dialog may flash for a few
// ms before disappearing, but the phrase text is never exposed
// prematurely, which is the principle that matters.
const bufferingPromptVisible = ref(false)
const bufferingPromptMessage = 'Just grabbing the next phrase…'
watch(() => simplePlayer.phase.value, (phase) => {
  bufferingPromptVisible.value = phase === 'buffering'
})

// Skip-prep dialog — same 200ms-threshold pattern as bufferingPromptVisible,
// but at belt/round scope. When the learner taps `>` (round-skip) or `>>`
// (belt-skip), the destination cycle's audio may not be in the local cache
// yet — on slow networks this surfaces as a silent gap between the tap and
// the cycle starting. prepareAndJump (below) JIT-prefetches the destination
// audio before calling simplePlayer.jumpToRound; if the prefetch takes more
// than 200ms the dialog surfaces a terse "fetching" note. Cleared as soon
// as prefetch resolves OR a fresh skip supersedes this one (token bump
// invalidates the in-flight prep — see prepareAndJump for details).
const skipPrepVisible = ref(false)
const skipPrepMessage = ref('')
let skipPrepShowTimer: ReturnType<typeof setTimeout> | null = null
// Monotonic token: each prepareAndJump call increments this, and stale
// prefetches (a slow round-skip prefetch that resolves after the user
// taps belt-skip) bail out instead of jumping to a now-stale target.
let skipPrepToken = 0
const clearSkipPrepDialog = () => {
  if (skipPrepShowTimer) {
    clearTimeout(skipPrepShowTimer)
    skipPrepShowTimer = null
  }
  skipPrepVisible.value = false
  skipPrepMessage.value = ''
}

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

  // Start ring animation when entering pause phase.
  //
  // Both the visible countdown and the SimplePlayer's setTimeout go through
  // computePauseDuration(t1, t2, cfg) so admin tweaks to algorithm_config
  // affect both in lockstep. cfg is normalConfig or turboConfig — the live
  // values from the DB, with DEFAULT_NORMAL/DEFAULT_TURBO as fallback.
  if (phase === 'pause') {
    const cycle = simplePlayer.currentCycle.value
    const cfg = turboActive.value ? turboConfig.value : normalConfig.value
    const duration = computePauseDuration(
      cycle?.target1DurationMs ?? 0,
      cycle?.target2DurationMs ?? 0,
      cfg,
    )
    startRingAnimation(duration)
  }
})

watch(() => cyclePlaybackState.value.isPlaying, (playing) => {
  if (!playing && !isSkipInProgress.value && !isSkippingBelt.value && !isCycleTransitioning.value) {
    simplePlayer.pause()
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
const PREPARING_MESSAGES = computed(() => [
  t('loading.firingEngines'),
  t('loading.brainCalledAhead2'),
  t('loading.ducksSorted'),
  t('loading.firingNeurons'),
  t('loading.phrasesReady'),
  t('loading.connectingPathways'),
  t('loading.tuningFrequency'),
  t('loading.warmingSynapses'),
  t('loading.roundingVocab'),
  t('loading.polishingWords'),
  t('loading.queuingGoodStuff'),
])

// Start the "preparing to play" state with typewriter effect
let preparingTypewriterTimeout: ReturnType<typeof setTimeout> | null = null
const startPreparingState = () => {
  isPreparingToPlay.value = true
  const messages = PREPARING_MESSAGES.value
  const message = messages[Math.floor(Math.random() * messages.length)]
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

// ============================================================================
// INF PLAY first-entry introduction
//
// When a learner first enters INF PLAY for a course, type out a short
// explanation in the same dialog box used for the welcome / preparing
// messages. Runs in parallel with the audio warm-up so the wait feels
// purposeful: learner reads, audio downloads, both finish around the
// same time, then INF PLAY starts. Marked per-course in localStorage —
// subsequent entries skip the intro.
// ============================================================================
const isShowingInfPlayIntro = ref(false)
const infPlayIntroMessage = ref('')
let infPlayIntroTimeout: ReturnType<typeof setTimeout> | null = null

function infPlayIntroSeenKey(courseCode: string): string {
  return `ssi-infplay-intro-shown-${courseCode}`
}
function hasSeenInfPlayIntro(courseCode: string): boolean {
  if (!courseCode) return true
  try {
    return localStorage.getItem(infPlayIntroSeenKey(courseCode)) === 'true'
  } catch {
    return true  // treat localStorage failure as "already seen" — don't loop the intro
  }
}
function markInfPlayIntroSeen(courseCode: string): void {
  if (!courseCode) return
  try {
    localStorage.setItem(infPlayIntroSeenKey(courseCode), 'true')
  } catch { /* swallow — non-critical */ }
}

// Full text. Paragraph breaks render via CSS `white-space: pre-line`
// in the template branch. ~4s of typing + 2.5s read pause — roughly
// matched to the ~3s audio-bootstrap fetch so neither side blocks
// the other.
const INFPLAY_INTRO_TEXT = `Congratulations — you've met every new item in this course.

From here you'll keep practising what you know in fresh combinations until you can use them without thinking. This is infinite play.`

/**
 * Type out the intro into the dialog box. Returns a Promise that
 * resolves once the typewriter has finished AND a short read-pause
 * has elapsed. Caller can race this against the audio warm-up via
 * Promise.all so the learner sees the intro complete naturally.
 */
async function startInfPlayIntro(): Promise<void> {
  isShowingInfPlayIntro.value = true
  infPlayIntroMessage.value = ''
  if (infPlayIntroTimeout) clearTimeout(infPlayIntroTimeout)

  const message = INFPLAY_INTRO_TEXT
  let charIndex = 0

  return new Promise<void>((resolve) => {
    const typeChar = () => {
      if (!isShowingInfPlayIntro.value) {
        // Caller dismissed (rare) — resolve so any awaiter doesn't hang.
        resolve()
        return
      }
      if (charIndex < message.length) {
        infPlayIntroMessage.value += message[charIndex]
        charIndex++
        infPlayIntroTimeout = setTimeout(typeChar, 28)
      } else {
        // Typewriter done — hold for 2.5s so the learner can read the
        // last paragraph before INF PLAY starts.
        infPlayIntroTimeout = setTimeout(resolve, 2500)
      }
    }
    typeChar()
  })
}

function clearInfPlayIntro(): void {
  isShowingInfPlayIntro.value = false
  infPlayIntroMessage.value = ''
  if (infPlayIntroTimeout) {
    clearTimeout(infPlayIntroTimeout)
    infPlayIntroTimeout = null
  }
}

// Emit play state changes to parent (for nav bar play/stop toggle).
// Includes pod-lap and commentary audio so the big play/stop button keeps
// reading "stop" while THOSE are playing — pressing it during a pod halts
// everything (handled in togglePlayback below). Without this, the button
// flips to play whenever simplePlayer pauses for a between-rounds lap,
// which looks like nothing's happening even though pod audio is mid-air.
const isAudioPlaying = computed(() =>
  isPlaying.value || playingPodLapAudio.value || playingCommentaryAudio.value
)
watch(isAudioPlaying, (playing) => {
  emit('playStateChanged', playing)
})

// Wake lock: keep screen on during active learning
let wakeLock: WakeLockSentinel | null = null

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => { wakeLock = null })
  } catch { /* ignore — user denied or not supported */ }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {})
    wakeLock = null
  }
}

watch(isPlaying, (playing) => {
  if (playing) acquireWakeLock()
  else releaseWakeLock()
})

// Re-acquire wake lock when tab becomes visible again (browser releases it on tab switch)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isPlaying.value && !wakeLock) {
      acquireWakeLock()
    }
  })
}

// ============================================
// Media Session API: lock-screen and bluetooth controls
// Pairs with the silent-bridge inside SimplePlayer to give backgrounded
// playback parity with Driving Mode (without the concatenator overhead).
// ============================================
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return

  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'SSi Learning',
    artist: 'Practice Session',
    album: 'Player'
  })

  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ['play', () => {
      if (!isPlaying.value) simplePlayer.resume()
    }],
    ['pause', () => {
      if (isPlaying.value) simplePlayer.pause()
    }],
    ['nexttrack', () => {
      simplePlayer.skipRound()
    }],
    ['previoustrack', () => {
      const idx = simplePlayer.roundIndex.value
      if (idx > 0) simplePlayer.jumpToRound(idx - 1)
    }]
  ]

  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // Action not supported on this platform — skip
    }
  }
}

function clearMediaSession() {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = null
  for (const action of ['play', 'pause', 'nexttrack', 'previoustrack'] as MediaSessionAction[]) {
    try { navigator.mediaSession.setActionHandler(action, null) } catch { /* ignore */ }
  }
}

watch(isPlaying, (playing) => {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }
})

if (typeof navigator !== 'undefined') {
  setupMediaSession()
}

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

// Generic awakening messages (i18n) — fallback when we don't yet know the
// course's target language.
const AWAKENING_MESSAGES = computed(() => [
  t('loading.tuning'),
  t('loading.warmingNeurons'),
  t('loading.findingProgress'),
  t('loading.preparingStep'),
  t('loading.gatheringWords'),
  t('loading.dustingVocab'),
  t('loading.reconnecting'),
  t('loading.settingStage'),
  t('loading.brainCalledAhead'),
  t('loading.readyWhenYouAre'),
  t('loading.findingRhythm'),
  t('loading.pickingThread'),
])

// Course-specific templates with {lang} interpolation. Preferred when the
// target language has resolved, so the awakening typewriter feels personal
// to the course you just chose ("Getting your Greek course ready...") rather
// than a generic "Tuning your station". Falls back to AWAKENING_MESSAGES if
// the language name isn't available yet (cold mount before activeCourse).
const COURSE_AWAKENING_TEMPLATES = [
  'Getting your {lang} course ready...',
  'Fetching {lang} for you now...',
  'Firing up the engines — {lang} loading...',
  'Settling into your {lang} session...',
  'Pulling your {lang} together...',
  'Warming up your {lang}...',
  'Lining up your {lang} session...',
]

const getRandomAwakeningMessage = () => {
  // Prefer course-specific copy when we have the target language name
  // (resolves the moment the active course is set, which happens at
  // route-mount well before loading completes).
  const langName = getLanguageName(courseTargetLang.value)
  if (langName && langName !== courseTargetLang.value) {
    const tmpl = COURSE_AWAKENING_TEMPLATES[
      Math.floor(Math.random() * COURSE_AWAKENING_TEMPLATES.length)
    ]
    return tmpl.replace('{lang}', langName)
  }
  // Fallback: generic i18n awakening pool
  const messages = AWAKENING_MESSAGES.value
  return messages[Math.floor(Math.random() * messages.length)]
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

// Warm the very first cycle's KNOWN audio into the browser HTTP cache and
// wait for it before we flip to 'ready', so the first sound plays the
// instant the user starts instead of after a cold network fetch. We don't
// cache audio in the SW anymore (streaming-first), so nothing else warms
// this. Bounded by a timeout: a slow/failed fetch must never trap the user
// on the loading screen — it just proceeds to 'ready' and plays cold as
// before. Only the known phrase is gated (it plays first, with no buffer
// phase to hide a late arrival); the rest ride the 1-cycle lookahead.
const warmFirstKnownAudio = async (timeoutMs = 2000) => {
  try {
    const url = cachedRounds.value?.[0]?.cycles?.[0]?.known?.audioUrl
    if (!url || typeof url !== 'string' || url.startsWith('blob:')) return
    const warm = fetch(url, { priority: 'high' }).then(() => {}).catch(() => {})
    const timeout = new Promise((r) => setTimeout(r, timeoutMs))
    await Promise.race([warm, timeout])
  } catch {
    // never block readiness on a warm-up
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

// Network visualization removed — see archive/brain-views branch
// Stub variables for code that still references network state
const networkViewRef = ref(null)
const networkViewProps = { nodes: ref([]), edges: ref([]), currentPath: ref([]) }
const networkCenter = ref({ x: 0, y: 0 })
const isFullNetworkLoaded = ref(false)
const introducedLegoIds = computed(() => {
  const ids = new Set<string>()
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

// Session-wide iOS audio-session keepalive.
//
// 2026-05-23: DISABLED for testing. Tom on mobile (iOS Safari PWA)
// reported audio "tries to play then keeps getting cut off" —
// pattern consistent with the silent loop's auto-restart-on-pause
// listener (useAudioSessionKeepalive.ts:91) creating a focus
// ping-pong with the main audio element. iOS only allows one audio
// session: when main cycle audio plays, iOS pauses the silent
// loop → silent loop's pause handler restarts it → iOS steals
// focus back from main → main pauses → repeat.
//
// Possible the keepalive is no longer needed at all (iOS Safari
// has matured; SimplePlayer's reused audio element holds the
// unlock across phases). If audio works without it, drop the
// composable. If long PAUSE phases lose the audio session, we
// need a smarter keepalive — probably AudioContext-based rather
// than a competing HTMLAudioElement.
const audioEngaged = ref(false)
// useAudioSessionKeepalive(audioEngaged)
void audioEngaged // keep ref referenced for downstream consumers if any

// Tick the session play-time timer whenever ANY audio path is sounding —
// not just simplePlayer cycles, but pod laps, commentary, intros, and
// welcome too. Previously the timer gated on simplePlayer.isPlaying,
// which froze during pod laps (handleRoundBoundary pauses simplePlayer
// to play the lap on a separate audio element). Aran reported the
// session timer stopping during listening; same bug class as the
// keepalive — anything audible should keep the timer running.
watch(
  () => simplePlayer.isPlaying.value
    || playingPodLapAudio.value
    || playingCommentaryAudio.value
    || isPlayingIntroduction.value
    || isPlayingWelcome.value,
  (active) => {
    if (active) learningSession.markPlayStart()
    else learningSession.markPlayStop()
  },
)

// Initial state - before user has ever tapped play
const hasEverStarted = ref(false) // True after first play tap (even if welcome plays first)

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
      known: t('resting.readyWhenYouAre', 'ready when you are'),
      target: '',
    }
  }
  // Read from currentCycle to ensure text/audio are locked together
  if (currentCycle.value) {
    const useNative = isNativeScript.value && hasRomanizedText.value
    const targetText = useNative
      ? ((currentCycle.value.target as any).textNative || currentCycle.value.target.text || '')
      : (currentCycle.value.target.text || '')
    return {
      known: currentCycle.value.known.text || '',
      target: targetText,
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

// Detect listening cycles (passive whole-sentence replay at speed)
const isListeningCycle = computed(() => {
  const cycle = simplePlayer.currentCycle.value
  return cycle?.id?.startsWith('listening_') || false
})
const listeningPlaybackSpeed = computed(() => {
  const cycle = simplePlayer.currentCycle.value
  return cycle?.playbackSpeed ?? 1.0
})

// Target text visible during VOICE_2 — always shown as fallback when no LEGO tiles
// Listening cycles: show target text immediately (no hide-until-voice2)
const showTargetText = computed(() =>
  isListeningCycle.value
    ? !isTransitioningItem.value
    : (currentPhase.value === Phase.VOICE_2 && !isTransitioningItem.value)
)

// Stable known text - updates when not transitioning (prevents flash) OR when phrase changes
const displayedKnownText = ref('')
const lastKnownPhrase = ref('') // Track what phrase we've displayed
// The salient LEGO id for the phrase displayedKnownText currently reflects.
// Must be updated in lockstep with displayedKnownText — otherwise
// salientKnownParts compares the NEW cycle's salient against the OLD cycle's
// known text and emits a false-positive "invariant violated" warn during
// every transition (and silently drops the highlight).
const displayedLegoId = ref<string | null>(null)
watch([() => isTransitioningItem.value, () => currentPhrase.value.known], ([transitioning, newKnown]) => {
  // CRITICAL FIX: Always update if the underlying phrase changed (item transitioned)
  // This prevents showing old known text while new audio plays
  const phraseChanged = newKnown !== lastKnownPhrase.value

  // Update when NOT transitioning, OR when phrase changed (MUST update regardless of transition state)
  if (!transitioning || phraseChanged) {
    displayedKnownText.value = newKnown
    lastKnownPhrase.value = newKnown
    displayedLegoId.value = simplePlayer.currentCycle.value?.legoId ?? null
  }
}, { immediate: true })

// Split the displayed known text into [prefix][salient match][suffix] so the
// hero card can highlight the substring matching the current cycle's salient
// LEGO. Anchors the learner's attention on "the thing being practised in this
// cycle" — works equally for current-round practice and for spaced-review
// cycles (whose salient is a different, older LEGO).
//
// SSi methodology invariant: the salient LEGO MUST appear in the USE phrase
// in both languages (the LEGO pair is the unit). If salient known text isn't
// found in the phrase known text, that's a content authoring error, not a
// graceful-degrade case — surface it via console.warn so QA catches it.
//
// Returns null only when there is no salient yet (cycle hasn't loaded), no
// salient known text in the maps (vocab not yet loaded), or the match spans
// the whole sentence (highlighting everything is noise — typically because
// the salient LEGO IS the whole phrase, e.g. intro/debut).
const salientKnownParts = computed<{ prefix: string; match: string; suffix: string } | null>(() => {
  const full = displayedKnownText.value
  if (!full) return null
  // Read the legoId from the SAME snapshot as displayedKnownText. The live
  // simplePlayer.currentCycle advances before displayedKnownText releases
  // during transitions; reading the live one here caused spurious
  // "Salient LEGO's known text not found in phrase known text" warns when
  // the new cycle's salient was being substring-checked against the prior
  // cycle's still-displayed known text.
  const legoId = displayedLegoId.value
  if (!legoId) return null
  // Prefer the course-wide map (authoritative LEGO known_text from DB);
  // fall back to round-derived map if the global load hasn't completed.
  const salientKnown = globalLegoKnownTextMap.value.get(legoId) || legoKnownTextMap.value.get(legoId)
  if (!salientKnown || !salientKnown.trim()) return null
  const idx = full.toLowerCase().indexOf(salientKnown.toLowerCase())
  if (idx === -1) {
    console.warn(
      `[salientKnownParts] Salient LEGO's known text not found in phrase known text — content authoring error (salient pair invariant violated).`,
      { legoId, salientKnown, phraseKnown: full },
    )
    return null
  }
  // Whole-phrase match → highlighting everything is pointless; skip.
  if (idx === 0 && salientKnown.trim().length >= full.trim().length) return null
  return {
    prefix: full.slice(0, idx),
    match: full.slice(idx, idx + salientKnown.length),
    suffix: full.slice(idx + salientKnown.length),
  }
})

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
// Plain JS Map populated BEFORE SimplePlayer wraps rounds in Vue proxies.
// Vue proxies strip non-declared properties like `components`, so we extract them
// from the raw data and look them up by cycle ID (which IS readable through proxies).
const _componentsByCycleId = new Map<string, Array<{known: string, target: string}>>()
const _componentsByLegoId = new Map<string, Array<{known: string, target: string}>>()
// Native script variants of components
const _componentsByCycleIdNative = new Map<string, Array<{known: string, target: string}>>()
const _componentsByLegoIdNative = new Map<string, Array<{known: string, target: string}>>()

// Wrapper: call toSimpleRounds AND extract components into the plain Map
function toSimpleRoundsWithComponents(items: any[]) {
  // Detect native speed: all target voices at 1.0x → belt ramp applies
  const vc = props.course?.voice_config
  const voices = vc?.voices || vc
  const t1Speed = voices?.target1?.settings?.speed
  const isNativeSpeed = (t1Speed === 1.0 || t1Speed === 1) && !!voices?.target1?.voiceId

  // Read target speed config from course voice_config (set per-course in DB)
  const dbSpeed = vc?.target_speed
  const targetSpeed: TargetSpeedConfig = {
    globalSpeed: dbSpeed?.global_speed ?? 1.0,
    nativeSpeed: isNativeSpeed,
    introSpeed: dbSpeed?.intro_speed,
    firstReviewSpeed: dbSpeed?.first_review_speed,
    reviewSpeed: dbSpeed?.review_speed,
    rampSeeds: dbSpeed?.ramp_seeds,
    rampStartSpeed: dbSpeed?.ramp_start_speed,
    beltRamp: dbSpeed?.belt_ramp ?? false,
  }

  // Learner speed preference (from settings, stored in localStorage)
  const learnerSpeed = parseFloat(localStorage.getItem('learner_speed') || '1.0')
  if (learnerSpeed !== 1.0 && !isNaN(learnerSpeed)) {
    targetSpeed.globalSpeed = (targetSpeed.globalSpeed ?? 1.0) * learnerSpeed
  }

  // Pause comes from algorithm_config at runtime (see setRuntimeOverrides below);
  // toSimpleRounds bakes a DEFAULT_NORMAL fallback for environments without live config.
  const rounds = toSimpleRounds(items, targetSpeed)
  extractComponentsToMaps(rounds, '[Components] toSimpleRoundsWithComponents')
  return rounds
}

// Walk any Round[] and populate the four component lookup maps. Callable
// from BOTH the legacy converter (toSimpleRoundsWithComponents above) and
// the instant-playback bootstrap converter (backendCyclesToRounds), so
// the M-LEGO breakdown tiles render correctly from the very first cycle
// regardless of which path produced the rounds.
//
// Before this helper existed the maps were only populated by the legacy
// wrapper — the bootstrap path's first round or two rendered M-LEGOs
// without their known-text breakdown (single-tile fallback), until the
// full-script handoff fired the legacy converter and backfilled the
// maps. Now the bootstrap path populates them up front.
function extractComponentsToMaps(rounds: PlayerRound[], logPrefix = '[Components]') {
  let count = 0
  for (const round of rounds) {
    for (const cycle of round.cycles ?? []) {
      if (cycle.components) {
        _componentsByCycleId.set(cycle.id, cycle.components)
        if (cycle.legoId) {
          _componentsByLegoId.set(cycle.legoId, cycle.components)
        }
        count++
      }
      if (cycle.componentsNative) {
        _componentsByCycleIdNative.set(cycle.id, cycle.componentsNative)
        if (cycle.legoId) {
          _componentsByLegoIdNative.set(cycle.legoId, cycle.componentsNative)
        }
      }
    }
  }
  if (count > 0) console.log(`${logPrefix}: extracted ${count} cycles with components (map size: ${_componentsByCycleId.size}, lego map: ${_componentsByLegoId.size})`)
}

const displayedComponents = computed<Array<{known: string, target: string}>>(() => {
  const cycle = simplePlayer.currentCycle.value
  if (!cycle) return []
  if (isNativeScript.value && hasRomanizedText.value) {
    return _componentsByCycleIdNative.get(cycle.id) || _componentsByCycleId.get(cycle.id) || []
  }
  return _componentsByCycleId.get(cycle.id) || []
})

// Is current item an intro? (network should fade, show typewriter message)
// NOTE: Only 'intro' and 'component_intro' items show typewriter. 'debut' items (lego_itself) show normal phrase display.
const isIntroPhase = computed(() => {
  const item = useRoundBasedPlayback.value
    ? currentPlayableItem.value
    : sessionItems.value[currentItemIndex.value]
  return item?.type === 'intro' || item?.type === 'component_intro'
})

// Phase strip — visible whenever the current cycle has a real pause phase.
// pauseDuration > 0 is the definitional signal: the engine literally skips
// the speak phase when pauseDuration === 0 (intro / listening / pod / bookend
// / component_intro cycles, all of which are set to 0 in toSimpleRounds /
// scriptItemToCycle). One signal, read straight off the cycle being played,
// doesn't depend on item-lookup state.
const showPhaseStrip = computed(() => {
  // Hide on the resting screen — no live cycle is playing there, so the
  // pill shows a stale "active" segment which reads as noise.
  if (!simplePlayer.isPlaying.value) return false
  return (simplePlayer.currentCycle.value?.pauseDuration ?? 0) > 0
})

// Click handler for the phase-strip segments. Routes to the SimplePlayer
// engine which interrupts the current phase and starts the target one fresh.
// Round / cycle boundaries unchanged — this is intra-cycle navigation only.
function jumpToCyclePhase(phase: 'prompt' | 'voice1' | 'voice2') {
  simplePlayer.skipToPhase(phase)
}

// Is current item intro OR debut? (for showing component breakdown tiles)
// Component priming items should NOT show tiles (they ARE the component being primed)
// Uses cycle ID for sync detection (currentPlayableItem is set async, causes race)
const isIntroOrDebutPhase = computed(() => {
  const cycleId = simplePlayer.currentCycle.value?.id || ''
  // Component priming items are NOT intro/debut — they don't show component tiles
  if (cycleId.includes('_cmp_intro_') || cycleId.includes('_cmp_practice_')) return false
  if (cycleId.includes('_intro_') || cycleId.includes('_debut_')) return true
  // Fallback for legacy path
  const item = useRoundBasedPlayback.value
    ? currentPlayableItem.value
    : sessionItems.value[currentItemIndex.value]
  if (item?.type === 'component_intro' || item?.type === 'component_practice') return false
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
  // Don't show once the learner has finished white belt — by then the
  // 4-phase cycle is muscle memory and the cycle-phase pill is doing
  // the job of communicating phase. White belt threshold = yellow belt
  // (index 1) reached. Falls open while beltProgress is still loading
  // (null/undefined → no override, default behaviour wins).
  const highestBelt = beltProgress.value?.highestBeltIndex?.value
  if (typeof highestBelt === 'number' && highestBelt >= 1) return false
  return true
})

// Computed: instruction text based on current phase. During any
// listening context (L1 cluster cycle, L2 pod lap, listen bookend),
// override with the passive-attention pedagogy line so the hint
// doesn't say "get ready to speak" while the learner is meant to be
// just absorbing — and the main hero text doesn't show the next
// LEGO's word that the learner hasn't met yet.
const passiveListeningHint = computed(() =>
  t('phase.passiveAttention', 'Just listen now — without effort but with attention, like listening to birdsong.')
)
const inListeningContext = computed(() => {
  if (playingPodLapAudio.value) return true
  const cycleType = simplePlayer.currentCycle.value?.type
  return cycleType === 'listen_intro' || cycleType === 'listening' || cycleType === 'pod' || cycleType === 'listen_outro'
})
const phaseInstruction = computed(() => {
  if (inListeningContext.value) return passiveListeningHint.value
  switch (currentPhase.value) {
    case Phase.PROMPT:
      return t('phase.getReadyToSpeak', 'get ready to speak')
    case Phase.SPEAK:
      return t('phase.speakNow', "you're meant to be speaking now")
    case Phase.VOICE_1:
    case Phase.VOICE_2:
      return t('phase.listenCarefully', 'listen carefully')
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
    const useNative = isNativeScript.value && hasRomanizedText.value
    const targetText = useNative
      ? ((currentCycle.value.target as any).textNative || currentCycle.value.target.text || '')
      : (currentCycle.value.target.text || '')
    return {
      known: currentCycle.value.known.text || '',
      target: targetText,
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
  pendingPlaybackRate: number
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
    this.pendingPlaybackRate = 1.0  // Re-applied after audio.load() resets it
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

  /**
   * Set HTMLAudioElement playbackRate. Used by the pod lap scheduler so
   * `ps2x` cycles actually play at 2× their native speed. The rate is
   * stored and re-applied after each `audio.load()` (which resets it back
   * to 1.0), so calling `setPlaybackRate(2.0); play(ref)` actually plays
   * at 2×. Reset to 1.0 between segments so the next call defaults right.
   */
  setPlaybackRate(rate) {
    this.pendingPlaybackRate = rate || 1.0
    if (this.audio) this.audio.playbackRate = this.pendingPlaybackRate
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
      // load() resets playbackRate to 1.0 — re-apply any pending rate
      // (set by setPlaybackRate before this play() call). Pod ps2x relies
      // on this to actually play at 2×.
      if (this.pendingPlaybackRate && this.pendingPlaybackRate !== 1.0) {
        this.audio.playbackRate = this.pendingPlaybackRate
      }

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

const handleCycleEvent = async (event) => {
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
            // Network animation removed — see archive/brain-views branch
          }
          break
        case CyclePhase.VOICE_2:
          if (isAdaptationActive.value) markPhaseTransition('VOICE_2')
          // Network animation removed — see archive/brain-views branch
          {
            const currentItemForPath = useRoundBasedPlayback.value
              ? currentPlayableItem.value
              : sessionItems.value[currentItemIndex.value]
            if (currentItemForPath) {
              const legoIds = extractLegoIdsFromPhrase(currentItemForPath)
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

          // Maintain the main-loop high-water for cursor substitution in
          // saveRoundProgress (same logic as the simplePlayer handler).
          if (isMainLoopRound(currentRound.value) && completedLegoId &&
              (!lastMainLoopLegoId.value || completedLegoId > lastMainLoopLegoId.value)) {
            lastMainLoopLegoId.value = completedLegoId
          }
          // Persist progress (async, fire-and-forget)
          saveRoundProgress(completedLegoId, completedRoundIndex, currentRound.value)

          // Notify global listeners (e.g. install banner triggers after first round)
          window.dispatchEvent(new CustomEvent('ssi-round-complete', { detail: { roundIndex: completedRoundIndex } }))

          // Handle round boundary events (belt check, encouragements, breaks)
          handleRoundBoundary(completedRoundIndex, completedLegoId)

          // Move to next round
          currentRoundIndex.value++
          currentItemInRound.value = 0

          // The course never ends. If we've somehow run past the tail of
          // cachedRounds (proactive expansion at line 894 should have kept
          // us ahead), do an emergency expansion and re-check. Only fall
          // back to the summary screen if expansion genuinely can't
          // produce any more content (no LEGOs in the course at all).
          if (currentRoundIndex.value >= cachedRounds.value.length) {
            console.warn('[LearningPlayer] Ran off the tail of cached rounds — expanding now')
            await expandScript()
            if (currentRoundIndex.value >= cachedRounds.value.length) {
              console.error('[LearningPlayer] Expansion produced nothing — showing summary as last resort')
              showPausedSummary()
              return
            }
          }

          console.log('[LearningPlayer] Starting round', currentRoundIndex.value, 'LEGO:', cachedRounds.value[currentRoundIndex.value].legoId)
          // Round-boundary audio prefetch used to run a legacy
          // prefetchRoundAudio() helper here; AudioPrefetcher's
          // onRoundChanged + onRoundCompleted (wired at lines ~1359
          // and ~1480) now own that responsibility with proper
          // ephemeral lifecycle tracking.
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

          // INTRO and COMPONENT_INTRO items: play introduction audio directly, then advance
          if (nextScriptItem.type === 'intro' || nextScriptItem.type === 'component_intro') {
              console.log('[LearningPlayer] Playing', nextScriptItem.type, 'item for:', nextScriptItem.legoId)
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

                // Both intro and component_intro: play presentation audio sequence
                // Component intros now have presentation audio ("The X for 'word', as in 'phrase', is:")
                const introPlayed = await playIntroductionAudioDirectly(nextScriptItem)
                // CRITICAL: Check generation after async intro audio
                if (playbackGeneration.value !== generationAtStart) {
                  console.log('[LearningPlayer] Stale after intro audio, aborting')
                  return
                }
                if (introPlayed) {
                  console.log('[LearningPlayer]', nextScriptItem.type, 'complete, advancing to next item')
                } else if (nextScriptItem.type === 'component_intro') {
                  // Fallback: no presentation audio available, play target audio only
                  const target1Url = introPlayable.lego?.audioRefs?.target?.voice1?.url
                  if (target1Url && audioController.value) {
                    audioController.value.stop()
                    const tempAudio = new Audio(normalizeAudioUrl(target1Url))
                    await new Promise<void>((resolve) => {
                      tempAudio.addEventListener('ended', () => resolve())
                      tempAudio.addEventListener('error', () => resolve())
                      tempAudio.play().catch(() => resolve())
                    })
                    await new Promise<void>(r => setTimeout(r, 1000))
                  }
                }

                // Advance to next item in round
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
        simplePlayer.pause()
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

const handlePause = () => {
  logEvent('tap_pause', {
    during: isPlayingIntroduction.value ? 'intro'
      : isPlayingWelcome.value ? 'welcome'
      : playingPodLapAudio.value ? 'pod_lap'
      : playingCommentaryAudio.value ? 'commentary'
      : 'cycle',
    roundIndex: simplePlayer.roundIndex.value,
    roundNumber: simplePlayer.currentRound.value?.roundNumber ?? null,
    legoId: simplePlayer.currentRound.value?.legoId ?? null,
  })

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

  // Always set isPlaying = false, even if simplePlayer wasn't playing yet
  // (e.g. during welcome audio before cycle playback has started)
  isPlaying.value = false

  if (ringAnimationFrame) {
    cancelAnimationFrame(ringAnimationFrame)
  }
}

const handleResume = async () => {
  logEvent('tap_play', {
    firstPlay: !hasEverStarted.value,
    roundIndex: simplePlayer.roundIndex.value,
    roundNumber: simplePlayer.currentRound.value?.roundNumber ?? null,
    legoId: simplePlayer.currentRound.value?.legoId ?? null,
  })

  // Engage the iOS audio-session keepalive on every play tap. This is
  // the user-gesture moment — the silent loop's first play() hooks into
  // it for the iOS unlock, and it stays running through pauses until
  // explicit stop / session-complete / unmount.
  audioEngaged.value = true
  sessionEnded.value = false

  // RESUME from pause — use resume() to continue from current phase
  // (play() always restarts from prompt, losing position mid-cycle)
  if (hasEverStarted.value) {
    // If a pod lap was bookmarked by an earlier user-stop, replay it
    // before letting SimplePlayer move on. omitIntro=true so the bookend
    // doesn't repeat. After the replay we mirror the post-lap branches
    // from the round-complete handler (ratchet write, session-end, or
    // simplePlayer.resume into the next round).
    if (pendingLapResume.value) {
      const lap = pendingLapResume.value
      pendingLapResume.value = null
      isPlaying.value = true
      const completed = await playPodLap(lap, true)
      if (completed) {
        podScheduler?.markLapCompleted().catch((err) => {
          console.warn('[LearningPlayer] markLapCompleted failed (will retry next session):', err)
        })
      } else if (podLapSkippedByUser.value && turboActive.value) {
        podScheduler?.skipAhead(1).catch((err) => {
          console.warn('[LearningPlayer] skipAhead failed (will retry next session):', err)
        })
      }
      podLapSkippedByUser.value = false
      if (sessionEnded.value) {
        // Infinite-play guard: try expanding the script before showing
        // the quiet pause. Mirrors the post-lap branch in handleRoundBoundary.
        const added = await expandScript()
        if (added > 0) {
          sessionEnded.value = false
          simplePlayer.resume()
        } else {
          showPausedSummary()
        }
      } else if (userStoppedDuringLap.value) {
        // Stopped again during the replayed lap — bookmark and stay paused.
        userStoppedDuringLap.value = false
        pendingLapResume.value = lap
        isPlaying.value = false
      } else {
        simplePlayer.resume()
      }
      return
    }
    simplePlayer.resume()
    return
  }

  // FIRST PLAY — full initialization path

  // Ensure audio for first 2 rounds is fully cached before starting
  // Better to wait 1-2s at startup than stall mid-playback
  if (loadedRounds.value.length > 0) {
    startPreparingState()
    const currentIdx = simplePlayer.roundIndex.value ?? 0
    await preloadSimpleRoundAudio(loadedRounds.value, 2, currentIdx)
  }

  // Mark as started and playing IMMEDIATELY so:
  // 1. displayPhrases shows cycle text instead of "ready when you are"
  // 2. PlayerRestingState overlay hides (it checks isPlaying)
  hasEverStarted.value = true
  isPlaying.value = true
  localStorage.setItem('ssi-has-played', 'true')

  // Welcome no longer blocks Play — it lives in its own banner in the
  // resting state. Tom 2026-05-25.
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
  // Component intros share the parent legoId — use uuid for dedup so each component plays
  const introDedupeKey = scriptItem?.type === 'component_intro' ? (scriptItem.uuid || legoId) : legoId
  console.log('[LearningPlayer] playIntroductionAudioDirectly for:', legoId, 'dedupeKey:', introDedupeKey)

  // Skip if already played this session
  if (playedIntroductions.value.has(introDedupeKey)) {
    console.log('[LearningPlayer] Intro already played this session for:', introDedupeKey)
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

  // Fallback: resolve from presentationAudioId UUID (generateLearningScript emits UUID, not resolved object)
  if (!presentationUrl && scriptItem?.presentationAudioId) {
    presentationUrl = `/api/audio/${scriptItem.presentationAudioId}`
  }

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
    playedIntroductions.value.add(introDedupeKey)

    // Add LEGO node to the brain network visualization (only for full LEGO intros, not components)
    if (scriptItem?.type !== 'component_intro') {
      const targetText = playable.lego?.lego?.target || scriptItem?.targetText || ''
      const knownText = playable.lego?.lego?.known || scriptItem?.knownText || ''
      addNetworkNode(legoId, targetText, knownText, currentBelt.value?.name || 'white')
    }

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
let welcomeEventCleanups = [] // Cleanup fns for welcome audio event listeners — invoked before src is cleared to prevent the browser firing a spurious error event on the skipped element
let introAudioElement = null // Store reference for intro skip functionality
let introAbortController = null // AbortController for cancelling pending intro audio
let introEventCleanups = [] // Array of cleanup functions for intro audio event listeners

// Welcome banner visibility — true only for the very first course a
// learner ever opens, when the course has a welcome audio. Gates the
// "Play course welcome" CTA in the resting state. All conditions are
// reactive so the banner appears as soon as data resolves and
// disappears the instant any heard-signal flips. Tom 2026-05-25.
const welcomeBannerVisible = computed(() => {
  if (welcomeChecked.value) return false
  if (localStorage.getItem('ssi-welcome-heard') === 'true') return false
  if (currentRoundIndex.value > 0) return false
  if (highestCompletedLegoId.value) return false
  if (completedRounds.value > 0) return false
  const w = cachedCourseWelcome.value
  return !!(w && (w.s3_key || w.id))
})

// Populate welcome metadata from the database when the script cache
// doesn't have it (which is currently always — setCachedScript is
// imported but never called, so cachedScript is always null). Bails
// early for learners who can't see the banner anyway, so the lookup
// only runs for true first-time-ever learners on their first course.
// Tom 2026-05-25.
watchEffect(async () => {
  if (cachedCourseWelcome.value) return
  if (!courseDataProvider.value) return
  if (welcomeChecked.value) return
  if (localStorage.getItem('ssi-welcome-heard') === 'true') return
  if (highestCompletedLegoId.value) return
  if (completedRounds.value > 0) return
  try {
    const w = await courseDataProvider.value.getWelcomeAudio()
    if (w?.id) {
      cachedCourseWelcome.value = { id: w.id, duration: w.duration_ms, text: w.text }
      console.log('[LearningPlayer] Loaded course welcome from DB:', w.id)
    }
  } catch (_e) { /* ignore — banner just stays hidden */ }
})

const markWelcomeHeard = async () => {
  welcomeChecked.value = true
  localStorage.setItem('ssi-welcome-heard', 'true')
  if (courseDataProvider.value) {
    try { await courseDataProvider.value.markWelcomePlayed(learnerId.value) } catch (_e) { /* ignore */ }
  }
}

const dismissCourseWelcome = async () => {
  console.log('[LearningPlayer] Welcome banner dismissed')
  await markWelcomeHeard()
}

const playCourseWelcome = async () => {
  if (welcomeChecked.value) return false
  try {
    const w = cachedCourseWelcome.value
    if (!w || (!w.s3_key && !w.id)) {
      await markWelcomeHeard()
      return false
    }
    const audioUrl = w.s3_key
      ? `${AUDIO_S3_BASE_URL}/${w.s3_key}`
      : `${AUDIO_S3_BASE_URL}/${w.id.toUpperCase()}.mp3`
    const welcomeAudio = {
      id: w.id,
      url: audioUrl,
      duration_ms: w.duration || null,
      text: w.text || null,
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

      // Use dedicated Audio element (same pattern as introduction audio)
      // This avoids sharing audioController's element and the fragile skipNextNotify flag
      const audio = new Audio()
      welcomeAudioElement = audio

      const cleanup = async () => {
        for (const c of welcomeEventCleanups) { try { c() } catch (_e) { /* ignore */ } }
        welcomeEventCleanups = []
        isPlayingWelcome.value = false
        showWelcomeSkip.value = false
        welcomeAudioElement = null
        welcomeResolve = null
        await markWelcomeHeard()
      }

      const onEnded = async () => {
        console.log('[LearningPlayer] Welcome audio complete')
        await cleanup()
        resolve(true)
      }

      const onError = async (e) => {
        // Fires after skipWelcome has already torn down — silent exit.
        if (!isPlayingWelcome.value) return
        console.error('[LearningPlayer] Welcome audio error:', e)
        await cleanup()
        resolve(false)
      }

      audio.addEventListener('ended', onEnded)
      audio.addEventListener('error', onError)
      welcomeEventCleanups = [
        () => audio.removeEventListener('ended', onEnded),
        () => audio.removeEventListener('error', onError),
      ]
      audio.src = welcomeAudio.url
      audio.load()

      audio.play().catch((e) => {
        if (!isPlayingWelcome.value) return
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

  // 1. Flip the flag FIRST — any late-firing handler reads this and bails.
  isPlayingWelcome.value = false
  showWelcomeSkip.value = false

  // 2. Detach event listeners BEFORE clearing src. Clearing src triggers
  // a browser 'error' event on the audio element; without detaching first,
  // onError would log a spurious "Welcome audio error" on every skip.
  for (const c of welcomeEventCleanups) { try { c() } catch (_e) { /* ignore */ } }
  welcomeEventCleanups = []

  // 3. Stop and clean up the audio element
  if (welcomeAudioElement) {
    welcomeAudioElement.pause()
    welcomeAudioElement.removeAttribute('src')
    welcomeAudioElement.src = ''
    try { welcomeAudioElement.load() } catch (e) { /* ignore */ }
  }

  welcomeAudioElement = null

  // 3. Resolve the promise so startPlayback can continue
  if (welcomeResolve) {
    welcomeResolve(true)
    welcomeResolve = null
  }

  // 5. Mark as heard (skipped counts as heard — same as completion)
  await markWelcomeHeard()
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

/**
 * SKIP - Jump to start of NEXT round
 * IMPORTANT: Must fully halt all audio before advancing
 */
/**
 * Halt all non-SimplePlayer audio: intro, welcome, path animation.
 * SimplePlayer handles its own audio/timer cleanup via jumpToRound()/skipRound().
 */
const haltAllPlayback = () => {
  if (isPlayingIntroduction.value) skipIntroduction()
  if (isPlayingWelcome.value) skipWelcome()
}

/**
 * Cancel any in-flight pod lap or commentary so a jump (belt skip / belt
 * pill) doesn't overlap with it. Sets userStoppedDuringLap so
 * handleRoundBoundary's resume() is gated — the jump itself takes over
 * positioning. Ratchet stays put (jump-during-lap doesn't bump it; the
 * learner is moving past the content, not completing it).
 */
const cancelInFlightLap = () => {
  if (!playingPodLapAudio.value && !playingCommentaryAudio.value) return
  userStoppedDuringLap.value = true
  podLapCancelled.value = true
  audioController.value?.stop()
}

/**
 * Extract audio IDs from a cycle's url fields (`/api/audio/<uuid>`). Used
 * by the skip-prep prefetch path so we can warm the IndexedDB cache
 * before jumping. Returns just the UUIDs (not full URLs); callers feed
 * them to audioCache.persistent.ensure(). Skips blob-URL fields silently
 * — those are already local.
 */
const extractAudioIdsFromCycle = (cycle: any): string[] => {
  if (!cycle) return []
  const ids: string[] = []
  const urls = [cycle.known?.audioUrl, cycle.target?.voice1Url, cycle.target?.voice2Url]
  for (const url of urls) {
    if (!url || typeof url !== 'string') continue
    if (url.startsWith('blob:')) continue
    const match = url.match(/\/api\/audio\/([0-9a-f-]+)$/i)
    if (match) ids.push(match[1])
  }
  return ids
}

/**
 * Save the audio for current + next cycle to IndexedDB when the app
 * goes dormant. `audioCache.persistent.ensure(id)` fetches (if not
 * already cached) and stores blobs in IndexedDB, which survives iOS
 * app kills and PWA backgrounding. On cold open, the existing
 * AudioCacheSource.getBlobUrl() automatically serves from IDB — no
 * restore-side code needed; the read path is already wired.
 *
 * Idempotent: if the audio's already cached, ensure() resolves
 * immediately. Same algorithm regardless of mode (main vs INF PLAY)
 * or context (in-session pause vs cold restart). Tom 2026-05-25.
 */
const saveResumeAudio = () => {
  const round = simplePlayer.currentRound.value
  if (!round) return
  const cycleIdx = simplePlayer.cycleIndex.value
  const currentCycle = round.cycles[cycleIdx]
  let nextCycle: any
  if (cycleIdx + 1 < round.cycles.length) {
    nextCycle = round.cycles[cycleIdx + 1]
  } else {
    const rounds = (loadedRounds.value || []) as any[]
    const nextRound = rounds[simplePlayer.roundIndex.value + 1]
    nextCycle = nextRound?.cycles?.[0]
  }
  const ids = new Set<string>()
  for (const c of [currentCycle, nextCycle]) {
    extractAudioIdsFromCycle(c).forEach(id => ids.add(id))
  }
  if (ids.size === 0) return
  console.log(`[ResumeAudio] Persisting ${ids.size} audio ids for instant resume`)
  for (const id of ids) {
    void audioCache.persistent.ensure(id).catch(() => { /* silent — playback path handles misses */ })
  }
}

// Fire on both events: visibilitychange=hidden is the most reliable
// signal for iOS PWA backgrounding; pagehide catches true unloads.
// Both fire close together in practice, but better to cover both than
// miss the save window.
const onSaveResumeVisibilityChange = () => {
  if (document.visibilityState === 'hidden') saveResumeAudio()
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', onSaveResumeVisibilityChange)
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', saveResumeAudio)
}

/**
 * Skip-prep dialog wrapper for belt-skip / round-skip / belt-back.
 *
 * Sequence:
 *   1. Bump skipPrepToken (cancels any in-flight prep so we don't jump
 *      to a stale target).
 *   2. Arm a 200ms timer to show the dialog with `message`. Mirrors the
 *      bufferingPromptVisible threshold so an instant skip on a warm
 *      cache doesn't flicker the dialog.
 *   3. Look up the destination round, extract audio IDs from its first
 *      cycle, race audioCache.persistent.ensure on each against a 5s
 *      ceiling so a permanent network failure can't deadlock the skip.
 *   4. Check the token before jumping. If a fresh skip superseded ours
 *      (or the user navigated away), bail out — the newer skip owns
 *      the next jumpToRound.
 *   5. Clear the dialog, invoke `doJump()`. `doJump` is responsible for
 *      calling simplePlayer.jumpToRound (or jumpToSeed) — the prep
 *      itself doesn't navigate, so callers can carry side effects
 *      (mode flips, belt anchoring, infplay regen) around the jump.
 *
 * Cancellation rules:
 *   - Each new prepareAndJump increments the token; a stale prefetch
 *     resolves but its token check fails and it returns without jumping.
 *   - clearSkipPrepDialog() is called on success and on the token-stale
 *     path, so the dialog never lingers.
 *
 * `targetRoundIndex` is what we read the destination cycle from. For
 * belt-skip-by-seed (handleSkipToNextBelt), the caller resolves the seed
 * to a round index via simplePlayer.findRoundIndexForSeed first.
 */
const prepareAndJump = async (
  targetRoundIndex: number,
  message: string,
  doJump: () => void,
): Promise<void> => {
  // Cancel any in-flight prep — its token becomes stale.
  skipPrepToken += 1
  const myToken = skipPrepToken
  // Clear any stale visibility from the previous prep before arming.
  if (skipPrepShowTimer) {
    clearTimeout(skipPrepShowTimer)
    skipPrepShowTimer = null
  }
  // Arm dialog with new message. We set the message now (cheap) so it's
  // ready if the timer fires — avoids a 1-frame flash of stale text.
  skipPrepMessage.value = message
  skipPrepShowTimer = setTimeout(() => {
    // Only surface the dialog if this prep is still the live one.
    if (myToken === skipPrepToken) {
      skipPrepVisible.value = true
    }
    skipPrepShowTimer = null
  }, 200)

  try {
    // Read destination from cachedRounds (the local mirror of simplePlayer's
    // queue). If out-of-bounds we still call doJump — the caller may want
    // to fall through to whatever path generates the missing rounds.
    const targetRound = cachedRounds.value[targetRoundIndex]
    const firstCycle = targetRound?.cycles?.[0]
    const audioIds = extractAudioIdsFromCycle(firstCycle)
    if (audioIds.length > 0) {
      const ensurePromise = Promise.all(
        audioIds.map((id) => audioCache.persistent.ensure(id).catch(() => { /* silent */ })),
      )
      // 5s ceiling so a permanent network failure can't deadlock the skip.
      // Past the ceiling we fall through and let SimplePlayer's existing
      // ensureKnownReady + retry-once-then-halt machinery handle it cleanly.
      await Promise.race([
        ensurePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ])
    }
  } catch (err) {
    console.warn('[LearningPlayer] skip-prep prefetch threw — falling through:', err)
  }

  // Token check — a newer skip may have superseded us mid-prefetch.
  if (myToken !== skipPrepToken) {
    return
  }

  clearSkipPrepDialog()
  doJump()
}

const handleSkip = async () => {
  logEvent('tap_skip', {
    during: playingPodLapAudio.value ? 'pod_lap'
      : playingCommentaryAudio.value ? 'commentary'
      : isPlayingIntroduction.value ? 'intro'
      : isPlayingWelcome.value ? 'welcome'
      : (simplePlayer.currentCycle.value?.type === 'listening'
        || simplePlayer.currentCycle.value?.type === 'listen_intro'
        || simplePlayer.currentCycle.value?.type === 'listen_outro') ? 'l1_cluster'
      : 'cycle',
    roundIndex: simplePlayer.roundIndex.value,
    roundNumber: simplePlayer.currentRound.value?.roundNumber ?? null,
    cycleIndex: simplePlayer.cycleIndex.value,
    cycleType: simplePlayer.currentCycle.value?.type ?? null,
    legoId: simplePlayer.currentRound.value?.legoId ?? null,
    skipInProgress: isSkipInProgress.value,
  })

  // CRITICAL: Guard against concurrent skips - if already skipping, abort any playing intro and return
  if (isSkipInProgress.value) {
    console.log('[LearningPlayer] Skip already in progress - aborting current intro and returning')
    skipIntroduction() // Nuclear abort any playing intro
    return
  }

  // Skip during inter-round audio (pod lap OR commentary): cancel and
  // let handleRoundBoundary's resume() advance into the next round.
  // Don't fall through to jumpToRound — simplePlayer is already queued
  // at the next round (advanceRound bumped roundIndex when it was
  // paused for the lap/commentary). Turbo's ratchet bump for pod laps
  // lives in handleRoundBoundary so this stays a thin signal.
  if (playingPodLapAudio.value || playingCommentaryAudio.value) {
    console.log('[LearningPlayer] Skip during inter-round audio — cancelling')
    if (playingPodLapAudio.value) podLapSkippedByUser.value = true
    podLapCancelled.value = true
    audioController.value?.stop()
    return
  }

  console.log('[LearningPlayer] ========== SKIP REQUESTED ==========')

  // Use SimplePlayer — jumpToRound preserves play state (paused stays paused).
  // Wrap in prepareAndJump so the destination cycle's audio is JIT-prefetched
  // before we land on it; if the prefetch takes >200ms a "Next round…" dialog
  // surfaces. Belt position update + the actual jump live inside the doJump
  // closure so a superseded skip (token bump) skips both.
  console.log('[LearningPlayer] Using SimplePlayer jumpToRound (skip)')
  isSkipInProgress.value = true
  try {
    haltAllPlayback()
    const nextIndex = simplePlayer.roundIndex.value + 1
    await prepareAndJump(nextIndex, 'Next round…', () => {
      simplePlayer.jumpToRound(nextIndex)
      // Update belt position to match (positional indicator, not just achievement)
      updateBeltForPosition(nextIndex)
    })
  } finally {
    isSkipInProgress.value = false
  }
}


/**
 * REVISIT - Go back to start of current round, or previous round if already at start
 * Delegates to SimplePlayer.jumpToRound() which owns playback state.
 */
const handleRevisit = async () => {
  if (!useRoundBasedPlayback.value || cachedRounds.value.length === 0) return

  console.log('[LearningPlayer] ========== REVISIT REQUESTED ==========')

  haltAllPlayback()

  // Determine target round: go to start of current, or previous if already at start
  let targetIndex = currentRoundIndex.value
  if (currentItemInRound.value <= 1 && currentRoundIndex.value > 0) {
    targetIndex = currentRoundIndex.value - 1
  }

  console.log('[LearningPlayer] Revisit → jumping to round', targetIndex, 'LEGO:', cachedRounds.value[targetIndex]?.legoId)

  // Update belt to match new position (no celebration when going back)
  updateBeltForPosition(targetIndex)

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
  haltAllPlayback()
  // Jump via SimplePlayer (0-based index)
  simplePlayer.jumpToRound(roundIndex)
  return true
}

/**
 * Jump to start of next belt
 * Uses SessionController's lazy loading to load the target round on demand
 */
/**
 * Bundle-based INF PLAY entry — flag-gated via `isBundleBasedInfplayCourse`.
 *
 * Replaces the legacy warm-up dance (warmUpFirstInfPlayCycle +
 * warmUpInfPlayRoundsBackground + shouldSkipCycle gate) with the new
 * cache-based pipeline: generateScript() emits INF PLAY rounds from
 * the bundle, audioCache.persistent.ensure() guarantees the first
 * cycle's audio is in cache before play, and AudioPrefetcher's watch
 * acquires ephemeral + persistent audio for everything that follows.
 *
 * Returns `true` on success, `false` to signal the caller should fall
 * through to the legacy path (bundle not loaded yet, or generateScript
 * returned no rounds for some reason).
 *
 * Side effects intentionally LEFT to the caller (so they're identical
 * across both paths):
 *  - setMode('infplay') / currentMode update
 *  - highestCompletedLegoId ratchet
 *  - lastMainLoopLegoId anchor
 *  - beltProgress.setPlayingPosition
 *  - persistCursorAtCurrentRound
 */
async function enterInfPlayViaBundle(fromInfRound: number, showIntro: boolean): Promise<boolean> {
  const bundle = courseBundle.bundle.value
  if (!bundle) {
    console.warn('[INF PLAY bundle] Bundle not loaded yet — falling through to legacy warm-up path')
    return false
  }
  let result: ReturnType<typeof generateBundleScript>
  try {
    result = generateBundleScript({
      bundle,
      position: { mode: 'infplay', fromInfRound: Math.max(1, fromInfRound) },
      roundLimit: 15,
    })
  } catch (err) {
    console.warn('[INF PLAY bundle] generateScript threw — falling through to legacy:', err)
    return false
  }
  if (result.rounds.length === 0) {
    console.warn('[INF PLAY bundle] generateScript returned 0 rounds — falling through to legacy')
    return false
  }

  // Append the new INF PLAY rounds and remember where the first one
  // landed in the queue. appendRounds dedupes by roundNumber, so
  // calling this twice for the same fromInfRound is a no-op rather
  // than a duplicate insert.
  const firstNewIdx = simplePlayer.roundCount.value
  simplePlayer.appendRounds(result.rounds)
  // Mirror into cachedRounds for downstream consumers that read the
  // legacy alias (saveRoundProgress, etc.).
  loadedRounds.value = [...loadedRounds.value, ...result.rounds]

  // Pre-cache the first cycle's audio so playback doesn't gap. We
  // extract the audio ids from the cycle's URL fields (`/api/audio/<id>`)
  // and await the persistent.ensure calls before jumpToRound. The
  // AudioPrefetcher's watch will handle the rest once the round
  // change fires.
  const firstCycle = result.rounds[0]?.cycles?.[0]
  const firstAudioIds: string[] = []
  if (firstCycle) {
    const urls = [firstCycle.known?.audioUrl, firstCycle.target?.voice1Url, firstCycle.target?.voice2Url]
    for (const url of urls) {
      const id = url?.split('/').pop()
      if (id) firstAudioIds.push(id)
    }
  }

  isWarmingUpInfPlay.value = true
  try {
    const ensurePromise = Promise.all(
      firstAudioIds.map((id) => audioCache.persistent.ensure(id).catch(() => { /* silent */ })),
    )
    if (showIntro) {
      await Promise.all([ensurePromise, startInfPlayIntro()])
      markInfPlayIntroSeen(courseCode.value)
      clearInfPlayIntro()
    } else {
      await ensurePromise
    }
  } finally {
    isWarmingUpInfPlay.value = false
  }

  console.log(`[INF PLAY bundle] Entered at fromInfRound=${fromInfRound}, ${result.rounds.length} rounds appended at index ${firstNewIdx}`)
  simplePlayer.jumpToRound(firstNewIdx)
  return true
}

const handleSkipToNextBelt = async () => {
  cancelInFlightLap()
  const currentRound = simplePlayer.currentRound.value

  // Already in infinite play — next-belt-skip is a no-op. Exit infplay
  // via the back-belt button instead.
  if (currentRound && !isMainLoopRound(currentRound)) {
    console.log('[LearningPlayer] Already in infinite play — no next belt to skip to')
    return
  }

  // Single source of truth for the entry decision: the template-bound
  // computed used to morph the button into the purple "∞" pill. If the
  // morph is visible, the click enters INF PLAY; otherwise it jumps to
  // the next belt. Keeps the click behaviour aligned with what the
  // learner sees on the button.
  const enterInfplay = wouldEnterInfplay.value

  // For the belt jump path we still need the next belt's first seed.
  // playingNextBelt is the belt visually above the current one (derived
  // from beltProgress, which is the same source the belt label uses).
  const nextBelt = playingNextBelt.value
  const nextBeltThreshold = nextBelt?.seedsRequired ?? 0

  // Visual belt anchor for INF PLAY entry: the seed of the course's
  // final LEGO. Falls back to nextBeltThreshold then to a sensible
  // default — the anchor is purely visual (belt label colour) so a
  // mild miss is recoverable.
  const courseEndSeed = (() => {
    const fin = courseFinalLegoRef.value?.legoId
    if (fin) {
      const s = getSeedFromLegoId(fin)
      if (s !== null) return s
    }
    return nextBeltThreshold || 668
  })()

  console.log('[LearningPlayer] handleSkipToNextBelt called', {
    currentLegoId: currentRound?.legoId,
    currentBelt: playingBelt.value.name,
    nextBelt: nextBelt?.name ?? '(none)',
    nextBeltThreshold,
    courseFinalLegoId: courseFinalLegoRef.value?.legoId ?? '(not yet loaded)',
    enterInfplay,
    isPlaying: simplePlayer.isPlaying.value,
  })

  isSkippingBelt.value = true
  try {
    haltAllPlayback()

    if (enterInfplay) {
      // Explicit tap-to-enter INF PLAY:
      //   1. setMode('infplay') — flips the mode flag so back-belt-
      //      skip exits correctly + next session resumes here
      //   2. Ratchet highest_completed_lego_id to course's final
      //      LEGO. Belt-skipping past content IS the legitimate way
      //      to enter INF PLAY (Tom 2026-05-20: "how the fuck do I
      //      get beyond the highest lego if not by skipping past
      //      it") so highest must reflect "I'm done with new content"
      //      not "what I literally played through". Forward-only —
      //      if learner already happens to be at the final LEGO,
      //      no-op.
      if (!isGuestLearner.value && progressStore?.value && learnerId.value && courseCode.value) {
        try {
          const finalLego = await getCourseFinalLego(courseCode.value)
          await progressStore.value.setMode(
            learnerId.value,
            courseCode.value,
            'infplay',
            finalLego ?? undefined,
          )
          currentMode.value = 'infplay'
          if (infplayRoundIndex.value === 0) infplayRoundIndex.value = 1
          // Mirror the ratchet into local refs so the resting-state
          // UI updates without a roundtrip.
          if (finalLego) {
            if (!highestCompletedLegoId.value || finalLego.legoId > highestCompletedLegoId.value) {
              highestCompletedLegoId.value = finalLego.legoId
              highestCompletedRoundIndex.value = finalLego.roundIndex
            }
          }
        } catch (modeErr) {
          console.warn('[LearningPlayer] setMode(infplay) on skip-to-next failed:', modeErr)
        }
      }

      // Make sure the cursor-substitution anchor is set BEFORE we land
      // on an infplay round + call persistCursorAtCurrentRound below.
      // Without this, the cursor write would use the infplay round's
      // random-USE legoId (some earlier LEGO) and stamp the DB with
      // a position behind the learner's actual highest. Fall back to
      // the ceiling if the in-session high-water hasn't been recorded
      // yet (rare — tapping the button typically means they just
      // completed a main-loop round).
      if (!lastMainLoopLegoId.value && highestCompletedLegoId.value) {
        lastMainLoopLegoId.value = highestCompletedLegoId.value
      }

      // Find the first INF PLAY round in cachedRounds.
      //
      // mainLoopCount = courseFinalLegoRef.roundIndex + 1. Any cached
      // round at or beyond that index is an INF PLAY round; anything
      // before it is main-loop. We deliberately stopped using the
      // "round has no intro/debut/build cycles" predicate that lived
      // here previously: in courses where some LEGOs have missing audio
      // (Croatian, German, etc.) the script generator strips the
      // intro/debut/build cycles for those LEGOs, leaving early
      // main-loop rounds matching the same shape as an INF PLAY round.
      // The user would then click ∞ and land on S0001L02 instead of an
      // actual revival round. Tom 2026-05-21.
      const mainLoopCount = (courseFinalLegoRef.value?.roundIndex ?? -1) + 1
      const firstInfIdx = mainLoopCount > 0 && cachedRounds.value.length > mainLoopCount
        ? mainLoopCount
        : -1
      if (firstInfIdx >= 0) {
        console.log(`[LearningPlayer] Skipping past last belt — entering infinite play at round index ${firstInfIdx} (mainLoopCount=${mainLoopCount})`)
        // Spotify-style bootstrap: fetch only the FIRST cycle's audio
        // (~3 files, ~3s on 4G), then start. Background fetch keeps
        // ahead of playback for everything else. Mirrors the main
        // player's instant-playback model.
        //
        // If first-time learner, type out the intro in parallel —
        // both the 3s audio fetch AND the ~14s typewriter need to
        // finish before play starts. The typewriter is the longer
        // bound, so the audio's cached well before the learner reads
        // the last paragraph.
        const showIntro = !hasSeenInfPlayIntro(courseCode.value)
        // Bundle-based path (flag-gated). On success, skips the legacy
        // warm-up dance entirely. On failure (bundle not loaded, gen
        // returned 0), falls through to the legacy path below.
        const usedBundle = isBundleBasedInfplayCourse(courseCode.value)
          && await enterInfPlayViaBundle(infplayRoundIndex.value || 1, showIntro)
        if (!usedBundle) {
          isWarmingUpInfPlay.value = true
          try {
            const slice = cachedRounds.value.slice(firstInfIdx)
            const warmUpPromise = warmUpFirstInfPlayCycle(slice as any)
            if (showIntro) {
              await Promise.all([warmUpPromise, startInfPlayIntro()])
              markInfPlayIntroSeen(courseCode.value)
              clearInfPlayIntro()
            } else {
              await warmUpPromise
            }
          } finally {
            isWarmingUpInfPlay.value = false
          }
          simplePlayer.jumpToRound(firstInfIdx)
        }
        // Phase 2 (background): everything else — fetch the rest of
        // round 1's cycles + rounds 2..N in parallel-5. By the time
        // the first cycle finishes (~10s), the next cycles are cached.
        warmUpInfPlayRoundsBackground(cachedRounds.value as any, firstInfIdx)
        // Anchor belt to the last main-loop seed (= top reachable belt
        // colour for this course). Otherwise the infplay round's random
        // USE legoId would set the visual to whichever LEGO it drew.
        if (beltProgress.value) {
          beltProgress.value.setPlayingPosition(courseEndSeed)
        }
        await persistCursorAtCurrentRound()
        return
      }
      // No infplay rounds loaded — try regenerating the script then re-find.
      if (supabase?.value) {
        console.debug('[LearningPlayer] No infplay rounds loaded; regenerating script')
        const skipResult = await generateScript()
        if (skipResult.items.length > 0) {
          const newRounds = toSimpleRoundsWithComponents(skipResult.items) as any[]
          cachedRounds.value = newRounds
          simplePlayer.appendRounds(newRounds)
          // Same mainLoopCount-based boundary as above — see comment at
          // first firstInfIdx for why we stopped trusting the cycle-type
          // predicate.
          const refoundIdx = mainLoopCount > 0 && newRounds.length > mainLoopCount
            ? mainLoopCount
            : -1
          if (refoundIdx >= 0) {
            simplePlayer.jumpToRound(refoundIdx)
            if (beltProgress.value) beltProgress.value.setPlayingPosition(courseEndSeed)
            await persistCursorAtCurrentRound()
            return
          }
        }
      }
      console.warn('[LearningPlayer] Could not enter infinite play — no revival rounds found')
      return
    }

    // Normal belt-to-belt skip
    const targetSeed = nextBeltThreshold
    console.log(`[LearningPlayer] Skipping to ${nextBelt?.name ?? 'next'} belt - seed ${targetSeed}`)
    const existingRoundIndex = simplePlayer.findRoundIndexForSeed(targetSeed)
    if (existingRoundIndex < 0 && supabase?.value) {
      console.debug(`[progressiveLoad] Belt skip: target seed ${targetSeed} not loaded, regenerating full script...`)
      const skipResult = await generateScript()
      if (skipResult.items.length > 0) {
        const newRounds = toSimpleRoundsWithComponents(skipResult.items)
        simplePlayer.addRounds(newRounds as any)
      }
    }
    // Resolve the seed → round index AFTER any in-flight script-regen so the
    // prefetch reads the round that simplePlayer.jumpToSeed will actually land
    // on. Use the resolved index for prepareAndJump's audio extraction; the
    // jump itself stays on jumpToSeed (single source of truth for seed→round).
    const resolvedTargetIdx = simplePlayer.findRoundIndexForSeed(targetSeed)
    await prepareAndJump(resolvedTargetIdx, 'Fetching next belt…', () => {
      simplePlayer.jumpToSeed(targetSeed)
      if (beltProgress.value) {
        beltProgress.value.setPlayingPosition(targetSeed)
      }
    })
    await persistCursorAtCurrentRound()
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

  // Course-wide script is the standard now. If the target seed isn't in
  // the current load, regenerate the whole thing — narrow chunks are gone.
  console.debug(`[progressiveLoad] Belt skip: target seed ${targetSeed} not loaded, regenerating full script...`)
  const skipResult = await generateScript()

  if (skipResult.items.length > 0) {
    const newRounds = toSimpleRoundsWithComponents(skipResult.items)
    simplePlayer.addRounds(newRounds as any)
    console.debug(`[progressiveLoad] Belt skip: added ${newRounds.length} rounds`)
  }
}

/**
 * Jump back to start of current or previous belt
 * If close to current belt start, goes to previous belt
 */
const handleGoBackBelt = async () => {
  const currentRound = simplePlayer.currentRound.value
  const isInfplay = !!(currentRound && !isMainLoopRound(currentRound))

  // Unified rule: jump to the start of the belt visually BELOW the
  // current playing belt. Mirrors backTargetBelt above. Works the
  // same in main loop and INF PLAY — in INF PLAY this also exits the
  // mode flag so subsequent sessions resume in main-loop, and it
  // doesn't rely on highest_completed_lego_id (which the INF PLAY
  // entry ratchets to the course's final LEGO, so using it as the
  // back target lands the learner in the same belt they were on).
  const target = backTargetBelt.value
  const targetSeed = target.seedsRequired === 0 ? 1 : target.seedsRequired

  console.log('[LearningPlayer] handleGoBackBelt called', {
    isInfplay,
    currentSeedId: currentRound?.seedId,
    visualBelt: playingBelt.value.name,
    targetBelt: target.name,
    targetSeed,
  })

  try {
    haltAllPlayback()

    // If we're in INF PLAY, flip the mode flag back to main-loop so
    // future resume-bootstrap doesn't bounce us back into INF PLAY.
    // infplayRoundIndex is a lifetime counter — leave it alone.
    if (isInfplay && !isGuestLearner.value && progressStore?.value && learnerId.value && courseCode.value) {
      try {
        await progressStore.value.setMode(learnerId.value, courseCode.value, 'main')
        currentMode.value = 'main'
      } catch (modeErr) {
        console.warn('[LearningPlayer] setMode(main) on infplay exit failed:', modeErr)
      }
    }

    if (targetSeed <= 1) {
      await prepareAndJump(0, 'Fetching previous belt…', () => {
        simplePlayer.jumpToRound(0)
        if (beltProgress.value) {
          beltProgress.value.setPlayingPosition(targetSeed)
        }
      })
    } else {
      await loadSeedIfNeeded(targetSeed)
      // Resolve to round index AFTER load so prefetch reads the actual
      // round jumpToSeed lands on (mirrors handleSkipToNextBelt).
      const resolvedTargetIdx = simplePlayer.findRoundIndexForSeed(targetSeed)
      await prepareAndJump(resolvedTargetIdx, 'Fetching previous belt…', () => {
        simplePlayer.jumpToSeed(targetSeed)
        if (beltProgress.value) {
          beltProgress.value.setPlayingPosition(targetSeed)
        }
      })
    }

    // Belt-back is the canonical revisit gesture — write the cursor so
    // the resting-state choice surfaces next time the player pauses.
    await persistCursorAtCurrentRound()

    console.log(`[LearningPlayer] handleGoBackBelt: complete, now at ${target.name} belt (seed ${targetSeed})`)
  } catch (err) {
    console.warn('[LearningPlayer] handleGoBackBelt error:', err)
  }
}

// Belt pill tap — open the unified progress modal
const handleBeltPillTap = () => {
  showProgressModal.value = true
}

// Jump to any belt (from ProgressModal)
const handleSkipToBelt = async (belt: { name: string; seedsRequired: number }) => {
  showProgressModal.value = false
  const targetSeed = belt.seedsRequired === 0 ? 1 : belt.seedsRequired

  isSkippingBelt.value = true
  try {
    cancelInFlightLap()
    haltAllPlayback()
    console.log(`[LearningPlayer] Skipping to ${belt.name} belt - seed ${targetSeed}`)

    await loadSeedIfNeeded(targetSeed)
    simplePlayer.jumpToSeed(targetSeed)

    // Update visual playing position only — belt award requires natural completion
    if (beltProgress.value) {
      beltProgress.value.setPlayingPosition(targetSeed)
    }

    // Belt-pill jump can land anywhere (forward or back) — persist cursor.
    await persistCursorAtCurrentRound()
  } finally {
    isSkippingBelt.value = false
  }
}

// Mode toggles
const turboActive = ref(false)
const turboPopupShownThisSession = ref(false)

// ============================================
// RUNTIME PAUSE / SPEED OVERRIDES
// Both Normal and Turbo modes compute pause from the active ModeConfig
// (algorithm_config table, admin-tweakable). Selection switches on
// turboActive at runtime — toggling Turbo takes effect on the very next
// pause / voice phase, no script regen, no round-boundary wait.
// Listening/pod cycles keep their explicit zero-pause regardless.
// ============================================
const TURBO_BYPASS_TYPES = new Set(['intro', 'listening', 'pod', 'listen_intro', 'listen_outro', 'component_intro'])

simplePlayer.setRuntimeOverrides({
  getPauseDuration: (cycle) => {
    // Cycles with no pause (intro/listening/bookend/pod) stay at 0.
    if (!cycle.pauseDuration) return cycle.pauseDuration
    if (cycle.type && TURBO_BYPASS_TYPES.has(cycle.type)) return cycle.pauseDuration
    // Recompute pause from raw target durations using the active mode's config.
    // Single source of truth — same helper drives the visible countdown.
    const cfg = turboActive.value ? turboConfig.value : normalConfig.value
    const base = computePauseDuration(
      cycle.target1DurationMs ?? 0,
      cycle.target2DurationMs ?? 0,
      cfg,
    )
    // Per-LEGO adaptive multiplier (1.0 if engine not ready or legoId missing).
    // Applied last so mode floors/ceilings are still respected before
    // mastery scaling.
    const multiplier = cycle.legoId
      ? adaptationEngine.value?.getPauseMultiplier(cycle.legoId) ?? 1.0
      : 1.0
    return Math.max(cfg.min_pause_ms, Math.min(cfg.max_pause_ms, base * multiplier))
  },
  getPlaybackSpeedMultiplier: (cycle) => {
    if (!turboActive.value) return 1.0
    // Don't double up on listening/pod cycles that already have a
    // purposeful 2.0× speed — turbo on top would give 2.5×.
    if (cycle.type && TURBO_BYPASS_TYPES.has(cycle.type)) return 1.0
    return turboConfig.value.playback_speed
  },
  shouldSkipCycle: (cycle) => {
    // Cull tagged cycles when Turbo is on: 4th–7th BUILD, 2nd USE,
    // alternate-fib spaced rep. Tagging happens at script generation;
    // this just gates on the live Turbo flag.
    if (turboActive.value && cycle.turboOmit === true) return true

    // INF PLAY safety net: drop cycles whose audio isn't in the warm-
    // up cache. Tom's design 2026-05-20: "INF PLAY doesn't need any
    // particular cycles" — so a missing-audio cycle should be skipped
    // rather than played silently. The warm-up (pre-emptive + entry-
    // time) covers ~all cycles in normal flow; this catches stragglers
    // (slow network, edge cases) without stalling playback.
    //
    // Only applies in INF PLAY mode — main-loop play must NOT skip
    // missing-audio cycles (the pedagogical order matters there).
    // We trust the warm-up has run before this gate matters: an empty
    // warmedUpAudioUrls set short-circuits to "don't skip" so we
    // don't accidentally drop everything on a fresh enrollment.
    if (currentMode.value === 'infplay' && warmedUpAudioUrls.value.size > 0) {
      const known = (cycle as any)?.known?.audioUrl
      const v1 = (cycle as any)?.target?.voice1Url
      const v2 = (cycle as any)?.target?.voice2Url
      const cached = (url: string | undefined) => !url || warmedUpAudioUrls.value.has(url)
      if (!cached(known) || !cached(v1) || !cached(v2)) {
        return true
      }
    }
    return false
  },
  // ensureKnownReady: REMOVED 2026-05-23.
  //
  // The gate's purpose was to prevent "silent prompts" — entering PROMPT
  // before the known audio had landed locally meant the audio element
  // had to load from network during PROMPT and a safety timer could
  // advance to PAUSE before any bytes played. The gate awaited
  // audioCache.persistent.ensure(audioId) before PROMPT entry.
  //
  // The problem: that pre-fetch uses fetch() with no Range header. The
  // SW intercepts it (CacheFirst on /api/audio/*) and on cache miss
  // goes to origin, gets a full 200 response, caches it. Then the
  // audio element later sends a Range request for that audio. The SW
  // returns the cached 200 instead of a 206. iOS Safari can't handle
  // 200-in-response-to-Range — plays the buffered chunk (~0.5s) then
  // stalls forever waiting for the next range. 'ended' never fires.
  // Safety timer advances 10s later; cycle aborts; cascade.
  //
  // Tom verified the failure pattern via Safari Web Inspector on iOS:
  //   [SimplePlayer] Safety timeout — audio ended event never fired
  //   [SimplePlayer] play() rejected: "The operation was aborted."
  //
  // Streaming-first principle: the audio element IS the primary
  // fetcher. Its Range request goes direct to origin first (or SW
  // cache miss → origin), origin returns 206, SW caches 206,
  // subsequent plays serve cached 206. iOS happy.
  //
  // Trade-off: cold-cache cycles play their PROMPT audio with a
  // brief network wait (1-2s on 4G) instead of being gated until
  // cached. The buffering dialog in LearningPlayer (driven by
  // SimplePlayer's 'buffering' phase) is no longer needed; the audio
  // element's own readyState handles the wait visually as a brief
  // pause before audio starts. Matches the pre-yesterday behaviour
  // that worked on iOS Safari.
  // resolveAudioUrl: removed 2026-05-23.
  //
  // The override used to rewrite `/api/audio/<id>` to a `blob:...` URL
  // backed by AudioCache (IndexedDB) when the audio was already cached
  // locally, on the theory that bypassing the SW round-trip would be
  // faster. On iOS Safari standalone PWA, `audio.src = blob:...` from
  // an IDB-backed blob reliably failed with "operation is not supported"
  // — the audio element opened the iOS audio session (Dynamic Island
  // speaker flashed), failed to decode, and aborted. Desktop Chrome
  // handled blob URLs fine, masking the bug. Tom verified mobile broken
  // post the IDB-cache work 2026-05-22 ↔ 2026-05-23.
  //
  // With streaming-first defaults (AudioPrefetcher lookahead=1 + SW
  // CacheFirst on /api/audio/*), the SW cache is the actual primary
  // path anyway. The blob URL substitution was a leftover optimisation
  // from the previous IDB-as-playback-source design.
  //
  // IDB is still populated by AudioPrefetcher.persistent.ensure — that's
  // useful for driving mode's chunked accumulation and the future paid
  // "Download for offline" opt-in. It just isn't the source the audio
  // element reads from anymore.
})
const showListeningOverlay = ref(false) // Show listening mode overlay
const showPronunciationOverlay = ref(false) // Show pronunciation mode overlay

/**
 * Ceiling used by the Listening / Pronunciation overlay's "All" tab.
 * Derived from beltProgress.highestLegoId (high-water mark, only ever
 * moves forward) — NOT playingSeedNumber. The previous code used the
 * current playing seed, which silently shrank the All-tab pool whenever
 * the learner was revisiting earlier content or sitting in infinite
 * play with the cursor wherever. The All tab is "every USE phrase you
 * have ever met"; the high-water lego id is the right anchor for that.
 *
 * +1 because ListeningOverlay's filter is strictly seed_number <
 * upToSeed (used for "completed seeds only" semantics on the old
 * cursor-based code path). Adding 1 includes the highest seed too,
 * matching the inclusive "everything I've reached" meaning.
 */
const listeningCeilingSeed = computed<number | null>(() => {
  const legoId = beltProgress.value?.highestLegoId?.value ?? null
  if (!legoId) return null
  const seed = getSeedFromLegoId(legoId)
  return seed != null ? seed + 1 : null
})
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
  getAudioSource: resolveAudioFromCache,
  // Chunked-prefetch wiring — driving mode now activates as soon as
  // the current round's audio is in cache (phase 1, ~3 MB parallel),
  // with 50 MB chunks accumulating behind the learner via
  // BundleDownloader (phase 2). See createChunkedPrefetch.
  getRoundAudioIds: (roundIndex: number) => {
    const rounds = cachedRounds.value
    if (!rounds || roundIndex < 0 || roundIndex >= rounds.length) return []
    return audioIdsForSimpleRound(rounds[roundIndex].cycles ?? [])
  },
  prefetchAudio: createChunkedPrefetch({
    audioCache,
    getBundle: () => courseBundle.bundle.value,
    getDownloader: () => {
      // Lazy-init on first prefetch — by the time the learner taps the
      // driving-mode button the bundle has typically loaded (cache-first
      // localStorage path). Falls back to null until then; phase 1
      // direct ensures still run, phase 2 background fill skipped.
      if (bundleDownloader) return bundleDownloader
      if (!courseBundle.bundle.value) return null
      bundleDownloader = createBundleDownloader({ audioCache })
      return bundleDownloader
    },
  }),
  onRoundChange: (newRoundIndex: number) => {
    if (drivingModeInitialRound === null) {
      drivingModeInitialRound = newRoundIndex
      return // first call = initial round, nothing completed yet
    }
    // Previous round just completed — save progress
    const completedIdx = newRoundIndex - 1
    if (completedIdx >= 0 && cachedRounds.value && completedIdx < cachedRounds.value.length) {
      const round = cachedRounds.value[completedIdx]
      // Use visual helper — infplay rounds have a random round.legoId.
      const visualLegoId = visualLegoIdForRound(round)
      if (visualLegoId && beltProgress.value?.setCurrentLegoId) {
        beltProgress.value.setCurrentLegoId(visualLegoId)
      }
      if (visualLegoId && beltProgress.value?.setPlayingPosition) {
        const seed = getSeedFromLegoId(visualLegoId)
        if (seed !== null) beltProgress.value.setPlayingPosition(seed)
      }
    }
  },
  onSessionComplete: () => {
    isDrivingModeActive.value = false
    emit('drivingModeChanged', false)
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

// Belt skip feedback state (showBeltModal merged into showProgressModal above)
const isSkippingBelt = ref(false)

// INF PLAY audio warm-up state. Set true while the first batch of
// infplay rounds is being downloaded; gates the play button so the
// learner doesn't tap into silent/stuttering audio. Cleared once the
// blocking download completes; the second phase (rest of script)
// runs in the background and doesn't gate playback.
const isWarmingUpInfPlay = ref(false)

/**
 * Phase 1 (BLOCKING): download all audio for the next `count` rounds.
 * Tom's design 2026-05-20 — INF PLAY's random sampling defeats the
 * linear 30-min prefetch, so we batch-load a chunk of rounds before
 * playback starts and then top up in the background while the
 * learner plays through.
 *
 * Walks each round's cycles, collects unique audio URLs (known +
 * target1 + target2 + any presentation/listening clips), fires
 * fetch() against /api/audio/* — service-worker CacheFirst absorbs
 * the responses into the audio cache. Subsequent <audio> playback
 * hits the cache, no network roundtrip.
 *
 * Parallel-limited at 5 to saturate 4G without thrashing. Errors
 * are swallowed — partial cache is better than blocking forever.
 */
// Tracks URLs the warm-up has successfully cached. Drives the
// shouldSkipCycle gate in INF PLAY so cycles with uncached audio are
// silently dropped (rather than stalling / playing silently) —
// because INF PLAY doesn't need any particular cycle, only that
// SOMETHING with audio plays in each slot.
const warmedUpAudioUrls = ref<Set<string>>(new Set())

async function warmUpInfPlayRounds(rounds: any[], count: number): Promise<void> {
  const slice = rounds.slice(0, Math.max(0, count))
  const urls = new Set<string>()
  for (const r of slice) {
    if (!Array.isArray(r?.cycles)) continue
    for (const c of r.cycles) {
      if (c?.known?.audioUrl) urls.add(c.known.audioUrl)
      if (c?.target?.voice1Url) urls.add(c.target.voice1Url)
      if (c?.target?.voice2Url) urls.add(c.target.voice2Url)
    }
  }
  const list = [...urls]
  if (list.length === 0) return

  const parallel = 5
  for (let i = 0; i < list.length; i += parallel) {
    const batch = list.slice(i, i + parallel)
    const results = await Promise.allSettled(batch.map(url =>
      fetch(url).then(r => r.ok ? r.arrayBuffer().then(() => url) : null).catch(() => null)
    ))
    // Mark every URL that resolved successfully — it's now in the SW
    // CacheFirst store, safe for the shouldSkipCycle gate to trust.
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        warmedUpAudioUrls.value.add(r.value)
      }
    }
  }
}

/**
 * Bootstrap-style INF PLAY entry — fetch JUST the first cycle's
 * audio (~3 files, ~3s on 4G), then return. Caller starts playback
 * immediately and fires warmUpInfPlayRoundsBackground for everything
 * else.
 *
 * Mirrors the main player's instant-playback bootstrap: by the time
 * the first cycle finishes playing (~10s), the parallel-5 background
 * fetch has cached cycle 2, 3, 4 of round 1 plus the start of round
 * 2. Subsequent cycles play from cache.
 *
 * Per Tom 2026-05-20: "load first cycle and then everything else
 * when that is playing model... I don't see how the first 5 ROUNDS,
 * or whatever we think is good — could be just 1 ROUND is much
 * harder to do than the main player".
 */
async function warmUpFirstInfPlayCycle(rounds: any[]): Promise<void> {
  const firstRound = rounds[0]
  if (!firstRound || !Array.isArray(firstRound.cycles) || firstRound.cycles.length === 0) return
  const firstCycle = firstRound.cycles[0]
  const urls = [
    firstCycle?.known?.audioUrl,
    firstCycle?.target?.voice1Url,
    firstCycle?.target?.voice2Url,
  ].filter(Boolean) as string[]
  if (urls.length === 0) return

  const results = await Promise.allSettled(urls.map(url =>
    fetch(url).then(r => r.ok ? r.arrayBuffer().then(() => url) : null).catch(() => null)
  ))
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      warmedUpAudioUrls.value.add(r.value)
    }
  }
}

/**
 * Phase 2 (BACKGROUND): historically a fire-and-forget warm-up for the
 * rest of the INF PLAY script. As of 2026-05-23 this is a deliberate
 * no-op — see commit removing the speculative INF PLAY warm-up.
 *
 * Reason: the function used to walk every remaining round and fetch
 * every cycle's three audio URLs in parallel-5 batches. On Tom's
 * stress test with cold cache + 3G + far belt skip it produced 61,919
 * requests / 623 MB transferred. The streaming-first architecture
 * (AudioPrefetcher with lookahead=1 + persistentLookaheadCycles=3,
 * plus SimplePlayer.prefetchNextCycle warming the SW CacheFirst
 * layer per cycle) covers playback needs without speculative
 * bulk-fetching.
 *
 * Callers remain wired so the historical call sites are preserved
 * (easy to grep if we ever want to revive an opt-in version, e.g.
 * for a paid offline-download feature). Calling this function is
 * harmless — it does nothing.
 *
 * The `warmedUpAudioUrls` Set stays empty as a consequence, and the
 * existing "empty set short-circuits to don't-skip" branch in
 * `shouldSkipCycle` naturally disables the INF PLAY skip gate. INF
 * PLAY cycles now play via the same JIT path as main loop — SW
 * catches the misses, no failures observed under stress.
 *
 * Explicit caching for offline use is provided by driving mode's
 * chunked accumulation (createChunkedPrefetch) or the future paid
 * "Download for offline" opt-in.
 */
function warmUpInfPlayRoundsBackground(_rounds: any[], _skipFirst: number): void {
  // intentional no-op — see docblock
}

// Pre-emptive INF PLAY warm-up — once-per-session guard. When the
// learner crosses into the LAST belt with content (wouldEnterInfplay
// flips true while still in main-loop mode), kick off the warm-up
// in the background. By the time they actually enter INF PLAY, the
// audio is cached — entry's awaited phase-1 warm-up is a no-op
// because SW CacheFirst returns instantly for already-cached URLs.
//
// Idempotent: once triggered, stays set for the session even if the
// learner back-belt-skips out. Re-entering the last belt won't re-
// trigger (audio's already cached, no need to download twice).
const hasTriggeredPreemptiveInfPlayWarmUp = ref(false)

async function triggerPreemptiveInfPlayWarmUp(): Promise<void> {
  try {
    let rounds: any[] = cachedRounds.value as any
    const isInfPlayRound = (r: any) =>
      Array.isArray(r?.cycles) && r.cycles.length > 0 && !r.cycles.some((c: any) =>
        c.type === 'intro' || c.type === 'debut' || c.type === 'build'
      )

    let firstInfIdx = rounds.findIndex(isInfPlayRound)

    if (firstInfIdx < 0) {
      // Instant-playback bootstrap rounds don't include infplay tail.
      // Run the full script gen (the existing full-script handoff would
      // do this anyway after bootstrap; we just need it now). Idempotent
      // — generateScript cached if already run elsewhere.
      console.log('[LearningPlayer] Pre-emptive INF PLAY warm-up: generating full script')
      const result = await generateScript()
      const fullRounds = toSimpleRoundsWithComponents(result.items) as any[]
      if (fullRounds.length > 0) {
        cachedRounds.value = fullRounds
        rounds = fullRounds
        firstInfIdx = rounds.findIndex(isInfPlayRound)
      }
    }

    if (firstInfIdx < 0) {
      console.log('[LearningPlayer] Pre-emptive INF PLAY warm-up: no infplay rounds available — skipping')
      return
    }

    console.log(`[LearningPlayer] Pre-emptive INF PLAY warm-up: caching all infplay rounds (starting at index ${firstInfIdx})`)
    // Pre-emptive is already background — no two-phase split needed.
    // Fire one big background batch for everything from the first
    // infplay round onward. By the time the learner finishes the
    // last main-loop belt, all infplay audio is cached and entry
    // (Spotify-style bootstrap of just the first cycle) is instant.
    warmUpInfPlayRoundsBackground(rounds, firstInfIdx)
  } catch (err) {
    console.warn('[LearningPlayer] Pre-emptive INF PLAY warm-up failed:', err)
  }
}

// Watch the forward-button "would enter INF PLAY" signal — when it
// flips true and the learner is still in main mode, the last-belt
// boundary has been crossed. Time to start warming up.
watch(wouldEnterInfplay, (entering) => {
  if (!entering) return
  if (currentMode.value === 'infplay') return  // entry path handles its own warm-up
  if (hasTriggeredPreemptiveInfPlayWarmUp.value) return
  hasTriggeredPreemptiveInfPlayWarmUp.value = true
  void triggerPreemptiveInfPlayWarmUp()
})

// ============================================
// ADAPTATION CONSENT & TIMING
// Learner consents once, then timing runs silently
// ============================================

const ADAPTATION_CONSENT_KEY = 'ssi-adaptation-consent'

// Consent states: null (not asked), true (granted), false (declined)
const adaptationConsent = ref(null)

// Per-LEGO adaptive pause engine. Hydrates from learner_lego_metrics on mount,
// records latency per cycle, exposes a mastery-state-driven pause multiplier
// applied in the getPauseDuration runtime override below.
const adaptationEngine = shallowRef<UseAdaptationEngineReturn | null>(null)

// Per-seed Layer 1 fire-count persistence. Hydrates from learner_l1_state on
// mount, feeds initialL1FireCounts into generateLearningScript so Stage 1→4
// progression compounds across sessions. Bumped each time an L1 cluster
// actually plays (detected in onPhaseChanged below) — not when the script
// emits one (the generator can plan future fires beyond the learner's
// current position).
const listeningProgress = shallowRef<UseListeningProgressReturn | null>(null)

// Dedup set: seeds whose fire_count has already been bumped within the
// currently-playing L1 cluster. Reset every listen_intro start so each
// cluster contributes one bump per seed regardless of how many listening
// cycles play for that seed (stage-1 plays 3, stage-4 plays 1, etc.).
let l1ClusterSeedsBumped: Set<number> | null = null

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
  else adaptationConsent.value = false
}

// Save consent to localStorage
const saveAdaptationConsent = (value) => {
  adaptationConsent.value = value
  localStorage.setItem(ADAPTATION_CONSENT_KEY, String(value))
}

// Handle consent change (called from Settings toggle)
const handleAdaptationConsent = async (granted) => {
  saveAdaptationConsent(granted)

  if (granted) {
    const success = await initializeVad()
    if (success) {
      console.log('[LearningPlayer] Adaptation enabled - timing will run silently')
    }
  } else {
    console.log('[LearningPlayer] Adaptation declined - learning continues normally')
    if (vadInstance.value) {
      vadInstance.value.dispose()
      vadInstance.value = null
      vadInitialized.value = false
    }
  }
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

  // Poll status for UI feedback during the cycle (subtle, not intrusive).
  // Guard against a dangling interval if startTimingCycle was re-entered
  // without a matching endTimingCycle (phase order bug, fast pause/resume).
  if (vadStatusInterval) {
    clearInterval(vadStatusInterval)
    vadStatusInterval = null
  }
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
// PRONUNCIATION MODE
// ============================================

const handlePronunciationMode = () => {
  handlePause()
  if (isPlayingIntroduction.value) skipIntroduction()
  if (isPlayingWelcome.value) skipWelcome()
  showPronunciationOverlay.value = true
  emit('pronunciationModeChanged', true)
}

const handleClosePronunciation = () => {
  showPronunciationOverlay.value = false
  emit('pronunciationModeChanged', false)
}

const exitPronunciationMode = () => {
  if (showPronunciationOverlay.value) {
    showPronunciationOverlay.value = false
    emit('pronunciationModeChanged', false)
  }
  handlePause()
}

const handlePronunciationToggle = () => {
  if (showPronunciationOverlay.value) {
    handleClosePronunciation()
  } else {
    if (showListeningOverlay.value) handleCloseListening()
    if (isDrivingModeActive.value) handleExitDrivingMode()
    handlePronunciationMode()
  }
}

// ============================================
// DRIVING MODE
// ============================================

// Driving mode explainer (always shown — audio pre-builds in background for instant start)
const showDrivingExplainer = ref(false)

// Mode toggle handlers — mutually exclusive
const handleListeningToggle = () => {
  if (showListeningOverlay.value) {
    handleCloseListening()
  } else {
    // Exit driving mode first if active
    if (isDrivingModeActive.value) handleExitDrivingMode()
    handleListeningMode()
  }
}

const handleDrivingToggle = () => {
  // If actively driving, exit fully
  if (isDrivingModeActive.value) {
    handleExitDrivingMode()
    return
  }
  // If modal is showing, cancel it
  if (showDrivingExplainer.value) {
    cancelDrivingExplainer()
    return
  }
  // Exit listening mode first if active
  if (showListeningOverlay.value) handleCloseListening()
  // Signal driving mode immediately (hides course identity, shows return arrow)
  emit('drivingModeChanged', true)
  // Start building audio immediately in background
  drivingMode.prepare(simplePlayer.roundIndex.value)
  // Always show the modal
  showDrivingExplainer.value = true
}

const confirmDrivingMode = () => {
  showDrivingExplainer.value = false
  handleEnterDrivingMode()
}

const cancelDrivingExplainer = () => {
  showDrivingExplainer.value = false
  emit('drivingModeChanged', false)
  // Pre-built audio stays alive — next tap will be instant
}

const handleEnterDrivingMode = async () => {
  handlePause() // stop SimplePlayer
  if (isPlayingIntroduction.value) skipIntroduction()
  if (isPlayingWelcome.value) skipWelcome()

  isDrivingModeActive.value = true
  emit('drivingModeChanged', true)
  drivingModeInitialRound = null

  try {
    await drivingMode.enter(simplePlayer.roundIndex.value)
  } catch (err) {
    console.error('[LearningPlayer] Failed to enter driving mode:', err)
    isDrivingModeActive.value = false
    emit('drivingModeChanged', false)
  }
}

const handleExitDrivingMode = () => {
  showDrivingExplainer.value = false
  const position = drivingMode.exit()
  isDrivingModeActive.value = false
  emit('drivingModeChanged', false)
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
    emit('drivingModeChanged', false)
    drivingModeInitialRound = null
  }
  if (showListeningOverlay.value) {
    showListeningOverlay.value = false
    emit('listeningModeChanged', false)
  }
  if (showPronunciationOverlay.value) {
    showPronunciationOverlay.value = false
    emit('pronunciationModeChanged', false)
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
}

// Close turbo popup without enabling
const closeTurboPopup = () => {
  showTurboPopup.value = false
  turboPopupShownThisSession.value = true  // They've seen it, don't show again
}

const toggleTurbo = () => {
  turboActive.value = !turboActive.value
}

// ============================================
// PAUSE/RESUME HANDLERS
// ============================================

// Quiet session-end: stop playback and save bookkeeping, but do NOT pop
// the SessionComplete overlay AND do NOT reset position. Infinite play
// means the course no longer ends in normal play; if simplePlayer's
// session_complete still fires (e.g. a course with zero usable LEGOs,
// or expansion genuinely produces nothing), we want to silently pause
// at the current position so a play-tap can pick straight back up —
// previously the embedded simplePlayer.stop() wiped roundIndex back to
// 0, which surfaced as "course finished but resumed at LEGO #1".
const showPausedSummary = () => {
  stopCycle()
  simplePlayer.pause()
  isPlaying.value = false
  audioEngaged.value = false

  // End belt progress session (saves session history for time estimates)
  if (beltProgress.value) {
    beltProgress.value.endSession(beltProgress.value.currentSeedNumber.value ?? 0, phrasesSpokenCount.value)
  }

  // Increment session count for guests (triggers signup prompt)
  if (auth && itemsPracticed.value > 0) {
    auth.incrementSessionCount()
  }
}


// Network loading removed — see archive/brain-views branch
const ensureNetworkLoaded = () => {}


const handleResumeLearning = async () => {
  // Hide summary and resume via the standard play path
  showSessionComplete.value = false

  // Start new belt progress session for time tracking
  if (beltProgress.value) {
    beltProgress.value.startSession(beltProgress.value.currentSeedNumber.value ?? 0)
  }

  await handleResume()
}

const handleExit = () => {
  // Stop playback and exit the player
  {
    stopCycle()
  }
  simplePlayer.stop()
  audioEngaged.value = false

  // End belt progress session (saves session history)
  if (beltProgress.value) {
    beltProgress.value.endSession(beltProgress.value.currentSeedNumber.value ?? 0, phrasesSpokenCount.value)
  }

  emit('close')
}

// Network functions removed — see archive/brain-views branch
const ensureNetworkInitialized = () => {}
const addNetworkNode = (_legoId: any, _targetText: any, _knownText: any, _beltColor = 'white') => {}
const populateNetworkUpToRound = (_targetRoundIndex: number) => {}

// ============================================
// PROGRESSIVE SCRIPT EXPANSION
// The course never ends. As the learner approaches the tail of
// cachedRounds we regenerate with a bigger endSeed — generateLearningScript
// produces revival rounds past the last new LEGO, so play is unbounded.
// ============================================
const EXPANSION_BATCH = 50  // generate this many more rounds on each expand
const expandScript = async (): Promise<number> => {
  if (isExpandingScript.value) return 0
  if (!supabase?.value) return 0
  if (!courseCode.value) return 0

  isExpandingScript.value = true
  try {
    // simplePlayer.roundCount is the live truth (works on both modern
    // SessionController and legacy paths). cachedRounds may be empty
    // on the SessionController path even when simplePlayer has rounds
    // queued — using its length here would lead to an under-sized
    // neededEnd and miss the infinite-play threshold entirely.
    const loadedCount = simplePlayer.roundCount.value
    const neededEnd = scriptBaseOffset.value + loadedCount + EXPANSION_BATCH
    const result = await generateScript()
    const expandedRounds = toSimpleRoundsWithComponents(result.items)
    if (expandedRounds.length > loadedCount) {
      const newRounds = expandedRounds.slice(loadedCount)
      // Keep cachedRounds in sync where other consumers read from it.
      cachedRounds.value = expandedRounds as any
      // Feed the new rounds to simplePlayer. appendRounds dedupes by
      // roundNumber so any overlap (loadSeedIfNeeded may have already
      // added some main-loop rounds) is handled cleanly.
      simplePlayer.appendRounds(newRounds as any)
      console.log(`[LearningPlayer] Expanded script: ${loadedCount} → ${expandedRounds.length} rounds (+${newRounds.length} appended)`)
      // Chain INF PLAY audio warm-up onto every expansion. Per Tom
      // 2026-05-20: there shouldn't be "subsequent warm-up periods" —
      // each new batch of 50 rounds should background-cache its audio
      // while the previous batch plays. EXPANSION_THRESHOLD=5 means
      // we fire when ~5 rounds remain, giving ~25 min for the new
      // batch to download before the learner reaches it.
      const isInfPlayRound = (r: any) =>
        Array.isArray(r?.cycles) && r.cycles.length > 0 && !r.cycles.some((c: any) =>
          c.type === 'intro' || c.type === 'debut' || c.type === 'build'
        )
      const hasInfPlayInExpansion = newRounds.some(isInfPlayRound)
      if (currentMode.value === 'infplay' || hasInfPlayInExpansion) {
        warmUpInfPlayRoundsBackground(newRounds as any, 0)
      }
      return newRounds.length
    } else {
      console.warn('[LearningPlayer] Expansion produced no new rounds — generator may be out of LEGOs to revive')
      return 0
    }
  } catch (err) {
    console.error('[LearningPlayer] Expansion failed:', err)
    return 0
  } finally {
    isExpandingScript.value = false
  }
}

// Network interaction functions removed — see archive/brain-views branch
const highlightNetworkNode = (_legoId: any) => {}
const strengthenPhrasePath = (_legoIds: any) => {}
const handleNetworkNodeTap = async (node: any) => {
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
    simplePlayer.pause()
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
  const isReturnUser = localStorage.getItem('ssi-has-played') === 'true'
  const MINIMUM_ANIMATION_MS = isReturnUser ? 300 : 2800

  // Stage 1: Awakening (immediate)
  setLoadingStage('awakening')

  // Initialize sync stuff immediately (no await needed)
  loadAdaptationConsent()

  // Fetch contribution data (non-blocking — fire and forget)
  if (courseCode.value && supabase?.value) {
    const learnerId = (auth as any)?.learnerId?.value || null
    contribution.fetch(courseCode.value, learnerId).catch(() => {})
  }

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
      case 'adaptationConsent':
        handleAdaptationConsent(detail.value)
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
      beltProgress.value?.setPlayingPosition(seedNumber)
    } catch (err) {
      console.warn('[LearningPlayer] Jump to seed failed:', err)
    }
  }
  window.addEventListener('ssi-jump-to-seed', jumpToSeedHandler)

  audioController.value = new RealAudioController()
  currentCourseCode.value = courseCode.value

  // Wire the cache-first AudioSource. AudioController.play() calls
  // audioSource.getAudioUrl(audioRef) and uses the returned blob: URL
  // when AudioCache has the id, falling through to /api/audio/<id>
  // when it doesn't. Bundle download + JIT prefetch populate
  // AudioCache; the SW cache stays as a network-level backstop for
  // anything neither layer has seen yet.
  if (courseCode.value) {
    audioCacheSource = createAudioCacheSource(audioCache, courseCode.value)
    audioController.value.setAudioSource(audioCacheSource)
    console.log('[LearningPlayer] AudioCache-backed audio source initialized for course:', courseCode.value)
  }

  // Initialize belt progress (loads from localStorage, merges with Supabase)
  await initializeBeltProgress()

  // Initialize per-LEGO adaptive pause engine (hydrates mastery from Supabase)
  await initializeAdaptationEngine()

  // Initialize Layer 1 fire-count persistence (hydrates from learner_l1_state)
  await initializeListeningProgress()

  // Load course-wide LEGO known_text lookup (powers the hero highlight in
  // cases where the salient LEGO's round isn't in loadedRounds, especially
  // infinite-play mode). Cheap one-shot query; fire-and-forget.
  void loadGlobalLegoKnownTexts()

  // Initialize offline play composable (sets up online/offline listeners)
  offlinePlayCleanup = initializeOfflinePlay()

  // Network initialization deferred to first play or Progress screen open

  // Track data loading state
  let dataReady = false
  let cachedScript = null
  // Whether the learner had already been introduced to the course's
  // final LEGO before this session started — set during the returning-
  // user resume branch and read by the jump-to-position logic to skip
  // the legoId.findIndex (which would map to the LEGO's main-loop
  // debut) and jump straight to the first infinite-play round.
  let hasReachedInfinitePlayInSession = false


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
      // Bundle load + background downloader (cache-based-content-loading)
      // ============================================
      // Fire bundle fetch + BundleDownloader as early as possible so the
      // background download has the longest possible runway. Does NOT
      // block the existing bootstrap path — both run concurrently.
      // Bundle fetch is cache-first (localStorage), typically resolves
      // in <10ms for returning learners.
      //
      // Failures are non-fatal: if the bundle endpoint is down or the
      // course isn't migrated to the new format yet, the existing
      // instant-playback + warm-up path continues to work unchanged.
      // Kick off course-final-LEGO resolution as early as possible so
      // wouldEnterInfplay has the data ready when the learner first
      // sees the forward-skip button. Cheap (one indexed query), cached.
      // Fire-and-forget — the computed has a sensible fallback while
      // this is in flight.
      void getCourseFinalLego(courseCode.value)

      void courseBundle.load(courseCode.value)
        .then((bundle) => {
          console.log(`[BundleLoad] Loaded bundle for ${bundle.courseCode} v${bundle.version}: ${bundle.legos.length} LEGOs, ${bundle.phrases.length} phrases`)
          // Arm the prefetcher with the bundle. The reactive watch
          // below picks up bundle-ready + rounds-populated transitions
          // and fires the initial onRoundChanged for the current
          // playback position.
          audioPrefetcher.setBundle(bundle)
          // BundleDownloader (always-on full-course audio prefetch) is
          // DISABLED. Bandwidth math says it isn't needed: ~30 KB per
          // audio × 3 audios per cycle = 90 KB/cycle, cycles are ~15s
          // including the speaking pause, so steady-state need is
          // ~6 KB/s — comfortable on 3G. AudioPrefetcher's per-round
          // JIT fetch (fired by the reactive watch below) already
          // covers that path. Eager-bundling every course also
          // disadvantaged casual users dipping into multiple courses
          // — downloading several full courses for a handful of
          // sentences is gratuitous bandwidth.
          //
          // The downloader class is intentionally left intact so a
          // future "Download for offline" button (e.g. for plane
          // journeys) can opt in. createBundleDownloader + .start
          // still work — they're just no longer fired from bootstrap.
        })
        .catch((err) => {
          // Branch-isolated: bundle endpoint may not yet be live on this
          // course. Legacy warm-up path is the safety net.
          console.warn('[BundleLoad] Bundle fetch failed — continuing with legacy path:', err)
        })

      // ============================================
      // Instant-playback cutover path (feature-flagged)
      // ============================================
      // When the course is in INSTANT_PLAYBACK_COURSES the player is
      // wired straight to the new endpoints: round-map + cycles, with
      // tier-1 prefetch immediately after bootstrap so the first round
      // is fully queued before the user hits play. Legacy path is
      // skipped entirely on this branch (early return below); flipping
      // a course off the flag set restores the legacy load with zero
      // code change.
      //
      // What we hand SimplePlayer: a `Round[]` produced by
      // `backendCyclesToRounds` from the composable's buffer. That
      // mirrors the legacy `toSimpleRounds(scriptItems)` output shape
      // exactly — so listening orchestration, pod scheduler, belt
      // progress, paywalls, all the downstream consumers stay
      // unchanged. The only difference is WHERE the data came from.
      if (isInstantPlaybackCourse(courseCode.value)) {
        // Pre-check: if the learner's already in INF PLAY mode,
        // bootstrap from /infplay-cycles instead of /cycles. Same
        // latency budget (~150-300ms), but emits review-only content
        // (spaced rep + random USE) instead of main-loop intros.
        //
        // This replaces the legacy CourseEndNoNextLego throw +
        // generateScript fallback (5-15s on cold cache).
        //
        // Also pulls the learner's current infplay_round_index so
        // bootstrap fetches from the RIGHT round (returning deep-
        // infplay learners get spaced rep computed against their
        // actual progress, not against round 1).
        //
        // Hoisted out of the bootstrap try block so the cache fast-
        // path below can branch on mode before it skips the network
        // bootstrap. Tom 2026-05-25.
        let inferEnrollmentMode: 'main' | 'infplay' = 'main'
        let inferInfPlayRoundIndex = 1
        if (!isGuestLearner.value && progressStore?.value && learnerId.value) {
          try {
            const enr = await progressStore.value.getEnrollment(learnerId.value, courseCode.value)
            inferEnrollmentMode = (enr?.current_mode === 'infplay') ? 'infplay' : 'main'
            inferInfPlayRoundIndex = Math.max(1, enr?.infplay_round_index ?? 1)
          } catch (modeErr) {
            console.warn('[InstantPlayback] mode pre-check failed, defaulting to main:', modeErr)
          }
        }

        // ============================================
        // CACHE FAST PATH (main-loop only)
        // ============================================
        // Returning learner with a populated script cache skips the
        // entire bootstrap round-trip + the background full-script
        // gen. Hydrate simplePlayer directly from cache and we're
        // <100ms from app mount to ready-to-play.
        //
        // INF PLAY is excluded: its revival rounds are deliberately
        // randomised per session (`/infplay-cycles` returns fresh
        // sampling), so cached INF PLAY rounds would serve the same
        // sequence every session — boring and pedagogically wrong.
        // INF PLAY learners still pay the small bootstrap cost; the
        // payoff is variety.
        //
        // Stale-content safety: useEagerScriptPreload calls
        // checkContentVersion before LearningPlayer mounts. If the
        // course's content_version bumped, the cache is already
        // cleared by the time we get here, so a hit means we're on
        // current content. Tom 2026-05-25.
        if (inferEnrollmentMode === 'main') {
          try {
            const cachedScript = await getCachedScript(courseCode.value)
            if (cachedScript && cachedScript.rounds.length > 0) {
              console.log(`[InstantPlayback] Cache fast-path: hydrating ${cachedScript.rounds.length} rounds from localStorage`)
              cachedRounds.value = cachedScript.rounds
              if (cachedScript.courseWelcome) {
                cachedCourseWelcome.value = cachedScript.courseWelcome
              }
              simplePlayer.initialize(cachedScript.rounds as any)
              loadedRounds.value = cachedScript.rounds as any
              extractComponentsToMaps(cachedScript.rounds as any, '[Components] cache-fast-path')

              // Resume position via the shared resolveResumePosition
              // helper — same lookup the bootstrap path uses, single
              // source of truth (localStorage) regardless of auth.
              const resume = resolveResumePosition(cachedScript.rounds as any[])
              const resumeRoundIndex = resume?.roundIndex ?? 0
              const resumeCycle = resume?.cycleIndex ?? 0
              if (resumeRoundIndex > 0 || resumeCycle > 0) {
                simplePlayer.jumpToRound(resumeRoundIndex, resumeCycle)
              }

              const startedAtLegoId = cachedScript.rounds[resumeRoundIndex]?.legoId
              if (startedAtLegoId) {
                instantPlayback.setCurrentLegoId(startedAtLegoId)
                if (beltProgress.value?.setLastLegoId) {
                  beltProgress.value.setLastLegoId(startedAtLegoId)
                }
                if (beltProgress.value?.setPlayingPosition) {
                  const seed = getSeedFromLegoId(startedAtLegoId)
                  if (seed !== null) beltProgress.value.setPlayingPosition(seed)
                }
              }

              positionInitialized.value = true
              dataReady = true
              return
            }
          } catch (cacheErr) {
            console.warn('[InstantPlayback] Cache fast-path failed, falling through to bootstrap:', cacheErr)
          }
        }

        try {
          // 1. Bootstrap — round-map + first cycle. This is the
          //    minimum to know "what round is the learner on" and to
          //    have audio ready to roll. Cold-path budget here is
          //    one indexed query + one tiny cycles fetch.
          const bootstrapResult = inferEnrollmentMode === 'infplay'
            ? await instantPlayback.bootstrapInfPlay(inferInfPlayRoundIndex)
            : await instantPlayback.bootstrap()
          console.log(
            `[InstantPlayback] Bootstrap ready (${inferEnrollmentMode}):`,
            `firstCycle=${bootstrapResult.firstCycle.id}`,
            `mapVersion=${bootstrapResult.mapVersion}`,
          )

          // 2. (Removed) Tier 1 used to be a separate awaited fetch
          //    here. Bootstrap now grabs the whole first round in one
          //    parallel call alongside the round-map, so the buffer is
          //    already complete by the time we get here — no second
          //    network roundtrip before player init. This was the
          //    "playback is the loading mask" fix per the spec.

          // 3. Build the player's Round[] from the composable's
          //    buffer. INF PLAY uses a different adapter — rounds
          //    group by inf_round (multiple LEGOs per round) vs main-
          //    loop which groups by legoId.
          const map = instantPlayback.roundMap.value
          if (!map) {
            // Bootstrap promises this is non-null on success, but
            // defensively bail to the legacy path if it ever isn't.
            throw new Error('Instant playback bootstrap left roundMap empty')
          }
          const initialRounds = inferEnrollmentMode === 'infplay'
            ? infPlayCyclesToRounds(
                instantPlayback.infPlayCycles.value as any,
                map.rounds[0] ? map.rounds[0].r - 1 : 0,  // mainLoopCount = absolute round - infRound
              )
            : backendCyclesToRounds(
                instantPlayback.getBufferedCyclesForLego,
                map,
                instantPlayback.isLegoComplete,
              )
          if (initialRounds.length === 0) {
            throw new Error('Instant playback produced 0 rounds from buffer')
          }
          console.log(`[InstantPlayback] Built ${initialRounds.length} round(s) for SimplePlayer`)

          simplePlayer.initialize(initialRounds as any)
          loadedRounds.value = initialRounds as any
          // Populate the M-LEGO component lookup maps from the bootstrap
          // rounds — backendCyclesToRounds emits `cycle.components` for
          // every cycle whose parent LEGO has components, the maps just
          // need extracting. Without this, the first round's M-LEGOs
          // render without their known-text breakdown until the full-
          // script handoff fires and backfills.
          extractComponentsToMaps(initialRounds, '[Components] bootstrap')

          // 4. Resume position. The resolver returns NEXT(last_completed)
          //    so the bootstrap LEGO IS the round the learner should
          //    play next — no "jump past" needed. We start at round 0
          //    of initialRounds (= the resolved next LEGO) and apply
          //    the saved mid-round cycle cursor so app close/reopen
          //    mid-round resumes at the right cycle, not the round
          //    start. Fresh learners (resolver returned null →
          //    bootstrap picked round-map.rounds[0]) get the same
          //    "start at round 0 cycle 0" treatment, which is correct
          //    because they have no saved cycle state.
          const startedAtLegoId = bootstrapResult.firstCycle.lego_id
          // Prefer localStorage cycle when it's for the LEGO bootstrap
          // landed on (same-device resume). Fall back to the server-
          // sourced savedCurrentCycleIndex for the new-device case
          // where bootstrap went to next-LEGO via enrollment and we
          // have no local cursor.
          const localPos = loadPositionFromLocalStorage()
          const resumeCycle = (localPos?.legoId === startedAtLegoId)
            ? Math.max(0, localPos?.itemInRound || 0)
            : Math.max(0, savedCurrentCycleIndex.value || 0)
          if (resumeCycle > 0) {
            console.log(`[InstantPlayback] Resuming at ${startedAtLegoId} cycle ${resumeCycle}`)
            simplePlayer.jumpToRound(0, resumeCycle)
          }
          // Keep the composable's cursor in sync with what's playing,
          // so tier-3 anchors the N+1 lookup off the right LEGO.
          instantPlayback.setCurrentLegoId(startedAtLegoId)

          // Mirror the same belt-position update the legacy path does
          // so the belt label / journey bar reflect where the user is
          // before the first cycle starts.
          if (startedAtLegoId && beltProgress.value?.setLastLegoId) {
            beltProgress.value.setLastLegoId(startedAtLegoId)
          }
          if (startedAtLegoId && beltProgress.value?.setPlayingPosition) {
            const seed = getSeedFromLegoId(startedAtLegoId)
            if (seed !== null) beltProgress.value.setPlayingPosition(seed)
          }

          // 5. Background tier 2 + 3 — main-loop only. INF PLAY has
          //    its own pagination via prefetchNextInfPlayBatch (fired
          //    by the near-edge watcher below). Tier 2/3 walk the
          //    round-map by legoId, which doesn't make sense for INF
          //    PLAY's by-round structure.
          if (inferEnrollmentMode !== 'infplay') {
            void instantPlayback.prefetchTier2()
              .then(() => instantPlayback.prefetchTier3())
              .then(() => {
                // Tier 3 may have brought in the N+1 round's cycles —
                // fold them into SimplePlayer so the engine can walk
                // past the initial loaded edge without stalling.
                const refreshedMap = instantPlayback.roundMap.value
                if (!refreshedMap) return
                const refreshedRounds = backendCyclesToRounds(
                  instantPlayback.getBufferedCyclesForLego,
                  refreshedMap,
                  instantPlayback.isLegoComplete,
                )
                // appendRounds dedupes by roundNumber, so this is a
                // safe no-op when nothing new arrived.
                if (refreshedRounds.length > initialRounds.length) {
                  const newRounds = refreshedRounds.slice(initialRounds.length) as any
                  simplePlayer.appendRounds(newRounds)
                  loadedRounds.value = refreshedRounds as any
                  extractComponentsToMaps(newRounds, '[Components] tier-3 refresh')
                }
              })
          } else {
            // INF PLAY: warm up audio for ALL bootstrap rounds in
            // background. The /infplay-cycles endpoint gave us cycle
            // metadata; the audio bytes still need fetching. Without
            // this, the audio element pulls each clip on-demand,
            // exposing 4G latency on every cycle (Tom's "audio fell
            // off a cliff after 2 cycles" 2026-05-20).
            warmUpInfPlayRoundsBackground(initialRounds as any, 0)
            // Next-batch prefetch: get the next 5 infplay rounds AND
            // warm up their audio. Fires concurrently with the first-
            // batch warm-up above so by the time the learner reaches
            // round 6 the audio's ready.
            void instantPlayback.prefetchNextInfPlayBatch().then(() => {
              const mapForInf = instantPlayback.roundMap.value
              if (!mapForInf) return
              const mainLoopCount = mapForInf.rounds[0] ? mapForInf.rounds[0].r - 1 : 0
              const refreshedRounds = infPlayCyclesToRounds(
                instantPlayback.infPlayCycles.value as any,
                mainLoopCount,
              )
              if (refreshedRounds.length > initialRounds.length) {
                const newRounds = refreshedRounds.slice(initialRounds.length) as any
                simplePlayer.appendRounds(newRounds)
                loadedRounds.value = refreshedRounds as any
                // Warm up the new rounds' audio too.
                warmUpInfPlayRoundsBackground(newRounds as any, 0)
              }
            })
          }

          // Full-script handoff: kick off generateScript() in the
          // background. INF PLAY skips this — its content comes from
          // the /infplay-cycles endpoint, paginated batch-by-batch.
          // generateScript would emit a full main-loop + 50 infplay
          // rounds which would replace the queue with content that
          // doesn't make sense in INF PLAY (no need to re-walk main
          // loop the learner has chosen to leave).
          if (inferEnrollmentMode === 'infplay') {
            positionInitialized.value = true
            dataReady = true
            return
          }

          // Main-loop handoff path below.
          //
          // The bootstrap above gave us ~5 minutes of audio to play
          // with, which is plenty for the generator to walk the whole
          // course. When it lands we replace SimplePlayer's queue
          // past the currently-playing round with the full local
          // script — every subsequent round is locally constructed,
          // so no per-round network calls, graceful degradation into
          // infplay when audio's missing, offline-mode-capable as the
          // audio cache fills in.
          void generateScript()
            .then(async (result) => {
              const fullRounds = toSimpleRoundsWithComponents(result.items) as any[]
              if (fullRounds.length === 0) {
                console.warn('[InstantPlayback] Full-script gen returned 0 rounds — staying on API path')
                return
              }
              simplePlayer.replaceQueueFromCurrent(fullRounds)
              // Mirror into the legacy ref so saveRoundProgress's
              // cachedRounds walk (and any other consumer reading the
              // alias) has the full course in scope, not just the
              // bootstrap window.
              cachedRounds.value = fullRounds
              console.log(`[InstantPlayback] Full-script handoff: ${fullRounds.length} rounds local, no further per-round network needed`)

              // Cache for warm-start. Until this commit the script cache
              // was never written — setCachedScript was imported but
              // never called (lost in ff6a4756's deprecation cleanup,
              // Feb 2026). With this restored, the next cold start hits
              // localStorage and skips the 3-8s generateScript walk,
              // and welcome metadata + course shape are available
              // instantly offline. The audio map is stripped on write
              // (audioRefs live on the items already), so cache stays
              // under the 5MB localStorage budget. Tom 2026-05-25.
              try {
                await setCachedScript(courseCode.value, {
                  rounds: fullRounds,
                  totalSeeds: fullRounds.length,
                  totalLegos: fullRounds.length,
                  totalCycles: result.cycleCount,
                  estimatedMinutes: Math.round(result.cycleCount * 0.2),
                  audioMapObj: {},
                  courseWelcome: cachedCourseWelcome.value || undefined,
                })
              } catch (cacheErr) {
                console.warn('[InstantPlayback] setCachedScript failed (non-fatal):', cacheErr)
              }
            })
            .catch((err) => {
              console.warn('[InstantPlayback] Full-script background gen failed, API path remains the fallback:', err)
            })

          // Mark position + data ready and skip the legacy load
          // entirely. The flag-on branch is now the only source of
          // truth for the player's round list.
          positionInitialized.value = true
          dataReady = true
          return
        } catch (err) {
          // Instant-playback failed for some reason (backend 500,
          // round map not refreshed, etc.). Fall through to the
          // legacy load — that's our safety net, exactly as designed.
          console.warn('[InstantPlayback] Cutover path failed, falling back to legacy:', err)
        }
      }

      // ============================================
      // SessionController initialization path
      // ============================================
      // Wait for courseDataProvider to be set (App.vue sets it in onMounted, which runs after children mount)
      if (!courseDataProvider.value) {
        console.log('[LearningPlayer] Waiting for courseDataProvider...')
        await new Promise<void>((resolve) => {
          // `let` (not const) so `finish` can safely null-check it during
          // the synchronous `immediate: true` callback — at that point the
          // `watch(...)` call hasn't returned yet, so the variable exists
          // but is still null.
          let unwatch: (() => void) | null = null
          let timeoutId: ReturnType<typeof setTimeout> | null = null
          let settled = false
          const finish = () => {
            if (settled) return
            settled = true
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
            if (unwatch) { unwatch(); unwatch = null }
            resolve()
          }
          unwatch = watch(
            () => courseDataProvider.value,
            (provider) => { if (provider) finish() },
            { immediate: true }
          )
          // If immediate:true fired and already settled, skip the timeout.
          if (!settled) timeoutId = setTimeout(finish, 5000)
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

            // Fetch enrollment row up-front. beltProgress is a localStorage-
            // + remote-cache UI helper and races loadAllData on cold start
            // (PWA reload, ?reset=1, fresh tab), so reading from it alone
            // can yield startingSeed=0 for a learner who clearly has DB
            // progress. The enrollment row IS canonical — pull it now so
            // returning-user detection, infinite-play detection, the
            // welcome-skip check, and the belt label all converge on the
            // same source of truth before we generate the script.
            const freshProgress = !isGuestLearner.value ? await loadSavedProgress() : null
            const freshLastLego = freshProgress?.lastCompletedLegoId ?? null
            const freshHighestLego = freshProgress?.highestCompletedLegoId ?? null

            // Seed the main-loop high-water from the DB ceiling so that
            // infinite-play rounds completed early in the session — before
            // any main-loop round has fired in this session — still
            // substitute to a useful cursor (at minimum the existing
            // ceiling, never regressing).
            if (freshHighestLego) {
              lastMainLoopLegoId.value = freshHighestLego
            }

            // Mirror into the refs immediately so the belt label, journey
            // bar, and welcome-skip guard see the ceiling without waiting
            // for the separate watcher to fire.
            if (freshHighestLego && !highestCompletedLegoId.value) {
              highestCompletedLegoId.value = freshHighestLego
              highestCompletedRoundIndex.value = freshProgress?.highestCompletedRoundIndex ?? null
            }
            // And push the lastLegoId into beltProgress so the belt label
            // shows the right colour before the user even taps play.
            if (freshLastLego && beltProgress.value?.setLastLegoId) {
              beltProgress.value.setLastLegoId(freshLastLego)
            }

            if (classLastLegoId) {
              // Class mode: derive seed from class's last LEGO position
              const seedMatch = classLastLegoId.match(/^S(\d{4})L/)
              startingSeed = seedMatch ? parseInt(seedMatch[1], 10) : 0
              isReturningUser = startingSeed > 0
            } else {
              const dbSeed = freshLastLego ? (getSeedFromLegoId(freshLastLego) ?? 0) : 0
              const completedSeeds = beltProgress.value?.completedRounds.value ?? 0
              const currentSeedFromLegoId = beltProgress.value?.currentSeedNumber.value ?? 0
              // Take the max of all three sources — the DB read is
              // authoritative but the legacy beltProgress paths can
              // occasionally have a higher value (e.g. mid-session
              // updates not yet written to the enrollment row).
              startingSeed = Math.max(dbSeed, currentSeedFromLegoId, completedSeeds)
              isReturningUser = startingSeed > 0 || !!freshHighestLego
            }

            // Set playing belt to match starting position
            if (startingSeed > 0) {
              beltProgress.value?.setPlayingPosition(startingSeed)
            }

            // Await eager script (preloaded from App.vue) or fall back to direct call.
            // Two-phase preload: phase 1 covers seeds 1-INITIAL_PRELOAD_SEEDS for fast
            // start; phase 2 fills in the rest in the background. Returning users
            // beyond the initial window must await phase 2 so jumpToRound finds them.
            //
            // Listening Pods (Layer 2) activation: for returning users with progress,
            // resolve their per-enrollment pod_activation_round pin (writing it on
            // first session if NULL) so the pod sequence starts from where they
            // are now, not from R6 retroactively. When the pin differs from the
            // default we bypass the eager preload and load fresh with the override
            // — eager preload always uses the default config.
            // Resolve the pod activation pin once — feeds into listeningConfig
            // for any path that doesn't use the eager preload's default config.
            // Base config comes from algorithm_config (DB-tweakable) so admins
            // can change layer1Playlist / graduation offset / window sizes
            // without redeploying. Falls back to DEFAULT_LISTENING_CONFIG if
            // the load hasn't completed yet.
            const baseListeningConfig = listeningConfig.value || DEFAULT_LISTENING_CONFIG
            // Admin default for pod activation now lives on PodsConfig.
            // Legacy `listening` rows still carry it; prefer that (it's the
            // row that's been around longest), fall back to pods, then 6.
            const adminPodActivationDefault =
              baseListeningConfig.podActivationRound ?? podsConfig.value.podActivationRound ?? 6
            let podActivationOverride: number | null = null
            if (isReturningUser && startingSeed > 0) {
              const resolved = await resolvePodActivationRound(
                supabase.value,
                learnerId.value,
                courseCode.value
              )
              if (resolved !== adminPodActivationDefault) {
                podActivationOverride = resolved
                console.log(`[LearningPlayer] Pod activation pinned at round ${resolved} for returning user`)
              }
            }

            // Pick the load path:
            //   - Returning user (past seed 0):       own load, seeds 1..(startingSeed + LOOKAHEAD_CHUNK_SEEDS), with pod pin
            //   - New user, eager preload available:  use the eager preload (seeds 1..INITIAL_PRELOAD_SEEDS)
            //   - Fallback (no eager):                own load, seeds 1..INITIAL_PRELOAD_SEEDS
            //
            // No two-phase preload, no extension await. Near-edge watcher
            // (set up further down) extends the loaded set chunk-by-chunk
            // as the player advances.
            let result
            const eagerCourseMatches = eagerScript?.scriptPromise?.value &&
              eagerScript.courseCode.value === courseCode.value
            const config = podActivationOverride !== null
              ? { ...baseListeningConfig, podActivationRound: podActivationOverride }
              : baseListeningConfig

            if (isReturningUser && startingSeed > 0) {
              // Infinite-play detection — keyed on legoId, not round_index.
              // Round indices aren't stable across sessions (lazy loading
              // produces different scripts each time), so we can't trust
              // a saved round number. lego_id IS stable.
              //
              // The signal: if the learner's highest-ever-introduced LEGO
              // (highest_completed_lego_id, ratcheted server-side) equals
              // the course's LAST is_new LEGO, every main-loop LEGO has
              // been seen and they belong in infinite-play territory —
              // regardless of which LEGO the cursor (random USE review)
              // happens to have last touched.
              //
              // freshHighestLego was already read at the top of this
              // branch and mirrored into the ref. Run the infinite-play
              // detection against it.
              // Two ways to be "in infplay" for resume purposes:
              //   1. Position-derived: highest_completed_lego_id IS the
              //      course's literal final LEGO (natural progression
              //      through every belt)
              //   2. Mode-derived: current_mode === 'infplay'
              //      (explicit purple-button entry — works even when
              //      the learner belt-skipped forward and didn't
              //      touch the literal final LEGO, e.g. Tom's deu
              //      stuck at highest=S0281L01 in a 592-LEGO course)
              //
              // Either signal triggers the infplay resume branch,
              // which jumps to first-infplay-round instead of the
              // legoId-based resume that would replay S0281L01+1's
              // intro.
              const positionSaysInfPlay = await hasReachedInfinitePlay(
                freshHighestLego,
                courseCode.value,
              )
              const enrollmentSaysInfPlay = (freshProgress?.currentMode ?? 'main') === 'infplay'
              hasReachedInfinitePlayInSession = positionSaysInfPlay || enrollmentSaysInfPlay
              console.log(`[LearningPlayer] Infinite-play check: highest_lego=${freshHighestLego} positionSays=${positionSaysInfPlay} modeSays=${enrollmentSaysInfPlay} → ${hasReachedInfinitePlayInSession ? 'YES, in INF PLAY' : 'no, still in main loop'}`)

              let endSeed: number
              if (hasReachedInfinitePlayInSession) {
                // Force a script with the whole main loop + a fresh
                // batch of infinite-play rounds. endSeed acts as a round
                // cap inside the infinite-play while-loop, so it must
                // exceed the main-loop round count by EXPANSION_BATCH
                // for revival rounds to be emitted.
                const mainLoopCount = await getCourseMainLoopRoundCount(courseCode.value)
                endSeed = mainLoopCount + EXPANSION_BATCH
                console.log(`[LearningPlayer] Returning user has reached infinite play — loading full course + ${EXPANSION_BATCH} infinite-play rounds (endSeed=${endSeed})`)
              } else {
                endSeed = startingSeed + LOOKAHEAD_CHUNK_SEEDS
                console.log(`[LearningPlayer] Returning user at seed ${startingSeed} — loading 1..${endSeed}${podActivationOverride !== null ? ' (custom pod pin)' : ''}`)
              }
              result = await generateScript(config)
              console.log(`[LearningPlayer] Returning-user load ready: ${result.items.length} items, ${result.roundCount} rounds`)
            } else if (eagerCourseMatches) {
              console.log('[LearningPlayer] Awaiting eager script preload...')
              result = await eagerScript.scriptPromise.value
              console.log(`[LearningPlayer] Eager preload ready: ${result.items.length} items, ${result.roundCount} rounds`)
            } else {
              console.log('[LearningPlayer] No eager preload available, loading directly...')
              result = await generateScript(config)
              console.log(`[LearningPlayer] Direct load: ${result.items.length} items, ${result.roundCount} rounds`)
            }

            if (result.items.length > 0) {
              const simpleRounds = toSimpleRoundsWithComponents(result.items)

              simplePlayer.initialize(simpleRounds as any)

              // Restore position for returning users.
              // Uses last_completed_lego_id (exact LEGO position) instead of
              // seed number — seed-based resume jumps to the first round of
              // the NEXT seed, which skips mid-seed LEGOs the learner hadn't
              // finished. Falls back to seed-based only if lastLegoId is
              // missing.
              if (isReturningUser) {
                const personalLastLegoId = beltProgress.value?.lastLegoId?.value ?? null
                let resumeLegoId = classLastLegoId ?? personalLastLegoId
                // Mid-round cycle cursor — only meaningful for the in-progress
                // round (lastIdx + 1). Other resume branches (final round, or
                // jumps that change which round is "current") fall back to
                // cycle 0 because the saved index doesn't apply there.
                let resumeCycle = savedCurrentCycleIndex.value

                // Resume TTL — re-engage long-absent learners with material
                // they're starting to forget. Compute against the saved DB
                // timestamp (not auth restoration time) so a session that
                // stays open for hours doesn't trigger a regression.
                if (savedLastPracticedAt.value) {
                  const daysSince = (Date.now() - savedLastPracticedAt.value.getTime()) / (1000 * 60 * 60 * 24)
                  const ttl = resumeConfig.value
                  if (daysSince >= ttl.beltRegressionDays && resumeLegoId) {
                    // Belt regression: walk the cursor back to the start of
                    // the learner's current belt. Ceiling preserved by the
                    // setEnrollmentCursor write — that update doesn't lower
                    // highest_completed_*.
                    const seed = getSeedFromLegoId(resumeLegoId)
                    if (seed !== null) {
                      let beltIdx = 0
                      for (let i = BELTS.length - 1; i >= 0; i--) {
                        if (seed >= BELTS[i].seedsRequired) { beltIdx = i; break }
                      }
                      const beltStartSeed = Math.max(BELTS[beltIdx].seedsRequired, 1)
                      const beltStartRoundIdx = simplePlayer.findRoundIndexForSeed(beltStartSeed)
                      if (beltStartRoundIdx > 0) {
                        const priorRound = simpleRounds[beltStartRoundIdx - 1]
                        if (priorRound?.legoId) {
                          console.log(`[ResumeTTL] ${Math.round(daysSince)}d gap → belt regression to ${BELTS[beltIdx].name} (seed ${beltStartSeed}, lego ${priorRound.legoId})`)
                          resumeLegoId = priorRound.legoId
                          resumeCycle = 0
                          if (!isGuestLearner.value && progressStore?.value) {
                            progressStore.value.setEnrollmentCursor(
                              learnerId.value, courseCode.value,
                              priorRound.legoId, beltStartRoundIdx - 1,
                            ).catch((err: unknown) => {
                              console.warn('[ResumeTTL] setEnrollmentCursor failed:', err)
                            })
                          }
                        }
                      }
                    }
                  } else if (daysSince >= ttl.cycleResetDays) {
                    console.log(`[ResumeTTL] ${Math.round(daysSince)}d gap → cycle reset (round restart)`)
                    resumeCycle = 0
                  }
                }

                const modeTag = classLastLegoId ? 'Class mode' : 'Personal'

                if (hasReachedInfinitePlayInSession) {
                  // Learner has been introduced to the course's last
                  // LEGO. Don't try to restore exact position — find
                  // the first round in simpleRounds that has no intro /
                  // debut / build cycle (= the first infinite-play
                  // round) and start there. The exact LEGO they last
                  // reviewed doesn't matter; infinite play is
                  // recency-weighted random USE + spaced rep, so a
                  // fresh series is as good as any restored point.
                  const firstInfPlayIdx = simpleRounds.findIndex(r =>
                    !r.cycles?.some(c =>
                      c.type === 'intro' || c.type === 'debut' || c.type === 'build'
                    )
                  )
                  if (firstInfPlayIdx >= 0) {
                    console.debug(`[eagerLoad] ${modeTag}: infinite play reached — resuming at first infinite-play round (index ${firstInfPlayIdx})`)
                    // Spotify-style bootstrap: fetch only the first
                    // cycle's audio (~3 files), start playing, fetch
                    // everything else in background. Same model as
                    // the main player's instant-playback bootstrap.
                    //
                    // If first-time learner, type intro in parallel.
                    const showIntro = !hasSeenInfPlayIntro(courseCode.value)
                    const usedBundle = isBundleBasedInfplayCourse(courseCode.value)
                      && await enterInfPlayViaBundle(infplayRoundIndex.value || 1, showIntro)
                    if (!usedBundle) {
                      isWarmingUpInfPlay.value = true
                      try {
                        const slice = simpleRounds.slice(firstInfPlayIdx)
                        const warmUpPromise = warmUpFirstInfPlayCycle(slice as any)
                        if (showIntro) {
                          await Promise.all([warmUpPromise, startInfPlayIntro()])
                          markInfPlayIntroSeen(courseCode.value)
                          clearInfPlayIntro()
                        } else {
                          await warmUpPromise
                        }
                      } finally {
                        isWarmingUpInfPlay.value = false
                      }
                      simplePlayer.jumpToRound(firstInfPlayIdx)
                      // Phase 2 (background): everything else.
                      warmUpInfPlayRoundsBackground(simpleRounds as any, firstInfPlayIdx)
                    }
                  } else {
                    // Shouldn't happen — endSeed was sized to force
                    // infinite-play emission — but fall through to the
                    // last loaded round if it does.
                    console.warn('[eagerLoad] Infinite play flagged but no infinite-play round found in simpleRounds — staying at last main-loop round')
                    simplePlayer.jumpToRound(simpleRounds.length - 1)
                  }
                } else if (resumeLegoId) {
                  // Main-loop resume — legoId is canonical. Find it and
                  // start at the NEXT round (so the learner doesn't
                  // re-do the LEGO they just finished).
                  const lastIdx = simpleRounds.findIndex(r => r.legoId === resumeLegoId)
                  if (lastIdx >= 0 && lastIdx + 1 < simpleRounds.length) {
                    console.debug(`[eagerLoad] ${modeTag}: resuming after ${resumeLegoId} (round ${lastIdx + 1}, cycle ${resumeCycle})`)
                    simplePlayer.jumpToRound(lastIdx + 1, resumeCycle)
                  } else if (lastIdx >= 0) {
                    console.debug(`[eagerLoad] ${modeTag}: resuming at final loaded round (${resumeLegoId})`)
                    simplePlayer.jumpToRound(lastIdx)
                  } else {
                    const nextSeed = startingSeed + 1
                    const roundIndex = simplePlayer.findRoundIndexForSeed(nextSeed)
                    if (roundIndex >= 0) {
                      console.debug(`[eagerLoad] LegoId ${resumeLegoId} not loaded, falling back to seed ${nextSeed} (round ${roundIndex}, cycle ${resumeCycle})`)
                      simplePlayer.jumpToRound(roundIndex, resumeCycle)
                    }
                  }
                } else {
                  // No legoId on record — seed-based fallback.
                  const nextSeed = startingSeed + 1
                  const roundIndex = simplePlayer.findRoundIndexForSeed(nextSeed)
                  if (roundIndex >= 0) {
                    console.debug(`[eagerLoad] No legoId, restoring by seed ${startingSeed} → ${nextSeed} (round ${roundIndex}, cycle ${resumeCycle})`)
                    simplePlayer.jumpToRound(roundIndex, resumeCycle)
                  }
                }
              }

              // Store for legacy code
              loadedRounds.value = simpleRounds as any

              // Preload audio for the first 2 rounds immediately
              preloadSimpleRoundAudio(simpleRounds, 2, simplePlayer.roundIndex.value ?? 0)

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

          // Mark data + position as ready. The legacy fallback paths
          // below set positionInitialized too — flipping it here covers
          // the modern SessionController path so the proactive-expansion
          // watcher actually fires (it bails on !positionInitialized,
          // which without this flip stays false for the entire session).
          positionInitialized.value = true
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

        // (Ceiling fetch is handled by the unconditional watch on
        // courseCode + learnerId near where the refs are declared — it
        // covers both cached-script and fresh-generate paths.)

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
          const result = await generateScript()
          const simpleRounds = toSimpleRoundsWithComponents(result.items)

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
  // Warm the first known audio so the opening sound is instant (bounded).
  await warmFirstKnownAudio()
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
        const expandResult = await generateScript()
        const expandedRounds = toSimpleRoundsWithComponents(expandResult.items)
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
      updateBeltForPosition(targetIndex)

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

  // Start session timer. Tick whenever the learner is engaged with audio —
  // including listening pods and commentary, not just the cycle player. A
  // 6-minute pod lap is still 6 minutes of practice and should count.
  sessionTimerInterval = setInterval(() => {
    if (isPlaying.value || playingPodLapAudio.value || playingCommentaryAudio.value) {
      sessionSeconds.value++
    }
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

    // Welcome audio deferred until user taps Play (never autoplay before interaction)
  }

  console.log('[LearningPlayer] Total awakening time:', Date.now() - startTime, 'ms')
})

// ============================================
// HERO PANE HEIGHT TRACKING
// Measure the hero text pane's bottom edge so LegoAssembly tiles never overlap it
const heroTextPaneRef = ref<HTMLElement | null>(null)
const heroPaneBottom = ref(250)
let heroResizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (heroTextPaneRef.value) {
    const measure = () => {
      const el = heroTextPaneRef.value
      if (el) heroPaneBottom.value = el.offsetTop + el.offsetHeight
    }
    heroResizeObserver = new ResizeObserver(measure)
    heroResizeObserver.observe(heroTextPaneRef.value)
    measure()
  }
})

onUnmounted(() => {
  heroResizeObserver?.disconnect()
  heroResizeObserver = null

  // Drop any in-flight skip-prep: bump the token so a still-pending
  // prefetch's post-await jumpToRound is skipped, and clear the
  // dialog/timer state so we don't leak on remount.
  skipPrepToken += 1
  clearSkipPrepDialog()

  // Abort any in-flight instant-playback fetches so we don't keep
  // pulling data the user just navigated away from.
  instantPlayback.cancel()

  // Stop the bundle downloader if running. Cursor is persisted on
  // each batch so the next session resumes where we left off.
  bundleDownloader?.stop()
  courseBundle.cancel()
  // Drop the prefetcher's in-memory indices. Cached ephemeral audio
  // for in-progress LEGOs stays in IndexedDB; the cache's own
  // lifecycle reclaims it on the next session boundary or eviction.
  audioPrefetcher.reset()
  // Release any blob: URLs the AudioSource handed out this session so
  // we don't leak. Cached blobs in IndexedDB survive — only the
  // URL.createObjectURL handles are revoked.
  audioCacheSource?.revokeAllBlobUrls()
  audioCacheSource = null

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

  // Release wake lock
  releaseWakeLock()

  // Clear Media Session metadata + action handlers
  clearMediaSession()

  // Stop cycle playback
  stopCycle()
  if (ringAnimationFrame) cancelAnimationFrame(ringAnimationFrame)
  if (sessionTimerInterval) clearInterval(sessionTimerInterval)
  if (vadStatusInterval) clearInterval(vadStatusInterval)

  // Flush any pending per-LEGO metrics, remove pagehide listener
  adaptationEngine.value?.dispose()
  // Flush any pending L1 fire-count bumps
  listeningProgress.value?.dispose()
  // Resume-audio listeners (registered top-level near extractAudioIdsFromCycle)
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onSaveResumeVisibilityChange)
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('pagehide', saveResumeAudio)
  }
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
    isPlayingWelcome.value = false
    for (const c of welcomeEventCleanups) { try { c() } catch (_e) { /* ignore */ } }
    welcomeEventCleanups = []
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
    }
    // Welcome audio deferred until user taps Play (never autoplay before interaction)
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
      const tc = turboConfig.value
      freshResult = await generateSimpleScript(
        supabase.value, newCourseCode, 50,
        listeningConfig.value,
        scriptShapeConfig.value,
        { fibKeep: tc.fibKeep, buildKeep: tc.buildKeep, useKeep: tc.useKeep },
      )
    }
    const freshRounds = toSimpleRoundsWithComponents(freshResult.items)
    cachedRounds.value = freshRounds as any
  }

  // Initialize for new course - legacy initOrchestrator removed
  // The SessionController path handles this automatically

  // Mark as ready (warm the first known audio first, bounded — instant opening)
  await warmFirstKnownAudio()
  setLoadingStage('ready')
  isInitialized.value = true

  previousCourseCode = newCourseCode
  console.log('[LearningPlayer] Course change complete, ready to play')
}, { immediate: false })

// Expose methods for parent component (PlayerContainer) to control playback
const togglePlayback = () => {
  // If a pod lap or commentary is playing, the big button reads "stop"
  // (per isAudioPlaying). Pressing it should halt everything — the runtime
  // audio AND any auto-resume into the next round. Without this we'd
  // resume() simplePlayer mid-pod, overlapping audio.
  if (playingPodLapAudio.value || playingCommentaryAudio.value) {
    // Halt the runtime audio and tell handleRoundBoundary not to auto-resume.
    // Do NOT call simplePlayer.stop() — it resets roundIndex to 0, wiping the
    // learner's in-session position. simplePlayer is already paused while the
    // pod/commentary plays; leave its state alone so handleResume can pick up
    // where it left off.
    userStoppedDuringLap.value = true
    podLapCancelled.value = true
    audioController.value?.stop()
    return
  }
  if (isPlaying.value) {
    handlePause()
  } else {
    handleResume()
  }
}

// Absolute round positions for the resting-state "skip to round N" UX.
// 1-based for display. Both cursor and ceiling are derived: the script is
// always loaded from seed 1 so simplePlayer.roundIndex IS the absolute
// round index for the cursor. The ceiling comes from the enrollment row.
const currentAbsoluteRound = computed(() => {
  const idx = simplePlayer.roundIndex.value
  return typeof idx === 'number' ? idx + 1 : null
})
const highestAbsoluteRound = computed(() => {
  const idx = highestCompletedRoundIndex.value
  return typeof idx === 'number' ? idx + 1 : null
})

// Cursor LEGO ID for the resting-state journey-bar comparison.
// Sourced from the DB enrollment row (last_completed_lego_id) via
// lastCompletedLegoIdRef — NOT derived from simplePlayer.
// simplePlayer.currentRound is null/stale during the resting state
// (player hasn't started) and an INF PLAY round's legoId is a
// random USE phrase that doesn't represent pedagogical position.
// The DB cursor already has the INF PLAY substitution baked in
// (saveRoundProgress writes lastMainLoopLegoId for infplay rounds).
const cursorLegoId = computed(() => lastCompletedLegoIdRef.value)

// Belt colours for the journey-bar markers, derived from the same source
// the belt label uses. The "now" colour matches playingBelt (cursor's
// belt). The "furthest" colour is computed from the ceiling's lego id —
// lego ids encode the seed (S0042L05 → seed 42), and the seed determines
// the belt. Using the lego id directly avoids the round÷3 estimate that
// previously caused the marker to disagree with the belt label.
const cursorBeltColor = computed(() => playingBelt.value.color)
const cursorBeltIndex = computed(() => playingBelt.value.index)

const highestBeltIndex = computed(() => {
  const lego = highestCompletedLegoId.value
  if (!lego) return playingBelt.value.index
  const seed = getSeedFromLegoId(lego)
  if (seed === null) return playingBelt.value.index
  if (seed >= BELTS[BELTS.length - 1].seedsRequired) return BELTS.length - 1
  return BELTS.findIndex((_b, i) => seed < (BELTS[i + 1]?.seedsRequired ?? Infinity))
})
const highestBeltColor = computed(() => BELTS[Math.max(0, highestBeltIndex.value)].color)

// Jump the cursor forward to the ceiling. The ceiling's companion lego
// tells us which seed to load — that's our navigational hook. After the
// load, find the exact round at that lego and jump there. The cursor
// will advance on the next saveRoundProgress; we don't write here so
// that backing out (closing the app) doesn't strand them at the new spot.
const jumpToFurthest = async () => {
  const targetLegoId = highestCompletedLegoId.value
  // "Have you EVER been in INF PLAY?" — lifetime signal. Once true it
  // never goes back: per Tom (2026-05-20) "once they get to INF PLAY,
  // that's ALWAYS their furthest point." So even after a back-belt-
  // skip out, "go to furthest" still takes them to INF PLAY.
  const hasEverEnteredInfplay = infplayRoundIndex.value > 0 || currentMode.value === 'infplay'

  if (!targetLegoId && !hasEverEnteredInfplay) {
    console.warn('[LearningPlayer] jumpToFurthest: no ceiling stored and never in INF PLAY')
    return
  }

  haltAllPlayback()

  // Infinite-play branch: covers three cases now:
  //   1. Currently in INF PLAY (mode='infplay') — keep them there
  //   2. Have ever been in INF PLAY (infplayRoundIndex > 0) — their
  //      furthest point is INF PLAY even if they back-belt-skipped out
  //   3. Ceiling IS the course's final LEGO — natural "completed
  //      everything via main loop" path
  const infPlay = hasEverEnteredInfplay
    || (targetLegoId ? await hasReachedInfinitePlay(targetLegoId, courseCode.value) : false)

  // If we're navigating INTO INF PLAY but not currently in mode, flip
  // the mode flag so back-belt-skip + visible state are consistent
  // with where we just landed. Idempotent if already mode='infplay'.
  if (infPlay && currentMode.value !== 'infplay'
      && !isGuestLearner.value && progressStore?.value
      && learnerId.value && courseCode.value) {
    try {
      await progressStore.value.setMode(learnerId.value, courseCode.value, 'infplay')
      currentMode.value = 'infplay'
      if (infplayRoundIndex.value === 0) infplayRoundIndex.value = 1
    } catch (modeErr) {
      console.warn('[LearningPlayer] jumpToFurthest: setMode(infplay) failed:', modeErr)
    }
  }
  if (infPlay) {
    const mainLoopCount = await getCourseMainLoopRoundCount(courseCode.value)
    const endSeed = mainLoopCount + EXPANSION_BATCH
    console.log(`[LearningPlayer] jumpToFurthest: course complete — loading full course + ${EXPANSION_BATCH} infinite-play rounds (endSeed=${endSeed})`)
    try {
      const result = await generateScript()
      const newRounds = toSimpleRoundsWithComponents(result.items) as any[]
      if (newRounds.length > 0) {
        cachedRounds.value = newRounds
        // appendRounds dedupes by roundNumber — overlap with what's
        // already in simplePlayer is fine, only the new rounds get added.
        simplePlayer.appendRounds(newRounds)
      }
    } catch (err) {
      console.warn('[LearningPlayer] jumpToFurthest: script reload failed:', err)
    }

    const firstInfIdx = cachedRounds.value.findIndex((r: any) =>
      !r.cycles?.some((c: any) =>
        c.type === 'intro' || c.type === 'debut' || c.type === 'build'
      )
    )
    if (firstInfIdx >= 0) {
      console.log(`[LearningPlayer] jumpToFurthest: jumping to first infinite-play round (index ${firstInfIdx})`)
      simplePlayer.jumpToRound(firstInfIdx)
      if (beltProgress.value && targetLegoId) {
        // Sync belt label to the last main-loop seed (= top belt).
        const lastSeed = getSeedFromLegoId(targetLegoId)
        if (lastSeed) beltProgress.value.setPlayingPosition(lastSeed)
      }
      await persistCursorAtCurrentRound()
      return
    }
    // Fall through to the legoId-based jump if we somehow couldn't
    // find an infinite-play round to land on. Only meaningful when we
    // have a target LEGO — currentMode='infplay' without a ceiling has
    // nothing to fall back to, just bail.
    if (!targetLegoId) {
      console.warn('[LearningPlayer] jumpToFurthest: in INF PLAY but no infinite-play round found and no ceiling — aborting')
      return
    }
    console.warn('[LearningPlayer] jumpToFurthest: infinite play flagged but no infinite-play round found — falling back to ceiling LEGO')
  }

  if (!targetLegoId) {
    console.warn('[LearningPlayer] jumpToFurthest: no ceiling stored (and not in INF PLAY)')
    return
  }

  // Standard "go to your furthest LEGO" — main-loop resume.
  // Lego IDs have the form S0042L05 — seed number is digits 1..5.
  const seedMatch = targetLegoId.match(/^S(\d+)L/)
  const targetSeed = seedMatch ? parseInt(seedMatch[1], 10) : null
  if (!targetSeed) {
    console.warn('[LearningPlayer] jumpToFurthest: cannot parse seed from', targetLegoId)
    return
  }

  console.log(`[LearningPlayer] jumpToFurthest: targeting lego ${targetLegoId}, seed ${targetSeed}`)
  await loadSeedIfNeeded(targetSeed)

  // Prefer the exact lego; fall back to the start of its seed if the
  // lego id isn't present (unlikely but defensive).
  const exactIdx = simplePlayer.findRoundIndexForLegoId(targetLegoId)
  if (exactIdx >= 0) {
    simplePlayer.jumpToRound(exactIdx)
  } else {
    simplePlayer.jumpToSeed(targetSeed)
  }

  if (beltProgress.value) {
    beltProgress.value.setPlayingPosition(targetSeed)
  }

  // Cursor catches up to the ceiling — no longer "behind". Resting-state
  // choice will not re-appear until they navigate backwards again.
  await persistCursorAtCurrentRound()
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

// Whether the current cycle is part of a listening section
// (LISTEN cluster, pod lap, or their bookends). Drives the subtle
// skip-button cue in the BottomNav so learners notice that "skip" is
// their out — without making the listening feel optional by default.
const isInListeningCycle = computed(() => {
  // Runtime pod lap (new ratchet model) — current cycle is still the
  // last LEGO cycle (simplePlayer is paused), but pod audio is playing
  // separately. Surface the listening cue so skip-ahead glows.
  if (playingPodLapAudio.value) return true
  const t = simplePlayer.currentCycle.value?.type
  return t === 'listen_intro' || t === 'listening' || t === 'pod' || t === 'listen_outro'
})

defineExpose({
  isPlaying,
  isAwakening,
  togglePlayback,
  handlePause,
  handleResume,
  handleRevisit,
  handleSkip,
  isInListeningCycle,
  exitListeningMode,
  exitAllModes,
  unlockAudio,
  handleListeningMode,
  handleListeningToggle,
  handleDrivingToggle,
  handleEnterDrivingMode,
  handleExitDrivingMode,
  handlePronunciationToggle,
  exitPronunciationMode,
  beltCssVars,
  hasRomanizedText,
  isNativeScript,
  toggleScriptMode,
  toggleTurbo,
  turboActive,
  sessionSeconds,
  currentAbsoluteRound,
  highestAbsoluteRound,
  cursorBeltColor,
  highestBeltColor,
  cursorBeltIndex,
  highestBeltIndex,
  // LEGO-ID versions for the resting-state "behind ceiling" comparison.
  // PlayerRestingState prefers these over round_index because the index
  // can lag behind the LEGO position in INF PLAY.
  lastCompletedLegoId: cursorLegoId,
  highestCompletedLegoId,
  // Playback mode — drives PlayerRestingState's "suppress warning
  // entirely in INF PLAY" guard.
  currentMode,
  jumpToFurthest,
  // Welcome banner (opt-in, only on first-ever course)
  welcomeBannerVisible,
  playCourseWelcome,
  dismissCourseWelcome,
})
</script>

<template>
  <!-- Single root wrapper - required for v-show from parent to work correctly -->
  <div class="learning-player-root">

  <!-- Contribution Counter - "Part of the Solution" -->
  <ContributionCounter
    v-if="contribution.data.value && !showSessionComplete"
    :language-name="contribution.languageName.value"
    :global-minutes="contribution.todayMinutes.value"
    :user-phrases="contribution.userTodayPhrases.value"
    :is-playing="simplePlayer.isPlaying.value"
    @expand="showProgressModal = true"
  />

  <!-- Belt Skip Loading Overlay. Same overlay covers two states:
       1. belt-to-belt skip (Jumping to X belt...)
       2. INF PLAY warm-up (downloading first batch of audio so the
          random-sampled content plays smoothly from cache). The
          isWarmingUpInfPlay state nests inside isSkippingBelt in the
          handleSkipToNextBelt flow, so the existing overlay covers
          the wait without an extra surface — just different copy. -->
  <Transition name="fade">
    <!-- Suppress overlay when the INF PLAY intro is on-screen — the
         typed message IS the loading affordance; an overlay on top
         would hide it. Audio still warms up in parallel. -->
    <div v-if="(isSkippingBelt || isWarmingUpInfPlay) && !isShowingInfPlayIntro" class="belt-skip-overlay">
      <div class="belt-skip-spinner"></div>
      <span class="belt-skip-label">{{
        isWarmingUpInfPlay
          ? 'Preparing INF PLAY audio…'
          : `Jumping to ${nextBelt?.name || 'next'} belt…`
      }}</span>
    </div>
  </Transition>

  <!-- Unified Progress modal — opens from the contribution counter
       tap OR the belt-pill tap. Replaces the old split of
       ContributionExpanded + BeltProgressModal. -->
  <ProgressModal
    v-if="contribution.data.value"
    :is-open="showProgressModal"
    :data="contribution.data.value"
    :known-lang="props.course?.known_lang"
    :current-belt="playingBelt"
    :is-skipping="isSkippingBelt"
    :available-belts="beltProgress?.availableBelts?.value ?? []"
    :current-round="currentAbsoluteRound"
    :highest-round="highestAbsoluteRound"
    :current-belt-index="cursorBeltIndex"
    :highest-belt-index="highestBeltIndex"
    @close="showProgressModal = false"
    @skipToBelt="handleSkipToBelt"
  />

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

  <!-- Paywall Overlay -->
  <Transition name="fade">
    <div v-if="showPaywall" class="paywall-overlay">
      <div class="paywall-card">
        <h2 class="paywall-title">You've completed the free preview!</h2>
        <p class="paywall-subtitle">SSi Premium unlocks every paid course. Free for 7 days, £15/month from day 8. Cancel anytime.</p>
        <div class="paywall-actions">
          <button class="paywall-btn paywall-btn-primary" @click="router.push({ name: 'premium', query: { course: courseCode } })">Start 7-day free trial</button>
          <button class="paywall-btn paywall-btn-ghost" @click="emit('viewProgress')">I have an access code</button>
          <button class="paywall-btn paywall-btn-ghost" @click="showPaywall = false; simplePlayer.jumpToRound(0); simplePlayer.resume()">Keep previewing</button>
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
    :class="[`belt-${playingBelt.name}`, { 'is-paused': !isPlaying }]"
    :style="{ ...beltCssVars, '--hero-pane-bottom': heroPaneBottom + 'px' }"
    v-show="!showSessionComplete"
  >
    <!-- Deep Space Background Layers -->
    <div class="space-gradient"></div>
    <div class="space-nebula"></div>
    <div class="bg-noise"></div>

    <!-- Sumi-e background is now in PlayerContainer (global backdrop) -->

    <!-- LEGO Assembly Visualization - blocks assemble during phrase playback -->
    <LegoAssembly
      v-if="currentPhraseLegoBlocks.length > 0 && isPlaying"
      :blocks="currentPhraseLegoBlocks"
      :phase="currentPhase"
      :components="isIntroOrDebutPhase ? displayedComponents : undefined"
      :target-lang="props.course?.target_lang || courseCode?.split('_')[0]"
      :cycle-type="simplePlayer.currentCycle.value?.type"
    />


    <!-- Hero-Centric Text Labels - Floating above/below the hero node -->
    <div ref="heroTextPaneRef" class="hero-text-pane" :class="[currentPhase, { 'is-intro': isIntroPhase }]">

      <!-- Main Text Box (with integrated hint) -->
      <div class="hero-glass" :class="{ 'is-speaking': currentPhase === 'speak' && showLearningHint && !isIntroPhase }">
        <!-- Inline learning hint label -->
        <div v-if="showLearningHint && !isIntroPhase" class="hero-hint-label">
          <span class="hint-text">{{ phaseInstruction }}</span>
          <button class="hint-dismiss" @click.stop="dismissLearningHint" title="Hide hints">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

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

        <!-- NORMAL MODE: Text with optional hint above -->
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
              <p v-else-if="skipPrepVisible" class="hero-known loading-text preparing-text">
                {{ skipPrepMessage }}<span class="loading-cursor">▌</span>
              </p>
              <p v-else-if="bufferingPromptVisible" class="hero-known loading-text preparing-text">
                {{ bufferingPromptMessage }}<span class="loading-cursor">▌</span>
              </p>
              <p v-else-if="inListeningContext" class="hero-known listening-pedagogy">
                {{ passiveListeningHint }}
              </p>
              <p v-else class="hero-known">
                <template v-if="salientKnownParts">
                  <span class="hero-known-context">{{ salientKnownParts.prefix }}</span><span class="hero-known-salient">{{ salientKnownParts.match }}</span><span class="hero-known-context">{{ salientKnownParts.suffix }}</span>
                </template>
                <template v-else>{{ displayedKnownText }}</template>
              </p>
            </div>
          </div>
        </template>

      </div>

      <!-- Phase strip — a single pill divided into four segments. One
           continuous shape reads as "one cycle, four stages". Sits below
           the hero glass card. pointer-events: auto overrides the
           .hero-text-pane parent's pointer-events: none. -->
      <div v-if="showPhaseStrip" class="phase-strip" role="group" aria-label="Cycle phases">
        <button
          type="button"
          class="phase-segment phase-segment--prompt"
          :class="{ 'is-active': currentPhase === Phase.PROMPT }"
          aria-label="Replay prompt"
          @click="jumpToCyclePhase('prompt')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M3 14v-2a9 9 0 0 1 18 0v2"/>
            <rect x="2" y="13" width="5" height="8" rx="2"/>
            <rect x="17" y="13" width="5" height="8" rx="2"/>
          </svg>
        </button>
        <div
          class="phase-segment phase-segment--pause"
          :class="{ 'is-active': currentPhase === Phase.SPEAK }"
        >
          <div class="phase-segment-fill" :style="{ width: ringProgress + '%' }"></div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <rect x="9" y="3" width="6" height="12" rx="3"/>
            <path d="M5 11v1a7 7 0 0 0 14 0v-1"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="8" y1="22" x2="16" y2="22"/>
          </svg>
        </div>
        <button
          type="button"
          class="phase-segment phase-segment--voice1"
          :class="{ 'is-active': currentPhase === Phase.VOICE_1 }"
          aria-label="Skip to model voice 1"
          @click="jumpToCyclePhase('voice1')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="8" r="3.5"/>
            <path d="M5 21v-1.5a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5V21"/>
          </svg>
          <span class="phase-segment-num">1</span>
        </button>
        <button
          type="button"
          class="phase-segment phase-segment--voice2"
          :class="{ 'is-active': currentPhase === Phase.VOICE_2 }"
          aria-label="Skip to model voice 2"
          @click="jumpToCyclePhase('voice2')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="8" r="3.5"/>
            <path d="M5 21v-1.5a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5V21"/>
          </svg>
          <span class="phase-segment-num">2</span>
        </button>
      </div>

      <!-- Guest save progress button -->
      <Transition name="nudge-fade">
        <button v-if="isGuestLearner" class="guest-progress-nudge" @click="openAuth()">
          Save Progress
        </button>
      </Transition>
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
        <!-- Ink brush texture filter -->
        <defs>
          <filter id="ink-edge" x="-2%" y="-2%" width="104%" height="104%">
            <feTurbulence type="turbulence" baseFrequency="0.04" numOctaves="4" seed="3" result="noise"/>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/>
          </filter>
        </defs>

        <!-- Distant misty peaks - single dramatic summit dissolving into cloud -->
        <g opacity="0.10" filter="url(#ink-edge)">
          <path d="M0 1000 L0 420 C60 400 100 360 150 310 C180 280 200 230 230 180 C245 155 255 140 265 155 C280 180 300 240 330 300 C360 350 400 380 460 400 C520 418 580 420 640 410 C680 402 710 380 740 340 C760 310 775 270 790 230 C800 205 810 195 820 210 C835 240 850 290 880 340 C920 400 970 430 1040 440 C1100 448 1160 435 1200 420 L1200 1000Z" fill="currentColor"/>
        </g>

        <!-- Birds in the sky - simple ink brush V marks -->
        <g opacity="0.09" filter="url(#ink-edge)">
          <path d="M280 220 C285 213 290 210 295 213 C300 210 305 213 310 220" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          <path d="M320 195 C323 190 327 188 330 190 C333 188 337 190 340 195" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/>
          <path d="M850 240 C852 236 855 235 857 236 C859 235 862 236 864 240" stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round"/>
        </g>

        <!-- Far range - plateau with cliff face left, long slope right -->
        <g opacity="0.18" filter="url(#ink-edge)">
          <path d="M0 1000 L0 440 C20 435 40 420 70 390 C90 370 100 340 120 310 C135 290 145 285 155 300 C170 325 180 360 200 380 C240 415 300 430 380 435 C460 440 540 438 600 430 C650 424 690 410 720 390 C745 374 760 352 780 340 C800 330 820 335 840 350 C870 372 900 400 940 418 C980 434 1030 440 1080 438 C1130 436 1170 428 1200 415 L1200 1000Z" fill="currentColor"/>
        </g>

        <!-- Mid hills with torii gate - rolling ridgeline, no sharp peaks -->
        <g opacity="0.28" filter="url(#ink-edge)">
          <path d="M0 1000 L0 530 C50 520 90 505 130 495 C170 486 200 492 240 505 C280 518 320 520 360 510 C400 500 430 482 470 470 C510 460 545 465 580 478 C620 492 660 498 700 490 C740 482 775 468 810 462 C850 458 885 468 920 485 C960 500 1000 508 1040 500 C1080 492 1120 480 1160 485 C1185 488 1195 495 1200 500 L1200 1000Z" fill="currentColor"/>

          <!-- Torii gate - hand-drawn brush strokes -->
          <g transform="translate(420, 458)">
            <!-- Left pillar -->
            <path d="M-13 2 C-14 1 -14.5 0 -13.5 -1 L-12 -1 C-11 0 -11.5 1 -10.5 2 L-10 46 C-10 47 -10.5 48 -11.5 48 L-12.5 48 C-13.5 48 -14 47 -13.5 46 Z" fill="currentColor"/>
            <!-- Right pillar -->
            <path d="M10 2 C10.5 1 11 0 12 -1 L13 -1 C14 0 14.5 1 14 2 L13 46 C13 47 12.5 48 11.5 48 L10.5 48 C10 48 9.5 47 10 46 Z" fill="currentColor"/>
            <!-- Kasagi (top beam) -->
            <path d="M-22 -2 C-20 -5 -16 -6 -12 -4 C-4 -1 4 -1 12 -4 C16 -6 20 -5 22 -2 C21 0 18 2 12 1 C4 0 -4 0 -12 1 C-18 2 -21 0 -22 -2Z" fill="currentColor"/>
            <!-- Nuki (lower crossbeam) -->
            <path d="M-16 8 C-8 6 0 6 8 6 C12 6 16 7 16 9 C16 10.5 12 11 8 11 C0 11 -8 11 -16 10.5 C-17 10 -17 8.5 -16 8Z" fill="currentColor"/>
          </g>
        </g>

        <!-- Rolling hills with pagoda - gentle terrain, no peaks -->
        <g opacity="0.38" filter="url(#ink-edge)">
          <path d="M0 1000 L0 660 C60 645 120 628 180 618 C240 610 290 622 350 638 C410 652 460 648 520 635 C575 624 630 618 690 625 C750 632 810 645 870 648 C930 650 980 640 1040 628 C1090 618 1140 620 1200 635 L1200 1000Z" fill="currentColor"/>

          <!-- Pagoda -->
          <g transform="translate(860, 600)">
            <path d="M-9 28 C-9 27 -8 26 -7 26 L7 26 C8 26 9 27 9 28 L8 52 C8 53 7 54 6 54 L-6 54 C-7 54 -8 53 -8 52 Z" fill="currentColor"/>
            <path d="M-22 28 C-18 22 -12 20 -6 22 C-2 23 2 23 6 22 C12 20 18 22 22 28 C20 29 16 28 12 26 C6 24 -6 24 -12 26 C-16 28 -20 29 -22 28Z" fill="currentColor"/>
            <path d="M-17 16 C-14 11 -9 9 -4 11 C-1 12 1 12 4 11 C9 9 14 11 17 16 C15 17 12 16 8 14 C3 12 -3 12 -8 14 C-12 16 -15 17 -17 16Z" fill="currentColor"/>
            <path d="M-12 8 C-10 4 -6 2 -2 4 C0 5 2 4 4 3 C8 2 10 4 12 8 C10 9 7 8 4 7 C1 6 -1 6 -4 7 C-7 8 -10 9 -12 8Z" fill="currentColor"/>
            <path d="M-1 4 C-1 2 0 -4 0 -8 C0 -4 1 2 1 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
            <circle cx="0" cy="-9" r="1.5" fill="currentColor"/>
          </g>
        </g>

        <!-- Near foreground with shan shui pines - bolder, more expressive -->
        <g opacity="0.55" filter="url(#ink-edge)">
          <path d="M0 1000 L0 785 C40 772 80 755 130 742 C180 732 220 740 270 752 C320 762 370 758 420 745 C470 734 520 738 570 748 C620 756 670 758 720 750 C770 742 820 735 870 742 C920 748 970 756 1020 752 C1070 748 1120 745 1170 755 C1190 760 1200 768 1200 772 L1200 1000Z" fill="currentColor"/>

          <!-- Old pine left - dramatic shan shui: thick gnarled trunk, bold canopy -->
          <g transform="translate(120, 700)">
            <!-- Thick trunk with character - S-curve, knots -->
            <path d="M3 55 C2 48 -2 40 -3 32 C-4 24 0 16 -2 8 C-3 2 1 -5 0 -12" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/>
            <!-- Exposed root at base -->
            <path d="M3 55 C8 58 14 56 18 52" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/>
            <path d="M3 55 C-4 58 -10 55 -12 50" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
            <!-- Bold foliage masses - layered ink-wash clouds -->
            <ellipse cx="-14" cy="-8" rx="14" ry="8" fill="currentColor" opacity="0.7"/>
            <ellipse cx="6" cy="-16" rx="16" ry="9" fill="currentColor" opacity="0.8"/>
            <ellipse cx="-8" cy="-22" rx="12" ry="7" fill="currentColor" opacity="0.6"/>
            <ellipse cx="14" cy="-6" rx="10" ry="6" fill="currentColor" opacity="0.5"/>
            <!-- Individual branch gestures -->
            <path d="M-2 8 C-10 4 -20 -2 -26 -6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>
            <path d="M-1 2 C8 -4 18 -8 24 -6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          </g>

          <!-- Companion pine - smaller, leaning toward main tree -->
          <g transform="translate(165, 718)">
            <path d="M1 35 C0 28 -3 20 -2 12 C-1 6 2 1 1 -5" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/>
            <ellipse cx="-6" cy="-4" rx="10" ry="6" fill="currentColor" opacity="0.7"/>
            <ellipse cx="5" cy="-10" rx="9" ry="5" fill="currentColor" opacity="0.6"/>
            <path d="M1 12 C-5 9 -12 5 -15 2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          </g>

          <!-- Grand pine right - tallest, windswept crown -->
          <g transform="translate(690, 690)">
            <path d="M0 62 C-2 52 2 40 0 28 C-2 18 1 8 -1 -8" stroke="currentColor" stroke-width="4.5" fill="none" stroke-linecap="round"/>
            <!-- Roots -->
            <path d="M0 62 C6 66 14 64 18 58" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/>
            <path d="M0 62 C-5 65 -12 62 -14 56" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
            <!-- Large windswept canopy - swept right by prevailing wind -->
            <ellipse cx="12" cy="-12" rx="18" ry="10" fill="currentColor" opacity="0.8"/>
            <ellipse cx="-4" cy="-20" rx="14" ry="8" fill="currentColor" opacity="0.7"/>
            <ellipse cx="20" cy="-4" rx="12" ry="7" fill="currentColor" opacity="0.5"/>
            <ellipse cx="4" cy="-28" rx="11" ry="6" fill="currentColor" opacity="0.6"/>
            <!-- Dramatic branch reaching out -->
            <path d="M-1 18 C-10 12 -22 6 -28 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
            <ellipse cx="-28" cy="-2" rx="8" ry="5" fill="currentColor" opacity="0.5"/>
            <path d="M0 8 C10 2 22 -4 30 -2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>
          </g>

          <!-- Small windswept pine - distant, minimal -->
          <g transform="translate(1040, 732)">
            <path d="M0 26 C-1 20 0 13 0 6 C0 2 1 -1 0 -4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
            <ellipse cx="4" cy="-4" rx="8" ry="5" fill="currentColor" opacity="0.6"/>
            <ellipse cx="-3" cy="-8" rx="6" ry="4" fill="currentColor" opacity="0.5"/>
          </g>

          <!-- Small bridge -->
          <g transform="translate(480, 745)" opacity="0.8">
            <path d="M-18 2 C-12 -4 -4 -6 0 -6 C4 -6 12 -4 18 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
            <path d="M-14 2 L-14 -2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M14 2 L14 -2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M-14 -2 C-8 -7 8 -7 14 -2" stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round"/>
          </g>
        </g>

        <!-- Closest foreground ridge - bold brush stroke -->
        <g opacity="0.7" filter="url(#ink-edge)">
          <path d="M0 1000 L0 888 C40 872 75 858 120 850 C165 844 200 855 250 868 C300 878 345 872 390 858 C430 848 470 845 520 855 C570 862 610 868 660 860 C705 852 750 848 800 858 C845 868 890 872 940 862 C985 854 1025 850 1070 860 C1115 870 1155 878 1200 885 L1200 1000Z" fill="currentColor"/>

          <!-- Lone fisherman in small boat -->
          <g transform="translate(950, 852)" opacity="0.8">
            <!-- Boat hull - simple brush curve -->
            <path d="M-12 2 C-8 5 8 5 12 2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>
            <!-- Figure - minimal brush marks -->
            <path d="M2 2 C2 -2 1 -6 1 -8" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
            <!-- Fishing rod -->
            <path d="M1 -7 C4 -10 8 -12 13 -10" stroke="currentColor" stroke-width="0.8" fill="none" stroke-linecap="round"/>
          </g>
        </g>
      </svg>
    </div>

    <!-- Class Context Bar (when launched from Schools) -->
    <button v-if="props.classContext" class="class-bar" @click="emit('close')">
      <svg class="class-bar-back" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      <span class="class-bar-name">{{ props.classContext.name }}</span>
      <span class="class-bar-label">Back to classes</span>
    </button>

    <!-- Header - Logo with belt underneath, centered -->
    <!-- Header - brand row + belt row -->
    <header class="header" :class="{ 'has-banner': props.classContext }">
      <div class="header-stack">
        <!-- Brand -->
        <div class="brand"><span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span><span v-if="envLabel" class="env-label" :class="`env-label--${envLabel.toLowerCase()}`">{{ envLabel }}</span><button v-if="pwaUpdateAvailable && pwaUserDismissed" class="update-dot" title="Tap to update" aria-label="New version available — tap to update" @click.stop="pwaApplyUpdate?.()"></button></div>

        <!-- Belt row: skip back + timer + skip forward -->
        <div class="belt-row">
          <button
            class="belt-header-skip belt-header-skip--back"
            :class="{ 'is-skipping': isSkippingBelt, 'is-loading-target': prevBeltLoading }"
            @click="handleGoBackBelt"
            :disabled="playingBelt.index === 0"
            :title="`Back to ${backTargetBelt.name} belt`"
            :aria-label="`Back to ${backTargetBelt.name} belt`"
            :style="{ '--skip-belt-color': backTargetBelt.color }"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">
              <polyline points="11 17 6 12 11 7"/>
              <polyline points="18 17 13 12 18 7"/>
            </svg>
          </button>

          <button
            class="belt-timer-unified"
            :title="!nextBelt ? `${currentBelt.name[0].toUpperCase() + currentBelt.name.slice(1)} belt achieved!` : `${Math.round(beltProgressPercent)}% to ${nextBelt.name} belt`"
            :aria-label="!nextBelt ? `${currentBelt.name[0].toUpperCase() + currentBelt.name.slice(1)} belt achieved` : `${Math.round(beltProgressPercent)} percent to ${nextBelt.name} belt. Session time ${formattedSessionTime}`"
            @click="handleBeltPillTap"
          >
            <div class="belt-bar-track" aria-hidden="true">
              <div class="belt-bar-fill" :style="{ width: `${beltProgressPercent}%` }"></div>
            </div>
            <span class="belt-timer-label">{{ formattedSessionTime }}</span>
          </button>

          <!-- Forward action: belt-skip chevron in normal mode, morphs
               into a labelled "∞ INF PLAY" pill when forward-skip would
               land the learner in INF PLAY (course end, no further
               belts ahead). Same slot — the layout doesn't shift, but
               the affordance is unambiguous about what's about to
               happen. Tom called the morph "the skip belt button
               BECOMES IP button". -->
          <!-- Forward action: belt-skip chevron in normal main-loop
               states; infinity symbol when forward-skip would land in
               INF PLAY. Two distinct visual states for the infinity:
                 - eligible (would-enter, not currently in)  → throbs,
                   calling the learner to make a choice
                 - activated (currentMode === 'infplay')     → steady,
                   confident "you're here" state
               Same 36×36 slot as the chevron in both cases — no layout
               shift, the visual state carries the meaning. -->
          <button
            class="belt-header-skip belt-header-skip--forward"
            :class="{
              'is-skipping': isSkippingBelt,
              'is-loading-target': nextBeltLoading,
              'is-infplay-eligible': wouldEnterInfplay && currentMode !== 'infplay',
              'is-infplay-active': currentMode === 'infplay',
            }"
            @click="handleSkipToNextBelt"
            :title="currentMode === 'infplay'
              ? `In INF PLAY (round ${infplayRoundIndex})`
              : (wouldEnterInfplay
                  ? 'Enter INF PLAY — random review of everything you have learned'
                  : `Skip to ${playingNextBelt?.name ?? 'next'} belt`)"
            :aria-label="currentMode === 'infplay'
              ? `Infinite play, round ${infplayRoundIndex}`
              : (wouldEnterInfplay
                  ? 'Enter INF PLAY: random review of everything you have learned'
                  : `Skip to ${playingNextBelt?.name ?? 'next'} belt`)"
            :style="playingNextBelt && !wouldEnterInfplay
              ? { '--skip-belt-color': playingNextBelt.color, '--skip-belt-glow': playingNextBelt.glow }
              : {}"
          >
            <svg v-if="wouldEnterInfplay"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 :stroke-width="currentMode === 'infplay' ? 2.4 : 2"
                 stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true" focusable="false">
              <path d="M5.5 12 C5.5 9 7 7 9.5 7 C12 7 13.5 9 14.5 12 C15.5 15 17 17 18.5 17 C20 17 21.5 15 21.5 12 C21.5 9 20 7 18.5 7 C17 7 15.5 9 14.5 12 C13.5 15 12 17 9.5 17 C7 17 5.5 15 5.5 12 Z"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 aria-hidden="true" focusable="false">
              <polyline points="13 17 18 12 13 7"/>
              <polyline points="6 17 11 12 6 7"/>
            </svg>
          </button>
        </div>
      </div>
    </header>

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
        :up-to-seed="listeningCeilingSeed"
        @close="handleCloseListening"
      />
    </Transition>

    <!-- Pronunciation Mode Overlay -->
    <Transition name="listening-overlay">
      <PronunciationOverlay
        v-if="showPronunciationOverlay"
        :course-code="activeCourseCode"
        :belt-color="currentBelt.color"
        :up-to-seed="beltProgress?.playingSeedNumber?.value ?? null"
        :target-lang="props.course?.target_lang || courseCode?.split('_')[0]"
        @close="handleClosePronunciation"
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
          <div class="progress-warning-actions">
            <button class="progress-warning-btn progress-warning-btn--primary" @click="openAuth()">
              Sign in to save
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
    <section
      class="control-pane"
      :class="[currentPhase, `layout-${layoutMode}`, { 'is-paused': !isPlaying }]"
      role="region"
      aria-label="Learning player"
    >
      <!-- Screen-reader announcer for play/pause state. VoiceOver / TalkBack
           pick up changes to this region without disturbing sighted UI. -->
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {{ isPlaying ? 'Playing' : 'Paused' }}
      </div>

      <!-- Ink Spirit Rewards - Float upward from the text area -->
      <TransitionGroup name="ink-spirit" tag="div" class="ink-spirit-container" aria-hidden="true">
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
        <!-- Known Language Text - always visible, stable position.
             NOT marked aria-live: for a learning app we don't want the
             screen reader vocalizing prompts every cycle, as it would
             conflict with the pronunciation audio that is the actual
             lesson. AT users can navigate to this region manually. -->
        <div class="pane-text-known">
          <p v-if="isShowingInfPlayIntro" class="known-text loading-text infplay-intro-text">
            {{ infPlayIntroMessage }}<span class="loading-cursor" aria-hidden="true">▌</span>
          </p>
          <p v-else-if="isAwakening" class="known-text loading-text">
            {{ currentLoadingMessage }}<span class="loading-cursor" aria-hidden="true">▌</span>
          </p>
          <p v-else-if="isPreparingToPlay" class="known-text loading-text preparing-text">
            {{ preparingMessage }}<span class="loading-cursor" aria-hidden="true">▌</span>
          </p>
          <p v-else-if="isListeningCycle" class="known-text listening-label">
            {{ displayedKnownText }}
            <span class="listening-speed-badge" aria-label="Playback speed">{{ listeningPlaybackSpeed === 1.0 ? '1x' : '2x' }}</span>
          </p>
          <p v-else class="known-text">
            <template v-if="salientKnownParts">
              <span class="hero-known-context">{{ salientKnownParts.prefix }}</span><span class="hero-known-salient">{{ salientKnownParts.match }}</span><span class="hero-known-context">{{ salientKnownParts.suffix }}</span>
            </template>
            <template v-else>{{ displayedKnownText }}</template>
          </p>
        </div>

        <!-- Guest progress warning -->
        <div v-if="isGuestLearner" class="guest-progress-nudge" :class="{ expanded: !isPlaying }" @click="openAuth()">
          <svg class="nudge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span class="nudge-text">Your progress is fragile — <strong>sign in</strong> to save it</span>
        </div>

        <!-- Visual separator -->
        <div class="pane-text-divider"></div>

        <!-- Target text removed — duplicated by LEGO tiles below -->

        <!-- Component tiles now rendered inside LegoAssembly -->
      </div>

      <!-- Audio failure banner. Two halt cases:
           - 'needs-gesture': iOS revoked the audio unlock; tap the player
             to resume from the same cycle (the surrounding control pane
             handles the tap).
           - 'play-error': audio load/play failed twice in a row (likely
             blob-URL race or transient network). Same affordance — a
             tap-to-retry chip wired to togglePlayback so resume() re-
             attempts the current cycle from the prompt phase. -->
      <button
        v-if="audioFailedBanner"
        type="button"
        class="audio-failed-banner"
        :class="{ 'audio-failed-banner--play-error': audioFailedBanner.reason === 'play-error' }"
        role="status"
        aria-live="polite"
        @click.stop="togglePlayback"
      >
        {{ audioFailedBanner.reason === 'play-error'
          ? "Audio didn't load — tap to retry"
          : "Paused — tap play to continue" }}
      </button>

      <!-- Play button when paused. The surrounding element handles the tap;
           this is a visual hint. The "Playing / Paused" sr-only announcer
           above conveys state to assistive tech. -->
      <div
        v-if="!isPlaying && !isPlayingWelcome"
        class="pane-play-hint"
        :class="{ 'initial-start': !hasEverStarted }"
        :aria-label="hasEverStarted ? 'Paused — tap player to resume' : 'Tap player to start'"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          <polygon points="6 3 20 12 6 21 6 3"/>
        </svg>
        <span v-if="!hasEverStarted" class="start-label">Tap to start</span>
      </div>
    </section>

    <!-- Layout toggle removed - dark mode constellation is the only mode -->

    <!-- Hidden ring container for position reference (used by network centering) -->
    <div ref="ringContainerRef" class="ring-reference" style="display: none;"></div>

    <!-- Mode Discovery Tip (between rounds) -->
    <Transition name="tip-fade">
      <div v-if="modeTip" class="mode-tip" @click="openSettingsFromTip">
        <div class="mode-tip__body">
          <span class="mode-tip__label">{{ modeTip.label }}</span>
          <span class="mode-tip__desc">{{ modeTip.desc }}</span>
        </div>
        <button class="mode-tip__dismiss" @click.stop="dismissModeTip">&times;</button>
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

    <!-- Control Bar - REMOVED: transport controls now live in BottomNav pill -->

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

  <!-- Mode buttons moved to BottomNav for Android viewport sync -->
  <Transition name="fade">
    <div v-if="isPlaying && activeCourseCode && !isDrivingModeActive && !showDrivingExplainer" class="course-identity" :style="beltCssVars">
      <LanguageFlag :code="courseTargetLang" :size="32" class="course-identity-flag" />
      <span class="course-identity-name">{{ courseDisplayName }}</span>
    </div>
  </Transition>

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

/* Paywall Overlay */
.paywall-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.paywall-card {
  max-width: 360px;
  margin: 0 1.5rem;
  padding: 2rem 1.5rem;
  background: var(--bg-primary, #1a1a2e);
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  border-radius: 20px;
  text-align: center;
}

.paywall-title {
  font-family: var(--font-heading, var(--font-body));
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary, #f5f5f5);
  margin: 0 0 0.75rem;
}

.paywall-subtitle {
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  margin: 0 0 1.5rem;
  line-height: 1.5;
}

.paywall-actions {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.paywall-btn {
  padding: 0.75rem 1.5rem;
  border-radius: 12px;
  font-family: var(--font-body);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.paywall-btn-primary {
  background: var(--accent, #c23a3a);
  color: white;
}

.paywall-btn-primary:hover {
  filter: brightness(1.1);
}

.paywall-btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #f5f5f5);
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
}

.paywall-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.12);
}

.paywall-btn-ghost {
  background: none;
  color: var(--text-muted, rgba(255, 255, 255, 0.45));
  font-size: 0.8125rem;
  font-weight: 500;
}

.paywall-btn-ghost:hover {
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
}

/* Root wrapper - enables v-show to work correctly from parent component */
/* When parent uses v-show="currentScreen === 'player'", this div receives display:none */
/* which properly hides all fixed-position children (space-gradient, overlays, etc.) */
.learning-player-root {
  /* Fill viewport so fixed children display correctly when visible */
  position: fixed;
  inset: 0;
  overflow: hidden;
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
  --header-height: 72px;
  --header-total: calc(var(--header-height) + var(--safe-area-top));
  --nav-height: 80px;
  --nav-total: calc(var(--nav-height) + var(--safe-area-bottom));
  --control-bar-bottom: var(--nav-total);
  --hero-offset: 24px;
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
/* Belt color expressed as soft atmospheric wash over the deep space background */
.nebula-glow {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  /* Multi-layer belt-colored atmosphere:
     1. Bottom edge glow (under transport controls)
     2. Central radial wash (warm ambient light)
     3. Top-corner accent (balances the composition) */
  background:
    linear-gradient(
      to top,
      color-mix(in srgb, var(--belt-glow, rgba(194, 58, 58, 0.06)) 60%, transparent) 0%,
      transparent 18%
    ),
    radial-gradient(
      ellipse 120% 50% at 50% 75%,
      color-mix(in srgb, var(--belt-glow, rgba(194, 58, 58, 0.05)) 40%, transparent) 0%,
      transparent 50%
    ),
    radial-gradient(
      ellipse 60% 40% at 20% 15%,
      color-mix(in srgb, var(--belt-glow, rgba(194, 58, 58, 0.03)) 30%, transparent) 0%,
      transparent 50%
    );
  opacity: 0.7;
  transition: background 1s ease, opacity 0.5s ease;
}

/* Slightly brighter during intro/debut */
.player:has(.hero-text-pane.is-intro) .nebula-glow {
  opacity: 0.9;
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


/* ============ CLASS BAR (Schools context — teacher navigation) ============ */
.class-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(20, 20, 32, 0.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(194, 58, 58, 0.2);
  cursor: pointer;
  transition: background 0.2s ease;
  border: none;
  width: 100%;
  text-align: left;
}

.class-bar:hover {
  background: rgba(30, 30, 45, 0.95);
}

.class-bar-back {
  color: var(--ssi-red, #c23a3a);
  flex-shrink: 0;
}

.class-bar-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: #ffffff;
}

.class-bar-label {
  margin-left: auto;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

/* ============ HEADER ============ */
.header {
  position: relative;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(var(--space-sm) + var(--safe-area-top)) var(--space-lg) 0;
  pointer-events: auto;
  min-height: var(--header-height);
}

.header.has-banner {
  padding-top: 2.25rem;
}

/* Header stack - logo on top, belt underneath */
.header-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  max-width: 400px;
}

/* Brand — logo text */
.brand {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 1.5rem;
  letter-spacing: -0.02em;
  white-space: nowrap;
  flex-shrink: 0;
}

.logo-say, .logo-in { color: var(--accent); }
.logo-something { color: var(--text-primary); }

/* Inline environment label shown next to the logo on non-production
   hostnames so Aran / anyone can tell at a glance which deploy they're
   looking at. Lives inside .brand so it shares the row — no layout
   shift on production where it's hidden. */
.env-label {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.55em;
  font-weight: 700;
  letter-spacing: 0.1em;
  vertical-align: middle;
  line-height: 1;
}
.env-label--staging {
  background: #ffb800;
  color: #0a0a0a;
}
.env-label--dev {
  background: #ff5a5f;
  color: #fff;
}

.update-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #007AFF;
  margin-left: 4px;
  vertical-align: super;
  cursor: pointer;
  animation: pulse-dot 2s ease-in-out infinite;
  font: inherit;
  color: inherit;
}
.update-dot:focus-visible {
  outline: 2px solid #007AFF;
  outline-offset: 2px;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.session-timer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'Space Mono', monospace;
  font-size: 0.875rem;
  color: var(--text-secondary);
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  border-radius: 100px;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
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

/* ============ BELT ROW ============ */
.belt-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--belt-row-gap);
  width: 100%;
  padding: 0 var(--space-sm);
}

/* Belt skip buttons */
.belt-header-skip {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.06);
  color: var(--skip-belt-color, var(--text-muted));
  opacity: 0.7;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.belt-header-skip svg {
  width: 18px;
  height: 18px;
}

.belt-header-skip:hover:not(:disabled) {
  opacity: 1;
  transform: scale(1.1);
  background: rgba(255, 255, 255, 0.10);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3),
              0 0 12px color-mix(in srgb, var(--skip-belt-color, var(--belt-glow)) 20%, transparent);
}

.belt-header-skip:disabled {
  opacity: 0.25;
  cursor: not-allowed;
  box-shadow: none;
}

.belt-header-skip.is-skipping {
  animation: belt-skip-flash 0.6s ease-in-out infinite;
  pointer-events: none;
  opacity: 1;
}

.belt-header-skip.is-loading-target:not(.is-skipping) {
  animation: belt-skip-pulse 1.5s ease-in-out infinite;
  opacity: 0.5;
}

/* INF PLAY forward-button — two distinct visual states sharing the
 * 36×36 chevron slot.
 *
 *   is-infplay-eligible  →  outline purple, throbs to call the eye.
 *                           "Tap here to enter INF PLAY."
 *   is-infplay-active    →  filled purple gradient, steady, brighter
 *                           glow. "You're in INF PLAY."
 *
 * The infinity glyph stays the same; what differs is whether the
 * button is solid (active) or outlined-and-throbbing (eligible).
 */
.belt-header-skip.is-infplay-eligible {
  opacity: 1;
  color: #c4b5fd;
  border-color: rgba(167, 139, 250, 0.7);
  background: rgba(124, 58, 237, 0.10);
  animation: belt-infplay-throb 1.8s ease-in-out infinite;
}
.belt-header-skip.is-infplay-eligible:hover:not(:disabled) {
  opacity: 1;
  transform: scale(1.08);
  color: #ddd6fe;
  background: rgba(124, 58, 237, 0.18);
}

.belt-header-skip.is-infplay-active {
  opacity: 1;
  color: #ffffff;
  border-color: rgba(167, 139, 250, 0.55);
  background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2),
              0 0 14px rgba(167, 139, 250, 0.5);
}
.belt-header-skip.is-infplay-active:hover:not(:disabled) {
  opacity: 1;
  transform: scale(1.06);
  background: linear-gradient(135deg, #8b4ff5 0%, #b69cfb 100%);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3),
              0 0 18px rgba(167, 139, 250, 0.65);
}

@keyframes belt-infplay-throb {
  0%, 100% {
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2),
                0 0 4px rgba(167, 139, 250, 0.25);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25),
                0 0 14px rgba(167, 139, 250, 0.55);
    transform: scale(1.06);
  }
}

@keyframes belt-skip-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.2; }
}

/* Mode nav buttons moved to BottomNav.vue */

/* Course identity — fixed above bottom nav, only during playback */
.course-identity {
  position: fixed;
  bottom: max(calc(env(safe-area-inset-bottom, 0px) / 2 + 82px), 94px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  z-index: 25;
  pointer-events: none;
}
.course-identity-flag { line-height: 1; }
.course-identity-name {
  font-family: var(--font-body);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

/* ============ BELT TIMER ============ */
.belt-timer-unified {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 6px 12px 6px 16px;
  background: color-mix(in srgb, var(--belt-color) 70%, rgba(0,0,0,0.3));
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-radius: 20px;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  flex: 1;
  min-width: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.belt-timer-unified:active {
  transform: scale(0.98);
}

.belt-timer-unified .belt-bar-track {
  flex: 1;
  min-width: var(--belt-bar-width);
  height: var(--belt-bar-height);
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  overflow: hidden;
}

.belt-timer-unified .belt-bar-fill {
  height: 100%;
  background: #1a1a1a;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  min-width: 2px;
}

.belt-timer-label {
  font-family: 'Space Mono', monospace;
  font-size: clamp(0.75rem, 2vw, 0.875rem);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  white-space: nowrap;
  flex-shrink: 0;
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
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
}

.layout-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.35);
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
  border: 1.5px solid rgba(255, 255, 255, 0.35);
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

/* Audio-failure banner. Default styling = needs-gesture (blue, neutral
   "tap to resume"). The --play-error modifier shifts to amber so a
   genuine failure reads as different from the routine iOS unlock prompt
   without escalating to red — it's recoverable, not broken. */
.audio-failed-banner {
  display: block;
  padding: 0.5rem 1rem;
  margin: 0.5rem auto;
  max-width: 28rem;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 999px;
  color: var(--text-primary);
  font-size: 0.9rem;
  text-align: center;
  cursor: pointer;
  font-family: inherit;
  line-height: 1.3;
}

.audio-failed-banner:hover {
  background: rgba(59, 130, 246, 0.18);
}

.audio-failed-banner--play-error {
  background: rgba(245, 158, 11, 0.14);
  border-color: rgba(245, 158, 11, 0.5);
}

.audio-failed-banner--play-error:hover {
  background: rgba(245, 158, 11, 0.22);
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

/* Guest progress nudge - positioned between hero glass and LEGO tiles */
.guest-progress-nudge {
  margin-top: var(--hero-offset);
  padding: 0.625rem 1.5rem;
  background: #1a3a5c;
  color: #ffffff;
  border: none;
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.2s ease;
}

.guest-progress-nudge:active {
  background: #0f2a45;
  transform: scale(0.97);
}

/* Nudge fade transition */
.nudge-fade-enter-active,
.nudge-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.nudge-fade-enter-from,
.nudge-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
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
  background: rgba(255, 255, 255, 0.06);
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
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

/* ============ HERO-CENTRIC TEXT PANE ============ */
/* Text labels floating above/below the hero node with glass effect */
.hero-text-pane {
  position: absolute;
  top: var(--hero-top);
  left: 50%;
  transform: translate(-50%, 0);
  z-index: 10;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
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
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.4),
    0 8px 24px rgba(0, 0, 0, 0.3),
    0 0 0 1px color-mix(in srgb, var(--belt-glow, rgba(194, 58, 58, 0.15)) 40%, transparent);
  /* Fill parent width - parent handles max-width */
  width: 100%;
  overflow: hidden;
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
  overflow-wrap: break-word;
  word-break: break-word;
  max-width: 100%;
}

/* Inline emphasis on the substring matching the current cycle's salient
   LEGO's known text. Couples to the salient tile below — same weight-
   bump + context-fade treatment so the learner sees "this English bit
   = this target tile" without the red wash that broke long phrases.
   Tom 2026-05-21. */
.hero-known-salient {
  font-weight: 600;
}
.hero-known-context {
  /* Tom 2026-05-22: 0.72 was still too sharp on the known side — most of
   * the known text is context, and the salient match is usually a couple
   * of words. Softer fade keeps the bump perceptible without making the
   * surrounding English read as dimmed. Target side stays unchanged. */
  opacity: 0.85;
}

/* Listening pedagogy — calmer, italic, slightly smaller. The learner is
 * meant to be passive here; the text is a nudge, not a prompt. */
.hero-known.listening-pedagogy {
  font-style: italic;
  opacity: 0.85;
  font-size: calc(var(--known-text-size) * 0.92);
  letter-spacing: 0.005em;
}

.hero-target {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: var(--target-text-size);
  font-weight: 500;
  color: var(--belt-color, #c23a3a);
  margin: 0;
  line-height: 1.5;
  letter-spacing: 0.01em;
  text-shadow: 0 0 24px var(--belt-glow, rgba(194, 58, 58, 0.5)),
               0 0 8px var(--belt-glow, rgba(194, 58, 58, 0.2));
  overflow-wrap: break-word;
  word-break: break-word;
  max-width: 100%;
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

/* ============ INLINE HINT LABEL (inside hero-glass) ============ */
.hero-hint-label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  position: relative;
  pointer-events: auto;
}

.hint-text {
  font-family: var(--font-body);
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: center;
}

.hint-dismiss {
  position: absolute;
  top: -2px;
  right: -4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0.4;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.hint-dismiss:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.15);
}

.hint-dismiss svg {
  width: 12px;
  height: 12px;
  color: rgba(255, 255, 255, 0.8);
}

/* Speaking state — subtle glow on the hero-glass itself */
.hero-glass.is-speaking {
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.4),
    0 8px 24px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(220, 38, 38, 0.35),
    0 0 24px rgba(220, 38, 38, 0.15);
}

.hero-glass.is-speaking .hint-text {
  color: rgba(220, 38, 38, 0.8);
  font-weight: 600;
}

/* Phase strip — a single rounded pill divided into four segments, reading
 * left-to-right as the cycle's journey. The outer pill anchors the visual
 * "this is one cycle"; internal dividers separate stages.
 *
 *   ┌────┬─────────────────────┬──────┬──────┐
 *   │ 🎧 │  🎤  ▓▓▓░░░░░░░░░  │ 👤 1 │ 👤 2 │
 *   └────┴─────────────────────┴──────┴──────┘
 *
 * pointer-events: auto here overrides the parent .hero-text-pane's
 * pointer-events: none — otherwise the buttons inherit pass-through
 * and clicks never reach them.
 */
.phase-strip {
  display: flex;
  align-items: stretch;
  height: 40px;
  width: 100%;
  max-width: 340px;
  margin: var(--space-md) auto 0;
  /* iOS-character white pill — matches .hero-glass and .component-tile
   * mist treatment so the phase strip reads as part of the same family
   * of white-card components on the page. */
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  border-radius: 999px;
  box-shadow:
    0 2px 4px rgba(44, 38, 34, 0.10),
    0 6px 16px rgba(44, 38, 34, 0.06);
  overflow: hidden;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
}

.phase-segment {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  /* Explicit percentage widths: pause is 40% to give the countdown enough
   * length to read as a timer; the other three are 20% each. Total = 100%
   * of the pill interior, so segments butt up exactly with no leftover
   * margin to leak as visible gaps. */
  flex: 0 0 20%;
  min-width: 0;
  padding: 0;
  border: 0;
  margin: 0;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
  color: rgba(0, 0, 0, 0.55);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
  isolation: isolate;
  transition: background 0.2s ease, color 0.2s ease;
}

.phase-segment--pause {
  flex: 0 0 40%;
}

button.phase-segment {
  cursor: pointer;
}

/* Thin 1px vertical dividers between phases — same visual language as the
 * LEGO component tiles. Implemented as an absolutely-positioned ::before
 * so it doesn't add to the segment's box-width and break the 20/40/20/20
 * layout. Inset from top/bottom so it reads as a tick mark, not a wall. */
.phase-segment + .phase-segment::before {
  content: '';
  position: absolute;
  left: 0;
  top: 25%;
  bottom: 25%;
  width: 1px;
  background: rgba(0, 0, 0, 0.12);
  z-index: 2;
  pointer-events: none;
}

.phase-segment svg {
  width: 18px;
  height: 18px;
  display: block;
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
}

.phase-segment-num {
  position: relative;
  z-index: 1;
  font-size: 11px;
  font-weight: 700;
  opacity: 0.7;
}

/* Hover-only styles — guarded so iOS touch devices don't get stuck in
 * `:hover` after a tap (the classic "pink voice1 button" sticky state). */
@media (hover: hover) {
  button.phase-segment:hover:not(.is-active) {
    background: var(--accent-soft);
    color: var(--ssi-red);
  }
}

button.phase-segment:active:not(.is-active) {
  background: color-mix(in srgb, var(--ssi-red) 18%, transparent);
}

.phase-segment.is-active {
  background: var(--ssi-red);
  color: #fff;
}

.phase-segment.is-active .phase-segment-num {
  opacity: 0.9;
}

/* Active pause keeps its bg transparent — otherwise the section bg and
 * the growing fill are both --ssi-red and the countdown is invisible.
 * The fill IS the only red; icon stays dark for readability. */
.phase-segment--pause.is-active {
  background: transparent;
  color: rgba(0, 0, 0, 0.7);
}

/* Active pause MUST override the red bg — otherwise the section bg and
 * the growing fill are both --ssi-red and the countdown is invisible.
 * Keep the section bg transparent so the fill IS the only red, and dim
 * the icon to dark for readability over the white→red sweep. */
.phase-segment--pause.is-active {
  background: transparent;
  color: rgba(0, 0, 0, 0.7);
}

/* Pause countdown — single red. The fill is the entire active-state visual:
 * starts at 0% anchored to the section's left edge, grows to 100% as the
 * pause progresses. Anchored explicitly with left/top/bottom (no `right`,
 * no `inset` shorthand) so width is unambiguously a left-anchored grow.
 * When fill = 100% the section is fully red and butts cleanly against
 * the adjacent voice1 segment. No separate active-state background — the
 * unfilled portion is just the pill's white bg, same as inactive
 * segments. No darker red. */
.phase-segment--pause .phase-segment-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0%;
  background: var(--ssi-red);
  /* No width transition. ringProgress updates via requestAnimationFrame
   * at ~60fps which is already smooth enough during the SPEAK phase. The
   * old `transition: width 0.1s linear` made the bar slide backwards
   * when the phase ended (width snapping 100→0 was animated). Snap to
   * zero instead so the segment just clears. */
  pointer-events: none;
  z-index: 0;
}

/* ============ PHASE STRIP (legacy section helpers — .phase-section,
 * NOT .phase-strip; kept because some other code may still reference
 * .phase-section). The duplicate .phase-strip rule that lived here was
 * deleted: it was applying `gap: 6px` to the new segmented pill,
 * forcing visible whitespace between every segment. */
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

/* Legacy responsive .phase-section sizing (NOT .phase-strip — that
 * duplicate rule was deleted; it was overriding the new segmented pill
 * with `gap: clamp(...)` and reintroducing visible whitespace). */
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
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  border-radius: 20px;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  z-index: 25;
  /* Subtle belt glow */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4),
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

.known-text.listening-label {
  opacity: 0.7;
}

.listening-speed-badge {
  display: inline-block;
  font-size: 0.7em;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.15);
  color: var(--text-secondary, #aaa);
  padding: 0.1em 0.4em;
  border-radius: 4px;
  margin-left: 0.5em;
  vertical-align: middle;
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

/* INF PLAY first-entry intro. Same monospace + typewriter cursor as
 * the other loading-text branches, but preserves paragraph breaks
 * (the message is multi-paragraph) and shrinks the font-size so the
 * whole body fits in the dialog box without scrolling. */
.infplay-intro-text {
  white-space: pre-line;
  font-size: 0.85em;
  line-height: 1.5;
  text-align: left;
  max-width: 64ch;
  margin-inline: auto;
  padding: 0.25em 0.5em;
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
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.welcome-skip:hover {
  background: var(--bg-card);
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
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border-radius: var(--control-bar-radius);
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  /* Belt glow accent */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4),
              0 8px 24px rgba(0, 0, 0, 0.3),
              0 0 16px color-mix(in srgb, var(--belt-glow) 12%, transparent);
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
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.06);
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
  background: rgba(255, 255, 255, 0.12);
  color: var(--text-primary);
  transform: scale(1.05);
  border-color: rgba(255, 255, 255, 0.35);
  box-shadow: 0 0 12px color-mix(in srgb, var(--belt-glow) 15%, transparent);
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

/* Mode Explanation Popups */
.mode-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  padding: 1.5rem;
}

.mode-popup {
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1.5px solid rgba(0, 0, 0, 0.25);
  border-radius: 1rem;
  padding: 1.5rem;
  max-width: 320px;
  width: 100%;
  text-align: center;
  color: #2C2622;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
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
  background: rgba(44, 38, 34, 0.08);
  color: #2C2622;
}

.mode-popup-hint {
  font-size: 0.8125rem;
  color: #6B6560;
  margin: -0.5rem 0 1.25rem;
  font-style: italic;
}

.mode-popup-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #2C2622;
  margin: 0 0 0.75rem;
}

.mode-popup-desc {
  font-size: 0.9375rem;
  color: #4A4440;
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
  background: #f0ece8;
  color: #4A4440;
}

.mode-popup-btn--cancel:hover {
  background: #e5e0db;
  color: #2C2622;
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
  border: 1.5px solid;
  background: rgba(255, 255, 255, 0.06);
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
  background: rgba(255, 255, 255, 0.12);
  transform: scale(1.05);
  box-shadow: 0 0 12px color-mix(in srgb, var(--belt-glow) 20%, transparent);
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
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.06);
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
  background: rgba(255, 255, 255, 0.12);
  color: var(--text-primary);
  transform: scale(1.05);
  border-color: rgba(255, 255, 255, 0.35);
  box-shadow: 0 0 12px color-mix(in srgb, var(--belt-glow) 15%, transparent);
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
    --header-height: 84px;
    --hero-offset: 28px;
    --space-sm: 10px;
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
  }
}

/* Landscape phones - compact vertical spacing */
@media (orientation: landscape) and (max-height: 500px) {
  .player {
    --header-height: 56px;
    --hero-offset: 8px;
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
   Mode tips & Belt celebrations
   ============================================ */

/* Mode Discovery Tip (toast between rounds) */
.mode-tip {
  position: fixed;
  bottom: calc(var(--nav-height-safe, 80px) + 1rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  background: var(--bg-elevated, rgba(30, 30, 40, 0.95));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  max-width: calc(100vw - 2rem);
  -webkit-tap-highlight-color: transparent;
}

.mode-tip__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mode-tip__label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.mode-tip__desc {
  font-size: 0.75rem;
  color: var(--text-muted, rgba(255, 255, 255, 0.5));
  line-height: 1.3;
}

.mode-tip__dismiss {
  background: none;
  border: none;
  color: var(--text-muted, rgba(255, 255, 255, 0.5));
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}

/* Tip fade transition */
.tip-fade-enter-active,
.tip-fade-leave-active {
  transition: opacity 0.3s ease;
}

.tip-fade-enter-from,
.tip-fade-leave-to {
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
/* --- Player wrapper background — clean flat canvas --- */
[data-theme="mist"] .player {
  background: transparent;
}

/* --- Space / Background layers → Flat canvas, no gradients --- */
[data-theme="mist"] .player .space-gradient {
  background: transparent;
}

[data-theme="mist"] .player .space-nebula {
  background: transparent;
  animation: none;
}

@keyframes mist-drift {
  0%, 100% { opacity: 1; transform: translateY(0); }
  50% { opacity: 0.7; transform: translateY(-8px); }
}

[data-theme="mist"] .player .bg-noise {
  opacity: 0.04;
  filter: none;
  mix-blend-mode: multiply;
}

/* Subtle texture */
[data-theme="mist"] .player .bg-noise::after {
  content: '';
  position: absolute;
  inset: 0;
  background: none;
  pointer-events: none;
}

/* --- Hide ALL decorative layers in mist — clean canvas first --- */
[data-theme="mist"] .player .star-field,
[data-theme="mist"] .player .drift-stars,
[data-theme="mist"] .player .mountain-silhouette,
[data-theme="mist"] .player .nebula-glow {
  display: none !important;
}

/* --- Hero glass → Crisp white card with black edge --- */
[data-theme="mist"] .player .hero-glass {
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.12),
              0 8px 24px rgba(44, 38, 34, 0.08),
              0 20px 48px rgba(44, 38, 34, 0.05);
}

/* --- Hero text & intro — all text must be dark on white --- */
[data-theme="mist"] .player .hero-known {
  color: var(--text-primary);
}

[data-theme="mist"] .player .hero-known-salient {
  font-weight: 600;
  color: var(--text-primary);
}
[data-theme="mist"] .player .hero-known-context {
  color: rgba(44, 38, 34, 0.85);
}

[data-theme="mist"] .player .hero-target {
  color: color-mix(in srgb, var(--belt-color) 70%, #2C2622);
  text-shadow: none;
}

[data-theme="mist"] .player .intro-message {
  color: var(--text-primary);
}

[data-theme="mist"] .player .intro-prefix {
  color: var(--belt-color, var(--ssi-red));
}

[data-theme="mist"] .player .intro-cursor {
  color: var(--belt-color, var(--ssi-red));
}

[data-theme="mist"] .player .intro-typewriter {
  color: var(--text-primary);
}

[data-theme="mist"] .player .loading-text {
  color: var(--text-muted);
}

/* --- Control bar → Crisp white pill with black edge --- */
[data-theme="mist"] .player .control-bar {
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.14),
              0 8px 24px rgba(44, 38, 34, 0.10),
              0 20px 48px rgba(44, 38, 34, 0.06);
}

/* --- Belt timer on mist — belt colour fill, softer shadow --- */
[data-theme="mist"] .player .belt-timer-unified {
  background: color-mix(in srgb, var(--belt-color) 65%, white);
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.12),
              0 8px 24px rgba(44, 38, 34, 0.08);
}

[data-theme="mist"] .player .belt-timer-label {
  color: #2C2622;
}

/* --- Mode nav buttons on mist → translucent, not opaque like the pill --- */
/* Mode nav buttons moved to BottomNav.vue */

/* --- Belt skip buttons → crisp white, destination belt color arrows --- */
[data-theme="mist"] .player .belt-header-skip {
  background: rgba(255, 255, 255, 0.96);
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  opacity: 1;
  color: color-mix(in srgb, var(--skip-belt-color, #6B6560) 70%, #2C2622);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10);
}

[data-theme="mist"] .player .belt-header-skip:hover:not(:disabled) {
  background: color-mix(in srgb, var(--skip-belt-color, var(--belt-color)) 12%, #ffffff);
  color: color-mix(in srgb, var(--skip-belt-color, var(--belt-color)) 70%, #2C2622);
  box-shadow: 0 2px 8px rgba(44, 38, 34, 0.14),
              0 0 12px color-mix(in srgb, var(--skip-belt-color, var(--belt-color)) 20%, transparent);
}

[data-theme="mist"] .player .belt-header-skip:disabled {
  background: rgba(255, 255, 255, 0.5);
  border-color: rgba(0, 0, 0, 0.18);
  color: var(--text-muted);
  box-shadow: none;
}

/* --- INF PLAY button states (mist theme — must override the generic
   white belt-skip styling above with matching specificity) --- */
[data-theme="mist"] .player .belt-header-skip.is-infplay-eligible {
  background: rgba(124, 58, 237, 0.10);
  border: 1.5px solid rgba(124, 58, 237, 0.55);
  color: #7c3aed;
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10);
  animation: belt-infplay-throb-mist 1.8s ease-in-out infinite;
}
[data-theme="mist"] .player .belt-header-skip.is-infplay-eligible:hover:not(:disabled) {
  background: rgba(124, 58, 237, 0.18);
  color: #6d28d9;
  box-shadow: 0 2px 8px rgba(44, 38, 34, 0.14),
              0 0 14px rgba(124, 58, 237, 0.35);
}
[data-theme="mist"] .player .belt-header-skip.is-infplay-active {
  background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%);
  border: 1.5px solid rgba(124, 58, 237, 0.7);
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.14),
              0 0 14px rgba(167, 139, 250, 0.5);
  animation: none;
}
[data-theme="mist"] .player .belt-header-skip.is-infplay-active:hover:not(:disabled) {
  background: linear-gradient(135deg, #8b4ff5 0%, #b69cfb 100%);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(44, 38, 34, 0.16),
              0 0 18px rgba(167, 139, 250, 0.65);
}

/* Mist-theme throb keyframes — softer shadow than the dark-theme
 * version so the pulse reads on a light background without looking
 * like a defect. */
@keyframes belt-infplay-throb-mist {
  0%, 100% {
    box-shadow: 0 2px 4px rgba(44, 38, 34, 0.08),
                0 0 3px rgba(124, 58, 237, 0.20);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 2px 6px rgba(44, 38, 34, 0.12),
                0 0 12px rgba(124, 58, 237, 0.45);
    transform: scale(1.06);
  }
}

/* --- Mode / Transport buttons --- */
[data-theme="mist"] .player .mode-btn,
[data-theme="mist"] .player .transport-btn {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  color: var(--text-secondary);
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.10);
}

[data-theme="mist"] .player .mode-btn:hover,
[data-theme="mist"] .player .transport-btn:hover {
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(44, 38, 34, 0.16);
}

[data-theme="mist"] .player .mode-btn.active {
  background: #ffffff;
  color: var(--text-primary);
  box-shadow: 0 2px 8px rgba(44, 38, 34, 0.16);
}

/* --- Belt celebration overlay --- */
[data-theme="mist"] .player .belt-celebration-overlay {
  background: rgba(232, 227, 221, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
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

/* --- Inline hint label → muted text on white glass --- */
[data-theme="mist"] .player .hero-hint-label .hint-text {
  color: var(--text-muted);
}

[data-theme="mist"] .player .hero-glass.is-speaking .hint-text {
  color: var(--ssi-red);
}

[data-theme="mist"] .player .hero-glass.is-speaking {
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.12),
              0 8px 24px rgba(44, 38, 34, 0.08),
              0 0 0 1px rgba(194, 58, 58, 0.2),
              0 0 16px rgba(194, 58, 58, 0.08);
}

[data-theme="mist"] .player .pause-timer-bar {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme="mist"] .player .hint-dismiss {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="mist"] .player .hint-dismiss svg {
  color: var(--text-muted);
}

/* --- Component breakdown tiles → White elevated --- */
[data-theme="mist"] .player .component-tile {
  background: #ffffff;
  border-color: rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10),
              0 6px 16px rgba(44, 38, 34, 0.06);
}

[data-theme="mist"] .player .component-tile-target {
  color: #2C2622;
}

[data-theme="mist"] .player .component-tile-known {
  color: var(--text-muted);
}

[data-theme="mist"] .player .component-plus {
  color: var(--text-muted);
}

/* --- Black belt in mist → double stripe distinction --- */
[data-theme="mist"] .player.belt-black .belt-bar-fill {
  background: linear-gradient(to bottom,
    var(--belt-color) 35%, #ffffff 42%,
    #ffffff 58%, var(--belt-color) 65%) !important;
}
/* Black belt uses same white pill style — no special override needed */

/* --- Audio-failed banner in mist theme --- */
/* Mist's lighter palette needs softer backgrounds + an explicit text
   colour so the chip reads on a light surface. */
[data-theme="mist"] .player .audio-failed-banner {
  background: rgba(59, 130, 246, 0.10);
  border-color: rgba(59, 130, 246, 0.35);
  color: var(--text-primary);
}

[data-theme="mist"] .player .audio-failed-banner:hover {
  background: rgba(59, 130, 246, 0.16);
}

[data-theme="mist"] .player .audio-failed-banner--play-error {
  background: rgba(217, 119, 6, 0.12);
  border-color: rgba(217, 119, 6, 0.45);
}

[data-theme="mist"] .player .audio-failed-banner--play-error:hover {
  background: rgba(217, 119, 6, 0.18);
}
</style>
