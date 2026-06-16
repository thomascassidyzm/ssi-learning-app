<script setup>
import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { getAudioCache } from '../cache/createAudioCache'
import { useAudioSessionKeepalive } from '../composables/useAudioSessionKeepalive'
import { usePlayerLog } from '../composables/usePlayerLog'
import { BELTS } from '../composables/useBeltProgress'
import { useListeningPods, SPEAKER_PALETTE } from '../composables/useListeningPods'
import { useUserRole } from '../composables/useUserRole'
import { useAlgorithmConfig } from '../composables/useAlgorithmConfig'
import { ROLE_SPEED } from '../composables/usePodLapScheduler'
import { usePodStage0 } from '../composables/usePodStage0'
import { tierSequence, foldEventsToPlays } from '../composables/stage0Sequence'
import { buildSilentWavDataUri } from '../playback/silentWav'
import { resolveCachedPlaybackUrl } from '../cache/resolvePlaybackUrl'

// ============================================================================
// Listening Overlay - Teleprompter style overlay for passive listening
// Lives inside LearningPlayer as an overlay, not a separate screen
// ============================================================================

class ListeningAudioController {
  constructor() {
    this.audio = null
    this.playbackRate = 1
    // ms → data: URI cache for the silent gap clips (two sizes in practice).
    this.silenceCache = new Map()
    // Bound timeupdate handler — keeps navigator.mediaSession's position
    // state advancing so iOS/Android see a LIVE session and are far less
    // likely to suspend the backgrounded/locked tab. Same heuristic the
    // main flow uses (SimplePlayer.updateMediaPositionState). Skips the
    // silent gap clips (their data: URI has no meaningful duration).
    this._onTimeUpdate = () => this._updatePositionState()
  }

  /** Ensure the reusable element exists and the position-state listener is
   *  attached exactly once. */
  _ensureAudio() {
    if (!this.audio) {
      this.audio = new Audio()
      this.audio.addEventListener('timeupdate', this._onTimeUpdate)
      this.audio.addEventListener('loadedmetadata', this._onTimeUpdate)
    }
    return this.audio
  }

  _updatePositionState() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    if (typeof ms.setPositionState !== 'function') return
    const a = this.audio
    if (!a) return
    const duration = a.duration
    // Guard against NaN/Infinity (pre-metadata) and out-of-range positions
    // that would make setPositionState throw.
    if (!Number.isFinite(duration) || duration <= 0) return
    const position = Math.min(Math.max(a.currentTime || 0, 0), duration)
    try {
      ms.setPositionState({ duration, position, playbackRate: a.playbackRate || 1 })
    } catch {
      /* best-effort — never break playback over a position hint */
    }
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate
    if (this.audio) {
      this.audio.playbackRate = rate
    }
  }

  /**
   * Background/lock-safe gap: play a genuinely-silent one-shot WAV on the
   * SAME element the real clips use and resolve on its natural 'ended' —
   * the same protocol as SimplePlayer's PAUSE phase. A bare setTimeout
   * here freezes when iOS backgrounds/locks the tab, which killed the
   * inter-turn advance (main flow / INF PLAY / pod laps all advance on
   * 'ended' and survive; these gaps must too). playbackRate applies, so
   * faster speeds tighten the gaps proportionally — desirable.
   */
  async playSilence(ms) {
    if (!ms || ms <= 0) return
    let uri = this.silenceCache.get(ms)
    if (!uri) {
      uri = buildSilentWavDataUri(ms / 1000)
      this.silenceCache.set(ms, uri)
    }
    await this.play(uri)
  }

  /** Play one clip. rateOverride (stage-pattern ×2 plays) takes precedence
   *  over the user's global speed for THIS clip only. */
  async play(url, rateOverride = null) {
    if (!url) {
      console.warn('[ListeningAudio] No audio URL')
      return
    }

    this._ensureAudio()

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
      this.audio.playbackRate = rateOverride ?? this.playbackRate
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

// Belt-jump strip refs — used to scroll the active belt into the
// horizontal centre on mount + whenever the active belt changes. Without
// this, the White (start) and Black (end) belts get clipped at the
// strip's edges on narrow viewports; the user has no idea they can
// scroll. With it, the active belt always lands in the middle and the
// edge fade-mask (see CSS) hints that more belts exist either side.
const beltStripEl = ref<HTMLElement | null>(null)
const activeBeltPipEl = ref<HTMLElement | null>(null)

// State
const isLoading = ref(true)
const error = ref(null)
const mode = ref('shuffled') // Start shuffled for variety

// Top-level view toggle. Code keys stay snake-y; display labels in the
// template are Dialogues / Core / All.
//   'pods'    (Dialogues) = Listening Pod scene list (Layer 2) — DEFAULT
//   'seeds'   (Core)      = every seed sentence (whole-sentence listen)
//   'phrases' (All)       = every USE phrase in the course
// Dialogues first and default (Tom 2026-06-07): the scenes are the
// flagship listening content; All/Core are the deeper cuts.
const view = ref('pods')

// Phrase data
const allPhrases = ref([])
const visiblePhrases = ref([])
const currentIndex = ref(-1)
const isPlaying = ref(false)
const audioController = ref(null)

/** Dialogues (pods) loop toggle. OFF (default): on scene-end, auto-
 *  advance to the next scene — the whole pod plays as a continuous
 *  listening session. ON: stay on the current scene, restart it from
 *  the top (Spotify-style single-track repeat). Only meaningful in
 *  pods view with a scene selected. */
const loopScene = ref(false)

// ── Dialogue listening modes (Tom 2026-06-12) ──────────────────────────
// Listening MODE is for PRACTICE — the learner replays whole scenes with
// no known-language crutch. The structured 9-stage acquisition delivery
// already lives in the MAIN FLOW (usePodLapScheduler, driven live from
// algorithm_config.pods); we deliberately do NOT re-implement a summarised
// copy of it here — that second engine was the source of the listening-vs-
// main-flow mismatch. Two target-only practice modes:
//   immersion — the whole scene, target only, at the learner's chosen speed
//               (the speed row). Continuous, natural conversation.
//   drill     — each line three times: 1× · 2× · 2×, target only. Tight
//               repetition to lock a line in.
// An admin-only 'audit' mode (the real 9-stage progression, read live from
// algorithm_config.pods) is appended for content tuning — gated by both the
// ssi_admin role AND the Settings → Developer "Listening Progression Audit"
// toggle. Keys are stable (localStorage + code); labels are free to evolve.
const BASE_LISTEN_MODES = [
  { key: 'immersion', label: 'Immersion', desc: 'The whole scene in the target language, at your pace' },
  { key: 'drill',     label: 'Drill',     desc: 'Each line three times — once normal, then twice fast' },
]
const AUDIT_LISTEN_MODE = {
  key: 'audit',
  label: 'Progression',
  desc: 'Admin: walk each line through every acquisition stage, live from the listening config',
}
// Admin audit availability: just the ssi_admin role. (Previously also required a
// Settings → Developer toggle, which only buried the pill — admins want it as a
// plain third pill alongside Immersion/Drill. Tom 2026-06-15.)
const { isSsiAdmin } = useUserRole()
const auditAvailable = computed(() => isSsiAdmin.value)
const LISTEN_MODES = computed(() =>
  auditAvailable.value ? [...BASE_LISTEN_MODES, AUDIT_LISTEN_MODE] : BASE_LISTEN_MODES,
)
const validModeKeys = computed(() => new Set(LISTEN_MODES.value.map((m) => m.key)))
const listenMode = ref(localStorage.getItem('ssi-listening-mode') || 'immersion')
watch(listenMode, (m) => { try { localStorage.setItem('ssi-listening-mode', m) } catch {} })
// Keep the selection valid: a retired key (Flow/Guided/Practice/Turbo) — or
// 'audit' when it's no longer available — falls back to the default.
watch(validModeKeys, (keys) => { if (!keys.has(listenMode.value)) listenMode.value = 'immersion' }, { immediate: true })

// Live pod stage config — the SAME source the main-flow scheduler reads, so
// the audit walk matches main-flow delivery (and Popty tweaks) by construction.
const algoConfig = useAlgorithmConfig(supabase)
// Stage badge for the audit walk — { stage, total, role } | null.
const auditStatus = ref(null)
// Warm the config if audit is enabled after the overlay is already open.
watch(auditAvailable, (v) => { if (v) algoConfig.loadConfigs() })

// Known-language glosses can be hidden entirely (long canon-v2 turns make
// the gloss block heavy when you don't need it).
const showGloss = ref(localStorage.getItem('ssi-listening-gloss') !== 'off')
watch(showGloss, (v) => { try { localStorage.setItem('ssi-listening-gloss', v ? 'on' : 'off') } catch {} })

// Dialogue rows are per-CHUNK, so the gloss is a single line under a single
// phrase (never a paragraph wall) — it follows the gloss eye in every mode,
// target-first by leaving the eye where the learner sets it.
// True when we're in a dialogue scene (pods + a scene open) — the only place
// the Immersion/Drill mode-selector and its fixed-pace slot live.
const isDialogueScene = computed(() => view.value === 'pods' && selectedScene.value !== null)

// Interactive speed buttons: always in Core/All; in Dialogues only Immersion
// exposes them. In Drill/audit the speed slot stays present but shows a quiet,
// non-interactive fixed-pace indicator instead (so the toolbar height never
// changes when you switch modes — see the dialogue layout note in CSS).
const showSpeedRow = computed(
  () => !isDialogueScene.value || listenMode.value === 'immersion'
)

// Pods state: list of scenes from useListeningPods, plus the currently
// selected scene (null = scene list visible, set = teleprompter mode).
const courseCodeRef = computed(() => props.courseCode)
const pods = useListeningPods(courseCodeRef)
// Stage-0 atom resolution for the admin Progression walk — lets buildAuditQueue
// prepend the 5-tier breakdown before Stages 1-N. Loaded lazily when audit is on.
const podStage0 = usePodStage0(courseCodeRef)
watch([() => isSsiAdmin.value, courseCodeRef], ([admin, code]) => {
  if (admin && code) podStage0.load()
}, { immediate: true })
const selectedScene = ref(null)

// Pagination
const BATCH_SIZE = 50
const VISIBLE_WINDOW = 7
const PRELOAD_THRESHOLD = 10
const loadedCount = ref(0)
const totalCount = ref(0)
const hasMore = ref(true)
const isLoadingMore = ref(false)

// Audio - use /api/audio proxy for CORS bypass
const audioMap = ref(new Map())

// Tab-open JIT prefetch — warm the first ~5 rows of the active tab so
// click-to-play feels instant on slow networks. Cap is deliberate:
// prefetching the whole tab would chew bandwidth for content the user
// may never tap (Core for a course = 100s of seeds; All = 1000s of
// USE phrases). Five rows is enough to cover "open + immediately tap
// near the top" — which is what the visible window shows by default.
const TAB_PREFETCH_LIMIT = 5

// Session-wide iOS audio-session keepalive (shared with LearningPlayer's
// pod/commentary path). Runs the silent loop whenever this overlay is
// playing, so the inter-phrase 800ms gap doesn't drop the session when
// the tab is backgrounded. Debounced release means brief async gaps
// (audio-element src swaps, network reads) don't cause a flicker.
useAudioSessionKeepalive(isPlaying)

let playbackId = 0

// ============================================================================
// LEGO ordinal lookup — maps (seedNumber, legoIndex) → 1-based ordinal in
// the course's introduction order. Fetched once when the overlay opens.
// Used to render "#N" tags on each phrase and group phrases by belt.
// ============================================================================
const legoOrdinalByKey = ref(new Map())

const beltIndexForSeed = (seedNumber) => {
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (seedNumber >= BELTS[i].seedsRequired) return i
  }
  return 0
}

/**
 * Whether to render a belt-section header before visiblePhrases[i].
 * True if i===0 (first visible row) OR the previous visible row is in
 * a different belt. Only consulted in ordered phrases mode (pod
 * sentences have no belt info).
 */
const shouldShowBeltHeader = (i) => {
  if ((view.value !== 'phrases' && view.value !== 'seeds') || mode.value !== 'ordered') return false
  const phrase = visiblePhrases.value[i]
  if (!phrase || phrase.beltIndex === undefined) return false
  if (i === 0) return true
  const prev = visiblePhrases.value[i - 1]
  return prev && prev.beltIndex !== phrase.beltIndex
}

/**
 * Belt-jump strip — for each belt that has at least one phrase in the
 * loaded inventory, return { belt info + first phrase index }. Drives
 * the row of belt pips above the teleprompter (Phrases + ordered only).
 */
const beltJumpPoints = computed(() => {
  if (view.value !== 'phrases' && view.value !== 'seeds') return []
  const points = []
  const seen = new Set()
  // Walk allPhrases in order; first occurrence of each beltIndex is the
  // jump target.
  allPhrases.value.forEach((phrase, idx) => {
    if (phrase.beltIndex === undefined || seen.has(phrase.beltIndex)) return
    seen.add(phrase.beltIndex)
    points.push({
      beltIndex: phrase.beltIndex,
      beltName: phrase.beltName,
      beltColor: phrase.beltColor,
      phraseIndex: idx,
    })
  })
  return points.sort((a, b) => a.beltIndex - b.beltIndex)
})

/** Current belt of the focal phrase — for active-state on the jump pip. */
const currentBeltIndex = computed(() => {
  const list = availablePhrases.value
  if (currentIndex.value < 0 || currentIndex.value >= list.length) return -1
  return list[currentIndex.value]?.beltIndex ?? -1
})

const jumpToBelt = (point) => {
  if (view.value !== 'phrases' && view.value !== 'seeds') return
  // In shuffled mode, allPhrases has been reordered — find the first
  // phrase matching the target beltIndex in the shuffled list instead.
  const list = availablePhrases.value
  let idx = point.phraseIndex
  if (mode.value === 'shuffled') {
    idx = list.findIndex((p) => p.beltIndex === point.beltIndex)
    if (idx === -1) return
  }
  stopPlayback()
  currentIndex.value = idx
  updateVisibleWindow()
  scrollCurrentIntoView()
}

/**
 * Open a scene: swap the teleprompter's data source to the scene's
 * sentences (shape-compatible with the phrase row template). Reset
 * playback position. Keeps the same teleprompter UI — pod sentences
 * just don't carry seedNumber/legoOrdinal/belt info so those bits of
 * row chrome stay hidden.
 */
const openScene = (scene) => {
  stopPlayback()
  selectedScene.value = scene
  // Flatten the scene's turns into ONE ROW PER CHUNK (per-phrase granularity,
  // Tom 2026-06-12). The turn grouping survives only as presentation: the
  // speaker chip shows on a turn's FIRST chunk, and the inter-row gap is
  // turn-aware (tight within a speaker's turn, a full breath on a speaker
  // change) — so a turn still reads as one person speaking, revealed line by
  // line, while each row stays a single parseable phrase + its gloss.
  const phrases = []
  for (const t of scene.turns) {
    const color = SPEAKER_PALETTE[t.colorIndex % SPEAKER_PALETTE.length]
    const chunks = Array.isArray(t.sentences) && t.sentences.length > 0
      ? t.sentences
      : [{ targetText: t.targetText, knownText: t.knownText, targetAudioId: t.audioIds[0] || null, knownAudioId: null, explainerAudioId: null }]
    chunks.forEach((s, idx) => {
      phrases.push({
        id: `${t.id}-c${idx}`,
        seedNumber: undefined,
        legoIndex: undefined,
        legoId: '',
        legoOrdinal: null,
        beltIndex: undefined,
        beltName: '',
        beltColor: '',
        knownText: s.knownText,
        targetText: s.targetText,
        speaker: t.speaker,
        // Chip only on the turn's first chunk — later chunks group beneath it.
        speakerName: idx === 0 ? t.speakerName : '',
        speakerColor: color,
        position: t.globalOrder * 1000 + idx,
        target1AudioId: s.targetAudioId || '',
        target2AudioId: s.targetAudioId || '',
        audioIds: s.targetAudioId ? [s.targetAudioId] : [],
        // Single-chunk detail — keeps the play queue + gloss split working.
        sentences: [s],
        // True for the first chunk of a turn — drives the turn-aware gap.
        isTurnStart: idx === 0,
      })
    })
  }
  allPhrases.value = phrases
  loadedCount.value = phrases.length
  totalCount.value = phrases.length
  hasMore.value = false
  currentIndex.value = 0
  // Pods are dialogues — they tell a story. Force ordered playback;
  // shuffling would scramble the conversation. The shuffle toggle is
  // also hidden in the Pods view (see template) so the user can't
  // accidentally re-enable it from this surface.
  mode.value = 'ordered'
  updateVisibleWindow()
  // Warm-up: cache the WHOLE scene (every clip the current mode needs)
  // while the screen is still on — background fetch suspends under lock,
  // so the horizon must be banked up-front. usePodLapScheduler prefetches
  // its OWN pod laps for the active LearningPlayer session — this is
  // independent; SW CacheFirst de-dupes shared audio.
  warmScene(scene)
}

// Switching listening mode mid-scene changes which clips a play-through
// needs (translations/explainers) — top the cache up immediately.
watch(listenMode, () => { if (selectedScene.value) warmScene(selectedScene.value) })

/** Back from scene-teleprompter to the scene list. */
const exitScene = () => {
  stopPlayback()
  selectedScene.value = null
  // Restore the phrase-mode data — only needed if user originally arrived
  // in phrases mode and switched. If we never had phrases, no-op is fine.
  if (view.value === 'phrases') {
    // Already populated; nothing to do.
  }
}

/** Switch top-level view. Resets transient state. */
const setView = (v) => {
  if (view.value === v) return
  stopPlayback()
  selectedScene.value = null
  view.value = v
  allPhrases.value = []
  loadedCount.value = 0
  totalCount.value = 0
  currentIndex.value = -1
  if (v === 'phrases') {
    hasMore.value = true
    loadPhrases()
  } else if (v === 'seeds') {
    hasMore.value = false
    // Core defaults to ordered — seed-by-seed makes pedagogical sense
    // as a beginning. User can still flip to shuffled with the toggle.
    mode.value = 'ordered'
    loadSeeds()
  } else {
    // pods: scene list visible until a scene is picked
    hasMore.value = false
  }
}

const loadLegoOrdinals = async () => {
  if (!supabase?.value || !props.courseCode) return
  try {
    let q = supabase.value
      .from('course_legos')
      .select('seed_number, lego_index')
      .eq('course_code', props.courseCode)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .limit(2000)
    if (props.upToSeed) q = q.lt('seed_number', props.upToSeed)
    const { data, error: ordErr } = await q
    if (ordErr) {
      console.warn('[ListeningOverlay] LEGO ordinal fetch failed:', ordErr.message)
      return
    }
    const map = new Map()
    ;(data || []).forEach((row, i) => {
      const key = `${row.seed_number}.${row.lego_index}`
      map.set(key, i + 1)
    })
    legoOrdinalByKey.value = map
  } catch (e) {
    console.warn('[ListeningOverlay] LEGO ordinal fetch threw:', e)
  }
}

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

      const newPhrases = data.map((p, i) => {
        const key = `${p.seed_number}.${p.lego_index}`
        const beltIndex = beltIndexForSeed(p.seed_number)
        return {
          id: `${p.seed_number}-${p.lego_index}-${p.position || i}`,
          seedNumber: p.seed_number,
          legoIndex: p.lego_index,
          legoId: `S${String(p.seed_number).padStart(4, '0')}L${String(p.lego_index).padStart(2, '0')}`,
          legoOrdinal: legoOrdinalByKey.value.get(key) || null,
          beltIndex,
          beltName: BELTS[beltIndex]?.name || '',
          beltColor: BELTS[beltIndex]?.color || '#ffffff',
          knownText: p.known_text,
          targetText: p.target_text,
          position: p.position,
          target1AudioId: p.target1_audio_id,
          target2AudioId: p.target2_audio_id
        }
      })

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

      // First-page warm-up: prefetch the top ~5 rows so the first tap
      // plays instantly. Only on the initial load (offset === 0) — later
      // pages land via scroll/auto-advance which has its own runway.
      if (offset === 0) {
        prefetchTopRows()
      }
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

/**
 * Core view loader — every seed in the course, regardless of whether
 * the learner has reached it yet. Seeds typically number 100–400 per
 * course, so we load them all in one shot (no pagination).
 *
 * Maps each seed to the same row shape the teleprompter expects for
 * phrases. legoIndex / legoOrdinal stay null (seeds aren't LEGOs);
 * belt-jump + ordered/shuffled toggle work unchanged because they
 * derive purely from seed_number.
 */
const loadSeeds = async () => {
  if (!supabase?.value || !props.courseCode) {
    error.value = 'Database not configured'
    isLoading.value = false
    return
  }
  try {
    isLoading.value = true
    error.value = null

    const { data, error: fetchError } = await supabase.value
      .from('course_seeds')
      .select('seed_number, known_text, target_text, target1_audio_id, target2_audio_id')
      .eq('course_code', props.courseCode)
      .order('seed_number', { ascending: true })

    if (fetchError) throw fetchError

    const rows = (data || []).map((s) => {
      const beltIndex = beltIndexForSeed(s.seed_number)
      return {
        id: `seed-${s.seed_number}`,
        seedNumber: s.seed_number,
        legoIndex: undefined,
        legoId: `S${String(s.seed_number).padStart(4, '0')}`,
        legoOrdinal: null,
        beltIndex,
        beltName: BELTS[beltIndex]?.name || '',
        beltColor: BELTS[beltIndex]?.color || '#ffffff',
        knownText: s.known_text,
        targetText: s.target_text,
        position: s.seed_number,
        target1AudioId: s.target1_audio_id,
        target2AudioId: s.target2_audio_id || s.target1_audio_id,
      }
    })

    allPhrases.value = rows
    loadedCount.value = rows.length
    totalCount.value = rows.length
    hasMore.value = false
    currentIndex.value = rows.length > 0 ? 0 : -1
    if (mode.value === 'shuffled') shufflePhrases()
    updateVisibleWindow()
    // Warm-up: prefetch the top ~5 seeds so the first tap plays instantly.
    prefetchTopRows()
  } catch (err) {
    console.error('[ListeningOverlay] loadSeeds error:', err)
    error.value = 'Failed to load seeds'
  } finally {
    isLoading.value = false
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
// Interleaved gloss pairs (Tom 2026-06-11)
// ============================================================================
// Long canon-v2 turns made block-target-then-block-known impossible to match
// up. The turn's per-sentence data gives PERFECTLY aligned (target, known)
// row pairs; within a row, faithful rendering means sentence counts almost
// always match too — so sub-split on sentence enders when they do, and fall
// back to the row pair when they don't. Pure string work, no timing data.
const splitSentences = (text) =>
  (String(text || '').match(/[^.!?…。！？]+[.!?…。！？]+["”』」)]*|[^.!?…。！？]+$/gu) || [])
    .map((s) => s.trim())
    .filter(Boolean)

const glossPairsFor = (phrase) => {
  const units = (Array.isArray(phrase.sentences) && phrase.sentences.length > 0)
    ? phrase.sentences
    : [{ targetText: phrase.targetText, knownText: phrase.knownText }]
  const pairs = []
  for (const u of units) {
    const t = splitSentences(u.targetText)
    const k = splitSentences(u.knownText)
    if (t.length > 1 && t.length === k.length) {
      for (let i = 0; i < t.length; i++) pairs.push({ target: t[i], known: k[i] })
    } else {
      pairs.push({ target: u.targetText, known: u.knownText })
    }
  }
  return pairs
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

/**
 * Tab-open JIT prefetch — warm the first ~5 visible-ish rows of the
 * active tab so the first tap plays instantly on slow networks.
 *
 * The ListeningOverlay's playback path uses raw audio URLs through a
 * plain `new Audio()` element — it does NOT consult IndexedDB at play
 * time. That means the only cache layer the click-to-play tap hits is
 * the SW CacheFirst layer for `/api/audio/*`. So we warm THAT cache by
 * issuing the same URL (`getAudioUrl(id)`, including the `?courseId=…`
 * query string the player will use) at low priority — matching the
 * pattern in usePodLapScheduler.prefetchLap().
 *
 * priority: 'low' — these are pure bandwidth warm-ups with no urgency.
 * They must not compete with the LearningPlayer's high-priority known-
 * audio prefetches if a session is running (browsers without
 * RequestPriority support ignore the option gracefully).
 *
 * Conservative cap (TAB_PREFETCH_LIMIT = 5) — no point prefetching the
 * whole tab for a list of hundreds of phrases the user will scroll past.
 * The cap also bounds the worst-case bandwidth cost of a user rapidly
 * cycling through tabs. Repeated calls for the same URL collapse at the
 * SW layer (CacheFirst — first request fills the cache, subsequent
 * requests hit it).
 */
/**
 * Warm the next scene's opening audio into IndexedDB while the current
 * scene's last turn plays — so the playlist segue resolves to a cached WAV
 * blob (lock-safe) instead of hitting the network inside the 800ms gap.
 * Mirrors the wrap-around in handleEndOfList (last scene warms the first).
 */
/** Warm EVERY clip a scene's turns can need under the current mode —
 *  targets, and (in stage-pattern modes) translations + explainers. A whole
 *  canon-v2 scene is ≤ ~60 small clips; cached up-front while the screen is
 *  still on, so a locked-screen play-through never touches the network. */
const warmScene = (scene) => {
  if (!scene) return
  for (const t of scene.turns) {
    for (const id of audioIdsForWarm(t)) warmClip(id)
  }
}

const prefetchNextSceneHead = () => {
  if (view.value !== 'pods' || !selectedScene.value || loopScene.value) return
  const sceneList = pods.scenes.value
  const idx = sceneList.findIndex(s => s.sceneNumber === selectedScene.value.sceneNumber)
  const next = idx >= 0 ? (sceneList[idx + 1] || sceneList[0]) : null
  if (!next || next.sceneNumber === selectedScene.value.sceneNumber) return
  warmScene(next)
}

/**
 * Warm one clip into the IndexedDB AudioCache (not just the SW). This is
 * what lets the play-time resolver hand the <audio> element a cached WAV
 * blob — the lock-screen-safe path. persistent.ensure de-dupes in-flight
 * and is a fast no-op when already stored; errors are silent (the JIT
 * resolve on play falls back to the proxy URL).
 */
const warmClip = (id) => {
  if (!id || audioCache.persistent.has(id)) return
  audioCache.persistent.ensure(id).catch(() => undefined)
}

const prefetchTopRows = () => {
  const rows = availablePhrases.value
  if (!rows.length) return

  for (let i = 0; i < Math.min(TAB_PREFETCH_LIMIT, rows.length); i++) {
    const row = rows[i]
    if (!row) continue
    // Pod turns carry audioIds[]; phrase/seed rows carry target1AudioId.
    // playPhrase picks one of target1/target2 randomly per cycle, but we
    // only need to warm one to make the first tap feel instant — pick
    // the primary (target1) since it's also the id set as audioIds[0]
    // in pod turn mapping.
    let id = null
    if (Array.isArray(row.audioIds) && row.audioIds.length > 0) {
      id = row.audioIds[0]
    } else if (row.target1AudioId) {
      id = row.target1AudioId
    } else if (row.target2AudioId) {
      id = row.target2AudioId
    }
    // Warm into IndexedDB (not just the SW) so the play-time resolver can
    // hand the element a cached WAV blob — the lock-screen-safe path.
    warmClip(id)
  }
}


// ============================================================================
// Playback
// ============================================================================

const playFromIndex = async (index) => {
  if (index < 0 || index >= availablePhrases.value.length) return

  const myPlaybackId = ++playbackId
  currentIndex.value = index
  isPlaying.value = true
  updateVisibleWindow()

  await nextTick()
  scrollCurrentIntoView()
  await loadMoreIfNeeded()
  await playCurrentPhrase(myPlaybackId)
}

/**
 * Build the play queue for one phrase row as [{ id, rate|null }].
 * - Dialogue scenes (Immersion / Drill): TARGET ONLY, mapped from the turn's
 *   per-chunk sentence detail.
 *     immersion — each chunk once at the learner's chosen speed.
 *     drill     — each chunk three times: 1× · 2× · 2×.
 * - Core / All rows keep the original random-voice behaviour.
 */
const buildPlayQueue = (phrase) => {
  if (view.value === 'pods' && selectedScene.value) {
    // Per-chunk detail drives both modes; fall back to the turn's first
    // audio id if a row somehow lacks sentence detail.
    const sentences = (Array.isArray(phrase.sentences) && phrase.sentences.length > 0)
      ? phrase.sentences
      : [{ targetAudioId: phrase.audioIds?.[0] || phrase.target1AudioId || null }]
    if (listenMode.value === 'audit') {
      return buildAuditQueue(sentences)
    }
    const queue = []
    if (listenMode.value === 'drill') {
      for (const s of sentences) {
        if (!s.targetAudioId) continue
        queue.push({ id: s.targetAudioId, rate: 1 })
        queue.push({ id: s.targetAudioId, rate: 2 })
        queue.push({ id: s.targetAudioId, rate: 2 })
      }
      return queue
    }
    // immersion (default): the whole scene, target only, at the chosen speed.
    for (const s of sentences) {
      if (s.targetAudioId) queue.push({ id: s.targetAudioId, rate: playbackSpeed.value })
    }
    return queue
  }
  if (Array.isArray(phrase.audioIds) && phrase.audioIds.length > 0) {
    return phrase.audioIds.filter(Boolean).map((id) => ({ id, rate: null }))
  }
  const useVoice1 = Math.random() < 0.5
  const audioId = useVoice1 ? phrase.target1AudioId : phrase.target2AudioId
  return audioId ? [{ id: audioId, rate: null }] : []
}

/**
 * Admin "Progression" audit walk — for each chunk, play EVERY stage of the
 * LIVE pod config (algorithm_config.pods) in order, so the content team hears
 * a line's whole 1→9 acquisition arc in one pass. Role → audio resolution
 * mirrors usePodLapScheduler exactly (explainer falls back to translation),
 * and role → rate reuses the scheduler's ROLE_SPEED — so this matches the
 * real main-flow delivery by construction. Queue items carry stage metadata
 * for the on-screen badge.
 */
const buildAuditQueue = (sentences) => {
  const playlist = algoConfig.podsConfig.value?.stagePlaylist || {}
  const stages = Object.keys(playlist)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b)
  const podsTotal = stages.length
  const s0cfg = algoConfig.stage0Config.value
  const s0tiers = s0cfg?.tiers || []
  const queue = []
  for (let ci = 0; ci < sentences.length; ci++) {
    const s = sentences[ci]
    const chunk = ci + 1
    const chunks = sentences.length
    // STAGE 0 FIRST — the 5-tier per-atom breakdown (live from algorithm_config
    // .stage0), resolved to its [atom] / means-gloss / take / translation clips.
    // (Was missing: the Progression walk used to start at Stage 1.)
    const resolved = s.id ? podStage0.resolveSentence(s.id) : null
    if (resolved && s0tiers.length) {
      for (const tier of s0tiers) {
        for (const p of foldEventsToPlays(tierSequence(tier, resolved.atoms, resolved.clips, s0cfg))) {
          queue.push({ id: p.audioId, rate: p.speed || 1, stage: `0 · ${tier.key}`, total: podsTotal, role: p.role, chunk, chunks })
        }
      }
    }
    // THEN Stages 1-N — the whole-sentence behaviours from algorithm_config.pods.
    for (const stage of stages) {
      for (const role of playlist[stage] || []) {
        const id = role === 'trans'
          ? s.knownAudioId
          : role === 'explainer'
            ? (s.explainerAudioId || s.knownAudioId) // explainer → translation fallback
            : s.targetAudioId // ps / ps08x / ps15x / ps2x
        if (!id) continue
        queue.push({ id, rate: ROLE_SPEED[role] ?? 1, stage: String(stage), total: podsTotal, role, chunk, chunks })
      }
    }
  }
  return queue
}

/** Every audio id a row can need under the CURRENT mode — the warm-ahead
 *  must cover explainer/translation clips too (audit walk only), or a
 *  staged play hits the network mid-list (fatal under a locked screen).
 *  Immersion / Drill are target-only, so only targets are warmed. */
const audioIdsForWarm = (phrase) => {
  if (!phrase) return []
  const ids = []
  if (Array.isArray(phrase.sentences) && phrase.sentences.length > 0) {
    for (const s of phrase.sentences) {
      if (s.targetAudioId) ids.push(s.targetAudioId)
      if (listenMode.value === 'audit') {
        if (s.knownAudioId) ids.push(s.knownAudioId)
        if (s.explainerAudioId) ids.push(s.explainerAudioId)
        // Stage-0 walk also plays each atom's [atom] target + means-gloss clip —
        // warm those too or the breakdown stutters fetching mid-list.
        const resolved = s.id ? podStage0.resolveSentence(s.id) : null
        for (const a of resolved?.atoms || []) {
          if (a.targetClipId) ids.push(a.targetClipId)
          if (a.meansGlossClipId) ids.push(a.meansGlossClipId)
        }
      }
    }
    return ids
  }
  if (Array.isArray(phrase.audioIds)) return phrase.audioIds.filter(Boolean)
  if (phrase.target1AudioId) ids.push(phrase.target1AudioId)
  return ids
}

const playCurrentPhrase = async (myPlaybackId) => {
  if (myPlaybackId !== playbackId || !isPlaying.value) return

  const phrase = availablePhrases.value[currentIndex.value]
  if (!phrase) {
    await handleEndOfList(myPlaybackId)
    return
  }

  const playQueue = buildPlayQueue(phrase)

  console.log('[ListeningOverlay] Playing phrase:', {
    index: currentIndex.value,
    text: phrase.targetText,
    clips: playQueue.length,
  })

  // Rolling warm-ahead: pull the next few rows into IndexedDB while this
  // one plays, so a locked screen always finds the upcoming clip cached
  // (the lock-safe WAV path) rather than hitting the throttled network
  // mid-list. Covers EVERY clip the current mode needs (multi-sentence
  // turns, translations, explainers) — a single cache miss under lock
  // stalls with frozen rescue timers, so the horizon must stay ahead.
  for (let n = 1; n <= 3; n++) {
    for (const id of audioIdsForWarm(availablePhrases.value[currentIndex.value + n])) warmClip(id)
  }
  // Last turn of a pod scene → warm the NEXT scene's opening clips now,
  // while this turn plays, so the scene segue never waits on the network.
  if (currentIndex.value === availablePhrases.value.length - 1) {
    prefetchNextSceneHead()
  }

  if (myPlaybackId !== playbackId) return

  // Play each audio clip in sequence. Within a turn (same speaker
  // continuing) the gap is as tight as possible — 50ms — so two
  // sentences from one speaker run together as natural continuous
  // speech rather than feeling like two separate utterances. The
  // longer 800ms inter-phrase gap below (between turns) carries the
  // speaker-change pause.
  //
  // BOTH gaps play as silent one-shot clips (playSilence), NOT bare
  // setTimeouts — iOS freezes timers on a backgrounded/locked tab, so a
  // timer-driven gap killed the advance the moment the screen locked.
  // 'ended'-driven silence matches the main flow / INF PLAY / pod-lap
  // protocol (see SimplePlayer's PAUSE phase).
  // Drill's repeats breathe a little (300ms) so the 1×/2×/2× reps read as
  // deliberate practice; Immersion keeps the tight 50ms that joins a
  // speaker's consecutive chunks into natural continuous speech.
  const interClipGap = (view.value === 'pods' && selectedScene.value && (listenMode.value === 'drill' || listenMode.value === 'audit')) ? 300 : 50
  for (let i = 0; i < playQueue.length; i++) {
    if (myPlaybackId !== playbackId) return
    const item = playQueue[i]
    const { id, rate } = item
    // Audit walk: surface which stage/role is sounding right now.
    auditStatus.value = item.stage ? { stage: item.stage, total: item.total, role: item.role, chunk: item.chunk, chunks: item.chunks } : null
    const proxyUrl = getAudioUrl(id)
    if (!proxyUrl) continue
    // Resolve through the SHARED substrate: a cached WAV blob from IndexedDB
    // (lock-screen-safe — real PCM, no network) when present, else the proxy
    // URL (instant first play on a cold cache). Same primitive the main 4-phase
    // cycle plays through (SimplePlayer.resolveAudioUrl) — this is what makes
    // listening survive background/lock, not just the silent gaps.
    const audioUrl = await resolveCachedPlaybackUrl(audioCache, id, proxyUrl)
    if (myPlaybackId !== playbackId) return
    try {
      // Dialogue queues always carry an explicit per-clip rate (Immersion =
      // chosen speed, Drill = 1×/2×/2×), so a Core/All speed never leaks in.
      // Core/All pass rate=null and lean on the controller's rate watch.
      const effectiveRate = (view.value === 'pods' && selectedScene.value) ? (rate ?? 1) : rate
      await audioController.value.play(audioUrl, effectiveRate)
    } catch (err) {
      console.error('[ListeningOverlay] Audio play failed:', err)
    }
    if (i < playQueue.length - 1) {
      await audioController.value.playSilence(interClipGap)
    }
  }

  if (playQueue.length === 0) {
    console.warn('[ListeningOverlay] No audio for phrase, skipping:', phrase.targetText)
  }

  if (myPlaybackId !== playbackId) return

  // Inter-row gap. In a dialogue scene the rows are CHUNKS: keep a speaker's
  // consecutive chunks close (natural continuous speech) and breathe only on
  // a speaker change (the next row starts a new turn). Elsewhere, the steady
  // between-phrases pause. Immersion runs the tightest within-turn gap; Drill
  // gives each phrase a touch more room.
  const nextPhrase = availablePhrases.value[currentIndex.value + 1]
  let trailingGap = 800
  if (view.value === 'pods' && selectedScene.value && nextPhrase && !nextPhrase.isTurnStart) {
    trailingGap = listenMode.value === 'immersion' ? 50 : 350
  }
  await audioController.value.playSilence(trailingGap)

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

  // Dialogues view with a scene selected: loop the scene or auto-advance
  // to the next scene, depending on the loop toggle. Default is auto-
  // advance — the whole pod plays through as a continuous session.
  if (view.value === 'pods' && selectedScene.value && !loopScene.value) {
    const sceneList = pods.scenes.value
    // Match by sceneNumber — PodScene has no `id` field, and the old
    // `s.id === selectedScene.id` compared undefined===undefined, which
    // matched index 0 and made EVERY scene "advance" to scene 2.
    const currentSceneIdx = sceneList.findIndex(s => s.sceneNumber === selectedScene.value.sceneNumber)
    // Single continuous playlist: segue into the next scene; after the
    // last scene, wrap around to the first (Spotify playlist loop).
    const nextScene = currentSceneIdx >= 0
      ? (sceneList[currentSceneIdx + 1] || sceneList[0])
      : null
    if (nextScene && nextScene.sceneNumber !== selectedScene.value.sceneNumber) {
      // openScene resets currentIndex to 0 — but it also calls
      // stopPlayback(), which flips isPlaying off. playCurrentPhrase's
      // first guard returns on !isPlaying, so the segue must re-arm it
      // or every scene boundary silently stops the playlist (the bug
      // behind "doesn't continue through the scenes").
      openScene(nextScene)
      await nextTick()
      isPlaying.value = true
      playbackId += 1
      const newId = playbackId
      scrollCurrentIntoView()
      await playCurrentPhrase(newId)
      return
    }
    // Single-scene pod: fall through to the default loop-this-list
    // behaviour (restart current scene).
  }

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
  auditStatus.value = null
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

const audioCache = getAudioCache()

// Diagnostic event log — same session_id as LearningPlayer's instance
// so a user's actions across the player + overlay land on one timeline.
const { event: logEvent } = usePlayerLog({ courseCode: computed(() => props.courseCode) })

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
  logEvent('tap_listening_download', {
    upToSeed: props.upToSeed ?? null,
    currentState: packState.value,
  })

  if (packState.value === 'downloading') {
    logEvent('listening_pack_skip', { reason: 'already_downloading' })
    return
  }

  let cacheFailures = 0
  try {
    packState.value = 'downloading'
    packDone.value = 0
    packTotal.value = 0

    const ids = await fetchAllAudioIds()
    packTotal.value = ids.length
    logEvent('listening_pack_start', { totalIds: ids.length })

    if (ids.length === 0) {
      packState.value = 'complete'
      try { localStorage.setItem(packKey.value, 'complete') } catch {}
      logEvent('listening_pack_end', { reason: 'no_ids', total: 0, failures: 0 })
      return
    }

    // Filter out already-cached IDs (sync check against AudioCache's
    // in-memory id Set — no IndexedDB round-trip).
    const missing = []
    for (const id of ids) {
      if (audioCache.persistent.has(id)) {
        packDone.value++
      } else {
        missing.push(id)
      }
    }
    logEvent('listening_pack_progress', {
      total: ids.length,
      alreadyCached: ids.length - missing.length,
      toFetch: missing.length,
    })

    // audioCache.persistent.ensure fetches via /api/audio/<id> and stores
    // the blob in IndexedDB ssi-audio-cache-v2. The SW (CacheFirst on
    // /api/audio/*) also caches en route, giving belt-and-braces
    // durability. In-flight de-dupe means multiple ensure() calls for
    // the same id collapse into one fetch.
    for (let i = 0; i < missing.length; i += PACK_CONCURRENCY) {
      if (packState.value !== 'downloading') {
        logEvent('listening_pack_end', { reason: 'cancelled', total: ids.length, failures: cacheFailures, completed: packDone.value })
        return
      }

      const batch = missing.slice(i, i + PACK_CONCURRENCY)
      await Promise.all(batch.map(async (id) => {
        try {
          await audioCache.persistent.ensure(id)
        } catch (err) {
          cacheFailures++
          console.warn('[ListeningOverlay] Failed to cache', id, err)
        } finally {
          packDone.value++
        }
      }))
    }

    packState.value = 'complete'
    try { localStorage.setItem(packKey.value, 'complete') } catch {}
    logEvent('listening_pack_end', {
      reason: 'complete',
      total: ids.length,
      failures: cacheFailures,
    })
  } catch (err) {
    console.error('[ListeningOverlay] Pack download failed:', err)
    packState.value = 'error'
    logEvent('listening_pack_end', {
      reason: 'error',
      message: (err && err.message) || String(err),
      failures: cacheFailures,
    })
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(async () => {
  audioController.value = new ListeningAudioController()
  // Pre-build the LEGO-ordinal lookup so the first phrase batch can use it.
  // If it fails, phrases just render without ordinals — non-fatal.
  await loadLegoOrdinals()
  // Default view is Dialogues (pods) — useListeningPods loads the scene
  // list itself. Phrase data loads lazily when the user taps All.
  if (view.value === 'phrases') loadPhrases()
  else isLoading.value = false
  setupMediaSession()
  document.addEventListener('visibilitychange', handleVisibilityChange)
  // Warm the live pod stage config for the admin audit walk (cached singleton —
  // a fast no-op if the main flow already loaded it this session).
  if (auditAvailable.value) algoConfig.loadConfigs()
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

// Centre the active belt in the belt-jump strip whenever it changes (on
// mount, on belt promotion, on view switch). nextTick so the ref is
// resolved after Vue has rendered the new active pip.
watch(
  [currentBeltIndex, view, beltJumpPoints],
  async () => {
    await nextTick()
    const pip = activeBeltPipEl.value
    if (!pip || typeof pip.scrollIntoView !== 'function') return
    try {
      pip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    } catch {
      // Older Safari quirks — bail silently; the fade-mask still works.
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="listening-overlay" :style="{ '--belt-color': beltColor }" @click="handleOverlayTap">
    <!-- Close button -->
    <button class="close-btn" @click.stop="handleClose">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>

    <!-- Back to scene list — mirrors the close circle at the opposite corner,
         so the top band reads: [back] [tabs] [close]. -->
    <button
      v-if="view === 'pods' && selectedScene"
      class="close-btn back-fab"
      :title="`Back to scenes — ${selectedScene.title}`"
      @click.stop="exitScene"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>

    <!-- Ambient progress — a hairline at the top edge, not a transport bar.
         The scene's position reads like a reading-progress line. -->
    <div v-if="view === 'pods' && selectedScene" class="top-progress" aria-hidden="true">
      <div class="top-progress-fill" :style="{ width: progressPercent + '%' }"></div>
    </div>

    <!-- (Offline download button removed 2026-05-20 — being moved to
         Settings. packState / packPercent / downloadListeningPack are
         retained in <script> for the eventual relocation.) -->

    <!-- Top-level view tabs: Dialogues / Core / All.
         Dialogues = Layer 2 pod scenes for the course (default).
         Core      = every seed sentence in the course.
         All       = every USE phrase the learner has met. -->
    <div class="view-tabs" @click.stop>
      <button
        class="view-tab"
        :class="{ active: view === 'pods' }"
        @click="setView('pods')"
      >Dialogues</button>
      <button
        class="view-tab"
        :class="{ active: view === 'seeds' }"
        @click="setView('seeds')"
      >Core</button>
      <button
        class="view-tab"
        :class="{ active: view === 'phrases' }"
        @click="setView('phrases')"
      >All</button>
    </div>

    <!-- Pods scene-list view (shown when in pods view + no scene selected) -->
    <div
      v-if="view === 'pods' && !selectedScene"
      class="scene-list-wrap"
      @click.stop
    >
      <div v-if="pods.isLoading.value" class="loading">
        <div class="loading-spinner"></div>
        <p>Loading pods...</p>
      </div>
      <div v-else-if="pods.error.value" class="error">
        <p>{{ pods.error.value }}</p>
      </div>
      <div v-else-if="pods.scenes.value.length === 0" class="scene-empty">
        <p>No pods for this course yet.</p>
      </div>
      <div v-else class="scene-list">
        <button
          v-for="scene in pods.scenes.value"
          :key="scene.sceneNumber"
          class="scene-card"
          type="button"
          @click="openScene(scene)"
        >
          <div class="scene-card-num">{{ scene.sceneNumber }}</div>
          <div class="scene-card-body">
            <div class="scene-card-title">{{ scene.title }}</div>
            <div class="scene-card-meta">
              <!-- Cast dots — one per character, in their conversation colour -->
              <span class="scene-card-cast">
                <span
                  v-for="sp in scene.speakers"
                  :key="sp.name"
                  class="scene-cast-dot"
                  :style="{ background: SPEAKER_PALETTE[sp.colorIndex % SPEAKER_PALETTE.length] }"
                  :title="sp.name"
                ></span>
              </span>
              {{ scene.sentenceCount }} sentences
            </div>
          </div>
          <svg class="scene-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Controls bar: shuffle toggle (All + Core) OR back-to-scenes
         (Dialogues + scene open) + transport + speed.
         Hidden in dialogue scene-list state — no data to drive them yet. -->
    <div
      v-if="view === 'phrases' || view === 'seeds' || (view === 'pods' && selectedScene)"
      class="controls-bar"
      :class="{ dialogue: isDialogueScene }"
      @click.stop
    >
      <!-- Leftmost control:
           - All / Core view: Spotify-style shuffle toggle.
           - Dialogues view + scene open: scene back-button (returns to scene list).
           Same slot in the bar — no layout shift between views. -->
      <button
        v-if="view === 'phrases' || view === 'seeds'"
        class="shuffle-toggle"
        :class="{ active: mode === 'shuffled' }"
        :aria-pressed="mode === 'shuffled'"
        :title="mode === 'shuffled' ? 'Shuffled — tap to return to order' : 'Shuffle'"
        @click="setMode(mode === 'shuffled' ? 'ordered' : 'shuffled')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 3 21 3 21 8"/>
          <line x1="4" y1="20" x2="21" y2="3"/>
          <polyline points="21 16 21 21 16 21"/>
          <line x1="15" y1="15" x2="21" y2="21"/>
          <line x1="4" y1="4" x2="9" y2="9"/>
        </svg>
      </button>
      <!-- Dialogue scene: ONE quiet band — loop · modes · eye. The loop and
           eye are bare glyphs (hairlines + type, not circle clusters); the
           back button moved to the top corner; the transport dissolved into
           the ambient hairline + the paused glyph over the teleprompter. -->
      <button
        v-if="view === 'pods' && selectedScene"
        class="edge-glyph"
        :class="{ active: loopScene }"
        type="button"
        :title="loopScene ? 'Repeat this scene — tap to flow into next scenes instead' : 'Flow into next scene — tap to repeat this scene'"
        :aria-pressed="loopScene"
        @click="loopScene = !loopScene"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
      </button>

      <!-- Transport — Core/All only; Dialogue scenes play through the surface
           (tap anywhere) with the hairline carrying progress. -->
      <div v-if="!(view === 'pods' && selectedScene)" class="transport-bar">
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

      <!-- Speed slot — Core/All always shows the interactive selector. In
           Dialogues the slot is ALWAYS present (its own row under the band)
           so the toolbar height never changes between modes: Immersion gets
           the interactive selector; Drill/audit get a quiet, non-interactive
           fixed-pace caption (Drill's pace is fixed at 1×/2×/2×, the audit
           walk follows the live stage config) — which also explains WHY there
           is no speed choice in those modes. -->
      <div v-if="showSpeedRow" class="speed-controls">
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
      <!-- Drill/audit: no speed choice and nothing to show, but we keep an empty
           slot of the same height so switching modes never shifts the layout. -->
      <div
        v-else-if="isDialogueScene"
        class="speed-controls pace-spacer"
        aria-hidden="true"
      ></div>

      <!-- Dialogue listening level: how much help, how much pace. These ARE
           the listening difficulty settings — first-class placement, sharing
           the band with the two quiet glyphs. -->
      <div v-if="view === 'pods' && selectedScene" class="mode-selector">
        <button
          v-for="m in LISTEN_MODES"
          :key="m.key"
          class="mode-btn"
          :class="{ active: listenMode === m.key }"
          :title="m.desc"
          @click="listenMode = m.key"
        >{{ m.label }}</button>
      </div>

      <!-- Gloss eye: show/hide the known-language line under each phrase. -->
      <button
        class="edge-glyph gloss-toggle"
        :class="{ active: showGloss }"
        type="button"
        :title="showGloss ? 'Hide translations' : 'Show translations'"
        :aria-pressed="showGloss"
        @click="showGloss = !showGloss"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
          <line v-if="!showGloss" x1="3" y1="3" x2="21" y2="21"/>
        </svg>
      </button>
    </div>

    <!-- Scene orientation: a whisper of type, not a band — you always know
         where you are without the chrome asserting itself. -->
    <div v-if="view === 'pods' && selectedScene && !isLoading" class="scene-strip" @click.stop>
      {{ selectedScene.title }}
    </div>

    <!-- Audit walk: live stage/role badge so the content team can see which
         of the 9 acquisition stages is sounding as a line walks its arc. -->
    <div
      v-if="listenMode === 'audit' && auditStatus"
      class="audit-badge"
      @click.stop
    >
      <span class="audit-stage">Stage {{ auditStatus.stage }}</span>
      <span class="audit-role">{{ auditStatus.role }}</span>
      <span v-if="auditStatus.chunks > 1" class="audit-chunk">line {{ auditStatus.chunk }}/{{ auditStatus.chunks }}</span>
    </div>

    <!-- Loading State (All / Core only — Dialogues has its own loading) -->
    <div v-if="(view === 'phrases' || view === 'seeds' || selectedScene) && isLoading" class="loading">
      <div class="loading-spinner"></div>
      <p>Loading...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="(view === 'phrases' || view === 'seeds' || selectedScene) && error" class="error" @click.stop>
      <p>{{ error }}</p>
      <button @click="view === 'seeds' ? loadSeeds() : loadPhrases()">Retry</button>
    </div>

    <!-- Belt-jump strip — All / Core views. One pip per belt that has at
         least one row in the inventory. Tap to jump to that belt's first
         row. Active pip is filled; others are outlined. -->
    <div
      v-if="(view === 'phrases' || view === 'seeds') && beltJumpPoints.length > 1"
      ref="beltStripEl"
      class="belt-jump-strip"
      @click.stop
    >
      <button
        v-for="point in beltJumpPoints"
        :key="point.beltIndex"
        :ref="(el) => { if (point.beltIndex === currentBeltIndex) activeBeltPipEl = el }"
        class="belt-jump-pip"
        :class="{ active: point.beltIndex === currentBeltIndex }"
        :style="{ '--pip-color': point.beltColor }"
        :title="`Jump to ${point.beltName} belt`"
        :aria-label="`Jump to ${point.beltName} belt`"
        @click="jumpToBelt(point)"
      >
        <span class="belt-jump-pip-dot"></span>
        <span class="belt-jump-pip-label">{{ point.beltName }}</span>
      </button>
    </div>

    <!-- Teleprompter (All / Core, or Dialogues with a scene selected).
         Standalone v-if so the belt-jump strip above doesn't break the
         chain that loading/error states form. -->
    <div
      v-if="!isLoading && !error && (view === 'phrases' || view === 'seeds' || (view === 'pods' && selectedScene))"
      class="teleprompter"
    >
      <div class="phrase-list">
        <template v-for="(phrase, i) in visiblePhrases" :key="phrase.id">
          <!-- Belt boundary marker: rendered between phrases whose beltIndex
               differs from the previous visible phrase. Only meaningful in
               ordered mode — shuffled would put a header between almost
               every row, which is noise. -->
          <div
            v-if="mode === 'ordered' && shouldShowBeltHeader(i)"
            class="belt-header"
          >
            <span class="belt-pip" :style="{ background: phrase.beltColor }"></span>
            <span class="belt-name">{{ phrase.beltName }}</span>
          </div>

          <div
            class="phrase-row"
            :class="{
              current: phrase.isCurrent,
              past: phrase.isPast,
              future: !phrase.isCurrent && !phrase.isPast
            }"
            @click.stop="handlePhraseClick(phrase.displayIndex)"
          >
            <!-- Small ordinal + belt pip header, anchored top of the row.
                 Tiny, subtle — supplies the "where am I in the course"
                 signal without competing with the phrase text. -->
            <div v-if="phrase.legoOrdinal" class="phrase-meta">
              <span class="phrase-belt-pip" :style="{ background: phrase.beltColor }"></span>
              <span class="phrase-ordinal">#{{ phrase.legoOrdinal }}</span>
            </div>
            <!-- Dialogue speaker chip — the conversation colouring made
                 visible. Same character = same colour across the whole pod;
                 two characters in the same scene never share a colour. -->
            <div v-if="phrase.speakerName" class="phrase-speaker" :style="{ color: phrase.speakerColor }">
              <span class="phrase-speaker-dot" :style="{ background: phrase.speakerColor }"></span>{{ phrase.speakerName }}
            </div>
            <!-- Current dialogue turn: interleave target and gloss sentence
                 by sentence (aligned from per-sentence data + faithful-canon
                 sentence splitting) so long turns stay matchable. Other rows
                 keep the plain paragraph. Gloss honours the eye toggle. -->
            <template v-if="phrase.isCurrent && Array.isArray(phrase.sentences) && phrase.sentences.length">
              <div v-for="(pair, pi) in glossPairsFor(phrase)" :key="pi" class="phrase-pair">
                <div class="phrase-target">{{ pair.target }}</div>
                <div v-if="showGloss && pair.known" class="phrase-known interleaved">{{ pair.known }}</div>
              </div>
            </template>
            <template v-else>
              <div class="phrase-target">{{ phrase.targetText }}</div>
              <div v-if="phrase.isCurrent && showGloss && phrase.knownText" class="phrase-known">{{ phrase.knownText }}</div>
            </template>
          </div>
        </template>
      </div>

      <!-- Play/Pause indicator -->
      <div v-if="!(view === 'pods' && selectedScene)" class="playback-hint" :class="{ playing: isPlaying }">
        <span v-if="isPlaying">Tap to pause</span>
        <span v-else>Tap to play</span>
      </div>

      <!-- Paused state, dialogue scenes: a soft glyph floats over the
           teleprompter — the video-player idiom. While playing there is
           NOTHING: the dialogue owns the screen. Pointer-events none; the
           tap lands on the surface beneath, which toggles playback. -->
      <div v-if="view === 'pods' && selectedScene && !isPlaying" class="paused-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <polygon points="8 5 19 12 8 19 8 5"/>
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Fonts loaded globally in style.css */

.listening-overlay {
  position: fixed;
  inset: 0;
  /* Intentionally BELOW the bottom NavPill (z-index 2900) and BottomNav
   * (z-index 3000) — the nav stays visible during Listening Mode as an
   * escape route so the learner can leave via the normal nav pill as
   * well as the close-X. To prevent the nav from clipping the last item
   * in the scroll area, .scene-list and .phrase-list carry their own
   * bottom padding that clears the nav-pill footprint. */
  z-index: 1000;
  display: flex;
  flex-direction: column;
  /* Near-solid base so the player chrome behind doesn't bleed through.
   * Was 55% — that let the logo, transport bar and bottom nav read
   * straight through, especially in Pods view. Bumped to 98% with a
   * heavier blur so it still feels soft against the journey background
   * but the overlay reads as its own surface. */
  background: color-mix(in srgb, var(--bg-primary) 98%, transparent);
  backdrop-filter: blur(20px) saturate(120%);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
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

/* Controls bar — pushed down to clear the SSi logo */
/* Compact chrome (Tom 2026-06-11: transport + top menu took too much
 * vertical space — long canon-v2 turns need it). One wrapped row: small
 * buttons + transport share the first line; speed + mode wrap under it. */
.controls-bar {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.5rem;
  padding: 3.1rem 1rem 0.35rem;
  cursor: default;
}

/* Shuffle toggle — Spotify-style single button.
 * Inactive: outlined, neutral. Active (shuffled): filled with the belt
 * colour, easy to spot at a glance. */
.shuffle-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-medium);
  border-radius: 50%;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.shuffle-toggle:hover {
  background: var(--pill-bg-hover);
  color: var(--text-secondary);
}

.shuffle-toggle.active {
  background: var(--belt-color, var(--text-primary));
  border-color: var(--belt-color, var(--text-primary));
  color: white;
}

.shuffle-toggle svg {
  width: 16px;
  height: 16px;
}

/* Speed Controls */
.speed-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Dialogue listening-level selector — an iOS-style segmented control sharing
 * row 1 with the two quiet glyphs (loop · modes · eye). These are THE
 * difficulty settings for listening, so they get first-class placement.
 * Active = ink pill, matching the view tabs — a belt-colour fill is invisible
 * on white belt. The crisp track + padded inset makes the two states read
 * unmistakably as a toggle. */
/* Segmented control. The active fill lives ON THE BUTTON itself (no separate
 * thumb layer). An earlier "sliding thumb" used position:absolute + transform,
 * which on iOS Safari painted BEHIND its siblings inside the overlay's
 * backdrop-filtered ancestor — the dark fill rendered but was obscured by the
 * white track ("black threatens from behind"). A solid background on the button
 * box can't be painted behind anything, so the selected state is reliable. */
.mode-selector {
  display: flex;
  /* Sit at content width, centred between the loop glyph and the gloss eye —
   * NOT full-width (it looked absurd stretched edge-to-edge on desktop). Caps
   * at a sensible pill-group width; still shrinks on narrow screens. */
  flex: 0 1 auto;
  max-width: 24rem;
  margin-inline: auto;
  min-width: 0;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--border-medium);
  border-radius: 999px;
  background: var(--bg-elevated);
}

.mode-btn {
  flex: 1;
  min-width: 5.5rem;             /* a comfortable readable pill, not a stretched bar */
  padding: 6px 4px;
  background: transparent;
  border: 0;
  border-radius: 999px;
  /* Inactive reads as tappable, not disabled — secondary ink, not muted. */
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.mode-btn:hover:not(.active) {
  color: var(--text-primary);
}

/* Active = solid dark fill on the button itself + white text. Explicit ink
 * (not a theme var) so it can never resolve light. */
.mode-btn.active {
  background: #2C2622;
  color: #ffffff;
  font-weight: 600;
}

.speed-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
}

/* Dialogue toolbar: a STABLE two-row band. Row 1 = loop · mode-selector · eye
 * (forced by reserving a full-width row 2 for the speed/pace slot). The speed
 * slot is always present in a scene — interactive in Immersion, a quiet
 * fixed-pace caption in Drill/audit — so switching modes never reflows the
 * band: the Immersion/Drill toggle stays put and the toolbar height is
 * constant (no jump, no play-button overlap). Core/All is untouched. */
.controls-bar.dialogue .speed-controls {
  order: 2;
  flex-basis: 100%;
  justify-content: center;
  min-height: 30px;
}

/* Drill/audit: an empty slot that only reserves the row's height, so switching
 * modes never shifts the layout (nothing is shown under Drill). */

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
  font-size: 1.25rem;
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

/* The current row dominates — significantly bigger than its neighbours
 * so the eye lands on it as the focal point. */
.phrase-row.current .phrase-target {
  font-size: clamp(1.75rem, 5vmin, 2.25rem);
  font-weight: 600;
  color: var(--text-primary);
}

.phrase-known {
  font-size: 1rem;
  color: var(--text-secondary);
  margin-top: 0.5rem;
  font-style: italic;
}

/* Dialogue speaker chip — the conversation colouring made visible. Small
 * caps name in the character's colour with a matching dot, sitting above
 * the line like a script cue. Past/future rows inherit the row's reduced
 * opacity, so the colour stays quiet until the line is live. */
.phrase-speaker {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin-bottom: 0.3rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.phrase-speaker-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Per-row meta header (ordinal + belt pip). Subtle, tiny, sits above the
 * phrase target. Doesn't compete with the phrase text. */
.phrase-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin-bottom: 0.25rem;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  opacity: 0.65;
}

.phrase-row.current .phrase-meta {
  opacity: 0.85;
}

.phrase-belt-pip {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.25);
  flex-shrink: 0;
}

.phrase-ordinal {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

/* Belt section divider — appears within the visible window when a belt
 * boundary falls between two phrases (ordered mode only). */
.belt-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin: 0.5rem 0 0.25rem;
  padding: 0.4rem 0.85rem;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-muted);
  opacity: 0.7;
}

.belt-header .belt-pip {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.3);
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
  gap: 0.6rem;
  flex: 1 1 180px;
  min-width: 160px;
}

.transport-btn {
  width: 34px;
  height: 34px;
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

/* ═══════════════════════════════════════════════════════════════
 * VIEW TABS — Phrases / Pods
 * ═══════════════════════════════════════════════════════════════ */
.view-tabs {
  position: absolute;
  /* Same safe-area pattern as .close-btn / .download-btn — absolutely
   * positioned children ignore the parent's safe-area padding, so the
   * notch/Dynamic Island ate the tabs on iOS PWA. */
  top: calc(env(safe-area-inset-top, 0px) + 0.6rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  gap: 0.2rem;
  padding: 0.2rem;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid var(--border-medium);
  border-radius: 999px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.view-tab {
  padding: 0.35rem 1rem;
  background: transparent;
  border: 0;
  border-radius: 999px;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}

.view-tab:hover:not(.active) {
  color: var(--text-secondary);
}

.view-tab.active {
  background: var(--text-primary);
  color: var(--bg-primary, #ffffff);
  font-weight: 600;
}

/* ═══════════════════════════════════════════════════════════════
 * SCENE LIST (Pods view, no scene selected)
 * ═══════════════════════════════════════════════════════════════ */
.scene-list-wrap {
  /* Scrollable region — without this, long pods (>~6 scenes) just clip
   * past the viewport and the bottom scenes get painted over by the
   * nav-pill (which stays visible during Listening Mode as an escape
   * route). Now scrolls independently; .scene-list's padding-bottom
   * gives the last scene clearance above the nav pill. */
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 600px;
  margin: 4.5rem auto 0;
  padding: 0 1rem;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.scene-list-wrap::-webkit-scrollbar { display: none; }

.scene-list {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  /* Clear the nav-pill footprint (~60px tall, sits 12px + safe-area
   * from the viewport bottom). 110px is a comfortable buffer that
   * holds across iPhone notch heights without leaving an awkward gap
   * when the pod has only a few scenes. */
  padding-bottom: 110px;
}

.scene-empty {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--text-muted);
}

.scene-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
  padding: 1rem 1.1rem;
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.18);
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.06);
}

.scene-card:hover {
  background: var(--bg-card-hover, #ffffff);
  border-color: rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(44, 38, 34, 0.08);
}

.scene-card:active {
  transform: translateY(0);
}

.scene-card-num {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--belt-color, var(--text-primary));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
}

.scene-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.scene-card-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scene-card-meta {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

/* Cast dots — one per character in the scene, in their conversation
 * colour (matches the speaker chips inside the teleprompter). */
.scene-card-cast {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.scene-cast-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.scene-card-arrow {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  color: var(--text-muted);
}

/* ═══════════════════════════════════════════════════════════════
 * BELT JUMP STRIP — Phrases view, lets you jump to any belt's first
 * phrase. Sits between the controls bar and the teleprompter, scrolls
 * horizontally on narrow screens.
 * ═══════════════════════════════════════════════════════════════ */
.belt-jump-strip {
  display: flex;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem 0.25rem;
  overflow-x: auto;
  scrollbar-width: none;
  /* Soft edge fade — signals "more content scrolls off this side" so the
   * White (start) and Black (end) belts aren't quietly clipped on narrow
   * viewports. Fades only the outer ~6% of the strip; the active belt
   * always renders fully because we scrollIntoView it on mount + change. */
  -webkit-mask-image: linear-gradient(to right, transparent, black 6%, black 94%, transparent);
          mask-image: linear-gradient(to right, transparent, black 6%, black 94%, transparent);
  scroll-behavior: smooth;
}

.belt-jump-strip::-webkit-scrollbar {
  display: none;
}

.belt-jump-pip {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.65rem;
  background: transparent;
  border: 1px solid var(--border-medium);
  border-radius: 999px;
  font-family: inherit;
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.belt-jump-pip:hover {
  border-color: var(--pip-color);
  color: var(--text-secondary);
}

.belt-jump-pip.active {
  background: var(--pip-color);
  border-color: var(--pip-color);
  color: white;
  font-weight: 600;
}

.belt-jump-pip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--pip-color);
  border: 1px solid rgba(0, 0, 0, 0.25);
  flex-shrink: 0;
}

.belt-jump-pip.active .belt-jump-pip-dot {
  background: white;
  border-color: rgba(255, 255, 255, 0.6);
}

.belt-jump-pip-label {
  text-transform: capitalize;
}

/* (Back-to-scenes moved to the top corner — see .back-fab.) */

/* Bare glyphs — hairlines and type, never circle clusters. A 40px hit
 * area around an 18px mark; state is colour, not chrome. */
.edge-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  background: transparent;
  border: 0;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.2s ease, opacity 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
  opacity: 0.65;
}

.edge-glyph:hover {
  color: var(--text-secondary);
  opacity: 1;
}

.edge-glyph.active {
  color: var(--text-primary);
  opacity: 1;
}

/* The gloss eye reads "on" as present-but-quiet and "off" as struck-through
 * and faded — it's a passive setting, it must never shout. */
.gloss-toggle:not(.active) {
  opacity: 0.45;
}

.edge-glyph svg {
  width: 18px;
  height: 18px;
}

/* Back to scenes — mirrors the close circle at the opposite corner. */
.back-fab {
  right: auto;
  left: 16px;
}

/* Ambient progress — a 2px reading line at the very top edge. Ink at low
 * opacity; it informs without performing. */
.top-progress {
  position: absolute;
  top: env(safe-area-inset-top, 0px);
  left: 0;
  right: 0;
  height: 2px;
  z-index: 11;
  background: transparent;
  pointer-events: none;
}

.top-progress-fill {
  height: 100%;
  background: var(--text-primary);
  opacity: 0.35;
  transition: width 0.6s ease;
}

/* Scene orientation — a whisper of mono caps under the controls. */
.scene-strip {
  text-align: center;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  opacity: 0.8;
  padding: 0.15rem 1rem 0.3rem;
  cursor: default;
}

/* Audit walk badge — admin-only. Mono caps, sits under the scene strip and
 * tracks the live stage/role as a line walks its 1→9 arc. Deliberately plain
 * (a dev/QA readout, not learner chrome). */
.audit-badge {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 0.1rem 1rem 0.35rem;
  cursor: default;
}
.audit-badge .audit-stage { color: var(--belt-accent, var(--text-primary)); }
.audit-badge .audit-role { color: var(--text-muted); }
.audit-badge .audit-chunk { color: var(--text-muted); opacity: 0.8; }

/* Paused glyph — the surface IS the transport. Soft elevated disc, ink
 * triangle, floats over the teleprompter only while paused; playing shows
 * nothing. Taps pass through to the tap-anywhere toggle beneath. */
.paused-glyph {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bg-elevated, #ffffff) 88%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid var(--border-medium);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.10);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
  pointer-events: none;
  z-index: 1500;
  animation: paused-glyph-in 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

.paused-glyph svg {
  width: 30px;
  height: 30px;
  margin-left: 3px; /* optical centring of the triangle */
}

@keyframes paused-glyph-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

/* Interleaved gloss pairs — one sentence + its translation, matchable at
 * a glance even on the long canon-v2 monologue turns. */
.phrase-pair {
  margin-bottom: 0.45rem;
}
.phrase-pair:last-child {
  margin-bottom: 0;
}
.phrase-known.interleaved {
  margin-top: 0.1rem;
}
</style>
