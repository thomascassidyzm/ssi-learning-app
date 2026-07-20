/**
 * Demo Leaf API - GET/POST /api/admin/demo-leaf
 *
 * Backs the Demos tool's tree UI (AdminDemoSchools.vue): the "Get join
 * code" action on any group node in a demo org's hierarchy. See
 * api/_utils/demoLeaf.ts for the invisible school+class this provisions —
 * never named or shown as such anywhere in the Demos UI, only its resulting
 * join code is.
 *
 * GET  ?org_group_id=<root group id>
 *   — bulk list of every leaf already provisioned anywhere in that org's
 *     subtree: [{ group_id, class_id, student_join_code }]. One request per
 *     tree render instead of one per node.
 * POST { group_id }
 *   — idempotently provisions (or returns the existing) leaf for that one
 *     group node.
 *
 * Admin-gated (verifyAdmin) — same surface as api/admin/demo-schools.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { ensureDemoLeafClass } from '../_utils/demoLeaf'
import { resolveGroupSubtreeIds } from '../_utils/demoSchoolGraph'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (req.method === 'GET') {
    const orgGroupId = req.query.org_group_id as string
    if (!orgGroupId) {
      res.status(400).json({ error: 'org_group_id is required' })
      return
    }
    try {
      const groupIds = await resolveGroupSubtreeIds(supabase, orgGroupId)
      if (!groupIds.length) {
        res.status(200).json({ leaves: [] })
        return
      }
      const { data: schools, error: schoolsErr } = await supabase
        .from('schools')
        .select('id, group_id')
        .in('group_id', groupIds)
      if (schoolsErr) throw schoolsErr
      const schoolIds = (schools || []).map((s) => s.id as string)
      if (!schoolIds.length) {
        res.status(200).json({ leaves: [] })
        return
      }
      const { data: classes, error: classesErr } = await supabase
        .from('classes')
        .select('id, school_id, student_join_code')
        .in('school_id', schoolIds)
      if (classesErr) throw classesErr
      const groupIdBySchoolId = new Map((schools || []).map((s) => [s.id as string, s.group_id as string]))
      const leaves = (classes || []).map((c) => ({
        group_id: groupIdBySchoolId.get(c.school_id as string) as string,
        class_id: c.id as string,
        student_join_code: c.student_join_code as string,
      }))
      res.status(200).json({ leaves })
    } catch (error: any) {
      console.error('[DemoLeaf] List error:', error)
      res.status(500).json({ error: error?.message || 'Internal server error' })
    }
    return
  }

  if (req.method === 'POST') {
    const { group_id: groupId } = req.body || {}
    if (!groupId || typeof groupId !== 'string') {
      res.status(400).json({ error: 'group_id is required' })
      return
    }
    try {
      const result = await ensureDemoLeafClass(supabase, groupId, admin.userId)
      if ('error' in result) {
        res.status(400).json({ error: result.error })
        return
      }
      res.status(200).json({ group_id: groupId, class_id: result.classId, student_join_code: result.studentJoinCode, created: result.created })
    } catch (error: any) {
      console.error('[DemoLeaf] Create error:', error)
      res.status(500).json({ error: error?.message || 'Failed to create join code' })
    }
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
