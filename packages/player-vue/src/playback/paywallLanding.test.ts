/**
 * The paywall never sends a learner back to the start of the course (job #734).
 *
 * Two halves. The pure landing rule is proved directly. The wiring is proved by
 * reading LearningPlayer.vue: before this fix both `dismissPaywall` and the
 * post-init resume gate called `simplePlayer.jumpToRound(0)` — the source
 * assertions below are RED on that code and green once both sites route
 * through `paywallLandingRound`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { paywallLandingRound, seedNumberOfRound } from './paywallLanding'

const PREVIEW_MAX_SEED = 19 // end of Yellow
const canAccess = (seed: number) => seed <= PREVIEW_MAX_SEED

/** Tom's queue shape on 2026-09-14: round 13 is S0008L01 (start of Yellow),
 *  round 33 is S0019L02 (last of Yellow), round 34 is S0020L01 (Orange). */
function rounds() {
  const out: { legoId: string; seedId: string }[] = []
  const push = (seed: number, legos: number) => {
    for (let l = 1; l <= legos; l++) out.push({ legoId: `S${String(seed).padStart(4, '0')}L${String(l).padStart(2, '0')}`, seedId: `S${String(seed).padStart(4, '0')}` })
  }
  push(1, 2); push(2, 2); push(3, 2); push(4, 2); push(5, 2); push(6, 2); push(7, 1) // 0..12
  push(8, 2); push(9, 3); push(10, 1); push(11, 3); push(12, 2); push(13, 1); push(14, 1); push(15, 1); push(16, 1); push(17, 2); push(18, 2); push(19, 2) // 13..33
  push(20, 2); push(21, 2) // 34..37
  return out
}

describe('paywallLandingRound', () => {
  const q = rounds()

  it('reads the seed from seedId or legoId', () => {
    expect(seedNumberOfRound({ seedId: 'S0020' })).toBe(20)
    expect(seedNumberOfRound({ legoId: 'S0019L02' })).toBe(19)
    expect(seedNumberOfRound({ legoId: 'x' })).toBeNull()
    expect(seedNumberOfRound(null)).toBeNull()
  })

  it('a learner still inside the preview stays exactly where they are', () => {
    // The lego-skip gate refused round 34 and left the cursor on round 33.
    expect(q[33].legoId).toBe('S0019L02')
    expect(paywallLandingRound(33, q, canAccess)).toBeNull()
    // Belt-skip gate refused Orange from the start of Yellow.
    expect(paywallLandingRound(13, q, canAccess)).toBeNull()
  })

  it('a cursor already past the wall retreats to the LAST free round, never round 0', () => {
    // advanceRound bumped roundIndex into S0020L01 before the boundary check paused.
    expect(q[34].legoId).toBe('S0020L01')
    expect(paywallLandingRound(34, q, canAccess)).toBe(33)
    // A saved position deep in locked territory on a cold load.
    expect(paywallLandingRound(37, q, canAccess)).toBe(33)
  })

  it('never lands past the end of the queue and tolerates unreadable rounds', () => {
    expect(paywallLandingRound(99, q, canAccess)).toBeNull()
    expect(paywallLandingRound(-1, q, canAccess)).toBeNull()
    const odd = [{ legoId: 'S0001L01' }, { legoId: null }, { legoId: 'S0020L01' }]
    expect(paywallLandingRound(2, odd, canAccess)).toBe(1)
  })

  it('falls back to 0 only when nothing is accessible', () => {
    expect(paywallLandingRound(2, q, () => false)).toBe(0)
  })
})

describe('LearningPlayer wiring (source read)', () => {
  // process.cwd() anchoring: happy-dom breaks fileURLToPath(import.meta.url).
  const src = readFileSync(join(process.cwd(), 'src/components/LearningPlayer.vue'), 'utf8')

  function block(startMarker: string, endMarker: string): string {
    const s = src.indexOf(startMarker)
    expect(s, `marker not found: ${startMarker}`).toBeGreaterThan(-1)
    const e = src.indexOf(endMarker, s)
    expect(e, `end marker not found: ${endMarker}`).toBeGreaterThan(s)
    return src.slice(s, e)
  }

  it('dismissPaywall no longer rewinds to round 0', () => {
    const fn = block('function dismissPaywall()', '\nfunction onPaywallKeydown')
    expect(fn).not.toContain('jumpToRound(0)')
    expect(fn).toContain('settleCursorAtPaywall()')
  })

  it('the post-init resume gate no longer rewinds to round 0', () => {
    const gate = block('// RESUME GATE:', 'savePositionToLocalStorage(undefined, false)')
    expect(gate).not.toContain('jumpToRound(0)')
    expect(gate).toContain('settleCursorAtPaywall()')
  })

  it('settleCursorAtPaywall is the pure landing rule and nothing else decides the cursor', () => {
    const fn = block('function settleCursorAtPaywall()', '\n}\n')
    expect(fn).toContain('paywallLandingRound(')
    expect(fn).not.toContain('jumpToRound(0)')
  })

  it('raising the wall refreshes the entitlement snapshot so a stale one cannot be the final word', () => {
    const w = block('watch(showPaywall, (open) => {', '\nonUnmounted(')
    expect(w).toContain('refreshLiveEntitlements()')
  })
})
