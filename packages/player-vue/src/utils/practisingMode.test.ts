/**
 * NO PROGRESS IS WRITTEN FROM MATERIAL THE LEARNER HAS ALREADY DONE.
 * Tom's ruling, 2026-08-31.
 *
 * Two conditions hold that line, and this file models both, because the real
 * gate lives inside a 19k-line SFC where nothing can assert it.
 *
 * 1. PRACTISING — the mode. We could not fetch the next new LEGO, so we are
 *    playing from cache. One trigger, exactly as ruled.
 * 2. RECYCLED PLAYBACK — the floor underneath it. The round on the playhead was
 *    dealt from the offline urn and carries a RANDOM ALREADY-COVERED LEGO's id
 *    at a round index higher than anything before it. A write from there moves
 *    the learner BACKWARDS and survives every future boot. The forward-only
 *    guard on setLivePosition cannot see it: that guard is forward-only on
 *    round INDEX.
 *
 * USAGE YES, PROGRESS NO. Tom's standing ruling, and the reason this file was
 * rewritten: it used to assert that pairings telemetry was blocked during
 * PRACTISING. The real code deliberately does not block it — the learner
 * genuinely turned up and practised, and the brain view would go blank for the
 * session — so the test asserted the opposite of the ruling AND passed, which
 * would have pushed the next agent into re-breaking it.
 *
 * The gate is `practisingBlocksProgressWrite` in LearningPlayer.vue and guards
 * every write primitive: setRemoteCursor, liftLocalCeilingIfHigher,
 * persistCursorAtCurrentRound, persistLivePositionToDb, saveRoundProgress,
 * queueCursor/flushCursor and savePositionToLocalStorage.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { nextPractisingState } from '../playback/practisingMode'

/** Every write the player can make about where a learner is. */
type Write = { kind: string; legoId?: string; roundIndex?: number }

type TestRound = {
  roundNumber: number
  legoId: string
  recycled?: boolean
  cycles: { type: string }[]
}

const mainLoopRound = (n: number, legoId: string): TestRound => ({
  roundNumber: n, legoId, cycles: [{ type: 'intro' }, { type: 'build' }, { type: 'use' }],
})

/** What appendCachedLoopForOffline deals: an OLD lego id at a HIGH round
 *  number, USE-only, stamped. */
const recycledRound = (n: number, oldLegoId: string): TestRound => ({
  roundNumber: n, legoId: oldLegoId, recycled: true,
  cycles: [{ type: 'use' }, { type: 'spaced_rep' }],
})

/**
 * The gate, modelled exactly as the component applies it: one predicate,
 * consulted at the primitive, before anything else in the function runs.
 */
function makePlayer() {
  const writes: Write[] = []
  const state = {
    practising: false,
    beltHeld: false,
    round: mainLoopRound(13, 'S0013L02') as TestRound | null,
    cursorLegoId: 'S0013L02',
    cursorRoundIndex: 13,
    ceilingLegoId: 'S0013L02',
  }
  let pendingCycle: number | null = null

  const isMainLoopRound = (r: TestRound | null) =>
    !!r?.cycles.length && r.cycles.some(c => c.type === 'intro' || c.type === 'debut' || c.type === 'build')

  // recycledRoundOnPlayhead()
  const recycledOnPlayhead = () => {
    const r = state.round
    if (!r) return false
    if (r.recycled === true) return true
    return state.beltHeld && !isMainLoopRound(r)
  }

  const blocked = () => state.practising || recycledOnPlayhead()

  return {
    state,
    writes,
    enterPractising() {
      state.practising = true
      pendingCycle = null // cancelPendingCursor() on entry
    },
    leavePractising() { state.practising = false },
    /** appendCachedLoopForOffline: raises the belt-held flag as it appends. */
    appendRecycledRounds() { state.beltHeld = true },
    playRound(r: TestRound) { state.round = r },

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
    /** persistLivePositionToDb — fires on EVERY round advance, and carries the
     *  round's own legoId. This is the one that wrote learners backwards. */
    persistLivePosition() {
      if (blocked()) return
      const r = state.round
      if (!r) return
      // setLivePosition's DB guard: forward-only on round INDEX only.
      if (r.roundNumber < state.cursorRoundIndex) return
      state.cursorLegoId = r.legoId
      state.cursorRoundIndex = r.roundNumber
      writes.push({ kind: 'live position', legoId: r.legoId, roundIndex: r.roundNumber })
    },
    /** The caller names the round it is writing about — round completion can
     *  be reported just after the playhead has moved on. */
    saveRoundProgress(legoId: string, roundIndex: number, round?: TestRound) {
      if (blocked() || round?.recycled === true) return
      writes.push({ kind: 'round progress', legoId, roundIndex })
    },
    savePositionToLocalStorage(legoId: string) {
      if (blocked()) return
      writes.push({ kind: 'local position', legoId })
    },
    /** USAGE, not progress — deliberately NOT gated (Tom's ruling). */
    recordCyclePlay(legoId: string) {
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

  it('writes no PROGRESS at all once the mode is active', () => {
    player.enterPractising()
    player.setRemoteCursor('S0500L01', 500)
    player.liftLocalCeilingIfHigher('S0500L01', 500)
    player.saveRoundProgress('S0500L01', 500)
    player.savePositionToLocalStorage('S0500L01')
    player.queueCursor(7)
    player.flushCursor()
    expect(player.writes).toEqual([])
  })

  it('keeps recording USAGE while it holds — usage yes, progress no', () => {
    // Tom's standing ruling. Pairings say what the learner HEARD; they are not
    // a claim about how far through the course they are, and the brain view
    // would go blank for the session otherwise. Minutes, sessions and speaking
    // opportunities ride the same rule.
    player.enterPractising()
    player.recordCyclePlay('S0009L02')
    player.recordCyclePlay('S0009L02')
    player.saveRoundProgress('S0500L01', 500)
    expect(player.writes.map(w => w.kind)).toEqual(['lego pairings', 'lego pairings'])
    expect(player.state.cursorLegoId).toBe('S0013L02')
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
    for (let i = 0; i < 30; i++) player.saveRoundProgress('S0009L02', 9)
    expect(player.writes).toEqual([])
  })
})

describe('the recycled-playback floor — a recycled round can NEVER write the cursor', () => {
  let player: ReturnType<typeof makePlayer>
  beforeEach(() => { player = makePlayer() })

  it('blocks the round-advance cursor write even though PRACTISING never engaged', () => {
    // THE BLOCKER, reproduced. The learner is at round 13 / S0013L02. The
    // queue runs dry, recycled rounds are appended at round 900+ carrying an
    // OLD lego id, and the mode is off because the fetch reported 'skipped'.
    player.appendRecycledRounds()
    player.playRound(recycledRound(900, 'S0002L01'))
    expect(player.state.practising).toBe(false)

    player.persistLivePosition()
    player.liftLocalCeilingIfHigher('S0002L01', 900)

    expect(player.writes).toEqual([])
    expect(player.state.cursorLegoId).toBe('S0013L02')  // NOT moved backwards
    expect(player.state.ceilingLegoId).toBe('S0013L02')
  })

  it('is not saved by the forward-only guard, which is why the floor is needed', () => {
    // Prove the guard is no protection: the recycled round's INDEX is higher,
    // so the write sails through it. Without the floor, this is the backwards
    // write. (Gate deliberately bypassed here to show what it is stopping.)
    const p = makePlayer()
    p.playRound(recycledRound(900, 'S0002L01'))   // no flag, no stamp read: gate off
    p.state.round!.recycled = false
    p.persistLivePosition()
    expect(p.state.cursorLegoId).toBe('S0002L01')  // ← the unforgivable outcome
    expect(p.state.cursorRoundIndex).toBe(900)
  })

  it('holds even if the recovery probe lowers the mode mid-recycled-round', () => {
    // The 60s probe flips the mode on a clock, decoupled from playback, so it
    // can open the gate while a recycled round is still on the playhead.
    player.appendRecycledRounds()
    player.enterPractising()
    player.playRound(recycledRound(901, 'S0004L03'))
    player.leavePractising()   // probe succeeded mid-round
    player.persistLivePosition()
    expect(player.writes).toEqual([])
    expect(player.state.cursorLegoId).toBe('S0013L02')
  })

  it('holds on the skipped/timeout path — a slow connection never reports failed', () => {
    // A slow-but-working connection aborts at the fetch budget and reports
    // 'skipped', which by design leaves the mode alone. That is the weak-
    // connection case this whole thing exists for, so the floor must carry it.
    expect(nextPractisingState(false, 'skipped')).toBe(false)
    player.appendRecycledRounds()
    player.playRound(recycledRound(902, 'S0001L01'))
    player.persistLivePosition()
    player.saveRoundProgress('S0001L01', 902)
    player.savePositionToLocalStorage('S0001L01')
    expect(player.writes).toEqual([])
    expect(player.state.cursorLegoId).toBe('S0013L02')
  })

  it('holds for a course with no round map, where the mode can never engage', () => {
    // prefetchTier3 returns 'skipped' immediately and forever without a round
    // map, so PRACTISING is unreachable for that course — but the offline
    // recycle loop is not.
    expect(nextPractisingState(false, 'skipped')).toBe(false)
    player.appendRecycledRounds()
    player.playRound(recycledRound(903, 'S0007L02'))
    player.persistLivePosition()
    expect(player.writes).toEqual([])
  })

  it('blocks on the stamp alone, with no flag raised at all', () => {
    // Belt and braces: a future path that recycles without touching the
    // belt-held flag is still refused.
    player.playRound(recycledRound(904, 'S0003L01'))
    expect(player.state.beltHeld).toBe(false)
    player.persistLivePosition()
    expect(player.writes).toEqual([])
    expect(player.state.cursorLegoId).toBe('S0013L02')
  })

  it('refuses a completion write for a recycled round even once the playhead has moved on', () => {
    // The round just completed is not always the round on the playhead. It is
    // the round being WRITTEN ABOUT that must not be recycled.
    const justCompleted = recycledRound(906, 'S0002L01')
    player.playRound(mainLoopRound(14, 'S0014L01'))
    player.saveRoundProgress(justCompleted.legoId, justCompleted.roundNumber, justCompleted)
    expect(player.writes).toEqual([])
  })

  it('does NOT block real forward work when recycled rounds are merely APPENDED', () => {
    // The over-block, fixed in the same pass. The flag is raised where rounds
    // are appended, which can happen mid-round while genuine main-loop content
    // is still playing — that round's remaining writes are real progress.
    player.appendRecycledRounds()
    player.playRound(mainLoopRound(14, 'S0014L01'))
    player.persistLivePosition()
    expect(player.writes.map(w => w.kind)).toEqual(['live position'])
    expect(player.state.cursorLegoId).toBe('S0014L01')
  })

  it('records normally again once real main-loop content resumes', () => {
    player.appendRecycledRounds()
    player.playRound(recycledRound(905, 'S0002L01'))
    player.persistLivePosition()
    expect(player.writes).toEqual([])

    // Network back, expandScript produced real rounds; the watcher clears the flag.
    player.state.beltHeld = false
    player.playRound(mainLoopRound(14, 'S0014L01'))
    player.persistLivePosition()
    expect(player.state.cursorLegoId).toBe('S0014L01')
  })
})

describe('the next-new-LEGO outcome map', () => {
  it('enters on a genuine failure and leaves on a success, and on nothing else', () => {
    expect(nextPractisingState(false, 'failed')).toBe(true)
    expect(nextPractisingState(true, 'fetched')).toBe(false)
    expect(nextPractisingState(false, 'no-next')).toBe(false)
    expect(nextPractisingState(true, 'no-next')).toBe(true)
    expect(nextPractisingState(true, 'skipped')).toBe(true)
  })
})
