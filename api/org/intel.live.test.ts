// @vitest-environment node
/**
 * LIVE PROOF of the org intelligence scope against the real database —
 * read-only, opt-in, skipped unless ORG_INTEL_LIVE=1 and a service-role key
 * are in the environment (same pattern as api/intel/intel.live.test.ts).
 *
 * It runs the REAL handler with the REAL scoping predicates; only the JWT
 * verification is stubbed, to the auth uid of a real school leader. Two
 * directions, as the commission demands:
 *   POSITIVE  the leader of ORG_INTEL_OWN_NODE reads their own board and it
 *             carries real figures;
 *   NEGATIVE  the same leader naming ORG_INTEL_OTHER_NODE gets 403 and no data.
 *
 *   ORG_INTEL_LIVE=1 ORG_INTEL_LEADER_UID=<auth uid> ORG_INTEL_OWN_NODE=<id> \
 *   ORG_INTEL_OTHER_NODE=<id> SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   pnpm test:api -- api/org/intel.live.test.ts
 */
import { describe, it, expect, vi } from 'vitest'

const leaderUid = process.env.ORG_INTEL_LEADER_UID || ''
vi.mock('../_utils/auth', () => ({
  verifyAdmin: async () => ({ error: 'Requires SSi admin access', status: 403 }),
  verifyAuthToken: async () => ({ valid: !!leaderUid, userId: leaderUid }),
}))

const live = process.env.ORG_INTEL_LIVE === '1' && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!leaderUid

type Json = Record<string, any>
async function call(query: Record<string, string>): Promise<{ status: number; body: Json; ms: number }> {
  const mod = await import('./intel')
  let status = 0
  let body: Json = {}
  const res = { status(s: number) { status = s; return this }, json(b: Json) { body = b; return this }, setHeader() { return this }, end() { return this } }
  const t0 = Date.now()
  await mod.default({ method: 'GET', query, headers: { authorization: 'Bearer live' } } as any, res as any)
  return { status, body, ms: Date.now() - t0 }
}

describe.skipIf(!live)('org intel, live and read-only', () => {
  it('POSITIVE: the leader reads their own node with real figures', async () => {
    const { status, body, ms } = await call({ nodeId: process.env.ORG_INTEL_OWN_NODE! })
    expect(status).toBe(200)
    expect(body.practising.classCount).toBeGreaterThan(0)
    console.log('[org/intel own]', ms, 'ms', JSON.stringify({ node: body.node, practising: body.practising, quiet: body.quiet, stages: body.journey.stages, top3: body.classes.slice(0, 3).map((c: Json) => [c.name, c.phrasesThisWeek, c.position?.knownText]) }))
  }, 60_000)

  it('NEGATIVE: the same leader naming another org gets 403 and no data', async () => {
    const { status, body } = await call({ nodeId: process.env.ORG_INTEL_OTHER_NODE! })
    expect(status).toBe(403)
    expect(body.classes).toBeUndefined()
    expect(body.practising).toBeUndefined()
    console.log('[org/intel other]', status, JSON.stringify(body))
  }, 60_000)
})
