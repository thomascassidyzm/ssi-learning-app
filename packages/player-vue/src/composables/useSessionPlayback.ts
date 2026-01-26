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
  type SessionController,
  type SessionState,
  type SessionEventHandler,
  type Round,
  type RoundTemplate,
  type CyclePhase,
  type GetAudioSourceFn,
  type ResumePoint,
  type PlaybackConfig,
} from '../playback'
import type { Cycle } from '../types/Cycle'

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

  // Event handlers
  const cycleEventHandlers = new Set<CycleEventHandler>()
  const sessionEventHandlers = new Set<SessionEventHandlerFn>()

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
   */
  async function initialize(
    courseCode: string,
    resumePoint?: ResumePoint
  ): Promise<void> {
    const provider = options.courseDataProvider.value
    if (!provider) {
      throw new Error('No course data provider available')
    }

    courseId.value = courseCode

    try {
      // 1. Load all LEGOs from the course
      console.log('[useSessionPlayback] Loading LEGOs...')
      const learningItems = await provider.loadAllUniqueLegos(1000, 0)

      // 2. Extract LEGOs and Seeds from LearningItems
      legos.value = extractLegosFromLearningItems(learningItems)
      console.log(`[useSessionPlayback] Loaded ${legos.value.length} LEGOs`)

      seeds.value = extractSeedsFromLearningItems(learningItems)
      console.log(`[useSessionPlayback] Extracted ${seeds.value.length} seeds`)

      // 3. Load baskets for each LEGO
      console.log('[useSessionPlayback] Loading baskets...')
      const basketMap = new Map<string, ClassifiedBasket>()
      for (const lego of legos.value) {
        const basket = await provider.getLegoBasket(lego.id, lego)
        if (basket) {
          basketMap.set(lego.id, basket)
        }
      }
      baskets.value = basketMap
      console.log(`[useSessionPlayback] Loaded ${basketMap.size} baskets`)

      // 4. Initialize SessionController
      await sessionController.initialize(
        legos.value,
        seeds.value,
        baskets.value,
        courseCode,
        resumePoint
      )

      // 5. Store rounds internally for cachedRounds computed
      // We need to rebuild the rounds to access them
      // (SessionController doesn't expose rounds array directly)
      rebuildInternalRounds()

      isInitialized.value = true
      console.log('[useSessionPlayback] Initialization complete')

    } catch (err) {
      console.error('[useSessionPlayback] Initialization error:', err)
      throw err
    }
  }

  /**
   * Rebuild internal rounds from SessionController state
   */
  function rebuildInternalRounds(): void {
    // Access rounds through SessionController's internal state
    // Since we can iterate currentRound, we build the list
    const rounds: RoundTemplate[] = []
    const totalRounds = sessionController.progress.value.totalRounds

    // For now, we can only access currentRound
    // This is a limitation - we may need to expose rounds from SessionController
    const currentRoundValue = sessionController.currentRound.value
    if (currentRoundValue) {
      // Build rounds by advancing through them (this is a workaround)
      // In production, SessionController should expose rounds directly
      internalRounds.value = [currentRoundValue]
    }
  }

  /**
   * Start playback
   */
  function start(getAudioSource: GetAudioSourceFn): void {
    if (!isInitialized.value) {
      console.warn('[useSessionPlayback] Cannot start - not initialized')
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
   */
  function jumpToRound(roundNumber: number): void {
    sessionController.jumpToRound(roundNumber)
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
        console.error('[useSessionPlayback] Session event handler error:', err)
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
        console.error('[useSessionPlayback] Cycle event handler error:', err)
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
    sessionController.off(sessionEventHandler)
    sessionController.dispose()
    cycleEventHandlers.clear()
    sessionEventHandlers.clear()
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

    // Methods
    initialize,
    start,
    pause,
    resume,
    stop,
    skipCycle,
    skipRound,
    jumpToRound,
    setConfig,

    // Event subscriptions
    onCycleEvent,
    onSessionEvent,

    // Direct access for advanced usage
    sessionController,

    // Cleanup
    dispose,
  }
}
