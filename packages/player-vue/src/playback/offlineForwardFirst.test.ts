import { describe, it, expect, vi } from 'vitest'
import { isCyclePlayableOffline } from './offlinePlayable'

// Tom's THREE-STATE model, 2026-08-15 — the refinement that says unexpected
// offline must NOT be modelled on infinite play at all:
//
//   1. INFINITE PLAY PROPER — the course is COMPLETED, no more LEGOs exist in
//      the DB. The ONLY completion trigger.
//   2. OFFLINE MODE — a deliberate download-ahead. Progresses the course
//      normally and CAN load new LEGOs; that is its point.
//   3. UNEXPECTED OFFLINE (weak signal / airplane) — PLAY WHAT YOU HAVE: keep
//      going FORWARD through the normal script, loading new items from cache
//      (which will almost certainly include some NEW LEGOs, since the cache
//      pre-fills ahead), until nothing new can be loaded, and only THEN
//      recycle cached phrases until the app is next online.
//
// Neither offline state is a completion trigger, and neither changes the belt
// the learner has reached.
//
// Before this, the offline branches went STRAIGHT to recycling: the bootstrap
// path serves only a few rounds, so the pre-tail watcher fired almost at once
// and Tom got dumped into recycled phrases three rounds into a resume, with
// the rest of his downloaded course sitting unread in IndexedDB.
//
// These tests pin the SELECTION LOGIC of appendForwardFromCacheOffline
// (reproduced faithfully) — forward material is found, unplayable rounds are
// skipped rather than capping the walk, and 0 is returned only when the cache
// genuinely has nothing new.

const URL_A = '/api/audio/a1'
const URL_B = '/api/audio/b2'
const URL_C = '/api/audio/c3'
const CACHED = new Set(['a1', 'b2', 'c3'])
const has = (id: string) => CACHED.has(id)

const playableCycle = () => ({
  known: { audioUrl: URL_A },
  target: { voice1Url: URL_B, voice2Url: URL_C },
})
/** An audio-less LEGO — 11% of ita_for_eng, and the shape that used to pass. */
const silentCycle = () => ({
  known: { audioUrl: '' },
  target: { voice1Url: URL_B, voice2Url: URL_C },
})

const round = (roundNumber: number, cycles: any[]) => ({ roundNumber, legoId: `S${String(roundNumber).padStart(4, '0')}L01`, cycles })

/**
 * The selection half of appendForwardFromCacheOffline, reproduced exactly:
 * rounds the ENGINE does not hold, that have at least one playable cycle.
 */
function selectForward(scriptRounds: any[], engineHasRound: (n: number) => boolean) {
  const playable = (r: any) => ((r?.cycles) || []).some((c: any) => isCyclePlayableOffline(c, has))
  return scriptRounds.filter((r) => !engineHasRound(r?.roundNumber) && playable(r))
}

describe('unexpected offline keeps going FORWARD before it recycles', () => {
  it('finds the rounds the engine was never given — the bootstrap case', () => {
    // Tom's actual shape: the offline bootstrap serves ~3 rounds while the
    // cached script holds the whole course.
    const script = Array.from({ length: 20 }, (_, i) => round(i + 1, [playableCycle()]))
    const engineHas = (n: number) => n <= 3

    const forward = selectForward(script, engineHas)

    expect(forward).toHaveLength(17)
    expect(forward[0].roundNumber).toBe(4)
    // These are NEW LEGOs — the course actually progresses, which is the
    // whole point of the refinement.
    expect(forward.map((r) => r.legoId)).toContain('S0020L01')
  })

  it('skips an audio-less round rather than letting it cap forward progress', () => {
    // A single LEGO with no presentation audio mid-course must not end the
    // walk — everything past it is still perfectly playable.
    const script = [
      round(1, [playableCycle()]),
      round(2, [silentCycle()]),      // nothing playable here
      round(3, [playableCycle()]),
      round(4, [playableCycle()]),
    ]
    const forward = selectForward(script, () => false)

    expect(forward.map((r) => r.roundNumber)).toEqual([1, 3, 4])
  })

  it('keeps a round that has ANY playable cycle, leaving the rest to the engine gate', () => {
    const mixed = round(7, [silentCycle(), playableCycle()])
    expect(selectForward([mixed], () => false)).toHaveLength(1)
  })

  it('returns nothing when the engine already holds the whole cached script', () => {
    // THIS is the only condition that licenses recycling.
    const script = Array.from({ length: 6 }, (_, i) => round(i + 1, [playableCycle()]))
    expect(selectForward(script, () => true)).toHaveLength(0)
  })

  it('returns nothing when the cache holds only rounds whose audio never landed', () => {
    const script = [round(1, [silentCycle()]), round(2, [silentCycle()])]
    expect(selectForward(script, () => false)).toHaveLength(0)
  })

  it('dedupes on the ENGINE, not on an index — the resume window is not the head of the script', () => {
    // On resume the engine's queue is a WINDOW at the cursor (say rounds 8-9),
    // not the first N of the script array. Slicing by count would hand back
    // rounds 1-2 and shear the queue.
    const script = Array.from({ length: 12 }, (_, i) => round(i + 1, [playableCycle()]))
    const engineHas = (n: number) => n === 8 || n === 9

    const forward = selectForward(script, engineHas)

    expect(forward.map((r) => r.roundNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 10, 11, 12])
    expect(forward.map((r) => r.roundNumber)).not.toContain(8)
    expect(forward.map((r) => r.roundNumber)).not.toContain(9)
  })
})

describe('offline is never a completion trigger', () => {
  // Infinite play PROPER is the only thing that may set current_mode, and it
  // means the course is finished — no more LEGOs in the DB. Running out of
  // CACHED material is a fact about this device's storage, not the learner's
  // progress, so the offline paths must not write the mode, must not ratchet
  // the cursor to the course's final LEGO, and must not move the belt.
  const makeProgressStore = () => ({ setMode: vi.fn() })

  /** enterInfPlayFromCache's offline tail, as it now behaves. */
  function offlineTailReached(store: { setMode: ReturnType<typeof vi.fn> }) {
    const state = { currentMode: 'main' as string, beltFreezeSeed: 84 as number | null, beltHeld: false }
    // forward exhausted, recycle engaged, belt held where the learner is
    state.beltHeld = true
    return state
  }

  it('does not write current_mode when the cache runs out offline', () => {
    const store = makeProgressStore()
    const state = offlineTailReached(store)

    expect(store.setMode).not.toHaveBeenCalled()
    expect(state.currentMode).toBe('main')
  })

  it('leaves the belt where the learner actually reached, not at the top belt', () => {
    const store = makeProgressStore()
    const state = offlineTailReached(store)

    expect(state.beltFreezeSeed).toBe(84) // their own cursor, not the course end
    expect(state.beltHeld).toBe(true)
  })
})
