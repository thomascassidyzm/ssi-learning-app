/**
 * Onboarding profile — POST /api/onboarding/profile
 *
 * The OPTIONAL "and a bit about you" step on the CONTINUE screen, after the
 * account + trial are already confirmed by provision. All fields optional; the
 * user can skip and just continue.
 *
 * Body (all optional): { display_name, institution }
 *   - display_name → learners.display_name (+ teachers.display_name if a teacher)
 *   - institution  → schools.school_name for the school this user admins
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }

  // Length caps: these land verbatim in dashboard headers and roster labels —
  // an unbounded string is a UI-breakage vector, not a security one (writes
  // are already scoped to the caller's own rows).
  const displayName =
    typeof req.body?.display_name === 'string' ? req.body.display_name.trim().slice(0, 120) : ''
  const institution =
    typeof req.body?.institution === 'string' ? req.body.institution.trim().slice(0, 200) : ''

  if (!displayName && !institution) {
    res.status(200).json({ ok: true, updated: false })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', auth.userId)
      .maybeSingle()
    if (!learner) {
      res.status(404).json({ error: 'Account not found' })
      return
    }

    let displayNameSaved = true
    if (displayName) {
      const { error: learnerErr } = await supabase
        .from('learners')
        .update({ display_name: displayName })
        .eq('id', learner.id)
      if (learnerErr) {
        console.error('[onboarding/profile] learners.display_name update failed:', learnerErr)
        displayNameSaved = false
      }
      // Mirror to the teacher profile if they have one (it's the public name).
      // No teacher row is the common case (student/most tracks) — not an error.
      const { error: teacherErr } = await supabase
        .from('teachers')
        .update({ display_name: displayName })
        .eq('learner_id', learner.id)
      if (teacherErr) {
        console.error('[onboarding/profile] teachers.display_name update failed:', teacherErr)
      }
    }

    let institutionSaved = false
    let institutionError: string | undefined
    if (institution) {
      const { data: updatedSchools, error: schoolErr } = await supabase
        .from('schools')
        .update({ school_name: institution })
        .eq('admin_user_id', auth.userId)
        .select('id')
      if (schoolErr) {
        console.error('[onboarding/profile] schools.school_name update failed:', schoolErr)
        institutionError = schoolErr.message
      }
      institutionSaved = !!(updatedSchools && updatedSchools.length)
    }

    res.status(200).json({
      ok: true,
      updated: true,
      display_name_saved: displayNameSaved,
      institution_saved: institutionSaved,
      institution_error: institutionError,
    })
  } catch (error: any) {
    console.error('[onboarding/profile] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
