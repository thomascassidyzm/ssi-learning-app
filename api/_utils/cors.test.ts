/**
 * cors — both directions.
 *
 * The point of this file is the SAME-ORIGIN half. Every existing learner and
 * school runs the ordinary browser path, so the tests that matter most are the
 * ones asserting this helper touches NOTHING when the request is same-origin
 * or has no Origin at all. A test that only ever passes in the direction it is
 * meant to pass is not a test, so every allow case has a matching deny case.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, matchAllowedOrigin } from './cors'

function makeReq(headers: Record<string, string>, method = 'GET'): VercelRequest {
  return { method, headers } as unknown as VercelRequest
}

interface FakeRes {
  headers: Record<string, string>
  statusCode: number | null
  ended: boolean
  res: VercelResponse
}

function makeRes(): FakeRes {
  const state: FakeRes = { headers: {}, statusCode: null, ended: false, res: null as never }
  state.res = {
    setHeader(k: string, v: string) {
      state.headers[k] = v
    },
    status(code: number) {
      state.statusCode = code
      return {
        end() {
          state.ended = true
        },
      }
    },
  } as unknown as VercelResponse
  return state
}

const ORIGINAL_ENV = process.env.WEBVIEW_ALLOWED_ORIGINS

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.WEBVIEW_ALLOWED_ORIGINS
  else process.env.WEBVIEW_ALLOWED_ORIGINS = ORIGINAL_ENV
})

describe('matchAllowedOrigin', () => {
  beforeEach(() => {
    delete process.env.WEBVIEW_ALLOWED_ORIGINS
  })

  it('allows the production and staging origins', () => {
    expect(matchAllowedOrigin('https://saysomethingin.app')).toBe('https://saysomethingin.app')
    expect(matchAllowedOrigin('https://staging.saysomethingin.app')).toBe('https://staging.saysomethingin.app')
  })

  it('allows this project\'s Vercel preview aliases — both halves must match', () => {
    expect(matchAllowedOrigin('https://ssi-learning-app-git-dev-zenjin.vercel.app'))
      .toBe('https://ssi-learning-app-git-dev-zenjin.vercel.app')
    // Attacker's own project on the same platform: prefix wrong.
    expect(matchAllowedOrigin('https://evil-zenjin.vercel.app')).toBeNull()
    // Right prefix, someone else's team slug.
    expect(matchAllowedOrigin('https://ssi-learning-app-evil.vercel.app')).toBeNull()
    // Any vercel.app at all must not pass.
    expect(matchAllowedOrigin('https://anything.vercel.app')).toBeNull()
  })

  it('allows the native shell origins by default and nothing that merely looks like them', () => {
    expect(matchAllowedOrigin('https://localhost')).toBe('https://localhost')
    expect(matchAllowedOrigin('capacitor://localhost')).toBe('capacitor://localhost')
    expect(matchAllowedOrigin('http://localhost')).toBeNull()
    expect(matchAllowedOrigin('https://localhost.evil.com')).toBeNull()
    expect(matchAllowedOrigin('https://localhost:8080')).toBeNull()
  })

  it('is configurable, and an empty env value switches native-shell CORS off', () => {
    process.env.WEBVIEW_ALLOWED_ORIGINS = 'https://app.example-shell.test'
    expect(matchAllowedOrigin('https://app.example-shell.test')).toBe('https://app.example-shell.test')
    expect(matchAllowedOrigin('https://localhost')).toBeNull()

    process.env.WEBVIEW_ALLOWED_ORIGINS = ''
    expect(matchAllowedOrigin('https://localhost')).toBeNull()
    // Our own domains are NOT env-controlled and stay allowed.
    expect(matchAllowedOrigin('https://saysomethingin.app')).toBe('https://saysomethingin.app')
  })

  it('rejects the shapes that are not web origins at all', () => {
    expect(matchAllowedOrigin(undefined)).toBeNull()
    expect(matchAllowedOrigin('')).toBeNull()
    expect(matchAllowedOrigin('null')).toBeNull()
    expect(matchAllowedOrigin('file://')).toBeNull()
    expect(matchAllowedOrigin('http://saysomethingin.app')).toBeNull()
    expect(matchAllowedOrigin('https://saysomethingin.app.evil.com')).toBeNull()
  })
})

describe('applyCors — the same-origin web path is untouched', () => {
  it('sets NO headers and does not finish the response when there is no Origin', () => {
    const res = makeRes()
    const handled = applyCors(makeReq({ host: 'saysomethingin.app' }), res.res)
    expect(handled).toBe(false)
    expect(res.headers).toEqual({})
    expect(res.ended).toBe(false)
  })

  it('sets NO headers for a same-origin POST, which does send an Origin', () => {
    const res = makeRes()
    const handled = applyCors(
      makeReq({ host: 'saysomethingin.app', origin: 'https://saysomethingin.app' }, 'POST'),
      res.res,
    )
    expect(handled).toBe(false)
    expect(res.headers).toEqual({})
  })

  it('same-origin holds on staging and on a preview alias too', () => {
    for (const host of ['staging.saysomethingin.app', 'ssi-learning-app-git-dev-zenjin.vercel.app']) {
      const res = makeRes()
      applyCors(makeReq({ host, origin: `https://${host}` }, 'POST'), res.res)
      expect(res.headers).toEqual({})
    }
  })
})

describe('applyCors — allowlisted cross-origin', () => {
  beforeEach(() => {
    delete process.env.WEBVIEW_ALLOWED_ORIGINS
  })

  it('echoes the matched origin, varies on Origin, and allows Authorization', () => {
    const res = makeRes()
    const handled = applyCors(
      makeReq({ host: 'saysomethingin.app', origin: 'https://localhost' }, 'GET'),
      res.res,
      { methods: 'GET' },
    )
    expect(handled).toBe(false)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://localhost')
    expect(res.headers['Vary']).toBe('Origin')
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS')
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization')
    expect(res.headers['Access-Control-Max-Age']).toBe('86400')
  })

  it('NEVER emits Allow-Credentials, and never a wildcard', () => {
    const res = makeRes()
    applyCors(makeReq({ host: 'saysomethingin.app', origin: 'https://localhost' }, 'POST'), res.res)
    expect(res.headers['Access-Control-Allow-Credentials']).toBeUndefined()
    expect(res.headers['Access-Control-Allow-Origin']).not.toBe('*')
  })

  it('answers a preflight with 204 and finishes the response', () => {
    const res = makeRes()
    const handled = applyCors(
      makeReq({ host: 'saysomethingin.app', origin: 'https://localhost' }, 'OPTIONS'),
      res.res,
      { methods: 'POST' },
    )
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(204)
    expect(res.ended).toBe(true)
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://localhost')
  })
})

describe('applyCors — unrecognised cross-origin', () => {
  beforeEach(() => {
    delete process.env.WEBVIEW_ALLOWED_ORIGINS
  })

  it('grants nothing: no Allow-Origin at all', () => {
    const res = makeRes()
    const handled = applyCors(
      makeReq({ host: 'saysomethingin.app', origin: 'https://evil.example' }, 'GET'),
      res.res,
    )
    expect(handled).toBe(false)
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined()
    expect(res.headers['Vary']).toBe('Origin')
  })

  it('refuses the preflight with 403 and no CORS headers', () => {
    const res = makeRes()
    const handled = applyCors(
      makeReq({ host: 'saysomethingin.app', origin: 'https://evil.example' }, 'OPTIONS'),
      res.res,
    )
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(403)
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('does not block the request itself — CORS is a browser-read policy, not authz', () => {
    const res = makeRes()
    // A non-preflight request from a stranger returns false, so the handler
    // runs exactly as it does today. The browser is what refuses the read.
    expect(applyCors(makeReq({ host: 'saysomethingin.app', origin: 'https://evil.example' }, 'POST'), res.res))
      .toBe(false)
    expect(res.ended).toBe(false)
  })
})
