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
 * So: fetch them from JS, with media="print" until they arrive. A print
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
 * The app's own faces. DM Sans is the brand body face; Noto Sans is the
 * glyph-coverage exception applied per-language; Noto Sans JP is display/CJK;
 * JetBrains Mono and Space Mono are code and the player's known-language line.
 * styles/fontGlyphCoverage.test.ts asserts every family a token names is
 * actually requested here — keep the two in step.
 */
export const APP_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700' +
  '&family=Noto+Sans:wght@400;500;600;700' +
  '&family=JetBrains+Mono:wght@300;400;500;600' +
  '&family=Noto+Sans+JP:wght@300;400;500;700;900' +
  '&family=Space+Mono:wght@400;700&display=swap'

/** Arsenal + Open Sans, used only inside .schools-surface. */
export const SCHOOLS_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Arsenal:ital,wght@0,400;0,700;1,400' +
  '&family=Open+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap'

export const WEBFONT_HREFS = [APP_FONTS_HREF, SCHOOLS_FONTS_HREF]

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
