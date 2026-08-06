/**
 * groupSlug + findSiblingSlugCollisions — the duplicate-name warning at org
 * creation.
 *
 * Deborah ended up with two orgs both called "Deborah Testing" and nothing
 * anywhere told her she had just made a second one. Both slugged to
 * `deborah-testing`, which is what let a path-string subtree match count each
 * org's people into the other's rollup (fixed separately in c2f04665).
 *
 * The rule this file enforces is a WARNING, never a constraint: a collision
 * makes the create endpoint answer 409 `duplicate_name` and write nothing; the
 * same request re-sent with `confirm_duplicate: true` proceeds exactly as it
 * does today. Legitimate duplicates are allowed — a human just has to say so.
 *
 * Two things matter about the comparison:
 *
 * 1. It is on the SLUG, not the raw name. `compute_group_path()` derives
 *    `groups.path` from the name with one lossy line (supabase/schema.sql):
 *      v_slug := LOWER(REGEXP_REPLACE(NEW.name, '[^a-zA-Z0-9]+', '-', 'g'));
 *    so "Deborah Testing", "deborah testing", "Deborah  Testing",
 *    "Deborah-Testing" and "Deborah_Testing" are all the same org as far as
 *    the path is concerned. `groupSlug()` mirrors that line exactly and is
 *    unit-tested against those variants so the two cannot drift.
 *
 * 2. Scope is SAME PARENT only. A collision is another group with the same
 *    slug under the same parent — for a root org, another root org; for a
 *    sub-group, another child of the same parent. That is exactly the set that
 *    produces an ambiguous `path`. "Year 7" inside two different schools is
 *    NOT a collision and must not warn: a warning that fires on legitimate
 *    structure gets ignored within a week.
 *
 * The lookup FAILS OPEN. Any error looking for duplicates means no warning,
 * never a failed creation — a warning is a nicety, a blocked signup is a lost
 * customer.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface CollidingGroup {
  id: string
  name: string
  created_at: string | null
  path: string | null
}

/**
 * Mirror of compute_group_path()'s slug line. Deliberately does NOT trim
 * leading/trailing separators or collapse anything the SQL doesn't — the
 * point is to agree with the trigger, not to be a nicer slugifier.
 */
export function groupSlug(name: string): string {
  return String(name ?? '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
}

/**
 * Groups under the same parent whose name slugs to the same value as `name`.
 * `parentId` null/undefined means root-level. Returns [] on any error, and []
 * when the name is blank.
 */
export async function findSiblingSlugCollisions(
  supabase: SupabaseClient,
  name: string,
  parentId?: string | null,
): Promise<CollidingGroup[]> {
  try {
    // Slug the same string the insert will store — every caller trims.
    const slug = groupSlug(String(name ?? '').trim())
    if (!slug) return []

    let query = supabase.from('groups').select('id, name, created_at, path')
    query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null)

    const { data, error } = await query
    if (error) {
      console.warn('[groupSlug] duplicate lookup failed, proceeding without a warning:', error.message)
      return []
    }

    return (data || [])
      .filter((g: any) => groupSlug(String(g?.name ?? '').trim()) === slug)
      .map((g: any) => ({
        id: g.id,
        name: g.name,
        created_at: g.created_at ?? null,
        path: g.path ?? null,
      }))
  } catch (err) {
    console.warn('[groupSlug] duplicate lookup threw, proceeding without a warning:', err)
    return []
  }
}

/**
 * The 409 body. `detailed` callers (ssi_admin, or a sub-group collision inside
 * the caller's own subtree) get the id and path; everyone else gets only what
 * makes the warning useful — the name and when it was made. A root collision
 * is with ANOTHER TENANT's org, so its id, path, learner counts and leader
 * names are none of the creator's business.
 */
export function duplicateNameBody(
  duplicates: CollidingGroup[],
  opts: { detailed: boolean; noun?: string },
): { error: string; code: 'duplicate_name'; duplicates: Array<Partial<CollidingGroup>> } {
  const first = duplicates[0]
  const noun = opts.noun || 'organisation'
  return {
    error: `There's already ${noun === 'organisation' ? 'an' : 'a'} ${noun} called "${first?.name ?? ''}". Creating this one will give you two with the same name.`,
    code: 'duplicate_name',
    duplicates: duplicates.map((d) =>
      opts.detailed
        ? { id: d.id, name: d.name, created_at: d.created_at, path: d.path }
        : { name: d.name, created_at: d.created_at },
    ),
  }
}
