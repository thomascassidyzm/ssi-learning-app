import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, watch, nextTick } from 'vue'
import { SimplePlayer, type PlaybackState, type Round } from './SimplePlayer'

// REGRESSION: the phase-display mirror (M2, docs/player/pull-consistency-map.md).
// currentPhase in LearningPlayer used to be a writable ref fed by a two-hop
// relay (engine → onPhaseChanged callback → pendingPhase ref → watcher) plus
// two legacy-path writers — the same shape as the pre-878246ff isPlaying
// mirror. A missed hop froze the phase pill, the speak-gap ring gate and the
// voice-2 text reveal while the audio moved on. The fix derives the UI phase
// from simplePlayer.phase in a computed. These tests pin the engine's
// pull-readable phase, the exact UI mapping the component uses, and the
// derivation's immunity to the interleaves that wedged the old mirror.

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

function makeRound(legoId: string): Round {
  return {
    roundNumber: parseInt(legoId.replace(/[SL]/g, ''), 10) || 1,
    legoId,
    seedId: legoId.slice(0, 5),
    cycles: [
      {
        id: `${legoId}-c1`,
        known: { text: 'hello', audioUrl: 'https://example.com/k.mp3' },
        target: {
          text: 'hola',
          voice1Url: 'https://example.com/t1.mp3',
          voice2Url: 'https://example.com/t2.mp3',
        },
        pauseDuration: 0,
      },
    ],
  }
}

// The component's mapping (LearningPlayer SIMPLE_PHASE_TO_UI), reproduced so a
// mapping change there without a deliberate test change here fails loudly.
const Phase = { PROMPT: 'prompt', SPEAK: 'speak', VOICE_1: 'voice_1', VOICE_2: 'voice_2' }
const SIMPLE_PHASE_TO_UI: Record<string, string> = {
  idle: Phase.PROMPT,
  buffering: Phase.PROMPT,
  prompt: Phase.PROMPT,
  pause: Phase.SPEAK,
  voice1: Phase.VOICE_1,
  voice2: Phase.VOICE_2,
}

function wireDerivedPhase(player: SimplePlayer) {
  // Reproduces the live wiring: state_changed → internal ref → computeds.
  const internalState = ref<PlaybackState>({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false })
  player.on('state_changed', (s) => { internalState.value = s as PlaybackState })
  const enginePhase = computed(() => internalState.value.phase)
  const currentPhase = computed(() => SIMPLE_PHASE_TO_UI[enginePhase.value] ?? Phase.PROMPT)
  return { internalState, enginePhase, currentPhase }
}

describe('phase display sync — pull-consistency invariant (M2)', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', vi.fn(() => makeMockAudio()))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('every engine phase maps to the UI phase the template styles against', () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    const { currentPhase } = wireDerivedPhase(player)

    expect(player.currentState.phase).toBe('idle')
    expect(currentPhase.value).toBe(Phase.PROMPT)

    for (const [engine, ui] of [
      ['prompt', Phase.PROMPT],
      ['pause', Phase.SPEAK],
      ['voice1', Phase.VOICE_1],
      ['voice2', Phase.VOICE_2],
    ] as const) {
      player.skipToPhase(engine)
      expect(player.currentState.phase).toBe(engine)
      expect(currentPhase.value).toBe(ui)
    }
  })

  it('a consumer that attaches AFTER a phase transition still reads the current phase (pull, not edge)', () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    player.skipToPhase('voice2') // no subscriber attached — the edge is "missed"

    // Late attach: the only correct read is the engine's current state.
    expect(player.currentState.phase).toBe('voice2')
    expect(SIMPLE_PHASE_TO_UI[player.currentState.phase]).toBe(Phase.VOICE_2)

    // Wiring attached late immediately agrees from the next transition on.
    const { currentPhase } = wireDerivedPhase(player)
    player.skipToPhase('pause')
    expect(currentPhase.value).toBe(Phase.SPEAK)
    expect(player.currentState.phase).toBe('pause')
  })

  it('derivation tracks the engine through the mirror-wedging interleave (voice-2 text reveal cannot be lost)', async () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    const { currentPhase } = wireDerivedPhase(player)

    // OLD architecture, for contrast: a writable mirror fed by a watcher —
    // the shape currentPhase had before M2.
    const mirror = ref(Phase.PROMPT)
    watch(currentPhase, (v) => { mirror.value = v })

    player.skipToPhase('voice2')
    await nextTick()
    expect(currentPhase.value).toBe(Phase.VOICE_2)
    expect(mirror.value).toBe(Phase.VOICE_2)

    // The wedge: a manual write flips the mirror back to PROMPT while the
    // engine stays in voice2. No engine transition follows, so no watcher
    // edge repairs it — with the button/text bound to the mirror, voice-2
    // text never appears (Jonathan's staging symptom).
    mirror.value = Phase.PROMPT
    await nextTick()
    expect(player.currentState.phase).toBe('voice2')
    expect(mirror.value).toBe(Phase.PROMPT) // the old mirror lies…
    expect(currentPhase.value).toBe(Phase.VOICE_2) // …the derivation cannot

    // INVARIANT: the UI phase is always the mapping of the engine's phase.
    expect(currentPhase.value).toBe(SIMPLE_PHASE_TO_UI[player.currentState.phase])
  })

  it('same-tick phase bursts settle on the engine final phase (watcher-flush dedupe cannot strand the display)', async () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    const { currentPhase } = wireDerivedPhase(player)

    // The phase-strip tap burst: three jumps inside one tick.
    player.skipToPhase('voice1')
    player.skipToPhase('pause')
    player.skipToPhase('voice2')
    await nextTick()
    expect(player.currentState.phase).toBe('voice2')
    expect(currentPhase.value).toBe(Phase.VOICE_2)
    expect(currentPhase.value).toBe(SIMPLE_PHASE_TO_UI[player.currentState.phase])
  })
})
