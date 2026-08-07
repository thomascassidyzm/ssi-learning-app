/**
 * Create School In My Group API - POST /api/govt/create-school
 *
 * Leader-callable direct school creation (region-tier-design.md §5c, REVISED
 * by owner 2026-07-13): "leaders CAN create schools directly." The school is
 * GROUP-OWNED FROM BIRTH, not ownerless:
 *   - group_id = the caller's OWN govt_admins.group_id — server-derived,
 *     never from the client payload (same rule as invite/create's
 *     school_admin codes).
 *   - admin_user_id = NULL — a vacant admin seat. The leader's identity NEVER
 *     becomes the school's admin; staff claim the seat later via the
 *     existing admin_join_code mechanic (no new state machine). Verified
 *     safe: every read of admin_user_id in this codebase is an equality
 *     check (`.eq('admin_user_id', x)`), which simply doesn't match a NULL
 *     row — the school_admin_join user_tags path is already the PRIMARY
 *     admin-identity lookup everywhere (schoolScope.ts, useSchoolContext.ts),
 *     admin_user_id is only ever the fallback.
 *   - Both join codes registered immediately (ensureJoinCodesRegistered) so
 *     the leader can hand out either link right away.
 *   - Trial clock set HERE, at creation: the admin_join_code redemption path
 *     (api/code/redeem.ts `school_admin_join` branch) does NOT route through
 *     onboarding/provision (it goes straight to /schools), so this is the
 *     ONLY point at which this school's platform trial clock is ever set —
 *     unlike a self-serve or invite-redeemed school_admin, there is no
 *     "provision" hop that could set it later. Defaults to the free-track
 *     (365-day) clock, matching §5b's identical-terms-at-launch ruling.
 *     Group-level term overrides are NOT implemented yet (no override columns
 *     exist on `groups` — nothing to read); when §5b's override columns ship,
 *     extend this read, not before (no signal before its consumer exists).
 *
 * Requires auth; caller must have a govt_admins row (any govt_admin may
 * create schools in their own group — mirrors the school_admin invite-code
 * permission check in api/invite/create.ts).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { ensureJoinCodesRegistered } from '../_utils/schoolJoinCodes'
import { ensureSchoolNode } from '../_utils/schoolNode'
import { SCHOOL_HERITAGE_TRIAL_DAYS } from '../_utils/trialPolicy'
import { isTestSchoolName } from '../_utils/isTestSchoolName'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Mirrors provision.ts's free-track platform trial window — schools pay for
// the platform even on free courses, so a leader-created school (no course
// picked yet) gets the long, generous default rather than the short one.
// Length comes from trialPolicy.ts, the single trial-length policy point.
const PLATFORM_TRIAL_FREE_DAYS = SCHOOL_HERITAGE_TRIAL_DAYS

function isoIn(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  const schoolName = String((req.body || {}).school_name || '').trim()
  if (!schoolName) {
    res.status(400).json({ error: 'school_name is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data: govtAdmin } = await supabase
      .from('govt_admins')
      .select('group_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (!govtAdmin || !(govtAdmin as any).group_id) {
      res.status(403).json({ error: 'Only a government admin governing a group can create schools' })
      return
    }
    const groupId = (govtAdmin as any).group_id as string

    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .insert({
        school_name: schoolName,
        group_id: groupId,
        admin_user_id: null,
        platform_status: 'trial',
        trial_kind: 'free_1yr',
        platform_expires_at: isoIn(PLATFORM_TRIAL_FREE_DAYS),
        ...(isTestSchoolName(schoolName) ? { is_test: true } : {}),
      })
      .select('id, school_name, teacher_join_code, admin_join_code, group_id, platform_status, trial_kind, platform_expires_at, created_at')
      .single()

    if (schoolError || !school) {
      console.error('[GovtCreateSchool] schools insert failed:', schoolError)
      res.status(500).json({ error: 'Failed to create school', detail: schoolError?.message })
      return
    }

    await ensureJoinCodesRegistered(supabase, school.id as string, userId)
    await ensureSchoolNode(supabase, { id: school.id as string, school_name: schoolName, group_id: groupId })

    console.log('[GovtCreateSchool] created', school.id, schoolName, 'group', groupId, 'by', userId)
    res.status(200).json({ school })
  } catch (err) {
    console.error('[GovtCreateSchool] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
