/**
 * useInAppBrowser — one shared overlay that opens saysomethingin.com pages
 * *inside* the app instead of throwing the learner out to a browser tab.
 *
 * Why this exists: the app installs as a standalone PWA. A `target="_blank"`
 * from a standalone PWA hands the learner to Safari/Chrome, and coming back is
 * a manual app-switch — mid-session that costs them their place. Owner ruling
 * 2026-08-18: "that should probably open within the app, rather than go
 * outside of things."
 *
 * The framing constraint, and why this is an allowlist and not a probe.
 * A page can forbid being iframed via `X-Frame-Options` or a `frame-ancestors`
 * CSP, and a browser gives JavaScript **no** way to read those headers
 * cross-origin or to reliably observe the refusal — a blocked iframe still
 * fires `load` in Chromium. So a runtime probe would need a server round-trip
 * on every tap to tell us something that is a fixed property of the host.
 * A host allowlist is deterministic, costs nothing at runtime, and is honest
 * about what it knows. Headers verified live 2026-08-18:
 *
 *   www.saysomethingin.com          200, no XFO, no frame-ancestors  → frames
 *   saysomethingin.com              same site                        → frames
 *   en.saysomethingin.com           X-Frame-Options: SAMEORIGIN      → refuses
 *   forum.saysomethingin.com        X-Frame-Options: SAMEORIGIN      → refuses
 *
 * If a host's headers change, change this list — do not add a probe.
 *
 * Degradation, deliberately in two different shapes:
 * · A host we KNOW refuses never opens an empty sheet. It goes straight to a
 *   real browser tab, exactly as it does today. Showing a card that says "this
 *   opens in your browser" before doing the thing the learner already asked for
 *   is a tax, not a courtesy.
 * · A host we EXPECT to frame, that then doesn't load, shows an honest card
 *   inside the overlay with a tap-through. That is the unexpected case, and a
 *   silent white sheet is the failure mode we are avoiding.
 */

import { ref, readonly } from 'vue'

/** Hosts verified to permit framing. Everything else opens externally. */
const FRAMEABLE_HOSTS = ['saysomethingin.com', 'www.saysomethingin.com']

/** How long a frameable page gets to load before we offer the way out. */
export const FRAME_LOAD_TIMEOUT_MS = 8000

export interface InAppBrowserTarget {
  url: string
  /** Shown in the overlay header. Falls back to the host. */
  title: string
}

/**
 * Can this URL be shown in an iframe?
 *
 * Only https is framed — an http page inside an https app is blocked as mixed
 * content, and anything that isn't a parseable http(s) URL (mailto:, tel:, a
 * relative path) is not ours to frame at all.
 */
export function canFrame(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url, window.location.href)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return FRAMEABLE_HOSTS.includes(parsed.hostname.toLowerCase())
}

/** The host, for the overlay header when no title was given. */
export function hostLabel(url: string): string {
  try {
    return new URL(url, window.location.href).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// Module-level singleton: one overlay for the whole app, mounted once in
// App.vue. Call sites only ever call openInApp().
const target = ref<InAppBrowserTarget | null>(null)
const loadFailed = ref(false)

/** Opens externally, in the plain old way. Extracted so tests can assert it. */
function openExternally(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Open a URL for the learner.
 *
 * Frameable → the in-app overlay. Not frameable → a real browser tab, with no
 * intervening card, because the overlay could add nothing but a delay.
 * Returns how it was handled, which is what the tests assert on.
 */
export function openInApp(url: string, title?: string): 'in-app' | 'external' {
  if (!canFrame(url)) {
    openExternally(url)
    return 'external'
  }
  loadFailed.value = false
  target.value = { url, title: title || hostLabel(url) }
  return 'in-app'
}

export function closeInApp(): void {
  target.value = null
  loadFailed.value = false
}

/** The overlay tells us the frame never loaded; we offer the way out. */
export function markLoadFailed(): void {
  if (target.value) loadFailed.value = true
}

/** The "open it properly then" tap-through on the failure card. */
export function escapeToBrowser(): void {
  const url = target.value?.url
  if (!url) return
  closeInApp()
  openExternally(url)
}

export function useInAppBrowser() {
  return {
    target: readonly(target),
    loadFailed: readonly(loadFailed),
    openInApp,
    closeInApp,
    markLoadFailed,
    escapeToBrowser,
  }
}
