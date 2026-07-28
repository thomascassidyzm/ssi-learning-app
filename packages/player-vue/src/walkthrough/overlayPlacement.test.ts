// Geometry guardrails: the walk card (the overlay's only pointer-eating
// element) must NEVER cover the top chrome — the Learn escape back to the
// player lives there (founder rule: player reachable in one tap on every
// step) — and bottom-anchored placement must clear the home indicator.
import { describe, it, expect } from 'vitest'
import { placeCard, isAnchorUsable, TOP_CHROME_PX, CARD_H_EST, type RectLike } from './overlayPlacement'

const VW = 390
const VH = 844

const rect = (top: number, height: number, left = 20, width = 200): RectLike =>
  ({ top, left, bottom: top + height, right: left + width, width, height })

describe('isAnchorUsable', () => {
  it('rejects null and zero-size rects (hidden elements)', () => {
    expect(isAnchorUsable(null)).toBe(false)
    expect(isAnchorUsable(rect(100, 0))).toBe(false)
    expect(isAnchorUsable(rect(100, 40, 20, 0))).toBe(false)
    expect(isAnchorUsable(rect(100, 40))).toBe(true)
  })
})

describe('placeCard — back-to-player invariant', () => {
  const topOf = (style: { top?: string; bottom?: string }, vh = VH): number =>
    style.top !== undefined
      ? parseFloat(style.top)
      : vh - parseFloat(style.bottom!) - CARD_H_EST

  it('unanchored states go bottom-center with safe-area clearance', () => {
    const s = placeCard(null, VW, VH)
    expect(s.bottom).toContain('env(safe-area-inset-bottom')
    expect(s.top).toBeUndefined()
  })

  it('places below the anchor when there is room', () => {
    const s = placeCard(rect(300, 40), VW, VH)
    expect(parseFloat(s.top!)).toBeGreaterThan(340)
  })

  it('never enters the top-chrome zone when placed above a low anchor', () => {
    // Anchor near the bottom forces above-placement; card top must clear the bar.
    const s = placeCard(rect(VH - 80, 60), VW, VH)
    expect(topOf(s)).toBeGreaterThanOrEqual(TOP_CHROME_PX)
  })

  it('an above-placement that would reach the chrome falls back to bottom-center', () => {
    // Tall anchor: no room below, and above-placement would put the card's
    // top edge at ~42px — inside the Learn-escape zone. Pre-guardrail code
    // allowed this (only checked > 0); it must now fall back.
    const s = placeCard(rect(250, 550), VW, VH)
    expect(s.bottom).toContain('env(safe-area-inset-bottom')
  })

  it('below-placement is clamped out of the chrome even for a top-edge anchor', () => {
    const s = placeCard(rect(0, 10), VW, VH)
    if (s.top !== undefined) expect(parseFloat(s.top)).toBeGreaterThanOrEqual(TOP_CHROME_PX)
  })

  it('respects the measured safe-area top inset (notched PWA)', () => {
    const safeTop = 47 // iPhone notch
    for (let anchorTop = 0; anchorTop < VH; anchorTop += 50) {
      const s = placeCard(rect(anchorTop, 44), VW, VH, safeTop)
      if (s.bottom?.includes('env(')) continue // bottom-center — clear by design
      expect(topOf(s)).toBeGreaterThanOrEqual(safeTop + TOP_CHROME_PX)
    }
  })

  it('oversized anchors (taller than viewport) fall back to bottom-center', () => {
    const s = placeCard(rect(-500, 3000), VW, VH)
    expect(s.bottom).toContain('env(safe-area-inset-bottom')
  })

  it('card width shrinks on narrow viewports and stays inside them', () => {
    const s = placeCard(rect(300, 40), 320, VH)
    expect(parseFloat(s.width)).toBeLessThanOrEqual(320 - 24)
  })
})
