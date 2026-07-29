/**
 * overlayPlacement — pure geometry for WalkOverlay's card and anchor checks.
 *
 * Split out of the component so the two runtime guardrails that live in
 * geometry are unit-testable:
 *
 * 1. Back-to-player invariant (founder rule): the player must be reachable in
 *    ONE tap on every walk step. On the schools/admin shells that tap is the
 *    top bar's Learn escape (54px tall + top safe-area inset) — so the walk
 *    card, the only pointer-eating part of the overlay, is NEVER placed into
 *    that zone. If an anchor-relative placement would reach it, the card
 *    drops to bottom-center instead (the ring still marks the element).
 * 2. Anchor-drift honesty: an element that resolves but has collapsed to zero
 *    size (v-show off, display:none ancestor, emptied container) is NOT a
 *    usable anchor — binding it would pulse a ring at 0,0 pointing at nothing.
 */

export interface RectLike {
  top: number
  left: number
  bottom: number
  right: number
  width: number
  height: number
}

/** Base height of SchoolsTopBar / AdminTopBar — the Learn-escape zone. */
export const TOP_CHROME_PX = 54
export const PAD = 6
export const CARD_W = 340
export const CARD_H_EST = 190
const EDGE = 12

/** A resolved element only counts as an anchor if it occupies real space. */
export function isAnchorUsable(rect: RectLike | null): boolean {
  return !!rect && rect.width > 0 && rect.height > 0
}

// Type alias (not interface) so it stays assignable to Vue's CSSProperties.
export type CardStyle = {
  left?: string
  top?: string
  bottom?: string
  width: string
}

/**
 * Place the card near the anchor without ever covering the top chrome.
 * `safeTop` = measured env(safe-area-inset-top) in px (0 on desktop).
 * Pass rect=null for terminal / timed-out / unanchored states.
 */
export function placeCard(rect: RectLike | null, vw: number, vh: number, safeTop = 0): CardStyle {
  const w = Math.min(CARD_W, vw - 24)
  const bottomCenter: CardStyle = {
    left: `${(vw - w) / 2}px`,
    // Standing safe-area rule: bottom-anchored chrome clears the home indicator.
    bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
    width: `${w}px`,
  }
  if (!rect) return bottomCenter
  const minTop = safeTop + TOP_CHROME_PX + EDGE
  const left = Math.max(EDGE, Math.min(rect.left, vw - w - EDGE))
  const below = rect.bottom + PAD + EDGE
  if (below + CARD_H_EST < vh) {
    return { left: `${left}px`, top: `${Math.max(below, minTop)}px`, width: `${w}px` }
  }
  const above = rect.top - PAD - EDGE
  // Card would span [above - CARD_H_EST, above] — only allowed when its top
  // edge stays clear of the Learn-escape zone.
  if (above - CARD_H_EST > minTop && rect.top <= vh) {
    return { left: `${left}px`, bottom: `${vh - above}px`, width: `${w}px` }
  }
  // Anchor taller than the viewport, off-screen, or too close to the top
  // chrome: quiet bottom-center — reachable, and never over the escape.
  return bottomCenter
}
