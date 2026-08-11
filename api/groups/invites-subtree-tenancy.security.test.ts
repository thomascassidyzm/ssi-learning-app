/**
 * SECURITY AUDIT 2026-08-11 — area `tenancy`, finding TENANCY-01 (critical).
 *
 * GET /api/groups/:id/invites?scope=subtree resolves its subtree by SLUG PATH
 * (api/groups/[id]/invites.ts:132, `path.eq.${path},path.like.${path}/%`)
 * rather than by the `parent_id` walk that `groupSubtree.ts` has mandated since
 * 2026-08-06. Two unrelated root organisations whose names slug identically
 * have EQUAL paths, so `path.eq` folds one tenant's whole subtree into the
 * other's — and the response for that lens carries invite `code`s, redeemable
 * sign-in `url`s and `personalEmail`s.
 *
 * The collision is attacker-creatable: root-org creation is self-serve
 * (api/groups/index.ts:58-67) and the duplicate-name check is a warning that
 * `confirm_duplicate: true` bypasses (api/_utils/groupSlug.ts:10-13).
 *
 * The caller here is a LEGITIMATE leader of `attacker-root` asking about their
 * OWN node — the door check at invites.ts:111 (`callerCanSeeGroup`, correctly
 * parent_id-based) passes honestly. The leak is entirely downstream of it.
 *
 * Full write-up: docs/security-audit-2026-08-11/tenancy.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

// The attacker is a real, signed-in leader of their own root org — never an admin.
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => ({ error: 'not admin', status: 403, userId: 'attacker-uid' })),
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'attacker-uid' })),
}))

// Two unrelated root tenants, identical slug path — the live 2026-08-06 shape.
const GROUPS = [
  { id: 'attacker-root', name: 'Deborah Testing', path: 'deborah-testing', parent_id: null },
  { id: 'victim-root', name: 'Deborah Testing', path: 'deborah-testing', parent_id: null },
  { id: 'victim-child', name: 'Hillside', path: 'deborah-testing/hillside', parent_id: 'victim-root' },
  { id: 'unrelated-root', name: 'Other Org', path: 'other-org', parent_id: null },
]

const SCHOOLS = [
  { id: 'victim-school', school_name: 'Hillside School', group_id: 'victim-root', node_group_id: 'victim-child' },
]

const INVITE_CODES = [
  {
    id: 'code-victim-1',
    code: 'VICTIM-1',
    code_type: 'govt_admin',
    // A "specific person's login" (invites.ts:49-51) belonging to the OTHER tenant.
    metadata: { personal_auth_user_id: 'victim-leader-uid', personal_name: 'Victim Leader', personal_email: 'victim@example.org' },
    max_uses: null,
    use_count: 0,
    expires_at: null,
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    created_by: 'victim-leader-uid',
    grants_group_id: 'victim-root',
    grants_school_id: null,
    grants_class_id: null,
  },
  {
    id: 'code-attacker-1',
    code: 'ATTACK-1',
    code_type: 'teacher',
    metadata: {},
    max_uses: 5,
    use_count: 0,
    expires_at: null,
    is_active: true,
    created_at: '2026-08-02T00:00:00Z',
    created_by: 'attacker-uid',
    grants_group_id: 'attacker-root',
    grants_school_id: null,
    grants_class_id: null,
  },
]

/**
 * Enough of PostgREST to drive this handler: `.eq` filters, and the two `.or`
 * shapes the endpoint builds (`path.eq.X,path.like.X/%` and
 * `grants_*.in.(a,b)`), evaluated over the fixtures above.
 */
function makeChainable(table: string) {
  const eqs: [string, unknown][] = []
  let orExpr: string | null = null

  const rowsFor = (): any[] => {
    if (table === 'groups') {
      if (orExpr) {
        const eqMatch = /path\.eq\.([^,]+)/.exec(orExpr)
        const likeMatch = /path\.like\.([^,]+)\/%/.exec(orExpr)
        return GROUPS.filter(
          (g) =>
            (eqMatch && g.path === eqMatch[1]) ||
            (likeMatch && g.path.startsWith(likeMatch[1] + '/')),
        )
      }
      return GROUPS
    }
    if (table === 'schools') {
      if (orExpr) {
        const ids = [...orExpr.matchAll(/\.in\.\(([^)]*)\)/g)].flatMap((m) => m[1].split(','))
        return SCHOOLS.filter((s) => ids.includes(s.group_id!) || ids.includes(s.node_group_id!))
      }
      return SCHOOLS
    }
    if (table === 'invite_codes') {
      if (orExpr) {
        const groupIds = /grants_group_id\.in\.\(([^)]*)\)/.exec(orExpr)?.[1].split(',') ?? []
        const schoolIds = /grants_school_id\.in\.\(([^)]*)\)/.exec(orExpr)?.[1].split(',') ?? []
        return INVITE_CODES.filter(
          (c) =>
            (c.grants_group_id && groupIds.includes(c.grants_group_id)) ||
            (c.grants_school_id && schoolIds.includes(c.grants_school_id)),
        )
      }
      return []
    }
    return []
  }

  const builder: any = {}
  builder.select = () => builder
  builder.eq = (col: string, val: unknown) => { eqs.push([col, val]); return builder }
  builder.in = () => builder
  builder.is = () => builder
  builder.or = (expr: string) => { orExpr = expr; return builder }
  builder.order = () => builder
  builder.limit = () => builder
  builder.maybeSingle = () => {
    if (table === 'groups') {
      const id = eqs.find(([c]) => c === 'id')?.[1]
      return Promise.resolve({ data: GROUPS.find((g) => g.id === id) ?? null, error: null })
    }
    if (table === 'schools') {
      const nodeId = eqs.find(([c]) => c === 'node_group_id')?.[1]
      return Promise.resolve({ data: SCHOOLS.find((s) => s.node_group_id === nodeId) ?? null, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }
  builder.then = (resolve: any) => resolve({ data: rowsFor(), error: null })
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

// The attacker genuinely leads `attacker-root`; the parent_id-based door check
// at invites.ts:111 therefore passes on its own merits.
vi.mock('../_utils/groupTreeAuth', () => ({
  resolveGroupTreeCaller: vi.fn(async () => ({ userId: 'attacker-uid', isAdmin: false, ownGroupId: 'attacker-root' })),
  callerCanSeeGroup: vi.fn(async (_svc: unknown, caller: any, groupId: string) => caller.ownGroupId === groupId),
}))

let handler: typeof import('./[id]/invites').default

function makeReq(): VercelRequest {
  return {
    method: 'GET',
    // The attacker asks about their OWN node. Nothing here names the victim.
    query: { id: 'attacker-root', scope: 'subtree' },
    headers: { authorization: 'Bearer tok', host: 'app.example.com' },
  } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  handler = (await import('./[id]/invites')).default
})

/**
 * SECURITY FINDING TENANCY-01: a leader of `attacker-root` receives
 * `victim-root`'s invite codes — including the redeemable personal sign-in URL
 * and the personal email address of the victim tenant's leader — because
 * resolveSubtree() matched on `path.eq`. The same contaminated set decides
 * PATCH ownership at invites.ts:174-178, so revoke/rotate/resend on those codes
 * also succeeds.
 *
 * WHAT SHOULD HAPPEN INSTEAD: resolveSubtree() should resolve membership with
 * `descendantIds` / `fetchSubtree` from _utils/groupSubtree.ts (the parent_id
 * walk), which cannot cross a slug collision — locked by
 * api/_utils/tenancySubtreeScope.security.test.ts. The response should then
 * contain ONLY `ATTACK-1`.
 */
describe('SECURITY FINDING TENANCY-01 — invites ?scope=subtree crosses a slug-path collision', () => {
  it('returns the OTHER tenant’s invite codes to a leader asking about their own node (current behaviour)', async () => {
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    const codes = (res.body.links as any[]).map((l) => l.code)

    expect(codes).toContain('ATTACK-1') // legitimately theirs
    expect(codes).toContain('VICTIM-1') // ← the defect: another tenant's code
  })

  it('leaks the victim leader’s personal email and redeemable sign-in URL (current behaviour)', async () => {
    const res = makeRes()
    await handler(makeReq(), res)

    const victim = (res.body.links as any[]).find((l) => l.code === 'VICTIM-1')
    expect(victim).toBeDefined()
    expect(victim.species).toBe('personal')
    expect(victim.personalEmail).toBe('victim@example.org') // ← PII of another tenant
    expect(victim.url).toContain('VICTIM-1') // ← a redeemable login link
  })

  it('does NOT reach a tenant whose path does not collide (the boundary that does hold)', async () => {
    const res = makeRes()
    await handler(makeReq(), res)

    const codes = (res.body.links as any[]).map((l) => l.code)
    expect(codes.every((c: string) => c !== 'OTHER-ORG')).toBe(true)
  })

  it.todo('TENANCY-01: resolveSubtree() must use descendantIds(parent_id) so only ATTACK-1 is returned')
  it.todo('TENANCY-01: PATCH revoke/rotate/resend must reject a code outside the parent_id subtree')
})
