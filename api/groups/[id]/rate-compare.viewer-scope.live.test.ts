// @vitest-environment node
/**
 * LIVE PROBE, read-only, opt-in (INSIGHTS_LIVE=1 + service key): does View-as
 * change the NUMBERS a node insights page shows? Tom's hypothesis (2026-09-11)
 * was that under View-as the tool might scope to the viewer's own data. This
 * calls the node rate-compare for one Chepstow class twice: as an ssi_admin
 * and as Angharad's own auth user id, with the real caller resolver. On
 * 2026-09-11 both answers were identical to the decimal; only kFloor differed
 * (1 for the admin, 5 for the leader). Scope is the URL's node, never the
 * viewer.
 */
import { describe, it, expect, vi } from 'vitest'
let asAdmin = true
const ANGHARAD_UID = '96105179-6598-4f2b-9281-a1d28270581b'
vi.mock('../../_utils/auth', () => ({
  verifyAdmin: async () => (asAdmin ? { userId: 'live-probe' } : { error: 'not admin', status: 403 }),
  verifyAuthToken: async () => ({ valid: true, userId: asAdmin ? 'live-probe' : ANGHARAD_UID }),
}))
const live = process.env.INSIGHTS_LIVE === '1' && !!process.env.SUPABASE_SERVICE_ROLE_KEY
async function call(mod: any, query: Record<string, string>) {
  let status = 0; let body: any = {}
  const res = { status(s: number) { status = s; return this }, json(b: any) { body = b; return this }, setHeader() { return this }, end() { return this } }
  await mod.default({ method: 'GET', query, headers: { authorization: 'Bearer live' } }, res)
  return { status, body }
}
describe.skipIf(!live)('8H live', () => {
  it('admin vs Angharad', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const svc = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: cls } = await svc.from('classes').select('id, class_name, class_learner_id').eq('school_id', '0f5bd6e4-f40b-4dbf-ac4f-a93478d20255').eq('class_name', '8H').maybeSingle()
    console.log('[8H]', JSON.stringify(cls))
    const mod = await import('./rate-compare')
    for (const who of ['admin', 'angharad']) {
      asAdmin = who === 'admin'
      vi.resetModules()
      const m = await import('./rate-compare')
      for (const measure of ['minutes_per_class', 'rate']) {
        const { status, body } = await call(m, { id: (cls as any).id, window: '7d', measure })
        console.log(`[${who} ${measure}] ${status}`, JSON.stringify({ node: body.node, applied: body.applied, insufficient: body.insufficientData, reason: body.reason, entity: body.entity, average: body.average, cohortSize: body.cohortSize, kFloor: body.kFloor, error: body.error }))
        expect(status).toBe(200)
      }
    }
    void mod
  }, 120_000)
})
