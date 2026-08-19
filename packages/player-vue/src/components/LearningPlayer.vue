<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, watchEffect, shallowRef, inject, nextTick, defineAsyncComponent, type PropType, type Ref } from 'vue'
// Offline-download status (shared with the mode-button ring in ModeTray)
import { offlineDlState, offlineDlDone, offlineDlTotal, offlineDlFailed, offlineDlStragglers, offlineTrial, resetOfflineDownloadStatus, resolveOfflineDlOutcome } from '../composables/useOfflineDownloadStatus'
import {
  CyclePhase,
  DEFAULT_CONFIG,
  createVoiceActivityDetector,
  createSpeechTimingAnalyzer,
  ENVELOPE_EXTRACTOR_CONSTANTS,
  type ProgressStore,
  type SessionStore,
} from '@ssi/core'
import type { CourseDataProvider } from '../providers/CourseDataProvider'
import type { CourseInfo } from '../composables/useEntitlement'
import { useCyclePlayback } from '../composables/useCyclePlayback'
import { scriptItemToCycle } from '../utils/scriptItemToCycle'
import type { Cycle } from '../types/Cycle'
// Lazy: session-summary screen, only rendered v-if="showSessionComplete"
// (never on the first-cycle path) — keeps its chunk off cold start.
const SessionComplete = defineAsyncComponent(() => import('./SessionComplete.vue'))
// OnboardingTooltips removed - deprecated
// Lazy: QA-only affordance, v-if="shouldShowQaMode" — never on learner cold path.
const ReportIssueButton = defineAsyncComponent(() => import('./ReportIssueButton.vue'))
// AwakeningLoader removed - loading state now shown inline in player
import { useLearningSession } from '../composables/useLearningSession'
import { useScriptCache, setCachedScript, getScriptStaleness, awaitFreshnessCheck } from '../composables/useScriptCache'
import { fetchAndCacheListeningMeta, collectListeningMetaAudioIds } from '../composables/listeningMetaCache'
import { LOOKAHEAD_CHUNK_SEEDS, LOOKAHEAD_TRIGGER_ROUNDS } from '../composables/useEagerScriptPreload'
import { useMetaCommentary } from '../composables/useMetaCommentary'
import { usePodLapScheduler, type PodLap, type PodPlay } from '../composables/usePodLapScheduler'
import { podPlayShowsTurnText, podLapPlayedSentenceIndices, podLapDisplayRange } from '@ssi/core/pods'
import PodTurnDisplay from './PodTurnDisplay.vue'
import { useLayer1Scheduler, type Layer1Config } from '../composables/useLayer1Scheduler'
import { useSharedBeltProgress, getSeedFromLegoId, getBeltIndexForSeed, BELTS, type BeltProgressSyncConfig } from '../composables/useBeltProgress'
import { useOfflinePlay } from '../composables/useOfflinePlay'
// SimplePlayer - clean playback engine
import { useSimplePlayer } from '../composables/useSimplePlayer'
import { useAdaptationEngine, type UseAdaptationEngineReturn } from '../composables/useAdaptationEngine'
import { useBehaviouralEvidence } from '../composables/useBehaviouralEvidence'
import { recordEnvelopeEvidence } from '../composables/useEnvelopeEvidence'
import { createEnvelopeMetadataCache, type EnvelopeMetadataCache } from '../composables/useEnvelopeMetadataCache'
import { createEvidenceAggregator, type RoundPlan } from '@ssi/core'
import { computeAdaptOmitCycleIds, assembleBreatherRound } from '../playback/adaptationOverrides'
 
import { usePairingsTelemetry } from '../composables/usePairingsTelemetry'
import { useAudioSessionKeepalive } from '../composables/useAudioSessionKeepalive'
import { usePlayerLog } from '../composables/usePlayerLog'
import { envLabel } from '../composables/usePreviewTriggers'
import { useClassAwareProgressStore, type ClassContextForProgress } from '../composables/schools/useClassProgressStore'
import { useClassAwareSessionStore, type ClassContextForSession } from '../composables/schools/useClassSessionStore'
import type { ListeningConfig as ListeningConfigType } from '../providers/generateLearningScript'
// New simple script generation - direct database queries
import { generateLearningScript as generateSimpleScript, DEFAULT_LISTENING_CONFIG, makeSliceYielder, yieldToEventLoop, type ScriptItem } from '../providers/generateLearningScript'
import { computeCentralityFromScript } from '../playback/legoCentrality'
import { resolvePodActivationRound } from '../composables/usePodActivation'
import { toSimpleRounds, toSimpleRoundsCooperative, type TargetSpeedConfig } from '../providers/toSimpleRounds'
import { computeListeningSpeed } from '../providers/toSimpleRounds'
import { isRepeatCopyCycle } from '../providers/reshapeRoundRepeats'
import {
  selectCyclesOutForMode,
  selectionIsInert,
  makeModeSelectionContext,
  courseMaxCycleLength,
  type ModeSelectionConfig,
} from '../playback/modeCycleSelection'
import { isTargetRole, type PodPlayRole } from '@ssi/core/pods'
import {
  useAlgorithmConfig,
  resolveListeningPlayPolicy,
  normalizePhraseRepeatCount,
  normalizeRepeatedCycleTypes,
  normalizeReviewFilterMaxRound,
  makeUseWordCap,
  type LearningMode,
} from '../composables/useAlgorithmConfig'
import { resolveNewLearnerMode } from '../composables/newLearnerMode'
import { computePauseDuration } from '../playback/computePauseDuration'
import { bulkDownloadAudio, fetchBatchAudioUrls } from '../playback/bulkAudioDownload'
import { useAuthModal } from '../composables/useAuthModal'
import { useCheckout } from '../composables/useCheckout'
import LegoAssembly from './LegoAssembly.vue'
import type { LegoBlock } from './LegoAssembly.vue'
import { ensureTileCoverage } from '../utils/ensureTileCoverage'
import { tilesFromGlossSegments, type GlossSegment } from '../utils/authoredGlossSegments'
import { hasReachedInfinitePlay as hasReachedInfinitePlayPure } from '../utils/infinitePlay'
import { resolveResumeAnchor } from '../utils/resolveResumeAnchor'
import { resolveAuthoritativePosition } from '../utils/resolveAuthoritativePosition'
import {
  getDeepLinkTarget,
  resolveDeepLinkTarget,
  deepLinkAppliesTo,
  deepLinkForcesLearnerDefaults,
  resolveCycleIndex,
  type ResolvedDeepLink,
} from '../utils/deepLinkTarget'
import { decomposePhrase } from '../utils/decomposePhrase'
import { buildWordTiles, buildWordPairTiles, nativeFromRomanTiles, buildSegmentedTiles } from '../utils/alignRomanToNative'
// Lazy: opt-in Listening-Pod mode, v-if="showListeningOverlay" — off by default,
// not on the learning-cycle path. Heaviest clear win.
const ListeningOverlay = defineAsyncComponent(() => import('./ListeningOverlay.vue'))
// Lazy: opt-in Pronunciation/mic mode, v-if="showPronunciationOverlay" — pulls the
// prosody/mic subtree off cold start.
const PronunciationOverlay = defineAsyncComponent(() => import('./PronunciationOverlay.vue'))
import { useScriptMode } from '../composables/useScriptMode'
import { getLanguageName, t } from '../composables/useI18n'
import { hasSeenBrandWelcome, markBrandWelcomeSeen, playBrandWelcome } from '../composables/useBrandWelcome'
import { updateAvailable as pwaUpdateAvailable, userDismissed as pwaUserDismissed, applyUpdate as pwaApplyUpdate } from '../composables/usePwaUpdate'
import LanguageFlag from './schools/shared/LanguageFlag.vue'
// Lazy: progress/contribution/belt modal. Its v-if (contribution.data.value) may
// mount shortly after ready, but it renders no visible content until
// showProgressModal opens, so deferring its chunk is flash-free.
const ProgressModal = defineAsyncComponent(() => import('./ProgressModal.vue'))
import { useContribution } from '../composables/useContribution'
import { useEntitlement } from '../composables/useEntitlement'
import { useOfflineLease } from '../composables/useOfflineLease'
import { markOfflineInfPlayEngaged, dismissOfflineInfPlayNotice, offlineInfPlayNoticeVisible } from '../composables/useOfflineInfPlayNotice'
import { isNetworkPresumedDown } from '../config/networkGate'
import { createOfflineUrn, type UrnCandidate } from '../playback/offlineUrn'
import { isCyclePlayableOffline, requiredClipUrls } from '../playback/offlinePlayable'
import { useSharedUserEntitlements } from '../composables/useUserEntitlements'
import { PREMIUM_PREVIEW_MAX_SEED } from '@ssi/core'
import { useInstantPlayback, type RoundMap } from '../composables/useInstantPlayback'
import { backendCyclesToRounds, infPlayCyclesToRounds } from '../providers/backendCyclesToRounds'
import { setIntroAudioTelemetrySink } from '../playback/introAudioTelemetry'
import { shouldShowInterjection, type CommentaryDisplayType } from '../playback/interjectionDisplay'
import type { Round as PlayerRound } from '../playback/SimplePlayer'
import { getAudioCache } from '../cache/createAudioCache'
import { resolveCachedPlaybackUrl } from '../cache/resolvePlaybackUrl'
import { createAudioCacheSource, type AudioCacheSource } from '../cache/createAudioCacheSource'

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
// KEPT: rollout scaffolding — INSTANT_PLAYBACK_COURSES is the per-course
// rollback lever; the legacy init path is the catch-fallback safety net.
const INSTANT_PLAYBACK_ALL = true
const INSTANT_PLAYBACK_COURSES = new Set<string>([
  // Used only when INSTANT_PLAYBACK_ALL is false. Examples:
  //   'spa_for_eng', 'ell_for_eng', 'dan_for_eng', 'gle_for_eng',
])
function isInstantPlaybackCourse(courseCode: string): boolean {
  return INSTANT_PLAYBACK_ALL || INSTANT_PLAYBACK_COURSES.has(courseCode)
}

// ============================================================
// Seeded RNG for the deterministic INF-PLAY USE tail
// ============================================================
// INF PLAY online is "the frozen online script run forward": the SR drain is
// already deterministic (Fibonacci offsets), and the random-USE steady-state
// AFTER the drain must ALSO be seeded-deterministic — same learner + same
// position ⇒ same stream, every session and every regeneration. That's what
// makes back-nav return to what was just heard, and keeps online + offline on
// ONE model (coordinator decision 2026-05-29). The seed is derived from a
// stable string (course + learner) so it's reproducible but distinct per
// learner. The MAIN LOOP never consumes this — main play is unchanged.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStringToSeed(str: string): number {
  // FNV-1a 32-bit — cheap, stable, well-distributed for short keys.
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// requestIdleCallback with a setTimeout fallback (Safari < 16.4). Used to push
// the deferred full-course walk (generateScript handoff) off the cold-start
// critical path so it can't starve the instant bootstrap. The timeout ceiling
// guarantees the walk still runs even on a busy main thread — it lands long
// before the learner reaches the INF-PLAY boundary that consumes its output.
function scheduleIdleTask(fn: () => void, timeout = 2000): void {
  if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
    ;(window as any).requestIdleCallback(fn, { timeout })
  } else {
    setTimeout(fn, 0)
  }
}

/**
 * Near-edge top-up threshold for the instant-playback path: when the
 * learner's current round is within this many rounds of the loaded
 * edge, fire tier-3 prefetch so the next batch lands before they hit
 * the end. Mirrors the legacy `LOOKAHEAD_TRIGGER_ROUNDS` knob but
 * applied to the round-map-driven loader instead of seed-range loads.
 */
const INSTANT_PLAYBACK_NEAR_EDGE_ROUNDS = 3

const emit = defineEmits(['close', 'viewProgress', 'cycle-started'])

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
  // True when the player runs INSIDE a shell that already provides its own
  // (light, Mist-theme) top nav — e.g. the teach "Play as class" route inside
  // TeachContainer. In that case the player's own legacy dark `.class-bar`
  // ("Back to classes") is a redundant SECOND top bar in the wrong (dark) theme,
  // so it's hidden and the shell's nav is the single source of navigation.
  embedded: {
    type: Boolean,
    default: false
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
  },
  // The learner's cumulative learning time across ALL courses, in minutes —
  // the encouragement-taper signal (owner ruling 2026-08-06). Supplied by
  // PlayerContainer from /api/me/engaged-time. null = UNKNOWN (guest, offline,
  // or the fetch hasn't landed), NOT zero-with-confidence — the service treats
  // unknown as "beginner", which is the safe read for a missing signal.
  cumulativeLearningMinutes: {
    type: Number as PropType<number | null>,
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

// Algorithm config - admin-tweakable parameters (Easy/Fast mode pause, etc.)
const {
  loadConfigs: loadAlgorithmConfigs,
  easyConfig,
  fastConfig,
  scriptShapeForMode,
  listeningConfig,
  podsConfig,
  scriptShapeConfig,
  resumeConfig,
  adaptationV2Config,
  metaCommentaryConfig,
  isLoaded: algorithmConfigLoaded
} = useAlgorithmConfig(supabase)

// ── INF PLAY revival-tail sizing ───────────────────────────────────────────
// The revival tail must run at LEAST max(spacedRepOffsets) rounds so the FINAL
// main-loop LEGO completes its full N-1 … N-89 spaced-rep drain. Anything
// shorter (the old hard-coded 50) leaves the last LEGOs under-trained — a
// methodology requirement, not a perf knob. Beyond that floor the tail GROWS in
// batches as the learner walks it (expandScript bumps infPlayLookahead while in
// INF PLAY), so play is genuinely unbounded: every revival round is ~22 cycles
// of the drained-out spaced review plus uniform-random USE across the whole
// course, and the deterministic seeded stream just keeps extending forward.
const INF_PLAY_BATCH = 50
// Revival-tail length fed to the generator. 0 = "not yet sized" → the floor
// applies; expandScript raises it in INF PLAY so each regen yields new rounds.
const infPlayLookahead = ref(0)
const infPlayLookaheadFloor = (): number => {
  const offsets = scriptShapeConfig.value?.spacedRepOffsets
  const maxOffset = offsets && offsets.length ? Math.max(...offsets) : 89
  // +1 of headroom so the final LEGO's longest-offset review sits comfortably
  // inside the tail rather than exactly on the last generated round.
  return maxOffset + 1
}

/**
 * Wrapper for generateSimpleScript that threads the live algorithm_config
 * triple (listening, mode script-shape, phrase-length preference) into every
 * script-generation
 * call. Pass `listeningOverride` only when you need the per-learner pod
 * activation pin merged on top.
 */
// In-flight walk dedupe. Concurrent callers whose inputs produce the same
// script share ONE walk — on every cold mount the expansion watcher (fires
// immediately: only ~3 bootstrap rounds loaded, under EXPANSION_THRESHOLD)
// and the deferred full-script handoff both walked the whole course in
// parallel, doubling the six course-wide queries at exactly the moment the
// first audio is loading. Keyed on the inputs that change the output; the
// entry clears on settle, so this only merges genuinely CONCURRENT
// duplicates and never serves a stale result (INF-PLAY expansion bumps the
// lookahead → different key → fresh walk, as before).
let inFlightScript: { key: string; promise: Promise<any> } | null = null

// Forward-reuse centrality (founder ruling 2026-07-31 — the distinction
// network's criticality signal, see @ssi/core centrality.ts). Computed once
// per course from the first full script walk: INF-PLAY expansions only extend
// the revival tail with replayed content, so the map never changes within a
// course. Consumed by planRound (shadow mode: logged, never applied).
let centralityForCourse: string | null = null
const legoCentralityPercentile = ref<Record<string, number> | null>(null)

const maybeComputeCentrality = (items: ScriptItem[] | undefined, forCourse: string) => {
  if (!items?.length || centralityForCourse === forCourse) return
  try {
    centralityForCourse = forCourse
    const { percentileByLego } = computeCentralityFromScript(items)
    legoCentralityPercentile.value = percentileByLego
  } catch (err) {
    // Centrality is an enrichment — the criticality guard falls back to
    // intro-order without it. Never let it break script delivery.
    console.error('[LearningPlayer] centrality computation failed (falling back to intro-order):', err)
  }
}

const generateScript = (
  listeningOverride?: ListeningConfigType,
) => {
  if (!supabase?.value) {
    return Promise.reject(new Error('No supabase client'))
  }
  // Key on the RAW lookahead counter, not the config-derived floor: at mount
  // the floor can change mid-race (algorithm config landing between the
  // expansion watcher's call and the handoff's) which would split the key and
  // defeat the dedupe — while the counter only moves when INF-PLAY expansion
  // deliberately bumps it, which is exactly when a fresh walk IS wanted.
  // learningMode is part of the key: Easy and Fast produce genuinely
  // different scripts (doubled reps, longest-first phrases), so a mode change
  // must not be served a cached walk from the other mode.
  const dedupeKey = `${courseCode.value}|${infPlayLookahead.value}|${learningMode.value}|${listeningOverride ? JSON.stringify(listeningOverride) : 'base'}`
  if (inFlightScript && inFlightScript.key === dedupeKey) {
    return inFlightScript.promise
  }
  const promise = runGenerateScript(listeningOverride)
  inFlightScript = { key: dedupeKey, promise }
  const walkCourse = courseCode.value
  promise.then((result) => {
    if (walkCourse === courseCode.value) maybeComputeCentrality(result?.items, walkCourse)
  }).catch(() => { /* observers handle their own errors */ })
  promise.finally(() => {
    if (inFlightScript?.promise === promise) inFlightScript = null
  }).catch(() => { /* observers handle their own errors */ })
  return promise
}

const runGenerateScript = (
  listeningOverride?: ListeningConfigType,
) => {
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
  //
  // infinitePlayLookahead = current revival-tail length, never below the floor
  // (so the final LEGO always drains fully). expandScript grows it in batches
  // during INF PLAY so the tail keeps extending — genuinely infinite.
  const infinitePlayLookahead = Math.max(infPlayLookahead.value, infPlayLookaheadFloor())
  return generateSimpleScript(
    supabase.value,
    courseCode.value,
    infinitePlayLookahead,  // revival rounds after the main loop (≥ max SR offset, grows in INF PLAY)
    listening,
    // Per-mode script shape: the global script_shape row with the active
    // mode's overlay on top. Fast carries no overlay ⇒ unchanged.
    // THE ONE REMAINING MODE INPUT TO THE WALK, and it is inert by default.
    // `ModeConfig.scriptShape` is the per-mode phrase-COUNT overlay on the
    // admin Speaking page (how many different BUILD/USE/review phrases a round
    // holds), and both shipped modes carry `{}` — so today the walk is
    // genuinely mode-neutral and one cached script serves both. SETTING A
    // NON-EMPTY OVERLAY WOULD RE-INTRODUCE A MODE-DEPENDENT SCRIPT, and with
    // it the very bug this file just spent two attempts fixing: the cached
    // walk would carry one mode's round sizes and a toggle could not change
    // them. If that knob is ever wanted, round SIZE has to move into the
    // player's live selection alongside length, filter and repetition.
    scriptShapeForMode(learningMode.value),
    // THE WALK IS MODE-NEUTRAL AND GENEROUS (Tom's architecture call,
    // 2026-08-09). It emits the FULL set — no phrase-length cap, no BUILD
    // filter, no review syllable filter, no USE word cap, no doubling — and
    // the player selects from it live, per step, under whichever mode is
    // active (playback/modeCycleSelection.ts + the getCycleRepeatCount
    // override). Every one of those levers used to run HERE, where it DROPS
    // items: a dropped phrase is unrecoverable from the queue, which is
    // precisely why a mid-session toggle could never change which phrases
    // played. One script, both modes, cached and never invalidated by a
    // toggle — that is what "the instructions belong in the player, not in
    // the cached script data" buys.
    1,
    MODE_NEUTRAL_WALK_OPTIONS,
    // Pod-lap firing cadence from the pods config — keeps the generator's
    // L1-outro merge decision in sync with the runtime scheduler.
    podsConfig.value.roundInterval ?? 1,
    // Seeded INF-PLAY USE tail. The whole revival tail (SR drain + the
    // random-USE steady-state after it) is generated deterministically from a
    // per-learner+course seed, so resume / regen reproduce the SAME stream and
    // INF PLAY is navigable. Main loop ignores this param.
    makeInfPlayRng(),
  )
}

/**
 * The active mode's cycle-repeat setting. Read fresh on every call, because
 * the WALKER asks for it at the end of every cycle — see the
 * `getCycleRepeatCount` runtime override. Nothing builds with it any more.
 */
const currentRepeatConfig = () => ({
  count: normalizePhraseRepeatCount(activeModeConfig.value.phraseRepeatCount),
  types: normalizeRepeatedCycleTypes(activeModeConfig.value.repeatedCycleTypes),
})

/**
 * What the BUILDERS get instead: no repetition at all.
 *
 * Tom's architecture call, 2026-08-09 — "the instructions for WHICH cycles get
 * selected/played and HOW MANY TIMES belongs in the player logic, not the
 * cached script data". So the script and the instant-path rounds carry each
 * phrase EXACTLY ONCE, in both modes, and the walker decides live how often it
 * sounds. One script, cacheable, shared: a toggle changes what is heard without
 * touching a byte of what is cached.
 */
const MODE_NEUTRAL_REPEATS = { count: 1, types: new Set<string>() }

/**
 * The same neutrality, in the shape `generateSimpleScript` takes: every Easy
 * lever OFF, so one walk serves both modes and the player does the selecting.
 * `maxPhraseLengthFraction` travels as its own argument and is likewise 1.
 */
const MODE_NEUTRAL_WALK_OPTIONS = {
  phraseRepeatCount: 1,
  repeatedCycleTypes: [] as string[],
  filterBuildPhrases: false,
  reviewMaxKnownSyllables: 0,
  reviewSyllableFilterMaxRound: 0,
  useWordCapTiers: [] as never[],
}

// Build the seeded rng for the INF-PLAY revival tail. Keyed on course +
// learner so it's stable across sessions/regenerations for a given learner
// (back-nav returns to what was just heard) but distinct between learners.
// NOT keyed on the live round index — the whole tail is one frozen stream the
// cursor walks; re-seeding per round would re-roll the future on every step.
const makeInfPlayRng = (): (() => number) => {
  const key = `${courseCode.value}|${learnerId.value || 'guest'}|infplay-v1`
  return mulberry32(hashStringToSeed(key))
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

// Production deep link — Popty's Script Viewer launching "this round" here for
// a real-fidelity listen (utils/deepLinkTarget.ts owns the URL contract). The
// raw target is captured once per page load; `deepLinkStart` holds it AFTER it
// has been resolved against this course's round-map, and stays null when the
// link names something this course doesn't have, so normal resume is untouched.
const deepLinkTarget = getDeepLinkTarget()
const deepLinkStart = ref<ResolvedDeepLink | null>(null)

// Fidelity rule (Tom, 2026-08-05): a deep-linked launch opens on the DB
// defaults a real learner gets — never a QA/preview variant, never the
// reviewer's remembered local settings. This is computed, not stored, so it
// costs nothing when there is no deep link, and nothing is ever written back:
// the reviewer's own settings survive untouched for their next normal visit.
const learnerDefaultsForced = computed(() =>
  deepLinkForcesLearnerDefaults(deepLinkTarget, courseCode.value),
)

// Instant-playback composable (flag-gated, see INSTANT_PLAYBACK_COURSES).
// Wires `last_completed_lego_id` from the enrollment row as the resume
// anchor — matches the resolution path used by the legacy eager-script
// load, so flipping the flag on a course doesn't change where the
// learner lands on resume. Kicked off in `loadAllData` only when the
// course is in the flag set; the cold path skips the full course load
// and renders the first cycle from the new endpoints.
const instantPlayback = useInstantPlayback(courseCode, {
  resolveStartLegoId: async () => {
    // Position authority ruling (docs/pwa-lifecycle-design.md §2.3,
    // 2026-07-09): the server enrollment row is authoritative for a
    // signed-in learner; localStorage is a device CACHE trusted only
    // when strictly fresher than the server's last_practiced_at. A
    // guest (no enrollment row to consult) still resolves local-only,
    // same as before. Tom 2026-05-26 established local as the fast
    // path; this closes the resurrection bug that model reopened
    // (reset nulled the DB but local survived and re-ratcheted it back).
    // Production deep link wins over every saved position — it is an explicit
    // "start HERE" instruction, not a resume. Resolved against the round-map
    // before this runs, so a target this course doesn't have never gets here.
    if (deepLinkStart.value) return deepLinkStart.value.legoId

    const localPos = courseCode.value ? loadPositionFromLocalStorage() : null
    const localSnapshot = localPos?.legoId
      ? { legoId: localPos.legoId, lastUpdated: localPos.lastUpdated ?? null }
      : null

    // No server row to compare against — guest, no progress store, or a
    // guest-prefixed learner id (fails the UUID column constraint on
    // course_enrollments, so never worth querying). Fail to local exactly
    // as resume always has when there's nothing to compare.
    if (!progressStore?.value || !learnerId.value || !courseCode.value || learnerId.value.startsWith('guest-')) {
      return localSnapshot?.legoId ?? null
    }

    // Bounded race: server answered in time → apply the freshness rule;
    // timed out / offline / errored → fail to local (keeps offline resume
    // working exactly as it did before this ruling).
    const ENROLLMENT_FETCH_TIMEOUT_MS = 2000
    const TIMEOUT = Symbol('enrollment-fetch-timeout')
    let enrollment: Awaited<ReturnType<typeof activeProgressStore.value.getEnrollment>> | null = null
    try {
      const result = await Promise.race([
        activeProgressStore.value.getEnrollment(learnerId.value, courseCode.value),
        new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ENROLLMENT_FETCH_TIMEOUT_MS)),
      ])
      if (result === TIMEOUT) return localSnapshot?.legoId ?? null
      enrollment = result
    } catch {
      enrollment = null
    }

    const winner = resolveAuthoritativePosition(localSnapshot, enrollment ? {
      cursorLegoId: enrollment.last_completed_lego_id ?? null,
      lastPracticedAt: enrollment.last_practiced_at ? enrollment.last_practiced_at.getTime() : null,
    } : null)

    if (winner.source !== 'server') {
      return winner.legoId
    }

    try {
      // INF PLAY mode: skip instant-playback entirely and fall to the
      // legacy path, which emits the spaced-rep + random-USE rounds the
      // mode is designed around. The path is the same as the course-
      // end case below — throw and let the catch in LearningPlayer
      // pick up the legacy generator.
      //
      // Cursor-only model: infinite-play is DERIVED — no is_new LEGO
      // remains beyond the cursor — rather than trusted from the
      // enrollment.current_mode column (2026-07-04).
      const lastCompleted = winner.legoId
      if (await hasReachedInfinitePlay(lastCompleted, courseCode.value)) {
        throw new Error('CourseEndNoNextLego')
      }

      // The cursor (last_completed_lego_id) is the primary position. If it
      // can't be located in the round-map — null on a fresh row, or
      // stale/schema-drifted — fall back to the legacy ceiling
      // (highest_completed_lego_id) when one is populated, so a learner
      // with a null/unresolvable cursor but a real ceiling isn't dropped
      // to R1 (2026-07-05: narrow reinstatement — read-only fallback,
      // never ratcheted or written back). Only a learner with neither
      // resolves fresh at R1.
      const ceiling = enrollment?.highest_completed_lego_id ?? null
      const map = await instantPlayback.getOrFetchRoundMap()
      const findIndex = (legoId: string) => map.rounds.findIndex(r => r.legoId === legoId)
      const { legoId: anchor, viaCeiling } = resolveResumeAnchor(lastCompleted, ceiling, findIndex)
      if (viaCeiling) {
        console.warn(`[InstantPlayback] cursor ${lastCompleted} not in round-map; falling back to ceiling ${anchor}`)
      }
      if (!anchor) {
        if (lastCompleted) {
          console.warn(`[InstantPlayback] resume anchor ${lastCompleted} not in round-map; starting at R1`)
        }
        return null
      }

      // anchor names the round the learner is ON (position, not
      // completion), so resume lands there directly — no "+1". The saved
      // cycle index restores the exact mid-round spot. INF PLAY is handled
      // by the derived check above, so there's no course-end branch here:
      // a main-mode learner sitting on the final round simply resumes onto
      // it and enters INF PLAY when they finish it.
      return anchor
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
// AudioCache stores blobs in IndexedDB with quota-aware LRU eviction.
// Audio is filled by the rolling filler (fillBuffer/expandScript) ahead
// of the playhead; online plays from cache like offline (cachePlayOnline).
const audioCache = getAudioCache()
// Module-scoped so onUnmounted can revoke its blob URLs. Built per
// session in onMounted once the courseCode is known.
let audioCacheSource: AudioCacheSource | null = null
// Streaming-first audio: per-cycle resolution lands the playing cycle's
// ids into AudioCache.persistent, and SimplePlayer.prefetchNextCycle
// warms the upcoming cycle's voices during the prompt/pause window. The
// SW CacheFirst layer then serves repeat plays from cache. That's enough
// to avoid races between cycle entry and audio load — no bulk upfront
// caching. Learners who want full-course caching get driving mode's
// chunked accumulation or the future paid "Download for offline" opt-in.

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

/**
 * The known side, beside the target side above — both are needed as `lang`
 * attributes on the text they describe, because DM Sans cannot spell Greek,
 * Cyrillic, Devanagari, the Yoruba dot-belows or the pinyin tone vowels, and
 * an undeclared run gets substituted per-character so a word renders in two
 * typefaces (styles/design-tokens.css). Either side of a course can be such a
 * language: cym_for_yor reads Welsh tiles over Yoruba glosses.
 *
 * Note this is NOT the `targetLang` computed further down — that one is a
 * heuristic for picking a reward word and only answers zho/ita/spa/cym.
 */
const courseKnownLang = computed(() => {
  if (!props.course) return courseCode.value?.split('_for_')[1] || ''
  return props.course.known_lang || courseCode.value?.split('_for_')[1] || ''
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

// Get learner ID from auth (or fallback to 'demo-learner' for dev).
// Play-as-class (owner ruling 2026-07-16): a class is a first-class learner
// citizen with its OWN learner id — while props.classContext is active, every
// downstream read/write in this component (belt progress, cursor, telemetry)
// keys off the CLASS's learner id, not the driving staff member's own. Falls
// back to the staff member's id only in the brief window before a class has
// its learner entity minted (see ensureClassLearnerEntity).
const staffLearnerId = computed(() => auth?.learnerId?.value || 'demo-learner')
const learnerId = computed(() => props.classContext?.class_learner_id || staffLearnerId.value)

// Every course_enrollments/lego_progress write for the class's learner id
// MUST go through the server-mediated /api/school/class-progress endpoint —
// RLS is own-row only (current_learner_id() resolves to the STAFF's row, not
// the class's), so a direct browser write targeting another learner's row is
// rejected by design. Outside class mode this is a transparent passthrough
// to the real (RLS-bound) progressStore.
const activeProgressStore = useClassAwareProgressStore(
  progressStore as unknown as Ref<any>,
  computed(() => props.classContext as ClassContextForProgress | null),
  supabase as unknown as Ref<any>,
)

// Practice-hours spine (LANE A, docs/the-view/play-as-class-REPORT.md §1.2):
// same server-mediated routing as activeProgressStore above, but for the
// `sessions` insert/checkpoint/end — RLS rejects a direct browser write
// targeting the class's learner id, so class mode routes through
// /api/school/class-progress instead of a transparent passthrough.
const activeSessionStore = useClassAwareSessionStore(
  sessionStore as unknown as Ref<any>,
  computed(() => props.classContext as ClassContextForSession | null),
  supabase as unknown as Ref<any>,
)

// Helper to check if learner is a guest (no persistence for guests)
const isGuestLearner = computed(() => {
  const id = learnerId.value
  return !id || id === 'demo-learner' || id.startsWith('guest-')
})

// /api/player-events attributes every event via the ssi-user-id cookie (set
// by useAuth's own watch on the STAFF's learner.id) — flip it to the class's
// learner id for the duration of a play-as-class session, and restore it to
// the staff member's own on the way out, so audio_play/telemetry attribution
// follows learnerId exactly like every DB write above already does.
watch(
  () => props.classContext?.class_learner_id ?? null,
  (classLearnerId, prevClassLearnerId) => {
    if (classLearnerId === prevClassLearnerId) return
    const syncCookie = (auth as any)?.syncAudioUserCookie
    if (typeof syncCookie !== 'function') return
    syncCookie(classLearnerId || staffLearnerId.value)
  },
  { immediate: true },
)
onUnmounted(() => {
  const syncCookie = (auth as any)?.syncAudioUserCookie
  if (props.classContext && typeof syncCookie === 'function') {
    syncCookie(staffLearnerId.value)
  }
})

// Developer settings (can be toggled in Settings > Developer)
const enableQaMode = ref(false)
const showDebugOverlay = ref(false)

// Computed properties for conditional rendering
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
  // class_sessions.teacher_user_id holds the AUTH uid (matches classes.teacher_user_id
  // and the own-row RLS policy) — never learnerId. Guests have no auth uid: skip logging.
  const teacherUserId = (auth as any)?.userId?.value
  if (!teacherUserId) return
  const startLegoId = props.classContext.last_lego_id || 'S0001L01'
  classSessionStartTime.value = Date.now()
  classSessionLastLegoId.value = startLegoId

  const { data, error } = await supabase.value
    .from('class_sessions')
    .insert({
      class_id: props.classContext.id,
      teacher_user_id: teacherUserId,
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
    await activeProgressStore.value.setEnrollmentCursor(
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

  // INF PLAY: the cursor is FROZEN at the ceiling — stamped once on entry
  // via setMode's last_completed_lego_id ratchet. Re-persisting here would
  // write the round's random-USE legoId and strand the cursor at an early
  // LEGO (a high round_index paired with e.g. S0001L01 — the corruption we
  // saw). In INF PLAY the cursor is owned by entry, so skip. Explicit exits
  // (belt-back) flip currentMode to 'main' BEFORE calling this, so the
  // main-loop position below is written then.
  if (currentMode.value === 'infplay') return

  await setRemoteCursor(round.legoId, idx)
  liftLocalCeilingIfHigher(round.legoId, idx)
  // Mirror what we just wrote to DB into the local ref so the
  // resting-state journey-bar reflects current cursor without
  // waiting for the next enrollment reload.
  lastCompletedLegoIdRef.value = round.legoId
}

// Persist the LIVE cursor — the round the playhead is on right now — to the
// DB. This is the "position, not completion" model: last_completed_* names a
// position, so resume lands here directly (no "+1"). Fired on every round
// advance (the roundIndex watcher) and once on init, so the DB cursor tracks
// the current round; per-cycle refinement is handled by updateCurrentCycle.
// setLivePosition is forward-only-by-round (lte guard) and, unlike
// setEnrollmentCursor, sets the cycle explicitly so a mid-round resume is
// never wiped. INF PLAY is skipped: the cursor is frozen at the ceiling.
const persistLivePositionToDb = (cycleOverride?: number, touchPracticedAt = true) => {
  if (isGuestLearner.value || !progressStore?.value || !learnerId.value || !courseCode.value) return
  if (currentMode.value === 'infplay') return
  const round = simplePlayer.currentRound.value
  const idx = simplePlayer.roundIndex.value
  if (!round?.legoId || typeof idx !== 'number') return
  // Round-advance callers pass 0 (a new round always starts at cycle 0)
  // rather than reading simplePlayer.cycleIndex, which may be mid-reset on
  // the advance tick. Init passes nothing → uses the live (resumed) cycle.
  // touchPracticedAt=false for LIFECYCLE saves (init complete, dormant):
  // they persist position without claiming practice — a boot-time
  // last_practiced_at stamp defeated the resume gap rule (Aran 2026-06-11).
  const cyc = cycleOverride ?? Math.max(0, simplePlayer.cycleIndex.value)
  activeProgressStore.value.setLivePosition(
    learnerId.value, courseCode.value, round.legoId, idx, cyc,
    { touchPracticedAt },
  ).catch(err => console.warn('[LearningPlayer] Failed to persist live position:', err))
  liftLocalCeilingIfHigher(round.legoId, idx)
  lastCompletedLegoIdRef.value = round.legoId
}

const saveRoundProgress = async (legoId, roundIndex, round?: any) => {
  if (isGuestLearner.value || !progressStore?.value) {
    console.log('[LearningPlayer] Skipping progress save (guest mode)')
    return
  }

  // Use the round object passed by the caller, falling back to
  // cachedRounds for the legacy path. cachedRounds is empty on the
  // instant-playback path.
  const r = round ?? cachedRounds.value[roundIndex]
  const isInfPlayRound = !!r?.cycles?.length && !r.cycles.some((c: any) =>
    c.type === 'intro' || c.type === 'debut' || c.type === 'build'
  )

  // MAIN loop: the cursor is the LIVE position (the round + cycle the
  // learner is ON) and is written continuously by persistLivePositionToDb
  // (on round advance / init) and updateCurrentCycle (per cycle) — the
  // "position, not completion" model, so resume lands there directly with
  // no "+1". There is nothing to persist on round COMPLETION for the main
  // loop. INF PLAY: the cursor is frozen at the ceiling; we only advance
  // the counter and keep mode + ceiling at "the end".
  if (!isInfPlayRound) {
    console.log('[LearningPlayer] Round complete (main): round', roundIndex, 'LEGO:', legoId, '— cursor tracked live')
    return
  }

  // INF PLAY auto-entry (mid-session). Crossing from the last main-loop
  // round into the first infplay round flips current_mode here so the mode
  // flag lands without a session restart. setMode is idempotent (re-entry
  // doesn't reset the counter); chained bumpInfplayRound increments per round.
  try {
    // Auto-entry also ratchets highest to the course's final LEGO. Same
    // semantic as explicit-tap entry — once you're playing INF PLAY rounds,
    // your high-water mark is the end of the main loop regardless of which
    // path got you there. This is also what pins the frozen cursor at the
    // ceiling (setMode writes last_completed_lego_id = finalLego).
    const finalLego = await getCourseFinalLego(courseCode.value)
    await activeProgressStore.value.setMode(
      learnerId.value, courseCode.value, 'infplay',
      finalLego ?? undefined,
    )
    await activeProgressStore.value.bumpInfplayRound(
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

// Load saved progress from database
// Bounded the same way as resolveStartLegoId's getEnrollment call: on a
// flaky connection the bare Supabase fetch can hang unboundedly (no
// AbortController/timeout on the client — see App.vue), which was
// stalling boot for minutes for cold_start telemetry's slow tail. Timeout
// fails to null exactly like "no saved progress" — callers already treat
// that as fall-through to local cache / round 1 defaults.
const ENROLLMENT_FETCH_TIMEOUT_MS = 2000
const loadSavedProgress = async () => {
  if (isGuestLearner.value || !progressStore?.value) {
    return null
  }

  try {
    const TIMEOUT = Symbol('enrollment-fetch-timeout')
    const enrollment = await Promise.race([
      activeProgressStore.value.getEnrollment(learnerId.value, courseCode.value),
      new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ENROLLMENT_FETCH_TIMEOUT_MS)),
    ]).then((result) => (result === TIMEOUT ? null : result))
    if (enrollment && enrollment.last_completed_round_index !== null) {
      return {
        lastCompletedLegoId: enrollment.last_completed_lego_id,
        lastCompletedRoundIndex: enrollment.last_completed_round_index,
        highestCompletedLegoId: enrollment.highest_completed_lego_id,
        highestCompletedRoundIndex: enrollment.highest_completed_round_index,
        currentCycleIndex: enrollment.current_cycle_index ?? 0,
        lastPracticedAt: enrollment.last_practiced_at ?? null,
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

// hasReachedInfinitePlay lives in utils/infinitePlay.ts (cursor-only model,
// 2026-07-04) so it's unit-testable outside this component. Thin wrapper
// keeps every existing (legoId, course) call site in this file unchanged.
const hasReachedInfinitePlay = (legoId: string | null, course: string): Promise<boolean> =>
  hasReachedInfinitePlayPure(legoId, course, supabase?.value)

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

// ── THE single source of truth for the main-loop sequence ──────────────────
// The LEGO-ID-ordered round map (course_round_index), fetched once on load via
// the SAME cached /round-map the instant-playback path uses (getOrFetchRoundMap).
// course_round_index is already the SERVER-SIDE authority — the cursor-repair
// migration caps reach at MAX(round_index) FROM course_round_index, and
// course_stats.lego_count counts it. We hold it in its OWN stable ref, NOT
// instantPlayback.roundMap (which bootstrapInfPlay overwrites with a synthetic
// infplay map — the "messy" one we must never read as the boundary).
//
// EVERY main-loop boundary / position read goes through the two helpers below.
// No round-index arithmetic (pods, encouragements and listening rounds get
// spliced into the live index and pollute it), no DB is_new estimate, no
// per-source generator guess. Up to the boundary the position is known purely
// by LEGO ID; only PAST the boundary (INF PLAY, no more LEGOs) does a counter
// take over (infplayRoundIndex, bumped per round in saveRoundProgress).
const mainLoopMap = ref<RoundMap | null>(null)

// LIVE, audio-aware main-loop extent — the SINGLE SOURCE OF TRUTH once a script
// has actually been generated this session. generateScript (generateLearningScript.ts)
// drops rounds whose intro/debut lacks target audio and counts the distinct
// PLAYABLE main-loop rounds (its `mainLoopRoundCount`). That count is the true
// "where INF PLAY starts" for THIS device on THIS content version. The
// course_round_index matview is NOT audio-filtered and goes stale (e.g. fra
// frozen at seed ~300 while the course is decomposed+audio'd out to 668), so it
// can report a boundary far short of the real consumable end — which is what
// kept fra/spa from ever entering INF PLAY. We set this ref at every
// handoff/resume/regen site, and prefer it over the matview below.
// Null until the first generateScript result lands (bootstrap uses the matview).
const liveMainLoopRoundCount = ref<number | null>(null)

// Number of main-loop rounds = the 0-based array index of the FIRST revival
// round in the full script (round N+1 in 1-based terms). The ONE boundary used
// everywhere. THREE-TIER prefer-live:
//   1. liveMainLoopRoundCount — the audio-aware count from the generated script
//      (authoritative once a handoff/resume/regen has run this session).
//   2. mainLoopMap.rounds.length — the course_round_index matview (bootstrap /
//      pre-handoff only; may be stale + isn't audio-filtered).
//   3. final-LEGO round index — load-time safety net before either is ready, so
//      entry/cadence degrade gracefully rather than reading 0.
const mainLoopBoundary = (): number => {
  const live = liveMainLoopRoundCount.value
  if (live !== null && live > 0) return live
  const mapLen = mainLoopMap.value?.rounds.length ?? 0
  if (mapLen > 0) return mapLen
  return (courseFinalLegoRef.value?.roundIndex ?? -1) + 1
}

// 0-based main-loop position of a LEGO BY ITS ID (its index in the ordered
// sequence), or -1 if it isn't a main-loop LEGO. Never a play counter.
const mainLoopIndexForLegoId = (legoId: string | null | undefined): number => {
  if (!legoId) return -1
  const rounds = mainLoopMap.value?.rounds
  if (!rounds) return -1
  return rounds.findIndex(r => r.legoId === legoId)
}

// Populate the canonical map once (idempotent; getOrFetchRoundMap is
// localStorage-cached and version-revalidated). Non-fatal: on failure the
// boundary helper falls back to the final-LEGO index.
const ensureMainLoopMap = async (): Promise<void> => {
  if (mainLoopMap.value && mainLoopMap.value.course_code === courseCode.value) return
  try {
    const map = await instantPlayback.getOrFetchRoundMap()
    if (map?.course_code === courseCode.value) mainLoopMap.value = map
  } catch (err) {
    console.warn('[LearningPlayer] canonical round-map fetch failed; boundary falls back to final-LEGO index:', err)
  }
}
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
// thicker synapses + mastery tier. Skipped cycles never fire
// `cycle_completed`, so we automatically only count what the learner
// heard.
// Agent A's composable takes no args — pulls supabase via inject. We pass
// learnerId + courseCode per call at the recordCyclePlay site below.
const pairingsTelemetry = usePairingsTelemetry()

// DB-01: throttle the mid-round cursor write to ~60s + flush on lifecycle
// boundaries. Per-cycle writes were ~5-6/min/learner; only same-sitting (<5min)
// resumes use current_cycle_index (longer gaps reset to the round intro), so 60s
// granularity is imperceptible. CANCELLED on round-advance: the round-advance
// write supersedes, so a stale old-round cursor must never flush after it.
let pendingCursor: { learnerId: string; courseId: string; idx: number } | null = null
let cursorFlushTimer: ReturnType<typeof setTimeout> | null = null
const flushCursor = () => {
  if (cursorFlushTimer) { clearTimeout(cursorFlushTimer); cursorFlushTimer = null }
  const p = pendingCursor
  pendingCursor = null
  if (!p || !progressStore?.value) return
  void activeProgressStore.value.updateCurrentCycle(p.learnerId, p.courseId, p.idx).catch(err => {
    console.warn('[LearningPlayer] Failed to persist current cycle:', err)
  })
}
const queueCursor = (learnerId: string, courseId: string, idx: number) => {
  pendingCursor = { learnerId, courseId, idx }
  if (!cursorFlushTimer) cursorFlushTimer = setTimeout(flushCursor, 60_000)
}
const cancelPendingCursor = () => {
  if (cursorFlushTimer) { clearTimeout(cursorFlushTimer); cursorFlushTimer = null }
  pendingCursor = null
}

// Diagnostic event log — captures play/pause/skip/stop taps + lap and
// commentary lifecycle. Persisted in player_events; surfaced in the
// admin user-detail page so user reports like "skip didn't work" can
// be diagnosed without DevTools.
// Stamp the RUNNING bundle's build sha on every event so telemetry can tell
// which build a user is actually on (incl. a stale SW-cached one). Mirrors the
// __BUILD_NUMBER__ pattern used in App.vue / SettingsScreen.vue.
const BUILD_VERSION = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev'
// Play-as-class audit trail: in class mode learnerId above IS the class's own
// id (attributed via the ssi-user-id cookie flip below), so stamp the driving
// staff member's AUTH UID (not their learner PK — same field class_sessions
// uses for teacher_user_id) on every event too — see usePlayerLog's actorUserId.
const playerLogActorUserId = computed(() => (props.classContext ? ((auth as any)?.userId?.value ?? null) : null))
const playerLog = usePlayerLog({ courseCode, learnerId, actorUserId: playerLogActorUserId, clientVersion: BUILD_VERSION })
const logEvent = playerLog.event

// Intro/presentation audio never reaches SimplePlayer's audio_failed path —
// a missing presentation clip isn't an error, it's an empty URL and a skipped
// phase. The round-building adapters report it instead, through a module-level
// sink so those pure functions stay free of Vue. Wired here because playerLog
// is what stamps course_code / session_id / user attribution on the row.
// Deduped per cycle id: a round can be rebuilt several times per session
// (tier-3 top-ups, INF PLAY refreshes) and the gap is a property of the
// CONTENT, so one report per cycle per session is the useful signal.
const introAudioMissingReported = new Set<string>()
setIntroAudioTelemetrySink((e) => {
  if (introAudioMissingReported.has(e.cycleId)) return
  introAudioMissingReported.add(e.cycleId)
  logEvent('intro_audio_missing', {
    legoId: e.legoId,
    cycleId: e.cycleId,
    cycleType: e.cycleType,
    tier: e.tier,
    source: e.source,
  })
})
onUnmounted(() => setIntroAudioTelemetrySink(null))
// Expose audio_failed banner state at top level so the template can
// use it directly (refs nested inside a plain object aren't auto-unwrapped).
const audioFailedBanner = simplePlayer.audioFailed

// Environment label shown inline next to the logo. Hostname-based so it
// can't drift from reality (no env var plumbing). null on production.
// envLabel (dev/staging/production host classifier) now lives in
// usePreviewTriggers.ts — shared with the in-app preview-trigger buttons in
// TesterFeedback's panel so both gate on the exact same hostname rule.

// Dev cheat flags (?l1=1 / ?pod=1): read once, gated on envLabel (same
// dev/staging-only host check that gates showDevReset — never production).
// Force useLayer1Scheduler / usePodLapScheduler's own boundary decision to
// fire at the first round boundary where it can ACTUALLY produce a lap,
// instead of waiting for real cadence — lets each layer be manually
// previewed without playing enough rounds to reach it naturally. Mirrors
// forceInterjectionsCheat's shape (below).
//
// Consumed (one-shot), not one-shot-on-the-FIRST-boundary: `podPreviewFired`
// / `l1PreviewFired` only flip true once a forced lap actually plays, so the
// cheat keeps retrying on every boundary until content is available. Fixed
// 2026-07-22 — the original design captured the round index on the literal
// first boundary regardless of outcome, which silently ate the one shot
// whenever that first boundary couldn't yet produce a lap: a scheduler not
// finished initializing (Supabase fetch still in flight), or — the common
// case — L1's own nextLap() requiring the FIRST seed to be fully introduced,
// which for a multi-LEGO seed 1 is round 3+, not round 1. See
// podCadenceFiresAtRound / l1PreviewForced for where these are consumed.
const forceLayer1PreviewCheat = (() => {
  try {
    const p = new URLSearchParams(window.location.search)
    return !!envLabel.value && p.has('l1')
  } catch { return false }
})()
const forcePodPreviewCheat = (() => {
  try {
    const p = new URLSearchParams(window.location.search)
    return !!envLabel.value && p.has('pod')
  } catch { return false }
})()
// ?podview=1: instant pod preview — hijacks every play tap (handleResume)
// into a direct pod-lap loop via startPodPreviewLap, bypassing the main
// round pipeline entirely instead of waiting for a round boundary like
// ?pod=1 above. Same dev/staging-only envLabel gate.
const podPreviewMode = (() => {
  try {
    const p = new URLSearchParams(window.location.search)
    return !!envLabel.value && p.has('podview')
  } catch { return false }
})()
let podPreviewFired = false
let l1PreviewFired = false
// console.warn, not .log — production/staging/dev-alias builds strip
// console.log/info/debug (vite.config.js esbuild.pure), so a plain .log here
// is invisible in exactly the field captures used to debug this cheat. warn
// survives. Arm-time line lets a report immediately distinguish "the cheat
// never armed" (param/env-gate problem) from "armed but hasn't fired yet"
// (content/timing problem) — see the FIRED warns at the actual play sites.
if (forcePodPreviewCheat) console.warn('[LearningPlayer] ?pod=1 preview cheat ARMED — forcing at the first boundary that can produce a lap')
if (forceLayer1PreviewCheat) console.warn('[LearningPlayer] ?l1=1 preview cheat ARMED — forcing at the first boundary that can produce a lap')
if (podPreviewMode) console.warn('[LearningPlayer] ?podview=1 instant pod preview ARMED — next play tap starts a pod lap directly')

// The orange ↻ reset button is a DEV-only rapid-iteration tool — too loud for
// the staging soak build the external team sees. The env BADGE still shows on
// staging (it labels the deploy); only the button is dev-host-only. Tom
// 2026-05-30.
const showDevReset = computed(() => envLabel.value === 'DEV')

// Dev/staging-only one-tap reset, in the player header (there's no separate
// home screen in the live flow — rapid testing happens here). Routes to
// App.vue's ?reset=1 handler: clears localStorage/IndexedDB/caches,
// unregisters the SW, reloads to the latest build. Gated by envLabel, so it
// shows on dev/staging and is hidden on production — same rule as the badge.
const resetApp = async () => {
  // DEV refresh: ditch the stale service worker (the thing that serves old
  // chunks after a deploy — the cause of the MIME/stale-chunk errors) and
  // reload to the latest build. We deliberately do NOT nuke IndexedDB or the
  // audio Cache API — those are hundreds of MB of offline audio, content-
  // addressed (so they don't go stale on a code deploy), and clearing them is
  // what made the old ?reset=1 path take ages / appear to hang. The full wipe
  // stays available via the ?reset=1 URL for genuine corrupted-state recovery.
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(regs.map(r => r.unregister()))
  } catch { /* best-effort */ }
  window.location.reload()
}

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

// M3 (pull-consistency map): position is DERIVED from the engine once it
// exists — never a writable mirror synced by watchers. Before engine init the
// position lives in a single pre-engine resume intent, written only by the
// resume/preview/reset paths and the legacy useCyclePlayback system (which
// never initializes the engine, so its manual advancement stays authoritative
// on that path). After init, position derives from the engine only; the
// read-only computeds make a scattered post-init writer a compile error.
const preEngineRoundIndex = ref(0)
const preEngineItemInRound = ref(0)
const currentRoundIndex = computed(() =>
  simplePlayer.isInitialized.value ? simplePlayer.roundIndex.value : preEngineRoundIndex.value)
const currentItemInRound = computed(() =>
  simplePlayer.isInitialized.value ? simplePlayer.cycleIndex.value : preEngineItemInRound.value)
// isPlaying = PULL-CONSISTENT derivation of the engine's own state — never a
// writable mirror. The old design (a ref synced by an edge-triggered watcher
// PLUS ~7 scattered manual assignments) could drift from the audio whenever a
// manual write and a watcher flush interleaved (Jonathan's staging report
// 2026-07-28: engine mid-cycle, transport showing PLAY / 0:00 / no gap ring /
// no voice-2 text until the next round boundary happened to toggle the engine
// and re-fire the watcher). A computed cannot miss an edge: it always reads
// the engine's CURRENT state. Non-engine audio (welcome / introduction / pod
// lap / commentary) and the pre-play preparing window are surfaced through
// isAudioPlaying below — the transport-facing signal.
const isPlaying = computed(() => simplePlayer.isPlaying.value)

// Furthest round the learner has ever reached, with its lego companion.
// Read once on resume; the trigger keeps the DB ceiling in sync as the
// cursor moves. Drives the "skip to round N" choice in the resting state
// when the cursor is currently behind this ceiling.
const highestCompletedRoundIndex = ref<number | null>(null)
const highestCompletedLegoId = ref<string | null>(null)
/** Flips true once the saved-progress read for this learner+course has RESOLVED
 *  — which is what lets "this learner has never played" be told apart from
 *  "their progress hasn't loaded yet". Both look like null otherwise, and
 *  acting on the second would hand an existing learner the new-learner default.
 *  Consumed only by applyNewLearnerModeDefault() further down. */
const progressHistoryResolved = ref(false)
// Cursor LEGO ID from the enrollment row (last_completed_lego_id).
// Reactive copy of the DB value — the canonical "where is the cursor"
// signal for the resting-state journey-bar comparison. DON'T derive
// this from simplePlayer.currentRound: that's null/stale during the
// resting state, and an INF PLAY round's legoId is a random USE that
// doesn't represent pedagogical position.
const lastCompletedLegoIdRef = ref<string | null>(null)
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
    // A guest has no server-side history by definition — that IS a resolved
    // "never played", not a pending read, so the mode default may act on it.
    if (isGuestLearner.value) { progressHistoryResolved.value = true; return }
    try {
      const saved = await loadSavedProgress()
      if (saved) {
        highestCompletedRoundIndex.value = saved.highestCompletedRoundIndex ?? null
        highestCompletedLegoId.value = saved.highestCompletedLegoId ?? null
        lastCompletedLegoIdRef.value = saved.lastCompletedLegoId ?? null
        savedCurrentCycleIndex.value = saved.currentCycleIndex ?? 0
        savedLastPracticedAt.value = saved.lastPracticedAt ?? null
        // Cursor-only model (2026-07-04): infinite-play is derived from the
        // cursor (no is_new LEGO remains beyond it), not read from the
        // enrollment.current_mode column.
        currentMode.value = (await hasReachedInfinitePlay(saved.lastCompletedLegoId, courseCode.value)) ? 'infplay' : 'main'
        infplayRoundIndex.value = saved.infplayRoundIndex ?? 0
      } else {
        highestCompletedRoundIndex.value = null
        highestCompletedLegoId.value = null
        lastCompletedLegoIdRef.value = null
        savedCurrentCycleIndex.value = 0
        savedLastPracticedAt.value = null
        currentMode.value = 'main'
        infplayRoundIndex.value = 0
      }
      progressHistoryResolved.value = true
    } catch { /* silent */ }
  },
  { immediate: true }
)

// Effect bridge on the engine's round advance (position itself is derived
// above — this watcher only drives imperative sinks: persistence + prefetch).
watch(() => simplePlayer.roundIndex.value, (idx) => {
  // Persist the live cursor on every round advance, at cycle 0 (the
  // "position, not completion" model). The positionInitialized guard is
  // what prevents this from firing during the resume landing: the bootstrap
  // jumpToRound happens BEFORE positionInitialized flips true, so the cursor
  // we resumed onto is never re-stamped and its mid-round cycle never wiped.
  // The init watcher below does the first authoritative write.
  if (positionInitialized.value) persistLivePositionToDb(0)
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
          const mainLoopCount = mainLoopBoundary()
          const refreshed = infPlayCyclesToRounds(
            instantPlayback.infPlayCycles.value as any,
            mainLoopCount,
            currentTargetSpeedConfig(),
          )
          if (refreshed.length > totalLoaded) {
            // Diff by roundNumber against the engine's truth — slice(totalLoaded)
            // assumes the loaded rounds are `refreshed`'s head, which breaks
            // whenever the queue is a window at the cursor (same shear as the
            // expandScript bug, fixed 2026-07-23).
            const newRounds = refreshed.filter((r) => !simplePlayer.hasRound(r.roundNumber)) as any
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
          currentTargetSpeedConfig(),
          MODE_NEUTRAL_REPEATS,
        )
        // Diff by roundNumber against the engine's truth. Never
        // slice(totalLoaded): the loaded rounds are a window at the resume
        // cursor, not `refreshed`'s head — slicing here dropped the early
        // rounds and sheared every index-keyed read (same bug family as the
        // expandScript fix, 2026-07-23).
        if (refreshed.length > totalLoaded) {
          simplePlayer.appendRounds(refreshed.filter((r) => !simplePlayer.hasRound(r.roundNumber)) as any)
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
// (isPlaying, currentRoundIndex and currentItemInRound are computeds deriving
// directly from simplePlayer — the old edge-triggered mirror watchers that
// lived here are gone by design.)

// Backwards compatibility aliases
const effectiveRounds = loadedRounds
const cachedRounds = loadedRounds  // Legacy alias

const scriptBaseOffset = ref(0)  // Base offset for script loading

// ============================================
// ENTITLEMENT / PAYWALL
// ============================================
const entitlementComposable = useEntitlement()
const showPaywall = ref(false)

// The single checkout trigger (Paddle £15/mo Premium). Used by the in-player
// paywall overlay; the money-capture backend is untouched.
const { startCheckout, isOpeningCheckout } = useCheckout()
function handleSubscribe() {
  startCheckout({ courseCode: courseCode.value || null })
}

// "Maybe later" / backdrop click / Escape all do the same thing: dismiss the
// wall and rewind to the start of the free preview. One function so the three
// entry points can't drift.
function dismissPaywall() {
  showPaywall.value = false
  simplePlayer.jumpToRound(0)
  simplePlayer.pause()
}

function onPaywallKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') dismissPaywall()
}

watch(showPaywall, (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    document.addEventListener('keydown', onPaywallKeydown)
  } else {
    document.removeEventListener('keydown', onPaywallKeydown)
  }
})

onUnmounted(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('keydown', onPaywallKeydown)
})

/**
 * Central access guard — the ONE place every jump / skip / resume site routes a
 * target seed through before moving the play cursor there. Returns true when the
 * move is allowed; when blocked (premium non-subscriber past the preview limit),
 * it pauses playback, raises the paywall, and returns false so the caller bails.
 *
 * Reuses canAccessSeed / PREMIUM_PREVIEW_MAX_SEED — the limit is never
 * reinvented here. Free / community courses and subscribers always pass.
 */
function gateSeed(targetSeedNumber: number | null | undefined): boolean {
  if (!props.course) return true
  if (typeof targetSeedNumber !== 'number' || !Number.isFinite(targetSeedNumber)) return true
  if (entitlementComposable.canAccessSeed(props.course, targetSeedNumber)) return true
  // Blocked — don't move; hold the learner at the wall.
  try { simplePlayer.pause() } catch { /* engine may not be ready */ }
  showPaywall.value = true
  return false
}

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

// Mirror the offline-entitlement shape into shared state so ModeTray can nudge
// "Free offline for 30 days" on the Offline row for non-payers (no prop-drill).
// Offline download itself is open to all now; this only flags the TRIAL state.
// Re-runs when the subscription / entitlements / course change.
watchEffect(() => {
  offlineTrial.value = !!props.course && !entitlementComposable.offlineRenews(props.course)
})

// ============================================
// SIMPLE PLAYER EVENT SUBSCRIPTIONS
// ============================================

// Phase-edge SIDE EFFECTS only (telemetry, VAD marks, transition flags).
// The UI phase STATE no longer flows through here — currentPhase derives
// from simplePlayer.phase directly (M2, pull-consistency map); the old
// pendingPhase relay ref is gone.
simplePlayer.onPhaseChanged((phase) => {
  // Handle phase-specific UI updates
  if (phase === 'prompt') {
    isTransitioningItem.value = false
    clearPreparingState()
  }

  // ── Comprehensive audio telemetry ──
  // SimplePlayer reuses one Audio element so at most one audio plays at
  // a time; logging on phase transitions captures every audio start
  // regardless of cache vs network. Batches via usePlayerLog (5s + 10-
  // event flush + pagehide beacon) — complete, not continuous.
  const cycle = simplePlayer.currentCycle.value
  if (!cycle) return

  // ── VAD speech-timing lifecycle (SimplePlayer path) ──
  // Before this wiring (2026-07-28) the analyzer was only driven by the
  // legacy handleCycleEvent path, so under SimplePlayer no timing cycle
  // ever ran: lastTimingResult stayed null, and the latency feed into
  // adaptationEngine.recordCycle (and everything downstream, incl. the
  // cycle_prosody event) was dead. Speaking cycles only — cycles with no
  // pause (intro/listening) never open a timing window, and the analyzer
  // silently ignores phase marks while inactive.
  if (isAdaptationActive.value) {
    if (phase === 'prompt') {
      // A dangling window from a skipped cycle is discarded, never
      // attributed to this one (mis-attribution would poison the corpus).
      if (timingAnalyzer.value?.isAnalyzing()) timingAnalyzer.value.reset()
      if ((cycle.pauseDuration ?? 0) > 0 && cycle.legoId) startTimingCycle()
    } else if (phase === 'pause') {
      markPhaseTransition('PROMPT_END')
      markPhaseTransition('PAUSE')
    } else if (phase === 'voice1') {
      markPhaseTransition('VOICE_1')
    } else if (phase === 'voice2') {
      markPhaseTransition('VOICE_2')
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
    // moment the cycle begins playing — signal for "did the per-cycle
    // resolver / prefetchNextCycle warm have time to land this audio
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
    // Accumulate locally; flushed in one batch on pause/background/unmount.
    // record_lego_pairings now takes per-pair counts → ~150 RPCs/session → ~1-3.
    pairingsTelemetry.recordCyclePlay({
      learnerId: learnerId.value,
      courseCode: courseCode.value,
      legoIds: firedLegoIds,
    })
  }

  // Close the VAD timing window for the cycle that just finished. Under
  // SimplePlayer this is the ONLY place a window closes with a result, so
  // cycleTiming is this cycle's own measurement by construction (a window
  // left open by a skip is reset at the next prompt, never read here).
  let cycleTiming = null
  if (isAdaptationActive.value && timingAnalyzer.value?.isAnalyzing()) {
    cycleTiming = endTimingCycle(cycle.target1DurationMs ?? 2000)
  }

  // cycle_prosody (VAD phase 1, founder ruling 2026-07-28): the append-only
  // longitudinal row — learner + phrase identity + timestamp + latency +
  // learner-side envelope — that nothing else persists (learner_lego_metrics
  // is a ring of 20 that discards per-cycle identity). audioId is the join
  // key into course_audio_envelope: once the model-envelope table is
  // populated (dashboard-repo pipeline, WP-7b), the prosody-match measure is
  // computable retroactively for every row logged here — independent of the
  // stage2_enabled adaptation flag. Voiced speaking cycles only. If
  // player_events ever gains a pruning window, cycle_prosody rows are exempt.
  if (cycleTiming?.speech_detected && cycle.legoId && cycle.target?.text) {
    const voice1Match = cycle.target?.voice1Url?.match(/\/api\/audio\/([^?/]+)/)
    logEvent('cycle_prosody', {
      cycleId: cycle.id,
      cycleType: cycle.type ?? null,
      legoId: cycle.legoId,
      seedId: cycle.seedId ?? null,
      audioId: voice1Match ? voice1Match[1] : null,
      responseLatencyMs: cycleTiming.response_latency_ms,
      learnerDurationMs: cycleTiming.learner_duration_ms,
      durationDeltaMs: cycleTiming.duration_delta_ms,
      speechStartMs: cycleTiming.speech_start_ms,
      speechEndMs: cycleTiming.speech_end_ms,
      startedDuringPrompt: cycleTiming.started_during_prompt,
      stillSpeakingAtVoice1: cycleTiming.still_speaking_at_voice1,
      peakEnergyDb: cycleTiming.peak_energy_db,
      averageEnergyDb: cycleTiming.average_energy_db,
      // Intermediate features, not just derived scalars (founder steer
      // 2026-07-28): the contour is the peak-normalized energy envelope the
      // scalars are computed FROM, so any future prosody metric can be
      // recomputed over historical rows. ~500 bytes at the 128-point cap.
      envelope: cycleTiming.envelope
        ? {
            durationMs: cycleTiming.envelope.durationMs,
            peakCount: cycleTiming.envelope.peakCount,
            peakToMeanRatio: cycleTiming.envelope.peakToMeanRatio,
            meanPeakWidthMs: cycleTiming.envelope.meanPeakWidthMs,
            sampleCount: cycleTiming.envelope.sampleCount,
            weight: cycleTiming.envelope.weight,
            contour: cycleTiming.envelope.contour ?? null,
            contourGridMs: cycleTiming.envelope.contourGridMs ?? null,
          }
        : null,
      extractorVersion: ENVELOPE_EXTRACTOR_CONSTANTS.version,
      playbackSpeed: cycle.playbackSpeed ?? 1.0,
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

  // Envelope evidence (adaptation v2 WP-8, stitched here per WP-3): only
  // when stage 2 is on, the model cache exists (live Supabase client), the
  // VAD captured a usable envelope this cycle, and we can resolve the
  // cycle's target1 audio id. Async (a batch fetch may be needed) and
  // fire-and-forget, same pattern as `learningSession.recordCycleComplete`
  // below — never blocks the next cycle.
  if (
    adaptationV2Config.value.stage2_enabled &&
    envelopeMetadataCache.value &&
    cycle.legoId &&
    lastTimingResult.value?.envelope
  ) {
    const voice1Match = cycle.target?.voice1Url?.match(/\/api\/audio\/([^?/]+)/)
    const audioId = voice1Match ? voice1Match[1] : null
    if (audioId) {
      const legoId = cycle.legoId
      const cycleId = cycle.id
      const learnerEnvelope = lastTimingResult.value.envelope
      const occurredAtMs = performance.now()
      envelopeMetadataCache.value.fetchBatch([audioId]).then(() => {
        recordEnvelopeEvidence({
          sink: sharedEvidenceAggregator,
          cache: envelopeMetadataCache.value!,
          legoId,
          audioId,
          learnerEnvelope,
          cycleId,
          occurredAtMs,
        })
      }).catch(err => {
        console.warn('[LearningPlayer] Envelope evidence fetch failed (stage-2 no-op this cycle):', err)
      })
    }
  }

  resonatingNodes.value = []

  // Trigger reward animation
  const { points, bonusLevel } = calculateCyclePoints()
  const multipliedPoints = Math.round(points * sessionMultiplier.value)
  sessionPoints.value += multipliedPoints
  triggerRewardAnimation(multipliedPoints, bonusLevel)

  totalCycles.value++

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
  // resumes from the cycle the learner was on instead of restarting the
  // whole round. The cycle that JUST completed is N; the resume point is
  // N+1 (next cycle to play).
  //
  // Last cycle of the round: do NOT write N+1 — that's out of bounds for
  // THIS round (the next cycle to play lives in the next round). The
  // round-advance watcher (persistLivePositionToDb) writes the next round
  // at cycle 0 instead. Skipping here avoids persisting an out-of-range
  // cycle that would make a close-in-the-gap resume replay the last cycle.
  // (Under the old model saveRoundProgress reset cycle to 0 on completion;
  // that reset now lives in the round-advance write.)
  if (!isGuestLearner.value && progressStore?.value && learnerId.value && courseCode.value
      && currentMode.value !== 'infplay') {
    const nextCycleIdx = simplePlayer.cycleIndex.value + 1
    const roundCycleCount = simplePlayer.currentRound.value?.cycles?.length ?? 0
    if (nextCycleIdx < roundCycleCount) {
      queueCursor(learnerId.value, courseCode.value, nextCycleIdx)
    }
  }
})

// Round completed - save progress and update current LEGO ID
simplePlayer.onRoundCompleted((round) => {
  // DB-01: discard the just-finished round's pending mid-round cursor before
  // the round-advance write below supersedes it. Without this, a stale 60s
  // timer could flush an old-round cycle index AFTER the new round's cursor.
  cancelPendingCursor()

  const completedRoundIndex = simplePlayer.roundIndex.value
  logEvent('round_complete', {
    roundIndex: completedRoundIndex,
    legoId: round.legoId,
    seedId: round.seedId,
  })

  // Synchronously pause if a pod is about to fire on this boundary (a real
  // cadence fire, or a still-live ?pod=1 preview — podCadenceFiresAtRound
  // covers both and is safe to call speculatively: it only returns true for
  // the forced case once podScheduler is actually initialized, so this can
  // never strand the player paused with nothing to play). handleRoundBoundary
  // is async and runs on a later microtask — by the time its own pause()
  // lands, simplePlayer's orchestrator may have already started the next
  // round's prompt audio, causing the pod intro to overlap with main-player
  // audio. Pausing here, in the same tick as
  // the round-completed event, beats that race.
  const willFirePod = !beltJustEarned.value
    && podCadenceFiresAtRound(completedRoundIndex)
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
      // In INF PLAY skip the belt write entirely — the belt is the locked red
      // ∞ (beltCssVars red override) and visualLegoIdForRound falls back to the
      // random USE legoId for guests (no main-loop ceiling recorded), which is
      // exactly the cycle-to-cycle belt flip Tom flagged.
      // (playingSeedNumber itself derives from the engine via beltAnchorSeed —
      // M9 — so only the lego-id signal is pushed here.)
      // Round-shape signal, not the mode: offline belt-held recycle draws the
      // same random USE phrases, so the same belt-flip would happen. Suppress.
      if (!isRecycledRoundPlayback.value) {
        const visualLegoId = visualLegoIdForRound(round)
        if (visualLegoId && beltProgress.value?.setCurrentLegoId) {
          beltProgress.value.setCurrentLegoId(visualLegoId)
        }
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
  // attempt=1 is a TRANSIENT blip that we silently retry (most recover) — logging
  // it as 'audio_failed' inflated the failure metric with false alarms (this is
  // what made e.g. Armenian look 27% broken when it was one flaky session). Log
  // the pre-retry blip as 'audio_retry' (diagnostic) and reserve 'audio_failed'
  // for the genuine post-retry halt (attempt=2, needs-gesture, or no retry url).
  const isTransientRetry = event.reason === 'play-error' && event.attempt === 1
  logEvent(isTransientRetry ? 'audio_retry' : 'audio_failed', {
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
  // Offline: no network to expand, so loop the already-cached content —
  // offline must NEVER end at the tail. The engine reaches THIS handler
  // directly when a synchronous skip-burst past the ~30-min cached audio
  // span outruns the async pre-tail expansion watcher (which carries the
  // SAME guard at EXPANSION_THRESHOLD, line ~2445). Without this branch,
  // offline play stops with a paused summary instead of recycling forever
  // — the "reviewed for a while, then stopped" bug. Tom 2026-05-30.
  if (offlinePlaybackActive()) {
    // FORWARD FIRST. Unexpected offline keeps progressing the course from the
    // cache; recycling is what happens when the cache runs out of forward
    // material, not the first thing we reach for. Tom 2026-08-15.
    const forward = await appendForwardFromCacheOffline()
    if (forward > 0) {
      simplePlayer.resume()
      return
    }
    const looped = appendCachedLoopForOffline()
    if (looped > 0) {
      console.log(`[Offline] session_complete reached offline — looped ${looped} cached rounds, resuming`)
      simplePlayer.resume()
      return
    }
    // Nothing survived the persistent-audio filter (empty cached set). Do NOT
    // fall through to expandScript: offline that is a full Supabase course
    // walk with no network budget on it, and it can only fail — it just takes
    // several seconds to find out, with "Warming up the synapses..." on screen
    // the whole time. That wait is most of the ~5s Tom saw before the app
    // dropped him on an infinite-play sentence, 2026-08-15. Cutting a network
    // await that cannot succeed costs nothing and saves all of it.
    if (wrapInfPlayAtTail()) return
    sessionEnded.value = true
    showPausedSummary()
    return
  }
  // Infinite play / main loop: the course should never end. expandScript()
  // GROWS the revival tail by a batch in INF PLAY (genuinely infinite — fresh
  // deterministic rounds), or loads more main-loop rounds; then resume.
  const added = await expandScript()
  if (added > 0) {
    simplePlayer.resume()
    return
  }
  // Generation produced nothing (transient online failure; offline was handled
  // above). Last resort in INF PLAY: wrap to the first revival round so play
  // never dead-ends instead of dropping to the paused summary.
  if (wrapInfPlayAtTail()) return
  sessionEnded.value = true
  showPausedSummary()
})

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
//
// Play-as-class (owner ruling 2026-07-16): the class IS a first-class
// learner now, so this ratchet applies to it exactly like a human learner —
// the class genuinely progresses through the course between lessons, and
// "resume where the class left off" needs a real ceiling. learnerId already
// resolves to the class's own learner id in class mode, and
// activeProgressStore routes the write through the server-mediated
// class-progress endpoint — no more blanket skip.
watch(
  () => simplePlayer.currentRound.value?.legoId,
  (newLegoId, prevLegoId) => {
    if (!newLegoId || newLegoId === prevLegoId) return
    if (isGuestLearner.value) return
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
// Phase 1 — instant: bootstrap fetches one whole round (~25 cycles, incl. its
//   spaced review) via /api/courses/:code/cycles
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
//   The per-cycle resolver (lands the playing cycle into
//   AudioCache.persistent) + SimplePlayer.prefetchNextCycle priority
//   hints cover the playback path inside that envelope.
//
// Explicit full-course caching for offline use is provided by
// driving mode's chunked prefetch and the future paid "Download for
// offline" opt-in — both opt-in, both bounded by maxBytes.
//
// Function kept as a no-op (rather than deleted) so the call site
// stays in tree-shake-safe shape for the same reasons documented on
// `warmUpInfPlayRoundsBackground`.
// KEPT: deliberate no-op + greppable handle for a possible opt-in
// offline-download revival (see docblock above).
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

// (The currentCycle sync watcher that lived here is gone by design — M1,
// pull-consistency map. The displayed cycle now DERIVES from
// simplePlayer.currentCycle in a computed further down, so the text the
// learner reads and the audio the engine plays can never come from
// different cycles.)

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

// Course-wide target_text lookup, loaded once per course mount. The
// round-derived maps above only contain LEGOs whose rounds are in
// loadedRounds — INFPLAY USE phrases reference LEGOs anywhere in the
// course. decomposePhrase needs every known-vocab text to bind tokens
// correctly, so we load all target_text + target_text_native rows once
// per course mount. (The course-wide KNOWN-text map that used to load
// alongside these fed only the hero salient highlight, removed with the
// uniform-typography pass, Tom 2026-06-07.)
const globalLegoTargetTextMap = ref<Map<string, string>>(new Map())
const globalLegoTargetTextNativeMap = ref<Map<string, string>>(new Map())

async function loadGlobalLegoTexts() {
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
      .select('lego_id, target_text, target_text_roman')
      .eq('course_code', code)
    if (error) {
      console.warn('[LearningPlayer] Failed to load global lego texts:', error.message)
      return
    }
    const targetMap = new Map<string, string>()
    const targetNativeMap = new Map<string, string>()
    for (const row of (data || [])) {
      if (!row.lego_id) continue
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

    globalLegoTargetTextMap.value = targetMap
    globalLegoTargetTextNativeMap.value = targetNativeMap
    console.log(`[LearningPlayer] Loaded ${targetMap.size} legos + ${(compData || []).length} component atoms for ${code}`)
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

// Current phrase's LEGO blocks for the assembly view.
// Raw tiling — ALWAYS segmented on the ROMANISED script, the side that
// decomposes cleanly (word spaces / syllables). currentPhraseLegoBlocks below
// turns this into the native-primary display per script: pinyin-syllable tiles
// (Mandarin), word-pair tiles (spaced scripts), or native-paired-onto-romaji
// tiles (Japanese/Thai). For Latin-script courses the romanised form IS the
// only form, so this passes through unchanged.
const currentPhraseLegoBlocksRaw = computed<LegoBlock[]>(() => {
  const cycle = simplePlayer.currentCycle.value
  if (!cycle) return []
  const useNative = false
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
        // Strategy 0 (authoritative): the AUTHORED word mapping (Tom,
        // 2026-08-13). One tile per target word in the target's own order,
        // each chunk's literal known text centred under the words it covers —
        // "the literal builds in the known language that 'map' to the correct
        // order in the target language". This is a re-SOURCING, not a special
        // case: where nobody has mapped the row, the single whole-LEGO tile
        // below is unchanged and componentisation still glosses it downstream.
        const authored = tilesFromGlossSegments(
          targetText,
          (cycle as any).glossSegments,
          ({ text, index, glossGroup, known }) => ({
            id: `${legoId}_gs${index}`,
            targetText: text,
            glossGroup,
            isSalient: true,
            ...(known ? { knownText: known } : {}),
          }),
        )
        if (authored) return authored
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

      // Strategy 0 (authoritative): the backend (Popty) computes the tiling at
      // content-generation time — which token belongs to which LEGO, the salient
      // anchored on the parent LEGO, ghost residue for inserted particles — and
      // serves it verbatim on `decomposition`. When present we render those blocks
      // DIRECTLY rather than re-deriving by runtime string-matching, which is the
      // fragile path that mis-aligned short LEGOs and dropped the salient. Guard:
      // only trust the served blocks when they exactly reassemble the displayed
      // target (whitespace-normalised) — otherwise (e.g. roman-script display vs
      // native-script decomposition) fall through to the runtime cascade below.
      const served = (cycle as any).decomposition as
        | Array<{ legoId: string | null; target: string; known: string; isGhost: boolean; isSalient?: boolean }>
        | undefined
      if (Array.isArray(served) && served.length > 0) {
        const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
        if (norm(served.map((b) => b.target).join('')) === norm(targetText)) {
          const blocks = served.map((b, i) => ({
            id: b.legoId || `ghost_${i}`,
            targetText: b.target,
            ...(b.known && !b.isGhost ? { knownText: b.known } : {}),
            isSalient: !!b.isSalient || (!!b.legoId && b.legoId === salientId),
          }))
          // Safety: never emit a fully-faded sentence. If nothing is marked
          // salient (stale data), fall through to the runtime cascade.
          if (blocks.some((b) => b.isSalient)) return blocks
        }
      }

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
      // No salient match found → show the WHOLE phrase at full emphasis, NOT
      // faded. The faded "context" styling only reads correctly next to a bold
      // salient; with no salient it greys the entire sentence and nothing is
      // the focus (the "looks dead" state). Tom 2026-06-02 row-back.
      return [{ id: salientId || 'phrase', targetText, isSalient: true }]
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

  // Fallback: if decomposition fails, show the full phrase as a single tile at
  // FULL emphasis (not faded) — same reason as above: a lone non-salient block
  // greys the whole sentence with nothing to contrast against. The audio still
  // plays — the learner must see what they hear.
  if (result.length === 0 && tileText) {
    return [{ id: salientLegoId || 'phrase', targetText: tileText, isSalient: true }]
  }
  return result
})

// Mandarin (target lang zho): a LEGO can be a whole clause, so we tile by
// PINYIN WORD instead of by LEGO and slice the hanzi to match each word — the
// pinyin word-spacing IS the parseable chunking. Other languages keep their
// LEGO-based tiling (a multi-word LEGO is a meaningful unit there and the words
// are already space-separated).
const isMandarin = computed(() => (courseCode.value?.split('_')[0] || '') === 'zho')

// Native-script text(s) of the salient LEGO(s) on the current cycle, used to
// bold the matching pinyin-word tiles. Prefer the served decomposition's
// salient block(s); fall back to the salient LEGO's native text.
function salientNativeTexts(cycle: any): string[] {
  const dec = cycle?.decomposition
  if (Array.isArray(dec)) {
    const s = dec.filter((b: any) => b?.isSalient && b?.target).map((b: any) => b.target as string)
    if (s.length > 0) return s
  }
  const id = cycle?.legoId || currentRound.value?.legoId
  if (id) {
    const t = legoTargetTextNativeMap.value.get(id) || globalLegoTargetTextNativeMap.value.get(id)
    if (t) return [t]
  }
  return []
}

// Merged native LEGO map (legoId → native script), used by the old-browser
// fallback that pairs native onto the romaji tiling.
const legoNativeById = computed<Map<string, string>>(() => {
  const m = new Map<string, string>(globalLegoTargetTextNativeMap.value)
  for (const [id, text] of legoTargetTextNativeMap.value.entries()) m.set(id, text)
  return m
})

// native word → romanisation dictionary, built from the course's own LEGOs and
// component atoms (native and roman maps share legoId / atom-synth-id keys). The
// device-segmentation path uses this to fill a tile's ruby when the phrase's
// romanisation doesn't split 1:1 with the segmented native words.
const nativeRomajiDict = computed<Map<string, string>>(() => {
  const m = new Map<string, string>()
  const add = (native: Map<string, string>, roman: Map<string, string>) => {
    for (const [id, nat] of native.entries()) {
      const rom = roman.get(id)
      if (nat && rom && !m.has(nat)) m.set(nat, rom)
    }
  }
  add(globalLegoTargetTextNativeMap.value, globalLegoTargetTextMap.value)
  add(legoTargetTextNativeMap.value, legoTargetTextMap.value)
  return m
})

// Spaceless scripts → BCP-47 locale for the device word segmenter.
const SEGMENTER_LOCALE: Record<string, string> = { jpn: 'ja', tha: 'th' }

// Intro/debut: attach the known-language gloss UNDER the tiles (Tom
// 2026-06-07). The tiles and ruby are IDENTICAL to how the LEGO renders in
// a regular phrase — the gloss is purely additive, the "cosa|azul /
// thing|blue" matching that makes a multi-piece LEGO's componentisation
// visible in BOTH languages on first presentation.
//
// Matching is order-independent and claim-based (component phrases come
// back in arbitrary DB order): each declared component target — native and
// roman variants both considered, longest first so a short component can't
// steal a longer one's prefix — claims the earliest unclaimed contiguous
// tile run whose concatenated text equals it (whitespace/punctuation-
// normalised). Tiles get `glossGroup` ids so LegoAssembly can centre each
// gloss under its whole run; structural particles keep their empty known
// by design (claimed run, no gloss). Components that don't match cleanly
// just don't gloss — tiles are NEVER reshaped, merged, or re-tiled.
function attachIntroGlosses(tiles: LegoBlock[], cycle: any): LegoBlock[] {
  const t = (cycle?.type || '').toLowerCase()
  if (t !== 'intro' && t !== 'debut') return tiles
  if (!tiles || tiles.length === 0) return tiles
  // The AUTHORED mapping wins wherever one exists (Tom, 2026-08-13). It only
  // applies when the tiling in hand is one-tile-per-target-word — the columns
  // the author actually segmented against. A romanised or device-segmented
  // tiling with a different count is not those columns, so it falls through to
  // the claim-match below rather than pairing chunks onto the wrong tiles.
  const authored = (cycle as any)?.glossSegments as GlossSegment[] | undefined
  if (Array.isArray(authored) && authored.length > 0
      && authored.reduce((n, s) => n + (s?.span || 0), 0) === tiles.length) {
    const out = tiles.map((x) => ({ ...x }))
    let col = 0
    authored.forEach((seg, gi) => {
      for (let k = 0; k < seg.span; k++, col++) {
        out[col].glossGroup = gi
        if (k === 0 && seg.known) out[col].knownText = seg.known
      }
    })
    return out
  }
  const norm = (s: string) =>
    (s || '').replace(/\s+/g, '').replace(/[。、，．・「」『』！？.,!?…'’"“”]/g, '')
  const knownWhole = cycle?.known?.text || ''
  if (tiles.length === 1) {
    return knownWhole ? [{ ...tiles[0], knownText: knownWhole, glossGroup: 0 }] : tiles
  }
  // Union of both component variants: the native list matches the tiles'
  // native targetText, but components whose roman form is NULL fall back
  // to native text in the roman list (e.g. zho 你) and only appear there.
  const comps = ([] as Array<{ known: string; target: string }>).concat(
    (cycle?.componentsNative as any) || [],
    (cycle?.components as any) || [],
  )
  if (comps.length === 0) return tiles
  const out = tiles.map((x) => ({ ...x }))
  const claimed: boolean[] = new Array(out.length).fill(false)
  const runs: Array<{ start: number; end: number; known: string }> = []
  const ordered = comps
    .filter((c) => norm(c?.target))
    .sort((a, b) => norm(b.target).length - norm(a.target).length)
  for (const comp of ordered) {
    const target = norm(comp.target)
    for (let start = 0; start < out.length; start++) {
      if (claimed[start]) continue
      let acc = ''
      let i = start
      while (i < out.length && !claimed[i] && acc.length < target.length) {
        acc += norm(out[i].targetText)
        i++
      }
      if (acc !== target) continue
      for (let k = start; k < i; k++) claimed[k] = true
      runs.push({ start, end: i - 1, known: comp.known || '' })
      break
    }
  }
  if (runs.length === 0) return tiles
  // Assign group ids in tile order: claimed runs share an id; every
  // unclaimed tile is its own group. Gloss rides on the run's first tile.
  runs.sort((a, b) => a.start - b.start)
  let gid = 0
  let ri = 0
  for (let i = 0; i < out.length; ) {
    if (ri < runs.length && runs[ri].start === i) {
      for (let k = runs[ri].start; k <= runs[ri].end; k++) out[k].glossGroup = gid
      if (runs[ri].known) out[runs[ri].start].knownText = runs[ri].known
      i = runs[ri].end + 1
      ri++
    } else {
      out[i].glossGroup = gid
      i++
    }
    gid++
  }
  return out
}

// Final tiling consumed by the template. The tiling is always derived from the
// ROMANISED side (the reliably-segmented one); the native script is the primary
// glyph, the romanisation the ruby. Three strategies by script shape:
//  - Mandarin (zho): pinyin-word tiles, hanzi sliced 1-per-syllable.
//  - Space-separated scripts: word-pair tiles (native↔romaji word-for-word) —
//    finer than the LEGO decomposition, whose salient can be a whole clause.
//  - Spaceless scripts (Japanese/Thai): the DEVICE segments the native into
//    words (Intl.Segmenter); romaji is paired positionally or via the course's
//    native→romaji dictionary. No dependency on the backend decomposition.
//  - Latin-script courses: raw romanised tiling unchanged (no romanisation).
const currentPhraseLegoBlocks = computed<LegoBlock[]>(() => {
  const cycle = simplePlayer.currentCycle.value
  if (!cycle) return currentPhraseLegoBlocksRaw.value
  const romanPhrase = cycle.target?.text || ''
  const nativePhrase = (cycle.target as any)?.textNative || ''
  const idPrefix = cycle.legoId || currentRound.value?.legoId || cycle.id || 'w'

  // Strategy 0 (authoritative): authored display tiles from Popty
  // (course_practice_phrases.display_tiling). Built at content time, validated
  // both ways (roman = stored value sliced, native reassembles exactly), so we
  // render them verbatim — native glyph primary, roman as the ruby. Guard:
  // tiles must reassemble the displayed native phrase (whitespace-normalised);
  // a stale mismatch falls through to the runtime cascade below.
  const authored = (cycle as any).displayTiling as
    | Array<{ n: string; r: string; salient?: boolean }>
    | undefined
  if (Array.isArray(authored) && authored.length > 0 && nativePhrase) {
    const squash = (s: string) => s.replace(/\s+/g, '')
    if (squash(authored.map((t) => t.n).join('')) === squash(nativePhrase)) {
      return attachIntroGlosses(authored.map((t, i) => ({
        id: `${idPrefix}_dt${i}`,
        targetText: t.n,
        romanText: t.r,
        isSalient: !!t.salient,
      })), cycle)
    }
  }

  if (hasRomanizedText.value && romanPhrase && nativePhrase) {
    if (isMandarin.value) {
      const tiles = buildWordTiles(romanPhrase, nativePhrase, {
        salientNativeTexts: salientNativeTexts(cycle), idPrefix,
      })
      if (tiles && tiles.length > 0) return attachIntroGlosses(tiles, cycle)
    } else if (/\s/.test(nativePhrase.trim())) {
      // Space-separated script → word-pair tiling.
      const tiles = buildWordPairTiles(romanPhrase, nativePhrase, {
        salientNativeTexts: salientNativeTexts(cycle), idPrefix,
      })
      if (tiles && tiles.length > 0) return attachIntroGlosses(tiles, cycle)
    } else {
      // Spaceless script (Japanese/Thai) → device word segmentation.
      const locale = SEGMENTER_LOCALE[courseCode.value?.split('_')[0] || '']
      if (locale) {
        const tiles = buildSegmentedTiles(nativePhrase, romanPhrase, locale, {
          salientNativeTexts: salientNativeTexts(cycle),
          idPrefix,
          nativeRomajiDict: nativeRomajiDict.value,
        })
        if (tiles && tiles.length > 0) return attachIntroGlosses(tiles, cycle)
      }
      // Intl.Segmenter unavailable / unknown locale → pair native onto the
      // romaji tiling by legoId.
      const raw = currentPhraseLegoBlocksRaw.value
      if (raw.length > 0) return attachIntroGlosses(nativeFromRomanTiles(raw, legoNativeById.value), cycle)
    }
  }
  return currentPhraseLegoBlocksRaw.value
})

// The script toggle governs whether the romanisation ruby is shown above each
// tile. Native-script glyphs stay primary; this is a pronunciation crutch the
// learner drops as recognition builds. Default-on (scriptMode 'roman'). Applies
// to every romanised (non-Latin-script) course.
const showRomanization = computed(
  () => hasRomanizedText.value && scriptMode.value === 'roman',
)

// ============================================
// PROGRESSIVE LOADING - Start small, expand as learner progresses
// ============================================
const INITIAL_ROUNDS = 20           // Fast initial load
const EXPANSION_THRESHOLD = 5       // Expand when within 5 rounds of end
const isExpandingScript = ref(false)
const totalSeedsPlayed = ref(0)     // Legacy: total seeds played in current session
const isInitialized = ref(false)    // Legacy: whether component is fully initialized

// ============================================
// LOCAL STORAGE PERSISTENCE - Works for all users (guests + logged-in)
// Primary source of truth for position, works offline, persists across sessions
// ============================================
const POSITION_STORAGE_KEY_PREFIX = 'ssi_learning_position_'

const getPositionStorageKey = () => `${POSITION_STORAGE_KEY_PREFIX}${courseCode.value}`

// Set by SettingsScreen.vue (confirmReset / confirmRecover) immediately
// before it clears the local cursor and reloads. Closes a race the reset
// fix would otherwise reopen: opening Settings only PAUSES playback, it
// doesn't unmount LearningPlayer, so the round the learner was on before
// reset is still sitting in `simplePlayer.currentRound`. `reload()` fires
// a `pagehide` event first — which `saveResumeAudio` (below) listens for
// — and without this guard it would flush that stale pre-reset round back
// into both localStorage AND the DB (with a fresh timestamp) a moment
// after the reset cleared them, re-ratcheting the very position reset was
// meant to erase. sessionStorage (not a module variable) because the
// setter lives in a different component; App.vue clears it once at boot.
const POSITION_WRITES_SUSPENDED_KEY = 'ssi-position-writes-suspended'
const arePositionWritesSuspended = () => {
  try {
    return sessionStorage.getItem(POSITION_WRITES_SUSPENDED_KEY) === '1'
  } catch {
    return false
  }
}

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
const savePositionToLocalStorage = (cycleOverride?: number, touchTimestamp = true) => {
  if (!courseCode.value) return

  const round = currentRound.value
  if (!round) return

  // Lifecycle saves (init complete, dormant) persist position but must not
  // refresh lastUpdated — the gap rule reads it as "when did they last
  // practise", and a boot-time stamp made a day-long absence look like a
  // brief pause (Aran 2026-06-11). Carry the previous stamp forward; a
  // missing stamp fails closed to a round restart on resume.
  let carriedTimestamp: number | null = null
  if (!touchTimestamp) {
    try {
      const prev = JSON.parse(localStorage.getItem(getPositionStorageKey()) || 'null')
      carriedTimestamp = typeof prev?.lastUpdated === 'number' ? prev.lastUpdated : null
    } catch { /* fall through — omit the stamp */ }
  }

  // Prefer the engine's LIVE cycle when the caller passes it (the dormancy
  // flush passes simplePlayer.cycleIndex.value). The Vue mirror
  // currentItemInRound can lag the engine by a reactive tick during
  // pod/boundary transitions — that lag is what made a refresh resume land
  // ~1-2 cycles behind the live audio. Tom 2026-05-30.
  const cyc = (typeof cycleOverride === 'number' && cycleOverride >= 0)
    ? cycleOverride
    : currentItemInRound.value

  try {
    const position = {
      // Absolute identifiers - stable across script regeneration
      legoId: round.legoId,
      seedId: round.seedId,
      seedNumber: extractSeedNumber(round.seedId),
      // Stable handle for the exact cycle — its id is anchored to its home
      // LEGO (e.g. `S0069L02_debut`, `<phraseId>_3`), so it survives script
      // regeneration that reshuffles cycle order. Preferred over itemInRound
      // on resume; itemInRound is the positional fallback.
      cycleId: round.cycles?.[cyc]?.id ?? null,
      // Item within the round (positional fallback when cycleId can't match)
      itemInRound: cyc,
      // Metadata — practice saves stamp now; lifecycle saves carry the
      // previous stamp (or omit it, which fails closed on resume).
      lastUpdated: touchTimestamp ? Date.now() : carriedTimestamp,
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

    // No age-based expiry here (deleted per the position authority
    // ruling, docs/pwa-lifecycle-design.md §2.3): for a signed-in
    // learner, staleness is now handled by the freshness comparison in
    // resolveAuthoritativePosition (server wins once it's fresher, no
    // arbitrary cutoff needed); for a guest, an age cutoff only meant a
    // returning learner with no server row got silently restarted at
    // round 1 — the actual "long pause" pedagogical rule is
    // cycleResetMinutes (resolveResumePosition below), which stays.

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
  // Production deep link beats the saved cursor — see deepLinkStart above.
  // Resolved against the round-map, but the rounds array handed in here can be
  // a different vintage, so we still look the LEGO up and fall through to
  // normal resume if it isn't in THIS list.
  if (deepLinkStart.value && Array.isArray(rounds)) {
    const dlIdx = rounds.findIndex((r: any) => r?.legoId === deepLinkStart.value!.legoId)
    if (dlIdx >= 0) {
      // Anchor on the clicked cycle's text, not its ordinal — the two sides
      // enumerate a round differently (see deepLinkTarget.ts).
      return {
        roundIndex: dlIdx,
        cycleIndex: resolveCycleIndex(rounds[dlIdx]?.cycles, deepLinkStart.value),
      }
    }
    console.warn(`[DeepLink] ${deepLinkStart.value.legoId} not in the loaded rounds — resuming normally`)
  }

  const localPos = loadPositionFromLocalStorage()
  if (!localPos?.legoId || !Array.isArray(rounds)) return null
  const idx = rounds.findIndex((r: any) => r?.legoId === localPos.legoId)
  if (idx < 0) return null
  // Resolve the exact cycle by its stable id (anchored to its home LEGO),
  // not the positional itemInRound — regenerating a script can reshuffle a
  // round's cycle order, so the index drifts but the id doesn't. Fall back
  // to the saved index when there's no id match (older saved positions have
  // no cycleId, and a reshuffled spaced-rep cycle's id may not survive).
  let cycleIndex = Math.max(0, localPos.itemInRound || 0)
  const cycles = rounds[idx]?.cycles
  if (localPos.cycleId && Array.isArray(cycles)) {
    const byId = cycles.findIndex((c: any) => c?.id === localPos.cycleId)
    if (byId >= 0) cycleIndex = byId
  }
  // Gap rule on the localStorage path too (not just the DB path): a brief
  // pause resumes the exact cycle; a real break restarts the round. Uses the
  // save's OWN timestamp, so it fires even when the player was left up in rest
  // state (DB last_practiced_at not reloaded) — the case that slipped through
  // and kept the exact cycle no matter how long the gap. Tom 2026-06-01.
  // FAIL CLOSED (Aran 2026-06-11: resumed onto a round-tail USE monster after
  // 23h): a mid-round cycle without a trustworthy timestamp is never honoured —
  // no timestamp means we cannot prove the pause was brief, so restart the
  // round. Worst case a brief-pause learner replays the intro; the old fail-
  // open skipped the rule entirely and parked long-absent learners mid-round.
  if (cycleIndex > 0) {
    const ts = typeof localPos.lastUpdated === 'number' ? localPos.lastUpdated : null
    if (!ts || (Date.now() - ts) / 60000 >= resumeConfig.value.cycleResetMinutes) cycleIndex = 0
  }
  return { roundIndex: idx, cycleIndex }
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

// Persist learner position to localStorage.
//
// Save trigger: simplePlayer.phase entering 'prompt'. This captures
// "this cycle has just started playing audio" — not "the engine has
// queued up the next cycle." Critical for the resume rule: on
// refresh, ALWAYS restart the SAME cycle the learner was hearing,
// never the next one. Driving the save off cycleIndex change (the
// old behaviour) fired the instant voice2 of cycle N ended and
// cycleIndex bumped to N+1, even before N+1's audio began — a
// refresh in that gap saved cycleIndex=N+1 and the learner skipped
// cycle N. Phase=prompt closes that gap. Tom 2026-05-26.
watch(() => simplePlayer.phase.value, (phase) => {
  if (phase === 'prompt' && positionInitialized.value && useRoundBasedPlayback.value) {
    savePositionToLocalStorage()
    // Persist the cursor to the DB every cycle, not just per round. The DB is
    // the durable cross-session source; when it lagged at round granularity, a
    // learner whose localStorage was gone (SW update / new device) resumed at a
    // stale round and had to skip forward by hand. Cycle-precise here closes
    // that gap. Single-row PK update, fire-and-forget. Tom 2026-06-01.
    persistLivePositionToDb()
  }
})

// Save once when init completes — captures the resumed position the
// instant it's loaded, so refreshing again immediately (before any
// cycle plays) still has a fresh localStorage entry. Lifecycle save:
// position only, no practice timestamp (see savePositionToLocalStorage).
watch(positionInitialized, (init) => {
  if (init && useRoundBasedPlayback.value) {
    // RESUME GATE: a returning premium non-subscriber whose saved / deep-linked
    // position resolved PAST the free preview must not resume INTO locked
    // territory. The resume/init branches above can land the cursor anywhere
    // (DB cursor, ceiling, INF PLAY); this single post-init check catches them
    // all — if the landed seed is beyond the preview limit, pull the cursor back
    // to the start of the course and raise the paywall. (Free/community courses
    // and subscribers pass; the limit comes from canAccessSeed.)
    if (props.course) {
      const landedSeed = getSeedFromLegoId(simplePlayer.currentRound.value?.legoId ?? null)
      if (landedSeed !== null && !entitlementComposable.canAccessSeed(props.course, landedSeed)) {
        try {
          simplePlayer.pause()
          simplePlayer.jumpToRound(0)
        } catch { /* engine may not be ready */ }
        showPaywall.value = true
      }
    }
    savePositionToLocalStorage(undefined, false)
    // Capture the live cursor in the DB the instant init completes. For a
    // resuming learner this just re-affirms where they already were; for a
    // fresh learner it persists round 0 immediately (the roundIndex watcher
    // only fires on the FIRST advance, so without this their opening round
    // wouldn't be saved until they reached round 1).
    // touchPracticedAt=false: opening the app is not practising — a boot
    // stamp here made a 23h absence read as a brief pause (Aran 2026-06-11).
    persistLivePositionToDb(undefined, false)
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
    // Offline: there's no network to GENERATE new rounds, but the cached
    // script usually holds plenty the engine hasn't been given yet — the
    // bootstrap path serves only a few rounds, so this watcher fires almost
    // immediately on an offline resume. Keep going FORWARD through the course
    // from the cache first; recycle only once that is exhausted. Tom
    // 2026-08-15: unexpected offline is "play what you have", not a jump into
    // infinite play three rounds into a resume.
    if (offlinePlaybackActive()) {
      const forward = await appendForwardFromCacheOffline()
      if (forward > 0) return
      const looped = appendCachedLoopForOffline()
      if (looped > 0) console.log(`[Offline] cache has no more forward rounds — looped ${looped} cached rounds`)
      return
    }
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

// Initialize learning session composable
const learningSession = useLearningSession({
  // Class-aware wrapper — see activeProgressStore above. recordCycleComplete/
  // endSession call getLegoProgressById/saveLegoProgress/updateLegoProgress/
  // updateEnrollmentActivity through this option; in class mode they need the
  // same server-mediated routing as every other progress write.
  progressStore: activeProgressStore as unknown as Ref<ProgressStore | null>,
  sessionStore: activeSessionStore as unknown as Ref<SessionStore | null>,
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

// Exposure state follows the REAL learner identity. The service is
// constructed with a setup-time snapshot of learnerId, which can still be the
// guest/demo fallback while auth resolves (or change on play-as-class entry).
// Without re-keying, instruction progress lands under a guest localStorage
// key and never syncs to the server — so a wiped device replays every science
// bit. Re-key whenever the identity settles or changes.
watch(learnerId, (id) => {
  if (id) metaCommentary?.setLearnerId(id)
})

/**
 * THE listening play/speed policy (Tom, 2026-08-07) — ONE simplified mode.
 * Every listening phrase, in BOTH layers, plays target · known · target ·
 * target, with all four clips at one speed picked by how many times the
 * learner has met that phrase, never above 1.0.
 *
 * Built once here and handed to both schedulers so Layer 1 and Layer 2
 * provably cannot drift apart. Reactive on the `listening` DB row AND on the
 * active mode's `listeningSpeedRamp`, so switching Easy↔Fast re-ramps on the
 * next lap without a reload.
 */
const listeningPlayPolicy = computed(() =>
  resolveListeningPlayPolicy(listeningConfig.value, learningMode.value, activeModeConfig.value),
)

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
      stageDurations: computed(() => podsConfig.value.stageDurations),
      // Pod-lap cadence — lives alongside the stage playlist + gap matrix
      // on the pods config (semantically all "how pods behave" lives here).
      roundInterval: computed(() => podsConfig.value.roundInterval ?? 1),
      // The 2026-08-07 one-mode redesign: one T·K·T·T pattern at one
      // exposure-ramped speed, superseding the nine-stage playlist above
      // (which stays wired only for the DB escape hatch).
      listeningPolicy: listeningPlayPolicy,
      targetSpeed: computed(() => currentTargetSpeedConfig()),
      // The learner's position — what the per-mode belt ceiling is keyed on.
      // Wrapped in a computed because `beltAnchorSeed` is declared further down
      // this script block: a bare reference here is a TDZ error, a lazy getter
      // is not.
      beltAnchorSeed: computed(() => beltAnchorSeed.value),
      // No Stage-0 ladder option any more (retired 2026-07-14) — every
      // sentence goes straight to Stage 1. Its replacement, the always-visible
      // LEGO-tile display, was itself replaced on 2026-07-22 by PodTurnDisplay's
      // karaoke teleprompter, so a pod sentence currently gets NO per-atom
      // breakdown at all — the atom_map is still loaded and still rendered
      // nowhere. See apml/learning/listening-layers.apml (2026-07-22 update).
    })
  : null

// ============================================
// LAYER-1 LISTENING SCHEDULER (30-cup fluency maintenance)
// Sibling of podScheduler but simpler: no stages, no ratchet. Fires EVERY clean
// non-pod boundary once ≥1 seed/cup is available; pours one cup of a 30-slot
// wheel of *introduced* seeds. Pure function of (catalogue, round, learner,
// cluster templates) → resume-safe with no persisted state.
// See useLayer1Scheduler.ts + docs/methodology/layer1-listening-cups.md.
// ============================================
// Dev cheat (?l1test): shrink the wheel so the cup model's milestones (fill,
// cluster at 5/cup, re-cluster, freeze) are reachable by hand instead of after
// hundreds of introduced seeds. Default (30 cups, activate at 30 introduced,
// cap 20/cup) is right for real learners but untestable manually. ?l1test →
// a 2-cup wheel, activate at 2 introduced, cap 10/cup — so 1/cup at 2 introduced,
// first cluster at 10 introduced (5/cup), etc. Mirrors ?fc.
const l1TestConfig = ((): Partial<Layer1Config> | undefined => {
  try {
    const p = new URLSearchParams(window.location.search)
    if (!p.has('l1test')) return undefined
    return { cups: 2, activationCount: 2, maxSeedsPerCup: 10 }
  } catch { return undefined }
})()

// Layer-1 config is now admin-tunable via algorithm_config['listening'] (the
// Listening Config page). Pull only the four Layer1Config knobs from that row
// (the legacy fields on it are ignored); useLayer1Scheduler merges these over
// DEFAULT_LAYER1_CONFIG, so any absent knob falls back. ?l1test still wins.
const l1ConfigFromDb = computed<Partial<Layer1Config>>(() => {
  const c = listeningConfig.value as any
  if (!c) return {}
  const out: Partial<Layer1Config> = {}
  for (const k of ['cups', 'activationCount', 'maxSeedsPerCup', 'clusterStep'] as const) {
    if (typeof c[k] === 'number') out[k] = c[k]
  }
  // Per-seed sandwich playlist (admin-tunable). Absent → scheduler default.
  if (Array.isArray(c.seedPlaylist) && c.seedPlaylist.length) out.seedPlaylist = c.seedPlaylist
  return out
})
// ?l1=1 preview cheat: activationCount:1 so a cup is available as soon as ONE
// seed is fully introduced (default 30 / ?l1test's 2 would both need far more
// rounds). Still not literally round 1 for a multi-LEGO seed — nextLap()'s own
// activation gate requires the seed's LAST lego to have landed — which is why
// l1PreviewForced (handleRoundBoundaryBody) keeps retrying every boundary
// rather than pinning to a single captured round.
const l1PreviewConfig: Partial<Layer1Config> | undefined = forceLayer1PreviewCheat
  ? { cups: 1, activationCount: 1, maxSeedsPerCup: 10 }
  : undefined
const l1Config = computed<Partial<Layer1Config>>(() => ({
  ...l1ConfigFromDb.value,
  ...(l1TestConfig || {}),
  ...(l1PreviewConfig || {}),
}))

const l1Scheduler = supabase?.value
  ? useLayer1Scheduler({
      supabase: supabase as any,
      courseCode: courseCode,
      learnerId: learnerId,
      config: l1Config,
      // Belt ramp on target clips (Tom 2026-08-06) — the SAME course speed
      // config the speaking rounds bake with, so listening can never drift
      // away from the speaking curve.
      targetSpeed: computed(() => currentTargetSpeedConfig()),
      // Same policy object as the pods — one pattern, one ramp, one ceiling.
      listeningPolicy: listeningPlayPolicy,
      beltAnchorSeed: computed(() => beltAnchorSeed.value),
    })
  : null

const playingPodLapAudio = ref(false)
// The PodPlay currently sounding during a pod lap — set right before its
// audio segment starts (playPodLap), cleared when the lap ends. Drives
// PodTurnDisplay's "which sentence is lit" — the SAME object driving the
// audio call, never a separate text lookup (2026-07-14 whole-turn display).
const currentPodPlay = ref<PodPlay | null>(null)
// The IN-FLIGHT lap's full play list — set at the top of playPodLap, cleared
// when it ends. Scopes the teleprompter to what this lap ACTUALLY plays
// (Tom 2026-07-22: "the last thing we want is the whole dialogue... the
// played phrases are the content") rather than the pod's entire sentence list.
const currentPodLapPlays = ref<PodPlay[] | null>(null)
// Distinct 0-based sentence indices this lap sounds (Layer-1 segued plays
// excluded — see podPlayShowsTurnText).
const podLapSentenceIndices = computed(() =>
  currentPodLapPlays.value ? podLapPlayedSentenceIndices(currentPodLapPlays.value) : [],
)
// The full pod sentence list, sliced down to EXACTLY this lap's played
// sentences — no neighbour sentences (Tom 2026-07-22 follow-up: a dimmed
// neighbour still reads as part of the exercise even though the audio never
// sounds it). Falls back to the full list when no lap is in flight (inert —
// PodTurnDisplay only renders while playingPodLapAudio && currentPodTurn are
// both truthy).
const podScrollRange = computed(() =>
  podLapDisplayRange(podScheduler ? podScheduler.podSentences.value.length : 0, podLapSentenceIndices.value),
)
const podScrollSentences = computed(() => {
  const all = podScheduler ? podScheduler.podSentences.value : []
  const range = podScrollRange.value
  return range ? all.slice(range.start, range.end + 1) : all
})
// The currently-sounding sentence's LOCAL index into podScrollSentences
// (already offset by the display window's start). Null while nothing is lit
// yet (e.g. during the intro bookend), also null for Layer-1 listening-cup
// plays segued through this same pod-lap pipeline (product rule 2026-07-22):
// Layer-1 seed plays are audio-only, never text — only genuine Layer-2 pod
// sentences resolve a position to show. Also null if the index falls outside
// the current window (defensive — a mid-flight course/learner switch
// shouldn't ever show a stale position).
const currentPodTurn = computed(() => {
  if (!podScheduler || !podPlayShowsTurnText(currentPodPlay.value)) return null
  const idx0 = currentPodPlay.value!.sentenceIdx - 1 // PodPlay.sentenceIdx is 1-based
  const localIdx = idx0 - (podScrollRange.value?.start ?? 0)
  if (localIdx < 0 || localIdx >= podScrollSentences.value.length) return null
  return { activeIndex: localIdx }
})
// A listening exercise goes STRAIGHT IN with the audio (Tom, 2026-08-06):
// no popup, no modal, nothing persistent — the spoken "now just listen for a
// while" bookend introduces the lap and the screen stays free for the
// displayed text. The one-shot "just listen, like birdsong" transient that
// used to open every lap (usePodListeningReminder, 2026-07-22) is deleted;
// only the small ambient headphones mark remains, in the band PodTurnDisplay
// keeps clear. The preparation guidance itself lives on in Settings → Tools
// → Listening mode, and in the phase hint outside pod laps.
// Set true when the learner presses stop *during* a pod lap or commentary.
// handleRoundBoundary checks this before calling simplePlayer.resume() so a
// deliberate stop doesn't auto-advance into the next round mid-pod.
const userStoppedDuringLap = ref(false)
// Set true when the learner presses skip *during* a pod lap. Distinct from
// userStoppedDuringLap: skip means "advance to the next round" (so resume
// fires), stop means "stay paused". A skip never bumps the pod ratchet —
// the listening work still has to be done. (Turbo used to bump it; that
// went with Turbo on 2026-08-06.)
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
    if (l1Scheduler) await l1Scheduler.initialize()
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
    // Server-side home for the lifetime count (owner ruling 2026-08-19). The
    // local counter above still drives this session's summary screen; this
    // one rides the delta/watermark flush into
    // learner_speaking_opportunities.phrases_spoken, which survives tab-close
    // and is neither 30-day-windowed nor per-course.
    learningSession.bumpPhraseSpoken()
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

const totalCycles = ref(0)

// Session points multiplier. This used to reward Turbo usage (1.25× at 50%
// of cycles, 1.5× at 75%). Turbo is retired, and Easy is a gentler mode
// rather than a harder one, so there is nothing here to reward: the
// multiplier is a flat 1.0. That is exactly what every non-Turbo learner
// already got, so no one's points change. Kept as a computed so the points
// path and its call sites stay untouched and a future mode-based multiplier
// has an obvious home.
const sessionMultiplier = computed(() => 1.0)

// ============================================
// BELT PROGRESSION SYSTEM
// Uses useBeltProgress composable with localStorage persistence
// Starts at white belt (0 seeds), progresses through 8 belts
// ============================================

// Belt progress composable - initialized after courseCode is available
// Uses localStorage for persistence with Supabase sync for cross-device
const beltProgress = shallowRef(null)

// Belt loader for progressive loading — VESTIGIAL as of 2026-06-02: its only
// writer (initializeBeltLoader) was removed as dead code (never called; the
// instant-playback path superseded it). This ref is now never populated, so
// the two reads below (useOfflinePlay's getCachedItems + the clearCache guard)
// are effectively no-ops (always null → [] / never fires). Left in place
// because they thread into the live offline-play system; retire as part of the
// offline/buffer rework, not here.
// KEPT: vestigial ref whose 2 reads thread into the live offline-play
// system — retire with the offline/buffer rework, not here.
const beltLoader = shallowRef(null)

// Offline play composable for infinite play when offline
// Seamlessly cycles through cached content when network is unavailable
const offlinePlay = shallowRef(null)

// Online/offline state for UI indicators
const isOnline = ref(navigator.onLine)
// buffer-model: cache-play online (default-on on this branch; ?stream=1 to compare
// against the old streaming path). Hoisted here so BOTH the main-cycle resolver
// (resolveAudioUrl) and the AudioController source (createAudioCacheSource) read
// the SAME flag — previously only the latter did, so the main 4-phase cycle kept
// streaming /api/audio online and died when locked (iOS won't start a streamed
// <audio> locked); airplane forced it onto the cache, which is why airplane worked.
const cachePlayOnline = typeof window !== 'undefined' && !new URLSearchParams(window.location.search).has('stream')

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

// NOTE: backTargetBelt / playingPrevBelt / nextBeltLoading / prevBeltLoading
// were removed when the header chevrons stopped being BELT nav. The header
// ‹‹ ›› are now ROUND/LEGO nav (handleRoundBack / handleRoundForward); belt
// JUMPS are MODAL-only (central pill → handleSkipToBelt). playingNextBelt
// survives because wouldEnterInfplay still uses it for the INF-PLAY-entry
// decision that the central pill's ∞ indicator reflects.

const beltProgressPercent = computed(() => beltProgress.value?.beltProgress.value ?? 0)
const seedsToNextBelt = computed(() => beltProgress.value?.seedsToNextBelt.value ?? 8)
const timeToNextBelt = computed(() => beltProgress.value?.timeToNextBelt.value ?? 'Keep learning to see estimate')
const beltJourney = computed(() => beltProgress.value?.beltJourney.value ?? [])

// CSS custom properties for belt theming
// Are we POSITIONED in INF PLAY right now? INF PLAY is a POSITION/STATE, not a
// property of the LEGO under the cursor — once you're in it, you stay in it on
// whatever round you're on, and the belt is the red ∞ until you deliberately
// EXIT via the header belt chevrons. Detected by the mode flag OR (crucially for
// GUESTS, who never get the persisted 'infplay' mode — setMode is gated on a real
// account) by the current round being a revival round (no intro/debut/build).
// Single source of truth for the belt indicator, the accent colour, the forward-
// belt-skip null, and the listening cadence. Tom 2026-06-03.
// OFFLINE CHANGES WHAT PLAYS, NEVER WHERE YOU ARE (Tom, 2026-08-15).
// When a signed-in learner resumes with no network we recycle their cached USE
// phrases — infinite-play SELECTION — but they have NOT entered infinite play,
// so the UI must go on saying "you are where you were": their own belt colour,
// their own belt nav, no ∞ on the central pill. This flag is that distinction.
// Raised at the single point where offline recycling actually engages
// (appendCachedLoopForOffline), cleared the moment the learner deliberately
// enters INF PLAY or real main-loop content resumes.
const offlineRecycleBeltHeld = ref(false)

// Are we POSITIONED in INF PLAY right now — the FORMAL mode? This governs the
// LOOK and the NAVIGATION: the red accent, the ∞ glyph, the belt-chevron
// semantics. Detected by the mode flag OR (crucially for GUESTS, who never get
// the persisted 'infplay' mode — setMode is gated on a real account) by the
// current round being a revival round. The offline belt-held recycle is
// explicitly NOT this: same round shape, different place.
const isInfPlayActive = computed(() =>
  currentMode.value === 'infplay'
  || (!offlineRecycleBeltHeld.value
      && !!simplePlayer.currentRound.value && !isMainLoopRound(simplePlayer.currentRound.value))
)

// Are RECYCLED (USE-only, no intro/debut/build) rounds what's playing, by
// either route? This governs behaviour that follows the ROUND SHAPE rather
// than the learner's location: suppressing the belt-follows-the-drawn-phrase
// write, freezing the belt anchor, and the revival pod cadence. Offline
// belt-held play is round-shaped exactly like INF PLAY even though the learner
// has not gone anywhere — so it belongs here and not in isInfPlayActive.
const isRecycledRoundPlayback = computed(() =>
  isInfPlayActive.value || offlineRecycleBeltHeld.value
)

// M9 (pull-consistency map): the belt's playing position DERIVES from the
// round the engine is on — never pushed from scattered sites. The INF-PLAY
// belt freeze is a FEATURE and stays: entry/resume paths record their anchor
// (the course-end seed) in beltFreezeSeed — an explicit freeze intent, not a
// push into the composable — and the derivation pins to it while INF PLAY is
// active. Rounds that merely LOOK like INF PLAY without an anchor recorded
// (audio-stripped main-loop rounds; guests with no main-loop ceiling) freeze
// with a null anchor → no write → the belt HOLDS its last value, exactly the
// old skip-the-write behaviour. Leaving INF PLAY clears the freeze so the
// belt follows the landed round again.
const beltFreezeSeed = ref<number | null>(null)
const beltAnchorSeed = computed<number | null>(() => {
  if (isRecycledRoundPlayback.value) return beltFreezeSeed.value
  const legoId = visualLegoIdForRound(simplePlayer.currentRound.value)
  if (!legoId) return null
  return getSeedFromLegoId(legoId)
})
// Effect bridge into the shared belt composable (a cross-surface sink,
// set-call-shaped — the doctrine-approved watcher-on-derived-signal).
// beltProgress rides in the watch source so an anchor that lands before the
// composable exists is re-delivered once it does.
// immediate: an anchor already valid when the bridge attaches (late attach)
// must still be delivered — a change-only watcher would strand it.
watch([beltAnchorSeed, beltProgress], ([seed]) => {
  if (seed !== null && beltProgress.value?.setPlayingPosition) {
    beltProgress.value.setPlayingPosition(seed)
  }
}, { immediate: true })
watch(isRecycledRoundPlayback, (active) => { if (!active) beltFreezeSeed.value = null })
// The belt-held recycle lasts exactly as long as recycled rounds are playing.
// The moment genuine main-loop content lands again — network came back and
// expandScript produced real rounds, or a belt jump landed on cached main-loop
// material — the learner is back on the normal axis and the belt follows the
// round again.
watch(() => simplePlayer.currentRound.value, (round) => {
  if (offlineRecycleBeltHeld.value && round && isMainLoopRound(round)) {
    offlineRecycleBeltHeld.value = false
  }
})

const beltCssVars = computed(() => {
  // In INF PLAY the accent LOCKS to SSi red (matches the .is-infplay pill) so the
  // whole UI stays red regardless of which LEGO each random-USE phrase draws from
  // — never the flipping belt colour of the current cycle's LEGO.
  if (isInfPlayActive.value) {
    return {
      '--belt-color': '#c23a3a',
      '--belt-color-dark': '#9e2f2f',
      '--belt-glow': 'rgba(194, 58, 58, 0.35)',
    }
  }
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
    // Pass the REFS, not `.value` snapshots: this composable's own onMounted
    // runs before App.vue's parent onMounted even calls `auth.initialize()`,
    // so a dereferenced value here is captured pre-auth-resolution and never
    // updates — the root cause of learner_lego_metrics never getting written
    // (2026-07-16 shadow verdict). useAdaptationEngine re-reads these live.
    supabase,
    learnerId,
    courseCode: courseCode.value,
    aggregator: sharedEvidenceAggregator,
    ratePolicyConfig: {
      bounds: adaptationV2Config.value.bounds,
    },
    onPersistenceError: (stage, error) => {
      logEvent('adaptation_persistence_error', {
        stage,
        message: error instanceof Error ? error.message : String(error),
      })
    },
  })
  await engine.initialize()
  adaptationEngine.value = engine

  // Envelope evidence (WP-8/stitched WP-3): needs a live Supabase client to
  // fetch model rows — guests / offline never get one, so envelope evidence
  // simply doesn't fire for them (latency + behavioural evidence still do).
  if (supabase.value && !envelopeMetadataCache.value) {
    envelopeMetadataCache.value = createEnvelopeMetadataCache(supabase.value)
  }
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
    // Back online → renew the lease then clear the lock if we're re-validated.
    // useOfflineLease also renews on its own 'online' listener; we await it here
    // so the lock UI for THIS course clears promptly on reconnect.
    if (offlineLeaseLocked.value) {
      void offlineLease.renewLeases().then(() => checkOfflineLease()).catch(() => {})
    }
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

// ── Interjection display (the box follows the audio) ────────────────────────
// While a between-rounds interjection plays, the display box shows content that
// matches the AUDIO, never the next LEGO (the engine has advanced roundIndex
// onto it but its intro audio hasn't started). Encouragement → a wordless,
// rotating "positive" icon (strength / power / learning / effort). Instruction →
// a short, varied "back to the science" caption. Welcome keeps its own
// "listen to your guide" path. Tom 2026-06-02.
const currentCommentaryType = ref<CommentaryDisplayType | null>(null)

// Dev cheat flag (?fc=1 / ?forceEncouragements=1): read once. Drives both the
// service's forceFire (drop the ~10-min interval, set in useMetaCommentary) and
// the relaxed placement gate in handleRoundBoundary (fire at any non-pod
// boundary). Lets the interjection display be tested without a long wait.
const forceInterjectionsCheat = (() => {
  try {
    const p = new URLSearchParams(window.location.search)
    return p.has('fc') || p.has('forceEncouragements')
  } catch { return false }
})()

// Short, varied captions for the ordered (sciencey) instructions — Tom's
// "slightly fun, back to the science". No LEGO text; sets the expectation that
// this is the meta-cognitive teaching track, distinct from the wordless icons.
const INSTRUCTION_CAPTIONS = [
  'Back to the science…',
  'A bit of the science…',
  'The science behind it…',
  'Why this works…',
]
const instructionCaptionIndex = ref(0)
const currentInstructionCaption = computed(() => INSTRUCTION_CAPTIONS[instructionCaptionIndex.value % INSTRUCTION_CAPTIONS.length])

// Show the interjection block instead of the LEGO text. Welcome keeps its own
// existing "listen to your guide" message, so only instruction/encouragement
// flip this. Pods/L1 listening have their own overlays and don't set
// currentCommentaryType.
// Defensive by design (2026-08-06): anything that ISN'T the welcome shows the
// wave, including a clip whose type is missing or unrecognised — an unknown
// interjection degrades to "guide is speaking", never to the blank card that
// falling through to the un-started next LEGO produces. Rule lives in
// playback/interjectionDisplay.ts so it can be unit-tested.
const showInterjection = computed(() =>
  shouldShowInterjection(playingCommentaryAudio.value, currentCommentaryType.value)
)

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
  // Drive the display box off WHAT'S PLAYING (Tom 2026-06-02): an instruction
  // shows a short "back to the science" caption (words suit the dialog box); an
  // encouragement shows a calm throbbing ellipsis (consistent, non-distracting,
  // "just listen") — NEVER the next LEGO (the engine has advanced roundIndex
  // onto it, but its audio hasn't started). Pick the caption once per clip.
  currentCommentaryType.value = (commentary.type as CommentaryDisplayType) ?? null
  if (commentary.type === 'instruction') {
    instructionCaptionIndex.value = Math.floor(Math.random() * INSTRUCTION_CAPTIONS.length)
  }
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
      currentCommentaryType.value = null
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

const playPodSegment = async (
  audioId: string,
  durationMs?: number,
  playbackSpeed = 1.0,
  slice?: { startMs: number; endMs: number },
): Promise<PodSegmentResult> => {
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
    audio.play({
      id: audioId,
      url: `/api/audio/${audioId}?courseId=${encodeURIComponent(courseCode.value)}`,
      duration_ms: durationMs,
      // Fusion-rung chunks: an ms slice of the sentence's Take G render.
      ...(slice ? { startMs: slice.startMs, endMs: slice.endMs } : {}),
    })
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
  // Stage-0 plays carry their own config-driven gap; honour it verbatim and
  // bypass the role gap-matrix. (The tier's last play leaves gapAfterMs unset,
  // so the between-phrases gap to the next sentence still comes from below.)
  if (curr.gapAfterMs != null) return curr.gapAfterMs
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
const playPodLap = async (inputLap: PodLap, omitIntro: boolean = false): Promise<boolean> => {
  // BELT RAMP on target clips (Tom 2026-08-06: "LIStening exercises are way too
  // fast initially — they need to follow the belt speed gating"). Applied HERE,
  // once, because every listening surface that isn't Layer-1 funnels through
  // this one runtime — Layer-2 pods, Stage-0 sequences and fusion drills alike,
  // several of which hard-code 1.0. Pods activate at main round 5, so a
  // white-belt learner really was meeting 1.0× target audio.
  //
  // It's a MULTIPLIER on the play's own role rate, never a replacement: a pod's
  // 0.8 / 1.0 / 1.5 / 2.0 stage progression is a deliberate per-SENTENCE
  // pedagogy (maturity of that sentence), independent of the learner's belt, so
  // a 2× stretch rep stays a fast rep relative to wherever the learner is.
  // Keyed on the LEARNER's current seed because a pod sentence has no seed
  // number of its own — the one place listening can't mirror the speaking side's
  // per-item keying. Layer-1 plays already carry their own per-seed ramped rate
  // (buildSeedPlays) and are skipped here so nothing is ramped twice.
  const lap: PodLap = (() => {
    const anchor = beltAnchorSeed.value
    if (anchor == null) return inputLap
    const speedCfg = currentTargetSpeedConfig()
    return {
      ...inputLap,
      plays: inputLap.plays.map((p) => {
        const play = p as PodPlay
        if (play.isLayer1) return play
        // 2026-08-07 (Tom): a play whose speed came from the EXPOSURE ramp is
        // already final — globalSpeed folded in, 1.0 ceiling applied, and the
        // same rate on all four slots. Re-ramping it here would both
        // double-apply the course speed and re-split the phrase, because this
        // pass only touches target roles. Skipped exactly as Layer 1 is.
        // Everything that ISN'T exposure-ramped goes through
        // computeListeningSpeed, which since 2026-08-16 applies the course
        // speed and no belt term — listening is never slowed.
        if (play.speedIsFinal) return play
        if (!isTargetRole(play.playRole as PodPlayRole)) return play
        return { ...play, playbackSpeed: computeListeningSpeed(play.playbackSpeed ?? 1.0, anchor, speedCfg) }
      }),
    }
  })()

  podLapCancelled.value = false
  podLapSkippedByUser.value = false
  playingPodLapAudio.value = true
  // Set BEFORE any audio starts so the teleprompter's scoped window (see
  // podScrollRange) is correct from the very first play of the lap.
  currentPodLapPlays.value = lap.plays

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
      // Drives PodTurnDisplay — set BEFORE the audio call so the visual and
      // the sound always agree on which sentence is current.
      currentPodPlay.value = play
      const segStart = Date.now()
      const cacheHit = audioCache.has(play.audioId)
      const result = await playPodSegment(
        play.audioId,
        undefined,
        play.playbackSpeed,
        play.startMs != null && play.endMs != null ? { startMs: play.startMs, endMs: play.endMs } : undefined,
      )
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
    currentPodPlay.value = null
    currentPodLapPlays.value = null
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

// ============================================
// ?podview=1 INSTANT POD PREVIEW
// Direct pod-lap loop through the REAL playPodLap pipeline above — no
// round boundaries, no mocks. handleResume hijacks every play tap into
// startPodPreviewLap instead of the main round flow (see podPreviewMode).
// ============================================
// 0-based index into podScheduler.podSentences — which sentence the
// preview is currently on. Next/Prev nudge this; a completed lap
// auto-advances it so the preview keeps demonstrating fresh content.
const podPreviewIndex = ref(0)
// Generation counter: a Next/Prev tap bumps this so an in-flight lap's
// auto-advance (below) recognises it's been superseded and doesn't also
// recurse — without this, cancelling mid-lap and requesting a new index
// could race two playPodLap calls mutating the same currentPodPlay ref.
let podPreviewGeneration = 0
// The in-flight run's promise, so a superseding call can wait for the
// cancelled lap to actually finish (playPodLap's finally block) before
// composing and playing the next one — never two concurrent playPodLap calls.
let podPreviewRunning: Promise<void> | null = null

const startPodPreviewLap = (index: number): void => {
  const myGeneration = ++podPreviewGeneration
  podPreviewIndex.value = index
  const previousRun = podPreviewRunning
  podPreviewRunning = (async () => {
    if (previousRun) await previousRun.catch(() => undefined)
    if (myGeneration !== podPreviewGeneration || !podScheduler) return
    if (!podScheduler.isInitialized.value) await podScheduler.initialize()
    if (myGeneration !== podPreviewGeneration) return
    const lap = podScheduler.nextLapPreviewFallback(index) ?? podScheduler.nextLap()
    if (!lap) {
      console.warn('[podview] no playable pod content for this course')
      return
    }
    const completed = await playPodLap(lap, false)
    if (myGeneration !== podPreviewGeneration) return // superseded mid-lap by Next/Prev
    if (completed && podPreviewMode) {
      // Advance a whole COHORT (the preview lap plays one exchange, so the
      // next lap should be the next exchange, not a sibling sentence).
      startPodPreviewLap(podScheduler.previewCohortStep(index, 1))
    }
  })()
}

const podPreviewNext = (): void => {
  if (!podScheduler) return
  podLapCancelled.value = true
  startPodPreviewLap(podScheduler.previewCohortStep(podPreviewIndex.value, 1))
}
const podPreviewPrev = (): void => {
  if (!podScheduler) return
  podLapCancelled.value = true
  startPodPreviewLap(podScheduler.previewCohortStep(podPreviewIndex.value, -1))
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
  // Once the engine exists the belt derives from it (beltAnchorSeed, M9) —
  // this manual writer serves only the pre-engine paths (legacy playback
  // boundaries, pre-engine preview seeding).
  if (simplePlayer.isInitialized.value) return
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

// Pod-lap cadence, INF-PLAY-aware (B4, Tom 2026-06-03: listening fires every 5
// ROUNDS, not cycles). `completedRoundIndex` is the 0-based flat queue index of
// the round that just finished.
//   • Main loop → defer to the scheduler's own activation+interval math, keyed
//     on the absolute round number (unchanged behaviour).
//   • INF PLAY → count the REVIVAL-TAIL ordinal (position past the main loop)
//     and fire every `roundInterval` (normal config = 5) INF PLAY rounds. We use
//     the position ordinal, NOT the bumped infplayRoundIndex, because the
//     pre-pause check (onRoundCompleted) runs BEFORE saveRoundProgress bumps the
//     counter and the fire check (here) runs AFTER — the position ordinal is the
//     one value both see identically, so pause and fire never desync.
const podCadenceFiresAtRound = (completedRoundIndex: number): boolean => {
  if (!podScheduler || !podScheduler.isInitialized.value) return false
  // ?pod=1 preview cheat: force true on every boundary until a forced lap
  // actually plays (podPreviewFired flips true in the nextLap() success
  // branch below) — NOT just the first boundary reached. isInitialized is
  // checked above this so a still-loading scheduler never triggers a forced
  // pre-pause with nothing to land.
  if (forcePodPreviewCheat && !podPreviewFired) return true
  // ?l1=1 preview cheat: while it's still waiting for its own shot, a
  // same-boundary REAL pod fire must not pre-empt it — pod's normal
  // "pods pre-empt both" priority would otherwise starve the L1 preview
  // forever at any position where real pod cadence has already activated
  // (default roundInterval=1 means pod is then due EVERY boundary). Never
  // suppresses the pod PREVIEW cheat itself — if both flags are set,
  // ?pod=1 still wins (existing precedence, checked above).
  if (!forcePodPreviewCheat && forceLayer1PreviewCheat && !l1PreviewFired) return false
  // Round-shape signal: recycled rounds have no main-loop cadence to schedule
  // against by either route, so offline belt-held play takes the same branch.
  if (isRecycledRoundPlayback.value) {
    const mainLoopCount = mainLoopBoundary()
    if (mainLoopCount < 0) return false
    const infOrdinal = (completedRoundIndex - mainLoopCount) + 1 // 1-based revival round
    if (infOrdinal <= 0) return false
    const interval = Math.max(1, Math.floor(podsConfig.value.roundInterval ?? 5))
    return infOrdinal % interval === 0
  }
  return podScheduler.shouldFireLapAt((completedRoundIndex || 0) + 1)
}

// A round-boundary interlude may chain commentary + a segued L1-into-pod lap
// — legitimately several minutes. This is a last-resort hang backstop (a
// promise that never settles), not a UX-facing bound, so it's generous.
const ROUND_BOUNDARY_INTERLUDE_TIMEOUT_MS = 10 * 60 * 1000

// Handle round boundary - called when a round completes
const handleRoundBoundary = async (completedRoundIndex, completedLegoId, completedRound = null) => {
  roundsThisSession.value++
  // Bracketed via PlayerConductor.runInterlude (docs/player-decomposition-
  // options.md Option 2): the whole body pauses simplePlayer for an
  // interlude (commentary/pod/L1) and is trusted to un-pause it on every
  // exit path. The inner try/catch below is the ORIGINAL ed738a0f recovery
  // — an uncaught exception ANYWHERE in the body (e.g. a scheduler's
  // nextLap() throwing on unexpected data) used to strand simplePlayer
  // paused forever, so a thrown error falls back to resuming (unless the
  // learner explicitly stopped or the session ended — same as before).
  // What's NEW here: runInterlude ALSO bounds the whole interlude by a
  // timeout, so a hung promise (never throws, never resolves — the one
  // failure mode try/catch alone can't catch) still lands the player back
  // in a stable state instead of stranding it with no recovery at all.
  await simplePlayer.runInterlude('round-boundary', async () => {
    try {
      await handleRoundBoundaryBody(completedRoundIndex, completedLegoId, completedRound)
    } catch (err) {
      console.error('[LearningPlayer] handleRoundBoundary failed — recovering by resuming playback:', err)
      if (!userStoppedDuringLap.value && !showSessionComplete.value) {
        playingPodLapAudio.value = false
        playingCommentaryAudio.value = false
        simplePlayer.resume()
      }
    }
  }, { timeoutMs: ROUND_BOUNDARY_INTERLUDE_TIMEOUT_MS })
}

const handleRoundBoundaryBody = async (completedRoundIndex, completedLegoId, completedRound = null) => {
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
  // ============================================
  // Encouragements are an UNCERTAIN reward: roughly every ~10 min of active
  // play, jittered so they can't be predicted, and ALWAYS dropped between two
  // speaking rounds — never adjacent to a listening section. (If one followed
  // listening, commentary's closing resume() would restart the next round's
  // intro over the still-resolving lap — the resume()/pause() race documented
  // in onRoundCompleted — and a ~1-min clip butted onto a listening block is
  // poor pacing anyway.) A boundary is a legal drop point when:
  //   • the round that just finished is not a listening round, AND
  //   • the round about to start is not a listening round, AND
  //   • no runtime pod lap fires at this boundary.
  // We call onRoundComplete EVERY round so the service can accumulate active
  // play time (cycle count); it only RETURNS commentary when canFire is set,
  // so the ~10-min timer naturally lands on the next clean boundary. The
  // listening schedule is untouched; the encouragement is the flexible guest.
  const isListeningRound = (r: { cycles?: Array<{ type?: string }> } | null | undefined): boolean =>
    !!r?.cycles?.some(c =>
      c.type === 'listen_intro' || c.type === 'listening' || c.type === 'listen_outro' || c.type === 'pod'
    )
  const nextRound = loadedRounds.value[completedRoundIndex + 1] as { cycles?: Array<{ type?: string }> } | undefined

  // ============================================
  // ADAPTATION V2 — rate-policy plan for the round about to start (WP-3,
  // `docs/adaptation/adaptation-v2-build-spec.md` §4/§6).
  //
  // Kill switch: `enabled:false` skips this block entirely — no evidence
  // read, no curvature computed, no adaptation_plan log line ("disables even
  // shadow computation"). When enabled, the plan is ALWAYS computed and
  // logged; it is only APPLIED (adaptOmitCycleIds populated, currentRoundPlan
  // set, breather inserted) when `shadow:false`. Shadow mode therefore always
  // leaves currentRoundPlan/adaptOmitCycleIds at their empty defaults, so
  // shouldSkipCycle/getPauseDuration above transparently fall through to the
  // pre-v2 behaviour — zero learner-visible change.
  // ============================================
  if (adaptationV2Config.value.enabled && adaptationEngine.value && nextRound) {
    const nextRoundFull = nextRound as unknown as PlayerRound
    // Seed number is the ordinal proxy — one new LEGO per round means round
    // order tracks LEGO introduction order closely, and criticality only
    // needs the FRACTION through the course right, not an exact count.
    const roundLegoOrdinal = getSeedFromLegoId(nextRoundFull.legoId) ?? (completedRoundIndex + 2)
    const courseLegoCount = beltProgress.value?.courseSeedCount?.value ?? roundLegoOrdinal
    const { plan, difficulty } = adaptationEngine.value.planRound({
      roundLegoId: nextRoundFull.legoId,
      roundLegoOrdinal,
      courseLegoCount,
      // Easy mode is a deliberate learner pace choice, exactly as Turbo was
      // — the adaptation engine should back off while it's on.
      manualOverrideActive: behaviouralEvidence.isManualOverrideActive() || isEasyMode.value,
      unitCentralityPercentile: legoCentralityPercentile.value ?? undefined,
    })
    const applyingAdaptationV2 = !adaptationV2Config.value.shadow
    logEvent('adaptation_plan', {
      roundNumber: nextRoundFull.roundNumber,
      legoId: nextRoundFull.legoId,
      plan: {
        buildCount: plan.buildCount,
        consolidateCount: plan.consolidateCount,
        spacedRepCap: plan.spacedRepCap,
        insertBreather: plan.insertBreather,
        returnReady: plan.returnReady,
      },
      // Shadow transparency for the criticality rewrite (2026-07-31): which
      // signal the guard had for this round's LEGO, so logs show would-do
      // under centrality vs the intro-order fallback.
      roundLegoCentrality: legoCentralityPercentile.value?.[nextRoundFull.legoId] ?? null,
      difficultyStates: difficulty.map((d) => ({
        unitId: d.unitId,
        state: d.state,
        accelerationZ: d.accelerationZ,
        samples: d.samples,
      })),
      applied: applyingAdaptationV2,
    })
    if (applyingAdaptationV2) {
      currentRoundPlan.value = plan
      adaptOmitCycleIds.value = computeAdaptOmitCycleIds(nextRoundFull, plan)
      if (plan.insertBreather) {
        const breather = assembleBreatherRound(
          loadedRounds.value as PlayerRound[],
          completedRoundIndex,
          nextRoundFull,
          (legoId) => adaptationEngine.value!.getPauseMultiplier(legoId),
        )
        if (breather) {
          simplePlayer.appendRounds([breather])
          // Keep the component's loadedRounds mirror in lockstep — appendRounds
          // only updates the composable's OWN internal rounds array; loadedRounds
          // is a separate array we must sync here (same mirror-drift species as
          // the round-skip-forward and belt-skip fencepost bugs, 2026-07-21).
          if (!loadedRounds.value.some((r: any) => r.roundNumber === breather.roundNumber)) {
            const insertAt = loadedRounds.value.findIndex((r: any) => r.roundNumber > breather.roundNumber)
            const merged = [...loadedRounds.value]
            if (insertAt === -1) merged.push(breather)
            else merged.splice(insertAt, 0, breather)
            loadedRounds.value = merged as any
          }
        }
      }
    } else {
      currentRoundPlan.value = null
      adaptOmitCycleIds.value = new Set()
    }
  } else {
    currentRoundPlan.value = null
    adaptOmitCycleIds.value = new Set()
  }

  // Pod cadence uses the INF-PLAY-aware helper (dev): main-loop defers to the
  // scheduler's activation+interval math, INF PLAY counts the revival ordinal.
  const podFiresThisBoundary = podCadenceFiresAtRound(completedRoundIndex)
  // Layer-1 fires every clean boundary with no pod (pod wins priority).
  // ?l1=1 preview cheat: force true on every eligible boundary until a forced
  // lap actually plays (l1PreviewFired flips true in the nextLap() success
  // branch below) — l1Scheduler.isInitialized.value is already required by
  // l1FiresThisBoundary below, so this can't fire before the scheduler is
  // ready. Kept as a plain "!l1PreviewFired" (not tied to a specific round)
  // because nextLap() has its OWN internal activation gate (the first seed
  // must be fully introduced) independent of this boundary check — a
  // multi-LEGO seed 1 doesn't finish introducing until round 3+, so pinning
  // the force to literally the first boundary silently burned the one shot
  // before any content existed to play (fixed 2026-07-22).
  const l1PreviewForced = forceLayer1PreviewCheat && !l1PreviewFired
  // ?pod=1 preview cheat: block L1 from firing standalone while pod's own
  // shot is still pending, even in the narrow window before podScheduler
  // finishes initializing — podFiresThisBoundary alone can't cover that
  // window (podCadenceFiresAtRound returns false until isInitialized), and
  // without this an L1 lap could win a boundary that pod was armed for,
  // exactly the "got L1 material instead of a pod" field report. Requires
  // podScheduler to exist so a genuinely broken/absent scheduler (cheat can
  // never fire regardless) doesn't deadlock L1 forever.
  const podPreviewPending = forcePodPreviewCheat && !podPreviewFired && !!podScheduler
  const l1FiresThisBoundary = !!l1Scheduler
    && l1Scheduler.isInitialized.value
    && currentMode.value !== 'infplay'
    && !podFiresThisBoundary
    && !podPreviewPending
    && (l1PreviewForced || l1Scheduler.shouldFireLapAt((completedRoundIndex || 0) + 1))
  // L1 now fires EVERY clean non-pod boundary (30-cup model), so suppressing
  // encouragements next to it would starve them entirely. The old "don't butt a
  // clip onto a 10-min listen" reason is gone — an L1 cup is only ~1 min — so an
  // encouragement MAY co-fire with an L1 lap: commentary plays, THEN the lap (the
  // commentary block defers its resume to the lap block to avoid a resume()/pause()
  // race). Pods still pre-empt both. Tom 2026-06-16.
  const boundaryBetweenSpeakingRounds =
    !isListeningRound(completedRound) && !isListeningRound(nextRound)
    && !podFiresThisBoundary

  // Dev cheat (?fc / ?forceEncouragements): relax the placement rule so an
  // interjection can fire at ANY boundary that isn't a pod lap — otherwise a
  // pod-/listening-heavy stretch never offers a clean speaking→speaking
  // boundary and the forced interjections never show. Still excludes pod
  // boundaries (firing there would overlap/race the lap). Pairs with the
  // service's forceFire (which drops the ~10-min interval).
  const canFireInterjection = forceInterjectionsCheat
    ? !podFiresThisBoundary
    : boundaryBetweenSpeakingRounds

  // No random encouragements in INF PLAY — the locked model has none, and a
  // mid-stream ~1-min clip is poor pacing in a pure-review tail. Gating here
  // (rather than not accumulating time) keeps the main-loop timer logic
  // untouched. Tom 2026-05-29.
  if (metaCommentary && !beltJustEarned.value && currentMode.value !== 'infplay') {
    const cyclesInRound = completedRound?.cycles?.length ?? 0
    // Push the live taper knobs + the learner's CUMULATIVE cross-course
    // learning time (owner ruling 2026-08-06). Not the seed of the current
    // course: a veteran starting a fresh course is not a beginner. null (guest,
    // offline, or the server number not landed yet) = unknown ⇒ beginner.
    metaCommentary.setEncouragementTaper(metaCommentaryConfig.value?.encouragementTaper)
    metaCommentary.setCumulativeLearningMinutes(props.cumulativeLearningMinutes)
    const commentary = metaCommentary.onRoundComplete(
      completedRoundIndex + 1,
      cyclesInRound,
      canFireInterjection,
    )

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
      } else if (!l1FiresThisBoundary) {
        simplePlayer.resume()
      }
      // else: an L1 lap fires this boundary and owns the resume — deferring
      // avoids a resume()/pause() race between commentary and the lap.
    }
  }

  // ============================================
  // LISTENING POD LAP (Layer 2 — runtime, ratchet-driven)
  // Fires between rounds when learner has crossed activation. Lap is keyed
  // off completed_pod_rounds + 1, NOT main round arithmetic. Only advances
  // the ratchet when the lap plays to completion.
  // ============================================
  if (podScheduler && podScheduler.isInitialized.value && !beltJustEarned.value) {
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
    //
    // Cadence via podCadenceFiresAtRound so INF PLAY counts revival-tail rounds
    // (every 5), not the absolute flat queue index (B4).
    if (podCadenceFiresAtRound(completedRoundIndex + 1)) {
      podScheduler.prefetchLap((id) => audioCache.persistent.ensure(id))
    }

    if (podCadenceFiresAtRound(completedRoundIndex)) {
      let lap = podScheduler.nextLap()
      // ?pod=1 preview cheat: nextLap() only ever composes from the
      // ratchet-windowed slice of podSentences — position-independent in
      // theory, but an account whose ratchet window lands on unplayable
      // content (or hasn't advanced at all) still gets nothing. Fall back
      // to the nearest playable sentence anywhere in the course so the
      // preview can always demonstrate the format.
      if (!lap && forcePodPreviewCheat) {
        lap = podScheduler.nextLapPreviewFallback()
        if (lap) {
          console.warn(`[cheat] pod=1: no lap at current position, falling back to nearest pod ${lap.podRound}`)
        }
      }
      if (lap) {
        // SEGUE LAYER 1 → LAYER 2. On a pod round the cup wheel is also turning,
        // so instead of two separately-bracketed listening blocks (intro/seeds/
        // outro, then intro/pod/outro), prepend THIS round's L1 cup seeds onto the
        // FRONT of the pod lap and play it as ONE lap: single intro bookend → L1
        // seeds → pod → single outro bookend (Tom 2026-06-16, "just segue them").
        // The standalone L1 block below is gated on !pod so it won't also fire.
        // Skipped in INF PLAY (L1 doesn't run there) — pod plays alone, as before.
        // ALSO skipped while ?pod=1's own forced fire is in flight
        // (podPreviewPending) — a real L1 cup segued onto the front made a
        // clean pod-only preview read as "L1 material, dialogues after"
        // (field report). The preview should show a PURE pod lap; segue
        // resumes normally once the cheat has fired its one shot.
        let lapToPlay = lap
        if (!podPreviewPending && l1Scheduler && l1Scheduler.isInitialized.value && currentMode.value !== 'infplay') {
          const l1Cup = l1Scheduler.nextLap((completedRoundIndex || 0) + 1)
          if (l1Cup && l1Cup.plays.length > 0) {
            const l1AsPodPlays: PodPlay[] = l1Cup.plays.map((p) => ({
              sentenceIdx: p.seedNumber,
              stage: 0,
              playRole: p.role, // 'ps' | 'trans' — drives the gap matrix + known/target text
              audioId: p.audioId,
              text: p.text,
              playbackSpeed: p.playbackSpeed,
              glueToNextChunk: false,
              isLayer1: true,
            }))
            lapToPlay = { ...lap, plays: [...l1AsPodPlays, ...lap.plays] }
            console.log(`[LearningPlayer] Seguing L1 cup ${l1Cup.cupIndex} (${l1Cup.bucketSize} seeds) into pod lap ${lap.podRound}`)
          }
        }
        console.log(`[LearningPlayer] Playing pod lap ${lap.podRound} (${lapToPlay.plays.length} plays)`)
        if (forcePodPreviewCheat) {
          podPreviewFired = true
          console.warn(`[LearningPlayer] ?pod=1 preview cheat FIRED at round ${lap.podRound}`)
        }
        simplePlayer.pause()
        const completed = await playPodLap(lapToPlay, l1FiredThisRound)
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
        } else {
          // Skip, audio error, or user stop — counter stays so the same lap
          // plays next session ("the listening work has to be done").
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
          // Offline: loop the cached content rather than ending (mirror of
          // the onSessionComplete + watcher guards — offline never ends at
          // the tail, even when session_complete fired during a pod lap).
          // Forward from cache first, recycle only when it's exhausted.
          if (offlinePlaybackActive()
              && (await appendForwardFromCacheOffline() > 0 || appendCachedLoopForOffline() > 0)) {
            sessionEnded.value = false
            simplePlayer.resume()
          } else {
            // session_complete fired during this pod lap (the cadence lands a
            // lap near the tail). expandScript() grows the revival tail by a
            // batch in INF PLAY so play continues into genuinely new rounds.
            // OFFLINE it is a Supabase course walk that can only fail, so we
            // skip it and go straight to the wrap — same cut as the main
            // session_complete handler.
            const added = offlinePlaybackActive() ? 0 : await expandScript()
            if (added > 0) {
              sessionEnded.value = false
              simplePlayer.resume()
            } else if (wrapInfPlayAtTail()) {
              // Growth couldn't run (transient online failure) — wrap so INF
              // PLAY never dead-ends right after a listening pod.
              // (wrapInfPlayAtTail clears sessionEnded + resumes.)
            } else {
              showPausedSummary()
            }
          }
        } else if (userStoppedDuringLap.value) {
          // Bookmark the lap so the next play tap re-fires it instead of
          // skipping silently into round N+1. Re-fire uses omitIntro=true
          // so the bookend doesn't double up.
          userStoppedDuringLap.value = false
          pendingLapResume.value = lapToPlay
        } else {
          simplePlayer.resume()
        }
      } else if (forcePodPreviewCheat) {
        // Forced this boundary (podCadenceFiresAtRound above) but no lap was
        // available yet (e.g. pod content not authored for this seed range) —
        // the synchronous pre-pause in onRoundCompleted already paused for
        // this attempt, so undo it here rather than stranding the player.
        // podPreviewFired stays false, so the next boundary tries again.
        simplePlayer.resume()
      }
    }
  }

  // ============================================
  // LAYER-1 LISTENING (runtime — 30-cup fluency maintenance)
  // Fires EVERY clean non-pod boundary once ≥1 seed/cup is available. Pours one
  // cup of the 30-slot wheel: an authored cluster + recent loose seeds, each
  // played as its comprehensible-input sandwich (target → known → target →
  // target; target clips belt-ramped, see buildSeedPlays). No ratchet: the lap is a pure function of
  // (catalogue, round, learner, cluster
  // templates), so it's resume-safe with nothing to persist. l1FiresThisBoundary
  // already gated it on a clean, pod-free boundary; an empty cup no-ops via nextLap.
  // See docs/methodology/layer1-listening-cups.md.
  // ============================================
  if (l1Scheduler && l1FiresThisBoundary && !beltJustEarned.value) {
    const completedMainRound = (completedRoundIndex || 0) + 1

    // Warm the NEXT L1 lap's audio if the upcoming round ends in one and no
    // pod pre-empts it (mirror of the pod look-ahead prefetch above).
    if (l1Scheduler.shouldFireLapAt(completedMainRound + 1)
        && !(podScheduler?.shouldFireLapAt(completedMainRound + 1))) {
      l1Scheduler.prefetchLap(completedMainRound + 1, (id) => audioCache.persistent.ensure(id))
    }

    let l1Lap = l1Scheduler.nextLap(completedMainRound)
    // ?l1=1 preview cheat: nextLap() requires the activation-count-th seed to
    // be fully introduced by this round — a preview armed before that (or
    // whose assigned cup has no audio) can retry every boundary and still
    // find nothing. Fall back to sandwiching the first few course seeds so
    // the preview can always demonstrate the format.
    if (!l1Lap && forceLayer1PreviewCheat && !l1PreviewFired) {
      l1Lap = l1Scheduler.nextLapPreviewFallback(completedMainRound)
      if (l1Lap) {
        console.warn(`[cheat] l1=1: no lap at current position, falling back to sandwiching the first course seeds`)
      }
    }
    if (l1Lap) {
      console.log(`[LearningPlayer] Playing L1 cup ${l1Lap.cupIndex} @ round ${completedMainRound} (${l1Lap.bucketSize} seeds, ${l1Lap.plays.length} plays)`)
      if (forceLayer1PreviewCheat) {
        l1PreviewFired = true
        console.warn(`[LearningPlayer] ?l1=1 preview cheat FIRED at round ${completedMainRound}`)
      }
      simplePlayer.pause()

      // Reuse the proven pod playback path — shape the L1 lap into a PodLap.
      // L1 plays are seed target sentences (no glued chunks → glueToNextChunk
      // false). omitIntro=false: an L1 lap is standalone (it never co-fires
      // with a pod — l1FiresThisBoundary requires !podFiresThisBoundary).
      const l1AsPodLap: PodLap = {
        podRound: completedMainRound,
        intro: l1Lap.intro,
        outro: l1Lap.outro,
        plays: l1Lap.plays.map((p): PodPlay => ({
          sentenceIdx: p.seedNumber,
          stage: 0,
          playRole: p.role, // 'ps' | 'trans' — drives the gap matrix + known/target text
          audioId: p.audioId,
          text: p.text,
          playbackSpeed: p.playbackSpeed,
          glueToNextChunk: false,
          isLayer1: true,
        })),
      }
      await playPodLap(l1AsPodLap, false) // L1 has no ratchet — nothing to persist.

      // Resume handling mirrors the pod block: keep the course rolling unless
      // the session ended (offline loop / expand) or the learner stopped.
      if (sessionEnded.value) {
        // Forward from cache first, recycle only when it's exhausted.
        if (offlinePlaybackActive()
            && (await appendForwardFromCacheOffline() > 0 || appendCachedLoopForOffline() > 0)) {
          sessionEnded.value = false
          simplePlayer.resume()
        } else {
          // Offline, expandScript is a doomed network walk — skip it rather
          // than spend seconds on it before showing the summary anyway.
          const added = offlinePlaybackActive() ? 0 : await expandScript()
          if (added > 0) {
            sessionEnded.value = false
            simplePlayer.resume()
          } else {
            showPausedSummary()
          }
        }
      } else if (userStoppedDuringLap.value) {
        userStoppedDuringLap.value = false
        pendingLapResume.value = l1AsPodLap
      } else {
        simplePlayer.resume()
      }
      podLapSkippedByUser.value = false
    }
  }

  // Fallback: Show visual encouragement if no audio commentary played
  // (only if we don't have meta-commentary or it didn't return anything).
  // Suppressed in INF PLAY for the same reason as the audio commentary above.
  if ((!metaCommentary || !playingCommentaryAudio.value) && currentMode.value !== 'infplay') {
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
// Legacy-path cycle — written ONLY by startCyclePlayback (the
// pre-SimplePlayer useCyclePlayback system). Never written on the
// round-based path.
const legacyCycle = ref<Cycle | null>(null)
// currentCycle = PULL-CONSISTENT derivation of the cycle the ENGINE is on
// (M1, pull-consistency map — the TEXT/AUDIO pairing). The old design was a
// writable ref synced by an edge-triggered watcher (holding its last value
// on transient nulls) plus the legacy writer: a missed/reordered flush could
// show cycle N's text while the audio played cycle N+1 — the zero-tolerance
// schools bug class. Deriving from simplePlayer.currentCycle makes the
// displayed pair a pure function of engine truth. The mapping mirrors the
// old watcher's exactly (text fields only — textNative deliberately not
// passed through; romanised-course primary glyphs come from displayTiling,
// not this legacy shape). Transient engine nulls (mid queue-swap) fall
// through to '' downstream, where the displayedKnownText/TargetText
// hold-last-good latches (B5) keep the last real text on screen.
const currentCycle = computed<Cycle | null>(() => {
  const simpleCycle = simplePlayer.currentCycle.value
  if (!simpleCycle) return legacyCycle.value
  return {
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
})

// Offline cache for IndexedDB-based audio caching
// AudioController.audioSource is built from createAudioCacheSource over the
// Wave 3 AudioCache (IndexedDB ssi-audio-cache-v2) — see onMounted. The
// legacy OfflineCache + useOfflineCache composable were deleted along
// with DownloadCourseButton / OfflineStatusIndicator; AudioCache is the
// only IndexedDB audio cache now.

/**
 * Resolve an audioId to a URL for the SimplePlayer / useCyclePlayback
 * pipelines (different surface from AudioController's audioSource —
 * these consume `{type:'url', url} | {type:'blob', blob}` and call
 * URL.createObjectURL on the blob branch).
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
 * that streaming-first doesn't need. The per-cycle resolver (lands
 * the playing cycle into AudioCache.persistent) + SimplePlayer
 * .prefetchNextCycle priority hints cover the playback path within
 * the bandwidth envelope (~6 KB/s steady-state).
 *
 * Callers remain wired (line 1453, 1606, 5537) so the call sites
 * stay greppable. The function is a no-op.
 *
 * KEPT: deliberate no-op + greppable handle for a possible opt-in
 * offline-download revival.
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

  // Convert ScriptItem to Cycle (legacy path — the derived currentCycle
  // falls back to this only while the engine has no cycle of its own)
  const cycle = scriptItemToCycle(scriptItem)
  legacyCycle.value = cycle

  // Create audio source resolver for this ScriptItem
  // Uses cached blobs if available, falls back to direct URL playback
  const getAudioSource = resolveAudioFromCache

  // Emit fire-path event for network visualization
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

// Watch cycle playback state and update the LEGACY UI phase (pre-SimplePlayer
// path only — the derived currentPhase ignores this whenever rounds are loaded)
watch(() => cyclePlaybackState.value.phase, (phase) => {
  legacyUiPhase.value = cyclePhaseToUiPhase(phase)
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
// Derived, not watcher-synced (M6, pull-consistency map): the dialog IS the
// engine's buffering phase — a mirror ref could linger visible after a
// missed edge; a computed cannot.
const bufferingPromptVisible = computed(() => simplePlayer.phase.value === 'buffering')
const bufferingPromptMessage = 'Just grabbing the next phrase…'

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

// Start ring animation when the ENGINE enters its pause phase. Keyed off
// simplePlayer.phase directly — this used to hang off the pendingPhase relay
// (engine → onPhaseChanged callback → ref → watcher), an extra push hop the
// derived currentPhase (M2) no longer needs. Starting an animation is a
// legitimate edge reaction; the phase STATE itself is the computed below.
// Both the visible countdown and the SimplePlayer's setTimeout go through
// computePauseDuration(t1, t2, cfg) so admin tweaks to algorithm_config
// affect both in lockstep. cfg is fastConfig or easyConfig — the live
// values from the DB, with DEFAULT_FAST/DEFAULT_EASY as fallback.
//
// A function rather than watcher-body code because the SPEAK phase can now be
// ENTERED FROM ITSELF: tapping the strip's mic segment during the gap restarts
// the engine's pause window, and `watch` on a same-value phase never fires — so
// the countdown would sit at wherever it had got to while the real gap started
// again. Both callers run the same computation.
const startSpeakCountdown = () => {
  const cycle = simplePlayer.currentCycle.value
  const cfg = isEasyMode.value ? easyConfig.value : fastConfig.value
  // Belt proxy for the pause curve — must match getPauseDuration exactly, so
  // the ring and the real gap stay in lockstep. See the note there on why
  // Easy pins it at 1.0 rather than reading the baked belt speed.
  const spd = isEasyMode.value ? Math.min(easyConfig.value.playback_speed, 1.0) : (cycle?.playbackSpeed ?? 1)
  const duration = computePauseDuration(
    cycle?.target1DurationMs ?? 0,
    cycle?.target2DurationMs ?? 0,
    cfg,
    spd,
  )
  startRingAnimation(duration)
}

watch(() => simplePlayer.phase.value, (phase) => {
  if (phase === 'pause') startSpeakCountdown()
})

watch(() => cyclePlaybackState.value.isPlaying, (playing) => {
  if (!playing && !isSkipInProgress.value && !isSkippingBelt.value && !isCycleTransitioning.value) {
    simplePlayer.pause()
  }
})

// State
// Legacy-path UI phase — written ONLY by the pre-SimplePlayer cycle system
// (the cyclePlaybackState watcher above + handleCycleEvent). The derived
// currentPhase ignores it whenever rounds are loaded.
const legacyUiPhase = ref(Phase.PROMPT)
// currentPhase = PULL-CONSISTENT derivation of the engine's phase (M2,
// pull-consistency map). The old design was a writable ref fed by a two-hop
// relay (engine → onPhaseChanged callback → pendingPhase ref → watcher) plus
// two legacy-path writers — the same shape as the pre-878246ff isPlaying
// mirror. A missed hop froze the phase pill, the gap ring gate and the
// voice-2 text while the audio moved on (Jonathan's staging symptoms). A
// computed reads the engine's CURRENT phase — there is no edge to miss.
const SIMPLE_PHASE_TO_UI: Record<string, string> = {
  idle: Phase.PROMPT,
  buffering: Phase.PROMPT, // dialog owns buffering UI; text pane keeps prompt styling
  prompt: Phase.PROMPT,
  pause: Phase.SPEAK,
  voice1: Phase.VOICE_1,
  voice2: Phase.VOICE_2,
}
const currentPhase = computed(() =>
  useRoundBasedPlayback.value
    ? (SIMPLE_PHASE_TO_UI[simplePlayer.phase.value] ?? Phase.PROMPT)
    : legacyUiPhase.value
)

// A1 (metrics): stamp when the current cycle phase was entered, so a phase-pill
// skip can record how long the learner sat in a phase before tapping. Watching
// currentPhase catches every transition regardless of which setter fired.
let phaseEnteredAt = Date.now()
watch(currentPhase, () => { phaseEnteredAt = Date.now() })

const currentItemIndex = ref(0)
// Note: isPlaying is now a computed from simplePlayer (defined above)
const isSkipInProgress = ref(false) // Flag to prevent cycle_stopped from resetting isPlaying during skip
const isCycleTransitioning = ref(false) // Flag to prevent watcher from resetting isPlaying between cycles
const isPreparingToPlay = ref(false) // True when play pressed but audio hasn't started yet
const preparingMessage = ref('') // Current "preparing" message being displayed
// Declared here (not further down with their players) because isAudioPlaying
// below reads them and watch registration evaluates its source getter
// immediately — a later declaration would be a TDZ crash at setup.
const isPlayingIntroduction = ref(false) // True when introduction audio is playing
const isPlayingWelcome = ref(false) // True when welcome audio is playing
// Pause intent raised while a first-play sequence is still awaiting its
// preload/welcome. handleResume's first-play path checks it after every await
// and bails before simplePlayer.play() — a stop tap during the preparing
// window can therefore never be overtaken by audio it can't stop (the
// 2026-06-09 double-tap bug, re-landed from the reverted d5243e42).
const firstPlayPauseRequested = ref(false)

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

// The TRANSPORT-facing play state (nav-bar play/stop button, resting-state
// overlay). FOUNDER INVARIANT: the play button must NEVER read "play" while
// anything is audibly playing — so this ORs EVERY audio source, not just the
// cycle engine: pod laps, commentary, the course welcome, LEGO introductions,
// plus the preparing window between a play tap and the first audible sound
// (so the tap is reflected instantly and a second tap can abort it —
// togglePlayback routes all of these to handlePause). The container PULLS
// this via the template ref (no event hop): a consumer that attaches late
// still reads the current truth, not a missed edge.
// Every source that is actually SOUNDING right now (cycle engine OR pod lap
// OR commentary OR welcome OR introduction). Named once (M8, pull-consistency
// map) so the session timer and the transport signal share one definition —
// the timer used to hand-OR its own copy of this list, and a future audio
// source added to one list but not the other would silently freeze (or
// over-count) the timer.
const isAnythingAudible = computed(() =>
  isPlaying.value
  || playingPodLapAudio.value
  || playingCommentaryAudio.value
  || isPlayingWelcome.value
  || isPlayingIntroduction.value
)
const isAudioPlaying = computed(() =>
  isAnythingAudible.value
  || isPreparingToPlay.value
)
// Window-level echo so components outside this tree (InstallBanner, the
// update-available banner) can gate "never interrupt an active cycle"
// (B6/Gap 4) without prop-drilling isPlaying down from PlayerContainer.
// (The @playStateChanged emit that used to live here died with 878246ff —
// the container pulls isAudioPlaying via the template ref instead.)
watch(isAudioPlaying, (playing) => {
  window.dispatchEvent(new CustomEvent('ssi-play-state', { detail: { playing } }))
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

// Wake lock follows ANY audible audio (cycle, pod, commentary, welcome,
// intro) — the screen shouldn't sleep mid-pod any more than mid-cycle.
watch(isAudioPlaying, (playing) => {
  if (playing) acquireWakeLock()
  else releaseWakeLock()
})

// Re-acquire wake lock when tab becomes visible again (browser releases it on tab switch)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isAudioPlaying.value && !wakeLock) {
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
      // Guard on the FULL audio signal — a lock-screen play tap while a
      // welcome/pod/commentary is sounding must not resume the cycle
      // engine over the top of it.
      if (!isAudioPlaying.value) simplePlayer.resume()
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

watch(isAudioPlaying, (playing) => {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }
})

if (typeof navigator !== 'undefined') {
  setupMediaSession()
}

// Layout mode: 'default' | 'subtitle' | 'floating' | 'minimal'
const layoutMode = ref('subtitle')  // Try subtitle mode by default
const itemsPracticed = ref(0)
const phrasesSpokenCount = ref(0) // Cycles where VAD detected learner speech
const showSessionComplete = ref(false)
// Lifetime learning minutes (would come from persistence in production)
// For now, track session time and estimate based on session history
const lifetimeLearningMinutes = ref(0)

// ============================================
// LEARNING HINTS - Contextual phase instructions
// The worded "you're meant to be speaking now" hint is pure onboarding — the
// phase pill carries phase from then on. So: show it for the FIRST 3 CYCLES of
// each course, persisted PER COURSE (lifetime, not per-session), then hard stop.
// A brand-new course re-onboards gently. Tom 2026-05-30.
// ============================================
const LEARNING_HINT_PROMPT_LIMIT = 3 // first N cycles per course, then retire
const learningHintDismissed = ref(false) // User clicked X to dismiss
const learningHintPromptsShown = ref(0) // cycles shown so far (loaded per course)

// Persist the count per course so the cap is lifetime-per-course. Loaded when
// the course resolves; written on every change.
function learningHintCountKey(): string {
  return `ssi-learning-hint-count-${courseCode.value || 'unknown'}`
}
watch(courseCode, () => {
  try {
    const stored = Number(localStorage.getItem(learningHintCountKey()))
    if (Number.isFinite(stored) && stored > 0) learningHintPromptsShown.value = stored
  } catch { /* localStorage unavailable — fall back to session-only */ }
}, { immediate: true })
watch(learningHintPromptsShown, (n) => {
  try { localStorage.setItem(learningHintCountKey(), String(n)) } catch { /* ignore */ }
})

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

// PER-CONTROL READINESS (Tom, 2026-08-08: "once it APPEARS ready, then it
// should actually be ready").
//
// `loadingStage === 'ready'` means "the lesson exists": script built, rounds in
// memory, position known. It has never meant "a tap makes a sound" — the first
// clip's bytes are warmed off the critical path (see warmFirstKnownAudio). On a
// fast connection those two moments are a third of a second apart, so one flag
// looked honest; on Fast 3G they were seven seconds apart and the play button
// spent that whole window claiming to be ready.
//
// So the play affordance gets its OWN signal: true once the first clip is
// genuinely in hand (or its bounded warm-up has given up, in which case the
// learner must still be allowed to press). Everything else keeps using
// isAwakening — the belt badge and the Easy/Fast switch are v-if'd on it and so
// are honest already (absent rather than fake).
const isFirstClipReady = ref(false)

// The belt screen renders off the contribution fetch, which is deliberately
// scheduled AFTER ready so it doesn't compete for bandwidth. Until that fetch
// settles the belt pill cannot open anything — so it says so (flashes) rather
// than silently swallowing the tap. Settled-with-no-data keeps today's
// behaviour: the pill stops flashing and the tap is a no-op, unchanged.
const contributionSettled = ref(false)
const isBeltScreenReady = computed(() => contributionSettled.value || !!contribution.data.value)
const loadingMessages = ref([]) // Messages that have finished typing
const currentLoadingMessage = ref('') // Message currently being typed

// First-ever-boot brand moment (docs/first-boot-experience.md, 2026-07-03 rethink):
// a global, language-independent welcome sound + one localized text line, shown
// as the FIRST awakening message instead of a random one. Set once in onMounted
// for a genuine first-ever visitor; consumed (and cleared) the first time the
// 'awakening' stage types a message.
const brandMomentPending = ref(false)

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
  // Honest state: a blocking script regeneration is the wait — say so
  // (warm, not technical) instead of a generic atmospheric line.
  if (isRegeneratingScript.value) return scriptUpdatingMessage()
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
    if (brandMomentPending.value) {
      brandMomentPending.value = false
      const langName = getLanguageName(courseTargetLang.value)
      const brandLine = langName && langName !== courseTargetLang.value
        ? t('firstBoot.speakBeforeThem').replace('{lang}', langName)
        : null
      typeLoadingMessage(brandLine || getRandomAwakeningMessage())
    } else {
      typeLoadingMessage(getRandomAwakeningMessage())
    }
  }
}

// ============================================
// SCRIPT FRESHNESS — SWR + honest states (founder ruling 2026-07-27)
// ============================================
// "It should never really be 20 seconds; even when a course is updating it
// doesn't need to refresh the whole cache instantly."
//
//  - STALE-WHILE-REVALIDATE: a content_stamp move no longer drops the cached
//    script (see useScriptCache.checkContentVersion). This session hydrates
//    from the stale cache instantly; runSwrRevalidation regenerates on idle
//    and writes the fresh script for the NEXT session. The live queue is
//    never touched mid-session — corrections land one session later.
//  - HONEST STATES: any unavoidable blocking regeneration types
//    "Updating your course…" on the awakening screen; after a background
//    revalidation completes, the NEXT session shows a small transient
//    "Your course was updated" notice.

// Which path produced this mount's playable rounds — emitted on cold_start so
// the SWR/progressive win is verifiable in player_events.
//   'cache'       warm cache, current vintage
//   'swr'         stale cache served immediately, background revalidation
//   'progressive' /cycles (or /infplay-cycles) bootstrap — playhead segment
//   'infplay_cache' deterministic INF-PLAY tail hydrated from cache
//   'full'        blocking full-course walk (legacy fallback — should be rare)
let coldScriptPath: string | null = null

// Content vintage of the IN-MEMORY rounds (cachedRounds/live queue).
// undefined = live vintage (walk-generated this session); a string/null = the
// rounds were hydrated from a cache entry carrying that stamp (null =
// pre-stamp entry). Queue-derived cache writes (offline download persists)
// pass this through so an SWR session never mis-stamps old rounds as fresh.
let sessionScriptVintage: string | null | undefined = undefined
// Spread into setCachedScript data for writes derived from the live queue.
const queueVintageStampField = (): { contentStamp?: string } =>
  sessionScriptVintage === undefined ? {} : { contentStamp: sessionScriptVintage ?? undefined }

// True while a BLOCKING script regeneration is on the visible critical path
// (legacy full-walk fallback / course switch with no cache). Drives the
// honest "Updating your course…" awakening copy — no silent stalls.
const isRegeneratingScript = ref(false)
const scriptUpdatingMessage = () => {
  const langName = getLanguageName(courseTargetLang.value)
  return langName && langName !== courseTargetLang.value
    ? `Updating your ${langName} course…`
    : 'Updating your course…'
}
const beginBlockingRegenNotice = () => {
  isRegeneratingScript.value = true
  if (loadingStage.value !== 'ready') typeLoadingMessage(scriptUpdatingMessage())
}
const endBlockingRegenNotice = () => { isRegeneratingScript.value = false }

// "Your course was updated" — set when a background revalidation lands,
// consumed (as a small transient notice) on the next player open. Invisible
// maintenance becomes visible care.
const courseUpdatedNoticeKey = (code: string) => `ssi-course-updated:${code}`
const showCourseUpdatedNotice = ref(false)
const maybeShowCourseUpdatedNotice = () => {
  try {
    const key = courseUpdatedNoticeKey(courseCode.value)
    if (localStorage.getItem(key)) {
      localStorage.removeItem(key)
      showCourseUpdatedNotice.value = true
      setTimeout(() => { showCourseUpdatedNotice.value = false }, 6000)
    }
  } catch { /* localStorage unavailable — skip the nicety */ }
}

// Background revalidation: full walk on idle, cache write only (live stamp),
// live queue untouched. Single-flight per course per session.
const swrRevalidatedCourses = new Set<string>()
const scheduleSwrRevalidation = () => {
  const code = courseCode.value
  if (!code || swrRevalidatedCourses.has(code)) return
  swrRevalidatedCourses.add(code)
  scheduleIdleTask(() => { void runSwrRevalidation(code) }, 5000)
}
const runSwrRevalidation = async (code: string) => {
  try {
    // Wait for the boot freshness check to settle (it's fired before the
    // player mounts; this is belt-and-braces for slow connections).
    await awaitFreshnessCheck(code)
    const staleness = getScriptStaleness(code)
    if (!staleness || code !== courseCode.value) return
    const t0 = Date.now()
    console.log(`[ScriptCache] SWR revalidation: regenerating ${code} in background (${staleness.cachedStamp ?? 'pre-stamp'} → ${staleness.liveStamp})`)
    const result = await generateScript()
    if (code !== courseCode.value || !result?.items?.length) return
    const freshRounds = toSimpleRoundsWithComponents(result.items) as any[]
    if (freshRounds.length === 0) return
    // Default stamp = live vintage → this write clears the staleness and the
    // NEXT session hydrates fresh from the cache fast-path.
    await setCachedScript(code, {
      rounds: freshRounds,
      totalSeeds: freshRounds.length,
      totalLegos: freshRounds.length,
      totalCycles: result.cycleCount,
      estimatedMinutes: Math.round(result.cycleCount * 0.2),
      audioMapObj: {},
      courseWelcome: cachedCourseWelcome.value || undefined,
      mainLoopRoundCount: result.mainLoopRoundCount,
    })
    try { localStorage.setItem(courseUpdatedNoticeKey(code), '1') } catch { /* noop */ }
    logEvent('script_revalidated', {
      courseCode: code,
      ms: Date.now() - t0,
      rounds: freshRounds.length,
      fromStamp: staleness.cachedStamp,
      toStamp: staleness.liveStamp,
    })
    console.log(`[ScriptCache] SWR revalidation complete for ${code} in ${Date.now() - t0}ms — fresh script applies next session`)
  } catch (err) {
    // Non-fatal by design: the stale script keeps playing; staleness stands
    // and the next online session retries.
    swrRevalidatedCourses.delete(code)
    console.warn('[ScriptCache] SWR revalidation failed (non-fatal, will retry next session):', err)
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
// Ceiling on the cold boot's first-clip warm-up. Generous on purpose: while it
// runs the play button is FLASHING, which is the honest signal, so the wait
// costs the learner nothing but candour. The ceiling exists only so a dead or
// crawling network can never strand them behind a button that will not light —
// at which point they press, and the old head-miss streaming path takes over
// exactly as before. Measured cold on Fast 3G the clip lands in well under a
// second once it has the link to itself; 2000 ms (the old default) was short
// enough to expire mid-download and release the whole-course walk on top of it.
const FIRST_CLIP_WARM_TIMEOUT_MS = 8000

const warmFirstKnownAudio = async (timeoutMs = 2000) => {
  try {
    const url = cachedRounds.value?.[0]?.cycles?.[0]?.known?.audioUrl
    if (!url || typeof url !== 'string' || url.startsWith('blob:')) return
    // Drain the body. `fetch()` settles on the RESPONSE HEADERS, so the old
    // `.then(() => {})` reported "warm" while the 68 KB was still on the wire —
    // measured cold on Fast 3G it returned in ~300 ms for a clip that took a
    // further 6 s to arrive. Reading the body to completion is what actually
    // fills the HTTP cache entry, which is what makes the learner's tap silent-
    // free. The result is deliberately discarded: the cache is the product.
    const warm = fetch(url, { priority: 'high' })
      .then((r) => r.arrayBuffer())
      .then(() => {})
      .catch(() => {})
    const timeout = new Promise((r) => setTimeout(r, timeoutMs))
    await Promise.race([warm, timeout])
  } catch {
    // never block readiness on a warm-up
  }
}

// Typewriter effect for loading message.
//
// Two hazards this guards against (founder report 2026-07-29: "it gets to
// something like 'getting your course da' and stalls with the word 'data'
// incomplete, and then goes to 'Ready when you are'"):
//
//  1. OVERLAPPING LOOPS — a second typeLoadingMessage() call (course switch,
//     beginBlockingRegenNotice) used to leave the first recursive timeout
//     running, so two loops appended into the same ref and garbled the line.
//     A pending timeout is now cleared, and a generation token retires any
//     callback that survives the clear.
//  2. MID-WORD CUT AT READY — the awakening <p> is v-if'd on isAwakening, so
//     the instant loadingStage flips to 'ready' the partially-typed line is
//     replaced by the resting copy. SWR-warm loads reach ready in ~800ms while
//     a "Getting your Greek course ready..." line needs ~1.4s, so the cut
//     landed mid-word almost every time. finishLoadingTypewriterFast() below
//     completes the line before the flip.
let typewriterTimeout = null
let typewriterGeneration = 0
// The message currently being typed + how far in we are, so the fast-finish
// can complete it rather than guess.
let typewriterMessage = ''
let typewriterCharIndex = 0

const stopLoadingTypewriter = () => {
  if (typewriterTimeout) { clearTimeout(typewriterTimeout); typewriterTimeout = null }
  typewriterGeneration++
}

const typeLoadingMessage = (message) => {
  stopLoadingTypewriter()
  const generation = typewriterGeneration
  currentLoadingMessage.value = ''
  typewriterMessage = message
  typewriterCharIndex = 0

  const typeChar = () => {
    if (generation !== typewriterGeneration) return
    if (typewriterCharIndex < message.length) {
      currentLoadingMessage.value += message[typewriterCharIndex]
      typewriterCharIndex++
      typewriterTimeout = setTimeout(typeChar, 40)
    } else {
      typewriterTimeout = null
    }
  }
  typeChar()
}

// Graceful end for the awakening line: if it's still mid-type when the course
// is ready, finish it at an accelerated rate (never a mid-word freeze), then
// hold a short beat so the completed line is readable. Bounded so a fast load
// never pays more than ~FAST_FINISH_CAP_MS + HOLD_MS: if more characters remain
// than the cap can type, the rest lands in one go rather than stretching ready.
const TYPEWRITER_FAST_CHAR_MS = 12
const TYPEWRITER_FAST_FINISH_CAP_MS = 240
const TYPEWRITER_FINISH_HOLD_MS = 220
const finishLoadingTypewriterFast = async () => {
  const remaining = typewriterMessage.length - typewriterCharIndex
  if (remaining <= 0) { stopLoadingTypewriter(); return }

  stopLoadingTypewriter()
  const generation = typewriterGeneration
  const message = typewriterMessage
  const budgetChars = Math.floor(TYPEWRITER_FAST_FINISH_CAP_MS / TYPEWRITER_FAST_CHAR_MS)

  if (remaining > budgetChars) {
    // Too much left to type even fast — complete it instantly.
    currentLoadingMessage.value = message
    typewriterCharIndex = message.length
  } else {
    await new Promise<void>((resolve) => {
      const typeChar = () => {
        if (generation !== typewriterGeneration) { resolve(); return }
        if (typewriterCharIndex < message.length) {
          currentLoadingMessage.value += message[typewriterCharIndex]
          typewriterCharIndex++
          typewriterTimeout = setTimeout(typeChar, TYPEWRITER_FAST_CHAR_MS)
        } else {
          typewriterTimeout = null
          resolve()
        }
      }
      typewriterTimeout = setTimeout(typeChar, TYPEWRITER_FAST_CHAR_MS)
    })
  }
  if (generation !== typewriterGeneration) return
  await new Promise((r) => setTimeout(r, TYPEWRITER_FINISH_HOLD_MS))
}

// The one way to leave the awakening screen: never cut the line mid-word.
const goLoadingStageReady = async () => {
  await finishLoadingTypewriterFast()
  setLoadingStage('ready')
}

// Introduction playback state
// (isPlayingIntroduction is declared early, next to isPreparingToPlay — see
// the TDZ note there.)
const playedIntroductions = ref(new Set()) // LEGOs that have had their intro played this session
const introductionPhase = ref(false) // True during introduction phase (shows different UI)

// ============================================
// DISTINCTION NETWORK VISUALIZATION
// Split-stage layout: Network Theater + Control Pane
// ============================================
const ringContainerRef = ref(null)
const networkTheaterRef = ref<HTMLElement | null>(null)

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

// Welcome audio state (plays once on first course load)
// (isPlayingWelcome is declared early, next to isPreparingToPlay — see the
// TDZ note there.)
const welcomeChecked = ref(false) // True after we've checked welcome status
const showWelcomeSkip = ref(false) // Show skip button during welcome
const welcomeText = ref('') // Text to display during welcome audio

// Session-wide iOS audio-session keepalive.
//
// 2026-05-23: disabled because the HTMLAudioElement-based impl
// competed with the main <audio> for iOS's single audio-session slot,
// causing a ping-pong (silent loop pauses when main plays → loop's
// pause handler restarts it → iOS steals focus back from main).
//
// 2026-05-26: re-enabled with the rewritten AudioContext-based impl
// (useAudioSessionKeepalive.ts). AudioContext doesn't compete for
// the audio-session slot — it's the session-holder that HTMLAudio
// elements ride on top of, so a running context keeps the session
// warm without grabbing focus from the playing <audio>. Tom 2026-05-26.
const audioEngaged = ref(false)
useAudioSessionKeepalive(audioEngaged)

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

// Return-celebration copy (Gap 3 / gamification-done-right.md §6): a day-3+
// returner sees warmth keyed on days away, instead of the identical
// "ready when you are" a first-timer gets. Days-away, never a streak count —
// consistent with the app's no-streak-guilt stance.
const daysSinceLastPractice = computed(() => {
  if (!savedLastPracticedAt.value) return null
  const msSince = Date.now() - savedLastPracticedAt.value.getTime()
  return msSince / (1000 * 60 * 60 * 24)
})
const restingWelcomeMessage = computed(() => {
  const days = daysSinceLastPractice.value
  if (days === null) return t('resting.readyWhenYouAre', 'Ready when you are')
  if (days >= 30) return t('resting.returnAfter30', "Welcome back. Your brain remembers more than you think.")
  if (days >= 7) return t('resting.returnAfter7', "Deep consolidation complete. You might surprise yourself.")
  if (days >= 3) return t('resting.returnAfter3', "Your brain has been consolidating. Let's see what stuck!")
  return t('resting.readyWhenYouAre', 'Ready when you are')
})

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

// --- Sitting persistence -------------------------------------------------
// The "session" timer is a SITTING (one continuous bout), not a counted
// session. It carries on across a short away-gap and resets after a longer
// one — reusing the SAME 5-min resume window (resumeConfig.cycleResetMinutes),
// so one threshold governs both where you resume AND whether the sitting
// continues. Persisted per-course so reopening within the window resumes the
// same number. Cosmetic — never block playback. See docs/sessions-and-days-active.md
const sittingKey = () => `ssi:sitting:${courseCode.value || 'unknown'}`
function saveSitting(): void {
  try {
    localStorage.setItem(sittingKey(), JSON.stringify({ seconds: sessionSeconds.value, ts: Date.now() }))
  } catch { /* ignore — sitting timer is cosmetic */ }
}
function restoreSitting(): void {
  // Continue the sitting iff we came back within the resume window, else 0:00.
  const windowMs = (resumeConfig.value?.cycleResetMinutes ?? 5) * 60000
  try {
    const raw = localStorage.getItem(sittingKey())
    const prior = raw ? JSON.parse(raw) : null
    if (prior && typeof prior.seconds === 'number' && typeof prior.ts === 'number'
        && (Date.now() - prior.ts) < windowMs) {
      sessionSeconds.value = prior.seconds   // same sitting — keep counting
      return
    }
  } catch { /* fall through to fresh sitting */ }
  sessionSeconds.value = 0                    // new sitting
}

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
      known: restingWelcomeMessage.value,
      target: '',
    }
  }
  // Read from currentCycle to ensure text/audio are locked together
  if (currentCycle.value) {
    // Native script is the primary glyph on romanised courses (the toggle only
    // controls the ruby), so always prefer the native text here.
    const useNative = hasRomanizedText.value
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
watch([() => isTransitioningItem.value, () => currentPhrase.value.known], ([transitioning, newKnown]) => {
  // CRITICAL FIX: Always update if the underlying phrase changed (item transitioned)
  // This prevents showing old known text while new audio plays
  const phraseChanged = newKnown !== lastKnownPhrase.value

  // Never regress a real phrase to blank. currentPhrase falls through to ''
  // when its data source (currentCycle/currentItem) is transiently
  // unavailable — e.g. a network hiccup mid-session (B5: offline permanently
  // blanked the prompt card until reload). All legitimate "nothing to show
  // yet" states already have their own dedicated loading branches earlier in
  // the template (isAwakening/isPreparingToPlay/etc.), so an empty string
  // reaching here is always a transient glitch, never a real state — hold
  // the last-good text instead of blanking, and it self-heals the moment
  // the source recovers and reports real text again.
  if (newKnown === '' && lastKnownPhrase.value !== '') return

  // Update when NOT transitioning, OR when phrase changed (MUST update regardless of transition state)
  if (!transitioning || phraseChanged) {
    displayedKnownText.value = newKnown
    lastKnownPhrase.value = newKnown
  }
}, { immediate: true })

// (The old salient-substring highlight of the known text — salientKnownParts —
// was removed with the uniform-typography pass, Tom 2026-06-07: the display
// box renders the whole known phrase at one bold weight, no salient split.)

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
function currentTargetSpeedConfig(): TargetSpeedConfig {
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
    // No mode term here on purpose. Listening is never slowed — not by belt,
    // not by mode (Tom, 2026-08-16) — and the speaking side's Easy is longer
    // thinking time and more reps, not a slower voice. Nothing in this config
    // needs to know which mode the learner is on.
  }

  // Learner speed preference (from settings, stored in localStorage). A
  // production deep link runs on the DB defaults a fresh learner gets, so the
  // reviewer's own speed preference is not applied (Tom, 2026-08-05).
  const learnerSpeed = learnerDefaultsForced.value
    ? 1.0
    : parseFloat(localStorage.getItem('learner_speed') || '1.0')
  if (learnerSpeed !== 1.0 && !isNaN(learnerSpeed)) {
    targetSpeed.globalSpeed = (targetSpeed.globalSpeed ?? 1.0) * learnerSpeed
  }
  return targetSpeed
}

function toSimpleRoundsWithComponents(items: any[]) {
  // Pause comes from algorithm_config at runtime (see setRuntimeOverrides below);
  // toSimpleRounds bakes a DEFAULT_NORMAL fallback for environments without live config.
  const rounds = toSimpleRounds(items, currentTargetSpeedConfig())
  extractComponentsToMaps(rounds, '[Components] toSimpleRoundsWithComponents')
  return rounds
}

// Cooperative twin for the ready-gated deferred handoff paths: same output,
// but the whole-course conversion yields to the event loop between rounds so
// it can't add a post-READY main-thread block (founder 2026-07-30: READY
// must mean INTERACTIVE). Foreground/interactive callers keep the sync
// wrapper above.
async function toSimpleRoundsWithComponentsSliced(items: any[]) {
  const rounds = await toSimpleRoundsCooperative(items, currentTargetSpeedConfig(), makeSliceYielder())
  // Separate task from the conversion tail; the map fill itself is light.
  await yieldToEventLoop()
  extractComponentsToMaps(rounds, '[Components] toSimpleRoundsWithComponentsSliced')
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
  // Native components are the primary breakdown on romanised courses; the
  // romanisation rides as a ruby line on the tile, not in the component text.
  if (hasRomanizedText.value) {
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
// Round / cycle boundaries unchanged — this is intra-cycle navigation only:
// a tap is a SEEK, it never restarts the cycle and never spends or buys one of
// the cycle's hearings (SimplePlayer.stopForReposition, phaseStripSeek.test.ts).
//
// All four segments, mic included — "once a cycle is playing he should be able
// to go to ANY part of that same cycle freely" (Tom, 2026-08-09).
function jumpToCyclePhase(phase: 'prompt' | 'pause' | 'voice1' | 'voice2') {
  // A1 (metrics): the phase pill is a self-assessment signal. Capture it BEFORE
  // the jump — fromPhase + toPhase + how long they sat there. Direction is the
  // confidence read (forward = "I've got it / verify"; back = "let me re-hear").
  // Raw elapsed + pauseDuration are stored unnormalised (decide the ratio later).
  const toPhase = phase === 'voice1' ? Phase.VOICE_1 : phase === 'voice2' ? Phase.VOICE_2 : phase === 'pause' ? Phase.SPEAK : Phase.PROMPT
  const fromPhase = currentPhase.value
  const order: Record<string, number> = { [Phase.PROMPT]: 0, [Phase.SPEAK]: 1, [Phase.VOICE_1]: 2, [Phase.VOICE_2]: 3 }
  const fromIdx = order[fromPhase] ?? 0
  const toIdx = order[toPhase] ?? 0
  const direction = toIdx < fromIdx ? 'back' : toIdx > fromIdx ? 'forward' : 'replay'
  const cycle = simplePlayer.currentCycle.value
  const phaseSkipPayload = {
    fromPhase,
    toPhase,
    direction,
    elapsed_in_phase_ms: Date.now() - phaseEnteredAt,
    pauseDuration: cycle?.pauseDuration ?? null,
    // OWNERSHIP (what's being taught): the cycle's owner LEGO + role/type.
    cycleId: cycle?.id ?? null,
    cycleType: cycle?.type ?? null,
    legoId: cycle?.legoId ?? null,
    // POSITION (where in the script it played) — logged alongside ownership
    // per docs/position-and-ownership-model.md; the two diverge for spaced-rep
    // reviews. roundNumber is ABSOLUTE (never the session-relative roundIndex);
    // slot is the cycle's index within the round.
    roundNumber: simplePlayer.currentRound.value?.roundNumber ?? null,
    slot: simplePlayer.cycleIndex.value ?? null,
  }
  logEvent('phase_skip', phaseSkipPayload)
  behaviouralEvidence.onPlayerEvent('phase_skip', phaseSkipPayload, cycle)

  simplePlayer.skipToPhase(phase)

  // Re-entering SPEAK from SPEAK restarts the engine's gap but not the phase
  // WATCHER (same value in, no fire), so the countdown is restarted here.
  // Harmless on a fresh entry — the watcher's call and this one compute the
  // same duration from the same cycle.
  if (phase === 'pause') startSpeakCountdown()
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

// REVIEW/PRACTISING cues removed 2026-06-01: the spaced-rep tint + REVIEWING
// legend were internal-facing clarity (which cycle is a revisit), but for the
// learner they're just visual noise over "hear the prompt, have a go". The
// distinction still exists in the engine (currentCycle.type === 'spaced_rep')
// if we ever want to resurface it elsewhere.

// ============================================
// LEARNING HINTS - Computed properties (defined after isIntroPhase)
// ============================================

// Computed: should we show the learning hint?
const showLearningHint = computed(() => {
  // Don't show while paused — currentPhase is frozen at wherever playback
  // stopped, so a paused SPEAK phase would otherwise leave "you're meant to
  // be speaking now" on screen indefinitely (B7: paused-state contradiction).
  if (!isAudioPlaying.value) return false
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
    // Native script is the primary glyph on romanised courses (the toggle only
    // controls the ruby), so always prefer the native text here.
    const useNative = hasRomanizedText.value
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

      // ms-slice plays (fusion-rung chunks cut from a Take G render): seek to
      // startMs once metadata is in, stop at endMs via rAF + a rate-scaled
      // wall-timer backstop. Under a locked screen both freeze — the slice
      // then runs to the clip's natural end and 'ended' still advances the
      // lap (over-plays the chunk's siblings; pacing survives).
      const sliceStart = typeof audioRef.startMs === 'number' ? audioRef.startMs : null
      const sliceEnd = typeof audioRef.endMs === 'number' ? audioRef.endMs : null
      let sliceRaf: number | null = null
      let sliceTimer: ReturnType<typeof setTimeout> | null = null
      const cancelSliceWatch = () => {
        if (sliceRaf != null) { cancelAnimationFrame(sliceRaf); sliceRaf = null }
        if (sliceTimer != null) { clearTimeout(sliceTimer); sliceTimer = null }
      }

      const onEnded = () => {
        cancelSliceWatch()
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
        this.audio?.removeEventListener('loadedmetadata', onSliceMetadata)
        this.currentCleanup = null
        // Only notify if this play wasn't cancelled by a subsequent stop()
        if (this.playGeneration === playGen) {
          this._notifyEnded()
        }
        resolve()
      }

      const onError = (e) => {
        // Audio errors are handled gracefully - cycle continues
        cancelSliceWatch()
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
        this.audio?.removeEventListener('loadedmetadata', onSliceMetadata)
        this.currentCleanup = null
        // Only notify if this play wasn't cancelled
        if (this.playGeneration === playGen) {
          this._notifyEnded()
        }
        resolve()
      }

      const endSlice = () => {
        if (this.playGeneration !== playGen) return
        try { this.audio.pause() } catch {}
        onEnded()
      }
      const onSliceMetadata = () => {
        if (this.playGeneration !== playGen || sliceStart == null || sliceEnd == null) return
        try { this.audio.currentTime = sliceStart / 1000 } catch { /* pre-seek race — play whole */ }
        const endSec = sliceEnd / 1000
        const watch = () => {
          if (this.playGeneration !== playGen) return
          if ((this.audio.currentTime || 0) >= endSec) { endSlice(); return }
          sliceRaf = requestAnimationFrame(watch)
        }
        sliceRaf = requestAnimationFrame(watch)
        const rate = this.audio.playbackRate || 1
        sliceTimer = setTimeout(endSlice, Math.max(0, sliceEnd - sliceStart) / rate + 400)
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
        cancelSliceWatch()
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
        this.audio?.removeEventListener('loadedmetadata', onSliceMetadata)
      }

      // Set source and play
      this.audio.src = url
      this.audio.load()
      // load() is SUPPOSED to reset playbackRate to 1.0, but WebKit/Safari
      // doesn't reliably do so — a prior 2× segment leaks into the next play.
      // So ALWAYS force the intended rate, not just when it's ≠ 1.0: otherwise
      // a 1.0× bookend ("now just listen for a while…") played after a 2× floor
      // seed inherits the stale 2× on Safari and chipmunks. Pod ps2x relies on
      // this too. (Tom 2026-06-16 — heard the bookends at 2× on Safari/WebKit;
      // Chromium resets on load() so the bug was invisible there.)
      this.audio.playbackRate = this.pendingPlaybackRate || 1.0

      // Arm the slice seek+stop (no-op for whole-clip plays).
      if (sliceStart != null && sliceEnd != null) {
        if (this.audio.readyState >= 1) onSliceMetadata()
        else this.audio.addEventListener('loadedmetadata', onSliceMetadata)
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
      legacyUiPhase.value = cyclePhaseToUiPhase(event.phase)
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

      totalCycles.value++

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
        // Advance within current round. Legacy useCyclePlayback path only:
        // the engine is never initialized here, so the pre-engine refs ARE
        // the position store and the derived computeds read them through.
        preEngineItemInRound.value++

        // Check if round is complete
        if (preEngineItemInRound.value >= currentRound.value.items.length) {
          const completedLegoId = currentRound.value.legoId
          const completedRoundIndex = preEngineRoundIndex.value
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
          preEngineRoundIndex.value++
          preEngineItemInRound.value = 0

          // The course never ends. If we've somehow run past the tail of
          // cachedRounds (proactive expansion at line 894 should have kept
          // us ahead), do an emergency expansion and re-check. Only fall
          // back to the summary screen if expansion genuinely can't
          // produce any more content (no LEGOs in the course at all).
          if (preEngineRoundIndex.value >= cachedRounds.value.length) {
            if (offlinePlaybackActive()) {
              // Offline can't expandScript (no network), but the cached
              // script usually has forward rounds the engine lacks — take
              // those first and keep progressing the course. Recycle only
              // when there is genuinely nothing new left. Tom 2026-08-15.
              const forward = await appendForwardFromCacheOffline()
              if (forward === 0) {
                const looped = appendCachedLoopForOffline()
                console.warn(`[LearningPlayer] Offline tail, no forward rounds — looped ${looped} cached rounds`)
              }
            } else {
              console.warn('[LearningPlayer] Ran off the tail of cached rounds — expanding now')
              await expandScript()
            }
            if (preEngineRoundIndex.value >= cachedRounds.value.length) {
              console.error('[LearningPlayer] No more content — showing summary as last resort')
              showPausedSummary()
              return
            }
          }

          console.log('[LearningPlayer] Starting round', preEngineRoundIndex.value, 'LEGO:', cachedRounds.value[preEngineRoundIndex.value].legoId)
          // Round-boundary audio prefetch used to run a legacy
          // prefetchRoundAudio() helper here; streaming-first now
          // handles it via the per-cycle resolver (lands the playing
          // cycle into AudioCache.persistent) + SimplePlayer
          // .prefetchNextCycle warming the upcoming cycle's voices.
        }

        // Get next script item and convert to playable
        const nextScriptItem = currentRound.value?.items[preEngineItemInRound.value]
        if (!nextScriptItem) {
          console.warn('[LearningPlayer] No next script item found')
          return
        }

        // Start next item after delay (ensure text transitions complete)
        // CSS transition is 300ms, so wait 350ms to be safe
        // Set transition flag to prevent watcher from setting isPlaying = false
        isCycleTransitioning.value = true
        console.log('[LearningPlayer] Scheduling next item, nextScriptItem:', nextScriptItem?.type, nextScriptItem?.legoId)
        setTimeout(async () => {
          console.log('[LearningPlayer] setTimeout fired, isPlaying:', isPlaying.value)
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
              if (introPlayable) {
                currentPlayableItem.value = introPlayable

                // Both intro and component_intro: play presentation audio sequence
                // Component intros now have presentation audio ("The X for 'word', as in 'phrase', is:")
                const introPlayed = await playIntroductionAudioDirectly(nextScriptItem)
                if (introPlayed) {
                  console.log('[LearningPlayer]', nextScriptItem.type, 'complete, advancing to next item')
                } else if (nextScriptItem.type === 'component_intro') {
                  // Fallback: no presentation audio available, play target audio only
                  const target1Url = introPlayable.lego?.audioRefs?.target?.voice1?.url
                  if (target1Url && audioController.value) {
                    audioController.value.stop()
                    const tempAudio = new Audio(normalizeAudioUrl(target1Url))
                    await new Promise<void>((resolve) => {
                      // Name the handlers so we can detach them — otherwise the
                      // listeners keep tempAudio referenced after it leaves scope
                      // (an HTMLAudioElement leak per component_intro fallback).
                      const done = () => {
                        tempAudio.removeEventListener('ended', done)
                        tempAudio.removeEventListener('error', done)
                        resolve()
                      }
                      tempAudio.addEventListener('ended', done)
                      tempAudio.addEventListener('error', done)
                      tempAudio.play().catch(() => done())
                    })
                    tempAudio.pause()
                    tempAudio.src = ''
                    await new Promise<void>(r => setTimeout(r, 1000))
                  }
                }

                // Advance to next item in round
                preEngineItemInRound.value++
                // Get and play the next item directly (don't call handleCycleEvent which would double-increment)
                const followingItem = currentRound.value?.items[preEngineItemInRound.value]
                if (followingItem && isPlaying.value) {
                  const followingPlayable = await scriptItemToPlayableItem(followingItem)
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

        // Start next item (with introduction if needed)
        // CSS transition is 300ms, wait 350ms to ensure text fades complete
        setTimeout(async () => {
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

// Tap on ring to toggle play/stop — same dispatch as the nav-bar button so
// the two controls can never disagree about what a tap means (the ring used
// to branch on the cycle engine alone, which mis-routed taps during
// welcome/preparing/pod audio).
const handleRingTap = () => {
  togglePlayback()
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
  behaviouralEvidence.onPlayerEvent('tap_pause', { phase: currentPhase.value }, simplePlayer.currentCycle.value)

  // Stop introduction audio if playing
  if (isPlayingIntroduction.value) {
    skipIntroduction()
  }

  // Stop welcome audio if playing
  if (isPlayingWelcome.value) {
    skipWelcome()
  }

  // Signal any in-flight first-play sequence (awaiting its preload/welcome)
  // to abort before it reaches simplePlayer.play() — see
  // firstPlayPauseRequested. Clearing the preparing state also flips the
  // derived isAudioPlaying back to false immediately.
  firstPlayPauseRequested.value = true
  clearPreparingState()

  // Use SimplePlayer
  simplePlayer.pause()
  // isPlaying derives from the engine — pause() above (plus the skip
  // welcome/introduction calls) makes every audio flag read false. No
  // manual assignment: the derivation cannot desync.

  if (ringAnimationFrame) {
    cancelAnimationFrame(ringAnimationFrame)
  }

  // Flush batched co-fire telemetry on pause (accumulated per cycle).
  void pairingsTelemetry.flush()
  // DB-01: persist any pending mid-round cursor on pause.
  flushCursor()
}

const handleResume = async () => {
  logEvent('tap_play', {
    firstPlay: !hasEverStarted.value,
    roundIndex: simplePlayer.roundIndex.value,
    roundNumber: simplePlayer.currentRound.value?.roundNumber ?? null,
    legoId: simplePlayer.currentRound.value?.legoId ?? null,
  })
  behaviouralEvidence.onPlayerEvent('tap_play', {}, simplePlayer.currentCycle.value)

  // Engage the iOS audio-session keepalive on every play tap. This is
  // the user-gesture moment — the silent loop's first play() hooks into
  // it for the iOS unlock, and it stays running through pauses until
  // explicit stop / session-complete / unmount.
  audioEngaged.value = true
  sessionEnded.value = false
  // Clear any stale pause-intent from a previous tap before we start awaiting.
  firstPlayPauseRequested.value = false

  // ?podview=1 instant pod preview: every tap drives the pod-lap loop
  // directly (startPodPreviewLap), never the main round pipeline below.
  if (podPreviewMode) {
    hasEverStarted.value = true
    localStorage.setItem('ssi-has-played', 'true')
    startPodPreviewLap(podPreviewIndex.value)
    return
  }

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
      // playPodLap sets playingPodLapAudio synchronously on entry, so the
      // derived isAudioPlaying reads true immediately — no manual set.
      const completed = await playPodLap(lap, true)
      if (completed) {
        podScheduler?.markLapCompleted().catch((err) => {
          console.warn('[LearningPlayer] markLapCompleted failed (will retry next session):', err)
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
        // playPodLap has returned (its flag is false) and simplePlayer is
        // paused, so the derived state already reads not-playing.
        userStoppedDuringLap.value = false
        pendingLapResume.value = lap
      } else {
        simplePlayer.resume()
      }
      return
    }
    simplePlayer.resume()
    return
  }

  // FIRST PLAY — full initialization path

  // Reflect the tap IMMEDIATELY: isPreparingToPlay flips the derived
  // isAudioPlaying true (button reads stop, resting overlay hides) before
  // any audio exists — and a stop tap during this window routes to
  // handlePause, which raises firstPlayPauseRequested so we bail below.
  startPreparingState()

  // Ensure audio for first 2 rounds is fully cached before starting
  // Better to wait 1-2s at startup than stall mid-playback
  if (loadedRounds.value.length > 0) {
    const currentIdx = simplePlayer.roundIndex.value ?? 0
    await preloadSimpleRoundAudio(loadedRounds.value, 2, currentIdx)
  }

  // Mark as started so displayPhrases shows cycle text instead of
  // "ready when you are". (The overlay/button read the derived state.)
  hasEverStarted.value = true
  localStorage.setItem('ssi-has-played', 'true')

  // The learner stopped while we were preloading — honour it. Without this
  // check the awaited gap above let a stop tap be overtaken by play():
  // audio started while the button read "play" and could not stop it (the
  // reverted d5243e42 bug, re-landed).
  if (firstPlayPauseRequested.value) {
    clearPreparingState()
    return
  }

  // First-ever course with a welcome: play it once, automatically, before
  // the cycle starts. The Play tap is the user gesture that lets it sound.
  // Streamed (not bundled); playCourseWelcome() marks it heard (localStorage
  // + DB) so it NEVER repeats — any course, any device. Replaces the opt-in
  // banner. Tom 2026-06-02.
  if (welcomeBannerVisible.value) {
    await playCourseWelcome()
    // Same guard after the welcome await: a stop during the welcome must
    // not fall through into the first cycle.
    if (firstPlayPauseRequested.value) {
      clearPreparingState()
      return
    }
  }
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

// Legacy per-course welcome retired for eng-known courses (owner decision
// 2026-07-04): the new global brand-welcome moment (useBrandWelcome.ts) fully
// covers this content for eng-known learners, so playing both back-to-back is
// redundant. Other known languages (spa/jpn/zho/ara) keep the legacy welcome
// until their firstBoot line gets native sign-off. Retire fully (delete this
// gate + the plumbing it guards) when all known languages verified, see owner
// decision 2026-07-04.
const legacyWelcomeRetiredForKnownLang = computed(() => props.course?.known_lang === 'eng')

// First-welcome gate — true only for the very first course a learner ever
// opens, when the course has welcome audio and it hasn't been heard. Now
// gates the AUTO-played welcome on first Play (handleResume), not a banner —
// the opt-in CTA was removed 2026-06-02. All conditions reactive so it flips
// off the instant any heard-signal sets. Tom 2026-05-25 / 2026-06-02.
const welcomeBannerVisible = computed(() => {
  if (legacyWelcomeRetiredForKnownLang.value) return false
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
  if (legacyWelcomeRetiredForKnownLang.value) return
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

const playCourseWelcome = async () => {
  if (legacyWelcomeRetiredForKnownLang.value) return false
  if (welcomeChecked.value) return false
  // Once ever, PER LEARNER (DB-tracked) — survives PWA reinstall / new device /
  // a different course. localStorage 'ssi-welcome-heard' (checked in the loader
  // watchEffect) is just the same-device fast path; learners.welcome_played_at
  // is the cross-device source of truth. Guests have no DB row → fall through to
  // localStorage-only. One DB read here is negligible before a ~1-min welcome.
  if (!isGuestLearner.value && learnerId.value && courseDataProvider.value
      && await courseDataProvider.value.hasPlayedWelcome(learnerId.value)) {
    welcomeChecked.value = true
    localStorage.setItem('ssi-welcome-heard', 'true')
    return false
  }
  try {
    const w = cachedCourseWelcome.value
    if (!w || (!w.s3_key && !w.id)) {
      await markWelcomeHeard()
      return false
    }
    // Route through the same-origin /api/audio proxy (like all lesson audio):
    // it resolves id -> s3_key server-side, avoids the cross-origin ORB block
    // that silently killed the welcome intro, and gets SW CacheFirst caching
    // for free. The old direct-S3 paths 404'd whenever the cached record lacked
    // s3_key (the id-based URL pointed at a non-existent root object).
    const audioUrl = w.id
      ? `/api/audio/${w.id}`
      : `${AUDIO_S3_BASE_URL}/${w.s3_key}`
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
    // A replaced clip arrives as `<uuid>.vN` (per-clip versioned refs — see
    // api/_utils/audioAccess.ts). The suffix is part of the id: it is what
    // AudioCache keys the blob by, so it must survive this round-trip intact.
    // Without `.vN` in the class this match failed outright and the offline
    // collector silently gathered nothing for every revised clip.
    const match = url.match(/\/api\/audio\/([0-9a-f-]+(?:\.v\d+)?)$/i)
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
  // Also persist the position cursor — the dormant moment is the
  // strongest guarantee we get that the learner is about to leave,
  // so capture position alongside audio. The watcher-driven save
  // (phase='prompt' entry) handles steady-state; this covers the
  // case where the user backgrounds the app mid-cycle without
  // advancing. Tom 2026-05-26.
  if (positionInitialized.value && useRoundBasedPlayback.value && !arePositionWritesSuspended()) {
    // Lifecycle save: position only, no practice timestamp.
    savePositionToLocalStorage(simplePlayer.cycleIndex.value, false)
    // Also flush the LIVE position to the DB with the engine's EXACT cycle —
    // the dormant moment is our strongest "about to leave" signal. A
    // cross-device / different-origin resume reads the DB (not this origin's
    // localStorage), so without this it lands at the round's intro. No-op for
    // guests / INF PLAY. Tom 2026-05-30.
    // touchPracticedAt=false: going dormant isn't practising — if they
    // played, the phase='prompt' save already stamped it moments ago.
    persistLivePositionToDb(simplePlayer.cycleIndex.value, false)
  }

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
  if (document.visibilityState === 'hidden') {
    saveResumeAudio()
    void pairingsTelemetry.flush()
    // DB-01: persist any pending mid-round cursor on background.
    flushCursor()
  }
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
 *   3. simplePlayer.runSeek (PlayerConductor) brackets everything below:
 *      pauses the engine (capturing pre-skip play intent in the
 *      seeking(intent) state), then looks up the destination round,
 *      extracts audio IDs from its first cycle, races
 *      audioCache.persistent.ensure on each against a 5s ceiling so a
 *      permanent network failure can't deadlock the skip.
 *   4. Check both staleness signals before jumping: runSeek's own
 *      isStale() (a newer seek — of any kind — superseded us at the
 *      conductor level) and skipPrepToken (a newer prepareAndJump call,
 *      or the component unmounted). Either means bail without jumping —
 *      the newer owner handles its own landing.
 *   5. Clear the dialog, invoke `doJump()`. `doJump` is responsible for
 *      calling simplePlayer.jumpToRound (or jumpToSeed) — the prep
 *      itself doesn't navigate, so callers can carry side effects
 *      (mode flips, belt anchoring, infplay regen) around the jump.
 *      runSeek restores the pre-skip play intent once this returns.
 *
 * Cancellation rules:
 *   - Each new prepareAndJump increments skipPrepToken; a stale prefetch
 *     resolves but its token check fails and it returns without jumping.
 *     runSeek's cancel-and-replace generation counter supersedes the
 *     conductor-level pause/resume bracketing the same way, independently.
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
  // Cancel any in-flight prep — its token becomes stale. This is a SEPARATE,
  // UI-only staleness signal (dialog visibility + unmount cancellation,
  // below) from runSeek's own isStale() (the engine-transition staleness
  // signal) — a newer prepareAndJump call supersedes both independently.
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

  // Bracketed via PlayerConductor.runSeek (docs/player-decomposition-
  // options.md Option 2's seeking(intent) state): every skip — round,
  // cycle, or belt — must stop the current cycle cleanly BEFORE
  // repositioning, so audio and display can never desync. Without this,
  // SimplePlayer kept playing (and could naturally advance on its own)
  // underneath the prefetch below, which can take up to 5s on a cold
  // cache — the display/audio desync and "keeps playing mid-cycle"
  // reports (73c1507a). runSeek captures the pre-skip play intent IN THE
  // STATE and restores it once we've landed, for every exit path.
  await simplePlayer.runSeek(async (isStale) => {
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
        // Past the ceiling we fall through and let SimplePlayer's bounded
        // resolve + phase watchdog + retry-once-then-SKIP machinery handle it
        // cleanly — the destination plays, or is skipped, but never stalls.
        await Promise.race([
          ensurePromise,
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ])
      }
    } catch (err) {
      console.warn('[LearningPlayer] skip-prep prefetch threw — falling through:', err)
    }

    // Bail if a newer skip superseded us at the conductor level (isStale) or
    // the skip-prep dialog's own token (a newer prepareAndJump call, or
    // unmount) — either means a fresher call now owns the landing.
    if (isStale() || myToken !== skipPrepToken) return

    clearSkipPrepDialog()
    doJump()
  })
}

const handleSkip = async () => {
  const tapSkipPayload = {
    direction: 'forward',
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
  }
  logEvent('tap_skip', tapSkipPayload)
  behaviouralEvidence.onPlayerEvent('tap_skip', tapSkipPayload, simplePlayer.currentCycle.value)

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
  // paused for the lap/commentary).
  if (playingPodLapAudio.value || playingCommentaryAudio.value) {
    console.log('[LearningPlayer] Skip during inter-round audio — cancelling')
    if (playingPodLapAudio.value) podLapSkippedByUser.value = true
    podLapCancelled.value = true
    audioController.value?.stop()
    return
  }

  console.log('[LearningPlayer] ========== SKIP REQUESTED ==========')

  // CYCLE advance (bottom-nav › — the finest, most-used control). Step one
  // practice cycle forward (slot +1), crossing round boundaries naturally:
  // the last cycle of a round rolls into the next round's first cycle. The
  // header ‹‹ ›› own the coarser ROUND/LEGO axis.
  //
  // We JIT-prefetch the destination cycle through prepareAndJump so a cold
  // cache doesn't stutter, then stepCycle does the slot arithmetic +
  // jumpToRound (which preserves play state). Because the step may land in a
  // different round, the belt READOUT derives from the round the engine
  // actually landed on (beltAnchorSeed, M9) — never an independent
  // setPlayingPosition.
  console.log('[LearningPlayer] Using SimplePlayer stepCycle(+1) (cycle advance)')
  isSkipInProgress.value = true
  try {
    haltAllPlayback()
    // Resolve the round the +1 step will land in so prepareAndJump can warm
    // the right cycle: stay in this round unless we're on its last cycle.
    const curRound = simplePlayer.currentRound.value
    const atLastCycle = curRound
      ? simplePlayer.cycleIndex.value >= (curRound.cycles.length - 1)
      : false
    const landingRoundIndex = atLastCycle
      ? simplePlayer.roundIndex.value + 1
      : simplePlayer.roundIndex.value
    // Cycle-skip can roll past the last cycle of a round into the NEXT round —
    // gate that crossing so a premium non-subscriber can't cycle-step past the
    // free preview (the round-boundary gate only fires on natural advance).
    if (atLastCycle) {
      const landingSeed = getSeedFromLegoId(loadedRounds.value[landingRoundIndex]?.legoId ?? null)
      if (!gateSeed(landingSeed)) return // finally resets isSkipInProgress
    }
    await prepareAndJump(landingRoundIndex, 'Next cycle…', () => {
      simplePlayer.stepCycle(1)
    })
  } finally {
    isSkipInProgress.value = false
  }
}


/**
 * REVISIT - CYCLE regress (bottom-nav ‹ — the finest, most-used control).
 * Step one practice cycle back (slot -1), crossing round boundaries
 * naturally: the first cycle of a round rolls into the previous round's
 * last cycle. The header ‹‹ ›› own the coarser ROUND/LEGO axis.
 *
 * Delegates the slot arithmetic to SimplePlayer.stepCycle(-1), which routes
 * through jumpToRound (owns stop/play/state). The belt READOUT derives from
 * the landed round so a cross-round step recolours correctly — no
 * celebration when going back.
 */
const handleRevisit = async () => {
  if (!useRoundBasedPlayback.value || cachedRounds.value.length === 0) return

  console.log('[LearningPlayer] ========== CYCLE REGRESS (‹) REQUESTED ==========')

  // Mirror handleSkip's tap_skip so the back/regress button is captured with the
  // same shape — forward vs back then reads as a single queryable signal
  // (skipping forward ≈ confidence; stepping back ≈ revisiting / struggle).
  const revisitPayload = {
    direction: 'back',
    during: 'cycle',
    roundIndex: simplePlayer.roundIndex.value,
    roundNumber: simplePlayer.currentRound.value?.roundNumber ?? null,
    cycleIndex: simplePlayer.cycleIndex.value,
    cycleType: simplePlayer.currentCycle.value?.type ?? null,
    legoId: simplePlayer.currentRound.value?.legoId ?? null,
  }
  logEvent('tap_skip', revisitPayload)
  behaviouralEvidence.onPlayerEvent('tap_skip', revisitPayload, simplePlayer.currentCycle.value)

  haltAllPlayback()
  simplePlayer.stepCycle(-1)
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
 * Enter INF PLAY past the course's final LEGO. Called by the header
 * forward round-nav (‹‹ ››) when the learner is at the final introduced
 * LEGO, and by the belt modal when the picked belt is past course content.
 *
 * Owns: setMode('infplay'), the highest-LEGO ratchet, the lastMainLoopLegoId
 * anchor, the first-INF-PLAY-round jump, the belt anchor (course end seed)
 * and the cursor persist. Was previously the `enterInfplay` branch of
 * handleSkipToNextBelt; extracted so round-forward can reuse it verbatim.
 *
 * The forward header pill is now ROUND/LEGO nav, not belt nav — so the
 * belt-jump else branch that used to live here is gone (belt jumps are
 * MODAL-only via handleSkipToBelt).
 */
const enterInfPlay = async () => {
  cancelInFlightLap()
  // Deliberate ∞ entry outranks the offline belt-held recycle: the learner
  // asked to go somewhere, so the red ∞ is right and the belt un-holds.
  offlineRecycleBeltHeld.value = false
  const currentRound = simplePlayer.currentRound.value

  // Visual belt anchor for INF PLAY entry: the seed of the course's
  // final LEGO. Falls back to a sensible default — the anchor is purely
  // visual (belt label colour) so a mild miss is recoverable.
  const courseEndSeed = (() => {
    const fin = courseFinalLegoRef.value?.legoId
    if (fin) {
      const s = getSeedFromLegoId(fin)
      if (s !== null) return s
    }
    return 668
  })()

  console.log('[LearningPlayer] enterInfPlay called', {
    currentLegoId: currentRound?.legoId,
    currentBelt: playingBelt.value.name,
    courseFinalLegoId: courseFinalLegoRef.value?.legoId ?? '(not yet loaded)',
    isPlaying: simplePlayer.isPlaying.value,
  })

  // INF PLAY is course-end content — far past the free preview. A premium
  // non-subscriber can never legitimately reach it; gate the course-end seed so
  // any path into INF PLAY (round-forward at the final LEGO, belt-forward at
  // course end, the ∞ activator) raises the paywall instead.
  if (!gateSeed(courseEndSeed)) return

  isSkippingBelt.value = true
  try {
    haltAllPlayback()

    {
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
          await activeProgressStore.value.setMode(
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
      const mainLoopCount = mainLoopBoundary()
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
        // Phase 2 (background): everything else — fetch the rest of
        // round 1's cycles + rounds 2..N in parallel-5. By the time
        // the first cycle finishes (~10s), the next cycles are cached.
        warmUpInfPlayRoundsBackground(cachedRounds.value as any, firstInfIdx)
        // Freeze the belt at the course-end seed (= top reachable belt
        // colour for this course). Otherwise the infplay round's random
        // USE legoId would set the visual to whichever LEGO it drew.
        beltFreezeSeed.value = courseEndSeed
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
          // Single-source the boundary on the audio-aware count from this regen
          // before reading it — so the first-revival index matches the script we
          // just appended even when the matview is stale/short.
          if (skipResult.mainLoopRoundCount > 0) {
            liveMainLoopRoundCount.value = skipResult.mainLoopRoundCount
          }
          // Boundary from the live main-loop extent (the single source of truth)
          // — the SAME value the forward/back nav and the tail wrap read, so
          // they all agree on where the revival tail starts.
          const regenBoundary = mainLoopBoundary()
          const refoundIdx = regenBoundary > 0 && newRounds.length > regenBoundary
            ? regenBoundary
            : -1
          if (refoundIdx >= 0) {
            simplePlayer.jumpToRound(refoundIdx)
            beltFreezeSeed.value = courseEndSeed
            await persistCursorAtCurrentRound()
            return
          }
        }
      }
      // No revival rounds from regen (offline, or a course with none) —
      // never stop: recycle cached USE phrases into INF PLAY.
      console.warn('[LearningPlayer] No revival rounds found — recycling cached cycles into INF PLAY')
      await enterInfPlayFromCache()
      return
    }
  } finally {
    isSkippingBelt.value = false
  }
}

/**
 * Forward ROUND advance WHILE IN INF PLAY. Rounds still exist in INF PLAY:
 * the recycled / spaced-rep revival rounds appended after the main loop
 * (indices >= mainLoopCount in cachedRounds). Step to the next one, wrapping
 * back to the first revival round at the tail so forward never dead-ends.
 *
 * Belt stays PINNED to the course's final belt (the infplay rounds carry a
 * random USE legoId that would otherwise bounce the belt indicator) — mirrors
 * enterInfPlay's beltFreezeSeed = courseEndSeed anchor. Bumps the
 * infplayRoundIndex readout (the central-pill "round N"), persists the cursor.
 *
 * If no revival rounds are loaded (offline / a course with none) we recycle
 * cached cycles via enterInfPlayFromCache rather than stalling.
 */
const advanceInfPlayRound = async (fromIdx: number) => {
  const mainLoopCount = mainLoopBoundary()
  const firstInfIdx = mainLoopCount > 0 && cachedRounds.value.length > mainLoopCount
    ? mainLoopCount
    : -1

  // No revival set loaded — recycle cached cycles (never stall the learner).
  if (firstInfIdx < 0) {
    await enterInfPlayFromCache()
    return
  }

  // Step forward through the revival tail; wrap to the first revival round
  // once we run off the end (or somehow sit below the tail).
  let targetIdx = fromIdx + 1
  if (targetIdx >= cachedRounds.value.length || targetIdx < firstInfIdx) {
    targetIdx = firstInfIdx
  }

  const courseEndSeed = (() => {
    const fin = courseFinalLegoRef.value?.legoId
    if (fin) {
      const s = getSeedFromLegoId(fin)
      if (s !== null) return s
    }
    return 668
  })()

  isSkippingBelt.value = true
  isSteppingRound.value = true // round step → no belt overlay
  try {
    haltAllPlayback()
    await prepareAndJump(targetIdx, 'Next…', () => {
      simplePlayer.jumpToRound(targetIdx)
      // Pin the belt to the final belt rather than deriving from the
      // revival round's random USE legoId (which would bounce the indicator).
      beltFreezeSeed.value = courseEndSeed
    })
    // Advance the central-pill ∞ readout ("round N").
    infplayRoundIndex.value = Math.max(1, infplayRoundIndex.value + 1)
    await persistCursorAtCurrentRound()
  } finally {
    isSkippingBelt.value = false
    isSteppingRound.value = false
  }
}

/**
 * HEADER FORWARD ‹‹ ›› — ROUND / LEGO advance.
 *
 * Step to the NEXT introduced LEGO (round +1, by LEGO id). At the FINAL
 * LEGO, advancing ENTERS INF PLAY via enterInfPlay(). WHILE ALREADY IN INF
 * PLAY, forward ADVANCES through the revival rounds (advanceInfPlayRound) —
 * rounds still exist in INF PLAY. Round-back remains the INF-PLAY exit.
 *
 * Position-keyed: lands on the next round's first LEGO via jumpToLegoId,
 * the belt READOUT then DERIVES from the landed round
 * (beltAnchorSeed, M9) — no independent setPlayingPosition. If the
 * next round isn't loaded yet, LOAD-then-resolve (never teleport).
 */
const handleRoundForward = async () => {
  // Skip pressed DURING an inter-round interjection (encouragement /
  // instruction / pod lap): dismiss it and continue into the LEGO that's
  // ALREADY queued — the boundary advanced roundIndex onto it and it's the
  // text on screen, so the learner expects to land THERE, not one past it.
  // Mirror the cycle-skip's commentary branch: cancel + let
  // handleRoundBoundary's resume() play the queued LEGO. Do NOT fall through
  // to cancelInFlightLap()+jump — cancelInFlightLap sets userStoppedDuringLap
  // (which GATES that resume → dead silence) and the +1 jump overshoots the
  // displayed LEGO. Regression from 73f357ff (3-level nav re-pointed the bottom
  // skip here from the commentary-aware handleSkip); telemetry signature was
  // "no tap_skip + no audio_play after commentary_end(cancelled)".
  if (playingPodLapAudio.value || playingCommentaryAudio.value) {
    logEvent('tap_skip', {
      during: playingPodLapAudio.value ? 'pod_lap' : 'commentary',
      via: 'round_forward',
      roundIndex: simplePlayer.roundIndex.value,
      legoId: simplePlayer.currentRound.value?.legoId ?? null,
    })
    if (playingPodLapAudio.value) podLapSkippedByUser.value = true
    podLapCancelled.value = true
    audioController.value?.stop()
    return
  }
  // LEGO-axis forward nav (the interjection-skip above logs its own tap_skip).
  // Forward = "got this / too easy, move on" — the LEGO-scale confidence signal.
  // One emit covers the normal step, the infplay-advance and the course-end
  // paths below; mirror of belt_skip on the coarser axis.
  const legoSkipForwardPayload = {
    direction: 'forward',
    fromLegoId: simplePlayer.currentRound.value?.legoId ?? null,
    roundNumber: simplePlayer.currentRound.value?.roundNumber ?? null,
    slot: simplePlayer.cycleIndex.value ?? null,
  }
  logEvent('lego_skip', legoSkipForwardPayload)
  behaviouralEvidence.onPlayerEvent('lego_skip', legoSkipForwardPayload, null)
  cancelInFlightLap()
  const currentRound = simplePlayer.currentRound.value
  const fromIdx = simplePlayer.roundIndex.value

  // ALREADY in INF PLAY (or sitting on a revival round): rounds still exist in
  // INF PLAY — they're the recycled / spaced-rep rounds appended after the
  // main loop. Forward STEPS THROUGH them (wrapping at the tail) rather than
  // re-entering the mode. Round-back stays the exit/step-back (unchanged).
  if (currentMode.value === 'infplay' || (currentRound && !isMainLoopRound(currentRound))) {
    await advanceInfPlayRound(fromIdx)
    return
  }

  // Entry to INF PLAY is keyed on the FINAL LEGO, not the final belt. We
  // advance LEGO-by-LEGO right through the final belt; only stepping forward
  // FROM the course's final introduced LEGO crosses into INF PLAY. Position is
  // read BY LEGO ID off the canonical map — the final main-loop LEGO is at
  // index boundary-1 (0-based).
  //   - current LEGO at/past it → enter
  //   - LEGO/map not resolved yet → fall back to wouldEnterInfplay
  //     (belt-granular) so we never advance into empty rounds.
  const forwardBoundary = mainLoopBoundary()
  const curMainLoopIdx = mainLoopIndexForLegoId(currentRound?.legoId)
  const atOrPastFinalLego = (forwardBoundary > 0 && curMainLoopIdx >= 0)
    ? curMainLoopIdx >= forwardBoundary - 1
    : wouldEnterInfplay.value
  if (atOrPastFinalLego) {
    await enterInfPlay()
    return
  }

  const targetIdx = fromIdx + 1

  isSkippingBelt.value = true
  isSteppingRound.value = true // LEGO step → no belt overlay
  try {
    haltAllPlayback()

    // Next round not loaded yet — LOAD then re-resolve (load-then-jump).
    if (targetIdx >= cachedRounds.value.length && supabase?.value) {
      console.debug('[LearningPlayer] Round forward: next round not loaded, regenerating script')
      const result = await generateScript()
      if (result.items.length > 0) {
        if (result.mainLoopRoundCount > 0) liveMainLoopRoundCount.value = result.mainLoopRoundCount
        // Must go through mergeGeneratedRoundsIntoQueue, NOT a bare
        // simplePlayer.addRounds — that only grows the engine's internal
        // queue. cachedRounds (read right below, and by the jump target
        // lookup) is a separate mirror; without this it never grows, so
        // targetIdx >= cachedRounds.value.length stays true forever and
        // forward-skip silently no-ops at the loaded edge (round-skip
        // freeze, live session 0c4bc301, 2026-07-21).
        mergeGeneratedRoundsIntoQueue(result.items)
      }
    }
    if (targetIdx >= cachedRounds.value.length) {
      // Couldn't load the next round — if there genuinely is no more main-loop
      // content this is the course end, so enter INF PLAY; otherwise stay put.
      if (wouldEnterInfplay.value) { await enterInfPlay(); return }
      console.warn('[LearningPlayer] Round forward: next round unavailable — staying put')
      return
    }

    // Gate the LEGO-step: if the next round sits past the free preview, raise
    // the paywall instead of advancing (premium non-subscriber).
    const targetForwardSeed = getSeedFromLegoId(cachedRounds.value[targetIdx]?.legoId ?? null)
    if (!gateSeed(targetForwardSeed)) return

    await prepareAndJump(targetIdx, 'Next LEGO…', () => {
      // POSITION nav: prefer the LEGO id, fall back to index — same landing.
      const targetLegoId = cachedRounds.value[targetIdx]?.legoId
      if (targetLegoId) simplePlayer.jumpToLegoId(targetLegoId)
      else simplePlayer.jumpToRound(targetIdx)
    })
    await persistCursorAtCurrentRound()
  } finally {
    isSkippingBelt.value = false
    isSteppingRound.value = false
  }
}

/**
 * Load rounds for a target belt threshold if its first LEGO isn't loaded.
 * Shared helper for belt skip operations. Uses the NEAREST >= resolver so a
 * belt whose first LEGO sits above its threshold seed (the common case) is
 * recognised as already-loaded instead of triggering a needless regen.
 *
 * `forceReload` bypasses the "already loaded" short-circuit. It exists for
 * the INF-PLAY exit: when the loaded queue is only the recycled INF-PLAY
 * set, a high random-USE round can satisfy findRoundIndexForBeltThreshold
 * even though the actual MAIN-LOOP belt rounds aren't present — the
 * short-circuit would then skip the regen and the back-target belt would
 * never load. Callers exiting INF PLAY pass forceReload=true (after flipping
 * mode to 'main', so generateScript walks the full main loop). Note
 * generateSimpleScript always walks the WHOLE inventory (main loop + revival
 * lookahead), so it's not mode-conditional — but flipping mode first keeps
 * downstream state (cursor freeze, belt anchor) consistent with 'main'.
 */
/**
 * Merge freshly-generated rounds (a generateScript() result) into both the
 * live SimplePlayer queue and the component's loadedRounds mirror. Shared by
 * loadSeedIfNeeded (foreground, belt-skip miss) and the INF-PLAY idle warm
 * (background, so a later belt-skip hits the cheap already-loaded path
 * instead of paying this walk at jump time). addRounds dedupes by legoId and
 * inserts in legoId-sorted order — index-safe (shifts roundIndex when
 * inserting ahead of the live cursor), so calling this while INF PLAY is
 * actively playing does not disturb the active round/cycle/phase.
 */
const mergeGeneratedRoundsIntoQueue = (items: any[]): any[] =>
  mergeConvertedRoundsIntoQueue(toSimpleRoundsWithComponents(items))

// Split from the converter so the deferred handoff can convert
// cooperatively (sliced) and merge the already-converted rounds.
const mergeConvertedRoundsIntoQueue = (newRounds: any[]): any[] => {
  if (newRounds.length === 0) return newRounds
  simplePlayer.addRounds(newRounds as any)
  // Keep the component's loadedRounds mirror in lockstep with the engine
  // so cachedRounds[idx] (read by the jump) and updateBeltForPosition see
  // the newly-added main-loop rounds. SimplePlayer.addRounds mirrors into
  // its own roundsRef; loadedRounds is a separate array we must sync here.
  const existingLegoIds = new Set((loadedRounds.value as any[]).map((r) => r.legoId))
  const merged = [...(loadedRounds.value as any[])]
  for (const r of newRounds as any[]) {
    if (existingLegoIds.has(r.legoId)) continue
    const insertAt = merged.findIndex((m) => m.legoId > r.legoId)
    if (insertAt === -1) merged.push(r)
    else merged.splice(insertAt, 0, r)
    existingLegoIds.add(r.legoId)
  }
  loadedRounds.value = merged as any
  return newRounds
}

const loadSeedIfNeeded = async (targetThreshold: number, forceReload = false) => {
  if (!forceReload) {
    const existingRoundIndex = simplePlayer.findRoundIndexForBeltThreshold(targetThreshold)
    if (existingRoundIndex >= 0) return // Already loaded
  }

  if (!supabase?.value) return

  // Course-wide script is the standard now. If the target belt isn't in
  // the current load, regenerate the whole thing — narrow chunks are gone.
  console.debug(`[progressiveLoad] Belt skip: target belt (>= seed ${targetThreshold}) ${forceReload ? 'force-loading' : 'not loaded, regenerating'} full script...`)
  const skipResult = await generateScript()

  if (skipResult.items.length > 0) {
    if (skipResult.mainLoopRoundCount > 0) liveMainLoopRoundCount.value = skipResult.mainLoopRoundCount
    const newRounds = mergeGeneratedRoundsIntoQueue(skipResult.items)
    console.debug(`[progressiveLoad] Belt skip: added ${newRounds.length} rounds`)
  }
}

/**
 * HEADER BACK ‹‹ ›› — ROUND / LEGO regress, replaying the LEGO's debut.
 *
 * Go to the PREVIOUS introduced LEGO and REPLAY its intro/debut: land on
 * that round's START (slot 0) so intro/debut/build play again. The learner
 * can cycle-skip them with the bottom-nav ‹ ›.
 *
 * INF PLAY exit: if we're in INF PLAY, flip mode → main and FORCE a
 * main-loop load (the loaded queue is otherwise only the recycled INF-PLAY
 * set, so the previous main-loop LEGO isn't present) — mirrors the belt-back
 * load-then-resolve fix. Position-keyed throughout; belt DERIVES from the
 * landed round.
 */
const handleRoundBack = async () => {
  cancelInFlightLap()
  const currentRound = simplePlayer.currentRound.value
  // LEGO-axis back nav — a revisit/re-hear gesture (restart the current LEGO, or
  // step to the previous one): the LEGO-scale uncertainty signal, mirror of the
  // forward emit. Covers the infplay step-back and main-loop paths below.
  const legoSkipBackPayload = {
    direction: 'back',
    fromLegoId: currentRound?.legoId ?? null,
    roundNumber: currentRound?.roundNumber ?? null,
    slot: simplePlayer.cycleIndex.value ?? null,
  }
  logEvent('lego_skip', legoSkipBackPayload)
  behaviouralEvidence.onPlayerEvent('lego_skip', legoSkipBackPayload, null)
  // INF PLAY when either the enrollment mode says so OR the current round is
  // a revival round (no intro/debut/build). The mode flag covers a bootstrap
  // that loaded only infplay rounds; the round-shape check covers in-session
  // auto-entry before the flag round-trips.
  const isInfplay = currentMode.value === 'infplay'
    || !!(currentRound && !isMainLoopRound(currentRound))

  console.log('[LearningPlayer] handleRoundBack called', {
    isInfplay,
    currentLegoId: currentRound?.legoId,
    currentRoundIndex: simplePlayer.roundIndex.value,
  })

  isSkippingBelt.value = true
  isSteppingRound.value = true // LEGO step (or INF-PLAY exit) → no belt overlay
  try {
    haltAllPlayback()

    if (isInfplay) {
      // Step BACK one INF PLAY round (Tom 2026-06-03). The bottom-nav back arrow
      // is the ROUND axis, so in INF PLAY it walks the revival tail backwards —
      // it does NOT exit the mode. Exiting INF PLAY is owned by the header ‹‹
      // chevron (handleSkipToPrevBelt) and the belt modal. This is the mirror
      // image of advanceInfPlayRound: queue index −1, clamp at the first revival
      // round, decrement the central-pill ∞ readout, belt pinned to the
      // course-final belt, stay in 'infplay'. The counter bump is local-only,
      // symmetric with the forward button (the DB infplay_round_index only
      // ratchets on natural round completion via saveRoundProgress).
      const mainLoopCount = mainLoopBoundary()
      const firstInfIdx = mainLoopCount > 0 && cachedRounds.value.length > mainLoopCount
        ? mainLoopCount
        : -1
      const fromIdx = simplePlayer.roundIndex.value
      // No revival set loaded, or already at the first revival round → nothing
      // earlier to step to; stay put (use the header ‹‹ chevron / belt modal to
      // leave INF PLAY). Mirrors main-loop back staying put at the first LEGO.
      if (firstInfIdx < 0 || fromIdx <= firstInfIdx) {
        console.log('[LearningPlayer] Round back in INF PLAY: at the first revival round — staying put')
        return
      }
      const targetIdx = fromIdx - 1
      const courseEndSeed = (() => {
        const fin = courseFinalLegoRef.value?.legoId
        if (fin) { const s = getSeedFromLegoId(fin); if (s !== null) return s }
        return 668
      })()
      await prepareAndJump(targetIdx, 'Previous review round…', () => {
        simplePlayer.jumpToRound(targetIdx)
        // Pin belt to the final belt — a revival round's random-USE legoId would
        // otherwise bounce the indicator (mirrors advanceInfPlayRound).
        beltFreezeSeed.value = courseEndSeed
      })
      // Step the central-pill ∞ readout back (floor at 1).
      infplayRoundIndex.value = Math.max(1, infplayRoundIndex.value - 1)
      await persistCursorAtCurrentRound()
      return
    }

    // Main-loop back — "previous track" semantics (Tom 2026-05-30):
    //   • mid-LEGO (cycle > 0)        → first back RESTARTS the current LEGO
    //                                    (jump to its intro, slot 0).
    //   • already at the start (cyc 0) → step to the PREVIOUS LEGO (slot 0).
    // Both land on slot 0 so the intro/debut/build cycles replay. At the very
    // first LEGO's start there's nothing earlier — stay put.
    const fromIdx = simplePlayer.roundIndex.value
    const atCurrentStart = simplePlayer.cycleIndex.value <= 0
    const targetIdx = atCurrentStart ? fromIdx - 1 : fromIdx
    if (targetIdx < 0) {
      console.log('[LearningPlayer] Round back: at the first LEGO start — staying put')
      return
    }
    const restartingCurrent = targetIdx === fromIdx
    await prepareAndJump(targetIdx, restartingCurrent ? 'Start of this LEGO…' : 'Previous LEGO…', () => {
      // POSITION nav: prefer the LEGO id, fall back to index. Always slot 0 so
      // the intro/debut/build cycles replay. Belt DERIVES from the landed round.
      const targetLegoId = cachedRounds.value[targetIdx]?.legoId
      if (targetLegoId) {
        const idx = simplePlayer.findRoundIndexForLegoId(targetLegoId)
        simplePlayer.jumpToRound(idx >= 0 ? idx : targetIdx, 0)
      } else {
        simplePlayer.jumpToRound(targetIdx, 0)
      }
    })

    // Round-back is a revisit gesture — write the cursor so the resting-state
    // choice surfaces next time the player pauses.
    await persistCursorAtCurrentRound()

    console.log(`[LearningPlayer] handleRoundBack: complete, now at round ${targetIdx} slot 0 (${restartingCurrent ? 'restarted current' : 'previous'} LEGO)`)
  } catch (err) {
    console.warn('[LearningPlayer] handleRoundBack error:', err)
  } finally {
    isSkippingBelt.value = false
    isSteppingRound.value = false
  }
}

// Belt pill tap — open the unified progress modal. Persist the in-flight
// play-seconds first (await the write so the read sees it), without stopping
// playback, then refetch — so the modal shows your CURRENT total, not the
// last-flushed snapshot from your last pause.
const handleBeltPillTap = async () => {
  showProgressModal.value = true
  if (!courseCode.value || !supabase?.value) return
  const learnerId = (auth as any)?.learnerId?.value || null
  try {
    await learningSession.flushTelemetryDelta()
  } catch { /* flush is best-effort */ }
  contribution.fetch(courseCode.value, learnerId).catch(() => {})
}

// ∞ activator (belt modal) — the ONE deliberate entry into INF PLAY. The
// central pill stays the ∞ INDICATOR; this button is the ACTIVATOR. The
// modal closes itself (emits close) before this fires; just enter the mode.
const handleActivateInfPlay = async () => {
  showProgressModal.value = false
  await enterInfPlay()
}

// Jump to any belt (from ProgressModal)
const handleSkipToBelt = async (belt: { name: string; seedsRequired: number }) => {
  // Belt is the biggest manual difficulty dial (Principle 1) and the loudest
  // stickability signal there is — belt-back = drowning/consolidating, a dropout
  // precursor. Every belt move (chevron, pill, and the jump modal) routes through
  // here, so one emit captures the whole scale with the intent + timing that
  // position-derivation cannot recover (a rapid jump-back-then-forward that never
  // crosses a round boundary, and how fast they bailed). Capture fromBelt BEFORE
  // the jump below mutates playingBelt.
  const fromBelt = playingBelt.value
  logEvent('belt_skip', {
    fromBelt: fromBelt?.name ?? null,
    toBelt: belt.name,
    direction: belt.seedsRequired > (fromBelt?.seedsRequired ?? 0) ? 'forward'
      : belt.seedsRequired < (fromBelt?.seedsRequired ?? 0) ? 'back' : 'restart',
    targetSeed: belt.seedsRequired === 0 ? 1 : belt.seedsRequired,
    roundNumber: simplePlayer.currentRound.value?.roundNumber ?? null,
  })
  behaviouralEvidence.onPlayerEvent('belt_skip', {}, null)
  showProgressModal.value = false
  const targetSeed = belt.seedsRequired === 0 ? 1 : belt.seedsRequired

  // Belt-skip / jump-to-belt is the biggest leak: a premium non-subscriber must
  // not jump past the free preview. Gate the picked belt's first seed before
  // touching any playback state. (Free/community courses + subscribers pass.)
  if (!gateSeed(targetSeed)) return

  isSkippingBelt.value = true
  // Bracketed via PlayerConductor.runSeek (docs/player-decomposition-
  // options.md Option 2's seeking(intent) state): stops the current cycle
  // cleanly BEFORE the (potentially multi-second, course-wide) load below —
  // otherwise SimplePlayer keeps playing/naturally advancing underneath
  // loadSeedIfNeeded, which is exactly the "player keeps playing mid-cycle
  // after a belt skip" report (73c1507a). runSeek captures the pre-skip
  // play intent in the state itself and restores it once we've landed —
  // for EVERY exit path (normal jump, enterInfPlayFromCache, or a thrown
  // error), not just the happy path. Also gives a rapid double-tap the
  // same cancel-and-replace protection prepareAndJump already had (the
  // second tap supersedes the first at the conductor level).
  await simplePlayer.runSeek(async () => {
    try {
      cancelInFlightLap()
      haltAllPlayback()
      // If we're currently in INF PLAY, picking an earlier content belt must
      // EXIT to main loop. Flip mode FIRST (optimistically — the DB write
      // settles in the background so the jump below isn't blocked on it;
      // failures are logged, not swallowed), then load — the loaded queue is
      // otherwise only the recycled INF-PLAY set and the target belt's
      // main-loop rounds aren't present (the same trap that stranded
      // back-skip). Mirrors handleGoBackBelt's INF-PLAY exit.
      const inInfplay = currentMode.value === 'infplay'
      if (inInfplay && !isGuestLearner.value && progressStore?.value && learnerId.value && courseCode.value) {
        currentMode.value = 'main'
        void activeProgressStore.value.setMode(learnerId.value, courseCode.value, 'main').catch((modeErr) => {
          console.warn('[LearningPlayer] setMode(main) on belt-pill infplay exit failed:', modeErr)
        })
      }
      console.log(`[LearningPlayer] Skipping to ${belt.name} belt - seed ${targetSeed}`, { fromInfplay: inInfplay })

      // Cheap already-loaded check FIRST — the INF-PLAY idle warm (above, near
      // the ∞ bootstrap) usually means the target belt's main-loop rounds are
      // already merged into the live queue, so this returns immediately
      // instead of paying the full course-wide generateScript() walk in the
      // foreground (the several-second belt-jump regression). Only a genuine
      // miss falls through to the regen inside loadSeedIfNeeded.
      await loadSeedIfNeeded(targetSeed)
      // Resolve the picked belt's FIRST LEGO by NEAREST >= match.
      let resolvedTargetIdx = simplePlayer.findRoundIndexForBeltThreshold(targetSeed)
      // Unresolved + we came from INF PLAY: try one more main-loop load. Only
      // after that, a -1 genuinely means the course doesn't extend to this
      // belt (e.g. picking Black on a Brown-capped course) — the ONE legitimate
      // course-end case, so (re-)enter INF PLAY. We never re-enter INF PLAY for
      // a belt the course DOES contain.
      if (resolvedTargetIdx < 0 && inInfplay) {
        await loadSeedIfNeeded(targetSeed, /* forceReload */ true)
        resolvedTargetIdx = simplePlayer.findRoundIndexForBeltThreshold(targetSeed)
      }
      if (resolvedTargetIdx < 0) {
        await enterInfPlayFromCache()
        return
      }
      // Move cursor by LEGO id (POSITION); belt DERIVES from the landed round.
      // Resolve the target LEGO id atomically against simplePlayer's OWN
      // rounds array (the one resolvedTargetIdx was found in) — NEVER by
      // reusing that index against cachedRounds, a separate mirror that can
      // desync from the live queue (e.g. the instant-playback full-script
      // handoff replaces cachedRounds with the whole-course array without
      // touching the live queue). Cross-indexing the two was the belt-skip
      // fencepost bug: it silently landed one seed short of the tapped belt.
      const targetLegoId = simplePlayer.findLegoIdForBeltThreshold(targetSeed)
      if (targetLegoId) simplePlayer.jumpToLegoId(targetLegoId)
      else simplePlayer.jumpToRound(resolvedTargetIdx)

      // Belt-pill jump can land anywhere (forward or back) — persist cursor.
      // Optimistic UI: the learner has already landed on the target round;
      // let the write settle in the background rather than blocking on it
      // (setRemoteCursor inside already logs failures, never throws).
      void persistCursorAtCurrentRound().catch((err) => {
        console.warn('[LearningPlayer] persistCursorAtCurrentRound after belt skip failed:', err)
      })
    } finally {
      isSkippingBelt.value = false
    }
  })
}

// ── Header belt nav (‹‹ ››) — Tom 2026-06-01 ───────────────────────────────
// Header double-chevrons step the BELT axis (LEGO → bottom pill, CYCLE → phase
// pill). Forward → next belt's start, or INF PLAY at course end (reuses the
// wouldEnterInfplay morph). Back → restart the CURRENT belt first, then the
// PREVIOUS belt (mirrors the LEGO back's restart-current-first rule). Both wrap
// handleSkipToBelt, so INF-PLAY exit + cursor persistence come free.
const handleSkipToNextBelt = async () => {
  // Already in INF PLAY → there is nothing past the revival tail to skip
  // forward to, so the belt-forward chevron is a NO-OP (B3). Without this guard
  // wouldEnterInfplay is true in INF PLAY, so this re-ran the full enterInfPlay
  // entry (ratchet + jump-to-first-revival + warm-up overlay) = the whole-screen
  // flash. Stepping THROUGH revival rounds is the bottom-nav forward arrow
  // (handleRoundForward → advanceInfPlayRound), not the belt axis. Position-based
  // (isInfPlayActive) so it also nulls for GUESTS, who never get the mode flag.
  if (isInfPlayActive.value) return
  if (wouldEnterInfplay.value) { await enterInfPlay(); return }
  if (playingNextBelt.value) await handleSkipToBelt(playingNextBelt.value)
}

const handleSkipToPrevBelt = async () => {
  const cur = playingBelt.value
  const startIdx = simplePlayer.findRoundIndexForBeltThreshold(Math.max(cur.seedsRequired, 1))
  if (startIdx >= 0 && simplePlayer.roundIndex.value > startIdx) {
    await handleSkipToBelt(cur)                       // restart the current belt
  } else if (cur.index > 0) {
    await handleSkipToBelt(BELTS[cur.index - 1])      // already at start → previous belt
  }
}

// ============================================
// LEARNING MODE — the two learner-facing modes (Aran's ruling 2026-08-06,
// relayed by Tom). Turbo is retired; there is exactly `easy` and `fast`.
// FAST is the default for everyone and is behaviourally identical to the
// old "normal" mode, so a learner who never touches the toggle sees no
// change at all. EASY doubles the thinking time (runtime, next cycle
// boundary) and doubles the reps and HALVES the longest phrase (script
// shape, next script build).
// ============================================
const learningMode = ref<LearningMode>('fast')
const isEasyMode = computed(() => learningMode.value === 'easy')
/** The live ModeConfig for whichever mode is active. */
const activeModeConfig = computed(() => isEasyMode.value ? easyConfig.value : fastConfig.value)

// ── WHICH CYCLES THIS MODE PLAYS, decided live ────────────────────────────
//
// Tom's architecture call, 2026-08-09: "The instructions for WHICH cycles get
// selected/played and HOW MANY TIMES belongs in the player logic, not the
// cached script data." The rules themselves are pure and live in
// playback/modeCycleSelection.ts; this is the live wiring — a memo of the
// cycles the ACTIVE mode selects out, consulted by the runtime shouldSkipCycle
// gate on every step and thrown away the instant the mode moves.
//
// Whole-queue rather than per-round because the answer is pure and a full pass
// is a few thousand string lengths — cheap, and it happens only when the mode
// changes or the queue grows, never per cycle.
let lastLoggedSelectionMode: LearningMode | null = null
const modeSelectionMemo = {
  ids: new Set<string>(),
  dirty: true,
  roundCount: -1,
  /** Called by every writer of the mode — the next step re-decides. */
  clear() { this.dirty = true },
}

/**
 * High-water mark for "the course's longest phrase", the denominator of Easy's
 * length cap. Held across recomputes because the arrays it is measured from
 * grow and shrink as windows load — and a cap that moves on its own would drop
 * a phrase in one round and play it in the next with the learner doing nothing.
 * Reset on a course change, where the measure genuinely belongs to a new course.
 */
let modeSelectionMaxPhraseLength = 0

/** The active mode's selection rules, straight off its ModeConfig row. */
const currentModeSelectionConfig = (): ModeSelectionConfig => ({
  maxPhraseLengthFraction: activeModeConfig.value.maxPhraseLengthFraction ?? 1,
  filterBuildPhrases: activeModeConfig.value.filterBuildPhrases !== false,
  reviewMaxKnownSyllables: activeModeConfig.value.reviewMaxKnownSyllables ?? 0,
  reviewSyllableFilterMaxRound: normalizeReviewFilterMaxRound(activeModeConfig.value.reviewSyllableFilterMaxRound),
  // Resolved against the COURSE's languages — null (inert) when English is on
  // neither side, exactly as the walk resolved it.
  useWordCap: makeUseWordCap(
    props.course?.known_lang,
    props.course?.target_lang,
    activeModeConfig.value.useWordCapTiers,
  ),
})

/** Recompute the memo when the mode moved, or when the queue grew under it. */
const refreshModeSelection = () => {
  // THE ENGINE'S QUEUE, NEVER THE MIRROR. `loadedRounds` (= cachedRounds) is a
  // text/progress mirror that the instant path deliberately swaps to the
  // WHOLE-COURSE walk while the engine keeps playing the bootstrap's
  // backend-built rounds — the handoff sets it and says in as many words that
  // it "does not touch the live playback queue". The two arrays mint cycle ids
  // in different namespaces: the walk numbers every cycle from one
  // script-global counter (`S0009L01_build_147`), the /cycles endpoint numbers
  // per type per LEGO (`S0009L01_build_2`). So a memo built from the mirror and
  // matched against the engine's cycles agrees on nothing, and
  // `modeSelectsCycleOut` returns false for every cycle it is ever asked about.
  //
  // That was the bug behind "the toggle doesn't change which phrases play"
  // (Tom, 2026-08-09): the repeat lever worked, because it reads config rather
  // than matching ids, while the selection lever was silently inert from the
  // moment the full-script handoff landed — a few seconds into every session,
  // on every course, since INSTANT_PLAYBACK_ALL.
  const rounds = simplePlayer.getEngineRounds() as any[]
  if (!modeSelectionMemo.dirty && modeSelectionMemo.roundCount === rounds.length) return
  modeSelectionMemo.dirty = false
  modeSelectionMemo.roundCount = rounds.length
  modeSelectionMemo.ids.clear()
  const cfg = currentModeSelectionConfig()
  // Fast selects nothing out, so it never pays for the pass — and that is also
  // the proof that Fast's behaviour is bit-identical to before.
  if (selectionIsInert(cfg) || rounds.length === 0) return
  // The cap's denominator is the course's longest phrase. Measured off the
  // engine queue alone that shrinks to whatever window is loaded, so take the
  // whole-course mirror into account too and hold the answer as a high-water
  // mark: the cap may not move under a learner who did nothing.
  modeSelectionMaxPhraseLength = Math.max(
    modeSelectionMaxPhraseLength,
    courseMaxCycleLength(rounds as any),
    courseMaxCycleLength((loadedRounds.value ?? []) as any),
  )
  const ctx = makeModeSelectionContext(
    rounds as any,
    courseCode.value,
    props.course?.known_lang,
    cfg.reviewMaxKnownSyllables > 0,
    modeSelectionMaxPhraseLength,
  )
  for (const round of rounds) {
    for (const id of selectCyclesOutForMode(round as any, cfg, ctx)) modeSelectionMemo.ids.add(id)
  }
  console.log(`[LearningPlayer] Mode selection (${learningMode.value}): ${modeSelectionMemo.ids.size} cycle(s) selected out across ${rounds.length} round(s)`)
  // The console line above does NOT survive a production build — vite.config.js
  // lists console.log/info/debug in `esbuild.pure`, so on dev and prod it is
  // gone. Telemetry is the only channel that survives, and a live probe (or a
  // future me) needs SOME observable that the selection actually re-ran under
  // the new mode. Logged on a MODE CHANGE only, never on the queue simply
  // growing, so this is a handful of rows per session rather than a stream.
  if (lastLoggedSelectionMode !== learningMode.value) {
    lastLoggedSelectionMode = learningMode.value
    logEvent('learning_mode_selection', {
      mode: learningMode.value,
      selectedOut: modeSelectionMemo.ids.size,
      rounds: rounds.length,
    })
  }
}

/** Does the ACTIVE mode play this cycle? Asked per step by shouldSkipCycle. */
const modeSelectsCycleOut = (cycle: { id?: string } | null | undefined): boolean => {
  if (!cycle?.id) return false
  refreshModeSelection()
  return modeSelectionMemo.ids.has(cycle.id)
}

const LEARNING_MODE_KEY = 'ssi-learning-mode'

/**
 * Restore the learner's mode. Order: their stored learner preference (the
 * cross-device source of truth) beats localStorage, which beats the 'fast'
 * default. Anything unrecognised — including a pre-2026-08-06 row that has
 * no `learning_mode` at all — falls through to fast, so nobody is silently
 * moved off the behaviour they have today.
 */
const restoreLearningMode = () => {
  const stored = auth?.learner?.value?.preferences?.learning_mode
  if (stored === 'easy' || stored === 'fast') {
    learningMode.value = stored
    return
  }
  try {
    const local = localStorage.getItem(LEARNING_MODE_KEY)
    if (local === 'easy' || local === 'fast') learningMode.value = local
  } catch { /* storage blocked — fast default stands */ }
}
restoreLearningMode()
// The learner row lands asynchronously after auth resolves; re-read it then
// so a signed-in learner's cross-device choice wins over this device's.
watch(() => auth?.learner?.value?.preferences?.learning_mode, (mode) => {
  if (mode === 'easy' || mode === 'fast') learningMode.value = mode
})

// Any writer of the mode — the toggle, the cross-device preference landing
// after auth, the new-learner default — drops the per-round selection memo.
// The walker asks `shouldSkipCycle` before every step, so the very next step
// re-decides which cycles this round plays under the mode now active. Nothing
// is rebuilt and nothing is invalidated: the queue is the same content either
// way, and the mode is only ever a view of it.
watch(learningMode, () => { modeSelectionMemo.clear() })

// The mode's TUNING is a DB row, and retuning Easy is meant to be a Supabase
// edit rather than a deploy. The rows land asynchronously, so a memo computed
// before they arrive is built from the shipped defaults and — without this —
// would stand for the rest of the session, silently ignoring the live tuning.
watch(algorithmConfigLoaded, () => { modeSelectionMemo.clear() })

// A course change replaces both the queue and the phrase population the length
// cap is measured against. The memo's round-count check cannot see a swap that
// happens to keep the same length, and the high-water mark belongs to the old
// course, so both are dropped explicitly.
watch(courseCode, () => {
  modeSelectionMaxPhraseLength = 0
  modeSelectionMemo.clear()
})

/** Has this learner ever expressed a mode preference — on the learner row
 *  (cross-device) or on this device? An explicit choice outranks any default,
 *  forever, so this gates the new-learner default below. */
const hasChosenLearningMode = (): boolean => {
  const stored = auth?.learner?.value?.preferences?.learning_mode
  if (stored === 'easy' || stored === 'fast') return true
  try {
    const local = localStorage.getItem(LEARNING_MODE_KEY)
    return local === 'easy' || local === 'fast'
  } catch { return false }
}

/**
 * NEW-LEARNER DEFAULT (Aran's ruling via Tom, 2026-08-06).
 *
 * A learner with NO play history starts on EASY. A learner who is already
 * playing keeps TODAY'S behaviour — Fast — so nobody's course silently slows
 * down underneath them mid-flight. That asymmetry is the whole point, and it
 * is why the module default above cannot simply become 'easy': it has to stay
 * Fast so every pre-existing learner, and every path that reads the mode
 * before progress resolves, lands on the unchanged experience.
 *
 * Gated on progressHistoryResolved: before the saved-progress read returns,
 * "no history" and "not loaded yet" are both null, and acting on the second
 * would put an existing learner on Easy — exactly what the ruling forbids.
 *
 * Tom has flagged this default as his to overturn. It is built as ruled.
 */
let newLearnerDefaultApplied = false

const applyNewLearnerModeDefault = () => {
  if (newLearnerDefaultApplied) return
  if (!progressHistoryResolved.value) return
  newLearnerDefaultApplied = true
  const mode = resolveNewLearnerMode({
    progressResolved: true,
    hasChosenMode: hasChosenLearningMode(),
    highestCompletedLegoId: highestCompletedLegoId.value,
    lastCompletedLegoId: lastCompletedLegoIdRef.value,
    highestCompletedRoundIndex: highestCompletedRoundIndex.value,
    completedRounds: completedRounds.value,
  })
  if (!mode) return
  learningMode.value = mode
  // Persisted to both stores so the learner is never re-defaulted once they DO
  // have history, and a second device reads the same mode.
  //
  // Deliberately NOT routed through setLearningMode(): that logs a manual pace
  // judgement to behaviouralEvidence ("this is too fast"), and a silent default
  // is not a judgement — feeding it in would poison the signal with an event
  // the learner never made. It also keeps this clear of the temporal dead zone,
  // since setLearningMode is declared further down and this watcher can fire
  // synchronously during setup for a guest.
  try { localStorage.setItem(LEARNING_MODE_KEY, mode) } catch { /* storage blocked — session default still applies */ }
  auth?.updatePreferences?.({ learning_mode: mode })
}

watch(progressHistoryResolved, () => applyNewLearnerModeDefault(), { immediate: true })

// ============================================
// RUNTIME PAUSE / SPEED OVERRIDES
// Both modes compute pause from their own ModeConfig (algorithm_config
// table, admin-tweakable). Selection switches on `learningMode` at runtime
// — flipping the toggle takes effect on the very next pause / voice phase,
// no script regen, no round-boundary wait. The reps/phrase-length half of
// Easy is script-shape and lands on the next script build instead.
// Listening/pod cycles keep their explicit zero-pause regardless.
// ============================================
const MODE_BYPASS_TYPES = new Set(['intro', 'listening', 'pod', 'listen_intro', 'listen_outro', 'component_intro'])

simplePlayer.setRuntimeOverrides({
  getPauseDuration: (cycle) => {
    // Cycles with no pause (intro/listening/bookend/pod) stay at 0.
    if (!cycle.pauseDuration) return cycle.pauseDuration
    if (cycle.type && MODE_BYPASS_TYPES.has(cycle.type)) return cycle.pauseDuration
    // Recompute pause from raw target durations using the active mode's config.
    // Single source of truth — same helper drives the visible countdown.
    const cfg = isEasyMode.value ? easyConfig.value : fastConfig.value
    // 4th arg is the BELT PROXY for the pause curve (computePauseDuration:
    // beltProgress 0.8→White … 1.0→Green), not a speed knob.
    //
    // Fast reads the baked belt speed, so its pause tapers across belts. Easy
    // deliberately pins 1.0 — i.e. it takes the Green-belt taper at every belt.
    // That is EXACTLY today's Easy timing and it stays that way: Tom's ruling
    // (2026-08-07) was that Easy's pauses and repetitions "are already correct
    // and must NOT be touched"; only the target-voice SPEED override was the
    // bug, and that has been removed (see the note where the overrides object
    // ends). Easy's own belt knobs (pause_belt_boot 0.8 / _assembly 0.95) were
    // tuned against this pinned reading, so switching Easy to the baked speed
    // here would silently lengthen every early-belt Easy pause. If Easy's pause
    // curve is ever retuned, revisit this line at the same time.
    const spd = isEasyMode.value ? Math.min(easyConfig.value.playback_speed, 1.0) : (cycle.playbackSpeed ?? 1)
    const base = computePauseDuration(
      cycle.target1DurationMs ?? 0,
      cycle.target2DurationMs ?? 0,
      cfg,
      spd,
    )
    // Per-LEGO adaptive multiplier (1.0 if engine not ready or legoId missing).
    // Applied last so mode floors/ceilings are still respected before
    // mastery scaling. currentRoundPlan is only ever non-null when adaptation
    // v2 is enabled AND actually applying (not shadow) — see
    // handleRoundBoundary — so this transparently falls back to the untouched
    // v1 mastery ladder in shadow/disabled mode.
    const multiplier = cycle.legoId
      ? currentRoundPlan.value?.pauseMultiplier(cycle.legoId) ?? adaptationEngine.value?.getPauseMultiplier(cycle.legoId) ?? 1.0
      : 1.0
    return Math.max(cfg.min_pause_ms, Math.min(cfg.max_pause_ms, base * multiplier))
  },
  /**
   * How many times this cycle sounds under the mode that is active RIGHT NOW.
   *
   * Read fresh at the END of every cycle, never snapshotted at round start —
   * Tom's ruling after reproducing the mid-round flip on 2026-08-09: "the
   * round walker must read current mode live per-step". Both directions land
   * on the very next step: flip to Fast and the phrase in flight does not
   * repeat; flip to Easy and it does, without waiting for the round boundary.
   *
   * Same two settings the generators use, off the same algorithm_config rows
   * (`phraseRepeatCount`, `repeatedCycleTypes`) — so there is one definition
   * of "Easy doubles the practice", read at build time by the script and at
   * play time by the walker. Fast's count of 1 makes this a no-op.
   *
   * Never repeated: the intro and the bare LEGO debut (not in the type list —
   * "of course not - the intro LEGO and not the LEGO alone"), and any
   * single-audio cycle, which is the drained seed-phase sandwich, pods,
   * listening and bookends — that sandwich is already several hearings of one
   * sentence, so a repeat would breach the never-more-than-twice rule.
   */
  getCycleRepeatCount: (cycle) => {
    if (cycle?.singleAudio) return 1
    if (cycle?.type && MODE_BYPASS_TYPES.has(cycle.type)) return 1
    const { count, types } = currentRepeatConfig()
    if (count <= 1) return 1
    return types.has(cycle?.type ?? '') ? count : 1
  },
  getPostVoice2GapMs: (cycle) => {
    // Easy holds a beat of silence after voice2 before the next cycle starts,
    // "to stop the next cycle just coming in and taking over" (Tom,
    // 2026-08-07) — and, since voice2 is the phase with the target text up,
    // the text stays visible for that beat too. Fast is untouched (its config
    // holds 0), and intro/listening/pod/bookend cycles keep their own baked
    // linger rather than gaining a mode gap on top.
    if (cycle.type && MODE_BYPASS_TYPES.has(cycle.type)) return 0
    const cfg = isEasyMode.value ? easyConfig.value : fastConfig.value
    const gap = cfg.post_voice2_gap_ms
    return typeof gap === 'number' && Number.isFinite(gap) && gap > 0 ? gap : 0
  },
  // NO mode speed override — deliberately absent (Tom's ruling, 2026-08-07).
  //
  // Easy used to cancel the baked belt ramp here and play the target voice at a
  // flat 1.0×, which meant a White-belt beginner on EASY heard speech FASTER
  // than the same beginner on FAST (0.8×) — backwards from what the names
  // promise. Tom: "Easy should follow the exact speed pattern on-ramps for the
  // target language as Fast — but just with bigger pauses, more repetitions and
  // so on as they currently are."
  //
  // So both modes now read the ONE baked speed (`cycle.playbackSpeed`, from
  // `computeCycleSpeed` / `computeListeningSpeed`). Do not reintroduce a mode
  // multiplier: a second speed curve is exactly the bug this area has already
  // paid for twice. The only Easy/Fast differences are pause length, repetition
  // count and phrase-length cap.
  shouldSkipCycle: (cycle) => {
    // Adaptation v2 (WP-3): cull cycles the RatePolicyEngine's RoundPlan
    // says to skip this round, computed live at the round boundary — see
    // handleRoundBoundary). Empty set in shadow/disabled mode, so this is a
    // no-op unless the engine is enabled AND applying.
    if (adaptOmitCycleIds.value.size > 0 && adaptOmitCycleIds.value.has(cycle.id)) return true

    // REPETITION BELONGS TO THE WALKER (Tom, 2026-08-09). Nothing bakes `_x2`
    // copies any more — the builders take MODE_NEUTRAL_REPEATS and the walker
    // decides live, per step, how many times a cycle sounds
    // (getCycleRepeatCount above). This drop stays for the scripts ALREADY in
    // people's caches, which were written while the generators still baked
    // them: keeping those would compound with the live repeat into four plays,
    // and they carry the mode that was active when the script was BUILT, which
    // is exactly the stale snapshot a learner hears as "Fast is still
    // doubling". Harmless on a neutral script — there is nothing to match.
    if (isRepeatCopyCycle(cycle)) return true

    // WHICH CYCLES THIS MODE PLAYS — live, per step (Tom's architecture call,
    // 2026-08-09: "the instructions for WHICH cycles get selected/played …
    // belongs in the player logic, not the cached script data"). The queue is
    // the generous, mode-neutral set; Easy and Fast are two selections over it.
    // Memoised per round because the answer is pure, and the memo is dropped
    // the instant the mode moves — so a toggle re-decides the round in flight
    // before its next step, with no rebuild and no reload.
    if (modeSelectsCycleOut(cycle)) return true

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
      // Same fail-closed rule as the offline gate, over the warm-up set rather
      // than the persistent cache: a BLANK url is silence, not "nothing to
      // check". requiredClipUrls keeps deliberately-single-audio cycles honest,
      // so only genuinely missing clips are skipped.
      const required = requiredClipUrls(cycle as any)
      const warmed = (url?: string | null) => !!url && warmedUpAudioUrls.value.has(url)
      if (required.length === 0 || !required.every(warmed)) {
        return true
      }
    }

    // OFFLINE mode: skip any cycle whose audio isn't fully in the persistent
    // cache. With no network, trying to play a missing clip stalls the lesson
    // (the new-LEGO intro / un-downloaded clip → 60s timeout freeze). Skipping
    // forward to cached cycles + the end-of-rounds offline loop means it
    // degrades to "play whatever IS cached" and never freezes. Tom 2026-05-25:
    // never NOT play something because it can't find the exact next clip.
    if (offlinePlaybackActive()) {
      // FAILS CLOSED (playback/offlinePlayable.ts). The old inline gate answered
      // "cached" for a BLANK url, so an audio-less intro — cycle 0 of the round a
      // resume lands on — was the one cycle guaranteed to survive the filter, and
      // played four phases of silence with its text on screen. Tom's first phrase.
      if (!isCyclePlayableOffline(cycle as any, (id) => audioCache.persistent.has(id))) {
        return true
      }
    }
    return false
  },
  // Offline mode ONLY: rewrite /api/audio/<id> to a local blob: URL from
  // IndexedDB so the main loop plays with no network. Gated on offlineActive
  // so the streaming-first online path never calls this — it's a no-op when
  // offline mode is off, so the iOS streaming behaviour stays exactly as is.
  // getBlobUrl now forces the stored mimeType, which fixes the iOS
  // "operation is not supported" decode failure that got blob playback
  // dropped on 2026-05-23 (a confounded bug, not an iOS limitation).
  resolveAudioUrl: async (audioUrl: string): Promise<string> => {
    // Serve the cached WAV blob when offline OR when online cache-play is on —
    // this is what keeps the MAIN cycle off the network so it survives lock.
    // A genuine cache miss falls through to the network URL (instant first play).
    // resolveCachedPlaybackUrl is the shared substrate the listening overlay
    // also plays through — one definition of "id → lock-safe playable URL".
    if (!offlinePlaybackActive() && !cachePlayOnline) return audioUrl
    const id = audioUrl.match(/\/api\/audio\/([^?]+)/)?.[1]
    if (!id) return audioUrl
    // WAV, not the cached mp3 blob — WebKit refuses mp3 blob: URLs.
    return resolveCachedPlaybackUrl(audioCache, id, audioUrl)
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
  // With streaming-first playback (per-cycle resolution + SW CacheFirst
  // on /api/audio/*), the SW cache is the actual primary path anyway.
  // The blob URL substitution was a leftover optimisation from the
  // previous IDB-as-playback-source design.
  //
  // IDB is still populated by audioCache.persistent.ensure — that's
  // useful for driving mode's chunked accumulation and the future paid
  // "Download for offline" opt-in. It just isn't the source the audio
  // element reads from anymore.
})
const showListeningOverlay = ref(false) // Show listening mode overlay
const listeningOverlayRef = ref<{ stepSentence: (delta: number) => void } | null>(null) // Overlay instance — bottom-nav ‹ › step through it
const showPronunciationOverlay = ref(false) // Show pronunciation mode overlay

// Derived mode signals (M5, pull-consistency map): PlayerContainer PULLS
// these via the template ref for BottomNav/ModeTray. The old
// @listeningModeChanged / @pronunciationModeChanged emit hops (7 sites, each
// hand-paired with an overlay write) are gone — a consumer can no longer
// believe a mode the overlay isn't actually in.
const isListeningMode = computed(() => showListeningOverlay.value)
const isPronunciationMode = computed(() => showPronunciationOverlay.value)

/**
 * Bottom-nav ‹ › while the listening overlay is open: step the overlay's
 * active sentence instead of the main session's LEGO axis. Returns true
 * when handled so the caller can fall through to handleRoundBack/Forward
 * otherwise.
 */
const listeningStep = (delta: number): boolean => {
  if (!showListeningOverlay.value || !listeningOverlayRef.value) return false
  listeningOverlayRef.value.stepSentence(delta)
  return true
}

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
// Driving mode was removed 2026-05-26: with AudioContext keepalive
// (40da47d9), normal-mode cycle-by-cycle play holds the iOS audio
// session through PAUSE phases and backgrounding, so the
// round-concatenation engine the old driving mode used had no job
// left. "Driving" is now just "normal play, locked screen, Media
// Session controls" — no separate UI, no separate engine. The paid
// "download for offline" feature covers the deliberate no-signal case.


// Belt skip feedback state (showBeltModal merged into showProgressModal above)
const isSkippingBelt = ref(false)
// ROUND/LEGO-step nav (header ‹‹ ››, and round-step within INF PLAY) sets this
// alongside isSkippingBelt so it keeps the audio-halt/guard behaviour — but it
// SUPPRESSES the full-screen belt-skip-overlay. A one-LEGO step is not a belt
// jump: the brown "Jumping to next belt…" spinner is the wrong affordance (and
// flashes even on instant cached jumps via the overlay's fade). The inline
// skip-prep dialog ("Next LEGO…", shown only after 200ms) covers any real wait.
const isSteppingRound = ref(false)

// INF PLAY audio warm-up state. Set true while the first batch of
// infplay rounds is being downloaded; gates the play button so the
// learner doesn't tap into silent/stuttering audio. Cleared once the
// blocking download completes; the second phase (rest of script)
// runs in the background and doesn't gate playback.
const isWarmingUpInfPlay = ref(false)

// Tracks URLs the warm-up has successfully cached. Drives the
// shouldSkipCycle gate in INF PLAY so cycles with uncached audio are
// silently dropped (rather than stalling / playing silently) —
// because INF PLAY doesn't need any particular cycle, only that
// SOMETHING with audio plays in each slot.
// KEPT: permanently empty by design (warm-up is a no-op) → the
// "empty set short-circuits to don't-skip" branch disables the INF
// PLAY skip gate intentionally. Load-bearing by documentation.
const warmedUpAudioUrls = ref<Set<string>>(new Set())

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

  // Fetch to warm the SW CacheFirst layer so the first cycle plays instantly.
  // We deliberately do NOT record these URLs in `warmedUpAudioUrls`: doing so
  // made the set non-empty, which ACTIVATED the shouldSkipCycle INF-PLAY cull
  // gate and skipped every cycle except this warmed first one — the cause of
  // "phase/cycle-back works on the first cycle only" (B2). With the set left
  // empty the gate self-disables (its own `size > 0` guard) and INF PLAY
  // cycles play via the same JIT/SW path as the main loop — exactly what the
  // warmUpInfPlayRoundsBackground docblock already assumes. Offline still
  // culls via its own persistent-cache branch in shouldSkipCycle.
  await Promise.allSettled(urls.map(url =>
    fetch(url).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)
  ))
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
 * (per-cycle resolution into AudioCache.persistent + SimplePlayer
 * .prefetchNextCycle warming the SW CacheFirst layer per cycle)
 * covers playback needs without speculative bulk-fetching.
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
// KEPT: deliberate no-op + greppable handle for a possible opt-in
// offline-download revival (see docblock above).
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
        if (result.mainLoopRoundCount > 0) liveMainLoopRoundCount.value = result.mainLoopRoundCount
        cachedRounds.value = fullRounds
        sessionScriptVintage = undefined // fresh walk → live vintage
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

// Adaptation v2 (WP-3): the ONE shared evidence aggregator. Both the latency
// producer (useAdaptationEngine, below) and the behavioural producer
// (useBehaviouralEvidence) feed this SAME instance so their evidence merges
// into one per-LEGO series — passed into useAdaptationEngine's config in
// initializeAdaptationEngine() below.
const sharedEvidenceAggregator = createEvidenceAggregator()

// Behavioural evidence producer (adaptation v2 WP-1) — maps the taps/skips
// already logged below into the shared evidence stream.
const behaviouralEvidence = useBehaviouralEvidence(sharedEvidenceAggregator)

// Envelope evidence producer (adaptation v2 WP-8, stitched WP-3): the model
// envelope cache (WP-7a) is created once Supabase is available (see
// initializeAdaptationEngine below) and read from in onCycleCompleted. Stays
// null under `stage2_enabled:false` (default) or for guests without a
// client — recordEnvelopeEvidence call site below no-ops in that case.
const envelopeMetadataCache = shallowRef<EnvelopeMetadataCache | null>(null)

// Adaptation v2 (WP-3): the latest computed RoundPlan, and the set of cycle
// ids it says to skip this round — both non-null ONLY when the engine is
// enabled AND actually applying (not shadow). shouldSkipCycle/getPauseDuration
// below read these; in shadow/disabled mode they stay empty/null, so nothing
// learner-visible changes (falls through to the untouched v1 pause ladder).
const currentRoundPlan = shallowRef<RoundPlan | null>(null)
const adaptOmitCycleIds = shallowRef<Set<string>>(new Set())

// Per-seed Layer 1 fire-count persistence. Hydrates from learner_l1_state on
// mount, feeds initialL1FireCounts into generateLearningScript so Stage 1→4
// progression compounds across sessions. Bumped each time an L1 cluster
// actually plays (detected in onPhaseChanged below) — not when the script
// emits one (the generator can plan future fires beyond the learner's
// current position).
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
  // Adaptation changes pacing, and its default is off. A production deep link
  // takes the default, not the reviewer's remembered consent.
  if (learnerDefaultsForced.value) {
    adaptationConsent.value = false
    return
  }
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

// Initialize VAD. The Settings-toggle path runs inside a user gesture and
// treats a mic denial as the learner declining (consent revoked). Boot-time
// re-arming for an already-consented learner passes revokeConsentOnDenial:
// false — a transient failure there must not silently flip the learner's
// stored consent off.
const initializeVad = async ({ revokeConsentOnDenial = true } = {}) => {
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
      // If mic denied on an explicit toggle, treat as declined consent
      if (revokeConsentOnDenial) saveAdaptationConsent(false)
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
}

// Close listening overlay and resume main player
const handleCloseListening = () => {
  showListeningOverlay.value = false
  // Don't auto-resume - user will tap to play when ready
}

// Exit listening mode completely - close overlay AND stop all audio
// Called when user navigates away via bottom nav
const exitListeningMode = () => {
  if (showListeningOverlay.value) {
    showListeningOverlay.value = false
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
}

const handleClosePronunciation = () => {
  showPronunciationOverlay.value = false
}

const exitPronunciationMode = () => {
  if (showPronunciationOverlay.value) {
    showPronunciationOverlay.value = false
  }
  handlePause()
}

const handlePronunciationToggle = () => {
  if (showPronunciationOverlay.value) {
    handleClosePronunciation()
  } else {
    if (showListeningOverlay.value) handleCloseListening()
    handlePronunciationMode()
  }
}

// Mode toggle handlers — mutually exclusive
const handleListeningToggle = () => {
  if (showListeningOverlay.value) {
    handleCloseListening()
  } else {
    handleListeningMode()
  }
}

// Exit all overlays — called when navigating away via bottom nav
const exitAllModes = () => {
  if (showListeningOverlay.value) {
    showListeningOverlay.value = false
  }
  if (showPronunciationOverlay.value) {
    showPronunciationOverlay.value = false
  }
  handlePause()
}

/**
 * Switch learning mode.
 *
 * EVERYTHING LANDS ON THE NEXT STEP. There is no longer a split between what
 * takes effect now and what waits for a rebuild, because a mode is no longer
 * anything the script knows about.
 *
 * Tom's architecture call, 2026-08-09, after two attempts had put the fix in
 * the wrong layer: "the instructions for WHICH cycles get selected/played and
 * HOW MANY TIMES belongs in the player logic, not the cached script data.
 * Speed and pause-length are already correctly read live by the player (this
 * part works)." So the mode now works the way speed and pause already did:
 *   • pause / thinking time and playback speed — runtime overrides, read fresh
 *     at every phase (unchanged, and the proof the pattern works);
 *   • HOW MANY TIMES a cycle sounds — `getCycleRepeatCount`, asked at the
 *     moment a cycle ends, so Easy→Fast drops the second play of the phrase in
 *     flight and Fast→Easy grants it;
 *   • WHICH cycles play — `shouldSkipCycle`, which consults the per-round
 *     selection computed by playback/modeCycleSelection.ts. The memo is
 *     dropped on every mode change, so the walker re-decides the current round
 *     before its very next step.
 *
 * The script itself is generated mode-neutral and generous: one walk, both
 * modes, cached and never invalidated by a toggle. That is what makes all
 * three of the above possible without a query, a rebuild or a reload.
 */
const setLearningMode = (mode: LearningMode) => {
  if (learningMode.value === mode) return
  learningMode.value = mode
  modeSelectionMemo.clear()
  // Signed-out learners only have localStorage; signed-in learners get both
  // so a fresh device still reads the right mode before auth resolves.
  try { localStorage.setItem(LEARNING_MODE_KEY, mode) } catch { /* storage blocked */ }
  auth?.updatePreferences?.({ learning_mode: mode })
  // Manual pace control — a no-mic behavioural signal, exactly as the Turbo
  // toggle was: easy = "this is too fast", fast = "I'm comfortable".
  logEvent('learning_mode_toggle', { mode })
  behaviouralEvidence.onPlayerEvent('learning_mode_toggle', { mode }, null)
}

const toggleLearningMode = () => {
  setLearningMode(isEasyMode.value ? 'fast' : 'easy')
}

// Offline mode: a deliberate, opt-in download of the upcoming course content
// into IndexedDB, after which playback resolves to local blob: URLs (the main
// loop via the SimplePlayer resolveAudioUrl override; pods/intros via the
// createAudioCacheSource gate). The streaming-first online path is untouched.
// Depth is chosen by the learner as a % of the course (see the depth-knob note
// further down) — NOT a time span, because offline never stops (it recycles via
// INF PLAY). The only deliberate downloader; normal play streams and caches
// nothing speculatively.
// Rolling online warm-ahead (buffer-model step 1a). A shallow span the filler
// keeps cached in IndexedDB during normal online play, so playback can later
// resolve from cache (surviving connection loss / lock mid-session) instead of
// streaming every clip. Deliberately SHALLOW to start: speculative ahead-fetch
// was disabled 2026-05-23 for contending with the live play fetch (the
// pipe-hogging stalls). We re-enable it gently (sequential, missing-only) and
// will only deepen once a device test confirms it doesn't starve playback.
// 2026-06-01: device-confirmed clean on a 3G throttle, and Afrikaans telemetry
// showed the cold-start window (first ~10 min still streaming, cacheHit low) is
// the only lock-fragile gap. So deepen the steady span, and add a fast BURST
// span fired at non-lock moments (session start, about-to-hide, stop) to warm
// the head quickly and keep a restart / backgrounded app supplied.
const ROLLING_SPAN_MS = 20 * 60 * 1000
const BURST_SPAN_MS = 10 * 60 * 1000
const offlineActive = ref(false)
// Offline PLAYBACK engages on the explicit toggle OR whenever the device is
// genuinely offline. The `!isOnline` disjunct is the airplane-mode backstop
// (Tom 2026-05-28: 441 files cached but none played, because offlineActive had
// reset after a reload, so the player streamed /api/audio and every clip failed
// offline). Download gates stay on the explicit toggle — downloading is a
// deliberate, online action.
//
// The SELECTION now also PERSISTS per course (Tom 2026-07-31: "once selected
// … should ALWAYS ALWAYS ALWAYS actually play from the offline cache and
// NEVER check for online status"). An in-memory-only toggle silently dropped
// the learner back to streaming on any reload — and previews self-update the
// SW, which reloads — leaving downloaded courses at the mercy of
// navigator.onLine, which lies on weak signal/captive portals. Set on
// download completion, cleared on explicit toggle-off; restored at mount
// before first play. The lease lock still governs (premium design).
const OFFLINE_MODE_KEY_PREFIX = 'ssi-offline-mode-'
const persistedOfflineModeOn = (): boolean => {
  // A production deep link listens to what is live NOW — a persisted offline
  // course would serve cached audio and hide a clip that was just repaired.
  if (learnerDefaultsForced.value) return false
  try { return localStorage.getItem(OFFLINE_MODE_KEY_PREFIX + courseCode.value) === '1' } catch { return false }
}
const persistOfflineModeOn = (): void => {
  try { localStorage.setItem(OFFLINE_MODE_KEY_PREFIX + courseCode.value, '1') } catch { /* storage blocked — toggle still works this session */ }
}
const clearPersistedOfflineMode = (): void => {
  try { localStorage.removeItem(OFFLINE_MODE_KEY_PREFIX + courseCode.value) } catch { /* ignore */ }
}
// 30-day offline lease (the "Spotify handshake"). The lease is granted at the
// end of a deliberate download and slid forward by useOfflineLease's renewals.
// When it expires (offline >30d or sub lapsed past the graceful tail) offline
// playback LOCKS — the bytes stay, a reconnect re-validates and unlocks.
const offlineLease = useOfflineLease()
// Reactive lock flag for THIS course, set by checkOfflineLease() at the offline
// boot fast-path and whenever we fall into offline playback. Drives the lock UI.
const offlineLeaseLocked = ref(false)
const offlineLeaseExpiryLabel = ref<string | null>(null)

// Re-validate the lease for the current course. Returns true if offline play is
// allowed. Sets the lock flag + expiry label for the UI. The hot playback path
// reads the cheap `offlineLeaseLocked` flag; this async check refreshes it.
const checkOfflineLease = async (): Promise<boolean> => {
  const code = courseCode.value
  if (!code) return true
  const ok = await offlineLease.isCourseLeaseValid(code) // local IndexedDB read — cheap, no network
  // Only LOCK a course that actually carries a lease (was downloaded). A 'none'
  // status means no deliberate download → nothing to lock (the user streams).
  const locked = !ok && offlineLease.statusFor(code) !== 'none'
  offlineLeaseLocked.value = locked
  if (locked) {
    offlineLeaseExpiryLabel.value = await offlineLease.expiryLabelFor(code)
    offlineDlState.value = 'locked'  // ModeTray Offline row + ring (amber)
  } else if (offlineDlState.value === 'locked') {
    offlineDlState.value = 'idle'    // re-validated → drop the locked badge
  }
  // Self-heal in the BACKGROUND when online: an expired lease on an active user
  // usually just means the renew hasn't landed yet. Renew + re-read, but NEVER
  // block boot/playback on it — a weak signal must not hang the app (the renew
  // itself has a hard timeout and fails open). A successful renew flips the flag.
  if (locked && navigator.onLine) {
    void offlineLease.renewLeases().then(async () => {
      const okAfter = await offlineLease.isCourseLeaseValid(code)
      const stillLocked = !okAfter && offlineLease.statusFor(code) !== 'none'
      offlineLeaseLocked.value = stillLocked
      if (!stillLocked && offlineDlState.value === 'locked') offlineDlState.value = 'idle'
    }).catch(() => { /* keep the pre-renew decision */ })
  }
  return locked ? false : ok
}

// Soonest entitlement-code expiry that grants offline for THIS course (epoch ms),
// or null for an open-ended subscription / admin / full grant. The lease clamps
// to this so it can't outlive a time-boxed code.
const entitlementExpiryForCurrentCourse = (): number | null => {
  const code = courseCode.value
  let soonest: number | null = null
  for (const e of liveEntitlements.value || []) {
    const grantsThis =
      e.accessType === 'full' ||
      (e.accessType === 'courses' && !!code && (e.grantedCourses || []).includes(code))
    if (!grantsThis) continue
    if (!e.expiresAt) return null // an open-ended grant means no clamp
    const ms = new Date(e.expiresAt).getTime()
    if (Number.isFinite(ms)) soonest = soonest == null ? ms : Math.min(soonest, ms)
  }
  return soonest
}

const grantOfflineLeaseForCurrentCourse = async (): Promise<void> => {
  const code = courseCode.value
  if (!code) return
  try {
    await offlineLease.grantLease(code, entitlementExpiryForCurrentCourse())
    offlineLeaseLocked.value = false
    offlineLeaseExpiryLabel.value = await offlineLease.expiryLabelFor(code)
  } catch (e) {
    console.warn('[Offline] grantLease failed (non-fatal):', e)
  }
}

// Gate the START of an offline download. The DOOR is open to everyone — offline
// is the convenience we sell, on every course incl. free/community (we never
// charge for the learning itself). Non-payers get ONE free 30-day taste per
// course via the lease. Once that taste has LAPSED, re-downloading would silently
// reset it (and re-bill us the egress), so that's the conversion moment: raise the
// paywall instead. A first-ever download ('none') or an in-window trial ('valid')
// passes; payers (offlineRenews) always pass.
const canStartOfflineDownload = async (): Promise<boolean> => {
  const course = props.course
  if (!course) return true
  if (entitlementComposable.offlineRenews(course)) return true // payer → unlimited
  const code = courseCode.value
  if (code) {
    // Refresh the per-course lease status from disk before judging.
    await offlineLease.isCourseLeaseValid(code).catch(() => { /* fail-open */ })
    const status = offlineLease.statusFor(code)
    if (status === 'expired' || status === 'clock-untrusted') {
      showPaywall.value = true
      return false
    }
  }
  return true
}

// Offline PLAYBACK engages on three signals, and the deliberate toggle is only
// the first of them:
//   1. offlineActive — the learner chose it (or a completed download set it).
//   2. !isOnline     — the browser admits it is offline (airplane mode).
//   3. isNetworkPresumedDown() — we OBSERVED the critical path stalling.
//
// (3) is the weak-signal case, and it is the one Tom's 2026-08-15 ruling was
// actually about: `navigator.onLine` reports TRUE on a connection so weak that
// nothing completes, so (2) alone left a learner streaming into a hang with a
// full cache on the device. The behavioural distinction between deliberate
// offline and accidental offline is retired here — a learner who forgot to
// flip the toggle now gets exactly what one who remembered gets.
//
// The toggle survives as INTENT (don't spend my data on background downloads,
// and the UI copy), not as playback permission. The lease lock still governs.
const offlinePlaybackActive = (): boolean =>
  (offlineActive.value || !isOnline.value || isNetworkPresumedDown()) && !offlineLeaseLocked.value

// Which belts the pill nav must grey out while offline. A belt is available
// offline iff its landing round (the belt's first LEGO, via findRoundIndex-
// ForBeltThreshold) has at least one cycle whose audio is ACTUALLY in the
// persistent cache — not merely a loaded round object. cachedRounds (script
// structure) races well ahead of audioCache (the heavy bytes): background
// script expansion can populate rounds for belts whose audio was never
// fetched, so a round-presence-only check under-greys and a tapped pill
// would land on silence. Mirrors shouldSkipCycle's own offline audio-
// presence check (the engine's own bar for "playable offline"), so a pill
// reads available exactly when landing there would actually produce sound.
// White belt (seedsRequired 0, the course start) is always present.
const offlineUnavailableBeltNames = computed<Set<string>>(() => {
  if (!offlinePlaybackActive()) return new Set()
  const rounds = cachedRounds.value || []
  const names = new Set<string>()
  for (const belt of BELTS) {
    if (belt.seedsRequired === 0) continue
    // Resolve the target LEGO id against the live engine's own rounds queue,
    // then look IT up (by value, not by index) in cachedRounds — the same
    // index would point at a different round in each array if the two have
    // diverged (see findLegoIdForBeltThreshold's doc comment).
    const targetLegoId = simplePlayer.findLegoIdForBeltThreshold(belt.seedsRequired)
    const round = targetLegoId ? rounds.find((r: any) => r?.legoId === targetLegoId) : null
    const cycles = (round as any)?.cycles || []
    // Same fail-closed gate the engine uses, so a pill reads available exactly
    // when landing there would actually produce sound — a blank-url cycle no
    // longer makes a belt look reachable and then hand the learner silence.
    const hasPlayableCycle = cycles.some((c: any) =>
      isCyclePlayableOffline(c, (id) => audioCache.persistent.has(id)))
    if (!hasPlayableCycle) names.add(belt.name)
  }
  return names
})
// Offline-download progress state (offlineDlState/Done/Total/Failed) is imported
// from useOfflineDownloadStatus and written by downloadForOffline below. The UI
// for it now lives on the mode button (the ring) + the Offline row in ModeTray,
// not a floating banner here. Because those refs are page-lifetime singletons,
// a fresh player instance must start them clean, and on teardown we drop
// offlineActive so any in-flight downloadForOffline loop (whose cancel-guard is
// this instance's offlineActive) stops writing the shared refs for the next
// course's ring.
onMounted(() => { resetOfflineDownloadStatus() })
onUnmounted(() => { offlineActive.value = false })

// Estimated wall-clock (ms) of play currently sitting in cachedRounds from
// the current round forward. Used to decide whether we've loaded enough
// rounds to cover the offline span.
const loadedSpanMsFromHere = (): number => {
  const rounds = cachedRounds.value || []
  const start = Math.max(0, currentRoundIndex.value)
  let accMs = 0
  for (let i = start; i < rounds.length; i++) {
    for (const c of (((rounds[i]) as any).cycles || [])) {
      accMs += 2000 + (c?.pauseDuration ?? 0) + (c?.target1DurationMs ?? 2000) + (c?.target2DurationMs ?? 2000) + 1000
    }
  }
  return accMs
}

// Walk forward from the current round, accumulating estimated wall-clock time
// per cycle, collecting unique /api/audio ids until ~spanMs of play is covered.
// Dedupes files (a clip reused N times in the span counts once). Used by the
// rolling online filler (ROLLING_SPAN_MS) — the deliberate offline download
// uses the round-based collector below (depth = % of course, not ms).
const collectSpanAudioIds = (spanMs: number): string[] => {
  const rounds = cachedRounds.value || []
  const start = Math.max(0, currentRoundIndex.value)
  const ids = new Set<string>()
  const add = (url?: string) => {
    const m = typeof url === 'string' ? url.match(/\/api\/audio\/([^?]+)/) : null
    if (m) ids.add(m[1])
  }
  let accMs = 0
  for (let i = start; i < rounds.length && accMs < spanMs; i++) {
    for (const c of (((rounds[i]) as any).cycles || [])) {
      add(c?.known?.audioUrl); add(c?.target?.voice1Url); add(c?.target?.voice2Url)
      // prompt + pause + both target plays + inter-phase gaps
      accMs += 2000 + (c?.pauseDuration ?? 0) + (c?.target1DurationMs ?? 2000) + (c?.target2DurationMs ?? 2000) + 1000
    }
  }
  return [...ids]
}

// How many rounds the rolling span (re)covers ahead of the cursor — same
// per-cycle wall-clock estimate collectSpanAudioIds uses, counted in ROUNDS so
// we can ask the pod / Layer-1 schedulers which laps fire in that window.
// Lower-bounded at 1 so we always look at least one round ahead even when the
// loaded rounds are long. Used ONLY to bound the extras enumeration; it never
// gates cycle warming (cycles are collected by ms span as before).
const roundsCoveredBySpan = (spanMs: number): number => {
  const rounds = cachedRounds.value || []
  const start = Math.max(0, currentRoundIndex.value)
  let accMs = 0
  let n = 0
  for (let i = start; i < rounds.length && accMs < spanMs; i++) {
    n++
    for (const c of (((rounds[i]) as any).cycles || [])) {
      accMs += 2000 + (c?.pauseDuration ?? 0) + (c?.target1DurationMs ?? 2000) + (c?.target2DurationMs ?? 2000) + 1000
    }
  }
  return Math.max(1, n)
}

// Pod-lap audio ids that WILL play within the next `spanMs` of cycle play.
//
// Pods advance on a ratchet (completed_pod_rounds), not on a round number, so
// nextLap() composes only the IMMEDIATELY-NEXT lap (it reads the live ratchet).
// That's exactly what's needed: pods fire at most once per played lap, each lap
// reuses a slice of the same small bounded sentence pool, and the per-boundary
// handler advances the ratchet as laps play. So warming the next due lap keeps
// the upcoming pod cached even across a backgrounded span that crosses several
// boundaries — the ratchet hasn't moved for laps not yet played, and once one
// plays the next round-advance re-warms. Returns [] when no pod is due anywhere
// in the span (cheap no-op — same shape as collectSpanAudioIds: bare audio ids).
const collectPodSpanAudioIds = (spanMs: number): string[] => {
  if (!podScheduler || !podScheduler.isInitialized.value) return []
  const cursor = Math.max(0, currentRoundIndex.value)
  const lastRound = cursor + roundsCoveredBySpan(spanMs)
  // mainRound passed to shouldFireLapAt is 1-based (cursor+1 = current round).
  // Cheap scan bounded by the span's round count.
  let firesInSpan = false
  for (let mr = cursor + 1; mr <= lastRound + 1; mr++) {
    if (podScheduler.shouldFireLapAt(mr)) { firesInSpan = true; break }
  }
  if (!firesInSpan) return []
  const lap = podScheduler.nextLap()
  if (!lap) return []
  const ids = new Set<string>()
  if (lap.intro?.id) ids.add(lap.intro.id)
  if (lap.outro?.id) ids.add(lap.outro.id)
  for (const p of lap.plays) if (p.audioId) ids.add(p.audioId)
  return [...ids]
}

// Layer-1 listening audio ids that WILL play within the next `spanMs`. Unlike
// pods, an L1 lap is a PURE function of (catalogue, round, learner) —
// nextLap(mainRound) is fully deterministic — so we enumerate every L1 cup due
// in the round window ahead of the cursor and warm all their audio. Includes pod
// rounds (the cup now segues in front of the pod, so its audio plays there too).
// Returns [] when no L1 cup falls in the span (cheap no-op).
const collectLayer1SpanAudioIds = (spanMs: number): string[] => {
  if (!l1Scheduler || !l1Scheduler.isInitialized.value) return []
  const cursor = Math.max(0, currentRoundIndex.value)
  const lastRound = cursor + roundsCoveredBySpan(spanMs)
  const ids = new Set<string>()
  for (let mr = cursor + 1; mr <= lastRound + 1; mr++) {
    if (!l1Scheduler.shouldFireLapAt(mr)) continue
    // L1 cups now also play on pod rounds — segued in front of the pod under one
    // set of bookends — so their cup audio needs warming too (no pod-round skip).
    const lap = l1Scheduler.nextLap(mr)
    if (!lap) continue
    if (lap.intro?.id) ids.add(lap.intro.id)
    if (lap.outro?.id) ids.add(lap.outro.id)
    for (const p of lap.plays) if (p.audioId) ids.add(p.audioId)
  }
  return [...ids]
}

// ── Offline depth knob = % OF COURSE CONTENT, not playback time ──────────────
// Tom 2026-06-02: time is the wrong unit. Offline never *stops* — it drops into
// INF PLAY and recycles the cache forever, so "hours offline" is infinite no
// matter what you download. What the deliberate download actually controls is
// how much NEW course content you carry. So the depth limiter counts ROUNDS
// ahead of the cursor (a round ≈ one LEGO introduction), surfaced to the user
// as a % of the whole course. The ms-based collectSpanAudioIds above stays for
// the rolling online filler (that's a real "next N minutes warm-ahead" job).

// Course total rounds = main-loop length (excludes the INF PLAY tail). The %
// denominator. Returns 0 until getCourseFinalLego resolves (roundIndex −1).
const courseTotalRounds = (): number => mainLoopBoundary()

// Rounds currently loaded ahead of (and including) the cursor.
const roundsLoadedAhead = (): number =>
  Math.max(0, (cachedRounds.value?.length ?? 0) - Math.max(0, currentRoundIndex.value))

// True when cachedRounds genuinely starts at the course start (round 1) —
// round numbers are course-global 1-based on every producer (full walk,
// cached script, /cycles bootstrap), so a mid-course bootstrap window that
// never ran the full walk fails this and needs an expandScript first. The
// offline bundle must include the behind-position prefix, so collection
// can't run against a cursor-anchored window.
const behindPositionRoundsLoaded = (): boolean => {
  if (currentRoundIndex.value <= 0) return true
  const first = (cachedRounds.value || [])[0] as any
  return first?.roundNumber === 1
}

// Expand the script for the deliberate offline download (same machinery INF
// PLAY uses) until the behind-position prefix (course start → cursor) is
// loaded AND `roundsAhead` rounds are loaded ahead of the cursor, the
// generator runs dry (course tail), or the user cancels. One expandScript is
// normally enough for the prefix — generateScript walks the whole course.
// Guard is a runaway backstop only; the real stop is rounds-reached or
// added === 0.
const ensureOfflineRoundsLoaded = async (roundsAhead: number): Promise<void> => {
  let guard = 0
  while (
    offlineActive.value &&
    (roundsLoadedAhead() < roundsAhead || !behindPositionRoundsLoaded()) &&
    guard++ < 2000
  ) {
    const added = await expandScript()
    if (added === 0) break  // generator exhausted — course tail reached
  }
}

// Collect unique /api/audio ids for the offline bundle: ALWAYS every loaded
// round from the COURSE START up to the cursor (behind-position content is
// unconditional — a fresh device has none of it cached, and without it the
// earlier belts are dead offline despite "downloaded course"), PLUS
// `roundsAhead` rounds ahead of the cursor (the slider's "how much new
// learning I carry"). Infinity = to the end of what's loaded. Dedupes (a
// clip reused across the span counts once) — same shape as collectSpanAudioIds.
const collectRoundsAudioIds = (roundsAhead: number): string[] => {
  const rounds = cachedRounds.value || []
  const cursor = Math.max(0, currentRoundIndex.value)
  const end = roundsAhead === Infinity ? rounds.length : Math.min(rounds.length, cursor + roundsAhead)
  const ids = new Set<string>()
  const add = (url?: string) => {
    const m = typeof url === 'string' ? url.match(/\/api\/audio\/([^?]+)/) : null
    if (m) ids.add(m[1])
  }
  for (let i = 0; i < end; i++) {
    for (const c of (((rounds[i]) as any).cycles || [])) {
      add(c?.known?.audioUrl); add(c?.target?.voice1Url); add(c?.target?.voice2Url)
    }
  }
  return [...ids]
}

// Rolling filler (buffer-model step 1a): keep the next ROLLING_SPAN_MS of play
// warm in IndexedDB during normal online play. Does NOT change playback — the
// resolver still streams online (the gate flip is step 1b) — so this cannot
// regress lock; it only pre-stages bytes. Gentle by construction: sequential
// (concurrency 1), missing-only, yields to the bulk offline download, no-ops
// offline. Expands the script ahead first (ensureLiveSpanLoaded) so the cache
// fills DEEP, not just the ~3-round bootstrap window — that shallow cap was the
// root cause of cold-start lock/offline failures. Re-entrancy guarded so
// overlapping round-advances don't double-fetch.
let rollingFillActive = false
// A function (not an inline `=== 'downloading'`) so TS doesn't narrow the
// reactive offlineDlState across the early return — its .value genuinely changes
// across awaits when the bulk download starts mid-fill.
const bulkDownloadRunning = (): boolean => offlineDlState.value === 'downloading'
// Expand the script ahead so the cache can fill DEEP, not just the ~3-round
// cold-start bootstrap window (the root cause of cold-start lock/offline death).
// expandScript() is append-only (cursor-safe) + re-entrancy-guarded; one call
// loads the whole course, then loadedSpanMsFromHere() >= spanMs short-circuits.
// Online + visible only (generateScript needs network); yields to bulk download.
// INF PLAY keeps its own near-edge paginator (expandScript would splice
// main-loop intros into the seeded-USE tail) — we only warm what's loaded there.
let rollingExpandActive = false
const ensureLiveSpanLoaded = async (spanMs: number): Promise<void> => {
  if (rollingExpandActive) return
  if (currentMode.value === 'infplay') return
  if (!isOnline.value) return
  if (bulkDownloadRunning()) return
  if (loadedSpanMsFromHere() >= spanMs) return
  rollingExpandActive = true
  try {
    let guard = 0
    while (
      isOnline.value &&
      !bulkDownloadRunning() &&
      loadedSpanMsFromHere() < spanMs &&
      guard++ < 8
    ) {
      const added = await expandScript()
      if (added === 0) break  // generator dry — course tail
    }
  } finally {
    rollingExpandActive = false
  }
}
// Warm the next `spanMs` of upcoming play into IndexedDB. `concurrency` workers
// pull in parallel: 1 for the steady background fill (device-proven not to
// contend with the live play fetch), higher for bursts at non-lock moments
// (start, hide, stop) where speed matters and there's no live playback to starve
// — backgrounded play is from cache, so the only fetches are the filler's.
const fillBuffer = async (spanMs: number, concurrency = 1): Promise<void> => {
  if (rollingFillActive) return
  if (!isOnline.value) return            // offline: nothing to fetch (offline mode owns true-offline)
  // KEEP warming even while hidden/locked. We briefly went network-silent on lock
  // (theory: background fetch deactivates the iOS audio session) — but a 63-min
  // screen-locked run streamed over the network the WHOLE time and never died, so
  // that theory was wrong. Going silent just DRAINED the buffer → playback then
  // streamed every clip anyway (defeating the entire point of a buffer). Warming
  // while locked keeps playback on cache blobs (more lock-stable than streaming)
  // and removes the needless streaming bandwidth. (Tom 2026-06-02.)
  if (bulkDownloadRunning()) return      // don't fight the bulk download
  rollingFillActive = true
  try {
    // Grow the loaded script ahead first so we warm a DEEP cache, not just the
    // shallow bootstrap window — the fix for cold-start lock/offline failures.
    await ensureLiveSpanLoaded(spanMs)
    // PRIORITY ORDER is structural (Tom's "fill faster than we consume; never
    // starve cycles" invariant, satisfied without rate measurement): build ONE
    // ordered missing-list as [cycles…, pods…, L1…]. The sequential
    // missing-only worker(s) drain it front-to-back, so every uncached cycle is
    // warmed before any pod, and every pod before any L1 listening clip. Pods
    // and L1 are the EXTRAS that ride the same gentle filler — they only get
    // bytes once the cycle buffer ahead is already warm. dedupe across all
    // three so a clip shared by a cycle and a lap is fetched once.
    const ordered = [
      ...collectSpanAudioIds(spanMs),
      ...collectPodSpanAudioIds(spanMs),
      ...collectLayer1SpanAudioIds(spanMs),
    ]
    const seen = new Set<string>()
    const missing = ordered.filter((id) => {
      if (seen.has(id) || audioCache.persistent.has(id)) return false
      seen.add(id)
      return true
    })
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < missing.length) {
        if (!isOnline.value || bulkDownloadRunning()) return
        const id = missing[next++]
        // Silent — the play path handles any miss by streaming.
        await audioCache.persistent.ensure(id).catch(() => { /* keep going */ })
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
  } finally {
    rollingFillActive = false
  }
}
// Steady background fill on each round advance — gentle (one at a time, deep span).
const fillRollingBuffer = (): Promise<void> => fillBuffer(ROLLING_SPAN_MS, 1)
// Fast burst at non-lock moments: warm the head quickly so the cold-start window
// (the only lock-fragile gap, per Afrikaans telemetry) closes fast, and a
// restart / backgrounded app stays supplied.
const warmBurst = (): Promise<void> => fillBuffer(BURST_SPAN_MS, 3)

// First rounds load → burst the head warm fast. Each later round advance →
// steady top-up. Stop/pause → burst the next bundle so a restart is instant.
let firstBurstDone = false
watch(() => (cachedRounds.value || []).length, (n) => {
  if (n > 0 && !firstBurstDone) { firstBurstDone = true; void warmBurst() }
})
watch(currentRoundIndex, () => { void fillRollingBuffer() })
watch(isPlaying, (playing) => { if (!playing) void warmBurst() })
// NOTE: no special on-hide burst needed — the steady fillRollingBuffer keeps
// warming on every round advance INCLUDING while hidden/locked (fillBuffer no
// longer early-returns on document.hidden; see its comment for why). So the
// buffer stays topped up through a lock instead of draining and falling back to
// streaming every clip.

/**
 * Listening-mode bundle — Core (every seed's whole-sentence audio) + the pod
 * scene structure's full clip set (split sentences, explainers, Take-G fusion
 * slices, fine-known glosses, bookends) — downloaded in FULL, course-wide,
 * with no position scoping (Tom 2026-07-08: "no position scoping anywhere in
 * the offline listening bundle — simpler and fully deterministic"). 'All'
 * (USE-phrase audio) is deliberately NOT part of the offline bundle — it's
 * disabled in the UI while offline instead (see ListeningOverlay's
 * :is-offline prop).
 *
 * fetchAndCacheListeningMeta ALSO persists the listening METADATA (pod rows,
 * Core seed list, bookends, fine-known map, LEGO catalogue) to IndexedDB —
 * that's what lets the Listening overlay + pod/L1 schedulers open offline
 * instead of dying on a dead Supabase fetch ("listening_pod_sentences:
 * TypeError: Load failed"). The audio ids are derived from those same
 * persisted rows, so metadata and audio can't drift apart.
 */
// Returns null (not []) on a genuine fetch failure so the caller can tell
// "no listening content" apart from "couldn't check" — the latter must NOT
// let the download report a false "complete" (2026-07-21 flight report:
// Core silently missing from the offline bundle with no error shown).
const collectListeningModeAudioIds = async (): Promise<string[] | null> => {
  const client = supabase.value
  const code = courseCode.value
  if (!client || !code) return []
  const meta = await fetchAndCacheListeningMeta(client, code)
  if (!meta) {
    console.warn('[Offline] listening metadata fetch failed — listening bundle skipped this run')
    return null
  }
  return collectListeningMetaAudioIds(meta)
}

// Commentary (welcome/instructions/encouragements) and pod audio are
// scheduled at RUNTIME — encouragements are a random pull from a pool, pod
// laps advance on a ratchet — so we can't predict which exact clips fire in
// the span. Both pools are small and bounded, so we cache ALL of them:
// whatever fires offline is then guaranteed present in IndexedDB. Without
// this, a between-round encouragement or pod clip isn't cached → offline
// miss → it falls to the network → the 60s commentary safety timeout stalls
// the lesson (the "plays ~10 rounds then stops dead" bug, 2026-05-28). Also
// the reason pods can now play during an offline journey, per the model.
//
// ALSO gathers the Listening-mode Core bundle (the whole course, no position
// scoping) and ALL dialogue pod content for the course (pods are likewise
// never position-limited — every scene the course has, per Tom 2026-07-08)
// — this function is the single place both offline download paths (the
// mid-course picker and the INF-PLAY single option) already call for
// "everything besides the main-loop cycles". 'All' (USE phrases) is
// deliberately excluded from the offline bundle — see collectListeningModeAudioIds.
const collectAuxiliaryAudioIds = async (): Promise<{ ids: string[]; auxIncomplete: boolean }> => {
  const ids = new Set<string>()
  let auxIncomplete = false
  const provider = courseDataProvider.value
  if (provider) {
    try {
      const [instructions, encouragements, welcome] = await Promise.all([
        provider.getInstructions(),
        provider.getEncouragements(),
        provider.getWelcomeAudio(),
      ])
      for (const c of instructions ?? []) if (c?.id) ids.add(c.id)
      for (const c of encouragements ?? []) if (c?.id) ids.add(c.id)
      if (welcome?.id) ids.add(welcome.id)
    } catch (e) { console.warn('[Offline] commentary enumerate failed:', e) }
  }
  // The three fetches below are mutually independent (pod pool, L1 pool,
  // listening/Core metadata) — run them concurrently instead of one after
  // another so their latencies overlap rather than add, cutting time spent
  // stuck on the "preparing download" screen (2026-07-21 flight report).
  await Promise.all([
    (async () => {
      if (!podScheduler) return
      try {
        if (!podScheduler.isInitialized.value) await podScheduler.initialize()
        for (const s of podScheduler.podSentences.value ?? []) {
          if (s?.target_audio_id) ids.add(s.target_audio_id)
          if (s?.known_audio_id) ids.add(s.known_audio_id)
          if (s?.explainer_audio_id) ids.add(s.explainer_audio_id)
        }
        if (podScheduler.introAudio.value?.id) ids.add(podScheduler.introAudio.value.id)
        if (podScheduler.outroAudio.value?.id) ids.add(podScheduler.outroAudio.value.id)
      } catch (e) { console.warn('[Offline] pod enumerate failed:', e) }
    })(),
    // Layer-1 listening (drained-seed fluency maintenance). Same treatment as
    // pods: the seed-level target audio is a small bounded pool and L1 laps are
    // chosen at RUNTIME (every ~50 rounds, from whatever's drained at that
    // position), so we can't predict the exact clips in advance — cache the whole
    // pool so any lap that fires offline is guaranteed present. Tom's rule:
    // listening must load in EVERY offline plan, encouragements are the first
    // thing to cut, never the listening tracks. Bookends overlap with the pod
    // intro/outro above; the Set dedupes.
    (async () => {
      if (!l1Scheduler) return
      try {
        if (!l1Scheduler.isInitialized.value) await l1Scheduler.initialize()
        for (const seed of (l1Scheduler.seeds.value ?? new Map()).values()) {
          if (seed?.target1_audio_id) ids.add(seed.target1_audio_id)
          if (seed?.target2_audio_id) ids.add(seed.target2_audio_id)
        }
        if (l1Scheduler.introAudio.value?.id) ids.add(l1Scheduler.introAudio.value.id)
        if (l1Scheduler.outroAudio.value?.id) ids.add(l1Scheduler.outroAudio.value.id)
      } catch (e) { console.warn('[Offline] L1 enumerate failed:', e) }
    })(),
    (async () => {
      try {
        const found = await collectListeningModeAudioIds()
        if (found === null) { auxIncomplete = true; return }
        for (const id of found) ids.add(id)
      } catch (e) {
        console.warn('[Offline] Listening mode (Core/All) enumerate failed:', e)
        auxIncomplete = true
      }
    })(),
  ])
  return { ids: [...ids], auxIncomplete }
}

const downloadForOffline = async (roundsAhead: number = Infinity) => {
  // Build out the script first — without this we'd only download whatever
  // rounds lazy-loading happened to have in memory (the "4 LEGOs" cap).
  // roundsAhead = the user-chosen depth in COURSE CONTENT (rounds ahead of the
  // cursor); Infinity = rest of the course. Derived from the depth slider via
  // offlineSelectedRounds (a fraction of the REMAINING course).
  offlineDlState.value = 'preparing'
  await ensureOfflineRoundsLoaded(roundsAhead)
  if (!offlineActive.value) { offlineDlState.value = 'idle'; return }  // cancelled during prepare
  const cycleIds = collectRoundsAudioIds(roundsAhead)
  const { ids: auxIds, auxIncomplete } = await collectAuxiliaryAudioIds()  // commentary + pod pools
  const ids = [...new Set([...cycleIds, ...auxIds])]
  const missing = ids.filter((id) => !audioCache.persistent.has(id))
  offlineDlTotal.value = ids.length
  offlineDlDone.value = ids.length - missing.length  // already-cached count toward done
  offlineDlFailed.value = 0
  offlineDlStragglers.value = 0
  offlineDlState.value = 'downloading'
  console.log(`[Offline] downloading ${missing.length} of ${ids.length} audio files (depth: ${roundsAhead === Infinity ? 'rest of course' : roundsAhead + ' rounds'})`)
  // Batches presigned S3 URLs and fetches bytes directly, falling back to the
  // per-clip /api/audio proxy (ensure()) for anything the batch path can't
  // resolve. Counts ONLY genuine cache writes — a clip that still fails after
  // retries must NOT tick progress, else "Ready ✓" lies and offline plays
  // silence (the train test).
  const { completed, failedIds } = await bulkDownloadAudio(
    missing,
    {
      fetchBatchUrls: fetchBatchAudioUrls,
      ensureFromUrl: (id, url) => audioCache.persistent.ensureFromUrl(id, url),
      ensure: (id) => audioCache.persistent.ensure(id),
      isCancelled: () => !offlineActive.value,
      isPlaying: () => isPlaying.value,
    },
    {
      onDone: () => { offlineDlDone.value++ },
      onFailed: () => { offlineDlFailed.value++ },
      // Straggler tail begins: name the phase honestly in the tray instead of
      // sitting on a near-frozen 99% (founder tail-pacing report, 2026-07-31).
      onStragglerRound: (remaining) => { offlineDlStragglers.value = remaining },
    },
  )
  offlineDlStragglers.value = 0
  if (!completed) { offlineDlState.value = 'idle'; return }  // user turned it off mid-download

  // Persist the SCRIPT (round structure) to IndexedDB, not just the audio.
  // The offline cold-reopen fast-path reads getCachedScript() to know what
  // to play and where to resume; without it, it falls through to the
  // network bootstrap (fetchCycles) and can't start offline — the
  // "downloaded OK but won't play / confused where to start" bug on
  // mid-course courses. The online background gen also writes this, but it's
  // fire-and-forget and may not have landed before the user goes offline, so
  // we write it here as part of the deliberate download — making "Ready ✓"
  // mean script + audio are both present.
  try {
    const scriptRounds = (cachedRounds.value || []) as any[]
    if (scriptRounds.length > 0) {
      const totalCycles = scriptRounds.reduce((s: number, r: any) => s + (r?.cycles?.length || 0), 0)
      await setCachedScript(courseCode.value, {
        rounds: scriptRounds,
        totalSeeds: scriptRounds.length,
        totalLegos: scriptRounds.length,
        totalCycles,
        estimatedMinutes: Math.round(totalCycles * 0.2),
        audioMapObj: {},
        courseWelcome: cachedCourseWelcome.value || undefined,
        // Carry the live audio-aware boundary into the offline cold-reopen cache
        // (set by the handoff that ran before this deliberate download).
        mainLoopRoundCount: liveMainLoopRoundCount.value ?? undefined,
        // Queue-derived write: stamp with the rounds' own vintage so an SWR
        // session never mis-labels an older script as fresh.
        ...queueVintageStampField(),
      })
      console.log(`[Offline] Persisted ${scriptRounds.length} rounds to script cache for cold offline reopen`)
    }
  } catch (e) {
    console.warn('[Offline] setCachedScript during download failed (non-fatal):', e)
  }

  // Stamp the 30-day offline lease now the bytes + script are durably cached.
  // Clamp to an entitlement-code expiry so the lease can't outlive the code.
  await grantOfflineLeaseForCurrentCourse()
  // The selection is now backed by real cached content — persist it so a
  // reload/SW-update can't silently drop the learner back to streaming.
  persistOfflineModeOn()

  // Readiness is a threshold, never complete==total: 99.9% cached is a
  // playable course. Stragglers keep retrying in the background and are
  // skipped at play time if truly unfetchable — never a red dead-end for a
  // course that plays (founder invariant, 2026-07-31).
  const outcome = resolveOfflineDlOutcome(offlineDlDone.value, offlineDlTotal.value, offlineDlFailed.value, auxIncomplete)
  if (outcome === 'complete') {
    offlineDlState.value = 'complete'
    console.log(`[Offline] complete: ${offlineDlDone.value}/${offlineDlTotal.value} cached`)
    setTimeout(() => { if (offlineDlState.value === 'complete') offlineDlState.value = 'idle' }, 4000)
  } else {
    // partial (ready, green) or error (low coverage) — both stay on screen and
    // both keep retrying the missing tail in the background.
    offlineDlState.value = outcome
    console.warn(`[Offline] ${outcome === 'partial' ? 'ready with stragglers' : 'incomplete'}: ${offlineDlDone.value}/${offlineDlTotal.value} cached, ${offlineDlFailed.value} failed${auxIncomplete ? ', Core/Listening bundle unreachable' : ''}`)
    scheduleOfflineStragglerRetry(failedIds)
  }
}

// ── Background straggler retry ──────────────────────────────────────────────
// A partial/error download keeps trying to land its missing clips at growing
// delays (fresh presigned URLs each attempt, via bulkDownloadAudio's own
// straggler rounds). Success flips the status to complete; offline stays ON
// and playable throughout.
const OFFLINE_BG_RETRY_DELAYS_MS = [30_000, 120_000, 300_000]
let offlineBgRetryTimer: ReturnType<typeof setTimeout> | null = null
const clearOfflineBgRetry = () => {
  if (offlineBgRetryTimer) { clearTimeout(offlineBgRetryTimer); offlineBgRetryTimer = null }
}
onUnmounted(clearOfflineBgRetry)
const scheduleOfflineStragglerRetry = (missingIds: string[], attempt = 0) => {
  if (missingIds.length === 0 || attempt >= OFFLINE_BG_RETRY_DELAYS_MS.length) return
  clearOfflineBgRetry()
  offlineBgRetryTimer = setTimeout(async () => {
    offlineBgRetryTimer = null
    // Only while the offline selection is still live and the status still
    // shows a gap (a remount resets the shared refs to idle → no-op).
    if (!offlineActive.value) return
    if (offlineDlState.value !== 'partial' && offlineDlState.value !== 'error') return
    const missing = missingIds.filter((id) => !audioCache.persistent.has(id))
    const { completed, failedIds: stillMissing } = await bulkDownloadAudio(
      missing,
      {
        fetchBatchUrls: fetchBatchAudioUrls,
        ensureFromUrl: (id, url) => audioCache.persistent.ensureFromUrl(id, url),
        ensure: (id) => audioCache.persistent.ensure(id),
        isCancelled: () => !offlineActive.value,
        isPlaying: () => isPlaying.value,
      },
      {
        onDone: () => {
          offlineDlDone.value++
          offlineDlFailed.value = Math.max(0, offlineDlFailed.value - 1)
        },
        onFailed: () => {},  // already counted failed on the original run
      },
    )
    if (!completed || !offlineActive.value) return
    if (stillMissing.length === 0) {
      offlineDlFailed.value = 0
      offlineDlState.value = 'complete'
      console.log('[Offline] stragglers landed in background — download complete')
      setTimeout(() => { if (offlineDlState.value === 'complete') offlineDlState.value = 'idle' }, 4000)
    } else {
      // Coverage may have crossed the ready threshold — recompute so an
      // 'error' can promote to 'partial' as clips land (never the reverse
      // gets louder: failed only shrinks here).
      offlineDlState.value = resolveOfflineDlOutcome(offlineDlDone.value, offlineDlTotal.value, offlineDlFailed.value, false) === 'error' ? 'error' : 'partial'
      console.warn(`[Offline] background retry ${attempt + 1}: ${stillMissing.length} clips still missing`)
      scheduleOfflineStragglerRetry(stillMissing, attempt + 1)
    }
  }, OFFLINE_BG_RETRY_DELAYS_MS[attempt])
}

/**
 * UNEXPECTED OFFLINE STEP 1: KEEP GOING FORWARD. Tom's ruling, 2026-08-15.
 *
 * There are THREE states and they are not the same thing:
 *
 *   1. INFINITE PLAY PROPER — the course is COMPLETED, no more LEGOs exist in
 *      the DB. That is the ONLY completion trigger.
 *   2. OFFLINE MODE — a deliberate download-ahead. Progresses the course
 *      normally and CAN load new LEGOs; that is the entire point of it.
 *   3. UNEXPECTED OFFLINE — weak signal, airplane mode. PLAY WHAT YOU HAVE:
 *      keep going FORWARD through the normal script, loading new items from
 *      the cache — which will almost certainly include some NEW LEGOs, since
 *      the cache pre-fills ahead of the playhead — until nothing new can be
 *      loaded, and only THEN recycle.
 *
 * Neither offline state is a completion trigger, and neither changes the belt
 * the learner has reached.
 *
 * This is step 3's forward half, and it has to exist because the offline
 * bootstrap path serves only a few rounds: the pre-tail watcher then fires
 * almost immediately, and before this it went straight to recycling cached
 * phrases — which looked to Tom like being dumped into infinite play three
 * rounds into a resume, with the rest of his downloaded course sitting unread
 * in IndexedDB.
 *
 * The cached script (useScriptCache, no TTL) holds the FULL generated round
 * list, so forward material is simply the rounds the engine does not have yet.
 * Rounds with nothing playable are skipped rather than ending the walk — a
 * single audio-less LEGO mid-course must not cap forward progress — and the
 * engine's own fail-closed cycle gate still polices what plays within a round.
 *
 * Returns the number of rounds appended; 0 means there is genuinely no forward
 * material left in the cache, which is the ONLY condition that licenses the
 * recycle below.
 */
const appendForwardFromCacheOffline = async (): Promise<number> => {
  if (!courseCode.value) return 0
  try {
    const cachedScript = await getCachedScript(courseCode.value)
    const scriptRounds = (cachedScript?.rounds || []) as any[]
    if (scriptRounds.length === 0) return 0

    const playable = (r: any) => ((r?.cycles) || []).some((c: any) =>
      isCyclePlayableOffline(c, (id) => audioCache.persistent.has(id)))

    // Forward = rounds the ENGINE does not already hold. Dedupe on the engine's
    // own truth (hasRound), never on an index into the mirror — on the resume
    // path the engine's queue is a WINDOW at the cursor, not the head of the
    // script array.
    const forward = scriptRounds.filter((r) => !simplePlayer.hasRound(r?.roundNumber) && playable(r))
    if (forward.length === 0) return 0

    simplePlayer.appendRounds(forward as any)
    // Keep the mirror in lockstep with the engine queue, exactly as
    // expandScript does — the end-of-rounds check reads cachedRounds.length,
    // and letting it lag is the "looped but then just stopped" bug.
    const merged = [...((cachedRounds.value || []) as any[])]
    const seen = new Set(merged.map((r) => r?.roundNumber))
    for (const r of forward) if (!seen.has(r?.roundNumber)) merged.push(r)
    merged.sort((a, b) => (a?.roundNumber ?? 0) - (b?.roundNumber ?? 0))
    cachedRounds.value = merged as any
    console.warn(`[Offline] forward from cache — appended ${forward.length} rounds; still progressing the course`)
    return forward.length
  } catch (err) {
    console.warn('[Offline] forward-from-cache failed:', err)
    return 0
  }
}

// Offline infinite play. With no network we can't generate new rounds, so
// loop the already-cached content: take every fully-cached cycle from the
// loaded rounds, regroup into fresh rounds with continuing round numbers
// (appendRounds dedupes by roundNumber, so new numbers are required),
// shuffled for variety. The end-of-rounds watcher re-invokes this near each
// new end → endless cached play. Returns rounds appended (0 if nothing
// cached). Tom 2026-05-25: offline must always play SOMETHING.
// INF PLAY plays USE PHRASES ONLY (Tom 2026-06-03) — never intro/debut/BUILD
// (BLD phrases only ever play in a LEGO's debut round) nor component/listening
// cycles. 'use' and 'spaced_rep' are both USE-phrase plays (the generator draws
// spaced_rep from the same usePhrases pool). Filtering to these means the
// recycled rounds carry NO intro/debut/build, so isMainLoopRound is false.
// That USED to make isInfPlayActive true and paint the belt the red ∞.
// It no longer does, and must not: Tom's ruling 2026-08-15 is that OFFLINE
// CHANGES WHAT PLAYS, NEVER WHERE YOU ARE. This function raises
// offlineRecycleBeltHeld, which suppresses the round-shape inference — the
// learner keeps their own belt colour and belt nav while these rounds play.
// The red ∞ is now reserved for DELIBERATE entry (the ∞ activator,
// enterInfPlay) and for INFINITE PLAY PROPER — the course actually finished,
// no more LEGOs in the DB, which is the only completion trigger there is.
// Running out of CACHED material never qualifies: enterInfPlayFromCache no
// longer promotes to the formal mode either.
const INF_PLAY_USE_TYPES = new Set(['use', 'spaced_rep'])

// The offline infinite-play urn, held across appends so one without-replacement
// pass spans them (see appendCachedLoopForOffline). Rebuilt whenever the
// measured cache changes; dropped on teardown with the rest of this instance.
let offlineUrn: ReturnType<typeof createOfflineUrn> | null = null
let offlineUrnSignature = ''

/**
 * Offline INFINITE PLAY — Tom's ruling, 2026-08-15.
 *
 * Step 1 of the approved algorithm is MEASURE THE CACHE: inventory what is
 * actually fetchable right now and treat THAT list as the session syllabus,
 * never assuming coverage. That is what the `cachedId` filter below does, and
 * it was already right — a cycle only enters the pool if all three of its
 * clips are genuinely in the persistent cache.
 *
 * What changed is step 2. This used to shuffle whole ROUNDS uniformly, so the
 * learner got chunks of the course in random order and every phrase came round
 * exactly as often as every other. It now draws PHRASES from a weighted urn,
 * sampled without replacement (`playback/offlineUrn.ts`): long clips and
 * recently-introduced clips get more tickets, but every cached phrase keeps a
 * floor of one, so a full pass covers the whole cached syllabus and the weights
 * control only how often within it. Spaced repetition falls out of that
 * structure — no learner model, no per-item state.
 *
 * Round CARDINALITY and round SIZES are deliberately preserved: the drawn
 * phrases are dealt back into the same number of rounds, of the same lengths,
 * as the cached material had. The urn changes what plays and how often, not
 * the pacing of the session or anything downstream that counts rounds.
 */
const appendCachedLoopForOffline = (): number => {
  const rounds = (cachedRounds.value || []) as any[]
  if (rounds.length === 0) return 0
  // ── Step 1: MEASURE THE CACHE. This inventory is the session syllabus, so
  // the fail-closed gate matters most here: a blank-url cycle counted as
  // "cached" would seed the urn with a phrase that can only ever be silence.
  const cachedOnly: any[] = []
  for (const r of rounds) {
    const cyc = ((r?.cycles) || []).filter((c: any) =>
      INF_PLAY_USE_TYPES.has(c?.type)
      && isCyclePlayableOffline(c, (id) => audioCache.persistent.has(id)))
    if (cyc.length > 0) cachedOnly.push({ ...r, cycles: cyc })
  }
  if (cachedOnly.length === 0) return 0

  // ── Steps 2-4: weighted urn over the measured phrases.
  // Duration = the target voices, which are the clips whose length actually
  // makes a phrase hard. Position = the source round number, i.e. introduction
  // order in the course — NOT clock time, per the ruling.
  const byKey = new Map<string, any>()
  const roundByKey = new Map<string, any>()
  const candidates: UrnCandidate[] = []
  for (const r of cachedOnly) {
    for (const c of r.cycles) {
      const key = c?.id ?? `${r.roundNumber}:${c?.known?.text ?? ''}:${c?.target?.text ?? ''}`
      if (byKey.has(key)) continue
      byKey.set(key, c)
      roundByKey.set(key, r)
      candidates.push({
        key,
        durationMs: (c?.target1DurationMs ?? 0) + (c?.target2DurationMs ?? 0),
        position: r?.roundNumber ?? 0,
      })
    }
  }
  if (candidates.length === 0) return 0

  // The urn PERSISTS across appends, and that is load-bearing. Each append
  // draws only as many phrases as the cached material has cycles, but a full
  // urn pass is up to 4x that (one entry per ticket). A fresh urn per append
  // would therefore only ever hand out the first quarter of each pass, and the
  // without-replacement coverage guarantee — the whole reason for the urn —
  // would be silently lost. Rebuild it only when the measured cache actually
  // changes, which is what the signature detects.
  const signature = `${candidates.length}:${candidates[0].key}:${candidates[candidates.length - 1].key}`
  if (!offlineUrn || offlineUrnSignature !== signature) {
    offlineUrn = createOfflineUrn(candidates)
    offlineUrnSignature = signature
    console.log(`[OfflineInfPlay] Measured cache: ${candidates.length} playable phrases; urn rebuilt.`)
  }

  // Deal into the SAME shape the cached material had — same number of rounds,
  // same sizes — so nothing downstream that counts or paces rounds shifts.
  const drawn = offlineUrn.take(cachedOnly.reduce((n, r) => n + r.cycles.length, 0))
  if (drawn.length === 0) return 0

  let cursor = 0
  const shaped: any[] = []
  for (const r of cachedOnly) {
    const cycles: any[] = []
    for (let i = 0; i < r.cycles.length && cursor < drawn.length; i++) {
      cycles.push(byKey.get(drawn[cursor++]))
    }
    if (cycles.length === 0) continue
    // Round metadata follows the first phrase actually in it, so the header
    // never names a LEGO the round no longer contains.
    const source = roundByKey.get(drawn[cursor - cycles.length]) ?? r
    shaped.push({ ...source, cycles })
  }
  if (shaped.length === 0) return 0

  // Fresh round numbers above every existing one so appendRounds (dedupes by
  // roundNumber) doesn't drop them.
  let num = Math.max(0, ...(rounds.map((r) => r?.roundNumber ?? 0)))
  const loopRounds = shaped.map((r) => ({ ...r, roundNumber: ++num }))
  simplePlayer.appendRounds(loopRounds as any)
  // CRITICAL: keep cachedRounds in lockstep with the engine queue, exactly as
  // expandScript does. The round-advance end-check (and currentRound) read
  // cachedRounds.length; without this the cursor runs past it and the player
  // shows the summary even though the engine has more queued — the "looped
  // but then just stopped" bug.
  cachedRounds.value = [...rounds, ...loopRounds] as any
  // Tell the learner why the material just started coming round again — once
  // per session, dismissible, and it never touches playback (#595: play what
  // you have, never gate). Raised HERE, at the single point where offline
  // recycling actually engages, so every call site gets it for free and it
  // rides the same offlinePlaybackActive() signal the playback path rides.
  markOfflineInfPlayEngaged(offlinePlaybackActive())
  // BELT HELD (Tom 2026-08-15). These rounds are infinite-play SHAPED, but the
  // learner has not gone anywhere — so hold their own belt rather than letting
  // it follow whichever LEGO the urn happens to draw. Anchor to their real
  // cursor (highest LEGO played, the canonical position), which is what
  // "stay at the current belt colour and belt nav" means. If the learner is
  // ALREADY in formal INF PLAY, leave that alone — the red ∞ is correct there.
  if (currentMode.value !== 'infplay') {
    const cursorLegoId = highestCompletedLegoId.value ?? lastMainLoopLegoId.value
    const cursorSeed = cursorLegoId ? getSeedFromLegoId(cursorLegoId) : null
    // Null anchor → no write → the belt HOLDS its last value, which is still
    // the right answer for a learner with no recorded cursor yet.
    if (cursorSeed != null) beltFreezeSeed.value = cursorSeed
    offlineRecycleBeltHeld.value = true
  }
  return loopRounds.length
}

// Skip / belt-jump landed past all loaded content (no round matches the
// target seed). Tom's rule: it must NEVER stop — drop straight into INF
// PLAY by recycling cached USE phrases. Network-independent and doesn't
// depend on belt math or regen producing a seed-matched round. Returns
// true if it engaged playback, false only when nothing is cached to recycle.
const enterInfPlayFromCache = async (): Promise<boolean> => {
  // OFFLINE-ONLY. The random Math.random()-shuffled cache recycle is the
  // offline graceful-degradation path — it must NEVER be the online INF-PLAY
  // fallback. Online, INF PLAY is the deterministic local revival build
  // (generateScript's SR drain + seeded-USE tail); if those rounds somehow
  // aren't present we SURFACE it rather than silently shuffling the cache
  // into a per-session slot machine. Tom 2026-05-29.
  if (!offlinePlaybackActive()) {
    console.error('[LearningPlayer] enterInfPlayFromCache called ONLINE — refusing the random recycle. ' +
      'INF PLAY online must use the deterministic revival build; revival rounds were expected but not present.')
    return false
  }
  const firstNewIdx = simplePlayer.roundCount.value
  // FORWARD FIRST, even here. A skip that lands past the loaded content offline
  // has hit the edge of the CACHE, not the end of the course — the cached
  // script usually still holds rounds the engine was never given.
  const forward = await appendForwardFromCacheOffline()
  if (forward > 0) {
    simplePlayer.jumpToRound(firstNewIdx)
    await persistCursorAtCurrentRound()
    return true
  }
  const looped = appendCachedLoopForOffline()
  if (looped <= 0) {
    console.warn('[LearningPlayer] Skip past content but no cached cycles to recycle — staying put')
    return false
  }
  // OFFLINE IS NOT A COMPLETION TRIGGER. Tom's ruling, 2026-08-15: infinite
  // play PROPER means the course is finished — no more LEGOs in the DB — and
  // that is the ONLY thing that may set the mode. Running out of CACHED
  // material is a fact about this device's storage on this journey, not about
  // the learner's progress, so this path no longer writes current_mode,
  // no longer ratchets the cursor to the course's final LEGO, and no longer
  // freezes the belt at the top belt. It keeps the belt HELD where the learner
  // actually is (offlineRecycleBeltHeld, raised by the append above) and just
  // plays what's cached until the network comes back.
  console.log(`[LearningPlayer] Skip past cached content — recycling ${looped} cached rounds at index ${firstNewIdx}, belt held`)
  // jumpToRound auto-resumes when the engine was playing (haltAllPlayback
  // doesn't pause it), so this picks straight up at the recycled round.
  simplePlayer.jumpToRound(firstNewIdx)
  await persistCursorAtCurrentRound()
  return true
}

// ── Depth picker (Spotify-style "take it with you") ─────────────────────────
// The offline-mode tap no longer silently grabs a fixed 30 min. It opens a
// picker so the learner chooses how much of the course to carry, annotated with
// a live size estimate (MB; plus a "running low" warning only when near the cap).
const showOfflinePicker = ref(false)
const offlineEstimating = ref(false)

// Notched slider: each notch is a fraction of the REMAINING course (from the
// cursor to the tail), not of the whole course. So the top notch (100%) always
// means "the rest of the course" no matter how far through you are, and the
// notches never collapse into each other. Thumb starts at the smallest.
const OFFLINE_NOTCHES = [0.02, 0.05, 0.10, 0.25, 0.50, 1] as const
const offlineNotchIndex = ref(0)
const offlineSelectedFraction = computed(() => OFFLINE_NOTCHES[offlineNotchIndex.value])
const offlineSelectedLabel = computed(() => {
  const pct = Math.round(offlineSelectedFraction.value * 100)
  if (offlineSelectedFraction.value >= 1) return offlineAtTail.value ? 'the whole course' : 'the rest of the course'
  return offlineAtTail.value ? `${pct}% of the course` : `${pct}% of what's left`
})

const formatMb = (mb: number): string =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`

// Estimate basis, gathered ONCE when the picker opens (course length + cache
// stats). The per-notch MB/bar then derive synchronously as the slider moves —
// no re-fetch per drag. Best-effort + labelled "≈"; a sense of cost, not a
// promise (Tom: the number "probably doesn't matter that much").
interface OfflineEstBasis {
  total: number; start: number
  avgBytesPerFile: number; avgFilesPerRound: number
  lowSpace: boolean; ready: boolean
  /** Missing files in the always-included listening/dialogues/commentary
   *  bundle (whole-course by design, Tom 2026-07-08) — counted for real by
   *  the truth pass below; 0 until it lands. */
  auxMissing: number
}
const offlineEst = ref<OfflineEstBasis>({
  total: 0, start: 0,
  avgBytesPerFile: 24 * 1024, avgFilesPerRound: 12, lowSpace: false, ready: false,
  auxMissing: 0,
})

// At/past the main-loop tail = INF PLAY / course finished: there's no NEW content
// ahead (courseTotalRounds is the main-loop length, which the cursor reaches and
// then exceeds as INF PLAY recycles). For that learner the download isn't "carry
// the next chunk of new learning" — it's "keep the (whole) course offline to
// recycle", so the slider, bar and labels switch to that framing.
const offlineAtTail = computed(() => {
  const { total, start, ready } = offlineEst.value
  return ready && total > 0 && start >= total
})
// The pool of rounds the chosen fraction draws from. Mid-course: the NEW content
// remaining ahead (total − start). Finished/INF-PLAY: the whole course. Length
// unknown: whatever's loaded ahead. NEVER collapses to 0 while total > 0 — that
// was the bug that made every notch a single round for the furthest-through user.
const offlinePoolRounds = computed((): number => {
  const { total, start } = offlineEst.value
  if (!(total > 0)) return Math.max(1, roundsLoadedAhead())
  return start >= total ? total : total - start
})

const refreshOfflineEstimates = async (): Promise<void> => {
  offlineEstimating.value = true
  offlineNotchIndex.value = 0   // every open starts at the smallest, lowest-commitment notch
  try {
    // Resolve the course length first (cached) — without it courseTotalRounds()
    // is 0 and the bar/estimate would read off the ~3 bootstrap rounds.
    if (courseTotalRounds() <= 0 && courseCode.value) {
      try { await getCourseFinalLego(courseCode.value) } catch { /* best-effort */ }
    }
    const total = courseTotalRounds()
    const start = Math.max(0, currentRoundIndex.value)
    let avgBytesPerFile = 24 * 1024  // ~24 KB/clip fallback (CLAUDE.md: 4.8 MB / 198 files)
    try {
      const stats = await audioCache.stats()
      if (stats.persistent.count > 0) avgBytesPerFile = stats.persistent.bytes / stats.persistent.count
    } catch { /* stats best-effort */ }
    // "Running low" = the usage/quota RATIO is near full. We use the ratio (not
    // the absolute quota) deliberately: navigator.storage.estimate().quota is
    // unreliable on iOS Safari (a large, fuzzy disk-derived number), so a
    // "% of device" reading is misleading — but the ratio still tells us when
    // we're genuinely close to the cap regardless of what that cap reports.
    let lowSpace = false
    try { lowSpace = (await audioCache.quotaPressure()) > 0.9 } catch { /* best-effort */ }
    // Files per round from the loaded sample (deduped), else a sane fallback.
    // collectRoundsAudioIds(Infinity) spans the WHOLE loaded array (behind +
    // ahead), so the denominator is the full loaded length, not rounds-ahead.
    const sampleRounds = (cachedRounds.value || []).length
    const sampleFiles = collectRoundsAudioIds(Infinity).length
    const avgFilesPerRound = sampleRounds >= 3 && sampleFiles > 0 ? sampleFiles / sampleRounds : 12
    offlineEst.value = { total, start, avgBytesPerFile, avgFilesPerRound, lowSpace, ready: true, auxMissing: 0 }
  } finally {
    offlineEstimating.value = false
  }
  // Truth pass (backgrounded — the picker shows the quick basis immediately and
  // the numbers settle to the real manifest within seconds). The founder's 2%
  // pick read "≈48 MB" while the real download was 9,742 files: the per-round
  // heuristic can't see clip REUSE across rounds (reviews dedupe heavily) and
  // omitted the always-included listening/dialogues bundle entirely. So price
  // the download the way the download itself works: expand the script (same
  // machinery, so collectRoundsAudioIds spans the true behind+ahead manifest,
  // deduped) and count the aux bundle's genuinely-missing files. Cached-aware
  // by construction — a re-download settles to ≈0.
  if (!offlineSingleOption.value) {
    void (async () => {
      try {
        let guard = 0
        while (showOfflinePicker.value && guard++ < 8) {
          const added = await expandScript()
          if (added === 0) break
        }
        const { ids: auxIds } = await collectAuxiliaryAudioIds()
        const auxMissing = auxIds.filter((id) => !audioCache.persistent.has(id)).length
        offlineEst.value = { ...offlineEst.value, auxMissing }
      } catch (e) { console.warn('[Offline] estimate truth pass failed (kept the quick basis):', e) }
    })()
  }
}

// Rounds the selected fraction maps to (≥1; the top notch = the whole pool).
const offlineSelectedRounds = computed((): number => {
  if (offlineSelectedFraction.value >= 1) return offlinePoolRounds.value
  return Math.max(1, Math.ceil(offlinePoolRounds.value * offlineSelectedFraction.value))
})

// Live size readout for the current notch — MB only (the honest, reliable
// number). The old "% of device" was dropped: it divided by an iOS-unreliable
// storage quota and read as a meaningless sliver. lowSpace surfaces a plain
// warning only when the cache is genuinely near the cap.
// Prices the TRUE manifest, split honestly (founder ruling 2026-07-31): the
// slider's new-learning slice PLUS the automatic catch-up (behind-position
// prefix + whole-course listening/dialogues bundle), counting only files not
// already cached. Enumerates the same ids the download will fetch
// (collectRoundsAudioIds over the truth-pass-expanded script + auxMissing),
// so dedupe and cache state are exact — a re-download reads ≈0, and a
// brown-belt learner's 2% pick reads "~X MB new + ~Y MB catch-up" instead of
// pricing only the slice (the ~48 MB vs 9,742-file surprise).
const offlineSelectedEstimate = computed(() => {
  const { avgBytesPerFile, lowSpace, ready, auxMissing } = offlineEst.value
  if (!ready) return { size: '', lowSpace: false }
  const missing = (ids: string[]) => ids.filter((id) => !audioCache.persistent.has(id)).length
  const behindMissing = missing(collectRoundsAudioIds(0))       // course start → cursor
  const spanMissing = missing(collectRoundsAudioIds(offlineSelectedRounds.value))
  const newMissing = Math.max(0, spanMissing - behindMissing)   // the slider's slice alone
  const catchupMissing = behindMissing + auxMissing
  const mb = (n: number) => (n * avgBytesPerFile) / 1e6
  if (newMissing + catchupMissing === 0) return { size: 'Already downloaded ✓', lowSpace }
  if (catchupMissing === 0) return { size: `≈ ${formatMb(mb(newMissing))}`, lowSpace }
  if (newMissing === 0) return { size: `≈ ${formatMb(mb(catchupMissing))} catch-up`, lowSpace }
  return { size: `≈ ${formatMb(mb(newMissing))} new + ${formatMb(mb(catchupMissing))} catch-up`, lowSpace }
})

// Course-depth bar (% of the WHOLE course): how far you've already come, then the
// new chunk this download carries forward. Whatever's left after that is where
// INF PLAY recycling lives — shown by the bar's untinted remainder. This is the
// "pre-INF-PLAY new learning" made visible, without a misleading time number.
const offlineCourseBar = computed(() => {
  const { total, start } = offlineEst.value
  const frac = offlineSelectedFraction.value
  if (!(total > 0)) {
    return { donePct: 0, newPct: frac >= 1 ? 100 : Math.round(frac * 100), finished: false }
  }
  if (start >= total) {
    // Finished / INF PLAY: nothing "ahead" — the bar shows how much of the WHOLE
    // course you're keeping offline (fill from the start), not a position.
    const newPct = frac >= 1 ? 100 : Math.min(100, Math.round((offlineSelectedRounds.value / total) * 100))
    return { donePct: 0, newPct, finished: true }
  }
  const donePct = Math.min(100, (start / total) * 100)
  const newPct = Math.min(100 - donePct, (offlineSelectedRounds.value / total) * 100)
  return { donePct, newPct, finished: false }
})

const startOfflineDownload = async (): Promise<void> => {
  // Open to all; only a LAPSED free trial (non-payer) hits the paywall here.
  if (!(await canStartOfflineDownload())) {
    showOfflinePicker.value = false
    return
  }
  showOfflinePicker.value = false
  offlineActive.value = true
  const frac = offlineSelectedFraction.value
  console.log(`[LearningPlayer] Offline ON — depth ${frac >= 1 ? 'rest of course' : Math.round(frac * 100) + '% of remaining'}`)
  void downloadForOffline(frac >= 1 ? Infinity : offlineSelectedRounds.value)
}

// ── INF PLAY single-option offline: USE-only, longest-3-per-LEGO download ─────
// INF PLAY only ever recycles USE content (and spaced_rep, which the generator
// draws from the SAME USE pool — verified against api/courses/[code]/infplay-
// cycles.ts). So for the INF-PLAY / at-tail learner the deliberate download
// doesn't need the whole course's intro/debut/build clips — only the USE-phrase
// audio. To keep it small we cap each LEGO to its LONGEST 3 USE phrases (by
// target-text character count): the richest review, and INF PLAY samples USE
// per-LEGO anyway. This is the single "Download for unlimited offline" option
// (offlineSingleOption); the mid-course % slider is left untouched.
//
// The `|| offlineAtTail` is REQUIRED: guests never get the persisted 'infplay'
// mode flag (no enrollment row), but they DO reach the tail by position — this
// catches them into the same single-option download.
const offlineSingleOption = computed(
  () => currentMode.value === 'infplay' || offlineAtTail.value,
)

// Cap of USE phrases kept per LEGO (the longest by target-text chars).
const INF_PLAY_USE_KEEP_PER_LEGO = 3

// Course-wide USE-only audio id set for INF PLAY offline. Per LEGO, keep the 3
// USE phrases with the MOST characters in the target phrase text, and collect
// each kept phrase's known/target1/target2 audio ids. PAGINATED (mirrors
// fetchAllPracticePhrases in generateLearningScript.ts) — a single .limit(N) is
// silently truncated by PostgREST on big courses (banked lesson). Returns [] if
// the course/client can't be resolved (caller still has the aux pools).
const collectInfPlayUseAudioIds = async (): Promise<string[]> => {
  const client = supabase.value
  const code = courseCode.value
  if (!client || !code) return []
  // Length-sort key = the target phrase TEXT. course_practice_phrases carries
  // both target_text (native) and target_text_roman; prefer roman where present
  // (what INF PLAY displays/plays), else native. Length = character count.
  // Roles 'use' + 'eternal_eligible' mirror infplay-cycles.ts's USE pool.
  type UseRow = {
    seed_number: number
    lego_index: number
    target_text: string | null
    target_text_roman: string | null
    known_audio_id: string | null
    target1_audio_id: string | null
    target2_audio_id: string | null
  }
  const PAGE = 1000
  let allRows: UseRow[] = []
  try {
    const { count, error: countErr } = await client
      .from('course_practice_phrases')
      .select('*', { count: 'exact', head: true })
      .eq('course_code', code)
      .in('phrase_role', ['use', 'eternal_eligible'])
    if (countErr) {
      console.warn('[Offline] INF PLAY USE count failed:', countErr.message)
      return []
    }
    const total = count ?? 0
    if (total === 0) return []
    const pageCount = Math.ceil(total / PAGE)
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, i) =>
        client
          .from('course_practice_phrases')
          .select('seed_number, lego_index, target_text, target_text_roman, known_audio_id, target1_audio_id, target2_audio_id')
          .eq('course_code', code)
          .in('phrase_role', ['use', 'eternal_eligible'])
          .order('seed_number', { ascending: true })
          .order('lego_index', { ascending: true })
          .order('position', { ascending: true })
          .range(i * PAGE, i * PAGE + PAGE - 1),
      ),
    )
    for (const p of pages) {
      if (p.error) {
        console.warn('[Offline] INF PLAY USE page failed:', p.error.message)
        return []
      }
      if (p.data) allRows = allRows.concat(p.data as UseRow[])
    }
  } catch (e) {
    console.warn('[Offline] INF PLAY USE query errored:', e)
    return []
  }

  // Bucket by LEGO id (S{seed}L{lego}). Skip any phrase missing one of the 3 ids
  // (partial-import safety) BEFORE the cap, so the cap counts only fully-playable
  // phrases. Per LEGO keep the longest 3 by target-text char length (desc) and
  // collect their 3 audio ids each.
  const byLego = new Map<string, UseRow[]>()
  for (const row of allRows) {
    if (!row.known_audio_id || !row.target1_audio_id || !row.target2_audio_id) continue
    const legoId = `S${String(row.seed_number).padStart(4, '0')}L${String(row.lego_index).padStart(2, '0')}`
    const list = byLego.get(legoId)
    if (list) list.push(row)
    else byLego.set(legoId, [row])
  }
  const textLen = (r: UseRow): number => (r.target_text_roman || r.target_text || '').length
  const ids = new Set<string>()
  for (const list of byLego.values()) {
    list.sort((a, b) => textLen(b) - textLen(a))
    for (const r of list.slice(0, INF_PLAY_USE_KEEP_PER_LEGO)) {
      ids.add(r.known_audio_id!)
      ids.add(r.target1_audio_id!)
      ids.add(r.target2_audio_id!)
    }
  }
  return [...ids]
}

// MB estimate for the single INF-PLAY option — same avg-bytes-per-file basis as
// the slider, but the file count is the REAL USE-only id set (longest-3/LEGO +
// aux pools), gathered once when the picker opens. Best-effort + "≈".
const offlineSingleEstimate = ref<{ size: string; lowSpace: boolean; ready: boolean }>(
  { size: '', lowSpace: false, ready: false },
)
const refreshOfflineSingleEstimate = async (): Promise<void> => {
  offlineSingleEstimate.value = { size: '', lowSpace: false, ready: false }
  try {
    const [useIds, auxResult] = await Promise.all([
      collectInfPlayUseAudioIds(),
      collectAuxiliaryAudioIds(),
    ])
    const fileCount = new Set([...useIds, ...auxResult.ids]).size
    const avgBytesPerFile = offlineEst.value.avgBytesPerFile || 24 * 1024
    const mb = (fileCount * avgBytesPerFile) / 1e6
    offlineSingleEstimate.value = {
      size: fileCount > 0 ? `≈ ${formatMb(mb)}` : '',
      lowSpace: offlineEst.value.lowSpace,
      ready: true,
    }
  } catch (e) {
    console.warn('[Offline] INF PLAY single estimate failed:', e)
    offlineSingleEstimate.value = { size: '', lowSpace: false, ready: true }
  }
}

// Single "Download for unlimited offline" — caches only USE audio (longest 3 per
// LEGO) + the aux pools (pods + commentary, KEPT because INF PLAY still plays
// pods + encouragements), then flips offline on. Reuses the EXISTING download
// machinery: the same retry/batch loop and the cold-reopen script-cache write.
// For INF PLAY cachedRounds is already the USE-only revival tail, so that write
// stays correct. Mirrors downloadForOffline's structure with a different id set.
const startOfflineDownloadInfPlay = async (): Promise<void> => {
  // Open to all; only a LAPSED free trial (non-payer) hits the paywall here.
  if (!(await canStartOfflineDownload())) {
    showOfflinePicker.value = false
    return
  }
  showOfflinePicker.value = false
  offlineActive.value = true
  console.log('[LearningPlayer] Offline ON — INF PLAY USE-only (longest 3/LEGO)')
  offlineDlState.value = 'preparing'
  const [useIds, auxResult] = await Promise.all([
    collectInfPlayUseAudioIds(),
    collectAuxiliaryAudioIds(),
  ])
  const { ids: auxIds, auxIncomplete } = auxResult
  if (!offlineActive.value) { offlineDlState.value = 'idle'; return }  // cancelled during prepare
  const ids = [...new Set([...useIds, ...auxIds])]
  const missing = ids.filter((id) => !audioCache.persistent.has(id))
  offlineDlTotal.value = ids.length
  offlineDlDone.value = ids.length - missing.length  // already-cached count toward done
  offlineDlFailed.value = 0
  offlineDlStragglers.value = 0
  offlineDlState.value = 'downloading'
  console.log(`[Offline] INF PLAY USE-only: downloading ${missing.length} of ${ids.length} audio files`)
  const { completed, failedIds } = await bulkDownloadAudio(
    missing,
    {
      fetchBatchUrls: fetchBatchAudioUrls,
      ensureFromUrl: (id, url) => audioCache.persistent.ensureFromUrl(id, url),
      ensure: (id) => audioCache.persistent.ensure(id),
      isCancelled: () => !offlineActive.value,
      isPlaying: () => isPlaying.value,
    },
    {
      onDone: () => { offlineDlDone.value++ },
      onFailed: () => { offlineDlFailed.value++ },
      // Same honest tail-phase display as the mid-course download.
      onStragglerRound: (remaining) => { offlineDlStragglers.value = remaining },
    },
  )
  offlineDlStragglers.value = 0
  if (!completed) { offlineDlState.value = 'idle'; return }  // user turned it off mid-download

  // Persist the SCRIPT for the cold-reopen fast-path — identical to
  // downloadForOffline. For INF PLAY cachedRounds is already the USE-only
  // revival tail, so the cached script resumes into INF PLAY correctly.
  try {
    const scriptRounds = (cachedRounds.value || []) as any[]
    if (scriptRounds.length > 0) {
      const totalCycles = scriptRounds.reduce((s: number, r: any) => s + (r?.cycles?.length || 0), 0)
      await setCachedScript(courseCode.value, {
        rounds: scriptRounds,
        totalSeeds: scriptRounds.length,
        totalLegos: scriptRounds.length,
        totalCycles,
        estimatedMinutes: Math.round(totalCycles * 0.2),
        audioMapObj: {},
        courseWelcome: cachedCourseWelcome.value || undefined,
        // Queue-derived write: stamp with the rounds' own vintage (see above).
        ...queueVintageStampField(),
      })
      console.log(`[Offline] INF PLAY: persisted ${scriptRounds.length} rounds to script cache for cold offline reopen`)
    }
  } catch (e) {
    console.warn('[Offline] INF PLAY setCachedScript during download failed (non-fatal):', e)
  }

  // Stamp the 30-day offline lease (same as the mid-course download).
  await grantOfflineLeaseForCurrentCourse()
  // Persist the selection (same as the mid-course download).
  persistOfflineModeOn()

  // Same threshold readiness as the mid-course download: never a red dead-end
  // for a playable course; stragglers retry in the background.
  const outcome = resolveOfflineDlOutcome(offlineDlDone.value, offlineDlTotal.value, offlineDlFailed.value, auxIncomplete)
  if (outcome === 'complete') {
    offlineDlState.value = 'complete'
    console.log(`[Offline] INF PLAY complete: ${offlineDlDone.value}/${offlineDlTotal.value} cached`)
    setTimeout(() => { if (offlineDlState.value === 'complete') offlineDlState.value = 'idle' }, 4000)
  } else {
    offlineDlState.value = outcome
    console.warn(`[Offline] INF PLAY ${outcome === 'partial' ? 'ready with stragglers' : 'incomplete'}: ${offlineDlDone.value}/${offlineDlTotal.value} cached, ${offlineDlFailed.value} failed${auxIncomplete ? ', Core/Listening bundle unreachable' : ''}`)
    scheduleOfflineStragglerRetry(failedIds)
  }
}

const cancelOfflinePicker = () => { showOfflinePicker.value = false }

// Escape-to-close, matching every other modal in the app (ProgressModal,
// AuthModal, …). The listener is attached only while the picker is open so it
// never competes with the player's own keys. Keeps the input dialog dismissable
// from the keyboard (desktop/testing), not only by the ✕ / backdrop tap.
const onOfflinePickerKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && showOfflinePicker.value) cancelOfflinePicker()
}
watch(showOfflinePicker, (open) => {
  if (open) document.addEventListener('keydown', onOfflinePickerKeydown)
  else document.removeEventListener('keydown', onOfflinePickerKeydown)
})
onUnmounted(() => document.removeEventListener('keydown', onOfflinePickerKeydown))

const toggleOffline = async () => {
  if (offlineActive.value) {
    // Already on → turn off: stop serving blobs, revoke, reset. Explicit
    // toggle-off is the ONLY thing that clears the persisted selection.
    offlineActive.value = false
    clearPersistedOfflineMode()
    showOfflinePicker.value = false
    offlineDlState.value = 'idle'
    clearOfflineBgRetry()  // stop chasing stragglers for a de-selected offline
    audioCacheSource?.revokeAllBlobUrls()  // drop issued blob URLs so they don't leak
    console.log('[LearningPlayer] Offline mode: OFF — stream')
  } else {
    // Offline download is open to everyone (every course incl. free) — we sell
    // the convenience, not the content. Only a non-payer whose free 30-day taste
    // has already lapsed is sent to the paywall before the picker opens.
    if (!(await canStartOfflineDownload())) return
    // Off → open the depth picker (download starts only when a depth is chosen).
    showOfflinePicker.value = true
    // Refresh the slider basis FIRST (sets avgBytesPerFile), then the single
    // INF-PLAY option's USE-only estimate which reuses that avg. Both are
    // best-effort; the single-option estimate only surfaces when offlineSingleOption.
    void refreshOfflineEstimates().then(() => {
      if (offlineSingleOption.value) void refreshOfflineSingleEstimate()
    })
  }
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
// INF PLAY — continuous-play tail wrap (SAFETY NET)
// ============================================
// Primary path is GROWTH: expandScript() raises infPlayLookahead by a batch
// while in INF PLAY, so the deterministic revival tail keeps extending forward
// and the learner gets genuinely new rounds — the course never repeats itself.
// The approaching-the-end watcher fires that growth ~5 rounds before the tail,
// so in the common case continuous play never even reaches session_complete.
//
// This wrap is the LAST RESORT for when growth can't run: a transient online
// generateScript failure (network blip) returns 0 rounds. Rather than dropping
// to the paused summary, jump back to the first revival round and keep playing
// — the auto-play analogue of the forward button's tail wrap
// (advanceInfPlayRound). No overlay/flash — a silent continuation. (Offline is
// handled separately/earlier by appendCachedLoopForOffline; this never runs
// before expandScript at the call sites.)
//
// Historically this was the ONLY fix and ran BEFORE expandScript, because the
// lookahead was a fixed 50 that expandScript could never grow — so the tail
// dead-ended at the last revival round, which (since the pod cadence lands a lap
// on that final round) showed up as "stuck right after a listening pod". With
// growth in place that dead-end no longer happens; the wrap only catches the
// generation-failure edge.
//
// Returns true if it wrapped (caller must NOT fall through to showPausedSummary).
// No-ops (returns false) outside INF PLAY or when no revival set is loaded.
const wrapInfPlayAtTail = (): boolean => {
  if (currentMode.value !== 'infplay') return false
  const mainLoopCount = mainLoopBoundary()
  // First revival round = first index past the main loop. Guard against a
  // not-yet-loaded main-loop count and an unloaded revival set.
  const firstInfIdx = mainLoopCount > 0 && simplePlayer.roundCount.value > mainLoopCount
    ? mainLoopCount
    : -1
  if (firstInfIdx < 0) return false
  console.log(`[LearningPlayer] INF PLAY tail reached — wrapping to first revival round (idx ${firstInfIdx}) so play never dead-ends`)
  // jumpToRound lands on cycle 0 with isPlaying=false (we're paused at the
  // tail); resume() then starts the 4-phase cycle from PROMPT. The infplay
  // round counter is bumped per round by saveRoundProgress, so we don't touch
  // it here (advanceInfPlayRound bumps it because the button bypasses a round
  // completion; this path doesn't).
  sessionEnded.value = false
  simplePlayer.jumpToRound(firstInfIdx)
  simplePlayer.resume()
  return true
}

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
    // INF PLAY: extend the revival tail by a batch so this regen yields NEW
    // rounds. The generator otherwise reproduces the SAME fixed-length tail
    // (the deterministic seeded stream), so without growing the lookahead the
    // expansion would add nothing and play would dead-end at the tail.
    //
    // A simple growing COUNTER (base + batch), not a function of mainLoopCount:
    // each expansion adds INF_PLAY_BATCH more revival rounds than the last,
    // independent of how the generator counts its own main loop. The
    // approaching-the-end watcher fires this ~5 rounds before the tail, so the
    // batch lands before the learner reaches it. The first ≥ floor rounds are
    // the SR drain (phase 1: the final LEGO's full N-1…N-89 review); everything
    // past the drain is pure random USE (phase 2), so the tail is genuinely
    // unbounded. Main loop leaves the lookahead at its floor — once the whole
    // course is loaded its expandScript no-ops as before.
    if (currentMode.value === 'infplay') {
      const base = infPlayLookahead.value > 0 ? infPlayLookahead.value : infPlayLookaheadFloor()
      infPlayLookahead.value = base + INF_PLAY_BATCH
    }
    const result = await generateScript()
    const expandedRounds = toSimpleRoundsWithComponents(result.items)
    // Single-source the boundary on the live audio-aware count. In INF PLAY the
    // main-loop count is unchanged (we only grew the revival lookahead), but in
    // a main-loop expand on a course whose audio'd extent grew this keeps the
    // boundary in step with the freshly-generated script.
    if (result.mainLoopRoundCount > 0) liveMainLoopRoundCount.value = result.mainLoopRoundCount
    if (expandedRounds.length > loadedCount) {
      // Diff by roundNumber against the ENGINE's truth — never slice(loadedCount).
      // On the instant-playback resume path the loaded rounds are a WINDOW AT
      // THE CURSOR (e.g. rounds 8-9), not the head of the regenerated array:
      // slicing chopped off rounds 1-2 instead of the already-loaded ones, so
      // the engine's queue was missing two early rounds while the loadedRounds
      // mirror had all of them — every index-keyed read (currentRound, cursor
      // saves, salient-gloss fallback) then named a round exactly that many
      // steps EARLY. Proven live 2026-07-23: engine playing round 8 (S0003L01
      // 'come'/'how') while the cursor wrote S0002L01 — and with the shear
      // landing near an English-gloss neighbour, an Italian homograph like
      // 'come' displayed the WRONG LEGO's known text ('to come').
      const newRounds = expandedRounds.filter((r: any) => !simplePlayer.hasRound(r.roundNumber))
      // Keep cachedRounds in sync where other consumers read from it.
      cachedRounds.value = expandedRounds as any
      // Feed the new rounds to simplePlayer. appendRounds inserts sorted by
      // roundNumber and shifts the engine's roundIndex for rounds landing
      // before the playing one, so engine array and mirror stay aligned.
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
    return
  }

  const round = cachedRounds.value[roundIndex]
  if (!round?.items) return

  // Get practice phrases (skip intro/debut)
  const practiceItems = round.items.filter(item =>
    item.type !== 'intro' && item.type !== 'debut'
  )

  if (practiceItems.length === 0) {
    return
  }

  // Start playback
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
  // In-app course switch vs genuine document load. main.js stamps
  // __ssiBoot.mountedMs once at app.mount(); a player mount starting ≥3s
  // after it is a REMOUNT (course switch), not a fresh boot. Same detection
  // the cold_start telemetry uses at the tail of this hook — computed once
  // here so both the splash floor and the telemetry read one value.
  const bootMarks = (typeof window !== 'undefined' && (window as any).__ssiBoot) || {}
  const mountEntryPerfMs = typeof performance !== 'undefined' ? performance.now() : 0
  const isFreshLoad = typeof bootMarks.mountedMs === 'number'
    ? (mountEntryPerfMs - bootMarks.mountedMs) < 3000
    : true
  // The first-visit cinematic (2800ms) is for the first-ever boot only. A
  // course SWITCH never replays it — founder ruling 2026-07-30: switch must
  // be READY in 2–3s, and the learner's own telemetry showed every warm
  // switch pinned at exactly the 2800ms floor after an update wiped the
  // ssi-has-played flag. Return users and remounts both take the 300ms floor.
  const skipCinematic = isReturnUser || !isFreshLoad
  const MINIMUM_ANIMATION_MS = skipCinematic ? 300 : 2800

  // Resolved the moment the loading stage flips to 'ready' (play available).
  // Background work that competes with the switch's critical path for
  // bandwidth (the whole-course walk) awaits this before scheduling.
  let resolvePlayerReady: (() => void) | null = null
  const playerReadySignal = new Promise<void>((resolve) => { resolvePlayerReady = resolve })

  // Global brand welcome moment — once per device, first-ever visit only.
  // See docs/first-boot-experience.md and useBrandWelcome.ts (asset swap point).
  if (!isReturnUser && !hasSeenBrandWelcome()) {
    brandMomentPending.value = true
    playBrandWelcome()
    markBrandWelcomeSeen()
  }

  // Stage 1: Awakening (immediate)
  setLoadingStage('awakening')

  // Initialize sync stuff immediately (no await needed)
  loadAdaptationConsent()

  // Re-arm the VAD for previously-consented learners on EVERY boot path.
  // This used to live only inside the legacy cached-script load branch, which
  // the instant-playback path (early return) never reaches — so consented
  // learners booted with the VAD dead: no timing windows, no cycle_prosody
  // events, no recordCycle latency feed, zero learner_lego_metrics rows ever
  // (2026-08-02 live repro: getUserMedia never called across a full session).
  // Boot init never revokes consent on failure — a transient mic failure at
  // boot is not the learner declining (only the Settings toggle path is).
  if (adaptationConsent.value === true) {
    void initializeVad({ revokeConsentOnDenial: false }).catch(() => {})
  }

  // Fetch contribution data — display-only, so it waits for READY instead of
  // competing with the boot/switch critical path for the network.
  if (courseCode.value && supabase?.value) {
    const learnerId = (auth as any)?.learnerId?.value || null
    void playerReadySignal.then(() => contribution
      .fetch(courseCode.value, learnerId)
      .catch(() => {})
      // Settled — win or lose. The belt pill stops flashing either way; it must
      // never pulse forever because a fetch failed.
      .then(() => { contributionSettled.value = true }))
  }

  // 30-day offline lease gate. Before any offline-cold-reopen fast-path engages,
  // re-validate the lease for this course so a lapsed/expired download locks
  // (bytes preserved) instead of playing. When ONLINE we let useOfflineLease's
  // boot renew (App.vue) slide the lease forward — so this is mostly meaningful
  // when offline (the lock decision). Cheap IndexedDB read; awaited so the
  // fast-path below sees the correct offlineLeaseLocked value.
  await checkOfflineLease().catch(() => { /* fail-open: never block boot on this */ })

  // Hydrate the audio cache's in-memory id Set BEFORE anything consults the
  // fail-closed offline gate. persistent.has() is a synchronous read of a Set
  // that fills lazily; unhydrated it answers false for EVERYTHING, so every
  // cycle with real audio would be judged uncached and skipped at exactly the
  // moment a session starts. This is a local IndexedDB cursor walk, and it
  // fails open — a cache that can't hydrate must not block boot.
  await audioCache.ready().catch(() => {})

  // Restore the learner's explicit offline-mode selection BEFORE first play.
  // Once offline mode is chosen and the content downloaded, playback comes
  // from the cache ALWAYS — never gated on connectivity guesswork
  // (navigator.onLine lies on weak signal / captive portals). Only the
  // explicit toggle-off or the lease lock changes this. (Tom 2026-07-31.)
  if (persistedOfflineModeOn() && !offlineLeaseLocked.value) {
    offlineActive.value = true
    console.log('[LearningPlayer] Offline mode: restored ON (persisted selection)')
  }

  // Load developer settings. A production deep link is a fidelity listen —
  // never the QA/preview variant — so these stay off for it.
  enableQaMode.value = !learnerDefaultsForced.value && localStorage.getItem('ssi-enable-qa-mode') === 'true'
  showDebugOverlay.value = !learnerDefaultsForced.value && localStorage.getItem('ssi-show-debug-overlay') === 'true'

  // Listen for developer settings changes (from Settings screen)
  settingChangedHandler = (e: Event) => {
    const detail = (e as CustomEvent).detail
    if (!detail?.key) return
    
    switch (detail.key) {
      case 'enableQaMode':
        enableQaMode.value = detail.value
        break
      case 'showDebugOverlay':
        showDebugOverlay.value = detail.value
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
    // Deep-link / CourseBrowser jump (incl. ?seed=) — gate before moving so a
    // premium non-subscriber can't land past the free preview.
    if (!gateSeed(seedNumber)) return
    try {
      await loadSeedIfNeeded(seedNumber)
      simplePlayer.jumpToSeed(seedNumber)
      // Belt position derives from the landed round (beltAnchorSeed, M9);
      // only the lego-id signal is pushed here.
      const legoId = `S${String(seedNumber).padStart(4, '0')}L01`
      beltProgress.value?.setLastLegoId(legoId)
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
    // buffer-model step 1b: serve cached WAV blobs ONLINE too — so warm clips
    // (staged by the rolling filler) play from cache, which survives connection
    // loss / lock mid-session, with the resolver's network fallback on a miss.
    // DEFAULT ON for this feature branch: an installed PWA has no address bar, so
    // a URL opt-in couldn't reach the real iPhone lock test. Add ?stream=1 to
    // force the old streaming path for an A/B comparison. This branch is isolated
    // (feat/buffer-model), so default-on only affects this preview, never main.
    // offlinePlaybackActive() still covers the existing offline/airplane gate.
    audioCacheSource = createAudioCacheSource(
      audioCache, courseCode.value,
      () => offlinePlaybackActive() || cachePlayOnline,
    )
    audioController.value.setAudioSource(audioCacheSource)
    console.log('[LearningPlayer] AudioCache-backed audio source initialized for course:', courseCode.value, cachePlayOnline ? '(cache-play online: ON)' : '')
  }

  // Cold-start critical path: these init calls each await a Supabase
  // round-trip (belt remote merge + getMaxSeedNumber; adaptation mastery
  // hydration). NEITHER is required before the first cycle can play — only
  // getEnrollment (resume position, below) is. Every consumer is null-safe
  // with a default: adaptationEngine.value?.getPauseMultiplier() ?? 1.0, and
  // the belt computeds all `?. ?? <default>`. So we fire them concurrently
  // and DON'T await — the first cycle plays immediately and the belt
  // readout / pause tuning hydrate reactively a beat later. Previously these
  // ran serially ahead of bootstrap, stacking RTTs onto every cold start.
  const COLD_T0 = (typeof performance !== 'undefined' ? performance.now() : 0)
  void Promise.all([
    initializeBeltProgress(),
    initializeAdaptationEngine(),
  ]).then(() => {
    console.log('[ColdStart] background hydration (belt+adaptation) ready in',
      Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - COLD_T0), 'ms (off critical path)')
  }).catch((err) => {
    console.warn('[LearningPlayer] background hydration failed (non-fatal):', err)
  })

  // Load course-wide LEGO known_text lookup (powers the hero highlight in
  // cases where the salient LEGO's round isn't in loadedRounds, especially
  // infinite-play mode). Cheap one-shot query; fire-and-forget.
  void loadGlobalLegoTexts()

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
      // Load algorithm configs (Easy/Fast mode settings, etc.) - non-blocking
      loadAlgorithmConfigs().catch(err => {
        console.warn('[LearningPlayer] Failed to load algorithm configs, using defaults:', err)
      })

      // ============================================
      // Bundle load (cache-based-content-loading)
      // ============================================
      // Fire the bundle fetch as early as possible so the rolling
      // audio filler (fillBuffer / expandScript) has the longest
      // possible runway ahead of the playhead. Does NOT block the
      // existing bootstrap path — both run concurrently. Bundle fetch
      // is cache-first (localStorage), typically resolves in <10ms for
      // returning learners.
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

      // Warm the canonical main-loop round map (THE boundary source) as early
      // as possible. Cached + shared with the instant-playback bootstrap, so
      // this is usually a no-op cache hit. The INF-PLAY build below awaits it
      // explicitly before reading the boundary.
      void ensureMainLoopMap()

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
        // DB-canonical resume anchor — used by the cache fast-path below when
        // localStorage has no position (after ?reset=1 / a new device), so a
        // returning learner resumes at their cursor, NOT round 1.
        let inferCursorLegoId: string | null = null
        // Legacy ceiling (highest_completed_lego_id) — read-only fallback for
        // when the cursor is null/unresolvable. Never written back / ratcheted
        // from here (2026-07-05 narrow reinstatement).
        let inferCeilingLegoId: string | null = null
        // The DB cycle within the cursor's round — so a cold-localStorage resume
        // (new device / different origin / after ?reset=1) lands on the exact
        // CYCLE, not the round's intro. Fixes "main resumes at LEGO intro".
        let inferCursorCycle = 0
        if (!isGuestLearner.value && progressStore?.value && learnerId.value) {
          try {
            // Bounded: this pre-check runs ahead of the cache fast-path below,
            // so an unbounded hang here (flaky mobile connection, no timeout
            // on the Supabase client — see App.vue) stalled cold start for
            // every signed-in learner regardless of whether they had a warm
            // cache. Timeout falls to the catch below same as any other
            // enrollment-read failure — mode defaults to 'main', cursor/
            // ceiling stay null, and the cache fast-path or legacy load
            // takes over exactly as it does today when this read errors.
            const MODE_PRECHECK_TIMEOUT_MS = 2000
            const TIMEOUT = Symbol('mode-precheck-timeout')
            const result = await Promise.race([
              activeProgressStore.value.getEnrollment(learnerId.value, courseCode.value),
              new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), MODE_PRECHECK_TIMEOUT_MS)),
            ])
            if (result === TIMEOUT) throw new Error('enrollment mode pre-check timed out')
            const enr = result
            inferCursorLegoId = enr?.last_completed_lego_id ?? null
            inferCeilingLegoId = enr?.highest_completed_lego_id ?? null
            // Cursor-only model: infinite-play is DERIVED from the cursor —
            // no is_new LEGO beyond it — not read from the enrollment.current_mode
            // column (2026-07-04). Infplay entry always stamps the cursor to the
            // course's final LEGO (setMode's ratchetHighestTo write), so this
            // agrees with the explicit-entry ("belt-skipped past content") case too.
            inferEnrollmentMode = (await hasReachedInfinitePlay(inferCursorLegoId, courseCode.value)) ? 'infplay' : 'main'
            inferInfPlayRoundIndex = Math.max(1, enr?.infplay_round_index ?? 1)
            inferCursorCycle = Math.max(0, enr?.current_cycle_index ?? 0)
          } catch (modeErr) {
            console.warn('[InstantPlayback] mode pre-check failed, defaulting to main:', modeErr)
          }
        }

        // ============================================
        // PRODUCTION DEEP LINK — "open this round in the learning app"
        // ============================================
        // Popty's Script Viewer launches a specific round here so a producer
        // can hear it exactly as a learner does. Resolve the target against
        // the course round-map (cached — the same map bootstrap uses) and then
        // stand in for the enrollment cursor: every downstream boot path
        // (cache fast-path, bootstrap, stale-matview repair) resolves position
        // from these variables, so one override lands them all.
        //
        // A target this course doesn't have leaves everything untouched —
        // deepLinkStart stays null and the visitor resumes normally, with a
        // console warning. No learner-facing error surface for a production
        // tool's deep link.
        if (deepLinkAppliesTo(deepLinkTarget, courseCode.value)) {
          try {
            const dlMap = await instantPlayback.getOrFetchRoundMap()
            const resolved = resolveDeepLinkTarget(deepLinkTarget, dlMap)
            if (resolved) {
              deepLinkStart.value = resolved
              // Main loop, always: the deep link names a main-loop round, so a
              // learner already in INF PLAY must not be bootstrapped from
              // /infplay-cycles and sent somewhere else entirely.
              inferEnrollmentMode = 'main'
              inferInfPlayRoundIndex = 1
              inferCursorLegoId = resolved.legoId
              inferCeilingLegoId = null
              inferCursorCycle = resolved.cycleIndex
              console.log(`[DeepLink] Starting at ${resolved.legoId} cycle ${resolved.cycleIndex} via ${resolved.via}`)
              // Say out loud what the fidelity rule suppressed, so a reviewer
              // can see they are on learner defaults rather than trust it.
              const suppressed: string[] = []
              try {
                const spd = parseFloat(localStorage.getItem('learner_speed') || '1.0')
                if (!Number.isNaN(spd) && spd !== 1.0) suppressed.push(`learner_speed ${spd} → 1.0`)
                if (localStorage.getItem('ssi-enable-qa-mode') === 'true') suppressed.push('QA mode → off')
                if (localStorage.getItem('ssi-show-debug-overlay') === 'true') suppressed.push('debug overlay → off')
                if (localStorage.getItem(ADAPTATION_CONSENT_KEY) === 'true') suppressed.push('adaptation → off')
                if (localStorage.getItem(OFFLINE_MODE_KEY_PREFIX + courseCode.value) === '1') suppressed.push('offline mode → off')
              } catch { /* storage blocked — nothing local to suppress anyway */ }
              console.log(
                suppressed.length
                  ? `[DeepLink] Learner defaults enforced, local settings suppressed for this launch: ${suppressed.join(', ')}`
                  : '[DeepLink] Learner defaults enforced, no local settings to suppress',
              )
            }
          } catch (dlErr) {
            console.warn('[DeepLink] Could not resolve the deep-link target — resuming normally:', dlErr)
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
        // Stale-content safety: checkContentVersion runs before
        // LearningPlayer mounts. A content_version bump (audio regenerated)
        // still clears the cache outright, so a hit is never on stale AUDIO.
        // A content_stamp move (text/structure fix) deliberately does NOT
        // clear — SWR (founder ruling 2026-07-27): serve the stale script
        // this session, revalidate in the background, fresh next session.
        if (inferEnrollmentMode === 'main') {
          try {
            const cachedScript = await getCachedScript(courseCode.value)
            if (cachedScript && cachedScript.rounds.length > 0) {
              console.log(`[InstantPlayback] Cache fast-path: hydrating ${cachedScript.rounds.length} rounds from localStorage`)
              // SWR: this hydration deliberately serves even a STALE-stamped
              // entry (checkContentVersion no longer drops it) — play now,
              // revalidate in the background, fresh script next session.
              sessionScriptVintage = cachedScript.contentStamp ?? null
              const staleNow = getScriptStaleness(courseCode.value)
              coldScriptPath = staleNow ? 'swr' : 'cache'
              scheduleSwrRevalidation()
              cachedRounds.value = cachedScript.rounds
              // Single-source the boundary on the audio-aware count baked into
              // the cache when it was written from a full generateScript. Caches
              // written before this field existed leave it undefined → boundary
              // falls back to the matview, as before (and self-heals on the next
              // full-script handoff this session).
              if (typeof cachedScript.mainLoopRoundCount === 'number' && cachedScript.mainLoopRoundCount > 0) {
                liveMainLoopRoundCount.value = cachedScript.mainLoopRoundCount
              }
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
              let resumeRoundIndex = resume?.roundIndex ?? 0
              let resumeCycle = resume?.cycleIndex ?? 0
              // localStorage had no position (cleared cache / new device). Don't
              // strand a returning learner at round 1 — resolve from the DB
              // cursor, then the ceiling, against the cached rounds. This is the
              // cache-fast-path counterpart to resolveStartLegoId's fallback;
              // without it, every ?reset=1 dropped signed-in learners at LEGO 1.
              if (!resume) {
                const fastRounds = cachedScript.rounds as any[]
                const findLego = (lego: string) => fastRounds.findIndex((r: any) => r?.legoId === lego)
                // Cursor first; if the cursor is null/unresolvable, fall back
                // to the legacy ceiling (highest_completed_lego_id) when
                // populated — read-only, never ratcheted (2026-07-05 narrow
                // reinstatement). Only a learner with neither starts at R1.
                const { legoId: fastAnchor, viaCeiling: fastViaCeiling } =
                  resolveResumeAnchor(inferCursorLegoId, inferCeilingLegoId, findLego)
                if (fastAnchor) {
                  resumeRoundIndex = findLego(fastAnchor)
                  // The ceiling fallback has no saved cycle position — land on
                  // the round's intro. Only the resolved CURSOR carries an
                  // exact cycle (current_cycle_index) to restore.
                  resumeCycle = fastViaCeiling ? 0 : inferCursorCycle
                  // Same gap rule on the DB-cursor path (cold localStorage):
                  // a real break restarts the round rather than the exact cycle.
                  // FAIL CLOSED: a missing/not-yet-loaded timestamp can't prove
                  // a brief pause — restart the round (Aran 2026-06-11).
                  if (resumeCycle > 0) {
                    const ts = savedLastPracticedAt.value
                    if (!ts || (Date.now() - ts.getTime()) / 60000 >= resumeConfig.value.cycleResetMinutes) resumeCycle = 0
                  }
                } else if (inferCursorLegoId || inferCeilingLegoId) {
                  console.warn(`[InstantPlayback] cache fast-path: neither cursor (${inferCursorLegoId}) nor ceiling (${inferCeilingLegoId}) in cached rounds; starting at R1`)
                }
              }
              if (resumeRoundIndex > 0 || resumeCycle > 0) {
                simplePlayer.jumpToRound(resumeRoundIndex, resumeCycle)
              }

              const startedAtLegoId = cachedScript.rounds[resumeRoundIndex]?.legoId
              if (startedAtLegoId) {
                instantPlayback.setCurrentLegoId(startedAtLegoId)
                if (beltProgress.value?.setLastLegoId) {
                  beltProgress.value.setLastLegoId(startedAtLegoId)
                }
                // (playingSeedNumber derives from the landed round — M9.)
              }

              positionInitialized.value = true
              dataReady = true
              return
            }
          } catch (cacheErr) {
            console.warn('[InstantPlayback] Cache fast-path failed, falling through to bootstrap:', cacheErr)
          }
        }

        // ============================================
        // INF PLAY RESUME — DETERMINISTIC LOCAL BUILD (online)
        // ============================================
        // INF PLAY is "the frozen online script run forward": the SAME
        // deterministic revival rounds the belts build (generateScript's
        // 50-round SR drain + seeded-USE tail), NOT the per-session random
        // /infplay-cycles sampling. Resuming directly into INF PLAY therefore
        // builds the local script and jumps to the revival round keyed on the
        // learner's infplay_round_index, so resume is STABLE per learner
        // (back-nav returns to what was just heard) rather than freshly
        // randomised. Offline keeps its own seeded-cache path; the random
        // /infplay-cycles bootstrap below survives ONLY as the safety net for
        // when the local build genuinely yields no revival rounds.
        if (inferEnrollmentMode === 'infplay' && !offlinePlaybackActive()) {
          try {
            // The boundary (mainLoopBoundary) must be resolved before we index
            // into the built script — await the canonical map here.
            await ensureMainLoopMap()

            // WARM PATH (INF PLAY). The deterministic build is a frozen,
            // seeded stream — identical on every regen for a given
            // learner+course — so a cached copy IS the fresh build. The old
            // "INF PLAY is excluded from the script cache" rule predates
            // this determinism: it guarded the per-session-random
            // /infplay-cycles sampling, which survives only as the fallback
            // below. Hydrate when the saved revival cursor still lands
            // inside the cached tail; otherwise fall through to a fresh
            // build (which re-caches). Without this, every open of a
            // COMPLETED course paid the whole-course walk on switch —
            // exactly the courses a heavy learner flips between.
            let fullRounds: any[] | null = null
            let builtMainLoopCount = 0
            try {
              const cachedInf = await getCachedScript(courseCode.value)
              if (
                cachedInf && cachedInf.rounds.length > 0 &&
                typeof cachedInf.mainLoopRoundCount === 'number' && cachedInf.mainLoopRoundCount > 0 &&
                cachedInf.rounds.length > cachedInf.mainLoopRoundCount + Math.max(0, inferInfPlayRoundIndex - 1)
              ) {
                fullRounds = cachedInf.rounds as any[]
                builtMainLoopCount = cachedInf.mainLoopRoundCount
                if (cachedInf.courseWelcome) cachedCourseWelcome.value = cachedInf.courseWelcome
                // SWR: a stale-stamped entry still hydrates (play now,
                // revalidate on idle, fresh tail next session).
                sessionScriptVintage = cachedInf.contentStamp ?? null
                coldScriptPath = getScriptStaleness(courseCode.value) ? 'swr' : 'infplay_cache'
                scheduleSwrRevalidation()
                console.log(`[InstantPlayback] INF-PLAY cache fast-path: hydrating ${fullRounds.length} rounds`)
              }
            } catch (_cacheErr) {
              /* cache is best-effort — bootstrap fallback below */
            }

            // NO usable cache → do NOT build the whole course before playing
            // (founder ruling 2026-07-27: progressive, never block past
            // readiness-to-start). Throw to the /infplay-cycles bootstrap
            // below — playing within a couple of seconds — while the existing
            // INF-PLAY idle warm builds + caches the deterministic tail for
            // the next session. Trade (founder-accepted): this ONE session
            // plays the per-session random sampling instead of the frozen
            // deterministic stream; determinism resumes next open.
            if (!fullRounds) {
              throw new Error('No cached deterministic INF-PLAY script — starting from /infplay-cycles bootstrap')
            }
            // Single-source the boundary on the audio-aware count from the build
            // (or its cached equivalent) — set BEFORE the mainLoopBoundary()
            // read below so the first-revival-round index is computed off the
            // live extent, not the (possibly stale, non-audio-filtered) matview.
            if (builtMainLoopCount > 0) {
              liveMainLoopRoundCount.value = builtMainLoopCount
            }
            // Where the revival tail begins = the live main-loop boundary
            // (the single source of truth, the SAME value the forward/back nav
            // and tail wrap read). Must agree with nav or resume lands on a
            // different "first revival round" than forward/back think it is.
            const mainLoopCount = mainLoopBoundary()
            // First revival round index. The tail sits right after the main loop;
            // infplay_round_index is 1-based within that tail.
            const firstInfIdx = mainLoopCount > 0 && fullRounds.length > mainLoopCount
              ? mainLoopCount
              : -1
            if (firstInfIdx < 0) {
              throw new Error('Deterministic INF-PLAY build produced no revival rounds')
            }
            simplePlayer.initialize(fullRounds as any)
            cachedRounds.value = fullRounds as any
            loadedRounds.value = fullRounds as any
            extractComponentsToMaps(fullRounds as any, '[Components] infplay-resume')

            // Land on the revival round for the saved infplay_round_index,
            // clamped to the tail. Offset is (index - 1) because the readout
            // is 1-based.
            const targetInfIdx = Math.min(
              fullRounds.length - 1,
              firstInfIdx + Math.max(0, inferInfPlayRoundIndex - 1),
            )
            if (targetInfIdx > 0) simplePlayer.jumpToRound(targetInfIdx)
            currentMode.value = 'infplay'
            if (infplayRoundIndex.value === 0) infplayRoundIndex.value = Math.max(1, inferInfPlayRoundIndex)

            // Pre-cache the landed round's first cycle so play doesn't gap,
            // then warm the rest in the background (build-before-play).
            warmUpInfPlayRoundsBackground(fullRounds as any, targetInfIdx)

            // Belt anchor: course-end seed (top reachable belt), NOT the
            // revival round's random USE legoId. Mirrors enterInfPlay.
            // inferCursorLegoId is used here (not a separate ceiling): infplay
            // entry always stamps the cursor to the course's final LEGO, so
            // whenever inferEnrollmentMode === 'infplay' the cursor already IS
            // the course-end anchor (2026-07-04 cursor-only model).
            const finalLegoId = inferCursorLegoId ?? courseFinalLegoRef.value?.legoId ?? null
            if (finalLegoId) {
              if (!lastMainLoopLegoId.value || finalLegoId > lastMainLoopLegoId.value) {
                lastMainLoopLegoId.value = finalLegoId
              }
              if (beltProgress.value?.setLastLegoId) beltProgress.value.setLastLegoId(finalLegoId)
              {
                const finalSeed = getSeedFromLegoId(finalLegoId)
                if (finalSeed !== null) beltFreezeSeed.value = finalSeed
              }
            }
            console.log(`[InstantPlayback] INF-PLAY resume: cache hydration, ${fullRounds.length} rounds, landed at revival idx ${targetInfIdx} (infRound=${inferInfPlayRoundIndex})`)
            // (The uncached case no longer builds here — it bootstraps from
            // /infplay-cycles below, and the INF-PLAY idle warm persists the
            // deterministic build for the next session's zero-walk hydration.)
            positionInitialized.value = true
            dataReady = true
            return
          } catch (infErr) {
            console.warn('[InstantPlayback] Deterministic INF-PLAY resume failed — falling back to /infplay-cycles bootstrap:', infErr)
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
          // Progressive start: the playhead segment came from /cycles (or
          // /infplay-cycles); the full walk runs behind playback. The rounds
          // are live-vintage (server-computed from current content).
          coldScriptPath = 'progressive'
          sessionScriptVintage = undefined

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
                mainLoopBoundary(),  // boundary from the canonical round-map (single source of truth)
                currentTargetSpeedConfig(),
              )
            : backendCyclesToRounds(
                instantPlayback.getBufferedCyclesForLego,
                map,
                instantPlayback.isLegoComplete,
                currentTargetSpeedConfig(),
                MODE_NEUTRAL_REPEATS,
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
          // A production deep link carries its own cycle and overrides the
          // saved one — bootstrap landed on the deep-linked LEGO, so cycle 0
          // is the start of exactly the round that was asked for. The cycle is
          // resolved by TEXT against the round we actually built, because the
          // ordinal alone lands on the wrong row (see deepLinkTarget.ts).
          const resumeCycle = deepLinkStart.value?.legoId === startedAtLegoId
            ? resolveCycleIndex((initialRounds as any[])[0]?.cycles, deepLinkStart.value)
            : (localPos?.legoId === startedAtLegoId)
              ? Math.max(0, localPos?.itemInRound || 0)
              : Math.max(0, savedCurrentCycleIndex.value || 0)
          if (resumeCycle > 0) {
            console.log(`[InstantPlayback] Resuming at ${startedAtLegoId} cycle ${resumeCycle}`)
            simplePlayer.jumpToRound(0, resumeCycle)
          }
          // Keep the composable's cursor in sync with what's playing,
          // so tier-3 anchors the N+1 lookup off the right LEGO.
          instantPlayback.setCurrentLegoId(startedAtLegoId)

          // Belt anchor on resume.
          //
          // INF PLAY: startedAtLegoId is a random USE LEGO (any point in the
          // course), so anchoring the belt to its seed shows a false LOW belt
          // (the green-on-resume bug). Mirror the INF-PLAY *entry* path: anchor
          // the belt to the course-END seed (the final LEGO = top reachable
          // belt). Also seed lastMainLoopLegoId so the round-changed belt
          // writer (visualLegoIdForRound) keeps anchoring to the ceiling
          // instead of falling through to each round's random USE seed.
          if (inferEnrollmentMode === 'infplay') {
            // inferCursorLegoId (not a separate ceiling): infplay entry always
            // stamps the cursor to the course's final LEGO, so the cursor
            // already IS the course-end anchor here (2026-07-04 cursor-only model).
            const finalLegoId = inferCursorLegoId ?? courseFinalLegoRef.value?.legoId ?? null
            if (finalLegoId) {
              if (!lastMainLoopLegoId.value || finalLegoId > lastMainLoopLegoId.value) {
                lastMainLoopLegoId.value = finalLegoId
              }
              if (beltProgress.value?.setLastLegoId) beltProgress.value.setLastLegoId(finalLegoId)
              {
                const finalSeed = getSeedFromLegoId(finalLegoId)
                if (finalSeed !== null) beltFreezeSeed.value = finalSeed
              }
            }
          } else {
            // Main loop: belt position derives from the landed round (M9);
            // only the lego-id signal is pushed here.
            if (startedAtLegoId && beltProgress.value?.setLastLegoId) {
              beltProgress.value.setLastLegoId(startedAtLegoId)
            }
          }

          // 5. Background tier 3 — main-loop only. INF PLAY has its own
          //    pagination via prefetchNextInfPlayBatch (fired by the
          //    near-edge watcher below). Tier 3 walks the round-map by
          //    legoId, which doesn't make sense for INF PLAY's by-round
          //    structure. (Tier 2 listening-audio prefetch was retired
          //    2026-05-23 — JIT fetch + SW CacheFirst cover it.)
          if (inferEnrollmentMode !== 'infplay') {
            void instantPlayback.prefetchTier3()
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
                  currentTargetSpeedConfig(),
                  MODE_NEUTRAL_REPEATS,
                )
                // Guard: if the learner tapped ∞ while this main-loop
                // prefetch was in flight, the queue is now the deterministic
                // INF-PLAY revival set — a stray main-loop append would splice
                // a LEGO-intro round into live INF PLAY. Bail.
                if (currentMode.value === 'infplay') return
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
              const mainLoopCount = mainLoopBoundary()
              const refreshedRounds = infPlayCyclesToRounds(
                instantPlayback.infPlayCycles.value as any,
                mainLoopCount,
                currentTargetSpeedConfig(),
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

          // INF PLAY: content comes from the /infplay-cycles endpoint,
          // paginated batch-by-batch — the live queue here is the
          // deterministic revival set and must NOT be replaced with it.
          // BUT skipping the full-script walk entirely (as before fa33a295)
          // meant it ran for the FIRST time exactly when the learner jumped
          // back to an earlier belt via the modal, blocking the UI on the
          // whole course-wide generateScript() walk (Tom's "belt jump takes
          // several seconds" 2026-07-06). So still warm it on idle — merge
          // the main-loop rounds in via addRounds (dedupes by legoId,
          // index-safe against the live cursor — see mergeGeneratedRoundsIntoQueue)
          // so a later handleSkipToBelt's loadSeedIfNeeded finds the target
          // belt already loaded and skips the walk. Guarded on currentMode
          // still being 'infplay' when the idle task fires so a fast exit
          // doesn't race a stale merge in behind it.
          if (inferEnrollmentMode === 'infplay') {
            positionInitialized.value = true
            dataReady = true
            // Ready-gated for the same reason as the main-loop handoff below:
            // the walk's course-wide queries must not compete with the switch's
            // critical path (founder ruling 2026-07-30).
            void playerReadySignal.then(() => scheduleIdleTask(() => {
              void generateScript()
                .then(async (result) => {
                  if (currentMode.value !== 'infplay') return
                  if (result.mainLoopRoundCount > 0) liveMainLoopRoundCount.value = result.mainLoopRoundCount
                  if (result.items.length === 0) return
                  // ONE cooperative conversion feeds both the queue merge and
                  // the cachedRounds mirror (this used to convert the whole
                  // course twice, back to back, in one main-thread task).
                  const converted = await toSimpleRoundsWithComponentsSliced(result.items) as any[]
                  // Re-check the mode: the sliced conversion yields, so a
                  // fast INF-PLAY exit can land mid-conversion — same stale-
                  // merge guard as the scheduleIdleTask entry above.
                  if (currentMode.value !== 'infplay') return
                  mergeConvertedRoundsIntoQueue(converted)
                  cachedRounds.value = converted
                  sessionScriptVintage = undefined // fresh walk → live vintage
                  try {
                    await setCachedScript(courseCode.value, {
                      rounds: cachedRounds.value,
                      totalSeeds: cachedRounds.value.length,
                      totalLegos: cachedRounds.value.length,
                      totalCycles: result.cycleCount,
                      estimatedMinutes: Math.round(result.cycleCount * 0.2),
                      audioMapObj: {},
                      courseWelcome: cachedCourseWelcome.value || undefined,
                      mainLoopRoundCount: result.mainLoopRoundCount,
                    })
                  } catch (cacheErr) {
                    console.warn('[InstantPlayback] setCachedScript failed during INF-PLAY idle warm (non-fatal):', cacheErr)
                  }
                })
                .catch((err) => {
                  console.warn('[InstantPlayback] INF-PLAY idle full-script warm failed, belt-skip will fall back to foreground regen:', err)
                })
            }))
            return
          }

          // Main-loop handoff path below.
          //
          // DEFERRED + NON-CLOBBERING (course-load-window fix). The full
          // course-wide walk (generateScript) is NOT on the critical path to
          // first play — the bootstrap above already gave us audio, and the
          // near-edge tier-3 watcher keeps serving subsequent main-loop rounds
          // per-round via /cycles (WITH their authored decomposition/display_tiling,
          // which the walk deliberately no longer fetches). So:
          //   1. We schedule the walk on IDLE, after the first cycle is playing,
          //      so its six course-wide queries never starve the bootstrap. The
          //      buttons go live the instant the bootstrap finishes (dataReady is
          //      set below, NOT gated on this walk).
          //   2. The walk's output is used for the audio-aware boundary
          //      (liveMainLoopRoundCount — INF-PLAY entry needs it), for the
          //      warm-start cache, and for the stale-matview resume repair. It
          //      does NOT blanket-replace the live queue: replaceQueueFromCurrent
          //      pre-empts tier-3 (appendRounds dedupes by roundNumber), which
          //      would permanently strip the authored tiling tier-3 supplies. We
          //      only swap the queue in when the resume repair actually needs
          //      fullRounds as its jump target (the fra/spa stale-matview case —
          //      Latin-script courses where runtime decomposition is fine).
          const runFullScriptHandoff = () => generateScript()
            .then(async (result) => {
              // Sliced conversion — the whole-course Round[] build yields per
              // round, so it can't add a post-READY main-thread block.
              const fullRounds = await toSimpleRoundsWithComponentsSliced(result.items) as any[]
              if (fullRounds.length === 0) {
                console.warn('[InstantPlayback] Full-script gen returned 0 rounds — staying on /cycles path')
                return
              }
              // SINGLE-SOURCE THE BOUNDARY on the live, audio-aware extent the
              // generator just computed. MUST run BEFORE the ∞-entry guard below:
              // a mid-walk INF-PLAY tap drops the queue swap, but the live count
              // is still the truth for that session and every downstream boundary
              // read (advanceInfPlayRound, tail wrap, pod cadence) needs it set.
              // This lets fra/spa — whose matview is frozen short of the real
              // audio'd end — actually reach the true tail and enter INF PLAY.
              if (result.mainLoopRoundCount > 0) {
                liveMainLoopRoundCount.value = result.mainLoopRoundCount
              }
              // Mirror the full course into the legacy ref so saveRoundProgress's
              // cachedRounds walk (text/progress only) has the whole course in
              // scope, not just the loaded window. This is text metadata — it does
              // not touch the live playback queue or its authored tiling.
              cachedRounds.value = fullRounds
              sessionScriptVintage = undefined // fresh walk → live vintage

              // Guard: if the learner tapped ∞ during the walk, the live queue is
              // the deterministic INF-PLAY revival set — never repair/swap it (the
              // "mid-stream LEGO-intro on first entry" bug). The boundary + cache
              // below still apply. Tom 2026-05-29.
              if (currentMode.value === 'infplay') {
                console.log('[InstantPlayback] Full-script handoff arrived after ∞ entry — skipping main-loop repair')
              } else if (inferEnrollmentMode === 'main') {
                // STALE-MATVIEW RESUME REPAIR. resolveStartLegoId resolved the
                // bootstrap landing against the course_round_index matview. For a
                // learner whose saved cursor sits PAST a stale matview MAX (fra/spa:
                // matview frozen short of the audio'd end), the cursor wasn't in the
                // matview → the resolver fell to the ceiling (also unresolvable) →
                // R1, stranding them at the course start. Now that the full
                // audio-aware script has landed, re-resolve their DB cursor (then
                // ceiling) against fullRounds and jump there. This is the ONLY case
                // that needs fullRounds to become the live queue, so the queue swap
                // lives inside this branch — a correct bootstrap landing (the common
                // case, and every CJK course, whose matview is not stale) leaves the
                // tier-3 /cycles queue and its authored tiling untouched.
                try {
                  const findInFull = (lego: string) => fullRounds.findIndex((r: any) => r?.legoId === lego)
                  const landedLegoId = simplePlayer.currentRound?.value?.legoId ?? startedAtLegoId
                  const landedIdx = landedLegoId ? findInFull(landedLegoId) : -1
                  // The learner's TRUE position: cursor first, then the
                  // legacy ceiling (highest_completed_lego_id) when the
                  // cursor is null/unresolvable — read-only fallback, never
                  // ratcheted (2026-07-05 narrow reinstatement).
                  const { legoId: trueLego, viaCeiling: trueViaCeiling } =
                    resolveResumeAnchor(inferCursorLegoId, inferCeilingLegoId, findInFull)
                  const trueIdx = trueLego ? findInFull(trueLego) : -1
                  let trueCycle = trueViaCeiling ? 0 : inferCursorCycle
                  // Only repair when the true position resolves in the full script
                  // AND is strictly AHEAD of where the bootstrap landed (the stale-
                  // matview fallback always lands EARLIER — R1/ceiling — never past
                  // the real cursor). Equal/behind = leave alone, so a correct
                  // landing or a learner who stepped forward is never disturbed.
                  if (trueIdx >= 0 && (landedIdx < 0 || trueIdx > landedIdx)) {
                    // Repair required → make fullRounds the engine queue, then jump.
                    simplePlayer.replaceQueueFromCurrent(fullRounds)
                    // Same gap rule as the other cursor-resume paths: a real break
                    // restarts the round rather than the exact cycle. FAIL CLOSED:
                    // no trustworthy timestamp → restart the round.
                    if (trueCycle > 0) {
                      const ts = savedLastPracticedAt.value
                      if (!ts || (Date.now() - ts.getTime()) / 60000 >= resumeConfig.value.cycleResetMinutes) trueCycle = 0
                    }
                    const trueLegoId = fullRounds[trueIdx]?.legoId
                    console.log(`[InstantPlayback] Stale-matview resume repair: bootstrap landed at ${landedLegoId} (idx ${landedIdx}); true position ${trueLegoId} (idx ${trueIdx} cycle ${trueCycle}) — swapping queue + jumping`)
                    // fullRounds is now the engine's queue, so trueIdx is a valid
                    // engine index — single jump, preserving the resume cycle.
                    simplePlayer.jumpToRound(trueIdx, trueCycle)
                    instantPlayback.setCurrentLegoId(trueLegoId ?? landedLegoId)
                    if (trueLegoId && beltProgress.value?.setLastLegoId) beltProgress.value.setLastLegoId(trueLegoId)
                    // (playingSeedNumber derives from the landed round — M9.)
                  }
                } catch (repairErr) {
                  console.warn('[InstantPlayback] Stale-matview resume repair failed (non-fatal):', repairErr)
                }
              }

              // Cache for warm-start — always, independent of whether the queue
              // was swapped. The next cold start hits localStorage and skips the
              // generateScript walk; welcome metadata + course shape + the audio-
              // aware boundary are available instantly offline. The audio map is
              // stripped on write (audioRefs live on the items already), so the
              // cache stays under the 5MB localStorage budget.
              try {
                await setCachedScript(courseCode.value, {
                  rounds: fullRounds,
                  totalSeeds: fullRounds.length,
                  totalLegos: fullRounds.length,
                  totalCycles: result.cycleCount,
                  estimatedMinutes: Math.round(result.cycleCount * 0.2),
                  audioMapObj: {},
                  courseWelcome: cachedCourseWelcome.value || undefined,
                  // Persist the audio-aware boundary so the next warm start's
                  // cache-fast-path single-sources it (not the stale matview).
                  mainLoopRoundCount: result.mainLoopRoundCount,
                })
              } catch (cacheErr) {
                console.warn('[InstantPlayback] setCachedScript failed (non-fatal):', cacheErr)
              }
            })
            .catch((err) => {
              console.warn('[InstantPlayback] Full-script background gen failed, /cycles path remains the fallback:', err)
            })

          // Fire the walk only once the player is READY (founder ruling
          // 2026-07-30: readiness = first LEGO identified; everything else
          // streams behind it). scheduleIdleTask alone wasn't enough — its
          // 2s ceiling let the walk's ~45 course-wide queries fire DURING the
          // switch window, and on a phone pipe they starved the two critical
          // fetches (measured 4–9s to READY on-device). The walk lands in the
          // background well before the learner nears the INF-PLAY boundary
          // that consumes its output.
          void playerReadySignal.then(() => scheduleIdleTask(() => { void runFullScriptHandoff() }))

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
          const status = (err as { status?: number } | null)?.status
          if (status === 403) {
            // An entitlement 403 here is NOT a benign degrade — it means a
            // learner who SHOULD get the fast path is being dropped onto the
            // slow legacy walk. This is exactly the silent regression class
            // d4396730 introduced. Make it LOUD (error, not warn) and record
            // it in player_events so it's visible in telemetry, not just the
            // console.
            console.error(
              '[InstantPlayback] ENTITLEMENT 403 → degrading to slow legacy walk. ' +
              'Signed-in paid learner denied the fast path (auth token likely not ' +
              'reaching the server, or a genuine entitlement gap).', err,
            )
            logEvent('instant_playback_entitlement_fallback', {
              courseCode: courseCode.value,
              guest: isGuestLearner.value,
              mode: inferEnrollmentMode,
            })
          } else {
            console.warn('[InstantPlayback] Cutover path failed, falling back to legacy:', err)
          }
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
              // Cursor-only resume (2026-07-04 decision): the DB cursor
              // (freshLastLego) is the sole position source. The legacy
              // ceiling (freshHighestLego) is a read-only fallback used
              // ONLY when the cursor is null/unresolvable — never
              // ratcheted against beltProgress's localStorage-derived
              // completedRounds/currentSeedNumber, which is exactly the
              // ratchet semantics the cursor-only decision killed. Same
              // resolveResumeAnchor helper the instant-playback path
              // uses; "resolvable" here means the legoId parses to a
              // seed (no round-map is loaded yet at this point in boot).
              const findResolvable = (legoId: string) => (getSeedFromLegoId(legoId) !== null ? 0 : -1)
              const { legoId: anchorLegoId, viaCeiling } = resolveResumeAnchor(freshLastLego, freshHighestLego, findResolvable)
              if (viaCeiling) {
                console.warn(`[LearningPlayer] cursor ${freshLastLego} unresolvable; falling back to ceiling ${anchorLegoId}`)
              }
              startingSeed = anchorLegoId ? (getSeedFromLegoId(anchorLegoId) ?? 0) : 0
              isReturningUser = startingSeed > 0 || !!freshHighestLego
            }

            // Set playing belt to match starting position. PRE-ENGINE seed
            // (no script/engine exists yet at this point in boot) so the
            // splash belt is right during loading; once the engine lands,
            // the derived beltAnchorSeed (M9) takes over.
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

            // Legacy fallback = a blocking full-course walk before play. Should
            // be rare (instant-playback failure). Be honest about the wait and
            // tag it in telemetry so erosion back onto this path is visible.
            coldScriptPath = 'full'
            sessionScriptVintage = undefined
            beginBlockingRegenNotice()
            try {

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
              // freshLastLego (the cursor) was already read at the top of
              // this branch. Cursor-only model (2026-07-04): infinite-play
              // is derived from the cursor — no is_new LEGO remains beyond
              // it — rather than a separate ratcheted ceiling or a stored
              // current_mode flag. This also covers explicit purple-button
              // entry (belt-skipped forward without touching the literal
              // final LEGO): setMode's ratchetHighestTo write stamps the
              // cursor to the course's final LEGO on infplay entry, so the
              // cursor already reflects "done with new content" either way.
              hasReachedInfinitePlayInSession = await hasReachedInfinitePlay(
                freshLastLego,
                courseCode.value,
              )
              console.log(`[LearningPlayer] Infinite-play check: cursor_lego=${freshLastLego} → ${hasReachedInfinitePlayInSession ? 'YES, in INF PLAY' : 'no, still in main loop'}`)

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

            } finally {
              endBlockingRegenNotice()
            }

            if (result.items.length > 0) {
              // Legacy fallback path (instant-playback unavailable). This still
              // generates the full audio-aware script, so single-source the
              // boundary on its count here too — the matview is never consulted
              // again once this lands.
              if (result.mainLoopRoundCount > 0) liveMainLoopRoundCount.value = result.mainLoopRoundCount
              const simpleRounds = toSimpleRoundsWithComponents(result.items)

              simplePlayer.initialize(simpleRounds as any)

              // Restore position for returning users.
              // Uses last_completed_lego_id (exact LEGO position) instead of
              // seed number — seed-based resume jumps to the first round of
              // the NEXT seed, which skips mid-seed LEGOs the learner hadn't
              // finished. Falls back to seed-based only if lastLegoId is
              // missing.
              // Production deep link on the legacy path. Reached either when
              // instant playback is off for this course (round-map never
              // fetched, so resolve against the generated rounds themselves)
              // or when the instant path threw and fell through here. Lands ON
              // the named round — not the round AFTER it, which is what the
              // resume branch below does deliberately for a returning learner.
              let deepLinkJumped = false
              if (deepLinkAppliesTo(deepLinkTarget, courseCode.value)) {
                const dl = deepLinkStart.value ?? resolveDeepLinkTarget(deepLinkTarget, {
                  rounds: (simpleRounds as any[]).map((r: any, i: number) => ({ r: i + 1, legoId: r?.legoId })),
                })
                const dlIdx = dl ? (simpleRounds as any[]).findIndex((r: any) => r?.legoId === dl.legoId) : -1
                if (dl && dlIdx >= 0) {
                  const dlCycle = resolveCycleIndex((simpleRounds as any[])[dlIdx]?.cycles, dl)
                  console.log(`[DeepLink] eagerLoad: starting at ${dl.legoId} (round index ${dlIdx}, cycle ${dlCycle})`)
                  simplePlayer.jumpToRound(dlIdx, dlCycle)
                  deepLinkJumped = true
                } else {
                  console.warn('[DeepLink] eagerLoad: target not in the generated rounds — resuming normally')
                }
              }

              if (isReturningUser && !deepLinkJumped) {
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
                  const msSince = Date.now() - savedLastPracticedAt.value.getTime()
                  const daysSince = msSince / (1000 * 60 * 60 * 24)
                  const minutesSince = msSince / (1000 * 60)
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
                      // NEAREST >= match: the belt's first LEGO is the first
                      // round at/above its threshold seed (rarely exactly on
                      // it). Exact-seed matching silently no-op'd the
                      // regression for belts not starting on the threshold.
                      const beltStartRoundIdx = simplePlayer.findRoundIndexForBeltThreshold(beltStartSeed)
                      if (beltStartRoundIdx > 0) {
                        const priorRound = simpleRounds[beltStartRoundIdx - 1]
                        if (priorRound?.legoId) {
                          console.log(`[ResumeTTL] ${Math.round(daysSince)}d gap → belt regression to ${BELTS[beltIdx].name} (seed ${beltStartSeed}, lego ${priorRound.legoId})`)
                          resumeLegoId = priorRound.legoId
                          resumeCycle = 0
                          if (!isGuestLearner.value && progressStore?.value) {
                            activeProgressStore.value.setEnrollmentCursor(
                              learnerId.value, courseCode.value,
                              priorRound.legoId, beltStartRoundIdx - 1,
                            ).catch((err: unknown) => {
                              console.warn('[ResumeTTL] setEnrollmentCursor failed:', err)
                            })
                          }
                        }
                      }
                    }
                  } else if (minutesSince >= ttl.cycleResetMinutes) {
                    console.log(`[ResumeTTL] ${Math.round(minutesSince)}m gap → cycle reset (round restart)`)
                    resumeCycle = 0
                  }
                } else if (resumeCycle > 0) {
                  // FAIL CLOSED (Aran 2026-06-11: 23h gap resumed onto a
                  // round-tail USE monster): no saved timestamp means we
                  // cannot prove the pause was brief — never honour a
                  // mid-round cycle on faith. Restart the round.
                  console.log('[ResumeTTL] no last-practiced timestamp → cycle reset (round restart)')
                  resumeCycle = 0
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
        // SWR: serve even a stale-stamped entry; revalidate in background.
        sessionScriptVintage = cachedScript.contentStamp ?? null
        coldScriptPath = getScriptStaleness(courseCode.value) ? 'swr' : 'cache'
        scheduleSwrRevalidation()
        cachedRounds.value = cachedScript.rounds
        // Single-source the boundary on the cached audio-aware count when present
        // (undefined on pre-field caches → matview fallback, as before).
        if (typeof cachedScript.mainLoopRoundCount === 'number' && cachedScript.mainLoopRoundCount > 0) {
          liveMainLoopRoundCount.value = cachedScript.mainLoopRoundCount
        }

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
                // Pre-engine resume intent (M3): the engine doesn't exist on
                // this legacy path, so the intent refs carry the position.
                preEngineRoundIndex.value = resumeRoundIndex
                preEngineItemInRound.value = localPosition.itemInRound ?? 0
                // Clamp item index to valid range
                const maxItem = cachedScript.rounds[resumeRoundIndex]?.items?.length ?? 1
                if (preEngineItemInRound.value >= maxItem) {
                  preEngineItemInRound.value = 0
                }

                // Also set currentPlayableItem so splash screen shows correct text
                const resumeScriptItem = cachedScript.rounds[resumeRoundIndex]?.items?.[preEngineItemInRound.value]
                if (resumeScriptItem) {
                  const playable = await scriptItemToPlayableItem(resumeScriptItem)
                  if (playable) {
                    currentPlayableItem.value = playable
                  }
                }

                console.log('[LearningPlayer] Resumed at LEGO', localPosition.legoId, '→ round', resumeRoundIndex, 'item', preEngineItemInRound.value)
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
                  // Position, not completion: last_completed_round_index names the
                  // round the playhead was ON, so resume lands there directly. The
                  // old "+1" treated it as "last finished" and skipped a round —
                  // the bug this rarely-fired backup path used to hide. Now matches
                  // the main instant-playback resume. Cycle isn't restored here
                  // (lands at the round's start), which is the same as a gap-rule
                  // round-restart and correct for any real return.
                  const resumeIndex = savedProgress.lastCompletedRoundIndex
                  if (resumeIndex < cachedScript.rounds.length) {
                    preEngineRoundIndex.value = resumeIndex
                    preEngineItemInRound.value = 0 // round start; per-cycle precision is the main path's job

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
                    preEngineRoundIndex.value = 0
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
              preEngineRoundIndex.value = 0
              preEngineItemInRound.value = 0

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
              preEngineRoundIndex.value = 0
              preEngineItemInRound.value = 0
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

        // (VAD re-arm for previously-consented learners is handled
        // unconditionally at mount, right after loadAdaptationConsent() —
        // it used to live only here, which the instant-playback path never
        // reaches.)

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

          // Use real generateLearningScript + toSimpleRounds for legacy fallback.
          // Blocking full walk before play — honest state + telemetry tag.
          coldScriptPath = 'full'
          sessionScriptVintage = undefined
          beginBlockingRegenNotice()
          const endSeed = startOffset + INITIAL_ROUNDS
          let result
          try {
            result = await generateScript()
          } finally {
            endBlockingRegenNotice()
          }
          const simpleRounds = toSimpleRoundsWithComponents(result.items)

          if (simpleRounds.length > 0) {
            console.log('[LearningPlayer] Legacy fallback: generated', simpleRounds.length, 'rounds')
            if (result.mainLoopRoundCount > 0) liveMainLoopRoundCount.value = result.mainLoopRoundCount
            cachedRounds.value = simpleRounds as any

            // Restore position
            if (savedPosition?.legoId) {
              const resumeRoundIndex = simpleRounds.findIndex(r => r.legoId === savedPosition.legoId)
              if (resumeRoundIndex >= 0) {
                preEngineRoundIndex.value = resumeRoundIndex
                preEngineItemInRound.value = savedPosition.itemInRound ?? 0
                const maxItem = simpleRounds[resumeRoundIndex]?.cycles?.length ?? 1
                if (preEngineItemInRound.value >= maxItem) {
                  preEngineItemInRound.value = 0
                }
                console.log('[LearningPlayer] Resumed at LEGO', savedPosition.legoId, '→ round', resumeRoundIndex)
              } else {
                preEngineRoundIndex.value = 0
                preEngineItemInRound.value = 0
              }
            } else {
              preEngineRoundIndex.value = 0
              preEngineItemInRound.value = 0
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
    if (skipCinematic) {
      // Return users + course switches: skip cinematic timeline, go straight to preparing
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
  // Warm the first known audio into the SW cache, but DO NOT await it — blocking
  // 'ready' on this fetch cost ~600ms on cold-cache loads (measured). Fire it in
  // the background and go ready immediately; if the learner taps play before it's
  // warm, the head-miss path streams the first clip. warmAudioMs now reads ~0
  // (confirms it's off the critical path) — the cold-start budget drops by it.
  const warmT0 = (typeof performance !== 'undefined' ? performance.now() : 0)
  const firstClipWarm = warmFirstKnownAudio(FIRST_CLIP_WARM_TIMEOUT_MS)
  const warmAudioMs = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - warmT0)
  await goLoadingStageReady()
  // RIGHT OF WAY FOR THE FIRST CLIP (Tom, 2026-08-08: "the whole point for a
  // learner is speed to usability").
  //
  // The ready-gated background work — the whole-course script walk (a dozen
  // paginated 1000-row queries), the contribution fetch, tier-3 — used to be
  // released HERE, at the ready flip, on the reading that "the critical path"
  // ended when the button lit up. Measured cold on Fast 3G, that reading is
  // wrong: the learner taps the instant it lights up, and the one 68 KB clip
  // they are waiting to hear then shares the link with the entire course walk.
  // The clip took ~6 s to arrive when it needs ~0.4 s on its own.
  //
  // The critical path ends at the first SOUND, not at the first paint. So the
  // background work now waits on the same warm-up the play button waits on.
  // warmFirstKnownAudio is self-bounded (2 s race), so this can delay the
  // background work by at most that — and on a fast connection by ~0.
  void firstClipWarm
    .catch(() => { /* a failed warm-up must never strand the learner */ })
    .then(() => {
      isFirstClipReady.value = true
      resolvePlayerReady?.()
    })

  // A background revalidation completed on a previous open → show the small
  // transient "Your course was updated" notice (invisible maintenance made
  // visible, founder ruling 2026-07-27).
  maybeShowCourseUpdatedNotice()

  // Cold-start budget instrumentation. performance.now() is measured from
  // navigation start, so it captures the FULL launch→ready cost (JS bundle
  // parse + auth/session restore + onMounted), while Date.now()-startTime
  // isolates just the onMounted portion. animFloor is the deliberate splash
  // minimum (returnUser 300ms / first-visit 2800ms) — when total ≈ animFloor
  // the floor is the gate, not data. Compare against '[LearningPlayer] Data
  // loading complete' above to see whether data or the floor dominated.
  const coldTotalMs = Math.round(typeof performance !== 'undefined' ? performance.now() : 0)
  const coldOnMountedMs = Date.now() - startTime
  // Course switch is an in-app REMOUNT, not a document load: performance.now()
  // (coldTotalMs) is relative to the ORIGINAL navigation and the boot marks are
  // written once in main.js, so the nav-relative numbers are only meaningful on
  // a genuine fresh document load. Detect it: the player's onMounted starts
  // shortly after app.mount() on a fresh load, but much later on a switch
  // (= time the learner spent on the previous course). mountToReadyMs is the
  // always-valid per-mount cost (the real switch cost; floor-bound on a reload).
  // isFreshLoad + bootMarks are computed ONCE at mount entry (top of this
  // hook) — the same value also picks the splash floor, so floor and
  // telemetry can never disagree about what kind of mount this was.
  const boot = bootMarks
  console.log('[ColdStart]', isFreshLoad ? 'launch→ready' : 'switch→ready',
    isFreshLoad ? coldTotalMs : coldOnMountedMs, 'ms |',
    coldOnMountedMs, 'ms in onMounted | animFloor', MINIMUM_ANIMATION_MS, 'ms | fresh', isFreshLoad, '| returnUser', isReturnUser)
  // Emit to telemetry so cold starts are measurable in player_events (there is
  // otherwise NO event before tap_play). Cookie-based so guests are included;
  // the unmount/visibility beacon flushes it even on load-then-switch.
  logEvent('cold_start', {
    isFreshLoad,                                       // true = genuine document load; false = in-app course switch (remount)
    mountToReadyMs: coldOnMountedMs,                   // ALWAYS valid: this mount's onMounted→ready (real per-load/switch cost)
    totalMs: isFreshLoad ? coldTotalMs : null,         // nav→ready — only meaningful on a fresh load
    mainExecMs: isFreshLoad ? (boot.mainExecMs ?? null) : null,   // nav → main bundle evaluated
    mountedMs: isFreshLoad ? (boot.mountedMs ?? null) : null,     // nav → app.mount() done
    animFloorMs: MINIMUM_ANIMATION_MS,                 // deliberate splash floor (300 return / 2800 first-visit)
    warmAudioMs,                                        // time awaited on warmFirstKnownAudio (cold-audio cost; ~0 once prewarm-precached)
    scriptPath: coldScriptPath,                        // which path produced the rounds: cache | swr | progressive | infplay_cache | full (null = never resolved)
    returnUser: isReturnUser,
    guest: isGuestLearner.value,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null,
  })

  // Prewarm the now-lazy overlay/modal chunks on idle — AFTER ready, off the
  // cold-start path — so entering Listening / Pronunciation mode or opening a
  // modal mid-session has no chunk-fetch hitch. ListeningOverlay fires
  // automatically ~5 min in, so it especially must be warm by then.
  {
    const idle = (typeof window !== 'undefined' && (window as any).requestIdleCallback)
      ? (window as any).requestIdleCallback.bind(window)
      : (cb: () => void) => setTimeout(cb, 1)
    idle(() => {
      void import('./ListeningOverlay.vue').catch(() => {})
      void import('./PronunciationOverlay.vue').catch(() => {})
      void import('./ProgressModal.vue').catch(() => {})
      void import('./SessionComplete.vue').catch(() => {})
    })
  }

  // Preview mode: set position at startup (but defer network population to first play)
  nextTick(async () => {
    if (props.previewLegoIndex > 0) {
      // Preview mode: expand script if needed, then set position
      let targetIndex = props.previewLegoIndex
      const absoluteEnd = scriptBaseOffset.value + cachedRounds.value.length

      // Expand script if preview index exceeds cached rounds
      if (targetIndex >= absoluteEnd && supabase?.value) {
        console.log(`[LearningPlayer] Preview ${targetIndex} exceeds cached ${absoluteEnd}, expanding...`)
        const expandResult = await generateScript()
        const expandedRounds = toSimpleRoundsWithComponents(expandResult.items)
        if (expandedRounds.length > cachedRounds.value.length) {
          cachedRounds.value = expandedRounds as any
          console.log(`[LearningPlayer] Expanded to ${cachedRounds.value.length} rounds for preview`)
        }
      }

      // Cap to actual available rounds
      targetIndex = Math.min(targetIndex, cachedRounds.value.length - 1)

      // Set playback position so hitting play continues from here. If the
      // engine already exists, the position intent goes THROUGH it (jumpToRound
      // is the one sanctioned post-init position writer); otherwise it's the
      // pre-engine intent the derived position reads until init.
      if (simplePlayer.isInitialized.value) {
        simplePlayer.jumpToRound(targetIndex, 0)
      } else {
        preEngineRoundIndex.value = targetIndex
        preEngineItemInRound.value = 0
      }

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
  // Restore (or reset) the SITTING first, per the 5-min resume window.
  restoreSitting()
  sessionTimerInterval = setInterval(() => {
    // Tick while anything is audible — same derived signal as the transport
    // (minus the pre-audio preparing window, which shouldn't count as
    // practice time). See isAnythingAudible (M8).
    if (isAnythingAudible.value) {
      sessionSeconds.value++
      if (sessionSeconds.value % 5 === 0) saveSitting() // backstop for hard kills
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
    // Not auto-starting: the derived isPlaying already reads false.
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
  // Flush any batched co-fire telemetry before teardown (route change etc.).
  void pairingsTelemetry.flush()
  // DB-01: persist any pending mid-round cursor before teardown.
  flushCursor()

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
  saveSitting() // persist the sitting so a reopen within the window resumes it
  if (sessionTimerInterval) clearInterval(sessionTimerInterval)
  if (vadStatusInterval) clearInterval(vadStatusInterval)
  stopLoadingTypewriter() // also retires any in-flight fast-finish generation

  // Flush any pending per-LEGO metrics, remove pagehide listener
  adaptationEngine.value?.dispose()
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

  // 2. Reset all state (pre-engine intent back to 0 for the new course; the
  // new course's init path re-seeds the engine, and the 'awakening' loading
  // stage covers the swap window)
  preEngineRoundIndex.value = 0
  preEngineItemInRound.value = 0
  cachedRounds.value = []
  // Drop the previous course's LIVE boundary — it's a bare number with no
  // course stamp, so a leftover value would mis-bound the new course until its
  // own handoff runs. Also drop the matview map so the boundary falls back to
  // the new course's matview/final-LEGO, not the old course's.
  liveMainLoopRoundCount.value = null
  mainLoopMap.value = null
  cachedCourseWelcome.value = null
  // completedRounds is computed from beltProgress, which is managed separately
  totalSeedsPlayed.value = 0
  restoreSitting() // sitting for the NEW course: continue if returned within the window, else 0:00
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
  const cachedScript = await getCachedScript(newCourseCode)

  if (cachedScript) {
    console.log('[LearningPlayer] Found cached script for new course:', cachedScript.rounds.length, 'rounds')
    // SWR: a stale-stamped entry still serves this session; background
    // revalidation writes the fresh script for next time.
    sessionScriptVintage = cachedScript.contentStamp ?? null
    scheduleSwrRevalidation()
    cachedRounds.value = cachedScript.rounds
    // Single-source the new course's boundary on its cached audio-aware count
    // when present (undefined on pre-field caches → matview fallback).
    if (typeof cachedScript.mainLoopRoundCount === 'number' && cachedScript.mainLoopRoundCount > 0) {
      liveMainLoopRoundCount.value = cachedScript.mainLoopRoundCount
    }

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

  // Generate rounds if no cache - prefer eager preload. Blocking full walk
  // before play — honest "Updating your course…" state while it runs.
  if (cachedRounds.value.length === 0 && supabase?.value) {
    let freshResult
    beginBlockingRegenNotice()
    try {
      if (eagerScript?.scriptPromise?.value && eagerScript.courseCode.value === newCourseCode) {
        console.log('[LearningPlayer] Awaiting eager preload for course switch:', newCourseCode)
        freshResult = await eagerScript.scriptPromise.value
      } else {
        console.log('[LearningPlayer] No eager preload, generating full script for', newCourseCode)
        freshResult = await generateSimpleScript(
          supabase.value, newCourseCode, 50,
          listeningConfig.value,
          scriptShapeForMode(learningMode.value),
          1, // mode-neutral walk — see runGenerateScript
          // Twin of the wrapper above — the walk is mode-neutral on both paths.
          MODE_NEUTRAL_WALK_OPTIONS,
        )
      }
    } finally {
      endBlockingRegenNotice()
    }
    if (freshResult.mainLoopRoundCount > 0) liveMainLoopRoundCount.value = freshResult.mainLoopRoundCount
    const freshRounds = toSimpleRoundsWithComponents(freshResult.items)
    cachedRounds.value = freshRounds as any
    sessionScriptVintage = undefined // fresh walk → live vintage
  }

  // Initialize for new course - legacy initOrchestrator removed
  // The SessionController path handles this automatically

  // Go ready immediately; warm the first known audio in the BACKGROUND (not
  // awaited — blocking ready on it added ~600ms). Head-miss streams the first
  // clip if the learner taps before it's warm. The play button stays flashing
  // until the clip lands, same per-control honesty as the cold boot above.
  isFirstClipReady.value = false
  void warmFirstKnownAudio()
    .catch(() => { /* never strand the learner on a failed warm-up */ })
    .then(() => { isFirstClipReady.value = true })
  await goLoadingStageReady()
  isInitialized.value = true
  maybeShowCourseUpdatedNotice()

  previousCourseCode = newCourseCode
  console.log('[LearningPlayer] Course change complete, ready to play')
}, { immediate: false })

// Expose methods for parent component (PlayerContainer) to control playback
const togglePlayback = () => {
  // Ready-guard (re-landed from the reverted bf281cd1): a tap while the
  // player is still awakening used to run handleResume CONCURRENTLY with
  // onMounted's round-building/engine init — playback started
  // half-initialised (Tom's 2026-06-08 repro: audio the pause button
  // couldn't stop). Soft form: only swallow the tap when nothing is
  // audible — if audio IS sounding, always let the tap through to stop it.
  if (isAwakening.value && !isAudioPlaying.value) return
  // Welcome / introduction / preparing window: the button reads "stop"
  // (per isAudioPlaying) — a tap must PAUSE (handlePause skips the
  // welcome/intro and raises firstPlayPauseRequested for any in-flight
  // first-play await), never fall through to a second handleResume.
  if (isPlayingWelcome.value || isPlayingIntroduction.value || isPreparingToPlay.value) {
    handlePause()
    return
  }
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
  // The transport-facing signal (cycle OR welcome/intro/pod/commentary OR
  // preparing) — PlayerContainer PULLS this for the play/stop button and
  // the resting overlay instead of mirroring an event edge.
  isAudioPlaying,
  isAwakening,
  // Per-control readiness: the play affordance waits on the first clip's bytes,
  // not just on the lesson existing. PlayerContainer ANDs it with isAwakening.
  isFirstClipReady,
  togglePlayback,
  handlePause,
  handleResume,
  handleRevisit,
  handleSkip,
  handleRoundForward,
  handleRoundBack,
  listeningStep,
  isInListeningCycle,
  // Mode overlay truth (M5) — container/BottomNav pull these, no event hop.
  isListeningMode,
  isPronunciationMode,
  exitListeningMode,
  exitAllModes,
  unlockAudio,
  handleListeningMode,
  handleListeningToggle,
  handlePronunciationToggle,
  exitPronunciationMode,
  beltCssVars,
  hasRomanizedText,
  isNativeScript,
  toggleScriptMode,
  toggleLearningMode,
  setLearningMode,
  learningMode,
  isEasyMode,
  toggleOffline,
  offlineActive,
  sessionSeconds,
  // Persist the in-flight telemetry deltas without stopping playback, so a
  // surface that is about to READ them (the Library's activity tiles) can
  // await the write first — the same trick handleBeltPillTap uses for the
  // progress modal.
  flushTelemetryDelta: learningSession.flushTelemetryDelta,
})
</script>

<template>
  <!-- Single root wrapper - required for v-show from parent to work correctly -->
  <div class="learning-player-root" :class="{ 'has-blocking-overlay': showPaywall || (offlineLeaseLocked && !isOnline) }">

  <!-- Offline download progress is shown as a ring on the mode button + the
       Offline row in ModeTray (where offline was switched on), not a banner. -->

  <!-- Offline depth picker — "take it with you". Choose how much of the course
       to carry; each option shows a live size estimate. -->
  <Teleport to="body">
    <Transition name="offline-picker">
      <div v-if="showOfflinePicker" class="offline-picker-backdrop" @click.self="cancelOfflinePicker">
        <div class="offline-picker" role="dialog" aria-label="Take it offline">
          <div class="offline-picker-head">
            <h3 class="offline-picker-title">Take it offline</h3>
            <button class="offline-picker-close" aria-label="Close" @click="cancelOfflinePicker">✕</button>
          </div>
          <p class="offline-picker-sub">{{ offlineSingleOption ? 'Take the whole thing with you for endless offline play.' : (offlineAtTail ? 'How much of the course do you want to keep offline?' : "How much of what's left do you want to carry?") }}</p>

          <!-- INF PLAY (or at-tail / guest-at-tail): a single download. INF PLAY
               only recycles USE phrases, so we cache USE audio only (the longest
               3 per LEGO) + pods/encouragements — small, and it plays forever. -->
          <div v-if="offlineSingleOption" class="offline-single">
            <p class="offline-depth-size">
              <span class="offline-depth-size-mb">{{ offlineSingleEstimate.size || 'Working out size…' }}</span>
              <span v-if="offlineSingleEstimate.lowSpace" class="offline-depth-size-low"> · running low on space</span>
            </p>
            <p class="offline-single-caption">Caches the course's key phrases so it plays on endless repeat with no signal.</p>
            <button class="offline-depth-download" @click="startOfflineDownloadInfPlay">Download for unlimited offline</button>
          </div>

          <div v-else class="offline-depth">
            <!-- Notched slider — fraction of the REMAINING course -->
            <input
              type="range"
              class="offline-depth-slider"
              min="0"
              :max="OFFLINE_NOTCHES.length - 1"
              step="1"
              v-model.number="offlineNotchIndex"
              :aria-valuetext="offlineSelectedLabel"
              aria-label="How much of the remaining course to download"
            />
            <!-- Tick labels stay tappable for mouse/touch, but the slider above is
                 the single canonical control: aria-hidden + tabindex -1 keeps them
                 out of the keyboard/SR traversal so the value isn't announced twice. -->
            <div class="offline-depth-ticks" aria-hidden="true">
              <button
                v-for="(n, i) in OFFLINE_NOTCHES"
                :key="i"
                type="button"
                tabindex="-1"
                class="offline-depth-tick"
                :class="{ active: i === offlineNotchIndex }"
                @click="offlineNotchIndex = i"
              >{{ Math.round(n * 100) }}%</button>
            </div>

            <!-- Live cost readout for the selected notch -->
            <p class="offline-depth-size">
              <span class="offline-depth-size-mb">{{ offlineSelectedEstimate.size || 'Working out size…' }}</span>
              <span v-if="offlineSelectedEstimate.lowSpace" class="offline-depth-size-low"> · running low on space</span>
            </p>

            <!-- Course-depth bar: mid-course = where you are + the new chunk you'd
                 carry; finished/INF-PLAY = how much of the course you're keeping. -->
            <div
              class="offline-depth-bar"
              role="img"
              :aria-label="offlineCourseBar.finished
                ? (offlineSelectedFraction >= 1 ? 'Keeps the whole course offline' : `Keeps about ${Math.round(offlineCourseBar.newPct)} percent of the course offline`)
                : (offlineSelectedFraction >= 1 ? 'Carries everything left to learn' : `Carries you about ${Math.round(offlineCourseBar.newPct)} percent further through the course`)"
            >
              <div class="offline-depth-bar-done" :style="{ width: offlineCourseBar.donePct + '%' }"></div>
              <div class="offline-depth-bar-new" :style="{ left: offlineCourseBar.donePct + '%', width: offlineCourseBar.newPct + '%' }"></div>
            </div>
            <p class="offline-depth-caption">
              {{ offlineCourseBar.finished
                ? (offlineSelectedFraction >= 1 ? 'The whole course, kept offline' : `~${Math.round(offlineCourseBar.newPct)}% of the course, kept offline`)
                : (offlineSelectedFraction >= 1 ? 'Everything left to learn' : `New learning — carries you ~${Math.round(offlineCourseBar.newPct)}% further`) }}
            </p>
            <!-- Behind-position content is always in the bundle — the slider only
                 chooses how much NEW learning rides along. -->
            <p v-if="!offlineCourseBar.finished && offlineCourseBar.donePct > 0" class="offline-depth-caption">
              Plus everything up to where you are — included automatically
            </p>

            <button class="offline-depth-download" @click="startOfflineDownload">Download</button>
          </div>

          <p class="offline-picker-note">Plays offline forever once downloaded — it keeps going on repeat with no signal.</p>
        </div>
      </div>
    </Transition>
  </Teleport>

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
    <!-- belt-skip no longer raises this full-screen scrim — it flashed on every
         belt-pill/chevron jump even when instant from cache. The player never
         remounts (v-show), and the belt colour + dialog update reactively, so a
         belt-skip is now an in-place recolour + dialog swap. Overlay kept only
         for the real blocking wait: INF-PLAY first-batch warmup. (Mirrors the
         isSteppingRound suppression from 5d4177e1, extended to belt skips.) -->
    <div v-if="isWarmingUpInfPlay && !isShowingInfPlayIntro && !isSteppingRound" class="belt-skip-overlay">
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
    :session-seconds="sessionSeconds"
    :is-guest="isGuestLearner"
    :known-lang="props.course?.known_lang"
    :current-belt="playingBelt"
    :is-skipping="isSkippingBelt"
    :available-belts="beltProgress?.availableBelts?.value ?? []"
    :current-round="currentAbsoluteRound"
    :highest-round="highestAbsoluteRound"
    :current-belt-index="cursorBeltIndex"
    :highest-belt-index="highestBeltIndex"
    :is-infplay="isInfPlayActive"
    :is-offline="offlinePlaybackActive()"
    :offline-unavailable-belt-names="offlineUnavailableBeltNames"
    @close="showProgressModal = false"
    @skipToBelt="handleSkipToBelt"
    @enterInfPlay="handleActivateInfPlay"
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
    <div v-if="showPaywall" class="paywall-overlay" @click.self="dismissPaywall">
      <div class="paywall-card">
        <h2 class="paywall-title">You've reached the end of the free preview</h2>
        <p class="paywall-subtitle">Go Premium — £15/month. Cancel anytime.</p>
        <ul class="paywall-benefits">
          <li>Every course in 65+ languages, fully unlocked</li>
          <li>Download courses for offline learning</li>
          <li>New languages and courses added all the time</li>
        </ul>
        <div class="paywall-actions">
          <button
            class="paywall-btn paywall-btn-primary"
            :disabled="isOpeningCheckout"
            @click="handleSubscribe"
          >{{ isOpeningCheckout ? 'Opening checkout…' : 'Subscribe — £15/month' }}</button>
          <!-- Access codes are entered in Settings during normal play, not here. -->
          <button class="paywall-btn paywall-btn-ghost" @click="dismissPaywall">Maybe later</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- Offline-lease lock overlay. Shown only when the lease has expired AND we
       can't reach the network to renew (genuinely offline). The bytes are still
       on disk — one reconnect re-validates and unlocks. Reuses the paywall shell. -->
  <Transition name="fade">
    <div v-if="offlineLeaseLocked && !isOnline" class="paywall-overlay">
      <div class="paywall-card">
        <h2 class="paywall-title">{{ offlineTrial ? 'Free offline trial ended' : 'Offline access paused' }}</h2>
        <p class="paywall-subtitle">
          <template v-if="offlineTrial">
            Your 30-day free offline trial has ended. Your downloads are still
            saved — reconnect and subscribe (£15/month) to keep playing them
            offline. You can always learn online for free.
          </template>
          <template v-else>
            Your downloads need a quick online check to keep playing.
            Connect to the internet and they'll unlock straight away — nothing is lost.
          </template>
          <template v-if="offlineLeaseExpiryLabel"><br />Offline access lapsed on {{ offlineLeaseExpiryLabel }}.</template>
        </p>
        <div class="paywall-actions">
          <button
            class="paywall-btn paywall-btn-primary"
            @click="void offlineLease.renewLeases().then(() => checkOfflineLease())"
          >Try to reconnect</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- Offline infinite-play notice. Tom 2026-08-15: "we need a message to let
       the learner know". Fires once per session at the moment cached content
       starts being recycled, and NEVER pauses audio — playback carries on
       underneath, which is the whole point of "play what you have". Reuses the
       paywall shell (centred modal, so no safe-area inset needed). -->
  <Transition name="fade">
    <div
      v-if="offlineInfPlayNoticeVisible"
      class="paywall-overlay"
      role="dialog"
      aria-modal="false"
      :aria-label="t('player.offlinePracticeBody', 'We can\'t reach new items right now, so here\'s a chance to practise what you\'ve already covered — new items will come through as soon as we can reach them.')"
      @click.self="dismissOfflineInfPlayNotice"
    >
      <div class="paywall-card">
        <!-- No heading: Tom's ruling is the message and nothing more. Inventing
             a title would be the app being cleverer than the copy it was given. -->
        <p class="paywall-subtitle">
          {{ t('player.offlinePracticeBody', 'We can\'t reach new items right now, so here\'s a chance to practise what you\'ve already covered — new items will come through as soon as we can reach them.') }}
        </p>
        <div class="paywall-actions">
          <button class="paywall-btn paywall-btn-primary" @click="dismissOfflineInfPlayNotice">
            {{ t('player.offlinePracticeAck', 'Got it') }}<!-- acknowledge, never a gate -->
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
    :class="[`belt-${playingBelt.name}`, { 'is-paused': !isAudioPlaying }]"
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
      :known-lang="props.course?.known_lang || courseCode?.split('_for_')[1]"
      :cycle-type="simplePlayer.currentCycle.value?.type"
      :show-romanization="showRomanization"
    />

    <!-- Listening Pod moment (Layer 2, HISE-interleaved): the whole dialogue
         scrolling Spotify/karaoke-style (2026-07-22, product owner decision
         — replaces the 2026-07-14 LEGO-tile whole-turn ladder), the sounding
         sentence at full prominence. Always visible for the duration of the
         pod lap — no VOICE_2 reveal-gating (that rule governs the SPEAKING
         cycle above, not pod listening). -->
    <PodTurnDisplay
      v-if="playingPodLapAudio && currentPodTurn"
      :sentences="podScrollSentences"
      :active-index="currentPodTurn.activeIndex"
      :target-lang="courseTargetLang"
      :known-lang="courseKnownLang"
    />

    <!-- ?podview=1 instant preview nav — jump to a different pod sentence
         without waiting for the current lap to finish. Cancels the in-flight
         lap (podPreviewNext/Prev) and composes the neighbour via
         nextLapPreviewFallback. Dev/staging-only, same gate as the cheat. -->
    <div v-if="podPreviewMode" class="pod-preview-nav" role="group" aria-label="Pod preview navigation">
      <button type="button" class="pod-preview-nav__btn" @click.stop="podPreviewPrev" aria-label="Previous pod sentence">‹ Prev</button>
      <button type="button" class="pod-preview-nav__btn" @click.stop="podPreviewNext" aria-label="Next pod sentence">Next ›</button>
    </div>

    <!-- Ambient listening cue — a small headphones mark in the top safe-area
         band PodTurnDisplay always keeps clear. NOT an instruction surface:
         the exercise goes straight in with the audio's own spoken "now just
         listen for a while", and the screen stays free for the displayed text
         (Tom, 2026-08-06, after Aran found the intro popup distracting). The
         one-shot "just listen, like birdsong" transient that used to open a
         lap is gone; its guidance lives in Settings → Tools → Listening mode
         and in the phase hint outside pod laps. -->
    <div v-if="playingPodLapAudio" class="pod-listening-ambient" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M12 3a7 7 0 0 0-7 7v5a2 2 0 0 0 2 2h1v-6H6v-1a6 6 0 0 1 12 0v1h-2v6h1a2 2 0 0 0 2-2v-5a7 7 0 0 0-7-7z"/>
      </svg>
    </div>

    <!-- Hero-Centric Text Labels - Floating above/below the hero node.
         Hidden for the WHOLE of any listening lap (L2 pod or L1 cup — both
         run through playPodLap): during a lap the only permitted surfaces
         are PodTurnDisplay's teleprompter and the textless ambient mark
         (2026-07-23, product owner report: the empty glass card rendered as
         a bare white pill on top of the old reminder banner, and the
         birdsong pedagogy line showed as a THIRD stacked surface during the
         intro bookend — that banner is now gone). Layer-1 cups are
         audio-only by product rule, so they lose nothing either. v-show, not
         v-if — the ResizeObserver above binds to this element once at mount
         and must survive the lap. -->
    <div v-show="!playingPodLapAudio" ref="heroTextPaneRef" class="hero-text-pane" :class="[currentPhase, { 'is-intro': isIntroPhase }]">

      <!-- Main Text Box (with integrated hint) -->
      <div class="hero-glass" :class="{ 'is-speaking': currentPhase === 'speak' && showLearningHint && !isIntroPhase, 'is-interjection': showInterjection }">
        <!-- Inline learning hint label. Never shows during a pod lap — the
             whole hero pane is hidden while playingPodLapAudio, and a lap
             carries no on-screen instruction at all (2026-08-06). -->
        <div v-if="showLearningHint && !isIntroPhase && !showInterjection" class="hero-hint-label">
          <span class="hint-text">{{ phaseInstruction }}</span>
          <button class="hint-dismiss" @click.stop="dismissLearningHint" title="Hide hints">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- INTERJECTION MODE: between-rounds encouragement / instruction.
             The display follows the AUDIO — never the next LEGO (which the
             engine has queued but not started). Encouragement → wordless
             rotating strength/learning icon; instruction → a short sciencey
             caption. -->
        <template v-if="showInterjection">
          <!-- "Your guide is speaking": one model for all interjections, since
               both instruction and encouragement are Aran's voice. A synthetic
               (NOT audio-reactive — that'd tap the element and risk lock) wave
               that reads as live voice. Instructions also keep their short
               caption; encouragements are wave-only. -->
          <div class="interjection-display" :class="`is-${currentCommentaryType}`">
            <div class="interjection-wave" aria-label="Your guide is speaking" role="img">
              <span class="wbar"></span><span class="wbar"></span><span class="wbar"></span><span class="wbar"></span><span class="wbar"></span>
            </div>
            <div v-if="currentCommentaryType === 'instruction'" class="interjection-caption">{{ currentInstructionCaption }}</div>
          </div>
        </template>

        <!-- INTRO MODE: Typewriter-style encouraging message -->
        <template v-else-if="isIntroPhase && !isAwakening">
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
              <!-- Main-cycle listening types only (listen_intro / listening /
                   listen_outro cycles) — pod/L1 laps never reach here, the
                   whole hero-text-pane is hidden while playingPodLapAudio. -->
              <p v-else-if="inListeningContext" class="hero-known listening-pedagogy">
                {{ passiveListeningHint }}
              </p>
              <p v-else class="hero-known" :lang="courseKnownLang">{{ displayedKnownText }}</p>
            </div>
          </div>
        </template>

      </div>

      <!-- Phase strip — a single pill divided into four segments. One
           continuous shape reads as "one cycle, four stages". Sits below
           the hero glass card. pointer-events: auto overrides the
           .hero-text-pane parent's pointer-events: none. -->
      <div v-if="showPhaseStrip" class="phase-row">
        <button
          type="button"
          class="belt-header-skip phase-cycle-skip"
          @click="handleRevisit"
          title="Previous cycle"
          aria-label="Previous cycle"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div class="phase-strip" role="group" aria-label="Cycle phases">
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
        <button
          type="button"
          class="phase-segment phase-segment--pause"
          :class="{ 'is-active': currentPhase === Phase.SPEAK }"
          aria-label="Back to your turn to speak"
          @click="jumpToCyclePhase('pause')"
        >
          <!-- span, not div: a button's content model is phrasing content, and
               the fill is absolutely positioned so display makes no difference. -->
          <span class="phase-segment-fill" :style="{ width: ringProgress + '%' }"></span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <rect x="9" y="3" width="6" height="12" rx="3"/>
            <path d="M5 11v1a7 7 0 0 0 14 0v-1"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="8" y1="22" x2="16" y2="22"/>
          </svg>
        </button>
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
        <button
          type="button"
          class="belt-header-skip phase-cycle-skip"
          @click="handleSkip"
          title="Next cycle"
          aria-label="Next cycle"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
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
          <span class="tooltip-target" :lang="courseTargetLang">{{ hoveredNode.targetText }}</span>
          <span class="tooltip-known" :lang="courseKnownLang">{{ hoveredNode.knownText }}</span>
        </div>
        <div v-if="hoveredNodePhrases.length > 0" class="tooltip-phrases">
          <div
            v-for="(phrase, i) in hoveredNodePhrases"
            :key="i"
            class="tooltip-phrase"
            @click.stop="playHoverPhrase(phrase)"
          >
            <span class="phrase-target" :lang="courseTargetLang">{{ phrase.target }}</span>
            <span class="phrase-known" :lang="courseKnownLang">{{ phrase.known }}</span>
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

    <!-- Class Context Bar (when launched from Schools as a standalone player).
         Hidden when embedded in a shell (teach "Play as class"): the shell's
         own light TopNav already provides navigation, so this legacy dark bar
         would be a redundant second top bar in the wrong theme. -->
    <button v-if="props.classContext && !props.embedded" class="class-bar" @click="emit('close')">
      <svg class="class-bar-back" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      <span class="class-bar-name">{{ props.classContext.name }}</span>
      <span class="class-bar-label">Back to classes</span>
    </button>

    <!-- Header - Logo with belt underneath, centered -->
    <!-- Header - brand row + belt row -->
    <header class="header" :class="{ 'has-banner': props.classContext && !props.embedded }">
      <div class="header-stack">
        <!-- Brand -->
        <!-- The SaySomethingin wordmark is hidden ONLY when embedded in a shell
             that carries its own branding (the teach/schools "Play as class"
             nav). In the standalone learner player it's shown, and localised:
             each interface language supplies its own three-part wordmark
             (brand.say / brand.something / brand.in) so learners aren't forced
             to read an English app name. The env-label / dev-reset / PWA-update
             controls keep their home in .brand alongside it. -->
        <div v-if="!props.embedded || envLabel || showDevReset || (pwaUpdateAvailable && pwaUserDismissed)" class="brand"><template v-if="!props.embedded"><span class="logo-say">{{ t('brand.say') }}</span><span class="logo-something">{{ t('brand.something') }}</span><span class="logo-in">{{ t('brand.in') }}</span></template><span v-if="envLabel" class="env-label" :class="`env-label--${envLabel.toLowerCase()}`">{{ envLabel }}</span><button v-if="showDevReset" class="env-reset" title="Clear cache + reload the latest build (dev only)" aria-label="Reset and reload latest build" @click.stop="resetApp">↻</button><button v-if="pwaUpdateAvailable && pwaUserDismissed" class="update-dot" title="Tap to update" aria-label="New version available — tap to update" @click.stop="pwaApplyUpdate?.()"></button></div>

        <!-- Belt row: ROUND/LEGO back ‹‹ + central belt-progress pill + ROUND/LEGO forward ››
             Granularity = location. These header chevrons step the
             ROUND/LEGO axis (one introduced LEGO per tap); the bottom-nav
             ‹ › step the finer CYCLE axis. Belt JUMPS are MODAL-only (tap
             the central pill). The ∞ INF-PLAY indicator lives on the central
             pill, NOT on the forward chevron. -->
        <div class="belt-row">
          <button
            class="belt-header-skip belt-header-skip--back"
            :class="{ 'is-skipping': isSkippingBelt }"
            @click="handleSkipToPrevBelt"
            :disabled="playingBelt.index === 0 && simplePlayer.roundIndex.value === 0 && !isInfPlayActive"
            :title="isInfPlayActive ? 'Leave INF PLAY — back to your current belt' : 'Restart this belt (again for the previous belt)'"
            :aria-label="isInfPlayActive ? 'Leave infinite play, back to your current belt' : 'Restart the current belt; press again to step back to the previous belt'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">
              <polyline points="11 17 6 12 11 7"/>
              <polyline points="18 17 13 12 18 7"/>
            </svg>
          </button>

          <!-- Central belt-progress pill: belt readout + tap → belt modal,
               AND the INF-PLAY indicator. In INF PLAY (currentMode ===
               'infplay') it changes colour, THROBS, and shows an ∞ glyph
               with NO central progress line. Tapping opens the belt modal
               in all states. -->
          <button
            class="belt-timer-unified"
            :class="{ 'is-infplay': isInfPlayActive, 'is-loading': !isBeltScreenReady }"
            :disabled="!isBeltScreenReady"
            :title="isInfPlayActive
              ? `In INF PLAY (round ${infplayRoundIndex}) — tap to jump to a belt`
              : (!nextBelt
                  ? `${currentBelt.name[0].toUpperCase() + currentBelt.name.slice(1)} belt achieved! Tap to jump to a belt`
                  : `${Math.round(beltProgressPercent)}% to ${nextBelt.name} belt — tap to jump to a belt`)"
            :aria-label="isInfPlayActive
              ? `Infinite play, round ${infplayRoundIndex}. Tap to jump to a belt.`
              : (!nextBelt
                  ? `${currentBelt.name[0].toUpperCase() + currentBelt.name.slice(1)} belt achieved. Tap to jump to a belt.`
                  : `${Math.round(beltProgressPercent)} percent to ${nextBelt.name} belt. Session time ${formattedSessionTime}. Tap to jump to a belt.`)"
            @click="handleBeltPillTap"
          >
            <!-- INF PLAY: ∞ glyph, no progress line. Main loop: progress bar. -->
            <svg v-if="isInfPlayActive" class="belt-infplay-glyph"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
              <path d="M5.5 12 C5.5 9 7 7 9.5 7 C12 7 13.5 9 14.5 12 C15.5 15 17 17 18.5 17 C20 17 21.5 15 21.5 12 C21.5 9 20 7 18.5 7 C17 7 15.5 9 14.5 12 C13.5 15 12 17 9.5 17 C7 17 5.5 15 5.5 12 Z"/>
            </svg>
            <div v-else class="belt-bar-track" aria-hidden="true">
              <div class="belt-bar-fill" :style="{ width: `${beltProgressPercent}%` }"></div>
            </div>
            <span class="belt-timer-label">{{ formattedSessionTime }}</span>
          </button>

          <!-- Forward action: ROUND/LEGO advance chevron. At the FINAL LEGO
               advancing ENTERS INF PLAY (handleRoundForward delegates to
               enterInfPlay when wouldEnterInfplay). WHILE IN INF PLAY it
               ADVANCES through the revival rounds (rounds still exist in INF
               PLAY) — no longer disabled. The ∞ indicator lives on the
               central pill; round-back remains the INF-PLAY exit. -->
          <button
            class="belt-header-skip belt-header-skip--forward"
            :class="{ 'is-skipping': isSkippingBelt }"
            @click="handleSkipToNextBelt"
            :disabled="isInfPlayActive"
            :title="isInfPlayActive
              ? 'INF PLAY is the end of the course — there is no next belt'
              : (wouldEnterInfplay
                  ? 'Enter INF PLAY — random review of everything you have learned'
                  : 'Next belt')"
            :aria-label="isInfPlayActive
              ? 'Infinite play is the end of the course. There is no next belt.'
              : (wouldEnterInfplay
                  ? 'Enter INF PLAY: random review of everything you have learned'
                  : 'Next belt')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 aria-hidden="true" focusable="false">
              <polyline points="13 17 18 12 13 7"/>
              <polyline points="6 17 11 12 6 7"/>
            </svg>
          </button>
        </div>
      </div>
    </header>


    <!-- Listening Mode Overlay -->
    <Transition name="listening-overlay">
      <ListeningOverlay
        v-if="showListeningOverlay"
        ref="listeningOverlayRef"
        :course-code="activeCourseCode"
        :belt-color="currentBelt.color"
        :up-to-seed="listeningCeilingSeed"
        :learner-id="learnerId"
        :is-offline="offlinePlaybackActive()"
        :learning-mode="learningMode"
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
        :known-lang="props.course?.known_lang || courseCode?.split('_for_')[1]"
        @close="handleClosePronunciation"
      />
    </Transition>

    <!-- SPLIT-STAGE LAYOUT: Network Theater (top) + Control Pane (bottom) -->

    <!-- NETWORK THEATER - The brain visualization fills this space -->
    <section ref="networkTheaterRef" class="network-theater">
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
          <div class="debug-row"><span class="debug-label">Mode:</span> {{ isEasyMode ? 'EASY' : 'FAST' }}</div>
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
      :class="[currentPhase, `layout-${layoutMode}`, { 'is-paused': !isAudioPlaying }]"
      role="region"
      aria-label="Learning player"
    >
      <!-- Screen-reader announcer for play/pause state. VoiceOver / TalkBack
           pick up changes to this region without disturbing sighted UI. -->
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {{ isAudioPlaying ? 'Playing' : 'Paused' }}
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
          <span class="ink-word" :lang="targetLang">{{ reward.word }}</span>
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
        <!-- Hidden for the whole pod interlude (playingPodLapAudio) — this is
             the NEXT round's LEGO/phrase text, completely out of context
             while a pod lap or L1 cup is sounding (the stale "phrase pill"
             bug, Tom 2026-07-22). Sits at control-pane's z-index 15, above
             both hero-text-pane (10) and PodTurnDisplay (3), so left
             unguarded it visibly floated over the pod dialogue. -->
        <div v-if="!playingPodLapAudio" class="pane-text-known">
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
          <p v-else class="known-text">{{ displayedKnownText }}</p>
        </div>

        <!-- Guest progress warning -->
        <div v-if="isGuestLearner" class="guest-progress-nudge" :class="{ expanded: !isAudioPlaying }" @click="openAuth()">
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
        v-if="!isAudioPlaying"
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

    <!-- "Your course was updated" — transient notice after a background
         revalidation landed on a previous open (founder ruling 2026-07-27:
         invisible maintenance becomes visible care) -->
    <Transition name="tip-fade">
      <div v-if="showCourseUpdatedNotice" class="mode-tip course-updated-notice" @click="showCourseUpdatedNotice = false">
        <div class="mode-tip__body">
          <span class="mode-tip__label">Your course was updated</span>
        </div>
      </div>
    </Transition>

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

  </div>

  <!-- Mode buttons moved to BottomNav for Android viewport sync -->
  <Transition name="fade">
    <div v-if="isAudioPlaying && activeCourseCode" class="course-identity" :style="beltCssVars">
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
  margin: 0 0 1rem;
  line-height: 1.5;
}

.paywall-benefits {
  list-style: none;
  margin: 0 0 1.5rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  text-align: left;
}

.paywall-benefits li {
  position: relative;
  padding-left: 1.6rem;
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--text-primary, #2c2622);
  line-height: 1.35;
}

/* Tick marker in the belt/accent colour. */
.paywall-benefits li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.15em;
  width: 1rem;
  height: 1rem;
  background-color: var(--accent, #c23a3a);
  -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>") no-repeat center / contain;
  mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>") no-repeat center / contain;
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

.paywall-btn-primary:disabled {
  opacity: 0.65;
  cursor: progress;
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
  /* NO unconditional z-index here. This full-viewport div is a sibling of
     PlayerRestingState.vue's `.resting-state` (z-index: 50) in
     PlayerContainer.vue; with z-index 'auto' the resting state paints and
     hit-tests ABOVE this entire subtree, which is what makes its tappable
     course name (the course chooser trigger), Save Progress, etc. reachable
     while paused. A permanent z-index: 100 on this root put a transparent
     tap-shield over the whole resting UI and killed the course chooser for
     every user (prod incident 2026-07-18). */
}

/* While a blocking overlay (paywall / offline-lease lock) is showing, the
   root must outrank .resting-state's 50 — the overlay's own z-index: 3000
   only orders it INSIDE this stacking context, never against outside
   siblings, so without this the resting state silently ate every tap on the
   paywall card (the original fd382b27 bug). Elevation is scoped to exactly
   the moments a blocking overlay is up; stays well below the nav/
   course-selector/settings chrome (2000-3000). */
.learning-player-root.has-blocking-overlay {
  z-index: 100;
}

/* Offline depth picker ("take it with you") */
.offline-picker-backdrop {
  position: fixed;
  inset: 0;
  /* Above the bottom-nav / belt-skip / paywall layer (all z-index:3000) so the
     input dialog is ALWAYS reachable — even if some nav-layer surface is open,
     it can never paint over the picker. Stays below the deliberately top-most
     system prompts (PWA update, install banner). The mode tray also closes
     itself on the offline tap, so in practice the picker is the only popup. */
  z-index: 3100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.55);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}
.offline-picker {
  width: 100%;
  max-width: 340px;
  background: rgba(255, 255, 255, 0.98);
  border: 1.5px solid rgba(0, 0, 0, 0.1);
  border-radius: 18px;
  padding: 18px 18px 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  /* Never taller than the viewport. The header (title + ✕) and the note stay
     pinned; only the options list scrolls — so on a short/landscape screen every
     control, including the close button, stays reachable. Requirement: the input
     dialog must ALWAYS be accessible. */
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 48px);
}
.offline-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.offline-picker-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #2b2622;
}
.offline-picker-close {
  border: none;
  background: transparent;
  font-size: 15px;
  line-height: 1;
  color: #9a948e;
  cursor: pointer;
  padding: 4px;
  -webkit-tap-highlight-color: transparent;
}
.offline-picker-sub {
  margin: 4px 0 14px;
  font-size: 13px;
  color: #6b6560;
  flex-shrink: 0;
}
/* Offline depth — notched slider + course-depth bar (replaces the option list) */
.offline-depth {
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* Stay scrollable inside the height-capped dialog (close button + note remain
     pinned; this region scrolls if it ever overflows a short/landscape screen). */
  overflow-y: auto;
  min-height: 0;
}
.offline-depth-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 22px;             /* comfortable hit area around the 4px track */
  margin: 2px 0 0;
  background: transparent;
  cursor: pointer;
}
.offline-depth-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.14);
}
.offline-depth-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 22px;
  height: 22px;
  margin-top: -9px;         /* centre the 22px thumb on the 4px track */
  border-radius: 50%;
  background: #16a34a;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
.offline-depth-slider::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.14);
}
.offline-depth-slider::-moz-range-thumb {
  width: 22px;
  height: 22px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #16a34a;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
.offline-depth-slider:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.35); }
.offline-depth-slider:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.35); }
.offline-depth-ticks {
  display: flex;
  justify-content: space-between;
  gap: 2px;
  margin-top: -2px;
}
.offline-depth-tick {
  border: none;
  background: transparent;
  padding: 2px 4px;
  font-size: 11px;
  font-weight: 600;
  color: #9a948e;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.offline-depth-tick.active { color: #16a34a; }
.offline-depth-size {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 700;
  color: #2b2622;
  text-align: center;
}
.offline-depth-size-low { font-weight: 600; color: #c2410c; }
.offline-depth-bar {
  position: relative;
  height: 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
}
.offline-depth-bar-done {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: rgba(0, 0, 0, 0.22);   /* already learned / behind the cursor */
}
.offline-depth-bar-new {
  position: absolute;
  top: 0;
  height: 100%;
  background: #16a34a;               /* the new chunk this download carries */
  transition: left 0.15s ease, width 0.15s ease;
}
.offline-depth-caption {
  margin: 0;
  font-size: 11.5px;
  color: #9a948e;
  text-align: center;
}
/* INF PLAY single "Download for unlimited offline" — same column layout as the
   depth picker, minus the slider/bar. */
.offline-single {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.offline-single-caption {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.4;
  color: #9a948e;
  text-align: center;
}
.offline-depth-download {
  margin-top: 2px;
  width: 100%;
  padding: 13px 15px;
  border: none;
  border-radius: 12px;
  background: #16a34a;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease, transform 0.1s ease;
}
.offline-depth-download:hover { background: #15903f; }
.offline-depth-download:active { transform: scale(0.99); }
.offline-picker-note {
  margin: 14px 2px 0;
  font-size: 11.5px;
  line-height: 1.4;
  color: #9a948e;
  flex-shrink: 0;
}
.offline-picker-enter-active,
.offline-picker-leave-active { transition: opacity 0.2s ease; }
.offline-picker-enter-from,
.offline-picker-leave-to { opacity: 0; }
.offline-picker-enter-active .offline-picker,
.offline-picker-leave-active .offline-picker { transition: transform 0.2s ease; }
.offline-picker-enter-from .offline-picker,
.offline-picker-leave-to .offline-picker { transform: translateY(12px) scale(0.97); }

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

  /* ============ HERO CONSTRUCTION GRID ============
   * The whole top section is built from ONE base unit. Everything derives, so
   * the single breakpoint just swaps --u (4px mobile → 5px desktop) and the
   * proportions hold. Ratios:
   *   pill height   = 8u   (belt pill, phase pill, AND the flanking round
   *                         buttons — so each row is one clean band)
   *   pill radius   = 4u   (= height/2 → true stadium ends; buttons are
   *                         circles of the same radius → one family)
   *   row h-gap     = 2u   (round button ↔ pill)
   *   vertical rhythm = 5u (title↔belt = belt↔dialog = dialog↔phase, all equal)
   *   title slot    = 7u   (the logo's line box)
   * The painting is a full-bleed backdrop, so the stack can sit anywhere — we
   * just lay it on the grid from the top. */
  --u: 4px;
  --pill-height: calc(8 * var(--u));     /* 32px mobile / 40px desktop */
  --pill-radius: calc(4 * var(--u));     /* 16 / 20 — stadium + matching circles */
  --hero-gap: calc(5 * var(--u));        /* 20 / 25 — the one vertical rhythm */
  --title-slot: calc(7 * var(--u));      /* 28 / 35 — logo line box */

  /* ============ LAYOUT STRUCTURE ============ */
  /* Header height is now an HONEST sum of its parts (top padding + title +
   * rhythm + pill), not a hardcoded guess — so --hero-offset is the TRUE
   * belt→dialog gap. (Old --header-height: 72px under-reported the real ~87px,
   * which is why the gaps never matched their tokens.) */
  --header-height: calc(var(--space-lg) + var(--title-slot) + var(--hero-gap) + var(--pill-height));
  --header-total: calc(var(--header-height) + var(--safe-area-top));
  --nav-height: 80px;
  --nav-total: calc(var(--nav-height) + var(--safe-area-bottom));
  --control-bar-bottom: var(--nav-total);
  --hero-offset: var(--hero-gap); /* belt pill → dialog box = one rhythm unit */
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

  /* Mode buttons (listening, easy/fast) */
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
  --belt-row-gap: calc(2 * var(--u)); /* round button ↔ pill = 2u (8 / 10) */
  --belt-timer-width: 180px;
  --belt-bar-width: 60px;
  --belt-bar-height: 5px;
  /* --pill-height + --pill-radius now live in the HERO CONSTRUCTION GRID above
   * (8u tall, 4u radius). Belt pill, phase pill, and the flanking round buttons
   * all consume --pill-height so the rows are one band by construction. */

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
  padding: calc(var(--space-lg) + var(--safe-area-top)) var(--space-lg) 0; /* more island -> logo clearance (was --space-sm; looked flush to the Dynamic Island) */
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
  gap: var(--hero-gap); /* title → belt pill — one rhythm unit (5u) */
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
  /* Occupy a defined 7u band (like the pills are 8u), logo centred in it — so
     --header-height is an exact sum of grid bands, not font-metric guesswork. */
  height: var(--title-slot);
  display: flex;
  align-items: center;
  justify-content: center;
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
/* Dev/staging-only reset control, sits next to the env badge. */
.env-reset {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 7px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 999px;
  background: #f5b342;
  color: #1a1a1a;
  font-size: 0.7em;
  font-weight: 700;
  line-height: 1;
  vertical-align: middle;
  cursor: pointer;
}
.env-reset:active { transform: translateY(1px); }

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

/* Belt skip processing animation */
@keyframes belt-skip-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
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

/* Belt skip buttons — diameter LOCKED to the pill height so the round
   buttons and the pill form one uniform-height band (was 36 vs 33px pill,
   which made them bulge above/below). The circle's radius then equals the
   pill's stadium radius → one family. */
.belt-header-skip {
  width: var(--pill-height);
  height: var(--pill-height);
  min-width: var(--pill-height);
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
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

/* INF-PLAY throb keyframe — now driven by the CENTRAL belt-progress pill
 * (.belt-timer-unified.is-infplay) rather than the forward chevron. The
 * forward chevron is plain ROUND/LEGO nav; the ∞ indicator moved to the
 * central pill. Keyframe shared by the default theme; mist has its own
 * (belt-infplay-throb-mist) further down. */
@keyframes belt-infplay-throb {
  0%, 100% {
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2),
                0 0 3px rgba(194, 58, 58, 0.22);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25),
                0 0 10px rgba(194, 58, 58, 0.42);
    transform: scale(1.03);
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
  height: var(--pill-height);
  padding: 0 12px 0 16px;
  background: color-mix(in srgb, var(--belt-color) 70%, rgba(0,0,0,0.3));
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--pill-radius); /* stadium — matches the round buttons + phase pill */
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

/* The belt screen isn't loadable yet (its contribution fetch is still in
   flight). Say so with the same pulse the play button uses while it loads —
   Tom, 2026-08-08: "we should show this by the belt buttons still flashing
   until they are ready to be used". Same keyframe values as BottomNav's
   .center-btn.is-disabled so the two controls speak one visual language. */
.belt-timer-unified.is-loading {
  animation: belt-pill-pulse 1.8s ease-in-out infinite;
  cursor: default;
}

@keyframes belt-pill-pulse {
  0%, 100% { opacity: 0.45; transform: scale(1); }
  50% { opacity: 0.75; transform: scale(1.02); }
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
  font-size: clamp(0.875rem, 2.4vw, 1.0625rem); /* slightly bigger m:ss — reads as the session stat */
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  white-space: nowrap;
  flex-shrink: 0;
}

/* INF-PLAY indicator state for the CENTRAL belt-progress pill.
 * When isInfPlayActive the pill changes colour (purple
 * gradient), THROBS, and shows an ∞ glyph instead of the progress line.
 * Tom: the ∞ indicator moved OFF the forward chevron ONTO this pill. */
.belt-timer-unified.is-infplay {
  /* SSi red, NOT purple — purple is the Purple-belt colour; red signals
     "past the belts" and matches the brand. Throb softened (slower, less
     scale + glow). */
  background: linear-gradient(135deg, #c23a3a 0%, #d35a5a 100%);
  border-color: rgba(194, 58, 58, 0.6);
  animation: belt-infplay-throb 2.4s ease-in-out infinite;
}
.belt-infplay-glyph {
  flex: 1;
  min-width: var(--belt-bar-width);
  height: 20px;
  color: #ffffff;
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

/* Interjection display — shown while a between-rounds encouragement /
   instruction plays. Calm, content-free reassurance keyed to the belt accent;
   never the next LEGO's text. */
.interjection-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 1.5rem 2rem;
  min-height: 80px;
}
/* Synthetic voice waveform — five bars with a gentle staggered rise/fall.
   Reads as "your guide is talking", identical every time so it never becomes
   distracting content. NOT driven by the real audio (no AnalyserNode tap on
   the <audio> element — that risks iOS lock/background stability). */
.interjection-wave {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 34px;
  animation: interjection-in 320ms ease-out;
}
.interjection-wave .wbar {
  width: 5px;
  height: 100%;
  border-radius: 3px;
  /* Belt-tinted but ALWAYS ink-anchored. A bare var(--belt-color) rendered the
     whole card blank on the Mist white surface (2026-08-06, product owner, 8
     min into French): white belt IS #ffffff, so five white bars and a white
     caption sat invisibly on a white card — the "empty box" bug. Blending
     towards the ink keeps the belt accent while guaranteeing contrast for every
     belt, white and yellow included. Same idiom as .hero-target under Mist. */
  background: color-mix(in srgb, var(--belt-color, #b08968) 55%, #2C2622);
  opacity: 0.55;
  transform: scaleY(0.3);
  transform-origin: center;
  animation: wave-bar 1.5s ease-in-out infinite;
}
.interjection-wave .wbar:nth-child(1) { animation-delay: 0s; }
.interjection-wave .wbar:nth-child(2) { animation-delay: 0.18s; }
.interjection-wave .wbar:nth-child(3) { animation-delay: 0.36s; }
.interjection-wave .wbar:nth-child(4) { animation-delay: 0.24s; }
.interjection-wave .wbar:nth-child(5) { animation-delay: 0.42s; }
@keyframes wave-bar {
  0%, 100% { transform: scaleY(0.3); opacity: 0.55; }
  50%      { transform: scaleY(1);   opacity: 1; }
}
/* The whole box breathes softly while the guide speaks — "comes alive". */
.hero-glass.is-interjection {
  animation: hero-throb 3.4s ease-in-out infinite;
}
@keyframes hero-throb {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.015); }
}
.interjection-caption {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: var(--text-base);
  font-weight: 400;
  letter-spacing: 0.02em;
  /* Ink-anchored for the same reason as .wbar above — a white-belt learner got
     white caption text on the white Mist card. */
  color: color-mix(in srgb, var(--belt-color, #b08968) 35%, #2C2622);
  opacity: 0.9;
  animation: interjection-in 360ms ease-out;
}
@keyframes interjection-in {
  from { opacity: 0; transform: translateY(6px) scale(0.96); }
  to   { opacity: 1; transform: none; }
}

.hero-text-known,
.hero-text-target {
  text-align: center;
}

/* Uniform bold (Tom 2026-06-07): the whole known phrase reads at one bold
   weight — the old salient-substring emphasis + context fade is gone. */
.hero-known {
  /* The known line is deliberately mono — but JetBrains Mono has no Greek, no
     Cyrillic, no Devanagari and none of the Yoruba dot-belows, so for a course
     whose known side is one of those it would fall to the OS per-character.
     Reading the token rather than naming the family is what lets the
     language-scoped rule reach it: --font-known-line is redefined inside a
     coverage-language subtree (styles/design-tokens.css), and an inherited
     custom property gets past this scoped rule's specificity in a way a
     font-family declaration never could. */
  font-family: var(--font-known-line);
  font-size: var(--known-text-size);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
  line-height: 1.5;
  letter-spacing: 0.01em;
  overflow-wrap: break-word;
  word-break: break-word;
  max-width: 100%;
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

/* ============ AMBIENT LISTENING CUE (whole pod lap) ============ */
/* Sits BELOW the full header (brand/title row + belt pill) — never inside
   its band, so it can't render behind/over the SaySomethingin wordmark or
   the DEV env badge (real bug, 2026-07-22: a flat 14px safe-area offset put
   it squarely under the title bar). z-index between PodTurnDisplay (3) and
   the hero glass pane (10) so it never competes with either.
   The transient instruction banner that used to share this slot is gone
   (2026-08-06): a listening exercise goes straight in with the audio. */
/* The only on-screen mark during a pod lap: tiny enough that it can never
   obscure the dialogue tiles, and carrying no instruction text. */
.pod-listening-ambient {
  position: absolute;
  top: calc(var(--header-total) + 14px);
  right: max(1rem, env(safe-area-inset-right, 0px));
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: rgba(255, 255, 255, 0.55);
  pointer-events: none;
  animation: pod-ambient-pulse 2.4s ease-in-out infinite;
}

.pod-listening-ambient svg {
  width: 16px;
  height: 16px;
}

@keyframes pod-ambient-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.85; }
}

.pod-preview-nav {
  /* Right edge, vertically centered — every other edge is contested (top:
     reminder banner + guest-progress-nudge; bottom: BottomNav at z-index
     3000, which swallows clicks on anything placed there at a lower
     z-index). This band is clear regardless of reminder/guest-nudge state. */
  position: absolute;
  top: 50%;
  right: max(0.75rem, env(safe-area-inset-right, 0px));
  transform: translateY(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  pointer-events: auto;
}

.pod-preview-nav__btn {
  padding: 0.5rem 1rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
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
/* Phase row mirrors the belt row exactly; the phase pill takes the belt pill's
   box (.belt-timer-unified): flex:1 width (no cap), 6px vertical padding, 20px
   radius, content-driven height — so it's pixel-identical to the belt pill and
   comes out that "tiny bit smaller" than the 36px buttons, just like the belt
   pill does. Tom 2026-06-01 (rebuild). */
.phase-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--belt-row-gap);
  width: 100%;
  padding: 0 var(--space-sm);
  margin: var(--hero-gap) auto 0; /* dialog box → phase pill — one rhythm unit (5u) */
}
.phase-strip {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-width: 0;
  height: var(--pill-height);
  padding: 0;
  background: #ffffff;
  border: 1.5px solid rgba(255, 255, 255, 0.35); /* match belt pill border (default theme) */
  border-radius: var(--pill-radius); /* stadium — matches belt pill + round buttons */
  box-shadow:
    0 2px 4px rgba(44, 38, 34, 0.10),
    0 6px 16px rgba(44, 38, 34, 0.06);
  overflow: hidden;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
}
/* Flanking cycle buttons sit in the same pointer-events:none pane as the strip
   — re-enable clicks on them (else they're dead, like last time). */
.phase-cycle-skip {
  pointer-events: auto;
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

/* Active pause MUST NOT take the solid red bg the other segments take —
 * the section bg and the growing fill would both be --ssi-red and the
 * countdown would be invisible. So the segment's TRACK is the accent at
 * 15% (the same soft red the hover state uses) and the fill is the only
 * solid red; the icon stays dark for readability over the sweep.
 *
 * Why a track and not `transparent`: with a transparent track the growing
 * fill is a solid red block starting at the segment's LEFT edge while the
 * mic icon sits at its centre — so mid-countdown the pill reads as "an
 * unlabelled red block between the headphones and the mic, with neither
 * button highlighted", which is exactly how Tom read his 2026-08-09
 * screenshot. The highlight was on the right segment all along; the SPEAK
 * segment just didn't look like a segment. The soft track gives it its
 * full 40% back, so the active phase is always legibly one of the four. */
.phase-segment--pause.is-active {
  background: var(--accent-soft);
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

/* Text Zones - FIXED HEIGHT */
.known-text {
  font-size: var(--known-text-size);
  font-weight: 600;
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

/* QA Report button - positioned in header area */
.qa-report-btn {
  position: fixed;
  top: calc(1rem + env(safe-area-inset-top, 0px));
  right: 1rem;
  z-index: 100;
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

.mode-popup-icon--easy {
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

/* Tablet and Desktop (768px+) - more breathing room.
   ONE knob: bump the base unit 4px → 5px and the whole hero grid scales
   proportionally (pill 32→40, radius 16→20, rhythm 20→25, header derives). */
@media (min-width: 768px) {
  .player {
    --u: 5px;
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
    /* --pill-height now derives from --u (8u = 40px here) */
    --control-bar-gap: 3.5rem;
    --control-group-gap: 0.625rem;
    --ring-size: 220px;
    --ring-center-size: 130px;
    --ring-icon-size: 44px;
    --text-zone-min-height: 100px;
  }
}

/* Landscape phones - compact vertical spacing.
   Same grid, smaller base unit (3px → pill 24, rhythm 15); header-height +
   hero-offset DERIVE from it (honest), so no overlap from a hardcoded guess. */
@media (orientation: landscape) and (max-height: 500px) {
  .player {
    --u: 3px;
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

/* Transient "Your course was updated" notice — rides the mode-tip shell,
   sits above the nav like the tip, tap anywhere to dismiss (auto-hides). */
.course-updated-notice {
  cursor: default;
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
  /* Match the phase pill exactly so the two pills read as one family — the
     belt pill's heavier 24px shadow made it look chunkier ("less sleek"). */
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10),
              0 6px 16px rgba(44, 38, 34, 0.06);
}

[data-theme="mist"] .player .belt-timer-label {
  color: #2C2622;
}

/* Phase pill border matches the belt pill per-theme: white on default, dark on mist */
[data-theme="mist"] .player .phase-strip {
  border: 1.5px solid rgba(0, 0, 0, 0.35);
}

/* --- Mode nav buttons on mist → translucent, not opaque like the pill --- */
/* Mode nav buttons moved to BottomNav.vue */

/* --- Belt skip buttons → crisp white, destination belt color arrows --- */
[data-theme="mist"] .player .belt-header-skip {
  background: rgba(255, 255, 255, 0.96);
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  opacity: 1;
  color: rgba(44, 38, 34, 0.85);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10);
}

[data-theme="mist"] .player .belt-header-skip:hover:not(:disabled) {
  background: #e6e1d9;
  color: rgba(44, 38, 34, 0.95);
  box-shadow: 0 2px 8px rgba(44, 38, 34, 0.18);
}

[data-theme="mist"] .player .belt-header-skip:disabled {
  background: rgba(255, 255, 255, 0.5);
  border-color: rgba(0, 0, 0, 0.18);
  color: var(--text-muted);
  box-shadow: none;
}

/* --- INF-PLAY state for the CENTRAL belt-progress pill (mist theme).
   MUST override the generic white belt-timer-unified styling above with
   matching specificity — mist overrides every UI surface and silently
   wins on specificity otherwise. The ∞ indicator lives on this pill now,
   not the forward chevron. --- */
[data-theme="mist"] .player .belt-timer-unified.is-infplay {
  background: linear-gradient(135deg, #c23a3a 0%, #d35a5a 100%);
  border: 1.5px solid rgba(194, 58, 58, 0.7);
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.14),
              0 0 10px rgba(194, 58, 58, 0.4);
  animation: belt-infplay-throb-mist 2.4s ease-in-out infinite;
}
[data-theme="mist"] .player .belt-timer-unified.is-infplay .belt-timer-label {
  color: #ffffff;
}
[data-theme="mist"] .player .belt-infplay-glyph {
  color: #ffffff;
}

/* Mist-theme throb keyframes — softer shadow than the dark-theme
 * version so the pulse reads on a light background without looking
 * like a defect. */
@keyframes belt-infplay-throb-mist {
  0%, 100% {
    box-shadow: 0 2px 4px rgba(44, 38, 34, 0.08),
                0 0 3px rgba(194, 58, 58, 0.18);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 2px 6px rgba(44, 38, 34, 0.12),
                0 0 9px rgba(194, 58, 58, 0.4);
    transform: scale(1.03);
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

[data-theme="mist"] .player .hint-dismiss {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="mist"] .player .hint-dismiss svg {
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
