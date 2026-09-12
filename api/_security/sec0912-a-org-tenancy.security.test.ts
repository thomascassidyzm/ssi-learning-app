/**
 * SEC0912-A — org/group tenancy: the subtree predicate, and what runs before
 * the gate that enforces it.
 *
 * Full write-up: docs/security-audit-2026-09-12/README.md
 *
 * This is the NINTH security audit of this repo. It was scoped on the delta
 * since the 2026-09-05 audit's base — the intel surface (api/intel/*,
 * api/org/intel.ts), the support channel (api/support/*), the org-enrolment
 * money path, the copy-teacher-play write path and three new cron jobs. The
 * three findings below all live in the group-tree layer those new surfaces
 * lean on.
 *
 * Rules this audit ran under: FINDINGS AND TESTS ONLY. No production
 * behaviour was changed, no fix applied, nothing promoted, no money moved, no
 * mail sent, nothing deleted, and — declared as the honest gap — NO LIVE
 * DATABASE WAS READ OR PROBED. Every assertion below is derived from repo
 * source (handlers, migrations, supabase/schema.sql) and is pure: no DB, no
 * network, no child process.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SEC0912-A-01 (MEDIUM) — `is_govt_admin_over_group()` decides the subtree on
 *   `groups.path`, a NAME-DERIVED SLUG STRING, while every server-side copy of
 *   the same rule walks `parent_id`. Two root orgs that slug the same share a
 *   path, so a govt_admin of one satisfies the RLS predicate for the other.
 *   CHARACTERIZATION — expected to go red when the function is repointed at
 *   parent_id (or at an explicit closure table).
 *
 * SEC0912-A-02 (LOW/MEDIUM) — WRITE BEFORE AUTHZ. `ensureSchoolNode()` INSERTs
 *   a `groups` row and UPDATEs `schools.node_group_id` for whatever school id
 *   the caller names, under the SERVICE ROLE, BEFORE `callerCanSeeGroup()` is
 *   asked. Three handlers do it. CHARACTERIZATION.
 *
 * SEC0912-A-03 (LOW) — ID EXISTENCE ORACLE. The same three handlers answer 404
 *   for an id that matches no group/school/class and 403 for one that exists
 *   outside the caller's subtree, so any authenticated leader can enumerate
 *   real ids belonging to other tenants. CHARACTERIZATION.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf-8')

// ──────────────────────────────────────────────────────────────────────────
// SEC0912-A-01 — path-string subtree matching in a live RLS predicate
// ──────────────────────────────────────────────────────────────────────────

describe('SEC0912-A-01 — is_govt_admin_over_group matches on the name-derived path, not parent_id', () => {
  const schema = read('supabase/schema.sql')

  /** The function body as it stands in the committed snapshot of the live DB. */
  function govtAdminOverGroupBody(): string {
    const start = schema.indexOf('CREATE FUNCTION public.is_govt_admin_over_group(')
    expect(start, 'is_govt_admin_over_group must exist in supabase/schema.sql').toBeGreaterThan(-1)
    const end = schema.indexOf('$$;', start)
    return schema.slice(start, end)
  }

  it('CHARACTERIZATION: the predicate compares `path` strings and never mentions parent_id', () => {
    const body = govtAdminOverGroupBody()
    // The two path comparisons that ARE the subtree test.
    expect(body).toContain('target_g.path = admin_g.path')
    expect(body).toContain("target_g.path LIKE admin_g.path || '/%'")
    // The thing it does NOT do, which is the finding.
    expect(body).not.toContain('parent_id')
  })

  it('the server-side copy of the same rule walks parent_id — the two disagree by construction', () => {
    // groupSubtree.descendantIds is the in-process subtree used by every node
    // surface (org/intel, groups/[id]/home, rate-compare...).
    const subtree = read('api/_utils/groupSubtree.ts')
    expect(subtree).toContain('parent_id')
    // And the 2026-08-25 audit's own fix (TENANCY-04) says in prose, at the
    // call site it repaired, why the path must never be used.
    const schoolRateCompare = read('api/school/rate-compare.ts')
    expect(schoolRateCompare).toContain('never the slug path')
    // The fix stopped at the language boundary: the TypeScript call sites were
    // repointed at parent_id, the SQL predicate was not.
    expect(read('api/groups/[id]/rate-compare.ts')).toContain('TENANCY-02, fixed 2026-08-25')
  })

  it('the repo itself records that two root orgs CAN share a path, and that duplicates are permitted', () => {
    const slug = read('api/_utils/groupSlug.ts')
    // The live incident: two orgs called "Deborah Testing", same slug, and a
    // path-string subtree match folded each org's people into the other's.
    expect(slug).toContain('path-string subtree match')
    // Duplicates are a WARNING, never a constraint — confirm_duplicate proceeds.
    expect(slug).toContain('confirm_duplicate')
    // No unique index on groups.path anywhere in the schema or the migrations.
    expect(/CREATE\s+UNIQUE\s+INDEX[^;]*\bON\s+public\.groups\b[^;]*\bpath\b/i.test(schema)).toBe(false)
  })

  it('CHARACTERIZATION: two distinct root groups with the same name produce the same slug', () => {
    // groupSlug() is the repo's own mirror of compute_group_path()'s slug line.
    const slugLine = (name: string) => String(name ?? '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
    expect(slugLine('Deborah Testing')).toBe(slugLine('deborah  testing'))
    expect(slugLine('Deborah Testing')).toBe(slugLine('Deborah-Testing'))
    // …so `target_g.path = admin_g.path` is true across the tenant boundary.
  })

  it('names the live policies that ride the defective predicate, so the blast radius is pinned', () => {
    // A change that drops one of these is a change to the blast radius and
    // should be read, not merged silently.
    expect(schema).toContain('CREATE POLICY schools_select_admin_subtree ON public.schools')
    expect(schema).toMatch(/is_govt_admin_over_group\(s\.group_id\)/)
    // And the support channel (migration 20260911, UNAPPLIED at time of audit)
    // adds two more readers of the same predicate.
    const supportMig = read('supabase/migrations/20260911_support_channel.sql')
    expect(supportMig).toContain('public.is_govt_admin_over_group(group_id)')
    expect(supportMig).toContain('public.is_govt_admin_over_group(t.group_id)')
  })

  it('SECURE ASSERTION: the LIKE pattern cannot be wildcard-injected, because the slug strips % and _', () => {
    const slugLine = (name: string) => String(name ?? '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
    expect(slugLine('100% _everything_')).not.toMatch(/[%_]/)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// SEC0912-A-02 / A-03 — behaviour of api/org/intel.ts around its gate
// ──────────────────────────────────────────────────────────────────────────

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

/** What the fake database holds, per test. */
let TABLES: Record<string, any[]>
/** Every write the handler attempted, in order. */
let WRITES: Array<{ table: string; op: 'insert' | 'update'; payload: unknown }>

let callerResult: any
let canSeeGroup = false

vi.mock('../_utils/groupTreeAuth', () => ({
  resolveGroupTreeCaller: vi.fn(async () => callerResult),
  callerCanSeeGroup: vi.fn(async () => canSeeGroup),
}))
vi.mock('../_utils/schoolCoverageGate', () => ({
  isEntityCoverageExpired: vi.fn(async () => false),
}))
vi.mock('../_utils/vadVisibility', () => ({
  schoolIdsForNodeSubtree: vi.fn(async () => []),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const rows = () => (TABLES[table] ?? []).slice()
      const filters: Array<(r: any) => boolean> = []
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return chain },
        in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return chain },
        is: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: rows().filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
        single: async () => ({ data: rows().filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
        insert: (payload: unknown) => { WRITES.push({ table, op: 'insert', payload }); return chain },
        update: (payload: unknown) => { WRITES.push({ table, op: 'update', payload }); return chain },
        then: (resolveFn: any) => resolveFn({ data: rows().filter((r) => filters.every((f) => f(r))), error: null }),
      }
      return chain
    },
  }),
}))

function makeReq(query: Record<string, string>): any {
  return { method: 'GET', headers: {}, query }
}
function makeRes() {
  const state = { status: 0, body: null as any }
  const res: any = {
    setHeader: () => {},
    status(code: number) { state.status = code; return res },
    json(body: any) { state.body = body; return res },
    end() { return res },
  }
  return { state, res }
}

describe('SEC0912-A-02 / A-03 — api/org/intel.ts: what happens before the subtree gate', () => {
  beforeEach(() => {
    WRITES = []
    callerResult = { userId: 'leader-of-a', isAdmin: false, ownGroupId: 'group-a' }
    canSeeGroup = false // the caller is a leader of SOMETHING, but not of this node
    TABLES = {
      groups: [
        { id: 'group-a', parent_id: null, name: 'A' },
        { id: 'group-b', parent_id: null, name: 'B' },
      ],
      // A school in ANOTHER tenant, which has never had its node minted.
      schools: [
        { id: 'school-of-b', school_name: 'Other Tenant School', group_id: 'group-b', node_group_id: null, is_demo: false, is_test: false },
      ],
      classes: [],
    }
  })

  it('CHARACTERIZATION (A-02): naming another tenant\'s school INSERTs a groups row and UPDATEs that school, then answers 403', async () => {
    const handler = (await import('../org/intel')).default
    const { state, res } = makeRes()
    await handler(makeReq({ nodeId: 'school-of-b' }), res)

    // The gate did its job…
    expect(state.status).toBe(403)

    // …but only AFTER the service role had already written twice, on behalf of
    // a caller the very next line refuses. A read endpoint mutated the group
    // tree of a tenant the caller has no relationship with.
    expect(WRITES.map((w) => `${w.op} ${w.table}`)).toEqual(['insert groups', 'update schools'])
    expect((WRITES[0].payload as any).name).toBe('Other Tenant School')
    expect((WRITES[0].payload as any).parent_id).toBe('group-b')
  })

  it('SECURE ASSERTION: a school that already carries a node is not written to', async () => {
    TABLES.schools[0].node_group_id = 'node-of-b'
    TABLES.groups.push({ id: 'node-of-b', parent_id: 'group-b', name: 'Other Tenant School' })
    const handler = (await import('../org/intel')).default
    const { state, res } = makeRes()
    await handler(makeReq({ nodeId: 'school-of-b' }), res)
    expect(state.status).toBe(403)
    expect(WRITES).toEqual([])
  })

  it('CHARACTERIZATION (A-03): an id that exists answers 403 and an id that does not answers 404 — an existence oracle', async () => {
    const handler = (await import('../org/intel')).default

    const real = makeRes()
    await handler(makeReq({ nodeId: 'group-b' }), real.res)
    expect(real.state.status).toBe(403)

    const fake = makeRes()
    await handler(makeReq({ nodeId: 'no-such-id-at-all' }), fake.res)
    expect(fake.state.status).toBe(404)

    // Same caller, same lack of authority, two different answers. Any
    // authenticated leader can therefore test an id for existence.
    expect(real.state.status).not.toBe(fake.state.status)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// The other two handlers carrying the same shape — pinned by source, because
// standing up their fixtures proves nothing the test above has not.
// ──────────────────────────────────────────────────────────────────────────

describe('SEC0912-A-02 — the same mint-before-gate ordering in the two sibling handlers', () => {
  const SIBLINGS: Array<[string, string]> = [
    // [handler, the expression that IS its subtree gate]
    ['api/groups/[id]/home.ts', 'callerCanSeeGroup('],
    ['api/groups/[id]/rate-compare.ts', 'descendantIds(allGroups, scope.groupId).includes(nodeId)'],
  ]
  for (const [file, gateExpr] of SIBLINGS) {
    it(`CHARACTERIZATION: ${file} calls ensureSchoolNode before its subtree gate`, () => {
      const src = read(file)
      const mint = src.indexOf('ensureSchoolNode(')
      const gate = src.indexOf(gateExpr)
      expect(mint, `${file} should call ensureSchoolNode`).toBeGreaterThan(-1)
      expect(gate, `${file} should carry its subtree gate`).toBeGreaterThan(-1)
      expect(mint).toBeLessThan(gate)
    })
  }
})
