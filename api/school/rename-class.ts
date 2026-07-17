/**
 * Rename a class — POST /api/school/rename-class
 *
 * Server-mediated write path for ClassDetail.vue's rename action. The direct
 * client write it replaced (`classes.update({ class_name })` from the
 * browser) has NO ownership check at all: `classes` grants authenticated
 * UPDATE, and `classes` is one of the six org tables that is RLS-off by
 * design (CLAUDE.md RLS section) — so any authenticated caller could rename
 * ANY other tenant's class just by knowing its id. Mirrors
 * api/school/remove-staff.ts's server-mediated pattern: authorization is
 * enforced HERE via resolveVisibleScope (the caller's own taught/school
 * classes), never by RLS or the client.
 *
 * Admin read-views (AdminSchoolsContainer/AdminGroupContainer, isAdminView)
 * hide this action entirely — a plain read-view has no legitimate rename
 * intent, so there is no ssi_admin bypass here by design.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveVisibleScope } from '../_utils/schoolScope'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[school/rename-class] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const classId = typeof req.body?.class_id === 'string' ? req.body.class_id.trim() : ''
  const className = typeof req.body?.class_name === 'string' ? req.body.class_name.trim() : ''
  if (!classId) {
    res.status(400).json({ error: 'class_id is required' })
    return
  }
  if (!className) {
    res.status(400).json({ error: 'class_name is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const scope = await resolveVisibleScope(supabase, auth.userId)
    if (!scope.classIds.includes(classId)) {
      res.status(403).json({ error: 'Not your class' })
      return
    }

    const { data, error } = await supabase
      .from('classes')
      .update({ class_name: className })
      .eq('id', classId)
      .select('id, class_name')
      .single()

    if (error || !data) {
      console.error('[school/rename-class] update failed:', error)
      res.status(500).json({ error: error?.message || 'Failed to rename class' })
      return
    }

    res.status(200).json({ class: data })
  } catch (err: any) {
    console.error('[school/rename-class] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
