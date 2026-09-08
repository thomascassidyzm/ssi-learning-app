/**
 * The boot suppressions for the framed demo — no service worker, no sign-in,
 * no bundle warm-up, no storage — all hang off this one predicate, so a
 * mistake here is a marketing visitor silently getting the full app boot
 * inside a 440-pixel box on a slow Indian phone.
 */
import { describe, it, expect } from 'vitest'
import { isEmbedPath, EMBED_PATH_PREFIX } from './embedMode'

describe('isEmbedPath', () => {
  it('recognises the framed demo surface', () => {
    expect(isEmbedPath('/embed/demo')).toBe(true)
    expect(isEmbedPath('/embed/demo/')).toBe(true)
    expect(isEmbedPath('/embed/anything-later')).toBe(true)
  })

  it('leaves every other path on the full app boot', () => {
    expect(isEmbedPath('/')).toBe(false)
    expect(isEmbedPath('/schools')).toBe(false)
    expect(isEmbedPath('/try/abc')).toBe(false)
    // Not a prefix match on the bare word: /embedded-anything is a normal path
    // and must not be silently stripped of sign-in.
    expect(isEmbedPath('/embedding')).toBe(false)
    expect(isEmbedPath('/embed')).toBe(false)
  })

  it('survives a missing pathname rather than throwing during boot', () => {
    expect(isEmbedPath(null)).toBe(false)
    expect(isEmbedPath(undefined)).toBe(false)
  })

  it('matches the prefix the vercel.json header rule is written against', () => {
    // vercel.json relaxes framing on `/embed/(.*)`. If these two ever drift,
    // a path is either frameable with the full app boot behind it, or
    // stripped-down and unframeable — both wrong.
    expect(EMBED_PATH_PREFIX).toBe('/embed/')
  })
})
