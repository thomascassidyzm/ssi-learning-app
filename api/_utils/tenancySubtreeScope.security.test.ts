/**
 * SECURITY AUDIT 2026-08-11 — area `tenancy`.
 *
 * Subtree scope resolution: `parent_id` walk (correct) vs slug-path string
 * comparison (the pre-2026-08-06 rule that four call sites still use).
 *
 * `groupSubtree.ts`'s own header is the specification here: "SUBTREE MEMBERSHIP
 * IS BY `parent_id`, NOT BY SLUG PATH ... two orgs both called 'Deborah
 * Testing' both got `path = 'deborah-testing'` live, so every `path LIKE
 * '<root>%'` resolver silently merged two unrelated tenants."
 *
 * These tests lock the correct primitives in place (they are what the vulnerable
 * call sites should be switched to) and characterise the path-string rule the
 * vulnerable sites actually apply, so the difference is executable.
 *
 * Findings: TENANCY-01 (api/groups/[id]/invites.ts:132),
 *           TENANCY-02 (api/groups/[id]/rate-compare.ts:319),
 *           TENANCY-04 (api/school/rate-compare.ts:119),
 *           TENANCY-05 (api/_utils/orgPlatform.ts:142).
 * Full write-up: docs/security-audit-2026-08-11/tenancy.md
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { descendantIds, type ParentLinked } from './groupSubtree'
import { isStrictDescendantGroup } from './schoolScope'
import { isWithinLeaderSubtree } from './orgLeader'

/**
 * Two unrelated root tenants whose names slug identically, each with a child.
 * This is the live 2026-08-06 shape recorded in groupSubtree.ts's header.
 */
const COLLIDING_FOREST: (ParentLinked & { path: string })[] = [
  { id: 'victim-root', parent_id: null, path: 'deborah-testing' },
  { id: 'victim-school', parent_id: 'victim-root', path: 'deborah-testing/hillside' },
  { id: 'attacker-root', parent_id: null, path: 'deborah-testing' },
  { id: 'attacker-school', parent_id: 'attacker-root', path: 'deborah-testing/decoy' },
]

/** A prefix pair with no '/' boundary — the second failure mode. */
const PREFIX_FOREST: (ParentLinked & { path: string })[] = [
  { id: 'ime-demo-root', parent_id: null, path: 'ime-demo' },
  { id: 'ime-demo-two-root', parent_id: null, path: 'ime-demo-two' },
  { id: 'ime-demo-two-child', parent_id: 'ime-demo-two-root', path: 'ime-demo-two/school' },
]

/** Minimal service-client stub: every `.from('groups').select(...)` yields the forest. */
function makeSupabase(forest: ParentLinked[]): SupabaseClient {
  const builder: any = {
    select: () => Promise.resolve({ data: forest, error: null }),
  }
  return { from: () => builder } as unknown as SupabaseClient
}

describe('CONTROL — parent_id walk is collision-proof (schoolScope / orgLeader / groupSubtree)', () => {
  it('descendantIds never crosses into a same-path unrelated tenant', () => {
    const ids = descendantIds(COLLIDING_FOREST, 'attacker-root')
    expect(ids).toContain('attacker-root')
    expect(ids).toContain('attacker-school')
    expect(ids).not.toContain('victim-root')
    expect(ids).not.toContain('victim-school')
  })

  it('descendantIds does not swallow a non-boundary prefix sibling', () => {
    expect(descendantIds(PREFIX_FOREST, 'ime-demo-root')).toEqual(['ime-demo-root'])
  })

  it('isStrictDescendantGroup denies an unrelated group that shares a path', async () => {
    const svc = makeSupabase(COLLIDING_FOREST)
    await expect(isStrictDescendantGroup(svc, 'attacker-root', 'victim-root')).resolves.toBe(false)
    await expect(isStrictDescendantGroup(svc, 'attacker-root', 'victim-school')).resolves.toBe(false)
  })

  it('isStrictDescendantGroup still allows a genuine descendant, and never self', async () => {
    const svc = makeSupabase(COLLIDING_FOREST)
    await expect(isStrictDescendantGroup(svc, 'attacker-root', 'attacker-school')).resolves.toBe(true)
    await expect(isStrictDescendantGroup(svc, 'attacker-root', 'attacker-root')).resolves.toBe(false)
  })

  it('isWithinLeaderSubtree — the predicate the write paths use — denies the colliding tenant', async () => {
    const svc = makeSupabase(COLLIDING_FOREST)
    // Self and own descendant: allowed.
    await expect(isWithinLeaderSubtree(svc, 'attacker-root', 'attacker-root')).resolves.toBe(true)
    await expect(isWithinLeaderSubtree(svc, 'attacker-root', 'attacker-school')).resolves.toBe(true)
    // The other tenant with the identical slug path: denied.
    await expect(isWithinLeaderSubtree(svc, 'attacker-root', 'victim-root')).resolves.toBe(false)
    await expect(isWithinLeaderSubtree(svc, 'attacker-root', 'victim-school')).resolves.toBe(false)
  })
})

// ---------------------------------------------------------------------------

/**
 * SECURITY FINDING TENANCY-02: api/groups/[id]/rate-compare.ts:319 decides
 * authorization with
 *     nodePath === ownPath || nodePath.startsWith(ownPath + '/')
 * calling the correct `isStrictDescendantGroup` only as a fallback when a path
 * is missing. `nodePath === ownPath` is a GRANT, so a leader of one tenant is
 * authorised over an unrelated tenant whose org name slugs the same — and the
 * `startsWith` half then extends that grant to the victim's whole subtree.
 *
 * SECURITY FINDING TENANCY-01: api/groups/[id]/invites.ts:132 selects the
 * subtree with `path.eq.${path},path.like.${path}/%` — the `.eq` half has the
 * same defect, and decides both what the subtree lens LISTS (invite codes,
 * personal sign-in URLs, personal emails) and what PATCH may revoke/rotate.
 *
 * SECURITY FINDING TENANCY-04 / TENANCY-05: api/school/rate-compare.ts:119 and
 * api/_utils/orgPlatform.ts:142 use `like('path', `${path}%`)` — weaker still,
 * with no '/' boundary at all.
 *
 * What should happen instead: all four resolve membership through
 * `descendantIds` / `isStrictDescendantGroup` (locked by the CONTROL block
 * above), so a slug collision can never widen a tenant boundary.
 *
 * The tests below characterise the CURRENT (vulnerable) comparisons so the
 * defect is executable without a red suite.
 */
describe('SECURITY FINDING TENANCY-01/02/04/05 — slug-path comparison leaks across tenants', () => {
  const pathOf = (id: string) =>
    [...COLLIDING_FOREST, ...PREFIX_FOREST].find((g) => g.id === id)!.path

  it('TENANCY-02: path equality authorises a leader over an unrelated tenant (current behaviour)', () => {
    const ownPath = pathOf('attacker-root')
    const nodePath = pathOf('victim-root')
    // The literal expression at api/groups/[id]/rate-compare.ts:319.
    const authorized = nodePath === ownPath || nodePath.startsWith(ownPath + '/')
    expect(authorized).toBe(true) // ← the defect: should be false
  })

  it('TENANCY-02: the grant propagates down the victim subtree (current behaviour)', () => {
    const ownPath = pathOf('attacker-root')
    const nodePath = pathOf('victim-school')
    const authorized = nodePath === ownPath || nodePath.startsWith(ownPath + '/')
    expect(authorized).toBe(true) // ← the defect: should be false
  })

  it('TENANCY-01: `path.eq` folds the victim tenant into the attacker subtree (current behaviour)', () => {
    const ownPath = pathOf('attacker-root')
    // PostgREST `path.eq.<p>,path.like.<p>/%` evaluated locally.
    const matched = COLLIDING_FOREST.filter(
      (g) => g.path === ownPath || g.path.startsWith(ownPath + '/'),
    ).map((g) => g.id)
    expect(matched).toContain('victim-root') // ← the defect
    expect(matched).toContain('attacker-root')
  })

  it('TENANCY-04/05: unbounded `like path%` also swallows a non-boundary prefix sibling (current behaviour)', () => {
    const rootPath = pathOf('ime-demo-root')
    // The literal filter at api/school/rate-compare.ts:119 / orgPlatform.ts:142.
    const matched = PREFIX_FOREST.filter((g) => g.path.startsWith(rootPath)).map((g) => g.id)
    expect(matched).toContain('ime-demo-two-root') // ← the defect
    expect(matched).toContain('ime-demo-two-child')
  })

  it.todo('TENANCY-01: api/groups/[id]/invites.ts resolveSubtree() must use descendantIds(parent_id), not path.eq')
  it.todo('TENANCY-02: api/groups/[id]/rate-compare.ts:319 must drop the path comparison and use isStrictDescendantGroup')
  it.todo('TENANCY-04: api/school/rate-compare.ts subtreeClassIdsForGroupPath() must resolve by parent_id')
  it.todo('TENANCY-05: api/_utils/orgPlatform.ts countSubtreeMembers() must resolve by parent_id')
})
