/**
 * Web fonts, loaded so they can NEVER hold up first paint.
 *
 * 2026-08-25, field report (Tom, phone, weak signal at an airport): permanent
 * white screen on dev, staging never loaded at all. The cause was two
 * RENDER-BLOCKING CROSS-ORIGIN stylesheets:
 *
 *   1. index.html carried <link rel="stylesheet" href="fonts.googleapis.com/...">
 *      for the schools faces, in <head>, ahead of everything.
 *   2. src/style.css opened with @import url('fonts.googleapis.com/...'), which
 *      Vite preserves verbatim at the top of the emitted index-*.css.
 *
 * A blocking stylesheet halts first paint until it loads OR fails. On a weak
 * signal it does NEITHER — the request is accepted and then hangs forever. So
 * the document arrived and nothing painted: white, not even the warm #e8e3dd
 * boot screen. Measured on the live dev build: healthy boot mounted in 332ms;
 * with the font hosts hanging, the app NEVER mounted and document.readyState
 * was still "loading" after 8s — the HTML parser itself was still blocked.
 *
 * That is also why the 2026-08-16 lie-fi boot fix could not save it. Both of
 * its rescues sit downstream of the block: the inline boot watchdog in
 * index.html is parsed AFTER the stylesheet link, so it never ran, and the 3s
 * cached-shell swap document.writes a shell whose own precached CSS begins with
 * the same @import. A perfectly precached offline boot still blocked on Google.
 * No amount of caching can rescue a boot that is waiting on a third party.
 *
 * The fonts themselves stay on Google deliberately. Google serves DM Sans and
 * Noto Sans split by unicode-range, so a learner downloads only the subsets
 * their own language actually uses (see style.css and styles/coverageLanguages
 * .ts) — vendoring the 65 subset files would cost ~1.4MB in the repo and put
 * the MEASURED glyph coverage at risk for the sake of a problem that is really
 * about WHEN the stylesheet is fetched, not WHERE from.
 *
 * 2026-08-26 — Tom's ruling A-265 overturns that last paragraph. The fonts are
 * now SELF-HOSTED: scripts/vendor-fonts.mjs vendors the subset files into
 * public/fonts/ and generates public/fonts/fonts.css with Google's own
 * unicode-range splits kept verbatim, so the per-language economy is intact
 * (it got cheaper, in fact — variable builds over the same weight ranges cut
 * the kept subsets from 3.66MB to 1.16MB, and Noto Sans JP's 25.5MB of
 * Japanese shards, which no course in the estate ever asked for, are gone).
 * The UI's own Latin faces — ~204KB — are precached by the service worker, so
 * once installed there is no network in the font path at all, weak signal or
 * none. The rest is same-origin and runtime-cached on first use.
 *
 * The media="print" trick below STAYS, self-hosted or not. It is what
 * guarantees the property, rather than merely making it likely.
 *
 * So: fetch it from JS, with media="print" until it arrives. A print
 * stylesheet is not applied to the screen, so the browser never blocks paint on
 * it; the load listener flips it to "all" once it is safely in hand. If it
 * never arrives — a hanging network — media stays "print", the rule never
 * applies, and the app simply renders in the system fallback already named in
 * every font token. Text, and the app, are always there.
 *
 * The listener is attached with addEventListener rather than an inline onload=
 * attribute on purpose: an inline handler is inline script, which the CSP in
 * vercel.json would block the moment it stops being report-only.
 */

/**
 * Every face the app owns, in one self-hosted stylesheet: DM Sans (brand body),
 * Noto Sans (the glyph-coverage exception applied per-language), Noto Sans JP
 * (display), JetBrains Mono and Space Mono (code and the player's known-language
 * line), plus Arsenal + Open Sans for .schools-surface. One sheet rather than
 * the old two: every @font-face is gated by family AND unicode-range, so a
 * learner who never opens /schools never downloads a byte of Arsenal.
 *
 * GENERATED — regenerate with `node scripts/vendor-fonts.mjs` after changing a
 * family or weight. styles/fontGlyphCoverage.test.ts asserts every family a
 * design token names is actually declared in it; keep the two in step.
 */
export const APP_FONTS_HREF = '/fonts/fonts.css'

export const WEBFONT_HREFS = [APP_FONTS_HREF]

/** Marks the links so a second call is a no-op and tests can find them. */
const MARKER = 'data-ssi-webfont'

/** Hrefs already appended, so calling twice cannot double-load. */
const appended = new Set<string>()

/**
 * Append one stylesheet that cannot block rendering.
 * Exported for the unit test; call loadWebFonts() in app code.
 */
export function appendNonBlockingStylesheet(
  href: string,
  doc: Document = document,
): HTMLLinkElement | null {
  if (!doc || !doc.head) return null
  if (appended.has(href)) return null
  appended.add(href)

  const link = doc.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  // The whole trick. Not applied to the screen ⇒ never render-blocking.
  link.media = 'print'
  link.setAttribute(MARKER, '')
  link.addEventListener(
    'load',
    () => {
      link.media = 'all'
    },
    { once: true },
  )
  doc.head.appendChild(link)
  return link
}

/**
 * Kick off the web fonts. Safe to call before or after mount, and safe to call
 * twice. Never throws: a font is decoration, and must never be able to take the
 * app down with it.
 */
export function loadWebFonts(doc: Document = document): void {
  try {
    for (const href of WEBFONT_HREFS) appendNonBlockingStylesheet(href, doc)
  } catch {
    /* fonts are decoration — the app renders fine in the fallback stack */
  }
}
