import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, watch, nextTick } from 'vue'
import { SimplePlayer, type PlaybackState, type Round } from './SimplePlayer'

// REGRESSION: the player-UI transport desync (Jonathan's staging report,
// 2026-07-28 — build 3bfeb1d). The engine was audibly mid-cycle while the
// transport showed a PLAY button, the speak-gap ring sat at 0:00 and the
// voice-2 text never appeared, self-healing only when the next round
// boundary happened to toggle the engine and re-fire a watcher.
//
// Root cause: UI play-state was a WRITABLE MIRROR synced by edge-triggered
// watchers plus scattered manual assignments, forwarded across an emit hop.
// Any missed/reordered edge left the mirror stale until the next engine
// toggle. The fix makes every consumer PULL from the engine's current state
// (a computed), so there is no edge to miss. These tests pin both halves:
// the engine's pull-readable truth, and the derivation's immunity to the
// exact interleaves that wedged the mirror.

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
  const a: MockAudio = {
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
  return a
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

describe('transport state sync — pull-consistency invariant', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', vi.fn(() => makeMockAudio()))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('a consumer that attaches AFTER play() still reads isPlaying=true (pull, not edge)', () => {
    // The founder's hypothesis for the cold-start race: the engine emits
    // 'playing' before the UI listener attaches. Pull-consistency means a
    // late attacher is never stranded on a stale initial value.
    const player = new SimplePlayer([makeRound('S0001L01')])
    player.play() // no subscriber attached yet — the transition edge is "missed"

    // Late attach: the ONLY correct read is the engine's current state.
    expect(player.currentState.isPlaying).toBe(true)

    // And the state_changed feed from here on agrees with the pull read.
    const seen: boolean[] = []
    player.on('state_changed', (s) => seen.push((s as PlaybackState).isPlaying))
    player.pause()
    expect(seen[seen.length - 1]).toBe(false)
    expect(player.currentState.isPlaying).toBe(false)
  })

  it('play()/pause()/resume() update currentState SYNCHRONOUSLY (no async gap for the button to read stale state)', () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    player.play()
    expect(player.currentState.isPlaying).toBe(true)
    player.pause()
    expect(player.currentState.isPlaying).toBe(false)
    player.resume()
    expect(player.currentState.isPlaying).toBe(true)
  })

  it('computed derivation tracks the engine through the mirror-wedging interleave', async () => {
    // Reproduces the wiring useSimplePlayer + LearningPlayer now use:
    // state_changed → internal ref → computed. Then drives the exact
    // interleave that wedged the old writable mirror (manual false write
    // while the engine keeps playing, no further engine toggle) and
    // asserts the derived value CANNOT disagree with the engine.
    const player = new SimplePlayer([makeRound('S0001L01')])
    const internalState = ref<PlaybackState>({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false })
    player.on('state_changed', (s) => { internalState.value = s as PlaybackState })
    const isPlaying = computed(() => internalState.value.isPlaying)

    // OLD architecture, for contrast: a writable mirror fed by a watcher.
    const mirror = ref(false)
    watch(isPlaying, (v) => { mirror.value = v })

    player.play()
    await nextTick()
    expect(isPlaying.value).toBe(true)
    expect(mirror.value).toBe(true)

    // The wedge: a manual write flips the mirror false while the engine
    // keeps playing. No engine toggle follows, so no watcher edge ever
    // repairs it — this is Jonathan's stuck transport (PLAY shown, 0:00,
    // no voice-2 text) until the next LEGO's boundary toggled the engine.
    mirror.value = false
    await nextTick()
    expect(player.currentState.isPlaying).toBe(true)
    expect(mirror.value).toBe(false) // the old mirror lies…
    expect(isPlaying.value).toBe(true) // …the derivation cannot

    // INVARIANT (founder): the play button must never be visible while a
    // cycle is playing. With the button bound to the derivation, that is:
    expect(isPlaying.value).toBe(player.currentState.isPlaying)
  })

  it('derivation stays correct when transitions burst inside one tick (watcher-flush dedupe cannot hide the final state)', async () => {
    const player = new SimplePlayer([makeRound('S0001L01')])
    const internalState = ref<PlaybackState>({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false })
    player.on('state_changed', (s) => { internalState.value = s as PlaybackState })
    const isPlaying = computed(() => internalState.value.isPlaying)

    // Rapid same-tick toggles (the double-tap / boundary-race shape):
    player.play()
    player.pause()
    player.resume()
    await nextTick()
    expect(isPlaying.value).toBe(true)
    expect(isPlaying.value).toBe(player.currentState.isPlaying)

    player.pause()
    player.resume()
    player.pause()
    await nextTick()
    expect(isPlaying.value).toBe(false)
    expect(isPlaying.value).toBe(player.currentState.isPlaying)
  })
})
