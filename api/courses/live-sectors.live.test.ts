import { describe, it, expect } from 'vitest'
import handler from './[code]/sectors'

// Gated exactly like its sibling api/courses/sectors.live.test.ts: this file
// calls the real handler, which builds a service-role Supabase client, so
// without SECTORS_LIVE=1 and live credentials it can only ever throw
// "supabaseUrl is required". Ungated, it turned `pnpm run test:api` red on
// every machine and in CI. The assertions are unchanged.
const LIVE = process.env.SECTORS_LIVE === '1'

function mockRes() {
  const r: any = { statusCode: 0, body: null, headers: {} as any }
  r.status = (c: number) => { r.statusCode = c; return r }
  r.json = (b: any) => { r.body = b; return r }
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r }
  return r
}
describe.skipIf(!LIVE)('LIVE sectors endpoint', () => {
  it('serves an empty list for spa_for_eng (the only walk is draft)', async () => {
    const res = mockRes()
    await handler({ method: 'GET', query: { code: 'spa_for_eng' } } as any, res as any)
    console.log('spa_for_eng ->', res.statusCode, JSON.stringify(res.body))
    expect(res.statusCode).toBe(200)
  })
  it('shows the registered health walk with include=draft', async () => {
    const res = mockRes()
    await handler({ method: 'GET', query: { code: 'spa_for_eng', include: 'draft' } } as any, res as any)
    console.log('spa_for_eng?include=draft ->', res.statusCode, JSON.stringify(res.body, null, 1))
    expect(res.statusCode).toBe(200)
  })
  it('an unregistered course is an empty list, not an error', async () => {
    const res = mockRes()
    await handler({ method: 'GET', query: { code: 'fra_for_eng' } } as any, res as any)
    console.log('fra_for_eng ->', res.statusCode, JSON.stringify(res.body))
    expect(res.statusCode).toBe(200)
  })
})
