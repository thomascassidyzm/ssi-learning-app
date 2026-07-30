import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed } from 'vue'
import { SimplePlayer, type PlaybackState, type Round } from './SimplePlayer'

// REGRESSION: M3 of docs/player/pull-consistency-map.md — the position
// mirrors. `currentRoundIndex`/`currentItemInRound` used to be writable refs
// synced by edge-triggered watchers on the engine PLUS ~20 manual assignments
// across the resume labyrinth, preview, reset and the legacy cycle-event
// path. Any missed/reordered edge (or a manual write racing a watcher flush)
// left the displayed position disagreeing with the audio — the same shape as
// the 2026-07-21 belt-skip fencepost bug (a stale index cross-indexing a
// rounds array lands on the wrong round's text).
//
// The fix splits the two roles the old refs conflated:
//   - a PRE-ENGINE resume intent (refs written only by the resume/preview/
//     reset paths and the legacy playback system, all of which run with no
//     engine), and
//   - the DERIVED position: computed(() => engine initialized ?
//     engine.roundIndex : preEngineIntent).
// After engine init, position derives from the engine only — there is no
// writable path back into it (read-only computeds make scattered writers a
// compile error).
//
// These tests reproduce the exact wiring (state_changed → internal ref +
// isInitialized flag → computed) and drive the late-attach, missed-edge and
// mirror-wedging interleaves from the tranche pattern
// (transportStateSync.test.ts).

interface MockAudio {
  src: string
  playbackRate: number
  volume: number
  loop: boolean
  paused: boolean
  ended: boolean
  error: { code: number } | null
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  setAttribute: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
}

function makeMockAudio(): MockAudio {
  return {
    src: '',
    playbackRate: 1,
    volume: 1,
    loop: false,
    paused: true,
    ended: false,
    error: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  }
}

function makeRound(legoId: string, cycleCount = 3): Round {
  return {
    roundNumber: parseInt(legoId.replace(/[SL]/g, ''), 10) || 1,
    legoId,
    seedId: legoId.slice(0, 5),
    cycles: Array.from({ length: cycleCount }, (_, i) => ({
      id: `${legoId}-c${i + 1}`,
      known: { text: `known ${i}`, audioUrl: 'https://example.com/k.mp3' },
      target: {
        text: `target ${i}`,
        voice1Url: 'https://example.com/t1.mp3',
        voice2Url: 'https://example.com/t2.mp3',
      },
      pauseDuration: 0,
    })),
  }
}

/** Reproduce the LearningPlayer M3 wiring around a real SimplePlayer. */
function wirePositionDerivation() {
  const internalState = ref<PlaybackState>({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false })
  const engineInitialized = ref(false)
  const preEngineRoundIndex = ref(0)
  const preEngineItemInRound = ref(0)
  let player: SimplePlayer | null = null

  const initialize = (rounds: Round[]) => {
    player = new SimplePlayer(rounds)
    internalState.value = player.currentState
    engineInitialized.value = true
    player.on('state_changed', (s) => { internalState.value = s as PlaybackState })
    return player
  }

  const currentRoundIndex = computed(() =>
    engineInitialized.value ? internalState.value.roundIndex : preEngineRoundIndex.value)
  const currentItemInRound = computed(() =>
    engineInitialized.value ? internalState.value.cycleIndex : preEngineItemInRound.value)

  return {
    initialize,
    preEngineRoundIndex,
    preEngineItemInRound,
    currentRoundIndex,
    currentItemInRound,
    getPlayer: () => player,
  }
}

const ROUNDS = ['S0001L01', 'S0002L01', 'S0003L01', 'S0004L01', 'S0005L01'].map((id) => makeRound(id))

describe('round/cycle position sync — pull-consistency invariant (M3)', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', vi.fn(() => makeMockAudio()))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('pre-engine: derived position reads the resume intent before any engine exists', () => {
    const w = wirePositionDerivation()
    // The resume labyrinth seeds the splash/resting display before init.
    w.preEngineRoundIndex.value = 7
    w.preEngineItemInRound.value = 2
    expect(w.currentRoundIndex.value).toBe(7)
    expect(w.currentItemInRound.value).toBe(2)
  })

  it('intent is consumed at init: after initialize + resume jump, position derives from the engine and the stale intent is unreadable', () => {
    const w = wirePositionDerivation()
    w.preEngineRoundIndex.value = 3
    w.preEngineItemInRound.value = 1

    const player = w.initialize(ROUNDS)
    // The resume path consumes the intent through the engine (jumpToRound),
    // as every modern init path does.
    player.jumpToRound(3, 1)
    expect(w.currentRoundIndex.value).toBe(3)
    expect(w.currentItemInRound.value).toBe(1)

    // Engine moves; a stale intent must never bleed back into the display.
    player.jumpToRound(4, 0)
    expect(w.currentRoundIndex.value).toBe(4)
    expect(w.currentItemInRound.value).toBe(0)
    expect(w.preEngineRoundIndex.value).toBe(3) // stale, and correctly ignored
  })

  it('late-attach: a consumer wired AFTER the engine jumped still reads the landed position (pull, not edge)', () => {
    // The resume race: the bootstrap jumpToRound fires before the UI's
    // subscription exists. An edge-synced mirror stays at 0; the pull read
    // cannot.
    const player = new SimplePlayer(ROUNDS)
    player.jumpToRound(2, 1) // edge "missed" — nobody subscribed yet

    const internalState = ref<PlaybackState>({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false })
    const engineInitialized = ref(true)
    // Late attach seeds from currentState (as useSimplePlayer.initialize does).
    internalState.value = player.currentState
    player.on('state_changed', (s) => { internalState.value = s as PlaybackState })

    const currentRoundIndex = computed(() =>
      engineInitialized.value ? internalState.value.roundIndex : 0)
    const currentItemInRound = computed(() =>
      engineInitialized.value ? internalState.value.cycleIndex : 0)

    expect(currentRoundIndex.value).toBe(2)
    expect(currentItemInRound.value).toBe(1)
  })

  it('mirror-wedge: a manual write to the pre-engine intent AFTER init cannot move the derived position', () => {
    const w = wirePositionDerivation()
    const player = w.initialize(ROUNDS)
    player.jumpToRound(1, 0)

    // The old bug class: a scattered manual assignment with no subsequent
    // engine toggle left the mirror wedged on the wrong round. The only
    // writable state left is the pre-engine intent — and post-init it is
    // inert by construction.
    w.preEngineRoundIndex.value = 4
    w.preEngineItemInRound.value = 2
    expect(w.currentRoundIndex.value).toBe(1)
    expect(w.currentItemInRound.value).toBe(0)

    // And the engine's next move is what the display follows.
    player.jumpToRound(2, 2)
    expect(w.currentRoundIndex.value).toBe(2)
    expect(w.currentItemInRound.value).toBe(2)
  })

  it('same-tick burst: N jumps in one tick leave the derived position on the LAST one (no intermediate edge dependence)', () => {
    const w = wirePositionDerivation()
    const player = w.initialize(ROUNDS)
    player.jumpToRound(1, 0)
    player.jumpToRound(3, 2)
    player.jumpToRound(2, 1)
    expect(w.currentRoundIndex.value).toBe(2)
    expect(w.currentItemInRound.value).toBe(1)
    expect(player.currentState.roundIndex).toBe(2)
    expect(player.currentState.cycleIndex).toBe(1)
  })

  it('derived position can never disagree with the engine across a stepCycle walk over a round boundary', () => {
    const w = wirePositionDerivation()
    const player = w.initialize(ROUNDS)
    player.jumpToRound(0, 0)
    // Walk forward across the boundary of round 0 (3 cycles) into round 1.
    for (let i = 0; i < 4; i++) {
      player.stepCycle(1)
      expect(w.currentRoundIndex.value).toBe(player.currentState.roundIndex)
      expect(w.currentItemInRound.value).toBe(player.currentState.cycleIndex)
    }
    expect(w.currentRoundIndex.value).toBe(1)
  })
})
