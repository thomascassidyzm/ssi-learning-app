// @vitest-environment node
/**
 * LIVE acceptance — the sector catalogue endpoint against the REAL registry,
 * with the shipped handler, the service key, and no mocks.
 *
 * Gated: runs only with SECTORS_LIVE=1 and the service key in the environment.
 *
 *   VITE_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SECTORS_LIVE=1 \
 *     pnpm exec vitest run -c vitest.api.config.ts api/courses/sectors.live.test.ts
 *
 * It asserts the shipping state Tom asked for, on the live row: the learner's
 * walk list for spa_for_eng is EMPTY, because the only registered walk
 * (health / general) is `draft` — it has no content yet, so no learner may be
 * offered it — while the registry row is there, anchored, and visible to QA
 * with ?include=draft. An unregistered course is an empty list, never an error.
 *
 * Recorded run, 2026-09-01:
 *   spa_for_eng               -> 200 {"sectors":[]}
 *   spa_for_eng?include=draft -> 200 health / spa_health_for_eng / ["general"]
 *                                   / draft / anchor S0001L01 "I want" -> "quiero"
 *   fra_for_eng               -> 200 {"sectors":[]}
 */
import { describe, it, expect } from 'vitest'
import handler from './[code]/sectors'

const LIVE = process.env.SECTORS_LIVE === '1'
  && !!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)
  && !!process.env.SUPABASE_SERVICE_ROLE_KEY

function mockRes() {
  const r: any = { statusCode: 0, body: null, headers: {} }
  r.status = (c: number) => { r.statusCode = c; return r }
  r.json = (b: any) => { r.body = b; return r }
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r }
  return r
}

const call = async (query: Record<string, string>) => {
  const res = mockRes()
  await handler({ method: 'GET', query } as any, res as any)
  return res
}

describe.skipIf(!LIVE)('LIVE sector catalogue', () => {
  it('serves an empty walk list for spa_for_eng — the one registered walk is draft', async () => {
    const res = await call({ code: 'spa_for_eng' })
    expect(res.statusCode).toBe(200)
    expect(res.body.sectors).toEqual([])
  })

  it('shows the registered health walk, anchored in its own content, with include=draft', async () => {
    const res = await call({ code: 'spa_for_eng', include: 'draft' })
    expect(res.statusCode).toBe(200)
    const health = res.body.sectors.find((s: any) => s.slug === 'health')
    expect(health).toBeTruthy()
    expect(health.sectorCourseCode).toBe('spa_health_for_eng')
    expect(health.roles).toEqual(['general'])
    expect(health.status).toBe('draft')
    expect(health.anchor.legoId).toBe('S0001L01')
    expect(health.anchor.known).toBeTruthy()
    expect(health.anchor.target).toBeTruthy()
  })

  it('a course with no registry row is an empty list, not an error', async () => {
    const res = await call({ code: 'fra_for_eng' })
    expect(res.statusCode).toBe(200)
    expect(res.body.sectors).toEqual([])
  })
})
