// @vitest-environment node
/**
 * LIVE acceptance walk — the VAD visibility hierarchy against the REAL IME
 * Demo Programme, with the SHIPPED predicate (resolveVadScope), the service
 * role, and no mocks except the JWT.
 *
 * Gated: runs only with VAD_LIVE=1 and the service key in the environment.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… VAD_LIVE=1 \
 *     pnpm exec vitest run -c vitest.api.config.ts api/_utils/vadVisibility.live.test.ts
 *
 * WHY THIS EXISTS RATHER THAN A BROWSER WALK: only Tom's +ssi@ account is an
 * ssi_admin, so nobody here can log in AS an IME group leader and watch the
 * page render. The accepted substitute (used by the previous worker on this
 * surface) is to replay the endpoint's own queries against the live database
 * as the relevant roles and assert the answers. That is exactly what this does:
 * every caller below is resolved from a REAL govt_admins / learners row, and
 * every subtree walk is the real one.
 *
 * It asserts the ruling, not a snapshot: relationships (leader sees own
 * subtree, denied sideways) rather than counts that a demo refresh would
 * invalidate. The one quantitative check is the uptake FRACTION shape —
 * withData < total — which is the hide-don't-zero property, not a number.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

let verifyAdminResult: unknown = { error: 'not admin', status: 403 }
let verifyAuthTokenResult: unknown = { valid: false }
vi.mock('./auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
  verifyAuthToken: vi.fn(async () => verifyAuthTokenResult),
}))

const { resolveVadCaller, resolveVadScope, isDenied } = await import('./vadVisibility')

const live = process.env.VAD_LIVE === '1'
  && !!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  && !!process.env.SUPABASE_SERVICE_ROLE_KEY

const IME_PROGRAMME = '2d98bc20-a9c7-4fed-b69a-aa64038ded2a'

function makeRes() {
  const res: Record<string, unknown> = { statusCode: 0, body: null }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (p: unknown) => { res.body = p; return res }
  return res as unknown as VercelResponse & { statusCode: number }
}

describe.skipIf(!live)('LIVE — VAD visibility over the IME Demo Programme', () => {
  let svc: SupabaseClient
  let leaderUid = ''
  let outsideLeaderUid = ''
  let schoolAdminUid = ''
  let ownSchoolNodeId = ''
  let siblingSchoolNodeId = ''

  const callerFor = async (uid: string) => {
    verifyAdminResult = { error: 'not admin', status: 403 }
    verifyAuthTokenResult = { valid: true, userId: uid }
    const c = await resolveVadCaller({} as VercelRequest, makeRes(), svc)
    expect(c).not.toBeNull()
    return c!
  }

  beforeAll(async () => {
    svc = createClient(
      (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)!.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    )

    const { data: imeLeaders } = await svc.from('govt_admins').select('user_id').eq('group_id', IME_PROGRAMME).limit(1)
    leaderUid = (imeLeaders ?? [])[0]?.user_id
    const { data: others } = await svc.from('govt_admins').select('user_id, group_id').neq('group_id', IME_PROGRAMME).limit(50)
    outsideLeaderUid = (others ?? [])[0]?.user_id

    // Two IME schools, so "own vs sibling" is a real pair.
    const { data: schools } = await svc
      .from('schools')
      .select('id, school_name, node_group_id, admin_user_id')
      .in('school_name', ['Sunrise Public School, Pune', 'Harbour View School, Visakhapatnam'])
    const sunrise = (schools ?? []).find(s => String(s.school_name).startsWith('Sunrise'))
    const harbour = (schools ?? []).find(s => String(s.school_name).startsWith('Harbour'))
    ownSchoolNodeId = sunrise?.node_group_id
    siblingSchoolNodeId = harbour?.node_group_id
    schoolAdminUid = sunrise?.admin_user_id
  })

  it('the IME group leader sees the whole programme subtree, with classes', async () => {
    const caller = await callerFor(leaderUid)
    expect(caller.ownGroupId).toBe(IME_PROGRAMME)
    const scope = await resolveVadScope(svc, caller, { groupId: IME_PROGRAMME })
    expect(isDenied(scope)).toBe(false)
    if (isDenied(scope)) return
    console.log(`[live] IME programme: ${scope.learnerIds.length} learners across ${scope.classes.length} classes`)
    expect(scope.learnerIds.length).toBeGreaterThan(50)
    expect(scope.classes.length).toBeGreaterThan(0)
  })

  it('the IME group leader reaches a school NODE inside the subtree', async () => {
    const caller = await callerFor(leaderUid)
    const scope = await resolveVadScope(svc, caller, { groupId: ownSchoolNodeId })
    expect(isDenied(scope)).toBe(false)
    if (isDenied(scope)) return
    console.log(`[live] Sunrise Pune: ${scope.learnerIds.length} learners`)
    expect(scope.learnerIds.length).toBeGreaterThan(0)
  })

  it('a leader of ANOTHER org is denied the IME programme — never sideways', async () => {
    const caller = await callerFor(outsideLeaderUid)
    const scope = await resolveVadScope(svc, caller, { groupId: IME_PROGRAMME })
    expect(isDenied(scope)).toBe(true)
    if (!isDenied(scope)) return
    expect(scope.status).toBe(403)
  })

  it('a school leader sees their own school and is denied the sibling school', async () => {
    const caller = await callerFor(schoolAdminUid)
    expect(caller.ownGroupId).toBe(ownSchoolNodeId)
    const own = await resolveVadScope(svc, caller, { groupId: ownSchoolNodeId })
    expect(isDenied(own)).toBe(false)
    const sibling = await resolveVadScope(svc, caller, { groupId: siblingSchoolNodeId })
    expect(isDenied(sibling)).toBe(true)
    const up = await resolveVadScope(svc, caller, { groupId: IME_PROGRAMME })
    expect(isDenied(up)).toBe(true)          // never upwards either
  })

  it('HIDE, DON’T ZERO — the live roster is wider than the set carrying VAD', async () => {
    const caller = await callerFor(leaderUid)
    const scope = await resolveVadScope(svc, caller, { groupId: IME_PROGRAMME })
    if (isDenied(scope)) throw new Error('expected access')

    const withData = new Set<string>()
    for (let i = 0; i < scope.learnerIds.length; i += 150) {
      const { data } = await svc
        .from('learner_lego_metrics')
        .select('learner_id')
        .in('learner_id', scope.learnerIds.slice(i, i + 150))
      for (const r of data ?? []) withData.add(String((r as { learner_id: string }).learner_id))
    }
    console.log(`[live] uptake: ${withData.size} of ${scope.learnerIds.length} carry VAD data`)
    expect(withData.size).toBeGreaterThan(0)
    // The gap is the insight. If these were ever equal, something had filled it.
    expect(withData.size).toBeLessThan(scope.learnerIds.length)
  })
})
