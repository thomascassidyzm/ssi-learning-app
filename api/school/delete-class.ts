/**
 * Delete a class — GET (?class_id=, impact preview) | POST /api/school/delete-class
 *
 * Self-serve capability delete for the reported gap: a teacher who set up a
 * class wrongly had no way to remove it. Founder ruling: every level can
 * delete the things it created and everything below them — never sideways,
 * never up. Ownership here is the SAME primitive api/school/rename-class.ts
 * already enforces: `resolveVisibleScope(supabase, auth.userId).classIds`
 * covers a teacher's own taught classes, a school_admin's whole school, and
 * a govt_admin's whole group subtree — so this one check is correct at all
 * three levels without re-deriving ownership per role.
 *
 * GET returns a deletion-impact preview (sessions/learners/teachers, whether
 * there's real recorded activity) — mirrors api/admin/update-school.ts's GET.
 * POST cascades invite_codes/user_tags cleanup + the class-entity learner
 * before removing the class row (see schoolGroupDeletion.ts). If the class
 * has real recorded activity, the caller must pass `confirm_name` matching
 * the class name exactly — same escalation the admin school/group delete
 * uses for a class with real activity.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveVisibleScope } from '../_utils/schoolScope'
import { computeClassImpact, deleteClassCascade } from '../_utils/schoolGroupDeletion'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[school/delete-class] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const classId =
    req.method === 'GET'
      ? ((req.query.class_id as string) || '').trim()
      : (typeof req.body?.class_id === 'string' ? req.body.class_id.trim() : '')
  if (!classId) {
    res.status(400).json({ error: 'class_id is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const scope = await resolveVisibleScope(supabase, auth.userId)
    if (!scope.classIds.includes(classId)) {
      res.status(403).json({ error: 'Not your class' })
      return
    }

    if (req.method === 'GET') {
      const impact = await computeClassImpact(supabase, classId)
      res.status(200).json({ impact })
      return
    }

    const confirmName = (typeof req.body?.confirm_name === 'string' ? req.body.confirm_name : '').trim()
    const impact = await computeClassImpact(supabase, classId)

    if (impact.hasRealActivity && confirmName !== impact.className) {
      res.status(409).json({
        error: 'This class has real recorded activity — type the class name exactly to confirm deletion',
        requires_confirm_name: true,
        impact,
      })
      return
    }

    await deleteClassCascade(supabase, classId)

    console.log('[school/delete-class] deleted', classId, 'by', auth.userId)
    res.status(200).json({ success: true, impact })
  } catch (err: any) {
    console.error('[school/delete-class] Error:', err)
    const notFound = /not found/i.test(err?.message || '')
    res.status(notFound ? 404 : 500).json({ error: err?.message || 'Failed to delete class' })
  }
}
