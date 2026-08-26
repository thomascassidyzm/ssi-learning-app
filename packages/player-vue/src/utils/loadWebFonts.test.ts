/**
 * The one property that matters: a font stylesheet must never be able to hold
 * up first paint, however badly the network behaves.
 *
 * 2026-08-25 — Tom, phone, weak signal at an airport: permanent white screen.
 * Two render-blocking cross-origin font stylesheets (index.html's <link> and
 * style.css's @import). On a weak signal such a request is accepted and then
 * hangs — it never loads and never fails — so the browser blocks paint forever.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { appendNonBlockingStylesheet, loadWebFonts, WEBFONT_HREFS } from './loadWebFonts'

function freshDoc(): Document {
  return document.implementation.createHTMLDocument('t')
}

describe('web fonts never block first paint', () => {
  beforeEach(() => {
    document.head.querySelectorAll('link[data-ssi-webfont]').forEach(n => n.remove())
  })

  it('appends the link as media="print" so it is not applied to the screen', () => {
    const doc = freshDoc()
    const link = appendNonBlockingStylesheet('https://fonts.example/css', doc)
    expect(link).toBeTruthy()
    // print media ⇒ the browser does not block rendering on it
    expect(link!.media).toBe('print')
    expect(link!.rel).toBe('stylesheet')
    expect(doc.head.querySelector('link[data-ssi-webfont]')).toBe(link)
  })

  it('applies the font only once it has actually arrived', () => {
    const doc = freshDoc()
    const link = appendNonBlockingStylesheet('https://fonts.example/a', doc)!
    expect(link.media).toBe('print')
    link.dispatchEvent(new Event('load'))
    expect(link.media).toBe('all')
  })

  it('a font host that hangs leaves the page rendering in the fallback stack', () => {
    // The hang IS the lie-fi case: no load event, no error event, ever.
    const doc = freshDoc()
    const link = appendNonBlockingStylesheet('https://fonts.example/hangs', doc)!
    // ...nothing fires...
    expect(link.media).toBe('print') // never applied, and never blocking
  })

  it('requests the self-hosted font sheet, and nothing cross-origin', () => {
    // 2026-08-26 (A-265): the faces are vendored into public/fonts/, so the
    // stylesheet is same-origin and precached. A cross-origin href here would
    // put a third party back in the font path — the thing the whole fix
    // removes. The media="print" guard above stays regardless.
    const doc = freshDoc()
    loadWebFonts(doc)
    const hrefs = [...doc.head.querySelectorAll('link[data-ssi-webfont]')].map(l =>
      l.getAttribute('href'),
    )
    expect(hrefs).toEqual(WEBFONT_HREFS)
    expect(hrefs.every(h => h!.startsWith('/fonts/'))).toBe(true)
  })

  it('never throws, whatever the document is', () => {
    expect(() => loadWebFonts(undefined as unknown as Document)).not.toThrow()
  })
})
