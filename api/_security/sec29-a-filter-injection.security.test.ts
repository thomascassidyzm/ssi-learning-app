/**
 * SEC29-A — PostgREST filter-string injection & predicate-construction sweep.
 *
 * `.or()`, `.filter()`, `.match()`, `.like()` etc. take a raw PostgREST filter
 * DSL string, not a bound parameter. This file characterizes the real
 * predicate-construction bugs found by the sweep (docs/security-audit-2026-08-29/
 * area-a-filter-injection.md carries the full census and writeup) and locks
 * the controls that were checked and hold.
 *
 * Convention: a live finding is a PASSING characterization test (asserts
 * today's insecure behaviour) tagged `// SECURITY FINDING <ID>:`, paired with
 * an `it.todo(...)` naming the fix. A held control is an ordinary passing
 * lock test. No production code is touched by this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key'
process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL

// ─────────────────────────────────────────────────────────────────────────
// SEC29-A-01 — api/school/class-progress.ts: .or() ratchet-filter injection
// via untyped request-body args.
//
// Already filed as SEC-AUDIT-2026-08-18 Finding 4, confirmed STILL LIVE by
// reading current code (setLivePosition/setMode, lines ~224/254). NEW
// evidence this sweep adds: the existing characterization test for it,
// api/school/class-progress.untrustedArgs.security-audit.ts, is NOT picked
// up by CI — vitest.api.config.ts's `include` is `api/**/*.test.ts` and that
// file is named `*.security-audit.ts`, so it has never actually run. A team
// that "fixed" this finding and watched CI stay green would have learned
// nothing. Not re-characterized here (the existing file already does it
// correctly in substance) — filed as a test-harness gap, not a new bug.
// ─────────────────────────────────────────────────────────────────────────
describe('SEC29-A-01 — class-progress characterization test is invisible to CI (gap, not re-tested here)', () => {
  it('the include glob only matches *.test.ts, so *.security-audit.ts never runs', async () => {
    const { default: config } = await import('../../vitest.api.config')
    // @ts-expect-error - vitest config shape, read defensively
    const include: string[] = config.test?.include ?? []
    expect(include).toContain('api/**/*.test.ts')
    // The finding: this glob does NOT also match the sibling audit file.
    const matchesSecurityAudit = include.some((g) => g.includes('security-audit'))
    expect(matchesSecurityAudit).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Shared mock harness for the groups-subtree tenancy-collision findings.
// Real production functions are exercised; only '@supabase/supabase-js' is
// mocked, as a generic recording builder keyed by table name.
// ─────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>
let tableData: Record<string, Row[]> = {}
const likeCalls: { table: string; column: string; pattern: string }[] = []

function makeBuilder(table: string): any {
  let rows: Row[] = tableData[table] ?? []
  const applyEq = (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val) }
  const applyIn = (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])) }
  const applyLike = (col: string, pattern: string) => {
    likeCalls.push({ table, column: col, pattern })
    // Real Postgres LIKE semantics for the one wildcard shape this codebase
    // ever builds (`${prefix}%`): a plain prefix match.
    const prefix = pattern.endsWith('%') ? pattern.slice(0, -1) : pattern
    rows = rows.filter((r) => typeof r[col] === 'string' && (r[col] as string).startsWith(prefix))
  }
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => { applyEq(c, v); return b },
    neq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] !== v); return b },
    in: (c: string, v: unknown[]) => { applyIn(c, v); return b },
    like: (c: string, p: string) => { applyLike(c, p); return b },
    not: () => b,
    limit: () => b,
    is: (c: string, v: unknown) => { rows = rows.filter((r) => (v === null ? r[c] == null : r[c] === v)); return b },
    order: () => b,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: any) => resolve({ data: rows, error: null }),
  }
  return b
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeBuilder(table) }),
}))

beforeEach(() => {
  likeCalls.length = 0
  tableData = {}
})

// ─────────────────────────────────────────────────────────────────────────
// SEC29-A-02 — api/_utils/orgPlatform.ts: countSubtreeMembers() resolves
// subtree membership by slug-path prefix (`.like('path', '<path>%')`)
// instead of the parent_id walk (groupSubtree.descendantIds) that the
// 2026-08-06 fix (c2f04665) put everywhere else. Two orgs with the same
// name slug to the same `groups.path` (compute_group_path() in
// supabase/schema.sql has no uniqueness — this is the exact precondition
// TENANCY-01 already proved is reachable via the self-serve create endpoint's
// confirm_duplicate bypass). countSubtreeMembers feeds the org-leader
// dashboard's seat/member-count display (api/org/subscription.ts) — a real
// leader is shown a headcount that silently includes an unrelated tenant's
// staff and students.
// ─────────────────────────────────────────────────────────────────────────
describe('SEC29-A-02 — countSubtreeMembers cross-tenant member-count leak on duplicate slug', () => {
  it('SECURITY FINDING SEC29-A-02: a same-slug sibling tenant\'s people are counted into this org\'s member count', async () => {
    // Two DIFFERENT orgs (different ids, unrelated in the tree) that both
    // slugged to 'acme' because they share a name — exactly the "Deborah
    // Testing" collision c2f04665 fixed everywhere except this file.
    tableData.groups = [
      { id: 'org-a', path: 'acme', parent_id: null },
      { id: 'org-b-unrelated-tenant', path: 'acme', parent_id: null },
    ]
    tableData.user_tags = [
      { user_id: 'alice-org-a', tag_type: 'group', tag_value: 'GROUP:org-a', removed_at: null },
      // Belongs to the OTHER tenant, org-b — should never appear in org-a's count.
      { user_id: 'mallory-org-b', tag_type: 'group', tag_value: 'GROUP:org-b-unrelated-tenant', removed_at: null },
    ]

    const { createClient } = await import('@supabase/supabase-js')
    const svc = createClient('http://x', 'key')
    const { countSubtreeMembers } = await import('../_utils/orgPlatform')

    const count = await countSubtreeMembers(svc as any, 'org-a')

    // TODAY: both tenants' people are counted because both groups rows carry
    // path='acme' and .like('path','acme%') matches both.
    expect(count).toBe(2)
    expect(likeCalls.some((c) => c.table === 'groups' && c.column === 'path')).toBe(true)
  })

  it.todo('SEC29-A-02 fix: countSubtreeMembers should walk parent_id via groupSubtree.descendantIds, like every other subtree resolver post-c2f04665')
})

// ─────────────────────────────────────────────────────────────────────────
// SEC29-A-03 — api/_utils/demoSchoolGraph.ts: resolveGroupSubtreeIds() has
// the identical slug-path bug, feeding api/admin/demo-schools.ts's
// discoverDemoOrgGraph (used by the expire/ban/purge sweep) and
// api/admin/demo-leaf.ts. Blast radius is admin-only (an ssi_admin already
// has full data access), so this is not a privilege-escalation path — but it
// is a real collateral-damage risk: an admin expiring/purging demo org
// "Acme Testing" would also sweep a same-slugged SIBLING org's staff/students
// into the same graph, and TENANCY-01 already shows duplicate names occur in
// this system in practice.
// ─────────────────────────────────────────────────────────────────────────
describe('SEC29-A-03 — resolveGroupSubtreeIds merges same-slug tenants (admin blast-radius)', () => {
  it('SECURITY FINDING SEC29-A-03: a same-slug sibling org is pulled into the subtree', async () => {
    tableData.groups = [
      { id: 'demo-org-a', path: 'acme-testing', parent_id: null },
      { id: 'demo-org-b-different-tenant', path: 'acme-testing', parent_id: null },
      { id: 'unrelated', path: 'globex', parent_id: null },
    ]

    const { createClient } = await import('@supabase/supabase-js')
    const svc = createClient('http://x', 'key')
    const { resolveGroupSubtreeIds } = await import('../_utils/demoSchoolGraph')

    const ids = await resolveGroupSubtreeIds(svc as any, 'demo-org-a')

    // TODAY: the string-equality/prefix filter in resolveGroupSubtreeIds
    // treats the other org's row as part of demo-org-a's subtree.
    expect(ids).toContain('demo-org-b-different-tenant')
    expect(ids).not.toContain('unrelated')
  })

  it.todo('SEC29-A-03 fix: resolveGroupSubtreeIds should walk parent_id (groupSubtree.descendantIds) instead of matching groups.path')
})

// ─────────────────────────────────────────────────────────────────────────
// Controls that hold.
// ─────────────────────────────────────────────────────────────────────────
describe('SEC29-A controls that hold', () => {
  it('groups.path cannot carry PostgREST metacharacters (compute_group_path charset), so invites.ts:132\'s .or() is not metacharacter-injectable — TENANCY-01 is a slug-COLLISION bug, not a syntax-injection bug', () => {
    // Mirrors supabase/schema.sql compute_group_path(): LOWER(REGEXP_REPLACE(NEW.name, '[^a-zA-Z0-9]+', '-', 'g'))
    const slugify = (name: string) => name.toLowerCase().replace(/[^a-zA-Z0-9]+/g, '-')
    const attackerChosenNames = [
      'a,path.neq.impossible',
      'a"drop--',
      'a(b)c',
      'a%b_c',
      "a';select",
    ]
    for (const name of attackerChosenNames) {
      const slug = slugify(name)
      // None of the PostgREST filter-DSL metacharacters survive slugification.
      expect(slug).not.toMatch(/[,.()%"']/)
    }
  })

  it('descendantIds (the fixed parent_id walk) does NOT merge same-slug tenants — the shape countSubtreeMembers/resolveGroupSubtreeIds should be calling', async () => {
    const { descendantIds } = await import('../_utils/groupSubtree')
    const forest = [
      { id: 'org-a', parent_id: null },
      { id: 'org-b-same-slug-different-tenant', parent_id: null },
    ]
    expect(descendantIds(forest as any, 'org-a')).toEqual(['org-a'])
  })
})
