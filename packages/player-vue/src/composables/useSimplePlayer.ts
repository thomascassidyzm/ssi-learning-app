/**
 * useSimplePlayer - Vue composable for reactive SimplePlayer usage
 * Thin reactive wrapper around SimplePlayer with computed refs and cleanup.
 */
import { ref, computed, onUnmounted, type ComputedRef, type Ref } from 'vue'
import {
  SimplePlayer,
  type PlaybackState,
  type Round,
  type Cycle,
  type Phase,
  type AudioFailedEvent,
  type SimplePlayerRuntimeOverrides,
} from '../playback/SimplePlayer'
import { PlayerConductor, type RunOptions } from '../playback/PlayerConductor'

export interface UseSimplePlayerReturn {
  state: ComputedRef<PlaybackState>
  currentRound: ComputedRef<Round | null>
  currentCycle: ComputedRef<Cycle | null>
  phase: ComputedRef<Phase>
  isPlaying: ComputedRef<boolean>
  roundIndex: ComputedRef<number>
  cycleIndex: ComputedRef<number>
  knownText: ComputedRef<string>
  targetText: ComputedRef<string>
  showTargetText: ComputedRef<boolean>
  progress: ComputedRef<{ round: number; total: number; percent: number }>
  roundCount: ComputedRef<number>
  /** Reactive ref of the most recent audio_failed event, or null if none yet
   * (or the session recovered). Useful for conditionally rendering a
   * "Tap to resume" banner or a connection-problem toast. */
  audioFailed: Ref<AudioFailedEvent | null>
  initialize: (rounds: Round[]) => void
  setRuntimeOverrides: (overrides: SimplePlayerRuntimeOverrides) => void
  play: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  // NOTE: No skipCycle - a ROUND is the atomic learning unit
  skipRound: () => void
  /** Step ONE practice cycle forward (+1) or back (-1), crossing round
   * boundaries naturally. The bottom-nav ‹ › transport: the finest, most-used
   * control. No-ops at the very ends (caller owns off-the-edge behaviour). */
  stepCycle: (direction: 1 | -1) => void
  /** Jump to a specific phase within the current cycle (prompt/pause/voice1/voice2).
   * For the in-cycle phase strip — lets the learner skip the pause to hear the
   * answer, or replay a specific section. Does not advance round/cycle. */
  skipToPhase: (phase: 'prompt' | 'pause' | 'voice1' | 'voice2') => void
  jumpToRound: (index: number, cycleIndex?: number) => void
  jumpToSeed: (seedNumber: number) => void
  /** Jump to the first loaded round with this exact LEGO id. No-ops (with a
   * warn) on a miss — POSITION navigation routes through here so the cursor
   * moves by LEGO id, never by a parsed seed string. */
  jumpToLegoId: (legoId: string) => void
  findRoundIndexForSeed: (seedNumber: number) => number
  findRoundIndexForLegoId: (legoId: string) => number
  /** Resolve a belt THRESHOLD (a seed boundary, e.g. blue = 80) to the first
   * loaded round whose seed is >= the threshold — a NEAREST (>=) match, not
   * an exact seed-string lookup. The first LEGO of a belt rarely sits on the
   * threshold seed exactly (the belt may start at seed 81/83/…), so an exact
   * match silently misses and the belt-skip overshoots / falls into INF PLAY.
   * Returns -1 only when no loaded round reaches the threshold (still loading
   * or the course doesn't extend that far). */
  findRoundIndexForBeltThreshold: (seedThreshold: number) => number
  /** Resolve a belt threshold directly to its target LEGO id (atomic
   * find+read against the live rounds array — never cross-index a
   * separate rounds mirror with the index from
   * findRoundIndexForBeltThreshold, which can desync from it). */
  findLegoIdForBeltThreshold: (seedThreshold: number) => string | null
  addRounds: (rounds: Round[]) => void
  appendRounds: (rounds: Round[]) => void
  replaceQueueFromCurrent: (rounds: Round[]) => void
  hasRound: (roundNumber: number) => boolean
  /** Bracket an async interlude (commentary / pod lap / L1 cup) — see
   * PlayerConductor.runInterlude. The conductor never pauses on entry;
   * the body owns the pause decision entirely (a no-interlude boundary
   * must flow straight into the next round) and keeps its own internal
   * pause()/resume() decisions (including deliberately landing paused);
   * only a thrown error or the timeout bound forces a fallback resume,
   * so a stranded player is structurally impossible. */
  runInterlude: (kind: string, fn: () => Promise<void>, opts?: RunOptions) => Promise<void>
  /** Bracket an async seek (skip/jump prep) around a pause — see
   * PlayerConductor.runSeek. Captures pre-seek play intent in the state
   * itself and restores it once `fn` resolves; a second call while one is
   * in flight supersedes it (cancel-and-replace) rather than queueing. */
  runSeek: <T>(fn: (isStale: () => boolean) => Promise<T>, opts?: RunOptions) => Promise<T | undefined>
  onPhaseChanged: (callback: (phase: Phase) => void) => void
  onCycleCompleted: (callback: (cycle: Cycle) => void) => void
  onRoundCompleted: (callback: (round: Round) => void) => void
  onSessionComplete: (callback: () => void) => void
  onAudioFailed: (callback: (event: AudioFailedEvent) => void) => void
}

export function useSimplePlayer(): UseSimplePlayerReturn {
  // Internal state
  let player: SimplePlayer | null = null
  // The conductor is the ONLY thing allowed to call control methods on
  // `player` (docs/player-decomposition-options.md Option 2). Every method
  // below that used to call `player?.xxx()` directly now routes through
  // `conductor.request()` (or runInterlude/runSeek for the async brackets)
  // instead — a fresh conductor is created alongside each new player in
  // initialize() so the two always point at the same live engine.
  let conductor: PlayerConductor | null = null
  // Runtime overrides survive across initialize() calls so wiring Turbo
  // before any rounds load still applies once playback starts.
  let runtimeOverrides: SimplePlayerRuntimeOverrides = {}
  const internalState = ref<PlaybackState>({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false })
  const roundsRef = ref<Round[]>([])

  // Event callback storage
  const phaseCallbacks: Array<(phase: Phase) => void> = []
  const cycleCallbacks: Array<(cycle: Cycle) => void> = []
  const roundCallbacks: Array<(round: Round) => void> = []
  const sessionCallbacks: Array<() => void> = []
  const audioFailedCallbacks: Array<(event: AudioFailedEvent) => void> = []

  // Reactive mirror of the latest audio_failed event. Cleared on successful
  // resume/play/jump so UI banners bound to this ref disappear automatically.
  const audioFailed = ref<AudioFailedEvent | null>(null)

  // Initialize with rounds - creates new player instance
  function initialize(rounds: Round[]): void {
    // Fully dispose the existing player, not just stop() it. stop() leaves the
    // old player's audio-element AND document `visibilitychange` listeners
    // attached, so `document` retains the old SimplePlayer (and its whole rounds
    // array) forever — a leak on every cache/offline re-init. dispose() removes
    // all of them; the new player created below re-adds its own.
    if (player) {
      player.dispose()
    }

    // Debug: log what we're initializing with
    console.log('[useSimplePlayer] Initializing with', rounds.length, 'rounds')
    if (rounds.length > 0) {
      const r = rounds[0]
      console.log('[useSimplePlayer] First round:', r.roundNumber, r.legoId, 'cycles:', r.cycles?.length)
      if (r.cycles?.length > 0) {
        console.log('[useSimplePlayer] First cycle:', r.cycles[0].known?.text, '→', r.cycles[0].target?.text)
      }
    }

    roundsRef.value = rounds
    player = new SimplePlayer(rounds, runtimeOverrides)
    conductor = new PlayerConductor(player)

    // Subscribe to state changes
    player.on('state_changed', (data) => {
      internalState.value = data as PlaybackState
    })

    // Forward events to registered callbacks
    player.on('phase_changed', (data: any) => {
      phaseCallbacks.forEach(cb => cb(data.phase))
    })
    player.on('cycle_completed', (data: any) => {
      cycleCallbacks.forEach(cb => cb(data.cycle))
    })
    player.on('round_completed', (data: any) => {
      roundCallbacks.forEach(cb => cb(data.round))
      // Notify global listeners (e.g. install banner triggers after first round)
      window.dispatchEvent(new CustomEvent('ssi-round-complete', { detail: { round: data.round } }))
    })
    player.on('session_complete', () => {
      sessionCallbacks.forEach(cb => cb())
    })
    player.on('audio_failed', (data) => {
      const event = data as AudioFailedEvent
      audioFailed.value = event
      audioFailedCallbacks.forEach(cb => cb(event))
    })
  }

  // Computed refs for reactive state
  const state = computed(() => internalState.value)
  const phase = computed(() => internalState.value.phase)
  const isPlaying = computed(() => internalState.value.isPlaying)
  const roundIndex = computed(() => internalState.value.roundIndex)
  const cycleIndex = computed(() => internalState.value.cycleIndex)

  // Current round and cycle from rounds array
  const currentRound = computed<Round | null>(() => {
    return roundsRef.value[internalState.value.roundIndex] ?? null
  })

  const currentCycle = computed<Cycle | null>(() => {
    const round = currentRound.value
    if (!round) return null
    return round.cycles[internalState.value.cycleIndex] ?? null
  })

  // Derived state for UI
  const knownText = computed(() => currentCycle.value?.known.text ?? '')
  const targetText = computed(() => currentCycle.value?.target.text ?? '')
  const showTargetText = computed(() => internalState.value.phase === 'voice2')

  // Progress
  const progress = computed(() => {
    const total = roundsRef.value.length || 1
    const round = internalState.value.roundIndex + 1
    const percent = total > 0 ? Math.round((round / total) * 100) : 0
    return { round, total, percent }
  })

  // Round count (for priority loading progress)
  const roundCount = computed(() => roundsRef.value.length)

  // User-initiated transitions clear the audio-failed banner. The
  // corresponding SimplePlayer method also resets the circuit budget.
  const clearAudioFailed = () => { audioFailed.value = null }

  /**
   * Replace the runtime overrides (Turbo-aware pause / speed callbacks).
   * Stored locally so a later initialize() call gets them too. Live player
   * (if any) is updated in place so toggles take effect on the next phase.
   */
  const setRuntimeOverrides = (overrides: SimplePlayerRuntimeOverrides) => {
    runtimeOverrides = overrides
    player?.setRuntimeOverrides(overrides)
  }

  // Methods (passthrough to conductor.request — the only sanctioned direct
  // engine call path; see PlayerConductor's dev guard for the invariant)
  const play = () => { clearAudioFailed(); conductor?.request((e) => e.play()) }
  const pause = () => conductor?.request((e) => e.pause())
  const resume = () => { clearAudioFailed(); conductor?.request((e) => e.resume()) }
  const stop = () => { clearAudioFailed(); conductor?.request((e) => e.stop()) }
  // NOTE: No skipCycle - a ROUND is the atomic learning unit
  const skipRound = () => conductor?.request((e) => e.skipRound())
  const stepCycle = (direction: 1 | -1) => { clearAudioFailed(); conductor?.request((e) => e.stepCycle(direction)) }
  const skipToPhase = (phase: 'prompt' | 'pause' | 'voice1' | 'voice2') => conductor?.request((e) => e.skipToPhase(phase))
  const jumpToRound = (index: number, cycleIndex?: number) => {
    clearAudioFailed()
    conductor?.request((e) => e.jumpToRound(index, cycleIndex))
  }

  /**
   * Find the first round index that belongs to a given seed number.
   * Seed IDs are formatted as "S0001", "S0082", etc.
   * Returns -1 if no round found for that seed.
   *
   * Silent on miss: this is also used as a probe by belt-jump loading
   * computeds (nextBeltLoading / prevBeltLoading) which treat -1 as
   * "still loading". jumpToSeed logs its own warn for user-initiated
   * jumps that actually fail.
   */
  const findRoundIndexForSeed = (seedNumber: number): number => {
    const targetSeedId = `S${String(seedNumber).padStart(4, '0')}`
    return roundsRef.value.findIndex(r => r.seedId === targetSeedId)
  }

  /**
   * Find a round by its exact LEGO id (e.g. "S0042L05"). Used by the
   * resting-state "skip to round N" flow to navigate to the precise round
   * at the ceiling, not just the start of the seed it lives in.
   */
  const findRoundIndexForLegoId = (legoId: string): number => {
    return roundsRef.value.findIndex(r => r.legoId === legoId)
  }

  /**
   * Resolve a belt threshold (a seed boundary, e.g. blue belt = seed 80)
   * to the first loaded round whose seed is >= the threshold. Belt-skip
   * lands on the FIRST LEGO of the target belt; that LEGO's seed is the
   * smallest seed >= the belt's seedsRequired, which may not equal the
   * threshold (the belt could start at seed 81/83/…). Exact seed-string
   * matching (findRoundIndexForSeed) silently misses those, so belt nav
   * must use this nearest-match resolver instead.
   *
   * rounds are kept sorted by legoId (which encodes seed first, then lego
   * index — S0001L01 < S0002L01), so a linear scan returns the first round
   * at-or-past the threshold = the belt's first LEGO. Returns -1 when no
   * loaded round reaches the threshold (still loading / course too short).
   */
  const findRoundIndexForBeltThreshold = (seedThreshold: number): number => {
    return roundsRef.value.findIndex(r => {
      const m = r.seedId?.match(/^S(\d{1,})$/)
      const seed = m ? parseInt(m[1], 10) : NaN
      return Number.isFinite(seed) && seed >= seedThreshold
    })
  }

  /**
   * Resolve a belt threshold DIRECTLY to its target LEGO id, read from the
   * exact same `roundsRef` array `findRoundIndexForBeltThreshold` searched.
   *
   * Callers must never take the index from `findRoundIndexForBeltThreshold`
   * and use it to index a DIFFERENT rounds array (e.g. a component-level
   * `cachedRounds`/`loadedRounds` mirror) — that mirror can diverge from the
   * live engine queue (the instant-playback full-script handoff swaps it to
   * the whole-course array without touching the live queue), so the same
   * index can point at a different round in each array. That cross-array
   * indexing was the belt-skip fencepost bug (landed one seed short of the
   * tapped belt, 2026-07-21) — this resolver keeps the find + read atomic
   * against one array so the two can never desync.
   */
  const findLegoIdForBeltThreshold = (seedThreshold: number): string | null => {
    const idx = findRoundIndexForBeltThreshold(seedThreshold)
    return idx >= 0 ? (roundsRef.value[idx]?.legoId ?? null) : null
  }

  /**
   * Jump to the first round of a given seed number.
   * This maps seed numbers (used by belt system) to round indices (used by player).
   */
  const jumpToSeed = (seedNumber: number) => {
    const roundIndex = findRoundIndexForSeed(seedNumber)
    if (roundIndex >= 0) {
      console.log(`[useSimplePlayer] Jumping to seed ${seedNumber} → round index ${roundIndex}`)
      conductor?.request((e) => e.jumpToRound(roundIndex))
    } else {
      console.warn(`[useSimplePlayer] Cannot jump to seed ${seedNumber} - not found in loaded rounds`)
    }
  }

  /**
   * Jump to the round owning an exact LEGO id. This is the POSITION-keyed
   * navigation primitive: belt nav resolves a target to its LEGO id and
   * moves the cursor through here, so the belt can DERIVE from the landed
   * round rather than being set independently off a parsed seed.
   *
   * No-ops (with a warn) on a miss — the caller is responsible for loading
   * the target round first. A missing target must NEVER silently teleport
   * the learner elsewhere.
   */
  const jumpToLegoId = (legoId: string) => {
    const roundIndex = findRoundIndexForLegoId(legoId)
    if (roundIndex >= 0) {
      console.log(`[useSimplePlayer] Jumping to LEGO ${legoId} → round index ${roundIndex}`)
      conductor?.request((e) => e.jumpToRound(roundIndex))
    } else {
      console.warn(`[useSimplePlayer] Cannot jump to LEGO ${legoId} - not found in loaded rounds`)
    }
  }

  /**
   * Add rounds dynamically (for priority loading).
   * Also updates roundsRef for reactive UI updates.
   * IMPORTANT: Must use same insertion logic as SimplePlayer to keep arrays in sync!
   */
  const addRounds = (newRounds: Round[]) => {
    if (!conductor || newRounds.length === 0) return
    conductor.request((e) => e.addRounds(newRounds))
    // Mirror SimplePlayer's insertion logic exactly to keep arrays in sync
    // Uses legoId (not roundNumber) for ordering and deduplication
    const existingLegoIds = new Set(roundsRef.value.map(r => r.legoId))
    const currentRounds = [...roundsRef.value]
    for (const round of newRounds) {
      if (existingLegoIds.has(round.legoId)) {
        continue // Skip duplicate
      }
      const insertIndex = currentRounds.findIndex(r => r.legoId > round.legoId)
      if (insertIndex === -1) {
        currentRounds.push(round)
      } else {
        currentRounds.splice(insertIndex, 0, round)
      }
      existingLegoIds.add(round.legoId)
    }
    roundsRef.value = currentRounds
  }

  /**
   * Insert rounds keyed by roundNumber, with sorted insertion and
   * dedupe-by-roundNumber. For infinite-play expansion where new
   * rounds reuse existing legoIds (legoId dedupe in addRounds would
   * either throw them away or, without dedupe, stack duplicates of
   * any main-loop rounds also present in the regenerated script).
   */
  const appendRounds = (newRounds: Round[]) => {
    if (!conductor || newRounds.length === 0) return
    conductor.request((e) => e.appendRounds(newRounds))
    // Mirror SimplePlayer's roundNumber-keyed insertion into roundsRef
    // so any consumer reading the reactive mirror sees the same order.
    const existingRoundNumbers = new Set(roundsRef.value.map(r => r.roundNumber))
    const currentRounds = [...roundsRef.value]
    for (const round of newRounds) {
      if (existingRoundNumbers.has(round.roundNumber)) continue
      const insertIndex = currentRounds.findIndex(r => r.roundNumber > round.roundNumber)
      if (insertIndex === -1) {
        currentRounds.push(round)
      } else {
        currentRounds.splice(insertIndex, 0, round)
      }
      existingRoundNumbers.add(round.roundNumber)
    }
    roundsRef.value = currentRounds
  }

  /**
   * Replace every round after the current one with the given batch.
   * Wraps SimplePlayer.replaceQueueFromCurrent and mirrors the same
   * (kept, future) computation into roundsRef so reactive consumers
   * (cachedRounds, legacy refs) see the new queue immediately.
   *
   * Use for the bootstrap → full-script handoff: bootstrap initializes
   * the player from a small API window, full-script generation lands
   * later and replaces the queue past the playing round with the
   * locally-generated whole-course rounds.
   */
  const replaceQueueFromCurrent = (newRounds: Round[]) => {
    if (!conductor || newRounds.length === 0) return
    // Capture the current round number BEFORE the engine splice — the engine
    // emits state_changed during the call, bumping internalState.roundIndex by
    // before.length, so reading it after would read a shifted index against
    // the not-yet-rebuilt array (→ undefined → a bad full-replace).
    const currentRoundNumber = roundsRef.value[internalState.value.roundIndex]?.roundNumber
    conductor.request((e) => e.replaceQueueFromCurrent(newRounds))
    if (currentRoundNumber == null) {
      roundsRef.value = [...newRounds].sort((a, b) => a.roundNumber - b.roundNumber)
      return
    }
    const kept = roundsRef.value.filter(r => r.roundNumber <= currentRoundNumber)
    const keptNumbers = new Set(kept.map(r => r.roundNumber))
    // MIRROR SimplePlayer.replaceQueueFromCurrent EXACTLY: prepend the
    // behind-rounds the queue is missing (deduped against kept) so roundsRef
    // === engine.rounds = [...before, ...kept, ...future]. The engine already
    // shifted roundIndex by before.length (via state_changed); we must NOT
    // shift again — roundsRef just needs the `before` rounds present so the
    // shifted index lands on the live cycle. Without this prepend, on the
    // INF-PLAY full-script handoff the displayed text sat before.length rounds
    // AHEAD of the playing audio — the text/audio desync.
    const before = newRounds
      .filter(r => r.roundNumber < currentRoundNumber && !keptNumbers.has(r.roundNumber))
      .sort((a, b) => a.roundNumber - b.roundNumber)
    const future = newRounds
      .filter(r => r.roundNumber > currentRoundNumber)
      .sort((a, b) => a.roundNumber - b.roundNumber)
    roundsRef.value = [...before, ...kept, ...future]
  }

  /**
   * Check if a round exists by roundNumber
   */
  const hasRound = (roundNumber: number): boolean => {
    return player?.hasRound(roundNumber) ?? false
  }

  const runInterlude = (kind: string, fn: () => Promise<void>, opts?: RunOptions): Promise<void> => {
    if (!conductor) return Promise.resolve()
    return conductor.runInterlude(kind, fn, opts)
  }

  const runSeek = <T,>(fn: (isStale: () => boolean) => Promise<T>, opts?: RunOptions): Promise<T | undefined> => {
    if (!conductor) return Promise.resolve(undefined)
    return conductor.runSeek(fn, opts)
  }

  // Event hooks
  const onPhaseChanged = (callback: (phase: Phase) => void) => { phaseCallbacks.push(callback) }
  const onCycleCompleted = (callback: (cycle: Cycle) => void) => { cycleCallbacks.push(callback) }
  const onRoundCompleted = (callback: (round: Round) => void) => { roundCallbacks.push(callback) }
  const onSessionComplete = (callback: () => void) => { sessionCallbacks.push(callback) }
  const onAudioFailed = (callback: (event: AudioFailedEvent) => void) => { audioFailedCallbacks.push(callback) }

  // Cleanup on unmount
  onUnmounted(() => {
    player?.dispose()
    phaseCallbacks.length = 0
    cycleCallbacks.length = 0
    roundCallbacks.length = 0
    sessionCallbacks.length = 0
    audioFailedCallbacks.length = 0
  })

  return {
    state,
    currentRound,
    currentCycle,
    phase,
    isPlaying,
    roundIndex,
    cycleIndex,
    knownText,
    targetText,
    showTargetText,
    progress,
    roundCount,
    audioFailed,
    initialize,
    setRuntimeOverrides,
    play,
    pause,
    resume,
    stop,
    skipRound,
    stepCycle,
    skipToPhase,
    jumpToRound,
    jumpToSeed,
    jumpToLegoId,
    findRoundIndexForSeed,
    findRoundIndexForLegoId,
    findRoundIndexForBeltThreshold,
    findLegoIdForBeltThreshold,
    addRounds,
    appendRounds,
    replaceQueueFromCurrent,
    hasRound,
    runInterlude,
    runSeek,
    onPhaseChanged,
    onCycleCompleted,
    onRoundCompleted,
    onSessionComplete,
    onAudioFailed,
  }
}

// Re-export types for convenience
export type { Round, Cycle, Phase, PlaybackState } from '../playback/SimplePlayer'
