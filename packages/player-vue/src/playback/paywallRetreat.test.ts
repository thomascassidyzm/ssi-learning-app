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

describe('createPaywallRetreat', () => {
  it('holds nothing until a retreat happens, so ordinary writes are never blocked', () => {
    const m = createPaywallRetreat()
    expect(m.blocksPersist()).toBe(false)
    expect(m.takeRestore(canAccessUpTo(999))).toBeNull()
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
    expect(m.takeRestore(canAccessUpTo(19))).toBeNull()
    // The refreshed snapshot grants the course.
    expect(m.takeRestore(canAccessUpTo(999))).toEqual({ roundIndex: 52, cycleIndex: 3, legoId: 'S0031L02' })
    // Restoring does not spend the memory: the restoring jump's own round
    // write must still be blocked until play actually resumes.
    expect(m.blocksPersist()).toBe(true)
    m.clear()
    expect(m.blocksPersist()).toBe(false)
    expect(m.takeRestore(canAccessUpTo(999))).toBeNull()
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

  it('a grant jumps back to the real position before resuming', () => {
    const w = block('watch(liveEntitlements, () => {', '\n})\n')
    const restore = w.indexOf('paywallRetreat.takeRestore(')
    const resume = w.indexOf('simplePlayer.resume()')
    expect(restore).toBeGreaterThan(-1)
    expect(w).toContain('simplePlayer.jumpToRound(restore.roundIndex, restore.cycleIndex)')
    expect(resume).toBeGreaterThan(restore)
  })

  it('the memory is spent only when a prompt plays with the wall down', () => {
    const w = block("watch(() => simplePlayer.phase.value, (phase) => {", '\n})\n')
    expect(w).toContain('if (!showPaywall.value) paywallRetreat.clear()')
    expect(src.match(/paywallRetreat\.clear\(\)/g)?.length).toBe(1)
  })
})
