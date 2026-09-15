/**
 * An UNENTITLED learner whose saved position lies past the free preview is
 * held at the wall, never dropped to the first LEGO (job #752, follow-up to
 * #734 / #745; Tom's rule 2026-09-14: a paywall never moves a learner's belt
 * or position back to the start of the course).
 *
 * Staging, build dc04740, +colombo-wall (empty entitlement list) with
 * S0031L01 saved on cym_s_for_eng: the preview-only bundle has no S0031L01,
 * the cycles fetch 403s, the legacy walk lands on S0001L01 and the lifecycle
 * save writes seed 1 over the saved place in localStorage, no wall shown.
 *
 * Pure halves: the beyond-slice landing rule and the memory's release rule.
 * Wiring half: reading LearningPlayer.vue. All RED on the pre-fix code.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beyondSliceLanding } from '../utils/resolveResumeAnchor'
import { createPaywallRetreat } from './paywallRetreat'

describe('beyondSliceLanding', () => {
  const last = { legoId: 'S0019L05', seed: 19 }
  it('a cursor past the last round of a sliced round set lands on that last round', () => {
    expect(beyondSliceLanding('S0031L01', last)).toBe('S0019L05')
    expect(beyondSliceLanding('S0020L01', { legoId: 'S0019L05' })).toBe('S0019L05')
  })
  it('does not apply to a cursor inside or at the slice, or to nothing', () => {
    expect(beyondSliceLanding('S0019L05', last)).toBeNull()
    expect(beyondSliceLanding('S0003L01', last)).toBeNull()
    expect(beyondSliceLanding(null, last)).toBeNull()
    expect(beyondSliceLanding('S0031L01', null)).toBeNull()
    expect(beyondSliceLanding('garbage', last)).toBeNull()
  })
})

describe('createPaywallRetreat.release', () => {
  it('spends the memory only when the learner is playing the remembered round', () => {
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 33, cycleIndex: 0, legoId: 'S0031L01' })
    // "Maybe later", then playing on inside the preview: the real place is
    // still S0031L01 and the stored cursors must stay on it.
    m.release('S0019L05')
    expect(m.blocksPersist()).toBe(true)
    // Back on the remembered round (a grant restored it): spent.
    m.release('S0031L01')
    expect(m.blocksPersist()).toBe(false)
  })
  it('a memory with no LEGO is spent by any prompt, as before', () => {
    const m = createPaywallRetreat()
    m.remember({ roundIndex: 3, cycleIndex: 0, legoId: null })
    m.release('S0001L01')
    expect(m.blocksPersist()).toBe(false)
  })
  it('releasing with nothing held is a no-op', () => {
    const m = createPaywallRetreat()
    m.release('S0001L01')
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

  it('the resume gate holds a SAVED cursor past the wall: remembers it, lands on the last free round, raises the wall', () => {
    // Since job #757 the gate body lives in runPostInitResumeGate, which the
    // positionInitialized watcher runs once the subscription answer lands.
    const w = block('const runPostInitResumeGate = () => {', '\n}\n')
    const hold = w.indexOf('holdSavedCursorAtPaywall(')
    expect(hold).toBeGreaterThan(-1)
    // Held BEFORE the lifecycle saves, so the saves are blocked.
    expect(hold).toBeLessThan(w.indexOf('savePositionToLocalStorage(undefined, false)'))
    const fn = block('function holdSavedCursorAtPaywall(', '\n}\n')
    expect(fn).toContain('resolveAuthoritativePosition(')
    expect(fn).toContain('paywallRetreat.remember(')
    expect(fn).toContain('paywallLandingRound(')
    expect(fn).toContain('showPaywall.value = true')
    expect(fn.indexOf('paywallRetreat.remember(')).toBeLessThan(fn.indexOf('simplePlayer.jumpToRound('))
  })

  it('the memory is spent by a prompt on the remembered round, not by any prompt', () => {
    const w = block("watch(() => simplePlayer.phase.value, (phase) => {", '\n})\n')
    expect(w).toContain('paywallRetreat.release(')
    expect(w).not.toContain('paywallRetreat.clear()')
  })

  it('a local cursor that wins authority is still clamped to the round map, so a sliced map lands on its last round', () => {
    const fn = block('resolveStartLegoId: async () => {', '\n  },\n')
    // The old early return handed the local LEGO straight to bootstrap, which
    // then asked /cycles for a LEGO the preview map does not have (403).
    expect(fn).not.toContain("if (winner.source !== 'server') {\n      return winner.legoId\n    }")
    expect(fn).toContain('resolveResumeStart({')
  })

  it('the cache fast-path lands a beyond-slice cursor on the last cached round, never round 1', () => {
    const fp = block('const fastRounds = cachedScript.rounds as any[]', 'if (resumeRoundIndex > 0 || resumeCycle > 0)')
    expect(fp).toContain('beyondSliceLanding(')
  })
})
