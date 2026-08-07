/**
 * Update the caller's own school profile (name / region / name_confirmed) —
 * POST /api/school/update-profile
 *
 * Repoints SetupView.vue's step-1 "your school" save off a direct client
 * `schools.update()` — the 2026-07-04 grant-hygiene window left the org
 * tables' authenticated UPDATE grant revoked live (see CLAUDE.md RLS
 * section), so the client PATCH 403s. This is the self-serve wizard's
 * VERY FIRST step, so the 403 blocked the entire setup flow for every new
 * school admin (finding #2b/#5, 2026-07-13 audit).
 *
 * Unlike api/admin/update-school.ts (ssi_admin only, group_id only), this
 * is caller-scoped: the school is resolved from the caller's OWN session
 * (admin_user_id, same lookup as school/update-seats.ts), never from a
 * body school_id — a body school_id would let any caller rename another
 * school.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { auditSchoolWriteRejection } from '../_utils/auditSchoolWriteRejection'
import { isTestSchoolName } from '../_utils/isTestSchoolName'

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
    console.error('[school/update-profile] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const schoolName =
    typeof req.body?.school_name === 'string' ? req.body.school_name.trim().slice(0, 200) : ''
  const regionCode =
    typeof req.body?.region_code === 'string' ? req.body.region_code.trim().slice(0, 50) : ''
  const nameConfirmed =
    typeof req.body?.name_confirmed === 'boolean' ? req.body.name_confirmed : undefined

  if (!schoolName) {
    res.status(400).json({ error: 'school_name is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // --- Resolve the caller's school from the session (never the body). ---
    // Admin-only: schools.admin_user_id, or a user_tags SCHOOL: tag whose
    // role_in_context is 'admin' — NEVER a bare tag match, which would also
    // catch a school's plain teachers (role_in_context: 'teacher') and let
    // them rename the school (finding, 2026-07-16 teacher-loop audit).
    let schoolId: string | null = null
    {
      const { data: ownSchool } = await supabase
        .from('schools')
        .select('id')
        .eq('admin_user_id', auth.userId)
        .maybeSingle()
      schoolId = ownSchool?.id ?? null
      if (!schoolId) {
        const { data: tag } = await supabase
          .from('user_tags')
          .select('tag_value')
          .eq('user_id', auth.userId)
          .eq('tag_type', 'school')
          .eq('role_in_context', 'admin')
          .is('removed_at', null)
          .limit(1)
          .maybeSingle()
        if (tag?.tag_value) schoolId = String(tag.tag_value).replace('SCHOOL:', '')
      }
    }
    if (!schoolId) {
      // Distinguish "no school at all" from "a school, but not as admin" so a
      // teacher hitting this endpoint gets a clear, audit-logged 403 rather
      // than a misleading 404.
      const { data: nonAdminTag } = await supabase
        .from('user_tags')
        .select('tag_value, role_in_context')
        .eq('user_id', auth.userId)
        .eq('tag_type', 'school')
        .is('removed_at', null)
        .limit(1)
        .maybeSingle()
      if (nonAdminTag?.tag_value) {
        const rejectedSchoolId = String(nonAdminTag.tag_value).replace('SCHOOL:', '')
        await auditSchoolWriteRejection(supabase, {
          authUserId: auth.userId,
          schoolId: rejectedSchoolId,
          endpoint: 'school/update-profile',
          roleInContext: nonAdminTag.role_in_context ?? null,
        })
        res.status(403).json({ error: 'Only a school admin can update the school profile' })
        return
      }
      res.status(404).json({ error: 'No school for this account' })
      return
    }

    const updates: Record<string, unknown> = { school_name: schoolName }
    if (regionCode) updates.region_code = regionCode
    if (nameConfirmed !== undefined) updates.name_confirmed = nameConfirmed
    if (isTestSchoolName(schoolName)) updates.is_test = true

    const { data: school, error: updateError } = await supabase
      .from('schools')
      .update(updates)
      .eq('id', schoolId)
      .select('id, school_name, region_code, name_confirmed')
      .single()

    if (updateError || !school) {
      console.error('[school/update-profile] schools update failed:', updateError)
      res.status(500).json({ error: 'Failed to update school', detail: updateError?.message })
      return
    }

    res.status(200).json({ school })
  } catch (err: any) {
    console.error('[school/update-profile] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
