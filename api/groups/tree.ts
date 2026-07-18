/**
 * GET /api/groups/tree?root=<id>&depth=<n> — the Structure tree lens
 * (THE-MODEL.md §1.9/§6). Subtree rooted at `root` (default: caller's
 * highest visible node; ssi_admin with no root sees every root as a
 * forest), nested to `depth` levels (default 3, capped at 6), each node
 * carrying its rollup + commercial attachment (groupRollups.ts).
 *
 * Server-mediated, service-role — no client-direct org-table reads
 * (THE-MODEL.md §6 "Structure").
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveGroupTreeCaller, callerCanSeeGroup } from '../_utils/groupTreeAuth'
import { fetchSubtree, fetchAllRootGroups, type GroupNodeRow } from '../_utils/groupSubtree'
import { computeNodeExtras, type NodeExtras } from '../_utils/groupRollups'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const DEFAULT_DEPTH = 3
const MAX_DEPTH = 6

interface TreeNode {
  id: string
  name: string
  label: string
  parent_id: string | null
  is_demo: boolean
  is_test: boolean
  rollup: NodeExtras['rollup']
  commercial: NodeExtras['commercial']
  children: TreeNode[]
}

function buildTree(rows: GroupNodeRow[], extras: Record<string, NodeExtras>, rootId: string): TreeNode | null {
  const byParent = new Map<string, GroupNodeRow[]>()
  const byId = new Map<string, GroupNodeRow>()
  for (const r of rows) {
    byId.set(r.id, r)
    if (r.parent_id) {
      if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, [])
      byParent.get(r.parent_id)!.push(r)
    }
  }
  const rootRow = byId.get(rootId)
  if (!rootRow) return null

  const build = (row: GroupNodeRow): TreeNode => {
    const ex = extras[row.id] || { rollup: { childGroupCount: 0, teacherCount: 0, classCount: 0, learnerCount: 0 }, commercial: null }
    return {
      id: row.id,
      name: row.name,
      label: row.type,
      parent_id: row.parent_id,
      is_demo: row.is_demo,
      is_test: row.is_test,
      rollup: ex.rollup,
      commercial: ex.commercial,
      children: (byParent.get(row.id) || [])
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(build),
    }
  }
  return build(rootRow)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured', detail: 'Missing service role key' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const caller = await resolveGroupTreeCaller(req, res, supabase)
  if (!caller) return

  const depth = Math.min(MAX_DEPTH, Math.max(1, parseInt(String(req.query.depth || DEFAULT_DEPTH), 10) || DEFAULT_DEPTH))
  const rootParam = typeof req.query.root === 'string' ? req.query.root : undefined

  try {
    let rootIds: string[]
    if (rootParam) {
      if (!(await callerCanSeeGroup(supabase, caller, rootParam))) {
        res.status(403).json({ error: 'You do not have access to this group' })
        return
      }
      rootIds = [rootParam]
    } else if (caller.isAdmin) {
      rootIds = (await fetchAllRootGroups(supabase)).map((g) => g.id)
    } else {
      rootIds = [caller.ownGroupId!]
    }

    const subtreesByRoot = await Promise.all(rootIds.map((id) => fetchSubtree(supabase, id, depth)))
    const allRows = subtreesByRoot.flat()
    const extras = await computeNodeExtras(supabase, allRows.map((r) => r.id))

    const roots = rootIds
      .map((id, i) => buildTree(subtreesByRoot[i], extras, id))
      .filter((n): n is TreeNode => n !== null)
      .sort((a, b) => a.name.localeCompare(b.name))

    res.status(200).json({ roots })
  } catch (error) {
    console.error('[Groups/Tree] error:', error)
    res.status(500).json({ error: 'Internal server error', detail: String(error) })
  }
}
