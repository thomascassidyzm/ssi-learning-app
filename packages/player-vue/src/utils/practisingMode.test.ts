/**
 * PRACTISING writes nothing. Tom's ruling, 2026-08-31.
 *
 * The mode is "we are playing from cache because we could not fetch the next
 * new LEGO". Its whole safety property is that NO LEGO progress is captured
 * while it holds — so a weak connection cannot move a learner, by construction
 * rather than by a check happening to be right.
 *
 * The gate itself lives in LearningPlayer.vue as practisingBlocksProgressWrite
 * and guards every write primitive: setRemoteCursor, liftLocalCeilingIfHigher,
 * persistCursorAtCurrentRound, persistLivePositionToDb, saveRoundProgress,
 * queueCursor/flushCursor, savePositionToLocalStorage, and the per-LEGO
 * pairings telemetry. These tests model that gate's contract against a fake
 * progress store, so the rule is asserted somewhere a 19k-line SFC is not.
 */

import { describe, it, expect, beforeEach } from 'vitest'

/** Every write the player can make about where a learner is. */
type Write = { kind: string; legoId?: string; roundIndex?: number }

/**
 * The gate, modelled exactly as the component applies it: one predicate,
 * consulted at the primitive, before anything else in the function runs.
 */
function makePlayer() {
  const writes: Write[] = []
  const state = { practising: false, cursorLegoId: 'S0013L02', ceilingLegoId: 'S0013L02' }
  let pendingCycle: number | null = null

  const blocked = () => state.practising

  return {
    state,
    writes,
    enterPractising() {
      state.practising = true
      pendingCycle = null // cancelPendingCursor() on entry
    },
    leavePractising() { state.practising = false },

    setRemoteCursor(legoId: string, roundIndex: number) {
      if (blocked()) return
      state.cursorLegoId = legoId
      writes.push({ kind: 'remote cursor', legoId, roundIndex })
    },
    liftLocalCeilingIfHigher(legoId: string, roundIndex: number) {
      if (blocked()) return
      state.ceilingLegoId = legoId
      writes.push({ kind: 'local ceiling ratchet', legoId, roundIndex })
    },
    saveRoundProgress(legoId: string, roundIndex: number) {
      if (blocked()) return
      writes.push({ kind: 'round progress', legoId, roundIndex })
    },
    savePositionToLocalStorage(legoId: string) {
      if (blocked()) return
      writes.push({ kind: 'local position', legoId })
    },
    recordCyclePlay(legoId: string) {
      if (blocked()) return
      writes.push({ kind: 'lego pairings', legoId })
    },
    queueCursor(idx: number) {
      if (blocked()) return
      pendingCycle = idx
    },
    flushCursor() {
      const p = pendingCycle
      pendingCycle = null
      if (blocked()) return
      if (p === null) return
      writes.push({ kind: 'current cycle', roundIndex: p })
    },
  }
}

/** The course's final LEGO — the value the corruption used to stamp. */
const FINAL_LEGO = 'S1399L01'

describe('PRACTISING mode', () => {
  let player: ReturnType<typeof makePlayer>
  beforeEach(() => { player = makePlayer() })

  it('records progress normally when it is NOT practising', () => {
    player.saveRoundProgress('S0014L01', 14)
    player.setRemoteCursor('S0014L01', 14)
    expect(player.writes).toHaveLength(2)
    expect(player.state.cursorLegoId).toBe('S0014L01')
  })

  it('writes NOTHING at all once the mode is active', () => {
    player.enterPractising()
    player.setRemoteCursor('S0500L01', 500)
    player.liftLocalCeilingIfHigher('S0500L01', 500)
    player.saveRoundProgress('S0500L01', 500)
    player.savePositionToLocalStorage('S0500L01')
    player.recordCyclePlay('S0500L01')
    player.queueCursor(7)
    player.flushCursor()
    expect(player.writes).toEqual([])
  })

  it('cannot be stamped to the end of the course — the corruption route, closed', () => {
    player.enterPractising()
    // The exact call the old auto-entry made, on a round that merely LOOKED
    // like infinite play because it came out of the cache.
    player.saveRoundProgress(FINAL_LEGO, 1399)
    player.setRemoteCursor(FINAL_LEGO, 1399)
    player.liftLocalCeilingIfHigher(FINAL_LEGO, 1399)
    expect(player.state.cursorLegoId).toBe('S0013L02')
    expect(player.state.ceilingLegoId).toBe('S0013L02')
  })

  it('drops a cursor write queued before the connection died', () => {
    // The per-cycle write is throttled to 60s, so one can be in the queue at
    // the moment the mode engages. It must not land from inside the mode.
    player.queueCursor(4)
    player.enterPractising()
    player.flushCursor()
    expect(player.writes).toEqual([])
  })

  it('leaves the learner exactly where they were, and resumes writing on exit', () => {
    const before = { ...player.state }
    player.enterPractising()
    for (let r = 0; r < 50; r++) player.saveRoundProgress(`S0${500 + r}L01`, 500 + r)
    expect(player.state.cursorLegoId).toBe(before.cursorLegoId)
    expect(player.state.ceilingLegoId).toBe(before.ceilingLegoId)

    // Real content reachable again — normal behaviour, from the unchanged position.
    player.leavePractising()
    player.saveRoundProgress('S0014L01', 14)
    player.setRemoteCursor('S0014L01', 14)
    expect(player.writes.map(w => w.kind)).toEqual(['round progress', 'remote cursor'])
    expect(player.state.cursorLegoId).toBe('S0014L01')
  })

  it('accepts the consequence: an offline stretch earns no recorded progress', () => {
    // Stated rather than designed around. Cached material is by definition work
    // already done, so there is no new progress being lost.
    player.enterPractising()
    for (let i = 0; i < 30; i++) player.recordCyclePlay('S0009L02')
    expect(player.writes).toEqual([])
  })
})
