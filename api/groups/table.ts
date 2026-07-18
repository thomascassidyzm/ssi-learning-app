/**
 * GET /api/groups/table?search=&label=&status=&demo=&page= — the Structure
 * table lens (THE-MODEL.md §1.9/§6). Same data as the tree, flat and
 * paginated, filterable by name search, label (groups.type — display
 * vocabulary, I3), commercial status (school-shaped nodes only), and demo.
 *
 * Server-mediated, service-role — no client-direct org-table reads.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveGroupTreeCaller } from '../_utils/groupTreeAuth'
import { fetchAllGroups, fetchSubtree, type GroupNodeRow } from '../_utils/groupSubtree'
import { computeNodeExtras } from '../_utils/groupRollups'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const PAGE_SIZE = 25

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

  try {
    let scopeRows: GroupNodeRow[] = caller.isAdmin
      ? await fetchAllGroups(supabase)
      : await fetchSubtree(supabase, caller.ownGroupId!)

    const search = String(req.query.search || '').trim().toLowerCase()
    const label = String(req.query.label || '').trim()
    const demoParam = typeof req.query.demo === 'string' ? req.query.demo : undefined
    const status = String(req.query.status || '').trim()
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)

    let rows = scopeRows
    if (search) rows = rows.filter((r) => r.name.toLowerCase().includes(search))
    if (label) rows = rows.filter((r) => r.type === label)
    if (demoParam !== undefined) {
      const wantDemo = demoParam === 'true'
      rows = rows.filter((r) => r.is_demo === wantDemo)
    }

    const extras = await computeNodeExtras(supabase, rows.map((r) => r.id))

    if (status) {
      rows = rows.filter((r) => extras[r.id]?.commercial?.platformStatus === status)
    }

    rows = rows.slice().sort((a, b) => a.name.localeCompare(b.name))

    const total = rows.length
    const start = (page - 1) * PAGE_SIZE
    const pageRows = rows.slice(start, start + PAGE_SIZE)

    res.status(200).json({
      rows: pageRows.map((r) => ({
        id: r.id,
        name: r.name,
        label: r.type,
        parent_id: r.parent_id,
        is_demo: r.is_demo,
        is_test: r.is_test,
        rollup: extras[r.id].rollup,
        commercial: extras[r.id].commercial,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    })
  } catch (error) {
    console.error('[Groups/Table] error:', error)
    res.status(500).json({ error: 'Internal server error', detail: String(error) })
  }
}
