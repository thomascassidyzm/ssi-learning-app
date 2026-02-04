/**
 * useSimplePlayer - Vue composable for reactive SimplePlayer usage
 * Thin reactive wrapper around SimplePlayer with computed refs and cleanup.
 */
import { ref, computed, onUnmounted, type ComputedRef } from 'vue'
import {
  SimplePlayer,
  type PlaybackState,
  type Round,
  type Cycle,
  type Phase,
} from '../playback/SimplePlayer'

export interface UseSimplePlayerReturn {
  state: ComputedRef<PlaybackState>
  currentRound: ComputedRef<Round | null>
  currentCycle: ComputedRef<Cycle | null>
  phase: ComputedRef<Phase>
  isPlaying: ComputedRef<boolean>
  inIntroSequence: ComputedRef<boolean>
  roundIndex: ComputedRef<number>
  cycleIndex: ComputedRef<number>
  knownText: ComputedRef<string>
  targetText: ComputedRef<string>
  showTargetText: ComputedRef<boolean>
  progress: ComputedRef<{ round: number; total: number; percent: number }>
  roundCount: ComputedRef<number>
  initialize: (rounds: Round[]) => void
  play: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  // NOTE: No skipCycle - a ROUND is the atomic learning unit
  skipRound: () => void
  jumpToRound: (index: number) => void
  jumpToSeed: (seedNumber: number) => void
  findRoundIndexForSeed: (seedNumber: number) => number
  addRounds: (rounds: Round[]) => void
  hasRound: (roundNumber: number) => boolean
  onPhaseChanged: (callback: (phase: Phase) => void) => void
  onCycleCompleted: (callback: (cycle: Cycle) => void) => void
  onRoundCompleted: (callback: (round: Round) => void) => void
  onSessionComplete: (callback: () => void) => void
}

export function useSimplePlayer(): UseSimplePlayerReturn {
  // Internal state
  let player: SimplePlayer | null = null
  const internalState = ref<PlaybackState>({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false, inIntroSequence: false })
  const roundsRef = ref<Round[]>([])

  // Event callback storage
  const phaseCallbacks: Array<(phase: Phase) => void> = []
  const cycleCallbacks: Array<(cycle: Cycle) => void> = []
  const roundCallbacks: Array<(round: Round) => void> = []
  const sessionCallbacks: Array<() => void> = []

  // Initialize with rounds - creates new player instance
  function initialize(rounds: Round[]): void {
    // Clean up existing player
    if (player) {
      player.stop()
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
    player = new SimplePlayer(rounds)

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
    })
    player.on('session_complete', () => {
      sessionCallbacks.forEach(cb => cb())
    })
  }

  // Computed refs for reactive state
  const state = computed(() => internalState.value)
  const phase = computed(() => internalState.value.phase)
  const isPlaying = computed(() => internalState.value.isPlaying)
  const inIntroSequence = computed(() => internalState.value.inIntroSequence)
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

  // Methods (passthrough to player)
  const play = () => player?.play()
  const pause = () => player?.pause()
  const resume = () => player?.resume()
  const stop = () => player?.stop()
  // NOTE: No skipCycle - a ROUND is the atomic learning unit
  const skipRound = () => player?.skipRound()
  const jumpToRound = (index: number) => player?.jumpToRound(index)

  /**
   * Find the first round index that belongs to a given seed number.
   * Seed IDs are formatted as "S0001", "S0082", etc.
   * Returns -1 if no round found for that seed.
   */
  const findRoundIndexForSeed = (seedNumber: number): number => {
    const targetSeedId = `S${String(seedNumber).padStart(4, '0')}`
    const index = roundsRef.value.findIndex(r => r.seedId === targetSeedId)
    if (index === -1) {
      console.warn(`[useSimplePlayer] No round found for seed ${seedNumber} (${targetSeedId})`)
    }
    return index
  }

  /**
   * Jump to the first round of a given seed number.
   * This maps seed numbers (used by belt system) to round indices (used by player).
   */
  const jumpToSeed = (seedNumber: number) => {
    const roundIndex = findRoundIndexForSeed(seedNumber)
    if (roundIndex >= 0) {
      console.log(`[useSimplePlayer] Jumping to seed ${seedNumber} → round index ${roundIndex}`)
      player?.jumpToRound(roundIndex)
    } else {
      console.warn(`[useSimplePlayer] Cannot jump to seed ${seedNumber} - not found in loaded rounds`)
    }
  }

  /**
   * Add rounds dynamically (for priority loading).
   * Also updates roundsRef for reactive UI updates.
   * IMPORTANT: Must use same insertion logic as SimplePlayer to keep arrays in sync!
   */
  const addRounds = (newRounds: Round[]) => {
    if (!player || newRounds.length === 0) return
    player.addRounds(newRounds)
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
   * Check if a round exists by roundNumber
   */
  const hasRound = (roundNumber: number): boolean => {
    return player?.hasRound(roundNumber) ?? false
  }

  // Event hooks
  const onPhaseChanged = (callback: (phase: Phase) => void) => { phaseCallbacks.push(callback) }
  const onCycleCompleted = (callback: (cycle: Cycle) => void) => { cycleCallbacks.push(callback) }
  const onRoundCompleted = (callback: (round: Round) => void) => { roundCallbacks.push(callback) }
  const onSessionComplete = (callback: () => void) => { sessionCallbacks.push(callback) }

  // Cleanup on unmount
  onUnmounted(() => {
    player?.stop()
    phaseCallbacks.length = 0
    cycleCallbacks.length = 0
    roundCallbacks.length = 0
    sessionCallbacks.length = 0
  })

  return {
    state,
    currentRound,
    currentCycle,
    phase,
    isPlaying,
    inIntroSequence,
    roundIndex,
    cycleIndex,
    knownText,
    targetText,
    showTargetText,
    progress,
    roundCount,
    initialize,
    play,
    pause,
    resume,
    stop,
    skipRound,
    jumpToRound,
    jumpToSeed,
    findRoundIndexForSeed,
    addRounds,
    hasRound,
    onPhaseChanged,
    onCycleCompleted,
    onRoundCompleted,
    onSessionComplete,
  }
}

// Re-export types for convenience
export type { Round, Cycle, Phase, PlaybackState } from '../playback/SimplePlayer'
