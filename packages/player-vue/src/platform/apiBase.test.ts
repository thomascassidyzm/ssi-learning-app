/**
 * The proof this whole seam exists for: point the API base at a different
 * origin and every `/api/...` request follows it — while the web default
 * leaves every request byte-identical to the literal in the source.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configurePlatform, resetPlatform } from './capabilities'
import { apiOrigin, apiUrl, installApiOriginRewrite } from './apiBase'

afterEach(() => {
  resetPlatform()
})

describe('web default — nothing changes', () => {
  it('has no API origin', () => {
    expect(apiOrigin()).toBe('')
  })

  it('apiUrl returns the path unchanged', () => {
    expect(apiUrl('/api/courses/spa_for_eng')).toBe('/api/courses/spa_for_eng')
    expect(apiUrl('/api/audio/abc-123?courseId=x')).toBe('/api/audio/abc-123?courseId=x')
  })

  it('installs no fetch wrapper at all', () => {
    const original = vi.fn()
    const scope = { fetch: original as unknown as typeof fetch }
    expect(installApiOriginRewrite(scope)).toBe(false)
    expect(scope.fetch).toBe(original)
  })
})

describe('configured origin — requests follow it', () => {
  const ORIGIN = 'https://api.saysomethingin.app'

  function wrappedScope() {
    const spy = vi.fn(async (_input?: unknown, _init?: unknown) => new Response('ok'))
    const scope = { fetch: spy as unknown as typeof fetch }
    configurePlatform({ shell: 'webview', apiOrigin: ORIGIN })
    expect(installApiOriginRewrite(scope)).toBe(true)
    return { scope, spy }
  }

  it('apiUrl prefixes the origin', () => {
    configurePlatform({ apiOrigin: ORIGIN })
    expect(apiUrl('/api/audio/abc')).toBe(`${ORIGIN}/api/audio/abc`)
  })

  it('strips a trailing slash off the configured origin', () => {
    configurePlatform({ apiOrigin: `${ORIGIN}/` })
    expect(apiUrl('/api/audio/abc')).toBe(`${ORIGIN}/api/audio/abc`)
  })

  it('rewrites a string /api path', async () => {
    const { scope, spy } = wrappedScope()
    await scope.fetch('/api/courses/spa_for_eng/bundle')
    expect(spy).toHaveBeenCalledWith(`${ORIGIN}/api/courses/spa_for_eng/bundle`, undefined)
  })

  it('keeps the init object', async () => {
    const { scope, spy } = wrappedScope()
    const init = { method: 'POST', body: '{}' }
    await scope.fetch('/api/player-events', init)
    expect(spy).toHaveBeenCalledWith(`${ORIGIN}/api/player-events`, init)
  })

  it('rewrites a Request object', async () => {
    const { scope, spy } = wrappedScope()
    await scope.fetch(new Request(`${location.origin}/api/me/threads?course=x`))
    const arg = spy.mock.calls[0]![0] as unknown as Request
    expect(arg.url).toBe(`${ORIGIN}/api/me/threads?course=x`)
  })

  it('leaves non-/api paths alone', async () => {
    const { scope, spy } = wrappedScope()
    await scope.fetch('/version.json')
    expect(spy).toHaveBeenCalledWith('/version.json', undefined)
  })

  it('leaves absolute URLs (S3, Supabase, presigned) alone', async () => {
    const { scope, spy } = wrappedScope()
    const s3 = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered/X.mp3'
    await scope.fetch(s3)
    expect(spy).toHaveBeenCalledWith(s3, undefined)
  })

  it('is idempotent — installing twice does not double-prefix', async () => {
    const { scope, spy } = wrappedScope()
    expect(installApiOriginRewrite(scope)).toBe(false)
    await scope.fetch('/api/audio/abc')
    expect(spy).toHaveBeenCalledWith(`${ORIGIN}/api/audio/abc`, undefined)
  })

  it('never throws a request away if URL bookkeeping fails', async () => {
    const { scope, spy } = wrappedScope()
    // A garbage input still reaches the underlying fetch rather than exploding.
    await scope.fetch(undefined as unknown as string)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('audio URLs — the non-fetch consumers', () => {
  it('an <audio> src built through apiUrl follows the configured origin', () => {
    configurePlatform({ apiOrigin: 'https://api.example.test' })
    const id = 'a1b2'
    expect(apiUrl(`/api/audio/${id}`)).toBe('https://api.example.test/api/audio/a1b2')
  })
})
