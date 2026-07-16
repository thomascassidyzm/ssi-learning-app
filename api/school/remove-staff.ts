/**
 * Remove a teacher from the school — POST /api/school/remove-staff
 *
 * Server-mediated write path for TeachersView.vue's "Remove" action. The
 * direct client write it replaced (`user_tags.update({removed_at})` from the
 * browser) silently no-ops: user_tags has own-row RLS live since 2026-06-10
 * (CLAUDE.md RLS section), so a school_admin's update targeting ANOTHER
 * user's row matches zero rows — no error, no effect, and the old client
 * code reported "success" regardless (finding, 2026-07-16 teacher-loop
 * audit). Per standing doctrine, hierarchy authz (school_admin removing a
 * teacher from THEIR school) belongs in a server-mediated endpoint, never a
 * "clever" RLS policy — this mirrors api/teacher/class-teachers.ts's
 * service-role remove path, scoped to school-level staff instead of
 * class-level.
 *
 * Auth: verifyAuthToken, then caller must resolve to the SAME school as
 * target_user_id's active school/teacher tag, via schools.admin_user_id or a
 * user_tags SCHOOL: tag with role_in_context 'admin' (same admin-only
 * resolution as update-profile.ts / update-seats.ts).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

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
    console.error('[school/remove-staff] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const targetUserId = typeof req.body?.target_user_id === 'string' ? req.body.target_user_id : ''
  if (!targetUserId) {
    res.status(400).json({ error: 'target_user_id is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // --- Resolve the CALLER's school, admin-only (never the body). ---
    let callerSchoolId: string | null = null
    {
      const { data: ownSchool } = await supabase
        .from('schools')
        .select('id')
        .eq('admin_user_id', auth.userId)
        .maybeSingle()
      callerSchoolId = ownSchool?.id ?? null
      if (!callerSchoolId) {
        const { data: tag } = await supabase
          .from('user_tags')
          .select('tag_value')
          .eq('user_id', auth.userId)
          .eq('tag_type', 'school')
          .eq('role_in_context', 'admin')
          .is('removed_at', null)
          .limit(1)
          .maybeSingle()
        if (tag?.tag_value) callerSchoolId = String(tag.tag_value).replace('SCHOOL:', '')
      }
    }
    if (!callerSchoolId) {
      res.status(403).json({ error: 'Only a school admin can remove staff' })
      return
    }

    // --- Target must be an active TEACHER tag on the caller's own school. ---
    const { data: targetTag } = await supabase
      .from('user_tags')
      .select('id')
      .eq('user_id', targetUserId)
      .eq('tag_type', 'school')
      .eq('tag_value', `SCHOOL:${callerSchoolId}`)
      .eq('role_in_context', 'teacher')
      .is('removed_at', null)
      .maybeSingle()

    if (!targetTag) {
      res.status(404).json({ error: 'That teacher is not a member of your school' })
      return
    }

    const { error: rmErr } = await supabase
      .from('user_tags')
      .update({ removed_at: new Date().toISOString() })
      .eq('id', targetTag.id)

    if (rmErr) {
      console.error('[school/remove-staff] user_tags update failed:', rmErr)
      res.status(500).json({ error: 'Failed to remove teacher', detail: rmErr.message })
      return
    }

    res.status(200).json({ ok: true })
  } catch (err: any) {
    console.error('[school/remove-staff] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
