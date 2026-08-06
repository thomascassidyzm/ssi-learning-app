/**
 * groupSubtree — subtree resolution for the `groups` forest, shared by the
 * Structure tree/table endpoints and the rollup resolvers.
 *
 * SUBTREE MEMBERSHIP IS BY `parent_id`, NOT BY SLUG PATH (changed 2026-08-06).
 * `compute_group_path()` slugifies the name, and NOTHING makes a slug unique —
 * two orgs both called "Deborah Testing" both got `path = 'deborah-testing'`
 * live, so every `path LIKE '<root>%'` resolver silently merged two unrelated
 * tenants: each org's dashboard counted the other's people. The '/'-boundary
 * guard that groupRollups added for the string-prefix case ('ime-demo' vs
 * 'ime-demo-two') cannot help here — the paths are EQUAL.
 *
 * Walking parent_id is the real relation, is collision-proof by construction,
 * and costs nothing extra: every caller already holds (or can hold) the forest,
 * which is small.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** The minimum a row needs for a parent walk. */
export interface ParentLinked { id: string; parent_id: string | null }

/**
 * `rootId` plus every descendant, resolved through parent_id over the given
 * forest. Depth-capped when `maxDepth` is set (root itself is depth 0).
 * Returns [rootId] when the root isn't in the forest.
 */
export function descendantIds<T extends ParentLinked>(
  forest: T[],
  rootId: string,
  maxDepth?: number,
): string[] {
  const childrenOf = new Map<string, string[]>()
  let rootPresent = false
  for (const r of forest) {
    if (r.id === rootId) rootPresent = true
    if (!r.parent_id) continue
    if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, [])
    childrenOf.get(r.parent_id)!.push(r.id)
  }
  if (!rootPresent) return [rootId]

  const out: string[] = []
  const seen = new Set<string>()
  let frontier = [rootId]
  let depth = 0
  while (frontier.length > 0 && (maxDepth === undefined || depth <= maxDepth)) {
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue // cycle guard — a corrupt parent chain must not hang the request
      seen.add(id)
      out.push(id)
      for (const child of childrenOf.get(id) || []) next.push(child)
    }
    frontier = next
    depth += 1
  }
  return out
}

export interface GroupNodeRow {
  id: string
  name: string
  type: string
  parent_id: string | null
  path: string | null
  is_demo: boolean
  is_test: boolean
  created_at: string
}

const GROUP_COLUMNS = 'id, name, type, parent_id, path, is_demo, is_test, created_at'

/**
 * `rootId`'s own row plus every descendant, optionally capped at `maxDepth`
 * levels below the root (root itself is depth 0). Membership walks parent_id
 * over the whole (small) forest — see the file header on why slug paths cannot
 * be trusted for this.
 */
export async function fetchSubtree(
  svc: SupabaseClient,
  rootId: string,
  maxDepth?: number,
): Promise<GroupNodeRow[]> {
  const { data } = await svc.from('groups').select(GROUP_COLUMNS)
  const forest = (data ?? []) as unknown as GroupNodeRow[]
  const ids = new Set(descendantIds(forest, rootId, maxDepth))
  const rows = forest.filter((r) => ids.has(r.id))
  return rows.length > 0 ? rows : []
}

/** Every root-level group (`parent_id IS NULL`) — the forest ssi_admin sees by default. */
export async function fetchAllRootGroups(svc: SupabaseClient): Promise<GroupNodeRow[]> {
  const { data } = await svc.from('groups').select(GROUP_COLUMNS).is('parent_id', null).order('name')
  return (data ?? []) as unknown as GroupNodeRow[]
}

/** Every group in the tree — the flat scope ssi_admin sees in the table lens. */
export async function fetchAllGroups(svc: SupabaseClient): Promise<GroupNodeRow[]> {
  const { data } = await svc.from('groups').select(GROUP_COLUMNS).order('name')
  return (data ?? []) as unknown as GroupNodeRow[]
}
