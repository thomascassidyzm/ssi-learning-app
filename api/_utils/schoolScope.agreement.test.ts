/**
 * AGREEMENT TEST — the two implementations of "which schools sit under this
 * group?" must return the same set.
 *
 * There are two, in two languages, and they are genuinely different algorithms:
 *
 *   1. SERVER (authoritative): `schoolsForGroupSubtree` in schoolScope.ts walks
 *      `parent_id` over the whole (small) groups forest — groupSubtree.descendantIds.
 *   2. BROWSER: useClassesData.ts's govt-admin branch does
 *      `groups.select('id').like('path', group_path + '%')`, then
 *      `schools.select('id').in('group_id', ids)`. A slug path prefix match.
 *
 * They decide who a govt admin can see. When they disagree, a leader either
 * sees a tenant that is not theirs, or loses one that is.
 *
 * `path` is `compute_group_path()` — a slugified NAME chain — and NOTHING makes
 * a slug unique. Two failure modes the prefix match cannot get right:
 *   (a) EQUAL paths — two unrelated root orgs of the same name (live, 2026-08-06:
 *       two "Deborah Testing" orgs). No boundary guard can help; the strings match.
 *   (b) BARE STRING-PREFIX paths — 'ime-demo' swallows 'ime-demo-two', because
 *       the LIKE has no '/' boundary.
 *
 * LIVE SHAPE, read 2026-09-05 (read-only; anonymised — no names, no ids):
 *   80 groups, 27 schools (15 with a NULL group_id), 52 roots, max depth 3
 *   segments, 66 leaf groups, 6 groups with any school in their subtree.
 *   Verdict: the two algorithms AGREE on all 80 live groups today.
 *   BUT the live forest already contains ONE collision pair — two unrelated
 *   ROOT groups sharing an identical single-segment `path`. They agree today
 *   only because neither of those two subtrees currently holds a school. The
 *   moment either does, the browser path shows one tenant the other's school.
 *   That latent case is fixture COLLIDING_TWIN below, and it is the one test
 *   here that asserts a DIVERGENCE rather than agreement — pinning the known
 *   defect rather than pretending it is fixed. Do NOT "fix" it by unifying the
 *   two algorithms in this file; the browser query is live authority code.
 */
import { describe, it, expect } from 'vitest'
import { schoolsForGroupSubtree } from './schoolScope'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

interface GroupRow { id: string; parent_id: string | null; path: string }
interface SchoolRow { id: string; group_id: string | null }

/**
 * The BROWSER algorithm, extracted verbatim in behaviour from
 * useClassesData.ts:226 (`.like('path', group_path + '%')` → schools
 * `.in('group_id', ids)`). Kept here as a named function so the rule under test
 * is stated in code: this is what the client believes a group's subtree is.
 */
function schoolsForGroupByPathPrefix(
  groups: GroupRow[],
  schools: SchoolRow[],
  groupPath: string,
): string[] {
  const groupIds = groups.filter((g) => g.path.startsWith(groupPath)).map((g) => g.id)
  if (groupIds.length === 0) return []
  return [
    ...new Set(
      schools.filter((s) => s.group_id && groupIds.includes(s.group_id)).map((s) => s.id),
    ),
  ]
}

/** A `svc` double over an in-memory forest — the shape schoolScope.ts queries. */
function makeSvc(groups: GroupRow[], schools: SchoolRow[]) {
  return {
    from(table: string) {
      if (table === 'groups') {
        const b: any = {
          select: () => b,
          then: (res: any) =>
            res({ data: groups.map((g) => ({ id: g.id, parent_id: g.parent_id })), error: null }),
        }
        return b
      }
      if (table === 'schools') {
        const b: any = {
          _ids: [] as string[],
          select: () => b,
          in: (_c: string, ids: string[]) => { b._ids = ids; return b },
          then: (res: any) =>
            res({ data: schools.filter((s) => s.group_id && b._ids.includes(s.group_id)), error: null }),
        }
        return b
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as any
}

const sorted = (a: string[]) => [...a].sort()

/**
 * LIVE-SHAPED FIXTURE — anonymised from the real forest read 2026-09-05.
 * Every awkward shape the live population actually contains is here: a root
 * with no children (the commonest live group — 66 of 80 are leaves), the
 * deepest live nesting (3 path segments), a school hanging off a mid-depth
 * group, schools with a NULL group_id (15 live), and an orphan group whose
 * parent_id points at a row that is not in the forest.
 */
const LIVE_GROUPS: GroupRow[] = [
  { id: 'g-root-a', parent_id: null, path: 'alpha' },
  { id: 'g-a-region', parent_id: 'g-root-a', path: 'alpha/north' },
  { id: 'g-a-district', parent_id: 'g-a-region', path: 'alpha/north/central' },
  { id: 'g-a-region2', parent_id: 'g-root-a', path: 'alpha/south' },
  { id: 'g-root-b', parent_id: null, path: 'bravo' }, // leaf root, no children
  { id: 'g-root-c', parent_id: null, path: 'charlie' },
  { id: 'g-orphan', parent_id: 'g-vanished', path: 'delta' }, // parent not in forest
]

const LIVE_SCHOOLS: SchoolRow[] = [
  { id: 's-deep', group_id: 'g-a-district' },
  { id: 's-mid', group_id: 'g-a-region2' },
  { id: 's-rootc', group_id: 'g-root-c' },
  { id: 's-orphan', group_id: 'g-orphan' },
  { id: 's-ungrouped-1', group_id: null }, // 15 of 27 live schools look like this
  { id: 's-ungrouped-2', group_id: null },
]

describe('subtree agreement — parent_id walk vs browser path-prefix, on live shapes', () => {
  for (const g of LIVE_GROUPS) {
    it(`agrees for ${g.id} (path depth ${g.path.split('/').length})`, async () => {
      const walk = await schoolsForGroupSubtree(makeSvc(LIVE_GROUPS, LIVE_SCHOOLS), g.id)
      const like = schoolsForGroupByPathPrefix(LIVE_GROUPS, LIVE_SCHOOLS, g.path)
      expect(sorted(like)).toEqual(sorted(walk))
    })
  }

  it('never includes a school with a NULL group_id, by either algorithm', async () => {
    for (const g of LIVE_GROUPS) {
      const walk = await schoolsForGroupSubtree(makeSvc(LIVE_GROUPS, LIVE_SCHOOLS), g.id)
      const like = schoolsForGroupByPathPrefix(LIVE_GROUPS, LIVE_SCHOOLS, g.path)
      expect(walk).not.toContain('s-ungrouped-1')
      expect(like).not.toContain('s-ungrouped-2')
    }
  })
})

/**
 * THE COLLISION SHAPES. (a) is LIVE in the forest right now — two unrelated
 * root groups with an identical path — and is currently harmless only because
 * neither subtree holds a school. Here each does, which is the exact state one
 * school creation away.
 */
const COLLIDING_TWIN: GroupRow[] = [
  { id: 'g-twin-1', parent_id: null, path: 'acme' },
  { id: 'g-twin-2', parent_id: null, path: 'acme' }, // same name → same slug, no relation
]
const TWIN_SCHOOLS: SchoolRow[] = [
  { id: 's-twin-1', group_id: 'g-twin-1' },
  { id: 's-twin-2', group_id: 'g-twin-2' },
]

const PREFIX_SIBLINGS: GroupRow[] = [
  { id: 'g-demo', parent_id: null, path: 'ime-demo' },
  { id: 'g-demo-two', parent_id: null, path: 'ime-demo-two' }, // bare string prefix, no '/'
]
const PREFIX_SCHOOLS: SchoolRow[] = [
  { id: 's-demo', group_id: 'g-demo' },
  { id: 's-demo-two', group_id: 'g-demo-two' },
]

describe('subtree agreement — the collision shapes the path prefix cannot express', () => {
  // ── DIVERGENCE PINNED, NOT FIXED ──────────────────────────────────────────
  // The parent_id walk is right and the browser query is wrong. This asserts
  // the wrong answer deliberately, so the defect is visible in code and the
  // test turns red the day the client is repointed at the server resolver.
  it('DIVERGES on equal paths: the browser leaks the twin tenant’s school', async () => {
    const walk = await schoolsForGroupSubtree(makeSvc(COLLIDING_TWIN, TWIN_SCHOOLS), 'g-twin-1')
    const like = schoolsForGroupByPathPrefix(COLLIDING_TWIN, TWIN_SCHOOLS, 'acme')
    expect(walk).toEqual(['s-twin-1']) // correct: only my own school
    expect(sorted(like)).toEqual(['s-twin-1', 's-twin-2']) // wrong: cross-tenant read
    expect(sorted(like)).not.toEqual(sorted(walk))
  })

  it('DIVERGES on a bare string-prefix sibling: ime-demo swallows ime-demo-two', async () => {
    const walk = await schoolsForGroupSubtree(makeSvc(PREFIX_SIBLINGS, PREFIX_SCHOOLS), 'g-demo')
    const like = schoolsForGroupByPathPrefix(PREFIX_SIBLINGS, PREFIX_SCHOOLS, 'ime-demo')
    expect(walk).toEqual(['s-demo'])
    expect(sorted(like)).toEqual(['s-demo', 's-demo-two'])
    expect(sorted(like)).not.toEqual(sorted(walk))
  })
})
