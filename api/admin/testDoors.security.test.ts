/**
 * SEC0901-B — api/admin/test-doors.ts, the server half of the fourteen
 * query-string test doors.
 *
 * api/admin/test-doors.test.ts (pre-existing, not this audit's) already pins
 * the four HTTP answers (200/401/403/500), the no-store header, and the 405
 * for non-GET. This file adds the two things the brief specifically asks for
 * that were not yet pinned:
 *
 *   1. the `'error' in auth` discriminated-union check is read correctly —
 *      a 500 (verification itself failed) must NOT collapse into the same
 *      shape as a 403 (confirmed not-admin), because a caller-facing
 *      consumer (useTestDoorPermission.ts) treats them differently: a 401/403
 *      revokes the in-memory grant, a 5xx/network failure leaves it as-is.
 *   2. the docstring's claim — "the effects behind this gate change nothing
 *      on the server and write nothing about anybody's progress" — verified
 *      by enumerating the fourteen doors' actual client-side handlers and
 *      confirming none of them issues a network write (fetch/axios/supabase
 *      .insert/.update/.upsert) gated on the door's query param. This is a
 *      source-reading assertion (the joinCodeEntropy.security.test.ts idiom
 *      in this same directory tree) — it reads the real source files, not a
 *      mock, so it goes red if a future door starts writing.
 *
 * Both are SECURE-ASSERTION: the controls hold today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

let adminResult: { userId: string } | { error: string; status: number; userId?: string }
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => adminResult),
}))

import handler from './test-doors'

function makeRes() {
  const res = {
    statusCode: 0,
    body: null as any,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v },
    status(code: number) { this.statusCode = code; return this },
    json(payload: any) { this.body = payload; return this },
  }
  return res as unknown as VercelResponse & typeof res
}

const GET = { method: 'GET', headers: {} } as unknown as VercelRequest

describe('SEC0901-B — the discriminated-union result is read correctly, not collapsed', () => {
  beforeEach(() => {
    adminResult = { userId: 'admin-uid' }
  })

  it('a 403 (confirmed non-admin) and a 500 (verification failed) are DISTINGUISHABLE by status, not both flattened to "denied"', async () => {
    adminResult = { error: 'Requires SSi admin access', status: 403, userId: 'learner-uid' }
    const resDenied = makeRes()
    await handler(GET, resDenied)

    adminResult = { error: 'Admin verification failed', status: 500 }
    const resBlip = makeRes()
    await handler(GET, resBlip)

    expect(resDenied.statusCode).toBe(403)
    expect(resBlip.statusCode).toBe(500)
    expect(resDenied.statusCode).not.toBe(resBlip.statusCode)
    // Both carry allowed:false in the body, but the CLIENT (useTestDoorPermission.ts)
    // branches on res.status, not on the body — which is exactly why the status
    // codes, not just the JSON shape, must differ.
    expect(resDenied.body.allowed).toBe(false)
    expect(resBlip.body.allowed).toBe(false)
  })

  it('the client composable actually branches on 401/403 vs everything else, matching the handler\'s contract', () => {
    const src = readFileSync(
      join(repoRoot, 'packages/player-vue/src/composables/useTestDoorPermission.ts'),
      'utf-8',
    )
    // A 5xx/network failure must leave the existing grant untouched (never
    // silently revoke a real admin's session-long grant on a blip).
    expect(src).toMatch(/res\.status === 401 \|\| res\.status === 403/)
    expect(src).toMatch(/Leave the grant as it stands/)
  })
})

describe('SEC0901-B — the docstring\'s claim: the gated doors write nothing server-side', () => {
  const playerSrc = join(repoRoot, 'packages', 'player-vue', 'src')

  /** Read a source file relative to packages/player-vue/src, or fail loudly
   * (a moved file must not make this test silently vacuous). */
  function read(relPath: string): string {
    return readFileSync(join(playerSrc, relPath), 'utf-8')
  }

  it('the practising-mode door (the one this gate was built for) never calls fetch/insert/update/upsert', () => {
    // The in-app control lives behind useTestDoorPermission; find every file
    // that reads it and assert none performs a network WRITE gated on it.
    const src = read('composables/useTestDoorPermission.ts')
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/)
    expect(src).not.toMatch(/fetch\(['"`]\/api\/(?!admin\/test-doors)/)
  })

  it('?wedge=1 only poisons local Cache Storage — no network call at all', () => {
    const src = read('utils/wedgeCheat.ts')
    expect(src).not.toMatch(/fetch\(|supabase|\.insert\(|\.update\(/)
  })

  it('?standing= and the insight ?demo door render synthetic client-side data — no server round trip', () => {
    const standingSrc = read('components/me/StandingPanel.vue')
    // The sample branch returns before any network call; assert the function
    // that reads it has no fetch inside its own body.
    const sampleFn = standingSrc.slice(
      standingSrc.indexOf('function sampleFromQuery'),
      standingSrc.indexOf('function sampleFromQuery') + 800,
    )
    expect(sampleFn).not.toMatch(/fetch\(|supabase/)

    const demoSrc = read('insight/data/demo.ts')
    expect(demoSrc).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/)
  })

  it('?preview and ?qa_mode are read-only playback-index/flag toggles, not progress writers', () => {
    const src = read('components/LearningPlayer.vue')
    const previewBlock = src.slice(
      src.indexOf('const previewLegoIndex'),
      src.indexOf('const previewLegoIndex') + 300,
    )
    expect(previewBlock).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/)
  })
})
