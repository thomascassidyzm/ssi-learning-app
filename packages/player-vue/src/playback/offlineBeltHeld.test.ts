import { describe, it, expect } from 'vitest'
import { ref, computed, watch, nextTick } from 'vue'

// REGRESSION: Tom, 2026-08-15, testing a signed-in offline resume on his phone
// in airplane mode — Italian, Blue Belt. The app correctly recognised him and
// correctly knew where he was, then painted the central pill SSi red with the
// ∞ glyph and dropped him into what looked like formal INF PLAY.
//
// His ruling: OFFLINE CHANGES WHAT PLAYS, NEVER WHERE YOU ARE. Offline should
// be unremarkable — play the cached phrases infinite-play-STYLE (the urn), but
// keep the learner's own belt colour and belt nav.
//
//   "what we want is to stay at the current belt colour and belt nav /
//    But just to play the cached phrases it has, like in infinite play /
//    But not necessarily to move to the formal infinite play section"
//
// The cause was one signal doing two jobs. isInfPlayActive meant BOTH "the
// learner is in the formal mode" AND "this round has no intro/debut/build",
// and the offline recycle emits USE-only rounds — so the round-shape reading
// dragged the whole red-∞ look along with it.
//
// The fix splits it:
//   isInfPlayActive         — the formal MODE. The look + the navigation.
//   isRecycledRoundPlayback — the round SHAPE, by either route. The belt
//                             anchor freeze, the belt-write suppression, the
//                             revival pod cadence.
//
// These tests reproduce that wiring faithfully and pin both halves: the
// offline path must NOT go red, and the deliberate ∞ path must STILL go red.

type RoundKind = 'main' | 'revival'
interface TestRound { legoId: string; cycles: { type: string }[] }

const makeRound = (legoId: string, kind: RoundKind): TestRound => ({
  legoId,
  // Main-loop rounds carry intro/debut/build; recycled rounds are pure USE
  // draws — the shape the round-shape signal detects.
  cycles: [{ type: kind === 'main' ? 'debut' : 'use' }],
})

const seedOf = (legoId: string | null): number | null => {
  const m = legoId?.match(/^S(\d{4})/)
  return m ? parseInt(m[1], 10) : null
}

const INF_PLAY_RED = '#c23a3a'

/**
 * Reproduce the LearningPlayer wiring for the two signals and everything that
 * hangs off them, exactly as the component wires it.
 */
function wireOfflineBeltHeld() {
  const currentRound = ref<TestRound | null>(null)
  const currentMode = ref<'main' | 'infplay'>('main')
  const offlineRecycleBeltHeld = ref(false)
  const beltFreezeSeed = ref<number | null>(null)
  const lastMainLoopLegoId = ref<string | null>(null)
  const highestCompletedLegoId = ref<string | null>(null)
  // The learner's real belt colour, as useBeltProgress would supply it.
  const learnerBeltColour = ref('#3b6fd4') // Blue Belt, Tom's actual state

  const isMainLoopRound = (round: TestRound | null): boolean =>
    !!round?.cycles?.length && round.cycles.some((c) =>
      c.type === 'intro' || c.type === 'debut' || c.type === 'build')

  const visualLegoIdForRound = (round: TestRound | null): string | null => {
    if (!round) return null
    if (isMainLoopRound(round)) return round.legoId || null
    return lastMainLoopLegoId.value || round.legoId || null
  }

  const isInfPlayActive = computed(() =>
    currentMode.value === 'infplay'
    || (!offlineRecycleBeltHeld.value
        && !!currentRound.value && !isMainLoopRound(currentRound.value)))

  const isRecycledRoundPlayback = computed(() =>
    isInfPlayActive.value || offlineRecycleBeltHeld.value)

  const beltAnchorSeed = computed<number | null>(() => {
    if (isRecycledRoundPlayback.value) return beltFreezeSeed.value
    const legoId = visualLegoIdForRound(currentRound.value)
    if (!legoId) return null
    return seedOf(legoId)
  })

  const beltCssVars = computed(() => isInfPlayActive.value
    ? { '--belt-color': INF_PLAY_RED }
    : { '--belt-color': learnerBeltColour.value })

  // The ∞ glyph on the central pill and the .is-infplay class both key off
  // isInfPlayActive in the template.
  const pillShowsInfinityGlyph = computed(() => isInfPlayActive.value)

  const playingSeedNumber = ref(0)
  watch(beltAnchorSeed, (seed) => {
    if (seed !== null) playingSeedNumber.value = seed
  }, { immediate: true })
  watch(isRecycledRoundPlayback, (active) => { if (!active) beltFreezeSeed.value = null })
  watch(currentRound, (round) => {
    if (offlineRecycleBeltHeld.value && round && isMainLoopRound(round)) {
      offlineRecycleBeltHeld.value = false
    }
  })

  /** What appendCachedLoopForOffline does when the recycle engages. */
  const engageOfflineRecycle = () => {
    if (currentMode.value !== 'infplay') {
      const cursorLegoId = highestCompletedLegoId.value ?? lastMainLoopLegoId.value
      const cursorSeed = cursorLegoId ? seedOf(cursorLegoId) : null
      if (cursorSeed != null) beltFreezeSeed.value = cursorSeed
      offlineRecycleBeltHeld.value = true
    }
  }

  /** What enterInfPlay does — the ONE deliberate entry. */
  const enterInfPlayDeliberately = (courseEndSeed: number) => {
    offlineRecycleBeltHeld.value = false
    currentMode.value = 'infplay'
    beltFreezeSeed.value = courseEndSeed
  }

  return {
    currentRound, currentMode, offlineRecycleBeltHeld, beltFreezeSeed,
    lastMainLoopLegoId, highestCompletedLegoId, learnerBeltColour,
    isInfPlayActive, isRecycledRoundPlayback, beltAnchorSeed, beltCssVars,
    pillShowsInfinityGlyph, playingSeedNumber,
    engageOfflineRecycle, enterInfPlayDeliberately,
  }
}

describe('offline recycle holds the belt (Tom 2026-08-15)', () => {
  it("keeps the learner's own belt colour — no SSi red — while offline recycled rounds play", async () => {
    const w = wireOfflineBeltHeld()
    // Tom's state: signed in, resumed mid-course, cursor at S0084L01 (Blue Belt).
    w.highestCompletedLegoId.value = 'S0084L01'
    w.lastMainLoopLegoId.value = 'S0084L01'
    w.currentRound.value = makeRound('S0084L01', 'main')
    await nextTick()
    expect(w.beltCssVars.value['--belt-color']).toBe('#3b6fd4')

    // Airplane mode: the recycle engages and USE-only rounds start playing.
    w.engageOfflineRecycle()
    w.currentRound.value = makeRound('S0311L02', 'revival')
    await nextTick()

    expect(w.isInfPlayActive.value).toBe(false)
    expect(w.beltCssVars.value['--belt-color']).toBe('#3b6fd4')
    expect(w.beltCssVars.value['--belt-color']).not.toBe(INF_PLAY_RED)
  })

  it('shows no ∞ glyph on the central pill while offline recycled rounds play', async () => {
    const w = wireOfflineBeltHeld()
    w.highestCompletedLegoId.value = 'S0084L01'
    w.currentRound.value = makeRound('S0084L01', 'main')
    await nextTick()

    w.engageOfflineRecycle()
    w.currentRound.value = makeRound('S0311L02', 'revival')
    await nextTick()

    expect(w.pillShowsInfinityGlyph.value).toBe(false)
  })

  it("holds the belt at the learner's own cursor, not at whichever LEGO the urn draws", async () => {
    const w = wireOfflineBeltHeld()
    w.highestCompletedLegoId.value = 'S0084L01'
    w.lastMainLoopLegoId.value = 'S0084L01'
    w.currentRound.value = makeRound('S0084L01', 'main')
    await nextTick()
    expect(w.playingSeedNumber.value).toBe(84)

    w.engageOfflineRecycle()
    // The urn draws from anywhere in the cached syllabus, crossing belts.
    for (const drawn of ['S0311L02', 'S0007L01', 'S0150L03', 'S0002L01']) {
      w.currentRound.value = makeRound(drawn, 'revival')
      await nextTick()
      // The belt never follows the draw — it stays where the learner is.
      expect(w.playingSeedNumber.value).toBe(84)
    }
  })

  it('still freezes the belt anchor — the round-shape behaviour survives the split', async () => {
    const w = wireOfflineBeltHeld()
    w.highestCompletedLegoId.value = 'S0084L01'
    w.currentRound.value = makeRound('S0084L01', 'main')
    await nextTick()

    w.engageOfflineRecycle()
    w.currentRound.value = makeRound('S0311L02', 'revival')
    await nextTick()

    expect(w.isRecycledRoundPlayback.value).toBe(true)
    expect(w.beltAnchorSeed.value).toBe(84)
  })

  it('releases the belt when genuine main-loop content lands again', async () => {
    const w = wireOfflineBeltHeld()
    w.highestCompletedLegoId.value = 'S0084L01'
    w.lastMainLoopLegoId.value = 'S0084L01'
    w.currentRound.value = makeRound('S0084L01', 'main')
    await nextTick()
    w.engageOfflineRecycle()
    w.currentRound.value = makeRound('S0311L02', 'revival')
    await nextTick()
    expect(w.offlineRecycleBeltHeld.value).toBe(true)

    // Network came back; expandScript produced real rounds.
    w.currentRound.value = makeRound('S0085L01', 'main')
    await nextTick()

    expect(w.offlineRecycleBeltHeld.value).toBe(false)
    expect(w.isRecycledRoundPlayback.value).toBe(false)
    expect(w.beltFreezeSeed.value).toBeNull()
    expect(w.playingSeedNumber.value).toBe(85)
  })

  it('holds the last belt value when the learner has no recorded cursor yet', async () => {
    const w = wireOfflineBeltHeld()
    w.currentRound.value = makeRound('S0003L01', 'main')
    await nextTick()
    expect(w.playingSeedNumber.value).toBe(3)

    // No cursor recorded → null anchor → no write → the belt HOLDS.
    w.engageOfflineRecycle()
    w.currentRound.value = makeRound('S0311L02', 'revival')
    await nextTick()

    expect(w.beltFreezeSeed.value).toBeNull()
    expect(w.playingSeedNumber.value).toBe(3)
    expect(w.isInfPlayActive.value).toBe(false)
  })
})

describe("the deliberate ∞ path is untouched", () => {
  it('the ∞ activator still enters formal INF PLAY with the red pill', async () => {
    const w = wireOfflineBeltHeld()
    w.highestCompletedLegoId.value = 'S0084L01'
    w.currentRound.value = makeRound('S0084L01', 'main')
    await nextTick()

    w.enterInfPlayDeliberately(400)
    w.currentRound.value = makeRound('S0311L02', 'revival')
    await nextTick()

    expect(w.isInfPlayActive.value).toBe(true)
    expect(w.beltCssVars.value['--belt-color']).toBe(INF_PLAY_RED)
    expect(w.pillShowsInfinityGlyph.value).toBe(true)
    expect(w.playingSeedNumber.value).toBe(400)
  })

  it('a deliberate ∞ entry outranks an offline belt hold already in effect', async () => {
    const w = wireOfflineBeltHeld()
    w.highestCompletedLegoId.value = 'S0084L01'
    w.currentRound.value = makeRound('S0084L01', 'main')
    await nextTick()
    w.engageOfflineRecycle()
    w.currentRound.value = makeRound('S0311L02', 'revival')
    await nextTick()
    expect(w.isInfPlayActive.value).toBe(false)

    // The learner taps ∞ on purpose, offline. That is a real move.
    w.enterInfPlayDeliberately(400)
    await nextTick()

    expect(w.offlineRecycleBeltHeld.value).toBe(false)
    expect(w.isInfPlayActive.value).toBe(true)
    expect(w.beltCssVars.value['--belt-color']).toBe(INF_PLAY_RED)
  })

  it('a GUEST on revival rounds still gets the red ∞ — no mode flag, shape inference only', async () => {
    const w = wireOfflineBeltHeld()
    // Guests never get the persisted 'infplay' mode (setMode is gated on a
    // real account), so the round shape is the only signal they have. With no
    // offline recycle in effect, that inference must still fire.
    w.currentRound.value = makeRound('S0311L02', 'revival')
    await nextTick()

    expect(w.currentMode.value).toBe('main')
    expect(w.isInfPlayActive.value).toBe(true)
    expect(w.beltCssVars.value['--belt-color']).toBe(INF_PLAY_RED)
  })
})
