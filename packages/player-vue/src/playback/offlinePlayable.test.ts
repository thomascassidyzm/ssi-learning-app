import { describe, it, expect } from 'vitest'
import { audioIdFromUrl, requiredClipUrls, isCyclePlayableOffline } from './offlinePlayable'

// REGRESSION: Tom, in airplane mode, 2026-08-15 — "the first one didn't play.
// It had no audio. And then this one."
//
// The offline gate was written out four times verbatim with this hole:
//
//   const cachedId = (u) => { const id = idOf(u); return !id || cache.has(id) }
//                                                 ^^^^
// A BLANK url yields no id, so it answered "cached". The round builders emit
// exactly that — the empty string — whenever an audio id is missing. So a
// cycle with a MISSING clip wasn't merely uncached, it was maximally cached:
// the one thing guaranteed to survive the filter. Intros are exempt from the
// builders' audio-completeness check, and an intro is cycle 0 of the round a
// resume lands on — so the silence landed on the FIRST phrase.
//
// These tests pin the gate FAILING CLOSED, and pin the one nuance that makes
// that safe: some blanks are deliberate.

const URL_A = '/api/audio/aaaa-1111'
const URL_B = '/api/audio/bbbb-2222'
const URL_C = '/api/audio/cccc-3333'

const cached = (...ids: string[]) => {
  const s = new Set(ids)
  return (id: string) => s.has(id)
}
const ALL = cached('aaaa-1111', 'bbbb-2222', 'cccc-3333')
const NONE = cached()

const cycle = (known: string | null, v1: string | null, v2: string | null, extra: object = {}) => ({
  known: { audioUrl: known },
  target: { voice1Url: v1, voice2Url: v2 },
  ...extra,
})

describe('audioIdFromUrl', () => {
  it('extracts the id from a proxy url, ignoring the query string', () => {
    expect(audioIdFromUrl('/api/audio/abc-123')).toBe('abc-123')
    expect(audioIdFromUrl('/api/audio/abc-123?v=2')).toBe('abc-123')
  })

  it('returns null for the shapes the old gate treated as "cached"', () => {
    expect(audioIdFromUrl('')).toBeNull()
    expect(audioIdFromUrl(undefined)).toBeNull()
    expect(audioIdFromUrl(null)).toBeNull()
    expect(audioIdFromUrl('https://example.com/not-a-proxy.mp3')).toBeNull()
  })
})

describe('isCyclePlayableOffline — the hole is closed', () => {
  it('THE BUG: a cycle with a blank clip url is NOT playable, however warm the cache', () => {
    // This is the exact shape that played four phases of silence.
    expect(isCyclePlayableOffline(cycle('', URL_B, URL_C), ALL)).toBe(false)
    expect(isCyclePlayableOffline(cycle(URL_A, '', URL_C), ALL)).toBe(false)
    expect(isCyclePlayableOffline(cycle(URL_A, URL_B, ''), ALL)).toBe(false)
  })

  it('an INTRO with no presentation clip is not playable — the builders exempt it, we do not', () => {
    // ita_for_eng, Tom's course, has 158 of 1,457 LEGOs with no presentation
    // audio at all, and an intro is cycle 0 of the round a resume lands on.
    const audiolessIntro = { type: 'intro', ...cycle('', URL_B, URL_C) }
    expect(isCyclePlayableOffline(audiolessIntro, ALL)).toBe(false)
  })

  it('a fully cached three-clip cycle IS playable', () => {
    expect(isCyclePlayableOffline(cycle(URL_A, URL_B, URL_C), ALL)).toBe(true)
  })

  it('a three-clip cycle with any clip missing from the cache is not playable', () => {
    expect(isCyclePlayableOffline(cycle(URL_A, URL_B, URL_C), cached('aaaa-1111', 'bbbb-2222'))).toBe(false)
    expect(isCyclePlayableOffline(cycle(URL_A, URL_B, URL_C), NONE)).toBe(false)
  })

  it('a null or empty cycle is not playable rather than vacuously true', () => {
    expect(isCyclePlayableOffline(null, ALL)).toBe(false)
    expect(isCyclePlayableOffline(undefined, ALL)).toBe(false)
    expect(isCyclePlayableOffline(cycle(null, null, null), ALL)).toBe(false)
  })

  it('a non-proxy url is not playable offline — we cannot prove it is in the cache', () => {
    expect(isCyclePlayableOffline(cycle('https://cdn.example.com/x.mp3', URL_B, URL_C), ALL)).toBe(false)
  })
})

describe('deliberately-empty slots stay legal — the nuance that makes failing closed safe', () => {
  it('a singleAudio cycle needs only its ONE filled clip, blanks and all', () => {
    // Listening cups, pods, bookends and drained seed-sandwiches are SUPPOSED
    // to carry one clip and two empty slots. Treating those blanks like the
    // missing ones above would silently starve the whole listening layer.
    const pod = cycle(URL_A, null, null, { singleAudio: true })
    expect(isCyclePlayableOffline(pod, cached('aaaa-1111'))).toBe(true)

    const sandwich = cycle('', URL_B, '', { singleAudio: true })
    expect(isCyclePlayableOffline(sandwich, cached('bbbb-2222'))).toBe(true)
  })

  it('a singleAudio cycle whose one clip is uncached is still not playable', () => {
    const pod = cycle(URL_A, null, null, { singleAudio: true })
    expect(isCyclePlayableOffline(pod, NONE)).toBe(false)
  })

  it('a singleAudio cycle with NO clip at all fails closed rather than passing vacuously', () => {
    const empty = cycle('', null, undefined as any, { singleAudio: true })
    expect(isCyclePlayableOffline(empty, ALL)).toBe(false)
  })
})

describe('requiredClipUrls', () => {
  it('asks for all three on a normal cycle', () => {
    expect(requiredClipUrls(cycle(URL_A, URL_B, URL_C))).toEqual([URL_A, URL_B, URL_C])
  })

  it('asks for the one filled clip on a singleAudio cycle', () => {
    expect(requiredClipUrls(cycle('', URL_B, '', { singleAudio: true }))).toEqual([URL_B])
  })
})
