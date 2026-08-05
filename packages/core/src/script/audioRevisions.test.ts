/**
 * audioRevisions — the registry behind `/api/audio/<id>?v=<rev>`.
 *
 * The whole point is that a repaired clip (bytes swapped in place at the same
 * course_audio.id) gets a URL no cache has seen, while everything else keeps
 * the URL every cache already holds. Both halves are load-bearing: the first
 * makes repairs land, the second stops a repair from re-downloading a course.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildAudioUrl,
  clearAudioRevisions,
  getAudioRevision,
  getAudioRevisionMap,
  setAudioRevisions,
} from './audioRevisions'

describe('audioRevisions', () => {
  beforeEach(() => {
    clearAudioRevisions()
  })

  it('an unknown id builds the bare URL, byte-identical to before', () => {
    expect(buildAudioUrl('abc')).toBe('/api/audio/abc')
    expect(getAudioRevision('abc')).toBeUndefined()
  })

  it('a repaired id builds ?v=<rev>', () => {
    setAudioRevisions({ abc: 2 })
    expect(buildAudioUrl('abc')).toBe('/api/audio/abc?v=2')
    expect(getAudioRevision('abc')).toBe(2)
  })

  it('an extra query string is preserved, with v appended alongside it', () => {
    setAudioRevisions({ abc: 4 })
    expect(buildAudioUrl('abc', 'courseId=deu_for_eng')).toBe(
      '/api/audio/abc?courseId=deu_for_eng&v=4'
    )
    // ...and without a revision, the extra query still stands alone.
    expect(buildAudioUrl('xyz', 'courseId=deu_for_eng')).toBe(
      '/api/audio/xyz?courseId=deu_for_eng'
    )
  })

  it('ignores revision 1 and below — those mean the original bytes', () => {
    // Recording revision 1 would emit ?v=1 for every clip in the course and
    // invalidate every cache on the planet to serve identical audio.
    setAudioRevisions({ a: 1, b: 0, c: -3 })
    expect(getAudioRevisionMap()).toEqual({})
    expect(buildAudioUrl('a')).toBe('/api/audio/a')
  })

  it('ignores non-finite and non-numeric values rather than emitting junk', () => {
    setAudioRevisions({ a: NaN, b: Infinity, c: '2' as unknown as number })
    expect(getAudioRevisionMap()).toEqual({})
  })

  it('null / undefined payload fields are a no-op', () => {
    setAudioRevisions({ a: 2 })
    setAudioRevisions(undefined)
    setAudioRevisions(null)
    expect(getAudioRevision('a')).toBe(2)
  })

  it('merges monotonically — a later payload never downgrades a clip', () => {
    // Payloads arrive piecemeal (cycles, infplay-cycles, bundle) and a cached
    // pre-repair payload can land AFTER a fresh one. If that reverted the
    // revision, the URL would flip back to the damaged clip's cache entry.
    setAudioRevisions({ a: 5 })
    setAudioRevisions({ a: 2 })
    expect(getAudioRevision('a')).toBe(5)

    setAudioRevisions({ a: 7 })
    expect(getAudioRevision('a')).toBe(7)
  })

  it('a payload that omits a clip leaves its known revision intact', () => {
    setAudioRevisions({ a: 3 })
    setAudioRevisions({ b: 2 })
    expect(getAudioRevision('a')).toBe(3)
    expect(getAudioRevision('b')).toBe(2)
  })

  it('a falsy id builds an empty URL — the "no audio for this slot" signal', () => {
    expect(buildAudioUrl(undefined)).toBe('')
    expect(buildAudioUrl(null)).toBe('')
    expect(buildAudioUrl('')).toBe('')
  })
})
