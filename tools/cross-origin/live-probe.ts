/**
 * LIVE PROBE — a real authenticated request that actually crosses an origin.
 *
 * NOT PART OF CI, and deliberately so: it reads `.env`, talks to the real
 * Supabase project, and creates then deletes a throwaway auth user. Run it by
 * hand from the repo root when you need to see the cross-origin auth path
 * actually work end to end (e.g. when the Android shell's origin changes):
 *
 *   npx vitest run -c tools/cross-origin/vitest.probe.config.ts --root .
 *
 * Point it at a different shell origin by editing SHELL_ORIGIN below and the
 * WEBVIEW_ALLOWED_ORIGINS value it sets — those two must agree, exactly as
 * they must in the real deployment.
 *
 * Not a header-string assertion: a real node HTTP server on 127.0.0.1 mounting
 * the REAL api/me/profile.ts handler (which verifies its bearer against the
 * real Supabase project), driven through the REAL installApiOriginRewrite()
 * wrapper with the platform origin set non-empty, carrying a REAL Supabase
 * access token for a throwaway user created and deleted by this probe.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")

for (const line of readFileSync(`${REPO}/.env`, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}
process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL
process.env.VITE_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
process.env.WEBVIEW_ALLOWED_ORIGINS = 'https://localhost'

const SHELL_ORIGIN = 'https://localhost'
const EMAIL = `webview-cors-probe-${Date.now()}@example.com`
const PASSWORD = `Probe!${Math.random().toString(36).slice(2)}Aa1`

let server: Server
let port = 0
let token = ''
let userId = ''
const log: string[] = []

beforeAll(async () => {
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
  })
  if (cErr) throw cErr
  userId = created.user!.id

  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)
  const { data: session, error: sErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (sErr) throw sErr
  token = session.session!.access_token
  log.push(`real supabase user ${userId}; access token ${token.length} chars, jwt header ${token.split('.')[0].slice(0, 12)}…`)

  // Two real handlers: profile (open, proves the CORS shape) and threads
  // (auth-required, proves the bearer actually crossed and was verified).
  const routes: Record<string, any> = {
    '/api/me/profile': (await import(`${REPO}/api/me/profile.ts`)).default,
    '/api/me/threads': (await import(`${REPO}/api/me/threads.ts`)).default,
  }

  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1')
    const vreq: any = {
      method: req.method,
      headers: req.headers,
      query: Object.fromEntries(url.searchParams),
      cookies: {},
      body: undefined,
    }
    const vres: any = {
      setHeader: (k: string, v: string) => res.setHeader(k, v),
      status: (c: number) => { res.statusCode = c; return vres },
      json: (b: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)); return vres },
      end: (b?: string) => { res.end(b); return vres },
    }
    const handler = routes[url.pathname]
    if (!handler) { res.statusCode = 404; res.end('no route'); return }
    await handler(vreq, vres)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as any).port

  const { configurePlatform } = await import(`${REPO}/packages/player-vue/src/platform/capabilities.ts`)
  const { installApiOriginRewrite } = await import(`${REPO}/packages/player-vue/src/platform/apiBase.ts`)
  configurePlatform({ shell: 'webview', apiOrigin: `http://127.0.0.1:${port}` })
  expect(installApiOriginRewrite(globalThis as any)).toBe(true)
  log.push(`api origin configured: http://127.0.0.1:${port}; fetch wrapper installed`)
}, 60000)

afterAll(async () => {
  server?.close()
  if (userId) {
    const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    await admin.auth.admin.deleteUser(userId)
    log.push(`throwaway user ${userId} deleted`)
  }
  console.log('\n----- LIVE CROSS-ORIGIN PROBE -----\n' + log.join('\n') + '\n-----------------------------------\n')
})

describe('a real authenticated call across a real origin', () => {
  it('preflights the Authorization header and is allowed', async () => {
    // The app writes a RELATIVE path; the wrapper is what makes it cross-origin.
    const r = await fetch('/api/me/profile?course=spa_for_eng', {
      method: 'OPTIONS',
      headers: {
        origin: SHELL_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    })
    log.push(`PREFLIGHT OPTIONS /api/me/profile -> ${r.status}`)
    for (const k of ['access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'access-control-max-age', 'vary', 'access-control-allow-credentials']) {
      log.push(`  ${k}: ${r.headers.get(k) ?? '(absent)'}`)
    }
    expect(r.status).toBe(204)
    expect(r.headers.get('access-control-allow-origin')).toBe(SHELL_ORIGIN)
    expect(r.headers.get('access-control-allow-headers')).toContain('Authorization')
    expect(r.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('carries a REAL bearer across the origin and comes back authenticated', async () => {
    const r = await fetch('/api/me/profile?course=spa_for_eng', {
      headers: { origin: SHELL_ORIGIN, authorization: `Bearer ${token}` },
    })
    const body = await r.text()
    log.push(`GET /api/me/profile (real bearer) -> ${r.status}`)
    log.push(`  access-control-allow-origin: ${r.headers.get('access-control-allow-origin')}`)
    log.push(`  vary: ${r.headers.get('vary')}`)
    log.push(`  body: ${body.slice(0, 300)}`)
    expect(r.headers.get('access-control-allow-origin')).toBe(SHELL_ORIGIN)
    // 401 would mean the token never arrived. Anything else means the handler
    // verified it against Supabase and ran.
    expect(r.status).not.toBe(401)
  })

  it('an auth-REQUIRED route: same call with the bearer is not 401, without it is', async () => {
    const withTok = await fetch('/api/me/threads?course=spa_for_eng', {
      headers: { origin: SHELL_ORIGIN, authorization: `Bearer ${token}` },
    })
    const withoutTok = await fetch('/api/me/threads?course=spa_for_eng', { headers: { origin: SHELL_ORIGIN } })
    log.push(`GET /api/me/threads WITH real bearer    -> ${withTok.status} ${(await withTok.text()).slice(0, 160)}`)
    log.push(`  access-control-allow-origin: ${withTok.headers.get('access-control-allow-origin')}`)
    log.push(`GET /api/me/threads WITHOUT bearer      -> ${withoutTok.status} ${(await withoutTok.text()).slice(0, 160)}`)
    expect(withoutTok.status).toBe(401)
    expect(withTok.status).not.toBe(401)
    expect(withTok.headers.get('access-control-allow-origin')).toBe(SHELL_ORIGIN)
  })

  it('a stranger origin gets no Allow-Origin, and its preflight is refused', async () => {
    const g = await fetch('/api/me/profile?course=spa_for_eng', {
      headers: { origin: 'https://evil.example', authorization: `Bearer ${token}` },
    })
    log.push(`GET from https://evil.example -> ${g.status}, allow-origin: ${g.headers.get('access-control-allow-origin') ?? '(absent)'}`)
    expect(g.headers.get('access-control-allow-origin')).toBeNull()

    const p = await fetch('/api/me/profile', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    })
    log.push(`PREFLIGHT from https://evil.example -> ${p.status}, allow-origin: ${p.headers.get('access-control-allow-origin') ?? '(absent)'}`)
    expect(p.status).toBe(403)
  })

  it('BASELINE: the same handler, called same-origin, emits no CORS headers at all', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/me/profile?course=spa_for_eng`, {
      headers: { origin: `http://127.0.0.1:${port}`, authorization: `Bearer ${token}` },
    })
    log.push(`GET same-origin -> ${r.status}; allow-origin: ${r.headers.get('access-control-allow-origin') ?? '(absent)'}; vary: ${r.headers.get('vary') ?? '(absent)'}`)
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
    expect(r.headers.get('vary')).toBeNull()
  })
})
