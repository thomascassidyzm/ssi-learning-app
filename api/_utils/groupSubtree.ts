/**
 * groupSubtree — path-prefix subtree fetch for the `groups` forest, shared
 * by the Structure tree/table endpoints. Mirrors the exact rule
 * schoolsForGroupSubtree (schoolScope.ts) already uses for schools, applied
 * to groups themselves: `path LIKE '<rootPath>%'`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

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
 * levels below the root (root itself is depth 0). Path is slug-based
 * (`compute_group_path()`), so depth = the path's `/`-segment count beyond
 * the root's.
 */
export async function fetchSubtree(
  svc: SupabaseClient,
  rootId: string,
  maxDepth?: number,
): Promise<GroupNodeRow[]> {
  const { data: root } = await svc.from('groups').select(GROUP_COLUMNS).eq('id', rootId).maybeSingle()
  if (!root) return []
  const rootRow = root as unknown as GroupNodeRow
  const rootPath = rootRow.path
  if (!rootPath) return [rootRow]

  const { data } = await svc.from('groups').select(GROUP_COLUMNS).like('path', `${rootPath}%`)
  let rows = (data ?? []) as unknown as GroupNodeRow[]

  if (maxDepth !== undefined) {
    const rootDepth = rootPath.split('/').length
    rows = rows.filter((r) => {
      const depth = (r.path || '').split('/').length - rootDepth
      return depth >= 0 && depth <= maxDepth
    })
  }
  return rows
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
