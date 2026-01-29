/**
 * useSessionPlayback - Bridge composable for SessionController integration
 *
 * Wraps SessionController and exposes an interface compatible with
 * LearningPlayer.vue's existing state management.
 *
 * This composable handles:
 * - Data loading from CourseDataProvider
 * - Converting SessionController state to LearningPlayer format
 * - Event forwarding for UI reactions
 */

import { ref, computed, watch, onUnmounted, type Ref, type ComputedRef } from 'vue'
import type { LegoPair, SeedPair, ClassifiedBasket } from '@ssi/core'
import type { LearningItem, CourseDataProvider } from '../providers/CourseDataProvider'
import {
  createSessionController,
  createPriorityRoundLoader,
  type SessionController,
  type SessionState,
  type SessionEventHandler,
  type Round,
  type RoundTemplate,
  type CyclePhase,
  type GetAudioSourceFn,
  type ResumePoint,
  type PlaybackConfig,
  type Belt,
  type LoaderProgress,
  PriorityRoundLoader,
  BELT_THRESHOLDS,
} from '../playback'
import type { Cycle } from '../types/Cycle'
import { buildRound } from '../playback/RoundBuilder'
import { scriptItemToCycle } from '../utils/scriptItemToCycle'
import { applyConfig, type RoundItem } from '../playback/types'

// ============================================
// Types for LearningPlayer compatibility
// ============================================

export interface SessionPlaybackOptions {
  /** Course data provider for loading LEGOs, Seeds, Baskets */
  courseDataProvider: Ref<CourseDataProvider | null>
  /** Audio base URL for building audio URLs */
  audioBaseUrl?: string
}

export interface SessionPlaybackState {
  /** Session is initialized and ready */
  isInitialized: boolean
  /** Current session state */
  sessionState: SessionState
  /** Is currently playing */
  isPlaying: boolean
  /** Current cycle phase */
  currentPhase: CyclePhase
  /** Error message if any */
  error: string | null
}

// Cycle event types for UI compatibility
export type CycleEventType =
  | 'cycle_started'
  | 'cycle_completed'
  | 'phase_changed'

export interface CycleEvent {
  type: CycleEventType
  data: {
    item?: any
    phase?: string
    cycle?: Cycle
  }
}

export type CycleEventHandler = (event: CycleEvent) => void

// Session event types
export type SessionEventType =
  | 'session_started'
  | 'session_paused'
  | 'session_resumed'
  | 'session_complete'
  | 'round_started'
  | 'round_completed'
  | 'item_started'
  | 'item_completed'

export interface SessionEvent {
  type: SessionEventType
  data: any
}

export type SessionEventHandlerFn = (event: SessionEvent) => void

// ============================================
// Composable Implementation
// ============================================

export function useSessionPlayback(options: SessionPlaybackOptions) {
  const sessionController = createSessionController()

  // Internal state
  const isInitialized = ref(false)
  const courseId = ref('')
  const legos = ref<LegoPair[]>([])
  const seeds = ref<SeedPair[]>([])
  const baskets = ref<Map<string, ClassifiedBasket>>(new Map())

  // Background loader
  let priorityLoader: PriorityRoundLoader | null = null
  const loaderProgress = ref<LoaderProgress | null>(null)
  const isBackgroundLoading = ref(false)

  // Event handlers
  const cycleEventHandlers = new Set<CycleEventHandler>()
  const sessionEventHandlers = new Set<SessionEventHandlerFn>()
  const roundReadyHandlers = new Set<(index: number, round: RoundTemplate) => void>()
  const beltReadyHandlers = new Set<(belt: Belt) => void>()

  // ============================================
  // Computed state for LearningPlayer compatibility
  // ============================================

  /**
   * Cached rounds in LearningPlayer's expected format
   * Maps RoundTemplate to Round by stripping the cycle property
   */
  const cachedRounds = computed<Round[]>(() => {
    // Get rounds from SessionController and convert to Round format
    // (RoundTemplate items have cycle property, Round items don't)
    const templates = getRoundsFromController()
    return templates.map(roundTemplateToRound)
  })

  /**
   * Current round index (0-based)
   */
  const currentRoundIndex = computed(() => {
    return sessionController.progress.value.roundNumber - 1
  })

  /**
   * Current item index within the round (0-based)
   */
  const currentItemInRound = computed(() => {
    return sessionController.currentItemIndex.value
  })

  /**
   * Whether playback is active
   */
  const isPlaying = computed(() => {
    return sessionController.state.value === 'playing'
  })

  /**
   * Current cycle phase for UI display
   */
  const currentPhase = computed<CyclePhase>(() => {
    return sessionController.cyclePlayer.state.value.phase
  })

  /**
   * Current round (or null if not loaded)
   */
  const currentRound = computed(() => {
    return sessionController.currentRound.value
  })

  /**
   * Current cycle being played
   */
  const currentCycle = computed<Cycle | null>(() => {
    const round = currentRound.value
    if (!round) return null
    const item = round.items[currentItemInRound.value]
    return item?.cycle ?? null
  })

  /**
   * Session progress
   */
  const progress = computed(() => sessionController.progress.value)

  /**
   * Playback configuration
   */
  const config = computed(() => sessionController.config.value)

  // ============================================
  // Helper functions
  // ============================================

  /**
   * Get rounds from SessionController (internal accessor)
   */
  function getRoundsFromController(): RoundTemplate[] {
    // Access internal rounds through currentRound iteration
    // Since SessionController doesn't expose rounds directly,
    // we need to track them during initialization
    return internalRounds.value
  }

  // Internal storage for rounds (since SessionController doesn't expose them directly)
  const internalRounds = ref<RoundTemplate[]>([])

  /**
   * Convert RoundTemplate to Round (strips cycle property from items)
   */
  function roundTemplateToRound(template: RoundTemplate): Round {
    return {
      roundNumber: template.roundNumber,
      legoId: template.legoId,
      legoIndex: template.legoIndex,
      seedId: template.seedId,
      spacedRepReviews: template.spacedRepReviews,
      items: template.items.map(item => {
        // Extract ScriptItem properties (everything except cycle and playable)
        const { cycle, playable, ...scriptItem } = item
        return scriptItem
      }),
    }
  }

  /**
   * Convert CourseDataProvider's LearningItem.lego to @ssi/core LegoPair
   */
  function convertToLegoPair(lego: LearningItem['lego']): LegoPair {
    return {
      id: lego.id,
      type: lego.type as 'A' | 'M',
      new: lego.new,
      lego: lego.lego,
      audioRefs: {
        known: { id: lego.audioRefs.known.id, url: lego.audioRefs.known.url },
        target: {
          voice1: { id: lego.audioRefs.target.voice1.id, url: lego.audioRefs.target.voice1.url },
          voice2: { id: lego.audioRefs.target.voice2.id, url: lego.audioRefs.target.voice2.url },
        },
      },
    }
  }

  /**
   * Extract unique seeds from LearningItems and convert to SeedPair
   */
  function extractSeedsFromLearningItems(items: LearningItem[]): SeedPair[] {
    const seedMap = new Map<string, { seed_id: string; legos: LegoPair[]; seed_pair: { known: string; target: string } }>()

    for (const item of items) {
      const seedData = item.seed
      if (!seedData) continue

      if (!seedMap.has(seedData.seed_id)) {
        seedMap.set(seedData.seed_id, {
          seed_id: seedData.seed_id,
          seed_pair: seedData.seed_pair,
          legos: [],
        })
      }

      // Add this LEGO to the seed's legos array
      const seed = seedMap.get(seedData.seed_id)!
      const legoPair = convertToLegoPair(item.lego)
      if (!seed.legos.some(l => l.id === legoPair.id)) {
        seed.legos.push(legoPair)
      }
    }

    return Array.from(seedMap.values())
  }

  /**
   * Extract LEGOs from LearningItems and convert to LegoPair
   */
  function extractLegosFromLearningItems(items: LearningItem[]): LegoPair[] {
    const legoMap = new Map<string, LegoPair>()

    for (const item of items) {
      if (item.lego && !legoMap.has(item.lego.id)) {
        legoMap.set(item.lego.id, convertToLegoPair(item.lego))
      }
    }

    return Array.from(legoMap.values())
  }

  // ============================================
  // Lifecycle methods
  // ============================================

  /**
   * Initialize the session with course data
   *
   * FAST PATH: Loads only the first round for instant startup (<2s)
   * BACKGROUND: PriorityRoundLoader loads remaining rounds based on user intent
   */
  async function initialize(
    courseCode: string,
    resumePoint?: ResumePoint
  ): Promise<void> {
    const provider = options.courseDataProvider.value
    if (!provider) {
      throw new Error('No course data provider available')
    }

    const startTime = performance.now()
    courseId.value = courseCode

    try {
      const startSeed = resumePoint?.seedNumber ?? resumePoint?.roundNumber ?? 1
      // console.log(`[useSessionPlayback] Fast init for seed ${startSeed}...`)

      // ============================================
      // FAST PATH: Load only what's needed for instant play
      // ============================================

      // 1. Load the first LEGO (BLOCKING - this is the only blocking call)
      const firstItem = await provider.loadLegoAtPosition(startSeed)
      if (!firstItem) {
        throw new Error(`No LEGO found at seed position ${startSeed}`)
      }

      // 2. Convert to LegoPair
      const firstLego = convertToLegoPair(firstItem.lego)
      legos.value = [firstLego]

      // 3. Create SeedPair
      const firstSeed = createSeedPairFromItem(firstItem, firstLego)
      seeds.value = [firstSeed]

      // 4. Load basket for the first LEGO
      const firstBasket = await provider.getLegoBasket(firstLego.id, firstLego)
      baskets.value = new Map()
      if (firstBasket) {
        baskets.value.set(firstLego.id, firstBasket)
      }

      // 5. Load introduction audio for the first LEGO
      const introAudio = await provider.getIntroductionAudio(firstLego.id)
      if (introAudio && firstBasket) {
        firstBasket.introduction_audio = {
          id: introAudio.id,
          url: introAudio.url,
          duration_ms: introAudio.duration_ms,
        }
      }

      // 6. Build the first round
      const firstRound = buildFirstRound(firstLego, firstSeed, firstBasket, startSeed)

      // 6. Initialize SessionController with empty state
      sessionController.initializeEmpty(courseCode, resumePoint)

      // 7. Add the first round
      sessionController.addRound(firstRound)

      // Update internal rounds ref
      internalRounds.value = sessionController.rounds.value

      // READY TO PLAY!
      isInitialized.value = true
      const initTime = performance.now() - startTime
      // console.log(`[useSessionPlayback] Ready to play in ${initTime.toFixed(0)}ms`)

      // ============================================
      // BACKGROUND: Start priority-based loading
      // ============================================

      startBackgroundLoading(courseCode, startSeed, provider)

    } catch (err) {
      // console.error('[useSessionPlayback] Initialization error:', err)
      throw err
    }
  }

  /**
   * Build the first round for instant startup
   */
  function buildFirstRound(
    lego: LegoPair,
    seed: SeedPair,
    basket: ClassifiedBasket | null,
    seedNumber: number
  ): RoundTemplate {
    const buildAudioUrl = (audioId: string): string => `/api/audio/${audioId}`

    const round = buildRound({
      lego,
      seed,
      basket,
      legoIndex: seedNumber,
      roundNumber: seedNumber,
      config: sessionController.config.value,
      buildAudioUrl,
      // No spaced rep for first round
    })

    // Convert Round to RoundTemplate
    const roundTemplate: RoundTemplate = {
      roundNumber: round.roundNumber,
      legoId: round.legoId,
      legoIndex: round.legoIndex,
      seedId: round.seedId,
      spacedRepReviews: round.spacedRepReviews,
      items: round.items.map((item): RoundItem => ({
        ...item,
        cycle: item.type !== 'intro' ? scriptItemToCycle(item) : null,
        playable: true,
      })),
    }

    return applyConfig(roundTemplate, sessionController.config.value)
  }

  /**
   * Create SeedPair from LearningItem
   */
  function createSeedPairFromItem(item: LearningItem, lego: LegoPair): SeedPair {
    return {
      seed_id: item.seed.seed_id,
      seed_pair: item.seed.seed_pair,
      legos: [lego],
    }
  }

  /**
   * Start background loading with priority queue
   */
  function startBackgroundLoading(
    courseCode: string,
    startSeed: number,
    provider: CourseDataProvider
  ): void {
    // Clean up any existing loader
    if (priorityLoader) {
      priorityLoader.dispose()
    }

    // Create new loader
    priorityLoader = createPriorityRoundLoader({
      provider,
      sessionController,
      currentSeed: startSeed,
      config: sessionController.config.value,
      totalLegos: 1000,  // Will be refined as we learn course size
    })

    // Forward events
    priorityLoader.onRoundReady((index, round) => {
      loaderProgress.value = priorityLoader?.getProgress() ?? null
      internalRounds.value = sessionController.rounds.value

      // Forward to external handlers
      for (const handler of roundReadyHandlers) {
        try {
          handler(index, round)
        } catch (e) {
          // console.error('[useSessionPlayback] Round ready handler error:', e)
        }
      }
    })

    priorityLoader.onBeltReady((belt) => {
      loaderProgress.value = priorityLoader?.getProgress() ?? null

      // Forward to external handlers
      for (const handler of beltReadyHandlers) {
        try {
          handler(belt)
        } catch (e) {
          // console.error('[useSessionPlayback] Belt ready handler error:', e)
        }
      }
    })

    priorityLoader.onError((error, seedNumber) => {
      // Errors are logged and deduplicated by PriorityRoundLoader
      // Don't re-log here - just continue loading other seeds
    })

    // Start loading
    isBackgroundLoading.value = true
    priorityLoader.start()

    // console.log('[useSessionPlayback] Background loading started')
  }

  /**
   * Rebuild internal rounds from SessionController state
   */
  function rebuildInternalRounds(): void {
    internalRounds.value = sessionController.rounds.value
  }

  /**
   * Start playback
   */
  function start(getAudioSource: GetAudioSourceFn): void {
    if (!isInitialized.value) {
      // console.warn('[useSessionPlayback] Cannot start - not initialized')
      return
    }
    sessionController.start(getAudioSource)
  }

  /**
   * Pause playback
   */
  function pause(): void {
    sessionController.pause()
  }

  /**
   * Resume playback
   */
  function resume(): void {
    sessionController.resume()
  }

  /**
   * Stop playback
   */
  function stop(): void {
    sessionController.stop()
  }

  /**
   * Skip current cycle
   */
  function skipCycle(): void {
    sessionController.skipCycle()
  }

  /**
   * Skip current round
   */
  function skipRound(): void {
    sessionController.skipRound()
  }

  /**
   * Jump to a specific round
   * Handles belt skip scenario where round may not be loaded yet
   */
  async function jumpToRound(roundNumber: number): Promise<void> {
    // Check if round is loaded
    if (sessionController.hasRound(roundNumber)) {
      sessionController.jumpToRound(roundNumber)
      return
    }

    // Round not loaded - prioritize loading it
    if (priorityLoader) {
      // console.log(`[useSessionPlayback] Round ${roundNumber + 1} not loaded, prioritizing...`)
      const round = await priorityLoader.prioritize(roundNumber + 1)  // Convert to seed number
      if (round) {
        sessionController.jumpToRound(roundNumber)
      }
    }
  }

  /**
   * Jump to a specific seed number (1-based)
   * Handles lazy loading - if round not ready, loads it first
   * Used by belt skip, go back, and modal skip operations
   */
  async function jumpToSeed(seedNumber: number): Promise<void> {
    // Clamp to valid range (seeds are 1-based)
    const targetSeed = Math.max(1, seedNumber)
    const roundIndex = targetSeed - 1  // Convert to 0-based array index

    console.log(`[useSessionPlayback] jumpToSeed(${seedNumber}) → roundIndex ${roundIndex}`)

    // Check if round is loaded
    if (sessionController.hasRound(roundIndex)) {
      sessionController.jumpToRound(roundIndex)
      return
    }

    // Round not loaded - prioritize loading it
    if (priorityLoader) {
      console.log(`[useSessionPlayback] Seed ${targetSeed} not loaded, prioritizing...`)
      const round = await priorityLoader.prioritize(targetSeed)
      if (round) {
        sessionController.jumpToRound(roundIndex)
      } else {
        console.warn(`[useSessionPlayback] Failed to load seed ${targetSeed}`)
      }
    }
  }

  /**
   * Skip to the start of the next belt
   * Used for belt skip functionality
   */
  async function skipToBelt(beltIndex: number): Promise<void> {
    const targetSeed = BELT_THRESHOLDS[beltIndex] || BELT_THRESHOLDS[0]
    await jumpToSeed(Math.max(1, targetSeed))  // Ensure at least seed 1
  }

  /**
   * Update playback configuration
   */
  function setConfig(newConfig: Partial<PlaybackConfig>): void {
    sessionController.setConfig(newConfig)
  }

  // ============================================
  // Event handling
  // ============================================

  /**
   * Subscribe to cycle events
   */
  function onCycleEvent(handler: CycleEventHandler): () => void {
    cycleEventHandlers.add(handler)
    return () => cycleEventHandlers.delete(handler)
  }

  /**
   * Subscribe to session events
   */
  function onSessionEvent(handler: SessionEventHandlerFn): () => void {
    sessionEventHandlers.add(handler)
    return () => sessionEventHandlers.delete(handler)
  }

  /**
   * Subscribe to round ready events (from background loading)
   */
  function onRoundReady(handler: (index: number, round: RoundTemplate) => void): () => void {
    roundReadyHandlers.add(handler)
    return () => roundReadyHandlers.delete(handler)
  }

  /**
   * Subscribe to belt ready events (from background loading)
   */
  function onBeltReady(handler: (belt: Belt) => void): () => void {
    beltReadyHandlers.add(handler)
    return () => beltReadyHandlers.delete(handler)
  }

  /**
   * Forward SessionController events to UI handlers
   */
  const sessionEventHandler: SessionEventHandler = (event) => {
    // Map session events to LearningPlayer format
    const mappedEvent: SessionEvent = {
      type: mapSessionEventType(event.type),
      data: event,
    }

    for (const handler of sessionEventHandlers) {
      try {
        handler(mappedEvent)
      } catch (err) {
        // console.error('[useSessionPlayback] Session event handler error:', err)
      }
    }

    // Also emit cycle events for item transitions
    if (event.type === 'item:started') {
      emitCycleEvent('cycle_started', { item: event.item })
    } else if (event.type === 'item:completed') {
      emitCycleEvent('cycle_completed', { item: event.item })
    }
  }

  /**
   * Map SessionController event types to our event types
   */
  function mapSessionEventType(type: string): SessionEventType {
    const mapping: Record<string, SessionEventType> = {
      'session:started': 'session_started',
      'session:paused': 'session_paused',
      'session:resumed': 'session_resumed',
      'session:complete': 'session_complete',
      'round:started': 'round_started',
      'round:completed': 'round_completed',
      'item:started': 'item_started',
      'item:completed': 'item_completed',
    }
    return mapping[type] || 'item_completed'
  }

  /**
   * Emit a cycle event to all handlers
   */
  function emitCycleEvent(type: CycleEventType, data: any): void {
    const event: CycleEvent = { type, data }
    for (const handler of cycleEventHandlers) {
      try {
        handler(event)
      } catch (err) {
        // console.error('[useSessionPlayback] Cycle event handler error:', err)
      }
    }
  }

  // Subscribe to SessionController events
  sessionController.on(sessionEventHandler)

  // Watch CyclePlayer phase changes and emit events
  watch(
    () => sessionController.cyclePlayer.state.value.phase,
    (newPhase, oldPhase) => {
      if (newPhase !== oldPhase) {
        emitCycleEvent('phase_changed', {
          phase: mapPhaseToLearningPlayer(newPhase),
          cycle: currentCycle.value,
        })
      }
    }
  )

  /**
   * Map CyclePlayer phase to LearningPlayer phase names
   */
  function mapPhaseToLearningPlayer(phase: CyclePhase): string {
    const mapping: Record<CyclePhase, string> = {
      'idle': 'IDLE',
      'prompt': 'PROMPT',
      'pause': 'PAUSE',
      'voice1': 'VOICE_1',
      'voice2': 'VOICE_2',
    }
    return mapping[phase] || 'IDLE'
  }

  // ============================================
  // Cleanup
  // ============================================

  function dispose(): void {
    // Stop background loading
    if (priorityLoader) {
      priorityLoader.dispose()
      priorityLoader = null
    }
    isBackgroundLoading.value = false

    sessionController.off(sessionEventHandler)
    sessionController.dispose()
    cycleEventHandlers.clear()
    sessionEventHandlers.clear()
    roundReadyHandlers.clear()
    beltReadyHandlers.clear()
  }

  onUnmounted(() => {
    dispose()
  })

  // ============================================
  // Return public interface
  // ============================================

  return {
    // State (matches LearningPlayer expectations)
    cachedRounds,
    currentRoundIndex,
    currentItemInRound,
    isPlaying,
    currentPhase,
    currentRound,
    currentCycle,
    progress,
    config,
    isInitialized: computed(() => isInitialized.value),

    // Background loading state
    loaderProgress,
    isBackgroundLoading: computed(() => isBackgroundLoading.value),

    // Methods
    initialize,
    start,
    pause,
    resume,
    stop,
    skipCycle,
    skipRound,
    jumpToRound,
    jumpToSeed,
    skipToBelt,
    setConfig,

    // Event subscriptions
    onCycleEvent,
    onSessionEvent,
    onRoundReady,
    onBeltReady,

    // Direct access for advanced usage
    sessionController,

    // Cleanup
    dispose,
  }
}
