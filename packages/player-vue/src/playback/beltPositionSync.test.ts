import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, watch, nextTick } from 'vue'
import { SimplePlayer, type PlaybackState, type Round } from './SimplePlayer'

// REGRESSION: M9 of docs/player/pull-consistency-map.md — the belt position
// push. useBeltProgress.playingSeedNumber used to be pushed from ~15 scattered
// LearningPlayer sites (round completion, belt-skip landings, INF-PLAY
// entry/advance/back, five resume paths, deep-link jumps). A missed push left
// a stale belt colour/readout until the next round completion happened to
// re-push.
//
// The fix derives ONE anchor from engine truth:
//   beltAnchorSeed = INF-PLAY active ? beltFreezeSeed : seed(visualLegoIdForRound(currentRound))
// with a single watcher bridging it into the shared composable (a cross-
// surface, set-call-shaped sink — the doctrine-approved effect bridge).
//
// The INF-PLAY belt freeze is a FEATURE and must survive exactly:
//  - entry/resume paths record the course-end anchor in beltFreezeSeed; the
//    belt pins there while INF PLAY is active (revival rounds carry random
//    USE legoIds that would otherwise bounce the belt every round);
//  - rounds that merely LOOK like INF PLAY with no anchor recorded (audio-
//    stripped main-loop rounds, guests with no ceiling) HOLD the last belt
//    (null anchor → no write) — the old skip-the-write behaviour;
//  - leaving INF PLAY clears the freeze and the belt follows the landed
//    round again.

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

function makeRound(legoId: string, kind: 'main' | 'revival'): Round {
  return {
    roundNumber: parseInt(legoId.replace(/[SL]/g, ''), 10) || 1,
    legoId,
    seedId: legoId.slice(0, 5),
    cycles: [
      {
        id: `${legoId}-c1`,
        // Main-loop rounds carry intro/debut/build cycles; revival (INF-PLAY)
        // rounds are pure USE draws — the shape isInfPlayActive detects.
        type: kind === 'main' ? 'debut' : 'practice',
        known: { text: 'hello', audioUrl: 'https://example.com/k.mp3' },
        target: {
          text: 'hola',
          voice1Url: 'https://example.com/t1.mp3',
          voice2Url: 'https://example.com/t2.mp3',
        },
        pauseDuration: 0,
      } as any,
    ],
  }
}

const seedOf = (legoId: string | null): number | null => {
  const m = legoId?.match(/^S(\d{4})/)
  return m ? parseInt(m[1], 10) : null
}

/** Reproduce the LearningPlayer M9 wiring around a real SimplePlayer. */
function wireBeltDerivation(player: SimplePlayer) {
  const internalState = ref<PlaybackState>(player.currentState)
  player.on('state_changed', (s) => { internalState.value = s as PlaybackState })
  const roundsRef = ref<Round[]>(player.roundsSnapshot)

  const currentRound = computed<Round | null>(() =>
    roundsRef.value[internalState.value.roundIndex] ?? null)

  // Component-level pieces, faithfully reproduced.
  const currentMode = ref<'main' | 'infplay'>('main')
  const lastMainLoopLegoId = ref<string | null>(null)
  const isMainLoopRound = (round: Round | null): boolean =>
    !!round?.cycles?.length && round.cycles.some((c: any) =>
      c.type === 'intro' || c.type === 'debut' || c.type === 'build')
  const visualLegoIdForRound = (round: Round | null): string | null => {
    if (!round) return null
    if (isMainLoopRound(round)) return round.legoId || null
    return lastMainLoopLegoId.value || round.legoId || null
  }
  const isInfPlayActive = computed(() =>
    currentMode.value === 'infplay'
    || (!!currentRound.value && !isMainLoopRound(currentRound.value)))

  const beltFreezeSeed = ref<number | null>(null)
  const beltAnchorSeed = computed<number | null>(() => {
    if (isInfPlayActive.value) return beltFreezeSeed.value
    const legoId = visualLegoIdForRound(currentRound.value)
    if (!legoId) return null
    return seedOf(legoId)
  })

  // The composable sink (playingSeedNumber) + the single effect bridge.
  const playingSeedNumber = ref(0)
  // immediate mirrors the component bridge: a valid anchor at attach time is
  // delivered, not stranded behind the next change.
  watch(beltAnchorSeed, (seed) => {
    if (seed !== null) playingSeedNumber.value = seed
  }, { immediate: true })
  watch(isInfPlayActive, (active) => { if (!active) beltFreezeSeed.value = null })

  return {
    currentMode,
    lastMainLoopLegoId,
    isInfPlayActive,
    beltFreezeSeed,
    beltAnchorSeed,
    playingSeedNumber,
  }
}

// 3 main-loop rounds then 3 revival rounds (the INF-PLAY tail), each revival
// drawing a random USE legoId from anywhere in the course.
const MAIN = ['S0001L01', 'S0002L01', 'S0003L01'].map((id) => makeRound(id, 'main'))
const REVIVAL = ['S0042L03', 'S0007L02', 'S0099L01'].map((id) => makeRound(id, 'revival'))

describe('belt position sync — pull-consistency invariant (M9)', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', vi.fn(() => makeMockAudio()))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('main loop: the belt follows the round the engine lands on, through any jump interleave', async () => {
    const player = new SimplePlayer([...MAIN, ...REVIVAL])
    const w = wireBeltDerivation(player)

    player.jumpToRound(1)
    await nextTick()
    expect(w.playingSeedNumber.value).toBe(2)

    // Same-tick burst — only the final landing matters (no edge dependence).
    player.jumpToRound(0)
    player.jumpToRound(2)
    await nextTick()
    expect(w.playingSeedNumber.value).toBe(3)
    expect(w.beltAnchorSeed.value).toBe(seedOf(player.currentRound!.legoId))
  })

  it('INF-PLAY freeze: with the anchor recorded, revival rounds can NEVER bounce the belt', async () => {
    const player = new SimplePlayer([...MAIN, ...REVIVAL])
    const w = wireBeltDerivation(player)
    player.jumpToRound(2)
    await nextTick()
    expect(w.playingSeedNumber.value).toBe(3)

    // enterInfPlay: record the freeze anchor (course-end seed), jump into the
    // revival tail. Mode flip mirrors the real account path.
    w.currentMode.value = 'infplay'
    w.beltFreezeSeed.value = 668
    player.jumpToRound(3)
    await nextTick()
    expect(w.playingSeedNumber.value).toBe(668)

    // Advance through revival rounds with wildly different USE legoIds — the
    // belt must not move (the pre-M9 bounce this freeze exists to prevent).
    player.jumpToRound(4)
    await nextTick()
    player.jumpToRound(5)
    await nextTick()
    expect(w.playingSeedNumber.value).toBe(668)
    expect(w.isInfPlayActive.value).toBe(true)
  })

  it('guest / shape-only INF PLAY with no anchor: the belt HOLDS its last value (null anchor writes nothing)', async () => {
    const player = new SimplePlayer([...MAIN, ...REVIVAL])
    const w = wireBeltDerivation(player)
    player.jumpToRound(1)
    await nextTick()
    expect(w.playingSeedNumber.value).toBe(2)

    // A round that merely LOOKS like INF PLAY (revival shape) with no freeze
    // anchor recorded and no main-loop ceiling — e.g. an audio-stripped
    // round, or a guest. The old code skipped the belt write; the derivation
    // must reproduce that hold, not pin to anything.
    w.lastMainLoopLegoId.value = null
    player.jumpToRound(4)
    await nextTick()
    expect(w.isInfPlayActive.value).toBe(true)
    expect(w.beltAnchorSeed.value).toBe(null)
    expect(w.playingSeedNumber.value).toBe(2) // held
  })

  it('leaving INF PLAY clears the freeze and the belt follows the landed main-loop round again', async () => {
    const player = new SimplePlayer([...MAIN, ...REVIVAL])
    const w = wireBeltDerivation(player)

    w.currentMode.value = 'infplay'
    w.beltFreezeSeed.value = 668
    player.jumpToRound(4)
    await nextTick()
    expect(w.playingSeedNumber.value).toBe(668)

    // Exit: land on a main-loop round and drop the mode (the real exit path).
    w.currentMode.value = 'main'
    player.jumpToRound(0)
    await nextTick()
    expect(w.isInfPlayActive.value).toBe(false)
    expect(w.playingSeedNumber.value).toBe(1)
    // The freeze intent was cleared on exit — a later shape-only round can't
    // resurrect a stale course-end pin.
    expect(w.beltFreezeSeed.value).toBe(null)
  })

  it('late-attach: wiring created AFTER the engine landed still reads the landed belt (pull, not edge)', async () => {
    const player = new SimplePlayer([...MAIN, ...REVIVAL])
    player.jumpToRound(2) // edge "missed" — nobody wired yet

    const w = wireBeltDerivation(player)
    expect(w.beltAnchorSeed.value).toBe(3)
  })

  it('derived anchor can never disagree with the engine across a main-loop walk', async () => {
    const player = new SimplePlayer([...MAIN, ...REVIVAL])
    const w = wireBeltDerivation(player)
    for (const idx of [0, 1, 2, 1, 0, 2]) {
      player.jumpToRound(idx)
      await nextTick()
      expect(w.playingSeedNumber.value).toBe(seedOf(player.currentRound!.legoId))
    }
  })
})
