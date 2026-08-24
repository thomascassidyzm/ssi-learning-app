import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { shouldShowInterjection } from './interjectionDisplay'

/**
 * Locks the 2026-08-06 "blank interjection card" bug, reported live on staging
 * 8 minutes into French: while Aran talked, the hero card was a completely
 * empty white box.
 *
 * Two independent failure modes, both locked here:
 *  1. gating — if showInterjection is false the template falls through to the
 *     normal branch and renders the NEXT LEGO, whose text isn't set yet ⇒ empty
 *     card. Any non-welcome commentary must show the wave, including one with a
 *     missing or unrecognised type.
 *  2. contrast — the wave bars and caption were painted with a bare
 *     var(--belt-color). White belt IS #ffffff, so on the Mist white card the
 *     display rendered invisibly. Neither may be a bare belt colour again.
 */
describe('shouldShowInterjection', () => {
  it('shows the wave for both interjection types the service emits', () => {
    expect(shouldShowInterjection(true, 'instruction')).toBe(true)
    expect(shouldShowInterjection(true, 'encouragement')).toBe(true)
  })

  it('leaves the welcome to its own surface', () => {
    expect(shouldShowInterjection(true, 'welcome')).toBe(false)
  })

  it('degrades an unknown or missing type to the wave, never a blank card', () => {
    expect(shouldShowInterjection(true, null)).toBe(true)
    expect(shouldShowInterjection(true, undefined)).toBe(true)
    expect(shouldShowInterjection(true, 'motivation')).toBe(true)
    expect(shouldShowInterjection(true, '')).toBe(true)
  })

  it('shows nothing when no commentary is playing', () => {
    expect(shouldShowInterjection(false, 'instruction')).toBe(false)
    expect(shouldShowInterjection(false, null)).toBe(false)
  })
})

describe('interjection display contrast (LearningPlayer.vue CSS)', () => {
  const css = readFileSync(
    resolve(__dirname, '../components/LearningPlayer.vue'),
    'utf8',
  )

  const ruleBody = (selector: string): string => {
    const at = css.indexOf(`${selector} {`)
    expect(at, `${selector} rule not found`).toBeGreaterThan(-1)
    return css.slice(at, css.indexOf('}', at))
  }

  it('paints the wave bars with an ink-anchored belt colour, not a bare belt colour', () => {
    const body = ruleBody('.interjection-wave .wbar')
    expect(body).toMatch(/background:\s*color-mix\(/)
    expect(body).not.toMatch(/background:\s*var\(--belt-color/)
  })

  it('paints the instruction caption with an ink-anchored belt colour', () => {
    const body = ruleBody('.interjection-caption')
    expect(body).toMatch(/color:\s*color-mix\(/)
    expect(body).not.toMatch(/color:\s*var\(--belt-color/)
  })
})
