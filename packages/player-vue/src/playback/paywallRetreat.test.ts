/**
 * A paywall retreat never LOSES the learner's real position (job #734 follow-up).
 *
 * Pure half: the memory holds the first real spot, blocks every position write
 * while held, and hands the spot back only once a fresh entitlement lets the
 * learner play that seed. Wiring half: reading LearningPlayer.vue — before this
 * fix the resume gate retreated and then, on the same tick, wrote the retreated
 * cursor to localStorage and the DB, and the grant watcher resumed from the
 * retreat. These assertions are RED on that code.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPaywallRetreat } from './paywallRetreat'

const canAccessUpTo = (max: number) => (seed: number) => seed <= max
/** A live queue: the round index that carries each LEGO. */
const queue = (legos: string[]) => (legoId: string) => legos.indexOf(legoId)
const FULL = ['S0001L01', 'S0001L02', ...Array.from({ length: 54 }, (_, i) => `S00${String(2 + Math.floor(i / 2)).padStart(2, '0')}L0${1 + (i % 2)}`), 'S0031L01']

describe('createPaywallRetreat', () => {
  it('holds nothing until a retreat happens, so ordinary writes are never blocked', () => {
    const m = createPaywallRetreat()
    expect(m.blocksPersist()).toBe(false)
    expect(m.takeRestore(canAccessUpTo(999), queue(FULL))).toBeNull()
  })

  it('remembers the REAL spot and blocks position writes while held', () => {
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 52, cycleIndex: 3, legoId: 'S0031L02' })
    expect(m.blocksPersist()).toBe(true)
    expect(m.current()).toEqual({ roundIndex: 52, cycleIndex: 3, legoId: 'S0031L02' })
  })

  it('a second retreat while one is held does not replace the real spot', () => {
    // "Maybe later" retreated to round 33; a later gate call from round 33 must
    // not overwrite the memory of round 52.
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 52, cycleIndex: 0, legoId: 'S0031L02' })
    m.remember({ roundIndex: 33, cycleIndex: 0, legoId: 'S0019L02' })
    expect(m.current()?.roundIndex).toBe(52)
  })

  it('hands the spot back only when the fresh entitlement lets the learner play that seed', () => {
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 52, cycleIndex: 3, legoId: 'S0031L02' })
    // Still the stale preview: seed 31 locked — nothing to restore.
    expect(m.takeRestore(canAccessUpTo(19), queue(FULL))).toBeNull()
    // The refreshed snapshot grants the course.
    expect(m.takeRestore(canAccessUpTo(999), queue([...FULL, 'S0031L02']))).toEqual({ roundIndex: 57, cycleIndex: 3, legoId: 'S0031L02' })
    // Restoring does not spend the memory: the restoring jump's own round
    // write must still be blocked until play actually resumes.
    expect(m.blocksPersist()).toBe(true)
    m.clear()
    expect(m.blocksPersist()).toBe(false)
    expect(m.takeRestore(canAccessUpTo(999), queue(FULL))).toBeNull()
  })

  it('restores by LEGO in the LIVE queue, never by the index the queue had at retreat time', () => {
    // Staging, 2026-09-14: the bootstrap queue was a 2-round window with the
    // resume LEGO at round 0; the full-script handoff then swapped in all
    // 3,262 rounds, where round 0 is S0001L01. Jumping to the remembered
    // index 0 sent the learner to the start of the course.
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 0, cycleIndex: 0, legoId: 'S0031L01' })
    const restored = m.takeRestore(canAccessUpTo(999), queue(FULL))
    expect(restored?.roundIndex).toBe(FULL.indexOf('S0031L01'))
    expect(restored?.roundIndex).toBe(56)
    // A live queue that does not carry the LEGO yet: stay put rather than guess.
    expect(m.takeRestore(canAccessUpTo(999), queue(['S0001L01', 'S0001L02']))).toBeNull()
  })

  it('ignores a spot it cannot jump back to', () => {
    const m = createPaywallRetreat()
    m.remember({ roundIndex: -1, cycleIndex: 0, legoId: 'S0031L02' })
    expect(m.blocksPersist()).toBe(false)
  })
})

describe('LearningPlayer wiring (source read)', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/LearningPlayer.vue'), 'utf8')

  function block(startMarker: string, endMarker: string): string {
    const s = src.indexOf(startMarker)
    expect(s, `marker not found: ${startMarker}`).toBeGreaterThan(-1)
    const e = src.indexOf(endMarker, s)
    expect(e, `end marker not found: ${endMarker}`).toBeGreaterThan(s)
    return src.slice(s, e)
  }

  it('the retreat remembers the real position before it moves the cursor', () => {
    const fn = block('function settleCursorAtPaywall()', '\n}\n')
    const remember = fn.indexOf('paywallRetreat.remember(')
    const jump = fn.indexOf('simplePlayer.jumpToRound(landing)')
    expect(remember).toBeGreaterThan(-1)
    expect(jump).toBeGreaterThan(remember)
  })

  it('neither position write runs while the real position is held', () => {
    const db = block('const persistLivePositionToDb = (', '\nconst saveRoundProgress')
    expect(db).toContain('if (paywallRetreat.blocksPersist()) return')
    const local = block('const savePositionToLocalStorage = (', '\n}\n')
    expect(local).toContain('if (paywallRetreat.blocksPersist()) return')
  })

  it('the navigation cursor writer and the mid-round cycle writer honour the hold too (job #757 addition)', () => {
    // Cold verify of #752: previous-phrase after "Maybe later" went
    // persistCursorAtCurrentRound → setRemoteCursor → setEnrollmentCursor,
    // which permits a backward write — so the DB cursor took a preview
    // position while localStorage stayed protected. Every DB cursor writer
    // consults the hold: the live-position writer, this one, and the
    // throttled current_cycle_index queue (a preview round's cycle index
    // against the held LEGO's row would mislead the same-sitting resume).
    const remote = block('const setRemoteCursor = async (', '\n}\n')
    expect(remote).toContain('if (paywallRetreat.blocksPersist()) return')
    const queue = block('const cursorQueue = createCursorQueue({', '\n})\n')
    expect(queue).toContain('paywallRetreat.blocksPersist()')
  })

  it('the post-init gate waits for the subscription answer before deciding the hold (job #757 addition)', () => {
    // While the answer is optimistic every canAccessSeed says yes, so the
    // hold was skipped and the lifecycle save wrote the preview landing over
    // the real place in localStorage — one open in four on served staging.
    const w = block('watch(positionInitialized, (init) => {', '\n})\n')
    expect(w).toContain('if (!entitlementComposable.accessPending()) { runPostInitResumeGate(); return }')
    expect(w).toContain('watch(entitlementComposable.subscriptionHydrated')
    const gate = block('const runPostInitResumeGate = () => {', '\n}\n')
    expect(gate).toContain('holdSavedCursorAtPaywall()')
    expect(gate.indexOf('holdSavedCursorAtPaywall()')).toBeLessThan(gate.indexOf('savePositionToLocalStorage(undefined, false)'))
  })

  it('a grant jumps back to the real position before resuming', () => {
    const w = block('watch(liveEntitlements, () => {', '\n})\n')
    const restore = w.indexOf('tryRestoreHeldPosition()')
    const resume = w.indexOf('simplePlayer.resume()')
    expect(restore).toBeGreaterThan(-1)
    // The restore itself (by LEGO against the live engine queue, verified
    // landing) lives in paywallGrant.ts and is tested with a fake engine.
    expect(resume).toBeGreaterThan(restore)
    // Job #757: a restore that cannot find the held LEGO in the live queue
    // RECOVERS (refetch under the grant, swap, restore) instead of leaving
    // the learner paused with the wall down; resume rides the recovery.
    expect(w).toContain("if (action === 'lower-and-recover')")
    expect(w).toContain('void recoverHeldPositionAfterGrant(wallWasUp)')
    expect(w).not.toContain('paused at the retreat')
    const recover = block('async function recoverHeldPositionAfterGrant(', '\n}\n')
    expect(recover).toContain('refetchScriptUnderGrant')
    expect(recover).toContain('if (resumeWhenLanded) simplePlayer.resume()')
    const refetch = block('const refetchScriptUnderGrant = async', '\n}\n')
    expect(refetch).toContain('getCourseBundle(code, { forceRefresh: true })')
    expect(refetch).toContain('mergeGeneratedRoundsIntoQueue(result)')
  })

  it('the memory is spent only when a prompt plays with the wall down, on the remembered round', () => {
    // Job #752 narrowed this: a prompt on some OTHER round (playing on inside
    // the preview after "Maybe later") leaves the real place held, so the
    // stored cursors stay where the learner really was.
    const w = block("watch(() => simplePlayer.phase.value, (phase) => {", '\n})\n')
    expect(w).toContain('if (!showPaywall.value) paywallRetreat.release(')
    expect(src.match(/paywallRetreat\.clear\(\)/g)).toBeNull()
  })
})
